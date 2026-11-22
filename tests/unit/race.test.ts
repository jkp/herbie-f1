import { describe, it, expect } from 'vitest';
import { buildTrack, pointAt } from '../../src/track';
import { CIRCUITS } from '../../src/circuits';
import { createRace, stepRace, standings, DIFFICULTIES, tyreGrip, tyreLife, COMPOUNDS, PUNCTURE_AT, pitPlan, PIT, type Race } from '../../src/race';
import { DRIVERS } from '../../src/grid';

const track = buildTrack(CIRCUITS[0]);
const idle = { throttle: 0, brake: 0, steer: 0 };
/** Put the player at distance `s`, `lat` metres right of the centreline, pointing along the track. */
function place(race: Race, s: number, lat: number) {
  const pt = pointAt(race.track, s), c = race.player.car;
  c.x = pt.x - Math.sin(pt.heading) * lat; c.z = pt.z + Math.cos(pt.heading) * lat; c.heading = pt.heading;
}
/** Drive the player along a line (`lat(s)` right of the centreline) from `from` to `to`, 5 m per 0.1 s step. */
function drive(race: Race, from: number, to: number, lat: (s: number) => number, until = (_: Race['player']) => false) {
  for (let s = from; s <= to; s += 5) {
    place(race, s, race.pit.side * lat(s)); stepRace(race, 0.1, idle);
    if (until(race.player)) return;
  }
}

describe('race', () => {
  it('lines up all 20 drivers on a grid behind the line with a countdown', () => {
    const race = createRace(track, { laps: 3, countdown: 3, player: 'HAM' });
    expect(race.racers).toHaveLength(20);
    expect(race.phase).toBe('countdown');
    for (const r of race.racers) expect(r.total).toBeLessThan(0);
    expect(new Set(race.racers.map(r => `${r.car.x.toFixed(1)},${r.car.z.toFixed(1)}`)).size).toBe(20);
  });

  it('puts the player in the chosen driver\'s seat, once', () => {
    const race = createRace(track, { laps: 3, countdown: 3, player: 'NOR' });
    expect(race.player.isPlayer).toBe(true);
    expect(race.player.code).toBe('NOR');
    expect(race.player.team.name).toBe('McLaren');
    expect(race.racers.filter(r => r.code === 'NOR')).toHaveLength(1);
    expect(race.racers.filter(r => r.isPlayer)).toHaveLength(1);
    expect(new Set(race.racers.map(r => r.code))).toEqual(new Set(DRIVERS.map(d => d.code)));
  });

  it('orders the grid fastest first, so a Red Bull starts ahead of a Williams', () => {
    const race = createRace(track, { laps: 3, countdown: 3, player: 'LAT' });
    expect(race.racers[0].code).toBe('VER');
    expect(race.racers.at(-1)!.team.name).toBe('Williams');
    expect(race.racers[0].total).toBeGreaterThan(race.racers.at(-1)!.total);
  });

  it('gives the player the power of their team\'s car', () => {
    const rb = createRace(track, { laps: 3, countdown: 0, player: 'VER' }).player;
    const wil = createRace(track, { laps: 3, countdown: 0, player: 'ALB' }).player;
    expect(rb.car.power).toBeGreaterThan(wil.car.power);
  });

  it('has six difficulties from Beginner to Legendary, each with quicker AI than the last', () => {
    expect(DIFFICULTIES.map(d => d.name)).toEqual(['Beginner', 'Amateur', 'Semi-Pro', 'Pro', 'World Class', 'Legendary']);
    const verSkill = (difficulty: number) => createRace(track, { laps: 3, countdown: 0, player: 'LAT', difficulty }).racers.find(r => r.code === 'VER')!.skill;
    for (let d = 1; d < DIFFICULTIES.length; d++) expect(verSkill(d)).toBeGreaterThan(verSkill(d - 1));
  });

  it('seats a career rookie in place of a team\'s second driver', () => {
    const race = createRace(track, { laps: 3, countdown: 0, player: 'HER', rookie: { name: 'Herbie Rocket', code: 'HER', number: 17, replaces: 'LAT' } });
    expect(race.racers).toHaveLength(20);
    expect(race.player).toMatchObject({ code: 'HER', name: 'Herbie Rocket', number: 17 });
    expect(race.player.team.name).toBe('Williams');
    expect(race.racers.some(r => r.code === 'LAT')).toBe(false);
  });

  it('can run a smaller field', () => {
    expect(createRace(track, { laps: 3, countdown: 0, player: 'VER', size: 4 }).racers).toHaveLength(4);
  });

  it('freezes cars during the countdown then goes racing', () => {
    const race = createRace(track, { laps: 3, countdown: 1, player: 'VER', size: 3 });
    const x0 = race.racers[0].car.x;
    stepRace(race, 0.5, { throttle: 1, brake: 0, steer: 0 });
    expect(race.racers[0].car.x).toBe(x0);
    for (let i = 0; i < 120; i++) stepRace(race, 1 / 60, { throttle: 1, brake: 0, steer: 0 });
    expect(race.phase).toBe('racing');
    expect(race.player.car.speed).toBeGreaterThan(0);
  });

  it('counts a lap and records the lap time when the player crosses the line', () => {
    const race = createRace(track, { laps: 2, countdown: 0, player: 'VER', size: 1 });
    const p = race.player;
    for (let s = -20; s <= track.length + 5; s += 5) {
      const pt = pointAt(track, s);
      p.car.x = pt.x; p.car.z = pt.z; p.car.heading = pt.heading;
      stepRace(race, 0.1, idle);
    }
    expect(p.completed).toBe(1);
    expect(p.lastLap).toBeGreaterThan(0);
    expect(p.bestLap).toBe(p.lastLap);
  });

  it('does not count a lap for reversing back and forth over the line', () => {
    const race = createRace(track, { laps: 2, countdown: 0, player: 'VER', size: 1 });
    const p = race.player;
    for (const s of [-10, 5, -10, 5, -10, 5]) {
      const pt = pointAt(track, s);
      p.car.x = pt.x; p.car.z = pt.z;
      stepRace(race, 0.1, idle);
    }
    expect(p.completed).toBe(0);
  });

  it('orders standings by distance covered', () => {
    const race = createRace(track, { laps: 3, countdown: 0, player: 'VER', size: 4 });
    race.racers[2].total = 500;
    expect(standings(race)[0]).toBe(race.racers[2]);
  });

  it('stops cars at the barriers', () => {
    const race = createRace(track, { laps: 3, countdown: 0, player: 'VER', size: 1 });
    const p = race.player;
    const pt = pointAt(track, 300);
    p.car.x = pt.x - Math.sin(pt.heading) * 200; p.car.z = pt.z + Math.cos(pt.heading) * 200;
    stepRace(race, 1 / 60, idle);
    expect(Math.abs(p.lateral)).toBeLessThanOrEqual(track.width / 2 + track.runoff + 0.01);
  });

  it('scrapes along the barrier on a glancing hit instead of sticking to it', () => {
    const race = createRace(track, { laps: 3, countdown: 0, player: 'VER', size: 1 });
    const p = race.player, pt = pointAt(track, 300), off = track.width / 2 + track.runoff + 0.5;
    p.i = pt.i; p.s = 300;
    p.car.x = pt.x - Math.sin(pt.heading) * off; p.car.z = pt.z + Math.cos(pt.heading) * off;
    p.car.heading = pt.heading + 0.2; p.car.speed = 50; // angled into the right-hand wall
    stepRace(race, 1 / 120, idle);
    expect(p.car.speed).toBeGreaterThan(30);
    expect(Math.abs(p.car.heading - pt.heading)).toBeLessThan(0.05);
  });

  it('makes every car stop once in short races, twice from 10 laps and three times from 20, spread through the race', () => {
    expect(pitPlan(3)).toEqual([2]);
    expect(pitPlan(5)).toEqual([3]);
    expect(pitPlan(10)).toEqual([3, 7]);
    expect(pitPlan(15)).toEqual([5, 10]);
    expect(pitPlan(20)).toEqual([5, 10, 15]);
    expect(pitPlan(30)).toEqual([8, 15, 23]);
    expect(pitPlan(2)).toEqual([]);
  });

  it('gives every car, player included, the same number of compulsory stops', () => {
    const race = createRace(track, { laps: 15, countdown: 0, player: 'VER' });
    for (const r of race.racers) {
      expect(r.pitLaps, r.code).toHaveLength(2);
      for (const lap of r.pitLaps) { expect(lap).toBeGreaterThanOrEqual(1); expect(lap).toBeLessThan(15); }
      expect(r.pitLaps[1]).toBeGreaterThan(r.pitLaps[0]);
    }
    expect(race.player.pitLaps).toEqual(pitPlan(15));
  });

  it('calls the player in on their pit lap', () => {
    const race = createRace(track, { laps: 3, countdown: 0, player: 'VER', size: 1 });
    const p = race.player;
    for (let s = -20; s <= track.length + 50; s += 5) { place(race, s, 0); stepRace(race, 0.1, idle); }
    expect(p.completed).toBe(1);
    expect(p.boxRequested).toBe(true);
  });

  it('has soft, medium and hard tyres: softs grip most and wear out first', () => {
    expect(COMPOUNDS.map(c => c.name)).toEqual(['Soft', 'Medium', 'Hard']);
    const [soft, med, hard] = [0, 1, 2].map(c => tyreLife(c, 15));
    expect(soft).toBeLessThan(med); expect(med).toBeLessThan(hard);
    expect(med).toBeGreaterThan(15 / 3); // a medium lasts a planned stint
    expect(tyreGrip(0, soft, 0)).toBeGreaterThan(tyreGrip(0, med, 1));
    expect(tyreGrip(0, med, 1)).toBeGreaterThan(tyreGrip(0, hard, 2));
  });

  it('wears tyres gently through their life, then they fall off a cliff', () => {
    const life = tyreLife(1, 15);
    expect(tyreGrip(0, life, 1)).toBe(1);
    expect(tyreGrip(life * 0.5, life, 1)).toBeLessThan(1);
    expect(tyreGrip(life, life, 1)).toBeGreaterThan(0.93);
    expect(tyreGrip(life * 1.4, life, 1)).toBeLessThan(0.8);
  });

  it('stay out too long and a tyre punctures: the car crawls until it pits', () => {
    const race = createRace(track, { laps: 15, countdown: 0, player: 'VER', size: 1 });
    const p = race.player;
    p.tyreFrom = p.total - track.length * tyreLife(p.compound, 15) * (PUNCTURE_AT + 0.05);
    place(race, 300, 0); p.car.speed = 80;
    for (let t = 0; t < 3; t += 1 / 120) stepRace(race, 1 / 120, { throttle: 1, brake: 0, steer: 0 });
    expect(p.punctured).toBe(true);
    expect(p.car.speed).toBeLessThan(26);
  });

  it('starts the player on the tyre they chose and the AI on mediums', () => {
    const race = createRace(track, { laps: 15, countdown: 0, player: 'VER', tyre: 0 });
    expect(race.player.compound).toBe(0);
    for (const r of race.racers.filter(r => !r.isPlayer)) expect(r.compound).toBe(1);
  });

  it('has a pit lane alongside the start straight, beyond the barrier, joining the track at each end', () => {
    const race = createRace(track, { laps: 5, countdown: 0, player: 'VER', size: 1 });
    const { centre, fast } = race.pit, edge = track.width / 2;
    expect(fast).toBeGreaterThan(edge + track.runoff + 2);
    expect(centre(PIT.a)).toBeLessThan(edge);
    expect(centre((PIT.b + PIT.c) / 2)).toBe(fast);
    expect(centre(PIT.d)).toBeLessThan(edge);
  });

  it('drive into the pit lane on your pit lap: the limiter holds 80 km/h, you stop at your box, then leave on new tyres', () => {
    const race = createRace(track, { laps: 5, countdown: 0, player: 'VER', size: 1 });
    const p = race.player;
    drive(race, -20, track.length - 700, () => 0);
    expect(p.car.grip).toBeLessThan(1);
    p.boxRequested = true; p.nextCompound = 2;
    // follow the pit lane from before the entry
    drive(race, track.length - 700, track.length - 20, s => race.pit.centre(s - track.length), r => r.pitTimer > 0);
    expect(p.inPitLane).toBe(true);
    expect(p.pitTimer).toBeGreaterThan(0);
    expect(p.boxRequested).toBe(false);
    expect(Math.abs(p.lateral)).toBeGreaterThan(race.pit.fast); // in the box
    expect(p.completed).toBe(0);
    for (let t = 0; t < 4; t += 0.1) stepRace(race, 0.1, idle);
    expect(p.pitTimer).toBe(0);
    expect(p.pits).toBe(1);
    expect(p.compound).toBe(2);
    expect(p.car.grip).toBeGreaterThan(0.95);
    p.car.speed = 60;
    stepRace(race, 1 / 120, { throttle: 1, brake: 0, steer: 0 });
    for (let t = 0; t < 2; t += 1 / 120) stepRace(race, 1 / 120, { throttle: 1, brake: 0, steer: 0 });
    expect(p.car.speed).toBeLessThan(PIT.limit + 0.5);
  });

  it('miss the pit entry and you stay out: no stop this lap, the call stands for the next', () => {
    const race = createRace(track, { laps: 5, countdown: 0, player: 'VER', size: 1 });
    const p = race.player;
    drive(race, -20, track.length - 700, () => 0);
    p.boxRequested = true;
    drive(race, track.length - 700, track.length + 300, () => 0);
    expect(p.inPitLane).toBe(false);
    expect(p.pits).toBe(0);
    expect(p.completed).toBe(1);
    expect(p.boxRequested).toBe(true);
  });

  it('the pit wall keeps cars on the track out of the pit lane, and cars in the lane off the track', () => {
    const race = createRace(track, { laps: 5, countdown: 0, player: 'VER', size: 1 });
    const p = race.player, side = race.pit.side, mid = track.length - 120;
    place(race, mid, side * (race.pit.fast)); stepRace(race, 1 / 120, idle);
    expect(p.inPitLane).toBe(false);
    expect(Math.abs(p.lateral)).toBeLessThanOrEqual(track.width / 2 + track.runoff + 0.01);
    drive(race, track.length - 700, mid, s => race.pit.centre(s - track.length));
    expect(p.inPitLane).toBe(true);
    place(race, mid + 5, 0); stepRace(race, 1 / 120, idle);
    expect(Math.abs(p.lateral)).toBeGreaterThan(track.width / 2 + track.runoff);
  });

  it('pushes overlapping cars apart', () => {
    const race = createRace(track, { laps: 3, countdown: 0, player: 'VER', size: 2 });
    const [a, b] = race.racers;
    b.car.x = a.car.x + 0.5; b.car.z = a.car.z;
    stepRace(race, 1 / 60, idle);
    expect(Math.hypot(a.car.x - b.car.x, a.car.z - b.car.z)).toBeGreaterThan(3);
  });
});
