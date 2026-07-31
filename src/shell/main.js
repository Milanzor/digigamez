import '../styles/tokens.css';
import '../styles/global.css';
import '../portal/portal.css';

import { registerRoute, startRouter } from './router.js';
import { mountStarfield } from './starfield.js';
import { applyCalm } from './settings.js';
import { renderStartView } from '../portal/start-view.js';
import { renderPlayerSelectView } from '../portal/player-select-view.js';
import { renderGameGridView } from '../portal/game-grid-view.js';
import { renderGameLoaderView } from '../portal/game-loader-view.js';
import { renderSettingsView } from '../portal/settings-view.js';

registerRoute('/', renderStartView);
registerRoute('/spelers', renderPlayerSelectView);
registerRoute('/rooster', renderGameGridView);
registerRoute('/instellingen', renderSettingsView);
registerRoute('/spel/:slug', renderGameLoaderView);

mountStarfield();
applyCalm();
startRouter(document.getElementById('app'));

// Kiosk hygiene: suppress the browser gestures that would otherwise break a
// wall-mounted touchscreen (pull-to-refresh, pinch-zoom, long-press menus).
document.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
document.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault());
