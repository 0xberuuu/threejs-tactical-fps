// Keyboard, mouse and pointer-lock input. Holds only the current pressed
// state plus edge-triggered queues the simulation drains once per step, so
// no input is ever lost between frames.
export function createInput(canvas, onLockChange) {
  const keys = new Set();
  const pressed = new Set(); // edge-triggered, drained by consumePressed
  let mouseDX = 0;
  let mouseDY = 0;
  let mouseDown = false;
  let locked = false;
  let enabled = false;

  function keyName(event) {
    if (event.code === 'Space') return 'Space';
    if (event.code.startsWith('Key')) return event.code.slice(3).toLowerCase();
    if (event.code.startsWith('Digit')) return event.code.slice(5);
    return event.code;
  }

  function onKeyDown(event) {
    if (event.code === 'Tab') event.preventDefault();
    const key = keyName(event);
    if (!event.repeat) pressed.add(key);
    keys.add(key);
  }

  function onKeyUp(event) {
    keys.delete(keyName(event));
  }

  function onMouseMove(event) {
    if (!locked) return;
    mouseDX += event.movementX || 0;
    mouseDY += event.movementY || 0;
  }

  function onMouseDown(event) {
    if (event.button === 0) mouseDown = true;
  }

  function onMouseUp(event) {
    if (event.button === 0) mouseDown = false;
  }

  function onLock() {
    locked = document.pointerLockElement === canvas;
    onLockChange(locked);
  }

  return {
    get locked() {
      return locked;
    },
    get mouseDown() {
      return mouseDown;
    },
    enable() {
      if (enabled) return;
      enabled = true;
      window.addEventListener('keydown', onKeyDown);
      window.addEventListener('keyup', onKeyUp);
      document.addEventListener('mousemove', onMouseMove);
      document.addEventListener('mousedown', onMouseDown);
      document.addEventListener('mouseup', onMouseUp);
      document.addEventListener('pointerlockchange', onLock);
    },
    requestLock() {
      if (!locked) canvas.requestPointerLock();
    },
    releaseLock() {
      if (locked) document.exitPointerLock();
    },
    down(key) {
      return keys.has(key);
    },
    consumePressed(key) {
      if (pressed.has(key)) {
        pressed.delete(key);
        return true;
      }
      return false;
    },
    consumeLook() {
      const dx = mouseDX;
      const dy = mouseDY;
      mouseDX = 0;
      mouseDY = 0;
      return [dx, dy];
    },
    endFrame() {
      pressed.clear();
    },
  };
}
