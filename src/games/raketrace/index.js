import './style.css';
import { createHud, showMissionComplete } from '../../shared/ui-components.js';
import { sfx } from '../../shell/audio.js';
import { setLevel, starsForLevel } from '../../shell/progress.js';

// "Raketrace" — two pads per rocket, alternated like a pair of running legs.
//
// This is the mission that made `supportsTwoPlayers` into a `maxPlayers` number:
// a 75" panel has room for four children shoulder to shoulder, and no boolean
// can say that. The crew screen still only asks one or two, because that
// question is about taking turns; how many rockets are on the track is a
// property of the race, so it gets asked here — the same shape of pre-screen
// Ruimte Invasie uses for its difficulty.
//
// Rhythm, not speed. Only the *next* pad is live, and it is lit, so hammering
// one pad gets a rocket precisely nowhere. That is what makes the race fair
// across four years of age: a seven-year-old's advantage over a four-year-old
// in alternating a rhythm is far smaller than their advantage in raw tapping,
// and the lit pad means a child who cannot read still knows exactly what to do.
//
// Empty lanes are flown by the station's own rockets, so one child alone still
// gets a race rather than a time trial.

const LANE_COLORS = ['#ff6b6b', '#5fe3c4', '#b98cff', '#ffa14a'];
const KICK = 0.075;

let hud = null;
let raf = null;
let listeners = [];
let timers = [];
let reward = null;
let stage = null;
let level = 1;
let slug = 'raketrace';
let mission = null;
let onExit = null;
let players = 1;

function levelConfig(l) {
  const n = Math.max(1, l);
  return {
    // A longer track and a leakier engine: the same rhythm has to be held for
    // longer, which is the only dial this game needs.
    length: Math.min(20 + n * 5, 46),
    drag: Math.min(1.5 + n * 0.16, 2.4),
    // The station rockets. Slower than a child who has found the rhythm, and
    // deliberately capped so level 9 is still winnable by a four-year-old.
    robotEvery: Math.max(0.3, 0.52 - n * 0.02),
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
  stage.className = 'race-stage';
  container.appendChild(stage);

  askLanes();
}

// How many rockets are on the track. Drawn as rockets rather than written as a
// number, so the choice is legible to the youngest racer as well.
function askLanes() {
  const screen = document.createElement('div');
  screen.className = 'race-intro';
  screen.innerHTML = `
    <div class="eyebrow">Hoeveel raketten?</div>
    <div class="race-intro__row">
      ${[2, 3, 4].map((n) => `
        <button class="race-pick" data-lanes="${n}">
          <span class="race-pick__art">${'🚀'.repeat(n)}</span>
          <span class="race-pick__label">${n} raketten</span>
        </button>
      `).join('')}
    </div>
    <div class="race-intro__note">
      ${players > 1
        ? 'Elke raket heeft twee pads — om de beurt links en rechts'
        : 'De lege banen vliegt het station zelf'}
    </div>
  `;
  stage.replaceChildren(screen);

  const onPick = (e) => {
    const btn = e.target.closest('.race-pick');
    if (!btn) return;
    sfx.select();
    startRace(Number(btn.dataset.lanes));
  };
  screen.addEventListener('pointerup', onPick);
  listeners.push(() => screen.removeEventListener('pointerup', onPick));
}

function startRace(laneCount) {
  const cfg = levelConfig(level);
  hud.setLevel(level);

  let over = false;
  let countdown = 3;
  let counting = true;

  const lanes = Array.from({ length: laneCount }, (_, i) => ({
    index: i,
    color: LANE_COLORS[i % LANE_COLORS.length],
    // Which pad is live. Alternating is the whole mechanic, so this is the only
    // piece of state a child has to track.
    next: 0,
    speed: 0,
    dist: 0,
    robot: i >= players,
    robotIn: 0,
  }));

  stage.replaceChildren();

  const track = document.createElement('div');
  track.className = 'race-track';
  track.style.setProperty('--lanes', String(laneCount));

  const padRow = document.createElement('div');
  padRow.className = 'race-pads';
  padRow.style.setProperty('--lanes', String(laneCount));

  const armEls = [];
  const padEls = [];

  for (const lane of lanes) {
    const col = document.createElement('div');
    col.className = `race-lane${lane.robot ? ' is-robot' : ''}`;
    col.style.setProperty('--lane', lane.color);
    col.innerHTML = `
      <span class="race-lane__finish">🏁</span>
      <span class="race-arm"><span class="race-rocket">🚀</span></span>
    `;
    track.appendChild(col);
    armEls.push(col.querySelector('.race-arm'));

    const pads = document.createElement('div');
    pads.className = `race-pair${lane.robot ? ' is-robot' : ''}`;
    pads.style.setProperty('--lane', lane.color);

    const cap = document.createElement('div');
    cap.className = 'race-pair__cap';
    cap.textContent = lane.robot ? 'Station' : `Astronaut ${lane.index + 1}`;

    const row = document.createElement('div');
    row.className = 'race-pair__row';
    const pair = [];
    for (let p = 0; p < 2; p++) {
      const btn = document.createElement('button');
      btn.className = 'race-pad';
      btn.dataset.lane = String(lane.index);
      btn.dataset.pad = String(p);
      btn.setAttribute('aria-label', `${p === 0 ? 'Linker' : 'Rechter'} pad van raket ${lane.index + 1}`);
      // One foot mirrored for the other pad: a left and a right, so the pair
      // reads as a stride rather than as two identical buttons.
      btn.innerHTML = `<span class="race-pad__foot${p === 0 ? ' is-left' : ''}">🦶</span>`;
      row.appendChild(btn);
      pair.push(btn);
    }
    padEls.push(pair);

    pads.append(cap, row);
    padRow.appendChild(pads);
  }

  const flag = document.createElement('div');
  flag.className = 'race-count';

  stage.append(track, padRow, flag);

  function paintPads() {
    lanes.forEach((lane, i) => {
      padEls[i].forEach((btn, p) => btn.classList.toggle('is-next', !over && !counting && lane.next === p));
    });
  }

  function paint() {
    lanes.forEach((lane, i) => {
      const k = Math.min(1, lane.dist / cfg.length);
      armEls[i].style.transform = `translateY(${-k * 86}%)`;
    });
  }

  const onPad = (e) => {
    if (over || counting) return;
    const btn = e.target.closest('.race-pad');
    if (!btn) return;
    const lane = lanes[Number(btn.dataset.lane)];
    if (lane.robot) return;
    const pad = Number(btn.dataset.pad);

    if (pad !== lane.next) {
      // The wrong foot. Nothing happens — no penalty, no noise to chase. The
      // rocket only climbs when the rhythm is right, which is the lesson.
      btn.classList.add('is-dud');
      later(() => btn.classList.remove('is-dud'), 160);
      return;
    }
    step(lane);
    btn.classList.add('is-hit');
    later(() => btn.classList.remove('is-hit'), 150);
  };

  function step(lane) {
    lane.speed += KICK;
    lane.next = 1 - lane.next;
    sfx.thruster();
    paintPads();
  }

  padRow.addEventListener('pointerdown', onPad);
  listeners.push(() => padRow.removeEventListener('pointerdown', onPad));

  function finish(winner) {
    if (over) return;
    over = true;
    paintPads();
    sfx.missionComplete();

    const cleared = level;
    level += 1;
    setLevel(slug, level);

    const lane = lanes[winner];
    const title = lane.robot
      ? 'Het station was er eerst 🛰️'
      : players > 1 || laneCount > 1
        ? `Astronaut ${winner + 1} is er! 🏁`
        : 'Je bent er! 🏁';

    reward = showMissionComplete(stage, {
      icon: lane.robot ? '🛰️' : '🏁',
      color: mission.color,
      mission: mission.title,
      level: cleared,
      stars: starsForLevel(level),
      title,
      onNext: () => { reward = null; askLanes(); },
      onRetry: () => { reward = null; level = cleared; hud.setLevel(level); askLanes(); },
      onHome: onExit,
    });
  }

  // --- loop ---------------------------------------------------------------
  paint();
  paintPads();
  flag.textContent = '3';

  let countIn = 0.75;
  let last = performance.now();
  function loop(now) {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;

    if (counting) {
      countIn -= dt;
      if (countIn <= 0) {
        countdown -= 1;
        countIn = 0.75;
        if (countdown <= 0) {
          counting = false;
          flag.textContent = '';
          flag.classList.add('is-done');
          sfx.launch();
          paintPads();
        } else {
          flag.textContent = String(countdown);
          sfx.blip();
        }
      }
    } else if (!over) {
      for (const lane of lanes) {
        if (lane.robot) {
          lane.robotIn -= dt;
          if (lane.robotIn <= 0) {
            step(lane);
            lane.robotIn = cfg.robotEvery * (0.82 + Math.random() * 0.4);
          }
        }
        // The engine leaks: thrust has to be topped up, which is what turns a
        // race into keeping a rhythm rather than into a burst at the start.
        lane.speed *= 1 - Math.min(1, dt * cfg.drag);
        lane.dist += lane.speed * dt * 26;
        if (lane.dist >= cfg.length) {
          paint();
          finish(lane.index);
          break;
        }
      }
      paint();
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
