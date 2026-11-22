import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { pointAt, project, type Track } from './track';
import { PIT, boxAt, pitBox, pitLane, pitSide } from './race';
import { makeRelief, type Relief } from './relief';
import { TEAMS, type Team } from './grid';

// Track-space helper: point at index i offset `off` metres to the right of the centreline.
function side(t: Track, i: number, off: number): [number, number] {
  const a = (i - 1 + t.n) % t.n, b = (i + 1) % t.n;
  const h = Math.atan2(t.zs[b] - t.zs[a], t.xs[b] - t.xs[a]);
  return [t.xs[i] - Math.sin(h) * off, t.zs[i] + Math.cos(h) * off];
}
const headingAt = (t: Track, i: number) => {
  const a = (i - 1 + t.n) % t.n, b = (i + 1) % t.n;
  return Math.atan2(t.zs[b] - t.zs[a], t.xs[b] - t.xs[a]);
};

function mulberry32(a: number) {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// --- procedural textures (no image downloads) ---
function noiseTexture(size: number, base: [number, number, number], spread: number, seed: number, stripes = 0) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d')!, img = g.createImageData(size, size), rnd = mulberry32(seed);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const n = (rnd() - 0.5) * spread + (stripes && Math.floor(y / (size / stripes)) % 2 ? 10 : 0), k = (y * size + x) * 4;
      img.data[k] = base[0] + n; img.data[k + 1] = base[1] + n; img.data[k + 2] = base[2] + n; img.data[k + 3] = 255;
    }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  return tex;
}
function textTexture(text: string, bg: string, fg: string, w = 512, h = 128) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d')!;
  g.fillStyle = bg; g.fillRect(0, 0, w, h);
  g.fillStyle = fg; g.font = `900 ${h * 0.62}px "Titillium Web", system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, w / 2, h / 2 + 4);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
let texCache: Record<string, THREE.Texture> | null = null;
const textures = () => texCache ??= {
  asphalt: noiseTexture(256, [64, 66, 70], 26, 1),
  grass: noiseTexture(256, [74, 128, 56], 22, 2, 4),
  gravel: noiseTexture(128, [196, 176, 136], 50, 3),
};

type Offset = number | ((i: number) => number); // metres right of the centreline, fixed or varying along the lap
const at = (o: Offset, i: number) => (typeof o === 'number' ? o : o(i));

/** A flat strip following the lap between lateral offsets `inner` and `outer`. UV: u across, v along (one unit per `vScale` m). */
function strip(t: Track, inner: Offset, outer: Offset, y: Offset, mat: THREE.Material, keep: (i: number) => boolean = () => true,
  colorAt?: (i: number) => THREE.Color, vScale = 10) {
  const pos: number[] = [], uv: number[] = [], col: number[] = [];
  for (let i = 0; i < t.n; i++) {
    if (!keep(i)) continue;
    const j = (i + 1) % t.n, v0 = t.cum[i] / vScale, v1 = (j ? t.cum[j] : t.length) / vScale;
    const [ax, az] = side(t, i, at(inner, i)), [bx, bz] = side(t, i, at(outer, i)), [cx, cz] = side(t, j, at(inner, j)), [dx, dz] = side(t, j, at(outer, j));
    // wound so the face points up (+y)
    const yi = at(y, i), yj = at(y, j);
    pos.push(ax, yi, az, bx, yi, bz, cx, yj, cz, bx, yi, bz, dx, yj, dz, cx, yj, cz);
    uv.push(0, v0, 1, v0, 0, v1, 1, v0, 1, v1, 0, v1);
    if (colorAt) { const c = colorAt(i); for (let k = 0; k < 6; k++) col.push(c.r, c.g, c.b); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  if (colorAt) g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat); m.receiveShadow = true;
  return m;
}

/** A vertical band following the lap at lateral offset `off`, from y0 to y1. */
function wall(t: Track, off: Offset, y0: Offset, y1: Offset, mat: THREE.Material, colorAt?: (i: number) => THREE.Color, keep: (i: number) => boolean = () => true) {
  const pos: number[] = [], uv: number[] = [], col: number[] = [];
  for (let i = 0; i < t.n; i++) {
    if (!keep(i)) continue;
    const j = (i + 1) % t.n, [ax, az] = side(t, i, at(off, i)), [bx, bz] = side(t, j, at(off, j)), u0 = t.cum[i] / 3, u1 = (j ? t.cum[j] : t.length) / 3;
    const a0 = at(y0, i), a1 = at(y1, i), b0 = at(y0, j), b1 = at(y1, j);
    pos.push(ax, a0, az, bx, b0, bz, ax, a1, az, ax, a1, az, bx, b0, bz, bx, b1, bz);
    uv.push(u0, 0, u1, 0, u0, 1, u0, 1, u1, 0, u1, 1);
    if (colorAt) { const c = colorAt(i); for (let k = 0; k < 6; k++) col.push(c.r, c.g, c.b); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  if (colorAt) g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return new THREE.Mesh(g, mat);
}

/** Ground between lateral offsets `inner` and `outer`, each edge at its own height, textured in world space like the ground mesh. */
function groundStrip(t: Track, inner: Offset, outer: Offset, yIn: (i: number, x: number, z: number) => number, yOut: (i: number, x: number, z: number) => number,
  mat: THREE.Material, uvAt: (x: number, z: number) => [number, number], keep: (i: number) => boolean = () => true) {
  const pos: number[] = [], uv: number[] = [];
  for (let i = 0; i < t.n; i++) {
    if (!keep(i)) continue;
    const j = (i + 1) % t.n, a = side(t, i, at(inner, i)), b = side(t, i, at(outer, i)), c = side(t, j, at(inner, j)), d = side(t, j, at(outer, j));
    const A = [a[0], yIn(i, ...a), a[1]], B = [b[0], yOut(i, ...b), b[1]], C = [c[0], yIn(j, ...c), c[1]], D = [d[0], yOut(j, ...d), d[1]];
    for (const v of [A, B, C, B, D, C]) { pos.push(v[0], v[1], v[2]); uv.push(...uvAt(v[0], v[2])); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  const m = new THREE.Mesh(g, mat); m.receiveShadow = true;
  return m;
}

/** Where grandstands go: along the start straight (away from the pits) and on the outside of the big corners. */
export function standSpots(t: Track) {
  const w = t.width / 2, back = w + t.runoff + 16, spots: { x: number; z: number; heading: number; s: number }[] = [];
  const clear = (x: number, z: number, h: number) => [-40, -20, 0, 20, 40].every(a =>
    Math.abs(project(t, x + Math.cos(h) * a, z + Math.sin(h) * a).lateral) > w + t.runoff + 8);
  const pits = pitSide(t), lane = pitLane(t, pits);
  const tryAt = (s: number, dir: number) => {
    s = ((s % t.length) + t.length) % t.length;
    const p = pointAt(t, s), off = dir * back, x = p.x - Math.sin(p.heading) * off, z = p.z + Math.cos(p.heading) * off;
    if (dir === pits && lane.rel(s) > PIT.a - 30 && lane.rel(s) < PIT.d + 30) return; // that's the pit lane and garages
    if (!clear(x, z, p.heading) || spots.some(o => Math.hypot(o.x - x, o.z - z) < 90)) return;
    spots.push({ x, z, heading: p.heading, s });
  };
  for (const s of [60, 160, -120]) tryAt(s, -pits);
  // corners, tightest first: the outside is opposite the turn direction
  const corners: number[] = [];
  for (let i = 0; i < t.n; i++) {
    const k = t.curvature[i];
    if (k > 1 / 150 && k >= t.curvature[(i + 1) % t.n] && k >= t.curvature[(i - 1 + t.n) % t.n]) corners.push(i);
  }
  corners.sort((a, b) => t.curvature[b] - t.curvature[a]);
  for (const i of corners) {
    if (spots.length >= 10) break;
    const turn = Math.sin(headingAt(t, (i + 3) % t.n) - headingAt(t, (i - 3 + t.n) % t.n));
    tryAt(t.cum[i], turn > 0 ? -1 : 1);
    tryAt(t.cum[i] + 60, turn > 0 ? -1 : 1);
  }
  return spots;
}

/** Tiered grandstand with a roof and a seated crowd; front faces +z towards the track (local). */
function grandstand(rnd: () => number, fans: { m: THREE.Matrix4; shirt: THREE.Color; skin: THREE.Color }[], at: THREE.Matrix4) {
  const g = new THREE.Group(), rows = 12, len = 70;
  const concrete = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, roughness: 0.9 });
  const seat = new THREE.MeshStandardMaterial({ color: [0x1d4ed8, 0xdc2626, 0x6b7280][Math.floor(rnd() * 3)], roughness: 0.7 });
  for (let r = 0; r < rows; r++) {
    const step = new THREE.Mesh(new THREE.BoxGeometry(len, 0.6 * (r + 1), 0.9), concrete);
    step.position.set(0, 0.3 * (r + 1), -r * 0.9); step.castShadow = step.receiveShadow = true; g.add(step);
    const seats = new THREE.Mesh(new THREE.BoxGeometry(len - 1, 0.18, 0.4), seat);
    seats.position.set(0, 0.6 * (r + 1) + 0.09, -r * 0.9 - 0.15); g.add(seats);
    for (let k = 0; k < 64; k++) {
      if (rnd() < 0.12) continue; // a few empty seats
      const local = new THREE.Matrix4().makeTranslation(-len / 2 + 1 + k * ((len - 2) / 63) + (rnd() - 0.5) * 0.2, 0.6 * (r + 1) + 0.18, -r * 0.9 - 0.1);
      fans.push({
        m: at.clone().multiply(local),
        shirt: new THREE.Color().setHSL(rnd(), 0.6 + rnd() * 0.3, 0.35 + rnd() * 0.3),
        skin: new THREE.Color().setHSL(0.07, 0.4 + rnd() * 0.2, 0.25 + rnd() * 0.5),
      });
    }
  }
  const roof = new THREE.Mesh(new THREE.BoxGeometry(len + 4, 0.4, rows * 0.9 + 3), new THREE.MeshStandardMaterial({ color: 0xe5e7eb, roughness: 0.5, metalness: 0.3 }));
  roof.position.set(0, 0.6 * rows + 5, -rows * 0.45 + 0.5); roof.rotation.x = -0.08; roof.castShadow = true; g.add(roof);
  for (let k = 0; k <= 4; k++) {
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.6 * rows + 5, 8), concrete);
    col.position.set(-len / 2 + k * len / 4, (0.6 * rows + 5) / 2, -rows * 0.9); g.add(col);
  }
  g.applyMatrix4(at);
  return g;
}

/** Real surroundings from OpenStreetMap: building footprints `[height, x0, z0, x1, z1, …]` and tunnel ranges `[s0, s1]`. */
export interface City { buildings: number[][]; tunnels: number[][]; forests?: number[][][] } // forests: [outer, ...holes] rings of [x0, z0, …]

function facadeTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d')!;
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#d8d8d8'; g.fillRect(0, 56, 64, 8); // floor band
  g.fillStyle = '#4a5866'; g.fillRect(14, 14, 36, 34); // window
  g.fillStyle = '#6b7c8c'; g.fillRect(14, 14, 36, 8);  // sky reflection
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

/** One mesh of walls (windows, one per ~4 m and per floor) and one of roofs, tinted per building. */
function buildCity(buildings: number[][], urban: boolean, rnd: () => number, ground: (x: number, z: number) => number) {
  const wall = { pos: [] as number[], nrm: [] as number[], uv: [] as number[], col: [] as number[] };
  const roof = { pos: [] as number[], nrm: [] as number[], col: [] as number[] };
  const palette = (urban ? [0xf3e6c8, 0xe9cfa3, 0xf2d0b5, 0xffffff, 0xe8dcc4, 0xd9b38c, 0xf5e1a4, 0xf0c8a0] : [0xd6d3cd, 0xbfb8ad, 0xe5e1da, 0xa8a29e, 0xc9c2b8]).map(c => new THREE.Color(c));
  const roofCols = [0x8a8580, 0x6f6a66, 0xa0522d, 0x9c9894].map(c => new THREE.Color(c));
  for (const b of buildings) {
    const h = b[0], pts: [number, number][] = [];
    for (let k = 1; k < b.length; k += 2) pts.push([b[k], b[k + 1]]);
    const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length, cz = pts.reduce((s, p) => s + p[1], 0) / pts.length;
    const col = h > 40 ? new THREE.Color(0xaebfcc) : palette[Math.floor(rnd() * palette.length)];
    // on a slope: the base at the lowest ground under the footprint (sunk a little), the roof the building's height above the middle
    const gs = pts.map(([x, z]) => ground(x, z)), y0 = Math.min(...gs) - 1, top = (Math.min(...gs) + Math.max(...gs)) / 2 + h;
    let u = 0;
    for (let k = 0; k < pts.length; k++) {
      const [ax, az] = pts[k], [bx, bz] = pts[(k + 1) % pts.length], len = Math.hypot(bx - ax, bz - az);
      if (len < 0.01) continue;
      // outward normal: perpendicular to the edge, away from the middle of the building
      let nx = (bz - az) / len, nz = -(bx - ax) / len;
      if (nx * ((ax + bx) / 2 - cx) + nz * ((az + bz) / 2 - cz) < 0) { nx = -nx; nz = -nz; }
      const quad = [[ax, y0, az, u], [bx, y0, bz, u + len], [bx, top, bz, u + len], [ax, top, az, u]];
      // wind each triangle so its face points along the outward normal: (b - a) × up · n
      const flip = -(bz - az) * nx + (bx - ax) * nz < 0;
      const order = flip ? [0, 2, 1, 0, 3, 2] : [0, 1, 2, 0, 2, 3];
      for (const i of order) {
        const [x, y, z, uu] = quad[i];
        wall.pos.push(x, y, z); wall.nrm.push(nx, 0, nz); wall.uv.push(uu / 4, (y - top) / 3.3); wall.col.push(col.r, col.g, col.b);
      }
      u += len;
    }
    const contour = pts.map(([x, z]) => new THREE.Vector2(x, z)), tris = THREE.ShapeUtils.triangulateShape(contour, []);
    const rc = urban || h < 12 ? roofCols[Math.floor(rnd() * roofCols.length)] : roofCols[0];
    for (const [i0, i1, i2] of tris) {
      const [a, bb, c] = [pts[i0], pts[i1], pts[i2]];
      // up-facing: (b - a) × (c - a) must have +y, i.e. clockwise in (x, z)
      const up = (bb[1] - a[1]) * (c[0] - a[0]) - (bb[0] - a[0]) * (c[1] - a[1]) > 0;
      for (const p of up ? [a, bb, c] : [a, c, bb]) { roof.pos.push(p[0], top, p[1]); roof.nrm.push(0, 1, 0); roof.col.push(rc.r, rc.g, rc.b); }
    }
  }
  const geo = (d: { pos: number[]; nrm: number[]; col: number[]; uv?: number[] }) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(d.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(d.nrm, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(d.col, 3));
    if (d.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(d.uv, 2));
    return g;
  };
  const walls = new THREE.Mesh(geo(wall), new THREE.MeshStandardMaterial({ map: facadeTexture(), vertexColors: true, roughness: 0.8 }));
  const roofs = new THREE.Mesh(geo(roof), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }));
  walls.castShadow = roofs.castShadow = true; walls.receiveShadow = roofs.receiveShadow = true;
  walls.name = 'buildings';
  return [walls, roofs];
}

/** A covered section: walls, a lit ceiling and the structure on top. */
function buildTunnel(t: Track, s0: number, s1: number, H: Float32Array) {
  const g = new THREE.Group(), edge = t.width / 2 + t.runoff + 0.2, inRange = (i: number) => t.cum[i] >= s0 && t.cum[i] <= s1;
  const concrete = new THREE.MeshStandardMaterial({ color: 0x8f8b84, roughness: 0.95, side: THREE.DoubleSide });
  const outside = new THREE.MeshStandardMaterial({ map: facadeTexture(), color: 0xf0e0c0, roughness: 0.85, side: THREE.DoubleSide });
  const up = (k: number) => (i: number) => H[i] + k;
  for (const s of [-1, 1]) {
    const inner = wall(t, s * edge, up(-1), up(6), concrete, undefined, inRange); inner.receiveShadow = true;
    g.add(inner, wall(t, s * edge, up(6), up(16), outside, undefined, inRange));
  }
  const ceiling = strip(t, -edge, edge, up(6), concrete, inRange); ceiling.castShadow = true;
  const top = strip(t, -edge, edge, up(16), new THREE.MeshStandardMaterial({ color: 0x8a8580, roughness: 0.9 }), inRange); top.castShadow = true;
  g.add(ceiling, top);
  // strip lights along the ceiling
  const lamps: THREE.Matrix4[] = [];
  for (let i = 0; i < t.n; i += 4) if (inRange(i)) for (const s of [-1, 1]) {
    const [x, z] = side(t, i, s * (edge - 1.5));
    lamps.push(new THREE.Matrix4().compose(new THREE.Vector3(x, H[i] + 5.9, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -headingAt(t, i)), new THREE.Vector3(1, 1, 1)));
  }
  const lampMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1.6, 0.08, 0.25), new THREE.MeshStandardMaterial({ color: 0xfff1c4, emissive: 0xffe9a8, emissiveIntensity: 3 }), lamps.length);
  lamps.forEach((m, k) => lampMesh.setMatrixAt(k, m));
  g.add(lampMesh);
  g.name = 'tunnel';
  return g;
}

/** The pit lane: tarmac peeling off the track, lane lines, entry/exit lines, its walls, signs and (hidden) arrows to the entry. */
function buildPitLane(t: Track, pit: ReturnType<typeof pitLane>, barrierMat: THREE.Material, relief: Relief) {
  const g = new THREE.Group(), w = t.width / 2, d = pit.side, rel = (i: number) => pit.rel(t.cum[i]), H = relief.ys, up = (k: number) => (i: number) => H[i] + k;
  const inLane = (i: number) => rel(i) >= PIT.a && rel(i) <= PIT.d;
  const ramp = (i: number) => inLane(i) && (rel(i) <= PIT.b || rel(i) >= PIT.c);
  const off = (k: number) => (i: number) => d * (pit.centre(rel(i)) + k);
  const span = (a: number, b: number) => [(i: number) => Math.min(off(a)(i), off(b)(i)), (i: number) => Math.max(off(a)(i), off(b)(i))] as const;
  const tex = textures();
  g.add(strip(t, ...span(-4, 4), up(0.015), new THREE.MeshStandardMaterial({ map: tex.asphalt, roughness: 0.9, color: 0xc9ccd1 }), inLane, undefined, 6));
  const paint = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.6 });
  for (const k of [-4, 4]) g.add(strip(t, ...span(k - 0.15, k + 0.15), up(0.03), paint, i => inLane(i) && pit.centre(rel(i)) + k > w));
  // the speed-limit lines across the lane
  for (const line of [PIT.b, PIT.c]) g.add(strip(t, ...span(-4, 4), up(0.032), paint, i => Math.abs(rel(i) - line) < 1.2));
  // walls either side of the ramps, where they're clear of the track
  const red = new THREE.Color(0xd21f1f), white = new THREE.Color(0xf2f2f2), stripes = (i: number) => ((i >> 1) % 2 ? red : white);
  g.add(wall(t, off(-4.3), up(-2.5), up(1.1), barrierMat, stripes, i => ramp(i) && pit.centre(rel(i)) - 4 > w + 1.5));
  g.add(wall(t, off(4.3), up(-2.5), up(1.1), barrierMat, stripes, i => ramp(i) && pit.centre(rel(i)) + 4 > w + 3));
  // PIT IN / PIT OUT boards facing the drivers
  const sign = (text: string, r: number, lat: number) => {
    const p = pointAt(t, r), board = new THREE.Mesh(new THREE.PlaneGeometry(5, 1.6), new THREE.MeshStandardMaterial({ map: textTexture(text, '#111827', '#facc15'), side: THREE.DoubleSide }));
    const y = relief.trackY(r);
    board.position.set(p.x - Math.sin(p.heading) * lat, y + 3.2, p.z + Math.cos(p.heading) * lat);
    board.rotation.y = Math.atan2(-Math.cos(p.heading), -Math.sin(p.heading));
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 2.6, 6), new THREE.MeshStandardMaterial({ color: 0x9ca3af }));
    post.position.set(board.position.x, y + 1.3, board.position.z);
    g.add(board, post);
  };
  sign(d > 0 ? 'PIT IN ▶' : '◀ PIT IN', PIT.a - 120, d * (w + t.runoff - 1));
  sign(d > 0 ? 'PIT IN ▶' : '◀ PIT IN', PIT.a + 40, d * (pit.centre(PIT.a + 40) + 5));
  sign('PIT OUT', PIT.c - 10, d * (pit.box + 5));
  // chevrons on the road leading into the pit entry: shown when you're called in (on the easier difficulties)
  const chevron = new THREE.Shape([[0, 0], [-1.6, 1.4], [-1, 1.4], [0.6, 0], [-1, -1.4], [-1.6, -1.4]].map(([x, y]) => new THREE.Vector2(x, y)));
  const chevGeo = new THREE.ShapeGeometry(chevron); chevGeo.rotateX(-Math.PI / 2);
  const lat = (r: number) => d * (r < PIT.a ? (w - 3) * Math.min(1, (r - (PIT.a - 250)) / 250) : pit.centre(r));
  const arrows = new THREE.InstancedMesh(chevGeo, new THREE.MeshBasicMaterial({ color: 0xfacc15, side: THREE.DoubleSide }), 13);
  for (let k = 0; k < 13; k++) {
    const r = PIT.a - 250 + k * 30, p = pointAt(t, r), q = pointAt(t, r + 5);
    const ax = p.x - Math.sin(p.heading) * lat(r), az = p.z + Math.cos(p.heading) * lat(r);
    const bx = q.x - Math.sin(q.heading) * lat(r + 5), bz = q.z + Math.cos(q.heading) * lat(r + 5);
    const pitch = Math.atan(relief.slope(r));
    arrows.setMatrixAt(k, new THREE.Matrix4().compose(new THREE.Vector3(ax, relief.trackY(r) + 0.06, az), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -Math.atan2(bz - az, bx - ax), pitch)), new THREE.Vector3(2, 1, 2)));
  }
  arrows.computeBoundingSphere(); arrows.name = 'pitArrows'; arrows.visible = false;
  g.add(arrows);
  return g;
}

/** Forest polygons filled with conifers on a jittered grid: dense near the track, thinner deeper in. One mesh per 400 m tile so tiles out of view are culled. */
const FOREST_CAP = 36000;
function buildForest(forests: number[][][], relief: Relief, clear: (x: number, z: number) => boolean, rnd: () => number) {
  const G = relief.ground, span = (G.n - 1) * G.step, S = 8.5, cells = Math.ceil(span / S), taken = new Uint8Array(cells * cells);
  const spots: [number, number][] = [];
  for (const rings of forests) {
    let z0 = Infinity, z1 = -Infinity;
    for (const r of rings) for (let k = 1; k < r.length; k += 2) { z0 = Math.min(z0, r[k]); z1 = Math.max(z1, r[k]); }
    // scanline fill, even-odd over the rings so clearings stay clear
    for (let gj = Math.max(0, Math.ceil((z0 - G.z0) / S)); gj < cells && G.z0 + gj * S <= z1; gj++) {
      const z = G.z0 + gj * S, xs: number[] = [];
      for (const r of rings) for (let k = 0; k < r.length; k += 2) {
        const j = (k + 2) % r.length, az = r[k + 1], bz = r[j + 1];
        if ((az > z) !== (bz > z)) xs.push(r[k] + (r[j] - r[k]) * (z - az) / (bz - az));
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2)
        for (let gi = Math.max(0, Math.ceil((xs[k] - G.x0) / S)); gi < cells && G.x0 + gi * S <= xs[k + 1]; gi++) {
          if (taken[gj * cells + gi]) continue;
          taken[gj * cells + gi] = 1;
          spots.push([G.x0 + gi * S + (rnd() - 0.5) * S * 0.8, z + (rnd() - 0.5) * S * 0.8]);
        }
    }
  }
  // keep every tree near the track; thin out the deep woods to stay within budget
  const ok = spots.filter(([x, z]) => clear(x, z)), near = ok.filter(([x, z]) => relief.margin(x, z) < 250).length;
  const keepFar = Math.min(1, Math.max(0.15, (FOREST_CAP - near) / Math.max(1, ok.length - near)));
  const kept = ok.filter(([x, z]) => relief.margin(x, z) < 250 || rnd() < keepFar).slice(0, FOREST_CAP);
  // one cheap conifer: open cone crown on a stub of trunk, coloured per vertex
  const crown = new THREE.ConeGeometry(3.2, 10, 7, 1, true); crown.translate(0, 7, 0);
  const trunk = new THREE.CylinderGeometry(0.3, 0.4, 2.4, 4, 1, true); trunk.translate(0, 1.2, 0);
  const paint = (g: THREE.BufferGeometry, c: number) => {
    const col = new THREE.Color(c), a = new Float32Array(g.attributes.position.count * 3);
    for (let k = 0; k < a.length; k += 3) { a[k] = col.r; a[k + 1] = col.g; a[k + 2] = col.b; }
    g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g.toNonIndexed();
  };
  const geo = mergeGeometries([paint(crown, 0x2c5a2c), paint(trunk, 0x4a3628)]);
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const tiles = new Map<string, THREE.Matrix4[]>(), m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  for (const [x, z] of kept) {
    const s = 0.8 + rnd() * 0.6, key = `${Math.floor(x / 400)},${Math.floor(z / 400)}`;
    if (!tiles.has(key)) tiles.set(key, []);
    tiles.get(key)!.push(m.compose(new THREE.Vector3(x, relief.groundY(x, z) - 0.3, z), q.setFromAxisAngle(up, rnd() * 6), new THREE.Vector3(s, s * (0.85 + rnd() * 0.4), s)).clone());
  }
  const g = new THREE.Group(), tint = new THREE.Color();
  for (const list of tiles.values()) {
    const mesh = new THREE.InstancedMesh(geo, mat, list.length);
    list.forEach((mm, k) => { mesh.setMatrixAt(k, mm); mesh.setColorAt(k, tint.setHSL(0.25 + rnd() * 0.08, 0.35, 0.4 + rnd() * 0.25)); });
    mesh.computeBoundingSphere(); g.add(mesh);
  }
  g.name = 'forest'; g.userData.count = kept.length;
  return g;
}

export function buildWorld(t: Track, city: City = { buildings: [], tunnels: [] }, urban = false, relief: Relief = makeRelief(t)) {
  const world = new THREE.Group(), w = t.width / 2, runoff = t.runoff, edge = w + runoff, tex = textures();
  const H = relief.ys, up = (k: number) => (i: number) => H[i] + k;

  // the ground: a mesh following the real landscape (street circuits sit on paving, everywhere else on grass)
  const G = relief.ground, span = (G.n - 1) * G.step, rep = span / (urban ? 12 : 24);
  const groundMap = (urban ? tex.asphalt : tex.grass).clone(); groundMap.repeat.set(rep, rep); groundMap.needsUpdate = true;
  const groundMat = new THREE.MeshStandardMaterial({ map: groundMap, color: urban ? 0xd6d0c4 : 0xffffff, roughness: 1 });
  const groundGeo = new THREE.PlaneGeometry(span, span, G.n - 1, G.n - 1);
  groundGeo.rotateX(-Math.PI / 2); groundGeo.translate(G.x0 + span / 2, 0, G.z0 + span / 2);
  const gp = groundGeo.attributes.position;
  for (let k = 0; k < gp.count; k++) gp.setY(k, relief.groundY(gp.getX(k), gp.getZ(k)));
  groundGeo.computeVertexNormals();
  const ground = new THREE.Mesh(groundGeo, groundMat); ground.receiveShadow = true; ground.name = 'ground';
  world.add(ground);

  const isCorner = (i: number) => t.curvature[i] > 1 / 300;
  const turnSign = (i: number) => Math.sign(Math.sin(headingAt(t, (i + 2) % t.n) - headingAt(t, (i - 2 + t.n) % t.n)));
  const pit = pitLane(t), pitDir = pit.side, rel = (i: number) => pit.rel(t.cum[i]);
  const inPits = (i: number) => rel(i) > PIT.a - 30 && rel(i) < PIT.d + 30;
  // the run-off, drawn exactly at road height (the ground mesh is a little lower), then an apron down to the ground mesh.
  // On the inside of a hairpin it stops short of folding over itself; by the pits it reaches back past the garages.
  const reach = (s: number) => (i: number) => s * (s === pitDir && inPits(i) ? pit.box + 22
    : s === turnSign(i) ? Math.min(edge, Math.max(w + 1.5, 0.9 / t.curvature[i])) : edge);
  const uvAt = (x: number, z: number): [number, number] => [(x - G.x0) / span, 1 - (z - G.z0) / span]; // as the ground mesh's
  const level = (i: number) => H[i] - 0.02, toGround = (_: number, x: number, z: number) => relief.groundY(x, z);
  world.add(groundStrip(t, reach(-1), -w, level, level, groundMat, uvAt), groundStrip(t, w, reach(1), level, level, groundMat, uvAt));
  world.add(groundStrip(t, i => reach(-1)(i) - 10, reach(-1), toGround, level, groundMat, uvAt), groundStrip(t, reach(1), i => reach(1)(i) + 10, level, toGround, groundMat, uvAt));

  // gravel traps on the outside of corners
  const gravel = new THREE.MeshStandardMaterial({ map: tex.gravel, roughness: 1 });
  world.add(strip(t, -w - 2, -w - runoff * 0.75, up(0.008), gravel, i => t.curvature[i] > 1 / 150 && turnSign(i) > 0, undefined, 4));
  world.add(strip(t, w + 2, w + runoff * 0.75, up(0.008), gravel, i => t.curvature[i] > 1 / 150 && turnSign(i) < 0, undefined, 4));
  world.add(strip(t, -w, w, up(0.02), new THREE.MeshStandardMaterial({ map: tex.asphalt, roughness: 0.85 }), undefined, undefined, 6));
  const paint = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.6 });
  world.add(strip(t, -w + 0.3, -w + 0.55, up(0.03), paint));
  world.add(strip(t, w - 0.55, w - 0.3, up(0.03), paint));
  const white = new THREE.Color(0xf2f2f2), red = new THREE.Color(0xd21f1f), black = new THREE.Color(0x111111);
  const kerbMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5 });
  const kerbCol = (i: number) => ((i >> 1) % 2 ? red : white);
  world.add(strip(t, -w - 1.4, -w, up(0.05), kerbMat, isCorner, kerbCol));
  world.add(strip(t, w, w + 1.4, up(0.05), kerbMat, isCorner, kerbCol));
  // chequered start/finish line: two rows of ten squares
  const chequer = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 });
  for (let k = 0; k < 10; k++) {
    const a = -w + k * (t.width / 10);
    world.add(strip(t, a, a + t.width / 10, up(0.035), chequer, i => i < 2, i => ((k + i) % 2 ? white : black)));
  }

  // barriers: red/white tyre walls at corners, blue/white concrete on straights, catch fence above; their feet reach down into the ground
  const blue = new THREE.Color(0x1d4ed8), grey = new THREE.Color(0xc8ccd2);
  const barrierCol = (i: number) => isCorner(i) ? ((i >> 2) % 2 ? red : white) : (i >> 4) % 2 ? grey : blue;
  const barrierMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide });
  const ramp = (i: number) => (rel(i) >= PIT.a && rel(i) <= PIT.b) || (rel(i) >= PIT.c && rel(i) <= PIT.d);
  const solid = (s: number) => (i: number) => s !== pitDir || !ramp(i); // the pit lane crosses the barrier line on its ramps
  for (const s of [-1, 1]) world.add(wall(t, s * edge, up(-2.5), up(1.1), barrierMat, barrierCol, solid(s)));
  const fenceTex = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 64;
    const g = c.getContext('2d')!; g.strokeStyle = '#d4d4d8'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(0, 0); g.lineTo(64, 64); g.moveTo(64, 0); g.lineTo(0, 64); g.stroke();
    const x = new THREE.CanvasTexture(c); x.wrapS = x.wrapT = THREE.RepeatWrapping; x.repeat.set(1, 3); return x;
  })();
  const fence = new THREE.MeshStandardMaterial({ map: fenceTex, transparent: true, alphaTest: 0.3, side: THREE.DoubleSide, roughness: 0.4, metalness: 0.6 });
  for (const s of [-1, 1]) world.add(wall(t, s * (edge + 0.3), up(1.1), up(4), fence, undefined, i => !isCorner(i) && solid(s)(i)));
  world.add(buildPitLane(t, pit, barrierMat, relief));

  // advertising boards on the straights (made-up brands only)
  const ads = ['HERBIE F1', 'TURBO COLA', 'GRIDLINE', 'APEX TYRES', 'PITLANE FM', 'FAST LAP'].map((s, k) =>
    new THREE.MeshStandardMaterial({ map: textTexture(s, ['#e10600', '#111827', '#facc15', '#1d4ed8', '#16a34a', '#f97316'][k], k === 2 ? '#111' : '#fff'), roughness: 0.6 }));
  for (let i = 40; i < t.n; i += 90) {
    const s = (i >> 3) % 2 ? 1 : -1;
    if (isCorner(i) || (s === pitDir && rel(i) > PIT.a - 20 && rel(i) < PIT.d + 20)) continue;
    const [x, z] = side(t, i, s * (edge - 0.6)), h = headingAt(t, i);
    const board = new THREE.Mesh(new THREE.PlaneGeometry(12, 1), ads[(i / 90 | 0) % ads.length]);
    board.position.set(x, H[i] + 0.6, z); board.rotation.y = -h + (s > 0 ? Math.PI : 0);
    world.add(board);
  }

  // grandstands full of fans; one crowd mesh per stand so stands out of view are culled
  const rnd = mulberry32(11);
  const bodyGeo = new THREE.BoxGeometry(0.45, 0.62, 0.32); bodyGeo.translate(0, 0.31, 0);
  const headGeo = new THREE.IcosahedronGeometry(0.13, 0); headGeo.translate(0, 0.78, 0);
  const shirtMat = new THREE.MeshStandardMaterial({ roughness: 0.9 }), skinMat = new THREE.MeshStandardMaterial({ roughness: 0.7 });
  let fanCount = 0;
  const stands = standSpots(t);
  for (const sp of stands) {
    // face the track: local +z must point at it
    const p = project(t, sp.x, sp.z), toTrack = p.lateral > 0 ? sp.heading - Math.PI / 2 : sp.heading + Math.PI / 2;
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2 - toTrack);
    // standing on the lowest ground under it
    const base = Math.min(...[[-36, 1], [36, 1], [-36, -12], [36, -12], [0, -6]].map(([lx, lz]) => {
      const v = new THREE.Vector3(lx, 0, lz).applyQuaternion(q); return relief.groundY(sp.x + v.x, sp.z + v.z);
    }));
    const at = new THREE.Matrix4().compose(new THREE.Vector3(sp.x, base - 0.2, sp.z), q, new THREE.Vector3(1, 1, 1));
    const fans: { m: THREE.Matrix4; shirt: THREE.Color; skin: THREE.Color }[] = [];
    world.add(grandstand(rnd, fans, at));
    const bodies = new THREE.InstancedMesh(bodyGeo, shirtMat, fans.length), heads = new THREE.InstancedMesh(headGeo, skinMat, fans.length);
    fans.forEach((f, k) => { bodies.setMatrixAt(k, f.m); heads.setMatrixAt(k, f.m); bodies.setColorAt(k, f.shirt); heads.setColorAt(k, f.skin); });
    for (const m of [bodies, heads]) { m.computeBoundingSphere(); m.name = 'crowd'; }
    world.add(bodies, heads);
    fanCount += fans.length;
  }
  world.userData.fans = fanCount;

  // garages: one per team behind its pit box
  const pitlane = new THREE.MeshStandardMaterial({ map: tex.asphalt, roughness: 0.9, color: 0xcfd3d8 });
  const garageMat = new THREE.MeshStandardMaterial({ color: 0xd1d5db, roughness: 0.6, metalness: 0.2 });
  TEAMS.forEach((team, k) => {
    const box = pitBox(t, k, pitDir), g = new THREE.Group();
    const bay = new THREE.Mesh(new THREE.PlaneGeometry(16, 12), pitlane);
    bay.rotation.x = -Math.PI / 2; bay.position.set(0, 0.02, pitDir * 2); bay.receiveShadow = true;
    const outline = new THREE.Mesh(new THREE.PlaneGeometry(7, 3.2), new THREE.MeshStandardMaterial({ color: team.color, transparent: true, opacity: 0.55 }));
    outline.rotation.x = -Math.PI / 2; outline.position.y = 0.03;
    const back = new THREE.Mesh(new THREE.BoxGeometry(15, 8, 0.4), new THREE.MeshStandardMaterial({ color: team.livery[0], roughness: 0.5 }));
    back.position.set(0, 2, pitDir * 14);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(16, 0.5, 8), garageMat); roof.position.set(0, 6.2, pitDir * 10);
    const walls = [-1, 1].map(sx => { const m = new THREE.Mesh(new THREE.BoxGeometry(0.4, 8, 8), garageMat); m.position.set(sx * 7.8, 2, pitDir * 10); return m; });
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(10, 1.4), new THREE.MeshStandardMaterial({ map: textTexture(team.name.toUpperCase(), '#111827', '#ffffff') }));
    sign.position.set(0, 5.4, pitDir * 5.9); sign.rotation.y = pitDir > 0 ? Math.PI : 0;
    g.add(bay, outline, back, roof, ...walls, sign);
    g.traverse(o => { o.castShadow = o.receiveShadow = true; });
    g.position.set(box.x, relief.trackY(boxAt(k)), box.z); g.rotation.y = -box.heading;
    world.add(g);
  });

  // real buildings, kept clear of the grandstands and pit garages
  const laneSpots = [];
  for (let r = PIT.a; r <= PIT.d; r += 20) { const p = pointAt(t, r), off = pitDir * pit.centre(r); laneSpots.push({ x: p.x - Math.sin(p.heading) * off, z: p.z + Math.cos(p.heading) * off, r: 24 }); }
  const keepClear = [...stands.map(s => ({ x: s.x, z: s.z, r: 55 })), ...laneSpots, ...TEAMS.map((_, k) => { const b = pitBox(t, k, pitDir); return { x: b.x, z: b.z, r: 30 }; })];
  const buildings = city.buildings.filter(b => {
    for (let k = 1; k < b.length; k += 2) if (keepClear.some(c => Math.hypot(b[k] - c.x, b[k + 1] - c.z) < c.r)) return false;
    return true;
  });
  if (buildings.length) world.add(...buildCity(buildings, urban, rnd, relief.groundY));
  for (const [s0, s1] of city.tunnels) world.add(buildTunnel(t, s0, s1, H));
  world.userData.buildings = buildings.length; world.userData.tunnels = city.tunnels.length;
  // building footprints on a 40 m grid (for the scattered trees) and an 8 m one (for the forests), so trees don't grow through them
  const occupied = new Set<string>(), fine = new Set<string>();
  for (const b of buildings) {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let k = 1; k < b.length; k += 2) { x0 = Math.min(x0, b[k]); x1 = Math.max(x1, b[k]); z0 = Math.min(z0, b[k + 1]); z1 = Math.max(z1, b[k + 1]); }
    for (let gx = Math.floor((x0 - 5) / 40); gx <= Math.floor((x1 + 5) / 40); gx++)
      for (let gz = Math.floor((z0 - 5) / 40); gz <= Math.floor((z1 + 5) / 40); gz++) occupied.add(`${gx},${gz}`);
    for (let gx = Math.floor((x0 - 4) / 8); gx <= Math.floor((x1 + 4) / 8); gx++)
      for (let gz = Math.floor((z0 - 4) / 8); gz <= Math.floor((z1 + 4) / 8); gz++) fine.add(`${gx},${gz}`);
  }
  for (const c of keepClear) occupied.add(`${Math.floor(c.x / 40)},${Math.floor(c.z / 40)}`);

  // trees: trunks and layered crowns, scattered away from the circuit and the buildings
  const G0 = G.x0 + span * 0.075, G1 = G.z0 + span * 0.075, trees: THREE.Matrix4[] = [];
  for (let k = 0; trees.length < (urban ? 250 : 900) && k < 6000; k++) {
    const x = G0 + rnd() * span * 0.85, z = G1 + rnd() * span * 0.85;
    if (occupied.has(`${Math.floor(x / 40)},${Math.floor(z / 40)}`)) continue;
    if (Math.abs(project(t, x, z).lateral) < edge + 14) continue;
    const s = 0.7 + rnd() * 0.9;
    trees.push(new THREE.Matrix4().compose(new THREE.Vector3(x, relief.groundY(x, z) - 0.3, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * 6), new THREE.Vector3(s, s * (0.8 + rnd() * 0.5), s)));
  }
  const trunkGeo = new THREE.CylinderGeometry(0.25, 0.4, 4, 6); trunkGeo.translate(0, 2, 0);
  const crownGeo = mergeGeometries([0, 1, 2].map(k => { const c = new THREE.ConeGeometry(4 - k * 0.9, 5, 8); c.translate(0, 5 + k * 2.6, 0); return c; }));
  const trunks = new THREE.InstancedMesh(trunkGeo, new THREE.MeshStandardMaterial({ color: 0x5b4636, roughness: 1 }), trees.length);
  const crowns = new THREE.InstancedMesh(crownGeo, new THREE.MeshStandardMaterial({ roughness: 0.95 }), trees.length);
  trees.forEach((m, k) => { trunks.setMatrixAt(k, m); crowns.setMatrixAt(k, m); crowns.setColorAt(k, new THREE.Color().setHSL(0.27 + rnd() * 0.06, 0.45, 0.2 + rnd() * 0.1)); });
  world.add(trunks, crowns);

  // the real woods (Spa's Ardennes, Monza's park…), kept off the circuit, the pits, the stands and the buildings
  const forest = buildForest(city.forests ?? [], relief, (x, z) => relief.margin(x, z) > -6 && !fine.has(`${Math.floor(x / 8)},${Math.floor(z / 8)}`)
    && !stands.some(s => Math.hypot(x - s.x, z - s.z) < 50), rnd);
  world.add(forest);
  world.userData.trees = trees.length; world.userData.forest = forest.userData.count;
  return world;
}

/** Podium steps for [winner, second, third], each step's top at `PODIUM_STEPS`; front faces +x. Without `people`, stand-in figures. */
export const PODIUM_STEPS = [[0, 0.9], [2.2, 0.6], [-2.2, 0.4]] as const; // [z, height]
export function makePodium(colors: number[], withFigures = true) {
  const g = new THREE.Group(), stone = new THREE.MeshStandardMaterial({ color: 0xf3f4f6, roughness: 0.4 });
  const back = new THREE.Mesh(new THREE.BoxGeometry(0.3, 4, 8), new THREE.MeshStandardMaterial({ color: 0xe10600 }));
  back.position.set(-1.6, 2, 0); g.add(back);
  PODIUM_STEPS.forEach(([z, h], k) => {
    const step = new THREE.Mesh(new THREE.BoxGeometry(2, h, 2.2), stone); step.position.set(0, h / 2, z);
    step.receiveShadow = true;
    if (!withFigures) { g.add(step); return; }
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 1.3, 10), new THREE.MeshStandardMaterial({ color: colors[k] }));
    body.position.set(0, h + 0.65, z);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.24, 10, 8), new THREE.MeshStandardMaterial({ color: 0xfafafa }));
    head.position.set(0, h + 1.5, z);
    g.add(step, body, head);
  });
  return g;
}

/** Pit crew around a car parked at the origin, nose along +x. */
export function makeCrew(color: number) {
  const crew = new THREE.Group(), suit = new THREE.MeshStandardMaterial({ color }), helmet = new THREE.MeshStandardMaterial({ color: 0x111111 });
  const spots = [[1.85, 1.5], [1.85, -1.5], [-1.75, 1.5], [-1.75, -1.5], [2.3, 1.6], [2.3, -1.6], [-2.2, 1.6], [-2.2, -1.6], [3.6, 0], [-3.4, 0], [0.4, 1.7], [0.4, -1.7]];
  for (const [x, z] of spots) {
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 1.2, 8), suit); body.position.set(x, 0.6, z);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 8, 6), helmet); head.position.set(x, 1.4, z);
    crew.add(body, head);
  }
  return crew;
}

// --- the car ---
function numberTexture(n: number, fg: string) {
  const c = document.createElement('canvas'); c.width = 128; c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = fg; g.font = '900 96px "Titillium Web", system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(String(n), 64, 70);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
/** Side profile (x along the car, y up) extruded across `width`, centred on z = `z`. */
function profile(points: [number, number][], width: number, z = 0, bevel = 0.04) {
  const s = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
  const g = new THREE.ExtrudeGeometry(s, { depth: width - bevel * 2, bevelEnabled: true, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 2, curveSegments: 6 });
  g.translate(0, 0, z - width / 2 + bevel);
  return g;
}
const tyreGeo = (r: number, w: number) => {
  const pts: THREE.Vector2[] = [];
  for (let k = 0; k <= 10; k++) { const a = -Math.PI / 2 + (k / 10) * Math.PI; pts.push(new THREE.Vector2(r - 0.06 + Math.cos(a) * 0.06, Math.sin(a) * w / 2)); }
  const inner = [new THREE.Vector2(r * 0.66, w / 2), new THREE.Vector2(r * 0.66, -w / 2)];
  const g = new THREE.LatheGeometry([inner[1], ...pts, inner[0]].reverse(), 28);
  g.rotateX(Math.PI / 2);
  return g;
};
let carGeoCache: ReturnType<typeof carGeometry> | null = null;
function carGeometry() {
  const body: THREE.BufferGeometry[] = [], accent: THREE.BufferGeometry[] = [], carbon: THREE.BufferGeometry[] = [];
  const box = (list: THREE.BufferGeometry[], sx: number, sy: number, sz: number, x: number, y: number, z: number, rx = 0, rz = 0) => {
    const g = new THREE.BoxGeometry(sx, sy, sz); g.rotateX(rx); g.rotateZ(rz); g.translate(x, y, z); list.push(g);
  };
  // floor and plank
  carbon.push(profile([[-2.1, 0.06], [1.55, 0.06], [1.75, 0.09], [1.55, 0.12], [-2.1, 0.12]], 1.85));
  // nose and monocoque: one smooth side profile, narrowed at the nose by a second, slimmer extrusion
  body.push(profile([[1.0, 0.22], [3.05, 0.26], [3.12, 0.33], [2.0, 0.5], [1.0, 0.62]], 0.36));
  body.push(profile([[-0.6, 0.18], [1.2, 0.22], [1.2, 0.66], [0.6, 0.72], [-0.2, 0.74], [-0.6, 0.7]], 0.82, 0, 0.08));
  // sidepods with an undercut, falling away to the rear
  for (const z of [-0.62, 0.62]) body.push(profile([[-1.6, 0.2], [0.55, 0.26], [0.75, 0.62], [0.45, 0.66], [-0.4, 0.58], [-1.6, 0.36]], 0.5, z, 0.1));
  // engine cover sweeping down from the roll hoop, with the shark fin
  body.push(profile([[-2.05, 0.3], [-0.7, 0.34], [-0.25, 0.78], [0.05, 1.02], [-0.25, 1.06], [-1.1, 0.72], [-2.05, 0.46]], 0.5, 0, 0.1));
  accent.push(profile([[-1.9, 0.48], [-0.7, 0.86], [-0.6, 0.98], [-1.0, 0.98], [-1.95, 0.62]], 0.03, 0, 0.005));
  // airbox intake above the driver
  carbon.push(profile([[-0.08, 0.86], [0.07, 0.86], [0.07, 0.98], [-0.08, 0.98]], 0.22, 0, 0.03));
  // cockpit opening and headrest
  carbon.push(profile([[0.15, 0.7], [0.95, 0.64], [0.95, 0.7], [0.15, 0.76]], 0.52, 0, 0.02));
  // front wing: three staggered elements, top flaps in the accent colour, endplates
  box(carbon, 0.42, 0.035, 1.98, 3.15, 0.1, 0);
  box(accent, 0.3, 0.03, 1.9, 3.02, 0.17, 0, 0, 0.35);
  box(accent, 0.24, 0.03, 1.86, 2.88, 0.24, 0, 0, 0.55);
  for (const z of [-0.99, 0.99]) box(carbon, 0.62, 0.28, 0.03, 3.0, 0.2, z);
  // rear wing: main plane, flap, endplates, beam wing, pylon
  box(body, 0.34, 0.04, 1.05, -2.3, 0.88, 0, 0, -0.1);
  box(accent, 0.22, 0.035, 1.05, -2.12, 0.98, 0, 0, -0.45);
  for (const z of [-0.54, 0.54]) box(body, 0.75, 0.62, 0.03, -2.2, 0.72, z);
  box(carbon, 0.28, 0.035, 1.0, -2.2, 0.42, 0, 0, -0.2);
  box(carbon, 0.12, 0.5, 0.06, -2.15, 0.62, 0);
  // halo: hoop round the cockpit plus centre pillar
  const halo = new THREE.TorusGeometry(0.36, 0.03, 8, 24, Math.PI); halo.rotateX(Math.PI / 2); halo.rotateY(-Math.PI / 2); halo.translate(0.3, 0.92, 0); carbon.push(halo);
  const pillar = new THREE.CylinderGeometry(0.014, 0.02, 0.42, 8); pillar.rotateZ(0.95); pillar.translate(0.82, 0.8, 0); carbon.push(pillar);
  // mirrors
  for (const z of [-0.52, 0.52]) { box(carbon, 0.05, 0.22, 0.03, 0.75, 0.75, z * 0.9); box(body, 0.08, 0.06, 0.18, 0.78, 0.88, z); }
  // suspension arms to each wheel
  for (const [x, wx] of [[1.6, 1.85], [-1.45, -1.75]])
    for (const z of [-1, 1]) for (const y of [0.25, 0.45]) {
      const len = 0.72, a = new THREE.CylinderGeometry(0.018, 0.018, len, 6); a.rotateX(Math.PI / 2); a.translate((x + wx) / 2, y, z * 0.45); carbon.push(a);
    }
  const merged = (l: THREE.BufferGeometry[]) => mergeGeometries(l.map(g => g.index ? g.toNonIndexed() : g));
  return { body: merged(body), accent: merged(accent), carbon: merged(carbon), frontTyre: tyreGeo(0.36, 0.3), rearTyre: tyreGeo(0.36, 0.4) };
}

/** F1 car in the team's 2022 colours, nose along +x. */
export function makeCar(team: Team, number: number) {
  const car = new THREE.Group(), geo = carGeoCache ??= carGeometry();
  const [main, acc] = team.livery;
  const paint = new THREE.MeshPhysicalMaterial({ color: main, roughness: 0.45, metalness: 0, clearcoat: 0.5, clearcoatRoughness: 0.2 });
  const accent = new THREE.MeshPhysicalMaterial({ color: acc, roughness: 0.45, metalness: 0, clearcoat: 0.5, clearcoatRoughness: 0.2 });
  const carbon = new THREE.MeshStandardMaterial({ color: 0x17181b, roughness: 0.45, metalness: 0.3 });
  for (const [g, m] of [[geo.body, paint], [geo.accent, accent], [geo.carbon, carbon]] as const) {
    const mesh = new THREE.Mesh(g, m); mesh.castShadow = true; car.add(mesh);
  }
  // race number on the nose and engine cover
  const numMat = new THREE.MeshBasicMaterial({ map: numberTexture(number, new THREE.Color(acc).getHSL({ h: 0, s: 0, l: 0 }).l > 0.5 ? '#111' : '#fff'), transparent: true });
  const nose = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.34), numMat); nose.rotation.x = -Math.PI / 2; nose.rotation.z = -Math.PI / 2; nose.position.set(2.2, 0.47, 0); car.add(nose);
  // driver's helmet in the accent colour with a dark visor
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.15, 16, 12), new THREE.MeshPhysicalMaterial({ color: acc, clearcoat: 1, roughness: 0.3 }));
  helmet.position.set(0.32, 0.86, 0); car.add(helmet);
  const visor = new THREE.Mesh(new THREE.SphereGeometry(0.152, 16, 8, -0.9, 1.8, 1.2, 0.5), new THREE.MeshStandardMaterial({ color: 0x0b0b0f, roughness: 0.1, metalness: 0.8 }));
  visor.position.copy(helmet.position); car.add(visor);
  car.userData.helmet = [helmet, visor];

  const rubber = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.92 });
  const rim = new THREE.MeshStandardMaterial({ color: 0x2a2c30, roughness: 0.35, metalness: 0.85 });
  const stripe = new THREE.MeshStandardMaterial({ color: 0xd9262c, roughness: 0.6 }); // soft-compound sidewall
  const wheels: THREE.Object3D[] = [], front: THREE.Group[] = [];
  for (const [x, isFront] of [[1.85, true], [-1.75, false]] as const)
    for (const z of [0.82, -0.82]) {
      const pivot = new THREE.Group(); pivot.position.set(x, 0.36, z);
      const wheel = new THREE.Group(), width = isFront ? 0.3 : 0.4;
      const tyre = new THREE.Mesh(isFront ? geo.frontTyre : geo.rearTyre, rubber); tyre.castShadow = true;
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, width * 0.9, 20), rim); hub.rotation.x = Math.PI / 2;
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.012, 6, 32), stripe); band.position.z = Math.sign(z) * width / 2;
      wheel.add(tyre, hub, band); pivot.add(wheel); car.add(pivot);
      wheels.push(wheel); if (isFront) front.push(pivot);
    }
  car.userData.wheels = wheels; car.userData.front = front; car.userData.stripe = stripe;
  return car;
}
