# Claude Arena — Project Overview

## Stack
- **Server**: Node.js + Express + Socket.io (`server.js` in repo root)
- **Client**: Vanilla JS single-file (`claude-game/game.js`) + `claude-game/index.html`
- **Serving**: `server.js` serves the whole repo root as static; the game lives at `http://localhost:3000/claude-game/index.html`

## File Paths (relative to repo root)
```
server.js                          ← Node server (port 3000)
claude-game/
  index.html                       ← Game entry point
  game.js                          ← All client logic (~1000 lines, single IIFE)
  assets/                          ← Character sprites + floor texture
  BalatroSfx/                      ← UI sound effects (.ogg)
  grass/                           ← Step sounds: grass_walk1-10, grass_run1-4, grass_wander1-6
  music/
    ChaseMusic/                    ← Chase music tracks (.mp3, 7 tracks)
    NormalMusic/                   ← Normal/ambient music (not yet implemented)
```

## Key Constants (game.js)
| Constant | Value | Note |
|---|---|---|
| `BULLET_DMG` | 10 | Was 33, reduced × 0.3 |
| `CHASE_DIST` | 550 | World units; triggers chase music |
| `CHASE_FADE_IN_T` | 4 | Seconds for chase fade-in |
| `CHASE_EXIT_DELAY` | 3 | Seconds before fade-out starts |
| `CHASE_FADE_OUT_T` | 6 | Seconds to fade chase out |
| `SHOT_FADE_MULT` | 4 | Speed multiplier when recently hit |

## Architecture
- All gameplay runs client-side; server is authoritative only for damage/kills
- `update(dt)` runs every frame: movement → step SFX → camera → chase music state machine → bullets → particles
- `musicState` object holds fade state machine (`idle → chase → exiting → fading_out → idle`)
- `drawPlayer(p, isMe)` renders shadow → shields → sprite/arrow → name+HP bar
- Volume sliders: `#caMusicVol`, `#caSoundVol` (right side of HUD)

## Music System
Chase music starts silently on "Enter the arena" click (needs user gesture for browser AudioContext).
- **Chase trigger**: enemy within 550 world units AND on screen
- **Fade in**: 4s (×4 faster when recently shot)
- **Exit**: 3s grace period → 6s fade out (both ×4 faster when recently shot)
- **Track ended**: loops if in chase/exiting, else picks random different track
- Normal music not implemented yet (no files in `NormalMusic/`)

## World Pickups
- **Medkits** (max 10): `assets/game/PumpkinMedkit.png`. Spawn 5 at startup then 1 every 20s. Player walks within 28px to pick up (+50 HP). Server-authoritative via `pickupMedkit`/`medkitRemoved` events.
- **XP Boxes** (50 total): Seeded rng32(7777), base 32px, scale 0.9–1.2. Bullet breaks box → fires `breakBox` to server → `boxBroken` to all clients. Breaker gains `xpForLevel(level) * scale` XP and takes `hp * 10%` damage. Boxes not regenerated.

## Shield Immunity
After a shield ring breaks, player gets 1s immunity (`IMMUNE_MS = 1000`). Shown as a flashing gold ring. `me.immuneUntil` timestamp, checked before bullet hit.

## Death Fade
Dead players fade from 1 → 0 alpha over 1500ms (`DEATH_FADE_MS`). Tracked by `p.deathTime` (set in `playerKilled` handler). Player is culled from draw when `fadeAlpha <= 0`.

## Asset Paths
`ASSET_BASE = 'assets/game/'` (set in index.html `assetBase` param). Floor and medkit loaded directly into `assets.floor` / `assets.medkit` keys. Sprites loaded via `attemptLoad` into `cid_animKey` keys.

## Running
```
cd <repo-root>
npm install   # first time only
node server.js
# open http://localhost:3000/claude-game/index.html
```
