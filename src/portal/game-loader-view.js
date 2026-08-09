import { navigate } from '../shell/router.js';
import { getItem, setItem } from '../shell/storage.js';
import { getGame } from '../games/game-registry.js';
import { getLevel } from '../shell/progress.js';
import { porthole } from '../shared/ui-components.js';
import { onTap } from '../shell/pointer.js';
import { sfx } from '../shell/audio.js';

// A dynamic import that fails is remembered as failed. The module map keeps the
// error for the whole life of the page, so calling `import()` on that same URL
// again returns the same failure *without going near the network* — a mission
// whose module dropped one request is then broken until the page is reloaded,
// however often a child taps it.
//
// That is what makes a single network hiccup on a school network look like
// "these three games are broken and the rest are fine", and why it looks
// permanent: a board runs one page load all day, and the grid prefetches a
// module the moment a finger lands on its row, so a hand sweeping across the
// archive can poison several missions in one bad moment without opening any of
// them. Reloading is the only thing that clears it, so that is what the retry
// does — and the first one happens by itself, because nobody at a classroom
// board should have to know this.
//
// Once per mission per session: the flag lives in sessionStorage so a genuinely
// broken module lands on the error screen the second time instead of reloading
// forever. If sessionStorage cannot be read the answer is "already tried",
// which turns the automatic reload off rather than risking a loop.
const RELOAD_KEY = 'digigamez:herladen:';

function alreadyReloadedFor(slug) {
  try {
    return sessionStorage.getItem(RELOAD_KEY + slug) === '1';
  } catch {
    return true;
  }
}

function rememberReloadFor(slug) {
  try {
    sessionStorage.setItem(RELOAD_KEY + slug, '1');
    return true;
  } catch {
    return false;
  }
}

function forgetReloadFor(slug) {
  try {
    sessionStorage.removeItem(RELOAD_KEY + slug);
  } catch {
    // Nothing to clean up if it could never be written.
  }
}

export async function renderGameLoaderView(container, params) {
  const game = getGame(params.slug);
  if (!game) {
    navigate('/rooster');
    return;
  }

  // Remembered so the grid can light up where the child left off.
  setItem('lastGame', game.slug);

  container.innerHTML = `
    <div class="loading">
      <div class="loading__inner">
        <div class="loading__medal">
          <div class="loading__orbit"></div>
          ${porthole(game.icon, { className: 'loading__port', color: game.color })}
        </div>
        <div class="loading__label">${game.title} laden…</div>
      </div>
    </div>
  `;

  let mod;
  try {
    mod = await game.load();
    // It started, so whatever went wrong before is over: let this mission have
    // its free reload again the next time something drops.
    forgetReloadFor(game.slug);
  } catch (err) {
    console.error(`Kon spel ${game.slug} niet laden`, err);

    // The route is already `#/spel/<slug>`, so a reload comes straight back
    // here — with an empty module map, which is the entire point.
    if (!alreadyReloadedFor(game.slug) && rememberReloadFor(game.slug)) {
      window.location.reload();
      return;
    }

    container.innerHTML = `
      <div class="loading">
        <div class="loading__inner">
          <div class="loading__medal">
            <div class="loading__orbit"></div>
            ${porthole(game.icon, { className: 'loading__port', color: game.color })}
          </div>
          <div class="loading__label">${game.title} wil niet starten</div>
          <div class="loading__actions">
            <button class="btn" data-act="retry">Probeer opnieuw</button>
            <button class="btn btn--ghost" data-act="back">Terug naar de missies</button>
          </div>
          <div class="loading__why">${String(err?.message || err).slice(0, 160)}</div>
        </div>
      </div>
    `;

    // onTap, not a bare pointerup: this screen appears under a hand that is
    // still moving, and both of these buttons throw away what the child was
    // doing.
    const offs = [
      onTap(container.querySelector('[data-act="retry"]'), () => {
        sfx.select();
        // Deliberately a reload and not another `game.load()`: the module map
        // has the failure cached, so retrying in place can only fail again.
        forgetReloadFor(game.slug);
        window.location.reload();
      }),
      onTap(container.querySelector('[data-act="back"]'), () => {
        sfx.back();
        navigate('/rooster');
      }),
    ];
    return () => offs.forEach((off) => off());
  }

  const view = document.createElement('div');
  view.className = 'game-view';
  container.replaceChildren(view);

  // Clamped to what this mission actually seats: the crew choice is a property
  // of the board, not of the game, so a solo game asked for two players would
  // otherwise render a turn indicator nobody can use.
  const players = Math.max(1, Math.min(getItem('playerCount', 1), game.maxPlayers ?? 1));
  const onExit = () => navigate('/rooster');

  mod.init(view, {
    players,
    title: game.title,
    slug: game.slug,
    // The reward screen shows the mission in its own porthole, so a game needs
    // to know its own icon and play colour rather than hardcoding a copy.
    icon: game.icon,
    color: game.color,
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
