// The HUD: every DOM readout, the buy menu, the minimap and the overlays.
// Values are cached so the DOM is only touched when something changes.
import { WEAPONS, GRENADE_DEFS, ARMOR_PRICE } from './weapons.js';
import { MAP } from './mapdata.js';
import { ROUND_PHASE, TEAMS, aliveOf } from './state.js';
import { roundTimeLeft } from './rounds.js';

function $(id) {
  return document.getElementById(id);
}

export function createHud(callbacks) {
  const el = {
    hud: $('hud'),
    crosshair: $('crosshair'),
    hitmarker: $('hitmarker'),
    health: $('health-value'),
    healthBar: $('health-bar'),
    armor: $('armor-value'),
    ammoMag: $('ammo-mag'),
    ammoReserve: $('ammo-reserve'),
    weaponName: $('weapon-name'),
    money: $('money-value'),
    timer: $('timer-value'),
    timerLabel: $('timer-label'),
    scoreV: $('score-vanguard'),
    scoreS: $('score-sentinel'),
    roundLabel: $('round-label'),
    aliveV: $('alive-vanguard'),
    aliveS: $('alive-sentinel'),
    feed: $('feed'),
    banner: $('banner'),
    bannerTitle: $('banner-title'),
    bannerSub: $('banner-sub'),
    channel: $('channel'),
    channelLabel: $('channel-label'),
    channelBar: $('channel-bar'),
    hint: $('hint'),
    vignette: $('damage-vignette'),
    damageDir: $('damage-dir'),
    buyMenu: $('buy-menu'),
    buyItems: $('buy-items'),
    buyMoney: $('buy-money'),
    scoreboard: $('scoreboard'),
    scoreRows: $('score-rows'),
    menu: $('menu'),
    matchEnd: $('match-end'),
    matchTitle: $('match-title'),
    matchSub: $('match-sub'),
    minimap: $('minimap'),
    charge: $('charge-indicator'),
    grenades: $('grenades'),
  };
  const mapCtx = el.minimap.getContext('2d');
  const last = {};
  let buyOpen = false;
  let feedCount = -1;

  function setText(key, node, value) {
    if (last[key] !== value) {
      last[key] = value;
      node.textContent = value;
    }
  }

  // --- Buy menu -------------------------------------------------------------
  const BUY_ITEMS = [
    { kind: 'weapon', id: 'k7' },
    { kind: 'weapon', id: 'ar4' },
    { kind: 'weapon', id: 'dmr' },
    { kind: 'grenade', id: 'frag' },
    { kind: 'grenade', id: 'smoke' },
    { kind: 'armor', id: 'armor' },
  ];

  function renderBuyMenu(player) {
    el.buyItems.innerHTML = '';
    BUY_ITEMS.forEach((item, index) => {
      const def = item.kind === 'weapon' ? WEAPONS[item.id]
        : item.kind === 'grenade' ? GRENADE_DEFS[item.id]
        : { name: 'Kevlar Vest', price: ARMOR_PRICE };
      const owned = item.kind === 'weapon' && (player.weapons.primary === item.id || player.weapon === item.id);
      const afford = player.money >= def.price;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'buy-item' + (owned ? ' owned' : '') + (afford && !owned ? '' : ' cant');
      button.innerHTML = `<span class="buy-key">${index + 1}</span><span class="buy-name">${def.name}</span><span class="buy-price">$${def.price}</span>`;
      button.addEventListener('click', () => callbacks.onBuy(item.kind, item.id));
      el.buyItems.appendChild(button);
    });
    setText('buyMoney', el.buyMoney, `$${player.money}`);
  }

  // --- Minimap --------------------------------------------------------------
  function drawMinimap(state, player) {
    const ctx = mapCtx;
    const W = el.minimap.width;
    const H = el.minimap.height;
    const toX = (x) => ((x - MAP.bounds.minX) / (MAP.bounds.maxX - MAP.bounds.minX)) * W;
    const toY = (z) => ((z - MAP.bounds.minZ) / (MAP.bounds.maxZ - MAP.bounds.minZ)) * H;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(20,24,30,0.72)';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(140,148,158,0.55)';
    for (const b of MAP.boxes) {
      if (b.h < 1.2) continue;
      ctx.fillRect(toX(b.x - b.w / 2), toY(b.z - b.d / 2), Math.max(1, (b.w / 64) * W), Math.max(1, (b.d / 48) * H));
    }
    for (const site of MAP.sites) {
      ctx.fillStyle = 'rgba(255,184,77,0.25)';
      ctx.fillRect(toX(site.cx - site.w / 2), toY(site.cz - site.d / 2), (site.w / 64) * W, (site.d / 48) * H);
      ctx.fillStyle = '#ffcf7d';
      ctx.font = 'bold 11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(site.id, toX(site.cx), toY(site.cz) + 4);
    }
    // Dots: teammates always, enemies only briefly after they fire.
    for (const c of state.combatants) {
      if (!c.alive) continue;
      const friendly = c.team === player.team;
      const loud = state.lastGunshot && state.lastGunshot.team === c.team && state.time - state.lastGunshot.at < 2;
      if (!friendly && !loud) continue;
      ctx.fillStyle = c.isPlayer ? '#ffffff' : friendly ? '#ffb84d' : '#ff5040';
      ctx.beginPath();
      ctx.arc(toX(c.pos.x), toY(c.pos.z), c.isPlayer ? 4 : 3, 0, Math.PI * 2);
      ctx.fill();
      if (c.isPlayer) {
        ctx.strokeStyle = '#ffffff';
        ctx.beginPath();
        ctx.moveTo(toX(c.pos.x), toY(c.pos.z));
        ctx.lineTo(toX(c.pos.x - Math.sin(c.yaw) * 4), toY(c.pos.z - Math.cos(c.yaw) * 4));
        ctx.stroke();
      }
    }
    if (state.bomb.state === 'planted' || state.bomb.state === 'dropped') {
      ctx.fillStyle = '#ff5040';
      const bx = toX(state.bomb.pos.x);
      const by = toY(state.bomb.pos.z);
      ctx.fillRect(bx - 3, by - 3, 6, 6);
    }
  }

  // --- Scoreboard -----------------------------------------------------------
  function renderScoreboard(state) {
    const rows = [...state.combatants].sort((a, b) => b.kills - a.kills);
    el.scoreRows.innerHTML = '';
    for (const c of rows) {
      const row = document.createElement('div');
      row.className = 'score-row' + (c.team === TEAMS.VANGUARD ? ' vanguard' : ' sentinel');
      row.innerHTML = `<span>${c.name}${c.isPlayer ? ' (you)' : ''}</span><span>${c.kills}</span><span>${c.deaths}</span><span>$${c.money}</span>`;
      el.scoreRows.appendChild(row);
    }
  }

  // --- Per-frame update -----------------------------------------------------
  function update(state, player, spreadPx) {
    const phase = state.phase;
    // Crosshair spread.
    el.crosshair.style.setProperty('--gap', `${spreadPx}px`);
    // Hitmarker.
    const hitOn = state.time - state.lastHitAt < 0.12;
    el.hitmarker.classList.toggle('on', hitOn);
    el.hitmarker.classList.toggle('head', hitOn && state.lastHitHead);
    // Vitals.
    setText('hp', el.health, `${Math.max(0, player.hp)}`);
    el.healthBar.style.width = `${Math.max(0, player.hp)}%`;
    el.healthBar.classList.toggle('low', player.hp <= 30);
    setText('armor', el.armor, `${player.armor}`);
    // Weapon.
    const weapon = WEAPONS[player.weapon];
    const ammo = player.ammo[player.weapon] || { mag: 0, reserve: 0 };
    setText('mag', el.ammoMag, `${ammo.mag}`);
    setText('reserve', el.ammoReserve, `/ ${ammo.reserve}`);
    setText('weapon', el.weaponName, weapon.name);
    el.ammoMag.parentElement.classList.toggle('empty', ammo.mag === 0);
    setText('money', el.money, `$${player.money}`);
    setText('grenades', el.grenades, `Frag ${player.grenades.frag} · Smoke ${player.grenades.smoke}`);
    el.charge.classList.toggle('on', player.hasCharge);
    // Timer and score.
    const left = roundTimeLeft(state);
    const mins = Math.floor(left / 60);
    const secs = Math.floor(left % 60);
    setText('timer', el.timer, `${mins}:${secs.toString().padStart(2, '0')}`);
    const label = phase === ROUND_PHASE.FREEZE ? 'BUY' : state.bomb.state === 'planted' ? 'BOMB' : 'ROUND';
    setText('timerLabel', el.timerLabel, label);
    el.timer.classList.toggle('danger', state.bomb.state === 'planted' || left < 10);
    setText('scoreV', el.scoreV, `${state.score.vanguard}`);
    setText('scoreS', el.scoreS, `${state.score.sentinel}`);
    setText('round', el.roundLabel, `ROUND ${Math.max(1, state.round)} · FIRST TO 5`);
    setText('aliveV', el.aliveV, `${aliveOf(state, TEAMS.VANGUARD)}`);
    setText('aliveS', el.aliveS, `${aliveOf(state, TEAMS.SENTINEL)}`);
    // Kill feed.
    if (state.feed.length !== feedCount) {
      feedCount = state.feed.length;
      el.feed.innerHTML = '';
      for (const entry of state.feed.slice(-4)) {
        const div = document.createElement('div');
        div.className = 'feed-entry' + (entry.team ? ` ${entry.team}` : '');
        div.textContent = entry.text;
        el.feed.appendChild(div);
      }
    }
    // Banner (3.5s).
    const bannerOn = state.banner && state.time - state.banner.at < 3.5;
    el.banner.classList.toggle('show', !!bannerOn);
    if (bannerOn) {
      setText('bannerTitle', el.bannerTitle, state.banner.title);
      setText('bannerSub', el.bannerSub, state.banner.sub);
      el.banner.classList.toggle('vanguard', state.banner.team === TEAMS.VANGUARD);
      el.banner.classList.toggle('sentinel', state.banner.team === TEAMS.SENTINEL);
    }
    // Channel progress.
    const channel = state.channel;
    el.channel.classList.toggle('show', !!channel);
    if (channel) {
      const total = channel.kind === 'plant' ? 3 : 5;
      const remain = Math.max(0, channel.endsAt - state.time);
      const done = 1 - remain / total;
      el.channelBar.style.width = `${Math.round(done * 100)}%`;
      const who = state.combatants[channel.byId];
      setText('channelLabel', el.channelLabel, channel.kind === 'plant'
        ? `${who.name} is planting the charge…`
        : `${who.name} is defusing the charge…`);
    }
    // Hint line.
    let hint = '';
    if (!player.alive) hint = 'You are down — spectating a teammate. The round plays on.';
    else if (phase === ROUND_PHASE.FREEZE) hint = 'Press B to buy · WASD to move when the round starts';
    else if (player.hasCharge) hint = 'Carry the charge to Site A or Site B — hold E inside the site to plant';
    else if (state.bomb.state === 'planted' && player.team === TEAMS.SENTINEL) hint = 'The charge is planted — reach it and hold E to defuse';
    else if (state.bomb.state === 'dropped' && player.team === TEAMS.VANGUARD) hint = 'The charge was dropped — pick it up';
    setText('hint', el.hint, hint);
    // Damage vignette + direction.
    const sinceDamage = state.time - state.damageAt;
    const vignette = player.hp <= 30 ? 0.35 : Math.max(0, 0.5 - sinceDamage * 0.8);
    el.vignette.style.opacity = vignette.toFixed(2);
    if (sinceDamage < 1.2) {
      const rel = state.damageFrom - player.yaw;
      el.damageDir.style.transform = `translate(-50%,-50%) rotate(${rel}rad)`;
      el.damageDir.style.opacity = '1';
    } else {
      el.damageDir.style.opacity = '0';
    }
    drawMinimap(state, player);
    if (buyOpen) renderBuyMenu(player);
    if (el.scoreboard.classList.contains('show')) renderScoreboard(state);
  }

  $('play-button').addEventListener('click', callbacks.onStart);
  $('restart-button').addEventListener('click', callbacks.onRestart);
  $('buy-close').addEventListener('click', () => callbacks.onCloseBuy());

  return {
    update,
    openBuy(player) {
      buyOpen = true;
      el.buyMenu.classList.add('show');
      renderBuyMenu(player);
    },
    closeBuy() {
      buyOpen = false;
      el.buyMenu.classList.remove('show');
    },
    get buyOpen() {
      return buyOpen;
    },
    showScoreboard(show) {
      el.scoreboard.classList.toggle('show', show);
    },
    showMenu(show) {
      el.menu.classList.toggle('show', show);
    },
    showMatchEnd(show, title, sub) {
      el.matchEnd.classList.toggle('show', show);
      if (show) {
        el.matchTitle.textContent = title;
        el.matchSub.textContent = sub;
      }
    },
  };
}
