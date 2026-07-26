import './style.css';
import { createGameChrome } from '../../shared/ui-components.js';
import { sfx } from '../../shell/audio.js';

const SHAPES = [
  { id: 'circle', color: '#EF476F', svg: '<circle cx="50" cy="50" r="42" fill="currentColor"/>' },
  { id: 'square', color: '#3A86FF', svg: '<rect x="10" y="10" width="80" height="80" rx="10" fill="currentColor"/>' },
  { id: 'triangle', color: '#06D6A0', svg: '<polygon points="50,8 92,88 8,88" fill="currentColor"/>' },
  { id: 'star', color: '#FFD166', svg: '<polygon points="50,5 61,37 96,37 68,58 79,91 50,70 21,91 32,58 4,37 39,37" fill="currentColor"/>' },
  { id: 'heart', color: '#FF6B6B', svg: '<path d="M50 88 10 52a22 22 0 0 1 31-31l9 9 9-9a22 22 0 0 1 31 31Z" fill="currentColor"/>' },
  { id: 'moon', color: '#8338EC', svg: '<path d="M62 10a42 42 0 1 0 28 66A34 34 0 0 1 62 10Z" fill="currentColor"/>' },
];

function shapeSvg(shape) {
  return `<svg viewBox="0 0 100 100" style="color:${shape.color}">${shape.svg}</svg>`;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

let stage, cleanupFns = [];

export function init(container, { title, onExit }) {
  cleanupFns = [];
  const chrome = createGameChrome({ title, onExit });
  stage = document.createElement('div');
  stage.className = 'vs-stage';
  container.appendChild(chrome);
  container.appendChild(stage);

  startRound();
}

function startRound() {
  const count = 4;
  const roundShapes = shuffle(SHAPES).slice(0, count);
  const slotOrder = shuffle(roundShapes);

  stage.innerHTML = `
    <div class="vs-slots">
      ${slotOrder.map((s) => `<div class="vs-slot" data-shape="${s.id}">${shapeSvg(s)}</div>`).join('')}
    </div>
    <div class="vs-tray">
      ${roundShapes.map((s) => `<div class="vs-piece" data-shape="${s.id}">${shapeSvg(s)}</div>`).join('')}
    </div>
  `;

  const slots = [...stage.querySelectorAll('.vs-slot')];
  const pieces = [...stage.querySelectorAll('.vs-piece')];
  let filledCount = 0;

  pieces.forEach((piece) => setupDrag(piece, slots, () => {
    filledCount++;
    if (filledCount === pieces.length) {
      celebrate();
    }
  }));
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
    piece.style.width = startRect.width + 'px';
    piece.style.height = startRect.height + 'px';
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

  function pointerUp(e) {
    if (!dragging) return;
    dragging = false;
    piece.classList.remove('dragging');
    const pieceRect = piece.getBoundingClientRect();
    const cx = pieceRect.left + pieceRect.width / 2;
    const cy = pieceRect.top + pieceRect.height / 2;

    const targetSlot = slots.find((slot) => {
      if (slot.classList.contains('filled')) return false;
      const r = slot.getBoundingClientRect();
      return cx > r.left && cx < r.right && cy > r.top && cy < r.bottom;
    });

    if (targetSlot && targetSlot.dataset.shape === piece.dataset.shape) {
      const r = targetSlot.getBoundingClientRect();
      piece.style.transition = 'left 0.25s ease, top 0.25s ease, transform 0.25s ease';
      piece.style.left = r.left + (r.width - pieceRect.width) / 2 + 'px';
      piece.style.top = r.top + (r.height - pieceRect.height) / 2 + 'px';
      piece.classList.add('placed');
      targetSlot.classList.add('filled');
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
        piece.style.width = '';
        piece.style.height = '';
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
  toast.textContent = 'Goed gedaan! 🎉';
  toast.style.position = 'absolute';
  toast.style.bottom = '2rem';
  toast.style.left = '50%';
  toast.style.transform = 'translateX(-50%)';
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
