// Weapons: one definition per gun, all numbers in one table. Damage falls with range;
// headshots multiply. Spread grows with movement and with sustained fire (bloom), recoil
// kicks the view up — stopping to aim pays, firing on the move does not.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const WEAPONS = {
  pistol: {
    id: 'pistol', name: 'SP-9 Sidearm', kind: 'pistol', price: 0,
    damage: 26, headMult: 2.6, mag: 12, reserve: 36, rate: 0.18, reload: 1.4,
    spreadStill: 0.003, spreadMove: 0.02, recoil: 0.008, auto: false, pellets: 1, range: 45,
    desc: 'Free sidearm. Reliable up close, weak at range.',
  },
  rifle: {
    id: 'rifle', name: 'VK-9 Long Rifle', kind: 'rifle', price: 2700,
    damage: 34, headMult: 2.5, mag: 30, reserve: 90, rate: 0.11, reload: 1.9,
    spreadStill: 0.002, spreadMove: 0.03, recoil: 0.012, auto: true, pellets: 1, range: 70,
    desc: 'The workhorse. Tap-fire at range, burst up close.',
  },
  smg: {
    id: 'smg', name: 'Hornet-9 SMG', kind: 'smg', price: 1500,
    damage: 22, headMult: 2.4, mag: 32, reserve: 96, rate: 0.07, reload: 1.6,
    spreadStill: 0.006, spreadMove: 0.026, recoil: 0.007, auto: true, pellets: 1, range: 35,
    desc: 'Fast and cheap. Shreds in corridors, fades past 30 m.',
  },
  shotgun: {
    id: 'shotgun', name: 'Breacher-12', kind: 'shotgun', price: 1100,
    damage: 9, headMult: 1.8, mag: 6, reserve: 24, rate: 0.9, reload: 2.4,
    spreadStill: 0.045, spreadMove: 0.06, recoil: 0.03, auto: false, pellets: 8, range: 18,
    desc: 'Eight pellets per shell. Corners fear it.',
  },
  grenade: {
    id: 'grenade', name: 'HE-7 Charge', kind: 'grenade', price: 300,
    damage: 0, headMult: 1, mag: 1, reserve: 0, rate: 1.0, reload: 0,
    spreadStill: 0, spreadMove: 0, recoil: 0, auto: false, pellets: 1, range: 0,
    desc: 'One throw per round. Blast radius 6 m.',
  },
};

export const SHOP_ORDER = ['rifle', 'smg', 'shotgun', 'grenade'];

// Per-weapon runtime state: magazine, reserve, cooldown, reload timer, bloom.
export function createWeaponState(def) {
  return { def, mag: def.mag, reserve: def.reserve, cooldown: 0, reloadLeft: 0, bloom: 0, flash: 0, kick: 0 };
}

export function weaponSpread(state, speed, moving) {
  const base = state.def.spreadStill + (moving ? state.def.spreadMove * Math.min(1, speed / 5.2) : 0);
  return base + state.bloom;
}

export function weaponStep(state, dt) {
  state.cooldown = Math.max(0, state.cooldown - dt);
  state.flash = Math.max(0, state.flash - dt);
  state.bloom = Math.max(0, state.bloom - dt * 0.05);
  state.kick += (0 - state.kick) * Math.min(1, dt * 14);
  if (state.reloadLeft > 0) {
    state.reloadLeft = Math.max(0, state.reloadLeft - dt);
    if (state.reloadLeft === 0) {
      const need = state.def.mag - state.mag;
      const take = Math.min(need, state.reserve);
      state.mag += take;
      state.reserve -= take;
    }
  }
}

export function weaponReady(state) {
  return state.mag > 0 && state.cooldown === 0 && state.reloadLeft === 0;
}

// A simple view model: dark receiver, barrel, stock, accent sight. One group per weapon kind.
export function createViewModel(camera, kind) {
  const dark = new THREE.MeshStandardMaterial({ color: new THREE.Color('#2b241d'), roughness: 0.6, metalness: 0.4 });
  const metal = new THREE.MeshStandardMaterial({ color: new THREE.Color('#8a8074'), roughness: 0.45, metalness: 0.5 });
  const accent = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.accent), roughness: 0.5, metalness: 0.2 });
  const group = new THREE.Group();
  function part(w, h, d, x, y, z, mat) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y, z);
    group.add(mesh);
    return mesh;
  }
  if (kind === 'shotgun') {
    part(0.09, 0.1, 0.5, 0, 0, 0, metal);
    part(0.06, 0.06, 0.42, 0, -0.06, -0.1, dark);
    part(0.07, 0.09, 0.24, 0, -0.02, 0.32, dark);
    part(0.03, 0.03, 0.1, 0, 0.07, -0.05, accent);
  } else if (kind === 'smg') {
    part(0.08, 0.09, 0.34, 0, 0, 0, dark);
    part(0.04, 0.04, 0.3, 0, 0.02, -0.28, metal);
    part(0.05, 0.14, 0.06, 0, -0.1, 0.05, dark);
    part(0.03, 0.03, 0.08, 0, 0.06, -0.02, accent);
  } else if (kind === 'pistol') {
    part(0.06, 0.1, 0.2, 0, 0, -0.05, dark);
    part(0.05, 0.12, 0.05, 0, -0.1, 0.06, dark);
    part(0.02, 0.02, 0.05, 0, 0.06, -0.12, accent);
  } else if (kind === 'grenade') {
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.055, 12, 10), new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.teal), roughness: 0.4, metalness: 0.5 }));
    ball.position.set(0, 0, -0.05);
    group.add(ball);
  } else {
    part(0.09, 0.1, 0.44, 0, 0, 0, metal);
    part(0.045, 0.045, 0.4, 0, 0.025, -0.38, dark);
    part(0.075, 0.08, 0.22, 0, -0.02, 0.3, dark);
    part(0.03, 0.04, 0.12, 0, 0.07, -0.1, accent);
    part(0.04, 0.1, 0.05, 0, -0.09, 0.12, dark);
  }
  group.position.set(0.24, -0.2, -0.42);
  camera.add(group);
  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.26, 0.26),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }),
  );
  flash.position.set(0.24, -0.17, -0.95);
  flash.visible = false;
  camera.add(flash);
  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 6);
  flashLight.position.set(0.24, -0.15, -0.6);
  camera.add(flashLight);
  return {
    group, flash, flashLight,
    update(state, dt) {
      group.position.z = -0.42 + state.kick;
      group.rotation.x = state.kick * 2.4;
      if (state.reloadLeft > 0) group.rotation.x = -0.5;
      flash.visible = state.flash > 0;
      flash.rotation.z = state.flash * 40;
      flashLight.intensity = state.flash > 0 ? 16 : 0;
    },
    fire(state) {
      state.cooldown = state.def.rate;
      state.flash = 0.06;
      state.kick = 0.05 + state.def.recoil;
      state.bloom = Math.min(0.02, state.bloom + state.def.recoil * 0.35);
    },
  };
}
