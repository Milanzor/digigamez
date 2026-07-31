// Kiosk preferences an adult sets once and a child never has to think about:
// sound, volume and whether the backdrop drifts.
//
// They live under their own `set:` key prefix, which is what makes "wis alle
// voortgang" safe to implement as a prefix sweep: the levels, drawings and
// machines go, the way this particular digiboard is configured stays.

import { getItem, setItem } from './storage.js';

const DEFAULTS = {
  sound: true,
  volume: 'gewoon', // zacht | gewoon | hard
  calm: false, // freeze the drifting starfield and planets
};

export function getSetting(key) {
  const value = getItem(`set:${key}`, DEFAULTS[key]);
  // A stored value from an older build could be the wrong shape; falling back
  // to the default beats handing a game a nonsense setting.
  return typeof value === typeof DEFAULTS[key] ? value : DEFAULTS[key];
}

export function setSetting(key, value) {
  setItem(`set:${key}`, value);
  if (key === 'calm') applyCalm();
}

// The starfield drift is pure CSS, so "rustig" is one attribute on the root
// element rather than animations to chase down and stop.
export function applyCalm() {
  document.documentElement.toggleAttribute('data-calm', getSetting('calm'));
}
