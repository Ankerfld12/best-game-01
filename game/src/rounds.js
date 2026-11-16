// rounds.js — the match itself: phases, the clock, the Spark Core objective, the
// economy and the score. This module owns all match state in one object and never
// touches three.js; it emits events (round start, ignite, kill credit, round end)
// that main.js turns into HUD, sound and bot orders. Rules: first to 7, at most
// 12 rounds, sides swap after round 6 — the Kindlers attack the first half, the
// Wardens the second. A round is won by elimination, by detonating or quenching
// the Core, or (for the defence) by running out the clock.
import { ECONOMY, ROUNDS } from './config.js';

export function createMatch(random) {
  return {
    phase: 'buy', // buy | live | planted | end | matchEnd
    phaseTime: ROUNDS.buyTime,
    round: 1,
    score: { kindler: 0, warden: 0 },
    attackingTeam: 'kindler',
    planSite: 'A',
    money: ECONOMY.startMoney, // the player's purse; bots run on a team tier below
    lossStreak: 0,
    coreState: 'carried', // carried | dropped | planted | done
    coreCarrier: null, // the actor holding the Core while it is carried
    corePos: null, // plain {x, y, z} once the Core is dropped or planted
    plantedSite: null,
    coreTimer: 0,
    channel: null, // { actor, kind: 'plant'|'defuse', progress, needed }
    lastRound: null, // { winner, reason, playerEarned } for the end-of-round panel
    matchWinner: null,
    botTier: { kindler: 0, warden: 0 }, // 0 eco, 1 half-buy, 2 full-buy; set at round start
    events: [],
  };
}

function emit(match, event) {
  match.events.push(event);
}

export function drainEvents(match) {
  const out = match.events;
  match.events = [];
  return out;
}

// Which bot loadout tier a team fields this round, from the score and the round
// number: the pistol round (and the first round after the swap) is eco by rule;
// later rounds scale with wins, so the losing side stays armed often enough to
// keep rounds honest.
function botTierFor(match, team) {
  if (match.round === 1 || match.round === ROUNDS.halfAt + 1) return 0;
  const wins = match.score[team];
  const losses = match.score[team === 'kindler' ? 'warden' : 'kindler'];
  if (wins >= losses) return 2;
  return match.round % 3 === 0 ? 1 : 2;
}

export function startRound(match, actors, random) {
  match.attackingTeam = match.round <= ROUNDS.halfAt ? 'kindler' : 'warden';
  match.planSite = random() > 0.5 ? 'A' : 'B';
  match.phase = 'buy';
  match.phaseTime = ROUNDS.buyTime;
  match.coreState = 'carried';
  match.corePos = null;
  match.plantedSite = null;
  match.coreTimer = 0;
  match.channel = null;
  match.botTier.kindler = botTierFor(match, 'kindler');
  match.botTier.warden = botTierFor(match, 'warden');
  // The Core goes to a random living attacker each round.
  const attackers = actors.filter((a) => a.team === match.attackingTeam && a.alive);
  const carrier = attackers[Math.floor(random() * attackers.length)] ?? null;
  match.coreCarrier = carrier;
  if (carrier) carrier.hasCore = true;
  emit(match, { type: 'roundStart', round: match.round, attackingTeam: match.attackingTeam });
}

export function startChannel(match, actor, kind) {
  if (match.channel) return false;
  if (kind === 'plant') {
    if (match.phase !== 'live' || match.coreState !== 'carried' || match.coreCarrier !== actor) return false;
    match.channel = { actor, kind, progress: 0, needed: ROUNDS.plantTime };
  } else {
    if (match.phase !== 'planted' || actor.team === match.attackingTeam) return false;
    const needed = actor.loadout && actor.loadout.kit ? ROUNDS.defuseTimeKit : ROUNDS.defuseTime;
    match.channel = { actor, kind, progress: 0, needed };
  }
  emit(match, { type: 'channelStart', kind, actor });
  return true;
}

export function cancelChannel(match, reason) {
  if (!match.channel) return;
  emit(match, { type: 'channelCancel', kind: match.channel.kind, actor: match.channel.actor, reason });
  match.channel = null;
}

function endRound(match, winner, reason) {
  match.phase = 'end';
  match.phaseTime = ROUNDS.endTime;
  match.score[winner] += 1;
  match.channel = null;
  const playerTeam = 'kindler';
  const playerWon = winner === playerTeam;
  let earned = 0;
  if (playerWon) {
    earned = ECONOMY.winReward;
    match.lossStreak = 0;
  } else {
    match.lossStreak = Math.min(2, match.lossStreak + 1);
    earned = ECONOMY.lossReward + (match.lossStreak - 1) * ECONOMY.lossStreakStep;
  }
  match.money = Math.min(ECONOMY.maxMoney, match.money + earned);
  match.lastRound = { winner, reason, playerEarned: earned };
  emit(match, { type: 'roundEnd', winner, reason, playerEarned: earned });
  if (match.score.kindler >= ROUNDS.winTarget || match.score.warden >= ROUNDS.winTarget || match.round >= ROUNDS.maxRounds) {
    match.matchWinner = match.score.kindler === match.score.warden
      ? winner
      : (match.score.kindler > match.score.warden ? 'kindler' : 'warden');
  }
}

// Called by main.js whenever an actor dies, so elimination and the Core drop are
// judged in one place.
export function onActorDeath(match, victim, killer) {
  if (killer && killer.kind === 'player') {
    match.money = Math.min(ECONOMY.maxMoney, match.money + ECONOMY.killReward);
  }
  if (match.coreCarrier === victim) {
    victim.hasCore = false;
    match.coreCarrier = null;
    match.coreState = 'dropped';
    match.corePos = { x: victim.body.position.x, y: 0.4, z: victim.body.position.z };
    emit(match, { type: 'coreDropped', pos: match.corePos });
  }
  if (match.channel && match.channel.actor === victim) cancelChannel(match, 'death');
}

export function onCorePickup(match, actor) {
  if (match.coreState !== 'dropped' || actor.team !== match.attackingTeam) return;
  match.coreState = 'carried';
  match.coreCarrier = actor;
  actor.hasCore = true;
  emit(match, { type: 'corePickup', actor });
}

function aliveCount(actors, team) {
  let count = 0;
  for (const actor of actors) if (actor.team === team && actor.alive) count += 1;
  return count;
}

// Advance the match by one fixed step. actors is every combatant, player included.
export function stepMatch(match, dt, actors, world) {
  match.phaseTime -= dt;

  // A channel only progresses while its actor stands still and alive, inside the
  // objective area; moving, dying or stepping out cancels it.
  if (match.channel) {
    const channel = match.channel;
    const actor = channel.actor;
    const speed = Math.hypot(actor.body.velocity.x, actor.body.velocity.z);
    let inPlace = speed < 0.6 && actor.alive;
    if (inPlace && channel.kind === 'plant') {
      // Igniting works in whichever site the carrier is standing in — bots prefer
      // their assigned site, the player chooses freely.
      const site = world.sites.find((s) => s.id === currentSiteId(actor, world));
      inPlace = Boolean(site) && actor.body.position.distanceTo(site.center) < site.radius;
    }
    if (inPlace && channel.kind === 'defuse') {
      inPlace = Boolean(match.corePos) && Math.hypot(actor.body.position.x - match.corePos.x, actor.body.position.z - match.corePos.z) < 1.9;
    }
    if (!inPlace) cancelChannel(match, 'moved');
    else {
      channel.progress += dt;
      if (channel.progress >= channel.needed) {
        match.channel = null;
        if (channel.kind === 'plant') {
          match.coreState = 'planted';
          match.plantedSite = currentSiteId(actor, world);
          match.corePos = { x: actor.body.position.x, y: 0.35, z: actor.body.position.z };
          match.coreTimer = ROUNDS.coreFuse;
          match.phase = 'planted';
          actor.hasCore = false;
          match.coreCarrier = null;
          if (actor.kind === 'player') {
            match.money = Math.min(ECONOMY.maxMoney, match.money + ECONOMY.plantReward);
          }
          emit(match, { type: 'planted', site: match.plantedSite, actor });
        } else {
          match.coreState = 'done';
          emit(match, { type: 'defused', actor });
          endRound(match, actor.team, 'The Core was quenched');
        }
      }
    }
  }

  if (match.phase === 'buy') {
    if (match.phaseTime <= 0) {
      match.phase = 'live';
      match.phaseTime = ROUNDS.roundTime;
      emit(match, { type: 'live' });
    }
    return;
  }

  if (match.phase === 'live' || match.phase === 'planted') {
    const kindlers = aliveCount(actors, 'kindler');
    const wardens = aliveCount(actors, 'warden');
    if (match.phase === 'live') {
      // Elimination ends the round at once, and so does the clock (for the defence).
      if (kindlers === 0) return endRound(match, 'warden', 'Kindlers eliminated');
      if (wardens === 0) return endRound(match, 'kindler', 'Wardens eliminated');
      if (match.phaseTime <= 0) {
        const defender = match.attackingTeam === 'kindler' ? 'warden' : 'kindler';
        return endRound(match, defender, 'Time expired — the yard holds');
      }
    } else {
      // Planted: elimination no longer ends the round. The defence must quench the
      // Core before the fuse runs out, even with every attacker already down. Only
      // when every defender is dead is detonation certain, and the round ends then.
      match.coreTimer -= dt;
      const defendersAlive = match.attackingTeam === 'kindler' ? wardens : kindlers;
      if (defendersAlive === 0 || match.coreTimer <= 0) {
        match.coreState = 'done';
        emit(match, { type: 'detonated', site: match.plantedSite });
        return endRound(match, match.attackingTeam, 'The Core detonated');
      }
    }
    return;
  }

  if (match.phase === 'end') {
    if (match.phaseTime <= 0) {
      if (match.matchWinner) {
        match.phase = 'matchEnd';
        emit(match, { type: 'matchEnd', winner: match.matchWinner });
      } else {
        match.round += 1;
        emit(match, { type: 'nextRound', round: match.round });
      }
    }
  }
}

function currentSiteId(actor, world) {
  let best = null;
  let bestDist = Infinity;
  for (const site of world.sites) {
    const dist = actor.body.position.distanceTo(site.center);
    if (dist < bestDist) { bestDist = dist; best = site.id; }
  }
  return best;
}
