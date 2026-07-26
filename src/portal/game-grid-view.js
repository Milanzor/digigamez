import { navigate } from '../shell/router.js';
import { getItem } from '../shell/storage.js';
import { GAMES } from '../games/game-registry.js';
import { sfx } from '../shell/audio.js';

export function renderGameGridView(container) {
  const playerCount = getItem('playerCount', 1);

  const cardsHtml = GAMES.map(
    (g) => `
    <button class="game-card" data-slug="${g.slug}" style="--card-color:${g.color}">
      <div class="game-card-icon">${g.icon}</div>
      <div class="game-card-title">${g.title}</div>
      <div class="game-card-age">${g.ageLabel}</div>
      ${g.supportsTwoPlayers ? '<div class="game-card-badge">2 spelers</div>' : ''}
    </button>
  `
  ).join('');

  container.innerHTML = `
    <div class="grid-view">
      <div class="grid-header">
        <button class="icon-btn grid-back-btn" id="grid-back">⬅️</button>
        <h1 class="section-title">Kies een spel</h1>
        <button class="icon-btn grid-players-btn" id="grid-players">${playerCount === 2 ? '🧒🧒' : '🧒'}</button>
      </div>
      <div class="game-grid">${cardsHtml}</div>
    </div>
  `;

  const backBtn = container.querySelector('#grid-back');
  const playersBtn = container.querySelector('#grid-players');
  const onBack = () => navigate('/spelers');
  backBtn.addEventListener('pointerup', onBack);
  playersBtn.addEventListener('pointerup', onBack);

  const cards = container.querySelectorAll('.game-card');
  const onPick = (e) => {
    sfx.tap();
    const slug = e.currentTarget.dataset.slug;
    navigate(`/spel/${slug}`);
  };
  cards.forEach((c) => c.addEventListener('pointerup', onPick));

  return () => {
    backBtn.removeEventListener('pointerup', onBack);
    playersBtn.removeEventListener('pointerup', onBack);
    cards.forEach((c) => c.removeEventListener('pointerup', onPick));
  };
}
