using System.Drawing;
using System.Drawing.Imaging;
using SkiaSharp;

namespace GlobalRemoteControl.Agent.Capture;

/// <summary>Encodes one rectangle of a BGRA frame buffer as a JPEG. Implementations are thread-safe.</summary>
public interface IRectEncoder
{
    string Name { get; }
    byte[] Encode(FrameBuffer src, Rectangle r, int quality);
}

public static class JpegEncoder
{
    private static readonly Lazy<IRectEncoder> _default = new(Create);

    /// <summary>libjpeg-turbo through SkiaSharp when its native library loads, else System.Drawing (GDI+).</summary>
    public static IRectEncoder Default => _default.Value;

    private static IRectEncoder Create()
    {
        try
        {
            var skia = new SkiaJpegEncoder();
            var probe = new FrameBuffer(16, 16);
            if (skia.Encode(probe, new Rectangle(0, 0, 16, 16), 50).Length > 0) return skia;
        }
        catch (Exception) { /* native libSkiaSharp missing or failed to load */ }
        return new GdiPlusJpegEncoder();
    }
}

/// <summary>SkiaSharp (bundles libjpeg-turbo). Reads the pixels in place; no copy.</summary>
public sealed class SkiaJpegEncoder : IRectEncoder
{
    public string Name => "skia";

    public byte[] Encode(FrameBuffer src, Rectangle r, int quality)
    {
        quality = Math.Clamp(quality, 10, 95);
        var info = new SKImageInfo(r.Width, r.Height, SKColorType.Bgra8888, SKAlphaType.Opaque);
        var ptr = src.Pointer + r.Y * src.Stride + r.X * 4;
        using var pixmap = new SKPixmap(info, ptr, src.Stride);
        // 4:2:0 chroma is much smaller; at high quality keep full chroma so coloured text stays crisp.
        var opts = new SKJpegEncoderOptions(quality,
            quality >= 85 ? SKJpegEncoderDownsample.Downsample444 : SKJpegEncoderDownsample.Downsample420,
            SKJpegEncoderAlphaOption.Ignore);
        using var data = pixmap.Encode(opts) ?? throw new InvalidOperationException("Skia JPEG encode failed");
        return data.ToArray();
    }
}

/// <summary>Fallback: GDI+ JPEG over a Bitmap that wraps the buffer (no pixel copy).</summary>
public sealed class GdiPlusJpegEncoder : IRectEncoder
{
    private static readonly ImageCodecInfo Codec = ImageCodecInfo.GetImageEncoders().First(c => c.FormatID == ImageFormat.Jpeg.Guid);

    public string Name => "gdiplus";

    public byte[] Encode(FrameBuffer src, Rectangle r, int quality)
    {
        var ptr = src.Pointer + r.Y * src.Stride + r.X * 4;
        using var bmp = new Bitmap(r.Width, r.Height, src.Stride, PixelFormat.Format32bppRgb, ptr);
        using var ms = new MemoryStream();
        using var p = new EncoderParameters(1);
        p.Param[0] = new EncoderParameter(System.Drawing.Imaging.Encoder.Quality, (long)Math.Clamp(quality, 10, 95));
        bmp.Save(ms, Codec, p);
        return ms.ToArray();
    }
}
