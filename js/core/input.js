// Wheel / trackpad / touch / keyboard / pointer input (PLAN 4.4).
// Produces scroll deltas (in scroll units, see rail.js), station steps, and touch-moment drags.
import { SCROLL } from './config.js';

export function createInput(canvas, handlers) {
  // handlers: { scroll(ds), step(dir), home(), end(), canDrag(): 'none'|'x'|'y'|'xy', drag(ev), activity(), mouse(nx, ny) }
  const state = { lastInput: -1e9, lastDir: 1, dragging: null };

  function now() { return performance.now() / 1000; }
  function mark(dir) { state.lastInput = now(); if (dir) state.lastDir = dir; handlers.activity && handlers.activity(); }

  function onWheel(e) {
    if (e.ctrlKey) return; // pinch zoom
    if (handlers.blocked && handlers.blocked(e)) return;
    e.preventDefault();
    let dy = e.deltaY, dx = e.deltaX;
    if (e.deltaMode === 1) { dy *= 40; dx *= 40; } else if (e.deltaMode === 2) { dy *= innerHeight; dx *= innerHeight; }
    const d = Math.abs(dy) >= Math.abs(dx) ? dy : dx;
    let ds = d / SCROLL.wheelPxPerStation;
    ds = Math.max(-SCROLL.maxStepPerEvent, Math.min(SCROLL.maxStepPerEvent, ds));
    if (ds === 0) return;
    handlers.scroll(ds);
    mark(Math.sign(ds));
  }

  // Pointer: touch swipes scroll (vertical), drags on touch-moment stations go to the station.
  let pd = null; // { id, x0, y0, x, y, t, mode, type, vel }
  function nx(x) { return (x / innerWidth) * 2 - 1; }
  function ny(y) { return -((y / innerHeight) * 2 - 1); }

  function onDown(e) {
    if (pd) return;
    pd = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, t: performance.now(), mode: null, type: e.pointerType, vel: 0 };
    try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
  }
  function onMove(e) {
    handlers.mouse && e.pointerType === 'mouse' && handlers.mouse(nx(e.clientX), ny(e.clientY));
    if (!pd || e.pointerId !== pd.id) return;
    const dxTot = e.clientX - pd.x0, dyTot = e.clientY - pd.y0;
    const ddx = e.clientX - pd.x, ddy = e.clientY - pd.y;
    const tNow = performance.now();
    const dt = Math.max(1, tNow - pd.t);
    if (!pd.mode) {
      if (Math.hypot(dxTot, dyTot) < SCROLL.dragThresholdPx) return;
      const allow = handlers.canDrag ? handlers.canDrag() : 'none';
      const horiz = Math.abs(dxTot) > Math.abs(dyTot);
      if (pd.type === 'mouse' || pd.type === 'pen') {
        pd.mode = allow !== 'none' ? 'station' : 'ignore';
      } else {
        // touch: vertical swipes scroll; horizontal drags go to the station
        if (horiz && allow !== 'none') pd.mode = 'station';
        else if (!horiz) pd.mode = 'scroll';
        else pd.mode = 'scroll-x';
      }
      if (pd.mode === 'station') handlers.drag({ type: 'start', dx: 0, dy: 0, x: nx(pd.x0), y: ny(pd.y0) });
    }
    if (pd.mode === 'station') {
      handlers.drag({ type: 'move', dx: (ddx / innerWidth) * 2, dy: -(ddy / innerHeight) * 2, x: nx(e.clientX), y: ny(e.clientY), totalDx: (dxTot / innerWidth) * 2, totalDy: -(dyTot / innerHeight) * 2 });
    } else if (pd.mode === 'scroll' || pd.mode === 'scroll-x') {
      const d = pd.mode === 'scroll' ? -ddy : -ddx;
      const ds = d / (innerHeight * SCROLL.touchScreensPerStation);
      pd.vel = 0.7 * pd.vel + 0.3 * (ds / (dt / 1000));
      handlers.scroll(ds);
      mark(Math.sign(ds) || 0);
    }
    pd.x = e.clientX; pd.y = e.clientY; pd.t = tNow;
  }
  function onUp(e) {
    if (!pd || e.pointerId !== pd.id) return;
    if (pd.mode === 'station') handlers.drag({ type: 'end', dx: 0, dy: 0, x: nx(e.clientX), y: ny(e.clientY) });
    if ((pd.mode === 'scroll' || pd.mode === 'scroll-x') && performance.now() - pd.t < 80) {
      // small fling
      const fling = Math.max(-0.6, Math.min(0.6, pd.vel * 0.18));
      if (Math.abs(fling) > 0.02) { handlers.scroll(fling); mark(Math.sign(fling)); }
    }
    try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
    pd = null;
  }

  function onKey(e) {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    if (handlers.blocked && handlers.blocked(e)) return;
    const tag = (e.target && e.target.tagName) || '';
    const interactive = /^(INPUT|TEXTAREA|SELECT)$/.test(tag);
    if (interactive) return;
    const onControl = /^(BUTTON|A)$/.test(tag);
    switch (e.key) {
      case 'ArrowDown': case 'ArrowRight': case 'PageDown':
        e.preventDefault(); handlers.step(1); mark(1); break;
      case 'ArrowUp': case 'ArrowLeft': case 'PageUp':
        e.preventDefault(); handlers.step(-1); mark(-1); break;
      case ' ': case 'Spacebar':
        if (onControl) return;
        e.preventDefault(); handlers.step(e.shiftKey ? -1 : 1); mark(e.shiftKey ? -1 : 1); break;
      case 'Home': e.preventDefault(); handlers.home(); mark(-1); break;
      case 'End': e.preventDefault(); handlers.end(); mark(1); break;
    }
  }

  window.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('pointerdown', onDown);
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
  window.addEventListener('keydown', onKey);

  return {
    state,
    idleFor() { return now() - state.lastInput; },
    get lastDir() { return state.lastDir; },
    isDragging() { return !!(pd && pd.mode === 'station'); }
  };
}
