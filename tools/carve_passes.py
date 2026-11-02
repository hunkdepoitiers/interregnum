"""
Carves the mountain passes of data/map/passes.yaml into the current province map: impassable mountain or wasteland
pixels within HALF_WIDTH of a pass route become land of the nearest land province. Then any land still walled in by
terrain gets an automatic pass to the nearest other land of its landmass (up to MAX_GAP). Nothing else changes, so it
can run on a finished map (and again after tools/opengs_map.py):  py -3.12 -I tools/carve_passes.py .
"""
import math
import re
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage as ndi
from skimage.graph import MCP_Geometric

Image.MAX_IMAGE_PIXELS = None
ROOT = Path(sys.argv[1] if len(sys.argv) > 1 else '.')
MAP = ROOT / 'data' / 'map'
ROWS = 512
HALF_WIDTH = 6   # px either side of the route (~17 km wide in all)
REACH = 400      # px around a route searched for the land a carved pixel joins
MAX_GAP = 300    # px (~420 km): longest automatic pass for land walled in by terrain
MIN_POCKET = 30  # px: smaller walled-in specks are left alone

DEF_RE = re.compile(r'^- \{ id: (\d+), key: ([\w-]+), name: "((?:[^"\\]|\\.)*)", kind: (\w+), color: "#([0-9a-fA-F]{6})" \}$')
defs = {}
for line in (MAP / 'definitions.yaml').read_text(encoding='utf8').splitlines():
    m = DEF_RE.match(line)
    if m:
        defs[int(m[1])] = {'key': m[2], 'kind': m[4], 'color': int(m[5], 16)}
n = max(defs) + 1
kind = np.zeros(n, np.uint8)  # 1 land, 2 mountain or wasteland
color = np.zeros((n, 3), np.uint8)
for i, d in defs.items():
    kind[i] = 1 if d['kind'] == 'land' else 2 if d['kind'] in ('mountain', 'wasteland') else 0
    color[i] = [(d['color'] >> 16) & 255, (d['color'] >> 8) & 255, d['color'] & 255]

proj = {}
for line in (MAP / 'projection.yaml').read_text(encoding='utf8').splitlines():
    m = re.match(r'^(\w+):\s*(-?[\d.]+)', line)
    if m:
        proj[m[1]] = float(m[2])
cos_sp = math.cos(math.radians(proj['standardParallel']))
scale = proj['width'] / ((proj['east'] - proj['west']) * cos_sp)


def to_pixel(lat, lon):
    return (lon - proj['west']) * cos_sp * scale, (proj['north'] - lat) * scale


passes = {}
for line in (MAP / 'passes.yaml').read_text(encoding='utf8').splitlines():
    m = re.match(r'^([^#:][^:]*):\s*\[(.*)\]\s*$', line)
    if m:
        pts = re.findall(r'\[\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\]', m[2])
        passes[m[1].strip()] = [to_pixel(float(a), float(b)) for a, b in pts]

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
before = np.bincount(pmap.ravel(), minlength=n)

total = 0
for name, pts in passes.items():
    xs, ys = [p[0] for p in pts], [p[1] for p in pts]
    x0, x1 = max(int(min(xs)) - REACH, 0), min(int(max(xs)) + REACH, W)
    y0, y1 = max(int(min(ys)) - REACH, 0), min(int(max(ys)) + REACH, H)
    win = pmap[y0:y1, x0:x1]
    yy, xx = np.mgrid[y0:y1, x0:x1].astype(np.float32)
    near = np.zeros(win.shape, bool)
    for (ax, ay), (bx, by) in zip(pts, pts[1:]):
        dx, dy = bx - ax, by - ay
        t = np.clip(((xx - ax) * dx + (yy - ay) * dy) / max(dx * dx + dy * dy, 1e-9), 0, 1)
        near |= (xx - ax - t * dx) ** 2 + (yy - ay - t * dy) ** 2 <= HALF_WIDTH ** 2
    carve = near & (kind[win] == 2)
    if not carve.any():
        print(f'{name}: already passable')
        continue
    land = kind[win] == 1
    if not land.any():
        print(f'{name}: no land nearby, skipped')
        continue
    _, (iy, ix) = ndi.distance_transform_edt(~land, return_indices=True)
    win[carve] = win[iy[carve], ix[carve]]
    total += int(carve.sum())
    print(f'{name}: {int(carve.sum())} px carved')



DISK = np.hypot(*np.mgrid[-HALF_WIDTH:HALF_WIDTH + 1, -HALF_WIDTH:HALF_WIDTH + 1]) <= HALF_WIDTH


def carve_path(win, path):
    """Turns mountain or wasteland within HALF_WIDTH of the path pixels (window coords) into the nearest land."""
    mask = np.zeros(win.shape, bool)
    mask[tuple(np.asarray(path).T)] = True
    carve = ndi.binary_dilation(mask, DISK) & (kind[win] == 2)
    if carve.any():
        _, (iy, ix) = ndi.distance_transform_edt(kind[win] != 1, return_indices=True)
        win[carve] = win[iy[carve], ix[carve]]
    return int(carve.sum())


# Land still cut off by terrain (a valley walled in by mountains, a coast behind a desert) gets a pass to the
# nearest other land of the same landmass: the shortest route over land, mountain or wasteland (never water), if it
# is at most MAX_GAP long. Repeated until nothing changes.
skipped = {}
for round_ in range(4):
    k = kind[pmap]
    land_lab, _ = ndi.label(k == 1)
    terr_lab, _ = ndi.label(k > 0)
    del k
    sizes = np.bincount(land_lab.ravel())
    sizes[0] = 0
    objs = ndi.find_objects(land_lab)
    terr_of = np.zeros(len(sizes), np.int64)
    for c, sl in enumerate(objs, 1):
        if sl is not None:
            sub = land_lab[sl] == c
            terr_of[c] = terr_lab[sl][sub][0]
    main = {}
    for c in np.argsort(-sizes):
        if sizes[c] == 0:
            break
        main.setdefault(int(terr_of[c]), int(c))
    pockets = [c for c in np.argsort(-sizes) if sizes[c] >= MIN_POCKET and main.get(int(terr_of[c])) != c]
    carved = 0
    for c in pockets:
        sl = objs[c - 1]
        y0, y1 = max(sl[0].start - MAX_GAP, 0), min(sl[0].stop + MAX_GAP, H)
        x0, x1 = max(sl[1].start - MAX_GAP, 0), min(sl[1].stop + MAX_GAP, W)
        lab = land_lab[y0:y1, x0:x1]
        mine = lab == c
        other = (lab > 0) & ~mine & (terr_lab[y0:y1, x0:x1] == terr_of[c])
        if not other.any():
            skipped[c] = 'no other land within reach'
            continue
        win = pmap[y0:y1, x0:x1]
        mcp = MCP_Geometric(np.where(kind[win] == 0, np.inf, 1.0))
        edge = mine & ~ndi.binary_erosion(mine)  # start from the pocket's rim, not all its pixels
        cum, _ = mcp.find_costs(list(zip(*np.nonzero(edge))))
        reach = np.where(other, cum, np.inf)
        target = np.unravel_index(np.argmin(reach), reach.shape)
        if not np.isfinite(reach[target]) or reach[target] > MAX_GAP:
            skipped[c] = f'route of {reach[target]:.0f} px'
            continue
        carved += carve_path(win, mcp.traceback(target))
    del land_lab, terr_lab
    print(f'round {round_ + 1}: {len(pockets)} pockets, {carved} px carved')
    total += carved
    if not carved:
        break
if skipped:
    print(f'{len(skipped)} pockets left unconnected (too far from other land through terrain)')

after = np.bincount(pmap.ravel(), minlength=n)
gone = [defs[i]['key'] for i in defs if before[i] and not after[i]]
if gone:
    sys.exit(f'these provinces would vanish entirely: {gone}; shorten or move their passes')
out = np.empty((H, W, 3), np.uint8)
for y0 in range(0, H, ROWS):
    out[y0:y0 + ROWS] = color[pmap[y0:y0 + ROWS]]
Image.fromarray(out).save(MAP / 'provinces.png', compress_level=6)
print(f'{total} px carved in {len(passes)} passes; provinces.png written')
