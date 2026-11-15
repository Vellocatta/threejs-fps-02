// EMBERLINE — Kestrel Yard: a round-based tactical FPS on three.js (threejs-fps-02).
//
// Ember (you + 3 bots) defends the Reactor against Ashfall (4 bots). Ashfall's carrier
// pushes the site and plants the charge; Ember defuses it or wipes Ashfall out. Short
// rounds, money between rounds, a buy menu (B), first to 3 rounds takes the match.
// The game is static files under game/, ES modules with three.js from an import map,
// no build step, no network. Serve it with `node serve.ts` (http://localhost:8080).
//
// ?shot=start|play|end with &seed=N stages a deterministic frame for a capture, renders
// it twice, then freezes it and sets window.__shotReady.
//
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createMap, EMBER_SPAWN, ASH_SPAWN, SITE } from './map.js';
import { createAgent, createAgentMesh, moveBody, syncMesh, agentNames } from './agents.js';
import { createBot, botStep } from './bots.js';
import { createCombat } from './combat.js';
import {
  createState, PHASE, awardWin, resetRound,
  ROUND_TIME, BUY_TIME, BOMB_FUSE, PLANT_TIME, DEFUSE_TIME, ROUNDS_TO_WIN, MAX_ROUNDS,
} from './state.js';
import { WEAPONS, createWeaponState, weaponSpread, weaponStep, weaponReady, createViewModel } from './weapons.js';
import { createHud } from './hud.js';
import { createInput } from './input.js';
import { createPlayer } from './player.js';
import { createAudio } from './audio.js';
import { mulberry32, pick } from './rng.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;
const random = shot ? mulberry32(seed) : mulberry32((Date.now() & 0x7fffffff) || 1);
// In shot mode no sound is made: headless captures have no gesture to unlock audio with.
const audio = shot
  ? { unlock() {}, shot() {}, distantShot() {}, dryFire() {}, reload() {}, hit() {}, kill() {}, hurt() {}, plantBeep() {}, planted() {}, defuseBeep() {}, explosion() {}, bounce() {}, roundWin() {}, roundLose() {}, buy() {}, step() {} }
  : createAudio();

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.canvas);
scene.fog = new THREE.Fog(new THREE.Color(PALETTE.canvas), 18, 46);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 140);
scene.add(camera);

const map = createMap(scene);
const state = createState();
const combat = createCombat(scene, map.shootables);
const hud = createHud();
const input = createInput(renderer.domElement, onLockChange);
const playerCtl = createPlayer(map.colliders);

// --- agents: you + 3 Ember teammates vs 4 Ashfall bots -----------------------
const playerAgent = createAgent({ team: 'ember', name: 'You', x: 0, z: 14, yaw: 0, isPlayer: true });
playerAgent.weapons = { pistol: createWeaponState(WEAPONS.pistol) };
playerAgent.weaponId = 'pistol';
playerAgent.grenades = 0;
playerAgent.ws = playerAgent.weapons.pistol;

const agents = [playerAgent];
for (let i = 0; i < 3; i += 1) {
  const bot = createAgent({ team: 'ember', name: agentNames('ember', i), x: 0, z: 14, yaw: 0 });
  bot.mesh = createAgentMesh(scene, 'ember');
  bot.ws = createWeaponState(WEAPONS.rifle);
  bot.weaponId = 'rifle';
  createBot(bot, 'teammate', random);
  agents.push(bot);
}
for (let i = 0; i < 4; i += 1) {
  const bot = createAgent({ team: 'ash', name: agentNames('ash', i), x: 0, z: -14, yaw: Math.PI });
  bot.mesh = createAgentMesh(scene, 'ash');
  bot.ws = createWeaponState(WEAPONS.rifle);
  bot.weaponId = 'rifle';
  createBot(bot, i === 0 ? 'carrier' : i === 1 ? 'entry' : i === 2 ? 'support' : 'holder', random);
  agents.push(bot);
}
const emberBots = agents.filter((a) => a.team === 'ember' && !a.isPlayer);
const ashBots = agents.filter((a) => a.team === 'ash');

let viewModel = createViewModel(camera, 'pistol');
let roundEndTimer = 0;
let lastBeepAt = -10;
let lastGrenadeThrower = null;
let prevKeys = new Set();
// Staged display text that syncHud() must not overwrite (end screenshot: defused site).
let bombTextOverride = null;

const world = {
  agents,
  colliders: map.colliders,
  state,
  onPlantTick(bot, timer) {
    if (state.elapsed - lastBeepAt > 0.5) { lastBeepAt = state.elapsed; audio.plantBeep(); }
    hud.setPrompt(`Ashfall is planting the charge — ${Math.max(0, Math.ceil(PLANT_TIME - timer))}s`);
  },
  onPlanted() {
    state.bomb.state = 'planted';
    state.bomb.fuse = BOMB_FUSE;
    combat.setBombVisible(true, 1);
    hud.setBomb('CHARGE PLANTED — defuse it!', true);
    hud.banner('CHARGE PLANTED', 'Ashfall set the fuse — defuse it or wipe them out.');
    audio.planted();
  },
  onDefuseTick(bot, timer) {
    if (state.elapsed - lastBeepAt > 0.5) { lastBeepAt = state.elapsed; audio.defuseBeep(); }
    hud.setPrompt(`Defusing the charge — ${Math.max(0, Math.ceil(DEFUSE_TIME - timer))}s`);
  },
  onDefused() {
    endRound('ember', 'defused');
  },
  onBotShoot(bot, enemy, dist) {
    if (!weaponReady(bot.ws)) return;
    const spread = 0.012 + dist * 0.0006 + (bot.bot ? bot.bot.aimError : 0.03);
    const result = combat.shoot(bot, bot.yaw, bot.pitch, spread, random, agents);
    bot.ws.cooldown = WEAPONS[bot.weaponId].rate;
    if (!result.hit) return;
    state.lastShotHeard = { x: bot.x, z: bot.z, team: bot.team, at: state.elapsed };
    if (result.victim.isPlayer) audio.hurt();
    if (result.killed) onKill(bot, result.victim, result.head);
  },
};

// --- match / round flow ------------------------------------------------------
function spawnAll() {
  const body = playerCtl.body;
  body.x = EMBER_SPAWN[2].x;
  body.z = EMBER_SPAWN[2].z;
  body.y = 0;
  body.yaw = 0;
  body.pitch = 0;
  body.vx = 0;
  body.vz = 0;
  body.vy = 0;
  emberBots.forEach((bot, i) => {
    const spawn = EMBER_SPAWN[i === 2 ? 3 : i];
    bot.x = spawn.x;
    bot.z = spawn.z;
    bot.yaw = 0;
    bot.pitch = 0;
  });
  ashBots.forEach((bot, i) => {
    const spawn = ASH_SPAWN[i];
    bot.x = spawn.x;
    bot.z = spawn.z;
    bot.yaw = Math.PI;
    bot.pitch = 0;
  });
  for (const a of agents) {
    a.health = 100;
    a.alive = true;
    a.grenades = 0;
    if (a.mesh) { a.mesh.deathT = 0; a.mesh.group.visible = true; }
    if (a.bot) { a.bot.state = 'route'; a.bot.route = []; a.bot.target = null; a.bot.investigate = null; a.bot.plantTimer = 0; a.bot.defuseTimer = 0; }
    if (a.ws) { a.ws = createWeaponState(WEAPONS[a.weaponId]); }
  }
  // Fresh carrier: one Ash bot carries the charge this round.
  for (const b of ashBots) { b.carrier = false; if (b.bot) b.bot.role = b === ashBots[1] ? 'entry' : b === ashBots[2] ? 'support' : b === ashBots[3] ? 'holder' : 'entry'; }
  const carrier = pick(random, ashBots);
  carrier.carrier = true;
  carrier.bot.role = 'carrier';
  state.bomb.carrier = carrier;
  syncPlayerAgent();
  for (const b of agents) if (!b.isPlayer) syncMesh(b);
}

function startMatch() {
  state.score = { ember: 0, ash: 0 };
  state.money = 800;
  state.kills = 0;
  state.deaths = 0;
  playerAgent.weapons = { pistol: createWeaponState(WEAPONS.pistol) };
  playerAgent.weaponId = 'pistol';
  playerAgent.grenades = 0;
  playerAgent.ws = playerAgent.weapons.pistol;
  switchWeapon('pistol');
  hud.hideOverlay();
  startRound(1);
}

function startRound(n) {
  state.round = n;
  resetRound(state); // phase BUY, timer BUY_TIME, bomb reset
  bombTextOverride = null;
  spawnAll();
  hud.setScore(state.score.ember, state.score.ash, n);
  hud.setMoney(state.money);
  hud.setTimer(state.timer);
  hud.setBomb('SITE: REACTOR — no charge planted', false);
  hud.setPrompt('Press B to open the Armory');
  if (n === 1) {
    hud.showBuy(state.money, ownedSummary());
    if (document.pointerLockElement) document.exitPointerLock();
  }
}

function beginLive() {
  state.phase = PHASE.LIVE;
  state.timer = ROUND_TIME;
  hud.hideBuy();
  hud.banner(`ROUND ${state.round}`, 'Ashfall is pushing the Reactor — hold the site.');
  hud.setPrompt(null);
}

function endRound(winner, reason) {
  if (state.phase !== PHASE.LIVE) return;
  state.phase = PHASE.ROUND_END;
  state.roundWinner = winner;
  awardWin(state, winner === 'ember');
  state.score[winner] += 1;
  roundEndTimer = 4;
  combat.setBombVisible(false, 0);
  hud.hideBuy();
  const titles = {
    elimination: winner === 'ember' ? 'EMBER TAKES THE ROUND' : 'ASHFALL TAKES THE ROUND',
    detonation: 'THE REACTOR BLOWS',
    defused: 'CHARGE DEFUSED',
    time: 'TIME — EMBER HOLDS',
  };
  const subs = {
    elimination: winner === 'ember' ? 'Ashfall wiped out.' : 'Ember wiped out.',
    detonation: 'Ashfall blew the Reactor.',
    defused: 'The Reactor holds. Ember takes the round.',
    time: 'Ashfall never reached the site.',
  };
  hud.banner(titles[reason] || titles.elimination, subs[reason] || '');
  hud.setBomb('SITE: REACTOR — no charge planted', false);
  if (winner === 'ember') audio.roundWin();
  else audio.roundLose();
  if (document.pointerLockElement) document.exitPointerLock();
}

function endMatch() {
  state.phase = PHASE.MATCH_END;
  const won = state.score.ember > state.score.ash;
  state.matchWinner = won ? 'ember' : 'ash';
  hud.showOverlay('match', { won, ember: state.score.ember, ash: state.score.ash, kills: playerAgent.kills, deaths: state.deaths });
  if (document.pointerLockElement) document.exitPointerLock();
}

function checkRoundEnd() {
  if (state.phase !== PHASE.LIVE) return;
  const emberAlive = agents.some((a) => a.team === 'ember' && a.alive);
  const ashAlive = agents.some((a) => a.team === 'ash' && a.alive);
  if (!emberAlive) endRound('ash', 'elimination');
  else if (!ashAlive) endRound('ember', 'elimination');
}

// --- combat events -----------------------------------------------------------
function onKill(killer, victim, head) {
  killer.kills = (killer.kills || 0) + 1;
  if (killer.isPlayer) {
    state.money += 300;
    audio.kill();
  }
  if (victim.isPlayer) {
    state.deaths += 1;
    if (document.pointerLockElement) document.exitPointerLock();
    hud.banner('YOU ARE DOWN', 'Your team fights on — the round is still live.');
  }
  hud.killfeed(killer.name, victim, killer.team, head);
  if (victim.carrier && victim.team === 'ash') {
    victim.carrier = false;
    const next = ashBots.find((b) => b.alive && b !== victim);
    if (next) {
      next.carrier = true;
      next.bot.role = 'carrier';
      state.bomb.carrier = next;
    }
  }
  checkRoundEnd();
}

function ownedSummary() {
  return { weapons: Object.keys(playerAgent.weapons), grenades: playerAgent.grenades };
}

function switchWeapon(id) {
  if (!playerAgent.weapons[id]) return;
  playerAgent.weaponId = id;
  playerAgent.ws = playerAgent.weapons[id];
  camera.remove(viewModel.group, viewModel.flash, viewModel.flashLight);
  viewModel = createViewModel(camera, WEAPONS[id].kind);
  const ws = playerAgent.ws;
  hud.setAmmo(ws.mag, ws.reserve, WEAPONS[id].name);
}

function buyItem(id) {
  if (state.phase !== PHASE.BUY) return;
  const def = WEAPONS[id];
  if (state.money < def.price) return;
  if (id === 'grenade') {
    if (playerAgent.grenades > 0) return;
    playerAgent.grenades = 1;
  } else {
    if (playerAgent.weapons[id]) return;
    playerAgent.weapons[id] = createWeaponState(def);
  }
  state.money -= def.price;
  audio.buy();
  if (id !== 'grenade') switchWeapon(id);
  hud.refreshBuy(state.money, ownedSummary());
  hud.setMoney(state.money);
}

function firePlayer() {
  const ws = playerAgent.ws;
  const def = ws.def;
  const body = playerCtl.body;
  const spread = weaponSpread(ws, body.speed, body.speed > 0.5);
  const result = combat.shoot(playerAgent, body.yaw, body.pitch, spread, random, agents);
  viewModel.fire(ws);
  playerCtl.recoil(def.recoil, (random() * 2 - 1) * 0.004);
  audio.shot(def.kind);
  state.lastShotHeard = { x: body.x, z: body.z, team: 'ember', at: state.elapsed };
  hud.setAmmo(ws.mag, ws.reserve, def.name);
  if (!result.hit) return;
  hud.hitMarker(result.killed);
  if (result.killed) {
    audio.kill();
    onKill(playerAgent, result.victim, result.head);
  } else {
    audio.hit();
  }
}

function throwPlayerGrenade() {
  if (playerAgent.grenades <= 0) return;
  playerAgent.grenades -= 1;
  lastGrenadeThrower = playerAgent;
  const body = playerCtl.body;
  combat.throwGrenade(playerAgent, body.yaw, body.pitch);
}

function syncPlayerAgent() {
  const body = playerCtl.body;
  playerAgent.x = body.x;
  playerAgent.z = body.z;
  playerAgent.y = body.y;
  playerAgent.yaw = body.yaw;
  playerAgent.pitch = body.pitch;
  playerAgent.crouched = body.crouched;
  playerAgent.speed = body.speed;
}

function syncCamera() {
  const body = playerCtl.body;
  camera.position.set(body.x, body.y + playerCtl.eyeHeight(), body.z);
  camera.rotation.set(body.pitch, body.yaw, 0, 'YXZ');
}

function syncHud() {
  const ws = playerAgent.ws;
  hud.setHealth(playerAgent.health);
  hud.setAmmo(ws.mag, ws.reserve, ws.def.name);
  hud.setTimer(state.timer);
  hud.setScore(state.score.ember, state.score.ash, state.round);
  hud.setMoney(state.money);
  hud.setTeammates(emberBots.map((b) => ({ name: b.name, alive: b.alive, health: b.health })));
  if (state.bomb.state === 'planted') {
    hud.setBomb(`CHARGE PLANTED — ${Math.max(0, Math.ceil(state.bomb.fuse))}s fuse`, true);
  } else if (bombTextOverride) {
    hud.setBomb(bombTextOverride, false);
  } else if (state.bomb.state === 'idle') {
    const planting = agents.some((a) => a.bot && a.bot.state === 'plant' && a.alive);
    hud.setBomb(planting ? 'CHARGE BEING PLANTED!' : 'SITE: REACTOR — no charge planted', planting);
  }
  hud.setCrosshairSpread(weaponSpread(ws, playerCtl.body.speed, playerCtl.body.speed > 0.5) * 900);
}

// --- fixed-step simulation ----------------------------------------------------
function step(dt) {
  state.elapsed += dt;
  combat.stepTracers(dt);
  if (state.phase === PHASE.ROUND_END) {
    roundEndTimer -= dt;
    if (roundEndTimer <= 0) {
      if (state.score.ember >= ROUNDS_TO_WIN || state.score.ash >= ROUNDS_TO_WIN || state.round >= MAX_ROUNDS) endMatch();
      else startRound(state.round + 1);
    }
    return;
  }
  if (state.phase !== PHASE.BUY && state.phase !== PHASE.LIVE) return;

  // Player movement (alive, and only once a round is running).
  if (playerAgent.alive) playerCtl.step(dt, input.state.keys, map.colliders);
  syncPlayerAgent();
  weaponStep(playerAgent.ws, dt);

  if (state.phase === PHASE.BUY) {
    state.timer -= dt;
    if (state.timer <= 0) beginLive();
    return;
  }

  // LIVE: timer, bomb fuse, bots, grenades, defuse.
  state.timer -= dt;
  if (state.bomb.state === 'planted') {
    state.bomb.fuse -= dt;
    combat.setBombVisible(true, Math.max(0, state.bomb.fuse / BOMB_FUSE));
    if (state.bomb.fuse <= 0) {
      audio.explosion();
      endRound('ash', 'detonation');
      return;
    }
  }
  if (state.timer <= 0) {
    endRound('ember', 'time');
    return;
  }
  for (const bot of agents) {
    if (bot.isPlayer || !bot.alive) continue;
    const wish = botStep(bot, dt, world, random);
    const cap = bot.crouched ? 2.4 : 4.6;
    moveBody(bot, wish.x / cap, wish.z / cap, dt, map.colliders, cap);
    weaponStep(bot.ws, dt);
  }
  combat.stepGrenades(dt, agents, (boom) => {
    lastGrenadeThrower = lastGrenadeThrower || playerAgent;
    for (const v of boom.victims) {
      if (v.victim.isPlayer) audio.hurt();
      if (v.killed) onKill(lastGrenadeThrower, v.victim, false);
    }
  });
  // Player defuse: hold E near the site while the charge is planted.
  if (state.bomb.state === 'planted' && playerAgent.alive) {
    const dSite = Math.hypot(SITE.x - playerAgent.x, SITE.z - playerAgent.z);
    if (dSite < 2.5 && input.state.keys.has('KeyE')) {
      state.bomb.defuseProgress += dt;
      if (state.elapsed - lastBeepAt > 0.5) { lastBeepAt = state.elapsed; audio.defuseBeep(); }
      hud.setPrompt(`Defusing the charge — ${Math.max(0, Math.ceil(DEFUSE_TIME - state.bomb.defuseProgress))}s`);
      if (state.bomb.defuseProgress >= DEFUSE_TIME) endRound('ember', 'defused');
    } else {
      state.bomb.defuseProgress = 0;
    }
  }
}

// --- per-frame input + render --------------------------------------------------
let lastTime = performance.now();
let accumulator = 0;
let frozen = false;

function keyEdge(code) {
  return input.state.keys.has(code) && !prevKeys.has(code);
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen) {
    const look = input.takeLook();
    if (playerAgent.alive && (state.phase === PHASE.LIVE || state.phase === PHASE.BUY)) playerCtl.look(look.x, look.y);
    // Live firing + actions (edge-triggered keys tracked against the previous frame).
    if (state.phase === PHASE.LIVE && playerAgent.alive && input.state.locked) {
      const ws = playerAgent.ws;
      const wantFire = ws.def.auto ? input.state.firing : input.takeFiredOnce();
      if (wantFire && weaponReady(ws)) firePlayer();
      else if (wantFire && ws.mag === 0 && !ws.def.auto) audio.dryFire();
      if (keyEdge('KeyR') && ws.reloadLeft === 0 && ws.mag < ws.def.mag && ws.reserve > 0) {
        ws.reloadLeft = ws.def.reload;
        audio.reload();
      }
      if (keyEdge('Digit1')) switchWeapon('pistol');
      if (keyEdge('Digit2')) switchWeapon('rifle');
      if (keyEdge('Digit3')) switchWeapon('smg');
      if (keyEdge('Digit4') || keyEdge('KeyG')) throwPlayerGrenade();
    }
    if (state.phase === PHASE.BUY && keyEdge('KeyB')) {
      if (hud.buyVisible()) { hud.hideBuy(); input.requestLock(); }
      else { hud.showBuy(state.money, ownedSummary()); if (document.pointerLockElement) document.exitPointerLock(); }
    }
    // Default prompt first: step() may overwrite it with a planting/defuse prompt.
    if (state.phase === PHASE.BUY && !hud.buyVisible()) hud.setPrompt('Press B to open the Armory');
    if (state.phase === PHASE.LIVE && state.bomb.state !== 'planted') hud.setPrompt(null);
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
    syncCamera();
    viewModel.update(playerAgent.ws, dt);
    syncHud();
    for (const b of agents) if (!b.isPlayer) syncMesh(b);
    prevKeys = new Set(input.state.keys);
  }
  renderer.render(scene, camera);
}

// --- HUD + input wiring ---------------------------------------------------------
hud.onPlay(() => {
  if (shot) return;
  if (state.phase === PHASE.MENU || state.phase === PHASE.MATCH_END) {
    audio.unlock();
    startMatch();
  }
  if (!hud.buyVisible()) input.requestLock();
});
hud.playButton();
hud.onBuy((id) => buyItem(id));
hud.onCloseBuy(() => {
  hud.hideBuy();
  if (!shot && (state.phase === PHASE.BUY || state.phase === PHASE.LIVE)) input.requestLock();
});
hud.closeBuyButton();

function onLockChange(locked) {
  if (shot) return;
  if (locked) {
    audio.unlock();
    hud.hideOverlay();
  } else if ((state.phase === PHASE.LIVE || state.phase === PHASE.BUY) && !hud.overlayVisible() && !hud.buyVisible()) {
    hud.showOverlay('paused');
  }
}

// --- deterministic screenshot staging -------------------------------------------
function settle(steps) {
  for (let index = 0; index < steps; index += 1) step(FIXED_STEP);
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    viewModel.update(playerAgent.ws, FIXED_STEP);
    syncHud();
    for (const b of agents) if (!b.isPlayer) syncMesh(b);
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

function runShot(name) {
  hud.hideOverlay();
  hud.hideBuy();
  if (name === 'start') {
    // Menu over the yard: player at Ember spawn, looking north down mid lane.
    spawnAll();
    playerCtl.body.yaw = 0;
    playerCtl.body.pitch = 0;
    syncPlayerAgent();
    syncCamera();
    state.phase = PHASE.MENU;
    state.timer = ROUND_TIME;
    hud.setHealth(100);
    hud.setAmmo(12, 36, 'SP-9 Sidearm');
    hud.setTimer(ROUND_TIME);
    hud.setScore(0, 0, 1);
    hud.setMoney(800);
    hud.setBomb('SITE: REACTOR — no charge planted', false);
    hud.showOverlay('start', 0);
  } else if (name === 'play') {
    // Mid-round: rifle bought, bots pushed into the yard, player aiming mid.
    state.money = 3500;
    startRound(1);
    buyItem('rifle');
    state.phase = PHASE.LIVE;
    state.timer = 82;
    hud.hideBuy();
    hud.setPrompt(null);
    settle(180); // 3 s of sim: bots walk their routes toward mid/site
    // Pose the nearest Ash bot in mid plaza, in the player's sights.
    const target = ashBots.filter((b) => b.alive).sort((a, b) => {
      const da = Math.hypot(a.x - playerAgent.x, a.z - playerAgent.z);
      const db = Math.hypot(b.x - playerAgent.x, b.z - playerAgent.z);
      return da - db;
    })[0];
    if (target) {
      target.x = 2;
      target.z = 4;
      target.yaw = Math.atan2(playerAgent.x - target.x, playerAgent.z - target.z);
      const dx = target.x - playerAgent.x;
      const dz = target.z - playerAgent.z;
      playerCtl.body.yaw = Math.atan2(-dx, -dz);
      playerCtl.body.pitch = 0;
      syncPlayerAgent();
    }
    syncCamera();
    hud.setTimer(82);
  } else {
    // Round end: Ember took round 1 by defuse; Ash bodies on the ground by the site.
    state.money = 3500;
    startRound(1);
    state.phase = PHASE.LIVE;
    state.timer = 40;
    hud.hideBuy();
    hud.setPrompt(null);
    settle(60);
    // Pose the fallen: two Ash bots by the Reactor, one Ember teammate nearby,
    // spread across the player's view of the site so the bodies read in frame.
    // (Clear of the Reactor core footprint, r=1.9, so the core does not hide them.)
    ashBots[0].x = 14; ashBots[0].z = -11.5;
    ashBots[0].health = 0; ashBots[0].alive = false; ashBots[0].mesh.deathT = 0.7;
    ashBots[1].x = 17.5; ashBots[1].z = -10.5;
    ashBots[1].health = 0; ashBots[1].alive = false; ashBots[1].mesh.deathT = 0.7;
    emberBots[2].x = 13.5; emberBots[2].z = -9.5;
    emberBots[2].health = 0; emberBots[2].alive = false; emberBots[2].mesh.deathT = 0.7;
    // Player inside the compound, looking down at the Reactor over the fallen.
    playerCtl.body.x = 11.5;
    playerCtl.body.z = -9;
    playerCtl.body.yaw = Math.atan2(-(SITE.x - 11.5), -(SITE.z + 9));
    playerCtl.body.pitch = -0.22;
    syncPlayerAgent();
    syncCamera();
    state.score.ember = 1;
    hud.setScore(1, 0, 1);
    hud.setTimer(40);
    bombTextOverride = 'SITE: REACTOR — charge defused';
    hud.banner('EMBER TAKES ROUND 1', 'Charge defused — the Reactor holds.', 60000);
  }
  paintTwiceThenReady();
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

spawnAll();
syncCamera();
syncHud();
if (shot) runShot(shot);
else requestAnimationFrame(frame);
