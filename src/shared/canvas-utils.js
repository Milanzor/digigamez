// Canvas rendering helpers shared by all game modules.

// Fixed logical resolution: every game renders into this coordinate space
// and the canvas is scaled to fit the physical screen. Game logic stays
// resolution-independent, and a 4K digiboard costs no more logic than a
// 1080p one (only the pixel buffer differs).
export const LOGICAL_WIDTH = 1920;
export const LOGICAL_HEIGHT = 1080;

// `preserveOnResize` keeps whatever is already on the canvas across a resize.
// Assigning canvas.width wipes the bitmap, and ResizeObserver always fires
// once on observe — so a game that paints only once (the drawing board) would
// otherwise be cleared immediately after its first paint.
export function setupCanvas(canvas, { alpha = false, preserveOnResize = false } = {}) {
  const ctx = canvas.getContext('2d', { alpha, desynchronized: true });
  let scale = 1, offsetX = 0, offsetY = 0, dpr = 1;

  function resize() {
    let snapshot = null;
    if (preserveOnResize && canvas.width > 0 && canvas.height > 0) {
      snapshot = document.createElement('canvas');
      snapshot.width = canvas.width;
      snapshot.height = canvas.height;
      snapshot.getContext('2d').drawImage(canvas, 0, 0);
    }

    const rect = canvas.parentElement.getBoundingClientRect();
    // Cap DPR at 2: beyond that the extra pixels are invisible at digiboard
    // viewing distance but the fill cost grows quadratically.
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    canvas.style.width = rect.width + 'px';
    canvas.style.height = rect.height + 'px';
    scale = Math.min(canvas.width / LOGICAL_WIDTH, canvas.height / LOGICAL_HEIGHT);
    offsetX = (canvas.width - LOGICAL_WIDTH * scale) / 2;
    offsetY = (canvas.height - LOGICAL_HEIGHT * scale) / 2;
    ctx.setTransform(scale, 0, 0, scale, offsetX, offsetY);

    if (snapshot) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.drawImage(snapshot, 0, 0, snapshot.width, snapshot.height, 0, 0, canvas.width, canvas.height);
      ctx.restore();
    }
  }

  // Maps a viewport coordinate into logical canvas space.
  function toLogical(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const px = (clientX - rect.left) * dpr;
    const py = (clientY - rect.top) * dpr;
    return { x: (px - offsetX) / scale, y: (py - offsetY) / scale };
  }

  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(canvas.parentElement);

  return { ctx, resize, toLogical, disconnect: () => ro.disconnect() };
}

// Object pool: avoids allocating short-lived entities (bullets, particles)
// every frame, which keeps GC pauses out of the animation loop.
export class ObjectPool {
  constructor(factory, reset) {
    this.factory = factory;
    this.reset = reset;
    this.free = [];
  }
  acquire(...args) {
    const obj = this.free.pop() || this.factory();
    this.reset(obj, ...args);
    return obj;
  }
  release(obj) {
    this.free.push(obj);
  }
}

export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function drawStar(ctx, cx, cy, r, color, points = 5) {
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const radius = i % 2 === 0 ? r : r * 0.45;
    const angle = (Math.PI / points) * i - Math.PI / 2;
    const x = cx + Math.cos(angle) * radius;
    const y = cy + Math.sin(angle) * radius;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
}

// --- Space backdrop -------------------------------------------------------

// Deterministic star layout so the field doesn't reshuffle on resize.
export function createStars(count = 140) {
  const stars = [];
  let seed = 1337;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  for (let i = 0; i < count; i++) {
    stars.push({
      x: rnd() * LOGICAL_WIDTH,
      y: rnd() * LOGICAL_HEIGHT,
      r: 0.7 + rnd() * 2.1,
      depth: 0.3 + rnd() * 1.4,
      twinkle: rnd() * Math.PI * 2,
    });
  }
  return stars;
}

// Fills the whole logical canvas with the space gradient + drifting stars.
export function drawSpaceBackdrop(ctx, stars, t, { scrollSpeed = 14 } = {}) {
  const g = ctx.createLinearGradient(0, 0, LOGICAL_WIDTH * 0.3, LOGICAL_HEIGHT);
  g.addColorStop(0, '#101a4a');
  g.addColorStop(0.65, '#0a1036');
  g.addColorStop(1, '#060a24');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);

  // Nebula wash for depth — two soft radial blooms.
  const neb = ctx.createRadialGradient(
    LOGICAL_WIDTH * 0.8, LOGICAL_HEIGHT * 0.2, 0,
    LOGICAL_WIDTH * 0.8, LOGICAL_HEIGHT * 0.2, LOGICAL_HEIGHT * 0.85
  );
  neb.addColorStop(0, 'rgba(176,107,255,0.20)');
  neb.addColorStop(1, 'rgba(176,107,255,0)');
  ctx.fillStyle = neb;
  ctx.fillRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);

  for (const s of stars) {
    const y = (s.y + t * scrollSpeed * s.depth) % LOGICAL_HEIGHT;
    const a = 0.45 + 0.55 * Math.sin(t * 1.6 + s.twinkle) * 0.5 + 0.25;
    ctx.globalAlpha = Math.min(1, Math.max(0.15, a));
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(s.x, y, s.r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

export function withGlow(ctx, color, blur, fn) {
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = blur;
  fn();
  ctx.restore();
}

// --- Particles ------------------------------------------------------------

export function createBurst(x, y, colors, { count = 22, speed = 320, spread = Math.PI * 2, dir = 0 } = {}) {
  const particles = [];
  for (let i = 0; i < count; i++) {
    const angle = dir + (spread * (i / count - 0.5)) + (Math.random() - 0.5) * 0.4;
    const v = speed * (0.55 + Math.random() * 0.9);
    particles.push({
      x, y,
      vx: Math.cos(angle) * v,
      vy: Math.sin(angle) * v,
      life: 1,
      decay: 0.8 + Math.random() * 0.7,
      color: colors[i % colors.length],
      size: 5 + Math.random() * 9,
      spin: (Math.random() - 0.5) * 12,
      rot: Math.random() * Math.PI,
    });
  }
  return particles;
}

export function updateAndDrawParticles(ctx, particles, dt, { gravity = 420 } = {}) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.vy += gravity * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.rot += p.spin * dt;
    p.life -= dt * p.decay;
    if (p.life <= 0) {
      particles.splice(i, 1);
      continue;
    }
    ctx.globalAlpha = Math.max(0, Math.min(1, p.life));
    ctx.fillStyle = p.color;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}
