import '../portal/portal.css';
import { registerRoute, startRouter } from './router.js';
import { renderStartView } from '../portal/start-view.js';
import { renderPlayerSelectView } from '../portal/player-select-view.js';
import { renderGameGridView } from '../portal/game-grid-view.js';
import { renderGameLoaderView } from '../portal/game-loader-view.js';

registerRoute('/', renderStartView);
registerRoute('/spelers', renderPlayerSelectView);
registerRoute('/rooster', renderGameGridView);
registerRoute('/spel/:slug', renderGameLoaderView);

const app = document.getElementById('app');
startRouter(app);

// Prevent iOS/Android-style pull-to-refresh & pinch-zoom gestures that would
// break the kiosk experience on a touchscreen.
document.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
document.addEventListener('contextmenu', (e) => e.preventDefault());
