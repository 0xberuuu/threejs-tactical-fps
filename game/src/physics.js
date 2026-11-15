// Collision and visibility against the map's axis-aligned boxes. All queries
// are segment/AABB tests — no three.js raycaster in the simulation, so the
// fixed step stays deterministic and allocation-free. Module-scope scratch
// values are reused by every call.
import { MAP } from './mapdata.js';

const HALF = 0.32; // combatant half-width
const STAND_HEIGHT = 1.8;
const CROUCH_HEIGHT = 1.25;

// Precomputed box bounds: [minX, maxX, minY, maxY, minZ, maxZ].
const BOXES = MAP.boxes.map((b) => [
  b.x - b.w / 2, b.x + b.w / 2,
  b.y0 || 0, (b.y0 || 0) + b.h,
  b.z - b.d / 2, b.z + b.d / 2,
]);

export function boxCount() {
  return BOXES.length;
}

export function standHeight() {
  return STAND_HEIGHT;
}

export function crouchHeight() {
  return CROUCH_HEIGHT;
}

// Resolve a combatant AABB against every solid, axis by axis. `pos` is the
// feet position and is mutated in place; `vel` loses the blocked component.
// Returns true when the body is standing on something.
export function moveBody(pos, vel, dt, crouched) {
  const height = crouched ? CROUCH_HEIGHT : STAND_HEIGHT;
  let grounded = false;
  // X axis.
  pos.x += vel.x * dt;
  for (const b of BOXES) {
    if (overlaps(pos, height, b)) {
      if (vel.x > 0) pos.x = b[0] - HALF;
      else if (vel.x < 0) pos.x = b[1] + HALF;
      vel.x = 0;
    }
  }
  // Z axis.
  pos.z += vel.z * dt;
  for (const b of BOXES) {
    if (overlaps(pos, height, b)) {
      if (vel.z > 0) pos.z = b[4] - HALF;
      else if (vel.z < 0) pos.z = b[5] + HALF;
      vel.z = 0;
    }
  }
  // Y axis (ground plane at y=0, plus standing on boxes).
  pos.y += vel.y * dt;
  if (pos.y <= 0) {
    pos.y = 0;
    if (vel.y < 0) vel.y = 0;
    grounded = true;
  }
  for (const b of BOXES) {
    if (overlapsXZ(pos, b) && pos.y < b[3] && pos.y + height > b[2]) {
      if (vel.y <= 0 && pos.y + vel.y * dt <= b[3] && pos.y >= b[3] - 0.6) {
        pos.y = b[3];
        vel.y = 0;
        grounded = true;
      } else if (vel.y > 0) {
        pos.y = b[2] - height;
        vel.y = 0;
      }
    }
  }
  // World bounds.
  pos.x = Math.max(MAP.bounds.minX + HALF, Math.min(MAP.bounds.maxX - HALF, pos.x));
  pos.z = Math.max(MAP.bounds.minZ + HALF, Math.min(MAP.bounds.maxZ - HALF, pos.z));
  return grounded;
}

function overlaps(pos, height, b) {
  return (
    pos.x + HALF > b[0] && pos.x - HALF < b[1] &&
    pos.y + height > b[2] && pos.y < b[3] &&
    pos.z + HALF > b[4] && pos.z - HALF < b[5]
  );
}

function overlapsXZ(pos, b) {
  return pos.x + HALF > b[0] && pos.x - HALF < b[1] && pos.z + HALF > b[4] && pos.z - HALF < b[5];
}

// Slab test: does segment p0->p1 hit the box? Returns the hit fraction t in
// [0,1] or -1. Shared by hitscan and line-of-sight.
export function segmentBoxT(ax, ay, az, bx, by, bz, b) {
  let tmin = 0;
  let tmax = 1;
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  const mins = [b[0], b[2], b[4]];
  const maxs = [b[1], b[3], b[5]];
  const origins = [ax, ay, az];
  const dirs = [dx, dy, dz];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(dirs[i]) < 1e-9) {
      if (origins[i] < mins[i] || origins[i] > maxs[i]) return -1;
    } else {
      let t1 = (mins[i] - origins[i]) / dirs[i];
      let t2 = (maxs[i] - origins[i]) / dirs[i];
      if (t1 > t2) {
        const tmp = t1;
        t1 = t2;
        t2 = tmp;
      }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return -1;
    }
  }
  return tmin;
}

// Nearest wall hit along a segment, or -1 when the way is clear.
export function raycastWalls(ax, ay, az, bx, by, bz) {
  let best = -1;
  for (const b of BOXES) {
    const t = segmentBoxT(ax, ay, az, bx, by, bz, b);
    if (t >= 0 && (best < 0 || t < best)) best = t;
  }
  // Ground plane.
  if (ay > 0 && by <= 0) {
    const t = ay / (ay - by);
    if (best < 0 || t < best) best = t;
  }
  return best;
}

// True when nothing solid stands between two points (eye heights included).
export function hasLineOfSight(ax, ay, az, bx, by, bz) {
  return raycastWalls(ax, ay, az, bx, by, bz) < 0;
}

// Sphere test for a grenade bounce: returns the box hit, or null.
export function sphereHitsBox(x, y, z, r) {
  for (const b of BOXES) {
    const cx = Math.max(b[0], Math.min(x, b[1]));
    const cy = Math.max(b[2], Math.min(y, b[3]));
    const cz = Math.max(b[4], Math.min(z, b[5]));
    const dx = x - cx;
    const dy = y - cy;
    const dz = z - cz;
    if (dx * dx + dy * dy + dz * dz < r * r) return b;
  }
  return null;
}
