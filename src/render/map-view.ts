import {
  Application, BufferImageSource, Container, Geometry, GlProgram, Graphics, ImageSource, Mesh, Shader, Text, TextStyle,
  UniformGroup,
} from 'pixi.js';
import { lonLatToPixel, type MapData, type RiverData } from '../content/map';
import type { RealmLabel } from './labels';
import { LOOKUP_HEIGHT, LOOKUP_ROWS, LOOKUP_WIDTH } from './map-modes';

/**
 * The map is a grid of quads, one per id-map tile (WebGL textures max out at 4096 px). The fragment shader reads
 * the province id at each pixel from its tile's id texture,
 * looks up that province's colours in a small lookup texture (see map-modes.ts) and paints it like an old
 * hand-drawn map: realm colours as a muted wash on paper, umber sea with a ripple line round the coasts, drawn
 * peaks on mountains, stippled deserts and ink borders. Occupied provinces are striped in the occupier's colour.
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
uniform vec2 uTileOrigin;
uniform float uHover;
uniform float uSelected;
uniform float uZoom;
uniform vec4 uRealmHighlight; // rgb: owner colour to highlight; a: 1 when active

const vec3 INK = vec3(0.17, 0.12, 0.08);
const vec3 PAPER = vec3(0.91, 0.86, 0.73);
const vec3 SEA = vec3(0.43, 0.37, 0.28);

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
// Lookup alpha encodes the province kind (KIND_ALPHA in map-modes.ts).
bool isWater(float a) { return a < 0.6; }
bool terrain(float a) { return a > 0.6 && a < 0.92; } // mountain or wasteland

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
  return v;
}

// A realm colour as a muted wash over the paper.
vec3 wash(vec3 c) {
  float grey = dot(c, vec3(0.3, 0.59, 0.11));
  return mix(PAPER, mix(vec3(grey), c, 0.75), 0.55);
}

// Hand-drawn peaks, one per cell; cells are ~26 screen px wide, snapped to powers of two so they do not shimmer.
vec3 mountains(vec3 rgb, vec2 mapPx) {
  float cell = exp2(floor(log2(26.0 / uZoom)));
  vec2 g = mapPx / cell;
  if (mod(floor(g.y), 2.0) > 0.5) g.x += 0.5;
  vec2 c = floor(g);
  vec2 q = fract(g);
  float cx = 0.5 + (hash(c) - 0.5) * 0.3;
  float top = 0.15 + hash(c + 7.0) * 0.2;
  float bottom = 0.85;
  float line = 1.1 / (cell * uZoom);
  if (q.y > top && q.y < bottom) {
    float halfWidth = (q.y - top) / (bottom - top) * 0.42;
    float dx = q.x - cx;
    if (abs(dx) < halfWidth) {
      rgb = dx > 0.0 ? mix(rgb, INK, 0.3) : mix(rgb, vec3(1.0), 0.07);
      if (halfWidth - abs(dx) < line * 1.4) rgb = mix(rgb, INK, 0.85);
    }
  }
  return rgb;
}

void main() {
  float id = idAt(vUV);
  vec4 base = baseOf(id);
  vec2 mapPx = uTileOrigin + vUV * uTileSize;
  vec2 screenPx = mapPx * uZoom;
  float paper = 0.93 + 0.1 * fbm(mapPx / 60.0) + 0.04 * (noise(screenPx * 0.7) - 0.5);
  vec2 px = max(1.0, 1.0 / uZoom) / uTileSize; // one screen pixel, at least one map pixel
  bool water = isWater(base.a);

  vec3 rgb;
  if (water) {
    rgb = SEA * (0.94 + 0.12 * fbm(mapPx / 90.0));
    // A ripple line round the coasts, ~5 screen px out.
    bool near = false;
    bool far = false;
    for (int i = 0; i < 8; i++) {
      float a = float(i) * 0.785398;
      vec2 d = vec2(cos(a), sin(a)) * px;
      if (!isWater(baseOf(idAt(vUV + d * 4.0)).a)) near = true;
      if (!isWater(baseOf(idAt(vUV + d * 6.0)).a)) far = true;
    }
    if (far && !near) rgb = mix(rgb, PAPER, 0.22);
  } else {
    bool owned = base.a > 0.99;
    rgb = owned ? wash(base.rgb) : PAPER * 0.97;
    if (base.a > 0.8 && base.a < 0.92) { // wasteland: pale sand with stipple
      rgb = mix(PAPER, vec3(0.95, 0.9, 0.76), 0.6);
      vec2 cell = floor(screenPx / 5.0);
      vec2 dot = 0.5 + (vec2(hash(cell + 3.1), hash(cell + 5.7)) - 0.5) * 0.6;
      if (hash(cell) > 0.8 && distance(fract(screenPx / 5.0), dot) < 0.18) rgb = mix(rgb, INK, 0.35);
    }
    if (base.a > 0.6 && base.a <= 0.8) rgb = mountains(mix(PAPER, vec3(0.8, 0.74, 0.62), 0.5), mapPx);

    // Occupied: diagonal stripes in the controller's colour, ~12 screen pixels apart.
    vec3 held = heldOf(id).rgb;
    if (!sameColor(held, base.rgb) && mod(screenPx.x + screenPx.y, 12.0) < 5.0) rgb = wash(held);

    // A deeper wash just inside realm borders, like the edge of a watercolour.
    if (owned) {
      bool rim = false;
      for (int i = 0; i < 8; i++) {
        float a = float(i) * 0.785398;
        vec4 n = baseOf(idAt(vUV + vec2(cos(a), sin(a)) * px * 4.0));
        if (!sameColor(n.rgb, base.rgb)) rim = true;
      }
      if (rim) rgb = mix(rgb, base.rgb * 0.85, 0.35);
    }
  }
  rgb *= paper;

  if (uRealmHighlight.a > 0.5 && id > 0.0 && sameColor(base.rgb, uRealmHighlight.rgb)) rgb = mix(rgb, vec3(1.0), 0.25);
  if (id > 0.0 && id == uSelected) rgb = mix(rgb, vec3(1.0, 0.85, 0.4), 0.45);
  else if (id > 0.0 && id == uHover) rgb = mix(rgb, vec3(1.0), 0.2);

  // Ink between realms and along coasts; province borders fade in as you zoom in.
  float ink = 0.0;
  for (int i = 0; i < 4; i++) {
    vec2 d = i == 0 ? vec2(px.x, 0.0) : i == 1 ? vec2(-px.x, 0.0) : i == 2 ? vec2(0.0, px.y) : vec2(0.0, -px.y);
    float n = idAt(vUV + d);
    if (n == id) continue;
    vec4 nb = baseOf(n);
    if (water != isWater(nb.a)) ink = max(ink, 0.8);
    else if (water) ink = max(ink, 0.06);
    else if (terrain(base.a) || terrain(nb.a)) ink = max(ink, 0.3); // mountains and deserts are drawn, not outlined
    else if (!sameColor(nb.rgb, base.rgb)) ink = max(ink, 0.7);
    else ink = max(ink, 0.2 * smoothstep(0.3, 1.0, uZoom));
  }
  rgb = mix(rgb, INK, ink);
  finalColor = vec4(rgb, 1.0);
}`;

const MAX_ZOOM = 8;
/** Realm names smaller than this on screen are hidden; larger ones are capped. */
const MIN_LABEL_PX = 9;
const MAX_LABEL_PX = 110;
export const LABEL_FONT = '"IM Fell English SC", "Iowan Old Style", Palatino, Georgia, serif';
const MAX_DECODED_TILES = 6;

export class MapView {
  readonly app = new Application();
  private readonly world = new Container();
  private uniforms!: UniformGroup;
  private lookupSource!: BufferImageSource;
  private minZoom = 0.1;

  onHover: (id: number, clientX: number, clientY: number) => void = () => {};
  onClick: (id: number) => void = () => {};
  /** Map editor brush: left click or drag paints (Shift erases, Alt picks the realm under the cursor); clicks no longer select. */
  paintMode = false;
  onPaint: (id: number, x: number, y: number, how: 'paint' | 'erase' | 'pick') => void = () => {};

  /** Decoded id arrays of recently hovered tiles (least recently used first), for picking. */
  private readonly tileIds = new Map<number, Uint16Array>();

  constructor(
    private readonly map: MapData,
    private readonly tiles: ImageBitmap[],
  ) {}

  async mount(host: HTMLElement) {
    await this.app.init({ resizeTo: host, preference: 'webgl', background: '#6e5f48', antialias: false });
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
      const tileUniforms = new UniformGroup({
        uTileSize: { value: new Float32Array([w, h]), type: 'vec2<f32>' },
        uTileOrigin: { value: new Float32Array([x, y]), type: 'vec2<f32>' },
      });
      const shader = new Shader({
        glProgram,
        resources: { uIdMap: idSource, uLookup: this.lookupSource, mapUniforms: this.uniforms, tileUniforms },
      });
      this.world.addChild(new Mesh({ geometry, shader }));
    });
    this.app.stage.addChild(this.world);
    this.labelLayer.eventMode = 'none';
    this.app.stage.addChild(this.labelLayer);

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
        g.stroke({ width, color: 0x6a6650, alpha: 0.75, cap: 'round', join: 'round' });
      }
    }
  }

  private readonly labelLayer = new Container();
  /** By realm id. Text objects are reused so that repainting the map (editor, conquests) stays cheap. */
  private readonly labels = new Map<number, { label: RealmLabel; text: Text }>();

  /**
   * Realm names, kept in screen space and laid out again as the camera moves: text scaled with the map would
   * blur when zoomed in.
   */
  setLabels(labels: RealmLabel[]) {
    const keep = new Set(labels.map((l) => l.realm));
    for (const [realm, l] of this.labels) {
      if (!keep.has(realm)) { l.text.destroy(); this.labels.delete(realm); }
    }
    for (const label of labels) {
      let entry = this.labels.get(label.realm);
      if (!entry) {
        const style = new TextStyle({ fontFamily: LABEL_FONT, fill: 0x2a1f14, stroke: { color: 0xeadfc4, width: 2, join: 'round' } });
        const text = new Text({ text: label.text, style, anchor: 0.5 });
        text.alpha = 0.88;
        this.labelLayer.addChild(text);
        entry = { label, text };
        this.labels.set(label.realm, entry);
      }
      entry.label = label;
      if (entry.text.text !== label.text) entry.text.text = label.text;
      entry.text.rotation = label.angle;
    }
    this.layoutLabels();
  }

  private layoutLabels() {
    const s = this.world.scale.x;
    for (const { label, text } of this.labels.values()) {
      const px = label.size * s;
      text.visible = px >= MIN_LABEL_PX;
      if (!text.visible) continue;
      // Re-render the text only when its size moves by more than 10%.
      const size = Math.round(Math.min(px, MAX_LABEL_PX));
      if (Math.abs(size / Number(text.style.fontSize) - 1) > 0.1) {
        text.style.fontSize = size;
        text.style.letterSpacing = size * 0.18;
        text.style.stroke = { color: 0xeadfc4, width: Math.max(1.5, size * 0.12), join: 'round' };
      }
      text.position.set(this.world.x + label.x * s, this.world.y + label.y * s);
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

  /** The map pixel under a point on the page. */
  pixelAtClient(clientX: number, clientY: number): [number, number] {
    const rect = this.app.canvas.getBoundingClientRect();
    const s = this.world.scale.x;
    return [Math.floor((clientX - rect.left - this.world.x) / s), Math.floor((clientY - rect.top - this.world.y) / s)];
  }

  idAtClient(clientX: number, clientY: number): number {
    return this.idAtPixel(...this.pixelAtClient(clientX, clientY));
  }

  idAtPixel(x: number, y: number): number {
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
    this.layoutLabels();
  }

  private bindInput() {
    const canvas = this.app.canvas;
    let drag: { x: number; y: number; wx: number; wy: number; moved: boolean } | null = null;
    let painting = false;
    const paint = (e: PointerEvent) => {
      const [x, y] = this.pixelAtClient(e.clientX, e.clientY);
      const id = this.idAtPixel(x, y);
      if (id) this.onPaint(id, x, y, e.altKey ? 'pick' : e.shiftKey ? 'erase' : 'paint');
    };

    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    canvas.addEventListener('pointerdown', (e) => {
      canvas.setPointerCapture(e.pointerId);
      // In paint mode the left button paints and the other buttons pan.
      if (this.paintMode && e.button === 0) {
        painting = true;
        paint(e);
        return;
      }
      drag = { x: e.clientX, y: e.clientY, wx: this.world.x, wy: this.world.y, moved: false };
    });
    canvas.addEventListener('pointermove', (e) => {
      if (painting) paint(e);
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
      if (drag && !drag.moved && !this.paintMode) this.onClick(this.idAtClient(e.clientX, e.clientY));
      drag = null;
      painting = false;
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
