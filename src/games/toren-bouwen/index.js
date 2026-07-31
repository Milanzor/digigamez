import './style.css';
import { createHud, showMissionComplete } from '../../shared/ui-components.js';
import {
  setupCanvas, LOGICAL_WIDTH, LOGICAL_HEIGHT,
  createStars, drawSpaceBackdrop, createBurst, updateAndDrawParticles,
  drawGlow, roundRect, withAlpha,
} from '../../shared/canvas-utils.js';
import { sfx } from '../../shell/audio.js';
import { setLevel, starsForLevel } from '../../shell/progress.js';

// "Toren Bouwen" — a crane swings a block, you tap, it drops.
//
// One tap, and that is the whole control scheme, which is why this reaches down
// to three. The depth is all in the timing, and it arrives by itself: the taller
// the tower gets, the further off-centre it leans, and the wobble tells a child
// they are pushing their luck long before it goes over.
//
// Collapsing is the joke, not the punishment. When it goes it goes properly —
// blocks tumbling off in all directions — and then the crane hands you another
// block at the same level, with the same target. That is deliberate: a child who
// finds the collapse funny will build higher next time, and a child who found it
// a failure would stop building at three.
//
// A block that lands too far over does not trim the tower or end the run; it
// simply slides off, and the crane brings another. Missing costs a turn, never a
// tower.

const BLOCK_W = 240;
const BLOCK_H = 96;
const GRAVITY = 2600;
const BASE_Y = 150;
// Low enough to clear the HUD bar, which owns the top ~140 logical rows.
const CRANE_Y = 300;
const RAIL_Y = CRANE_Y - 96;

const COLORS = ['#ff6b6b', '#5fe3c4', '#b98cff', '#ff8fc7', '#8fd6ff', '#7ee787', '#ffa14a'];

let hud = null;
let handle = null;
let raf = null;
let listeners = [];
let timers = [];
let reward = null;
let stage = null;
let level = 1;
let slug = 'toren-bouwen';
let mission = null;
let onExit = null;
let players = 1;

function levelConfig(l) {
  const n = Math.max(1, l);
  return {
    target: Math.min(4 + n * 2, 16),
    // How fast the crane swings, and how wide.
    speed: Math.min(0.75 + n * 0.12, 1.7),
    amp: Math.min(195 + n * 38, 540),
    // How much of a block has to be on the one below for it to stick.
    grip: 0.32,
  };
}

function later(fn, ms) {
  const id = setTimeout(fn, ms);
  timers.push(id);
  return id;
}

export function init(container, opts) {
  slug = opts.slug;
  level = Math.max(1, opts.startLevel || 1);
  players = opts.players || 1;
  mission = { title: opts.title, icon: opts.icon, color: opts.color };
  onExit = opts.onExit;
  reward = null;
  listeners = [];
  timers = [];

  hud = createHud(container, {
    title: opts.title,
    onExit: opts.onExit,
    level,
    players,
    showTurn: players > 1,
    meter: 'Hoogte',
  });

  stage = document.createElement('div');
  stage.className = 'tow-stage';
  const canvas = document.createElement('canvas');
  canvas.className = 'tow-canvas';
  const hint = document.createElement('div');
  hint.className = 'hint-strip tow-hint';
  stage.append(canvas, hint);
  container.appendChild(stage);

  handle = setupCanvas(canvas, { alpha: false });
  const { ctx } = handle;
  const stars = createStars(80);

  let cfg = levelConfig(level);
  // tower[0] is the foundation, which is never dropped and never falls.
  let tower = [];
  let carried = null;
  let falling = null;
  let debris = [];
  let particles = [];
  let camera = 0;
  let lean = 0;
  let turn = 0;
  let t = 0;
  let finished = false;
  let toppling = 0;

  const centerX = LOGICAL_WIDTH / 2;

  // World y counts upward from the pad; the camera lifts once the tower is tall
  // enough that the top would otherwise leave the screen.
  const screenY = (worldY) => LOGICAL_HEIGHT - BASE_Y - (worldY - camera);

  function resetTower() {
    tower = [{ x: centerX, color: '#6b6656', foundation: true }];
    carried = null;
    falling = null;
    debris = [];
    lean = 0;
    camera = 0;
  }

  function startLevel() {
    cfg = levelConfig(level);
    finished = false;
    toppling = 0;
    turn = 0;
    particles = [];
    hud.setLevel(level);
    hud.setMeter(0);
    resetTower();
    setHint();
    if (players > 1) hud.setTurn(turn);
    handOverBlock();
  }

  function setHint() {
    hint.textContent = players > 1
      ? 'Om de beurt: tik om je blok te laten vallen'
      : 'Tik om het blok te laten vallen';
  }

  function placed() {
    return tower.length - 1;
  }

  function handOverBlock() {
    if (finished) return;
    carried = {
      x: centerX,
      y: CRANE_Y,
      color: COLORS[placed() % COLORS.length],
    };
  }

  function drop() {
    if (finished || toppling > 0 || !carried || falling) return;
    falling = { ...carried, vy: 0, missed: false };
    carried = null;
    sfx.thruster();
  }

  function land(block) {
    const top = tower[tower.length - 1];
    // The landing pad really is wider than a block, so the first block gets
    // measured against the pad. Otherwise the very first drop of level 1 misses
    // as often as it lands, which is a rotten way to open a game aimed at three.
    const width = top.foundation ? BLOCK_W * 1.7 : BLOCK_W;
    const overlap = 1 - Math.abs(block.x - top.x) / width;

    if (overlap < cfg.grip) {
      // Too far over: it slides off the edge and keeps going. The tower is
      // untouched, and the same player gets another block.
      block.missed = true;
      block.vx = block.x > top.x ? 420 : -420;
      block.spin = block.vx > 0 ? 6 : -6;
      block.rot = 0;
      debris.push(block);
      falling = null;
      sfx.deny();
      hud.banner('Naast de toren!', { ms: 900, hint: true });
      later(handOverBlock, 420);
      return;
    }

    tower.push({ x: block.x, color: block.color });
    falling = null;
    sfx.impact();
    const p = { x: block.x, y: screenY(placed() * BLOCK_H) };
    particles.push(...createBurst(p.x, p.y, [block.color, '#ffffff'], { count: 12, speed: 200 }));
    // Each block is the next note up, so a tall tower has played a scale.
    sfx.chime(placed());

    hud.setMeter(placed() / cfg.target);

    // Centre of mass against the pad. This is the wobble *and* the failure
    // condition, so a child can see the danger building.
    const com = tower.reduce((sum, b) => sum + b.x, 0) / tower.length;
    lean = (com - centerX) / (BLOCK_W * 0.6);

    if (placed() >= cfg.target) {
      finishLevel();
      return;
    }

    if (Math.abs(lean) > 1) {
      topple();
      return;
    }

    if (players > 1) {
      turn = 1 - turn;
      hud.setTurn(turn);
    }
    later(handOverBlock, 260);
  }

  function topple() {
    toppling = 1;
    sfx.explode();
    hud.banner('Boem! 💥', { sub: 'Bouw hem nog een keer', ms: 1600 });
    // Everything but the pad tumbles away, each block with its own spin so it
    // reads as a collapse rather than as a layer being deleted.
    const dir = lean > 0 ? 1 : -1;
    tower.slice(1).forEach((b, i) => {
      debris.push({
        x: b.x,
        y: screenY((i + 1) * BLOCK_H),
        color: b.color,
        vy: -240 - Math.random() * 200,
        vx: dir * (120 + i * 55) + (Math.random() - 0.5) * 160,
        spin: dir * (2 + Math.random() * 6),
        rot: 0,
        missed: true,
      });
    });
    resetTower();
    hud.setMeter(0);
    later(() => {
      toppling = 0;
      if (!finished) {
        if (players > 1) hud.setTurn(turn);
        handOverBlock();
      }
    }, 1500);
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
      title: players > 1 ? 'Samen zo hoog! 🧱' : 'Wat een toren! 🧱',
      onNext: () => { reward = null; startLevel(); },
      onRetry: () => { reward = null; level = cleared; startLevel(); },
      onHome: onExit,
    });
  }

  const onDown = () => drop();
  canvas.addEventListener('pointerdown', onDown);

  function update(dt) {
    t += dt;

    if (carried) {
      // The crane swings on a sine, so the block is slowest at the ends — which
      // is where a three-year-old will manage to catch it.
      carried.x = centerX + Math.sin(t * cfg.speed) * cfg.amp;
    }

    if (falling) {
      falling.vy += GRAVITY * dt;
      falling.y += falling.vy * dt;
      // The centre line of the slot this block is about to occupy — the same
      // expression `draw` uses for tower[i], or the block visibly snaps down
      // half its own height the instant it lands.
      const restY = screenY(tower.length * BLOCK_H);
      if (falling.y >= restY) {
        falling.y = restY;
        land(falling);
      }
    }

    for (let i = debris.length - 1; i >= 0; i--) {
      const d = debris[i];
      d.vy += GRAVITY * 0.55 * dt;
      d.y += d.vy * dt;
      d.x += (d.vx || 0) * dt;
      d.rot += (d.spin || 0) * dt;
      if (d.y > LOGICAL_HEIGHT + 300) debris.splice(i, 1);
    }

    // Follow the tower up, leaving four blocks' worth of headroom.
    const want = Math.max(0, (tower.length - 4) * BLOCK_H);
    camera += (want - camera) * Math.min(1, dt * 4);
  }

  function drawBlock(x, y, color, rot = 0, wobble = 0) {
    ctx.save();
    ctx.translate(x, y);
    if (rot) ctx.rotate(rot);
    if (wobble) ctx.rotate(wobble);
    drawGlow(ctx, color, 0, 0, BLOCK_W * 0.6, 0.28);
    const g = ctx.createLinearGradient(0, -BLOCK_H / 2, 0, BLOCK_H / 2);
    g.addColorStop(0, withAlpha(color, 1));
    g.addColorStop(1, withAlpha(color, 0.66));
    ctx.fillStyle = g;
    roundRect(ctx, -BLOCK_W / 2, -BLOCK_H / 2, BLOCK_W, BLOCK_H, 18);
    ctx.fill();
    // A cream hairline, the same edge every panel in the app has.
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 3;
    roundRect(ctx, -BLOCK_W / 2, -BLOCK_H / 2, BLOCK_W, BLOCK_H, 18);
    ctx.stroke();
    ctx.restore();
  }

  function drawPad() {
    // Flush with the underside of the first block rather than at world zero, so
    // the tower is standing on the pad instead of hovering a hair above it.
    const top = screenY(BLOCK_H) + BLOCK_H / 2;
    const w = BLOCK_W * 1.7;
    ctx.save();
    ctx.fillStyle = '#3a3856';
    roundRect(ctx, centerX - w / 2, top, w, BLOCK_H * 0.75, 18);
    ctx.fill();
    ctx.strokeStyle = 'rgba(232,217,176,0.34)';
    ctx.lineWidth = 4;
    ctx.stroke();

    // Hazard stripes across the deck. Without them the pad reads as an empty
    // panel rather than as the thing the tower is standing on, and the child has
    // nothing to aim the first block at.
    ctx.beginPath();
    roundRect(ctx, centerX - w / 2, top, w, BLOCK_H * 0.75, 18);
    ctx.clip();
    ctx.strokeStyle = 'rgba(255,194,74,0.22)';
    ctx.lineWidth = 12;
    for (let x = -w; x < w; x += 46) {
      ctx.beginPath();
      ctx.moveTo(centerX + x, top);
      ctx.lineTo(centerX + x + BLOCK_H * 0.75, top + BLOCK_H * 0.75);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawCrane() {
    if (!carried) return;
    ctx.save();
    // Rail across the top and a cable down to the block, so the swing has an
    // obvious cause.
    ctx.strokeStyle = 'rgba(232,217,176,0.28)';
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.moveTo(0, RAIL_Y);
    ctx.lineTo(LOGICAL_WIDTH, RAIL_Y);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(232,217,176,0.45)';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(carried.x, RAIL_Y);
    ctx.lineTo(carried.x, carried.y - BLOCK_H / 2);
    ctx.stroke();
    ctx.restore();

    drawBlock(carried.x, carried.y, carried.color);
  }

  function draw(dt) {
    drawSpaceBackdrop(ctx, stars, t, { scrollSpeed: 2 });
    drawPad();

    // The whole stack tilts with its centre of mass. Same number that decides
    // the collapse, so the warning and the rule are one thing.
    const tilt = lean * 0.055;
    tower.forEach((b, i) => {
      if (i === 0) return;
      const y = screenY(i * BLOCK_H);
      const wob = tilt * (i / tower.length) + Math.sin(t * 2.4) * tilt * 0.35;
      drawBlock(b.x, y, b.color, 0, wob);
    });

    for (const d of debris) drawBlock(d.x, d.y, d.color, d.rot);
    if (falling) drawBlock(falling.x, falling.y, falling.color);
    drawCrane();
    updateAndDrawParticles(ctx, particles, dt, { gravity: 420 });
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
