"""
Generates the lower tiers of the title hierarchy into data/map/titles.yaml: counties (about COUNTY_SIZE neighbouring
land provinces inside one administrative region, named after their main town) and duchies (Natural Earth admin-1
regions, English names; regions with one county merge into a neighbour, big ones split). Kingdoms, empires and
hegemonies are hand-made in data/content/titles.yaml. Reads public/generated/map.json, so run after build-map, and
again whenever province keys change:  py -3.12 -I tools/build_titles.py .
"""
import json
import math
import re
import sys
import unicodedata
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np
from scipy.cluster.vq import kmeans2

ROOT = Path(sys.argv[1] if len(sys.argv) > 1 else '.')
MAP = ROOT / 'data' / 'map'
VENDOR = ROOT / 'tools' / 'vendor'
COUNTY_SIZE = 5     # provinces per county
DUCHY_MAX = 8       # counties per duchy before an admin region is split
rng = np.random.default_rng(1314)

m = json.loads((ROOT / 'public' / 'generated' / 'map.json').read_text(encoding='utf8'))
proj = m['projection']
cos_sp = math.cos(math.radians(proj['standardParallel']))
scale = proj['width'] / ((proj['east'] - proj['west']) * cos_sp)
land = [p for p in m['provinces'] if p['kind'] == 'land']
by_id = {p['id']: p for p in land}
cx = np.array([p['centroid'][0] for p in land], np.float64)
cy = np.array([p['centroid'][1] for p in land], np.float64)
lon = cx / (cos_sp * scale) + proj['west']
lat = proj['north'] - cy / scale
index = {p['id']: i for i, p in enumerate(land)}

seed_keys = set(re.findall(r'^\s*-\s*\[\s*([\w-]+)\s*,', (MAP / 'seeds.yaml').read_text(encoding='utf8'), re.M))


SUFFIX = re.compile(r'\s+(municipal district|district|municipality|raion|rayon|county|province|prefecture|governorate|'
                    r'region|oblast|krai|kray|okrug|department|state|autonomous community|voivodeship|canton|'
                    r'autonomous region|metropolitan city|territory)$', re.I)


def slugify(s):
    s = unicodedata.normalize('NFKD', s).encode('ascii', 'ignore').decode()
    return re.sub(r'[^a-z0-9]+', '_', s.lower()).strip('_')


# ---------- admin-1 region of every land province (by its centre; strays take their neighbours' region)
region = np.full(len(land), -1)
regions = []  # (name, country code, country name)
for f in json.loads((VENDOR / 'ne_10m_admin_1_states_provinces.geojson').read_text(encoding='utf8'))['features']:
    g, pr = f['geometry'], f['properties']
    if not g:
        continue
    name = SUFFIX.sub('', (pr.get('name_en') or pr.get('name') or '').strip())
    if not name:
        continue
    rid = len(regions)
    regions.append((name, pr.get('adm0_a3') or '?', pr.get('admin') or '?'))
    for poly in [g['coordinates']] if g['type'] == 'Polygon' else g['coordinates']:
        ring = np.asarray(poly[0], np.float64)[:, :2]
        (x0, y0), (x1, y1) = ring.min(0), ring.max(0)
        cand = np.nonzero((lon >= x0) & (lon <= x1) & (lat >= y0) & (lat <= y1) & (region < 0))[0]
        if not len(cand):
            continue
        px, py = lon[cand], lat[cand]
        inside = np.zeros(len(cand), bool)
        xa, ya = ring[:, 0], ring[:, 1]
        xb, yb = np.roll(xa, -1), np.roll(ya, -1)
        for a1, b1, a2, b2 in zip(xa, ya, xb, yb):
            hit = ((b1 > py) != (b2 > py)) & (px < (a2 - a1) * (py - b1) / ((b2 - b1) or 1e-30) + a1)
            inside ^= hit
        region[cand[inside]] = rid
for _ in range(50):  # strays (islands, coast pixels outside the polygons) take a neighbour's region
    stray = np.nonzero(region < 0)[0]
    if not len(stray):
        break
    for i in stray:
        votes = Counter(region[index[a['id']]] for a in land[i]['adjacency'] if a['id'] in index and region[index[a['id']]] >= 0)
        if votes:
            region[i] = votes.most_common(1)[0][0]
for i in np.nonzero(region < 0)[0]:  # islands with no neighbour: the nearest province's region
    d = (cx - cx[i]) ** 2 + (cy - cy[i]) ** 2
    d[region < 0] = np.inf
    region[i] = region[int(np.argmin(d))]


def components(members):
    """Connected pieces (over land adjacency) of a set of province indices."""
    left, out = set(members), []
    while left:
        start = left.pop()
        comp, stack = [start], [start]
        while stack:
            for a in land[stack.pop()]['adjacency']:
                j = index.get(a['id'])
                if j is not None and j in left and a['border'] > 0:
                    left.discard(j)
                    comp.append(j)
                    stack.append(j)
        out.append(comp)
    return out


def split(members, size):
    """Splits a connected group into pieces of about `size`, each connected (stray bits join a neighbouring piece)."""
    k = max(1, round(len(members) / size))
    if k == 1:
        return [members]
    pts = np.stack([cx[members], cy[members]], 1)
    _, lab = kmeans2(pts, k, minit='++', seed=rng)
    groups = defaultdict(list)
    for j, l in zip(members, lab):
        groups[int(l)].append(j)
    owner = {}
    pieces = []
    for g in groups.values():
        comps = sorted(components(g), key=len, reverse=True)
        pieces.append(comps[0])
        for j in comps[0]:
            owner[j] = len(pieces) - 1
    orphans = [j for j in members if j not in owner]
    while orphans:
        rest = []
        for j in orphans:
            near = [owner[index[a['id']]] for a in land[j]['adjacency'] if a['id'] in index and index[a['id']] in owner]
            if near:
                owner[j] = Counter(near).most_common(1)[0][0]
                pieces[owner[j]].append(j)
            else:
                rest.append(j)
        if len(rest) == len(orphans):
            for j in rest:
                pieces.append([j])
                owner[j] = len(pieces) - 1
            break
        orphans = rest
    return [p for p in pieces if p]


# ---------- counties
used = set()


def unique(key):
    k, n = key, 2
    while k in used:
        k, n = f'{key}_{n}', n + 1
    used.add(k)
    return k


counties = []  # (key, name, capital index, member indices, region id)
by_region = defaultdict(list)
for i, r in enumerate(region):
    by_region[int(r)].append(i)
for rid, members in by_region.items():
    for comp in components(members):
        for piece in split(comp, COUNTY_SIZE):
            # The capital: a historical seed town if the county has one, else its biggest province.
            capital = max(piece, key=lambda j: (land[j]['key'] in seed_keys, land[j]['pixels']))
            name = land[capital]['name']
            counties.append((unique('c_' + land[capital]['key']), f'County of {name}', capital, piece, rid))

# ---------- duchies: a region's counties; one-county regions join a neighbouring duchy of the same country
county_of = {}
for ci, c in enumerate(counties):
    for j in c[3]:
        county_of[j] = ci
county_adj = defaultdict(set)
for ci, c in enumerate(counties):
    for j in c[3]:
        for a in land[j]['adjacency']:
            k = index.get(a['id'])
            if k is not None and a['border'] > 0 and county_of[k] != ci:
                county_adj[ci].add(county_of[k])
duchy_of = {ci: c[4] for ci, c in enumerate(counties)}  # start: duchy = region id
for _ in range(3):
    size = Counter(duchy_of.values())
    for ci, c in enumerate(counties):
        d = duchy_of[ci]
        if size[d] > 1:
            continue
        country = regions[c[4]][1]
        options = [duchy_of[o] for o in county_adj[ci] if regions[counties[o][4]][1] == country and duchy_of[o] != d]
        if options:
            target = min(options, key=lambda o: size[o])
            size[d] -= 1
            size[target] += 1
            duchy_of[ci] = target
duchies = []  # (key, name, country, county indices)
groups = defaultdict(list)
for ci, d in duchy_of.items():
    groups[d].append(ci)
for d, cis in groups.items():
    name, code, _ = regions[d]
    if len(cis) <= DUCHY_MAX:
        parts = [cis]
    else:  # split a big region into duchies of about DUCHY_MAX / 2 counties
        k = max(2, round(len(cis) / (DUCHY_MAX / 2)))
        pts = np.array([[np.mean(cx[counties[ci][3]]), np.mean(cy[counties[ci][3]])] for ci in cis])
        _, lab = kmeans2(pts, k, minit='++', seed=rng)
        parts = [[ci for ci, l in zip(cis, lab) if l == g] for g in range(k)]
        parts = [p for p in parts if p]
    for part in parts:
        if len(parts) == 1:
            dname = name
        else:
            big = max(part, key=lambda ci: len(counties[ci][3]))
            dname = land[counties[big][2]]['name']
        duchies.append((unique('d_' + slugify(dname)), f'Duchy of {dname}', code, part))

country_names = {code: cname for _, code, cname in regions}
lines = ['# Generated by tools/build_titles.py: do not edit by hand (kingdoms and above: data/content/titles.yaml).',
         '# counties: [key, name, capital province, [provinces]]. duchies: [key, name, country code, [counties]].',
         'countries:']
for code in sorted({d[2] for d in duchies}):
    lines.append(f'  {code}: {json.dumps(country_names.get(code, code), ensure_ascii=False)}')
lines.append('counties:')
for key, name, cap, members, _ in counties:
    lines.append(f'  - [{key}, {json.dumps(name, ensure_ascii=False)}, {land[cap]["key"]}, [{", ".join(land[j]["key"] for j in members)}]]')
lines.append('duchies:')
for key, name, code, cis in duchies:
    lines.append(f'  - [{key}, {json.dumps(name, ensure_ascii=False)}, {code}, [{", ".join(counties[ci][0] for ci in cis)}]]')
(MAP / 'titles.yaml').write_text('\n'.join(lines) + '\n', encoding='utf8', newline='\n')
print(f'{len(counties)} counties, {len(duchies)} duchies, {len(country_names)} countries')
