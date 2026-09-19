#!/usr/bin/env node
// Invariants for the whole pipeline. Each check renders into a private temp
// dir and inspects the files — pixels, sizes, alpha, streams, metadata.
//
//   node scripts/selftest.mjs [--quick] [--only <substring>]
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { CATEGORIES, SIZES } from '../stage/catalog/categories.js'
import { DEVICES } from '../stage/catalog/devices.js'
import { FONTS } from '../stage/catalog/fonts.js'
import { LAYOUTS } from '../stage/catalog/layouts.js'
import { coerce, resolveTheme, setPath } from '../stage/catalog/resolve.js'
import { THEMES } from '../stage/themes/index.js'
import { markup } from '../stage/lib/text.js'
import { launchBrowser, openPage } from './browser.mjs'
import { inspectModel, loadCustomDevices } from './custom-models.mjs'
import { buildJobs, loadCustomThemes, renderJob } from './render.mjs'
import { SKILL, startServer } from './server.mjs'
import { readEvents, readSession } from './transcript.mjs'
import { hasFfmpeg, probe } from './video.mjs'

const args = process.argv.slice(2)
const quick = args.includes('--quick')
// CI runners draw WebGL in software: smaller video renders, longer waits.
const ci = !!process.env.CI
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null
const ROOT = join(tmpdir(), 'app-preview-craft', `selftest-${process.pid}`)
const SAMPLES = join(SKILL, 'assets', 'samples')
mkdirSync(ROOT, { recursive: true })

const results = []
let server
let browser
async function check(name, fn) {
  if (only && !name.includes(only)) return
  const t0 = Date.now()
  try {
    await fn()
    results.push([true, name, Date.now() - t0])
    console.log(`  ✓ ${name}  (${((Date.now() - t0) / 1000).toFixed(1)}s)`)
  } catch (err) {
    results.push([false, name, Date.now() - t0])
    console.log(`  ✗ ${name}\n      ${String(err?.stack ?? err).split('\n').slice(0, 4).join('\n      ')}`)
  }
}
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg)
}
const render = async (cli, sub = cli.category) => {
  const out = join(ROOT, sub)
  const [job] = buildJobs({ cli: { quiet: true, out, ...cli } })
  return renderJob(job, { browser, server, log: () => {}, custom: await loadCustomThemes([], out) })
}
const ffprobe = (file) => JSON.parse(spawnSync('ffprobe', ['-v', 'error', '-print_format', 'json', '-show_streams', '-show_format', file], { encoding: 'utf8' }).stdout)

/** Standard deviation of luminance inside a region: a blank screen is flat. */
async function detail(file, [x, y, w, h]) {
  const img = sharp(file)
  const m = await img.metadata()
  const { data } = await sharp(file)
    .extract({ left: Math.round(x * m.width), top: Math.round(y * m.height), width: Math.round(w * m.width), height: Math.round(h * m.height) })
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true })
  let sum = 0
  let sq = 0
  for (const v of data) {
    sum += v
    sq += v * v
  }
  const mean = sum / data.length
  return Math.sqrt(sq / data.length - mean * mean)
}

console.log(`app-preview-craft selftest → ${ROOT}\n`)

/* ── catalog ───────────────────────────────────────────────────────────── */

await check('SKILL.md frontmatter uses only spec keys, a matching name and a short description', () => {
  const fm = readFileSync(join(SKILL, 'SKILL.md'), 'utf8').split(/^---$/m)[1]
  // Nested metadata keys are indented, so only top-level keys match.
  const keys = [...fm.matchAll(/^([\w-]+):/gm)].map((m) => m[1])
  const allowed = ['name', 'description', 'license', 'compatibility', 'metadata', 'allowed-tools']
  const bad = keys.filter((k) => !allowed.includes(k))
  assert(!bad.length, `unexpected frontmatter keys: ${bad}`)
  assert(/^name: app-preview-craft$/m.test(fm), 'name must match the folder name')
  const description = fm.match(/^description: "(.*)"$/m)?.[1] ?? ''
  assert(description.length > 0 && description.length <= 1024, `description is ${description.length} chars`)
  const compatibility = fm.match(/^compatibility: "(.*)"$/m)?.[1] ?? ''
  assert(compatibility.length <= 500, `compatibility is ${compatibility.length} chars`)
})
await check('every category has at least five themes', () => {
  for (const c of Object.keys(CATEGORIES)) assert(Object.keys(THEMES[c] ?? {}).length >= 5, `${c} has ${Object.keys(THEMES[c] ?? {}).length}`)
})
await check('every theme resolves to a layout of its category kind, with known fonts and devices', () => {
  for (const [c, list] of Object.entries(THEMES)) {
    for (const id of Object.keys(list)) {
      const t = resolveTheme(c, id)
      assert(LAYOUTS[t.layout], `${c}/${id}: unknown layout ${t.layout}`)
      assert(LAYOUTS[t.layout].kind === CATEGORIES[c].kind, `${c}/${id}: ${t.layout} is a ${LAYOUTS[t.layout].kind}`)
      for (const f of [t.type.display, t.type.body, t.type.italicFont].filter(Boolean)) assert(FONTS[f], `${c}/${id}: unknown font ${f}`)
      assert(DEVICES[t.device.model], `${c}/${id}: unknown device ${t.device.model}`)
      for (const d of t.devices ?? []) assert(DEVICES[d], `${c}/${id}: unknown device ${d}`)
      assert(t.id === id, `${c}/${id}: id mismatch`)
    }
  }
})
await check('every category size exists and every font package is installed', () => {
  for (const c of Object.values(CATEGORIES)) for (const s of c.sizes) assert(SIZES[s], `unknown size ${s}`)
  for (const f of Object.values(FONTS)) for (const css of f.css) assert(existsSync(join(SKILL, 'node_modules', f.pkg, css)), `${f.pkg}/${css} missing`)
})
await check('every device model file is present with a CC-BY credit', () => {
  const credits = JSON.parse(readFileSync(join(SKILL, 'assets', 'models', 'credits.json'), 'utf8'))
  for (const [id, d] of Object.entries(DEVICES)) {
    assert(existsSync(join(SKILL, 'assets', 'models', d.file)), `${d.file} missing`)
    assert(d.credit.author && d.credit.license.startsWith('CC-BY'), `${id} credit incomplete`)
    assert(credits.some((c) => c.id === id), `${id} not in credits.json`)
  }
})
await check('--set values are coerced by the schema', () => {
  assert(coerce('device.pose', '1, 2,3').join() === '1,2,3', 'pose')
  assert(coerce('type.size', '1.2') === 1.2, 'range')
  assert(coerce('background.panorama', 'yes') === true, 'bool')
  assert(coerce('device.finish', 'null') === null, 'null')
  assert(Array.isArray(coerce('decor', '[{"kind":"sparkles"}]')), 'json')
})
await check('inspecting a GLB finds its screen material and the credit it carries', () => {
  const phone = inspectModel(join(SKILL, 'assets', 'models', 'galaxy-s21-ultra.glb'))
  assert(phone.guess?.material === 'Screen' && phone.confident, `guessed ${JSON.stringify(phone.guess)}`)
  assert(phone.credit?.author === 'DatSketch' && phone.credit.license === 'CC-BY-4.0', JSON.stringify(phone.credit))
  // Hashed material names give nothing to go on: the guess must say it is unsure.
  assert(!inspectModel(join(SKILL, 'assets', 'models', 'macbook-pro-16.glb')).confident, 'a guess from hashed names claimed confidence')
})
await check('*highlight* markup keeps trailing punctuation with its word', () => {
  const html = markup('Train *smarter*, not longer')
  assert(/<span class="w"><span class="hl hl-l hl-r">smarter<\/span>,<\/span>/.test(html), html)
  const multi = markup('*one glance*')
  assert(multi.includes('hl-gap') && multi.includes('hl-l') && multi.includes('hl-r'), multi)
})

server = await startServer()
browser = await launchBrowser()
try {
  /* ── stills ────────────────────────────────────────────────────────── */

  await check('app-store set: one file per slide at the exact size, opaque, plus a sheet and credits', async () => {
    const r = await render({ category: 'app-store', theme: 'stride', size: 'iphone-6.9', scale: ci ? 1 : undefined })
    const shots = r.files.filter((f) => /\/\d\d-.*\.png$/.test(f))
    assert(shots.length === 5, `expected 5 screenshots, got ${shots.length}`)
    for (const f of shots) {
      const m = await sharp(f).metadata()
      assert(m.width === 1320 && m.height === 2868, `${f} is ${m.width}×${m.height}`)
      assert(!m.hasAlpha, `${f} has an alpha channel (App Store Connect rejects those)`)
    }
    assert(r.files.some((f) => f.endsWith('overview.png')), 'no contact sheet')
    assert(r.creditFiles.length === 1 && readFileSync(r.creditFiles[0], 'utf8').includes('Ranguel'), 'credits missing')
  })

  await check('3D screens show the screenshot, not a blank panel', async () => {
    const r = await render({ category: 'app-store', theme: 'ledger', size: '660x1434', set: [['device.pose', '0,0,0']], index: 0 }, 'blank-check')
    const sd = await detail(r.files[0], [0.4, 0.55, 0.2, 0.15])
    assert(sd > 12, `screen region is flat (σ=${sd.toFixed(1)}) — texture not showing`)
  })

  await check('the MacBook lid shuts onto its base instead of floating off it', async () => {
    const r = await render({ category: 'device-video', theme: 'desk', size: '960x540', frames: [0], set: [['text.position', 'none']] }, 'lid')
    // Shut, the laptop is a slab low on the page; a lid hinged in the wrong place hangs up here.
    const sd = await detail(r.files[0], [0.1, 0.05, 0.8, 0.45])
    assert(sd < 6, `something is floating above the closed laptop (σ=${sd.toFixed(1)})`)
    const slab = await detail(r.files[0], [0.2, 0.6, 0.5, 0.3])
    assert(slab > 12, `no closed laptop where one should stand (σ=${slab.toFixed(1)})`)
  })

  await check('a slide without a screen renders a blank display instead of failing', async () => {
    const r = await render({ category: 'app-store', theme: 'ledger', size: '440x956', slides: [{ title: 'No *screen* yet' }, { screen: join(SAMPLES, 'tempo-02.png'), title: 'Has one' }], sheet: false }, 'no-screen')
    assert(r.files.length === 2, `expected 2 files, got ${r.files.length}`)
  })

  await check('flat-only renders write no CREDITS.txt', async () => {
    const r = await render({ category: 'app-store', theme: 'canvas', size: '660x1434', index: 0 }, 'flat-only')
    assert(r.creditFiles.length === 0, 'credits written for a render without 3D models')
  })

  await check('transparent mockup keeps alpha with clear corners', async () => {
    const r = await render({ category: 'device-mockup', theme: 'studio', size: '800x600', transparent: true }, 'transparent')
    const m = await sharp(r.files[0]).metadata()
    assert(m.hasAlpha, 'no alpha channel')
    const { data } = await sharp(r.files[0]).extract({ left: 0, top: 0, width: 4, height: 4 }).raw().toBuffer({ resolveWithObject: true })
    assert(data[3] === 0, `corner alpha is ${data[3]}`)
  })

  await check('the Dynamic Island renders as one merged black shape', async () => {
    // The GLBs model the hardware: a pill cutout and a separate round camera,
    // both lit dark grey. iOS draws them as one true-black island, so a render
    // must show a single pure-black run across the top of the display.
    const r = await render(
      { category: 'device-mockup', theme: 'studio', size: '800x1000', transparent: true, set: [['device.pose', '0,0,0']] },
      'island',
    )
    const { data, info } = await sharp(r.files[0]).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
    const px = (x, y) => data.subarray((y * info.width + x) * info.channels)
    let x0 = info.width
    let y0 = info.height
    let x1 = -1
    for (let y = 0; y < info.height; y++) {
      for (let x = 0; x < info.width; x++) {
        if (px(x, y)[3] > 128) {
          if (x < x0) x0 = x
          if (x > x1) x1 = x
          if (y < y0) y0 = y
        }
      }
    }
    const bw = x1 - x0
    // Widest row of pure black in the top of the device: the island line.
    let best = []
    for (let y = y0; y < y0 + Math.round(bw * 0.24); y++) {
      const runs = []
      let s = -1
      for (let x = x0; x <= x1 + 1; x++) {
        const p = px(x, y)
        const black = x <= x1 && p[3] > 200 && p[0] < 12 && p[1] < 12 && p[2] < 12
        if (black && s < 0) s = x
        else if (!black && s >= 0) {
          if (x - s > bw * 0.03) runs.push([s, x])
          s = -1
        }
      }
      const w = (rs) => (rs.length ? Math.max(...rs.map(([a, b]) => b - a)) : 0)
      if (w(runs) > w(best)) best = runs
    }
    assert(best.length === 1, `expected one island run, got ${best.length} (the model's pill and camera are showing through)`)
    const [a, b] = best[0]
    const width = (b - a) / bw
    const center = (a + b) / 2 / bw - x0 / bw
    assert(width > 0.18 && width < 0.32, `island is ${(width * 100).toFixed(1)}% of the body width`)
    assert(Math.abs(center - 0.5) < 0.04, `island center is off by ${((center - 0.5) * 100).toFixed(1)}%`)
  })

  await check('custom theme file extends a built-in, and --set wins over it', async () => {
    const dir = join(ROOT, 'custom', '.app-preview-craft', 'themes')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'brandy.json'), JSON.stringify({ extends: 'app-store/sizzle', palette: { bg: '#00ff00' } }))
    const [job] = buildJobs({ cli: { category: 'app-store', theme: 'brandy', size: '400x868', index: 0, quiet: true, out: join(ROOT, 'custom'), set: [['background.pattern', 'none'], ['background.shapes', '[]'], ['decor', '[]']] } })
    const r = await renderJob(job, { browser, server, log: () => {}, custom: await loadCustomThemes([], join(ROOT, 'custom')) })
    const { data } = await sharp(r.files[0]).extract({ left: 392, top: 4, width: 2, height: 2 }).raw().toBuffer({ resolveWithObject: true })
    assert(data[1] > 200 && data[0] < 60, `expected the custom green background, got rgb(${data[0]},${data[1]},${data[2]})`)
  })

  await check('screen treatment: duotone reaches the rendered screen', async () => {
    const r = await render({ category: 'social-card', theme: 'editorial', size: 'og' }, 'duotone')
    const { data } = await sharp(r.files[0]).extract({ left: 820, top: 250, width: 60, height: 60 }).raw().toBuffer({ resolveWithObject: true })
    let chroma = 0
    for (let i = 0; i < data.length; i += 3) chroma += Math.max(data[i], data[i + 1], data[i + 2]) - Math.min(data[i], data[i + 1], data[i + 2])
    assert(chroma / (data.length / 3) < 40, `screen still colourful (mean chroma ${(chroma / (data.length / 3)).toFixed(1)})`)
  })

  await check('user screenshot of a different aspect is accepted (tablet frame on iPad size)', async () => {
    const r = await render({ category: 'app-store', theme: 'serene', size: 'ipad-13', index: 0, slides: [{ screen: join(SAMPLES, 'tempo-desktop.png'), title: 'Wide *input*' }] }, 'ipad')
    const m = await sharp(r.files[0]).metadata()
    assert(m.width === 2064 && m.height === 2752, `${m.width}×${m.height}`)
  })

  await check('your own GLB renders with its screen, and its credit (or the lack of one) is written down', async () => {
    const dir = join(ROOT, 'own-model')
    mkdirSync(dir, { recursive: true })
    const glb = join(dir, 'my-phone.glb')
    copyFileSync(join(SKILL, 'assets', 'models', 'galaxy-s21-ultra.glb'), glb)
    // --model: the screen is guessed, the display shape measured, the credit read from the file.
    const cli = { model: glb, modelRotate: '0,180,0' }
    const devices = loadCustomDevices({ cwd: dir, cli })
    const [job] = buildJobs({ cli: { category: 'device-mockup', theme: 'studio', size: '600x800', quiet: true, out: join(dir, 'a'), modelId: cli.modelId, set: [['device.pose', '0,0,0']] } })
    const r = await renderJob(job, { browser, server, log: () => {}, devices })
    const sd = await detail(r.files[0], [0.4, 0.4, 0.2, 0.2])
    assert(sd > 12, `own model shows no screenshot (σ=${sd.toFixed(1)})`)
    assert(readFileSync(r.creditFiles[0], 'utf8').includes('DatSketch'), 'the credit inside the GLB was not written')
    // A record in the project config, with no credit: the note says so instead of staying silent.
    const config = { __dir: dir, devices: { 'bare-phone': { file: 'my-phone.glb', screen: { material: 'Screen' }, rotate: [0, 180, 0] } } }
    const [job2] = buildJobs({ cli: { category: 'device-mockup', theme: 'studio', size: '300x400', quiet: true, out: join(dir, 'b'), device: 'bare-phone' } })
    const r2 = await renderJob(job2, { browser, server, log: () => {}, devices: loadCustomDevices({ cwd: join(dir, 'nowhere'), config }) })
    assert(/bare-phone.*no credit on record/.test(readFileSync(r2.creditFiles[0], 'utf8')), 'an uncredited model left no note in CREDITS.txt')
  })

  await check('a patched stage draws the same pixels as a fresh load, and refuses what it cannot take live', async () => {
    const [W, H] = [600, 800]
    const page = await openPage(browser, { width: W, height: H })
    try {
      await page.goto(`${server.origin}/stage/stage.html`, { waitUntil: 'load' })
      await page.waitForFunction('window.stageReady === true')
      const spec = (theme) => ({ category: 'device-mockup', kind: 'still', theme, width: W, height: H, index: 0, count: 1, brand: {}, pixelRatio: 1, animated: false, assetBase: `${server.origin}/`, slides: [{ screen: { url: '/assets/samples/tempo-01.png', w: 1206, h: 2622 }, title: 'Patch *me*' }] })
      const a = resolveTheme('device-mockup', 'levitate')
      let b = a
      for (const [path, v] of [['device.pose', [8, -28, 5]], ['device.x', 0.56], ['device.y', 0.6], ['device.size', 0.6], ['scene.exposure', 1.25], ['scene.key.dir', [0.9, 0.7, 1]], ['scene.camera.yaw', 12], ['device.finish', '#b5462f'], ['device.glare', 1.1]]) b = setPath(b, path, v)
      await page.evaluate((s) => window.stage.load(s), spec(a))
      const r = await page.evaluate((t) => window.stage.patch(t), b)
      assert(r.exact, `patch fell back: ${r.rebuilds}`)
      const patched = await sharp(await page.screenshot({ type: 'png' })).raw().toBuffer()
      await page.evaluate((s) => window.stage.load(s), spec(b))
      const loaded = await sharp(await page.screenshot({ type: 'png' })).raw().toBuffer()
      let off = 0
      for (let i = 0; i < loaded.length; i++) if (Math.abs(loaded[i] - patched[i]) > 3) off++
      assert(off / loaded.length < 0.0005, `${off} of ${loaded.length} values differ between a patch and a load of the same theme`)
      const no = await page.evaluate((t) => window.stage.patch(t), setPath(b, 'palette.bg', '#ff0000'))
      assert(!no.exact && no.rebuilds.includes('palette.bg'), 'a palette change was taken as live')
      assert(!page.errors.length, String(page.errors[0]))
    } finally {
      await page.close()
    }
  })

  await check('keyframes: a frame depends on t alone, and motion.keys move the device', async () => {
    const [W, H] = [360, 640]
    const page = await openPage(browser, { width: W, height: H })
    try {
      await page.goto(`${server.origin}/stage/stage.html`, { waitUntil: 'load' })
      await page.waitForFunction('window.stageReady === true')
      const keys = [{ at: 0, x: 0.3, pose: [0, -30, 0] }, { at: 1, x: 0.7, pose: [0, 30, 0], cam: { dist: 0.9 }, ease: 'linear' }]
      const theme = setPath(setPath(resolveTheme('device-video', 'keyframes'), 'motion.keys', keys), 'text.position', 'none')
      const spec = { category: 'device-video', kind: 'video', theme, width: W, height: H, index: 0, count: 1, brand: {}, pixelRatio: 1, animated: true, assetBase: `${server.origin}/`, slides: [{ screen: { url: '/assets/samples/tempo-01.png', w: 1206, h: 2622 } }] }
      const info = await page.evaluate((s) => window.stage.load(s), spec)
      const shot = async (t) => {
        await page.evaluate((x) => window.stage.seek(x), t)
        return sharp(await page.screenshot({ type: 'png' })).raw().toBuffer()
      }
      const first = await shot(info.duration * 0.25)
      await shot(info.duration * 0.9)
      const again = await shot(info.duration * 0.25)
      assert(first.equals(again), 'the same t drew a different frame after seeking elsewhere')
      const x = (t) => page.evaluate((time) => window.stage.seek(time).then(() => window.stage.three.devices[0].group.position.x), t)
      const [x0, x1] = [await x(0), await x(info.duration)]
      assert(Math.abs(x0 - -0.2 * W) < 1 && Math.abs(x1 - 0.2 * W) < 1, `device x went ${x0.toFixed(1)} → ${x1.toFixed(1)}, expected ${-0.2 * W} → ${0.2 * W}`)
    } finally {
      await page.close()
    }
  })

  if (!quick) {
    for (const [c, list] of Object.entries(THEMES)) {
      await check(`every ${c} theme renders without page errors`, async () => {
        for (const id of Object.keys(list)) {
          const kind = CATEGORIES[c].kind
          const size = c === 'app-store' ? '440x956' : kind === 'video' ? '540x960' : '800x500'
          const r = await render({ category: c, theme: id, size, index: 0, frames: kind === 'video' ? ['mid'] : undefined, scale: 1 }, `themes/${c}`)
          assert(r.files.length >= 1, `${id}: nothing rendered`)
        }
      })
    }
  }

  /* ── studio ────────────────────────────────────────────────────────── */

  await check('studio: previews load, a drag becomes an override, a transcript line and an undo step', async () => {
    const { startStudio } = await import('./studio.mjs')
    // An empty project dir, so a config in the caller's cwd cannot change the slide count.
    const cwd = process.cwd()
    const dir = join(ROOT, 'studio-project')
    mkdirSync(dir, { recursive: true })
    process.chdir(dir)
    const { server: studio, link } = await startStudio({ port: 0, open: false, quiet: true }).finally(() => process.chdir(cwd))
    const page = await browser.newPage()
    try {
      await page.setViewport({ width: 1440, height: 900 })
      const errors = []
      page.on('pageerror', (e) => errors.push(String(e)))
      // Top frame only: the previews are same-origin iframes, and undo rebuilds them.
      await page.evaluateOnNewDocument(() => window.top === window && localStorage.clear())
      await page.goto(link, { waitUntil: 'load' })
      const settled = (n) =>
        page.waitForFunction((count) => {
          const frames = [...document.querySelectorAll('.frame')]
          return frames.length === count && frames.every((f) => !f.classList.contains('busy')) && frames.every((f) => f.querySelector('iframe').contentWindow.stage?.ready)
        }, { timeout: ci ? 600_000 : 60_000 }, n)
      await settled(5)
      const failures = await page.$$eval('.frame .error', (els) => els.map((e) => e.textContent.slice(0, 200)))
      assert(!failures.length, `preview errors: ${failures.join(' | ')}`)
      // Drag the device on slide 2: it moves there and then, the other frames follow,
      // and the move is an override, a line in the transcript and one undo step.
      const at = await page.$eval('.frame[data-index="1"] iframe', (el) => {
        const r = el.getBoundingClientRect()
        const st = el.contentWindow.stage
        const b = st.three.devices[0].pageRect()
        const k = r.width / st.ctx.W
        return { x: r.x + (b.x + b.w / 2) * k, y: r.y + (b.y + b.h / 2) * k }
      })
      const deviceX = (i) => page.$eval(`.frame[data-index="${i}"] iframe`, (el) => el.contentWindow.stage.three.devices[0].group.position.x)
      const before = await deviceX(1)
      await page.mouse.move(at.x, at.y)
      await page.mouse.down()
      await page.mouse.move(at.x + 24, at.y, { steps: 4 })
      const during = await deviceX(1)
      await page.mouse.up()
      assert(during > before + 20, `the device did not follow the drag (${before.toFixed(0)} → ${during.toFixed(0)})`)
      await page.waitForFunction((want) => Math.abs(document.querySelector('.frame[data-index="3"] iframe').contentWindow.stage.three.devices[0].group.position.x - want) < 1, { timeout: 20_000 }, during)
      const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage)[0])).overridesByCat['app-store'])
      await page.waitForFunction(() => Object.keys(localStorage).length > 0, { timeout: 5000 })
      assert((await stored())?.device?.x > 0.5, `no device.x override after the drag: ${JSON.stringify(await stored())}`)
      await page.waitForFunction(() => fetch('/api/transcript').then((r) => r.json()).then((t) => t.events.some((e) => e.type === 'preview.edit')), { timeout: 10_000 })
      const moved = readEvents(dir).find((e) => e.type === 'preview.edit')
      assert(/^Moved .* device\.x = /.test(moved.text) && moved.changes[0].path === 'device.x', `transcript line: ${moved?.text}`)
      assert(readSession(dir).themeOverrides.device.x === (await stored()).device.x, 'session.json does not hold the override')
      await page.keyboard.down('Control')
      await page.keyboard.press('z')
      await page.keyboard.up('Control')
      await page.waitForFunction(() => !JSON.parse(localStorage.getItem(Object.keys(localStorage)[0])).overridesByCat['app-store']?.device, { timeout: 5000 })
      await settled(5)
      assert(Math.abs((await deviceX(1)) - before) < 1, 'undo did not put the device back')

      await page.keyboard.press('4') // device-video
      await settled(1)
      assert(await page.$eval('#transport', (el) => !el.hidden), 'video transport hidden')
      assert(!errors.length, errors.join('\n'))
    } finally {
      await page.close()
      await studio.close()
    }
  })

  await check('studio: screens kept in the browser still load after the studio restarts', async () => {
    const { startStudio } = await import('./studio.mjs')
    const cwd = process.cwd()
    const dir = join(ROOT, 'studio-restart')
    mkdirSync(dir, { recursive: true })
    const open = async (port) => {
      process.chdir(dir)
      return startStudio({ port, open: false, quiet: true }).finally(() => process.chdir(cwd))
    }
    // The same port both times: the browser's storage, where the slides live, is per origin.
    let { server: studio, link } = await open(4790 + Math.floor(Math.random() * 100))
    const port = Number(new URL(link).port)
    const page = await browser.newPage()
    try {
      await page.setViewport({ width: 1200, height: 800 })
      await page.goto(link, { waitUntil: 'load' })
      await page.evaluate(() => localStorage.clear())
      const settled = (n) =>
        page.waitForFunction((count) => {
          const frames = [...document.querySelectorAll('.frame')]
          return frames.length === count && frames.every((f) => !f.classList.contains('busy')) && frames.every((f) => f.querySelector('iframe').contentWindow.stage?.ready)
        }, { timeout: ci ? 600_000 : 60_000 }, n)
      await page.reload({ waitUntil: 'load' })
      await settled(5)
      const [chooser] = await Promise.all([page.waitForFileChooser(), page.click('.add-tile')])
      await Promise.all([page.waitForFunction(() => document.querySelectorAll('.frame').length === 1, { timeout: 30_000 }), chooser.accept([join(SAMPLES, 'tempo-03.png')])])
      await settled(1)
      await new Promise((r) => setTimeout(r, 400)) // the debounced save to localStorage
      await studio.close()
      ;({ server: studio, link } = await open(port)) // a new process in all but name: its /file allow-list starts empty
      await page.goto(link, { waitUntil: 'load' })
      await settled(1)
      const errors = await page.$$eval('.frame .error', (els) => els.map((e) => e.textContent.slice(0, 160)))
      assert(!errors.length, `the uploaded screen did not survive the restart: ${errors.join(' | ')}`)
      const painted = await page.$eval('.frame iframe', (el) => !!el.contentWindow.stage.ctx.sources[0]?.img?.naturalWidth)
      assert(painted, 'the restored slide has no image')
    } finally {
      await page.close()
      await studio.close()
    }
  })

  /* ── video ─────────────────────────────────────────────────────────── */

  if (!hasFfmpeg()) {
    console.log('  - ffmpeg missing: video checks skipped')
  } else {
    await check('device video: requested duration, 30fps, H.264, credits in metadata', async () => {
      // Two slides, so even the short CI duration leaves each beat above the 0.4s floor.
      const slides = ['tempo-01.png', 'tempo-02.png'].map((f) => ({ screen: join(SAMPLES, f), title: f }))
      const r = await render({ category: 'device-video', theme: 'turntable', size: ci ? '270x480' : '540x960', duration: ci ? 1.5 : 3, slides }, 'video')
      const info = ffprobe(r.files[0])
      const v = info.streams.find((s) => s.codec_type === 'video')
      assert(v.codec_name === 'h264' && v.pix_fmt === 'yuv420p', `${v.codec_name}/${v.pix_fmt}`)
      assert(Math.abs(Number(info.format.duration) - (ci ? 1.5 : 3)) < 0.1, `duration ${info.format.duration}`)
      assert(v.r_frame_rate === '30/1', v.r_frame_rate)
      assert(/Ranguel/.test(info.format.tags?.comment ?? ''), 'no credit in metadata')
    })

    await check('screen recordings drive the timeline (slide holds for the clip length)', async () => {
      const r = await render({ category: 'screen-video', theme: 'store-preview', size: '443x960', duration: 2, slides: [{ screen: join(SAMPLES, 'tempo-recording.mp4'), title: 'Live' }, { screen: join(SAMPLES, 'tempo-02.png'), title: 'Map', hold: 1 }] }, 'recording')
      const d = probe(r.files[0]).duration
      // 3.5s clip + 1s hold + the theme's 0.8s end hold; motion.duration is ignored
      assert(Math.abs(d - 5.3) < 0.15, `duration ${d}, expected ~5.3`)
    })

    await check('app-preview size gets a silent stereo AAC track', async () => {
      const r = await render({ category: 'screen-video', theme: 'store-preview', size: 'app-preview', duration: 2, fps: 30 }, 'preview')
      const a = ffprobe(r.files[0]).streams.find((s) => s.codec_type === 'audio')
      assert(a && a.codec_name === 'aac' && a.channels === 2, 'no stereo aac track')
    })

    await check('transparent ProRes 4444 keeps alpha', async () => {
      const r = await render({ category: 'device-video', theme: 'float', size: ci ? '180x320' : '360x640', duration: ci ? 0.5 : 1, format: 'mov', transparent: true }, 'alpha')
      const v = ffprobe(r.files[0]).streams.find((s) => s.codec_type === 'video')
      assert(v.codec_name === 'prores' && /yuva/.test(v.pix_fmt), `${v.codec_name}/${v.pix_fmt}`)
    })

    await check('gif export', async () => {
      const r = await render({ category: 'screen-video', theme: 'stack', size: '360x640', duration: 2, format: 'gif' }, 'gif')
      const m = await sharp(r.files[0], { animated: true }).metadata()
      assert(m.format === 'gif' && m.pages > 10, `${m.format} with ${m.pages} frames`)
    })
  }
} finally {
  await browser.close()
  await server.close()
}

const failed = results.filter(([ok]) => !ok)
console.log(`\n${results.length - failed.length}/${results.length} passed${failed.length || args.includes('--keep') ? ` — renders kept in ${ROOT}` : ''}`)
if (!failed.length && !args.includes('--keep')) rmSync(ROOT, { recursive: true, force: true })
process.exitCode = failed.length ? 1 : 0
