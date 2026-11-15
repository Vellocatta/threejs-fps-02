// The player: keyboard movement with acceleration, crouch, jump, and view recoil.
// Movement numbers live here; combat lives in combat.js, bots in bots.js.
import { moveBody, EYE_STAND, EYE_CROUCH } from './agents.js';

const WALK_SPEED = 5.2;
const CROUCH_SPEED = 2.6;
const SNEAK_SPEED = 3.1;
const JUMP_SPEED = 5.4;
const GRAVITY = 14;

export function createPlayer(colliders) {
  const body = {
    x: 0, z: 14, y: 0, yaw: Math.PI, pitch: 0,
    vx: 0, vz: 0, vy: 0,
    crouched: false, grounded: true, speed: 0,
  };
  let recoilPitch = 0;
  let recoilYaw = 0;

  function step(dt, keys, collidersRef) {
    const crouch = keys.has('ControlLeft') || keys.has('ControlRight') || keys.has('KeyC');
    body.crouched = crouch;
    const sneak = keys.has('ShiftLeft') || keys.has('ShiftRight');
    const maxSpeed = crouch ? CROUCH_SPEED : sneak ? SNEAK_SPEED : WALK_SPEED;
    let forward = 0;
    let strafe = 0;
    if (keys.has('KeyW') || keys.has('ArrowUp')) forward += 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) forward -= 1;
    if (keys.has('KeyD') || keys.has('ArrowRight')) strafe += 1;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) strafe -= 1;
    const len = Math.hypot(forward, strafe) || 1;
    forward /= len;
    strafe /= len;
    const sin = Math.sin(body.yaw);
    const cos = Math.cos(body.yaw);
    // Forward is -Z rotated by yaw; strafe is perpendicular.
    const wishX = (-sin * forward + cos * strafe) * maxSpeed;
    const wishZ = (-cos * forward - sin * strafe) * maxSpeed;
    moveBody(body, wishX / maxSpeed, wishZ / maxSpeed, dt, collidersRef, maxSpeed);
    // Jump + gravity, ground is y=0.
    if (keys.has('Space') && body.grounded) {
      body.vy = JUMP_SPEED;
      body.grounded = false;
    }
    if (!body.grounded) {
      body.vy -= GRAVITY * dt;
      body.y += body.vy * dt;
      if (body.y <= 0) { body.y = 0; body.vy = 0; body.grounded = true; }
    }
    // Recoil recovery: the view settles back toward where the player aimed.
    recoilPitch *= Math.max(0, 1 - dt * 6);
    recoilYaw *= Math.max(0, 1 - dt * 6);
  }

  function look(dx, dy) {
    body.yaw -= dx * 0.0022;
    body.pitch -= dy * 0.0022;
    body.pitch = Math.max(-1.5, Math.min(1.5, body.pitch));
  }

  function recoil(pitchKick, yawKick) {
    recoilPitch += pitchKick;
    recoilYaw += yawKick;
    body.pitch += pitchKick;
    body.yaw += yawKick;
  }

  function eyeHeight() {
    return body.crouched ? EYE_CROUCH : EYE_STAND;
  }

  return { body, step, look, recoil, eyeHeight };
}
