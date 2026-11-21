import { describe, it, expect } from 'vitest';
import { buildTrack, project } from '../../src/track';
import { CIRCUITS } from '../../src/circuits';
import { standSpots } from '../../src/scene';

describe.each(CIRCUITS)('grandstands at $name', def => {
  const t = buildTrack(def), spots = standSpots(t);

  it('has stands along the start straight and around the lap', () => {
    expect(spots.length).toBeGreaterThanOrEqual(5);
    expect(spots.some(s => s.s < 300 || s.s > t.length - 100)).toBe(true);
  });

  it('never puts a stand on or next to the circuit', () => {
    for (const sp of spots)
      for (const along of [-30, 0, 30]) {
        const x = sp.x + Math.cos(sp.heading) * along, z = sp.z + Math.sin(sp.heading) * along;
        expect(Math.abs(project(t, x, z).lateral), `stand at ${sp.s.toFixed(0)}m`).toBeGreaterThan(t.width / 2 + t.runoff + 6);
      }
  });

  it('spreads stands out', () => {
    for (let a = 0; a < spots.length; a++)
      for (let b = a + 1; b < spots.length; b++)
        expect(Math.hypot(spots[a].x - spots[b].x, spots[a].z - spots[b].z)).toBeGreaterThan(70);
  });
});
