import { navigate } from '../shell/router.js';
import { getItem } from '../shell/storage.js';
import { GAMES, getGame } from '../games/game-registry.js';
import { sfx, toggleMuted, isMuted } from '../shell/audio.js';
import { onTap, onTapAll } from '../shell/pointer.js';
import { getLamps, MAX_LAMPS } from '../shell/progress.js';
import { progressBar, porthole } from '../shared/ui-components.js';

// Rows arrive one after another, but the archive is never allowed to take longer
// than the cap to finish assembling — twenty-four rows at 22 ms sit comfortably
// under it, and the cap is what stops a longer archive from turning the entrance
// into a wait.
const ROW_STAGGER_MS = 22;
const STAGGER_CAP_MS = 500;

export function renderGameGridView(container) {
  const playerCount = getItem('playerCount', 1);
  const recent = getItem('lastGame', null);

  const cards = GAMES.map((g, i) => {
    // The badge states the seat count rather than just "co-op", so the one
    // four-player mission announces itself in the grid.
    const crewBadge = g.maxPlayers > 1 ? `<span class="tag">${g.maxPlayers}P</span>` : '';
    const isRecent = g.slug === recent;
    const delay = Math.min(i * ROW_STAGGER_MS, STAGGER_CAP_MS);
    return `
      <button class="mission${isRecent ? ' is-recent' : ''}" data-slug="${g.slug}" style="--in-delay:${delay}ms">
        ${porthole(g.icon, {
          className: 'mission__icon',
          color: g.color,
          lit: isRecent,
          // Nine portholes bobbing on the same clock reads as a machine; a
          // different duration each makes the grid feel alive instead.
          duration: 5.2 + (i % 5) * 0.5,
        })}
        <span class="mission__text">
          <span class="mission__name">${g.title}</span>
          <span class="mission__meta">
            <span>${g.ageLabel}</span>
            ${crewBadge}
          </span>
          ${progressBar(getLamps(g.slug), MAX_LAMPS)}
        </span>
      </button>
    `;
  }).join('');

  container.innerHTML = `
    <div class="missions">
      <div class="bar-top">
        <button class="key key--bar key--back" id="grid-back" aria-label="Terug naar crewkeuze"></button>
        <div class="bar-top__titles">
          <div class="eyebrow">Missiearchief · ${String(GAMES.length).padStart(2, '0')} beschikbaar</div>
          <h1 class="bar-top__heading">Kies je missie</h1>
        </div>
        <div class="bar-top__spacer"></div>
        <button class="readout" id="crew-readout">
          <span>${playerCount === 2 ? '🧑‍🚀🧑‍🚀' : '🧑‍🚀'}</span>
          ${playerCount === 2 ? '2 astronauten' : '1 astronaut'}
        </button>
        <button class="key key--bar" id="grid-mute" aria-label="Geluid aan of uit">${isMuted() ? '🔇' : '🔊'}</button>
        <button class="key key--bar" id="grid-settings" aria-label="Instellingen">⚙️</button>
      </div>
      <div class="missions__grid">${cards}</div>
    </div>
  `;

  const grid = container.querySelector('.missions__grid');
  const backBtn = container.querySelector('#grid-back');
  const muteBtn = container.querySelector('#grid-mute');
  const settingsBtn = container.querySelector('#grid-settings');
  const crewReadout = container.querySelector('#crew-readout');

  const onBack = () => {
    sfx.back();
    navigate('/spelers');
  };
  const onCrew = () => {
    sfx.select();
    navigate('/spelers');
  };
  const onMute = () => {
    const nowMuted = toggleMuted();
    muteBtn.textContent = nowMuted ? '🔇' : '🔊';
    if (!nowMuted) sfx.blip();
  };
  const onSettings = () => {
    sfx.select();
    navigate('/instellingen');
  };
  const onPick = (e) => {
    sfx.select();
    navigate(`/spel/${e.currentTarget.dataset.slug}`);
  };

  // A mission's module is fetched the moment a finger lands on its row, a good
  // hundred milliseconds before the tap finishes and the route changes. The
  // import cache means the loader's own `load()` then resolves immediately, so
  // most missions open with no loading screen at all. A press that turns out to
  // be a drag has cost one prefetch of a module the child was reaching for
  // anyway.
  const prefetch = (slug) => {
    getGame(slug)?.load().catch(() => {
      // Reporting is the loader's job — that is the screen that can offer a way
      // back out.
    });
  };
  const onRowDown = (e) => {
    const row = e.target.closest('.mission');
    if (row) prefetch(row.dataset.slug);
  };
  grid.addEventListener('pointerdown', onRowDown, { passive: true });

  // The mission they were last playing is fetched while the grid just sits
  // there, because carrying on with it is the likeliest next tap of all.
  const idle = recent
    ? window.requestIdleCallback?.(() => prefetch(recent), { timeout: 2000 })
    : undefined;

  const offBack = onTap(backBtn, onBack);
  const offCrew = onTap(crewReadout, onCrew);
  const offMute = onTap(muteBtn, onMute);
  const offSettings = onTap(settingsBtn, onSettings);
  // onTap rather than a bare pointerup listener: pointerup fires wherever the
  // finger happens to be when it lifts, so dragging across the archive and
  // letting go used to launch whatever row was underneath.
  const offMissions = onTapAll(container.querySelectorAll('.mission'), onPick);

  return () => {
    if (idle !== undefined) window.cancelIdleCallback?.(idle);
    grid.removeEventListener('pointerdown', onRowDown);
    offBack();
    offCrew();
    offMute();
    offSettings();
    offMissions();
  };
}
