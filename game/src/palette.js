// palette.js — EMBERFALL's single colour plan. The Cinder Yard at dusk: charcoal
// concrete and rusted steel, warm light spilling from the Furnace side, cool light
// from the Depot side. Kindlers wear ember orange and Wardens wear signal teal, so
// any silhouette's team can be read at a glance across the yard. Every material
// colour and HUD accent in the game is taken from this table.
export const PALETTE = {
  canvas: 0x14181d, // page background / fog base
  fog: 0x1b2129,
  sky: 0x232c38,
  floor: 0x55504a, // worn yard concrete
  floorDark: 0x403d38,
  concrete: 0x6a7076, // walls
  concreteDark: 0x494f55,
  steel: 0x3d454d,
  rust: 0x7c4a2d, // rusted containers and beams
  crateWood: 0x8a6b42,
  ember: 0xff8c3a, // Kindler team + Furnace (A) accent
  emberHot: 0xffc46b,
  teal: 0x2fd4c4, // Warden team + Depot (B) accent
  tealDeep: 0x1a7f78,
  ink: '#ece7dc',
  muted: '#9aa3ab',
  danger: '#ff5347',
  gold: '#f0c24b',
};

export const TEAM_COLORS = {
  kindler: PALETTE.ember,
  warden: PALETTE.teal,
};
