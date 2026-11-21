import { describe, it, expect } from 'vitest';
import { buildTrack, pointAt } from '../../src/track';
import { CIRCUITS } from '../../src/circuits';
import { createRace, stepRace, standings } from '../../src/race';
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

  it('pushes overlapping cars apart', () => {
    const race = createRace(track, { laps: 3, countdown: 0, player: 'VER', size: 2 });
    const [a, b] = race.racers;
    b.car.x = a.car.x + 0.5; b.car.z = a.car.z;
    stepRace(race, 1 / 60, idle);
    expect(Math.hypot(a.car.x - b.car.x, a.car.z - b.car.z)).toBeGreaterThan(3);
  });
});
