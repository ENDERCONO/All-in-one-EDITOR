# 🎃 Pumpkin Reactor

Automatically reacts to Pumpkin's reels in your Instagram DM thread with random messages from a pool of 100.

---

## What it does
- On launch → reacts to the **last 10 reels** in the thread
- Then **watches every 30 seconds** for new reels and reacts automatically
- Picks a **random message** from a pool of 100 each time so it never looks repetitive
- Saves your login so you only have to log in **once**

---

## Setup (first time only)

### Requirements
- Windows 10/11
- Python 3.10+ → https://python.org/downloads
  - ✅ Check "Add Python to PATH" during install

### Steps
1. Put `pumpkin_reactor.py` and `build.bat` in the same folder
2. Double-click **`build.bat`** — it will:
   - Install all dependencies automatically
   - Build `PumpkinReactor.exe` inside a `dist/` folder
3. Done! Run `dist/PumpkinReactor.exe` whenever you want it active

---

## Running

1. Double-click `dist/PumpkinReactor.exe`
2. A browser opens automatically
3. **First run only:** Log in to Instagram when prompted (you have 2 minutes)
4. The bot takes over — it reacts to reels and monitors for new ones
5. Press **Ctrl+C** in the console to stop

Your login is saved in a `browser_profile/` folder next to the exe — keep it private.

---

## Notes

- **Opera GX is auto-detected** at common install paths. If not found, it falls back to built-in Chromium (same engine, same result)
- The 30-second poll interval is intentionally human-like to avoid detection
- Messages are randomly chosen so reactions never look like copy-paste spam
- ⚠️ Instagram automation violates their ToS — don't react 100s of times/day

---

## Customizing

Open `pumpkin_reactor.py` in Notepad to:
- Change `CHECK_INTERVAL_SECONDS` — how often it checks for new reels
- Change `INITIAL_REELS_TO_REACT` — how many past reels to react to on startup
- Edit `MESSAGES` list — add/remove/change any of the 100 messages
