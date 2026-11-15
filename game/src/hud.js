// The DOM HUD: health, ammo, timer, score, money, bomb status, killfeed, teammates, the
// buy menu and the overlays. It never touches the simulation; main.js pushes numbers in
// and reads callbacks out. All text updates go through cached element handles.
import { WEAPONS, SHOP_ORDER } from './weapons.js';
import { formatTime } from './state.js';

const $ = (id) => document.getElementById(id);

export function createHud() {
  const el = {
    overlay: $('overlay'), title: $('overlay-title'), copy: $('overlay-copy'), play: $('play'),
    buy: $('buy'), shop: $('shop'), buyCash: $('buy-cash'), buyClose: $('buy-close'),
    healthNum: $('health-num'), healthFill: $('health-fill'), ammoMag: $('ammo-mag'),
    ammoReserve: $('ammo-reserve'), ammoWeapon: $('ammo-weapon'), ammoBox: $('ammo'),
    timer: $('timer'), roundLabel: $('round-label'), scoreEmber: $('score-ember'), scoreAsh: $('score-ash'),
    moneyValue: $('money-value'), bombStatus: $('bomb-status'), killfeed: $('killfeed'),
    teammates: $('teammates'), banner: $('banner'), bannerTitle: $('banner-title'), bannerSub: $('banner-sub'),
    prompt: $('prompt'), hitmarker: $('hitmarker'), crosshair: $('crosshair'), vignette: $('vignette'),
  };
  let hitTimer = null;
  let bannerTimer = null;
  const callbacks = { onPlay: null, onBuy: null, onCloseBuy: null };

  function buildShop(money, owned) {
    el.shop.innerHTML = '';
    for (const id of SHOP_ORDER) {
      const def = WEAPONS[id];
      const button = document.createElement('button');
      button.type = 'button';
      const isGrenade = id === 'grenade';
      const has = isGrenade ? owned.grenades > 0 : owned.weapons.includes(id);
      const afford = money >= def.price;
      button.disabled = has || !afford;
      const left = document.createElement('span');
      left.textContent = `${def.name} — ${def.desc}`;
      const right = document.createElement('span');
      right.className = has ? 'owned' : 'price';
      right.textContent = has ? 'OWNED' : `$${def.price}`;
      button.append(left, right);
      button.addEventListener('click', () => callbacks.onBuy && callbacks.onBuy(id));
      el.shop.appendChild(button);
    }
  }

  return {
    onPlay(fn) { callbacks.onPlay = fn; },
    onBuy(fn) { callbacks.onBuy = fn; },
    onCloseBuy(fn) { callbacks.onCloseBuy = fn; },
    playButton() { el.play.addEventListener('click', () => callbacks.onPlay && callbacks.onPlay()); },
    showBuy(money, owned) {
      el.buyCash.textContent = `$${money}`;
      buildShop(money, owned);
      el.buy.hidden = false;
    },
    refreshBuy(money, owned) {
      el.buyCash.textContent = `$${money}`;
      buildShop(money, owned);
    },
    hideBuy() { el.buy.hidden = true; },
    buyVisible() { return !el.buy.hidden; },
    closeBuyButton() { el.buyClose.addEventListener('click', () => callbacks.onCloseBuy && callbacks.onCloseBuy()); },

    showOverlay(kind, data) {
      el.overlay.hidden = false;
      if (kind === 'start') {
        el.title.innerHTML = 'EMBER<span style="color:#ff8a2a">LINE</span>';
        el.copy.textContent = 'A tactical round-based FPS in a dusk solar yard. Ashfall is coming for the Reactor — hold the site, defuse the charge, or wipe them out. Earn cash, buy better guns between rounds. First to 3 rounds takes the match.';
        el.play.textContent = 'Click to play';
      } else if (kind === 'paused') {
        el.title.textContent = 'Paused';
        el.copy.textContent = 'Pointer lock released. Click to jump back in — the round is still running.';
        el.play.textContent = 'Resume';
      } else if (kind === 'match') {
        el.title.textContent = data.won ? 'EMBER WINS THE MATCH' : 'ASHFALL WINS THE MATCH';
        el.copy.textContent = `Final score ${data.ember}–${data.ash}. ${data.kills} eliminations, ${data.deaths} deaths. Click to play again.`;
        el.play.textContent = 'Play again';
      } else if (kind === 'round') {
        el.title.textContent = data.title;
        el.copy.textContent = data.sub;
        el.play.textContent = 'Next round';
      }
    },
    hideOverlay() { el.overlay.hidden = true; },
    overlayVisible() { return !el.overlay.hidden; },

    setHealth(hp) {
      el.healthNum.textContent = String(Math.max(0, Math.ceil(hp)));
      el.healthFill.style.width = `${Math.max(0, hp)}%`;
      el.healthFill.classList.toggle('low', hp <= 30);
      el.vignette.style.opacity = hp <= 30 ? String((30 - hp) / 30 * 0.8 + 0.2) : '0';
    },
    setAmmo(mag, reserve, weaponName) {
      el.ammoMag.textContent = String(mag);
      el.ammoReserve.textContent = `/ ${reserve}`;
      el.ammoWeapon.textContent = weaponName;
      el.ammoBox.classList.toggle('empty', mag === 0);
    },
    setTimer(seconds) {
      el.timer.textContent = formatTime(seconds);
      el.timer.classList.toggle('low', seconds <= 10);
    },
    setScore(ember, ash, round) {
      el.scoreEmber.textContent = String(ember);
      el.scoreAsh.textContent = String(ash);
      el.roundLabel.textContent = `ROUND ${Math.min(round, 5)}/5`;
    },
    setMoney(money) { el.moneyValue.textContent = `$${money}`; },
    setBomb(text, planted) {
      el.bombStatus.textContent = text;
      el.bombStatus.classList.toggle('planted', planted);
    },
    setPrompt(text) {
      if (text) { el.prompt.textContent = text; el.prompt.hidden = false; }
      else el.prompt.hidden = true;
    },
    banner(title, sub, ms = 2600) {
      el.bannerTitle.textContent = title;
      el.bannerSub.textContent = sub;
      el.banner.hidden = false;
      if (bannerTimer) clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => { el.banner.hidden = true; }, ms);
    },
    hideBanner() { el.banner.hidden = true; },
    hitMarker(killed) {
      el.hitmarker.classList.add('on');
      el.hitmarker.classList.toggle('kill', killed);
      if (hitTimer) clearTimeout(hitTimer);
      hitTimer = setTimeout(() => el.hitmarker.classList.remove('on'), 120);
    },
    killfeed(killer, victim, killerTeam, head) {
      const div = document.createElement('div');
      const k = document.createElement('span');
      k.className = killerTeam === 'ember' ? 'f' : 'e';
      k.textContent = killer;
      const v = document.createElement('span');
      v.className = victim.team === 'ember' ? 'f' : 'e';
      v.textContent = victim.name;
      div.append(k, document.createTextNode(head ? '  ⌖  ' : '  →  '), v);
      el.killfeed.prepend(div);
      while (el.killfeed.children.length > 5) el.killfeed.lastChild.remove();
      setTimeout(() => div.remove(), 6000);
    },
    setTeammates(list) {
      el.teammates.innerHTML = '';
      for (const mate of list) {
        const div = document.createElement('div');
        div.className = mate.alive ? '' : 'dead';
        const b = document.createElement('b');
        b.textContent = mate.name;
        div.append(b, document.createTextNode(`  ${Math.max(0, Math.ceil(mate.health))} HP`));
        el.teammates.appendChild(div);
      }
    },
    setCrosshairSpread(spreadPx) {
      el.crosshair.style.setProperty('--spread', `${spreadPx}px`);
      el.crosshair.style.transform = `translate(-50%, -50%) scale(${1 + spreadPx / 40})`;
    },
  };
}
