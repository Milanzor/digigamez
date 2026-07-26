// Reusable DOM chrome shared across game modules: back button, mute button,
// turn banner. Kept as plain DOM helpers (not canvas) since they're static
// UI, not part of the animated game loop.

export function createGameChrome({ title, onExit }) {
  const chrome = document.createElement('div');
  chrome.className = 'game-chrome';

  const backBtn = document.createElement('button');
  backBtn.className = 'icon-btn game-back-btn';
  backBtn.setAttribute('aria-label', 'Terug naar overzicht');
  backBtn.innerHTML = '⬅️';
  backBtn.addEventListener('pointerup', () => onExit());

  const titleEl = document.createElement('div');
  titleEl.className = 'game-title';
  titleEl.textContent = title;

  chrome.appendChild(backBtn);
  chrome.appendChild(titleEl);
  return chrome;
}

export function createTurnBanner() {
  const banner = document.createElement('div');
  banner.className = 'turn-banner';
  return banner;
}

export function setTurnBanner(banner, playerIndex, colors) {
  banner.textContent = `Speler ${playerIndex + 1} is aan de beurt`;
  banner.style.background = colors[playerIndex % colors.length];
}

export function createScoreboard(players) {
  const board = document.createElement('div');
  board.className = 'scoreboard';
  const entries = players.map((_, i) => {
    const el = document.createElement('div');
    el.className = `score-entry player-${i + 1}`;
    el.textContent = `Speler ${i + 1}: 0`;
    board.appendChild(el);
    return el;
  });
  return {
    el: board,
    update(index, score) {
      entries[index].textContent = `Speler ${index + 1}: ${score}`;
    },
  };
}

export function showConfirmToast(container, text, ms = 1600) {
  const toast = document.createElement('div');
  toast.className = 'confirm-toast';
  toast.textContent = text;
  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add('visible'));
  setTimeout(() => {
    toast.classList.remove('visible');
    setTimeout(() => toast.remove(), 300);
  }, ms);
}
