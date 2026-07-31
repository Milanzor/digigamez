// Missiecontrole — the grown-up screen. Everything here is something a parent
// or teacher sets between sessions, so it is the one place in the app where
// text outweighs icons and where a destructive action is allowed to exist.
//
// The wipe is behind a press-and-hold rather than a confirm dialog on purpose:
// a four-year-old taps straight through "Weet je het zeker?", but holding a
// button steady for a second and a half is not something that happens by
// accident while poking at a touchscreen.

import { navigate, previousPath } from '../shell/router.js';
import { sfx, setMuted, isMuted, setVolume, getVolume } from '../shell/audio.js';
import { getSetting, setSetting } from '../shell/settings.js';
import { resetProgress } from '../shell/progress.js';
import { isFullscreen, toggleFullscreen } from '../shell/kiosk.js';

const HOLD_MS = 1600;

function segment(setting, options, current) {
  const buttons = options
    .map(
      (o) => `<button class="seg__btn${o.value === current ? ' is-active' : ''}"
        data-value="${o.value}">${o.label}</button>`
    )
    .join('');
  return `<div class="seg" data-setting="${setting}" role="group">${buttons}</div>`;
}

function row({ icon, name, note, control, danger = false }) {
  return `
    <div class="setting${danger ? ' setting--danger' : ''}">
      <div class="setting__label">
        <span class="setting__icon">${icon}</span>
        <span>
          <span class="setting__name">${name}</span>
          <span class="setting__note">${note}</span>
        </span>
      </div>
      ${control}
    </div>
  `;
}

export function renderSettingsView(container) {
  // Reachable from the launch screen as well as from the mission grid, so ◀
  // returns to whichever one opened it.
  const backTo = previousPath() === '/' ? '/' : '/rooster';

  container.innerHTML = `
    <div class="settings">
      <div class="missions__bar">
        <button class="key key--bar" id="settings-back" aria-label="Terug">◀</button>
        <h1 class="missions__heading">Instellingen</h1>
        <div class="missions__spacer"></div>
        <div class="readout">Missiecontrole</div>
      </div>

      <div class="settings__panel" id="settings-panel">
        ${row({
          icon: '🔊',
          name: 'Geluid',
          note: 'Piepjes, raketten en muziekjes',
          control: segment('sound', [
            { value: 'aan', label: 'Aan' },
            { value: 'uit', label: 'Uit' },
          ], isMuted() ? 'uit' : 'aan'),
        })}
        ${row({
          icon: '🎚️',
          name: 'Volume',
          note: 'Hoe hard het bord klinkt',
          control: segment('volume', [
            { value: 'zacht', label: 'Zacht' },
            { value: 'gewoon', label: 'Gewoon' },
            { value: 'hard', label: 'Hard' },
          ], getVolume()),
        })}
        ${row({
          icon: '✨',
          name: 'Sterrenhemel',
          note: 'Zet de beweging uit als het te veel prikkels geeft',
          control: segment('calm', [
            { value: 'bewegend', label: 'Bewegend' },
            { value: 'rustig', label: 'Rustig' },
          ], getSetting('calm') ? 'rustig' : 'bewegend'),
        })}
        ${row({
          icon: '🖥️',
          name: 'Volledig scherm',
          note: 'Het bord vult het hele scherm, zonder browserbalken',
          control: '<button class="btn btn--small" id="settings-fs">Aan zetten</button>',
        })}
        ${row({
          danger: true,
          icon: '🧹',
          name: 'Alle voortgang wissen',
          note: 'Levels, de tekening en de machine verdwijnen. Instellingen blijven staan.',
          control: `
            <button class="hold" id="settings-wipe" aria-label="Houd vast om alle voortgang te wissen">
              <span class="hold__fill"></span>
              <span class="hold__text">Houd vast</span>
            </button>
          `,
        })}
      </div>
    </div>
  `;

  const backBtn = container.querySelector('#settings-back');
  const panel = container.querySelector('#settings-panel');
  const fsBtn = container.querySelector('#settings-fs');
  const wipeBtn = container.querySelector('#settings-wipe');
  const wipeText = wipeBtn.querySelector('.hold__text');

  // --- the three segmented settings, handled by one delegated listener ------

  const onSegment = (e) => {
    const btn = e.target.closest('.seg__btn');
    if (!btn || !panel.contains(btn)) return;
    const group = btn.parentElement;
    const { value } = btn.dataset;

    switch (group.dataset.setting) {
      case 'sound':
        setMuted(value === 'uit');
        break;
      case 'volume':
        setVolume(value);
        break;
      case 'calm':
        setSetting('calm', value === 'rustig');
        break;
      default:
        return;
    }

    group.querySelectorAll('.seg__btn').forEach((b) => b.classList.toggle('is-active', b === btn));
    // Played after applying, so switching sound on or changing the volume is
    // audible at the setting you just picked.
    sfx.select();
  };
  panel.addEventListener('pointerup', onSegment);

  // --- fullscreen ----------------------------------------------------------

  const syncFs = () => {
    fsBtn.textContent = isFullscreen() ? 'Uit zetten' : 'Aan zetten';
  };
  const onFs = async () => {
    sfx.select();
    await toggleFullscreen();
    syncFs();
  };
  syncFs();
  fsBtn.addEventListener('pointerup', onFs);
  // Escape leaves fullscreen without touching our button, so follow the event.
  document.addEventListener('fullscreenchange', syncFs);

  // --- press and hold to wipe ----------------------------------------------

  let holdTimer = 0;
  let wiped = false;

  const stopHold = () => {
    clearTimeout(holdTimer);
    holdTimer = 0;
    wipeBtn.classList.remove('is-holding');
  };

  const onHoldStart = (e) => {
    if (wiped || holdTimer) return;
    wipeBtn.setPointerCapture?.(e.pointerId);
    wipeBtn.classList.add('is-holding');
    sfx.blip();
    holdTimer = setTimeout(() => {
      holdTimer = 0;
      wiped = true;
      resetProgress();
      wipeBtn.classList.remove('is-holding');
      wipeBtn.classList.add('is-done');
      wipeText.textContent = 'Alles gewist ✨';
      sfx.missionComplete();
      // Straight back to the launch screen: the crew choice was wiped too, so
      // there is nothing sensible left to show on the mission grid.
      setTimeout(() => navigate('/'), 1500);
    }, HOLD_MS);
  };

  wipeBtn.addEventListener('pointerdown', onHoldStart);
  wipeBtn.addEventListener('pointerup', stopHold);
  wipeBtn.addEventListener('pointercancel', stopHold);
  wipeBtn.addEventListener('pointerleave', stopHold);

  // --- back ----------------------------------------------------------------

  const onBack = () => {
    sfx.back();
    navigate(backTo);
  };
  backBtn.addEventListener('pointerup', onBack);

  return () => {
    clearTimeout(holdTimer);
    panel.removeEventListener('pointerup', onSegment);
    fsBtn.removeEventListener('pointerup', onFs);
    document.removeEventListener('fullscreenchange', syncFs);
    wipeBtn.removeEventListener('pointerdown', onHoldStart);
    wipeBtn.removeEventListener('pointerup', stopHold);
    wipeBtn.removeEventListener('pointercancel', stopHold);
    wipeBtn.removeEventListener('pointerleave', stopHold);
    backBtn.removeEventListener('pointerup', onBack);
  };
}
