import { navigate } from '../shell/router.js';
import { getItem } from '../shell/storage.js';
import { getGame } from '../games/game-registry.js';
import { getLevel } from '../shell/progress.js';

export async function renderGameLoaderView(container, params) {
  const game = getGame(params.slug);
  if (!game) {
    navigate('/rooster');
    return;
  }

  container.innerHTML = `
    <div class="loading">
      <div>
        <div class="mission__icon">${game.icon}</div>
        <div class="loading__label">${game.title} laden…</div>
      </div>
    </div>
  `;

  let mod;
  try {
    mod = await game.load();
  } catch (err) {
    console.error(`Kon spel ${game.slug} niet laden`, err);
    container.innerHTML = `
      <div class="loading">
        <div>
          <div class="loading__label">Dit spel wil niet starten</div>
          <button class="btn" id="load-back">Terug naar de missies</button>
        </div>
      </div>
    `;
    container
      .querySelector('#load-back')
      .addEventListener('pointerup', () => navigate('/rooster'));
    return;
  }

  const view = document.createElement('div');
  view.className = 'game-view';
  container.replaceChildren(view);

  const players = getItem('playerCount', 1);
  const onExit = () => navigate('/rooster');

  mod.init(view, {
    players,
    title: game.title,
    slug: game.slug,
    startLevel: getLevel(game.slug),
    onExit,
  });

  return () => {
    try {
      mod.destroy?.();
    } catch (err) {
      console.error(`Fout bij opruimen van spel ${game.slug}`, err);
    }
  };
}
