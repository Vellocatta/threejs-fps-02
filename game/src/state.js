// One place holds the match: phases, rounds, money, bomb, scores. Modules read it, main.js
// is the only writer of phase transitions (bots/combat call its helpers, never set phase).
export const PHASE = { MENU: 'menu', BUY: 'buy', LIVE: 'live', ROUND_END: 'round_end', MATCH_END: 'match_end' };
export const ROUND_TIME = 100;
export const BUY_TIME = 15;
export const BOMB_FUSE = 35;
export const PLANT_TIME = 3;
export const DEFUSE_TIME = 5;
export const ROUNDS_TO_WIN = 3;
export const MAX_ROUNDS = 5;

export function createState() {
  return {
    phase: PHASE.MENU,
    round: 1,
    score: { ember: 0, ash: 0 },
    money: 800,
    kills: 0,
    deaths: 0,
    timer: BUY_TIME,
    bomb: { state: 'idle', carrier: null, fuse: 0, plantProgress: 0, defuseProgress: 0, site: null },
    roundWinner: null,
    matchWinner: null,
    roundEndAt: 0,
    elapsed: 0,
    lastShotHeard: null, // {x, z, team, at} — bots react to what they hear
  };
}

// Economy: kill +300, plant +300, round win +3250, round loss +1900 (losing streak +200).
export function awardWin(state, won) {
  state.money += won ? 3250 : 1900;
}

export function resetRound(state) {
  state.timer = BUY_TIME;
  state.phase = PHASE.BUY;
  state.bomb = { state: 'idle', carrier: null, fuse: 0, plantProgress: 0, defuseProgress: 0, site: null };
  state.roundWinner = null;
  state.lastShotHeard = null;
}

export function formatTime(seconds) {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
