// Fetches real buildings, road tunnels and forests around each circuit from OpenStreetMap (Overpass API) into src/buildings/<id>.json.
// Data © OpenStreetMap contributors, ODbL 1.0 (https://www.openstreetmap.org/copyright).
// Run: node scripts/import-buildings.mjs [circuit-id ...]
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { buildTrack, project } from '../src/track.ts';
import { CIRCUITS } from '../src/circuits.ts';

const MARGIN = 600; // metres of surroundings kept beyond the track
const LAND = 800;   // forests: out to the edge of the scenery's ground (see relief.ts)
const OVERPASS = 'https://overpass-api.de/api/interpreter';
const only = process.argv.slice(2);

for (const def of CIRCUITS.filter(c => !only.length || only.includes(c.id))) {
  const t = buildTrack(def), g = def.geo;
  const toLocal = (lon, lat) => [(lon - g.lon0) * g.kx - g.sx, -(lat - g.lat0) * g.kz - g.sz];
  const toGeo = (x, z) => [(x + g.sx) / g.kx + g.lon0, g.lat0 - (z + g.sz) / g.kz];
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < t.n; i++) { minX = Math.min(minX, t.xs[i]); maxX = Math.max(maxX, t.xs[i]); minZ = Math.min(minZ, t.zs[i]); maxZ = Math.max(maxZ, t.zs[i]); }
  const half = Math.max(maxX - minX, maxZ - minZ) / 2 + LAND, cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
  const box = [cx - half, cz - half, cx + half, cz + half];
  const [w, n] = toGeo(box[0], box[1]), [e, s] = toGeo(box[2], box[3]);
  const bbox = `${s},${w},${n},${e}`;
  const woods = ['way', 'relation'].flatMap(k => [`${k}["landuse"="forest"](${bbox});`, `${k}["natural"="wood"](${bbox});`]).join('');
  const query = `[out:json][timeout:180];(way["building"](${bbox});way["highway"]["tunnel"="yes"](${bbox});${woods});out geom;`;
  // cached for a day, so tweaking the processing doesn't hammer the public server
  const cache = `scripts/.cache/osm/${createHash('sha1').update(query).digest('hex')}.json`;
  if (!existsSync(cache) || Date.now() - statSync(cache).mtimeMs > 86400e3) {
    let res;
    for (let attempt = 0; ; attempt++) { // the public server is often busy: back off and retry
      res = await fetch(OVERPASS, { method: 'POST', body: new URLSearchParams({ data: query }), headers: { 'User-Agent': 'herbie-f1-importer' } });
      if (res.ok || attempt >= 4 || ![429, 502, 503, 504].includes(res.status)) break;
      await new Promise(r => setTimeout(r, 15000 * (attempt + 1)));
    }
    if (!res.ok) throw new Error(`${def.id}: Overpass HTTP ${res.status}`);
    mkdirSync('scripts/.cache/osm', { recursive: true }); writeFileSync(cache, await res.text());
    await new Promise(r => setTimeout(r, 3000)); // be polite to the public Overpass server
  }
  const { elements } = JSON.parse(readFileSync(cache, 'utf8'));

  const clear = t.width / 2 + t.runoff + 2, buildings = [], tunnelWays = [], forests = [];
  for (const el of elements) {
    if (el.tags.landuse === 'forest' || el.tags.natural === 'wood') { forests.push(...forest(el, toLocal, box)); continue; }
    if (!el.geometry) continue;
    const pts = el.geometry.map(p => toLocal(p.lon, p.lat));
    if (el.tags.highway) { tunnelWays.push(pts); continue; }
    if (+(el.tags.min_height ?? 0) > 0 || +(el.tags['building:min_level'] ?? 0) > 0) continue; // overhangs and bridges
    if (pts.length > 1 && pts[0][0] === pts.at(-1)[0] && pts[0][1] === pts.at(-1)[1]) pts.pop();
    if (pts.length < 3) continue;
    const near = pts.map(([x, z]) => Math.abs(project(t, x, z).lateral));
    if (Math.min(...near) < clear || Math.min(...near) > MARGIN) continue;
    const levels = parseFloat(el.tags['building:levels']);
    let h = parseFloat(el.tags.height) || (levels ? levels * 3.2 + 1 : el.tags.building === 'house' ? 7 : def.urban ? 16 : 9);
    h = Math.min(240, Math.max(3, h));
    buildings.push([Math.round(h * 10) / 10, ...pts.flatMap(([x, z]) => [Math.round(x * 10) / 10, Math.round(z * 10) / 10])]);
  }

  // the track is in a tunnel where it runs along a tunnelled road
  const segDist = (x, z, [ax, az], [bx, bz]) => {
    const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1, f = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2));
    return { d: Math.hypot(x - ax - dx * f, z - az - dz * f), dx, dz };
  };
  const inTunnel = new Uint8Array(t.n);
  for (let i = 0; i < t.n; i++) {
    const j = (i + 1) % t.n, hx = t.xs[j] - t.xs[i], hz = t.zs[j] - t.zs[i], hl = Math.hypot(hx, hz) || 1;
    for (const way of tunnelWays)
      for (let k = 1; k < way.length; k++) {
        const { d, dx, dz } = segDist(t.xs[i], t.zs[i], way[k - 1], way[k]);
        if (d < 10 && Math.abs((dx * hx + dz * hz) / (Math.hypot(dx, dz) * hl || 1)) > 0.8) { inTunnel[i] = 1; break; }
      }
  }
  // close small gaps, drop short crossings
  const tunnels = [];
  for (let i = 0; i < t.n; i++) {
    if (!inTunnel[i] || (i > 0 && inTunnel[i - 1])) continue;
    let j = i; while (j + 1 < t.n && inTunnel[j + 1]) j++;
    const prev = tunnels.at(-1);
    if (prev && t.cum[i] - prev[1] < 25) prev[1] = t.cum[j]; else tunnels.push([t.cum[i], t.cum[j]]);
  }
  const keep = tunnels.filter(([a, b]) => b - a > 120).map(([a, b]) => [Math.round(a), Math.round(b)]);
  writeFileSync(`src/buildings/${def.id}.json`, JSON.stringify({ source: '© OpenStreetMap contributors, ODbL', buildings, tunnels: keep, forests }));
  console.log(def.id, buildings.length, 'buildings', JSON.stringify(keep), forests.length, 'forests');
}

/** A forest way or multipolygon as features `[outer, ...holes]` of flat [x0, z0, x1, z1, …] rings, clipped to `box`. */
function forest(el, toLocal, box) {
  const ways = el.type === 'way' ? [{ role: 'outer', geometry: el.geometry ?? [] }] : (el.members ?? []).filter(m => m.type === 'way' && m.geometry);
  const ring = role => joinRings(ways.filter(m => (m.role || 'outer') === role).map(m => m.geometry.map(p => [p.lon, p.lat])))
    .map(r => tidy(clip(r.map(([lon, lat]) => toLocal(lon, lat)), box))).filter(r => r.length >= 3);
  const holes = ring('inner');
  return ring('outer').map(o => [o, ...holes.filter(h => inside(o, h[0]))].map(r => r.flatMap(([x, z]) => [Math.round(x), Math.round(z)])));
}
/** Multipolygon members come as pieces of ring: chain them up end to end. */
function joinRings(pieces) {
  const same = (a, b) => a[0] === b[0] && a[1] === b[1], pool = pieces.map(p => p.slice()), out = [];
  while (pool.length) {
    let r = pool.pop();
    for (;;) {
      const a = r[0], b = r.at(-1);
      if (same(a, b) && r.length > 1) { r.pop(); break; }
      const k = pool.findIndex(p => same(p[0], b) || same(p.at(-1), b) || same(p[0], a) || same(p.at(-1), a));
      if (k < 0) break;
      const p = pool.splice(k, 1)[0];
      r = same(p[0], b) ? r.concat(p.slice(1)) : same(p.at(-1), b) ? r.concat(p.reverse().slice(1))
        : same(p.at(-1), a) ? p.concat(r.slice(1)) : p.reverse().concat(r.slice(1));
    }
    out.push(r);
  }
  return out;
}
/** Sutherland–Hodgman against the rectangle [x0, z0, x1, z1]. */
function clip(pts, [x0, z0, x1, z1]) {
  for (const [axis, lim, keep] of [[0, x0, 1], [0, x1, -1], [1, z0, 1], [1, z1, -1]]) {
    const out = [], ok = p => (p[axis] - lim) * keep >= 0;
    pts.forEach((p, k) => {
      const q = pts[(k + 1) % pts.length];
      if (ok(p)) out.push(p);
      if (ok(p) !== ok(q)) { const f = (lim - p[axis]) / (q[axis] - p[axis]); out.push([p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f]); }
    });
    pts = out;
    if (!pts.length) break;
  }
  return pts;
}
/** Drop points within 4 m of the last one kept. */
function tidy(pts) {
  const out = [];
  for (const p of pts) if (!out.length || Math.hypot(p[0] - out.at(-1)[0], p[1] - out.at(-1)[1]) >= 4) out.push(p);
  return out;
}
function inside(ring, [x, z]) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, az] = ring[i], [bx, bz] = ring[j];
    if ((az > z) !== (bz > z) && x < (bx - ax) * (z - az) / (bz - az) + ax) c = !c;
  }
  return c;
}
