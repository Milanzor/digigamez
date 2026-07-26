import { navigate } from '../shell/router.js';
import { setItem } from '../shell/storage.js';
import { sfx } from '../shell/audio.js';

export function renderPlayerSelectView(container) {
  container.innerHTML = `
    <div class="player-select-view">
      <h1 class="section-title">Met hoeveel spelen jullie?</h1>
      <div class="player-cards">
        <button class="player-card" data-players="1">
          <div class="player-card-icon">🧒</div>
          <div class="player-card-label">1 speler</div>
        </button>
        <button class="player-card" data-players="2">
          <div class="player-card-icon">🧒🧒</div>
          <div class="player-card-label">2 spelers</div>
        </button>
      </div>
    </div>
  `;

  const cards = container.querySelectorAll('.player-card');
  const onPick = (e) => {
    const n = Number(e.currentTarget.dataset.players);
    sfx.tap();
    setItem('playerCount', n);
    navigate('/rooster');
  };
  cards.forEach((c) => c.addEventListener('pointerup', onPick));

  return () => cards.forEach((c) => c.removeEventListener('pointerup', onPick));
}
