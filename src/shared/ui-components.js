// Shared portal + in-game chrome. Every game mounts the same HUD and the same
// reward screen so the console language a child learns on one mission carries
// to all nine.

import { sfx } from '../shell/audio.js';
import { onTap } from '../shell/pointer.js';

// ── Porthole ────────────────────────────────────────────────────────────
// The recurring ring of instrument glass. The mission colour enters the UI
// only through this component, as an inner glow — never as a border, a fill
// or a second accent inside a control.
export function porthole(content, { className = '', color, lit = false, duration } = {}) {
  const style = [
    color ? `--mission-color:${color}` : '',
    duration ? `animation-duration:${duration}s` : '',
  ].filter(Boolean).join(';');
  return `<span class="port${lit ? ' port--lit' : ''} ${className}"${style ? ` style="${style}"` : ''}>${content}</span>`;
}

// Thin amber progress bar. Replaces the old row of lamps: the same level data,
// but a bar is legible from the back of a room where five dots have to be
// counted one by one.
export function progressBar(value, total) {
  const pct = Math.max(0, Math.min(100, Math.round((value / total) * 100)));
  return `<span class="bar" role="img" aria-label="Level ${value} van ${total}"><span class="bar__fill" style="width:${pct}%"></span></span>`;
}

// ── In-game HUD ─────────────────────────────────────────────────────────
export function createHud(container, {
  title,
  onExit,
  level = null,
  players = 1,
  showScore = false,
  showTurn = false,
  meter = null,
}) {
  const hud = document.createElement('div');
  hud.className = 'hud';

  const backBtn = document.createElement('button');
  backBtn.className = 'key key--bar key--back';
  backBtn.setAttribute('aria-label', 'Terug naar missiekeuze');
  // onTap, not a bare pointerup: the back key sits in the top-left corner of
  // every game, which is exactly where a hand crossing the board on its way to
  // somewhere else lifts off. Leaving a mission by accident is the one
  // misfire in this app that loses a child their place.
  const offBack = onTap(backBtn, () => {
    sfx.back();
    onExit();
  });

  const titleEl = document.createElement('div');
  titleEl.className = 'hud__title';
  titleEl.textContent = title;

  const spacer = document.createElement('div');
  spacer.className = 'hud__spacer';

  hud.append(backBtn, titleEl, spacer);

  // Turn indicator lives in the HUD row rather than floating over the board:
  // as a centred overlay it collided with each game's hint strip.
  let turnEl = null;
  if (showTurn && players > 1) {
    turnEl = document.createElement('div');
    turnEl.className = 'hud__turn';
    hud.appendChild(turnEl);
  }

  // Readouts are separated by 1px hairlines rather than each being boxed in
  // its own pill — the way a real panel groups dials.
  let needsSep = false;
  const sep = () => {
    if (!needsSep) return;
    const s = document.createElement('div');
    s.className = 'hud__sep';
    hud.appendChild(s);
  };

  const stat = (label, value, extraClass = '') => {
    const el = document.createElement('div');
    el.className = `stat ${extraClass}`.trim();
    el.innerHTML = `${label}<span class="stat__value">${value}</span>`;
    hud.appendChild(el);
    needsSep = true;
    return el.querySelector('.stat__value');
  };

  let levelValue = null;
  if (level !== null) {
    sep();
    levelValue = stat('Level', level);
  }

  const scoreValues = [];
  if (showScore) {
    sep();
    const scores = document.createElement('div');
    scores.className = 'hud__scores';
    for (let i = 0; i < players; i++) {
      const el = document.createElement('div');
      el.className = players > 1 ? `stat stat--p${i + 1}` : 'stat stat--score';
      el.innerHTML = `${players > 1 ? `P${i + 1}` : 'Score'}<span class="stat__value">0</span>`;
      scores.appendChild(el);
      scoreValues.push(el.querySelector('.stat__value'));
    }
    hud.appendChild(scores);
    needsSep = true;
  }

  let meterFill = null;
  if (meter) {
    sep();
    const el = document.createElement('div');
    el.className = 'stat';
    el.innerHTML = `${meter}<span class="stat__meter"><i></i></span>`;
    hud.appendChild(el);
    meterFill = el.querySelector('i');
    needsSep = true;
  }

  container.appendChild(hud);

  const banner = document.createElement('div');
  banner.className = 'banner';
  container.appendChild(banner);

  let bannerTimer = null;

  return {
    setLevel(n) {
      if (levelValue) levelValue.textContent = n;
    },
    setScore(playerIndex, value) {
      const el = scoreValues[playerIndex];
      if (el) el.textContent = value;
    },
    // 0..1 — the pipe pressure, the fuel level, whatever the game meters.
    setMeter(fraction) {
      if (meterFill) meterFill.style.width = `${Math.max(0, Math.min(1, fraction)) * 100}%`;
    },
    setTurn(playerIndex) {
      if (!turnEl) return;
      turnEl.textContent = `Astronaut ${playerIndex + 1} mag`;
      turnEl.style.background = playerIndex % 2 === 0 ? 'var(--p1)' : 'var(--p2)';
    },
    // Shows a centered message. `sub` renders as a small mono caption.
    banner(text, { sub = '', ms = 1600, hint = false } = {}) {
      clearTimeout(bannerTimer);
      banner.className = `banner${hint ? ' banner--hint' : ''}`;
      banner.innerHTML = sub
        ? `${text}<span class="banner__sub">${sub}</span>`
        : text;
      requestAnimationFrame(() => banner.classList.add('is-visible'));
      bannerTimer = setTimeout(() => banner.classList.remove('is-visible'), ms);
    },
    hideBanner() {
      clearTimeout(bannerTimer);
      banner.classList.remove('is-visible');
    },
    destroy() {
      clearTimeout(bannerTimer);
      offBack();
    },
  };
}

// ── Mission complete ────────────────────────────────────────────────────
// The reward moment gets its own screen instead of a banner that slides past.
// Finishing a level is the payoff, and it is the one place where the child
// decides what happens next rather than being dropped into the next level.
export function showMissionComplete(container, {
  icon = '⭐',
  color,
  mission,
  level,
  stars = 1,
  title = 'Missie voltooid!',
  onNext,
  onRetry,
  onHome,
}) {
  const el = document.createElement('div');
  el.className = 'done';
  el.innerHTML = `
    <div class="done__medal">
      <div class="done__wave"></div>
      <div class="port__halo"></div>
      <div class="done__spark done__spark--a">✨</div>
      <div class="done__spark done__spark--b">✨</div>
      <div class="done__spark done__spark--c">✨</div>
      ${porthole(icon, { className: 'done__port port--lit', color })}
    </div>
    <div class="done__eyebrow">${mission} · Level ${level}</div>
    <h2 class="done__title">${title}</h2>
    <div class="done__stars" role="img" aria-label="${stars} van 3 sterren">
      ${[0, 1, 2].map((i) => (i < stars
        ? `<span class="done__star" style="animation-delay:${0.14 + i * 0.13}s">⭐</span>`
        : '<span class="done__star done__star--off">⭐</span>')).join('')}
    </div>
    <div class="done__actions">
      <button class="btn" data-act="next">Volgend level</button>
      <button class="btn btn--ghost" data-act="retry">Nog een keer</button>
      <button class="key key--bar" data-act="home" aria-label="Terug naar de missies">🏠</button>
    </div>
  `;
  container.appendChild(el);
  requestAnimationFrame(() => el.classList.add('is-visible'));

  // The stars pop in on a CSS delay; each one gets a chime on the same clock, so
  // the reward is heard being counted out rather than arriving as one noise. The
  // game has already played the fanfare — these land on top of it, and `star`
  // sits high enough in the scale not to muddy it.
  const chimes = [];
  for (let i = 0; i < stars; i++) {
    chimes.push(setTimeout(() => sfx.star(), 200 + i * 130));
  }

  const acts = { next: onNext, retry: onRetry, home: onHome };
  // Bound per button rather than delegated from the panel: this screen covers
  // the whole board, and a delegated pointerup would fire for a finger that
  // came down on the backdrop and lifted over "Volgend level".
  const offs = [...el.querySelectorAll('[data-act]')].map((btn) =>
    onTap(btn, () => {
      sfx.select();
      close();
      acts[btn.dataset.act]?.();
    })
  );

  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    chimes.forEach(clearTimeout);
    offs.forEach((off) => off());
    el.remove();
  }

  return { close };
}
