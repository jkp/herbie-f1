// Arcade-sim car: point mass moving along its heading, grip-limited yaw, downforce grows with speed.
export type Surface = 'track' | 'grass';
export interface Controls { throttle: number; brake: number; steer: number } // steer: -1 left .. +1 right
// power: engine multiplier (1 = best car); grip: tyre condition multiplier (1 = fresh)
// spin: yaw rate (rad/s) while spun out, 0 when driving; slip: the direction it slides in meanwhile
export interface CarState { x: number; z: number; heading: number; speed: number; steer: number; power: number; grip: number; spin: number; slip: number }

const WHEELBASE = 3.6;
const POWER = 940;        // W per kg: ~750 kW / 800 kg
const TRACTION = 12;      // m/s² launch limit
const DRAG = 0.0012;      // per m of v²; gives ~330 km/h top speed
const STEER_RATE = 5;     // steering travel per second

export const newCar = (x: number, z: number, heading: number, power = 1): CarState => ({ x, z, heading, speed: 0, steer: 0, power, grip: 1, spin: 0, slip: heading });

/** Max lateral acceleration (m/s²); downforce adds grip with v². */
export const GRIP_BASE = 18, GRIP_AERO = 0.007;
export const lateralGrip = (v: number, s: Surface) => (GRIP_BASE + GRIP_AERO * v * v) * (s === 'grass' ? 0.45 : 1);
export const brakeDecel = (v: number, s: Surface) => (20 + 0.004 * v * v) * (s === 'grass' ? 0.4 : 1);
// Full lock is enough for Monaco's ~10 m hairpin at hairpin speed; at speed, grip is the limit anyway.
export const maxSteerAngle = (v: number) => 0.55 / (1 + Math.abs(v) / 25);

/** Spin out: the car rotates (`dir` +1 clockwise, -1 anticlockwise) while sliding on along its line. */
export function startSpin(c: CarState, dir: number) {
  if (c.spin) return;
  c.spin = Math.sign(dir || 1) * (4 + Math.min(4, Math.abs(c.speed) / 15)); c.slip = c.heading; c.steer = 0;
}

/** Advance the car; returns how hard it was asked to turn against its grip (over 1 = sliding). */
export function stepCar(c: CarState, ctl: Controls, dt: number, surface: Surface) {
  if (c.spin) {
    // spun: no control, the tyres scrub it to a stop as it turns
    c.heading += c.spin * dt; c.spin *= Math.exp(-0.6 * dt);
    c.speed = Math.max(0, Math.abs(c.speed) - (surface === 'grass' ? 7 : 11) * dt);
    c.x += Math.cos(c.slip) * c.speed * dt; c.z += Math.sin(c.slip) * c.speed * dt;
    if (c.speed === 0) c.spin = 0;
    return 0;
  }
  const target = Math.max(-1, Math.min(1, ctl.steer));
  c.steer += Math.max(-STEER_RATE * dt, Math.min(STEER_RATE * dt, target - c.steer));

  const v = c.speed, av = Math.abs(v);
  let a = -DRAG * v * Math.abs(v) - Math.sign(v) * 0.3;
  if (surface === 'grass') a -= Math.sign(v) * (3 + 0.01 * v * v);
  if (ctl.throttle > 0 && v >= 0) a += ctl.throttle * Math.min(TRACTION, POWER * c.power / Math.max(av, 1)) * (surface === 'grass' ? 0.5 : 1);
  if (ctl.brake > 0) {
    if (v > 0.5) a -= ctl.brake * brakeDecel(av, surface) * c.grip;
    else if (ctl.throttle === 0) a -= 4 * ctl.brake; // reverse gear
  }

  // Yaw: kinematic bicycle, capped by lateral grip; asking for more scrubs speed (understeer).
  const kin = v * Math.tan(c.steer * maxSteerAngle(v)) / WHEELBASE;
  const cap = av > 0.1 ? lateralGrip(av, surface) * c.grip / av : Infinity;
  const yaw = Math.max(-cap, Math.min(cap, kin));
  if (Math.abs(kin) > cap) a -= Math.sign(v) * Math.min(8, (Math.abs(kin) / cap - 1) * 6);

  let nv = v + a * dt;
  if (v > 0 && nv < 0 && ctl.throttle === 0 && !(ctl.brake > 0 && v <= 0.5)) nv = 0; // don't roll back from drag/braking alone
  if (v < 0 && nv > 0) nv = 0;
  c.speed = Math.max(-8, nv);
  c.heading += yaw * dt;
  c.x += Math.cos(c.heading) * c.speed * dt;
  c.z += Math.sin(c.heading) * c.speed * dt;
  return Number.isFinite(cap) ? Math.abs(kin) / cap : 0;
}

const GEAR_TOP = [0, 22, 33, 43, 53, 63, 73, 83, 95]; // m/s at redline per gear
export function gearFor(v: number) {
  if (v < 0) return { gear: 0, rpm: 4000 + Math.min(1, -v / 8) * 4000 };
  let g = 1;
  while (g < 8 && v > GEAR_TOP[g]) g++;
  const lo = g === 1 ? 0 : GEAR_TOP[g - 1] * 0.75;
  return { gear: g, rpm: 4000 + 8500 * Math.min(1, Math.max(0, (v - lo) / (GEAR_TOP[g] - lo))) };
}
