import './style.css';
import { createHud } from '../../shared/ui-components.js';
import {
  setupCanvas, LOGICAL_WIDTH, LOGICAL_HEIGHT, createStars, drawSpaceBackdrop,
  roundRect, createBurst, updateAndDrawParticles,
} from '../../shared/canvas-utils.js';
import { sfx } from '../../shell/audio.js';

// "Gekke Machine" — a workshop instead of a puzzle: drop parts on the bench,
// draw ramps with a crayon, then hit ▶ and watch the marbles find their way
// through whatever contraption you built.
//
// There are no levels and nothing to lose. The reward loop is cause and
// effect: a child moves one plank, presses play again, and the whole machine
// behaves differently. Everything is reversible — ⏹ puts every part back
// exactly where it was built.
//
// The physics is deliberately narrow: every moving thing is a circle, and
// everything it can hit is a line segment (planks, trampolines, crayon ink,
// the walls) or a force field (fan, magnet, black hole, bomb). That covers
// marble runs completely while staying small enough to read, and it means
// there are only two collision routines to get right.

const FLOOR_Y = 902;
const CEIL_Y = 128;
const WALL_L = 26;
const WALL_R = LOGICAL_WIDTH - 26;

const GRAVITY = 1900;
const MAX_BODIES = 60;
const SUBSTEPS = 3;

const PARTS = {
  marble: { icon: '🔵', name: 'Knikker', body: { r: 26, e: 0.42, drag: 0.999 } },
  bouncy: { icon: '🏀', name: 'Stuiterbal', body: { r: 30, e: 0.88, drag: 0.999 } },
  balloon: { icon: '🎈', name: 'Ballon', body: { r: 34, e: 0.6, drag: 0.986, g: -0.42 } },
  rocket: { icon: '🚀', name: 'Raket', body: { r: 24, e: 0.5, drag: 0.996, thrust: 2400 } },
  plank: { icon: '📏', name: 'Plank', seg: true },
  tramp: { icon: '🛟', name: 'Trampoline', seg: true },
  fan: { icon: '💨', name: 'Ventilator', dir: true },
  magnet: { icon: '🧲', name: 'Magneet' },
  hole: { icon: '🕳️', name: 'Zwart gat' },
  bomb: { icon: '💣', name: 'Bom' },
  spinner: { icon: '🌀', name: 'Molen' },
  fountain: { icon: '⛲', name: 'Knikkerkraan' },
  basket: { icon: '🪣', name: 'Emmer' },
};

const PART_ORDER = [
  'marble', 'bouncy', 'balloon', 'rocket',
  'plank', 'tramp', 'fan', 'spinner',
  'magnet', 'hole', 'bomb', 'fountain', 'basket',
];

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

let G = null;

export function init(container, opts) {
  const hud = createHud(container, {
    title: opts.title,
    onExit: opts.onExit,
    showScore: true,
  });

  const stage = document.createElement('div');
  stage.className = 'mach-stage';
  const canvas = document.createElement('canvas');
  canvas.className = 'mach-canvas';
  stage.appendChild(canvas);
  container.appendChild(stage);

  const handle = setupCanvas(canvas);

  G = {
    hud,
    stage,
    canvas,
    handle,
    ctx: handle.ctx,
    stars: createStars(120),
    parts: [],
    ink: [],
    bodies: [],
    particles: [],
    running: false,
    tool: 'marble',
    drags: new Map(),
    score: 0,
    seq: 1,
    t: 0,
    last: 0,
    raf: 0,
    listeners: [],
  };

  buildToolbar();
  attachPointer();
  seedExample();

  G.last = performance.now();
  const loop = (now) => {
    G.raf = requestAnimationFrame(loop);
    const dt = Math.min(0.05, (now - G.last) / 1000);
    G.last = now;
    G.t += dt;
    if (G.running) {
      for (let i = 0; i < SUBSTEPS; i++) step(dt / SUBSTEPS);
    }
    render(dt);
  };
  G.raf = requestAnimationFrame(loop);

  hud.banner('Bouw je machine! ⚙️', {
    sub: 'Kies onderdelen, zet ze neer en druk op ▶',
    ms: 2800,
    hint: true,
  });
}

export function destroy() {
  if (!G) return;
  cancelAnimationFrame(G.raf);
  G.listeners.forEach((off) => off());
  G.handle.disconnect();
  G.hud.destroy();
  G = null;
}

// A starter machine, so the first thing a child sees is a contraption that
// already does something when they press play — far more inviting than an
// empty bench with thirteen buttons under it.
function seedExample() {
  addPart('plank', { x: 240, y: 340, x2: 820, y2: 520 });
  addPart('plank', { x: 900, y: 560, x2: 1500, y2: 740 });
  addPart('tramp', { x: 300, y: 820, x2: 640, y2: 820 });
  addPart('marble', { x: 300, y: 240 });
  addPart('marble', { x: 400, y: 190 });
  addPart('basket', { x: 1600, y: FLOOR_Y - 70 });
}

function addPart(type, props) {
  const part = { id: G.seq++, type, ...props };
  G.parts.push(part);
  return part;
}

// --- geometry helpers -----------------------------------------------------

// Every static part exposes its collision as line segments, so the ball only
// ever has to know about one shape.
function segmentsOf(part) {
  if (part.type === 'plank' || part.type === 'tramp') {
    return [{ x1: part.x, y1: part.y, x2: part.x2, y2: part.y2, e: part.type === 'tramp' ? 1.35 : 0.42, w: part.type === 'tramp' ? 14 : 10 }];
  }
  if (part.type === 'spinner') {
    const a = part.angle || 0;
    const L = 170;
    const cos = Math.cos(a);
    const sin = Math.sin(a);
    return [{
      x1: part.x - cos * L, y1: part.y - sin * L,
      x2: part.x + cos * L, y2: part.y + sin * L,
      e: 0.5, w: 14, spin: part,
    }];
  }
  if (part.type === 'basket') {
    const w = 108;
    const h = 96;
    return [
      { x1: part.x - w, y1: part.y - h, x2: part.x - w, y2: part.y + h * 0.6, e: 0.2, w: 9 },
      { x1: part.x + w, y1: part.y - h, x2: part.x + w, y2: part.y + h * 0.6, e: 0.2, w: 9 },
      { x1: part.x - w, y1: part.y + h * 0.6, x2: part.x + w, y2: part.y + h * 0.6, e: 0.15, w: 9 },
    ];
  }
  return [];
}

function partHit(part, x, y) {
  if (part.type === 'plank' || part.type === 'tramp') {
    return distToSegment(x, y, part.x, part.y, part.x2, part.y2) < 44;
  }
  return Math.hypot(x - part.x, y - part.y) < 78;
}

function distToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len2 = dx * dx + dy * dy || 1;
  const t = clamp(((px - x1) * dx + (py - y1) * dy) / len2, 0, 1);
  return Math.hypot(px - (x1 + dx * t), py - (y1 + dy * t));
}

// --- simulation -----------------------------------------------------------

function startRun() {
  G.bodies = [];
  G.score = 0;
  G.hud.setScore(0, 0);
  for (const p of G.parts) {
    p.spent = false;
    p.nextDrop = 0;
    if (PARTS[p.type].body) spawnBody(p.type, p.x, p.y);
  }
  G.running = true;
  G.hasRun = true;
  G.t = 0;
  refreshRunButton();
  sfx.launch();
}

function stopRun() {
  G.running = false;
  G.bodies = [];
  G.particles = [];
  G.score = 0;
  G.hud.setScore(0, 0);
  for (const p of G.parts) {
    p.spent = false;
    p.angle = 0;
  }
  refreshRunButton();
  sfx.back();
}

function spawnBody(type, x, y) {
  if (G.bodies.length >= MAX_BODIES) return null;
  const spec = PARTS[type].body;
  const b = {
    type, x, y, vx: 0, vy: 0,
    r: spec.r, e: spec.e, drag: spec.drag,
    g: spec.g === undefined ? 1 : spec.g,
    thrust: spec.thrust || 0,
    heading: -Math.PI / 2,
    phase: Math.random() * Math.PI * 2,
  };
  G.bodies.push(b);
  return b;
}

function step(dt) {
  const parts = G.parts;

  // Fountains keep the machine fed.
  for (const p of parts) {
    if (p.type !== 'fountain') continue;
    p.nextDrop = (p.nextDrop || 0) - dt;
    if (p.nextDrop <= 0) {
      p.nextDrop = 0.85;
      const b = spawnBody('marble', p.x, p.y + 60);
      if (b) b.vy = 140;
    }
  }

  for (const p of parts) {
    if (p.type === 'spinner') p.angle = (p.angle || 0) + dt * 2.1;
  }

  for (const b of G.bodies) {
    let ax = 0;
    let ay = GRAVITY * b.g;

    for (const p of parts) {
      const dx = p.x - b.x;
      const dy = p.y - b.y;

      if (p.type === 'fan') {
        // Cone of wind: full strength on the axis, nothing outside ~30°.
        const fx = Math.cos(p.a);
        const fy = Math.sin(p.a);
        const along = -dx * fx - dy * fy;
        if (along > 0 && along < 640) {
          const off = Math.abs(-dx * -fy - dy * fx);
          const spread = 60 + along * 0.42;
          if (off < spread) {
            const power = 3400 * (1 - along / 640) * (1 - off / spread);
            ax += fx * power;
            ay += fy * power;
          }
        }
        continue;
      }

      const d2 = dx * dx + dy * dy;
      if (p.type === 'magnet' && d2 < 420 * 420) {
        const d = Math.sqrt(d2) || 1;
        const power = 2600 * (1 - d / 420);
        ax += (dx / d) * power;
        ay += (dy / d) * power;
      } else if (p.type === 'hole' && d2 < 560 * 560) {
        const d = Math.sqrt(d2) || 1;
        const power = 5200 * (1 - d / 560);
        ax += (dx / d) * power;
        ay += (dy / d) * power;
      }
    }

    if (b.thrust) {
      // Rockets wander: the heading drifts, which is what makes a machine
      // full of them entertaining rather than predictable.
      b.heading += Math.sin(G.t * 1.7 + b.phase) * dt * 1.5;
      ax += Math.cos(b.heading) * b.thrust;
      ay += Math.sin(b.heading) * b.thrust;
    }
    if (b.g < 0) ax += Math.sin(G.t * 2.2 + b.phase) * 220; // balloons bob

    b.vx = (b.vx + ax * dt) * b.drag;
    b.vy = (b.vy + ay * dt) * b.drag;

    const speed = Math.hypot(b.vx, b.vy);
    if (speed > 3200) {
      b.vx = (b.vx / speed) * 3200;
      b.vy = (b.vy / speed) * 3200;
    }

    b.x += b.vx * dt;
    b.y += b.vy * dt;
  }

  collide();
  triggers();
}

function collide() {
  for (const b of G.bodies) {
    // Bench walls
    if (b.x - b.r < WALL_L) { b.x = WALL_L + b.r; b.vx = Math.abs(b.vx) * b.e; }
    if (b.x + b.r > WALL_R) { b.x = WALL_R - b.r; b.vx = -Math.abs(b.vx) * b.e; }
    if (b.y - b.r < CEIL_Y) { b.y = CEIL_Y + b.r; b.vy = Math.abs(b.vy) * b.e; }
    if (b.y + b.r > FLOOR_Y) {
      b.y = FLOOR_Y - b.r;
      if (b.vy > 60) thud(b.vy);
      b.vy = -Math.abs(b.vy) * b.e;
      b.vx *= 0.99;
    }

    for (const p of G.parts) {
      for (const s of segmentsOf(p)) hitSegment(b, s);
    }
    for (const stroke of G.ink) {
      const pts = stroke.points;
      for (let i = 1; i < pts.length; i++) {
        hitSegment(b, { x1: pts[i - 1].x, y1: pts[i - 1].y, x2: pts[i].x, y2: pts[i].y, e: 0.4, w: 8 });
      }
    }
  }

  // Ball on ball: equal mass, so the resolution is a straight swap of the
  // velocity along the contact normal.
  for (let i = 0; i < G.bodies.length; i++) {
    for (let j = i + 1; j < G.bodies.length; j++) {
      const a = G.bodies[i];
      const b = G.bodies[j];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const min = a.r + b.r;
      const d2 = dx * dx + dy * dy;
      if (d2 >= min * min || d2 === 0) continue;
      const d = Math.sqrt(d2);
      const nx = dx / d;
      const ny = dy / d;
      const overlap = (min - d) / 2;
      a.x -= nx * overlap; a.y -= ny * overlap;
      b.x += nx * overlap; b.y += ny * overlap;
      const rel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
      if (rel > 0) continue;
      const e = Math.min(a.e, b.e);
      const j2 = -(1 + e) * rel * 0.5;
      a.vx -= j2 * nx; a.vy -= j2 * ny;
      b.vx += j2 * nx; b.vy += j2 * ny;
      if (-rel > 700) thud(-rel);
    }
  }
}

function hitSegment(b, s) {
  const dx = s.x2 - s.x1;
  const dy = s.y2 - s.y1;
  const len2 = dx * dx + dy * dy || 1;
  const t = clamp(((b.x - s.x1) * dx + (b.y - s.y1) * dy) / len2, 0, 1);
  const px = s.x1 + dx * t;
  const py = s.y1 + dy * t;
  let nx = b.x - px;
  let ny = b.y - py;
  let d = Math.hypot(nx, ny);
  const reach = b.r + s.w;
  if (d >= reach) return;
  if (d < 0.0001) { nx = -dy; ny = dx; d = Math.hypot(nx, ny) || 1; }
  nx /= d;
  ny /= d;
  b.x = px + nx * reach;
  b.y = py + ny * reach;

  // A spinning arm carries the ball with it, so the collision is resolved
  // against the surface's own velocity rather than against a still wall.
  let sx = 0;
  let sy = 0;
  if (s.spin) {
    const rx = px - s.spin.x;
    const ry = py - s.spin.y;
    sx = -ry * 2.1;
    sy = rx * 2.1;
  }

  let rvx = b.vx - sx;
  let rvy = b.vy - sy;
  const vn = rvx * nx + rvy * ny;
  if (vn >= 0) return;

  const jn = -(1 + s.e) * vn;
  rvx += jn * nx;
  rvy += jn * ny;

  // Coulomb-style friction: capped by the normal impulse rather than taken
  // as a flat percentage. A ball resting on a slope barely presses into it,
  // so it keeps rolling — a flat percentage is re-applied every substep and
  // glues marbles to ramps instead.
  const tx = -ny;
  const ty = nx;
  const vt = rvx * tx + rvy * ty;
  const grip = Math.min(Math.abs(vt), jn * 0.12) * Math.sign(vt);
  rvx -= grip * tx;
  rvy -= grip * ty;

  b.vx = rvx + sx;
  b.vy = rvy + sy;
  if (-vn > 400) thud(-vn);
}

let lastThud = 0;
function thud(force) {
  const now = performance.now();
  if (now - lastThud < 70) return;
  lastThud = now;
  force > 1400 ? sfx.impact() : sfx.bounce();
}

function triggers() {
  for (let i = G.bodies.length - 1; i >= 0; i--) {
    const b = G.bodies[i];

    for (const p of G.parts) {
      const d = Math.hypot(p.x - b.x, p.y - b.y);

      if (p.type === 'bomb' && !p.spent && d < b.r + 46) {
        p.spent = true;
        p.flash = 1;
        for (const other of G.bodies) {
          const dx = other.x - p.x;
          const dy = other.y - p.y;
          const dd = Math.hypot(dx, dy) || 1;
          if (dd > 480) continue;
          const power = 2300 * (1 - dd / 480);
          other.vx += (dx / dd) * power;
          other.vy += (dy / dd) * power;
        }
        G.particles.push(...createBurst(p.x, p.y, ['#ffb224', '#ff5f4d', '#ffe066'], { count: 30, speed: 520 }));
        sfx.explode();
      }

      if (p.type === 'hole' && d < 46) {
        G.bodies.splice(i, 1);
        G.particles.push(...createBurst(p.x, p.y, ['#b06bff', '#7cc4ff'], { count: 14, speed: 260 }));
        sfx.laser();
        break;
      }

      if (p.type === 'basket' && Math.abs(b.x - p.x) < 96 && b.y > p.y - 40 && b.y < p.y + 70) {
        G.bodies.splice(i, 1);
        G.score += 1;
        G.hud.setScore(0, G.score);
        G.particles.push(...createBurst(p.x, p.y - 40, ['#6ee87a', '#ffe066', '#2fd9c6'], { count: 22, speed: 380 }));
        sfx.dock();
        if (G.score % 5 === 0) G.hud.banner('Lekker bezig! 🎉', { ms: 1400 });
        break;
      }
    }
  }
}

// --- rendering ------------------------------------------------------------

function render(dt) {
  const { ctx } = G;
  drawSpaceBackdrop(ctx, G.stars, G.t, { scrollSpeed: 0 });
  drawBench(ctx);

  for (const stroke of G.ink) drawInk(ctx, stroke.points, stroke.live);
  for (const p of G.parts) drawPart(ctx, p);
  for (const b of G.bodies) drawBody(ctx, b);

  updateAndDrawParticles(ctx, G.particles, dt);

  // Segment part being dragged out right now.
  for (const d of G.drags.values()) {
    if (d.preview) drawPreview(ctx, d);
  }
}

function drawBench(ctx) {
  ctx.strokeStyle = 'rgba(124,196,255,0.22)';
  ctx.lineWidth = 4;
  ctx.setLineDash([18, 14]);
  ctx.strokeRect(WALL_L, CEIL_Y, WALL_R - WALL_L, FLOOR_Y - CEIL_Y);
  ctx.setLineDash([]);

  const g = ctx.createLinearGradient(0, FLOOR_Y, 0, FLOOR_Y + 60);
  g.addColorStop(0, '#3a57a8');
  g.addColorStop(1, '#101a4a');
  ctx.fillStyle = g;
  roundRect(ctx, WALL_L - 10, FLOOR_Y, WALL_R - WALL_L + 20, 42, 12);
  ctx.fill();
}

function drawInk(ctx, pts, live) {
  if (pts.length < 2) return;
  ctx.strokeStyle = live ? 'rgba(255,226,102,0.7)' : '#ffe066';
  ctx.lineWidth = 16;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.stroke();
}

function emoji(ctx, glyph, x, y, size, rot = 0) {
  ctx.save();
  ctx.translate(x, y);
  if (rot) ctx.rotate(rot);
  ctx.font = `${size}px serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(glyph, 0, 0);
  ctx.restore();
}

function drawPart(ctx, p) {
  switch (p.type) {
    case 'plank':
    case 'tramp': {
      const teal = p.type === 'tramp';
      ctx.save();
      ctx.lineCap = 'round';
      ctx.strokeStyle = teal ? '#2fd9c6' : '#c9a06a';
      ctx.lineWidth = teal ? 26 : 20;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x2, p.y2);
      ctx.stroke();
      ctx.strokeStyle = teal ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.25)';
      ctx.lineWidth = teal ? 8 : 5;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x2, p.y2);
      ctx.stroke();
      ctx.restore();
      break;
    }
    case 'fan': {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.fillStyle = '#274088';
      ctx.beginPath();
      ctx.arc(0, 0, 52, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#7cc4ff';
      ctx.lineWidth = 6;
      ctx.stroke();
      ctx.rotate(G.running ? G.t * 12 : 0);
      ctx.fillStyle = '#7cc4ff';
      for (let i = 0; i < 4; i++) {
        ctx.rotate(Math.PI / 2);
        ctx.beginPath();
        ctx.ellipse(0, -26, 11, 24, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
      // Direction arrow
      ctx.save();
      ctx.translate(p.x + Math.cos(p.a) * 78, p.y + Math.sin(p.a) * 78);
      ctx.rotate(p.a);
      ctx.fillStyle = 'rgba(124,196,255,0.85)';
      ctx.beginPath();
      ctx.moveTo(22, 0);
      ctx.lineTo(-14, -16);
      ctx.lineTo(-14, 16);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      break;
    }
    case 'spinner': {
      const a = p.angle || 0;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(a);
      ctx.fillStyle = '#ff7ab8';
      roundRect(ctx, -178, -15, 356, 30, 15);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      roundRect(ctx, -170, -9, 340, 8, 4);
      ctx.fill();
      ctx.restore();
      ctx.fillStyle = '#f9f4e7';
      ctx.beginPath();
      ctx.arc(p.x, p.y, 20, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'hole': {
      const g = ctx.createRadialGradient(p.x, p.y, 6, p.x, p.y, 92);
      g.addColorStop(0, '#000006');
      g.addColorStop(0.55, '#2a1250');
      g.addColorStop(1, 'rgba(42,18,80,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 92, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(176,107,255,0.8)';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.ellipse(p.x, p.y, 60, 22, G.t * 1.4, 0, Math.PI * 2);
      ctx.stroke();
      break;
    }
    case 'basket': {
      ctx.save();
      ctx.fillStyle = '#6ee87a';
      ctx.beginPath();
      ctx.moveTo(p.x - 108, p.y - 96);
      ctx.lineTo(p.x + 108, p.y - 96);
      ctx.lineTo(p.x + 86, p.y + 64);
      ctx.lineTo(p.x - 86, p.y + 64);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = 'rgba(6,10,36,0.55)';
      ctx.beginPath();
      ctx.ellipse(p.x, p.y - 96, 108, 22, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      break;
    }
    case 'fountain': {
      ctx.fillStyle = '#7cc4ff';
      roundRect(ctx, p.x - 54, p.y - 40, 108, 74, 16);
      ctx.fill();
      ctx.fillStyle = '#0e1741';
      ctx.beginPath();
      ctx.arc(p.x, p.y + 40, 22, 0, Math.PI * 2);
      ctx.fill();
      emoji(ctx, '⛲', p.x, p.y - 6, 54);
      break;
    }
    case 'bomb': {
      if (p.spent) {
        ctx.fillStyle = 'rgba(255,95,77,0.25)';
        ctx.beginPath();
        ctx.arc(p.x, p.y, 60, 0, Math.PI * 2);
        ctx.fill();
        emoji(ctx, '💨', p.x, p.y, 58);
      } else {
        emoji(ctx, '💣', p.x, p.y, 84);
      }
      break;
    }
    case 'magnet':
      emoji(ctx, '🧲', p.x, p.y, 84);
      break;
    default: {
      // A dynamic part in build mode: show the ball where it will start.
      if (!G.running) drawBody(ctx, { ...p, r: PARTS[p.type].body.r, heading: -Math.PI / 2 });
      else {
        ctx.strokeStyle = 'rgba(124,196,255,0.35)';
        ctx.lineWidth = 3;
        ctx.setLineDash([8, 8]);
        ctx.beginPath();
        ctx.arc(p.x, p.y, PARTS[p.type].body.r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
  }
}

function drawBody(ctx, b) {
  switch (b.type) {
    case 'balloon':
      emoji(ctx, '🎈', b.x, b.y + 6, b.r * 2.6);
      break;
    case 'rocket': {
      emoji(ctx, '🚀', b.x, b.y, b.r * 2.6, b.heading + Math.PI / 4);
      if (G.running && Math.random() < 0.6) {
        G.particles.push(...createBurst(
          b.x - Math.cos(b.heading) * b.r, b.y - Math.sin(b.heading) * b.r,
          ['#ffb224', '#ff5f4d'], { count: 2, speed: 120 }
        ));
      }
      break;
    }
    case 'bouncy': {
      ctx.fillStyle = '#ff8a3d';
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#7a2f0c';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r * 0.62, 0, Math.PI * 2);
      ctx.moveTo(b.x - b.r, b.y);
      ctx.lineTo(b.x + b.r, b.y);
      ctx.stroke();
      break;
    }
    default: {
      const g = ctx.createRadialGradient(b.x - b.r * 0.35, b.y - b.r * 0.4, b.r * 0.1, b.x, b.y, b.r);
      g.addColorStop(0, '#bfe3ff');
      g.addColorStop(0.5, '#3b6bff');
      g.addColorStop(1, '#16277a');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.75)';
      ctx.beginPath();
      ctx.arc(b.x - b.r * 0.32, b.y - b.r * 0.36, b.r * 0.22, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawPreview(ctx, d) {
  ctx.save();
  ctx.globalAlpha = 0.6;
  if (d.tool === 'fan') {
    const a = Math.atan2(d.cy - d.y, d.cx - d.x);
    drawPart(ctx, { type: 'fan', x: d.x, y: d.y, a });
  } else {
    drawPart(ctx, { type: d.tool, x: d.x, y: d.y, x2: d.cx, y2: d.cy });
  }
  ctx.restore();
}

// --- input ----------------------------------------------------------------

function attachPointer() {
  const { canvas, handle } = G;

  const onDown = (e) => {
    canvas.setPointerCapture(e.pointerId);
    const { x, y } = handle.toLogical(e.clientX, e.clientY);
    const tool = G.tool;

    if (tool === 'hand' || tool === 'wreck') {
      const part = [...G.parts].reverse().find((p) => partHit(p, x, y));
      if (tool === 'wreck') {
        if (part) {
          G.parts.splice(G.parts.indexOf(part), 1);
          G.particles.push(...createBurst(part.x, part.y, ['#ff5f4d', '#ffb224'], { count: 12, speed: 260 }));
          sfx.explode();
          return;
        }
        const stroke = G.ink.find((s) => s.points.some((p) => Math.hypot(p.x - x, p.y - y) < 46));
        if (stroke) {
          G.ink.splice(G.ink.indexOf(stroke), 1);
          sfx.deny();
        }
        return;
      }
      if (part) {
        G.drags.set(e.pointerId, { move: part, dx: x - part.x, dy: y - part.y });
        sfx.blip();
      }
      return;
    }

    if (tool === 'ink') {
      const stroke = { points: [{ x, y }], live: true };
      G.ink.push(stroke);
      G.drags.set(e.pointerId, { ink: stroke });
      return;
    }

    const spec = PARTS[tool];
    if (spec.seg || spec.dir) {
      G.drags.set(e.pointerId, { preview: true, tool, x, y, cx: x, cy: y });
      return;
    }

    place(tool, x, y);
  };

  const onMove = (e) => {
    const d = G.drags.get(e.pointerId);
    if (!d) return;
    const { x, y } = handle.toLogical(e.clientX, e.clientY);

    if (d.ink) {
      const last = d.ink.points[d.ink.points.length - 1];
      if (Math.hypot(x - last.x, y - last.y) > 14) d.ink.points.push({ x, y });
      return;
    }
    if (d.move) {
      const nx = clamp(x - d.dx, WALL_L, WALL_R);
      const ny = clamp(y - d.dy, CEIL_Y, FLOOR_Y);
      if (d.move.x2 !== undefined) {
        d.move.x2 += nx - d.move.x;
        d.move.y2 += ny - d.move.y;
      }
      d.move.x = nx;
      d.move.y = ny;
      return;
    }
    d.cx = x;
    d.cy = y;
  };

  const onUp = (e) => {
    const d = G.drags.get(e.pointerId);
    if (!d) return;
    G.drags.delete(e.pointerId);

    if (d.ink) {
      d.ink.live = false;
      // A stray tap shouldn't leave an invisible one-point wall behind.
      if (d.ink.points.length < 2) G.ink.splice(G.ink.indexOf(d.ink), 1);
      else sfx.blip();
      return;
    }
    if (d.move) { sfx.dock(); return; }
    if (!d.preview) return;

    const len = Math.hypot(d.cx - d.x, d.cy - d.y);
    if (d.tool === 'fan') {
      // Drag points the wind; a plain tap blows straight up.
      const a = len > 40 ? Math.atan2(d.cy - d.y, d.cx - d.x) : -Math.PI / 2;
      place('fan', d.x, d.y, { a });
      return;
    }
    if (len > 60) {
      place(d.tool, d.x, d.y, { x2: clamp(d.cx, WALL_L, WALL_R), y2: clamp(d.cy, CEIL_Y, FLOOR_Y) });
    } else {
      // Tap gives a default horizontal plank, so nobody has to discover the
      // drag gesture before they can build anything.
      place(d.tool, d.x - 150, d.y, { x2: d.x + 150, y2: d.y });
    }
  };

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  G.listeners.push(() => {
    canvas.removeEventListener('pointerdown', onDown);
    canvas.removeEventListener('pointermove', onMove);
    canvas.removeEventListener('pointerup', onUp);
    canvas.removeEventListener('pointercancel', onUp);
  });
}

function place(type, x, y, extra = {}) {
  const part = addPart(type, {
    x: clamp(x, WALL_L + 40, WALL_R - 40),
    y: clamp(y, CEIL_Y + 40, FLOOR_Y - 40),
    ...extra,
  });
  // Parts dropped into a running machine join in straight away; ⏹ still puts
  // everything back to where it was built.
  if (G.running && PARTS[type].body) spawnBody(type, part.x, part.y);
  sfx.select();
  return part;
}

// --- toolbar --------------------------------------------------------------

function buildToolbar() {
  const bar = document.createElement('div');
  bar.className = 'mach-bar';

  const buttons = new Map();
  const select = (id) => {
    G.tool = id;
    buttons.forEach((b, key) => b.classList.toggle('is-active', key === id));
    sfx.blip();
  };

  const add = (id, icon, label, handler, cls = '') => {
    const b = document.createElement('button');
    b.className = `mach-tool ${cls}`;
    b.textContent = icon;
    b.setAttribute('aria-label', label);
    b.addEventListener('pointerdown', (e) => e.stopPropagation());
    b.addEventListener('pointerup', (e) => {
      e.stopPropagation();
      handler();
    });
    bar.appendChild(b);
    buttons.set(id, b);
    return b;
  };

  for (const id of PART_ORDER) {
    add(id, PARTS[id].icon, PARTS[id].name, () => select(id));
  }

  bar.appendChild(sep());
  add('ink', '✏️', 'Tekenen — je lijn wordt een baan', () => select('ink'));
  add('hand', '✋', 'Onderdelen verschuiven', () => select('hand'));
  add('wreck', '🧨', 'Slopen', () => select('wreck'));

  bar.appendChild(sep());
  G.runBtn = add('run', '▶️', 'Start de machine', () => (G.running ? stopRun() : startRun()), 'mach-tool--go');
  add('clear', '🗑️', 'Alles opruimen', () => {
    if (!G.parts.length && !G.ink.length) return sfx.deny();
    stopRun();
    G.parts = [];
    G.ink = [];
    sfx.explode();
  });

  buttons.get(G.tool).classList.add('is-active');
  G.stage.appendChild(bar);

  G.hint = document.createElement('div');
  G.hint.className = 'hint-strip mach-hint';
  G.hint.textContent = 'Zet onderdelen neer, teken banen en druk op ▶';
  G.stage.appendChild(G.hint);
}

function refreshRunButton() {
  // The build hint has done its job once the machine has run once.
  G.hint.classList.toggle('is-gone', G.running || G.hasRun);
  G.runBtn.textContent = G.running ? '⏹' : '▶️';
  G.runBtn.setAttribute('aria-label', G.running ? 'Stop en zet alles terug' : 'Start de machine');
  G.runBtn.classList.toggle('is-running', G.running);
}

function sep() {
  const d = document.createElement('div');
  d.className = 'mach-sep';
  return d;
}
