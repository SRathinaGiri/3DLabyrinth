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
| 🧊 Glass | 0.4× | 1.2× | Slippery; clear glass shows the pits through the floor (in the Inside view it turns frosted and solid so the corridors stay readable) |
| 🏛️ Marble | 0.7× | 1.35× | Quick, with springy walls |

| Ball | Accel | Grip | Bounce | Top speed | Feel |
|---|---|---|---|---|---|
| 🟡 Plastic | 1.0× | 1.0× | 1.0× | 1.0× | All-rounder |
| ⚙️ Steel | 1.2× | 0.55× | 0.55× | 1.3× | Heavy: fast, keeps momentum, dull thuds |
| 🔴 Rubber | 0.85× | 1.6× | 1.7× | 0.85× | Slow but springs off walls |

Board and ball values multiply together (grip → rolling resistance, bounce → wall restitution, capped at 0.92). Physics note: on a real incline a heavy ball does not accelerate faster, because a = 5/7·g·sinθ regardless of mass. Steel feels fast because friction and bumps barely slow it, so its accel boost is a gameplay choice. Slow pairings get up to +40% on the timer (`timePace`). Impact sounds also change: steel pings, rubber thuds, wood dulls the knock, and glass/marble make it ring.

## Lives & 3D messages
- **❤ Lives** are a reserve shared by all three balls. A new game starts with 1. You get +1 the first time you clear a level (replays don't earn lives), and the first clear also gets a confetti burst over the goal, a fanfare and a "🔓 Level N unlocked" line.
- **Ball falls into a hole:** if you have a life, one is spent and the ball **hops over the hole** to the next safe cell towards the goal (never into the goal, a gate or another hole). With no lives it restarts at the blue ring as before.
- **Time runs out:** if your lives cover every ball still out (e.g. 2 balls out, 5 lives), those lives are spent and the level counts as **rescued**, so you move on.
- **🍎 Bonus apple** (level 4+, `APPLE` in `js/config.js`): one per level, at the dead end of a side branch 2–4 cells off the solution route. The cell just before it holds exactly **one guard**: a sliding gate or an offset hole on a straight, or a corner hole on a bend. Nothing else in the branch or at its junction may be a hurdle. Rolling a ball onto it gives **+1 life**. Each level's apple can be claimed **once, ever** (`progress.apples`), so replays can't farm lives, but a player who runs out can revisit earlier levels; those show 🍎 in the level list. The autopilot test fetches every apple from level 4 to 25 past its guard.
- **Stars:** lives keep you playing but cap the rating. A life-saved fall counts like a fall (max ★★), and a rescue gives ★.
- **3D messages:** Level clear, Rescued, Time's up and Paused are panels **inside the stereo scene** on the zero-parallax plane, so they work in SBS, anaglyph, HSBS glasses and VR. You can tap a button in either eye's half, or use ←/→ + Enter, a gamepad stick + A, or the Quest thumbstick + trigger/A. Only the slider form (⚙ 3D on the pause panel) is a normal 2D screen.

## VR (Meta Quest)
Tap **🥽 VR** in the Quest browser.
- **Placement:** the board is placed relative to **your head when VR starts**, so it works seated or standing, whatever floor height the headset reports.
  - **🪑 Table** (default): a ~0.8 m board 55 cm below your eyes, near edge 15 cm away, facing you. You look down onto it (about 75° near, 45° at the centre, 30° at the far edge), like a real tabletop labyrinth. Walls are drawn at 60% height in VR (visual only), so walls never hide the far holes.
  - **🟫 Floor**: a giant ~3.2 m maze laid on the floor at your feet.
- **Floating HUD:** the score bar and all panels form a screen anchored in the room in front of where you sat, not glued to your face. The bar sits just above eye level, and panels are straight ahead.
- **Controls:** the **thumbstick** tilts the board. **B / Y** opens the 3D pause panel: Resume · Restart · 🎯 Recenter · Table/Floor · ⏏ Exit VR. Use the thumbstick to choose and the **trigger or A** to select. "Menu" on the clear and time's-up panels becomes ⏏ Exit VR.
- **No Inside view in VR:** the ball's-eye camera isn't offered there, because moving the camera through corridors while you stand still is a classic motion-sickness trigger.
- Sizes are in `VR` in `js/config.js`.

## Inside view (1 ball) & minimap
- **🧍 Inside view** (🎥 button cycles Auto → Whole board → Follow → Inside, or press <kbd>V</kbd>): a chase camera at ball height. Walls are drawn **3.2× taller** in this view only, so the corridors tower around you; the physics doesn't change.
- **Ball count follows the view:** Inside = **1 ball**, every board view = **3 balls**. Crossing that line mid-level restarts the level, after a 3D "Restart level?" confirmation unless you're in the first 3 s. Esc or "Keep playing" reverts the view.
- **Car-like camera:** forward rolls the ball the way you're looking. The camera eases toward the direction the ball is actually rolling (velocity low-passed so wall bounces don't jerk it). Its turn rate is capped at about 86°/s and scales down with ball speed, so it never spins on the spot. Holding left/right therefore steers like a car. Rolling backwards (more than 120° off) holds the camera, and a slow U-turn follows only after 1.2 s of reversing without pushing "back" (`INSIDE_VIEW` in `config.js`).
- **Camera details:** the camera pulls in and booms up when a wall is behind it. A headlamp lights the corridor, and a green light beam over the goal shows the way.
- **Minimap** (Inside view only): a round, GPS-style 3D panel at screen depth in both eyes. Your ball stays in the lower centre with its arrow pointing **up**, and the maze turns smoothly with the camera, so up on the map is always straight ahead in the 3D view. An **N** on the rim shows north, a green marker on the rim points to the goal when it's off the map, and apples, holes and gates are drawn too. Big mazes zoom to about 4.5 cells around you.
- **🗺 Map toggle:** a small 3D icon above the minimap. Tap it in either eye's half (or press <kbd>N</kbd>) to show or hide the map. The tap never tilts the board, and the choice is remembered.

## Difficulty curve (`js/config.js`)
| Level | What gets added |
|---|---|
| 1–2 | 5×5 maze, no hurdles, untimed |
| 2+ | Side holes in dead-end branches (traps for overshooting balls) |
| 3+ | Time limit, scaled to the length of the solution path; tightens from ~3.3× to a floor of ~2.4× a careful single-ball run, so experts can still bring three balls home on the hardest levels |
| 4+ | Sliding gates that sweep across corridors |
| 5+ | Holes offset into straight corridors, leaving a narrow lane to pass |
| 8+ | Holes in the outer corner of turns, which catch balls that take corners too fast |
| All | The board grows to 16×16 and the maximum tilt rises from 9.5° to 16° |

Stars: ★★★ for no falls and finishing within 66% of the time, ★★ for up to 2 falls, ★ for clearing the level.

## Install as an app
- **Android / Chrome / Edge:** once the browser considers the page installable, a **📲 Install app** button appears in the menu header and a one-time banner offers it. Both open the system install prompt.
- **iPhone / iPad:** Safari has no install prompt, so the button shows the *Share → Add to Home Screen* steps.
- **What makes it installable:** the manifest has 192 px and 512 px PNG icons (normal + maskable, in `assets/`), `id`/`scope`/`start_url`, `display: standalone`, and a service worker with a fetch handler. `tests/version.test.mjs` checks the icons exist at the right sizes and are cached. It must be served over HTTPS (GitHub Pages is fine).

## Screen rotation lock
On phones, starting a level goes full-screen and locks the screen rotation, so tilting for the gyro can't flip it:
- **Side-by-side 3D** (Parallel, Cross-eye, Smart Glasses) always locks **landscape**. 2D and Anaglyph lock whatever orientation you're holding.
- **Changing 3D mode mid-game** from the pause settings re-locks to match.
- **It unlocks back at the menu.**
- **Android Chrome** grants the lock only while the page is **full-screen**, even in the installed app, so the game always enters full-screen first and retries once if the first lock is refused. The manifest also has `display_override: ["fullscreen"]`, so the installed app launches full-screen (Android can take a while to refresh an existing install; reinstalling applies it at once). **iPhone Safari has no lock API.**
- **If the lock is refused**, nothing fails silently: the 3D countdown says *"Turn on your phone's rotation lock"*, and the pause panel shows the lock status (`🔒 Rotation locked: landscape` or the reason it wasn't).

## Run locally
ES modules need a web server:
```bash
python -m http.server 8086
```
Then open http://localhost:8086. Gyro access needs **HTTPS** on real phones; GitHub Pages provides that.

## Menu
Play, lives and the level list are always visible. **Board & Balls**, **Controls** and **3D Viewing** are collapsible sections, closed by default so first-time (mobile) players reach Play fast. Each header shows its current choice (e.g. *Neon · Plastic*), and which sections are open is remembered.

## Releasing
Bump the version in **all** of: `js/config.js` (`VERSION`), `sw.js` (`CACHE_VERSION`), `manifest.json`, and `index.html` (badge + `?v=` on the CSS/JS). `tests/version.test.mjs` fails if any of them disagree, so an installed PWA always picks up the new cache. Every module also loads through an **import map** with `?v=<version>` in its URL, and the service worker pre-caches from the network (`cache: 'reload'`). An update can therefore never mix old and new code, even when a CDN or the HTTP cache still holds the previous release. The service worker only deletes old caches named `labyrinth-*`: other apps on the same `github.io` origin (e.g. 3D Tunnel Rush) keep their offline copies, and the test enforces that too.

## Tests
```bash
node --test tests/logic.test.mjs tests/version.test.mjs tests/solvable.test.mjs
```
- `logic.test.mjs` checks that the mazes are perfect and deterministic, that hurdles never block the path, that balls never tunnel through walls, and that the hole, respawn and goal logic works.
- `solvable.test.mjs` runs a headless autopilot that clears levels 1–40 (and asserts every timer is ≥ 2.3× its careful per-ball time) with the real physics, ball by ball, timing the gates. It also clears levels 1–12 on the extreme pairings (glass+steel, wood+rubber, marble+rubber, glass+plastic). The time limits are calibrated against it.

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
