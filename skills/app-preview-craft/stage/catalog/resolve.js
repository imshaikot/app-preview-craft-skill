// Theme resolution, shared by CLI and stage. Precedence, lowest first:
//
//   BASE → category defaults → built-in theme (and its `extends` chain)
//   → custom theme file → project config `theme` → CLI flags / --set
//   → per-slide `theme` overrides
//
// Plain objects merge deeply; arrays and scalars replace.
import { THEMES } from '../themes/index.js'
import { CATEGORIES, SIZES } from './categories.js'
import { SCHEMA_BY_PATH } from './schema.js'
import { LAYOUTS } from './layouts.js'

export const BASE = {
  layout: 'hero-top',
  palette: {
    bg: '#0d0f14',
    bg2: '#1a1f2b',
    bg3: '#2a3142',
    ink: '#ffffff',
    sub: 'rgba(255,255,255,0.72)',
    accent: '#7c9cff',
    accent2: '#ff7ab6',
    surface: 'rgba(255,255,255,0.08)',
  },
  type: {
    display: 'inter',
    body: 'inter',
    weight: 750,
    bodyWeight: 450,
    size: 1,
    subSize: 1,
    case: 'none',
    tracking: -0.02,
    leading: 1.04,
    italic: false,
    highlight: 'color',
    shadow: 0,
  },
  text: { position: 'top', align: 'center', margin: 0.07, width: 0.86, kicker: '' },
  background: {
    kind: 'gradient',
    angle: 160,
    pattern: 'none',
    patternOpacity: 0.12,
    patternScale: 1,
    grain: 0.04,
    vignette: 0,
    panorama: false,
    image: null,
    blur: 60,
    dim: 0.35,
  },
  device: {
    mode: '3d',
    model: 'iphone-17-pro',
    flat: 'phone',
    size: 0.7,
    x: 0.5,
    y: 0.64,
    pose: [0, 0, 0],
    finish: null,
    glare: 0.45,
    frame: '#0f1013',
    edge: '#5a5a62',
    corner: 0.07,
    shadow: 0.35,
    float: 0,
  },
  screen: {
    cleanStatusBar: false,
    statusBarTime: '9:41',
    tint: null,
    tintAmount: 0.35,
    duotone: null,
    saturate: 1,
    brightness: 1,
    sharpen: false,
    fit: 'cover',
    background: '#000000',
    transition: 'slide',
  },
  scene: {
    fov: 22,
    exposure: 1,
    env: 1,
    envRotation: 0,
    ambient: 0.4,
    key: { color: '#ffffff', intensity: 2, dir: [-0.5, 0.8, 1] },
    rims: [],
    points: [],
    shadow: { blur: 18 },
    wall: { depth: 0.06, opacity: 0.32 },
    floor: null,
    camera: { yaw: 0, pitch: 0, dist: 1 },
  },
  motion: { duration: 10, fps: 30, speed: 1, hold: 0.6, intro: false, outro: false, loop: false },
  decor: [],
}

export const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v)

export function merge(...layers) {
  const out = {}
  for (const layer of layers) {
    if (!isObj(layer)) continue
    for (const [k, v] of Object.entries(layer)) {
      if (v === undefined) continue
      out[k] = isObj(v) && isObj(out[k]) ? merge(out[k], v) : isObj(v) ? merge(v) : Array.isArray(v) ? v.map((x) => (isObj(x) ? merge(x) : x)) : v
    }
  }
  return out
}

export function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj)
}

/** Return a copy of obj with `path` set; intermediate objects are created. */
export function setPath(obj, path, value) {
  const keys = path.split('.')
  const out = merge(obj)
  let o = out
  for (const k of keys.slice(0, -1)) {
    if (!isObj(o[k])) o[k] = {}
    o = o[k]
  }
  o[keys.at(-1)] = value
  return out
}

/** Coerce a string from the command line using the schema, or by shape. */
export function coerce(path, raw) {
  if (typeof raw !== 'string') return raw
  const field = SCHEMA_BY_PATH[path]
  const s = raw.trim()
  if (s === 'null' || s === 'none' && field?.nullable) return null
  if (field?.type === 'pose' || field?.type === 'vec3') return s.split(/[ ,]+/).map(Number)
  if (field?.type === 'number' || field?.type === 'range') return Number(s)
  if (field?.type === 'bool') return /^(1|true|yes|on)$/i.test(s)
  if (/^(true|false)$/.test(s)) return s === 'true'
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s)
  if (/^[[{]/.test(s)) {
    try {
      return JSON.parse(s)
    } catch {}
  }
  return s
}

export function listThemes(category) {
  return Object.values(THEMES[category] ?? {})
}

/**
 * Resolve a theme id (built-in or custom) through its `extends` chain.
 * `custom` maps id -> theme object from user theme files.
 */
export function themeChain(category, id, custom = {}) {
  const seen = new Set()
  const chain = []
  let cur = custom[id] ?? THEMES[category]?.[id]
  if (!cur) {
    // Allow borrowing a theme from another category: "app-store/stride"
    const [cat, tid] = String(id).split('/')
    cur = THEMES[cat]?.[tid]
  }
  if (!cur) throw new Error(`unknown theme "${id}" for ${category}. Try: ${Object.keys(THEMES[category] ?? {}).join(', ')}`)
  while (cur) {
    if (seen.has(cur)) throw new Error(`theme "${id}" extends itself`)
    seen.add(cur)
    chain.unshift(cur)
    const parent = cur.extends
    if (!parent) break
    const [cat, tid] = parent.includes('/') ? parent.split('/') : [category, parent]
    cur = custom[parent] ?? THEMES[cat]?.[tid]
    if (!cur) throw new Error(`theme "${id}" extends unknown theme "${parent}"`)
  }
  return chain
}

export function resolveTheme(category, id, { custom = {}, overrides = [] } = {}) {
  const cat = CATEGORIES[category]
  if (!cat) throw new Error(`unknown category "${category}". Try: ${Object.keys(CATEGORIES).join(', ')}`)
  const chain = themeChain(category, id ?? cat.defaultTheme, custom)
  const catDefaults = cat.kind === 'video' ? { motion: { duration: cat.duration, fps: cat.fps } } : {}
  // The layout is only known after the theme and overrides are merged, and
  // its defaults sit beneath both.
  const layout = merge(BASE, ...chain, ...overrides).layout
  const layoutDefaults = LAYOUTS[layout]?.defaults ?? {}
  const theme = merge(BASE, catDefaults, layoutDefaults, ...chain, ...overrides)
  theme.id = chain.at(-1).id
  theme.category = category
  return theme
}

export function resolveSize(category, size) {
  if (size && typeof size === 'object') return size
  const cat = CATEGORIES[category]
  const key = size ?? cat.defaultSize
  const m = String(key).match(/^(\d+)x(\d+)$/)
  if (m) return { key, w: Number(m[1]), h: Number(m[2]), label: key }
  const s = SIZES[key]
  if (!s) throw new Error(`unknown size "${key}". Try: ${cat.sizes.join(', ')} or WxH`)
  return { key, ...s }
}
