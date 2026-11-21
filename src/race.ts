import { newCar, stepCar, type CarState, type Controls } from './car';
import { pointAt, project, type Track } from './track';
import { aiControls, speedProfile } from './ai';

export interface Racer {
  name: string; color: number; isPlayer: boolean; skill: number; lane: number;
  car: CarState;
  i: number; s: number; lateral: number; // where we are on the track
  total: number;      // distance covered since the start line (negative on the grid)
  completed: number;  // laps completed
  lapStart: number; lastLap: number; bestLap: number;
  finished: boolean; finishTime: number;
}
export interface Race {
  track: Track; profile: Float64Array; racers: Racer[]; player: Racer;
  laps: number; time: number; countdown: number; phase: 'countdown' | 'racing' | 'finished';
  runoff: number;
}

const DRIVERS: [string, number][] = [
  ['Verstappel', 0x1e3a8a], ['Hamiltune', 0xdc2626], ['Norrish', 0xf97316],
  ['Leclairc', 0xb91c1c], ['Alonsoso', 0x065f46], ['Russellby', 0x14b8a6],
  ['Piastrino', 0xfb923c], ['Sainzly', 0x2563eb], ['Gaslight', 0xec4899],
];
const CAR_RADIUS = 2.2;

export function createRace(track: Track, o: { laps: number; opponents: number; countdown: number }): Race {
  const racers: Racer[] = [];
  const count = o.opponents + 1;
  for (let k = 0; k < count; k++) {
    const isPlayer = k === count - 1; // player starts at the back
    const back = 10 + k * 9, side = k % 2 ? 3.5 : -3.5;
    const p = pointAt(track, -back);
    const car = newCar(p.x - Math.sin(p.heading) * side, p.z + Math.cos(p.heading) * side, p.heading);
    const [name, color] = isPlayer ? ['You', 0xfacc15] as [string, number] : DRIVERS[k % DRIVERS.length];
    racers.push({
      name, color, isPlayer, skill: 0.9 + 0.07 * (1 - k / Math.max(1, count - 1)), lane: side * 0.4,
      car, i: p.i, s: track.length - back, lateral: side, total: -back,
      completed: 0, lapStart: 0, lastLap: 0, bestLap: 0, finished: false, finishTime: 0,
    });
  }
  return {
    track, profile: speedProfile(track), racers, player: racers[count - 1],
    laps: o.laps, time: 0, countdown: o.countdown, phase: o.countdown > 0 ? 'countdown' : 'racing', runoff: 20,
  };
}

export function stepRace(race: Race, dt: number, player: Controls) {
  if (race.phase === 'countdown') {
    race.countdown -= dt;
    if (race.countdown > 0) return;
    race.phase = 'racing';
    dt = -race.countdown; race.countdown = 0;
  }
  race.time += dt;
  const { track } = race, edge = track.width / 2;

  for (const r of race.racers) {
    const ctl = r.isPlayer && !r.finished ? player : aiControls(r, race);
    stepCar(r.car, ctl, dt, Math.abs(r.lateral) <= edge + 1 ? 'track' : 'grass');
  }

  // car-to-car contact: separate and bleed speed off the car behind
  for (let a = 0; a < race.racers.length; a++)
    for (let b = a + 1; b < race.racers.length; b++) {
      const A = race.racers[a].car, B = race.racers[b].car;
      let dx = B.x - A.x, dz = B.z - A.z, d = Math.hypot(dx, dz);
      if (d >= CAR_RADIUS * 2) continue;
      if (d < 1e-6) { dx = 1; dz = 0; d = 1; }
      const push = (CAR_RADIUS * 2 - d) / 2 + 0.01, nx = dx / d, nz = dz / d;
      A.x -= nx * push; A.z -= nz * push; B.x += nx * push; B.z += nz * push;
      const aBehind = Math.cos(A.heading) * nx + Math.sin(A.heading) * nz > 0;
      const [rear, front] = aBehind ? [A, B] : [B, A];
      rear.speed = Math.min(rear.speed, front.speed * 0.97);
    }

  for (const r of race.racers) {
    const pr = project(track, r.car.x, r.car.z, r.i);
    const limit = edge + race.runoff;
    if (Math.abs(pr.lateral) > limit) {
      // hit the barrier: put the car back inside it and kill most of its speed
      const p = pointAt(track, pr.s), side = Math.sign(pr.lateral) * limit;
      r.car.x = p.x - Math.sin(p.heading) * side; r.car.z = p.z + Math.cos(p.heading) * side;
      r.car.speed *= 0.3; pr.lateral = side;
    }
    let ds = pr.s - r.s;
    if (ds > track.length / 2) ds -= track.length;
    if (ds < -track.length / 2) ds += track.length;
    r.total += ds; r.i = pr.i; r.s = pr.s; r.lateral = pr.lateral;

    const laps = Math.floor(r.total / track.length);
    if (laps > r.completed && !r.finished) {
      r.completed = laps;
      r.lastLap = race.time - r.lapStart; r.lapStart = race.time;
      if (!r.bestLap || r.lastLap < r.bestLap) r.bestLap = r.lastLap;
      if (r.completed >= race.laps) { r.finished = true; r.finishTime = race.time; }
    }
  }
  if (race.player.finished) race.phase = 'finished';
}

/** Finishers by finish time, then everyone else by distance covered. */
export const standings = (race: Race) => [...race.racers].sort((a, b) =>
  a.finished && b.finished ? a.finishTime - b.finishTime : a.finished ? -1 : b.finished ? 1 : b.total - a.total);
