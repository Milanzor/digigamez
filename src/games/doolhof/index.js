import './style.css';
import { createHud, showMissionComplete } from '../../shared/ui-components.js';
import {
  setupCanvas, LOGICAL_WIDTH, LOGICAL_HEIGHT,
  createStars, drawSpaceBackdrop, createBurst, updateAndDrawParticles,
  drawGlow, drawStar, roundRect, withAlpha,
} from '../../shared/canvas-utils.js';
import { sfx } from '../../shell/audio.js';
import { setLevel, starsForLevel } from '../../shell/progress.js';

// "Sterrendoolhof" — drag the rover through the tunnels to the beacon.
//
// The archive had no maze at all. The plan had ruled one out, but what it
// actually ruled out was the *input*: a tilt maze needs an accelerometer and
// this board is driven by a laptop. Dragging is the input a touchscreen has, so
// the genre comes back with the finger doing the steering.
//
// Two decisions carry the whole game:
//
// 1. **A wall stops the rover, it never resets it.** The Rover mission already
//    established that bumping into something is a bounce and not a failure, and
//    a maze is where that rule pays off most: the only way a maze can punish
//    you is by sending you back to the start, and this one cannot.
// 2. **The finger does not have to be on the rover.** Hold a finger anywhere in
//    the tunnels and the rover walks towards it. Collision still applies, so
//    pointing at the far side of a wall does not teleport anybody — it just
//    walks the rover as far as the tunnel goes. For a three-year-old whose
//    finger keeps sliding off a moving target, that is the difference between
//    a maze and a wrestling match.

// Level 1 started at 5x4 and that was too coarse to be a maze: five cells across
// a 1920-wide board gives 380px "corridors", which is a room with a few dividers
// in it. Seven by five is the smallest grid that still reads as tunnels.
const LEVELS = [
  { cols: 7, rows: 5, crystals: 3, gates: 0 },
  { cols: 9, rows: 6, crystals: 3, gates: 0 },
  { cols: 11, rows: 7, crystals: 4, gates: 1 },
  { cols: 13, rows: 8, crystals: 4, gates: 1 },
  { cols: 15, rows: 9, crystals: 5, gates: 2 },
];

// And a cell is capped, so an early maze is drawn small and tunnel-like instead
// of being stretched until its walls look like furniture.
const MAX_CELL = 150;

// Two mazes to a level: enough that finishing one is not the whole level, few
// enough that the reward screen is never far off. Same ratio as Sterrenpaden.
const ROUNDS = 2;

// Sides, clockwise, matching the bit order used in `open`.
const N = 0, E = 1, S = 2, W = 3;
const DR = [-1, 0, 1, 0];
const DC = [0, 1, 0, -1];
const OPP = (d) => (d + 2) % 4;

let hud = null;
let handle = null;
let raf = null;
let listeners = [];
let timers = [];
let reward = null;
let stage = null;
let level = 1;
let slug = 'doolhof';
let mission = null;
let onExit = null;

const randInt = (n) => Math.floor(Math.random() * n);

function later(fn, ms) {
  const id = setTimeout(fn, ms);
  timers.push(id);
  return id;
}

// --- Maze generation ------------------------------------------------------

// Recursive backtracker, iterative so a 13x8 maze cannot blow the stack. Every
// cell ends up reachable from every other by exactly one route, which is what
// makes the "is the beacon reachable" question free: it always is.
function carve(cols, rows) {
  const open = Array.from({ length: rows }, () => Array(cols).fill(0));
  const seen = Array.from({ length: rows }, () => Array(cols).fill(false));
  const stack = [[0, 0]];
  seen[0][0] = true;

  while (stack.length) {
    const [r, c] = stack[stack.length - 1];
    const options = [];
    for (let d = 0; d < 4; d++) {
      const nr = r + DR[d];
      const nc = c + DC[d];
      if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
      if (!seen[nr][nc]) options.push(d);
    }
    if (!options.length) {
      stack.pop();
      continue;
    }
    const d = options[randInt(options.length)];
    const nr = r + DR[d];
    const nc = c + DC[d];
    open[r][c] |= 1 << d;
    open[nr][nc] |= 1 << OPP(d);
    seen[nr][nc] = true;
    stack.push([nr, nc]);
  }
  return open;
}

// Breadth-first search over the carved maze, optionally refusing to cross a
// closed gate. Returns the parent map, which doubles as the reachable set.
function flood(open, cols, rows, start, blocked = null) {
  const key = (r, c) => r * cols + c;
  const from = new Map([[key(...start), null]]);
  const queue = [start];
  for (let i = 0; i < queue.length; i++) {
    const [r, c] = queue[i];
    for (let d = 0; d < 4; d++) {
      if (!(open[r][c] & (1 << d))) continue;
      if (blocked && blocked.has(`${r},${c},${d}`)) continue;
      const nr = r + DR[d];
      const nc = c + DC[d];
      if (from.has(key(nr, nc))) continue;
      from.set(key(nr, nc), [r, c]);
      queue.push([nr, nc]);
    }
  }
  return from;
}

function pathBetween(from, cols, start, goal) {
  const key = (r, c) => r * cols + c;
  const path = [];
  let cur = goal;
  while (cur) {
    path.push(cur);
    cur = from.get(key(...cur));
  }
  return path.reverse();
}

// A gate sits on the solution path and its key sits somewhere you can reach
// *without* going through it. Both halves matter: a gate off the path is
// decoration, and a key behind its own gate is a dead maze.
function placeGates(open, cols, rows, start, goal, count) {
  const blocked = new Set();
  const gates = [];
  const spine = pathBetween(flood(open, cols, rows, start), cols, start, goal);

  for (let i = 0; i < count; i++) {
    // Spread the gates over the back half of the route so the child is always
    // sent looking for a key they have room to find.
    const at = Math.floor(spine.length * (0.45 + i * 0.28));
    const a = spine[Math.min(at, spine.length - 2)];
    const b = spine[Math.min(at + 1, spine.length - 1)];
    if (!a || !b || (a[0] === b[0] && a[1] === b[1])) continue;
    const dir = [0, 1, 2, 3].find((d) => a[0] + DR[d] === b[0] && a[1] + DC[d] === b[1]);
    if (dir === undefined) continue;

    blocked.add(`${a[0]},${a[1]},${dir}`);
    blocked.add(`${b[0]},${b[1]},${OPP(dir)}`);

    const reach = [...flood(open, cols, rows, start, blocked).keys()]
      .map((k) => [Math.floor(k / cols), k % cols])
      .filter(([r, c]) => !(r === start[0] && c === start[1]));
    const key = reach.length ? reach[randInt(reach.length)] : start;
    gates.push({ a, b, dir, key, taken: false });
  }
  return gates;
}

function buildMaze(cfg) {
  const { cols, rows } = cfg;
  const open = carve(cols, rows);
  const start = [0, 0];
  const goal = [rows - 1, cols - 1];
  const gates = cfg.gates ? placeGates(open, cols, rows, start, goal, cfg.gates) : [];

  // Crystals are pure bonus — the reason to look down a side tunnel rather
  // than a requirement hidden behind the beacon. Never on the start cell, so
  // one is never collected before the child has touched anything.
  const taken = new Set([`${start[0]},${start[1]}`, `${goal[0]},${goal[1]}`]);
  gates.forEach((g) => taken.add(`${g.key[0]},${g.key[1]}`));
  const crystals = [];
  for (let guard = 0; guard < 200 && crystals.length < cfg.crystals; guard++) {
    const r = randInt(rows);
    const c = randInt(cols);
    if (taken.has(`${r},${c}`)) continue;
    taken.add(`${r},${c}`);
    crystals.push({ r, c, got: false });
  }

  return { open, cols, rows, start, goal, gates, crystals };
}

// --- Geometry -------------------------------------------------------------

// The tunnels as a list of rectangles: one per cell, plus a bridge across every
// wall gap. Collision is then "are my four probes inside some rectangle",
// which is cheap and — more importantly — cannot leak diagonally through a
// corner the way a grid-index test can.
function buildTunnels(maze, geo) {
  const { open, cols, rows, gates } = maze;
  const { cell, wall, x0, y0 } = geo;
  const rects = [];
  const inner = cell - wall * 2;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      rects.push({
        x: x0 + c * cell + wall,
        y: y0 + r * cell + wall,
        w: inner,
        h: inner,
      });
      // Only east and south, so each gap is bridged exactly once.
      for (const d of [E, S]) {
        if (!(open[r][c] & (1 << d))) continue;
        const gate = gates.find((g) =>
          !g.taken && ((g.a[0] === r && g.a[1] === c && g.dir === d)
            || (g.b[0] === r && g.b[1] === c && OPP(g.dir) === d)));
        if (gate) continue;
        rects.push(d === E
          ? { x: x0 + c * cell + cell - wall, y: y0 + r * cell + wall, w: wall * 2, h: inner }
          : { x: x0 + c * cell + wall, y: y0 + r * cell + cell - wall, w: inner, h: wall * 2 });
      }
    }
  }
  return rects;
}

function inTunnel(rects, x, y) {
  for (let i = 0; i < rects.length; i++) {
    const t = rects[i];
    if (x >= t.x && x <= t.x + t.w && y >= t.y && y <= t.y + t.h) return true;
  }
  return false;
}

export function init(container, opts) {
  slug = opts.slug;
  level = Math.max(1, opts.startLevel || 1);
  mission = { title: opts.title, icon: opts.icon, color: opts.color };
  onExit = opts.onExit;
  reward = null;
  listeners = [];
  timers = [];

  hud = createHud(container, {
    title: opts.title,
    onExit: opts.onExit,
    level,
    meter: 'Tunnels',
  });

  stage = document.createElement('div');
  stage.className = 'maze-stage';
  const canvas = document.createElement('canvas');
  canvas.className = 'maze-canvas';
  const hint = document.createElement('div');
  hint.className = 'hint-line maze-hint';
  hint.textContent = 'Houd je vinger in de tunnel — de rover komt naar je toe';
  stage.append(canvas, hint);
  container.appendChild(stage);

  handle = setupCanvas(canvas, { alpha: false });
  const { ctx, toLogical } = handle;
  const backdrop = createStars(90);

  let maze = null;
  let geo = null;
  let tunnels = [];
  let wallSprite = null;
  let rover = { x: 0, y: 0 };
  let trail = [];
  let particles = [];
  let round = 0;
  let keysHeld = 0;
  let arrived = 0;
  let t = 0;
  const fingers = new Map();

  // The maze is laid out to fill whatever is left under the HUD, and the cell
  // size comes out of whichever axis runs out first — so a 13x8 maze is drawn
  // smaller rather than cropped.
  function layout() {
    const top = 150;
    const bottom = 76;
    const availW = LOGICAL_WIDTH - 120;
    const availH = LOGICAL_HEIGHT - top - bottom;
    const cell = Math.floor(Math.min(availW / maze.cols, availH / maze.rows, MAX_CELL));
    const w = cell * maze.cols;
    const h = cell * maze.rows;
    return {
      cell,
      wall: Math.max(7, Math.round(cell * 0.15)),
      x0: Math.round((LOGICAL_WIDTH - w) / 2),
      y0: Math.round(top + (availH - h) / 2),
    };
  }

  const cellCentre = (r, c) => ({
    x: geo.x0 + c * geo.cell + geo.cell / 2,
    y: geo.y0 + r * geo.cell + geo.cell / 2,
  });

  const roverRadius = () => (geo.cell - geo.wall * 2) * 0.34;

  // Walls never move, so they are drawn once into an offscreen canvas and
  // blitted after that — the same rule the space backdrop follows.
  function bakeWalls() {
    const { cell, wall, x0, y0 } = geo;
    const w = cell * maze.cols + wall * 2;
    const h = cell * maze.rows + wall * 2;
    wallSprite = document.createElement('canvas');
    wallSprite.width = w;
    wallSprite.height = h;
    const g = wallSprite.getContext('2d');
    g.translate(wall - x0, wall - y0);

    // The floor first: one soft slab under the whole maze so the tunnels read
    // as carved out of something instead of as gaps between sticks.
    g.fillStyle = 'rgba(255,255,255,0.035)';
    roundRect(g, x0 - wall / 2, y0 - wall / 2, cell * maze.cols + wall, cell * maze.rows + wall, wall);
    g.fill();

    g.strokeStyle = 'rgba(232,217,176,0.30)';
    g.lineWidth = Math.max(3, wall * 0.5);
    g.lineCap = 'round';
    g.beginPath();
    for (let r = 0; r < maze.rows; r++) {
      for (let c = 0; c < maze.cols; c++) {
        const x = x0 + c * cell;
        const y = y0 + r * cell;
        // North and west of every cell, plus the outer south/east edges: each
        // wall segment is then drawn exactly once.
        if (!(maze.open[r][c] & (1 << N))) { g.moveTo(x, y); g.lineTo(x + cell, y); }
        if (!(maze.open[r][c] & (1 << W))) { g.moveTo(x, y); g.lineTo(x, y + cell); }
        if (r === maze.rows - 1) { g.moveTo(x, y + cell); g.lineTo(x + cell, y + cell); }
        if (c === maze.cols - 1) { g.moveTo(x + cell, y); g.lineTo(x + cell, y + cell); }
      }
    }
    g.stroke();
  }

  function refit() {
    if (!maze) return;
    geo = layout();
    tunnels = buildTunnels(maze, geo);
    bakeWalls();
  }

  function newRound() {
    const cfg = LEVELS[Math.min(level, LEVELS.length) - 1];
    maze = buildMaze(cfg);
    keysHeld = 0;
    arrived = 0;
    trail = [];
    particles = [];
    fingers.clear();
    refit();
    const start = cellCentre(...maze.start);
    rover = { x: start.x, y: start.y };
  }

  function startLevel() {
    hud.setLevel(level);
    hud.setMeter(0);
    round = 0;
    newRound();
  }

  function finishLevel() {
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
      title: 'De rover is thuis! 🛸',
      onNext: () => { reward = null; startLevel(); },
      onRetry: () => { reward = null; level = cleared; startLevel(); },
      onHome: onExit,
    });
  }

  // --- Movement -----------------------------------------------------------

  // One axis at a time, so sliding along a wall keeps the other axis moving
  // instead of stopping dead in a corner — the thing that makes a drag-maze
  // feel sticky if you resolve both at once.
  function step(dx, dy) {
    const r = roverRadius();
    const probe = (x, y) =>
      inTunnel(tunnels, x - r, y) && inTunnel(tunnels, x + r, y)
      && inTunnel(tunnels, x, y - r) && inTunnel(tunnels, x, y + r);

    if (dx && probe(rover.x + dx, rover.y)) rover.x += dx;
    if (dy && probe(rover.x, rover.y + dy)) rover.y += dy;
  }

  function collect() {
    const grabR = geo.cell * 0.42;

    for (const cr of maze.crystals) {
      if (cr.got) continue;
      const p = cellCentre(cr.r, cr.c);
      if (Math.hypot(p.x - rover.x, p.y - rover.y) > grabR) continue;
      cr.got = true;
      sfx.chime(maze.crystals.filter((c) => c.got).length - 1);
      particles.push(...createBurst(p.x, p.y, ['#8fd6ff', '#ffffff'], { count: 10, speed: 190 }));
    }

    for (const g of maze.gates) {
      if (g.taken) continue;
      const p = cellCentre(...g.key);
      if (Math.hypot(p.x - rover.x, p.y - rover.y) > grabR) continue;
      g.taken = true;
      keysHeld += 1;
      sfx.powerup();
      particles.push(...createBurst(p.x, p.y, ['#ffc24a', '#fff6e5'], { count: 16, speed: 240 }));
      // The gate this key belongs to is now a tunnel like any other.
      tunnels = buildTunnels(maze, geo);
    }

    if (arrived) return;
    const goal = cellCentre(...maze.goal);
    if (Math.hypot(goal.x - rover.x, goal.y - rover.y) < grabR) {
      arrived = 0.001;
      sfx.dock();
      particles.push(...createBurst(goal.x, goal.y, [mission.color, '#ffffff', '#ffc24a'], { count: 26, speed: 300 }));
      later(() => {
        round += 1;
        hud.setMeter(round / ROUNDS);
        if (round >= ROUNDS) finishLevel();
        else newRound();
      }, 1300);
    }
  }

  function update(dt) {
    t += dt;
    if (arrived > 0) {
      arrived = Math.min(1, arrived + dt * 2);
      updateTrail();
      return;
    }
    if (!fingers.size) return;

    // The most recently placed finger wins, so a child who reaches past their
    // own hand is not fighting a stale touch.
    const target = [...fingers.values()].pop();
    const dx = target.x - rover.x;
    const dy = target.y - rover.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 2) return;

    const speed = geo.cell * 5.2;
    const move = Math.min(dist, speed * dt);
    step((dx / dist) * move, (dy / dist) * move);
    updateTrail();
    collect();
  }

  function updateTrail() {
    const last = trail[trail.length - 1];
    if (!last || Math.hypot(last.x - rover.x, last.y - rover.y) > geo.cell * 0.22) {
      trail.push({ x: rover.x, y: rover.y });
      // Capped: a breadcrumb trail is a memory aid, not a growing array.
      if (trail.length > 220) trail.shift();
    }
  }

  // --- Drawing ------------------------------------------------------------

  function drawTrail() {
    if (trail.length < 2) return;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,194,74,0.22)';
    ctx.lineWidth = Math.max(4, geo.cell * 0.1);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(trail[0].x, trail[0].y);
    for (let i = 1; i < trail.length; i++) ctx.lineTo(trail[i].x, trail[i].y);
    ctx.stroke();
    ctx.restore();
  }

  function drawGates() {
    for (const g of maze.gates) {
      if (g.taken) continue;

      const key = cellCentre(...g.key);
      const bob = Math.sin(t * 3) * geo.cell * 0.04;
      drawGlow(ctx, '#ffc24a', key.x, key.y + bob, geo.cell * 0.5, 0.8);
      ctx.save();
      ctx.font = `${Math.round(geo.cell * 0.5)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('🔑', key.x, key.y + bob);
      ctx.restore();

      // The gate itself: a bar across the wall gap, amber while it is shut and
      // gone once the key is in. Drawn between the two cells it separates.
      const a = cellCentre(...g.a);
      const b = cellCentre(...g.b);
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      const horizontal = g.dir === E || g.dir === W;
      const len = geo.cell - geo.wall * 2;
      ctx.save();
      ctx.fillStyle = 'rgba(255,194,74,0.75)';
      const w = horizontal ? geo.wall * 1.3 : len;
      const h = horizontal ? len : geo.wall * 1.3;
      roundRect(ctx, mx - w / 2, my - h / 2, w, h, geo.wall * 0.5);
      ctx.fill();
      ctx.restore();
    }
  }

  function drawCrystals() {
    for (const cr of maze.crystals) {
      if (cr.got) continue;
      const p = cellCentre(cr.r, cr.c);
      const pulse = 1 + Math.sin(t * 3.4 + cr.c) * 0.08;
      drawGlow(ctx, '#8fd6ff', p.x, p.y, geo.cell * 0.42, 0.55);
      drawStar(ctx, p.x, p.y, geo.cell * 0.2 * pulse, '#c9ecff', 4);
    }
  }

  function drawBeacon() {
    const p = cellCentre(...maze.goal);
    const open = keysHeld >= maze.gates.length;
    const pulse = 1 + Math.sin(t * 2.6) * 0.06;
    drawGlow(ctx, open ? mission.color : '#6b6656', p.x, p.y, geo.cell * 0.62 * pulse, open ? 0.85 : 0.4);
    ctx.save();
    ctx.font = `${Math.round(geo.cell * 0.52)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🛸', p.x, p.y);
    ctx.restore();
  }

  function drawRover() {
    const r = roverRadius();
    const size = r * 2.1;
    drawGlow(ctx, '#ffc24a', rover.x, rover.y, r * 2.4, 0.7);

    ctx.save();
    ctx.translate(rover.x, rover.y);
    // Body: a little tracked cart. Drawn rather than an emoji so it stays
    // crisp when a 13x8 maze shrinks the cells.
    ctx.fillStyle = '#f3ece0';
    roundRect(ctx, -size * 0.42, -size * 0.3, size * 0.84, size * 0.6, size * 0.16);
    ctx.fill();
    ctx.fillStyle = '#2c1c04';
    roundRect(ctx, -size * 0.24, -size * 0.18, size * 0.48, size * 0.24, size * 0.07);
    ctx.fill();
    ctx.fillStyle = 'rgba(44,28,4,0.65)';
    roundRect(ctx, -size * 0.46, size * 0.14, size * 0.92, size * 0.16, size * 0.08);
    ctx.fill();
    // Antenna, so the cart has a front and a top at a glance.
    ctx.strokeStyle = '#f3ece0';
    ctx.lineWidth = Math.max(2, size * 0.07);
    ctx.beginPath();
    ctx.moveTo(size * 0.22, -size * 0.3);
    ctx.lineTo(size * 0.34, -size * 0.56);
    ctx.stroke();
    ctx.fillStyle = '#ffc24a';
    ctx.beginPath();
    ctx.arc(size * 0.34, -size * 0.6, Math.max(2.5, size * 0.09), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Where the finger is, so a child who is holding the wrong side of a wall can
  // see that the rover is trying and the wall is the problem.
  function drawFingers() {
    for (const f of fingers.values()) {
      ctx.save();
      ctx.strokeStyle = 'rgba(255,194,74,0.5)';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(f.x, f.y, geo.cell * 0.2 + Math.sin(t * 6) * 3, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  function draw(dt) {
    drawSpaceBackdrop(ctx, backdrop, t, { scrollSpeed: 3 });
    ctx.drawImage(wallSprite, geo.x0 - geo.wall, geo.y0 - geo.wall);
    drawTrail();
    drawCrystals();
    drawGates();
    drawBeacon();
    drawFingers();
    drawRover();
    updateAndDrawParticles(ctx, particles, dt, { gravity: -20 });

    if (arrived > 0) {
      // A ring washing out of the beacon, so arriving reads as landing.
      const p = cellCentre(...maze.goal);
      ctx.save();
      ctx.globalAlpha = (1 - arrived) * 0.7;
      ctx.strokeStyle = withAlpha(mission.color, 1);
      ctx.lineWidth = 9;
      ctx.beginPath();
      ctx.arc(p.x, p.y, geo.cell * (0.4 + arrived * 1.9), 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  // --- Input --------------------------------------------------------------

  const onDown = (e) => {
    if (arrived) return;
    canvas.setPointerCapture?.(e.pointerId);
    fingers.set(e.pointerId, toLogical(e.clientX, e.clientY));
    sfx.blip();
  };
  const onMove = (e) => {
    if (!fingers.has(e.pointerId)) return;
    fingers.set(e.pointerId, toLogical(e.clientX, e.clientY));
  };
  const onUp = (e) => fingers.delete(e.pointerId);

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  listeners.push(() => {
    canvas.removeEventListener('pointerdown', onDown);
    canvas.removeEventListener('pointermove', onMove);
    canvas.removeEventListener('pointerup', onUp);
    canvas.removeEventListener('pointercancel', onUp);
  });

  // A laptop driving the board can change size when it goes fullscreen, and the
  // maze is laid out in logical pixels — so only the wall sprite needs rebaking.
  const onResize = () => refit();
  window.addEventListener('resize', onResize);
  listeners.push(() => window.removeEventListener('resize', onResize));

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
  reward?.close();
  reward = null;
  hud?.destroy();
  hud = null;
  stage = null;
}
