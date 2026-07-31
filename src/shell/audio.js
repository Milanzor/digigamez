// Procedural sound engine (Web Audio API).
//
// Everything is synthesized at runtime: oscillators for tones/arpeggios and
// a shared noise buffer for thrusters, impacts and whooshes. No audio files
// means no download cost, no licensing, and instant playback with no
// decode latency — which matters on a kiosk that may have flaky network.

import { getSetting, setSetting } from './settings.js';

// Three steps rather than a slider: a classroom either wants it quiet, normal,
// or loud enough to carry over a room full of children, and a slider is one
// more thing that can be left at 2%.
const VOLUMES = { zacht: 0.45, gewoon: 0.85, hard: 1.3 };

let ctx = null;
let master = null;
let noiseBuffer = null;
let muted = !getSetting('sound');
let volume = getSetting('volume');

function targetGain() {
  return muted ? 0 : VOLUMES[volume] ?? VOLUMES.gewoon;
}

function getCtx() {
  if (!ctx) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    ctx = new AudioCtx();

    // Master chain: gain -> soft limiter -> out. The limiter keeps stacked
    // effects (e.g. rapid laser fire) from clipping on loud digiboard speakers,
    // which is also what makes the "hard" step safe to push past unity.
    master = ctx.createGain();
    master.gain.value = targetGain();
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -8;
    limiter.knee.value = 6;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.2;
    master.connect(limiter).connect(ctx.destination);

    const len = Math.floor(ctx.sampleRate * 1.2);
    noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

export function unlockAudio() {
  getCtx();
}

export function setMuted(value) {
  muted = value;
  setSetting('sound', !value);
  if (master) master.gain.value = targetGain();
}

export function isMuted() {
  return muted;
}

export function toggleMuted() {
  setMuted(!muted);
  return muted;
}

export function setVolume(level) {
  volume = level in VOLUMES ? level : 'gewoon';
  setSetting('volume', volume);
  if (master) master.gain.value = targetGain();
}

export function getVolume() {
  return volume;
}

// --- primitives -----------------------------------------------------------

function tone({
  freq = 440, to = null, dur = 0.15, type = 'sine',
  gain = 0.2, delay = 0, detune = 0,
}) {
  if (muted) return;
  const c = getCtx();
  const t0 = c.currentTime + delay;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.detune.value = detune;
  osc.frequency.setValueAtTime(freq, t0);
  if (to) osc.frequency.exponentialRampToValueAtTime(Math.max(to, 1), t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + Math.min(0.012, dur * 0.2));
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.03);
}

function noise({
  dur = 0.3, gain = 0.2, delay = 0, type = 'lowpass',
  freq = 1200, to = null, q = 1,
}) {
  if (muted) return;
  const c = getCtx();
  const t0 = c.currentTime + delay;
  const src = c.createBufferSource();
  src.buffer = noiseBuffer;
  const filter = c.createBiquadFilter();
  filter.type = type;
  filter.Q.value = q;
  filter.frequency.setValueAtTime(freq, t0);
  if (to) filter.frequency.exponentialRampToValueAtTime(Math.max(to, 20), t0 + dur);
  const g = c.createGain();
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(filter).connect(g).connect(master);
  src.start(t0);
  src.stop(t0 + dur + 0.03);
}

function arp(freqs, { step = 0.075, dur = 0.16, type = 'triangle', gain = 0.2 } = {}) {
  freqs.forEach((f, i) => tone({ freq: f, dur, type, gain, delay: i * step }));
}

// Equal-temperament helper so melodies stay in tune.
const N = (semitonesFromA4) => 440 * Math.pow(2, semitonesFromA4 / 12);

// --- the kit --------------------------------------------------------------

export const sfx = {
  // UI
  blip: () => tone({ freq: 880, to: 1320, dur: 0.07, type: 'triangle', gain: 0.16 }),
  select: () => {
    tone({ freq: 660, dur: 0.08, type: 'triangle', gain: 0.18 });
    tone({ freq: 990, dur: 0.1, type: 'sine', gain: 0.12, delay: 0.05 });
  },
  back: () => tone({ freq: 520, to: 300, dur: 0.14, type: 'triangle', gain: 0.16 }),
  deny: () => {
    tone({ freq: 200, to: 140, dur: 0.22, type: 'sawtooth', gain: 0.12 });
    noise({ dur: 0.16, gain: 0.06, freq: 700, to: 200 });
  },

  // Rocket / space
  launch: () => {
    noise({ dur: 1.5, gain: 0.3, freq: 220, to: 90, type: 'lowpass' });
    tone({ freq: 90, to: 320, dur: 1.2, type: 'sawtooth', gain: 0.1 });
    arp([N(3), N(7), N(10), N(15)], { step: 0.11, dur: 0.28, gain: 0.16 });
  },
  thruster: () => noise({ dur: 0.22, gain: 0.1, freq: 500, to: 200, type: 'lowpass' }),
  laser: () => {
    tone({ freq: 1400, to: 260, dur: 0.11, type: 'square', gain: 0.08 });
    noise({ dur: 0.06, gain: 0.04, freq: 3000, to: 900, type: 'bandpass', q: 3 });
  },
  explode: () => {
    noise({ dur: 0.5, gain: 0.26, freq: 1600, to: 70, type: 'lowpass' });
    tone({ freq: 150, to: 45, dur: 0.42, type: 'sawtooth', gain: 0.12 });
  },
  impact: () => {
    noise({ dur: 0.14, gain: 0.16, freq: 1400, to: 300, type: 'bandpass', q: 1.5 });
    tone({ freq: 220, to: 110, dur: 0.12, type: 'square', gain: 0.1 });
  },
  bounce: () => tone({ freq: 520, to: 700, dur: 0.07, type: 'triangle', gain: 0.14 }),

  // Puzzle feedback
  dock: () => {
    tone({ freq: N(4), dur: 0.12, type: 'sine', gain: 0.2 });
    tone({ freq: N(11), dur: 0.18, type: 'sine', gain: 0.14, delay: 0.06 });
    noise({ dur: 0.08, gain: 0.05, freq: 2200, to: 800, type: 'bandpass', q: 2 });
  },
  pour: () => {
    noise({ dur: 0.45, gain: 0.11, freq: 900, to: 2400, type: 'bandpass', q: 1.2 });
    tone({ freq: 400, to: 780, dur: 0.4, type: 'sine', gain: 0.07 });
  },
  flow: () => {
    noise({ dur: 0.6, gain: 0.1, freq: 400, to: 1600, type: 'bandpass', q: 0.8 });
    arp([N(0), N(4), N(7)], { step: 0.09, dur: 0.22, gain: 0.13, type: 'sine' });
  },
  flip: () => tone({ freq: 700, to: 1000, dur: 0.08, type: 'triangle', gain: 0.13 }),
  match: () => arp([N(4), N(9), N(16)], { step: 0.08, dur: 0.2, gain: 0.18 }),

  // Rewards
  powerup: () => arp([N(0), N(5), N(9), N(12), N(17)], { step: 0.055, dur: 0.18, gain: 0.16 }),
  levelUp: () => {
    arp([N(0), N(4), N(7), N(12), N(16), N(19)], { step: 0.085, dur: 0.3, gain: 0.19 });
    noise({ dur: 0.7, gain: 0.07, freq: 600, to: 3200, type: 'bandpass', q: 1, delay: 0.1 });
  },
  missionComplete: () => {
    // Little fanfare: rising triad then an octave stab.
    arp([N(0), N(4), N(7), N(12)], { step: 0.1, dur: 0.34, gain: 0.2 });
    tone({ freq: N(12), dur: 0.5, type: 'triangle', gain: 0.18, delay: 0.42 });
    tone({ freq: N(19), dur: 0.5, type: 'sine', gain: 0.12, delay: 0.42 });
    noise({ dur: 0.9, gain: 0.06, freq: 500, to: 4000, type: 'bandpass', q: 0.9, delay: 0.4 });
  },
  star: () => tone({ freq: N(19), to: N(24), dur: 0.2, type: 'sine', gain: 0.16 }),

  // Glockenspiel note, indexed into a pentatonic scale: any combination of
  // steps sounds consonant, so a machine full of bells can't play a wrong note.
  chime: (step = 0) => {
    const freq = pent(step, 12);
    tone({ freq, dur: 0.55, type: 'sine', gain: 0.17 });
    tone({ freq: freq * 2, dur: 0.3, type: 'sine', gain: 0.05 });
    tone({ freq: freq * 3.01, dur: 0.12, type: 'sine', gain: 0.02 });
  },

  // The other three voices of the sequencer. They index the same pentatonic
  // ladder as `chime`, so whatever a child switches on plays in tune with
  // whatever the other child switched on — the loop cannot go sour.
  blub: (step = 0) => {
    const freq = pent(step, 0);
    // A short sine that bends up into its note: watery rather than melodic,
    // so it sits under the bells instead of competing with them.
    tone({ freq: freq * 0.6, to: freq, dur: 0.22, type: 'sine', gain: 0.2 });
    tone({ freq: freq * 2, dur: 0.07, type: 'sine', gain: 0.04, delay: 0.03 });
  },
  bass: (step = 0) => {
    const freq = pent(step, -24);
    tone({ freq, dur: 0.3, type: 'triangle', gain: 0.26 });
    tone({ freq: freq * 2, dur: 0.12, type: 'sine', gain: 0.06 });
  },
  // Noise drum, pitched by variant so a two-row rhythm still has a high and a
  // low. No oscillator at all, so it never has to be in any key.
  drum: (variant = 0) => {
    const low = variant % 2 === 0;
    noise({
      dur: low ? 0.18 : 0.09,
      gain: low ? 0.22 : 0.13,
      freq: low ? 900 : 6000,
      to: low ? 90 : 2600,
      type: low ? 'lowpass' : 'highpass',
    });
    if (low) tone({ freq: 110, to: 55, dur: 0.14, type: 'sine', gain: 0.14 });
  },
};

const PENTATONIC = [0, 2, 4, 7, 9, 12, 14, 16];

// Pentatonic step -> frequency, transposed by `octaveShift` semitones. Steps
// wrap, so a caller may pass any integer and still land on a scale tone.
function pent(step, shift = 0) {
  const i = ((step % PENTATONIC.length) + PENTATONIC.length) % PENTATONIC.length;
  return N(PENTATONIC[i] + shift);
}
