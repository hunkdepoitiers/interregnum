"""
Opens the settled valleys of a mountain range: impassable mountain pixels below PASSABLE_BELOW metres (NOAA ETOPO,
tools/vendor/etopo/) inside a region box become land, split into new provinces about as big as the land provinces
around them; the high ground stays impassable. Every other province keeps its shape. Run on a finished map, then
tools/name_provinces.py (the new provinces get numbered placeholder names) and tools/carve_passes.py:
    py -3.12 -I tools/open_valleys.py .
"""
import math
import re
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage as ndi
from scipy.cluster.vq import kmeans2
from scipy.io import netcdf_file
from scipy.spatial import cKDTree

Image.MAX_IMAGE_PIXELS = None
ROOT = Path(sys.argv[1] if len(sys.argv) > 1 else '.')
MAP = ROOT / 'data' / 'map'
DEM = ROOT / 'tools' / 'vendor' / 'etopo' / 'etopo-2min.nc'
# name: (south, west, north, east)
REGIONS = {'Alps': (43.6, 5.0, 48.4, 16.5)}
PASSABLE_BELOW = 2000  # m: valley floors and passes below this become land
MIN_MOUNTAIN = 300     # px: smaller impassable specks left between valleys become land too
JITTER = 0.25          # border noise, as a share of the seed spacing
rng = np.random.default_rng(1314)

DEF_RE = re.compile(r'^- \{ id: (\d+), key: ([\w-]+), name: "((?:[^"\\]|\\.)*)", kind: (\w+), color: "#([0-9a-fA-F]{6})" \}$')
lines = (MAP / 'definitions.yaml').read_text(encoding='utf8').splitlines()
defs = {}
for i, line in enumerate(lines):
    m = DEF_RE.match(line)
    if m:
        defs[int(m[1])] = {'line': i, 'key': m[2], 'kind': m[4], 'color': int(m[5], 16)}
max_id = max(defs)

proj = {}
for line in (MAP / 'projection.yaml').read_text(encoding='utf8').splitlines():
    m = re.match(r'^(\w+):\s*(-?[\d.]+)', line)
    if m:
        proj[m[1]] = float(m[2])
cos_sp = math.cos(math.radians(proj['standardParallel']))
scale = proj['width'] / ((proj['east'] - proj['west']) * cos_sp)


def to_pixel(lat, lon):
    return (lon - proj['west']) * cos_sp * scale, (proj['north'] - lat) * scale


img = np.asarray(Image.open(MAP / 'provinces.png').convert('RGB'))
H, W = img.shape[:2]
ids_sorted = np.array(sorted(defs, key=lambda i: defs[i]['color']))
colors_sorted = np.array([defs[i]['color'] for i in ids_sorted], np.int64)

with netcdf_file(DEM, 'r', mmap=False) as nc:
    alt = nc.variables['altitude'][:].astype(np.float32)
    dem_lat = nc.variables['latitude'][:].astype(np.float64)
    dem_lon = nc.variables['longitude'][:].astype(np.float64)

new_defs = []  # (id, key, name, color)
used_colors = set(colors_sorted.tolist())
dropped = []
for region, (s, w, n, e) in REGIONS.items():
    x0, y0 = map(int, to_pixel(n, w))
    x1, y1 = map(int, to_pixel(s, e))
    c = img[y0:y1, x0:x1].astype(np.int64)
    code = (c[..., 0] << 16) | (c[..., 1] << 8) | c[..., 2]
    win = ids_sorted[np.clip(np.searchsorted(colors_sorted, code), 0, len(ids_sorted) - 1)].astype(np.int32)
    kind = np.zeros(max_id + 1, np.uint8)  # 1 land, 2 mountain, 3 other
    for i, d in defs.items():
        kind[i] = 1 if d['kind'] == 'land' else 2 if d['kind'] == 'mountain' else 3
    k = kind[win]

    # Elevation of every pixel in the box (bilinear on the 2' grid).
    ys = np.arange(y0, y1) + 0.5
    xs = np.arange(x0, x1) + 0.5
    fi = (proj['north'] - ys / scale - dem_lat[0]) / (dem_lat[1] - dem_lat[0])
    fj = (xs / (cos_sp * scale) + proj['west'] - dem_lon[0]) / (dem_lon[1] - dem_lon[0])
    FI, FJ = np.meshgrid(fi, fj, indexing='ij')
    height = ndi.map_coordinates(alt, [FI, FJ], order=1, mode='nearest')

    opened = (k == 2) & (height < PASSABLE_BELOW)
    # Impassable specks too small to matter once the valleys around them are open become land as well.
    still = (k == 2) & ~opened
    lab, nl = ndi.label(still)
    small = np.bincount(lab.ravel(), minlength=nl + 1) < MIN_MOUNTAIN
    small[0] = False
    opened |= small[lab]
    land_areas = np.bincount(win[k == 1])
    target = float(np.median(land_areas[land_areas > 0]))
    print(f'{region}: {int(opened.sum())} px opened below {PASSABLE_BELOW} m, target province size {target:.0f} px')

    # Each connected stretch of opened ground becomes provinces of about the target size; slivers too small for a
    # province of their own join the land beside them.
    new = np.zeros(win.shape, np.int32)
    lab, nl = ndi.label(opened)
    for comp, sl in enumerate(ndi.find_objects(lab), 1):
        part = lab[sl] == comp
        area = int(part.sum())
        count = int(round(area / target))
        if count == 0:
            continue
        py, px = np.nonzero(part)
        pts = np.stack([px, py], 1).astype(np.float64)
        sample = pts[rng.choice(len(pts), min(len(pts), 20000), replace=False)]
        centres = sample[:1] if count == 1 else kmeans2(sample, count, minit='++', seed=rng)[0]
        spacing = math.sqrt(area / count)
        noise = [ndi.gaussian_filter(rng.standard_normal(part.shape), max(spacing / 4, 2)) for _ in range(2)]
        amp = [JITTER * spacing / max(np.abs(z).max(), 1e-9) for z in noise]
        jx, jy = noise[0][py, px] * amp[0], noise[1][py, px] * amp[1]
        _, owner = cKDTree(centres).query(np.stack([px + jx, py + jy], 1))
        ids = np.zeros(count, np.int64)
        for j in range(count):
            max_id += 1
            ids[j] = max_id
            while True:
                col = int(rng.integers(0, 1 << 24))
                if col not in used_colors:
                    break
            used_colors.add(col)
            new_defs.append((max_id, f'{region.lower()}_valley_{max_id}', f'{region} Valley {max_id}', col))
        sub = new[sl]
        sub[py, px] = ids[owner]
    # Pieces of a new province cut off from its main body, and the slivers, go to the land they touch.
    keep = new > 0
    for pid in np.unique(new[keep]):
        pl, pn = ndi.label(new == pid)
        if pn > 1:
            sizes = np.bincount(pl.ravel())
            sizes[0] = 0
            new[(pl > 0) & (pl != np.argmax(sizes))] = 0
    win_out = np.where(new > 0, new, win)
    unassigned = opened & (new == 0)
    land_now = (kind[np.minimum(win_out, len(kind) - 1)] == 1) | (win_out > len(kind) - 1)
    land_now &= ~unassigned
    _, (iy, ix) = ndi.distance_transform_edt(~land_now, return_indices=True)
    win_out[unassigned] = win_out[iy[unassigned], ix[unassigned]]

    before = np.bincount(win.ravel(), minlength=len(kind))
    after = np.bincount(win_out.ravel(), minlength=max_id + 1)
    dropped += [i for i in range(1, len(kind)) if before[i] and not after[i] and i in defs]
    # Write the box back as colours.
    color_of = {i: d['color'] for i, d in defs.items()}
    color_of.update({i: col for i, _, _, col in new_defs})
    lut_ids = np.array(sorted(color_of))
    lut = np.zeros((lut_ids.max() + 1, 3), np.uint8)
    for i in lut_ids:
        cc = color_of[i]
        lut[i] = [(cc >> 16) & 255, (cc >> 8) & 255, cc & 255]
    img = np.array(img)  # writable copy
    img[y0:y1, x0:x1] = lut[win_out]
    print(f'{region}: {sum(1 for d in new_defs)} new provinces, {len(dropped)} mountain provinces fully opened')

Image.fromarray(img).save(MAP / 'provinces.png', compress_level=6)
out = [l for i, l in enumerate(lines) if not any(defs[d]['line'] == i for d in dropped)]
for pid, key, name, col in new_defs:
    out.append(f'- {{ id: {pid}, key: {key}, name: "{name}", kind: land, color: "#{col:06x}" }}')
(MAP / 'definitions.yaml').write_text('\n'.join(out) + '\n', encoding='utf8', newline='\n')
print('provinces.png and definitions.yaml written')
