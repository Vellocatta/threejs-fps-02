// Agents: the player and the seven bots share one body shape — a capsule-ish figure built
// from boxes with a head that takes extra damage. Meshes are built once per agent and reused;
// per-frame work only moves them, never allocates.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const EYE_STAND = 1.62;
export const EYE_CROUCH = 1.12;
export const BODY_RADIUS = 0.38;

const NAMES_EMBER = ['Sable', 'Wren', 'Kite'];
const NAMES_ASH = ['Vex', 'Rook', 'Moth', 'Slag'];

export function agentNames(team, index) {
  return team === 'ember' ? NAMES_EMBER[index] : NAMES_ASH[index];
}

// Shared materials, made once.
let mats = null;
function materials() {
  if (mats) return mats;
  mats = {
    ember: new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), roughness: 0.7, metalness: 0.1 }),
    ash: new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.teal), roughness: 0.7, metalness: 0.1 }),
    dark: new THREE.MeshStandardMaterial({ color: new THREE.Color('#241d17'), roughness: 0.85, metalness: 0.05 }),
    head: new THREE.MeshStandardMaterial({ color: new THREE.Color('#c9a37e'), roughness: 0.8, metalness: 0 }),
  };
  return mats;
}

// A bot's visible body: torso, head, legs, gun. Head and torso carry userData for hit tests.
export function createAgentMesh(scene, team) {
  const m = materials();
  const group = new THREE.Group();
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.72, 0.36), team === 'ember' ? m.ember : m.ash);
  torso.position.y = 1.08;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.34, 0.34), m.head);
  head.position.y = 1.62;
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.72, 0.24), m.dark);
  legL.position.set(-0.16, 0.36, 0);
  const legR = legL.clone();
  legR.position.x = 0.16;
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 0.6), m.dark);
  gun.position.set(0.24, 1.15, -0.3);
  for (const mesh of [torso, head, legL, legR, gun]) {
    mesh.castShadow = true;
    group.add(mesh);
  }
  torso.userData.part = 'body';
  head.userData.part = 'head';
  group.traverse((child) => { child.userData.agentGroup = group; });
  scene.add(group);
  return { group, torso, head, legL, legR };
}

// One agent's simulation state. `isPlayer` agents are driven by input; bots by bots.js.
export function createAgent({ team, name, x, z, yaw = 0, isPlayer = false, carrier = false }) {
  return {
    team, name, isPlayer, carrier,
    health: 100, alive: true,
    x, z, y: 0, yaw, pitch: 0,
    vx: 0, vz: 0, vy: 0,
    crouched: false, grounded: true,
    speed: 0, // horizontal speed, for spread and bot animation
    weaponId: 'pistol',
    weapons: { pistol: { mag: 12, reserve: 36 } },
    grenades: 0,
    kills: 0,
    mesh: null,
    walkPhase: 0,
    // bot-only fields, set by bots.js
    bot: null,
  };
}

// Move a body with acceleration + friction and slide along AABB colliders. Returns nothing;
// mutates agent.vx/vz/x/z. Shared by the player (input wish) and bots (AI wish).
export function moveBody(agent, wishX, wishZ, dt, colliders, maxSpeed) {
  const accel = agent.grounded ? 42 : 12;
  agent.vx += wishX * accel * dt;
  agent.vz += wishZ * accel * dt;
  const friction = agent.grounded ? Math.max(0, 1 - dt * 9) : Math.max(0, 1 - dt * 0.4);
  agent.vx *= friction;
  agent.vz *= friction;
  const speed = Math.hypot(agent.vx, agent.vz);
  if (speed > maxSpeed) {
    agent.vx = (agent.vx / speed) * maxSpeed;
    agent.vz = (agent.vz / speed) * maxSpeed;
  }
  agent.speed = Math.hypot(agent.vx, agent.vz);
  agent.x += agent.vx * dt;
  resolveCollisions(agent, colliders, 0);
  agent.z += agent.vz * dt;
  resolveCollisions(agent, colliders, 1);
  agent.x = Math.max(-23.4, Math.min(23.4, agent.x));
  agent.z = Math.max(-17.4, Math.min(17.4, agent.z));
}

function resolveCollisions(agent, colliders, axis) {
  const r = BODY_RADIUS;
  for (const c of colliders) {
    if (c.h < 0.4) continue;
    if (agent.x + r <= c.x0 || agent.x - r >= c.x1 || agent.z + r <= c.z0 || agent.z - r >= c.z1) continue;
    if (axis === 0) {
      if (agent.vx > 0) agent.x = c.x0 - r;
      else if (agent.vx < 0) agent.x = c.x1 + r;
      agent.vx = 0;
    } else {
      if (agent.vz > 0) agent.z = c.z0 - r;
      else if (agent.vz < 0) agent.z = c.z1 + r;
      agent.vz = 0;
    }
  }
}

// Sync a bot mesh to its body: position, facing, walk-cycle legs, death fall.
export function syncMesh(agent) {
  if (!agent.mesh) return;
  const g = agent.mesh.group;
  g.position.set(agent.x, agent.y, agent.z);
  g.rotation.y = agent.yaw;
  g.visible = agent.alive || agent.mesh.deathT < 1;
  if (!agent.alive) {
    agent.mesh.deathT = Math.min(1, (agent.mesh.deathT || 0) + 0.06);
    g.rotation.x = -Math.PI / 2 * agent.mesh.deathT;
    g.position.y = agent.y - 0.4 * agent.mesh.deathT;
    return;
  }
  agent.walkPhase += agent.speed * 0.09;
  const swing = Math.min(0.5, agent.speed * 0.09);
  agent.mesh.legL.rotation.x = Math.sin(agent.walkPhase * 6) * swing;
  agent.mesh.legR.rotation.x = -Math.sin(agent.walkPhase * 6) * swing;
}
