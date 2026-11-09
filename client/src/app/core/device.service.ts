import { Injectable, signal } from '@angular/core';

/** Tela ligada, som e vibração: o que o aparelho faz além de mostrar a página. */
@Injectable({ providedIn: 'root' })
export class DeviceService {
  readonly wakeLockSupported = 'wakeLock' in navigator;
  /** true enquanto o navegador está impedindo a tela de apagar. */
  readonly awake = signal(false);

  private sentinel: WakeLockSentinel | null = null;
  private wantAwake = false;
  private audio: AudioContext | null = null;

  constructor() {
    // Navegadores só tocam som depois de um gesto: qualquer toque libera o áudio.
    const unlock = () => this.unlockAudio();
    document.addEventListener('pointerdown', unlock, { passive: true });
    document.addEventListener('keydown', unlock, { passive: true });
  }

  /** Mantém a tela ligada. O navegador solta a trava ao sair da página; chame de novo ao voltar. */
  async keepAwake() {
    this.wantAwake = true;
    if (!this.wakeLockSupported || document.visibilityState !== 'visible') return;
    if (this.sentinel && !this.sentinel.released) return;
    try {
      this.sentinel = await navigator.wakeLock.request('screen');
      this.awake.set(true);
      this.sentinel.addEventListener('release', () => this.awake.set(false));
      if (!this.wantAwake) void this.sentinel.release();
    } catch {
      this.awake.set(false);
    }
  }

  allowSleep() {
    this.wantAwake = false;
    void this.sentinel?.release();
    this.sentinel = null;
  }

  private unlockAudio() {
    try {
      this.audio ??= new AudioContext();
      if (this.audio.state === 'suspended') void this.audio.resume();
    } catch {
      /* sem áudio neste navegador */
    }
  }

  /** Aviso de chegada: vibra (Android) e toca três notas, duas vezes. */
  arrivalAlert() {
    try {
      navigator.vibrate?.([400, 150, 400, 150, 800]);
    } catch {
      /* o Safari do iPhone não tem vibração */
    }
    const ctx = this.audio;
    if (!ctx || ctx.state !== 'running') return;
    const notes = [659.25, 783.99, 1046.5]; // mi, sol, dó
    for (let round = 0; round < 2; round++) {
      notes.forEach((freq, i) => {
        const at = ctx.currentTime + round * 0.9 + i * 0.18;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, at);
        gain.gain.exponentialRampToValueAtTime(0.5, at + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.5);
        osc.connect(gain).connect(ctx.destination);
        osc.start(at);
        osc.stop(at + 0.55);
      });
    }
  }
}
