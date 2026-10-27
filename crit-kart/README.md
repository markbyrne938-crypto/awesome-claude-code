# Crit Kart

A cartoon, Mario Kart-style indoor-cycling race. Your trainer's **power drives the bike**, the **Zwift Ride controls steer** you into item boxes, and you use the items against seven rivals over a crit-style circuit (default **12 laps, ~10 min**).

No build step, no dependencies: plain HTML/JS + canvas.

## Run

Web Bluetooth only works in **Chrome / Edge** (desktop or Android) from `https://` or `localhost`:

```bash
cd crit-kart
python3 -m http.server 8000     # then open http://localhost:8000
```

No trainer? Play with the keyboard: `↑/↓` watts, `←/→` steer, `Space` (or a click/tap) use item, `T` steering on/off, `Esc`/`P` pause, `M` mute, `F` fullscreen.

## How it talks to your gear

| Thing | Protocol | Status |
|---|---|---|
| Power / cadence | BLE **FTMS** Indoor Bike Data (0x1826 / 0x2AD2), falling back to **Cycling Power** (0x1818 / 0x2A63), the same open profiles Zwift and MyWhoosh read | Standard; parsers unit-tested |
| Hills on the trainer | FTMS control point: request control, start, then *Set Indoor Bike Simulation Parameters* (0x11) with the course gradient (scaled by the "hill feel" slider) | Standard; not tested on hardware |
| Zwift Ride steering + buttons | Zwift's custom service `0xFC82`: handshake `RideOn`, protobuf notifications | **Community reverse-engineering written from memory; untested on a real controller** |

### Zwift Ride caveats (please read)

The Zwift Ride protocol is not public and I could not check it against a device. The code is written to survive that:

* Buttons are detected as *bits that changed from the idle state*, so the "pressed = 0 or 1" convention doesn't matter. Use **Bind item button** to choose which button fires items (default: any).
* Steering uses a **calibration wizard** (straight, full left, full right) that picks whichever analog axis moves, so exact field numbers and scales don't matter. If the controller never sends analog data, steering stays on the keyboard.
* Every raw notification is shown in the **Bluetooth debug log** (menu). If something doesn't decode, that log is what's needed to fix `decodeZwiftMessage()` in `js/ble.js`.
* Only one app can hold the controls at a time, so close Zwift / Companion first.

## Testing your Zwift Ride controls

1. Close Zwift and the Companion app, then press **Connect controls**.
2. Use the **Controller test** panel in the menu: it shows live button bits, analog values, message count and a steering bar. Press every button and turn the bars.
3. Press **Calibrate steering** and follow the prompts (straight, full left, full right), then **Bind item button**.
4. If anything doesn't react, open **Bluetooth debug log**, press **Copy log** and send it over. The handshake is retried automatically with two variants if the controller stays silent.

## Gameplay

* **Physics**: real power-to-speed model (gravity, rolling resistance, aero drag, up to 38 % drag saving when drafting). Rivals use the same model, with attacks and an optional small rubber band; their pace comes from your FTP and the rival category you pick.
* **Item boxes** (`?`): Banana Peel, Bidon Bomb (homing, rider ahead), Energy Gel (+45 % power for 5 s), Bubble Shield, Golden Bidon (hits the leader; only handed out to riders in the back half).
* **Technical sections**: every course now has narrow stretches with barriers (scraping a wall slows you), tight corners and hairpins, **speed bumps** (cost speed, make you hop), **cone slaloms**, **potholes** and **barrel rows with a gap**. Knocked-over cones and barrels reset after a while; shields block barrel hits. Rivals dodge most obstacles but make mistakes. A HUD warning tells you what's coming.
* **Zwift-style proportions**: a ~9 m two-lane road, riders about a quarter of the road width, a raised chase camera looking down on the rider, gentle sweeping bends (45-120 m radius) with the odd tighter corner, and obstacles/barriers/scenery sized to match. Riders show a three-quarter angle through bends. Speed is conveyed by short stripes, roadside bollards, a widening field of view and edge streaks.
* **Camera**: the view now pitches with the road ahead so descents keep the road on screen instead of showing mostly sky.
* **Riders**: a more naturalistic rear view (jointed legs, tapered kit with pockets, aero helmet, spoked wheel, varied skin tones and kit designs).
* **The field and your FTP**: 8 riders (you + 7 rivals). You enter your **FTP** (required; there's a 20-minute-test estimator if you don't know it) and your weight. The rivals' power is derived from it. Pick a **rival category** (a small rubber band keeps the bunch together and can be turned off in Advanced):

  | Category | Rivals ride about | Feel |
  |---|---|---|
  | D · Social | 0.87 x FTP | relaxed group ride |
  | C · Steady | 0.98 x FTP | a bit under FTP |
  | **B · Even (default)** | **1.03 x FTP** | at or just above FTP |
  | A · Hard | 1.10 x FTP | clearly above FTP |

  (Each rival varies +-4 % and attacks now and then, so the figures are averages; they're pinned by `test/sim.test.js`.) The menu shows your own Zwift-style category from W/kg (A 4.0+, B 3.2+, C 2.5+, D below) and previews the rivals' watts. Results list every rider's average power. You start at the back of the grid with the bunch ahead in view, and a Zwift-style leaderboard lists all eight with live gaps (the camera is behind you, so riders behind aren't on screen).
* **Steering off (no controller needed)**: in the Race section set **Steering** to *Off: auto-follow*. Your rider then holds the wheel of the rider in front to get the draft, pulls out to the freer side and overtakes when you're going faster (it stays tucked in until it's nearly on their wheel, or pulls out early if you're clearly quicker), dodges cones, barrels and potholes, keeps off the barriers, and grabs item boxes when that doesn't cost the draft. Items can be used automatically (checkbox), or by clicking/tapping the screen or pressing Space. Press **T** during a race to switch steering on/off. Finishing position then depends on your power, not on steering skill.
* **Smooth motion**: riders and objects are projected exactly (not interpolated between road segments), grade/bend/width are blended smoothly along the track, sideways movement has inertia (the bike leans in, then moves over) and lane changes ease in, bumps bleed speed off over ~0.2 s, pedalling uses a natural cadence (your trainer's real cadence for you), and the bike rocks gently with the stroke. Sprite jerk (second difference of on-screen position at 60 Hz) fell from ~4-8 px to under 1.5 px.
* **No collisions**: as in Zwift, riders pass straight through each other (no shoving at the start or in the pack). Overlapping rivals turn slightly see-through so a crowded grid or a pass stays readable.
* **Courses**: Sunny Meadows Crit (~520 m), Candy Canyon (steep and narrow, ~580 m, 3/4 of the laps), Neon Harbor Night Crit (the technical one, ~500 m). The menu estimates your race time from your FTP.
* **Championship**: all three courses in a row, 10-8-6-5-4-3-2-1 points, final standings and a champion title.
* **Results**: average / normalized power, W/kg, best lap, and a per-second power chart coloured by zone against your FTP.
* **Safety nets**: a dropped trainer pauses the race and auto-reconnects (it never silently falls back to keyboard power); the race pauses when the tab is hidden; the screen is kept awake during races; "no power signal" warning if data stalls.
* **Feel**: sound effects (synthesized), lap times with best-lap highlight, position-change toasts, steering sensitivity and invert options.
* Scenery hills are exaggerated 5x for the cartoon look; physics and the trainer use the true gradient.

## Tests

```bash
node test/sim.test.js   # parsers, loop closure, full 12-lap races on every course
```

## Layout

`js/ble.js` Bluetooth + parsers · `js/course.js` courses/track · `js/sim.js` physics, AI, items · `js/render.js` pseudo-3D renderer + HUD · `js/audio.js` sound effects · `js/main.js` UI/input/loop/championship.
