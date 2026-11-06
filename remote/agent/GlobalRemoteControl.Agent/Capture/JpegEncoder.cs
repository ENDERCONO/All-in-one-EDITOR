using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;

namespace GlobalRemoteControl.Agent.Capture;

public static class JpegEncoder
{
    private static readonly ImageCodecInfo Codec = ImageCodecInfo.GetImageEncoders().First(c => c.FormatID == ImageFormat.Jpeg.Guid);

    /// <summary>Scales by <paramref name="scale"/> (0.25..1) and/or down to <paramref name="maxWidth"/>, then JPEG-encodes.</summary>
    public static byte[] Encode(Bitmap source, int quality, double scale = 1, int? maxWidth = null)
    {
        var (w, h) = TargetSize(source.Width, source.Height, scale, maxWidth);
        using var ms = new MemoryStream();
        using var p = new EncoderParameters(1);
        p.Param[0] = new EncoderParameter(Encoder.Quality, (long)Math.Clamp(quality, 10, 95));
        if (w == source.Width && h == source.Height)
        {
            source.Save(ms, Codec, p);
        }
        else
        {
            using var scaled = new Bitmap(w, h, PixelFormat.Format24bppRgb);
            using (var g = Graphics.FromImage(scaled))
            {
                g.InterpolationMode = InterpolationMode.Bilinear;
                g.PixelOffsetMode = PixelOffsetMode.HighSpeed;
                g.CompositingMode = CompositingMode.SourceCopy;
                g.DrawImage(source, new Rectangle(0, 0, w, h));
            }
            scaled.Save(ms, Codec, p);
        }
        return ms.ToArray();
    }

    public static (int W, int H) TargetSize(int width, int height, double scale, int? maxWidth)
    {
        scale = Math.Clamp(scale, 0.05, 1);
        if (maxWidth is > 0 && width * scale > maxWidth.Value) scale = maxWidth.Value / (double)width;
        return (Math.Max(1, (int)Math.Round(width * scale)), Math.Max(1, (int)Math.Round(height * scale)));
    }
}
