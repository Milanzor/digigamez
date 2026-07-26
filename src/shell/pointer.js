// Unified pointer-event helpers: touch + mouse via the Pointer Events API,
// with support for tracking multiple simultaneous touches (2-speler split-zones).

export function onTap(el, handler, opts = {}) {
  let startX = 0;
  let startY = 0;
  let startId = null;
  const moveTolerance = opts.moveTolerance ?? 24;

  function down(e) {
    startId = e.pointerId;
    startX = e.clientX;
    startY = e.clientY;
  }
  function up(e) {
    if (e.pointerId !== startId) return;
    const dx = Math.abs(e.clientX - startX);
    const dy = Math.abs(e.clientY - startY);
    if (dx < moveTolerance && dy < moveTolerance) {
      handler(e);
    }
    startId = null;
  }
  el.addEventListener('pointerdown', down);
  el.addEventListener('pointerup', up);
  return () => {
    el.removeEventListener('pointerdown', down);
    el.removeEventListener('pointerup', up);
  };
}

// Tracks active pointers by id, useful for drag interactions and
// simultaneous multi-touch (two children touching the screen at once).
export class PointerTracker {
  constructor(el) {
    this.el = el;
    this.pointers = new Map();
    this._down = (e) => {
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY });
      this.onDown?.(e, this.pointers.get(e.pointerId));
    };
    this._move = (e) => {
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      p.x = e.clientX;
      p.y = e.clientY;
      this.onMove?.(e, p);
    };
    this._up = (e) => {
      const p = this.pointers.get(e.pointerId);
      this.pointers.delete(e.pointerId);
      this.onUp?.(e, p);
    };
    el.addEventListener('pointerdown', this._down);
    el.addEventListener('pointermove', this._move);
    el.addEventListener('pointerup', this._up);
    el.addEventListener('pointercancel', this._up);
  }

  destroy() {
    this.el.removeEventListener('pointerdown', this._down);
    this.el.removeEventListener('pointermove', this._move);
    this.el.removeEventListener('pointerup', this._up);
    this.el.removeEventListener('pointercancel', this._up);
    this.pointers.clear();
  }
}

// Converts a client-space (viewport) coordinate to canvas logical coordinates,
// accounting for CSS scaling between the canvas's internal resolution and its
// displayed size.
export function toCanvasCoords(canvas, clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  return {
    x: (clientX - rect.left) * scaleX,
    y: (clientY - rect.top) * scaleY,
  };
}
