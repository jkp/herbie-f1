// Tilt steering: hold the iPad upright like a steering wheel and turn it.
// The accelerometer's reading of "up", turned into the screen's axes, rotates the opposite way to the screen.

/** The screen's turn (radians, clockwise positive, up to a constant) from an accelerometer reading in device axes
 *  (x right, y up in the device's natural orientation) and the screen's orientation angle in degrees.
 *  Null when the device is lying too flat to tell. */
export function wheelAngle(g: { x: number | null; y: number | null; z?: number | null }, screenAngle: number) {
  const x = g.x ?? 0, y = g.y ?? 0, a = screenAngle * Math.PI / 180;
  const sx = x * Math.cos(a) - y * Math.sin(a), sy = x * Math.sin(a) + y * Math.cos(a);
  if (Math.hypot(sx, sy) < 3) return null;
  return -Math.atan2(sx, sy); // negating both axes (some browsers' sign convention) only shifts this by π
}

const DEAD = 2 * Math.PI / 180, LOCK = 30 * Math.PI / 180;
/** Steering input (-1 left … +1 right) for a wheel angle relative to `zero`, the angle when tilt was switched on. */
export function tiltSteer(angle: number, zero: number) {
  const d = Math.atan2(Math.sin(angle - zero), Math.cos(angle - zero));
  if (Math.abs(d) < DEAD) return 0;
  return Math.max(-1, Math.min(1, (d - Math.sign(d) * DEAD) / (LOCK - DEAD)));
}
