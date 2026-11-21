import { describe, it, expect } from 'vitest';
import { newCar, stepCar, gearFor, lateralGrip } from '../../src/car';

const run = (secs: number, ctl: { throttle: number; brake: number; steer: number }, surface: 'track' | 'grass' = 'track', car = newCar(0, 0, 0)) => {
  for (let i = 0; i < secs * 120; i++) stepCar(car, ctl, 1 / 120, surface);
  return car;
};

describe('car physics', () => {
  it('accelerates 0-100 km/h in F1-ish time (2-4 s)', () => {
    const car = newCar(0, 0, 0);
    let t = 0;
    while (car.speed < 100 / 3.6 && t < 10) { stepCar(car, { throttle: 1, brake: 0, steer: 0 }, 1 / 120, 'track'); t += 1 / 120; }
    expect(t).toBeGreaterThan(2);
    expect(t).toBeLessThan(4);
  });

  it('tops out around 320-340 km/h', () => {
    const car = run(60, { throttle: 1, brake: 0, steer: 0 });
    expect(car.speed * 3.6).toBeGreaterThan(310);
    expect(car.speed * 3.6).toBeLessThan(345);
  });

  it('moves along its heading', () => {
    const car = run(2, { throttle: 1, brake: 0, steer: 0 }, 'track', newCar(0, 0, Math.PI / 2));
    expect(Math.abs(car.x)).toBeLessThan(1e-6);
    expect(car.z).toBeGreaterThan(5);
  });

  it('brakes hard from 300 km/h to standstill in under 5 s', () => {
    const car = newCar(0, 0, 0); car.speed = 300 / 3.6;
    run(5, { throttle: 0, brake: 1, steer: 0 }, 'track', car);
    expect(car.speed).toBeLessThan(0.5);
  });

  it('is much slower on grass', () => {
    expect(run(20, { throttle: 1, brake: 0, steer: 0 }, 'grass').speed * 3.6).toBeLessThan(160);
  });

  it('turns right with positive steer and never exceeds lateral grip', () => {
    const car = newCar(0, 0, 0); car.speed = 60;
    let maxLat = 0;
    for (let i = 0; i < 120; i++) {
      const h0 = car.heading;
      stepCar(car, { throttle: 1, brake: 0, steer: 1 }, 1 / 120, 'track');
      maxLat = Math.max(maxLat, Math.abs(car.heading - h0) * 120 * car.speed);
    }
    expect(car.heading).toBeGreaterThan(0);
    expect(maxLat).toBeLessThanOrEqual(lateralGrip(60, 'track') * 1.05);
  });

  it('can reverse slowly when braking at a standstill', () => {
    const car = run(3, { throttle: 0, brake: 1, steer: 0 });
    expect(car.speed).toBeLessThan(0);
    expect(car.speed).toBeGreaterThan(-10);
  });

  it('reports gears 1-8 rising with speed', () => {
    expect(gearFor(5).gear).toBe(1);
    expect(gearFor(90).gear).toBe(8);
    expect(gearFor(50).gear).toBeGreaterThan(gearFor(30).gear);
    expect(gearFor(-3).gear).toBe(0);
  });
});
