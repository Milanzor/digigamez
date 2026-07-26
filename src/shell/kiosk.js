// Kiosk-mode helpers for a digiboard that runs unattended for long sessions.
//
// The target board's Chromium predates the unprefixed Fullscreen API
// (Chromium 71) and Wake Lock entirely (Chromium 84), so both are probed
// rather than assumed. Neither is essential: failing to go fullscreen or to
// hold a wake lock degrades the experience but never breaks a game.

let wakeLock = null;

export async function enterFullscreen() {
  const el = document.documentElement;
  const request = el.requestFullscreen
    || el.webkitRequestFullscreen
    || el.mozRequestFullScreen
    || el.msRequestFullscreen;
  const current = document.fullscreenElement || document.webkitFullscreenElement;

  if (!request || current) return;
  try {
    // The options bag is ignored by older implementations, which is harmless.
    await request.call(el, { navigationUI: 'hide' });
  } catch {
    try {
      await request.call(el);
    } catch {
      // Denied or unsupported — carry on windowed.
    }
  }
}

export async function requestWakeLock() {
  if (!('wakeLock' in navigator)) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    document.addEventListener('visibilitychange', async () => {
      if (wakeLock !== null && document.visibilityState === 'visible') {
        try {
          wakeLock = await navigator.wakeLock.request('screen');
        } catch {
          // Lock can be refused after backgrounding; not fatal.
        }
      }
    });
  } catch {
    // Unavailable or denied — the screen may dim on its own schedule.
  }
}
