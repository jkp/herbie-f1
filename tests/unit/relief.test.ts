import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildTrack, pointAt, project } from '../../src/track';
import { CIRCUITS } from '../../src/circuits';
import { makeRelief, type Terrain } from '../../src/relief';
import { boxAt, pitLane, PIT } from '../../src/race';

const load = (id: string) => JSON.parse(readFileSync(`src/terrain/${id}.json`, 'utf8')) as Terrain;
const offset = (p: { x: number; z: number; heading: number }, lat: number) => [p.x - Math.sin(p.heading) * lat, p.z + Math.cos(p.heading) * lat] as const;

it('is flat without terrain data', () => {
  const t = buildTrack(CIRCUITS[0]), r = makeRelief(t);
  expect(r.trackY(500)).toBe(0);
  expect(r.groundY(100, -300)).toBe(0);
});

describe.each(CIRCUITS)('$name relief', def => {
  const t = buildTrack(def), r = makeRelief(t, load(def.id)), edge = t.width / 2 + t.runoff;

  it('puts the start line at height 0 and follows the data round the lap', () => {
    expect(Math.abs(r.trackY(0))).toBeLessThan(0.05);
    const d = load(def.id);
    for (let k = 0; k < d.track.length; k += 7) expect(Math.abs(r.trackY(k * d.trackStep) - d.track[k])).toBeLessThan(0.5);
  });

  // where another part of the lap (much further round than it is away) comes close, the ground between takes the lower height
  const lonely = (x: number, z: number, s: number) => {
    const p = pointAt(t, s);
    for (let i = 0; i < t.n; i += 2) {
      const ds = Math.abs(t.cum[i] - s), along = Math.min(ds, t.length - ds);
      if (Math.hypot(t.xs[i] - x, t.zs[i] - z) < edge + 3 * r.ground.step && along > 1.2 * Math.hypot(t.xs[i] - p.x, t.zs[i] - p.z) + 5) return false;
    }
    return true;
  };

  it('keeps the ground at track height under the track and its run-off, with nothing poking through', () => {
    for (let s = 0; s < t.length; s += 13) {
      const p = pointAt(t, s), y = r.trackY(s);
      for (const lat of [-edge, -t.width / 2 - 1.4, 0, t.width / 2 + 1.4, edge]) {
        const [x, z] = offset(p, lat), pr = project(t, x, z), g = r.groundY(x, z), at = `${s} m, ${lat} m across`;
        if (Math.abs(pr.s - s) > 5 && Math.abs(Math.abs(pr.s - s) - t.length) > 5) continue; // the inside of a hairpin: nearer another part of the lap
        if (Math.abs(lat) < edge) {
          // under the road, kerbs (5 cm proud) and run-off, all drawn exactly as strips: never above them
          expect(g, at).toBeLessThanOrEqual(y + (Math.abs(lat) > t.width / 2 ? 0.04 : 0.01));
        } else if (lonely(x, z, s)) {
          // the barrier (1.1 m high, its foot reaching 2.5 m down) hides small steps either way
          expect(g, at).toBeLessThan(y + 1);
          expect(g, at).toBeGreaterThan(y - 2.5);
        } else expect(g, at).toBeLessThan(y + 2.5); // a bank up to a higher part of the lap close by
      }
    }
  });

  it('keeps the pit lane and garages flat at track height', () => {
    const pit = pitLane(t), flat = (rel: number, lat: number) => {
      const s = (rel + t.length) % t.length, p = pointAt(t, s), [x, z] = offset(p, pit.side * lat), at = `pit ${rel} m, ${lat} m across`;
      if (Math.abs(project(t, x, z).s - s) > 5) return; // nearer another part of the lap
      const g = r.groundY(x, z), y = r.trackY(s);
      expect(g, at).toBeLessThanOrEqual(y + 0.01); // the lane and the garage floors are drawn exactly over the ground
    };
    for (let rel = PIT.a; rel <= PIT.d; rel += 10) flat(rel, pit.centre(rel));
    for (let k = 0; k < 10; k++) for (const lat of [pit.box, pit.box + 14]) flat(boxAt(k), lat);
  });

  it('eases into the real landscape without cliffs', () => {
    const g = r.ground;
    let steep = 0;
    for (let j = 0; j < g.n; j++) for (let i = 1; i < g.n; i++)
      if (Math.abs(g.h[j * g.n + i] - g.h[j * g.n + i - 1]) > g.step) steep++; // steeper than 45°
    expect(steep / (g.n * g.n)).toBeLessThan(0.005);
  });

  it('slopes the cars with the road', () => {
    for (let s = 0; s < t.length; s += 50) expect(Math.abs(r.slope(s))).toBeLessThan(0.25);
  });
});

it('Spa ground away from the track is real landscape, not flat', () => {
  const t = buildTrack(CIRCUITS.find(c => c.id === 'spa')!), r = makeRelief(t, load('spa')), g = r.ground;
  expect(Math.max(...g.h) - Math.min(...g.h)).toBeGreaterThan(100);
});
