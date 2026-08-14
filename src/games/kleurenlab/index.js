import './style.css';
import { createHud, showMissionComplete } from '../../shared/ui-components.js';
import {
  setupCanvas, LOGICAL_WIDTH,
  createStars, drawSpaceBackdrop, createBurst, updateAndDrawParticles,
  drawGlow, roundRect, withAlpha,
} from '../../shared/canvas-utils.js';
import { sfx } from '../../shell/audio.js';
import { setLevel, starsForLevel } from '../../shell/progress.js';

// "Kleurenlab" — point two or three beams into the chamber and see what colour
// comes out.
//
// Nothing in the archive mixed colours, and "geel en blauw maakt groen" is one of
// the few discoveries a four-year-old can make on a screen that transfers
// straight to a paint tray. The reason it is cheap to build is that colour costs
// nothing to render; the reason it is worth building is that it is the only
// mission here where the child finds something out rather than solves something.
//
// **Mixing happens in RYB, not RGB.** This is the whole technical decision. Add
// light and yellow plus blue is grey; a child mixing paint gets green, and the
// child is right about the world they live in. So each beam is a point in the
// red/yellow/blue cube, beams are averaged there, and the result is converted to
// RGB through the eight corners of that cube (Gosset & Chen's trilinear map).
// Yellow and blue land on green because the green corner is where the cube says
// they land.
//
// It is a discovery toy with a wish list rather than a free lab, and that is a
// deliberate step away from how it was first pitched. A mixer with no goal is a
// twenty-second toy on a classroom board — the wish list is what makes it worth
// coming back to. What keeps it from being a test is that the tolerance is wide,
// nothing is timed, nothing is ever wrong, and every wish is defined by a recipe
// the palette in play can actually make.

// The eight corners of the RYB cube in RGB. White at the origin, a dark neutral
// brown at (1,1,1) — which is also why grey turns out to be mixable at all.
const CORNERS = {
  w: [1, 1, 1],
  r: [1, 0, 0],
  y: [1, 1, 0],
  b: [0.163, 0.373, 0.6],
  ry: [1, 0.5, 0],
  rb: [0.5, 0, 0.5],
  yb: [0, 0.66, 0.2],
  ryb: [0.2, 0.094, 0],
};

function rybToRgb(r, y, b) {
  const f = [
    [(1 - r) * (1 - y) * (1 - b), CORNERS.w],
    [r * (1 - y) * (1 - b), CORNERS.r],
    [(1 - r) * y * (1 - b), CORNERS.y],
    [(1 - r) * (1 - y) * b, CORNERS.b],
    [r * y * (1 - b), CORNERS.ry],
    [r * (1 - y) * b, CORNERS.rb],
    [(1 - r) * y * b, CORNERS.yb],
    [r * y * b, CORNERS.ryb],
  ];
  const out = [0, 0, 0];
  for (const [w, c] of f) {
    out[0] += w * c[0];
    out[1] += w * c[1];
    out[2] += w * c[2];
  }
  return out;
}

const hexOf = (rgb) => `#${rgb.map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255)
  .toString(16).padStart(2, '0')).join('')}`;

// The paints. Coordinates in the RYB cube: white is the origin and black is the
// far corner, which is what makes a tint and a shade the same operation.
const PAINTS = {
  rood: { ryb: [1, 0, 0], label: 'rood' },
  geel: { ryb: [0, 1, 0], label: 'geel' },
  blauw: { ryb: [0, 0, 1], label: 'blauw' },
  wit: { ryb: [0, 0, 0], label: 'wit' },
  zwart: { ryb: [1, 1, 1], label: 'zwart' },
};

// Averages the paints in the chamber, weighted by how many drops of each. Drops
// are what let a level ask for something between two colours rather than only
// halfway.
function mixRyb(sources) {
  let total = 0;
  const acc = [0, 0, 0];
  for (const s of sources) {
    const paint = PAINTS[s.paint];
    if (!paint || s.drops <= 0) continue;
    total += s.drops;
    acc[0] += paint.ryb[0] * s.drops;
    acc[1] += paint.ryb[1] * s.drops;
    acc[2] += paint.ryb[2] * s.drops;
  }
  if (!total) return [0, 0, 0];
  return [acc[0] / total, acc[1] / total, acc[2] / total];
}

const mixRgb = (sources) => rybToRgb(...mixRyb(sources));

// Every wish is a recipe, so a wish that cannot be made cannot be asked for.
// The child never sees the recipe — only the colour and its name.
const LEVELS = [
  {
    palette: ['rood', 'geel', 'blauw'], emitters: 2, drops: false,
    wishes: [
      { name: 'oranje', recipe: [['rood', 1], ['geel', 1]] },
      { name: 'groen', recipe: [['geel', 1], ['blauw', 1]] },
      { name: 'paars', recipe: [['rood', 1], ['blauw', 1]] },
    ],
  },
  {
    palette: ['rood', 'geel', 'blauw', 'wit'], emitters: 2, drops: false,
    wishes: [
      { name: 'roze', recipe: [['rood', 1], ['wit', 1]] },
      { name: 'lichtblauw', recipe: [['blauw', 1], ['wit', 1]] },
      { name: 'zachtgeel', recipe: [['geel', 1], ['wit', 1]] },
    ],
  },
  {
    palette: ['rood', 'geel', 'blauw', 'wit', 'zwart'], emitters: 2, drops: true,
    wishes: [
      { name: 'limoen', recipe: [['geel', 3], ['blauw', 1]] },
      { name: 'zeegroen', recipe: [['geel', 1], ['blauw', 3]] },
      { name: 'donkerblauw', recipe: [['blauw', 3], ['zwart', 1]] },
    ],
  },
  {
    palette: ['rood', 'geel', 'blauw', 'wit', 'zwart'], emitters: 3, drops: false,
    wishes: [
      { name: 'zandbruin', recipe: [['rood', 1], ['geel', 1], ['blauw', 1]] },
      { name: 'goudgeel', recipe: [['rood', 1], ['geel', 1], ['geel', 1]] },
      { name: 'lila', recipe: [['rood', 1], ['blauw', 1], ['wit', 1]] },
    ],
  },
  {
    palette: ['rood', 'geel', 'blauw', 'wit', 'zwart'], emitters: 3, drops: true,
    wishes: [
      { name: 'perzik', recipe: [['rood', 1], ['geel', 1], ['wit', 2]] },
      { name: 'grijs', recipe: [['rood', 1], ['geel', 1], ['blauw', 2]] },
      { name: 'mosgroen', recipe: [['geel', 1], ['blauw', 3], ['zwart', 1]] },
    ],
  },
];

// Wide on purpose. A child who has the idea right should be told they are right,
// and hunting the last few percent of a colour match is a different game from the
// one this is meant to be.
const TOLERANCE = 0.1;

const recipeRgb = (recipe) => mixRgb(recipe.map(([paint, drops]) => ({ paint, drops })));

let hud = null;
let handle = null;
let raf = null;
let listeners = [];
let timers = [];
let reward = null;
let stage = null;
let level = 1;
let slug = 'kleurenlab';
let mission = null;
let onExit = null;

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

  hud = createHud(container, {
    title: opts.title,
    onExit: opts.onExit,
    level,
    meter: 'Wensen',
  });

  stage = document.createElement('div');
  stage.className = 'lab-stage';
  const canvas = document.createElement('canvas');
  canvas.className = 'lab-canvas';
  const hint = document.createElement('div');
  hint.className = 'hint-line lab-hint';
  stage.append(canvas, hint);
  container.appendChild(stage);

  handle = setupCanvas(canvas, { alpha: false });
  const { ctx, toLogical } = handle;
  const backdrop = createStars(70);

  let cfg = LEVELS[0];
  let sources = [];
  let wishes = [];
  let particles = [];
  let finishing = false;
  let t = 0;
  let pulse = 0;

  const MID = LOGICAL_WIDTH / 2;
  const PLANET = { x: MID, y: 470, r: 168 };

  function emitterSpot(i) {
    const n = sources.length;
    return { x: MID + (i - (n - 1) / 2) * 336, y: 830, r: 74 };
  }

  function dropsSpot(i) {
    const e = emitterSpot(i);
    return { x: e.x, y: e.y + e.r + 52, w: 132, h: 62 };
  }

  function wishSpot(i) {
    const n = wishes.length;
    const w = 246;
    const gap = 26;
    const totalW = n * w + (n - 1) * gap;
    return { x: MID - totalW / 2 + i * (w + gap), y: 178, w, h: 118 };
  }

  function startLevel() {
    cfg = LEVELS[Math.min(level, LEVELS.length) - 1];
    sources = Array.from({ length: cfg.emitters }, (_, i) => ({
      // A different paint per beam, so the chamber opens on an actual mix rather
      // than on three reds making red. Seeing that two colours went in and a
      // third came out is the entire idea, and it should not need a tap first.
      paint: cfg.palette[i % cfg.palette.length],
      drops: 1,
      paletteIndex: i % cfg.palette.length,
      flash: 0,
    }));
    wishes = cfg.wishes.map((w) => ({ ...w, rgb: recipeRgb(w.recipe), got: false, pop: 0 }));
    particles = [];
    finishing = false;
    hud.setLevel(level);
    hud.setMeter(0);
    hint.textContent = cfg.drops
      ? 'Tik op een straal om van kleur te wisselen — en op de druppels voor méér'
      : 'Tik op een straal om van kleur te wisselen';
    // Also sets the meter, and means a wish that happened to match the opening
    // mix could never sit there uncollectable.
    checkWishes();
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
      title: 'Alle kleuren gemengd! 🧪',
      onNext: () => { reward = null; startLevel(); },
      onRetry: () => { reward = null; level = cleared; startLevel(); },
      onHome: onExit,
    });
  }

  // Checked on every change rather than on a button: the point of the toy is that
  // the answer appears while you are turning the dial.
  function checkWishes() {
    const mix = mixRgb(sources);
    let hit = false;
    wishes.forEach((wish, i) => {
      if (wish.got) return;
      const d = Math.hypot(mix[0] - wish.rgb[0], mix[1] - wish.rgb[1], mix[2] - wish.rgb[2]);
      if (d > TOLERANCE) return;
      wish.got = true;
      wish.pop = 1;
      hit = true;
      const s = wishSpot(i);
      particles.push(...createBurst(s.x + s.w / 2, s.y + s.h / 2, [hexOf(wish.rgb), '#ffffff'], {
        count: 16, speed: 240,
      }));
    });

    if (!hit) return;
    pulse = 1;
    const got = wishes.filter((w) => w.got).length;
    sfx.chime(got - 1);
    hud.setMeter(got / wishes.length);
    if (got === wishes.length) later(() => finishLevel(), 900);
  }

  // --- Drawing ------------------------------------------------------------

  function drawBeams() {
    sources.forEach((s, i) => {
      const e = emitterSpot(i);
      const paint = PAINTS[s.paint];
      const hex = hexOf(rybToRgb(...paint.ryb));
      const a = Math.atan2(PLANET.y - e.y, PLANET.x - e.x);
      const x0 = e.x + Math.cos(a) * e.r;
      const y0 = e.y + Math.sin(a) * e.r;
      const x1 = PLANET.x - Math.cos(a) * PLANET.r * 0.92;
      const y1 = PLANET.y - Math.sin(a) * PLANET.r * 0.92;

      ctx.save();
      ctx.lineCap = 'round';
      // Thickness is the dose: three drops is visibly a fatter beam, which is
      // the drops control saying the same thing a second way.
      const width = 14 + s.drops * 9;
      ctx.strokeStyle = withAlpha(hex, 0.18);
      ctx.lineWidth = width * 2.4;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
      ctx.strokeStyle = withAlpha(hex, 0.85);
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
      ctx.restore();
    });
  }

  function drawPlanet() {
    const mix = mixRgb(sources);
    const hex = hexOf(mix);
    const r = PLANET.r * (1 + pulse * 0.06);

    drawGlow(ctx, hex, PLANET.x, PLANET.y, r * 1.7, 0.85);
    ctx.save();
    ctx.fillStyle = hex;
    ctx.beginPath();
    ctx.arc(PLANET.x, PLANET.y, r, 0, Math.PI * 2);
    ctx.fill();

    // A soft highlight so it reads as a globe of gas and not a flat disc — and
    // so a very dark mix still has a shape.
    const g = ctx.createRadialGradient(
      PLANET.x - r * 0.35, PLANET.y - r * 0.4, r * 0.05,
      PLANET.x, PLANET.y, r,
    );
    g.addColorStop(0, 'rgba(255,255,255,0.35)');
    g.addColorStop(0.55, 'rgba(255,255,255,0.04)');
    g.addColorStop(1, 'rgba(5,7,15,0.28)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(PLANET.x, PLANET.y, r, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = 'rgba(243,236,224,0.24)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(PLANET.x, PLANET.y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  function drawEmitters() {
    sources.forEach((s, i) => {
      const e = emitterSpot(i);
      const paint = PAINTS[s.paint];
      const hex = hexOf(rybToRgb(...paint.ryb));

      drawGlow(ctx, hex, e.x, e.y, e.r * 1.5, 0.55 + s.flash * 0.4);
      ctx.save();
      ctx.fillStyle = hex;
      ctx.beginPath();
      ctx.arc(e.x, e.y, e.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(243,236,224,0.34)';
      ctx.lineWidth = 4;
      ctx.stroke();

      // Which paints this level has, as a ring of pips around the nozzle: the
      // child can see there is more to try without any of it being written down.
      cfg.palette.forEach((key, p) => {
        const a = -Math.PI / 2 + (p / cfg.palette.length) * Math.PI * 2;
        const px = e.x + Math.cos(a) * (e.r + 26);
        const py = e.y + Math.sin(a) * (e.r + 26);
        const active = p === s.paletteIndex;
        ctx.fillStyle = hexOf(rybToRgb(...PAINTS[key].ryb));
        ctx.beginPath();
        ctx.arc(px, py, active ? 11 : 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = active ? 'rgba(255,194,74,0.95)' : 'rgba(243,236,224,0.22)';
        ctx.lineWidth = active ? 4 : 2;
        ctx.stroke();
      });
      ctx.restore();

      if (!cfg.drops) return;

      // The dose, as drops. Tappable, and drawn as one, two or three drops
      // rather than as a numeral.
      const d = dropsSpot(i);
      ctx.save();
      ctx.fillStyle = 'rgba(255,255,255,0.05)';
      roundRect(ctx, d.x - d.w / 2, d.y - d.h / 2, d.w, d.h, 24);
      ctx.fill();
      ctx.strokeStyle = 'rgba(232,217,176,0.24)';
      ctx.lineWidth = 3;
      ctx.stroke();
      for (let k = 0; k < 3; k++) {
        const on = k < s.drops;
        const x = d.x + (k - 1) * 34;
        ctx.fillStyle = on ? hex : 'rgba(243,236,224,0.16)';
        ctx.beginPath();
        // A teardrop: a circle with a point on top.
        ctx.moveTo(x, d.y - 17);
        ctx.quadraticCurveTo(x + 12, d.y - 2, x + 11, d.y + 4);
        ctx.arc(x, d.y + 4, 11, 0, Math.PI);
        ctx.quadraticCurveTo(x - 12, d.y - 2, x, d.y - 17);
        ctx.fill();
      }
      ctx.restore();
    });
  }

  function drawWishes() {
    wishes.forEach((wish, i) => {
      const s = wishSpot(i);
      const hex = hexOf(wish.rgb);
      const lift = wish.pop * 8;

      ctx.save();
      ctx.translate(0, -lift);
      if (wish.got) drawGlow(ctx, '#ffc24a', s.x + s.w / 2, s.y + s.h / 2, s.w * 0.6, 0.35 + wish.pop * 0.4);

      ctx.fillStyle = 'rgba(255,255,255,0.04)';
      roundRect(ctx, s.x, s.y, s.w, s.h, 28);
      ctx.fill();
      ctx.strokeStyle = wish.got ? 'rgba(255,194,74,0.75)' : 'rgba(232,217,176,0.2)';
      ctx.lineWidth = 3;
      ctx.stroke();

      const cx = s.x + 54;
      const cy = s.y + s.h / 2;
      drawGlow(ctx, hex, cx, cy, 52, 0.5);
      ctx.fillStyle = hex;
      ctx.beginPath();
      ctx.arc(cx, cy, 34, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(243,236,224,0.3)';
      ctx.lineWidth = 3;
      ctx.stroke();

      ctx.font = '700 34px "Baloo 2", system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = wish.got ? '#fff6e5' : 'rgba(243,236,224,0.72)';
      ctx.fillText(wish.name, s.x + 100, cy + 2);

      if (wish.got) {
        ctx.font = '700 40px "Baloo 2", system-ui, sans-serif';
        ctx.fillStyle = '#ffc24a';
        ctx.textAlign = 'right';
        ctx.fillText('✓', s.x + s.w - 18, cy + 2);
      }
      ctx.restore();
    });
  }

  function draw(dt) {
    t += dt;
    if (pulse > 0) pulse = Math.max(0, pulse - dt * 1.8);
    sources.forEach((s) => { if (s.flash > 0) s.flash = Math.max(0, s.flash - dt * 3); });
    wishes.forEach((w) => { if (w.pop > 0) w.pop = Math.max(0, w.pop - dt * 1.6); });

    drawSpaceBackdrop(ctx, backdrop, t, { scrollSpeed: 2 });
    drawBeams();
    drawPlanet();
    drawEmitters();
    drawWishes();
    updateAndDrawParticles(ctx, particles, dt, { gravity: -30 });
  }

  // --- Input --------------------------------------------------------------

  const onDown = (e) => {
    if (finishing) return;
    const p = toLogical(e.clientX, e.clientY);

    for (let i = 0; i < sources.length; i++) {
      const s = sources[i];
      const spot = emitterSpot(i);
      // The pips around the nozzle are part of the same target: aiming at a 7px
      // pip is not a thing a child at a wall screen should have to do.
      if (Math.hypot(p.x - spot.x, p.y - spot.y) <= spot.r + 34) {
        s.paletteIndex = (s.paletteIndex + 1) % cfg.palette.length;
        s.paint = cfg.palette[s.paletteIndex];
        s.flash = 1;
        sfx.blip();
        checkWishes();
        return;
      }
      if (!cfg.drops) continue;
      const d = dropsSpot(i);
      if (Math.abs(p.x - d.x) <= d.w / 2 + 12 && Math.abs(p.y - d.y) <= d.h / 2 + 16) {
        s.drops = (s.drops % 3) + 1;
        sfx.pour();
        checkWishes();
        return;
      }
    }
  };

  canvas.addEventListener('pointerdown', onDown);
  listeners.push(() => canvas.removeEventListener('pointerdown', onDown));

  startLevel();

  let last = performance.now();
  function loop(now) {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
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
