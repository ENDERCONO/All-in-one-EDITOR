using System.Diagnostics;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using System.Threading.Channels;
using GlobalRemoteControl.Agent.Audit;
using GlobalRemoteControl.Agent.Crypto;
using GlobalRemoteControl.Agent.Session;
using GlobalRemoteControl.Agent.Signaling;
using GlobalRemoteControl.Agent.TrustStore;

namespace GlobalRemoteControl.Agent.Tests;

/// <summary>
/// End to end over real WebSockets (PROTOCOL section 8): the real signaling server (node), the agent's real
/// SignalingClient + pairing / approval / session code, and two browsers (an owner phone and a school PC) driven
/// from here. Nobody answers the PC dialogs — that is the "not at home" case.
/// </summary>
public class OwnerEndToEndTests
{
    private sealed class Server : IDisposable
    {
        private readonly Process _p;
        public string Url { get; }
        public Server()
        {
            var root = Path.GetFullPath(Path.Combine(Path.GetDirectoryName(RepoPaths.WebProtocolJs!)!, "..", ".."));
            var psi = new ProcessStartInfo(NodeRunner.Find()!) { RedirectStandardOutput = true, RedirectStandardInput = true, RedirectStandardError = true, UseShellExecute = false };
            psi.ArgumentList.Add(Path.Combine(AppContext.BaseDirectory, "Fixtures", "start-server.mjs"));
            psi.ArgumentList.Add(root);
            _p = Process.Start(psi)!;
            var line = _p.StandardOutput.ReadLineAsync().WaitAsync(TimeSpan.FromSeconds(20)).GetAwaiter().GetResult();
            if (line == null || !line.StartsWith("PORT ")) throw new InvalidOperationException("server did not start: " + _p.StandardError.ReadToEnd());
            Url = $"ws://127.0.0.1:{line[5..]}/remote/ws";
        }
        public void Dispose() { try { _p.StandardInput.Close(); if (!_p.WaitForExit(3000)) _p.Kill(); } catch (Exception) { } _p.Dispose(); }
    }

    /// <summary>A browser: authenticates like web/signaling.js and queues incoming messages.</summary>
    private sealed class Browser : IAsyncDisposable
    {
        private readonly ClientWebSocket _ws = new();
        private readonly Channel<JsonElement> _in = Channel.CreateUnbounded<JsonElement>();
        private readonly List<JsonElement> _held = new();
        public TestKey Key { get; }
        private Browser(TestKey key) { Key = key; }

        public static async Task<Browser> ConnectAsync(string url, TestKey key)
        {
            var b = new Browser(key);
            await b._ws.ConnectAsync(new Uri(url), CancellationToken.None);
            _ = b.ReadLoop();
            var ch = await b.Next("challenge");
            await b.Send(new { type = "hello", role = "controller", publicKey = key.PublicKeyB64, name = key.Name,
                signature = key.Sign(IdentityUtil.AuthString("controller", ch.GetProperty("nonce").GetString()!)) });
            await b.Next("ready");
            return b;
        }

        private async Task ReadLoop()
        {
            var buf = new byte[70000];
            try
            {
                while (_ws.State == WebSocketState.Open)
                {
                    var r = await _ws.ReceiveAsync(buf, CancellationToken.None);
                    if (r.MessageType == WebSocketMessageType.Close) break;
                    if (r.MessageType == WebSocketMessageType.Text) _in.Writer.TryWrite(Msg.Parse(Encoding.UTF8.GetString(buf, 0, r.Count)));
                }
            }
            catch (Exception) { }
        }

        public Task Send(object o) => _ws.SendAsync(Encoding.UTF8.GetBytes(Json.Serialize(o)), WebSocketMessageType.Text, true, CancellationToken.None);

        public async Task<JsonElement> Next(string type, int ms = 10000)
        {
            var i = _held.FindIndex(m => m.GetProperty("type").GetString() == type);
            if (i >= 0) { var h = _held[i]; _held.RemoveAt(i); return h; }
            using var cts = new CancellationTokenSource(ms);
            while (true)
            {
                var m = await _in.Reader.ReadAsync(cts.Token);
                if (m.GetProperty("type").GetString() == type) return m;
                _held.Add(m);
            }
        }

        public async ValueTask DisposeAsync()
        {
            try { await _ws.CloseAsync(WebSocketCloseStatus.NormalClosure, "", new CancellationTokenSource(1000).Token); } catch (Exception) { }
            _ws.Dispose();
        }
    }

    [NodeFact]
    public async Task AwayFromHome_PhoneGetsACode_AllowsTheSchoolPcOnce_SchoolConnects_PhoneConnectsUnattended()
    {
        using var server = new Server();
        using var dir = new TempDir();
        using var phoneKey = new TestKey("My phone");
        using var schoolKey = new TestKey("School PC");
        using var device = DeviceIdentity.CreateEphemeral();

        // ---- the agent, wired like AgentHost (UI replaced by dialogs nobody answers) ----
        var audit = new AuditLog(dir.File("audit.log"));
        var store = new TrustedControllerStore(dir.File("t.json"));
        store.Add(phoneKey.Id, phoneKey.Name, phoneKey.PublicKeyB64);
        store.SetOwner(phoneKey.Id, true); // done once at home, in the app
        var prompts = new OpenPrompts();
        var gate = new SessionGate();
        using var signal = new SignalingClient(device, () => "Home PC");
        var approvals = new OwnerApprovals(signal, device, store, audit);
        var pairing = new PairingHandler(signal, store, prompts, audit, approvals, device.DeviceId);
        var neg = new SessionNegotiator(signal, device, store, gate, prompts, audit, (_, _) => new SessionNegotiatorTests.FakePeer(), approvals);
        gate.Ended += (info, _) => store.RemoveTemporary(info.ControllerId);
        signal.MessageReceived += (type, m) => _ = type switch
        {
            "pairing-code" => Task.Run(() => pairing.OnPairingCode(m)),
            "pair-request" => pairing.OnPairRequestAsync(m),
            "code-request" => pairing.OnCodeRequestAsync(m),
            "approval-result" => Task.Run(() => approvals.OnResult(m)),
            "session-request" or "session-auth" or "signal" or "session-end" or "relay-start" => neg.HandleAsync(type, m),
            _ => Task.CompletedTask,
        };
        var connected = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        signal.StateChanged += s => { if (s == SignalingState.Connected) connected.TrySetResult(); };
        signal.Start(server.Url);
        await connected.Task.WaitAsync(TimeSpan.FromSeconds(15));

        await using var phone = await Browser.ConnectAsync(server.Url, phoneKey);
        await using var school = await Browser.ConnectAsync(server.Url, schoolKey);

        // 1. the phone asks the PC for a pairing code
        var requestId = Msg.NewId();
        var ts = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        await phone.Send(new { type = "code-request", deviceId = device.DeviceId, requestId, ts,
            signature = phoneKey.Sign(IdentityUtil.CodeRequestString(device.DeviceId, requestId, ts)) });
        var reply = await phone.Next("code-reply");
        var code = reply.GetProperty("code").GetString()!;
        Assert.Matches("^[0-9A-Z]{4}-[0-9A-Z]{4}$", code);

        // 2. the school PC enters it; the phone is asked (and the PC dialog opens too, but nobody is there)
        await school.Send(new { type = "pair", code });
        await school.Next("pair-pending");
        var req = await phone.Next("approval-request");
        var sub = req.GetProperty("subject");
        Assert.Equal(schoolKey.Id, sub.GetProperty("id").GetString());
        Assert.Equal(device.DeviceId, req.GetProperty("deviceId").GetString());
        var approvalId = req.GetProperty("approvalId").GetString()!;
        Assert.True(IdentityUtil.Verify(device.PublicKeyBase64, IdentityUtil.ApprovalRequestString(approvalId, "pair",
            sub.GetProperty("id").GetString()!, sub.GetProperty("fingerprint").GetString()!, req.GetProperty("expiresAt").GetInt64(),
            sub.GetProperty("name").GetString()!), req.GetProperty("signature").GetString()), "the phone can verify who is asking");
        Assert.Equal(1, prompts.PairCalls);

        // 3. "Allow once" from the phone
        await phone.Send(new { type = "approval-result", deviceId = device.DeviceId, approvalId, decision = "once",
            signature = phoneKey.Sign(IdentityUtil.ApproveString(device.DeviceId, approvalId, "pair", "once")) });
        var paired = await school.Next("pair-result");
        Assert.True(paired.GetProperty("approved").GetBoolean());
        Assert.True(paired.GetProperty("temporary").GetBoolean());
        Assert.True(prompts.PairCancelled, "the PC dialog closed itself");

        // 4. the school PC connects: its one session needs no dialog
        await Session(school, schoolKey, device.DeviceId, expectMode: "control");
        Assert.Equal(0, prompts.SessionCalls);
        gate.End(gate.Active!.Key, "stopped");

        // 5. a second session from the school PC is refused: "once" is used up
        var sid2 = Msg.NewId();
        await school.Send(new { type = "session-request", sessionId = sid2, deviceId = device.DeviceId });
        Assert.Equal("not-paired", (await school.Next("session-reject")).GetProperty("reason").GetString());

        // 6. the phone itself connects unattended
        await Session(phone, phoneKey, device.DeviceId, expectMode: "control");
        Assert.Equal(0, prompts.SessionCalls);
        Assert.True(gate.Active!.Owner);

        var log = File.ReadAllText(dir.File("audit.log"));
        Assert.Contains("pair-approved-once", log);
        Assert.Contains("session-auto-approved", log);
    }

    private static async Task Session(Browser b, TestKey key, string deviceId, string expectMode)
    {
        var sid = Msg.NewId();
        await b.Send(new { type = "session-request", sessionId = sid, deviceId });
        var ch = await b.Next("session-challenge");
        await b.Send(new { type = "session-auth", sessionId = sid,
            signature = key.Sign(IdentityUtil.SessionAuthString(sid, ch.GetProperty("nonce").GetString()!, deviceId)) });
        var accept = await b.Next("session-accept");
        Assert.Equal(expectMode, accept.GetProperty("mode").GetString());
    }
}
