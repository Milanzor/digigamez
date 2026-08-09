import './style.css';
import { createHud, showMissionComplete } from '../../shared/ui-components.js';
import {
  setupCanvas, LOGICAL_WIDTH, LOGICAL_HEIGHT,
  createStars, drawSpaceBackdrop, createBurst, updateAndDrawParticles,
  drawGlow, withAlpha,
} from '../../shared/canvas-utils.js';
import { sfx } from '../../shell/audio.js';
import { setLevel, starsForLevel } from '../../shell/progress.js';

// "Ruimtetikkertje" — the little ones run away from your finger and you catch
// them.
//
// Meteoor Meppen's craters tell a child *where* to look and the game is then
// about how fast they get there. This is the other half of that: the creatures
// are always visible and always reachable, and the game is about cornering one.
// Which is why it works with two children on the same board — a critter that
// runs from one hand runs straight into the other, and cornering is the one
// thing that is genuinely easier with two people than with one.
//
// Nobody can dominate it, and that is built into the creatures rather than into
// a rule. They tire: a critter that has been fleeing for a few seconds slows to
// a crawl and yawns, and while it does that anybody's hand can reach it — a
// three-year-old who just holds a finger still and waits gets one exactly as
// surely as a seven-year-old who chases. The caterpillar never really runs at
// all, so there is always something on the board for the smallest child.
//
// One shared counter, like Meteoor Meppen and for the same reason: with ten
// fingers on the same glass there is no honest way to say whose got there
// first, and inventing one only means arguing about it.

const TYPES = {
  blob: { emoji: '🐙', glow: '#b98cff', speed: 250, flee: 470, points: 1, r: 72, stamina: 3.4 },
  // Fast and worth two: what an older child chases while the little one is
  // happily collecting caterpillars.
  zip: { emoji: '🛸', glow: '#8fd6ff', speed: 320, flee: 620, points: 2, r: 66, stamina: 2.4 },
  // Never really flees. The board always has one thing on it that anybody can
  // catch, which is what keeps a three-year-old in the game.
  slow: { emoji: '🐛', glow: '#7ee787', speed: 120, flee: 190, points: 1, r: 76, stamina: 9 },
};

const FIELD = { x0: 90, y0: 240, x1: LOGICAL_WIDTH - 90, y1: LOGICAL_HEIGHT - 210 };
// How close a finger has to be before a critter notices it.
const PANIC_R = 340;
// A finger lands near a critter more often than on it — and unlike a bubble,
// this one is moving while the hand comes down.
const TOUCH_SLACK = 34;
const PARTICLE_CAP = 240;

let hud = null;
let handle = null;
let raf = null;
let listeners = [];
let reward = null;
let stage = null;
let level = 1;
let slug = 'tikkertje';
let mission = null;
let onExit = null;

function levelConfig(l) {
  const n = Math.max(1, l);
  return {
    goal: Math.min(6 + n * 2, 18),
    crowd: Math.min(2 + Math.ceil(n / 2), 6),
    // Everything gets brisker, and both dials cap: level 9 is the same game as
    // level 5, just quicker on its feet.
    speed: Math.min(0.8 + n * 0.12, 1.5),
    // How long a tired critter stays catchable. It never disappears entirely —
    // the rest is the thing that keeps the game winnable for the youngest.
    rest: Math.max(1.1, 2.6 - n * 0.18),
    // The fast one only joins from level 2, so the first level is a field of
    // things that can all be caught by walking after them.
    types: n >= 2 ? ['blob', 'zip', 'slow'] : ['blob', 'slow'],
  };
}

// Emoji are pre-rendered once at sprite resolution and blitted from then on:
// `fillText` shapes and rasterises a glyph on every call, which at six critters
// plus their yawns is fifty-odd text layouts a second for artwork that never
// changes.
const SPRITE_PX = 160;
const emojiCache = new Map();

function emojiSprite(emoji) {
  let sprite = emojiCache.get(emoji);
  if (sprite) return sprite;
  sprite = document.createElement('canvas');
  sprite.width = SPRITE_PX;
  sprite.height = SPRITE_PX;
  const g = sprite.getContext('2d');
  g.font = `${SPRITE_PX * 0.78}px "Apple Color Emoji", "Noto Color Emoji", "Segoe UI Emoji", sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(emoji, SPRITE_PX / 2, SPRITE_PX * 0.54);
  emojiCache.set(emoji, sprite);
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
    meter: 'Gevangen',
  });

  stage = document.createElement('div');
  stage.className = 'tik-stage';
  const canvas = document.createElement('canvas');
  canvas.className = 'tik-canvas';
  const legend = document.createElement('div');
  legend.className = 'tik-legend';
  // Drawn, not written. Two pictograms: touch one and it is yours, and the one
  // that yawns is the one that has stopped running.
  legend.innerHTML = `
    <span class="tik-legend__item" role="img" aria-label="${
      players > 1 ? 'Tik ze aan om ze te vangen, samen mag ook' : 'Tik ze aan om ze te vangen'
    }">
      <span class="tik-legend__critter">🐙</span>
      <span class="tik-legend__hand">👆</span>
      <span class="tik-legend__mark">✓</span>
    </span>
    <span class="tik-legend__sep"></span>
    <span class="tik-legend__item is-tired" role="img" aria-label="Wie gaapt is moe en makkelijk te pakken">
      <span class="tik-legend__critter">🐙</span>
      <span class="tik-legend__zzz">💤</span>
    </span>
  `;
  stage.append(canvas, legend);
  container.appendChild(stage);

  handle = setupCanvas(canvas, { alpha: false });
  const { ctx, toLogical } = handle;
  const stars = createStars(80);

  let cfg = levelConfig(level);
  let critters = [];
  let particles = [];
  let caught = 0;
  let chimeStep = 0;
  let t = 0;
  let finished = false;
  // Live fingers, in logical coordinates: the critters read this every frame
  // rather than reacting to events, so a hand that is simply held still on the
  // glass keeps pushing them away.
  const fingers = new Map();

  function startLevel() {
    cfg = levelConfig(level);
    hud.setLevel(level);
    hud.setMeter(0);
    critters = [];
    particles = [];
    caught = 0;
    chimeStep = 0;
    finished = false;
    for (let i = 0; i < cfg.crowd; i++) critters.push(spawn(false));
  }

  function spawn(fromEdge = true) {
    const key = cfg.types[Math.floor(Math.random() * cfg.types.length)];
    const type = TYPES[key];
    // A replacement walks in from the rim so a child sees it arrive; the
    // opening set is already scattered over the field.
    const x = fromEdge
      ? (Math.random() < 0.5 ? FIELD.x0 : FIELD.x1)
      : FIELD.x0 + Math.random() * (FIELD.x1 - FIELD.x0);
    return {
      key,
      type,
      x,
      y: FIELD.y0 + Math.random() * (FIELD.y1 - FIELD.y0),
      vx: 0,
      vy: 0,
      // Where it is ambling to when nothing is chasing it.
      tx: FIELD.x0 + Math.random() * (FIELD.x1 - FIELD.x0),
      ty: FIELD.y0 + Math.random() * (FIELD.y1 - FIELD.y0),
      wander: 0,
      energy: type.stamina,
      tired: 0,
      wobble: Math.random() * Math.PI * 2,
      lean: 0,
    };
  }

  function burst(c, count, colors) {
    particles.push(...createBurst(c.x, c.y, colors, { count, speed: 250 }));
    if (particles.length > PARTICLE_CAP) particles.splice(0, particles.length - PARTICLE_CAP);
  }

  function grab(c, index) {
    critters.splice(index, 1);
    burst(c, 18, [c.type.glow, '#ffffff', withAlpha(c.type.glow, 0.6)]);
    sfx.chime(chimeStep++);
    if (c.type.points > 1) sfx.powerup();
    caught += c.type.points;
    hud.setMeter(caught / cfg.goal);
    if (caught >= cfg.goal) {
      if (!finished) finishLevel();
      return;
    }
    critters.push(spawn(true));
  }

  function grabAt(x, y) {
    for (let i = critters.length - 1; i >= 0; i--) {
      const c = critters[i];
      if (Math.hypot(c.x - x, c.y - y) <= c.type.r + TOUCH_SLACK) {
        grab(c, i);
        return;
      }
    }
  }

  function finishLevel() {
    finished = true;
    fingers.clear();
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
      title: 'Allemaal gevangen! 🐙',
      onNext: () => { reward = null; startLevel(); },
      onRetry: () => { reward = null; level = cleared; startLevel(); },
      onHome: onExit,
    });
  }

  // --- input: a finger both scares and catches, and it keeps doing both while
  // it slides, because a child chases with a hand on the glass rather than with
  // a series of taps.
  const onDown = (e) => {
    if (finished) return;
    const p = toLogical(e.clientX, e.clientY);
    fingers.set(e.pointerId, p);
    grabAt(p.x, p.y);
  };
  const onMove = (e) => {
    if (finished || !fingers.has(e.pointerId)) return;
    const p = toLogical(e.clientX, e.clientY);
    fingers.set(e.pointerId, p);
    grabAt(p.x, p.y);
  };
  const onUp = (e) => fingers.delete(e.pointerId);

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);

  function update(dt) {
    t += dt;

    for (const c of critters) {
      c.wobble += dt * 6;

      // Flee: the sum of every finger nearby, so a critter squeezed between two
      // hands is pushed out sideways instead of straight into one of them.
      let fx = 0;
      let fy = 0;
      let threat = 0;
      for (const f of fingers.values()) {
        const dx = c.x - f.x;
        const dy = c.y - f.y;
        const d = Math.hypot(dx, dy);
        if (d > PANIC_R || d === 0) continue;
        const w = 1 - d / PANIC_R;
        fx += (dx / d) * w;
        fy += (dy / d) * w;
        threat = Math.max(threat, w);
      }

      // Corners are where a chase ends, so the walls push back a little too —
      // otherwise a critter presses itself into a corner and the catch stops
      // being a chase and becomes a formality.
      if (c.x < FIELD.x0 + 200) fx += (1 - (c.x - FIELD.x0) / 200) * 0.9;
      if (c.x > FIELD.x1 - 200) fx -= (1 - (FIELD.x1 - c.x) / 200) * 0.9;
      if (c.y < FIELD.y0 + 160) fy += (1 - (c.y - FIELD.y0) / 160) * 0.9;
      if (c.y > FIELD.y1 - 160) fy -= (1 - (FIELD.y1 - c.y) / 160) * 0.9;

      const fleeing = threat > 0 && c.tired <= 0;
      if (fleeing) {
        c.energy -= dt;
        if (c.energy <= 0) {
          c.tired = cfg.rest;
          c.energy = c.type.stamina;
        }
      } else if (c.tired > 0) {
        c.tired -= dt;
      } else {
        c.energy = Math.min(c.type.stamina, c.energy + dt * 0.8);
      }

      let speed;
      if (c.tired > 0) {
        // Worn out: it keeps moving, but at a pace anybody's hand can beat.
        speed = c.type.speed * 0.22;
      } else if (threat > 0) {
        speed = (c.type.speed + (c.type.flee - c.type.speed) * threat) * cfg.speed;
      } else {
        speed = c.type.speed * 0.55;
      }

      let dirX;
      let dirY;
      if (fx !== 0 || fy !== 0) {
        const len = Math.hypot(fx, fy);
        dirX = fx / len;
        dirY = fy / len;
      } else {
        // Nothing nearby: amble towards a point on the field, and pick a new
        // one once it gets there, so the board is never still.
        c.wander -= dt;
        const dx = c.tx - c.x;
        const dy = c.ty - c.y;
        const d = Math.hypot(dx, dy);
        if (d < 60 || c.wander <= 0) {
          c.tx = FIELD.x0 + Math.random() * (FIELD.x1 - FIELD.x0);
          c.ty = FIELD.y0 + Math.random() * (FIELD.y1 - FIELD.y0);
          c.wander = 2 + Math.random() * 3;
        }
        dirX = d === 0 ? 0 : dx / d;
        dirY = d === 0 ? 0 : dy / d;
      }

      // Steering rather than teleporting the velocity: a critter that turns has
      // a moment where it is slow, and that moment is the catch.
      const wantX = dirX * speed;
      const wantY = dirY * speed;
      const turn = 1 - Math.exp(-dt * (c.tired > 0 ? 4 : 9));
      c.vx += (wantX - c.vx) * turn;
      c.vy += (wantY - c.vy) * turn;
      c.x += c.vx * dt;
      c.y += c.vy * dt;

      c.x = Math.max(FIELD.x0, Math.min(FIELD.x1, c.x));
      c.y = Math.max(FIELD.y0, Math.min(FIELD.y1, c.y));
      c.lean += (Math.max(-0.4, Math.min(0.4, c.vx / 900)) - c.lean) * (1 - Math.exp(-dt * 8));
    }

    // Keep them out of each other's laps. Two critters on the same spot are one
    // target that pays twice as much and reads as a drawing bug, and it happens
    // constantly because they all flee the same finger in the same direction.
    for (let i = 0; i < critters.length; i++) {
      for (let j = i + 1; j < critters.length; j++) {
        const a = critters[i];
        const b = critters[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy);
        const min = (a.type.r + b.type.r) * 0.9;
        if (d === 0 || d >= min) continue;
        const push = ((min - d) / 2) * 0.5;
        a.x -= (dx / d) * push;
        a.y -= (dy / d) * push;
        b.x += (dx / d) * push;
        b.y += (dy / d) * push;
      }
    }
  }

  function draw(dt) {
    drawSpaceBackdrop(ctx, stars, t, { scrollSpeed: 8 });

    for (const c of critters) {
      const bob = Math.sin(c.wobble) * (c.tired > 0 ? 3 : 7);
      const r = c.type.r;
      // A tired one dims: the halo is the signal that this is the catchable one,
      // and it reads from the back of the room where a 💤 does not.
      drawGlow(ctx, c.type.glow, c.x, c.y + bob, r * 1.5, c.tired > 0 ? 0.28 : 0.55);

      ctx.save();
      ctx.translate(c.x, c.y + bob);
      ctx.rotate(c.lean);
      ctx.drawImage(emojiSprite(c.type.emoji), -r, -r, r * 2, r * 2);
      ctx.restore();

      if (c.tired > 0) {
        const z = r * 0.6;
        ctx.globalAlpha = Math.min(1, c.tired * 2);
        ctx.drawImage(
          emojiSprite('💤'),
          c.x + r * 0.45, c.y + bob - r * 1.15, z, z
        );
        ctx.globalAlpha = 1;
      }
    }

    updateAndDrawParticles(ctx, particles, dt, { gravity: 120 });
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
