// Heights: the road's real profile round the lap, and ground that is flat under the track, run-off and pit lane
// and eases into the real landscape (SRTM, see scripts/import-terrain.mjs) away from it. Physics stays 2D; this is what you see.
import { wrapS, type Track } from './track';
import { PIT, pitLane } from './race';

/** src/terrain/<id>.json: metres relative to the start line; `track` every `trackStep` m round the lap, `grid` row-major from (x0, z0). */
export interface Terrain { source: string; trackStep: number; track: number[]; x0: number; z0: number; step: number; nx: number; nz: number; grid: number[] }
export type Relief = ReturnType<typeof makeRelief>;

const EASE = 60;   // metres over which the ground blends from track height to the landscape
const SINK = 0.5; // ground below the road and run-off strips (drawn exactly over it), so nothing pokes through between mesh vertices

export function makeRelief(t: Track, terrain?: Terrain) {
  const P = terrain?.track, m = P?.length ?? 0;
  /** Road height `s` metres round the lap (Catmull-Rom through the profile). */
  const trackY = (s: number) => {
    if (!P) return 0;
    const k = wrapS(t, s) * m / t.length, i = Math.floor(k), f = k - i, p = (j: number) => P[((i + j) % m + m) % m];
    const a = p(-1), b = p(0), c = p(1), d = p(2);
    return b + 0.5 * f * (c - a + f * (2 * a - 5 * b + 4 * c - d + f * (3 * (b - c) + d - a)));
  };
  const slope = (s: number) => (trackY(s + 3) - trackY(s - 3)) / 6;
  const ys = Float32Array.from(t.cum, s => trackY(s));

  // the ground's vertex lattice: the square the scenery stands on
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < t.n; i++) { minX = Math.min(minX, t.xs[i]); maxX = Math.max(maxX, t.xs[i]); minZ = Math.min(minZ, t.zs[i]); maxZ = Math.max(maxZ, t.zs[i]); }
  const size = Math.max(maxX - minX, maxZ - minZ) + 1600, step = Math.max(8, size / 300), n = Math.ceil(size / step) + 1;
  const x0 = (minX + maxX) / 2 - (n - 1) * step / 2, z0 = (minZ + maxZ) / 2 - (n - 1) * step / 2;
  const h = new Float32Array(n * n), margin = new Float32Array(n * n).fill(1e6);

  {
    // rasterise the track: for each vertex, the nearest point's height and how far it is outside the flat corridor.
    // Within a cell of the road and run-off (drawn exactly, as strips), the lowest nearby part of the lap wins, so where
    // two parts of the lap at different heights come close the ground never pokes up through the lower one.
    const near = new Float32Array(n * n).fill(1e9), hs = new Float32Array(n * n), at = new Int32Array(n * n), low = new Float32Array(n * n).fill(1e9);
    const pit = pitLane(t), edge = t.width / 2 + t.runoff, under = edge + 1.5 * step;
    const pass = (visit: (c: number, d: number, y: number, i: number, flat: number, reach: number) => void) => {
      // the pit lane's ramps run off the road across the slope: sink the ground further there
      for (let i = 0; i < t.n; i++) {
        const j = (i + 1) % t.n, rel = pit.rel(t.cum[i]), inPits = rel > PIT.a - 30 && rel < PIT.d + 30;
        const flat = inPits ? pit.box + 30 : edge + 15, reach = inPits ? pit.box + 12 : under; // the pit lane and garages are wider
        const ax = t.xs[i], az = t.zs[i], dx = t.xs[j] - ax, dz = t.zs[j] - az, l2 = dx * dx + dz * dz || 1, R = flat + EASE;
        const i0 = Math.max(0, Math.floor((Math.min(ax, ax + dx) - R - x0) / step)), i1 = Math.min(n - 1, Math.ceil((Math.max(ax, ax + dx) + R - x0) / step));
        const j0 = Math.max(0, Math.floor((Math.min(az, az + dz) - R - z0) / step)), j1 = Math.min(n - 1, Math.ceil((Math.max(az, az + dz) + R - z0) / step));
        for (let gj = j0; gj <= j1; gj++) for (let gi = i0; gi <= i1; gi++) {
          const x = x0 + gi * step, z = z0 + gj * step, f = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
          visit(gj * n + gi, Math.hypot(x - ax - dx * f, z - az - dz * f), ys[i] + (ys[j] - ys[i]) * f - (inPits ? SINK : 0), i, flat, reach);
        }
      }
    };
    pass((c, d, y, i, flat) => {
      if (d < near[c]) { near[c] = d; hs[c] = y; at[c] = i; }
      if (d - flat < margin[c]) margin[c] = d - flat;
    });
    // other parts of the lap close by: much further round the lap than they are away (not just further along this bit)
    pass((c, d, y, i, _flat, reach) => {
      if (d >= reach || y >= low[c]) return;
      const k = at[c], ds = Math.abs(t.cum[i] - t.cum[k]);
      if (Math.min(ds, t.length - ds) > 1.2 * Math.hypot(t.xs[i] - t.xs[k], t.zs[i] - t.zs[k]) + 5) low[c] = y;
    });
    // the landscape, bilinear on the DEM grid
    const T = terrain, sink = T ? SINK : 0, dem = (x: number, z: number) => {
      if (!T) return 0;
      const gx = Math.max(0, Math.min(T.nx - 1.001, (x - T.x0) / T.step)), gz = Math.max(0, Math.min(T.nz - 1.001, (z - T.z0) / T.step));
      const i = Math.floor(gx), j = Math.floor(gz), fx = gx - i, fz = gz - j, g = T.grid, k = j * T.nx + i;
      return (g[k] * (1 - fx) + g[k + 1] * fx) * (1 - fz) + (g[k + T.nx] * (1 - fx) + g[k + T.nx + 1] * fx) * fz;
    };
    for (let gj = 0; gj < n; gj++) for (let gi = 0; gi < n; gi++) {
      const c = gj * n + gi, land = dem(x0 + gi * step, z0 + gj * step);
      if (near[c] > 1e8) { h[c] = land; continue; }
      const e = Math.max(0, Math.min(1, margin[c] / EASE)), k = e * e * (3 - 2 * e);
      h[c] = (Math.min(hs[c], low[c]) - sink) * (1 - k) + land * k;
    }
  }

  const bilinear = (a: Float32Array, x: number, z: number) => {
    const gx = Math.max(0, Math.min(n - 1.001, (x - x0) / step)), gz = Math.max(0, Math.min(n - 1.001, (z - z0) / step));
    const i = Math.floor(gx), j = Math.floor(gz), fx = gx - i, fz = gz - j, k = j * n + i;
    return (a[k] * (1 - fx) + a[k + 1] * fx) * (1 - fz) + (a[k + n] * (1 - fx) + a[k + n + 1] * fx) * fz;
  };
  return {
    trackY, slope, ys,
    /** Ground height, matching the ground mesh. */
    groundY: (x: number, z: number) => bilinear(h, x, z),
    /** Metres outside the flat corridor round the track and pits (negative inside it). */
    margin: (x: number, z: number) => bilinear(margin, x, z),
    ground: { n, step, x0, z0, h },
  };
}
