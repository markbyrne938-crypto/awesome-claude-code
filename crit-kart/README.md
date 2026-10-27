# Crit Kart

A cartoon, Mario Kart-style indoor-cycling race. Your trainer's **power drives the bike**, the **Zwift Ride controls steer** you into item boxes, and you use the items against seven rivals over a crit-style circuit (default **12 laps, ~10 min**).

No build step, no dependencies: plain HTML/JS + canvas.

## Run

Web Bluetooth only works in **Chrome / Edge** (desktop or Android) from `https://` or `localhost`:

```bash
cd crit-kart
python3 -m http.server 8000     # then open http://localhost:8000
```

No trainer? Play with the keyboard: `↑/↓` watts, `←/→` steer, `Space` use item, `Esc`/`P` pause, `M` mute, `F` fullscreen.

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

* **Physics**: real power-to-speed model (gravity, rolling resistance, aero drag, up to 38 % drag saving when drafting). Rivals use the same model, with attacks, gentle rubber-banding and a "Rival strength" slider.
* **Item boxes** (`?`): Banana Peel, Bidon Bomb (homing, rider ahead), Energy Gel (+45 % power for 5 s), Bubble Shield, Golden Bidon (hits the leader; only handed out to riders in the back half).
* **Technical sections**: every course now has narrow stretches with barriers (scraping a wall slows you), tight corners and hairpins, **speed bumps** (cost speed, make you hop), **cone slaloms**, **potholes** and **barrel rows with a gap**. Knocked-over cones and barrels reset after a while; shields block barrel hits. Rivals dodge most obstacles but make mistakes. A HUD warning tells you what's coming.
* **Zwift-style proportions**: a ~9 m two-lane road, riders about a quarter of the road width, a raised chase camera looking down on the rider, gentle sweeping bends (45-120 m radius) with the odd tighter corner, and obstacles/barriers/scenery sized to match. Riders show a three-quarter angle through bends. Speed is conveyed by short stripes, roadside bollards, a widening field of view and edge streaks.
* **Camera**: the view now pitches with the road ahead so descents keep the road on screen instead of showing mostly sky.
* **Riders**: a more naturalistic rear view (jointed legs, tapered kit with pockets, aero helmet, spoked wheel, varied skin tones and kit designs).
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
