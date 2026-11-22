import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildTrack, pointAt } from '../../src/track';
import { CIRCUITS } from '../../src/circuits';
import { makeRelief, type Terrain } from '../../src/relief';
import { pitLane, PIT } from '../../src/race';

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

  it('keeps the ground at track height under the track and its run-off, with nothing poking through', () => {
    for (let s = 0; s < t.length; s += 13) {
      const p = pointAt(t, s), y = r.trackY(s);
      for (const lat of [-edge, -t.width / 2, 0, t.width / 2, edge]) {
        const [x, z] = offset(p, lat), g = r.groundY(x, z);
        expect(g, `${s} m, ${lat} m across`).toBeLessThanOrEqual(y + 0.01);
        expect(g, `${s} m, ${lat} m across`).toBeGreaterThan(y - 0.25);
      }
    }
  });

  it('keeps the pit lane and garages flat at track height', () => {
    const pit = pitLane(t);
    for (let rel = PIT.a; rel <= PIT.d; rel += 10) {
      const s = (rel + t.length) % t.length, p = pointAt(t, s), y = r.trackY(s);
      for (const lat of [pit.centre(rel), pit.box, pit.box + 14]) {
        const [x, z] = offset(p, pit.side * lat);
        expect(Math.abs(r.groundY(x, z) - y), `pit ${rel} m, ${lat} m across`).toBeLessThan(0.3);
      }
    }
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
