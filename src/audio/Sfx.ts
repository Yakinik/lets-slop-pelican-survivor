export type SfxName =
  | 'punch' | 'rocket' | 'boom' | 'zap' | 'bell' | 'lob' | 'splash' | 'pop' | 'gem'
  | 'levelup' | 'fusion' | 'hurt' | 'shoot' | 'dash' | 'warning' | 'select' | 'victory' | 'gameover' | 'whoosh';

/** 同じ音を連打しすぎないための最短間隔（秒） */
const MIN_GAP: Partial<Record<SfxName, number>> = {
  pop: 0.035, gem: 0.03, shoot: 0.06, punch: 0.05, splash: 0.06, boom: 0.05, zap: 0.08, hurt: 0.1, dash: 0.15,
};

/** 音声ファイルを使わず WebAudio で合成する効果音 */
export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private last = new Map<SfxName, number>();
  private gemCombo = 0;
  private gemComboT = 0;
  private _volume = 0.6;
  private _muted = false;

  constructor() {
    try {
      const v = localStorage.getItem('pelican.volume');
      if (v !== null) this._volume = Math.min(1, Math.max(0, Number(v)));
      this._muted = localStorage.getItem('pelican.muted') === '1';
    } catch {
      // 保存領域が使えなくても既定値で動かす
    }
  }

  get volume(): number {
    return this._volume;
  }

  get muted(): boolean {
    return this._muted;
  }

  setVolume(v: number): void {
    this._volume = v;
    this.applyGain();
    try {
      localStorage.setItem('pelican.volume', String(v));
    } catch {
      // 保存できなくても再生には影響しない
    }
  }

  setMuted(m: boolean): void {
    this._muted = m;
    this.applyGain();
    try {
      localStorage.setItem('pelican.muted', m ? '1' : '0');
    } catch {
      // 同上
    }
  }

  private applyGain(): void {
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(this._muted ? 0 : this._volume * 0.55, this.ctx.currentTime, 0.02);
  }

  /** ユーザー操作の中で呼ぶ（ブラウザの自動再生制限のため） */
  unlock(): void {
    if (!this.ctx) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 4;
      this.master = this.ctx.createGain();
      this.master.connect(comp).connect(this.ctx.destination);
      this.applyGain();
      const len = this.ctx.sampleRate;
      this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  private tone(freq: number, dur: number, type: OscillatorType, vol: number, slideTo?: number, attack = 0.004, delay = 0): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master!);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private noise(dur: number, vol: number, freq: number, type: BiquadFilterType, slideTo?: number, delay = 0, q = 1): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + delay;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(freq, t);
    if (slideTo) f.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master!);
    src.start(t, Math.random() * 0.5);
    src.stop(t + dur + 0.05);
  }

  play(name: SfxName): void {
    if (!this.ctx || !this.master || this._muted) return;
    const now = this.ctx.currentTime;
    const gap = MIN_GAP[name];
    if (gap && now - (this.last.get(name) ?? -1) < gap) return;
    this.last.set(name, now);
    switch (name) {
      case 'punch':
        this.noise(0.08, 0.35, 1400, 'lowpass', 300);
        this.tone(150, 0.12, 'sine', 0.5, 55);
        break;
      case 'rocket':
        this.noise(0.35, 0.18, 700, 'bandpass', 2600, 0, 2);
        break;
      case 'boom':
        this.noise(0.5, 0.45, 1000, 'lowpass', 90);
        this.tone(90, 0.4, 'sine', 0.5, 30);
        break;
      case 'zap':
        this.tone(1100, 0.2, 'sawtooth', 0.12, 180);
        this.tone(2200, 0.1, 'square', 0.05, 500);
        this.noise(0.15, 0.12, 4000, 'highpass');
        break;
      case 'bell':
        // 自転車のベル「チリン」
        for (const [d, v] of [[0, 0.22], [0.09, 0.16]] as const) {
          this.tone(2093, 0.9, 'sine', v, undefined, 0.002, d);
          this.tone(2093 * 2.76, 0.5, 'sine', v * 0.35, undefined, 0.002, d);
          this.tone(2093 * 5.4, 0.25, 'sine', v * 0.15, undefined, 0.002, d);
        }
        break;
      case 'lob':
        this.tone(280, 0.18, 'sine', 0.18, 620);
        break;
      case 'splash':
        this.noise(0.35, 0.3, 2400, 'bandpass', 700, 0, 0.8);
        this.tone(420, 0.1, 'sine', 0.1, 900);
        break;
      case 'pop':
        this.tone(520 + Math.random() * 160, 0.07, 'triangle', 0.12, 980);
        break;
      case 'gem': {
        if (now - this.gemComboT > 0.6) this.gemCombo = 0;
        this.gemComboT = now;
        const step = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24][Math.min(10, this.gemCombo++)];
        this.tone(988 * Math.pow(2, step / 12), 0.09, 'sine', 0.12);
        break;
      }
      case 'levelup':
        [523, 659, 784, 1047, 1319].forEach((f, i) => this.tone(f, 0.28, 'triangle', 0.18, undefined, 0.005, i * 0.07));
        break;
      case 'fusion':
        [392, 494, 587, 740, 988, 1175].forEach((f, i) => {
          this.tone(f, 1.4, 'sine', 0.12, undefined, 0.05, i * 0.06);
          this.tone(f * 2, 0.8, 'triangle', 0.04, undefined, 0.05, i * 0.06 + 0.02);
        });
        this.noise(1.2, 0.08, 6000, 'highpass');
        break;
      case 'hurt':
        this.tone(240, 0.18, 'square', 0.16, 90);
        this.noise(0.12, 0.2, 900, 'lowpass');
        break;
      case 'shoot':
        this.tone(640, 0.06, 'sine', 0.05, 380);
        break;
      case 'dash':
        this.noise(0.35, 0.2, 400, 'bandpass', 2400, 0, 1.5);
        break;
      case 'warning':
        for (let i = 0; i < 4; i++) this.tone(i % 2 ? 330 : 440, 0.22, 'square', 0.12, undefined, 0.01, i * 0.25);
        break;
      case 'select':
        this.tone(740, 0.06, 'triangle', 0.14, 990);
        break;
      case 'victory':
        [523, 659, 784, 1047, 784, 1047, 1319, 1568].forEach((f, i) => this.tone(f, 0.35, 'triangle', 0.18, undefined, 0.005, i * 0.12));
        break;
      case 'gameover':
        [392, 349, 311, 262].forEach((f, i) => this.tone(f, 0.5, 'triangle', 0.18, undefined, 0.01, i * 0.22));
        break;
      case 'whoosh':
        this.noise(1.2, 0.18, 300, 'bandpass', 1800, 0, 0.7);
        break;
    }
  }

  /**
   * 詩を表示している間に流す柔らかなパッド和音（Fmaj9）と風の音。
   * 戻り値の関数を呼ぶとフェードアウトする。
   */
  pad(): () => void {
    if (!this.ctx || !this.master || this._muted) return () => {};
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const out = ctx.createGain();
    out.gain.setValueAtTime(0.0001, t);
    out.gain.exponentialRampToValueAtTime(0.22, t + 2.2);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(500, t);
    lp.frequency.linearRampToValueAtTime(1600, t + 6);
    lp.connect(out).connect(this.master);
    const nodes: AudioScheduledSourceNode[] = [];
    for (const f of [174.6, 220, 261.6, 329.6, 392, 523.3]) {
      for (const det of [-6, 6]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = f;
        o.detune.value = det;
        const g = ctx.createGain();
        g.gain.value = 0.05;
        o.connect(g).connect(lp);
        o.start(t);
        nodes.push(o);
      }
    }
    const wind = ctx.createBufferSource();
    wind.buffer = this.noiseBuf;
    wind.loop = true;
    const wf = ctx.createBiquadFilter();
    wf.type = 'bandpass';
    wf.frequency.value = 700;
    wf.Q.value = 0.6;
    const wg = ctx.createGain();
    wg.gain.value = 0.12;
    wind.connect(wf).connect(wg).connect(out);
    wind.start(t);
    nodes.push(wind);
    let stopped = false;
    return () => {
      if (stopped) return;
      stopped = true;
      const now = ctx.currentTime;
      out.gain.cancelScheduledValues(now);
      out.gain.setValueAtTime(Math.max(0.0001, out.gain.value), now);
      out.gain.exponentialRampToValueAtTime(0.0001, now + 2.5);
      for (const n of nodes) n.stop(now + 2.6);
    };
  }
}
