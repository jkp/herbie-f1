import { describe, it, expect } from 'vitest';
import { buildTrack, pointAt } from '../../src/track';
import { CIRCUITS } from '../../src/circuits';
import { createRace, stepRace, standings, DIFFICULTIES, PIT_TIME, tyreGrip } from '../../src/race';
import { DRIVERS } from '../../src/grid';

const track = buildTrack(CIRCUITS[0]);
const idle = { throttle: 0, brake: 0, steer: 0 };

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

  it('wears tyres over the race, faster in short races', () => {
    expect(tyreGrip(0, 15)).toBe(1);
    expect(tyreGrip(4, 15)).toBeLessThan(1);
    expect(tyreGrip(10, 15)).toBeLessThan(tyreGrip(4, 15));
    expect(tyreGrip(2, 3)).toBeGreaterThan(0.9); // a 3-lap sprint never needs a stop
    expect(tyreGrip(100, 15)).toBeGreaterThan(0.7); // worn, not undriveable
  });

  it('boxes the player at the end of the lap: in the pits for PIT_TIME, then back out on fresh tyres', () => {
    const race = createRace(track, { laps: 5, countdown: 0, player: 'VER', size: 1 });
    const p = race.player;
    const drive = (from: number, to: number) => {
      for (let s = from; s <= to; s += 5) {
        const pt = pointAt(track, s);
        p.car.x = pt.x; p.car.z = pt.z; p.car.heading = pt.heading;
        stepRace(race, 0.1, idle);
      }
    };
    drive(-20, track.length - 50);
    expect(p.car.grip).toBeLessThan(1);
    p.boxRequested = true;
    drive(track.length - 45, track.length + 2);
    expect(p.completed).toBe(1);
    expect(p.pitTimer).toBeGreaterThan(0);
    expect(p.boxRequested).toBe(false);
    expect(Math.abs(p.lateral)).toBeGreaterThan(track.width / 2 + track.runoff); // parked in the garage
    const totalInPit = p.total;
    for (let t = 0; t < PIT_TIME + 0.5; t += 0.1) stepRace(race, 0.1, { throttle: 1, brake: 0, steer: 0 });
    expect(p.pitTimer).toBe(0);
    expect(p.pits).toBe(1);
    expect(p.car.grip).toBeGreaterThan(0.999);
    expect(Math.abs(p.lateral)).toBeLessThan(track.width / 2);
    expect(p.total).toBeGreaterThan(totalInPit);
    expect(p.total).toBeLessThan(track.length + 120);
    expect(p.completed).toBe(1);
  });

  it('pushes overlapping cars apart', () => {
    const race = createRace(track, { laps: 3, countdown: 0, player: 'VER', size: 2 });
    const [a, b] = race.racers;
    b.car.x = a.car.x + 0.5; b.car.z = a.car.z;
    stepRace(race, 1 / 60, idle);
    expect(Math.hypot(a.car.x - b.car.x, a.car.z - b.car.z)).toBeGreaterThan(3);
  });
});
