using System.Diagnostics;
using System.Drawing;

namespace GlobalRemoteControl.Agent.Capture;

public sealed record DeltaStats(double ScaleMs, double DiffMs, double EncodeMs, int Bytes, int Rects, bool Keyframe, int ChangedTiles);

/// <summary>
/// Turns captured full-resolution frames into v2 payloads (PROTOCOL.md section 5): scale (box filter) → 64×64 tile
/// diff against the previous scaled frame → merged rects → parallel JPEG per rect. If more than
/// <see cref="FullFrameThreshold"/> of the picture changed, one full-frame keyframe rect is sent instead.
/// Not thread-safe: one instance per streaming thread.
/// </summary>
public sealed class DeltaEncoder
{
    public const double FullFrameThreshold = 0.6;
    /// <summary>Rects bigger than this (pixels) are split into horizontal bands so they encode on several cores.</summary>
    public const int SplitArea = 160_000;

    private readonly IRectEncoder _encoder;
    private readonly BoxScaler _scaler = new();
    private readonly FrameBuffer _scaled = new();
    private readonly FrameBuffer _prev = new();
    private readonly TileGrid _grid = new();
    private readonly int _workers;
    private bool _hasPrev;
    private bool _scaledValid;

    public DeltaEncoder(IRectEncoder? encoder = null, int? workers = null)
    {
        _encoder = encoder ?? JpegEncoder.Default;
        _workers = Math.Clamp(workers ?? Environment.ProcessorCount, 1, 8);
    }

    public IRectEncoder Encoder => _encoder;
    public int Width => _prev.Width;
    public int Height => _prev.Height;
    public DeltaStats? Last { get; private set; }
    public TileGrid Grid => _grid;

    /// <summary>Forget the previous frame (next call produces a keyframe).</summary>
    public void Reset() { _hasPrev = false; _scaledValid = false; }

    public static (int W, int H) TargetSize(int width, int height, double scale)
    {
        scale = Math.Clamp(scale, 0.0625, 1);
        return (Math.Max(1, (int)Math.Round(width * scale)), Math.Max(1, (int)Math.Round(height * scale)));
    }

    /// <summary>
    /// Encodes the changes in <paramref name="full"/> since the previous call. <paramref name="dirty"/> is the capture
    /// hint in full-resolution pixels (only tiles it touches are compared, unless it says All). Returns null when
    /// nothing changed (and no keyframe was forced).
    /// </summary>
    public byte[]? Encode(FrameBuffer full, DirtyRegion dirty, double scale, int quality, bool forceKeyframe, out bool keyframe)
    {
        var sw = Stopwatch.StartNew();
        var (w, h) = TargetSize(full.Width, full.Height, scale);
        keyframe = forceKeyframe || !_hasPrev || _prev.Width != w || _prev.Height != h;

        FrameBuffer cur;
        if (w == full.Width && h == full.Height) { cur = full; _scaledValid = false; }
        else
        {
            bool resized = _scaled.EnsureSize(w, h);
            if (keyframe || resized || dirty.All || !_scaledValid) _scaler.Scale(full, _scaled);
            else foreach (var r in dirty.Rects) _scaler.ScaleRect(full, _scaled, BoxScaler.MapToDst(r, full.Width, full.Height, w, h));
            _scaledValid = true;
            cur = _scaled;
        }
        double scaleMs = sw.Elapsed.TotalMilliseconds;

        _grid.Resize(w, h);
        if (keyframe) _grid.MarkAllChanged();
        else
        {
            if (dirty.All) _grid.MarkAllCandidates();
            else
            {
                _grid.ClearCandidates();
                foreach (var r in dirty.Rects)
                    _grid.MarkCandidates(ReferenceEquals(cur, full) ? r : BoxScaler.MapToDst(r, full.Width, full.Height, w, h));
            }
            _grid.Compare(cur, _prev);
        }
        int changedTiles = _grid.ChangedCount();
        if (keyframe) { _prev.CopyFrom(cur); _hasPrev = true; }
        else if (changedTiles > 0)
            for (int row = 0; row < _grid.Rows; row++)
                for (int col = 0; col < _grid.Cols; col++)
                    if (_grid.Changed[row * _grid.Cols + col]) _prev.CopyRect(cur, _grid.TileRect(col, row));
        double diffMs = sw.Elapsed.TotalMilliseconds - scaleMs;

        if (!keyframe && changedTiles == 0)
        {
            Last = new DeltaStats(scaleMs, diffMs, 0, 0, 0, false, 0);
            return null;
        }

        List<Rectangle> rects;
        if (keyframe || _grid.ChangedArea() > FullFrameThreshold * w * h)
        {
            keyframe = true;
            rects = new List<Rectangle> { new(0, 0, w, h) };
        }
        else rects = _grid.MergeRects();

        var pieces = SplitForParallel(rects, _workers);
        var encoded = new EncodedRect[pieces.Count];
        if (pieces.Count == 1) encoded[0] = new EncodedRect(pieces[0], _encoder.Encode(_prev, pieces[0], quality));
        else Parallel.For(0, pieces.Count, new ParallelOptions { MaxDegreeOfParallelism = _workers },
            i => encoded[i] = new EncodedRect(pieces[i], _encoder.Encode(_prev, pieces[i], quality)));
        double encodeMs = sw.Elapsed.TotalMilliseconds - scaleMs - diffMs;

        var payload = FrameV2.Write(keyframe, w, h, encoded);
        Last = new DeltaStats(scaleMs, diffMs, encodeMs, payload.Length, encoded.Length, keyframe, changedTiles);
        return payload;
    }

    /// <summary>Splits big rects into horizontal bands (multiples of 64 rows) so that up to <paramref name="workers"/> encode at once.</summary>
    public static List<Rectangle> SplitForParallel(List<Rectangle> rects, int workers)
    {
        if (workers <= 1) return rects;
        var result = new List<Rectangle>(rects.Count);
        foreach (var r in rects)
        {
            long area = (long)r.Width * r.Height;
            int bands = (int)Math.Min(workers, area / SplitArea);
            bands = Math.Min(bands, r.Height / TileGrid.TileSize);
            if (bands <= 1) { result.Add(r); continue; }
            int bandH = (r.Height + bands - 1) / bands;
            bandH = (bandH + TileGrid.TileSize - 1) / TileGrid.TileSize * TileGrid.TileSize;
            for (int y = r.Top; y < r.Bottom; y += bandH)
                result.Add(Rectangle.FromLTRB(r.Left, y, r.Right, Math.Min(r.Bottom, y + bandH)));
        }
        return result;
    }
}
