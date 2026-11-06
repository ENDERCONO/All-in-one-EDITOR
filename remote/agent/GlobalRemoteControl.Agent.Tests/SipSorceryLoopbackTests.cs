using System.Collections.Concurrent;
using System.Text;
using GlobalRemoteControl.Agent.Capture;
using SIPSorcery.Net;

namespace GlobalRemoteControl.Agent.Tests;

/// <summary>
/// Verifies SIPSorcery data channels work the way the browser contract needs: the offerer (browser role) creates
/// the 4 channels before the offer; the answerer (agent role) receives them, exchanges control JSON and multi-chunk
/// binary video frames.
/// </summary>
public class SipSorceryLoopbackTests
{
    [Fact(Timeout = 60000)]
    public async Task FourChannels_ControlJson_And_MultiChunkVideo()
    {
        var offerer = new RTCPeerConnection(new RTCConfiguration());
        var answerer = new RTCPeerConnection(new RTCConfiguration());
        try
        {
            var control = await offerer.createDataChannel("control", new RTCDataChannelInit { ordered = true });
            var video = await offerer.createDataChannel("video", new RTCDataChannelInit { ordered = true });
            var audio = await offerer.createDataChannel("audio", new RTCDataChannelInit { ordered = false, maxRetransmits = 0 });
            var file = await offerer.createDataChannel("file", new RTCDataChannelInit { ordered = true });

            var answererChannels = new ConcurrentDictionary<string, RTCDataChannel>();
            var allArrived = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            var controlFromOfferer = new TaskCompletionSource<string>(TaskCreationOptions.RunContinuationsAsynchronously);
            answerer.ondatachannel += dc =>
            {
                answererChannels[dc.label] = dc;
                if (dc.label == "control")
                    dc.onmessage += (_, _, data) => controlFromOfferer.TrySetResult(Encoding.UTF8.GetString(data));
                if (answererChannels.Count == 4) allArrived.TrySetResult();
            };

            offerer.onicecandidate += c => { if (c != null) answerer.addIceCandidate(new RTCIceCandidateInit { candidate = c.candidate, sdpMid = c.sdpMid, sdpMLineIndex = c.sdpMLineIndex }); };
            answerer.onicecandidate += c => { if (c != null) offerer.addIceCandidate(new RTCIceCandidateInit { candidate = c.candidate, sdpMid = c.sdpMid, sdpMLineIndex = c.sdpMLineIndex }); };

            var offer = offerer.createOffer(null);
            Assert.Contains("m=application", offer.sdp);
            await offerer.setLocalDescription(offer);
            Assert.Equal(SetDescriptionResultEnum.OK, answerer.setRemoteDescription(new RTCSessionDescriptionInit { type = RTCSdpType.offer, sdp = offer.sdp }));
            var answer = answerer.createAnswer(null);
            await answerer.setLocalDescription(answer);
            Assert.Equal(SetDescriptionResultEnum.OK, offerer.setRemoteDescription(new RTCSessionDescriptionInit { type = RTCSdpType.answer, sdp = answer.sdp }));

            await allArrived.Task.WaitAsync(TimeSpan.FromSeconds(30));
            // Note: SIPSorcery 10.0.17 does not surface the remote DCEP reliability flags (ordered:false,
            // maxRetransmits:0) on the answerer's RTCDataChannel object; the agent only needs the label.
            Assert.Equal(new[] { "audio", "control", "file", "video" }, answererChannels.Keys.OrderBy(k => k).ToArray());

            // control JSON offerer -> answerer
            await WaitOpen(control);
            control.send("{\"t\":\"quality\",\"fps\":15,\"quality\":70,\"scale\":1}");
            Assert.Contains("\"quality\"", await controlFromOfferer.Task.WaitAsync(TimeSpan.FromSeconds(10)));

            // control JSON answerer -> offerer
            var helloAtOfferer = new TaskCompletionSource<string>(TaskCreationOptions.RunContinuationsAsynchronously);
            control.onmessage += (_, _, data) => helloAtOfferer.TrySetResult(Encoding.UTF8.GetString(data));
            answererChannels["control"].send("{\"t\":\"hello\",\"mode\":\"view\"}");
            Assert.Contains("hello", await helloAtOfferer.Task.WaitAsync(TimeSpan.FromSeconds(10)));

            // multi-chunk binary video frames answerer -> offerer
            var reassembler = new FrameReassembler();
            var frames = new ConcurrentQueue<(uint, byte[])>();
            var gotFrames = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            video.onmessage += (_, _, data) =>
            {
                var f = reassembler.Add(data);
                if (f != null) { frames.Enqueue(f.Value); if (frames.Count == 3) gotFrames.TrySetResult(); }
            };
            var rnd = new Random(42);
            var sent = new List<byte[]>();
            var avideo = answererChannels["video"];
            for (uint id = 1; id <= 3; id++)
            {
                var frame = new byte[150_000 + (int)id * 1234];
                rnd.NextBytes(frame);
                sent.Add(frame);
                foreach (var chunk in FrameChunker.Split(id, frame)) avideo.send(chunk, 0, chunk.Length);
            }
            await gotFrames.Task.WaitAsync(TimeSpan.FromSeconds(30));
            var got = frames.ToArray();
            for (int i = 0; i < 3; i++)
            {
                Assert.Equal((uint)(i + 1), got[i].Item1);
                Assert.Equal(sent[i], got[i].Item2);
            }

            // audio channel (unordered, no retransmit) carries a 960-byte packet
            var audioGot = new TaskCompletionSource<int>(TaskCreationOptions.RunContinuationsAsynchronously);
            audio.onmessage += (_, _, data) => audioGot.TrySetResult(data.Length);
            var pcm = new byte[960];
            answererChannels["audio"].send(pcm, 0, pcm.Length);
            Assert.Equal(960, await audioGot.Task.WaitAsync(TimeSpan.FromSeconds(10)));
        }
        finally
        {
            offerer.close();
            answerer.close();
        }
    }

    private static async Task WaitOpen(RTCDataChannel dc)
    {
        for (int i = 0; i < 200 && dc.readyState != RTCDataChannelState.open; i++) await Task.Delay(50);
        Assert.Equal(RTCDataChannelState.open, dc.readyState);
    }
}
