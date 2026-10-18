# 🎱 3D Labyrinth PWA (Stereoscopic 3D Tilt-Maze)

Tilt the board and roll **three balls** from the blue start ring into the **green goal**. Dodge holes, time the sliding gates and beat the clock. Levels are procedural and endless, and each level number is a fixed seed, so "Level 7" is the same maze every time.

Sister project of [3D Tunnel Rush](https://github.com/SRathinaGiri/3DTunnelRush). It reuses that game's stereo render pipeline, gyro handling and PWA shell.

## Features
- **Mobile first**: the gyroscope is on by default. Hold the phone however is comfortable, because the countdown takes your current grip as "flat". Tap 🎯 Re-level any time.
- **Other inputs**: drag anywhere on the board (touch or mouse) like a joystick, arrow keys / WASD, gamepad stick, or a Meta Quest thumbstick.
- **3D modes**: 2D, Parallel SBS, Cross-Eye SBS, Anaglyph (red/cyan), Smart-Glasses HSBS (RayNeo / XREAL / Rokid / TCL) and WebXR VR.
- **Auto stereo**: eye separation and the focal plane scale with camera distance, so depth feels the same on a 5×5 board and a 16×16 board. The HUD sits on the zero-parallax plane.
- **Camera**: Auto (switches to follow-cam when the cells would get too small), Whole board, or Follow balls.
- **Offline PWA**: three.js r128 is bundled locally, sound is synthesised with the Web Audio API, and there are no external requests.

## Boards & balls (`js/config.js` → `BOARD_SURFACES`, `BALL_TYPES`)
Pick them in the menu. Each one changes both the look and the physics.

| Board | Grip | Wall bounce | Feel |
|---|---|---|---|
| 💠 Neon | 1.0× | 1.0× | Classic arcade board |
| 🪵 Wood | 1.7× | 0.75× | Grippy and forgiving, soft knocks |
| 🧊 Glass | 0.4× | 1.2× | Slippery; you can see the pits through the floor |
| 🏛️ Marble | 0.7× | 1.35× | Quick, with springy walls |

| Ball | Accel | Grip | Bounce | Top speed | Feel |
|---|---|---|---|---|---|
| 🟡 Plastic | 1.0× | 1.0× | 1.0× | 1.0× | All-rounder |
| ⚙️ Steel | 1.2× | 0.55× | 0.55× | 1.3× | Heavy: fast, keeps momentum, dull thuds |
| 🔴 Rubber | 0.85× | 1.6× | 1.7× | 0.85× | Slow but springs off walls |

Board and ball values multiply together (grip → rolling resistance, bounce → wall restitution, capped at 0.92). Physics note: on a real incline a heavy ball does not accelerate faster, because a = 5/7·g·sinθ regardless of mass. Steel feels fast because friction and bumps barely slow it, so its accel boost is a gameplay choice. Slow pairings get up to +40% on the timer (`timePace`). Impact sounds also change: steel pings, rubber thuds, wood dulls the knock, and glass/marble make it ring.

## Lives & 3D messages
- **❤ Lives** are a pool shared by all three balls. You get +1 the first time you clear a level; replays don't earn lives.
- **Ball falls into a hole:** if you have a life, one is spent and the ball **hops over the hole** to the next safe cell towards the goal (never into the goal, a gate or another hole). With no lives it restarts at the blue ring as before.
- **Time runs out:** if your lives cover every ball still out (e.g. 2 balls out, 5 lives), those lives are spent and the level counts as **rescued**, so you move on.
- **🍎 Bonus apple** (level 4+, `APPLE` in `js/config.js`): one per level, at the dead end of a side branch 2–4 cells off the solution route. The cell just before it holds exactly **one guard**: a sliding gate or an offset hole on a straight, or a corner hole on a bend. Nothing else in the branch or at its junction may be a hurdle. Rolling a ball onto it gives **+1 life**. Each level's apple can be claimed **once, ever** (`progress.apples`), so replays can't farm lives, but a player who runs out can revisit earlier levels; those show 🍎 in the level list. The autopilot test fetches every apple from level 4 to 25 past its guard.
- **Stars:** lives keep you playing but cap the rating. A life-saved fall counts like a fall (max ★★), and a rescue gives ★.
- **3D messages:** Level clear, Rescued, Time's up and Paused are panels **inside the stereo scene** on the zero-parallax plane, so they work in SBS, anaglyph, HSBS glasses and VR. You can tap a button in either eye's half, or use ←/→ + Enter, a gamepad stick + A, or the Quest thumbstick + trigger/A. Only the slider form (⚙ 3D on the pause panel) is a normal 2D screen.

## Inside view (1 ball) & minimap
- **🧍 Inside view** (🎥 button cycles Auto → Whole board → Follow → Inside, or press <kbd>V</kbd>): a chase camera at ball height. Walls are drawn **3.2× taller** in this view only, so the corridors tower around you; the physics doesn't change.
- **Ball count follows the view:** Inside = **1 ball**, every board view = **3 balls**. Crossing that line mid-level restarts the level, after a 3D "Restart level?" confirmation unless you're in the first 3 s. Esc or "Keep playing" reverts the view.
- **Controls follow the camera:** forward rolls the ball the way you're looking. The camera turns 90° once the ball has travelled a new corridor for 0.3 s. A 180° turn waits until you stop pushing "back"; otherwise camera-relative controls would ping-pong.
- **Camera details:** the camera pulls in and booms up when a wall is behind it. A headlamp lights the corridor, and a green light beam over the goal shows the way.
- **Minimap** (Inside view only): a 3D panel at screen depth in the top-right of both eyes. It shows the whole maze **heading-up** (rotated in 90° steps so your forward direction is always up), with your ball and view cone, holes, gates, the start ring and the goal.
- **🗺 Map toggle:** a small 3D icon above the minimap. Tap it in either eye's half (or press <kbd>N</kbd>) to show or hide the map. The tap never tilts the board, and the choice is remembered.

## Difficulty curve (`js/config.js`)
| Level | What gets added |
|---|---|
| 1–2 | 5×5 maze, no hurdles, untimed |
| 2+ | Side holes in dead-end branches (traps for overshooting balls) |
| 3+ | Time limit, scaled to the length of the solution path |
| 4+ | Sliding gates that sweep across corridors |
| 5+ | Holes offset into straight corridors, leaving a narrow lane to pass |
| 8+ | Holes in the outer corner of turns, which catch balls that take corners too fast |
| All | The board grows to 16×16 and the maximum tilt rises from 9.5° to 16° |

Stars: ★★★ for no falls and finishing within 66% of the time, ★★ for up to 2 falls, ★ for clearing the level.

## Run locally
ES modules need a web server:
```bash
python -m http.server 8086
```
Then open http://localhost:8086. Gyro access needs **HTTPS** on real phones; GitHub Pages provides that.

## Releasing
Bump the version in **all** of: `js/config.js` (`VERSION`), `sw.js` (`CACHE_VERSION`), `manifest.json`, and `index.html` (badge + `?v=` on the CSS/JS). `tests/version.test.mjs` fails if any of them disagree, so an installed PWA always picks up the new cache.

## Tests
```bash
node --test tests/logic.test.mjs tests/version.test.mjs tests/solvable.test.mjs
```
- `logic.test.mjs` checks that the mazes are perfect and deterministic, that hurdles never block the path, that balls never tunnel through walls, and that the hole, respawn and goal logic works.
- `solvable.test.mjs` runs a headless autopilot that clears levels 1–30 with the real physics, ball by ball, timing the gates. It also clears levels 1–12 on the extreme pairings (glass+steel, wood+rubber, marble+rubber, glass+plastic). The time limits are calibrated against it.

## Structure
```
js/config.js    constants + difficulty curve (pure)
js/maze.js      seeded maze generator + hurdle placement (pure)
js/physics.js   ball physics: walls, gates, holes, goal (pure)
js/renderer.js  stereo engine (from Tunnel Rush)
js/board.js     three.js scene for a level
js/materials.js procedural wood/glass/marble/neon textures, ball skins, reflection env
js/controls.js  gyro / drag / keys / gamepad / XR → analog tilt
js/hud3d.js     in-scene HUD (works in every stereo mode)
js/audio.js     Web Audio synth
js/ui.js        menus, modals, settings
js/app.js       game loop, camera, level lifecycle, WebXR, service worker
```

## License
MIT. three.js is MIT (© three.js authors).
