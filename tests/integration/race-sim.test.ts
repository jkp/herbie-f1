import { describe, it, expect } from 'vitest';
import { buildTrack } from '../../src/track';
import { CIRCUITS } from '../../src/circuits';
import { createRace, stepRace } from '../../src/race';
import { aiControls } from '../../src/ai';

// The whole 20-car field, player included, driven by the AI.
describe.each(CIRCUITS)('full race at $name', def => {
  it('every car finishes 2 laps at a sane pace and stays on the circuit', () => {
    const track = buildTrack(def);
    const race = createRace(track, { laps: 2, countdown: 0, player: 'VER' });
    const dt = 1 / 120;
    let offTrack = 0, samples = 0;
    while (race.racers.some(r => !r.finished) && race.time < 600) {
      stepRace(race, dt, aiControls(race.player, race));
      for (const r of race.racers) { samples++; if (Math.abs(r.lateral) > track.width / 2 + 1) offTrack++; }
    }
    for (const r of race.racers) {
      expect(r.finished, r.code).toBe(true);
      const avgKmh = track.length / r.bestLap * 3.6;
      expect(avgKmh, r.code).toBeGreaterThan(80); // Monaco traffic is slow: there's no overtaking yet
      expect(avgKmh, r.code).toBeLessThan(260);
    }
    expect(offTrack / samples).toBeLessThan(0.03);
  }, 60_000);
});

describe('strategy', () => {
  it.each([[3, 1], [10, 2]])('in a %i-lap race every car, player included, makes %i compulsory stop(s) and finishes', (laps, stops) => {
    const track = buildTrack(CIRCUITS.find(c => c.id === 'redbullring')!);
    const race = createRace(track, { laps, countdown: 0, player: 'VER' });
    const used = new Set<string>();
    while (race.racers.some(r => !r.finished) && race.time < 2400) {
      stepRace(race, 1 / 120, aiControls(race.player, race));
      for (const r of race.racers) if (r.inPitLane) used.add(r.code);
    }
    expect(used.size).toBe(20); // everyone drove through the pit lane
    for (const r of race.racers) {
      expect(r.finished, r.code).toBe(true);
      expect(r.pits, r.code).toBe(stops);
    }
  }, 120_000);
});
