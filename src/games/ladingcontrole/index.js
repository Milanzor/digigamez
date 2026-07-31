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
// The loadmaster is the buddy from Maak je Maatje. That is the payoff PLAN §6c
// wanted from a shared creature: the alien a child built in another mission is
// standing in this one's cargo bay, and the hub stops being twenty-four
// separate cupboards.

const MAX_CRATES = 24;

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

// Three rounds to a level: enough that a number is met more than once, few
// enough that a four-year-old still gets to the reward screen.
const ROUNDS = 3;

function levelConfig(l) {
  const n = Math.max(1, l);
  if (n === 1) return { max: 5, mode: 'exact' };
  if (n === 2) return { max: 10, mode: 'exact' };
  if (n === 3) return { max: 20, mode: 'exact' };
  if (n === 4) return { max: 10, mode: 'sum' };
  if (n === 5) return { max: 12, mode: 'compare' };
  // Beyond the ladder the three kinds of order rotate on the big numbers, so
  // there is always a next level without a new mechanic to explain.
  return { max: 20, mode: ['exact', 'sum', 'compare'][n % 3] };
}

function later(fn, ms) {
  const id = setTimeout(fn, ms);
  timers.push(id);
  return id;
}

const rnd = (n) => Math.floor(Math.random() * n) + 1;

// Pips in rows of five. Counting eighteen loose dots is a different, much
// harder task than counting three rows of five and three over — and grouping in
// fives is the thing this age is on its way to anyway.
function pips(n, extraClass = '') {
  let out = '';
  for (let i = 0; i < n; i++) {
    const gap = i > 0 && i % 5 === 0 ? ' is-group' : '';
    out += `<i class="${gap}"></i>`;
  }
  return `<span class="cargo-pips ${extraClass}">${out}</span>`;
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
    meter: 'Vrachten',
  });

  stage = document.createElement('div');
  stage.className = 'cargo-stage';
  container.appendChild(stage);

  startLevel();
}

function startLevel() {
  const cfg = levelConfig(level);
  hud.setLevel(level);
  hud.setMeter(0);

  let round = 0;
  let order = null;
  let loaded = 0;
  let preloaded = 0;
  let busy = false;

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

  const tally = document.createElement('div');
  tally.className = 'cargo-tally';

  const launchBtn = document.createElement('button');
  launchBtn.className = 'cargo-launch';
  launchBtn.setAttribute('aria-label', 'Laat de raket vertrekken');
  launchBtn.innerHTML = '<span>🚀</span>';

  bay.append(buddyWrap, hold, tally, launchBtn);

  const pile = document.createElement('div');
  pile.className = 'cargo-pile';

  const hint = document.createElement('div');
  hint.className = 'hint-strip cargo-hint';

  stage.append(orderEl, bay, pile, hint);

  startBuddy(buddyCanvas);

  // --- the order ----------------------------------------------------------

  function newOrder() {
    if (cfg.mode === 'sum') {
      // "There were three in already, two more are coming." The hold starts
      // part-full, so the child adds on rather than counting from zero — which
      // is the whole difference between counting and arithmetic.
      const a = rnd(Math.max(2, Math.floor(cfg.max / 2)));
      const b = rnd(Math.max(2, Math.floor(cfg.max / 2)));
      return { kind: 'sum', a, b, target: a + b };
    }
    if (cfg.mode === 'compare') {
      const n = 2 + rnd(Math.max(2, cfg.max - 3));
      const more = Math.random() < 0.5;
      return { kind: 'compare', n, more };
    }
    return { kind: 'exact', target: rnd(cfg.max) };
  }

  function satisfied() {
    if (order.kind === 'compare') {
      return order.more ? loaded > order.n : loaded < order.n && loaded > 0;
    }
    return loaded === order.target;
  }

  function renderOrder() {
    if (order.kind === 'sum') {
      orderEl.className = 'cargo-order';
      orderEl.innerHTML = `
        <div class="eyebrow">Er zaten er al ${order.a} in — er komen er ${order.b} bij</div>
        <div class="cargo-order__row">
          <span class="cargo-order__num">${order.a}</span>
          ${pips(order.a, 'is-was')}
          <span class="cargo-order__op">+</span>
          <span class="cargo-order__num">${order.b}</span>
          ${pips(order.b)}
        </div>
      `;
      return;
    }
    if (order.kind === 'compare') {
      orderEl.className = 'cargo-order cargo-order--compare';
      orderEl.innerHTML = `
        <div class="eyebrow">Laad er ${order.more ? 'méér' : 'minder'} dan dit in</div>
        <div class="cargo-order__row">
          <span class="cargo-order__arrow">${order.more ? '⬆' : '⬇'}</span>
          <span class="cargo-order__num">${order.n}</span>
          ${pips(order.n)}
        </div>
      `;
      return;
    }
    orderEl.className = 'cargo-order';
    orderEl.innerHTML = `
      <div class="eyebrow">Laad precies dit aantal kratten</div>
      <div class="cargo-order__row">
        <span class="cargo-order__num">${order.target}</span>
        ${pips(order.target)}
      </div>
    `;
  }

  // --- crates -------------------------------------------------------------

  function crate(where, index) {
    const el = document.createElement('button');
    el.className = `cargo-crate is-${where}`;
    el.dataset.index = String(index);
    el.setAttribute('aria-label', where === 'hold' ? 'Krat er weer uit halen' : 'Krat inladen');
    el.innerHTML = '<span>📦</span>';
    return el;
  }

  function renderHold() {
    const kids = [];
    for (let i = 0; i < loaded; i++) {
      const el = crate('hold', i);
      // The crates that were already in the hold cannot be taken out again —
      // they are the "there were three in" half of an addition, not part of
      // what the child is being asked to put in.
      if (i < preloaded) el.classList.add('is-locked');
      kids.push(el);
    }
    hold.replaceChildren(...kids);

    tally.innerHTML = `
      <span class="cargo-tally__num">${loaded}</span>
      ${pips(loaded, 'is-tally')}
    `;
  }

  function renderPile() {
    // Always a few more crates on the pallet than the order can possibly need,
    // so running out is never the reason a child is stuck.
    const spare = Math.min(MAX_CRATES, Math.max(order.target ?? order.n, loaded) + 4) - loaded;
    pile.replaceChildren(...Array.from({ length: Math.max(0, spare) }, (_, i) => crate('pile', i)));
  }

  function renderAll() {
    renderOrder();
    renderHold();
    renderPile();
    hint.textContent = players > 1
      ? 'Laad samen — en druk daarna op de raket'
      : 'Tik op een krat om hem in te laden';
  }

  // --- rounds -------------------------------------------------------------

  function newRound() {
    order = newOrder();
    preloaded = order.kind === 'sum' ? order.a : 0;
    loaded = preloaded;
    busy = false;
    launchBtn.classList.remove('is-ready', 'is-off');
    renderAll();
  }

  function reflectReady() {
    launchBtn.classList.toggle('is-ready', satisfied());
  }

  const onPile = (e) => {
    if (busy) return;
    const el = e.target.closest('.cargo-crate');
    if (!el) return;
    if (loaded >= MAX_CRATES) {
      sfx.deny();
      return;
    }
    loaded += 1;
    sfx.dock();
    renderHold();
    renderPile();
    reflectReady();
  };

  const onHold = (e) => {
    if (busy) return;
    const el = e.target.closest('.cargo-crate');
    if (!el || el.classList.contains('is-locked')) return;
    loaded -= 1;
    sfx.back();
    renderHold();
    renderPile();
    reflectReady();
  };

  const onLaunch = () => {
    if (busy) return;
    if (!satisfied()) {
      // Not a buzzer. The hatch shakes, the two amounts are put side by side,
      // and the child counts again — the crates all stay exactly where they are.
      busy = true;
      sfx.deny();
      bay.classList.add('is-wrong');
      showCompare();
      later(() => {
        bay.classList.remove('is-wrong');
        busy = false;
      }, 1400);
      return;
    }

    busy = true;
    sfx.launch();
    bay.classList.add('is-launching');
    round += 1;
    hud.setMeter(round / ROUNDS);

    later(() => {
      bay.classList.remove('is-launching');
      if (round >= ROUNDS) finishLevel();
      else newRound();
    }, 1250);
  };

  // The one piece of feedback that has to be a picture: what was asked next to
  // what is in the hold, aligned so the difference is a length rather than a
  // subtraction.
  function showCompare() {
    const wanted = order.kind === 'compare' ? order.n : order.target;
    hud.banner(
      `${order.kind === 'compare' ? (order.more ? 'Er moeten er méér in' : 'Er moeten er minder in') : 'Kijk nog eens'}`,
      {
        sub: `gevraagd ${wanted} · ingeladen ${loaded}`,
        ms: 1400,
        hint: true,
      },
    );
  }

  pile.addEventListener('pointerup', onPile);
  hold.addEventListener('pointerup', onHold);
  launchBtn.addEventListener('pointerup', onLaunch);
  listeners.push(() => {
    pile.removeEventListener('pointerup', onPile);
    hold.removeEventListener('pointerup', onHold);
    launchBtn.removeEventListener('pointerup', onLaunch);
  });

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
      title: 'Alle vrachten geladen! 📦',
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
