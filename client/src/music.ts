/**
 * Original cocktail-lounge loop, synthesized in the browser with Web Audio.
 * No recorded sample and no third-party composition — nothing to license.
 *
 * Eight swung bars in F (maj7 colors, walking bass, brushes, a sparse vibe line).
 * It sits quietly under the room and dips while caption speech is playing.
 */

const STORAGE_KEY = 'cmg-music-on';
const BPM = 90;
const QUARTER = 60 / BPM;
const LOOP_STEPS = 64; // 8 bars × 8 swung eighths
const SWING = 0.64;
const FULL_GAIN = 0.46;
const DUCK_GAIN = 0.045;

export type MusicSnapshot = {
  enabled: boolean;
  playing: boolean;
  ducked: boolean;
};

type Bar = {
  pad: number[];
  stab: number[];
  bass: number[];
};

type MelodyNote = { step: number; midi: number; len: number };

/** Close-voiced cocktail changes, one chord per bar. */
const BARS: Bar[] = [
  { pad: [57, 60, 64], stab: [65, 69, 72], bass: [41, 45, 48, 52] }, // Fmaj7
  { pad: [57, 60, 65], stab: [62, 65, 69], bass: [38, 41, 45, 50] }, // Dm7
  { pad: [58, 62, 65], stab: [67, 70, 74], bass: [43, 46, 50, 53] }, // Gm7
  { pad: [52, 58, 62], stab: [64, 67, 74], bass: [36, 40, 43, 46] }, // C9
  { pad: [55, 60, 64], stab: [69, 72, 76], bass: [45, 48, 52, 55] }, // Am7
  { pad: [53, 57, 60], stab: [62, 65, 72], bass: [38, 41, 45, 43] }, // Dm7
  { pad: [58, 62, 69], stab: [65, 69, 74], bass: [43, 46, 41, 38] }, // Gm7
  { pad: [52, 55, 58], stab: [60, 64, 67], bass: [36, 43, 46, 40] }, // C7 → F
];

/** Diatonic F-major line. Steps are swung-eighth indexes into the 8-bar loop. */
const MELODY: MelodyNote[] = [
  { step: 0, midi: 76, len: 2 },
  { step: 4, midi: 72, len: 3 },
  { step: 8, midi: 74, len: 2 },
  { step: 12, midi: 69, len: 2 },
  { step: 14, midi: 72, len: 2 },
  { step: 18, midi: 70, len: 2 },
  { step: 22, midi: 74, len: 2 },
  { step: 24, midi: 76, len: 3 },
  { step: 28, midi: 74, len: 2 },
  { step: 30, midi: 72, len: 2 },
  { step: 33, midi: 72, len: 2 },
  { step: 36, midi: 76, len: 2 },
  { step: 40, midi: 77, len: 3 },
  { step: 44, midi: 74, len: 2 },
  { step: 50, midi: 70, len: 2 },
  { step: 53, midi: 69, len: 2 },
  { step: 56, midi: 67, len: 2 },
  { step: 60, midi: 72, len: 3 },
];

const MELODY_AT: MelodyNote[][] = Array.from({ length: LOOP_STEPS }, () => []);
for (const note of MELODY) MELODY_AT[note.step].push(note);

let enabled = readEnabled();
let speechDuck = false;
let ctx: AudioContext | null = null;
let levelGain: GainNode | null = null;
let bus: GainNode | null = null;
let melodySend: GainNode | null = null;
let noiseBuffer: AudioBuffer | null = null;
let timer: number | null = null;
let nextStepTime = 0;
let stepIndex = 0;
let unavailable = false;
const listeners = new Set<(snapshot: MusicSnapshot) => void>();

function readEnabled(): boolean {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === null) return true;
    return v === '1';
  } catch {
    return true;
  }
}

function writeEnabled(on: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, on ? '1' : '0');
  } catch {
    // Private mode can block storage; the in-memory choice still applies this visit.
  }
}

function midiToHz(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

function stepDuration(step: number): number {
  const eighth = QUARTER / 2;
  const long = eighth * 2 * SWING;
  const short = eighth * 2 * (1 - SWING);
  return step % 2 === 0 ? long : short;
}

function durationFrom(step: number, eighths: number): number {
  let total = 0;
  for (let i = 0; i < eighths; i++) total += stepDuration(step + i);
  return total;
}

export function isMusicOn(): boolean {
  return enabled;
}

export function getMusicSnapshot(): MusicSnapshot {
  return {
    enabled,
    playing: timer != null && !!ctx && ctx.state === 'running' && enabled,
    ducked: speechDuck,
  };
}

export function subscribeMusic(listener: (snapshot: MusicSnapshot) => void): () => void {
  listeners.add(listener);
  listener(getMusicSnapshot());
  return () => listeners.delete(listener);
}

function emit(): void {
  const snapshot = getMusicSnapshot();
  for (const listener of listeners) listener(snapshot);
}

function targetGain(): number {
  if (!enabled) return 0;
  if (speechDuck) return DUCK_GAIN;
  return FULL_GAIN;
}

function applyLevel(): void {
  if (!ctx || !levelGain) return;
  const now = ctx.currentTime;
  const target = targetGain();
  const current = levelGain.gain.value;
  levelGain.gain.cancelScheduledValues(now);
  levelGain.gain.setValueAtTime(current, now);
  const fade = target < current ? 0.1 : 0.4;
  levelGain.gain.linearRampToValueAtTime(target, now + fade);
}

function makeNoise(context: AudioContext): AudioBuffer {
  const length = context.sampleRate * 2;
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  return buffer;
}

function createContext(): AudioContext | null {
  const Ctor =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  const context = new Ctor();
  const mix = context.createGain();
  mix.gain.value = 1;
  const melody = context.createGain();
  melody.gain.value = 1;

  const delay = context.createDelay();
  delay.delayTime.value = 0.26;
  const feedback = context.createGain();
  feedback.gain.value = 0.22;
  const wet = context.createGain();
  wet.gain.value = 0.2;
  melody.connect(mix);
  melody.connect(delay);
  delay.connect(feedback);
  feedback.connect(delay);
  delay.connect(wet);
  wet.connect(mix);

  const highpass = context.createBiquadFilter();
  highpass.type = 'highpass';
  highpass.frequency.value = 55;
  const level = context.createGain();
  level.gain.value = targetGain();
  const lowpass = context.createBiquadFilter();
  lowpass.type = 'lowpass';
  lowpass.frequency.value = 3800;
  const comp = context.createDynamicsCompressor();
  comp.threshold.value = -16;
  comp.knee.value = 16;
  comp.ratio.value = 3.2;
  comp.attack.value = 0.008;
  comp.release.value = 0.22;

  mix.connect(highpass);
  highpass.connect(level);
  level.connect(lowpass);
  lowpass.connect(comp);
  comp.connect(context.destination);

  ctx = context;
  bus = mix;
  melodySend = melody;
  levelGain = level;
  noiseBuffer = makeNoise(context);
  return context;
}

function envGain(gain: GainNode, time: number, dur: number, peak: number, attack: number): void {
  const a = Math.max(0.008, Math.min(attack, dur * 0.35));
  const end = time + Math.max(dur, a + 0.03);
  gain.gain.setValueAtTime(0.0001, time);
  gain.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), time + a);
  gain.gain.exponentialRampToValueAtTime(0.0001, end);
}

function playTone(
  time: number,
  freq: number,
  dur: number,
  peak: number,
  type: OscillatorType,
  dest: AudioNode,
  brightness: number,
  detuneCents: number,
): void {
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const twin = ctx.createOscillator();
  osc.type = type;
  twin.type = type;
  osc.frequency.setValueAtTime(freq, time);
  twin.frequency.setValueAtTime(freq, time);
  twin.detune.setValueAtTime(detuneCents, time);

  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(brightness, time);
  filter.frequency.exponentialRampToValueAtTime(Math.max(280, brightness * 0.62), time + dur);

  const gain = ctx.createGain();
  envGain(gain, time, dur, peak, type === 'sine' ? 0.02 : 0.035);
  const twinGain = ctx.createGain();
  twinGain.gain.value = 0.55;

  osc.connect(filter);
  twin.connect(twinGain);
  twinGain.connect(filter);
  filter.connect(gain);
  gain.connect(dest);

  const stopAt = time + dur + 0.06;
  osc.start(time);
  twin.start(time);
  osc.stop(stopAt);
  twin.stop(stopAt);
}

function playNoise(time: number, dur: number, peak: number, frequency: number, q: number, kind: BiquadFilterType): void {
  if (!ctx || !bus || !noiseBuffer) return;
  const source = ctx.createBufferSource();
  source.buffer = noiseBuffer;
  source.loop = true;
  const filter = ctx.createBiquadFilter();
  filter.type = kind;
  filter.frequency.setValueAtTime(frequency, time);
  filter.Q.value = q;
  const gain = ctx.createGain();
  envGain(gain, time, dur, peak, 0.008);
  source.connect(filter);
  filter.connect(gain);
  gain.connect(bus);
  source.start(time);
  source.stop(time + dur + 0.04);
}

function scheduleStep(step: number, time: number): void {
  if (!bus || !melodySend) return;
  const bar = BARS[Math.floor(step / 8) % BARS.length];
  const eighth = step % 8;

  if (eighth === 0) {
    const padDur = durationFrom(step, 8) * 0.98;
    for (const note of bar.pad) {
      playTone(time, midiToHz(note), padDur, 0.03, 'sine', bus, 900, 7);
    }
    const stabDur = durationFrom(step, 2) * 0.9;
    for (const note of bar.stab) {
      playTone(time, midiToHz(note), stabDur, 0.028, 'triangle', bus, 1600, 5);
    }
  }

  if (eighth % 2 === 0) {
    const bassNote = bar.bass[eighth / 2];
    playTone(time, midiToHz(bassNote), QUARTER * 0.88, 0.13, 'sine', bus, 420, 3);
  }

  if (eighth === 2 || eighth === 6) {
    playNoise(time, 0.16, 0.045, 1800, 0.7, 'bandpass');
  } else if (eighth % 2 === 1) {
    playNoise(time, 0.04, 0.018, 6500, 0.8, 'highpass');
  }

  for (const note of MELODY_AT[step] ?? []) {
    const dur = durationFrom(step, note.len) * 0.92;
    playTone(time, midiToHz(note.midi), dur, 0.055, 'sine', melodySend, 2800, 8);
  }
}

function tick(): void {
  if (!ctx || ctx.state !== 'running') return;
  const horizon = ctx.currentTime + 0.2;
  if (nextStepTime < ctx.currentTime - 0.08) nextStepTime = ctx.currentTime + 0.03;
  while (nextStepTime < horizon) {
    scheduleStep(stepIndex, nextStepTime);
    nextStepTime += stepDuration(stepIndex);
    stepIndex = (stepIndex + 1) % LOOP_STEPS;
  }
}

function kickScheduler(): void {
  if (!ctx || ctx.state !== 'running' || !enabled || timer != null) return;
  nextStepTime = ctx.currentTime + 0.06;
  stepIndex = 0;
  timer = window.setInterval(tick, 25);
  tick();
}

function stopScheduler(): void {
  if (timer != null) {
    window.clearInterval(timer);
    timer = null;
  }
}

function startFromGesture(): void {
  if (unavailable || !enabled) return;
  if (!ctx || ctx.state === 'closed') {
    if (!createContext()) {
      unavailable = true;
      emit();
      return;
    }
  }
  const context = ctx;
  if (!context) return;
  void context.resume();
  applyLevel();
  const go = () => {
    if (!enabled || context.state !== 'running') return;
    kickScheduler();
    emit();
  };
  if (context.state === 'running') go();
  else {
    const onState = () => {
      if (context.state === 'running') {
        context.removeEventListener('statechange', onState);
        go();
      }
    };
    context.addEventListener('statechange', onState);
  }
}

/** Call from a click, tap, or key press. Browsers ignore audio until then. */
export function unlockMusic(): void {
  if (!enabled || unavailable) return;
  try {
    startFromGesture();
  } catch {
    unavailable = true;
    emit();
  }
}

export function setMusicOn(on: boolean): void {
  enabled = on;
  writeEnabled(on);
  if (!on) {
    applyLevel();
    stopScheduler();
    window.setTimeout(() => {
      if (!enabled) void ctx?.suspend();
      emit();
    }, 160);
    emit();
    return;
  }
  try {
    startFromGesture();
  } catch {
    unavailable = true;
  }
  emit();
}

/** Dip the bed while captions are being read aloud, then swell back. */
export function duckMusic(on: boolean): void {
  speechDuck = on;
  applyLevel();
  emit();
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (!ctx) return;
    if (document.hidden) {
      stopScheduler();
      void ctx.suspend();
      emit();
      return;
    }
    if (!enabled) return;
    void ctx.resume().then(() => {
      if (enabled && ctx?.state === 'running') kickScheduler();
      emit();
    });
  });
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    stopScheduler();
    void ctx?.close();
    ctx = null;
    levelGain = null;
    bus = null;
    melodySend = null;
  });
}
