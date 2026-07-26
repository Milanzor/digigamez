import './style.css';
import { createGameChrome } from '../../shared/ui-components.js';
import { sfx } from '../../shell/audio.js';

const CAP = 4;
const COLOR_POOL = ['#EF476F', '#3A86FF', '#FFD166', '#06D6A0', '#8338EC', '#FF9F1C'];

let stage, cleanupFns = [];

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function generatePuzzle() {
  const colorCount = 4;
  const colors = shuffle(COLOR_POOL).slice(0, colorCount);
  const allUnits = shuffle(colors.flatMap((c) => Array(CAP).fill(c)));

  const tubes = [];
  for (let i = 0; i < colorCount; i++) {
    tubes.push(allUnits.slice(i * CAP, (i + 1) * CAP));
  }
  tubes.push([]);
  tubes.push([]);
  return tubes;
}

function isSolved(tubes) {
  return tubes.every((t) => t.length === 0 || (t.length === CAP && t.every((c) => c === t[0])));
}

function topColor(tube) {
  return tube[tube.length - 1];
}

function topRunLength(tube) {
  if (tube.length === 0) return 0;
  const color = topColor(tube);
  let n = 0;
  for (let i = tube.length - 1; i >= 0 && tube[i] === color; i--) n++;
  return n;
}

function canPour(from, to) {
  if (from.length === 0) return false;
  if (to.length >= CAP) return false;
  if (to.length > 0 && topColor(to) !== topColor(from)) return false;
  return true;
}

function pour(from, to) {
  const amount = Math.min(topRunLength(from), CAP - to.length);
  const color = topColor(from);
  for (let i = 0; i < amount; i++) {
    from.pop();
    to.push(color);
  }
}

export function init(container, { title, onExit }) {
  cleanupFns = [];
  const chrome = createGameChrome({ title, onExit });
  stage = document.createElement('div');
  stage.className = 'wp-stage';
  container.appendChild(chrome);
  container.appendChild(stage);
  startRound();
}

function startRound() {
  const tubes = generatePuzzle();
  let selected = null;

  const tubesWrap = document.createElement('div');
  tubesWrap.className = 'wp-tubes';

  const actions = document.createElement('div');
  actions.className = 'wp-actions';
  const newBtn = document.createElement('button');
  newBtn.className = 'btn secondary';
  newBtn.textContent = '🔄 Nieuwe puzzel';
  actions.appendChild(newBtn);

  stage.replaceChildren(tubesWrap, actions);

  function render() {
    tubesWrap.replaceChildren();
    tubes.forEach((tube, i) => {
      const tubeEl = document.createElement('div');
      tubeEl.className = 'wp-tube' + (selected === i ? ' selected' : '');
      for (let s = 0; s < CAP; s++) {
        const slot = document.createElement('div');
        slot.className = 'wp-slot';
        slot.style.background = tube[s] || 'transparent';
        tubeEl.appendChild(slot);
      }
      tubeEl.addEventListener('pointerup', () => onTubeTap(i));
      tubesWrap.appendChild(tubeEl);
    });
  }

  function onTubeTap(i) {
    if (selected === null) {
      if (tubes[i].length === 0) return;
      selected = i;
      sfx.click();
      render();
      return;
    }
    if (selected === i) {
      selected = null;
      sfx.click();
      render();
      return;
    }
    if (canPour(tubes[selected], tubes[i])) {
      pour(tubes[selected], tubes[i]);
      sfx.swoosh();
      selected = null;
      render();
      if (isSolved(tubes)) {
        setTimeout(celebrate, 300);
      }
    } else {
      sfx.fail();
      selected = null;
      render();
    }
  }

  const onNew = () => startRound();
  newBtn.addEventListener('pointerup', onNew);

  render();
}

function celebrate() {
  sfx.celebrate();
  const toast = document.createElement('div');
  toast.className = 'confirm-toast visible';
  toast.style.position = 'absolute';
  toast.style.bottom = '2rem';
  toast.style.left = '50%';
  toast.style.transform = 'translateX(-50%)';
  toast.textContent = 'Alle kleuren gesorteerd! 🎉';
  stage.appendChild(toast);
  setTimeout(() => {
    toast.remove();
    startRound();
  }, 1600);
}

export function destroy() {
  cleanupFns.forEach((fn) => fn());
  cleanupFns = [];
}
