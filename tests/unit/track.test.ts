import { describe, it, expect } from 'vitest';
import { buildTrack, project, pointAt } from '../../src/track';
import { CIRCUITS } from '../../src/circuits';

function segmentsCross(ax: number, az: number, bx: number, bz: number, cx: number, cz: number, dx: number, dz: number) {
  const o = (px: number, pz: number, qx: number, qz: number, rx: number, rz: number) => Math.sign((qx - px) * (rz - pz) - (qz - pz) * (rx - px));
  return o(ax, az, bx, bz, cx, cz) * o(ax, az, bx, bz, dx, dz) < 0 && o(cx, cz, dx, dz, ax, az) * o(cx, cz, dx, dz, bx, bz) < 0;
}

describe.each(CIRCUITS)('$name', def => {
  const t = buildTrack(def);

  it('matches the official lap length within 2%', () => {
    expect(Math.abs(t.length - def.officialLength) / def.officialLength).toBeLessThan(0.02);
  });

  it('carries its own width and run-off', () => {
    expect(t.width).toBe(def.width);
    expect(t.runoff).toBe(def.runoff);
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

  it('keeps separate parts of the circuit apart (no barrier across other tarmac)', () => {
    const step = 8;
    for (let i = 0; i < t.n; i += step)
      for (let j = i + step; j < t.n; j += step) {
        const along = Math.min(Math.abs(t.cum[i] - t.cum[j]), t.length - Math.abs(t.cum[i] - t.cum[j]));
        if (along < 200) continue;
        expect(Math.hypot(t.xs[i] - t.xs[j], t.zs[i] - t.zs[j]), `at ${t.cum[i].toFixed(0)}m / ${t.cum[j].toFixed(0)}m`).toBeGreaterThan(t.width + t.runoff);
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
    expect(maxK).toBeGreaterThan(1 / 120);
  });
});

describe.each(CIRCUITS)('run-off room at $name', def => {
  const t = buildTrack(def), w = t.width / 2;
  // other parts of the lap: further round the lap than they are away
  const far = (i: number, j: number, d: number) => { const ds = Math.abs(t.cum[i] - t.cum[j]); return Math.min(ds, t.length - ds) > 1.2 * d + 5; };

  it('stops the run-off and barriers before they reach another part of the lap, so no wall or apron crosses a road', () => {
    for (let i = 0; i < t.n; i += 3) {
      const a = (i - 1 + t.n) % t.n, b = (i + 1) % t.n, h = Math.atan2(t.zs[b] - t.zs[a], t.xs[b] - t.xs[a]);
      for (const [k, side] of [[0, -1], [1, 1]] as const) {
        const r = t.room[k][i];
        expect(r).toBeGreaterThan(w);
        expect(r).toBeLessThanOrEqual(w + t.runoff + 1e-6);
        const x = t.xs[i] - Math.sin(h) * side * r, z = t.zs[i] + Math.cos(h) * side * r;
        for (let j = 0; j < t.n; j += 2) {
          const d = Math.hypot(t.xs[j] - x, t.zs[j] - z);
          if (d < w && far(i, j, Math.hypot(t.xs[j] - t.xs[i], t.zs[j] - t.zs[i]))) throw new Error(`${def.id}: run-off at ${t.cum[i].toFixed(0)} m (${side > 0 ? 'right' : 'left'}) lands on the road at ${t.cum[j].toFixed(0)} m`);
        }
      }
    }
  });

  it('keeps the full run-off where nothing else is near', () => {
    const full = [0, 1].map(k => t.room[k].filter(r => r > w + t.runoff - 1e-6).length / t.n);
    expect(Math.min(...full)).toBeGreaterThan(0.6);
  });
});
