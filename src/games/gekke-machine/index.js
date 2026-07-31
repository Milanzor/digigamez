import './style.css';
import { createHud } from '../../shared/ui-components.js';
import {
  setupCanvas, LOGICAL_WIDTH, createStars, drawSpaceBackdrop,
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

const GRAVITY = 1900;
const MAX_BODIES = 60;
const MAX_PARTS = 90;
const SUBSTEPS = 3;
const SLOW_SCALE = 0.3;

const BELT_SPEED = 660;
const WIP_ARM = 190;
// The seesaw is heavy compared to a marble: a plank light enough to be flipped
// by one falling ball is a plank that never sits still long enough to aim.
const WIP_INERTIA = 130000;
const SPINNER_SPEED = 2.1;
const KEGEL_KNOCK = 360;
const TRAIL_LEN = 26;

const PARTS = {
  marble: { icon: '🔵', name: 'Knikker', body: { r: 26, e: 0.42, drag: 0.999 } },
  bouncy: { icon: '🏀', name: 'Stuiterbal', body: { r: 30, e: 0.88, drag: 0.999 } },
  balloon: { icon: '🎈', name: 'Ballon', body: { r: 34, e: 0.6, drag: 0.986, g: -0.42 } },
  rocket: { icon: '🚀', name: 'Raket', body: { r: 24, e: 0.5, drag: 0.996, thrust: 2400 } },
  plank: { icon: '📏', name: 'Plank', seg: true },
  tramp: { icon: '🛟', name: 'Trampoline', seg: true },
  belt: { icon: '🛞', name: 'Transportband — tik erop om te draaien', seg: true },
  wip: { icon: '⚖️', name: 'Wip' },
  spinner: { icon: '🌀', name: 'Molen' },
  kegel: { icon: '🎳', name: 'Kegel' },
  bel: { icon: '🔔', name: 'Klokkenspel' },
  fan: { icon: '💨', name: 'Ventilator — tik erop om te draaien', dir: true },
  kanon: { icon: '💥', name: 'Kanon — tik erop om te draaien', dir: true },
  magnet: { icon: '🧲', name: 'Magneet' },
  hole: { icon: '🕳️', name: 'Zwart gat' },
  stroop: { icon: '🍯', name: 'Stroop' },
  bomb: { icon: '💣', name: 'Bom' },
  fountain: { icon: '⛲', name: 'Knikkerkraan' },
  beam: { icon: '🛸', name: 'Beamer — zet er twee neer' },
  basket: { icon: '🪣', name: 'Emmer' },
};

const PART_ORDER = [
  'marble', 'bouncy', 'balloon', 'rocket',
  'plank', 'tramp', 'belt', 'wip', 'spinner', 'kegel', 'bel',
  'fan', 'kanon', 'magnet', 'hole', 'stroop', 'bomb',
  'fountain', 'beam', 'basket',
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
    undo: [],
    running: false,
    slow: false,
    trails: false,
    tool: 'marble',
    drags: new Map(),
    score: 0,
    seq: 1,
    preset: -1,
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
    if (p.pair !== undefined) d.p = G.parts.findIndex((o) => o.id === p.pair);
    return d;
  });
  return { parts, ink: G.ink.map((s) => s.points.map((q) => [Math.round(q.x), Math.round(q.y)])) };
}

function deserialize(data) {
  G.parts = [];
  G.ink = [];
  if (!data || !Array.isArray(data.parts)) return;
  const made = data.parts.map((d) => {
    if (!PARTS[d.t] || !Number.isFinite(d.x) || !Number.isFinite(d.y)) return null;
    const props = { x: d.x, y: d.y };
    if (Number.isFinite(d.x2)) { props.x2 = d.x2; props.y2 = d.y2; }
    if (Number.isFinite(d.a)) props.a = d.a;
    if (Number.isFinite(d.n)) props.note = d.n;
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
    // through the whole set instead of dropping on top of one.
    name: 'Kegelkanon 💥',
    parts: [
      ['kanon', { x: 190, y: 700, a: -0.12 }],
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

// --- geometry ------------------------------------------------------------

// Every static part exposes its collision as line segments, so a body only
// ever has to know about one shape. A zero-length segment is a circle of
// radius `w`, which is what the bells use.
function collectSegs(p, out) {
  switch (p.type) {
    case 'plank':
      out.push({ x1: p.x, y1: p.y, x2: p.x2, y2: p.y2, e: 0.42, w: 10 });
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

function rebuildSegs() {
  G.segs.length = 0;
  for (const p of G.parts) collectSegs(p, G.segs);
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
    // Fountains and cannons keep the machine fed.
    if (p.type === 'fountain') {
      p.nextDrop = (p.nextDrop || 0) - dt;
      if (p.nextDrop <= 0) {
        p.nextDrop = 0.85;
        const b = spawnBody('marble', p.x, p.y + 60);
        if (b) b.vy = 140;
      }
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
    let ay = GRAVITY * b.g;

    for (const p of parts) {
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
        const power = 2600 * (1 - d / 420);
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

    for (const s of G.segs) hitSegment(b, s);
    for (const s of G.inkSegs) hitSegment(b, s);
  }

  // Ball on ball: equal mass, so the resolution is a straight swap of the
  // velocity along the contact normal.
  for (let i = 0; i < G.bodies.length; i++) {
    for (let j = i + 1; j < G.bodies.length; j++) {
      const a = G.bodies[i];
      const b = G.bodies[j];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const min = a.r + b.r;
      const d2 = dx * dx + dy * dy;
      if (d2 >= min * min || d2 === 0) continue;
      const d = Math.sqrt(d2);
      const nx = dx / d;
      const ny = dy / d;
      const overlap = (min - d) / 2;
      a.x -= nx * overlap; a.y -= ny * overlap;
      b.x += nx * overlap; b.y += ny * overlap;
      const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
      if (rel > 0) continue;
      const e = Math.min(a.e, b.e);
      const j2 = -(1 + e) * rel * 0.5;
      a.vx -= j2 * nx; a.vy -= j2 * ny;
      b.vx += j2 * nx; b.vy += j2 * ny;
      if (-rel > 700) thud(-rel);
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
  let d = Math.hypot(nx, ny);
  const reach = b.r + s.w;
  if (d >= reach) return;
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
  const grip = Math.min(Math.abs(vt), jn * 0.12) * Math.sign(vt);
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

    for (const p of G.parts) {
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
        if (G.score % 5 === 0) G.hud.banner('Lekker bezig! 🎉', { ms: 1400 });
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
  drawSpaceBackdrop(ctx, G.stars, G.t, { scrollSpeed: 0 });
  drawBench(ctx);

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

function drawBench(ctx) {
  ctx.strokeStyle = 'rgba(124,196,255,0.22)';
  ctx.lineWidth = 4;
  ctx.setLineDash([18, 14]);
  ctx.strokeRect(WALL_L, CEIL_Y, WALL_R - WALL_L, FLOOR_Y - CEIL_Y);
  ctx.setLineDash([]);

  const g = ctx.createLinearGradient(0, FLOOR_Y, 0, FLOOR_Y + 60);
  g.addColorStop(0, '#3a3560');
  g.addColorStop(1, '#12112b');
  ctx.fillStyle = g;
  roundRect(ctx, WALL_L - 10, FLOOR_Y, WALL_R - WALL_L + 20, 42, 12);
  ctx.fill();
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

function emoji(ctx, glyph, x, y, size, rot = 0) {
  ctx.save();
  ctx.translate(x, y);
  if (rot) ctx.rotate(rot);
  ctx.font = `${size}px serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(glyph, 0, 0);
  ctx.restore();
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
    case 'tramp': {
      const teal = p.type === 'tramp';
      ctx.save();
      ctx.lineCap = 'round';
      ctx.strokeStyle = teal ? '#5fe3c4' : '#c9a06a';
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
      const g = ctx.createRadialGradient(p.x - 10, p.y - 12, 4, p.x, p.y, 36);
      g.addColorStop(0, '#fff3c4');
      g.addColorStop(0.6, '#ffc24a');
      g.addColorStop(1, '#a35f10');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 34 + ring * 3, 0, Math.PI * 2);
      ctx.fill();
      // Little note pips so children can tell the bells apart by eye as well.
      ctx.fillStyle = 'rgba(20,26,60,0.65)';
      const pips = ((p.note || 0) % 8) + 1;
      for (let i = 0; i < pips; i++) {
        const ang = -Math.PI / 2 + (i - (pips - 1) / 2) * 0.34;
        ctx.beginPath();
        ctx.arc(p.x + Math.cos(ang) * 20, p.y + Math.sin(ang) * 20, 3.4, 0, Math.PI * 2);
        ctx.fill();
      }
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
    case 'fountain': {
      ctx.fillStyle = '#8fd6ff';
      roundRect(ctx, p.x - 54, p.y - 40, 108, 74, 16);
      ctx.fill();
      ctx.fillStyle = '#0d0c22';
      ctx.beginPath();
      ctx.arc(p.x, p.y + 40, 22, 0, Math.PI * 2);
      ctx.fill();
      emoji(ctx, '⛲', p.x, p.y - 6, 54);
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
    default: {
      const g = ctx.createRadialGradient(b.x - b.r * 0.35, b.y - b.r * 0.4, b.r * 0.1, b.x, b.y, b.r);
      g.addColorStop(0, '#bfe3ff');
      g.addColorStop(0.5, '#3b6bff');
      g.addColorStop(1, '#16277a');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.beginPath();
      ctx.arc(b.x - b.r * 0.32, b.y - b.r * 0.36, b.r * 0.22, 0, Math.PI * 2);
      ctx.fill();
    }
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
  const rowA = document.createElement('div');
  rowA.className = 'mach-bar__row';
  const rowB = document.createElement('div');
  rowB.className = 'mach-bar__row';
  bar.append(rowA, rowB);

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

  for (const id of PART_ORDER) {
    addTool(rowA, id, PARTS[id].icon, PARTS[id].name);
  }

  addTool(rowB, 'ink', '✏️', 'Tekenen — je lijn wordt een baan');
  addTool(rowB, 'hand', '✋', 'Verschuiven — tik op een onderdeel om het te draaien');
  addTool(rowB, 'wreck', '🧨', 'Slopen');
  add(rowB, '↩️', 'Laatste stap terug', undoBuild);

  rowB.appendChild(sep());

  add(rowB, '🎲', 'Verrassingsmachine', nextPreset);
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

  toolButtons.get(G.tool).classList.add('is-active');
  G.stage.appendChild(bar);

  G.hint = document.createElement('div');
  G.hint.className = 'hint-strip mach-hint';
  G.hint.textContent = 'Zet onderdelen neer, teken banen en druk op ▶ — of pak 🎲';
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
