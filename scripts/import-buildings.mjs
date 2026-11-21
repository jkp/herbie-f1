// Fetches real buildings and road tunnels around each circuit from OpenStreetMap (Overpass API) into src/buildings/<id>.json.
// Data © OpenStreetMap contributors, ODbL 1.0 (https://www.openstreetmap.org/copyright).
// Run: node scripts/import-buildings.mjs [circuit-id ...]
import { writeFileSync } from 'node:fs';
import { buildTrack, project } from '../src/track.ts';
import { CIRCUITS } from '../src/circuits.ts';

const MARGIN = 600; // metres of surroundings kept beyond the track
const OVERPASS = 'https://overpass-api.de/api/interpreter';
const only = process.argv.slice(2);

for (const def of CIRCUITS.filter(c => !only.length || only.includes(c.id))) {
  const t = buildTrack(def), g = def.geo;
  const toLocal = (lon, lat) => [(lon - g.lon0) * g.kx - g.sx, -(lat - g.lat0) * g.kz - g.sz];
  const toGeo = (x, z) => [(x + g.sx) / g.kx + g.lon0, g.lat0 - (z + g.sz) / g.kz];
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < t.n; i++) { minX = Math.min(minX, t.xs[i]); maxX = Math.max(maxX, t.xs[i]); minZ = Math.min(minZ, t.zs[i]); maxZ = Math.max(maxZ, t.zs[i]); }
  const [w, n] = toGeo(minX - MARGIN, minZ - MARGIN), [e, s] = toGeo(maxX + MARGIN, maxZ + MARGIN);
  const bbox = `${s},${w},${n},${e}`;
  const query = `[out:json][timeout:180];(way["building"](${bbox});way["highway"]["tunnel"="yes"](${bbox}););out geom tags;`;
  const res = await fetch(OVERPASS, { method: 'POST', body: new URLSearchParams({ data: query }), headers: { 'User-Agent': 'herbie-f1-importer' } });
  if (!res.ok) throw new Error(`${def.id}: Overpass HTTP ${res.status}`);
  const { elements } = await res.json();

  const clear = t.width / 2 + t.runoff + 2, buildings = [], tunnelWays = [];
  for (const el of elements) {
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
  writeFileSync(`src/buildings/${def.id}.json`, JSON.stringify({ source: '© OpenStreetMap contributors, ODbL', buildings, tunnels: keep }));
  console.log(def.id, buildings.length, 'buildings', JSON.stringify(keep));
  await new Promise(r => setTimeout(r, 3000)); // be polite to the public Overpass server
}
