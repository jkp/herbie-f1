import { describe, it, expect } from 'vitest';
import { TIMES, WEATHER } from '../../src/conditions';
import { buildTrack, pointAt } from '../../src/track';
import { CIRCUITS } from '../../src/circuits';
import { createRace, stepRace } from '../../src/race';

const track = buildTrack(CIRCUITS[0]);

describe('race conditions', () => {
  it('offers morning to night, and sunny, cloudy or rain', () => {
    expect(TIMES.map(t => t.name)).toEqual(['Morning', 'Afternoon', 'Sunset', 'Night']);
    expect(WEATHER.map(w => w.name)).toEqual(['Sunny', 'Cloudy', 'Rain']);
  });

  it('puts the sun high in the afternoon, low at sunset and below the horizon at night', () => {
    const el = Object.fromEntries(TIMES.map(t => [t.name, t.sun]));
    expect(el.Afternoon).toBeGreaterThan(el.Morning);
    expect(el.Sunset).toBeLessThan(10);
    expect(el.Night).toBeLessThan(0);
  });

  it('rain makes the track slippery for everyone', () => {
    const grip = (weather: number) => {
      const race = createRace(track, { laps: 3, countdown: 0, player: 'VER', weather });
      const pt = pointAt(track, 100);
      Object.assign(race.player.car, { x: pt.x, z: pt.z, heading: pt.heading });
      stepRace(race, 1 / 120, { throttle: 0, brake: 0, steer: 0 });
      return { me: race.player.car.grip, ai: race.racers.find(r => !r.isPlayer)!.car.grip };
    };
    const dry = grip(0), wet = grip(2);
    expect(wet.me).toBeLessThan(dry.me * 0.85);
    expect(wet.ai).toBeLessThan(dry.ai * 0.85);
    expect(grip(1).me).toBe(dry.me); // clouds don't change grip
  });
});
