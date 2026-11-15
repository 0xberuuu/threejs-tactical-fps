// Builds the visible Meridian Yard from MAP data: procedural canvas textures
// (no image assets, no network), dusk lighting, sodium lamps, site markers
// and a distant skyline. All geometry is styled boxes and cylinders — the
// game's own art, drawn from its own palette.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { MAP } from './mapdata.js';
import { mulberry32 } from './rng.js';

function canvasTexture(size, draw) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  draw(canvas.getContext('2d'), size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function noiseOver(ctx, size, rng, base, speckles, alpha) {
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  for (let i = 0; i < speckles; i++) {
    const shade = rng() < 0.5 ? '0,0,0' : '255,255,255';
    ctx.fillStyle = `rgba(${shade},${alpha * rng()})`;
    ctx.fillRect(rng() * size, rng() * size, 1 + rng() * 3, 1 + rng() * 3);
  }
}

function makeTextures() {
  const rng = mulberry32(1337);
  const asphalt = canvasTexture(256, (ctx, s) => {
    noiseOver(ctx, s, rng, '#4a4d52', 2600, 0.16);
    ctx.strokeStyle = 'rgba(0,0,0,0.25)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 7; i++) {
      ctx.beginPath();
      let x = rng() * s;
      let y = rng() * s;
      ctx.moveTo(x, y);
      for (let j = 0; j < 5; j++) {
        x += (rng() - 0.5) * 60;
        y += (rng() - 0.5) * 60;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  });
  asphalt.repeat.set(10, 8);

  const concrete = canvasTexture(256, (ctx, s) => {
    noiseOver(ctx, s, rng, '#6b6f76', 2000, 0.12);
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(0, 0, s, 6);
    ctx.fillRect(0, s - 6, s, 6);
  });
  concrete.repeat.set(3, 1);

  const corrugated = canvasTexture(256, (ctx, s) => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, s, s);
    for (let x = 0; x < s; x += 16) {
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.fillRect(x, 0, 5, s);
      ctx.fillStyle = 'rgba(255,255,255,0.14)';
      ctx.fillRect(x + 8, 0, 4, s);
    }
    noiseOver(ctx, s, rng, 'rgba(0,0,0,0)', 300, 0.08);
  });

  const planks = canvasTexture(256, (ctx, s) => {
    ctx.fillStyle = '#8a6b45';
    ctx.fillRect(0, 0, s, s);
    for (let y = 0; y < s; y += 42) {
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect(0, y, s, 3);
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fillRect(0, y + 3, s, 2);
    }
    for (let i = 0; i < 500; i++) {
      ctx.fillStyle = `rgba(0,0,0,${0.05 + rng() * 0.08})`;
      ctx.fillRect(rng() * s, rng() * s, 2, 8 + rng() * 20);
    }
  });

  const hazard = canvasTexture(128, (ctx, s) => {
    ctx.fillStyle = '#c2a35c';
    ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = '#22252a';
    for (let x = -s; x < s * 2; x += 32) {
      ctx.beginPath();
      ctx.moveTo(x, s);
      ctx.lineTo(x + 16, 0);
      ctx.lineTo(x + 32, 0);
      ctx.lineTo(x + 16, s);
      ctx.closePath();
      ctx.fill();
    }
  });
  return { asphalt, concrete, corrugated, planks, hazard };
}

function letterSprite(letter, color) {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'rgba(20,22,26,0.55)';
  ctx.beginPath();
  ctx.arc(64, 64, 58, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(64, 64, 54, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.font = 'bold 72px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(letter, 64, 68);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
  sprite.scale.set(3.2, 3.2, 1);
  return sprite;
}

export function createWorld(scene) {
  const textures = makeTextures();
  const mat = {
    ground: new THREE.MeshLambertMaterial({ map: textures.asphalt }),
    wall: new THREE.MeshLambertMaterial({ map: textures.concrete }),
    containerRust: new THREE.MeshLambertMaterial({ color: PALETTE.containerRust, map: textures.corrugated }),
    containerTeal: new THREE.MeshLambertMaterial({ color: PALETTE.containerTeal, map: textures.corrugated }),
    containerSand: new THREE.MeshLambertMaterial({ color: PALETTE.containerSand, map: textures.corrugated }),
    containerSlate: new THREE.MeshLambertMaterial({ color: PALETTE.containerSlate, map: textures.corrugated }),
    crate: new THREE.MeshLambertMaterial({ map: textures.planks }),
    crateDark: new THREE.MeshLambertMaterial({ color: 0x9a7a52, map: textures.planks }),
    metal: new THREE.MeshLambertMaterial({ color: PALETTE.metal }),
    metalLight: new THREE.MeshLambertMaterial({ color: PALETTE.metalLight }),
    tank: new THREE.MeshLambertMaterial({ color: PALETTE.tank }),
    sandbag: new THREE.MeshLambertMaterial({ color: PALETTE.sandbag }),
    barrel: new THREE.MeshLambertMaterial({ color: PALETTE.barrel }),
    barrelBlue: new THREE.MeshLambertMaterial({ color: PALETTE.barrelBlue }),
    hazard: new THREE.MeshLambertMaterial({ map: textures.hazard }),
  };

  scene.background = new THREE.Color(PALETTE.sky);
  scene.fog = new THREE.Fog(PALETTE.sky, PALETTE.fogNear, PALETTE.fogFar);

  // Lights: cold hemisphere, one warm low sun with shadows, sodium lamps.
  const hemi = new THREE.HemisphereLight(0x9fb4d4, 0x4a4038, 1.35);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffc890, 2.6);
  sun.position.set(-30, 38, 18);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -40;
  sun.shadow.camera.right = 40;
  sun.shadow.camera.top = 40;
  sun.shadow.camera.bottom = -40;
  sun.shadow.camera.far = 120;
  sun.shadow.bias = -0.0004;
  scene.add(sun);
  scene.add(sun.target);

  // Ground.
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(72, 56), mat.ground);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // Painted yard lines: thin emissive-free strips on the ground.
  const lineMat = new THREE.MeshBasicMaterial({ color: PALETTE.groundLine });
  for (const [x, z, w, d] of [[-22, 4, 0.25, 20], [22, 4, 0.25, 20], [0, 16, 20, 0.25]]) {
    const line = new THREE.Mesh(new THREE.PlaneGeometry(w, d), lineMat);
    line.rotation.x = -Math.PI / 2;
    line.position.set(x, 0.02, z);
    scene.add(line);
  }

  // Map solids.
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const tankGeo = new THREE.CylinderGeometry(1, 1, 1, 20);
  const barrelGeo = new THREE.CylinderGeometry(0.55, 0.55, 1.15, 14);
  const group = new THREE.Group();
  for (const b of MAP.boxes) {
    const y0 = b.y0 || 0;
    let mesh;
    if (b.mat === 'tank') {
      mesh = new THREE.Mesh(tankGeo, mat.tank);
      mesh.scale.set(b.w / 2, b.h, b.d / 2);
      mesh.position.set(b.x, y0 + b.h / 2, b.z);
      const stripe = new THREE.Mesh(tankGeo, mat.hazard);
      stripe.scale.set(b.w / 2 + 0.02, 0.35, b.d / 2 + 0.02);
      stripe.position.set(b.x, y0 + b.h - 0.4, b.z);
      group.add(stripe);
    } else if (b.mat === 'barrel' || b.mat === 'barrelBlue') {
      mesh = new THREE.Mesh(barrelGeo, mat[b.mat]);
      mesh.position.set(b.x, y0 + 0.58, b.z);
    } else {
      mesh = new THREE.Mesh(boxGeo, mat[b.mat]);
      mesh.scale.set(b.w, b.h, b.d);
      mesh.position.set(b.x, y0 + b.h / 2, b.z);
    }
    mesh.castShadow = b.h > 1.2;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  scene.add(group);

  // Crane jib over site B (visual only, above play height).
  const jib = new THREE.Mesh(boxGeo, mat.metal);
  jib.scale.set(14, 0.8, 0.8);
  jib.position.set(21, 13.2, -17);
  scene.add(jib);
  const hook = new THREE.Mesh(boxGeo, mat.hazard);
  hook.scale.set(0.5, 1.6, 0.5);
  hook.position.set(15, 12, -17);
  scene.add(hook);

  // Sodium lamp posts with warm point lights.
  const lampLights = [];
  const postGeo = new THREE.CylinderGeometry(0.09, 0.12, 5.2, 8);
  const bulbGeo = new THREE.SphereGeometry(0.22, 10, 8);
  const postMat = new THREE.MeshLambertMaterial({ color: PALETTE.lampPost });
  const bulbMat = new THREE.MeshBasicMaterial({ color: PALETTE.lamp });
  for (const lamp of MAP.lamps) {
    const post = new THREE.Mesh(postGeo, postMat);
    post.position.set(lamp.x, 2.6, lamp.z);
    post.castShadow = true;
    scene.add(post);
    const bulb = new THREE.Mesh(bulbGeo, bulbMat);
    bulb.position.set(lamp.x, 5.3, lamp.z);
    scene.add(bulb);
    const light = new THREE.PointLight(PALETTE.lamp, 22, 20, 1.8);
    light.position.set(lamp.x, 5.1, lamp.z);
    scene.add(light);
    lampLights.push(light);
  }

  // Distant skyline silhouettes beyond the walls.
  const skylineMat = new THREE.MeshBasicMaterial({ color: 0x232c3a, fog: true });
  const skyRng = mulberry32(77);
  for (let i = 0; i < 26; i++) {
    const angle = (i / 26) * Math.PI * 2;
    const radius = 58 + skyRng() * 14;
    const h = 8 + skyRng() * 22;
    const tower = new THREE.Mesh(boxGeo, skylineMat);
    tower.scale.set(6 + skyRng() * 8, h, 6 + skyRng() * 8);
    tower.position.set(Math.cos(angle) * radius, h / 2 - 1, Math.sin(angle) * radius);
    scene.add(tower);
  }

  // Site markers: floating letters + ground rings at the plant zones.
  const siteMarkers = [];
  const ringGeo = new THREE.RingGeometry(2.6, 3.0, 40);
  const ringMat = new THREE.MeshBasicMaterial({ color: PALETTE.hudAccent, transparent: true, opacity: 0.5, side: THREE.DoubleSide });
  for (const site of MAP.sites) {
    const sprite = letterSprite(site.id, '#ffcf7d');
    sprite.position.set(site.plant.x, 5.4, site.plant.z);
    scene.add(sprite);
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(site.plant.x, 0.03, site.plant.z);
    scene.add(ring);
    siteMarkers.push(sprite);
  }

  // The pulse charge: a small device with a blinking light, shown when
  // planted or dropped. Carried state hides it (the carrier's mesh shows it).
  const bombGroup = new THREE.Group();
  const bombBody = new THREE.Mesh(boxGeo, new THREE.MeshLambertMaterial({ color: 0x2c2f34 }));
  bombBody.scale.set(0.5, 0.3, 0.34);
  bombBody.position.y = 0.15;
  const bombLightMat = new THREE.MeshBasicMaterial({ color: PALETTE.explosive });
  const bombLight = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), bombLightMat);
  bombLight.position.set(0.15, 0.34, 0);
  bombGroup.add(bombBody, bombLight);
  bombGroup.visible = false;
  scene.add(bombGroup);

  return {
    lampLights,
    siteMarkers,
    bombGroup,
    bombLightMat,
    // Gentle lamp flicker; cheap and only touches light intensity.
    update(time) {
      for (let i = 0; i < lampLights.length; i++) {
        lampLights[i].intensity = 22 + Math.sin(time * 7 + i * 2.1) * 0.7;
      }
    },
  };
}
