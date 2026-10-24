/** Simple Web Speech API helper — reads captions aloud one at a time. */

const STORAGE_KEY = 'cmg-voice-on';

export function isVoiceOn(): boolean {
  const v = localStorage.getItem(STORAGE_KEY);
  // Default ON when nothing stored yet
  if (v === null) return true;
  return v === '1';
}

export function setVoiceOn(on: boolean): void {
  localStorage.setItem(STORAGE_KEY, on ? '1' : '0');
  if (!on) stopSpeaking();
}

export function stopSpeaking(): void {
  if (typeof window === 'undefined' || !window.speechSynthesis) return;
  window.speechSynthesis.cancel();
}

function pickVoice(): SpeechSynthesisVoice | null {
  if (!window.speechSynthesis) return null;
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return null;

  const english = voices.filter((v) => /^en(-|_|$)/i.test(v.lang));
  const pool = english.length ? english : voices;

  // Prefer natural-sounding names when the browser exposes them
  const preferred = [
    /samantha/i,
    /neural/i,
    /enhanced/i,
    /natural/i,
    /google.*us/i,
    /google.*uk/i,
    /microsoft.*(aria|jenny|guy|sonia)/i,
    /karen/i,
    /moira/i,
    /daniel/i,
    /alex/i,
  ];
  for (const re of preferred) {
    const hit = pool.find((v) => re.test(v.name));
    if (hit) return hit;
  }

  // Prefer local (usually higher quality) English voices
  const local = pool.find((v) => v.localService);
  return local ?? pool[0] ?? null;
}

function speakOne(text: string, voice: SpeechSynthesisVoice | null): Promise<void> {
  return new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(text);
    if (voice) u.voice = voice;
    u.rate = 0.97;
    u.pitch = 1;
    u.volume = 1;
    u.onend = () => resolve();
    u.onerror = () => resolve();
    window.speechSynthesis.speak(u);
  });
}

let speakToken = 0;

/**
 * Speak each non-empty caption in order. Cancels any previous queue.
 * Safe to call when voice is off (no-op).
 */
export async function speakCaptions(texts: string[]): Promise<void> {
  if (!isVoiceOn()) return;
  if (typeof window === 'undefined' || !window.speechSynthesis) return;

  const clean = texts.map((t) => t.trim()).filter(Boolean);
  if (!clean.length) return;

  const myToken = ++speakToken;
  stopSpeaking();

  // Some browsers load voices asynchronously
  if (!window.speechSynthesis.getVoices().length) {
    await new Promise<void>((resolve) => {
      const done = () => {
        window.speechSynthesis.removeEventListener('voiceschanged', done);
        resolve();
      };
      window.speechSynthesis.addEventListener('voiceschanged', done);
      // Fallback in case the event never fires
      setTimeout(done, 400);
    });
  }

  const voice = pickVoice();

  for (const text of clean) {
    if (myToken !== speakToken || !isVoiceOn()) return;
    await speakOne(text, voice);
    // Tiny gap between captions so they don't run together
    if (myToken !== speakToken) return;
    await new Promise((r) => setTimeout(r, 280));
  }
}

/** Call once after a user tap so mobile browsers allow speech later. */
export function unlockSpeech(): void {
  if (typeof window === 'undefined' || !window.speechSynthesis) return;
  try {
    // Empty utterance "warms up" the audio session after a user gesture
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0;
    window.speechSynthesis.speak(u);
    window.speechSynthesis.cancel();
  } catch {
    // ignore
  }
}
