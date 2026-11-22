import { describe, it, expect } from 'vitest';
import { wheelAngle, tiltSteer } from '../../src/tilt';

/** The accelerometer reading (device axes) when the screen, held upright at `screenAngle`, is turned clockwise by `turn` degrees. */
function reading(turn: number, screenAngle: number, inverted = false) {
  const f = turn * Math.PI / 180, a = screenAngle * Math.PI / 180, g = inverted ? -9.81 : 9.81;
  const sx = -Math.sin(f) * g, sy = Math.cos(f) * g; // "up" in screen axes rotates the other way to the screen
  return { x: sx * Math.cos(a) + sy * Math.sin(a), y: -sx * Math.sin(a) + sy * Math.cos(a), z: 0 };
}

describe('tilt steering: hold the iPad like a steering wheel', () => {
  it.each([0, 90, -90, 180, 270])('turning it right steers right, left steers left, with the screen at %i°', angle => {
    const zero = wheelAngle(reading(0, angle), angle)!;
    expect(tiltSteer(wheelAngle(reading(15, angle), angle)!, zero)).toBeGreaterThan(0.4);
    expect(tiltSteer(wheelAngle(reading(-15, angle), angle)!, zero)).toBeLessThan(-0.4);
    expect(tiltSteer(wheelAngle(reading(1, angle), angle)!, zero)).toBe(0); // a little wobble does nothing
  });

  it('works whichever sign convention the browser uses for gravity', () => {
    const zero = wheelAngle(reading(0, 90, true), 90)!;
    expect(tiltSteer(wheelAngle(reading(15, 90, true), 90)!, zero)).toBeGreaterThan(0.4);
  });

  it('is full lock by about 30°, and relative to how you held it when you switched it on', () => {
    const zero = wheelAngle(reading(10, 90), 90)!;
    expect(tiltSteer(wheelAngle(reading(10, 90), 90)!, zero)).toBe(0);
    expect(tiltSteer(wheelAngle(reading(45, 90), 90)!, zero)).toBe(1);
  });

  it('ignores the reading when the iPad is lying flat', () => {
    expect(wheelAngle({ x: 0.2, y: 0.1, z: 9.8 }, 0)).toBeNull();
  });
});
