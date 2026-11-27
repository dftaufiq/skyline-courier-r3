// Keyboard and mouse, read fresh every frame. Arrows / WASD fly the plane,
// Shift / Ctrl work the throttle, Space is the airbrake, P pauses, R
// restarts, M mutes. The mouse steers too: hold the left button and the
// plane follows the pointer — the pointer's offset from centre is the stick.
export function createInput(canvas, hooks) {
  const keys = new Set();
  const mouse = { active: false, x: 0, y: 0, down: false };

  function onKeyDown(e) {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) e.preventDefault();
    if (e.repeat) return;
    keys.add(e.code);
    if (e.code === 'KeyP' && hooks.onPause) hooks.onPause();
    if (e.code === 'KeyR' && hooks.onRestart) hooks.onRestart();
    if (e.code === 'KeyM' && hooks.onMute) hooks.onMute();
    if ((e.code === 'Enter' || e.code === 'Space') && hooks.onConfirm) hooks.onConfirm();
    if ((e.code === 'Digit1' || e.code === 'Digit2' || e.code === 'Digit3') && hooks.onSortie) {
      hooks.onSortie(Number(e.code.slice(-1)) - 1);
    }
  }
  function onKeyUp(e) {
    keys.delete(e.code);
  }
  function onMouseMove(e) {
    const rect = canvas.getBoundingClientRect();
    mouse.x = (e.clientX - rect.left) / rect.width - 0.5;
    mouse.y = (e.clientY - rect.top) / rect.height - 0.5;
    mouse.active = true;
  }
  function onMouseDown(e) {
    mouse.down = true;
    onMouseMove(e);
    if (hooks.onConfirm) hooks.onConfirm();
  }
  function onMouseUp() {
    mouse.down = false;
  }

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  canvas.addEventListener('mousemove', onMouseMove);
  canvas.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mouseup', onMouseUp);

  // The frame's control state: -1..1 pitch (up is negative, pull back to
  // climb), -1..1 roll, 0..1 throttle target, brake on/off.
  function read() {
    let pitch = 0;
    let roll = 0;
    if (keys.has('ArrowUp') || keys.has('KeyW')) pitch -= 1;
    if (keys.has('ArrowDown') || keys.has('KeyS')) pitch += 1;
    if (keys.has('ArrowLeft') || keys.has('KeyA')) roll -= 1;
    if (keys.has('ArrowRight') || keys.has('KeyD')) roll += 1;
    if (mouse.down && mouse.active) {
      pitch = Math.max(-1, Math.min(1, mouse.y * 2.4));
      roll = Math.max(-1, Math.min(1, mouse.x * 2.4));
    }
    let throttle = 0.62;
    if (keys.has('ShiftLeft') || keys.has('ShiftRight') || keys.has('KeyE')) throttle = 1;
    if (keys.has('ControlLeft') || keys.has('ControlRight') || keys.has('KeyQ')) throttle = 0.15;
    if (keys.has('KeyW') && keys.has('ShiftLeft')) throttle = 1;
    return {
      pitch,
      roll,
      throttle,
      brake: keys.has('Space') || keys.has('KeyB'),
    };
  }

  function destroy() {
    window.removeEventListener('keydown', onKeyDown);
    window.removeEventListener('keyup', onKeyUp);
    canvas.removeEventListener('mousemove', onMouseMove);
    canvas.removeEventListener('mousedown', onMouseDown);
    window.removeEventListener('mouseup', onMouseUp);
  }

  return { read, keys, mouse, destroy };
}
