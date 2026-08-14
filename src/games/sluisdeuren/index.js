import './style.css';
import { createHud, showMissionComplete } from '../../shared/ui-components.js';
import {
  setupCanvas, LOGICAL_WIDTH, LOGICAL_HEIGHT,
  createStars, drawSpaceBackdrop, createBurst, updateAndDrawParticles,
  drawGlow, roundRect, withAlpha,
} from '../../shared/canvas-utils.js';
import { sfx } from '../../shell/audio.js';
import { setLevel, starsForLevel } from '../../shell/progress.js';
import { getMaatje, hasMaatje, drawMaatjeIn } from '../../shell/maatje.js';

// "Sluisdeuren" — the airlock only moves while both handles are held.
//
// All six of the archive's simultaneous two-player missions are parallel play:
// two children act at the same time but neither needs the other. That is the one
// gap a 75" multi-touch panel is uniquely placed to fill, because the thing a
// board can do that two tablets cannot is put two children *inside the same
// mechanism*.
//
// So: a handle at each far edge of the screen, roughly one and three quarter
// metres apart on the real board. The doors track how many handles are held —
// none is shut, one is half, both is open — and the cargo has to be dragged
// through with a spare hand. Neither child can do it alone, and the geometry is
// what says so rather than a rule; on a laptop in the dev server one pair of
// hands reaches both handles, and on the wall it cannot.
//
// Note what the half-open state does: it is not a penalty, it is a *readout*. A
// child who lets go sees the door start to close and understands immediately
// that they are the reason. Nothing is lost — a crate caught under a closing door
// is pushed gently back out, never crushed and never reset.
//
// Level 4 is where the design lands: a crate too heavy for one hand needs two
// fingers on it, so both children have both hands committed — one on a handle,
// one on the cargo. Solo, a robot arm takes the left handle, which is a real
// accommodation rather than a lockout.

const LEVELS = [
  { doors: 1, heavy: false, closeRate: 1.1 },
  { doors: 2, heavy: false, closeRate: 1.1 },
  { doors: 2, heavy: false, closeRate: 2.6 },
  { doors: 1, heavy: true, closeRate: 1.6 },
  { doors: 2, heavy: true, closeRate: 2.0 },
];

// Two crates to a level. One is a demonstration; three is a chore.
const ROUNDS = 2;

const OPEN_RATE = 2.4;

// The corridor, the bays and the handles, all in logical canvas space.
const CORRIDOR = { x0: 250, x1: 1670, y0: 470, y1: 770 };
const CORRIDOR_H = CORRIDOR.y1 - CORRIDOR.y0;
const START_BAY = { x: 340, y: (CORRIDOR.y0 + CORRIDOR.y1) / 2 };
const GOAL_BAY = { x: 1560, y: (CORRIDOR.y0 + CORRIDOR.y1) / 2, w: 210 };
const HANDLE_W = 150;
const HANDLE = { y0: 330, y1: 900 };
const CRATE = 150;

let hud = null;
let handle = null;
let raf = null;
let listeners = [];
let timers = [];
let reward = null;
let stage = null;
let level = 1;
let slug = 'sluisdeuren';
let mission = null;
let onExit = null;

function later(fn, ms) {
  const id = setTimeout(fn, ms);
  timers.push(id);
  return id;
}

const handleRect = (side) => ({
  x: side === 'L' ? 46 : LOGICAL_WIDTH - 46 - HANDLE_W,
  y: HANDLE.y0,
  w: HANDLE_W,
  h: HANDLE.y1 - HANDLE.y0,
});

export function init(container, opts) {
  slug = opts.slug;
  level = Math.max(1, opts.startLevel || 1);
  mission = { title: opts.title, icon: opts.icon, color: opts.color };
  onExit = opts.onExit;
  reward = null;
  listeners = [];
  timers = [];

  const solo = (opts.players || 1) < 2;

  hud = createHud(container, {
    title: opts.title,
    onExit: opts.onExit,
    level,
    meter: 'Vracht',
  });

  stage = document.createElement('div');
  stage.className = 'lock-stage';
  const canvas = document.createElement('canvas');
  canvas.className = 'lock-canvas';
  const hint = document.createElement('div');
  hint.className = 'hint-line lock-hint';
  stage.append(canvas, hint);
  container.appendChild(stage);

  handle = setupCanvas(canvas, { alpha: false });
  const { ctx, toLogical } = handle;
  const backdrop = createStars(80);
  const buddy = getMaatje();
  const buddyKnown = hasMaatje();

  let cfg = LEVELS[0];
  let doors = [];
  let openness = 0;
  let crate = { x: START_BAY.x, y: START_BAY.y, delivered: 0, nudge: 0 };
  let particles = [];
  let round = 0;
  let finishing = false;
  let cheer = 0;
  let t = 0;

  // pointerId -> what that finger is doing. One finger can only ever do one job,
  // which is what makes "how many hands does this take" a real question.
  const roles = new Map();

  const heldSides = () => {
    const sides = new Set();
    for (const role of roles.values()) {
      if (role.kind === 'handle') sides.add(role.side);
    }
    if (solo) sides.add('L');
    return sides;
  };

  const cratePointers = () => [...roles.entries()].filter(([, r]) => r.kind === 'crate');

  function doorX(i) {
    return cfg.doors === 1
      ? (CORRIDOR.x0 + CORRIDOR.x1) / 2
      : CORRIDOR.x0 + ((i + 1) * (CORRIDOR.x1 - CORRIDOR.x0)) / (cfg.doors + 1);
  }

  function startLevel() {
    cfg = LEVELS[Math.min(level, LEVELS.length) - 1];
    doors = Array.from({ length: cfg.doors }, (_, i) => ({ x: doorX(i) }));
    round = 0;
    finishing = false;
    openness = 0;
    particles = [];
    roles.clear();
    hud.setLevel(level);
    hud.setMeter(0);
    hint.textContent = cfg.heavy
      ? 'Deze kist is zwaar: twee vingers erop, en houd samen de handgrepen vast'
      : 'Houd samen beide handgrepen vast en sleep de kist erdoor';
    newCrate();
  }

  function newCrate() {
    crate = { x: START_BAY.x, y: START_BAY.y, delivered: 0, nudge: 0 };
  }

  function finishLevel() {
    if (finishing) return;
    finishing = true;
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
      title: 'Samen door de sluis! 🤝',
      onNext: () => { reward = null; startLevel(); },
      onRetry: () => { reward = null; level = cleared; startLevel(); },
      onHome: onExit,
    });
  }

  // The passable gap in the middle of a door, as a y-range. At openness 0.5 —
  // one handle held — it is 150 logical pixels, and the crate is 150 wide, so
  // "one of us is holding it" visibly does not fit.
  function gapRange() {
    const mid = (CORRIDOR.y0 + CORRIDOR.y1) / 2;
    const gap = CORRIDOR_H * openness;
    return { y0: mid - gap / 2, y1: mid + gap / 2, gap };
  }

  function canPass() {
    const { y0, y1, gap } = gapRange();
    if (gap < CRATE + 10) return false;
    return crate.y - CRATE / 2 >= y0 - 2 && crate.y + CRATE / 2 <= y1 + 2;
  }

  // Doors block rather than punish: a crate that cannot fit is stopped at the
  // near face, and a crate standing in a door that closes is pushed out the way
  // it is nearest to. There is no state in which it is taken away.
  function resolveDoors(prevX) {
    const half = CRATE / 2;
    if (canPass()) return;

    for (const door of doors) {
      const overlaps = crate.x + half > door.x - 12 && crate.x - half < door.x + 12;
      const crossed = (prevX <= door.x && crate.x > door.x) || (prevX >= door.x && crate.x < door.x);

      if (crossed) {
        crate.x = prevX <= door.x ? door.x - half - 12 : door.x + half + 12;
        if (!crate.nudge) {
          crate.nudge = 1;
          sfx.impact();
        }
        return;
      }
      if (overlaps) {
        // Standing in the doorway as it shuts.
        const toLeft = Math.abs(crate.x - (door.x - half - 12));
        const toRight = Math.abs(crate.x - (door.x + half + 12));
        crate.x = toLeft < toRight ? door.x - half - 12 : door.x + half + 12;
        crate.nudge = 1;
        return;
      }
    }
  }

  function deliver() {
    if (crate.delivered) return;
    if (crate.x < GOAL_BAY.x - GOAL_BAY.w / 2) return;
    crate.delivered = 0.001;
    cheer = 1;
    sfx.dock();
    particles.push(...createBurst(crate.x, crate.y, [mission.color, '#ffffff', '#ffc24a'], {
      count: 24, speed: 280,
    }));
    // The crate is out of anybody's hands the moment it lands.
    for (const [id, role] of [...roles.entries()]) {
      if (role.kind === 'crate') roles.delete(id);
    }
    round += 1;
    hud.setMeter(round / ROUNDS);
    later(() => {
      if (round >= ROUNDS) finishLevel();
      else newCrate();
    }, 1200);
  }

  function update(dt) {
    t += dt;
    if (cheer > 0) cheer = Math.max(0, cheer - dt * 0.7);
    if (crate.nudge > 0) crate.nudge = Math.max(0, crate.nudge - dt * 2.6);

    const target = Math.min(1, heldSides().size / 2);
    const rate = target > openness ? OPEN_RATE : cfg.closeRate;
    const before = openness;
    openness += Math.max(-rate * dt, Math.min(rate * dt, target - openness));
    if (before < 0.999 && openness >= 0.999) sfx.flow();

    if (crate.delivered) {
      // Stowed: shrinks into the bay over half a second rather than blinking out
      // of existence, so the last thing the two of them see is the cargo landing.
      crate.delivered = Math.min(1, crate.delivered + dt * 2.2);
      return;
    }

    // Carried by the centroid of every finger on it, so a heavy crate moves with
    // two hands the way a heavy thing should.
    const carried = cratePointers();
    if ((cfg.heavy && carried.length >= 2) || (!cfg.heavy && carried.length >= 1)) {
      let sx = 0;
      let sy = 0;
      for (const [, role] of carried) {
        sx += role.x + role.dx;
        sy += role.y + role.dy;
      }
      const prevX = crate.x;
      crate.x = sx / carried.length;
      crate.y = sy / carried.length;
      // Inside the tube, always.
      crate.x = Math.max(CORRIDOR.x0 + CRATE / 2, Math.min(CORRIDOR.x1 - CRATE / 2, crate.x));
      crate.y = Math.max(CORRIDOR.y0 + CRATE / 2, Math.min(CORRIDOR.y1 - CRATE / 2, crate.y));
      resolveDoors(prevX);
      deliver();
    } else {
      // Let go: it settles to the middle of the tube where it stands, which also
      // means it never ends up wedged against a door face.
      const prevX = crate.x;
      crate.y += ((CORRIDOR.y0 + CORRIDOR.y1) / 2 - crate.y) * Math.min(1, dt * 5);
      resolveDoors(prevX);
    }
  }

  // --- Drawing ------------------------------------------------------------

  function drawCorridor() {
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.04)';
    roundRect(ctx, CORRIDOR.x0, CORRIDOR.y0, CORRIDOR.x1 - CORRIDOR.x0, CORRIDOR_H, 26);
    ctx.fill();
    ctx.strokeStyle = 'rgba(232,217,176,0.24)';
    ctx.lineWidth = 4;
    ctx.stroke();

    // Floor line, so the tube has a bottom to stand on.
    ctx.strokeStyle = 'rgba(232,217,176,0.12)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(CORRIDOR.x0 + 14, CORRIDOR.y1 - 26);
    ctx.lineTo(CORRIDOR.x1 - 14, CORRIDOR.y1 - 26);
    ctx.stroke();
    ctx.restore();

    // The goal bay at the right-hand end.
    ctx.save();
    ctx.fillStyle = 'rgba(255,194,74,0.07)';
    roundRect(ctx, GOAL_BAY.x - GOAL_BAY.w / 2, CORRIDOR.y0 + 8, GOAL_BAY.w, CORRIDOR_H - 16, 20);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,194,74,0.4)';
    ctx.lineWidth = 3;
    ctx.setLineDash([14, 12]);
    ctx.stroke();
    ctx.restore();

    // Whoever is waiting for the cargo. The child's own creature if they have
    // built one, and a plain astronaut if not — turning up uninvited as somebody
    // else's alien would spend the reveal that belongs to Maak je Maatje.
    const bob = Math.sin(t * 2.2) * 8 + (cheer > 0 ? Math.abs(Math.sin(t * 9)) * -22 * cheer : 0);
    if (buddyKnown) {
      drawMaatjeIn(ctx, buddy, GOAL_BAY.x, GOAL_BAY.y + bob, 168, 190, t);
    } else {
      ctx.save();
      ctx.font = '108px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('🧑‍🚀', GOAL_BAY.x, GOAL_BAY.y + bob);
      ctx.restore();
    }
  }

  function drawDoors() {
    const { y0: gy0, y1: gy1 } = gapRange();
    for (const door of doors) {
      const w = 42;
      const x = door.x - w / 2;

      ctx.save();
      // The two halves, retracting into the walls of the tube.
      [[CORRIDOR.y0, gy0], [gy1, CORRIDOR.y1]].forEach(([a, b]) => {
        if (b - a <= 1) return;
        // A small corner radius, and each half reaching three pixels past the
        // middle. At radius 10 the two halves met in a visible notch, so a shut
        // door read as very slightly open — the one thing this game must never
        // be ambiguous about.
        const h = b - a + 3;
        ctx.fillStyle = 'rgba(155,150,135,0.9)';
        roundRect(ctx, x, a, w, h, 5);
        ctx.fill();
        ctx.strokeStyle = 'rgba(5,7,15,0.5)';
        ctx.lineWidth = 3;
        ctx.stroke();
        // Hazard stripes, the one place in the archive they belong.
        ctx.save();
        ctx.beginPath();
        roundRect(ctx, x, a, w, h, 5);
        ctx.clip();
        ctx.strokeStyle = 'rgba(255,194,74,0.55)';
        ctx.lineWidth = 9;
        ctx.beginPath();
        for (let sy = a - w; sy < b + w; sy += 30) {
          ctx.moveTo(x, sy);
          ctx.lineTo(x + w, sy + w);
        }
        ctx.stroke();
        ctx.restore();
      });

      // The frame the halves run in, so a fully open door still shows where it is.
      ctx.strokeStyle = 'rgba(232,217,176,0.3)';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(door.x, CORRIDOR.y0 - 16);
      ctx.lineTo(door.x, CORRIDOR.y0 + 4);
      ctx.moveTo(door.x, CORRIDOR.y1 - 4);
      ctx.lineTo(door.x, CORRIDOR.y1 + 16);
      ctx.stroke();
      ctx.restore();
    }
  }

  function drawHandles() {
    const held = heldSides();
    for (const side of ['L', 'R']) {
      const r = handleRect(side);
      const isHeld = held.has(side);
      const robot = solo && side === 'L';

      if (isHeld) drawGlow(ctx, '#ffc24a', r.x + r.w / 2, r.y + r.h / 2, r.w * 1.5, 0.55);

      ctx.save();
      ctx.fillStyle = isHeld ? 'rgba(255,194,74,0.16)' : 'rgba(255,255,255,0.045)';
      roundRect(ctx, r.x, r.y, r.w, r.h, 44);
      ctx.fill();
      ctx.strokeStyle = isHeld ? 'rgba(255,194,74,0.85)' : 'rgba(232,217,176,0.28)';
      ctx.lineWidth = isHeld ? 5 : 3;
      ctx.stroke();

      // The grip itself: a bar to put a hand on.
      const gx = r.x + r.w / 2;
      const gy = r.y + r.h / 2;
      ctx.strokeStyle = isHeld ? '#ffd479' : 'rgba(243,236,224,0.55)';
      ctx.lineWidth = 22;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(gx, gy - r.h * 0.22);
      ctx.lineTo(gx, gy + r.h * 0.22);
      ctx.stroke();

      // A hand, so what to do with it needs no words.
      ctx.font = '64px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.globalAlpha = isHeld ? 1 : 0.5;
      ctx.fillText(robot ? '🦾' : '🖐️', gx, gy - r.h * 0.34);
      ctx.globalAlpha = 1;
      ctx.restore();
    }
  }

  function drawCrate() {
    if (crate.delivered >= 1) return;
    const carried = cratePointers().length;
    const needs = cfg.heavy ? 2 : 1;
    const lifted = carried >= needs;
    const shake = crate.nudge ? Math.sin(crate.nudge * 42) * 8 * crate.nudge : 0;

    ctx.save();
    ctx.globalAlpha = 1 - crate.delivered;
    ctx.translate(crate.x + shake, crate.y);
    if (crate.delivered) ctx.scale(1 - crate.delivered * 0.7, 1 - crate.delivered * 0.7);
    if (lifted) drawGlow(ctx, mission.color, 0, 0, CRATE * 0.9, 0.6);

    ctx.fillStyle = withAlpha(cfg.heavy ? '#d08c4a' : '#ffa14a', 0.92);
    roundRect(ctx, -CRATE / 2, -CRATE / 2, CRATE, CRATE, 22);
    ctx.fill();
    ctx.strokeStyle = 'rgba(5,7,15,0.4)';
    ctx.lineWidth = 5;
    ctx.stroke();

    ctx.fillStyle = 'rgba(5,7,15,0.2)';
    roundRect(ctx, -CRATE / 2, -CRATE / 2, CRATE, CRATE * 0.22, 16);
    ctx.fill();

    // How many hands it takes, drawn on the lid: one hand, or two with a plus.
    ctx.font = `${Math.round(CRATE * 0.3)}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (cfg.heavy) {
      ctx.fillText('🖐️', -CRATE * 0.19, CRATE * 0.1);
      ctx.fillText('🖐️', CRATE * 0.19, CRATE * 0.1);
      ctx.fillStyle = '#2c1c04';
      ctx.font = `800 ${Math.round(CRATE * 0.2)}px "Baloo 2", system-ui, sans-serif`;
      ctx.fillText('+', 0, CRATE * 0.08);
    } else {
      ctx.fillText('🖐️', 0, CRATE * 0.1);
    }

    // Fingers that are on it but not enough of them: the crate says so by
    // showing how many it still wants.
    if (carried > 0 && !lifted) {
      ctx.fillStyle = '#2c1c04';
      ctx.font = `800 ${Math.round(CRATE * 0.16)}px "Baloo 2", system-ui, sans-serif`;
      ctx.fillText(`${carried}/${needs}`, 0, -CRATE * 0.26);
    }
    ctx.restore();
  }

  // The rule as a picture, bottom-centre: two hands, a plus, and a door that is
  // open. Same principle as Magneetstrijd's legend — a four-year-old reads none
  // of the line underneath it.
  function drawLegend() {
    const y = 990;
    const x = LOGICAL_WIDTH / 2;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = '46px system-ui, sans-serif';
    ctx.globalAlpha = 0.85;
    ctx.fillText('🖐️', x - 150, y);
    ctx.fillText('🖐️', x - 60, y);
    ctx.font = '800 40px "Baloo 2", system-ui, sans-serif';
    ctx.fillStyle = '#f3ece0';
    ctx.fillText('+', x - 105, y);
    ctx.fillText('=', x - 8, y);

    // A little open door.
    const dw = 38;
    const dh = 84;
    ctx.fillStyle = 'rgba(155,150,135,0.9)';
    roundRect(ctx, x + 30, y - dh / 2, dw, dh * 0.28, 5);
    ctx.fill();
    roundRect(ctx, x + 30, y + dh / 2 - dh * 0.28, dw, dh * 0.28, 5);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,194,74,0.7)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x + 30 + dw / 2, y - dh * 0.1);
    ctx.lineTo(x + 30 + dw / 2, y + dh * 0.1);
    ctx.stroke();
    ctx.restore();
  }

  // How far the airlock has got, as a bar under the corridor: the honest readout
  // of how well the two of them are holding on.
  function drawOpennessBar() {
    const w = 460;
    const x = LOGICAL_WIDTH / 2 - w / 2;
    const y = 872;
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    roundRect(ctx, x, y, w, 18, 9);
    ctx.fill();
    // The radius has to follow the width, or a nearly-empty bar draws as a curl:
    // roundRect with r larger than half the box turns its arcs inside out.
    const fill = w * openness;
    if (fill > 2) {
      ctx.fillStyle = openness >= 0.999 ? '#ffd479' : withAlpha('#ffc24a', 0.55);
      roundRect(ctx, x, y, fill, 18, Math.min(9, fill / 2));
      ctx.fill();
    }
    ctx.restore();
  }

  function draw(dt) {
    drawSpaceBackdrop(ctx, backdrop, t, { scrollSpeed: 2 });
    drawCorridor();
    drawCrate();
    drawDoors();
    drawHandles();
    drawOpennessBar();
    drawLegend();
    updateAndDrawParticles(ctx, particles, dt, { gravity: -30 });
  }

  // --- Input --------------------------------------------------------------

  const onDown = (e) => {
    if (finishing) return;
    const p = toLogical(e.clientX, e.clientY);

    for (const side of ['L', 'R']) {
      if (solo && side === 'L') continue;
      const r = handleRect(side);
      if (p.x < r.x - 20 || p.x > r.x + r.w + 20 || p.y < r.y - 20 || p.y > r.y + r.h + 20) continue;
      roles.set(e.pointerId, { kind: 'handle', side });
      canvas.setPointerCapture?.(e.pointerId);
      sfx.blip();
      return;
    }

    if (!crate.delivered
      && Math.abs(p.x - crate.x) <= CRATE * 0.62
      && Math.abs(p.y - crate.y) <= CRATE * 0.62) {
      // The offset from the crate's centre is kept, so a second finger joining a
      // heavy crate does not yank it sideways to the midpoint of the two.
      roles.set(e.pointerId, { kind: 'crate', x: p.x, y: p.y, dx: crate.x - p.x, dy: crate.y - p.y });
      canvas.setPointerCapture?.(e.pointerId);
      sfx.blip();
    }
  };

  const onMove = (e) => {
    const role = roles.get(e.pointerId);
    if (!role || role.kind !== 'crate') return;
    const p = toLogical(e.clientX, e.clientY);
    role.x = p.x;
    role.y = p.y;
  };

  const onUp = (e) => {
    roles.delete(e.pointerId);
  };

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);
  listeners.push(() => {
    canvas.removeEventListener('pointerdown', onDown);
    canvas.removeEventListener('pointermove', onMove);
    canvas.removeEventListener('pointerup', onUp);
    canvas.removeEventListener('pointercancel', onUp);
  });

  startLevel();

  let last = performance.now();
  function loop(now) {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    update(dt);
    draw(dt);
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
  handle?.disconnect();
  handle = null;
  reward?.close();
  reward = null;
  hud?.destroy();
  hud = null;
  stage = null;
}
