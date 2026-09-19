// 3D device models. Shared by the stage (browser) and the CLI (Node).
//
// `fix` rotates the raw model so its screen faces +Z with +Y up; every layout
// assumes that pose. `screen` names the display mesh by material, and
// `hide` removes cover glass that would otherwise tint the screenshot.
// `body` lists the materials a theme's `finish` color repaints.
//
// `island` is the Dynamic Island, as a rect normalized to the display. The
// GLBs model the hardware truthfully — a pill cutout and a separate round
// camera next to it — but iOS merges the two into one black shape, so that is
// what every real screenshot shows. Device3D paints ISLAND over the model's
// cutouts to match. Metrics are iPhone points on a 402×874pt display.
//
// Credits are required by CC-BY-4.0 and are copied from each GLB's
// asset.extras by scripts/models.mjs into assets/models/credits.json.

/** Dynamic Island as a fraction of the display: 125×37.3pt, 11pt below the top edge. */
export const ISLAND = { w: 125 / 402, h: 37.3 / 874, top: 11 / 874 }

export const DEVICES = {
  'iphone-17-pro': {
    name: 'iPhone 17 Pro',
    kind: 'phone',
    file: 'iphone-17-pro.glb',
    source: 'iphone_17_pro.glb',
    fix: [0, Math.PI, 0],
    screen: { material: 'OLED' },
    hide: [{ material: 'Glass' }],
    body: ['Anodized_aluminum'],
    island: ISLAND,
    display: [1206, 2622],
    credit: {
      title: 'iPhone 17 Pro',
      author: 'Ranguel',
      authorUrl: 'https://sketchfab.com/Ranguel',
      source: 'https://sketchfab.com/3d-models/iphone-17-pro-4541aa8a28324b33a2baaf81d263aaec',
      license: 'CC-BY-4.0',
    },
  },
  'iphone-17-pro-max': {
    name: 'iPhone 17 Pro Max',
    kind: 'phone',
    file: 'iphone-17-pro-max.glb',
    source: 'iphone_17_pro_max.glb',
    fix: [0, Math.PI / 2, 0],
    screen: { material: 'screen.001' },
    hide: [],
    body: ['basecolor.001', 'metalframe.002', 'backpanel.001'],
    island: ISLAND,
    display: [1320, 2868],
    credit: {
      title: 'iPhone 17 Pro Max',
      author: 'MajdyModels',
      authorUrl: 'https://sketchfab.com/MG990',
      source: 'https://sketchfab.com/3d-models/iphone-17-pro-max-87fc1df741384124a8ce0226d2b2058d',
      license: 'CC-BY-4.0',
    },
  },
  'iphone-12-pro': {
    name: 'iPhone 12 Pro',
    kind: 'phone',
    file: 'iphone-12-pro.glb',
    source: 'iphone_12_pro.glb',
    fix: [0, 0, 0],
    screen: { material: 'Wallpaper' },
    hide: [],
    body: ['Body', 'BodyFrame', 'PacificBlue'],
    display: [1170, 2532],
    credit: {
      title: 'iPhone 12 Pro',
      author: 'DatSketch',
      authorUrl: 'https://sketchfab.com/DatSketch',
      source: 'https://sketchfab.com/3d-models/iphone-12-pro-05dfc991665e45c68c8b7062136c0c6e',
      license: 'CC-BY-4.0',
    },
  },
  'galaxy-s21-ultra': {
    name: 'Samsung Galaxy S21 Ultra',
    kind: 'phone',
    file: 'galaxy-s21-ultra.glb',
    source: 'samsung_galaxy_s21_ultra.glb',
    fix: [0, Math.PI, 0],
    screen: { material: 'Screen' },
    hide: [],
    body: ['Back'],
    display: [1440, 3200],
    credit: {
      title: 'Samsung Galaxy S21 Ultra',
      author: 'DatSketch',
      authorUrl: 'https://sketchfab.com/DatSketch',
      source: 'https://sketchfab.com/3d-models/samsung-galaxy-s21-ultra-cd962832be7744efb6b37fe0ee2027e7',
      license: 'CC-BY-4.0',
    },
  },
  'macbook-pro-16': {
    name: 'MacBook Pro 16" (M3)',
    kind: 'laptop',
    file: 'macbook-pro-16.glb',
    source: 'macbook_pro_m3_16_inch_2024.glb',
    fix: [0, 0, 0],
    // The display is the only emissive mesh; material names are hashes.
    screen: { material: 'sfCQkHOWyrsLmor' },
    hide: [],
    body: [],
    fit: 'width',
    display: [3456, 2234],
    // Meshes centered above this normalized height belong to the lid, which
    // hinges about `hinge` so video scenes can open the laptop. `close` is the
    // rotation from the modelled (open) pose to shut, in radians.
    lid: { above: -0.2, hinge: [0, -0.2946, -0.2358], close: 1.9 },
    credit: {
      title: 'MacBook Pro M3 16 inch 2024',
      author: 'jackbaeten',
      authorUrl: 'https://sketchfab.com/jackbaeten',
      source: 'https://sketchfab.com/3d-models/macbook-pro-m3-16-inch-2024-8e34fc2b303144f78490007d91ff57c4',
      license: 'CC-BY-4.0',
    },
  },
}

// Bring-your-own models. A custom device is the same record as above, written
// as JSON next to its GLB (`.app-preview-craft/models/<id>.json`), in a project
// config's `devices`, or made on the fly by `--model file.glb`:
//
//   { "name": "Pixel 9", "kind": "phone", "file": "pixel-9.glb",    kind: phone | laptop; left out,
//                                                                 it follows the model's proportions
//     "screen": { "material": "Screen" },        or { "mesh": "Display" }
//     "rotate": [0, 180, 0],                      degrees; turns the screen to face +Z, +Y up
//     "hide": [{ "material": "Glass" }], "body": ["Frame"],
//     "display": [1080, 2424],                    optional: measured from the screen mesh
//     "credit": { "title", "author", "authorUrl", "source", "license" } }
//
// They live apart from DEVICES so the built-in catalog stays a constant.
export const CUSTOM_DEVICES = {}

const rad = (d) => (d * Math.PI) / 180

/** Fill in a custom device record. `file`/`url` are left as given. */
export function normalizeDevice(id, def = {}) {
  const screen = typeof def.screen === 'string' ? { material: def.screen } : (def.screen ?? null)
  return {
    ...def,
    id,
    custom: true,
    name: def.name ?? id,
    kind: def.kind === 'laptop' || def.kind === 'phone' ? def.kind : undefined,
    fix: def.fix ?? (def.rotate ?? [0, 0, 0]).map(rad),
    screen,
    hide: (def.hide ?? []).map((h) => (typeof h === 'string' ? { material: h } : h)),
    body: def.body ?? [],
    fit: def.fit,
    island: def.island === true ? ISLAND : def.island || undefined,
    credit: def.credit?.author || def.credit?.title ? { title: def.name ?? id, license: 'not stated', ...def.credit } : null,
  }
}

export function registerDevices(map = {}) {
  for (const [id, def] of Object.entries(map ?? {})) {
    if (DEVICES[id]) throw new Error(`custom model "${id}" has the name of a built-in device; rename it`)
    CUSTOM_DEVICES[id] = normalizeDevice(id, def)
  }
  return CUSTOM_DEVICES
}

export const deviceDef = (id) => DEVICES[id] ?? CUSTOM_DEVICES[id]
export const deviceIds = () => [...Object.keys(DEVICES), ...Object.keys(CUSTOM_DEVICES)]

/** CSS-drawn frames for devices with no 3D model (and for flat themes). */
export const FLAT_FRAMES = {
  phone: { name: 'Flat phone', radius: 0.14, bezel: 0.028, island: true, aspect: 1206 / 2622 },
  'phone-android': { name: 'Flat Android phone', radius: 0.08, bezel: 0.024, punch: true, aspect: 1080 / 2400 },
  tablet: { name: 'Flat tablet', radius: 0.05, bezel: 0.035, aspect: 2064 / 2752 },
  browser: { name: 'Browser window', radius: 0.02, bar: 0.05, aspect: 16 / 10 },
}

export function creditLine(c) {
  const by = c.author ? ` by ${c.author}${c.authorUrl ? ` (${c.authorUrl})` : ''}` : ''
  return `"${c.title}"${by}, ${c.license}${c.source ? ` — ${c.source}` : ''}`
}
