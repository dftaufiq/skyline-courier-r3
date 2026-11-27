// Skyline Courier — one place for every number the game tunes by.
// Units: world metres for distance, feet for altitude, knots for speed.
export const VIEW_W = 960;
export const VIEW_H = 540;
export const MAP_SIZE = 400; // heightmap is MAP_SIZE x MAP_SIZE cells, 1 cell = 40 m
export const CELL = 40;
export const SEA_LEVEL = 0;
export const STALL_SPEED = 55; // knots: below this the wing stops flying
export const MAX_SPEED = 210; // knots at full throttle, level flight
export const CRUISE_SPEED = 120;
export const CLIMB_RATE = 9; // m/s at full throttle, nose up
export const SINK_RATE = 6; // m/s gliding, nose level, throttle idle
export const TURN_RATE = 0.55; // rad/s at full bank
export const FUEL_BURN = 0.55; // % per second at full throttle
export const FUEL_IDLE = 0.12; // % per second at idle
export const FUEL_TANK = 100;
export const START_FUEL = 100;
export const BEST_KEY = 'skyline-courier-best';

// The archipelago, in world metres. The map spans MAP_SIZE*CELL = 10,240 m.
// Islands are placed by hand so every sortie has recognisable landmarks.
export const ISLANDS = [
  { name: 'Isla Verde', x: 5120, z: 5120, r: 1500, peak: 320, town: true },
  { name: 'Koro Volcano', x: 2900, z: 3300, r: 1050, peak: 620, volcano: true },
  { name: 'Lighthouse Pt', x: 7400, z: 3600, r: 800, peak: 120, lighthouse: true },
  { name: 'Turtle Cay', x: 3300, z: 7300, r: 900, peak: 150, town: true },
  { name: 'Sable Reef', x: 7600, z: 7400, r: 700, peak: 90 },
];

// Villages: rooftops the pilot can pick out from the air.
export const TOWNS = [
  { name: 'Verde Town', x: 5450, z: 5450, r: 180 },
  { name: 'Turtle Village', x: 3550, z: 7450, r: 150 },
];

// Airstrips: flat, painted into the heightmap, with a heading (deg) and a name.
export const AIRSTRIPS = [
  { name: 'Verde Field', island: 'Isla Verde', x: 5120, z: 5900, heading: 90, length: 700, width: 60 },
  { name: 'Koro Strip', island: 'Koro Volcano', x: 3600, z: 3900, heading: 200, length: 560, width: 50 },
  { name: 'Turtle Bay', island: 'Turtle Cay', x: 3300, z: 7300, heading: 350, length: 620, width: 55 },
];

// Sorties: three different goals, three different ways to fly.
export const SORTIES = [
  {
    id: 'rings',
    name: 'RING RUN',
    tag: '8 rings over the islands',
    brief: 'Thread all 8 glowing rings in order. Tight turns beat raw speed — bank early, throttle late.',
    rings: 8,
    wind: 0.15,
    fuel: 100,
    timeLimit: 240,
  },
  {
    id: 'hop',
    name: 'ISLAND HOP',
    tag: 'Land at all 3 airstrips',
    brief: 'Touch down on Verde Field, Koro Strip and Turtle Bay. Slow, aligned and gentle wins — flaps out, throttle back.',
    rings: 0,
    wind: 0.3,
    fuel: 100,
    timeLimit: 420,
  },
  {
    id: 'storm',
    name: 'STORM COURIER',
    tag: 'Mail satchel in the storm',
    brief: 'One satchel, one island, one storm. Fly Turtle Cay through gusts and rain on a tight tank — fuel is the boss here.',
    rings: 3,
    wind: 1.0,
    fuel: 62,
    timeLimit: 300,
  },
];

// Golden-hour palette: one warm style for sky, sea and land.
export const PALETTE = {
  skyTop: '#2b3a6e',
  skyMid: '#e8824f',
  skyLow: '#f7c873',
  sun: '#ffd98a',
  seaDeep: '#1d5f7a',
  seaShallow: '#3f9db0',
  sand: '#e8cf9a',
  grass: '#5d9b4a',
  forest: '#2f6b34',
  rock: '#8a7a68',
  snow: '#f2ede2',
  townRoof: '#a34d33',
  townWall: '#d8c49a',
  runway: '#4a4a52',
  runwayLine: '#f5f0dc',
  ring: '#ffd23f',
  ringGlow: '#ff9d2e',
};
