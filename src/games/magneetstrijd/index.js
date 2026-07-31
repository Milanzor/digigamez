import './style.css';
import { createHud, showMissionComplete } from '../../shared/ui-components.js';
import { sfx } from '../../shell/audio.js';
import { setLevel, starsForLevel } from '../../shell/progress.js';

// "Magneetstrijd" — a satellite hangs between two tractor beams and both sides
// pull.
//
// The whole design exists to solve one problem with head-to-head games on a
// classroom board: a seven-year-old mashing a button walks straight over a
// three-year-old, and the little one stops playing. So speed is not what wins
// here. Exactly one panel per side is live at a time, and only tapping *that*
// panel pulls — hammering the others does nothing at all. That turns the
// contest into reaction and attention, which is far more level across those
// four years of age than tapping speed is.
//
// The head start does the rest. A round can be opened with the satellite
// already sitting in the little one's half, chosen up front on the same kind of
// pre-screen Ruimte Invasie uses for difficulty, so the grown-up at the board
// can make a fair match out of an unfair pairing.
//
// Nobody is ever told they lost: the reward screen names who pulled it in, and
// the ladder counts the round as played either way.

const PULL = 0.052;
// How far the satellite has to travel to be landed, in rail units either way.
const HOME = 1;

let hud = null;
let raf = null;
let listeners = [];
let timers = [];
let reward = null;
let stage = null;
let level = 1;
let slug = 'magneetstrijd';
let mission = null;
let onExit = null;
let players = 1;

function levelConfig(l) {
  const n = Math.max(1, l);
  return {
    // More panels to scan, and each one lit for less time. Both dials cap, so
    // level 9 is not a different game from level 5 — just a brisker one.
    panels: Math.min(2 + Math.ceil(n / 2), 6),
    litFor: Math.max(0.62, 1.5 - n * 0.16),
    // The robot that stands in when one child plays alone. It is deliberately
    // beatable and never gets faster than a slow adult.
    robotDelay: Math.max(0.42, 0.95 - n * 0.07),
  };
}

function later(fn, ms) {
  const id = setTimeout(fn, ms);
  timers.push(id);
  return id;
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
  });

  stage = document.createElement('div');
  stage.className = 'mag-stage';
  container.appendChild(stage);

  askHandicap();
}

// ── Head start ─────────────────────────────────────────────────────────────
// Three pictures, no sentence to read: the satellite starting in the middle, or
// already most of the way into one side's half. Which side gets the advantage
// is the grown-up's call, so it is asked before the round rather than buried in
// a settings screen.
function askHandicap() {
  const screen = document.createElement('div');
  screen.className = 'mag-intro';
  screen.innerHTML = `
    <div class="eyebrow">Wie krijgt een voorsprong?</div>
    <div class="mag-intro__row">
      <button class="mag-pick" data-head="-1">
        <span class="mag-pick__art"><span class="mag-pick__rail"><i style="left:22%"></i></span></span>
        <span class="mag-pick__label">Links begint dichtbij</span>
      </button>
      <button class="mag-pick is-even" data-head="0">
        <span class="mag-pick__art"><span class="mag-pick__rail"><i style="left:50%"></i></span></span>
        <span class="mag-pick__label">Eerlijk in het midden</span>
      </button>
      <button class="mag-pick" data-head="1">
        <span class="mag-pick__art"><span class="mag-pick__rail"><i style="left:78%"></i></span></span>
        <span class="mag-pick__label">Rechts begint dichtbij</span>
      </button>
    </div>
  `;
  stage.replaceChildren(screen);

  const onPick = (e) => {
    const btn = e.target.closest('.mag-pick');
    if (!btn) return;
    sfx.select();
    // A head start of 0.45 of the rail: a clear leg up, still a real contest.
    startRound(Number(btn.dataset.head) * 0.45);
  };
  screen.addEventListener('pointerup', onPick);
  listeners.push(() => screen.removeEventListener('pointerup', onPick));
}

function startRound(head = 0) {
  const cfg = levelConfig(level);
  hud.setLevel(level);

  // pos runs -1 (left has landed it) .. +1 (right has). Positive head start
  // means the satellite starts nearer the right-hand side's home.
  let pos = head;
  let over = false;

  const sides = [
    { index: 0, dir: -1, lit: -1, timeLeft: 0, robot: false },
    { index: 1, dir: 1, lit: -1, timeLeft: 0, robot: players < 2 },
  ];

  stage.replaceChildren();

  const rail = document.createElement('div');
  rail.className = 'mag-rail';
  rail.innerHTML = `
    <span class="mag-rail__home mag-rail__home--l">🧲</span>
    <span class="mag-rail__line"></span>
    <span class="mag-rail__home mag-rail__home--r">🧲</span>
    <span class="mag-arm"><span class="mag-sat">🛰️</span></span>
  `;
  // The satellite rides a full-width arm rather than being offset itself: a
  // percentage in `translateX` is a percentage of the moved element, so moving
  // the emoji by 40% would move it by 40% of an emoji. The arm is as wide as
  // the rail, so 40% of the arm is 40% of the rail — and it stays a transform,
  // which costs no layout on a board that is also running a game loop.
  const arm = rail.querySelector('.mag-arm');

  const field = document.createElement('div');
  field.className = 'mag-field';

  const panelEls = [[], []];
  for (const side of sides) {
    const half = document.createElement('div');
    half.className = `mag-half mag-half--p${side.index + 1}${side.robot ? ' is-robot' : ''}`;

    const cap = document.createElement('div');
    cap.className = 'mag-half__cap';
    cap.textContent = side.robot ? 'Robot' : `Astronaut ${side.index + 1}`;

    const grid = document.createElement('div');
    grid.className = 'mag-grid';
    grid.style.setProperty('--cols', String(cfg.panels <= 4 ? 2 : 3));
    for (let i = 0; i < cfg.panels; i++) {
      const p = document.createElement('button');
      p.className = 'mag-panel';
      p.dataset.side = String(side.index);
      p.dataset.panel = String(i);
      p.setAttribute('aria-label', `Paneel ${i + 1}`);
      grid.appendChild(p);
      panelEls[side.index].push(p);
    }

    half.append(cap, grid);
    field.appendChild(half);
  }

  const legend = document.createElement('div');
  legend.className = 'mag-legend';
  legend.innerHTML = `
    <span class="mag-legend__item"><span class="mag-legend__panel is-lit"></span><span class="mag-legend__mark mag-legend__mark--yes">👆</span></span>
    <span class="mag-legend__sep"></span>
    <span class="mag-legend__item"><span class="mag-legend__panel"></span><span class="mag-legend__mark mag-legend__mark--no">✕</span></span>
  `;

  stage.append(rail, field, legend);

  function paint() {
    arm.style.transform = `translateX(${pos * 40}%)`;
    rail.style.setProperty('--lean', String(pos));
  }

  function relight(side, delay = 0) {
    side.lit = -1;
    panelEls[side.index].forEach((p) => p.classList.remove('is-lit'));
    later(() => {
      if (over) return;
      let next = Math.floor(Math.random() * cfg.panels);
      // Never the same panel twice running: a child would otherwise learn to
      // camp a finger on one square, which is the mashing this game avoids.
      if (cfg.panels > 1 && next === side.lastLit) next = (next + 1) % cfg.panels;
      side.lastLit = next;
      side.lit = next;
      side.timeLeft = cfg.litFor;
      panelEls[side.index][next].classList.add('is-lit');
      sfx.blip();
      if (side.robot) {
        side.robotAt = cfg.robotDelay * (0.8 + Math.random() * 0.5);
      }
    }, delay);
  }

  function pull(side) {
    pos += side.dir * PULL;
    sfx.impact();
    panelEls[side.index][side.lit]?.classList.add('is-hit');
    const hitEl = panelEls[side.index][side.lit];
    later(() => hitEl?.classList.remove('is-hit'), 180);
    relight(side, 140);
    paint();

    if (Math.abs(pos) >= HOME) finishRound(pos > 0 ? 1 : 0);
  }

  const onTap = (e) => {
    if (over) return;
    const panel = e.target.closest('.mag-panel');
    if (!panel) return;
    const side = sides[Number(panel.dataset.side)];
    if (side.robot) return;
    if (side.lit !== Number(panel.dataset.panel)) {
      // A dark panel does nothing whatsoever. No penalty, no sound worth
      // chasing — the only way to get anywhere is to find the lit one.
      panel.classList.add('is-dud');
      later(() => panel.classList.remove('is-dud'), 200);
      return;
    }
    pull(side);
  };

  field.addEventListener('pointerdown', onTap);
  listeners.push(() => field.removeEventListener('pointerdown', onTap));

  function finishRound(winner) {
    if (over) return;
    over = true;
    pos = Math.sign(pos) * HOME;
    paint();
    panelEls.flat().forEach((p) => p.classList.remove('is-lit'));
    sfx.missionComplete();

    const cleared = level;
    level += 1;
    setLevel(slug, level);

    const won = players > 1
      ? `Astronaut ${winner + 1} heeft de satelliet! 🛰️`
      : winner === 0
        ? 'Jij hebt de satelliet! 🛰️'
        : 'De robot was net sneller 🤖';

    reward = showMissionComplete(stage, {
      icon: winner === 0 || players > 1 ? mission.icon : '🤖',
      color: mission.color,
      mission: mission.title,
      level: cleared,
      stars: starsForLevel(level),
      title: won,
      onNext: () => { reward = null; askHandicap(); },
      onRetry: () => { reward = null; level = cleared; hud.setLevel(level); askHandicap(); },
      onHome: onExit,
    });
  }

  // --- loop ---------------------------------------------------------------
  paint();
  sides.forEach((side, i) => relight(side, 500 + i * 120));

  let last = performance.now();
  function loop(now) {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;

    if (!over) {
      for (const side of sides) {
        if (side.lit < 0) continue;
        side.timeLeft -= dt;

        if (side.robot) {
          side.robotAt -= dt;
          if (side.robotAt <= 0) {
            pull(side);
            continue;
          }
        }

        // Timed out unclicked: the panel simply moves. Missing costs nothing,
        // which is what keeps a slower child in the round.
        if (side.timeLeft <= 0) relight(side, 120);
      }
    }

    raf = requestAnimationFrame(loop);
  }
  raf = requestAnimationFrame(loop);
}

export function destroy() {
  if (raf) cancelAnimationFrame(raf);
  raf = null;
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
