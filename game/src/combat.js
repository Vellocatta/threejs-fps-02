// Combat: hitscan shots, grenade throws, the bomb. One raycaster is reused; tracers and
// grenades are small pooled meshes so the hot loop allocates nothing.
import * as THREE from 'three';
import { WEAPONS } from './weapons.js';
import { SITE } from './map.js';
import { EYE_STAND, EYE_CROUCH } from './agents.js';

const TRACER_POOL = 24;
const GRENADE_POOL = 4;

export function createCombat(scene, shootables) {
  const raycaster = new THREE.Raycaster();
  raycaster.far = 90;
  const direction = new THREE.Vector3();
  const origin = new THREE.Vector3();
  const tracers = [];
  for (let i = 0; i < TRACER_POOL; i += 1) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.02, 0.02, 1),
      new THREE.MeshBasicMaterial({ color: 0xffc46b, transparent: true, opacity: 0 }),
    );
    mesh.visible = false;
    scene.add(mesh);
    tracers.push({ mesh, life: 0, from: new THREE.Vector3(), to: new THREE.Vector3() });
  }
  let tracerIndex = 0;
  const grenades = [];
  for (let i = 0; i < GRENADE_POOL; i += 1) {
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.14, 10, 8),
      new THREE.MeshStandardMaterial({ color: 0x3fc1a8, roughness: 0.4, metalness: 0.5 }),
    );
    mesh.visible = false;
    scene.add(mesh);
    grenades.push({ mesh, active: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, fuse: 0, team: null });
  }
  let grenadeIndex = 0;
  // The planted charge: a small blinking box that appears on the site.
  const bombMesh = new THREE.Group();
  const bombBox = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.25, 0.3), new THREE.MeshStandardMaterial({ color: 0xff4d3d, roughness: 0.5 }));
  const bombLight = new THREE.PointLight(0xff4d3d, 0, 8);
  bombLight.position.y = 0.5;
  bombMesh.add(bombBox, bombLight);
  bombMesh.position.set(SITE.x, 0.15, SITE.z);
  bombMesh.visible = false;
  scene.add(bombMesh);

  function spawnTracer(from, to) {
    const t = tracers[tracerIndex];
    tracerIndex = (tracerIndex + 1) % TRACER_POOL;
    t.from.copy(from);
    t.to.copy(to);
    t.life = 0.09;
    t.mesh.visible = true;
    const mid = new THREE.Vector3().addVectors(from, to).multiplyScalar(0.5);
    const len = from.distanceTo(to);
    t.mesh.position.copy(mid);
    t.mesh.scale.set(1, 1, Math.max(0.1, len));
    t.mesh.lookAt(to);
  }

  function stepTracers(dt) {
    for (const t of tracers) {
      if (t.life <= 0) continue;
      t.life -= dt;
      t.mesh.material.opacity = Math.max(0, t.life / 0.09) * 0.85;
      if (t.life <= 0) t.mesh.visible = false;
    }
  }

  // Fire one hitscan shot from `shooter` toward `yaw/pitch` with `spread` radians.
  // Returns {hit, killed, victim, head, point} or null when nothing was hit.
  function shoot(shooter, yaw, pitch, spread, random, agents) {
    const def = WEAPONS[shooter.weaponId];
    const eye = shooter.crouched ? EYE_CROUCH : EYE_STAND;
    origin.set(shooter.x, shooter.y + eye, shooter.z);
    direction.set(-Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), -Math.cos(yaw) * Math.cos(pitch));
    direction.x += (random() * 2 - 1) * spread;
    direction.y += (random() * 2 - 1) * spread;
    direction.z += (random() * 2 - 1) * spread;
    direction.normalize();
    raycaster.set(origin, direction);
    const hits = raycaster.intersectObjects(shootables, false);
    const wallDist = hits.length > 0 ? hits[0].distance : 90;
    let best = null;
    let bestDist = wallDist;
    // Test each living agent's head/body boxes by ray-sphere-ish distance to the ray.
    // No friendly fire: a shot can only hit the other team.
    for (const victim of agents) {
      if (!victim.alive || victim === shooter || victim.team === shooter.team) continue;
      const hitPart = rayHitsAgent(origin, direction, victim, wallDist);
      if (hitPart && hitPart.dist < bestDist) {
        bestDist = hitPart.dist;
        best = { victim, head: hitPart.head };
      }
    }
    const end = origin.clone().addScaledVector(direction, best ? bestDist : wallDist);
    spawnTracer(origin, end);
    if (!best) return { hit: false, point: end };
    const falloff = Math.max(0.5, 1 - bestDist / (def.range * 2));
    const damage = Math.round(def.damage * (best.head ? def.headMult : 1) * falloff);
    best.victim.health -= damage;
    const killed = best.victim.health <= 0;
    if (killed) {
      best.victim.health = 0;
      best.victim.alive = false;
      if (best.victim.mesh) best.victim.mesh.deathT = 0;
    }
    return { hit: true, killed, victim: best.victim, head: best.head, damage, point: end };
  }

  // Ray vs agent: head sphere at eye height, body capsule approximated by two spheres.
  function rayHitsAgent(origin, dir, agent, maxDist) {
    const eye = agent.crouched ? EYE_CROUCH : EYE_STAND;
    const headC = { x: agent.x, y: agent.y + eye - 0.08, z: agent.z };
    const bodyC = { x: agent.x, y: agent.y + 0.95, z: agent.z };
    const head = raySphere(origin, dir, headC, 0.26);
    if (head !== null && head < maxDist) return { dist: head, head: true };
    const body = raySphere(origin, dir, bodyC, 0.55);
    if (body !== null && body < maxDist) return { dist: body, head: false };
    return null;
  }

  function raySphere(origin, dir, center, radius) {
    const ox = center.x - origin.x;
    const oy = center.y - origin.y;
    const oz = center.z - origin.z;
    const tca = ox * dir.x + oy * dir.y + oz * dir.z;
    if (tca < 0) return null;
    const d2 = ox * ox + oy * oy + oz * oz - tca * tca;
    if (d2 > radius * radius) return null;
    return tca - Math.sqrt(radius * radius - d2);
  }

  function throwGrenade(shooter, yaw, pitch) {
    const g = grenades[grenadeIndex];
    grenadeIndex = (grenadeIndex + 1) % GRENADE_POOL;
    const eye = shooter.crouched ? EYE_CROUCH : EYE_STAND;
    g.active = true;
    g.x = shooter.x;
    g.y = shooter.y + eye;
    g.z = shooter.z;
    const speed = 13;
    g.vx = -Math.sin(yaw) * Math.cos(pitch) * speed;
    g.vy = Math.sin(pitch) * speed + 3.5;
    g.vz = -Math.cos(yaw) * Math.cos(pitch) * speed;
    g.fuse = 1.6;
    g.team = shooter.team;
    g.mesh.visible = true;
    g.mesh.position.set(g.x, g.y, g.z);
  }

  // Grenade physics: gravity, bounce off the ground and walls, explode on fuse.
  function stepGrenades(dt, agents, onExplode) {
    for (const g of grenades) {
      if (!g.active) continue;
      g.fuse -= dt;
      g.vy -= 22 * dt;
      g.x += g.vx * dt;
      g.y += g.vy * dt;
      g.z += g.vz * dt;
      if (g.y < 0.14) { g.y = 0.14; g.vy = Math.abs(g.vy) * 0.35; g.vx *= 0.6; g.vz *= 0.6; }
      if (g.x < -23.5 || g.x > 23.5) g.vx *= -0.4;
      if (g.z < -17.5 || g.z > 17.5) g.vz *= -0.4;
      g.mesh.position.set(g.x, g.y, g.z);
      if (g.fuse <= 0) {
        g.active = false;
        g.mesh.visible = false;
        const victims = [];
        for (const a of agents) {
          if (!a.alive) continue;
          const d = Math.hypot(a.x - g.x, a.z - g.z);
          if (d < 6) {
            const dmg = Math.round(110 * (1 - d / 6) + 10);
            a.health -= dmg;
            if (a.health <= 0) { a.health = 0; a.alive = false; if (a.mesh) a.mesh.deathT = 0; }
            victims.push({ victim: a, damage: dmg, killed: !a.alive });
          }
        }
        onExplode({ x: g.x, y: g.y, z: g.z, victims, team: g.team });
      }
    }
  }

  function setBombVisible(visible, fuseFraction) {
    bombMesh.visible = visible;
    if (visible) {
      bombLight.intensity = fuseFraction > 0.2 ? 6 + Math.sin(fuseFraction * 40) * 4 : 14;
      bombBox.scale.setScalar(1 + Math.sin(fuseFraction * 30) * 0.05);
    }
  }

  return { shoot, throwGrenade, stepGrenades, stepTracers, setBombVisible };
}
