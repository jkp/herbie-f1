// The 2022 Formula One grid. `pace` scales car performance (1 = Red Bull, the 2022 benchmark);
// `skill` is the driver's share of the car's potential.
export interface Team { name: string; color: number; pace: number; drivers: Driver[]; livery: [number, number] } // livery: car body, accent
export interface Driver { name: string; code: string; number: number; skill: number; team: Team }

// Approximate 2022 car colours (body, accent); `color` is the TV-graphics team colour.
const LIVERY: Record<string, [number, number]> = {
  'Red Bull Racing': [0x1b2a5c, 0xe10600], Ferrari: [0xd40000, 0x111111], Mercedes: [0xb9bdc2, 0x00d2be],
  Alpine: [0x1560bd, 0xff87bc], McLaren: [0xff8000, 0x1e88e5], 'Alfa Romeo': [0x8f0d0d, 0xf2f2f2],
  'Aston Martin': [0x00594f, 0xcedc00], Haas: [0xf2f2f2, 0x1a1a1a], AlphaTauri: [0x1b2a49, 0xf2f2f2], Williams: [0x0a2b6b, 0x37bef0],
};
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
  const team: Team = { name, color, pace, drivers: [], livery: LIVERY[name] };
  team.drivers = ds.map(([n, code, number, skill]) => ({ name: n, code, number, skill, team }));
  return team;
});
export const DRIVERS: Driver[] = TEAMS.flatMap(t => t.drivers);
