import './style.css';
import { createGameChrome } from '../../shared/ui-components.js';
import { sfx } from '../../shell/audio.js';

const ROWS = 4;
const INTERIOR_COLS = 3;
const TOTAL_COLS = INTERIOR_COLS + 2;
const SOURCE_COL = 0;
const DRAIN_COL = TOTAL_COLS - 1;

// Direction encoding: N=0, E=1, S=2, W=3 (clockwise), matching CSS rotate().
const DIR_VECTOR = { 0: [-1, 0], 1: [0, 1], 2: [1, 0], 3: [0, -1] };
const OPPOSITE = (d) => (d + 2) % 4;
const BASE_CONNECTIONS = { straight: [0, 2], elbow: [0, 1] };

let stage, cleanupFns = [];

function rotateSet(base, rotation) {
  return base.map((d) => (d + rotation) % 4);
}

function rotationForConnections(type, wantedSet) {
  const base = BASE_CONNECTIONS[type];
  for (let k = 0; k < 4; k++) {
    const rotated = rotateSet(base, k);
    if (wantedSet.every((d) => rotated.includes(d)) && rotated.every((d) => wantedSet.includes(d))) {
      return k;
    }
  }
  return 0;
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function generatePuzzle() {
  const sourceRow = randomInt(0, ROWS - 1);
  const drainRow = randomInt(0, ROWS - 1);

  // grid[row][col] holds interior tile data; col indices 1..INTERIOR_COLS map to columns 1..INTERIOR_COLS
  const grid = Array.from({ length: ROWS }, () => Array(TOTAL_COLS).fill(null));

  let currentRow = sourceRow;
  for (let c = 1; c <= INTERIOR_COLS; c++) {
    const isLastInterior = c === INTERIOR_COLS;
    const nextRow = isLastInterior ? drainRow : Math.max(0, Math.min(ROWS - 1, currentRow + randomInt(-1, 1)));

    if (nextRow === currentRow) {
      // Pass straight through: enters from West, exits East.
      grid[currentRow][c] = { conns: [3, 1] };
    } else {
      const step = nextRow > currentRow ? 1 : -1;
      // Entry cell: from West, turns toward next row (South or North).
      const turnDir = step === 1 ? 2 : 0;
      grid[currentRow][c] = { conns: [3, turnDir] };
      // Intermediate straight-vertical cells.
      for (let r = currentRow + step; r !== nextRow; r += step) {
        grid[r][c] = { conns: [0, 2] };
      }
      // Exit cell: from vertical direction, turns East.
      const enterDir = step === 1 ? 0 : 2;
      grid[nextRow][c] = { conns: [enterDir, 1] };
    }
    currentRow = nextRow;
  }

  // Fill remaining interior cells with decoy tiles.
  for (let r = 0; r < ROWS; r++) {
    for (let c = 1; c <= INTERIOR_COLS; c++) {
      if (!grid[r][c]) {
        const type = Math.random() < 0.5 ? 'straight' : 'elbow';
        grid[r][c] = { type, rotation: randomInt(0, 3), decoy: true };
      } else {
        const conns = grid[r][c].conns;
        const type = (conns[0] === OPPOSITE(conns[1])) ? 'straight' : 'elbow';
        const solvedRotation = rotationForConnections(type, conns);
        grid[r][c] = { type, rotation: randomInt(0, 3), decoy: false, solvedRotation };
      }
    }
  }

  return { grid, sourceRow, drainRow };
}

function getTileConnections(tile) {
  return rotateSet(BASE_CONNECTIONS[tile.type], tile.rotation);
}

function checkFlow(puzzle) {
  const { grid, sourceRow, drainRow } = puzzle;
  let row = sourceRow;
  let col = SOURCE_COL + 1;
  let cameFromDir = 3; // entering first interior cell from the West
  const visited = new Set();
  const wetCells = [];

  while (col >= 1 && col <= INTERIOR_COLS && row >= 0 && row < ROWS) {
    const key = row + ',' + col;
    if (visited.has(key)) return { solved: false, wetCells };
    visited.add(key);

    const tile = grid[row][col];
    const conns = getTileConnections(tile);
    const neededIncoming = OPPOSITE(cameFromDir);
    if (!conns.includes(neededIncoming)) return { solved: false, wetCells };

    wetCells.push(key);
    const outDir = conns.find((d) => d !== neededIncoming);
    const [dr, dc] = DIR_VECTOR[outDir];
    row += dr;
    col += dc;
    cameFromDir = OPPOSITE(outDir);

    if (col === DRAIN_COL) {
      return { solved: row === drainRow && cameFromDir === 3, wetCells };
    }
  }
  return { solved: false, wetCells };
}

export function init(container, { title, onExit }) {
  cleanupFns = [];
  const chrome = createGameChrome({ title, onExit });
  stage = document.createElement('div');
  stage.className = 'ld-stage';
  container.appendChild(chrome);
  container.appendChild(stage);
  startRound();
}

function pipeSvg(type) {
  if (type === 'straight') {
    return `<svg class="ld-tile-pipe" viewBox="0 0 100 100"><rect class="ld-pipe-fill" x="42" y="0" width="16" height="100" fill="#b9c2e0"/></svg>`;
  }
  return `<svg class="ld-tile-pipe" viewBox="0 0 100 100"><path class="ld-pipe-fill" d="M42,0 L58,0 L58,42 L100,42 L100,58 L42,58 Z" fill="#b9c2e0"/></svg>`;
}

function startRound() {
  const puzzle = generatePuzzle();

  const hint = document.createElement('div');
  hint.className = 'ld-hint';
  hint.textContent = 'Draai de tegels zodat het water kan stromen! 🔧';

  const grid = document.createElement('div');
  grid.className = 'ld-grid';
  grid.style.gridTemplateColumns = `repeat(${TOTAL_COLS}, 120px)`;
  grid.style.gridTemplateRows = `repeat(${ROWS}, 120px)`;

  const tileEls = [];
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < TOTAL_COLS; c++) {
      const tileEl = document.createElement('div');
      tileEl.className = 'ld-tile';
      if (c === SOURCE_COL) {
        if (r === puzzle.sourceRow) {
          tileEl.classList.add('source');
          tileEl.innerHTML = '🚿';
          tileEl.style.display = 'flex';
          tileEl.style.alignItems = 'center';
          tileEl.style.justifyContent = 'center';
          tileEl.style.fontSize = '2.5rem';
        }
      } else if (c === DRAIN_COL) {
        if (r === puzzle.drainRow) {
          tileEl.classList.add('drain');
          tileEl.innerHTML = '🪣';
          tileEl.style.display = 'flex';
          tileEl.style.alignItems = 'center';
          tileEl.style.justifyContent = 'center';
          tileEl.style.fontSize = '2.5rem';
        }
      } else {
        const tile = puzzle.grid[r][c];
        tileEl.innerHTML = pipeSvg(tile.type);
        const pipeEl = tileEl.querySelector('.ld-tile-pipe');
        pipeEl.style.transform = `rotate(${tile.rotation * 90}deg)`;
        const onRotate = () => {
          tile.rotation = (tile.rotation + 1) % 4;
          pipeEl.style.transform = `rotate(${tile.rotation * 90}deg)`;
          sfx.click();
          evaluate();
        };
        tileEl.addEventListener('pointerup', onRotate);
        tileEl._tile = tile;
      }
      grid.appendChild(tileEl);
      tileEls.push(tileEl);
    }
  }

  stage.replaceChildren(hint, grid);

  function evaluate() {
    const { solved, wetCells } = checkFlow(puzzle);
    const wetSet = new Set(wetCells);
    tileEls.forEach((el, i) => {
      const r = Math.floor(i / TOTAL_COLS);
      const c = i % TOTAL_COLS;
      el.classList.toggle('wet', wetSet.has(r + ',' + c));
    });
    if (solved) celebrate();
  }

  evaluate();
}

function celebrate() {
  sfx.celebrate();
  const toast = document.createElement('div');
  toast.className = 'confirm-toast visible';
  toast.style.position = 'absolute';
  toast.style.bottom = '2rem';
  toast.style.left = '50%';
  toast.style.transform = 'translateX(-50%)';
  toast.textContent = 'Het water stroomt! 🎉';
  stage.appendChild(toast);
  setTimeout(() => {
    toast.remove();
    startRound();
  }, 1500);
}

export function destroy() {
  cleanupFns.forEach((fn) => fn());
  cleanupFns = [];
}
