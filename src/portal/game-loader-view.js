import { navigate } from '../shell/router.js';
import { getItem } from '../shell/storage.js';
import { getGame } from '../games/game-registry.js';

export async function renderGameLoaderView(container, params) {
  const game = getGame(params.slug);
  if (!game) {
    navigate('/rooster');
    return;
  }

  container.innerHTML = `<div class="game-loading">Bezig met laden${game.icon}...</div>`;

  const mod = await game.load();

  const view = document.createElement('div');
  view.className = 'game-view';
  container.replaceChildren(view);

  const players = getItem('playerCount', 1);
  const onExit = () => navigate('/rooster');

  mod.init(view, { players, title: game.title, onExit });

  return () => {
    try {
      mod.destroy?.();
    } catch (err) {
      console.error(`Fout bij opruimen van spel ${game.slug}`, err);
    }
  };
}
