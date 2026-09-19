// Direct manipulation for the studio. Loaded only for `spec.editable`, which a
// render never sets, and it draws nothing the renderer captures: the overlay is
// DOM above the stage, and every gesture ends as a theme path and a value the
// studio stores as an override. The look itself changes through stage.patch,
// the same code that takes a slider change, so a drag shows what exports.
//
//   tools   move · turn · camera · light · pick (choose a model's screen)
//   always  corner handles and the wheel resize · decor drags · arrows nudge
import * as THREE from 'three'
import { deviceDef } from '../catalog/devices.js'
import { getPath, merge, setPath } from '../catalog/resolve.js'
import { KEY_SNAP, keysOf, keyTrack } from './keys.js'
import { clamp } from './ease.js'

const round = (v, n = 3) => Math.round(v * 10 ** n) / 10 ** n
const FIELD_DECOR = new Set(['sparkles', 'confetti', 'blob', 'orbs', 'rings', 'shapes', 'credit'])

export class Editor {
  constructor(stage) {
    this.stage = stage
    this.tool = 'move'
    this.scope = 'all'
    this.selected = null
    this.drag = null
    this.ray = new THREE.Raycaster()
    const root = document.createElement('div')
    root.id = 'edit'
    root.innerHTML = '<div class="ed-guide ed-gx"></div><div class="ed-guide ed-gy"></div><div class="ed-box"><span class="ed-label"></span><i data-h="nw"></i><i data-h="ne"></i><i data-h="sw"></i><i data-h="se"></i></div><div class="ed-light"></div>'
    stage.root.append(root)
    this.root = root
    this.box = root.querySelector('.ed-box')
    this.label = root.querySelector('.ed-label')
    this.sun = root.querySelector('.ed-light')
    this.guides = [root.querySelector('.ed-gx'), root.querySelector('.ed-gy')]
    this.box.hidden = true
    this.sun.hidden = true
    this.showGuides(false, false)

    this.on = (target, type, fn, opts) => {
      target.addEventListener(type, fn, opts)
      this.off.push(() => target.removeEventListener(type, fn, opts))
    }
    this.off = []
    this.on(window, 'pointerdown', (e) => this.down(e), true)
    this.on(window, 'pointermove', (e) => this.move(e), true)
    this.on(window, 'pointerup', (e) => this.up(e), true)
    this.on(window, 'pointercancel', (e) => this.up(e), true)
    this.on(window, 'wheel', (e) => this.wheel(e), { passive: false, capture: true })
    this.on(window, 'keydown', (e) => this.key(e), true)
    this.markDecor()
    this.setTool(stage.toolState ?? {})
    this.post({ type: 'stage:devices', devices: this.devices().map((d) => this.describe(d)) })
  }

  dispose() {
    this.unhighlight()
    for (const f of this.off) f()
    this.root.remove()
  }

  post(msg) {
    window.parent?.postMessage(msg, '*')
  }

  setTool({ tool, scope }) {
    if (tool) this.tool = tool
    if (scope) this.scope = scope
    this.unhighlight()
    this.root.dataset.tool = this.tool
    this.sun.hidden = this.tool !== 'light'
    if (this.tool === 'light') this.placeSun()
    this.sync()
  }

  /* ── what is on the stage ─────────────────────────────────────────────── */

  devices() {
    return [...(this.stage.three?.devices ?? []), ...(this.stage.flatDevices ?? [])]
  }

  edit(dev) {
    return { path: 'device', moveX: true, moveY: true, turn: true, size: true, ...dev.edit }
  }

  describe(dev) {
    const e = this.edit(dev)
    return { name: dev.id ? deviceDef(dev.id)?.name : `flat ${dev.variant}`, model: dev.id ?? null, path: e.path, keyed: !!e.keyed }
  }

  rectOf(dev) {
    return dev.pageRect ? dev.pageRect() : dev.rect
  }

  /** The device under a page point; front-most first for 3D. */
  hit(x, y, { mesh = false } = {}) {
    const st = this.stage
    if (st.three) {
      const ndc = new THREE.Vector2((x / st.three.W) * 2 - 1, 1 - (y / st.three.H) * 2)
      this.ray.setFromCamera(ndc, st.three.camera)
      const shown = (o) => {
        for (let p = o; p; p = p.parent) if (!p.visible) return false
        return true
      }
      for (const h of this.ray.intersectObjects(st.three.devices.map((d) => d.group), true)) {
        if (!shown(h.object)) continue
        const dev = st.three.devices.find((d) => {
          for (let p = h.object; p; p = p.parent) if (p === d.group) return true
          return false
        })
        if (dev) return mesh ? { dev, object: h.object } : dev
      }
    }
    if (mesh) return null
    const flats = [...(st.flatDevices ?? [])].reverse()
    return flats.find((d) => d.rect && x >= d.rect.x && x <= d.rect.x + d.rect.w && y >= d.rect.y && y <= d.rect.y + d.rect.h && d.el.style.visibility !== 'hidden') ?? null
  }

  /* ── reading and writing the theme ────────────────────────────────────── */

  get theme() {
    return this.stage.theme
  }

  /** The block a device is posed by: `device`, or `device` overlaid with a sub-block. */
  block(dev) {
    const e = this.edit(dev)
    const d = this.theme.device
    if (e.keyed) {
      const k = this.keyValues()
      return { x: k.x, y: k.y, size: k.size, pose: [k.rx, k.ry, k.rz] }
    }
    const b = e.path === 'device' ? d : { ...d, ...getPath(this.theme, e.path) }
    return { x: b.x ?? 0.5, y: b.y ?? 0.5, size: b.size, pose: [...(b.pose ?? [0, 0, 0])] }
  }

  progress() {
    const dur = this.stage.info?.duration || 0
    return dur ? clamp((this.stage.time ?? 0) / dur) : 0
  }

  keyValues() {
    return keyTrack(this.theme.motion.keys, this.theme)(this.progress())
  }

  /** `motion.keys` with `partial` merged into the key at the playhead (made if none is near). */
  withKey(partial) {
    const keys = merge({ k: keysOf(this.theme) }).k
    const at = round(this.progress())
    let key = keys.find((k) => Math.abs((k.at ?? 0) - at) < KEY_SNAP)
    if (!key) {
      key = { at }
      keys.push(key)
      keys.sort((a, b) => (a.at ?? 0) - (b.at ?? 0))
    }
    Object.assign(key, merge(key, partial))
    return keys
  }

  /**
   * Apply changes ({path: value}) to the loaded stage and tell the studio.
   * `final` ends a gesture: the studio records one history step for it.
   */
  async change(changes, { final = false, label } = {}) {
    const st = this.stage
    const list = Object.entries(changes).map(([path, value]) => ({ path, value }))
    let exact = true
    if (this.scope === 'slide' && !st.spec.animated) {
      const slide = st.ctx.slides[st.ctx.index]
      for (const c of list) slide.theme = setPath(slide.theme ?? {}, c.path, c.value)
      exact = (await st.patch(st.spec.theme)).exact
    } else {
      let next = st.spec.theme
      for (const c of list) next = setPath(next, c.path, c.value)
      exact = (await st.patch(next)).exact
    }
    this.post({ type: 'stage:change', changes: list, final, label, exact, scope: this.scope, index: st.ctx.index })
    return exact
  }

  /** Device changes go to its block — or, on a keyed layout, into the key at the playhead. */
  deviceChange(dev, values, opts) {
    const e = this.edit(dev)
    if (e.keyed) return this.change({ 'motion.keys': this.withKey(values) }, opts)
    const out = {}
    for (const [k, v] of Object.entries(values)) out[`${e.path}.${k}`] = v
    return this.change(out, opts)
  }

  cameraChange(cam, opts) {
    const keyed = this.devices().some((d) => this.edit(d).keyed)
    // Roll is not keyed: it belongs to the scene, whichever layout is on.
    const { roll, ...orbit } = cam
    const out = {}
    if (roll != null) out['scene.camera.roll'] = roll
    if (keyed && Object.keys(orbit).length) out['motion.keys'] = this.withKey({ cam: orbit })
    else for (const [k, v] of Object.entries(orbit)) out[`scene.camera.${k}`] = v
    return this.change(out, opts)
  }

  /* ── gestures ─────────────────────────────────────────────────────────── */

  down(e) {
    if (e.button !== 0) return
    const t = e.target
    if (t.closest?.('[contenteditable]')) return
    const x = e.clientX
    const y = e.clientY
    const begin = (drag) => {
      e.preventDefault()
      document.activeElement?.blur?.()
      window.focus()
      try {
        document.documentElement.setPointerCapture(e.pointerId)
      } catch {}
      this.drag = { x, y, moved: false, ...drag }
      this.root.classList.add('dragging')
    }

    if (this.tool === 'pick') {
      const h = this.hit(x, y, { mesh: true })
      if (h) {
        e.preventDefault()
        this.post({ type: 'stage:picked', model: h.dev.id, material: h.object.userData.materialName ?? '', mesh: h.object.name || h.object.parent?.name || '' })
      }
      return
    }
    const handle = t.closest?.('.ed-box i')
    if (handle && this.selected) {
      const r = this.rectOf(this.selected)
      return begin({ kind: 'size', dev: this.selected, base: this.block(this.selected), cx: r.x + r.w / 2, cy: r.y + r.h / 2 })
    }
    const decor = t.closest?.('[data-decor]')
    if (decor) return begin({ kind: 'decor', el: decor, n: Number(decor.dataset.decor), left: parseFloat(decor.style.left), top: parseFloat(decor.style.top) })

    if (this.tool === 'camera') return begin({ kind: 'camera', base: this.cameraNow() })
    if (this.tool === 'light') return begin({ kind: 'light' }), this.move(e)

    const dev = this.hit(x, y)
    this.select(dev)
    if (!dev) return
    begin({ kind: this.tool === 'turn' ? 'turn' : 'move', dev, base: this.block(dev), rect: this.rectOf(dev) })
  }

  cameraNow() {
    const c = this.theme.scene.camera
    if (this.devices().some((d) => this.edit(d).keyed)) {
      const k = this.keyValues()
      return { yaw: k.yaw, pitch: k.pitch, dist: k.dist, roll: c.roll ?? 0 }
    }
    return { yaw: c.yaw ?? 0, pitch: c.pitch ?? 0, dist: c.dist ?? 1, roll: c.roll ?? 0 }
  }

  move(e) {
    const d = this.drag
    if (!d) return this.hover(e)
    const dx = e.clientX - d.x
    const dy = e.clientY - d.y
    if (!d.moved && Math.hypot(dx, dy) * this.viewScale < 3 && d.kind !== 'light') return
    d.moved = true
    d.last = this.values(d, e, dx, dy)
    if (!d.busy && d.last) {
      // One patch in flight at a time; the newest pointer position wins.
      d.busy = true
      this.apply(d, d.last, false).finally(() => (d.busy = false))
    }
  }

  async up(e) {
    const d = this.drag
    if (!d) return
    this.drag = null
    this.root.classList.remove('dragging')
    this.showGuides(false, false)
    try {
      document.documentElement.releasePointerCapture(e.pointerId)
    } catch {}
    if (!d.moved || !d.last) return
    while (d.busy) await new Promise((r) => setTimeout(r, 8))
    await this.apply(d, d.last, true)
  }

  /** The studio shows the page scaled down; angles follow the hand, so they count screen pixels. */
  get viewScale() {
    return this.stage.spec.viewScale ?? 1
  }

  /** Pointer position -> the values this drag is setting. */
  values(d, e, dx, dy) {
    const st = this.stage
    const { W, H } = st.ctx
    const sx = dx * this.viewScale
    const sy = dy * this.viewScale
    if (d.kind === 'move') {
      const ed = this.edit(d.dev)
      const out = {}
      if (ed.moveX) out.x = round(d.base.x + ((ed.flipX ? -dx : dx) / (ed.unitX ?? W)) * (e.shiftKey && Math.abs(dy) > Math.abs(dx) ? 0 : 1))
      if (ed.moveY) out.y = round(d.base.y + (dy / (ed.unitY ?? H)) * (e.shiftKey && Math.abs(dx) >= Math.abs(dy) ? 0 : 1))
      // Snap to the page center, where most layouts want the device.
      const snapX = out.x != null && !ed.unitX && Math.abs(out.x - 0.5) < 0.012
      const snapY = out.y != null && !ed.unitY && Math.abs(out.y - 0.5) < 0.012
      if (snapX) out.x = 0.5
      if (snapY) out.y = 0.5
      this.showGuides(snapX, snapY)
      d.ghost = { dx: out.x != null ? (out.x - d.base.x) * (ed.unitX ?? W) * (ed.flipX ? -1 : 1) : 0, dy: out.y != null ? (out.y - d.base.y) * (ed.unitY ?? H) : 0 }
      return Object.keys(out).length ? out : null
    }
    if (d.kind === 'turn') {
      if (!this.edit(d.dev).turn) return null
      const p = d.base.pose.map((v) => round(v, 1)) // a keyed pose arrives interpolated
      if (e.shiftKey) p[2] = round(p[2] + sx * 0.4, 1)
      else {
        p[0] = round(clamp(p[0] + sy * 0.4, -89, 89), 1)
        p[1] = round(p[1] + sx * 0.4, 1)
      }
      return { pose: p }
    }
    if (d.kind === 'size') {
      if (!this.edit(d.dev).size) return null
      const r0 = Math.hypot(d.x - d.cx, d.y - d.cy) || 1
      const r1 = Math.hypot(e.clientX - d.cx, e.clientY - d.cy)
      return { size: round(clamp(d.base.size * (r1 / r0), 0.05, 3)) }
    }
    if (d.kind === 'camera') {
      if (e.shiftKey) return { roll: round(clamp(d.base.roll + sx * 0.15, -45, 45), 1) }
      return { yaw: round(clamp(d.base.yaw - sx * 0.3, -90, 90), 1), pitch: round(clamp(d.base.pitch + sy * 0.3, -60, 60), 1) }
    }
    if (d.kind === 'light') {
      const nx = (e.clientX / W - 0.5) * 3
      const ny = (0.5 - e.clientY / H) * 3
      return { dir: [round(nx, 2), round(ny, 2), 1] }
    }
    if (d.kind === 'decor') return { x: round((d.left + dx) / W), y: round((d.top + dy) / H) }
    return null
  }

  async apply(d, v, final) {
    const label = { move: 'Moved', turn: 'Turned', size: 'Resized', camera: 'Camera', light: 'Key light', decor: 'Moved decor' }[d.kind]
    if (d.kind === 'decor') return this.decorChange(d, v, final)
    if (d.kind === 'camera') return this.cameraChange(v, { final, label })
    if (d.kind === 'light') {
      await this.change({ 'scene.key.dir': v.dir }, { final, label })
      return this.placeSun()
    }
    const exact = await this.deviceChange(d.dev, v, { final, label: `${label} ${this.describe(d.dev).name}` })
    // A flat frame or a build-time layout cannot follow live: move the outline, the reload catches up.
    d.inexact = !exact
    if (!exact && d.ghost && d.rect) this.drawBox({ ...d.rect, x: d.rect.x + d.ghost.dx, y: d.rect.y + d.ghost.dy })
  }

  wheel(e) {
    if (this.tool === 'pick') return
    let values = null
    let run = null
    if (this.tool === 'camera') {
      const base = this.cameraNow()
      values = { dist: round(clamp(base.dist * Math.exp(e.deltaY * 0.0012), 0.3, 3)) }
      run = (final) => this.cameraChange(values, { final, label: 'Camera distance' })
    } else {
      const dev = this.hit(e.clientX, e.clientY)
      if (!dev || dev !== this.selected || !this.edit(dev).size) return
      values = { size: round(clamp(this.block(dev).size * Math.exp(-e.deltaY * 0.0015), 0.05, 3)) }
      run = (final) => this.deviceChange(dev, values, { final, label: `Resized ${this.describe(dev).name}` })
    }
    e.preventDefault()
    run(false)
    clearTimeout(this.wheelTimer)
    this.wheelTimer = setTimeout(() => run(true), 260)
  }

  key(e) {
    if (e.target.closest?.('[contenteditable], input, textarea')) return
    const step = e.shiftKey ? 0.02 : 0.004
    const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key]
    if (dir && this.selected && !e.metaKey && !e.ctrlKey) {
      e.preventDefault()
      const ed = this.edit(this.selected)
      const b = this.block(this.selected)
      const out = {}
      if (dir[0] && ed.moveX) out.x = round(b.x + dir[0] * step * (ed.flipX ? -1 : 1))
      if (dir[1] && ed.moveY) out.y = round(b.y + dir[1] * step)
      if (!Object.keys(out).length) return
      this.deviceChange(this.selected, out, { final: false })
      clearTimeout(this.keyTimer)
      this.keyTimer = setTimeout(() => this.deviceChange(this.selected, out, { final: true, label: `Nudged ${this.describe(this.selected).name}` }), 400)
      return
    }
    if (e.key === 'Escape' && this.selected) return this.select(null)
    // Everything else is a studio shortcut: the frame has the focus, the studio has the keys.
    this.post({ type: 'stage:key', key: e.key, code: e.code, shift: e.shiftKey, meta: e.metaKey, ctrl: e.ctrlKey, alt: e.altKey })
    if (e.key === ' ' || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z')) e.preventDefault()
  }

  /* ── decor ────────────────────────────────────────────────────────────── */

  markDecor() {
    const st = this.stage
    const slide = st.ctx.slides[st.ctx.index] ?? {}
    this.decorSource = slide.decor ? 'slide' : 'theme'
    const items = slide.decor ?? st.theme.decor ?? []
    for (const d of st.decor ?? []) {
      if (!d.el || FIELD_DECOR.has(d.item.kind)) continue
      d.el.dataset.decor = items.indexOf(d.item)
      d.el.classList.add('ed-decor')
    }
  }

  decorChange(d, v, final) {
    d.el.style.left = `${v.x * this.stage.ctx.W}px`
    d.el.style.top = `${v.y * this.stage.ctx.H}px`
    if (final) this.post({ type: 'stage:decor', n: d.n, source: this.decorSource, index: this.stage.ctx.index, x: v.x, y: v.y })
  }

  /* ── overlay ──────────────────────────────────────────────────────────── */

  select(dev) {
    if (this.selected === dev) return
    this.selected = dev
    this.post({ type: 'stage:select', device: dev ? this.describe(dev) : null })
    this.sync()
  }

  hover(e) {
    if (this.tool === 'pick') {
      const h = this.hit(e.clientX, e.clientY, { mesh: true })
      if (h?.object !== this.lit) {
        this.unhighlight()
        if (h) this.highlight(h.object)
      }
      return
    }
    const over = this.tool === 'move' || this.tool === 'turn' ? this.hit(e.clientX, e.clientY) : null
    document.documentElement.style.cursor = over ? (this.tool === 'turn' ? 'grab' : 'move') : this.tool === 'camera' ? 'grab' : this.tool === 'light' ? 'crosshair' : ''
    if (over !== this.hovered) {
      this.hovered = over
      this.sync()
    }
  }

  highlight(object) {
    this.lit = object
    this.litMaterial = object.material
    const m = object.material.clone()
    m.emissive = new THREE.Color('#5b7cff')
    m.emissiveIntensity = 0.9
    m.emissiveMap = null
    object.material = m
    this.stage.three.render()
    this.post({ type: 'stage:hover', material: object.userData.materialName ?? '', mesh: object.name || object.parent?.name || '' })
  }

  unhighlight() {
    if (!this.lit) return
    this.lit.material.dispose()
    this.lit.material = this.litMaterial
    this.lit = null
    this.stage.three?.render()
    this.post({ type: 'stage:hover', material: null, mesh: null })
  }

  showGuides(x, y) {
    this.guides[0].hidden = !x
    this.guides[1].hidden = !y
  }

  placeSun() {
    const dir = this.theme.scene.key?.dir ?? [-0.5, 0.8, 1]
    const k = 1 / (dir[2] || 1)
    const { W, H } = this.stage.ctx
    this.sun.style.left = `${clamp((dir[0] * k) / 3 + 0.5, 0.02, 0.98) * W}px`
    this.sun.style.top = `${clamp(0.5 - (dir[1] * k) / 3, 0.02, 0.98) * H}px`
  }

  drawBox(r, dev = this.selected ?? this.hovered) {
    const s = this.box.style
    s.left = `${r.x}px`
    s.top = `${r.y}px`
    s.width = `${r.w}px`
    s.height = `${r.h}px`
    if (!dev) return
    const b = this.block(dev)
    // Only what the tool in hand changes; the panel has the rest.
    const reads = this.tool === 'turn' ? b.pose.map((v) => `${Math.round(v)}°`).join(' ') : `x ${round(b.x, 2)}  y ${round(b.y, 2)}  size ${round(b.size, 2)}`
    this.label.textContent = `${this.describe(dev).name} · ${reads}`
    // Keep the label on the page when the device sits against an edge.
    const lw = this.label.offsetWidth
    this.label.style.left = `${Math.min(0, this.stage.ctx.W - r.x - lw)}px`
    this.label.classList.toggle('below', r.y < this.label.offsetHeight * 1.6)
  }

  /** Re-draw the outline; called after every seek, since devices move with t. */
  sync() {
    const dev = this.selected ?? this.hovered
    const live = dev && this.devices().includes(dev) && dev.group?.visible !== false
    this.box.hidden = !live
    if (!live) return
    this.box.classList.toggle('selected', dev === this.selected)
    this.box.classList.toggle('no-size', !this.edit(dev).size)
    // Line weights and handles are drawn for the screen, not the page: undo the studio's scale.
    this.root.style.setProperty('--ed', String(1 / (this.stage.spec.viewScale ?? 1)))
    if (!this.drag?.inexact || this.drag.dev !== dev) this.drawBox(this.rectOf(dev), dev)
  }
}
