using System.Drawing;
using static GlobalRemoteControl.Agent.Native.NativeMethods;

namespace GlobalRemoteControl.Agent.Capture;

public sealed record MonitorInfo(int Index, string Name, string DeviceName, Rectangle Bounds, bool Primary)
{
    public object ToJson() => new { index = Index, name = Name, x = Bounds.X, y = Bounds.Y, width = Bounds.Width, height = Bounds.Height, primary = Primary };
}

/// <summary>Monitor enumeration (physical pixels; the process is per-monitor DPI aware).</summary>
public static class Monitors
{
    public static IReadOnlyList<MonitorInfo> Enumerate()
    {
        var screens = Screen.AllScreens;
        var list = new List<MonitorInfo>(screens.Length);
        for (int i = 0; i < screens.Length; i++)
        {
            var s = screens[i];
            var friendly = $"Display {i + 1}{(s.Primary ? " (primary)" : "")} {s.Bounds.Width}x{s.Bounds.Height}";
            list.Add(new MonitorInfo(i, friendly, s.DeviceName, s.Bounds, s.Primary));
        }
        return list;
    }

    public static int PrimaryIndex(IReadOnlyList<MonitorInfo> monitors) =>
        monitors.FirstOrDefault(m => m.Primary)?.Index ?? 0;

    public static Rectangle VirtualScreen() => new(
        GetSystemMetrics(SM_XVIRTUALSCREEN), GetSystemMetrics(SM_YVIRTUALSCREEN),
        GetSystemMetrics(SM_CXVIRTUALSCREEN), GetSystemMetrics(SM_CYVIRTUALSCREEN));
}
