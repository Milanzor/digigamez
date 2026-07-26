import './style.css';
import { createHud } from '../../shared/ui-components.js';
import { sfx } from '../../shell/audio.js';
import { setLevel } from '../../shell/progress.js';
import { setChildren } from '../../shared/dom.js';

// "Zuurstofleidingen" — rotate the pipe tiles so oxygen reaches the tank.
//
// Puzzles are generated solvable-by-construction: a path is walked from the
// source column to the drain column first, and only then are the tiles
// scrambled, so a solution always exists.
//
// Depth: the grid grows with the level, and from level 4 there are two
// independent networks to complete on one board (generated in separate row
// bands so they can never collide).

// Directions, clockwise: N=0 E=1 S=2 W=3. Matches CSS rotate() order.
const DIR = { N: 0, E: 1, S: 2, W: 3 };
const VEC = { 0: [-1, 0], 1: [0, 1], 2: [1, 0], 3: [0, -1] };
const OPP = (d) => (d + 2) % 4;
const BASE = { straight: [DIR.N, DIR.S], elbow: [DIR.N, DIR.E] };

const LEVELS = [
  { cols: 3, rows: 3, nets: 1 },
  { cols: 4, rows: 3, nets: 1 },
  { cols: 4, rows: 4, nets: 1 },
  { cols: 5, rows: 4, nets: 2 },
  { cols: 5, rows: 5, nets: 2 },
  { cols: 6, rows: 6, nets: 2 },
];

let hud = null;
let stage = null;
let level = 1;
let slug = 'leidingen';
let listeners = [];
let timers = [];

const rotSet = (base, rot) => base.map((d) => (d + rot) % 4);
const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

function later(fn, ms) {
  const id = setTimeout(fn, ms);
  timers.push(id);
  return id;
}

// Which rotation of `type` produces exactly the wanted connection pair?
function rotationFor(type, wanted) {
  for (let r = 0; r < 4; r++) {
    const s = rotSet(BASE[type], r);
    if (wanted.every((d) => s.includes(d)) && s.every((d) => wanted.includes(d))) return r;
  }
  return 0;
}

function typeFor(conns) {
  return conns[0] === OPP(conns[1]) ? 'straight' : 'elbow';
}

// Walks a path from the source column across every interior column, staying
// inside [rowStart, rowEnd]. Returns the tiles it laid down.
function carvePath(grid, cols, rowStart, rowEnd) {
  const sourceRow = randInt(rowStart, rowEnd);
  const drainRow = randInt(rowStart, rowEnd);
  let row = sourceRow;

  for (let c = 1; c <= cols; c++) {
    const isLast = c === cols;
    const nextRow = isLast
      ? drainRow
      : Math.max(rowStart, Math.min(rowEnd, row + randInt(-1, 1)));

    if (nextRow === row) {
      grid[row][c] = { conns: [DIR.W, DIR.E] };
    } else {
      const step = nextRow > row ? 1 : -1;
      grid[row][c] = { conns: [DIR.W, step === 1 ? DIR.S : DIR.N] };
      for (let r = row + step; r !== nextRow; r += step) {
        grid[r][c] = { conns: [DIR.N, DIR.S] };
      }
      grid[nextRow][c] = { conns: [step === 1 ? DIR.N : DIR.S, DIR.E] };
    }
    row = nextRow;
  }
  return { sourceRow, drainRow };
}

function buildPuzzle(cfg) {
  const { cols, rows, nets } = cfg;
  const totalCols = cols + 2;
  const grid = Array.from({ length: rows }, () => Array(totalCols).fill(null));
  const endpoints = [];

  if (nets === 1) {
    endpoints.push(carvePath(grid, cols, 0, rows - 1));
  } else {
    const mid = Math.floor(rows / 2);
    endpoints.push(carvePath(grid, cols, 0, mid - 1));
    endpoints.push(carvePath(grid, cols, mid, rows - 1));
  }

  // Convert carved connection pairs into rotatable tiles, then scramble.
  for (let r = 0; r < rows; r++) {
    for (let c = 1; c <= cols; c++) {
      const cell = grid[r][c];
      if (cell) {
        const type = typeFor(cell.conns);
        grid[r][c] = {
          type,
          rotation: randInt(0, 3),
          solved: rotationFor(type, cell.conns),
          locked: false,
        };
      } else {
        // Decoy tile. From level 3 some decoys are welded shut so the board
        // reads as real machinery rather than a uniform field of knobs.
        const type = Math.random() < 0.5 ? 'straight' : 'elbow';
        grid[r][c] = {
          type,
          rotation: randInt(0, 3),
          solved: null,
          locked: level >= 3 && Math.random() < 0.25,
        };
      }
    }
  }

  return { grid, endpoints, cols, rows, totalCols };
}

function connsOf(tile) {
  return rotSet(BASE[tile.type], tile.rotation);
}

// Walks the oxygen from one source and reports which cells it fills and
// whether it reached that network's drain.
function traceFlow(puzzle, endpoint) {
  const { grid, cols, totalCols } = puzzle;
  const wet = new Set();
  let row = endpoint.sourceRow;
  let col = 1;
  let from = DIR.W;
  const seen = new Set();

  while (col >= 1 && col <= cols && row >= 0 && row < puzzle.rows) {
    const key = `${row},${col}`;
    if (seen.has(key)) return { solved: false, wet };
    seen.add(key);

    const conns = connsOf(grid[row][col]);
    const incoming = OPP(from);
    if (!conns.includes(incoming)) return { solved: false, wet };

    wet.add(key);
    const out = conns.find((d) => d !== incoming);
    const [dr, dc] = VEC[out];
    row += dr;
    col += dc;
    from = OPP(out);

    if (col === totalCols - 1) {
      return { solved: row === endpoint.drainRow && from === DIR.W, wet };
    }
  }
  return { solved: false, wet };
}

function pipeSvg(type) {
  if (type === 'straight') {
    return `<svg viewBox="0 0 100 100"><rect class="pipe-pipe" x="41" y="-1" width="18" height="102" rx="4"/></svg>`;
  }
  return `<svg viewBox="0 0 100 100"><path class="pipe-pipe" d="M41,-1 h18 V41 h42 v18 H41 Z"/></svg>`;
}

export function init(container, opts) {
  slug = opts.slug;
  level = opts.startLevel || 1;
  listeners = [];
  timers = [];

  hud = createHud(container, { title: opts.title, onExit: opts.onExit, level });

  stage = document.createElement('div');
  stage.className = 'pipe-stage';
  container.appendChild(stage);

  startRound();
}

function startRound() {
  const cfg = LEVELS[Math.min(level, LEVELS.length) - 1];
  hud.setLevel(level);

  const puzzle = buildPuzzle(cfg);
  const { rows, totalCols } = puzzle;

  // Fit tiles to whatever room is left after the HUD and hint strip.
  const availW = window.innerWidth * 0.88;
  const availH = window.innerHeight * 0.62;
  const tile = Math.floor(Math.min(availW / totalCols, availH / rows));

  const grid = document.createElement('div');
  grid.className = 'pipe-grid';
  grid.style.gridTemplateColumns = `repeat(${totalCols}, ${tile}px)`;
  grid.style.gridTemplateRows = `repeat(${rows}, ${tile}px)`;

  const hint = document.createElement('div');
  hint.className = 'hint-strip';
  hint.textContent = cfg.nets === 2
    ? 'Tik om te draaien — er zijn twee leidingen!'
    : 'Tik op een buis om hem te draaien';

  const sourceRows = new Set(puzzle.endpoints.map((e) => e.sourceRow));
  const drainRows = new Set(puzzle.endpoints.map((e) => e.drainRow));

  const tileEls = new Map();

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < totalCols; c++) {
      const el = document.createElement('div');
      el.className = 'pipe-tile';

      if (c === 0) {
        if (sourceRows.has(r)) {
          el.classList.add('pipe-tile--endpoint', 'pipe-tile--source');
          el.textContent = '💨';
        } else {
          el.style.visibility = 'hidden';
        }
      } else if (c === totalCols - 1) {
        if (drainRows.has(r)) {
          el.classList.add('pipe-tile--endpoint', 'pipe-tile--drain');
          el.textContent = '🫙';
        } else {
          el.style.visibility = 'hidden';
        }
      } else {
        const tileData = puzzle.grid[r][c];
        if (tileData.locked) el.classList.add('is-locked');
        el.innerHTML = `<div class="pipe-tile__art">${pipeSvg(tileData.type)}</div>`;
        const art = el.querySelector('.pipe-tile__art');
        art.style.transform = `rotate(${tileData.rotation * 90}deg)`;

        if (!tileData.locked) {
          const onTap = () => {
            tileData.rotation = (tileData.rotation + 1) % 4;
            art.style.transform = `rotate(${tileData.rotation * 90}deg)`;
            sfx.blip();
            evaluate();
          };
          el.addEventListener('pointerup', onTap);
          listeners.push(() => el.removeEventListener('pointerup', onTap));
        }
      }

      tileEls.set(`${r},${c}`, el);
      grid.appendChild(el);
    }
  }

  setChildren(stage, grid, hint);

  let done = false;

  function evaluate() {
    const results = puzzle.endpoints.map((e) => traceFlow(puzzle, e));
    const wetAll = new Set();
    results.forEach((res) => res.wet.forEach((k) => wetAll.add(k)));

    tileEls.forEach((el, key) => el.classList.toggle('is-wet', wetAll.has(key)));

    // Light the endpoints of any network that is fully connected.
    results.forEach((res, i) => {
      const e = puzzle.endpoints[i];
      tileEls.get(`${e.sourceRow},0`)?.classList.toggle('is-wet', res.wet.size > 0);
      tileEls.get(`${e.drainRow},${totalCols - 1}`)?.classList.toggle('is-wet', res.solved);
    });

    if (!done && results.every((r) => r.solved)) {
      done = true;
      finishRound();
    }
  }

  evaluate();
}

function finishRound() {
  sfx.flow();
  later(() => sfx.missionComplete(), 350);
  level += 1;
  setLevel(slug, level);
  hud.banner('Zuurstof stroomt! 💨', { sub: `Level ${level} vrijgespeeld`, ms: 2000 });
  later(startRound, 2100);
}

export function destroy() {
  timers.forEach(clearTimeout);
  timers = [];
  listeners.forEach((off) => off());
  listeners = [];
  hud?.destroy();
  hud = null;
  stage = null;
}
