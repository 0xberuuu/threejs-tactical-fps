// BREACHLINE — boot, the fixed-step loop, player control and the camera.
// Simulation runs at a fixed 60 Hz, kept apart from rendering; the render
// step only syncs meshes and the HUD. ?shot=start|buy|play|end&seed=N sets
// up a deterministic frame for a capture, renders it, freezes it and sets
// window.__shotReady.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createWorld } from './world.js';
import { createInput } from './input.js';
import { createAudio, queueSound } from './audio.js';
import { createState, playerOf, ROUND_PHASE, TEAMS } from './state.js';
import { createEffects, tryFire, startReload, finishReloads, stepGrenades, throwGrenade } from './combat.js';
import { stepBot } from './bots.js';
import { stepRounds, startMatch, setupCombatants } from './rounds.js';
import { createHud } from './hud.js';
import { stepPlayerMovement, wishDirection, eyeHeight, isMoving } from './player.js';
import { WEAPONS, GRENADE_DEFS, ARMOR_PRICE, fullAmmo, currentSpread } from './weapons.js';
import { createCombatantMesh, updateCombatantMesh, createViewmodel, setViewmodelWeapon, updateViewmodel, kickViewmodel } from './characters.js';
import { hasLineOfSight } from './physics.js';
import { MAP } from './mapdata.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;

const state = createState(seed);
state.shotMode = shot;
// Debug handle: lets automated checks inspect the live simulation.
window.__breachline = state;
// Debug fast-forward: advance the fixed-step simulation N steps at once.
window.__breachlineStep = (n) => {
  for (let i = 0; i < n; i++) stepSimulation(FIXED_STEP);
};

// --- Renderer / scene -------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 160);
scene.add(camera);

const world = createWorld(scene);
const effects = createEffects(scene);
const audio = createAudio();
const input = createInput(renderer.domElement, onLockChange);

setupCombatants(state);
for (const c of state.combatants) {
  c.mesh = createCombatantMesh(c.team);
  scene.add(c.mesh.group);
}
const viewmodel = createViewmodel(camera);

// --- HUD --------------------------------------------------------------------
let buyMenuOpen = false;
const hud = createHud({
  onStart() {
    audio.unlock();
    if (state.phase === ROUND_PHASE.MENU && state.round === 0) startMatch(state);
    hud.showMenu(false);
    if (!shot) input.requestLock();
    started = true;
  },
  onRestart() {
    audio.unlock();
    hud.showMatchEnd(false);
    startMatch(state);
    if (!shot) input.requestLock();
    started = true;
  },
  onBuy(kind, id) {
    buyItem(kind, id);
  },
  onCloseBuy() {
    closeBuyMenu();
  },
});

function onLockChange(locked) {
  if (!locked && started && !shot && state.phase !== ROUND_PHASE.MATCH_END && state.phase !== ROUND_PHASE.MENU) {
    hud.showMenu(true);
  }
}

function buyItem(kind, id) {
  const player = playerOf(state);
  if (state.phase !== ROUND_PHASE.FREEZE) return;
  if (kind === 'weapon') {
    const w = WEAPONS[id];
    if (player.money < w.price || player.weapons.primary === id) return;
    player.money -= w.price;
    player.weapons.primary = id;
    player.weapon = id;
    player.ammo[id] = fullAmmo(id);
    player.switchingUntil = state.time + 0.35;
  } else if (kind === 'grenade') {
    const def = GRENADE_DEFS[id];
    if (player.money < def.price || player.grenades[id] >= 1) return;
    player.money -= def.price;
    player.grenades[id] += 1;
  } else if (kind === 'armor') {
    if (player.money < ARMOR_PRICE || player.armor >= 50) return;
    player.money -= ARMOR_PRICE;
    player.armor = 50;
  }
  queueSound(state, 'buy', null, 0.6);
  hud.openBuy(player);
}

function openBuyMenu() {
  if (state.phase !== ROUND_PHASE.FREEZE) return;
  buyMenuOpen = true;
  hud.openBuy(playerOf(state));
  input.releaseLock();
}

function closeBuyMenu() {
  buyMenuOpen = false;
  hud.closeBuy();
  if (started && !shot) input.requestLock();
}

// --- Player step ------------------------------------------------------------
const _wish = { x: 0, z: 0 };
const _origin = { x: 0, y: 0, z: 0 };
const _dir = { x: 0, y: 0, z: 0 };
let started = false;
let prevMouseDown = false;
let flashUntil = 0;

function aimDirection(c, out) {
  const pitch = c.pitch + c.recoilPitch;
  const cp = Math.cos(pitch);
  out.x = -Math.sin(c.yaw + c.recoilYaw) * cp;
  out.y = Math.sin(pitch);
  out.z = -Math.cos(c.yaw + c.recoilYaw) * cp;
  return out;
}

function stepPlayer(dt) {
  const player = playerOf(state);
  if (!player.alive) return;
  // Look.
  const [dx, dy] = input.consumeLook();
  if (input.locked) {
    player.yaw -= dx * 0.0022;
    player.pitch -= dy * 0.0022;
    player.pitch = Math.max(-1.45, Math.min(1.45, player.pitch));
  }
  // Recoil recovery and bloom decay.
  player.recoilPitch *= Math.exp(-6 * dt);
  player.recoilYaw *= Math.exp(-6 * dt);
  player.spreadBloom = Math.max(0, player.spreadBloom - WEAPONS[player.weapon].bloomDecay * dt * 2);
  // Movement (frozen during buy time).
  const canMove = state.phase === ROUND_PHASE.LIVE || state.phase === ROUND_PHASE.END;
  let forward = 0;
  let strafe = 0;
  if (canMove && input.locked) {
    if (input.down('w')) forward += 1;
    if (input.down('s')) forward -= 1;
    if (input.down('d')) strafe += 1;
    if (input.down('a')) strafe -= 1;
  }
  wishDirection(player.yaw, forward, strafe, _wish);
  if (input.down('shift')) {
    _wish.x *= 0.5;
    _wish.z *= 0.5;
  }
  const moving = isMoving(player);
  stepPlayerMovement(player, _wish, dt, input.down('Space'), input.down('Control') || input.down('c'));
  // Fire.
  const weapon = WEAPONS[player.weapon];
  const trigger = weapon.auto ? input.mouseDown : input.mouseDown && !prevMouseDown;
  if (trigger && canMove && input.locked && !buyMenuOpen) {
    aimDirection(player, _dir);
    _origin.x = player.pos.x;
    _origin.y = player.pos.y + eyeHeight(player.crouched);
    _origin.z = player.pos.z;
    const result = tryFire(state, player, _origin, _dir, moving, !player.onGround, effects);
    if (result === 'fired') {
      flashUntil = state.time + 0.05;
      kickViewmodel(viewmodel, weapon.kick);
    }
  }
  prevMouseDown = input.mouseDown;
  // Reload, weapon switch, grenades.
  if (input.consumePressed('r')) startReload(state, player);
  if (input.consumePressed('1') && player.weapons.primary) {
    player.weapon = player.weapons.primary;
    player.switchingUntil = state.time + 0.35;
  }
  if (input.consumePressed('2')) {
    player.weapon = player.weapons.secondary;
    player.switchingUntil = state.time + 0.35;
  }
  if (input.consumePressed('q') && player.grenades.frag > 0 && canMove) {
    aimDirection(player, _dir);
    _origin.x = player.pos.x;
    _origin.y = player.pos.y + eyeHeight(player.crouched);
    _origin.z = player.pos.z;
    throwGrenade(state, player, 'frag', _origin, _dir);
  }
  if (input.consumePressed('g') && player.grenades.smoke > 0 && canMove) {
    aimDirection(player, _dir);
    _origin.x = player.pos.x;
    _origin.y = player.pos.y + eyeHeight(player.crouched);
    _origin.z = player.pos.z;
    throwGrenade(state, player, 'smoke', _origin, _dir);
  }
  // Plant/defuse channel: hold E.
  state.playerWantsChannel = input.down('e') && canMove ? (player.hasCharge ? 'plant' : 'defuse') : null;
  // Buy menu and scoreboard.
  if (input.consumePressed('b')) {
    if (buyMenuOpen) closeBuyMenu();
    else openBuyMenu();
  }
  if (buyMenuOpen) {
    const keys = ['1', '2', '3', '4', '5', '6'];
    const items = [['weapon', 'k7'], ['weapon', 'ar4'], ['weapon', 'dmr'], ['grenade', 'frag'], ['grenade', 'smoke'], ['armor', 'armor']];
    keys.forEach((key, i) => {
      if (input.consumePressed(key)) buyItem(items[i][0], items[i][1]);
    });
    if (input.consumePressed('Escape')) closeBuyMenu();
  }
  hud.showScoreboard(input.down('Tab'));
}

// --- Fixed-step simulation --------------------------------------------------
function stepSimulation(dt) {
  state.time += dt;
  stepRounds(state, dt, effects);
  if (state.phase === ROUND_PHASE.LIVE) {
    stepPlayer(dt);
    for (const c of state.combatants) {
      if (!c.isPlayer && c.bot) stepBot(state, c, dt, effects);
    }
    stepGrenades(state, dt, effects);
    // Expire old smoke clouds.
    for (let i = state.smokeClouds.length - 1; i >= 0; i--) {
      if (state.time > state.smokeClouds[i].until) state.smokeClouds.splice(i, 1);
    }
  } else if (state.phase === ROUND_PHASE.FREEZE || state.phase === ROUND_PHASE.END) {
    // Allow look-around and buy keys during freeze/end, but no movement.
    stepPlayer(dt);
  }
  finishReloads(state);
  // Bomb blink + mesh sync.
  const bomb = state.bomb;
  world.bombGroup.visible = bomb.state === 'planted' || bomb.state === 'dropped';
  if (world.bombGroup.visible) {
    world.bombGroup.position.set(bomb.pos.x, bomb.pos.y, bomb.pos.z);
    if (bomb.state === 'planted') {
      const elapsed = state.time - bomb.plantedAt;
      const rate = Math.max(2, 12 - elapsed * 0.3);
      const on = Math.sin(state.time * rate * Math.PI) > 0;
      world.bombLightMat.color.setHex(on ? 0xff5040 : 0x551510);
    }
  }
}

// --- Render -----------------------------------------------------------------
function syncCamera(time) {
  const player = playerOf(state);
  let view = player;
  if (!player.alive) {
    view = state.combatants.find((c) => c.alive && c.team === player.team) || player;
  }
  const shake = state.shake;
  state.shake = Math.max(0, shake - 0.03);
  const sx = (Math.random() - 0.5) * shake * 0.12;
  const sy = (Math.random() - 0.5) * shake * 0.12;
  camera.position.set(view.pos.x + sx, view.pos.y + eyeHeight(view.crouched) + sy, view.pos.z);
  camera.rotation.order = 'YXZ';
  camera.rotation.y = view.yaw + (Math.random() - 0.5) * shake * 0.01;
  camera.rotation.x = view.pitch + view.recoilPitch;
  camera.rotation.z = 0;
  viewmodel.group.visible = player.alive;
}

function renderFrame(time, dt) {
  world.update(time);
  for (const c of state.combatants) {
    if (c.mesh) updateCombatantMesh(c.mesh, c, time, dt);
  }
  const player = playerOf(state);
  setViewmodelWeapon(viewmodel, player.weapon);
  updateViewmodel(viewmodel, dt, time, isMoving(player), state.time < player.reloadingUntil, flashUntil);
  effects.update(dt, time, state);
  syncCamera(time);
  renderer.render(scene, camera);
  const spread = currentSpread(player, isMoving(player), !player.onGround);
  hud.update(state, player, 4 + spread * 620);
  audio.playQueued(state, { x: player.pos.x, z: player.pos.z, yaw: player.yaw });
}

// --- Screenshot staging -----------------------------------------------------
function setupShot() {
  started = true;
  hud.showMenu(false);
  startMatch(state);
  if (shot === 'start') {
    // Establishing view from behind the Vanguard spawn, menu visible.
    // The round banner would bleed through the menu panel; clear it.
    state.banner = null;
    hud.showMenu(true);
    camera.position.set(0, 7, 28);
    camera.lookAt(0, 1, -10);
    return;
  }
  if (shot === 'buy') {
    // Freeze time with the buy menu open.
    state.banner = null;
    state.time = 2;
    openBuyMenu();
    const player = playerOf(state);
    player.yaw = 0;
    return;
  }
  // play / end: fast-forward the live round, then stage the camera.
  state.phase = ROUND_PHASE.LIVE;
  state.roundEndsAt = state.time + 100;
  const steps = shot === 'end' ? 60 * 55 : 60 * 6;
  for (let i = 0; i < steps; i++) {
    stepSimulation(FIXED_STEP);
    if (shot === 'end' && state.phase === ROUND_PHASE.END) break;
  }
  if (shot === 'end' && state.phase !== ROUND_PHASE.END) {
    // Stage the banner through the real round-end path.
    for (const c of state.combatants) {
      if (c.team === TEAMS.SENTINEL) {
        c.hp = 0;
        c.alive = false;
      }
    }
    stepSimulation(FIXED_STEP);
  }
  if (shot === 'play') {
    stageActionCamera();
  }
}

function stageActionCamera() {
  const player = playerOf(state);
  if (!player.alive) {
    player.alive = true;
    player.hp = 100;
  }
  // Find a vantage on the nav graph with a live enemy actually in sight.
  const spots = [
    { x: 0, z: 8 }, { x: -14, z: 16 }, { x: 14, z: 16 },
    { x: -22, z: -2 }, { x: 21, z: -5 }, { x: 0, z: -11 },
    { x: -8, z: 10 }, { x: 8, z: 10 }, { x: 0, z: 3 },
  ];
  for (const spot of spots) {
    for (const enemy of state.combatants) {
      if (!enemy.alive || enemy.team === player.team) continue;
      const dx = enemy.pos.x - spot.x;
      const dz = enemy.pos.z - spot.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 5 || dist > 30) continue;
      if (!hasLineOfSight(spot.x, 1.62, spot.z, enemy.pos.x, enemy.pos.y + 1.3, enemy.pos.z)) continue;
      player.pos.x = spot.x;
      player.pos.z = spot.z;
      player.yaw = Math.atan2(-dx, -dz);
      player.pitch = 0;
      return;
    }
  }
  player.pos.x = 0;
  player.pos.z = 8;
  player.yaw = 0;
}

// --- Main loop --------------------------------------------------------------
let accumulator = 0;
let lastNow = performance.now();
let frozen = false;

function frame(now) {
  requestAnimationFrame(frame);
  if (frozen) return;
  const dt = Math.min(0.1, (now - lastNow) / 1000);
  lastNow = now;
  accumulator += dt;
  while (accumulator >= FIXED_STEP) {
    stepSimulation(FIXED_STEP);
    accumulator -= FIXED_STEP;
  }
  renderFrame(now / 1000, dt);
  input.endFrame();
  if (state.phase === ROUND_PHASE.MATCH_END && !shot) {
    hud.showMatchEnd(true, state.banner ? state.banner.title : 'MATCH OVER', state.banner ? state.banner.sub : '');
  }
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

input.enable();

if (shot) {
  setupShot();
  // Render twice, then freeze on the staged frame.
  renderFrame(0.1, FIXED_STEP);
  renderFrame(0.12, FIXED_STEP);
  frozen = true;
  window.__shotReady = true;
} else {
  requestAnimationFrame(frame);
}
