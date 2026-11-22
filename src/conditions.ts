// Time of day and weather for a race. `sun`: elevation in degrees (negative = below the horizon);
// `grip`: multiplier on every car's tyre grip.
export const TIMES = [
  { name: 'Morning', sun: 18, azimuth: 105 },
  { name: 'Afternoon', sun: 50, azimuth: 160 },
  { name: 'Sunset', sun: 3, azimuth: 250 },
  { name: 'Night', sun: -20, azimuth: 250 },
];
export const WEATHER = [
  { name: 'Sunny', grip: 1, cloud: 0, rain: false },
  { name: 'Cloudy', grip: 1, cloud: 0.75, rain: false },
  { name: 'Rain', grip: 0.78, cloud: 1, rain: true },
];
