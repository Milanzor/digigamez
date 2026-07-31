import './style.css';
import { createHud, showMissionComplete } from '../../shared/ui-components.js';
import {
  setupCanvas, LOGICAL_WIDTH, LOGICAL_HEIGHT,
  createStars, drawSpaceBackdrop, createBurst, updateAndDrawParticles,
  drawGlow, withAlpha,
} from '../../shared/canvas-utils.js';
import { sfx } from '../../shell/audio.js';
import { setLevel, starsForLevel } from '../../shell/progress.js';

// "Meteoor Meppen" — aliens pop out of moon craters and you bop them.
//
// Whack-a-mole is the one classic that gets *better* on a 75" board than on a
// tablet, because two children can stand at it and both grab for the same
// crater. So there is deliberately no split screen and no per-player score:
// with ten fingers on the glass there is no honest way to tell whose finger got
// there first, and inventing one would mean arguing about it. Two astronauts
// share one counter and the round is something they clear together.
//
// The friendly one is the important piece. A game where every appearance must
// be hit is a game that trains a child to slap everything; one creature that
// only giggles turns it into looking-before-hitting, and — this being the house
// rule — hitting it still costs nothing at all.

const TYPES = {
  grunt: { emoji: '👽', points: 1, up: [1.25, 1.9], glow: '#7ee787' },
  // Worth double and gone quicker: the thing an older child chases while the
  // little one is still happily bopping the slow ones.
  zip: { emoji: '🛸', points: 2, up: [0.68, 1.0], glow: '#8fd6ff' },
  friend: { emoji: '😺', points: 0, up: [1.5, 2.3], glow: '#ff8fc7' },
};

const PARTICLE_CAP = 240;

let hud = null;
let handle = null;
let raf = null;
let listeners = [];
let reward = null;
let stage = null;
let level = 1;
let slug = 'meteoor-meppen';
let mission = null;
let onExit = null;

function levelConfig(l) {
  const n = Math.max(1, l);
  return {
    goal: Math.min(8 + n * 3, 26),
    cols: n >= 3 ? 4 : 3,
    // How often one pops up, and how many may be out at once.
    every: Math.max(0.42, 1.15 - n * 0.11),
    maxUp: Math.min(2 + Math.floor(n / 2), 5),
    zipChance: n >= 2 ? Math.min(0.14 + n * 0.05, 0.4) : 0,
    friendChance: n >= 2 ? Math.min(0.12 + n * 0.03, 0.28) : 0,
  };
}

// Emoji are expensive to draw: `fillText` shapes and rasterises the glyph every
// single call, and a full board is a dozen of them a frame. Each one is baked
// once into an offscreen canvas at device scale and blitted after that — the
// same lesson the Gekke Machine's parts learned.
const SPRITE_PX = 192;
const spriteCache = new Map();

function emojiSprite(ch) {
  let sprite = spriteCache.get(ch);
  if (sprite) return sprite;
  sprite = document.createElement('canvas');
  sprite.width = SPRITE_PX;
  sprite.height = SPRITE_PX;
  const g = sprite.getContext('2d');
  g.font = `${Math.round(SPRITE_PX * 0.8)}px "Apple Color Emoji","Noto Color Emoji","Segoe UI Emoji",sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(ch, SPRITE_PX / 2, SPRITE_PX / 2 + SPRITE_PX * 0.04);
  spriteCache.set(ch, sprite);
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
    meter: 'Gemept',
  });

  stage = document.createElement('div');
  stage.className = 'wac-stage';
  const canvas = document.createElement('canvas');
  canvas.className = 'wac-canvas';
  const legend = document.createElement('div');
  legend.className = 'wac-legend';
  stage.append(canvas, legend);
  container.appendChild(stage);

  handle = setupCanvas(canvas, { alpha: false });
  const { ctx, toLogical } = handle;
  const stars = createStars(70);

  let cfg = levelConfig(level);
  let craters = [];
  let particles = [];
  let hits = 0;
  let chimeStep = 0;
  let t = 0;
  let spawnIn = 0;
  let finished = false;
  // The hammer that flashes wherever a finger lands. Feedback for the tap
  // itself, so a miss still feels like something happened.
  let whacks = [];

  // Three rows of craters in a shallow perspective: the near row is bigger and
  // wider apart, which is also the row a small child can actually reach.
  function buildCraters() {
    craters = [];
    const rows = 3;
    for (let r = 0; r < rows; r++) {
      const depth = r / (rows - 1);
      const radius = 74 + depth * 46;
      const y = 430 + depth * 470;
      const inset = 300 - depth * 150;
      const span = LOGICAL_WIDTH - inset * 2;
      for (let c = 0; c < cfg.cols; c++) {
        const x = cfg.cols === 1
          ? LOGICAL_WIDTH / 2
          : inset + (span * c) / (cfg.cols - 1);
        craters.push({
          x, y, radius,
          occupant: null,
          // 0 at the bottom of the hole, 1 fully out.
          rise: 0,
          phase: 'idle',
          timeLeft: 0,
          squash: 0,
        });
      }
    }
  }

  function renderLegend() {
    // Who is worth what, and who is not to be hit — as pictures. This is the
    // whole rule set of the game and none of it is written down.
    const row = (emoji, mark, cls) => `
      <span class="wac-legend__item ${cls}">
        <span class="wac-legend__face">${emoji}</span>
        <span class="wac-legend__mark">${mark}</span>
      </span>
    `;
    let html = row('👽', '👆', 'is-yes');
    if (cfg.zipChance > 0) html += row('🛸', '👆👆', 'is-yes');
    if (cfg.friendChance > 0) {
      html += '<span class="wac-legend__sep"></span>' + row('😺', '✕', 'is-no');
    }
    legend.innerHTML = html;
  }

  function startLevel() {
    cfg = levelConfig(level);
    hud.setLevel(level);
    hud.setMeter(0);
    buildCraters();
    renderLegend();
    particles = [];
    whacks = [];
    hits = 0;
    chimeStep = 0;
    spawnIn = 0.5;
    finished = false;
  }

  function pickType() {
    const roll = Math.random();
    if (roll < cfg.friendChance) return 'friend';
    if (roll < cfg.friendChance + cfg.zipChance) return 'zip';
    return 'grunt';
  }

  function popOne() {
    const free = craters.filter((c) => c.phase === 'idle');
    if (!free.length) return;
    const crater = free[Math.floor(Math.random() * free.length)];
    const type = pickType();
    const [lo, hi] = TYPES[type].up;
    crater.occupant = type;
    crater.phase = 'rising';
    crater.timeLeft = lo + Math.random() * (hi - lo);
    sfx.blip();
  }

  function whack(x, y) {
    whacks.push({ x, y, t: 0 });
    if (whacks.length > 8) whacks.shift();

    for (const c of craters) {
      if (c.phase !== 'rising' && c.phase !== 'up') continue;
      // Generous radius: a child swinging at a wall-sized screen from close up
      // lands near the alien far more often than on it.
      if (Math.hypot(c.x - x, c.y - y) > c.radius * 1.35) continue;

      const type = TYPES[c.occupant];
      if (c.occupant === 'friend') {
        // The giggle. It ducks away laughing, nothing is scored, nothing is
        // taken — the only cost is the second you spent on it.
        c.phase = 'giggle';
        c.timeLeft = 0.5;
        c.squash = 1;
        sfx.blip();
        sfx.chime(6);
        particles.push(...createBurst(c.x, c.y - c.radius * 0.4, ['#ff8fc7', '#ffffff'], { count: 10, speed: 150 }));
        return;
      }

      c.phase = 'bopped';
      c.timeLeft = 0.26;
      c.squash = 1;
      hits += type.points;
      hud.setMeter(hits / cfg.goal);
      // Every bop is the next note of a pentatonic run, so a busy board sounds
      // like a xylophone rather than a stack of thuds.
      sfx.chime(chimeStep++);
      sfx.impact();
      particles.push(...createBurst(c.x, c.y - c.radius * 0.4, [type.glow, '#ffffff', withAlpha(type.glow, 0.6)], {
        count: type.points > 1 ? 22 : 14,
        speed: 250,
      }));
      if (particles.length > PARTICLE_CAP) particles.splice(0, particles.length - PARTICLE_CAP);

      if (hits >= cfg.goal && !finished) finishLevel();
      return;
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
      title: players > 1 ? 'Samen alle indringers gemept! 🔨' : 'Alle indringers gemept! 🔨',
      onNext: () => { reward = null; startLevel(); },
      onRetry: () => { reward = null; level = cleared; startLevel(); },
      onHome: onExit,
    });
  }

  // Every pointer whacks on its own, so two children never wait for each other.
  const onDown = (e) => {
    if (finished) return;
    const { x, y } = toLogical(e.clientX, e.clientY);
    whack(x, y);
  };
  canvas.addEventListener('pointerdown', onDown);

  function update(dt) {
    t += dt;
    if (!finished) {
      spawnIn -= dt;
      const up = craters.filter((c) => c.phase === 'rising' || c.phase === 'up').length;
      if (spawnIn <= 0 && up < cfg.maxUp) {
        popOne();
        spawnIn = cfg.every * (0.7 + Math.random() * 0.7);
      }
    }

    for (const c of craters) {
      if (c.squash > 0) c.squash = Math.max(0, c.squash - dt * 4);

      switch (c.phase) {
        case 'rising':
          c.rise = Math.min(1, c.rise + dt * 5);
          if (c.rise >= 1) c.phase = 'up';
          break;
        case 'up':
          c.timeLeft -= dt;
          // Time ran out: it ducks back down of its own accord. Missing one is
          // not a mistake, it is just an alien that got away.
          if (c.timeLeft <= 0) c.phase = 'sinking';
          break;
        case 'bopped':
        case 'giggle':
          c.timeLeft -= dt;
          if (c.timeLeft <= 0) c.phase = 'sinking';
          break;
        case 'sinking':
          c.rise = Math.max(0, c.rise - dt * 6);
          if (c.rise <= 0) {
            c.phase = 'idle';
            c.occupant = null;
          }
          break;
        default:
          break;
      }
    }

    for (let i = whacks.length - 1; i >= 0; i--) {
      whacks[i].t += dt;
      if (whacks[i].t > 0.3) whacks.splice(i, 1);
    }
  }

  // The moon surface: one gradient and a scatter of far craters, painted under
  // the playable ones so the row of holes reads as ground rather than as a grid.
  function drawGround() {
    const horizon = 340;
    const g = ctx.createLinearGradient(0, horizon, 0, LOGICAL_HEIGHT);
    g.addColorStop(0, '#2b2a44');
    g.addColorStop(1, '#141328');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(0, horizon + 40);
    ctx.quadraticCurveTo(LOGICAL_WIDTH * 0.5, horizon - 30, LOGICAL_WIDTH, horizon + 40);
    ctx.lineTo(LOGICAL_WIDTH, LOGICAL_HEIGHT);
    ctx.lineTo(0, LOGICAL_HEIGHT);
    ctx.closePath();
    ctx.fill();
  }

  function drawCrater(c) {
    // The hole: a dark ellipse with a lit rim on the near side.
    ctx.fillStyle = '#0a0a18';
    ctx.beginPath();
    ctx.ellipse(c.x, c.y, c.radius, c.radius * 0.42, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(232,217,176,0.2)';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.ellipse(c.x, c.y, c.radius, c.radius * 0.42, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  function drawOccupant(c) {
    if (!c.occupant || c.rise <= 0) return;
    const type = TYPES[c.occupant];
    const size = c.radius * 1.5;
    // Clipped to the crater mouth and everything above it, so the creature is
    // genuinely climbing out of the hole instead of fading in on top of it.
    ctx.save();
    ctx.beginPath();
    ctx.rect(c.x - c.radius * 1.4, 0, c.radius * 2.8, c.y + c.radius * 0.12);
    ctx.clip();

    const squash = 1 - c.squash * 0.3;
    const y = c.y - size * 0.42 * c.rise;
    drawGlow(ctx, type.glow, c.x, y, size * 0.62, 0.5 * c.rise);
    ctx.drawImage(
      emojiSprite(type.emoji),
      c.x - (size * squash) / 2,
      y - (size / squash) / 2,
      size * squash,
      size / squash,
    );
    ctx.restore();
  }

  function drawWhacks() {
    for (const w of whacks) {
      const k = w.t / 0.3;
      const size = 150 * (1 - k * 0.35);
      ctx.save();
      ctx.globalAlpha = 1 - k;
      ctx.translate(w.x, w.y - size * 0.2);
      ctx.rotate(-0.5 + k * 0.9);
      ctx.drawImage(emojiSprite('🔨'), -size / 2, -size / 2, size, size);
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  function draw(dt) {
    drawSpaceBackdrop(ctx, stars, t, { scrollSpeed: 3 });
    drawGround();
    // Back rows first, so a near alien overlaps the crater behind it.
    for (const c of craters) drawCrater(c);
    for (const c of craters) drawOccupant(c);
    drawWhacks();
    updateAndDrawParticles(ctx, particles, dt, { gravity: 520 });
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

  listeners.push(() => canvas.removeEventListener('pointerdown', onDown));
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
