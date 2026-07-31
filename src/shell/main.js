import '../styles/fonts.css';
import '../styles/tokens.css';
import '../styles/global.css';
import '../portal/portal.css';

import { registerRoute, startRouter } from './router.js';
import { mountStarfield } from './starfield.js';
import { applyCalm, watchMotionPreference } from './settings.js';
import { startIdleWatch } from './idle.js';
import { unlockAudio } from './audio.js';
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
watchMotionPreference();
startRouter(document.getElementById('app'));
startIdleWatch();

// The audio context is built on the first touch anywhere rather than only on the
// start button. Creating and resuming it takes a moment, and a context that is
// still suspended silently drops the notes scheduled into it — which is why the
// very first tap after a reload straight into #/rooster used to make no sound.
// pointerdown, not pointerup, so it is already running by the time the tap that
// created it wants to play something.
document.addEventListener('pointerdown', () => unlockAudio(), { once: true });

// Kiosk hygiene: suppress the browser gestures that would otherwise break a
// wall-mounted touchscreen (pull-to-refresh, pinch-zoom, long-press menus).
// [data-scroll] is the one opt-out: a region that genuinely scrolls (the
// settings list on an odd aspect ratio) has to keep its touchmove, or it can
// only be scrolled with a mouse wheel.
document.addEventListener(
  'touchmove',
  (e) => {
    if (e.target instanceof Element && e.target.closest('[data-scroll]')) return;
    e.preventDefault();
  },
  { passive: false }
);
document.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('gesturestart', (e) => e.preventDefault());
document.addEventListener('dblclick', (e) => e.preventDefault());
