import './style.css';
import { createHud, showMissionComplete } from '../../shared/ui-components.js';
import { sfx } from '../../shell/audio.js';
import { setLevel, starsForLevel } from '../../shell/progress.js';

// "Ruimtegeheugen" — match pairs of space objects.
//
// Depth: the board grows with the level (4 -> 12 pairs) and from level 2 a
// single golden comet pair is worth double, which gives older children
// something to strategise about while the base game stays toddler-simple.

const ICONS = ['🪐', '🚀', '🛸', '👽', '🌍', '🌙', '⭐', '🛰️', '🔭', '👨‍🚀', '🌌', '🪨'];
const BONUS_ICON = '☄️';

// pairs per level, then the grid shape that fits them
const LEVELS = [
  { pairs: 4, cols: 4 },
  { pairs: 6, cols: 4 },
  { pairs: 8, cols: 4 },
  { pairs: 10, cols: 5 },
  { pairs: 12, cols: 6 },
];

let hud = null;
let stage = null;
let level = 1;
let slug = 'geheugenspel';
let mission = null;
let reward = null;
let onExit = null;
let players = 1;
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

export function init(container, opts) {
  slug = opts.slug;
  level = opts.startLevel || 1;
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
    players,
    showScore: true,
    showTurn: players > 1,
  });

  stage = document.createElement('div');
  stage.className = 'mem-stage';
  container.appendChild(stage);

  startRound();
}

function startRound() {
  const cfg = LEVELS[Math.min(level, LEVELS.length) - 1];
  hud.setLevel(level);

  const useBonus = level >= 2;
  const normalPairs = useBonus ? cfg.pairs - 1 : cfg.pairs;
  const chosen = shuffle(ICONS).slice(0, normalPairs);

  const deck = shuffle([
    ...chosen.flatMap((icon) => [
      { icon, bonus: false },
      { icon, bonus: false },
    ]),
    ...(useBonus
      ? [{ icon: BONUS_ICON, bonus: true }, { icon: BONUS_ICON, bonus: true }]
      : []),
  ]);

  const cols = cfg.cols;
  const rows = Math.ceil(deck.length / cols);

  let current = 0;
  const scores = [0, 0];
  let flipped = [];
  let matched = 0;
  let locked = false;

  players > 1 && hud.setTurn(current);
  scores.forEach((s, i) => i < players && hud.setScore(i, 0));

  const grid = document.createElement('div');
  grid.className = 'mem-grid';
  grid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
  grid.style.gridTemplateRows = `repeat(${rows}, 1fr)`;
  grid.style.setProperty('--grid-ratio', String(cols / rows));

  const hint = document.createElement('div');
  hint.className = 'hint-strip';
  hint.textContent = useBonus
    ? 'Vind de paren — de komeet ☄️ is dubbele punten'
    : 'Draai twee kaarten om en zoek de paren';

  const cards = deck.map((entry) => {
    const card = document.createElement('div');
    card.className = `mem-card${entry.bonus ? ' is-bonus' : ''}`;
    card.dataset.icon = entry.icon;
    card.innerHTML = `
      <div class="mem-card__inner">
        <div class="mem-face mem-face--back">✦</div>
        <div class="mem-face mem-face--front">${entry.icon}</div>
      </div>
    `;
    grid.appendChild(card);
    return card;
  });

  stage.replaceChildren(hint, grid);

  const onTap = (e) => {
    if (locked) return;
    const card = e.currentTarget;
    if (card.classList.contains('is-flipped') || card.classList.contains('is-matched')) return;

    card.classList.add('is-flipped');
    sfx.flip();
    flipped.push(card);
    if (flipped.length < 2) return;

    locked = true;
    const [a, b] = flipped;

    if (a.dataset.icon === b.dataset.icon) {
      later(() => {
        const isBonus = a.classList.contains('is-bonus');
        a.classList.add('is-matched');
        b.classList.add('is-matched');
        matched++;
        scores[current] += isBonus ? 2 : 1;
        hud.setScore(current, scores[current]);
        isBonus ? sfx.powerup() : sfx.match();
        flipped = [];
        locked = false;
        if (matched === deck.length / 2) later(() => finishRound(scores), 500);
      }, 460);
    } else {
      later(() => {
        a.classList.remove('is-flipped');
        b.classList.remove('is-flipped');
        flipped = [];
        locked = false;
        if (players > 1) {
          current = 1 - current;
          hud.setTurn(current);
        }
      }, 850);
    }
  };

  cards.forEach((c) => c.addEventListener('pointerup', onTap));
  listeners.push(() => cards.forEach((c) => c.removeEventListener('pointerup', onTap)));
}

function finishRound(scores) {
  sfx.missionComplete();
  const cleared = level;
  level += 1;
  setLevel(slug, level);

  // With two astronauts the headline is the result, not the completion: who
  // won is the thing they both want to read.
  let text = 'Alle paren gevonden! 🪐';
  let icon = mission.icon;
  if (players > 1) {
    if (scores[0] === scores[1]) {
      text = 'Gelijkspel! 🤝';
      icon = '🤝';
    } else {
      text = `Astronaut ${scores[0] > scores[1] ? 1 : 2} wint! 🏆`;
      icon = '🏆';
    }
  }
  reward = showMissionComplete(stage, {
    icon,
    color: mission.color,
    mission: mission.title,
    level: cleared,
    stars: starsForLevel(level),
    title: text,
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
