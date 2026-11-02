"""
Gives real names to provinces that only have numbered placeholders ("Tura 7", "Pacific Ocean 12"), without touching
their shapes, ids or colours. Run after tools/opengs_map.py:  py -3.12 -I tools/name_provinces.py .

Land, wasteland and mountains: the biggest town inside (GeoNames cities1000 in tools/vendor/geonames/, if present),
a major river through it ("Niger Valley"), the Natural Earth geography region, the district (geoBoundaries) or
region (Natural Earth admin-1), each with a qualifier ("North-West", "Upper", ...) when a neighbour has it already.
Sea zones: "Coast of X" after the nearest named land, or "<ocean> off X" in open water. Names written in capitals
by the sources are title-cased everywhere.
Province keys change with the names; nothing else refers to numbered keys (realms use lat/lon places).
"""
import json
import math
import re
import sys
import unicodedata
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage as ndi
from scipy.spatial import cKDTree

Image.MAX_IMAGE_PIXELS = None
ROOT = Path(sys.argv[1] if len(sys.argv) > 1 else '.')
MAP = ROOT / 'data' / 'map'
VENDOR = ROOT / 'tools' / 'vendor'
ROWS = 512
COAST_PX = 200        # sea zones whose centre lies within this of land (~280 km) are named after that coast
RIVER_RANK = 7        # rivers up to this Natural Earth rank name the provinces they cross
QUALIFIERS = ['North', 'North-East', 'East', 'South-East', 'South', 'South-West', 'West', 'North-West',
              'Central', 'Upper', 'Lower', 'Inner', 'Outer']
COMPASS = ['East', 'North-East', 'North', 'North-West', 'West', 'South-West', 'South', 'South-East']
PLACEHOLDER = re.compile(r'_\d+$')


def log(msg):
    print(msg, flush=True)


def tidy(name):
    """Natural Earth and some districts spell names in capitals ("DECCAN PLATEAU"): title-case those words."""
    words = name.split(' ')
    for i, w in enumerate(words):
        if len(w) >= 4 and w.isupper() or (w.isupper() and len(w) > 1 and any(len(v) >= 4 and v.isupper() for v in words)):
            words[i] = w.capitalize() if i == 0 or w not in ('OF', 'THE', 'AND') else w.lower()
    return ' '.join(words)


def slugify(s):
    s = unicodedata.normalize('NFKD', s).encode('ascii', 'ignore').decode()
    return re.sub(r'[^a-z0-9]+', '_', s.lower()).strip('_')


# ---------- definitions, projection, id raster ----------
DEF_RE = re.compile(r'^- \{ id: (\d+), key: ([\w-]+), name: "((?:[^"\\]|\\.)*)", kind: (\w+), color: "#([0-9a-fA-F]{6})" \}$')
lines = (MAP / 'definitions.yaml').read_text(encoding='utf8').splitlines()
defs = {}  # id -> dict, plus the line index to rewrite
for i, line in enumerate(lines):
    m = DEF_RE.match(line)
    if m:
        defs[int(m[1])] = {'line': i, 'key': m[2], 'name': m[3], 'kind': m[4], 'color': int(m[5], 16)}
n = max(defs) + 1
proj = {}
for line in (MAP / 'projection.yaml').read_text(encoding='utf8').splitlines():
    m = re.match(r'^(\w+):\s*(-?[\d.]+)', line)
    if m:
        proj[m[1]] = float(m[2])
cos_sp = math.cos(math.radians(proj['standardParallel']))
scale = proj['width'] / ((proj['east'] - proj['west']) * cos_sp)


def to_pixel(lat, lon):
    return (lon - proj['west']) * cos_sp * scale, (proj['north'] - lat) * scale


def to_lonlat(x, y):
    return x / (cos_sp * scale) + proj['west'], proj['north'] - y / scale


img = np.asarray(Image.open(MAP / 'provinces.png').convert('RGB'))
H, W = img.shape[:2]
ids_sorted = np.array(sorted(defs, key=lambda i: defs[i]['color']))
colors_sorted = np.array([defs[i]['color'] for i in ids_sorted], np.int64)
pmap = np.empty((H, W), np.uint16)
for y0 in range(0, H, ROWS):
    c = img[y0:y0 + ROWS].astype(np.int64)
    code = (c[..., 0] << 16) | (c[..., 1] << 8) | c[..., 2]
    pmap[y0:y0 + ROWS] = ids_sorted[np.clip(np.searchsorted(colors_sorted, code), 0, len(ids_sorted) - 1)]
del img
sums = np.zeros((3, n))
for y0 in range(0, H, ROWS):
    ids = pmap[y0:y0 + ROWS].ravel()
    ys, xs = np.divmod(np.arange(len(ids)), W)
    sums[0] += np.bincount(ids, minlength=n)
    sums[1] += np.bincount(ids, xs, n)
    sums[2] += np.bincount(ids, ys + y0, n)
cx, cy = sums[1] / np.maximum(sums[0], 1), sums[2] / np.maximum(sums[0], 1)

todo = [i for i, d in defs.items() if PLACEHOLDER.search(d['key'])]
used = {d['key'] for d in defs.values()}  # numbered keys stay reserved: the ones left unnamed keep theirs
log(f'{len(defs)} provinces, {len(todo)} with numbered names')


def interior(pid):
    """A pixel of the province near its centre (the centroid itself may fall outside a curved province)."""
    x, y = int(cx[pid]), int(cy[pid])
    if pmap[y, x] == pid:
        return x, y
    r = 80
    win = pmap[max(y - r, 0):y + r + 1, max(x - r, 0):x + r + 1]
    yy, xx = np.nonzero(win == pid)
    if not len(yy):
        return x, y
    k = np.argmin((yy + max(y - r, 0) - y) ** 2 + (xx + max(x - r, 0) - x) ** 2)
    return int(xx[k] + max(x - r, 0)), int(yy[k] + max(y - r, 0))


# ---------- name sources ----------
towns = {}  # pid -> [(population, name)]
geonames = VENDOR / 'geonames' / 'cities1000.txt'
if geonames.exists():
    for line in geonames.read_text(encoding='utf8').splitlines():
        f = line.split('\t')
        if len(f) < 15:
            continue
        x, y = to_pixel(float(f[4]), float(f[5]))
        xi, yi = int(x), int(y)
        if 0 <= xi < W and 0 <= yi < H:
            towns.setdefault(int(pmap[yi, xi]), []).append((int(f[14] or 0), f[1]))
    for v in towns.values():
        v.sort(reverse=True)
    log(f'GeoNames towns in {len(towns)} provinces')

river_at = {}  # pid -> river names, biggest first
rivers = json.loads((ROOT / 'public' / 'generated' / 'rivers.json').read_text(encoding='utf8'))
for r in sorted(rivers, key=lambda r: r['rank']):
    if not r['name'] or r['rank'] > RIVER_RANK:
        continue
    for line in r['lines']:
        for k in range(0, len(line) - 1, 2):
            xi, yi = int(line[k]), int(line[k + 1])
            if 0 <= xi < W and 0 <= yi < H:
                lst = river_at.setdefault(int(pmap[yi, xi]), [])
                if r['name'] not in lst:
                    lst.append(r['name'])

SUFFIX = re.compile(r'\s+(municipal district|district|municipality|raion|rayon|county|province|prefecture|governorate|'
                    r'region|oblast|krai|kray|okrug|department|sub-district|subdistrict|kommune|landkreis|ilçesi)$', re.I)


class Areas:
    """Named polygons, searched by point."""

    def __init__(self):
        self.items, self.boxes = [], []

    def add(self, path, field, keep=lambda props: True):
        if not path.exists():
            return
        for f in json.loads(path.read_text(encoding='utf8'))['features']:
            g = f['geometry']
            if not g or not keep(f['properties']):
                continue
            polys = [g['coordinates']] if g['type'] == 'Polygon' else g['coordinates'] if g['type'] == 'MultiPolygon' else []
            name = SUFFIX.sub('', (f['properties'].get(field) or '').strip())
            name = re.sub(r'\bPlat\.', 'Plateau', re.sub(r'\bMts\.', 'Mountains', name))
            if not name or '�' in name:
                continue
            for poly in polys:
                ring = np.asarray(poly[0], np.float64)[:, :2]
                if len(ring) > 2:
                    self.items.append((name, ring))
                    self.boxes.append((*ring.min(0), *ring.max(0)))

    def at(self, lon, lat):
        if not self.boxes:
            return []
        b = np.asarray(self.boxes)
        cand = np.nonzero((b[:, 0] <= lon) & (b[:, 2] >= lon) & (b[:, 1] <= lat) & (b[:, 3] >= lat))[0]
        return [self.items[i][0] for i in cand if inside(lon, lat, self.items[i][1])]


def inside(lon, lat, ring):
    x0, y0 = ring[:, 0], ring[:, 1]
    x1, y1 = np.roll(x0, -1), np.roll(y0, -1)
    cross = ((y0 > lat) != (y1 > lat)) & (lon < (x1 - x0) * (lat - y0) / np.where(y1 == y0, 1e-30, y1 - y0) + x0)
    return bool(cross.sum() % 2)


districts, regions, wilds, ranges = Areas(), Areas(), Areas(), Areas()
for path in sorted((VENDOR / 'geoboundaries').glob('*.geojson')) if (VENDOR / 'geoboundaries').exists() else []:
    districts.add(path, 'shapeName')
regions.add(VENDOR / 'ne_10m_admin_1_states_provinces.geojson', 'name')
GEO = VENDOR / 'ne_10m_geography_regions_polys.geojson'
wilds.add(GEO, 'NAME', lambda p: p['FEATURECLA'] in ('Desert', 'Plateau', 'Basin', 'Plain', 'Lowland', 'Tundra',
                                                   'Depression', 'Wetlands', 'Geoarea', 'Valley', 'Delta'))
ranges.add(GEO, 'NAME', lambda p: p['FEATURECLA'] in ('Range/mtn', 'Plateau', 'Foothills'))

holder_of = {}  # key -> province that has it, for placing qualifiers
for i, d in defs.items():
    if i not in set(todo):
        holder_of.setdefault(d['key'], i)


def take(pid, key, name):
    defs[pid]['key'], defs[pid]['name'] = key, name
    used.add(key)
    holder_of[key] = pid


def name_from(pid, candidates):
    """First candidate that is free; else free with a compass word (towards this province from the holder) or another
    qualifier. Returns False when nothing fits."""
    for name in candidates:
        key = slugify(name)
        if key and key not in used:
            take(pid, key, name)
            return True
    for name in candidates:
        other = holder_of.get(slugify(name))
        order = list(QUALIFIERS)
        if other is not None:
            ang = math.degrees(math.atan2(cy[other] - cy[pid], cx[pid] - cx[other])) % 360
            best = COMPASS[int(round(ang / 45)) % 8]
            order.remove(best)
            order.insert(0, best)
        for q in order:
            label = f'{q} {name}'
            if slugify(label) not in used:
                take(pid, slugify(label), label)
                return True
    return False


# ---------- land, wasteland and mountains ----------
left = []
for pid in todo:
    kind = defs[pid]['kind']
    if kind == 'sea' or kind == 'lake':
        left.append(pid)
        continue
    x, y = interior(pid)
    lon, lat = to_lonlat(x + 0.5, y + 0.5)
    cands = [t for _, t in towns.get(pid, [])[:5]]
    if kind == 'land':
        cands += [f'{r} Valley' for r in river_at.get(pid, [])] + districts.at(lon, lat) + wilds.at(lon, lat) + regions.at(lon, lat)
    elif kind == 'wasteland':
        cands += wilds.at(lon, lat) + [f'{r} Wastes' for r in regions.at(lon, lat)]
    else:
        cands += ranges.at(lon, lat) + [f'{r} Mountains' for r in regions.at(lon, lat)]
    if not name_from(pid, cands):
        left.append(pid)

# ---------- seas and lakes: after the coast they face ----------
named_land = [i for i, d in defs.items() if d['kind'] == 'land' and not PLACEHOLDER.search(d['key'])]
tree = cKDTree(np.stack([cx[named_land], cy[named_land]], 1))
still = []
for pid in left:
    d = defs[pid]
    if d['kind'] not in ('sea', 'lake'):
        still.append(pid)
        continue
    dist, k = tree.query([cx[pid], cy[pid]])
    coast = defs[named_land[k]]['name']
    base = re.sub(r'( \d+)+$', '', d['name'])
    cands = [f'Coast of {coast}'] if dist < COAST_PX else [f'{base} off {coast}']
    if d['kind'] == 'lake':
        cands = [f'Lake near {coast}']
    if not name_from(pid, cands):
        still.append(pid)

named = len(todo) - len(still)
tidied = 0
for pid, d in defs.items():
    if tidy(d['name']) != d['name']:
        d['name'] = tidy(d['name'])
        tidied += 1
        if pid not in todo:
            todo.append(pid)  # rewrite its line too (the key is lower case already)
log(f'{tidied} names taken out of capitals')

for pid in todo:
    d = defs[pid]
    lines[d['line']] = f'- {{ id: {pid}, key: {d["key"]}, name: {json.dumps(d["name"], ensure_ascii=False)}, kind: {d["kind"]}, color: "#{d["color"]:06x}" }}'
(MAP / 'definitions.yaml').write_text('\n'.join(lines) + '\n', encoding='utf8', newline='\n')
log(f'{named} provinces named, {len(still)} keep a number')
