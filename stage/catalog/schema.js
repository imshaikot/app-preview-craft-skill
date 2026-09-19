// Every configurable theme property, in one place. The studio builds its
// inspector from this list, the CLI documents `--set` paths from it, and
// resolve.js coerces string values (from flags) with it.
//
// type: color | number | range | select | text | bool | font | pose | vec3 | list
import { FONTS } from './fonts.js'
import { DEVICES, FLAT_FRAMES } from './devices.js'

const fontIds = Object.keys(FONTS)

export const BACKGROUND_KINDS = ['solid', 'gradient', 'mesh', 'radial', 'aurora', 'spotlight', 'sunset', 'synth', 'paper', 'blur-shot', 'image', 'split', 'none']
export const PATTERNS = ['none', 'grid', 'dots', 'stripes', 'rays', 'waves', 'checker', 'topo', 'noise']
export const HIGHLIGHTS = ['color', 'marker', 'gradient', 'underline', 'italic', 'pill', 'outline', 'none']
export const DEVICE_MODES = ['3d', 'flat', 'frameless', 'none']
export const TRANSITIONS = ['slide', 'fade', 'push-up', 'zoom', 'wipe']
export const DECOR_KINDS = ['badge', 'rating', 'chips', 'callout', 'notification', 'stat', 'sparkles', 'orbs', 'rings', 'shapes', 'arrow', 'logo', 'store-badge', 'blob', 'confetti', 'laurels', 'credit']

export const SCHEMA = [
  { group: 'Layout', path: 'layout', type: 'layout', label: 'Layout' },
  { group: 'Layout', path: 'text.position', type: 'select', options: ['top', 'bottom', 'left', 'right', 'center', 'none'], label: 'Text position' },
  { group: 'Layout', path: 'text.align', type: 'select', options: ['left', 'center', 'right'], label: 'Text align' },
  { group: 'Layout', path: 'text.margin', type: 'range', min: 0, max: 0.2, step: 0.005, label: 'Outer margin' },
  { group: 'Layout', path: 'text.width', type: 'range', min: 0.3, max: 1, step: 0.01, label: 'Text width' },

  { group: 'Colors', path: 'palette.bg', type: 'color', label: 'Background' },
  { group: 'Colors', path: 'palette.bg2', type: 'color', label: 'Background 2' },
  { group: 'Colors', path: 'palette.bg3', type: 'color', label: 'Background 3' },
  { group: 'Colors', path: 'palette.ink', type: 'color', label: 'Headline' },
  { group: 'Colors', path: 'palette.sub', type: 'color', label: 'Subtitle' },
  { group: 'Colors', path: 'palette.accent', type: 'color', label: 'Accent' },
  { group: 'Colors', path: 'palette.accent2', type: 'color', label: 'Accent 2' },
  { group: 'Colors', path: 'palette.surface', type: 'color', label: 'Cards' },

  { group: 'Type', path: 'type.display', type: 'font', options: fontIds, label: 'Headline font' },
  { group: 'Type', path: 'type.body', type: 'font', options: fontIds, label: 'Body font' },
  { group: 'Type', path: 'type.weight', type: 'range', min: 100, max: 900, step: 50, label: 'Headline weight' },
  { group: 'Type', path: 'type.bodyWeight', type: 'range', min: 100, max: 900, step: 50, label: 'Body weight' },
  { group: 'Type', path: 'type.size', type: 'range', min: 0.4, max: 2, step: 0.02, label: 'Headline scale' },
  { group: 'Type', path: 'type.subSize', type: 'range', min: 0.4, max: 2, step: 0.02, label: 'Subtitle scale' },
  { group: 'Type', path: 'type.case', type: 'select', options: ['none', 'upper', 'lower', 'title'], label: 'Case' },
  { group: 'Type', path: 'type.tracking', type: 'range', min: -0.08, max: 0.2, step: 0.005, label: 'Tracking (em)' },
  { group: 'Type', path: 'type.leading', type: 'range', min: 0.8, max: 1.5, step: 0.01, label: 'Line height' },
  { group: 'Type', path: 'type.italic', type: 'bool', label: 'Italic headline' },
  { group: 'Type', path: 'type.highlight', type: 'select', options: HIGHLIGHTS, label: '*Highlight* style' },
  { group: 'Type', path: 'type.shadow', type: 'range', min: 0, max: 1, step: 0.05, label: 'Text shadow' },

  { group: 'Background', path: 'background.kind', type: 'select', options: BACKGROUND_KINDS, label: 'Kind' },
  { group: 'Background', path: 'background.angle', type: 'range', min: 0, max: 360, step: 1, label: 'Angle' },
  { group: 'Background', path: 'background.pattern', type: 'select', options: PATTERNS, label: 'Pattern' },
  { group: 'Background', path: 'background.patternOpacity', type: 'range', min: 0, max: 1, step: 0.01, label: 'Pattern opacity' },
  { group: 'Background', path: 'background.patternScale', type: 'range', min: 0.2, max: 4, step: 0.05, label: 'Pattern scale' },
  { group: 'Background', path: 'background.grain', type: 'range', min: 0, max: 0.5, step: 0.01, label: 'Grain' },
  { group: 'Background', path: 'background.vignette', type: 'range', min: 0, max: 1, step: 0.01, label: 'Vignette' },
  { group: 'Background', path: 'background.panorama', type: 'bool', label: 'Panorama across set' },
  { group: 'Background', path: 'background.image', type: 'text', label: 'Image path/URL' },
  { group: 'Background', path: 'background.blur', type: 'range', min: 0, max: 200, step: 1, label: 'Image blur' },
  { group: 'Background', path: 'background.dim', type: 'range', min: 0, max: 1, step: 0.01, label: 'Image dim' },

  { group: 'Device', path: 'device.mode', type: 'select', options: DEVICE_MODES, label: 'Render as' },
  { group: 'Device', path: 'device.model', type: 'select', options: Object.keys(DEVICES), label: '3D model' },
  { group: 'Device', path: 'device.flat', type: 'select', options: Object.keys(FLAT_FRAMES), label: 'Flat frame' },
  { group: 'Device', path: 'device.size', type: 'range', min: 0.2, max: 1.6, step: 0.01, label: 'Size' },
  { group: 'Device', path: 'device.x', type: 'range', min: -0.5, max: 1.5, step: 0.005, label: 'X' },
  { group: 'Device', path: 'device.y', type: 'range', min: -0.5, max: 1.5, step: 0.005, label: 'Y' },
  { group: 'Device', path: 'device.z', type: 'range', min: -0.6, max: 0.6, step: 0.005, label: 'Depth (toward camera)' },
  { group: 'Device', path: 'device.pose', type: 'pose', label: 'Rotation (x, y, z°)' },
  { group: 'Device', path: 'device.finish', type: 'color', nullable: true, label: 'Body finish' },
  { group: 'Device', path: 'device.glare', type: 'range', min: 0, max: 2, step: 0.05, label: 'Screen glare' },
  { group: 'Device', path: 'device.frame', type: 'color', label: 'Flat frame color' },
  { group: 'Device', path: 'device.corner', type: 'range', min: 0, max: 0.2, step: 0.005, label: 'Frameless corner' },
  { group: 'Device', path: 'device.shadow', type: 'range', min: 0, max: 1, step: 0.01, label: 'Shadow' },
  { group: 'Device', path: 'device.float', type: 'range', min: 0, max: 1, step: 0.01, label: 'Float (video)' },

  { group: 'Screen', path: 'screen.cleanStatusBar', type: 'bool', label: 'Clean status bar (9:41)' },
  { group: 'Screen', path: 'screen.statusBarTime', type: 'text', label: 'Status bar time' },
  { group: 'Screen', path: 'screen.tint', type: 'color', nullable: true, label: 'Tint' },
  { group: 'Screen', path: 'screen.tintAmount', type: 'range', min: 0, max: 1, step: 0.01, label: 'Tint amount' },
  { group: 'Screen', path: 'screen.duotone', type: 'text', label: 'Duotone (dark,light)' },
  { group: 'Screen', path: 'screen.saturate', type: 'range', min: 0, max: 2, step: 0.05, label: 'Saturation' },
  { group: 'Screen', path: 'screen.brightness', type: 'range', min: 0.3, max: 1.7, step: 0.05, label: 'Brightness' },
  { group: 'Screen', path: 'screen.sharpen', type: 'bool', label: 'Sharpen' },
  { group: 'Screen', path: 'screen.fit', type: 'select', options: ['cover', 'contain', 'top'], label: 'Fit' },
  { group: 'Screen', path: 'screen.background', type: 'color', label: 'Letterbox color' },
  { group: 'Screen', path: 'screen.transition', type: 'select', options: TRANSITIONS, label: 'Transition (video)' },

  { group: '3D scene', path: 'scene.fov', type: 'range', min: 8, max: 60, step: 1, label: 'Lens (fov°)' },
  { group: '3D scene', path: 'scene.exposure', type: 'range', min: 0.3, max: 2.5, step: 0.05, label: 'Exposure' },
  { group: '3D scene', path: 'scene.env', type: 'range', min: 0, max: 3, step: 0.05, label: 'Reflections' },
  { group: '3D scene', path: 'scene.envRotation', type: 'range', min: -3.14, max: 3.14, step: 0.01, label: 'Reflection angle' },
  { group: '3D scene', path: 'scene.ambient', type: 'range', min: 0, max: 3, step: 0.05, label: 'Ambient' },
  { group: '3D scene', path: 'scene.key.intensity', type: 'range', min: 0, max: 8, step: 0.1, label: 'Key light' },
  { group: '3D scene', path: 'scene.key.color', type: 'color', label: 'Key color' },
  { group: '3D scene', path: 'scene.key.dir', type: 'vec3', label: 'Key direction (x, y, z)' },
  { group: '3D scene', path: 'scene.shadow.blur', type: 'range', min: 0, max: 60, step: 1, label: 'Shadow softness' },
  { group: '3D scene', path: 'scene.wall.depth', type: 'range', min: 0, max: 0.5, step: 0.005, label: 'Shadow distance' },
  { group: '3D scene', path: 'scene.floor.mirror', type: 'range', min: 0, max: 1, step: 0.01, label: 'Floor reflection' },
  { group: '3D scene', path: 'scene.camera.yaw', type: 'range', min: -90, max: 90, step: 1, label: 'Camera yaw' },
  { group: '3D scene', path: 'scene.camera.pitch', type: 'range', min: -60, max: 60, step: 1, label: 'Camera pitch' },
  { group: '3D scene', path: 'scene.camera.dist', type: 'range', min: 0.3, max: 3, step: 0.01, label: 'Camera distance' },
  { group: '3D scene', path: 'scene.camera.roll', type: 'range', min: -45, max: 45, step: 0.5, label: 'Camera roll' },

  { group: 'Motion', path: 'motion.duration', type: 'range', min: 2, max: 60, step: 0.5, label: 'Duration (s)' },
  { group: 'Motion', path: 'motion.fps', type: 'select', options: [24, 25, 30, 50, 60], label: 'FPS' },
  { group: 'Motion', path: 'motion.speed', type: 'range', min: 0.25, max: 3, step: 0.05, label: 'Speed' },
  { group: 'Motion', path: 'motion.hold', type: 'range', min: 0, max: 4, step: 0.1, label: 'End hold (s)' },
  { group: 'Motion', path: 'motion.intro', type: 'bool', label: 'Intro title' },
  { group: 'Motion', path: 'motion.outro', type: 'bool', label: 'Outro card' },
  { group: 'Motion', path: 'motion.loop', type: 'bool', label: 'Seamless loop' },
  { group: 'Motion', path: 'motion.keys', type: 'list', label: 'Keyframes (layout: keyframes)' },

  { group: 'Decor', path: 'decor', type: 'list', options: DECOR_KINDS, label: 'Decorations' },
]

export const SCHEMA_BY_PATH = Object.fromEntries(SCHEMA.map((f) => [f.path, f]))
