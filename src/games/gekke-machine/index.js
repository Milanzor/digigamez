import './style.css';
import { createHud } from '../../shared/ui-components.js';
import {
  setupCanvas, LOGICAL_WIDTH, LOGICAL_HEIGHT, createStars, drawSpaceBackdrop,
  roundRect, createBurst, updateAndDrawParticles,
} from '../../shared/canvas-utils.js';
import { sfx } from '../../shell/audio.js';
import { getItem, setItem } from '../../shell/storage.js';

// "Gekke Machine" — a workshop instead of a puzzle: drop parts on the bench,
// draw ramps with a crayon, then hit ▶ and watch the marbles find their way
// through whatever contraption you built.
//
// There are no levels and nothing to lose. The reward loop is cause and
// effect: a child moves one plank, presses play again, and the whole machine
// behaves differently. Everything is reversible — ⏹ puts every part back
// exactly where it was built, ↩️ takes back the last build step, and the whole
// bench is saved to localStorage so a machine survives a trip to the portal.
//
// The physics is deliberately narrow: every moving thing is a circle, and
// everything it can hit is a line segment (planks, belts, spinning arms, the
// seesaw, bells, pins, crayon ink, the walls) or a force field (fan, magnet,
// black hole, honey, bomb). That covers marble runs completely while staying
// small enough to read, and it means there are only two collision routines to
// get right. A segment can carry a surface velocity, which is all a conveyor
// belt, a windmill arm and a seesaw need to fling a marble; if it also carries
// `torque`, the marble pushes back and the part swings.

// The bench floor sits above the two-row toolbar rather than behind it: a
// marble that lands out of sight, or a bowling pin hidden by the ✏️ button, is
// the one thing that breaks the "watch what happens" loop this game runs on.
const FLOOR_Y = 820;
const CEIL_Y = 128;
const WALL_L = 26;
const WALL_R = LOGICAL_WIDTH - 26;

// Earth-normal gravity for the default landscape; every other landscape is a
// multiple of this one number (see LANDSCAPES below), so nothing else in the
// simulation ever needs to know which world is currently under the bench.
const BASE_GRAVITY = 1900;
// A workbench you can genuinely fill. The old ceiling of 90 parts was set by
// the simulation being all-pairs — every marble asked every part and every
// collision segment about itself, three times a frame — so ten times the parts
// meant a hundred times the work. With the broad phase below, the cost scales
// with what is actually near a marble instead, and a bench of nine hundred
// parts costs about what ninety used to.
const MAX_BODIES = 600;
const MAX_PARTS = 900;
const SUBSTEPS = 3;

// Broad phase: one uniform grid over the bench. 80px cells are a little wider
// than the biggest marble, so a marble asks about four cells at most while a
// crowded bench still splits its thousands of collision segments finely enough
// that each query hands back a handful rather than a hundred.
const CELL = 80;
const GRID_W = Math.ceil(LOGICAL_WIDTH / CELL) + 1;
const GRID_H = Math.ceil(LOGICAL_HEIGHT / CELL) + 1;
const SLOW_SCALE = 0.3;

const BELT_SPEED = 660;
const WIP_ARM = 190;
// The seesaw is heavy compared to a marble: a plank light enough to be flipped
// by one falling ball is a plank that never sits still long enough to aim.
const WIP_INERTIA = 130000;
const SPINNER_SPEED = 2.1;
const KEGEL_KNOCK = 360;
const TRAIL_LEN = 26;

// Plank, ijsplank and kauwgomplank are the same part in three materials — one
// spec table instead of three near-identical branches in `collectSegs` and
// `drawPart`, the same trick `drops` already plays for the two taps below.
const PLANK_MATS = {
  plank: { color: '#c9a06a', e: 0.42, w: 10, grip: 1 },
  iceplank: { color: '#8fd6ff', e: 0.5, w: 10, grip: 0.08 },
  stickyplank: { color: '#ff8fc7', e: 0.22, w: 10, grip: 3.2 },
};

const PARTS = {
  marble: { icon: '🔵', name: 'Knikker', body: { r: 26, e: 0.42, drag: 0.999 } },
  bouncy: { icon: '🏀', name: 'Stuiterbal', body: { r: 30, e: 0.88, drag: 0.999 } },
  balloon: { icon: '🎈', name: 'Ballon', body: { r: 34, e: 0.6, drag: 0.986, g: -0.42, m: 0.35 } },
  rocket: { icon: '🚀', name: 'Raket', body: { r: 24, e: 0.5, drag: 0.996, thrust: 2400 } },
  ice: { icon: '🧊', name: 'IJsklontje — glijdt bijna overal doorheen', body: { r: 24, e: 0.25, drag: 0.9992, grip: 0.15, m: 0.6 } },
  kogel: { icon: '🪨', name: 'Zware kogel — duwt alles opzij', body: { r: 30, e: 0.12, drag: 0.999, m: 4 } },
  wolk: { icon: '☁️', name: 'Wolkje — heel licht en zweeft weg', body: { r: 32, e: 0.55, drag: 0.975, g: -0.2, m: 0.25 } },
  plank: { icon: '📏', name: 'Plank', seg: true },
  iceplank: { icon: '❄️', name: 'IJsplank — knikkers glijden er zo overheen', seg: true },
  stickyplank: { icon: '🍬', name: 'Kauwgomplank — knikkers plakken er bijna aan vast', seg: true },
  tramp: { icon: '🛟', name: 'Trampoline', seg: true },
  belt: { icon: '🛞', name: 'Transportband — tik erop om te draaien', seg: true },
  wip: { icon: '⚖️', name: 'Wip' },
  spinner: { icon: '🌀', name: 'Molen' },
  kegel: { icon: '🎳', name: 'Kegel' },
  bel: { icon: '🔔', name: 'Klokkenspel' },
  stoter: { icon: '🛎️', name: 'Stoter — stuitert knikkers keihard weg' },
  klep: { icon: '🚪', name: 'Klep — gaat om de beurt open en dicht', seg: true },
  fan: { icon: '💨', name: 'Ventilator — tik erop om te draaien', dir: true },
  kanon: { icon: '💥', name: 'Kanon — tik erop om te draaien', dir: true },
  magnet: { icon: '🧲', name: 'Magneet — tik erop om te wisselen tussen trekken en duwen' },
  hole: { icon: '🕳️', name: 'Zwart gat' },
  stroop: { icon: '🍯', name: 'Stroop' },
  bomb: { icon: '💣', name: 'Bom' },
  wervel: { icon: '🌪️', name: 'Wervelwind — tik erop om de draairichting te wisselen' },
  // The taps that keep a machine fed. `drops` is what makes them one thing
  // rather than separate branches: the spawn interval, the push it leaves
  // with, the colour of the housing and — for the geiser — whether it spouts
  // up instead of dropping down all come from here, so each new tap needed no
  // new branch in the simulation and no new case in the painter. The mouth is
  // drawn from the ball's own radius, which is why the marble's has always
  // been 22.
  fountain: { icon: '⛲', name: 'Knikkerkraan', drops: { body: 'marble', every: 0.85, vy: 140, tint: '#8fd6ff' } },
  hopper: { icon: '🚰', name: 'Stuiterkraan', drops: { body: 'bouncy', every: 1.05, vy: 110, tint: '#ff8a3d' } },
  geiser: { icon: '🌋', name: 'Geiser — spuit knikkers omhoog', drops: { body: 'marble', every: 1.1, vy: 950, up: true, tint: '#ff8fc7' } },
  beam: { icon: '🛸', name: 'Beamer — zet er twee neer' },
  basket: { icon: '🪣', name: 'Emmer' },
};

// Tabs instead of one long wrapping row: thirty buildable parts in one row
// would wrap four or five deep and eat the bench. Each tab holds seven or
// fewer parts, so switching a tab never costs more than the one row it shows.
const CATEGORIES = [
  { id: 'ballen', icon: '🔵', label: 'Ballen', parts: ['marble', 'bouncy', 'balloon', 'rocket', 'ice', 'kogel', 'wolk'] },
  { id: 'banen', icon: '📏', label: 'Banen', parts: ['plank', 'iceplank', 'stickyplank', 'tramp', 'belt', 'wip', 'spinner'] },
  { id: 'doelen', icon: '🎯', label: 'Doelen', parts: ['kegel', 'bel', 'stoter', 'klep', 'basket'] },
  { id: 'krachten', icon: '🧲', label: 'Krachten', parts: ['fan', 'kanon', 'magnet', 'hole', 'stroop', 'bomb', 'wervel'] },
  { id: 'toevoer', icon: '⛲', label: 'Toevoer', parts: ['fountain', 'hopper', 'geiser', 'beam'] },
];

// Five worlds, one number each: everything else in the simulation reads
// gravity through `landscapeGravity()`, so a new landscape is just a new row
// here plus a bit of paint in `landscapeTerrain()`/`drawBench()`.
const LANDSCAPES = [
  { id: 'station', name: 'Ruimtestation', icon: '🛰️', gravity: 1, sub: 'Normale zwaartekracht' },
  { id: 'moon', name: 'De Maan', icon: '🌕', gravity: 0.17, sub: 'Bijna geen zwaartekracht!' },
  { id: 'mars', name: 'Mars', icon: '🔴', gravity: 0.38, sub: 'Lichte zwaartekracht' },
  { id: 'giant', name: 'Gasreus', icon: '🟠', gravity: 2.4, sub: 'Zware zwaartekracht!' },
  { id: 'zero', name: 'Nulzwaartekracht', icon: '✨', gravity: 0.05, sub: 'Bijna zweven' },
];

const SAVE_KEY = 'gekke-machine';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

let G = null;

export function init(container, opts) {
  const hud = createHud(container, {
    title: opts.title,
    onExit: opts.onExit,
    showScore: true,
  });

  const stage = document.createElement('div');
  stage.className = 'mach-stage';
  const canvas = document.createElement('canvas');
  canvas.className = 'mach-canvas';
  stage.appendChild(canvas);
  container.appendChild(stage);

  const handle = setupCanvas(canvas);

  G = {
    hud,
    stage,
    canvas,
    handle,
    ctx: handle.ctx,
    stars: createStars(120),
    parts: [],
    ink: [],
    bodies: [],
    particles: [],
    // Collision geometry, rebuilt from the parts once per physics substep and
    // from the ink only when the ink changes.
    segs: [],
    inkSegs: [],
    // Broad-phase scratch: the two grids and the short lists of parts that act
    // at a distance. All rebuilt per substep, never allocated per frame.
    segGrid: Array.from({ length: GRID_W * GRID_H }, () => []),
    bodyGrid: Array.from({ length: GRID_W * GRID_H }, () => []),
    fields: [],
    triggerParts: [],
    stamp: 0,
    undo: [],
    running: false,
    slow: false,
    trails: false,
    tool: 'marble',
    category: 0,
    drags: new Map(),
    score: 0,
    seq: 1,
    preset: -1,
    landscape: 0,
    t: 0,
    beltPhase: 0,
    last: 0,
    raf: 0,
    saveTimer: 0,
    listeners: [],
  };

  buildToolbar();
  attachPointer();

  const saved = getItem(SAVE_KEY, null);
  if (saved && saved.parts && saved.parts.length) deserialize(saved);
  else loadPreset(0);
  rebuildInkSegs();

  G.last = performance.now();
  const loop = (now) => {
    G.raf = requestAnimationFrame(loop);
    const dt = Math.min(0.05, (now - G.last) / 1000) * (G.slow ? SLOW_SCALE : 1);
    G.last = now;
    G.t += dt;
    if (G.running) {
      G.beltPhase += dt;
      for (let i = 0; i < SUBSTEPS; i++) step(dt / SUBSTEPS);
      if (G.trails) recordTrails();
    }
    render(dt);
  };
  G.raf = requestAnimationFrame(loop);

  hud.banner('Bouw je machine! ⚙️', {
    sub: 'Kies onderdelen, zet ze neer en druk op ▶',
    ms: 2800,
    hint: true,
  });
}

export function destroy() {
  if (!G) return;
  clearTimeout(G.saveTimer);
  setItem(SAVE_KEY, serialize());
  cancelAnimationFrame(G.raf);
  G.listeners.forEach((off) => off());
  G.handle.disconnect();
  G.hud.destroy();
  G = null;
}

function addPart(type, props) {
  const part = { id: G.seq++, type, ...props };
  G.parts.push(part);
  return part;
}

// --- saving, loading, undo ------------------------------------------------

// Parts carry runtime state (swing angle, spent bombs, knocked pins) that must
// never be saved — a reloaded machine has to come back in its built state.
function serialize() {
  const parts = G.parts.map((p) => {
    const d = { t: p.type, x: Math.round(p.x), y: Math.round(p.y) };
    if (p.x2 !== undefined) { d.x2 = Math.round(p.x2); d.y2 = Math.round(p.y2); }
    if (p.a !== undefined) d.a = +p.a.toFixed(3);
    if (p.note !== undefined) d.n = p.note;
    if (p.repel) d.rp = 1;
    if (p.spin !== undefined) d.sp = p.spin;
    if (p.pair !== undefined) d.p = G.parts.findIndex((o) => o.id === p.pair);
    return d;
  });
  return {
    parts,
    ink: G.ink.map((s) => s.points.map((q) => [Math.round(q.x), Math.round(q.y)])),
    landscape: G.landscape,
  };
}

function deserialize(data) {
  G.parts = [];
  G.ink = [];
  if (!data || !Array.isArray(data.parts)) return;
  G.landscape = Number.isInteger(data.landscape) ? clamp(data.landscape, 0, LANDSCAPES.length - 1) : 0;
  const made = data.parts.map((d) => {
    if (!PARTS[d.t] || !Number.isFinite(d.x) || !Number.isFinite(d.y)) return null;
    const props = { x: d.x, y: d.y };
    if (Number.isFinite(d.x2)) { props.x2 = d.x2; props.y2 = d.y2; }
    if (Number.isFinite(d.a)) props.a = d.a;
    if (Number.isFinite(d.n)) props.note = d.n;
    if (d.rp) props.repel = true;
    if (Number.isFinite(d.sp)) props.spin = d.sp;
    return addPart(d.t, props);
  });
  data.parts.forEach((d, i) => {
    const partner = d.p >= 0 ? made[d.p] : null;
    if (made[i] && partner) made[i].pair = partner.id;
  });
  for (const pts of data.ink || []) {
    if (Array.isArray(pts) && pts.length > 1) {
      G.ink.push({ points: pts.map(([x, y]) => ({ x, y })), live: false });
    }
  }
}

// Called after every build step. The write itself is debounced because dragging
// a plank fires dozens of times a second.
function pushUndo() {
  G.undo.push(serialize());
  if (G.undo.length > 40) G.undo.shift();
  queueSave();
}

function queueSave() {
  clearTimeout(G.saveTimer);
  G.saveTimer = setTimeout(() => setItem(SAVE_KEY, serialize()), 700);
}

function undoBuild() {
  if (!G.undo.length) return sfx.deny();
  if (G.running) stopRun();
  deserialize(G.undo.pop());
  rebuildInkSegs();
  queueSave();
  sfx.back();
}

// --- preset machines ------------------------------------------------------

// Five machines that already do something, so the dice is a way in for a child
// who does not yet know what a magnet or a beamer is for. Each one is built out
// of the same parts a child places by hand, so they double as worked examples.
//
// Every ramp here is around 20°. That is not an aesthetic choice: the friction
// cap is 0.12 of the normal impulse, so a slope shallower than about atan(0.12)
// — roughly 7° — holds a marble still, and anything under 15° gives a crawl
// rather than a run.
const PRESETS = [
  {
    // A cascade: each ramp catches what the one above drops, and the last one
    // throws the marble over the rim of the bucket.
    name: 'Zigzagbaan 〰️',
    parts: [
      ['fountain', { x: 150, y: 175 }],
      ['plank', { x: 60, y: 250, x2: 500, y2: 410 }],
      ['plank', { x: 580, y: 450, x2: 1020, y2: 610 }],
      // Placed so a marble leaving the second ramp clears the near rim and
      // crosses the mouth on the way down instead of hitting the wall.
      ['basket', { x: 1160, y: FLOOR_Y - 64 }],
      ['kegel', { x: 1500, y: FLOOR_Y - 56 }],
      ['kegel', { x: 1640, y: FLOOR_Y - 56 }],
      ['kegel', { x: 1780, y: FLOOR_Y - 56 }],
      ['marble', { x: 160, y: 220 }],
      ['marble', { x: 280, y: 190 }],
    ],
  },
  {
    // A Galton board that plays notes. Bells bounce hard (0.92) so a marble
    // rattles from one to the next all the way down, and the trampoline throws
    // it back up for another run. The tap is deliberately off-centre: aimed
    // straight down the middle of the lattice, marbles either balance on the
    // top of one bell or fall clean through without touching anything.
    name: 'Klokkenspel 🔔',
    parts: [
      ['fountain', { x: 1035, y: 175 }],
      ['bel', { x: 830, y: 330, note: 0 }],
      ['bel', { x: 1090, y: 330, note: 1 }],
      ['bel', { x: 700, y: 450, note: 2 }],
      ['bel', { x: 960, y: 450, note: 3 }],
      ['bel', { x: 1220, y: 450, note: 4 }],
      ['bel', { x: 830, y: 570, note: 5 }],
      ['bel', { x: 1090, y: 570, note: 6 }],
      ['tramp', { x: 620, y: 750, x2: 1300, y2: 750 }],
      ['marble', { x: 1035, y: 240 }],
    ],
  },
  {
    // Flat trajectory on purpose: the shot lands short of the pins and rolls
    // through the whole set instead of dropping on top of one. The bouncy tap
    // sits over the high end of the ramp, so there is a second stream of balls
    // arriving at the pins from above while the cannon works on them from the
    // side — and it is where a child meets the orange tap without going looking
    // for it.
    name: 'Kegelkanon 💥',
    parts: [
      ['kanon', { x: 190, y: 700, a: -0.12 }],
      // Over the middle of the ramp, not its top end: at the top a ball lands on
      // the very tip and sits there with nowhere to roll.
      ['hopper', { x: 1150, y: 175 }],
      ['plank', { x: 900, y: 300, x2: 1500, y2: 420 }],
      ['kegel', { x: 1150, y: FLOOR_Y - 56 }],
      ['kegel', { x: 1290, y: FLOOR_Y - 56 }],
      ['kegel', { x: 1430, y: FLOOR_Y - 56 }],
      ['kegel', { x: 1570, y: FLOOR_Y - 56 }],
      ['kegel', { x: 1710, y: FLOOR_Y - 56 }],
      ['bouncy', { x: 340, y: 250 }],
    ],
  },
  {
    // A closed circuit: down the ramp, along the belt, into the beamer, back out
    // at the top. The marbles never stop, which is the whole point.
    name: 'Ruimtelift 🛸',
    parts: [
      ['beam', { x: 300, y: 220 }],
      ['plank', { x: 240, y: 280, x2: 1150, y2: 610 }],
      ['belt', { x: 500, y: 780, x2: 1550, y2: 780 }],
      ['kegel', { x: 1620, y: FLOOR_Y - 56 }],
      ['kegel', { x: 1670, y: FLOOR_Y - 56 }],
      ['beam', { x: 1790, y: FLOOR_Y - 58 }],
      ['marble', { x: 330, y: 200 }],
      ['marble', { x: 450, y: 175 }],
      ['marble', { x: 570, y: 200 }],
      ['marble', { x: 690, y: 175 }],
    ],
  },
  {
    name: 'Wipwap 🎈',
    parts: [
      ['plank', { x: 60, y: 280, x2: 560, y2: 470 }],
      ['wip', { x: 760, y: 600 }],
      ['wip', { x: 1300, y: 440 }],
      ['fan', { x: 1780, y: 750, a: -Math.PI / 2 }],
      ['stroop', { x: 1560, y: 300 }],
      ['magnet', { x: 1000, y: 180 }],
      ['bomb', { x: 420, y: 740 }],
      ['balloon', { x: 900, y: 760 }],
      ['balloon', { x: 1080, y: 770 }],
      ['kegel', { x: 1400, y: FLOOR_Y - 56 }],
      ['kegel', { x: 1470, y: FLOOR_Y - 56 }],
      ['basket', { x: 1590, y: FLOOR_Y - 64 }],
      ['marble', { x: 120, y: 250 }],
      ['marble', { x: 240, y: 220 }],
    ],
  },
];

function loadPreset(index) {
  G.parts = [];
  G.ink = [];
  G.preset = index;
  for (const [type, props] of PRESETS[index].parts) addPart(type, props);
  // Beamers in a preset are listed as a pair, so link them up as they come.
  let open = null;
  for (const p of G.parts) {
    if (p.type !== 'beam') continue;
    if (open) { open.pair = p.id; p.pair = open.id; open = null; } else open = p;
  }
  rebuildInkSegs();
}

function nextPreset() {
  if (G.running) stopRun();
  pushUndo();
  loadPreset((G.preset + 1) % PRESETS.length);
  G.hud.banner(PRESETS[G.preset].name, { sub: 'Druk op ▶ en kijk wat er gebeurt', ms: 2200 });
  sfx.powerup();
}

// A landscape change never touches the parts on the bench — only how hard
// they fall — so it does not need to stop a running machine the way loading
// a whole new preset does.
function nextLandscape() {
  pushUndo();
  G.landscape = (G.landscape + 1) % LANDSCAPES.length;
  const land = LANDSCAPES[G.landscape];
  G.hud.banner(`${land.icon} ${land.name}`, { sub: land.sub, ms: 2200 });
  sfx.powerup();
}

// --- geometry ------------------------------------------------------------

// Every static part exposes its collision as line segments, so a body only
// ever has to know about one shape. A zero-length segment is a circle of
// radius `w`, which is what the bells use.
function collectSegs(p, out) {
  switch (p.type) {
    case 'plank':
    case 'iceplank':
    case 'stickyplank': {
      const mat = PLANK_MATS[p.type];
      out.push({ x1: p.x, y1: p.y, x2: p.x2, y2: p.y2, e: mat.e, w: mat.w, grip: mat.grip });
      break;
    }
    case 'klep':
      // Only solid while closed — open, it drops out of the collision world
      // entirely rather than sitting there as a segment nobody can hit.
      if (!p.open) out.push({ x1: p.x, y1: p.y, x2: p.x2, y2: p.y2, e: 0.3, w: 12 });
      break;
    case 'stoter':
      // Same zero-length-segment trick as the bell: a circular hit-shape with
      // no new geometry code, just a very bouncy `e`.
      out.push({ x1: p.x, y1: p.y, x2: p.x, y2: p.y, e: 1.7, w: 40, bump: p });
      break;
    case 'tramp':
      out.push({ x1: p.x, y1: p.y, x2: p.x2, y2: p.y2, e: 1.35, w: 14 });
      break;
    case 'belt':
      out.push({ x1: p.x, y1: p.y, x2: p.x2, y2: p.y2, e: 0.18, w: 13 });
      break;
    case 'spinner': {
      const a = p.angle || 0;
      const cos = Math.cos(a);
      const sin = Math.sin(a);
      out.push({
        x1: p.x - cos * 170, y1: p.y - sin * 170,
        x2: p.x + cos * 170, y2: p.y + sin * 170,
        e: 0.5, w: 14, rot: p,
      });
      break;
    }
    case 'wip': {
      const a = p.angle || 0;
      const cos = Math.cos(a);
      const sin = Math.sin(a);
      out.push({
        x1: p.x - cos * WIP_ARM, y1: p.y - sin * WIP_ARM,
        x2: p.x + cos * WIP_ARM, y2: p.y + sin * WIP_ARM,
        e: 0.34, w: 13, rot: p, torque: true,
      });
      break;
    }
    case 'bel':
      out.push({ x1: p.x, y1: p.y, x2: p.x, y2: p.y, e: 0.92, w: 34, chime: p });
      break;
    case 'kegel':
      // A pin that has been knocked over is lying flat and stops colliding —
      // otherwise a strike leaves five little speed bumps behind it.
      if (!p.down) out.push({ x1: p.x, y1: p.y - 44, x2: p.x, y2: p.y + 44, e: 0.28, w: 13, pin: p });
      break;
    case 'basket': {
      const w = 108;
      const h = 96;
      out.push(
        { x1: p.x - w, y1: p.y - h, x2: p.x - w, y2: p.y + h * 0.6, e: 0.2, w: 9 },
        { x1: p.x + w, y1: p.y - h, x2: p.x + w, y2: p.y + h * 0.6, e: 0.2, w: 9 },
        { x1: p.x - w, y1: p.y + h * 0.6, x2: p.x + w, y2: p.y + h * 0.6, e: 0.15, w: 9 }
      );
      break;
    }
    default:
      break;
  }
}

// Parts that reach out and pull, push or slow a marble from a distance. They
// are the only ones the force loop has to walk, and pulling them out of the
// part list once per substep is what keeps that loop off the O(parts × bodies)
// path a bench of nine hundred parts would otherwise put it on.
const FIELD_TYPES = new Set(['fan', 'belt', 'magnet', 'hole', 'stroop', 'wervel']);
// The parts a marble can arrive *at*: swallowed, teleported, caught, blown up.
const TRIGGER_TYPES = new Set(['bomb', 'beam', 'hole', 'basket']);

function rebuildSegs() {
  G.segs.length = 0;
  G.fields.length = 0;
  G.triggerParts.length = 0;
  for (const p of G.parts) {
    collectSegs(p, G.segs);
    if (FIELD_TYPES.has(p.type)) G.fields.push(p);
    if (TRIGGER_TYPES.has(p.type)) G.triggerParts.push(p);
  }
  fillSegGrid();
}

// --- broad phase ----------------------------------------------------------
//
// Two uniform grids, both rebuilt from scratch each substep: one holding the
// collision segments, one holding the marbles. Filling them is linear, and it
// turns "every marble against every segment" into "every marble against the
// two or three cells it is actually touching".

function gridClear(grid) {
  for (let i = 0; i < grid.length; i++) grid[i].length = 0;
}

// Kept allocation-free on purpose: this runs over every segment three times a
// frame, and a returned range object per segment is thousands of throwaway
// objects a second for the garbage collector to sweep mid-animation.
function binSegment(s) {
  const w = s.w || 0;
  const cx0 = Math.max(0, Math.min(GRID_W - 1, Math.floor((Math.min(s.x1, s.x2) - w) / CELL)));
  const cy0 = Math.max(0, Math.min(GRID_H - 1, Math.floor((Math.min(s.y1, s.y2) - w) / CELL)));
  const cx1 = Math.max(0, Math.min(GRID_W - 1, Math.floor((Math.max(s.x1, s.x2) + w) / CELL)));
  const cy1 = Math.max(0, Math.min(GRID_H - 1, Math.floor((Math.max(s.y1, s.y2) + w) / CELL)));
  for (let cy = cy0; cy <= cy1; cy++) {
    for (let cx = cx0; cx <= cx1; cx++) G.segGrid[cy * GRID_W + cx].push(s);
  }
}

function fillSegGrid() {
  gridClear(G.segGrid);
  for (const s of G.segs) binSegment(s);
  for (const s of G.inkSegs) binSegment(s);
}

function fillBodyGrid() {
  gridClear(G.bodyGrid);
  for (let i = 0; i < G.bodies.length; i++) {
    const b = G.bodies[i];
    b.gi = i;
    const cx = Math.max(0, Math.min(GRID_W - 1, Math.floor(b.x / CELL)));
    const cy = Math.max(0, Math.min(GRID_H - 1, Math.floor(b.y / CELL)));
    G.bodyGrid[cy * GRID_W + cx].push(b);
  }
}

// Ink never moves once drawn, so its segments are built once per edit rather
// than three times a frame — a long scribble is hundreds of segments.
function rebuildInkSegs() {
  G.inkSegs = [];
  for (const stroke of G.ink) {
    const pts = stroke.points;
    for (let i = 1; i < pts.length; i++) {
      G.inkSegs.push({ x1: pts[i - 1].x, y1: pts[i - 1].y, x2: pts[i].x, y2: pts[i].y, e: 0.4, w: 8 });
    }
  }
}

function partHit(part, x, y) {
  if (part.x2 !== undefined) {
    return distToSegment(x, y, part.x, part.y, part.x2, part.y2) < 44;
  }
  if (part.type === 'wip') return distToSegment(x, y, part.x - WIP_ARM, part.y, part.x + WIP_ARM, part.y) < 50;
  return Math.hypot(x - part.x, y - part.y) < 78;
}

function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy || 1;
  const t = clamp(((px - x1) * dx + (py - y1) * dy) / len2, 0, 1);
  return Math.hypot(px - (x1 + dx * t), py - (y1 + dy * t));
}

// --- simulation ----------------------------------------------------------

function startRun() {
  G.bodies = [];
  G.score = 0;
  G.hud.setScore(0, 0);
  for (const p of G.parts) resetPart(p);
  for (const p of G.parts) {
    if (PARTS[p.type].body) spawnBody(p.type, p.x, p.y);
  }
  G.running = true;
  G.hasRun = true;
  G.t = 0;
  refreshRunButton();
  sfx.launch();
}

function stopRun() {
  G.running = false;
  G.bodies = [];
  G.particles = [];
  G.score = 0;
  G.hud.setScore(0, 0);
  for (const p of G.parts) resetPart(p);
  refreshRunButton();
  sfx.back();
}

function resetPart(p) {
  p.spent = false;
  p.down = false;
  p.nextDrop = 0;
  p.angle = 0;
  p.omega = 0;
  p.ring = 0;
  p.flash = 0;
  p.gateT = 0;
  p.open = false;
}

function spawnBody(type, x, y) {
  if (G.bodies.length >= MAX_BODIES) return null;
  const spec = PARTS[type].body;
  const b = {
    type, x, y, vx: 0, vy: 0,
    r: spec.r, e: spec.e, drag: spec.drag,
    g: spec.g === undefined ? 1 : spec.g,
    thrust: spec.thrust || 0,
    heading: -Math.PI / 2,
    phase: Math.random() * Math.PI * 2,
    tp: 0,
    trail: [],
  };
  G.bodies.push(b);
  return b;
}

function step(dt) {
  const parts = G.parts;

  for (const p of parts) {
    // Taps and cannons keep the machine fed. Both taps run through the same
    // branch off their `drops` spec, so the bouncy one differs from the marble
    // one only in what it drops and how often.
    const drops = PARTS[p.type].drops;
    if (drops) {
      p.nextDrop = (p.nextDrop || 0) - dt;
      if (p.nextDrop <= 0) {
        // Clear of the mouth by the ball's own radius, or a wide ball is born
        // half inside the housing and shoves itself out sideways. The geiser's
        // mouth faces up instead of down, so its clearance is measured the
        // same way but on the other side of the housing.
        const r = PARTS[drops.body].body.r;
        const side = drops.up ? -1 : 1;
        const dropY = p.y + side * (40 + r + 6);
        // And never onto a ball that has not gone yet. A tap standing just above
        // a ramp catches what it dropped, and without this the next one is born
        // inside it: the pair shove each other back up into the mouth and the tap
        // builds a tower into itself. Retried shortly rather than skipped, so the
        // tap resumes the moment the way is clear.
        const blocked = G.bodies.some((b) => Math.hypot(b.x - p.x, b.y - dropY) < b.r + r);
        if (blocked) {
          p.nextDrop = 0.12;
        } else {
          p.nextDrop = drops.every;
          const b = spawnBody(drops.body, p.x, dropY);
          if (b) b.vy = drops.vy * side;
        }
      }
    } else if (p.type === 'klep') {
      // A gate that opens and closes on its own clock: closed longer than
      // open, so a child can watch one cycle and predict the next rather than
      // needing to react to a coin-flip.
      p.gateT = (p.gateT || 0) + dt;
      const period = 3;
      if (p.gateT > period) p.gateT -= period;
      p.open = p.gateT > period * 0.6;
    } else if (p.type === 'kanon') {
      p.nextDrop = (p.nextDrop || 0) - dt;
      if (p.nextDrop <= 0) {
        p.nextDrop = 1.5;
        const b = spawnBody('marble', p.x + Math.cos(p.a) * 78, p.y + Math.sin(p.a) * 78);
        if (b) {
          b.vx = Math.cos(p.a) * 1750;
          b.vy = Math.sin(p.a) * 1750;
          p.flash = 1;
          sfx.laser();
        }
      }
    } else if (p.type === 'spinner') {
      p.omega = SPINNER_SPEED;
      p.angle = (p.angle || 0) + dt * SPINNER_SPEED;
    } else if (p.type === 'wip') {
      // A seesaw is a plank on a spring: it wants to be level, marbles tip it,
      // and it stops dead at the two rests where a real one hits the ground.
      // A soft spring on purpose: stiff enough to come back to level on its
      // own, soft enough that one marble tips it far enough to roll off.
      p.omega = (p.omega || 0) + (-(p.angle || 0) * 6 - (p.omega || 0) * 1.4) * dt;
      p.angle = (p.angle || 0) + p.omega * dt;
      if (p.angle > 0.6) { p.angle = 0.6; p.omega = Math.min(0, p.omega) * 0.3; }
      if (p.angle < -0.6) { p.angle = -0.6; p.omega = Math.max(0, p.omega) * 0.3; }
    }
  }

  rebuildSegs();

  for (const b of G.bodies) {
    if (b.tp > 0) b.tp -= dt;
    let ax = 0;
    let ay = BASE_GRAVITY * LANDSCAPES[G.landscape].gravity * b.g;

    // Only the parts that pull, blow or slow: everything else touches a marble
    // through its collision segments, not through this loop.
    for (const p of G.fields) {
      const dx = p.x - b.x;
      const dy = p.y - b.y;

      if (p.type === 'fan') {
        // Cone of wind: full strength on the axis, nothing outside ~30°.
        const fx = Math.cos(p.a);
        const fy = Math.sin(p.a);
        const along = -dx * fx - dy * fy;
        if (along > 0 && along < 640) {
          const off = Math.abs(-dx * -fy - dy * fx);
          const spread = 60 + along * 0.42;
          if (off < spread) {
            const power = 3400 * (1 - along / 640) * (1 - off / spread);
            ax += fx * power;
            ay += fy * power;
          }
        }
        continue;
      }

      if (p.type === 'belt') {
        // Traction, not friction: a bounce impulse is far too small to drag a
        // resting marble along, so anything lying on the belt is accelerated
        // towards belt speed directly.
        if (distToSegment(b.x, b.y, p.x, p.y, p.x2, p.y2) < b.r + 34) {
          const len = Math.hypot(p.x2 - p.x, p.y2 - p.y) || 1;
          const tx = (p.x2 - p.x) / len;
          const ty = (p.y2 - p.y) / len;
          const vt = b.vx * tx + b.vy * ty;
          ax += tx * (BELT_SPEED - vt) * 9;
          ay += ty * (BELT_SPEED - vt) * 9;
        }
        continue;
      }

      const d2 = dx * dx + dy * dy;
      if (p.type === 'magnet' && d2 < 420 * 420) {
        const d = Math.sqrt(d2) || 1;
        const power = 2600 * (1 - d / 420) * (p.repel ? -1 : 1);
        ax += (dx / d) * power;
        ay += (dy / d) * power;
      } else if (p.type === 'hole' && d2 < 560 * 560) {
        const d = Math.sqrt(d2) || 1;
        const power = 5200 * (1 - d / 560);
        ax += (dx / d) * power;
        ay += (dy / d) * power;
      } else if (p.type === 'stroop' && d2 < 300 * 300) {
        // Syrup: a damping force rather than a pull, so a marble crawls
        // through it and comes out the other side slowly.
        const fall = 1 - Math.sqrt(d2) / 300;
        ax -= b.vx * 7 * fall;
        ay -= b.vy * 7 * fall;
      } else if (p.type === 'wervel' && d2 < 260 * 260 && d2 > 1) {
        // A pull straight in like the black hole would just be a gentler hole;
        // pushing perpendicular to the radius instead sends a marble into a
        // spiral, with a small inward pull so it drifts to the centre rather
        // than escaping in a straight tangent line.
        const d = Math.sqrt(d2);
        const spin = p.spin || 1;
        const power = 1800 * (1 - d / 260);
        ax += (-dy / d) * power * spin + (dx / d) * power * 0.15;
        ay += (dx / d) * power * spin + (dy / d) * power * 0.15;
      }
    }

    if (b.thrust) {
      // Rockets wander: the heading drifts, which is what makes a machine
      // full of them entertaining rather than predictable.
      b.heading += Math.sin(G.t * 1.7 + b.phase) * dt * 1.5;
      ax += Math.cos(b.heading) * b.thrust;
      ay += Math.sin(b.heading) * b.thrust;
    }
    if (b.g < 0) ax += Math.sin(G.t * 2.2 + b.phase) * 220; // balloons bob

    b.vx = (b.vx + ax * dt) * b.drag;
    b.vy = (b.vy + ay * dt) * b.drag;

    const speed = Math.hypot(b.vx, b.vy);
    if (speed > 3200) {
      b.vx = (b.vx / speed) * 3200;
      b.vy = (b.vy / speed) * 3200;
    }

    b.x += b.vx * dt;
    b.y += b.vy * dt;
  }

  collide();
  triggers();
}

function collide() {
  for (const b of G.bodies) {
    // Bench walls
    if (b.x - b.r < WALL_L) { b.x = WALL_L + b.r; b.vx = Math.abs(b.vx) * b.e; }
    if (b.x + b.r > WALL_R) { b.x = WALL_R - b.r; b.vx = -Math.abs(b.vx) * b.e; }
    if (b.y - b.r < CEIL_Y) { b.y = CEIL_Y + b.r; b.vy = Math.abs(b.vy) * b.e; }
    if (b.y + b.r > FLOOR_Y) {
      b.y = FLOOR_Y - b.r;
      if (b.vy > 60) thud(b.vy);
      b.vy = -Math.abs(b.vy) * b.e;
      b.vx *= 0.99;
    }

    // Only the segments in the cells this marble overlaps. A segment sitting
    // in two cells would be tested twice, so each carries the stamp of the
    // last marble that saw it.
    G.stamp += 1;
    const cx0 = Math.max(0, Math.floor((b.x - b.r) / CELL));
    const cy0 = Math.max(0, Math.floor((b.y - b.r) / CELL));
    const cx1 = Math.min(GRID_W - 1, Math.floor((b.x + b.r) / CELL));
    const cy1 = Math.min(GRID_H - 1, Math.floor((b.y + b.r) / CELL));
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const cell = G.segGrid[cy * GRID_W + cx];
        for (let k = 0; k < cell.length; k++) {
          const s = cell[k];
          if (s.stamp === G.stamp) continue;
          s.stamp = G.stamp;
          hitSegment(b, s);
        }
      }
    }
  }

  // Ball on ball: equal mass, so the resolution is a straight swap of the
  // velocity along the contact normal. Each marble looks at its own cell and
  // the eight around it, and only at marbles later in the list, so every pair
  // is still resolved exactly once.
  fillBodyGrid();
  for (const a of G.bodies) {
    const cx0 = Math.max(0, Math.floor(a.x / CELL) - 1);
    const cy0 = Math.max(0, Math.floor(a.y / CELL) - 1);
    const cx1 = Math.min(GRID_W - 1, Math.floor(a.x / CELL) + 1);
    const cy1 = Math.min(GRID_H - 1, Math.floor(a.y / CELL) + 1);
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const cell = G.bodyGrid[cy * GRID_W + cx];
        for (let k = 0; k < cell.length; k++) {
          const b = cell[k];
          if (b.gi <= a.gi) continue;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const min = a.r + b.r;
          const d2 = dx * dx + dy * dy;
          if (d2 >= min * min || d2 === 0) continue;
          const d = Math.sqrt(d2);
          const nx = dx / d;
          const ny = dy / d;
          // Inverse-mass weighted, so a heavy kogel barely moves for a marble's
          // sake while the marble gets shoved hard — for two m=1 bodies this
          // reduces to exactly the old 50/50 split.
          const invA = 1 / (a.m || 1);
          const invB = 1 / (b.m || 1);
          const invSum = invA + invB;
          const push = min - d;
          a.x -= nx * push * (invA / invSum); a.y -= ny * push * (invA / invSum);
          b.x += nx * push * (invB / invSum); b.y += ny * push * (invB / invSum);
          const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
          if (rel > 0) continue;
          const e = Math.min(a.e, b.e);
          const j2 = -(1 + e) * rel / invSum;
          a.vx -= j2 * invA * nx; a.vy -= j2 * invA * ny;
          b.vx += j2 * invB * nx; b.vy += j2 * invB * ny;
          if (-rel > 700) thud(-rel);
        }
      }
    }
  }
}

function hitSegment(b, s) {
  const v0x = b.vx;
  const v0y = b.vy;
  const dx = s.x2 - s.x1;
  const dy = s.y2 - s.y1;
  const len2 = dx * dx + dy * dy || 1;
  const t = clamp(((b.x - s.x1) * dx + (b.y - s.y1) * dy) / len2, 0, 1);
  const px = s.x1 + dx * t;
  const py = s.y1 + dy * t;
  let nx = b.x - px;
  let ny = b.y - py;
  const reach = b.r + s.w;
  // Squared first: this is the hot line of the whole simulation and almost
  // every call leaves here, so the square root is only worth taking for the
  // handful of segments a marble is actually touching.
  const d2 = nx * nx + ny * ny;
  if (d2 >= reach * reach) return;
  let d = Math.sqrt(d2);
  if (d < 0.0001) { nx = -dy || 1; ny = dx; d = Math.hypot(nx, ny) || 1; }
  nx /= d;
  ny /= d;
  b.x = px + nx * reach;
  b.y = py + ny * reach;

  // A spinning arm (or a tipping seesaw) carries the ball with it, so the
  // collision is resolved against the surface's own velocity rather than
  // against a still wall.
  let sx = 0;
  let sy = 0;
  let rx = 0;
  let ry = 0;
  if (s.rot) {
    rx = px - s.rot.x;
    ry = py - s.rot.y;
    const w = s.rot.omega || 0;
    sx = -ry * w;
    sy = rx * w;
  }

  let rvx = b.vx - sx;
  let rvy = b.vy - sy;
  const vn = rvx * nx + rvy * ny;
  if (vn >= 0) return;

  const jn = -(1 + s.e) * vn;
  rvx += jn * nx;
  rvy += jn * ny;

  // Coulomb-style friction: capped by the normal impulse rather than taken
  // as a flat percentage. A ball resting on a slope barely presses into it,
  // so it keeps rolling — a flat percentage is re-applied every substep and
  // glues marbles to ramps instead.
  const tx = -ny;
  const ty = nx;
  const vt = rvx * tx + rvy * ty;
  // Surface and ball each carry an optional grip multiplier (both default 1):
  // an icy ball on a normal plank, a normal ball on an icy plank, and an icy
  // ball on a sticky plank all fall out of this one product.
  const gripCap = jn * 0.12 * (s.grip ?? 1) * (b.grip ?? 1);
  const grip = Math.min(Math.abs(vt), gripCap) * Math.sign(vt);
  rvx -= grip * tx;
  rvy -= grip * ty;

  b.vx = rvx + sx;
  b.vy = rvy + sy;

  // Equal and opposite: the marble's impulse spins a free-swinging part back.
  if (s.torque) {
    s.rot.omega = clamp(
      (s.rot.omega || 0) + (ry * jn * nx - rx * jn * ny) / WIP_INERTIA,
      -4.5, 4.5
    );
  }
  if (s.chime && -vn > 90) ringBell(s.chime);
  if (s.bump && -vn > 40) bumpHit(s.bump);
  if (s.pin && -vn > KEGEL_KNOCK) {
    knockPin(s.pin);
    // A pin weighs nothing next to a marble, so the bounce that was just
    // applied is undone: the marble ploughs on through the rest of the set,
    // which is the entire reason for standing pins up in a row.
    b.vx = v0x * 0.88;
    b.vy = v0y * 0.88;
  }
  if (-vn > 400) thud(-vn);
}

let lastThud = 0;
function thud(force) {
  const now = performance.now();
  if (now - lastThud < 70) return;
  lastThud = now;
  force > 1400 ? sfx.impact() : sfx.bounce();
}

function ringBell(p) {
  const now = performance.now();
  if (now - (p.chimeAt || 0) < 110) return;
  p.chimeAt = now;
  p.ring = 1;
  sfx.chime(p.note || 0);
}

function bumpHit(p) {
  // Unlike a bell, a bumper is meant to be pounded on repeatedly — the
  // cooldown just stops one long scrape along its rim from scoring twenty
  // times in a single substep.
  const now = performance.now();
  if (now - (p.bumpAt || 0) < 140) return;
  p.bumpAt = now;
  p.ring = 1;
  G.score += 1;
  G.hud.setScore(0, G.score);
  G.particles.push(...createBurst(p.x, p.y, ['#ffc24a', '#ff6b6b', '#ffe066'], { count: 16, speed: 360 }));
  sfx.impact();
  sfx.dock();
}

function knockPin(p) {
  p.down = true;
  G.score += 1;
  G.hud.setScore(0, G.score);
  G.particles.push(...createBurst(p.x, p.y - 20, ['#f3ece0', '#ff6b6b', '#ffe066'], { count: 16, speed: 340 }));
  sfx.impact();
  sfx.dock();
}

function triggers() {
  for (let i = G.bodies.length - 1; i >= 0; i--) {
    const b = G.bodies[i];

    // Same reasoning as the force loop: a plank cannot swallow a marble, so
    // only the parts that can are worth asking about.
    for (const p of G.triggerParts) {
      const d = Math.hypot(p.x - b.x, p.y - b.y);

      if (p.type === 'bomb' && !p.spent && d < b.r + 46) {
        p.spent = true;
        p.flash = 1;
        for (const other of G.bodies) {
          const dx = other.x - p.x;
          const dy = other.y - p.y;
          const dd = Math.hypot(dx, dy) || 1;
          if (dd > 480) continue;
          const power = 2300 * (1 - dd / 480);
          other.vx += (dx / dd) * power;
          other.vy += (dy / dd) * power;
        }
        G.particles.push(...createBurst(p.x, p.y, ['#ffc24a', '#ff6b6b', '#ffe066'], { count: 30, speed: 520 }));
        sfx.explode();
      }

      // Beamers come in pairs: fall into one, drop out of the other. The
      // cooldown is what keeps a marble from ping-ponging between them.
      if (p.type === 'beam' && p.pair && b.tp <= 0 && d < 54) {
        const partner = G.parts.find((o) => o.id === p.pair);
        if (partner) {
          G.particles.push(...createBurst(p.x, p.y, ['#8fd6ff', '#b98cff'], { count: 12, speed: 280 }));
          b.x = partner.x;
          b.y = partner.y;
          b.tp = 0.32;
          G.particles.push(...createBurst(partner.x, partner.y, ['#8fd6ff', '#5fe3c4'], { count: 14, speed: 300 }));
          partner.flash = 1;
          p.flash = 1;
          sfx.laser();
          break;
        }
      }

      if (p.type === 'hole' && d < 46) {
        G.bodies.splice(i, 1);
        G.particles.push(...createBurst(p.x, p.y, ['#b98cff', '#8fd6ff'], { count: 14, speed: 260 }));
        sfx.laser();
        break;
      }

      // Anything between the bucket's walls counts, at any height: a marble
      // that arcs in over the rim is in the bucket, and asking a child to also
      // land it in the bottom third only makes good machines look broken.
      if (p.type === 'basket' && Math.abs(b.x - p.x) < 96 && b.y > p.y - 96 && b.y < p.y + 70) {
        G.bodies.splice(i, 1);
        G.score += 1;
        G.hud.setScore(0, G.score);
        G.particles.push(...createBurst(p.x, p.y - 40, ['#7ee787', '#ffe066', '#5fe3c4'], { count: 22, speed: 380 }));
        sfx.dock();
        break;
      }
    }
  }
}

function recordTrails() {
  for (const b of G.bodies) {
    b.trail.push(b.x, b.y);
    if (b.trail.length > TRAIL_LEN * 2) b.trail.splice(0, 2);
  }
}

// --- rendering -----------------------------------------------------------

function render(dt) {
  const { ctx } = G;
  const land = LANDSCAPES[G.landscape];
  drawSpaceBackdrop(ctx, G.stars, G.t, { scrollSpeed: 0 });
  if (land.id !== 'station') ctx.drawImage(landscapeTerrain(land.id), 0, FLOOR_Y - 200);
  drawBench(ctx, land);

  for (const stroke of G.ink) drawInk(ctx, stroke.points, stroke.live);
  // Beamer links go under every part, so a saucer is never drawn over.
  for (const p of G.parts) {
    if (p.type === 'beam') drawBeamLink(ctx, p);
  }
  for (const p of G.parts) drawPart(ctx, p);
  if (G.trails) for (const b of G.bodies) drawTrail(ctx, b);
  for (const b of G.bodies) drawBody(ctx, b);

  updateAndDrawParticles(ctx, G.particles, dt);

  // Segment part being dragged out right now.
  for (const d of G.drags.values()) {
    if (d.preview) drawPreview(ctx, d);
  }

  // Highlights fade on the simulation clock, so in slow motion a bell's ring
  // and a cannon's muzzle flash stretch out along with everything else.
  for (const p of G.parts) {
    if (p.ring > 0) p.ring = Math.max(0, p.ring - dt * 2.4);
    if (p.flash > 0) p.flash = Math.max(0, p.flash - dt * 3.2);
  }
}

function drawBench(ctx, land) {
  const tint = LANDSCAPE_TINT[land.id];
  ctx.strokeStyle = tint.outline;
  ctx.lineWidth = 4;
  ctx.setLineDash([18, 14]);
  ctx.strokeRect(WALL_L, CEIL_Y, WALL_R - WALL_L, FLOOR_Y - CEIL_Y);
  ctx.setLineDash([]);

  const g = ctx.createLinearGradient(0, FLOOR_Y, 0, FLOOR_Y + 60);
  g.addColorStop(0, tint.floorTop);
  g.addColorStop(1, tint.floorBot);
  ctx.fillStyle = g;
  roundRect(ctx, WALL_L - 10, FLOOR_Y, WALL_R - WALL_L + 20, 42, 12);
  ctx.fill();
}

// --- landscapes -------------------------------------------------------------
//
// Same prerender-once idiom `spaceBackdrop()` in canvas-utils.js uses for the
// shared starfield: paint each landscape's terrain strip into an offscreen
// canvas the first time it's shown, then just blit it every frame after. Kept
// local to this game because the art belongs only here.
const LANDSCAPE_TINT = {
  station: { outline: 'rgba(124,196,255,0.22)', floorTop: '#3a3560', floorBot: '#12112b' },
  moon: { outline: 'rgba(190,195,215,0.3)', floorTop: '#8892a6', floorBot: '#2a2c38' },
  mars: { outline: 'rgba(255,150,100,0.3)', floorTop: '#a8522e', floorBot: '#3a1c12' },
  giant: { outline: 'rgba(255,205,110,0.32)', floorTop: '#c98a3a', floorBot: '#4a3010' },
  zero: { outline: 'rgba(185,140,255,0.32)', floorTop: '#4a3d78', floorBot: '#161227' },
};

const TERRAIN_H = 260;
const terrainSprites = new Map();

function landscapeTerrain(id) {
  let sprite = terrainSprites.get(id);
  if (sprite) return sprite;
  sprite = document.createElement('canvas');
  sprite.width = LOGICAL_WIDTH;
  sprite.height = TERRAIN_H;
  const g = sprite.getContext('2d');

  if (id === 'moon') {
    const grad = g.createLinearGradient(0, 0, 0, TERRAIN_H);
    grad.addColorStop(0, 'rgba(150,155,175,0)');
    grad.addColorStop(1, 'rgba(150,155,175,0.26)');
    g.fillStyle = grad;
    g.fillRect(0, 0, LOGICAL_WIDTH, TERRAIN_H);
    g.fillStyle = 'rgba(90,95,118,0.4)';
    for (const [cx, cy, cr] of [[220, 214, 46], [640, 240, 30], [980, 190, 58], [1360, 232, 34], [1700, 200, 50]]) {
      g.beginPath();
      g.ellipse(cx, cy, cr, cr * 0.42, 0, 0, Math.PI * 2);
      g.fill();
    }
  } else if (id === 'mars') {
    const grad = g.createLinearGradient(0, 0, 0, TERRAIN_H);
    grad.addColorStop(0, 'rgba(190,95,55,0)');
    grad.addColorStop(1, 'rgba(190,95,55,0.32)');
    g.fillStyle = grad;
    g.fillRect(0, 0, LOGICAL_WIDTH, TERRAIN_H);
    g.fillStyle = 'rgba(150,65,32,0.4)';
    for (let x = -40; x < LOGICAL_WIDTH + 200; x += 220) {
      g.beginPath();
      g.moveTo(x, TERRAIN_H);
      g.quadraticCurveTo(x + 110, TERRAIN_H - 90, x + 220, TERRAIN_H);
      g.closePath();
      g.fill();
    }
  } else if (id === 'giant') {
    const grad = g.createLinearGradient(0, 0, 0, TERRAIN_H);
    grad.addColorStop(0, 'rgba(255,195,95,0)');
    grad.addColorStop(1, 'rgba(255,195,95,0.28)');
    g.fillStyle = grad;
    g.fillRect(0, 0, LOGICAL_WIDTH, TERRAIN_H);
    g.strokeStyle = 'rgba(255,228,165,0.28)';
    g.lineWidth = 18;
    for (let i = 0; i < 5; i++) {
      g.beginPath();
      const yy = 60 + i * 44;
      g.moveTo(0, yy);
      for (let x = 0; x <= LOGICAL_WIDTH; x += 120) g.lineTo(x, yy + Math.sin(x * 0.01 + i) * 20);
      g.stroke();
    }
  } else if (id === 'zero') {
    g.strokeStyle = 'rgba(185,140,255,0.2)';
    g.lineWidth = 2;
    for (let x = 0; x <= LOGICAL_WIDTH; x += 90) {
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, TERRAIN_H);
      g.stroke();
    }
    for (let y = 0; y <= TERRAIN_H; y += 90) {
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(LOGICAL_WIDTH, y);
      g.stroke();
    }
  }
  terrainSprites.set(id, sprite);
  return sprite;
}

function drawInk(ctx, pts, live) {
  if (pts.length < 2) return;
  ctx.strokeStyle = live ? 'rgba(255,226,102,0.7)' : '#ffe066';
  ctx.lineWidth = 16;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.stroke();
}

function drawTrail(ctx, b) {
  const t = b.trail;
  if (t.length < 4) return;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.strokeStyle = b.type === 'balloon' ? 'rgba(255,122,184,0.5)' : 'rgba(124,196,255,0.5)';
  for (let i = 2; i < t.length; i += 2) {
    ctx.globalAlpha = (i / t.length) * 0.8;
    ctx.lineWidth = 3 + (i / t.length) * (b.r * 0.5);
    ctx.beginPath();
    ctx.moveTo(t[i - 2], t[i - 1]);
    ctx.lineTo(t[i], t[i + 1]);
    ctx.stroke();
  }
  ctx.restore();
}

// A radial-shaded ball is the single most common thing on a busy bench —
// every marble, every bell — and building its gradient again for every object
// on every frame is what put a crowded machine under 60fps. Each distinct ball
// is painted once into an offscreen sprite at device resolution and blitted
// from then on: one `drawImage` instead of a gradient plus two fills.
const ballSprites = new Map();

function shadedBall(ctx, key, x, y, r, paint, baseR = r) {
  const scale = ctx.getTransform().a || 1;
  // Quantised, or a bell swelling as it rings would mint a new sprite per
  // pixel of growth. Anything in between is scaled by the blit.
  const px = Math.max(8, Math.round(baseR * 2 * scale / 8) * 8);
  const id = `${key}|${px}`;
  let sprite = ballSprites.get(id);
  if (!sprite) {
    sprite = document.createElement('canvas');
    sprite.width = px;
    sprite.height = px;
    const g = sprite.getContext('2d');
    // Painters draw in bench units around (0, 0), exactly as they did when
    // they drew straight onto the canvas.
    g.scale(px / (baseR * 2), px / (baseR * 2));
    g.translate(baseR, baseR);
    paint(g, baseR);
    ballSprites.set(id, sprite);
  }
  ctx.drawImage(sprite, x - r, y - r, r * 2, r * 2);
}

// Most parts are drawn as an emoji, and `fillText` with a fresh `font` string
// is one of the more expensive calls in canvas 2D. Same trick as the balls: one
// raster per glyph and size, rendered at device resolution so it stays crisp on
// a 4K board, then blitted.
const emojiSprites = new Map();

function emoji(ctx, glyph, x, y, size, rot = 0) {
  const scale = ctx.getTransform().a || 1;
  // The box is wider than the type size because emoji overshoot their em box.
  const box = size * 1.3;
  const px = Math.max(8, Math.round(box * scale / 8) * 8);
  const id = `${glyph}|${px}`;
  let sprite = emojiSprites.get(id);
  if (!sprite) {
    sprite = document.createElement('canvas');
    sprite.width = px;
    sprite.height = px;
    const g = sprite.getContext('2d');
    g.font = `${px / 1.3}px serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(glyph, px / 2, px / 2);
    emojiSprites.set(id, sprite);
  }
  if (rot) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rot);
    ctx.drawImage(sprite, -box / 2, -box / 2, box, box);
    ctx.restore();
    return;
  }
  ctx.drawImage(sprite, x - box / 2, y - box / 2, box, box);
}

function drawBeamLink(ctx, p) {
  if (!p.pair || p.pair < p.id) return;
  const partner = G.parts.find((o) => o.id === p.pair);
  if (!partner) return;
  ctx.save();
  ctx.strokeStyle = 'rgba(124,196,255,0.32)';
  ctx.lineWidth = 5;
  ctx.setLineDash([16, 20]);
  ctx.lineDashOffset = -G.t * 60;
  ctx.beginPath();
  ctx.moveTo(p.x, p.y);
  ctx.lineTo(partner.x, partner.y);
  ctx.stroke();
  ctx.restore();
}

function drawPart(ctx, p) {
  switch (p.type) {
    case 'plank':
    case 'iceplank':
    case 'stickyplank':
    case 'tramp': {
      const teal = p.type === 'tramp';
      const mat = PLANK_MATS[p.type];
      ctx.save();
      ctx.lineCap = 'round';
      ctx.strokeStyle = teal ? '#5fe3c4' : mat.color;
      ctx.lineWidth = teal ? 26 : 20;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x2, p.y2);
      ctx.stroke();
      ctx.strokeStyle = teal ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.25)';
      ctx.lineWidth = teal ? 8 : 5;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x2, p.y2);
      ctx.stroke();
      ctx.restore();
      break;
    }
    case 'klep': {
      ctx.save();
      ctx.lineCap = 'round';
      ctx.globalAlpha = p.open ? 0.22 : 1;
      ctx.strokeStyle = '#ffc24a';
      ctx.lineWidth = 22;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x2, p.y2);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.4)';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x2, p.y2);
      ctx.stroke();
      ctx.restore();
      break;
    }
    case 'stoter': {
      const ring = p.ring || 0;
      if (ring > 0) {
        ctx.strokeStyle = `rgba(255,178,36,${ring * 0.8})`;
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 40 + (1 - ring) * 40, 0, Math.PI * 2);
        ctx.stroke();
      }
      shadedBall(ctx, 'stoter', p.x, p.y, 40 + ring * 3, (g) => {
        const grad = g.createRadialGradient(-12, -14, 4, 0, 0, 40);
        grad.addColorStop(0, '#ffb8b8');
        grad.addColorStop(0.6, '#ff6b6b');
        grad.addColorStop(1, '#8f1f1f');
        g.fillStyle = grad;
        g.beginPath();
        g.arc(0, 0, 40, 0, Math.PI * 2);
        g.fill();
        g.strokeStyle = 'rgba(255,255,255,0.5)';
        g.lineWidth = 4;
        g.beginPath();
        g.arc(0, 0, 24, 0, Math.PI * 2);
        g.stroke();
      }, 40);
      break;
    }
    case 'belt': {
      const dx = p.x2 - p.x;
      const dy = p.y2 - p.y;
      const len = Math.hypot(dx, dy) || 1;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(Math.atan2(dy, dx));
      ctx.fillStyle = '#2a3468';
      roundRect(ctx, -14, -15, len + 28, 30, 15);
      ctx.fill();
      ctx.strokeStyle = '#8ea2d8';
      ctx.lineWidth = 4;
      ctx.stroke();
      // Chevrons crawling along the band say which way it carries things.
      ctx.fillStyle = 'rgba(255,226,102,0.85)';
      const gap = 62;
      const shift = (G.beltPhase * BELT_SPEED * 0.42) % gap;
      for (let x = shift - gap; x < len; x += gap) {
        if (x < 6 || x > len - 6) continue;
        ctx.beginPath();
        ctx.moveTo(x + 12, 0);
        ctx.lineTo(x - 8, -9);
        ctx.lineTo(x - 8, 9);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
      break;
    }
    case 'wip': {
      const a = p.angle || 0;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(a);
      ctx.fillStyle = '#ffc24a';
      roundRect(ctx, -WIP_ARM - 12, -14, (WIP_ARM + 12) * 2, 28, 14);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.32)';
      roundRect(ctx, -WIP_ARM, -8, WIP_ARM * 2, 8, 4);
      ctx.fill();
      ctx.restore();
      // Pivot wedge under the plank.
      ctx.fillStyle = '#8ea2d8';
      ctx.beginPath();
      ctx.moveTo(p.x, p.y - 6);
      ctx.lineTo(p.x + 40, p.y + 62);
      ctx.lineTo(p.x - 40, p.y + 62);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case 'fan': {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.fillStyle = '#2c2a52';
      ctx.beginPath();
      ctx.arc(0, 0, 52, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#8fd6ff';
      ctx.lineWidth = 6;
      ctx.stroke();
      ctx.rotate(G.running ? G.t * 12 : 0);
      ctx.fillStyle = '#8fd6ff';
      for (let i = 0; i < 4; i++) {
        ctx.rotate(Math.PI / 2);
        ctx.beginPath();
        ctx.ellipse(0, -26, 11, 24, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
      drawAimArrow(ctx, p, 78, 'rgba(124,196,255,0.85)');
      break;
    }
    case 'kanon': {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.a);
      const recoil = p.flash > 0 ? -p.flash * 16 : 0;
      ctx.fillStyle = '#4a5aa8';
      roundRect(ctx, -18 + recoil, -26, 96, 52, 14);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.22)';
      roundRect(ctx, -10 + recoil, -18, 80, 12, 6);
      ctx.fill();
      ctx.fillStyle = '#0d0c22';
      ctx.beginPath();
      ctx.arc(78 + recoil, 0, 20, 0, Math.PI * 2);
      ctx.fill();
      if (p.flash > 0) {
        ctx.globalAlpha = p.flash;
        emoji(ctx, '💥', 104, 0, 88);
        ctx.globalAlpha = 1;
      }
      ctx.restore();
      ctx.fillStyle = '#ff8fc7';
      ctx.beginPath();
      ctx.arc(p.x, p.y, 30, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(6,10,36,0.5)';
      ctx.beginPath();
      ctx.arc(p.x, p.y, 12, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'spinner': {
      const a = p.angle || 0;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(a);
      ctx.fillStyle = '#ff8fc7';
      roundRect(ctx, -178, -15, 356, 30, 15);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      roundRect(ctx, -170, -9, 340, 8, 4);
      ctx.fill();
      ctx.restore();
      ctx.fillStyle = '#f3ece0';
      ctx.beginPath();
      ctx.arc(p.x, p.y, 20, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'bel': {
      const ring = p.ring || 0;
      if (ring > 0) {
        ctx.strokeStyle = `rgba(255,226,102,${ring * 0.8})`;
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 40 + (1 - ring) * 46, 0, Math.PI * 2);
        ctx.stroke();
      }
      // The pips are part of the sprite: a row of bells all ringing at once is
      // otherwise eight little arcs each, every frame.
      const pips = ((p.note || 0) % 8) + 1;
      shadedBall(ctx, `bel${pips}`, p.x, p.y, 34 + ring * 3, (g) => {
        const grad = g.createRadialGradient(-10, -12, 4, 0, 0, 36);
        grad.addColorStop(0, '#fff3c4');
        grad.addColorStop(0.6, '#ffc24a');
        grad.addColorStop(1, '#a35f10');
        g.fillStyle = grad;
        g.beginPath();
        g.arc(0, 0, 34, 0, Math.PI * 2);
        g.fill();
        // Little note pips so children can tell the bells apart by eye as well.
        g.fillStyle = 'rgba(20,26,60,0.65)';
        for (let i = 0; i < pips; i++) {
          const ang = -Math.PI / 2 + (i - (pips - 1) / 2) * 0.34;
          g.beginPath();
          g.arc(Math.cos(ang) * 20, Math.sin(ang) * 20, 3.4, 0, Math.PI * 2);
          g.fill();
        }
      }, 34);
      break;
    }
    case 'kegel': {
      ctx.save();
      ctx.translate(p.x, p.y);
      if (p.down) ctx.rotate(1.5);
      ctx.fillStyle = '#f3ece0';
      ctx.beginPath();
      ctx.moveTo(0, -46);
      ctx.bezierCurveTo(16, -34, 12, -14, 16, 6);
      ctx.bezierCurveTo(20, 26, 20, 40, 0, 44);
      ctx.bezierCurveTo(-20, 40, -20, 26, -16, 6);
      ctx.bezierCurveTo(-12, -14, -16, -34, 0, -46);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#ff6b6b';
      roundRect(ctx, -14, -22, 28, 12, 6);
      ctx.fill();
      ctx.restore();
      break;
    }
    case 'stroop': {
      const wob = Math.sin(G.t * 1.4) * 8;
      const g = ctx.createRadialGradient(p.x, p.y, 10, p.x, p.y, 300);
      g.addColorStop(0, 'rgba(255,178,36,0.5)');
      g.addColorStop(0.55, 'rgba(200,120,20,0.22)');
      g.addColorStop(1, 'rgba(200,120,20,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 300, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,207,102,0.5)';
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, 120 + wob, 104 - wob, 0, 0, Math.PI * 2);
      ctx.fill();
      emoji(ctx, '🍯', p.x, p.y, 84);
      break;
    }
    case 'hole': {
      const g = ctx.createRadialGradient(p.x, p.y, 6, p.x, p.y, 92);
      g.addColorStop(0, '#000006');
      g.addColorStop(0.55, '#2a1250');
      g.addColorStop(1, 'rgba(42,18,80,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 92, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(176,107,255,0.8)';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, 60, 22, G.t * 1.4, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
    case 'wervel': {
      const spin = p.spin || 1;
      const g = ctx.createRadialGradient(p.x, p.y, 4, p.x, p.y, 80);
      g.addColorStop(0, 'rgba(20,10,40,0.85)');
      g.addColorStop(0.6, 'rgba(90,60,160,0.4)');
      g.addColorStop(1, 'rgba(90,60,160,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 80, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(185,140,255,0.75)';
      ctx.lineWidth = 5;
      for (let i = 0; i < 2; i++) {
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, 36 + i * 20, 14 + i * 8, G.t * 2.2 * spin + i, 0, Math.PI * 2);
        ctx.stroke();
      }
      emoji(ctx, '🌪️', p.x, p.y, 62);
      break;
    }
    case 'beam': {
      const flash = p.flash || 0;
      ctx.save();
      ctx.strokeStyle = p.pair ? `rgba(124,196,255,${0.5 + flash * 0.5})` : 'rgba(255,178,36,0.7)';
      ctx.lineWidth = 5 + flash * 5;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, 62, 24, 0, 0, Math.PI * 2);
      ctx.stroke();
      if (flash > 0) {
        ctx.globalAlpha = flash * 0.6;
        ctx.fillStyle = '#8fd6ff';
        ctx.beginPath();
        ctx.ellipse(p.x, p.y, 62, 24, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      ctx.restore();
      emoji(ctx, '🛸', p.x, p.y - 6, 78);
      // An unpaired beamer is a dead end, so it says so.
      if (!p.pair) emoji(ctx, '❓', p.x + 46, p.y + 34, 44);
      break;
    }
    case 'basket': {
      ctx.save();
      ctx.fillStyle = '#7ee787';
      ctx.beginPath();
      ctx.moveTo(p.x - 108, p.y - 96);
      ctx.lineTo(p.x + 108, p.y - 96);
      ctx.lineTo(p.x + 86, p.y + 64);
      ctx.lineTo(p.x - 86, p.y + 64);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(6,10,36,0.55)';
      ctx.beginPath();
      ctx.ellipse(p.x, p.y - 96, 108, 22, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      break;
    }
    case 'fountain':
    case 'hopper':
    case 'geiser': {
      const spec = PARTS[p.type];
      const side = spec.drops.up ? -1 : 1;
      ctx.fillStyle = spec.drops.tint;
      roundRect(ctx, p.x - 54, p.y - 40, 108, 74, 16);
      ctx.fill();
      // The mouth is as wide as what comes out of it, so a child can see which
      // tap gives the big orange ball before they press ▶. The geiser's mouth
      // sits on top of the housing instead of underneath, matching where its
      // balls actually come out.
      ctx.fillStyle = '#0d0c22';
      ctx.beginPath();
      ctx.arc(p.x, p.y + side * 40, PARTS[spec.drops.body].body.r - 4, 0, Math.PI * 2);
      ctx.fill();
      emoji(ctx, spec.icon, p.x, p.y - side * 6, 54);
      break;
    }
    case 'bomb': {
      if (p.spent) {
        ctx.fillStyle = 'rgba(255,95,77,0.25)';
        ctx.beginPath();
        ctx.arc(p.x, p.y, 60, 0, Math.PI * 2);
        ctx.fill();
        emoji(ctx, '💨', p.x, p.y, 58);
      } else {
        emoji(ctx, '💣', p.x, p.y, 84);
      }
      break;
    }
    case 'magnet':
      // The ring says which way it pulls before a child presses ▶: blue draws
      // in, red pushes away — the same colour language the whole app already
      // uses for "safe/attract" versus "danger/repel".
      ctx.strokeStyle = p.repel ? 'rgba(255,107,107,0.8)' : 'rgba(124,196,255,0.8)';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 50, 0, Math.PI * 2);
      ctx.stroke();
      emoji(ctx, '🧲', p.x, p.y, 84);
      break;
    default: {
      // A dynamic part in build mode: show the ball where it will start.
      if (!G.running) drawBody(ctx, { ...p, r: PARTS[p.type].body.r, heading: -Math.PI / 2 });
      else {
        ctx.strokeStyle = 'rgba(124,196,255,0.35)';
        ctx.lineWidth = 3;
        ctx.setLineDash([8, 8]);
        ctx.beginPath();
        ctx.arc(p.x, p.y, PARTS[p.type].body.r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  }
}

function drawAimArrow(ctx, p, dist, color) {
  ctx.save();
  ctx.translate(p.x + Math.cos(p.a) * dist, p.y + Math.sin(p.a) * dist);
  ctx.rotate(p.a);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(22, 0);
  ctx.lineTo(-14, -16);
  ctx.lineTo(-14, 16);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawBody(ctx, b) {
  switch (b.type) {
    case 'balloon':
      emoji(ctx, '🎈', b.x, b.y + 6, b.r * 2.6);
      break;
    case 'rocket': {
      emoji(ctx, '🚀', b.x, b.y, b.r * 2.6, b.heading + Math.PI / 4);
      if (G.running && Math.random() < 0.6) {
        G.particles.push(...createBurst(
          b.x - Math.cos(b.heading) * b.r, b.y - Math.sin(b.heading) * b.r,
          ['#ffc24a', '#ff6b6b'], { count: 2, speed: 120 }
        ));
      }
      break;
    }
    case 'bouncy': {
      ctx.fillStyle = '#ff8a3d';
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#7a2f0c';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r * 0.62, 0, Math.PI * 2);
      ctx.moveTo(b.x - b.r, b.y);
      ctx.lineTo(b.x + b.r, b.y);
      ctx.stroke();
      break;
    }
    case 'ice':
      shadedBall(ctx, 'ice', b.x, b.y, b.r, (g, r) => {
        const grad = g.createRadialGradient(-r * 0.3, -r * 0.35, r * 0.1, 0, 0, r);
        grad.addColorStop(0, '#ffffff');
        grad.addColorStop(0.55, '#cdf0ff');
        grad.addColorStop(1, '#7fc4e8');
        g.fillStyle = grad;
        g.beginPath();
        g.arc(0, 0, r, 0, Math.PI * 2);
        g.fill();
        g.strokeStyle = 'rgba(255,255,255,0.8)';
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(-r * 0.4, -r * 0.5);
        g.lineTo(r * 0.1, r * 0.1);
        g.stroke();
      });
      break;
    case 'kogel':
      shadedBall(ctx, 'kogel', b.x, b.y, b.r, (g, r) => {
        const grad = g.createRadialGradient(-r * 0.3, -r * 0.35, r * 0.1, 0, 0, r);
        grad.addColorStop(0, '#8f8f92');
        grad.addColorStop(0.6, '#55555c');
        grad.addColorStop(1, '#201f24');
        g.fillStyle = grad;
        g.beginPath();
        g.arc(0, 0, r, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = 'rgba(0,0,0,0.35)';
        for (const [dx, dy, rr] of [[r * 0.3, r * 0.2, r * 0.14], [-r * 0.2, r * 0.4, r * 0.1]]) {
          g.beginPath();
          g.arc(dx, dy, rr, 0, Math.PI * 2);
          g.fill();
        }
      });
      break;
    case 'wolk':
      shadedBall(ctx, 'wolk', b.x, b.y, b.r, (g, r) => {
        g.fillStyle = '#ffffff';
        for (const [dx, dy, rr] of [[0, 0, r * 0.72], [-r * 0.5, r * 0.12, r * 0.5], [r * 0.5, r * 0.1, r * 0.52], [0, -r * 0.32, r * 0.5]]) {
          g.beginPath();
          g.arc(dx, dy, rr, 0, Math.PI * 2);
          g.fill();
        }
        g.fillStyle = 'rgba(150,170,210,0.35)';
        g.beginPath();
        g.arc(-r * 0.15, r * 0.28, r * 0.5, 0, Math.PI * 2);
        g.fill();
      });
      break;
    default:
      // Hundreds of these can be in flight at once, so the marble is a sprite.
      shadedBall(ctx, 'marble', b.x, b.y, b.r, (g, r) => {
        const grad = g.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.1, 0, 0, r);
        grad.addColorStop(0, '#bfe3ff');
        grad.addColorStop(0.5, '#3b6bff');
        grad.addColorStop(1, '#16277a');
        g.fillStyle = grad;
        g.beginPath();
        g.arc(0, 0, r, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = 'rgba(255,255,255,0.75)';
        g.beginPath();
        g.arc(-r * 0.32, -r * 0.36, r * 0.22, 0, Math.PI * 2);
        g.fill();
      });
  }
}

function drawPreview(ctx, d) {
  ctx.save();
  ctx.globalAlpha = 0.6;
  if (PARTS[d.tool].dir) {
    const a = Math.atan2(d.cy - d.y, d.cx - d.x);
    drawPart(ctx, { type: d.tool, x: d.x, y: d.y, a });
  } else {
    drawPart(ctx, { type: d.tool, x: d.x, y: d.y, x2: d.cx, y2: d.cy });
  }
  ctx.restore();
}

// --- input ---------------------------------------------------------------

function attachPointer() {
  const { canvas, handle } = G;

  const onDown = (e) => {
    canvas.setPointerCapture(e.pointerId);
    const { x, y } = handle.toLogical(e.clientX, e.clientY);
    const tool = G.tool;

    if (tool === 'hand' || tool === 'wreck') {
      const part = [...G.parts].reverse().find((p) => partHit(p, x, y));
      if (tool === 'wreck') {
        if (part) {
          pushUndo();
          unpair(part);
          G.parts.splice(G.parts.indexOf(part), 1);
          G.particles.push(...createBurst(part.x, part.y, ['#ff6b6b', '#ffc24a'], { count: 12, speed: 260 }));
          sfx.explode();
          return;
        }
        const stroke = G.ink.find((s) => s.points.some((p) => Math.hypot(p.x - x, p.y - y) < 46));
        if (stroke) {
          pushUndo();
          G.ink.splice(G.ink.indexOf(stroke), 1);
          rebuildInkSegs();
          sfx.deny();
        }
        return;
      }
      if (part) {
        pushUndo();
        G.drags.set(e.pointerId, { move: part, dx: x - part.x, dy: y - part.y, sx: x, sy: y });
        sfx.blip();
      }
      return;
    }

    if (tool === 'ink') {
      pushUndo();
      const stroke = { points: [{ x, y }], live: true };
      G.ink.push(stroke);
      G.drags.set(e.pointerId, { ink: stroke });
      return;
    }

    const spec = PARTS[tool];
    if (spec.seg || spec.dir) {
      G.drags.set(e.pointerId, { preview: true, tool, x, y, cx: x, cy: y });
      return;
    }

    place(tool, x, y);
  };

  const onMove = (e) => {
    const d = G.drags.get(e.pointerId);
    if (!d) return;
    const { x, y } = handle.toLogical(e.clientX, e.clientY);

    if (d.ink) {
      const last = d.ink.points[d.ink.points.length - 1];
      if (Math.hypot(x - last.x, y - last.y) > 14) d.ink.points.push({ x, y });
      return;
    }
    if (d.move) {
      const nx = clamp(x - d.dx, WALL_L, WALL_R);
      const ny = clamp(y - d.dy, CEIL_Y, FLOOR_Y);
      if (d.move.x2 !== undefined) {
        d.move.x2 += nx - d.move.x;
        d.move.y2 += ny - d.move.y;
      }
      d.move.x = nx;
      d.move.y = ny;
      return;
    }
    d.cx = x;
    d.cy = y;
  };

  const onUp = (e) => {
    const d = G.drags.get(e.pointerId);
    if (!d) return;
    G.drags.delete(e.pointerId);

    if (d.ink) {
      d.ink.live = false;
      // A stray tap shouldn't leave an invisible one-point wall behind.
      if (d.ink.points.length < 2) G.ink.splice(G.ink.indexOf(d.ink), 1);
      else sfx.blip();
      rebuildInkSegs();
      queueSave();
      return;
    }
    if (d.move) {
      const { x, y } = handle.toLogical(e.clientX, e.clientY);
      // A tap with the hand — no real movement — turns the part instead of
      // moving it, which is the only way to re-aim a fan without rebuilding it.
      if (Math.hypot(x - d.sx, y - d.sy) < 16) turnPart(d.move);
      else sfx.dock();
      queueSave();
      return;
    }
    if (!d.preview) return;

    const len = Math.hypot(d.cx - d.x, d.cy - d.y);
    if (PARTS[d.tool].dir) {
      // Drag points the wind (or the barrel); a plain tap aims straight up.
      const a = len > 40 ? Math.atan2(d.cy - d.y, d.cx - d.x) : -Math.PI / 2;
      place(d.tool, d.x, d.y, { a });
      return;
    }
    if (len > 60) {
      place(d.tool, d.x, d.y, { x2: clamp(d.cx, WALL_L, WALL_R), y2: clamp(d.cy, CEIL_Y, FLOOR_Y) });
    } else {
      // Tap gives a default horizontal plank, so nobody has to discover the
      // drag gesture before they can build anything.
      place(d.tool, d.x - 150, d.y, { x2: d.x + 150, y2: d.y });
    }
  };

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  G.listeners.push(() => {
    canvas.removeEventListener('pointerdown', onDown);
    canvas.removeEventListener('pointermove', onMove);
    canvas.removeEventListener('pointerup', onUp);
    canvas.removeEventListener('pointercancel', onUp);
  });
}

// Tapping a part with ✋: aimed parts swing round an eighth of a turn, a belt
// flips end for end, a bell steps to the next note. Everything else just
// wobbles, which is honest feedback that there is nothing to set.
function turnPart(p) {
  if (PARTS[p.type].dir) {
    p.a += Math.PI / 4;
    sfx.select();
  } else if (p.type === 'belt') {
    const { x, y } = p;
    p.x = p.x2; p.y = p.y2; p.x2 = x; p.y2 = y;
    sfx.select();
  } else if (p.type === 'bel') {
    p.note = ((p.note || 0) + 1) % 8;
    ringBell(p);
  } else if (p.type === 'magnet') {
    p.repel = !p.repel;
    sfx.select();
  } else if (p.type === 'wervel') {
    p.spin = (p.spin || 1) * -1;
    sfx.select();
  } else if (p.x2 !== undefined) {
    // Rotate a plank or trampoline a notch around its own middle.
    const cx = (p.x + p.x2) / 2;
    const cy = (p.y + p.y2) / 2;
    const half = Math.hypot(p.x2 - p.x, p.y2 - p.y) / 2;
    const a = Math.atan2(p.y2 - p.y, p.x2 - p.x) + Math.PI / 12;
    p.x = clamp(cx - Math.cos(a) * half, WALL_L, WALL_R);
    p.y = clamp(cy - Math.sin(a) * half, CEIL_Y, FLOOR_Y);
    p.x2 = clamp(cx + Math.cos(a) * half, WALL_L, WALL_R);
    p.y2 = clamp(cy + Math.sin(a) * half, CEIL_Y, FLOOR_Y);
    sfx.select();
  } else {
    sfx.blip();
  }
}

function unpair(part) {
  if (!part.pair) return;
  const partner = G.parts.find((o) => o.id === part.pair);
  if (partner) delete partner.pair;
}

function place(type, x, y, extra = {}) {
  if (G.parts.length >= MAX_PARTS) {
    G.hud.banner('De werkbank is vol! 🧰', { sub: 'Sloop iets met 🧨 om ruimte te maken', ms: 1800 });
    return sfx.deny();
  }
  pushUndo();
  const part = addPart(type, {
    x: clamp(x, WALL_L + 40, WALL_R - 40),
    y: clamp(y, CEIL_Y + 40, FLOOR_Y - 40),
    ...extra,
  });

  if (type === 'bel') {
    // Each new bell is the next note up, so a row of them plays a scale.
    part.note = G.parts.filter((p) => p.type === 'bel').length - 1;
    ringBell(part);
  }
  if (type === 'beam') {
    const open = G.parts.find((p) => p.type === 'beam' && p !== part && !p.pair);
    if (open) {
      open.pair = part.id;
      part.pair = open.id;
      sfx.powerup();
    } else {
      G.hud.banner('Zet er nog één neer 🛸', { sub: 'Twee beamers horen bij elkaar', ms: 1800 });
    }
  }

  // Parts dropped into a running machine join in straight away; ⏹ still puts
  // everything back to where it was built.
  if (G.running && PARTS[type].body) spawnBody(type, part.x, part.y);
  sfx.select();
  return part;
}

// --- toolbar -------------------------------------------------------------

function buildToolbar() {
  const bar = document.createElement('div');
  bar.className = 'mach-bar';
  const rowCats = document.createElement('div');
  rowCats.className = 'mach-bar__row';
  const rowA = document.createElement('div');
  rowA.className = 'mach-bar__row';
  const rowB = document.createElement('div');
  rowB.className = 'mach-bar__row';
  bar.append(rowCats, rowA, rowB);

  // Only the buttons that pick a tool are tracked here. The 🐢 and 💫 switches
  // are not tools, and lumping them in meant that choosing a plank silently
  // un-lit them while they were still on.
  const toolButtons = new Map();
  const select = (id) => {
    G.tool = id;
    toolButtons.forEach((b, key) => b.classList.toggle('is-active', key === id));
    sfx.blip();
  };

  const add = (row, icon, label, handler, cls = '') => {
    const b = document.createElement('button');
    b.className = `mach-tool ${cls}`;
    b.textContent = icon;
    b.setAttribute('aria-label', label);
    b.addEventListener('pointerdown', (e) => e.stopPropagation());
    b.addEventListener('pointerup', (e) => {
      e.stopPropagation();
      handler();
    });
    row.appendChild(b);
    return b;
  };

  const addTool = (row, id, icon, label) => {
    toolButtons.set(id, add(row, icon, label, () => select(id)));
  };

  addTool(rowB, 'ink', '✏️', 'Tekenen — je lijn wordt een baan');
  addTool(rowB, 'hand', '✋', 'Verschuiven — tik op een onderdeel om het te draaien');
  addTool(rowB, 'wreck', '🧨', 'Slopen');
  add(rowB, '↩️', 'Laatste stap terug', undoBuild);

  rowB.appendChild(sep());

  add(rowB, '🎲', 'Verrassingsmachine', nextPreset);
  add(rowB, '🌍', 'Ander landschap — verandert de zwaartekracht', nextLandscape);
  const slowBtn = add(rowB, '🐢', 'Slome film', () => {
    G.slow = !G.slow;
    slowBtn.classList.toggle('is-active', G.slow);
    sfx.select();
  });
  const trailBtn = add(rowB, '💫', 'Sporen laten zien', () => {
    G.trails = !G.trails;
    trailBtn.classList.toggle('is-active', G.trails);
    if (!G.trails) for (const b of G.bodies) b.trail.length = 0;
    sfx.select();
  });

  rowB.appendChild(sep());

  G.runBtn = add(rowB, '▶️', 'Start de machine', () => (G.running ? stopRun() : startRun()), 'mach-tool--go');
  add(rowB, '🗑️', 'Alles opruimen', () => {
    if (!G.parts.length && !G.ink.length) return sfx.deny();
    pushUndo();
    stopRun();
    G.parts = [];
    G.ink = [];
    rebuildInkSegs();
    sfx.explode();
  });

  // Category tabs swap what row A shows. Each category holds seven parts or
  // fewer, so it always fits the row's own "wrap, never scroll" rule even
  // with thirty buildable parts split across five drawers. Switching a tab
  // clears only the part buttons from `toolButtons` — the row B tools above
  // (✏️/✋/🧨) live outside any category and are never touched.
  const partIds = new Set(CATEGORIES.flatMap((c) => c.parts));
  const catButtons = new Map();
  const renderCategory = (idx, { silent } = {}) => {
    G.category = idx;
    for (const id of partIds) toolButtons.delete(id);
    rowA.replaceChildren();
    for (const id of CATEGORIES[idx].parts) addTool(rowA, id, PARTS[id].icon, PARTS[id].name);
    catButtons.forEach((b, key) => b.classList.toggle('is-active', key === idx));
    if (toolButtons.has(G.tool)) toolButtons.get(G.tool).classList.add('is-active');
    if (!silent) sfx.blip();
  };
  CATEGORIES.forEach((cat, idx) => {
    catButtons.set(idx, add(rowCats, cat.icon, cat.label, () => renderCategory(idx), 'mach-tool--cat'));
  });
  renderCategory(G.category, { silent: true });

  G.stage.appendChild(bar);

  G.hint = document.createElement('div');
  G.hint.className = 'hint-strip mach-hint';
  G.hint.textContent = 'Zet onderdelen neer, teken banen en druk op ▶ — of pak 🎲 of 🌍';
  G.stage.appendChild(G.hint);
}

function refreshRunButton() {
  // The build hint has done its job once the machine has run once.
  G.hint.classList.toggle('is-gone', G.running || G.hasRun);
  G.runBtn.textContent = G.running ? '⏹' : '▶️';
  G.runBtn.setAttribute('aria-label', G.running ? 'Stop en zet alles terug' : 'Start de machine');
  G.runBtn.classList.toggle('is-running', G.running);
}

function sep() {
  const d = document.createElement('div');
  d.className = 'mach-sep';
  return d;
}
