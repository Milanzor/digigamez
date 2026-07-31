import { navigate } from '../shell/router.js';
import { enterFullscreen, requestWakeLock } from '../shell/kiosk.js';
import { unlockAudio, sfx } from '../shell/audio.js';
import { onTap } from '../shell/pointer.js';
import { GAMES } from '../games/game-registry.js';

// How long the rocket gets to clear the frame. `sfx.launch()` is a second and a
// half of engine and the screen used to be gone within the first fifty
// milliseconds of it; half a second of climb is enough for the sound and the
// picture to be telling the same story without the wait becoming one.
const LAUNCH_MS = 520;

export function renderStartView(container) {
  container.innerHTML = `
    <div class="launch">
      <div class="launch__eyebrow">Missiecontrole</div>
      <div class="launch__medal">
        <div class="launch__trail"></div>
        <div class="port__halo"></div>
        <div class="port port--lit launch__rocket">🚀</div>
      </div>
      <h1 class="launch__title">Digi<em>gamez</em></h1>
      <p class="launch__sub">Klaar voor de ruimtereis?</p>
      <button class="btn launch__btn" id="start-btn">Start de raket</button>
      <div class="launch__meta">
        <span>${GAMES.length} missies</span><i></i><span>2–7 jaar</span><i></i><span>Digibord &amp; tablet</span>
      </div>
      <button class="key key--bar launch__settings" id="start-settings" aria-label="Instellingen">⚙️</button>
    </div>
  `;

  const launch = container.querySelector('.launch');
  const btn = container.querySelector('#start-btn');
  const settingsBtn = container.querySelector('#start-settings');

  let liftoff = 0;
  let launching = false;

  const onStart = async () => {
    // A child pressing a big amber button presses it three times. Without this
    // the rocket restarts its climb on each press and the engines stack.
    if (launching) return;
    launching = true;

    unlockAudio();
    sfx.launch();
    launch.classList.add('is-launching');

    // Kicked off before anything is awaited, because the Fullscreen API only
    // grants the request while it is still inside the gesture that asked.
    const fullscreen = enterFullscreen();

    // "Rustig" and the OS reduced-motion preference skip the climb instead of
    // sitting through half a second of a screen that is not moving.
    const climb = document.documentElement.hasAttribute('data-calm') ? 0 : LAUNCH_MS;
    const flight = new Promise((resolve) => { liftoff = setTimeout(resolve, climb); });

    await fullscreen;
    await requestWakeLock();
    await flight;
    navigate('/spelers');
  };

  const onSettings = () => {
    unlockAudio();
    sfx.select();
    navigate('/instellingen');
  };

  const offStart = onTap(btn, onStart);
  const offSettings = onTap(settingsBtn, onSettings);

  return () => {
    clearTimeout(liftoff);
    offStart();
    offSettings();
  };
}
