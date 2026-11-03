import type { Realm } from '../sim/state';

/**
 * Generated coats of arms: the field takes the realm's map colour, and the division, charge and metal follow from a
 * hash of the realm key, so every realm keeps the same arms across sessions. Islamic and steppe governments carry a
 * crescent or a tamga-like mark instead of Christian crosses.
 */

const OR = '#d4a531';
const ARGENT = '#efece2';
const SABLE = '#26201a';
const GULES = '#a3232b';

const SHIELD = 'M2,2 H98 V52 C98,84 74,100 50,110 C26,100 2,84 2,52 Z';

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12;
  return h >>> 0;
}

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
}

type Division = 'plain' | 'pale' | 'fess' | 'bend' | 'quarterly' | 'chief';
type Charge = 'none' | 'cross' | 'saltire' | 'chevron' | 'fess' | 'pale' | 'bend' | 'bordure' | 'roundels' | 'mullet' | 'crescent' | 'tamga';

const DIVISIONS: Division[] = ['plain', 'plain', 'pale', 'fess', 'bend', 'quarterly', 'chief'];
const CHRISTIAN: Charge[] = ['cross', 'saltire', 'chevron', 'fess', 'pale', 'bend', 'bordure', 'roundels', 'mullet', 'none'];
const ISLAMIC: Charge[] = ['crescent', 'crescent', 'mullet', 'fess', 'bordure', 'roundels'];
const STEPPE: Charge[] = ['tamga', 'tamga', 'crescent', 'mullet'];

function division(d: Division, metal: string) {
  switch (d) {
    case 'pale': return <rect x="50" y="0" width="50" height="112" fill={metal} />;
    case 'fess': return <rect x="0" y="56" width="100" height="56" fill={metal} />;
    case 'bend': return <path d="M0,0 L100,112 L0,112 Z" fill={metal} />;
    case 'quarterly': return <path d="M50,0 H100 V56 H50 Z M0,56 H50 V112 H0 Z" fill={metal} />;
    case 'chief': return <rect x="0" y="0" width="100" height="32" fill={metal} />;
    default: return null;
  }
}

function charge(c: Charge, tincture: string) {
  const s = { fill: tincture };
  switch (c) {
    case 'cross': return <path d="M42,0 H58 V46 H100 V62 H58 V112 H42 V62 H0 V46 H42 Z" {...s} />;
    case 'saltire': return <path d="M0,0 L50,46 L100,0 L100,14 L60,54 L100,94 L100,112 L50,64 L0,112 L0,94 L40,54 L0,14 Z" {...s} />;
    case 'chevron': return <path d="M0,86 L50,34 L100,86 L100,104 L50,52 L0,104 Z" {...s} />;
    case 'fess': return <rect x="0" y="44" width="100" height="22" {...s} />;
    case 'pale': return <rect x="39" y="0" width="22" height="112" {...s} />;
    case 'bend': return <path d="M0,10 L10,0 L100,96 L90,112 Z" {...s} />;
    case 'bordure': return <path d={`${SHIELD} M14,14 H86 V52 C86,76 68,90 50,97 C32,90 14,76 14,52 Z`} fill-rule="evenodd" {...s} />;
    case 'roundels': return <g {...s}><circle cx="30" cy="34" r="10" /><circle cx="70" cy="34" r="10" /><circle cx="50" cy="70" r="10" /></g>;
    case 'mullet': return <path d="M50,24 L57,46 L80,46 L61,60 L68,82 L50,68 L32,82 L39,60 L20,46 L43,46 Z" {...s} />;
    case 'crescent': return <path d="M66,30 A28,28 0 1 0 66,82 A22,22 0 1 1 66,30 Z" {...s} />;
    case 'tamga': return <path d="M30,28 H70 V40 H56 V62 L72,84 L62,92 L50,74 L38,92 L28,84 L44,62 V40 H30 Z" {...s} />;
    default: return null;
  }
}

export function CoatOfArms({ realm, size = 40 }: { realm: Pick<Realm, 'key' | 'color' | 'government'>; size?: number }) {
  const h = hash(realm.key);
  const dark = luminance(realm.color) < 0.55;
  const metal = (h >> 3) & 1 ? OR : ARGENT;
  const contrast = dark ? metal : (h >> 4) & 1 ? SABLE : GULES;
  const pool = realm.government === 'iqta_sultanate' || realm.government === 'beylik' ? ISLAMIC
    : realm.government === 'steppe_horde' ? STEPPE : CHRISTIAN;
  const div = DIVISIONS[h % DIVISIONS.length]!;
  const ch = pool[(h >>> 8) % pool.length]!;
  // A charge on a divided field takes the counter-colour: dark on metal, metal on the field.
  const chargeTincture = div === 'plain' ? contrast : dark ? SABLE : metal;
  const id = `arms-${realm.key}`;
  return (
    <svg class="arms" width={size} height={size * 1.12} viewBox="0 0 100 112" aria-hidden="true">
      <defs><clipPath id={id}><path d={SHIELD} /></clipPath></defs>
      <g clip-path={`url(#${id})`}>
        <rect width="100" height="112" fill={realm.color} />
        {div !== 'plain' && division(div, contrast)}
        {charge(ch, chargeTincture)}
        <path d="M2,2 H98 V40 C70,30 30,30 2,40 Z" fill="#fff" opacity="0.12" />
      </g>
      <path d={SHIELD} fill="none" stroke={SABLE} stroke-width="4" />
    </svg>
  );
}
