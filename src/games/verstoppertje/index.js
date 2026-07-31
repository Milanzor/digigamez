import './style.css';
import { createHud, showMissionComplete } from '../../shared/ui-components.js';
import { sfx } from '../../shell/audio.js';
import { setLevel, starsForLevel } from '../../shell/progress.js';

// "Alien Verstoppertje" — tap a rock and see who is underneath.
//
// The gentlest thing in the archive, and deliberately so: for a two-year-old,
// cause and effect *is* the game. Tap, something happens, something is there.
// There is no wrong tap, no timer and nothing to run out of, so failing is not
// merely forgiven here — it is structurally impossible.
//
// The cup game from level 4 is where it stops being a toy. Following one alien
// under three sliding rocks is real attention training, and it is the same
// screen and the same tap, so a child grows into it without being handed a
// different game.
//
// A rock that has been looked under stays open. That is the whole reason this
// works for a two-year-old: remembering where you have already been is the part
// they cannot do yet, so the board remembers it for them.

// Each hider gets its own idle animation, so turning over the same rock twice
// is not the same event twice.
const HIDERS = [
  { emoji: '👽', anim: 'bob' },
  { emoji: '🛸', anim: 'hover' },
  { emoji: '👾', anim: 'wobble' },
  { emoji: '🐙', anim: 'wiggle' },
  { emoji: '🦑', anim: 'bob' },
  { emoji: '🤖', anim: 'wobble' },
  { emoji: '🐛', anim: 'wiggle' },
  { emoji: '🦖', anim: 'hover' },
];

const EMPTIES = ['🪨', '⭐', '🌾', '🪺'];

// Cup rounds needed to clear a cup level.
const CUP_ROUNDS = 3;

let hud = null;
let stage = null;
let level = 1;
let slug = 'verstoppertje';
let mission = null;
let reward = null;
let onExit = null;
let players = 1;
let listeners = [];
let timers = [];

function levelConfig(l) {
  const n = Math.max(1, l);
  if (n === 1) return { mode: 'find', covers: 6, hidden: 2, cols: 3 };
  if (n === 2) return { mode: 'find', covers: 9, hidden: 3, cols: 3 };
  if (n === 3) return { mode: 'find', covers: 12, hidden: 4, cols: 4 };
  if (n === 4) return { mode: 'cups', shuffles: 3, speed: 620 };
  // The cup game keeps getting one shuffle quicker and one shuffle longer.
  return { mode: 'cups', shuffles: Math.min(3 + (n - 4), 8), speed: Math.max(280, 620 - (n - 4) * 70) };
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
    meter: 'Gevonden',
  });

  stage = document.createElement('div');
  stage.className = 'hide-stage';
  container.appendChild(stage);

  startLevel();
}

function startLevel() {
  const cfg = levelConfig(level);
  hud.setLevel(level);
  hud.setMeter(0);
  if (cfg.mode === 'cups') startCups(cfg);
  else startFind(cfg);
}

function finishLevel(title) {
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
    title,
    onNext: () => { reward = null; startLevel(); },
    onRetry: () => { reward = null; level = cleared; startLevel(); },
    onHome: onExit,
  });
}

// ── Hide and seek ──────────────────────────────────────────────────────────

function startFind(cfg) {
  const hiders = shuffle(HIDERS).slice(0, cfg.hidden);
  // Which covers have somebody under them.
  const slots = shuffle(
    Array.from({ length: cfg.covers }, (_, i) => i),
  ).slice(0, cfg.hidden);

  const contents = Array.from({ length: cfg.covers }, (_, i) => {
    const at = slots.indexOf(i);
    return at === -1
      ? { kind: 'empty', emoji: EMPTIES[Math.floor(Math.random() * EMPTIES.length)] }
      : { kind: 'hider', ...hiders[at] };
  });

  let found = 0;

  stage.replaceChildren();

  const field = document.createElement('div');
  field.className = 'hide-field';
  field.style.setProperty('--cols', String(cfg.cols));

  contents.forEach((c, i) => {
    const cover = document.createElement('button');
    cover.className = 'hide-cover';
    cover.dataset.index = String(i);
    cover.setAttribute('aria-label', 'Kijk onder deze steen');
    cover.innerHTML = `
      <span class="hide-cover__rock">🪨</span>
      <span class="hide-cover__under ${c.kind === 'hider' ? `is-${c.anim}` : ''}">${c.kind === 'hider' ? c.emoji : c.emoji}</span>
    `;
    field.appendChild(cover);
  });

  const legend = document.createElement('div');
  legend.className = 'hide-legend';
  // How many are hiding, as that many faces. No number to read, and it doubles
  // as the tally: each one found lights up.
  legend.innerHTML = `
    <span class="hide-legend__cap">${Array.from({ length: cfg.hidden }, () => '<i>👽</i>').join('')}</span>
  `;

  const hint = document.createElement('div');
  hint.className = 'hint-strip hide-hint';
  hint.textContent = players > 1
    ? 'Zoek samen — tik op de stenen'
    : 'Tik op een steen en kijk wie eronder zit';

  stage.append(legend, field, hint);

  const pips = [...legend.querySelectorAll('i')];

  const onTap = (e) => {
    const cover = e.target.closest('.hide-cover');
    if (!cover || cover.classList.contains('is-open')) return;
    const c = contents[Number(cover.dataset.index)];
    cover.classList.add('is-open');

    if (c.kind === 'hider') {
      found += 1;
      pips[found - 1]?.classList.add('is-on');
      hud.setMeter(found / cfg.hidden);
      sfx.powerup();
      sfx.chime(found);
      if (found >= cfg.hidden) {
        later(() => finishLevel('Allemaal gevonden! 🙈'), 800);
      }
    } else {
      // Nothing under it. Still a thing that happened — a small sound, the rock
      // stays turned over, and the child moves on. Nowhere is it a mistake.
      sfx.blip();
    }
  };

  field.addEventListener('pointerup', onTap);
  listeners.push(() => field.removeEventListener('pointerup', onTap));
}

// ── The cup game ───────────────────────────────────────────────────────────

function startCups(cfg) {
  let round = 0;
  let busy = true;
  // slotOf[cup] = which of the three positions that cup is currently in.
  let slotOf = [0, 1, 2];
  let alienCup = 0;

  stage.replaceChildren();

  const table = document.createElement('div');
  table.className = 'hide-cups';

  const cupEls = [];
  for (let i = 0; i < 3; i++) {
    const cup = document.createElement('button');
    cup.className = 'hide-cup';
    cup.dataset.cup = String(i);
    cup.setAttribute('aria-label', 'Kijk onder deze steen');
    cup.innerHTML = `
      <span class="hide-cup__alien">👽</span>
      <span class="hide-cup__rock">🪨</span>
    `;
    table.appendChild(cup);
    cupEls.push(cup);
  }

  const legend = document.createElement('div');
  legend.className = 'hide-legend';
  legend.innerHTML = `<span class="hide-legend__cap">${
    Array.from({ length: CUP_ROUNDS }, () => '<i>👽</i>').join('')
  }</span>`;

  const hint = document.createElement('div');
  hint.className = 'hint-strip hide-hint';

  stage.append(legend, table, hint);
  const pips = [...legend.querySelectorAll('i')];

  function paint() {
    cupEls.forEach((el, cup) => el.style.setProperty('--slot', String(slotOf[cup])));
  }

  function lift(cup, on) {
    cupEls[cup].classList.toggle('is-lifted', on);
  }

  function newRound() {
    busy = true;
    slotOf = [0, 1, 2];
    alienCup = Math.floor(Math.random() * 3);
    cupEls.forEach((el, i) => {
      el.classList.toggle('has-alien', i === alienCup);
      el.classList.remove('is-lifted', 'is-right', 'is-wrong');
    });
    paint();
    hint.textContent = 'Kijk goed waar hij zit…';

    // Show where it is, put the rock back down, then start moving.
    lift(alienCup, true);
    sfx.blip();
    later(() => {
      lift(alienCup, false);
      sfx.flip();
      later(runShuffles, 420);
    }, 1100);
  }

  function runShuffles() {
    hint.textContent = 'Volg de steen…';
    let done = 0;
    const step = () => {
      if (done >= cfg.shuffles) {
        busy = false;
        hint.textContent = 'Waar zit hij? Tik erop!';
        return;
      }
      done += 1;
      // Swap two of the three positions. Which cup holds the alien never
      // changes — only where that cup is — so the tracking is honest.
      const a = Math.floor(Math.random() * 3);
      let b = Math.floor(Math.random() * 3);
      while (b === a) b = Math.floor(Math.random() * 3);
      const cupA = slotOf.indexOf(a);
      const cupB = slotOf.indexOf(b);
      slotOf[cupA] = b;
      slotOf[cupB] = a;
      paint();
      sfx.bounce();
      later(step, cfg.speed);
    };
    later(step, 260);
  }

  const onTap = (e) => {
    if (busy) return;
    const cup = e.target.closest('.hide-cup');
    if (!cup) return;
    busy = true;
    const picked = Number(cup.dataset.cup);
    lift(picked, true);

    if (picked === alienCup) {
      cup.classList.add('is-right');
      round += 1;
      pips[round - 1]?.classList.add('is-on');
      hud.setMeter(round / CUP_ROUNDS);
      sfx.powerup();
      hint.textContent = 'Gevonden!';
      if (round >= CUP_ROUNDS) {
        later(() => finishLevel('Je hield hem in het oog! 👀'), 950);
        return;
      }
      later(newRound, 1150);
      return;
    }

    // Wrong rock: it shows what *is* under there, then lifts the right one so
    // the child sees where it went. Nothing is lost, and the same round comes
    // round again — being shown the answer is the point.
    cup.classList.add('is-wrong');
    sfx.deny();
    hint.textContent = 'Hij zat hier!';
    later(() => {
      lift(alienCup, true);
      sfx.chime(2);
    }, 450);
    later(newRound, 1700);
  };

  table.addEventListener('pointerup', onTap);
  listeners.push(() => table.removeEventListener('pointerup', onTap));

  newRound();
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
