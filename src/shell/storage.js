const PREFIX = 'digigamez:';

export function getItem(key, fallback = null) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export function setItem(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // storage unavailable (private mode etc.) — fail silently, non-critical
  }
}

export function removeItem(key) {
  try {
    localStorage.removeItem(PREFIX + key);
  } catch {
    // see setItem
  }
}

// Every key this app owns, with the prefix stripped. Lets the settings screen
// wipe progress by pattern instead of by a hand-maintained list — a new game's
// save key is covered the day it is added — while never touching whatever else
// shares this origin's localStorage.
export function appKeys() {
  const out = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(PREFIX)) out.push(k.slice(PREFIX.length));
    }
  } catch {
    return out;
  }
  return out;
}
