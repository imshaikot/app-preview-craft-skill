// Keyframes for the `keyframes` layout: pure data and math, shared by the
// layout, the studio's editor and its timeline.
//
//   motion.keys = [{ at: 0..1, x, y, size, pose: [rx, ry, rz], cam: { yaw, pitch, dist }, follow, ease }]
//
// `at` is a fraction of the whole video. A value a key leaves out holds from
// the key before it; the first key starts from the theme's own pose.
import { clamp, ease, track } from './ease.js'

export const KEY_SNAP = 0.012 // a key this close to a time is that time's key

/** The move a theme gets before anyone has set a key: rise in, turn, settle on the theme's pose. */
export const defaultKeys = (theme) => {
  const { y, pose } = theme.device
  return [
    { at: 0, y: round2(y + 0.8), pose: [pose[0] - 20, pose[1] + 60, pose[2]], cam: { dist: 1.1 }, ease: 'linear' },
    { at: 0.16, y, pose: [pose[0] + 4, pose[1] - 22, pose[2] + 3], ease: 'outQuart' },
    { at: 0.55, pose: [pose[0] + 2, pose[1] + 20, pose[2] - 2], cam: { yaw: 8, dist: 0.92 }, ease: 'inOutSine' },
    { at: 1, pose: [...pose], cam: { yaw: 0, dist: 1 }, ease: 'inOutCubic' },
  ]
}
const round2 = (v) => Math.round(v * 100) / 100

/** The keys in force: the theme's own, or the default move. */
export const keysOf = (theme) => (theme.motion.keys?.length ? theme.motion.keys : defaultKeys(theme))

/** motion.keys -> f(progress 0..1) = {x, y, size, rx, ry, rz, yaw, pitch, dist, follow}. */
export function keyTrack(keys, theme) {
  const d = theme.device
  const cam = theme.scene.camera
  const list = (keys?.length ? keys : defaultKeys(theme)).map(flatKey).sort((a, b) => a[0] - b[0])
  // The theme's own pose is the rest state every key starts from.
  const rest = { x: d.x, y: d.y, size: d.size, rx: d.pose[0], ry: d.pose[1], rz: d.pose[2], yaw: cam.yaw ?? 0, pitch: cam.pitch ?? 0, dist: cam.dist ?? 1, follow: 0 }
  list[0] = [list[0][0], { ...rest, ...list[0][1] }, list[0][2]]
  return track(list)
}

/** One key as a track() frame: [at, flat values, ease]. */
export function flatKey(k) {
  const v = {}
  for (const n of ['x', 'y', 'size', 'follow']) if (k[n] != null) v[n] = k[n]
  if (k.pose) [v.rx, v.ry, v.rz] = k.pose
  for (const n of ['yaw', 'pitch', 'dist']) if (k.cam?.[n] != null) v[n] = k.cam[n]
  return [clamp(k.at ?? 0), v, ease[k.ease] ?? ease.inOutCubic]
}
