// Per-game level progression, persisted locally.
//
// Every game reports the highest level a child reached, and the portal
// renders that back as a row of lamps on the mission button. This is what
// gives the hub a sense of progression across sessions instead of every
// game restarting from scratch.

import { getItem, setItem } from './storage.js';

export const MAX_LAMPS = 5;

export function getLevel(slug) {
  const n = getItem(`level:${slug}`, 1);
  return typeof n === 'number' && n >= 1 ? Math.floor(n) : 1;
}

export function setLevel(slug, level) {
  const clamped = Math.max(1, Math.floor(level));
  if (clamped > getLevel(slug)) setItem(`level:${slug}`, clamped);
}

// Lamp count for the portal display: how many levels are "lit".
export function getLamps(slug) {
  return Math.min(getLevel(slug), MAX_LAMPS);
}

export function resetAll(slugs) {
  slugs.forEach((s) => setItem(`level:${s}`, 1));
}
