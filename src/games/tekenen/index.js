import './style.css';
import { createHud } from '../../shared/ui-components.js';
import { sfx } from '../../shell/audio.js';

// "Ruimtetekenen" — the one open-ended game, so the depth is in the toolset
// rather than in levels: seven brushes, four shapes, stamps, symmetry, and a
// board three screens wide that you pan and zoom around.
//
// Strokes are stored as vectors, not pixels. That buys three things a bitmap
// board can't: undo/redo is a list operation instead of a stack of 4K image
// snapshots, the artwork stays crisp at any zoom, and the eraser can cut into
// the drawing layer without taking the starfield with it.
//
// Rendering is two-layer. `cache` holds every stroke already projected through
// the camera; each frame blits the backdrop, then the cache, then any
// in-progress shape preview. While a child draws, only the newest segment is
// added to the cache, so a ten-minute scribble costs no more per frame than
// the first line. The camera moving (or a resize) is what forces a full
// repaint of the cache from the vector list.

const LOGICAL_W = 1920;
const LOGICAL_H = 1080;
// Three logical screens in each direction — enough room that two children can
// each claim a corner, small enough that nobody gets lost in the void.
const WORLD_W = LOGICAL_W * 3;
const WORLD_H = LOGICAL_H * 3;
const MIN_ZOOM = 0.4;
const MAX_ZOOM = 4;

const COLORS = [
  '#ffffff', '#ffe066', '#ffb224', '#ff5f4d', '#ff7ab8', '#b06bff',
  '#7cc4ff', '#3b6bff', '#2fd9c6', '#6ee87a', '#b0764a', '#141a3c',
];

const SIZES = [8, 18, 34, 64];

const BRUSHES = [
  { id: 'pen', icon: '✏️', label: 'Stift' },
  { id: 'neon', icon: '✨', label: 'Neonstift' },
  { id: 'crayon', icon: '🖍️', label: 'Krijt' },
  { id: 'rainbow', icon: '🌈', label: 'Regenboogstift' },
  { id: 'sparkle', icon: '💫', label: 'Sterrenstof' },
  { id: 'spray', icon: '🎨', label: 'Spuitbus' },
  { id: 'erase', icon: '🧽', label: 'Gum' },
];

const SHAPES = [
  { id: 'line', icon: '➖', label: 'Lijn' },
  { id: 'rect', icon: '▭', label: 'Rechthoek' },
  { id: 'circle', icon: '⬭', label: 'Cirkel' },
  { id: 'star', icon: '⭐', label: 'Ster' },
];

const STAMPS = [
  '⭐', '🌟', '🪐', '🚀', '🛸', '👽', '🌙', '☄️',
  '🌈', '❤️', '😀', '🐱', '🦖', '🍕', '🌍', '👾',
];

const BACKDROPS = ['ruimte', 'nacht', 'papier', 'raster'];

// Brushes whose look depends on the whole path being painted in order, so
// they are repainted every frame while in flight rather than appended to the
// cache segment by segment.
const LIVE_REPAINT = new Set(['neon']);

// Deterministic noise so a stroke's jitter, spray dots and sparkles come back
// identically every time the cache is rebuilt.
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeStars() {
  const rnd = mulberry32(20260726);
  const stars = [];
  for (let i = 0; i < 1400; i++) {
    stars.push({
      x: rnd() * WORLD_W,
      y: rnd() * WORLD_H,
      r: 0.8 + rnd() * 2.6,
      a: 0.25 + rnd() * 0.6,
    });
  }
  return stars;
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

let G = null;

export function init(container, opts) {
  const hud = createHud(container, { title: opts.title, onExit: opts.onExit });

  const stage = document.createElement('div');
  stage.className = 'draw-stage';
  const canvas = document.createElement('canvas');
  canvas.className = 'draw-canvas';
  stage.appendChild(canvas);
  container.appendChild(stage);

  G = {
    hud,
    stage,
    canvas,
    ctx: canvas.getContext('2d', { alpha: false, desynchronized: true }),
    cache: document.createElement('canvas'),
    cacheCtx: null,
    stars: makeStars(),
    strokes: [],
    undoStack: [],
    redoStack: [],
    // Strokes being drawn right now, keyed by pointer id. Two children can
    // hold a line each; a shape or a pan lives in here as well.
    active: new Map(),
    previews: new Set(),
    cam: { x: 0, y: 0, zoom: 1 },
    dpr: 1,
    base: 1,
    seq: 1,
    dirty: true,
    cacheDirty: true,
    raf: 0,
    listeners: [],
    state: {
      tool: 'pen',
      shape: 'line',
      stamp: STAMPS[0],
      color: COLORS[1],
      size: SIZES[1],
      sym: 'none',
      fill: false,
      backdrop: 0,
    },
  };
  G.cacheCtx = G.cache.getContext('2d');

  buildToolbar();
  attachPointer();
  attachWheel();

  const ro = new ResizeObserver(resize);
  ro.observe(stage);
  G.listeners.push(() => ro.disconnect());
  resize();
  centerCamera();

  const loop = () => {
    G.raf = requestAnimationFrame(loop);
    if (!G.dirty) return;
    if (G.cacheDirty) rebuildCache();
    render();
    G.dirty = false;
  };
  G.raf = requestAnimationFrame(loop);

  hud.banner('Teken je eigen ruimte! 🎨', {
    sub: 'Pak ✋ om te schuiven en in te zoomen',
    ms: 2600,
    hint: true,
  });
}

export function destroy() {
  if (!G) return;
  cancelAnimationFrame(G.raf);
  G.listeners.forEach((off) => off());
  G.hud.destroy();
  G = null;
}

// --- camera ---------------------------------------------------------------

const scaleOf = () => G.base * G.cam.zoom;
const viewW = () => G.canvas.width / scaleOf();
const viewH = () => G.canvas.height / scaleOf();

function clampCamera() {
  const vw = viewW();
  const vh = viewH();
  G.cam.x = vw >= WORLD_W ? (WORLD_W - vw) / 2 : clamp(G.cam.x, 0, WORLD_W - vw);
  G.cam.y = vh >= WORLD_H ? (WORLD_H - vh) / 2 : clamp(G.cam.y, 0, WORLD_H - vh);
}

function centerCamera() {
  G.cam.x = (WORLD_W - viewW()) / 2;
  G.cam.y = (WORLD_H - viewH()) / 2;
  clampCamera();
  invalidateCamera();
}

function invalidateCamera() {
  G.cacheDirty = true;
  G.dirty = true;
  if (G.zoomReadout) G.zoomReadout.textContent = `${Math.round(G.cam.zoom * 100)}%`;
}

function applyCamera(c) {
  const k = scaleOf();
  c.setTransform(k, 0, 0, k, -G.cam.x * k, -G.cam.y * k);
}

// Zooms around a fixed screen point, so the bit of drawing under the finger
// (or the mouse) stays under it.
function zoomAt(clientX, clientY, factor) {
  const before = toWorld(clientX, clientY);
  G.cam.zoom = clamp(G.cam.zoom * factor, MIN_ZOOM, MAX_ZOOM);
  const after = toWorld(clientX, clientY);
  G.cam.x += before.x - after.x;
  G.cam.y += before.y - after.y;
  clampCamera();
  invalidateCamera();
}

function zoomCenter(factor) {
  const r = G.canvas.getBoundingClientRect();
  zoomAt(r.left + r.width / 2, r.top + r.height / 2, factor);
}

function toWorld(clientX, clientY) {
  const r = G.canvas.getBoundingClientRect();
  const k = scaleOf();
  return {
    x: ((clientX - r.left) * G.dpr) / k + G.cam.x,
    y: ((clientY - r.top) * G.dpr) / k + G.cam.y,
  };
}

function resize() {
  const rect = G.stage.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  // Cap DPR at 2: beyond that the extra pixels are invisible at digiboard
  // viewing distance but the fill cost grows quadratically.
  G.dpr = Math.min(window.devicePixelRatio || 1, 2);
  G.canvas.width = Math.round(rect.width * G.dpr);
  G.canvas.height = Math.round(rect.height * G.dpr);
  G.canvas.style.width = `${rect.width}px`;
  G.canvas.style.height = `${rect.height}px`;
  G.cache.width = G.canvas.width;
  G.cache.height = G.canvas.height;
  // A stroke's on-screen weight should match the board, not the pixel count.
  G.base = Math.min(G.canvas.width / LOGICAL_W, G.canvas.height / LOGICAL_H);
  clampCamera();
  invalidateCamera();
}

// --- stroke rendering -----------------------------------------------------

// Symmetry is applied at paint time: each entry is a canvas transform that the
// stroke is repeated through, so a scribble on the left becomes a creature.
function symTransforms(sym) {
  if (sym === 'mirror') return [null, [-1, 0, 0, 1, WORLD_W, 0]];
  if (sym === 'quad') {
    return [
      null,
      [-1, 0, 0, 1, WORLD_W, 0],
      [1, 0, 0, -1, 0, WORLD_H],
      [-1, 0, 0, -1, WORLD_W, WORLD_H],
    ];
  }
  return [null];
}

function renderStroke(c, st, from, rng) {
  const mats = symTransforms(st.sym);
  if (st.tool === 'erase') c.globalCompositeOperation = 'destination-out';
  for (const m of mats) {
    c.save();
    if (m) c.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
    paintStroke(c, st, from, rng);
    c.restore();
  }
  c.globalCompositeOperation = 'source-over';
}

function paintStroke(c, st, from, rng) {
  if (st.kind === 'stamp') {
    if (from === 0) paintStamp(c, st);
    return;
  }
  if (st.kind === 'shape') {
    paintShape(c, st);
    return;
  }
  const p = st.points;

  if (st.tool === 'neon') {
    // Halo for the whole line first, bright core second — interleaving them
    // per segment lets each halo bite a chunk out of the previous core and
    // the tube comes out beaded.
    if (p.length === 1) paintDot(c, st, p[0], rng);
    for (let phase = 0; phase < 2; phase++) {
      for (let i = 1; i < p.length; i++) neonSegment(c, st, p[i - 1], p[i], phase);
    }
    return;
  }

  let i = from;
  if (i <= 0) {
    paintDot(c, st, p[0], rng);
    i = 1;
  }
  for (; i < p.length; i++) paintSegment(c, st, p[i - 1], p[i], i, rng);
}

function neonSegment(c, st, a, b, phase) {
  c.lineCap = 'round';
  c.lineJoin = 'round';
  if (phase === 0) {
    c.shadowBlur = st.size * 1.8;
    c.shadowColor = st.color;
    line(c, a, b, st.color, st.size);
  } else {
    c.shadowBlur = st.size * 0.7;
    c.shadowColor = st.color;
    line(c, a, b, 'rgba(255,255,255,0.9)', Math.max(1, st.size * 0.34));
  }
  c.shadowBlur = 0;
}

function strokeStyleFor(st, i) {
  if (st.tool === 'rainbow') return `hsl(${(st.hue + i * 4) % 360} 95% 62%)`;
  return st.color;
}

function paintDot(c, st, p, rng) {
  if (st.tool === 'spray' || st.tool === 'sparkle') {
    paintSegment(c, st, p, p, 0, rng);
    return;
  }
  c.fillStyle = strokeStyleFor(st, 0);
  if (st.tool === 'neon') {
    c.shadowBlur = st.size * 1.6;
    c.shadowColor = st.color;
  }
  c.beginPath();
  c.arc(p.x, p.y, (st.tool === 'erase' ? st.size * 2.4 : st.size) / 2, 0, Math.PI * 2);
  c.fill();
  c.shadowBlur = 0;
}

function paintSegment(c, st, a, b, i, rng) {
  c.lineCap = 'round';
  c.lineJoin = 'round';
  const color = strokeStyleFor(st, i);

  switch (st.tool) {
    case 'crayon': {
      // Three offset passes with gaps in them: waxy, and it lets the colour
      // underneath show through the way real crayon does.
      c.globalAlpha = 0.4;
      for (let n = 0; n < 3; n++) {
        const j = st.size * 0.3;
        line(
          c,
          { x: a.x + (rng() - 0.5) * j, y: a.y + (rng() - 0.5) * j },
          { x: b.x + (rng() - 0.5) * j, y: b.y + (rng() - 0.5) * j },
          color,
          st.size * (0.35 + rng() * 0.3)
        );
      }
      c.globalAlpha = 1;
      break;
    }
    case 'spray': {
      const dots = Math.round(clamp(st.size * 0.7, 8, 34));
      c.fillStyle = color;
      c.globalAlpha = 0.75;
      for (let n = 0; n < dots; n++) {
        const ang = rng() * Math.PI * 2;
        // sqrt keeps the dots evenly spread over the disc instead of
        // clumping in the middle.
        const rad = Math.sqrt(rng()) * st.size * 0.75;
        c.beginPath();
        c.arc(b.x + Math.cos(ang) * rad, b.y + Math.sin(ang) * rad, 1.5 + rng() * (st.size * 0.14), 0, Math.PI * 2);
        c.fill();
      }
      c.globalAlpha = 1;
      break;
    }
    case 'sparkle': {
      line(c, a, b, color, Math.max(1, st.size * 0.16));
      if (rng() < 0.55) {
        star(c, b.x + (rng() - 0.5) * st.size, b.y + (rng() - 0.5) * st.size,
          st.size * (0.3 + rng() * 0.5), rng() * Math.PI, color);
      }
      break;
    }
    case 'erase':
      line(c, a, b, '#000', st.size * 2.4);
      break;
    default:
      line(c, a, b, color, st.size);
  }
}

function line(c, a, b, color, width) {
  c.strokeStyle = color;
  c.lineWidth = width;
  c.beginPath();
  c.moveTo(a.x, a.y);
  c.lineTo(b.x, b.y);
  c.stroke();
}

function star(c, cx, cy, r, rot, color) {
  c.fillStyle = color;
  c.beginPath();
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 === 0 ? r : r * 0.42;
    const ang = rot + (Math.PI / 5) * i - Math.PI / 2;
    const x = cx + Math.cos(ang) * rad;
    const y = cy + Math.sin(ang) * rad;
    i === 0 ? c.moveTo(x, y) : c.lineTo(x, y);
  }
  c.closePath();
  c.fill();
}

function paintStamp(c, st) {
  c.save();
  c.font = `${st.size * 4}px serif`;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText(st.emoji, st.points[0].x, st.points[0].y);
  c.restore();
}

function paintShape(c, st) {
  const [a, b] = st.points;
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const w = Math.abs(b.x - a.x);
  const h = Math.abs(b.y - a.y);

  c.lineCap = 'round';
  c.lineJoin = 'round';
  c.strokeStyle = st.color;
  c.fillStyle = st.color;
  c.lineWidth = st.size;

  c.beginPath();
  if (st.shape === 'line') {
    c.moveTo(a.x, a.y);
    c.lineTo(b.x, b.y);
    c.stroke();
    return;
  }
  if (st.shape === 'rect') {
    c.rect(x, y, w, h);
  } else if (st.shape === 'circle') {
    c.ellipse(x + w / 2, y + h / 2, Math.max(w / 2, 1), Math.max(h / 2, 1), 0, 0, Math.PI * 2);
  } else {
    const r = Math.max(w, h) / 2;
    const cx = x + w / 2;
    const cy = y + h / 2;
    for (let i = 0; i < 10; i++) {
      const rad = i % 2 === 0 ? r : r * 0.45;
      const ang = (Math.PI / 5) * i - Math.PI / 2;
      const px = cx + Math.cos(ang) * rad;
      const py = cy + Math.sin(ang) * rad;
      i === 0 ? c.moveTo(px, py) : c.lineTo(px, py);
    }
    c.closePath();
  }
  st.fill ? c.fill() : c.stroke();
}

// --- backdrop -------------------------------------------------------------

// Paints the given world rectangle. Shared by the screen and the PNG export,
// which is why it takes the rectangle rather than reading the camera.
function paintBackdrop(c, x, y, w, h) {
  const mode = BACKDROPS[G.state.backdrop];

  if (mode === 'papier') {
    c.fillStyle = '#f4eddc';
    c.fillRect(x, y, w, h);
    c.fillStyle = 'rgba(120,104,72,0.18)';
    const step = 90;
    for (let gx = Math.floor(x / step) * step; gx < x + w; gx += step) {
      for (let gy = Math.floor(y / step) * step; gy < y + h; gy += step) {
        c.beginPath();
        c.arc(gx, gy, 2.4, 0, Math.PI * 2);
        c.fill();
      }
    }
    return;
  }

  if (mode === 'nacht' || mode === 'raster') {
    c.fillStyle = '#080d2b';
    c.fillRect(x, y, w, h);
    if (mode === 'raster') {
      c.strokeStyle = 'rgba(124,196,255,0.16)';
      c.lineWidth = 2;
      const step = 120;
      c.beginPath();
      for (let gx = Math.ceil(x / step) * step; gx < x + w; gx += step) {
        c.moveTo(gx, y);
        c.lineTo(gx, y + h);
      }
      for (let gy = Math.ceil(y / step) * step; gy < y + h; gy += step) {
        c.moveTo(x, gy);
        c.lineTo(x + w, gy);
      }
      c.stroke();
    }
    return;
  }

  const g = c.createLinearGradient(x, y, x + w * 0.4, y + h);
  g.addColorStop(0, '#101a4a');
  g.addColorStop(0.65, '#0a1036');
  g.addColorStop(1, '#060a24');
  c.fillStyle = g;
  c.fillRect(x, y, w, h);

  const neb = c.createRadialGradient(
    WORLD_W * 0.72, WORLD_H * 0.28, 0,
    WORLD_W * 0.72, WORLD_H * 0.28, WORLD_H * 0.6
  );
  neb.addColorStop(0, 'rgba(176,107,255,0.22)');
  neb.addColorStop(1, 'rgba(176,107,255,0)');
  c.fillStyle = neb;
  c.fillRect(x, y, w, h);

  c.fillStyle = '#ffffff';
  for (const s of G.stars) {
    if (s.x < x - 4 || s.x > x + w + 4 || s.y < y - 4 || s.y > y + h + 4) continue;
    c.globalAlpha = s.a;
    c.beginPath();
    c.arc(s.x, s.y, s.r, 0, Math.PI * 2);
    c.fill();
  }
  c.globalAlpha = 1;
}

// --- frame ----------------------------------------------------------------

function rebuildCache() {
  const c = G.cacheCtx;
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.clearRect(0, 0, G.cache.width, G.cache.height);
  applyCamera(c);
  for (const st of G.strokes) renderStroke(c, st, 0, mulberry32(st.seed));
  // Everything in flight has just been painted in full; tell the live
  // painters not to replay the segments they had already committed.
  for (const a of G.active.values()) {
    if (a.stroke) a.drawn = a.stroke.points.length;
  }
  G.cacheDirty = false;
}

function render() {
  const { ctx } = G;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  applyCamera(ctx);
  paintBackdrop(ctx, G.cam.x, G.cam.y, viewW(), viewH());

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(G.cache, 0, 0);

  if (G.previews.size) {
    applyCamera(ctx);
    for (const st of G.previews) renderStroke(ctx, st, 0, mulberry32(st.seed));
    ctx.setTransform(1, 0, 0, 1, 0, 0);
  }
}

// Draws whatever a live stroke has gained since the last frame straight into
// the cache — the whole point of keeping the cache in camera space.
function advance(a) {
  const st = a.stroke;
  if (a.drawn >= st.points.length) return;
  applyCamera(G.cacheCtx);
  renderStroke(G.cacheCtx, st, a.drawn, a.rng);
  a.drawn = st.points.length;
  G.dirty = true;
}

// --- history --------------------------------------------------------------

function pushHistory() {
  G.undoStack.push(G.strokes.slice());
  if (G.undoStack.length > 60) G.undoStack.shift();
  G.redoStack.length = 0;
}

function undo() {
  if (!G.undoStack.length) return sfx.deny();
  G.redoStack.push(G.strokes.slice());
  G.strokes = G.undoStack.pop();
  G.active.clear();
  G.previews.clear();
  G.cacheDirty = true;
  G.dirty = true;
  sfx.back();
}

function redo() {
  if (!G.redoStack.length) return sfx.deny();
  G.undoStack.push(G.strokes.slice());
  G.strokes = G.redoStack.pop();
  G.cacheDirty = true;
  G.dirty = true;
  sfx.blip();
}

// --- input ----------------------------------------------------------------

function attachPointer() {
  const { canvas, state } = G;

  const onDown = (e) => {
    canvas.setPointerCapture(e.pointerId);
    const w = toWorld(e.clientX, e.clientY);

    if (state.tool === 'pan') {
      G.active.set(e.pointerId, { pan: true, cx: e.clientX, cy: e.clientY });
      return;
    }

    if (state.tool === 'stamp') {
      const st = {
        kind: 'stamp', tool: 'stamp', emoji: state.stamp, sym: state.sym,
        size: state.size, color: state.color, seed: G.seq++, points: [w],
      };
      pushHistory();
      G.strokes.push(st);
      applyCamera(G.cacheCtx);
      renderStroke(G.cacheCtx, st, 0, mulberry32(st.seed));
      G.dirty = true;
      sfx.blip();
      return;
    }

    if (state.tool === 'shape') {
      const st = {
        kind: 'shape', tool: 'shape', shape: state.shape, fill: state.fill,
        color: state.color, size: state.size, sym: state.sym,
        seed: G.seq++, points: [w, w],
      };
      G.previews.add(st);
      G.active.set(e.pointerId, { stroke: st, shape: true });
      G.dirty = true;
      return;
    }

    const st = {
      kind: 'path', tool: state.tool, color: state.color, size: state.size,
      sym: state.sym, hue: (G.seq * 37) % 360, seed: G.seq++, points: [w],
    };
    const a = { stroke: st, drawn: 0, rng: mulberry32(st.seed) };
    G.active.set(e.pointerId, a);

    if (LIVE_REPAINT.has(st.tool)) {
      // The neon core is drawn on top of the halo, so appending segment by
      // segment would let each new halo bite a chunk out of the previous
      // core. Repaint the whole line every frame instead, and only bake it
      // into the cache once the finger lifts.
      a.live = true;
      G.previews.add(st);
      G.dirty = true;
      return;
    }

    pushHistory();
    G.strokes.push(st);
    advance(a);
  };

  const onMove = (e) => {
    const a = G.active.get(e.pointerId);
    if (!a) return;

    if (a.pan) {
      handlePan(e, a);
      return;
    }

    if (a.shape) {
      a.stroke.points[1] = toWorld(e.clientX, e.clientY);
      G.dirty = true;
      return;
    }

    // Coalesced events keep fast strokes smooth instead of polygonal.
    const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    const pts = a.stroke.points;
    const minStep = Math.max(1.6, a.stroke.size * 0.14) / G.cam.zoom;
    for (const ev of events.length ? events : [e]) {
      const w = toWorld(ev.clientX, ev.clientY);
      const last = pts[pts.length - 1];
      if (Math.hypot(w.x - last.x, w.y - last.y) < minStep) continue;
      pts.push(w);
    }
    if (a.live) G.dirty = true;
    else advance(a);
  };

  const onUp = (e) => {
    const a = G.active.get(e.pointerId);
    if (!a) return;
    G.active.delete(e.pointerId);
    if (a.pan) return;

    if (a.live) {
      G.previews.delete(a.stroke);
      pushHistory();
      G.strokes.push(a.stroke);
      applyCamera(G.cacheCtx);
      renderStroke(G.cacheCtx, a.stroke, 0, mulberry32(a.stroke.seed));
      G.dirty = true;
      return;
    }

    if (a.shape) {
      G.previews.delete(a.stroke);
      const [p0, p1] = a.stroke.points;
      // A tap with a shape tool is a slip of the finger, not a zero-size shape.
      if (Math.hypot(p1.x - p0.x, p1.y - p0.y) > 6) {
        pushHistory();
        G.strokes.push(a.stroke);
        applyCamera(G.cacheCtx);
        renderStroke(G.cacheCtx, a.stroke, 0, mulberry32(a.stroke.seed));
        sfx.blip();
      }
      G.dirty = true;
    }
  };

  const stop = (e) => e.preventDefault();

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  canvas.addEventListener('contextmenu', stop);
  G.listeners.push(() => {
    canvas.removeEventListener('pointerdown', onDown);
    canvas.removeEventListener('pointermove', onMove);
    canvas.removeEventListener('pointerup', onUp);
    canvas.removeEventListener('pointercancel', onUp);
    canvas.removeEventListener('contextmenu', stop);
  });
}

// One finger drags the board; two fingers pinch to zoom around their midpoint.
// Both only happen under the ✋ tool, so a second child putting a hand down
// never hijacks the first one's drawing.
function handlePan(e, a) {
  const pans = [...G.active.values()].filter((p) => p.pan);
  const k = scaleOf();

  if (pans.length >= 2) {
    const [p, q] = pans;
    const prevDist = Math.hypot(p.cx - q.cx, p.cy - q.cy);
    const prevMid = { x: (p.cx + q.cx) / 2, y: (p.cy + q.cy) / 2 };
    a.cx = e.clientX;
    a.cy = e.clientY;
    const dist = Math.hypot(p.cx - q.cx, p.cy - q.cy);
    const mid = { x: (p.cx + q.cx) / 2, y: (p.cy + q.cy) / 2 };
    if (prevDist > 8 && dist > 8) zoomAt(mid.x, mid.y, dist / prevDist);
    G.cam.x -= ((mid.x - prevMid.x) * G.dpr) / scaleOf();
    G.cam.y -= ((mid.y - prevMid.y) * G.dpr) / scaleOf();
    clampCamera();
    invalidateCamera();
    return;
  }

  G.cam.x -= ((e.clientX - a.cx) * G.dpr) / k;
  G.cam.y -= ((e.clientY - a.cy) * G.dpr) / k;
  a.cx = e.clientX;
  a.cy = e.clientY;
  clampCamera();
  invalidateCamera();
}

function attachWheel() {
  const onWheel = (e) => {
    e.preventDefault();
    zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0016));
  };
  G.canvas.addEventListener('wheel', onWheel, { passive: false });
  G.listeners.push(() => G.canvas.removeEventListener('wheel', onWheel));
}

// --- export ---------------------------------------------------------------

// Saves the drawn area (not the current view) so a picture made while zoomed
// in still comes out whole.
function savePng() {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const st of G.strokes) {
    let pad = st.size;
    if (st.kind === 'stamp') pad = st.size * 2.4;
    if (st.shape === 'star') {
      // A star is inscribed in the larger side of the drag, so it can reach
      // past the two points that define it.
      const [a, b] = st.points;
      pad += Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y)) / 2;
    }
    for (const p of st.points) {
      // Mirrored copies live on the far side of the board and have to be in
      // the frame too.
      for (const m of symTransforms(st.sym)) {
        const x = m ? m[0] * p.x + m[2] * p.y + m[4] : p.x;
        const y = m ? m[1] * p.x + m[3] * p.y + m[5] : p.y;
        minX = Math.min(minX, x - pad);
        minY = Math.min(minY, y - pad);
        maxX = Math.max(maxX, x + pad);
        maxY = Math.max(maxY, y + pad);
      }
    }
  }
  if (!Number.isFinite(minX)) {
    minX = G.cam.x; minY = G.cam.y; maxX = minX + viewW(); maxY = minY + viewH();
  }
  minX = clamp(minX - 40, 0, WORLD_W);
  minY = clamp(minY - 40, 0, WORLD_H);
  maxX = clamp(maxX + 40, 0, WORLD_W);
  maxY = clamp(maxY + 40, 0, WORLD_H);

  const w = Math.max(64, maxX - minX);
  const h = Math.max(64, maxY - minY);
  const s = Math.min(2, 2400 / w, 2400 / h);
  const out = document.createElement('canvas');
  out.width = Math.round(w * s);
  out.height = Math.round(h * s);
  const c = out.getContext('2d');
  c.setTransform(s, 0, 0, s, -minX * s, -minY * s);
  paintBackdrop(c, minX, minY, w, h);
  for (const st of G.strokes) renderStroke(c, st, 0, mulberry32(st.seed));

  out.toBlob((blob) => {
    if (!blob) return sfx.deny();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'ruimtetekening.png';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }, 'image/png');
  sfx.dock();
}

// --- toolbar --------------------------------------------------------------

function buildToolbar() {
  const { state } = G;
  const bar = document.createElement('div');
  bar.className = 'draw-bar';

  const rowA = row(bar);
  const rowB = row(bar);

  // Colours
  const swatches = COLORS.map((color, i) => {
    const b = document.createElement('button');
    b.className = `swatch${color === state.color ? ' is-active' : ''}`;
    b.style.background = color;
    b.style.color = color;
    b.setAttribute('aria-label', `Kleur ${i + 1}`);
    onPress(b, () => {
      state.color = color;
      swatches.forEach((s) => s.classList.toggle('is-active', s === b));
      // Picking a colour should get you painting again, whatever was selected.
      if (state.tool === 'erase' || state.tool === 'stamp' || state.tool === 'pan') {
        selectBrush('pen');
      }
      sfx.blip();
    });
    rowA.appendChild(b);
    return b;
  });

  rowA.appendChild(sep());

  const sizeBtns = SIZES.map((value, i) => {
    const b = document.createElement('button');
    b.className = `tool tool--dot${value === state.size ? ' is-active' : ''}`;
    b.innerHTML = `<span class="dot" style="width:${8 + i * 7}px;height:${8 + i * 7}px"></span>`;
    b.setAttribute('aria-label', `Dikte ${i + 1}`);
    onPress(b, () => {
      state.size = value;
      sizeBtns.forEach((s) => s.classList.toggle('is-active', s === b));
      sfx.blip();
    });
    rowA.appendChild(b);
    return b;
  });

  rowA.appendChild(sep());

  const symBtns = {};
  const setSym = (mode) => {
    state.sym = state.sym === mode ? 'none' : mode;
    Object.entries(symBtns).forEach(([k, b]) => b.classList.toggle('is-active', state.sym === k));
    sfx.select();
  };
  symBtns.mirror = mkTool(rowA, '🦋', 'Spiegelen', () => setSym('mirror'));
  symBtns.quad = mkTool(rowA, '❇️', 'Vier kanten spiegelen', () => setSym('quad'));

  rowA.appendChild(sep());

  mkTool(rowA, '🌌', 'Achtergrond wisselen', () => {
    state.backdrop = (state.backdrop + 1) % BACKDROPS.length;
    G.dirty = true;
    sfx.select();
  });
  mkTool(rowA, '💾', 'Tekening bewaren', savePng);

  // Brushes, shapes, stamps, actions
  const brushBtns = {};
  const shapeBtns = {};
  let stampBtn = null;
  let fillBtn = null;
  let panBtn = null;

  function refreshTools() {
    Object.entries(brushBtns).forEach(([id, b]) => b.classList.toggle('is-active', state.tool === id));
    Object.entries(shapeBtns).forEach(([id, b]) => {
      b.classList.toggle('is-active', state.tool === 'shape' && state.shape === id);
    });
    stampBtn.classList.toggle('is-active', state.tool === 'stamp');
    stampBtn.textContent = state.stamp;
    panBtn.classList.toggle('is-active', state.tool === 'pan');
    fillBtn.classList.toggle('is-active', state.fill);
    G.canvas.classList.toggle('is-panning', state.tool === 'pan');
  }

  function selectBrush(id) {
    state.tool = id;
    closeStamps();
    refreshTools();
  }

  for (const b of BRUSHES) {
    brushBtns[b.id] = mkTool(rowB, b.icon, b.label, () => {
      selectBrush(b.id);
      sfx.blip();
    });
  }

  rowB.appendChild(sep());

  for (const s of SHAPES) {
    shapeBtns[s.id] = mkTool(rowB, s.icon, s.label, () => {
      state.tool = 'shape';
      state.shape = s.id;
      closeStamps();
      refreshTools();
      sfx.blip();
    });
  }

  fillBtn = mkTool(rowB, '🪣', 'Vormen vullen', () => {
    state.fill = !state.fill;
    refreshTools();
    sfx.select();
  });

  rowB.appendChild(sep());

  // Stamps live behind one button: sixteen of them inline would push the row
  // off a laptop screen, and the panel is one tap away.
  const pop = document.createElement('div');
  pop.className = 'draw-pop';
  STAMPS.forEach((emoji) => {
    const b = document.createElement('button');
    b.className = 'tool';
    b.textContent = emoji;
    b.setAttribute('aria-label', `Stempel ${emoji}`);
    onPress(b, () => {
      state.stamp = emoji;
      state.tool = 'stamp';
      closeStamps();
      refreshTools();
      sfx.blip();
    });
    pop.appendChild(b);
  });

  function closeStamps() {
    pop.classList.remove('is-open');
  }

  stampBtn = mkTool(rowB, state.stamp, 'Stempels', () => {
    pop.classList.toggle('is-open');
    if (pop.classList.contains('is-open')) sfx.select();
  });

  rowB.appendChild(sep());

  mkTool(rowB, '↩️', 'Ongedaan maken', undo);
  mkTool(rowB, '↪️', 'Opnieuw doen', redo);
  mkTool(rowB, '🗑️', 'Alles wissen', () => {
    if (!G.strokes.length) return sfx.deny();
    pushHistory();
    G.strokes = [];
    G.cacheDirty = true;
    G.dirty = true;
    sfx.explode();
  });

  rowB.appendChild(sep());

  panBtn = mkTool(rowB, '✋', 'Schuiven en zoomen', () => {
    state.tool = state.tool === 'pan' ? 'pen' : 'pan';
    closeStamps();
    refreshTools();
    sfx.select();
  });
  mkTool(rowB, '➖', 'Uitzoomen', () => { zoomCenter(1 / 1.3); sfx.blip(); });
  mkTool(rowB, '➕', 'Inzoomen', () => { zoomCenter(1.3); sfx.blip(); });
  mkTool(rowB, '🎯', 'Terug naar het midden', () => {
    G.cam.zoom = 1;
    centerCamera();
    sfx.select();
  });

  G.zoomReadout = document.createElement('div');
  G.zoomReadout.className = 'draw-zoom';
  G.zoomReadout.textContent = '100%';
  rowB.appendChild(G.zoomReadout);

  // The drawer hangs off the bar, so it sits above whatever height the rows
  // wrap to.
  bar.appendChild(pop);
  G.stage.appendChild(bar);
  refreshTools();
}

function row(bar) {
  const r = document.createElement('div');
  r.className = 'draw-bar__row';
  bar.appendChild(r);
  return r;
}

function sep() {
  const d = document.createElement('div');
  d.className = 'bar-sep';
  return d;
}

// Buttons fire on pointerup like the rest of the app, but they must never let
// the gesture reach the canvas underneath.
function onPress(el, handler) {
  el.addEventListener('pointerdown', (e) => e.stopPropagation());
  el.addEventListener('pointerup', (e) => {
    e.stopPropagation();
    handler(el);
  });
}

function mkTool(parent, label, aria, handler) {
  const b = document.createElement('button');
  b.className = 'tool';
  b.textContent = label;
  b.setAttribute('aria-label', aria);
  onPress(b, handler);
  parent.appendChild(b);
  return b;
}
