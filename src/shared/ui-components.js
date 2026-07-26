// Unified in-game HUD. Every game mounts one of these so the back key,
// mission title, level readout, scores and banners look and behave
// identically everywhere — a child learns the chrome once.

import { sfx } from '../shell/audio.js';

const PLAYER_COLORS = ['var(--p1)', 'var(--p2)'];

export function createHud(container, {
  title,
  onExit,
  level = null,
  players = 1,
  showScore = false,
  showTurn = false,
}) {
  const hud = document.createElement('div');
  hud.className = 'hud';

  const backBtn = document.createElement('button');
  backBtn.className = 'key';
  backBtn.setAttribute('aria-label', 'Terug naar missiekeuze');
  backBtn.textContent = '◀';
  backBtn.addEventListener('pointerup', () => {
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

  let levelEl = null;
  if (level !== null) {
    levelEl = document.createElement('div');
    levelEl.className = 'readout';
    levelEl.textContent = `Level ${level}`;
    hud.appendChild(levelEl);
  }

  const scoreEls = [];
  if (showScore) {
    const scores = document.createElement('div');
    scores.className = 'hud__scores';
    for (let i = 0; i < players; i++) {
      const s = document.createElement('div');
      s.className = `readout readout--p${i + 1}`;
      s.textContent = players > 1 ? `P${i + 1} 0` : 'Score 0';
      scores.appendChild(s);
      scoreEls.push(s);
    }
    hud.appendChild(scores);
  }

  container.appendChild(hud);

  const banner = document.createElement('div');
  banner.className = 'banner';
  container.appendChild(banner);

  let bannerTimer = null;

  return {
    setLevel(n) {
      if (levelEl) levelEl.textContent = `Level ${n}`;
    },
    setScore(playerIndex, value) {
      const el = scoreEls[playerIndex];
      if (!el) return;
      el.textContent = players > 1 ? `P${playerIndex + 1} ${value}` : `Score ${value}`;
    },
    setTurn(playerIndex) {
      if (!turnEl) return;
      turnEl.textContent = `Astronaut ${playerIndex + 1} mag`;
      turnEl.style.background = PLAYER_COLORS[playerIndex % PLAYER_COLORS.length];
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
    },
  };
}

// Row of level lamps (●●●○○) used on the portal mission buttons.
export function lampRow(lit, total) {
  let out = '';
  for (let i = 0; i < total; i++) {
    out += `<span class="lamp${i < lit ? ' lamp--on' : ''}"></span>`;
  }
  return `<span class="lamps" aria-label="Level ${lit} van ${total}">${out}</span>`;
}
