using GlobalRemoteControl.Agent.Session;

namespace GlobalRemoteControl.Agent.Input;

/// <summary>Low-level injection target. The real one is <see cref="SendInputSink"/>; tests use a recorder.</summary>
public interface IInputSink
{
    /// <summary>Absolute move on the virtual desktop, coordinates normalised to 0..65535.</summary>
    void MoveAbsolute(int nx, int ny);
    /// <summary>Relative move in pixels (raw motion games read for the camera). Never absolute.</summary>
    void MoveRelative(int dx, int dy);
    void Button(MouseButton button, bool down);
    /// <summary>Wheel delta in Windows units (120 = one notch). dy &gt; 0 scrolls up, dx &gt; 0 scrolls right.</summary>
    void Wheel(int dx, int dy);
    void Key(KeyInfo key, bool down);
    void UnicodeChar(char c, bool down);
}
