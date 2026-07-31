import './style.css';
import { createHud } from '../../shared/ui-components.js';
import { sfx } from '../../shell/audio.js';
import {
  getMaatje, saveMaatje, drawMaatjeIn,
  BODIES, EYES, ANTENNAE, ARMS, MOUTHS, SKINS, ACCENTS,
} from '../../shell/maatje.js';

// "Maak je Maatje" — build an alien and keep it.
//
// The fourth open-ended game, next to Ruimtetekenen, de Gekke Machine and het
// Sterrenorkest: no levels, no target, and it keeps its work between visits
// instead of climbing a ladder.
//
// It is also the one game whose output leaves the game. The buddy is saved
// through `shell/maatje.js`, so it turns up as the loadmaster in Ladingcontrole
// and as the pilot of the rover — which is the entire reason PLAN §6c wanted the
// format settled before this screen existed. That is also why every choice here
// is a *picture* of the choice: each part button draws the actual buddy with
// that part fitted, so a two-year-old picks a shape rather than a word, and the
// row of thumbnails is redrawn in the current colours whenever the colour
// changes so the preview never lies about what a button will do.

const THUMB = 72;

// Which lists a part row runs through, and how a thumbnail should differ from
// the buddy on the big canvas.
const ROWS = [
  { key: 'body', label: 'Lijf', list: BODIES },
  { key: 'eyes', label: 'Ogen', list: EYES },
  { key: 'antenna', label: 'Antenne', list: ANTENNAE },
  { key: 'arms', label: 'Armen', list: ARMS },
  { key: 'mouth', label: 'Mond', list: MOUTHS },
];

let hud = null;
let stage = null;
let raf = null;
let listeners = [];
let saveTimer = null;
let ro = null;
// The buddy as it stands right now, kept at module scope so `destroy` can flush
// a debounced save. Walking out of the screen a fifth of a second after the last
// tap must not lose that tap.
let current = null;

export function init(container, opts) {
  listeners = [];

  hud = createHud(container, {
    title: opts.title,
    onExit: opts.onExit,
  });

  let maatje = getMaatje();
  current = maatje;
  // Ticks while the buddy is showing off, which is the only thing on this
  // screen that is time-based at all.
  let dance = 0;

  stage = document.createElement('div');
  stage.className = 'maat-stage';

  const hint = document.createElement('div');
  hint.className = 'hint-strip maat-hint';
  hint.textContent = 'Tik om je maatje te bouwen — hij blijft bewaard';

  const preview = document.createElement('div');
  preview.className = 'maat-preview';
  const canvas = document.createElement('canvas');
  preview.appendChild(canvas);
  const ctx = canvas.getContext('2d');

  const tools = document.createElement('div');
  tools.className = 'maat-tools';

  stage.append(hint, preview, tools);
  container.appendChild(stage);

  // --- thumbnails ---------------------------------------------------------

  // A part button is a drawing of the buddy with that one part swapped, at
  // thumbnail size. It costs one paint per button and only when something
  // changes, so this is cheap — and it is the difference between a row a child
  // can use and a row of words they cannot read.
  function paintThumb(cv, row, index) {
    const g = cv.getContext('2d');
    g.clearRect(0, 0, cv.width, cv.height);
    const variant = { ...maatje, [row.key]: index };
    drawMaatjeIn(g, variant, cv.width / 2, cv.height / 2, cv.width * 0.94, cv.height * 0.94, 0);
  }

  const thumbs = [];

  function buildTools() {
    tools.replaceChildren();

    for (const row of ROWS) {
      const cluster = document.createElement('div');
      cluster.className = 'maat-cluster';
      const cap = document.createElement('div');
      cap.className = 'maat-cluster__label';
      cap.textContent = row.label;
      const body = document.createElement('div');
      body.className = 'maat-cluster__body';

      row.list.forEach((_, i) => {
        const btn = document.createElement('button');
        btn.className = 'maat-opt';
        btn.dataset.row = row.key;
        btn.dataset.index = String(i);
        btn.setAttribute('aria-label', `${row.label} ${i + 1}`);
        const cv = document.createElement('canvas');
        cv.width = THUMB * 2;
        cv.height = THUMB * 2;
        btn.appendChild(cv);
        body.appendChild(btn);
        thumbs.push({ cv, row, index: i, btn });
      });

      cluster.append(cap, body);
      tools.appendChild(cluster);
    }

    // Colours are swatches rather than thumbnails: a coloured circle already is
    // a picture of what it does, and a whole buddy drawn seven more times to
    // say "green" would be noise.
    tools.appendChild(colorCluster('Kleur', 'skin', SKINS));
    tools.appendChild(colorCluster('Stip', 'accent', ACCENTS));

    const actions = document.createElement('div');
    actions.className = 'maat-cluster maat-cluster--actions';
    actions.innerHTML = `
      <div class="maat-cluster__label">Doen</div>
      <div class="maat-cluster__body">
        <button class="maat-act" data-act="random" aria-label="Verzin een maatje">🎲</button>
        <button class="maat-act" data-act="dance" aria-label="Laat hem dansen en toeteren">🎉</button>
      </div>
    `;
    tools.appendChild(actions);

    refreshTools();
  }

  function colorCluster(label, key, list) {
    const cluster = document.createElement('div');
    cluster.className = 'maat-cluster';
    const cap = document.createElement('div');
    cap.className = 'maat-cluster__label';
    cap.textContent = label;
    const body = document.createElement('div');
    body.className = 'maat-cluster__body';
    for (const color of list) {
      const btn = document.createElement('button');
      btn.className = 'maat-swatch';
      btn.dataset.color = key;
      btn.dataset.value = color;
      btn.style.setProperty('--sw', color);
      btn.setAttribute('aria-label', `${label} ${color}`);
      body.appendChild(btn);
    }
    cluster.append(cap, body);
    return cluster;
  }

  // Repaint every thumbnail and re-mark which option is fitted. Called on any
  // change, because changing the skin colour changes all twenty-one drawings.
  function refreshTools() {
    for (const t of thumbs) {
      paintThumb(t.cv, t.row, t.index);
      t.btn.classList.toggle('is-on', maatje[t.row.key] === t.index);
    }
    tools.querySelectorAll('.maat-swatch').forEach((btn) => {
      btn.classList.toggle('is-on', maatje[btn.dataset.color] === btn.dataset.value);
    });
  }

  // --- input -------------------------------------------------------------

  const onTools = (e) => {
    const opt = e.target.closest('.maat-opt');
    if (opt) {
      maatje = { ...maatje, [opt.dataset.row]: Number(opt.dataset.index) };
      sfx.blip();
      changed();
      return;
    }
    const sw = e.target.closest('.maat-swatch');
    if (sw) {
      maatje = { ...maatje, [sw.dataset.color]: sw.dataset.value };
      sfx.blip();
      changed();
      return;
    }
    const act = e.target.closest('.maat-act');
    if (!act) return;
    if (act.dataset.act === 'random') {
      const pick = (list) => Math.floor(Math.random() * list.length);
      maatje = {
        body: pick(BODIES),
        eyes: pick(EYES),
        antenna: pick(ANTENNAE),
        arms: pick(ARMS),
        mouth: pick(MOUTHS),
        skin: SKINS[pick(SKINS)],
        accent: ACCENTS[pick(ACCENTS)],
      };
      sfx.powerup();
      changed();
      return;
    }
    // The toot. Nothing is built by it — it is here because a creature you made
    // that will wave back is a different object from a picture of a creature.
    dance = 1.6;
    sfx.launch();
    sfx.chime(Math.floor(Math.random() * 6));
  };

  function changed() {
    refreshTools();
    // Debounced like the sequencer's loop: a child dragging along a colour row
    // should not write to storage a dozen times.
    current = maatje;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveMaatje(maatje), 400);
  }

  tools.addEventListener('pointerup', onTools);
  listeners.push(() => tools.removeEventListener('pointerup', onTools));

  // --- the big buddy ------------------------------------------------------

  function resize() {
    const rect = preview.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
  }
  resize();
  ro = new ResizeObserver(resize);
  ro.observe(preview);

  buildTools();

  const t0 = performance.now();
  let last = t0;
  function loop(now) {
    const dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    const t = (now - t0) / 1000;
    if (dance > 0) dance = Math.max(0, dance - dt);

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const hop = dance > 0 ? Math.abs(Math.sin(t * 9)) * canvas.height * 0.05 : 0;
    const tilt = dance > 0 ? Math.sin(t * 7) * 0.12 : 0;

    ctx.save();
    ctx.translate(canvas.width / 2, canvas.height / 2 - hop);
    ctx.rotate(tilt);
    // The buddy's own clock keeps running while it dances, so the blink and the
    // antenna sway carry on underneath the hop. `drawMaatjeIn` does the fitting,
    // so the hop has headroom to hop into.
    drawMaatjeIn(ctx, maatje, 0, 0, canvas.width * 0.92, canvas.height * 0.86, t);
    ctx.restore();

    raf = requestAnimationFrame(loop);
  }
  raf = requestAnimationFrame(loop);
}

export function destroy() {
  if (raf) cancelAnimationFrame(raf);
  raf = null;
  clearTimeout(saveTimer);
  saveTimer = null;
  if (current) saveMaatje(current);
  current = null;
  ro?.disconnect();
  ro = null;
  listeners.forEach((off) => off());
  listeners = [];
  hud?.destroy();
  hud = null;
  stage = null;
}
