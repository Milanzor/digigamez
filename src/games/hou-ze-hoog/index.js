import './style.css';
import { createHud, showMissionComplete } from '../../shared/ui-components.js';
import {
  setupCanvas, LOGICAL_WIDTH, LOGICAL_HEIGHT,
  createStars, drawSpaceBackdrop, createBurst, updateAndDrawParticles,
  drawGlow, withAlpha,
} from '../../shared/canvas-utils.js';
import { sfx } from '../../shell/audio.js';
import { setLevel, starsForLevel } from '../../shell/progress.js';

// "Hou Ze Hoog" — bat the floating moons upward and charge them into stars.
//
// Zeepbellen with the verb turned around. There a bubble disappears the moment
// it is touched; here a touch *pushes*, and the thing that was touched carries
// on existing, falls back, bumps into its neighbour and comes down somewhere
// else. That is the whole reason this exists next to it: a two-year-old who has
// learned "finger makes it go away" gets handed "finger makes it move", which
// is the same gesture teaching a different piece of physics.
//
// Nothing can be lost. The bottom of the screen is a nebula cushion, not a
// floor to be defended: a moon that lands on it squashes, bounces and waits
// there to be batted again. There is no run to break and no timer, so the
// difference between a child who bats every moon and one who watches one moon
// bob is only how fast the ring closes.
//
// The rule is the ring. Every bat fills a little more of an amber arc around
// the moon, and when it closes the moon bursts into stars — so a child sees
// exactly how much of the job is left without a single number, and the amber is
// the same "this is the progress" language the portal uses on every row.

const COLORS = ['#b98cff', '#ff8fc7', '#8fd6ff', '#5fe3c4', '#ffa14a'];

// The board's top ~150 logical rows belong to the HUD, and the cushion owns the
// bottom band, so the playable air is what is left between them.
const CEIL_Y = 190;
const FLOOR_Y = LOGICAL_HEIGHT - 168;

// A finger lands near a moon far more often than on it, exactly as in
// Zeepbellen — and here missing is worse, because a miss is a bat that never
// happened rather than a bubble that survives.
const TOUCH_SLACK = 30;
// A finger resting on a moon would otherwise machine-gun it: pointermove fires
// dozens of times a second and every one of them would be a bat.
const BAT_COOLDOWN = 0.24;
const PARTICLE_CAP = 240;

let hud = null;
let handle = null;
let raf = null;
let listeners = [];
let reward = null;
let stage = null;
let level = 1;
let slug = 'hou-ze-hoog';
let mission = null;
let onExit = null;

function levelConfig(l) {
  const n = Math.max(1, l);
  return {
    goal: Math.min(4 + n * 2, 14),
    // How many moons hang in the air at once.
    crowd: Math.min(2 + n, 7),
    gravity: Math.min(300 + n * 45, 560),
    // Bats needed to fill the ring. One at level 1: the first thing a small
    // child does has to be the thing that pays off, or they never find out
    // that batting is what the game wants.
    need: Math.min(Math.ceil((n + 1) / 2), 4),
    minR: Math.max(64, 108 - n * 5),
    maxR: Math.max(88, 142 - n * 6),
  };
}

// Moons are pre-rendered per colour: a lit sphere is three gradient fills, and
// seven of them a frame at 4K is three hundred thousand interpolated pixels for
// something that never changes shape. One `drawImage` each instead.
const SPRITE_PX = 256;
const orbCache = new Map();

function orbSprite(color) {
  let sprite = orbCache.get(color);
  if (sprite) return sprite;
  sprite = document.createElement('canvas');
  sprite.width = SPRITE_PX;
  sprite.height = SPRITE_PX;
  const g = sprite.getContext('2d');
  const c = SPRITE_PX / 2;
  const r = c - 6;

  // Lit from the upper left like everything else in this app, so a screen full
  // of moons agrees with the nebula behind them about where the sun is.
  const body = g.createRadialGradient(c - r * 0.34, c - r * 0.36, r * 0.1, c, c, r);
  body.addColorStop(0, withAlpha(color, 0.98));
  body.addColorStop(0.55, withAlpha(color, 0.6));
  body.addColorStop(1, withAlpha(color, 0.22));
  g.fillStyle = body;
  g.beginPath();
  g.arc(c, c, r, 0, Math.PI * 2);
  g.fill();

  // Rim light: without it the sphere reads as a flat disc against the void.
  g.strokeStyle = withAlpha(color, 0.9);
  g.lineWidth = 4;
  g.beginPath();
  g.arc(c, c, r - 2, 0, Math.PI * 2);
  g.stroke();

  g.fillStyle = 'rgba(255,255,255,0.72)';
  g.beginPath();
  g.arc(c - r * 0.36, c - r * 0.4, r * 0.16, 0, Math.PI * 2);
  g.fill();

  // Two craters, so a spinning moon shows that it is spinning.
  g.fillStyle = 'rgba(0,0,0,0.16)';
  g.beginPath();
  g.arc(c + r * 0.3, c + r * 0.22, r * 0.2, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.arc(c - r * 0.05, c + r * 0.45, r * 0.12, 0, Math.PI * 2);
  g.fill();

  orbCache.set(color, sprite);
  return sprite;
}

// The cushion never changes, so it is one stretched blit rather than a gradient
// rebuilt every frame.
let cushionSprite = null;

function cushion() {
  if (cushionSprite) return cushionSprite;
  cushionSprite = document.createElement('canvas');
  cushionSprite.width = 1;
  cushionSprite.height = 128;
  const g = cushionSprite.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 0, 128);
  grad.addColorStop(0, 'rgba(185,140,255,0.42)');
  grad.addColorStop(0.35, 'rgba(122,90,190,0.28)');
  grad.addColorStop(1, 'rgba(20,14,48,0.05)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 1, 128);
  return cushionSprite;
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
    meter: 'Sterren',
  });

  stage = document.createElement('div');
  stage.className = 'hoog-stage';
  const canvas = document.createElement('canvas');
  canvas.className = 'hoog-canvas';
  const legend = document.createElement('div');
  legend.className = 'hoog-legend';
  // Drawn, not written: a moon, a finger under it and an arrow up. A child of
  // two reads that and would read "tik de manen omhoog" as a blank wall.
  legend.innerHTML = `
    <span class="hoog-legend__item" role="img" aria-label="${
      players > 1 ? 'Tik de manen omhoog, samen mag ook' : 'Tik de manen omhoog'
    }">
      <span class="hoog-legend__orb" style="--c:#b98cff"></span>
      <span class="hoog-legend__arrow">⬆</span>
      <span class="hoog-legend__hand">👆</span>
    </span>
  `;
  stage.append(canvas, legend);
  container.appendChild(stage);

  handle = setupCanvas(canvas, { alpha: false });
  const { ctx, toLogical } = handle;
  const stars = createStars(90);

  let cfg = levelConfig(level);
  let orbs = [];
  let particles = [];
  let charged = 0;
  let chimeStep = 0;
  let blubStep = 0;
  let t = 0;
  let finished = false;

  function startLevel() {
    cfg = levelConfig(level);
    hud.setLevel(level);
    hud.setMeter(0);
    orbs = [];
    particles = [];
    charged = 0;
    chimeStep = 0;
    finished = false;
    for (let i = 0; i < cfg.crowd; i++) orbs.push(spawn(false));
  }

  function spawn(fromTop = true) {
    const r = cfg.minR + Math.random() * (cfg.maxR - cfg.minR);
    return {
      x: r + Math.random() * (LOGICAL_WIDTH - r * 2),
      // A replacement drops in from the ceiling so a child sees where it came
      // from; the opening set is scattered through the air instead, because a
      // level that starts with everything raining down starts as a mess.
      y: fromTop ? CEIL_Y + r : CEIL_Y + r + Math.random() * (FLOOR_Y - CEIL_Y - r * 2),
      vx: (Math.random() - 0.5) * 140,
      vy: 0,
      r,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      charge: 0,
      cool: 0,
      // Ticks down after a bat or a bounce and squashes the sprite while it does.
      squish: 0,
      spin: (Math.random() - 0.5) * 1.4,
      rot: Math.random() * Math.PI * 2,
    };
  }

  function burst(o, count, colors) {
    particles.push(...createBurst(o.x, o.y, colors, { count, speed: 260 }));
    if (particles.length > PARTICLE_CAP) particles.splice(0, particles.length - PARTICLE_CAP);
  }

  function bat(o, fromX, fromY) {
    o.cool = BAT_COOLDOWN;
    o.squish = 0.26;
    // Away from the finger horizontally, always up vertically: a moon batted
    // downward would be a punishment for hitting it from above, and there is
    // no way for a small child to know which side they came at it from.
    const dx = o.x - fromX;
    const away = Math.abs(dx) < 1 ? (Math.random() - 0.5) : dx;
    o.vx += Math.sign(away) * (150 + Math.random() * 90);
    // Lighter moons hop higher, which is the only physics lesson in here and
    // the one a child can feel rather than be told.
    o.vy = -520 * Math.sqrt(96 / o.r);
    o.spin += Math.sign(away) * 1.2;

    o.charge += 1;
    sfx.chime(chimeStep++);
    if (o.charge < cfg.need) return;

    // The ring closed: the moon goes off as a handful of stars and another one
    // drops in behind it, so the air never thins out.
    const i = orbs.indexOf(o);
    if (i >= 0) orbs.splice(i, 1);
    burst(o, 20, [o.color, '#ffc24a', '#ffffff']);
    sfx.powerup();
    charged++;
    hud.setMeter(charged / cfg.goal);
    if (charged >= cfg.goal) {
      if (!finished) finishLevel();
      return;
    }
    orbs.push(spawn(true));
  }

  function batAt(clientX, clientY) {
    const { x, y } = toLogical(clientX, clientY);
    // Front to back, so the moon drawn on top is the one that takes the hit.
    for (let i = orbs.length - 1; i >= 0; i--) {
      const o = orbs[i];
      if (o.cool > 0) continue;
      if (Math.hypot(o.x - x, o.y - y) <= o.r + TOUCH_SLACK) {
        bat(o, x, y);
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
      title: 'Allemaal sterren! 🎈',
      onNext: () => { reward = null; startLevel(); },
      onRetry: () => { reward = null; level = cleared; startLevel(); },
      onHome: onExit,
    });
  }

  // --- input: every finger bats on its own and a sweep keeps batting, because
  // a small child wipes a hand across the glass rather than aiming taps.
  const dragging = new Set();
  const onDown = (e) => {
    if (finished) return;
    dragging.add(e.pointerId);
    batAt(e.clientX, e.clientY);
  };
  const onMove = (e) => {
    if (finished || !dragging.has(e.pointerId)) return;
    batAt(e.clientX, e.clientY);
  };
  const onUp = (e) => dragging.delete(e.pointerId);

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);

  function collide(a, b) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dist = Math.hypot(dx, dy);
    const min = a.r + b.r;
    if (dist === 0 || dist >= min) return;
    const nx = dx / dist;
    const ny = dy / dist;
    const ma = a.r * a.r;
    const mb = b.r * b.r;
    const total = ma + mb;

    // Push apart by mass share, so a small moon bounces off a big one rather
    // than shoving it aside.
    const overlap = min - dist;
    a.x -= nx * overlap * (mb / total);
    a.y -= ny * overlap * (mb / total);
    b.x += nx * overlap * (ma / total);
    b.y += ny * overlap * (ma / total);

    const rvn = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
    if (rvn > 0) return;
    const j = (-1.82 * rvn) / (1 / ma + 1 / mb);
    a.vx -= (j * nx) / ma;
    a.vy -= (j * ny) / ma;
    b.vx += (j * nx) / mb;
    b.vy += (j * ny) / mb;
    a.squish = Math.max(a.squish, 0.14);
    b.squish = Math.max(b.squish, 0.14);
  }

  function update(dt) {
    t += dt;

    for (const o of orbs) {
      if (o.cool > 0) o.cool -= dt;
      if (o.squish > 0) o.squish -= dt;
      o.vy += cfg.gravity * dt;
      // Air drag, so a well-batted moon settles instead of pinballing forever.
      o.vx *= 1 - Math.min(1, dt * 0.55);
      o.x += o.vx * dt;
      o.y += o.vy * dt;
      o.rot += o.spin * dt;
      o.spin *= 1 - Math.min(1, dt * 0.4);

      if (o.x < o.r) { o.x = o.r; o.vx = Math.abs(o.vx) * 0.8; }
      if (o.x > LOGICAL_WIDTH - o.r) { o.x = LOGICAL_WIDTH - o.r; o.vx = -Math.abs(o.vx) * 0.8; }
      if (o.y - o.r < CEIL_Y) { o.y = CEIL_Y + o.r; o.vy = Math.abs(o.vy) * 0.45; }

      // The cushion is buoyant rather than solid. A floor would end every moon
      // the same way — a dead row of them sitting on a line, waiting — whereas
      // a moon that sinks into the nebula and is pushed back out keeps bobbing,
      // so the board is alive even while nobody is touching it. The spring also
      // sorts the sizes out by itself: a small moon rides high, a big one sits
      // deep, without a word of special-casing.
      const depth = o.y + o.r - FLOOR_Y;
      if (depth > 0) {
        if (!o.wet && o.vy > 240) {
          o.squish = 0.22;
          sfx.blub(blubStep++);
        }
        o.wet = true;
        o.vy -= Math.min(depth, 70) * 40 * dt;
        o.vy *= 1 - Math.min(1, dt * 2.4);
        // However hard it was thrown down, it never sinks out of reach.
        if (o.y + o.r > FLOOR_Y + 130) {
          o.y = FLOOR_Y + 130 - o.r;
          o.vy = Math.min(o.vy, 0);
        }
      } else {
        o.wet = false;
      }
    }

    for (let i = 0; i < orbs.length; i++) {
      for (let j = i + 1; j < orbs.length; j++) collide(orbs[i], orbs[j]);
    }
  }

  function draw(dt) {
    drawSpaceBackdrop(ctx, stars, t, { scrollSpeed: 6 });

    // The cushion, drawn before the moons so one resting on it sits *in* the
    // nebula rather than on a line.
    ctx.drawImage(cushion(), 0, FLOOR_Y - 26, LOGICAL_WIDTH, LOGICAL_HEIGHT - FLOOR_Y + 26);
    ctx.strokeStyle = 'rgba(243,236,224,0.22)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, FLOOR_Y);
    ctx.lineTo(LOGICAL_WIDTH, FLOOR_Y);
    ctx.stroke();

    for (const o of orbs) {
      const s = o.squish > 0 ? 1 + Math.sin(o.squish * 26) * 0.11 : 1;
      const w = o.r * 2 * s;
      const h = (o.r * 2) / s;
      drawGlow(ctx, o.color, o.x, o.y, o.r * 1.45, 0.5);

      ctx.save();
      ctx.translate(o.x, o.y);
      ctx.rotate(o.rot);
      ctx.drawImage(orbSprite(o.color), -w / 2, -h / 2, w, h);
      ctx.restore();

      // The ring: how much of this moon is charged, in the one action colour.
      // It is deliberately outside the sprite, so a spinning moon does not
      // spin its own progress bar.
      if (cfg.need > 1) {
        const ring = o.r + 15;
        // The empty track is deliberately thinner and fainter than the fill: at
        // equal weight a screenful of them reads as a second dull ring around
        // every moon rather than as an empty gauge.
        ctx.lineWidth = 5;
        ctx.strokeStyle = 'rgba(255,194,74,0.12)';
        ctx.beginPath();
        ctx.arc(o.x, o.y, ring, 0, Math.PI * 2);
        ctx.stroke();
        if (o.charge > 0) {
          ctx.lineWidth = 9;
          ctx.strokeStyle = '#ffc24a';
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.arc(o.x, o.y, ring, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (o.charge / cfg.need));
          ctx.stroke();
          ctx.lineCap = 'butt';
        }
      }
    }

    updateAndDrawParticles(ctx, particles, dt, { gravity: -40 });
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
