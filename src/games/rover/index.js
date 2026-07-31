import './style.css';
import { createHud, showMissionComplete } from '../../shared/ui-components.js';
import {
  setupCanvas, LOGICAL_WIDTH, LOGICAL_HEIGHT,
  createBurst, updateAndDrawParticles,
  drawGlow, roundRect, drawStar,
} from '../../shared/canvas-utils.js';
import { sfx } from '../../shell/audio.js';
import { setLevel, starsForLevel } from '../../shell/progress.js';

// "Rover Programmeren" — queue up the moves first, then press ▶ and watch.
//
// The Bee-Bot/Lightbot idea, which Dutch primary schools already use, and the
// biggest piece of actual learning in the bundle: the child has to hold the
// whole route in their head before anything moves. It reuses the ▶/⏹ grammar
// the Gekke Machine established, so the console is already familiar.
//
// Driving into a rock is not a failure state — the rover bumps, says so with a
// wobble, and carries on with the next instruction. If the run ends with
// crystals left over, everything goes back to the start with the program still
// in the strip, so a child edits their plan instead of rebuilding it.

const CMDS = {
  F: { glyph: '⬆', label: 'Vooruit' },
  L: { glyph: '⤺', label: 'Links draaien' },
  R: { glyph: '⤻', label: 'Rechts draaien' },
  X: { glyph: '×2', label: 'Nog een keer' },
};

const MAX_PROGRAM = 14;
const DIRS = [
  { dx: 0, dy: -1 },
  { dx: 1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: -1, dy: 0 },
];

let hud = null;
let handle = null;
let raf = null;
let listeners = [];
let timers = [];
let reward = null;
let stage = null;
let level = 1;
let slug = 'rover';
let mission = null;
let onExit = null;

function levelConfig(l) {
  const n = Math.max(1, l);
  if (n === 1) return { size: 4, crystals: 1, rocks: 0, repeat: false };
  if (n === 2) return { size: 5, crystals: 1, rocks: 2, repeat: false };
  if (n === 3) return { size: 5, crystals: 2, rocks: 3, repeat: false };
  if (n === 4) return { size: 6, crystals: 2, rocks: 5, repeat: true };
  return { size: 6, crystals: 3, rocks: 7, repeat: true };
}

const key = (x, y) => `${x},${y}`;

function later(fn, ms) {
  const id = setTimeout(fn, ms);
  timers.push(id);
  return id;
}

// Reachability check on the free cells. Rocks are dropped at random, so this is
// what keeps every level actually solvable rather than merely likely to be.
function allReachable(size, start, rocks, crystals) {
  const blocked = new Set(rocks.map((r) => key(r.x, r.y)));
  const seen = new Set([key(start.x, start.y)]);
  const queue = [start];
  while (queue.length) {
    const cell = queue.shift();
    for (const d of DIRS) {
      const nx = cell.x + d.dx;
      const ny = cell.y + d.dy;
      const k = key(nx, ny);
      if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
      if (blocked.has(k) || seen.has(k)) continue;
      seen.add(k);
      queue.push({ x: nx, y: ny });
    }
  }
  return crystals.every((c) => seen.has(key(c.x, c.y)));
}

function buildLevel(cfg) {
  const { size } = cfg;
  const rnd = (n) => Math.floor(Math.random() * n);

  for (let attempt = 0; attempt < 60; attempt++) {
    const taken = new Set();
    const start = { x: rnd(size), y: rnd(size) };
    taken.add(key(start.x, start.y));

    const crystals = [];
    while (crystals.length < cfg.crystals) {
      const c = { x: rnd(size), y: rnd(size) };
      // Keep the first crystal a few steps away, or level 1 solves itself.
      if (taken.has(key(c.x, c.y))) continue;
      if (Math.abs(c.x - start.x) + Math.abs(c.y - start.y) < 2) continue;
      taken.add(key(c.x, c.y));
      crystals.push(c);
    }

    const rocks = [];
    let guard = 0;
    while (rocks.length < cfg.rocks && guard++ < 200) {
      const r = { x: rnd(size), y: rnd(size) };
      if (taken.has(key(r.x, r.y))) continue;
      taken.add(key(r.x, r.y));
      rocks.push(r);
    }

    if (allReachable(size, start, rocks, crystals)) {
      return { start, dir: rnd(4), crystals, rocks, size };
    }
  }
  // Fallback: an empty field is always solvable.
  return { start: { x: 0, y: 0 }, dir: 1, crystals: [{ x: size - 1, y: size - 1 }], rocks: [], size };
}

export function init(container, opts) {
  slug = opts.slug;
  level = Math.max(1, opts.startLevel || 1);
  mission = { title: opts.title, icon: opts.icon, color: opts.color };
  onExit = opts.onExit;
  reward = null;
  listeners = [];
  timers = [];

  const players = opts.players || 1;

  hud = createHud(container, {
    title: opts.title,
    onExit: opts.onExit,
    level,
    players,
    showTurn: players > 1,
  });

  stage = document.createElement('div');
  stage.className = 'rov-stage';
  const board = document.createElement('div');
  board.className = 'rov-board';
  const canvas = document.createElement('canvas');
  canvas.className = 'rov-canvas';
  board.appendChild(canvas);

  const bar = document.createElement('div');
  bar.className = 'rov-bar';
  const strip = document.createElement('div');
  strip.className = 'rov-program';
  const keys = document.createElement('div');
  keys.className = 'rov-keys';
  bar.append(strip, keys);
  stage.append(board, bar);
  container.appendChild(stage);

  // The board shares its area with the console, so this canvas is wider than
  // it is tall and the fixed 16:9 logical space gets letterboxed inside it. A
  // painted backdrop would show those bars as black margins, so the canvas is
  // transparent instead and the portal's own starfield shows through.
  handle = setupCanvas(canvas, { alpha: true });
  const { ctx } = handle;

  let cfg = levelConfig(level);
  let field = buildLevel(cfg);
  let program = [];
  let turn = 0;
  let running = false;
  let finished = false;
  let t = 0;
  const particles = [];

  // What the rover is doing right now, in cell coordinates plus a display
  // position that the animation interpolates between them.
  const rover = { x: 0, y: 0, dir: 0, px: 0, py: 0, angle: 0 };
  let collected = new Set();
  let queue = [];
  let action = null;

  // --- console ------------------------------------------------------------

  function keyButton(cmd) {
    const btn = document.createElement('button');
    btn.className = `rov-key rov-key--${cmd.toLowerCase()}`;
    btn.dataset.cmd = cmd;
    btn.setAttribute('aria-label', CMDS[cmd].label);
    btn.textContent = CMDS[cmd].glyph;
    return btn;
  }

  const runBtn = document.createElement('button');
  runBtn.className = 'rov-key rov-key--go';
  runBtn.setAttribute('aria-label', 'Voer het programma uit');
  runBtn.textContent = '▶';

  const undoBtn = document.createElement('button');
  undoBtn.className = 'rov-key rov-key--undo';
  undoBtn.setAttribute('aria-label', 'Laatste opdracht weghalen');
  undoBtn.textContent = '⌫';

  function buildKeys() {
    const cmds = cfg.repeat ? ['F', 'L', 'R', 'X'] : ['F', 'L', 'R'];
    const sep = document.createElement('div');
    sep.className = 'rov-sep';
    keys.replaceChildren(...cmds.map(keyButton), sep, undoBtn, runBtn);
  }

  function renderProgram() {
    if (!program.length) {
      const empty = document.createElement('div');
      empty.className = 'rov-empty';
      empty.textContent = players > 1
        ? 'Om de beurt één opdracht — dan samen op ▶'
        : 'Zet opdrachten klaar en druk op ▶';
      strip.replaceChildren(empty);
      return;
    }
    strip.replaceChildren(...program.map((cmd, i) => {
      const chip = document.createElement('button');
      chip.className = `rov-chip${i === (action ? runIndex : -1) ? ' is-active' : ''}`;
      chip.dataset.index = String(i);
      chip.setAttribute('aria-label', `${CMDS[cmd].label} weghalen`);
      chip.textContent = CMDS[cmd].glyph;
      return chip;
    }));
  }

  let runIndex = -1;

  function highlightStep(index) {
    [...strip.children].forEach((chip, i) => chip.classList.toggle('is-active', i === index));
  }

  function setTurnLabel() {
    if (players > 1 && !running) hud.setTurn(turn);
  }

  function addCommand(cmd) {
    if (running || finished) return;
    if (program.length >= MAX_PROGRAM) {
      sfx.deny();
      hud.banner('Het programma is vol', { ms: 1100, hint: true });
      return;
    }
    program.push(cmd);
    sfx.blip();
    if (players > 1) {
      turn = 1 - turn;
      setTurnLabel();
    }
    renderProgram();
  }

  const onKeys = (e) => {
    const btn = e.target.closest('button');
    if (!btn) return;
    if (btn === runBtn) {
      running ? stopRun(true) : startRun();
      return;
    }
    if (btn === undoBtn) {
      if (running || !program.length) return;
      program.pop();
      sfx.back();
      renderProgram();
      return;
    }
    if (btn.dataset.cmd) addCommand(btn.dataset.cmd);
  };

  const onStrip = (e) => {
    const chip = e.target.closest('.rov-chip');
    if (!chip || running) return;
    program.splice(Number(chip.dataset.index), 1);
    sfx.back();
    renderProgram();
  };

  keys.addEventListener('pointerup', onKeys);
  strip.addEventListener('pointerup', onStrip);

  // --- running ------------------------------------------------------------

  // "×2" means: do the instruction before it once more. Expanding it up front
  // keeps the runner a plain list walker, and it means a child can see exactly
  // how many steps their program is worth.
  function expand(list) {
    const out = [];
    for (const cmd of list) {
      if (cmd === 'X') {
        if (out.length) out.push(out[out.length - 1]);
      } else {
        out.push(cmd);
      }
    }
    return out;
  }

  function resetRover() {
    rover.x = field.start.x;
    rover.y = field.start.y;
    rover.dir = field.dir;
    rover.px = rover.x;
    rover.py = rover.y;
    rover.angle = rover.dir * (Math.PI / 2);
    collected = new Set();
    action = null;
    queue = [];
    runIndex = -1;
  }

  function startRun() {
    if (!program.length) {
      sfx.deny();
      hud.banner('Zet eerst een opdracht klaar', { ms: 1300, hint: true });
      return;
    }
    resetRover();
    // Each expanded step remembers which chip it came from, so the strip can
    // point at the instruction being carried out right now.
    const flat = [];
    for (let i = 0; i < program.length; i++) {
      const cmd = program[i];
      if (cmd === 'X') {
        const prev = flat[flat.length - 1];
        if (prev) flat.push({ cmd: prev.cmd, chip: i });
      } else {
        flat.push({ cmd, chip: i });
      }
    }
    queue = flat;
    running = true;
    runBtn.classList.add('is-running');
    runBtn.textContent = '⏹';
    sfx.launch();
    nextAction();
  }

  function stopRun(byHand = false) {
    running = false;
    runBtn.classList.remove('is-running');
    runBtn.textContent = '▶';
    action = null;
    queue = [];
    highlightStep(-1);
    if (byHand) {
      resetRover();
      sfx.back();
    }
  }

  function nextAction() {
    if (!queue.length) {
      finishRun();
      return;
    }
    const step = queue.shift();
    runIndex = step.chip;
    highlightStep(runIndex);

    if (step.cmd === 'F') {
      const d = DIRS[rover.dir];
      const nx = rover.x + d.dx;
      const ny = rover.y + d.dy;
      const blocked = nx < 0 || ny < 0 || nx >= field.size || ny >= field.size
        || field.rocks.some((r) => r.x === nx && r.y === ny);
      if (blocked) {
        action = { type: 'bump', t: 0, dur: 0.34, dx: d.dx, dy: d.dy };
        sfx.impact();
      } else {
        action = { type: 'move', t: 0, dur: 0.42, fromX: rover.x, fromY: rover.y, toX: nx, toY: ny };
        rover.x = nx;
        rover.y = ny;
        sfx.thruster();
      }
    } else {
      const delta = step.cmd === 'L' ? -1 : 1;
      const from = rover.angle;
      rover.dir = (rover.dir + delta + 4) % 4;
      action = { type: 'turn', t: 0, dur: 0.3, from, to: from + delta * (Math.PI / 2) };
      sfx.blip();
    }
  }

  function pickUpHere() {
    const hit = field.crystals.findIndex((c, i) => c.x === rover.x && c.y === rover.y && !collected.has(i));
    if (hit === -1) return;
    collected.add(hit);
    const p = cellCenter(rover.x, rover.y);
    particles.push(...createBurst(p.x, p.y, ['#b98cff', '#ffffff', '#8fd6ff'], { count: 20, speed: 300 }));
    sfx.powerup();
  }

  function finishRun() {
    running = false;
    runBtn.classList.remove('is-running');
    runBtn.textContent = '▶';
    highlightStep(-1);

    if (collected.size === field.crystals.length) {
      finishLevel();
      return;
    }
    // Not there yet: the field resets but the program stays, because the plan
    // is the thing worth keeping — it only needs a change, not a rebuild.
    hud.banner('Bijna! Pas je programma aan', { ms: 1600, hint: true });
    later(() => {
      if (!finished) resetRover();
    }, 700);
  }

  function finishLevel() {
    finished = true;
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
      title: 'Alle kristallen aan boord! 🤖',
      onNext: () => { reward = null; startLevel(); },
      onRetry: () => { reward = null; level = cleared; startLevel(); },
      onHome: onExit,
    });
  }

  function startLevel() {
    finished = false;
    cfg = levelConfig(level);
    field = buildLevel(cfg);
    program = [];
    turn = 0;
    hud.setLevel(level);
    stopRun(false);
    resetRover();
    buildKeys();
    renderProgram();
    setTurnLabel();
  }

  // --- geometry -----------------------------------------------------------

  // The board is a square of the logical canvas's short side, so it stays the
  // same size whatever the grid does — only the cells get smaller.
  function cellSize() {
    return 900 / field.size;
  }

  function boardOrigin() {
    const s = cellSize() * field.size;
    return { x: (LOGICAL_WIDTH - s) / 2, y: (LOGICAL_HEIGHT - s) / 2, s };
  }

  function cellCenter(cx, cy) {
    const o = boardOrigin();
    const c = cellSize();
    return { x: o.x + (cx + 0.5) * c, y: o.y + (cy + 0.5) * c };
  }

  // --- loop ---------------------------------------------------------------

  function update(dt) {
    t += dt;
    if (!action) return;

    action.t += dt;
    const k = Math.min(1, action.t / action.dur);
    // Ease-in-out: a rover that starts and stops abruptly looks like a glitch,
    // and the pause between steps is what makes the program readable.
    const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;

    if (action.type === 'move') {
      rover.px = action.fromX + (action.toX - action.fromX) * e;
      rover.py = action.fromY + (action.toY - action.fromY) * e;
    } else if (action.type === 'turn') {
      rover.angle = action.from + (action.to - action.from) * e;
    } else {
      const nudge = Math.sin(k * Math.PI) * 0.22;
      rover.px = rover.x + action.dx * nudge;
      rover.py = rover.y + action.dy * nudge;
    }

    if (k >= 1) {
      if (action.type === 'move') {
        rover.px = rover.x;
        rover.py = rover.y;
        pickUpHere();
      } else if (action.type === 'turn') {
        rover.angle = rover.dir * (Math.PI / 2);
      } else {
        rover.px = rover.x;
        rover.py = rover.y;
      }
      action = null;
      // A beat between instructions: without it the steps run together and a
      // child can no longer match what they see to what they queued.
      if (running) later(() => { if (running) nextAction(); }, 90);
    }
  }

  function drawBoard() {
    const o = boardOrigin();
    const c = cellSize();

    ctx.save();
    ctx.strokeStyle = 'rgba(232,217,176,0.16)';
    ctx.lineWidth = 3;
    for (let y = 0; y < field.size; y++) {
      for (let x = 0; x < field.size; x++) {
        roundRect(ctx, o.x + x * c + 5, o.y + y * c + 5, c - 10, c - 10, 18);
        ctx.fillStyle = (x + y) % 2 === 0 ? 'rgba(255,255,255,0.035)' : 'rgba(255,255,255,0.015)';
        ctx.fill();
        ctx.stroke();
      }
    }
    ctx.restore();

    // Start pad, so it is obvious where ⏹ will put the rover back.
    const s = cellCenter(field.start.x, field.start.y);
    ctx.save();
    ctx.strokeStyle = 'rgba(255,194,74,0.4)';
    ctx.lineWidth = 5;
    ctx.setLineDash([14, 14]);
    ctx.beginPath();
    ctx.arc(s.x, s.y, c * 0.32, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    for (const r of field.rocks) {
      const p = cellCenter(r.x, r.y);
      ctx.fillStyle = '#3b3a52';
      roundRect(ctx, p.x - c * 0.35, p.y - c * 0.35, c * 0.7, c * 0.7, 20);
      ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.3)';
      for (const [dx, dy, rr] of [[-0.1, -0.08, 0.09], [0.12, 0.06, 0.07]]) {
        ctx.beginPath();
        ctx.arc(p.x + dx * c, p.y + dy * c, rr * c, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    field.crystals.forEach((cr, i) => {
      if (collected.has(i)) return;
      const p = cellCenter(cr.x, cr.y);
      const bob = Math.sin(t * 2.2 + i) * c * 0.04;
      drawGlow(ctx, '#b98cff', p.x, p.y + bob, c * 0.42, 0.9);
      drawStar(ctx, p.x, p.y + bob, c * 0.24, '#d9bcff', 4);
    });
  }

  function drawRover() {
    const c = cellSize();
    const o = boardOrigin();
    const x = o.x + (rover.px + 0.5) * c;
    const y = o.y + (rover.py + 0.5) * c;
    const size = c * 0.62;

    drawGlow(ctx, '#ffc24a', x, y, size * 0.9, 0.45);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rover.angle);

    // Wheels first, so the body sits on top of them.
    ctx.fillStyle = '#2a2a3d';
    for (const side of [-1, 1]) {
      roundRect(ctx, side * size * 0.42 - size * 0.11, -size * 0.42, size * 0.22, size * 0.84, size * 0.1);
      ctx.fill();
    }

    ctx.fillStyle = '#d8d2c2';
    roundRect(ctx, -size * 0.36, -size * 0.4, size * 0.72, size * 0.8, size * 0.18);
    ctx.fill();

    // Windscreen points the way it is facing; the amber lamp is the nose.
    ctx.fillStyle = '#4b7fd6';
    roundRect(ctx, -size * 0.22, -size * 0.3, size * 0.44, size * 0.3, size * 0.1);
    ctx.fill();

    ctx.fillStyle = '#ffc24a';
    ctx.beginPath();
    ctx.arc(0, -size * 0.44, size * 0.1, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function draw(dt) {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
    drawBoard();
    drawRover();
    updateAndDrawParticles(ctx, particles, dt, { gravity: -40 });
  }

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

  listeners.push(() => {
    keys.removeEventListener('pointerup', onKeys);
    strip.removeEventListener('pointerup', onStrip);
  });
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
