import './style.css';
import { createHud } from '../../shared/ui-components.js';
import {
  setupCanvas, LOGICAL_WIDTH, LOGICAL_HEIGHT, ObjectPool,
  createStars, drawSpaceBackdrop, createBurst, updateAndDrawParticles, roundRect,
} from '../../shared/canvas-utils.js';
import { sfx } from '../../shell/audio.js';
import { setLevel } from '../../shell/progress.js';

// "Ruimte Invasie" — a deliberately failure-free take on Space Invaders.
//
// Aliens never shoot and there are no lives: if the swarm reaches the bottom
// it simply retreats to the top again. A 2-7 year old gets the arcade feel
// without ever being told they lost.
//
// Depth: three alien types (drifter / zigzagger / armoured), a boss every
// fifth wave, and catchable power-ups that change how the ship fires.

const SHIP_W = 130;
const SHIP_H = 74;
// One source of truth for the ship line — the draw, fire and power-up pickup
// code all key off it, and they must agree or bullets appear detached.
const SHIP_Y = LOGICAL_HEIGHT - 160;
const BULLET_SPEED = 1000;
const SWARM_TOP = 190;
const SWARM_RESET_Y = 560;
const COL_SPACING = 172;
const ROW_SPACING = 116;

const TYPES = {
  drifter: { w: 92, hp: 1, color: '#2fd9c6', score: 1 },
  zigzag: { w: 92, hp: 1, color: '#b06bff', score: 2 },
  armored: { w: 108, hp: 2, color: '#ff8a3d', score: 3 },
  boss: { w: 260, hp: 14, color: '#ff5f4d', score: 20 },
};

const POWERS = ['spread', 'rapid'];
const BURST_COLORS = ['#ffb224', '#ff5f4d', '#2fd9c6', '#ffffff'];

let hud = null;
let handle = null;
let raf = null;
let listeners = [];
let slug = 'ruimte-invasie';

export function init(container, opts) {
  slug = opts.slug;
  listeners = [];

  const players = opts.players || 1;
  let wave = Math.max(1, opts.startLevel || 1);

  hud = createHud(container, {
    title: opts.title,
    onExit: opts.onExit,
    level: wave,
    players,
    showScore: true,
  });

  const stage = document.createElement('div');
  stage.className = 'inv-stage';
  const canvas = document.createElement('canvas');
  canvas.className = 'inv-canvas';
  stage.appendChild(canvas);
  if (players === 2) {
    const split = document.createElement('div');
    split.className = 'inv-split';
    stage.appendChild(split);
  }
  container.appendChild(stage);

  handle = setupCanvas(canvas, { alpha: false });
  const { ctx, toLogical } = handle;
  const stars = createStars(150);

  const half = LOGICAL_WIDTH / 2;
  const ships = players === 2
    ? [
        { x: half * 0.5, minX: 0, maxX: half, color: '#ff5f4d', cooldown: 0, score: 0, power: null, powerT: 0 },
        { x: half * 1.5, minX: half, maxX: LOGICAL_WIDTH, color: '#2fd9c6', cooldown: 0, score: 0, power: null, powerT: 0 },
      ]
    : [{ x: half, minX: 0, maxX: LOGICAL_WIDTH, color: '#ffb224', cooldown: 0, score: 0, power: null, powerT: 0 }];

  const bulletPool = new ObjectPool(
    () => ({ x: 0, y: 0, vx: 0, owner: 0 }),
    (b, x, y, vx, owner) => { b.x = x; b.y = y; b.vx = vx; b.owner = owner; }
  );
  const bullets = [];
  const particles = [];
  const powerups = [];

  let aliens = [];
  let swarmX = 0;
  let swarmY = 0;
  let swarmDir = 1;
  let swarmSpeed = 90;
  let t = 0;
  let clearing = false;

  function spawnWave() {
    aliens = [];
    clearing = false;
    hud.setLevel(wave);

    if (wave % 5 === 0) {
      // Boss wave
      aliens.push({
        ox: 0, oy: 0, type: 'boss', hp: TYPES.boss.hp + Math.floor(wave / 5) * 4, alive: true, phase: 0,
      });
      swarmSpeed = 150;
    } else {
      const cols = Math.min(6 + Math.floor(wave / 2), 10);
      const rows = Math.min(2 + Math.floor(wave / 3), 4);
      const gridW = cols * COL_SPACING;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          // Sturdier types sit on the upper rows so early hits feel easy.
          let type = 'drifter';
          if (wave >= 3 && r === 0 && wave % 2 === 0) type = 'armored';
          else if (wave >= 2 && r % 2 === 1) type = 'zigzag';
          aliens.push({
            ox: c * COL_SPACING - gridW / 2 + COL_SPACING / 2,
            oy: r * ROW_SPACING,
            type,
            hp: TYPES[type].hp,
            alive: true,
            phase: Math.random() * Math.PI * 2,
          });
        }
      }
      swarmSpeed = Math.min(90 + wave * 14, 260);
    }
    swarmX = 0;
    swarmY = 0;
    swarmDir = 1;
  }
  spawnWave();

  const alienPos = (a) => {
    const isBoss = a.type === 'boss';
    const x = LOGICAL_WIDTH / 2 + swarmX + a.ox
      + (a.type === 'zigzag' ? Math.sin(t * 1.8 + a.phase) * 46 : 0);
    const y = SWARM_TOP + swarmY + a.oy
      + (isBoss ? Math.sin(t * 1.1) * 26 : Math.sin(t * 2 + a.phase) * 7);
    return { x, y };
  };

  // --- input: each pointer steers the ship whose half it lands in ---
  const owners = new Map();
  const shipFor = (x) => ships.find((s) => x >= s.minX && x <= s.maxX) || ships[0];

  const clampShip = (s, x) =>
    Math.max(s.minX + SHIP_W / 2, Math.min(s.maxX - SHIP_W / 2, x));

  const onDown = (e) => {
    const { x } = toLogical(e.clientX, e.clientY);
    const s = shipFor(x);
    owners.set(e.pointerId, s);
    s.x = clampShip(s, x);
  };
  const onMove = (e) => {
    const s = owners.get(e.pointerId);
    if (!s) return;
    const { x } = toLogical(e.clientX, e.clientY);
    s.x = clampShip(s, x);
  };
  const onUp = (e) => owners.delete(e.pointerId);

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);

  function fire(ship, idx) {
    const y = SHIP_Y - SHIP_H / 2;
    if (ship.power === 'spread') {
      bullets.push(bulletPool.acquire(ship.x, y, -260, idx));
      bullets.push(bulletPool.acquire(ship.x, y, 0, idx));
      bullets.push(bulletPool.acquire(ship.x, y, 260, idx));
    } else {
      bullets.push(bulletPool.acquire(ship.x, y, 0, idx));
    }
    sfx.laser();
  }

  function hitAlien(a, ship, shipIdx) {
    const pos = alienPos(a);
    a.hp -= 1;
    if (a.hp > 0) {
      sfx.impact();
      particles.push(...createBurst(pos.x, pos.y, [TYPES[a.type].color], { count: 8, speed: 200 }));
      return;
    }
    a.alive = false;
    ship.score += TYPES[a.type].score;
    hud.setScore(shipIdx, ship.score);
    particles.push(...createBurst(pos.x, pos.y, BURST_COLORS, { count: a.type === 'boss' ? 60 : 20, speed: a.type === 'boss' ? 520 : 320 }));
    sfx.explode();

    // Tougher aliens sometimes drop a power-up.
    if ((a.type === 'armored' || a.type === 'boss') && Math.random() < 0.6) {
      powerups.push({
        x: pos.x, y: pos.y,
        kind: POWERS[Math.floor(Math.random() * POWERS.length)],
        spin: 0,
      });
    }
  }

  function update(dt) {
    t += dt;

    // Swarm drifts sideways, steps down at the edges, and loops back to the
    // top instead of ever ending the game.
    const living = aliens.filter((a) => a.alive);
    if (living.length) {
      const xs = living.map((a) => a.ox);
      const leftEdge = LOGICAL_WIDTH / 2 + swarmX + Math.min(...xs) - 70;
      const rightEdge = LOGICAL_WIDTH / 2 + swarmX + Math.max(...xs) + 70;
      swarmX += swarmDir * swarmSpeed * dt;
      if (leftEdge < 40 && swarmDir < 0) { swarmDir = 1; swarmY += 34; }
      else if (rightEdge > LOGICAL_WIDTH - 40 && swarmDir > 0) { swarmDir = -1; swarmY += 34; }
      if (swarmY > SWARM_RESET_Y) swarmY = 0;
    }

    ships.forEach((ship, idx) => {
      if (ship.power && t > ship.powerT) ship.power = null;
      ship.cooldown -= dt;
      if (ship.cooldown <= 0) {
        ship.cooldown = ship.power === 'rapid' ? 0.16 : 0.38;
        fire(ship, idx);
      }
    });

    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i];
      b.y -= BULLET_SPEED * dt;
      b.x += b.vx * dt;
      if (b.y < -20 || b.x < 0 || b.x > LOGICAL_WIDTH) {
        bullets.splice(i, 1);
        bulletPool.release(b);
        continue;
      }
      let consumed = false;
      for (const a of aliens) {
        if (!a.alive) continue;
        const spec = TYPES[a.type];
        const pos = alienPos(a);
        const hw = spec.w / 2;
        const hh = (a.type === 'boss' ? 150 : 74) / 2;
        if (Math.abs(b.x - pos.x) < hw && Math.abs(b.y - pos.y) < hh) {
          hitAlien(a, ships[b.owner], b.owner);
          consumed = true;
          break;
        }
      }
      if (consumed) {
        bullets.splice(i, 1);
        bulletPool.release(b);
      }
    }

    // Power-ups fall; catching one arms that ship for 9 seconds.
    for (let i = powerups.length - 1; i >= 0; i--) {
      const p = powerups[i];
      p.y += 240 * dt;
      p.spin += dt * 3;
      if (p.y > LOGICAL_HEIGHT + 40) {
        powerups.splice(i, 1);
        continue;
      }
      for (const ship of ships) {
        if (Math.abs(p.x - ship.x) < SHIP_W / 2 + 40 && Math.abs(p.y - SHIP_Y) < 80) {
          ship.power = p.kind;
          ship.powerT = t + 9;
          powerups.splice(i, 1);
          sfx.powerup();
          hud.banner(p.kind === 'spread' ? 'Drievoudig schot!' : 'Sneller vuren!', { ms: 1100, hint: true });
          break;
        }
      }
    }

    if (!clearing && aliens.length && aliens.every((a) => !a.alive)) {
      clearing = true;
      wave += 1;
      setLevel(slug, wave);
      sfx.missionComplete();
      hud.banner(`Golf ${wave - 1} verslagen!`, { sub: `Golf ${wave} komt aan`, ms: 1600 });
      setTimeout(spawnWave, 1700);
    }
  }

  function drawAlien(a) {
    const spec = TYPES[a.type];
    const { x, y } = alienPos(a);
    const isBoss = a.type === 'boss';
    const w = spec.w;
    const h = isBoss ? 150 : 74;

    ctx.save();
    ctx.shadowColor = spec.color;
    ctx.shadowBlur = isBoss ? 42 : 20;
    ctx.fillStyle = spec.color;
    roundRect(ctx, x - w / 2, y - h / 2, w, h, isBoss ? 44 : 22);
    ctx.fill();
    ctx.restore();

    // Armour plating hint: a second hp shows as a lighter inner shell.
    if (a.hp > 1 && !isBoss) {
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      roundRect(ctx, x - w / 2 + 12, y - h / 2 + 10, w - 24, 14, 7);
      ctx.fill();
    }

    // Each eye gets its own path: chaining arcs would draw a connecting line
    // between them.
    const eyeR = isBoss ? 22 : 11;
    const eyeDX = isBoss ? 54 : 22;
    const eyeY = y - (isBoss ? 16 : 6);
    for (const sign of [-1, 1]) {
      ctx.fillStyle = '#0b1138';
      ctx.beginPath();
      ctx.arc(x + sign * eyeDX, eyeY, eyeR, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(x + sign * eyeDX + 3, eyeY - 2, eyeR * 0.4, 0, Math.PI * 2);
      ctx.fill();
    }

    if (isBoss) {
      // Boss health bar so the fight has a readable arc.
      const frac = a.hp / (TYPES.boss.hp + Math.floor(wave / 5) * 4);
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      roundRect(ctx, x - 130, y + h / 2 + 16, 260, 18, 9);
      ctx.fill();
      ctx.fillStyle = '#6ee87a';
      roundRect(ctx, x - 130, y + h / 2 + 16, 260 * Math.max(frac, 0), 18, 9);
      ctx.fill();
    }
  }

  function drawShip(ship) {
    const y = SHIP_Y;

    // Thruster flame flickers with time so the ship never looks static.
    const flame = 26 + Math.sin(t * 22) * 10;
    ctx.fillStyle = '#ffb224';
    ctx.beginPath();
    ctx.moveTo(ship.x - 16, y + SHIP_H / 2);
    ctx.lineTo(ship.x + 16, y + SHIP_H / 2);
    ctx.lineTo(ship.x, y + SHIP_H / 2 + flame);
    ctx.closePath();
    ctx.fill();

    ctx.save();
    ctx.shadowColor = ship.color;
    ctx.shadowBlur = ship.power ? 34 : 16;
    ctx.fillStyle = ship.color;
    ctx.beginPath();
    ctx.moveTo(ship.x, y - SHIP_H / 2);
    ctx.lineTo(ship.x - SHIP_W / 2, y + SHIP_H / 2);
    ctx.lineTo(ship.x + SHIP_W / 2, y + SHIP_H / 2);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    ctx.fillStyle = '#e9f4ff';
    ctx.beginPath();
    ctx.arc(ship.x, y + 6, 17, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawPowerup(p) {
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.spin);
    ctx.shadowColor = '#ffb224';
    ctx.shadowBlur = 26;
    ctx.fillStyle = '#ffb224';
    roundRect(ctx, -26, -26, 52, 52, 14);
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = '#121634';
    ctx.font = 'bold 34px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(p.kind === 'spread' ? 'W' : '»', p.x, p.y);
  }

  function draw(dt) {
    drawSpaceBackdrop(ctx, stars, t, { scrollSpeed: 16 });

    for (const a of aliens) if (a.alive) drawAlien(a);

    ctx.save();
    ctx.shadowColor = '#ffe66d';
    ctx.shadowBlur = 16;
    ctx.fillStyle = '#ffe66d';
    for (const b of bullets) {
      ctx.beginPath();
      ctx.arc(b.x, b.y, 9, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    powerups.forEach(drawPowerup);
    ships.forEach(drawShip);
    updateAndDrawParticles(ctx, particles, dt, { gravity: 180 });
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
