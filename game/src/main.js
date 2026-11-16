// main.js — EMBERFALL: Cinder Yard. Boot, the fixed-step simulation loop, and the
// one place where the modules meet: world (the map), physics (bodies), weapons
// (gunplay rules), bots (brains), rounds (match state), hud, effects and audio.
// Shooting is resolved here so the player and every bot fire through the identical
// hitscan: a ray against the map's boxes and against each body's capsule and head
// sphere, using the shared spread/recoil/falloff rules from weapons.js. The
// simulation steps at a fixed 60 Hz; rendering only draws it.
//
// Query modes: ?shot=duel|lane|site|buy|title|end poses a deterministic scene
// for screenshots and sets window.__shotReady once it is painted; ?demo=1 hands the
// player's body to a bot brain so a full match plays itself, and exposes
// window.__EMBER.state() / __EMBER.advance(seconds) for hands-free verification.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createInput } from './input.js';
import { createAudio } from './audio.js';
import { createWorld } from './world.js';
import { createBody, stepBody, eyeHeight, rayVsWalls } from './physics.js';
import {
  createLoadout, currentWeapon, giveWeapon, switchWeapon, shotSpread, damageAt,
  createViewmodel, createGrenades,
} from './weapons.js';
import { createEffects } from './effects.js';
import { createBot, resetBot, syncBotMesh, stepBot, startBotRound, botEye, actorChest, actorHead } from './bots.js';
import {
  createMatch, startRound, stepMatch, drainEvents, startChannel, onActorDeath, onCorePickup,
} from './rounds.js';
import { createHud } from './hud.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shotMode = params.get('shot');
const demoMode = params.get('demo') === '1';
const seed = Number.parseInt(params.get('seed') ?? '7', 10) || 7;

// A small seeded RNG: shot poses and demo matches are reproducible per seed.
function mulberry32(initial) {
  let a = initial;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = mulberry32(seed);

// --- Renderer, scene, camera ------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 160);
scene.add(camera);

const world = createWorld(scene);
const audio = createAudio();
const effects = createEffects(scene);
const grenades = createGrenades(scene);

// --- Actors -------------------------------------------------------------------------
// The player is a plain actor object with the same shape as a bot, plus a brain
// that only the demo mode uses.
function freshBrain() {
  return {
    path: [], pathIdx: 0, goal: null, holdPos: null, holdAlt: null, enemy: null,
    lastSeenPos: new THREE.Vector3(), lastSeenAt: -99, reactionAt: 0, burstLeft: 0,
    pauseUntil: 0, nextThink: 0, strafeDir: 1, strafeUntil: 0, blindUntil: 0,
    crouchUntil: 0, investigateUntil: 0, aimError: 0, assignedSite: 'A', roleSeed: random(),
  };
}

const player = {
  kind: 'player', team: 'kindler', name: 'You', index: 1,
  body: createBody(-32.5, 0), health: 100, alive: true,
  armor: false, helmet: false, loadout: createLoadout(), hasCore: false,
  brain: freshBrain(), fallT: 0,
};
const bots = [];
{
  const kindlerNames = ['Pico', 'Sable', 'Rook'];
  kindlerNames.forEach((name, i) => bots.push(createBot(scene, 'kindler', name, i + 2)));
  ['Vex', 'Hollis', 'Maren', 'Odo'].forEach((name, i) => bots.push(createBot(scene, 'warden', name, i)));
}
const actors = [player, ...bots];

// --- Match state ----------------------------------------------------------------------
let match = createMatch(random);
let time = 0;
let started = false;
let playerDiedLastRound = false;
let buyHandledRound = 0;
let demoBoughtRound = 0;
let channelBeepAt = 0;
let coreTickAt = 0;
const noise = []; // { pos, time, team } — gunshots the bots can hear
const revealedUntil = new Map(); // actor -> time, for the radar

// The Spark Core prop: a dark canister with a glowing heart, carried, dropped or
// planted as the match state dictates.
const coreGroup = new THREE.Group();
{
  const canister = new THREE.Mesh(
    new THREE.CylinderGeometry(0.24, 0.28, 0.52, 12),
    new THREE.MeshStandardMaterial({ color: 0x2c3138, roughness: 0.4, metalness: 0.7 }),
  );
  canister.position.y = 0.26;
  const heart = new THREE.Mesh(
    new THREE.SphereGeometry(0.15, 12, 10),
    new THREE.MeshStandardMaterial({ color: 0x2a1503, emissive: PALETTE.ember, emissiveIntensity: 2.6 }),
  );
  heart.position.y = 0.62;
  heart.name = 'heart';
  const light = new THREE.PointLight(PALETTE.ember, 7, 9, 1.8);
  light.position.y = 0.7;
  coreGroup.add(canister, heart, light);
  scene.add(coreGroup);
}

// --- HUD and input ----------------------------------------------------------------------
const hud = createHud({
  onBuy: (item) => buyItem(item),
  onPlay: () => { audio.unlock(); input.requestLock(); },
  onAgain: () => restartMatch(),
});
const input = createInput(renderer.domElement, (locked) => {
  if (shotMode) return;
  if (locked) {
    started = true;
    hud.hideOverlay();
    hud.hideRoundEnd();
  } else if (started && match.phase !== 'matchEnd' && player.alive) {
    hud.showPause();
  }
});

// --- Viewmodel ----------------------------------------------------------------------------
let viewGroup = null;
let viewFlash = null;
let viewFlashUntil = 0;
let kick = 0;
let recoilPitch = 0;
let ads01 = 0;
let bobPhase = 0;

function rebuildViewmodel() {
  if (viewGroup) camera.remove(viewGroup);
  viewGroup = createViewmodel(player.loadout.currentId);
  viewFlash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.3, 0.3),
    new THREE.MeshBasicMaterial({ color: 0xffd9a0, transparent: true, opacity: 0, side: THREE.DoubleSide, depthTest: false }),
  );
  const zByWeapon = { spark: -0.3, wasp: -0.6, scatter: -0.54, longbow: -0.74, needle: -0.9 };
  viewFlash.position.set(0, 0.02, zByWeapon[player.loadout.currentId] ?? -0.5);
  viewGroup.add(viewFlash);
  camera.add(viewGroup);
}
rebuildViewmodel();

// --- Combat ---------------------------------------------------------------------------------
// Scratch vectors, reused by every shot: the firing path allocates nothing per pellet
// except the cloned ray direction.
const sOrigin = new THREE.Vector3();
const sDir = new THREE.Vector3();
const sRight = new THREE.Vector3();
const sUp = new THREE.Vector3();
const sPoint = new THREE.Vector3();
const sHead = new THREE.Vector3();
const sSegA = new THREE.Vector3();
const sSegB = new THREE.Vector3();
const sTmp = new THREE.Vector3();
const sTmp2 = new THREE.Vector3();
const sMuzzle = new THREE.Vector3();

function actorEye(actor, out) {
  if (actor.kind === 'bot') return botEye(actor, out);
  return out.set(actor.body.position.x, actor.body.position.y + eyeHeight(actor.body), actor.body.position.z);
}

function aimDirection(actor, out) {
  const yaw = actor.body.yaw;
  const pitch = actor.body.pitch + (actor === player ? recoilPitch : 0);
  out.set(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
  return out;
}

// Ray vs an actor's head sphere and body capsule. Returns { t, part } or null.
function rayVsActor(origin, dir, actor) {
  let best = null;
  actorHead(actor, sHead);
  sTmp.subVectors(sHead, origin);
  const tca = sTmp.dot(dir);
  if (tca > 0) {
    const d2 = sTmp.lengthSq() - tca * tca;
    const r2 = 0.21 * 0.21;
    if (d2 < r2) best = { t: tca - Math.sqrt(r2 - d2), part: 'head' };
  }
  // Capsule: the closest approach between the ray and the spine segment.
  const topY = actor.body.position.y + THREE.MathUtils.lerp(1.38, 0.98, actor.body.crouch01);
  sSegA.set(actor.body.position.x, actor.body.position.y + 0.22, actor.body.position.z);
  sSegB.set(actor.body.position.x, topY, actor.body.position.z);
  sTmp.subVectors(sSegB, sSegA); // segment axis (vertical)
  sTmp2.subVectors(sSegA, origin);
  const segLen2 = sTmp.lengthSq();
  const b = sTmp.dot(dir);
  const c = sTmp.dot(sTmp2);
  const d = dir.dot(sTmp2);
  const denom = segLen2 - b * b;
  let s = denom > 1e-8 ? (b * d - c) / denom : 0;
  s = THREE.MathUtils.clamp(s, 0, 1);
  const tRay = Math.max(0, b * s + d);
  const closestRay = sPoint.copy(dir).multiplyScalar(tRay).add(origin);
  const closestSeg = sTmp.multiplyScalar(s).add(sSegA);
  const dist = closestRay.distanceTo(closestSeg);
  if (dist < 0.37 && (!best || tRay < best.t)) best = { t: tRay, part: 'body' };
  return best;
}

// The one firing path for player and bots alike. Returns true when a round actually
// left the barrel, so bot burst counters and the player's semi-auto feel stay honest.
function tryFire(actor) {
  const weapon = currentWeapon(actor.loadout);
  const def = weapon.def;
  if (!actor.alive || weapon.reloading || weapon.cooldown > 0) return false;
  if (match.phase !== 'live' && match.phase !== 'planted') return false;
  if (weapon.mag <= 0) {
    if (actor === player) audio.dryFire();
    return false;
  }
  weapon.mag -= 1;
  weapon.cooldown = 60 / def.rpm;
  weapon.bloom = Math.min(1, weapon.bloom + 0.16);
  weapon.lastShotAt = time;

  actorEye(actor, sOrigin);
  aimDirection(actor, sDir);
  const speed = Math.hypot(actor.body.velocity.x, actor.body.velocity.z);
  const spread = shotSpread(weapon, {
    speed,
    onGround: actor.body.onGround,
    crouched: actor.body.crouch01 > 0.6,
    aiming: actor === player && input.state.aiming,
  }) + (actor.kind === 'bot' ? actor.brain.aimError : 0);
  sRight.set(Math.cos(actor.body.yaw), 0, -Math.sin(actor.body.yaw));
  sUp.crossVectors(sRight, sDir).normalize();

  // The muzzle point gets its own scratch vector: rayVsActor reuses the shared
  // temporaries, so the muzzle must not live in one of them.
  const muzzle = sMuzzle.copy(sDir).multiplyScalar(0.55).add(sOrigin);
  muzzle.y -= 0.08;
  effects.muzzle(muzzle, actor.body.yaw, actor.body.pitch);
  if (actor === player) {
    viewFlashUntil = time + 0.045;
    kick = Math.min(1, kick + def.recoil * 22);
    recoilPitch += def.recoil * (0.75 + random() * 0.4);
    player.body.pitch += def.recoil * 0.35;
    player.body.yaw += (random() * 2 - 1) * def.recoil * 0.25;
  }
  audio.shot(def.id, actor !== player && sOrigin.distanceTo(player.body.position) > 14);
  noise.push({ pos: actor.body.position.clone(), time, team: actor.team });
  revealedUntil.set(actor, time + 2.5);

  for (let pellet = 0; pellet < def.pellets; pellet += 1) {
    const dir = sDir.clone();
    dir.addScaledVector(sRight, (random() * 2 - 1) * spread);
    dir.addScaledVector(sUp, (random() * 2 - 1) * spread);
    dir.normalize();
    const wallDist = rayVsWalls(sOrigin, dir, world.colliders, 90);
    let bestHit = null;
    for (const target of actors) {
      if (target === actor || !target.alive || target.team === actor.team) continue;
      const hit = rayVsActor(sOrigin, dir, target);
      if (hit && hit.t < wallDist && (!bestHit || hit.t < bestHit.t)) bestHit = { ...hit, target };
    }
    const endDist = bestHit ? bestHit.t : wallDist;
    sPoint.copy(dir).multiplyScalar(endDist).add(sOrigin);
    effects.tracer(muzzle, sPoint, def.tracer);
    if (bestHit) {
      const damage = damageAt(def, bestHit.t, bestHit.part, bestHit.target);
      effects.burst(sPoint, 0xd84f35, bestHit.part === 'head' ? 7 : 5, 2.2);
      applyDamage(bestHit.target, damage, actor, def, bestHit.part);
    } else if (wallDist < 90) {
      effects.burst(sPoint, 0xb9bdc2, 3, 1.8);
    }
  }
  if (actor === player) refreshAmmoHud();
  return true;
}

function applyDamage(target, damage, attacker, def, part) {
  if (!target.alive) return;
  target.health -= damage;
  if (target === player) {
    hud.hurtFlash();
    audio.hurt();
  }
  if (attacker === player && target.alive) {
    hud.hitmarker(false);
    audio.hit(part === 'head');
  }
  if (target.health <= 0) {
    target.health = 0;
    target.alive = false;
    if (target === player) playerDiedLastRound = true;
    onActorDeath(match, target, attacker);
    const headTag = part === 'head' ? ' ⌖' : '';
    hud.killfeed(`${nameSpan(attacker)} <span class="wpn">▸ ${def.name}${headTag} ▸</span> ${nameSpan(target)}`);
    if (attacker === player) {
      hud.hitmarker(true);
      audio.kill();
    }
    if (target === player) hud.banner('You are down', 'Spectating your crew — the round plays out', '', 2600);
  }
}

function nameSpan(actor) {
  const cls = actor.team === 'kindler' ? 'k' : 'w';
  return `<span class="${cls}">${actor.name}</span>`;
}

function requestReload(actor) {
  const weapon = currentWeapon(actor.loadout);
  if (weapon.reloading || weapon.mag >= weapon.def.mag || weapon.reserve <= 0) return;
  weapon.reloading = true;
  weapon.reloadDoneAt = time + weapon.def.reloadTime;
  if (actor === player) audio.reloadStart();
}

function finishReload(actor) {
  const weapon = currentWeapon(actor.loadout);
  const moved = Math.min(weapon.def.mag - weapon.mag, weapon.reserve);
  weapon.mag += moved;
  weapon.reserve -= moved;
  weapon.reloading = false;
  if (actor === player) {
    audio.reloadEnd();
    refreshAmmoHud();
  }
}

// --- Economy ----------------------------------------------------------------------------------
function buyItem(item) {
  if (match.phase !== 'buy' || !player.alive) return;
  const loadout = player.loadout;
  if (match.money < item.price) { audio.denied(); return; }
  if (item.kind === 'weapon') {
    if (loadout.weapons[item.id]) return;
    match.money -= item.price;
    giveWeapon(loadout, item.id);
    rebuildViewmodel();
  } else if (item.kind === 'armor') {
    if (loadout.armor) return;
    match.money -= item.price;
    loadout.armor = true;
    loadout.helmet = true;
  } else if (item.kind === 'grenade') {
    if (item.id === 'frag') {
      if (loadout.frags >= 2) return;
      loadout.frags += 1;
    } else {
      if (loadout.flashes >= 1) return;
      loadout.flashes += 1;
    }
    match.money -= item.price;
  } else if (item.kind === 'kit') {
    if (loadout.kit || match.attackingTeam === 'kindler') return;
    match.money -= item.price;
    loadout.kit = true;
  } else {
    return;
  }
  player.armor = loadout.armor;
  player.helmet = loadout.helmet;
  audio.buy();
  hud.setMoney(match.money);
  hud.renderBuy(match, loadout);
  refreshAmmoHud();
}

function armBot(bot, tier) {
  bot.loadout = createLoadout();
  if (tier === 1) {
    giveWeapon(bot.loadout, random() > 0.5 ? 'wasp' : 'scatter');
    if (random() > 0.5) { bot.loadout.armor = true; bot.loadout.helmet = true; }
  } else if (tier >= 2) {
    giveWeapon(bot.loadout, random() > 0.35 ? 'longbow' : 'needle');
    bot.loadout.armor = true;
    bot.loadout.helmet = true;
    if (random() > 0.55) bot.loadout.frags = 1;
  }
  bot.armor = bot.loadout.armor;
  bot.helmet = bot.loadout.helmet;
}

// --- Round setup ---------------------------------------------------------------------------------
// Order matters: bodies are reset first (startRound picks the Core carrier from the
// living attackers), then rounds.js opens the round and sets the bot economy tiers,
// then bots are armed from those tiers and given their orders.
function beginRound() {
  const spawns = world.spawns;
  player.body.position.set(spawns.kindler[1][0], 0, spawns.kindler[1][1]);
  player.body.velocity.set(0, 0, 0);
  player.body.yaw = -Math.PI / 2;
  player.body.pitch = 0;
  player.body.crouch01 = 0;
  player.health = 100;
  player.alive = true;
  player.hasCore = false;
  if (playerDiedLastRound) {
    player.loadout = createLoadout();
    playerDiedLastRound = false;
  }
  player.armor = player.loadout.armor;
  player.helmet = player.loadout.helmet;
  rebuildViewmodel();

  const kindlerSpawns = [spawns.kindler[0], spawns.kindler[2], spawns.kindler[3]];
  let ki = 0;
  for (const bot of bots) {
    if (bot.team === 'kindler') {
      resetBot(bot, kindlerSpawns[ki % kindlerSpawns.length], -Math.PI / 2);
      ki += 1;
    } else {
      resetBot(bot, spawns.warden[bot.index % spawns.warden.length], Math.PI / 2);
    }
  }
  startRound(match, actors, random);
  for (const bot of bots) {
    armBot(bot, match.botTier[bot.team]);
    startBotRound(bot, match);
  }
  if (demoMode) startBotRound(player, match); // the demo brain needs its orders too
  noise.length = 0;
  revealedUntil.clear();
  buyHandledRound = 0;
  demoBoughtRound = 0;
  refreshAllHud();
}

function restartMatch() {
  match = createMatch(random);
  player.loadout = createLoadout();
  playerDiedLastRound = false;
  hud.hideMatchEnd();
  hud.hideRoundEnd();
  beginRound();
  hud.banner('New match', 'First to 7 — the yard resets', '', 2000);
}

// --- HUD refresh -----------------------------------------------------------------------------------
function refreshAmmoHud() {
  const weapon = currentWeapon(player.loadout);
  hud.setAmmo(weapon.mag, weapon.reserve, weapon.def.name, player.loadout.frags, player.loadout.flashes);
  hud.setWeaponsOwned(player.loadout, player.loadout.currentId);
}

function refreshAllHud() {
  hud.setHealth(player.health, player.loadout.armor);
  hud.setMoney(match.money);
  refreshAmmoHud();
  hud.setScore(match, aliveCount('kindler'), aliveCount('warden'));
  hud.setClock(match);
  updateObjective();
}

function aliveCount(team) {
  let count = 0;
  for (const actor of actors) if (actor.team === team && actor.alive) count += 1;
  return count;
}

function updateObjective() {
  const attacking = match.attackingTeam === 'kindler';
  let html;
  if (match.phase === 'buy') {
    html = attacking
      ? 'Buy phase — <b>B</b> for gear. Your crew ignites this round'
      : 'Buy phase — <b>B</b> for gear. Your crew defends this round';
  } else if (match.phase === 'planted') {
    html = attacking
      ? `Core burning at <b>Site ${match.plantedSite}</b> — guard the burn`
      : `Core burning at <b>Site ${match.plantedSite}</b> — quench it: hold <b>E</b> beside it`;
  } else if (match.phase === 'live') {
    if (attacking) {
      if (player.hasCore) html = 'You carry the <b>Spark Core</b> — ignite it at <b>A</b> or <b>B</b> (hold <b>E</b>)';
      else if (match.coreState === 'dropped') html = 'The <b>Core is down</b> — recover it and ignite';
      else html = `Escort <b>${match.coreCarrier ? match.coreCarrier.name : 'the carrier'}</b> with the Core to a site`;
    } else {
      html = match.coreState === 'dropped'
        ? 'The <b>Core is down</b> — keep the Kindlers off it'
        : 'Hold <b>A</b> and <b>B</b> — stop the ignite';
    }
  } else {
    html = 'First to <b>7 rounds</b> takes the yard';
  }
  hud.setObjective(html);
}

// --- Match events -----------------------------------------------------------------------------------
const corePosVec = new THREE.Vector3();
let shake = 0;

function handleEvents() {
  for (const event of drainEvents(match)) {
    if (event.type === 'roundStart') {
      hud.banner(
        `Round ${match.round}`,
        match.attackingTeam === 'kindler' ? 'Kindlers ignite · Wardens hold' : 'Wardens ignite · Kindlers hold',
        '',
        1900,
      );
      if (started && !demoMode && !shotMode && player.alive) hud.showBuy(match, player.loadout);
      updateObjective();
    } else if (event.type === 'live') {
      hud.hideBuy();
      hud.banner('Round live', '', '', 800);
    } else if (event.type === 'planted') {
      hud.banner(`Core ignited — Site ${event.site}`, match.attackingTeam === 'kindler' ? 'Guard the burn' : 'Quench it before it blows', 'ember', 2300);
      audio.plantBeep(true);
      updateObjective();
    } else if (event.type === 'detonated') {
      if (match.corePos) {
        corePosVec.set(match.corePos.x, 0.6, match.corePos.z);
        effects.explosion(corePosVec, 9, PALETTE.ember);
        audio.explosion();
        shake = 1;
      }
    } else if (event.type === 'coreDropped' || event.type === 'corePickup') {
      updateObjective();
    } else if (event.type === 'roundEnd') {
      hud.hideBuy();
      hud.setChannel(null);
      if (event.winner === 'kindler') audio.roundWin();
      else audio.roundLose();
      if (started && !shotMode && !demoMode) hud.showRoundEnd(match);
      hud.setScore(match, aliveCount('kindler'), aliveCount('warden'));
    } else if (event.type === 'nextRound') {
      hud.hideRoundEnd();
      beginRound();
    } else if (event.type === 'matchEnd') {
      hud.hideRoundEnd();
      hud.showMatchEnd(match);
      if (document.pointerLockElement) document.exitPointerLock();
    }
  }
}

// --- Bot context --------------------------------------------------------------------------------------
const botCtx = {
  get time() { return time; },
  get match() { return match; },
  world,
  actors,
  noise,
  playerActor: player,
  tryFire: (actor) => tryFire(actor),
  requestReload: (actor) => requestReload(actor),
  startChannel: (actor, kind) => startChannel(match, actor, kind),
};

// --- Player step ----------------------------------------------------------------------------------------
let prevFiring = false;
let prevBuyKey = false;
let prevFragKey = false;
let prevFlashKey = false;
let stepSoundAt = 0;

function stepPlayer(dt) {
  const body = player.body;
  const look = input.takeLook();
  body.yaw -= look.x * 0.0023;
  body.pitch = THREE.MathUtils.clamp(body.pitch - look.y * 0.0023, -1.45, 1.45);
  recoilPitch = Math.max(0, recoilPitch - dt * 0.22);

  const keys = input.state.keys;
  const frozenPhase = match.phase === 'buy' || match.phase === 'end' || match.phase === 'matchEnd';
  let wishX = 0;
  let wishZ = 0;
  if (!frozenPhase) {
    const forward = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
    const strafe = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    const sin = Math.sin(body.yaw);
    const cos = Math.cos(body.yaw);
    wishX = (-sin * forward + cos * strafe);
    wishZ = (-cos * forward - sin * strafe);
    const len = Math.hypot(wishX, wishZ);
    if (len > 1) { wishX /= len; wishZ /= len; }
  }
  const weapon = currentWeapon(player.loadout);
  const crouch = (keys.has('ControlLeft') || keys.has('KeyC')) ? 1 : 0;
  let speed = weapon.def.moveSpeed;
  if (crouch) speed *= 0.55;
  if (input.state.aiming) speed *= 0.72;
  stepBody(body, world.colliders, dt, wishX, wishZ, speed, crouch, keys.has('Space'));

  // Footsteps.
  const horizontal = Math.hypot(body.velocity.x, body.velocity.z);
  if (horizontal > 1.6 && body.onGround && time > stepSoundAt) {
    stepSoundAt = time + 0.37;
    audio.step();
  }

  const channeling = match.channel && match.channel.actor === player;
  // Fire: automatics hold, semi-automatics need a fresh press. No firing while
  // channelling the Core.
  if (!frozenPhase && !channeling) {
    if (input.state.firing) {
      if (weapon.def.auto || !prevFiring) {
        if (weapon.mag <= 0 && !weapon.reloading) requestReload(player);
        else tryFire(player);
      }
    }
  }
  prevFiring = input.state.firing;
  if (keys.has('KeyR')) requestReload(player);

  // Objective channel: hold E to ignite (as carrier, inside a site) or to quench
  // (as a defender, beside a planted Core).
  if (keys.has('KeyE') && !channeling) {
    if (player.hasCore && match.phase === 'live') startChannel(match, player, 'plant');
    else if (match.phase === 'planted' && match.attackingTeam !== 'kindler') startChannel(match, player, 'defuse');
  }

  // Grenades on key edges.
  const fragKey = keys.has('KeyG');
  if (fragKey && !prevFragKey) throwPlayerGrenade('frag');
  prevFragKey = fragKey;
  const flashKey = keys.has('KeyF');
  if (flashKey && !prevFlashKey) throwPlayerGrenade('flash');
  prevFlashKey = flashKey;

  // Weapon switching: digits pick from owned weapons, Q swaps to the last one,
  // the wheel cycles.
  const order = ['spark', 'wasp', 'scatter', 'longbow', 'needle'].filter((id) => player.loadout.weapons[id]);
  const digitIds = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5'];
  for (let i = 0; i < digitIds.length; i += 1) {
    if (keys.has(digitIds[i]) && order[i] && switchWeapon(player.loadout, order[i])) {
      rebuildViewmodel();
      refreshAmmoHud();
    }
  }
  if (keys.has('KeyQ') && switchWeapon(player.loadout, player.loadout.lastId)) {
    rebuildViewmodel();
    refreshAmmoHud();
  }
  const wheel = input.takeWheel();
  if (wheel !== 0 && order.length > 1) {
    const idx = order.indexOf(player.loadout.currentId);
    const next = order[(idx + wheel + order.length) % order.length];
    if (switchWeapon(player.loadout, next)) {
      rebuildViewmodel();
      refreshAmmoHud();
    }
  }

  // Buy menu toggle.
  const buyKey = keys.has('KeyB');
  if (buyKey && !prevBuyKey && match.phase === 'buy') {
    if (hud.buyOpen()) hud.hideBuy();
    else hud.showBuy(match, player.loadout);
  }
  prevBuyKey = buyKey;
}

function throwPlayerGrenade(kind) {
  if (match.phase !== 'live' && match.phase !== 'planted') return;
  const loadout = player.loadout;
  if (kind === 'frag' && loadout.frags <= 0) return;
  if (kind === 'flash' && loadout.flashes <= 0) return;
  if (kind === 'frag') loadout.frags -= 1;
  else loadout.flashes -= 1;
  actorEye(player, sOrigin);
  aimDirection(player, sDir);
  grenades.throwGrenade(kind, sOrigin, sDir, player);
  audio.throwWhoosh();
  refreshAmmoHud();
}

// Demo mode: the player's body is driven by the bot brain, and the purse spends
// itself on a sensible loadout each buy phase.
function stepDemoPlayer(dt) {
  stepBot(player, dt, botCtx);
  if (match.phase === 'buy' && demoBoughtRound !== match.round) {
    demoBoughtRound = match.round;
    const byId = (id) => ({ longbow: { kind: 'weapon', id, price: 2700 }, armor: { kind: 'armor', id: 'armor', price: 1000 }, frag: { kind: 'grenade', id: 'frag', price: 300 } })[id];
    buyItem(byId('longbow'));
    buyItem(byId('armor'));
    buyItem(byId('frag'));
  }
}

// --- Weapon timers --------------------------------------------------------------------------------------
let dt0 = 0;

function stepWeaponTimers(actor) {
  const weapon = currentWeapon(actor.loadout);
  if (weapon.cooldown > 0) weapon.cooldown -= dt0;
  if (weapon.reloading && time >= weapon.reloadDoneAt) finishReload(actor);
  if (weapon.bloom > 0 && time - (weapon.lastShotAt ?? -9) > 0.16) {
    weapon.bloom = Math.max(0, weapon.bloom - dt0 * 1.7);
  }
}

// --- Grenade resolution -----------------------------------------------------------------------------------
const FRAG_DEF = { name: 'Ember Frag' };
const burstVec = new THREE.Vector3();
const chestVec = new THREE.Vector3();

function resolveGrenadeBursts(events) {
  for (const event of events) {
    burstVec.copy(event.position);
    if (event.kind === 'frag') {
      effects.explosion(burstVec, 4, PALETTE.ember);
      audio.fragBoom();
      noise.push({ pos: burstVec.clone(), time, team: event.owner ? event.owner.team : 'kindler' });
      for (const actor of actors) {
        if (!actor.alive) continue;
        actorChest(actor, chestVec);
        const dist = chestVec.distanceTo(burstVec);
        if (dist > 4.4) continue;
        sOrigin.copy(burstVec);
        sOrigin.y += 0.25;
        if (!losClearFrag(sOrigin, chestVec)) continue;
        let damage = Math.max(14, 95 * (1 - dist / 4.4));
        if (actor.armor) damage *= 0.75;
        applyDamage(actor, damage, event.owner, FRAG_DEF, 'body');
      }
    } else {
      effects.explosion(burstVec, 2, 0xffffff);
      audio.flashPop();
      for (const actor of actors) {
        if (!actor.alive || actor === event.owner) continue;
        actorEye(actor, sOrigin);
        const dist = sOrigin.distanceTo(burstVec);
        if (dist > 24) continue;
        if (!losClearFrag(burstVec, sOrigin)) continue;
        sDir.subVectors(burstVec, sOrigin).normalize();
        const facingX = -Math.sin(actor.body.yaw);
        const facingZ = -Math.cos(actor.body.yaw);
        const dot = actor === player
          ? sDir.dot(camera.getWorldDirection(sTmp))
          : sDir.x * facingX + sDir.z * facingZ;
        if (dot < 0.25) continue;
        const strength = 1 - (dist / 24) * 0.45;
        if (actor === player) hud.blindFlash(0.92 * strength);
        else actor.brain.blindUntil = time + 3.4 * strength;
      }
    }
  }
}

const losScratchA = new THREE.Vector3();
function losClearFrag(a, b) {
  losScratchA.subVectors(b, a);
  const dist = losScratchA.length();
  losScratchA.multiplyScalar(1 / Math.max(dist, 0.001));
  return rayVsWalls(a, losScratchA, world.colliders, dist) >= dist - 0.05;
}

// --- Master fixed step -------------------------------------------------------------------------------------
function step(dt) {
  dt0 = dt;
  time += dt;
  handleEvents();
  stepMatch(match, dt, actors, world);

  for (const actor of actors) stepWeaponTimers(actor);

  if (player.alive) {
    if (demoMode) stepDemoPlayer(dt);
    else stepPlayer(dt);
  }
  for (const bot of bots) {
    if (bot.alive) {
      stepBot(bot, dt, botCtx);
      // Opportunistic frag: a bot carrying one, with a clear mid-range sighting,
      // sometimes lobs it at the enemy it can see.
      if (bot.loadout.frags > 0 && bot.brain.enemy && bot.brain.enemy.alive && match.phase === 'live') {
        const dist = bot.body.position.distanceTo(bot.brain.enemy.body.position);
        if (dist > 7 && dist < 20 && random() < dt * 0.22) {
          bot.loadout.frags -= 1;
          botEye(bot, sOrigin);
          actorChest(bot.brain.enemy, sDir);
          sDir.subVectors(sDir, sOrigin).normalize();
          grenades.throwGrenade('frag', sOrigin, sDir, bot);
          audio.throwWhoosh();
        }
      }
    }
    syncBotMesh(bot, dt);
  }

  // Core pickup: any living attacker walking over a dropped Core takes it.
  if (match.coreState === 'dropped' && match.corePos) {
    for (const actor of actors) {
      if (!actor.alive || actor.team !== match.attackingTeam) continue;
      const dx = actor.body.position.x - match.corePos.x;
      const dz = actor.body.position.z - match.corePos.z;
      if (dx * dx + dz * dz < 1.7) {
        onCorePickup(match, actor);
        break;
      }
    }
  }

  resolveGrenadeBursts(grenades.step(dt, world.colliders));
  effects.step(dt);
  hud.stepFx(dt);

  // Channel beeps, and the planted Core's quickening tick as the fuse runs down.
  if (match.channel && time > channelBeepAt) {
    channelBeepAt = time + 0.55;
    audio.plantBeep(match.channel.progress > match.channel.needed - 0.6);
  }
  if (match.phase === 'planted' && time > coreTickAt) {
    coreTickAt = time + (match.coreTimer < 8 ? 0.3 : 0.75);
    audio.coreTick();
  }
  while (noise.length > 24) noise.shift();
  hud.setHealth(player.health, player.loadout.armor);
  hud.setScore(match, aliveCount('kindler'), aliveCount('warden'));
}

// --- Camera, viewmodel, per-frame HUD -------------------------------------------------------------------------
const revealedSet = new Set();

function syncCameraAndHud(dt) {
  let eyeActor = player;
  if (!player.alive) {
    const mate = actors.find((a) => a !== player && a.team === 'kindler' && a.alive);
    if (mate) eyeActor = mate;
  }
  const body = eyeActor.body;
  let eye = eyeHeight(body);
  if (eyeActor === player && !player.alive) eye = 0.45;
  shake = Math.max(0, shake - dt * 1.6);
  const shakeAmp = shake * shake * 0.03;
  camera.position.set(
    body.position.x + (random() * 2 - 1) * shakeAmp,
    body.position.y + eye + (random() * 2 - 1) * shakeAmp,
    body.position.z,
  );
  camera.rotation.order = 'YXZ';
  camera.rotation.y = body.yaw;
  camera.rotation.x = body.pitch + (eyeActor === player ? recoilPitch : 0);
  camera.rotation.z = 0;

  // Viewmodel: only in the player's own eyes, alive, in first person.
  const showView = player.alive && eyeActor === player;
  if (viewGroup) viewGroup.visible = showView;
  if (showView) {
    const weapon = currentWeapon(player.loadout);
    ads01 += ((input.state.aiming && !demoMode ? 1 : 0) - ads01) * Math.min(1, dt * 11);
    const targetFov = THREE.MathUtils.lerp(74, weapon.def.zoomFov, ads01);
    if (Math.abs(camera.fov - targetFov) > 0.05) {
      camera.fov += (targetFov - camera.fov) * Math.min(1, dt * 12);
      camera.updateProjectionMatrix();
    }
    const speed = Math.hypot(body.velocity.x, body.velocity.z);
    bobPhase += dt * speed * 1.7;
    const bobY = Math.sin(bobPhase * 2) * 0.0075 * Math.min(1, speed / 4);
    const bobX = Math.cos(bobPhase) * 0.005 * Math.min(1, speed / 4);
    kick = Math.max(0, kick - dt * 5.5);
    let dip = 0;
    if (weapon.reloading) {
      const total = weapon.def.reloadTime;
      const done = 1 - Math.max(0, weapon.reloadDoneAt - time) / total;
      dip = Math.sin(THREE.MathUtils.clamp(done, 0, 1) * Math.PI);
    }
    viewGroup.position.set(
      THREE.MathUtils.lerp(0.24, 0, ads01) + bobX,
      THREE.MathUtils.lerp(-0.22, -0.148, ads01) + bobY - dip * 0.07,
      THREE.MathUtils.lerp(-0.42, -0.34, ads01) + kick * 0.055,
    );
    viewGroup.rotation.x = kick * 0.13 + dip * 0.75;
    if (viewFlash) {
      viewFlash.material.opacity = time < viewFlashUntil ? 0.95 : 0;
      if (time < viewFlashUntil) viewFlash.rotation.z += dt * 30;
    }
    const spread = shotSpread(weapon, {
      speed,
      onGround: body.onGround,
      crouched: body.crouch01 > 0.6,
      aiming: input.state.aiming,
    });
    hud.setCrosshairGap(4 + spread * 950);
  }

  // The Core prop follows its state: on the carrier's back, or on the ground
  // where it fell / was ignited, its heart pulsing faster as the fuse shortens.
  if (match.coreState === 'carried' && match.coreCarrier) {
    const carrier = match.coreCarrier;
    coreGroup.visible = true;
    coreGroup.position.set(
      carrier.body.position.x,
      carrier.body.position.y + 1.95 + Math.sin(time * 3) * 0.05,
      carrier.body.position.z,
    );
  } else if ((match.coreState === 'dropped' || match.coreState === 'planted') && match.corePos) {
    coreGroup.visible = true;
    coreGroup.position.set(match.corePos.x, match.corePos.y - 0.35, match.corePos.z);
    const heart = coreGroup.getObjectByName('heart');
    if (heart) {
      const rate = match.coreState === 'planted' ? (match.coreTimer < 8 ? 11 : 5) : 3;
      heart.material.emissiveIntensity = 2 + Math.sin(time * rate) * 1.3;
    }
  } else {
    coreGroup.visible = false;
  }
  // The furnace breathes.
  world.furnaceLight.intensity = 55 + Math.sin(time * 7.3) * 7 + Math.sin(time * 13.7) * 4;

  hud.setClock(match);
  if (match.channel) {
    const channel = match.channel;
    hud.setChannel(
      channel.progress / channel.needed,
      channel.kind === 'plant' ? `${channel.actor.name} · IGNITING THE CORE` : `${channel.actor.name} · QUENCHING THE CORE`,
    );
  } else {
    hud.setChannel(null);
  }
  revealedSet.clear();
  for (const actor of actors) {
    if ((revealedUntil.get(actor) ?? 0) > time) revealedSet.add(actor);
  }
  hud.drawMinimap(world, actors, player, revealedSet, match);
}

// --- Shot modes (deterministic screenshots) ---------------------------------------------------------------------
let frozen = false;

function poseBot(bot, x, z, yaw, crouch = 0) {
  bot.body.position.set(x, 0, z);
  bot.body.yaw = yaw;
  bot.body.crouch01 = crouch;
  syncBotMesh(bot, 0);
}

function runShot(name) {
  started = true;
  if (name !== 'title') hud.hideOverlay();
  hud.hideBuy();
  if (name === 'title') {
    // The start screen itself, over a live view down Mid Hall.
    match.phase = 'live';
    match.phaseTime = 88;
    giveWeapon(player.loadout, 'longbow');
    rebuildViewmodel();
    player.body.position.set(-13, 0, 0.5);
    player.body.yaw = -Math.PI / 2;
    poseBot(bots[0], -6, 3.5, -Math.PI / 2); // Pico pushes up mid with the player
    poseBot(bots[3], 14, -2, Math.PI / 2); // Vex holds the far end of the hall
    hud.showStart();
  } else if (name === 'end') {
    // The results panel over Site A: Kindlers took the yard 7–5.
    match.phase = 'matchEnd';
    match.phaseTime = 0;
    match.round = 12;
    match.score.kindler = 7;
    match.score.warden = 5;
    match.matchWinner = 'kindler';
    match.coreState = 'done';
    match.coreCarrier = null;
    giveWeapon(player.loadout, 'longbow');
    rebuildViewmodel();
    player.body.position.set(24, 0, -8);
    player.body.yaw = Math.atan2(-(29.5 - 24), -(-14 + 8));
    poseBot(bots[0], 27, -11, Math.PI * 0.75); // Pico on the taken site
    hud.showMatchEnd(match);
  } else if (name === 'buy') {
    match.money = 3400;
    hud.setMoney(match.money);
    hud.showBuy(match, player.loadout);
  } else if (name === 'lane') {
    match.phase = 'live';
    match.phaseTime = 87;
    giveWeapon(player.loadout, 'longbow');
    player.loadout.weapons.longbow.mag = 29;
    rebuildViewmodel();
    player.health = 84;
    player.body.position.set(-1, 0, -13);
    player.body.yaw = -Math.PI / 2;
    poseBot(bots[3], 9.5, -12.6, Math.PI / 2); // Vex holds the lane's far end
    poseBot(bots[0], -4.5, -9.8, -Math.PI / 2); // Pico pushes with the player
    poseBot(bots[4], 18, -13.5, Math.PI / 2, 1); // Hollis crouched behind the steel stack
    // Posed tracers instead of a live shot, so no muzzle-flash plane sits in the still.
    effects.tracer(new THREE.Vector3(-0.45, 1.54, -13), new THREE.Vector3(9.3, 1.2, -12.6), 0xffe9c4);
    effects.tracer(new THREE.Vector3(9.1, 1.5, -12.6), new THREE.Vector3(1.5, 1.1, -12.9), 0xffe2b0);
    effects.burst(new THREE.Vector3(9.3, 1.2, -12.6), 0xd84f35, 6, 2.2);
  } else if (name === 'site') {
    match.phase = 'planted';
    match.coreState = 'planted';
    match.plantedSite = 'A';
    match.coreTimer = 17.4;
    match.corePos = { x: 29.5, y: 0.35, z: -14 };
    giveWeapon(player.loadout, 'needle');
    rebuildViewmodel();
    player.body.position.set(23.8, 0, -6.8);
    const toSite = Math.atan2(-(29.5 - 23.8), -(-14 + 6.8));
    player.body.yaw = toSite;
    player.body.pitch = -0.02;
    poseBot(bots[4], 28.3, -12.4, Math.PI * 0.8, 1); // a Warden crouches on the burning Core
    poseBot(bots[1], 25.2, -10.6, -Math.PI / 2); // Sable covers the door
    hud.banner('Core ignited — Site A', 'Guard the burn', 'ember', 60000);
  } else {
    // duel: mid-hall contact — the cover shot.
    match.phase = 'live';
    match.phaseTime = 64;
    giveWeapon(player.loadout, 'longbow');
    player.loadout.weapons.longbow.mag = 29;
    rebuildViewmodel();
    player.body.position.set(1.5, 0, 1.8);
    player.body.yaw = -Math.PI / 2 + 0.16;
    player.health = 92;
    poseBot(bots[3], 10.5, -1.2, Math.PI / 2);
    poseBot(bots[5], 13, -3.6, Math.PI / 2 + 0.3);
    poseBot(bots[0], -2.5, 4.6, -Math.PI / 2);
    effects.tracer(new THREE.Vector3(2.05, 1.54, 1.65), new THREE.Vector3(10.3, 1.2, -1.2), 0xffe9c4);
    effects.tracer(new THREE.Vector3(10.1, 1.45, -1.2), new THREE.Vector3(3.6, 1.0, 0.6), 0xffe2b0);
    effects.burst(new THREE.Vector3(10.3, 1.2, -1.2), 0xd84f35, 6, 2.2);
  }
  refreshAllHud();
  frozen = true;
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCameraAndHud(0);
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 3) window.__shotReady = true;
  }
  requestAnimationFrame(paint);
}

// --- Boot and the frame loop -------------------------------------------------------------------------------------
window.__EMBER = {
  // Debug hook: run the fixed-step simulation forward without waiting for the
  // display (used by the headless checks in ?demo=1, where software rendering
  // runs below 60 fps).
  advance(seconds) {
    const steps = Math.round(seconds / FIXED_STEP);
    for (let i = 0; i < steps; i += 1) step(FIXED_STEP);
  },
  state() {
    return {
      phase: match.phase,
      round: match.round,
      score: { ...match.score },
      coreState: match.coreState,
      plantedSite: match.plantedSite,
      attackingTeam: match.attackingTeam,
      aliveKindler: aliveCount('kindler'),
      aliveWarden: aliveCount('warden'),
      playerHealth: player.health,
      playerAlive: player.alive,
      money: match.money,
      matchWinner: match.matchWinner,
      time,
    };
  },
};

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

beginRound();
for (const bot of bots) syncBotMesh(bot, 0);

let lastTime = performance.now();
let accumulator = 0;

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (shotMode) return; // runShot owns rendering in shot mode
  const simActive = !frozen && started && (input.state.locked || demoMode);
  if (simActive) {
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
  }
  syncCameraAndHud(dt);
  renderer.render(scene, camera);
}

if (shotMode) runShot(shotMode);
else {
  if (demoMode) {
    started = true;
    hud.hideOverlay();
  }
  requestAnimationFrame(frame);
}
