import { navigate } from '../shell/router.js';
import { getItem, setItem } from '../shell/storage.js';
import { sfx } from '../shell/audio.js';
import { onTap, onTapAll } from '../shell/pointer.js';
import { GAMES } from '../games/game-registry.js';

export function renderPlayerSelectView(container) {
  // Reflect the crew the board was last set to instead of showing two blank
  // options, and count the co-op missions off the registry so the badge can
  // never drift from the actual grid.
  const chosen = getItem('playerCount', 1);
  const coop = GAMES.filter((g) => g.maxPlayers > 1).length;

  container.innerHTML = `
    <div class="crew">
      <div class="bar-top">
        <button class="key key--bar key--back" id="crew-back" aria-label="Terug naar het startscherm"></button>
        <div class="eyebrow">Crew samenstellen</div>
      </div>
      <div class="crew__body">
        <h1 class="screen-title">Wie gaan er mee?</h1>
        <div class="crew__options">
          <button class="crew__card${chosen === 1 ? ' is-chosen' : ''}" data-players="1">
            <span class="port${chosen === 1 ? ' port--lit' : ''} crew__figures">🧑‍🚀</span>
            <span class="crew__label">1 astronaut</span>
            <span class="crew__note">Jij vliegt alleen</span>
            ${chosen === 1
              ? '<span class="crew__badge">Gekozen</span>'
              : `<span class="tag">${GAMES.length} missies</span>`}
          </button>
          <button class="crew__card${chosen === 2 ? ' is-chosen' : ''}" data-players="2">
            <span class="port${chosen === 2 ? ' port--lit' : ''} crew__figures crew__figures--pair">🧑‍🚀🧑‍🚀</span>
            <span class="crew__label">2 astronauten</span>
            <span class="crew__note">Samen op één scherm</span>
            ${chosen === 2
              ? '<span class="crew__badge">Gekozen</span>'
              : `<span class="tag">${coop} missies</span>`}
          </button>
        </div>
        <div class="crew__hint">Tik op een kaart om te kiezen</div>
      </div>
    </div>
  `;

  const backBtn = container.querySelector('#crew-back');
  const cards = container.querySelectorAll('.crew__card');

  const onBack = () => {
    sfx.back();
    navigate('/');
  };
  const onPick = (e) => {
    const n = Number(e.currentTarget.dataset.players);
    sfx.select();
    setItem('playerCount', n);
    navigate('/rooster');
  };

  // onTap rather than a bare pointerup listener: pointerup fires on whatever the
  // finger happens to be over when it lifts, so a child dragging across the
  // board and letting go on a card used to count as choosing it. onTap wants the
  // press to have started on the same element and to have stayed roughly still.
  const offBack = onTap(backBtn, onBack);
  const offCards = onTapAll(cards, onPick);

  return () => {
    offBack();
    offCards();
  };
}
