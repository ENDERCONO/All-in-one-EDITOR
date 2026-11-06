using System.Drawing;
using System.Drawing.Imaging;
using System.Runtime.InteropServices;
using Vortice.Direct3D;
using Vortice.Direct3D11;
using Vortice.DXGI;

namespace GlobalRemoteControl.Agent.Capture;

/// <summary>
/// DXGI Desktop Duplication capture for one output. The latest desktop image is kept in a staging texture, so a
/// "no change" timeout still yields the previous frame. Throws on setup failure (the caller falls back to GDI).
/// </summary>
public sealed class DuplicationCapturer : IDisposable
{
    private readonly ID3D11Device _device;
    private readonly ID3D11DeviceContext _context;
    private readonly IDXGIOutputDuplication _duplication;
    private readonly ID3D11Texture2D _staging;
    private bool _hasFrame;

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

    /// <summary>Returns a new bitmap of the current desktop, or throws if duplication was lost.</summary>
    public Bitmap? Capture(Rectangle bounds, int timeoutMs = 30)
    {
        var result = _duplication.AcquireNextFrame((uint)timeoutMs, out var info, out var resource);
        if (result.Success)
        {
            try
            {
                if (info.LastPresentTime != 0 || !_hasFrame)
                {
                    using var tex = resource!.QueryInterface<ID3D11Texture2D>();
                    _context.CopyResource(_staging, tex);
                    _hasFrame = true;
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
        if (!_hasFrame) return null;

        var bmp = new Bitmap(Width, Height, PixelFormat.Format32bppRgb);
        var mapped = _context.Map(_staging, 0, MapMode.Read, Vortice.Direct3D11.MapFlags.None);
        try
        {
            var data = bmp.LockBits(new Rectangle(0, 0, Width, Height), ImageLockMode.WriteOnly, PixelFormat.Format32bppRgb);
            try
            {
                int rowBytes = Width * 4;
                var row = new byte[rowBytes];
                for (int y = 0; y < Height; y++)
                {
                    Marshal.Copy(mapped.DataPointer + y * (nint)mapped.RowPitch, row, 0, rowBytes);
                    Marshal.Copy(row, 0, data.Scan0 + y * (nint)data.Stride, rowBytes);
                }
            }
            finally { bmp.UnlockBits(data); }
        }
        finally { _context.Unmap(_staging, 0); }

        using (var g = Graphics.FromImage(bmp)) CursorOverlay.Draw(g, bounds);
        return bmp;
    }

    public void Dispose()
    {
        _staging?.Dispose();
        _duplication?.Dispose();
        _context?.Dispose();
        _device?.Dispose();
    }
}
