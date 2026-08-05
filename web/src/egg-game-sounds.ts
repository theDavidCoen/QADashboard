/** Pac-Man–style synth SFX for the easter-egg game (Web Audio API). */

import { getSoundEffectsEnabled } from "./feedback";

export type EggGameAudio = {
  setMuted: (muted: boolean) => void;
  isMuted: () => boolean;
  onRoundStart: () => void;
  onPellet: () => void;
  onPower: () => void;
  onEatGhost: () => void;
  onDeath: () => void;
  onWin: () => void;
  onGameOver: () => void;
  tickSiren: (opts: { playing: boolean; frightened: boolean; levelProgress: number }) => void;
  dispose: () => void;
};

function createContext(): AudioContext | null {
  const Ctx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return null;
  try {
    return new Ctx();
  } catch {
    return null;
  }
}

export function createEggGameAudio(): EggGameAudio {
  let ctx: AudioContext | null = null;
  let muted = false;
  let chompHigh = true;

  const ensureCtx = (): AudioContext | null => {
    if (!getSoundEffectsEnabled() || muted) return null;
    if (!ctx || ctx.state === "closed") {
      ctx = createContext();
    }
    if (ctx?.state === "suspended") {
      void ctx.resume();
    }
    return ctx;
  };

  const canPlay = () => getSoundEffectsEnabled() && !muted;

  const blip = (freq: number, duration: number, volume: number, type: OscillatorType = "square") => {
    const audio = ensureCtx();
    if (!audio) return;
    const now = audio.currentTime;
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(gain);
    gain.connect(audio.destination);
    osc.start(now);
    osc.stop(now + duration + 0.01);
  };

  return {
    setMuted(next) {
      muted = next;
    },
    isMuted() {
      return muted;
    },
    onRoundStart() {
      chompHigh = true;
    },
    onPellet() {
      if (!canPlay()) return;
      const freq = chompHigh ? 440 : 330;
      chompHigh = !chompHigh;
      blip(freq, 0.055, 0.07);
    },
    onPower() {
      if (!canPlay()) return;
      const audio = ensureCtx();
      if (!audio) return;
      const now = audio.currentTime;
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = "square";
      osc.frequency.setValueAtTime(110, now);
      osc.frequency.exponentialRampToValueAtTime(260, now + 0.18);
      gain.gain.setValueAtTime(0.09, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
      osc.connect(gain);
      gain.connect(audio.destination);
      osc.start(now);
      osc.stop(now + 0.24);
    },
    onEatGhost() {
      if (!canPlay()) return;
      const audio = ensureCtx();
      if (!audio) return;
      const now = audio.currentTime;
      for (const [i, freq] of [520, 680, 880].entries()) {
        const osc = audio.createOscillator();
        const gain = audio.createGain();
        osc.type = "square";
        osc.frequency.value = freq;
        const t = now + i * 0.055;
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(0.075, t + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
        osc.connect(gain);
        gain.connect(audio.destination);
        osc.start(t);
        osc.stop(t + 0.09);
      }
    },
    onDeath() {
      if (!canPlay()) return;
      const audio = ensureCtx();
      if (!audio) return;
      const now = audio.currentTime;
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(420, now);
      osc.frequency.exponentialRampToValueAtTime(55, now + 1.35);
      gain.gain.setValueAtTime(0.11, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.4);
      osc.connect(gain);
      gain.connect(audio.destination);
      osc.start(now);
      osc.stop(now + 1.45);
    },
    onWin() {
      if (!canPlay()) return;
      const audio = ensureCtx();
      if (!audio) return;
      const now = audio.currentTime;
      const notes = [392, 523, 659, 784];
      for (const [i, freq] of notes.entries()) {
        const osc = audio.createOscillator();
        const gain = audio.createGain();
        osc.type = "square";
        osc.frequency.value = freq;
        const t = now + i * 0.12;
        gain.gain.setValueAtTime(0.0001, t);
        gain.gain.exponentialRampToValueAtTime(0.08, t + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
        osc.connect(gain);
        gain.connect(audio.destination);
        osc.start(t);
        osc.stop(t + 0.2);
      }
    },
    onGameOver() {
      if (!canPlay()) return;
      blip(196, 0.35, 0.09, "sawtooth");
      window.setTimeout(() => {
        if (canPlay()) blip(98, 0.5, 0.08, "sawtooth");
      }, 280);
    },
    tickSiren() {
      /* no continuous siren */
    },
    dispose() {
      if (ctx && ctx.state !== "closed") {
        void ctx.close();
      }
      ctx = null;
    },
  };
};
