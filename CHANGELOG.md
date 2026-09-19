# Changelog

## 0.2.3 — 2026-09-20

- **The `trio` phones no longer run through each other.** The side phones took their depth
  from how far they had fanned, so while the three rose as a stack and began to fan they
  shared one depth and one spot, and cut into each other frame by frame. Each device now
  tucks behind the ones in front of it, by its own thickness and pose, over the strip of
  page the two share (`tuckBehind` in `layouts/common.js`); the settled fan looks as it did.
  The selftest boxes the three devices every 0.1 s and fails if two intersect.

## 0.2.2 — 2026-09-20

- **The studio's preview is the editor.** Tools above it — Move, Turn, Camera, Light — make a
  drag in the preview move, resize or turn a device, orbit the camera or aim the key light;
  badges and other decor drag too, arrows nudge, and on stills a drag can apply to every
  slide or only the one it was made on. Undo and redo cover every change.
- **Live edits without a rebuild.** `stage.patch()` retunes a loaded scene in place — lights,
  camera, pose, position, size, finish, glare — in about 1 ms where a reload took ~200 ms per
  frame, and draws the same pixels a fresh load would (the selftest compares them). Anything
  that builds DOM or geometry still reloads. Still layouts now place their devices in
  `update`, which is what makes that exact.
- **Bring your own 3D model.** `--model file.glb` (with `--model-screen`, `--model-rotate`,
  `--model-kind`), records in `.app-preview-craft/models/` or a config's `devices`, and
  `cli.mjs inspect file.glb` to see a model's materials and the guessed display. The studio
  takes a dropped `.glb`, and asks for a click on the display when the names give nothing to
  go on. Draco and meshopt files decode through WebAssembly, loaded only when needed (the KTX2
  transcoder is wired the same way).
  A custom model's credit — or a note that none is on record — goes into `CREDITS.txt`.
- **Keyframes.** New `keyframes` layout and device-video theme: the device and camera follow
  `motion.keys`. In the studio the keys sit on the scrubber, and posing the device at the
  playhead sets one. Pure functions of t, like every other layout; no animation library.
- **A transcript the agent can read.** The studio writes each step to
  `.app-preview-craft/studio/transcript.jsonl` and its current setup to `session.json`, a
  project config. `cli.mjs transcript` prints both; `--config …/session.json` renders it.
- Studio: screens you added survive a restart. Their `/file` URLs belonged to the server
  process that made them, so reopening the studio showed "image failed to load" for every
  upload, and recordings lost their frames; the studio now has them described again on load.
- New `--set` paths: `device.z`, `scene.key.dir`, `scene.camera.roll`, `motion.keys`.
- Install with `npx skills add imshaikot/app-preview-craft-skill -g`, which sets the skill up
  for every agent it finds; cloning the `skill` branch still works. The install-folder lookup
  in `SKILL.md` also searches Goose's folders (`.goose/skills`, `~/.config/goose/skills`).

## 0.2.1 — 2026-09-19

- The **MacBook lid opens on its hinge**. The hinge was given in normalized units but applied
  in the model's own, so the lid swung about the middle of the laptop and hung in the air
  above the base until it landed. The selftest now renders the shut laptop and checks it.
- **Phone and MacBook no longer intersect.** At the same depth the laptop's deck ran through
  the phone; in `laptop-phone` stills and the `desk` video the phone now stands in front of
  the deck, its page position and size corrected for the perspective so themes look the same.
- `desk` is recomposed: both devices stand on `scene.floor`, the laptop clears the headline,
  the pair fits tall and square pages, and the laptop keeps the last `desktop` screen while
  later slides change the phone — a `desktop` recording plays on across them.
- New sample: `tempo-dashboard.mp4`, a live analytics dashboard recorded from
  `samples/src/tempo.html?s=bi`; the `desk` theme shows it when no screens are given.
- GIFs use the full 256-colour palette with a firmer ordered dither, which takes most of the
  banding out of gradients. `--gif-width` still defaults to 480.
- `gallery` sheets are drawn at 2× (capped at 3400px wide), so thumbnails stay sharp.
- Studio: a project config that names its theme by file (`"theme": "themes/brand.json"`)
  loads it, as the CLI already did.

## 0.2.0 — 2026-09-18

- iPhone renders draw the **Dynamic Island** as one merged black pill. The GLBs model the
  hardware — a pill cutout and a separate round camera — which iOS merges in software; the
  raw geometry read as a grey smudge beside a blue lens, split across the status bar. The
  pill is a decal coplanar with the display, so an oblique pose can't see under its edge.
- Device poses come down across every category: yaw within about ±20°, roll within ±6°
  (`stride` was 24°/9°, `levitate` 28°/18°). Store screenshots are read at thumbnail size and
  a hard angle foreshortened the screen out of legibility.

## 0.1.0 — 2026-09-17

First release.

- Five categories: `app-store`, `social-card`, `screen-video`, `device-video`, `device-mockup`.
- 40 themes; the App Store set is modelled on popular app categories (fitness, finance,
  mindfulness, productivity, food, travel, music, games, photo, health data).
- 3D devices: iPhone 17 Pro, iPhone 17 Pro Max, iPhone 12 Pro, Galaxy S21 Ultra, MacBook Pro 16"
  (CC-BY-4.0, credited in every render that shows them).
- Screenshot treatments with sharp, screen recordings and video output with ffmpeg
  (MP4, HEVC, ProRes 4444 with alpha, VP9 with alpha, GIF).
- Every theme property overridable: `--set`, theme files with `extends`, `app-preview-craft.json`
  project configs with per-slide overrides and multi-job renders.
- Preview studio: live WebGL previews, drag-and-drop, inline copy editing, export, "Copy command".
- `doctor.mjs` environment check and a 25-check `selftest.mjs`.
