"""
Generates the lower tiers of the title hierarchy into data/map/titles.yaml: counties (one per land province, which is
also its barony), duchies (about DUCHY_SIZE neighbouring provinces inside one Natural Earth admin-1 region, named after
their main town) and areas (a region's duchies, merged or split to about AREA_SIZE duchies), which become kingdoms
wherever no hand-drawn kingdom reaches. Kingdoms, empires and hegemonies are hand-made in data/content/titles.yaml.
Reads public/generated/map.json, so run after build-map, and again whenever province keys change:
py -3.12 -I tools/build_titles.py .
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
DUCHY_SIZE = 5      # provinces per duchy
AREA_SIZE = 8       # duchies per fallback area when an admin region is split
AREA_MIN = 5        # smaller regions merge into a neighbouring one
AREA_MAX = 14       # bigger ones are split
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


# ---------- counties (one per province) and duchies (about DUCHY_SIZE neighbouring provinces in one admin region)
used = set()


def unique(key):
    k, n = key, 2
    while k in used:
        k, n = f'{key}_{n}', n + 1
    used.add(k)
    return k


counties = [(unique('c_' + p['key']), f'County of {p["name"]}', i) for i, p in enumerate(land)]
duchies = []  # (key, name, member indices, region id)
by_region = defaultdict(list)
for i, r in enumerate(region):
    by_region[int(r)].append(i)
for rid, members in by_region.items():
    for comp in components(members):
        for piece in split(comp, DUCHY_SIZE):
            # The capital: a historical seed town if the duchy has one, else its biggest province.
            capital = max(piece, key=lambda j: (land[j]['key'] in seed_keys, land[j]['pixels']))
            duchies.append((unique('d_' + land[capital]['key']), f'Duchy of {land[capital]["name"]}', piece, rid))

# ---------- areas: fallback kingdoms where no hand-drawn kingdom reaches. A region's duchies, merged with a
# neighbour of the same country when small, split when big.
duchy_of = {}
for di, d in enumerate(duchies):
    for j in d[2]:
        duchy_of[j] = di
duchy_adj = defaultdict(set)
for di, d in enumerate(duchies):
    for j in d[2]:
        for a in land[j]['adjacency']:
            k = index.get(a['id'])
            if k is not None and a['border'] > 0 and duchy_of[k] != di:
                duchy_adj[di].add(duchy_of[k])
area_of = {di: d[3] for di, d in enumerate(duchies)}  # start: area = region id
for _ in range(6):
    size = Counter(area_of.values())
    for di, d in enumerate(duchies):
        a = area_of[di]
        if size[a] >= AREA_MIN:
            continue
        country = regions[d[3]][1]
        options = [area_of[o] for o in duchy_adj[di] if regions[duchies[o][3]][1] == country and area_of[o] != a]
        if options:
            target = min(options, key=lambda o: size[o])
            for dj in [x for x, v in area_of.items() if v == a]:
                area_of[dj] = target
            size[target] += size[a]
            size[a] = 0
areas = []  # (key, name, duchy indices)
groups = defaultdict(list)
for di, a in area_of.items():
    groups[a].append(di)
for a, dis in groups.items():
    name = regions[a][0]
    if len(dis) <= AREA_MAX:
        parts = [dis]
    else:
        k = max(2, round(len(dis) / AREA_SIZE))
        pts = np.array([[np.mean(cx[duchies[di][2]]), np.mean(cy[duchies[di][2]])] for di in dis])
        _, lab = kmeans2(pts, k, minit='++', seed=rng)
        parts = [p for p in ([di for di, l in zip(dis, lab) if l == g] for g in range(k)) if p]
    for part in parts:
        if len(parts) == 1:
            aname = name
        else:
            big = max(part, key=lambda di: len(duchies[di][2]))
            aname = land[max(duchies[big][2], key=lambda j: (land[j]['key'] in seed_keys, land[j]['pixels']))]['name']
        areas.append((unique('a_' + slugify(aname)), aname, part))
area_key = {}
for key, _, part in areas:
    for di in part:
        area_key[di] = key

lines = ['# Generated by tools/build_titles.py: do not edit by hand (kingdoms and above: data/content/titles.yaml).',
         '# areas: fallback kingdoms (key: name). counties: [key, name, capital province, [provinces]].',
         '# duchies: [key, name, area, [counties]].',
         'areas:']
for key, name, _ in areas:
    lines.append(f'  {key}: {json.dumps(name, ensure_ascii=False)}')
lines.append('counties:')
for key, name, i in counties:
    lines.append(f'  - [{key}, {json.dumps(name, ensure_ascii=False)}, {land[i]["key"]}, [{land[i]["key"]}]]')
lines.append('duchies:')
for di, (key, name, members, _) in enumerate(duchies):
    lines.append(f'  - [{key}, {json.dumps(name, ensure_ascii=False)}, {area_key[di]}, [{", ".join(counties[j][0] for j in members)}]]')
(MAP / 'titles.yaml').write_text('\n'.join(lines) + '\n', encoding='utf8', newline='\n')
print(f'{len(counties)} counties, {len(duchies)} duchies, {len(areas)} areas')
