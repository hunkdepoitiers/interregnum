import {
  Application, BufferImageSource, Container, Geometry, GlProgram, ImageSource, Mesh, Shader, UniformGroup,
} from 'pixi.js';
import type { MapData } from '../content/map';
import { LOOKUP_SIZE } from './map-modes';

/**
 * The whole map is one quad. The fragment shader reads the province id at each pixel from the id texture,
 * looks up that province's colours in a small lookup texture (see map-modes.ts), stripes occupied provinces
 * in the occupier's colour, and draws borders: faint between provinces, strong between realms.
 * Recolouring the map (map modes, conquests) only rewrites the lookup texture.
 */
const vertex = /* glsl */ `
in vec2 aPosition;
in vec2 aUV;
out vec2 vUV;
uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;
void main() {
  mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
  vUV = aUV;
}`;

const fragment = /* glsl */ `
in vec2 vUV;
out vec4 finalColor;
uniform sampler2D uIdMap;
uniform sampler2D uLookup;
uniform vec2 uMapSize;
uniform float uHover;
uniform float uSelected;
uniform float uZoom;
uniform vec4 uRealmHighlight; // rgb: owner colour to highlight; a: 1 when active

const vec3 INK = vec3(0.08, 0.06, 0.05);

float idAt(vec2 uv) {
  vec4 c = texture(uIdMap, uv);
  return floor(c.r * 255.0 + 0.5) + floor(c.g * 255.0 + 0.5) * 256.0;
}
vec4 baseOf(float id) { return texture(uLookup, vec2((id + 0.5) / ${LOOKUP_SIZE}.0, 0.25)); }
vec4 heldOf(float id) { return texture(uLookup, vec2((id + 0.5) / ${LOOKUP_SIZE}.0, 0.75)); }
bool sameColor(vec3 a, vec3 b) { return distance(a, b) < 0.004; }

// 0 = same province, 1 = province border, 2 = realm border (base colour changes).
float edgeTo(vec2 uv, float id, vec3 own) {
  float n = idAt(uv);
  if (n == id) return 0.0;
  return sameColor(baseOf(n).rgb, own) ? 1.0 : 2.0;
}

void main() {
  float id = idAt(vUV);
  vec4 base = baseOf(id);
  vec3 rgb = base.rgb;

  // Occupied: diagonal stripes in the controller's colour, ~12 screen pixels apart.
  vec3 held = heldOf(id).rgb;
  vec2 screenPx = vUV * uMapSize * uZoom;
  if (!sameColor(held, base.rgb) && mod(screenPx.x + screenPx.y, 12.0) < 5.0) rgb = held;

  if (uRealmHighlight.a > 0.5 && id > 0.0 && sameColor(base.rgb, uRealmHighlight.rgb)) rgb = mix(rgb, vec3(1.0), 0.3);
  if (id > 0.0 && id == uSelected) rgb = mix(rgb, vec3(1.0, 0.85, 0.35), 0.45);
  else if (id > 0.0 && id == uHover) rgb = mix(rgb, vec3(1.0), 0.25);

  // Neighbours one screen pixel (at least one map pixel) away.
  vec2 step = max(1.0, 1.0 / uZoom) / uMapSize;
  float edge = max(max(edgeTo(vUV + vec2(step.x, 0.0), id, base.rgb), edgeTo(vUV - vec2(step.x, 0.0), id, base.rgb)),
                   max(edgeTo(vUV + vec2(0.0, step.y), id, base.rgb), edgeTo(vUV - vec2(0.0, step.y), id, base.rgb)));
  // Lookup alpha < 0.75 marks water: its borders stay faint.
  if (edge > 0.0) rgb = mix(rgb, INK, base.a < 0.75 ? 0.25 : (edge > 1.5 ? 0.7 : 0.22));
  finalColor = vec4(rgb, 1.0);
}`;

const MAX_ZOOM = 8;

export class MapView {
  readonly app = new Application();
  private readonly world = new Container();
  private uniforms!: UniformGroup;
  private lookupSource!: BufferImageSource;
  private minZoom = 0.1;

  onHover: (id: number, clientX: number, clientY: number) => void = () => {};
  onClick: (id: number) => void = () => {};

  constructor(
    private readonly map: MapData,
    private readonly ids: Uint16Array,
    private readonly idBitmap: ImageBitmap,
  ) {}

  async mount(host: HTMLElement) {
    await this.app.init({ resizeTo: host, preference: 'webgl', background: '#0b1622', antialias: false });
    host.appendChild(this.app.canvas);

    const { width: W, height: H } = this.map;
    const idSource = new ImageSource({ resource: this.idBitmap, scaleMode: 'nearest', autoGenerateMipmaps: false });
    this.lookupSource = new BufferImageSource({
      resource: new Uint8Array(LOOKUP_SIZE * 2 * 4), width: LOOKUP_SIZE, height: 2, format: 'rgba8unorm', scaleMode: 'nearest',
      alphaMode: 'no-premultiply-alpha', // alpha is a water flag, not transparency
    });
    this.uniforms = new UniformGroup({
      uMapSize: { value: new Float32Array([W, H]), type: 'vec2<f32>' },
      uHover: { value: 0, type: 'f32' },
      uSelected: { value: 0, type: 'f32' },
      uZoom: { value: 1, type: 'f32' },
      uRealmHighlight: { value: new Float32Array(4), type: 'vec4<f32>' },
    });
    const geometry = new Geometry({
      attributes: { aPosition: [0, 0, W, 0, W, H, 0, H], aUV: [0, 0, 1, 0, 1, 1, 0, 1] },
      indexBuffer: [0, 1, 2, 0, 2, 3],
    });
    const shader = new Shader({
      glProgram: GlProgram.from({ vertex, fragment, name: 'province-map' }),
      resources: { uIdMap: idSource, uLookup: this.lookupSource, mapUniforms: this.uniforms },
    });
    this.world.addChild(new Mesh({ geometry, shader }));
    this.app.stage.addChild(this.world);

    this.fitToScreen();
    this.app.renderer.on('resize', () => this.clampCamera());
    this.bindInput();
  }

  setHover(id: number) {
    this.uniforms.uniforms.uHover = id;
  }

  setSelected(id: number) {
    this.uniforms.uniforms.uSelected = id;
  }

  /** Replaces the colour lookup (see buildLookup). */
  setLookup(lut: Uint8Array) {
    this.lookupSource.resource = lut;
    this.lookupSource.update();
  }

  /** Brightens every province whose base colour is this one (a realm's provinces); null clears it. */
  setRealmHighlight(rgb: [number, number, number] | null) {
    this.uniforms.uniforms.uRealmHighlight = rgb ? new Float32Array([rgb[0] / 255, rgb[1] / 255, rgb[2] / 255, 1]) : new Float32Array(4);
  }

  /** Centres the camera on a map pixel. */
  centerOn(x: number, y: number) {
    const s = this.world.scale.x;
    this.world.position.set(this.app.screen.width / 2 - x * s, this.app.screen.height / 2 - y * s);
    this.clampCamera();
  }

  idAtClient(clientX: number, clientY: number): number {
    const rect = this.app.canvas.getBoundingClientRect();
    const s = this.world.scale.x;
    const x = Math.floor((clientX - rect.left - this.world.x) / s);
    const y = Math.floor((clientY - rect.top - this.world.y) / s);
    if (x < 0 || y < 0 || x >= this.map.width || y >= this.map.height) return 0;
    return this.ids[y * this.map.width + x]!;
  }

  private fitToScreen() {
    const { width, height } = this.app.screen;
    this.minZoom = Math.min(width / this.map.width, height / this.map.height);
    this.world.scale.set(this.minZoom * 2.5);
    // Start over the Aegean and western Anatolia, where 1302 begins.
    this.centerOn(this.map.width * 0.68, this.map.height * 0.52);
  }

  private zoomAt(factor: number, sx: number, sy: number) {
    const old = this.world.scale.x;
    const next = Math.min(MAX_ZOOM, Math.max(this.minZoom, old * factor));
    this.world.position.set(sx - ((sx - this.world.x) * next) / old, sy - ((sy - this.world.y) * next) / old);
    this.world.scale.set(next);
    this.clampCamera();
  }

  /** Keeps at least part of the map on screen; centres it when it is smaller than the view. */
  private clampCamera() {
    const { width, height } = this.app.screen;
    const s = this.world.scale.x;
    this.uniforms.uniforms.uZoom = s;
    const mw = this.map.width * s;
    const mh = this.map.height * s;
    this.world.x = mw <= width ? (width - mw) / 2 : Math.min(0, Math.max(width - mw, this.world.x));
    this.world.y = mh <= height ? (height - mh) / 2 : Math.min(0, Math.max(height - mh, this.world.y));
  }

  private bindInput() {
    const canvas = this.app.canvas;
    let drag: { x: number; y: number; wx: number; wy: number; moved: boolean } | null = null;

    canvas.addEventListener('pointerdown', (e) => {
      canvas.setPointerCapture(e.pointerId);
      drag = { x: e.clientX, y: e.clientY, wx: this.world.x, wy: this.world.y, moved: false };
    });
    canvas.addEventListener('pointermove', (e) => {
      if (drag) {
        const dx = e.clientX - drag.x;
        const dy = e.clientY - drag.y;
        if (Math.abs(dx) + Math.abs(dy) > 4) drag.moved = true;
        if (drag.moved) {
          this.world.position.set(drag.wx + dx, drag.wy + dy);
          this.clampCamera();
        }
      }
      this.onHover(this.idAtClient(e.clientX, e.clientY), e.clientX, e.clientY);
    });
    canvas.addEventListener('pointerup', (e) => {
      if (drag && !drag.moved) this.onClick(this.idAtClient(e.clientX, e.clientY));
      drag = null;
    });
    canvas.addEventListener('pointerleave', () => this.onHover(0, 0, 0));
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      this.zoomAt(Math.pow(1.0015, -e.deltaY), e.clientX - rect.left, e.clientY - rect.top);
    }, { passive: false });
  }
}

/** Fetches the generated id map and decodes it without colour management, so ids survive exactly. */
export async function loadIdMap(url: string, width: number, height: number) {
  const blob = await (await fetch(url)).blob();
  const bitmap = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bitmap, 0, 0);
  const rgba = ctx.getImageData(0, 0, width, height).data;
  const ids = new Uint16Array(width * height);
  for (let p = 0; p < ids.length; p++) ids[p] = rgba[p * 4]! | (rgba[p * 4 + 1]! << 8);
  return { bitmap, ids };
}
