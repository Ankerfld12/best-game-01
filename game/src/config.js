// config.js — all of EMBERFALL's tuning in one place: the five weapons, the buy
// menu, the economy, round timing and bot difficulty. The design rule: accuracy
// counts more than speed. Spread grows hard with movement and with holding the
// trigger, the first shot is nearly perfect, headshots multiply damage, and
// stopping (or crouching) is how a tight cone is earned.

// Damage model: a hit deals `damage`, times `headMult` on the head, scaled by
// armour (0.55 through a vest; a helmet halves headshot damage again) and by
// distance falloff — full damage out to `falloffStart` metres, easing to
// `falloffEndScale` at 45 m.
export const WEAPONS = {
  spark: {
    id: 'spark', name: 'Spark Pistol', slot: 'sidearm', price: 0,
    damage: 26, headMult: 3.0, rpm: 380, auto: false, mag: 12, reserve: 60,
    reloadTime: 1.5, spreadBase: 0.006, spreadMove: 0.030, spreadAir: 0.06,
    recoil: 0.011, kickRecover: 7.5, moveSpeed: 5.1, falloffStart: 14, falloffEndScale: 0.55,
    pellets: 1, zoomFov: 62, tracer: 0xffd9a0,
  },
  wasp: {
    id: 'wasp', name: 'Wasp SMG', slot: 'primary', price: 900,
    damage: 21, headMult: 2.6, rpm: 780, auto: true, mag: 30, reserve: 90,
    reloadTime: 2.1, spreadBase: 0.010, spreadMove: 0.034, spreadAir: 0.06,
    recoil: 0.008, kickRecover: 8.5, moveSpeed: 5.0, falloffStart: 11, falloffEndScale: 0.45,
    pellets: 1, zoomFov: 60, tracer: 0xffe2b0,
  },
  scatter: {
    id: 'scatter', name: 'Scatterjack', slot: 'primary', price: 1800,
    damage: 13, headMult: 1.8, rpm: 68, auto: false, mag: 6, reserve: 24,
    reloadTime: 2.9, spreadBase: 0.045, spreadMove: 0.055, spreadAir: 0.07,
    recoil: 0.045, kickRecover: 5.0, moveSpeed: 4.7, falloffStart: 6, falloffEndScale: 0.25,
    pellets: 8, zoomFov: 64, tracer: 0xffc98a,
  },
  longbow: {
    id: 'longbow', name: 'Longbow Rifle', slot: 'primary', price: 2700,
    damage: 33, headMult: 3.1, rpm: 600, auto: true, mag: 30, reserve: 90,
    reloadTime: 2.4, spreadBase: 0.004, spreadMove: 0.036, spreadAir: 0.07,
    recoil: 0.013, kickRecover: 6.5, moveSpeed: 4.75, falloffStart: 22, falloffEndScale: 0.7,
    pellets: 1, zoomFov: 55, tracer: 0xffe9c4,
  },
  needle: {
    id: 'needle', name: 'Needle DMR', slot: 'primary', price: 3200,
    damage: 68, headMult: 2.2, rpm: 150, auto: false, mag: 10, reserve: 40,
    reloadTime: 2.6, spreadBase: 0.0015, spreadMove: 0.030, spreadAir: 0.06,
    recoil: 0.030, kickRecover: 4.5, moveSpeed: 4.6, falloffStart: 34, falloffEndScale: 0.85,
    pellets: 1, zoomFov: 38, tracer: 0xfff3d6,
  },
};

export const BUY_ITEMS = [
  { kind: 'weapon', id: 'wasp', key: '1', label: 'Wasp SMG', price: 900, blurb: 'Fast, close range' },
  { kind: 'weapon', id: 'scatter', key: '2', label: 'Scatterjack', price: 1800, blurb: '8-pellet breach gun' },
  { kind: 'weapon', id: 'longbow', key: '3', label: 'Longbow Rifle', price: 2700, blurb: 'The all-round rifle' },
  { kind: 'weapon', id: 'needle', key: '4', label: 'Needle DMR', price: 3200, blurb: 'One headshot ends it' },
  { kind: 'armor', id: 'armor', key: '5', label: 'Vest + Helm', price: 1000, blurb: 'Cuts body damage 45%' },
  { kind: 'grenade', id: 'frag', key: '6', label: 'Ember Frag', price: 300, blurb: 'G — clears a corner' },
  { kind: 'grenade', id: 'flash', key: '7', label: 'Glare Pop', price: 200, blurb: 'F — blinds a held angle' },
  { kind: 'kit', id: 'kit', key: '8', label: 'Quench Kit', price: 400, blurb: 'Defend: quench twice as fast' },
];

export const ECONOMY = {
  startMoney: 800,
  maxMoney: 9000,
  killReward: 300,
  plantReward: 350, // paid to whoever ignites the Core
  winReward: 2700,
  lossReward: 1900,
  lossStreakStep: 350, // extra loss bonus per consecutive lost round, capped at 2 steps
};

export const ROUNDS = {
  buyTime: 12,
  roundTime: 100,
  plantTime: 3.2,
  defuseTime: 5.0,
  defuseTimeKit: 2.6,
  coreFuse: 35, // seconds from ignite to detonation
  endTime: 4.5,
  winTarget: 7,
  maxRounds: 12,
  halfAt: 6, // sides swap after this many rounds
};

export const BOTS = {
  countPerTeam: 4, // the player is one of the four Kindlers
  names: {
    kindler: ['Pico', 'Sable', 'Rook'],
    warden: ['Vex', 'Hollis', 'Maren', 'Odo'],
  },
  reactionTime: 0.32, // seconds between first sight and first shot
  burstPause: 0.28,
  aimErrorBase: 0.028, // radians of aim noise; grows against fast, distant targets
  health: 100,
};
