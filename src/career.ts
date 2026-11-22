// Career mode: a rookie's seasons, points and contract offers. Pure data, saved as JSON by the UI.
import { CIRCUITS } from './circuits';
import { DRIVERS, TEAMS } from './grid';

export interface Career {
  name: string; code: string; number: number;
  team: string; age: number; season: number;
  round: number; // index into CALENDAR of the next race
  difficulty: number; laps: number;
  points: Record<string, number>; // driver code → points this season
  finishes: number[];             // the player's finishing positions this season
  history: { season: number; age: number; team: string; position: number; points: number }[];
  look: Look;
}
/** What the driver looks like: indexes into SKIN_TONES, HAIRSTYLES and HAIR_COLOURS (src/people.ts). */
export interface Look { skin: number; hair: number; hairColor: number }

export const POINTS = [25, 18, 15, 12, 10, 8, 6, 4, 2, 1];
const ORDER = ['bahrain', 'barcelona', 'monaco', 'silverstone', 'redbullring', 'hungaroring', 'spa', 'zandvoort', 'monza', 'interlagos', 'yasmarina'];
export const CALENDAR = ORDER.map(id => CIRCUITS.find(c => c.id === id)!);

const TAKEN = new Set(DRIVERS.map(d => d.code));

/** Three letters from the name that no 2022 driver already uses. */
export function deriveCode(name: string) {
  const l = name.toUpperCase().replace(/[^A-Z]/g, '');
  const tries = [l.slice(0, 3), ...[...l.slice(2)].map(ch => l.slice(0, 2) + ch), ...[...'XYZQJK'].map(ch => (l + 'XX').slice(0, 2) + ch)];
  return tries.find(c => c.length === 3 && !TAKEN.has(c)) ?? 'YOU';
}

/** Why a race number can't be used, or null if it's fine. */
export function numberProblem(n: number) {
  if (!Number.isInteger(n) || n < 2 || n > 99) return 'Pick a whole number from 2 to 99.';
  const owner = DRIVERS.find(d => d.number === n);
  return owner ? `#${n} belongs to ${owner.name}.` : null;
}

export function newCareer(o: { name: string; number: number; team: string; difficulty: number; laps: number; look?: Look }): Career {
  return { look: { skin: 0, hair: 0, hairColor: 0 }, ...o, code: deriveCode(o.name), age: 17, season: 1, round: 0, points: {}, finishes: [], history: [] };
}

/** The player takes their team's second seat. */
export function rookieOf(c: Career) {
  const team = TEAMS.find(t => t.name === c.team)!;
  return { name: c.name, code: c.code, number: c.number, replaces: team.drivers[1].code };
}

/** `order`: driver codes in finishing order. */
export function recordRace(c: Career, order: string[]) {
  order.forEach((code, k) => { c.points[code] = (c.points[code] ?? 0) + (POINTS[k] ?? 0); });
  c.finishes.push(order.indexOf(c.code) + 1);
  c.round++;
}

export const seasonOver = (c: Career) => c.round >= CALENDAR.length;

export function championship(c: Career) {
  const out = rookieOf(c).replaces;
  const rows = DRIVERS.filter(d => d.code !== out).map(d => ({ code: d.code, name: d.name, team: d.team.name, points: c.points[d.code] ?? 0 }));
  rows.push({ code: c.code, name: c.name, team: c.team, points: c.points[c.code] ?? 0 });
  // ties: better best finish isn't tracked, so keep grid order (stable sort)
  return rows.sort((a, b) => b.points - a.points);
}

/** Teams that want the player next season: the faster the car, the higher they must finish. */
export function offers(c: Career) {
  const pos = championship(c).findIndex(e => e.code === c.code) + 1;
  return TEAMS.filter((t, rank) => t.name !== c.team && pos <= 2 + rank * 2).map(t => t.name);
}

export function nextSeason(c: Career, team: string) {
  const position = championship(c).findIndex(e => e.code === c.code) + 1;
  c.history.push({ season: c.season, age: c.age, team: c.team, position, points: c.points[c.code] ?? 0 });
  Object.assign(c, { team, age: c.age + 1, season: c.season + 1, round: 0, points: {}, finishes: [] });
}
