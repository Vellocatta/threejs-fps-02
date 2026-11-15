// Kestrel Yard: a dusk solar yard, 48 x 36 m. Three lanes run north-south — Array Row (west),
// Mid past the transformer, Pipe Run (east) — and the Reactor site sits in the north-east
// compound. Every solid box is a movement collider and a bullet stopper; the waypoint graph
// below is what the bots walk. Original map, invented for this game.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const HALF_X = 24;
const HALF_Z = 18;

// Waypoints: id, x, z, neighbours. Lanes: west 1-6, mid 10-15, east 20-25, site 30-34.
export const WAYPOINTS = [
  { id: 0, x: -16, z: 14, links: [1, 10] },   // Ember spawn west
  { id: 1, x: -18, z: 6, links: [0, 2, 11] }, // Array Row south
  { id: 2, x: -18, z: -2, links: [1, 3, 12] },
  { id: 3, x: -18, z: -9, links: [2, 4, 31] },
  { id: 4, x: -14, z: -14, links: [3, 5, 30] }, // Ash spawn west
  { id: 5, x: -8, z: -15, links: [4, 6] },
  { id: 6, x: 0, z: -15, links: [5, 7, 14] },  // Ash spawn mid
  { id: 7, x: 8, z: -15, links: [6] },
  { id: 8, x: 14, z: -14, links: [9, 32] }, // Ash spawn east
  { id: 9, x: 18, z: -9, links: [8, 32] },
  { id: 10, x: -8, z: 14, links: [0, 11, 15] }, // Ember spawn mid
  { id: 11, x: -8, z: 6, links: [1, 10, 12, 15] },
  { id: 12, x: -8, z: -2, links: [2, 11, 13, 14] },
  { id: 13, x: -8, z: -9, links: [12, 14, 30] },
  { id: 14, x: 0, z: -8, links: [6, 12, 13] }, // mid cross
  { id: 15, x: 0, z: 14, links: [10, 11, 16] }, // Ember spawn centre
  { id: 16, x: 8, z: 14, links: [15, 17, 21] },
  { id: 17, x: 8, z: 6, links: [16, 18, 21] },
  { id: 18, x: 8, z: -2, links: [17, 14, 19, 22, 34] },
  { id: 19, x: 8, z: -9, links: [18, 31] },
  { id: 20, x: 14, z: -14, links: [8, 32] },
  { id: 21, x: 2, z: 4, links: [16, 17, 18] }, // mid plaza
  { id: 22, x: 18, z: -2, links: [18, 23, 34] }, // Pipe Run
  { id: 23, x: 18, z: 6, links: [22, 24] },
  { id: 24, x: 16, z: 14, links: [16, 23, 25] }, // Ember spawn east
  { id: 25, x: 8, z: 14, links: [24, 16] },
  { id: 30, x: -2, z: -12, links: [4, 13, 31] }, // site approach west
  { id: 31, x: 6, z: -12, links: [3, 19, 30] },
  { id: 32, x: 14, z: -11, links: [8, 9, 20, 33, 34] }, // site door
  { id: 33, x: 16, z: -9, links: [32] }, // site approach, just south of the Reactor core face
  { id: 34, x: 13, z: -4, links: [18, 22, 32] }, // south of the site door
];

export const SITE = { x: 16, z: -12, radius: 4.2, name: 'REACTOR' };
export const EMBER_SPAWN = [{ x: -16, z: 14 }, { x: -8, z: 14 }, { x: 0, z: 14 }, { x: 8, z: 14 }];
export const ASH_SPAWN = [{ x: -14, z: -14 }, { x: -6, z: -15 }, { x: 4, z: -15 }, { x: 14, z: -14 }];

export function createMap(scene) {
  const group = new THREE.Group();
  scene.add(group);
  const colliders = []; // {x0,z0,x1,z1,h} — 2D AABBs with a height for crouch cover
  const shootables = [];

  const mats = {};
  for (const [name, hex] of Object.entries(PALETTE)) {
    mats[name] = new THREE.MeshStandardMaterial({ color: new THREE.Color(hex), roughness: 0.9, metalness: 0.05 });
  }
  mats.panelTop = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.panelTop), roughness: 0.35, metalness: 0.6 });
  mats.panel = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.panel), roughness: 0.6, metalness: 0.4 });

  function box(w, h, d, x, y, z, mat, solid = true) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mats[mat]);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    if (solid) {
      colliders.push({ x0: x - w / 2, z0: z - d / 2, x1: x + w / 2, z1: z + d / 2, h });
      shootables.push(mesh);
    }
    return mesh;
  }

  function cylinder(rTop, rBottom, h, x, y, z, mat, segments = 20) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBottom, h, segments), mats[mat]);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    colliders.push({ x0: x - rBottom, z0: z - rBottom, x1: x + rBottom, z1: z + rBottom, h });
    shootables.push(mesh);
    return mesh;
  }

  // Ground: warm sand with a darker mid plaza strip. The ground is not a movement
  // collider — a floor box spans the whole map, and its collider would swallow every step.
  box(48.4, 0.4, 36.4, 0, -0.2, 0, 'ground', false);
  box(10, 0.06, 36, 0, 0.03, 0, 'surface'); // worn mid lane

  // Perimeter walls, 4 m, open to the dusk sky.
  box(0.6, 4, 36.4, -HALF_X, 2, 0, 'wall');
  box(0.6, 4, 36.4, HALF_X, 2, 0, 'wall');
  box(48.4, 4, 0.6, 0, 2, -HALF_Z, 'wall');
  box(48.4, 4, 0.6, 0, 2, HALF_Z, 'wall');

  // Reactor compound (north-east): low walls with a south door (x 12-14) and a west gap.
  box(2, 2.6, 0.5, 11, 1.3, -6.4, 'wall'); // south wall west of the door
  box(8, 2.6, 0.5, 18, 1.3, -6.4, 'wall'); // south wall east of the door
  box(0.5, 2.6, 5.6, 10.2, 1.3, -9.2, 'wall'); // west wall lower half
  box(0.5, 2.6, 5.6, 10.2, 1.3, -15.2, 'wall');
  // Reactor core: glowing cylinder + ring base + hazard stripe base.
  cylinder(1.6, 1.9, 3.4, 16, 1.7, -12, 'panel');
  cylinder(2.3, 2.5, 0.35, 16, 0.175, -12, 'accent'); // low ring: bots step over it (h < 0.4)
  const coreLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 30, 16, 1.6);
  coreLight.position.set(16, 3.4, -12);
  group.add(coreLight);
  box(3.4, 0.9, 1.2, 12.4, 0.45, -15.8, 'container'); // site crate

  // Solar panel rows, west lane: tilted dark-blue panels on frames (visual tilt, box collider).
  for (const [px, pz] of [[-19, 2], [-19, -5], [-13, 2], [-13, -5]]) {
    const panel = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.12, 2.6), mats.panelTop);
    panel.position.set(px, 1.5, pz);
    panel.rotation.x = -0.5;
    panel.castShadow = true;
    panel.receiveShadow = true;
    group.add(panel);
    shootables.push(panel);
    box(0.18, 1.1, 0.18, px - 2, 0.55, pz, 'pipe');
    box(0.18, 1.1, 0.18, px + 2, 0.55, pz, 'pipe');
    // No full-panel ground collider: the legs collide, and bots walk between them.
    // A whole-panel collider blocked the west lane's waypoint line outright.
  }

  // Mid transformer block + crates (the map's central fight).
  box(6, 3.4, 3.6, 0, 1.7, 0, 'surface');
  box(6.4, 0.3, 4, 0, 3.55, 0, 'accent'); // hazard cap
  box(1.8, 1.1, 1.8, -5.5, 0.55, 3.5, 'container');
  box(1.8, 1.1, 1.8, 5.5, 0.55, -3.5, 'container');
  box(1.2, 2.2, 1.2, -3.2, 1.1, -6.5, 'wall');
  box(1.2, 2.2, 1.2, 3.2, 1.1, 6.5, 'wall');

  // Pipe Run (east): raised pipes on trestles + container stack.
  for (const z of [-2, 2, 6]) {
    const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 12, 12), mats.pipe);
    pipe.rotation.x = Math.PI / 2;
    pipe.position.set(20.5, 2.4, z);
    pipe.castShadow = true;
    group.add(pipe);
    shootables.push(pipe);
  }
  box(0.4, 2.4, 0.4, 20.5, 1.2, -6, 'pipe');
  box(0.4, 2.4, 0.4, 20.5, 1.2, 10, 'pipe');
  colliders.push({ x0: 20.1, z0: -7, x1: 20.9, z1: 11, h: 2.4 });
  box(4.4, 2.4, 2.2, 13, 1.2, 8, 'container');
  box(4.4, 2.4, 2.2, 13, 1.2, 8.5, 'container'); // stacked look (offset depth)
  box(2.2, 1.1, 2.2, -12, 0.55, 10, 'container');
  // North-west crate stack: sits clear of the 3->31 / 4->30 / 13->30 waypoint lanes.
  box(2.2, 1.1, 2.2, -10, 0.55, -7, 'container');
  box(1.6, 1.1, 1.6, 19, 0.55, -14.5, 'container');

  // Ember spawn cover + Ash spawn cover. Kept off the spawn->mid waypoint lanes
  // (x = +/-8) so bots routing north/south do not have to slide around them.
  box(2.4, 1.1, 1.2, -12, 0.55, 10.5, 'wall');
  box(2.4, 1.1, 1.2, 12, 0.55, 10.5, 'wall');
  box(2.4, 1.1, 1.2, -12, 0.55, -10.5, 'wall');
  box(2.4, 1.1, 1.2, 12, 0.55, -10.5, 'wall');

  // Dusk lighting: low orange sun from the west, cool sky fill, warm floodlights.
  const sky = new THREE.HemisphereLight(new THREE.Color('#8a7fa8'), new THREE.Color('#3a2a1c'), 0.85);
  scene.add(sky);
  const sun = new THREE.DirectionalLight(new THREE.Color('#ff9a3d'), 2.6);
  sun.position.set(-30, 12, 8);
  sun.target.position.set(4, 0, -4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -30;
  sun.shadow.camera.right = 30;
  sun.shadow.camera.top = 30;
  sun.shadow.camera.bottom = -30;
  sun.shadow.camera.far = 90;
  sun.shadow.bias = -0.0006;
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight(new THREE.Color('#7a8fc0'), 0.5);
  fill.position.set(20, 14, -10);
  scene.add(fill);
  for (const [x, z] of [[0, 0], [16, -6], [-16, 10]]) {
    const lamp = new THREE.PointLight(new THREE.Color('#ffb45e'), 12, 14, 1.8);
    lamp.position.set(x, 4.5, z);
    group.add(lamp);
    box(0.3, 3.2, 0.3, x, 1.6, z, 'pipe');
  }

  return { colliders, shootables, group, sun };
}

// Breadth-first route over the waypoint graph from the nearest node to `from` to the
// nearest node to `to`. Returns an array of {x,z} waypoints (excluding the start node).
export function findRoute(from, to) {
  let start = 0;
  let goal = 0;
  let bestStart = Infinity;
  let bestGoal = Infinity;
  for (const node of WAYPOINTS) {
    const ds = (node.x - from.x) ** 2 + (node.z - from.z) ** 2;
    const dg = (node.x - to.x) ** 2 + (node.z - to.z) ** 2;
    if (ds < bestStart) { bestStart = ds; start = node.id; }
    if (dg < bestGoal) { bestGoal = dg; goal = node.id; }
  }
  const prev = new Map([[start, -1]]);
  const queue = [start];
  // Waypoint ids are not array positions (30-33 sit past index 25): look up by id.
  const byId = new Map(WAYPOINTS.map((w) => [w.id, w]));
  while (queue.length > 0) {
    const current = queue.shift();
    if (current === goal) break;
    for (const next of byId.get(current).links) {
      if (!prev.has(next)) { prev.set(next, current); queue.push(next); }
    }
  }
  if (!prev.has(goal)) return [{ x: to.x, z: to.z }];
  const path = [];
  let node = goal;
  while (node !== start && node !== -1) {
    path.unshift({ x: byId.get(node).x, z: byId.get(node).z });
    node = prev.get(node);
  }
  path.push({ x: to.x, z: to.z });
  return path;
}

// 2D segment vs AABB test: does the line from a to b cross any collider taller than `eyeH`?
export function blockedByWall(colliders, ax, az, bx, bz, eyeH = 1.4) {
  for (const c of colliders) {
    if (c.h < eyeH) continue;
    if (segmentHitsBox(ax, az, bx, bz, c)) return true;
  }
  return false;
}

function segmentHitsBox(ax, az, bx, bz, c) {
  const dx = bx - ax;
  const dz = bz - az;
  let tmin = 0;
  let tmax = 1;
  if (Math.abs(dx) < 1e-9) {
    if (ax < c.x0 || ax > c.x1) return false;
  } else {
    let t1 = (c.x0 - ax) / dx;
    let t2 = (c.x1 - ax) / dx;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return false;
  }
  if (Math.abs(dz) < 1e-9) {
    if (az < c.z0 || az > c.z1) return false;
  } else {
    let t1 = (c.z0 - az) / dz;
    let t2 = (c.z1 - az) / dz;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return false;
  }
  return true;
}
