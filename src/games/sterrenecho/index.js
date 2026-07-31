import './style.css';
import { createHud, showMissionComplete } from '../../shared/ui-components.js';
import { sfx } from '../../shell/audio.js';
import { setLevel, starsForLevel } from '../../shell/progress.js';

// "Sterrenecho" — a signal comes in from deep space, echo it back.
//
// Simon says, and it is almost free in this codebase: `chime(n)` indexes a
// pentatonic scale, so every sequence the game can possibly generate is
// musical. There is no tuning work and no wrong note, only a longer or shorter
// melody. Getting one wrong is not a loss either — the station simply repeats
// the message, from the top, as often as a child needs.
//
// With two astronauts it turns co-operative in the oldest way there is: you
// repeat what is there and then add one tone of your own for the other to
// remember.

const PANELS = [
  { color: '#5fe3c4', glyph: '✦' },
  { color: '#ff6b6b', glyph: '●' },
  { color: '#b98cff', glyph: '▲' },
  { color: '#8fd6ff', glyph: '■' },
  { color: '#7ee787', glyph: '✚' },
  { color: '#ff8fc7', glyph: '◆' },
];

// panels · how long the melody has to get · how fast it is played back
const LEVELS = [
  { panels: 4, target: 4, beat: 640 },
  { panels: 4, target: 5, beat: 580 },
  { panels: 5, target: 6, beat: 530 },
  { panels: 6, target: 7, beat: 490 },
  { panels: 6, target: 8, beat: 450, blind: true },
];

let hud = null;
let stage = null;
let grid = null;
let hintEl = null;
let level = 1;
let slug = 'sterrenecho';
let mission = null;
let players = 1;
let reward = null;
let onExit = null;
let listeners = [];
let timers = [];

function later(fn, ms) {
  const id = setTimeout(fn, ms);
  timers.push(id);
  return id;
}

function clearTimers() {
  timers.forEach(clearTimeout);
  timers = [];
}

function levelConfig(l) {
  return LEVELS[Math.min(Math.max(1, l), LEVELS.length) - 1];
}

export function init(container, opts) {
  slug = opts.slug;
  level = Math.max(1, opts.startLevel || 1);
  players = opts.players || 1;
  mission = { title: opts.title, icon: opts.icon, color: opts.color };
  onExit = opts.onExit;
  reward = null;
  listeners = [];
  timers = [];

  hud = createHud(container, {
    title: opts.title,
    onExit: opts.onExit,
    level,
    players,
    showTurn: players > 1,
  });

  stage = document.createElement('div');
  stage.className = 'echo-stage';
  hintEl = document.createElement('div');
  hintEl.className = 'hint-strip';
  grid = document.createElement('div');
  grid.className = 'echo-grid';
  stage.append(hintEl, grid);
  container.appendChild(stage);

  startLevel();
}

function startLevel() {
  const cfg = levelConfig(level);
  hud.setLevel(level);
  clearTimers();

  const cols = cfg.panels <= 4 ? 2 : 3;
  const rows = Math.ceil(cfg.panels / cols);
  grid.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
  grid.style.gridTemplateRows = `repeat(${rows}, 1fr)`;
  grid.style.setProperty('--grid-ratio', String(cols / rows));

  const buttons = PANELS.slice(0, cfg.panels).map((p, i) => {
    const btn = document.createElement('button');
    btn.className = 'echo-panel';
    btn.style.setProperty('--panel-color', p.color);
    btn.dataset.index = String(i);
    btn.setAttribute('aria-label', `Toon ${i + 1}`);
    btn.innerHTML = `<span class="echo-panel__glyph">${p.glyph}</span>`;
    return btn;
  });
  grid.replaceChildren(...buttons);

  const sequence = [];
  let expect = 0;
  let phase = 'idle';
  let turn = 0;

  const say = (text) => { hintEl.textContent = text; };

  function light(index, ms) {
    const btn = buttons[index];
    if (!btn) return;
    btn.classList.add('is-lit');
    later(() => btn.classList.remove('is-lit'), ms);
  }

  // The station transmitting. On the last level the panels stay dark and only
  // the tone is the clue, which is a genuinely different game for a seven-year
  // old and invisible to everyone below that.
  function playBack(onDone) {
    phase = 'play';
    say(cfg.blind ? 'Luister goed — geen licht deze keer' : 'Luister…');
    sequence.forEach((panel, i) => {
      later(() => {
        sfx.chime(panel);
        if (!cfg.blind) light(panel, cfg.beat * 0.55);
      }, i * cfg.beat);
    });
    later(onDone, sequence.length * cfg.beat + 260);
  }

  function askRepeat() {
    expect = 0;
    phase = 'repeat';
    if (players > 1) hud.setTurn(turn);
    say(players > 1 ? `Astronaut ${turn + 1}: echo de reeks` : 'Nu jij!');
  }

  function askAdd() {
    phase = 'add';
    if (players > 1) hud.setTurn(turn);
    say(`Astronaut ${turn + 1}: kies er zelf één bij`);
  }

  // 1P: the station adds the tone. 2P: the astronaut whose turn it is does,
  // which is what makes the shared melody theirs rather than the machine's.
  function grow() {
    if (players > 1) {
      askAdd();
      return;
    }
    sequence.push(Math.floor(Math.random() * cfg.panels));
    later(() => playBack(askRepeat), 380);
  }

  function afterCorrectRepeat() {
    if (sequence.length >= cfg.target) {
      finishLevel();
      return;
    }
    sfx.powerup();
    say('Goed zo!');
    // No turn change here: with two astronauts the one who just echoed the
    // melody is the one who gets to add to it, and handing over happens the
    // moment the new tone is chosen.
    later(grow, 620);
  }

  function onPress(e) {
    const btn = e.currentTarget;
    const index = Number(btn.dataset.index);

    if (phase === 'add') {
      sequence.push(index);
      sfx.chime(index);
      light(index, 260);
      if (players > 1) turn = 1 - turn;
      phase = 'idle';
      if (sequence.length >= cfg.target) {
        later(finishLevel, 520);
      } else {
        later(() => playBack(askRepeat), 620);
      }
      return;
    }

    if (phase !== 'repeat') return;

    sfx.chime(index);
    light(index, 260);

    if (index === sequence[expect]) {
      expect += 1;
      if (expect === sequence.length) {
        phase = 'idle';
        later(afterCorrectRepeat, 420);
      }
      return;
    }

    // Wrong tone: the station repeats the message. Nothing is lost, nothing is
    // reset, and the child hears the melody again — which is the help they
    // actually needed.
    phase = 'idle';
    sfx.deny();
    btn.classList.add('is-wrong');
    later(() => btn.classList.remove('is-wrong'), 400);
    say('Bijna! Luister nog eens');
    later(() => playBack(askRepeat), 900);
  }

  buttons.forEach((b) => b.addEventListener('pointerup', onPress));
  listeners.push(() => buttons.forEach((b) => b.removeEventListener('pointerup', onPress)));

  // The opening move: solo the station transmits, together astronaut 1 gets to
  // invent the first tone.
  if (players > 1) {
    askAdd();
  } else {
    sequence.push(Math.floor(Math.random() * cfg.panels));
    later(() => playBack(askRepeat), 700);
  }
}

function finishLevel() {
  clearTimers();
  sfx.missionComplete();
  const cleared = level;
  level += 1;
  setLevel(slug, level);
  hintEl.textContent = '';
  reward = showMissionComplete(stage, {
    icon: mission.icon,
    color: mission.color,
    mission: mission.title,
    level: cleared,
    stars: starsForLevel(level),
    title: players > 1 ? 'Samen doorgegeven! 🔔' : 'Echo compleet! 🔔',
    onNext: () => { reward = null; startLevel(); },
    onRetry: () => { reward = null; level = cleared; startLevel(); },
    onHome: onExit,
  });
}

export function destroy() {
  clearTimers();
  listeners.forEach((off) => off());
  listeners = [];
  reward?.close();
  reward = null;
  hud?.destroy();
  hud = null;
  stage = null;
  grid = null;
  hintEl = null;
}
