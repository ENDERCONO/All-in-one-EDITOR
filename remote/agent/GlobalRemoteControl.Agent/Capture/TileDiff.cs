using System.Drawing;

namespace GlobalRemoteControl.Agent.Capture;

/// <summary>
/// Tile diff (PROTOCOL.md section 5, frame v2): 64×64 tiles of the current scaled frame are compared with the
/// previous one; changed tiles are merged into horizontal runs, and runs with the same span on consecutive tile rows
/// are merged into one rectangle.
/// </summary>
public sealed class TileGrid
{
    public const int TileSize = 64;

    public int Width { get; private set; }
    public int Height { get; private set; }
    public int Cols { get; private set; }
    public int Rows { get; private set; }
    public bool[] Changed { get; private set; } = Array.Empty<bool>();
    public bool[] Candidate { get; private set; } = Array.Empty<bool>();

    public void Resize(int width, int height)
    {
        if (width == Width && height == Height) return;
        Width = width; Height = height;
        Cols = (width + TileSize - 1) / TileSize;
        Rows = (height + TileSize - 1) / TileSize;
        Changed = new bool[Cols * Rows];
        Candidate = new bool[Cols * Rows];
    }

    public Rectangle TileRect(int col, int row) =>
        Rectangle.FromLTRB(col * TileSize, row * TileSize, Math.Min(Width, (col + 1) * TileSize), Math.Min(Height, (row + 1) * TileSize));

    public void ClearChanged() => Array.Clear(Changed);
    public void MarkAllChanged() => Array.Fill(Changed, true);
    public void MarkAllCandidates() => Array.Fill(Candidate, true);
    public void ClearCandidates() => Array.Clear(Candidate);

    /// <summary>Marks every tile touching <paramref name="r"/> (pixels) as a candidate for comparison.</summary>
    public void MarkCandidates(Rectangle r)
    {
        r.Intersect(new Rectangle(0, 0, Width, Height));
        if (r.Width <= 0 || r.Height <= 0) return;
        int c0 = r.Left / TileSize, c1 = (r.Right - 1) / TileSize, r0 = r.Top / TileSize, r1 = (r.Bottom - 1) / TileSize;
        for (int row = r0; row <= r1; row++)
            for (int col = c0; col <= c1; col++) Candidate[row * Cols + col] = true;
    }

    public int ChangedCount() { int n = 0; foreach (var c in Changed) if (c) n++; return n; }

    /// <summary>Changed pixel area (tiles at the right/bottom edge count with their real size).</summary>
    public long ChangedArea()
    {
        long a = 0;
        for (int row = 0; row < Rows; row++)
            for (int col = 0; col < Cols; col++)
                if (Changed[row * Cols + col]) { var t = TileRect(col, row); a += (long)t.Width * t.Height; }
        return a;
    }

    /// <summary>
    /// Compares candidate tiles of <paramref name="cur"/> against <paramref name="prev"/> (same size as the grid) and
    /// sets <see cref="Changed"/>. Row-by-row memcmp with early exit.
    /// </summary>
    public void Compare(FrameBuffer cur, FrameBuffer prev)
    {
        if (cur.Width != Width || cur.Height != Height || prev.Width != Width || prev.Height != Height)
            throw new ArgumentException("size mismatch");
        int candidates = 0;
        foreach (var c in Candidate) if (c) candidates++;
        if (candidates > 32) Parallel.For(0, Rows, row => CompareRow(cur, prev, row));
        else for (int row = 0; row < Rows; row++) CompareRow(cur, prev, row);
    }

    private void CompareRow(FrameBuffer cur, FrameBuffer prev, int row)
    {
        int stride = cur.Stride;
        var a = cur.Pixels; var b = prev.Pixels;
        for (int col = 0; col < Cols; col++)
        {
            int i = row * Cols + col;
            if (!Candidate[i]) { Changed[i] = false; continue; }
            var t = TileRect(col, row);
            int bytes = t.Width * 4;
            bool diff = false;
            for (int y = t.Top; y < t.Bottom && !diff; y++)
            {
                int off = y * stride + t.Left * 4;
                diff = !a.AsSpan(off, bytes).SequenceEqual(b.AsSpan(off, bytes));
            }
            Changed[i] = diff;
        }
    }

    /// <summary>Merges changed tiles into rectangles (pixels, clipped to the frame).</summary>
    public List<Rectangle> MergeRects()
    {
        var done = new List<Rectangle>();
        var open = new List<(int C0, int C1, int R0)>();   // spans still growing downwards
        var next = new List<(int C0, int C1, int R0)>();
        for (int row = 0; row <= Rows; row++)
        {
            next.Clear();
            if (row < Rows)
            {
                for (int col = 0; col < Cols; col++)
                {
                    if (!Changed[row * Cols + col]) continue;
                    int start = col;
                    while (col + 1 < Cols && Changed[row * Cols + col + 1]) col++;
                    int idx = open.FindIndex(o => o.C0 == start && o.C1 == col);
                    if (idx >= 0) { next.Add(open[idx]); open.RemoveAt(idx); }
                    else next.Add((start, col, row));
                }
            }
            foreach (var o in open) done.Add(ToPixels(o.C0, o.C1, o.R0, row - 1));
            (open, next) = (next, open);
        }
        done.Sort((x, y) => x.Top != y.Top ? x.Top.CompareTo(y.Top) : x.Left.CompareTo(y.Left));
        return done;
    }

    private Rectangle ToPixels(int c0, int c1, int r0, int r1) =>
        Rectangle.FromLTRB(c0 * TileSize, r0 * TileSize, Math.Min(Width, (c1 + 1) * TileSize), Math.Min(Height, (r1 + 1) * TileSize));
}
