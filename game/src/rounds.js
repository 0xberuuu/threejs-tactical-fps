// Round flow: freeze time with the buy menu, live play, the plant/defuse
// objective, the economy, and the match score. The round state machine is
// the only module that changes phase, score or money.
import { MAP } from './mapdata.js';
import { TEAMS, MATCH, ROUND_PHASE, aliveOf, pushFeed, playerOf, makeCombatant } from './state.js';
import { WEAPONS, fullAmmo } from './weapons.js';
import { queueSound } from './audio.js';
import { assignPlans, makeBotBrain } from './bots.js';

export function setupCombatants(state) {
  const names = {
    vanguard: ['You', 'Rook', 'Iris', 'Casper'],
    sentinel: ['Havoc', 'Mira', 'Doss', 'Kite'],
  };
  state.combatants.length = 0;
  let id = 0;
  for (const team of [TEAMS.VANGUARD, TEAMS.SENTINEL]) {
    for (let i = 0; i < MATCH.TEAM_SIZE; i++) {
      const isPlayer = team === TEAMS.VANGUARD && i === 0;
      const c = makeCombatant(id++, team, names[team][i], isPlayer);
      c.ammo.p9 = fullAmmo('p9');
      if (!isPlayer) {
        c.bot = makeBotBrain(c, state.rng, 0.45 + state.rng.next() * 0.4);
      }
      state.combatants.push(c);
    }
  }
}

export function startMatch(state) {
  state.score.vanguard = 0;
  state.score.sentinel = 0;
  state.lossStreak.vanguard = 0;
  state.lossStreak.sentinel = 0;
  state.round = 0;
  for (const c of state.combatants) {
    c.money = MATCH.START_MONEY;
    c.kills = 0;
    c.deaths = 0;
    c.weapons = { primary: null, secondary: 'p9' };
    c.weapon = 'p9';
    c.ammo = { p9: fullAmmo('p9') };
    c.armor = 0;
    c.grenades = { frag: 0, smoke: 0 };
  }
  startRound(state);
}

export function startRound(state) {
  state.round += 1;
  state.phase = ROUND_PHASE.FREEZE;
  state.phaseUntil = state.time + MATCH.FREEZE_TIME;
  state.bomb = { state: 'carried', site: null, pos: { x: 0, y: 0, z: 0 }, plantedAt: 0, carrierId: -1 };
  state.channel = null;
  state.grenades.length = 0;
  state.smokeClouds.length = 0;
  state.feed.length = 0;
  state.spectateId = -1;
  // Spawn everyone fresh.
  const spawnIndex = { vanguard: 0, sentinel: 0 };
  for (const c of state.combatants) {
    const spawn = MAP.spawns[c.team][spawnIndex[c.team] % MAP.spawns[c.team].length];
    spawnIndex[c.team] += 1;
    c.pos.x = spawn.x;
    c.pos.y = 0;
    c.pos.z = spawn.z;
    c.vel.x = 0;
    c.vel.y = 0;
    c.vel.z = 0;
    c.yaw = spawn.yaw;
    c.pitch = 0;
    c.alive = true;
    c.hp = 100;
    c.crouched = false;
    c.spreadBloom = 0;
    c.recoilPitch = 0;
    c.recoilYaw = 0;
    c.reloadingUntil = 0;
    c.switchingUntil = 0;
    c.hasCharge = false;
    c.grenades = { frag: 0, smoke: 0 };
    // Ammunition is topped up every round; weapons and armor carry over.
    for (const id of Object.keys(c.ammo)) c.ammo[id] = fullAmmo(id);
    if (c.bot) {
      c.bot.target = null;
      c.bot.path = [];
      c.bot.pathIndex = 0;
      c.bot.investigate = null;
      c.bot.wantsChannel = null;
    }
  }
  // The charge alternates: the player carries on odd rounds, a bot on even.
  const attackers = state.combatants.filter((c) => c.team === TEAMS.VANGUARD);
  const carrier = state.round % 2 === 1 ? attackers[0] : attackers[1];
  carrier.hasCharge = true;
  state.bomb.carrierId = carrier.id;
  assignPlans(state);
  state.banner = {
    title: `ROUND ${state.round}`,
    sub: carrier.isPlayer ? 'You carry the pulse charge — plant it at Site A or Site B' : `${carrier.name} carries the pulse charge`,
    at: state.time,
    team: null,
  };
  pushFeed(state, `Round ${state.round} — buy phase, press B for the buy menu`, null);
}

function endRound(state, winner, reason) {
  if (state.phase === ROUND_PHASE.END || state.phase === ROUND_PHASE.MATCH_END) return;
  state.phase = ROUND_PHASE.END;
  state.phaseUntil = state.time + MATCH.END_TIME;
  state.channel = null;
  const loser = winner === TEAMS.VANGUARD ? TEAMS.SENTINEL : TEAMS.VANGUARD;
  state.score[winner] += 1;
  state.lossStreak[winner] = 0;
  state.lossStreak[loser] += 1;
  const winReward = reason === 'detonation' ? MATCH.WIN_REWARD_PLANT : MATCH.WIN_REWARD;
  const lossReward = Math.min(
    MATCH.LOSS_BONUS_MAX,
    MATCH.LOSS_REWARD + (state.lossStreak[loser] - 1) * MATCH.LOSS_BONUS_STEP,
  );
  for (const c of state.combatants) {
    if (c.team === winner) c.money += winReward;
    else c.money += lossReward;
  }
  const winnerName = winner === TEAMS.VANGUARD ? 'VANGUARDS WIN' : 'SENTINELS WIN';
  state.banner = { title: winnerName, sub: reason, at: state.time, team: winner };
  pushFeed(state, `${winnerName} — ${reason}`, winner);
  const playerWon = playerOf(state).team === winner;
  queueSound(state, playerWon ? 'win' : 'lose', null, 0.8);
  state.matchDecided =
    state.score[winner] >= MATCH.ROUNDS_TO_WIN || state.round >= MATCH.MAX_ROUNDS;
}

// The plant/defuse channel: one combatant, standing still, holding the
// action. Movement or death cancels it.
function stepChannel(state) {
  const channel = state.channel;
  if (channel) {
    const c = state.combatants[channel.byId];
    const moved = Math.hypot(c.pos.x - channel.x, c.pos.z - channel.z) > 1.0;
    const want = c.isPlayer ? state.playerWantsChannel : c.bot && c.bot.wantsChannel === channel.kind;
    if (!c.alive || moved || !want) {
      state.channel = null;
      return;
    }
    if (state.time >= channel.endsAt) {
      completeChannel(state, channel);
      state.channel = null;
    }
    return;
  }
  // No active channel: look for someone starting one.
  for (const c of state.combatants) {
    if (!c.alive) continue;
    const want = c.isPlayer ? state.playerWantsChannel : c.bot && c.bot.wantsChannel;
    if (!want) continue;
    if (want === 'plant' && c.hasCharge && state.bomb.state === 'carried') {
      const site = siteContaining(c.pos.x, c.pos.z);
      if (site) {
        state.channel = { kind: 'plant', byId: c.id, site: site.id, x: c.pos.x, z: c.pos.z, endsAt: state.time + MATCH.PLANT_TIME };
        queueSound(state, 'plant', c.pos, 0.7);
      }
    } else if (want === 'defuse' && state.bomb.state === 'planted') {
      const dist = Math.hypot(state.bomb.pos.x - c.pos.x, state.bomb.pos.z - c.pos.z);
      if (dist < 2.6 && c.team === TEAMS.SENTINEL) {
        state.channel = { kind: 'defuse', byId: c.id, site: state.bomb.site, x: c.pos.x, z: c.pos.z, endsAt: state.time + MATCH.DEFUSE_TIME };
        queueSound(state, 'defuse', c.pos, 0.7);
      }
    }
  }
}

function completeChannel(state, channel) {
  const c = state.combatants[channel.byId];
  if (channel.kind === 'plant') {
    c.hasCharge = false;
    state.bomb.state = 'planted';
    state.bomb.site = channel.site;
    state.bomb.pos.x = c.pos.x;
    state.bomb.pos.y = 0;
    state.bomb.pos.z = c.pos.z;
    state.bomb.plantedAt = state.time;
    state.bomb.carrierId = -1;
    state.banner = { title: 'CHARGE PLANTED', sub: `Site ${channel.site} — ${MATCH.BOMB_TIME} seconds to detonation`, at: state.time, team: TEAMS.VANGUARD };
    pushFeed(state, `Charge planted at Site ${channel.site}`, TEAMS.VANGUARD);
    queueSound(state, 'plant', c.pos, 1);
  } else {
    state.bomb.state = 'defused';
    pushFeed(state, 'Charge defused', TEAMS.SENTINEL);
    endRound(state, TEAMS.SENTINEL, 'Charge defused');
  }
}

export function siteContaining(x, z) {
  for (const site of MAP.sites) {
    if (Math.abs(x - site.cx) < site.w / 2 && Math.abs(z - site.cz) < site.d / 2) return site;
  }
  return null;
}

export function roundTimeLeft(state) {
  if (state.phase === ROUND_PHASE.FREEZE) return state.phaseUntil - state.time;
  if (state.phase !== ROUND_PHASE.LIVE) return 0;
  if (state.bomb.state === 'planted') {
    return Math.max(0, MATCH.BOMB_TIME - (state.time - state.bomb.plantedAt));
  }
  return Math.max(0, state.roundEndsAt - state.time);
}

export function stepRounds(state, dt, effects) {
  if (state.phase === ROUND_PHASE.FREEZE) {
    if (state.time >= state.phaseUntil) {
      state.phase = ROUND_PHASE.LIVE;
      state.roundEndsAt = state.time + MATCH.ROUND_TIME;
      state.banner = { title: 'GO GO GO', sub: 'Eliminate the enemy team or complete the objective', at: state.time, team: null };
    }
    return;
  }
  if (state.phase === ROUND_PHASE.END) {
    if (state.time >= state.phaseUntil) {
      if (state.matchDecided) {
        state.phase = ROUND_PHASE.MATCH_END;
        const winner = state.score.vanguard > state.score.sentinel ? TEAMS.VANGUARD : TEAMS.SENTINEL;
        state.banner = {
          title: winner === TEAMS.VANGUARD ? 'VANGUARDS TAKE THE MATCH' : 'SENTINELS TAKE THE MATCH',
          sub: `Final score ${state.score.vanguard} — ${state.score.sentinel}`,
          at: state.time,
          team: winner,
        };
      } else {
        startRound(state);
      }
    }
    return;
  }
  if (state.phase !== ROUND_PHASE.LIVE) return;

  stepChannel(state);

  // Dropped charge pickup: walk over it to take it.
  if (state.bomb.state === 'dropped') {
    for (const c of state.combatants) {
      if (!c.alive || c.team !== TEAMS.VANGUARD) continue;
      if (Math.hypot(state.bomb.pos.x - c.pos.x, state.bomb.pos.z - c.pos.z) < 1.3) {
        c.hasCharge = true;
        state.bomb.state = 'carried';
        state.bomb.carrierId = c.id;
        pushFeed(state, `${c.name} picked up the pulse charge`, TEAMS.VANGUARD);
        break;
      }
    }
  }

  // Planted bomb: accelerating beeps, then detonation.
  if (state.bomb.state === 'planted') {
    const elapsed = state.time - state.bomb.plantedAt;
    const interval = Math.max(0.18, 1 - elapsed / MATCH.BOMB_TIME);
    if (state.time - (state.lastBeepAt || 0) > interval) {
      state.lastBeepAt = state.time;
      queueSound(state, 'beep', state.bomb.pos, 0.8);
    }
    if (elapsed >= MATCH.BOMB_TIME) {
      state.bomb.state = 'exploded';
      effects.explosion(state.bomb.pos.x, 0.4, state.bomb.pos.z);
      queueSound(state, 'explosion', state.bomb.pos, 1.6);
      state.shake = 1;
      endRound(state, TEAMS.VANGUARD, 'Charge detonated');
      return;
    }
  }

  // Elimination and time win conditions.
  const vanguardAlive = aliveOf(state, TEAMS.VANGUARD);
  const sentinelAlive = aliveOf(state, TEAMS.SENTINEL);
  if (sentinelAlive === 0) {
    endRound(state, TEAMS.VANGUARD, 'Enemy team eliminated');
    return;
  }
  if (vanguardAlive === 0 && state.bomb.state !== 'planted') {
    endRound(state, TEAMS.SENTINEL, 'Enemy team eliminated');
    return;
  }
  if (state.bomb.state !== 'planted' && state.time >= state.roundEndsAt) {
    endRound(state, TEAMS.SENTINEL, 'Time expired — charge never planted');
  }
}
