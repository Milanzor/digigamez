import './style.css';
import { createHud } from '../../shared/ui-components.js';
import { sfx } from '../../shell/audio.js';
import { getItem, setItem } from '../../shell/storage.js';

// "Sterrenorkest" — a step sequencer as a toy.
//
// The third open-ended game, next to Ruimtetekenen and de Gekke Machine: no
// levels, no target, and it keeps its loop between visits the way the drawing
// board keeps its strokes. Two children can build at the same time, because
// switching a cell on is one tap and the board takes ten fingers.
//
// Every row is pinned to a note of the same pentatonic ladder the rest of the
// bundle uses, so whatever combination of cells gets switched on, the loop
// comes out consonant. That is the whole reason this game is cheap here: there
// is no way to compose something that sounds wrong.

// Eight steps and seven rows, not the sixteen a grown-up sequencer would have:
// the cells have to stay big enough for a three-year-old's finger on a board
// this size, and a short loop is easier to hear yourself change.
const STEPS = 8;
const SAVE_KEY = 'sterrenorkest';

// Four instrument families, top to bottom, high to low — the same way a score
// is laid out, and it means a rising melody is a rising line on the board.
const ROWS = [
  { family: 'bel', icon: '🔔', color: '#5fe3c4', play: () => sfx.chime(7) },
  { family: 'bel', icon: '🔔', color: '#5fe3c4', play: () => sfx.chime(5) },
  { family: 'bel', icon: '🔔', color: '#5fe3c4', play: () => sfx.chime(3) },
  { family: 'blub', icon: '💧', color: '#8fd6ff', play: () => sfx.blub(4) },
  { family: 'blub', icon: '💧', color: '#8fd6ff', play: () => sfx.blub(1) },
  { family: 'trom', icon: '🥁', color: '#b98cff', play: () => sfx.drum(0) },
  { family: 'bas', icon: '🎸', color: '#7ee787', play: () => sfx.bass(0) },
];

const TEMPOS = [
  { id: 'traag', icon: '🐢', ms: 440 },
  { id: 'gewoon', icon: '🚶', ms: 320 },
  { id: 'snel', icon: '🐇', ms: 220 },
];

let hud = null;
let stage = null;
let raf = null;
let listeners = [];
let saveTimer = null;

export function init(container, opts) {
  listeners = [];

  hud = createHud(container, {
    title: opts.title,
    onExit: opts.onExit,
  });

  stage = document.createElement('div');
  stage.className = 'orc-stage';

  const hint = document.createElement('div');
  hint.className = 'hint-strip orc-hint';
  hint.textContent = 'Tik vakjes aan en druk op ▶ — samen bouwen mag';

  const board = document.createElement('div');
  board.className = 'orc-board';

  const labels = document.createElement('div');
  labels.className = 'orc-labels';
  labels.style.gridTemplateRows = `repeat(${ROWS.length}, 1fr)`;
  labels.append(...ROWS.map((row) => {
    const el = document.createElement('div');
    el.className = 'orc-label';
    el.style.setProperty('--row-color', row.color);
    el.textContent = row.icon;
    return el;
  }));

  const cellsWrap = document.createElement('div');
  cellsWrap.className = 'orc-cells';
  const grid = document.createElement('div');
  grid.className = 'orc-grid';
  grid.style.gridTemplateColumns = `repeat(${STEPS}, 1fr)`;
  grid.style.gridTemplateRows = `repeat(${ROWS.length}, 1fr)`;

  // Pattern: one bitmask per step, so the whole loop saves as sixteen small
  // numbers — nothing to compress, nothing to migrate.
  const saved = getItem(SAVE_KEY, null);
  const pattern = Array.from({ length: STEPS }, (_, i) => (
    Array.isArray(saved) && Number.isInteger(saved[i]) ? saved[i] : 0
  ));

  const cells = [];
  for (let r = 0; r < ROWS.length; r++) {
    for (let s = 0; s < STEPS; s++) {
      const cell = document.createElement('button');
      cell.className = 'orc-cell';
      // Every fourth column reads a shade lighter, which is what lets a child
      // find "the beat" without anybody explaining bars to them.
      if (s % 4 === 0) cell.classList.add('is-downbeat');
      if (pattern[s] & (1 << r)) cell.classList.add('is-on');
      cell.style.setProperty('--row-color', ROWS[r].color);
      cell.style.gridColumn = String(s + 1);
      cell.style.gridRow = String(r + 1);
      cell.dataset.row = String(r);
      cell.dataset.step = String(s);
      cell.setAttribute('aria-label', `${ROWS[r].family} stap ${s + 1}`);
      grid.appendChild(cell);
      cells.push(cell);
    }
  }

  const head = document.createElement('div');
  head.className = 'orc-head';
  head.style.width = `${100 / STEPS}%`;
  cellsWrap.append(grid, head);
  board.append(labels, cellsWrap);

  // --- transport ---------------------------------------------------------

  const bar = document.createElement('div');
  bar.className = 'orc-bar';

  const playBtn = document.createElement('button');
  playBtn.className = 'orc-key orc-key--go';
  playBtn.setAttribute('aria-label', 'Speel de lus af');
  playBtn.textContent = '▶';

  let tempoIndex = 1;
  const tempoBtn = document.createElement('button');
  tempoBtn.className = 'orc-key';
  tempoBtn.setAttribute('aria-label', 'Sneller of langzamer');
  tempoBtn.textContent = TEMPOS[tempoIndex].icon;

  const diceBtn = document.createElement('button');
  diceBtn.className = 'orc-key';
  diceBtn.setAttribute('aria-label', 'Verzin een lus');
  diceBtn.textContent = '🎲';

  const clearBtn = document.createElement('button');
  clearBtn.className = 'orc-key';
  clearBtn.setAttribute('aria-label', 'Alles wissen');
  clearBtn.textContent = '🧹';

  bar.append(playBtn, tempoBtn, diceBtn, clearBtn);
  stage.append(hint, board, bar);
  container.appendChild(stage);

  // --- state -------------------------------------------------------------

  let playing = false;
  let step = 0;
  let acc = 0;
  let litCells = [];

  const cellAt = (row, s) => cells[row * STEPS + s];

  function save() {
    clearTimeout(saveTimer);
    // Debounced: two children tapping fast would otherwise write to
    // localStorage dozens of times a second for no benefit.
    saveTimer = setTimeout(() => setItem(SAVE_KEY, pattern), 400);
  }

  function setCell(row, s, on) {
    if (on) pattern[s] |= (1 << row);
    else pattern[s] &= ~(1 << row);
    cellAt(row, s).classList.toggle('is-on', on);
  }

  function repaint() {
    for (let r = 0; r < ROWS.length; r++) {
      for (let s = 0; s < STEPS; s++) {
        cellAt(r, s).classList.toggle('is-on', Boolean(pattern[s] & (1 << r)));
      }
    }
  }

  const onGrid = (e) => {
    const cell = e.target.closest('.orc-cell');
    if (!cell) return;
    const row = Number(cell.dataset.row);
    const s = Number(cell.dataset.step);
    const on = !(pattern[s] & (1 << row));
    setCell(row, s, on);
    // Switching a cell on plays it straight away, so the board answers a tap
    // even while the loop is stopped.
    if (on) ROWS[row].play();
    else sfx.blip();
    save();
  };
  grid.addEventListener('pointerup', onGrid);

  function playStep(index) {
    litCells.forEach((c) => c.classList.remove('is-hit'));
    litCells = [];
    head.style.transform = `translateX(${index * 100}%)`;
    for (let r = 0; r < ROWS.length; r++) {
      if (!(pattern[index] & (1 << r))) continue;
      ROWS[r].play();
      const cell = cellAt(r, index);
      cell.classList.add('is-hit');
      litCells.push(cell);
    }
  }

  function setPlaying(value) {
    playing = value;
    playBtn.textContent = playing ? '⏸' : '▶';
    playBtn.classList.toggle('is-running', playing);
    head.classList.toggle('is-visible', playing);
    if (playing) {
      acc = 0;
      step = 0;
      playStep(0);
    } else {
      litCells.forEach((c) => c.classList.remove('is-hit'));
      litCells = [];
    }
  }

  const onPlay = () => {
    setPlaying(!playing);
    sfx.select();
  };

  const onTempo = () => {
    tempoIndex = (tempoIndex + 1) % TEMPOS.length;
    tempoBtn.textContent = TEMPOS[tempoIndex].icon;
    sfx.blip();
  };

  // A loop the machine invents: bass and drum on the beat, bells and blubs
  // sprinkled around them. It is a starting point to change, not a demo.
  const onDice = () => {
    for (let s = 0; s < STEPS; s++) pattern[s] = 0;
    const BASS = ROWS.length - 1;
    const DRUM = ROWS.length - 2;
    for (let s = 0; s < STEPS; s++) {
      if (s % 4 === 0) pattern[s] |= (1 << BASS);
      if (s % 4 === 2) pattern[s] |= (1 << DRUM);
      if (Math.random() < 0.34) pattern[s] |= (1 << Math.floor(Math.random() * 3));
      if (Math.random() < 0.2) pattern[s] |= (1 << (3 + Math.floor(Math.random() * 2)));
    }
    repaint();
    save();
    sfx.powerup();
    if (!playing) setPlaying(true);
  };

  const onClear = () => {
    for (let s = 0; s < STEPS; s++) pattern[s] = 0;
    repaint();
    save();
    sfx.back();
  };

  playBtn.addEventListener('pointerup', onPlay);
  tempoBtn.addEventListener('pointerup', onTempo);
  diceBtn.addEventListener('pointerup', onDice);
  clearBtn.addEventListener('pointerup', onClear);

  // The clock is the shared render loop rather than a setInterval: an interval
  // drifts against the frames, and the playhead would visibly stutter.
  let last = performance.now();
  function loop(now) {
    const dt = now - last;
    last = now;
    if (playing) {
      acc += dt;
      const interval = TEMPOS[tempoIndex].ms;
      while (acc >= interval) {
        acc -= interval;
        step = (step + 1) % STEPS;
        playStep(step);
      }
    }
    raf = requestAnimationFrame(loop);
  }
  raf = requestAnimationFrame(loop);

  listeners.push(() => {
    grid.removeEventListener('pointerup', onGrid);
    playBtn.removeEventListener('pointerup', onPlay);
    tempoBtn.removeEventListener('pointerup', onTempo);
    diceBtn.removeEventListener('pointerup', onDice);
    clearBtn.removeEventListener('pointerup', onClear);
  });

  // Leaving the room should not lose the loop, and the debounce may still be
  // pending when the child presses ◀.
  listeners.push(() => {
    clearTimeout(saveTimer);
    saveTimer = null;
    setItem(SAVE_KEY, pattern);
  });
}

export function destroy() {
  if (raf) cancelAnimationFrame(raf);
  raf = null;
  listeners.forEach((off) => off());
  listeners = [];
  hud?.destroy();
  hud = null;
  stage = null;
}
