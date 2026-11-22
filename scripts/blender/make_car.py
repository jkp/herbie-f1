# Builds the 2022-era F1 car the game races, entirely from code, and exports it as glTF.
# Usage: blender -b -P scripts/blender/make_car.py -- <out.glb> [preview.png]
# (scripts/build-car.mjs runs this, then optimises the result into src/assets/car.glb.)
#
# Everything below is written in GAME coordinates: x = nose direction, y = up, z = the car's right-hand... side
# axis (wheels at z = +-0.82). Blender is z-up, so G() maps game (x, y, z) to Blender (x, -z, y); the Y-up glTF
# export maps it straight back.
import bpy, bmesh, math, sys
from mathutils import Vector

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = argv[0] if argv else '/tmp/car.glb'
PREVIEW = argv[1] if len(argv) > 1 else None

def G(x, y, z):
    return Vector((x, -z, y))

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

# --- materials: the game swaps these for per-team ones by name ---
def material(name, rgb, rough=0.5, metal=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*rgb, 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    return m

MATS = {
    'paint': material('paint', (0.75, 0.02, 0.03), 0.35),
    'accent': material('accent', (0.95, 0.85, 0.1), 0.35),
    'carbon': material('carbon', (0.012, 0.013, 0.015), 0.45, 0.3),
    'tyre': material('tyre', (0.012, 0.012, 0.012), 0.9),
    'rim': material('rim', (0.12, 0.125, 0.13), 0.3, 0.9),
    'stripe': material('stripe', (0.8, 0.05, 0.05), 0.6),
    'helmet': material('helmet', (0.95, 0.85, 0.1), 0.25),
    'visor': material('visor', (0.01, 0.01, 0.015), 0.08, 0.8),
}
ORDER = list(MATS)

def obj_from(name, verts, faces, mats=None, smooth=True):
    """Mesh object from game-space verts; mats is a per-face material name list (or one name)."""
    me = bpy.data.meshes.new(name)
    me.from_pydata([G(*v) for v in verts], [], faces)
    for n in ORDER: me.materials.append(MATS[n])
    if mats is not None:
        per = mats if isinstance(mats, list) else [mats] * len(faces)
        for p, n in zip(me.polygons, per): p.material_index = ORDER.index(n)
    for p in me.polygons: p.use_smooth = smooth
    me.validate(); me.update()
    o = bpy.data.objects.new(name, me)
    scene.collection.objects.link(o)
    return o

def subsurf(o, levels=1):
    m = o.modifiers.new('subsurf', 'SUBSURF'); m.levels = levels; m.render_levels = levels
    return o

def section(st, M):
    """Superellipse ring for a loft station: (x, hw_top, hw_bot, y_bot, y_top, power, zc)."""
    x, hwt, hwb, yb, yt, p, zc = st[:7]
    pts = []
    for k in range(M):
        a = 2 * math.pi * k / M
        c, s = math.cos(a), math.sin(a)
        u = math.copysign(abs(c) ** (2 / p), c); v = math.copysign(abs(s) ** (2 / p), s)
        f = min(1, max(0, (v + 1) / 1.3)); f = f * f * (3 - 2 * f)  # full-width upper body, tucked-in (undercut) bottom
        hw = hwb + (hwt - hwb) * f
        pts.append((x, (yb + yt) / 2 + v * (yt - yb) / 2, zc + u * hw))
    return pts

def loft(name, stations, mat, M=16, cap0=None, cap1=None, levels=1):
    """Smooth body through cross-sections (x, hw_top, hw_bot, y_bot, y_top, power[, zc[, material of the band to the
    next ring]]). Rings may run backwards to fold a lip into a recessed intake; caps take their own material."""
    st = [s if len(s) >= 7 else (*s, 0.0) for s in stations]
    verts, faces, mats = [], [], []
    for s in st: verts += section(s, M)
    for i in range(len(st) - 1):
        for k in range(M):
            a, b = i * M + k, i * M + (k + 1) % M
            faces.append((a, b, b + M, a + M)); mats.append(st[i][7] if len(st[i]) > 7 else mat)
    faces.append(tuple(reversed(range(M)))); mats.append(cap0 or mat)
    n = (len(st) - 1) * M
    faces.append(tuple(range(n, n + M))); mats.append(cap1 or mat)
    o = obj_from(name, verts, faces, mats)
    o.data.polygons[-2].use_smooth = o.data.polygons[-1].use_smooth = False
    return subsurf(o, levels)

def prism(name, outline, y0, y1, mat, bevel=0.0, plane='xz', z=0.0):
    """Outline extruded: plane 'xz' = top-view outline between heights y0..y1; 'xy' = side-view outline between z0..z1."""
    n = len(outline)
    if plane == 'xz': verts = [(x, y0, zz) for x, zz in outline] + [(x, y1, zz) for x, zz in outline]
    else: verts = [(x, yy, y0) for x, yy in outline] + [(x, yy, y1) for x, yy in outline]
    faces = [tuple(reversed(range(n))), tuple(range(n, 2 * n))] + [(k, (k + 1) % n, (k + 1) % n + n, k + n) for k in range(n)]
    o = obj_from(name, verts, faces, mat, smooth=False)
    bm = bmesh.new(); bm.from_mesh(o.data); bmesh.ops.recalc_face_normals(bm, faces=bm.faces); bm.to_mesh(o.data); bm.free()
    if bevel:
        b = o.modifiers.new('bevel', 'BEVEL'); b.width = bevel; b.segments = 2; b.limit_method = 'ANGLE'
        o.modifiers.new('wn', 'WEIGHTED_NORMAL')
    return o

def airfoil(n=8, t=0.12, camber=0.05):
    """Unit-chord cambered section (x from leading edge 0 to trailing edge 1, y up), as a closed loop."""
    up, lo = [], []
    for i in range(n + 1):
        x = (1 - math.cos(math.pi * i / n)) / 2
        yt = 5 * t * (0.2969 * math.sqrt(x) - 0.126 * x - 0.3516 * x * x + 0.2843 * x ** 3 - 0.1036 * x ** 4)
        yc = camber * 4 * x * (1 - x)
        up.append((x, yc + yt)); lo.append((x, yc - yt))
    return up + list(reversed(lo[1:-1]))

def wing(name, spans, mat, foil=None, levels=0):
    """Wing swept through span stations (z, x_le, y_le, chord, angle_deg); positive angle lifts the trailing edge
    (an inverted, downforce-making element on a car facing +x)."""
    foil = foil or airfoil()
    M = len(foil)
    verts, faces = [], []
    for z, xle, yle, c, ang in spans:
        a = math.radians(ang)
        for fx, fy in foil:
            # chord runs towards -x; rotate so the trailing edge rises by `ang`
            dx, dy = -fx * c, -fy * c  # inverted: the camber faces down
            verts.append((xle + dx * math.cos(a), yle - dx * math.sin(a) + dy * math.cos(a), z))
    for i in range(len(spans) - 1):
        for k in range(M):
            a, b = i * M + k, i * M + (k + 1) % M
            faces.append((a, b, b + M, a + M))
    faces.append(tuple(range(M))); faces.append(tuple(reversed(range((len(spans) - 1) * M, len(spans) * M))))
    o = obj_from(name, verts, faces, mat)
    bm = bmesh.new(); bm.from_mesh(o.data); bmesh.ops.recalc_face_normals(bm, faces=bm.faces); bm.to_mesh(o.data); bm.free()
    for p in o.data.polygons[-2:]: p.use_smooth = False
    return subsurf(o, levels) if levels else o

def rod(name, a, b, r, mat, flat=1.0, n=6):
    """Suspension member from a to b (game space), elliptical so it reads as an aero-faired arm."""
    a, b = Vector(a), Vector(b)
    d = (b - a).normalized()
    side = d.cross(Vector((0, 1, 0)))
    if side.length < 1e-3: side = d.cross(Vector((1, 0, 0)))
    side.normalize(); up = side.cross(d)
    verts = []
    for p in (a, b):
        for k in range(n):
            t = 2 * math.pi * k / n
            verts.append(tuple(p + side * math.cos(t) * r + up * math.sin(t) * r * flat))
    faces = [(k, (k + 1) % n, (k + 1) % n + n, k + n) for k in range(n)]
    return obj_from(name, verts, faces, mat)

def lathe(name, profile, segs, mats):
    """Revolve a closed (radius, z) profile about the game z axis (the axle). mats[i] colours segment i->i+1."""
    P = len(profile)
    verts = []
    for s in range(segs):
        a = 2 * math.pi * s / segs
        for r, z in profile: verts.append((r * math.cos(a), r * math.sin(a), z))
    faces, fm = [], []
    for s in range(segs):
        s2 = (s + 1) % segs
        for i in range(P - 1):
            faces.append((s * P + i, s * P + i + 1, s2 * P + i + 1, s2 * P + i)); fm.append(mats[i])
    o = obj_from(name, verts, faces, fm)
    bm = bmesh.new(); bm.from_mesh(o.data)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces); bm.to_mesh(o.data); bm.free()
    o.data.update()
    return o

body_parts = []
def part(o):
    body_parts.append(o); return o

# --- monocoque and nose: one smooth loft, cockpit cut out of the top ---
chassis = part(loft('chassis', [
    (3.10, 0.06, 0.07, 0.205, 0.27, 2.6),
    (2.95, 0.11, 0.12, 0.195, 0.31, 2.6),
    (2.55, 0.15, 0.15, 0.20, 0.39, 2.6),
    (2.05, 0.19, 0.17, 0.20, 0.47, 2.6),
    (1.55, 0.24, 0.20, 0.18, 0.56, 2.8),
    (1.05, 0.29, 0.24, 0.14, 0.63, 3.0),
    (0.55, 0.33, 0.28, 0.12, 0.69, 3.2),
    (0.0, 0.34, 0.30, 0.12, 0.71, 3.2),
    (-0.5, 0.30, 0.26, 0.12, 0.66, 3.2),
], 'paint', M=20))
cut = loft('cockpit_cut', [
    (0.96, 0.10, 0.10, 0.50, 1.2, 3), (0.85, 0.20, 0.20, 0.42, 1.2, 3), (0.5, 0.245, 0.245, 0.40, 1.2, 4),
    (0.08, 0.25, 0.25, 0.40, 1.2, 4), (-0.02, 0.20, 0.20, 0.40, 1.2, 3),
], 'carbon', M=16, levels=0)
cut.display_type = 'WIRE'; cut.hide_render = True
bool_ = chassis.modifiers.new('cockpit', 'BOOLEAN'); bool_.object = cut; bool_.operation = 'DIFFERENCE'; bool_.solver = 'EXACT'
bool_.material_mode = 'TRANSFER'

# headrest pads round the driver's head and shoulders
part(subsurf(prism('headrest', [(0.22, -0.24), (0.22, 0.24), (0.04, 0.26), (0.0, 0), (0.04, -0.26)], 0.6, 0.82, 'carbon', bevel=0.03), 1))
for zs in (-1, 1):
    part(subsurf(prism(f'pad{zs}', [(0.5, zs * 0.21), (0.5, zs * 0.26), (0.15, zs * 0.27), (0.15, zs * 0.22)], 0.6, 0.76, 'carbon', bevel=0.02), 1))
# seat back and steering column shadowed in the cockpit
part(prism('seat', [(0.12, -0.2), (0.12, 0.2), (-0.02, 0.2), (-0.02, -0.2)], 0.38, 0.62, 'carbon'))

# --- engine cover with airbox intake, sweeping down to the gearbox ---
part(loft('engine_cover', [
    (-0.02, 0.05, 0.06, 0.86, 0.95, 2.4, 0, 'carbon'),
    (0.11, 0.075, 0.085, 0.835, 0.985, 2.4, 0, 'carbon'),
    (0.13, 0.095, 0.105, 0.815, 1.0, 2.4),
    (0.08, 0.12, 0.15, 0.62, 1.03, 2.6),
    (-0.25, 0.15, 0.19, 0.45, 0.98, 2.8),
    (-0.75, 0.16, 0.2, 0.32, 0.81, 3.0),
    (-1.25, 0.13, 0.16, 0.28, 0.63, 3.0),
    (-1.75, 0.095, 0.11, 0.28, 0.5, 2.8),
    (-2.06, 0.07, 0.075, 0.29, 0.42, 2.6),
], 'paint', M=20, cap0='carbon', cap1='carbon'))
# roll-hoop blade above the intake
part(prism('hoop', [(0.12, 0.985), (0.0, 1.06), (-0.35, 1.02), (-0.2, 0.98)], -0.02, 0.02, 'carbon', plane='xy', bevel=0.008))
# shark fin
part(prism('fin', [(-0.3, 1.0), (-0.75, 0.88), (-1.25, 0.7), (-1.55, 0.6), (-1.55, 0.55), (-1.25, 0.6), (-0.75, 0.78), (-0.4, 0.95)], -0.006, 0.006, 'accent', plane='xy'))

# --- sidepods: deep undercut, inlet at the front, tapering into the coke bottle ---
for zs in (-1, 1):
    part(loft(f'sidepod{zs}', [
        (0.64, 0.2, 0.12, 0.45, 0.56, 3.4, zs * 0.46, 'carbon'),   # inside the inlet
        (0.80, 0.25, 0.15, 0.425, 0.595, 3.6, zs * 0.46),
        (0.83, 0.275, 0.16, 0.41, 0.615, 3.6, zs * 0.46),            # inlet lip
        (0.76, 0.31, 0.12, 0.35, 0.635, 4.0, zs * 0.45),
        (0.45, 0.33, 0.07, 0.22, 0.64, 4.0, zs * 0.43),
        (-0.15, 0.31, 0.07, 0.17, 0.61, 4.0, zs * 0.41),
        (-0.75, 0.24, 0.07, 0.15, 0.52, 3.6, zs * 0.36),
        (-1.25, 0.15, 0.06, 0.15, 0.4, 3.0, zs * 0.3),
        (-1.65, 0.06, 0.04, 0.17, 0.29, 2.6, zs * 0.23),
    ], 'paint', M=16, cap0='carbon'))

# --- floor: plank, edge wing, fences and diffuser ---
floor_outline = [(1.45, -0.32), (1.45, 0.32), (1.05, 0.62), (0.8, 0.86), (-1.25, 0.86), (-1.45, 0.62),
                 (-2.08, 0.5), (-2.08, -0.5), (-1.45, -0.62), (-1.25, -0.86), (0.8, -0.86), (1.05, -0.62)]
part(prism('floor', floor_outline, 0.05, 0.085, 'carbon', bevel=0.01))
part(prism('plank', [(1.4, -0.15), (1.4, 0.15), (-1.4, 0.15), (-1.4, -0.15)], 0.0, 0.05, 'carbon'))
for zs in (-1, 1):
    # the edge wing curling up at the floor's outer edge
    part(wing(f'edgewing{zs}', [(zs * 0.82, 0.55, 0.16, 0.6, 6), (zs * 0.88, 0.55, 0.16, 0.6, 6)], 'carbon', airfoil(6, 0.1, 0.06)))
    part(prism(f'edgestay{zs}', [(0.5, zs * 0.85), (0.5, zs * 0.86), (-0.6, zs * 0.86), (-0.6, zs * 0.85)], 0.085, 0.16, 'carbon'))
    # floor fences ahead of the sidepods
    for k, z in enumerate((0.38, 0.5, 0.62)):
        part(prism(f'fence{zs}{k}', [(1.4 - k * 0.12, 0.085), (1.15 - k * 0.12, 0.2), (0.9 - k * 0.12, 0.2), (0.85 - k * 0.12, 0.085)],
                   zs * z - 0.005, zs * z + 0.005, 'carbon', plane='xy'))
    # diffuser side walls
    part(prism(f'diffwall{zs}', [(-1.45, 0.085), (-2.08, 0.32), (-2.08, 0.085)], zs * 0.5 - 0.01, zs * 0.5 + 0.01, 'carbon', plane='xy'))
part(prism('diffuser', [(-1.45, 0.07), (-2.08, 0.3), (-2.08, 0.33), (-1.45, 0.1)], -0.5, 0.5, 'carbon', plane='xy'))

# --- front wing: four elements, rising outboard; upper flaps in the team colours; curved endplates ---
def fw_spans(k, chord, ang, lift):
    out = []
    for z in [-0.97, -0.85, -0.7, -0.5, -0.3, -0.12, 0.12, 0.3, 0.5, 0.7, 0.85, 0.97]:
        u = abs(z)
        rise = 0.05 * max(0, (u - 0.25) / 0.72) ** 1.5   # elements sweep up towards the endplates
        c = chord * (0.75 + 0.25 * min(1, u / 0.3)) if k else chord
        xle = 3.33 - sum(FW[j][0] * 0.62 for j in range(k)) - 0.03 * (u > 0.3) * k
        yle = 0.075 + lift + rise * (1 + k * 0.6)
        out.append((z, xle, yle, c, ang + (6 * max(0, u - 0.3) if k else 0)))
    return out
FW = [(0.34, 3), (0.2, 14), (0.17, 26), (0.15, 38)]
lift = 0.0
for k, (c, ang) in enumerate(FW):
    part(wing(f'fw{k}', fw_spans(k, c, ang, lift), ['carbon', 'paint', 'paint', 'accent'][k], airfoil(8, 0.1, 0.05)))
    lift += c * math.sin(math.radians(ang)) * 0.62 + 0.012
for zs in (-1, 1):
    part(prism(f'fw_endplate{zs}', [(3.32, 0.03), (3.35, 0.09), (3.27, 0.2), (3.05, 0.27), (2.8, 0.29), (2.7, 0.25), (2.72, 0.03)],
                 zs * 0.975 - 0.01, zs * 0.975 + 0.01, 'carbon', plane='xy', bevel=0.008))
    # nose pylons onto the main plane
    part(prism(f'fw_pylon{zs}', [(3.08, 0.1), (2.92, 0.1), (2.88, 0.21), (3.0, 0.21)], zs * 0.06 - 0.008, zs * 0.06 + 0.008, 'carbon', plane='xy'))

# --- rear wing: spoon main plane + DRS flap curling into the endplates, beam wing below, swan-neck pylons ---
def rw_spans(xle, y, chord, ang):
    out = []
    for z in [-0.52, -0.49, -0.45, -0.38, -0.2, 0.0, 0.2, 0.38, 0.45, 0.49, 0.52]:
        u = abs(z)
        roll = max(0, (u - 0.38) / 0.14)
        out.append((z, xle - 0.04 * roll, y - 0.12 * roll ** 2 + 0.02 * (1 - u / 0.52), chord * (1 - 0.15 * roll), ang))
    return out
part(wing('rw_main', rw_spans(-1.96, 0.80, 0.36, 10), 'paint', airfoil(10, 0.11, 0.06)))
part(wing('rw_flap', rw_spans(-2.24, 0.885, 0.2, 38), 'accent', airfoil(8, 0.1, 0.05)))
for zs in (-1, 1):
    part(prism(f'rw_endplate{zs}', [(-1.92, 0.44), (-1.93, 0.62), (-1.99, 0.7), (-2.12, 0.74), (-2.37, 0.82), (-2.39, 0.56), (-2.3, 0.42)],
                 zs * 0.53 - 0.01, zs * 0.53 + 0.01, 'paint', plane='xy', bevel=0.008))
    part(prism(f'rw_pylon{zs}', [(-1.95, 0.4), (-2.05, 0.4), (-2.12, 0.82), (-2.04, 0.84)], zs * 0.05 - 0.008, zs * 0.05 + 0.008, 'carbon', plane='xy'))
part(wing('beam0', [(-0.42, -2.06, 0.4, 0.2, 6), (0.42, -2.06, 0.4, 0.2, 6)], 'carbon', airfoil(6, 0.12, 0.05)))
part(wing('beam1', [(-0.42, -2.22, 0.45, 0.14, 24), (0.42, -2.22, 0.45, 0.14, 24)], 'carbon', airfoil(6, 0.12, 0.05)))
part(subsurf(prism('drs_pod', [(-2.25, 0.91), (-2.2, 0.98), (-2.32, 0.99), (-2.36, 0.93)], -0.025, 0.025, 'carbon', plane='xy', bevel=0.01), 1))
# crash structure and rain light
part(subsurf(prism('crash', [(-1.95, 0.27), (-2.3, 0.3), (-2.3, 0.38), (-1.95, 0.42)], -0.07, 0.07, 'carbon', plane='xy', bevel=0.02), 1))

# --- halo: hoop round the head on a centre pillar ---
def tube(name, pts, r, mat, res=4):
    cu = bpy.data.curves.new(name, 'CURVE'); cu.dimensions = '3D'
    sp = cu.splines.new('NURBS'); sp.points.add(len(pts) - 1)
    for p, q in zip(sp.points, pts): p.co = (*G(*q), 1)
    sp.order_u = 4; sp.use_endpoint_u = True
    cu.bevel_depth = r; cu.bevel_resolution = 2; cu.resolution_u = res; cu.use_fill_caps = True
    o = bpy.data.objects.new(name, cu); scene.collection.objects.link(o)
    bpy.context.view_layer.objects.active = o; o.select_set(True)
    bpy.ops.object.convert(target='MESH'); o.select_set(False)
    o.data.materials.clear()
    for n in ORDER: o.data.materials.append(MATS[n])
    for p in o.data.polygons: p.material_index = ORDER.index(mat); p.use_smooth = True
    return o
part(tube('halo', [(0.02, 0.66, 0.29), (0.08, 0.88, 0.3), (0.3, 0.965, 0.295), (0.56, 0.955, 0.2), (0.68, 0.94, 0.0),
                   (0.56, 0.955, -0.2), (0.3, 0.965, -0.295), (0.08, 0.88, -0.3), (0.02, 0.66, -0.29)], 0.026, 'carbon', 6))
part(tube('halo_pillar', [(0.66, 0.94, 0.0), (0.75, 0.86, 0.0), (0.86, 0.74, 0.0), (0.92, 0.66, 0.0)], 0.022, 'carbon'))

# --- mirrors on stalks off the sidepods ---
for zs in (-1, 1):
    part(subsurf(prism(f'mirror{zs}', [(0.86, zs * 0.42), (0.86, zs * 0.62), (0.78, zs * 0.62), (0.78, zs * 0.42)], 0.8, 0.875, 'paint', bevel=0.015), 1))
    part(rod(f'mirror_stalk{zs}', (0.8, 0.64, zs * 0.46), (0.82, 0.81, zs * 0.5), 0.012, 'carbon'))
    part(rod(f'mirror_glass{zs}', (0.866, 0.838, zs * 0.44), (0.866, 0.838, zs * 0.60), 0.026, 'carbon', 0.9, 4))

# --- suspension: double wishbones, push/pull rods, track rods, uprights ---
def wishbone(tag, hub_x, inner_z, top, rear=False):
    s = []
    for zs in (-1, 1):
        oz = zs * 0.66
        y_u, y_l = (0.53, 0.22) if not rear else (0.5, 0.2)
        # upper and lower A-arms
        for y, iy in ((y_u, y_u + (0.03 if not rear else 0.0)), (y_l, y_l + 0.05)):
            s.append(rod(f'{tag}a{zs}{y}', (hub_x + 0.28, iy, zs * inner_z), (hub_x, y, oz), 0.017, 'carbon', 0.4))
            s.append(rod(f'{tag}b{zs}{y}', (hub_x - 0.3, iy, zs * inner_z), (hub_x, y, oz), 0.017, 'carbon', 0.4))
        # push rod (front) / pull rod (rear) and the steering/toe link
        if rear: s.append(rod(f'{tag}p{zs}', (hub_x - 0.05, 0.48, zs * 0.62), (hub_x + 0.2, 0.2, zs * inner_z), 0.014, 'carbon', 0.6))
        else: s.append(rod(f'{tag}p{zs}', (hub_x - 0.04, 0.24, zs * 0.62), (hub_x - 0.25, top, zs * inner_z), 0.014, 'carbon', 0.6))
        s.append(rod(f'{tag}t{zs}', (hub_x + (0.12 if not rear else -0.12), 0.36, zs * inner_z), (hub_x + (0.12 if not rear else -0.12), 0.38, zs * 0.62), 0.012, 'carbon', 0.6))
        # upright and brake duct inside the wheel
        s.append(subsurf(prism(f'{tag}u{zs}', [(hub_x + 0.13, 0.2), (hub_x + 0.13, 0.54), (hub_x - 0.13, 0.54), (hub_x - 0.13, 0.2)],
                               zs * 0.6, zs * 0.66, 'carbon', plane='xy', bevel=0.02), 1))
    for o in s: part(o)
wishbone('fs', 1.85, 0.2, 0.55)
wishbone('rs', -1.75, 0.14, 0.5, rear=True)

# --- wheels: 18" rims with covers inside low-profile tyres, rounded sidewalls, compound stripe band ---
def wheel(name, hub, width, side):
    R, w, rim_r = 0.36, width / 2, 0.235
    e = 0.05  # shoulder radius
    prof, mats = [], []
    # profile runs inner bead -> inner sidewall -> tread -> outer sidewall -> outer bead (z towards `side`)
    def add(r, z, m): prof.append((r, z * side)); mats.append(m)
    add(rim_r, -w + 0.012, 'tyre')
    add(0.27, -w - 0.006, 'stripe'); add(0.29, -w - 0.007, 'tyre')
    add(R - e, -w - 0.004, 'tyre')
    for i in range(1, 5):
        a = math.pi / 2 * i / 4
        add(R - e + e * math.sin(a), -w + e - e * math.cos(a) - 0.004 * (1 - math.sin(a)), 'tyre')
    add(R, 0, 'tyre')
    for i in range(4, -1, -1):
        a = math.pi / 2 * i / 4
        add(R - e + e * math.sin(a), w - e + e * math.cos(a) + 0.004 * (1 - math.sin(a)), 'tyre' if i else 'tyre')
    add(0.29, w + 0.007, 'stripe'); add(0.27, w + 0.006, 'tyre')
    add(rim_r, w - 0.012, 'rim')
    # rim lip, aero wheel cover and hub nut on the outboard face, open barrel inside
    add(rim_r - 0.01, w - 0.025, 'rim')
    add(0.08, w - 0.03, 'rim'); add(0.05, w + 0.0, 'rim'); add(0.0, w + 0.005, 'rim')
    # rim barrel and dark inner face back to the inner bead
    prof2 = [(0.0, -w + 0.04), (0.12, -w + 0.04), (rim_r - 0.01, -w + 0.02), (rim_r - 0.005, -w + 0.012)]
    o = lathe(name, prof, 40, mats[:-1])
    inner = lathe(name + '_in', [(r, z * side) for r, z in prof2], 40, ['rim', 'rim', 'rim'])
    for ob in (o, inner): ob.location = G(*hub)
    bpy.context.view_layer.objects.active = o
    for ob in bpy.context.view_layer.objects: ob.select_set(False)
    o.select_set(True); inner.select_set(True); bpy.ops.object.join(); o.select_set(False)
    return o

wheels = [wheel('wheel_FL', (1.85, 0.36, 0.82), 0.3, 1), wheel('wheel_FR', (1.85, 0.36, -0.82), 0.3, -1),
          wheel('wheel_RL', (-1.75, 0.36, 0.82), 0.4, 1), wheel('wheel_RR', (-1.75, 0.36, -0.82), 0.4, -1)]

# --- driver's helmet and visor (hidden in game when the player's real driver is seated) ---
HC = (0.32, 0.86, 0.0)
bpy.ops.mesh.primitive_uv_sphere_add(segments=20, ring_count=12, radius=0.15, location=G(*HC))
helmet = bpy.context.active_object; helmet.name = 'helmet'; helmet.data.name = 'helmet'
helmet.scale = (1.08, 0.95, 1.0)
helmet.data.materials.append(MATS['helmet'])
bpy.ops.object.shade_smooth()
bpy.ops.mesh.primitive_uv_sphere_add(segments=20, ring_count=12, radius=0.153, location=G(*HC))
visor = bpy.context.active_object; visor.name = 'visor'; visor.data.name = 'visor'
visor.scale = helmet.scale
bm = bmesh.new(); bm.from_mesh(visor.data)
# keep only the eye-level band at the front (game +x; Blender +x, up is Blender z)
bmesh.ops.delete(bm, geom=[f for f in bm.faces if not (f.normal.x > 0.45 and -0.12 < f.normal.z < 0.42)], context='FACES')
bm.to_mesh(visor.data); bm.free()
visor.data.materials.append(MATS['visor'])
bpy.ops.object.shade_smooth()

# --- join the body into one object (one draw call per material) ---
for o in bpy.context.view_layer.objects: o.select_set(False)
bpy.context.view_layer.objects.active = chassis
dg = bpy.context.evaluated_depsgraph_get()
for o in body_parts:
    if not o.modifiers: continue
    me = bpy.data.meshes.new_from_object(o.evaluated_get(dg), preserve_all_data_layers=True, depsgraph=dg)
    assert len(me.polygons), f'{o.name} evaluated to nothing'
    o.modifiers.clear(); o.data = me
bpy.data.objects.remove(cut)
bpy.context.view_layer.objects.active = chassis
for o in body_parts: o.select_set(True)
bpy.ops.object.join()
body = chassis; body.name = 'body'; body.data.name = 'body'
for o in bpy.context.view_layer.objects: o.select_set(False)
# drop unused material slots so the glTF only carries what each mesh uses
for o in [body, *wheels]:
    bpy.context.view_layer.objects.active = o; o.select_set(True)
    bpy.ops.object.material_slot_remove_unused(); o.select_set(False)

# --- where the race number goes: on top of the nose, tilted with it ---
dg = bpy.context.evaluated_depsgraph_get()
hit, loc, nrm, *_ = scene.ray_cast(dg, G(2.15, 2.0, 0.0), Vector((0, 0, -1)))
assert hit, 'number ray missed the nose'
num = bpy.data.objects.new('number', None); scene.collection.objects.link(num)
num.location = loc + nrm * 0.004
num.rotation_euler = (0, math.atan2(nrm.x, nrm.z), 0)

# --- ambient occlusion baked into the body's vertex colours ---
scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = 64
for o in bpy.context.view_layer.objects: o.select_set(False)
body.data.color_attributes.new('ao', 'BYTE_COLOR', 'POINT')
body.data.color_attributes.active_color_name = 'ao'
body.select_set(True); bpy.context.view_layer.objects.active = body
scene.render.bake.target = 'VERTEX_COLORS'
bpy.ops.object.bake(type='AO')
# lift the darkest creases a little: AO multiplies the livery colour in the game
for d in body.data.color_attributes['ao'].data:
    c = d.color; v = 0.25 + 0.75 * c[0]; d.color = (v, v, v, 1)
body.select_set(False)

# --- export: Y-up glTF, modifiers applied, AO as COLOR_0 ---
export = [body, *wheels, helmet, visor, num]
for o in export: o.select_set(True)
bpy.ops.export_scene.gltf(filepath=OUT, export_format='GLB', use_selection=True, export_apply=True, export_yup=True,
                          export_vertex_color='ACTIVE', export_materials='EXPORT')
tris = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in export if o.type == 'MESH')
print(f'CAR exported {OUT}: {tris} triangles')

# --- preview render ---
if PREVIEW:
    MATS['paint'].node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.02, 0.06, 0.4, 1)
    MATS['accent'].node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.1, 0.6, 0.95, 1)
    for m in MATS.values():
        nt = m.node_tree
        if m.name in ('paint', 'accent', 'carbon'):
            attr = nt.nodes.new('ShaderNodeVertexColor'); attr.layer_name = 'ao'
            mix = nt.nodes.new('ShaderNodeMix'); mix.data_type = 'RGBA'; mix.blend_type = 'MULTIPLY'; mix.inputs['Factor'].default_value = 1
            b = nt.nodes['Principled BSDF']
            mix.inputs['A'].default_value = b.inputs['Base Color'].default_value
            nt.links.new(attr.outputs['Color'], mix.inputs['B']); nt.links.new(mix.outputs['Result'], b.inputs['Base Color'])
    bpy.ops.mesh.primitive_plane_add(size=40, location=(0, 0, 0))
    ground = bpy.context.active_object; ground.data.materials.append(material('ground', (0.35, 0.36, 0.38), 0.8))
    world = bpy.data.worlds.new('w'); scene.world = world; world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.55, 0.62, 0.75, 1)
    world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.6
    bpy.ops.object.light_add(type='SUN', rotation=(math.radians(40), math.radians(15), math.radians(30)))
    bpy.context.active_object.data.energy = 4
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam')); scene.collection.objects.link(cam); scene.camera = cam
    cam.data.lens = 50
    scene.render.resolution_x, scene.render.resolution_y = 1400, 800
    scene.cycles.samples = 48
    scene.cycles.use_denoising = True
    base = PREVIEW[:-4]
    for tag, eye in (('front', G(5.2, 2.4, 4.2)), ('nose', G(7.5, 1.4, 2.5)), ('side', G(-0.2, 0.8, 7.5)), ('rear', G(-5.5, 2.2, -3.6)), ('top', G(0.3, 9.0, 0.01))):
        cam.location = eye
        d = G(0.3, 0.45, 0) - eye
        cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()
        scene.render.filepath = f'{base}-{tag}.png' if tag != 'front' else PREVIEW
        bpy.ops.render.render(write_still=True)
