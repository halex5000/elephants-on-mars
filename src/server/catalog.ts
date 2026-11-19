// Game data. SERVER-ONLY: never import this from client code. Animal sizes and
// rocket sizes/fuel needs are the hidden information teams have to talk about;
// the server sends each role only its own slice.
//
// Shapes follow the original's screens: small whole-dollar prices, letter sizes,
// rockets paired per size (one pricier but frugal, one cheap but thirsty).
// Exact numbers are our own; every balance knob lives here.

export const SIZES = ['S', 'M', 'L', 'XL'] as const;
export type Size = (typeof SIZES)[number];
export const sizeRank = (s: Size) => SIZES.indexOf(s);
/** A rocket can carry an animal if the rocket is at least as big. */
export const fits = (animal: Size, rocket: Size) => sizeRank(rocket) >= sizeRank(animal);

export interface Animal {
  id: string;
  name: string;
  emoji: string;
  size: Size;
  points: number;
  base: number;
}
export interface Rocket {
  id: string;
  name: string;
  size: Size;
  fuel: number;
  base: number;
}

/** base = middle of its auction range, in dollars */
export const ANIMALS: readonly Animal[] = [
  { id: 'cat', name: 'Cat', emoji: '🐈', size: 'S', points: 10, base: 2 },
  { id: 'penguin', name: 'Penguin', emoji: '🐧', size: 'S', points: 15, base: 2 },
  { id: 'rabbit', name: 'Rabbit', emoji: '🐇', size: 'S', points: 20, base: 3 },
  { id: 'kangaroo', name: 'Kangaroo', emoji: '🦘', size: 'M', points: 25, base: 3 },
  { id: 'croc', name: 'Crocodile', emoji: '🐊', size: 'M', points: 25, base: 3 },
  { id: 'gorilla', name: 'Gorilla', emoji: '🦍', size: 'M', points: 30, base: 4 },
  { id: 'rhino', name: 'Rhino', emoji: '🦏', size: 'L', points: 35, base: 4 },
  { id: 'giraffe', name: 'Giraffe', emoji: '🦒', size: 'L', points: 40, base: 5 },
  { id: 'hippo', name: 'Hippo', emoji: '🦛', size: 'L', points: 45, base: 5 },
  { id: 'orca', name: 'Orca', emoji: '🐋', size: 'XL', points: 55, base: 6 },
  { id: 'elephant', name: 'Elephant', emoji: '🐘', size: 'XL', points: 60, base: 7 },
];

/** fuel = units the mission needs on board to reach Mars */
export const ROCKETS: readonly Rocket[] = [
  { id: 'compact', name: 'Compact', size: 'S', fuel: 20, base: 3 },
  { id: 'economy', name: 'Economy', size: 'S', fuel: 30, base: 2 },
  { id: 'cruiser', name: 'Cruiser', size: 'M', fuel: 35, base: 4 },
  { id: 'hauler', name: 'Hauler', size: 'M', fuel: 50, base: 3 },
  { id: 'heavy', name: 'Heavy', size: 'L', fuel: 55, base: 5 },
  { id: 'freighter', name: 'Freighter', size: 'L', fuel: 75, base: 4 },
  { id: 'titan', name: 'Titan', size: 'XL', fuel: 80, base: 7 },
  { id: 'mammoth', name: 'Mammoth', size: 'XL', fuel: 110, base: 5 },
];

/** Fuel moves from the team's stock into the mission this many units at a time. */
export const FUEL_SEND_STEP = 10;

export const TEAM_NAMES: readonly string[] = [
  'Trunk Show',
  'Red Dusters',
  'Ground Control',
  'Peanut Gallery',
  'Olympus Mob',
  'Pachyderm Program',
  'Crater Crew',
  'Mars Bars',
  'Dust Bunnies',
  'Launch Party',
  'Orbit Squad',
  'Tusk Force',
];

/** Group terraforming goal: points per team per mission that would make Mars a paradise. */
export const TERRAFORM_POINTS_PER_TEAM_ROUND = 35;

export const animalById = (id: string) => ANIMALS.find(a => a.id === id);
export const rocketById = (id: string) => ROCKETS.find(r => r.id === id);
