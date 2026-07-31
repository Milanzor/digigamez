// Kiosk-mode helpers for a digiboard that runs unattended for long sessions:
// fullscreen (requires a user gesture) and Wake Lock (prevents the screen
// from sleeping/dimming mid-session).

let wakeLock = null;

export async function enterFullscreen() {
  const el = document.documentElement;
  try {
    if (!document.fullscreenElement && el.requestFullscreen) {
      await el.requestFullscreen({ navigationUI: 'hide' });
    }
  } catch {
    // Fullscreen can be denied/unsupported (e.g. during dev) — non-fatal.
  }
}

export async function requestWakeLock() {
  try {
    if ('wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
      document.addEventListener('visibilitychange', async () => {
        if (wakeLock !== null && document.visibilityState === 'visible') {
          wakeLock = await navigator.wakeLock.request('screen');
        }
      });
    }
  } catch {
    // Wake Lock can be unavailable/denied — non-fatal, screen may dim.
  }
}
