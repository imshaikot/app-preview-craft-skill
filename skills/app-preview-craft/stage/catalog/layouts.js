// Layout metadata (no DOM): which kind of output each layout makes, whether
// it needs WebGL, and the defaults it contributes beneath the theme.
export const LAYOUTS = {
  // ── stills ────────────────────────────────────────────────────────────
  'hero-top': {
    kind: 'still',
    label: 'Headline top, device below',
    defaults: { text: { position: 'top' }, device: { x: 0.5, y: 0.64, size: 0.72 } },
  },
  'hero-bottom': {
    kind: 'still',
    label: 'Device top, headline below',
    defaults: { text: { position: 'bottom' }, device: { x: 0.5, y: 0.36, size: 0.72 } },
  },
  tilt: {
    kind: 'still',
    label: 'Angled device, left-aligned headline',
    defaults: { text: { position: 'top', align: 'left' }, device: { x: 0.56, y: 0.66, size: 0.74, pose: [6, -24, 8] } },
  },
  duo: {
    kind: 'still',
    label: 'Two devices, current + next screen',
    defaults: {
      text: { position: 'top' },
      device: { x: 0.62, y: 0.66, size: 0.66, pose: [0, -12, 4], secondary: { x: 0.3, y: 0.6, size: 0.56, pose: [0, 18, -6], z: -0.12 } },
    },
  },
  fan: {
    kind: 'still',
    label: 'Three devices fanned out',
    defaults: { text: { position: 'top' }, device: { x: 0.5, y: 0.66, size: 0.62, spread: 0.3, fanAngle: 12 } },
  },
  split: {
    kind: 'still',
    label: 'Headline on one side, device on the other',
    defaults: { text: { position: 'left', align: 'left' }, device: { x: 0.72, y: 0.55, size: 0.95, pose: [4, -20, 4] } },
  },
  'big-type': {
    kind: 'still',
    label: 'Giant word behind the device',
    defaults: { text: { position: 'bottom' }, device: { x: 0.5, y: 0.5, size: 0.66, pose: [0, 0, 0] } },
  },
  callout: {
    kind: 'still',
    label: 'Device with a magnified detail',
    defaults: { text: { position: 'top' }, device: { x: 0.4, y: 0.66, size: 0.7, pose: [0, 14, 0] } },
  },
  bento: {
    kind: 'still',
    label: 'Bento grid of screen crops',
    defaults: { text: { position: 'left', align: 'left' }, device: { mode: 'frameless' } },
  },
  'laptop-phone': {
    kind: 'still',
    label: 'Laptop with a phone in front',
    defaults: { text: { position: 'top' }, device: { x: 0.46, y: 0.6, size: 0.78, pose: [8, -18, 0], phone: { x: 0.78, y: 0.7, size: 0.5, pose: [0, -24, 0] } } },
  },
  showcase: {
    kind: 'still',
    label: 'Single device on a reflective floor',
    needs3d: true,
    defaults: {
      text: { position: 'none' },
      device: { mode: '3d', x: 0.5, y: 0.5, size: 0.78, pose: [0, -22, 0] },
      scene: { floor: { y: 0.89, mirror: 0.35, opacity: 0.4 }, wall: null, key: { dir: [-0.3, 1, 0.5] } },
    },
  },
  pedestal: {
    kind: 'still',
    label: 'Device on a plinth',
    needs3d: true,
    defaults: {
      text: { position: 'none' },
      device: { mode: '3d', x: 0.5, y: 0.44, size: 0.6, pose: [0, -26, 0] },
      scene: { wall: null, key: { dir: [-0.4, 1, 0.7] }, plinth: { y: 0.745, height: 0.26, radius: 0.3 } },
    },
  },
  lineup: {
    kind: 'still',
    label: 'Every device in a row',
    needs3d: true,
    defaults: {
      text: { position: 'none' },
      device: { mode: '3d', y: 0.55, size: 0.6, pose: [0, -14, 0] },
      devices: ['galaxy-s21-ultra', 'iphone-12-pro', 'iphone-17-pro', 'iphone-17-pro-max'],
      scene: { floor: { y: 0.85, mirror: 0.22, opacity: 0.35 }, wall: null, key: { dir: [-0.3, 1, 0.6] } },
    },
  },
  flatlay: {
    kind: 'still',
    label: 'Devices lying on a surface, top-down',
    needs3d: true,
    defaults: {
      text: { position: 'none' },
      device: { mode: '3d', size: 0.72 },
      scene: { wall: { depth: 0.035, opacity: 0.45 }, key: { dir: [-0.35, 0.45, 1] }, shadow: { blur: 10 } },
    },
  },

  // ── 2D motion ─────────────────────────────────────────────────────────
  carousel: {
    kind: 'video',
    label: 'Screens slide past, the active one grows',
    defaults: { text: { position: 'top' }, device: { mode: 'flat', y: 0.6, size: 0.6, gap: 0.62 } },
  },
  stack: {
    kind: 'video',
    label: 'A stack of cards flipping away',
    defaults: { text: { position: 'top' }, device: { mode: 'frameless', y: 0.62, size: 0.6 } },
  },
  scroll: {
    kind: 'video',
    label: 'One device scrolling long captures',
    defaults: { text: { position: 'top' }, device: { mode: 'flat', y: 0.62, size: 0.66 } },
  },
  'zoom-tour': {
    kind: 'video',
    label: 'Full-bleed screen with Ken Burns zooms',
    defaults: { text: { position: 'bottom' }, device: { mode: 'frameless', corner: 0 } },
  },
  wall: {
    kind: 'video',
    label: 'Tilted wall of drifting screens',
    defaults: { text: { position: 'center' }, device: { mode: 'frameless', size: 0.34 } },
  },
  'phone-swap': {
    kind: 'video',
    label: 'One phone, screens transition per caption',
    defaults: { text: { position: 'top' }, device: { mode: 'flat', y: 0.62, size: 0.68 } },
  },
  'grid-reveal': {
    kind: 'video',
    label: 'Screens pop into a grid, then one takes over',
    defaults: { text: { position: 'bottom' }, device: { mode: 'frameless', size: 0.3 } },
  },

  // ── 3D motion ─────────────────────────────────────────────────────────
  turntable: {
    kind: 'video',
    label: 'Spin-in reveal, then gentle sway',
    needs3d: true,
    defaults: { text: { position: 'top' }, device: { mode: '3d', y: 0.62, size: 0.66 }, motion: { spins: 1.5 } },
  },
  orbit: {
    kind: 'video',
    label: 'Camera orbits a tilted device',
    needs3d: true,
    defaults: { text: { position: 'bottom' }, device: { mode: '3d', y: 0.46, size: 0.72, pose: [10, -10, 8] }, motion: { arc: 50 } },
  },
  float: {
    kind: 'video',
    label: 'Floating device, screens change per beat',
    needs3d: true,
    defaults: { text: { position: 'top' }, device: { mode: '3d', y: 0.63, size: 0.66, pose: [4, -16, 4], float: 1 } },
  },
  rise: {
    kind: 'video',
    label: 'Rises into frame, camera pushes in',
    needs3d: true,
    defaults: { text: { position: 'top' }, device: { mode: '3d', y: 0.62, size: 0.66 }, motion: { push: 0.72 } },
  },
  flip: {
    kind: 'video',
    label: 'Back-to-front flip reveal',
    needs3d: true,
    defaults: { text: { position: 'top' }, device: { mode: '3d', y: 0.62, size: 0.66 } },
  },
  trio: {
    kind: 'video',
    label: 'Three devices rise and fan',
    needs3d: true,
    defaults: {
      text: { position: 'top' },
      device: { mode: '3d', y: 0.64, size: 0.54, spread: 0.3, fanAngle: 14 },
      devices: ['galaxy-s21-ultra', 'iphone-17-pro', 'iphone-17-pro-max'],
    },
  },
  desk: {
    kind: 'video',
    label: 'Laptop opens, phone slides in',
    needs3d: true,
    defaults: {
      text: { position: 'top' },
      // No y: both devices stand on scene.floor.
      device: { mode: '3d', x: 0.44, size: 0.43, pose: [0, -16, 0], phone: { x: 0.76, size: 0.34, pose: [0, -22, 0] } },
      scene: { floor: { y: 0.88, mirror: 0, opacity: 0.3 }, wall: null, key: { dir: [-0.3, 1, 0.6] }, camera: { pitch: 7 } },
    },
  },
  spotlight: {
    kind: 'video',
    label: '360° spin on a mirror floor',
    needs3d: true,
    defaults: {
      text: { position: 'top' },
      device: { mode: '3d', y: 0.56, size: 0.62 },
      scene: { floor: { y: 0.88, mirror: 0.4, opacity: 0.4 }, wall: null, key: { dir: [-0.2, 1, 0.45] }, camera: { pitch: 6 } },
    },
  },
  keyframes: {
    kind: 'video',
    label: 'Your own move: device and camera follow motion.keys',
    needs3d: true,
    defaults: { text: { position: 'top' }, device: { mode: '3d', y: 0.62, size: 0.64 }, motion: { keys: null } },
  },
}

// Layouts that size or arrange their devices while building, not in update:
// a change to device.size / x / y there needs a fresh load (see stage.patch).
export const STATIC_PLACE = new Set(['carousel', 'stack', 'zoom-tour', 'wall', 'grid-reveal', 'bento'])

export const layoutsFor = (kind) => Object.entries(LAYOUTS).filter(([, l]) => l.kind === kind).map(([id]) => id)
