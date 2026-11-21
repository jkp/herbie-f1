import { GRIP_AERO, GRIP_BASE, brakeDecel, maxSteerAngle, type Controls } from './car';
import { pointAt, wrapAngle, type Track } from './track';
import type { Race, Racer } from './race';

/** Fastest safe speed at each track point: corner limit from grip, then braking zones worked backwards. */
export function speedProfile(t: Track): Float64Array {
  const v = new Float64Array(t.n);
  for (let i = 0; i < t.n; i++) {
    const k = t.curvature[i];
    // solve v²k = lateralGrip(v), small margin for line errors
    v[i] = k > GRIP_AERO ? Math.min(95, Math.sqrt(GRIP_BASE / (k - GRIP_AERO)) * 0.93) : 95;
  }
  for (let pass = 0; pass < 2; pass++)
    for (let i = t.n - 1; i >= 0; i--) {
      const j = (i + 1) % t.n, ds = t.length / t.n;
      v[i] = Math.min(v[i], Math.sqrt(v[j] * v[j] + 2 * brakeDecel(v[j], 'track') * 0.75 * ds));
    }
  return v;
}

/** Pure-pursuit steering towards a point ahead on the racer's lane, throttle/brake to hold the speed profile. */
export function aiControls(r: Racer, race: Race, skill = r.skill): Controls {
  const c = r.car, v = Math.max(c.speed, 5);
  const ahead = pointAt(race.track, r.s + 6 + v * 0.3);
  const tx = ahead.x - Math.sin(ahead.heading) * r.lane, tz = ahead.z + Math.cos(ahead.heading) * r.lane;
  const err = wrapAngle(Math.atan2(tz - c.z, tx - c.x) - c.heading);
  const ld = Math.hypot(tx - c.x, tz - c.z);
  const delta = Math.atan(3.6 * 2 * Math.sin(err) / ld);
  const steer = Math.max(-1, Math.min(1, delta / maxSteerAngle(c.speed)));

  let target = race.profile[r.i] * skill * Math.sqrt(c.grip); // corner speed ∝ √grip
  // traffic: follow a slower car in our lane, and pull to its other side to pass
  const room = race.track.width / 2 - 2;
  for (const o of race.racers) {
    const gap = o.total - r.total;
    if (o === r || o.pitTimer > 0 || gap <= 0 || gap > 8 + v * 0.4 || Math.abs(o.lateral - r.lateral) > 2.6) continue;
    if (o.car.speed < c.speed) {
      target = Math.min(target, o.car.speed - 1 + gap * 0.3);
      r.lane = o.lateral > 0 ? -room : room;
    }
  }
  if (c.speed < target - 0.5) return { throttle: 1, brake: 0, steer };
  if (c.speed > target + 1) return { throttle: 0, brake: Math.min(1, (c.speed - target) / 4), steer };
  return { throttle: 0.4, brake: 0, steer };
}
