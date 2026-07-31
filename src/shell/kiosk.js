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

export function isFullscreen() {
  return !!document.fullscreenElement;
}

// The settings screen needs a way back out as well — a laptop driving the board
// during a lesson is not always meant to stay locked to one window.
export async function toggleFullscreen() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await enterFullscreen();
  } catch {
    // Denied/unsupported — the caller reads the real state back afterwards.
  }
  return isFullscreen();
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
