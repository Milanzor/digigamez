import './style.css';
import { createGameChrome } from '../../shared/ui-components.js';
import { setupCanvas, LOGICAL_WIDTH, LOGICAL_HEIGHT } from '../../shared/canvas-utils.js';
import { sfx } from '../../shell/audio.js';

const COLORS = ['#1f2547', '#ef476f', '#ff9f1c', '#ffd166', '#06d6a0', '#118ab2', '#8338ec', '#ffffff'];
const SIZES = { klein: 8, middel: 18, groot: 32 };
const STAMPS = ['⭐', '❤️', '🌸', '🦋', '☀️'];

let canvasHandle, cleanupFns = [];

export function init(container, { title, onExit }) {
  cleanupFns = [];
  const chrome = createGameChrome({ title, onExit });

  const stage = document.createElement('div');
  stage.className = 'tk-stage';

  const canvas = document.createElement('canvas');
  canvas.className = 'tk-canvas';
  stage.appendChild(canvas);

  const toolbar = buildToolbar();
  stage.appendChild(toolbar.el);

  container.appendChild(chrome);
  container.appendChild(stage);

  canvasHandle = setupCanvas(canvas, { alpha: false });
  const { ctx, toLogical } = canvasHandle;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);

  let state = { color: COLORS[1], size: SIZES.middel, mode: 'draw' };
  toolbar.onStateChange((s) => { state = { ...state, ...s }; });

  const strokes = new Map();

  function pointerDown(e) {
    if (toolbar.el.contains(e.target)) return;
    const { x, y } = toLogical(e.clientX, e.clientY);

    if (state.mode === 'stamp') {
      ctx.font = '90px serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(state.stampEmoji || STAMPS[0], x, y);
      sfx.pop();
      return;
    }

    canvas.setPointerCapture(e.pointerId);
    strokes.set(e.pointerId, { x, y, color: state.mode === 'erase' ? '#ffffff' : state.color, size: state.mode === 'erase' ? state.size * 2.2 : state.size });
    drawDot(ctx, x, y, strokes.get(e.pointerId));
  }

  function pointerMove(e) {
    const stroke = strokes.get(e.pointerId);
    if (!stroke) return;
    const { x, y } = toLogical(e.clientX, e.clientY);
    ctx.strokeStyle = stroke.color;
    ctx.lineWidth = stroke.size;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(stroke.x, stroke.y);
    ctx.lineTo(x, y);
    ctx.stroke();
    stroke.x = x;
    stroke.y = y;
  }

  function pointerUp(e) {
    strokes.delete(e.pointerId);
  }

  canvas.addEventListener('pointerdown', pointerDown);
  canvas.addEventListener('pointermove', pointerMove);
  canvas.addEventListener('pointerup', pointerUp);
  canvas.addEventListener('pointercancel', pointerUp);

  toolbar.onClear(() => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);
    sfx.swoosh();
  });

  cleanupFns.push(() => {
    canvas.removeEventListener('pointerdown', pointerDown);
    canvas.removeEventListener('pointermove', pointerMove);
    canvas.removeEventListener('pointerup', pointerUp);
    canvas.removeEventListener('pointercancel', pointerUp);
    canvasHandle.disconnect();
  });
}

function drawDot(ctx, x, y, stroke) {
  ctx.fillStyle = stroke.color;
  ctx.beginPath();
  ctx.arc(x, y, stroke.size / 2, 0, Math.PI * 2);
  ctx.fill();
}

function buildToolbar() {
  const el = document.createElement('div');
  el.className = 'tk-toolbar';

  let changeHandler = () => {};
  let clearHandler = () => {};
  let activeSwatch = null, activeSizeBtn = null, activeStampBtn = null;

  COLORS.forEach((color, i) => {
    const btn = document.createElement('button');
    btn.className = 'tk-swatch' + (i === 1 ? ' active' : '');
    btn.style.background = color;
    if (color === '#ffffff') btn.style.border = '4px solid #ddd';
    btn.addEventListener('pointerup', () => {
      changeHandler({ color, mode: 'draw' });
      sfx.click();
      activeSwatch?.classList.remove('active');
      activeStampBtn?.classList.remove('active');
      btn.classList.add('active');
      activeSwatch = btn;
    });
    if (i === 1) activeSwatch = btn;
    el.appendChild(btn);
  });

  el.appendChild(divider());

  Object.entries(SIZES).forEach(([label, value], i) => {
    const btn = document.createElement('button');
    btn.className = 'tk-tool' + (i === 1 ? ' active' : '');
    btn.textContent = '●';
    btn.style.fontSize = 12 + value / 2 + 'px';
    btn.addEventListener('pointerup', () => {
      changeHandler({ size: value });
      sfx.click();
      activeSizeBtn?.classList.remove('active');
      btn.classList.add('active');
      activeSizeBtn = btn;
    });
    if (i === 1) activeSizeBtn = btn;
    el.appendChild(btn);
  });

  el.appendChild(divider());

  const eraseBtn = document.createElement('button');
  eraseBtn.className = 'tk-tool';
  eraseBtn.textContent = '🧽';
  eraseBtn.addEventListener('pointerup', () => {
    changeHandler({ mode: 'erase' });
    sfx.click();
    activeSwatch?.classList.remove('active');
    activeStampBtn?.classList.remove('active');
  });
  el.appendChild(eraseBtn);

  STAMPS.forEach((emoji) => {
    const btn = document.createElement('button');
    btn.className = 'tk-tool';
    btn.textContent = emoji;
    btn.addEventListener('pointerup', () => {
      changeHandler({ mode: 'stamp', stampEmoji: emoji });
      sfx.click();
      activeSwatch?.classList.remove('active');
      activeStampBtn?.classList.remove('active');
      btn.classList.add('active');
      activeStampBtn = btn;
    });
    el.appendChild(btn);
  });

  el.appendChild(divider());

  const clearBtn = document.createElement('button');
  clearBtn.className = 'tk-tool';
  clearBtn.textContent = '🗑️';
  clearBtn.addEventListener('pointerup', () => clearHandler());
  el.appendChild(clearBtn);

  return {
    el,
    onStateChange: (fn) => { changeHandler = fn; },
    onClear: (fn) => { clearHandler = fn; },
  };
}

function divider() {
  const d = document.createElement('div');
  d.className = 'tk-divider';
  return d;
}

export function destroy() {
  cleanupFns.forEach((fn) => fn());
  cleanupFns = [];
}
