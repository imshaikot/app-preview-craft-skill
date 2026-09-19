// app-preview-craft studio. The previews are live stage.html pages; this file only
// owns state (category, theme, overrides, slides) and turns it into specs.
//
// Every change goes through record(): one step of undo history, and one line of
// the transcript the server keeps in .app-preview-craft/studio/ for the agent.
import { getPath, isObj, merge, resolveTheme, setPath } from '/stage/catalog/resolve.js'
import { fontStack } from '/stage/catalog/fonts.js'
import { KEY_SNAP, keysOf, keyTrack } from '/stage/lib/keys.js'

const $ = (s, el = document) => el.querySelector(s)
const $$ = (s, el = document) => [...el.querySelectorAll(s)]
const h = (tag, attrs = {}, ...kids) => {
  const el = document.createElement(tag)
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue
    if (k === 'class') el.className = v
    else if (k === 'style' && isObj(v)) for (const [p, x] of Object.entries(v)) p.startsWith('--') ? el.style.setProperty(p, x) : (el.style[p] = x)
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v)
    else if (k === 'html') el.innerHTML = v
    else el.setAttribute(k, v === true ? '' : v)
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(kid))
  return el
}
/** replaceChildren that skips null and false, which the DOM would print as text. */
const fill = (el, ...kids) => el.replaceChildren(...kids.flat().filter((k) => k != null && k !== false))
const ICON = {
  left: '<svg viewBox="0 0 24 24"><path d="M15 6l-6 6 6 6"/></svg>',
  right: '<svg viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
  swap: '<svg viewBox="0 0 24 24"><path d="M4 8h13l-3-3M20 16H7l3 3"/></svg>',
  focus: '<svg viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  reset: '<svg viewBox="0 0 24 24"><path d="M4 12a8 8 0 1 0 3-6.2M4 4v5h5"/></svg>',
  play: '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>',
  move: '<svg viewBox="0 0 24 24"><path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3"/></svg>',
  turn: '<svg viewBox="0 0 24 24"><path d="M20 12a8 8 0 1 1-2.6-5.9M20 4v5h-5"/></svg>',
  camera: '<svg viewBox="0 0 24 24"><path d="M3 8h4l2-3h6l2 3h4v11H3z"/><circle cx="12" cy="13" r="3.5"/></svg>',
  light: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/></svg>',
  undo: '<svg viewBox="0 0 24 24"><path d="M9 7 4 12l5 5M4 12h10a6 6 0 0 1 0 12"/></svg>',
  redo: '<svg viewBox="0 0 24 24"><path d="m15 7 5 5-5 5M20 12H10a6 6 0 0 0 0 12"/></svg>',
  key: '<svg viewBox="0 0 24 24"><path d="M12 3l8 9-8 9-8-9z"/></svg>',
  pick: '<svg viewBox="0 0 24 24"><path d="M5 3l6 16 2.5-6.5L20 10z"/></svg>',
}

/* ── state ─────────────────────────────────────────────────────────────── */

const boot = await fetch('/api/state').then((r) => r.json())
const { catalog } = boot
const THEMES = boot.themes
const custom = { ...boot.custom }
// The person's own 3D models: id -> record, a URL for the GLB, and what is inside it.
const ownDevices = { ...boot.devices }
const STORE = `app-preview-craft-studio:${boot.cwd}`

const initial = (() => {
  try {
    return JSON.parse(localStorage.getItem(STORE)) ?? {}
  } catch {
    return {}
  }
})()

const state = {
  category: initial.category ?? boot.project?.config?.category ?? 'app-store',
  themeByCat: initial.themeByCat ?? {},
  overridesByCat: initial.overridesByCat ?? {},
  sizeByCat: initial.sizeByCat ?? {},
  slides: initial.slides ?? boot.project?.slides ?? null,
  brand: initial.brand ?? boot.project?.config?.brand ?? null,
  index: 0,
  focus: null,
  tab: 'slides',
  panel: initial.panel ?? false,
  export: initial.export ?? {},
  tool: 'move',
  scope: 'all',
}
if (boot.project?.config?.theme && typeof boot.project.config.theme === 'string' && !initial.themeByCat) {
  state.themeByCat[state.category] = boot.project.config.theme
}
// Slides kept in the browser carry /file URLs from the server process that made them.
// Ask this one to describe the files again, or every restart shows broken images.
if (state.slides?.length) {
  const kept = state.slides.flatMap((s) => [s.screen?.path, s.desktop?.path]).filter(Boolean)
  const { files = {} } = await fetch('/api/restore', { method: 'POST', body: JSON.stringify({ paths: kept }) })
    .then((r) => r.json())
    .catch(() => ({}))
  const gone = []
  for (const s of state.slides) {
    for (const key of ['screen', 'desktop']) {
      const p = s[key]?.path
      if (!p) continue
      if (files[p] && !files[p].error) s[key] = files[p]
      else {
        gone.push(p.split('/').pop())
        s[key] = undefined
      }
    }
  }
  if (gone.length) boot.lost = gone
}
const usingSamples = () => !state.slides?.length
const slides = () => (usingSamples() ? (boot.samples[currentThemeRaw().samples] ?? boot.samples.slides) : state.slides)
const brand = () => state.brand ?? (usingSamples() ? boot.samples.brand : {})
const cat = () => catalog.categories[state.category]
const themeId = () => state.themeByCat[state.category] ?? cat().defaultTheme
const overrides = () => (state.overridesByCat[state.category] ??= {})
const allThemes = () => ({ ...THEMES[state.category], ...Object.fromEntries(Object.entries(custom).filter(([, t]) => !t.category || t.category === state.category)) })
const currentThemeRaw = () => allThemes()[themeId()] ?? {}
const sizeKey = () => state.sizeByCat[state.category] ?? cat().defaultSize
const size = () => ({ key: sizeKey(), ...catalog.sizes[sizeKey()] })
const isVideo = () => cat().kind === 'video'

let saveTimer
function save() {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    const { focus, index, tool, scope, ...rest } = state
    localStorage.setItem(STORE, JSON.stringify(rest))
  }, 200)
}

/* ── history and transcript ────────────────────────────────────────────── */

// What undo restores. View state (focus, panel, tool) is not part of the work.
const UNDOABLE = ['category', 'themeByCat', 'overridesByCat', 'sizeByCat', 'slides', 'brand']
const snapshot = () => JSON.stringify(Object.fromEntries(UNDOABLE.map((k) => [k, state[k]])))
const history = [{ snap: snapshot(), text: 'Opened the studio' }]
let cursor = 0
const events = [...(boot.transcript?.events ?? [])]
let outbox = []
let flushTimer

const show = (v) => (Array.isArray(v) ? v.map((x) => (isObj(x) ? '{…}' : x)).join(', ') : isObj(v) ? JSON.stringify(v) : String(v))

/**
 * Note a change: `text` is the sentence the transcript shows, `data` the same
 * thing as fields. `coalesce` names a stream (a slider being dragged): steps
 * in one stream within a moment of each other replace the last instead of
 * piling up, in the history and in the transcript both.
 */
function record(type, text, data = {}, { coalesce = null, undoable = true } = {}) {
  const now = Date.now()
  const event = { type, text, ...data }
  if (undoable) {
    const snap = snapshot()
    const top = history[cursor]
    if (snap === top.snap) return
    if (coalesce && top.coalesce === coalesce && now - top.at < 1500) Object.assign(top, { snap, text, at: now })
    else {
      history.length = cursor + 1
      history.push({ snap, text, coalesce, at: now })
      cursor++
    }
  }
  const pending = outbox.at(-1)
  if (coalesce && pending?.coalesce === coalesce && now - pending.at < 1500) outbox[outbox.length - 1] = { ...event, coalesce, at: now }
  else outbox.push({ ...event, coalesce, at: now })
  clearTimeout(flushTimer)
  flushTimer = setTimeout(flush, 700)
  updateHistoryUi()
}

async function flush() {
  const batch = outbox.map(({ coalesce, at, ...e }) => e)
  outbox = []
  if (!batch.length) return
  try {
    const r = await fetch('/api/transcript', { method: 'POST', body: JSON.stringify({ events: batch, session: sessionNow() }) }).then((x) => x.json())
    events.push(...(r.events ?? []))
  } catch {
    events.push(...batch.map((e) => ({ ...e, t: new Date().toISOString(), unsaved: true })))
  }
  if (state.tab === 'history') renderHistoryPane()
}
// A closing tab still gets its last lines out.
window.addEventListener('pagehide', () => {
  const batch = outbox.map(({ coalesce, at, ...e }) => e)
  if (batch.length) navigator.sendBeacon('/api/transcript', JSON.stringify({ events: batch, session: sessionNow() }))
})

/** Where the studio stands, as a project config the CLI renders as is. */
function sessionNow() {
  const j = jobFor()
  return { category: j.category, theme: j.theme, themeOverrides: j.themeOverrides, size: j.size, format: j.format, transparent: j.transparent, index: j.index, brand: j.brand, out: j.out, slides: usingSamples() ? undefined : j.slides, ownModels: Object.keys(ownDevices), command: cliCommand() }
}

function travel(step) {
  const next = cursor + step
  if (next < 0 || next >= history.length) return
  const undone = history[step < 0 ? cursor : next].text
  cursor = next
  Object.assign(state, JSON.parse(history[cursor].snap))
  state.focus = null
  state.index = Math.min(state.index, Math.max(0, slides().length - 1))
  save()
  pause()
  renderAll()
  record(step < 0 ? 'undo' : 'redo', `${step < 0 ? 'Undid' : 'Redid'}: ${undone}`, {}, { undoable: false })
  toast({ title: `${step < 0 ? 'Undid' : 'Redid'}: ${undone}`, timeout: 1600 })
}
const undo = () => travel(-1)
const redo = () => travel(1)

function updateHistoryUi() {
  const u = $('#btn-undo')
  if (!u) return
  u.disabled = cursor === 0
  u.title = cursor ? `Undo: ${history[cursor].text} (⌘Z)` : 'Nothing to undo'
  $('#btn-redo').disabled = cursor >= history.length - 1
  $('#btn-redo').title = cursor < history.length - 1 ? `Redo: ${history[cursor + 1].text} (⇧⌘Z)` : 'Nothing to redo'
}

function theme() {
  let t = resolveTheme(state.category, themeId(), { custom, overrides: [overrides()] })
  const s = size()
  if (s.frame === 'tablet' && !['frameless', 'none'].includes(t.device.mode)) {
    t = merge(t, { device: { mode: 'flat', flat: 'tablet', size: Math.min(t.device.size, 0.66) } })
  }
  return t
}

/* ── screen treatments (sharp, via the server) ─────────────────────────── */

const prepCache = new Map()
function treatmentOf(t) {
  const s = t.screen
  const active = s.cleanStatusBar || s.tint || s.duotone || s.saturate !== 1 || s.brightness !== 1 || s.sharpen
  return active ? { cleanStatusBar: s.cleanStatusBar, statusBarTime: s.statusBarTime, tint: s.tint, tintAmount: s.tintAmount, duotone: s.duotone, saturate: s.saturate, brightness: s.brightness, sharpen: s.sharpen } : null
}
async function prepared(screen, treatment) {
  if (!screen || screen.kind !== 'image' || !treatment) return null
  const key = JSON.stringify([screen.path, treatment])
  if (!prepCache.has(key)) {
    prepCache.set(
      key,
      fetch('/api/prepare', { method: 'POST', body: JSON.stringify({ path: screen.path, treatment }) })
        .then((r) => r.json())
        .catch(() => null),
    )
  }
  return prepCache.get(key)
}
const toStageScreen = async (screen, treatment) => {
  if (!screen) return undefined
  if (screen.kind === 'video') return { frames: screen.frames, w: screen.w, h: screen.h }
  const p = await prepared(screen, treatment)
  return p?.url ? { url: p.url, w: p.w, h: p.h, backdrop: p.backdrop } : { url: screen.url, w: screen.w, h: screen.h }
}

async function buildSpec(index, pixelRatio) {
  const t = theme()
  const s = size()
  const treatment = treatmentOf(t)
  const list = await Promise.all(
    slides().map(async (sl) => ({
      ...sl,
      screen: await toStageScreen(sl.screen, treatment),
      desktop: await toStageScreen(sl.desktop, null),
      hold: sl.hold ?? (sl.screen?.kind === 'video' ? sl.screen.duration : undefined),
    })),
  )
  return {
    category: state.category,
    kind: cat().kind,
    theme: t,
    width: s.w,
    height: s.h,
    slides: list,
    index,
    count: list.length,
    brand: brand(),
    pixelRatio,
    animated: isVideo(),
    editable: true,
    assetBase: '/',
    screenScale: 0.6,
    devices: Object.fromEntries(Object.entries(ownDevices).map(([id, { inspect, ...def }]) => [id, def])),
  }
}

/* ── frames ────────────────────────────────────────────────────────────── */

const canvas = $('#canvas')
let frames = []
let loadSeq = 0

function frameCount() {
  if (cat().set) return slides().length
  return 1
}

function layoutFrames() {
  const s = size()
  const vp = $('#viewport').getBoundingClientRect()
  const set = cat().set
  const availH = vp.height - 18 - (isVideo() ? 84 : 54) - (set ? 20 : 0)
  const availW = vp.width - 80
  const n = frames.length
  let scale
  if (state.focus != null && set) scale = Math.min(availH / s.h, (availW - 44) / s.w)
  // A set shares the row with two spacers and the add tile (0.55 of a frame).
  else if (set) scale = Math.min(availH / s.h, (availW - (n + 2) * 22) / (n + 0.55) / s.w)
  else scale = Math.min(availH / s.h, (availW - 44) / s.w)
  if (set && state.focus == null) scale = Math.max(scale, Math.min(availH / s.h, 150 / s.w))
  for (const f of frames) {
    const w = Math.round(s.w * scale)
    const hgt = Math.round(s.h * scale)
    f.wrap.style.width = `${w}px`
    f.wrap.style.height = `${hgt}px`
    f.iframe.style.width = `${s.w}px`
    f.iframe.style.height = `${s.h}px`
    f.iframe.style.transform = `scale(${scale})`
    f.scale = scale
    f.el.hidden = state.focus != null && set && f.index !== state.focus
    f.el.classList.toggle('focus', state.focus === f.index && set)
  }
  const add = $('.add-tile', canvas)
  if (add) {
    add.style.width = `${Math.round(s.w * scale * 0.55)}px`
    add.style.height = `${Math.round(s.h * scale)}px`
    add.hidden = state.focus != null
  }
  return scale
}

function buildFrames() {
  resumeAfterLoad = true
  $('#scrub').value = 0
  for (const f of frames) f.el.remove()
  canvas.innerHTML = ''
  frames = []
  const n = frameCount()
  const set = cat().set
  canvas.append(h('div', { class: 'spacer-l' }))
  for (let i = 0; i < n; i++) {
    const iframe = h('iframe', { src: '/stage/stage.html?embed=1', scrolling: 'no', title: `preview ${i + 1}` })
    const wrap = h('div', { class: 'stage-wrap' }, iframe, h('div', { class: 'loading' }, h('i')))
    const title = set ? (slides()[i]?.title ?? '').replace(/\*/g, '') : ''
    const meta = h(
      'div',
      { class: 'frame-meta' },
      set ? h('b', {}, String(i + 1).padStart(2, '0')) : null,
      h('span', { class: 't' }, set ? title : `${size().label ?? size().key} · ${size().w}×${size().h}`),
      set
        ? h(
            'span',
            { class: 'tools' },
            h('button', { class: 'icon-btn', title: 'Focus', html: ICON.focus, onclick: (e) => (e.stopPropagation(), toggleFocus(i)) }),
            h('button', { class: 'icon-btn', title: 'Move left', html: ICON.left, onclick: (e) => (e.stopPropagation(), moveSlide(i, -1)) }),
            h('button', { class: 'icon-btn', title: 'Move right', html: ICON.right, onclick: (e) => (e.stopPropagation(), moveSlide(i, 1)) }),
            h('button', { class: 'icon-btn', title: 'Replace screenshot', html: ICON.swap, onclick: (e) => (e.stopPropagation(), pickFiles((files) => replaceScreen(i, files[0]))) }),
            h('button', { class: 'icon-btn', title: 'Remove', html: ICON.trash, onclick: (e) => (e.stopPropagation(), removeSlide(i)) }),
          )
        : null,
    )
    const el = h('div', { class: 'frame', 'data-index': i }, wrap, meta)
    const f = { el, wrap, iframe, index: i, ready: false, loadId: 0, scale: 1 }
    el.addEventListener('dblclick', () => set && toggleFocus(i))
    frames.push(f)
    canvas.append(el)
  }
  if (cat().set) {
    canvas.append(
      h('div', { class: 'add-tile', onclick: () => pickFiles(addFiles) }, h('div', { html: `${ICON.plus}<b>Add screens</b><span class="dim">or drop files anywhere</span>` })),
    )
  }
  canvas.append(h('div', { class: 'spacer-r' }))
  renderTools()
  layoutFrames()
  refreshAll()
  renderSlidePicker()
  document.body.classList.toggle('video', isVideo())
  $('#transport').hidden = !isVideo()
}

const frameFor = (win) => frames.find((f) => f.iframe.contentWindow === win)

window.addEventListener('message', (e) => {
  const msg = e.data
  const f = frameFor(e.source)
  if (!msg || !f) return
  switch (msg.type) {
    case 'stage:ready':
      f.ready = true
      refresh(f)
      break
    case 'stage:loaded':
      if (msg.id !== f.loadId) return
      f.el.classList.remove('busy')
      $('.error', f.wrap)?.remove()
      f.info = msg.info
      f.loaded = true
      sendTool(f)
      for (const w of msg.info.warnings ?? []) if (/no screen is set/.test(w)) noteOnce(w)
      if (isVideo()) onVideoLoaded(f)
      break
    case 'stage:error':
      if (msg.id !== f.loadId) return
      f.el.classList.remove('busy')
      f.loaded = false
      $('.error', f.wrap)?.remove()
      f.wrap.append(h('div', { class: 'error' }, msg.error))
      break
    case 'stage:patched':
      if (msg.id !== f.patchId) return
      f.patching = false
      // Something in the change builds DOM or geometry: load it properly.
      if (!msg.exact) refresh(f)
      else if (f.patchAgain) retune(f)
      break
    case 'stage:edit': {
      const list = ensureOwnSlides()
      if (!list[msg.index]) return
      list[msg.index][msg.field] = msg.value
      save()
      record('slide.text', `Slide ${msg.index + 1} ${msg.field}: “${String(msg.value).replace(/\*/g, '')}”`, { slide: msg.index + 1, field: msg.field, value: msg.value })
      renderSlidesPane()
      // Other frames show this text only in video captions; refresh the rest.
      refreshAll({ except: cat().set ? f : null })
      break
    }
    case 'stage:change':
      onStageChange(f, msg)
      break
    case 'stage:decor':
      onDecorMoved(f, msg)
      break
    case 'stage:select':
      state.selected = msg.device
      break
    case 'stage:devices':
      f.devices = msg.devices
      break
    case 'stage:picked':
      onPicked(msg)
      break
    case 'stage:hover':
      $('#pick-hover') && ($('#pick-hover').textContent = msg.material != null ? `material “${msg.material || '(unnamed)'}” · mesh “${msg.mesh || '(unnamed)'}”` : 'Hover the model, click its display')
      break
    case 'stage:key':
      // The preview has the keyboard focus; shortcuts still belong to the studio.
      onKey({ key: msg.key, shiftKey: msg.shift, metaKey: msg.meta, ctrlKey: msg.ctrl, target: document.body, preventDefault() {} })
      break
    case 'stage:time':
      if (f === frames[0]) setTime(msg.time)
      break
  }
})

const noted = new Set()
function noteOnce(text) {
  if (noted.has(text)) return
  noted.add(text)
  toast({ title: text, timeout: 6000 })
}

let refreshTimer
function refreshAll({ except = null, delay = 120 } = {}) {
  clearTimeout(refreshTimer)
  refreshTimer = setTimeout(() => frames.forEach((f) => f !== except && refresh(f)), delay)
}

async function refresh(f) {
  if (!f.ready) return
  const id = ++loadSeq
  f.loadId = id
  f.loaded = false
  f.patching = false
  f.el.classList.add('busy')
  const pr = Math.max(0.5, Math.min(1.5, f.scale * devicePixelRatio))
  const index = cat().set ? f.index : Math.min(state.index, slides().length - 1)
  const spec = await buildSpec(index, pr)
  spec.viewScale = f.scale
  if (f.loadId !== id) return
  // A still has no clock to restart; a video picks up where the scrubber is.
  spec.time = isVideo() && duration ? (Number($('#scrub').value) / 1000) * duration : 0
  if (playing) resumeAfterLoad = true
  playing = false
  updatePlayButton()
  f.iframe.contentWindow.postMessage({ type: 'stage:load', id, spec }, '*')
}

/**
 * Show a theme change. A loaded stage takes lights, camera, pose, position and
 * size in place (stage.patch), which is what makes sliders and drags feel live;
 * it answers exact: false for anything that builds DOM or geometry, and that
 * frame loads instead. Either way the pixels are what a render of it gives.
 */
function retune(f) {
  if (!f.loaded) return refresh(f)
  if (f.patching) {
    f.patchAgain = true
    return
  }
  f.patching = true
  f.patchAgain = false
  f.patchId = ++loadSeq
  f.iframe.contentWindow.postMessage({ type: 'stage:patch', id: f.patchId, theme: theme() }, '*')
}
const retuneAll = ({ except = null } = {}) => frames.forEach((f) => f !== except && retune(f))

function sendTool(f) {
  f.iframe.contentWindow.postMessage({ type: 'stage:tool', tool: state.tool, scope: cat().kind === 'still' ? state.scope : 'all' }, '*')
}

/* ── edits made in the preview (stage/lib/editor.js) ───────────────────── */

const pathLabel = (path) => {
  const f = catalog.schema.find((x) => x.path === path)
  return f ? `${f.group} › ${f.label}` : path
}

function onStageChange(f, msg) {
  const perSlide = msg.scope === 'slide' && cat().kind === 'still'
  if (perSlide) {
    const list = ensureOwnSlides()
    const sl = list[msg.index]
    if (!sl) return
    for (const c of msg.changes) sl.theme = setPath(sl.theme ?? {}, c.path, c.value)
  } else {
    for (const c of msg.changes) state.overridesByCat[state.category] = setPath(overrides(), c.path, c.value)
  }
  save()
  for (const c of msg.changes) syncField(c.path, c.value)
  if (msg.changes.some((c) => c.path === 'motion.keys')) renderKeys()
  // The frame that was dragged already shows it (or said it cannot, and reloads).
  if (!msg.exact && msg.final) refresh(f)
  if (!msg.final) return
  if (!perSlide) retuneAll({ except: f })
  const what = msg.changes.map((c) => (c.path === 'motion.keys' ? `${c.value.length} keyframes` : `${c.path} = ${show(c.value)}`)).join(' · ')
  record('preview.edit', `${msg.label ?? 'Edited in the preview'}${perSlide ? ` (slide ${msg.index + 1} only)` : ''} — ${what}`, { changes: msg.changes, scope: perSlide ? 'slide' : 'all', slide: perSlide ? msg.index + 1 : undefined })
  if (state.tab === 'style') renderStylePane()
  if (perSlide && state.tab === 'slides') renderSlidesPane()
}

function onDecorMoved(f, msg) {
  const at = { x: msg.x, y: msg.y }
  let kind
  if (msg.source === 'slide') {
    const sl = ensureOwnSlides()[msg.index]
    if (!sl?.decor?.[msg.n]) return
    sl.decor = sl.decor.map((d, i) => (i === msg.n ? { ...d, ...at } : d))
    kind = sl.decor[msg.n].kind
  } else {
    const list = (theme().decor ?? []).map((d, i) => (i === msg.n ? { ...d, ...at } : d))
    if (!list[msg.n]) return
    kind = list[msg.n].kind
    state.overridesByCat[state.category] = setPath(overrides(), 'decor', list)
  }
  save()
  refreshAll({ except: msg.source === 'slide' ? f : null })
  record('preview.decor', `Moved the ${kind} decoration${msg.source === 'slide' ? ` on slide ${msg.index + 1}` : ''} to x ${msg.x}, y ${msg.y}`, { decor: msg.n, source: msg.source, ...at })
  if (state.tab === 'style') renderStylePane()
}

/* ── video transport ───────────────────────────────────────────────────── */

let playing = false
let duration = 0
// A reload in the middle of an edit stays where the scrubber is; only a video
// that was running (or a fresh set of frames) starts playing when it lands.
let resumeAfterLoad = true
function onVideoLoaded(f) {
  duration = f.info.duration
  const beats = $('#beats')
  beats.innerHTML = ''
  const list = slides()
  // Mirror the stage timeline roughly for markers.
  const t = theme()
  const intro = t.motion.intro ? 1.8 : 0
  const outro = t.motion.outro ? 2.2 : 0
  const lens = list.map((s) => s.hold ?? (s.screen?.kind === 'video' ? s.screen.duration : null))
  const fixed = lens.reduce((a, b) => a + (b ?? 0), 0)
  const free = lens.filter((x) => x == null).length
  const each = free ? Math.max(1.4, (t.motion.duration / t.motion.speed - intro - outro - t.motion.hold - fixed) / free) : 0
  let at = intro
  lens.forEach((l, i) => {
    beats.append(h('i', { style: { left: `${(at / duration) * 100}%` } }), h('span', { style: { left: `${(at / duration) * 100}%` } }, String(i + 1)))
    at += l ?? each
  })
  renderKeys()
  setTime((Number($('#scrub').value) / 1000) * duration)
  if (resumeAfterLoad) play()
  resumeAfterLoad = false
}

/* keyframes: markers on the scrubber, for themes on the `keyframes` layout */

const isKeyed = () => isVideo() && theme().layout === 'keyframes'
const EASES = ['linear', 'inOutCubic', 'inOutSine', 'outCubic', 'outQuart', 'outBack', 'inOutQuart', 'outExpo']
const playhead = () => Number($('#scrub').value) / 1000

function renderKeys() {
  const box = $('#keys')
  const bar = $('#keybar')
  fill(box)
  bar.hidden = !isKeyed()
  document.body.classList.toggle('keyed', isKeyed())
  if (!isKeyed()) return
  const own = !!theme().motion.keys?.length
  const keys = keysOf(theme())
  const near = keys.findIndex((k) => Math.abs((k.at ?? 0) - playhead()) < KEY_SNAP)
  keys.forEach((k, i) => {
    const b = h('button', { class: `keymark${i === near ? ' on' : ''}${own ? '' : ' implied'}`, style: { left: `${(k.at ?? 0) * 100}%` }, title: `Key at ${Math.round((k.at ?? 0) * 100)}% — click to go there`, onclick: () => seekTo((k.at ?? 0) * duration) })
    box.append(b)
  })
  const key = near >= 0 ? keys[near] : null
  fill(bar,
    h('button', { class: 'chip', title: 'Pose the device or camera, then keep that pose here (also made by any drag)', onclick: () => keyOp({ op: 'add' }) }, h('span', { html: ICON.key }), key && own ? 'Key here ✓' : 'Add key here'),
    key && own
      ? h('select', { class: 'in small', title: 'How the move eases into this key', onchange: (e) => keyOp({ op: 'ease', ease: e.target.value }) }, ...EASES.map((x) => h('option', { value: x, selected: x === (key.ease ?? 'inOutCubic') }, x)))
      : null,
    key && own ? h('button', { class: 'chip', onclick: () => keyOp({ op: 'remove' }) }, 'Remove key') : null,
    h('span', { class: 'dim' }, !own ? 'Default move — drag the device at any moment to make your own.' : `${keys.length} keys · drag the device or use the camera tool to pose a key at the playhead`),
  )
}

/** Key edits at the playhead, stored like any override. */
function keyOp({ op, ease }) {
  const t = theme()
  const at = Math.round(playhead() * 1000) / 1000
  const keys = structuredClone(keysOf(t))
  const i = keys.findIndex((k) => Math.abs((k.at ?? 0) - at) < KEY_SNAP)
  let text
  if (op === 'add') {
    if (i >= 0) return toast({ title: 'There is already a key here — drag the device to change it', timeout: 2500 })
    // The pose the move passes through here becomes a key of its own: nothing jumps, and it is now there to edit.
    const v = keyTrack(keys, t)(at)
    const r = (x, n = 3) => Math.round(x * 10 ** n) / 10 ** n
    keys.push({ at, x: r(v.x), y: r(v.y), size: r(v.size), pose: [r(v.rx, 1), r(v.ry, 1), r(v.rz, 1)], cam: { yaw: r(v.yaw, 1), pitch: r(v.pitch, 1), dist: r(v.dist) } })
    text = `Added a keyframe at ${Math.round(at * 100)}%`
  } else if (op === 'remove' && i >= 0) {
    if (keys.length <= 1) return toast({ title: 'A move needs at least one key', timeout: 2500 })
    keys.splice(i, 1)
    text = `Removed the keyframe at ${Math.round(at * 100)}%`
  } else if (op === 'ease' && i >= 0) {
    keys[i].ease = ease
    text = `Keyframe at ${Math.round(at * 100)}% eases ${ease}`
  } else return
  keys.sort((a, b) => (a.at ?? 0) - (b.at ?? 0))
  state.overridesByCat[state.category] = setPath(overrides(), 'motion.keys', keys)
  save()
  retuneAll()
  renderKeys()
  record('keyframe', text, { at, keys })
}

function seekTo(t) {
  pause()
  $('#scrub').value = duration ? Math.round((t / duration) * 1000) : 0
  $('#time').textContent = `${t.toFixed(1)} / ${duration.toFixed(1)}s`
  frames[0]?.iframe.contentWindow.postMessage({ type: 'stage:seek', time: t, fast: true }, '*')
  renderKeys()
}
function setTime(t) {
  $('#time').textContent = `${t.toFixed(1)} / ${duration.toFixed(1)}s`
  if (!scrubbing) $('#scrub').value = duration ? Math.round((t / duration) * 1000) : 0
}
function updatePlayButton() {
  $('#play').innerHTML = playing ? ICON.pause : ICON.play
}
function play() {
  const f = frames[0]
  if (!f) return
  playing = true
  updatePlayButton()
  f.iframe.contentWindow.postMessage({ type: 'stage:play', time: (Number($('#scrub').value) / 1000) * duration }, '*')
}
function pause() {
  playing = false
  updatePlayButton()
  frames[0]?.iframe.contentWindow.postMessage({ type: 'stage:pause' }, '*')
}
let scrubbing = false
$('#play').onclick = () => (playing ? pause() : play())
$('#scrub').addEventListener('input', () => {
  scrubbing = true
  pause()
  const t = (Number($('#scrub').value) / 1000) * duration
  $('#time').textContent = `${t.toFixed(1)} / ${duration.toFixed(1)}s`
  frames[0]?.iframe.contentWindow.postMessage({ type: 'stage:seek', time: t, fast: true }, '*')
})
$('#scrub').addEventListener('change', () => {
  scrubbing = false
  renderKeys()
})

/* ── top bar ───────────────────────────────────────────────────────────── */

function renderCats() {
  const inner = h('div', { class: 'cats-inner' })
  for (const [id, c] of Object.entries(catalog.categories)) {
    inner.append(
      h(
        'button',
        { class: `cat${id === state.category ? ' on' : ''}`, role: 'tab', title: c.blurb, onclick: () => setCategory(id) },
        h('span', { class: 'label' }, c.name.replace(' screenshots', '').replace('Social media ', 'Social ').replace('Mobile screens video', 'Screen video')),
        c.kind === 'video' ? h('span', { class: 'kind' }, 'VIDEO') : c.uses3d && id !== 'app-store' && id !== 'social-card' ? h('span', { class: 'kind' }, '3D') : null,
      ),
    )
  }
  fill($('#cats'), inner)
}

function renderSizes() {
  const sel = $('#size')
  fill(sel,
    ...cat().sizes.map((k) => {
      const s = catalog.sizes[k]
      return h('option', { value: k, selected: k === sizeKey() }, `${s.label} · ${s.w}×${s.h}`)
    }),
  )
}
$('#size').onchange = (e) => {
  state.sizeByCat[state.category] = e.target.value
  save()
  buildFrames()
  record('size', `Size: ${size().label ?? size().key} (${size().w}×${size().h})`, { size: e.target.value })
}

function setCategory(id) {
  if (id === state.category) return
  pause()
  state.category = id
  state.focus = null
  state.index = 0
  save()
  renderAll()
  record('category', `Switched to ${cat().name} (theme ${themeId()})`, { category: id, theme: themeId() })
}

function renderAll() {
  renderCats()
  renderSizes()
  renderThemes()
  renderTools()
  buildFrames()
  renderPanel()
  renderKeys()
}

/* ── theme dock ────────────────────────────────────────────────────────── */

function renderThemes() {
  const list = Object.values(allThemes())
  $('#theme-label').textContent = `${cat().name}`
  $('#theme-meta').textContent = `${list.length} themes · ${currentThemeRaw().name ?? themeId()}${currentThemeRaw().inspiredBy ? ` — inspired by ${currentThemeRaw().inspiredBy.split(' — ')[0]}` : ''}`
  const box = $('#themes')
  fill(box,
    ...list.map((raw) => {
      const t = resolveTheme(state.category, raw.id, { custom })
      const p = t.palette
      const rot = t.device.pose?.[2] ?? 0
      const card = h(
        'button',
        {
          class: `tcard${raw.id === themeId() ? ' on' : ''}`,
          title: `${raw.blurb ?? ''}${raw.inspiredBy ? `\nInspired by: ${raw.inspiredBy}` : ''}`,
          style: {
            '--c-bg': p.bg,
            '--c-bg2': t.background.kind === 'solid' ? p.bg : p.bg2,
            '--c-ink': p.ink,
            '--c-accent': p.accent,
            '--c-frame': t.device.mode === 'frameless' ? 'transparent' : t.device.mode === 'flat' ? t.device.frame : (t.device.finish ?? '#d9d9de'),
            '--c-rot': `${rot + (t.device.pose?.[1] ?? 0) * -0.15}deg`,
          },
          onclick: () => setTheme(raw.id),
        },
        h(
          'div',
          { class: 'sw' },
          h('div', { class: 'dots' }, ...[p.accent, p.accent2, p.bg3].map((c) => h('i', { style: { '--c': c } }))),
          h('span', { class: 'aa', style: { fontFamily: fontStack(t.type.display), fontWeight: t.type.weight, fontStyle: t.type.italic ? 'italic' : 'normal', textTransform: t.type.case === 'upper' ? 'uppercase' : 'none' } }, 'A', h('em', {}, 'a')),
          t.device.mode === 'none' ? null : h('div', { class: 'ph' }),
        ),
        h('div', { class: 'tn' }, raw.name ?? raw.id, raw.file ? h('span', { class: 'badge' }, 'CUSTOM') : null),
        h('div', { class: 'ts' }, raw.appCategory ?? catalog.layouts[t.layout]?.label ?? ''),
      )
      return card
    }),
  )
  // Load every display font used by the cards.
  const ids = new Set(list.map((raw) => resolveTheme(state.category, raw.id, { custom }).type.display))
  for (const id of ids) {
    const f = catalog.fonts[id]
    if (!f) continue
    const href = `/fonts/${f.pkg}/${f.css[0]}`
    if (!document.querySelector(`link[href="${href}"]`)) document.head.append(h('link', { rel: 'stylesheet', href }))
  }
  $('.tcard.on', box)?.scrollIntoView({ block: 'nearest', inline: 'center' })
}

function setTheme(id) {
  if (id === themeId()) return
  const had = Object.keys(overrides()).length
  const previous = { theme: themeId(), overrides: overrides() }
  state.themeByCat[state.category] = id
  state.overridesByCat[state.category] = {}
  save()
  renderThemes()
  buildFrames()
  renderPanel()
  record('theme', `Theme: ${currentThemeRaw().name ?? id}${had ? ` (cleared ${had} tweak group${had > 1 ? 's' : ''})` : ''}`, { theme: id })
  if (had) {
    toast({
      title: 'Theme switched — your tweaks were cleared',
      actions: [
        {
          label: 'Keep them',
          run: () => {
            state.overridesByCat[state.category] = previous.overrides
            save()
            buildFrames()
            renderPanel()
            record('overrides.keep', `Kept the earlier tweaks on ${currentThemeRaw().name ?? id}`, { overrides: previous.overrides })
          },
        },
      ],
      timeout: 5000,
    })
  }
}
$('#shuffle').onclick = () => {
  const ids = Object.keys(allThemes()).filter((x) => x !== themeId())
  setTheme(ids[Math.floor(Math.random() * ids.length)])
}

/* ── overrides ─────────────────────────────────────────────────────────── */

function setOverride(path, value) {
  state.overridesByCat[state.category] = setPath(overrides(), path, value)
  save()
  retuneAll()
  syncField(path)
  if (path === 'motion.keys' || path === 'layout') renderKeys()
  record('override', `${pathLabel(path)} = ${show(value)}`, { path, value }, { coalesce: path })
}
function clearOverride(path) {
  const o = merge(overrides())
  const keys = path.split('.')
  let node = o
  for (const k of keys.slice(0, -1)) {
    if (!isObj(node[k])) return
    node = node[k]
  }
  delete node[keys.at(-1)]
  // prune empty objects
  const prune = (x) => {
    for (const [k, v] of Object.entries(x)) {
      if (isObj(v)) {
        prune(v)
        if (!Object.keys(v).length) delete x[k]
      }
    }
  }
  prune(o)
  state.overridesByCat[state.category] = o
  save()
  retuneAll()
  renderPanel()
  renderKeys()
  record('override.reset', `Reset ${pathLabel(path)} to the theme's value`, { path })
}

/* ── slides ────────────────────────────────────────────────────────────── */

function ensureOwnSlides() {
  if (usingSamples()) state.slides = structuredClone(slides())
  return state.slides
}

function pickFiles(cb) {
  const input = $('#file')
  input.value = ''
  input.onchange = () => input.files.length && cb([...input.files])
  input.click()
}

async function upload(file) {
  const r = await fetch(`/api/upload?name=${encodeURIComponent(file.name)}`, { method: 'POST', body: file })
  const body = await r.json()
  if (!r.ok) throw new Error(body.error)
  return body
}

async function addFiles(files) {
  const t = toast({ title: `Uploading ${files.length} file${files.length > 1 ? 's' : ''}…`, progress: 0 })
  try {
    // Replacing the samples: the first real upload starts a fresh list.
    const list = usingSamples() ? (state.slides = []) : state.slides
    let n = 0
    for (const file of files) {
      const screen = await upload(file)
      list.push({ screen, title: suggestTitle(file.name), subtitle: '' })
      t.progress(++n / files.length)
    }
    state.focus = null
    save()
    t.close()
    buildFrames()
    renderPanel()
    record('slide.add', `Added ${files.length} screen${files.length > 1 ? 's' : ''}: ${files.map((f) => f.name).join(', ')}`, { files: list.slice(-files.length).map((x) => x.screen.path) })
  } catch (err) {
    t.close()
    toast({ title: 'Upload failed', sub: String(err.message ?? err), error: true })
  }
}

async function replaceScreen(i, file, key = 'screen') {
  const list = ensureOwnSlides()
  try {
    list[i][key] = await upload(file)
    save()
    buildFrames()
    renderPanel()
    record('slide.screen', `Slide ${i + 1}: ${key === 'desktop' ? 'desktop screen' : 'screen'} is now ${file.name}`, { slide: i + 1, key, file: list[i][key].path })
  } catch (err) {
    toast({ title: 'Upload failed', sub: String(err.message ?? err), error: true })
  }
}

function suggestTitle(name) {
  const base = name.replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ').replace(/\b(screenshot|simulator|screen shot|iphone|img)\b/gi, '').replace(/\d{2,}/g, '').trim()
  return base ? base[0].toUpperCase() + base.slice(1) : 'Your *headline* here'
}

function moveSlide(i, d) {
  const list = ensureOwnSlides()
  const j = i + d
  if (j < 0 || j >= list.length) return
  ;[list[i], list[j]] = [list[j], list[i]]
  if (state.focus === i) state.focus = j
  save()
  buildFrames()
  renderPanel()
  record('slide.move', `Moved slide ${i + 1} to position ${j + 1}`, { from: i + 1, to: j + 1 })
}
function removeSlide(i) {
  const list = ensureOwnSlides()
  const [gone] = list.splice(i, 1)
  if (state.focus != null) state.focus = null
  save()
  buildFrames()
  renderPanel()
  record('slide.remove', `Removed slide ${i + 1}${gone.title ? ` (“${String(gone.title).replace(/\*/g, '')}”)` : ''}`, { slide: i + 1 })
  toast({ title: 'Slide removed', timeout: 4000, actions: [{ label: 'Undo', run: undo }] })
}
function toggleFocus(i) {
  state.focus = state.focus === i ? null : i
  layoutFrames()
  refreshAll({ delay: 0 })
  if (state.focus != null) frames[i]?.el.scrollIntoView({ inline: 'center' })
}

function renderSlidePicker() {
  $('.slide-pick')?.remove()
  document.body.classList.remove('has-picker')
  if (cat().set || isVideo() || slides().length < 2) return
  document.body.classList.add('has-picker')
  const bar = h('div', { class: 'slide-pick' }, h('span', { class: 'dim', style: { padding: '4px 6px' } }, 'Content from'))
  slides().forEach((s, i) => bar.append(h('button', { class: `chip${i === state.index ? ' on' : ''}`, onclick: () => ((state.index = i), renderSlidePicker(), refreshAll({ delay: 0 })) }, `Slide ${i + 1}`)))
  $('#viewport').append(bar)
}

/* ── drag and drop ─────────────────────────────────────────────────────── */

let dragDepth = 0
window.addEventListener('dragenter', (e) => {
  if (![...e.dataTransfer.types].includes('Files')) return
  dragDepth++
  $('#drop').hidden = false
})
window.addEventListener('dragleave', () => {
  if (--dragDepth <= 0) $('#drop').hidden = true
})
window.addEventListener('dragover', (e) => e.preventDefault())
window.addEventListener('drop', (e) => {
  e.preventDefault()
  dragDepth = 0
  $('#drop').hidden = true
  const model = [...e.dataTransfer.files].find((f) => /\.glb$/i.test(f.name))
  if (model) return addModel(model)
  if ([...e.dataTransfer.files].some((f) => /\.(gltf|fbx|obj|usdz|blend)$/i.test(f.name))) return toast({ title: 'Models need to be .glb', sub: 'Export or convert it to binary glTF, then drop it here.', error: true })
  const files = [...e.dataTransfer.files].filter((f) => /^(image|video)\//.test(f.type) || /\.(png|jpe?g|webp|mp4|mov|webm)$/i.test(f.name))
  if (!files.length) return
  // Dropped on a frame of a set: replace that slide's screen.
  const frameEl = e.target.closest?.('.frame')
  if (frameEl && cat().set && files.length === 1 && !usingSamples()) replaceScreen(Number(frameEl.dataset.index), files[0])
  else addFiles(files)
})

/* ── panel ─────────────────────────────────────────────────────────────── */

function setPanel(open) {
  state.panel = open
  document.body.classList.toggle('panel-open', open)
  $('#btn-panel').classList.toggle('on', open)
  save()
  setTimeout(() => (layoutFrames(), refreshAll({ delay: 0 })), 260)
}
$('#btn-panel').onclick = () => setPanel(!state.panel)
$('#panel-close').onclick = () => setPanel(false)
$$('.panel-tabs [data-tab]').forEach((b) =>
  b.addEventListener('click', () => {
    state.tab = b.dataset.tab
    renderPanel()
  }),
)

function renderPanel() {
  $$('.panel-tabs [data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === state.tab))
  $$('.panel-body').forEach((p) => (p.hidden = p.dataset.pane !== state.tab))
  if (state.tab === 'slides') renderSlidesPane()
  if (state.tab === 'style') renderStylePane()
  if (state.tab === 'output') renderOutputPane()
  if (state.tab === 'history') renderHistoryPane()
}

function input(value, onchange, attrs = {}) {
  const el = h('input', { class: 'in', value: value ?? '', ...attrs })
  el.addEventListener('change', () => onchange(el.value))
  return el
}
function textarea(value, onchange, attrs = {}) {
  const el = h('textarea', { class: 'in', rows: 2, ...attrs })
  el.value = value ?? ''
  el.addEventListener('change', () => onchange(el.value))
  return el
}

function renderSlidesPane() {
  const pane = $('#pane-slides')
  const list = slides()
  const video = isVideo()
  fill(pane,
    h('div', { class: 'section-title' }, `Slides (${list.length})`, h('span', { class: 'spacer' }), h('button', { class: 'btn small ghost', onclick: () => pickFiles(addFiles) }, h('span', { html: ICON.plus }), 'Add')),
    usingSamples() ? h('p', { class: 'note' }, 'Showing the bundled sample app. Drop your own screenshots or recordings to replace it — edits here copy the samples into your project.') : null,
    ...list.map((s, i) => {
      const upd = (k) => (v) => {
        ensureOwnSlides()[i][k] = v === '' ? undefined : v
        save()
        refreshAll()
        record('slide.edit', `Slide ${i + 1} ${k}: ${v === '' ? 'cleared' : show(v)}`, { slide: i + 1, field: k, value: v === '' ? null : v })
      }
      const thumb = s.screen?.kind === 'video' ? `${s.screen.frames.base}00001.jpg` : s.screen?.url
      return h(
        'div',
        { class: `slide${(cat().set ? state.focus : state.index) === i ? ' on' : ''}` },
        h(
          'div',
          { class: 'thumb', style: { backgroundImage: thumb ? `url("${thumb}")` : 'none' }, title: 'Replace', onclick: () => pickFiles((f) => replaceScreen(i, f[0])) },
          s.screen?.kind === 'video' ? h('span', { class: 'kind' }, `${s.screen.duration.toFixed(1)}s`) : null,
        ),
        h(
          'div',
          { class: 'fields' },
          h(
            'div',
            { class: 'head' },
            h('b', {}, `Slide ${i + 1}`),
            h('button', { class: 'icon-btn', title: 'Move up', html: ICON.left, style: { transform: 'rotate(90deg)' }, onclick: () => moveSlide(i, -1) }),
            h('button', { class: 'icon-btn', title: 'Move down', html: ICON.right, style: { transform: 'rotate(90deg)' }, onclick: () => moveSlide(i, 1) }),
            h('button', { class: 'icon-btn', title: 'Remove', html: ICON.trash, onclick: () => removeSlide(i) }),
          ),
          input(s.kicker, upd('kicker'), { placeholder: 'Kicker' }),
          textarea(s.title, upd('title'), { placeholder: 'Headline — *highlight* words, " | " breaks' }),
          textarea(s.subtitle, upd('subtitle'), { placeholder: 'Subtitle' }),
          h(
            'details',
            {},
            h('summary', {}, 'More: desktop screen, timing, focus, decor, per-slide style'),
            h('div', { class: 'row', style: { marginTop: '6px' } }, h('button', { class: 'btn small ghost', onclick: () => pickFiles((f) => replaceScreen(i, f[0], 'desktop')) }, s.desktop ? 'Replace desktop screen' : 'Add desktop screen (laptop)')),
            video ? h('div', { class: 'field' }, h('label', {}, 'Hold (s)'), input(s.hold, (v) => upd('hold')(v === '' ? '' : Number(v)), { type: 'number', step: 0.1, placeholder: 'auto' }), h('span')) : null,
            h('div', { class: 'field' }, h('label', { title: 'x, y, zoom — zoom-tour target' }, 'Focus x,y,zoom'), input(s.focus?.join(','), (v) => upd('focus')(v ? v.split(',').map(Number) : '')), h('span')),
            h('p', { class: 'note' }, 'Decor (JSON list) — badge, rating, laurels, chips, notification, stat, callout, arrow, logo, store-badge, sparkles, confetti, blob, orbs, rings, shapes'),
            textarea(s.decor ? JSON.stringify(s.decor, null, 1) : '', (v) => {
              try {
                upd('decor')(v.trim() ? JSON.parse(v) : '')
              } catch (err) {
                toast({ title: 'Decor is not valid JSON', sub: err.message, error: true })
              }
            }, { class: 'in code', placeholder: '[{"kind":"badge","text":"4.9 ★","x":0.5,"y":0.93}]' }),
            h('p', { class: 'note' }, 'Per-slide theme overrides (JSON), e.g. {"device":{"pose":[0,20,-6]}}'),
            textarea(s.theme ? JSON.stringify(s.theme) : '', (v) => {
              try {
                upd('theme')(v.trim() ? JSON.parse(v) : '')
              } catch (err) {
                toast({ title: 'Not valid JSON', sub: err.message, error: true })
              }
            }, { class: 'in code' }),
          ),
        ),
      )
    }),
    h('div', { class: 'section-title' }, 'Brand'),
    h('p', { class: 'note' }, 'Used by intro/outro cards, logo and store badges.'),
    ...['name', 'tagline', 'cta', 'url'].map((k) =>
      h('div', { class: 'field' }, h('label', {}, k[0].toUpperCase() + k.slice(1)), input(brand()[k], (v) => ((state.brand = { ...brand(), [k]: v || undefined }), save(), refreshAll(), record('brand', `Brand ${k}: ${v || 'cleared'}`, { field: k, value: v || null }))), h('span')),
    ),
  )
}

/* style pane, generated from the schema */

const fieldRefs = new Map()
function renderStylePane() {
  const pane = $('#pane-style')
  const t = theme()
  const o = overrides()
  fieldRefs.clear()
  const kind = cat().kind
  const layouts = Object.entries(catalog.layouts).filter(([, l]) => l.kind === kind)
  const top = h(
    'div',
    {},
    h(
      'div',
      { class: 'section-title' },
      currentThemeRaw().name ?? themeId(),
      h('span', { class: 'spacer' }),
      h('button', { class: 'btn small ghost', onclick: () => ((state.overridesByCat[state.category] = {}), save(), retuneAll(), renderPanel(), renderKeys(), record('overrides.reset', `Reset every tweak on ${currentThemeRaw().name ?? themeId()}`)) }, h('span', { html: ICON.reset }), 'Reset'),
      h('button', { class: 'btn small ghost', onclick: saveTheme }, 'Save as theme'),
    ),
    currentThemeRaw().inspiredBy ? h('p', { class: 'note' }, `Inspired by ${currentThemeRaw().inspiredBy}`) : null,
    h(
      'div',
      { class: 'field' + (o.layout ? ' changed' : '') },
      h('label', {}, 'Layout'),
      h(
        'select',
        {
          class: 'in',
          onchange: (e) => {
            const id = e.target.value
            state.overridesByCat[state.category] = merge(overrides(), catalog.layouts[id].defaults ?? {}, { layout: id })
            save()
            refreshAll()
            renderPanel()
            renderKeys()
            record('layout', `Layout: ${id} — ${catalog.layouts[id].label}`, { layout: id })
          },
        },
        ...layouts.map(([id, l]) => h('option', { value: id, selected: id === t.layout }, `${id} — ${l.label}`)),
      ),
      h('button', { class: 'icon-btn reset', html: ICON.reset, title: 'Reset', onclick: () => clearOverride('layout') }),
    ),
  )
  const groups = new Map()
  for (const f of catalog.schema) {
    if (f.path === 'layout') continue
    if (f.group === 'Motion' && kind !== 'video') continue
    if (!groups.has(f.group)) groups.set(f.group, [])
    groups.get(f.group).push(f)
  }
  const openGroups = new Set(JSON.parse(sessionStorage.getItem('open-groups') ?? '["Colors","Type","Device"]'))
  const sections = [...groups].map(([name, fields]) => {
    const count = fields.filter((f) => getPath(o, f.path) !== undefined).length
    const det = h('details', { class: 'group', open: openGroups.has(name) }, h('summary', {}, name, count ? h('span', { class: 'count' }, `${count} changed`) : null), ...fields.map((f) => fieldControl(f, t, o)))
    det.addEventListener('toggle', () => {
      det.open ? openGroups.add(name) : openGroups.delete(name)
      sessionStorage.setItem('open-groups', JSON.stringify([...openGroups]))
    })
    return det
  })
  const own = ownDevices[t.device.model] && t.device.mode === '3d' ? modelSetup(t.device.model) : null
  const raw = h('details', { class: 'group' }, h('summary', {}, 'Raw overrides (JSON)'), h('p', { class: 'note' }, 'Everything above lands here. Any theme key works — scene.rims, background.shapes, bento, wall…'))
  raw.append(
    textarea(JSON.stringify(o, null, 2), (v) => {
      try {
        state.overridesByCat[state.category] = v.trim() ? JSON.parse(v) : {}
        save()
        retuneAll()
        renderPanel()
        renderKeys()
        record('overrides.raw', 'Edited the raw overrides JSON', { overrides: overrides() })
      } catch (err) {
        toast({ title: 'Not valid JSON', sub: err.message, error: true })
      }
    }, { class: 'in code', rows: 10 }),
  )
  fill(pane, top, ...(own ? [own] : []), ...sections, raw)
}

function fieldControl(f, t, o) {
  const value = getPath(t, f.path)
  const changed = getPath(o, f.path) !== undefined
  let ctl
  const set = (v) => setOverride(f.path, v)
  switch (f.type) {
    case 'color': {
      const text = input(value ?? '', (v) => set(v === '' && f.nullable ? null : v), { placeholder: f.nullable ? 'none' : '' })
      const hex = /^#[0-9a-f]{6}$/i.test(value ?? '') ? value : '#000000'
      const pick = h('input', { type: 'color', class: 'swatch', value: hex })
      pick.addEventListener('input', () => {
        text.value = pick.value
        set(pick.value)
      })
      ctl = h('div', { class: 'ctl' }, pick, text)
      break
    }
    case 'range': {
      const r = h('input', { type: 'range', min: f.min, max: f.max, step: f.step, value: value ?? f.min })
      const n = h('input', { class: 'in num', type: 'number', min: f.min, max: f.max, step: f.step, value: value ?? '' })
      r.addEventListener('input', () => {
        n.value = r.value
        set(Number(r.value))
      })
      n.addEventListener('change', () => {
        r.value = n.value
        set(Number(n.value))
      })
      ctl = h('div', { class: 'ctl' }, r, n)
      break
    }
    case 'select':
    case 'font': {
      const options = f.path === 'device.model' ? [...f.options, ...Object.keys(ownDevices)] : f.options
      ctl = h(
        'select',
        { class: 'in', onchange: (e) => set(typeof f.options[0] === 'number' ? Number(e.target.value) : e.target.value) },
        ...options.map((x) => h('option', { value: x, selected: String(x) === String(value) }, f.type === 'font' ? `${x} — ${catalog.fonts[x].kind}` : ownDevices[x] ? `${x} — yours` : String(x))),
      )
      if (f.path === 'device.model') ctl = h('div', { class: 'ctl col' }, ctl, h('button', { class: 'btn small ghost', onclick: () => pickModel() }, h('span', { html: ICON.plus }), 'Add your own 3D model (.glb)'))
      break
    }
    case 'bool': {
      const cb = h('input', { type: 'checkbox', checked: !!value })
      cb.addEventListener('change', () => set(cb.checked))
      ctl = h('label', { class: 'toggle' }, cb, h('span'))
      break
    }
    case 'vec3':
    case 'pose': {
      const p = value ?? [0, 0, 0]
      ctl = h(
        'div',
        { class: 'pose' },
        ...[0, 1, 2].map((k) => {
          const n = h('input', { class: 'in', type: 'number', step: f.type === 'vec3' ? 0.1 : 1, value: p[k] ?? 0, title: (f.type === 'vec3' ? ['x: from the right', 'y: from above', 'z: from the camera'] : ['tilt x', 'turn y', 'roll z'])[k] })
          n.addEventListener('change', () => {
            const next = [...(getPath(theme(), f.path) ?? [0, 0, 0])]
            next[k] = Number(n.value)
            set(next)
          })
          return n
        }),
      )
      break
    }
    case 'list':
      ctl = textarea(JSON.stringify(value ?? []), (v) => {
        try {
          set(JSON.parse(v || '[]'))
        } catch (err) {
          toast({ title: 'Not valid JSON', sub: err.message, error: true })
        }
      }, { class: 'in code', rows: 3 })
      break
    default:
      ctl = input(value ?? '', (v) => set(v === '' ? null : v))
  }
  const row = h('div', { class: `field${changed ? ' changed' : ''}` }, h('label', { title: f.path }, f.label), ctl, h('button', { class: 'icon-btn reset', title: 'Reset to theme', html: ICON.reset, onclick: () => clearOverride(f.path) }))
  fieldRefs.set(f.path, row)
  return row
}

function syncField(path) {
  const row = fieldRefs.get(path)
  if (row) row.classList.toggle('changed', getPath(overrides(), path) !== undefined)
}

async function saveTheme() {
  const name = prompt('Name for this theme (saved to .app-preview-craft/themes/):', `${themeId()}-custom`)
  if (!name) return
  const theme = { extends: `${state.category}/${themeId()}`, category: state.category, name, ...overrides() }
  const r = await fetch('/api/theme', { method: 'POST', body: JSON.stringify({ id: name, theme }) }).then((x) => x.json())
  if (r.error) return toast({ title: 'Could not save theme', sub: r.error, error: true })
  custom[r.id] = { ...theme, id: r.id, file: r.file }
  state.themeByCat[state.category] = r.id
  state.overridesByCat[state.category] = {}
  save()
  renderThemes()
  renderPanel()
  record('theme.save', `Saved the tweaks as theme “${r.id}” (${r.file})`, { theme: r.id, file: r.file })
  toast({ title: `Saved theme "${r.id}"`, sub: r.file, timeout: 5000 })
}

/* output pane */

function jobFor(opts = {}) {
  const list = slides().map((s) => ({
    screen: s.screen?.path,
    desktop: s.desktop?.path,
    title: s.title,
    subtitle: s.subtitle,
    kicker: s.kicker,
    decor: s.decor,
    theme: s.theme,
    focus: s.focus,
    hold: s.hold,
  }))
  const ex = { ...state.export, ...opts }
  return {
    category: state.category,
    theme: themeId(),
    themeOverrides: overrides(),
    size: (ex.sizes?.[state.category]?.length ? ex.sizes[state.category] : [sizeKey()]).join(','),
    format: ex.format?.[state.category],
    transparent: ex.transparent || undefined,
    all: ex.all || undefined,
    index: cat().set ? undefined : state.index,
    slides: list,
    brand: state.brand ?? (usingSamples() ? boot.samples.brand : undefined),
    out: ex.out || undefined,
  }
}

const shellQuote = (s) => (/^[\w./,:=@%+-]+$/.test(String(s)) ? String(s) : `'${String(s).replace(/'/g, `'\\''`)}'`)
function flatten(obj, prefix = '', out = []) {
  for (const [k, v] of Object.entries(obj ?? {})) {
    const p = prefix ? `${prefix}.${k}` : k
    if (isObj(v)) flatten(v, p, out)
    else out.push([p, Array.isArray(v) || isObj(v) ? JSON.stringify(v) : String(v)])
  }
  return out
}
function cliCommand() {
  const j = jobFor()
  const parts = ['node', '"$SKILL/scripts/cli.mjs"', j.category]
  if (!usingSamples()) parts.push(...j.slides.map((s) => shellQuote(s.screen)))
  parts.push('--theme', j.theme, '--size', j.size)
  if (!usingSamples()) for (const s of j.slides) parts.push('--title', shellQuote(s.title ?? ''))
  if (j.format) parts.push('--format', j.format)
  if (j.transparent) parts.push('--transparent')
  for (const [p, v] of flatten(j.themeOverrides)) parts.push('--set', shellQuote(`${p}=${v}`))
  return parts.join(' ')
}

function renderOutputPane() {
  const pane = $('#pane-output')
  fill(pane,
    h('div', { class: 'section-title' }, 'Where files go'),
    h('p', { class: 'note' }, 'Exports land in ', h('code', {}, boot.outDir), ' unless you set a folder below (relative to the project).'),
    h('div', { class: 'field' }, h('label', {}, 'Output folder'), input(state.export.out ?? '', (v) => ((state.export.out = v), save()), { placeholder: '.' }), h('span')),
    h('div', { class: 'section-title' }, 'Same render from the terminal'),
    h('p', { class: 'note' }, 'The agent skill runs exactly this. $SKILL is the skill folder.'),
    h('code', { class: 'cmd' }, cliCommand()),
    h('div', { class: 'row', style: { marginTop: '8px' } }, h('button', { class: 'btn small ghost', onclick: () => navigator.clipboard.writeText(cliCommand()).then(() => toast({ title: 'Command copied', timeout: 2000 })) }, 'Copy command'), h('button', { class: 'btn small ghost', onclick: saveConfig }, 'Save app-preview-craft.json')),
    h('div', { class: 'section-title' }, '3D model credits'),
    h('p', { class: 'note' }, 'The device models are CC-BY-4.0. Exports that show one write CREDITS.txt beside the files; keep the credit when you publish.'),
    ...Object.values(catalog.devices).map((d) => h('p', { class: 'note' }, h('b', {}, d.name), ` — ${d.credit.author} · `, h('a', { href: d.credit.source, target: '_blank', style: { color: '#b9afff' } }, 'source'))),
  )
}

async function saveConfig() {
  const j = jobFor()
  const config = {
    category: j.category,
    theme: j.theme,
    themeOverrides: j.themeOverrides,
    size: j.size,
    brand: j.brand,
    out: j.out,
    slides: j.slides,
  }
  const r = await fetch('/api/config', { method: 'POST', body: JSON.stringify({ config }) }).then((x) => x.json())
  if (r.error) return toast({ title: 'Could not save config', sub: r.error, error: true })
  record('config.save', `Saved the project config to ${r.file}`, { file: r.file }, { undoable: false })
  toast({ title: 'Saved project config', sub: `${r.file} — render it with: cli.mjs --config ${r.file}`, timeout: 6000 })
}

/* ── export ────────────────────────────────────────────────────────────── */

const pop = $('#export-pop')
function renderExport() {
  const c = cat()
  const ex = state.export
  ex.sizes ??= {}
  ex.format ??= {}
  const chosen = new Set(ex.sizes[state.category]?.length ? ex.sizes[state.category] : [sizeKey()])
  const formats = c.kind === 'video' ? ['mp4', 'hevc', 'mov', 'webm', 'gif'] : ['png', 'jpg', 'webp', 'avif']
  const fmt = ex.format[state.category] ?? formats[0]
  fill(pop,
    h('h3', {}, `Export ${c.name.toLowerCase()}`),
    h('div', { class: 'note' }, c.set ? `${slides().length} slides × each size` : c.kind === 'video' ? 'Rendered frame by frame, encoded by ffmpeg' : 'One image per size'),
    h(
      'div',
      { class: 'sizes' },
      ...c.sizes.map((k) => {
        const s = catalog.sizes[k]
        const cb = h('input', { type: 'checkbox', checked: chosen.has(k) })
        cb.addEventListener('change', () => {
          cb.checked ? chosen.add(k) : chosen.delete(k)
          ex.sizes[state.category] = [...chosen]
          save()
        })
        return h('label', {}, cb, h('span', {}, s.label), h('small', {}, `${s.w}×${s.h}`))
      }),
    ),
    h(
      'div',
      { class: 'field' },
      h('label', {}, 'Format'),
      h('select', { class: 'in', onchange: (e) => ((ex.format[state.category] = e.target.value), save()) }, ...formats.map((x) => h('option', { value: x, selected: x === fmt }, { mov: 'mov (ProRes 4444, alpha)', webm: 'webm (VP9, alpha)', hevc: 'mp4 (HEVC)', mp4: 'mp4 (H.264)' }[x] ?? x))),
      h('span'),
    ),
    c.kind !== 'video' || true
      ? h(
          'div',
          { class: 'field' },
          h('label', {}, 'Transparent'),
          (() => {
            const cb = h('input', { type: 'checkbox', checked: !!ex.transparent })
            cb.addEventListener('change', () => ((ex.transparent = cb.checked), save()))
            return h('label', { class: 'toggle' }, cb, h('span'))
          })(),
          h('span'),
        )
      : null,
    !c.set && c.kind === 'still'
      ? h(
          'div',
          { class: 'field' },
          h('label', {}, 'Every slide'),
          (() => {
            const cb = h('input', { type: 'checkbox', checked: !!ex.all })
            cb.addEventListener('change', () => ((ex.all = cb.checked), save()))
            return h('label', { class: 'toggle' }, cb, h('span'))
          })(),
          h('span'),
        )
      : null,
    h('div', { class: 'note' }, 'Saving to ', h('code', {}, ex.out || boot.outDir)),
    h('div', { class: 'row', style: { justifyContent: 'flex-end', marginTop: '10px' } }, h('button', { class: 'btn ghost small', onclick: () => (pop.hidden = true) }, 'Cancel'), h('button', { class: 'btn primary', onclick: startExport }, 'Render')),
  )
}
$('#btn-export').onclick = () => {
  pop.hidden = !pop.hidden
  if (!pop.hidden) renderExport()
}
document.addEventListener('pointerdown', (e) => {
  if (!pop.hidden && !pop.contains(e.target) && !e.target.closest('#btn-export')) pop.hidden = true
})

async function startExport() {
  pop.hidden = true
  const job = jobFor()
  const t = toast({ title: `Rendering ${cat().name.toLowerCase()}`, sub: 'starting…', progress: 0, actions: [{ label: 'Cancel', keep: true, run: () => fetch(`/api/render/${id}/cancel`) }] })
  const { id, error } = await fetch('/api/render', { method: 'POST', body: JSON.stringify({ job, custom }) }).then((r) => r.json())
  if (error) {
    t.close()
    return toast({ title: 'Render failed to start', sub: error, error: true })
  }
  record('export.start', `Export started: ${cat().name}, ${job.size}${job.format ? `, ${job.format}` : ''}`, { job: { category: job.category, theme: job.theme, size: job.size, format: job.format, transparent: job.transparent } }, { undoable: false })
  const poll = async () => {
    const s = await fetch(`/api/render/${id}`).then((r) => r.json())
    t.progress(s.fraction)
    t.sub(s.label)
    if (!s.done) return setTimeout(poll, 400)
    t.close()
    if (s.error) {
      record('export.fail', `Export failed: ${s.error}`, { error: s.error }, { undoable: false })
      return toast({ title: 'Render failed', sub: s.error, error: true })
    }
    record('export.done', `Exported ${s.files.length} file${s.files.length === 1 ? '' : 's'}: ${s.files.map((f) => f.rel || f.path).join(', ')}`, { files: s.files.map((f) => f.path) }, { undoable: false })
    toast({
      title: `Done — ${s.files.length} file${s.files.length === 1 ? '' : 's'}`,
      sub: `${((Date.now() - s.started) / 1000).toFixed(1)}s`,
      files: s.files,
    })
  }
  poll()
}

/* ── tools: what a drag in the preview does ────────────────────────────── */

const TOOLS = [
  ['move', 'Move', 'V', 'Drag a device to move it · corner handles or the wheel resize · arrows nudge · drag a badge to place it'],
  ['turn', 'Turn', 'T', 'Drag a device to tilt and turn it · Shift-drag rolls it'],
  ['camera', 'Camera', 'K', 'Drag anywhere to orbit the camera · wheel moves it in and out · Shift-drag rolls'],
  ['light', 'Light', 'L', 'Click or drag where the key light comes from'],
]

function renderTools() {
  const bar = $('#tools')
  const still = cat().kind === 'still'
  fill(bar,
    ...TOOLS.map(([id, name, keyName, tip]) => h('button', { class: `tool${state.tool === id ? ' on' : ''}`, title: `${name} (${keyName}) — ${tip}`, onclick: () => setTool(id) }, h('span', { html: ICON[id] }), name)),
    h('span', { class: 'sep' }),
    still && slides().length > 1
      ? h(
          'div',
          { class: 'seg', title: 'Where a change made in the preview is kept' },
          h('button', { class: state.scope === 'all' ? 'on' : '', onclick: () => setScope('all') }, 'All slides'),
          h('button', { class: state.scope === 'slide' ? 'on' : '', onclick: () => setScope('slide') }, 'This slide'),
        )
      : null,
    still && slides().length > 1 ? h('span', { class: 'sep' }) : null,
    h('button', { class: 'tool icon', id: 'btn-undo', html: ICON.undo, onclick: undo }),
    h('button', { class: 'tool icon', id: 'btn-redo', html: ICON.redo, onclick: redo }),
  )
  updateHistoryUi()
  const tip = state.tool === 'pick' ? 'Click the part of the model that is its display · Esc to stop' : TOOLS.find(([id]) => id === state.tool)?.[3]
  $('#hint').textContent = `${tip} · click text to edit it · drop screenshots, recordings or a .glb model anywhere`
  document.body.dataset.tool = state.tool
}

function setTool(tool) {
  state.tool = tool
  renderTools()
  frames.forEach(sendTool)
}
function setScope(scope) {
  state.scope = scope
  renderTools()
  frames.forEach(sendTool)
  record('scope', scope === 'slide' ? 'Preview edits now apply to the slide they are made on' : 'Preview edits now apply to every slide', { scope }, { undoable: false })
}

/* ── your own 3D model ─────────────────────────────────────────────────── */

function pickModel() {
  const input = h('input', { type: 'file', accept: '.glb,model/gltf-binary' })
  input.onchange = () => input.files[0] && addModel(input.files[0])
  input.click()
}

async function addModel(file) {
  const t = toast({ title: `Reading ${file.name}…`, progress: 0.3 })
  try {
    const r = await fetch(`/api/model?name=${encodeURIComponent(file.name)}`, { method: 'POST', body: file })
    const body = await r.json()
    if (!r.ok) throw new Error(body.error)
    ownDevices[body.id] = body.device
    t.close()
    // A model wants a 3D layout to stand in: move to the mockup category if this one is flat.
    if (!cat().uses3d) state.category = 'device-mockup'
    state.overridesByCat[state.category] = merge(overrides(), { device: { mode: '3d', model: body.id, finish: null } })
    state.tab = 'style'
    sessionStorage.setItem('open-groups', JSON.stringify(['Device']))
    save()
    renderAll()
    setPanel(true)
    const d = body.device
    record('model.add', `Added own 3D model “${d.name}” (${body.id}) — screen ${d.screen ? JSON.stringify(d.screen) : 'not found yet'}`, { model: body.id, screen: d.screen, file: `.app-preview-craft/models/${body.id}.glb` })
    if (!d.screen || !d.inspect.confident) {
      setTool('pick')
      toast({ title: d.screen ? `Is “${d.screen.material ?? d.screen.mesh}” the display?` : 'Which part is the display?', sub: 'Click the screen of the model in the preview. If it faces away or lies down, turn it with the Rotate buttons in the panel.', timeout: 9000 })
    } else toast({ title: `${d.name} added`, sub: `Display: ${d.screen.material ?? d.screen.mesh}. Set it up under Style › Your model.`, timeout: 5000 })
  } catch (err) {
    t.close()
    toast({ title: 'Could not add the model', sub: String(err.message ?? err), error: true })
  }
}

async function updateModel(id, patch, text) {
  const r = await fetch(`/api/model/${id}`, { method: 'POST', body: JSON.stringify(patch) }).then((x) => x.json())
  if (r.error) return toast({ title: 'Could not save the model', sub: r.error, error: true })
  ownDevices[id] = r.device
  refreshAll({ delay: 0 })
  renderStylePane()
  record('model.update', `Model “${r.device.name}”: ${text}`, { model: id, ...patch }, { undoable: false })
}

function onPicked(msg) {
  if (state.tool !== 'pick' || !ownDevices[msg.model]) return
  const screen = msg.material ? { material: msg.material } : { mesh: msg.mesh }
  setTool('move')
  updateModel(msg.model, { screen }, `display is ${msg.material ? `material “${msg.material}”` : `mesh “${msg.mesh}”`}`)
}

function modelSetup(id) {
  const d = ownDevices[id]
  const rot = d.rotate ?? [0, 0, 0]
  const mats = d.inspect.materials.filter((m) => m.meshes.length)
  const screenValue = d.screen ? (d.screen.material != null ? `material:${d.screen.material}` : `mesh:${d.screen.mesh}`) : ''
  const turn = (axis, by) => {
    const next = [...rot]
    next[axis] = (((next[axis] + by) % 360) + 360) % 360
    updateModel(id, { rotate: next }, `rotated to ${next.join(', ')}°`)
  }
  const credit = d.credit ?? {}
  const setCredit = (k) => (v) => updateModel(id, { credit: { ...credit, [k]: v || undefined } }, `credit ${k}: ${v || 'cleared'}`)
  const toggleList = (key, name, on) => {
    const cur = key === 'hide' ? (d.hide ?? []).map((x) => x.material) : (d.body ?? [])
    const next = on ? [...new Set([...cur, name])] : cur.filter((x) => x !== name)
    updateModel(id, { [key]: next }, `${key === 'hide' ? 'hidden parts' : 'body (finish) parts'}: ${next.join(', ') || 'none'}`)
  }
  return h(
    'details',
    { class: 'group model-setup', open: true },
    h('summary', {}, `Your model · ${d.name}`, d.screen ? null : h('span', { class: 'count warn' }, 'no display set')),
    h('p', { class: 'note' }, `Saved in .app-preview-craft/models/${id}.json — the CLI picks it up from there as --device ${id}.`),
    h(
      'div',
      { class: 'field' },
      h('label', { title: 'The part of the model that shows your screenshot' }, 'Display'),
      h(
        'div',
        { class: 'ctl col' },
        h(
          'select',
          {
            class: 'in',
            onchange: (e) => {
              const [kind, ...rest] = e.target.value.split(':')
              const name = rest.join(':')
              updateModel(id, { screen: e.target.value ? { [kind]: name } : null }, e.target.value ? `display is ${kind} “${name}”` : 'display cleared')
            },
          },
          h('option', { value: '', selected: !screenValue }, '— none —'),
          ...mats.filter((m) => m.name).map((m) => h('option', { value: `material:${m.name}`, selected: screenValue === `material:${m.name}` }, `${m.name}${m.emissive ? ' · emissive' : ''}`)),
          ...d.inspect.meshes.filter(Boolean).map((n) => h('option', { value: `mesh:${n}`, selected: screenValue === `mesh:${n}` }, `mesh: ${n}`)),
        ),
        h('button', { class: `btn small ${state.tool === 'pick' ? 'primary' : 'ghost'}`, onclick: () => setTool(state.tool === 'pick' ? 'move' : 'pick') }, h('span', { html: ICON.pick }), state.tool === 'pick' ? 'Picking… click the display' : 'Pick it in the preview'),
        h('span', { class: 'dim', id: 'pick-hover' }, ''),
      ),
      h('span'),
    ),
    h(
      'div',
      { class: 'field' },
      h('label', { title: 'Turns the raw model so its display faces you, top up' }, 'Rotate'),
      h('div', { class: 'ctl col' }, h('div', { class: 'row' }, ...['X', 'Y', 'Z'].map((a, k) => h('button', { class: 'btn small ghost', title: `Turn 90° about ${a}`, onclick: () => turn(k, 90) }, `${a} +90°`))), h('span', { class: 'dim' }, `now ${rot.join(', ')}° — the display should face you, top up`)),
      h('span'),
    ),
    h(
      'div',
      { class: 'field' },
      h('label', { title: 'A phone is sized by its height, a laptop by its width' }, 'Kind'),
      h('select', { class: 'in', onchange: (e) => updateModel(id, { kind: e.target.value === 'auto' ? null : e.target.value }, `kind: ${e.target.value}`) }, ...['auto', 'phone', 'laptop'].map((x) => h('option', { value: x, selected: (d.kind ?? 'auto') === x }, x === 'auto' ? 'auto — by its proportions' : x))),
      h('span'),
    ),
    h(
      'div',
      { class: 'field' },
      h('label', { title: 'Draw the iPhone Dynamic Island over the display' }, 'Dynamic Island'),
      (() => {
        const cb = h('input', { type: 'checkbox', checked: !!d.island })
        cb.addEventListener('change', () => updateModel(id, { island: cb.checked }, `Dynamic Island ${cb.checked ? 'on' : 'off'}`))
        return h('label', { class: 'toggle' }, cb, h('span'))
      })(),
      h('span'),
    ),
    h(
      'details',
      {},
      h('summary', {}, `Parts (${mats.length} materials): body colour, cover glass`),
      h('p', { class: 'note' }, '“Body” parts take the Body finish colour. Hide a cover glass that dims or tints the display.'),
      h(
        'div',
        { class: 'parts' },
        ...mats.filter((m) => m.name).map((m) => {
          const body = h('input', { type: 'checkbox', checked: (d.body ?? []).includes(m.name) })
          body.addEventListener('change', () => toggleList('body', m.name, body.checked))
          const hide = h('input', { type: 'checkbox', checked: (d.hide ?? []).some((x) => x.material === m.name) })
          hide.addEventListener('change', () => toggleList('hide', m.name, hide.checked))
          return h('div', { class: 'part' }, h('span', { class: 't', title: m.meshes.join(', ') }, m.name), h('label', {}, body, 'body'), h('label', {}, hide, 'hide'))
        }),
      ),
    ),
    h(
      'details',
      { open: !credit.author },
      h('summary', {}, 'Credit', credit.author ? null : h('span', { class: 'count warn' }, 'none on record')),
      h('p', { class: 'note' }, 'Written to CREDITS.txt beside every export that shows this model. Most downloaded models (CC-BY) require it; your own work does not.'),
      ...[['title', 'Title'], ['author', 'Author'], ['license', 'License'], ['source', 'Source URL']].map(([k, label]) => h('div', { class: 'field' }, h('label', {}, label), input(credit[k], setCredit(k), { placeholder: k === 'license' ? 'CC-BY-4.0' : '' }), h('span'))),
    ),
  )
}

/* ── history pane: the transcript, as the agent reads it ───────────────── */

function renderHistoryPane() {
  const pane = $('#pane-history')
  const mine = new Set(history.slice(1, cursor + 1).map((x) => x.text))
  const list = [...events].reverse()
  fill(pane,
    h('div', { class: 'section-title' }, 'History', h('span', { class: 'spacer' }), h('button', { class: 'btn small ghost', disabled: cursor === 0, onclick: undo }, h('span', { html: ICON.undo }), 'Undo'), h('button', { class: 'btn small ghost', disabled: cursor >= history.length - 1, onclick: redo }, h('span', { html: ICON.redo }), 'Redo')),
    h('p', { class: 'note' }, 'Everything done here is written to ', h('code', {}, `${boot.transcript?.dir ?? '.app-preview-craft/studio'}/transcript.jsonl`), ', with the current setup beside it in ', h('code', {}, 'session.json'), '. Your coding agent reads both:'),
    h('code', { class: 'cmd' }, 'node "$SKILL/scripts/cli.mjs" transcript'),
    h(
      'div',
      { class: 'row', style: { marginTop: '8px' } },
      h('button', { class: 'btn small ghost', onclick: () => navigator.clipboard.writeText(agentBrief()).then(() => toast({ title: 'Copied — paste it to your agent', timeout: 2500 })) }, 'Copy a brief for the agent'),
    ),
    h('div', { class: 'section-title' }, `Transcript (${events.length})`),
    list.length ? null : h('p', { class: 'note' }, 'Nothing yet. Change a theme, drag the device, edit a headline — it shows up here.'),
    h(
      'ol',
      { class: 'events' },
      ...list.slice(0, 300).map((e) => h('li', { class: `${e.type?.split('.')[0] ?? ''}${mine.has(e.text) ? '' : ' past'}` }, h('time', {}, e.t ? new Date(e.t).toTimeString().slice(0, 5) : ''), h('span', {}, e.text ?? e.type))),
    ),
  )
}

function agentBrief() {
  const s = sessionNow()
  const changed = flatten(s.themeOverrides).map(([p, v]) => `  ${p} = ${v}`)
  return [
    `app-preview-craft studio session — ${cat().name}, theme ${s.theme}, size ${s.size}`,
    changed.length ? `Changed from the theme:\n${changed.join('\n')}` : 'No theme overrides.',
    `Render it: node "$SKILL/scripts/cli.mjs" --config ${boot.transcript?.dir ?? '.app-preview-craft/studio'}/session.json`,
    `Full transcript: node "$SKILL/scripts/cli.mjs" transcript`,
    '',
    'Last steps:',
    ...events.slice(-15).map((e) => `  - ${e.text ?? e.type}`),
  ].join('\n')
}

/* ── toasts ────────────────────────────────────────────────────────────── */

function toast({ title, sub, progress, error, files, actions = [], timeout }) {
  const subEl = h('div', { class: 'sub' }, sub ?? '')
  const bar = progress != null ? h('div', { class: 'bar' }, h('i')) : null
  const el = h(
    'div',
    { class: `toast${error ? ' err' : ''}` },
    h('div', { class: 'tt' }, title, h('span', { class: 'spacer' }), ...actions.map((a) => h('button', { class: 'chip', onclick: () => (a.run(), !a.keep && close()) }, a.label)), h('button', { class: 'icon-btn', style: { width: '22px', height: '22px' }, html: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>', onclick: () => close() })),
    sub != null ? subEl : null,
    bar,
    files?.length
      ? h(
          'div',
          { class: 'files' },
          ...files.map((f) => h('button', { title: 'Reveal in Finder', onclick: () => fetch('/api/reveal', { method: 'POST', body: JSON.stringify({ path: f.path }) }) }, f.rel || f.path)),
        )
      : null,
  )
  $('#toasts').append(el)
  const close = () => el.remove()
  if (timeout || (!progress && !files && !error)) setTimeout(close, timeout ?? 3500)
  return {
    close,
    progress: (p) => bar && ($('i', bar).style.width = `${Math.round(p * 100)}%`),
    sub: (s) => ((subEl.textContent = s ?? ''), !subEl.isConnected && el.insertBefore(subEl, bar)),
  }
}

/* ── keyboard ──────────────────────────────────────────────────────────── */

function onKey(e) {
  if (e.target.closest?.('input, textarea, select, [contenteditable]')) return
  const k = e.key.toLowerCase()
  if ((e.metaKey || e.ctrlKey) && k === 'z') return (e.preventDefault(), e.shiftKey ? redo() : undo())
  if ((e.metaKey || e.ctrlKey) && k === 'y') return (e.preventDefault(), redo())
  if (e.metaKey || e.ctrlKey) return
  const ids = Object.keys(allThemes())
  const i = ids.indexOf(themeId())
  const tool = { v: 'move', t: 'turn', k: 'camera', l: 'light' }[k]
  if (tool) setTool(tool)
  else if (e.key === 'ArrowRight') setTheme(ids[(i + 1) % ids.length])
  else if (e.key === 'ArrowLeft') setTheme(ids[(i - 1 + ids.length) % ids.length])
  else if (e.key === ' ' && isVideo()) (e.preventDefault(), playing ? pause() : play())
  else if (k === 'c') setPanel(!state.panel)
  else if (k === 'e') $('#btn-export').click()
  else if (k === 'r') $('#shuffle').click()
  else if (e.key === 'Escape') {
    pop.hidden = true
    if (state.tool === 'pick') setTool('move')
    else if (state.focus != null) toggleFocus(state.focus)
  } else if (/^[1-5]$/.test(e.key)) setCategory(Object.keys(catalog.categories)[Number(e.key) - 1])
}
window.addEventListener('keydown', onKey)

let resizeTimer
window.addEventListener('resize', () => {
  layoutFrames()
  clearTimeout(resizeTimer)
  resizeTimer = setTimeout(() => refreshAll({ delay: 0 }), 300)
})

document.body.classList.toggle('panel-open', state.panel)
$('#btn-panel').classList.toggle('on', state.panel)
renderAll()
if (boot.lost?.length) {
  toast({ title: `${boot.lost.length} screen${boot.lost.length > 1 ? 's are' : ' is'} no longer on disk`, sub: `${boot.lost.join(' · ')} — drop the file on its slide to put it back`, error: true })
}
if (boot.project?.missing?.length) {
  toast({ title: `${boot.project.missing.length} file(s) from the project config are missing`, sub: boot.project.missing.join(' · '), error: true })
}
