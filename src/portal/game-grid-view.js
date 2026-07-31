import { navigate } from '../shell/router.js';
import { getItem } from '../shell/storage.js';
import { GAMES } from '../games/game-registry.js';
import { sfx, toggleMuted, isMuted } from '../shell/audio.js';
import { getLamps, MAX_LAMPS } from '../shell/progress.js';
import { progressBar, porthole } from '../shared/ui-components.js';

export function renderGameGridView(container) {
  const playerCount = getItem('playerCount', 1);
  const recent = getItem('lastGame', null);

  const cards = GAMES.map((g, i) => {
    // The badge states the seat count rather than just "co-op", so the one
    // four-player mission announces itself in the grid.
    const crewBadge = g.maxPlayers > 1 ? `<span class="tag">${g.maxPlayers}P</span>` : '';
    const isRecent = g.slug === recent;
    return `
      <button class="mission${isRecent ? ' is-recent' : ''}" data-slug="${g.slug}">
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

  backBtn.addEventListener('pointerup', onBack);
  crewReadout.addEventListener('pointerup', onCrew);
  muteBtn.addEventListener('pointerup', onMute);
  settingsBtn.addEventListener('pointerup', onSettings);

  const missionBtns = container.querySelectorAll('.mission');
  const onPick = (e) => {
    sfx.select();
    navigate(`/spel/${e.currentTarget.dataset.slug}`);
  };
  missionBtns.forEach((c) => c.addEventListener('pointerup', onPick));

  return () => {
    backBtn.removeEventListener('pointerup', onBack);
    crewReadout.removeEventListener('pointerup', onCrew);
    muteBtn.removeEventListener('pointerup', onMute);
    settingsBtn.removeEventListener('pointerup', onSettings);
    missionBtns.forEach((c) => c.removeEventListener('pointerup', onPick));
  };
}
