/* ==========================================================================
   3D LABYRINTH - WEB AUDIO SYNTHESIZER (no audio files: fully offline)
   Engine pattern ported from 3D Tunnel Rush v4.32.0.
   ========================================================================== */

class SoundEngine {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.lastClick = 0;
    this.musicTimer = null;
  }

  ensureContext() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) { try { this.ctx = new AC(); } catch (e) { console.warn('[Audio] unavailable:', e.message); } }
    }
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    return this.ctx;
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.muted) this.stopMusic();
    return this.muted;
  }

  ok() { return !this.muted && this.ensureContext(); }

  tone(freq, dur, { type = 'sine', vol = 0.15, at = 0, slideTo = null } = {}) {
    const c = this.ctx, t = c.currentTime + at;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(c.destination);
    o.start(t); o.stop(t + dur + 0.02);
  }

  /** Wall / ball knock, volume scales with impact speed; throttled to avoid machine-gunning. */
  playClick(speed, isBall = false) {
    if (!this.ok()) return;
    const now = this.ctx.currentTime;
    if (now - this.lastClick < 0.045) return;
    this.lastClick = now;
    const v = Math.min(0.28, 0.04 + speed * 0.03);
    this.tone(isBall ? 1400 : 380 + Math.random() * 80, 0.06, { type: 'triangle', vol: v });
  }

  playFall() {
    if (!this.ok()) return;
    this.tone(620, 0.55, { type: 'sine', vol: 0.22, slideTo: 70 });
  }

  playCapture(index) {
    if (!this.ok()) return;
    const base = [523.25, 659.25, 783.99][index % 3];
    [1, 1.25, 1.5].forEach((m, i) => this.tone(base * m, 0.22, { vol: 0.14, at: i * 0.05 }));
  }

  playLevelComplete() {
    if (!this.ok()) return;
    [523.25, 659.25, 783.99, 1046.5, 1318.5].forEach((f, i) => this.tone(f, 0.3, { type: 'triangle', vol: 0.16, at: i * 0.09 }));
  }

  playFail() {
    if (!this.ok()) return;
    [392, 330, 262].forEach((f, i) => this.tone(f, 0.35, { type: 'sawtooth', vol: 0.08, at: i * 0.18 }));
  }

  playTick(urgent) {
    if (!this.ok()) return;
    this.tone(urgent ? 1200 : 900, 0.05, { type: 'square', vol: 0.05 });
  }

  /** Calm ambient pad loop */
  startMusic() {
    if (this.musicTimer || !this.ok()) return;
    const chords = [[220, 277.18, 329.63], [196, 246.94, 293.66], [174.61, 220, 261.63], [196, 246.94, 329.63]];
    let i = 0;
    const play = () => {
      if (this.muted || !this.ctx) return;
      const ch = chords[i++ % chords.length];
      ch.forEach(f => this.tone(f, 2.6, { vol: 0.025 }));
    };
    play();
    this.musicTimer = setInterval(play, 2800);
  }

  stopMusic() {
    if (this.musicTimer) clearInterval(this.musicTimer);
    this.musicTimer = null;
  }
}

export const soundEngine = new SoundEngine();
