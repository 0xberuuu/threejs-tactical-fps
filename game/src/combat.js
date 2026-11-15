// Combat: hitscan firing shared by the player and the bots, analytic hit
// tests against body capsules and head spheres, damage with range falloff
// and armor, grenades with bounce physics, and the pooled visual effects
// (tracers, impact sparks, explosions, smoke). No allocation in the hot
// paths: scratch vectors live at module scope.
import * as THREE from 'three';
import { raycastWalls, sphereHitsBox, hasLineOfSight } from './physics.js';
import { WEAPONS, GRENADE_DEFS, damageAtRange, applyArmor, currentSpread } from './weapons.js';
import { pushFeed, playerOf } from './state.js';
import { queueSound } from './audio.js';
import { MAP } from './mapdata.js';

const BODY_BOTTOM = 0.15;
const BODY_TOP = 1.45;
const BODY_RADIUS = 0.34;
const HEAD_Y = 1.58;
const HEAD_RADIUS = 0.25;

// Scratch values reused by every shot.
const _dir = { x: 0, y: 0, z: 0 };
const _to = { x: 0, y: 0, z: 0 };
const _closest = { x: 0, y: 0, z: 0 };

// Ray vs sphere. Returns t along the ray or -1.
function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r) {
  const lx = cx - ox;
  const ly = cy - oy;
  const lz = cz - oz;
  const tca = lx * dx + ly * dy + lz * dz;
  if (tca < 0) return -1;
  const d2 = lx * lx + ly * ly + lz * lz - tca * tca;
  if (d2 > r * r) return -1;
  const thc = Math.sqrt(r * r - d2);
  const t = tca - thc;
  return t >= 0 ? t : tca + thc;
}

// Ray vs vertical body capsule (segment + radius). Returns t or -1.
function rayCapsule(ox, oy, oz, dx, dy, dz, c) {
  // Closest approach of the ray to the segment x=c.pos.x, z=c.pos.z,
  // y in [feet+BOTTOM, feet+TOP]. Solve in 2D (x/z) first, then check y.
  const px = c.pos.x - ox;
  const pz = c.pos.z - oz;
  const a = dx * dx + dz * dz;
  if (a < 1e-9) {
    // Ray is vertical: hit when horizontally inside the radius.
    if (px * px + pz * pz > BODY_RADIUS * BODY_RADIUS) return -1;
    const y0 = c.pos.y + BODY_BOTTOM;
    const y1 = c.pos.y + BODY_TOP;
    if (dy > 0 && oy < y0) return (y0 - oy) / dy;
    if (dy < 0 && oy > y1) return (y1 - oy) / dy;
    return -1;
  }
  const t = (px * dx + pz * dz) / a;
  if (t < 0) return -1;
  const cx = ox + dx * t;
  const cz = oz + dz * t;
  const ddx = cx - c.pos.x;
  const ddz = cz - c.pos.z;
  if (ddx * ddx + ddz * ddz > BODY_RADIUS * BODY_RADIUS) return -1;
  const y = oy + dy * t;
  const y0 = c.pos.y + BODY_BOTTOM;
  const y1 = c.pos.y + BODY_TOP;
  if (y < y0 || y > y1) return -1;
  return t;
}

// Nearest combatant hit by a ray, or null. Returns { target, dist, head }.
function rayHitCombatant(state, shooter, ox, oy, oz, dx, dy, dz, maxDist) {
  let best = null;
  let bestDist = maxDist;
  for (const c of state.combatants) {
    if (!c.alive || c === shooter || c.team === shooter.team) continue;
    const headT = raySphere(ox, oy, oz, dx, dy, dz, c.pos.x, c.pos.y + HEAD_Y, c.pos.z, HEAD_RADIUS);
    const bodyT = rayCapsule(ox, oy, oz, dx, dy, dz, c);
    let t = -1;
    let head = false;
    if (headT >= 0 && (bodyT < 0 || headT <= bodyT)) {
      t = headT;
      head = true;
    } else if (bodyT >= 0) {
      t = bodyT;
    }
    if (t >= 0 && t < bestDist) {
      bestDist = t;
      best = { target: c, dist: t, head };
    }
  }
  return best;
}

export function applyDamage(state, target, damage, head, attacker) {
  if (!target.alive) return;
  const final = Math.max(1, Math.round(applyArmor(target, damage)));
  target.hp -= final;
  target.flashUntil = state.time + 0.09;
  if (attacker && attacker.isPlayer) {
    state.stats.shotsHit += 1;
    if (head) state.stats.headshots += 1;
    state.lastHitAt = state.time;
    state.lastHitHead = head;
    queueSound(state, head ? 'headshot' : 'hit', null, 0.7);
  }
  if (target.isPlayer) {
    state.damageAt = state.time;
    if (attacker) {
      state.damageFrom = Math.atan2(-(attacker.pos.x - target.pos.x), -(attacker.pos.z - target.pos.z));
    }
    queueSound(state, 'hit', null, 0.4);
  }
  if (target.hp <= 0) {
    target.hp = 0;
    target.alive = false;
    target.deaths += 1;
    if (attacker) {
      attacker.kills += 1;
      attacker.money += 300;
      pushFeed(state, `${attacker.name} ▸ ${target.name}${head ? ' (headshot)' : ''}`, attacker.team);
    } else {
      pushFeed(state, `${target.name} was eliminated`, null);
    }
    if (target.hasCharge) {
      target.hasCharge = false;
      state.bomb.state = 'dropped';
      state.bomb.pos.x = target.pos.x;
      state.bomb.pos.y = 0;
      state.bomb.pos.z = target.pos.z;
      state.bomb.carrierId = -1;
      pushFeed(state, 'The pulse charge was dropped', null);
    }
    queueSound(state, 'step', target.pos, 0.8);
  }
}

// Fire one trigger pull for shooter. `origin` is the muzzle/eye position,
// `baseDir` the aim direction, `moving`/`airborne` feed the spread model.
// Returns 'fired', 'empty', 'cooling' or 'busy'.
export function tryFire(state, shooter, origin, baseDir, moving, airborne, effects) {
  const weapon = WEAPONS[shooter.weapon];
  const now = state.time;
  if (now < shooter.reloadingUntil || now < shooter.switchingUntil) return 'busy';
  const interval = 60 / weapon.rpm;
  if (now - shooter.lastShotAt < interval) return 'cooling';
  const ammo = shooter.ammo[shooter.weapon];
  if (!ammo || ammo.mag <= 0) {
    queueSound(state, 'empty', shooter.pos, 0.5);
    shooter.lastShotAt = now;
    return 'empty';
  }
  ammo.mag -= 1;
  shooter.lastShotAt = now;
  shooter.spreadBloom = Math.min(0.09, shooter.spreadBloom + weapon.bloom);
  shooter.recoilPitch += weapon.recoil;
  shooter.recoilYaw += (state.rng.next() - 0.5) * weapon.recoil * 0.7;
  state.stats.shotsFired += shooter.isPlayer ? 1 : 0;

  const spread = currentSpread(shooter, moving, airborne);
  for (let p = 0; p < weapon.pellets; p++) {
    _dir.x = baseDir.x + (state.rng.next() - 0.5) * 2 * spread;
    _dir.y = baseDir.y + (state.rng.next() - 0.5) * 2 * spread;
    _dir.z = baseDir.z + (state.rng.next() - 0.5) * 2 * spread;
    const len = Math.hypot(_dir.x, _dir.y, _dir.z) || 1;
    _dir.x /= len;
    _dir.y /= len;
    _dir.z /= len;
    const maxDist = weapon.range * 1.6;
    const wallT = raycastWalls(origin.x, origin.y, origin.z, origin.x + _dir.x * maxDist, origin.y + _dir.y * maxDist, origin.z + _dir.z * maxDist);
    const wallDist = wallT >= 0 ? wallT * maxDist : maxDist;
    const hit = rayHitCombatant(state, shooter, origin.x, origin.y, origin.z, _dir.x, _dir.y, _dir.z, Math.min(wallDist, maxDist));
    let endDist = wallDist;
    if (hit) {
      endDist = hit.dist;
      const damage = damageAtRange(weapon, hit.dist) * (hit.head ? weapon.headMult : 1);
      applyDamage(state, hit.target, damage, hit.head, shooter);
      effects.impact(
        origin.x + _dir.x * hit.dist, origin.y + _dir.y * hit.dist, origin.z + _dir.z * hit.dist,
        hit.head ? 0xff6a5a : 0xc23b2a, 6,
      );
    } else if (wallT >= 0) {
      effects.impact(
        origin.x + _dir.x * wallDist, origin.y + _dir.y * wallDist, origin.z + _dir.z * wallDist,
        0xd8cba8, 4,
      );
    }
    _to.x = origin.x + _dir.x * endDist;
    _to.y = origin.y + _dir.y * endDist;
    _to.z = origin.z + _dir.z * endDist;
    effects.tracer(origin, _to);
  }
  queueSound(state, 'shot', shooter.pos, shooter.isPlayer ? 0.9 : 1, weapon.heavy);
  // Gunfire is loud: bots within earshot investigate.
  state.lastGunshot = { pos: { x: shooter.pos.x, z: shooter.pos.z }, team: shooter.team, at: now };
  return 'fired';
}

export function startReload(state, shooter) {
  const weapon = WEAPONS[shooter.weapon];
  const ammo = shooter.ammo[shooter.weapon];
  if (!ammo || ammo.mag >= weapon.mag || ammo.reserve <= 0) return false;
  if (state.time < shooter.reloadingUntil) return false;
  shooter.reloadingUntil = state.time + weapon.reload;
  shooter.reloadWeapon = shooter.weapon;
  queueSound(state, 'reload', shooter.pos, 0.6);
  return true;
}

export function finishReloads(state) {
  for (const c of state.combatants) {
    if (c.reloadingUntil > 0 && state.time >= c.reloadingUntil && c.reloadWeapon) {
      const weapon = WEAPONS[c.reloadWeapon];
      const ammo = c.ammo[c.reloadWeapon];
      if (ammo) {
        const need = weapon.mag - ammo.mag;
        const take = Math.min(need, ammo.reserve);
        ammo.mag += take;
        ammo.reserve -= take;
      }
      c.reloadingUntil = 0;
      c.reloadWeapon = null;
    }
  }
}

// --- Grenades ---------------------------------------------------------------

export function throwGrenade(state, thrower, kind, origin, dir) {
  if (thrower.grenades[kind] <= 0) return false;
  thrower.grenades[kind] -= 1;
  const def = GRENADE_DEFS[kind];
  state.grenades.push({
    kind,
    pos: { x: origin.x, y: origin.y, z: origin.z },
    vel: { x: dir.x * 15 + thrower.vel.x * 0.5, y: dir.y * 15 + 4.5, z: dir.z * 15 + thrower.vel.z * 0.5 },
    fuse: def.fuse,
    owner: thrower,
    mesh: null,
  });
  queueSound(state, 'step', thrower.pos, 0.5);
  return true;
}

export function stepGrenades(state, dt, effects) {
  for (let i = state.grenades.length - 1; i >= 0; i--) {
    const g = state.grenades[i];
    g.fuse -= dt;
    g.vel.y -= 18 * dt;
    g.pos.x += g.vel.x * dt;
    g.pos.y += g.vel.y * dt;
    g.pos.z += g.vel.z * dt;
    // Ground bounce.
    if (g.pos.y < 0.09) {
      g.pos.y = 0.09;
      if (Math.abs(g.vel.y) > 1.5) {
        queueSound(state, 'bounce', g.pos, 0.5);
      }
      g.vel.y = Math.abs(g.vel.y) * 0.42;
      g.vel.x *= 0.7;
      g.vel.z *= 0.7;
    }
    const box = sphereHitsBox(g.pos.x, g.pos.y, g.pos.z, 0.12);
    if (box) {
      // Simple bounce: reverse the dominant velocity component.
      if (Math.abs(g.vel.x) > Math.abs(g.vel.z)) g.vel.x *= -0.45;
      else g.vel.z *= -0.45;
      g.pos.x += g.vel.x * dt;
      g.pos.z += g.vel.z * dt;
    }
    if (g.fuse <= 0) {
      detonate(state, g, effects);
      state.grenades.splice(i, 1);
    }
  }
}

function detonate(state, g, effects) {
  const def = GRENADE_DEFS[g.kind];
  if (g.kind === 'frag') {
    effects.explosion(g.pos.x, g.pos.y, g.pos.z);
    queueSound(state, 'explosion', g.pos, 1.4);
    const listener = playerOf(state);
    const distToPlayer = Math.hypot(g.pos.x - listener.pos.x, g.pos.z - listener.pos.z);
    state.shake = Math.min(1, state.shake + Math.max(0, 1 - distToPlayer / 18));
    for (const c of state.combatants) {
      if (!c.alive || c === g.owner) continue;
      const dx = c.pos.x - g.pos.x;
      const dz = c.pos.z - g.pos.z;
      const dy = c.pos.y + 0.9 - g.pos.y;
      const dist = Math.hypot(dx, dy, dz);
      if (dist > def.radius) continue;
      if (!hasLineOfSight(g.pos.x, g.pos.y + 0.2, g.pos.z, c.pos.x, c.pos.y + 1.2, c.pos.z)) continue;
      const damage = def.maxDamage * (1 - (dist / def.radius) * 0.75);
      applyDamage(state, c, damage, false, g.owner);
    }
  } else {
    effects.smoke(g.pos.x, g.pos.y, g.pos.z, def.radius, def.duration, state.time);
    state.smokeClouds.push({ x: g.pos.x, y: g.pos.y + 1, z: g.pos.z, radius: def.radius, until: state.time + def.duration });
    queueSound(state, 'bounce', g.pos, 0.6);
  }
}

// Is a point inside any live smoke cloud? Bots and the player lose vision
// through smoke; segments through a cloud are treated as blocked.
export function segmentBlockedBySmoke(state, ax, ay, az, bx, by, bz) {
  for (const cloud of state.smokeClouds) {
    if (state.time > cloud.until) continue;
    // Distance from the cloud centre to the segment.
    const abx = bx - ax;
    const aby = by - ay;
    const abz = bz - az;
    const len2 = abx * abx + aby * aby + abz * abz || 1;
    let t = ((cloud.x - ax) * abx + (cloud.y - ay) * aby + (cloud.z - az) * abz) / len2;
    t = Math.max(0, Math.min(1, t));
    const px = ax + abx * t;
    const py = ay + aby * t;
    const pz = az + abz * t;
    const d2 = (px - cloud.x) ** 2 + (py - cloud.y) ** 2 + (pz - cloud.z) ** 2;
    if (d2 < cloud.radius * cloud.radius) return true;
  }
  return false;
}

// --- Pooled visual effects --------------------------------------------------

const MAX_PARTICLES = 700;
const MAX_TRACERS = 20;

export function createEffects(scene) {
  // Particles: one THREE.Points, ring-buffered, no per-frame allocation.
  const positions = new Float32Array(MAX_PARTICLES * 3);
  const colors = new Float32Array(MAX_PARTICLES * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const points = new THREE.Points(geo, new THREE.PointsMaterial({
    size: 0.11, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false,
  }));
  points.frustumCulled = false;
  scene.add(points);
  const parts = [];
  for (let i = 0; i < MAX_PARTICLES; i++) {
    parts.push({ x: 0, y: -999, z: 0, vx: 0, vy: 0, vz: 0, life: 0, maxLife: 1 });
  }
  let partHead = 0;
  const colorScratch = new THREE.Color();

  // Tracers: a pool of line objects, reused.
  const tracerPool = [];
  for (let i = 0; i < MAX_TRACERS; i++) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const line = new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xffd98a, transparent: true, opacity: 0 }));
    line.frustumCulled = false;
    line.visible = false;
    scene.add(line);
    tracerPool.push({ line, life: 0 });
  }
  let tracerHead = 0;

  // Smoke clouds: sprite clusters from one shared radial texture.
  const smokeCanvas = document.createElement('canvas');
  smokeCanvas.width = 64;
  smokeCanvas.height = 64;
  const sctx = smokeCanvas.getContext('2d');
  const gradient = sctx.createRadialGradient(32, 32, 4, 32, 32, 30);
  gradient.addColorStop(0, 'rgba(210,214,218,0.85)');
  gradient.addColorStop(0.6, 'rgba(190,194,198,0.55)');
  gradient.addColorStop(1, 'rgba(180,184,188,0)');
  sctx.fillStyle = gradient;
  sctx.fillRect(0, 0, 64, 64);
  const smokeTexture = new THREE.CanvasTexture(smokeCanvas);
  const clouds = [];
  for (let i = 0; i < 3; i++) {
    const group = new THREE.Group();
    for (let j = 0; j < 9; j++) {
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
        map: smokeTexture, transparent: true, opacity: 0, depthWrite: false,
      }));
      sprite.position.set((Math.random() - 0.5) * 5, 0.5 + Math.random() * 2.4, (Math.random() - 0.5) * 5);
      const scale = 3 + Math.random() * 3;
      sprite.scale.set(scale, scale, 1);
      group.add(sprite);
    }
    group.visible = false;
    scene.add(group);
    clouds.push({ group, until: 0, startedAt: 0, radius: 6 });
  }

  // Grenade meshes: small dark spheres, pooled.
  const grenadeGeo = new THREE.SphereGeometry(0.11, 10, 8);
  const grenadeMat = new THREE.MeshLambertMaterial({ color: 0x2c2f34 });
  const grenadePool = [];
  for (let i = 0; i < 6; i++) {
    const mesh = new THREE.Mesh(grenadeGeo, grenadeMat);
    mesh.visible = false;
    scene.add(mesh);
    grenadePool.push(mesh);
  }

  // Explosion flash light, reused.
  const flashLight = new THREE.PointLight(0xffa050, 0, 26, 1.6);
  scene.add(flashLight);
  let flashUntil = 0;

  function spawnParticle(x, y, z, vx, vy, vz, life, hex) {
    const idx = partHead;
    const p = parts[idx];
    partHead = (partHead + 1) % MAX_PARTICLES;
    p.x = x;
    p.y = y;
    p.z = z;
    p.vx = vx;
    p.vy = vy;
    p.vz = vz;
    p.life = life;
    p.maxLife = life;
    colorScratch.setHex(hex);
    const i3 = idx * 3;
    colors[i3] = colorScratch.r;
    colors[i3 + 1] = colorScratch.g;
    colors[i3 + 2] = colorScratch.b;
  }

  return {
    impact(x, y, z, hex, count) {
      for (let i = 0; i < count; i++) {
        spawnParticle(
          x, y, z,
          (Math.random() - 0.5) * 4, Math.random() * 3 + 0.5, (Math.random() - 0.5) * 4,
          0.25 + Math.random() * 0.3, hex,
        );
      }
    },
    tracer(from, to) {
      const t = tracerPool[tracerHead];
      tracerHead = (tracerHead + 1) % MAX_TRACERS;
      const attr = t.line.geometry.getAttribute('position');
      attr.setXYZ(0, from.x, from.y, from.z);
      attr.setXYZ(1, to.x, to.y, to.z);
      attr.needsUpdate = true;
      t.line.visible = true;
      t.line.material.opacity = 0.85;
      t.life = 0.07;
    },
    explosion(x, y, z) {
      for (let i = 0; i < 46; i++) {
        const angle = Math.random() * Math.PI * 2;
        const up = Math.random() * 0.9 + 0.2;
        const speed = 3 + Math.random() * 8;
        spawnParticle(
          x, y + 0.2, z,
          Math.cos(angle) * speed, up * speed, Math.sin(angle) * speed,
          0.4 + Math.random() * 0.5, Math.random() < 0.5 ? 0xffa050 : 0xffe0a0,
        );
      }
      flashLight.position.set(x, y + 1, z);
      flashLight.intensity = 60;
      flashUntil = performance.now() / 1000 + 0.14;
    },
    smoke(x, y, z, radius, duration, now) {
      const cloud = clouds.find((c) => now > c.until) || clouds[0];
      cloud.group.position.set(x, y, z);
      cloud.group.visible = true;
      cloud.until = now + duration;
      cloud.startedAt = now;
      cloud.radius = radius;
      for (const sprite of cloud.group.children) {
        sprite.material.opacity = 0.85;
      }
    },
    update(dt, time, state) {
      // Particles.
      for (let i = 0; i < MAX_PARTICLES; i++) {
        const p = parts[i];
        if (p.life > 0) {
          p.life -= dt;
          p.vy -= 9 * dt;
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.z += p.vz * dt;
          if (p.y < 0.02) p.y = 0.02;
          positions[i * 3] = p.x;
          positions[i * 3 + 1] = p.y;
          positions[i * 3 + 2] = p.z;
        } else {
          positions[i * 3 + 1] = -999;
        }
      }
      geo.getAttribute('position').needsUpdate = true;
      geo.getAttribute('color').needsUpdate = true;
      // Tracers fade fast.
      for (const t of tracerPool) {
        if (t.life > 0) {
          t.life -= dt;
          t.line.material.opacity = Math.max(0, t.life / 0.07) * 0.85;
          if (t.life <= 0) t.line.visible = false;
        }
      }
      // Smoke clouds drift and fade.
      for (const cloud of clouds) {
        if (!cloud.group.visible) continue;
        const remain = cloud.until - time;
        if (remain <= 0) {
          cloud.group.visible = false;
          continue;
        }
        const age = time - cloud.startedAt;
        const fade = Math.min(1, remain / 2.5) * Math.min(1, age / 0.6);
        cloud.group.rotation.y += dt * 0.12;
        for (const sprite of cloud.group.children) {
          sprite.material.opacity = 0.85 * fade;
        }
      }
      // Explosion flash decay.
      if (flashLight.intensity > 0) {
        flashLight.intensity = time < flashUntil ? 60 : 0;
      }
      // Grenade meshes follow live grenades.
      for (let i = 0; i < grenadePool.length; i++) {
        const mesh = grenadePool[i];
        const g = state.grenades[i];
        if (g) {
          mesh.visible = true;
          mesh.position.set(g.pos.x, g.pos.y, g.pos.z);
          mesh.rotation.x += dt * 6;
        } else {
          mesh.visible = false;
        }
      }
    },
  };
}
