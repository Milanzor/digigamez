// Canvas rendering helpers shared by all game modules.

// Fixed logical resolution: every game renders at this size and the canvas
// is scaled via CSS to fit the physical screen. This keeps game logic
// resolution-independent and avoids overdraw on large 4K-ish panels.
export const LOGICAL_WIDTH = 1920;
export const LOGICAL_HEIGHT = 1080;

// Sets up a canvas to render crisply at any physical size: internal pixel
// buffer matches devicePixelRatio * displayed CSS size, while game code keeps
// working in LOGICAL_WIDTH x LOGICAL_HEIGHT units via ctx transform.
export function setupCanvas(canvas) {
  const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });

  function resize() {
    const rect = canvas.parentElement.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    canvas.style.width = rect.width + 'px';
    canvas.style.height = rect.height + 'px';
    const scale = Math.min(canvas.width / LOGICAL_WIDTH, canvas.height / LOGICAL_HEIGHT);
    const offsetX = (canvas.width - LOGICAL_WIDTH * scale) / 2;
    const offsetY = (canvas.height - LOGICAL_HEIGHT * scale) / 2;
    ctx.setTransform(scale, 0, 0, scale, offsetX, offsetY);
  }

  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(canvas.parentElement);

  return { ctx, resize, disconnect: () => ro.disconnect() };
}

// Simple object pool to avoid GC churn for short-lived entities
// (bullets, particles, puzzle pieces during drag, etc).
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

export function drawStar(ctx, cx, cy, r, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const radius = i % 2 === 0 ? r : r * 0.45;
    const angle = (Math.PI / 5) * i - Math.PI / 2;
    const x = cx + Math.cos(angle) * radius;
    const y = cy + Math.sin(angle) * radius;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
}

// Lightweight particle burst for celebratory feedback ("nice job!" moments).
export function createConfettiBurst(x, y, colors) {
  const particles = [];
  const count = 24;
  for (let i = 0; i < count; i++) {
    const angle = (Math.PI * 2 * i) / count + Math.random() * 0.3;
    const speed = 300 + Math.random() * 300;
    particles.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 200,
      life: 1,
      color: colors[i % colors.length],
      size: 8 + Math.random() * 8,
    });
  }
  return particles;
}

export function updateAndDrawParticles(ctx, particles, dt) {
  const gravity = 600;
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i];
    p.vy += gravity * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.life -= dt * 0.7;
    if (p.life <= 0) {
      particles.splice(i, 1);
      continue;
    }
    ctx.globalAlpha = Math.max(p.life, 0);
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    ctx.globalAlpha = 1;
  }
}
