// Track geometry: a closed centreline resampled from survey points.
// Heading h means forward = (cos h, sin h) in the (x, z) ground plane; +turn = right (clockwise on the minimap).
export interface TrackDef {
  id: string; name: string; gp: string; country: string;
  width: number; runoff: number; officialLength: number;
  urban: boolean; // a street circuit: paved ground instead of grass
  geo: { lon0: number; lat0: number; kx: number; kz: number; sx: number; sz: number }; // lon/lat → x/z (see import-circuits.mjs)
  points: number[][]; // closed loop of [x, z] metres in race direction, starting on the start/finish line
}

export interface Track {
  name: string;
  width: number;
  runoff: number; // grass between the kerb and the barrier
  n: number;
  xs: Float64Array;
  zs: Float64Array;
  cum: Float64Array; // distance from the start line at point i
  length: number;
  curvature: Float64Array; // smoothed |1/radius| at point i
}

export function buildTrack(def: TrackDef, step = 2): Track {
  // Centripetal Catmull-Rom through the survey points (no cusps or overshoot on uneven spacing),
  // densely sampled, then resampled at a fixed spacing.
  const P = def.points, m = P.length, dense: number[][] = [];
  for (let i = 0; i < m; i++) {
    const p = [P[(i - 1 + m) % m], P[i], P[(i + 1) % m], P[(i + 2) % m]];
    const t = [0, 0, 0, 0];
    for (let k = 1; k < 4; k++) t[k] = t[k - 1] + Math.sqrt(Math.hypot(p[k][0] - p[k - 1][0], p[k][1] - p[k - 1][1]));
    const lerp = (a: number[], b: number[], ta: number, tb: number, u: number) =>
      [0, 1].map(d => ((tb - u) * a[d] + (u - ta) * b[d]) / (tb - ta));
    const sub = Math.max(2, Math.ceil(Math.hypot(p[2][0] - p[1][0], p[2][1] - p[1][1]) / 0.5));
    for (let k = 0; k < sub; k++) {
      const u = t[1] + (t[2] - t[1]) * k / sub;
      const a1 = lerp(p[0], p[1], t[0], t[1], u), a2 = lerp(p[1], p[2], t[1], t[2], u), a3 = lerp(p[2], p[3], t[2], t[3], u);
      const b1 = lerp(a1, a2, t[0], t[2], u), b2 = lerp(a2, a3, t[1], t[3], u);
      dense.push(lerp(b1, b2, t[1], t[2], u));
    }
  }
  dense.push(dense[0]);
  const px: number[] = [], pz: number[] = [];
  let acc = 0, next = 0;
  for (let i = 1; i < dense.length; i++) {
    const [ax, az] = dense[i - 1], [bx, bz] = dense[i];
    const d = Math.hypot(bx - ax, bz - az);
    while (next <= acc + d) { const f = (next - acc) / d; px.push(ax + (bx - ax) * f); pz.push(az + (bz - az) * f); next += step; }
    acc += d;
  }
  // drop a final sample that would sit on top of the first
  if (Math.hypot(px[px.length - 1] - px[0], pz[pz.length - 1] - pz[0]) < step / 2) { px.pop(); pz.pop(); }
  const n = px.length;
  const xs = Float64Array.from(px), zs = Float64Array.from(pz);

  const cum = new Float64Array(n);
  for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + Math.hypot(xs[i] - xs[i - 1], zs[i] - zs[i - 1]);
  const length = cum[n - 1] + Math.hypot(xs[0] - xs[n - 1], zs[0] - zs[n - 1]);

  const raw = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = (i - 1 + n) % n, b = (i + 1) % n;
    const h1 = Math.atan2(zs[i] - zs[a], xs[i] - xs[a]), h2 = Math.atan2(zs[b] - zs[i], xs[b] - xs[i]);
    raw[i] = Math.abs(wrapAngle(h2 - h1)) / step;
  }
  const curvature = new Float64Array(n), w = 4;
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let j = -w; j <= w; j++) sum += raw[(i + j + n) % n];
    curvature[i] = sum / (2 * w + 1);
  }
  return { name: def.name, width: def.width, runoff: def.runoff, n, xs, zs, cum, length, curvature };
}

export const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
export const wrapS = (t: Track, s: number) => ((s % t.length) + t.length) % t.length;

export function pointAt(t: Track, s: number) {
  s = wrapS(t, s);
  // binary search for the segment containing s
  let lo = 0, hi = t.n - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (t.cum[m] <= s) lo = m; else hi = m - 1; }
  const i = lo, j = (i + 1) % t.n;
  const segLen = (j === 0 ? t.length : t.cum[j]) - t.cum[i];
  const f = segLen > 0 ? (s - t.cum[i]) / segLen : 0;
  return {
    x: t.xs[i] + (t.xs[j] - t.xs[i]) * f,
    z: t.zs[i] + (t.zs[j] - t.zs[i]) * f,
    heading: Math.atan2(t.zs[j] - t.zs[i], t.xs[j] - t.xs[i]),
    i,
  };
}

/** Nearest point on the centreline. Pass the previous index as `hint` to search locally (avoids snapping to a nearby part of the lap). */
export function project(t: Track, x: number, z: number, hint = -1) {
  let best = -1, bestD = Infinity;
  const scan = (from: number, to: number) => {
    for (let k = from; k <= to; k++) {
      const i = ((k % t.n) + t.n) % t.n;
      const d = (t.xs[i] - x) ** 2 + (t.zs[i] - z) ** 2;
      if (d < bestD) { bestD = d; best = i; }
    }
  };
  if (hint >= 0) scan(hint - 40, hint + 40);
  if (best < 0 || bestD > 60 * 60) scan(0, t.n - 1);

  // refine on the better of the two adjacent segments
  let res = { i: best, s: t.cum[best], lateral: 0, dist: Infinity };
  for (const i of [(best - 1 + t.n) % t.n, best]) {
    const j = (i + 1) % t.n;
    const dx = t.xs[j] - t.xs[i], dz = t.zs[j] - t.zs[i];
    const len2 = dx * dx + dz * dz;
    const f = Math.max(0, Math.min(1, ((x - t.xs[i]) * dx + (z - t.zs[i]) * dz) / len2));
    const cx = t.xs[i] + dx * f, cz = t.zs[i] + dz * f;
    const dist = Math.hypot(x - cx, z - cz);
    if (dist < res.dist) {
      const len = Math.sqrt(len2);
      // right of forward (fx, fz) is (-fz, fx)
      const lateral = ((x - cx) * -dz + (z - cz) * dx) / len;
      res = { i, s: wrapS(t, t.cum[i] + f * len), lateral, dist };
    }
  }
  return res;
}
