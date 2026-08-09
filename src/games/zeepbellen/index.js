import './style.css';
import { createHud, showMissionComplete } from '../../shared/ui-components.js';
import {
  setupCanvas, LOGICAL_WIDTH, LOGICAL_HEIGHT,
  createStars, drawSpaceBackdrop, createBurst, updateAndDrawParticles,
  drawGlow, withAlpha,
} from '../../shared/canvas-utils.js';
import { sfx } from '../../shell/audio.js';
import { setLevel, starsForLevel } from '../../shell/progress.js';
import { getItem, setItem } from '../../shell/storage.js';

// "Zeepbellen" — pop soap bubbles that drift up out of the airlock.
//
// This is the game you hand a two-year-old: there is nothing to aim at, no
// timer, and ten fingers work at once, so two children can stand at the board
// without taking turns. Depth arrives quietly — bubbles get smaller, then the
// big ones split in two, and only from level 4 is there an actual instruction
// ("pop only the blue ones"), which a wrongly poked bubble answers by bouncing
// away rather than by costing anything.
//
// That instruction is shown as a picture, never as a sentence. The children this
// game is for cannot read, so a legend of the actual bubbles — the wanted one
// ticked, the others crossed — is the only version of the rule that reaches
// them. It doubles as the colour key for the child who *can* read and would
// otherwise have to match a colour word to a bubble.
//
// Bubbles also leave the airlock with a shove rather than drifting up from
// below the edge: spawning a screen's width of travel out of sight meant the
// first second of every level was an empty stage, and the child was waiting on
// the game instead of the other way round.
//
// ── The pace is a choice, not a level ─────────────────────────────────────
// The level ladder turns every dial at once, and that was the problem: a child
// who is happy at level 2 has to accept level 6's speed to see level 6's
// bubbles. So the pace is now asked up front, the way Ruimte Invasie asks for
// its difficulty and Raketrace for its lane count — a grown-up at the board can
// put a two-year-old on "Rustig" and their older sister on "Wild" and both of
// them get the same game at the speed they can play it. Rustig never turns the
// colour rule on at all; Wild brings it forward to level 2.
//
// ── Four kinds of bubble ──────────────────────────────────────────────────
// A screen of identical bubbles is a screen you stop looking at. There are now
// four: an ordinary one, a giant that breaks into a handful of small ones, a
// gold star bubble that pops the whole screen in a cascade, and one with a
// passenger inside who flies off waving. None of them can be a bad thing to
// touch — every surprise in here is a good one, because a two-year-old cannot
// tell "avoid this" apart from "this game hurt me".

const COLORS = [
  { hex: '#8fd6ff', name: 'blauwe' },
  { hex: '#ff8fc7', name: 'roze' },
  { hex: '#7ee787', name: 'groene' },
  { hex: '#ffc24a', name: 'gele' },
];

const STAR_COLOR = '#ffe08a';
const RIDERS = ['👽', '🐙', '🛸', '🐛', '🦑', '🤖'];

// Popping is the whole game, so the hit area is the bubble plus a fat margin:
// a toddler's finger lands near a bubble far more often than on it.
const TOUCH_SLACK = 34;
const PARTICLE_CAP = 320;

// Asked once, on arrival, and remembered. The dials are multipliers on the
// level ladder rather than a second ladder of their own, so a child keeps their
// place in the game when the pace is changed for them.
const DIFFICULTIES = [
  {
    id: 'rustig', icon: '🐢', label: 'Rustig', sub: 'Grote bellen, rustig omhoog',
    crowd: -3, rise: 0.66, size: 1.2, goal: 0.7, colorFrom: Infinity,
  },
  {
    id: 'gewoon', icon: '🫧', label: 'Gewoon', sub: 'Zoals altijd',
    crowd: 0, rise: 1, size: 1, goal: 1, colorFrom: 4,
  },
  {
    id: 'wild', icon: '🌪️', label: 'Wild', sub: 'Veel bellen, snel omhoog',
    crowd: 3, rise: 1.34, size: 0.84, goal: 1.25, colorFrom: 2,
  },
];

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

function levelConfig(l, diff) {
  const n = Math.max(1, l);
  return {
    goal: Math.max(6, Math.round(Math.min(10 + n * 2, 26) * diff.goal)),
    // How many bubbles may be in the air at once, and how fast they climb.
    crowd: Math.max(4, Math.min(6 + n, 13) + diff.crowd),
    rise: Math.min(74 + n * 9, 150) * diff.rise,
    minR: Math.max(52, 96 - n * 6) * diff.size,
    maxR: Math.max(78, 132 - n * 7) * diff.size,
    split: n >= 3,
    // The one instruction in the game, and deliberately the last dial to turn.
    colorTask: n >= diff.colorFrom,
    // The treats. A giant is worth reaching for, a passenger is worth watching,
    // and the star is the once-a-level moment the whole screen goes off.
    giant: n >= 2 ? 0.1 : 0,
    star: n >= 2 ? 0.05 : 0.025,
    rider: 0.14,
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

// Passengers and the star are emoji, and `fillText` shapes and rasterises a
// glyph on every call — so they get the same treatment the bubbles do.
const EMOJI_PX = 128;
const emojiCache = new Map();

function emojiSprite(emoji) {
  let sprite = emojiCache.get(emoji);
  if (sprite) return sprite;
  sprite = document.createElement('canvas');
  sprite.width = EMOJI_PX;
  sprite.height = EMOJI_PX;
  const g = sprite.getContext('2d');
  g.font = `${EMOJI_PX * 0.78}px "Apple Color Emoji", "Noto Color Emoji", "Segoe UI Emoji", sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(emoji, EMOJI_PX / 2, EMOJI_PX * 0.54);
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
    meter: 'Bellen',
  });

  stage = document.createElement('div');
  stage.className = 'bub-stage';
  const canvas = document.createElement('canvas');
  canvas.className = 'bub-canvas';
  const legend = document.createElement('div');
  legend.className = 'bub-legend';
  stage.append(canvas, legend);
  container.appendChild(stage);

  handle = setupCanvas(canvas, { alpha: false });
  const { ctx, toLogical } = handle;
  const stars = createStars(90);

  let diff = DIFFICULTIES.find((d) => d.id === getItem('bub-difficulty', 'gewoon')) || DIFFICULTIES[1];
  let cfg = levelConfig(level, diff);
  let bubbles = [];
  let flyers = [];
  let particles = [];
  let popped = 0;
  let chimeStep = 0;
  let target = null;
  let t = 0;
  let spawnCooldown = 0;
  let finished = false;
  // A run of pops in quick succession climbs the scale and throws more confetti.
  // It is never named or counted on screen: the reward for a good run is that it
  // sounds and looks better, which is the only kind of score a two-year-old reads.
  let chain = 0;
  let chainTimer = 0;
  // Counts down after the last bubble, so the level ends on the cascade rather
  // than cutting to the reward panel mid-pop.
  let rewardIn = 0;
  // The picker is up: the loop runs (the starfield is already alive) but nothing
  // spawns until a pace has been chosen.
  let waiting = true;

  function startLevel() {
    cfg = levelConfig(level, diff);
    hud.setLevel(level);
    hud.setMeter(0);
    bubbles = [];
    flyers = [];
    particles = [];
    popped = 0;
    chimeStep = 0;
    chain = 0;
    rewardIn = 0;
    finished = false;
    target = cfg.colorTask ? COLORS[Math.floor(Math.random() * COLORS.length)] : null;
    renderLegend();
    // A few already in the air, so the screen is never empty on arrival.
    for (let i = 0; i < Math.min(4, cfg.crowd); i++) {
      bubbles.push(spawn(LOGICAL_HEIGHT * (0.35 + Math.random() * 0.6), 0));
    }
  }

  // The rule, drawn rather than written. Without a colour task there is nothing
  // to explain — a finger on a bubble is the whole game — so the legend shrinks
  // to that one pictogram instead of asserting a rule that does not exist.
  function renderLegend() {
    if (!target) {
      legend.className = 'bub-legend bub-legend--simple';
      legend.innerHTML = `
        <span class="bub-legend__item" role="img" aria-label="${
          players > 1 ? 'Prik de bellen, samen mag ook' : 'Prik de bellen'
        }">
          <span class="bub-legend__bub" style="--c:#8fd6ff"></span>
          <span class="bub-legend__mark bub-legend__mark--tap">👆</span>
        </span>
      `;
      return;
    }

    // Wanted colour first and biggest, then a hairline, then every colour that
    // is not wanted — each crossed out on its own, because one cross over a
    // group is a piece of grammar a three-year-old has not learned yet.
    const others = COLORS.filter((c) => c !== target);
    legend.className = 'bub-legend';
    legend.innerHTML = `
      <span class="bub-legend__item is-yes" role="img" aria-label="Prik alleen de ${target.name} bellen">
        <span class="bub-legend__bub" style="--c:${target.hex}"></span>
        <span class="bub-legend__mark bub-legend__mark--yes">✓</span>
      </span>
      <span class="bub-legend__sep"></span>
      ${others.map((c) => `
        <span class="bub-legend__item is-no" role="img" aria-label="Niet de ${c.name} bellen">
          <span class="bub-legend__bub" style="--c:${c.hex}"></span>
          <span class="bub-legend__mark bub-legend__mark--no">✕</span>
        </span>
      `).join('')}
    `;
  }

  function spawn(y = null, boost = null) {
    let kind = 'gewoon';
    const roll = Math.random();
    if (roll < cfg.star) kind = 'ster';
    else if (roll < cfg.star + cfg.giant) kind = 'reus';
    else if (roll < cfg.star + cfg.giant + cfg.rider) kind = 'passagier';

    let r = cfg.minR + Math.random() * (cfg.maxR - cfg.minR);
    if (kind === 'reus') r = cfg.maxR * 1.5;
    if (kind === 'ster') r = cfg.maxR * 0.95;

    // With a colour task, load the dice towards the wanted colour: hunting for
    // a rare blue bubble is a different, much less generous game.
    let color = COLORS[Math.floor(Math.random() * COLORS.length)];
    if (target && Math.random() < 0.5) color = target;
    // A passenger always arrives in the wanted colour. Otherwise the colour
    // rule would put an alien on the board that a child is not allowed to let
    // out, which is the one shape of disappointment this game does not have.
    if (target && kind === 'passagier') color = target;

    return {
      kind,
      x: r + Math.random() * (LOGICAL_WIDTH - r * 2),
      // Just clear of the rim rather than a screenful below it, so the climb a
      // child watches is the whole climb.
      y: y === null ? LOGICAL_HEIGHT + r * 0.5 : y,
      r,
      color,
      rider: kind === 'passagier' ? RIDERS[Math.floor(Math.random() * RIDERS.length)] : null,
      vx: (Math.random() - 0.5) * 40,
      // A giant is heavy and a star is buoyant, so the two treats are also the
      // two bubbles that move differently from everything else on screen.
      rise: cfg.rise * (kind === 'reus' ? 0.62 : kind === 'ster' ? 1.25 : 1) * (0.75 + Math.random() * 0.5),
      // The shove out of the airlock, which decays into the ordinary float.
      // A real bubble leaves a nozzle fast and then settles, and the useful
      // side effect is that it is in reach immediately instead of hanging
      // around the bottom edge where nobody is looking.
      boost: boost === null ? 300 + Math.random() * 120 : boost,
      phase: Math.random() * Math.PI * 2,
      wobble: 0.5 + Math.random() * 0.7,
      // Ticks down after a wrong poke: the bubble squashes and dodges.
      nudge: 0,
      // Set by the star cascade: this bubble goes off by itself in this many
      // seconds. A countdown rather than a timer, so nothing survives `destroy`.
      popIn: 0,
      spin: (Math.random() - 0.5) * 1.6,
      rot: 0,
    };
  }

  function burst(b, colors, count) {
    particles.push(...createBurst(b.x, b.y, colors, { count, speed: 210 }));
    if (particles.length > PARTICLE_CAP) particles.splice(0, particles.length - PARTICLE_CAP);
  }

  function isWanted(b) {
    // The star ignores the colour rule. It is gold, which is not one of the four
    // playable colours, so under the rule it could never be popped at all — and
    // a treat that has to be left alone is not a treat.
    return !target || b.kind === 'ster' || b.color === target;
  }

  function pop(b, index, byCascade = false) {
    // A cascade ignores the colour rule: the star was earned by popping it, and
    // a screen-clearing treat that skips half the screen is not a treat.
    if (!byCascade && !isWanted(b)) {
      // Not a mistake, just a bubble that does not want to be popped: it
      // squashes, slides away and stays in play.
      b.nudge = 0.32;
      b.vx = (b.vx >= 0 ? 1 : -1) * 190;
      sfx.bounce();
      return;
    }

    bubbles.splice(index, 1);

    if (!byCascade) {
      chain += 1;
      chainTimer = 1.3;
    }
    // The run is heard before it is seen: each pop is the next note of a
    // pentatonic run, so a busy screen sounds like a xylophone being played
    // rather than like a stack of blips.
    const fizz = Math.min(chain, 10);
    burst(b, [b.color.hex, '#ffffff', withAlpha(b.color.hex, 0.6)], 14 + fizz);
    sfx.chime(chimeStep++);

    if (b.kind === 'passagier') {
      // The passenger gets out. It counts as one bubble like any other — the
      // reward for finding one is watching it leave, not points.
      flyers.push({
        emoji: b.rider,
        x: b.x, y: b.y,
        vx: (Math.random() - 0.5) * 220,
        vy: -220 - Math.random() * 120,
        rot: 0,
        spin: (Math.random() - 0.5) * 5,
        size: b.r * 0.95,
        life: 1,
      });
      sfx.blub(chimeStep);
    }

    if (b.kind === 'ster') {
      // The whole screen goes, one after another from the star outwards. Each
      // gets a delay rather than a timer so the cascade cannot outlive the
      // game module.
      sfx.levelUp();
      burst(b, [STAR_COLOR, '#ffffff', '#ffc24a'], 30);
      const ordered = [...bubbles].sort(
        (p, q) => Math.hypot(p.x - b.x, p.y - b.y) - Math.hypot(q.x - b.x, q.y - b.y)
      );
      ordered.forEach((other, i) => { other.popIn = 0.07 + i * 0.07; });
    }

    if (b.kind === 'reus') {
      // A giant is worth a handful: it comes apart into five that spring away
      // in a fan, and each of those is an ordinary bubble again.
      for (let i = 0; i < 5; i++) {
        const a = (Math.PI * 2 * i) / 5;
        bubbles.push({
          ...b,
          kind: 'gewoon',
          rider: null,
          r: b.r * 0.34,
          x: b.x + Math.cos(a) * b.r * 0.4,
          y: b.y + Math.sin(a) * b.r * 0.4,
          vx: Math.cos(a) * 260,
          boost: 90,
          nudge: 0,
          popIn: 0,
        });
      }
    } else if (cfg.split && b.kind === 'gewoon' && b.r > cfg.minR * 1.25) {
      // A big bubble is worth two: it breaks into a pair that drift apart.
      for (const dir of [-1, 1]) {
        bubbles.push({
          ...b,
          r: b.r * 0.62,
          x: b.x + dir * b.r * 0.4,
          vx: dir * 120,
          // A little of the pop's energy, so the pair springs apart instead of
          // inheriting whatever was left of the parent's launch shove.
          boost: 90,
          nudge: 0,
          popIn: 0,
        });
      }
    }

    // Every fifth pop in a run throws real confetti. Nothing is ever taken away
    // when the run ends — it simply goes quiet again.
    if (!byCascade && chain > 0 && chain % 5 === 0) {
      particles.push(...createBurst(b.x, b.y, ['#ffc24a', '#5fe3c4', '#ff8fc7', '#ffffff'], {
        count: 34, speed: 380,
      }));
      if (particles.length > PARTICLE_CAP) particles.splice(0, particles.length - PARTICLE_CAP);
      sfx.powerup();
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
    // Everything still in the air goes off on the way out, quickly, from the
    // top down. Ending on a full screen of bubbles that simply vanish was the
    // one flat moment left in the game.
    bubbles.forEach((b, i) => { b.popIn = 0.05 + i * 0.05; });
    rewardIn = Math.min(0.35 + bubbles.length * 0.05, 1.1);
  }

  function showReward() {
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
    if (finished || waiting) return;
    dragging.add(e.pointerId);
    popAt(e.clientX, e.clientY);
  };
  const onMove = (e) => {
    if (finished || waiting || !dragging.has(e.pointerId)) return;
    popAt(e.clientX, e.clientY);
  };
  const onUp = (e) => dragging.delete(e.pointerId);

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);

  function update(dt) {
    t += dt;

    if (chainTimer > 0) {
      chainTimer -= dt;
      if (chainTimer <= 0) chain = 0;
    }

    if (!finished && !waiting) {
      spawnCooldown -= dt;
      if (bubbles.length < cfg.crowd && spawnCooldown <= 0) {
        bubbles.push(spawn());
        // Tightened along with the faster climb: at the old cadence a quicker
        // bubble simply meant a thinner screen.
        spawnCooldown = 0.34 + Math.random() * 0.42;
      }
    }

    for (let i = bubbles.length - 1; i >= 0; i--) {
      const b = bubbles[i];
      b.y -= (b.rise + b.boost) * dt;
      b.boost *= 1 - Math.min(1, dt * 2.6);
      b.x += (b.vx + Math.sin(t * b.wobble + b.phase) * 46) * dt;
      b.vx *= 1 - Math.min(1, dt * 2.2);
      if (b.nudge > 0) b.nudge -= dt;
      if (b.rider) b.rot = Math.sin(t * 2 + b.phase) * 0.24;

      // Walls nudge a bubble back rather than clipping it, so nothing ever
      // sits half off the screen where it can't be reached.
      if (b.x < b.r) { b.x = b.r; b.vx = Math.abs(b.vx); }
      if (b.x > LOGICAL_WIDTH - b.r) { b.x = LOGICAL_WIDTH - b.r; b.vx = -Math.abs(b.vx); }

      if (b.popIn > 0) {
        b.popIn -= dt;
        if (b.popIn <= 0) {
          pop(b, i, true);
          continue;
        }
      }

      // Off the top it simply leaves. No sound, no loss, no comment.
      if (b.y < -b.r - 40) bubbles.splice(i, 1);
    }

    for (let i = flyers.length - 1; i >= 0; i--) {
      const f = flyers[i];
      f.vy -= 120 * dt;
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      f.rot += f.spin * dt;
      f.life -= dt * 0.5;
      if (f.life <= 0 || f.y < -f.size) flyers.splice(i, 1);
    }

    if (rewardIn > 0) {
      rewardIn -= dt;
      if (rewardIn <= 0) showReward();
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
      if (b.kind === 'ster') {
        // The star pulses, because it is the one thing on the board worth
        // crossing the screen for.
        drawGlow(ctx, STAR_COLOR, b.x, b.y, b.r * (1.7 + Math.sin(t * 6) * 0.15), 0.95);
      } else if (isWanted(b)) {
        drawGlow(ctx, b.color.hex, b.x, b.y, b.r * 1.5, target ? 0.75 : 0.4);
      }
      ctx.drawImage(
        bubbleSprite(b.kind === 'ster' ? STAR_COLOR : b.color.hex),
        b.x - w / 2, b.y - h / 2, w, h
      );

      if (b.kind === 'ster') {
        const s = b.r * 1.05;
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(Math.sin(t * 2.2) * 0.2);
        ctx.drawImage(emojiSprite('⭐'), -s / 2, -s / 2, s, s);
        ctx.restore();
      } else if (b.rider) {
        const s = b.r * 1.05;
        ctx.save();
        ctx.translate(b.x, b.y);
        ctx.rotate(b.rot);
        ctx.drawImage(emojiSprite(b.rider), -s / 2, -s / 2, s, s);
        ctx.restore();
      }
    }

    for (const f of flyers) {
      ctx.globalAlpha = Math.max(0, Math.min(1, f.life));
      ctx.save();
      ctx.translate(f.x, f.y);
      ctx.rotate(f.rot);
      ctx.drawImage(emojiSprite(f.emoji), -f.size / 2, -f.size / 2, f.size, f.size);
      ctx.restore();
      ctx.globalAlpha = 1;
    }

    updateAndDrawParticles(ctx, particles, dt, { gravity: -60 });
  }

  let last = performance.now();
  function loop(now) {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    update(dt);
    draw(dt);
    raf = requestAnimationFrame(loop);
  }
  raf = requestAnimationFrame(loop);

  // --- pace picker ---------------------------------------------------------
  // Over the live starfield, so the mission already feels open while the choice
  // is being made — the same arrangement Ruimte Invasie uses for difficulty.
  const picker = document.createElement('div');
  picker.className = 'bub-diff';
  picker.innerHTML = `
    <div class="bub-diff__panel">
      <div class="bub-diff__title">Hoe snel mogen de bellen?</div>
      <div class="bub-diff__row">
        ${DIFFICULTIES.map((d) => `
          <button class="bub-diff__btn${d.id === diff.id ? ' is-last' : ''}" data-id="${d.id}">
            <span class="bub-diff__icon">${d.icon}</span>
            <span class="bub-diff__label">${d.label}</span>
            <span class="bub-diff__sub">${d.sub}</span>
          </button>
        `).join('')}
      </div>
    </div>
  `;
  stage.appendChild(picker);

  const onPick = (e) => {
    const btn = e.target.closest('.bub-diff__btn');
    if (!btn) return;
    diff = DIFFICULTIES.find((d) => d.id === btn.dataset.id) || diff;
    setItem('bub-difficulty', diff.id);
    picker.remove();
    waiting = false;
    sfx.select();
    startLevel();
  };
  picker.addEventListener('pointerup', onPick);

  listeners.push(() => {
    picker.removeEventListener('pointerup', onPick);
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
