import './style.css';
import { createHud } from '../../shared/ui-components.js';
import {
  setupCanvas, LOGICAL_WIDTH, LOGICAL_HEIGHT, ObjectPool,
  createStars, drawSpaceBackdrop, createBurst, updateAndDrawParticles, roundRect,
} from '../../shared/canvas-utils.js';
import { sfx } from '../../shell/audio.js';
import { setLevel } from '../../shell/progress.js';
import { getItem, setItem } from '../../shell/storage.js';

// "Ruimte Invasie" — Space Invaders that a five-year-old can win.
//
// Nobody ever loses: the swarm turns back at a line well above the ships, and
// even on the hardest setting a destroyed ship is repaired a couple of seconds
// later. What changes with difficulty is how much the aliens fight back.
//
// Depth comes from variety rather than punishment: five alien species with
// their own silhouettes and behaviour, a rotating cast of three bosses with
// distinct attacks, a mystery saucer that pays out, and three power-ups.

const SHIP_W = 130;
const SHIP_H = 74;
// One source of truth for the ship line — the draw, fire and pickup code all
// key off it, and they must agree or bullets appear detached.
const SHIP_Y = LOGICAL_HEIGHT - 160;
// The swarm turns back here. Kept a full ship's height above the ships so the
// aliens can never end up level with (or under) the guns, where they would be
// unshootable.
const DANGER_Y = SHIP_Y - 210;
const BULLET_SPEED = 1000;
const SWARM_TOP = 190;
const COL_SPACING = 172;
const ROW_SPACING = 116;

const DIFFICULTIES = [
  {
    id: 'makkelijk', label: 'Makkelijk', icon: '😊', sub: 'De aliens schieten niet',
    swarm: 0.7, fireRate: 0, cooldown: 0.32, step: 26, hp: 0,
  },
  {
    id: 'gewoon', label: 'Gewoon', icon: '🙂', sub: 'Pas op voor alienlasers',
    swarm: 1, fireRate: 0.55, cooldown: 0.38, step: 34, hp: 0,
  },
  {
    id: 'moeilijk', label: 'Moeilijk', icon: '😤', sub: 'Jij hebt schilden — raak ze niet kwijt',
    swarm: 1.35, fireRate: 1.25, cooldown: 0.42, step: 42, hp: 5,
  },
];

// Every species carries its own silhouette. Children pick favourites almost
// immediately, and a wave of five shapes reads as a crowd instead of a grid.
const TYPES = {
  drifter: { w: 92, h: 74, hp: 1, color: '#2fd9c6', score: 1, art: 'squid' },
  zigzag: { w: 104, h: 66, hp: 1, color: '#b06bff', score: 2, art: 'saucer' },
  armored: { w: 110, h: 82, hp: 3, color: '#ff8a3d', score: 3, art: 'beetle' },
  splitter: { w: 96, h: 86, hp: 1, color: '#6ee87a', score: 2, art: 'blob', splits: 2 },
  mini: { w: 54, h: 50, hp: 1, color: '#a9ffd0', score: 1, art: 'blob' },
};

const BOSSES = [
  {
    id: 'kwal', name: 'Kwalmonster', w: 300, h: 180, hp: 18, color: '#b06bff',
    score: 20, art: 'jelly', attack: 'spread', every: 2.1,
  },
  {
    id: 'krab', name: 'Sterrenkrab', w: 330, h: 150, hp: 24, color: '#ff8a3d',
    score: 26, art: 'crab', attack: 'aimed', every: 1.7, minions: 3.4,
  },
  {
    id: 'oog', name: 'Het Grote Oog', w: 250, h: 250, hp: 22, color: '#ff5f4d',
    score: 30, art: 'eye', attack: 'burst', every: 3.0, blink: 4.5,
  },
];

const POWERS = ['spread', 'rapid', 'shield'];
const POWER_LABEL = {
  spread: 'Drievoudig schot!',
  rapid: 'Sneller vuren!',
  shield: 'Schild aan!',
};
const BURST_COLORS = ['#ffb224', '#ff5f4d', '#2fd9c6', '#ffffff'];

let hud = null;
let handle = null;
let raf = null;
let listeners = [];
let timers = [];
let slug = 'ruimte-invasie';

const rnd = (a, b) => a + Math.random() * (b - a);

export function init(container, opts) {
  slug = opts.slug;
  listeners = [];
  timers = [];

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
  const mkShip = (x, minX, maxX, color) => ({
    x, minX, maxX, color, cooldown: 0, score: 0,
    power: null, powerT: 0, shield: 0, hp: 0, maxHp: 0, hurt: 0, repair: 0,
  });
  const ships = players === 2
    ? [
        mkShip(half * 0.5, 0, half, '#ff5f4d'),
        mkShip(half * 1.5, half, LOGICAL_WIDTH, '#2fd9c6'),
      ]
    : [mkShip(half, 0, LOGICAL_WIDTH, '#ffb224')];

  const bulletPool = new ObjectPool(
    () => ({ x: 0, y: 0, vx: 0, owner: 0 }),
    (b, x, y, vx, owner) => { b.x = x; b.y = y; b.vx = vx; b.owner = owner; }
  );
  const bullets = [];
  const foeShots = [];
  const particles = [];
  const powerups = [];

  let diff = null;
  let aliens = [];
  let mystery = null;
  let mysteryIn = rnd(14, 22);
  let swarmX = 0;
  let swarmY = 0;
  let swarmDir = 1;
  let swarmSpeed = 90;
  let foeShotIn = 2.5;
  let t = 0;
  let clearing = false;

  // --- waves --------------------------------------------------------------

  function spawnWave() {
    aliens = [];
    clearing = false;
    hud.setLevel(wave);

    if (wave % 5 === 0) {
      const boss = BOSSES[(Math.floor(wave / 5) - 1) % BOSSES.length];
      aliens.push({
        ox: 0, oy: 60, type: 'boss', spec: boss, boss,
        hp: boss.hp + Math.floor(wave / 5) * 4,
        maxHp: boss.hp + Math.floor(wave / 5) * 4,
        alive: true, phase: 0, fireIn: boss.every, minionIn: boss.minions || 0,
        blinkIn: boss.blink || 0, blink: 0,
      });
      swarmSpeed = 150 * diff.swarm;
      hud.banner(`${boss.name}! 👾`, { sub: 'Blijf schieten', ms: 1800 });
    } else {
      const cols = Math.min(6 + Math.floor(wave / 2), 10);
      const rows = Math.min(2 + Math.floor(wave / 3), 4);
      const gridW = cols * COL_SPACING;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          // Sturdier species sit on the upper rows so the first hits are easy,
          // and the mix widens as the waves climb.
          let type = 'drifter';
          if (wave >= 3 && r === 0 && wave % 2 === 0) type = 'armored';
          else if (wave >= 4 && (r + c) % 5 === 0) type = 'splitter';
          else if (wave >= 2 && r % 2 === 1) type = 'zigzag';
          addAlien(type, c * COL_SPACING - gridW / 2 + COL_SPACING / 2, r * ROW_SPACING);
        }
      }
      swarmSpeed = Math.min(90 + wave * 14, 260) * diff.swarm;
    }
    swarmX = 0;
    swarmY = 0;
    swarmDir = 1;
    foeShotIn = 2.5;
  }

  function addAlien(type, ox, oy) {
    const spec = TYPES[type];
    const a = {
      ox, oy, type, spec, hp: spec.hp, maxHp: spec.hp,
      alive: true, phase: Math.random() * Math.PI * 2,
    };
    aliens.push(a);
    return a;
  }

  const alienPos = (a) => {
    const wobble = a.type === 'zigzag' ? Math.sin(t * 1.8 + a.phase) * 46 : 0;
    const bob = a.type === 'boss' ? Math.sin(t * 1.1) * 26 : Math.sin(t * 2 + a.phase) * 7;
    return {
      x: LOGICAL_WIDTH / 2 + swarmX + a.ox + wobble + (a.blink || 0),
      y: SWARM_TOP + swarmY + a.oy + bob,
    };
  };

  // --- input --------------------------------------------------------------

  const owners = new Map();
  const shipFor = (x) => ships.find((s) => x >= s.minX && x <= s.maxX) || ships[0];
  const clampShip = (s, x) =>
    Math.max(s.minX + SHIP_W / 2, Math.min(s.maxX - SHIP_W / 2, x));

  const onDown = (e) => {
    if (!diff) return;
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

  // --- shooting -----------------------------------------------------------

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

  function foeShot(x, y, vx, vy, big = false) {
    foeShots.push({ x, y, vx, vy, r: big ? 20 : 13, big });
  }

  function nearestShip(x) {
    let best = ships[0];
    let bd = Infinity;
    for (const s of ships) {
      if (s.repair > 0) continue;
      const d = Math.abs(s.x - x);
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  }

  function hitAlien(a, ship, shipIdx) {
    const pos = alienPos(a);
    a.hp -= 1;
    if (a.hp > 0) {
      sfx.impact();
      particles.push(...createBurst(pos.x, pos.y, [a.spec.color], { count: 8, speed: 200 }));
      return;
    }
    a.alive = false;
    ship.score += a.spec.score;
    hud.setScore(shipIdx, ship.score);
    const boss = a.type === 'boss';
    particles.push(...createBurst(pos.x, pos.y, BURST_COLORS, {
      count: boss ? 60 : 20, speed: boss ? 520 : 320,
    }));
    sfx.explode();

    // A splitter bursts into two smaller ones — killing it makes the wave
    // briefly worse, which children find hilarious.
    if (a.spec.splits) {
      for (let i = 0; i < a.spec.splits; i++) {
        addAlien('mini', a.ox + (i === 0 ? -46 : 46), a.oy + 14);
      }
      sfx.blip();
    }

    if ((a.type === 'armored' || boss) && Math.random() < 0.6) dropPower(pos.x, pos.y);
  }

  function dropPower(x, y) {
    powerups.push({ x, y, kind: POWERS[Math.floor(Math.random() * POWERS.length)], spin: 0 });
  }

  function hurtShip(ship) {
    if (ship.repair > 0) return;
    if (ship.shield > 0) {
      ship.shield -= 1;
      sfx.impact();
      return;
    }
    ship.hurt = 0.4;
    if (ship.maxHp) {
      ship.hp -= 1;
      if (ship.hp <= 0) {
        // Never a game over: the ship is rebuilt and the swarm falls back.
        ship.repair = 2.6;
        ship.power = null;
        particles.push(...createBurst(ship.x, SHIP_Y, BURST_COLORS, { count: 40, speed: 420 }));
        sfx.explode();
        hud.banner('Schip geraakt! 🛠️', { sub: 'We repareren hem', ms: 1800 });
        retreat();
        return;
      }
      sfx.deny();
    } else {
      // Without health bars a hit costs the power-up and a moment of fire.
      ship.power = null;
      ship.cooldown = Math.max(ship.cooldown, 0.9);
      sfx.deny();
    }
  }

  function retreat() {
    swarmY = 0;
    swarmDir = 1;
    foeShots.length = 0;
  }

  // --- update -------------------------------------------------------------

  function update(dt) {
    t += dt;
    if (!diff) return;

    const living = aliens.filter((a) => a.alive);

    if (living.length) {
      // Measure the real silhouette — half-width plus any teleport offset —
      // so a 300px-wide boss turns back before it slides off the screen.
      const base = LOGICAL_WIDTH / 2 + swarmX;
      const leftEdge = Math.min(...living.map((a) => base + a.ox + (a.blink || 0) - a.spec.w / 2));
      const rightEdge = Math.max(...living.map((a) => base + a.ox + (a.blink || 0) + a.spec.w / 2));
      swarmX += swarmDir * swarmSpeed * dt;
      if (leftEdge < 40 && swarmDir < 0) { swarmDir = 1; swarmY += diff.step; }
      else if (rightEdge > LOGICAL_WIDTH - 40 && swarmDir > 0) { swarmDir = -1; swarmY += diff.step; }

      // The retreat line is measured from the lowest living alien, so a tall
      // formation turns back earlier than a shallow one and nothing ever
      // sinks to the ships' altitude.
      const lowest = Math.max(...living.map((a) => a.oy + a.spec.h / 2));
      if (SWARM_TOP + swarmY + lowest > DANGER_Y) {
        retreat();
        sfx.thruster();
        hud.banner('De aliens trekken terug! 🌌', { ms: 1300, hint: true });
      }
    }

    updateBosses(dt, living);
    updateSwarmFire(dt, living);
    updateMystery(dt);

    ships.forEach((ship, idx) => {
      if (ship.hurt > 0) ship.hurt -= dt;
      if (ship.repair > 0) {
        ship.repair -= dt;
        if (ship.repair <= 0 && ship.maxHp) ship.hp = ship.maxHp;
        return;
      }
      if (ship.power && t > ship.powerT) ship.power = null;
      ship.cooldown -= dt;
      if (ship.cooldown <= 0) {
        ship.cooldown = ship.power === 'rapid' ? 0.16 : diff.cooldown;
        fire(ship, idx);
      }
    });

    updateBullets(dt);
    updateFoeShots(dt);
    updatePowerups(dt);

    if (!clearing && aliens.length && aliens.every((a) => !a.alive)) {
      clearing = true;
      wave += 1;
      setLevel(slug, wave);
      sfx.missionComplete();
      hud.banner(`Golf ${wave - 1} verslagen!`, { sub: `Golf ${wave} komt aan`, ms: 1600 });
      timers.push(setTimeout(spawnWave, 1700));
    }
  }

  function updateBosses(dt, living) {
    for (const a of living) {
      if (a.type !== 'boss') continue;
      const pos = alienPos(a);

      if (a.blinkIn) {
        a.blinkIn -= dt;
        if (a.blinkIn <= 0) {
          a.blinkIn = a.boss.blink;
          // The eye jumps sideways instead of gliding, so you have to re-aim.
          // The landing spot is clamped to the screen — a boss you cannot
          // reach is not a challenge, it is a stalemate.
          const home = LOGICAL_WIDTH / 2 + swarmX + a.ox;
          const halfW = a.spec.w / 2 + 40;
          const target = Math.max(halfW, Math.min(LOGICAL_WIDTH - halfW, home + rnd(-420, 420)));
          a.blink = target - home;
          particles.push(...createBurst(pos.x, pos.y, ['#ff5f4d', '#ffffff'], { count: 18, speed: 300 }));
          sfx.laser();
        }
      }

      if (a.minionIn) {
        a.minionIn -= dt;
        if (a.minionIn <= 0) {
          a.minionIn = a.boss.minions;
          if (aliens.filter((x) => x.alive && x.type === 'mini').length < 6) {
            addAlien('mini', a.ox + rnd(-160, 160), a.oy + 130);
            sfx.blip();
          }
        }
      }

      if (!diff.fireRate) continue;
      a.fireIn -= dt * diff.fireRate;
      if (a.fireIn > 0) continue;
      a.fireIn = a.boss.every;
      const from = { x: pos.x, y: pos.y + a.spec.h / 2 };
      if (a.boss.attack === 'spread') {
        for (const vx of [-220, 0, 220]) foeShot(from.x, from.y, vx, 380, true);
      } else if (a.boss.attack === 'aimed') {
        const target = nearestShip(from.x);
        const dx = target.x - from.x;
        const dy = SHIP_Y - from.y;
        const len = Math.hypot(dx, dy) || 1;
        foeShot(from.x, from.y, (dx / len) * 460, (dy / len) * 460, true);
      } else {
        for (let i = 0; i < 4; i++) {
          timers.push(setTimeout(() => {
            if (a.alive) foeShot(alienPos(a).x, from.y, rnd(-60, 60), 520);
          }, i * 130));
        }
      }
      sfx.laser();
    }
  }

  function updateSwarmFire(dt, living) {
    if (!diff.fireRate) return;
    const shooters = living.filter((a) => a.type !== 'boss');
    if (!shooters.length) return;
    foeShotIn -= dt * diff.fireRate;
    if (foeShotIn > 0) return;
    foeShotIn = rnd(0.9, 2.1);
    // Only the alien lowest in its column fires, so shots never come out of
    // the middle of the formation.
    const a = shooters[Math.floor(Math.random() * shooters.length)];
    const below = shooters.some((o) => Math.abs(o.ox - a.ox) < 30 && o.oy > a.oy);
    if (below) return;
    const pos = alienPos(a);
    foeShot(pos.x, pos.y + a.spec.h / 2, 0, 430);
  }

  function updateMystery(dt) {
    if (mystery) {
      mystery.x += mystery.vx * dt;
      mystery.wob += dt * 6;
      if (mystery.x < -200 || mystery.x > LOGICAL_WIDTH + 200) mystery = null;
      return;
    }
    mysteryIn -= dt;
    if (mysteryIn > 0) return;
    mysteryIn = rnd(16, 26);
    const fromLeft = Math.random() < 0.5;
    mystery = {
      x: fromLeft ? -160 : LOGICAL_WIDTH + 160,
      y: SWARM_TOP - 110,
      vx: fromLeft ? 300 : -300,
      wob: 0,
    };
  }

  function updateBullets(dt) {
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

      if (mystery && Math.abs(b.x - mystery.x) < 82 && Math.abs(b.y - mystery.y) < 40) {
        const ship = ships[b.owner];
        ship.score += 10;
        hud.setScore(b.owner, ship.score);
        particles.push(...createBurst(mystery.x, mystery.y, BURST_COLORS, { count: 34, speed: 420 }));
        dropPower(mystery.x, mystery.y);
        hud.banner('Bonusschotel! +10 ⭐', { ms: 1200, hint: true });
        sfx.powerup();
        mystery = null;
        consumed = true;
      }

      if (!consumed) {
        for (const a of aliens) {
          if (!a.alive) continue;
          const pos = alienPos(a);
          if (Math.abs(b.x - pos.x) < a.spec.w / 2 && Math.abs(b.y - pos.y) < a.spec.h / 2) {
            hitAlien(a, ships[b.owner], b.owner);
            consumed = true;
            break;
          }
        }
      }

      if (consumed) {
        bullets.splice(i, 1);
        bulletPool.release(b);
      }
    }
  }

  function updateFoeShots(dt) {
    for (let i = foeShots.length - 1; i >= 0; i--) {
      const s = foeShots[i];
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      if (s.y > LOGICAL_HEIGHT + 40 || s.x < -40 || s.x > LOGICAL_WIDTH + 40) {
        foeShots.splice(i, 1);
        continue;
      }
      for (const ship of ships) {
        if (ship.repair > 0) continue;
        const reach = ship.shield > 0 ? 76 : 48;
        if (Math.hypot(s.x - ship.x, s.y - SHIP_Y) < reach + s.r) {
          particles.push(...createBurst(s.x, s.y, ['#ff5f4d', '#ffe066'], { count: 10, speed: 220 }));
          hurtShip(ship);
          foeShots.splice(i, 1);
          break;
        }
      }
    }
  }

  function updatePowerups(dt) {
    for (let i = powerups.length - 1; i >= 0; i--) {
      const p = powerups[i];
      p.y += 240 * dt;
      p.spin += dt * 3;
      if (p.y > LOGICAL_HEIGHT + 40) {
        powerups.splice(i, 1);
        continue;
      }
      for (const ship of ships) {
        if (ship.repair > 0) continue;
        if (Math.abs(p.x - ship.x) < SHIP_W / 2 + 40 && Math.abs(p.y - SHIP_Y) < 80) {
          if (p.kind === 'shield') ship.shield = 3;
          else { ship.power = p.kind; ship.powerT = t + 9; }
          powerups.splice(i, 1);
          sfx.powerup();
          hud.banner(POWER_LABEL[p.kind], { ms: 1100, hint: true });
          break;
        }
      }
    }
  }

  // --- alien art ----------------------------------------------------------

  function eyes(x, y, r, dx, look = 0) {
    for (const sign of [-1, 1]) {
      ctx.fillStyle = '#0b1138';
      ctx.beginPath();
      ctx.arc(x + sign * dx, y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(x + sign * dx + r * 0.3 + look, y - r * 0.25, r * 0.4, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawSquid(a, x, y, w, h) {
    const c = a.spec.color;
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.arc(x, y - h * 0.05, w / 2, Math.PI, 0);
    ctx.lineTo(x + w / 2, y + h * 0.12);
    ctx.lineTo(x - w / 2, y + h * 0.12);
    ctx.closePath();
    ctx.fill();
    // Tentacles ripple out of phase so a row of them looks alive.
    for (let i = 0; i < 4; i++) {
      const tx = x - w / 2 + (w / 4) * (i + 0.5);
      const wig = Math.sin(t * 6 + i + a.phase) * 7;
      ctx.beginPath();
      ctx.moveTo(tx - 9, y + h * 0.1);
      ctx.quadraticCurveTo(tx + wig, y + h * 0.36, tx + 9, y + h * 0.1);
      ctx.fill();
    }
    eyes(x, y - h * 0.06, 11, 22);
  }

  function drawSaucer(a, x, y, w, h) {
    ctx.fillStyle = '#d8c9ff';
    ctx.beginPath();
    ctx.arc(x, y - h * 0.1, w * 0.24, Math.PI, 0);
    ctx.fill();
    ctx.fillStyle = a.spec.color;
    ctx.beginPath();
    ctx.ellipse(x, y + h * 0.05, w / 2, h * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffe066';
    for (let i = -2; i <= 2; i++) {
      const on = (Math.floor(t * 6) + i + 5) % 5 === 0;
      ctx.globalAlpha = on ? 1 : 0.35;
      ctx.beginPath();
      ctx.arc(x + i * (w * 0.17), y + h * 0.1, 6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    eyes(x, y - h * 0.16, 8, 15);
  }

  function drawBeetle(a, x, y, w, h) {
    ctx.strokeStyle = a.spec.color;
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    for (const sign of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(x + sign * 18, y - h * 0.3);
      ctx.quadraticCurveTo(x + sign * 42, y - h * 0.72, x + sign * 16, y - h * 0.86);
      ctx.stroke();
    }
    ctx.fillStyle = a.spec.color;
    ctx.beginPath();
    ctx.ellipse(x, y, w / 2, h * 0.44, 0, 0, Math.PI * 2);
    ctx.fill();
    // Plates flake off as it takes damage, so its toughness is legible.
    const plates = a.hp;
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    for (let i = 0; i < plates; i++) {
      roundRect(ctx, x - w * 0.34, y - h * 0.3 + i * 15, w * 0.68, 10, 5);
      ctx.fill();
    }
    eyes(x, y + h * 0.14, 10, 24);
  }

  function drawBlob(a, x, y, w, h) {
    const squish = 1 + Math.sin(t * 5 + a.phase) * 0.08;
    ctx.fillStyle = a.spec.color;
    ctx.beginPath();
    ctx.ellipse(x, y, (w / 2) * squish, (h / 2) / squish, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#0b1138';
    ctx.beginPath();
    ctx.arc(x, y - h * 0.04, h * 0.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(x + h * 0.07, y - h * 0.1, h * 0.07, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawJelly(a, x, y, w, h) {
    ctx.fillStyle = a.spec.color;
    ctx.beginPath();
    ctx.ellipse(x, y - h * 0.12, w / 2, h * 0.38, 0, Math.PI, 0);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    ctx.beginPath();
    ctx.ellipse(x - w * 0.16, y - h * 0.24, w * 0.12, h * 0.12, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = a.spec.color;
    ctx.lineWidth = 12;
    ctx.lineCap = 'round';
    for (let i = 0; i < 6; i++) {
      const tx = x - w * 0.4 + (w * 0.8 * i) / 5;
      ctx.beginPath();
      ctx.moveTo(tx, y - h * 0.12);
      ctx.quadraticCurveTo(tx + Math.sin(t * 3 + i) * 34, y + h * 0.18, tx + Math.sin(t * 3 + i) * 12, y + h * 0.46);
      ctx.stroke();
    }
    eyes(x, y - h * 0.22, 22, 54);
  }

  function drawCrab(a, x, y, w, h) {
    ctx.fillStyle = a.spec.color;
    for (const sign of [-1, 1]) {
      const claw = Math.sin(t * 4) * 0.25;
      ctx.save();
      ctx.translate(x + sign * w * 0.44, y);
      // The pincer's gap has to face away from the body, so the left claw is
      // the right one turned around.
      ctx.rotate(sign * claw + (sign < 0 ? Math.PI : 0));
      ctx.beginPath();
      ctx.arc(0, 0, h * 0.3, 0.6, Math.PI * 2 - 0.6);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.beginPath();
    ctx.ellipse(x, y, w * 0.34, h * 0.42, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = a.spec.color;
    ctx.lineWidth = 9;
    for (const sign of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(x + sign * 34, y - h * 0.3);
      ctx.lineTo(x + sign * 46, y - h * 0.62);
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(x + sign * 46, y - h * 0.68, 15, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#0b1138';
      ctx.beginPath();
      ctx.arc(x + sign * 46, y - h * 0.68, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = a.spec.color;
    }
  }

  function drawEye(a, x, y, w, h) {
    const target = nearestShip(x);
    const dx = (target.x - x) / LOGICAL_WIDTH;
    ctx.fillStyle = a.spec.color;
    ctx.beginPath();
    ctx.arc(x, y, w / 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#f6f1e4';
    ctx.beginPath();
    ctx.arc(x, y, w * 0.36, 0, Math.PI * 2);
    ctx.fill();
    // The pupil tracks whichever ship is closest — unmistakably aimed at you.
    ctx.fillStyle = '#0b1138';
    ctx.beginPath();
    ctx.arc(x + dx * w * 0.2, y + w * 0.06, w * 0.16, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = a.spec.color;
    ctx.lineWidth = 10;
    ctx.lineCap = 'round';
    for (let i = 0; i < 10; i++) {
      const ang = (Math.PI * 2 * i) / 10 + Math.sin(t * 2) * 0.12;
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(ang) * (w / 2), y + Math.sin(ang) * (w / 2));
      ctx.lineTo(x + Math.cos(ang) * (w / 2 + 26), y + Math.sin(ang) * (w / 2 + 26));
      ctx.stroke();
    }
  }

  const ART = {
    squid: drawSquid, saucer: drawSaucer, beetle: drawBeetle, blob: drawBlob,
    jelly: drawJelly, crab: drawCrab, eye: drawEye,
  };

  function drawAlien(a) {
    const { x, y } = alienPos(a);
    const { w, h, color } = a.spec;

    ctx.save();
    ctx.shadowColor = color;
    ctx.shadowBlur = a.type === 'boss' ? 42 : 18;
    ART[a.spec.art](a, x, y, w, h);
    ctx.restore();

    if (a.type === 'boss') {
      const frac = Math.max(0, a.hp / a.maxHp);
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      roundRect(ctx, x - 150, y + h / 2 + 18, 300, 20, 10);
      ctx.fill();
      ctx.fillStyle = frac > 0.35 ? '#6ee87a' : '#ff5f4d';
      roundRect(ctx, x - 150, y + h / 2 + 18, 300 * frac, 20, 10);
      ctx.fill();
    }
  }

  function drawMystery() {
    const { x, y } = mystery;
    ctx.save();
    ctx.shadowColor = '#ffe066';
    ctx.shadowBlur = 30;
    ctx.fillStyle = '#ffe066';
    ctx.beginPath();
    ctx.ellipse(x, y, 78, 26, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#7cc4ff';
    ctx.beginPath();
    ctx.arc(x, y - 14, 30, Math.PI, 0);
    ctx.fill();
    ctx.restore();
    for (let i = -2; i <= 2; i++) {
      ctx.fillStyle = ['#ff5f4d', '#6ee87a', '#7cc4ff', '#b06bff', '#ffb224'][i + 2];
      ctx.globalAlpha = (Math.sin(mystery.wob + i) + 1) / 2 * 0.7 + 0.3;
      ctx.beginPath();
      ctx.arc(x + i * 26, y + 12, 7, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  function drawShip(ship) {
    const y = SHIP_Y;
    if (ship.repair > 0) {
      // Rebuilding: a dotted outline plus a countdown ring, so the child can
      // see it is coming back rather than gone.
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.45)';
      ctx.setLineDash([12, 10]);
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(ship.x, y - SHIP_H / 2);
      ctx.lineTo(ship.x - SHIP_W / 2, y + SHIP_H / 2);
      ctx.lineTo(ship.x + SHIP_W / 2, y + SHIP_H / 2);
      ctx.closePath();
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.strokeStyle = '#ffb224';
      ctx.lineWidth = 8;
      ctx.beginPath();
      ctx.arc(ship.x, y, 60, -Math.PI / 2, -Math.PI / 2 + (1 - ship.repair / 2.6) * Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      return;
    }

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
    ctx.fillStyle = ship.hurt > 0 ? '#ffffff' : ship.color;
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

    if (ship.shield > 0) {
      ctx.strokeStyle = `rgba(124,196,255,${0.35 + 0.2 * ship.shield})`;
      ctx.lineWidth = 7;
      ctx.beginPath();
      ctx.arc(ship.x, y, 76, 0, Math.PI * 2);
      ctx.stroke();
    }

    if (ship.maxHp) {
      const bw = 132;
      const bx = ship.x - bw / 2;
      const by = y + SHIP_H / 2 + 26;
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      roundRect(ctx, bx, by, bw, 16, 8);
      ctx.fill();
      ctx.fillStyle = ship.hp > 2 ? '#6ee87a' : '#ff5f4d';
      roundRect(ctx, bx, by, (bw * Math.max(0, ship.hp)) / ship.maxHp, 16, 8);
      ctx.fill();
    }
  }

  function drawPowerup(p) {
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.spin);
    ctx.shadowColor = '#ffb224';
    ctx.shadowBlur = 26;
    ctx.fillStyle = p.kind === 'shield' ? '#7cc4ff' : '#ffb224';
    roundRect(ctx, -26, -26, 52, 52, 14);
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = '#121634';
    ctx.font = 'bold 34px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(p.kind === 'spread' ? 'W' : p.kind === 'rapid' ? '»' : '(', p.x, p.y);
  }

  function draw(dt) {
    drawSpaceBackdrop(ctx, stars, t, { scrollSpeed: 16 });

    // The line the swarm will never cross, so the safe zone is visible.
    if (diff) {
      ctx.strokeStyle = 'rgba(255,95,77,0.16)';
      ctx.lineWidth = 3;
      ctx.setLineDash([26, 22]);
      ctx.beginPath();
      ctx.moveTo(0, DANGER_Y + 26);
      ctx.lineTo(LOGICAL_WIDTH, DANGER_Y + 26);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    for (const a of aliens) if (a.alive) drawAlien(a);
    if (mystery) drawMystery();

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

    ctx.save();
    ctx.shadowColor = '#ff5f4d';
    ctx.shadowBlur = 20;
    for (const s of foeShots) {
      ctx.fillStyle = s.big ? '#ff8a3d' : '#ff5f4d';
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
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

  // --- difficulty picker --------------------------------------------------

  const picker = document.createElement('div');
  picker.className = 'inv-diff';
  const lastPick = getItem('inv-difficulty', 'gewoon');
  picker.innerHTML = `
    <div class="inv-diff__panel">
      <div class="inv-diff__title">Hoe moeilijk mag het zijn?</div>
      <div class="inv-diff__row">
        ${DIFFICULTIES.map((d) => `
          <button class="inv-diff__btn${d.id === lastPick ? ' is-last' : ''}" data-id="${d.id}">
            <span class="inv-diff__icon">${d.icon}</span>
            <span class="inv-diff__label">${d.label}</span>
            <span class="inv-diff__sub">${d.sub}</span>
          </button>
        `).join('')}
      </div>
    </div>
  `;
  stage.appendChild(picker);

  const onPick = (e) => {
    const btn = e.target.closest('.inv-diff__btn');
    if (!btn) return;
    diff = DIFFICULTIES.find((d) => d.id === btn.dataset.id);
    setItem('inv-difficulty', diff.id);
    for (const ship of ships) {
      ship.maxHp = diff.hp;
      ship.hp = diff.hp;
    }
    picker.remove();
    spawnWave();
    sfx.launch();
  };
  picker.addEventListener('pointerup', onPick);

  listeners.push(() => {
    picker.removeEventListener('pointerup', onPick);
    canvas.removeEventListener('pointerdown', onDown);
    canvas.removeEventListener('pointermove', onMove);
    canvas.removeEventListener('pointerup', onUp);
    canvas.removeEventListener('pointercancel', onUp);
  });
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
  hud?.destroy();
  hud = null;
}
