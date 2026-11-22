import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildTrack, project } from '../../src/track';
import { CIRCUITS } from '../../src/circuits';

// Real surroundings from OpenStreetMap, imported by scripts/import-buildings.mjs.
const load = (id: string) => JSON.parse(readFileSync(`src/buildings/${id}.json`, 'utf8')) as { buildings: number[][]; tunnels: number[][]; forests: number[][][] };
/** Area inside a forest: rings are even-odd, so clearings cut holes. */
const ringArea = (r: number[]) => { let a = 0; for (let k = 0; k < r.length; k += 2) { const j = (k + 2) % r.length; a += r[k] * r[j + 1] - r[j] * r[k + 1]; } return Math.abs(a) / 2; };
const forestArea = (f: number[][][]) => f.reduce((sum, rings) => sum + ringArea(rings[0]) - rings.slice(1).reduce((h, r) => h + ringArea(r), 0), 0);

describe('Monaco', () => {
  const data = load('monaco'), t = buildTrack(CIRCUITS.find(c => c.id === 'monaco')!);

  it('is surrounded by the city', () => {
    expect(data.buildings.length).toBeGreaterThan(800);
  });

  it('has the tunnel after Portier, a few hundred metres long', () => {
    expect(data.tunnels).toHaveLength(1);
    const [s0, s1] = data.tunnels[0];
    expect(s0).toBeGreaterThan(1450); // Portier is at ~1.5 km
    expect(s0).toBeLessThan(2100);
    expect(s1 - s0).toBeGreaterThan(250);
    expect(s1 - s0).toBeLessThan(800);
    expect(s1).toBeLessThan(t.length);
  });
});

describe('Spa-Francorchamps', () => {
  it('is carved through the Ardennes forest', () => {
    const data = load('spa');
    expect(forestArea(data.forests)).toBeGreaterThan(3e6); // m²
    for (const f of data.forests) for (const ring of f) expect(ring.length).toBeGreaterThanOrEqual(6);
  });
});

it('Monza has its royal park', () => expect(forestArea(load('monza').forests)).toBeGreaterThan(5e5));

describe.each(CIRCUITS)('$name surroundings', def => {
  const data = load(def.id), t = buildTrack(def);

  it('keeps buildings off the track and run-off', () => {
    for (const b of data.buildings)
      for (let k = 1; k < b.length; k += 2)
        expect(Math.abs(project(t, b[k], b[k + 1]).lateral)).toBeGreaterThan(t.width / 2 + t.runoff + 1);
  });

  it('has believable building heights', () => {
    for (const b of data.buildings) { expect(b[0]).toBeGreaterThanOrEqual(3); expect(b[0]).toBeLessThan(250); }
  });
});
