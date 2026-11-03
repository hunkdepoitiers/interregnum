import type { JSX } from 'preact';
import type { ProvinceKind, Terrain } from '../content/map';

/**
 * Engraving-style terrain scenes for the province panel header: line work in one ink on vellum, built from simple
 * strokes (hatching, furrows, tree and wave marks) and varied per province by a seeded generator, so a province
 * always shows the same scene. Coastal provinces get a strip of sea with a ship.
 */

const W = 360;
const H = 130;

function rng(seed: number) {
  let a = seed >>> 0 || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type R = () => number;
const f = (n: number) => n.toFixed(1);

/** A smooth ridge through points spread across the width, closed down to the bottom. */
function ridge(r: R, base: number, amp: number, n: number, x0 = -10, x1 = W + 10): string {
  const pts: [number, number][] = [];
  for (let i = 0; i <= n; i++) pts.push([x0 + ((x1 - x0) * i) / n, base - (i % 2 ? 0.55 + 0.45 * r() : 0.15 * r()) * amp]);
  let d = `M${f(pts[0]![0])},${f(pts[0]![1])}`;
  for (let i = 1; i < pts.length; i++) {
    const [px, py] = pts[i - 1]!;
    const [x, y] = pts[i]!;
    d += ` Q${f(px + (x - px) / 2)},${f(py)} ${f(x)},${f(y)}`;
  }
  return `${d} L${f(x1)},${H} L${f(x0)},${H} Z`;
}

function sky(r: R): JSX.Element {
  const lines: JSX.Element[] = [];
  for (let y = 5; y < 36; y += 3.2) {
    const len = W * (0.25 + 0.6 * (1 - y / 36)) * (0.6 + 0.4 * r());
    const x = r() * (W - len);
    lines.push(<line key={y} x1={f(x)} y1={f(y)} x2={f(x + len)} y2={f(y)} class="ink thin" stroke-dasharray={`${f(18 + r() * 40)} ${f(3 + r() * 6)}`} />);
  }
  const cx = 40 + r() * 260;
  return (
    <g>
      {lines}
      <path class="paper ink" d={`M${cx},28 q8,-14 22,-6 q10,-12 24,-2 q14,-4 14,8 q6,6 -4,8 h-52 q-12,-2 -4,-8 z`} />
      {[0, 1, 2].map((i) => {
        const bx = 30 + r() * 300;
        const by = 14 + r() * 20;
        return <path key={`b${i}`} class="ink" d={`M${f(bx)},${f(by)} q3,-3 6,0 q3,-3 6,0`} />;
      })}
    </g>
  );
}

function hatchShadow(d: string, key: string) {
  return <path key={key} d={d} fill="url(#vg-hatch)" />;
}

function hills(r: R, base: number, amp: number, layers: number): JSX.Element[] {
  const out: JSX.Element[] = [];
  for (let i = 0; i < layers; i++) {
    const d = ridge(r, base + i * 14, amp - i * 6, 3 + Math.floor(r() * 3));
    out.push(<path key={`h${i}`} class="paper ink" d={d} />);
    if (i === layers - 1 || r() < 0.6) out.push(hatchShadow(ridge(r, base + i * 14 + 8, (amp - i * 6) / 2, 5), `hs${i}`));
  }
  return out;
}

function mountains(r: R, base: number, n: number, height: number, snow: boolean): JSX.Element[] {
  const out: JSX.Element[] = [];
  for (let i = 0; i < n; i++) {
    const cx = (W / n) * (i + 0.5) + (r() - 0.5) * 40;
    const w = 70 + r() * 70;
    const top = base - height * (0.6 + 0.4 * r());
    const l = cx - w / 2;
    const rgt = cx + w / 2;
    const d = `M${f(l)},${base} L${f(cx - w * 0.15)},${f(top + 18)} L${f(cx)},${f(top)} L${f(cx + w * 0.12)},${f(top + 14)} L${f(rgt)},${base} Z`;
    out.push(<path key={`m${i}`} class="paper ink" d={d} />);
    out.push(hatchShadow(`M${f(cx)},${f(top)} L${f(cx + w * 0.12)},${f(top + 14)} L${f(rgt)},${base} L${f(cx + 6)},${base} Z`, `ms${i}`));
    if (snow) out.push(<path key={`sn${i}`} class="snow ink" d={`M${f(cx - 9)},${f(top + 12)} L${f(cx)},${f(top)} L${f(cx + 8)},${f(top + 10)} L${f(cx + 2)},${f(top + 7)} L${f(cx - 3)},${f(top + 13)} Z`} />);
  }
  return out;
}

function conifer(x: number, y: number, s: number, key: string) {
  return (
    <g key={key}>
      <path class="paper ink" d={`M${f(x)},${f(y - 22 * s)} L${f(x + 8 * s)},${f(y - 6 * s)} L${f(x - 8 * s)},${f(y - 6 * s)} Z M${f(x)},${f(y - 30 * s)} L${f(x + 6 * s)},${f(y - 16 * s)} L${f(x - 6 * s)},${f(y - 16 * s)} Z`} />
      <line class="ink" x1={f(x)} y1={f(y - 6 * s)} x2={f(x)} y2={f(y)} />
    </g>
  );
}

function broadleaf(x: number, y: number, s: number, key: string) {
  return (
    <g key={key}>
      <line class="ink" x1={f(x)} y1={f(y - 10 * s)} x2={f(x)} y2={f(y)} />
      <path class="paper ink" d={`M${f(x - 10 * s)},${f(y - 12 * s)} q-4,-12 8,-16 q4,-10 14,-2 q10,4 2,16 q-2,6 -24,2 z`} />
      <path d={`M${f(x + 1)},${f(y - 13 * s)} q8,0 9,-10 q4,10 -9,10 z`} fill="url(#vg-hatch)" />
    </g>
  );
}

function palm(x: number, y: number, s: number, key: string) {
  return (
    <g key={key} class="ink">
      <path d={`M${f(x)},${f(y)} q${f(-4 * s)},${f(-14 * s)} ${f(3 * s)},${f(-30 * s)}`} />
      <path d={`M${f(x + 3 * s)},${f(y - 30 * s)} q-12,-2 -16,8 M${f(x + 3 * s)},${f(y - 30 * s)} q12,-4 16,6 M${f(x + 3 * s)},${f(y - 30 * s)} q-6,-10 -14,-8 M${f(x + 3 * s)},${f(y - 30 * s)} q8,-10 14,-6`} />
    </g>
  );
}

function tufts(r: R, y0: number, y1: number, n: number): JSX.Element[] {
  return Array.from({ length: n }, (_, i) => {
    const x = r() * W;
    const y = y0 + r() * (y1 - y0);
    return <path key={`t${i}`} class="ink thin" d={`M${f(x - 3)},${f(y)} l2,-4 l1,4 l2,-5 l1,5 l2,-3`} />;
  });
}

function furrows(r: R, horizon: number): JSX.Element[] {
  const vx = 120 + r() * 120;
  const out: JSX.Element[] = [];
  for (let i = -8; i <= 8; i++) out.push(<line key={`f${i}`} class="ink thin" x1={f(vx + i * 6)} y1={f(horizon + 4)} x2={f(vx + i * 48)} y2={H} />);
  return out;
}

function waves(y0: number, y1: number, r: R): JSX.Element[] {
  const out: JSX.Element[] = [];
  for (let y = y0; y < y1; y += 6) {
    for (let x = (y / 6) % 2 ? 0 : 10; x < W; x += 20 + r() * 6) out.push(<path key={`w${y}-${x.toFixed(0)}`} class="ink thin" d={`M${f(x)},${f(y)} q4,-3 8,0`} />);
  }
  return out;
}

function ship(x: number, y: number) {
  return (
    <g class="ink" key="ship">
      <path class="paper ink" d={`M${x - 16},${y} q16,8 32,0 l-4,-5 h-24 z`} />
      <line x1={x} y1={y - 5} x2={x} y2={y - 30} />
      <path class="paper ink" d={`M${x + 1},${y - 28} q12,10 0,20 z`} />
      <path d={`M${x},${y - 30} l6,-3 l-6,-2`} />
    </g>
  );
}

function tower(x: number, y: number) {
  return (
    <g key="tower">
      <rect class="paper ink" x={x - 6} y={y - 22} width="12" height="22" />
      <path class="paper ink" d={`M${x - 8},${y - 22} L${x},${y - 34} L${x + 8},${y - 22} Z`} />
      <path class="ink" d={`M${x},${y - 34} v-6 M${x - 2},${y - 38} h4`} />
      <rect class="paper ink" x={x + 6} y={y - 12} width="16" height="12" />
      <path class="ink" d={`M${x + 6},${y - 12} L${x + 14},${y - 18} L${x + 22},${y - 12}`} />
    </g>
  );
}

function yurt(x: number, y: number) {
  return (
    <g key="yurt">
      <path class="paper ink" d={`M${x - 12},${y} v-8 q12,-12 24,0 v8 z`} />
      <path class="ink" d={`M${x - 3},${y} v-6 h6 v6`} />
    </g>
  );
}

function scene(terrain: Terrain | undefined, kind: ProvinceKind, coastal: boolean, r: R): JSX.Element[] {
  const horizon = 54 + r() * 8;
  const out: JSX.Element[] = [];
  if (kind === 'sea' || kind === 'lake') {
    out.push(<line key="hz" class="ink" x1="0" y1={f(horizon)} x2={W} y2={f(horizon)} />, ...waves(horizon + 6, H, r), ship(80 + r() * 200, horizon + 22));
    return out;
  }
  if (kind === 'mountain') return [...mountains(r, H - 6, 4, 80, true)];
  const t = kind === 'wasteland' ? (terrain === 'tundra' || terrain === 'forest' ? 'tundra' : 'desert') : terrain ?? 'plains';
  const land = coastal ? W * (0.45 + r() * 0.25) : W + 20;
  switch (t) {
    case 'farmlands':
      out.push(...hills(r, horizon, 16, 1), ...furrows(r, horizon + 12), tower(40 + r() * 80, horizon + 14), broadleaf(land - 40, horizon + 30, 1.2, 'tr'));
      break;
    case 'plains':
      out.push(...hills(r, horizon + 6, 14, 1), ...tufts(r, horizon + 16, H - 4, 26), broadleaf(60 + r() * 220, horizon + 34, 1.3, 'tr'));
      break;
    case 'hills':
      out.push(...hills(r, horizon - 6, 40, 3), broadleaf(40 + r() * 100, H - 12, 1, 'tr'));
      break;
    case 'highlands':
      out.push(...mountains(r, horizon + 10, 3, 34, false), ...hills(r, horizon + 18, 16, 2));
      break;
    case 'forest':
      out.push(...hills(r, horizon, 12, 1));
      for (let i = 0; i < 22; i++) out.push(conifer(r() * W, horizon + 14 + r() * 40, 0.8 + r() * 0.6, `c${i}`));
      break;
    case 'jungle':
      out.push(...hills(r, horizon, 16, 1));
      for (let i = 0; i < 10; i++) out.push(palm(r() * W, horizon + 30 + r() * 26, 0.9 + r() * 0.5, `p${i}`));
      for (let i = 0; i < 8; i++) out.push(broadleaf(r() * W, H - r() * 12, 1.2, `bl${i}`));
      break;
    case 'marsh':
      out.push(<line key="hz" class="ink" x1="0" y1={f(horizon)} x2={W} y2={f(horizon)} />, ...waves(horizon + 10, H, r));
      for (let i = 0; i < 30; i++) {
        const x = r() * W;
        const y = horizon + 12 + r() * 46;
        out.push(<path key={`r${i}`} class="ink thin" d={`M${f(x)},${f(y)} v-14 M${f(x + 3)},${f(y)} q1,-8 5,-12 M${f(x)},${f(y - 14)} m-1,0 a1.5,4 0 1 0 2,0`} />);
      }
      break;
    case 'steppe':
      out.push(<line key="hz" class="ink" x1="0" y1={f(horizon + 4)} x2={W} y2={f(horizon + 4)} />, ...tufts(r, horizon + 10, H - 4, 34), yurt(60 + r() * 220, horizon + 28));
      break;
    case 'desert':
      for (let i = 0; i < 3; i++) {
        const d = ridge(r, horizon + 4 + i * 16, 34 - i * 6, 3);
        out.push(<path key={`d${i}`} class="paper ink" d={d} />, hatchShadow(ridge(r, horizon + i * 16 + 10, 8, 3), `ds${i}`));
      }
      out.push(palm(40 + r() * 280, H - 10, 1.1, 'pa'));
      break;
    case 'tundra':
      out.push(...hills(r, horizon + 4, 16, 1), ...tufts(r, horizon + 20, H - 4, 10));
      for (let i = 0; i < 5; i++) out.push(conifer(r() * W, horizon + 22 + r() * 30, 0.6, `c${i}`));
      break;
  }
  if (coastal) {
    out.push(<rect key="sea" class="paper" x={f(land)} y={f(horizon + 2)} width={W} height={H} />, ...waves(horizon + 8, H, r).filter((w) => {
      const m = /M([\d.]+)/.exec((w.props as { d: string }).d);
      return m ? Number(m[1]) > land + 6 : false;
    }), <path key="shore" class="ink" d={`M${f(land)},${f(horizon + 2)} q12,20 -4,${f(H - horizon)}`} />, ship(land + 30 + r() * Math.max(10, W - land - 60), horizon + 26));
  }
  return out;
}

export function TerrainVignette({ terrain, kind, coastal, seed }: { terrain?: Terrain; kind: ProvinceKind; coastal: boolean; seed: number }) {
  const r = rng(seed * 2654435761);
  return (
    <svg class="vignette" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <pattern id="vg-hatch" width="3" height="3" patternUnits="userSpaceOnUse" patternTransform="rotate(-35)">
          <line x1="0" y1="0" x2="0" y2="3" class="ink thin" />
        </pattern>
      </defs>
      <rect class="paper" width={W} height={H} />
      {sky(r)}
      {scene(terrain, kind, coastal, r)}
    </svg>
  );
}
