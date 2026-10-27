# Crit Kart

A cartoon, Mario Kart-style indoor-cycling race. Your trainer's **power drives the bike**, the **Zwift Ride controls steer** you into item boxes, and you use the items against seven rivals over a crit-style circuit (default **12 laps, ~10 min**).

No build step, no dependencies: plain HTML/JS + canvas.

## Run

Web Bluetooth only works in **Chrome / Edge** (desktop or Android) from `https://` or `localhost`:

```bash
cd crit-kart
python3 -m http.server 8000     # then open http://localhost:8000
```

No trainer? Play with the keyboard: `↑/↓` watts, `←/→` steer, `Space` use item, `Esc` pause.

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

## Gameplay

* **Physics**: real power-to-speed model (gravity, rolling resistance, aero drag, up to 38 % drag saving when drafting). Rivals use the same model, with attacks, gentle rubber-banding and a "Rival strength" slider.
* **Item boxes** (`?`): Banana Peel, Bidon Bomb (homing, rider ahead), Energy Gel (+45 % power for 5 s), Bubble Shield, Golden Bidon (hits the leader; only handed out to riders in the back half).
* **Courses**: Sunny Meadows Crit (~500 m), Candy Canyon (steep, ~560 m), Neon Harbor Night Crit (technical, ~450 m). The menu estimates your race time from your FTP.
* Scenery hills are exaggerated 5x for the cartoon look; physics and the trainer use the true gradient.

## Tests

```bash
node test/sim.test.js   # parsers, loop closure, full 12-lap races on every course
```

## Layout

`js/ble.js` Bluetooth + parsers · `js/course.js` courses/track · `js/sim.js` physics, AI, items · `js/render.js` pseudo-3D renderer + HUD · `js/main.js` UI/input/loop.
