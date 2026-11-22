import { describe, it, expect } from 'vitest';
import { CIRCUITS } from '../../src/circuits';
import { SPECIES, speciesMix } from '../../src/trees';

describe('which trees grow at each circuit', () => {
  it.each(CIRCUITS.map(c => c.name))('%s has a mix of known species that adds up', name => {
    const mix = speciesMix(name);
    expect(Object.keys(mix).every(s => (SPECIES as readonly string[]).includes(s))).toBe(true);
    expect(Object.values(mix).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 5);
  });

  it('puts spruce in the Ardennes and the Styrian hills', () => {
    expect(speciesMix('Spa-Francorchamps').spruce).toBeGreaterThan(0.5);
    expect(speciesMix('Red Bull Ring').spruce).toBeGreaterThan(0.5);
  });

  it('puts palms in the Gulf, and no spruce on the Mediterranean or in the desert', () => {
    for (const n of ['Bahrain', 'Yas Marina']) expect(speciesMix(n).palm).toBeGreaterThan(0.8);
    for (const n of ['Monaco', 'Barcelona', 'Bahrain', 'Yas Marina']) expect(speciesMix(n).spruce ?? 0).toBe(0);
  });

  it('gives Monza its royal park of broadleaf trees', () => {
    expect(speciesMix('Monza').broadleaf).toBeGreaterThan(0.5);
  });
});
