import { newCar, startSpin, stepCar, type CarState, type Controls } from './car';
import { pointAt, project, wrapAngle, type Track } from './track';
import { aiControls, assistControls, speedProfile } from './ai';
import { DRIVERS, TEAMS, type Team } from './grid';
import { WEATHER } from './conditions';

export interface Racer {
  name: string; code: string; number: number; team: Team; color: number;
  isPlayer: boolean; skill: number; lane: number;
  car: CarState;
  i: number; s: number; lateral: number; // where we are on the track
  total: number;      // distance covered since the start line (negative on the grid)
  completed: number;  // laps completed
  lapStart: number; lastLap: number; bestLap: number;
  finished: boolean; finishTime: number;
  tyreFrom: number;      // `total` when the current tyres went on
  boxRequested: boolean; // pit at the end of this lap
  pitTimer: number;      // > 0 while in the pits
  pits: number; stopTime: number;
  pitLaps: number[];     // compulsory stops: pit at the end of these laps
  compound: number; nextCompound: number; // index into COMPOUNDS: on the car now, and for the next stop
  inPitLane: boolean; punctured: boolean;
  damage: number; // front wing: 0 intact .. 1 destroyed
  out: boolean;   // crashed out of the race
}
export interface Race {
  track: Track; profile: Float64Array; racers: Racer[]; player: Racer;
  laps: number; difficulty: number; time: number; pitSide: number; countdown: number; phase: 'countdown' | 'racing' | 'finished';
  runoff: number; pit: ReturnType<typeof pitLane>;
  grip: number; // the track: 1 dry, lower in the wet
  safety: { s: number; speed: number; left: number } | null; // the safety car: where it is, its pace, seconds until it comes in
  seed: number;  // drives the AI's mistakes, so a race replays the same
  contacts: Set<Racer>[]; // per racer, who it was already touching last step: only a fresh hit does harm
}

const CAR_RADIUS = 2.2;
const IDLE = { throttle: 0, brake: 0, steer: 0 };
const SC_PACE = 38, SC_TIME = 45;          // the safety car's top speed (m/s) and how long it stays out (s)
const MISTAKE_RATE = 0.001;                // AI spins per second spent cornering, in the dry (×4 in the wet)
/** Compulsory stops, as the laps to pit at the end of: one in short races, two from 10 laps, three from 20, evenly spaced. */
export function pitPlan(laps: number) {
  const stops = laps >= 20 ? 3 : laps >= 10 ? 2 : laps >= 3 ? 1 : 0;
  return Array.from({ length: stops }, (_, k) => Math.round(laps * (k + 1) / (stops + 1)));
}

/** Tyre compounds: grip when fresh, and life as a multiple of a planned stint. Sidewall colours as in F1. */
export const COMPOUNDS = [
  { name: 'Soft', color: 0xd9262c, grip: 1.03, life: 1.1 },
  { name: 'Medium', color: 0xfacc15, grip: 1, life: 1.5 },
  { name: 'Hard', color: 0xf2f2f2, grip: 0.97, life: 2 },
];
/** A tyre bursts this far past the end of its life. */
export const PUNCTURE_AT = 1.5;
/** Laps a compound lasts in a race of `raceLaps`: a multiple of the planned stint. */
export const tyreLife = (compound: number, raceLaps: number) => COMPOUNDS[compound].life * raceLaps / (pitPlan(raceLaps).length + 1);
/** Grip after `lapsOn` laps on tyres that last `life` laps: a gentle fade, then a cliff. */
export function tyreGrip(lapsOn: number, life: number, compound: number) {
  const x = lapsOn / life, g = COMPOUNDS[compound].grip;
  return x <= 1 ? g * (1 - 0.05 * x * x) : Math.max(0.45, g * 0.95 - 0.5 * (x - 1));
}

/** Pit lane timing points, in metres from the start line (negative = before it), and the 80 km/h limit. */
export const PIT = { a: -460, b: -300, c: 60, d: 220, limit: 22.2 };
const smooth = (k: number) => k * k * (3 - 2 * k);
/** The pit lane: peels off the track edge at `a`, runs behind the pit wall from `b` (limiter on) to `c`, rejoins by `d`. */
export function pitLane(t: Track, side = pitSide(t)) {
  const w = t.width / 2, wall = w + t.runoff, fast = wall + 5, box = wall + 12, join = w - 2;
  /** Lane centre's distance from the track centreline at `rel` metres from the line. */
  const centre = (rel: number) => join + (fast - join) * (rel < PIT.a || rel > PIT.d ? 0
    : rel < PIT.b ? smooth((rel - PIT.a) / (PIT.b - PIT.a)) : rel <= PIT.c ? 1 : smooth((PIT.d - rel) / (PIT.d - PIT.c)));
  /** Metres from the line, negative before it. */
  const rel = (s: number) => (s > t.length / 2 ? s - t.length : s);
  return { side, wall, fast, box, centre, rel };
}
/** Where a team's car stops: its box, in metres from the line. */
export const boxAt = (teamIndex: number) => -40 - teamIndex * 16;

/** Which side of the start straight has room for the pit garages (+1 right, -1 left). */
export function pitSide(t: Track) {
  const clear = (side: number) => [-30, -90, -150, -200].every(s => {
    const p = pointAt(t, s), off = side * (t.width / 2 + t.runoff + 16);
    return Math.abs(project(t, p.x - Math.sin(p.heading) * off, p.z + Math.cos(p.heading) * off).lateral) > t.width / 2 + t.runoff + 8;
  });
  return clear(1) || !clear(-1) ? 1 : -1;
}
/** Garage spot for a team, behind the barrier before the start line. */
export function pitBox(t: Track, teamIndex: number, side = pitSide(t)) {
  const p = pointAt(t, boxAt(teamIndex)), off = side * pitLane(t, side).box;
  return { x: p.x - Math.sin(p.heading) * off, z: p.z + Math.cos(p.heading) * off, heading: p.heading };
}


// AI drive at `pace` × the speed profile × car pace × driver skill.
// `assist`: driving help for the player (auto-brake, steering help, extra grip).
// `pit`: help getting into the pits: the game drives you in, arrows show the way, or just the call on the radio.
// `crash`: what contact can do to the player: spin them, break their front wing, put them out of the race.
const NONE = { brake: false, steer: false, grip: 1 };
const SPIN = { spin: true, damage: false, retire: false }, DAMAGE = { spin: true, damage: true, retire: false }, ALL = { spin: true, damage: true, retire: true };
export const DIFFICULTIES = [
  { name: 'Beginner', pace: 0.74, assist: { brake: true, steer: true, grip: 1.25 }, pit: 'auto', crash: { spin: false, damage: false, retire: false } },
  { name: 'Amateur', pace: 0.8, assist: { brake: true, steer: true, grip: 1.12 }, pit: 'auto', crash: SPIN },
  { name: 'Semi-Pro', pace: 0.87, assist: { brake: true, steer: false, grip: 1 }, pit: 'arrows', crash: DAMAGE },
  { name: 'Pro', pace: 0.93, assist: NONE, pit: 'arrows', crash: DAMAGE },
  { name: 'World Class', pace: 0.955, assist: NONE, pit: 'call', crash: ALL },
  { name: 'Legendary', pace: 0.98, assist: NONE, pit: 'call', crash: ALL },
] as const;

/** The 2022 grid, quickest first; the player takes `player`'s seat and keeps that car's grid slot. `size` trims the field. */
export function createRace(track: Track, o: {
  laps: number; countdown: number; player: string; size?: number; difficulty?: number; tyre?: number; weather?: number; // player's starting compound; index into WEATHER
  rookie?: { name: string; code: string; number: number; replaces: string }; // career driver taking a seat
}): Race {
  const difficulty = o.difficulty ?? 3, rk = o.rookie;
  const drivers = DRIVERS.map(d => d.code === rk?.replaces ? { ...d, name: rk.name, code: rk.code, number: rk.number } : d);
  const field = [...drivers].sort((a, b) => b.team.pace * b.skill - a.team.pace * a.skill);
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
      tyreFrom: -back, boxRequested: false, pitTimer: 0, pits: 0, stopTime: 0,
      compound: d.code === o.player ? o.tyre ?? 1 : 1, nextCompound: d.code === o.player ? 1 : 2, inPitLane: false, punctured: false, damage: 0, out: false,
      // everyone makes the same number of stops; AI spread their timing by up to a lap either way
      pitLaps: pitPlan(o.laps).map((lap, i, plan) => d.code === o.player ? lap
        : Math.min(o.laps - 1 - (plan.length - 1 - i), Math.max(1 + i, lap + ((k * 7 + i * 3) % 3) - 1))),
    };
  });
  const side = pitSide(track);
  return {
    track, profile: speedProfile(track), racers, pitSide: side, pit: pitLane(track, side), player: racers.find(r => r.isPlayer)!,
    laps: o.laps, difficulty, time: 0, safety: null, seed: 1, contacts: racers.map(() => new Set()), grip: WEATHER[o.weather ?? 0].grip, countdown: o.countdown, phase: o.countdown > 0 ? 'countdown' : 'racing', runoff: track.runoff,
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
  const { track, pit } = race, edge = track.width / 2;

  const crash = DIFFICULTIES[race.difficulty].crash, ALWAYS = ALL;
  const rules = (r: Racer) => (r.isPlayer ? crash : ALWAYS);
  // wrecks still sliding are in the way; once stopped the marshals have them off the track
  const out = race.racers.filter(r => r.pitTimer <= 0 && !(r.out && r.car.speed === 0));
  stepSafetyCar(race, dt);
  for (const r of race.racers) {
    if (r.pitTimer > 0) { r.pitTimer -= dt; if (r.pitTimer <= 0) leavePits(race, r); continue; }
    if (r.out) { if (r.car.speed > 0) stepCar(r.car, IDLE, dt, 'grass'); continue; }
    if (r.pits < r.pitLaps.length && r.completed + 1 >= r.pitLaps[r.pits]) r.boxRequested = true;
    const help = DIFFICULTIES[race.difficulty].assist;
    const lapsOn = (r.total - r.tyreFrom) / track.length, life = tyreLife(r.compound, race.laps);
    r.punctured = lapsOn >= life * PUNCTURE_AT;
    r.car.grip = tyreGrip(lapsOn, life, r.compound) * race.grip * (r.isPlayer ? help.grip : 1) * (1 - 0.3 * r.damage);
    if (r.damage > 0.3 && !r.boxRequested && !r.finished) r.boxRequested = true; // come in for a new nose
    const autoPit = DIFFICULTIES[race.difficulty].pit === 'auto' && (r.inPitLane || r.boxRequested && pit.rel(r.s) > PIT.a - 300 && pit.rel(r.s) < PIT.c);
    const ctl = r.isPlayer && !r.finished && !autoPit ? assistControls(r, race, player, help) : aiControls(r, race);
    if (r.isPlayer) ctl.steer += r.damage * 0.12; // a bent wing pulls to one side
    const onTarmac = Math.abs(r.lateral) <= edge + 1 || r.inPitLane || inPitMouth(race, r.s, r.lateral);
    const spinning = r.car.spin !== 0;
    const slide = stepCar(r.car, ctl, dt, onTarmac ? 'track' : 'grass');
    // asking too much of the grass at speed spins you round; the AI now and then lose it in a corner, more in the wet
    if (!spinning && rules(r).spin && r.car.speed > 25 && !onTarmac && slide > 1.6) startSpin(r.car, ctl.steer);
    if (!spinning && !r.isPlayer && !race.safety && r.car.speed > 25 && track.curvature[r.i] > 0.008
      && random(race) < MISTAKE_RATE * (race.grip < 1 ? 4 : 1) * dt) startSpin(r.car, random(race) - 0.5);
    holdBehindSafetyCar(race, r);
    if (r.punctured) r.car.speed = Math.min(r.car.speed, 25);
    if (r.inPitLane && pit.rel(r.s) > PIT.b && pit.rel(r.s) < PIT.c && r.car.speed > PIT.limit)
      r.car.speed = Math.max(PIT.limit, r.car.speed - 30 * dt); // the limiter brakes you down to 80 km/h
  }

  // car-to-car contact: separate and bleed speed off the car behind
  const was = race.contacts.map(c => new Set(c));
  race.contacts.forEach(c => c.clear());
  for (let a = 0; a < out.length; a++)
    for (let b = a + 1; b < out.length; b++) {
      const A = out[a].car, B = out[b].car;
      let dx = B.x - A.x, dz = B.z - A.z, d = Math.hypot(dx, dz);
      if (d >= CAR_RADIUS * 2) continue;
      const ka = race.racers.indexOf(out[a]), fresh = !was[ka].has(out[b]);
      race.contacts[ka].add(out[b]);
      if (d < 1e-6) { dx = 1; dz = 0; d = 1; }
      const push = (CAR_RADIUS * 2 - d) / 2 + 0.01, nx = dx / d, nz = dz / d;
      A.x -= nx * push; A.z -= nz * push; B.x += nx * push; B.z += nz * push;
      const aBehind = Math.cos(A.heading) * nx + Math.sin(A.heading) * nz > 0;
      const [rear, front] = aBehind ? [A, B] : [B, A];
      const [R, F] = aBehind ? [out[a], out[b]] : [out[b], out[a]];
      // how fast they met, and where on the front car: tagging a rear corner spins it, the hitter breaks its wing
      // the AI race each other cleanly: their scrapes count for half
      const [vax, vaz] = velocity(A), [vbx, vbz] = velocity(B), closing = ((vax - vbx) * nx + (vaz - vbz) * nz) * (R.isPlayer || F.isPlayer ? 1 : 0.5);
      if (fresh && closing > 6 && !R.out && !F.out) {
        const sx = (aBehind ? -nx : nx), sz = (aBehind ? -nz : nz); // front car → rear car
        const side = -Math.sin(front.heading) * sx + Math.cos(front.heading) * sz;
        if ((Math.abs(side) > 0.3 && closing > 8 || closing > 30) && rules(F).spin) startSpin(front, side || 1);
        hurt(race, R, (closing - 6) / 25, rules(R));
      }
      rear.speed = Math.min(rear.speed, front.speed * 0.97);
    }

  for (const r of out) {
    const pr = project(track, r.car.x, r.car.z, r.i), rel = pit.rel(pr.s);
    // into the pit lane through its mouth; out again where it rejoins
    if (!r.inPitLane && inPitMouth(race, pr.s, pr.lateral) && pit.side * pr.lateral > edge + 1) r.inPitLane = true;
    if (r.inPitLane && (rel < PIT.a || rel > PIT.d || rel > PIT.c && pit.side * pr.lateral < edge + 1)) r.inPitLane = false;
    // the walls: track barriers, or the pit lane's own (the boxes widen it between the entry and exit lines)
    const c = pit.centre(rel), [lo, hi] = r.inPitLane
      ? [c - 3.5, rel > PIT.b && rel < PIT.c ? pit.box + 1 : c + 3.5].map(v => v * pit.side).sort((a, b) => a - b)
      : [-track.room[0][pr.i], track.room[1][pr.i]];
    if (pr.lateral < lo || pr.lateral > hi) {
      // hit the barrier: put the car back inside it and scrape along it, losing speed the harder the impact
      const p = pointAt(track, pr.s), side = Math.max(lo, Math.min(hi, pr.lateral));
      r.car.x = p.x - Math.sin(p.heading) * side; r.car.z = p.z + Math.cos(p.heading) * side;
      // the wall's direction: the pit lane's ramps angle away from the track
      const wallHeading = p.heading + (r.inPitLane ? Math.atan(pit.side * (pit.centre(rel + 1) - pit.centre(rel - 1)) / 2) : 0);
      const c = r.car, spinning = c.spin !== 0, along = Math.cos(wrapAngle((spinning ? c.slip : c.heading) - wallHeading));
      const into = Math.abs(c.speed) * Math.sqrt(Math.max(0, 1 - along * along)); // speed square into the wall
      const travel = along >= 0 ? wallHeading : wallHeading + Math.PI;
      if (spinning) c.slip = travel; else c.heading = travel;
      c.speed *= Math.abs(along) * (r.inPitLane ? 1 : 0.7); pr.lateral = side; // pit lane walls: you slide along them at the limiter
      if (into > 15 && !r.out && !r.inPitLane) {
        if (into > 18 && rules(r).spin) startSpin(c, -pr.lateral);
        hurt(race, r, (into - 15) / 15, rules(r));
      }
    }
    let ds = pr.s - r.s;
    if (ds > track.length / 2) ds -= track.length;
    if (ds < -track.length / 2) ds += track.length;
    r.total += ds; r.i = pr.i; r.s = pr.s; r.lateral = pr.lateral;

    const laps = Math.floor(r.total / track.length);
    if (laps > r.completed && !r.finished && !r.out) {
      r.completed = laps;
      r.lastLap = race.time - r.lapStart; r.lapStart = race.time;
      if (!r.bestLap || r.lastLap < r.bestLap) r.bestLap = r.lastLap;
      if (r.completed >= race.laps) { r.finished = true; r.finishTime = race.time; }
    }
    const box = boxAt(TEAMS.indexOf(r.team));
    if (r.inPitLane && r.boxRequested && !r.finished && rel >= box - 2 && rel < box + 20) enterPits(race, r);
  }
  for (const r of race.racers) if (r.out && r.car.speed === 0 && Math.abs(r.lateral) <= edge + 2) pushOff(race, r);
  if (race.player.finished || race.player.out) race.phase = 'finished';
}

/** Seeded random number in [0, 1). */
function random(race: Race) {
  race.seed = (race.seed * 1664525 + 1013904223) % 4294967296;
  return race.seed / 4294967296;
}
const velocity = (c: CarState) => { const d = c.spin ? c.slip : c.heading; return [Math.cos(d) * c.speed, Math.sin(d) * c.speed]; };

/** Front-wing damage from a hit; enough of it and the car is out (when the rules allow). */
function hurt(race: Race, r: Racer, amount: number, rules: { damage: boolean; retire: boolean }) {
  if (!rules.damage || amount <= 0) return;
  r.damage = Math.min(rules.retire ? 1 : 0.95, r.damage + amount);
  if (r.damage < 1) return;
  r.out = true; r.boxRequested = false;
  r.car.speed = Math.min(r.car.speed, 30); startSpin(r.car, r.lateral || 1);
  const leader = standings(race)[0];
  if (race.phase === 'racing' && !race.safety && !leader.finished) race.safety = { s: (leader.s + 80) % race.track.length, speed: SC_PACE, left: SC_TIME };
}

/** The marshals push a stopped wreck off the track, beside it on its nearer side. */
function pushOff(race: Race, r: Racer) {
  const t = race.track, side = r.lateral < 0 ? 0 : 1, lat = (side ? 1 : -1) * Math.min(t.width / 2 + 4, t.room[side][r.i] - 1);
  const p = pointAt(t, r.s);
  Object.assign(r.car, { x: p.x - Math.sin(p.heading) * lat, z: p.z + Math.cos(p.heading) * lat, spin: 0 });
  r.lateral = lat;
}

/** The safety car laps at a steady pace for a while, then comes in. */
function stepSafetyCar(race: Race, dt: number) {
  const sc = race.safety;
  if (!sc || race.phase !== 'racing') return;
  sc.speed = Math.min(SC_PACE, race.profile[pointAt(race.track, sc.s).i] * 0.8);
  sc.s = (sc.s + sc.speed * dt) % race.track.length;
  if ((sc.left -= dt) <= 0) race.safety = null;
}

/** Under the safety car nobody may close up faster than the queue ahead is going: it bunches the field. */
function holdBehindSafetyCar(race: Race, r: Racer) {
  const sc = race.safety;
  if (!sc || r.inPitLane || r.car.spin) return;
  const L = race.track.length, ahead = (s: number) => ((s - r.s) % L + L) % L;
  let gap = ahead(sc.s), speed = sc.speed;
  for (const o of race.racers) {
    if (o === r || o.out || o.inPitLane || o.pitTimer > 0) continue;
    const g = ahead(o.s);
    if (g > 0 && g < gap) { gap = g; speed = o.car.speed; }
  }
  if (gap < 40) r.car.speed = Math.min(r.car.speed, Math.max(0, speed) + Math.max(0, gap - 10) * 0.5);
}

/** Is lateral offset `lat` at `s` inside the pit lane's mouth, where it peels off the track? */
function inPitMouth(race: Race, s: number, lat: number) {
  const { pit } = race, rel = pit.rel(s);
  return rel >= PIT.a && rel <= PIT.b && Math.abs(pit.side * lat - pit.centre(rel)) < 3.5;
}

/** On the marks in the box: stationary while the crew change the tyres. */
function enterPits(race: Race, r: Racer) {
  const box = pitBox(race.track, TEAMS.indexOf(r.team), race.pitSide);
  r.boxRequested = false;
  r.stopTime = 2 + ((r.number * 13 + r.pits * 7) % 12) / 10 + (r.damage > 0.05 ? 3.5 : 0); // 2.0–3.1 s, varies by car and stop; a new nose takes longer
  r.pitTimer = r.stopTime;
  Object.assign(r.car, { x: box.x, z: box.z, heading: box.heading, speed: 0, steer: 0 });
  r.lateral = race.pitSide * race.pit.box;
}

function leavePits(_race: Race, r: Racer) {
  r.pitTimer = 0; r.pits++; r.tyreFrom = r.total;
  r.compound = r.nextCompound; r.punctured = false; r.damage = 0;
  if (!r.isPlayer) r.nextCompound = r.compound === 2 ? 1 : 2;
}

/** Finishers by finish time, then everyone else by distance covered, and anyone crashed out last. */
export const standings = (race: Race) => [...race.racers].sort((a, b) => a.out !== b.out ? Number(a.out) - Number(b.out) :
  a.finished && b.finished ? a.finishTime - b.finishTime : a.finished ? -1 : b.finished ? 1 : b.total - a.total);
