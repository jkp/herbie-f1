import { describe, it, expect } from 'vitest';
import { buildTrack, pointAt } from '../../src/track';
import { SILVERSTONE } from '../../src/silverstone';
import { createRace, stepRace, standings } from '../../src/race';

const track = buildTrack(SILVERSTONE);
const idle = { throttle: 0, brake: 0, steer: 0 };

describe('race', () => {
  it('starts with a grid behind the line and a countdown', () => {
    const race = createRace(track, { laps: 3, opponents: 5, countdown: 3 });
    expect(race.racers).toHaveLength(6);
    expect(race.phase).toBe('countdown');
    for (const r of race.racers) expect(r.total).toBeLessThan(0);
    expect(new Set(race.racers.map(r => `${r.car.x.toFixed(1)},${r.car.z.toFixed(1)}`)).size).toBe(6);
  });

  it('freezes cars during the countdown then goes racing', () => {
    const race = createRace(track, { laps: 3, opponents: 2, countdown: 1 });
    const x0 = race.racers[0].car.x;
    stepRace(race, 0.5, { throttle: 1, brake: 0, steer: 0 });
    expect(race.racers[0].car.x).toBe(x0);
    for (let i = 0; i < 120; i++) stepRace(race, 1 / 60, { throttle: 1, brake: 0, steer: 0 });
    expect(race.phase).toBe('racing');
    expect(race.player.car.speed).toBeGreaterThan(0);
  });

  it('counts a lap and records the lap time when the player crosses the line', () => {
    const race = createRace(track, { laps: 2, opponents: 0, countdown: 0 });
    const p = race.player;
    // teleport the player around the lap in small hops
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
    const race = createRace(track, { laps: 2, opponents: 0, countdown: 0 });
    const p = race.player;
    for (const s of [-10, 5, -10, 5, -10, 5]) {
      const pt = pointAt(track, s);
      p.car.x = pt.x; p.car.z = pt.z;
      stepRace(race, 0.1, idle);
    }
    expect(p.completed).toBe(0);
  });

  it('orders standings by distance covered', () => {
    const race = createRace(track, { laps: 3, opponents: 3, countdown: 0 });
    race.racers[2].total = 500;
    expect(standings(race)[0]).toBe(race.racers[2]);
  });

  it('stops cars at the barriers', () => {
    const race = createRace(track, { laps: 3, opponents: 0, countdown: 0 });
    const p = race.player;
    const pt = pointAt(track, 300);
    p.car.x = pt.x - Math.sin(pt.heading) * 200; p.car.z = pt.z + Math.cos(pt.heading) * 200;
    stepRace(race, 1 / 60, idle);
    expect(Math.abs(p.lateral)).toBeLessThanOrEqual(track.width / 2 + race.runoff + 0.01);
  });

  it('pushes overlapping cars apart', () => {
    const race = createRace(track, { laps: 3, opponents: 1, countdown: 0 });
    const [a, b] = race.racers;
    b.car.x = a.car.x + 0.5; b.car.z = a.car.z;
    stepRace(race, 1 / 60, idle);
    expect(Math.hypot(a.car.x - b.car.x, a.car.z - b.car.z)).toBeGreaterThan(3);
  });
});
