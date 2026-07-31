import './style.css';
import { createHud, showMissionComplete } from '../../shared/ui-components.js';
import { sfx } from '../../shell/audio.js';
import { setLevel, starsForLevel } from '../../shell/progress.js';

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
let mission = null;
let reward = null;
let onExit = null;
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

  const puzzle = { grid, endpoints, cols, rows, totalCols };

  // A random scramble can deal a board that is already connected — a straight
  // pipe has two equivalent rotations, so on a short path the odds are far
  // from negligible — and the round would announce itself complete before the
  // child touched anything. Re-scramble until at least one network is open.
  for (let guard = 0; guard < 40; guard++) {
    if (!endpoints.every((e) => traceFlow(puzzle, e).solved)) break;
    for (let r = 0; r < rows; r++) {
      for (let c = 1; c <= cols; c++) {
        const tile = grid[r][c];
        if (!tile.locked) tile.rotation = (tile.rotation + randInt(1, 3)) % 4;
      }
    }
  }

  return puzzle;
}

function connsOf(tile) {
  return rotSet(BASE[tile.type], tile.rotation);
}

// Walks the oxygen from one source and reports which cells it fills, in the
// order it fills them, and whether it reached that network's drain. The order
// matters: it is what the finish animation follows to send the gas visibly down
// the pipe instead of lighting the whole run at once.
//
// `entry` is the side of the current tile the gas arrives through, so the tile
// must have a connection on exactly that side. Leaving a tile through `out`
// means entering the next one through OPP(out): flowing east lands on the next
// tile's west face.
function traceFlow(puzzle, endpoint) {
  const { grid, cols, totalCols } = puzzle;
  const path = [];
  let row = endpoint.sourceRow;
  let col = 1;
  let entry = DIR.W;
  const seen = new Set();

  while (col >= 1 && col <= cols && row >= 0 && row < puzzle.rows) {
    const key = `${row},${col}`;
    if (seen.has(key)) return { solved: false, path };
    seen.add(key);

    const conns = connsOf(grid[row][col]);
    if (!conns.includes(entry)) return { solved: false, path };

    path.push(key);
    const out = conns.find((d) => d !== entry);
    const [dr, dc] = VEC[out];
    row += dr;
    col += dc;
    entry = OPP(out);

    if (col === totalCols - 1) {
      return { solved: row === endpoint.drainRow && entry === DIR.W, path };
    }
  }
  return { solved: false, path };
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
  mission = { title: opts.title, icon: opts.icon, color: opts.color };
  onExit = opts.onExit;
  reward = null;
  listeners = [];
  timers = [];

  // The pressure meter is the one readout this puzzle can offer: it climbs as
  // the gas gets further along the run, so a child watching the bar sees they
  // are making progress before the tank ever fills.
  hud = createHud(container, {
    title: opts.title,
    onExit: opts.onExit,
    level,
    meter: 'Druk',
  });

  stage = document.createElement('div');
  stage.className = 'pipe-stage';
  container.appendChild(stage);

  startRound();
}

function startRound() {
  // The previous round's tiles are about to be thrown away; drop their
  // listeners too so nothing accumulates as the levels roll by.
  listeners.forEach((off) => off());
  listeners = [];

  const cfg = LEVELS[Math.min(level, LEVELS.length) - 1];
  hud.setLevel(level);

  const puzzle = buildPuzzle(cfg);
  const { rows, totalCols } = puzzle;

  const grid = document.createElement('div');
  grid.className = 'pipe-grid';

  // Fit tiles to whatever room is left after the HUD and hint strip, and
  // refit on resize — a laptop driving the board can change size when the
  // window goes fullscreen.
  const fit = () => {
    const availW = window.innerWidth * 0.88;
    const availH = window.innerHeight * 0.62;
    const tile = Math.floor(Math.min(availW / totalCols, availH / rows));
    grid.style.gridTemplateColumns = `repeat(${totalCols}, ${tile}px)`;
    grid.style.gridTemplateRows = `repeat(${rows}, ${tile}px)`;
  };
  fit();
  window.addEventListener('resize', fit);
  listeners.push(() => window.removeEventListener('resize', fit));

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
            // The board is frozen while the oxygen runs through, so a child
            // cannot rotate a pipe out from under the gas.
            if (done) return;
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

  stage.replaceChildren(grid, hint);

  let done = false;

  // How many tiles the carved run is long, so the pressure meter measures the
  // gas against the route it actually has to cover rather than the board size.
  let carved = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 1; c <= puzzle.cols; c++) {
      if (puzzle.grid[r][c].solved !== null) carved += 1;
    }
  }

  function evaluate() {
    if (done) return;
    const results = puzzle.endpoints.map((e) => traceFlow(puzzle, e));

    if (results.every((r) => r.solved)) {
      done = true;
      hud.setMeter(1);
      runFlow(results);
      return;
    }

    // Work in progress: light the run as far as the gas actually gets, which is
    // the clue a child reads to find the tile that broke the chain.
    const wetAll = new Set();
    results.forEach((res) => res.path.forEach((k) => wetAll.add(k)));
    tileEls.forEach((el, key) => el.classList.toggle('is-wet', wetAll.has(key)));
    hud.setMeter(carved ? wetAll.size / carved : 0);
    // On a two-network board one side can be finished while the other is not,
    // and lighting that tank is how a child knows to leave it alone.
    results.forEach((res, i) => {
      const e = puzzle.endpoints[i];
      tileEls.get(`${e.sourceRow},0`)?.classList.toggle('is-wet', res.path.length > 0);
      tileEls.get(`${e.drainRow},${totalCols - 1}`)?.classList.toggle('is-wet', res.solved);
    });
  }

  // The payoff: rather than the whole pipe turning teal the instant the last
  // tile lines up, the oxygen sets off from the tap and travels tile by tile to
  // the tank, with a rising note at each junction. It is the moment the child
  // built, so it is worth showing rather than asserting.
  function runFlow(results) {
    const paths = results.map((res, i) => [
      `${puzzle.endpoints[i].sourceRow},0`,
      ...res.path,
      `${puzzle.endpoints[i].drainRow},${totalCols - 1}`,
    ]);

    tileEls.forEach((el) => el.classList.remove('is-wet'));
    sfx.flow();

    const STEP = 95;
    let longest = 0;
    paths.forEach((path, net) => {
      longest = Math.max(longest, path.length);
      path.forEach((key, i) => {
        later(() => {
          const el = tileEls.get(key);
          if (!el) return;
          el.classList.add('is-wet', 'is-surging');
          later(() => el.classList.remove('is-surging'), 300);
          // One network sings the scale; a second one would only muddy it.
          if (net === 0) sfx.chime(i);
        }, i * STEP);
      });
    });

    later(() => finishRound(), longest * STEP + 260);
  }

  evaluate();
}

function finishRound() {
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
    title: 'Zuurstof stroomt! 💨',
    onNext: () => startRound(),
    onRetry: () => { level = cleared; hud.setLevel(level); startRound(); },
    onHome: onExit,
  });
}

export function destroy() {
  timers.forEach(clearTimeout);
  timers = [];
  listeners.forEach((off) => off());
  listeners = [];
  reward?.close();
  reward = null;
  hud?.destroy();
  hud = null;
  stage = null;
}
