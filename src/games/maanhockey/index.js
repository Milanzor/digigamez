import './style.css';
import { createHud, showMissionComplete } from '../../shared/ui-components.js';
import {
  setupCanvas, LOGICAL_WIDTH, LOGICAL_HEIGHT,
  createStars, drawSpaceBackdrop, createBurst, updateAndDrawParticles,
  drawGlow, roundRect, withAlpha,
} from '../../shared/canvas-utils.js';
import { sfx } from '../../shell/audio.js';
import { setLevel, starsForLevel } from '../../shell/progress.js';
import { getItem, setItem } from '../../shell/storage.js';

// "Maanhockey" — air hockey with a little moon for a puck.
//
// This is the one thing a 75" multi-touch board does that a tablet cannot:
// two children standing shoulder to shoulder, each with a hand on the glass,
// playing each other in real time. Alone you play a robot that is deliberately
// a step behind. Together you can also pick the co-operative rally, where
// there are no goals at all and one shared counter climbs as long as you keep
// the moon moving — nobody loses that one by definition.
//
// The ball/paddle maths is the same family as Asteroïdenveld's, which is why
// this was the cheapest big game left on the list.

const RINK = { x0: 46, y0: 152, x1: LOGICAL_WIDTH - 46, y1: LOGICAL_HEIGHT - 46 };
const MID_X = (RINK.x0 + RINK.x1) / 2;
const MID_Y = (RINK.y0 + RINK.y1) / 2;
const GOAL_HALF = 148;
const PADDLE_R = 76;
const PUCK_R = 34;
const PADDLE_SPEED = 2900;
const GOALS_TO_WIN = 5;

const P1_COLOR = '#ff6b6b';
const P2_COLOR = '#5fe3c4';
const ROBOT_COLOR = '#8fd6ff';

let hud = null;
let handle = null;
let raf = null;
let listeners = [];
let reward = null;
let stage = null;
let level = 1;
let slug = 'maanhockey';
let mission = null;
let onExit = null;

function levelConfig(l) {
  const n = Math.max(1, l);
  return {
    puckSpeed: Math.min(680 + n * 55, 1000),
    maxSpeed: Math.min(1020 + n * 70, 1500),
    // The robot gains reach with the level, but never quite enough to sit on
    // its own goal line: it always leaves a gap to shoot at.
    robotSpeed: Math.min(560 + n * 90, 1150),
    pucks: n >= 3 ? 2 : 1,
    bumpers: n >= 4,
    magnet: n >= 5,
    rallyTarget: 12 + n * 4,
  };
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
  });

  stage = document.createElement('div');
  stage.className = 'hoc-stage';
  const canvas = document.createElement('canvas');
  canvas.className = 'hoc-canvas';
  const hint = document.createElement('div');
  hint.className = 'hint-line hoc-hint';
  stage.append(canvas, hint);
  container.appendChild(stage);

  handle = setupCanvas(canvas, { alpha: false });
  const { ctx, toLogical } = handle;
  const stars = createStars(80);

  let cfg = levelConfig(level);
  let coop = false;
  let running = false;
  let t = 0;
  let freeze = 0;
  let rally = 0;
  let bestRally = getItem('hoc-rally', 0);
  const score = [0, 0];
  const particles = [];
  let pucks = [];

  const paddles = [
    { x: RINK.x0 + 260, y: MID_Y, tx: RINK.x0 + 260, ty: MID_Y, vx: 0, vy: 0, side: 'left', color: P1_COLOR },
    { x: RINK.x1 - 260, y: MID_Y, tx: RINK.x1 - 260, ty: MID_Y, vx: 0, vy: 0, side: 'right', color: players > 1 ? P2_COLOR : ROBOT_COLOR },
  ];
  const robot = players === 1 ? paddles[1] : null;

  const bumpers = [
    { x: MID_X, y: RINK.y0 + 190, r: 56, flash: 0 },
    { x: MID_X, y: RINK.y1 - 190, r: 56, flash: 0 },
  ];

  function resetPuck(towards = Math.random() < 0.5 ? -1 : 1, index = 0) {
    const spread = cfg.pucks > 1 ? (index === 0 ? -140 : 140) : 0;
    return {
      x: MID_X,
      y: MID_Y + spread,
      vx: towards * cfg.puckSpeed * 0.55,
      vy: (Math.random() - 0.5) * cfg.puckSpeed * 0.4,
      spin: 0,
    };
  }

  function faceOff(towards) {
    pucks = Array.from({ length: cfg.pucks }, (_, i) => resetPuck(towards, i));
    freeze = 0.9;
  }

  function startMatch(isCoop) {
    coop = isCoop;
    cfg = levelConfig(level);
    hud.setLevel(level);
    score[0] = 0;
    score[1] = 0;
    rally = 0;
    running = true;
    faceOff();
    hint.textContent = coop
      ? `Samen: houd de maan in de lucht — haal ${cfg.rallyTarget} keer`
      : players > 1
        ? `Sleep je vanger — eerste bij ${GOALS_TO_WIN} punten wint`
        : `Sleep je vanger — versla de robot met ${GOALS_TO_WIN} punten`;
    sfx.launch();
  }

  // --- input: a pointer belongs to whichever half it started in, so two
  // children can hold the glass at the same time without stealing each other's
  // paddle. Alone, the right half is the robot's and simply ignores touches.
  const owners = new Map();
  const paddleFor = (clientX) => {
    const rect = canvas.getBoundingClientRect();
    const left = (clientX - rect.left) / rect.width < 0.5;
    if (left) return paddles[0];
    return players > 1 ? paddles[1] : null;
  };
  const aim = (p, clientX, clientY) => {
    const { x, y } = toLogical(clientX, clientY);
    const minX = p.side === 'left' ? RINK.x0 + PADDLE_R : MID_X + PADDLE_R * 0.15;
    const maxX = p.side === 'left' ? MID_X - PADDLE_R * 0.15 : RINK.x1 - PADDLE_R;
    p.tx = Math.max(minX, Math.min(maxX, x));
    p.ty = Math.max(RINK.y0 + PADDLE_R, Math.min(RINK.y1 - PADDLE_R, y));
  };

  const onDown = (e) => {
    const p = paddleFor(e.clientX);
    if (!p) return;
    owners.set(e.pointerId, p);
    aim(p, e.clientX, e.clientY);
  };
  const onMove = (e) => {
    const p = owners.get(e.pointerId);
    if (p) aim(p, e.clientX, e.clientY);
  };
  const onUp = (e) => owners.delete(e.pointerId);

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);

  function movePaddle(p, dt) {
    const dx = p.tx - p.x;
    const dy = p.ty - p.y;
    const dist = Math.hypot(dx, dy);
    // The paddle chases the finger at a top speed rather than teleporting to
    // it: a paddle that jumps can pass straight through the puck, and its
    // velocity is also what gives a hit its power.
    const step = Math.min(dist, PADDLE_SPEED * dt);
    const nx = dist > 0.001 ? dx / dist : 0;
    const ny = dist > 0.001 ? dy / dist : 0;
    const px = p.x;
    const py = p.y;
    p.x += nx * step;
    p.y += ny * step;
    p.vx = (p.x - px) / Math.max(dt, 0.0001);
    p.vy = (p.y - py) / Math.max(dt, 0.0001);
  }

  function driveRobot(dt) {
    // Track the puck that is actually coming this way; when none is, drift
    // back towards the goal line instead of hugging the last one.
    const incoming = pucks.filter((p) => p.vx > 0).sort((a, b) => b.x - a.x)[0];
    const puck = incoming || pucks[0];
    if (!puck) return;
    const wantsX = incoming
      ? Math.max(MID_X + 200, Math.min(RINK.x1 - 220, puck.x + 130))
      : RINK.x1 - 300;
    const wantsY = incoming ? puck.y : MID_Y;
    const dx = wantsX - robot.x;
    const dy = wantsY - robot.y;
    const dist = Math.hypot(dx, dy);
    const step = Math.min(dist, cfg.robotSpeed * dt);
    const px = robot.x;
    const py = robot.y;
    if (dist > 1) {
      robot.x += (dx / dist) * step;
      robot.y += (dy / dist) * step;
    }
    robot.x = Math.max(MID_X + PADDLE_R, Math.min(RINK.x1 - PADDLE_R, robot.x));
    robot.y = Math.max(RINK.y0 + PADDLE_R, Math.min(RINK.y1 - PADDLE_R, robot.y));
    robot.vx = (robot.x - px) / Math.max(dt, 0.0001);
    robot.vy = (robot.y - py) / Math.max(dt, 0.0001);
    robot.tx = robot.x;
    robot.ty = robot.y;
  }

  function clampSpeed(puck) {
    const s = Math.hypot(puck.vx, puck.vy);
    if (s > cfg.maxSpeed) {
      puck.vx = (puck.vx / s) * cfg.maxSpeed;
      puck.vy = (puck.vy / s) * cfg.maxSpeed;
    }
    // A moon that has nearly stopped in open ice is boring to wait for.
    if (s < 90) {
      const a = Math.atan2(puck.vy || 0.4, puck.vx || 1);
      puck.vx = Math.cos(a) * 90;
      puck.vy = Math.sin(a) * 90;
    }
  }

  function hitPaddle(puck, p) {
    const dx = puck.x - p.x;
    const dy = puck.y - p.y;
    const d = Math.hypot(dx, dy) || 0.001;
    if (d >= PADDLE_R + PUCK_R) return false;

    const nx = dx / d;
    const ny = dy / d;
    puck.x = p.x + nx * (PADDLE_R + PUCK_R + 1);
    puck.y = p.y + ny * (PADDLE_R + PUCK_R + 1);

    const rvn = (puck.vx - p.vx) * nx + (puck.vy - p.vy) * ny;
    if (rvn < 0) {
      puck.vx -= 2 * rvn * nx;
      puck.vy -= 2 * rvn * ny;
    }
    // Some of the paddle's own motion goes into the moon, so a child who
    // swings gets a hard shot and a child who just blocks gets a soft one.
    puck.vx += p.vx * 0.5;
    puck.vy += p.vy * 0.5;
    clampSpeed(puck);

    sfx.impact();
    particles.push(...createBurst(puck.x, puck.y, [p.color, '#ffffff'], { count: 7, speed: 200 }));
    if (coop) {
      rally += 1;
      if (rally >= cfg.rallyTarget) finishMatch();
      else if (rally % 5 === 0) sfx.powerup();
    }
    return true;
  }

  function goal(scorer) {
    score[scorer] += 1;
    sfx.explode();
    particles.push(...createBurst(
      scorer === 0 ? RINK.x0 + 60 : RINK.x1 - 60, MID_Y,
      [paddles[scorer].color, '#ffffff', '#ffc24a'], { count: 26, speed: 420 }
    ));
    if (score[scorer] >= GOALS_TO_WIN) {
      finishMatch();
      return;
    }
    sfx.levelUp();
    faceOff(scorer === 0 ? -1 : 1);
  }

  function update(dt) {
    t += dt;
    movePaddle(paddles[0], dt);
    if (robot) driveRobot(dt);
    else movePaddle(paddles[1], dt);

    if (!running) return;
    if (freeze > 0) {
      freeze -= dt;
      return;
    }

    for (const puck of pucks) {
      if (cfg.magnet) {
        // A soft pull towards the centre spot: it bends a long shot just
        // enough that neither child can rely on a straight line.
        const dx = MID_X - puck.x;
        const dy = MID_Y - puck.y;
        const d = Math.hypot(dx, dy);
        if (d > 1 && d < 420) {
          const pull = 900 * (1 - d / 420);
          puck.vx += (dx / d) * pull * dt;
          puck.vy += (dy / d) * pull * dt;
        }
      }

      puck.x += puck.vx * dt;
      puck.y += puck.vy * dt;
      puck.spin += (puck.vx / 240) * dt;
      // Ice friction, framerate-independent.
      const drag = Math.pow(0.86, dt * 6);
      puck.vx *= drag;
      puck.vy *= drag;

      if (puck.y < RINK.y0 + PUCK_R) { puck.y = RINK.y0 + PUCK_R; puck.vy = Math.abs(puck.vy); sfx.bounce(); }
      if (puck.y > RINK.y1 - PUCK_R) { puck.y = RINK.y1 - PUCK_R; puck.vy = -Math.abs(puck.vy); sfx.bounce(); }

      const inMouth = !coop && Math.abs(puck.y - MID_Y) < GOAL_HALF;
      if (puck.x < RINK.x0 + PUCK_R) {
        if (inMouth) { goal(1); break; }
        puck.x = RINK.x0 + PUCK_R;
        puck.vx = Math.abs(puck.vx);
        sfx.bounce();
      }
      if (puck.x > RINK.x1 - PUCK_R) {
        if (inMouth) { goal(0); break; }
        puck.x = RINK.x1 - PUCK_R;
        puck.vx = -Math.abs(puck.vx);
        sfx.bounce();
      }

      if (cfg.bumpers) {
        for (const b of bumpers) {
          const dx = puck.x - b.x;
          const dy = puck.y - b.y;
          const d = Math.hypot(dx, dy) || 0.001;
          if (d < b.r + PUCK_R) {
            const nx = dx / d;
            const ny = dy / d;
            puck.x = b.x + nx * (b.r + PUCK_R + 1);
            puck.y = b.y + ny * (b.r + PUCK_R + 1);
            const vn = puck.vx * nx + puck.vy * ny;
            // Slightly springy: a bumper hands back a bit more than it got.
            puck.vx -= 2.1 * vn * nx;
            puck.vy -= 2.1 * vn * ny;
            clampSpeed(puck);
            b.flash = 0.35;
            sfx.blip();
            particles.push(...createBurst(puck.x, puck.y, ['#ffc24a', '#ffffff'], { count: 8, speed: 240 }));
          }
        }
      }

      for (const p of paddles) hitPaddle(puck, p);
      clampSpeed(puck);
    }

    for (const b of bumpers) if (b.flash > 0) b.flash -= dt;
  }

  function finishMatch() {
    if (!running) return;
    running = false;
    sfx.missionComplete();

    const cleared = level;
    level += 1;
    setLevel(slug, level);

    let title;
    let icon = mission.icon;
    if (coop) {
      title = `Samen ${rally} keer geraakt! 🌙`;
      if (rally > bestRally) {
        bestRally = rally;
        setItem('hoc-rally', rally);
      }
    } else if (players > 1) {
      title = `Astronaut ${score[0] > score[1] ? 1 : 2} wint! 🏆`;
      icon = '🏆';
    } else if (score[0] > score[1]) {
      title = 'Je wint van de robot! 🏆';
      icon = '🏆';
    } else {
      // Losing to the robot is still a finished match and still a level up:
      // the ladder in this bundle measures how far you got, never how well.
      title = 'De robot wint deze keer 🤖';
      icon = '🤖';
    }

    reward = showMissionComplete(stage, {
      icon,
      color: mission.color,
      mission: mission.title,
      level: cleared,
      stars: starsForLevel(level),
      title,
      onNext: () => { reward = null; startMatch(coop); },
      onRetry: () => { reward = null; level = cleared; startMatch(coop); },
      onHome: onExit,
    });
  }

  // --- drawing ------------------------------------------------------------

  function drawRink() {
    ctx.save();
    ctx.strokeStyle = 'rgba(232,217,176,0.22)';
    ctx.lineWidth = 3;
    roundRect(ctx, RINK.x0, RINK.y0, RINK.x1 - RINK.x0, RINK.y1 - RINK.y0, 46);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(MID_X, RINK.y0);
    ctx.lineTo(MID_X, RINK.y1);
    ctx.setLineDash([18, 22]);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.beginPath();
    ctx.arc(MID_X, MID_Y, 150, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    if (coop) return;

    // Goal mouths: a bar of the defender's colour, so a child can see at a
    // glance which end is theirs from anywhere in the room.
    for (const [x, color] of [[RINK.x0, P1_COLOR], [RINK.x1, paddles[1].color]]) {
      drawGlow(ctx, color, x, MID_Y, GOAL_HALF * 1.5, 0.5);
      ctx.fillStyle = withAlpha(color, 0.8);
      const w = 12;
      ctx.fillRect(x === RINK.x0 ? x : x - w, MID_Y - GOAL_HALF, w, GOAL_HALF * 2);
    }
  }

  function drawScore() {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (coop) {
      // Up at the top rather than in the centre circle: the moon spends most
      // of its life crossing the middle, and a counter under it is a counter
      // nobody can read.
      ctx.font = 'bold 130px "Baloo 2", sans-serif';
      ctx.fillStyle = 'rgba(243,236,224,0.26)';
      ctx.fillText(`${rally}`, MID_X, RINK.y0 + 92);
      ctx.font = 'bold 30px "Space Mono", monospace';
      ctx.fillStyle = 'rgba(154,146,128,0.7)';
      ctx.fillText(`VAN ${cfg.rallyTarget}${bestRally ? ` · BESTE ${bestRally}` : ''}`, MID_X, RINK.y0 + 178);
    } else {
      ctx.font = 'bold 118px "Baloo 2", sans-serif';
      ctx.fillStyle = withAlpha(P1_COLOR, 0.5);
      ctx.fillText(`${score[0]}`, MID_X - 190, RINK.y0 + 100);
      ctx.fillStyle = withAlpha(paddles[1].color, 0.5);
      ctx.fillText(`${score[1]}`, MID_X + 190, RINK.y0 + 100);
    }
    ctx.restore();
  }

  function drawPaddle(p) {
    drawGlow(ctx, p.color, p.x, p.y, PADDLE_R * 1.6, 0.85);
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, PADDLE_R, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(5,7,15,0.55)';
    ctx.beginPath();
    ctx.arc(p.x, p.y, PADDLE_R * 0.58, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.beginPath();
    ctx.arc(p.x - PADDLE_R * 0.3, p.y - PADDLE_R * 0.34, PADDLE_R * 0.18, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawPuck(puck) {
    drawGlow(ctx, '#ffffff', puck.x, puck.y, PUCK_R * 2.4, 0.7);
    ctx.fillStyle = '#f3ece0';
    ctx.beginPath();
    ctx.arc(puck.x, puck.y, PUCK_R, 0, Math.PI * 2);
    ctx.fill();
    // Craters ride along with the spin. Each gets its own path — chained arcs
    // get joined by a line and the moon grows spikes.
    ctx.fillStyle = 'rgba(120,112,96,0.45)';
    for (const [a, dist, r] of [[0, 0.42, 0.22], [2.1, 0.5, 0.15], [4.2, 0.3, 0.12]]) {
      ctx.beginPath();
      ctx.arc(
        puck.x + Math.cos(a + puck.spin) * PUCK_R * dist,
        puck.y + Math.sin(a + puck.spin) * PUCK_R * dist,
        PUCK_R * r, 0, Math.PI * 2
      );
      ctx.fill();
    }
  }

  function draw(dt) {
    drawSpaceBackdrop(ctx, stars, t, { scrollSpeed: 4 });
    drawRink();
    drawScore();

    if (cfg.bumpers) {
      for (const b of bumpers) {
        const lit = b.flash > 0;
        drawGlow(ctx, '#ffc24a', b.x, b.y, b.r * (lit ? 2.4 : 1.7), lit ? 0.9 : 0.45);
        ctx.fillStyle = lit ? '#ffd479' : '#d08c4a';
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    if (cfg.magnet) {
      ctx.save();
      ctx.strokeStyle = 'rgba(185,140,255,0.28)';
      ctx.lineWidth = 3;
      for (let i = 0; i < 3; i++) {
        const r = 60 + i * 46 + Math.sin(t * 1.6 + i) * 10;
        ctx.beginPath();
        ctx.arc(MID_X, MID_Y, r, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }

    for (const p of paddles) drawPaddle(p);
    for (const puck of pucks) drawPuck(puck);
    updateAndDrawParticles(ctx, particles, dt, { gravity: 0 });
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

  // --- mode gate (2 players only) ----------------------------------------
  // Alone there is nothing to choose: the robot is the opponent. Together the
  // choice matters enough to be worth a screen, because "against each other"
  // and "keep it in the air" are two different afternoons.
  if (players > 1) {
    const picker = document.createElement('div');
    picker.className = 'hoc-mode';
    const lastMode = getItem('hoc-mode', 'duel');
    picker.innerHTML = `
      <div class="hoc-mode__panel">
        <div class="hoc-mode__title">Hoe spelen jullie?</div>
        <div class="hoc-mode__row">
          <button class="hoc-mode__btn${lastMode === 'duel' ? ' is-last' : ''}" data-mode="duel">
            <span class="hoc-mode__icon">🥅</span>
            <span class="hoc-mode__label">Tegen elkaar</span>
            <span class="hoc-mode__sub">Eerste bij ${GOALS_TO_WIN} punten</span>
          </button>
          <button class="hoc-mode__btn${lastMode === 'coop' ? ' is-last' : ''}" data-mode="coop">
            <span class="hoc-mode__icon">🤝</span>
            <span class="hoc-mode__label">Samen</span>
            <span class="hoc-mode__sub">Houd de maan in de lucht</span>
          </button>
        </div>
      </div>
    `;
    stage.appendChild(picker);
    const onPick = (e) => {
      const btn = e.target.closest('.hoc-mode__btn');
      if (!btn) return;
      setItem('hoc-mode', btn.dataset.mode);
      picker.remove();
      startMatch(btn.dataset.mode === 'coop');
    };
    picker.addEventListener('pointerup', onPick);
    listeners.push(() => picker.removeEventListener('pointerup', onPick));
  } else {
    startMatch(false);
  }

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
