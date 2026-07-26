import './style.css';
import { createGameChrome, createScoreboard } from '../../shared/ui-components.js';
import { setupCanvas, LOGICAL_WIDTH, LOGICAL_HEIGHT, ObjectPool, createConfettiBurst, updateAndDrawParticles } from '../../shared/canvas-utils.js';
import { sfx } from '../../shell/audio.js';

const ALIEN_W = 90;
const ALIEN_H = 70;
const ALIEN_COLORS = ['#06D6A0', '#FFD166', '#EF476F', '#3A86FF', '#8338EC'];
const SHIP_W = 120;
const SHIP_H = 60;
const BULLET_SPEED = 900;
const FIRE_INTERVAL = 0.4;
const CONFETTI_COLORS = ['#ffd166', '#ef476f', '#06d6a0', '#3a86ff'];

let canvasHandle, cleanupFns = [], rafId = null;

export function init(container, { title, onExit, players }) {
  cleanupFns = [];
  const chrome = createGameChrome({ title, onExit });
  const stage = document.createElement('div');
  stage.className = 'ri-stage';
  const canvas = document.createElement('canvas');
  canvas.className = 'ri-canvas';
  stage.appendChild(canvas);

  let scoreboard = null;
  if (players === 2) {
    scoreboard = createScoreboard([1, 2]);
    container.appendChild(scoreboard.el);
    const divider = document.createElement('div');
    divider.className = 'ri-split-line';
    stage.appendChild(divider);
  }

  container.appendChild(chrome);
  container.appendChild(stage);

  canvasHandle = setupCanvas(canvas, { alpha: false });
  const { ctx, toLogical } = canvasHandle;

  const ships = players === 2
    ? [
        { x: LOGICAL_WIDTH * 0.25, minX: 0, maxX: LOGICAL_WIDTH / 2, color: '#EF476F', fireTimer: 0, score: 0 },
        { x: LOGICAL_WIDTH * 0.75, minX: LOGICAL_WIDTH / 2, maxX: LOGICAL_WIDTH, color: '#3A86FF', fireTimer: 0, score: 0 },
      ]
    : [{ x: LOGICAL_WIDTH / 2, minX: 0, maxX: LOGICAL_WIDTH, color: '#FFD166', fireTimer: 0, score: 0 }];

  const bulletPool = new ObjectPool(
    () => ({ x: 0, y: 0, active: false, owner: 0 }),
    (b, x, y, owner) => { b.x = x; b.y = y; b.active = true; b.owner = owner; }
  );
  const activeBullets = [];
  const particles = [];

  let aliens = [];
  let waveNumber = 0;
  let formationOriginX = LOGICAL_WIDTH / 2;
  let formationDir = 1;
  let formationSpeed = 100;
  let t = 0;
  let waveTransitioning = false;

  function spawnWave() {
    waveNumber++;
    const cols = Math.min(9, 6 + Math.floor(waveNumber / 2));
    const rows = Math.min(4, 2 + Math.floor(waveNumber / 3));
    aliens = [];
    const gridW = cols * ALIEN_W;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        aliens.push({
          ox: c * ALIEN_W - gridW / 2 + ALIEN_W / 2,
          oy: r * ALIEN_H,
          alive: true,
          color: ALIEN_COLORS[(r + c) % ALIEN_COLORS.length],
          bob: Math.random() * Math.PI * 2,
        });
      }
    }
    formationSpeed = Math.min(220, 100 + waveNumber * 12);
  }
  spawnWave();

  const pointerZones = new Map();
  function pointerDown(e) {
    const { x } = toLogical(e.clientX, e.clientY);
    const ship = ships.find((s) => x >= s.minX && x <= s.maxX) || ships[0];
    pointerZones.set(e.pointerId, ship);
    ship.x = Math.max(ship.minX + SHIP_W / 2, Math.min(ship.maxX - SHIP_W / 2, x));
  }
  function pointerMove(e) {
    const ship = pointerZones.get(e.pointerId);
    if (!ship) return;
    const { x } = toLogical(e.clientX, e.clientY);
    ship.x = Math.max(ship.minX + SHIP_W / 2, Math.min(ship.maxX - SHIP_W / 2, x));
  }
  function pointerUp(e) {
    pointerZones.delete(e.pointerId);
  }
  canvas.addEventListener('pointerdown', pointerDown);
  canvas.addEventListener('pointermove', pointerMove);
  canvas.addEventListener('pointerup', pointerUp);
  canvas.addEventListener('pointercancel', pointerUp);

  function update(dt) {
    t += dt;

    const gridW = 9 * ALIEN_W;
    const minOrigin = gridW / 2 + 20;
    const maxOrigin = LOGICAL_WIDTH - gridW / 2 - 20;
    formationOriginX += formationDir * formationSpeed * dt;
    if (formationOriginX < minOrigin || formationOriginX > maxOrigin) {
      formationDir *= -1;
      formationOriginX = Math.max(minOrigin, Math.min(maxOrigin, formationOriginX));
    }

    ships.forEach((ship, idx) => {
      ship.fireTimer -= dt;
      if (ship.fireTimer <= 0) {
        ship.fireTimer = FIRE_INTERVAL;
        const bullet = bulletPool.acquire(ship.x, LOGICAL_HEIGHT - 140, idx);
        activeBullets.push(bullet);
        sfx.shoot();
      }
    });

    for (let i = activeBullets.length - 1; i >= 0; i--) {
      const b = activeBullets[i];
      b.y -= BULLET_SPEED * dt;
      if (b.y < 0) {
        activeBullets.splice(i, 1);
        bulletPool.release(b);
        continue;
      }
      for (const alien of aliens) {
        if (!alien.alive) continue;
        const ax = formationOriginX + alien.ox;
        const ay = 160 + alien.oy;
        if (Math.abs(b.x - ax) < ALIEN_W / 2 && Math.abs(b.y - ay) < ALIEN_H / 2) {
          alien.alive = false;
          activeBullets.splice(i, 1);
          bulletPool.release(b);
          ships[b.owner].score++;
          if (scoreboard) scoreboard.update(b.owner, ships[b.owner].score);
          particles.push(...createConfettiBurst(ax, ay, CONFETTI_COLORS));
          sfx.pop();
          break;
        }
      }
    }

    if (!waveTransitioning && aliens.length > 0 && aliens.every((a) => !a.alive)) {
      waveTransitioning = true;
      sfx.celebrate();
      setTimeout(() => {
        spawnWave();
        waveTransitioning = false;
      }, 700);
    }
  }

  function draw() {
    ctx.fillStyle = '#0b1042';
    ctx.fillRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);

    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    for (let i = 0; i < 40; i++) {
      const sx = (i * 197) % LOGICAL_WIDTH;
      const sy = (i * 331 + t * 20) % LOGICAL_HEIGHT;
      ctx.fillRect(sx, sy, 3, 3);
    }

    for (const alien of aliens) {
      if (!alien.alive || alien.dummy) continue;
      const ax = formationOriginX + alien.ox;
      const ay = 160 + alien.oy + Math.sin(t * 2 + alien.bob) * 6;
      ctx.fillStyle = alien.color;
      ctx.beginPath();
      ctx.roundRect(ax - ALIEN_W / 2, ay - ALIEN_H / 2, ALIEN_W, ALIEN_H, 18);
      ctx.fill();
      ctx.fillStyle = '#0b1042';
      ctx.beginPath();
      ctx.arc(ax - 20, ay - 6, 8, 0, Math.PI * 2);
      ctx.arc(ax + 20, ay - 6, 8, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = '#ffe66d';
    for (const b of activeBullets) {
      ctx.beginPath();
      ctx.arc(b.x, b.y, 8, 0, Math.PI * 2);
      ctx.fill();
    }

    for (const ship of ships) {
      ctx.fillStyle = ship.color;
      ctx.beginPath();
      ctx.moveTo(ship.x, LOGICAL_HEIGHT - 160);
      ctx.lineTo(ship.x - SHIP_W / 2, LOGICAL_HEIGHT - 100);
      ctx.lineTo(ship.x + SHIP_W / 2, LOGICAL_HEIGHT - 100);
      ctx.closePath();
      ctx.fill();
      ctx.fillRect(ship.x - SHIP_W / 2, LOGICAL_HEIGHT - 100, SHIP_W, SHIP_H * 0.5);
    }

    updateAndDrawParticles(ctx, particles, 1 / 60);
  }

  let lastTime = performance.now();
  function loop(now) {
    const dt = Math.min((now - lastTime) / 1000, 0.05);
    lastTime = now;
    update(dt);
    draw();
    rafId = requestAnimationFrame(loop);
  }
  rafId = requestAnimationFrame(loop);

  cleanupFns.push(() => {
    cancelAnimationFrame(rafId);
    canvas.removeEventListener('pointerdown', pointerDown);
    canvas.removeEventListener('pointermove', pointerMove);
    canvas.removeEventListener('pointerup', pointerUp);
    canvas.removeEventListener('pointercancel', pointerUp);
    canvasHandle.disconnect();
  });
}

export function destroy() {
  cleanupFns.forEach((fn) => fn());
  cleanupFns = [];
}
