// bots.js — the combatants and their tactical brains. Every bot is an actor with
// the same body, loadout and weapon rules as the player. The brain thinks in
// staggered ticks: it follows waypoint routes through the lanes, holds site
// positions on defence, carries the Spark Core to a site on attack, channels the
// ignite and the quench, investigates gunfire it hears, and fights in bursts —
// reacting after a human-like delay, aiming with error that grows against fast
// targets, strafing and crouching under fire, and going quiet when a Glare Pop
// blinds it. Vision is a facing cone plus a true line-of-sight raycast, so
// holding an angle behind a crate genuinely works.
import * as THREE from 'three';
import { BOTS } from './config.js';
import { PALETTE, TEAM_COLORS } from './palette.js';
import { createBody, stepBody, eyeHeight, losClear } from './physics.js';
import { createLoadout } from './weapons.js';
import { findPath } from './world.js';

const HOLD_POINTS = {
  A: [[26, -10.5], [33.5, -10], [27, -17.5]],
  B: [[26, 10.5], [33.5, 21], [27, 17.5]],
  mid: [[12, -4], [-1, 4], [18, 0]],
};

const skinMat = new THREE.MeshStandardMaterial({ color: 0xc9a183, roughness: 0.8 });
const darkMat = new THREE.MeshStandardMaterial({ color: 0x23262b, roughness: 0.85 });

function buildMesh(team) {
  const group = new THREE.Group();
  const teamMat = new THREE.MeshStandardMaterial({ color: TEAM_COLORS[team], roughness: 0.7 });
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.78, 0.2), darkMat);
  legL.position.set(-0.11, 0.39, 0);
  const legR = legL.clone();
  legR.position.x = 0.11;
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.62, 0.28), teamMat);
  torso.position.y = 1.06;
  const vest = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.4, 0.33), darkMat);
  vest.position.y = 1.04;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), skinMat);
  head.position.y = 1.56;
  const cap = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.1, 0.34), teamMat);
  cap.position.y = 1.74;
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.1, 0.62), darkMat);
  gun.position.set(0.18, 1.18, -0.3);
  for (const part of [legL, legR, torso, vest, head, cap, gun]) {
    part.castShadow = true;
    group.add(part);
  }
  return { group, torso, vest, head, cap, gun, legL, legR };
}

export function createBot(scene, team, name, index) {
  const mesh = buildMesh(team);
  scene.add(mesh.group);
  const bot = {
    kind: 'bot',
    team,
    name,
    index,
    body: createBody(0, 0),
    health: BOTS.health,
    alive: true,
    armor: false,
    helmet: false,
    loadout: createLoadout(),
    hasCore: false,
    mesh,
    fallT: 0,
    walkPhase: Math.random() * 6,
    brain: {
      path: [],
      pathIdx: 0,
      goal: null,
      holdPos: null,
      holdAlt: null,
      enemy: null,
      lastSeenPos: new THREE.Vector3(),
      lastSeenAt: -99,
      reactionAt: 0,
      burstLeft: 0,
      pauseUntil: 0,
      nextThink: Math.random() * 0.15,
      strafeDir: 1,
      strafeUntil: 0,
      blindUntil: 0,
      crouchUntil: 0,
      investigateUntil: 0,
      aimError: 0,
      assignedSite: 'A',
      roleSeed: Math.random(),
    },
  };
  return bot;
}

export function resetBot(bot, spawn, yaw) {
  bot.body.position.set(spawn[0], 0, spawn[1]);
  bot.body.velocity.set(0, 0, 0);
  bot.body.yaw = yaw;
  bot.body.pitch = 0;
  bot.body.crouch01 = 0;
  bot.health = BOTS.health;
  bot.alive = true;
  bot.hasCore = false;
  bot.fallT = 0;
  const brain = bot.brain;
  brain.path = [];
  brain.pathIdx = 0;
  brain.goal = null;
  brain.enemy = null;
  brain.lastSeenAt = -99;
  brain.burstLeft = 0;
  brain.blindUntil = 0;
  brain.investigateUntil = 0;
  bot.mesh.group.rotation.set(0, yaw, 0);
  bot.mesh.group.visible = true;
}

// Sync the visible figure to the physics body: position, facing, the crouch dip,
// a simple walk swing on the legs, and the backward fall when dead.
export function syncBotMesh(bot, dt) {
  const { group, torso, head, cap, gun, legL, legR } = bot.mesh;
  const body = bot.body;
  group.position.copy(body.position);
  if (!bot.alive) {
    bot.fallT = Math.min(1, bot.fallT + dt * 2.6);
    group.rotation.x = -bot.fallT * Math.PI * 0.5;
    group.rotation.y = body.yaw;
    group.position.y = body.position.y + bot.fallT * 0.12;
    return;
  }
  group.rotation.set(0, body.yaw, 0);
  const crouch = body.crouch01;
  torso.position.y = THREE.MathUtils.lerp(1.06, 0.82, crouch);
  bot.mesh.vest.position.y = THREE.MathUtils.lerp(1.04, 0.8, crouch);
  head.position.y = THREE.MathUtils.lerp(1.56, 1.13, crouch);
  cap.position.y = THREE.MathUtils.lerp(1.74, 1.31, crouch);
  gun.position.y = THREE.MathUtils.lerp(1.18, 0.92, crouch);
  const speed = Math.hypot(body.velocity.x, body.velocity.z);
  bot.walkPhase += dt * speed * 2.4;
  const swing = Math.sin(bot.walkPhase) * Math.min(0.5, speed * 0.09);
  legL.rotation.x = swing;
  legR.rotation.x = -swing;
}

const eyeScratch = new THREE.Vector3();
const chestScratch = new THREE.Vector3();
const dirScratch = new THREE.Vector3();
const losScratch = new THREE.Vector3();

export function botEye(bot, out) {
  return out.set(bot.body.position.x, bot.body.position.y + eyeHeight(bot.body), bot.body.position.z);
}

export function actorChest(actor, out) {
  const crouch = actor.body.crouch01;
  return out.set(
    actor.body.position.x,
    actor.body.position.y + THREE.MathUtils.lerp(1.15, 0.78, crouch),
    actor.body.position.z,
  );
}

export function actorHead(actor, out) {
  const crouch = actor.body.crouch01;
  return out.set(
    actor.body.position.x,
    actor.body.position.y + THREE.MathUtils.lerp(1.56, 1.13, crouch),
    actor.body.position.z,
  );
}

// Can `bot` see `target` right now? A facing cone (wide up close), a range cap,
// flash blindness, and a real line-of-sight raycast against the map's tall
// colliders.
export function canSee(bot, target, colliders, time) {
  if (!target.alive || time < bot.brain.blindUntil) return false;
  botEye(bot, eyeScratch);
  actorChest(target, chestScratch);
  dirScratch.subVectors(chestScratch, eyeScratch);
  const dist = dirScratch.length();
  if (dist > 58) return false;
  dirScratch.multiplyScalar(1 / Math.max(dist, 0.001));
  const facingX = -Math.sin(bot.body.yaw);
  const facingZ = -Math.cos(bot.body.yaw);
  const dot = dirScratch.x * facingX + dirScratch.z * facingZ;
  if (dist > 3.2 && dot < 0.28) return false;
  return losClear(eyeScratch, chestScratch, colliders, losScratch);
}

function setGoal(bot, world, targetPos) {
  const brain = bot.brain;
  if (brain.goal && brain.goal.distanceToSquared(targetPos) < 0.25 && brain.path.length > 0) return;
  // targetPos may be the match's plain {x, y, z} Core position, which has no
  // .clone() — copy the fields instead of calling vector methods on it.
  brain.goal = new THREE.Vector3(targetPos.x, targetPos.y ?? 0, targetPos.z);
  brain.path = findPath(world.nodes, bot.body.position, brain.goal);
  brain.pathIdx = 0;
}

function assignRoles(bot, match) {
  const brain = bot.brain;
  if (bot.team === match.attackingTeam) {
    // The whole attack runs at one site per round; the carrier leads and the
    // rest trade space around them.
    brain.assignedSite = match.planSite;
    return;
  }
  // Defence splits 2-1-1: two hold one site, one holds the other, one watches
  // mid. Which site gets the pair alternates with the round, so an attack
  // cannot read the setup in advance.
  const pairSite = match.round % 2 === 0 ? 'A' : 'B';
  const soloSite = pairSite === 'A' ? 'B' : 'A';
  brain.holdSite = [pairSite, pairSite, soloSite, 'mid'][bot.index % 4];
  const points = HOLD_POINTS[brain.holdSite];
  const pick = points[bot.index % points.length];
  brain.holdPos = new THREE.Vector3(pick[0], 0, pick[1]);
  const alt = points[(bot.index + 1) % points.length];
  brain.holdAlt = new THREE.Vector3(alt[0], 0, alt[1]);
}

export function startBotRound(bot, match) {
  assignRoles(bot, match);
  bot.brain.nextThink = Math.random() * 0.15;
}

// One fixed step of one bot. ctx carries the shared world: { time, world, match,
// actors, noise, tryFire, requestReload, startChannel, playerActor } — firing,
// reloading and channelling go through main.js so bots and the player share one
// gunplay implementation.
export function stepBot(bot, dt, ctx) {
  const { time, world, match } = ctx;
  const brain = bot.brain;
  const body = bot.body;
  if (!bot.alive) return;

  // --- Perception (throttled to a 0.12 s think tick) ---------------------------
  brain.nextThink -= dt;
  const thinkNow = brain.nextThink <= 0;
  if (thinkNow) {
    brain.nextThink = 0.12;
    let seen = null;
    for (const other of ctx.actors) {
      if (other === bot || other.team === bot.team || !other.alive) continue;
      if (canSee(bot, other, world.colliders, time)) { seen = other; break; }
    }
    if (seen) {
      if (brain.enemy !== seen) brain.reactionAt = time + BOTS.reactionTime * (0.7 + brain.roleSeed * 0.6);
      brain.enemy = seen;
      actorChest(seen, brain.lastSeenPos);
      brain.lastSeenAt = time;
    } else if (brain.enemy && time - brain.lastSeenAt > 2.6) {
      brain.enemy = null;
    }
    // Hearing: a recent enemy shot nearby pulls a defender off their angle to
    // investigate.
    if (!brain.enemy && match.phase === 'live') {
      for (const shot of ctx.noise) {
        if (shot.team === bot.team || time - shot.time > 1.4) continue;
        if (shot.pos.distanceTo(body.position) < 19) {
          brain.investigatePos = shot.pos.clone();
          brain.investigateUntil = time + 3.2;
        }
      }
    }
  }

  // --- Decide the goal -----------------------------------------------------------
  let wishX = 0;
  let wishZ = 0;
  let speed = bot.loadout.weapons[bot.loadout.currentId].def.moveSpeed;
  let crouch = 0;
  const channeling = match.channel && match.channel.actor === bot;
  const phase = match.phase;

  if (channeling || phase === 'buy' || phase === 'end' || phase === 'matchEnd') {
    // Stand still: channelling, or waiting for the round to open or close.
  } else if (brain.enemy && time - brain.lastSeenAt < 0.4) {
    // Fight in place: strafe in short bursts, sometimes drop to a crouch.
    if (time > brain.strafeUntil) {
      brain.strafeDir = Math.random() > 0.5 ? 1 : -1;
      brain.strafeUntil = time + 0.45 + Math.random() * 0.6;
    }
    const rightX = Math.cos(body.yaw);
    const rightZ = -Math.sin(body.yaw);
    wishX = rightX * brain.strafeDir * 0.8;
    wishZ = rightZ * brain.strafeDir * 0.8;
    speed *= 0.62;
    crouch = time < brain.crouchUntil ? 1 : 0;
    if (Math.random() < dt * 0.5) brain.crouchUntil = time + 0.7;
  } else {
    let goal = null;
    if (phase === 'planted') {
      if (bot.team === match.attackingTeam) {
        const site = world.sites.find((s) => s.id === match.plantedSite);
        goal = new THREE.Vector3(site.center.x + (bot.index - 1.5) * 2.4, 0, site.center.z + (bot.index % 2 ? 3 : -3));
        if (body.position.distanceTo(goal) < 2.2) goal = null; // arrived: hold and watch
      } else {
        goal = match.corePos;
        if (body.position.distanceTo(match.corePos) < 1.7) {
          ctx.startChannel(bot, 'defuse');
          goal = null;
        }
      }
    } else if (bot.hasCore) {
      const site = world.sites.find((s) => s.id === brain.assignedSite);
      goal = site.center;
      if (body.position.distanceTo(site.center) < site.radius * 0.8) {
        ctx.startChannel(bot, 'plant');
        goal = null;
      }
    } else if (match.coreState === 'dropped' && bot.team === match.attackingTeam) {
      goal = match.corePos;
    } else if (time < brain.investigateUntil && brain.investigatePos) {
      goal = brain.investigatePos;
    } else if (brain.enemy) {
      goal = brain.lastSeenPos; // hunt the last known position
    } else if (bot.team === match.attackingTeam) {
      const site = world.sites.find((s) => s.id === brain.assignedSite);
      goal = new THREE.Vector3(site.center.x - 6, 0, site.center.z + (bot.index - 1.5) * 2);
    } else {
      goal = (Math.floor(time / 9) + bot.index) % 2 === 0 ? brain.holdPos : brain.holdAlt;
      if (goal && body.position.distanceTo(goal) < 0.8) goal = null; // on post: hold the angle
    }

    if (goal) {
      setGoal(bot, world, goal);
      const path = brain.path;
      let target = goal;
      if (brain.pathIdx < path.length) target = world.nodes[path[brain.pathIdx]].pos;
      dirScratch.set(target.x - body.position.x, 0, target.z - body.position.z);
      const dist = dirScratch.length();
      if (dist < 0.75 && brain.pathIdx < path.length) {
        brain.pathIdx += 1;
      } else if (dist > 0.01) {
        dirScratch.multiplyScalar(1 / dist);
        wishX = dirScratch.x;
        wishZ = dirScratch.z;
        // Face the walk direction unless a recent enemy holds attention.
        if (time - brain.lastSeenAt > 1.2) {
          const targetYaw = Math.atan2(-dirScratch.x, -dirScratch.z);
          body.yaw = turnToward(body.yaw, targetYaw, dt * 7);
        }
      }
    } else if (bot.team !== match.attackingTeam && brain.holdPos) {
      // Holding: face the likeliest entry — toward mid-yard from the site — with
      // a slow scan either side of it.
      const targetYaw = Math.atan2(-(0 - body.position.x), -(0 - body.position.z));
      body.yaw = turnToward(body.yaw, targetYaw + Math.sin(time * 0.4 + bot.index * 2) * 0.35, dt * 3);
    }
  }

  // --- Aim and fire ----------------------------------------------------------------
  if (brain.enemy && brain.enemy.alive && time >= brain.reactionAt && time >= brain.pauseUntil && !channeling) {
    const enemy = brain.enemy;
    actorChest(enemy, chestScratch);
    if (enemy === ctx.playerActor && Math.random() < 0.22) actorHead(enemy, chestScratch);
    else if (Math.random() < 0.18) actorHead(enemy, chestScratch);
    botEye(bot, eyeScratch);
    dirScratch.subVectors(chestScratch, eyeScratch);
    const dist = dirScratch.length();
    const targetYaw = Math.atan2(-dirScratch.x, -dirScratch.z);
    const targetPitch = Math.asin(THREE.MathUtils.clamp(dirScratch.y / Math.max(dist, 0.001), -1, 1));
    body.yaw = turnToward(body.yaw, targetYaw, dt * 11);
    body.pitch = turnToward(body.pitch, targetPitch, dt * 11);
    if (Math.abs(angleDelta(body.yaw, targetYaw)) < 0.06) {
      if (brain.burstLeft <= 0) {
        const weapon = bot.loadout.weapons[bot.loadout.currentId];
        brain.burstLeft = weapon.def.auto ? 3 + Math.floor(Math.random() * 4) : 1;
        brain.aimError = BOTS.aimErrorBase * (0.7 + Math.random() * 0.7);
      }
      if (ctx.tryFire(bot)) {
        brain.burstLeft -= 1;
        if (brain.burstLeft <= 0) brain.pauseUntil = time + BOTS.burstPause * (0.7 + Math.random() * 0.8);
      }
    }
  }

  // Reload when dry, or when low and not mid-fight.
  const weapon = bot.loadout.weapons[bot.loadout.currentId];
  if (!weapon.reloading && weapon.mag === 0) ctx.requestReload(bot);
  else if (!weapon.reloading && !brain.enemy && weapon.mag < weapon.def.mag * 0.35 && weapon.reserve > 0) ctx.requestReload(bot);

  stepBody(body, world.colliders, dt, wishX, wishZ, speed, crouch, false);
}

export function turnToward(current, target, maxStep) {
  const delta = angleDelta(current, target);
  if (Math.abs(delta) <= maxStep) return target;
  return current + Math.sign(delta) * maxStep;
}

export function angleDelta(a, b) {
  let delta = (b - a) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}
