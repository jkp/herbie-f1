// The 2022 Formula One grid. `pace` scales car performance (1 = Red Bull, the 2022 benchmark);
// `skill` is the driver's share of the car's potential.
export interface Team { name: string; color: number; pace: number; drivers: Driver[] }
export interface Driver { name: string; code: string; number: number; skill: number; team: Team }

const RAW: [string, number, number, [string, string, number, number][]][] = [
  ['Red Bull Racing', 0x1e41ff, 1.0, [['Max Verstappen', 'VER', 1, 1.0], ['Sergio Pérez', 'PER', 11, 0.985]]],
  ['Ferrari', 0xdc0000, 0.995, [['Charles Leclerc', 'LEC', 16, 0.995], ['Carlos Sainz', 'SAI', 55, 0.985]]],
  ['Mercedes', 0x27f4d2, 0.985, [['Lewis Hamilton', 'HAM', 44, 0.995], ['George Russell', 'RUS', 63, 0.99]]],
  ['Alpine', 0x2293d1, 0.97, [['Fernando Alonso', 'ALO', 14, 0.99], ['Esteban Ocon', 'OCO', 31, 0.98]]],
  ['McLaren', 0xff8000, 0.968, [['Lando Norris', 'NOR', 4, 0.99], ['Daniel Ricciardo', 'RIC', 3, 0.97]]],
  ['Alfa Romeo', 0x9b0000, 0.958, [['Valtteri Bottas', 'BOT', 77, 0.985], ['Zhou Guanyu', 'ZHO', 24, 0.97]]],
  ['Aston Martin', 0x006f62, 0.956, [['Sebastian Vettel', 'VET', 5, 0.985], ['Lance Stroll', 'STR', 18, 0.97]]],
  ['Haas', 0xe6e6e6, 0.952, [['Kevin Magnussen', 'MAG', 20, 0.98], ['Mick Schumacher', 'MSC', 47, 0.97]]],
  ['AlphaTauri', 0x2b4562, 0.95, [['Pierre Gasly', 'GAS', 10, 0.98], ['Yuki Tsunoda', 'TSU', 22, 0.97]]],
  ['Williams', 0x005aff, 0.94, [['Alexander Albon', 'ALB', 23, 0.98], ['Nicholas Latifi', 'LAT', 6, 0.96]]],
];

export const TEAMS: Team[] = RAW.map(([name, color, pace, ds]) => {
  const team: Team = { name, color, pace, drivers: [] };
  team.drivers = ds.map(([n, code, number, skill]) => ({ name: n, code, number, skill, team }));
  return team;
});
export const DRIVERS: Driver[] = TEAMS.flatMap(t => t.drivers);
