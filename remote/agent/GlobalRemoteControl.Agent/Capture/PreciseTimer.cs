using Microsoft.Win32.SafeHandles;
using static GlobalRemoteControl.Agent.Native.NativeMethods;

namespace GlobalRemoteControl.Agent.Capture;

/// <summary>
/// Sub-millisecond sleeps for frame pacing without changing the system timer resolution: a high-resolution waitable
/// timer (Windows 10 1803+), falling back to a normal wait (≈15 ms granularity) when unavailable.
/// </summary>
public sealed class PreciseTimer : IDisposable
{
    private sealed class TimerHandle : WaitHandle
    {
        public TimerHandle(IntPtr h) => SafeWaitHandle = new SafeWaitHandle(h, ownsHandle: true);
    }

    private readonly TimerHandle? _timer;

    public PreciseTimer()
    {
        try
        {
            var h = CreateWaitableTimerExW(IntPtr.Zero, null, CREATE_WAITABLE_TIMER_HIGH_RESOLUTION, TIMER_ALL_ACCESS);
            if (h != IntPtr.Zero) _timer = new TimerHandle(h);
        }
        catch (Exception) { _timer = null; }
    }

    public bool IsHighResolution => _timer != null;

    /// <summary>Waits <paramref name="delay"/>; returns false if <paramref name="ct"/> was cancelled.</summary>
    public bool Wait(TimeSpan delay, CancellationToken ct)
    {
        if (delay <= TimeSpan.Zero) return !ct.IsCancellationRequested;
        if (_timer != null)
        {
            long due = -delay.Ticks; // relative, 100 ns units
            if (SetWaitableTimer(_timer.SafeWaitHandle.DangerousGetHandle(), ref due, 0, IntPtr.Zero, IntPtr.Zero, false))
                return WaitHandle.WaitAny(new[] { _timer, ct.WaitHandle }) == 0;
        }
        return !ct.WaitHandle.WaitOne(delay);
    }

    public void Dispose() => _timer?.Dispose();
}
