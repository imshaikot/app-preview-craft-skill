// Bring-your-own 3D device models.
//
// A custom device is a GLB plus a small record saying which mesh is the screen
// and how to turn the model upright (see stage/catalog/devices.js). Records
// come from, later ones winning:
//
//   ~/.app-preview-craft/models/*.json|*.glb      every project on this machine
//   ./.app-preview-craft/models/*.json|*.glb      this project (the studio saves here)
//   "devices": { id: {...} } in app-preview-craft.json
//   --model file.glb [--model-screen name] [--model-rotate x,y,z] [--model-kind laptop]
//
// A GLB with no record beside it gets one guessed by inspectModel().
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, extname, join, resolve } from 'node:path'
import { DEVICES } from '../stage/catalog/devices.js'

const expand = (p, base) => resolve(base, String(p).replace(/^~(?=$|\/)/, homedir()))
export const modelId = (name) =>
  basename(String(name), extname(String(name)))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'model'

/** The JSON chunk of a GLB. Names are all we need, so no geometry is decoded. */
function readGlbJson(file) {
  const buf = readFileSync(file)
  if (buf.length < 20 || buf.readUInt32LE(0) !== 0x46546c67) throw new Error(`${basename(file)} is not a binary glTF (.glb). Export or convert the model to GLB first.`)
  const len = buf.readUInt32LE(12)
  if (buf.readUInt32LE(16) !== 0x4e4f534a) throw new Error(`${basename(file)}: the first GLB chunk is not JSON`)
  return { json: JSON.parse(buf.subarray(20, 20 + len).toString('utf8')), bytes: buf.length }
}

const SCREEN_NAME = /screen|display|oled|lcd|wallpaper|monitor|panel_?emit/i
const NOT_SCREEN = /glass|bezel|frame|protector|border|back|body|button|camera|lens|logo/i

/**
 * What is inside a GLB, and the best guess at its screen.
 * -> { materials: [{name, meshes, emissive, textured}], meshes: [name], guess, credit, compression, bytes }
 */
export function inspectModel(file) {
  const { json, bytes } = readGlbJson(file)
  const mats = (json.materials ?? []).map((m, i) => ({
    index: i,
    name: m.name ?? '',
    meshes: [],
    emissive: !!m.emissiveTexture || (m.emissiveFactor ?? [0, 0, 0]).some((v) => v > 0),
    textured: !!(m.pbrMetallicRoughness?.baseColorTexture || m.emissiveTexture),
  }))
  // A mesh is named by the node that carries it when it has no name of its own.
  const nodeName = new Map()
  for (const n of json.nodes ?? []) if (n.mesh != null && !nodeName.has(n.mesh)) nodeName.set(n.mesh, n.name ?? '')
  const meshes = (json.meshes ?? []).map((m, i) => {
    const name = m.name || nodeName.get(i) || ''
    for (const p of m.primitives ?? []) if (p.material != null && mats[p.material] && !mats[p.material].meshes.includes(name)) mats[p.material].meshes.push(name)
    return name
  })

  const score = (m) => (SCREEN_NAME.test(m.name) ? 4 : 0) + (m.emissive ? 2 : 0) + (m.textured ? 1 : 0) - (NOT_SCREEN.test(m.name) && !SCREEN_NAME.test(m.name) ? 3 : 0)
  const ranked = mats.filter((m) => m.meshes.length).sort((a, b) => score(b) - score(a))
  let guess = null
  if (ranked[0] && score(ranked[0]) >= 2) guess = ranked[0].name ? { material: ranked[0].name } : ranked[0].meshes[0] ? { mesh: ranked[0].meshes[0] } : null
  if (!guess) {
    const mesh = meshes.find((n) => SCREEN_NAME.test(n) && !NOT_SCREEN.test(n))
    if (mesh) guess = { mesh }
  }

  // Sketchfab writes the author and license into asset.extras.
  const x = json.asset?.extras ?? {}
  const credit = x.author || x.license || x.source ? { title: x.title, author: String(x.author ?? '').replace(/\s*\(https?:[^)]*\)\s*$/, ''), authorUrl: String(x.author ?? '').match(/\((https?:[^)]+)\)/)?.[1], source: x.source, license: licenseId(x.license) } : null
  const used = json.extensionsUsed ?? []
  return {
    file,
    bytes,
    materials: mats.map(({ index, ...m }) => m),
    meshes,
    guess,
    confident: !!guess && score(ranked[0] ?? {}) >= 4,
    credit,
    compression: { draco: used.includes('KHR_draco_mesh_compression'), meshopt: used.includes('EXT_meshopt_compression'), ktx2: used.includes('KHR_texture_basisu') },
  }
}

const licenseId = (s) => {
  const t = String(s ?? '')
  const m = t.match(/CC[- ]BY(?:[- ](?:NC|SA|ND))*[- ]\d\.\d/i)
  return m ? m[0].toUpperCase().replace(/ /g, '-') : t.replace(/\s*\(https?:[^)]*\)\s*$/, '') || undefined
}

/** A record for a bare GLB: the guessed screen and whatever credit the file carries. */
export function guessDevice(file) {
  const info = inspectModel(file)
  return { name: info.credit?.title ?? modelId(file), file: basename(file), screen: info.guess, rotate: [0, 0, 0], credit: info.credit ?? undefined }
}

function readDir(dir, out) {
  if (!existsSync(dir)) return
  const names = readdirSync(dir)
  for (const f of names) {
    if (!/\.glb$/i.test(f) || names.includes(`${basename(f, extname(f))}.json`)) continue
    out[modelId(f)] = { ...guessDevice(join(dir, f)), path: join(dir, f) }
  }
  for (const f of names) {
    if (!/\.json$/i.test(f)) continue
    const def = JSON.parse(readFileSync(join(dir, f), 'utf8'))
    if (!def.file) throw new Error(`${join(dir, f)}: a model record needs "file" (the .glb beside it)`)
    out[def.id ?? modelId(f)] = { ...def, path: expand(def.file, dir) }
  }
}

/**
 * Every custom device in reach: id -> record with `path`, the GLB on disk.
 * `config` is a loaded project config; `cli` holds the --model* flags.
 */
export function loadCustomDevices({ cwd = process.cwd(), config = null, cli = {} } = {}) {
  const out = {}
  readDir(join(homedir(), '.app-preview-craft', 'models'), out)
  readDir(join(cwd, '.app-preview-craft', 'models'), out)
  for (const [id, def] of Object.entries(config?.devices ?? {})) {
    if (!def?.file) throw new Error(`devices.${id}: needs "file", the path to a .glb`)
    out[id] = { ...def, path: expand(def.file, config.__dir ?? cwd) }
  }
  if (cli.model) {
    const path = expand(cli.model, cwd)
    if (!existsSync(path)) throw new Error(`--model: ${path} not found`)
    const id = modelId(path)
    const def = { ...(out[id] ?? guessDevice(path)), path }
    if (cli.modelScreen) def.screen = cli.modelScreen.startsWith('mesh:') ? { mesh: cli.modelScreen.slice(5) } : { material: cli.modelScreen }
    if (cli.modelRotate) def.rotate = String(cli.modelRotate).split(/[ ,]+/).map(Number)
    if (cli.modelKind && cli.modelKind !== 'auto') def.kind = cli.modelKind
    out[id] = def
    cli.modelId = id
  }
  for (const [id, def] of Object.entries(out)) {
    if (DEVICES[id]) throw new Error(`custom model "${id}" has the name of a built-in device; rename ${basename(def.path)}`)
    if (!existsSync(def.path)) throw new Error(`custom model "${id}": ${def.path} not found`)
  }
  return out
}

/** Save a record beside its GLB in the project, as the studio does. */
export function saveDevice(cwd, id, def) {
  const dir = join(cwd, '.app-preview-craft', 'models')
  mkdirSync(dir, { recursive: true })
  const { path, url, id: _id, custom, fix, ...rest } = def
  const file = join(dir, `${id}.json`)
  writeFileSync(file, JSON.stringify({ ...rest, file: rest.file ?? basename(path) }, null, 2) + '\n')
  return file
}

/** Human-readable inspection, for `cli.mjs inspect`. */
export function describeModel(file) {
  const i = inspectModel(file)
  const rows = i.materials.filter((m) => m.meshes.length).map((m) => `  ${(m.name || '(unnamed)').padEnd(28)} ${m.emissive ? 'emissive ' : '         '}${m.textured ? 'textured ' : '         '}meshes: ${m.meshes.slice(0, 4).map((n) => n || '(unnamed)').join(', ')}${m.meshes.length > 4 ? `, +${m.meshes.length - 4}` : ''}`)
  const comp = Object.entries(i.compression).filter(([, v]) => v).map(([k]) => k)
  return [
    `${basename(file)}  ${(i.bytes / 1e6).toFixed(1)} MB${comp.length ? `  (${comp.join(', ')} compressed — decoded in the browser)` : ''}`,
    '',
    'materials',
    ...rows,
    '',
    i.guess ? `screen guess: ${JSON.stringify(i.guess)}${i.confident ? '' : '  (low confidence — check it with a front render)'}` : 'screen guess: none — name it with --model-screen <material> or --model-screen mesh:<name>',
    i.credit ? `credit in file: ${[i.credit.title, i.credit.author, i.credit.license].filter(Boolean).join(' · ')}` : 'credit in file: none — add "credit" to the record if the license asks for attribution',
    '',
    `try it:  cli.mjs device-mockup --model ${JSON.stringify(file)}${i.guess ? '' : ' --model-screen <material>'} --set device.pose=0,0,0`,
    'If the screen faces away or the model lies on its side, turn it with --model-rotate x,y,z (degrees).',
  ].join('\n')
}
