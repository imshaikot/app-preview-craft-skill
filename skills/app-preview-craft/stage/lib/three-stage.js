// three.js layer: devices with live screens, studio lighting, soft shadows,
// a fading mirror floor and glossy 3D decor.
//
// World units are CSS pixels. With the default camera a point (x, y, 0)
// lands on page pixel (W/2 + x, H/2 - y), so layouts place devices by page
// coordinates and the DOM text around them lines up exactly.
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js'
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js'
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { Reflector } from 'three/addons/objects/Reflector.js'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { deviceDef } from '../catalog/devices.js'
import { ScreenPainter } from './screen.js'
import { deg } from './ease.js'

// Geometry and texture decoders are WebAssembly. Meshopt unpacks the bundled
// models; Draco and Basis (KTX2) are there for models people bring, which are
// often exported that way. Both fetch their .wasm only when a file needs it.
const LIBS = new URL('/vendor/three/examples/jsm/libs/', import.meta.url).href
const draco = new DRACOLoader().setDecoderPath(`${LIBS}draco/gltf/`)
const ktx2 = new KTX2Loader().setTranscoderPath(`${LIBS}basis/`)
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).setDRACOLoader(draco).setKTX2Loader(ktx2)
const models = new Map()
export function loadModel(url) {
  if (!models.has(url)) {
    const p = loader.loadAsync(url)
    // A failed load is not cached: the studio retries after the file is fixed.
    p.catch(() => models.delete(url))
    models.set(url, p)
  }
  return models.get(url)
}

const FadeMirrorShader = {
  name: 'FadeMirrorShader',
  uniforms: {
    color: { value: null },
    tDiffuse: { value: null },
    textureMatrix: { value: null },
    strength: { value: 0.35 },
    center: { value: new THREE.Vector3() },
    radius: { value: 1000 },
  },
  vertexShader: /* glsl */ `
    uniform mat4 textureMatrix;
    varying vec4 vUv;
    varying vec3 vWorld;
    #include <common>
    #include <logdepthbuf_pars_vertex>
    void main() {
      vUv = textureMatrix * vec4(position, 1.0);
      vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      #include <logdepthbuf_vertex>
    }`,
  fragmentShader: /* glsl */ `
    uniform vec3 color;
    uniform sampler2D tDiffuse;
    uniform float strength;
    uniform vec3 center;
    uniform float radius;
    varying vec4 vUv;
    varying vec3 vWorld;
    #include <logdepthbuf_pars_fragment>
    void main() {
      #include <logdepthbuf_fragment>
      vec4 base = texture2DProj(tDiffuse, vUv);
      vec2 d = (vWorld.xz - center.xz) / vec2(radius, radius * 0.55);
      float fade = 1.0 - smoothstep(0.0, 1.0, length(d));
      gl_FragColor = vec4(base.rgb * color, base.a * strength * fade);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
}

const toColor = (c) => new THREE.Color(c)

export class Stage3D {
  constructor(canvas, { width, height, pixelRatio = 1, fov = 22, look = {} }) {
    this.W = width
    this.H = height
    this.look = look
    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      preserveDrawingBuffer: true,
      powerPreference: 'high-performance',
    })
    renderer.setPixelRatio(pixelRatio)
    renderer.setSize(width, height, true)
    renderer.outputColorSpace = THREE.SRGBColorSpace
    renderer.toneMapping = THREE.NeutralToneMapping
    renderer.toneMappingExposure = look.exposure ?? 1
    renderer.shadowMap.enabled = true
    renderer.shadowMap.type = THREE.VSMShadowMap
    renderer.setClearColor(0x000000, 0)
    this.renderer = renderer
    ktx2.detectSupport(renderer)

    const scene = new THREE.Scene()
    const pmrem = new THREE.PMREMGenerator(renderer)
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.03).texture
    scene.environmentIntensity = look.env ?? 1
    scene.environmentRotation.y = look.envRotation ?? 0
    pmrem.dispose()
    this.scene = scene

    this.fov = fov
    this.baseDist = height / 2 / Math.tan(deg(fov) / 2)
    this.camera = new THREE.PerspectiveCamera(fov, width / height, this.baseDist / 20, this.baseDist * 20)
    this.setView()

    this.devices = []
    this.decor = []
    this.addLights(look)
  }

  get maxAnisotropy() {
    return this.renderer.capabilities.getMaxAnisotropy()
  }

  /** Page pixel -> world position on the z=0 plane. */
  world(x, y, z = 0) {
    return new THREE.Vector3(x - this.W / 2, this.H / 2 - y, z)
  }

  /** Orbit the camera around a page-space target. Defaults give the pixel-mapped view. */
  setView({ yaw = 0, pitch = 0, dist = 1, roll = 0, tx, ty, tz = 0, fov } = {}) {
    const cam = this.camera
    if (fov && fov !== cam.fov) {
      cam.fov = fov
      cam.updateProjectionMatrix()
    }
    const target = this.world(tx ?? this.W / 2, ty ?? this.H / 2, tz)
    const r = this.baseDist * dist
    cam.position.set(
      target.x + r * Math.sin(deg(yaw)) * Math.cos(deg(pitch)),
      target.y + r * Math.sin(deg(pitch)),
      target.z + r * Math.cos(deg(yaw)) * Math.cos(deg(pitch)),
    )
    cam.up.set(Math.sin(deg(roll)), Math.cos(deg(roll)), 0)
    cam.lookAt(target)
    cam.updateMatrixWorld()
  }

  addLights(look) {
    const { scene, W, H } = this
    const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, look.ambient ?? 0.4)
    scene.add(hemi)
    this.hemi = hemi

    const key = look.key ?? {}
    const light = new THREE.DirectionalLight(toColor(key.color ?? '#ffffff'), key.intensity ?? 2)
    const dir = new THREE.Vector3(...(key.dir ?? [-0.5, 0.8, 1])).normalize()
    light.position.copy(dir.multiplyScalar(this.baseDist))
    light.castShadow = true
    const span = Math.max(W, H) * 0.9
    const cam = light.shadow.camera
    cam.left = -span
    cam.right = span
    cam.top = span
    cam.bottom = -span
    cam.near = 1
    cam.far = this.baseDist * 3
    const shadow = look.shadow ?? {}
    light.shadow.mapSize.set(2048, 2048)
    light.shadow.radius = shadow.blur ?? 18
    light.shadow.blurSamples = 25
    light.shadow.bias = -0.0004
    scene.add(light, light.target)
    this.key = light
    this.addFillLights(look)
  }

  addFillLights(look) {
    const { scene, W, H } = this
    for (const l of this.fills ?? []) scene.remove(l)
    this.fills = []
    for (const rim of look.rims ?? []) {
      const l = new THREE.DirectionalLight(toColor(rim.color), rim.intensity ?? 2)
      l.position.copy(new THREE.Vector3(...rim.dir).normalize().multiplyScalar(this.baseDist))
      this.fills.push(l)
    }
    for (const p of look.points ?? []) {
      const l = new THREE.PointLight(toColor(p.color), p.intensity ?? 1, 0, 0)
      l.position.copy(this.world(p.x * W, p.y * H, (p.z ?? 0.3) * H))
      this.fills.push(l)
    }
    if (this.fills.length) scene.add(...this.fills)
  }

  /**
   * Retune the look in place: everything addLights and the constructor read
   * from `look`, without rebuilding the renderer. The floor, wall and fov
   * change the scene's geometry and still need a fresh load.
   */
  setLook(look) {
    this.look = look
    this.renderer.toneMappingExposure = look.exposure ?? 1
    this.scene.environmentIntensity = look.env ?? 1
    this.scene.environmentRotation.y = look.envRotation ?? 0
    this.hemi.intensity = look.ambient ?? 0.4
    const key = look.key ?? {}
    this.key.color = toColor(key.color ?? '#ffffff')
    this.key.intensity = key.intensity ?? 2
    this.key.position.copy(new THREE.Vector3(...(key.dir ?? [-0.5, 0.8, 1])).normalize().multiplyScalar(this.baseDist))
    this.key.shadow.radius = look.shadow?.blur ?? 18
    this.addFillLights(look)
  }

  /** A shadow-catching wall behind the devices, for flat front-facing layouts. */
  addWall({ depth = 0.08, opacity = 0.3 } = {}) {
    const size = Math.max(this.W, this.H) * 4
    const wall = new THREE.Mesh(
      new THREE.PlaneGeometry(size, size),
      new THREE.ShadowMaterial({ opacity, transparent: true, depthWrite: false }),
    )
    wall.position.z = -depth * this.H
    wall.receiveShadow = true
    this.scene.add(wall)
    this.wall = wall
    return wall
  }

  /**
   * A floor at page-y `y`: a shadow catcher, optionally with a mirror that
   * fades out around `center` so the CSS background shows beyond it.
   */
  addFloor({ y, opacity = 0.35, mirror = 0, radius = 0.6, tint = '#ffffff', center = [0.5, 0] } = {}) {
    const size = Math.max(this.W, this.H) * 8
    const geo = new THREE.PlaneGeometry(size, size)
    const floorY = this.world(0, y).y
    const group = new THREE.Group()
    if (mirror > 0) {
      const pr = this.renderer.getPixelRatio()
      const reflector = new Reflector(geo, {
        shader: FadeMirrorShader,
        textureWidth: Math.round(this.W * pr),
        textureHeight: Math.round(this.H * pr),
        color: tint,
        clipBias: 0.001,
        multisample: 4,
      })
      reflector.material.transparent = true
      reflector.material.depthWrite = false
      reflector.material.uniforms.strength.value = mirror
      reflector.material.uniforms.radius.value = Math.max(this.W, this.H) * radius
      reflector.material.uniforms.center.value.copy(this.world(center[0] * this.W, y, center[1] * this.H))
      reflector.rotation.x = -Math.PI / 2
      reflector.position.y = floorY - 0.5
      reflector.renderOrder = -2
      group.add(reflector)
      this.mirror = reflector
    }
    const catcher = new THREE.Mesh(geo, new THREE.ShadowMaterial({ opacity, transparent: true, depthWrite: false }))
    catcher.rotation.x = -Math.PI / 2
    catcher.position.y = floorY
    catcher.receiveShadow = true
    catcher.renderOrder = -1
    group.add(catcher)
    this.scene.add(group)
    this.floor = group
    this.floorY = floorY
    return group
  }

  /** A cylinder whose top sits at page-y `y`, with a shadow catcher on its top and at its foot. */
  addPlinth({ y, height, radius, color = '#dddddd', finish = 'matte' }) {
    const top = this.world(0, y).y
    const mat = new THREE.MeshPhysicalMaterial({
      color: toColor(color),
      roughness: finish === 'glossy' ? 0.2 : 0.75,
      metalness: 0,
      clearcoat: finish === 'glossy' ? 1 : 0,
    })
    const plinth = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, 96, 1), mat)
    plinth.position.set(0, top - height / 2, 0)
    plinth.receiveShadow = false
    plinth.castShadow = true
    this.scene.add(plinth)
    const disc = new THREE.Mesh(new THREE.CircleGeometry(radius * 0.999, 96), new THREE.ShadowMaterial({ opacity: 0.35, transparent: true }))
    disc.rotation.x = -Math.PI / 2
    disc.position.set(0, top + 0.5, 0)
    disc.receiveShadow = true
    this.scene.add(disc)
    this.addFloor({ y: y + height, opacity: 0.25 })
    return plinth
  }

  async addDevice(id, opts = {}) {
    const def = deviceDef(id)
    if (!def) throw new Error(`unknown device "${id}"`)
    const gltf = await loadModel(def.url ?? `${opts.modelBase ?? '/assets/models/'}${def.file}`).catch((err) => {
      throw new Error(`${id}: could not load the model (${def.url ?? def.file}) — ${err?.message ?? err}`)
    })
    const device = new Device3D(this, id, def, gltf, opts)
    this.scene.add(device.group)
    this.devices.push(device)
    return device
  }

  /** Glossy primitives: orb, ring, pill, cube, knot. Positions are page fractions. */
  addShape({ kind = 'orb', x = 0.5, y = 0.5, z = -0.1, size = 0.1, color = '#ffffff', finish = 'glossy', rot = [0, 0, 0] }) {
    const s = size * Math.min(this.W, this.H)
    const geo = {
      orb: () => new THREE.SphereGeometry(s / 2, 64, 48),
      ring: () => new THREE.TorusGeometry(s / 2, s * 0.14, 48, 128),
      pill: () => new THREE.CapsuleGeometry(s * 0.22, s * 0.56, 16, 48),
      cube: () => new RoundedBoxGeometry(s * 0.75, s * 0.75, s * 0.75, 6, s * 0.12),
      knot: () => new THREE.TorusKnotGeometry(s * 0.32, s * 0.1, 220, 32),
      cone: () => new THREE.ConeGeometry(s * 0.4, s * 0.8, 64),
    }[kind]?.()
    if (!geo) throw new Error(`unknown shape "${kind}"`)
    const params = {
      glossy: { roughness: 0.18, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.08 },
      chrome: { roughness: 0.08, metalness: 1 },
      matte: { roughness: 0.8, metalness: 0 },
      glass: { roughness: 0.05, metalness: 0, transmission: 1, thickness: s * 0.3, ior: 1.4, transparent: true },
      iridescent: { roughness: 0.15, metalness: 0.2, iridescence: 1, iridescenceIOR: 1.6, clearcoat: 1 },
    }[finish] ?? {}
    const mat = new THREE.MeshPhysicalMaterial({ color: toColor(color), ...params })
    const mesh = new THREE.Mesh(geo, mat)
    mesh.position.copy(this.world(x * this.W, y * this.H, z * this.H))
    mesh.rotation.set(deg(rot[0]), deg(rot[1]), deg(rot[2]))
    mesh.castShadow = true
    mesh.userData.base = { x, y, z, rot: [...rot] }
    this.scene.add(mesh)
    this.decor.push(mesh)
    return mesh
  }

  render() {
    this.renderer.render(this.scene, this.camera)
  }

  dispose() {
    for (const d of this.devices) d.dispose()
    this.scene.traverse((o) => {
      if (o.isMesh && !o.userData.shared) {
        o.geometry?.dispose()
      }
    })
    this.mirror?.getRenderTarget?.().dispose()
    this.renderer.dispose()
    // Free the context now: the studio reloads stages often, and browsers
    // cap live WebGL contexts per page.
    this.renderer.forceContextLoss()
  }
}

export class Device3D {
  constructor(stage, id, def, gltf, { finish, glare = 0.5, screenScale = 1, background = '#000' } = {}) {
    this.stage = stage
    this.id = id
    this.def = def
    const model = gltf.scene.clone(true)
    const fix = new THREE.Group()
    fix.rotation.set(...def.fix)
    fix.add(model)
    fix.updateMatrixWorld(true)
    const box = new THREE.Box3().setFromObject(fix)
    const size = box.getSize(new THREE.Vector3())
    const center = box.getCenter(new THREE.Vector3())
    fix.position.copy(center).negate()

    const norm = new THREE.Group()
    norm.add(fix)
    // A model that does not say what it is goes by its shape: wider than tall is a laptop, sized by width.
    this.kind = def.kind ?? (size.x > size.y * 1.2 ? 'laptop' : 'phone')
    const unit = (def.fit ?? (this.kind === 'laptop' ? 'width' : 'height')) === 'width' ? size.x : size.y
    norm.scale.setScalar(1 / unit)
    this.dims = size.clone().divideScalar(unit) // normalized extents

    const pivot = new THREE.Group()
    pivot.rotation.order = 'YXZ'
    pivot.add(norm)
    const group = new THREE.Group()
    group.add(pivot)
    Object.assign(this, { group, pivot, norm, fix, model })
    group.updateMatrixWorld(true)

    const hidden = def.hide ?? []
    const want = def.screen
    const screens = []
    this.bodyMeshes = []
    model.traverse((o) => {
      if (!o.isMesh) return
      o.castShadow = true
      o.receiveShadow = false
      const name = o.material?.name
      o.userData.materialName = name ?? ''
      if (hidden.some((h) => (h.material != null && h.material === name) || (h.mesh != null && h.mesh === o.name))) o.visible = false
      if (want && ((want.material != null && want.material === name) || (want.mesh != null && (want.mesh === o.name || want.mesh === o.parent?.name)))) screens.push(o)
      else if (def.body?.includes(name)) {
        o.userData.baseColor = o.material.color.clone()
        o.material = o.material.clone()
        this.bodyMeshes.push(o)
      }
    })
    if (want && !screens.length) throw new Error(`${id}: no mesh uses screen ${want.material != null ? `material "${want.material}"` : `mesh "${want.mesh}"`}`)
    this.setFinish(finish)

    // Planar UVs across the screen's projection on the normalized XY plane:
    // the source UVs differ per model and are rarely a clean 0..1 rectangle.
    const inv = new THREE.Matrix4().copy(group.matrixWorld).invert()
    const v = new THREE.Vector3()
    const pts = []
    const b = new THREE.Box2(new THREE.Vector2(Infinity, Infinity), new THREE.Vector2(-Infinity, -Infinity))
    for (const mesh of screens) {
      const pos = mesh.geometry.attributes.position
      const m = new THREE.Matrix4().multiplyMatrices(inv, mesh.matrixWorld)
      const list = []
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(m)
        list.push([v.x, v.y])
        b.expandByPoint(new THREE.Vector2(v.x, v.y))
      }
      pts.push(list)
    }
    screens.forEach((mesh, n) => {
      const geo = mesh.geometry.clone()
      const uv = new Float32Array(pts[n].length * 2)
      pts[n].forEach(([x, y], i) => {
        uv[i * 2] = (x - b.min.x) / (b.max.x - b.min.x)
        uv[i * 2 + 1] = (y - b.min.y) / (b.max.y - b.min.y)
      })
      geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
      mesh.geometry = geo
      mesh.renderOrder = 1
    })
    this.screens = screens
    this.screenBox = b // normalized screen rect, for callouts that point at the display

    // Screen texture: a canvas the painter draws into. A model that does not
    // state its display takes the shape of its screen mesh.
    const shape = screens.length ? (b.max.x - b.min.x) / (b.max.y - b.min.y) : 0.46
    const [dw, dh] = def.display ?? (shape >= 1 ? [2400, 2400 / shape] : [2400 * shape, 2400])
    this.display = [dw, dh]
    const cap = 2400 * screenScale
    const k = Math.min(1, cap / Math.max(dw, dh))
    this.painter = new ScreenPainter(dw * k, dh * k, { background })
    const tex = new THREE.CanvasTexture(this.painter.canvas)
    tex.colorSpace = THREE.SRGBColorSpace
    tex.anisotropy = stage.maxAnisotropy
    tex.generateMipmaps = true
    tex.minFilter = THREE.LinearMipmapLinearFilter
    this.texture = tex
    this.screenMaterial = new THREE.MeshPhysicalMaterial({
      color: 0x000000,
      emissive: 0xffffff,
      emissiveMap: tex,
      roughness: 0.06,
      metalness: 0,
      clearcoat: 1,
      clearcoatRoughness: 0.04,
      envMapIntensity: glare,
      toneMapped: false,
      // Some exports wind the display triangles inward; culling would hide them.
      side: THREE.DoubleSide,
    })
    for (const mesh of screens) mesh.material = this.screenMaterial

    if (def.island && screens.length) this.buildIsland(def.island, b, inv)
    if (def.lid) this.buildLid(def.lid)
  }

  /**
   * One merged black pill over the model's island cutouts. The GLBs model the
   * hardware truthfully — a pill plus a separate round camera beside it — but
   * iOS draws the two as a single shape, so that is what a screenshot of the
   * app actually looks like.
   *
   * The pill is a decal, coplanar with the display and biased forward in the
   * depth buffer only: float it geometrically and an oblique pose sees under
   * its edge, which uncovers the recess walls as a step along the bottom.
   */
  buildIsland({ w, h, top, pad = 0.004 }, box, inv) {
    const bw = box.max.x - box.min.x
    const bh = box.max.y - box.min.y
    // `pad` is slack for models whose cutouts run a shade wider than the spec.
    const iw = (w + pad) * bw
    const ih = (h + pad * (bw / bh)) * bh
    const cx = (box.min.x + box.max.x) / 2
    const cy = box.max.y - top * bh - ih / 2

    // Sit on the display surface itself, not on whatever else is in the
    // footprint: the cutouts are recessed behind it, so coplanar covers them.
    const v = new THREE.Vector3()
    let z = -Infinity
    for (const mesh of this.screens) {
      const pos = mesh.geometry.attributes.position
      const m = new THREE.Matrix4().multiplyMatrices(inv, mesh.matrixWorld)
      for (let i = 0; i < pos.count; i++) {
        v.fromBufferAttribute(pos, i).applyMatrix4(m)
        if (Math.abs(v.x - cx) <= iw / 2 && Math.abs(v.y - cy) <= ih / 2 && v.z > z) z = v.z
      }
    }
    if (!Number.isFinite(z)) z = 0 // screen has no vertices under the island

    const r = Math.min(iw, ih) / 2
    const shape = new THREE.Shape()
    shape.absarc(iw / 2 - r, 0, r, -Math.PI / 2, Math.PI / 2, false)
    shape.absarc(r - iw / 2, 0, r, Math.PI / 2, (3 * Math.PI) / 2, false)
    shape.closePath()
    const mesh = new THREE.Mesh(
      new THREE.ShapeGeometry(shape, 32),
      new THREE.MeshBasicMaterial({
        color: 0x000000,
        toneMapped: false,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -4,
      }),
    )
    mesh.position.set(cx, cy, z)
    mesh.renderOrder = 2
    mesh.castShadow = false
    mesh.receiveShadow = false
    // pivot, not group: the island has to turn with the device.
    this.pivot.add(mesh)
    this.island = mesh
  }

  buildLid({ above, hinge, close }) {
    const lid = new THREE.Group()
    const hingeV = new THREE.Vector3(...hinge)
    lid.position.copy(hingeV)
    // pivot, not norm: `above` and `hinge` are in normalized units, and norm's
    // children live in raw model units — hinge there and the lid swings about
    // the middle of the laptop, lifting clean off the base.
    this.pivot.add(lid)
    const inner = new THREE.Group()
    inner.position.copy(hingeV).negate()
    lid.add(inner)
    const moving = []
    this.group.updateMatrixWorld(true)
    const inv = new THREE.Matrix4().copy(this.pivot.matrixWorld).invert()
    this.model.traverse((o) => {
      if (!o.isMesh) return
      const c = new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3()).applyMatrix4(inv)
      if (c.y > above) moving.push(o)
    })
    for (const o of moving) {
      // Re-parent while keeping the world transform.
      const m = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld)
      o.removeFromParent()
      m.decompose(o.position, o.quaternion, o.scale)
      inner.add(o)
    }
    this.lidGroup = lid
    this.lidClose = close
  }

  /** Repaint the body materials; null puts the model's own colors back. */
  setFinish(finish) {
    for (const o of this.bodyMeshes) o.material.color.copy(finish ? toColor(finish) : o.userData.baseColor)
  }

  setGlare(glare) {
    this.screenMaterial.envMapIntensity = glare
  }

  /** Page-pixel box around the placed device, for the studio's selection outline. */
  pageRect() {
    const { x, y, z } = this.dims
    const cam = this.stage.camera
    const v = new THREE.Vector3()
    let x0 = Infinity
    let y0 = Infinity
    let x1 = -Infinity
    let y1 = -Infinity
    this.group.updateMatrixWorld(true)
    for (const sx of [-0.5, 0.5])
      for (const sy of [-0.5, 0.5])
        for (const sz of [-0.5, 0.5]) {
          v.set(sx * x, sy * y, sz * z).applyMatrix4(this.pivot.matrixWorld).project(cam)
          const px = ((v.x + 1) / 2) * this.stage.W
          const py = ((1 - v.y) / 2) * this.stage.H
          x0 = Math.min(x0, px)
          x1 = Math.max(x1, px)
          y0 = Math.min(y0, py)
          y1 = Math.max(y1, py)
        }
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }
  }

  /** 1 = as modelled (open), 0 = shut. */
  setLid(open) {
    if (this.lidGroup) this.lidGroup.rotation.x = (1 - open) * this.lidClose
  }

  /** Place by page pixels. `size` is the height (width for laptops) in px. */
  place({ x, y, z = 0, size, rx = 0, ry = 0, rz = 0, scale = 1, visible = true }) {
    const s = this.stage
    this.group.position.copy(s.world(x, y, z))
    this.group.scale.setScalar(size * scale)
    this.pivot.rotation.set(deg(rx), deg(ry), deg(rz))
    this.group.visible = visible && scale > 0.001
  }

  /**
   * World z-range of the placed device: [nearest the camera, farthest]. A
   * laptop measures its deck only — the open lid leans away, so the box around
   * the whole model claims room in front of the screen that nothing occupies.
   */
  depthRange() {
    const { x, y, z } = this.dims
    const v = new THREE.Vector3()
    let near = -Infinity
    let far = Infinity
    for (const sx of [-0.5, 0.5])
      for (const sy of this.lidGroup ? [-0.5] : [-0.5, 0.5])
        for (const sz of [-0.5, 0.5]) {
          v.set(sx * x, sy * y, sz * z).applyEuler(this.pivot.rotation)
          near = Math.max(near, v.z)
          far = Math.min(far, v.z)
        }
    const s = this.group.scale.x
    return [this.group.position.z + near * s, this.group.position.z + far * s]
  }

  /** Paint the display; arguments go to ScreenPainter.paint. */
  paint(a, b, p, mode) {
    this.painter.paint(a, b, p, mode)
    this.texture.needsUpdate = true
  }

  dispose() {
    for (const o of this.bodyMeshes) o.material.dispose()
    this.texture.dispose()
    this.screenMaterial.dispose()
    this.island?.geometry.dispose()
    this.island?.material.dispose()
  }
}
