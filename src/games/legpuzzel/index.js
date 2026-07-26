import './style.css';
import { createGameChrome } from '../../shared/ui-components.js';
import { sfx } from '../../shell/audio.js';

const FRAME_W = 800;
const FRAME_H = 600;

const SCENES = [
  () => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600">
    <rect width="800" height="600" fill="#bdeaff"/>
    <circle cx="650" cy="110" r="70" fill="#ffd166"/>
    <ellipse cx="180" cy="120" rx="90" ry="40" fill="#ffffff"/>
    <ellipse cx="260" cy="140" rx="70" ry="34" fill="#ffffff"/>
    <rect x="0" y="420" width="800" height="180" fill="#8bd17d"/>
    <rect x="320" y="300" width="160" height="140" fill="#f4a261"/>
    <polygon points="300,300 400,200 500,300" fill="#e76f51"/>
    <rect x="380" y="360" width="60" height="80" fill="#5b3a29"/>
    <circle cx="150" cy="470" r="60" fill="#2a9d8f"/>
    <rect x="140" y="460" width="20" height="90" fill="#6b4226"/>
  </svg>`,
  () => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600">
    <rect width="800" height="600" fill="#4fc3f7"/>
    <rect y="500" width="800" height="100" fill="#f4e2b8"/>
    <circle cx="200" cy="220" r="55" fill="#ff9f1c"/>
    <polygon points="255,220 320,200 320,240" fill="#ff9f1c"/>
    <circle cx="500" cy="340" r="40" fill="#ef476f"/>
    <polygon points="540,340 590,325 590,355" fill="#ef476f"/>
    <circle cx="620" cy="180" r="30" fill="#ffd166"/>
    <polygon points="650,180 685,168 685,192" fill="#ffd166"/>
    <g fill="#ffffff" opacity="0.7">
      <circle cx="120" cy="450" r="10"/>
      <circle cx="150" cy="410" r="7"/>
      <circle cx="400" cy="470" r="9"/>
      <circle cx="650" cy="440" r="12"/>
    </g>
  </svg>`,
  () => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600">
    <rect width="800" height="600" fill="#cdeac0"/>
    <rect y="450" width="800" height="150" fill="#8bd17d"/>
    <rect x="300" y="260" width="220" height="190" fill="#ffd166"/>
    <polygon points="280,260 410,150 540,260" fill="#ef476f"/>
    <rect x="380" y="360" width="70" height="90" fill="#5b3a29"/>
    <circle cx="120" cy="140" r="50" fill="#fff59d"/>
    <ellipse cx="620" cy="150" rx="80" ry="36" fill="#ffffff"/>
    <ellipse cx="680" cy="170" rx="60" ry="30" fill="#ffffff"/>
  </svg>`,
];

const LEVELS = [
  { rows: 2, cols: 2 },
  { rows: 2, cols: 3 },
  { rows: 3, cols: 3 },
];

let stage, cleanupFns = [];
let levelIndex = 0;

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function init(container, { title, onExit }) {
  cleanupFns = [];
  levelIndex = 0;
  const chrome = createGameChrome({ title, onExit });
  stage = document.createElement('div');
  stage.className = 'lp-stage';
  container.appendChild(chrome);
  container.appendChild(stage);
  startRound();
}

function startRound() {
  const { rows, cols } = LEVELS[Math.min(levelIndex, LEVELS.length - 1)];
  const svg = SCENES[Math.floor(Math.random() * SCENES.length)]();
  const imageUrl = `url("data:image/svg+xml;utf8,${encodeURIComponent(svg)}")`;

  const frameWrap = document.createElement('div');
  frameWrap.className = 'lp-frame-wrap';
  const frame = document.createElement('div');
  frame.className = 'lp-frame';
  const frameWidth = Math.min(700, cols * 180);
  const frameHeight = frameWidth * (FRAME_H / FRAME_W) * (rows / cols) * (cols / rows);
  const displayW = frameWidth;
  const displayH = (frameWidth / FRAME_W) * FRAME_H;
  frame.style.width = displayW + 'px';
  frame.style.height = displayH + 'px';
  frame.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
  frame.style.gridTemplateRows = `repeat(${rows}, 1fr)`;
  frameWrap.appendChild(frame);

  const tray = document.createElement('div');
  tray.className = 'lp-tray';

  stage.replaceChildren(frameWrap, tray);

  const total = rows * cols;
  let placedCount = 0;
  const cellW = displayW / cols;
  const cellH = displayH / rows;

  const slots = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const slot = document.createElement('div');
      slot.className = 'lp-slot';
      slot.dataset.row = r;
      slot.dataset.col = c;
      frame.appendChild(slot);
      slots.push(slot);
    }
  }

  const pieceData = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      pieceData.push({ r, c });
    }
  }

  shuffle(pieceData).forEach(({ r, c }) => {
    const piece = document.createElement('div');
    piece.className = 'lp-piece';
    piece.dataset.row = r;
    piece.dataset.col = c;
    piece.style.width = cellW + 'px';
    piece.style.height = cellH + 'px';
    piece.style.backgroundImage = imageUrl;
    piece.style.backgroundSize = `${displayW}px ${displayH}px`;
    piece.style.backgroundPosition = `-${c * cellW}px -${r * cellH}px`;
    tray.appendChild(piece);
    setupDrag(piece, slots, () => {
      placedCount++;
      if (placedCount === total) celebrate();
    });
  });
}

function setupDrag(piece, slots, onPlaced) {
  let startRect, offsetX, offsetY, dragging = false;

  function pointerDown(e) {
    if (piece.classList.contains('placed')) return;
    piece.setPointerCapture(e.pointerId);
    startRect = piece.getBoundingClientRect();
    offsetX = e.clientX - startRect.left;
    offsetY = e.clientY - startRect.top;
    piece.style.position = 'fixed';
    piece.style.left = startRect.left + 'px';
    piece.style.top = startRect.top + 'px';
    piece.style.margin = '0';
    piece.classList.add('dragging');
    dragging = true;
    sfx.tap();
  }

  function pointerMove(e) {
    if (!dragging) return;
    piece.style.left = e.clientX - offsetX + 'px';
    piece.style.top = e.clientY - offsetY + 'px';
  }

  function pointerUp() {
    if (!dragging) return;
    dragging = false;
    piece.classList.remove('dragging');
    const pieceRect = piece.getBoundingClientRect();
    const cx = pieceRect.left + pieceRect.width / 2;
    const cy = pieceRect.top + pieceRect.height / 2;

    const targetSlot = slots.find((slot) => {
      const r = slot.getBoundingClientRect();
      return cx > r.left && cx < r.right && cy > r.top && cy < r.bottom;
    });

    const isCorrect = targetSlot
      && Number(targetSlot.dataset.row) === Number(piece.dataset.row)
      && Number(targetSlot.dataset.col) === Number(piece.dataset.col);

    if (isCorrect) {
      const r = targetSlot.getBoundingClientRect();
      piece.style.transition = 'left 0.2s ease, top 0.2s ease';
      piece.style.left = r.left + 'px';
      piece.style.top = r.top + 'px';
      piece.classList.add('placed');
      sfx.success();
      onPlaced();
    } else {
      piece.style.transition = 'left 0.3s ease, top 0.3s ease';
      piece.style.left = startRect.left + 'px';
      piece.style.top = startRect.top + 'px';
      setTimeout(() => {
        piece.style.position = '';
        piece.style.left = '';
        piece.style.top = '';
        piece.style.transition = '';
      }, 320);
    }
  }

  piece.addEventListener('pointerdown', pointerDown);
  piece.addEventListener('pointermove', pointerMove);
  piece.addEventListener('pointerup', pointerUp);
  cleanupFns.push(() => {
    piece.removeEventListener('pointerdown', pointerDown);
    piece.removeEventListener('pointermove', pointerMove);
    piece.removeEventListener('pointerup', pointerUp);
  });
}

function celebrate() {
  sfx.celebrate();
  const toast = document.createElement('div');
  toast.className = 'confirm-toast visible';
  toast.style.position = 'absolute';
  toast.style.bottom = '2rem';
  toast.style.left = '50%';
  toast.style.transform = 'translateX(-50%)';
  toast.textContent = 'Wat een mooie puzzel! 🎉';
  stage.appendChild(toast);
  setTimeout(() => {
    toast.remove();
    levelIndex = Math.min(levelIndex + 1, LEVELS.length - 1);
    startRound();
  }, 1600);
}

export function destroy() {
  cleanupFns.forEach((fn) => fn());
  cleanupFns = [];
}
