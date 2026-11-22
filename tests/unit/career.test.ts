import { describe, it, expect } from 'vitest';
import { CALENDAR, POINTS, newCareer, deriveCode, numberProblem, recordRace, championship, seasonOver, offers, nextSeason, rookieOf } from '../../src/career';
import { DRIVERS } from '../../src/grid';

const fresh = () => newCareer({ name: 'Herbie Rocket', number: 17, team: 'Williams', difficulty: 2, laps: 5 });
const finishOrder = (c: ReturnType<typeof fresh>, playerPos: number) => {
  const others = DRIVERS.filter(d => d.code !== 'LAT').map(d => d.code); // LAT gives up the Williams seat
  others.splice(playerPos - 1, 0, c.code);
  return others;
};

describe('career', () => {
  it('starts a 17-year-old rookie at round 1 of season 1', () => {
    const c = fresh();
    expect(c).toMatchObject({ name: 'Herbie Rocket', number: 17, team: 'Williams', age: 17, season: 1, round: 0, difficulty: 2, laps: 5 });
    expect(c.code).toBe('HER');
  });

  it('runs a season over the 2022-style calendar of every circuit, Bahrain first and Abu Dhabi last', () => {
    expect(CALENDAR).toHaveLength(11);
    expect(CALENDAR[0].id).toBe('bahrain');
    expect(CALENDAR.at(-1)!.id).toBe('yasmarina');
  });

  it('makes a three-letter code that no 2022 driver uses', () => {
    expect(deriveCode('Max Power')).toBe('MAX');
    const ver = deriveCode('Verstappen');
    expect(ver).toMatch(/^[A-Z]{3}$/);
    expect(DRIVERS.map(d => d.code)).not.toContain(ver);
    expect(deriveCode('!!')).toMatch(/^[A-Z]{3}$/);
  });

  it('only accepts free race numbers 2–99', () => {
    expect(numberProblem(17)).toBeNull();
    expect(numberProblem(44)).toMatch(/Lewis Hamilton/);
    expect(numberProblem(0)).not.toBeNull();
    expect(numberProblem(100)).not.toBeNull();
    expect(numberProblem(2.5)).not.toBeNull();
  });

  it('puts the rookie in the second seat of their team', () => {
    expect(rookieOf(fresh())).toEqual({ name: 'Herbie Rocket', code: 'HER', number: 17, replaces: 'LAT' });
  });

  it('scores F1 points and moves to the next round', () => {
    const c = fresh();
    recordRace(c, finishOrder(c, 1));
    expect(c.points.HER).toBe(25);
    expect(c.finishes).toEqual([1]);
    expect(c.round).toBe(1);
    recordRace(c, finishOrder(c, 11));
    expect(c.points.HER).toBe(25);
    expect(c.points.VER).toBeGreaterThan(0);
  });

  it('ranks the championship by points, with the rookie in and the dropped driver out', () => {
    const c = fresh();
    recordRace(c, finishOrder(c, 2));
    const table = championship(c);
    expect(table).toHaveLength(20);
    expect(table.map(e => e.code)).toContain('HER');
    expect(table.map(e => e.code)).not.toContain('LAT');
    expect(table[1]).toMatchObject({ code: 'HER', points: 18, team: 'Williams' });
  });

  it('ends the season after the last round', () => {
    const c = fresh();
    for (let k = 0; k < CALENDAR.length; k++) { expect(seasonOver(c)).toBe(false); recordRace(c, finishOrder(c, 10)); }
    expect(seasonOver(c)).toBe(true);
  });

  it('gets offers from the top teams after a great season, and only small teams after a poor one', () => {
    const star = fresh(), slow = fresh();
    for (let k = 0; k < CALENDAR.length; k++) { recordRace(star, finishOrder(star, 1)); recordRace(slow, finishOrder(slow, 18)); }
    expect(offers(star)).toEqual(expect.arrayContaining(['Red Bull Racing', 'Ferrari', 'Mercedes', 'McLaren']));
    expect(offers(star)).not.toContain('Williams'); // already there
    expect(offers(slow)).not.toContain('Ferrari');
    expect(offers(slow)).not.toContain('Mercedes');
  });

  it('starts the next season a year older, in the chosen team, with the season archived', () => {
    const c = fresh();
    for (let k = 0; k < CALENDAR.length; k++) recordRace(c, finishOrder(c, 3));
    nextSeason(c, 'Ferrari');
    expect(c).toMatchObject({ age: 18, season: 2, round: 0, team: 'Ferrari', finishes: [], points: {} });
    expect(c.history).toEqual([{ season: 1, age: 17, team: 'Williams', position: 3, points: 15 * CALENDAR.length }]);
    expect(rookieOf(c).replaces).toBe('SAI');
  });

  it('remembers what the driver looks like', () => {
    const c = newCareer({ name: 'Herbie Rocket', number: 17, team: 'Williams', difficulty: 2, laps: 5, look: { skin: 3, hair: 2, hairColor: 1 } });
    expect(c.look).toEqual({ skin: 3, hair: 2, hairColor: 1 });
    expect(fresh().look).toEqual({ skin: 0, hair: 0, hairColor: 0 });
  });
});
