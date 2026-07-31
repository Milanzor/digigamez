import { navigate } from '../shell/router.js';
import { getItem } from '../shell/storage.js';
import { GAMES } from '../games/game-registry.js';
import { sfx, toggleMuted, isMuted } from '../shell/audio.js';
import { getLamps, MAX_LAMPS } from '../shell/progress.js';
import { lampRow } from '../shared/ui-components.js';

export function renderGameGridView(container) {
  const playerCount = getItem('playerCount', 1);

  const cards = GAMES.map((g) => {
    const crewBadge = g.supportsTwoPlayers
      ? '<span class="mission__crew">2P</span>'
      : '';
    return `
      <button class="mission" data-slug="${g.slug}" style="--mission-color:${g.color}">
        <div class="mission__icon">${g.icon}</div>
        <div class="mission__name">${g.title}</div>
        <div class="mission__meta">
          <span>${g.ageLabel}</span>
          ${crewBadge}
        </div>
        ${lampRow(getLamps(g.slug), MAX_LAMPS)}
      </button>
    `;
  }).join('');

  container.innerHTML = `
    <div class="missions">
      <div class="missions__bar">
        <button class="key key--bar" id="grid-back" aria-label="Terug naar crewkeuze">◀</button>
        <h1 class="missions__heading">Kies je missie</h1>
        <div class="missions__spacer"></div>
        <div class="readout" id="crew-readout">
          ${playerCount === 2 ? '👨‍🚀👩‍🚀 2 astronauten' : '👨‍🚀 1 astronaut'}
        </div>
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
