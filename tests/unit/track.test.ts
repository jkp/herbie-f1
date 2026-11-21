import { describe, it, expect } from 'vitest';
import { buildTrack, project, pointAt } from '../../src/track';
import { SILVERSTONE } from '../../src/silverstone';

const t = buildTrack(SILVERSTONE);

function segmentsCross(ax: number, az: number, bx: number, bz: number, cx: number, cz: number, dx: number, dz: number) {
  const o = (px: number, pz: number, qx: number, qz: number, rx: number, rz: number) => Math.sign((qx - px) * (rz - pz) - (qz - pz) * (rx - px));
  return o(ax, az, bx, bz, cx, cz) * o(ax, az, bx, bz, dx, dz) < 0 && o(cx, cz, dx, dz, ax, az) * o(cx, cz, dx, dz, bx, bz) < 0;
}

describe('track', () => {
  it('is roughly Silverstone length (5.89 km)', () => {
    expect(t.length).toBeGreaterThan(5600);
    expect(t.length).toBeLessThan(6200);
  });

  it('is a closed loop', () => {
    const a = pointAt(t, 0), b = pointAt(t, t.length - 0.01);
    expect(Math.hypot(a.x - b.x, a.z - b.z)).toBeLessThan(1);
  });

  it('never crosses itself', () => {
    const step = 4, n = t.n;
    for (let i = 0; i < n; i += step)
      for (let j = i + step * 3; j < n; j += step) {
        if (i === 0 && j + step >= n) continue;
        const i2 = (i + step) % n, j2 = (j + step) % n;
        expect(segmentsCross(t.xs[i], t.zs[i], t.xs[i2], t.zs[i2], t.xs[j], t.zs[j], t.xs[j2], t.zs[j2])).toBe(false);
      }
  });

  it('keeps separate parts of the circuit apart (no overlapping tarmac)', () => {
    const step = 8;
    for (let i = 0; i < t.n; i += step)
      for (let j = i + step; j < t.n; j += step) {
        const along = Math.min(Math.abs(t.cum[i] - t.cum[j]), t.length - Math.abs(t.cum[i] - t.cum[j]));
        if (along < 200) continue;
        expect(Math.hypot(t.xs[i] - t.xs[j], t.zs[i] - t.zs[j])).toBeGreaterThan(t.width * 3);
      }
  });

  it('projects points onto the centreline with signed lateral offset', () => {
    const p = pointAt(t, 1234);
    const rx = -Math.sin(p.heading), rz = Math.cos(p.heading);
    const r = project(t, p.x + rx * 3, p.z + rz * 3);
    expect(r.s).toBeCloseTo(1234, 0);
    expect(r.lateral).toBeCloseTo(3, 1);
    const l = project(t, p.x - rx * 5, p.z - rz * 5, r.i);
    expect(l.lateral).toBeCloseTo(-5, 1);
  });

  it('wraps distance along the lap', () => {
    const p = pointAt(t, t.length + 10);
    const q = pointAt(t, 10);
    expect(p.x).toBeCloseTo(q.x, 5);
  });

  it('has a turn curvature profile with real corners', () => {
    const maxK = Math.max(...t.curvature);
    expect(maxK).toBeGreaterThan(1 / 60); // tight stuff like the Loop
  });
});
