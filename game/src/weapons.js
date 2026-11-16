// weapons.js — a combatant's loadout: owned weapons with their ammunition and
// cooldown state, the first-person viewmodels, and thrown grenades. The firing
// maths lives here too — spread, recoil bloom, falloff, armour — so the player
// and the bots shoot by exactly the same rules. The hitscan itself is resolved
// by main.js against the shared colliders and bodies.
import * as THREE from 'three';
import { WEAPONS } from './config.js';
import { PALETTE } from './palette.js';

export function createWeaponState(id) {
  const def = WEAPONS[id];
  return {
    def,
    mag: def.mag,
    reserve: def.reserve,
    cooldown: 0, // seconds until the next shot may fire
    reloadUntil: 0, // kept for parity with the state shape; main.js tracks the clock
    reloading: false,
    bloom: 0, // extra spread from sustained fire, 0..1
    shotsInBurst: 0,
  };
}

export function createLoadout() {
  return {
    weapons: { spark: createWeaponState('spark') },
    currentId: 'spark',
    armor: false,
    helmet: false,
    frags: 0,
    flashes: 0,
    kit: false,
    lastId: 'spark',
  };
}

export function currentWeapon(loadout) {
  return loadout.weapons[loadout.currentId];
}

export function giveWeapon(loadout, id) {
  if (!loadout.weapons[id]) loadout.weapons[id] = createWeaponState(id);
  else {
    const state = loadout.weapons[id];
    state.mag = state.def.mag;
    state.reserve = state.def.reserve;
  }
  loadout.currentId = id;
}

export function switchWeapon(loadout, id) {
  if (!loadout.weapons[id] || loadout.currentId === id) return false;
  loadout.lastId = loadout.currentId;
  loadout.currentId = id;
  const state = currentWeapon(loadout);
  state.reloading = false;
  state.bloom = 0;
  return true;
}

// The spread of the next shot, in radians. Standing still and crouched is the
// most accurate state in the game; sprinting through the air with the trigger
// held is the worst. This one function is the whole "accuracy counts more than
// speed" rule.
export function shotSpread(state, { speed, onGround, crouched, aiming }) {
  const def = state.def;
  const moveFactor = THREE.MathUtils.clamp(speed / 5, 0, 1);
  let spread = def.spreadBase + def.spreadMove * moveFactor * moveFactor;
  if (!onGround) spread += def.spreadAir;
  if (crouched) spread *= 0.62;
  if (aiming) spread *= 0.55;
  spread += state.bloom * 0.016;
  return spread;
}

export function damageAt(def, distance, part, target) {
  let damage = def.damage;
  if (part === 'head') damage *= def.headMult;
  if (distance > def.falloffStart) {
    const t = Math.min(1, (distance - def.falloffStart) / (45 - def.falloffStart));
    damage *= 1 - t * (1 - def.falloffEndScale);
  }
  if (target.armor) {
    damage *= 0.55;
    if (part === 'head' && target.helmet) damage *= 0.5;
  }
  return damage;
}

// --- Viewmodels ---------------------------------------------------------------
// Each gun is a small kit of boxes hung off the camera: receiver, barrel, grip,
// magazine and a coloured sight bead, proportioned so the five weapons read
// differently in the hand. Recoil, bob and the reload dip are applied to the
// group by main.js from the weapon state.

const viewMaterials = {
  body: new THREE.MeshStandardMaterial({ color: 0x5a626c, roughness: 0.5, metalness: 0.3 }),
  grip: new THREE.MeshStandardMaterial({ color: 0x33373d, roughness: 0.8, metalness: 0.15 }),
  accentEmber: new THREE.MeshStandardMaterial({ color: 0x201409, emissive: PALETTE.ember, emissiveIntensity: 1.4 }),
  accentTeal: new THREE.MeshStandardMaterial({ color: 0x0a1f1d, emissive: PALETTE.teal, emissiveIntensity: 1.2 }),
};

function box(group, w, h, d, x, y, z, material = viewMaterials.body) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.position.set(x, y, z);
  group.add(mesh);
  return mesh;
}

export function createViewmodel(weaponId) {
  const group = new THREE.Group();
  const accent = viewMaterials.accentEmber;
  if (weaponId === 'spark') {
    box(group, 0.075, 0.11, 0.30, 0, 0, -0.10);
    box(group, 0.05, 0.13, 0.07, 0, -0.10, 0.03, viewMaterials.grip);
    box(group, 0.02, 0.03, 0.02, 0, 0.075, -0.24, accent);
  } else if (weaponId === 'wasp') {
    box(group, 0.08, 0.12, 0.46, 0, 0, -0.16);
    box(group, 0.045, 0.05, 0.20, 0, 0.01, -0.46);
    box(group, 0.055, 0.17, 0.08, 0, -0.13, -0.08, viewMaterials.grip);
    box(group, 0.05, 0.12, 0.07, 0, -0.10, 0.10, viewMaterials.grip);
    box(group, 0.02, 0.03, 0.02, 0, 0.085, -0.30, accent);
  } else if (weaponId === 'scatter') {
    box(group, 0.09, 0.11, 0.55, 0, 0, -0.20);
    box(group, 0.07, 0.07, 0.24, 0, -0.055, -0.28, viewMaterials.grip);
    box(group, 0.05, 0.13, 0.07, 0, -0.11, 0.06, viewMaterials.grip);
    box(group, 0.024, 0.03, 0.024, 0, 0.07, -0.46, accent);
  } else if (weaponId === 'needle') {
    box(group, 0.07, 0.10, 0.72, 0, 0, -0.26);
    box(group, 0.04, 0.04, 0.30, 0, 0.005, -0.68);
    box(group, 0.06, 0.07, 0.16, 0, 0.09, -0.18, viewMaterials.grip); // scope block
    box(group, 0.02, 0.02, 0.05, 0, 0.095, -0.18, viewMaterials.accentTeal);
    box(group, 0.05, 0.16, 0.07, 0, -0.12, -0.05, viewMaterials.grip);
    box(group, 0.05, 0.11, 0.07, 0, -0.09, 0.16, viewMaterials.grip);
  } else {
    // longbow
    box(group, 0.08, 0.12, 0.58, 0, 0, -0.20);
    box(group, 0.045, 0.045, 0.26, 0, 0.01, -0.56);
    box(group, 0.055, 0.19, 0.08, 0, -0.14, -0.10, viewMaterials.grip);
    box(group, 0.05, 0.12, 0.07, 0, -0.10, 0.14, viewMaterials.grip);
    box(group, 0.06, 0.05, 0.10, 0, 0.085, -0.12, viewMaterials.grip); // carry handle
    box(group, 0.02, 0.03, 0.02, 0, 0.075, -0.34, accent);
  }
  group.position.set(0.24, -0.22, -0.42);
  return group;
}

export function muzzleLocalZ(weaponId) {
  return { spark: -0.28, wasp: -0.58, scatter: -0.52, longbow: -0.72, needle: -0.86 }[weaponId] ?? -0.5;
}

// --- Grenades -----------------------------------------------------------------
// Thrown projectiles with simple ballistic flight and floor/wall bounces,
// stepped on the fixed clock. A frag bursts for area damage with distance
// falloff and a line-of-sight check; a flash blinds any combatant whose view
// cone contains the burst and who can see it — the classic "turn away from the
// pop" rule, applied to bot facing and to the player's camera alike.
export function createGrenades(scene) {
  const live = [];
  const fragMesh = new THREE.SphereGeometry(0.09, 10, 8);
  const fragMaterial = new THREE.MeshStandardMaterial({ color: 0x3a2c1c, emissive: PALETTE.ember, emissiveIntensity: 0.7, roughness: 0.5 });
  const flashMaterial = new THREE.MeshStandardMaterial({ color: 0xd8dde2, emissive: 0xffffff, emissiveIntensity: 0.9, roughness: 0.4 });

  function throwGrenade(kind, from, dir, owner) {
    const mesh = new THREE.Mesh(fragMesh, kind === 'frag' ? fragMaterial : flashMaterial);
    mesh.position.copy(from);
    scene.add(mesh);
    live.push({
      kind,
      mesh,
      owner,
      velocity: new THREE.Vector3(dir.x * 13, dir.y * 13 + 3.4, dir.z * 13),
      fuse: kind === 'frag' ? 1.6 : 1.1,
      alive: true,
    });
  }

  // Steps every live grenade; returns burst events [{kind, position, owner}]
  // for main.js to resolve into damage and blindness.
  function step(dt, colliders) {
    const events = [];
    for (const grenade of live) {
      if (!grenade.alive) continue;
      grenade.fuse -= dt;
      grenade.velocity.y -= 12.5 * dt;
      const pos = grenade.mesh.position;
      pos.addScaledVector(grenade.velocity, dt);
      if (pos.y < 0.09) {
        pos.y = 0.09;
        grenade.velocity.y = Math.abs(grenade.velocity.y) * 0.38;
        grenade.velocity.x *= 0.7;
        grenade.velocity.z *= 0.7;
      }
      for (const c of colliders) {
        if (c.top < 0.4) continue;
        if (pos.x > c.minX - 0.09 && pos.x < c.maxX + 0.09 && pos.z > c.minZ - 0.09 && pos.z < c.maxZ + 0.09 && pos.y < c.top) {
          // Bounce off the shallowest face.
          const left = pos.x - (c.minX - 0.09);
          const right = (c.maxX + 0.09) - pos.x;
          const near = pos.z - (c.minZ - 0.09);
          const far = (c.maxZ + 0.09) - pos.z;
          const min = Math.min(left, right, near, far);
          if (min === left || min === right) grenade.velocity.x *= -0.45;
          else grenade.velocity.z *= -0.45;
          pos.x = THREE.MathUtils.clamp(pos.x, c.minX - 0.1, c.maxX + 0.1);
          pos.z = THREE.MathUtils.clamp(pos.z, c.minZ - 0.1, c.maxZ + 0.1);
        }
      }
      if (grenade.fuse <= 0) {
        grenade.alive = false;
        events.push({ kind: grenade.kind, position: pos.clone(), owner: grenade.owner });
      }
    }
    for (let i = live.length - 1; i >= 0; i -= 1) {
      if (!live[i].alive) {
        scene.remove(live[i].mesh);
        live.splice(i, 1);
      }
    }
    return events;
  }

  return { throwGrenade, step, live };
}
