import { navigate } from '../shell/router.js';
import { setItem } from '../shell/storage.js';
import { sfx } from '../shell/audio.js';

export function renderPlayerSelectView(container) {
  container.innerHTML = `
    <div class="crew">
      <h1 class="screen-title"><span>Crew samenstellen</span>Wie gaan er mee?</h1>
      <div class="crew__options">
        <button class="crew__card" data-players="1">
          <div class="crew__figures">👨‍🚀</div>
          <div class="crew__label">1 astronaut</div>
          <div class="crew__note">Jij vliegt alleen</div>
        </button>
        <button class="crew__card" data-players="2">
          <div class="crew__figures">👨‍🚀👩‍🚀</div>
          <div class="crew__label">2 astronauten</div>
          <div class="crew__note">Samen op één scherm</div>
        </button>
      </div>
    </div>
  `;

  const cards = container.querySelectorAll('.crew__card');
  const onPick = (e) => {
    const n = Number(e.currentTarget.dataset.players);
    sfx.select();
    setItem('playerCount', n);
    navigate('/rooster');
  };
  cards.forEach((c) => c.addEventListener('pointerup', onPick));

  return () => cards.forEach((c) => c.removeEventListener('pointerup', onPick));
}
