import './style.css';
import { createHud, showMissionComplete } from '../../shared/ui-components.js';
import {
  setupCanvas, LOGICAL_WIDTH, LOGICAL_HEIGHT,
  createStars, drawSpaceBackdrop, createBurst, updateAndDrawParticles,
  drawGlow, drawStar, withAlpha,
} from '../../shared/canvas-utils.js';
import { sfx } from '../../shell/audio.js';
import { setLevel, starsForLevel } from '../../shell/progress.js';

// "Sterrenpaden" — join star 1 to star 2 to star 3 and a picture appears.
//
// Two things at once, which is why it earns a slot: counting in order, and the
// fine motor control of dragging a line to a target. Neither is dressed up as
// an exercise, because the reveal at the end is what the child is actually
// working towards — and a constellation turning into a cat is a real payoff for
// a four-year-old.
//
// It is also the cheapest game in the archive by a mile: a level is a list of
// points. No physics, no generator, no solver. That is the reason it can afford
// eight different shapes.
//
// Only the next star is live and it is the only thing glowing, so a child who
// cannot yet count past three still knows exactly where to go — the numerals
// are there for the child who is learning to read them, not as a requirement.

const SHAPES = [
  {
    name: 'huis', emoji: '🏠', color: '#ffc24a',
    pts: [[0.22, 0.86], [0.22, 0.46], [0.5, 0.16], [0.78, 0.46], [0.78, 0.86]],
  },
  {
    name: 'vis', emoji: '🐟', color: '#8fd6ff',
    pts: [[0.12, 0.5], [0.36, 0.28], [0.68, 0.34], [0.94, 0.2], [0.94, 0.8], [0.68, 0.66], [0.36, 0.72]],
  },
  {
    name: 'kroon', emoji: '👑', color: '#ffd479',
    pts: [[0.14, 0.78], [0.18, 0.32], [0.34, 0.54], [0.5, 0.24], [0.66, 0.54], [0.82, 0.32], [0.86, 0.78]],
  },
  {
    name: 'boot', emoji: '⛵', color: '#5fe3c4',
    pts: [[0.5, 0.08], [0.8, 0.58], [0.9, 0.58], [0.76, 0.86], [0.24, 0.86], [0.1, 0.58], [0.44, 0.58], [0.44, 0.3]],
  },
  {
    name: 'poes', emoji: '🐱', color: '#ff8fc7',
    pts: [[0.26, 0.34], [0.3, 0.1], [0.46, 0.28], [0.62, 0.28], [0.78, 0.1], [0.82, 0.34], [0.84, 0.6], [0.5, 0.88], [0.16, 0.6]],
  },
  {
    name: 'ster', emoji: '⭐', color: '#ffc24a',
    pts: [[0.5, 0.06], [0.61, 0.36], [0.94, 0.36], [0.67, 0.56], [0.78, 0.9], [0.5, 0.69], [0.22, 0.9], [0.33, 0.56], [0.06, 0.36], [0.39, 0.36]],
  },
  {
    name: 'raket', emoji: '🚀', color: '#ff6b6b',
    pts: [[0.5, 0.06], [0.64, 0.32], [0.64, 0.6], [0.82, 0.84], [0.58, 0.78], [0.5, 0.95], [0.42, 0.78], [0.18, 0.84], [0.36, 0.6], [0.36, 0.32]],
  },
  {
    name: 'vlinder', emoji: '🦋', color: '#b98cff',
    pts: [[0.5, 0.2], [0.72, 0.06], [0.92, 0.26], [0.76, 0.46], [0.94, 0.68], [0.72, 0.9], [0.5, 0.72], [0.28, 0.9], [0.06, 0.68], [0.24, 0.46], [0.08, 0.26], [0.28, 0.06]],
  },
];

// Two pictures to a level: enough that finishing one is not the whole level, few
// enough that the reward screen is never far away.
const ROUNDS = 2;
const TOUCH_SLACK = 60;

let hud = null;
let handle = null;
let raf = null;
let listeners = [];
let timers = [];
let reward = null;
let stage = null;
let level = 1;
let slug = 'sterrenpaden';
let mission = null;
let onExit = null;

// How many dots a level is willing to ask for. The band moves rather than a
// count, because the shapes are what they are — a house is five points whether
// the child is three or six.
function levelBand(l) {
  const n = Math.max(1, l);
  if (n === 1) return [5, 5];
  if (n === 2) return [7, 7];
  if (n === 3) return [7, 9];
  if (n === 4) return [9, 10];
  return [10, 12];
}

function later(fn, ms) {
  const id = setTimeout(fn, ms);
  timers.push(id);
  return id;
}

// Emoji cost a full glyph rasterisation per `fillText`, and the reveal draws one
// every frame while it fades in. Baked once, blitted after that.
const spriteCache = new Map();
function emojiSprite(ch, px = 320) {
  const key = `${ch}@${px}`;
  let sprite = spriteCache.get(key);
  if (sprite) return sprite;
  sprite = document.createElement('canvas');
  sprite.width = px;
  sprite.height = px;
  const g = sprite.getContext('2d');
  g.font = `${Math.round(px * 0.82)}px "Apple Color Emoji","Noto Color Emoji","Segoe UI Emoji",sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(ch, px / 2, px / 2 + px * 0.04);
  spriteCache.set(key, sprite);
  return sprite;
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
    meter: 'Tekeningen',
  });

  stage = document.createElement('div');
  stage.className = 'path-stage';
  const canvas = document.createElement('canvas');
  canvas.className = 'path-canvas';
  const label = document.createElement('div');
  label.className = 'path-label';
  stage.append(canvas, label);
  container.appendChild(stage);

  handle = setupCanvas(canvas, { alpha: false });
  const { ctx, toLogical } = handle;
  const backdrop = createStars(120);

  let shape = null;
  let pts = [];
  let joined = 1;
  let round = 0;
  let lastShape = -1;
  let revealed = 0;
  let particles = [];
  let t = 0;
  let dragging = false;
  let finger = null;

  function pickShape() {
    const [lo, hi] = levelBand(level);
    let pool = SHAPES.map((s, i) => i).filter((i) => SHAPES[i].pts.length >= lo && SHAPES[i].pts.length <= hi);
    if (!pool.length) pool = SHAPES.map((s, i) => i);
    // Never the same picture twice running: the reveal is the reward and a
    // repeat spends it.
    if (pool.length > 1) pool = pool.filter((i) => i !== lastShape);
    const pick = pool[Math.floor(Math.random() * pool.length)];
    lastShape = pick;
    return SHAPES[pick];
  }

  // The drawing area is a square in the middle of the logical canvas, so a
  // five-point house and a twelve-point butterfly are the same size on screen.
  function layout() {
    const side = Math.min(LOGICAL_HEIGHT * 0.74, LOGICAL_WIDTH * 0.52);
    const x0 = (LOGICAL_WIDTH - side) / 2;
    const y0 = (LOGICAL_HEIGHT - side) / 2;
    return { side, x0, y0 };
  }

  function computePoints() {
    const { side, x0, y0 } = layout();
    pts = shape.pts.map(([nx, ny]) => ({ x: x0 + nx * side, y: y0 + ny * side }));
  }

  function newRound() {
    shape = pickShape();
    computePoints();
    joined = 1;
    revealed = 0;
    particles = [];
    dragging = false;
    finger = null;
    label.textContent = '';
    label.classList.remove('is-visible');
  }

  function startLevel() {
    hud.setLevel(level);
    hud.setMeter(0);
    round = 0;
    newRound();
  }

  // The star the child is looking for: index `joined`, wrapping back to 0 for
  // the closing line so a picture always ends where it began.
  function nextIndex() {
    return joined < pts.length ? joined : 0;
  }

  function complete() {
    return joined > pts.length;
  }

  function tryJoin(x, y) {
    if (complete() || revealed > 0) return;
    const idx = nextIndex();
    const p = pts[idx];
    if (Math.hypot(p.x - x, p.y - y) > TOUCH_SLACK + 34) return;

    joined += 1;
    // Each join is the next note up the pentatonic ladder, so a finished
    // picture has played a little tune on the way.
    sfx.chime(joined - 2);
    particles.push(...createBurst(p.x, p.y, [shape.color, '#ffffff'], { count: 8, speed: 170 }));

    if (complete()) {
      revealed = 0.001;
      sfx.levelUp();
      label.textContent = shape.name;
      label.classList.add('is-visible');
      particles.push(...createBurst(
        layout().x0 + layout().side / 2,
        layout().y0 + layout().side / 2,
        [shape.color, '#ffffff', withAlpha(shape.color, 0.6)],
        { count: 30, speed: 340 },
      ));
      later(() => {
        round += 1;
        hud.setMeter(round / ROUNDS);
        if (round >= ROUNDS) finishLevel();
        else newRound();
      }, 2100);
    }
  }

  function finishLevel() {
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
      title: 'De sterren zijn getekend! ✨',
      onNext: () => { reward = null; startLevel(); },
      onRetry: () => { reward = null; level = cleared; startLevel(); },
      onHome: onExit,
    });
  }

  // A finger down on the next star starts the line; dragging on through the
  // stars keeps joining them, which is how a child who has got the hang of it
  // draws the whole picture in one sweep.
  const onDown = (e) => {
    dragging = true;
    finger = toLogical(e.clientX, e.clientY);
    tryJoin(finger.x, finger.y);
  };
  const onMove = (e) => {
    if (!dragging) return;
    finger = toLogical(e.clientX, e.clientY);
    tryJoin(finger.x, finger.y);
  };
  const onUp = () => {
    dragging = false;
    finger = null;
  };

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);

  function update(dt) {
    t += dt;
    if (revealed > 0) revealed = Math.min(1, revealed + dt * 1.4);
  }

  function drawPath() {
    if (joined < 2) return;
    // The line already drawn, as a glowing thread. `joined` counts points, so
    // joined-1 segments exist; the last one may be the closing line back to 0.
    ctx.save();
    ctx.strokeStyle = withAlpha(shape.color, 0.9);
    ctx.lineWidth = 9;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < Math.min(joined, pts.length); i++) ctx.lineTo(pts[i].x, pts[i].y);
    if (complete()) ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }

  function drawReveal() {
    if (revealed <= 0) return;
    const { side, x0, y0 } = layout();

    ctx.save();
    ctx.globalAlpha = revealed;
    // The finished outline fills in, and the thing it turned out to be rises
    // inside it. That is the promise the numbers were for.
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
    const g = ctx.createLinearGradient(x0, y0, x0, y0 + side);
    g.addColorStop(0, withAlpha(shape.color, 0.38));
    g.addColorStop(1, withAlpha(shape.color, 0.1));
    ctx.fillStyle = g;
    ctx.fill();

    const size = side * 0.52 * (0.7 + revealed * 0.3);
    ctx.globalAlpha = revealed * 0.95;
    ctx.drawImage(
      emojiSprite(shape.emoji),
      x0 + side / 2 - size / 2,
      y0 + side / 2 - size / 2,
      size, size,
    );
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  function drawDots() {
    const idx = nextIndex();
    pts.forEach((p, i) => {
      const done = i < joined;
      const isNext = !complete() && i === idx;
      const r = isNext ? 30 + Math.sin(t * 4) * 4 : 22;

      if (isNext) drawGlow(ctx, '#ffc24a', p.x, p.y, 82, 0.9);
      else if (done) drawGlow(ctx, shape.color, p.x, p.y, 52, 0.4);
      // A star still to come has to read as a star against an actual starfield.
      // At --faint it was a grey smudge a three-year-old could not pick out, so
      // it gets a pale cream face and a whisper of a halo instead.
      else drawGlow(ctx, '#f3ece0', p.x, p.y, 44, 0.22);

      drawStar(ctx, p.x, p.y, r, isNext ? '#ffd479' : done ? shape.color : 'rgba(243,236,224,0.5)', 5);

      // The numeral, for the child who is learning to read them. The glow does
      // the work for the child who is not.
      ctx.save();
      ctx.font = '700 40px "Baloo 2", system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = isNext ? '#2c1c04' : done ? 'rgba(5,7,15,0.75)' : 'rgba(5,7,15,0.62)';
      ctx.fillText(String(i + 1), p.x, p.y + 2);
      ctx.restore();
    });
  }

  // A guide line from the last joined star to the finger, so a drag has
  // something to aim with rather than being blind until it lands.
  function drawLead() {
    if (!dragging || !finger || complete()) return;
    const from = pts[Math.min(joined, pts.length) - 1];
    ctx.save();
    ctx.strokeStyle = 'rgba(255,194,74,0.4)';
    ctx.lineWidth = 5;
    ctx.setLineDash([16, 16]);
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(finger.x, finger.y);
    ctx.stroke();
    ctx.restore();
  }

  function draw(dt) {
    drawSpaceBackdrop(ctx, backdrop, t, { scrollSpeed: 4 });
    drawReveal();
    drawPath();
    drawLead();
    drawDots();
    updateAndDrawParticles(ctx, particles, dt, { gravity: -30 });
  }

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

  listeners.push(() => {
    canvas.removeEventListener('pointerdown', onDown);
    canvas.removeEventListener('pointermove', onMove);
    canvas.removeEventListener('pointerup', onUp);
    canvas.removeEventListener('pointercancel', onUp);
  });
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
