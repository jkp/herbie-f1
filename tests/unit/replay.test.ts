import { describe, it, expect } from 'vitest';
import { makeReplay } from '../../src/replay';

const car = (x: number, heading = 0) => ({ x, z: 2 * x, heading, steer: 0, s: x, on: true });

describe('replay', () => {
  it('records the cars a few times a second and plays them back smoothly between frames', () => {
    const rp = makeReplay(2, 10, 10);
    for (let t = 0; t <= 2; t += 1 / 120) rp.record(t, [car(t * 10), car(t * 20)]);
    expect(rp.from).toBeCloseTo(0, 5);
    expect(rp.to).toBeGreaterThan(1.9);
    const mid = rp.sample(1.05, 0);
    expect(mid.x).toBeCloseTo(10.5, 1);
    expect(mid.z).toBeCloseTo(21, 1);
    expect(rp.sample(1.05, 1).x).toBeCloseTo(21, 1);
  });

  it('turns the short way round when the heading wraps past ±π', () => {
    const rp = makeReplay(1, 10, 10);
    rp.record(0, [car(0, Math.PI - 0.1)]);
    rp.record(0.1, [car(0, -Math.PI + 0.1)]);
    const h = rp.sample(0.05, 0).heading;
    expect(Math.abs(Math.cos(h) + 1)).toBeLessThan(0.01); // still pointing the same way, not swung through zero
  });

  it('keeps only the last few seconds', () => {
    const rp = makeReplay(1, 5, 10);
    for (let t = 0; t <= 20; t += 0.05) rp.record(t, [car(t)]);
    expect(rp.from).toBeGreaterThan(14.5);
    expect(rp.sample(0, 0).x).toBeCloseTo(rp.from, 1); // before the start clamps to the oldest frame
  });

  it('remembers cars that are hidden, like the safety car in the garage', () => {
    const rp = makeReplay(1, 5, 10);
    rp.record(0, [{ ...car(0), on: false }]); rp.record(0.1, [{ ...car(1), on: false }]);
    expect(rp.sample(0.05, 0).on).toBe(false);
  });
});
