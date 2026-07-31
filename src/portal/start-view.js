import { navigate } from '../shell/router.js';
import { enterFullscreen, requestWakeLock } from '../shell/kiosk.js';
import { unlockAudio, sfx } from '../shell/audio.js';
import { GAMES } from '../games/game-registry.js';

export function renderStartView(container) {
  container.innerHTML = `
    <div class="launch">
      <div class="launch__eyebrow">Missiecontrole</div>
      <div class="launch__medal">
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

  const btn = container.querySelector('#start-btn');
  const settingsBtn = container.querySelector('#start-settings');

  const onStart = async () => {
    unlockAudio();
    sfx.launch();
    await enterFullscreen();
    await requestWakeLock();
    navigate('/spelers');
  };
  const onSettings = () => {
    unlockAudio();
    sfx.select();
    navigate('/instellingen');
  };
  btn.addEventListener('pointerup', onStart);
  settingsBtn.addEventListener('pointerup', onSettings);

  return () => {
    btn.removeEventListener('pointerup', onStart);
    settingsBtn.removeEventListener('pointerup', onSettings);
  };
}
