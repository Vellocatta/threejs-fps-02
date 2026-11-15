// Bot brains. Each bot has a role and a state machine:
//   route — walk the waypoint graph to a goal (site, hold spot, sound, defuse)
//   hold  — face an angle and wait, scanning for a target
//   fight — a target is visible: strafe a little, fire in bursts, take cover when hurt
//   plant — the carrier stands on the site holding E (simulated by a timer)
//   defuse — after the plant, run to the site and hold E
// Bots see with a 2D wall check plus a range and a front-facing cone; they hear gunshots
// within 25 m and investigate. Accuracy is deliberately human: bursts, pauses, spread.
import { findRoute, blockedByWall, SITE, WAYPOINTS } from './map.js';
import { EYE_STAND } from './agents.js';
import { pick } from './rng.js';

const SEE_RANGE = 34;
const HEAR_RANGE = 25;
const REACTION = { easy: 0.55, mid: 0.38, hard: 0.28 };

export function createBot(agent, role, random) {
  agent.bot = {
    role, // 'carrier' | 'entry' | 'support' | 'holder' | 'teammate'
    state: 'route',
    route: [],
    routeIndex: 0,
    nodeDist: Infinity, // stuck guard: closest distance to the current route node
    nodeTimer: 0,
    holdSpot: null,
    holdYaw: 0,
    holdUntil: 0,
    target: null,
    seenAt: -10,
    lastShotAt: -10,
    burstLeft: 0,
    burstPause: 0,
    strafeDir: 1,
    strafeUntil: 0,
    aimError: 0.03,
    plantTimer: 0,
    defuseTimer: 0,
    investigate: null,
    skill: pick(random, ['mid', 'mid', 'hard']),
  };
  return agent;
}

function nearestVisibleEnemy(bot, agents, colliders, now) {
  let best = null;
  let bestDist = Infinity;
  for (const other of agents) {
    if (!other.alive || other.team === bot.team) continue;
    const dx = other.x - bot.x;
    const dz = other.z - bot.z;
    const dist = Math.hypot(dx, dz);
    if (dist > SEE_RANGE || dist >= bestDist) continue;
    // Front cone (bots notice movement behind them only when very close).
    // Yaw follows the mesh/shot convention: forward is (-sin yaw, -cos yaw).
    const toTarget = Math.atan2(-dx, -dz);
    let diff = Math.abs(toTarget - bot.yaw);
    if (diff > Math.PI) diff = Math.PI * 2 - diff;
    if (dist > 6 && diff > 1.9) continue;
    if (blockedByWall(colliders, bot.x, bot.z, other.x, other.z, 1.4)) continue;
    best = other;
    bestDist = dist;
  }
  if (best) {
    // seenAt is the REACTION clock: it starts when a NEW target is acquired and
    // must not be refreshed while the target stays visible, or the bot never fires.
    if (bot.bot.target !== best) {
      bot.bot.seenAt = now;
      bot.bot.target = best;
    }
  }
  return best;
}

function setRoute(bot, to, random) {
  bot.bot.route = findRoute({ x: bot.x, z: bot.z }, to);
  bot.bot.routeIndex = 0;
  bot.bot.state = 'route';
}

function followRoute(bot, dt, colliders) {
  const b = bot.bot;
  if (b.routeIndex >= b.route.length) return { x: 0, z: 0, arrived: true };
  const node = b.route[b.routeIndex];
  const dx = node.x - bot.x;
  const dz = node.z - bot.z;
  const dist = Math.hypot(dx, dz);
  if (dist < 0.6) {
    b.routeIndex += 1;
    b.nodeDist = Infinity;
    b.nodeTimer = 0;
    return { x: 0, z: 0, arrived: b.routeIndex >= b.route.length };
  }
  // Stuck guard: if we are not closing on the node (a wall or an unreachable
  // waypoint, e.g. inside the reactor), give up on it after 2 s and move on.
  if (dist < b.nodeDist - 0.1) {
    b.nodeDist = dist;
    b.nodeTimer = 0;
  } else {
    b.nodeTimer += dt;
    if (b.nodeTimer > 2) {
      b.routeIndex += 1;
      b.nodeDist = Infinity;
      b.nodeTimer = 0;
      return { x: 0, z: 0, arrived: b.routeIndex >= b.route.length };
    }
  }
  const speed = bot.crouched ? 2.4 : 4.6;
  return { x: (dx / dist) * speed, z: (dz / dist) * speed, arrived: false };
}

function pickHoldSpot(bot, random) {
  const spots = WAYPOINTS.filter((w) => w.x > -20 && w.x < 20);
  const spot = pick(random, spots);
  return { x: spot.x, z: spot.z };
}

// One fixed-step tick for one bot. `world` carries agents, colliders, state, and the
// callbacks main.js wires in (shoot, plant, defuse, hear). Returns a wish velocity.
export function botStep(bot, dt, world, random) {
  const b = bot.bot;
  const now = world.state.elapsed;
  if (!bot.alive) return { x: 0, z: 0 };

  // Hearing: a shot nearby becomes an investigate point.
  const heard = world.state.lastShotHeard;
  if (heard && heard.team !== bot.team && heard.at > now - 1.5) {
    const d = Math.hypot(heard.x - bot.x, heard.z - bot.z);
    if (d < HEAR_RANGE && !b.investigate) b.investigate = { x: heard.x, z: heard.z };
  }

  const enemy = nearestVisibleEnemy(bot, world.agents, world.colliders, now);
  const sees = !!enemy; // visible right now (seenAt is the reaction clock, not freshness)
  const enemyDist = enemy ? Math.hypot(enemy.x - bot.x, enemy.z - bot.z) : Infinity;
  // The carrier pushes the objective: a distant defender (18 m+) cannot stop a
  // 3 s plant, so it does not stop to trade shots with one — it keeps routing.
  const carrierPushing = bot.team === 'ash' && bot.carrier && world.state.bomb.state === 'idle';

  // --- bomb logic overrides everything for the carrier and for defusers ---
  const bomb = world.state.bomb;
  if (bot.team === 'ash' && bot.carrier && bomb.state === 'idle') {
    const dSite = Math.hypot(SITE.x - bot.x, SITE.z - bot.z);
    if (dSite < SITE.radius && enemyDist >= 18) {
      b.state = 'plant';
      b.plantTimer += dt;
      world.onPlantTick(bot, b.plantTimer);
      if (b.plantTimer >= 3) world.onPlanted(bot);
      return { x: 0, z: 0 };
    }
    if (b.state !== 'route' || b.route.length === 0) setRoute(bot, { x: SITE.x, z: SITE.z }, random);
  }
  if (bomb.state === 'planted') {
    if (bot.team === 'ash') {
      // Defenders of the plant: hold the site and its doors.
      if (!b.holdSpot) {
        b.holdSpot = pickHoldSpot(bot, random);
        if (Math.hypot(b.holdSpot.x - SITE.x, b.holdSpot.z - SITE.z) > 12) b.holdSpot = { x: SITE.x + 3, z: SITE.z + 3 };
      }
      if (b.state !== 'hold') {
        setRoute(bot, b.holdSpot, random);
        if (Math.hypot(bot.x - b.holdSpot.x, bot.z - b.holdSpot.z) < 1) b.state = 'hold';
      }
    } else {
      // Ember must defuse: run to the site, then hold E.
      const dSite = Math.hypot(SITE.x - bot.x, SITE.z - bot.z);
      if (dSite < 2.5 && !sees) {
        b.state = 'defuse';
        b.defuseTimer += dt;
        world.onDefuseTick(bot, b.defuseTimer);
        if (b.defuseTimer >= 5) world.onDefused(bot);
        return { x: 0, z: 0 };
      }
      if (b.state !== 'route' || b.route.length === 0) setRoute(bot, { x: SITE.x, z: SITE.z }, random);
    }
  }

  // --- combat ---
  // The pushing carrier does not stop for a distant enemy: it keeps routing.
  if (sees && !(carrierPushing && enemyDist >= 18)) {
    b.state = 'fight';
    const dx = enemy.x - bot.x;
    const dz = enemy.z - bot.z;
    const dist = Math.hypot(dx, dz);
    const aimYaw = Math.atan2(-dx, -dz);
    bot.yaw += shortestAngle(bot.yaw, aimYaw) * Math.min(1, dt * 8);
    // Aim at the enemy's body centre, not horizontally: a level shot flies over
    // the body sphere (top 1.5 m) and can only clip the head, so bots never killed.
    bot.pitch = Math.atan2(enemy.y + 0.95 - (bot.y + EYE_STAND), dist);
    // Strafe to be a harder target; pause between bursts.
    if (now > b.strafeUntil) {
      b.strafeDir = random() < 0.5 ? -1 : 1;
      b.strafeUntil = now + 0.7 + random() * 0.8;
    }
    b.burstPause -= dt;
    if (b.burstPause <= 0) {
      if (b.burstLeft <= 0) {
        b.burstLeft = 3 + Math.floor(random() * 4);
        b.burstPause = 0.35 + random() * 0.5;
      } else if (now - b.seenAt > REACTION[b.skill]) {
        b.burstLeft -= 1;
        world.onBotShoot(bot, enemy, dist);
      }
    }
    const strafe = b.strafeDir * 1.6;
    const back = dist < 6 ? -1.5 : 0;
    const fx = -Math.sin(bot.yaw);
    const fz = -Math.cos(bot.yaw);
    return { x: fx * back - fz * strafe, z: fz * back + fx * strafe, arrived: false };
  }

  // Lost the target: keep the last known spot in mind briefly, then move on.
  if (b.state === 'fight') {
    b.state = 'route';
    b.route = [];
    if (b.target) b.investigate = { x: b.target.x, z: b.target.z };
    b.target = null;
  }

  // --- movement states ---
  if (b.state === 'hold') {
    bot.yaw += shortestAngle(bot.yaw, b.holdYaw) * Math.min(1, dt * 4);
    if (now > b.holdUntil) {
      b.state = 'route';
      b.route = [];
      b.holdSpot = null;
    }
    return { x: 0, z: 0 };
  }
  if (b.investigate && b.state !== 'route') {
    setRoute(bot, b.investigate, random);
    b.investigate = null;
  }
  if (b.state === 'route' && b.route.length > 0) {
    const step = followRoute(bot, dt, world.colliders);
    if (step.arrived) {
      if (bomb.state === 'planted' && bot.team === 'ember') {
        // arrived at site — handled above next tick
      } else {
        b.holdSpot = { x: bot.x, z: bot.z };
        b.holdYaw = random() * Math.PI * 2;
        b.holdUntil = now + 2 + random() * 4;
        b.state = 'hold';
      }
      return { x: 0, z: 0 };
    }
    bot.yaw = Math.atan2(-step.x, -step.z);
    return step;
  }
  // No orders: pick a goal by role.
  if (bot.team === 'ash') {
    if (bot.carrier) setRoute(bot, { x: SITE.x, z: SITE.z }, random);
    else if (b.role === 'holder') {
      const spot = pickHoldSpot(bot, random);
      setRoute(bot, spot, random);
    } else {
      setRoute(bot, pick(random, [{ x: 0, z: 4 }, { x: -8, z: 6 }, { x: 8, z: 6 }, { x: SITE.x, z: SITE.z }]), random);
    }
  } else {
    // Teammates push mid or shadow the player's lane.
    const player = world.agents.find((a) => a.isPlayer);
    const anchor = player && player.alive ? { x: player.x, z: player.z } : { x: 0, z: 0 };
    setRoute(bot, { x: anchor.x + (random() * 10 - 5), z: anchor.z - 6 - random() * 6 }, random);
  }
  return { x: 0, z: 0 };
}

function shortestAngle(from, to) {
  let diff = to - from;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return diff;
}
