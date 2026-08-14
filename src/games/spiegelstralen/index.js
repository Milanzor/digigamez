import './style.css';
import { createHud, showMissionComplete } from '../../shared/ui-components.js';
import {
  setupCanvas, LOGICAL_WIDTH, LOGICAL_HEIGHT,
  createStars, drawSpaceBackdrop, createBurst, updateAndDrawParticles,
  drawGlow, drawStar, roundRect, withAlpha,
} from '../../shared/canvas-utils.js';
import { sfx } from '../../shell/audio.js';
import { onTap } from '../../shell/pointer.js';
import { setLevel, starsForLevel } from '../../shell/progress.js';

// "Spiegelstralen" — turn the mirrors so the beam reaches every crystal.
//
// The archive thins out sharply at the top end: of twenty-four missions only
// Sterrenrij and Brandstof Sorteren really stretch a seven-year-old. This is
// built for that end of the room, and it is the only puzzle here where the
// answer has to be worked out before it can be tapped in.
//
// Generation is solvable-by-construction, the same approach Zuurstofleidingen
// takes: the beam's route is walked first and the mirrors are laid down along
// it, then their orientations are scrambled. The difference is that this one
// **verifies** afterwards — it traces the finished board with every mirror in
// its intended orientation and throws the puzzle away if the crystals do not all
// light. Beams that branch make the hand-argument about correctness harder than
// it is worth, and a trace is cheap.
//
// A mirror has two states, so a tap flips it. Decoy mirrors and blocks are only
// ever placed on cells the solution beam never enters, which is what keeps them
// decoration rather than a second puzzle.

const N = 0, E = 1, S = 2, W = 3;
const DR = [-1, 0, 1, 0];
const DC = [0, 1, 0, -1];
const OPP = (d) => (d + 2) % 4;

// A '/' mirror sends a beam travelling east upwards; a '\' sends it down. Both
// are their own inverse, which is why two states are enough.
const SLASH = { [E]: N, [N]: E, [W]: S, [S]: W };
const BACKSLASH = { [E]: S, [S]: E, [W]: N, [N]: W };

const LEVELS = [
  { cols: 5, rows: 4, turns: 2, decoys: 1, walls: 0, prisms: 0 },
  { cols: 6, rows: 4, turns: 3, decoys: 2, walls: 1, prisms: 0 },
  { cols: 6, rows: 5, turns: 4, decoys: 2, walls: 1, prisms: 0 },
  { cols: 7, rows: 5, turns: 5, decoys: 3, walls: 2, prisms: 1 },
  { cols: 8, rows: 6, turns: 6, decoys: 3, walls: 2, prisms: 1 },
  { cols: 9, rows: 6, turns: 7, decoys: 4, walls: 3, prisms: 2 },
];

let hud = null;
let handle = null;
let raf = null;
let listeners = [];
let timers = [];
let reward = null;
let stage = null;
let level = 1;
let slug = 'spiegelstralen';
let mission = null;
let onExit = null;

const randInt = (n) => Math.floor(Math.random() * n);
const pick = (arr) => arr[randInt(arr.length)];

function later(fn, ms) {
  const id = setTimeout(fn, ms);
  timers.push(id);
  return id;
}

// --- Tracing --------------------------------------------------------------

// Where the beam leaves the emitter: just outside the grid, on its edge. Derived
// from the geometry rather than stored, so a resize cannot leave it behind.
function mouthOf(board) {
  const { emitter, cell } = board;
  const c = board.centre(emitter.r, emitter.c);
  // Just inside the board's own margin rather than a full cell out, so an emitter
  // on the bottom edge does not sit on top of the hint line.
  const off = cell * 0.5;
  if (emitter.d === E) return { x: c.x - off, y: c.y };
  if (emitter.d === W) return { x: c.x + off, y: c.y };
  if (emitter.d === S) return { x: c.x, y: c.y - off };
  return { x: c.x, y: c.y + off };
}

// Walks every beam from the emitter and reports the segments it travels and the
// crystals it lights. `(cell, direction)` pairs are remembered rather than
// cells, because a beam is allowed to cross its own path — it just may not
// re-enter a cell going the same way, which is the only shape a loop can take.
function trace(board) {
  const { grid, cols, rows, emitter } = board;
  const segments = [];
  const seen = new Set();
  const lit = new Set();

  const queue = [{ r: emitter.r, c: emitter.c, d: emitter.d, from: mouthOf(board) }];

  let guard = 0;
  while (queue.length && guard++ < 900) {
    const beam = queue.shift();
    let { r, c, d } = beam;
    let from = beam.from;

    while (r >= 0 && r < rows && c >= 0 && c < cols) {
      const key = `${r},${c},${d}`;
      if (seen.has(key)) break;
      seen.add(key);

      const centre = board.centre(r, c);
      const cell = grid[r][c];

      if (cell && cell.t === 'wall') {
        // Stops just short of the block, so the beam visibly hits something.
        segments.push({ x0: from.x, y0: from.y, x1: centre.x, y1: centre.y, dead: true });
        break;
      }

      segments.push({ x0: from.x, y0: from.y, x1: centre.x, y1: centre.y });
      from = centre;

      if (cell && cell.t === 'crystal') {
        lit.add(`${r},${c}`);
        break;
      }
      if (cell && cell.t === 'mirror') {
        d = (cell.or === 0 ? SLASH : BACKSLASH)[d];
      } else if (cell && cell.t === 'prism') {
        // Splits into the two directions across the way it came, and stops going
        // forwards — one beam in, two out, which is what makes it read as a
        // split rather than as a leak.
        const a = (d + 1) % 4;
        const b = (d + 3) % 4;
        queue.push({ r, c, d: a, from: centre });
        queue.push({ r, c, d: b, from: centre });
        break;
      }

      r += DR[d];
      c += DC[d];
    }
  }

  return { segments, lit };
}

// --- Generation -----------------------------------------------------------

function attemptBuild(cfg) {
  const { cols, rows } = cfg;
  const grid = Array.from({ length: rows }, () => Array(cols).fill(null));
  const used = new Set();
  const mirrors = [];
  const crystals = [];
  let turnsLeft = cfg.turns;
  let prismsLeft = cfg.prisms;

  // The emitter sits against one edge, firing inwards.
  const edge = randInt(4);
  let er, ec, ed;
  if (edge === W) { er = randInt(rows); ec = 0; ed = E; }
  else if (edge === E) { er = randInt(rows); ec = cols - 1; ed = W; }
  else if (edge === N) { er = 0; ec = randInt(cols); ed = S; }
  else { er = rows - 1; ec = randInt(cols); ed = N; }

  const free = (r, c) => r >= 0 && r < rows && c >= 0 && c < cols && !used.has(`${r},${c}`);
  // How far a beam could run from here in direction d before it leaves the grid
  // or meets something already placed.
  const runway = (r, c, d) => {
    let n = 0;
    let rr = r + DR[d];
    let cc = c + DC[d];
    while (free(rr, cc)) { n += 1; rr += DR[d]; cc += DC[d]; }
    return n;
  };

  const branches = [{ r: er, c: ec, d: ed }];
  used.add(`${er},${ec}`);

  while (branches.length) {
    const branch = branches.shift();
    let { r, c, d } = branch;
    let steps = 0;

    for (;;) {
      const here = grid[r][c];

      // Prism first: it ends this branch and starts two, so it is the only
      // choice that changes the shape of the puzzle rather than its length.
      if (!here && prismsLeft > 0 && steps > 0 && Math.random() < 0.4) {
        const a = (d + 1) % 4;
        const b = (d + 3) % 4;
        if (runway(r, c, a) >= 2 && runway(r, c, b) >= 2) {
          grid[r][c] = { t: 'prism' };
          prismsLeft -= 1;
          [a, b].forEach((nd) => {
            const nr = r + DR[nd];
            const nc = c + DC[nd];
            used.add(`${nr},${nc}`);
            branches.push({ r: nr, c: nc, d: nd });
          });
          break;
        }
      }

      if (!here && turnsLeft > 0 && steps > 0 && Math.random() < 0.55) {
        const options = [(d + 1) % 4, (d + 3) % 4].filter((nd) => runway(r, c, nd) >= 2);
        if (options.length) {
          const nd = pick(options);
          // The orientation that turns `d` into `nd`; one of the two always does.
          const or = SLASH[d] === nd ? 0 : 1;
          grid[r][c] = { t: 'mirror', or, solved: or };
          mirrors.push({ r, c });
          turnsLeft -= 1;
          d = nd;
        }
      }

      const nr = r + DR[d];
      const nc = c + DC[d];
      const canGo = free(nr, nc) && steps < cols + rows;

      if (!canGo) {
        // End of the line. The crystal goes on this cell if it is empty, and
        // otherwise the branch just stops — a branch without a crystal is
        // allowed, it simply lights nothing.
        if (!grid[r][c]) {
          grid[r][c] = { t: 'crystal' };
          crystals.push({ r, c });
        }
        break;
      }

      used.add(`${nr},${nc}`);
      r = nr;
      c = nc;
      steps += 1;
    }
  }

  // Decoys and blocks, only ever on cells the solution never touches.
  const spare = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (!used.has(`${r},${c}`)) spare.push([r, c]);
    }
  }
  for (let i = spare.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    [spare[i], spare[j]] = [spare[j], spare[i]];
  }
  let taken = 0;
  for (let i = 0; i < cfg.walls && taken < spare.length; i++, taken++) {
    const [r, c] = spare[taken];
    grid[r][c] = { t: 'wall' };
  }
  for (let i = 0; i < cfg.decoys && taken < spare.length; i++, taken++) {
    const [r, c] = spare[taken];
    const or = randInt(2);
    // A decoy has no correct side: `solved` is whatever it is, so the hint
    // button never points at one.
    grid[r][c] = { t: 'mirror', or, solved: or };
  }

  return {
    grid, cols, rows, mirrors, crystals,
    emitter: { r: er, c: ec, d: ed },
  };
}

function buildPuzzle(cfg, geoFor) {
  for (let attempt = 0; attempt < 60; attempt++) {
    const board = attemptBuild(cfg);
    if (!board.crystals.length || board.mirrors.length < 2) continue;

    // The verification the comment at the top promises: with every mirror on its
    // intended side, does the beam actually light everything?
    const probe = { ...board, ...geoFor(board) };
    const solved = trace(probe);
    if (solved.lit.size !== board.crystals.length) continue;

    // Scramble, then make sure the child has something left to do.
    for (let guard = 0; guard < 30; guard++) {
      board.mirrors.forEach(({ r, c }) => { board.grid[r][c].or = randInt(2); });
      if (board.mirrors.some(({ r, c }) => board.grid[r][c].or !== board.grid[r][c].solved)) break;
    }
    return board;
  }
  return null;
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
    meter: 'Kristallen',
  });

  stage = document.createElement('div');
  stage.className = 'mirror-stage';
  const canvas = document.createElement('canvas');
  canvas.className = 'mirror-canvas';
  const hint = document.createElement('div');
  hint.className = 'hint-line mirror-hint';
  hint.textContent = 'Tik op een spiegel om hem te kantelen';
  const helpBtn = document.createElement('button');
  helpBtn.className = 'key mirror-help';
  helpBtn.textContent = '💡';
  helpBtn.setAttribute('aria-label', 'Zet één spiegel goed');
  stage.append(canvas, hint, helpBtn);
  container.appendChild(stage);

  handle = setupCanvas(canvas, { alpha: false });
  const { ctx, toLogical } = handle;
  const backdrop = createStars(80);

  let board = null;
  let beams = { segments: [], lit: new Set() };
  let particles = [];
  let solved = false;
  let flash = 0;
  let t = 0;

  // Geometry is derived rather than stored, so the same puzzle can be laid out
  // again after a resize without being rebuilt.
  function geoFor(b) {
    const top = 168;
    const bottom = 96;
    const availW = LOGICAL_WIDTH - 200;
    const availH = LOGICAL_HEIGHT - top - bottom;
    const cell = Math.floor(Math.min(availW / b.cols, availH / b.rows));
    const x0 = Math.round((LOGICAL_WIDTH - cell * b.cols) / 2);
    const y0 = Math.round(top + (availH - cell * b.rows) / 2);
    const centre = (r, c) => ({ x: x0 + c * cell + cell / 2, y: y0 + r * cell + cell / 2 });
    return { cell, x0, y0, centre };
  }

  function applyGeo() {
    Object.assign(board, geoFor(board));
  }

  function retrace() {
    beams = trace(board);
    hud.setMeter(board.crystals.length ? beams.lit.size / board.crystals.length : 0);

    if (!solved && beams.lit.size === board.crystals.length) {
      solved = true;
      flash = 1;
      board.crystals.forEach((cr, i) => {
        const p = board.centre(cr.r, cr.c);
        later(() => {
          sfx.chime(i);
          particles.push(...createBurst(p.x, p.y, [mission.color, '#ffffff', '#ffc24a'], {
            count: 18, speed: 260,
          }));
        }, i * 190);
      });
      later(() => finishLevel(), 700 + board.crystals.length * 190);
    }
  }

  function startRound() {
    const cfg = LEVELS[Math.min(level, LEVELS.length) - 1];
    solved = false;
    particles = [];
    flash = 0;
    const built = buildPuzzle(cfg, geoFor);
    // Sixty attempts that all fail is a possibility the generator should not be
    // allowed to turn into a blank screen, so the easiest rung is the fallback.
    board = built || buildPuzzle(LEVELS[0], geoFor) || attemptBuild(LEVELS[0]);
    applyGeo();
    hud.setLevel(level);
    retrace();
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
      title: 'Alle kristallen stralen! 🪞',
      onNext: () => { reward = null; startRound(); },
      onRetry: () => { reward = null; level = cleared; startRound(); },
      onHome: onExit,
    });
  }

  // --- Drawing ------------------------------------------------------------

  function drawGrid() {
    const { cell, x0, y0, cols, rows } = board;
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.03)';
    roundRect(ctx, x0 - 14, y0 - 14, cell * cols + 28, cell * rows + 28, 28);
    ctx.fill();
    ctx.strokeStyle = 'rgba(232,217,176,0.2)';
    ctx.lineWidth = 3;
    ctx.stroke();

    ctx.strokeStyle = 'rgba(232,217,176,0.09)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let c = 1; c < cols; c++) {
      ctx.moveTo(x0 + c * cell, y0);
      ctx.lineTo(x0 + c * cell, y0 + rows * cell);
    }
    for (let r = 1; r < rows; r++) {
      ctx.moveTo(x0, y0 + r * cell);
      ctx.lineTo(x0 + cols * cell, y0 + r * cell);
    }
    ctx.stroke();
    ctx.restore();
  }

  function drawBeams() {
    const { cell } = board;
    ctx.save();
    ctx.lineCap = 'round';
    // Two passes: a wide soft one for the bloom and a narrow bright one on top,
    // which is a glow for the price of two strokes rather than a blur per bend.
    ctx.strokeStyle = 'rgba(255,194,74,0.16)';
    ctx.lineWidth = cell * 0.2;
    ctx.beginPath();
    beams.segments.forEach((s) => { ctx.moveTo(s.x0, s.y0); ctx.lineTo(s.x1, s.y1); });
    ctx.stroke();

    ctx.strokeStyle = solved ? '#fff6e5' : '#ffd479';
    ctx.lineWidth = Math.max(4, cell * 0.055);
    ctx.beginPath();
    beams.segments.forEach((s) => { ctx.moveTo(s.x0, s.y0); ctx.lineTo(s.x1, s.y1); });
    ctx.stroke();
    ctx.restore();
  }

  function drawEmitter() {
    const { emitter, cell } = board;
    const m = mouthOf(board);
    drawGlow(ctx, '#ffc24a', m.x, m.y, cell * 0.5, 0.9);
    ctx.save();
    ctx.translate(m.x, m.y);
    ctx.rotate([Math.PI * -0.5, 0, Math.PI * 0.5, Math.PI][emitter.d]);
    ctx.fillStyle = '#f3ece0';
    roundRect(ctx, -cell * 0.26, -cell * 0.17, cell * 0.34, cell * 0.34, cell * 0.08);
    ctx.fill();
    ctx.fillStyle = '#ffc24a';
    ctx.beginPath();
    ctx.moveTo(cell * 0.08, -cell * 0.1);
    ctx.lineTo(cell * 0.26, 0);
    ctx.lineTo(cell * 0.08, cell * 0.1);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function drawCells() {
    const { cell, rows, cols, grid } = board;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const item = grid[r][c];
        if (!item) continue;
        const p = board.centre(r, c);
        const s = cell * 0.34;

        if (item.t === 'mirror') {
          // The tappable thing, so it gets a face: a glass plate with a bright
          // reflective edge across it.
          ctx.save();
          ctx.fillStyle = 'rgba(255,255,255,0.05)';
          roundRect(ctx, p.x - cell * 0.42, p.y - cell * 0.42, cell * 0.84, cell * 0.84, cell * 0.14);
          ctx.fill();
          ctx.strokeStyle = 'rgba(232,217,176,0.22)';
          ctx.lineWidth = 2;
          ctx.stroke();

          const dx = item.or === 0 ? s : -s;
          ctx.strokeStyle = '#dfe8ff';
          ctx.lineWidth = Math.max(6, cell * 0.09);
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(p.x - dx, p.y + s);
          ctx.lineTo(p.x + dx, p.y - s);
          ctx.stroke();
          // The back of the mirror, so which side reflects is visible.
          ctx.strokeStyle = 'rgba(95,227,196,0.5)';
          ctx.lineWidth = Math.max(2, cell * 0.03);
          ctx.beginPath();
          ctx.moveTo(p.x - dx + dx * 0.12, p.y + s + s * 0.12);
          ctx.lineTo(p.x + dx + dx * 0.12, p.y - s + s * 0.12);
          ctx.stroke();
          ctx.restore();
        } else if (item.t === 'prism') {
          drawGlow(ctx, '#b98cff', p.x, p.y, cell * 0.45, 0.6);
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(Math.PI / 4);
          ctx.fillStyle = 'rgba(185,140,255,0.75)';
          roundRect(ctx, -s * 0.72, -s * 0.72, s * 1.44, s * 1.44, s * 0.2);
          ctx.fill();
          ctx.strokeStyle = '#e6d8ff';
          ctx.lineWidth = 3;
          ctx.stroke();
          ctx.restore();
        } else if (item.t === 'wall') {
          ctx.save();
          ctx.fillStyle = 'rgba(5,7,15,0.75)';
          roundRect(ctx, p.x - cell * 0.4, p.y - cell * 0.4, cell * 0.8, cell * 0.8, cell * 0.1);
          ctx.fill();
          ctx.strokeStyle = 'rgba(232,217,176,0.16)';
          ctx.lineWidth = 3;
          ctx.stroke();
          ctx.restore();
        } else {
          const isLit = beams.lit.has(`${r},${c}`);
          const pulse = isLit ? 1 + Math.sin(t * 6) * 0.06 : 1;
          drawGlow(ctx, isLit ? mission.color : '#6b6656', p.x, p.y, cell * 0.5, isLit ? 0.9 : 0.35);
          drawStar(ctx, p.x, p.y, cell * 0.26 * pulse, isLit ? '#fff6e5' : 'rgba(243,236,224,0.42)', 6);
        }
      }
    }
  }

  function draw(dt) {
    t += dt;
    if (flash > 0) flash = Math.max(0, flash - dt * 1.2);
    drawSpaceBackdrop(ctx, backdrop, t, { scrollSpeed: 2 });
    drawGrid();
    drawBeams();
    drawCells();
    drawEmitter();
    updateAndDrawParticles(ctx, particles, dt, { gravity: -20 });

    if (flash > 0) {
      ctx.save();
      ctx.fillStyle = withAlpha('#ffc24a', flash * 0.1);
      ctx.fillRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);
      ctx.restore();
    }
  }

  // --- Input --------------------------------------------------------------

  const cellAt = (p) => {
    const { cell, x0, y0, cols, rows } = board;
    const c = Math.floor((p.x - x0) / cell);
    const r = Math.floor((p.y - y0) / cell);
    if (r < 0 || r >= rows || c < 0 || c >= cols) return null;
    return { r, c };
  };

  const onDown = (e) => {
    if (solved) return;
    const hit = cellAt(toLogical(e.clientX, e.clientY));
    if (!hit) return;
    const item = board.grid[hit.r][hit.c];
    if (!item || item.t !== 'mirror') return;
    item.or = item.or === 0 ? 1 : 0;
    sfx.flip();
    retrace();
  };

  canvas.addEventListener('pointerdown', onDown);
  listeners.push(() => canvas.removeEventListener('pointerdown', onDown));

  // Unlimited, and free. A six-year-old who has run out of ideas on a
  // seven-mirror board should be able to ask rather than be stuck — the same
  // reasoning that lets Ladingcontrole's crew count the hold out loud on request
  // and that gives Sterrenpuzzel its ghosted preview.
  const offHelp = onTap(helpBtn, () => {
    if (solved) return;
    const wrong = board.mirrors.filter(({ r, c }) => board.grid[r][c].or !== board.grid[r][c].solved);
    if (!wrong.length) {
      sfx.blip();
      return;
    }
    const { r, c } = pick(wrong);
    board.grid[r][c].or = board.grid[r][c].solved;
    const p = board.centre(r, c);
    particles.push(...createBurst(p.x, p.y, ['#ffc24a', '#ffffff'], { count: 10, speed: 170 }));
    sfx.powerup();
    retrace();
  });
  listeners.push(offHelp);

  const onResize = () => {
    if (!board) return;
    applyGeo();
    retrace();
  };
  window.addEventListener('resize', onResize);
  listeners.push(() => window.removeEventListener('resize', onResize));

  startRound();

  let lastFrame = performance.now();
  function loop(now) {
    const dt = Math.min((now - lastFrame) / 1000, 0.05);
    lastFrame = now;
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
