using System.Drawing;

namespace GlobalRemoteControl.Agent.Capture;

/// <summary>
/// Integer box-filter downscaler for BGRA buffers: each destination pixel is the average of the whole source pixels
/// in its footprint. Every destination pixel depends only on its own footprint, so a sub-rectangle can be rescaled
/// alone (for dirty regions) and gives exactly the same pixels as a full rescale — which keeps the tile diff honest.
/// </summary>
public sealed class BoxScaler
{
    private int _srcW, _srcH, _dstW, _dstH;
    private int[] _xs = Array.Empty<int>(), _xc = Array.Empty<int>(), _ys = Array.Empty<int>(), _yc = Array.Empty<int>();
    private readonly int[] _recip = new int[257]; // 65536 / n for footprints up to 16x16 pixels

    public BoxScaler()
    {
        for (int n = 1; n < _recip.Length; n++) _recip[n] = 65536 / n;
    }

    public int DstWidth => _dstW;
    public int DstHeight => _dstH;

    private void Prepare(int srcW, int srcH, int dstW, int dstH)
    {
        if (srcW == _srcW && srcH == _srcH && dstW == _dstW && dstH == _dstH) return;
        if (dstW > srcW || dstH > srcH || srcW > dstW * 16 || srcH > dstH * 16)
            throw new ArgumentException("BoxScaler only downscales by 1..16x");
        (_xs, _xc) = Table(srcW, dstW);
        (_ys, _yc) = Table(srcH, dstH);
        _srcW = srcW; _srcH = srcH; _dstW = dstW; _dstH = dstH;
    }

    private static (int[] Start, int[] Count) Table(int src, int dst)
    {
        var start = new int[dst];
        var count = new int[dst];
        for (int d = 0; d < dst; d++)
        {
            int a = (int)((long)d * src / dst);
            int b = (int)((long)(d + 1) * src / dst);
            start[d] = a;
            count[d] = Math.Max(1, b - a);
        }
        return (start, count);
    }

    /// <summary>Rescales the whole frame.</summary>
    public void Scale(FrameBuffer src, FrameBuffer dst) => ScaleRect(src, dst, new Rectangle(0, 0, dst.Width, dst.Height));

    /// <summary>Rescales only <paramref name="dstRect"/> of the destination (in destination pixels).</summary>
    public void ScaleRect(FrameBuffer src, FrameBuffer dst, Rectangle dstRect)
    {
        Prepare(src.Width, src.Height, dst.Width, dst.Height);
        dstRect.Intersect(new Rectangle(0, 0, dst.Width, dst.Height));
        if (dstRect.Width <= 0 || dstRect.Height <= 0) return;
        if ((long)dstRect.Width * dstRect.Height >= 64 * 1024)
        {
            int bands = Math.Min(Environment.ProcessorCount, Math.Max(1, dstRect.Height / 16));
            Parallel.For(0, bands, i =>
            {
                int y0 = dstRect.Top + dstRect.Height * i / bands, y1 = dstRect.Top + dstRect.Height * (i + 1) / bands;
                Rows(src, dst, dstRect.Left, dstRect.Right, y0, y1);
            });
        }
        else Rows(src, dst, dstRect.Left, dstRect.Right, dstRect.Top, dstRect.Bottom);
    }

    /// <summary>Destination rectangle that covers every destination pixel whose footprint touches <paramref name="srcRect"/>.</summary>
    public static Rectangle MapToDst(Rectangle srcRect, int srcW, int srcH, int dstW, int dstH)
    {
        int x0 = (int)((long)srcRect.Left * dstW / srcW) - 1, x1 = (int)(((long)srcRect.Right * dstW + srcW - 1) / srcW) + 1;
        int y0 = (int)((long)srcRect.Top * dstH / srcH) - 1, y1 = (int)(((long)srcRect.Bottom * dstH + srcH - 1) / srcH) + 1;
        var r = Rectangle.FromLTRB(Math.Max(0, x0), Math.Max(0, y0), Math.Min(dstW, x1), Math.Min(dstH, y1));
        return r.Width > 0 && r.Height > 0 ? r : Rectangle.Empty;
    }

    private unsafe void Rows(FrameBuffer src, FrameBuffer dst, int dx0, int dx1, int dy0, int dy1)
    {
        int sStride = src.Stride, dStride = dst.Stride;
        fixed (byte* sBase = src.Pixels)
        fixed (byte* dBase = dst.Pixels)
        fixed (int* xs = _xs, xc = _xc)
        {
            for (int dy = dy0; dy < dy1; dy++)
            {
                int sy = _ys[dy], cy = _yc[dy];
                byte* dRow = dBase + (long)dy * dStride;
                for (int dx = dx0; dx < dx1; dx++)
                {
                    int sx = xs[dx], cx = xc[dx];
                    uint b = 0, g = 0, r = 0;
                    byte* p = sBase + (long)sy * sStride + sx * 4;
                    for (int j = 0; j < cy; j++, p += sStride)
                    {
                        byte* q = p;
                        for (int i = 0; i < cx; i++, q += 4) { b += q[0]; g += q[1]; r += q[2]; }
                    }
                    int n = cx * cy;
                    byte* o = dRow + dx * 4;
                    if (n == 1) { o[0] = (byte)b; o[1] = (byte)g; o[2] = (byte)r; }
                    else
                    {
                        uint m = (uint)_recip[n];
                        o[0] = (byte)((b * m + 32768) >> 16); o[1] = (byte)((g * m + 32768) >> 16); o[2] = (byte)((r * m + 32768) >> 16);
                    }
                    o[3] = 255;
                }
            }
        }
    }
}
