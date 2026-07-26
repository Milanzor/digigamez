// Lightweight procedural sound-effect engine using the Web Audio API.
// No external audio files needed: every effect is a short synthesized blip,
// which keeps the asset budget tiny and avoids licensing/asset-sourcing work.

let ctx = null;
let muted = false;

function getCtx() {
  if (!ctx) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    ctx = new AudioCtx();
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

export function unlockAudio() {
  getCtx();
}

export function setMuted(value) {
  muted = value;
}

export function isMuted() {
  return muted;
}

function tone({ freq = 440, duration = 0.15, type = 'sine', gain = 0.2, sweepTo = null, delay = 0 }) {
  if (muted) return;
  const c = getCtx();
  const osc = c.createOscillator();
  const gainNode = c.createGain();
  osc.type = type;
  const t0 = c.currentTime + delay;
  osc.frequency.setValueAtTime(freq, t0);
  if (sweepTo) osc.frequency.exponentialRampToValueAtTime(sweepTo, t0 + duration);
  gainNode.gain.setValueAtTime(gain, t0);
  gainNode.gain.exponentialRampToValueAtTime(0.001, t0 + duration);
  osc.connect(gainNode).connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + duration + 0.02);
}

export const sfx = {
  tap: () => tone({ freq: 520, duration: 0.08, type: 'triangle', gain: 0.15 }),
  success: () => {
    tone({ freq: 523, duration: 0.12, type: 'sine', gain: 0.2 });
    tone({ freq: 659, duration: 0.12, type: 'sine', gain: 0.2, delay: 0.1 });
    tone({ freq: 784, duration: 0.2, type: 'sine', gain: 0.22, delay: 0.2 });
  },
  fail: () => tone({ freq: 220, duration: 0.3, type: 'sawtooth', gain: 0.12, sweepTo: 110 }),
  pop: () => tone({ freq: 900, duration: 0.09, type: 'square', gain: 0.1, sweepTo: 400 }),
  swoosh: () => tone({ freq: 300, duration: 0.25, type: 'sine', gain: 0.12, sweepTo: 900 }),
  shoot: () => tone({ freq: 700, duration: 0.1, type: 'square', gain: 0.1, sweepTo: 200 }),
  hit: () => tone({ freq: 150, duration: 0.15, type: 'sawtooth', gain: 0.18, sweepTo: 60 }),
  celebrate: () => {
    [523, 587, 659, 784, 880].forEach((f, i) =>
      tone({ freq: f, duration: 0.18, type: 'sine', gain: 0.22, delay: i * 0.09 })
    );
  },
  click: () => tone({ freq: 440, duration: 0.06, type: 'triangle', gain: 0.12 }),
};
