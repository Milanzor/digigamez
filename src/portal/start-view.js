import { navigate } from '../shell/router.js';
import { enterFullscreen, requestWakeLock } from '../shell/kiosk.js';
import { unlockAudio, sfx } from '../shell/audio.js';

export function renderStartView(container) {
  container.innerHTML = `
    <div class="launch">
      <div class="porthole">
        <div class="launch__inner">
          <div class="launch__eyebrow">Missiecontrole</div>
          <div class="launch__rocket">🚀</div>
          <h1 class="launch__title">Digi<em>gamez</em></h1>
          <p class="launch__sub">Klaar voor de ruimtereis?</p>
          <button class="btn btn--go launch__btn" id="start-btn">Start de raket</button>
        </div>
      </div>
    </div>
  `;

  const btn = container.querySelector('#start-btn');
  const onStart = async () => {
    unlockAudio();
    sfx.launch();
    await enterFullscreen();
    await requestWakeLock();
    navigate('/spelers');
  };
  btn.addEventListener('pointerup', onStart);

  return () => btn.removeEventListener('pointerup', onStart);
}
