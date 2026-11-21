import { describe, it, expect } from 'vitest';
import { buildTrack } from '../../src/track';
import { SILVERSTONE } from '../../src/silverstone';
import { createRace, stepRace } from '../../src/race';
import { aiControls } from '../../src/ai';

// The whole field, player included, driven by the AI for a full race.
describe('full race simulation', () => {
  it('every car finishes 3 laps at Silverstone with sane lap times and stays on the circuit', () => {
    const track = buildTrack(SILVERSTONE);
    const race = createRace(track, { laps: 3, opponents: 5, countdown: 0 });
    const dt = 1 / 120;
    let offTrack = 0, samples = 0;
    while (race.racers.some(r => !r.finished) && race.time < 600) {
      stepRace(race, dt, aiControls(race.player, race, 1));
      for (const r of race.racers) { samples++; if (Math.abs(r.lateral) > track.width / 2 + 1) offTrack++; }
    }
    for (const r of race.racers) {
      expect(r.finished, r.name).toBe(true);
      expect(r.bestLap).toBeGreaterThan(75);
      expect(r.bestLap).toBeLessThan(120);
    }
    expect(offTrack / samples).toBeLessThan(0.02);
  });
});
