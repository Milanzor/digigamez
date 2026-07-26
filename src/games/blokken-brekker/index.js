import './style.css';
import { createHud } from '../../shared/ui-components.js';
import {
  setupCanvas, LOGICAL_WIDTH, LOGICAL_HEIGHT,
  createStars, drawSpaceBackdrop, createBurst, updateAndDrawParticles, roundRect,
} from '../../shared/canvas-utils.js';
import { sfx } from '../../shell/audio.js';
import { setLevel } from '../../shell/progress.js';

// "Asteroïdenveld" — Breakout with a mining-ship framing.
//
// Losing a ball costs nothing but a moment: it respawns in the middle. The
// depth is in the field itself — asteroids take 1-3 hits, layouts change per
// level, and destroyed rocks can drop power-ups.
//
// In 2-player mode paddles sit top and bottom and the players co-operate to
// keep one ball alive, which is far less frustrating for young children than
// competing for it.

const PADDLE_W = 250;
const PADDLE_H = 36;
const BALL_R = 20;
const ROCK_W = 148;
const ROCK_H = 58;
const GAP = 12;

const HP_COLORS = { 1: '#7cc4ff', 2: '#b06bff', 3: '#ff5f4d' };
const BURST_COLORS = ['#ffb224', '#7cc4ff', '#ffffff', '#b06bff'];
const POWERS = ['wide', 'multi', 'slow'];

let hud = null;
let handle = null;
let raf = null;
let listeners = [];
let slug = 'blokken-brekker';

export function init(container, opts) {
  slug = opts.slug;
  listeners = [];

  const players = opts.players || 1;
  const twoP = players === 2;
  let level = Math.max(1, opts.startLevel || 1);

  hud = createHud(container, {
    title: opts.title,
    onExit: opts.onExit,
    level,
    players: 1,
    showScore: true,
  });

  const stage = document.createElement('div');
  stage.className = 'ast-stage';
  const canvas = document.createElement('canvas');
  canvas.className = 'ast-canvas';
  stage.appendChild(canvas);
  container.appendChild(stage);

  handle = setupCanvas(canvas, { alpha: false });
  const { ctx, toLogical } = handle;
  const stars = createStars(130);

  const paddles = twoP
    ? [
        { x: LOGICAL_WIDTH / 2, y: LOGICAL_HEIGHT - 74, color: '#ff5f4d', side: 'bottom', wideT: 0 },
        { x: LOGICAL_WIDTH / 2, y: 74, color: '#2fd9c6', side: 'top', wideT: 0 },
      ]
    : [{ x: LOGICAL_WIDTH / 2, y: LOGICAL_HEIGHT - 74, color: '#ffb224', side: 'bottom', wideT: 0 }];

  let score = 0;
  let t = 0;
  let slowT = 0;
  let clearing = false;
  const particles = [];
  const powerups = [];
  let balls = [];
  let rocks = [];

  function paddleWidth(p) {
    return t < p.wideT ? PADDLE_W * 1.7 : PADDLE_W;
  }

  function spawnBall() {
    const angle = (Math.random() * 0.5 + 0.25) * Math.PI * (Math.random() < 0.5 ? 1 : -1);
    const speed = Math.min(520 + level * 22, 900);
    return {
      x: LOGICAL_WIDTH / 2,
      y: LOGICAL_HEIGHT / 2,
      vx: Math.cos(angle) * speed * (Math.random() < 0.5 ? 1 : -1),
      vy: (Math.sin(angle) || 0.6) * speed,
    };
  }

  // Layout patterns cycle so each level looks different, not just faster.
  function buildField() {
    rocks = [];
    clearing = false;
    hud.setLevel(level);

    const cols = 10;
    const rows = twoP ? 3 : Math.min(3 + Math.floor(level / 2), 6);
    const totalW = cols * (ROCK_W + GAP) - GAP;
    const startX = (LOGICAL_WIDTH - totalW) / 2 + ROCK_W / 2;
    const startY = twoP
      ? LOGICAL_HEIGHT / 2 - (rows * (ROCK_H + GAP)) / 2
      : 210;

    const pattern = level % 4;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        // Pattern 1 = checkerboard, 2 = pyramid, 3 = gaps down the middle
        if (pattern === 1 && (r + c) % 2 === 1) continue;
        if (pattern === 2 && (c < r || c > cols - 1 - r)) continue;
        if (pattern === 3 && (c === 4 || c === 5) && r % 2 === 0) continue;

        // Tougher rock the higher up the field it sits.
        let hp = 1;
        if (level >= 2 && r < rows - 1) hp = 2;
        if (level >= 4 && r === 0) hp = 3;

        rocks.push({
          x: startX + c * (ROCK_W + GAP),
          y: startY + r * (ROCK_H + GAP),
          hp,
          maxHp: hp,
          alive: true,
        });
      }
    }
    balls = [spawnBall()];
  }
  buildField();

  // --- input ---
  const owners = new Map();
  const paddleFor = (clientY) => {
    if (!twoP) return paddles[0];
    const rect = canvas.getBoundingClientRect();
    return (clientY - rect.top) / rect.height > 0.5 ? paddles[0] : paddles[1];
  };
  const clampX = (p, x) => {
    const hw = paddleWidth(p) / 2;
    return Math.max(hw, Math.min(LOGICAL_WIDTH - hw, x));
  };

  const onDown = (e) => {
    const p = paddleFor(e.clientY);
    owners.set(e.pointerId, p);
    p.x = clampX(p, toLogical(e.clientX, e.clientY).x);
  };
  const onMove = (e) => {
    const p = owners.get(e.pointerId);
    if (!p) return;
    p.x = clampX(p, toLogical(e.clientX, e.clientY).x);
  };
  const onUp = (e) => owners.delete(e.pointerId);

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);

  function hitRock(rock, ball) {
    rock.hp -= 1;
    if (rock.hp > 0) {
      sfx.impact();
      particles.push(...createBurst(rock.x, rock.y, [HP_COLORS[rock.maxHp]], { count: 6, speed: 180 }));
      return;
    }
    rock.alive = false;
    score += rock.maxHp;
    hud.setScore(0, score);
    particles.push(...createBurst(rock.x, rock.y, BURST_COLORS, { count: 18, speed: 300 }));
    sfx.explode();

    if (Math.random() < 0.12) {
      powerups.push({
        x: rock.x,
        y: rock.y,
        kind: POWERS[Math.floor(Math.random() * POWERS.length)],
        spin: 0,
      });
    }
  }

  function update(dt) {
    t += dt;
    const speedScale = t < slowT ? 0.55 : 1;

    for (let bi = balls.length - 1; bi >= 0; bi--) {
      const ball = balls[bi];
      ball.x += ball.vx * dt * speedScale;
      ball.y += ball.vy * dt * speedScale;

      if (ball.x < BALL_R) { ball.x = BALL_R; ball.vx = Math.abs(ball.vx); sfx.bounce(); }
      if (ball.x > LOGICAL_WIDTH - BALL_R) { ball.x = LOGICAL_WIDTH - BALL_R; ball.vx = -Math.abs(ball.vx); sfx.bounce(); }
      if (!twoP && ball.y < BALL_R) { ball.y = BALL_R; ball.vy = Math.abs(ball.vy); sfx.bounce(); }

      for (const p of paddles) {
        const hw = paddleWidth(p) / 2;
        if (Math.abs(ball.x - p.x) < hw + BALL_R && Math.abs(ball.y - p.y) < PADDLE_H / 2 + BALL_R) {
          // Bounce angle follows where on the paddle it landed, so a child
          // can actually aim rather than just intercept.
          const offset = (ball.x - p.x) / hw;
          const speed = Math.min(Math.hypot(ball.vx, ball.vy) * 1.02, 980);
          const angle = offset * (Math.PI / 3.2);
          const dir = p.side === 'bottom' ? -1 : 1;
          ball.vx = Math.sin(angle) * speed;
          ball.vy = Math.cos(angle) * speed * dir;
          ball.y = p.side === 'bottom'
            ? p.y - PADDLE_H / 2 - BALL_R
            : p.y + PADDLE_H / 2 + BALL_R;
          sfx.bounce();
        }
      }

      for (const rock of rocks) {
        if (!rock.alive) continue;
        if (Math.abs(ball.x - rock.x) < ROCK_W / 2 + BALL_R
          && Math.abs(ball.y - rock.y) < ROCK_H / 2 + BALL_R) {
          // Reflect on whichever axis is the shallower overlap.
          const dx = (ROCK_W / 2 + BALL_R) - Math.abs(ball.x - rock.x);
          const dy = (ROCK_H / 2 + BALL_R) - Math.abs(ball.y - rock.y);
          if (dx < dy) ball.vx *= -1; else ball.vy *= -1;
          hitRock(rock, ball);
          break;
        }
      }

      const out = twoP
        ? (ball.y < -60 || ball.y > LOGICAL_HEIGHT + 60)
        : ball.y > LOGICAL_HEIGHT + 60;
      if (out) {
        balls.splice(bi, 1);
        if (balls.length === 0) {
          balls.push(spawnBall());
          sfx.deny();
        }
      }
    }

    for (let i = powerups.length - 1; i >= 0; i--) {
      const p = powerups[i];
      p.y += 230 * dt;
      p.spin += dt * 3.4;
      if (p.y > LOGICAL_HEIGHT + 40) { powerups.splice(i, 1); continue; }
      for (const pad of paddles) {
        if (Math.abs(p.x - pad.x) < paddleWidth(pad) / 2 + 34
          && Math.abs(p.y - pad.y) < 60) {
          applyPower(p.kind, pad);
          powerups.splice(i, 1);
          break;
        }
      }
    }

    if (!clearing && rocks.length && rocks.every((r) => !r.alive)) {
      clearing = true;
      level += 1;
      setLevel(slug, level);
      sfx.missionComplete();
      hud.banner('Veld leeggemijnd! ☄️', { sub: `Level ${level}`, ms: 1600 });
      setTimeout(buildField, 1700);
    }
  }

  function applyPower(kind, pad) {
    sfx.powerup();
    if (kind === 'wide') {
      pad.wideT = t + 12;
      hud.banner('Brede vanger!', { ms: 1000, hint: true });
    } else if (kind === 'slow') {
      slowT = t + 9;
      hud.banner('Trage bal!', { ms: 1000, hint: true });
    } else {
      const src = balls[0];
      if (src && balls.length < 4) {
        const speed = Math.hypot(src.vx, src.vy);
        balls.push({ x: src.x, y: src.y, vx: -src.vx, vy: src.vy });
        balls.push({ x: src.x, y: src.y, vx: speed * 0.4, vy: -src.vy });
      }
      hud.banner('Meer ballen!', { ms: 1000, hint: true });
    }
  }

  function draw(dt) {
    drawSpaceBackdrop(ctx, stars, t, { scrollSpeed: 8 });

    for (const rock of rocks) {
      if (!rock.alive) continue;
      const color = HP_COLORS[rock.hp] || '#7cc4ff';
      ctx.save();
      ctx.shadowColor = color;
      ctx.shadowBlur = 14;
      ctx.fillStyle = color;
      roundRect(ctx, rock.x - ROCK_W / 2, rock.y - ROCK_H / 2, ROCK_W, ROCK_H, 14);
      ctx.fill();
      ctx.restore();
      // Crater speckles hint that these are rocks, not bricks. Each needs its
      // own path — consecutive arcs in one path get joined by a line.
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      for (const [cx, cy, cr] of [[-34, -8, 9], [22, 10, 12], [48, -12, 6]]) {
        ctx.beginPath();
        ctx.arc(rock.x + cx, rock.y + cy, cr, 0, Math.PI * 2);
        ctx.fill();
      }
      if (rock.hp > 1) {
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.font = 'bold 26px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(rock.hp), rock.x, rock.y);
      }
    }

    for (const p of powerups) {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.spin);
      ctx.shadowColor = '#6ee87a';
      ctx.shadowBlur = 24;
      ctx.fillStyle = '#6ee87a';
      roundRect(ctx, -25, -25, 50, 50, 13);
      ctx.fill();
      ctx.restore();
      ctx.fillStyle = '#0e1741';
      ctx.font = 'bold 30px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(p.kind === 'wide' ? '↔' : p.kind === 'slow' ? '🐢' : '＋', p.x, p.y);
    }

    for (const p of paddles) {
      const w = paddleWidth(p);
      ctx.save();
      ctx.shadowColor = p.color;
      ctx.shadowBlur = 22;
      ctx.fillStyle = p.color;
      roundRect(ctx, p.x - w / 2, p.y - PADDLE_H / 2, w, PADDLE_H, 18);
      ctx.fill();
      ctx.restore();
      ctx.fillStyle = 'rgba(255,255,255,0.55)';
      roundRect(ctx, p.x - w / 2 + 14, p.y - PADDLE_H / 2 + 7, w - 28, 8, 4);
      ctx.fill();
    }

    ctx.save();
    ctx.shadowColor = '#ffffff';
    ctx.shadowBlur = 22;
    ctx.fillStyle = '#ffffff';
    for (const ball of balls) {
      ctx.beginPath();
      ctx.arc(ball.x, ball.y, BALL_R, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    updateAndDrawParticles(ctx, particles, dt, { gravity: 120 });
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
  hud?.destroy();
  hud = null;
}
