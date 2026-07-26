import '../styles/tokens.css';
import '../styles/global.css';
import '../portal/portal.css';

import { registerRoute, startRouter } from './router.js';
import { mountStarfield } from './starfield.js';
import { renderStartView } from '../portal/start-view.js';
import { renderPlayerSelectView } from '../portal/player-select-view.js';
import { renderGameGridView } from '../portal/game-grid-view.js';
import { renderGameLoaderView } from '../portal/game-loader-view.js';

registerRoute('/', renderStartView);
registerRoute('/spelers', renderPlayerSelectView);
registerRoute('/rooster', renderGameGridView);
registerRoute('/spel/:slug', renderGameLoaderView);

// Flexbox `gap` only landed in Chromium 84 and the target digiboard is older,
// where it is silently ignored and every control ends up flush against its
// neighbour. Feature-test it once and let CSS restore the spacing with
// margins; @supports can't be used here because `gap` is also valid on grid,
// so it reports true even where flex ignores it.
function detectFlexGap() {
  const probe = document.createElement('div');
  probe.style.display = 'flex';
  probe.style.flexDirection = 'row';
  probe.style.gap = '20px';
  probe.style.position = 'absolute';
  probe.style.visibility = 'hidden';
  probe.appendChild(document.createElement('i'));
  probe.appendChild(document.createElement('i'));
  document.body.appendChild(probe);
  const supported = probe.scrollWidth >= 20;
  probe.remove();
  if (!supported) document.documentElement.className += ' no-flexgap';
}

detectFlexGap();
mountStarfield();
startRouter(document.getElementById('app'));

// Kiosk hygiene: suppress the browser gestures that would otherwise break a
// wall-mounted touchscreen (pull-to-refresh, pinch-zoom, long-press menus).
document.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
document.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault());
