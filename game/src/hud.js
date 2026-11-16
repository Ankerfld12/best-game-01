// hud.js — every DOM element of the HUD: health, ammunition, money, the round
// clock and score, the killfeed, announcements, the buy menu, the channel bar,
// damage and flash overlays, and the radar minimap. It only renders the state it
// is handed; all rules live in rounds.js and main.js. The minimap is drawn from
// the world's own minimap rectangles, so the radar can never disagree with the
// map it describes.
import { BUY_ITEMS } from './config.js';

const $ = (id) => document.getElementById(id);

export function createHud({ onBuy, onPlay, onAgain }) {
  const els = {
    hpNum: $('hp-num'), hpFill: $('hp-fill'), armorNum: $('armor-num'),
    ammo: $('ammo'), ammoMag: $('ammo-mag'), ammoReserve: $('ammo-reserve'),
    weaponName: $('weapon-name'), money: $('money'), grenades: $('grenades'),
    weaponsOwned: $('weapons-owned'), timer: $('timer'), roundLabel: $('round-label'),
    scoreK: $('score-k'), scoreW: $('score-w'), aliveK: $('alive-k'), aliveW: $('alive-w'),
    objective: $('objective'), banner: $('banner'), bannerTitle: $('banner-title'), bannerSub: $('banner-sub'),
    killfeed: $('killfeed'), channel: $('channel'), channelFill: $('channel-fill'), channelLabel: $('channel-label'),
    crosshair: $('crosshair'), hitmarker: $('hitmarker'), vignette: $('vignette'), flashfx: $('flashfx'),
    overlay: $('overlay'), overlayTitle: $('overlay-title'), overlayCopy: $('overlay-copy'),
    buymenu: $('buymenu'), buyGrid: $('buy-grid'), buyTitle: $('buy-title'), buyMoney: $('buy-money'),
    roundend: $('roundend'), roundendTitle: $('roundend-title'), roundendCopy: $('roundend-copy'),
    roundendK: $('roundend-k'), roundendW: $('roundend-w'), roundendEarned: $('roundend-earned'),
    matchend: $('matchend'), matchendTitle: $('matchend-title'), matchendCopy: $('matchend-copy'),
    matchendK: $('matchend-k'), matchendW: $('matchend-w'),
    minimap: $('minimap').getContext('2d'),
  };
  let bannerTimeout = 0;
  let hitTimeout = 0;
  let vignetteLevel = 0;
  let flashLevel = 0;

  $('play').addEventListener('click', () => onPlay());
  $('again').addEventListener('click', () => onAgain());

  function fmtTime(seconds) {
    const s = Math.max(0, Math.ceil(seconds));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  return {
    els,
    onPlayClick: onPlay,

    showStart() {
      els.overlay.hidden = false;
      els.overlayTitle.innerHTML = 'EMBER<span class="fall">FALL</span>';
      els.overlayCopy.innerHTML = 'Cinder Yard, dusk. Your crew — the <b>Kindlers</b> — carries a <b>Spark Core</b> into a walled yard held by the <b>Wardens</b>. Ignite it at the <b>Furnace (A)</b> or the <b>Depot (B)</b> and guard the burn, or simply outshoot them. First to 7 rounds; sides swap at the half. Accuracy pays: stop, crouch, tap — spraying on the move throws rounds wide.';
      $('play').textContent = 'Click to play';
    },
    showPause() {
      els.overlay.hidden = false;
      els.overlayTitle.textContent = 'Paused';
      els.overlayCopy.textContent = 'The yard waits. Click to jump back in.';
      $('play').textContent = 'Resume';
    },
    hideOverlay() { els.overlay.hidden = true; },

    banner(title, sub, toneClass = '', holdMs = 2200) {
      els.bannerTitle.textContent = title;
      els.bannerTitle.className = toneClass;
      els.bannerSub.textContent = sub ?? '';
      els.banner.classList.add('on');
      window.clearTimeout(bannerTimeout);
      bannerTimeout = window.setTimeout(() => els.banner.classList.remove('on'), holdMs);
    },

    setHealth(hp, armor) {
      const shown = Math.max(0, Math.ceil(hp));
      els.hpNum.textContent = String(shown);
      els.hpNum.classList.toggle('low', shown <= 30);
      els.hpFill.style.width = `${Math.max(0, hp)}%`;
      els.hpFill.classList.toggle('low', shown <= 30);
      els.armorNum.textContent = armor ? '⬢ VEST + HELM' : '';
    },
    setAmmo(mag, reserve, weaponName, frags, flashes) {
      els.ammoMag.textContent = String(mag);
      els.ammoReserve.textContent = `/ ${reserve}`;
      els.ammo.classList.toggle('empty', mag === 0);
      els.weaponName.textContent = weaponName;
      els.grenades.textContent = `${frags > 0 ? `G · FRAG ×${frags}  ` : ''}${flashes > 0 ? `F · GLARE ×${flashes}` : ''}`;
    },
    setWeaponsOwned(loadout, currentId) {
      const names = Object.keys(loadout.weapons).map((id) => {
        const label = { spark: 'Spark', wasp: 'Wasp', scatter: 'Scatterjack', longbow: 'Longbow', needle: 'Needle' }[id];
        return id === currentId ? `<b>[${label}]</b>` : label;
      });
      els.weaponsOwned.innerHTML = names.join(' · ');
    },
    setMoney(money) { els.money.textContent = `$${money}`; },
    setScore(match, aliveK, aliveW) {
      els.scoreK.textContent = String(match.score.kindler);
      els.scoreW.textContent = String(match.score.warden);
      els.aliveK.textContent = `${aliveK} alive`;
      els.aliveW.textContent = `${aliveW} alive`;
    },
    setClock(match) {
      if (match.phase === 'planted') {
        els.timer.textContent = fmtTime(match.coreTimer);
        els.timer.className = 'planted';
        els.roundLabel.textContent = `ROUND ${match.round} · CORE BURNING AT ${match.plantedSite}`;
      } else {
        els.timer.textContent = fmtTime(match.phaseTime);
        els.timer.className = match.phaseTime <= 10 && match.phase === 'live' ? 'urgent' : '';
        const phaseName = { buy: 'BUY PHASE', live: 'ROUND LIVE', end: 'ROUND OVER', matchEnd: 'MATCH OVER' }[match.phase];
        els.roundLabel.textContent = `ROUND ${match.round} · ${phaseName}`;
      }
    },
    setObjective(html) { els.objective.innerHTML = html; },
    setCrosshairGap(px) { els.crosshair.style.setProperty('--gap', `${Math.round(px)}px`); },

    hitmarker(kill) {
      els.hitmarker.classList.add('on');
      els.hitmarker.classList.toggle('kill', kill);
      window.clearTimeout(hitTimeout);
      hitTimeout = window.setTimeout(() => els.hitmarker.classList.remove('on'), kill ? 220 : 110);
    },
    killfeed(html) {
      const row = document.createElement('div');
      row.className = 'kf';
      row.innerHTML = html;
      els.killfeed.prepend(row);
      while (els.killfeed.children.length > 5) els.killfeed.lastChild.remove();
      window.setTimeout(() => row.remove(), 4200);
    },

    setChannel(fraction, label) {
      if (fraction === null) {
        els.channel.hidden = true;
        return;
      }
      els.channel.hidden = false;
      els.channelLabel.textContent = label;
      els.channelFill.style.width = `${Math.round(fraction * 100)}%`;
    },

    hurtFlash() { vignetteLevel = 1; },
    blindFlash(amount) { flashLevel = Math.max(flashLevel, amount); },
    stepFx(dt) {
      vignetteLevel = Math.max(0, vignetteLevel - dt * 1.4);
      flashLevel = Math.max(0, flashLevel - dt * 0.55);
      els.vignette.style.opacity = String(vignetteLevel * 0.9);
      els.flashfx.style.opacity = String(flashLevel);
    },

    // --- Buy menu ---------------------------------------------------------------
    showBuy(match, loadout) {
      els.buymenu.hidden = false;
      this.renderBuy(match, loadout);
    },
    hideBuy() { els.buymenu.hidden = true; },
    buyOpen() { return !els.buymenu.hidden; },
    renderBuy(match, loadout) {
      els.buyTitle.textContent = `Buy — Round ${match.round} · ${match.attackingTeam === 'kindler' ? 'Kindlers ignite' : 'Kindlers defend'}`;
      els.buyMoney.textContent = `$${match.money}`;
      els.buyGrid.innerHTML = '';
      for (const item of BUY_ITEMS) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'buy-item';
        let owned = false;
        let disabledReason = '';
        if (item.kind === 'weapon') owned = Boolean(loadout.weapons[item.id]);
        if (item.kind === 'armor') owned = loadout.armor;
        if (item.kind === 'kit') {
          owned = loadout.kit;
          if (match.attackingTeam === 'kindler') disabledReason = 'Defence only';
        }
        if (item.kind === 'grenade') {
          const count = item.id === 'frag' ? loadout.frags : loadout.flashes;
          owned = count >= (item.id === 'frag' ? 2 : 1);
        }
        const afford = match.money >= item.price;
        button.disabled = owned || !afford || Boolean(disabledReason);
        button.innerHTML = `<span class="row"><span class="nm"><kbd>${item.key}</kbd> ${item.label}</span><span class="pr">$${item.price}</span></span>`
          + `<span class="bl">${item.blurb}</span>`
          + (owned ? ' <span class="own">OWNED</span>' : disabledReason ? ` <span class="own">${disabledReason.toUpperCase()}</span>` : !afford ? ' <span class="own">TOO EXPENSIVE</span>' : '');
        button.addEventListener('click', () => onBuy(item));
        els.buyGrid.appendChild(button);
      }
    },

    showRoundEnd(match) {
      const { winner, reason, playerEarned } = match.lastRound;
      const won = winner === 'kindler';
      els.roundendTitle.textContent = won ? 'Round won' : 'Round lost';
      els.roundendTitle.style.color = won ? 'var(--ember)' : 'var(--teal)';
      els.roundendCopy.textContent = reason;
      els.roundendK.textContent = String(match.score.kindler);
      els.roundendW.textContent = String(match.score.warden);
      els.roundendEarned.textContent = `+$${playerEarned} ${won ? 'round bonus' : 'loss bonus'} · Purse $${match.money}`;
      els.roundend.hidden = false;
    },
    hideRoundEnd() { els.roundend.hidden = true; },

    showMatchEnd(match) {
      const won = match.matchWinner === 'kindler';
      els.matchendTitle.textContent = won ? 'The yard is yours' : 'The Wardens hold the yard';
      els.matchendTitle.style.color = won ? 'var(--ember)' : 'var(--teal)';
      els.matchendCopy.textContent = won
        ? 'Seven rounds and the Cinder Yard burns Kindler orange. The crew drinks on the winnings tonight.'
        : 'The Core stays cold this time. Re-buy, re-route, and take the yard back.';
      els.matchendK.textContent = String(match.score.kindler);
      els.matchendW.textContent = String(match.score.warden);
      els.matchend.hidden = false;
    },
    hideMatchEnd() { els.matchend.hidden = true; },

    // --- Radar --------------------------------------------------------------------
    drawMinimap(world, actors, player, revealed, match) {
      const g = els.minimap;
      const W = 164;
      const H = 112;
      const sx = (x) => ((x + 37) / 74) * W;
      const sz = (z) => ((z + 25) / 50) * H;
      g.fillStyle = '#171b20';
      g.fillRect(0, 0, W, H);
      g.fillStyle = '#2c333c';
      for (const rect of world.minimapRects) g.fillRect(sx(rect.x), sz(rect.z), rect.w * (W / 74), rect.d * (H / 50));
      for (const site of world.sites) {
        g.strokeStyle = site.id === 'A' ? '#ff8c3a' : '#2fd4c4';
        g.lineWidth = 1.6;
        g.beginPath();
        g.arc(sx(site.center.x), sz(site.center.z), site.radius * (W / 74), 0, Math.PI * 2);
        g.stroke();
        g.fillStyle = g.strokeStyle;
        g.font = '700 10px system-ui';
        g.textAlign = 'center';
        g.fillText(site.id, sx(site.center.x), sz(site.center.z) + 3.5);
      }
      if (match.coreState === 'dropped' || match.coreState === 'planted') {
        g.fillStyle = '#ffc46b';
        g.fillRect(sx(match.corePos.x) - 2.5, sz(match.corePos.z) - 2.5, 5, 5);
      }
      for (const actor of actors) {
        if (!actor.alive) continue;
        const x = sx(actor.body.position.x);
        const y = sz(actor.body.position.z);
        if (actor === player) {
          g.save();
          g.translate(x, y);
          g.rotate(-player.body.yaw);
          g.fillStyle = '#ffffff';
          g.beginPath();
          g.moveTo(0, -5);
          g.lineTo(3.4, 4);
          g.lineTo(-3.4, 4);
          g.closePath();
          g.fill();
          g.restore();
        } else if (actor.team === player.team) {
          g.fillStyle = '#ff8c3a';
          g.beginPath();
          g.arc(x, y, 2.6, 0, Math.PI * 2);
          g.fill();
        } else if (revealed.has(actor)) {
          g.fillStyle = '#2fd4c4';
          g.beginPath();
          g.arc(x, y, 2.6, 0, Math.PI * 2);
          g.fill();
        }
      }
    },
  };
}
