"""Regenerates the province map with the method of the OpenGS Map Tool (MIT, github.com/Thomas-Holtvedt/opengs-maptool):
density-weighted random seeds, Lloyd relaxation, then every pixel goes to its nearest seed inside its own connected
area, with noise on the pixel coordinates for jagged borders. Lakes stay one province each.

OpenGS works on whole-image arrays (and needs PyQt), which does not fit a 215-megapixel world map in memory, so the
same steps are rewritten here to work in row chunks.

Input is the current data/map/provinces.png + definitions.yaml: their kinds give the coastline, lakes, wasteland and
mountains, the old province sizes give the density (small old provinces = more new ones), and old names are carried
over to the new province that overlaps them most. Rerunning on its own output keeps all of that.

Run: npm run opengs-map   (Python 3.12 with numpy, scipy, pillow; ~10 GB RAM)
"""
import math
import re
import sys
import time
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage as ndi
from scipy.spatial import cKDTree

Image.MAX_IMAGE_PIXELS = None
ROOT = Path(sys.argv[1] if len(sys.argv) > 1 else '.')
MAP = ROOT / 'data' / 'map'

SEA, LAND, WASTE, MOUNT, LAKE = 0, 1, 2, 3, 4
KINDS = {'sea': SEA, 'land': LAND, 'wasteland': WASTE, 'mountain': MOUNT, 'lake': LAKE}
KIND_NAME = {v: k for k, v in KINDS.items()}

F = 8                 # coarse grid cell, px (density and noise amplitude live on it)
ROWS = 512            # rows per processing chunk
DENSITY_BLUR = 4      # coarse cells (~45 km)
LLOYD_ITERATIONS = 4  # as OpenGS
JAGGED = 0.3          # noise amplitude as a fraction of local seed spacing (OpenGS: 0.12 of a single-octave field)
NOISE_OCTAVES = [(128, 0.55), (32, 0.3), (8, 0.15)]  # (period px, weight)
MOUNT_AREA = 20_000   # px per mountain province
SEA_COUNT = 1600
LAND_COUNT = 10_000
MAX_LAND_AREA = 12_000  # px (~24,000 km2): no land province is planned bigger, so deserts and steppes stay playable
SEA_COAST_BOOST = 2.0  # seas near land get up to 3x the province density
ISLAND_SHARE = 0.25   # a seedless island gets its own province above this share of a local province's area
MIN_ISLAND = 150      # px

# Deserts and "wilds" are plain land: no wasteland, oasis strips or corridors. The old wasteland provinces were big, so
# the density keeps desert provinces large.
DESERTS_AS_LAND = True


def kind_of_name(name):
    kind = KINDS[name]
    return LAND if DESERTS_AS_LAND and kind == WASTE else kind


rng = np.random.default_rng(1302)
t0 = time.time()


def log(msg):
    print(f'[{time.time() - t0:6.0f}s] {msg}', flush=True)


# ---------- inputs ----------
DEF_RE = re.compile(r'id:\s*(\d+),\s*key:\s*([\w-]+),\s*name:\s*"((?:[^"\\]|\\.)*)",\s*kind:\s*(\w+),\s*color:\s*"#([0-9a-fA-F]{6})"')
defs = []
for line in (MAP / 'definitions.yaml').read_text(encoding='utf8').splitlines():
    if line.startswith('- {'):
        m = DEF_RE.search(line)
        if not m:
            sys.exit(f'Cannot parse definitions line: {line}')
        defs.append({'key': m[2], 'name': m[3].replace('\\"', '"'), 'kind': kind_of_name(m[4]), 'color': int(m[5], 16)})
n_old = len(defs)
log(f'{n_old} old provinces')

proj = {}
for line in (MAP / 'projection.yaml').read_text(encoding='utf8').splitlines():
    m = re.match(r'(\w+):\s*(-?[\d.]+)', line)
    if m:
        proj[m[1]] = float(m[2])
cos_sp = math.cos(math.radians(proj['standardParallel']))
scale = proj['width'] / ((proj['east'] - proj['west']) * cos_sp)


def to_pixel(lat, lon):
    return (lon - proj['west']) * cos_sp * scale, (proj['north'] - lat) * scale


SEED_RE = re.compile(r'^\s*-\s*\[\s*([\w-]+)\s*,\s*(?:"([^"]*)"|([^,]*?))\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)')
town_seeds = []  # (key, name, kind, x, y)
for f in ('seeds.yaml', 'seeds-world.yaml'):
    section = None
    for line in (MAP / f).read_text(encoding='utf8').splitlines():
        top = re.match(r'^(\w+):\s*$', line)
        if top:
            section = top[1]
            continue
        m = SEED_RE.match(line)
        if m and section in ('land', 'sea', 'wasteland'):
            x, y = to_pixel(float(m[4]), float(m[5]))
            town_seeds.append((m[1], (m[2] if m[2] is not None else m[3]).strip(), kind_of_name(section), x, y))

# ---------- old map -> old id and kind rasters ----------
img = np.asarray(Image.open(MAP / 'provinces.png').convert('RGB'))
H, W = img.shape[:2]
log(f'map {W}x{H}')
colors = np.array([d['color'] for d in defs], np.int64)
order = np.argsort(colors)
sorted_colors = colors[order]
old_id = np.empty((H, W), np.uint16)  # 1-based index into defs
for y0 in range(0, H, ROWS):
    c = img[y0:y0 + ROWS].astype(np.int32)
    code = (c[..., 0] << 16) | (c[..., 1] << 8) | c[..., 2]
    pos = np.clip(np.searchsorted(sorted_colors, code), 0, n_old - 1)
    bad = sorted_colors[pos] != code
    if bad.any():
        yy, xx = np.argwhere(bad)[0]
        sys.exit(f'Undefined colour #{code[yy, xx]:06x} at ({xx}, {y0 + yy})')
    old_id[y0:y0 + ROWS] = order[pos] + 1
del img
old_kind = np.array([0] + [d['kind'] for d in defs], np.uint8)
cls = old_kind[old_id]

# Channels too narrow for the coastline data at this scale, cut as sea so provinces cannot straddle them.
CHANNELS = {'Bosporus': [(41.22, 29.10), (41.12, 29.06), (41.03, 29.00)]}
for points in CHANNELS.values():
    for (la0, lo0), (la1, lo1) in zip(points, points[1:]):
        (x0, y0), (x1, y1) = to_pixel(la0, lo0), to_pixel(la1, lo1)
        for t in np.linspace(0, 1, int(max(abs(x1 - x0), abs(y1 - y0)) * 2) + 2):
            x, y = int(round(x0 + (x1 - x0) * t)), int(round(y0 + (y1 - y0) * t))
            cls[y - 1:y + 2, x - 1:x + 2] = np.where(cls[y - 1:y + 2, x - 1:x + 2] == LAKE, LAKE, SEA)
old_area = np.bincount(old_id.ravel(), minlength=n_old + 1)

HC, WC = -(-H // F), -(-W // F)


def block_sum(get):
    """Sums get(y0, y1) (an (y1-y0, W) array) over F x F cells."""
    out = np.zeros((HC, WC), np.float64)
    step = F * 64
    for y0 in range(0, H, step):
        a = get(y0, min(H, y0 + step)).astype(np.float64)
        a = np.pad(a, ((0, (-a.shape[0]) % F), (0, WC * F - W)))
        out[y0 // F:y0 // F + a.shape[0] // F] = a.reshape(-1, F, WC, F).sum(axis=(1, 3))
    return out


# ---------- densities (seeds per pixel, on the coarse grid) ----------
def smooth_ratio(num, den):
    return ndi.gaussian_filter(num, DENSITY_BLUR) / np.maximum(ndi.gaussian_filter(den, DENSITY_BLUR), 1e-9)


inv_area = np.zeros(n_old + 1, np.float64)
inv_area[1:] = 1.0 / np.maximum(old_area[1:], 1)
land_count = block_sum(lambda a, b: cls[a:b] == LAND)
land_dens = smooth_ratio(block_sum(lambda a, b: np.where(cls[a:b] == LAND, inv_area[old_id[a:b]], 0)), land_count)

sea_count = block_sum(lambda a, b: cls[a:b] == SEA)
coast_dist = ndi.distance_transform_edt(sea_count >= F * F * 0.999)  # coarse cells to the nearest land
sea_weight = 1 + SEA_COAST_BOOST * np.exp(-coast_dist / 30)
sea_dens = sea_weight * SEA_COUNT / (sea_weight * sea_count).sum()


# ---------- generation ----------
NOISE = [(p, w, rng.uniform(-1, 1, (H // p + 2, W // p + 2)).astype(np.float32),
          rng.uniform(-1, 1, (H // p + 2, W // p + 2)).astype(np.float32)) for p, w in NOISE_OCTAVES]


def jitter(xs, ys, amp):
    jx = np.zeros(len(xs), np.float32)
    jy = np.zeros(len(xs), np.float32)
    for p, w, gx, gy in NOISE:
        fx, fy = xs / p, ys / p
        i, j = fx.astype(np.int64), fy.astype(np.int64)
        tx, ty = (fx - i).astype(np.float32), (fy - j).astype(np.float32)
        for g, out in ((gx, jx), (gy, jy)):
            top = g[j, i] * (1 - tx) + g[j, i + 1] * tx
            bot = g[j + 1, i] * (1 - tx) + g[j + 1, i + 1] * tx
            out += w * (top * (1 - ty) + bot * ty)
    return jx * amp, jy * amp


def sample(cell_weight, mask, n):
    """n pixels of mask, drawn with probability proportional to the coarse cell weight (per pixel)."""
    p = cell_weight.ravel() / cell_weight.sum()
    got = []
    have = 0
    while have < n:
        k = int((n - have) * 1.5) + 64
        cells = rng.choice(p.size, k, p=p)
        y = (cells // WC) * F + rng.integers(0, F, k)
        x = (cells % WC) * F + rng.integers(0, F, k)
        ok = (y < H) & (x < W)
        x, y = x[ok], y[ok]
        ok = mask[y, x]
        got.append(np.stack([x[ok], y[ok]], 1))
        have += int(ok.sum())
    return np.concatenate(got)[:n]


def group(values):
    """(value, indices) for each distinct value."""
    o = np.argsort(values, kind='stable')
    u, starts = np.unique(values[o], return_index=True)
    ends = np.append(starts[1:], len(o))
    return [(v, o[s:e]) for v, s, e in zip(u, starts, ends)]


def lloyd(seeds, seed_comp, labels, samples):
    """OpenGS's relaxation, but per connected area and with density-weighted samples, so the density survives."""
    seeds = seeds.astype(np.float64)
    samp_comp = labels[samples[:, 1], samples[:, 0]]
    by_comp = dict(group(seed_comp))
    sample_groups = [(c, idx) for c, idx in group(samp_comp) if c in by_comp and len(by_comp[c]) > 1]
    for _ in range(LLOYD_ITERATIONS):
        for c, sidx in sample_groups:
            idx = by_comp[c]
            pts = samples[sidx]
            _, lab = cKDTree(seeds[idx]).query(pts, workers=-1)
            cnt = np.bincount(lab, minlength=len(idx))
            ok = cnt > 0
            nx = np.bincount(lab, pts[:, 0], len(idx))[ok] / cnt[ok]
            ny = np.bincount(lab, pts[:, 1], len(idx))[ok] / cnt[ok]
            inside = labels[np.rint(ny).astype(np.int64), np.rint(nx).astype(np.int64)] == c
            moved = idx[ok][inside]
            seeds[moved, 0] = nx[inside]
            seeds[moved, 1] = ny[inside]
    return seeds


pmap = np.zeros((H, W), np.int32)
new_kind = [0]  # kind per new id; id 0 unused


def generate(kind, dens):
    """Fills pmap for one kind. dens: seeds per pixel on the coarse grid."""
    mask = cls == kind
    labels, ncomp = ndi.label(mask)
    sizes = np.bincount(labels.ravel(), minlength=ncomp + 1)
    count = block_sum(lambda a, b: mask[a:b])
    cell_weight = np.where(count > 0, dens, 0)
    n = max(1, int(round((dens * count).sum())))
    seeds = sample(cell_weight, mask, n)
    seed_comp = labels[seeds[:, 1], seeds[:, 0]]

    # Islands and other areas big enough for their own province but without a seed get one in their middle.
    has = np.zeros(ncomp + 1, bool)
    has[seed_comp] = True
    objs = ndi.find_objects(labels)
    extra = []
    for c in np.nonzero(~has)[0][1:]:
        sl = objs[c - 1]
        ys, xs = np.nonzero(labels[sl] == c)
        ys, xs = ys + sl[0].start, xs + sl[1].start
        local_area = 1.0 / max(dens[ys[0] // F, xs[0] // F], 1e-12)
        # Mountains and wasteland always get their own: the nearest seed elsewhere may be far away.
        if sizes[c] >= max(MIN_ISLAND, ISLAND_SHARE * local_area if kind == LAND else 0):
            k = np.argmin((xs - xs.mean()) ** 2 + (ys - ys.mean()) ** 2)
            extra.append((xs[k], ys[k]))
    if extra:
        seeds = np.concatenate([seeds, np.array(extra, np.int64)])
        seed_comp = labels[seeds[:, 1], seeds[:, 0]]
    log(f'{KIND_NAME[kind]}: {len(seeds)} seeds ({len(extra)} for islands), {ncomp} areas')

    samples = sample(cell_weight, mask, int(min(max(150 * len(seeds), 1_000_000), 6_000_000)))
    seeds = lloyd(seeds, seed_comp, labels, samples)
    del samples
    spacing = 1.0 / np.sqrt(np.maximum(dens, 1e-12))

    first = len(new_kind)
    new_kind.extend([kind] * len(seeds))
    trees = {c: (cKDTree(seeds[idx]), idx) for c, idx in group(seed_comp)}
    everything = (cKDTree(seeds), np.arange(len(seeds)))  # for small seedless areas
    for y0 in range(0, H, ROWS):
        ys, xs = np.nonzero(mask[y0:y0 + ROWS])
        if not len(ys):
            continue
        ys += y0
        jx, jy = jitter(xs, ys, (JAGGED * spacing[ys // F, xs // F]).astype(np.float32))
        q = np.stack([xs + jx, ys + jy], 1)
        out = np.empty(len(ys), np.int32)
        for c, idx in group(labels[ys, xs]):
            tree, ids = trees.get(c, everything)
            _, k = tree.query(q[idx], workers=-1)
            out[idx] = ids[k]
        pmap[ys, xs] = out + first
    log(f'{KIND_NAME[kind]}: assigned')


def land_plan(k):
    return np.maximum(land_dens * k, 1.0 / MAX_LAND_AREA)


lo, hi = 0.0, 100.0  # scale the old density so that, with the size cap, LAND_COUNT provinces are planned
for _ in range(60):
    mid = (lo + hi) / 2
    lo, hi = (mid, hi) if (land_plan(mid) * land_count).sum() < LAND_COUNT else (lo, mid)
generate(LAND, land_plan(hi))
generate(MOUNT, np.full((HC, WC), 1.0 / MOUNT_AREA))
generate(SEA, sea_dens)

# Lakes: one province per old lake, unchanged.
lake_new = np.zeros(n_old + 1, np.int32)
for i, d in enumerate(defs, 1):
    if d['kind'] == LAKE:
        lake_new[i] = len(new_kind)
        new_kind.append(LAKE)
for y0 in range(0, H, ROWS):
    sl = slice(y0, y0 + ROWS)
    lk = cls[sl] == LAKE
    pmap[sl][lk] = lake_new[old_id[sl][lk]]
assert (pmap > 0).all(), 'unassigned pixels'

# ---------- enclaves: pieces cut off by the noise go to the neighbour they touch most ----------
kind_of = np.array(new_kind, np.uint8)
moved = 0
for pid, sl in enumerate(ndi.find_objects(pmap), 1):
    if sl is None or kind_of[pid] == LAKE:
        continue
    sl = tuple(slice(max(s.start - 1, 0), s.stop + 1) for s in sl)
    win = pmap[sl]
    lab, n = ndi.label(win == pid)
    if n <= 1:
        continue
    sizes = np.bincount(lab.ravel())
    sizes[0] = 0
    main = sizes.argmax()
    for part in range(1, n + 1):
        if part == main:
            continue
        frag = lab == part
        ring = ndi.binary_dilation(frag) & ~frag
        nb = win[ring]
        nb = nb[(kind_of[nb] == kind_of[pid]) & (nb != pid)]
        if len(nb):
            vals, cnts = np.unique(nb, return_counts=True)
            win[frag] = vals[cnts.argmax()]
            moved += 1
log(f'{moved} enclaves merged')

# ---------- compact ids ----------
present = np.bincount(pmap.ravel(), minlength=len(new_kind)) > 0
present[0] = False
remap = np.zeros(len(new_kind), np.int32)
remap[present] = np.arange(1, present.sum() + 1)
for y0 in range(0, H, ROWS):
    pmap[y0:y0 + ROWS] = remap[pmap[y0:y0 + ROWS]]
kind_of = kind_of[present]
lake_new = remap[lake_new]
n_new = len(kind_of)
log(f'{n_new} provinces: ' + ', '.join(f'{KIND_NAME[k]} {(kind_of == k).sum()}' for k in KIND_NAME))

# ---------- names: old province with the most overlap, then towns inside, then numbered ----------
codes, counts = [], []
for y0 in range(0, H, ROWS):
    c = pmap[y0:y0 + ROWS].astype(np.int64) * (n_old + 1) + old_id[y0:y0 + ROWS]
    u, k = np.unique(c, return_counts=True)
    codes.append(u)
    counts.append(k)
u, inv = np.unique(np.concatenate(codes), return_inverse=True)
overlap = np.bincount(inv, np.concatenate(counts)).astype(np.int64)
pair_new, pair_old = u // (n_old + 1), u % (n_old + 1)

names = [None] * (n_new + 1)
keys = [None] * (n_new + 1)
used = set()


def take(pid, key, name):
    names[pid], keys[pid] = name, key
    used.add(key)


old_index = {d['key']: i for i, d in enumerate(defs, 1)}
for i, d in enumerate(defs, 1):
    if d['kind'] == LAKE and lake_new[i]:
        take(lake_new[i], d['key'], d['name'])
# A province holding a seed town takes its name first (the old province's spelling if it had one), so towns such as
# Constantinople are never lost to a bigger neighbour's overlap. town_at remembers where each town ended up.
town_at = {}
for key, name, kind, x, y in town_seeds:
    xi, yi = int(x), int(y)
    if 0 <= xi < W and 0 <= yi < H:
        pid = int(pmap[yi, xi])
        if kind != kind_of[pid - 1]:
            continue
        town_at.setdefault(key, pid)
        if names[pid] is None and key not in used:
            take(pid, key, defs[old_index[key] - 1]['name'] if key in old_index else name)
for k in np.argsort(-overlap, kind='stable'):
    pid, oid = pair_new[k], pair_old[k]
    d = defs[oid - 1]
    if names[pid] is None and d['key'] not in used and d['kind'] == kind_of[pid - 1]:
        take(pid, d['key'], d['name'])
best_old = {}
for k in np.argsort(-overlap, kind='stable'):
    best_old.setdefault(int(pair_new[k]), int(pair_old[k]))
numbered = 0
for pid in range(1, n_new + 1):
    if names[pid] is None:
        d = defs[best_old[pid] - 1]
        n = 2
        while f"{d['key']}_{n}" in used:
            n += 1
        take(pid, f"{d['key']}_{n}", f"{d['name']} {n}")
        numbered += 1
log(f'{numbered} provinces got a numbered name')

# ---------- colours (OpenGS palettes per type) and output ----------
palette = np.zeros((n_new + 1, 3), np.uint8)
taken = set()
for pid in range(1, n_new + 1):
    r = np.random.default_rng(pid)
    while True:
        kind = kind_of[pid - 1]
        if kind == SEA:
            c = (r.integers(0, 60), r.integers(0, 80), r.integers(100, 256))
        elif kind == LAKE:
            c = (r.integers(0, 80), r.integers(80, 180), r.integers(100, 200))
        elif kind in (WASTE, MOUNT):
            g = r.integers(60, 160)
            c = (g + r.integers(-8, 9), g + r.integers(-8, 9), g + r.integers(-8, 9))
        else:
            c = tuple(r.integers(0, 256, 3))
        c = tuple(int(v) for v in c)
        if c not in taken:
            taken.add(c)
            palette[pid] = c
            break

rgb = np.empty((H, W, 3), np.uint8)
for y0 in range(0, H, ROWS):
    rgb[y0:y0 + ROWS] = palette[pmap[y0:y0 + ROWS]]
Image.fromarray(rgb, 'RGB').save(MAP / 'provinces.png', compress_level=6)
del rgb
log('provinces.png written')

lines = ['# Province definitions: one entry per colour in provinces.png. kind: land | sea | wasteland | mountain | lake.',
         '# Generated by tools/opengs_map.py (OpenGS method); names carried over from the previous map. Safe to edit names.']
for pid in range(1, n_new + 1):
    name = names[pid].replace('"', '\\"')
    hexc = '#%02x%02x%02x' % tuple(palette[pid])
    lines.append(f'- {{ id: {pid}, key: {keys[pid]}, name: "{name}", kind: {KIND_NAME[kind_of[pid - 1]]}, color: "{hexc}" }}')
(MAP / 'definitions.yaml').write_text('\n'.join(lines) + '\n', encoding='utf8', newline='\n')

# Straits: each end keeps its key if a province still has it, else moves to the province holding its town, else to the
# one holding most of the old province.
holder = {}
for k in np.argsort(-overlap, kind='stable'):
    oid, pid = int(pair_old[k]), int(pair_new[k])
    if oid not in holder and kind_of[pid - 1] == defs[oid - 1]['kind']:
        holder[oid] = pid
out = []
for line in (MAP / 'straits.yaml').read_text(encoding='utf8').splitlines():
    m = re.match(r'^(\s*-\s*\[)\s*([\w-]+)\s*,\s*([\w-]+)\s*(\].*)$', line)
    if m:
        a, b = (k if k in used else keys[town_at[k]] if k in town_at else keys[holder[old_index[k]]]
                for k in (m[2], m[3]))
        if a == b:
            print(f'strait {m[2]} - {m[3]} now inside one province ({a}), dropped')
            continue
        line = f'{m[1]}{a}, {b}{m[4]}'
    out.append(line)
(MAP / 'straits.yaml').write_text('\n'.join(out) + '\n', encoding='utf8', newline='\n')
log('definitions.yaml and straits.yaml written')
