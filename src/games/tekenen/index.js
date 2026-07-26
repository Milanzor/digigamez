import './style.css';
import { createHud } from '../../shared/ui-components.js';
import {
  setupCanvas, LOGICAL_WIDTH, LOGICAL_HEIGHT, createStars, drawSpaceBackdrop,
} from '../../shared/canvas-utils.js';
import { sfx } from '../../shell/audio.js';

// "Ruimtetekenen" — free drawing on a starfield.
//
// This is the one open-ended game, so instead of levels the depth is in the
// toolset: a glow brush, mirror symmetry (which turns scribbles into
// satisfying symmetrical creatures), space stamps, and undo. Multi-touch is
// tracked per pointer so two children can draw at once.

// Palette and stamp count are deliberately small: everything has to fit on
// one row of the toolbar. A scrolling toolbar is a dead end for a 3-year-old
// who won't discover that it scrolls.
const COLORS = ['#ffffff', '#ffb224', '#ff5f4d', '#2fd9c6', '#7cc4ff', '#b06bff'];
const SIZES = [10, 24, 46];
const STAMPS = ['⭐', '🪐', '🚀', '👽'];

let hud = null;
let handle = null;
let listeners = [];
let undoStack = [];

export function init(container, opts) {
  listeners = [];
  undoStack = [];

  hud = createHud(container, { title: opts.title, onExit: opts.onExit });

  const stage = document.createElement('div');
  stage.className = 'draw-stage';
  const canvas = document.createElement('canvas');
  canvas.className = 'draw-canvas';
  stage.appendChild(canvas);
  container.appendChild(stage);

  handle = setupCanvas(canvas, { alpha: false, preserveOnResize: true });
  const { ctx, toLogical } = handle;

  const stars = createStars(150);

  const paintBackdrop = () => {
    drawSpaceBackdrop(ctx, stars, 0, { scrollSpeed: 0 });
  };
  paintBackdrop();

  const state = {
    color: COLORS[1],
    size: SIZES[1],
    mode: 'brush', // brush | glow | erase | stamp
    stamp: STAMPS[0],
    mirror: false,
  };

  const pushUndo = () => {
    try {
      // Snapshot at reduced resolution: an exact copy of a 4K buffer per
      // stroke would blow through memory fast, and for undo purposes a
      // logical-resolution snapshot is indistinguishable.
      undoStack.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
      if (undoStack.length > 8) undoStack.shift();
    } catch {
      // getImageData can fail on tainted canvases; undo just becomes a no-op.
    }
  };

  const strokes = new Map();

  const strokeAt = (x, y, prev, s) => {
    const draw = (px, py, qx, qy) => {
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(qx, qy);
      ctx.stroke();
    };
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = s.width;
    ctx.strokeStyle = s.color;
    ctx.shadowBlur = s.glow ? s.width * 1.6 : 0;
    ctx.shadowColor = s.glow ? s.color : 'transparent';

    draw(prev.x, prev.y, x, y);
    if (state.mirror) {
      draw(LOGICAL_WIDTH - prev.x, prev.y, LOGICAL_WIDTH - x, y);
    }
    ctx.shadowBlur = 0;
  };

  const onDown = (e) => {
    if (bar.contains(e.target)) return;
    const { x, y } = toLogical(e.clientX, e.clientY);

    if (state.mode === 'stamp') {
      pushUndo();
      ctx.save();
      ctx.font = `${state.size * 3.4}px serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(state.stamp, x, y);
      if (state.mirror) ctx.fillText(state.stamp, LOGICAL_WIDTH - x, y);
      ctx.restore();
      sfx.blip();
      return;
    }

    canvas.setPointerCapture(e.pointerId);
    if (strokes.size === 0) pushUndo();

    const s = {
      x, y,
      color: state.mode === 'erase' ? '#0a1036' : state.color,
      width: state.mode === 'erase' ? state.size * 2.4 : state.size,
      glow: state.mode === 'glow',
    };
    strokes.set(e.pointerId, s);
    // Dot so a single tap leaves a mark
    ctx.fillStyle = s.color;
    ctx.beginPath();
    ctx.arc(x, y, s.width / 2, 0, Math.PI * 2);
    ctx.fill();
    if (state.mirror) {
      ctx.beginPath();
      ctx.arc(LOGICAL_WIDTH - x, y, s.width / 2, 0, Math.PI * 2);
      ctx.fill();
    }
  };

  const onMove = (e) => {
    const s = strokes.get(e.pointerId);
    if (!s) return;
    const { x, y } = toLogical(e.clientX, e.clientY);
    strokeAt(x, y, s, s);
    s.x = x;
    s.y = y;
  };

  const onUp = (e) => strokes.delete(e.pointerId);

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);

  // --- toolbar ---
  const bar = document.createElement('div');
  bar.className = 'draw-bar';

  const swatches = COLORS.map((color, i) => {
    const b = document.createElement('button');
    b.className = `swatch${i === 1 ? ' is-active' : ''}`;
    b.style.background = color;
    b.style.color = color;
    b.setAttribute('aria-label', `Kleur ${i + 1}`);
    b.addEventListener('pointerup', () => {
      state.color = color;
      state.mode = state.mode === 'glow' ? 'glow' : 'brush';
      swatches.forEach((s) => s.classList.remove('is-active'));
      b.classList.add('is-active');
      modeTools.erase.classList.remove('is-active');
      stampTools.forEach((s) => s.classList.remove('is-active'));
      sfx.blip();
    });
    bar.appendChild(b);
    return b;
  });

  bar.appendChild(sep());

  const sizeBtns = SIZES.map((value, i) => {
    const b = document.createElement('button');
    b.className = `tool${i === 1 ? ' is-active' : ''}`;
    b.textContent = '●';
    b.style.fontSize = `${10 + value * 0.5}px`;
    b.setAttribute('aria-label', `Dikte ${i + 1}`);
    b.addEventListener('pointerup', () => {
      state.size = value;
      sizeBtns.forEach((s) => s.classList.remove('is-active'));
      b.classList.add('is-active');
      sfx.blip();
    });
    bar.appendChild(b);
    return b;
  });

  bar.appendChild(sep());

  const modeTools = {};

  modeTools.glow = mkTool('✨', 'Gloeiende stift', () => {
    state.mode = state.mode === 'glow' ? 'brush' : 'glow';
    modeTools.glow.classList.toggle('is-active', state.mode === 'glow');
    modeTools.erase.classList.remove('is-active');
    sfx.powerup();
  });

  modeTools.mirror = mkTool('🦋', 'Spiegelen aan/uit', () => {
    state.mirror = !state.mirror;
    modeTools.mirror.classList.toggle('is-active', state.mirror);
    sfx.select();
  });

  modeTools.erase = mkTool('🧽', 'Gum', () => {
    state.mode = 'erase';
    modeTools.erase.classList.add('is-active');
    modeTools.glow.classList.remove('is-active');
    stampTools.forEach((s) => s.classList.remove('is-active'));
    sfx.blip();
  });

  bar.appendChild(sep());

  const stampTools = STAMPS.map((emoji) => mkTool(emoji, `Stempel ${emoji}`, (btn) => {
    state.mode = 'stamp';
    state.stamp = emoji;
    stampTools.forEach((s) => s.classList.remove('is-active'));
    modeTools.erase.classList.remove('is-active');
    btn.classList.add('is-active');
    sfx.blip();
  }));

  bar.appendChild(sep());

  mkTool('↩️', 'Ongedaan maken', () => {
    const snap = undoStack.pop();
    if (snap) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.putImageData(snap, 0, 0);
      ctx.restore();
      sfx.back();
    } else {
      sfx.deny();
    }
  });

  mkTool('🗑️', 'Alles wissen', () => {
    pushUndo();
    paintBackdrop();
    sfx.explode();
  });

  stage.appendChild(bar);

  function sep() {
    const d = document.createElement('div');
    d.className = 'bar-sep';
    return d;
  }

  function mkTool(label, aria, handler) {
    const b = document.createElement('button');
    b.className = 'tool';
    b.textContent = label;
    b.setAttribute('aria-label', aria);
    b.addEventListener('pointerup', () => handler(b));
    bar.appendChild(b);
    return b;
  }

  hud.banner('Teken je eigen ruimte! 🎨', { ms: 1800, hint: true });

  listeners.push(() => {
    canvas.removeEventListener('pointerdown', onDown);
    canvas.removeEventListener('pointermove', onMove);
    canvas.removeEventListener('pointerup', onUp);
    canvas.removeEventListener('pointercancel', onUp);
  });
}

export function destroy() {
  listeners.forEach((off) => off());
  listeners = [];
  undoStack = [];
  handle?.disconnect();
  handle = null;
  hud?.destroy();
  hud = null;
}
