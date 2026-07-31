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
//
// The OS-level reduced-motion preference is folded in here rather than into a
// second `@media` block in the stylesheet. Both are the same request from two
// different people, and with one attribute deciding it there is only one list of
// animations to keep up to date instead of two that drift apart.
const reducedMotion = () =>
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

export function applyCalm() {
  document.documentElement.toggleAttribute('data-calm', getSetting('calm') || reducedMotion());
}

// A teacher can flip the OS setting mid-session; the board should follow without
// a reload.
export function watchMotionPreference() {
  window.matchMedia?.('(prefers-reduced-motion: reduce)')
    .addEventListener('change', applyCalm);
}
