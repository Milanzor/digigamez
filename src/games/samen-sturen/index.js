import './style.css';
import { createHud, showMissionComplete } from '../../shared/ui-components.js';
import {
  setupCanvas, LOGICAL_WIDTH, LOGICAL_HEIGHT,
  createStars, drawSpaceBackdrop, createBurst, updateAndDrawParticles,
  drawGlow, roundRect, withAlpha,
} from '../../shared/canvas-utils.js';
import { sfx } from '../../shell/audio.js';
import { setLevel, starsForLevel } from '../../shell/progress.js';

// "Samen Sturen" — one ship, two thrusters, one on each side of the board.
//
// Every other two-player game in the archive gives each child their own thing:
// a paddle, a basket, a half of the screen. This one deliberately gives them
// one thing between them. The left pad pushes the ship left and the right pad
// pushes it right, so neither child can hold it on a line alone — going
// straight is two people easing off at the same time, and a gate that is
// slightly to the left is one child pressing while the other lets go. That is
// a conversation, and it is the only mechanic here.
//
// It is also why the pads are holds rather than taps. Every other game in the
// archive is tapped; a hold cannot be mashed, so the older child's advantage in
// tapping speed is worth exactly nothing, and the thing that matters is whether
// the two of them agree. A three-year-old can hold a panel down.
//
// Alone it is still a game — one child works both pads, which is a genuinely
// different and harder motor problem — and that is what the level ladder is
// tuned against, so a solo player is never handed a two-person puzzle.
//
// Hitting a gate costs nothing. The ring shatters into sparks and the ship flies
// on; only a clean pass fills the hold. A miss is a gate that did not count, and
// the next one is already on its way down.

const SHIP_Y = LOGICAL_HEIGHT * 0.66;
const SHIP_R = 62;
// The ship's shoulders, for deciding whether it fitted through the gap. A touch
// narrower than the artwork: brushing a pylon with the tip of a fin should not
// be the thing that ends a good run.
const SHIP_HALF = 44;

// The pads own the outer edge of the board on both sides; the corridor is what
// is left between them. Both are canvas-drawn so the touch zone and the wall a
// child sees are the same numbers, whatever the board's aspect ratio turns out
// to be.
const PAD_W = 340;
const CORRIDOR_X0 = PAD_W + 26;
const CORRIDOR_X1 = LOGICAL_WIDTH - PAD_W - 26;
const PAD_TOP = 176;

const THRUST = 2100;
const PARTICLE_CAP = 260;

const P_COLORS = ['#ff6b6b', '#5fe3c4'];

let hud = null;
let handle = null;
let raf = null;
let listeners = [];
let reward = null;
let stage = null;
let level = 1;
let slug = 'samen-sturen';
let mission = null;
let onExit = null;

function levelConfig(l) {
  const n = Math.max(1, l);
  return {
    goal: Math.min(4 + n, 12),
    scroll: Math.min(200 + n * 26, 420),
    // Half the opening. It never closes past three ship-widths, because past
    // that the game stops being about agreeing and starts being about reflexes.
    gap: Math.max(140, 280 - n * 16),
    // Seconds between gates leaving the top of the screen.
    spacing: Math.max(1.6, 2.8 - n * 0.14),
    // How far the next gate may sit from the last one, as a fraction of the
    // corridor: the ramp is in how far they have to travel, not only in how
    // small the hole is.
    swing: Math.min(0.28 + n * 0.09, 0.9),
  };
}

// The ship never changes shape, so it is drawn once and blitted. The flames are
// the only part that is painted per frame, because they are the only part that
// says anything.
let shipSprite = null;

function ship() {
  if (shipSprite) return shipSprite;
  shipSprite = document.createElement('canvas');
  shipSprite.width = 256;
  shipSprite.height = 256;
  const g = shipSprite.getContext('2d');
  const c = 128;

  // Hull: a blunt-nosed shuttle, cream against the void like every other piece
  // of chrome in this app.
  g.fillStyle = '#f3ece0';
  g.beginPath();
  g.moveTo(c, 26);
  g.bezierCurveTo(c + 46, 74, c + 54, 138, c + 44, 186);
  g.lineTo(c - 44, 186);
  g.bezierCurveTo(c - 54, 138, c - 46, 74, c, 26);
  g.closePath();
  g.fill();

  // Shadow down one side, so the hull is a cylinder and not a cut-out.
  g.fillStyle = 'rgba(12,14,40,0.16)';
  g.beginPath();
  g.moveTo(c, 26);
  g.bezierCurveTo(c + 46, 74, c + 54, 138, c + 44, 186);
  g.lineTo(c + 6, 186);
  g.lineTo(c + 6, 40);
  g.closePath();
  g.fill();

  // Fins, in the mission's own sky blue.
  g.fillStyle = '#8fd6ff';
  for (const dir of [-1, 1]) {
    g.beginPath();
    g.moveTo(c + dir * 42, 122);
    g.lineTo(c + dir * 96, 196);
    g.lineTo(c + dir * 44, 196);
    g.closePath();
    g.fill();
  }

  // Porthole: the same ring of instrument glass the whole app is built from.
  g.fillStyle = '#12244a';
  g.beginPath();
  g.arc(c, 104, 30, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = '#8fd6ff';
  g.lineWidth = 7;
  g.beginPath();
  g.arc(c, 104, 30, 0, Math.PI * 2);
  g.stroke();
  g.fillStyle = 'rgba(255,255,255,0.5)';
  g.beginPath();
  g.arc(c - 10, 94, 9, 0, Math.PI * 2);
  g.fill();

  // Nozzles.
  g.fillStyle = '#9a9280';
  g.fillRect(c - 40, 186, 32, 20);
  g.fillRect(c + 8, 186, 32, 20);

  return shipSprite;
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
    meter: 'Poorten',
  });

  stage = document.createElement('div');
  stage.className = 'stuur-stage';
  const canvas = document.createElement('canvas');
  canvas.className = 'stuur-canvas';
  const legend = document.createElement('div');
  legend.className = 'stuur-legend';
  // The rule, drawn: hold a side and the ship goes that way. With two children
  // each pad is labelled in that crew's colour, so "yours is the left one" is
  // something a three-year-old can see rather than something to be told.
  legend.innerHTML = `
    <span class="stuur-legend__item" role="img" aria-label="Houd links vast en het schip gaat naar links">
      <span class="stuur-legend__hand">👆</span>
      <span class="stuur-legend__arrow" style="--c:${players > 1 ? P_COLORS[0] : '#ffc24a'}">⬅</span>
    </span>
    <span class="stuur-legend__ship">🛸</span>
    <span class="stuur-legend__item" role="img" aria-label="Houd rechts vast en het schip gaat naar rechts">
      <span class="stuur-legend__arrow" style="--c:${players > 1 ? P_COLORS[1] : '#ffc24a'}">➡</span>
      <span class="stuur-legend__hand">👆</span>
    </span>
  `;
  stage.append(canvas, legend);
  container.appendChild(stage);

  handle = setupCanvas(canvas, { alpha: false });
  const { ctx, toLogical } = handle;
  const stars = createStars(110);

  let cfg = levelConfig(level);
  let gates = [];
  let particles = [];
  let passed = 0;
  let chimeStep = 0;
  let t = 0;
  let spawnCooldown = 1.2;
  let finished = false;

  const shipState = { x: (CORRIDOR_X0 + CORRIDOR_X1) / 2, vx: 0, shake: 0, tilt: 0 };
  // pointerId -> -1 | 1. Held rather than tapped, so this is state and not an
  // event: the thrust is read every frame from whatever is currently down.
  const held = new Map();

  function sideHeld(dir) {
    for (const d of held.values()) if (d === dir) return true;
    return false;
  }

  function startLevel() {
    cfg = levelConfig(level);
    hud.setLevel(level);
    hud.setMeter(0);
    gates = [];
    particles = [];
    passed = 0;
    chimeStep = 0;
    spawnCooldown = 1.2;
    finished = false;
    shipState.x = (CORRIDOR_X0 + CORRIDOR_X1) / 2;
    shipState.vx = 0;
    shipState.shake = 0;
    held.clear();
  }

  function spawnGate() {
    const inner0 = CORRIDOR_X0 + cfg.gap + 30;
    const inner1 = CORRIDOR_X1 - cfg.gap - 30;
    const span = Math.max(0, inner1 - inner0);
    const last = gates.length ? gates[gates.length - 1].cx : (inner0 + inner1) / 2;
    // Somewhere within reach of the previous gate rather than anywhere at all:
    // a jump from one wall to the other is not a steering problem, it is a
    // coin toss.
    const reach = span * cfg.swing;
    const lo = Math.max(inner0, last - reach);
    const hi = Math.min(inner1, last + reach);
    gates.push({
      y: -70,
      cx: span === 0 ? (inner0 + inner1) / 2 : lo + Math.random() * Math.max(0, hi - lo),
      half: cfg.gap,
      state: 'open',
      flash: 0,
    });
  }

  function resolve(gate) {
    const off = Math.abs(shipState.x - gate.cx);
    if (off <= gate.half - SHIP_HALF) {
      gate.state = 'passed';
      gate.flash = 0.5;
      passed++;
      hud.setMeter(passed / cfg.goal);
      sfx.chime(chimeStep++);
      particles.push(...createBurst(gate.cx - gate.half, gate.y, ['#7ee787', '#ffffff'], { count: 8, speed: 200 }));
      particles.push(...createBurst(gate.cx + gate.half, gate.y, ['#7ee787', '#ffffff'], { count: 8, speed: 200 }));
      if (passed >= cfg.goal && !finished) finishLevel();
    } else {
      // The pylon shatters, the ship flies on. There is nothing to lose here —
      // only a gate that did not count.
      gate.state = 'hit';
      gate.flash = 0.4;
      shipState.shake = 0.42;
      sfx.impact();
      const side = shipState.x < gate.cx ? -1 : 1;
      particles.push(...createBurst(shipState.x, gate.y, ['#ff6b6b', '#ffc24a', '#f3ece0'], { count: 20, speed: 300 }));
      // A shove back towards the opening, so a ship pinned against the wall is
      // not pinned against it for the next gate too.
      shipState.vx = -side * 240;
    }
    if (particles.length > PARTICLE_CAP) particles.splice(0, particles.length - PARTICLE_CAP);
  }

  function finishLevel() {
    finished = true;
    held.clear();
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
      title: 'Netjes gevlogen! 🛸',
      onNext: () => { reward = null; startLevel(); },
      onRetry: () => { reward = null; level = cleared; startLevel(); },
      onHome: onExit,
    });
  }

  // --- input: which side a finger is on, for as long as it is down. Sliding
  // from one pad to the other switches sides, and a finger in the corridor
  // steers nothing at all — the ship is not dragged, it is flown.
  function sideAt(clientX, clientY) {
    const { x, y } = toLogical(clientX, clientY);
    if (y < PAD_TOP) return 0;
    if (x <= PAD_W) return -1;
    if (x >= LOGICAL_WIDTH - PAD_W) return 1;
    return 0;
  }

  const onDown = (e) => {
    if (finished) return;
    const side = sideAt(e.clientX, e.clientY);
    if (!side) return;
    held.set(e.pointerId, side);
    canvas.setPointerCapture?.(e.pointerId);
    sfx.thruster();
  };
  const onMove = (e) => {
    if (finished || !held.has(e.pointerId)) return;
    const side = sideAt(e.clientX, e.clientY);
    if (side) held.set(e.pointerId, side);
    else held.delete(e.pointerId);
  };
  const onUp = (e) => held.delete(e.pointerId);

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);

  function update(dt) {
    t += dt;

    if (!finished) {
      spawnCooldown -= dt;
      if (spawnCooldown <= 0) {
        spawnGate();
        spawnCooldown = cfg.spacing;
      }
    }

    const left = sideHeld(-1);
    const right = sideHeld(1);
    // Both pads at once cancel out, and that is the point: holding the ship
    // still is something the two of them do together.
    const thrust = (right ? THRUST : 0) - (left ? THRUST : 0);
    shipState.vx += thrust * dt;
    shipState.vx *= 1 - Math.min(1, dt * 2.4);
    shipState.x += shipState.vx * dt;

    const min = CORRIDOR_X0 + SHIP_HALF;
    const max = CORRIDOR_X1 - SHIP_HALF;
    if (shipState.x < min) { shipState.x = min; shipState.vx = Math.abs(shipState.vx) * 0.3; }
    if (shipState.x > max) { shipState.x = max; shipState.vx = -Math.abs(shipState.vx) * 0.3; }

    // Banking: the strongest signal on the board for which way the ship is
    // actually going, and it costs one lerp.
    const wantTilt = Math.max(-0.34, Math.min(0.34, shipState.vx / 2200));
    shipState.tilt += (wantTilt - shipState.tilt) * (1 - Math.exp(-dt * 9));
    if (shipState.shake > 0) shipState.shake -= dt;

    for (let i = gates.length - 1; i >= 0; i--) {
      const g = gates[i];
      g.y += cfg.scroll * dt;
      if (g.flash > 0) g.flash -= dt;
      if (g.state === 'open' && g.y >= SHIP_Y) resolve(g);
      if (g.y > LOGICAL_HEIGHT + 90) gates.splice(i, 1);
    }
  }

  function drawPad(side, on) {
    const x0 = side < 0 ? 0 : LOGICAL_WIDTH - PAD_W;
    const color = players > 1 ? P_COLORS[side < 0 ? 0 : 1] : '#ffc24a';

    ctx.fillStyle = on ? 'rgba(255,194,74,0.16)' : 'rgba(255,255,255,0.035)';
    ctx.fillRect(x0, PAD_TOP, PAD_W, LOGICAL_HEIGHT - PAD_TOP);

    ctx.strokeStyle = on ? 'rgba(255,194,74,0.75)' : 'rgba(232,217,176,0.22)';
    ctx.lineWidth = on ? 5 : 2;
    ctx.beginPath();
    const edge = side < 0 ? PAD_W : LOGICAL_WIDTH - PAD_W;
    ctx.moveTo(edge, PAD_TOP);
    ctx.lineTo(edge, LOGICAL_HEIGHT);
    ctx.stroke();

    // The arrow is the whole instruction, so it is enormous and sits where a
    // child's hand naturally lands on a wall-mounted screen — low, not centred.
    const cx = x0 + PAD_W / 2;
    const cy = LOGICAL_HEIGHT * 0.62;
    const a = 96;
    const dir = side;
    ctx.save();
    if (on) {
      drawGlow(ctx, '#ffc24a', cx, cy, a * 2.1, 0.9);
    } else {
      drawGlow(ctx, color, cx, cy, a * 1.7, 0.32);
    }
    ctx.fillStyle = on ? '#ffc24a' : color;
    ctx.beginPath();
    ctx.moveTo(cx + dir * a, cy);
    ctx.lineTo(cx - dir * a * 0.2, cy - a * 0.72);
    ctx.lineTo(cx - dir * a * 0.2, cy - a * 0.26);
    ctx.lineTo(cx - dir * a, cy - a * 0.26);
    ctx.lineTo(cx - dir * a, cy + a * 0.26);
    ctx.lineTo(cx - dir * a * 0.2, cy + a * 0.26);
    ctx.lineTo(cx - dir * a * 0.2, cy + a * 0.72);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawGate(g) {
    const lit = g.state === 'passed' ? '#7ee787' : g.state === 'hit' ? '#ff6b6b' : '#8fd6ff';
    const alpha = g.state === 'open' ? 0.5 : Math.max(0, g.flash) * 1.6;
    const h = 30;

    // The two pylons. A shattered one is drawn thinner and dimmer rather than
    // removed, so a child can see which gate they clipped as it drifts past.
    const thin = g.state === 'hit' ? 0.45 : 1;
    for (const [x0, x1] of [
      [CORRIDOR_X0, g.cx - g.half],
      [g.cx + g.half, CORRIDOR_X1],
    ]) {
      const w = x1 - x0;
      if (w <= 0) continue;
      ctx.fillStyle = withAlpha(lit, 0.16 + alpha * 0.2);
      roundRect(ctx, x0, g.y - (h * thin) / 2, w, h * thin, h / 2);
      ctx.fill();
      ctx.strokeStyle = withAlpha(lit, 0.5 + alpha * 0.5);
      ctx.lineWidth = 3;
      ctx.stroke();
    }

    // The opening, marked at both shoulders — the thing to aim between.
    if (g.state !== 'hit') {
      drawGlow(ctx, lit, g.cx - g.half, g.y, 74, 0.6 + Math.max(0, g.flash));
      drawGlow(ctx, lit, g.cx + g.half, g.y, 74, 0.6 + Math.max(0, g.flash));
    }
  }

  function draw(dt) {
    drawSpaceBackdrop(ctx, stars, t, { scrollSpeed: cfg.scroll * 0.5 });

    // The pads first: they are the frame the corridor sits in, and the only
    // control surface in the game. Nothing else on the board is touchable, so
    // if these are not visible the game has no instructions at all.
    drawPad(-1, sideHeld(-1));
    drawPad(1, sideHeld(1));

    // Corridor walls: two hairlines, the same language the portal uses for the
    // edge of anything.
    ctx.strokeStyle = 'rgba(232,217,176,0.14)';
    ctx.lineWidth = 2;
    for (const x of [CORRIDOR_X0, CORRIDOR_X1]) {
      ctx.beginPath();
      ctx.moveTo(x, PAD_TOP);
      ctx.lineTo(x, LOGICAL_HEIGHT);
      ctx.stroke();
    }

    for (const g of gates) drawGate(g);

    const left = sideHeld(-1);
    const right = sideHeld(1);
    const shake = shipState.shake > 0 ? Math.sin(shipState.shake * 60) * 9 : 0;
    const sx = shipState.x + shake;

    // Flames come out of the nozzle opposite the way the ship is being pushed,
    // which is both what a rocket does and the reason the ship is visibly
    // *being pushed* rather than sliding.
    for (const [on, dir] of [[left, 1], [right, -1]]) {
      if (!on) continue;
      const fx = sx + dir * 42;
      const fy = SHIP_Y + 6;
      const len = 66 + Math.sin(t * 40) * 14;
      drawGlow(ctx, '#ffc24a', fx + dir * len * 0.4, fy, 74, 0.8);
      ctx.fillStyle = '#ffc24a';
      ctx.beginPath();
      ctx.moveTo(fx, fy - 22);
      ctx.lineTo(fx + dir * len, fy);
      ctx.lineTo(fx, fy + 22);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#fff6e5';
      ctx.beginPath();
      ctx.moveTo(fx, fy - 10);
      ctx.lineTo(fx + dir * len * 0.5, fy);
      ctx.lineTo(fx, fy + 10);
      ctx.closePath();
      ctx.fill();
    }

    drawGlow(ctx, '#8fd6ff', sx, SHIP_Y, SHIP_R * 1.6, 0.5);
    ctx.save();
    ctx.translate(sx, SHIP_Y);
    ctx.rotate(shipState.tilt);
    ctx.drawImage(ship(), -SHIP_R, -SHIP_R * 1.05, SHIP_R * 2, SHIP_R * 2);
    ctx.restore();

    updateAndDrawParticles(ctx, particles, dt, { gravity: 40 });
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
