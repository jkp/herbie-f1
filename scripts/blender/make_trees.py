# Builds the game's trees entirely from code and exports them as glTF: a Norway spruce, a broadleaf (beech/oak),
# an umbrella (stone) pine and a palm, each as a detailed mesh for near the camera (`<species>_hi`: alpha-tested
# foliage cards around an opaque core) and a cheap one for the distance (`<species>_lo`: a few dozen opaque
# triangles). Everything shares one material and one painted texture atlas, so the game draws a forest tile in one
# call per species and LOD.
# Usage: blender -b -P scripts/blender/make_trees.py -- <out.glb> [preview.png]
# (scripts/build-trees.mjs runs this, then optimises the result into src/assets/trees.glb.)
#
# Blender is z-up and metres; the glTF export turns that into the game's y-up. Each tree's base is at the origin.
# Normals are bent outward from the crown (not the cards' flat normals), so the foliage shades like a volume, and
# vertex colours carry the self-shadowing: dark deep inside the crown and low down, bright at the tips.
import bpy, math, random, sys
import numpy as np
from mathutils import Vector, Matrix

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = argv[0] if argv else '/tmp/trees.glb'
PREVIEW = argv[1] if len(argv) > 1 else None
random.seed(11); np.random.seed(11)
R = random.uniform

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

# ---------------------------------------------------------------- the texture atlas ---------------------------------
# 1024 x 1024, rows bottom-up (row 0 is v = 0). Regions in pixels: (x0, y0, w, h).
S = 1024
SPRUCE, BROAD = (0, 512, 512, 512), (512, 512, 512, 512)
PINE, PALM = (0, 128, 512, 384), (512, 128, 512, 384)
def patch(k): return (k * 128 + 4, 4, 120, 120)  # opaque strip along the bottom, inset so mipmaps don't bleed
BARK = {'spruce': patch(0), 'broadleaf': patch(1), 'pine': patch(2), 'palm': patch(3)}
SOLID = {'spruce': patch(4), 'broadleaf': patch(5), 'pine': patch(6), 'palm': patch(7)}

img = np.zeros((S, S, 4), np.float32)

def fill_rgb(rect, rgb):
    x0, y0, w, h = rect
    img[y0:y0 + h, x0:x0 + w, :3] = rgb  # colour under transparent pixels: no dark fringes when filtered

def stamp(cx, cy, rx, ry, ang, rgb, a=1.0):
    """Antialiased filled ellipse."""
    r = max(rx, ry) + 1.5
    x0, x1, y0, y1 = int(max(0, cx - r)), int(min(S, cx + r + 1)), int(max(0, cy - r)), int(min(S, cy + r + 1))
    if x0 >= x1 or y0 >= y1: return
    ys, xs = np.mgrid[y0:y1, x0:x1] + 0.5
    dx, dy = xs - cx, ys - cy
    c, s = math.cos(ang), math.sin(ang)
    u, v = (dx * c + dy * s) / rx, (-dx * s + dy * c) / ry
    cov = np.clip((1 - np.sqrt(u * u + v * v)) * min(rx, ry) * 1.2 + 0.5, 0, 1) * a
    reg = img[y0:y1, x0:x1]
    reg[..., :3] += (np.array(rgb, np.float32) - reg[..., :3]) * cov[..., None]
    reg[..., 3] = np.maximum(reg[..., 3], cov)

def line(x0, y0, x1, y1, w, rgb):
    L = math.hypot(x1 - x0, y1 - y0)
    stamp((x0 + x1) / 2, (y0 + y1) / 2, L / 2 + w / 2, w / 2, math.atan2(y1 - y0, x1 - x0), rgb)

def mix(a, b, t): return [a[i] + (b[i] - a[i]) * t for i in range(3)]
def jit(rgb, k=0.06): f = 1 + R(-k, k); return [min(1, c * f * (1 + R(-k, k) * 0.5)) for c in rgb]

def noise(w, h, cell):
    """Smooth value noise in [0, 1]."""
    g = np.random.rand(h // cell + 2, w // cell + 2)
    ys, xs = np.mgrid[0:h, 0:w] / cell
    i, j = ys.astype(int), xs.astype(int); fy, fx = ys - i, xs - j
    fy, fx = fy * fy * (3 - 2 * fy), fx * fx * (3 - 2 * fx)
    return (g[i, j] * (1 - fx) + g[i, j + 1] * fx) * (1 - fy) + (g[i + 1, j] * (1 - fx) + g[i + 1, j + 1] * fx) * fy

# Norway spruce branch: a stem from the trunk (u = 0) to the tip (u = 1), combed with drooping side shoots,
# needles all along, fresh light-green growth at the ends.
SP_DARK, SP_LIGHT = (0.09, 0.16, 0.11), (0.25, 0.37, 0.19)
def spruce_spray():
    x0, y0, w, h = SPRUCE
    fill_rgb(SPRUCE, SP_DARK)
    cy = y0 + h / 2
    stem = lambda t: (x0 + 6 + t * (w - 14), cy - 10 * t * t)
    def needles(ax, ay, bx, by, t_base, n_len):
        L = math.hypot(bx - ax, by - ay); n = max(2, int(L / 2.6))
        ang = math.atan2(by - ay, bx - ax)
        for k in range(n):
            f = k / n; px, py = ax + (bx - ax) * f, ay + (by - ay) * f
            tip = t_base + (1 - t_base) * f
            for side in (-1, 1):
                a = ang + side * R(0.7, 1.1)
                l = n_len * R(0.8, 1.2) * (0.6 + 0.4 * (1 - f * 0.5))
                rgb = jit(mix(SP_DARK, SP_LIGHT, min(1, max(0, (tip - 0.45) * 1.6 + f * 0.35))))
                stamp(px + math.cos(a) * l / 2, py + math.sin(a) * l / 2, l / 2, 1.25, a, rgb)
    # side shoots: longest a third of the way out, angled toward the tip, alternating
    k = 0
    for t in np.arange(0.03, 0.95, 0.024):
        sx, sy = stem(t)
        side = 1 if k % 2 else -1; k += 1
        span = (h / 2 - 16) * (math.sin(math.pi * min(1, (t + 0.25) / 1.15)) ** 0.6) * R(0.8, 1.0) * (1 - t * 0.3)
        a = side * R(0.75, 1.05)
        ex, ey = sx + math.cos(a) * span, sy + math.sin(a) * span - span * 0.1
        line(sx, sy, ex, ey, 2.2, (0.26, 0.18, 0.12))
        needles(sx, sy, ex, ey, t, 17)
        # second-order shoots off the long ones
        if span > 70:
            for f in (0.3, 0.55, 0.8):
                qx, qy = sx + (ex - sx) * f, sy + (ey - sy) * f
                b = a + side * R(0.5, 0.8) * (1 if R(0, 1) > 0.5 else -1)
                l2 = span * 0.32
                needles(qx, qy, qx + math.cos(b) * l2, qy + math.sin(b) * l2, t + 0.2, 13)
    pts = [stem(t) for t in np.linspace(0, 1, 30)]
    for (ax, ay), (bx, by) in zip(pts, pts[1:]): line(ax, ay, bx, by, 4, (0.28, 0.19, 0.13))
    for (ax, ay), (bx, by) in zip(pts[::2], pts[2::2]): needles(ax, ay, bx, by, 0.6, 15)

# Broadleaf: a rounded spray of overlapping leaves on twigs, lit from above, shadowed underneath.
BL_DARK, BL_LIGHT = (0.10, 0.19, 0.06), (0.36, 0.50, 0.16)
def leaf_cluster(rect, dark, light, n, leaf, lobes):
    x0, y0, w, h = rect
    fill_rgb(rect, dark)
    cx, cy, rad = x0 + w / 2, y0 + h / 2, min(w, h) / 2 - 18
    clumps = [(cx + math.cos(a) * rad * 0.45, cy + math.sin(a) * rad * 0.45, rad * R(0.38, 0.55)) for a in [k * 2 * math.pi / lobes + R(-0.4, 0.4) for k in range(lobes)]] + [(cx, cy, rad * 0.5)]
    for _ in range(5):  # twigs from below the middle
        a = R(-2.6, -0.5); l = rad * R(0.5, 0.9)
        line(cx + R(-20, 20), cy - rad * 0.2, cx + math.cos(a + math.pi) * -l * 0.3, cy + l * 0.6, 3, (0.25, 0.2, 0.14))
    for i in range(n):
        qx, qy, qr = random.choice(clumps)
        a = R(0, 2 * math.pi); rr = math.sqrt(R(0, 1))
        px, py = qx + math.cos(a) * qr * rr, qy + math.sin(a) * qr * rr
        a = math.atan2(py - cy, px - cx); r = math.hypot(px - cx, py - cy)
        lit = min(1, max(0, 0.3 + (py - qy) / qr * 0.3 + rr * 0.3 + (py - cy) / rad * 0.2 + R(-0.25, 0.25)))
        rgb = jit(mix(dark, light, lit), 0.1)
        ang = a + R(-0.9, 0.9)
        L = leaf * R(0.75, 1.2)
        stamp(px, py, L, L * 0.52, ang, rgb)
        line(px - math.cos(ang) * L * 0.8, py - math.sin(ang) * L * 0.8, px + math.cos(ang) * L * 0.6, py + math.sin(ang) * L * 0.6, 1.0, mix(rgb, dark, 0.35))

# Pine: bursts of long needles in tufts, heaped into an irregular flat-bottomed mass.
PN_DARK, PN_LIGHT = (0.13, 0.22, 0.10), (0.35, 0.45, 0.19)
def pine_clump():
    x0, y0, w, h = PINE
    fill_rgb(PINE, PN_DARK)
    cx, cy = x0 + w / 2, y0 + h * 0.42
    for i in range(70):
        a = R(0, math.pi); r = R(0, 1) ** 0.6
        tx = cx + math.cos(a) * r * (w / 2 - 50) * (1 if R(0, 1) > 0.5 else -1)
        ty = cy + math.sin(a) * r * (h * 0.5 - 40) * (0.9 if math.sin(a) > 0 else 0.4) - 10
        if i < 12: ty = cy + R(-20, 10); tx = cx + R(-(w / 2 - 60), w / 2 - 60)
        lit = min(1, max(0, 0.35 + (ty - cy) / h * 1.2 + R(-0.2, 0.2)))
        line(tx, ty - 25, tx, ty, 2.5, (0.3, 0.2, 0.13))
        for k in range(34):
            b = R(0, 2 * math.pi); l = R(18, 34)
            stamp(tx + math.cos(b) * l / 2, ty + math.sin(b) * l / 2 * 0.9, l / 2, 1.3, b, jit(mix(PN_DARK, PN_LIGHT, lit), 0.1))

# Palm frond: a yellowish rachis from the crown (u = 0) to the tip, long leaflets angled forward on both sides.
PM_DARK, PM_LIGHT = (0.20, 0.29, 0.10), (0.44, 0.52, 0.20)
def palm_frond():
    x0, y0, w, h = PALM
    fill_rgb(PALM, PM_DARK)
    cy = y0 + h / 2
    for k in range(70):
        t = 0.06 + k / 70 * 0.9
        px = x0 + 8 + t * (w - 20)
        prof = math.sin(math.pi * min(1, t / 0.95) ** 0.8)
        for side in (-1, 1):
            a = side * R(0.75, 0.95)
            L = (h / 2 - 10) / math.sin(abs(a)) * prof * R(0.85, 1.0)
            rgb = jit(mix(PM_DARK, PM_LIGHT, R(0.2, 0.9)), 0.08)
            if R(0, 1) < 0.06: rgb = (0.55, 0.47, 0.25)  # the odd dry leaflet
            stamp(px + math.cos(a) * L / 2, cy + math.sin(a) * L / 2, L / 2, 3.2 * (0.6 + prof * 0.5), a, rgb)
    line(x0 + 4, cy, x0 + w - 6, cy, 5, (0.55, 0.52, 0.3))

def solid(rect, dark, light, cell=10):
    x0, y0, w, h = rect
    n = noise(w, h, cell) * 0.6 + noise(w, h, 3) * 0.4
    img[y0:y0 + h, x0:x0 + w, :3] = np.array(dark) + (np.array(light) - np.array(dark)) * n[..., None]
    img[y0:y0 + h, x0:x0 + w, 3] = 1

def bark(rect, dark, light, rings=False):
    x0, y0, w, h = rect
    if rings:
        ys = np.mgrid[0:h, 0:w][0]
        n = 0.5 + 0.5 * np.sin(ys / h * 2 * math.pi * 14) ** 3 * 0.8 + noise(w, h, 4) * 0.3 - 0.15
    else:  # vertical furrows
        n = noise(w, h, 6) * 0.5 + np.repeat(np.random.rand(1, w // 6 + 1), 6, axis=1)[:, :w] * 0.3 + noise(w, h, 2) * 0.2
    n = np.clip(n, 0, 1)
    img[y0:y0 + h, x0:x0 + w, :3] = np.array(dark) + (np.array(light) - np.array(dark)) * n[..., None]
    img[y0:y0 + h, x0:x0 + w, 3] = 1

spruce_spray()
leaf_cluster(BROAD, BL_DARK, BL_LIGHT, 2600, 10, 6)
pine_clump()
palm_frond()
bark(BARK['spruce'], (0.18, 0.12, 0.09), (0.42, 0.33, 0.26))
bark(BARK['broadleaf'], (0.22, 0.21, 0.19), (0.52, 0.5, 0.46))
bark(BARK['pine'], (0.30, 0.16, 0.10), (0.62, 0.38, 0.22))
bark(BARK['palm'], (0.24, 0.20, 0.15), (0.55, 0.47, 0.35), rings=True)
solid(SOLID['spruce'], (0.08, 0.15, 0.09), (0.22, 0.32, 0.16))
solid(SOLID['broadleaf'], (0.12, 0.22, 0.07), (0.36, 0.48, 0.16))
solid(SOLID['pine'], (0.11, 0.19, 0.09), (0.28, 0.38, 0.16))
solid(SOLID['palm'], (0.17, 0.25, 0.09), (0.38, 0.46, 0.17))
img[..., 3] = np.where(img[..., 3] > 0.04, img[..., 3], 0)

atlas = bpy.data.images.new('foliage', S, S, alpha=True)
atlas.pixels.foreach_set(np.clip(img, 0, 1).ravel())
atlas.pack()
if PREVIEW:
    atlas.filepath_raw = PREVIEW.replace('.png', '-atlas.png'); atlas.file_format = 'PNG'; atlas.save()

mat = bpy.data.materials.new('foliage')
nt = mat.node_tree
bsdf = nt.nodes['Principled BSDF']
tex = nt.nodes.new('ShaderNodeTexImage'); tex.image = atlas
nt.links.new(tex.outputs['Color'], bsdf.inputs['Base Color'])
nt.links.new(tex.outputs['Alpha'], bsdf.inputs['Alpha'])
bsdf.inputs['Roughness'].default_value = 0.9
mat.surface_render_method = 'DITHERED'
mat.use_backface_culling = False

# ---------------------------------------------------------------- geometry ------------------------------------------
UP = Vector((0, 0, 1))

class Mesh:
    """Unwelded triangles/quads with per-corner uv, normal and colour (gltf-transform welds them afterwards)."""
    def __init__(self): self.v, self.f, self.uv, self.n, self.c = [], [], [], [], []
    def face(self, pts, uvs, nrms, cols):
        i = len(self.v); self.v += pts; self.f.append(tuple(range(i, i + len(pts))))
        self.uv += uvs; self.n += nrms; self.c += cols
    def tris(self): return sum(len(f) - 2 for f in self.f)

def uv_in(rect, u, v):
    x0, y0, w, h = rect
    return ((x0 + u * w) / S, (y0 + v * h) / S)

def grey(a, tint=(1, 1, 1)): a = max(0.05, min(1, a)); return (a * tint[0], a * tint[1], a * tint[2], 1)

def frame(t):
    a = Vector((1, 0, 0)) if abs(t.x) < 0.9 else Vector((0, 1, 0))
    b1 = t.cross(a).normalized(); return b1, t.cross(b1).normalized()

def tube(m, pts, radii, sides, rect, ao=lambda p: 0.8):
    """Generalised cylinder through `pts`, the bark patch wrapped once around and once along."""
    rings = []
    for k, p in enumerate(pts):
        t = (pts[min(k + 1, len(pts) - 1)] - pts[max(k - 1, 0)]).normalized()
        b1, b2 = frame(t)
        rings.append([(p + (b1 * math.cos(2 * math.pi * j / sides) + b2 * math.sin(2 * math.pi * j / sides)) * radii[k],
                       (b1 * math.cos(2 * math.pi * j / sides) + b2 * math.sin(2 * math.pi * j / sides))) for j in range(sides + 1)])
    for k in range(len(pts) - 1):
        for j in range(sides):
            q = [rings[k][j], rings[k][j + 1], rings[k + 1][j + 1], rings[k + 1][j]]
            uvs = [uv_in(rect, (j + dj) / sides, (k + dk) / (len(pts) - 1)) for dj, dk in ((0, 0), (1, 0), (1, 1), (0, 1))]
            m.face([p for p, _ in q], uvs, [n for _, n in q], [grey(ao(p)) for p, _ in q])

def card(m, centre, a, b, rect, nrm, ao, flip_u=False):
    """Quad centre +- a +- b, texture rect across it."""
    corners = [centre - a - b, centre + a - b, centre + a + b, centre - a + b]
    uvs = [uv_in(rect, u if not flip_u else 1 - u, v) for u, v in ((0, 0), (1, 0), (1, 1), (0, 1))]
    m.face(corners, uvs, [nrm(p) for p in corners], [grey(ao(p)) for p in corners])

def ico(level):
    t = (1 + 5 ** 0.5) / 2
    v = [Vector(x).normalized() for x in [(-1, t, 0), (1, t, 0), (-1, -t, 0), (1, -t, 0), (0, -1, t), (0, 1, t), (0, -1, -t), (0, 1, -t), (t, 0, -1), (t, 0, 1), (-t, 0, -1), (-t, 0, 1)]]
    f = [(0, 11, 5), (0, 5, 1), (0, 1, 7), (0, 7, 10), (0, 10, 11), (1, 5, 9), (5, 11, 4), (11, 10, 2), (10, 7, 6), (7, 1, 8), (3, 9, 4), (3, 4, 2), (3, 2, 6), (3, 6, 8), (3, 8, 9), (4, 9, 5), (2, 4, 11), (6, 2, 10), (8, 6, 7), (9, 8, 1)]
    for _ in range(level):
        cache, nf = {}, []
        def mid(i, j):
            k = (min(i, j), max(i, j))
            if k not in cache: v.append((v[i] + v[j]).normalized()); cache[k] = len(v) - 1
            return cache[k]
        for a, b, c in f:
            ab, bc, ca = mid(a, b), mid(b, c), mid(c, a)
            nf += [(a, ab, ca), (b, bc, ab), (c, ca, bc), (ab, bc, ca)]
        f = nf
    return v, f

def blob(m, centre, radii, level, rect, ao, shape=lambda d: 1.0, nrm=None):
    """Opaque lumpy ellipsoid (crown cores and distant crowns)."""
    v, f = ico(level)
    pos = [centre + Vector((d.x * radii[0], d.y * radii[1], d.z * radii[2])) * shape(d) for d in v]
    for tri in f:
        pts = [pos[i] for i in tri]
        m.face(pts, [uv_in(rect, 0.5 + v[i].x * 0.45, 0.5 + v[i].y * 0.45) for i in tri],
               [(nrm(p) if nrm else Vector((v[i].x / radii[0], v[i].y / radii[1], v[i].z / radii[2])).normalized()) for i, p in zip(tri, pts)],
               [grey(ao(p)) for p in pts])

def outward(centre, up=0.35, squash=(1, 1, 1)):
    def n(p):
        d = p - centre; d = Vector((d.x / squash[0], d.y / squash[1], d.z / squash[2]))
        return (d.normalized() + UP * up).normalized() if d.length > 1e-4 else UP
    return n

# --- Norway spruce: 19 m, branches in whorls drooping from a straight trunk, narrow cone ---
SP_H, SP_Z0 = 19.0, 1.3
def sp_reach(z): f = max(0, min(1, (z - SP_Z0) / (SP_H - SP_Z0))); return 0.25 + 3.3 * (1 - f) ** 0.95

def spruce_hi():
    m = Mesh()
    sp_ao = lambda p: (0.32 + 0.68 * min(1, Vector((p.x, p.y, 0)).length / max(0.3, sp_reach(p.z))) ** 0.9) * (0.72 + 0.28 * p.z / SP_H)
    tube(m, [Vector((0, 0, -0.4)), Vector((0, 0, SP_H * 0.5)), Vector((0, 0, SP_H - 0.5))], [0.36, 0.22, 0.04], 6, BARK['spruce'], lambda p: 0.55)
    # dark core so you can't see through the crown
    rings = [(SP_Z0 + 0.8, 0.32), (SP_H * 0.45, 0.36), (SP_H - 2.2, 0.3)]
    for (za, fa), (zb, fb) in zip(rings, rings[1:]):
        for j in range(7):
            a0, a1 = 2 * math.pi * j / 7, 2 * math.pi * (j + 1) / 7
            P = lambda a, z, f: Vector((math.cos(a) * sp_reach(z) * f, math.sin(a) * sp_reach(z) * f, z))
            q = [P(a0, za, fa), P(a1, za, fa), P(a1, zb, fb), P(a0, zb, fb)]
            m.face(q, [uv_in(SOLID['spruce'], u, v) for u, v in ((j / 7, 0), ((j + 1) / 7, 0), ((j + 1) / 7, 1), (j / 7, 1))],
                   [(Vector((p.x, p.y, 0)).normalized() + UP * 0.4).normalized() for p in q], [grey(0.14 + 0.08 * p.z / SP_H) for p in q])
    z = SP_Z0
    while z < SP_H - 0.5:
        f = (z - SP_Z0) / (SP_H - SP_Z0)
        n = 7 if f < 0.45 else 6 if f < 0.75 else 4
        rot = R(0, 6.3)
        for k in range(n):
            az = rot + 2 * math.pi * k / n + R(-0.3, 0.3)
            L = sp_reach(z) * R(0.8, 1.12)
            d = Vector((math.cos(az), math.sin(az), 0)); side = Vector((-d.y, d.x, 0))
            pitch = -0.35 + 0.55 * f + R(-0.1, 0.1)  # low branches droop, high ones reach up
            Wd = min(3.2, max(0.8, L * 1.15))
            segs = 2 if L > 1.0 else 1
            base = Vector((0, 0, z)) + d * 0.15
            ridge0 = lambda t: base + d * (L * t) + UP * (L * t * math.sin(pitch) - (0.55 * L * t * t if segs == 2 else 0) * (1 - f))
            ridge = lambda t: (lambda v: Vector((v.x, v.y, max(v.z, 0.75))))(ridge0(t))  # low branches rest above the grass
            fold = 0.35  # tent: edges hang below the stem
            for s in range(segs):
                t0, t1 = s / segs, (s + 1) / segs
                for sg in (-1, 1):
                    e0 = ridge(t0) + side * sg * Wd / 2 * (0.6 + 0.4 * t0) - UP * fold * Wd / 2 * (0.6 + 0.4 * t0)
                    e1 = ridge(t1) + side * sg * Wd / 2 * (0.6 + 0.4 * t1) - UP * fold * Wd / 2 * (0.6 + 0.4 * t1)
                    q = [ridge(t0), ridge(t1), e1, e0]
                    uvs = [uv_in(SPRUCE, t0, 0.5), uv_in(SPRUCE, t1, 0.5), uv_in(SPRUCE, t1, 0.5 + sg * 0.5), uv_in(SPRUCE, t0, 0.5 + sg * 0.5)]
                    if sg < 0: q, uvs = q[::-1], uvs[::-1]
                    m.face(q, uvs, [(Vector((p.x, p.y, 0)).normalized() * 0.9 + UP * 0.45).normalized() if Vector((p.x, p.y, 0)).length > 0.05 else UP for p in q], [grey(sp_ao(p)) for p in q])
        z += R(0.75, 0.95)
    # the leader at the top: two crossed cards
    for az in (0, math.pi / 2):
        a = Vector((math.cos(az), math.sin(az), 0)) * 0.35; b = UP * 0.9
        c = Vector((0, 0, SP_H - 0.9))
        q = [c - a - b, c + a - b, c + a + b, c - a + b]
        m.face(q, [uv_in(SPRUCE, 0.55, 0.3), uv_in(SPRUCE, 0.55, 0.7), uv_in(SPRUCE, 1, 0.7), uv_in(SPRUCE, 1, 0.3)], [UP] * 4, [grey(1)] * 4)
    return m

def spruce_lo():
    m = Mesh()
    tube(m, [Vector((0, 0, -0.4)), Vector((0, 0, 2.5))], [0.36, 0.3], 4, BARK['spruce'], lambda p: 0.5)
    # tiers of jagged skirts, each hanging over the one below
    tiers = [(SP_Z0, 6.2), (5.2, 10.0), (9.0, 13.6), (12.6, 16.6), (15.8, SP_H)]
    for zb, zt in tiers:
        n = 9; ph = R(0, 6.3)
        rim = [Vector((math.cos(ph + 2 * math.pi * j / n) * sp_reach(zb) * (1.0 if j % 2 else 0.82),
                       math.sin(ph + 2 * math.pi * j / n) * sp_reach(zb) * (1.0 if j % 2 else 0.82), zb - 0.5 * (1 if j % 2 else 0))) for j in range(n)]
        top = Vector((0, 0, zt))
        for j in range(n):
            a, b = rim[j], rim[(j + 1) % n]
            m.face([a, b, top], [uv_in(SOLID['spruce'], j / n, 0), uv_in(SOLID['spruce'], (j + 1) / n, 0), uv_in(SOLID['spruce'], 0.5, 1)],
                   [(Vector((p.x, p.y, 0)).normalized() + UP * 0.5).normalized() for p in (a, b)] + [UP], [grey(0.95), grey(0.95), grey(0.5)])
    return m

# --- broadleaf (beech/oak): 15 m, a few big limbs into a lumpy domed crown of leaf clusters ---
BL_C = Vector((0, 0, 9.6))
LOBES = [(BL_C + Vector((0, 0, 1.6)), 3.4)] + [(BL_C + Vector((math.cos(a) * 2.6, math.sin(a) * 2.6, R(-1.3, 0.6))), R(2.6, 3.2)) for a in [k * 2 * math.pi / 5 + R(-0.3, 0.3) for k in range(5)]]
def lobe_reach(d):
    """Distance from the crown centre to the surface of the union of lobes along unit direction d."""
    best = 0
    for c, r in LOBES:
        o = c - BL_C; b = o.dot(d); disc = b * b - (o.length_squared - r * r)
        if disc >= 0: best = max(best, b + math.sqrt(disc))
    return best

def bl_ao(p):
    d = p - BL_C
    return (0.3 + 0.7 * min(1, d.length / max(1, lobe_reach(d.normalized()))) ** 1.4) * (0.7 + 0.3 * max(0, min(1, (p.z - 6) / 8)))

def broadleaf_hi():
    m = Mesh()
    trunk = [Vector((0, 0, -0.4)), Vector((0.05, 0, 2.5)), Vector((0.15, 0.05, 5.0)), Vector((0.2, 0.1, 7.2))]
    tube(m, trunk, [0.5, 0.4, 0.34, 0.26], 7, BARK['broadleaf'], lambda p: 0.75)
    for k, (c, r) in enumerate(LOBES[1:]):
        start = trunk[2 if k % 2 else 3]
        mid = start.lerp(c, 0.5) + Vector((0, 0, 0.6))
        tube(m, [start, mid, c.lerp(start, 0.25)], [0.22, 0.14, 0.05], 5, BARK['broadleaf'], lambda p: 0.55)
    for c, r in LOBES:
        blob(m, c, (r * 0.5,) * 3, 0, SOLID['broadleaf'], lambda p: 0.16, nrm=outward(BL_C, 0.3))
    nrm = outward(BL_C, 0.3)
    for c, r in LOBES:
        for _ in range(17):
            d = Vector((R(-1, 1), R(-1, 1), R(-0.55, 1))).normalized()
            p = c + d * r * R(0.72, 0.92)
            if any((p - c2).length < r2 - 0.5 for c2, r2 in LOBES if c2 != c) or p.z < 6.8: continue
            s = R(1.3, 1.7)
            a1, a2 = frame(d)
            rot = R(0, 6.3); a1, a2 = a1 * math.cos(rot) + a2 * math.sin(rot), a2 * math.cos(rot) - a1 * math.sin(rot)
            card(m, p, a1 * s, a2 * s, BROAD, nrm, bl_ao)  # facing out
            b1 = (d.cross(UP) if abs(d.z) < 0.95 else Vector((1, 0, 0))).normalized()
            card(m, p, b1 * s, (d * 0.5 + UP * 0.8).normalized() * s, BROAD, nrm, bl_ao)  # face-on at the silhouette
    return m

def broadleaf_lo():
    m = Mesh()
    tube(m, [Vector((0, 0, -0.4)), Vector((0.2, 0.1, 7.2))], [0.5, 0.3], 5, BARK['broadleaf'], lambda p: 0.7)
    blob(m, BL_C, (1, 1, 1), 1, SOLID['broadleaf'], lambda p: 0.45 + 0.55 * max(0, min(1, (p.z - 6) / 8)), shape=lambda d: lobe_reach(d) * 0.97)
    return m

# --- umbrella pine: 13 m, a tall leaning trunk forking into a flat, spreading canopy ---
PN_C, PN_R, PN_RZ = Vector((0.6, 0.2, 10.8)), 5.2, 1.8
def pn_ao(p):
    d = p - PN_C
    return (0.35 + 0.65 * max(0, min(1, (d.z / PN_RZ + 1) / 1.6))) * (0.55 + 0.45 * min(1, Vector((d.x, d.y, 0)).length / PN_R))

def pine_hi():
    m = Mesh()
    trunk = [Vector((0, 0, -0.4)), Vector((0.1, 0.0, 3)), Vector((0.35, 0.1, 6)), Vector((0.55, 0.2, 8.2))]
    tube(m, trunk, [0.42, 0.33, 0.27, 0.2], 7, BARK['pine'], lambda p: 0.8)
    for k in range(3):
        a = k * 2.1 + 0.4
        end = PN_C + Vector((math.cos(a) * 2.4, math.sin(a) * 2.4, -0.6))
        tube(m, [trunk[-1], trunk[-1].lerp(end, 0.5) + Vector((0, 0, 0.5)), end], [0.18, 0.12, 0.05], 5, BARK['pine'], lambda p: 0.6)
    nrm = outward(PN_C, 0.6, (PN_R, PN_R, PN_RZ))
    blob(m, PN_C + Vector((0, 0, -0.1)), (PN_R * 0.6, PN_R * 0.6, PN_RZ * 0.45), 0, SOLID['pine'], lambda p: 0.3, nrm=nrm)
    # rings of clumps standing on the canopy: wide at the rim, rising to a low dome in the middle
    for rf, zf, n in ((0.92, -0.35, 14), (0.62, 0.15, 10), (0.3, 0.55, 5)):
        ph = R(0, 6.3)
        for k in range(n):
            az = ph + 2 * math.pi * k / n + R(-0.15, 0.15)
            out = Vector((math.cos(az), math.sin(az), 0)); tan = Vector((-out.y, out.x, 0))
            p = PN_C + out * PN_R * rf * R(0.92, 1.05) + UP * PN_RZ * (zf + R(-0.15, 0.15))
            s = R(1.5, 1.9)
            card(m, p, tan * s, UP * s * 0.75, PINE, nrm, pn_ao)  # face-on from outside
            card(m, p + UP * 0.15, out * s * 0.8, UP * s * 0.7, PINE, nrm, pn_ao)  # crossed, for the views along the rim
    return m

def pine_lo():
    m = Mesh()
    tube(m, [Vector((0, 0, -0.4)), Vector((0.55, 0.2, 8.6))], [0.42, 0.22], 4, BARK['pine'], lambda p: 0.75)
    n = 10; ph = R(0, 6.3)
    rim = lambda zf, rf: [PN_C + Vector((math.cos(ph + 2 * math.pi * j / n) * PN_R * rf * (1 if j % 2 else 0.9), math.sin(ph + 2 * math.pi * j / n) * PN_R * rf * (1 if j % 2 else 0.9), PN_RZ * zf)) for j in range(n)]
    top, mid, bot = PN_C + Vector((0, 0, PN_RZ)), rim(0.1, 1.0), rim(-0.8, 0.7)
    up_rim = rim(0.75, 0.7)
    S_ = SOLID['pine']
    for j in range(n):
        k = (j + 1) % n
        for tri in ((up_rim[j], up_rim[k], top), (mid[j], mid[k], up_rim[k]), (mid[j], up_rim[k], up_rim[j]), (bot[j], mid[k], mid[j]), (bot[j], bot[k], mid[k])):
            m.face(list(tri), [uv_in(S_, 0.5 + (p.x - PN_C.x) / PN_R * 0.45, 0.5 + (p.y - PN_C.y) / PN_R * 0.45) for p in tri],
                   [outward(PN_C, 0.6, (PN_R, PN_R, PN_RZ))(p) for p in tri], [grey(pn_ao(p) * 1.1) for p in tri])
    return m

# --- palm (date palm): 10 m, a ringed, slightly curving trunk and a burst of arching fronds ---
PM_TOP = Vector((0.45, 0, 9.4))
def palm_hi():
    m = Mesh()
    trunk = [Vector((0, 0, -0.4)) + Vector((0.45 * (k / 6) ** 2, 0, k / 6 * 9.8)) for k in range(7)]
    tube(m, trunk, [0.46, 0.34, 0.31, 0.3, 0.29, 0.29, 0.32], 8, BARK['palm'], lambda p: 0.75)
    blob(m, PM_TOP + Vector((0, 0, 0.1)), (0.6, 0.6, 0.7), 0, SOLID['palm'], lambda p: 0.4)
    for i in range(16):
        az = i * 2 * math.pi / 16 * 2.618 % (2 * math.pi)  # spiral phyllotaxis
        el0 = [1.0, 0.55, 0.15][i % 3] + R(-0.15, 0.15)
        L, Wd = R(4.0, 4.8), R(1.6, 1.9)
        d = Vector((math.cos(az), math.sin(az), 0)); side = Vector((-d.y, d.x, 0))
        pts, el, p = [PM_TOP.copy()], el0, PM_TOP.copy()
        for s in range(4):
            p = p + (d * math.cos(el) + UP * math.sin(el)) * L / 4; pts.append(p); el -= 0.38 + 0.1 * (1 - el0)
        for s in range(4):
            t0, t1 = s / 4, (s + 1) / 4
            for sg in (-1, 1):
                lift = UP * 0.22 * Wd / 2  # leaflets rise in a V either side of the rachis
                e0, e1 = pts[s] + side * sg * Wd / 2 + lift, pts[s + 1] + side * sg * Wd / 2 + lift
                q = [pts[s], pts[s + 1], e1, e0]
                uvs = [uv_in(PALM, t0, 0.5), uv_in(PALM, t1, 0.5), uv_in(PALM, t1, 0.5 + sg * 0.5), uv_in(PALM, t0, 0.5 + sg * 0.5)]
                if sg < 0: q, uvs = q[::-1], uvs[::-1]
                m.face(q, uvs, [((x - PM_TOP) * Vector((1, 1, 0.4)) + UP * 1.2).normalized() for x in q], [grey(0.55 + 0.45 * (t if t else 0)) for t in (t0, t1, t1, t0)][::(-1 if sg < 0 else 1)])
    return m

def palm_lo():
    m = Mesh()
    tube(m, [Vector((0, 0, -0.4)), Vector((0.12, 0, 5)), Vector((0.45, 0, 9.4))], [0.46, 0.3, 0.3], 5, BARK['palm'], lambda p: 0.75)
    for i in range(7):
        az = i * 2 * math.pi / 7 + 0.3; el0 = [0.8, 0.3][i % 2]
        L, Wd = 4.4, 1.8
        d = Vector((math.cos(az), math.sin(az), 0)); side = Vector((-d.y, d.x, 0))
        pts, el, p = [PM_TOP.copy()], el0, PM_TOP.copy()
        for s in range(2):
            p = p + (d * math.cos(el) + UP * math.sin(el)) * L / 2; pts.append(p); el -= 0.9
        for s in range(2):
            t0, t1 = s / 2, (s + 1) / 2
            q = [pts[s] - side * Wd / 2, pts[s] + side * Wd / 2, pts[s + 1] + side * Wd / 2, pts[s + 1] - side * Wd / 2]
            m.face(q, [uv_in(PALM, t0, 0), uv_in(PALM, t0, 1), uv_in(PALM, t1, 1), uv_in(PALM, t1, 0)], [UP] * 4, [grey(0.6 + 0.4 * t) for t in (t0, t0, t1, t1)])
    return m

# ---------------------------------------------------------------- objects and export --------------------------------
def to_object(name, m):
    me = bpy.data.meshes.new(name)
    me.from_pydata(m.v, [], m.f)
    me.materials.append(mat)
    uv = me.uv_layers.new(name='UVMap')
    for i, l in enumerate(me.loops): uv.data[i].uv = m.uv[l.index]
    col = me.color_attributes.new('Color', 'FLOAT_COLOR', 'CORNER')
    for i, l in enumerate(me.loops): col.data[i].color = m.c[l.index]
    me.color_attributes.active_color = col
    for p in me.polygons: p.use_smooth = True
    me.normals_split_custom_set([tuple(m.n[l.index]) for l in me.loops])
    me.validate(); me.update()
    o = bpy.data.objects.new(name, me); scene.collection.objects.link(o)
    print(f'{name}: {m.tris()} tris')
    return o

objs = []
for sp, hi, lo in (('spruce', spruce_hi, spruce_lo), ('broadleaf', broadleaf_hi, broadleaf_lo), ('pine', pine_hi, pine_lo), ('palm', palm_hi, palm_lo)):
    objs += [to_object(f'{sp}_hi', hi()), to_object(f'{sp}_lo', lo())]

if PREVIEW:
    for k, o in enumerate(objs): o.location = ((k // 2) * 14 - 21, (k % 2) * 40, 0)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); scene.collection.objects.link(cam)
    cam.location = (0, -48, 7); cam.rotation_euler = (math.radians(86), 0, 0); cam.data.lens = 28
    scene.camera = cam
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')); scene.collection.objects.link(sun)
    sun.data.energy = 4; sun.rotation_euler = (math.radians(50), 0, math.radians(30))
    scene.world = bpy.data.worlds.new('w'); scene.world.use_nodes = True
    scene.world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.55, 0.65, 0.8, 1)
    scene.render.engine = 'BLENDER_EEVEE'
    scene.render.resolution_x, scene.render.resolution_y = 1600, 800
    scene.render.filepath = PREVIEW
    bpy.ops.render.render(write_still=True)
    for o in objs: o.location = (0, 0, 0)

bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', export_image_format='WEBP', export_image_quality=82,
                          export_vertex_color='ACTIVE', export_normals=True, export_apply=True, export_cameras=False, export_lights=False)
