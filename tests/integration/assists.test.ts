import { describe, it, expect } from 'vitest';
import { buildTrack } from '../../src/track';
import { CIRCUITS } from '../../src/circuits';
import { createRace, stepRace, DIFFICULTIES } from '../../src/race';

const track = buildTrack(CIRCUITS.find(c => c.id === 'silverstone')!);

// A small child's driving: throttle flat out, never touching brake or steering.
function flatOut(difficulty: number, seconds: number) {
  const race = createRace(track, { laps: 1, countdown: 0, player: 'VER', size: 1, difficulty });
  let worst = 0;
  for (let t = 0; t < seconds && !race.player.finished; t += 1 / 120) {
    stepRace(race, 1 / 120, { throttle: 1, brake: 0, steer: 0 });
    worst = Math.max(worst, Math.abs(race.player.lateral));
  }
  return { race, worst };
}

describe('driving help on the easy difficulties', () => {
  it('Beginner and Amateur get brake and steering help and extra grip; Semi-Pro brake help only; Pro and up none', () => {
    const a = DIFFICULTIES.map(d => d.assist);
    expect(a[0]).toMatchObject({ brake: true, steer: true });
    expect(a[0].grip).toBeGreaterThan(a[1].grip);
    expect(a[1]).toMatchObject({ brake: true, steer: true });
    expect(a[1].grip).toBeGreaterThan(1);
    expect(a[2]).toMatchObject({ brake: true, steer: false, grip: 1 });
    for (const d of a.slice(3)) expect(d).toEqual({ brake: false, steer: false, grip: 1 });
  });

  it('on Beginner, holding only the throttle gets you round a whole lap on the tarmac', () => {
    const { race, worst } = flatOut(0, 200);
    expect(race.player.finished).toBe(true);
    expect(worst).toBeLessThan(track.width / 2 + 1);
  }, 30_000);

  it('on Pro the same driving goes straight off at the first corner', () => {
    const { worst } = flatOut(3, 30);
    expect(worst).toBeGreaterThan(track.width / 2 + 5);
  });

  it('steering help still lets you steer: you can move across the track to overtake', () => {
    const race = createRace(track, { laps: 1, countdown: 0, player: 'VER', size: 1, difficulty: 0 });
    for (let t = 0; t < 4; t += 1 / 120) stepRace(race, 1 / 120, { throttle: 1, brake: 0, steer: 0 });
    const before = race.player.lateral;
    for (let t = 0; t < 1.5; t += 1 / 120) stepRace(race, 1 / 120, { throttle: 1, brake: 0, steer: -1 });
    expect(race.player.lateral).toBeLessThan(before - 2);
  });

  it('makes the AI much slower on Beginner than on Pro', () => {
    expect(DIFFICULTIES[0].pace).toBeLessThan(DIFFICULTIES[3].pace - 0.1);
  });
});
