// The one state store. Every module reads and writes this object; nothing
// keeps a second copy of match truth. Plain data only — no three.js objects.
import { makeRng } from './rng.js';

export const TEAMS = {
  VANGUARD: 'vanguard', // attackers: plant the pulse charge
  SENTINEL: 'sentinel', // defenders: hold the sites, defuse the charge
};

export const ROUND_PHASE = {
  MENU: 'menu',
  FREEZE: 'freeze', // buy time, players cannot move
  LIVE: 'live',
  END: 'end', // banner, then next round
  MATCH_END: 'matchend',
};

export const MATCH = {
  TEAM_SIZE: 4,
  ROUNDS_TO_WIN: 5,
  MAX_ROUNDS: 9,
  ROUND_TIME: 100, // seconds
  FREEZE_TIME: 12,
  END_TIME: 5,
  BOMB_TIME: 35, // seconds from plant to detonation
  PLANT_TIME: 3,
  DEFUSE_TIME: 5,
  START_MONEY: 800,
  KILL_REWARD: 300,
  WIN_REWARD: 1400,
  WIN_REWARD_PLANT: 1600,
  LOSS_REWARD: 1000,
  LOSS_BONUS_STEP: 500,
  LOSS_BONUS_MAX: 2000,
};

// A combatant: the player or one bot. `pos` is feet position; `yaw` faces
// the direction of travel/aim; `mesh` is filled in by characters.js.
export function makeCombatant(id, team, name, isPlayer) {
  return {
    id,
    team,
    name,
    isPlayer: !!isPlayer,
    alive: true,
    hp: 100,
    armor: 0,
    pos: { x: 0, y: 0, z: 0 },
    vel: { x: 0, y: 0, z: 0 },
    yaw: 0,
    pitch: 0,
    crouched: false,
    onGround: true,
    weapon: 'p9',
    weapons: { primary: null, secondary: 'p9' },
    ammo: {}, // weapon id -> { mag, reserve }
    grenades: { frag: 0, smoke: 0 },
    money: MATCH.START_MONEY,
    kills: 0,
    deaths: 0,
    hasCharge: false,
    // Aim/shooting state (shared by player and bots).
    spreadBloom: 0,
    recoilPitch: 0,
    recoilYaw: 0,
    lastShotAt: -99,
    reloadingUntil: 0,
    switchingUntil: 0,
    flashUntil: 0, // hit-flash timer for the mesh
    mesh: null,
    bot: null, // bot brain state, set for bots in bots.js
  };
}

export function createState(seed) {
  return {
    seed,
    rng: makeRng(seed),
    time: 0, // simulation seconds since boot
    phase: ROUND_PHASE.MENU,
    phaseUntil: 0,
    round: 0,
    score: { vanguard: 0, sentinel: 0 },
    lossStreak: { vanguard: 0, sentinel: 0 },
    combatants: [],
    playerId: 0,
    // Objective state.
    bomb: {
      state: 'carried', // carried | planted | exploded | defused | dropped
      site: null,
      pos: { x: 0, y: 0, z: 0 },
      plantedAt: 0,
      carrierId: -1,
    },
    channel: null, // { kind: 'plant'|'defuse', byId, startedAt, duration, site }
    feed: [], // kill feed entries { text, at, team }
    banner: null, // { title, sub, at, team }
    grenades: [], // live grenades (see combat.js)
    smokeClouds: [], // { x, y, z, radius, until } — block vision (see combat.js)
    lastGunshot: null, // { pos, team, at } — bots hear this
    lastHitAt: -99, // hitmarker timing for the HUD
    lastHitHead: false,
    tracers: [], // visual tracer list (see combat.js)
    particles: [], // impact/explosion particles (see combat.js)
    sounds: [], // queued sound events { name, pos, at } drained by audio.js
    shake: 0, // camera shake magnitude, decays
    damageFrom: -1, // yaw of last damage source, for the HUD indicator
    damageAt: -99,
    spectateId: -1,
    shotMode: null, // set by main.js when ?shot= is present
    stats: { shotsFired: 0, shotsHit: 0, headshots: 0 },
  };
}

// The player combatant, by convention combatants[0].
export function playerOf(state) {
  return state.combatants[state.playerId];
}

export function aliveOf(state, team) {
  let count = 0;
  for (const c of state.combatants) {
    if (c.team === team && c.alive) count++;
  }
  return count;
}

export function teamOf(state, team) {
  return state.combatants.filter((c) => c.team === team);
}

export function pushFeed(state, text, team) {
  state.feed.push({ text, at: state.time, team: team || null });
  if (state.feed.length > 6) state.feed.shift();
}
