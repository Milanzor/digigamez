import './style.css';
import { createHud, showMissionComplete } from '../../shared/ui-components.js';
import {
  setupCanvas, LOGICAL_WIDTH, LOGICAL_HEIGHT,
  createStars, drawSpaceBackdrop, createBurst, updateAndDrawParticles,
  drawGlow, roundRect, withAlpha,
} from '../../shared/canvas-utils.js';
import { sfx } from '../../shell/audio.js';
import { setLevel, starsForLevel } from '../../shell/progress.js';

// "Sterrenschrift" — drag a comet along the dotted line and the shape burns in
// behind it.
//
// The archive had free drawing (Ruimtetekenen) and it had letter recognition
// (Letterplaneten), but nothing that guided a finger along a path — and a 75"
// touchscreen is the best pre-writing surface in the building. This is that
// missing skill: shapes, then numerals, then the lowercase letters a Dutch
// five-year-old is actually taught, then whole words.
//
// The mechanic that makes it work is the projection. The comet is not drawn
// where the finger is; it is drawn at the furthest point along the path the
// finger has reached, and it can only ever step *forwards* and only by a short
// look-ahead. Three things fall out of that at once:
//
// - the letter that appears is always a clean letter, not a four-year-old's
//   wobble, so the reward is the shape they were aiming at;
// - you cannot skip to the end, because the look-ahead is shorter than a stroke;
// - and straying off the line does not fail anything. The comet simply stops and
//   waits, which is the only no-loss answer to "you went outside the lines"
//   that does not involve an error noise.
//
// The pen order is plausible rather than prescribed. This is a mission about the
// shape of a letter, not a handwriting method, and inventing a curriculum here
// would be pretending to an authority the archive does not have.

// --- Path primitives ------------------------------------------------------

// Segments carry their own endpoints rather than continuing from wherever the
// previous one left off. Verbose to author, but it means a typo shows up as a
// visibly broken glyph instead of as a silently shifted one.
const L = (x0, y0, x1, y1) => ({ t: 'L', x0, y0, x1, y1 });
const E = (cx, cy, rx, ry, a0, a1) => ({ t: 'E', cx, cy, rx, ry, a0, a1 });
const Q = (x0, y0, cx, cy, x1, y1) => ({ t: 'Q', x0, y0, cx, cy, x1, y1 });
// A stroke that is a single tap: the dot on an i. Tracing a dot is fiddly and
// tapping it is what a pen actually does.
const DOT = (x, y) => ({ t: 'DOT', x, y });

function pointOn(seg, u) {
  if (seg.t === 'L') {
    return { x: seg.x0 + (seg.x1 - seg.x0) * u, y: seg.y0 + (seg.y1 - seg.y0) * u };
  }
  if (seg.t === 'E') {
    const a = ((seg.a0 + (seg.a1 - seg.a0) * u) * Math.PI) / 180;
    return { x: seg.cx + Math.cos(a) * seg.rx, y: seg.cy + Math.sin(a) * seg.ry };
  }
  const v = 1 - u;
  return {
    x: v * v * seg.x0 + 2 * v * u * seg.cx + u * u * seg.x1,
    y: v * v * seg.y0 + 2 * v * u * seg.cy + u * u * seg.y1,
  };
}

// Roughly evenly spaced points along a stroke, in box-normalised space scaled to
// `side`. Even spacing is what lets the cursor's look-ahead be expressed as a
// distance in pixels rather than as a fraction of a curve.
const SPACING = 6;

function sampleStroke(segments, side) {
  const pts = [];
  for (const seg of segments) {
    if (seg.t === 'DOT') {
      pts.push({ x: seg.x * side, y: seg.y * side });
      continue;
    }
    // Estimate the length first, then step at the wanted spacing.
    let len = 0;
    let prev = pointOn(seg, 0);
    for (let i = 1; i <= 16; i++) {
      const p = pointOn(seg, i / 16);
      len += Math.hypot(p.x - prev.x, p.y - prev.y) * side;
      prev = p;
    }
    const steps = Math.max(2, Math.ceil(len / SPACING));
    for (let i = 0; i <= steps; i++) {
      const p = pointOn(seg, i / steps);
      const x = p.x * side;
      const y = p.y * side;
      const last = pts[pts.length - 1];
      if (last && Math.hypot(last.x - x, last.y - y) < SPACING * 0.4) continue;
      pts.push({ x, y });
    }
  }
  return pts;
}

// --- The glyphs -----------------------------------------------------------
//
// One box, coordinates 0..1, y downwards. Baseline 0.80, x-height top 0.42,
// ascender top 0.10, descender bottom 0.96 — so an `l` is visibly tall next to
// an `o` and a `p` visibly hangs, which is half of what makes lowercase
// readable in the first place.

const SHAPES = {
  lijn: { label: 'lijn', strokes: [[L(0.5, 0.14, 0.5, 0.86)]] },
  streep: { label: 'streep', strokes: [[L(0.14, 0.5, 0.86, 0.5)]] },
  cirkel: { label: 'cirkel', strokes: [[E(0.5, 0.5, 0.33, 0.33, -90, -450)]] },
  vierkant: {
    label: 'vierkant',
    strokes: [[
      L(0.2, 0.2, 0.8, 0.2), L(0.8, 0.2, 0.8, 0.8),
      L(0.8, 0.8, 0.2, 0.8), L(0.2, 0.8, 0.2, 0.2),
    ]],
  },
  driehoek: {
    label: 'driehoek',
    strokes: [[L(0.5, 0.16, 0.84, 0.82), L(0.84, 0.82, 0.16, 0.82), L(0.16, 0.82, 0.5, 0.16)]],
  },
  golf: {
    label: 'golf',
    strokes: [[
      Q(0.1, 0.5, 0.24, 0.24, 0.38, 0.5),
      Q(0.38, 0.5, 0.52, 0.76, 0.66, 0.5),
      Q(0.66, 0.5, 0.8, 0.24, 0.94, 0.5),
    ]],
  },
  zigzag: {
    label: 'zigzag',
    strokes: [[L(0.12, 0.3, 0.37, 0.72), L(0.37, 0.72, 0.62, 0.3), L(0.62, 0.3, 0.88, 0.72)]],
  },
  kruis: {
    label: 'kruis',
    strokes: [[L(0.5, 0.16, 0.5, 0.84)], [L(0.16, 0.5, 0.84, 0.5)]],
  },
};

const DIGITS = {
  0: { strokes: [[E(0.5, 0.49, 0.17, 0.33, -90, -450)]] },
  1: { strokes: [[L(0.4, 0.28, 0.52, 0.16), L(0.52, 0.16, 0.52, 0.82)]] },
  2: {
    strokes: [[
      E(0.5, 0.34, 0.16, 0.16, 200, 380),
      L(0.65, 0.395, 0.34, 0.82), L(0.34, 0.82, 0.7, 0.82),
    ]],
  },
  3: {
    strokes: [[
      E(0.48, 0.35, 0.15, 0.15, 190, 405),
      E(0.47, 0.62, 0.17, 0.18, -70, 120),
    ]],
  },
  4: {
    strokes: [[L(0.62, 0.16, 0.28, 0.6), L(0.28, 0.6, 0.74, 0.6)], [L(0.62, 0.16, 0.62, 0.82)]],
  },
  5: {
    strokes: [[
      L(0.68, 0.18, 0.36, 0.18), L(0.36, 0.18, 0.36, 0.46),
      E(0.44, 0.63, 0.18, 0.19, -115, 110),
    ]],
  },
  6: {
    strokes: [[Q(0.68, 0.22, 0.3, 0.28, 0.32, 0.66), E(0.48, 0.66, 0.16, 0.16, 180, 540)]],
  },
  7: { strokes: [[L(0.3, 0.18, 0.7, 0.18), L(0.7, 0.18, 0.44, 0.82)]] },
  8: {
    strokes: [[E(0.5, 0.35, 0.15, 0.16, -90, 270)], [E(0.5, 0.63, 0.17, 0.19, -90, -450)]],
  },
  9: {
    strokes: [[E(0.48, 0.35, 0.16, 0.16, -90, -450)], [L(0.64, 0.35, 0.58, 0.82)]],
  },
};

// The eighteen lowercase letters the words below are spelled from. Bowls are
// ellipse arcs so an `o` is round at any box size, and `b`/`d` are deliberately
// built from the same bowl and the same stem — they are each other's mirror and
// pretending otherwise would be a lie about the alphabet. Telling them apart is
// a reading lesson; here there is only ever one letter on the board, so there is
// nothing to confuse it with.
const LETTERS = {
  o: { strokes: [[E(0.5, 0.61, 0.19, 0.19, -90, -450)]] },
  c: { strokes: [[E(0.5, 0.61, 0.19, 0.19, -52, -308)]] },
  a: { strokes: [[E(0.47, 0.61, 0.17, 0.19, -90, -450)], [L(0.64, 0.42, 0.64, 0.8)]] },
  d: { strokes: [[E(0.47, 0.61, 0.17, 0.19, -90, -450)], [L(0.64, 0.1, 0.64, 0.8)]] },
  b: { strokes: [[L(0.33, 0.1, 0.33, 0.8)], [E(0.5, 0.61, 0.17, 0.19, -180, 180)]] },
  p: { strokes: [[L(0.33, 0.42, 0.33, 0.96)], [E(0.5, 0.61, 0.17, 0.19, -180, 180)]] },
  e: { strokes: [[L(0.31, 0.61, 0.69, 0.61), E(0.5, 0.61, 0.19, 0.19, 0, -300)]] },
  s: {
    strokes: [[Q(0.65, 0.47, 0.28, 0.43, 0.46, 0.61), Q(0.46, 0.61, 0.72, 0.68, 0.34, 0.78)]],
  },
  i: { strokes: [[L(0.5, 0.42, 0.5, 0.8)], [DOT(0.5, 0.28)]] },
  l: { strokes: [[L(0.5, 0.1, 0.5, 0.8)]] },
  t: { strokes: [[L(0.5, 0.16, 0.5, 0.8)], [L(0.32, 0.42, 0.68, 0.42)]] },
  u: {
    strokes: [[
      L(0.33, 0.42, 0.33, 0.66), E(0.5, 0.66, 0.17, 0.14, 180, 0), L(0.67, 0.66, 0.67, 0.8),
    ]],
  },
  n: {
    strokes: [[L(0.33, 0.42, 0.33, 0.8)], [E(0.5, 0.56, 0.17, 0.14, 180, 360), L(0.67, 0.56, 0.67, 0.8)]],
  },
  m: {
    strokes: [
      [L(0.22, 0.42, 0.22, 0.8)],
      [E(0.345, 0.56, 0.125, 0.14, 180, 360), L(0.47, 0.56, 0.47, 0.8)],
      [E(0.595, 0.56, 0.125, 0.14, 180, 360), L(0.72, 0.56, 0.72, 0.8)],
    ],
  },
  r: { strokes: [[L(0.36, 0.42, 0.36, 0.8)], [E(0.5, 0.56, 0.14, 0.14, 180, 330)]] },
  v: { strokes: [[L(0.32, 0.42, 0.5, 0.8), L(0.5, 0.8, 0.68, 0.42)]] },
  z: {
    strokes: [[L(0.32, 0.44, 0.68, 0.44), L(0.68, 0.44, 0.32, 0.78), L(0.32, 0.78, 0.68, 0.78)]],
  },
  h: {
    strokes: [[L(0.33, 0.1, 0.33, 0.8)], [E(0.5, 0.56, 0.17, 0.14, 180, 360), L(0.67, 0.56, 0.67, 0.8)]],
  },
};

// Words spelled entirely from the letters above, each with a picture that has
// one unmistakable Dutch name — the same rule Letterplaneten applies, and the
// reason there is no cat in either mission.
const WORDS = [
  { text: 'maan', emoji: '🌙' },
  { text: 'boom', emoji: '🌳' },
  { text: 'vis', emoji: '🐟' },
  { text: 'zon', emoji: '☀️' },
  { text: 'huis', emoji: '🏠' },
  { text: 'boot', emoji: '⛵' },
  { text: 'roos', emoji: '🌹' },
  { text: 'neus', emoji: '👃' },
  { text: 'muis', emoji: '🐭' },
  { text: 'mier', emoji: '🐜' },
];

const LEVELS = [
  { kind: 'shape', pool: Object.keys(SHAPES), quota: 4 },
  { kind: 'digit', pool: Object.keys(DIGITS), quota: 4 },
  { kind: 'letter', pool: ['o', 'c', 'a', 'd', 'e', 's'], quota: 4 },
  { kind: 'letter', pool: ['i', 'l', 't', 'u', 'n', 'm', 'r', 'v', 'z', 'b', 'p', 'h'], quota: 4 },
  { kind: 'word', pool: WORDS.map((w) => w.text), quota: 2 },
];

function glyphFor(kind, key) {
  if (kind === 'shape') return SHAPES[key];
  if (kind === 'digit') return DIGITS[key];
  return LETTERS[key];
}

let hud = null;
let handle = null;
let raf = null;
let listeners = [];
let timers = [];
let reward = null;
let stage = null;
let level = 1;
let slug = 'sterrenschrift';
let mission = null;
let onExit = null;

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

function later(fn, ms) {
  const id = setTimeout(fn, ms);
  timers.push(id);
  return id;
}

export function init(container, opts) {
  slug = opts.slug;
  level = Math.max(1, opts.startLevel || 1);
  mission = { title: opts.title, icon: opts.icon, color: opts.color };
  onExit = opts.onExit;
  reward = null;
  listeners = [];
  timers = [];

  const players = Math.max(1, Math.min(2, opts.players || 1));

  hud = createHud(container, {
    title: opts.title,
    onExit: opts.onExit,
    level,
    meter: 'Geschreven',
  });

  stage = document.createElement('div');
  stage.className = 'trace-stage';
  const canvas = document.createElement('canvas');
  canvas.className = 'trace-canvas';
  const hint = document.createElement('div');
  hint.className = 'hint-line trace-hint';
  stage.append(canvas, hint);
  container.appendChild(stage);

  // Andika is fetched by this game's own stylesheet; asking for it up front means
  // the canvas has the real letter in hand by the time a word needs drawing
  // instead of flashing the fallback for a frame.
  document.fonts?.load('700 64px Andika').catch(() => {});

  handle = setupCanvas(canvas, { alpha: false });
  const { ctx, toLogical } = handle;
  const backdrop = createStars(90);

  let cfg = LEVELS[0];
  let boxes = [];
  let particles = [];
  let completed = 0;
  let finishing = false;
  let t = 0;

  function makeBox(index, count) {
    const side = count === 1
      ? Math.min(600, LOGICAL_HEIGHT - 360)
      : Math.min(470, LOGICAL_HEIGHT - 380);
    const slot = LOGICAL_WIDTH / count;
    return {
      cx: slot * (index + 0.5),
      cy: 640,
      side,
      lastKey: null,
      word: null,
      key: null,
      strokes: [],
      strokeIdx: 0,
      flare: 0,
      pointerId: null,
      // Which pointer is allowed to drive this box. Set on the first touch that
      // lands on this box's glyph and cleared on lift, so two children tracing
      // side by side cannot pull each other's comet along.
    };
  }

  function loadGlyph(box, key) {
    box.key = key;
    box.strokeIdx = 0;
    const glyph = glyphFor(box.word ? 'letter' : cfg.kind, key);
    box.strokes = glyph.strokes.map((segments) => ({
      samples: sampleStroke(segments, box.side),
      cursor: 0,
      done: false,
      isDot: segments.length === 1 && segments[0].t === 'DOT',
    }));

    // Where the glyph actually lands inside its box. A wave only fills the middle
    // band of a square and an `o` sits below the ascender line, so anything hung
    // off the top of the *box* floats a long way above the thing it labels. The
    // label and the word strip are hung off the drawing instead.
    let top = box.side;
    for (const stroke of box.strokes) {
      for (const p of stroke.samples) top = Math.min(top, p.y);
    }
    box.inkTop = top;
  }

  // Picks the next thing to trace for this box. On the word rung a box works
  // through one word letter by letter; everywhere else each glyph is its own
  // round.
  function nextGlyph(box) {
    if (box.word && box.word.index < box.word.letters.length) {
      loadGlyph(box, box.word.letters[box.word.index]);
      return;
    }
    if (cfg.kind === 'word') {
      let word = pick(WORDS);
      for (let guard = 0; guard < 8 && word.text === box.lastKey; guard++) word = pick(WORDS);
      box.lastKey = word.text;
      box.word = { ...word, letters: word.text.split(''), index: 0 };
      loadGlyph(box, box.word.letters[0]);
      return;
    }
    box.word = null;
    // Never the same glyph twice running in the same box — repetition is what
    // makes a practice screen feel like a worksheet — and never the same one as
    // the box next door, because two children tracing identical shapes side by
    // side looks like the board has stalled.
    const taken = new Set([box.lastKey, ...boxes.filter((b) => b !== box).map((b) => b.key)]);
    let key = pick(cfg.pool);
    for (let guard = 0; guard < 12 && taken.has(key) && cfg.pool.length > 2; guard++) {
      key = pick(cfg.pool);
    }
    box.lastKey = key;
    loadGlyph(box, key);
  }

  function startLevel() {
    cfg = LEVELS[Math.min(level, LEVELS.length) - 1];
    boxes = Array.from({ length: players }, (_, i) => makeBox(i, players));
    boxes.forEach((b) => nextGlyph(b));
    particles = [];
    completed = 0;
    finishing = false;
    hud.setLevel(level);
    hud.setMeter(0);
    hint.textContent = cfg.kind === 'word'
      ? 'Schrijf het woord letter voor letter'
      : 'Zet je vinger op de stip en volg de lijn';
  }

  function finishLevel() {
    if (finishing) return;
    finishing = true;
    sfx.missionComplete();
    const cleared = level;
    level += 1;
    setLevel(slug, level);
    reward = showMissionComplete(stage, {
      icon: mission.icon,
      color: mission.color,
      mission: mission.title,
      level: cleared,
      stars: starsForLevel(level),
      title: 'Netjes geschreven! ✍️',
      onNext: () => { reward = null; startLevel(); },
      onRetry: () => { reward = null; level = cleared; startLevel(); },
      onHome: onExit,
    });
  }

  // --- Tracing ------------------------------------------------------------

  const toBox = (box, p) => ({ x: p.x - (box.cx - box.side / 2), y: p.y - (box.cy - box.side / 2) });
  // Screen y of the topmost ink in this box's glyph, clamped clear of the HUD.
  // A glyph like `lijn` starts at the very top of its box, so anything hung a
  // little above the ink lands on the start marker's halo.
  const inkTopY = (box) => Math.max(250, box.cy - box.side / 2 + (box.inkTop ?? 0));
  const tol = (box) => box.side * 0.11;
  const lookAhead = (box) => Math.max(8, Math.round((box.side * 0.17) / SPACING));

  function glyphDone(box) {
    box.flare = 1;
    const centre = { x: box.cx, y: box.cy };
    particles.push(...createBurst(centre.x, centre.y, [mission.color, '#ffffff', '#ffc24a'], {
      count: 22, speed: 300,
    }));

    if (box.word) {
      box.word.index += 1;
      sfx.chime(box.word.index - 1);
      if (box.word.index < box.word.letters.length) {
        later(() => loadGlyph(box, box.word.letters[box.word.index]), 520);
        return;
      }
      sfx.levelUp();
      // The word is deliberately left standing with every letter lit rather than
      // cleared here: the finished word is the reward, and `nextGlyph` picks a
      // new one when the flare is over.
    } else {
      sfx.levelUp();
    }

    completed += 1;
    hud.setMeter(completed / cfg.quota);
    if (completed >= cfg.quota) {
      later(() => finishLevel(), 900);
      return;
    }
    later(() => nextGlyph(box), 900);
  }

  // Advances the cursor to the furthest sample the finger has reached, within a
  // short look-ahead. Returns true if it moved, which is all the caller needs to
  // know to decide whether to make a noise.
  function advance(box, local) {
    const stroke = box.strokes[box.strokeIdx];
    if (!stroke || stroke.done) return false;
    const s = stroke.samples;

    if (stroke.isDot) {
      if (Math.hypot(s[0].x - local.x, s[0].y - local.y) > tol(box) * 1.6) return false;
      stroke.done = true;
      stroke.cursor = 0;
      finishStroke(box);
      return true;
    }

    const limit = Math.min(s.length - 1, stroke.cursor + lookAhead(box));
    const reach = tol(box);
    let best = stroke.cursor;
    for (let i = stroke.cursor; i <= limit; i++) {
      if (Math.hypot(s[i].x - local.x, s[i].y - local.y) <= reach) best = i;
    }
    if (best === stroke.cursor) return false;
    stroke.cursor = best;

    // Within a sample or two of the end counts as finished: asking a child to
    // land exactly on the last pixel of a stroke would be the one place this
    // game could fail somebody.
    if (stroke.cursor >= s.length - 2) {
      stroke.done = true;
      stroke.cursor = s.length - 1;
      finishStroke(box);
    }
    return true;
  }

  function finishStroke(box) {
    sfx.blip();
    if (box.strokes.every((st) => st.done)) {
      glyphDone(box);
    } else {
      box.strokeIdx = box.strokes.findIndex((st) => !st.done);
    }
  }

  // A touch may only take charge of a box if it lands near where that box is
  // waiting: the start of the stroke, or wherever the comet was left. That is
  // also what stops a stray hand crossing the board from dragging a letter half
  // written.
  function canGrab(box, local) {
    const stroke = box.strokes[box.strokeIdx];
    if (!stroke || stroke.done) return false;
    const at = stroke.samples[stroke.cursor];
    return Math.hypot(at.x - local.x, at.y - local.y) <= tol(box) * 1.7;
  }

  function boxAt(p) {
    // Nearest box by centre distance, which for one or two boxes is just "the
    // half of the screen the finger is on".
    let best = null;
    let bestD = Infinity;
    for (const box of boxes) {
      const d = Math.abs(p.x - box.cx);
      if (d < bestD) { bestD = d; best = box; }
    }
    return best;
  }

  // --- Drawing ------------------------------------------------------------

  function strokePath(ctx2, samples, from, to) {
    ctx2.beginPath();
    ctx2.moveTo(samples[from].x, samples[from].y);
    for (let i = from + 1; i <= to; i++) ctx2.lineTo(samples[i].x, samples[i].y);
  }

  function drawGuides(box) {
    if (cfg.kind === 'shape') return;
    // Baseline and x-height, faint. For a child who is learning that a letter
    // sits *on* a line, the line has to be there.
    const s = box.side;
    ctx.save();
    ctx.strokeStyle = 'rgba(243,236,224,0.1)';
    ctx.lineWidth = 2;
    ctx.setLineDash([14, 14]);
    [0.42, 0.8].forEach((y) => {
      ctx.beginPath();
      ctx.moveTo(0, y * s);
      ctx.lineTo(s, y * s);
      ctx.stroke();
    });
    ctx.restore();
  }

  function drawBox(box) {
    const s = box.side;
    ctx.save();
    ctx.translate(box.cx - s / 2, box.cy - s / 2);

    drawGuides(box);

    const road = Math.max(18, s * 0.075);
    const line = Math.max(9, s * 0.032);

    // Every stroke's road is visible from the start, done or not, so the child
    // can see which letter they are being asked for rather than discovering it
    // one stroke at a time.
    box.strokes.forEach((stroke, i) => {
      const samples = stroke.samples;
      if (stroke.isDot) {
        const p = samples[0];
        ctx.save();
        if (stroke.done) {
          drawGlow(ctx, mission.color, p.x, p.y, road * 1.5, 0.8);
          ctx.fillStyle = mission.color;
          ctx.beginPath();
          ctx.arc(p.x, p.y, road * 0.5, 0, Math.PI * 2);
          ctx.fill();
        } else {
          const live = i === box.strokeIdx;
          ctx.strokeStyle = live
            ? `rgba(255,194,74,${0.55 + Math.sin(t * 5) * 0.3})`
            : 'rgba(243,236,224,0.16)';
          ctx.lineWidth = 4;
          ctx.setLineDash([8, 8]);
          ctx.beginPath();
          ctx.arc(p.x, p.y, road * 0.55, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.restore();
        return;
      }

      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';

      ctx.strokeStyle = 'rgba(243,236,224,0.075)';
      ctx.lineWidth = road;
      strokePath(ctx, samples, 0, samples.length - 1);
      ctx.stroke();

      // Dashed centreline only on the stroke that is live, so there is never a
      // question about which line to be on.
      if (i === box.strokeIdx && !stroke.done) {
        ctx.save();
        ctx.strokeStyle = 'rgba(243,236,224,0.34)';
        ctx.lineWidth = 3;
        ctx.setLineDash([10, 16]);
        strokePath(ctx, samples, 0, samples.length - 1);
        ctx.stroke();
        ctx.restore();
      }

      // The burnt-in part.
      const upto = stroke.done ? samples.length - 1 : stroke.cursor;
      if (upto > 0) {
        ctx.strokeStyle = withAlpha(mission.color, 0.95);
        ctx.lineWidth = line;
        strokePath(ctx, samples, 0, upto);
        ctx.stroke();
      }

      // The comet at the head of the live stroke, and the start marker before
      // anybody has touched it.
      if (i === box.strokeIdx && !stroke.done) {
        const head = samples[stroke.cursor];
        if (stroke.cursor === 0) {
          const pulse = 1 + Math.sin(t * 4) * 0.12;
          drawGlow(ctx, '#ffc24a', head.x, head.y, road * 1.5 * pulse, 0.85);
          ctx.fillStyle = '#ffd479';
          ctx.beginPath();
          ctx.arc(head.x, head.y, road * 0.42, 0, Math.PI * 2);
          ctx.fill();
          // Which way to set off: a small arrow along the first bit of the path.
          const ahead = samples[Math.min(samples.length - 1, 14)];
          const a = Math.atan2(ahead.y - head.y, ahead.x - head.x);
          ctx.save();
          ctx.translate(head.x, head.y);
          ctx.rotate(a);
          ctx.fillStyle = '#2c1c04';
          ctx.beginPath();
          ctx.moveTo(road * 0.3, 0);
          ctx.lineTo(-road * 0.1, -road * 0.2);
          ctx.lineTo(-road * 0.1, road * 0.2);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        } else {
          drawGlow(ctx, '#fff6e5', head.x, head.y, road * 1.3, 0.9);
          ctx.fillStyle = '#fff6e5';
          ctx.beginPath();
          ctx.arc(head.x, head.y, line * 0.7, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    });

    if (box.flare > 0) {
      ctx.save();
      ctx.globalAlpha = box.flare * 0.5;
      ctx.strokeStyle = withAlpha(mission.color, 1);
      ctx.lineWidth = 10;
      ctx.beginPath();
      ctx.arc(s / 2, s / 2, s * (0.3 + (1 - box.flare) * 0.5), 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    ctx.restore();
  }

  // The word being spelled, in the reading letter, with the letters already
  // written lit and the current one ringed. On the word rung this strip is the
  // whole point: it is what tells a child that these four shapes are one thing.
  function drawWordStrip(box) {
    if (!box.word) return;
    const letters = box.word.letters;
    const size = Math.min(box.side * 0.24, 92);
    const step = size * 0.86;
    const y = inkTopY(box) - size * 1.1;
    const startX = box.cx - ((letters.length - 1) * step) / 2;

    ctx.save();
    ctx.font = `700 ${Math.round(size)}px Andika, "Baloo 2", system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    letters.forEach((ch, i) => {
      const x = startX + i * step;
      const done = i < box.word.index;
      const live = i === box.word.index;
      if (live) drawGlow(ctx, '#ffc24a', x, y, size * 0.62, 0.55);
      ctx.fillStyle = done ? mission.color : live ? '#fff6e5' : 'rgba(243,236,224,0.3)';
      ctx.fillText(ch, x, y);
    });
    ctx.restore();

    // The picture, small, next to the word: the reason the word was worth
    // writing.
    ctx.save();
    ctx.font = `${Math.round(size * 0.9)}px system-ui, sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(box.word.emoji, startX + letters.length * step - step * 0.3, y);
    ctx.restore();
  }

  // For shapes and single letters: what it is, spelled out under the box for
  // whoever can read it. Never the only cue — the dotted road is the instruction.
  function drawLabel(box) {
    if (box.word || !box.key) return;
    const label = cfg.kind === 'shape' ? SHAPES[box.key].label : String(box.key);
    const size = Math.min(box.side * 0.16, 64);
    ctx.save();
    ctx.font = cfg.kind === 'letter'
      ? `700 ${Math.round(size)}px Andika, "Baloo 2", system-ui, sans-serif`
      : `700 ${Math.round(size)}px "Baloo 2", system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(243,236,224,0.5)';
    ctx.fillText(label, box.cx, inkTopY(box) - size * 1.15);
    ctx.restore();
  }

  function update(dt) {
    t += dt;
    for (const box of boxes) {
      if (box.flare > 0) box.flare = Math.max(0, box.flare - dt * 1.6);
    }
  }

  function draw(dt) {
    drawSpaceBackdrop(ctx, backdrop, t, { scrollSpeed: 3 });
    for (const box of boxes) {
      drawBox(box);
      drawWordStrip(box);
      drawLabel(box);
    }
    updateAndDrawParticles(ctx, particles, dt, { gravity: -30 });
  }

  // --- Input --------------------------------------------------------------

  const onDown = (e) => {
    if (finishing) return;
    const p = toLogical(e.clientX, e.clientY);
    const box = boxAt(p);
    if (!box || box.pointerId !== null) return;
    const local = toBox(box, p);
    if (!canGrab(box, local)) return;
    box.pointerId = e.pointerId;
    canvas.setPointerCapture?.(e.pointerId);
    advance(box, local);
  };

  const onMove = (e) => {
    for (const box of boxes) {
      if (box.pointerId !== e.pointerId) continue;
      const local = toBox(box, toLogical(e.clientX, e.clientY));
      advance(box, local);
      return;
    }
  };

  const onUp = (e) => {
    for (const box of boxes) {
      if (box.pointerId === e.pointerId) box.pointerId = null;
    }
  };

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  listeners.push(() => {
    canvas.removeEventListener('pointerdown', onDown);
    canvas.removeEventListener('pointermove', onMove);
    canvas.removeEventListener('pointerup', onUp);
    canvas.removeEventListener('pointercancel', onUp);
  });

  startLevel();

  let last = performance.now();
  function loop(now) {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    update(dt);
    draw(dt);
    raf = requestAnimationFrame(loop);
  }
  raf = requestAnimationFrame(loop);
}

export function destroy() {
  if (raf) cancelAnimationFrame(raf);
  raf = null;
  timers.forEach(clearTimeout);
  timers = [];
  listeners.forEach((off) => off());
  listeners = [];
  handle?.disconnect();
  handle = null;
  reward?.close();
  reward = null;
  hud?.destroy();
  hud = null;
  stage = null;
}
