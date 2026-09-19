// The render pipeline shared by the CLI and the studio:
//
//   job (category, theme, slides, sizes, overrides)
//     → sharp/ffmpeg prepare screens into a private work dir
//     → local server + headless Chrome load stage.html per output
//     → stills are captured and finished by sharp; videos are piped to ffmpeg
//     → files land in the output dir (the caller's cwd by default), with
//       CREDITS.txt whenever a CC-BY model appears
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, extname, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { CATEGORIES } from '../stage/catalog/categories.js'
import { creditLine, DEVICES, deviceDef, deviceIds, FLAT_FRAMES, registerDevices } from '../stage/catalog/devices.js'
import { LAYOUTS } from '../stage/catalog/layouts.js'
import { coerce, isObj, merge, resolveSize, resolveTheme, setPath } from '../stage/catalog/resolve.js'
import { launchBrowser, openPage } from './browser.mjs'
import { contactSheet, finishStill, prepareScreen, stageAsset, vibrantColor } from './images.mjs'
import { SKILL, startServer } from './server.mjs'
import { createEncoder, extractFrames, posterFrame, probe, requireFfmpeg, VIDEO_EXT } from './video.mjs'

export const TEMP_ROOT = join(tmpdir(), 'app-preview-craft')
/** Path for logs: relative when under the cwd, absolute otherwise. */
const shown = (p) => {
  const r = relative(process.cwd(), p)
  return !r || r.startsWith('..') ? p : r
}
const expand = (p, base = process.cwd()) => (p ? resolve(base, String(p).replace(/^~(?=$|\/)/, homedir())) : p)
const slug = (s) =>
  String(s ?? '')
    .replace(/\*/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40)

export const SAMPLE_SLIDES = [
  { screen: 'tempo-01.png', kicker: 'Today', title: 'Every run. *One glance.*', subtitle: 'Rings, streaks and recovery on a single screen.', desktop: 'tempo-desktop.png' },
  { screen: 'tempo-02.png', kicker: 'Record', title: 'Maps that *move* with you', subtitle: 'GPS routes, splits and personal bests in real time.' },
  { screen: 'tempo-03.png', kicker: 'Insights', title: 'Train *smarter*, not longer', subtitle: 'Heart-rate zones and trends that explain your week.' },
  { screen: 'tempo-04.png', kicker: 'Coach', title: 'A plan that *adapts*', subtitle: 'Daily sessions tuned to your goal race.' },
  { screen: 'tempo-05.png', kicker: 'Club', title: 'Run *together*', subtitle: 'Badges, streaks and a friendly leaderboard.' },
]
// `samples: 'desk'`: the laptop plays the live dashboard recording. Stills keep
// the PNG, which is sharper than a video frame.
export const SAMPLE_SLIDES_DESK = SAMPLE_SLIDES.map((s, i) => (i ? s : { ...s, desktop: 'tempo-dashboard.mp4' }))
// Themes built around long captures ask for these with `samples: 'tall'`.
export const SAMPLE_SLIDES_TALL = [
  { screen: 'tempo-journal-tall.png', kicker: 'Journal', title: 'Every run, *every note*', subtitle: 'Scroll back through a whole season of training.' },
  { screen: 'tempo-01.png', kicker: 'Today', title: 'Your day *at a glance*', subtitle: 'Rings, streaks and recovery on a single screen.' },
  { screen: 'tempo-04.png', kicker: 'Coach', title: 'A plan that *adapts*', subtitle: 'Daily sessions tuned to your goal race.' },
]
export const SAMPLE_BRAND = { name: 'Tempo', tagline: 'Run *your* way.', cta: 'Download on iPhone & Android', url: 'tempo.run' }

/* ── custom themes and project config ─────────────────────────────────── */

async function loadThemeFile(file) {
  if (/\.(mjs|js)$/.test(file)) {
    const mod = await import(pathToFileURL(file).href)
    return mod.default ?? mod.theme
  }
  return JSON.parse(readFileSync(file, 'utf8'))
}

/** Custom themes from ./.app-preview-craft/themes, ~/.app-preview-craft/themes and explicit files. */
export async function loadCustomThemes(files = [], cwd = process.cwd()) {
  const custom = {}
  const dirs = [join(homedir(), '.app-preview-craft', 'themes'), join(cwd, '.app-preview-craft', 'themes')]
  const all = []
  for (const d of dirs) {
    if (!existsSync(d)) continue
    for (const f of readdirSync(d)) if (/\.(json|mjs|js)$/.test(f)) all.push(join(d, f))
  }
  all.push(...files.map((f) => expand(f, cwd)))
  for (const f of all) {
    const t = await loadThemeFile(f)
    if (!isObj(t)) throw new Error(`${f}: a theme file must hold one object`)
    const id = t.id ?? basename(f).replace(/\.(json|mjs|js)$/, '')
    custom[id] = { ...t, id, file: f }
  }
  return custom
}

export function findConfig(cwd = process.cwd()) {
  for (const name of ['app-preview-craft.json', '.app-preview-craft/config.json']) {
    const p = join(cwd, name)
    if (existsSync(p)) return p
  }
  return null
}

export function loadConfig(file) {
  const cfg = JSON.parse(readFileSync(file, 'utf8'))
  cfg.__dir = dirname(file)
  return cfg
}

/* ── job normalisation ────────────────────────────────────────────────── */

/**
 * Turn CLI options and/or a config object into a list of concrete jobs.
 * Later layers win: config top-level → config.jobs[i] → CLI.
 */
export function buildJobs({ config, cli = {} }) {
  const base = config ? { ...config } : {}
  const jobs = base.jobs?.length ? base.jobs.map((j) => merge(stripJobs(base), j)) : [stripJobs(base)]
  return jobs.map((j) => {
    const job = merge(j, cleanCli(cli))
    // Slides from the CLI replace config slides only when screens were given.
    if (cli.slides?.length) job.slides = cli.slides
    else if (j.slides) job.slides = j.slides
    job.__dir = config?.__dir ?? process.cwd()
    return job
  })
}
const stripJobs = (c) => {
  const { jobs, ...rest } = c
  return rest
}
const cleanCli = (cli) => Object.fromEntries(Object.entries(cli).filter(([k, v]) => v !== undefined && k !== 'slides'))

/** Theme overrides from the job's shortcut fields and --set pairs. */
function jobOverrides(job) {
  const o = []
  if (isObj(job.themeOverrides)) o.push(job.themeOverrides)
  if (isObj(job.theme)) o.push(job.theme)
  const flat = {}
  const put = (path, v) => {
    if (v !== undefined && v !== null) Object.assign(flat, setPath(flat, path, v))
  }
  put('layout', job.layout)
  put('type.display', job.font)
  put('type.body', job.bodyFont)
  for (const k of ['bg', 'bg2', 'bg3', 'ink', 'sub', 'accent', 'accent2', 'surface']) put(`palette.${k}`, job.palette?.[k])
  put('background.kind', job.background)
  put('background.pattern', job.pattern)
  put('background.image', job.backgroundImage)
  put('device.finish', job.finish)
  if (job.pose) put('device.pose', Array.isArray(job.pose) ? job.pose : coerce('device.pose', job.pose))
  if (job.device) {
    const [mode, variant] = String(job.device).split(':')
    if (deviceDef(mode)) {
      put('device.mode', '3d')
      put('device.model', mode)
    } else if (['flat', 'frameless', 'none', '3d'].includes(mode)) {
      put('device.mode', mode)
      if (variant) put('device.flat', variant)
    } else if (FLAT_FRAMES[mode]) {
      put('device.mode', 'flat')
      put('device.flat', mode)
    } else throw new Error(`unknown device "${job.device}". Models: ${deviceIds().join(', ')}; or flat[:phone|phone-android|tablet|browser], frameless, none`)
  }
  put('screen.cleanStatusBar', job.cleanStatusBar)
  put('motion.duration', job.duration)
  put('motion.fps', job.fps)
  put('motion.speed', job.speed)
  put('motion.intro', job.intro)
  put('motion.outro', job.outro)
  if (job.noDecor) put('decor', [])
  o.push(flat)
  for (const [path, value] of job.set ?? []) o.push(setPath({}, path, coerce(path, value)))
  return o
}

/* ── asset preparation ────────────────────────────────────────────────── */

async function prepareSlides(job, theme, work, { fps, isVideo, log }) {
  const dir = job.__dir
  const usingSamples = !job.slides?.length
  const slides = usingSamples ? (job.sampleCopy ?? { tall: SAMPLE_SLIDES_TALL, desk: SAMPLE_SLIDES_DESK }[theme.samples] ?? SAMPLE_SLIDES) : job.slides
  if (usingSamples) log('  no screens given: using the bundled "Tempo" sample screens')
  const sampleDir = join(SKILL, 'assets', 'samples')
  const out = []
  for (const [i, raw] of slides.entries()) {
    const s = typeof raw === 'string' ? { screen: raw } : { ...raw }
    const resolveIn = (p) => (usingSamples ? join(sampleDir, p) : expand(p, dir))
    const n = String(i + 1).padStart(2, '0')
    for (const key of ['screen', 'desktop']) {
      if (!s[key]) continue
      const spec = typeof s[key] === 'string' ? { src: s[key] } : s[key]
      const src = resolveIn(spec.src)
      if (!existsSync(src)) throw new Error(`slide ${i + 1}: ${key} not found: ${src}`)
      if (VIDEO_EXT.test(src)) {
        requireFfmpeg()
        const info = probe(src)
        const framesDir = join(work.dir, `${key}-${n}-frames`)
        const trim = spec.trim ?? s.trim
        if (isVideo) {
          const count = await extractFrames(src, framesDir, { fps, trim, maxHeight: 2400 })
          const poster = join(work.dir, `${key}-${n}-poster.jpg`)
          await posterFrame(src, poster, Math.min(0.5, info.duration / 2))
          s[key] = { frames: { base: work.url(`${key}-${n}-frames/`), count, fps, poster: work.url(basename(poster)) }, w: info.width, h: info.height, source: src }
          if (key === 'screen' && s.hold == null && spec.hold != null) s.hold = spec.hold
        } else {
          // A still needs one frame: take it from `at` seconds (default: middle).
          const poster = join(work.dir, `${key}-${n}-still.png`)
          await posterFrame(src, poster, spec.at ?? s.at ?? info.duration / 2)
          const prepared = await prepareScreen(poster, work.dir, theme.screen, { name: `${key}-${n}` })
          s[key] = { url: work.url(basename(prepared.file)), w: prepared.w, h: prepared.h, backdrop: work.url(basename(prepared.backdrop)), source: src }
        }
      } else {
        const prepared = await prepareScreen(src, work.dir, key === 'screen' ? theme.screen : {}, { name: `${key}-${n}` })
        s[key] = { url: work.url(basename(prepared.file)), w: prepared.w, h: prepared.h, backdrop: work.url(basename(prepared.backdrop)), source: src }
      }
    }
    // Asset paths inside slide decor (icons, custom badges).
    if (Array.isArray(s.decor)) s.decor = s.decor.map((d, k) => stageDecorAssets(d, work, resolveIn, `s${n}-d${k}`))
    out.push(s)
  }
  return { slides: out, usingSamples }
}

function stageDecorAssets(d, work, resolveIn, name) {
  if (!isObj(d)) return d
  const c = { ...d }
  for (const key of ['src', 'icon']) {
    if (typeof c[key] === 'string' && !/^(https?:|data:)/.test(c[key])) {
      const p = resolveIn(c[key])
      if (existsSync(p)) c[key] = work.url(basename(stageAsset(p, work.dir, `${name}-${key}`)))
    }
  }
  return c
}

/* ── output naming ────────────────────────────────────────────────────── */

function outputPlan(job, category, theme, size, { index, total, ext, set }) {
  const outArg = job.out ? expand(job.out, process.cwd()) : process.cwd()
  const explicitFile = job.out && extname(outArg) && total === 1 && !set
  if (explicitFile) return outArg
  const base = job.name ?? `${category}-${theme.id}`
  if (set) {
    const s = job.slidesMeta?.[index]
    const title = slug(s?.title) || `screen`
    return join(outArg, base, size.key, `${String(index + 1).padStart(2, '0')}-${title}.${ext}`)
  }
  const suffix = total > 1 ? `-${String(index + 1).padStart(2, '0')}` : ''
  return join(outArg, `${base}-${size.key}${suffix}.${ext}`)
}

function writeCredits(dir, credits, uncredited = []) {
  if (!credits.length && !uncredited.length) return null
  mkdirSync(dir, { recursive: true })
  const file = join(dir, 'CREDITS.txt')
  const existing = existsSync(file) ? readFileSync(file, 'utf8').split('\n') : []
  const lines = new Set(existing.filter((l) => l.startsWith('- ')))
  for (const c of credits) lines.add(`- ${creditLine(c)}`)
  // A model someone brought without a credit: say so, so the gap is visible.
  for (const name of uncredited) lines.add(`- "${name}": your own model, no credit on record — add one here if its license asks for attribution`)
  writeFileSync(
    file,
    [
      '3D device models used in these renders (CC-BY-4.0 unless a line says otherwise — attribution required when you publish them):',
      '',
      ...[...lines].sort(),
      '',
      'License: https://creativecommons.org/licenses/by/4.0/',
      '',
    ].join('\n'),
  )
  return file
}

/* ── main entry ───────────────────────────────────────────────────────── */

/**
 * Render one job. Options:
 *   job       normalised job (see buildJobs)
 *   custom    custom themes map
 *   browser   reuse an existing browser (studio)
 *   server    reuse an existing server (studio)
 *   log, onProgress(fraction, label)
 */
export async function renderJob(job, { custom = {}, devices = {}, browser: sharedBrowser, server: sharedServer, log = console.error, onProgress = () => {}, signal } = {}) {
  const category = job.category
  // Custom models join the catalog before the theme resolves, so --device and device.model can name them.
  registerDevices(devices)
  if (job.modelId) job = { ...job, device: job.device ?? job.modelId }
  const cat = CATEGORIES[category]
  if (!cat) throw new Error(`unknown category "${category}". Try: ${Object.keys(CATEGORIES).join(', ')}`)
  const themeId = typeof job.theme === 'string' ? job.theme : isObj(job.theme) ? (job.theme.extends ?? job.theme.id) : undefined
  if (typeof job.theme === 'string' && /\.(json|mjs|js)$/.test(job.theme)) {
    Object.assign(custom, await loadCustomThemes([job.theme], job.__dir))
    job = { ...job, theme: basename(job.theme).replace(/\.(json|mjs|js)$/, '') }
  }
  const overrides = jobOverrides(job)
  let theme = resolveTheme(category, typeof job.theme === 'string' ? job.theme : themeId, { custom, overrides })
  const layoutKind = LAYOUTS[theme.layout]?.kind
  if (!layoutKind) throw new Error(`unknown layout "${theme.layout}"`)
  if (layoutKind !== cat.kind) {
    throw new Error(`layout "${theme.layout}" makes a ${layoutKind}, but ${category} is a ${cat.kind} category`)
  }
  const isVideo = cat.kind === 'video'
  const sizes = (Array.isArray(job.size) ? job.size : String(job.size ?? cat.defaultSize).split(',')).map((s) => resolveSize(category, s.trim()))
  const fps = theme.motion.fps

  const work = { id: `job-${process.pid}-${randomBytes(3).toString('hex')}` }
  work.dir = join(TEMP_ROOT, work.id)
  mkdirSync(work.dir, { recursive: true })

  const ownServer = !sharedServer
  const server = sharedServer ?? (await startServer())
  const prefix = server.mount(work.id, work.dir)
  work.url = (name) => `${prefix}${name}`
  let browser = sharedBrowser
  const files = []
  const warnings = []
  let credits = []
  const uncredited = new Set()
  try {
    onProgress(0.02, 'preparing screens')
    const { slides, usingSamples } = await prepareSlides(job, theme, work, { fps, isVideo, log })
    job.slidesMeta = slides

    // "auto" palette entries take the screenshot's most vivid color.
    for (const [k, v] of Object.entries(theme.palette)) {
      if (v === 'auto') {
        const src = slides.find((s) => s.screen?.source && !VIDEO_EXT.test(s.screen.source))?.screen.source
        theme = setPath(theme, `palette.${k}`, (src && (await vibrantColor(src))) ?? '#7c9cff')
      }
    }
    if (theme.background.image && !/^(https?:|data:)/.test(theme.background.image)) {
      const p = expand(theme.background.image, job.__dir)
      if (!existsSync(p)) throw new Error(`background image not found: ${p}`)
      theme = setPath(theme, 'background.image', work.url(basename(stageAsset(p, work.dir, 'background'))))
    }
    const brand = merge(usingSamples ? SAMPLE_BRAND : {}, job.brand)
    if (brand.icon && !/^(https?:|data:)/.test(brand.icon)) {
      const p = expand(brand.icon, job.__dir)
      if (existsSync(p)) brand.icon = work.url(basename(stageAsset(p, work.dir, 'brand-icon')))
    }

    // The stage fetches a custom GLB like any other asset: from this job's work dir.
    const specDevices = {}
    for (const [id, def] of Object.entries(devices)) {
      const { path, ...rest } = def
      specDevices[id] = { ...rest, url: work.url(basename(stageAsset(path, work.dir, `model-${id}`))) }
    }

    if (!browser) browser = await launchBrowser({ headless: !job.headful })
    const outputs = []
    for (const size of sizes) {
      if (isVideo) outputs.push({ size, index: 0, total: 1 })
      else if ((cat.set && job.index == null) || job.all) slides.forEach((_, i) => outputs.push({ size, index: i, total: slides.length, set: cat.set }))
      else outputs.push({ size, index: job.index ?? 0, total: 1 })
    }

    const stillFormat = String(job.format ?? 'png').replace('jpeg', 'jpg')
    const videoFormat = String(job.format ?? 'mp4')
    let done = 0
    for (const o of outputs) {
      if (signal?.aborted) throw new Error('cancelled')
      const { size } = o
      // iPad and tablet sizes get a tablet frame unless the theme is frameless.
      let sizeTheme = theme
      if (size.frame === 'tablet' && theme.device.mode !== 'frameless' && theme.device.mode !== 'none') {
        sizeTheme = merge(theme, { device: { mode: 'flat', flat: 'tablet', size: Math.min(theme.device.size, 0.66) } })
      }
      const transparent = !!job.transparent
      if (transparent) sizeTheme = merge(sizeTheme, { background: { kind: 'none', grain: 0, vignette: 0, pattern: 'none' } })
      const pixels = size.w * size.h
      const pixelRatio = job.scale ?? (isVideo ? 1 : pixels > 5e6 ? 1.25 : 2)
      const spec = {
        category,
        kind: cat.kind,
        theme: sizeTheme,
        width: size.w,
        height: size.h,
        slides,
        index: o.index,
        count: slides.length,
        brand,
        pixelRatio,
        animated: isVideo,
        transparent,
        credits: [],
        devices: specDevices,
        assetBase: `${server.origin}/`,
        screenScale: pixels > 6e6 ? 1.2 : 1,
      }
      if (job.dryRun) {
        log(JSON.stringify(spec, null, 2))
        continue
      }
      const page = await openPage(browser, { width: size.w, height: size.h, verbose: job.verbose })
      try {
        await page.goto(`${server.origin}/stage/stage.html`, { waitUntil: 'load' })
        await page.waitForFunction('window.stageReady === true')
        const info = await page.evaluate((s) => window.stage.load(s), spec)
        if (page.errors.length) throw page.errors[0]
        credits = mergeCredits(credits, info.credits)
        for (const n of info.uncredited ?? []) uncredited.add(n)
        for (const w of info.warnings) {
          if (warnings.includes(w)) continue
          warnings.push(w)
          log(`  note: ${w}`)
        }
        if (info.gl && /swiftshader/i.test(info.gl) && !warnings.includes('gpu')) {
          warnings.push('gpu')
          log('  note: WebGL is running on SwiftShader (no GPU); 3D renders will be slow')
        }
        const out = outputPlan(job, category, sizeTheme, size, { ...o, ext: isVideo ? (videoFormat === 'hevc' ? 'mp4' : videoFormat) : stillFormat })
        mkdirSync(dirname(out), { recursive: true })

        if (isVideo && job.frames?.length) {
          // Poster frames: PNG stills pulled from the video timeline.
          for (const at of job.frames) {
            const t = at === 'mid' ? info.duration / 2 : at === 'end' ? Math.max(0, info.duration - 0.05) : Number(at)
            await page.evaluate((x) => window.stage.seek(x), t)
            const buf = await page.screenshot({ type: 'png', omitBackground: transparent })
            const file = out.replace(/\.[a-z0-9]+$/i, `-t${t.toFixed(1)}.png`)
            await finishStill(buf, file, { width: size.w, height: size.h, transparent, background: sizeTheme.palette.bg })
            files.push(file)
            log(`  ✓ ${shown(file)}`)
          }
          done++
          continue
        }
        if (!isVideo) {
          const buf = await page.screenshot({ type: 'png', omitBackground: transparent, captureBeyondViewport: false })
          await finishStill(buf, out, { width: size.w, height: size.h, format: stillFormat, transparent, background: sizeTheme.palette.bg, quality: job.quality ?? 92, metadata: info.credits.length ? { Copyright: info.credits.map(creditLine).join(' | ') } : {} })
          files.push(out)
          done++
          onProgress(0.05 + (0.9 * done) / outputs.length, shown(out))
          log(`  ✓ ${shown(out)}`)
        } else {
          requireFfmpeg()
          const frames = Math.ceil(info.duration * info.fps)
          const alpha = transparent && ['mov', 'webm'].includes(videoFormat)
          const enc = createEncoder({
            out,
            fps: info.fps,
            width: size.w,
            height: size.h,
            format: videoFormat,
            frameCodec: alpha || job.lossless ? 'png' : 'mjpeg',
            audio: job.audio ? expand(job.audio, job.__dir) : null,
            silentAudio: !job.audio && (size.preview || job.silentAudio),
            duration: info.duration,
            metadata: {
              title: brand.name ? `${brand.name} — ${sizeTheme.name ?? sizeTheme.id}` : (sizeTheme.name ?? sizeTheme.id),
              comment: info.credits.length ? `3D models: ${info.credits.map(creditLine).join(' | ')}` : 'Rendered with app-preview-craft',
            },
            crf: job.crf ?? 17,
            gifWidth: job.gifWidth,
            gifFps: job.gifFps,
          })
          const t0 = Date.now()
          try {
            for (let f = 0; f < frames; f++) {
              if (signal?.aborted) throw new Error('cancelled')
              await page.evaluate((t) => window.stage.seek(t), f / info.fps)
              const buf = alpha || job.lossless
                ? await page.screenshot({ type: 'png', omitBackground: alpha, optimizeForSpeed: true })
                : await page.screenshot({ type: 'jpeg', quality: job.quality ?? 94, optimizeForSpeed: true })
              await enc.write(buf)
              if (f % 15 === 0 || f === frames - 1) {
                const pct = (f + 1) / frames
                onProgress(0.05 + 0.9 * ((done + pct) / outputs.length), `frame ${f + 1}/${frames}`)
                if (process.stderr.isTTY && !job.quiet) {
                  const eta = ((Date.now() - t0) / (f + 1)) * (frames - f - 1)
                  process.stderr.write(`\r  rendering ${basename(out)}  ${String(Math.round(pct * 100)).padStart(3)}%  frame ${f + 1}/${frames}  eta ${Math.ceil(eta / 1000)}s   `)
                }
              }
              if (page.errors.length) throw page.errors[0]
            }
            await enc.end()
          } catch (err) {
            enc.abort()
            throw err
          }
          if (process.stderr.isTTY && !job.quiet) process.stderr.write('\n')
          files.push(out)
          done++
          log(`  ✓ ${shown(out)}  (${info.duration.toFixed(1)}s @ ${info.fps}fps, ${((Date.now() - t0) / 1000).toFixed(1)}s to render)`)
        }
      } finally {
        await page.close()
      }
    }

    if (job.sheet !== false && cat.set && files.length > 1 && !job.dryRun) {
      for (const size of sizes) {
        const group = files.filter((f) => f.includes(`${join(size.key, '')}`) || dirname(f).endsWith(size.key))
        if (group.length > 1) {
          const sheet = join(dirname(group[0]), 'overview.png')
          await contactSheet(group, sheet, { height: 1000 })
          log(`  ✓ ${shown(sheet)}  (contact sheet)`)
          files.push(sheet)
        }
      }
    }
    const creditDirs = new Set(files.map((f) => (cat.set ? dirname(dirname(f)) : dirname(f))))
    const creditFiles = [...creditDirs].map((d) => writeCredits(d, credits, [...uncredited])).filter(Boolean)
    if (creditFiles.length) log(`  ✓ ${creditFiles.map(shown).join(', ')}  (${credits.length ? 'CC-BY attribution' : 'a note'} for the 3D models)`)
    onProgress(1, 'done')
    return { category, theme: theme.id, files, credits, creditFiles, warnings }
  } finally {
    server.unmount(work.id)
    if (ownServer) await server.close()
    if (!sharedBrowser && browser) await browser.close()
    if (!job.keepWork) rmSync(work.dir, { recursive: true, force: true })
  }
}

function mergeCredits(a, b) {
  const key = (c) => c.source ?? `${c.title}|${c.author}`
  const seen = new Set(a.map(key))
  return [...a, ...b.filter((c) => !seen.has(key(c)) && seen.add(key(c)))]
}
