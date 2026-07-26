import './style.css';
import { createHud } from '../../shared/ui-components.js';
import { sfx } from '../../shell/audio.js';
import { setLevel } from '../../shell/progress.js';
import { setChildren } from '../../shared/dom.js';

// "Sterrenpuzzel" — reassemble a space scene.
//
// Scenes are drawn as inline SVG and embedded as a data URI, then sliced by
// shifting each piece's background-position. That means no image assets to
// download and the artwork stays crisp at any size on a 4K panel.
//
// Depth: piece count climbs with the level, and a "peek" key lets a child
// ghost the finished picture over the board — a hint system instead of a
// difficulty wall.

const SCENE_W = 800;
const SCENE_H = 600;

const SCENES = [
  // Rocket climbing past a ringed planet
  `<rect width="800" height="600" fill="#0d1440"/>
   <circle cx="120" cy="90" r="3" fill="#fff"/><circle cx="300" cy="60" r="2" fill="#cfe"/>
   <circle cx="600" cy="120" r="2.5" fill="#fff"/><circle cx="720" cy="300" r="2" fill="#ffd"/>
   <circle cx="80" cy="400" r="2" fill="#fff"/><circle cx="450" cy="520" r="2.5" fill="#cfe"/>
   <circle cx="640" cy="180" r="86" fill="#ffb224"/>
   <ellipse cx="640" cy="180" rx="132" ry="26" fill="none" stroke="#2fd9c6" stroke-width="14" transform="rotate(-20 640 180)"/>
   <path d="M300 470c0-120 40-210 90-260 50 50 90 140 90 260Z" fill="#e8e2d2"/>
   <path d="M300 470c0-120 40-210 90-260v260Z" fill="#c9c2b0"/>
   <circle cx="390" cy="300" r="34" fill="#7cc4ff"/><circle cx="390" cy="300" r="20" fill="#12244a"/>
   <path d="M300 470l-56 70h112Z" fill="#ff5f4d"/><path d="M480 470l56 70H424Z" fill="#ff5f4d"/>
   <path d="M356 540h68l-34 60Z" fill="#ffb224"/>`,

  // Astronaut floating above Earth
  `<rect width="800" height="600" fill="#080e30"/>
   <circle cx="90" cy="80" r="2.5" fill="#fff"/><circle cx="700" cy="70" r="2" fill="#cfe"/>
   <circle cx="520" cy="180" r="2" fill="#fff"/><circle cx="180" cy="300" r="2.5" fill="#ffd"/>
   <circle cx="400" cy="640" r="260" fill="#2f6fd0"/>
   <path d="M240 520c60-30 120-10 170 10s110 20 160-10c-40 90-140 130-230 110s-130-70-100-110Z" fill="#6ee87a"/>
   <circle cx="410" cy="250" r="62" fill="#f4f0e2"/>
   <path d="M368 236a44 44 0 0 1 84 0v22h-84Z" fill="#12244a"/>
   <rect x="360" y="312" width="100" height="120" rx="34" fill="#e8e2d2"/>
   <rect x="300" y="330" width="70" height="30" rx="15" fill="#e8e2d2" transform="rotate(-24 300 330)"/>
   <rect x="452" y="322" width="70" height="30" rx="15" fill="#e8e2d2" transform="rotate(20 452 322)"/>
   <rect x="372" y="424" width="34" height="90" rx="16" fill="#e8e2d2"/>
   <rect x="416" y="424" width="34" height="90" rx="16" fill="#e8e2d2"/>
   <rect x="384" y="336" width="52" height="44" rx="10" fill="#ffb224"/>`,

  // Space station over a moon horizon
  `<rect width="800" height="600" fill="#0b1138"/>
   <circle cx="150" cy="100" r="2.5" fill="#fff"/><circle cx="650" cy="90" r="2" fill="#cfe"/>
   <circle cx="420" cy="60" r="2" fill="#fff"/><circle cx="740" cy="220" r="2.5" fill="#ffd"/>
   <circle cx="400" cy="700" r="300" fill="#b9b2a2"/>
   <circle cx="250" cy="470" r="42" fill="#9a9384"/><circle cx="520" cy="500" r="30" fill="#9a9384"/>
   <circle cx="400" cy="230" r="66" fill="#e8e2d2"/>
   <rect x="180" y="205" width="180" height="50" rx="14" fill="#7cc4ff"/>
   <rect x="440" y="205" width="180" height="50" rx="14" fill="#7cc4ff"/>
   <rect x="376" y="120" width="48" height="70" rx="12" fill="#c9c2b0"/>
   <circle cx="400" cy="230" r="28" fill="#12244a"/>
   <circle cx="400" cy="230" r="14" fill="#ffb224"/>`,

  // Alien waving on a purple world
  `<rect width="800" height="600" fill="#140b34"/>
   <circle cx="100" cy="70" r="2.5" fill="#fff"/><circle cx="560" cy="100" r="2" fill="#cfe"/>
   <circle cx="330" cy="50" r="2" fill="#fff"/><circle cx="700" cy="260" r="2.5" fill="#ffd"/>
   <ellipse cx="400" cy="560" rx="420" ry="150" fill="#b06bff"/>
   <ellipse cx="400" cy="560" rx="420" ry="150" fill="none" stroke="#8a44e0" stroke-width="10"/>
   <ellipse cx="220" cy="520" rx="46" ry="18" fill="#8a44e0"/>
   <ellipse cx="580" cy="540" rx="38" ry="14" fill="#8a44e0"/>
   <ellipse cx="400" cy="300" rx="86" ry="100" fill="#6ee87a"/>
   <ellipse cx="368" cy="284" rx="20" ry="26" fill="#0e1741"/>
   <ellipse cx="432" cy="284" rx="20" ry="26" fill="#0e1741"/>
   <path d="M372 344q28 22 56 0" stroke="#0e1741" stroke-width="9" fill="none" stroke-linecap="round"/>
   <path d="M352 206l-24-56" stroke="#6ee87a" stroke-width="12" stroke-linecap="round"/>
   <circle cx="326" cy="142" r="14" fill="#ffb224"/>
   <path d="M448 206l24-56" stroke="#6ee87a" stroke-width="12" stroke-linecap="round"/>
   <circle cx="474" cy="142" r="14" fill="#ffb224"/>
   <rect x="352" y="396" width="96" height="90" rx="26" fill="#2fd9c6"/>`,
];

// rows x cols per level
const LEVELS = [
  { cols: 2, rows: 2 },
  { cols: 3, rows: 2 },
  { cols: 3, rows: 3 },
  { cols: 4, rows: 3 },
  { cols: 4, rows: 4 },
  { cols: 5, rows: 4 },
];

let hud = null;
let stage = null;
let level = 1;
let slug = 'legpuzzel';
let listeners = [];
let timers = [];

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function later(fn, ms) {
  const id = setTimeout(fn, ms);
  timers.push(id);
  return id;
}

function sceneUrl(body) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SCENE_W} ${SCENE_H}">${body}</svg>`;
  return `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`;
}

export function init(container, opts) {
  slug = opts.slug;
  level = opts.startLevel || 1;
  listeners = [];
  timers = [];

  hud = createHud(container, { title: opts.title, onExit: opts.onExit, level });

  stage = document.createElement('div');
  stage.className = 'jig-stage';
  container.appendChild(stage);

  startRound();
}

function startRound() {
  const cfg = LEVELS[Math.min(level, LEVELS.length) - 1];
  hud.setLevel(level);

  const url = sceneUrl(SCENES[Math.floor(Math.random() * SCENES.length)]);

  // Budget the vertical space explicitly: HUD strip, then board, then tray.
  // Doing the arithmetic here (rather than leaning on flex) is what keeps the
  // board's 4:3 ratio exact, which the sliced background depends on.
  const HUD_RESERVE = Math.max(150, window.innerHeight * 0.15);
  const TOOLS_RESERVE = Math.max(110, window.innerHeight * 0.11);
  // The 90px covers the flex gaps plus the stage's bottom padding.
  const available = window.innerHeight - HUD_RESERVE - TOOLS_RESERVE - 90;

  const boardH = Math.min(available * 0.66, window.innerWidth * 0.8 * (SCENE_H / SCENE_W));
  const boardW = boardH * (SCENE_W / SCENE_H);
  const pieceW = boardW / cfg.cols;
  const pieceH = boardH / cfg.rows;

  // Tray pieces are shown smaller so every piece fits on screen at once; a
  // piece grows to full size as it snaps into the board.
  const trayH = available - boardH;
  const total = cfg.cols * cfg.rows;
  // Capped below 1 so tray pieces read as "not yet placed" and leave the
  // board the larger share of the screen.
  const trayScale = Math.min(
    0.85,
    trayH / pieceH,
    (window.innerWidth * 0.88) / (total * pieceW)
  );
  const trayW = pieceW * trayScale;
  const trayPieceH = pieceH * trayScale;

  const board = document.createElement('div');
  board.className = 'jig-board';
  board.style.width = `${boardW}px`;
  board.style.height = `${boardH}px`;
  board.style.gridTemplateColumns = `repeat(${cfg.cols}, 1fr)`;
  board.style.gridTemplateRows = `repeat(${cfg.rows}, 1fr)`;

  const ghost = document.createElement('div');
  ghost.className = 'jig-board__ghost';
  ghost.style.backgroundImage = url;

  const slots = [];
  for (let r = 0; r < cfg.rows; r++) {
    for (let c = 0; c < cfg.cols; c++) {
      const slot = document.createElement('div');
      slot.className = 'jig-slot';
      slot.dataset.row = String(r);
      slot.dataset.col = String(c);
      board.appendChild(slot);
      slots.push(slot);
    }
  }
  board.appendChild(ghost);

  const tray = document.createElement('div');
  tray.className = 'jig-tray';
  // Must match the width used in the trayScale calculation below, otherwise
  // the pieces wrap onto a second row and fall off the bottom of the screen.
  tray.style.maxWidth = `${window.innerWidth * 0.9}px`;

  const tools = document.createElement('div');
  tools.className = 'jig-tools';
  const peekBtn = document.createElement('button');
  peekBtn.className = 'key key--bar';
  peekBtn.setAttribute('aria-label', 'Bekijk het voorbeeld');
  peekBtn.textContent = '👁️';
  const hint = document.createElement('div');
  hint.className = 'hint-strip';
  hint.textContent = 'Sleep de stukjes op hun plek — houd 👁️ vast voor een kijkje';
  tools.append(peekBtn, hint);

  setChildren(stage, board, tools, tray);

  const showGhost = () => { ghost.classList.add('is-on'); sfx.blip(); };
  const hideGhost = () => ghost.classList.remove('is-on');
  peekBtn.addEventListener('pointerdown', showGhost);
  peekBtn.addEventListener('pointerup', hideGhost);
  peekBtn.addEventListener('pointercancel', hideGhost);
  peekBtn.addEventListener('pointerleave', hideGhost);
  listeners.push(() => {
    peekBtn.removeEventListener('pointerdown', showGhost);
    peekBtn.removeEventListener('pointerup', hideGhost);
    peekBtn.removeEventListener('pointercancel', hideGhost);
    peekBtn.removeEventListener('pointerleave', hideGhost);
  });

  const coords = [];
  for (let r = 0; r < cfg.rows; r++) {
    for (let c = 0; c < cfg.cols; c++) coords.push({ r, c });
  }

  let placed = 0;

  shuffle(coords).forEach(({ r, c }) => {
    const piece = document.createElement('div');
    piece.className = 'jig-piece';
    piece.dataset.row = String(r);
    piece.dataset.col = String(c);
    piece.style.width = `${trayW}px`;
    piece.style.height = `${trayPieceH}px`;
    piece.style.backgroundImage = url;
    piece.style.backgroundSize = `${boardW * trayScale}px ${boardH * trayScale}px`;
    piece.style.backgroundPosition = `-${c * trayW}px -${r * trayPieceH}px`;
    tray.appendChild(piece);

    attachDrag(piece, slots, { boardW, boardH, pieceW, pieceH }, () => {
      placed++;
      if (placed === total) finishRound();
    });
  });
}

function attachDrag(piece, slots, full, onPlaced) {
  let startRect = null;
  let offsetX = 0;
  let offsetY = 0;
  let dragging = false;

  const onDown = (e) => {
    if (piece.classList.contains('is-placed')) return;
    piece.setPointerCapture(e.pointerId);
    startRect = piece.getBoundingClientRect();
    offsetX = e.clientX - startRect.left;
    offsetY = e.clientY - startRect.top;
    Object.assign(piece.style, {
      position: 'fixed',
      left: `${startRect.left}px`,
      top: `${startRect.top}px`,
      margin: '0',
    });
    piece.classList.add('is-dragging');
    dragging = true;
    sfx.blip();
  };

  const onMove = (e) => {
    if (!dragging) return;
    piece.style.left = `${e.clientX - offsetX}px`;
    piece.style.top = `${e.clientY - offsetY}px`;
  };

  const onUp = () => {
    if (!dragging) return;
    dragging = false;
    piece.classList.remove('is-dragging');

    const r = piece.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;

    const slot = slots.find((s) => {
      const sr = s.getBoundingClientRect();
      const pad = sr.width * 0.3;
      return cx > sr.left - pad && cx < sr.right + pad && cy > sr.top - pad && cy < sr.bottom + pad;
    });

    const correct = slot
      && slot.dataset.row === piece.dataset.row
      && slot.dataset.col === piece.dataset.col;

    if (correct) {
      const sr = slot.getBoundingClientRect();
      piece.style.transition = 'left 0.18s ease, top 0.18s ease, width 0.18s ease, height 0.18s ease';
      piece.style.left = `${sr.left}px`;
      piece.style.top = `${sr.top}px`;
      // Grow from tray scale to the full slot, rescaling the slice with it.
      piece.style.width = `${full.pieceW}px`;
      piece.style.height = `${full.pieceH}px`;
      piece.style.backgroundSize = `${full.boardW}px ${full.boardH}px`;
      piece.style.backgroundPosition =
        `-${Number(piece.dataset.col) * full.pieceW}px -${Number(piece.dataset.row) * full.pieceH}px`;
      piece.classList.add('is-placed');
      sfx.dock();
      onPlaced();
    } else {
      piece.style.transition = 'left 0.28s ease, top 0.28s ease';
      piece.style.left = `${startRect.left}px`;
      piece.style.top = `${startRect.top}px`;
      setTimeout(() => {
        Object.assign(piece.style, { position: '', left: '', top: '', margin: '', transition: '' });
      }, 300);
    }
  };

  piece.addEventListener('pointerdown', onDown);
  piece.addEventListener('pointermove', onMove);
  piece.addEventListener('pointerup', onUp);
  piece.addEventListener('pointercancel', onUp);
  listeners.push(() => {
    piece.removeEventListener('pointerdown', onDown);
    piece.removeEventListener('pointermove', onMove);
    piece.removeEventListener('pointerup', onUp);
    piece.removeEventListener('pointercancel', onUp);
  });
}

function finishRound() {
  sfx.missionComplete();
  level += 1;
  setLevel(slug, level);
  hud.banner('Puzzel compleet! 🧩', { sub: `Level ${level} vrijgespeeld`, ms: 1900 });
  later(startRound, 2000);
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
