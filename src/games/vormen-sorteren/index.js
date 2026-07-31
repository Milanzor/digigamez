import './style.css';
import { createHud, showMissionComplete } from '../../shared/ui-components.js';
import { sfx } from '../../shell/audio.js';
import { setLevel, starsForLevel } from '../../shell/progress.js';

// "Sterrenvormen" — dock cargo modules into the matching airlock port.
//
// Depth comes from three stacked difficulty dials driven by the level:
//   1. how many pieces are in play (3 -> 6)
//   2. whether colour has to match as well as silhouette (level 5+)
//   3. whether the ports drift while you aim (level 3+)
// Levels are unlimited; the difficulty dials cap so it never gets unfair.

const SHAPES = [
  { id: 'circle', svg: '<circle cx="50" cy="50" r="42"/>' },
  { id: 'square', svg: '<rect x="10" y="10" width="80" height="80" rx="12"/>' },
  { id: 'triangle', svg: '<polygon points="50,8 92,88 8,88"/>' },
  { id: 'star', svg: '<polygon points="50,5 61,37 96,37 68,58 79,91 50,70 21,91 32,58 4,37 39,37"/>' },
  { id: 'hexagon', svg: '<polygon points="50,6 88,28 88,72 50,94 12,72 12,28"/>' },
  { id: 'moon', svg: '<path d="M62 10a42 42 0 1 0 28 66A34 34 0 0 1 62 10Z"/>' },
  { id: 'rocket', svg: '<path d="M50 6c14 14 20 30 20 48l-10 8H40l-10-8c0-18 6-34 20-48Z"/><circle cx="50" cy="38" r="8" fill="#0d0c22"/>' },
  { id: 'diamond', svg: '<polygon points="50,6 92,50 50,94 8,50"/>' },
];

const COLORS = ['#ffc24a', '#ff6b6b', '#5fe3c4', '#b98cff', '#8fd6ff', '#7ee787'];

let hud = null;
let stage = null;
let level = 1;
let slug = 'vormen-sorteren';
let mission = null;
let reward = null;
let onExit = null;
let listeners = [];
let driftRaf = null;

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function levelConfig(l) {
  return {
    count: Math.min(3 + Math.floor((l - 1) / 1.5), 6),
    matchColor: l >= 5,
    drift: l >= 3,
  };
}

function shapeSvg(shape, color) {
  return `<svg viewBox="0 0 100 100" fill="${color}">${shape.svg}</svg>`;
}

export function init(container, opts) {
  slug = opts.slug;
  level = opts.startLevel || 1;
  mission = { title: opts.title, icon: opts.icon, color: opts.color };
  onExit = opts.onExit;
  reward = null;
  listeners = [];

  hud = createHud(container, {
    title: opts.title,
    onExit: opts.onExit,
    level,
  });

  stage = document.createElement('div');
  stage.className = 'dock-stage';
  container.appendChild(stage);

  // No intro banner here: the hint strip inside the round already says this,
  // and stacking both just covers the board.
  startRound();
}

function startRound() {
  const cfg = levelConfig(level);
  hud.setLevel(level);

  const picked = shuffle(SHAPES).slice(0, cfg.count);
  // Each piece gets a colour. When colour matters we deliberately reuse
  // colours across shapes so colour alone can't identify the port.
  const pieces = picked.map((shape, i) => ({
    shape,
    color: COLORS[i % COLORS.length],
    key: cfg.matchColor ? `${shape.id}|${COLORS[i % COLORS.length]}` : shape.id,
  }));

  const portOrder = shuffle(pieces);

  stage.innerHTML = `
    <div class="dock-row" id="ports">
      ${portOrder.map((p) => `
        <div class="dock-port" data-key="${p.key}">
          ${shapeSvg(p.shape, cfg.matchColor ? p.color : '#8fd6ff')}
        </div>
      `).join('')}
    </div>
    <div class="hint-strip">${cfg.matchColor ? 'Let op: vorm én kleur moeten kloppen' : 'Sleep elke vorm naar zijn plek'}</div>
    <div class="dock-row" id="cargo">
      ${shuffle(pieces).map((p) => `
        <div class="cargo" data-key="${p.key}">${shapeSvg(p.shape, p.color)}</div>
      `).join('')}
    </div>
  `;

  const ports = [...stage.querySelectorAll('.dock-port')];
  const cargos = [...stage.querySelectorAll('.cargo')];
  let docked = 0;

  cargos.forEach((cargo) => attachDrag(cargo, ports, () => {
    docked++;
    if (docked === cargos.length) finishRound();
  }));

  stopDrift();
  if (cfg.drift) startDrift(ports);
}

// Ports gently slide side to side at higher levels, which turns a pure
// shape-recognition task into one that also needs timing and tracking.
function startDrift(ports) {
  const t0 = performance.now();
  const amp = 14 + Math.min(level, 8) * 3;
  const step = (now) => {
    const t = (now - t0) / 1000;
    ports.forEach((p, i) => {
      if (p.classList.contains('is-filled')) {
        p.style.transform = '';
        return;
      }
      p.style.transform = `translateX(${Math.sin(t * 0.7 + i * 1.3) * amp}px)`;
    });
    driftRaf = requestAnimationFrame(step);
  };
  driftRaf = requestAnimationFrame(step);
}

function stopDrift() {
  if (driftRaf) cancelAnimationFrame(driftRaf);
  driftRaf = null;
}

function attachDrag(cargo, ports, onDocked) {
  let startRect = null;
  let offsetX = 0;
  let offsetY = 0;
  let dragging = false;
  let hotPort = null;

  const portUnder = (x, y) => ports.find((port) => {
    if (port.classList.contains('is-filled')) return false;
    const r = port.getBoundingClientRect();
    // Generous padding: a child aiming at a wall-sized screen from close up
    // is far less precise than a mouse user.
    const pad = r.width * 0.18;
    return x > r.left - pad && x < r.right + pad && y > r.top - pad && y < r.bottom + pad;
  });

  const onDown = (e) => {
    if (cargo.classList.contains('is-docked')) return;
    cargo.setPointerCapture(e.pointerId);
    startRect = cargo.getBoundingClientRect();
    offsetX = e.clientX - startRect.left;
    offsetY = e.clientY - startRect.top;
    Object.assign(cargo.style, {
      position: 'fixed',
      left: `${startRect.left}px`,
      top: `${startRect.top}px`,
      width: `${startRect.width}px`,
      height: `${startRect.height}px`,
      margin: '0',
    });
    cargo.classList.add('is-dragging');
    dragging = true;
    sfx.blip();
  };

  const onMove = (e) => {
    if (!dragging) return;
    cargo.style.left = `${e.clientX - offsetX}px`;
    cargo.style.top = `${e.clientY - offsetY}px`;

    const r = cargo.getBoundingClientRect();
    const next = portUnder(r.left + r.width / 2, r.top + r.height / 2);
    if (next !== hotPort) {
      hotPort?.classList.remove('is-hot');
      next?.classList.add('is-hot');
      hotPort = next;
    }
  };

  const release = () => {
    Object.assign(cargo.style, {
      position: '', left: '', top: '', width: '', height: '', margin: '', transition: '',
    });
  };

  const onUp = () => {
    if (!dragging) return;
    dragging = false;
    cargo.classList.remove('is-dragging');
    hotPort?.classList.remove('is-hot');

    const r = cargo.getBoundingClientRect();
    const target = portUnder(r.left + r.width / 2, r.top + r.height / 2);
    hotPort = null;

    if (target && target.dataset.key === cargo.dataset.key) {
      const pr = target.getBoundingClientRect();
      cargo.style.transition = 'left 0.2s ease, top 0.2s ease, width 0.2s ease, height 0.2s ease';
      cargo.style.left = `${pr.left + (pr.width - r.width) / 2}px`;
      cargo.style.top = `${pr.top + (pr.height - r.height) / 2}px`;
      cargo.classList.add('is-docked');
      target.classList.add('is-filled');
      target.style.transform = '';
      sfx.dock();
      onDocked();
    } else {
      // Wrong port (or empty space): float back, never a penalty.
      if (target) sfx.deny();
      cargo.style.transition = 'left 0.28s ease, top 0.28s ease';
      cargo.style.left = `${startRect.left}px`;
      cargo.style.top = `${startRect.top}px`;
      setTimeout(release, 300);
    }
  };

  cargo.addEventListener('pointerdown', onDown);
  cargo.addEventListener('pointermove', onMove);
  cargo.addEventListener('pointerup', onUp);
  cargo.addEventListener('pointercancel', onUp);
  listeners.push(() => {
    cargo.removeEventListener('pointerdown', onDown);
    cargo.removeEventListener('pointermove', onMove);
    cargo.removeEventListener('pointerup', onUp);
    cargo.removeEventListener('pointercancel', onUp);
  });
}

function finishRound() {
  sfx.missionComplete();
  stopDrift();
  const cleared = level;
  level += 1;
  setLevel(slug, level);
  reward = showMissionComplete(stage, {
    icon: mission.icon,
    color: mission.color,
    mission: mission.title,
    level: cleared,
    stars: starsForLevel(level),
    title: 'Alle vracht gedockt! 🛰️',
    onNext: () => startRound(),
    onRetry: () => { level = cleared; hud.setLevel(level); startRound(); },
    onHome: onExit,
  });
}

export function destroy() {
  stopDrift();
  listeners.forEach((off) => off());
  listeners = [];
  reward?.close();
  reward = null;
  hud?.destroy();
  hud = null;
  stage = null;
}
