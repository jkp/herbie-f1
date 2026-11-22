import { GRIP_AERO, GRIP_BASE, brakeDecel, maxSteerAngle, type Controls } from './car';
import { pointAt, wrapAngle, type Track } from './track';
import { PIT, boxAt, type Race, type Racer } from './race';
import { TEAMS } from './grid';

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

/** Pure-pursuit steering input that follows the track `lane` metres right of the centreline (or a line that varies along the lap). */
export function pursuitSteer(r: Racer, race: Race, laneAt: number | ((s: number) => number)) {
  const c = r.car, v = Math.max(c.speed, 5), s = r.s + 6 + v * 0.3;
  const ahead = pointAt(race.track, s), lane = typeof laneAt === 'number' ? laneAt : laneAt(s);
  const tx = ahead.x - Math.sin(ahead.heading) * lane, tz = ahead.z + Math.cos(ahead.heading) * lane;
  const err = wrapAngle(Math.atan2(tz - c.z, tx - c.x) - c.heading);
  const ld = Math.hypot(tx - c.x, tz - c.z);
  const delta = Math.atan(3.6 * 2 * Math.sin(err) / ld);
  return Math.max(-1, Math.min(1, delta / maxSteerAngle(c.speed)));
}

/** Driving help for the player on easy difficulties: brake for corners, keep the car on the road. */
export function assistControls(r: Racer, race: Race, ctl: Controls, help: { brake: boolean; steer: boolean }): Controls {
  const out = { ...ctl };
  if (help.steer) {
    // follow the track at the player's current line, so they can still move across to overtake
    const lane = Math.max(-race.track.width / 2 + 2, Math.min(race.track.width / 2 - 2, r.lateral));
    out.steer = Math.max(-1, Math.min(1, pursuitSteer(r, race, lane) + ctl.steer * 0.8));
  }
  if (help.brake) {
    const target = race.profile[r.i] * Math.sqrt(r.car.grip);
    if (r.car.speed > target + 0.5) { out.throttle = 0; out.brake = Math.max(ctl.brake, Math.min(1, (r.car.speed - target) / 4)); }
  }
  return out;
}

/** Pure-pursuit steering towards a point ahead on the racer's lane, throttle/brake to hold the speed profile. */
export function aiControls(r: Racer, race: Race, skill = r.skill): Controls {
  const c = r.car, v = Math.max(c.speed, 5), { pit } = race, rel = pit.rel(r.s);
  // heading for the pits: follow the lane, swing into our box if we're stopping, and keep to the limit
  const pitting = r.inPitLane || r.boxRequested && rel > PIT.a - 150 && rel < PIT.b;
  const box = boxAt(TEAMS.indexOf(r.team));
  const pitLine = (s: number) => {
    const q = pit.rel(s), toBox = r.boxRequested ? Math.max(0, 1 - Math.abs(q - box) / 25) : 0;
    return pit.side * (pit.centre(q) + (pit.box - pit.fast) * toBox * toBox * (3 - 2 * toBox));
  };
  const steer = pursuitSteer(r, race, pitting ? pitLine : r.lane);

  let target = race.profile[r.i] * skill * Math.sqrt(c.grip); // corner speed ∝ √grip
  if (pitting && rel < PIT.c) {
    target = Math.min(target, Math.sqrt(PIT.limit ** 2 + 2 * 8 * Math.max(0, PIT.b - rel)) - 0.5);
    if (r.boxRequested) target = Math.min(target, Math.sqrt(2 * 6 * Math.max(0, box - rel)) + 1.5);
  }
  // traffic: follow a slower car in our lane, and pull to its other side to pass
  const room = race.track.width / 2 - 2;
  for (const o of race.racers) {
    const gap = o.total - r.total;
    if (o === r || o.pitTimer > 0 || o.inPitLane !== r.inPitLane || gap <= 0 || gap > 8 + v * 0.4 || Math.abs(o.lateral - r.lateral) > 2.6) continue;
    if (o.car.speed < c.speed) {
      target = Math.min(target, o.car.speed - 1 + gap * 0.3);
      r.lane = o.lateral > 0 ? -room : room;
    }
  }
  if (c.speed < target - 0.5) return { throttle: 1, brake: 0, steer };
  if (c.speed > target + 1) return { throttle: 0, brake: Math.min(1, (c.speed - target) / 4), steer };
  return { throttle: 0.4, brake: 0, steer };
}
