/** Local UI sound effects. */

let soundEffectsEnabled = true;

export function setSoundEffectsEnabled(enabled: boolean): void {
  soundEffectsEnabled = enabled;
}

export function getSoundEffectsEnabled(): boolean {
  return soundEffectsEnabled;
}

let shutterAudio: HTMLAudioElement | null = null;

function playAudio(el: HTMLAudioElement): void {
  el.currentTime = 0;
  void el.play().catch(() => {
    /* ignore autoplay / decode errors */
  });
}

function getShutterAudio(): HTMLAudioElement {
  if (!shutterAudio) {
    shutterAudio = new Audio(`${import.meta.env.BASE_URL}sounds/camera-shutter.oga`);
    shutterAudio.preload = "auto";
  }
  return shutterAudio;
}

export function playShutterSound(): void {
  if (!soundEffectsEnabled) return;
  try {
    playAudio(getShutterAudio());
  } catch {
    /* ignore */
  }
}

function getAudioContext(): AudioContext | null {
  const Ctx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return null;
  return new Ctx();
}

/** Soft “dive in” (ascend + sub-boom) / muted exit breath — low & warm, no sharp beeps. */
export function playFocusModeSound(active: boolean): void {
  if (!soundEffectsEnabled) return;
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const master = ctx.createGain();
    master.gain.value = 0.85;
    master.connect(ctx.destination);

    if (active) {
      // Soft rising glass-like sine (low-mid, never piercing)
      const rise = ctx.createOscillator();
      rise.type = "sine";
      rise.frequency.setValueAtTime(165, now);
      rise.frequency.exponentialRampToValueAtTime(290, now + 0.42);
      const riseGain = ctx.createGain();
      riseGain.gain.setValueAtTime(0.0001, now);
      riseGain.gain.exponentialRampToValueAtTime(0.11, now + 0.12);
      riseGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.55);
      rise.connect(riseGain);
      riseGain.connect(master);
      rise.start(now);
      rise.stop(now + 0.58);

      // Deep sub-boom / water plunge (warm low)
      const boom = ctx.createOscillator();
      boom.type = "sine";
      boom.frequency.setValueAtTime(72, now + 0.18);
      boom.frequency.exponentialRampToValueAtTime(38, now + 0.72);
      const boomGain = ctx.createGain();
      boomGain.gain.setValueAtTime(0.0001, now + 0.18);
      boomGain.gain.exponentialRampToValueAtTime(0.22, now + 0.28);
      boomGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.85);
      boom.connect(boomGain);
      boomGain.connect(master);
      boom.start(now + 0.18);
      boom.stop(now + 0.9);

      // Brief low resonance tail
      const tail = ctx.createOscillator();
      tail.type = "triangle";
      tail.frequency.setValueAtTime(48, now + 0.35);
      const tailFilter = ctx.createBiquadFilter();
      tailFilter.type = "lowpass";
      tailFilter.frequency.value = 180;
      const tailGain = ctx.createGain();
      tailGain.gain.setValueAtTime(0.0001, now + 0.35);
      tailGain.gain.exponentialRampToValueAtTime(0.05, now + 0.45);
      tailGain.gain.exponentialRampToValueAtTime(0.0001, now + 1.05);
      tail.connect(tailFilter);
      tailFilter.connect(tailGain);
      tailGain.connect(master);
      tail.start(now + 0.35);
      tail.stop(now + 1.1);

      window.setTimeout(() => void ctx.close(), 1300);
      return;
    }

    // Exit: soft descending breath / air — very quiet
    const duration = 0.28;
    const buffer = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * duration), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      const t = i / data.length;
      data[i] = (Math.random() * 2 - 1) * (1 - t) * (1 - t);
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(420, now);
    filter.frequency.exponentialRampToValueAtTime(90, now + duration);
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.0001, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.045, now + 0.04);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    noise.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(master);
    noise.start(now);
    noise.stop(now + duration);

    const tone = ctx.createOscillator();
    tone.type = "sine";
    tone.frequency.setValueAtTime(210, now);
    tone.frequency.exponentialRampToValueAtTime(95, now + 0.22);
    const toneGain = ctx.createGain();
    toneGain.gain.setValueAtTime(0.0001, now);
    toneGain.gain.exponentialRampToValueAtTime(0.035, now + 0.03);
    toneGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.26);
    tone.connect(toneGain);
    toneGain.connect(master);
    tone.start(now);
    tone.stop(now + 0.28);

    window.setTimeout(() => void ctx.close(), 500);
  } catch {
    /* ignore */
  }
}

/** Soft record arm / disarm — short, distinct from Focus Mode. */
export function playRecSound(active: boolean): void {
  if (!soundEffectsEnabled) return;
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    const now = ctx.currentTime;
    const master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(ctx.destination);

    if (active) {
      // Two soft mid pulses (arming), slightly rising
      for (const [i, freq] of [
        [0, 380],
        [0.09, 520],
      ] as const) {
        const osc = ctx.createOscillator();
        osc.type = "sine";
        osc.frequency.value = freq;
        const g = ctx.createGain();
        const t0 = now + i;
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(0.12, t0 + 0.018);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.09);
        osc.connect(g);
        g.connect(master);
        osc.start(t0);
        osc.stop(t0 + 0.1);
      }
      window.setTimeout(() => void ctx.close(), 350);
      return;
    }

    // Stop: single soft descending confirm
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(440, now);
    osc.frequency.exponentialRampToValueAtTime(220, now + 0.16);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.1, now + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.2);
    osc.connect(g);
    g.connect(master);
    osc.start(now);
    osc.stop(now + 0.22);

    window.setTimeout(() => void ctx.close(), 400);
  } catch {
    /* ignore */
  }
}
