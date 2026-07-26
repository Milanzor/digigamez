import { navigate } from '../shell/router.js';
import { enterFullscreen, requestWakeLock } from '../shell/kiosk.js';
import { unlockAudio, sfx } from '../shell/audio.js';

export function renderStartView(container) {
  container.innerHTML = `
    <div class="start-view">
      <div class="start-logo">🎨🚀🧩</div>
      <h1 class="start-title">Digigamez</h1>
      <p class="start-subtitle">Leuke spelletjes voor kinderen!</p>
      <button class="btn start-btn" id="start-btn">▶️ Start</button>
    </div>
  `;

  const btn = container.querySelector('#start-btn');
  const onStart = async () => {
    unlockAudio();
    sfx.success();
    await enterFullscreen();
    await requestWakeLock();
    navigate('/spelers');
  };
  btn.addEventListener('pointerup', onStart);

  return () => btn.removeEventListener('pointerup', onStart);
}
