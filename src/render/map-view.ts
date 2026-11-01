import {
  Application, BufferImageSource, Container, Geometry, GlProgram, Graphics, ImageSource, Mesh, Shader, UniformGroup,
} from 'pixi.js';
import { lonLatToPixel, type MapData, type RiverData } from '../content/map';
import { LOOKUP_HEIGHT, LOOKUP_ROWS, LOOKUP_WIDTH } from './map-modes';

/**
 * The map is a grid of quads, one per id-map tile (WebGL textures max out at 4096 px). The fragment shader reads
 * the province id at each pixel from its tile's id texture,
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
uniform vec2 uTileSize;
uniform float uHover;
uniform float uSelected;
uniform float uZoom;
uniform vec4 uRealmHighlight; // rgb: owner colour to highlight; a: 1 when active

const vec3 INK = vec3(0.08, 0.06, 0.05);

float idAt(vec2 uv) {
  vec4 c = texture(uIdMap, uv);
  return floor(c.r * 255.0 + 0.5) + floor(c.g * 255.0 + 0.5) * 256.0;
}
vec2 lookupUv(float id, float layer) {
  float col = mod(id, ${LOOKUP_WIDTH}.0);
  float row = floor(id / ${LOOKUP_WIDTH}.0) + layer * ${LOOKUP_ROWS}.0;
  return vec2((col + 0.5) / ${LOOKUP_WIDTH}.0, (row + 0.5) / ${LOOKUP_HEIGHT}.0);
}
vec4 baseOf(float id) { return texture(uLookup, lookupUv(id, 0.0)); }
vec4 heldOf(float id) { return texture(uLookup, lookupUv(id, 1.0)); }
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
  vec2 screenPx = vUV * uTileSize * uZoom;
  if (!sameColor(held, base.rgb) && mod(screenPx.x + screenPx.y, 12.0) < 5.0) rgb = held;

  if (uRealmHighlight.a > 0.5 && id > 0.0 && sameColor(base.rgb, uRealmHighlight.rgb)) rgb = mix(rgb, vec3(1.0), 0.3);
  if (id > 0.0 && id == uSelected) rgb = mix(rgb, vec3(1.0, 0.85, 0.35), 0.45);
  else if (id > 0.0 && id == uHover) rgb = mix(rgb, vec3(1.0), 0.25);

  // Neighbours one screen pixel (at least one map pixel) away.
  vec2 step = max(1.0, 1.0 / uZoom) / uTileSize;
  float edge = max(max(edgeTo(vUV + vec2(step.x, 0.0), id, base.rgb), edgeTo(vUV - vec2(step.x, 0.0), id, base.rgb)),
                   max(edgeTo(vUV + vec2(0.0, step.y), id, base.rgb), edgeTo(vUV - vec2(0.0, step.y), id, base.rgb)));
  // Lookup alpha < 0.75 marks water: its borders stay faint.
  if (edge > 0.0) rgb = mix(rgb, INK, base.a < 0.75 ? 0.25 : (edge > 1.5 ? 0.7 : 0.22));
  finalColor = vec4(rgb, 1.0);
}`;

const MAX_ZOOM = 8;
const MAX_DECODED_TILES = 6;

export class MapView {
  readonly app = new Application();
  private readonly world = new Container();
  private uniforms!: UniformGroup;
  private lookupSource!: BufferImageSource;
  private minZoom = 0.1;

  onHover: (id: number, clientX: number, clientY: number) => void = () => {};
  onClick: (id: number) => void = () => {};

  /** Decoded id arrays of recently hovered tiles (least recently used first), for picking. */
  private readonly tileIds = new Map<number, Uint16Array>();

  constructor(
    private readonly map: MapData,
    private readonly tiles: ImageBitmap[],
  ) {}

  async mount(host: HTMLElement) {
    await this.app.init({ resizeTo: host, preference: 'webgl', background: '#0b1622', antialias: false });
    host.appendChild(this.app.canvas);

    this.lookupSource = new BufferImageSource({
      resource: new Uint8Array(LOOKUP_WIDTH * LOOKUP_HEIGHT * 4), width: LOOKUP_WIDTH, height: LOOKUP_HEIGHT,
      format: 'rgba8unorm', scaleMode: 'nearest',
      alphaMode: 'no-premultiply-alpha', // alpha is a water flag, not transparency
    });
    this.uniforms = new UniformGroup({
      uHover: { value: 0, type: 'f32' },
      uSelected: { value: 0, type: 'f32' },
      uZoom: { value: 1, type: 'f32' },
      uRealmHighlight: { value: new Float32Array(4), type: 'vec4<f32>' },
    });
    const glProgram = GlProgram.from({ vertex, fragment, name: 'province-map' });
    this.tiles.forEach((bitmap, i) => {
      const { x, y, w, h } = this.tileRect(i);
      const geometry = new Geometry({
        attributes: { aPosition: [x, y, x + w, y, x + w, y + h, x, y + h], aUV: [0, 0, 1, 0, 1, 1, 0, 1] },
        indexBuffer: [0, 1, 2, 0, 2, 3],
      });
      const idSource = new ImageSource({ resource: bitmap, scaleMode: 'nearest', autoGenerateMipmaps: false });
      const tileUniforms = new UniformGroup({ uTileSize: { value: new Float32Array([w, h]), type: 'vec2<f32>' } });
      const shader = new Shader({
        glProgram,
        resources: { uIdMap: idSource, uLookup: this.lookupSource, mapUniforms: this.uniforms, tileUniforms },
      });
      this.world.addChild(new Mesh({ geometry, shader }));
    });
    this.app.stage.addChild(this.world);

    this.fitToScreen();
    this.app.renderer.on('resize', () => this.clampCamera());
    this.bindInput();
  }

  /** Draws rivers over the map. They are redrawn as the zoom changes so major rivers keep a visible width. */
  setRivers(rivers: RiverData) {
    this.rivers = rivers;
    this.riverGraphics.eventMode = 'none';
    this.world.addChild(this.riverGraphics);
    this.drawRivers();
  }

  private rivers: RiverData = [];
  private readonly riverGraphics = new Graphics();
  private riverZoom = 0;

  private drawRivers() {
    const zoom = this.world.scale.x;
    this.riverZoom = zoom;
    const g = this.riverGraphics.clear();
    for (const r of this.rivers) {
      // Width in map pixels, but never thinner on screen than the minimum for this river's size.
      const mapWidth = Math.max(1, 3.4 - r.rank * 0.3);
      const minScreen = r.rank <= 3 ? 1.8 : r.rank <= 6 ? 1.2 : 0.8;
      const width = Math.max(mapWidth, minScreen / zoom);
      for (const line of r.lines) {
        g.moveTo(line[0]!, line[1]!);
        for (let i = 2; i < line.length; i += 2) g.lineTo(line[i]!, line[i + 1]!);
        g.stroke({ width, color: 0x3d6f9a, alpha: 0.85, cap: 'round', join: 'round' });
      }
    }
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
    const { tileSize: T, tileCols } = this.map;
    const i = Math.floor(y / T) * tileCols + Math.floor(x / T);
    const r = this.tileRect(i);
    return this.tileIdArray(i)[(y - r.y) * r.w + (x - r.x)]!;
  }

  private tileRect(i: number) {
    const { tileSize: T, tileCols, width, height } = this.map;
    const x = (i % tileCols) * T;
    const y = Math.floor(i / tileCols) * T;
    return { x, y, w: Math.min(T, width - x), h: Math.min(T, height - y) };
  }

  /** Decodes a tile's ids on first use; keeps the few most recent so memory stays bounded. */
  private tileIdArray(i: number): Uint16Array {
    const cached = this.tileIds.get(i);
    if (cached) {
      this.tileIds.delete(i);
      this.tileIds.set(i, cached);
      return cached;
    }
    const { w, h } = this.tileRect(i);
    const ctx = new OffscreenCanvas(w, h).getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(this.tiles[i]!, 0, 0);
    const rgba = ctx.getImageData(0, 0, w, h).data;
    const ids = new Uint16Array(w * h);
    for (let p = 0; p < ids.length; p++) ids[p] = rgba[p * 4]! | (rgba[p * 4 + 1]! << 8);
    this.tileIds.set(i, ids);
    if (this.tileIds.size > MAX_DECODED_TILES) this.tileIds.delete(this.tileIds.keys().next().value!);
    return ids;
  }

  private fitToScreen() {
    const { width, height } = this.app.screen;
    this.minZoom = Math.min(width / this.map.width, height / this.map.height);
    this.world.scale.set(this.minZoom * 2.5);
    // Start over the Aegean and western Anatolia, where the game begins.
    const [x, y] = lonLatToPixel(this.map.projection, 27, 39);
    this.centerOn(x, y);
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
    if (this.rivers.length && Math.abs(s / this.riverZoom - 1) > 0.15) this.drawRivers();
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

/** Fetches every id-map tile and decodes it without colour management, so ids survive exactly. */
export async function loadIdTiles(base: string, map: MapData): Promise<ImageBitmap[]> {
  const jobs: Promise<ImageBitmap>[] = [];
  for (let row = 0; row < map.tileRows; row++) {
    for (let col = 0; col < map.tileCols; col++) {
      jobs.push(
        fetch(`${base}generated/province-ids-${col}-${row}.png`)
          .then((r) => r.blob())
          .then((blob) => createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' })),
      );
    }
  }
  return Promise.all(jobs);
}
