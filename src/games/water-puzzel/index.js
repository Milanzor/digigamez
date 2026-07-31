import './style.css';
import { createHud, showMissionComplete } from '../../shared/ui-components.js';
import { sfx } from '../../shell/audio.js';
import { setLevel, starsForLevel } from '../../shell/progress.js';

// "Brandstof Sorteren" — the water-sort mechanic as rocket fuel tanks.
// Tap a tank to pick it up, tap another to pour; a pour is only legal onto
// the same colour or an empty tank.
//
// Depth: colours climb and spare tanks shrink as the level rises, which is
// what actually makes this genre harder. Undo is always available because
// the puzzle can be reasoned into a dead end and a child shouldn't have to
// restart to recover.

const CAP = 4;
const FUELS = ['#ff6b6b', '#8fd6ff', '#ffc24a', '#7ee787', '#b98cff', '#5fe3c4', '#ff8fc7'];

const LEVELS = [
  { colors: 3, spares: 2 },
  { colors: 4, spares: 2 },
  { colors: 4, spares: 1 },
  { colors: 5, spares: 2 },
  { colors: 5, spares: 1 },
  { colors: 6, spares: 2 },
  { colors: 6, spares: 1 },
  { colors: 7, spares: 2 },
];

let hud = null;
let stage = null;
let level = 1;
let slug = 'water-puzzel';
let mission = null;
let reward = null;
let onExit = null;
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

const top = (t) => t[t.length - 1];

function topRun(tank) {
  if (!tank.length) return 0;
  const c = top(tank);
  let n = 0;
  for (let i = tank.length - 1; i >= 0 && tank[i] === c; i--) n++;
  return n;
}

const canPour = (from, to) =>
  from.length > 0 && to.length < CAP && (to.length === 0 || top(to) === top(from));

function isSolved(tanks) {
  return tanks.every((t) => t.length === 0 || (t.length === CAP && t.every((c) => c === t[0])));
}

function build(cfg) {
  const colors = shuffle(FUELS).slice(0, cfg.colors);
  const units = shuffle(colors.flatMap((c) => Array(CAP).fill(c)));
  const tanks = [];
  for (let i = 0; i < cfg.colors; i++) tanks.push(units.slice(i * CAP, (i + 1) * CAP));
  for (let i = 0; i < cfg.spares; i++) tanks.push([]);
  return tanks;
}

export function init(container, opts) {
  slug = opts.slug;
  level = opts.startLevel || 1;
  mission = { title: opts.title, icon: opts.icon, color: opts.color };
  onExit = opts.onExit;
  reward = null;
  listeners = [];
  timers = [];

  hud = createHud(container, { title: opts.title, onExit: opts.onExit, level });

  stage = document.createElement('div');
  stage.className = 'fuel-stage';
  container.appendChild(stage);

  startRound();
}

function startRound() {
  const cfg = LEVELS[Math.min(level, LEVELS.length) - 1];
  hud.setLevel(level);

  let tanks = build(cfg);
  let picked = null;
  let history = [];
  let done = false;

  const count = tanks.length;
  // Size tanks so even the widest level fits on one row, but let them get
  // genuinely chunky on a big screen rather than capping at a phone size.
  const tankW = Math.min(
    window.innerWidth * 0.86 / count - 16,
    window.innerHeight * 0.17
  );
  const tankH = Math.min(window.innerHeight * 0.5, tankW * 3.2);

  const row = document.createElement('div');
  row.className = 'fuel-row';

  const hint = document.createElement('div');
  hint.className = 'hint-strip';
  hint.textContent = 'Tik een tank aan en giet in een tank met dezelfde kleur';

  const tools = document.createElement('div');
  tools.className = 'fuel-tools';

  const undoBtn = document.createElement('button');
  undoBtn.className = 'key key--bar';
  undoBtn.setAttribute('aria-label', 'Zet terug');
  undoBtn.textContent = '↩️';

  const newBtn = document.createElement('button');
  newBtn.className = 'key key--bar';
  newBtn.setAttribute('aria-label', 'Nieuwe puzzel');
  newBtn.textContent = '🔄';

  tools.append(undoBtn, hint, newBtn);
  stage.replaceChildren(row, tools);

  function render() {
    row.replaceChildren();
    tanks.forEach((tank, i) => {
      const el = document.createElement('div');
      const full = tank.length === CAP && tank.every((c) => c === tank[0]);
      el.className = `fuel-tank${picked === i ? ' is-picked' : ''}${full ? ' is-done' : ''}`;
      el.style.width = `${tankW}px`;
      el.style.height = `${tankH}px`;
      for (let s = 0; s < CAP; s++) {
        const cell = document.createElement('div');
        cell.className = 'fuel-cell';
        cell.style.background = tank[s] || 'transparent';
        el.appendChild(cell);
      }
      const onTap = () => tap(i);
      el.addEventListener('pointerup', onTap);
      listeners.push(() => el.removeEventListener('pointerup', onTap));
      row.appendChild(el);
    });
  }

  function tap(i) {
    if (done) return;
    if (picked === null) {
      if (!tanks[i].length) {
        sfx.deny();
        return;
      }
      picked = i;
      sfx.blip();
      render();
      return;
    }
    if (picked === i) {
      picked = null;
      sfx.blip();
      render();
      return;
    }
    if (canPour(tanks[picked], tanks[i])) {
      history.push(tanks.map((t) => [...t]));
      if (history.length > 30) history.shift();
      const amount = Math.min(topRun(tanks[picked]), CAP - tanks[i].length);
      const color = top(tanks[picked]);
      for (let n = 0; n < amount; n++) {
        tanks[picked].pop();
        tanks[i].push(color);
      }
      picked = null;
      sfx.pour();
      render();
      if (isSolved(tanks)) {
        done = true;
        later(finishRound, 400);
      }
    } else {
      sfx.deny();
      picked = null;
      render();
    }
  }

  const onUndo = () => {
    const prev = history.pop();
    if (!prev) {
      sfx.deny();
      return;
    }
    tanks = prev;
    picked = null;
    sfx.back();
    render();
  };

  const onNew = () => {
    sfx.select();
    startRound();
  };

  undoBtn.addEventListener('pointerup', onUndo);
  newBtn.addEventListener('pointerup', onNew);
  listeners.push(() => {
    undoBtn.removeEventListener('pointerup', onUndo);
    newBtn.removeEventListener('pointerup', onNew);
  });

  render();
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
    title: 'Tanks gesorteerd! ⛽',
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
