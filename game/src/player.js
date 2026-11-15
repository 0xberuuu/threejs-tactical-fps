// Player movement: acceleration-based, with friction, crouching, jumping
// and AABB collision. Speed and spread are linked through weapons.js, so
// firing on the move is punished and stopping to aim pays.
import { moveBody } from './physics.js';

const WALK_SPEED = 5.2;
const CROUCH_SPEED = 2.6;
const ACCEL = 58;
const AIR_ACCEL = 12;
const FRICTION = 10;
const JUMP_SPEED = 6.4;
const GRAVITY = 18;
const EYE_STAND = 1.62;
const EYE_CROUCH = 1.1;

export function eyeHeight(crouched) {
  return crouched ? EYE_CROUCH : EYE_STAND;
}

// Wish direction in world space from yaw + input axes. `forward`/`strafe`
// are -1..1. Written into `out` (module scratch in the caller).
export function wishDirection(yaw, forward, strafe, out) {
  const sin = Math.sin(yaw);
  const cos = Math.cos(yaw);
  // Forward is -Z rotated by yaw; right is +X rotated by yaw.
  out.x = -sin * forward + cos * strafe;
  out.z = -cos * forward - sin * strafe;
  const len = Math.hypot(out.x, out.z);
  if (len > 0) {
    out.x /= len;
    out.z /= len;
  }
  return out;
}

export function stepPlayerMovement(body, wish, dt, wantsJump, wantsCrouch) {
  body.crouched = wantsCrouch;
  const maxSpeed = wantsCrouch ? CROUCH_SPEED : WALK_SPEED;
  const accel = body.onGround ? ACCEL : AIR_ACCEL;
  body.vel.x += wish.x * accel * dt;
  body.vel.z += wish.z * accel * dt;
  // Friction only on the ground, and only against sideways drift: it never
  // fights the wish direction, so strafing stays crisp.
  if (body.onGround) {
    const speed = Math.hypot(body.vel.x, body.vel.z);
    if (speed > 0) {
      const drop = Math.min(speed, FRICTION * dt * (wish.x === 0 && wish.z === 0 ? 1 : 0.35));
      body.vel.x -= (body.vel.x / speed) * drop;
      body.vel.z -= (body.vel.z / speed) * drop;
    }
  }
  // Clamp horizontal speed.
  const hSpeed = Math.hypot(body.vel.x, body.vel.z);
  if (hSpeed > maxSpeed) {
    body.vel.x = (body.vel.x / hSpeed) * maxSpeed;
    body.vel.z = (body.vel.z / hSpeed) * maxSpeed;
  }
  if (wantsJump && body.onGround) {
    body.vel.y = JUMP_SPEED;
    body.onGround = false;
  }
  body.vel.y -= GRAVITY * dt;
  body.onGround = moveBody(body.pos, body.vel, dt, body.crouched);
  return body.onGround;
}

export function isMoving(body) {
  return Math.hypot(body.vel.x, body.vel.z) > 0.6;
}
