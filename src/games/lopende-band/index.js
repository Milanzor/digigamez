import './style.css';
import { createHud, showMissionComplete } from '../../shared/ui-components.js';
import {
  setupCanvas, LOGICAL_WIDTH, LOGICAL_HEIGHT,
  createStars, drawSpaceBackdrop, createBurst, updateAndDrawParticles,
  drawGlow, roundRect, withAlpha,
} from '../../shared/canvas-utils.js';
import { sfx } from '../../shell/audio.js';
import { setLevel, starsForLevel } from '../../shell/progress.js';

// "Lopende Band" — cargo rides past on a belt; drag each crate into the airlock
// that wants it.
//
// This is the classification gap. Sterrenvormen matches a shape to its hole,
// which is a fit; nothing in the archive asked a child to decide which
// *property* of a thing puts it with the others. So the ladder moves the
// property rather than the difficulty: colour, then shape, then size, then two
// properties at once, then how many dots are on the lid, and finally — the rung
// that used to be its own candidate game — which crate continues the pattern.
//
// Three rules hold it together:
//
// - **An airlock is its own instruction.** Each one is drawn as the thing it
//   wants, so there is nothing to read (the written line at the bottom is for
//   whoever can read, never the only copy).
// - **A crate you got wrong bounces back onto the belt.** No counter goes down,
//   nothing is taken away; the crate simply comes round again.
// - **A crate that reaches the end comes round again too.** The belt is a loop,
//   so there is no way to lose cargo by being slow — which is the whole reason
//   the belt is allowed to speed up at all.

const COLORS = [
  { name: 'rood', hex: '#ff6b6b' },
  { name: 'blauw', hex: '#8fd6ff' },
  { name: 'geel', hex: '#ffc24a' },
  { name: 'groen', hex: '#7ee787' },
];

const SHAPES = ['circle', 'square', 'triangle'];
const SIZE_PX = [104, 140, 182];

// Six rungs; the level ladder clamps to the last one, the way Zuurstofleidingen
// does with its six grids.
const LEVELS = [
  { rule: 'kleur', bins: 2, speed: 90, quota: 6 },
  { rule: 'vorm', bins: 3, speed: 105, quota: 8 },
  { rule: 'grootte', bins: 3, speed: 120, quota: 8 },
  { rule: 'combi', bins: 4, speed: 130, quota: 8 },
  { rule: 'aantal', bins: 3, speed: 140, quota: 8 },
  { rule: 'patroon', bins: 2, speed: 130, quota: 10 },
];

const BELT_Y = 858;
const BELT_H = 96;
const BIN_TOP = 214;
const BIN_H = 380;

let hud = null;
let handle = null;
let raf = null;
let listeners = [];
let timers = [];
let reward = null;
let stage = null;
let level = 1;
let slug = 'lopende-band';
let mission = null;
let onExit = null;

const randInt = (n) => Math.floor(Math.random() * n);
const pick = (arr) => arr[randInt(arr.length)];

function later(fn, ms) {
  const id = setTimeout(fn, ms);
  timers.push(id);
  return id;
}

// --- Crate faces as sprites ----------------------------------------------

// A crate is a rounded box with a shape or a row of dots on its lid, and there
// are at most a few dozen distinct combinations — so each face is drawn once
// into an offscreen canvas and blitted after that. Same rule as the marble in
// the Gekke Machine: anything that repeats is a sprite, not a drawing.
const faceCache = new Map();

function crateFace(desc) {
  const key = `${desc.color}|${desc.shape}|${desc.size}|${desc.dots}`;
  let sprite = faceCache.get(key);
  if (sprite) return sprite;

  const px = 256;
  sprite = document.createElement('canvas');
  sprite.width = px;
  sprite.height = px;
  const g = sprite.getContext('2d');
  const hex = COLORS[desc.color].hex;

  // Body: the colour, but muted, so the mark on the lid stays the brightest
  // thing on the crate even when the rule is about colour.
  g.fillStyle = withAlpha(hex, 0.9);
  roundRect(g, px * 0.06, px * 0.1, px * 0.88, px * 0.8, px * 0.12);
  g.fill();
  g.strokeStyle = 'rgba(5,7,15,0.35)';
  g.lineWidth = px * 0.035;
  g.stroke();

  // Lid band across the top, so a stack of crates still reads as crates.
  g.fillStyle = 'rgba(5,7,15,0.22)';
  roundRect(g, px * 0.06, px * 0.1, px * 0.88, px * 0.2, px * 0.1);
  g.fill();

  const cx = px / 2;
  const cy = px * 0.58;
  const r = px * 0.2;
  g.fillStyle = '#f6f1e6';

  if (desc.dots > 0) {
    // Dots in a row, and from four onwards in two rows of at most three —
    // a shape a child can take in without counting one by one.
    const perRow = desc.dots > 3 ? Math.ceil(desc.dots / 2) : desc.dots;
    const rows = desc.dots > 3 ? 2 : 1;
    const dr = px * 0.075;
    for (let row = 0; row < rows; row++) {
      const inRow = Math.min(perRow, desc.dots - row * perRow);
      for (let i = 0; i < inRow; i++) {
        const x = cx + (i - (inRow - 1) / 2) * dr * 2.6;
        const y = cy + (row - (rows - 1) / 2) * dr * 2.6;
        g.beginPath();
        g.arc(x, y, dr, 0, Math.PI * 2);
        g.fill();
      }
    }
  } else if (desc.shape === 0) {
    g.beginPath();
    g.arc(cx, cy, r, 0, Math.PI * 2);
    g.fill();
  } else if (desc.shape === 1) {
    roundRect(g, cx - r, cy - r, r * 2, r * 2, r * 0.22);
    g.fill();
  } else {
    g.beginPath();
    g.moveTo(cx, cy - r * 1.1);
    g.lineTo(cx + r * 1.05, cy + r * 0.8);
    g.lineTo(cx - r * 1.05, cy + r * 0.8);
    g.closePath();
    g.fill();
  }

  faceCache.set(key, sprite);
  return sprite;
}

// --- Bins ----------------------------------------------------------------

// Each rung builds its own set of airlocks, and each airlock carries both the
// test (`wants`) and the drawing of that test. Keeping them in one object is
// what guarantees the picture on the front and the rule behind it can never
// drift apart.
function buildBins(cfg) {
  const bins = [];

  if (cfg.rule === 'kleur') {
    [0, 1].forEach((c) => bins.push({
      kind: 'kleur', color: c,
      wants: (d) => d.color === c,
    }));
  } else if (cfg.rule === 'vorm') {
    [0, 1, 2].forEach((s) => bins.push({
      kind: 'vorm', shape: s,
      wants: (d) => d.shape === s,
    }));
  } else if (cfg.rule === 'grootte') {
    [0, 1, 2].forEach((s) => bins.push({
      kind: 'grootte', size: s,
      wants: (d) => d.size === s,
    }));
  } else if (cfg.rule === 'combi') {
    [0, 1].forEach((c) => [0, 1].forEach((s) => bins.push({
      kind: 'combi', color: c, shape: s,
      wants: (d) => d.color === c && d.shape === s,
    })));
  } else if (cfg.rule === 'aantal') {
    [1, 2, 3].forEach((n) => bins.push({
      kind: 'aantal', dots: n,
      wants: (d) => d.dots === n,
    }));
  } else {
    // The pattern rung. Each airlock runs its own repeating rhythm of colours
    // and wants whichever one comes next. It starts with a few already
    // delivered, drawn as chips on the front — a pattern you cannot see is a
    // guess, and this is meant to be readable, not psychic.
    const rhythms = [[0, 1], [2, 2, 3], [0, 3, 1]];
    const chosen = [];
    for (let i = 0; i < 2; i++) {
      let r = pick(rhythms);
      for (let guard = 0; guard < 8 && chosen.some((c) => c.join() === r.join()); guard++) r = pick(rhythms);
      chosen.push(r);
    }
    chosen.forEach((rhythm) => {
      const bin = {
        kind: 'patroon',
        rhythm,
        filled: rhythm.length + 1,
        wants: (d) => d.color === bin.rhythm[bin.filled % bin.rhythm.length],
      };
      bins.push(bin);
    });
  }

  return bins;
}

// A crate that belongs in `bin`, for the rung in play. Built from the bin
// rather than filtered towards it, so the belt can always be guaranteed to
// carry something sortable.
function crateFor(bin, cfg) {
  const desc = { color: randInt(COLORS.length), shape: randInt(SHAPES.length), size: 1, dots: 0 };

  if (cfg.rule === 'kleur') {
    desc.color = bin.color;
    desc.shape = 0;
  } else if (cfg.rule === 'vorm') {
    desc.shape = bin.shape;
  } else if (cfg.rule === 'grootte') {
    // One colour and one shape, so size is the only thing left to go on.
    desc.size = bin.size;
    desc.color = 2;
    desc.shape = 1;
  } else if (cfg.rule === 'combi') {
    desc.color = bin.color;
    desc.shape = bin.shape;
  } else if (cfg.rule === 'aantal') {
    desc.dots = bin.dots;
    desc.color = randInt(2) === 0 ? 1 : 3;
  } else {
    desc.color = bin.rhythm[bin.filled % bin.rhythm.length];
    desc.shape = 0;
  }
  return desc;
}

export function init(container, opts) {
  slug = opts.slug;
  level = Math.max(1, opts.startLevel || 1);
  mission = { title: opts.title, icon: opts.icon, color: opts.color };
  onExit = opts.onExit;
  // `players` is deliberately not read: the belt is one shared surface with one
  // shared counter, so a second child needs no zone, no turn and no second
  // score — they just put a hand on the glass.
  reward = null;
  listeners = [];
  timers = [];

  hud = createHud(container, {
    title: opts.title,
    onExit: opts.onExit,
    level,
    meter: 'Vracht',
  });

  stage = document.createElement('div');
  stage.className = 'belt-stage';
  const canvas = document.createElement('canvas');
  canvas.className = 'belt-canvas';
  const hint = document.createElement('div');
  hint.className = 'hint-line belt-hint';
  stage.append(canvas, hint);
  container.appendChild(stage);

  handle = setupCanvas(canvas, { alpha: false });
  const { ctx, toLogical } = handle;
  const backdrop = createStars(80);

  let cfg = LEVELS[0];
  let bins = [];
  let crates = [];
  let particles = [];
  let sorted = 0;
  let t = 0;
  let beltPhase = 0;
  let finishing = false;
  const grabs = new Map();

  const HINTS = {
    kleur: 'Sleep elke kist naar de sluis met dezelfde kleur',
    vorm: 'Kijk naar de vorm op het deksel — de kleur doet niet mee',
    grootte: 'Klein, midden of groot: sleep naar de juiste sluis',
    combi: 'Nu moeten kleur én vorm kloppen',
    aantal: 'Tel de stippen op het deksel',
    patroon: 'Welke kist komt hierna in het ritme?',
  };

  // Airlocks are sized to their contents and the row is centred, rather than
  // stretched across the screen. Two bins stretched to a full 1920 gave a pair of
  // near-metre-wide panels with a small symbol adrift in each — the panel has to
  // read as a chute the crate goes into, and a chute is about as wide as a crate.
  // Cargo is dealt to the airlocks in rotation rather than at random. Random
  // dealt a belt of four blue crates often enough to matter — one airlock in six
  // openings had nothing to do, which reads as a board that is broken rather than
  // as luck. Rotating keeps every airlock supplied; which crate arrives when is
  // still not predictable, because the belt interleaves them.
  let spawnTurn = 0;
  function nextBin() {
    spawnTurn = (spawnTurn + 1) % bins.length;
    return bins[spawnTurn];
  }

  function binRect(i) {
    const gap = 40;
    const w = Math.min(330, (LOGICAL_WIDTH - 150 - gap * (bins.length - 1)) / bins.length);
    const totalW = bins.length * w + (bins.length - 1) * gap;
    return { x: (LOGICAL_WIDTH - totalW) / 2 + i * (w + gap), y: BIN_TOP, w, h: BIN_H };
  }

  function spawnCrate(desc, atX) {
    crates.push({
      desc,
      x: atX,
      y: BELT_Y,
      held: null,
      grabDx: 0,
      grabDy: 0,
      // Set while a crate is on its way home or bouncing back, so the belt
      // leaves it alone until it has landed.
      settle: 0,
      shake: 0,
      gone: 0,
    });
  }

  // Keeps the belt stocked. Every crate is built from some airlock's own rule,
  // so a crate that belongs nowhere cannot be dealt in the first place — and the
  // second condition covers the one rung where that can still go stale: on the
  // pattern rung a delivery moves an airlock's rhythm on, so cargo that was
  // wanted a moment ago no longer is. If nothing on the belt can go anywhere,
  // the cap is ignored and a fresh crate is sent in regardless.
  function restock() {
    const live = crates.filter((c) => !c.gone);
    const cap = 4 + Math.min(2, bins.length - 2);
    const sortable = live.some((c) => bins.some((b) => b.wants(c.desc)));
    if (live.length >= cap && sortable) return;

    const leftMost = Math.min(...live.map((c) => c.x), LOGICAL_WIDTH);
    spawnCrate(crateFor(nextBin(), cfg), Math.min(-140, leftMost - 260));
  }

  function startLevel() {
    cfg = LEVELS[Math.min(level, LEVELS.length) - 1];
    bins = buildBins(cfg);
    crates = [];
    particles = [];
    sorted = 0;
    finishing = false;
    grabs.clear();
    hud.setLevel(level);
    hud.setMeter(0);
    hint.textContent = HINTS[cfg.rule];
    // Spread across the visible belt rather than queued up off the left edge:
    // restock() sends new cargo in from outside the screen, which is right for
    // a belt that is already running but would open the level with four seconds
    // of empty conveyor.
    spawnTurn = 0;
    for (let i = 0; i < 4; i++) spawnCrate(crateFor(nextBin(), cfg), 240 + i * 340);
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
      title: 'Alle vracht gesorteerd! 🗂️',
      onNext: () => { reward = null; startLevel(); },
      onRetry: () => { reward = null; level = cleared; startLevel(); },
      onHome: onExit,
    });
  }

  function crateSize(c) {
    return SIZE_PX[c.desc.size];
  }

  function accept(bin, crate, i) {
    crate.gone = 0.001;
    sorted += 1;
    if (bin.kind === 'patroon') bin.filled += 1;
    bin.flash = 1;
    sfx.chime(sorted - 1);
    const r = binRect(i);
    particles.push(...createBurst(r.x + r.w / 2, r.y + r.h * 0.75, [COLORS[crate.desc.color].hex, '#ffffff'], {
      count: 12, speed: 220,
    }));
    hud.setMeter(sorted / cfg.quota);
    if (sorted >= cfg.quota) later(() => finishLevel(), 700);
  }

  function reject(bin, crate, i) {
    // Bounces back to the belt and rides round again. `bounce` rather than
    // `deny`: a wrong guess here costs a lap, and a buzzer would tell a
    // four-year-old they broke something.
    bin.shake = 1;
    crate.settle = 1;
    crate.shake = 1;
    sfx.bounce();
  }

  function drop(crate) {
    const size = crateSize(crate);
    const cx = crate.x;
    const cy = crate.y;
    for (let i = 0; i < bins.length; i++) {
      const r = binRect(i);
      // Generous: the crate counts as delivered if its middle is anywhere over
      // the airlock, including the run-up above it.
      if (cx < r.x - size * 0.2 || cx > r.x + r.w + size * 0.2) continue;
      if (cy > r.y + r.h + size * 0.5) continue;
      if (bins[i].wants(crate.desc)) accept(bins[i], crate, i);
      else reject(bins[i], crate, i);
      return;
    }
    // Let go over open space: it drops back to the belt.
    crate.settle = 1;
  }

  function update(dt) {
    t += dt;
    beltPhase = (beltPhase + cfg.speed * dt) % 96;

    for (const b of bins) {
      if (b.flash) b.flash = Math.max(0, b.flash - dt * 2.2);
      if (b.shake) b.shake = Math.max(0, b.shake - dt * 2.6);
    }

    for (let i = crates.length - 1; i >= 0; i--) {
      const c = crates[i];
      if (c.gone) {
        c.gone = Math.min(1, c.gone + dt * 3.4);
        if (c.gone >= 1) crates.splice(i, 1);
        continue;
      }
      if (c.shake) c.shake = Math.max(0, c.shake - dt * 3);

      if (c.held !== null) continue;

      if (c.settle > 0) {
        // Falls back onto the belt rather than snapping, so a rejected crate is
        // visibly returned instead of teleported.
        c.settle = Math.max(0, c.settle - dt * 2.4);
        c.y += (BELT_Y - c.y) * Math.min(1, dt * 9);
        if (c.settle === 0) c.y = BELT_Y;
      } else {
        c.y = BELT_Y;
        c.x += cfg.speed * dt;
        // The belt is a loop: off the right-hand end is back on at the left.
        if (c.x > LOGICAL_WIDTH + 150) c.x = -150;
      }
    }

    restock();
  }

  // --- Drawing ------------------------------------------------------------

  function drawBelt() {
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    roundRect(ctx, 0, BELT_Y - BELT_H / 2, LOGICAL_WIDTH, BELT_H, 12);
    ctx.fill();
    ctx.strokeStyle = 'rgba(232,217,176,0.22)';
    ctx.lineWidth = 3;
    ctx.stroke();

    // Cleats sliding by: the only thing that tells a child the belt is moving
    // when every crate happens to be in somebody's hand.
    ctx.strokeStyle = 'rgba(232,217,176,0.16)';
    ctx.lineWidth = 8;
    ctx.beginPath();
    for (let x = -96 + beltPhase; x < LOGICAL_WIDTH + 96; x += 96) {
      ctx.moveTo(x, BELT_Y - BELT_H / 2 + 8);
      ctx.lineTo(x - 22, BELT_Y + BELT_H / 2 - 8);
    }
    ctx.stroke();
    ctx.restore();
  }

  // The rule, drawn. Each of these is the only instruction on screen for its
  // rung — the written line at the bottom of the board is a second copy for
  // whoever can read it, never the first.
  function drawBinFace(bin, r) {
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h * 0.46;
    const unit = Math.min(r.w, r.h) * 0.3;

    const shape = (x, y, s, kind, fill) => {
      ctx.fillStyle = fill;
      if (kind === 0) {
        ctx.beginPath();
        ctx.arc(x, y, s, 0, Math.PI * 2);
        ctx.fill();
      } else if (kind === 1) {
        roundRect(ctx, x - s, y - s, s * 2, s * 2, s * 0.22);
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.moveTo(x, y - s * 1.1);
        ctx.lineTo(x + s * 1.05, y + s * 0.8);
        ctx.lineTo(x - s * 1.05, y + s * 0.8);
        ctx.closePath();
        ctx.fill();
      }
    };

    if (bin.kind === 'kleur') {
      // A crate in that colour, not an abstract swatch: "crates like this go in
      // here" is the sentence, and a lid makes it one.
      const hex = COLORS[bin.color].hex;
      drawGlow(ctx, hex, cx, cy, unit * 1.9, 0.7);
      ctx.fillStyle = withAlpha(hex, 0.9);
      roundRect(ctx, cx - unit, cy - unit * 0.9, unit * 2, unit * 1.8, unit * 0.26);
      ctx.fill();
      ctx.fillStyle = 'rgba(5,7,15,0.22)';
      roundRect(ctx, cx - unit, cy - unit * 0.9, unit * 2, unit * 0.45, unit * 0.22);
      ctx.fill();
    } else if (bin.kind === 'vorm') {
      // Cream, not a colour: at this rung the colour of a crate is noise, and a
      // coloured silhouette would quietly reintroduce it as the rule.
      shape(cx, cy, unit, bin.shape, '#f3ece0');
    } else if (bin.kind === 'grootte') {
      const s = [unit * 0.42, unit * 0.72, unit][bin.size];
      shape(cx, cy, s, 1, '#ffc24a');
      // The two sizes it is *not*, as hairline ghosts, so "middle" has
      // something to be in the middle of.
      ctx.strokeStyle = 'rgba(243,236,224,0.2)';
      ctx.lineWidth = 3;
      [unit * 0.42, unit * 0.72, unit].forEach((g, i) => {
        if (i === bin.size) return;
        ctx.beginPath();
        ctx.rect(cx - g, cy - g, g * 2, g * 2);
        ctx.stroke();
      });
    } else if (bin.kind === 'combi') {
      drawGlow(ctx, COLORS[bin.color].hex, cx, cy, unit * 1.8, 0.6);
      shape(cx, cy, unit * 0.92, bin.shape, COLORS[bin.color].hex);
    } else if (bin.kind === 'aantal') {
      const dr = unit * 0.24;
      for (let i = 0; i < bin.dots; i++) {
        const x = cx + (i - (bin.dots - 1) / 2) * dr * 2.7;
        ctx.fillStyle = '#f3ece0';
        ctx.beginPath();
        ctx.arc(x, cy, dr, 0, Math.PI * 2);
        ctx.fill();
      }
      // And the numeral next to the dots, the same bridge Ladingcontrole builds:
      // the amount stated twice, once to count and once to read.
      ctx.save();
      ctx.font = `700 ${Math.round(unit * 0.8)}px "Baloo 2", system-ui, sans-serif`;
      ctx.fillStyle = 'rgba(243,236,224,0.55)';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(bin.dots), cx, cy + unit * 1.05);
      ctx.restore();
    } else {
      // The rhythm so far, then a pulsing socket for what comes next.
      const chips = 3;
      const cr = unit * 0.34;
      const step = cr * 2.5;
      const startX = cx - (chips * step) / 2;
      for (let i = 0; i < chips; i++) {
        const idx = bin.filled - chips + i;
        const col = COLORS[bin.rhythm[((idx % bin.rhythm.length) + bin.rhythm.length) % bin.rhythm.length]];
        ctx.fillStyle = withAlpha(col.hex, 0.9);
        ctx.beginPath();
        ctx.arc(startX + i * step + cr, cy, cr, 0, Math.PI * 2);
        ctx.fill();
      }
      const qx = startX + chips * step + cr;
      ctx.save();
      ctx.strokeStyle = `rgba(255,194,74,${0.5 + Math.sin(t * 4) * 0.25})`;
      ctx.lineWidth = 5;
      ctx.setLineDash([10, 10]);
      ctx.beginPath();
      ctx.arc(qx, cy, cr, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      ctx.save();
      ctx.font = `800 ${Math.round(cr * 1.5)}px "Baloo 2", system-ui, sans-serif`;
      ctx.fillStyle = '#ffc24a';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('?', qx, cy + 2);
      ctx.restore();
    }
  }

  function drawBins() {
    bins.forEach((bin, i) => {
      const r = binRect(i);
      const shake = bin.shake ? Math.sin(bin.shake * 40) * 9 * bin.shake : 0;

      ctx.save();
      ctx.translate(shake, 0);

      if (bin.flash) drawGlow(ctx, '#ffc24a', r.x + r.w / 2, r.y + r.h / 2, r.w * 0.7, bin.flash * 0.6);

      ctx.fillStyle = 'rgba(255,255,255,0.035)';
      roundRect(ctx, r.x, r.y, r.w, r.h, 34);
      ctx.fill();
      ctx.strokeStyle = bin.flash
        ? `rgba(255,194,74,${0.3 + bin.flash * 0.6})`
        : 'rgba(232,217,176,0.22)';
      ctx.lineWidth = 3;
      ctx.stroke();

      drawBinFace(bin, r);

      // The mouth: a dark slot along the bottom edge so it reads as something
      // cargo goes *into* rather than a poster of a shape.
      ctx.fillStyle = 'rgba(5,7,15,0.55)';
      roundRect(ctx, r.x + r.w * 0.14, r.y + r.h - 30, r.w * 0.72, 44, 18);
      ctx.fill();
      ctx.strokeStyle = 'rgba(232,217,176,0.18)';
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.restore();
    });
  }

  function drawCrates() {
    for (const c of crates) {
      const size = crateSize(c);
      const sprite = crateFace(c.desc);
      const shake = c.shake ? Math.sin(c.shake * 44) * 7 * c.shake : 0;
      const scale = c.gone ? 1 - c.gone * 0.85 : 1;
      const alpha = c.gone ? 1 - c.gone : 1;

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(c.x + shake, c.y);
      ctx.scale(scale, scale);
      if (c.held !== null) {
        drawGlow(ctx, COLORS[c.desc.color].hex, 0, 0, size * 0.85, 0.7);
      }
      ctx.drawImage(sprite, -size / 2, -size / 2, size, size);
      ctx.restore();
      ctx.globalAlpha = 1;
    }
  }

  function draw(dt) {
    drawSpaceBackdrop(ctx, backdrop, t, { scrollSpeed: 3 });
    drawBins();
    drawBelt();
    drawCrates();
    updateAndDrawParticles(ctx, particles, dt, { gravity: -40 });
  }

  // --- Input --------------------------------------------------------------

  // Every crate is grabbed by its own pointer id, so two children can each be
  // carrying one at the same time. There is one shared counter and no split
  // zones: with ten fingers on the same glass there is no fair way to say whose
  // finger arrived first, which is the same conclusion Meteoor Meppen reached.
  const onDown = (e) => {
    if (finishing) return;
    const p = toLogical(e.clientX, e.clientY);
    // Topmost first, so overlapping crates hand over the one on top.
    for (let i = crates.length - 1; i >= 0; i--) {
      const c = crates[i];
      if (c.gone || c.held !== null) continue;
      const size = crateSize(c) * 0.62;
      if (Math.abs(p.x - c.x) > size || Math.abs(p.y - c.y) > size) continue;
      c.held = e.pointerId;
      c.grabDx = c.x - p.x;
      c.grabDy = c.y - p.y;
      c.settle = 0;
      grabs.set(e.pointerId, c);
      canvas.setPointerCapture?.(e.pointerId);
      sfx.blip();
      // Carried crates are drawn last, which is also what puts them over the
      // airlock artwork while they are being aimed.
      crates.splice(i, 1);
      crates.push(c);
      return;
    }
  };

  const onMove = (e) => {
    const c = grabs.get(e.pointerId);
    if (!c) return;
    const p = toLogical(e.clientX, e.clientY);
    c.x = p.x + c.grabDx;
    c.y = p.y + c.grabDy;
  };

  const onUp = (e) => {
    const c = grabs.get(e.pointerId);
    if (!c) return;
    grabs.delete(e.pointerId);
    c.held = null;
    drop(c);
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
