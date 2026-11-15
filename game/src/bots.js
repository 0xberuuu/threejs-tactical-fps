// Bot brains: waypoint navigation over the map graph, vision cones and
// hearing, burst fire with reaction times, lane plans for attackers, hold
// positions for defenders, and objective play (plant, defuse, retake).
// Bots use the same movement collision, weapons and damage as the player.
import { MAP, findPath, nearestWaypoint } from './mapdata.js';
import { moveBody, hasLineOfSight } from './physics.js';
import { TEAMS, MATCH } from './state.js';
import { WEAPONS, fullAmmo } from './weapons.js';
import { tryFire, startReload, segmentBlockedBySmoke } from './combat.js';
import { eyeHeight } from './player.js';

const SEE_RANGE = 46;
const HEAR_RANGE = 26;
const ENGAGE_FOV = 1.9; // radians of half-angle the bot notices (~109 deg)
const BOT_SPEED = 4.6;

const BOT_NAMES = {
  vanguard: ['Rook', 'Iris', 'Casper'],
  sentinel: ['Havoc', 'Mira', 'Doss', 'Kite'],
};

// Attack plans: [site, lanes per attacker]. Lanes are waypoint routes.
const ATTACK_PLANS = [
  { site: 'A', lanes: [[3, 4, 5, 6, 7, 8], [10, 11, 13, 14, 15, 30, 9, 8], [3, 26, 9, 8]] },
  { site: 'A', lanes: [[3, 4, 5, 6, 7, 8], [3, 4, 5, 6, 26, 30, 9, 8], [17, 27, 22, 16, 9, 8]] },
  { site: 'B', lanes: [[17, 18, 19, 20, 21], [12, 11, 13, 14, 15, 16, 22, 21], [17, 27, 22, 21]] },
  { site: 'B', lanes: [[17, 18, 19, 20, 21], [17, 18, 19, 20, 27, 22, 21], [10, 11, 13, 14, 15, 16, 22, 21]] },
];

export function makeBotBrain(c, rng, skill) {
  return {
    skill, // 0..1, drives reaction time and aim error
    role: c.team === TEAMS.VANGUARD ? 'attack' : 'defend',
    path: [],
    pathIndex: 0,
    mode: 'move',
    target: null,
    lastKnown: null, // { x, z, at }
    reactAt: 0,
    nextScanAt: rng.next() * 0.15,
    holdNode: -1,
    holdYaw: 0,
    planSite: 'A',
    strafeDir: 1,
    strafeUntil: 0,
    burstLeft: 0,
    burstPauseUntil: 0,
    stuckAt: 0,
    stuckCount: 0,
    lastX: 0,
    lastZ: 0,
    investigate: null, // { x, z, at }
    wantsChannel: null,
    yawTarget: 0,
    scanOffset: rng.next() * 0.5,
  };
}

// Round setup: lane plans for attackers, hold spots for defenders, and a
// buy decision from each bot's money.
export function assignPlans(state) {
  const rng = state.rng;
  const plan = ATTACK_PLANS[Math.floor(rng.next() * ATTACK_PLANS.length)];
  const attackers = state.combatants.filter((c) => c.team === TEAMS.VANGUARD && !c.isPlayer);
  attackers.forEach((c, i) => {
    c.bot.planSite = plan.site;
    c.bot.path = plan.lanes[i % plan.lanes.length].slice();
    c.bot.pathIndex = 0;
    c.bot.mode = 'move';
    c.bot.target = null;
    c.bot.investigate = null;
  });
  const defenders = state.combatants.filter((c) => c.team === TEAMS.SENTINEL);
  const holds = MAP.holds.slice();
  // Shuffle hold spots so the defence varies round to round.
  for (let i = holds.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [holds[i], holds[j]] = [holds[j], holds[i]];
  }
  defenders.forEach((c, i) => {
    const hold = holds[i % holds.length];
    c.bot.holdNode = hold.node;
    c.bot.holdYaw = hold.yaw;
    c.bot.path = findPath(nearestWaypoint(c.pos.x, c.pos.z), hold.node);
    c.bot.pathIndex = 0;
    c.bot.mode = 'move';
    c.bot.target = null;
    c.bot.investigate = null;
  });
  for (const c of state.combatants) {
    if (!c.isPlayer && c.bot) botBuy(c, rng);
  }
}

function botBuy(c, rng) {
  // Simple economy: rifle when affordable, SMG on a budget, a grenade when
  // flush. Keeps the buy menu honest — bots follow the same prices.
  const money = c.money;
  if (money >= 2600 && rng.chance(0.85)) {
    buyFor(c, 'ar4');
  } else if (money >= 1200 && rng.chance(0.8)) {
    buyFor(c, 'k7');
  }
  if (money >= 4200 && c.team === TEAMS.SENTINEL && rng.chance(0.3)) {
    buyFor(c, 'dmr');
  }
  if (c.money >= 300 && rng.chance(0.5)) {
    c.money -= 300;
    c.grenades.frag += 1;
  }
  if (c.money >= 250 && rng.chance(0.3)) {
    c.money -= 250;
    c.grenades.smoke += 1;
  }
  if (c.money >= 650 && rng.chance(0.6)) {
    c.money -= 650;
    c.armor = 50;
  }
}

function buyFor(c, id) {
  const w = WEAPONS[id];
  if (c.money < w.price) return;
  c.money -= w.price;
  c.weapons.primary = id;
  c.weapon = id;
  c.ammo[id] = fullAmmo(id);
}

function eyePos(c, out) {
  out.x = c.pos.x;
  out.y = c.pos.y + eyeHeight(c.crouched);
  out.z = c.pos.z;
  return out;
}

const _eye = { x: 0, y: 0, z: 0 };
const _targetEye = { x: 0, y: 0, z: 0 };
const _wish = { x: 0, z: 0 };

// Vision + hearing scan, staggered per bot. Sets bot.target when an enemy
// is seen, and bot.investigate when a shot is heard.
function perceive(state, c) {
  const bot = c.bot;
  const now = state.time;
  if (now < bot.nextScanAt) return;
  bot.nextScanAt = now + 0.15;
  eyePos(c, _eye);
  let best = null;
  let bestDist = SEE_RANGE;
  for (const enemy of state.combatants) {
    if (!enemy.alive || enemy.team === c.team) continue;
    const dx = enemy.pos.x - c.pos.x;
    const dz = enemy.pos.z - c.pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist > SEE_RANGE) continue;
    // Vision cone, unless the enemy is very close or recently shot.
    // Bearing under the shared yaw convention: 0 faces -Z.
    const angleTo = Math.atan2(-dx, -dz);
    let angleDiff = angleTo - c.yaw;
    while (angleDiff > Math.PI) angleDiff -= Math.PI * 2;
    while (angleDiff < -Math.PI) angleDiff += Math.PI * 2;
    const recentlyLoud = state.lastGunshot && state.lastGunshot.team === enemy.team && now - state.lastGunshot.at < 1.2;
    if (Math.abs(angleDiff) > ENGAGE_FOV && dist > 3 && !recentlyLoud) continue;
    eyePos(enemy, _targetEye);
    if (!hasLineOfSight(_eye.x, _eye.y, _eye.z, _targetEye.x, _targetEye.y, _targetEye.z)) continue;
    if (segmentBlockedBySmoke(state, _eye.x, _eye.y, _eye.z, _targetEye.x, _targetEye.y, _targetEye.z)) continue;
    if (dist < bestDist) {
      bestDist = dist;
      best = enemy;
    }
  }
  if (best) {
    if (bot.target !== best) {
      bot.target = best;
      // Reaction time: better bots acquire faster.
      bot.reactAt = now + 0.55 - bot.skill * 0.3;
      bot.burstLeft = 0;
    }
    bot.lastKnown = { x: best.pos.x, z: best.pos.z, at: now };
  } else if (bot.target) {
    // Lost sight: keep hunting the last known position briefly.
    if (!bot.lastKnown || now - bot.lastKnown.at > 2.5) bot.target = null;
  }
  // Hearing: investigate recent enemy gunfire nearby.
  const shot = state.lastGunshot;
  if (shot && shot.team !== c.team && now - shot.at < 1.0) {
    const dist = Math.hypot(shot.pos.x - c.pos.x, shot.pos.z - c.pos.z);
    if (dist < HEAR_RANGE && !bot.target) {
      bot.investigate = { x: shot.pos.x, z: shot.pos.z, at: now };
    }
  }
}

function faceTowards(c, x, z, dt, speed) {
  const targetYaw = Math.atan2(-(x - c.pos.x), -(z - c.pos.z));
  let diff = targetYaw - c.yaw;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  const step = Math.max(-speed * dt, Math.min(speed * dt, diff));
  c.yaw += step;
}

function moveAlongPath(state, c, dt) {
  const bot = c.bot;
  if (bot.pathIndex >= bot.path.length) return true;
  const node = MAP.waypoints[bot.path[bot.pathIndex]];
  const dx = node.x - c.pos.x;
  const dz = node.z - c.pos.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 1.1) {
    bot.pathIndex++;
    return bot.pathIndex >= bot.path.length;
  }
  _wish.x = dx / dist;
  _wish.z = dz / dist;
  // Separation from nearby teammates so bots do not stack.
  for (const other of state.combatants) {
    if (other === c || !other.alive) continue;
    const ox = c.pos.x - other.pos.x;
    const oz = c.pos.z - other.pos.z;
    const od = Math.hypot(ox, oz);
    if (od < 0.9 && od > 0.01) {
      _wish.x += (ox / od) * 0.6;
      _wish.z += (oz / od) * 0.6;
    }
  }
  const len = Math.hypot(_wish.x, _wish.z) || 1;
  c.vel.x = (_wish.x / len) * BOT_SPEED;
  c.vel.z = (_wish.z / len) * BOT_SPEED;
  faceTowards(c, c.pos.x + _wish.x, c.pos.z + _wish.z, dt, 7);
  // Stuck detection: hop first, then repath around the blockage through the
  // nav graph, then skip the unreachable node. A sidestep impulse alone does
  // not work — the next step overwrites velocity — so recovery changes the
  // path itself instead of the velocity.
  if (state.time - bot.stuckAt > 0.8) {
    const moved = Math.hypot(c.pos.x - bot.lastX, c.pos.z - bot.lastZ);
    if (moved < 0.25 && bot.pathIndex < bot.path.length) {
      bot.stuckCount = (bot.stuckCount || 0) + 1;
      if (bot.stuckCount >= 3) {
        // Give up on this node and head for the next one.
        bot.pathIndex++;
        bot.stuckCount = 0;
      } else if (bot.stuckCount === 2) {
        const dest = bot.path[bot.path.length - 1];
        const fresh = findPath(nearestWaypoint(c.pos.x, c.pos.z), dest);
        if (fresh.length > 1) {
          bot.path = fresh;
          bot.pathIndex = 0;
        }
      } else {
        c.vel.y = 5.5;
      }
    } else {
      bot.stuckCount = 0;
    }
    bot.stuckAt = state.time;
    bot.lastX = c.pos.x;
    bot.lastZ = c.pos.z;
  }
  return false;
}

function stopMoving(c) {
  c.vel.x = 0;
  c.vel.z = 0;
}

// Aim at the target's chest with skill-scaled error, then fire in bursts.
function engage(state, c, dt, effects) {
  const bot = c.bot;
  const target = bot.target;
  const aimAt = target.alive ? target : null;
  if (!aimAt) {
    bot.target = null;
    return;
  }
  const tx = aimAt.pos.x;
  const tz = aimAt.pos.z;
  faceTowards(c, tx, tz, dt, 9);
  const dist = Math.hypot(tx - c.pos.x, tz - c.pos.z);
  // Strafe in short bursts, pausing to shoot: moving bots are inaccurate.
  if (state.time > bot.strafeUntil) {
    bot.strafeDir = state.rng.chance(0.5) ? 1 : -1;
    bot.strafeUntil = state.time + 0.4 + state.rng.next() * 0.5;
  }
  const strafing = state.time < bot.strafeUntil - 0.25;
  if (strafing && dist > 4) {
    const px = Math.cos(c.yaw) * bot.strafeDir;
    const pz = -Math.sin(c.yaw) * bot.strafeDir;
    c.vel.x = px * BOT_SPEED * 0.55;
    c.vel.z = pz * BOT_SPEED * 0.55;
  } else {
    stopMoving(c);
  }
  // Reload when the magazine is dry.
  const ammo = c.ammo[c.weapon];
  if (ammo && ammo.mag === 0 && ammo.reserve > 0) {
    startReload(state, c);
    return;
  }
  if (state.time < bot.reactAt || state.time < bot.burstPauseUntil) return;
  if (bot.burstLeft <= 0) {
    bot.burstLeft = 2 + Math.floor(state.rng.next() * 3) + (c.weapon === 'dmr' ? -1 : 0);
  }
  // Aim error grows with distance and target speed, shrinks with skill.
  const targetSpeed = Math.hypot(aimAt.vel.x, aimAt.vel.z);
  const error = (0.035 - bot.skill * 0.02) * (0.6 + dist / 30) * (1 + targetSpeed * 0.12);
  eyePos(c, _eye);
  const aimY = aimAt.pos.y + 1.3 + (state.rng.next() - 0.5) * 0.3;
  const dx = tx - _eye.x + (state.rng.next() - 0.5) * 2 * error * dist;
  const dy = aimY - _eye.y;
  const dz = tz - _eye.z + (state.rng.next() - 0.5) * 2 * error * dist;
  const len = Math.hypot(dx, dy, dz) || 1;
  const moving = Math.hypot(c.vel.x, c.vel.z) > 0.6;
  const result = tryFire(state, c, _eye, { x: dx / len, y: dy / len, z: dz / len }, moving, false, effects);
  if (result === 'fired') {
    bot.burstLeft--;
    if (bot.burstLeft <= 0) bot.burstPauseUntil = state.time + 0.25 + state.rng.next() * 0.4;
  } else if (result === 'empty') {
    startReload(state, c);
  }
}

export function stepBot(state, c, dt, effects) {
  const bot = c.bot;
  if (!c.alive) {
    c.vel.x = 0;
    c.vel.z = 0;
    return;
  }
  perceive(state, c);
  bot.wantsChannel = null;
  const bomb = state.bomb;
  const targetDist =
    bot.target && bot.target.alive ? Math.hypot(bot.target.pos.x - c.pos.x, bot.target.pos.z - c.pos.z) : Infinity;

  // Objective overrides.
  if (bomb.state === 'planted' && c.team === TEAMS.SENTINEL) {
    // Retake: converge on the planted site, defuse when it is safe.
    const site = MAP.sites.find((s) => s.id === bomb.site);
    const distToBomb = Math.hypot(bomb.pos.x - c.pos.x, bomb.pos.z - c.pos.z);
    const timeLeft = MATCH.BOMB_TIME - (state.time - bomb.plantedAt);
    if (distToBomb < 2.5 && (!bot.target || timeLeft < 8)) {
      bot.wantsChannel = 'defuse';
      stopMoving(c);
      faceTowards(c, bomb.pos.x, bomb.pos.z, dt, 9);
      return;
    }
    if (bot.mode !== 'retake') {
      bot.mode = 'retake';
      bot.path = findPath(nearestWaypoint(c.pos.x, c.pos.z), nearestWaypoint(bomb.pos.x, bomb.pos.z));
      bot.pathIndex = 0;
    }
  } else if (bomb.state === 'planted' && c.team === TEAMS.VANGUARD) {
    // Defend the planted charge: hold near the site.
    if (bot.mode !== 'guard') {
      bot.mode = 'guard';
      const site = MAP.sites.find((s) => s.id === bomb.site);
      bot.path = findPath(nearestWaypoint(c.pos.x, c.pos.z), nearestWaypoint(site.plant.x, site.plant.z));
      bot.pathIndex = 0;
    }
  } else if (c.hasCharge && c.team === TEAMS.VANGUARD) {
    // Carrier: if inside the planned site and no enemy close by, plant.
    // A distant watcher does not stop the plant — the channel is the risk.
    const site = MAP.sites.find((s) => s.id === bot.planSite);
    const inSite = Math.abs(c.pos.x - site.cx) < site.w / 2 && Math.abs(c.pos.z - site.cz) < site.d / 2;
    if (inSite && targetDist > 22) {
      bot.wantsChannel = 'plant';
      stopMoving(c);
      return;
    }
  } else if (bomb.state === 'dropped' && c.team === TEAMS.VANGUARD && !bot.target) {
    // Go and pick the charge up.
    if (bot.mode !== 'recover') {
      bot.mode = 'recover';
      bot.path = findPath(nearestWaypoint(c.pos.x, c.pos.z), nearestWaypoint(bomb.pos.x, bomb.pos.z));
      bot.pathIndex = 0;
    }
  }

  // Fight when there is a visible target — except the charge carrier, who
  // pushes on past distant threats instead of duelling them: a carrier
  // that stops to fight every defender it glimpses never reaches the site.
  const carrierPushing = c.hasCharge && c.team === TEAMS.VANGUARD && targetDist > 22;
  if (bot.target && bot.target.alive && !carrierPushing) {
    engage(state, c, dt, effects);
    c.vel.y -= 18 * dt;
    c.onGround = moveBody(c.pos, c.vel, dt, c.crouched);
    return;
  }

  // Investigate a heard shot before returning to the plan.
  if (bot.investigate && state.time - bot.investigate.at < 4) {
    const arrived = moveAlongPath(state, c, dt);
    if (arrived || Math.hypot(bot.investigate.x - c.pos.x, bot.investigate.z - c.pos.z) < 2) {
      bot.investigate = null;
    }
    c.vel.y -= 18 * dt;
    c.onGround = moveBody(c.pos, c.vel, dt, c.crouched);
    return;
  }
  bot.investigate = null;

  // Follow the plan: walk the path, then hold.
  const arrived = moveAlongPath(state, c, dt);
  if (arrived) {
    stopMoving(c);
    if (c.team === TEAMS.SENTINEL && bot.holdNode >= 0) {
      // Hold the angle, scanning slowly.
      const scan = Math.sin(state.time * 0.4 + bot.scanOffset) * 0.5;
      const targetYaw = bot.holdYaw + scan;
      let diff = targetYaw - c.yaw;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      c.yaw += Math.max(-2.4 * dt, Math.min(2.4 * dt, diff));
    } else if (c.team === TEAMS.VANGUARD) {
      // At the end of the lane: face the nearer site and wait for a pick.
      let best = null;
      let bestDist = Infinity;
      for (const site of MAP.sites) {
        const d = Math.hypot(site.plant.x - c.pos.x, site.plant.z - c.pos.z);
        if (d < bestDist) {
          bestDist = d;
          best = site;
        }
      }
      if (best) faceTowards(c, best.plant.x, best.plant.z, dt, 3);
    }
  }
  c.vel.y -= 18 * dt;
  c.onGround = moveBody(c.pos, c.vel, dt, c.crouched);
}
