import './style.css';
import { createHud } from '../../shared/ui-components.js';
import { sfx } from '../../shell/audio.js';
import { getItem, setItem } from '../../shell/storage.js';

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
  '#fff8ee', '#ffd15c', '#f79a2e', '#ff8a3d', '#ff6b6b', '#ff8fc7',
  '#b98cff', '#8fd6ff', '#3b6bff', '#5fe3c4', '#7ee787', '#3aa14a',
  '#a4744a', '#f4d9b0', '#8ea2d8', '#141433',
];

const SIZES = [8, 18, 34, 64, 108];

const BRUSHES = [
  { id: 'pen', icon: '✏️', label: 'Stift' },
  { id: 'neon', icon: '✨', label: 'Neonstift' },
  { id: 'crayon', icon: '🖍️', label: 'Krijt' },
  { id: 'rainbow', icon: '🌈', label: 'Regenboogstift' },
  { id: 'sparkle', icon: '💫', label: 'Sterrenstof' },
  { id: 'spray', icon: '🎨', label: 'Spuitbus' },
  { id: 'water', icon: '💧', label: 'Waterverf' },
  { id: 'ribbon', icon: '🎀', label: 'Lint — snel is dun, langzaam is dik' },
  { id: 'dots', icon: '⚫', label: 'Stippellijn' },
  { id: 'trail', icon: '🐾', label: 'Stempelspoor' },
  { id: 'erase', icon: '🧽', label: 'Gum' },
];

const SHAPES = [
  { id: 'line', icon: '➖', label: 'Lijn' },
  { id: 'rect', icon: '▭', label: 'Rechthoek' },
  { id: 'circle', icon: '⬭', label: 'Cirkel' },
  { id: 'triangle', icon: '🔺', label: 'Driehoek' },
  { id: 'star', icon: '⭐', label: 'Ster' },
  { id: 'heart', icon: '💜', label: 'Hart' },
];

const STAMPS = [
  '⭐', '🌟', '🪐', '🚀', '🛸', '👽', '🌙', '☄️',
  '🌈', '❤️', '😀', '🐱', '🦖', '🍕', '🌍', '👾',
  '🐶', '🦋', '🐠', '🐝', '🌸', '🌳', '🍦', '🎈',
  '🎁', '👑', '⚡', '❄️', '🔥', '🎵', '🐢', '🦄',
];

// Seventeen backdrops, each one a paint function over a world rectangle plus
// the icon and name its picker button shows. Painting the whole board rather
// than tiling a texture is what lets a backdrop have a horizon, a sun or a
// skyline: pan across it and the world stays the same world.
//
// `light` says whether a page needs dark guide lines over it.
const BACKDROPS = [
  { id: 'ruimte', icon: '🌌', name: 'Ruimte', light: false, paint: paintSpace },
  { id: 'nacht', icon: '🌙', name: 'Nachtlucht', light: false, paint: paintNight },
  { id: 'raster', icon: '▦', name: 'Raster', light: false, paint: paintGrid },
  { id: 'water', icon: '🌊', name: 'Onder water', light: false, paint: paintUnderwater },
  { id: 'zonsondergang', icon: '🌇', name: 'Zonsondergang', light: false, paint: paintSunset },
  { id: 'maan', icon: '🌕', name: 'Op de maan', light: false, paint: paintMoon },
  { id: 'mars', icon: '🔴', name: 'Mars', light: true, paint: paintMars },
  { id: 'stad', icon: '🌃', name: 'Stad bij nacht', light: false, paint: paintCity },
  { id: 'bos', icon: '🌲', name: 'Bos', light: false, paint: paintForest },
  { id: 'weiland', icon: '🌻', name: 'Weiland', light: true, paint: paintMeadow },
  { id: 'sneeuw', icon: '❄️', name: 'Sneeuw', light: true, paint: paintSnow },
  { id: 'vulkaan', icon: '🌋', name: 'Vulkaan', light: false, paint: paintLava },
  { id: 'regenboog', icon: '🌈', name: 'Regenboog', light: true, paint: paintRainbow },
  { id: 'schoolbord', icon: '🟩', name: 'Schoolbord', light: false, paint: paintChalkboard },
  { id: 'ruitjes', icon: '📐', name: 'Ruitjes', light: true, paint: paintGraphPaper },
  { id: 'papier', icon: '📄', name: 'Papier', light: true, paint: paintPaper },
  { id: 'lijntjes', icon: '📝', name: 'Schrijflijnen', light: true, paint: paintRuledPaper },
];

// Colouring pages. Each one is a Path2D built once and stroked as a locked
// guide layer under the drawing — a child colours over it and the outline never
// smudges, moves or lands in the undo stack. They are drawn around the middle
// of the board so ✋ and 🎯 always find them, and sized to fit one screen.
const TEMPLATES = [
  {
    id: 'raket',
    icon: '🚀',
    name: 'Raket',
    draw: (p) => {
      p.moveTo(-90, 120);
      p.bezierCurveTo(-145, 30, -110, -145, 0, -270);
      p.bezierCurveTo(110, -145, 145, 30, 90, 120);
      p.closePath();
      circle(p, 0, -110, 50);
      p.moveTo(-90, 20);
      p.bezierCurveTo(-175, 60, -185, 135, -172, 196);
      p.lineTo(-90, 122);
      p.moveTo(90, 20);
      p.bezierCurveTo(175, 60, 185, 135, 172, 196);
      p.lineTo(90, 122);
      p.moveTo(-90, 120);
      p.lineTo(90, 120);
      p.moveTo(-56, 122);
      p.lineTo(-72, 196);
      p.lineTo(72, 196);
      p.lineTo(56, 122);
      p.moveTo(-44, 200);
      p.bezierCurveTo(-30, 280, 30, 280, 44, 200);
    },
  },
  {
    id: 'poes',
    icon: '🐱',
    name: 'Poes',
    draw: (p) => {
      p.moveTo(-192, 0);
      p.bezierCurveTo(-192, -124, -106, -204, 0, -204);
      p.bezierCurveTo(106, -204, 192, -124, 192, 0);
      p.bezierCurveTo(192, 124, 106, 204, 0, 204);
      p.bezierCurveTo(-106, 204, -192, 124, -192, 0);
      p.closePath();
      p.moveTo(-152, -112);
      p.lineTo(-196, -252);
      p.lineTo(-62, -182);
      p.moveTo(152, -112);
      p.lineTo(196, -252);
      p.lineTo(62, -182);
      circle(p, -72, -34, 27);
      circle(p, 72, -34, 27);
      p.moveTo(-24, 44);
      p.lineTo(24, 44);
      p.lineTo(0, 74);
      p.closePath();
      p.moveTo(0, 74);
      p.bezierCurveTo(-8, 112, -52, 112, -62, 84);
      p.moveTo(0, 74);
      p.bezierCurveTo(8, 112, 52, 112, 62, 84);
      for (const s of [-1, 1]) {
        for (let k = 0; k < 3; k++) {
          p.moveTo(s * 70, 30 + k * 26);
          p.lineTo(s * 240, 4 + k * 44);
        }
      }
    },
  },
  {
    id: 'bloem',
    icon: '🌸',
    name: 'Bloem',
    draw: (p) => {
      // Petals reach outward from just outside the heart of the flower: any
      // closer and six big ellipses cross into a knot instead of a bloom.
      for (let i = 0; i < 6; i++) {
        const a = (Math.PI / 3) * i;
        oval(p, Math.cos(a) * 152, Math.sin(a) * 152 - 90, 88, 52, a);
      }
      circle(p, 0, -90, 58);
      p.moveTo(0, -26);
      p.bezierCurveTo(22, 84, -14, 166, 8, 268);
      p.moveTo(4, 70);
      p.bezierCurveTo(-70, 40, -150, 70, -164, 130);
      p.bezierCurveTo(-96, 168, -22, 140, 4, 96);
      p.moveTo(8, 160);
      p.bezierCurveTo(82, 130, 162, 160, 176, 220);
      p.bezierCurveTo(108, 258, 34, 230, 8, 186);
    },
  },
  {
    id: 'vis',
    icon: '🐠',
    name: 'Vis',
    draw: (p) => {
      oval(p, 0, 0, 210, 132);
      p.moveTo(186, -44);
      p.lineTo(336, -128);
      p.lineTo(336, 128);
      p.lineTo(186, 44);
      circle(p, -112, -42, 24);
      p.moveTo(-36, -128);
      p.bezierCurveTo(14, -212, 92, -200, 116, -112);
      p.moveTo(-36, 128);
      p.bezierCurveTo(14, 212, 92, 200, 116, 112);
      p.moveTo(-56, -112);
      p.bezierCurveTo(-104, -4, -60, 100, -52, 116);
      circle(p, -252, -128, 26);
      circle(p, -318, -206, 18);
      circle(p, -262, -266, 12);
    },
  },
  {
    id: 'vlinder',
    icon: '🦋',
    name: 'Vlinder',
    draw: (p) => {
      oval(p, 0, 10, 26, 150);
      circle(p, 0, -172, 30);
      p.moveTo(-14, -196);
      p.bezierCurveTo(-40, -250, -78, -262, -104, -252);
      p.moveTo(14, -196);
      p.bezierCurveTo(40, -250, 78, -262, 104, -252);
      for (const s of [-1, 1]) {
        oval(p, s * 172, -86, 174, 114, s * -0.42);
        oval(p, s * 136, 116, 122, 92, s * 0.4);
        circle(p, s * 190, -96, 34);
        circle(p, s * 150, 122, 22);
      }
    },
  },
  {
    id: 'huis',
    icon: '🏠',
    name: 'Huis',
    draw: (p) => {
      p.rect(-224, -40, 448, 300);
      p.moveTo(-276, -40);
      p.lineTo(0, -252);
      p.lineTo(276, -40);
      p.closePath();
      // Chimney sized to sit on the slope rather than sink through it.
      p.rect(130, -210, 58, 58);
      p.rect(-62, 108, 124, 152);
      circle(p, 34, 186, 12);
      for (const x of [-176, 58]) {
        p.rect(x, 16, 118, 104);
        p.moveTo(x + 59, 16);
        p.lineTo(x + 59, 120);
        p.moveTo(x, 68);
        p.lineTo(x + 118, 68);
      }
      p.moveTo(-330, 260);
      p.lineTo(330, 260);
    },
  },
];

// Both of these start with a moveTo, because arc() and ellipse() draw a
// connecting line from wherever the path currently is — without it the six
// petals of the flower come out strung together like a cat's cradle.
function circle(p, x, y, r) {
  p.moveTo(x + r, y);
  p.arc(x, y, r, 0, Math.PI * 2);
}

function oval(p, cx, cy, rx, ry, rot = 0) {
  p.moveTo(cx + Math.cos(rot) * rx, cy + Math.sin(rot) * rx);
  p.ellipse(cx, cy, rx, ry, rot, 0, Math.PI * 2);
}

const SAVE_KEY = 'tekenen';

// Pages are drawn a little smaller than a screen and lifted a little above the
// middle, so a whole picture is reachable above the three-row toolbar without
// anyone having to pan or zoom first.
const PAGE_SCALE = 0.8;
const PAGE_DY = -40;
const PAGE_REACH = 400;

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
    saveTimer: 0,
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
      // 0 is "no colouring page"; 1..n index into TEMPLATES.
      page: 0,
    },
  };
  G.cacheCtx = G.cache.getContext('2d');

  restore();
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
  clearTimeout(G.saveTimer);
  persist();
  cancelAnimationFrame(G.raf);
  G.listeners.forEach((off) => off());
  G.hud.destroy();
  G = null;
}

// --- keeping the drawing ---------------------------------------------------

// Vector strokes serialise to a few bytes each, so the whole board fits in
// localStorage and a child's picture is still there tomorrow — leaving for the
// portal no longer throws the work away. Points are rounded to whole world
// units: at a 4× maximum zoom that is invisible and it halves the payload.
function persist() {
  const strokes = G.strokes.map((st) => {
    const d = {
      k: st.kind, t: st.tool, c: st.color, s: st.size, y: st.sym,
      p: st.points.map((q) => [Math.round(q.x), Math.round(q.y)]),
    };
    if (st.kind === 'shape') { d.sh = st.shape; d.f = st.fill ? 1 : 0; }
    if (st.emoji) d.e = st.emoji;
    if (st.tool === 'rainbow') d.h = st.hue;
    return d;
  });
  const data = { strokes, backdrop: G.state.backdrop, page: G.state.page };
  // A very long session could outgrow the quota; the newest work is the work
  // worth keeping, so drop from the front until it fits.
  while (data.strokes.length > 40 && JSON.stringify(data).length > 900000) {
    data.strokes.splice(0, Math.ceil(data.strokes.length * 0.2));
  }
  setItem(SAVE_KEY, data);
}

function queueSave() {
  clearTimeout(G.saveTimer);
  G.saveTimer = setTimeout(persist, 900);
}

function restore() {
  const data = getItem(SAVE_KEY, null);
  if (!data || !Array.isArray(data.strokes)) return;
  if (Number.isFinite(data.backdrop) && data.backdrop < BACKDROPS.length) {
    G.state.backdrop = data.backdrop;
  }
  if (Number.isFinite(data.page) && data.page <= TEMPLATES.length) G.state.page = data.page;
  for (const d of data.strokes) {
    if (!Array.isArray(d.p) || !d.p.length) continue;
    G.strokes.push({
      kind: d.k, tool: d.t, color: d.c, size: d.s, sym: d.y,
      shape: d.sh, fill: !!d.f, emoji: d.e,
      hue: Number.isFinite(d.h) ? d.h : 0,
      seed: G.seq++,
      points: d.p.map(([x, y]) => ({ x, y })),
    });
  }
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
const RADIAL_ARMS = 6;

// Rotating a stroke `k` steps around the middle of the board turns any scribble
// into a snowflake. Built once because the matrices never change.
const RADIAL = (() => {
  const cx = WORLD_W / 2;
  const cy = WORLD_H / 2;
  const out = [null];
  for (let k = 1; k < RADIAL_ARMS; k++) {
    const a = (Math.PI * 2 * k) / RADIAL_ARMS;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    out.push([cos, sin, -sin, cos, cx - cx * cos + cy * sin, cy - cx * sin - cy * cos]);
  }
  return out;
})();

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
  if (sym === 'radial') return RADIAL;
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
    if (from === 0) paintStamp(c, st, rng);
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

// Distance along the stroke at point `i`, memoised on the stroke. Spaced
// brushes (dots, stamp trails) step along arc length rather than along the
// point list, so their rhythm comes out even whether a child drew fast or slow
// — and it stays put when the cache is rebuilt, because the spacing is a
// property of the path and not of the replay.
function arcAt(st, i) {
  const acc = st.acc || (st.acc = [0]);
  for (let k = acc.length; k <= i; k++) {
    const a = st.points[k - 1];
    const b = st.points[k];
    acc[k] = acc[k - 1] + Math.hypot(b.x - a.x, b.y - a.y);
  }
  return acc[i];
}

// Calls `fn(x, y)` at every whole multiple of `spacing` strictly inside the
// segment, so the mark at distance 0 stays the job of paintDot.
function alongSegment(st, a, b, i, spacing, fn) {
  const s0 = arcAt(st, i - 1);
  const s1 = arcAt(st, i);
  const len = s1 - s0;
  if (len <= 0) return;
  for (let m = Math.floor(s0 / spacing) * spacing + spacing; m <= s1; m += spacing) {
    const f = (m - s0) / len;
    fn(a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f);
  }
}

function paintDot(c, st, p, rng) {
  if (st.tool === 'spray' || st.tool === 'sparkle') {
    paintSegment(c, st, p, p, 0, rng);
    return;
  }
  if (st.tool === 'trail') {
    stampGlyph(c, st.emoji || '⭐', p.x, p.y, st.size * 2.4, (rng() - 0.5) * 0.7);
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
    case 'water': {
      // Wash: wide, faint, and blurred at the edge, so overlapping passes build
      // up depth the way real paint does instead of covering what is under them.
      c.globalAlpha = 0.2;
      c.shadowBlur = st.size * 0.8;
      c.shadowColor = color;
      line(c, a, b, color, st.size * 1.45);
      c.shadowBlur = 0;
      c.globalAlpha = 1;
      break;
    }
    case 'ribbon': {
      // Calligraphy: the faster the hand moved, the further apart the points
      // are, so segment length stands in for speed and thins the line.
      const speed = Math.hypot(b.x - a.x, b.y - a.y);
      line(c, a, b, color, st.size * clamp(1.5 - speed / 46, 0.2, 1.5));
      break;
    }
    case 'dots': {
      c.fillStyle = color;
      alongSegment(st, a, b, i, Math.max(7, st.size * 1.7), (x, y) => {
        c.beginPath();
        c.arc(x, y, st.size / 2, 0, Math.PI * 2);
        c.fill();
      });
      break;
    }
    case 'trail': {
      const glyph = st.emoji || '⭐';
      alongSegment(st, a, b, i, Math.max(22, st.size * 3.2), (x, y) => {
        stampGlyph(c, glyph, x, y, st.size * 2.4, (rng() - 0.5) * 0.7);
      });
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

function stampGlyph(c, glyph, x, y, size, rot = 0) {
  c.save();
  c.translate(x, y);
  if (rot) c.rotate(rot);
  c.font = `${size}px serif`;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText(glyph, 0, 0);
  c.restore();
}

function paintStamp(c, st, rng) {
  // A whisper of rotation per sticker: a wall of perfectly upright emoji looks
  // printed, a wall of slightly tilted ones looks stuck on by hand.
  stampGlyph(c, st.emoji, st.points[0].x, st.points[0].y, st.size * 4, (rng() - 0.5) * 0.34);
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
  } else if (st.shape === 'triangle') {
    c.moveTo(x + w / 2, y);
    c.lineTo(x + w, y + h);
    c.lineTo(x, y + h);
    c.closePath();
  } else if (st.shape === 'heart') {
    // Two shoulders and a point, scaled into whatever box was dragged.
    const cx = x + w / 2;
    c.moveTo(cx, y + h);
    c.bezierCurveTo(x - w * 0.16, y + h * 0.56, x + w * 0.1, y - h * 0.1, cx, y + h * 0.26);
    c.bezierCurveTo(x + w * 0.9, y - h * 0.1, x + w * 1.16, y + h * 0.56, cx, y + h);
    c.closePath();
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
  BACKDROPS[G.state.backdrop].paint(c, x, y, w, h);
}

// --- backdrop helpers -----------------------------------------------------

// Gradients are laid out over the whole world height, never over the view, so
// a sky does not slide through its own colours while you pan — and so the PNG
// export comes out matching what was on screen.
function skyGradient(c, stops) {
  const g = c.createLinearGradient(0, 0, 0, WORLD_H);
  for (const [stop, color] of stops) g.addColorStop(stop, color);
  return g;
}

// Fills only the part of the view that lies below a horizon.
function fillBelow(c, x, y, w, h, top, fill) {
  const from = Math.max(y, top);
  if (y + h <= from) return;
  c.fillStyle = fill;
  c.fillRect(x, from, w, y + h - from);
}

function disc(c, cx, cy, r, fill) {
  c.fillStyle = fill;
  c.beginPath();
  c.arc(cx, cy, r, 0, Math.PI * 2);
  c.fill();
}

function paintStars(c, x, y, w, h, { scale = 1, below = WORLD_H, color = '#ffffff' } = {}) {
  c.fillStyle = color;
  for (const s of G.stars) {
    if (s.x < x - 4 || s.x > x + w + 4 || s.y < y - 4 || s.y > y + h + 4) continue;
    if (s.y > below) continue;
    c.globalAlpha = s.a;
    c.beginPath();
    c.arc(s.x, s.y, s.r * scale, 0, Math.PI * 2);
    c.fill();
  }
  c.globalAlpha = 1;
}

// Scenery — craters, buildings, tree trunks, snowflakes — is geometry that never
// changes, so each backdrop builds its Path2Ds once in world coordinates and
// reuses them for every repaint. Panning a city then costs two path fills
// instead of a thousand rectangles. The cache is module-level because the
// geometry belongs to the world, not to one visit to the game.
const DECOR = new Map();

function decor(id, build) {
  let d = DECOR.get(id);
  if (!d) {
    d = build();
    DECOR.set(id, d);
  }
  return d;
}

// --- paper -----------------------------------------------------------------

function paintPaper(c, x, y, w, h) {
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
}

function paintRuledPaper(c, x, y, w, h) {
  c.fillStyle = '#f4eddc';
  c.fillRect(x, y, w, h);
  // Ruled lines, wide apart: the five- to seven-year-olds practise letters
  // between them and the little ones just draw over the top.
  const step = 150;
  c.strokeStyle = 'rgba(90,103,152,0.35)';
  c.lineWidth = 3;
  c.beginPath();
  for (let gy = Math.ceil(y / step) * step; gy < y + h; gy += step) {
    c.moveTo(x, gy);
    c.lineTo(x + w, gy);
  }
  c.stroke();
  c.strokeStyle = 'rgba(200,90,80,0.4)';
  c.beginPath();
  for (let gy = Math.ceil(y / step) * step; gy < y + h; gy += step) {
    c.moveTo(x, gy - step * 0.5);
    c.lineTo(x + w, gy - step * 0.5);
  }
  c.setLineDash([10, 16]);
  c.stroke();
  c.setLineDash([]);
}

// Squared paper: a fine grid with a heavier line every fifth one, so the
// six-year-olds can count squares and draw something to scale.
function paintGraphPaper(c, x, y, w, h) {
  c.fillStyle = '#f7f9f2';
  c.fillRect(x, y, w, h);

  const rule = (step, stroke, lineWidth) => {
    c.strokeStyle = stroke;
    c.lineWidth = lineWidth;
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
  };

  rule(45, 'rgba(110,150,205,0.35)', 2);
  rule(225, 'rgba(70,110,180,0.5)', 4);
}

// --- space -----------------------------------------------------------------

function paintNight(c, x, y, w, h) {
  c.fillStyle = '#080d2b';
  c.fillRect(x, y, w, h);
}

function paintGrid(c, x, y, w, h) {
  paintNight(c, x, y, w, h);
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

function paintUnderwater(c, x, y, w, h) {
  c.fillStyle = skyGradient(c, [[0, '#1a7fa8'], [0.5, '#0d4c73'], [1, '#05243f']]);
  c.fillRect(x, y, w, h);
  // Slow rolling swells, drawn as a wave per band so they tile seamlessly
  // across a board three screens wide.
  c.strokeStyle = 'rgba(190,238,255,0.16)';
  c.lineWidth = 4;
  const step = 190;
  for (let gy = Math.floor(y / step) * step; gy < y + h + step; gy += step) {
    c.beginPath();
    for (let gx = x - 60; gx < x + w + 60; gx += 60) {
      const wy = gy + Math.sin((gx + gy) * 0.004) * 26;
      gx === x - 60 ? c.moveTo(gx, wy) : c.lineTo(gx, wy);
    }
    c.stroke();
  }
  // The starfield doubles as a bubble field down here.
  c.fillStyle = 'rgba(220,246,255,0.2)';
  for (const s of G.stars) {
    if (s.x < x - 8 || s.x > x + w + 8 || s.y < y - 8 || s.y > y + h + 8) continue;
    c.beginPath();
    c.arc(s.x, s.y, s.r * 2.6, 0, Math.PI * 2);
    c.fill();
  }
}

function paintSunset(c, x, y, w, h) {
  const horizon = WORLD_H * 0.66;
  c.fillStyle = skyGradient(c, [
    [0, '#2b1b5e'], [0.42, '#8c3d78'], [0.66, '#ff8a3d'], [0.72, '#3d1f52'], [1, '#160c2c'],
  ]);
  c.fillRect(x, y, w, h);
  const sun = c.createRadialGradient(WORLD_W / 2, horizon, 20, WORLD_W / 2, horizon, 460);
  sun.addColorStop(0, 'rgba(255,226,102,0.95)');
  sun.addColorStop(0.35, 'rgba(255,178,36,0.5)');
  sun.addColorStop(1, 'rgba(255,138,61,0)');
  c.fillStyle = sun;
  c.fillRect(x, y, w, h);
  c.strokeStyle = 'rgba(255,226,102,0.28)';
  c.lineWidth = 5;
  c.beginPath();
  c.moveTo(x, horizon);
  c.lineTo(x + w, horizon);
  c.stroke();
}

function paintSpace(c, x, y, w, h) {
  const g = c.createLinearGradient(x, y, x + w * 0.4, y + h);
  g.addColorStop(0, '#12112b');
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

  paintStars(c, x, y, w, h);
}

// --- places to draw ---------------------------------------------------------

// The opening view is the middle third of the board, and its bottom fifth is
// under the toolbar. So a horizon goes at about 0.55 of the world height: any
// lower and the ground a child wants to stand things on is hidden behind the
// tools. Landmarks in the sky sit near the middle of the world for the same
// reason — nothing worth seeing should need a pan to find.

const MOON_HORIZON = WORLD_H * 0.55;

function paintMoon(c, x, y, w, h) {
  c.fillStyle = skyGradient(c, [[0, '#04061c'], [0.55, '#0a1030'], [1, '#101838']]);
  c.fillRect(x, y, w, h);
  paintStars(c, x, y, w, h, { below: MOON_HORIZON });

  const ex = WORLD_W * 0.42;
  const ey = WORLD_H * 0.42;
  const earth = c.createRadialGradient(ex - 70, ey - 80, 20, ex, ey, 220);
  earth.addColorStop(0, '#a6dcff');
  earth.addColorStop(0.45, '#3f7fd0');
  earth.addColorStop(0.82, '#1c4a8e');
  earth.addColorStop(1, '#0c2550');
  disc(c, ex, ey, 200, earth);
  c.fillStyle = 'rgba(110,232,122,0.5)';
  c.fill(decor('maan:aarde', () => {
    const p = new Path2D();
    oval(p, ex - 62, ey - 44, 84, 52, -0.4);
    oval(p, ex + 46, ey + 34, 60, 78, 0.3);
    oval(p, ex - 24, ey + 100, 54, 28, 0.1);
    return p;
  }));

  fillBelow(c, x, y, w, h, MOON_HORIZON, skyGradient(c, [
    [0.55, '#a49c8c'], [0.7, '#847c6d'], [1, '#4a463d'],
  ]));

  const craters = decor('maan:kraters', () => {
    const rnd = mulberry32(4242);
    const rim = new Path2D();
    const pit = new Path2D();
    const band = WORLD_H - MOON_HORIZON;
    for (let i = 0; i < 110; i++) {
      const cx = rnd() * WORLD_W;
      const cy = MOON_HORIZON + 24 + rnd() * (band - 24);
      const r = 20 + rnd() * 78;
      oval(rim, cx, cy, r, r * 0.4);
      oval(pit, cx, cy - r * 0.05, r * 0.76, r * 0.28);
    }
    return { rim, pit };
  });
  c.fillStyle = 'rgba(255,250,235,0.16)';
  c.fill(craters.rim);
  c.fillStyle = 'rgba(44,40,34,0.35)';
  c.fill(craters.pit);
}

const MARS_HORIZON = WORLD_H * 0.53;

function paintMars(c, x, y, w, h) {
  c.fillStyle = skyGradient(c, [[0, '#d98a5a'], [0.32, '#efb287'], [0.53, '#f8d6ac']]);
  c.fillRect(x, y, w, h);
  // Phobos and Deimos: small, pale and high in a dusty butterscotch sky.
  disc(c, WORLD_W * 0.46, WORLD_H * 0.37, 44, 'rgba(244,234,220,0.75)');
  disc(c, WORLD_W * 0.6, WORLD_H * 0.44, 22, 'rgba(244,234,220,0.6)');

  fillBelow(c, x, y, w, h, MARS_HORIZON, skyGradient(c, [
    [0.53, '#c96b3f'], [0.7, '#a94a28'], [1, '#6b2a16'],
  ]));

  const desert = decor('mars', () => {
    const rnd = mulberry32(1976);
    const dunes = new Path2D();
    const rocks = new Path2D();
    const band = WORLD_H - MARS_HORIZON;
    for (let i = 0; i < 90; i++) {
      const cx = rnd() * WORLD_W;
      const cy = MARS_HORIZON + 30 + rnd() * (band - 30);
      const rx = 180 + rnd() * 420;
      dunes.moveTo(cx - rx, cy);
      dunes.quadraticCurveTo(cx, cy - 60 - rnd() * 50, cx + rx, cy);
    }
    for (let i = 0; i < 70; i++) {
      const cx = rnd() * WORLD_W;
      const cy = MARS_HORIZON + 40 + rnd() * (band - 40);
      const r = 14 + rnd() * 40;
      rocks.moveTo(cx - r, cy + r * 0.35);
      rocks.lineTo(cx - r * 0.35, cy - r * 0.7);
      rocks.lineTo(cx + r * 0.6, cy - r * 0.4);
      rocks.lineTo(cx + r, cy + r * 0.35);
      rocks.closePath();
    }
    return { dunes, rocks };
  });
  c.strokeStyle = 'rgba(255,203,158,0.28)';
  c.lineWidth = 9;
  c.stroke(desert.dunes);
  c.fillStyle = 'rgba(84,34,18,0.75)';
  c.fill(desert.rocks);
}

const CITY_BASE = WORLD_H * 0.7;

function paintCity(c, x, y, w, h) {
  c.fillStyle = skyGradient(c, [
    [0, '#100d33'], [0.42, '#291a4f'], [0.7, '#5c3067'], [1, '#1a1130'],
  ]);
  c.fillRect(x, y, w, h);
  paintStars(c, x, y, w, h, { below: WORLD_H * 0.5 });

  const mx = WORLD_W * 0.58;
  const my = WORLD_H * 0.38;
  const halo = c.createRadialGradient(mx, my, 10, mx, my, 420);
  halo.addColorStop(0, 'rgba(255,248,214,0.32)');
  halo.addColorStop(1, 'rgba(255,248,214,0)');
  c.fillStyle = halo;
  c.fillRect(x, y, w, h);
  disc(c, mx, my, 96, '#fff6d5');

  const city = decor('stad', () => {
    const rnd = mulberry32(8110);
    const blocks = new Path2D();
    const windows = new Path2D();
    let gx = -140;
    while (gx < WORLD_W + 140) {
      const bw = 130 + rnd() * 190;
      const bh = 240 + rnd() * 780;
      const top = CITY_BASE - bh;
      blocks.rect(gx, top, bw, bh);
      // A spire on the tall ones keeps the skyline from reading as a bar chart.
      if (bh > 800) {
        blocks.moveTo(gx + bw * 0.5, top - 130);
        blocks.lineTo(gx + bw * 0.72, top);
        blocks.lineTo(gx + bw * 0.28, top);
        blocks.closePath();
      }
      for (let wy = top + 44; wy < CITY_BASE - 54; wy += 66) {
        for (let wx = gx + 22; wx < gx + bw - 30; wx += 50) {
          if (rnd() > 0.55) windows.rect(wx, wy, 24, 34);
        }
      }
      gx += bw + 14 + rnd() * 44;
    }
    return { blocks, windows };
  });
  c.fillStyle = '#0a0a20';
  c.fill(city.blocks);
  c.fillStyle = 'rgba(255,206,110,0.8)';
  c.fill(city.windows);
  fillBelow(c, x, y, w, h, CITY_BASE, '#07071a');
}

function paintForest(c, x, y, w, h) {
  c.fillStyle = skyGradient(c, [[0, '#0d3826'], [0.45, '#0a2a1d'], [1, '#04150f']]);
  c.fillRect(x, y, w, h);
  // One shaft of daylight coming in at an angle, so the wood has a direction.
  const shaft = c.createLinearGradient(WORLD_W * 0.38, 0, WORLD_W * 0.66, WORLD_H);
  shaft.addColorStop(0, 'rgba(214,255,190,0.15)');
  shaft.addColorStop(1, 'rgba(214,255,190,0)');
  c.fillStyle = shaft;
  c.fillRect(x, y, w, h);

  const wood = decor('bos', () => {
    const rnd = mulberry32(3011);
    const trunks = new Path2D();
    const canopy = new Path2D();
    const fireflies = new Path2D();
    for (let i = 0; i < 70; i++) {
      const cx = rnd() * WORLD_W;
      const bw = 34 + rnd() * 78;
      const top = WORLD_H * (0.1 + rnd() * 0.25);
      trunks.moveTo(cx - bw / 2, WORLD_H);
      trunks.lineTo(cx - bw * 0.3, top);
      trunks.lineTo(cx + bw * 0.3, top);
      trunks.lineTo(cx + bw / 2, WORLD_H);
      trunks.closePath();
      // Three stacked crowns per tree, widening downwards.
      for (let k = 0; k < 3; k++) {
        const cy = top + k * 150;
        const r = 150 + k * 90 + rnd() * 60;
        canopy.moveTo(cx, cy - r * 0.9);
        canopy.lineTo(cx + r, cy + r * 0.5);
        canopy.lineTo(cx - r, cy + r * 0.5);
        canopy.closePath();
      }
    }
    for (let i = 0; i < 170; i++) {
      circle(fireflies, rnd() * WORLD_W, WORLD_H * (0.42 + rnd() * 0.54), 5 + rnd() * 7);
    }
    return { trunks, canopy, fireflies };
  });
  c.fillStyle = '#2a1a12';
  c.fill(wood.trunks);
  c.fillStyle = 'rgba(15,74,45,0.92)';
  c.fill(wood.canopy);
  c.fillStyle = 'rgba(255,226,102,0.7)';
  c.fill(wood.fireflies);
}

const MEADOW_HORIZON = WORLD_H * 0.55;

function paintMeadow(c, x, y, w, h) {
  c.fillStyle = skyGradient(c, [[0, '#3f9ded'], [0.38, '#8fd0f7'], [0.55, '#dcf1ff']]);
  c.fillRect(x, y, w, h);

  const sx = WORLD_W * 0.62;
  const sy = WORLD_H * 0.34;
  const sun = c.createRadialGradient(sx, sy, 30, sx, sy, 400);
  sun.addColorStop(0, 'rgba(255,246,190,0.95)');
  sun.addColorStop(0.3, 'rgba(255,226,102,0.45)');
  sun.addColorStop(1, 'rgba(255,226,102,0)');
  c.fillStyle = sun;
  c.fillRect(x, y, w, h);
  disc(c, sx, sy, 130, '#fff4c2');

  c.fillStyle = 'rgba(255,255,255,0.92)';
  c.fill(decor('weiland:wolken', () => {
    const rnd = mulberry32(555);
    const p = new Path2D();
    for (let i = 0; i < 26; i++) {
      const cx = rnd() * WORLD_W;
      const cy = WORLD_H * (0.14 + rnd() * 0.34);
      const r = 60 + rnd() * 70;
      circle(p, cx, cy, r);
      circle(p, cx + r * 0.9, cy + r * 0.2, r * 0.72);
      circle(p, cx - r * 0.85, cy + r * 0.25, r * 0.6);
      circle(p, cx + r * 0.15, cy - r * 0.55, r * 0.66);
    }
    return p;
  }));

  fillBelow(c, x, y, w, h, MEADOW_HORIZON, skyGradient(c, [
    [0.55, '#7fd96b'], [0.74, '#4aa94b'], [1, '#256e36'],
  ]));

  const field = decor('weiland:gras', () => {
    const rnd = mulberry32(909);
    const blades = new Path2D();
    const daisies = new Path2D();
    const poppies = new Path2D();
    const band = WORLD_H - MEADOW_HORIZON;
    for (let i = 0; i < 700; i++) {
      const cx = rnd() * WORLD_W;
      const cy = MEADOW_HORIZON + rnd() * band;
      const len = 26 + rnd() * 46;
      blades.moveTo(cx, cy);
      blades.quadraticCurveTo(
        cx + (rnd() - 0.5) * 30, cy - len * 0.6,
        cx + (rnd() - 0.5) * 46, cy - len
      );
    }
    for (let i = 0; i < 200; i++) {
      const cx = rnd() * WORLD_W;
      const cy = MEADOW_HORIZON + 40 + rnd() * (band - 40);
      const r = 9 + rnd() * 7;
      const petals = rnd() > 0.5 ? daisies : poppies;
      for (let k = 0; k < 5; k++) {
        const a = (Math.PI * 2 * k) / 5;
        circle(petals, cx + Math.cos(a) * r * 1.4, cy + Math.sin(a) * r * 1.4, r);
      }
    }
    return { blades, daisies, poppies };
  });
  c.strokeStyle = 'rgba(24,92,44,0.4)';
  c.lineWidth = 5;
  c.stroke(field.blades);
  c.fillStyle = 'rgba(255,248,186,0.95)';
  c.fill(field.daisies);
  c.fillStyle = 'rgba(255,150,196,0.95)';
  c.fill(field.poppies);
}

function paintSnow(c, x, y, w, h) {
  c.fillStyle = skyGradient(c, [[0, '#7fa9dd'], [0.34, '#c6ddf3'], [0.6, '#f0f7ff']]);
  c.fillRect(x, y, w, h);

  const hills = decor('sneeuw:heuvels', () => {
    // Each ridge is one path across the whole world, closed off at the bottom,
    // so two fills give a near and a far layer of snow.
    const ridge = (base, amp, freq) => {
      const p = new Path2D();
      p.moveTo(0, WORLD_H);
      for (let gx = 0; gx <= WORLD_W; gx += 90) {
        p.lineTo(gx, base + Math.sin(gx * freq) * amp + Math.sin(gx * freq * 2.7) * amp * 0.4);
      }
      p.lineTo(WORLD_W, WORLD_H);
      p.closePath();
      return p;
    };
    return { far: ridge(WORLD_H * 0.54, 70, 0.0011), near: ridge(WORLD_H * 0.66, 50, 0.0018) };
  });
  // White snow against a pale sky needs an edge, or the ridges disappear.
  c.lineWidth = 6;
  c.fillStyle = '#e3eefb';
  c.strokeStyle = 'rgba(140,172,210,0.55)';
  c.fill(hills.far);
  c.stroke(hills.far);
  c.fillStyle = '#ffffff';
  c.strokeStyle = 'rgba(160,190,222,0.5)';
  c.fill(hills.near);
  c.stroke(hills.near);

  c.fillStyle = 'rgba(255,255,255,0.88)';
  c.fill(decor('sneeuw:vlokken', () => {
    const rnd = mulberry32(1212);
    const p = new Path2D();
    for (let i = 0; i < 650; i++) {
      circle(p, rnd() * WORLD_W, rnd() * WORLD_H * 0.78, 4 + rnd() * 9);
    }
    return p;
  }));
}

function paintLava(c, x, y, w, h) {
  c.fillStyle = skyGradient(c, [[0, '#3a2026'], [0.5, '#201218'], [1, '#0d0709']]);
  c.fillRect(x, y, w, h);

  const veins = decor('vulkaan', () => {
    const rnd = mulberry32(6060);
    const cracks = new Path2D();
    const plates = new Path2D();
    const embers = new Path2D();
    // A crack keeps a heading and only nudges it, so it wanders like cooling
    // rock instead of zig-zagging like a lightning bolt.
    for (let i = 0; i < 45; i++) {
      let cx = rnd() * WORLD_W;
      let cy = rnd() * WORLD_H;
      let dir = rnd() * Math.PI * 2;
      cracks.moveTo(cx, cy);
      const steps = 6 + Math.floor(rnd() * 6);
      for (let k = 0; k < steps; k++) {
        dir += (rnd() - 0.5) * 0.8;
        const len = 90 + rnd() * 130;
        const nx = cx + Math.cos(dir) * len;
        const ny = cy + Math.sin(dir) * len;
        // Curve through the midpoint: no visible corners at any zoom.
        cracks.quadraticCurveTo(cx, cy, (cx + nx) / 2, (cy + ny) / 2);
        cx = nx;
        cy = ny;
      }
    }
    // Faint plate edges give the rock between the cracks some grain.
    for (let i = 0; i < 150; i++) {
      const px = rnd() * WORLD_W;
      const py = rnd() * WORLD_H;
      const r = 90 + rnd() * 220;
      plates.moveTo(px + r, py);
      for (let k = 1; k <= 6; k++) {
        const a = (Math.PI * 2 * k) / 6;
        plates.lineTo(px + Math.cos(a) * r * (0.7 + rnd() * 0.5), py + Math.sin(a) * r * (0.7 + rnd() * 0.5));
      }
      plates.closePath();
    }
    for (let i = 0; i < 260; i++) {
      circle(embers, rnd() * WORLD_W, rnd() * WORLD_H, 3 + rnd() * 8);
    }
    return { cracks, plates, embers };
  });
  c.strokeStyle = 'rgba(120,70,60,0.35)';
  c.lineWidth = 4;
  c.stroke(veins.plates);
  // The same crack path stroked three times — wide and dim, then narrow and
  // hot — reads as glow without a single blur.
  c.lineCap = 'round';
  c.lineJoin = 'round';
  c.strokeStyle = 'rgba(255,120,40,0.16)';
  c.lineWidth = 30;
  c.stroke(veins.cracks);
  c.strokeStyle = '#ff7a2d';
  c.lineWidth = 9;
  c.stroke(veins.cracks);
  c.strokeStyle = 'rgba(255,238,160,0.9)';
  c.lineWidth = 3;
  c.stroke(veins.cracks);
  c.fillStyle = 'rgba(255,170,60,0.45)';
  c.fill(veins.embers);
}

const RAINBOW_BANDS = ['#ff6b6b', '#ff8a3d', '#ffd166', '#7ee787', '#8fd6ff', '#b98cff'];

function paintRainbow(c, x, y, w, h) {
  c.fillStyle = skyGradient(c, [[0, '#dff1ff'], [0.55, '#fdf7e8'], [1, '#ffe6f0']]);
  c.fillRect(x, y, w, h);

  // One wide arch whose centre sits well below the board: all six bands then
  // land in the opening view instead of the inner ones hiding behind the
  // toolbar, and the arc reads as huge rather than as a hoop.
  const cx = WORLD_W / 2;
  const cy = WORLD_H * 0.9;
  const outer = 1600;
  c.lineWidth = 108;
  c.globalAlpha = 0.7;
  RAINBOW_BANDS.forEach((color, i) => {
    c.strokeStyle = color;
    c.beginPath();
    c.arc(cx, cy, outer - i * 110, Math.PI, Math.PI * 2);
    c.stroke();
  });
  c.globalAlpha = 1;

  c.fillStyle = 'rgba(255,255,255,0.92)';
  c.fill(decor('regenboog:wolken', () => {
    const rnd = mulberry32(4141);
    const p = new Path2D();
    const puff = (px, py, r) => {
      circle(p, px, py, r);
      circle(p, px + r * 0.95, py + r * 0.2, r * 0.7);
      circle(p, px - r * 0.9, py + r * 0.25, r * 0.62);
      circle(p, px + r * 0.1, py - r * 0.5, r * 0.68);
    };
    // A cloud at each foot of the arch, then a few floating through the sky.
    puff(cx - outer, cy - 40, 190);
    puff(cx + outer, cy - 40, 190);
    for (let i = 0; i < 16; i++) {
      puff(rnd() * WORLD_W, WORLD_H * (0.12 + rnd() * 0.3), 60 + rnd() * 60);
    }
    return p;
  }));
}

function paintChalkboard(c, x, y, w, h) {
  c.fillStyle = '#1c4235';
  c.fillRect(x, y, w, h);

  // Wiped-off chalk — the ghost of yesterday's lesson, which is what stops a
  // flat green rectangle from looking like a bug.
  c.strokeStyle = 'rgba(233,247,240,0.05)';
  c.lineWidth = 46;
  c.stroke(decor('schoolbord', () => {
    const rnd = mulberry32(717);
    const p = new Path2D();
    for (let i = 0; i < 120; i++) {
      const px = rnd() * WORLD_W;
      const py = rnd() * WORLD_H;
      const r = 90 + rnd() * 300;
      const a0 = rnd() * Math.PI * 2;
      p.moveTo(px + Math.cos(a0) * r, py + Math.sin(a0) * r);
      p.arc(px, py, r, a0, a0 + 0.8 + rnd() * 1.6);
    }
    return p;
  }));

  const vignette = c.createRadialGradient(
    WORLD_W / 2, WORLD_H / 2, WORLD_H * 0.2,
    WORLD_W / 2, WORLD_H / 2, WORLD_H * 0.85
  );
  vignette.addColorStop(0, 'rgba(0,0,0,0)');
  vignette.addColorStop(1, 'rgba(0,0,0,0.35)');
  c.fillStyle = vignette;
  c.fillRect(x, y, w, h);
}

// The colouring page sits between the backdrop and the drawing: over the
// starfield, under every stroke, and outside the stroke cache entirely — so it
// cannot be erased, undone or dragged, and swapping pages costs nothing.
function paintTemplate(c) {
  const t = TEMPLATES[G.state.page - 1];
  if (!t) return;
  if (!t.path) {
    t.path = new Path2D();
    t.draw(t.path);
  }
  c.save();
  c.translate(WORLD_W / 2, WORLD_H / 2 + PAGE_DY);
  c.scale(PAGE_SCALE, PAGE_SCALE);
  c.lineJoin = 'round';
  c.lineCap = 'round';
  c.lineWidth = 9 / PAGE_SCALE;
  c.strokeStyle = BACKDROPS[G.state.backdrop].light
    ? 'rgba(46,54,102,0.6)'
    : 'rgba(255,255,255,0.55)';
  c.stroke(t.path);
  c.restore();
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
  paintTemplate(ctx);

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
  queueSave();
  sfx.back();
}

function redo() {
  if (!G.redoStack.length) return sfx.deny();
  G.undoStack.push(G.strokes.slice());
  G.strokes = G.redoStack.pop();
  G.cacheDirty = true;
  G.dirty = true;
  queueSave();
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
      queueSave();
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
      // Only the 🐾 brush reads this, but capturing it at stroke time means a
      // trail keeps the sticker it was drawn with when the picker moves on.
      emoji: state.stamp,
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
    queueSave();

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
  // A colouring page is part of the picture, so the whole outline stays in
  // frame even when only one corner of it has been coloured in.
  if (G.state.page > 0) {
    const reach = PAGE_REACH * PAGE_SCALE;
    minX = WORLD_W / 2 - reach; maxX = WORLD_W / 2 + reach;
    minY = WORLD_H / 2 + PAGE_DY - reach; maxY = WORLD_H / 2 + PAGE_DY + reach;
  }
  for (const st of G.strokes) {
    let pad = st.size;
    if (st.kind === 'stamp') pad = st.size * 2.4;
    else if (st.tool === 'trail') pad = st.size * 1.7;
    else if (st.tool === 'neon' || st.tool === 'water') pad = st.size * 2;
    else if (st.tool === 'erase') pad = st.size * 1.3;
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
  paintTemplate(c);
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

  // Four labelled clusters, in the order a drawing is made: pick a colour,
  // pick how fat, pick what with, then act on the whole picture.
  // The column counts are chosen so each wrapped row is one category: eleven
  // puts the brushes on row one and the shapes-plus-extras on row two, which
  // is the grouping the labels promise.
  const colourBox = cluster(bar, 'Kleur', 6);
  const sizeBox = cluster(bar, 'Dikte', 5);
  const toolBox = cluster(bar, 'Gereedschap', 11);
  const actionBox = cluster(bar, 'Acties', 5);

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
      // Picking a colour should get you painting again, whatever was selected —
      // including the tools where a colour would otherwise change nothing.
      if (['erase', 'stamp', 'trail', 'pan'].includes(state.tool)) selectBrush('pen');
      sfx.blip();
    });
    colourBox.appendChild(b);
    return b;
  });

  const sizeBtns = SIZES.map((value, i) => {
    const b = document.createElement('button');
    b.className = `tool tool--dot${value === state.size ? ' is-active' : ''}`;
    // Sized as a share of the button so the five steps stay clearly different
    // from a laptop screen up to a 75-inch board.
    const pct = 16 + i * 17;
    b.innerHTML = `<span class="dot" style="width:${pct}%;height:${pct}%"></span>`;
    b.setAttribute('aria-label', `Dikte ${i + 1}`);
    onPress(b, () => {
      state.size = value;
      sizeBtns.forEach((s) => s.classList.toggle('is-active', s === b));
      sfx.blip();
    });
    sizeBox.appendChild(b);
    return b;
  });

  // Everything that makes a mark goes in GEREEDSCHAP; everything that acts on
  // the picture as a whole goes in ACTIES.
  const brushBtns = {};
  const shapeBtns = {};
  let stampBtn = null;
  let fillBtn = null;
  let panBtn = null;
  let pageBtn = null;
  let backdropBtn = null;

  function refreshTools() {
    Object.entries(brushBtns).forEach(([id, b]) => b.classList.toggle('is-active', state.tool === id));
    Object.entries(shapeBtns).forEach(([id, b]) => {
      b.classList.toggle('is-active', state.tool === 'shape' && state.shape === id);
    });
    stampBtn.classList.toggle('is-active', state.tool === 'stamp' || state.tool === 'trail');
    stampBtn.textContent = state.stamp;
    panBtn.classList.toggle('is-active', state.tool === 'pan');
    fillBtn.classList.toggle('is-active', state.fill);
    pageBtn.classList.toggle('is-active', state.page > 0);
    pageBtn.textContent = state.page > 0 ? TEMPLATES[state.page - 1].icon : '🖼️';
    // The button wears the backdrop it will change, like the stamp button.
    if (backdropBtn) backdropBtn.textContent = BACKDROPS[state.backdrop].icon;
    G.canvas.classList.toggle('is-panning', state.tool === 'pan');
  }

  function selectBrush(id) {
    state.tool = id;
    closePops();
    refreshTools();
  }

  for (const b of BRUSHES) {
    brushBtns[b.id] = mkTool(toolBox, b.icon, b.label, () => {
      selectBrush(b.id);
      sfx.blip();
    });
  }

  for (const s of SHAPES) {
    shapeBtns[s.id] = mkTool(toolBox, s.icon, s.label, () => {
      state.tool = 'shape';
      state.shape = s.id;
      closePops();
      refreshTools();
      sfx.blip();
    });
  }

  fillBtn = mkTool(toolBox, '🪣', 'Vormen vullen', () => {
    state.fill = !state.fill;
    refreshTools();
    sfx.select();
  });

  // Stamps and colouring pages live behind one button each: thirty-two
  // stickers inline would push the row off a laptop screen, and a drawer is
  // one tap away.
  const stampPop = document.createElement('div');
  stampPop.className = 'draw-pop';
  STAMPS.forEach((emoji) => {
    const b = document.createElement('button');
    b.className = 'tool';
    b.textContent = emoji;
    b.setAttribute('aria-label', `Stempel ${emoji}`);
    onPress(b, () => {
      state.stamp = emoji;
      // Keep painting a trail if that is what was selected; the picker is
      // choosing which sticker the 🐾 brush lays down.
      if (state.tool !== 'trail') state.tool = 'stamp';
      closePops();
      refreshTools();
      sfx.blip();
    });
    stampPop.appendChild(b);
  });

  const pagePop = document.createElement('div');
  pagePop.className = 'draw-pop draw-pop--pages';
  const pageChoices = [{ icon: '✖️', name: 'Geen kleurplaat' }, ...TEMPLATES];
  pageChoices.forEach((choice, i) => {
    const b = document.createElement('button');
    b.className = 'tool';
    b.textContent = choice.icon;
    b.setAttribute('aria-label', choice.name);
    onPress(b, () => {
      state.page = i;
      closePops();
      refreshTools();
      G.dirty = true;
      queueSave();
      if (i > 0) {
        G.hud.banner(`${choice.icon} ${choice.name}`, { sub: 'Kleur de tekening in!', ms: 2000 });
        sfx.powerup();
      } else {
        sfx.select();
      }
    });
    pagePop.appendChild(b);
  });

  // Seventeen backdrops behind one button. Cycling through them with a single
  // tap worked at seven; at seventeen it means a child taps thirteen times to
  // get back to the one they liked.
  const backdropPop = document.createElement('div');
  backdropPop.className = 'draw-pop draw-pop--backdrops';
  BACKDROPS.forEach((bd, i) => {
    const b = document.createElement('button');
    b.className = 'tool';
    b.textContent = bd.icon;
    b.setAttribute('aria-label', bd.name);
    onPress(b, () => {
      state.backdrop = i;
      closePops();
      refreshTools();
      G.dirty = true;
      queueSave();
      G.hud.banner(`${bd.icon} ${bd.name}`, { ms: 1400, hint: true });
      sfx.select();
    });
    backdropPop.appendChild(b);
  });

  function closePops() {
    stampPop.classList.remove('is-open');
    pagePop.classList.remove('is-open');
    backdropPop.classList.remove('is-open');
  }

  function togglePop(pop) {
    const open = pop.classList.contains('is-open');
    closePops();
    if (!open) {
      pop.classList.add('is-open');
      sfx.select();
    }
  }

  stampBtn = mkTool(toolBox, state.stamp, 'Stempels', () => togglePop(stampPop));

  const symBtns = {};
  const setSym = (mode) => {
    state.sym = state.sym === mode ? 'none' : mode;
    Object.entries(symBtns).forEach(([k, b]) => b.classList.toggle('is-active', state.sym === k));
    sfx.select();
  };
  symBtns.mirror = mkTool(toolBox, '🦋', 'Spiegelen', () => setSym('mirror'));
  symBtns.quad = mkTool(toolBox, '❇️', 'Vier kanten spiegelen', () => setSym('quad'));
  symBtns.radial = mkTool(toolBox, '🌸', 'Caleidoscoop — zes kanten', () => setSym('radial'));

  pageBtn = mkTool(toolBox, '🖼️', 'Kleurplaat kiezen', () => togglePop(pagePop));
  backdropBtn = mkTool(toolBox, BACKDROPS[state.backdrop].icon, 'Achtergrond kiezen',
    () => togglePop(backdropPop));

  mkTool(actionBox, '↩️', 'Ongedaan maken', undo);
  mkTool(actionBox, '↪️', 'Opnieuw doen', redo);

  panBtn = mkTool(actionBox, '✋', 'Schuiven en zoomen', () => {
    state.tool = state.tool === 'pan' ? 'pen' : 'pan';
    closePops();
    refreshTools();
    sfx.select();
  });
  mkTool(actionBox, '➖', 'Uitzoomen', () => { zoomCenter(1 / 1.3); sfx.blip(); });
  mkTool(actionBox, '➕', 'Inzoomen', () => { zoomCenter(1.3); sfx.blip(); });
  mkTool(actionBox, '🎯', 'Terug naar het midden', () => {
    G.cam.zoom = 1;
    centerCamera();
    sfx.select();
  });

  G.zoomReadout = document.createElement('div');
  G.zoomReadout.className = 'draw-zoom';
  G.zoomReadout.textContent = '100%';
  actionBox.appendChild(G.zoomReadout);

  // Last, and visibly not paint tools: one wipes the drawing, one keeps it.
  mkTool(actionBox, '🗑️', 'Alles wissen', () => {
    if (!G.strokes.length) return sfx.deny();
    pushHistory();
    G.strokes = [];
    G.cacheDirty = true;
    G.dirty = true;
    queueSave();
    sfx.explode();
  }).classList.add('tool--danger');
  mkTool(actionBox, '💾', 'Tekening bewaren', savePng).classList.add('tool--keep');

  // The drawers hang off the bar, so they sit above whatever height the rows
  // wrap to.
  bar.append(stampPop, pagePop, backdropPop);
  G.stage.appendChild(bar);
  refreshTools();
}

// A labelled group of controls. `cols` fixes how wide the body is in cells, so
// the group always wraps at the same place instead of reflowing whenever a
// tool is added or the board changes size.
function cluster(bar, label, cols) {
  const wrap = document.createElement('div');
  wrap.className = 'draw-cluster';
  const cap = document.createElement('div');
  cap.className = 'draw-cluster__label';
  cap.textContent = label;
  const body = document.createElement('div');
  body.className = 'draw-cluster__body';
  body.style.setProperty('--cols', cols);
  wrap.append(cap, body);
  bar.appendChild(wrap);
  return body;
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
