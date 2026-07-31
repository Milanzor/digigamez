import './style.css';
import { createHud, showMissionComplete, porthole } from '../../shared/ui-components.js';
import { sfx } from '../../shell/audio.js';
import { setLevel, starsForLevel } from '../../shell/progress.js';

// "Letterplaneten" — a crate arrives with a rocket on it, so tap the planet
// with the R.
//
// The bundle had no language content at all, and this is the one genre that has
// to actually be Dutch to work: beginning sounds only mean anything in the
// language a child is learning to read in, so it cannot be a translated word
// list. Everything here is picked for that — the pictures are things with one
// obvious Dutch name, because a picture a child calls "kat" while the game is
// thinking "poes" teaches them that they were wrong when they were not.
//
// Letters are capitals. Dutch schools teach lowercase for reading, but this is
// a wall screen read from two metres away, and a capital is the more
// distinguishable shape at that distance — a lowercase b and d at the back of a
// classroom is a needless trap.
//
// The ladder walks first letter -> last letter -> spelling the whole word,
// which is roughly the order the skill actually arrives in.

// One unmistakable Dutch name each. Where an emoji has two common names
// (🐱 poes/kat, 🐶 hond/puppy) it is left out rather than guessed at.
const WORDS = [
  { word: 'raket', emoji: '🚀' },
  { word: 'maan', emoji: '🌙' },
  { word: 'ster', emoji: '⭐' },
  { word: 'huis', emoji: '🏠' },
  { word: 'boom', emoji: '🌳' },
  { word: 'appel', emoji: '🍎' },
  { word: 'bij', emoji: '🐝' },
  { word: 'koe', emoji: '🐄' },
  { word: 'ballon', emoji: '🎈' },
  { word: 'tulp', emoji: '🌷' },
  { word: 'sok', emoji: '🧦' },
  { word: 'fiets', emoji: '🚲' },
  { word: 'olifant', emoji: '🐘' },
  { word: 'zon', emoji: '☀️' },
  { word: 'banaan', emoji: '🍌' },
  { word: 'kaas', emoji: '🧀' },
  { word: 'wortel', emoji: '🥕' },
  { word: 'gitaar', emoji: '🎸' },
  { word: 'hand', emoji: '🖐️' },
  { word: 'bus', emoji: '🚌' },
  { word: 'vis', emoji: '🐟' },
  { word: 'eend', emoji: '🦆' },
  { word: 'kikker', emoji: '🐸' },
  { word: 'trein', emoji: '🚂' },
  { word: 'bel', emoji: '🔔' },
  { word: 'pet', emoji: '🧢' },
  { word: 'trom', emoji: '🥁' },
  { word: 'peer', emoji: '🍐' },
];

const PLANET_COLORS = ['#8fd6ff', '#ff8fc7', '#7ee787', '#b98cff', '#ffa14a', '#5fe3c4'];
const ALPHABET = 'BDFGHJKLMNPRSTVWZ';
const VOWELS = 'AEIOU';

// Five crates to a level: long enough to be a round of work, short enough that
// a five-year-old reaches the reward screen in one sitting.
const ROUNDS = 5;

let hud = null;
let stage = null;
let level = 1;
let slug = 'letterplaneten';
let mission = null;
let reward = null;
let onExit = null;
let listeners = [];
let timers = [];

function levelConfig(l) {
  const n = Math.max(1, l);
  if (n === 1) return { mode: 'first', choices: 3 };
  if (n === 2) return { mode: 'first', choices: 4 };
  if (n === 3) return { mode: 'last', choices: 4 };
  if (n === 4) return { mode: 'build', length: 3 };
  if (n === 5) return { mode: 'build', length: 4 };
  // Past the ladder: spelling stays, on the longer words.
  return { mode: 'build', length: 5 };
}

function later(fn, ms) {
  const id = setTimeout(fn, ms);
  timers.push(id);
  return id;
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function init(container, opts) {
  slug = opts.slug;
  level = Math.max(1, opts.startLevel || 1);
  mission = { title: opts.title, icon: opts.icon, color: opts.color };
  onExit = opts.onExit;
  reward = null;
  listeners = [];
  timers = [];

  hud = createHud(container, {
    title: opts.title,
    onExit: opts.onExit,
    level,
    meter: 'Kratten',
  });

  stage = document.createElement('div');
  stage.className = 'let-stage';
  container.appendChild(stage);

  startLevel();
}

function startLevel() {
  const cfg = levelConfig(level);
  hud.setLevel(level);
  hud.setMeter(0);

  let round = 0;
  let item = null;
  let busy = false;
  // Build mode: how much of the word is spelled out so far.
  let filled = 0;
  let lastWord = '';

  stage.replaceChildren();

  const prompt = document.createElement('div');
  prompt.className = 'let-prompt';

  const slots = document.createElement('div');
  slots.className = 'let-slots';

  const choices = document.createElement('div');
  choices.className = 'let-choices';

  const hint = document.createElement('div');
  hint.className = 'hint-strip let-hint';

  stage.append(prompt, slots, choices, hint);

  function pickWord() {
    let pool = WORDS;
    if (cfg.mode === 'build') {
      pool = WORDS.filter((w) => w.word.length === cfg.length);
      // The longest levels run out of words of exactly that length, so widen
      // rather than repeat the same three forever.
      if (pool.length < 4) pool = WORDS.filter((w) => w.word.length >= cfg.length);
    }
    if (pool.length > 1) pool = pool.filter((w) => w.word !== lastWord);
    const pick = pool[Math.floor(Math.random() * pool.length)];
    lastWord = pick.word;
    return pick;
  }

  function answerLetter(w) {
    return (cfg.mode === 'last' ? w.word[w.word.length - 1] : w.word[0]).toUpperCase();
  }

  // Distractors that are not the answer, not each other, and — in spelling mode
  // — not a letter the word actually needs. A spare Z next to the word's own Z
  // is not a distractor, it is a second correct answer, and a child who taps it
  // learns nothing from being right.
  function distractors(n, avoid = '') {
    const out = [];
    const bag = (ALPHABET + VOWELS).split('');
    const blocked = avoid.toUpperCase();
    // Guard against a word that somehow uses most of the alphabet.
    let guard = 0;
    while (out.length < n && guard++ < 400) {
      const c = bag[Math.floor(Math.random() * bag.length)];
      if (blocked.includes(c) || out.includes(c)) continue;
      out.push(c);
    }
    return out;
  }

  function planet(letter, i) {
    const btn = document.createElement('button');
    btn.className = 'let-planet';
    btn.dataset.letter = letter;
    btn.style.setProperty('--planet', PLANET_COLORS[i % PLANET_COLORS.length]);
    btn.setAttribute('aria-label', `Planeet met de letter ${letter}`);
    btn.innerHTML = `<span class="let-planet__letter">${letter}</span>`;
    return btn;
  }

  function renderPick() {
    slots.classList.add('hidden');
    const answer = answerLetter(item);
    const letters = shuffle([answer, ...distractors(cfg.choices - 1, answer)]);
    prompt.innerHTML = `
      <div class="eyebrow">${cfg.mode === 'last' ? 'Welke letter hoort er achteraan?' : 'Welke letter hoort er vooraan?'}</div>
      ${porthole(item.emoji, { className: 'let-crate', color: mission.color })}
    `;
    choices.className = 'let-choices';
    choices.replaceChildren(...letters.map(planet));
    hint.textContent = cfg.mode === 'last'
      ? 'Tik de planeet met de laatste letter'
      : 'Tik de planeet met de eerste letter';
  }

  function renderBuild() {
    slots.classList.remove('hidden');
    const word = item.word.toUpperCase();
    prompt.innerHTML = `
      <div class="eyebrow">Spel het woord</div>
      ${porthole(item.emoji, { className: 'let-crate', color: mission.color })}
    `;
    slots.replaceChildren(...word.split('').map((ch, i) => {
      const s = document.createElement('span');
      s.className = `let-slot${i < filled ? ' is-filled' : ''}${i === filled ? ' is-next' : ''}`;
      s.textContent = i < filled ? ch : '';
      return s;
    }));

    // The letters still to be placed, plus two spares that appear nowhere in the
    // word — so the row cannot be solved by elimination, and every spare really
    // is wrong.
    const tiles = shuffle([
      ...word.split('').slice(filled),
      ...distractors(2, word),
    ]);
    choices.className = 'let-choices let-choices--tiles';
    choices.replaceChildren(...tiles.map(planet));
    hint.textContent = 'Tik de letters op de goede plek';
  }

  function render() {
    if (cfg.mode === 'build') renderBuild();
    else renderPick();
  }

  function nextRound() {
    round += 1;
    hud.setMeter(round / ROUNDS);
    if (round >= ROUNDS) {
      finishLevel();
      return;
    }
    item = pickWord();
    filled = 0;
    busy = false;
    render();
  }

  function correct() {
    sfx.match();
    busy = true;
    prompt.classList.add('is-right');
    later(() => {
      prompt.classList.remove('is-right');
      nextRound();
    }, 800);
  }

  const onChoice = (e) => {
    if (busy) return;
    const btn = e.target.closest('.let-planet');
    if (!btn) return;
    const letter = btn.dataset.letter;

    if (cfg.mode === 'build') {
      const want = item.word[filled].toUpperCase();
      if (letter !== want) {
        // Wrong tile: it wobbles back into the row. Nothing is lost and the
        // slot is still open, so trying again is the obvious next move.
        sfx.deny();
        btn.classList.add('is-wrong');
        later(() => btn.classList.remove('is-wrong'), 420);
        return;
      }
      filled += 1;
      sfx.chime(filled);
      if (filled >= item.word.length) {
        correct();
        return;
      }
      render();
      return;
    }

    if (letter !== answerLetter(item)) {
      sfx.deny();
      btn.classList.add('is-wrong');
      later(() => btn.classList.remove('is-wrong'), 420);
      return;
    }
    btn.classList.add('is-right');
    correct();
  };

  choices.addEventListener('pointerup', onChoice);
  listeners.push(() => choices.removeEventListener('pointerup', onChoice));

  function finishLevel() {
    sfx.missionComplete();
    const cleared = level;
    level += 1;
    setLevel(slug, level);
    reward = showMissionComplete(stage, {
      icon: mission.icon,
      color: mission.color,
      mission: mission.title,
      level: cleared,
      stars: starsForLevel(level),
      title: 'Alle kratten gelezen! 🔤',
      onNext: () => { reward = null; startLevel(); },
      onRetry: () => { reward = null; level = cleared; startLevel(); },
      onHome: onExit,
    });
  }

  item = pickWord();
  filled = 0;
  render();
}

export function destroy() {
  timers.forEach(clearTimeout);
  timers = [];
  listeners.forEach((off) => off());
  listeners = [];
  reward?.close();
  reward = null;
  hud?.destroy();
  hud = null;
  stage = null;
}
