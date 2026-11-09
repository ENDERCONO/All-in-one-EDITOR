using GlobalRemoteControl.Agent.Capture;
using GlobalRemoteControl.Agent.Session;

namespace GlobalRemoteControl.Agent.Tests;

/// <summary>Paced RTP sender for the GPU video track: RFC 6184 packetization, pacing, NACK resends, overflow.</summary>
public class RtpVideoSenderTests
{
    private sealed record Sent(byte[] Payload, uint Ts, bool Marker, ushort Seq);

    private static (RtpVideoSender S, List<Sent> Out) Make()
    {
        var list = new List<Sent>();
        var s = new RtpVideoSender((p, ts, m, seq) => { lock (list) list.Add(new Sent(p, ts, m, seq)); }, startThread: false);
        return (s, list);
    }

    private static byte[] Nal(byte header, int length)
    {
        var b = new byte[length];
        b[0] = header;
        for (int i = 1; i < length; i++) b[i] = (byte)(i % 251 + 1); // no zero bytes: no fake start codes
        return b;
    }

    private static byte[] Au(params byte[][] nals)
    {
        var ms = new MemoryStream();
        foreach (var n in nals) { ms.Write(new byte[] { 0, 0, 0, 1 }); ms.Write(n); }
        return ms.ToArray();
    }

    private static void DrainAll(RtpVideoSender s)
    {
        var sw = System.Diagnostics.Stopwatch.StartNew();
        while (sw.ElapsedMilliseconds < 5000 && s.Pump() is { } wait) Thread.Sleep(wait);
    }

    [Fact]
    public void Packetize_SmallNalsAlone_BigNalAsFuA_AudDropped()
    {
        var sps = Nal(0x67, 10);
        var pps = Nal(0x68, 4);
        var idr = Nal(0x65, 3000);
        var aud = new byte[] { 0x09, 0xF0 };
        var pkts = RtpVideoSender.Packetize(Au(aud, sps, pps, idr));

        Assert.Equal(sps, pkts[0]);
        Assert.Equal(pps, pkts[1]);
        var fu = pkts.Skip(2).ToList();
        Assert.True(fu.Count >= 3);
        Assert.All(fu, p => Assert.True(p.Length <= RtpVideoSender.MaxPayload));
        Assert.All(fu, p => Assert.Equal(0x60 | 28, p[0]));            // FU indicator keeps NRI (0x60) of the IDR
        Assert.Equal(0x80 | 5, fu[0][1]);                                 // start bit + type 5
        Assert.Equal(0x40 | 5, fu[^1][1]);                                // end bit
        Assert.All(fu.Skip(1).SkipLast(1), p => Assert.Equal(5, p[1]));
        // reassembling gives back the NAL exactly
        var re = new List<byte> { idr[0] };
        foreach (var p in fu) re.AddRange(p.Skip(2));
        Assert.Equal(idr, re.ToArray());
    }

    [Fact]
    public void Nals_ThreeAndFourByteStartCodes()
    {
        var au = new byte[] { 0, 0, 1, 0x67, 1, 2, 0, 0, 0, 1, 0x68, 3, 0, 0, 1, 0x65, 4, 5 };
        var nals = RtpVideoSender.Nals(au);
        Assert.Equal(new[] { (3, 3), (10, 2), (15, 3) }, nals);
    }

    [Fact]
    public void Send_MarkerOnLastPacket_SequenceAndTimestampAdvance()
    {
        var (s, sent) = Make();
        s.SetBitrate(50_000_000);
        s.Send(3000, Au(Nal(0x67, 10), Nal(0x65, 2500)));
        s.Send(1500, Au(Nal(0x41, 40)));
        DrainAll(s);

        Assert.Equal(5, sent.Count); // SPS + 3 FU-A + P
        for (int i = 1; i < sent.Count; i++) Assert.Equal((ushort)(sent[0].Seq + i), sent[i].Seq);
        Assert.Equal(new[] { false, false, false, true, true }, sent.Select(x => x.Marker));
        Assert.All(sent.Take(4), x => Assert.Equal(sent[0].Ts, x.Ts));
        Assert.Equal(sent[0].Ts + 1500, sent[4].Ts);
    }

    [Fact]
    public void Pacing_BigFrameDoesNotLeaveAtOnce()
    {
        var (s, sent) = Make();
        s.SetBitrate(10_000_000); // paced at 25 Mbit/s → about 6 KB per 2 ms burst
        s.Send(3000, Au(Nal(0x65, 200_000)));
        var wait = s.Pump();
        Assert.NotNull(wait);                      // more to send later
        Assert.InRange(sent.Count, 1, 20);         // only a small burst went now
        Assert.True(s.Backlog > TimeSpan.Zero);
        DrainAll(s);
        Assert.True(sent.Count > 150);
        Assert.Equal(TimeSpan.Zero, s.Backlog);
        Assert.Null(s.Pump());
    }

    [Fact]
    public void BigFrame_AtLowBitrate_StillDrainsWithinTarget()
    {
        var (s, sent) = Make();
        s.SetBitrate(500_000); // minimum pacing rate; a 300 KB keyframe would take 600 ms at that rate
        s.Send(3000, Au(Nal(0x65, 300_000)));
        var sw = System.Diagnostics.Stopwatch.StartNew();
        DrainAll(s);
        Assert.True(sw.Elapsed < RtpVideoSender.DrainTarget * 3, $"took {sw.ElapsedMilliseconds} ms");
    }

    [Fact]
    public void Nack_ResendsLostPackets_SameSequence_AheadOfNewVideo_Once()
    {
        var (s, sent) = Make();
        s.SetBitrate(50_000_000);
        s.Send(3000, Au(Nal(0x65, 5000))); // 5 packets
        DrainAll(s);
        var first = sent.ToList();
        Thread.Sleep(RtpVideoSender.MinResendGap + TimeSpan.FromMilliseconds(10));

        // lost: seq0+1 (pid) and seq0+3 (bit 1 of blp)
        ushort pid = (ushort)(first[0].Seq + 1);
        s.Send(3000, Au(Nal(0x41, 50)));     // new video queued before the NACK arrives
        Assert.Equal(2, s.OnNack(pid, 0b10));
        Assert.Equal(0, s.OnNack(pid, 0b10)); // already waiting: not twice
        sent.Clear();
        DrainAll(s);
        Assert.Equal(new[] { first[1].Seq, first[3].Seq }, sent.Take(2).Select(x => x.Seq)); // repairs first
        Assert.Equal(first[1].Payload, sent[0].Payload);
        Assert.Equal(first[1].Ts, sent[0].Ts);
        Assert.Equal(2, s.PacketsResent);

        // right after a resend, another NACK for the same packet is ignored (it's probably still in flight)
        Assert.Equal(0, s.OnNack(pid, 0));
        // unknown / too old sequence numbers are ignored
        Assert.Equal(0, s.OnNack((ushort)(first[0].Seq + 5000), 0));
    }

    [Fact]
    public void Nack_ForPacketGoneFromHistory_AsksForKeyframe_RateLimited()
    {
        // regression (frozen picture): SIPSorcery drops a PLI that shares an RTCP packet with a NACK, so a NACK the
        // sender can't serve must itself ask for an IDR, or the browser's decoder waits for the 20 s safety keyframe
        var (s, sent) = Make();
        int keys = 0;
        s.KeyframeNeeded += () => keys++;
        s.SetBitrate(50_000_000);
        var p = Au(Nal(0x41, 1000)); // one packet per access unit
        for (int i = 0; i < RtpVideoSender.HistorySize + 10; i++) { s.Send(3000, p); DrainAll(s); }
        ushort first = sent[0].Seq;
        Assert.Equal(0, s.OnNack(first, 0));        // overwritten in the history: can't be resent...
        Assert.Equal(1, keys);                      // ...so a keyframe is requested
        Assert.Equal(0, s.OnNack(first, 0));
        Assert.Equal(1, keys);                      // not again within KeyframeRequestGap
        Assert.Equal(0, s.OnNack((ushort)(first + RtpVideoSender.HistorySize + 3000), 0)); // never sent: ignored
        Thread.Sleep(RtpVideoSender.KeyframeRequestGap + TimeSpan.FromMilliseconds(20));
        Assert.Equal(0, s.OnNack((ushort)(first + RtpVideoSender.HistorySize + 3000), 0));
        Assert.Equal(1, keys);
        s.OnNack(first, 0);
        Assert.Equal(2, keys);
    }

    [Fact]
    public void Nack_ThatResendsDontRepair_AsksForKeyframe()
    {
        var (s, sent) = Make();
        int keys = 0;
        s.KeyframeNeeded += () => keys++;
        s.SetBitrate(50_000_000);
        s.Send(3000, Au(Nal(0x41, 1000)));
        DrainAll(s);
        ushort seq = sent[0].Seq;
        for (int i = 0; i < RtpVideoSender.MaxResends; i++)
        {
            Thread.Sleep(RtpVideoSender.MinResendGap + TimeSpan.FromMilliseconds(10));
            Assert.Equal(1, s.OnNack(seq, 0));
            DrainAll(s);
        }
        Assert.Equal(0, keys);
        Thread.Sleep(RtpVideoSender.MinResendGap + TimeSpan.FromMilliseconds(10));
        Assert.Equal(0, s.OnNack(seq, 0)); // still lost after MaxResends: stop resending, ask for an IDR
        Assert.Equal(1, keys);
    }

    [Fact]
    public void StalledLink_DropsQueue_AsksForKeyframe_AndWaitsForOne()
    {
        var (s, sent) = Make();
        int overflows = 0;
        s.Overflow += () => overflows++;
        s.SetBitrate(1_000_000); // 4 Mbit/s pacing: 400 ms ≈ 200 KB
        var p = Au(Nal(0x41, 60_000));
        for (int i = 0; i < 4; i++) s.Send(3000, p); // never pumped: 240 KB queued
        Assert.Equal(0, overflows);
        s.Send(3000, p);                                // queue is over the limit → dropped
        Assert.Equal(1, overflows);
        Assert.Equal(TimeSpan.Zero, s.Backlog);         // the P-frame after the gap is refused too
        s.Send(3000, Au(Nal(0x41, 100)));
        Assert.Equal(TimeSpan.Zero, s.Backlog);
        s.Send(3000, Au(Nal(0x67, 10), Nal(0x65, 100))); // a keyframe is accepted
        Assert.True(s.Backlog > TimeSpan.Zero);
        DrainAll(s);
        Assert.Equal(0x67, sent[0].Payload[0]);
    }

    [Fact]
    public void Sdp_GetsNackPliFir_Once()
    {
        var sdp = "v=0\r\nm=video 9 UDP/TLS/RTP/SAVP 96\r\na=rtpmap:96 H264/90000\r\na=rtcp-fb:96 transport-cc\r\n";
        var once = RemoteSession.WithVideoFeedback(sdp, 96);
        var lines = once.Split("\r\n");
        int map = Array.IndexOf(lines, "a=rtpmap:96 H264/90000");
        Assert.Equal(new[] { "a=rtcp-fb:96 nack", "a=rtcp-fb:96 nack pli", "a=rtcp-fb:96 ccm fir" }, lines.Skip(map + 1).Take(3));
        Assert.Equal(once, RemoteSession.WithVideoFeedback(once, 96));
        Assert.Equal("v=0\nm=application 9\n", RemoteSession.WithVideoFeedback("v=0\nm=application 9\n", 96));
    }
}
