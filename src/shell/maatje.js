// The shared buddy: one creature, built in "Maak je Maatje", that every other
// game is allowed to read.
//
// This is the module PLAN §6c held Maak je Maatje back for. The point of the
// game is not the dress-up screen, it is that the alien a child builds turns up
// again as the rover's pilot and on the crates of Ladingcontrole — that is what
// makes the hub feel like one world instead of twenty-four separate cupboards.
// Which is exactly why the format has to be decided once, up front: any game
// that leans on it wants the same fields to still be there next month.
//
// So the saved shape is deliberately dull — six small integers and two colours,
// no nesting, no versioning cleverness. `getMaatje` fills in anything missing
// from the defaults, so an older save (or a hand-edited localStorage) can never
// crash a game that reads it.

import { getItem, setItem } from './storage.js';

const SAVE_KEY = 'maatje';

// Parts are indices into these tables rather than names, so a game can `% length`
// its way to a valid part without knowing what the tables contain.
export const BODIES = ['blob', 'egg', 'box', 'star'];
export const EYES = ['two', 'one', 'three', 'sleepy'];
export const ANTENNAE = ['none', 'ball', 'pair', 'fan'];
export const ARMS = ['none', 'stubby', 'long', 'claw'];
export const MOUTHS = ['smile', 'oh', 'grin', 'beak'];

export const SKINS = ['#7ee787', '#8fd6ff', '#ff8fc7', '#b98cff', '#ffc24a', '#ff6b6b', '#5fe3c4'];
export const ACCENTS = ['#ffc24a', '#ff6b6b', '#5fe3c4', '#b98cff', '#f3ece0'];

export const DEFAULT_MAATJE = {
  body: 0,
  eyes: 0,
  antenna: 1,
  arms: 1,
  mouth: 0,
  skin: '#7ee787',
  accent: '#ffc24a',
};

const clampIndex = (value, list) => (
  Number.isInteger(value) && value >= 0 && value < list.length ? value : 0
);

const clampColor = (value, list, fallback) => (
  typeof value === 'string' && list.includes(value) ? value : fallback
);

// Always returns a drawable creature, whatever is (or isn't) in storage.
export function getMaatje() {
  const raw = getItem(SAVE_KEY, null);
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_MAATJE };
  return {
    body: clampIndex(raw.body, BODIES),
    eyes: clampIndex(raw.eyes, EYES),
    antenna: clampIndex(raw.antenna, ANTENNAE),
    arms: clampIndex(raw.arms, ARMS),
    mouth: clampIndex(raw.mouth, MOUTHS),
    skin: clampColor(raw.skin, SKINS, DEFAULT_MAATJE.skin),
    accent: clampColor(raw.accent, ACCENTS, DEFAULT_MAATJE.accent),
  };
}

export function saveMaatje(maatje) {
  setItem(SAVE_KEY, maatje);
}

// Whether a child has actually built one yet. A game uses this to decide
// between showing the buddy and showing its own generic mascot — turning up
// uninvited as the default green blob would undersell the reveal.
export function hasMaatje() {
  return getItem(SAVE_KEY, null) !== null;
}

// --- drawing --------------------------------------------------------------

// How far the drawing actually reaches from its centre, in units of `size`.
// A fan antenna goes up to -74 and a claw arm out to ±83 in the 100-unit space
// the parts are drawn in, so the creature is a good deal taller and wider than
// the `size` it is asked for — which is exactly the trap `drawMaatjeIn` exists
// to close. The first two callers both clipped the antenna off the top.
export const EXTENT = { up: 0.85, down: 0.48, side: 0.9 };

// Draws the creature to fit a box, and returns the size it used. Prefer this
// over `drawMaatje` unless the caller has already done the arithmetic: it is the
// difference between a buddy standing in its panel and a buddy with its antenna
// sliced off by the top edge.
export function drawMaatjeIn(ctx, m, cx, cy, boxW, boxH, t = 0) {
  const size = Math.min(boxW / (EXTENT.side * 2), boxH / (EXTENT.up + EXTENT.down));
  // The drawing is taller above its origin than below, so the origin has to sit
  // below the box's centre for the whole thing to land in the middle.
  const shift = ((EXTENT.up - EXTENT.down) / 2) * size;
  drawMaatje(ctx, m, cx, cy + shift, size, t);
  return size;
}

// Draws the creature centred on (x, y), `size` tall, into any game's canvas.
// `t` is the game's own clock: the blink and the antenna sway are derived from
// it rather than from a timer of their own, so the buddy animates without the
// host game having to know it is animated.
export function drawMaatje(ctx, m, x, y, size, t = 0) {
  const s = size / 100;
  const sway = Math.sin(t * 1.6) * 3;
  // Blink: shut for a tenth of a second roughly every four seconds.
  const blink = (t % 4) > 3.9;

  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);

  drawAntenna(ctx, m, sway);
  drawArms(ctx, m, t);
  drawBody(ctx, m);
  drawEyes(ctx, m, blink);
  drawMouth(ctx, m);

  ctx.restore();
}

function drawBody(ctx, m) {
  ctx.fillStyle = m.skin;
  ctx.beginPath();
  switch (BODIES[m.body]) {
    case 'egg':
      ctx.ellipse(0, 0, 34, 44, 0, 0, Math.PI * 2);
      break;
    case 'box':
      ctx.roundRect(-36, -38, 72, 76, 14);
      break;
    case 'star':
      for (let i = 0; i < 12; i++) {
        const r = i % 2 === 0 ? 46 : 32;
        const a = (Math.PI / 6) * i - Math.PI / 2;
        const px = Math.cos(a) * r;
        const py = Math.sin(a) * r;
        i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py);
      }
      ctx.closePath();
      break;
    default:
      // Blob: a circle with a heavier, wider bottom, which is what makes it
      // read as a creature standing there rather than as a ball.
      ctx.moveTo(-40, 6);
      ctx.bezierCurveTo(-44, -34, -20, -46, 0, -46);
      ctx.bezierCurveTo(20, -46, 44, -34, 40, 6);
      ctx.bezierCurveTo(40, 34, 22, 44, 0, 44);
      ctx.bezierCurveTo(-22, 44, -40, 34, -40, 6);
      ctx.closePath();
  }
  ctx.fill();

  // A single darker belly patch. Cheap, and it stops the silhouette reading
  // as a flat sticker.
  ctx.fillStyle = 'rgba(0,0,0,0.12)';
  ctx.beginPath();
  ctx.ellipse(0, 22, 20, 12, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawEyes(ctx, m, blink) {
  const white = '#f7f4ec';
  const eye = (ex, ey, r) => {
    ctx.fillStyle = white;
    ctx.beginPath();
    ctx.arc(ex, ey, r, 0, Math.PI * 2);
    ctx.fill();
    if (blink) {
      ctx.strokeStyle = '#1b1b28';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(ex - r * 0.7, ey);
      ctx.lineTo(ex + r * 0.7, ey);
      ctx.stroke();
      return;
    }
    ctx.fillStyle = '#1b1b28';
    ctx.beginPath();
    ctx.arc(ex + r * 0.16, ey + r * 0.1, r * 0.46, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.beginPath();
    ctx.arc(ex - r * 0.2, ey - r * 0.26, r * 0.16, 0, Math.PI * 2);
    ctx.fill();
  };

  switch (EYES[m.eyes]) {
    case 'one':
      eye(0, -12, 17);
      break;
    case 'three':
      eye(-18, -14, 9);
      eye(0, -22, 9);
      eye(18, -14, 9);
      break;
    case 'sleepy':
      ctx.strokeStyle = '#1b1b28';
      ctx.lineWidth = 4;
      for (const ex of [-14, 14]) {
        ctx.beginPath();
        ctx.arc(ex, -12, 10, Math.PI * 0.15, Math.PI * 0.85);
        ctx.stroke();
      }
      break;
    default:
      eye(-14, -12, 12);
      eye(14, -12, 12);
  }
}

function drawMouth(ctx, m) {
  ctx.strokeStyle = '#1b1b28';
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  switch (MOUTHS[m.mouth]) {
    case 'oh':
      ctx.fillStyle = '#1b1b28';
      ctx.beginPath();
      ctx.ellipse(0, 16, 7, 9, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'grin':
      ctx.fillStyle = '#1b1b28';
      ctx.beginPath();
      ctx.moveTo(-16, 10);
      ctx.quadraticCurveTo(0, 30, 16, 10);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#f7f4ec';
      ctx.beginPath();
      ctx.roundRect(-11, 10, 22, 5, 2);
      ctx.fill();
      break;
    case 'beak':
      ctx.fillStyle = m.accent;
      ctx.beginPath();
      ctx.moveTo(-11, 10);
      ctx.lineTo(11, 10);
      ctx.lineTo(0, 26);
      ctx.closePath();
      ctx.fill();
      break;
    default:
      ctx.beginPath();
      ctx.arc(0, 8, 14, Math.PI * 0.18, Math.PI * 0.82);
      ctx.stroke();
  }
}

function drawAntenna(ctx, m, sway) {
  const kind = ANTENNAE[m.antenna];
  if (kind === 'none') return;
  ctx.strokeStyle = m.skin;
  ctx.lineWidth = 5;
  ctx.lineCap = 'round';

  const stalk = (baseX, tipX, tipY, ballR) => {
    ctx.beginPath();
    ctx.moveTo(baseX, -38);
    ctx.quadraticCurveTo(baseX + (tipX - baseX) * 0.4, -58, tipX + sway, tipY);
    ctx.stroke();
    ctx.fillStyle = m.accent;
    ctx.beginPath();
    ctx.arc(tipX + sway, tipY, ballR, 0, Math.PI * 2);
    ctx.fill();
  };

  if (kind === 'ball') stalk(0, 0, -72, 9);
  if (kind === 'pair') {
    stalk(-14, -22, -68, 7);
    stalk(14, 22, -68, 7);
  }
  if (kind === 'fan') {
    stalk(-18, -30, -62, 5);
    stalk(0, 0, -74, 5);
    stalk(18, 30, -62, 5);
  }
}

function drawArms(ctx, m, t) {
  const kind = ARMS[m.arms];
  if (kind === 'none') return;
  const wave = Math.sin(t * 2.4) * 6;
  ctx.strokeStyle = m.skin;
  ctx.lineWidth = 7;
  ctx.lineCap = 'round';

  const len = kind === 'long' ? 40 : 22;
  for (const side of [-1, 1]) {
    const tipX = side * (34 + len);
    const tipY = 4 + (side > 0 ? wave : -wave);
    ctx.beginPath();
    ctx.moveTo(side * 30, 8);
    ctx.quadraticCurveTo(side * (30 + len * 0.6), 10, tipX, tipY);
    ctx.stroke();
    if (kind === 'claw') {
      ctx.fillStyle = m.accent;
      ctx.beginPath();
      ctx.arc(tipX, tipY, 9, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}
