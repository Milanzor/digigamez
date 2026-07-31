import './style.css';
import { createHud, showMissionComplete } from '../../shared/ui-components.js';
import {
  setupCanvas, LOGICAL_WIDTH, LOGICAL_HEIGHT,
  createStars, drawSpaceBackdrop, createBurst, updateAndDrawParticles,
  drawGlow, withAlpha,
} from '../../shared/canvas-utils.js';
import { sfx } from '../../shell/audio.js';
import { setLevel, starsForLevel } from '../../shell/progress.js';

// "Zeepbellen" — pop soap bubbles that drift up out of the airlock.
//
// This is the game you hand a two-year-old: there is nothing to aim at, no
// timer, and ten fingers work at once, so two children can stand at the board
// without taking turns. Depth arrives quietly — bubbles get smaller, then the
// big ones split in two, and only from level 4 is there an actual instruction
// ("pop only the blue ones"), which a wrongly poked bubble answers by bouncing
// away rather than by costing anything.

const COLORS = [
  { hex: '#8fd6ff', name: 'blauwe' },
  { hex: '#ff8fc7', name: 'roze' },
  { hex: '#7ee787', name: 'groene' },
  { hex: '#ffc24a', name: 'gele' },
];

// Popping is the whole game, so the hit area is the bubble plus a fat margin:
// a toddler's finger lands near a bubble far more often than on it.
const TOUCH_SLACK = 34;
const PARTICLE_CAP = 220;

let hud = null;
let handle = null;
let raf = null;
let listeners = [];
let reward = null;
let stage = null;
let level = 1;
let slug = 'zeepbellen';
let mission = null;
let onExit = null;

function levelConfig(l) {
  const n = Math.max(1, l);
  return {
    goal: Math.min(10 + n * 2, 26),
    // How many bubbles may be in the air at once, and how fast they climb.
    crowd: Math.min(6 + n, 13),
    rise: Math.min(56 + n * 9, 132),
    minR: Math.max(52, 96 - n * 6),
    maxR: Math.max(78, 132 - n * 7),
    split: n >= 3,
    // The one instruction in the game, and deliberately the last dial to turn.
    colorTask: n >= 4,
  };
}

// Bubbles are pre-rendered per colour: a soap film is a radial gradient plus a
// specular dot, which is four gradient fills, and at a dozen bubbles a frame
// that adds up. One `drawImage` each instead, scaled to the radius.
const SPRITE_PX = 256;
const spriteCache = new Map();

function bubbleSprite(color) {
  let sprite = spriteCache.get(color);
  if (sprite) return sprite;
  sprite = document.createElement('canvas');
  sprite.width = SPRITE_PX;
  sprite.height = SPRITE_PX;
  const g = sprite.getContext('2d');
  const c = SPRITE_PX / 2;
  const r = c - 4;

  // Film: nearly clear in the middle, saturated at the rim, the way a real
  // bubble reads — it is mostly the thing behind it.
  const body = g.createRadialGradient(c, c, r * 0.1, c, c, r);
  body.addColorStop(0, withAlpha(color, 0.02));
  body.addColorStop(0.62, withAlpha(color, 0.07));
  body.addColorStop(0.9, withAlpha(color, 0.42));
  body.addColorStop(1, withAlpha(color, 0.04));
  g.fillStyle = body;
  g.beginPath();
  g.arc(c, c, r, 0, Math.PI * 2);
  g.fill();

  g.strokeStyle = withAlpha(color, 0.85);
  g.lineWidth = 5;
  g.beginPath();
  g.arc(c, c, r - 3, 0, Math.PI * 2);
  g.stroke();

  // Two highlights: a soft one where the light comes from and a hard dot
  // inside it. Without the hard dot it reads as a disc, not as glass.
  const hi = g.createRadialGradient(c - r * 0.36, c - r * 0.4, 0, c - r * 0.36, c - r * 0.4, r * 0.5);
  hi.addColorStop(0, 'rgba(255,255,255,0.62)');
  hi.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = hi;
  g.beginPath();
  g.arc(c - r * 0.36, c - r * 0.4, r * 0.5, 0, Math.PI * 2);
  g.fill();

  g.fillStyle = 'rgba(255,255,255,0.9)';
  g.beginPath();
  g.arc(c - r * 0.42, c - r * 0.46, r * 0.1, 0, Math.PI * 2);
  g.fill();

  spriteCache.set(color, sprite);
  return sprite;
}

export function init(container, opts) {
  slug = opts.slug;
  level = Math.max(1, opts.startLevel || 1);
  mission = { title: opts.title, icon: opts.icon, color: opts.color };
  onExit = opts.onExit;
  reward = null;
  listeners = [];

  const players = opts.players || 1;

  hud = createHud(container, {
    title: opts.title,
    onExit: opts.onExit,
    level,
    meter: 'Bellen',
  });

  stage = document.createElement('div');
  stage.className = 'bub-stage';
  const canvas = document.createElement('canvas');
  canvas.className = 'bub-canvas';
  const hint = document.createElement('div');
  hint.className = 'hint-strip bub-hint';
  stage.append(canvas, hint);
  container.appendChild(stage);

  handle = setupCanvas(canvas, { alpha: false });
  const { ctx, toLogical } = handle;
  const stars = createStars(90);

  let cfg = levelConfig(level);
  let bubbles = [];
  let particles = [];
  let popped = 0;
  let chimeStep = 0;
  let target = null;
  let t = 0;
  let spawnCooldown = 0;
  let finished = false;

  function startLevel() {
    cfg = levelConfig(level);
    hud.setLevel(level);
    hud.setMeter(0);
    bubbles = [];
    particles = [];
    popped = 0;
    chimeStep = 0;
    finished = false;
    target = cfg.colorTask ? COLORS[Math.floor(Math.random() * COLORS.length)] : null;
    hint.textContent = target
      ? `Prik alleen de ${target.name} bellen`
      : players > 1
        ? 'Prik de bellen — samen mag ook'
        : 'Prik de bellen!';
    // A few already in the air, so the screen is never empty on arrival.
    for (let i = 0; i < Math.min(4, cfg.crowd); i++) {
      bubbles.push(spawn(LOGICAL_HEIGHT * (0.35 + Math.random() * 0.6)));
    }
  }

  function spawn(y = LOGICAL_HEIGHT + 120) {
    const r = cfg.minR + Math.random() * (cfg.maxR - cfg.minR);
    // With a colour task, load the dice towards the wanted colour: hunting for
    // a rare blue bubble is a different, much less generous game.
    let color = COLORS[Math.floor(Math.random() * COLORS.length)];
    if (target && Math.random() < 0.5) color = target;
    return {
      x: r + Math.random() * (LOGICAL_WIDTH - r * 2),
      y,
      r,
      color,
      vx: (Math.random() - 0.5) * 40,
      rise: cfg.rise * (0.75 + Math.random() * 0.5),
      phase: Math.random() * Math.PI * 2,
      wobble: 0.5 + Math.random() * 0.7,
      // Ticks down after a wrong poke: the bubble squashes and dodges.
      nudge: 0,
    };
  }

  function burst(b, colors, count) {
    particles.push(...createBurst(b.x, b.y, colors, { count, speed: 210 }));
    if (particles.length > PARTICLE_CAP) particles.splice(0, particles.length - PARTICLE_CAP);
  }

  function pop(b, index) {
    if (target && b.color !== target) {
      // Not a mistake, just a bubble that does not want to be popped: it
      // squashes, slides away and stays in play.
      b.nudge = 0.32;
      b.vx = (b.vx >= 0 ? 1 : -1) * 190;
      sfx.bounce();
      return;
    }

    bubbles.splice(index, 1);
    burst(b, [b.color.hex, '#ffffff', withAlpha(b.color.hex, 0.6)], 14);
    // Each pop is the next note of a pentatonic run, so a busy screen sounds
    // like a xylophone being played rather than like a stack of blips.
    sfx.chime(chimeStep++);

    if (cfg.split && b.r > cfg.minR * 1.25) {
      // A big bubble is worth two: it breaks into a pair that drift apart.
      for (const dir of [-1, 1]) {
        bubbles.push({
          ...b,
          r: b.r * 0.62,
          x: b.x + dir * b.r * 0.4,
          vx: dir * 120,
          nudge: 0,
        });
      }
    }

    popped++;
    hud.setMeter(popped / cfg.goal);
    if (popped >= cfg.goal && !finished) finishLevel();
  }

  function popAt(clientX, clientY) {
    const { x, y } = toLogical(clientX, clientY);
    // Back to front, so the bubble drawn on top is the one that pops.
    for (let i = bubbles.length - 1; i >= 0; i--) {
      const b = bubbles[i];
      if (Math.hypot(b.x - x, b.y - y) <= b.r + TOUCH_SLACK) {
        pop(b, i);
        return;
      }
    }
  }

  function finishLevel() {
    finished = true;
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
      title: 'Alle bellen geprikt! 🫧',
      onNext: () => { reward = null; startLevel(); },
      onRetry: () => { reward = null; level = cleared; startLevel(); },
      onHome: onExit,
    });
  }

  // --- input: every pointer pops on its own, and dragging keeps popping,
  // because a small child sweeps a hand across the glass rather than tapping.
  const dragging = new Set();
  const onDown = (e) => {
    if (finished) return;
    dragging.add(e.pointerId);
    popAt(e.clientX, e.clientY);
  };
  const onMove = (e) => {
    if (finished || !dragging.has(e.pointerId)) return;
    popAt(e.clientX, e.clientY);
  };
  const onUp = (e) => dragging.delete(e.pointerId);

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);

  function update(dt) {
    t += dt;

    if (!finished) {
      spawnCooldown -= dt;
      if (bubbles.length < cfg.crowd && spawnCooldown <= 0) {
        bubbles.push(spawn());
        spawnCooldown = 0.45 + Math.random() * 0.5;
      }
    }

    for (let i = bubbles.length - 1; i >= 0; i--) {
      const b = bubbles[i];
      b.y -= b.rise * dt;
      b.x += (b.vx + Math.sin(t * b.wobble + b.phase) * 46) * dt;
      b.vx *= 1 - Math.min(1, dt * 2.2);
      if (b.nudge > 0) b.nudge -= dt;

      // Walls nudge a bubble back rather than clipping it, so nothing ever
      // sits half off the screen where it can't be reached.
      if (b.x < b.r) { b.x = b.r; b.vx = Math.abs(b.vx); }
      if (b.x > LOGICAL_WIDTH - b.r) { b.x = LOGICAL_WIDTH - b.r; b.vx = -Math.abs(b.vx); }

      // Off the top it simply leaves. No sound, no loss, no comment.
      if (b.y < -b.r - 40) bubbles.splice(i, 1);
    }
  }

  function draw(dt) {
    drawSpaceBackdrop(ctx, stars, t, { scrollSpeed: 5 });

    for (const b of bubbles) {
      const squash = b.nudge > 0 ? 1 + Math.sin(b.nudge * 40) * 0.09 : 1;
      const w = b.r * 2 * squash;
      const h = (b.r * 2) / squash;
      // A wanted bubble carries a halo; the others are just glass. That is the
      // whole colour instruction, readable from the back of the room.
      if (!target || b.color === target) {
        drawGlow(ctx, b.color.hex, b.x, b.y, b.r * 1.5, target ? 0.75 : 0.4);
      }
      ctx.drawImage(bubbleSprite(b.color.hex), b.x - w / 2, b.y - h / 2, w, h);
    }

    updateAndDrawParticles(ctx, particles, dt, { gravity: -60 });
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
