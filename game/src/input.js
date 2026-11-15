// Keyboard and mouse, and the pointer lock that turns the mouse into look.
// Plain browser APIs only. Firing is edge-triggered for semi-auto guns (main.js polls
// `firing` for automatics and `firedOnce` for single shots).
export function createInput(canvas, onLockChange) {
  const keys = new Set();
  const state = { keys, locked: false, firing: false, lookX: 0, lookY: 0, firedOnce: false };

  function setKey(event, down) {
    if (down) keys.add(event.code);
    else keys.delete(event.code);
    if (event.code === 'Space') event.preventDefault();
  }

  window.addEventListener('keydown', (event) => setKey(event, true));
  window.addEventListener('keyup', (event) => setKey(event, false));
  window.addEventListener('blur', () => keys.clear());
  window.addEventListener('mousemove', (event) => {
    if (!state.locked) return;
    state.lookX += event.movementX;
    state.lookY += event.movementY;
  });
  window.addEventListener('mousedown', (event) => {
    if (state.locked && event.button === 0) {
      state.firing = true;
      state.firedOnce = true;
    }
  });
  window.addEventListener('mouseup', (event) => {
    if (event.button === 0) state.firing = false;
  });
  document.addEventListener('pointerlockchange', () => {
    state.locked = document.pointerLockElement === canvas;
    if (!state.locked) {
      keys.clear();
      state.firing = false;
    }
    onLockChange(state.locked);
  });

  return {
    state,
    requestLock() { canvas.requestPointerLock(); },
    takeLook() {
      const x = state.lookX;
      const y = state.lookY;
      state.lookX = 0;
      state.lookY = 0;
      return { x, y };
    },
    takeFiredOnce() {
      const value = state.firedOnce;
      state.firedOnce = false;
      return value;
    },
  };
}
