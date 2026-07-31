import './style.css';
import { createHud, showMissionComplete } from '../../shared/ui-components.js';
import { sfx } from '../../shell/audio.js';
import { setLevel, starsForLevel } from '../../shell/progress.js';
import { getMaatje, hasMaatje, drawMaatjeIn } from '../../shell/maatje.js';

// "Ladingcontrole" — load exactly this many crates and the rocket leaves.
//
// The counting game, and the whole design problem was making it not feel like
// being tested. So there is no question and no answer box: there is a rocket
// that will not go until the hold is right, and crates you can put in and take
// back out as often as you like. A child who loads four instead of five finds
// out by pressing launch, and pressing launch again after fixing it costs
// nothing. Being wrong is a step in the task rather than a mark against them.
//
// Every quantity is shown twice — as pips and as a numeral — because that is
// the bridge this age is actually crossing. A three-year-old counts the pips; a
// six-year-old reads the 12 and stops counting; for a while a child does both
// and checks one against the other, which is exactly the moment worth
// supporting.
//
// The first version of this was not a game, and the reason was one line of CSS.
// The launch handle lit up green the instant the hold was right, which meant the
// winning strategy was to tap crates one at a time and watch the button — the
// counting was optional, and so nobody counted. Three things replaced that
// light:
//
//  1. **The handle is always live.** Deciding you are done is the move the game
//     is about, so the game cannot make it for you. Getting it wrong still costs
//     nothing but a second look, and that second look is now a *picture*: the
//     order and the hold as two rows of pips, one under the other, so the
//     difference is a length instead of a subtraction.
//  2. **Crates worth more than one.** From level 4 the pallet carries crates of
//     1, 2 and 5, drawn at three widths and marked with pips. Thirteen is now
//     5+5+2+1, so there is no "tap until it turns" to fall back on — the tap
//     count and the answer have come apart, and what is left is composing a
//     number, which is the actual skill.
//  3. **A departure window.** A thin amber bar drains over the round; launching
//     while it still has something in it pays a bonus, and perfect launches in a
//     row multiply it. It can only ever add — running out does nothing at all —
//     because a countdown that takes something away from a four-year-old buys
//     urgency at a price this app does not pay anywhere else.
//
// The running total is the other thing that used to hand out the answer: with
// "13" printed above the hold and "13" printed in it, matching two numerals is
// not counting. So from level 5 the total is a `?` on a button, and tapping it
// makes the loadmaster count the hold out loud — one pip, one chime, restarting
// the pitch every five so counting in fives is something you can *hear*. It is
// unlimited and free. A child who needs it gets it by asking, which is a
// different thing from being told.
//
// The loadmaster is the buddy from Maak je Maatje. That is the payoff PLAN §6c
// wanted from a shared creature: the alien a child built in another mission is
// standing in this one's cargo bay, and the hub stops being twenty-four
// separate cupboards.

// The hold is three rows deep and no more, so both of these are the point at
// which it would start clipping rather than an arbitrary ceiling.
const MAX_CRATES = 24;
const MAX_UNITS = 32;

let hud = null;
let stage = null;
let level = 1;
let slug = 'ladingcontrole';
let mission = null;
let reward = null;
let onExit = null;
let players = 1;
let listeners = [];
let timers = [];
let buddyRaf = null;
let score = 0;

// The ladder. Every step adds exactly one thing, and the two that change *how*
// you count rather than *how far* — crates worth more than one, and the total
// going behind a button — arrive on their own level with everything else held
// still.
function levelConfig(l) {
  const n = Math.max(1, l);
  if (n === 1) return { max: 5, modes: ['exact'], rounds: 3, tally: true, clock: 0, crates: 'unit' };
  if (n === 2) return { max: 10, modes: ['exact'], rounds: 3, tally: true, clock: 1, crates: 'unit' };
  if (n === 3) return { max: 10, modes: ['exact', 'sum'], rounds: 4, tally: true, clock: 1, crates: 'unit' };
  if (n === 4) return { max: 20, modes: ['exact', 'sum', 'unload'], rounds: 4, tally: true, clock: 1, crates: 'mixed' };
  if (n === 5) return { max: 20, modes: ['exact', 'sum', 'unload', 'compare'], rounds: 4, tally: false, clock: 1, crates: 'mixed' };
  // Beyond the ladder the six kinds of order rotate on the big numbers with a
  // tighter window, so there is always a next level without a new mechanic to
  // explain.
  return {
    max: 20,
    modes: ['exact', 'sum', 'unload', 'compare', 'double', 'between'],
    rounds: 5,
    tally: false,
    clock: 0.8,
    crates: 'mixed',
  };
}

const UNIT_PILE = [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1];
// Six ones, four twos and three fives: twenty-nine units on the pallet, so no
// order can run it dry, and enough of each kind that 13 can be built as 5+5+2+1
// or as 5+2+2+2+1+1 — both are right and a child should be able to find either.
const MIXED_PILE = [1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 5, 5, 5];

function later(fn, ms) {
  const id = setTimeout(fn, ms);
  timers.push(id);
  return id;
}

function clearTimers() {
  timers.forEach(clearTimeout);
  timers = [];
}

const rnd = (n) => Math.floor(Math.random() * n) + 1;

const calm = () => document.documentElement.hasAttribute('data-calm');

// Pips in rows of five. Counting eighteen loose dots is a different, much
// harder task than counting three rows of five and three over — and grouping in
// fives is the thing this age is on its way to anyway.
function pips(n, { cls = '', mark = null } = {}) {
  let out = '';
  for (let i = 0; i < n; i++) {
    const gap = i > 0 && i % 5 === 0 ? ' is-group' : '';
    const extra = mark ? ` ${mark(i)}` : '';
    out += `<i class="${gap}${extra}"></i>`;
  }
  return `<span class="cargo-pips ${cls}">${out}</span>`;
}

// FLIP over both crate containers. A crate does not get re-rendered when it is
// loaded, it gets *moved*, and everything it pushed aside slides rather than
// jumping — which is what makes the pallet read as a place things come from
// instead of a list that reshuffles. Measure, mutate, animate the deltas: one
// layout pass per tap, none per frame.
function flip(nodes, mutate) {
  if (calm()) {
    mutate();
    return;
  }
  const before = new Map();
  for (const n of nodes) before.set(n, n.getBoundingClientRect());
  mutate();
  for (const n of nodes) {
    const b = before.get(n);
    if (!b || !n.isConnected) continue;
    const a = n.getBoundingClientRect();
    const dx = b.left - a.left;
    const dy = b.top - a.top;
    if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
    n.animate(
      [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }],
      { duration: 260, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
    );
  }
}

// Delegated tap, with the same contract as `onTap` from the shell: the press has
// to start and end on the same crate and may not have travelled further than a
// finger-width. It is delegated rather than bound per crate because crates are
// created, moved and destroyed all round long, and a hand crossing a 75" board
// on its way somewhere else must not be able to load a shipment on the way past.
function onTapWithin(root, selector, handler, tolerance = 24) {
  let target = null;
  let startX = 0;
  let startY = 0;
  let startId = null;

  const down = (e) => {
    target = e.target.closest(selector);
    if (!target) return;
    startId = e.pointerId;
    startX = e.clientX;
    startY = e.clientY;
  };
  const up = (e) => {
    if (!target || e.pointerId !== startId) return;
    const hit = e.target.closest(selector);
    const moved = Math.abs(e.clientX - startX) >= tolerance || Math.abs(e.clientY - startY) >= tolerance;
    if (hit === target && !moved) handler(target, e);
    target = null;
    startId = null;
  };
  const cancel = () => {
    target = null;
    startId = null;
  };

  root.addEventListener('pointerdown', down);
  root.addEventListener('pointerup', up);
  root.addEventListener('pointercancel', cancel);
  return () => {
    root.removeEventListener('pointerdown', down);
    root.removeEventListener('pointerup', up);
    root.removeEventListener('pointercancel', cancel);
  };
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
  score = 0;

  // One shared score, like Meteoor Meppen: two children load the same hold with
  // ten fingers on the same glass, and there is no honest way to say whose
  // finger put which crate aboard.
  hud = createHud(container, {
    title: opts.title,
    onExit: opts.onExit,
    level,
    showScore: true,
    meter: 'Vrachten',
  });

  stage = document.createElement('div');
  stage.className = 'cargo-stage';
  container.appendChild(stage);

  startLevel();
}

function startLevel() {
  const cfg = levelConfig(level);
  clearTimers();
  listeners.forEach((off) => off());
  listeners = [];

  hud.setLevel(level);
  hud.setMeter(0);
  hud.setScore(0, score);

  let round = 0;
  let order = null;
  let lastMode = null;
  let loaded = 0;        // units aboard
  let preloaded = 0;     // units that were aboard before the child started
  let busy = false;
  let flawless = true;   // every round of this level launched right the first time
  let cleanRound = true;
  let streak = 0;
  let levelScore = 0;
  let roundStart = 0;
  let window_ = 0;       // seconds of bonus window for this round

  stage.replaceChildren();

  const orderEl = document.createElement('div');
  orderEl.className = 'cargo-order';

  const bay = document.createElement('div');
  bay.className = 'cargo-bay';

  const buddyWrap = document.createElement('div');
  buddyWrap.className = 'cargo-buddy';
  const buddyCanvas = document.createElement('canvas');
  buddyCanvas.width = 220;
  buddyCanvas.height = 260;
  buddyWrap.appendChild(buddyCanvas);

  const hold = document.createElement('div');
  hold.className = 'cargo-hold';

  // The tally is a button, and that is the whole scaffold: on the early levels
  // it shows the running total anyway, and from level 5 it shows a `?` until you
  // press it and the hold is counted out loud. Making the readout itself the
  // control keeps the target the size of the readout — a separate little "count
  // for me" key would have been under the 88px floor.
  const tally = document.createElement('button');
  tally.className = 'cargo-tally';
  tally.setAttribute('aria-label', 'Tel de kratten in het ruim');

  const launchBtn = document.createElement('button');
  launchBtn.className = 'cargo-launch';
  launchBtn.setAttribute('aria-label', 'Laat de raket vertrekken');
  launchBtn.innerHTML = '<i class="cargo-launch__flame"></i><span class="cargo-launch__ship">🚀</span>';

  const combo = document.createElement('div');
  combo.className = 'cargo-combo';

  const rocketWrap = document.createElement('div');
  rocketWrap.className = 'cargo-rocket';
  rocketWrap.append(launchBtn, combo);

  bay.append(buddyWrap, hold, tally, rocketWrap);

  const pile = document.createElement('div');
  pile.className = 'cargo-pile';

  const hint = document.createElement('div');
  hint.className = 'hint-strip cargo-hint';

  // The second look, as a picture. Two rows of pips one under the other with the
  // shortfall drawn as empty rings and the surplus struck through: the mistake
  // is a length you can see rather than a sum you have to do.
  const check = document.createElement('div');
  check.className = 'cargo-check';
  check.setAttribute('aria-live', 'polite');

  stage.append(orderEl, bay, pile, hint, check);

  startBuddy(buddyCanvas);

  // --- the order ----------------------------------------------------------

  function pickMode() {
    const pool = cfg.modes.length > 1 ? cfg.modes.filter((m) => m !== lastMode) : cfg.modes;
    const mode = pool[Math.floor(Math.random() * pool.length)];
    lastMode = mode;
    return mode;
  }

  function newOrder() {
    const mode = pickMode();
    if (mode === 'sum') {
      // "There were three in already, two more are coming." The hold starts
      // part-full, so the child adds on rather than counting from zero — which
      // is the whole difference between counting and arithmetic.
      const a = rnd(Math.max(2, Math.floor(cfg.max / 2)));
      const b = rnd(Math.max(2, Math.floor(cfg.max / 2)));
      return { kind: 'sum', a, b, target: a + b, preload: a, locked: true };
    }
    if (mode === 'unload') {
      // The one order that runs the other way. Taking crates back out was
      // always possible — here it is the assignment, which makes this the only
      // place in the app where a child subtracts.
      // Capped well under `cfg.max`: a hold that starts with twenty crates in it
      // is a wall rather than an amount, and the counting has to survive taking
      // five of them back out again.
      const start = 4 + rnd(Math.max(3, Math.min(cfg.max, 13) - 3));
      const out = 1 + Math.floor(Math.random() * Math.min(5, start - 1));
      return { kind: 'unload', start, out, target: start - out, preload: start, locked: false };
    }
    if (mode === 'compare') {
      const n = 2 + rnd(Math.max(2, cfg.max - 3));
      return { kind: 'compare', n, more: Math.random() < 0.5 };
    }
    if (mode === 'between') {
      const lo = 1 + rnd(Math.max(2, cfg.max - 6));
      return { kind: 'between', lo, hi: lo + 2 + rnd(3) };
    }
    if (mode === 'double') {
      const n = rnd(Math.max(2, Math.floor(cfg.max / 2)));
      return { kind: 'double', n, target: n * 2 };
    }
    return { kind: 'exact', target: rnd(cfg.max) };
  }

  function satisfied() {
    if (order.kind === 'compare') return order.more ? loaded > order.n : loaded < order.n && loaded > 0;
    if (order.kind === 'between') return loaded > order.lo && loaded < order.hi;
    return loaded === order.target;
  }

  // How big the order is, for the size of the bonus window and for the pile.
  function orderSize() {
    if (order.kind === 'compare') return order.n + 2;
    if (order.kind === 'between') return order.hi;
    return order.target;
  }

  function renderOrder() {
    const parts = {
      exact: () => `
        <div class="eyebrow">Laad precies dit aantal kratten</div>
        <div class="cargo-order__row">
          <span class="cargo-order__num">${order.target}</span>
          ${pips(order.target)}
        </div>`,
      sum: () => `
        <div class="eyebrow">Er zaten er al ${order.a} in — er komen er ${order.b} bij</div>
        <div class="cargo-order__row">
          <span class="cargo-order__num">${order.a}</span>
          ${pips(order.a, { cls: 'is-was' })}
          <span class="cargo-order__op">+</span>
          <span class="cargo-order__num">${order.b}</span>
          ${pips(order.b)}
        </div>`,
      unload: () => `
        <div class="eyebrow">Er zitten er ${order.start} in — er moeten er ${order.out} uit</div>
        <div class="cargo-order__row">
          <span class="cargo-order__num">${order.start}</span>
          ${pips(order.start, { mark: (i) => (i >= order.start - order.out ? 'is-out' : '') })}
          <span class="cargo-order__op">−</span>
          <span class="cargo-order__num">${order.out}</span>
        </div>`,
      compare: () => `
        <div class="eyebrow">Laad er ${order.more ? 'méér' : 'minder'} dan dit in</div>
        <div class="cargo-order__row">
          <span class="cargo-order__arrow">${order.more ? '⬆' : '⬇'}</span>
          <span class="cargo-order__num">${order.n}</span>
          ${pips(order.n)}
        </div>`,
      between: () => `
        <div class="eyebrow">Meer dan ${order.lo}, minder dan ${order.hi}</div>
        <div class="cargo-order__row">
          <span class="cargo-order__num">${order.lo}</span>
          ${pips(order.lo)}
          <span class="cargo-order__op">‹ ? ›</span>
          <span class="cargo-order__num">${order.hi}</span>
          ${pips(order.hi)}
        </div>`,
      double: () => `
        <div class="eyebrow">Laad er twee keer zoveel in als dit</div>
        <div class="cargo-order__row">
          <span class="cargo-order__num">${order.n}</span>
          ${pips(order.n)}
          <span class="cargo-order__op">× 2</span>
        </div>`,
    };

    orderEl.className = `cargo-order cargo-order--${order.kind}`;
    orderEl.innerHTML = parts[order.kind]()
      + (window_ ? '<div class="cargo-timer"><span class="eyebrow">Premie</span><span class="cargo-timer__track"><i></i></span></div>' : '');

    if (window_) {
      // One CSS animation for the whole round instead of a rAF that repaints a
      // bar sixty times a second; the bonus itself is read off `performance.now()`
      // at the moment of launch, so nothing has to be sampled while it runs. The
      // node is rebuilt every round, which is also the restart — no fill-mode to
      // clean up after (§2b).
      const fill = orderEl.querySelector('.cargo-timer__track i');
      if (fill) fill.style.animationDuration = `${window_}s`;
    }
  }

  // --- crates -------------------------------------------------------------

  function crate(value, locked = false) {
    const el = document.createElement('button');
    el.className = `cargo-crate is-v${value}${locked ? ' is-locked' : ''}`;
    el.dataset.value = String(value);
    el.setAttribute('aria-label', value > 1 ? `Krat met ${value} kisten` : 'Krat');
    el.innerHTML = `<span class="cargo-crate__box">📦</span>${value > 1 ? pips(value, { cls: 'is-mark' }) : ''}`;
    return el;
  }

  function unitsIn(el) {
    return Number(el.dataset.value) || 1;
  }

  function sumOf(container) {
    let total = 0;
    for (const el of container.children) total += unitsIn(el);
    return total;
  }

  function renderTally(showing = null) {
    const value = showing === null
      ? (cfg.tally ? String(loaded) : '?')
      : String(showing);
    const drawPips = showing !== null || cfg.tally;
    tally.innerHTML = `
      <span class="cargo-tally__num">${value}</span>
      ${drawPips ? pips(showing === null ? loaded : showing, { cls: 'is-tally' }) : ''}
      <span class="cargo-tally__hint">tel mee</span>
    `;
  }

  // The pallet is kept stocked rather than rebuilt: a crate that leaves is
  // replaced at the back, so the pile never runs dry and never visibly
  // reshuffles under the child's hands.
  function stockList() {
    return cfg.crates === 'mixed' ? MIXED_PILE : UNIT_PILE.slice(0, Math.min(UNIT_PILE.length, orderSize() + 4));
  }

  function topUpPile() {
    const want = stockList();
    const have = [...pile.children].map(unitsIn);
    const missing = [];
    for (const v of want) {
      const at = have.indexOf(v);
      if (at === -1) missing.push(v);
      else have.splice(at, 1);
    }
    for (const v of missing) {
      const el = crate(v);
      pile.appendChild(el);
      if (!calm()) {
        el.animate(
          [{ opacity: 0, transform: 'scale(0.6)' }, { opacity: 1, transform: 'scale(1)' }],
          { duration: 220, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
        );
      }
    }
  }

  function fillPile() {
    pile.replaceChildren(...stockList().map((v) => crate(v)));
  }

  function fillHold() {
    const kids = [];
    for (let i = 0; i < preloaded; i++) kids.push(crate(1, Boolean(order.locked)));
    hold.replaceChildren(...kids);
  }

  function renderHint() {
    if (players > 1) {
      hint.textContent = 'Laad samen — druk op de raket als het klopt';
      return;
    }
    if (order.kind === 'unload') hint.textContent = 'Tik in het ruim om een krat eruit te halen';
    else if (!cfg.tally) hint.textContent = 'Tik op de teller om mee te tellen';
    else hint.textContent = 'Tik op een krat om hem in te laden';
  }

  // --- rounds -------------------------------------------------------------

  function newRound() {
    order = newOrder();
    preloaded = order.preload || 0;
    loaded = preloaded;
    busy = false;
    cleanRound = true;
    // The window scales with the order: twenty crates cannot be counted in the
    // time five can, and a bonus that is only reachable on the small numbers is
    // a bonus that punishes the big ones.
    window_ = cfg.clock ? Math.round((9 + orderSize() * 1.5) * cfg.clock) : 0;
    roundStart = performance.now();

    renderOrder();
    fillHold();
    fillPile();
    renderTally();
    renderHint();

    if (!calm()) {
      rocketWrap.animate(
        [{ transform: 'translateX(60%)', opacity: 0 }, { transform: 'translateX(0)', opacity: 1 }],
        { duration: 420, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
      );
    }
  }

  function bonusNow() {
    if (!window_) return 0;
    const left = window_ - (performance.now() - roundStart) / 1000;
    return Math.max(0, Math.min(10, Math.round((left / window_) * 10)));
  }

  function addScore(points, at) {
    score += points;
    levelScore += points;
    hud.setScore(0, score);

    const float = document.createElement('div');
    float.className = 'cargo-float';
    float.textContent = `+${points}`;
    at.appendChild(float);
    const done = () => float.remove();
    if (calm()) {
      later(done, 700);
      return;
    }
    float
      .animate(
        [
          { opacity: 0, transform: 'translateY(0) scale(0.8)' },
          { opacity: 1, transform: 'translateY(-40%) scale(1)', offset: 0.25 },
          { opacity: 0, transform: 'translateY(-140%) scale(1)' },
        ],
        { duration: 1100, easing: 'ease-out' },
      )
      .addEventListener('finish', done);
  }

  // --- interaction --------------------------------------------------------

  function moveCrate(el, to) {
    const nodes = [...pile.children, ...hold.children];
    flip(nodes, () => to.appendChild(el));
  }

  function onCrate(el) {
    if (busy) return;
    if (el.parentElement === pile) {
      const value = unitsIn(el);
      if (loaded + value > MAX_UNITS || hold.children.length >= MAX_CRATES) {
        sfx.deny();
        return;
      }
      loaded += value;
      moveCrate(el, hold);
      topUpPile();
      sfx.dock();
    } else if (el.parentElement === hold) {
      if (el.classList.contains('is-locked')) return;
      loaded -= unitsIn(el);
      // A crate taken out of the hold goes back on the pallet rather than
      // vanishing, so putting one back is visibly the same move undone.
      const nodes = [...pile.children, ...hold.children];
      flip(nodes, () => {
        el.remove();
        topUpPile();
      });
      sfx.back();
    } else {
      return;
    }
    renderTally();
  }

  // Counting the hold out loud. One pip and one chime per unit, and the pitch
  // restarts every five, so a child hears the fives as well as seeing them.
  function countAloud() {
    if (busy) return;
    const crates = [...hold.children];
    if (!crates.length) {
      sfx.deny();
      return;
    }
    busy = true;
    tally.classList.add('is-counting');

    let n = 0;
    const steps = [];
    crates.forEach((el) => {
      for (let i = 0; i < unitsIn(el); i++) steps.push(el);
    });

    const tick = (i) => {
      if (i >= steps.length) {
        later(() => {
          crates.forEach((el) => el.classList.remove('is-counting'));
          tally.classList.remove('is-counting');
          renderTally();
          busy = false;
        }, 800);
        return;
      }
      if (i > 0 && steps[i - 1] !== steps[i]) steps[i - 1].classList.remove('is-counting');
      steps[i].classList.add('is-counting');
      n += 1;
      renderTally(n);
      sfx.chime(i % 5);
      later(() => tick(i + 1), 190);
    };
    tick(0);
  }

  function onLaunch() {
    if (busy) return;
    if (!satisfied()) {
      // Not a buzzer. The hatch shakes, the two amounts are put side by side,
      // and the child counts again — the crates all stay exactly where they are.
      busy = true;
      cleanRound = false;
      flawless = false;
      streak = 0;
      renderCombo();
      sfx.deny();
      bay.classList.add('is-wrong');
      buddyWrap.classList.add('is-doubt');
      showCheck();
      later(() => {
        bay.classList.remove('is-wrong');
        buddyWrap.classList.remove('is-doubt');
        check.classList.remove('is-visible');
        busy = false;
      }, 2000);
      return;
    }

    busy = true;
    const bonus = cleanRound ? bonusNow() : 0;
    if (cleanRound) streak += 1;
    const streakBonus = cleanRound ? Math.min(3, Math.max(0, streak - 1)) * 5 : 0;
    const points = (cleanRound ? 10 : 5) + bonus + streakBonus;
    renderCombo();
    addScore(points, rocketWrap);

    sfx.launch();
    buddyWrap.classList.add('is-cheer');
    round += 1;
    hud.setMeter(round / cfg.rounds);
    if (streak >= 2) hud.banner(`${streak} keer op rij! ⭐`, { ms: 1100, hint: true });

    // The crates go aboard, then the rocket climbs. Two beats instead of the
    // whole cargo bay sliding off the top of the screen — the loadmaster stays
    // standing where they were, which is what makes the rocket the thing that
    // left.
    const aboard = [...hold.children];
    const shipRect = launchBtn.getBoundingClientRect();
    aboard.forEach((el, i) => {
      if (calm()) return;
      const r = el.getBoundingClientRect();
      el.animate(
        [
          { transform: 'translate(0, 0)', opacity: 1 },
          {
            transform: `translate(${shipRect.left + shipRect.width / 2 - r.left - r.width / 2}px, ${shipRect.top + shipRect.height / 2 - r.top - r.height / 2}px) scale(0.3)`,
            opacity: 0,
          },
        ],
        { duration: 380, delay: Math.min(24, 360 / aboard.length) * i, easing: 'ease-in', fill: 'forwards' },
      );
    });

    later(() => {
      hold.replaceChildren();
      launchBtn.classList.add('is-off');
      if (!calm()) {
        launchBtn.animate(
          [
            { transform: 'translateY(0) scale(1)' },
            { transform: 'translateY(6%) scale(0.96)', offset: 0.12 },
            { transform: 'translateY(-260%) scale(1.05)' },
          ],
          { duration: 900, easing: 'ease-in', fill: 'forwards' },
        );
      }
    }, 420);

    later(() => {
      launchBtn.classList.remove('is-off');
      launchBtn.getAnimations().forEach((a) => a.cancel());
      buddyWrap.classList.remove('is-cheer');
      if (round >= cfg.rounds) finishLevel();
      else newRound();
    }, 1450);
  }

  function renderCombo() {
    combo.textContent = streak >= 2 ? `×${streak}` : '';
    combo.classList.toggle('is-visible', streak >= 2);
    if (streak >= 2 && !calm()) {
      combo.animate(
        [{ transform: 'scale(1.6)' }, { transform: 'scale(1)' }],
        { duration: 320, easing: 'cubic-bezier(0.34, 1.56, 0.64, 1)' },
      );
    }
  }

  // The one piece of feedback that has to be a picture: what was asked above
  // what is in the hold, aligned so the difference is a length rather than a
  // subtraction. What is missing is drawn as empty rings, what is too much is
  // struck through.
  function showCheck() {
    const rows = [];
    if (order.kind === 'compare') {
      rows.push(row(order.more ? 'Meer dan' : 'Minder dan', order.n, null));
      rows.push(row('Ingeladen', loaded, null));
    } else if (order.kind === 'between') {
      rows.push(row('Meer dan', order.lo, null));
      rows.push(row('Minder dan', order.hi, null));
      rows.push(row('Ingeladen', loaded, null));
    } else {
      const wanted = order.target;
      rows.push(row('Gevraagd', wanted, null));
      const shown = Math.max(wanted, loaded);
      const same = Math.min(wanted, loaded);
      rows.push(row('Ingeladen', loaded, {
        count: shown,
        mark: (i) => (i < same ? '' : loaded < wanted ? 'is-gap' : 'is-over'),
      }));
    }

    const head = order.kind === 'compare' || order.kind === 'between'
      ? (loaded === 0 ? 'Er moet nog iets in' : 'Kijk nog eens')
      : loaded < order.target ? 'Er moeten er nog bij' : 'Er zitten er te veel in';

    check.innerHTML = `<div class="cargo-check__head">${head}</div>${rows.join('')}`;
    check.classList.add('is-visible');

    function row(label, n, opts) {
      const count = opts?.count ?? n;
      return `
        <div class="cargo-check__row">
          <span class="eyebrow">${label}</span>
          ${pips(count, { mark: opts?.mark ?? null })}
          <span class="cargo-check__num">${n}</span>
        </div>`;
    }
  }

  listeners.push(onTapWithin(stage, '.cargo-crate', onCrate));
  listeners.push(onTapWithin(stage, '.cargo-tally', countAloud));
  listeners.push(onTapWithin(stage, '.cargo-launch', onLaunch));

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
      title: flawless
        ? `Foutloos geladen — ${levelScore} punten! 📦`
        : `Alle vrachten geladen — ${levelScore} punten 📦`,
      onNext: () => { reward = null; startLevel(); },
      onRetry: () => { reward = null; level = cleared; startLevel(); },
      onHome: onExit,
    });
  }

  newRound();
}

// The loadmaster. A child who has not built a buddy yet gets a plain astronaut
// rather than the default green blob: turning up as a stranger's alien would
// spend the reveal that Maak je Maatje is for.
function startBuddy(canvas) {
  stopBuddy();
  const ctx = canvas.getContext('2d');

  if (!hasMaatje()) {
    ctx.font = '150px "Apple Color Emoji","Noto Color Emoji","Segoe UI Emoji",sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('🧑‍🚀', canvas.width / 2, canvas.height / 2);
    return;
  }

  const maatje = getMaatje();
  const t0 = performance.now();
  const step = (now) => {
    const t = (now - t0) / 1000;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawMaatjeIn(ctx, maatje, canvas.width / 2, canvas.height / 2, canvas.width * 0.96, canvas.height * 0.9, t);
    buddyRaf = requestAnimationFrame(step);
  };
  buddyRaf = requestAnimationFrame(step);
}

function stopBuddy() {
  if (buddyRaf) cancelAnimationFrame(buddyRaf);
  buddyRaf = null;
}

export function destroy() {
  stopBuddy();
  clearTimers();
  listeners.forEach((off) => off());
  listeners = [];
  reward?.close();
  reward = null;
  hud?.destroy();
  hud = null;
  stage = null;
}
