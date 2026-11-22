// Fetches real ground heights round each circuit into src/terrain/<id>.json from Open Topo Data's SRTM 30 m dataset
// (https://www.opentopodata.org, NASA SRTM GL1, public domain). Only coordinates are sent.
// Responses are cached in scripts/.cache/terrain so reruns don't refetch (the public API allows 1000 requests a day).
// Run: node scripts/import-terrain.mjs [circuit-id ...]
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { buildTrack, pointAt } from '../src/track.ts';
import { CIRCUITS } from '../src/circuits.ts';

const API = 'https://api.opentopodata.org/v1/srtm30m';
const CACHE = 'scripts/.cache/terrain';
const TRACK_STEP = 20, GRID_STEP = 55, MARGIN = 800; // metres
const only = process.argv.slice(2);
mkdirSync(CACHE, { recursive: true });
mkdirSync('src/terrain', { recursive: true });

let last = 0;
async function heights(latlons) {
  const out = [];
  for (let k = 0; k < latlons.length; k += 100) {
    const locations = latlons.slice(k, k + 100).map(([lat, lon]) => `${lat.toFixed(6)},${lon.toFixed(6)}`).join('|');
    const file = `${CACHE}/${createHash('sha1').update(API + locations).digest('hex')}.json`;
    if (!existsSync(file)) {
      for (let attempt = 0; ; attempt++) {
        await new Promise(r => setTimeout(r, Math.max(0, last + 1100 - Date.now()))); // ≤ 1 request a second
        last = Date.now();
        const res = await fetch(`${API}?locations=${locations}`);
        if (res.ok) { writeFileSync(file, JSON.stringify((await res.json()).results.map(r => r.elevation))); break; }
        if (attempt > 4) throw new Error(`Open Topo Data HTTP ${res.status}`);
        await new Promise(r => setTimeout(r, 5000 * (attempt + 1)));
      }
    }
    out.push(...JSON.parse(readFileSync(file, 'utf8')).map(e => e ?? 0)); // null: the sea
  }
  return out;
}

/** Circular smoothing of a lap profile: median (drops canopy and building spikes), then a gaussian. */
function smoothLoop(h, medianHalf, sigma) {
  const n = h.length, at = k => h[((k % n) + n) % n];
  const med = h.map((_, i) => { const w = []; for (let j = -medianHalf; j <= medianHalf; j++) w.push(at(i + j)); return w.sort((a, b) => a - b)[medianHalf]; });
  const r = Math.ceil(sigma * 3), wts = Array.from({ length: 2 * r + 1 }, (_, j) => Math.exp(-((j - r) ** 2) / (2 * sigma * sigma)));
  const sum = wts.reduce((a, b) => a + b, 0);
  return med.map((_, i) => wts.reduce((acc, w, j) => acc + w * med[((i + j - r) % n + n) % n], 0) / sum);
}

for (const def of CIRCUITS.filter(c => !only.length || only.includes(c.id))) {
  const t = buildTrack(def), g = def.geo;
  const toGeo = (x, z) => [g.lat0 - (z + g.sz) / g.kz, (x + g.sx) / g.kx + g.lon0]; // [lat, lon]

  // (a) the centreline every 20 m
  const m = Math.round(t.length / TRACK_STEP), trackStep = t.length / m, pts = [];
  for (let k = 0; k < m; k++) { const p = pointAt(t, k * trackStep); pts.push(toGeo(p.x, p.z)); }
  const raw = await heights(pts);
  // tunnels: the DEM sees the hill above, so the road runs straight between the portals
  const city = existsSync(`src/buildings/${def.id}.json`) ? JSON.parse(readFileSync(`src/buildings/${def.id}.json`, 'utf8')) : { tunnels: [] };
  for (const [s0, s1] of city.tunnels) {
    const a = Math.floor(s0 / trackStep) - 2, b = Math.ceil(s1 / trackStep) + 2;
    for (let k = a + 1; k < b; k++) raw[k % m] = raw[a % m] + (raw[b % m] - raw[a % m]) * (k - a) / (b - a);
  }
  const prof = smoothLoop(raw, 2, 1.5);
  const base = prof[0];

  // (b) a square grid over the circuit and its surroundings, matching the scenery's ground
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < t.n; i++) { minX = Math.min(minX, t.xs[i]); maxX = Math.max(maxX, t.xs[i]); minZ = Math.min(minZ, t.zs[i]); maxZ = Math.max(maxZ, t.zs[i]); }
  const half = Math.max(maxX - minX, maxZ - minZ) / 2 + MARGIN, cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
  const nx = Math.ceil(2 * half / GRID_STEP) + 1, x0 = cx - (nx - 1) * GRID_STEP / 2, z0 = cz - (nx - 1) * GRID_STEP / 2;
  const cells = [];
  for (let j = 0; j < nx; j++) for (let i = 0; i < nx; i++) cells.push(toGeo(x0 + i * GRID_STEP, z0 + j * GRID_STEP));
  const grid = await heights(cells);
  // a light 3×3 blur: SRTM pixels are noisy, and trees and roofs add bumps
  const at = (i, j) => grid[Math.min(nx - 1, Math.max(0, j)) * nx + Math.min(nx - 1, Math.max(0, i))];
  const blurred = grid.map((_, k) => {
    const i = k % nx, j = Math.floor(k / nx);
    let s = 0;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) s += at(i + di, j + dj) * (2 - Math.abs(di)) * (2 - Math.abs(dj));
    return s / 16;
  });

  const r1 = v => Math.round((v - base) * 10) / 10;
  writeFileSync(`src/terrain/${def.id}.json`, JSON.stringify({
    source: 'SRTM GL1 30 m (NASA, public domain) via Open Topo Data',
    trackStep: Math.round(trackStep * 1000) / 1000, track: prof.map(r1),
    x0: Math.round(x0 * 10) / 10, z0: Math.round(z0 * 10) / 10, step: GRID_STEP, nx, nz: nx, grid: blurred.map(r1),
  }));
  const rel = prof.map(r1);
  console.log(def.id, `${m} track pts, ${nx}×${nx} grid, track relief ${(Math.max(...rel) - Math.min(...rel)).toFixed(1)} m`);
}
