import './style.css';
import { createHud, showMissionComplete } from '../../shared/ui-components.js';
import {
  setupCanvas, LOGICAL_WIDTH, LOGICAL_HEIGHT,
  createStars, drawSpaceBackdrop, createBurst, updateAndDrawParticles,
  drawStar, drawGlow, withAlpha,
} from '../../shared/canvas-utils.js';
import { sfx } from '../../shell/audio.js';
import { setLevel, starsForLevel } from '../../shell/progress.js';

// "Sterrenvangst" — hold a basket under the sky and catch what falls out of it.
//
// The third of the ten-finger games, and the one that finally gives each child
// something that is *theirs* on a shared board. Zeepbellen and Meteoor Meppen
// deliberately refuse to say whose finger got there first, because with ten
// hands on the same glass there is no honest answer. A basket dodges that
// entirely: it is a thing you hold, so it is obvious who is holding it, and
// two children can go for the same star without either of them being robbed.
//
// The counter stays shared all the same. What they are filling is one hold, and
// a level clears when the hold is full — so the child who catches four stars and
// the child who catches fourteen finish the same level at the same moment.
//
// Colours arrive late and only with two children (level 3), exactly the way the
// colour rule arrives late in Zeepbellen: for the first two levels every star is
// gold and any basket takes it, so the game teaches "hold it under the star"
// before it ever teaches "hold it under *your* star". A star that lands in the
// wrong basket is not a mistake either — it bounces off the rim and gets another
// chance on the way down.

const GOLD = '#ffc24a';
const P_COLORS = ['#ff6b6b', '#5fe3c4'];

// The mouth of the basket, in logical rows. Low enough that a falling star is
// visible for most of a second, high enough that the rim is not under a child's
// wrist when they reach for the bottom of a wall-mounted screen.
const BASKET_Y = LOGICAL_HEIGHT - 214;
const BASKET_H = 132;
const STAR_R = 46;
const PARTICLE_CAP = 240;

let hud = null;
let handle = null;
let raf = null;
let listeners = [];
let reward = null;
let stage = null;
let level = 1;
let slug = 'sterrenvangst';
let mission = null;
let onExit = null;

function levelConfig(l, players) {
  const n = Math.max(1, l);
  return {
    goal: Math.min(8 + n * 2, 24),
    fall: Math.min(230 + n * 38, 620),
    interval: Math.max(0.4, 1.2 - n * 0.09),
    // The basket narrows, but never past a comfortable two-hand width.
    halfW: Math.max(112, 196 - n * 9),
    // Worth two, falls faster: the thing an older child goes for while the
    // little one is happily scooping up the slow ones.
    comets: n >= 2,
    // Only ever a two-player rule — a lone child would be sorting against
    // themselves, which is a chore rather than a game.
    colorTask: players > 1 && n >= 3,
  };
}

// Stars are pre-rendered per colour and blitted: a five-pointed path plus its
// halo, twenty times a frame, is the exact shape of cost the archive learned to
// pre-render everywhere else.
const SPRITE_PX = 160;
const starCache = new Map();

function starSprite(color) {
  let sprite = starCache.get(color);
  if (sprite) return sprite;
  sprite = document.createElement('canvas');
  sprite.width = SPRITE_PX;
  sprite.height = SPRITE_PX;
  const g = sprite.getContext('2d');
  const c = SPRITE_PX / 2;
  drawStar(g, c, c, c - 8, color);
  // A pale core, so the star reads as lit rather than as a coloured cut-out.
  drawStar(g, c, c, (c - 8) * 0.42, 'rgba(255,255,255,0.72)');
  starCache.set(color, sprite);
  return sprite;
}

export function init(container, opts) {
  slug = opts.slug;
  level = Math.max(1, opts.startLevel || 1);
  mission = { title: opts.title, icon: opts.icon, color: opts.color };
  onExit = opts.onExit;
  reward = null;
  listeners = [];

  const players = Math.max(1, Math.min(opts.players || 1, 2));

  hud = createHud(container, {
    title: opts.title,
    onExit: opts.onExit,
    level,
    meter: 'Gevangen',
  });

  stage = document.createElement('div');
  stage.className = 'vang-stage';
  const canvas = document.createElement('canvas');
  canvas.className = 'vang-canvas';
  const legend = document.createElement('div');
  legend.className = 'vang-legend';
  stage.append(canvas, legend);
  container.appendChild(stage);

  handle = setupCanvas(canvas, { alpha: false });
  const { ctx, toLogical } = handle;
  const stars = createStars(90);

  let cfg = levelConfig(level, players);
  let falling = [];
  let particles = [];
  let caught = 0;
  let chimeStep = 0;
  let t = 0;
  let spawnCooldown = 0.4;
  let finished = false;

  // One per player. Solo plays amber — the basket is then the only thing on the
  // board that acts, and amber is what this app paints the acting thing.
  const baskets = Array.from({ length: players }, (_, i) => ({
    color: players > 1 ? P_COLORS[i] : GOLD,
    x: LOGICAL_WIDTH * (players > 1 ? (i === 0 ? 0.3 : 0.7) : 0.5),
    target: LOGICAL_WIDTH * (players > 1 ? (i === 0 ? 0.3 : 0.7) : 0.5),
    // Ticks down after a catch and bobs the basket while it does.
    dip: 0,
    pointer: null,
  }));

  function startLevel() {
    cfg = levelConfig(level, players);
    hud.setLevel(level);
    hud.setMeter(0);
    falling = [];
    particles = [];
    caught = 0;
    chimeStep = 0;
    spawnCooldown = 0.4;
    finished = false;
    renderLegend();
  }

  // The rule as a picture: a star, an arrow, and the basket it belongs in. With
  // no colour task there is one row of it and nothing to compare against, so
  // the panel closes up around the single pictogram.
  function renderLegend() {
    const item = (color, label, twoTone = false) => `
      <span class="vang-legend__item" role="img" aria-label="${label}">
        <span class="vang-legend__star" style="--c:${color}">★</span>
        <span class="vang-legend__arrow">⬇</span>
        <span class="vang-legend__basket${twoTone ? ' is-both' : ''}" style="--c:${color};--c2:${P_COLORS[1]};--c1:${P_COLORS[0]}"></span>
      </span>
    `;

    if (!cfg.colorTask) {
      legend.className = 'vang-legend vang-legend--simple';
      legend.innerHTML = item(
        GOLD,
        players > 1 ? 'Vang de sterren in je mand, samen mag ook' : 'Vang de sterren in je mand'
      );
      return;
    }

    legend.className = 'vang-legend';
    legend.innerHTML = `
      ${item(P_COLORS[0], 'Rode sterren in de rode mand')}
      <span class="vang-legend__sep"></span>
      ${item(P_COLORS[1], 'Groene sterren in de groene mand')}
      <span class="vang-legend__sep"></span>
      ${item(GOLD, 'Gouden sterren mogen in elke mand', true)}
    `;
  }

  function spawn() {
    const comet = cfg.comets && Math.random() < 0.16;
    // With a colour task the dice are loaded towards a colour rather than being
    // split evenly with gold: hunting for a rare own-colour star is a much less
    // generous game than it looks on paper.
    let owner = null;
    if (cfg.colorTask && Math.random() < 0.74) owner = Math.random() < 0.5 ? 0 : 1;
    return {
      x: 120 + Math.random() * (LOGICAL_WIDTH - 240),
      y: -STAR_R,
      vx: (Math.random() - 0.5) * 70,
      vy: cfg.fall * (comet ? 1.5 : 0.85 + Math.random() * 0.35),
      r: comet ? STAR_R * 1.3 : STAR_R,
      comet,
      owner,
      color: owner === null ? GOLD : P_COLORS[owner],
      rot: Math.random() * Math.PI,
      spin: (Math.random() - 0.5) * 2.4,
    };
  }

  function burst(s, count, colors, speed = 260) {
    particles.push(...createBurst(s.x, s.y, colors, { count, speed }));
    if (particles.length > PARTICLE_CAP) particles.splice(0, particles.length - PARTICLE_CAP);
  }

  function catchStar(s, index, basket) {
    falling.splice(index, 1);
    basket.dip = 0.24;
    burst(s, s.comet ? 22 : 14, [s.color, '#ffffff', withAlpha(s.color, 0.6)]);
    sfx.chime(chimeStep++);
    if (s.comet) sfx.powerup();
    caught += s.comet ? 2 : 1;
    hud.setMeter(caught / cfg.goal);
    if (caught >= cfg.goal && !finished) finishLevel();
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
      title: 'Het ruim zit vol! 🧺',
      onNext: () => { reward = null; startLevel(); },
      onRetry: () => { reward = null; level = cleared; startLevel(); },
      onHome: onExit,
    });
  }

  // --- input: a finger takes hold of the nearest basket that nobody else is
  // holding, and keeps it until it lifts. Nearest-and-free is what stops the
  // taller child from grabbing both: once a basket has a pointer, the only way
  // to take it is to wait for that hand to let go.
  function claim(e) {
    const { x } = toLogical(e.clientX, e.clientY);
    let best = null;
    let bestDist = Infinity;
    for (const b of baskets) {
      if (b.pointer !== null) continue;
      const d = Math.abs(b.x - x);
      if (d < bestDist) { bestDist = d; best = b; }
    }
    if (!best) return;
    best.pointer = e.pointerId;
    best.target = x;
  }

  const onDown = (e) => {
    if (finished) return;
    claim(e);
  };
  const onMove = (e) => {
    const { x } = toLogical(e.clientX, e.clientY);
    for (const b of baskets) {
      if (b.pointer === e.pointerId) b.target = x;
    }
  };
  const onUp = (e) => {
    for (const b of baskets) {
      if (b.pointer === e.pointerId) b.pointer = null;
    }
  };

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);

  function update(dt) {
    t += dt;

    if (!finished) {
      spawnCooldown -= dt;
      if (spawnCooldown <= 0) {
        falling.push(spawn());
        spawnCooldown = cfg.interval * (0.7 + Math.random() * 0.6);
      }
    }

    for (const b of baskets) {
      if (b.dip > 0) b.dip -= dt;
      const min = cfg.halfW + 12;
      b.target = Math.max(min, Math.min(LOGICAL_WIDTH - min, b.target));
      // Exponential follow rather than a hard set: the basket has weight, which
      // is what makes lining it up under a star feel like catching.
      b.x += (b.target - b.x) * (1 - Math.exp(-dt * 20));
    }

    for (let i = falling.length - 1; i >= 0; i--) {
      const s = falling[i];
      s.vy += 90 * dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.rot += s.spin * dt;
      if (s.x < s.r) { s.x = s.r; s.vx = Math.abs(s.vx); }
      if (s.x > LOGICAL_WIDTH - s.r) { s.x = LOGICAL_WIDTH - s.r; s.vx = -Math.abs(s.vx); }

      // The mouth is a band rather than a line, so a fast comet cannot fall
      // through the basket between two frames.
      if (s.vy > 0 && s.y + s.r * 0.5 >= BASKET_Y && s.y - s.r * 0.5 <= BASKET_Y + BASKET_H) {
        let handled = false;
        for (let k = 0; k < baskets.length; k++) {
          const b = baskets[k];
          if (Math.abs(s.x - b.x) > cfg.halfW) continue;
          if (s.owner === null || s.owner === k) {
            catchStar(s, i, b);
          } else {
            // Not a mistake, just a star that belongs to the other basket: it
            // bounces off the rim and gets another go on the way down.
            s.vy = -260;
            s.vx = Math.sign(s.x - b.x || 1) * 210;
            s.y = BASKET_Y - s.r * 0.5 - 1;
            sfx.bounce();
          }
          handled = true;
          break;
        }
        if (handled) continue;
      }

      if (s.y - s.r > LOGICAL_HEIGHT) {
        // Missing costs nothing and says nothing: a puff of dust where it hit
        // the moon, and the sky sends another one.
        falling.splice(i, 1);
        continue;
      }
      if (s.y > LOGICAL_HEIGHT - 30 && !s.dusted) {
        s.dusted = true;
        burst({ x: s.x, y: LOGICAL_HEIGHT - 10 }, 8, [withAlpha(s.color, 0.5), '#9a9280'], 140);
      }
    }
  }

  function drawBasket(b) {
    const y = BASKET_Y + (b.dip > 0 ? Math.sin(b.dip * 22) * 12 : 0);
    const w = cfg.halfW;

    drawGlow(ctx, b.color, b.x, y + BASKET_H * 0.4, w * 1.2, 0.42);

    ctx.beginPath();
    ctx.moveTo(b.x - w, y);
    ctx.lineTo(b.x + w, y);
    ctx.lineTo(b.x + w * 0.74, y + BASKET_H);
    ctx.quadraticCurveTo(b.x, y + BASKET_H + 34, b.x - w * 0.74, y + BASKET_H);
    ctx.closePath();
    ctx.fillStyle = withAlpha(b.color, 0.16);
    ctx.fill();
    ctx.strokeStyle = withAlpha(b.color, 0.9);
    ctx.lineWidth = 7;
    ctx.stroke();

    // Two weave lines: enough to read as a basket rather than as a bucket, and
    // cheaper than any texture.
    ctx.strokeStyle = withAlpha(b.color, 0.42);
    ctx.lineWidth = 4;
    for (const f of [0.36, 0.68]) {
      const half = w * (1 - f * 0.26);
      ctx.beginPath();
      ctx.moveTo(b.x - half, y + BASKET_H * f);
      ctx.lineTo(b.x + half, y + BASKET_H * f);
      ctx.stroke();
    }

    // The rim, brightest line on the board: it is the part a child aims at.
    ctx.strokeStyle = b.color;
    ctx.lineWidth = 11;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(b.x - w, y);
    ctx.lineTo(b.x + w, y);
    ctx.stroke();
    ctx.lineCap = 'butt';
  }

  function draw(dt) {
    drawSpaceBackdrop(ctx, stars, t, { scrollSpeed: 22 });

    for (const s of falling) {
      // A comet drags a tail, which is also how a child sees that it is the
      // fast one before it arrives.
      if (s.comet) {
        // A taper, not a stroked line: a round-capped line of this weight reads
        // as a tube hanging off the star rather than as something moving fast.
        const tx = s.x - s.vx * 0.13;
        const ty = s.y - s.vy * 0.13;
        const len = Math.hypot(tx - s.x, ty - s.y) || 1;
        const nx = -((ty - s.y) / len) * s.r * 0.5;
        const ny = ((tx - s.x) / len) * s.r * 0.5;
        ctx.fillStyle = withAlpha(s.color, 0.3);
        ctx.beginPath();
        ctx.moveTo(s.x + nx, s.y + ny);
        ctx.lineTo(s.x - nx, s.y - ny);
        ctx.lineTo(tx, ty);
        ctx.closePath();
        ctx.fill();
      }
      drawGlow(ctx, s.color, s.x, s.y, s.r * 1.9, 0.6);
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(s.rot);
      ctx.drawImage(starSprite(s.color), -s.r, -s.r, s.r * 2, s.r * 2);
      ctx.restore();
    }

    for (const b of baskets) drawBasket(b);

    updateAndDrawParticles(ctx, particles, dt, { gravity: 260 });
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
