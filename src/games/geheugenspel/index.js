import './style.css';
import { createGameChrome, createTurnBanner, setTurnBanner, createScoreboard } from '../../shared/ui-components.js';
import { sfx } from '../../shell/audio.js';

const ICONS = ['🐶', '🐱', '🐸', '🦋', '🐢', '🐝', '🦁', '🐘', '🐬', '🦊'];
const TURN_COLORS = ['#EF476F', '#3A86FF'];

let stage, cleanupFns = [];

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function init(container, { title, onExit, players }) {
  cleanupFns = [];
  const chrome = createGameChrome({ title, onExit });
  stage = document.createElement('div');
  stage.className = 'mg-stage';

  let turnBanner, scoreboard;
  if (players === 2) {
    turnBanner = createTurnBanner();
    scoreboard = createScoreboard([1, 2]);
  }

  container.appendChild(chrome);
  if (turnBanner) container.appendChild(turnBanner);
  if (scoreboard) container.appendChild(scoreboard.el);
  container.appendChild(stage);

  startRound(players, turnBanner, scoreboard);
}

function startRound(playerCount, turnBanner, scoreboard) {
  const pairCount = 6;
  const chosen = shuffle(ICONS).slice(0, pairCount);
  const deck = shuffle([...chosen, ...chosen]);

  let currentPlayer = 0;
  const scores = [0, 0];
  let flipped = [];
  let matchedCount = 0;
  let locked = false;

  if (turnBanner) setTurnBanner(turnBanner, currentPlayer, TURN_COLORS);

  const grid = document.createElement('div');
  grid.className = 'mg-grid';
  stage.replaceChildren(grid);

  const cards = deck.map((icon) => {
    const card = document.createElement('div');
    card.className = 'mg-card';
    card.innerHTML = `
      <div class="mg-card-inner">
        <div class="mg-face back">❓</div>
        <div class="mg-face front">${icon}</div>
      </div>
    `;
    card.dataset.icon = icon;
    grid.appendChild(card);
    return card;
  });

  function onCardTap(e) {
    if (locked) return;
    const card = e.currentTarget;
    if (card.classList.contains('flipped') || card.classList.contains('matched')) return;

    card.classList.add('flipped');
    sfx.pop();
    flipped.push(card);

    if (flipped.length === 2) {
      locked = true;
      const [a, b] = flipped;
      if (a.dataset.icon === b.dataset.icon) {
        setTimeout(() => {
          a.classList.add('matched');
          b.classList.add('matched');
          matchedCount++;
          scores[currentPlayer]++;
          if (scoreboard) scoreboard.update(currentPlayer, scores[currentPlayer]);
          sfx.success();
          flipped = [];
          locked = false;
          if (matchedCount === pairCount) {
            setTimeout(() => celebrate(playerCount, turnBanner, scoreboard, scores), 400);
          }
        }, 500);
      } else {
        setTimeout(() => {
          a.classList.remove('flipped');
          b.classList.remove('flipped');
          flipped = [];
          locked = false;
          if (playerCount === 2) {
            currentPlayer = 1 - currentPlayer;
            if (turnBanner) setTurnBanner(turnBanner, currentPlayer, TURN_COLORS);
          }
        }, 800);
      }
    }
  }

  cards.forEach((card) => card.addEventListener('pointerup', onCardTap));
  cleanupFns.push(() => cards.forEach((card) => card.removeEventListener('pointerup', onCardTap)));
}

function celebrate(playerCount, turnBanner, scoreboard, scores) {
  sfx.celebrate();
  const toast = document.createElement('div');
  toast.className = 'confirm-toast visible';
  toast.style.position = 'absolute';
  toast.style.bottom = '2rem';
  toast.style.left = '50%';
  toast.style.transform = 'translateX(-50%)';
  toast.textContent = playerCount === 2
    ? (scores[0] === scores[1] ? 'Gelijkspel! 🎉' : `Speler ${scores[0] > scores[1] ? 1 : 2} wint! 🎉`)
    : 'Goed gedaan! 🎉';
  stage.appendChild(toast);
  setTimeout(() => {
    toast.remove();
    startRound(playerCount, turnBanner, scoreboard);
  }, 2000);
}

export function destroy() {
  cleanupFns.forEach((fn) => fn());
  cleanupFns = [];
}
