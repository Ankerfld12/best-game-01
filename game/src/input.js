// input.js — keyboard, mouse and pointer lock, and nothing else. The game reads a
// plain state object on each fixed step; look deltas are accumulated between frames
// and consumed exactly once, so mouse speed never depends on the display's refresh
// rate. Losing the lock clears every held input, so a paused game never keeps firing.
export function createInput(canvas, onLockChange) {
  const state = {
    keys: new Set(),
    firing: false,
    aiming: false,
    locked: false,
    wheel: 0, // wheel notches accumulated since the last step (+1 down, -1 up)
  };
  let lookX = 0;
  let lookY = 0;

  canvas.addEventListener('click', () => {
    if (!state.locked) canvas.requestPointerLock();
  });
  document.addEventListener('pointerlockchange', () => {
    state.locked = document.pointerLockElement === canvas;
    if (!state.locked) {
      state.firing = false;
      state.aiming = false;
      state.keys.clear();
    }
    onLockChange(state.locked);
  });
  document.addEventListener('mousemove', (event) => {
    if (!state.locked) return;
    lookX += event.movementX || 0;
    lookY += event.movementY || 0;
  });
  document.addEventListener('mousedown', (event) => {
    if (!state.locked) return;
    if (event.button === 0) state.firing = true;
    if (event.button === 2) state.aiming = true;
  });
  document.addEventListener('mouseup', (event) => {
    if (event.button === 0) state.firing = false;
    if (event.button === 2) state.aiming = false;
  });
  document.addEventListener('contextmenu', (event) => event.preventDefault());
  document.addEventListener('wheel', (event) => {
    if (state.locked) state.wheel += Math.sign(event.deltaY);
  }, { passive: true });
  window.addEventListener('keydown', (event) => {
    if (event.code === 'Space') event.preventDefault();
    state.keys.add(event.code);
  });
  window.addEventListener('keyup', (event) => state.keys.delete(event.code));
  window.addEventListener('blur', () => {
    state.keys.clear();
    state.firing = false;
    state.aiming = false;
  });

  return {
    state,
    takeLook() {
      const taken = { x: lookX, y: lookY };
      lookX = 0;
      lookY = 0;
      return taken;
    },
    takeWheel() {
      const taken = state.wheel;
      state.wheel = 0;
      return taken;
    },
    requestLock() {
      canvas.requestPointerLock();
    },
  };
}
