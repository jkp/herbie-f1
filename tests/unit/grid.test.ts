import { describe, it, expect } from 'vitest';
import { TEAMS, DRIVERS } from '../../src/grid';

describe('2022 grid', () => {
  it('has 10 teams with 2 drivers each', () => {
    expect(TEAMS).toHaveLength(10);
    for (const t of TEAMS) expect(t.drivers).toHaveLength(2);
    expect(DRIVERS).toHaveLength(20);
  });

  it('has unique driver codes and numbers', () => {
    expect(new Set(DRIVERS.map(d => d.code)).size).toBe(20);
    expect(new Set(DRIVERS.map(d => d.number)).size).toBe(20);
  });

  it('includes the 2022 champion in the Red Bull', () => {
    const ver = DRIVERS.find(d => d.code === 'VER')!;
    expect(ver.team.name).toBe('Red Bull Racing');
    expect(ver.number).toBe(1);
  });

  it('rates the Red Bull as the quickest car and the Williams as the slowest', () => {
    const pace = TEAMS.map(t => t.pace);
    expect(TEAMS.find(t => t.name === 'Red Bull Racing')!.pace).toBe(Math.max(...pace));
    expect(TEAMS.find(t => t.name === 'Williams')!.pace).toBe(Math.min(...pace));
  });
});
