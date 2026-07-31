// Per-game level progression, persisted locally.
//
// Every game reports the highest level a child reached, and the portal
// renders that back as a progress bar on the mission row. This is what
// gives the hub a sense of progression across sessions instead of every
// game restarting from scratch.

import { getItem, setItem, removeItem, appKeys } from './storage.js';

export const MAX_LAMPS = 5;

export function getLevel(slug) {
  const n = getItem(`level:${slug}`, 1);
  return typeof n === 'number' && n >= 1 ? Math.floor(n) : 1;
}

export function setLevel(slug, level) {
  const clamped = Math.max(1, Math.floor(level));
  if (clamped > getLevel(slug)) setItem(`level:${slug}`, clamped);
}

// How much of the five-level ladder is filled in, for the portal progress bar.
export function getLamps(slug) {
  return Math.min(getLevel(slug), MAX_LAMPS);
}

// The three reward stars, mapped onto that same ladder. Deliberately not a
// performance grade: none of these games measures how *well* a level was
// solved, and inventing a score would make the stars arbitrary. Tying them to
// progress keeps them honest and still gives a child something to climb.
export function starsForLevel(level) {
  const reached = Math.min(Math.max(1, Math.floor(level)), MAX_LAMPS);
  return Math.max(1, Math.min(3, Math.ceil((reached / MAX_LAMPS) * 3)));
}

// Wipes everything the children built up: every level, the saved drawing, the
// machine on the workbench, the last crew and difficulty choice. Swept by
// prefix rather than from a list of slugs, so a new game's save key is included
// the day that game is added; the `set:` preferences are deliberately spared.
export function resetProgress() {
  appKeys()
    .filter((key) => !key.startsWith('set:'))
    .forEach(removeItem);
}
