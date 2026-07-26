import './style.css';
import { createGameChrome } from '../../shared/ui-components.js';
import { setupCanvas, LOGICAL_WIDTH, LOGICAL_HEIGHT, createConfettiBurst, updateAndDrawParticles } from '../../shared/canvas-utils.js';
import { sfx } from '../../shell/audio.js';

const PADDLE_W = 220;
const PADDLE_H = 34;
const BALL_R = 18;
const BRICK_COLORS = ['#EF476F', '#FFD166', '#06D6A0', '#3A86FF', '#8338EC'];
const BRICK_W = 150;
const BRICK_H = 56;
const BRICK_GAP = 12;
const CONFETTI_COLORS = ['#ffd166', '#ef476f', '#06d6a0', '#3a86ff'];

let canvasHandle, cleanupFns = [], rafId = null;

export function init(container, { title, onExit, players }) {
  cleanupFns = [];
  const chrome = createGameChrome({ title, onExit });
  const stage = document.createElement('div');
  stage.className = 'bb-stage';
  const canvas = document.createElement('canvas');
  canvas.className = 'bb-canvas';
  stage.appendChild(canvas);

  const scoreEl = document.createElement('div');
  scoreEl.className = 'score-entry';
  scoreEl.style.position = 'absolute';
  scoreEl.style.top = '1rem';
  scoreEl.style.right = '1rem';
  scoreEl.style.zIndex = '20';
  scoreEl.textContent = 'Score: 0';
  stage.appendChild(scoreEl);

  container.appendChild(chrome);
  container.appendChild(stage);

  canvasHandle = setupCanvas(canvas, { alpha: false });
  const { ctx, toLogical } = canvasHandle;

  const twoP = players === 2;
  const paddles = twoP
    ? [
        { x: LOGICAL_WIDTH / 2, y: LOGICAL_HEIGHT - 60, color: '#EF476F', zone: 'bottom' },
        { x: LOGICAL_WIDTH / 2, y: 60, color: '#3A86FF', zone: 'top' },
      ]
    : [{ x: LOGICAL_WIDTH / 2, y: LOGICAL_HEIGHT - 60, color: '#FFD166', zone: 'bottom' }];

  let score = 0;
  const particles = [];
  let bricks = [];

  function buildBricks() {
    bricks = [];
    const cols = 10;
    const rows = twoP ? 3 : 5;
    const totalW = cols * (BRICK_W + BRICK_GAP) - BRICK_GAP;
    const startX = (LOGICAL_WIDTH - totalW) / 2 + BRICK_W / 2;
    const startY = twoP ? LOGICAL_HEIGHT / 2 - (rows * (BRICK_H + BRICK_GAP)) / 2 : 140;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        bricks.push({
          x: startX + c * (BRICK_W + BRICK_GAP),
          y: startY + r * (BRICK_H + BRICK_GAP),
          alive: true,
          color: BRICK_COLORS[r % BRICK_COLORS.length],
        });
      }
    }
  }
  buildBricks();

  function resetBall() {
    const angle = (Math.random() * 0.5 + 0.25) * Math.PI + (Math.random() < 0.5 ? Math.PI : 0);
    return {
      x: LOGICAL_WIDTH / 2,
      y: LOGICAL_HEIGHT / 2,
      vx: Math.cos(angle) * 500,
      vy: Math.sin(angle) * 500 || 400,
    };
  }
  let ball = resetBall();
  let waveTransitioning = false;

  const pointerZones = new Map();
  function assignZone(clientY) {
    if (!twoP) return paddles[0];
    const rect = canvas.getBoundingClientRect();
    const relY = (clientY - rect.top) / rect.height;
    return relY > 0.5 ? paddles[0] : paddles[1];
  }
  function pointerDown(e) {
    const paddle = assignZone(e.clientY);
    pointerZones.set(e.pointerId, paddle);
    const { x } = toLogical(e.clientX, e.clientY);
    paddle.x = Math.max(PADDLE_W / 2, Math.min(LOGICAL_WIDTH - PADDLE_W / 2, x));
  }
  function pointerMove(e) {
    const paddle = pointerZones.get(e.pointerId);
    if (!paddle) return;
    const { x } = toLogical(e.clientX, e.clientY);
    paddle.x = Math.max(PADDLE_W / 2, Math.min(LOGICAL_WIDTH - PADDLE_W / 2, x));
  }
  function pointerUp(e) {
    pointerZones.delete(e.pointerId);
  }
  canvas.addEventListener('pointerdown', pointerDown);
  canvas.addEventListener('pointermove', pointerMove);
  canvas.addEventListener('pointerup', pointerUp);
  canvas.addEventListener('pointercancel', pointerUp);

  function update(dt) {
    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;

    if (ball.x < BALL_R) { ball.x = BALL_R; ball.vx *= -1; }
    if (ball.x > LOGICAL_WIDTH - BALL_R) { ball.x = LOGICAL_WIDTH - BALL_R; ball.vx *= -1; }

    if (!twoP && ball.y < BALL_R) { ball.y = BALL_R; ball.vy *= -1; }

    for (const paddle of paddles) {
      const withinX = Math.abs(ball.x - paddle.x) < PADDLE_W / 2 + BALL_R;
      const withinY = Math.abs(ball.y - paddle.y) < PADDLE_H / 2 + BALL_R;
      if (withinX && withinY) {
        const offset = (ball.x - paddle.x) / (PADDLE_W / 2);
        const speed = Math.min(Math.hypot(ball.vx, ball.vy) * 1.03, 900);
        const dir = paddle.zone === 'bottom' ? -1 : 1;
        const angle = offset * (Math.PI / 3);
        ball.vx = Math.sin(angle) * speed;
        ball.vy = Math.cos(angle) * speed * dir;
        ball.y = paddle.zone === 'bottom' ? paddle.y - PADDLE_H / 2 - BALL_R : paddle.y + PADDLE_H / 2 + BALL_R;
        sfx.hit();
      }
    }

    for (const brick of bricks) {
      if (!brick.alive) continue;
      const withinX = Math.abs(ball.x - brick.x) < BRICK_W / 2 + BALL_R;
      const withinY = Math.abs(ball.y - brick.y) < BRICK_H / 2 + BALL_R;
      if (withinX && withinY) {
        brick.alive = false;
        ball.vy *= -1;
        score++;
        scoreEl.textContent = `Score: ${score}`;
        particles.push(...createConfettiBurst(brick.x, brick.y, CONFETTI_COLORS));
        sfx.pop();
        break;
      }
    }

    const lost = twoP
      ? (ball.y < -80 || ball.y > LOGICAL_HEIGHT + 80)
      : (ball.y > LOGICAL_HEIGHT + 80);
    if (lost) {
      ball = resetBall();
      sfx.fail();
    }

    if (!waveTransitioning && bricks.every((b) => !b.alive)) {
      waveTransitioning = true;
      sfx.celebrate();
      setTimeout(() => {
        buildBricks();
        waveTransitioning = false;
      }, 700);
    }
  }

  function draw() {
    ctx.fillStyle = twoP ? '#12163a' : '#1c2154';
    ctx.fillRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);

    for (const brick of bricks) {
      if (!brick.alive) continue;
      ctx.fillStyle = brick.color;
      ctx.beginPath();
      ctx.roundRect(brick.x - BRICK_W / 2, brick.y - BRICK_H / 2, BRICK_W, BRICK_H, 10);
      ctx.fill();
    }

    for (const paddle of paddles) {
      ctx.fillStyle = paddle.color;
      ctx.beginPath();
      ctx.roundRect(paddle.x - PADDLE_W / 2, paddle.y - PADDLE_H / 2, PADDLE_W, PADDLE_H, 16);
      ctx.fill();
    }

    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, BALL_R, 0, Math.PI * 2);
    ctx.fill();

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
