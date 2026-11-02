"""
Gives every land province a terrain, written to data/map/terrain.json ({province key: terrain}); build-map adds it
to map.json. From NOAA ETOPO elevation (tools/vendor/etopo/): mean height and ruggedness of each province, latitude,
the Natural Earth desert regions, and the hand-drawn regions of data/map/terrain-regions.yaml. Run after the map and
its names are final (keys change with names):  py -3.12 -I tools/classify_terrain.py .
"""
import json
import math
import re
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage as ndi
from scipy.io import netcdf_file

Image.MAX_IMAGE_PIXELS = None
ROOT = Path(sys.argv[1] if len(sys.argv) > 1 else '.')
MAP = ROOT / 'data' / 'map'
VENDOR = ROOT / 'tools' / 'vendor'
ROWS = 512
HIGHLANDS_M = 1400   # mean height above this: highlands
HILLS_STD_M = 140    # spread of heights inside the province above this: hills
HIGHLANDS_STD_M = 380
TUNDRA_LAT = 64
TERRAINS = ['farmlands', 'plains', 'hills', 'highlands', 'forest', 'jungle', 'marsh', 'steppe', 'desert', 'tundra']

DEF_RE = re.compile(r'^- \{ id: (\d+), key: ([\w-]+), name: "((?:[^"\\]|\\.)*)", kind: (\w+), color: "#([0-9a-fA-F]{6})" \}$')
defs = {}
for line in (MAP / 'definitions.yaml').read_text(encoding='utf8').splitlines():
    m = DEF_RE.match(line)
    if m:
        defs[int(m[1])] = {'key': m[2], 'kind': m[4], 'color': int(m[5], 16)}
n = max(defs) + 1
proj = {}
for line in (MAP / 'projection.yaml').read_text(encoding='utf8').splitlines():
    m = re.match(r'^(\w+):\s*(-?[\d.]+)', line)
    if m:
        proj[m[1]] = float(m[2])
cos_sp = math.cos(math.radians(proj['standardParallel']))
scale = proj['width'] / ((proj['east'] - proj['west']) * cos_sp)


def to_lonlat(x, y):
    return x / (cos_sp * scale) + proj['west'], proj['north'] - y / scale


img = np.asarray(Image.open(MAP / 'provinces.png').convert('RGB'))
H, W = img.shape[:2]
ids_sorted = np.array(sorted(defs, key=lambda i: defs[i]['color']))
colors_sorted = np.array([defs[i]['color'] for i in ids_sorted], np.int64)
with netcdf_file(VENDOR / 'etopo' / 'etopo-2min.nc', 'r', mmap=False) as nc:
    alt = nc.variables['altitude'][:].astype(np.float32)
    dem_lat = nc.variables['latitude'][:].astype(np.float64)
    dem_lon = nc.variables['longitude'][:].astype(np.float64)

# Per province: pixel count, sum of x and y, sum of height and of height squared (land heights only, sea floor at 0).
acc = np.zeros((5, n))
fj = ((np.arange(W) + 0.5) / (cos_sp * scale) + proj['west'] - dem_lon[0]) / (dem_lon[1] - dem_lon[0])
for y0 in range(0, H, ROWS):
    c = img[y0:y0 + ROWS].astype(np.int64)
    code = (c[..., 0] << 16) | (c[..., 1] << 8) | c[..., 2]
    ids = ids_sorted[np.clip(np.searchsorted(colors_sorted, code), 0, len(ids_sorted) - 1)]
    ys = np.arange(y0, y0 + ids.shape[0]) + 0.5
    fi = (proj['north'] - ys / scale - dem_lat[0]) / (dem_lat[1] - dem_lat[0])
    FI, FJ = np.meshgrid(fi, fj, indexing='ij')
    h = np.maximum(ndi.map_coordinates(alt, [FI, FJ], order=1, mode='nearest'), 0)
    flat = ids.ravel()
    yy, xx = np.divmod(np.arange(flat.size), W)
    acc[0] += np.bincount(flat, minlength=n)
    acc[1] += np.bincount(flat, xx, n)
    acc[2] += np.bincount(flat, yy + y0, n)
    acc[3] += np.bincount(flat, h.ravel(), n)
    acc[4] += np.bincount(flat, (h.ravel() ** 2), n)
del img
cnt = np.maximum(acc[0], 1)
mean_h = acc[3] / cnt
std_h = np.sqrt(np.maximum(acc[4] / cnt - mean_h ** 2, 0))
lon, lat = to_lonlat(acc[1] / cnt, acc[2] / cnt)


def inside(px, py, ring):
    x0, y0 = ring[:, 0], ring[:, 1]
    x1, y1 = np.roll(x0, -1), np.roll(y0, -1)
    cross = ((y0 > py) != (y1 > py)) & (px < (x1 - x0) * (py - y0) / np.where(y1 == y0, 1e-30, y1 - y0) + x0)
    return bool(cross.sum() % 2)


deserts = []
for f in json.loads((VENDOR / 'ne_10m_geography_regions_polys.geojson').read_text(encoding='utf8'))['features']:
    if f['properties']['FEATURECLA'] == 'Desert' and f['geometry']:
        g = f['geometry']
        for poly in [g['coordinates']] if g['type'] == 'Polygon' else g['coordinates']:
            deserts.append(np.asarray(poly[0], np.float64)[:, :2])

regions = []  # (terrain, ring as lon/lat)
text = (MAP / 'terrain-regions.yaml').read_text(encoding='utf8')
for block in re.split(r'\n- ', '\n' + text)[1:]:
    t = re.search(r'terrain:\s*(\w+)', block)[1]
    assert t in TERRAINS, t
    pts = re.findall(r'\[\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\]', block.split('area:', 1)[1])
    regions.append((t, np.array([[float(b), float(a)] for a, b in pts])))

terrain = {}
counts = {t: 0 for t in TERRAINS}
for pid, d in defs.items():
    if d['kind'] != 'land' or not acc[0][pid]:
        continue
    x, y, h, s = lon[pid], lat[pid], mean_h[pid], std_h[pid]
    t = 'tundra' if y >= TUNDRA_LAT else 'plains'
    if any(inside(x, y, r) for r in deserts):
        t = 'desert'
    for rt, ring in regions:
        if inside(x, y, ring):
            t = rt
    # Relief wins over the broad outlines, except where an outline marks river farmland or marsh.
    if t not in ('farmlands', 'marsh'):
        if h >= HIGHLANDS_M or s >= HIGHLANDS_STD_M:
            t = 'highlands'
        elif s >= HILLS_STD_M:
            t = 'hills'
    terrain[d['key']] = t
    counts[t] += 1
(MAP / 'terrain.json').write_text(json.dumps(terrain, separators=(',', ':'), sort_keys=True) + '\n', encoding='utf8', newline='\n')
print(', '.join(f'{t} {c}' for t, c in counts.items()))
