#!/usr/bin/env node
// app-preview-craft — App Store screenshots, social cards and 3D device videos.
//
//   node cli.mjs <category> [screens...] [options]
//   node cli.mjs list [categories|themes|sizes|devices|fonts|layouts|options] [--category c]
//   node cli.mjs gallery <category> [--size s]      one thumbnail per theme
//   node cli.mjs init [category]                     write app-preview-craft.json here
//   node cli.mjs studio [--port 4747]                open the preview studio
//   node cli.mjs transcript [--tail n] [--json]      what was done in the studio, and how to render it
//   node cli.mjs inspect <model.glb>                 materials in a 3D model and its likely screen
//   node cli.mjs doctor | models
import { existsSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { CATEGORIES, SIZES } from '../stage/catalog/categories.js'
import { DEVICES, FLAT_FRAMES } from '../stage/catalog/devices.js'
import { FONTS } from '../stage/catalog/fonts.js'
import { LAYOUTS } from '../stage/catalog/layouts.js'
import { SCHEMA } from '../stage/catalog/schema.js'
import { THEMES } from '../stage/themes/index.js'
import { describeModel, inspectModel, loadCustomDevices } from './custom-models.mjs'
import { buildJobs, findConfig, loadConfig, loadCustomThemes, renderJob, SAMPLE_SLIDES } from './render.mjs'

const HELP = `app-preview-craft <category> [screens...] [options]

Categories
${Object.entries(CATEGORIES).map(([k, c]) => `  ${k.padEnd(15)} ${c.name} — ${Object.keys(THEMES[k]).length} themes`).join('\n')}

Content
  screens...              screenshots (png/jpg/webp) or screen recordings (mp4/mov/webm)
  --title <text>          headline per slide, repeat in order ("*word*" highlights, " | " breaks)
  --subtitle <text>       subtitle per slide, repeatable
  --kicker <text>         small label above the headline, repeatable
  --config <file>         project config (default: ./app-preview-craft.json when present)
  --brand <name> --tagline <t> --cta <t> --url <u> --icon <png>

Look
  -t, --theme <id|file>   built-in theme id, or a .json/.mjs theme file (may "extends" a built-in)
  --layout <id>           any layout of the same kind (see: list layouts)
  --device <id>           ${Object.keys(DEVICES).join(' | ')}
                          | flat[:${Object.keys(FLAT_FRAMES).join('|')}] | frameless | none
                          | the id of your own model (see: list devices)
  --model <file.glb>      bring your own 3D device; it becomes --device (see: inspect <file.glb>)
  --model-screen <name>   the material that is its display, or mesh:<name>   (default: guessed)
  --model-rotate <x,y,z>  degrees that turn its screen to face the camera, top up
  --model-kind <kind>     phone (sized by height) | laptop (sized by width); default: by its proportions
  --finish <#hex>         repaint the 3D device body
  --pose <rx,ry,rz>       device rotation in degrees
  --font <id> --body-font <id>
  --bg --bg2 --bg3 --ink --sub --accent --accent2 <color|auto>
  --background <kind> --pattern <kind> --background-image <file>
  --clean-status-bar / --no-clean-status-bar
  --no-decor              drop the theme's decorations
  --set <path=value>      override ANY theme property (repeatable); see: list options

Output
  -s, --size <key|WxH>    one or more, comma separated (see: list sizes)
  -o, --out <dir|file>    default: the current directory
  --name <base>           base file name
  -f, --format <fmt>      png | jpg | webp | avif   ·   mp4 | hevc | mov | webm | gif
  --transparent           transparent PNG / ProRes 4444 / VP9 alpha
  --index <n> / --all     which slide(s) to render for single-image categories
  --scale <n>             supersampling for stills (default 2)
  --duration <s> --fps <n> --speed <x> --intro --outro --audio <file> --silent-audio
  --crf <n> --quality <n> --lossless   encoder quality (lower crf = better) · JPEG frames · PNG frames
  --gif-width <px> --gif-fps <n>       GIF size (default 480px, 15fps)
  --no-sheet              skip the contact sheet for App Store sets
  --frames <t,...>        video categories: save PNG frames at these seconds (or mid, end) instead of a video
  --json                  print a machine-readable result
  --dry-run               print the resolved spec instead of rendering
  --headful --verbose --keep-work
`

const ALIASES = { t: 'theme', s: 'size', o: 'out', f: 'format', h: 'help' }
const REPEAT = new Set(['title', 'subtitle', 'kicker', 'set', 'screen', 'theme-file'])
const BOOL = new Set(['transparent', 'force', 'all', 'json', 'dry-run', 'headful', 'verbose', 'keep-work', 'intro', 'outro', 'clean-status-bar', 'decor', 'sheet', 'help', 'silent-audio', 'lossless', 'quiet', 'open'])

function parseArgs(argv) {
  const pos = []
  const opts = {}
  for (let i = 0; i < argv.length; i++) {
    let a = argv[i]
    if (a === '--') {
      pos.push(...argv.slice(i + 1))
      break
    }
    if (!a.startsWith('-') || a === '-') {
      pos.push(a)
      continue
    }
    let value
    if (a.includes('=') && a.startsWith('--')) [a, value] = [a.slice(0, a.indexOf('=')), a.slice(a.indexOf('=') + 1)]
    let key = a.replace(/^--?/, '')
    key = ALIASES[key] ?? key
    let neg = false
    if (key.startsWith('no-')) {
      key = key.slice(3)
      neg = true
    }
    if (BOOL.has(key)) {
      opts[key] = value != null ? /^(1|true|yes)$/i.test(value) : !neg
      continue
    }
    if (value == null) value = argv[++i]
    if (value == null) throw new Error(`--${key} needs a value`)
    if (REPEAT.has(key)) (opts[key] ??= []).push(value)
    else opts[key] = value
  }
  return { pos, opts }
}

function cliJob(category, screens, o) {
  const slides = []
  const n = Math.max(screens.length, o.title?.length ?? 0)
  if (screens.length) {
    for (let i = 0; i < n; i++) {
      slides.push({
        screen: screens[i % screens.length],
        title: o.title?.[i],
        subtitle: o.subtitle?.[i],
        kicker: o.kicker?.[i],
      })
    }
  }
  const palette = {}
  for (const k of ['bg', 'bg2', 'bg3', 'ink', 'sub', 'accent', 'accent2', 'surface']) if (o[k]) palette[k] = o[k]
  const brand = {}
  if (o.brand) brand.name = o.brand
  for (const k of ['tagline', 'cta', 'url', 'icon']) if (o[k]) brand[k] = o[k]
  const job = {
    category,
    theme: o.theme,
    layout: o.layout,
    device: o.device,
    modelId: o.modelId,
    finish: o.finish,
    pose: o.pose,
    font: o.font,
    bodyFont: o['body-font'],
    palette: Object.keys(palette).length ? palette : undefined,
    background: o.background,
    pattern: o.pattern,
    backgroundImage: o['background-image'],
    cleanStatusBar: o['clean-status-bar'],
    noDecor: o.decor === false ? true : undefined,
    set: o.set?.map((s) => {
      const k = s.indexOf('=')
      if (k < 1) throw new Error(`--set expects path=value, got "${s}"`)
      return [s.slice(0, k).trim(), s.slice(k + 1)]
    }),
    size: o.size,
    out: o.out,
    name: o.name,
    format: o.format,
    transparent: o.transparent,
    index: o.index != null ? Number(o.index) - 1 : undefined,
    all: o.all,
    scale: o.scale != null ? Number(o.scale) : undefined,
    duration: o.duration != null ? Number(o.duration) : undefined,
    fps: o.fps != null ? Number(o.fps) : undefined,
    speed: o.speed != null ? Number(o.speed) : undefined,
    intro: o.intro,
    outro: o.outro,
    audio: o.audio,
    silentAudio: o['silent-audio'],
    lossless: o.lossless,
    frames: o.frames ? String(o.frames).split(',') : undefined,
    quality: o.quality != null ? Number(o.quality) : undefined,
    crf: o.crf != null ? Number(o.crf) : undefined,
    gifWidth: o['gif-width'] != null ? Number(o['gif-width']) : undefined,
    gifFps: o['gif-fps'] != null ? Number(o['gif-fps']) : undefined,
    sheet: o.sheet,
    brand: Object.keys(brand).length ? brand : undefined,
    dryRun: o['dry-run'],
    headful: o.headful,
    verbose: o.verbose,
    keepWork: o['keep-work'],
    quiet: o.quiet,
    slides,
  }
  return job
}

/** --title/--subtitle/--kicker without screens relabel the config's (or the sample) slides. */
function relabel(slides, o) {
  return slides.map((s, i) => ({
    ...(typeof s === 'string' ? { screen: s } : s),
    ...(o.title?.[i] != null && { title: o.title[i] }),
    ...(o.subtitle?.[i] != null && { subtitle: o.subtitle[i] }),
    ...(o.kicker?.[i] != null && { kicker: o.kicker[i] }),
  }))
}

function table(rows, head) {
  const all = [head, ...rows]
  const w = head.map((_, i) => Math.max(...all.map((r) => String(r[i] ?? '').length)))
  return all.map((r, n) => r.map((c, i) => String(c ?? '').padEnd(w[i])).join('  ') + (n === 0 ? `\n${w.map((x) => '─'.repeat(x)).join('  ')}` : '')).join('\n')
}

async function list(what = 'categories', o) {
  const cat = o.category
  switch (what) {
    case 'categories':
      return table(Object.entries(CATEGORIES).map(([k, c]) => [k, c.kind, c.defaultSize, Object.keys(THEMES[k]).join(', ')]), ['category', 'kind', 'default size', 'themes'])
    case 'themes': {
      const custom = await loadCustomThemes(o['theme-file'] ?? [])
      const cats = cat ? [cat] : Object.keys(THEMES)
      return cats
        .map((c) => {
          const rows = Object.values(THEMES[c]).map((t) => [t.id, t.layout, t.appCategory ?? '', t.blurb])
          for (const t of Object.values(custom)) rows.push([t.id, t.layout ?? '(inherits)', 'custom', t.file])
          return `${c}\n${table(rows, ['theme', 'layout', 'app category', 'look'])}${c === 'app-store' ? `\n\ninspired by:\n${Object.values(THEMES[c]).map((t) => `  ${t.name.padEnd(9)} ${t.inspiredBy}`).join('\n')}` : ''}`
        })
        .join('\n\n')
    }
    case 'sizes': {
      const keys = cat ? CATEGORIES[cat].sizes : Object.keys(SIZES)
      return table(keys.map((k) => [k, `${SIZES[k].w}×${SIZES[k].h}`, SIZES[k].label]), ['size', 'pixels', 'use']) + '\n\nAny WxH also works, e.g. --size 1500x1000'
    }
    case 'devices': {
      const own = Object.entries(loadCustomDevices({ config: findConfig() ? loadConfig(findConfig()) : null }))
      return (
        table(
          [
            ...Object.entries(DEVICES).map(([k, d]) => [k, d.kind, d.name, `${d.credit.author} · ${d.credit.license}`]),
            ...own.map(([k, d]) => [k, d.kind ?? 'auto', d.name ?? k, d.credit?.author ? `${d.credit.author} · ${d.credit.license ?? 'license not stated'}` : `yours · ${relative(process.cwd(), d.path)}`]),
          ],
          ['device', 'kind', 'model', 'credit'],
        ) +
        (own.length ? '' : '\n\nBring your own: --model file.glb, or drop a .glb into ./.app-preview-craft/models/ (inspect <file.glb> shows its materials)') +
        '\n\n' +
        table(Object.entries(FLAT_FRAMES).map(([k, d]) => [`flat:${k}`, d.name]), ['css frame', '']) +
        '\n\nframeless · none'
      )
    }
    case 'fonts':
      return table(Object.entries(FONTS).map(([k, f]) => [k, f.family, f.kind]), ['font', 'family', 'kind'])
    case 'layouts':
      return table(Object.entries(LAYOUTS).map(([k, l]) => [k, l.kind, l.needs3d ? '3D' : '', l.label]), ['layout', 'kind', '', 'what it does'])
    case 'options':
      return (
        table(SCHEMA.map((f) => [f.path, f.type, f.options ? f.options.slice(0, 8).join('|') + (f.options.length > 8 ? '|…' : '') : f.min != null ? `${f.min}..${f.max}` : '', f.label]), ['--set path', 'type', 'values', 'meaning']) +
        '\n\nAny other theme key works too (e.g. scene.rims, background.shapes, decor) — pass JSON: --set \'decor=[{"kind":"sparkles"}]\''
      )
    default:
      throw new Error(`nothing to list called "${what}"`)
  }
}

const INIT = (category) => ({
  $schema: 'app-preview-craft project config — every key is optional; CLI flags override it',
  category,
  theme: CATEGORIES[category].defaultTheme,
  themeOverrides: { palette: { accent: 'auto' } },
  size: CATEGORIES[category].defaultSize,
  brand: { name: 'My App', tagline: 'The *best* way to do the thing', cta: 'Download now', url: 'myapp.com', icon: null },
  out: 'showcase',
  slides: [
    { screen: 'screenshots/01.png', kicker: 'Home', title: 'Everything at *a glance*', subtitle: 'One line on why this screen matters.' },
    { screen: 'screenshots/02.png', title: 'Built for *speed*', subtitle: 'Another benefit, not a feature list.', decor: [{ kind: 'badge', text: '4.9 ★ average rating', icon: 'star', x: 0.5, y: 0.93 }] },
    { screen: 'screenshots/03.png', title: 'Private *by design*', subtitle: 'Your data stays on your device.', theme: { device: { pose: [0, 18, -6] } } },
  ],
  jobs: [
    { category, size: CATEGORIES[category].defaultSize },
    { category: 'social-card', theme: 'launch', size: 'og,x-post' },
    { category: 'device-video', theme: 'turntable', size: 'reel' },
  ],
})

async function main() {
  const { pos, opts } = parseArgs(process.argv.slice(2))
  // `render` (or nothing at all) renders the project config.
  if (pos[0] === 'render') pos.shift()
  const cmd = pos[0]
  if (opts.help || (!cmd && !opts.config && !findConfig())) {
    process.stdout.write(HELP)
    return
  }
  if (cmd === 'list') {
    console.log(await list(pos[1], opts))
    return
  }
  if (cmd === 'inspect') {
    if (!pos[1]) throw new Error('inspect needs a .glb file')
    console.log(opts.json ? JSON.stringify(inspectModel(pos[1]), null, 2) : describeModel(pos[1]))
    return
  }
  if (cmd === 'transcript') {
    const { printTranscript } = await import('./transcript.mjs')
    return printTranscript({ tail: opts.tail != null ? Number(opts.tail) : undefined, json: opts.json })
  }
  if (cmd === 'doctor') return import('./doctor.mjs')
  if (cmd === 'models') return import('./models.mjs')
  if (cmd === 'studio') {
    const { startStudio } = await import('./studio.mjs')
    return startStudio({ port: Number(opts.port ?? 4747), out: opts.out, open: opts.open !== false, config: opts.config })
  }
  if (cmd === 'init') {
    const category = pos[1] ?? 'app-store'
    const file = join(process.cwd(), 'app-preview-craft.json')
    if (existsSync(file) && !opts.force) throw new Error('app-preview-craft.json already exists here (pass --force to overwrite)')
    writeFileSync(file, JSON.stringify(INIT(category), null, 2) + '\n')
    console.log(`wrote ${file}\nedit the slides, then run: node <skill>/scripts/cli.mjs --config app-preview-craft.json`)
    return
  }
  if (cmd === 'gallery') {
    const { renderGallery } = await import('./gallery.mjs')
    const r = await renderGallery(pos[1] ?? 'app-store', { size: opts.size, out: opts.out, frames: opts.frames })
    if (opts.json) console.log(JSON.stringify(r, null, 2))
    return
  }

  // Render. With --config (or ./app-preview-craft.json) the category may come from the file.
  const configPath = opts.config ?? (cmd && CATEGORIES[cmd] ? null : findConfig())
  const autoConfig = !opts.config && CATEGORIES[cmd] ? findConfig() : null
  const config = configPath ? loadConfig(configPath) : autoConfig ? loadConfig(autoConfig) : null
  if (config && !opts.json) console.error(`  config: ${relative(process.cwd(), configPath ?? autoConfig)}`)
  const category = CATEGORIES[cmd] ? cmd : null
  if (!category && !config) throw new Error(`unknown command or category "${cmd}".\n\n${HELP}`)
  const screens = [...(category ? pos.slice(1) : pos), ...(opts.screen ?? [])]
  const cli = cliJob(category ?? undefined, screens, opts)
  if (!screens.length) delete cli.slides
  let jobs = buildJobs({ config, cli })
  // `app-preview-craft social-card` with a multi-job config renders only that category.
  if (category && config?.jobs) jobs = jobs.filter((j) => j.category === category)
  if (!screens.length && (opts.title || opts.subtitle || opts.kicker)) {
    for (const j of jobs) {
      if (j.slides?.length) j.slides = relabel(j.slides, opts)
      else j.sampleCopy = relabel(SAMPLE_SLIDES, opts)
    }
  }
  if (!jobs.length) throw new Error('no jobs to render')
  const custom = await loadCustomThemes(opts['theme-file'] ?? [])
  const modelCli = { model: opts.model, modelScreen: opts['model-screen'], modelRotate: opts['model-rotate'], modelKind: opts['model-kind'] }
  const devices = loadCustomDevices({ config, cli: modelCli })
  if (modelCli.modelId) for (const j of jobs) j.modelId = modelCli.modelId
  const results = []
  for (const job of jobs) {
    if (!opts.json) console.error(`▸ ${job.category} · ${typeof job.theme === 'string' ? job.theme : (job.theme?.id ?? CATEGORIES[job.category]?.defaultTheme)} · ${job.size ?? CATEGORIES[job.category]?.defaultSize}`)
    results.push(await renderJob(job, { custom, devices, log: opts.json ? () => {} : console.error }))
  }
  if (opts.json) console.log(JSON.stringify(results, null, 2))
}

main().catch((err) => {
  console.error(`\n✗ ${err?.message ?? err}`)
  if (process.env.DEBUG) console.error(err?.stack)
  process.exit(1)
})
