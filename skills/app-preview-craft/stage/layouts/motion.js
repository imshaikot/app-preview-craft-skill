// Video layouts. Each is async (ctx) => {duration, update(t)}; update must set
// every animated property from t alone so frames can render in any order.
import { bookends, captions, outroFade, paintBeat, screenState, standInFront, textBox, timeline, tuckBehind } from './common.js'
import { clamp, ease, lerp, span, wobble } from '../lib/ease.js'
import { keyTrack } from '../lib/keys.js'

const introLen = (ctx) => (ctx.theme.motion.intro ? 1.8 : 0)
const outroLen = (ctx) => (ctx.theme.motion.outro ? 2.2 : 0)
const tlFor = (ctx) => timeline(ctx, { intro: introLen(ctx), outro: outroLen(ctx) })

/** Continuous slide position: i-1 → i while beat i transitions in. */
const cursor = (tl, t, trans = 0.8) => {
  const b = tl.at(t, trans)
  return b.i - 1 + ease.inOutCubic(b.p)
}

function withBookends(ctx, tl, update) {
  const ends = bookends(ctx, tl)
  const capBox = ctx.theme.text.position === 'none' ? null : textBox(ctx)
  const caps = capBox ? captions(ctx, tl, capBox, { style: ctx.theme.motion.captionStyle ?? 'rise' }) : null
  return {
    duration: tl.total,
    update: async (t) => {
      const fade = outroFade(tl, t)
      const introHide = tl.intro ? clamp((t - tl.intro + 0.3) / 0.5) : 1
      ctx.layers.front.style.setProperty('--caption-opacity', Math.min(fade, introHide))
      caps?.(t)
      ends(t)
      await update(t, { fade, introHide })
    },
  }
}

function paintSlideAt(ctx, dev, tl, k, t) {
  // Slide k plays its recording only while it is the active beat.
  const beat = tl.beats[Math.min(k, tl.beats.length - 1)]
  const local = clamp(t - beat.start, 0, beat.len)
  return screenState(ctx, k, local, beat.len).then((s) => dev.paint(s))
}

export const MOTION = {
  // ── 2D ────────────────────────────────────────────────────────────────
  async carousel(ctx) {
    const { W, H, theme, slides } = ctx
    const d = theme.device
    const tl = tlFor(ctx)
    const devs = []
    for (let k = 0; k < slides.length; k++) devs.push(await ctx.device({ mode: d.mode === '3d' ? 'flat' : d.mode }))
    const size = d.size * H
    const spacing = size * (devs[0]?.aspect ?? 0.46) * (1 + (d.gap ?? 0.62) * 0.5)
    return withBookends(ctx, tl, async (t, { fade, introHide }) => {
      const c = cursor(tl, t)
      await Promise.all(
        devs.map(async (dev, k) => {
          const off = k - c
          const a = Math.min(1, Math.abs(off))
          dev.place({
            x: W / 2 + off * spacing,
            y: d.y * H + a * H * 0.02,
            size,
            ry: clamp(-off * 22, -40, 40),
            scale: 1 - 0.16 * a,
            opacity: (1 - 0.45 * a) * fade * introHide,
            z: 100 - Math.abs(off) * 10,
          })
          if (Math.abs(off) < 2.5) await paintSlideAt(ctx, dev, tl, k, t)
        }),
      )
    })
  },

  async stack(ctx) {
    const { W, H, theme, slides, u } = ctx
    const d = theme.device
    const tl = tlFor(ctx)
    const devs = []
    for (let k = 0; k < slides.length; k++) devs.push(await ctx.device({ mode: d.mode === '3d' ? 'frameless' : d.mode }))
    const size = d.size * H
    return withBookends(ctx, tl, async (t, { fade, introHide }) => {
      const c = cursor(tl, t, 0.9)
      await Promise.all(
        devs.map(async (dev, k) => {
          const depth = k - c
          let x = W / 2
          let y = d.y * H
          let rz = 0
          let scale = 1
          let opacity = 1
          if (depth < 0) {
            // flying off to the upper left
            const f = clamp(-depth)
            x -= f * W * 0.9
            y -= f * H * 0.08
            rz = -f * 24
            opacity = 1 - f
          } else {
            y -= depth * u * 4.5
            scale = 1 - depth * 0.07
            opacity = clamp(1 - (depth - 2) * 0.8)
            rz = depth * (k % 2 ? 2.2 : -2.2)
          }
          dev.place({ x, y, size, rz, scale, opacity: opacity * fade * introHide, z: 100 - Math.round(depth * 10), visible: depth > -1.01 && depth < 4 })
          if (depth > -1.01 && depth < 1.5) await paintSlideAt(ctx, dev, tl, k, t)
        }),
      )
    })
  },

  async scroll(ctx) {
    return MOTION['phone-swap'](ctx)
  },

  async 'phone-swap'(ctx) {
    const { W, H, theme, u } = ctx
    const d = theme.device
    const tl = tlFor(ctx)
    const dev = await ctx.device()
    return withBookends(ctx, tl, async (t, { fade, introHide }) => {
      const enter = span(t, tl.intro, 1.1, ease.outCubic)
      const fl = d.float || 0.4
      dev.place({
        x: d.x * W,
        y: d.y * H + (1 - enter) * H * 0.5 + wobble(t * 0.7, 1) * u * fl,
        size: d.size * H,
        rx: d.pose[0] + wobble(t * 0.5, 2) * 3 * fl,
        ry: d.pose[1] + wobble(t * 0.4, 3) * 5 * fl,
        rz: d.pose[2],
        opacity: fade * introHide,
      })
      await paintBeat(ctx, dev, tl, t)
    })
  },

  async 'zoom-tour'(ctx) {
    const { W, H, theme } = ctx
    const tl = tlFor(ctx)
    const dev = await ctx.device({ mode: 'frameless' })
    const aspect = dev.aspect
    const size = Math.max(H, W / aspect) * (theme.device.cover ?? 1)
    // Scrim so captions read over any screen.
    const scrim = document.createElement('div')
    scrim.className = 'scrim'
    scrim.style.background = `linear-gradient(180deg, transparent 45%, ${theme.palette.bg}ee 88%)`
    ctx.layers.mid.append(scrim)
    return withBookends(ctx, tl, async (t, { fade, introHide }) => {
      const b = tl.at(t)
      dev.place({ x: W / 2, y: H / 2, size, scale: 1 + b.progress * 0.05, opacity: fade * introHide })
      scrim.style.opacity = fade
      await paintBeat(ctx, dev, tl, t, { mode: theme.screen.transition === 'slide' ? 'fade' : theme.screen.transition })
    })
  },

  async wall(ctx) {
    const { W, H, theme, slides } = ctx
    const d = theme.device
    const tl = timeline(ctx, { intro: 0, outro: outroLen(ctx) })
    const wall = document.createElement('div')
    wall.className = 'wall'
    const wallW = Math.max(W, H) * 1.9
    Object.assign(wall.style, {
      width: `${wallW}px`,
      height: `${wallW}px`,
      left: `${(W - wallW) / 2}px`,
      top: `${(H - wallW) / 2}px`,
      transform: `perspective(${wallW}px) rotateX(${theme.wall?.tiltX ?? 24}deg) rotateZ(${theme.wall?.tiltZ ?? -22}deg)`,
    })
    ctx.layers.back.append(wall)
    const tileH = d.size * Math.max(W, H) * 1.1
    const cols = theme.wall?.cols ?? 7
    const colW = wallW / cols
    const pitch = tileH * 1.08
    // Enough rows to cover the wall plus one spare for the drift.
    const perCol = Math.ceil(wallW / pitch) + 1
    const tiles = []
    for (let c = 0; c < cols; c++) {
      for (let r = 0; r < perCol; r++) {
        const k = (c * 2 + r) % Math.max(1, slides.length)
        const dev = await ctx.device({ mode: d.mode === '3d' ? 'frameless' : d.mode, layer: wall, slide: k, resolution: 0.45 })
        dev.paint(await screenState(ctx, k))
        tiles.push({ dev, c, r })
      }
    }
    // Center card
    const box = textBox(ctx, 'center', { width: 0.78 })
    const card = document.createElement('div')
    card.className = 'wall-card'
    Object.assign(card.style, { left: `${box.x - ctx.u * 4}px`, top: `${box.y - ctx.u * 3}px`, width: `${box.w + ctx.u * 8}px`, height: `${box.h + ctx.u * 6}px`, background: theme.wall?.card ?? `${theme.palette.bg}cc` })
    ctx.layers.mid.append(card)
    return withBookends(ctx, tl, async (t, { fade }) => {
      for (const { dev, c, r } of tiles) {
        const dir = c % 2 ? 1 : -1
        const travel = t * (theme.wall?.speed ?? 0.06) * pitch * 3 * dir
        // Wrap each tile around the column so the drift never runs dry.
        const y = ((((r + 0.5) * pitch + travel + (c % 2) * pitch * 0.5) % (perCol * pitch)) + perCol * pitch) % (perCol * pitch) - pitch * 0.5
        dev.place({ x: colW * (c + 0.5), y, size: tileH, opacity: fade })
      }
      card.style.opacity = fade
    })
  },

  async 'grid-reveal'(ctx) {
    const { W, H, theme, slides, u } = ctx
    const tl = timeline(ctx, { intro: 2.2, outro: outroLen(ctx) })
    const n = Math.min(slides.length, theme.grid?.max ?? 6)
    const cols = n <= 4 ? 2 : 3
    const rows = Math.ceil(n / cols)
    const devs = []
    for (let k = 0; k < n; k++) devs.push(await ctx.device({ mode: theme.device.mode === '3d' ? 'frameless' : theme.device.mode }))
    const hero = await ctx.device({ mode: theme.device.mode === '3d' ? 'flat' : theme.device.mode })
    const cellH = Math.min((H * 0.62) / rows, ((W * 0.86) / cols / (devs[0]?.aspect ?? 0.46)) * 0.92)
    const cellW = cellH * (devs[0]?.aspect ?? 0.46)
    for (const [k, dev] of devs.entries()) dev.paint(await screenState(ctx, k))
    return withBookends(ctx, tl, async (t, { fade }) => {
      const collapse = span(t, 1.6, 0.7, ease.inOutCubic)
      devs.forEach((dev, k) => {
        const col = k % cols
        const row = Math.floor(k / cols)
        const gx = W / 2 + (col - (cols - 1) / 2) * cellW * 1.12
        const gy = H * 0.42 + (row - (rows - 1) / 2) * cellH * 1.06
        const pop = span(t, 0.1 + k * 0.12, 0.6, ease.outBack)
        dev.place({ x: lerp(gx, W / 2, collapse), y: lerp(gy, H * 0.42, collapse), size: cellH, scale: pop * (1 - collapse * 0.4), opacity: clamp(pop * 1.5) * (1 - collapse) * fade, rz: (1 - pop) * 8 })
      })
      const show = span(t, 1.8, 0.7, ease.outCubic)
      hero.place({ x: W / 2, y: H * (theme.device.y ?? 0.44), size: theme.device.heroSize ? theme.device.heroSize * H : H * 0.62, scale: lerp(0.6, 1, show), opacity: show * fade, visible: show > 0 })
      if (show > 0) await paintBeat(ctx, hero, tl, Math.max(t, tl.intro))
    })
  },

  // ── 3D ────────────────────────────────────────────────────────────────
  async turntable(ctx) {
    const { W, H, theme, u } = ctx
    const d = theme.device
    const m = theme.motion
    const tl = tlFor(ctx)
    const dev = await ctx.device({ mode: '3d' })
    const spinEnd = tl.intro + 2.4
    return withBookends(ctx, tl, async (t, { fade }) => {
      const s = span(t, tl.intro, 2.4, ease.outCubic)
      const sway = Math.sin((t - spinEnd) * 0.7) * 14 * clamp((t - spinEnd) / 1.5)
      dev.place({
        x: d.x * W,
        y: d.y * H + (1 - s) * H * 0.12 + wobble(t * 0.6, 4) * u * d.float,
        size: d.size * H * lerp(0.8, 1, s),
        rx: d.pose[0] + (1 - s) * 10,
        ry: d.pose[1] - (1 - s) * 360 * (m.spins ?? 1.5) + sway,
        rz: d.pose[2],
        scale: fade,
      })
      ctx.three.scene.environmentRotation.y = (theme.scene.envRotation ?? 0) + t * 0.15
      await paintBeat(ctx, dev, tl, t)
    })
  },

  async orbit(ctx) {
    const { W, H, theme } = ctx
    const d = theme.device
    const cam = theme.scene.camera
    const arc = theme.motion.arc ?? 50
    const tl = tlFor(ctx)
    const dev = await ctx.device({ mode: '3d' })
    return withBookends(ctx, tl, async (t, { fade }) => {
      const p = ease.inOutSine(clamp(t / tl.total))
      dev.place({ x: d.x * W, y: d.y * H, size: d.size * H, rx: d.pose[0], ry: d.pose[1], rz: d.pose[2], scale: fade })
      ctx.three.setView({
        ...cam,
        yaw: (cam.yaw ?? 0) - arc / 2 + arc * p,
        pitch: (cam.pitch ?? 0) + Math.sin(p * Math.PI) * 8,
        dist: (cam.dist ?? 1) * lerp(1.08, 0.94, p),
        tx: d.x * W,
        ty: d.y * H,
      })
      ctx.three.scene.environmentRotation.y = (theme.scene.envRotation ?? 0) + p * 1.6
      await paintBeat(ctx, dev, tl, t)
    })
  },

  async float(ctx) {
    const { W, H, theme, u } = ctx
    const d = theme.device
    const tl = tlFor(ctx)
    const dev = await ctx.device({ mode: '3d' })
    return withBookends(ctx, tl, async (t, { fade }) => {
      const enter = span(t, tl.intro, 1.4, ease.outCubic)
      const f = d.float || 1
      dev.place({
        x: d.x * W + wobble(t * 0.4, 9) * u * 1.2 * f,
        y: d.y * H + (1 - enter) * H * 0.35 + wobble(t * 0.6, 1) * u * 2 * f,
        size: d.size * H,
        rx: d.pose[0] + wobble(t * 0.5, 2) * 5 * f,
        ry: d.pose[1] + wobble(t * 0.35, 3) * 12 * f + (1 - enter) * 40,
        rz: d.pose[2] + wobble(t * 0.45, 5) * 3 * f,
        scale: fade,
      })
      await paintBeat(ctx, dev, tl, t)
    })
  },

  async rise(ctx) {
    const { W, H, theme } = ctx
    const d = theme.device
    const cam = theme.scene.camera
    const tl = tlFor(ctx)
    const dev = await ctx.device({ mode: '3d' })
    const push = theme.motion.push ?? 0.72
    return withBookends(ctx, tl, async (t, { fade }) => {
      const up = span(t, tl.intro, 1.8, ease.outQuart)
      const pushP = span(t, tl.intro + 2.2, Math.max(1, tl.bodyEnd - tl.intro - 2.6), ease.inOutSine)
      dev.place({
        x: d.x * W,
        y: lerp(H * 1.5, d.y * H, up),
        size: d.size * H,
        rx: d.pose[0] + (1 - up) * -30,
        ry: d.pose[1] + (1 - up) * 70 + Math.sin(t * 0.5) * 6 * up,
        rz: d.pose[2],
        scale: fade,
      })
      ctx.three.setView({ ...cam, dist: lerp(cam.dist ?? 1, push, pushP), tx: d.x * W, ty: lerp(H / 2, d.y * H, pushP) })
      await paintBeat(ctx, dev, tl, t)
    })
  },

  async flip(ctx) {
    const { W, H, theme, u } = ctx
    const d = theme.device
    const tl = tlFor(ctx)
    const dev = await ctx.device({ mode: '3d' })
    return withBookends(ctx, tl, async (t, { fade }) => {
      const f = span(t, tl.intro + 0.5, 1.6, ease.inOutCubic)
      const settle = clamp((t - tl.intro - 2.1) / 1.2)
      dev.place({
        x: d.x * W,
        y: d.y * H + Math.sin(f * Math.PI) * -H * 0.04 + wobble(t * 0.6, 7) * u * d.float,
        size: d.size * H,
        rx: d.pose[0] + Math.sin(f * Math.PI) * 12,
        ry: d.pose[1] + 180 * (1 - f) + Math.sin(t * 0.8) * 10 * settle,
        rz: d.pose[2] + Math.sin(f * Math.PI) * -6,
        scale: fade,
      })
      await paintBeat(ctx, dev, tl, t)
    })
  },

  async trio(ctx) {
    const { W, H, theme } = ctx
    const d = theme.device
    const tl = tlFor(ctx)
    const ids = (theme.devices ?? [d.model, d.model, d.model]).slice(0, 3)
    const devs = []
    for (const id of ids) devs.push(await ctx.device({ mode: '3d', model: id }))
    for (const dev of devs) dev.edit = { path: 'device', turn: false }
    const rise = [0, 2, 1] // side, side, center: the order they come up in
    const layers = [1, 0, 2] // front to back: each one tucks behind those before it
    return withBookends(ctx, tl, async (t, { fade }) => {
      const fan = span(t, tl.intro + 1.3, 1.1, ease.inOutCubic)
      const placed = []
      for (const k of layers) {
        const dev = devs[k]
        if (!dev) continue
        const off = k - 1
        const up = span(t, tl.intro + rise.indexOf(k) * 0.22, 1.2, ease.outQuart)
        const p = {
          x: (d.x + off * (d.spread ?? 0.3) * (H > W ? 1 : 0.5) * fan) * W,
          y: lerp(H * 1.5, d.y * H + Math.abs(off) * H * 0.03 * fan, up),
          z: off === 0 ? 0 : -0.08 * H * fan,
          size: d.size * H * (off === 0 ? 1 : lerp(1, 0.88, fan)),
          ry: -off * (d.fanAngle ?? 14) * 1.5 * fan + Math.sin(t * 0.6 + k) * 3,
          rz: -off * (d.fanAngle ?? 14) * fan,
          scale: fade,
        }
        // Stacked as they rise and crossing as they fan, the three would share one depth.
        p.z = tuckBehind(ctx, dev, p, placed)
        dev.place(p)
        placed.push({ dev, p })
      }
      await Promise.all(devs.map((dev, k) => paintBeat(ctx, dev, tl, t, { offset: k - 1 })))
    })
  },

  async desk(ctx) {
    const { W, H, theme } = ctx
    const d = theme.device
    const cam = theme.scene.camera
    const tl = tlFor(ctx)
    const laptop = await ctx.device({ mode: '3d', model: d.laptop ?? 'macbook-pro-16' })
    const phone = await ctx.device({ mode: '3d' })
    // Composed on a 16:9 box; a narrower page widens the box past its edges
    // so the pair still fills the width.
    const bw = Math.min(W * 1.4, (H * 16) / 9)
    const bh = (bw * 9) / 16
    const bx = (x) => W / 2 + (x - 0.5) * bw
    // On a tall page the floor comes up with the box, or the pair sits in the
    // bottom corner under half a page of nothing.
    const themeFloor = (theme.scene.floor?.y ?? 0.8) * H
    const floor = Math.min(themeFloor, H / 2 + bh * 0.42)
    if (ctx.three.floor) ctx.three.floor.position.y = themeFloor - floor
    // The laptop keeps the last desktop capture up while later slides change
    // the phone, and a desktop recording plays on across those beats.
    const deskFor = (i) => {
      for (let k = i; k >= 0; k--) if (ctx.desktopSources[k]) return k
      return -1
    }
    const openAt = tl.intro ? tl.intro - 0.5 : 0.3
    // Both stand on the floor; x is a fraction of the 16:9 box, not of the page.
    laptop.edit = { path: 'device', moveY: false, unitX: bw }
    phone.edit = { path: 'device.phone', moveY: false, unitX: bw }
    return withBookends(ctx, tl, async (t, { fade }) => {
      const ph = { ...d, ...d.phone }
      const open = span(t, openAt, 1.8, ease.inOutCubic)
      const slide = span(t, openAt + 1.3, 1.2, ease.outCubic)
      const camP = span(t, 0, tl.total, ease.inOutSine)
      // Both devices stand on the floor, so the shadows and the hinge read true.
      const lw = d.size * bw
      laptop.setLid(lerp(0.02, 1, open))
      // Set back by a quarter of its width: the deck, not the hinge, is what reaches the camera.
      laptop.place({ x: bx(d.x), y: floor - laptop.standHeight(lw) / 2, z: -0.25 * lw, size: lw, rx: d.pose[0], ry: d.pose[1], rz: d.pose[2], scale: fade })
      const at = standInFront(ctx, laptop, phone, { x: lerp(W * 1.3, bx(ph.x), slide), y: 0, size: ph.size * bh, rx: ph.pose[0], ry: ph.pose[1] + (1 - slide) * -50, rz: ph.pose[2], scale: fade })
      phone.place({ ...at, y: floor - phone.standHeight(at.size) / 2 })
      ctx.three.setView({ ...cam, pitch: lerp(12, cam.pitch ?? 7, camP), yaw: lerp(-6, 6, camP), dist: lerp(1.1, cam.dist ?? 1, camP) })
      const beat = tl.at(Math.max(t, tl.intro))
      const k = deskFor(beat.i)
      const on = k < 0 ? beat : { i: k, local: t - tl.beats[k].start, len: tl.beats[k].len }
      laptop.paint(await screenState(ctx, on.i, on.local, on.len, { desktop: true }))
      await paintBeat(ctx, phone, tl, Math.max(t, tl.intro))
    })
  },

  async spotlight(ctx) {
    const { W, H, theme } = ctx
    const d = theme.device
    const cam = theme.scene.camera
    const tl = tlFor(ctx)
    const dev = await ctx.device({ mode: '3d' })
    dev.edit = { path: 'device', moveY: false }
    return withBookends(ctx, tl, async (t, { fade }) => {
      const p = ease.inOutSine(clamp(t / tl.total))
      const h = d.size * H
      const floorY = theme.scene.floor ? theme.scene.floor.y * H : d.y * H + h / 2
      const lift = span(t, 0, 1.2, ease.outCubic)
      dev.place({ x: d.x * W, y: floorY - dev.standHeight(h) / 2 - 2 - (1 - lift) * H * 0.05, size: h, rx: 0, ry: d.pose[1] - 200 + 360 * p, rz: 0, scale: fade })
      ctx.three.setView({ ...cam, pitch: (cam.pitch ?? 6) + Math.sin(p * Math.PI) * 4, dist: lerp(1.05, 0.95, p) })
      await paintBeat(ctx, dev, tl, t)
    })
  },

  /**
   * The user's own move: device and camera follow `motion.keys`, a list of
   *   { at: 0..1, x, y, size, pose: [rx, ry, rz], cam: { yaw, pitch, dist }, ease }
   * `at` is a fraction of the whole video, so keys keep their place when
   * slides or recordings change its length. A value a key leaves out holds
   * from the key before it. The studio writes these by posing the device at
   * the playhead; they are as good typed by hand.
   */
  async keyframes(ctx) {
    const { W, H, theme } = ctx
    const tl = tlFor(ctx)
    const dev = await ctx.device({ mode: '3d' })
    dev.edit = { path: 'device', keyed: true }
    return withBookends(ctx, tl, async (t, { fade }) => {
      // Built per frame from the theme as it is now: a handful of keys, and the studio edits them live.
      const k = keyTrack(theme.motion.keys, theme)(clamp(t / tl.total))
      dev.place({ x: k.x * W, y: k.y * H, size: k.size * H, rx: k.rx, ry: k.ry, rz: k.rz, scale: fade })
      ctx.three.setView({ ...theme.scene.camera, yaw: k.yaw, pitch: k.pitch, dist: k.dist, tx: lerp(W / 2, k.x * W, k.follow), ty: lerp(H / 2, k.y * H, k.follow) })
      await paintBeat(ctx, dev, tl, t)
    })
  },
}
