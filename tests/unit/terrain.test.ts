import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildTrack } from '../../src/track';
import { CIRCUITS } from '../../src/circuits';
import type { Terrain } from '../../src/relief';

// Real ground heights from SRTM, imported by scripts/import-terrain.mjs.
const load = (id: string) => JSON.parse(readFileSync(`src/terrain/${id}.json`, 'utf8')) as Terrain;
/** Track height `s` metres round the lap, straight from the data. */
const yAt = (d: Terrain, s: number) => {
  const n = d.track.length, k = s / d.trackStep, i = Math.floor(k), f = k - i;
  return d.track[((i % n) + n) % n] * (1 - f) + d.track[(((i + 1) % n) + n) % n] * f;
};
const range = (d: Terrain, a: number, b: number) => {
  const ys: number[] = [];
  for (let s = a; s <= b; s += 5) ys.push(yAt(d, s));
  return { min: Math.min(...ys), max: Math.max(...ys) };
};
const relief = (d: Terrain) => Math.max(...d.track) - Math.min(...d.track);

describe('Spa-Francorchamps', () => {
  const d = load('spa');
  it('has about 100 m of relief round the lap', () => {
    expect(relief(d)).toBeGreaterThan(70);
    expect(relief(d)).toBeLessThan(140);
  });
  it('drops from La Source to the Eau Rouge dip, then climbs steeply up Raidillon', () => {
    const laSource = range(d, 150, 300).max, dip = range(d, 700, 1100).min, raidillon = range(d, 1150, 1500).max;
    expect(laSource - dip).toBeGreaterThan(20);
    expect(raidillon - dip).toBeGreaterThan(30);
    // steep: most of that within 400 m
    expect(yAt(d, 1300) - dip).toBeGreaterThan(25);
  });
});

describe('Monaco', () => {
  const d = load('monaco');
  it('climbs from Ste Dévote up to Casino, then down to the harbour', () => {
    const steDevote = yAt(d, 200), casino = range(d, 700, 1100).max, harbour = range(d, 2200, 2600).min;
    expect(casino - steDevote).toBeGreaterThan(20);
    expect(casino - harbour).toBeGreaterThan(25);
  });
});

describe.each(['monza', 'silverstone'])('%s', id => {
  it('is nearly flat', () => expect(relief(load(id))).toBeLessThan(25));
});

describe.each(CIRCUITS)('$name terrain', def => {
  const d = load(def.id), t = buildTrack(def);
  it('covers the whole lap and a grid round it', () => {
    expect(d.track.length * d.trackStep).toBeCloseTo(t.length, -1);
    expect(d.grid).toHaveLength(d.nx * d.nz);
    expect(d.track[0]).toBe(0); // heights are relative to the start line
  });
  it('has a smooth, drivable profile: no step of more than a few metres between samples', () => {
    for (let k = 0; k < d.track.length; k++)
      expect(Math.abs(d.track[(k + 1) % d.track.length] - d.track[k]), `at ${(k * d.trackStep).toFixed(0)} m`).toBeLessThan(3.5);
  });
});
