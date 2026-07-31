// Idle reset for a board that is left standing.
//
// A digiboard is abandoned mid-screen constantly: the bell goes, the lesson
// moves on, and the archive sits open until someone walks past. Sending it back
// to the launch screen means the next child arrives at the start of the flow
// rather than halfway through someone else's choice.
//
// Deliberately only armed on the portal screens. An open game is never
// interrupted: a four-year-old staring at a puzzle for five minutes is thinking,
// not idle, and the two are indistinguishable from out here.

import { navigate } from './router.js';

const IDLE_MS = 4 * 60 * 1000;
const WATCHED = new Set(['/spelers', '/rooster', '/instellingen']);

const currentPath = () => window.location.hash.replace(/^#/, '') || '/';

export function startIdleWatch() {
  let timer = 0;
  let lastArmed = 0;

  const arm = () => {
    clearTimeout(timer);
    lastArmed = performance.now();
    if (!WATCHED.has(currentPath())) return;
    timer = setTimeout(() => {
      // Re-checked on the way out as well: the route can have changed to a game
      // in the meantime, and this timer must never pull a child out of one.
      if (WATCHED.has(currentPath())) navigate('/');
    }, IDLE_MS);
  };

  // A moving mouse counts as somebody being there, but it fires hundreds of
  // times a second and the timer only needs second-level resolution, so it is
  // rearmed at most once a second.
  const armThrottled = () => {
    if (performance.now() - lastArmed > 1000) arm();
  };

  for (const type of ['pointerdown', 'keydown', 'wheel']) {
    window.addEventListener(type, arm, { passive: true });
  }
  window.addEventListener('pointermove', armThrottled, { passive: true });
  window.addEventListener('hashchange', arm);
  arm();
}
