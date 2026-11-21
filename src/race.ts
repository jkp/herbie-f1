import { newCar, stepCar, type CarState, type Controls } from './car';
import { pointAt, project, wrapAngle, type Track } from './track';
import { aiControls, speedProfile } from './ai';
import { DRIVERS, type Team } from './grid';

export interface Racer {
  name: string; code: string; number: number; team: Team; color: number;
  isPlayer: boolean; skill: number; lane: number;
  car: CarState;
  i: number; s: number; lateral: number; // where we are on the track
  total: number;      // distance covered since the start line (negative on the grid)
  completed: number;  // laps completed
  lapStart: number; lastLap: number; bestLap: number;
  finished: boolean; finishTime: number;
}
export interface Race {
  track: Track; profile: Float64Array; racers: Racer[]; player: Racer;
  laps: number; difficulty: number; time: number; countdown: number; phase: 'countdown' | 'racing' | 'finished';
  runoff: number;
}

const CAR_RADIUS = 2.2;

// AI drive at `pace` × the speed profile × car pace × driver skill.
export const DIFFICULTIES = [
  { name: 'Beginner', pace: 0.84 },
  { name: 'Amateur', pace: 0.87 },
  { name: 'Semi-Pro', pace: 0.9 },
  { name: 'Pro', pace: 0.93 },
  { name: 'World Class', pace: 0.955 },
  { name: 'Legendary', pace: 0.98 },
];

/** The 2022 grid, quickest first; the player takes `player`'s seat and keeps that car's grid slot. `size` trims the field. */
export function createRace(track: Track, o: { laps: number; countdown: number; player: string; size?: number; difficulty?: number }): Race {
  const difficulty = o.difficulty ?? 3;
  const field = [...DRIVERS].sort((a, b) => b.team.pace * b.skill - a.team.pace * a.skill);
  let entrants = field.slice(0, o.size ?? field.length);
  if (!entrants.some(d => d.code === o.player)) entrants = [...entrants.slice(0, -1), field.find(d => d.code === o.player)!];
  const racers: Racer[] = entrants.map((d, k) => {
    const back = 10 + k * 8, side = k % 2 ? 3.5 : -3.5; // staggered two-by-two grid
    const p = pointAt(track, -back);
    const car = newCar(p.x - Math.sin(p.heading) * side, p.z + Math.cos(p.heading) * side, p.heading, d.team.pace);
    return {
      name: d.name, code: d.code, number: d.number, team: d.team, color: d.team.color,
      isPlayer: d.code === o.player, skill: DIFFICULTIES[difficulty].pace * d.team.pace * d.skill, lane: side * 0.4,
      car, i: p.i, s: track.length - back, lateral: side, total: -back,
      completed: 0, lapStart: 0, lastLap: 0, bestLap: 0, finished: false, finishTime: 0,
    };
  });
  return {
    track, profile: speedProfile(track), racers, player: racers.find(r => r.isPlayer)!,
    laps: o.laps, difficulty, time: 0, countdown: o.countdown, phase: o.countdown > 0 ? 'countdown' : 'racing', runoff: track.runoff,
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
      // hit the barrier: put the car back inside it and scrape along it, losing speed the harder the impact
      const p = pointAt(track, pr.s), side = Math.sign(pr.lateral) * limit;
      r.car.x = p.x - Math.sin(p.heading) * side; r.car.z = p.z + Math.cos(p.heading) * side;
      const along = Math.cos(wrapAngle(r.car.heading - p.heading));
      r.car.heading = along >= 0 ? p.heading : p.heading + Math.PI;
      r.car.speed *= Math.abs(along) * 0.7; pr.lateral = side;
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
