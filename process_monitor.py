import psutil
import sys
import os
import time
import wave
import struct
import tempfile
import atexit
import ctypes
import ctypes.wintypes
import threading
import uuid
from pathlib import Path
from pynput import keyboard as pkeyboard

# When built with `pyinstaller --windowed`, there's no console, so
# sys.stdout/sys.stderr are None — and any print() would crash with
# "AttributeError: 'NoneType' object has no attribute 'write'".
# Redirect them to a no-op so the script can still run silently.
if sys.stdout is None:
    sys.stdout = open(os.devnull, 'w')
if sys.stderr is None:
    sys.stderr = open(os.devnull, 'w')

SFX_PATH = Path(r"C:\Users\Usuario\Documents\Unreal Projects\HorrorMC\All-in-one-EDITOR\sfx\ShootDel.wav")
POLL_INTERVAL = 1.0

# Volume 0-100 from CLI arg, default 70
try:
    VOLUME = max(0, min(100, int(sys.argv[1])))
except (IndexError, ValueError):
    VOLUME = 70

# ── WAV volume scaling ────────────────────────────────────────────────────────
# Bake volume into a temp WAV file once at startup so MCI just plays it as-is.
_sfx_path: str = str(SFX_PATH)

def _prepare_sfx() -> bool:
    global _sfx_path
    if not SFX_PATH.is_file():
        print(f"[ERROR] SFX not found: {SFX_PATH}")
        return False
    if VOLUME == 100:
        return True
    vol = VOLUME / 100.0
    with wave.open(str(SFX_PATH), 'rb') as wf:
        params = wf.getparams()
        frames = wf.readframes(wf.getnframes())
    sw = params.sampwidth
    if sw == 2:
        count = len(frames) // 2
        samples = struct.unpack(f"{count}h", frames)
        scaled = struct.pack(f"{count}h", *(max(-32768, min(32767, int(s * vol))) for s in samples))
    elif sw == 1:
        samples = struct.unpack(f"{len(frames)}B", frames)
        scaled = struct.pack(f"{len(frames)}B", *(max(0, min(255, int((s - 128) * vol + 128))) for s in samples))
    else:
        scaled = frames
    tmp = tempfile.NamedTemporaryFile(suffix='.wav', delete=False)
    tmp.close()
    with wave.open(tmp.name, 'wb') as wf:
        wf.setparams(params)
        wf.writeframes(scaled)
    _sfx_path = tmp.name
    atexit.register(lambda: Path(tmp.name).unlink(missing_ok=True))
    return True

# ── Polyphonic audio via Windows MCI ──────────────────────────────────────────
# Each call opens its own MCI device with a unique alias so sounds stack up
# instead of cancelling each other.
_winmm = ctypes.windll.winmm

def play_sfx():
    alias = f"s{uuid.uuid4().hex[:8]}"
    path = _sfx_path
    def _run():
        _winmm.mciSendStringW(f'open "{path}" type waveaudio alias {alias}', None, 0, None)
        _winmm.mciSendStringW(f'play {alias} wait', None, 0, None)
        _winmm.mciSendStringW(f'close {alias}', None, 0, None)
    threading.Thread(target=_run, daemon=True).start()

# ── Debug hotkey: F7 ───────────────────────────────────────────────────────────
def _on_press(key):
    if key == pkeyboard.Key.f7:
        print("[DEBUG] F7 → playing ShootDel.wav")
        play_sfx()

pkeyboard.Listener(on_press=_on_press, daemon=True).start()

# ── Window enumeration ────────────────────────────────────────────────────────
_EnumWindows = ctypes.windll.user32.EnumWindows
_IsWindowVisible = ctypes.windll.user32.IsWindowVisible
_GetWindowThreadProcessId = ctypes.windll.user32.GetWindowThreadProcessId
_WNDENUMPROC = ctypes.WINFUNCTYPE(ctypes.c_bool, ctypes.wintypes.HWND, ctypes.wintypes.LPARAM)


def get_windowed_pids() -> set[int]:
    """Returns PIDs of processes that currently own a visible window."""
    pids: set[int] = set()
    pid_buf = ctypes.wintypes.DWORD()

    def _cb(hwnd, _):
        if _IsWindowVisible(hwnd):
            _GetWindowThreadProcessId(hwnd, ctypes.byref(pid_buf))
            if pid_buf.value:
                pids.add(pid_buf.value)
        return True

    _EnumWindows(_WNDENUMPROC(_cb), 0)
    return pids


def monitor() -> None:
    if not _prepare_sfx():
        return

    tracked: set[int] = get_windowed_pids()
    print(f"Monitoring windowed apps... Press Ctrl+C to stop. Volume: {VOLUME}%")
    print("Debug: Press F7 to test the SFX.\n")

    try:
        while True:
            time.sleep(POLL_INTERVAL)

            current_pids = set(psutil.pids())

            tracked |= get_windowed_pids()

            closed = tracked - current_pids
            if closed:
                for pid in closed:
                    print(f"App closed — PID {pid}")
                play_sfx()
                tracked -= closed

    except KeyboardInterrupt:
        print("\nMonitoring stopped.")


if __name__ == "__main__":
    monitor()
