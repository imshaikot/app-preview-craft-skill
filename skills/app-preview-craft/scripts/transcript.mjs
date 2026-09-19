// The studio's transcript: what the person did in the browser, written where
// an agent working in the same project can read it.
//
//   .app-preview-craft/studio/transcript.jsonl   one event per line, oldest first
//   .app-preview-craft/studio/session.json       where the studio stands now — a project
//                                                config, so `cli.mjs --config` renders it
//
// An event is {n, t, type, text, ...data}. `text` is the whole story in words
// ("Turned iPhone 17 Pro — device.pose = 4, -18, 3"); the rest is the same thing
// as data (`path`, `value`, `scope`, `slide`…), so nothing has to be parsed out
// of the sentence.
//
//   node cli.mjs transcript [--tail 40] [--json]
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'

export const studioDir = (cwd = process.cwd()) => join(cwd, '.app-preview-craft', 'studio')
export const transcriptFile = (cwd) => join(studioDir(cwd), 'transcript.jsonl')
export const sessionFile = (cwd) => join(studioDir(cwd), 'session.json')

export function readEvents(cwd = process.cwd()) {
  const file = transcriptFile(cwd)
  if (!existsSync(file)) return []
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line)]
      } catch {
        return [] // a line cut short by a crash is not worth failing over
      }
    })
}

export function readSession(cwd = process.cwd()) {
  const file = sessionFile(cwd)
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null
}

/** Append events; returns them numbered and timed. */
export function appendEvents(cwd, events) {
  if (!events?.length) return []
  mkdirSync(studioDir(cwd), { recursive: true })
  let n = readEvents(cwd).at(-1)?.n ?? 0
  const stamped = events.map((e) => ({ n: ++n, t: new Date().toISOString(), ...e }))
  appendFileSync(transcriptFile(cwd), stamped.map((e) => JSON.stringify(e)).join('\n') + '\n')
  return stamped
}

export function writeSession(cwd, session) {
  mkdirSync(studioDir(cwd), { recursive: true })
  writeFileSync(sessionFile(cwd), JSON.stringify({ updated: new Date().toISOString(), ...session }, null, 2) + '\n')
}

const clock = (iso) => new Date(iso).toTimeString().slice(0, 8)

export function printTranscript({ cwd = process.cwd(), tail = 40, json = false } = {}) {
  const events = readEvents(cwd)
  const session = readSession(cwd)
  if (json) {
    console.log(JSON.stringify({ session, events: tail ? events.slice(-tail) : events }, null, 2))
    return
  }
  if (!events.length && !session) {
    console.log(`No studio transcript in ${cwd}.\nStart the studio from this folder (cli.mjs studio); it records to .app-preview-craft/studio/.`)
    return
  }
  if (session) {
    const o = session.themeOverrides ?? {}
    const flat = []
    const walk = (x, p) => {
      for (const [k, v] of Object.entries(x)) {
        if (v && typeof v === 'object' && !Array.isArray(v)) walk(v, p ? `${p}.${k}` : k)
        else flat.push(`${p ? `${p}.` : ''}${k} = ${JSON.stringify(v)}`)
      }
    }
    walk(o, '')
    console.log(`Studio session  (${session.updated})`)
    console.log(`  ${session.category} · theme ${session.theme} · size ${session.size}`)
    console.log(`  slides: ${session.slides?.length ? session.slides.map((s, i) => `${i + 1}. ${String(s.title ?? '').replace(/\*/g, '') || '(no title)'}${s.screen ? '' : ' [no screen]'}`).join('  ') : 'the bundled samples'}`)
    console.log(`  changed from the theme (${flat.length}):${flat.length ? `\n    ${flat.join('\n    ')}` : ' nothing'}`)
    if (session.ownModels?.length) console.log(`  own models: ${session.ownModels.join(', ')}  (records in .app-preview-craft/models/)`)
    console.log(`\n  render exactly this:  node "$SKILL/scripts/cli.mjs" --config ${relative(cwd, sessionFile(cwd))}`)
    if (session.command) console.log(`  or as flags:          ${session.command}`)
  }
  const shown = tail ? events.slice(-tail) : events
  console.log(`\nTranscript  (${shown.length} of ${events.length} events, oldest first)`)
  for (const e of shown) console.log(`  ${String(e.n).padStart(4)}  ${clock(e.t)}  ${e.text ?? e.type}`)
}
