// Character meshes: bot bodies and the player's first-person viewmodel.
// Hit detection is analytic (see combat.js), so these meshes are purely
// visual — styled geometry in the team colours, with walk bob, crouch,
// death poses and hit flashes.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { TEAMS } from './state.js';

const bodyGeo = new THREE.CapsuleGeometry(0.34, 0.85, 4, 12);
const headGeo = new THREE.SphereGeometry(0.23, 14, 12);
const helmetGeo = new THREE.SphereGeometry(0.26, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55);
const gunGeo = new THREE.BoxGeometry(0.09, 0.12, 0.62);
const packGeo = new THREE.BoxGeometry(0.3, 0.38, 0.16);

export function createCombatantMesh(team) {
  const group = new THREE.Group();
  const color = team === TEAMS.VANGUARD ? PALETTE.vanguard : PALETTE.sentinel;
  const dark = team === TEAMS.VANGUARD ? PALETTE.vanguardDark : PALETTE.sentinelDark;
  const bodyMat = new THREE.MeshLambertMaterial({ color });
  const darkMat = new THREE.MeshLambertMaterial({ color: dark });
  const headMat = new THREE.MeshLambertMaterial({ color: PALETTE.head });
  const helmetMat = new THREE.MeshLambertMaterial({ color: PALETTE.helmet });
  const gunMat = new THREE.MeshLambertMaterial({ color: PALETTE.gun });

  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.position.y = 0.95;
  body.castShadow = true;
  const head = new THREE.Mesh(headGeo, headMat);
  head.position.y = 1.62;
  head.castShadow = true;
  const helmet = new THREE.Mesh(helmetGeo, helmetMat);
  helmet.position.y = 1.64;
  const legs = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.5, 0.26), darkMat);
  legs.position.y = 0.25;
  const gun = new THREE.Mesh(gunGeo, gunMat);
  gun.position.set(0.24, 1.28, -0.34);
  const pack = new THREE.Mesh(packGeo, darkMat);
  pack.position.set(0, 1.1, 0.3);
  pack.visible = false; // shown on the charge carrier
  group.add(body, head, helmet, legs, gun, pack);
  return { group, bodyMat, headMat, gun, pack, baseY: 0, bobPhase: Math.random() * 6 };
}

// Sync a mesh to its combatant: position, facing, crouch, walk bob, death
// pose and hit flash. `time` is render time in seconds.
export function updateCombatantMesh(mesh, c, time, dt) {
  const g = mesh.group;
  g.position.set(c.pos.x, c.pos.y, c.pos.z);
  if (!c.alive) {
    // Fallen: lying on the ground, fading into the floor slightly.
    g.rotation.x = -Math.PI / 2 + 0.12;
    g.rotation.z = 0;
    g.position.y = Math.max(0.12, c.pos.y + 0.12);
    return;
  }
  g.rotation.x = 0;
  g.rotation.y = c.yaw;
  const speed = Math.hypot(c.vel.x, c.vel.z);
  mesh.bobPhase += dt * (2 + speed * 1.6);
  const bob = speed > 0.4 ? Math.sin(mesh.bobPhase * 2) * 0.025 : 0;
  g.position.y = c.pos.y + bob;
  const targetScaleY = c.crouched ? 0.78 : 1;
  g.scale.y += (targetScaleY - g.scale.y) * Math.min(1, dt * 12);
  mesh.pack.visible = c.hasCharge;
  // Hit flash: body glows white briefly after taking damage.
  const flashing = c.flashUntil > 0 && time < c.flashUntil;
  mesh.bodyMat.emissive.setHex(flashing ? 0xffffff : 0x000000);
  mesh.bodyMat.emissiveIntensity = flashing ? 0.7 : 0;
}

// --- First-person viewmodel -------------------------------------------------

const vmBodyGeo = new THREE.BoxGeometry(0.09, 0.11, 0.5);
const vmBarrelGeo = new THREE.CylinderGeometry(0.025, 0.025, 0.3, 8);
const vmMagGeo = new THREE.BoxGeometry(0.07, 0.16, 0.1);
const vmGripGeo = new THREE.BoxGeometry(0.07, 0.13, 0.09);
const vmSightGeo = new THREE.BoxGeometry(0.02, 0.04, 0.06);

const VIEWMODEL_SHAPES = {
  p9: { length: 0.32, barrel: 0.12, mag: 0.1 },
  k7: { length: 0.46, barrel: 0.22, mag: 0.18 },
  ar4: { length: 0.58, barrel: 0.32, mag: 0.2 },
  dmr: { length: 0.72, barrel: 0.44, mag: 0.16 },
};

export function createViewmodel(camera) {
  const group = new THREE.Group();
  const gunMat = new THREE.MeshLambertMaterial({ color: PALETTE.gun });
  const accentMat = new THREE.MeshLambertMaterial({ color: PALETTE.gunAccent });
  const body = new THREE.Mesh(vmBodyGeo, gunMat);
  const barrel = new THREE.Mesh(vmBarrelGeo, accentMat);
  barrel.rotation.x = Math.PI / 2;
  const mag = new THREE.Mesh(vmMagGeo, accentMat);
  const grip = new THREE.Mesh(vmGripGeo, gunMat);
  const sight = new THREE.Mesh(vmSightGeo, accentMat);
  group.add(body, barrel, mag, grip, sight);
  // Muzzle flash: additive quad + light, hidden unless firing.
  const flashMat = new THREE.MeshBasicMaterial({
    color: PALETTE.muzzle, transparent: true, opacity: 0,
    blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
  });
  const flash = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.34), flashMat);
  flash.position.z = -0.5;
  group.add(flash);
  const flashLight = new THREE.PointLight(PALETTE.muzzle, 0, 6, 2);
  flashLight.position.set(0, 0, -0.6);
  group.add(flashLight);
  group.position.set(0.27, -0.24, -0.48);
  camera.add(group);
  return {
    group, body, barrel, mag, grip, sight, flash, flashMat, flashLight,
    kick: 0, // recoil offset, decays
    reloadDip: 0,
    swayX: 0, swayY: 0,
    weapon: '',
  };
}

export function setViewmodelWeapon(vm, weaponId) {
  if (vm.weapon === weaponId) return;
  vm.weapon = weaponId;
  const shape = VIEWMODEL_SHAPES[weaponId] || VIEWMODEL_SHAPES.ar4;
  vm.body.scale.z = shape.length / 0.5;
  vm.body.position.z = -shape.length / 2 + 0.08;
  vm.barrel.scale.y = shape.barrel / 0.3;
  vm.barrel.position.set(0, 0.02, -shape.length + 0.02);
  vm.mag.scale.y = shape.mag / 0.16;
  vm.mag.position.set(0, -0.11, -0.12);
  vm.grip.position.set(0, -0.1, 0.08);
  vm.sight.position.set(0, 0.075, -shape.length * 0.55);
  vm.flash.position.z = -shape.length - 0.08;
  vm.flashLight.position.z = -shape.length - 0.1;
}

// Animate the viewmodel: recoil kick, reload dip, walk sway, muzzle flash.
export function updateViewmodel(vm, dt, time, moving, reloading, flashUntil) {
  vm.kick = Math.max(0, vm.kick - dt * 3.2);
  const targetDip = reloading ? 1 : 0;
  vm.reloadDip += (targetDip - vm.reloadDip) * Math.min(1, dt * 8);
  const sway = moving ? Math.sin(time * 9) * 0.008 : 0;
  vm.group.position.set(
    0.27 + sway,
    -0.24 - vm.reloadDip * 0.1 + (moving ? Math.abs(Math.cos(time * 9)) * 0.006 : 0),
    -0.48 + vm.kick * 0.09,
  );
  vm.group.rotation.x = vm.kick * 0.22 + vm.reloadDip * 0.5;
  vm.group.rotation.z = vm.reloadDip * 0.25;
  const flashing = time < flashUntil;
  vm.flashMat.opacity = flashing ? 0.9 : 0;
  vm.flash.rotation.z = flashing ? Math.random() * Math.PI : 0;
  vm.flashLight.intensity = flashing ? 14 : 0;
}

export function kickViewmodel(vm, amount) {
  vm.kick = Math.min(1, vm.kick + amount);
}
