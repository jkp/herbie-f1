import * as THREE from 'three';
import { project, type Track } from './track';

// Track-space helper: point at index i offset `off` metres to the right of the centreline.
function side(t: Track, i: number, off: number): [number, number] {
  const a = (i - 1 + t.n) % t.n, b = (i + 1) % t.n;
  const h = Math.atan2(t.zs[b] - t.zs[a], t.xs[b] - t.xs[a]);
  return [t.xs[i] - Math.sin(h) * off, t.zs[i] + Math.cos(h) * off];
}

/** A flat strip following the lap between lateral offsets `in` and `out`; `colorAt` picks a colour per segment or skips it. */
function strip(t: Track, inner: number, outer: number, y: number, colorAt: (i: number) => THREE.Color | null) {
  const pos: number[] = [], col: number[] = [];
  for (let i = 0; i < t.n; i++) {
    const c = colorAt(i);
    if (!c) continue;
    const j = (i + 1) % t.n;
    const [ax, az] = side(t, i, inner), [bx, bz] = side(t, i, outer), [cx, cz] = side(t, j, inner), [dx, dz] = side(t, j, outer);
    pos.push(ax, y, az, cx, y, cz, bx, y, bz, bx, y, bz, cx, y, cz, dx, y, dz);
    for (let k = 0; k < 6; k++) col.push(c.r, c.g, c.b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
}

/** A vertical wall following the lap at lateral offset `off`. */
function wall(t: Track, off: number, height: number, colorAt: (i: number) => THREE.Color) {
  const pos: number[] = [], col: number[] = [];
  for (let i = 0; i < t.n; i++) {
    const j = (i + 1) % t.n, [ax, az] = side(t, i, off), [bx, bz] = side(t, j, off), c = colorAt(i);
    pos.push(ax, 0, az, bx, 0, bz, ax, height, az, ax, height, az, bx, 0, bz, bx, height, bz);
    for (let k = 0; k < 6; k++) col.push(c.r, c.g, c.b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }));
}

export function buildWorld(t: Track) {
  const world = new THREE.Group(), w = t.width / 2, runoff = t.runoff;
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < t.n; i++) {
    minX = Math.min(minX, t.xs[i]); maxX = Math.max(maxX, t.xs[i]); minZ = Math.min(minZ, t.zs[i]); maxZ = Math.max(maxZ, t.zs[i]);
  }
  const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2, size = Math.max(maxX - minX, maxZ - minZ) + 1600;

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(size, size), new THREE.MeshLambertMaterial({ color: 0x4f8a3a }));
  ground.rotation.x = -Math.PI / 2; ground.position.set(cx, -0.02, cz);
  world.add(ground);

  const asphalt = new THREE.Color(0x3b3e44), asphalt2 = new THREE.Color(0x373a40);
  const runoffCol = new THREE.Color(0x5c9a45);
  world.add(strip(t, -w - 3, w + 3, 0.005, () => runoffCol)); // mown verge next to the tarmac
  world.add(strip(t, -w, w, 0.02, i => (i >> 3) % 2 ? asphalt : asphalt2));
  const white = new THREE.Color(0xf2f2f2), red = new THREE.Color(0xd21f1f);
  world.add(strip(t, -w + 0.3, -w + 0.55, 0.03, () => white));
  world.add(strip(t, w - 0.55, w - 0.3, 0.03, () => white));
  const kerb = (i: number) => t.curvature[i] > 1 / 300 ? ((i >> 1) % 2 ? red : white) : null;
  world.add(strip(t, -w - 1.4, -w, 0.04, kerb));
  world.add(strip(t, w, w + 1.4, 0.04, kerb));
  // chequered start/finish line: two rows of ten squares
  const black = new THREE.Color(0x111111);
  for (let k = 0; k < 10; k++) {
    const a = -w + k * (t.width / 10);
    world.add(strip(t, a, a + t.width / 10, 0.035, i => (i < 2 ? ((k + i) % 2 ? white : black) : null)));
  }

  // barriers: tyre-wall colours near corners, concrete on straights
  const blue = new THREE.Color(0x1d4ed8), grey = new THREE.Color(0xb8bcc4);
  const barrier = (i: number) => t.curvature[i] > 1 / 300 ? ((i >> 2) % 2 ? red : white) : (i >> 4) % 2 ? grey : blue;
  world.add(wall(t, -w - runoff, 1.1, barrier));
  world.add(wall(t, w + runoff, 1.1, barrier));

  // grandstands along the start straight and at a few corners
  const standMat = new THREE.MeshLambertMaterial({ color: 0x6b7280 });
  const roofMat = new THREE.MeshLambertMaterial({ color: 0xe5e7eb });
  const crowd = new THREE.MeshLambertMaterial({ color: 0x9b3d3d });
  for (const s of [60, 160, 1250, 2300, 3700, 5300]) {
    const i = Math.round(s / (t.length / t.n)) % t.n, [x, z] = side(t, i, -(w + runoff + 14));
    if (Math.abs(project(t, x, z).lateral) < w + runoff + 12) continue; // would sit on another part of the circuit
    const a = (i - 1 + t.n) % t.n, b = (i + 1) % t.n, h = Math.atan2(t.zs[b] - t.zs[a], t.xs[b] - t.xs[a]);
    const g = new THREE.Group();
    const base = new THREE.Mesh(new THREE.BoxGeometry(80, 10, 16), standMat); base.position.y = 5;
    const people = new THREE.Mesh(new THREE.BoxGeometry(78, 1, 14), crowd); people.position.set(0, 10.5, 0);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(84, 0.6, 18), roofMat); roof.position.y = 16;
    g.add(base, people, roof);
    g.position.set(x, 0, z); g.rotation.y = -h;
    world.add(g);
  }

  // trees scattered away from the circuit
  const rnd = mulberry32(7);
  const trees: THREE.Matrix4[] = [];
  for (let k = 0; trees.length < 700 && k < 5000; k++) {
    const x = cx + (rnd() - 0.5) * size * 0.8, z = cz + (rnd() - 0.5) * size * 0.8;
    if (Math.abs(project(t, x, z).lateral) < w + runoff + 12) continue;
    const s = 0.7 + rnd() * 0.8;
    trees.push(new THREE.Matrix4().compose(new THREE.Vector3(x, 6 * s, z), new THREE.Quaternion(), new THREE.Vector3(s, s, s)));
  }
  const crowns = new THREE.InstancedMesh(new THREE.ConeGeometry(4, 12, 7), new THREE.MeshLambertMaterial({ color: 0x2f5d2a }), trees.length);
  trees.forEach((m, k) => crowns.setMatrixAt(k, m));
  world.add(crowns);
  return world;
}

function mulberry32(a: number) {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/** Low-poly F1 car, nose along +x. */
export function makeCar(color: number) {
  const car = new THREE.Group();
  const paint = new THREE.MeshLambertMaterial({ color });
  const carbon = new THREE.MeshLambertMaterial({ color: 0x1a1a1d });
  const box = (sx: number, sy: number, sz: number, x: number, y: number, z: number, m: THREE.Material) => {
    const b = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), m); b.position.set(x, y, z); car.add(b); return b;
  };
  box(4.4, 0.08, 1.4, -0.2, 0.12, 0, carbon);    // floor
  box(3.6, 0.42, 0.85, 0.2, 0.42, 0, paint);     // tub
  box(1.5, 0.26, 0.45, 2.6, 0.34, 0, paint);     // nose
  box(1.9, 0.5, 1.5, -0.6, 0.42, 0, paint);      // sidepods
  box(1.4, 0.55, 0.45, -0.8, 0.85, 0, paint);    // engine cover / airbox
  box(0.55, 0.05, 2.0, 3.25, 0.16, 0, carbon);   // front wing
  box(0.42, 0.06, 1.05, -2.35, 1.0, 0, paint);   // rear wing
  box(0.42, 0.6, 0.05, -2.35, 0.72, 0.52, carbon);
  box(0.42, 0.6, 0.05, -2.35, 0.72, -0.52, carbon);
  box(0.7, 0.06, 0.06, 0.55, 0.92, 0, carbon);   // halo
  const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 10), new THREE.MeshLambertMaterial({ color: 0xfafafa }));
  helmet.position.set(0.1, 0.82, 0); car.add(helmet);

  const tyre = new THREE.CylinderGeometry(0.36, 0.36, 0.4, 16);
  tyre.rotateX(Math.PI / 2);
  const rubber = new THREE.MeshLambertMaterial({ color: 0x111111 });
  const wheels: THREE.Mesh[] = [], front: THREE.Group[] = [];
  for (const [x, isFront] of [[1.85, true], [-1.75, false]] as const)
    for (const z of [0.85, -0.85]) {
      const pivot = new THREE.Group(); pivot.position.set(x, 0.36, z);
      const w = new THREE.Mesh(tyre, rubber); pivot.add(w); car.add(pivot);
      wheels.push(w); if (isFront) front.push(pivot);
    }
  car.userData = { wheels, front };
  return car;
}
