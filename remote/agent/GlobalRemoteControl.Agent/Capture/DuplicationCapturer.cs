using System.Drawing;
using System.Runtime.CompilerServices;
using Vortice;
using Vortice.Direct3D;
using Vortice.Direct3D11;
using Vortice.DXGI;

namespace GlobalRemoteControl.Agent.Capture;

/// <summary>
/// DXGI Desktop Duplication capture for one output. The latest desktop image is kept in a staging texture; the target
/// buffer is only updated where DXGI reports dirty / moved areas (plus where the cursor was drawn last time), and those
/// areas are passed on as the diff hint. Never blocks waiting for a new frame. Throws on setup failure or lost access
/// (the caller falls back to GDI).
/// </summary>
public sealed class DuplicationCapturer : IDisposable
{
    private readonly ID3D11Device _device;
    private readonly ID3D11DeviceContext _context;
    private readonly IDXGIOutputDuplication _duplication;
    private readonly ID3D11Texture2D _staging;
    private readonly CursorPainter _cursor = new();
    private RawRect[] _dirtyBuf = new RawRect[64];
    private OutduplMoveRect[] _moveBuf = new OutduplMoveRect[16];
    private readonly List<Rectangle> _copy = new();
    private bool _hasFrame;
    private FrameBuffer? _target;          // the buffer we keep up to date (anything else gets a full copy)
    private Rectangle _cursorDrawn;        // where the cursor was painted into _target last time
    private CursorState _cursorState;

    public string DeviceName { get; }
    public int Width { get; }
    public int Height { get; }

    public DuplicationCapturer(string deviceName)
    {
        DeviceName = deviceName;
        using var factory = DXGI.CreateDXGIFactory1<IDXGIFactory1>();
        for (uint a = 0; factory.EnumAdapters1(a, out var adapter).Success; a++)
        {
            using (adapter)
            {
                for (uint o = 0; adapter.EnumOutputs(o, out var output).Success; o++)
                {
                    using (output)
                    {
                        var desc = output.Description;
                        if (!string.Equals(desc.DeviceName, deviceName, StringComparison.OrdinalIgnoreCase)) continue;
                        D3D11.D3D11CreateDevice(adapter, DriverType.Unknown, DeviceCreationFlags.BgraSupport,
                            new[] { FeatureLevel.Level_11_0, FeatureLevel.Level_10_1, FeatureLevel.Level_10_0 },
                            out ID3D11Device device, out ID3D11DeviceContext context).CheckError();
                        _device = device!;
                        _context = context!;
                        using var output1 = output.QueryInterface<IDXGIOutput1>();
                        _duplication = output1.DuplicateOutput(_device);
                        var r = desc.DesktopCoordinates;
                        Width = r.Right - r.Left;
                        Height = r.Bottom - r.Top;
                        _staging = _device.CreateTexture2D(new Texture2DDescription
                        {
                            Width = (uint)Width, Height = (uint)Height, MipLevels = 1, ArraySize = 1,
                            Format = Format.B8G8R8A8_UNorm, SampleDescription = new SampleDescription(1, 0),
                            Usage = ResourceUsage.Staging, BindFlags = BindFlags.None, CPUAccessFlags = CpuAccessFlags.Read,
                        });
                        return;
                    }
                }
            }
        }
        throw new InvalidOperationException("Output not found for " + deviceName);
    }

    /// <summary>Updates <paramref name="target"/>; false if no desktop image is available yet.</summary>
    public bool Capture(Rectangle bounds, FrameBuffer target, bool drawCursor, DirtyRegion dirty)
    {
        var size = new Size(Width, Height);
        bool full = target.EnsureSize(Width, Height) | !ReferenceEquals(target, _target);
        dirty.Reset();
        _copy.Clear();
        bool newImage = false, metadataOk = true;

        var result = _duplication.AcquireNextFrame(_hasFrame ? 0u : 100u, out var info, out var resource);
        if (result.Success)
        {
            try
            {
                if (info.LastPresentTime != 0 || !_hasFrame)
                {
                    if (_hasFrame && info.TotalMetadataBufferSize > 0) metadataOk = ReadMetadata(info.TotalMetadataBufferSize, size);
                    else if (_hasFrame) metadataOk = true; // presented without metadata: nothing changed in the image
                    else metadataOk = false;
                    using var tex = resource!.QueryInterface<ID3D11Texture2D>();
                    _context.CopyResource(_staging, tex);
                    _hasFrame = true;
                    newImage = true;
                }
            }
            finally
            {
                resource?.Dispose();
                _duplication.ReleaseFrame();
            }
        }
        else if (result.Code != Vortice.DXGI.ResultCode.WaitTimeout.Code)
        {
            throw new InvalidOperationException("Desktop duplication failed: " + result); // access lost / mode change
        }
        if (!_hasFrame) return false;
        if (newImage && !metadataOk) full = true;

        var cursor = drawCursor ? CursorState.Read() : default;
        var cursorRect = drawCursor ? _cursor.Bounds(cursor, bounds, size) : Rectangle.Empty;
        if (!full)
        {
            bool cursorSame = cursor == _cursorState && cursorRect == _cursorDrawn;
            if (_copy.Count == 0 && cursorSame) return true; // nothing at all changed: dirty stays empty, no GPU map
            if (!_cursorDrawn.IsEmpty) _copy.Add(_cursorDrawn); // restore the clean desktop under the old cursor
        }

        var mapped = _context.Map(_staging, 0, MapMode.Read, Vortice.Direct3D11.MapFlags.None);
        try
        {
            if (full) CopyRows(mapped, target, new Rectangle(Point.Empty, size));
            else foreach (var r in _copy) CopyRows(mapped, target, r);
        }
        finally { _context.Unmap(_staging, 0); }
        _target = target;

        if (full) dirty.SetAll();
        else foreach (var r in _copy) dirty.Add(r, size);
        _cursorDrawn = drawCursor ? _cursor.Draw(target, bounds, cursor) : Rectangle.Empty;
        _cursorState = cursor;
        if (!_cursorDrawn.IsEmpty) dirty.Add(_cursorDrawn, size);
        return true;
    }

    private bool ReadMetadata(uint total, Size size)
    {
        // Move rects: the destination changed (the source is unchanged).
        uint required;
        int moveCap = (int)Math.Max(_moveBuf.Length, total / (uint)Unsafe.SizeOf<OutduplMoveRect>());
        if (moveCap > _moveBuf.Length) _moveBuf = new OutduplMoveRect[moveCap];
        if (_duplication.GetFrameMoveRects((uint)(_moveBuf.Length * Unsafe.SizeOf<OutduplMoveRect>()), _moveBuf, out required).Failure) return false;
        int moves = (int)(required / (uint)Unsafe.SizeOf<OutduplMoveRect>());
        for (int i = 0; i < moves; i++)
        {
            var d = _moveBuf[i].DestinationRect;
            _copy.Add(Rectangle.FromLTRB(d.Left, d.Top, d.Right, d.Bottom));
        }
        int dirtyCap = (int)Math.Max(_dirtyBuf.Length, total / (uint)Unsafe.SizeOf<RawRect>());
        if (dirtyCap > _dirtyBuf.Length) _dirtyBuf = new RawRect[dirtyCap];
        if (_duplication.GetFrameDirtyRects((uint)(_dirtyBuf.Length * Unsafe.SizeOf<RawRect>()), _dirtyBuf, out required).Failure) return false;
        int dirties = (int)(required / (uint)Unsafe.SizeOf<RawRect>());
        for (int i = 0; i < dirties; i++)
        {
            var d = _dirtyBuf[i];
            _copy.Add(Rectangle.FromLTRB(d.Left, d.Top, d.Right, d.Bottom));
        }
        for (int i = _copy.Count - 1; i >= 0; i--)
        {
            var r = _copy[i];
            r.Intersect(new Rectangle(Point.Empty, size));
            if (r.Width <= 0 || r.Height <= 0) _copy.RemoveAt(i); else _copy[i] = r;
        }
        return true;
    }

    private static unsafe void CopyRows(MappedSubresource mapped, FrameBuffer target, Rectangle r)
    {
        int bytes = r.Width * 4;
        byte* src = (byte*)mapped.DataPointer;
        if (r.X == 0 && r.Width == target.Width && mapped.RowPitch == target.Stride)
        {
            new ReadOnlySpan<byte>(src + (long)r.Y * target.Stride, bytes * r.Height).CopyTo(target.Pixels.AsSpan(r.Y * target.Stride, bytes * r.Height));
            return;
        }
        for (int y = r.Top; y < r.Bottom; y++)
            new ReadOnlySpan<byte>(src + (long)y * mapped.RowPitch + r.X * 4, bytes).CopyTo(target.Pixels.AsSpan(y * target.Stride + r.X * 4, bytes));
    }

    public void Dispose()
    {
        _cursor.Dispose();
        _staging?.Dispose();
        _duplication?.Dispose();
        _context?.Dispose();
        _device?.Dispose();
    }
}
