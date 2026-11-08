using System.Runtime.InteropServices;
using GlobalRemoteControl.Agent.Session;
using static GlobalRemoteControl.Agent.Native.NativeMethods;

namespace GlobalRemoteControl.Agent.Input;

/// <summary>Injects input with SendInput. Only ever called through <see cref="InputController"/> (which gates it).</summary>
public sealed class SendInputSink : IInputSink
{
    private static readonly int Size = Marshal.SizeOf<INPUT>();

    public void MoveAbsolute(int nx, int ny) =>
        SendMouse(nx, ny, 0, MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK);

    // No MOUSEEVENTF_ABSOLUTE: games reading raw input (WM_INPUT / DirectInput) see these as real mouse motion.
    public void MoveRelative(int dx, int dy) => SendMouse(dx, dy, 0, MOUSEEVENTF_MOVE);

    public void Button(MouseButton button, bool down)
    {
        uint flag = button switch
        {
            MouseButton.Left => down ? MOUSEEVENTF_LEFTDOWN : MOUSEEVENTF_LEFTUP,
            MouseButton.Right => down ? MOUSEEVENTF_RIGHTDOWN : MOUSEEVENTF_RIGHTUP,
            _ => down ? MOUSEEVENTF_MIDDLEDOWN : MOUSEEVENTF_MIDDLEUP,
        };
        SendMouse(0, 0, 0, flag);
    }

    public void Wheel(int dx, int dy)
    {
        if (dy != 0) SendMouse(0, 0, unchecked((uint)dy), MOUSEEVENTF_WHEEL);
        if (dx != 0) SendMouse(0, 0, unchecked((uint)dx), MOUSEEVENTF_HWHEEL);
    }

    public void Key(KeyInfo key, bool down)
    {
        uint flags = down ? 0 : KEYEVENTF_KEYUP;
        if (key.Extended) flags |= KEYEVENTF_EXTENDEDKEY;
        ushort vk = key.Vk;
        if (key.Scan != 0) { flags |= KEYEVENTF_SCANCODE; vk = 0; }
        Send(new INPUT { type = INPUT_KEYBOARD, u = new InputUnion { ki = new KEYBDINPUT { wVk = vk, wScan = key.Scan, dwFlags = flags } } });
    }

    public void UnicodeChar(char c, bool down) =>
        Send(new INPUT
        {
            type = INPUT_KEYBOARD,
            u = new InputUnion { ki = new KEYBDINPUT { wVk = 0, wScan = c, dwFlags = KEYEVENTF_UNICODE | (down ? 0 : KEYEVENTF_KEYUP) } },
        });

    private static void SendMouse(int dx, int dy, uint data, uint flags) =>
        Send(new INPUT { type = INPUT_MOUSE, u = new InputUnion { mi = new MOUSEINPUT { dx = dx, dy = dy, mouseData = data, dwFlags = flags } } });

    private static void Send(INPUT input) => SendInput(1, new[] { input }, Size);
}
