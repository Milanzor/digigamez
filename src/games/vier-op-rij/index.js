import './style.css';
import { createHud, showMissionComplete } from '../../shared/ui-components.js';
import { sfx } from '../../shell/audio.js';
import { setLevel, starsForLevel } from '../../shell/progress.js';

// "Sterrenrij" — drop planets down a column and stack them four in a row.
//
// The gap this fills: nothing else in the archive has two children *thinking*
// against each other. Every other head-to-head mission is reaction or aim, and
// a five-year-old who has outgrown those still has nowhere to go.
//
// The board scales all the way down to three-in-a-row on 3x3, which is the
// whole trick that makes one game cover 5 to 7 — and, honestly, a four-year-old
// too. A small board is not a watered-down version of this game; it is the same
// game with a horizon a small child can actually hold in their head.
//
// Alone you play the station computer. It is written to be beatable on purpose:
// it takes a win, blocks a loss, and otherwise leans towards the middle. From
// level 4 it also stops handing over a win on the very next move, which is the
// point where a child has to start looking one step further themselves.

const P1 = 0;
const P2 = 1;

let hud = null;
let stage = null;
let level = 1;
let slug = 'vier-op-rij';
let mission = null;
let reward = null;
let onExit = null;
let players = 1;
let listeners = [];
let timers = [];

function levelConfig(l) {
  const n = Math.max(1, l);
  if (n === 1) return { cols: 3, rows: 3, need: 3, lookahead: false };
  if (n === 2) return { cols: 5, rows: 4, need: 4, lookahead: false };
  if (n === 3) return { cols: 6, rows: 5, need: 4, lookahead: false };
  if (n === 4) return { cols: 7, rows: 6, need: 4, lookahead: true };
  return { cols: 7, rows: 6, need: 4, lookahead: true };
}

function later(fn, ms) {
  const id = setTimeout(fn, ms);
  timers.push(id);
  return id;
}

export function init(container, opts) {
  slug = opts.slug;
  level = Math.max(1, opts.startLevel || 1);
  players = opts.players || 1;
  mission = { title: opts.title, icon: opts.icon, color: opts.color };
  onExit = opts.onExit;
  reward = null;
  listeners = [];
  timers = [];

  hud = createHud(container, {
    title: opts.title,
    onExit: opts.onExit,
    level,
    players: 2,
    showScore: true,
    showTurn: players > 1,
  });

  stage = document.createElement('div');
  stage.className = 'rij-stage';
  container.appendChild(stage);

  startRound([0, 0]);
}

function startRound(scores) {
  const cfg = levelConfig(level);
  hud.setLevel(level);
  hud.setScore(0, scores[0]);
  hud.setScore(1, scores[1]);

  // board[c][r], r counted from the bottom so gravity is just "first empty".
  const board = Array.from({ length: cfg.cols }, () => Array(cfg.rows).fill(null));
  let turn = P1;
  let over = false;
  let busy = false;

  stage.replaceChildren();

  const wrap = document.createElement('div');
  wrap.className = 'rij-wrap';
  wrap.style.setProperty('--cols', String(cfg.cols));
  wrap.style.setProperty('--rows', String(cfg.rows));

  // A row of full-height column buttons over the grid: aiming at a *column* is
  // the actual move, and a child aiming at one cell of it would otherwise miss.
  const drops = document.createElement('div');
  drops.className = 'rij-drops';
  for (let c = 0; c < cfg.cols; c++) {
    const btn = document.createElement('button');
    btn.className = 'rij-drop';
    btn.dataset.col = String(c);
    btn.setAttribute('aria-label', `Laat vallen in kolom ${c + 1}`);
    btn.innerHTML = '<span class="rij-drop__arrow">▾</span>';
    drops.appendChild(btn);
  }

  const grid = document.createElement('div');
  grid.className = 'rij-grid';
  const cellEls = [];
  // Rendered top row first, so the DOM order matches what is on screen.
  for (let r = cfg.rows - 1; r >= 0; r--) {
    for (let c = 0; c < cfg.cols; c++) {
      const cell = document.createElement('div');
      cell.className = 'rij-cell';
      grid.appendChild(cell);
      cellEls[c * cfg.rows + r] = cell;
    }
  }
  const cellAt = (c, r) => cellEls[c * cfg.rows + r];

  const hint = document.createElement('div');
  hint.className = 'hint-strip rij-hint';
  hint.textContent = cfg.need === 3
    ? 'Drie op een rij wint — recht of schuin'
    : 'Vier op een rij wint — recht of schuin';

  wrap.append(drops, grid);
  stage.append(wrap, hint);

  const isRobot = (p) => players < 2 && p === P2;

  // Playing alone there is no turn to announce — the board simply waits for
  // you, and the HUD's "Astronaut 2 mag" would be a lie about who the opponent
  // is. Instead the column arrows go quiet while the computer thinks, which is
  // the same information without a label.
  function setTurnLabel() {
    if (players > 1) hud.setTurn(turn);
    wrap.classList.toggle('is-thinking', isRobot(turn));
  }
  setTurnLabel();

  function firstEmpty(c) {
    for (let r = 0; r < cfg.rows; r++) if (board[c][r] === null) return r;
    return -1;
  }

  // Every line of `need` through (c, r) that belongs to `p`, or null.
  function winningLine(c, r, p) {
    const dirs = [[1, 0], [0, 1], [1, 1], [1, -1]];
    for (const [dc, dr] of dirs) {
      const line = [[c, r]];
      for (const sign of [1, -1]) {
        let x = c + dc * sign;
        let y = r + dr * sign;
        while (x >= 0 && x < cfg.cols && y >= 0 && y < cfg.rows && board[x][y] === p) {
          line.push([x, y]);
          x += dc * sign;
          y += dr * sign;
        }
      }
      if (line.length >= cfg.need) return line;
    }
    return null;
  }

  // Would dropping in `c` win it for `p` right now? Used by the computer for
  // both halves of its brain: take the win, and stop the other one.
  function wouldWin(c, p) {
    const r = firstEmpty(c);
    if (r < 0) return false;
    board[c][r] = p;
    const line = winningLine(c, r, p);
    board[c][r] = null;
    return Boolean(line);
  }

  function place(c, p) {
    const r = firstEmpty(c);
    if (r < 0) {
      sfx.deny();
      return;
    }
    board[c][r] = p;

    const cell = cellAt(c, r);
    const disc = document.createElement('span');
    disc.className = `rij-disc rij-disc--p${p + 1}`;
    // Dropped from above the board and released next frame, so the fall is one
    // CSS transition rather than a per-frame animation.
    disc.style.setProperty('--fall', String(cfg.rows - r));
    cell.appendChild(disc);
    requestAnimationFrame(() => disc.classList.add('is-down'));
    sfx.bounce();

    const line = winningLine(c, r, p);
    if (line) {
      finishRound(p, line);
      return;
    }

    if (board.every((col) => col[cfg.rows - 1] !== null)) {
      finishRound(null, null);
      return;
    }

    turn = p === P1 ? P2 : P1;
    setTurnLabel();

    if (isRobot(turn)) {
      busy = true;
      // A visible beat before the computer answers: an instant reply reads as
      // the board glitching rather than as an opponent thinking.
      later(() => {
        busy = false;
        if (!over) place(robotColumn(), P2);
      }, 620);
    }
  }

  function robotColumn() {
    const open = [];
    for (let c = 0; c < cfg.cols; c++) if (firstEmpty(c) >= 0) open.push(c);

    for (const c of open) if (wouldWin(c, P2)) return c;
    for (const c of open) if (wouldWin(c, P1)) return c;

    let candidates = open;
    if (cfg.lookahead) {
      // Drop the moves that would hand over a win on the spot. Not a search —
      // one step, which is exactly the depth a six-year-old is playing at.
      const safe = open.filter((c) => {
        const r = firstEmpty(c);
        board[c][r] = P2;
        const gift = Array.from({ length: cfg.cols }, (_, k) => k).some(
          (k) => firstEmpty(k) >= 0 && wouldWin(k, P1),
        );
        board[c][r] = null;
        return !gift;
      });
      if (safe.length) candidates = safe;
    }

    // Otherwise lean towards the middle, where lines are worth more, but keep
    // it random enough that the computer does not play the same game twice.
    const mid = (cfg.cols - 1) / 2;
    const weights = candidates.map((c) => 1 / (1 + Math.abs(c - mid)));
    const total = weights.reduce((a, b) => a + b, 0);
    let roll = Math.random() * total;
    for (let i = 0; i < candidates.length; i++) {
      roll -= weights[i];
      if (roll <= 0) return candidates[i];
    }
    return candidates[candidates.length - 1];
  }

  const onDrop = (e) => {
    const btn = e.target.closest('.rij-drop');
    if (!btn || over || busy) return;
    if (isRobot(turn)) return;
    sfx.blip();
    place(Number(btn.dataset.col), turn);
  };
  drops.addEventListener('pointerup', onDrop);
  listeners.push(() => drops.removeEventListener('pointerup', onDrop));

  function finishRound(winner, line) {
    over = true;
    if (line) {
      line.forEach(([x, y]) => cellAt(x, y).firstChild?.classList.add('is-win'));
      sfx.levelUp();
    } else {
      sfx.match();
    }

    const next = [...scores];
    if (winner !== null) next[winner] += 1;

    const cleared = level;
    level += 1;
    setLevel(slug, level);

    let title = 'Het bord is vol — gelijkspel! 🤝';
    let icon = '🤝';
    if (winner !== null) {
      if (players > 1) {
        title = `Astronaut ${winner + 1} heeft de rij! 🏆`;
        icon = '🏆';
      } else if (winner === P1) {
        title = 'Jij hebt de rij! 🏆';
        icon = '🏆';
      } else {
        // Losing is still a mission flown. The ladder measures how far a child
        // got, never how well they played — so the level goes up regardless and
        // the wording says what happened without calling it a loss.
        title = 'De computer had de rij 🤖';
        icon = '🤖';
      }
    }

    later(() => {
      reward = showMissionComplete(stage, {
        icon,
        color: mission.color,
        mission: mission.title,
        level: cleared,
        stars: starsForLevel(level),
        title,
        onNext: () => { reward = null; startRound(next); },
        onRetry: () => {
          reward = null;
          level = cleared;
          hud.setLevel(level);
          startRound(next);
        },
        onHome: onExit,
      });
    }, line ? 900 : 500);
  }
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
