/**
 * 纯代码合成的音频引擎（不依赖任何音频资源文件）。
 *
 * - 背景音乐：用调度器按 16 分音符步进，实时合成一段循环的小调进行
 *   （贝斯 + 琶音 + 鼓），所以音乐是"算出来的"，没有 mp3。
 * - 音效：打击 / 挥砍 / 升级 / 技能 / 受击等，全部由振荡器 + 噪声包络合成。
 *
 * 浏览器自动播放策略要求首次发声必须发生在用户手势之后，
 * 因此 AudioContext 惰性创建，并在第一次点击/按键时 unlock()。
 */

export type SfxName =
  | 'swing'
  | 'hit'
  | 'crit'
  | 'hurt'
  | 'kill'
  | 'boss'
  | 'levelup'
  | 'fire'
  | 'frenzy'
  | 'poison'
  | 'coin'
  | 'click'
  | 'heal'
  | 'equip'
  | 'die';

/** 一小节 16 步，4 小节一个循环 */
export const STEPS_PER_BAR = 16;
export const LOOP_STEPS = STEPS_PER_BAR * 4;
export const BPM = 88;
/** 一个 16 分音符的秒数 */
export const STEP_SEC = 60 / BPM / 4;

export type NoteKind = 'bass' | 'arp' | 'kick' | 'snare' | 'hat';

export interface NoteEvent {
  kind: NoteKind;
  /** MIDI 音高（打击乐为 0） */
  midi: number;
  /** 力度 0~1 */
  vel: number;
}

/** Am - F - C - G：根音 + 和弦音（MIDI） */
export const CHORDS: { root: number; tones: number[] }[] = [
  { root: 45, tones: [57, 60, 64] },
  { root: 41, tones: [53, 57, 60] },
  { root: 48, tones: [52, 55, 60] },
  { root: 43, tones: [50, 55, 59] },
];

/** 贝斯的切分节奏（小节内步号） */
const BASS_STEPS = [0, 6, 8, 14];

/**
 * 纯函数：给定步号返回这一拍要响的音符，便于单测且方便以后换曲子。
 */
export function stepEvents(step: number): NoteEvent[] {
  const s = ((step % LOOP_STEPS) + LOOP_STEPS) % LOOP_STEPS;
  const bar = Math.floor(s / STEPS_PER_BAR) % CHORDS.length;
  const inBar = s % STEPS_PER_BAR;
  const chord = CHORDS[bar];
  const out: NoteEvent[] = [];

  if (BASS_STEPS.includes(inBar)) {
    out.push({ kind: 'bass', midi: chord.root, vel: inBar === 0 ? 0.9 : 0.6 });
  }
  // 琶音：八分音符，走和弦音并隔小节升八度
  if (inBar % 2 === 0) {
    const i = (inBar / 2) % chord.tones.length;
    const oct = bar % 2 === 1 ? 12 : 0;
    out.push({ kind: 'arp', midi: chord.tones[i] + oct, vel: 0.34 });
  }
  if (inBar % 8 === 0) out.push({ kind: 'kick', midi: 0, vel: 0.9 });
  if (inBar % 8 === 4) out.push({ kind: 'snare', midi: 0, vel: 0.5 });
  if (inBar % 2 === 1) out.push({ kind: 'hat', midi: 0, vel: inBar % 4 === 3 ? 0.22 : 0.13 });
  return out;
}

export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

function clamp01(v: number): number {
  return Number.isFinite(v) ? (v < 0 ? 0 : v > 1 ? 1 : v) : 0;
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private noiseBuf: AudioBuffer | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private step = 0;
  private nextAt = 0;
  private musicOn = true;
  private sfxOn = true;
  private vol = 0.6;
  private bgmRunning = false;
  private createCtx: (() => AudioContext) | null;

  constructor(createCtx?: () => AudioContext) {
    this.createCtx = createCtx ?? null;
  }

  /** 测试用：注入假的 AudioContext */
  attach(ctx: AudioContext): void {
    this.ctx = ctx;
    this.buildGraph();
  }

  get musicEnabled(): boolean {
    return this.musicOn;
  }
  get sfxEnabled(): boolean {
    return this.sfxOn;
  }
  get volume(): number {
    return this.vol;
  }
  get playing(): boolean {
    return this.bgmRunning;
  }

  private buildGraph(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    this.master = ctx.createGain();
    this.master.gain.value = this.vol;
    this.master.connect(ctx.destination);

    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = 0.34;
    this.musicBus.connect(this.master);

    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = 0.9;
    this.sfxBus.connect(this.master);
  }

  private ensure(): AudioContext | null {
    if (this.ctx) return this.ctx;
    let made: AudioContext | null = null;
    if (this.createCtx) {
      try {
        made = this.createCtx();
      } catch {
        made = null;
      }
    } else if (typeof window !== 'undefined') {
      const Ctor =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext })
          .webkitAudioContext;
      if (Ctor) {
        try {
          made = new Ctor();
        } catch {
          made = null;
        }
      }
    }
    if (!made) return null;
    this.ctx = made;
    this.buildGraph();
    return this.ctx;
  }

  /**
   * 必须在用户手势里调用一次：解锁 AudioContext 并起播 BGM。
   */
  unlock(): void {
    const ctx = this.ensure();
    if (!ctx) return;
    if (ctx.state === 'suspended' && typeof ctx.resume === 'function') {
      void ctx.resume();
    }
    if (this.musicOn) this.startBgm();
  }

  setMusic(on: boolean): void {
    this.musicOn = !!on;
    if (this.musicOn) {
      if (this.ctx) this.startBgm();
    } else {
      this.stopBgm();
    }
  }

  setSfx(on: boolean): void {
    this.sfxOn = !!on;
  }

  setVolume(v: number): void {
    this.vol = clamp01(v);
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(this.vol, this.ctx.currentTime, 0.02);
    }
  }

  startBgm(): void {
    const ctx = this.ensure();
    if (!ctx || !this.musicBus || this.bgmRunning) return;
    this.bgmRunning = true;
    this.nextAt = ctx.currentTime + 0.08;
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = setInterval(() => this.tick(), 40);
  }

  stopBgm(): void {
    this.bgmRunning = false;
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** 暂停/恢复（游戏暂停时音乐也停，但保留播放进度） */
  setPaused(paused: boolean): void {
    if (!this.ctx) return;
    if (paused) {
      this.stopBgm();
    } else if (this.musicOn) {
      this.startBgm();
    }
  }

  private tick(): void {
    const ctx = this.ctx;
    if (!ctx || !this.bgmRunning) return;
    const horizon = ctx.currentTime + 0.2;
    let guard = 0;
    while (this.nextAt < horizon && guard++ < 32) {
      this.scheduleStep(stepEvents(this.step), this.nextAt);
      this.nextAt += STEP_SEC;
      this.step = (this.step + 1) % LOOP_STEPS;
    }
  }

  private scheduleStep(events: NoteEvent[], at: number): void {
    const bus = this.musicBus;
    if (!bus || !this.ctx) return;
    for (const e of events) {
      switch (e.kind) {
        case 'bass':
          this.tone({
            type: 'triangle',
            freq: midiToFreq(e.midi),
            at,
            dur: 0.24,
            peak: 0.5 * e.vel,
            bus,
          });
          break;
        case 'arp':
          this.tone({
            type: 'square',
            freq: midiToFreq(e.midi),
            at,
            dur: 0.16,
            peak: 0.16 * e.vel,
            bus,
            detune: 4,
          });
          break;
        case 'kick':
          this.tone({
            type: 'sine',
            freq: 130,
            to: 44,
            at,
            dur: 0.16,
            peak: 0.55 * e.vel,
            bus,
            attack: 0.002,
          });
          break;
        case 'snare':
          this.noise({
            at,
            dur: 0.13,
            peak: 0.28 * e.vel,
            bus,
            filter: 'highpass',
            freq: 1400,
          });
          break;
        case 'hat':
          this.noise({
            at,
            dur: 0.05,
            peak: 0.2 * e.vel,
            bus,
            filter: 'highpass',
            freq: 7000,
          });
          break;
      }
    }
  }

  // ---------------- 音效 ----------------

  play(name: SfxName): void {
    const ctx = this.ensure();
    if (!ctx || !this.sfxBus || !this.sfxOn) return;
    const bus = this.sfxBus;
    const t = ctx.currentTime + 0.001;
    switch (name) {
      case 'swing':
        this.noise({ at: t, dur: 0.13, peak: 0.3, bus, filter: 'bandpass', freq: 900, sweepTo: 3000, q: 1.4 });
        this.tone({ type: 'sine', freq: 320, to: 130, at: t, dur: 0.1, peak: 0.18, bus });
        break;
      case 'hit':
        this.tone({ type: 'sine', freq: 190, to: 55, at: t, dur: 0.16, peak: 0.5, bus, attack: 0.002 });
        this.noise({ at: t, dur: 0.09, peak: 0.3, bus, filter: 'lowpass', freq: 1400 });
        break;
      case 'crit':
        this.tone({ type: 'sine', freq: 220, to: 60, at: t, dur: 0.2, peak: 0.55, bus, attack: 0.002 });
        this.noise({ at: t, dur: 0.12, peak: 0.34, bus, filter: 'lowpass', freq: 2200 });
        this.tone({ type: 'square', freq: 1500, to: 900, at: t + 0.02, dur: 0.12, peak: 0.14, bus });
        break;
      case 'hurt':
        this.tone({ type: 'square', freq: 210, to: 90, at: t, dur: 0.22, peak: 0.26, bus });
        this.noise({ at: t, dur: 0.18, peak: 0.2, bus, filter: 'lowpass', freq: 900 });
        break;
      case 'kill':
        this.tone({ type: 'square', freq: 320, to: 70, at: t, dur: 0.22, peak: 0.3, bus });
        this.noise({ at: t, dur: 0.16, peak: 0.26, bus, filter: 'highpass', freq: 900 });
        break;
      case 'boss':
        this.tone({ type: 'sawtooth', freq: 92, at: t, dur: 0.9, peak: 0.28, bus });
        this.tone({ type: 'sawtooth', freq: 97, at: t, dur: 0.9, peak: 0.22, bus });
        break;
      case 'levelup':
        [0, 4, 7, 12].forEach((semi, i) => {
          this.tone({
            type: 'triangle',
            freq: midiToFreq(72 + semi),
            at: t + i * 0.085,
            dur: 0.22,
            peak: 0.3,
            bus,
          });
        });
        break;
      case 'fire':
        this.noise({ at: t, dur: 0.36, peak: 0.34, bus, filter: 'lowpass', freq: 2600, sweepTo: 320 });
        this.tone({ type: 'sawtooth', freq: 420, to: 120, at: t, dur: 0.28, peak: 0.14, bus });
        break;
      case 'frenzy':
        this.tone({ type: 'sawtooth', freq: 220, to: 700, at: t, dur: 0.42, peak: 0.24, bus });
        this.tone({ type: 'square', freq: 330, to: 990, at: t + 0.04, dur: 0.36, peak: 0.1, bus });
        break;
      case 'poison':
        this.tone({ type: 'triangle', freq: 165, to: 110, at: t, dur: 0.45, peak: 0.24, bus });
        this.noise({ at: t, dur: 0.5, peak: 0.12, bus, filter: 'lowpass', freq: 620 });
        break;
      case 'coin':
        this.tone({ type: 'square', freq: 988, at: t, dur: 0.07, peak: 0.16, bus });
        this.tone({ type: 'square', freq: 1319, at: t + 0.07, dur: 0.12, peak: 0.16, bus });
        break;
      case 'click':
        this.tone({ type: 'square', freq: 760, at: t, dur: 0.04, peak: 0.12, bus });
        break;
      case 'heal':
        this.tone({ type: 'triangle', freq: 660, to: 990, at: t, dur: 0.18, peak: 0.2, bus });
        break;
      case 'equip':
        this.tone({ type: 'square', freq: 720, at: t, dur: 0.04, peak: 0.1, bus });
        this.tone({ type: 'triangle', freq: 520, to: 820, at: t + 0.05, dur: 0.14, peak: 0.16, bus });
        break;
      case 'die':
        this.tone({ type: 'sawtooth', freq: 320, to: 55, at: t, dur: 0.8, peak: 0.3, bus });
        break;
    }
  }

  // ---------------- 合成原语 ----------------

  private tone(o: {
    type: OscillatorType;
    freq: number;
    to?: number;
    at: number;
    dur: number;
    peak: number;
    bus: GainNode;
    attack?: number;
    detune?: number;
  }): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = o.type;
    if (o.detune) osc.detune.value = o.detune;
    const a = o.attack ?? 0.006;
    osc.frequency.setValueAtTime(Math.max(1, o.freq), o.at);
    if (o.to !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.to), o.at + o.dur);
    }
    g.gain.setValueAtTime(0.0001, o.at);
    g.gain.linearRampToValueAtTime(Math.max(0.0002, o.peak), o.at + a);
    g.gain.exponentialRampToValueAtTime(0.0001, o.at + o.dur);
    osc.connect(g);
    g.connect(o.bus);
    osc.start(o.at);
    osc.stop(o.at + o.dur + 0.03);
  }

  private noise(o: {
    at: number;
    dur: number;
    peak: number;
    bus: GainNode;
    filter?: BiquadFilterType;
    freq?: number;
    sweepTo?: number;
    q?: number;
  }): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer();
    let node: AudioNode = src;
    if (o.filter) {
      const f = ctx.createBiquadFilter();
      f.type = o.filter;
      f.frequency.setValueAtTime(Math.max(20, o.freq ?? 1000), o.at);
      if (o.sweepTo !== undefined) {
        f.frequency.exponentialRampToValueAtTime(Math.max(20, o.sweepTo), o.at + o.dur);
      }
      if (o.q !== undefined) f.Q.value = o.q;
      src.connect(f);
      node = f;
    }
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, o.at);
    g.gain.linearRampToValueAtTime(Math.max(0.0002, o.peak), o.at + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, o.at + o.dur);
    node.connect(g);
    g.connect(o.bus);
    src.start(o.at);
    src.stop(o.at + o.dur + 0.02);
  }

  private noiseBuffer(): AudioBuffer {
    const ctx = this.ctx;
    if (!ctx) throw new Error('no audio context');
    if (this.noiseBuf) return this.noiseBuf;
    const len = Math.floor(ctx.sampleRate * 0.6);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;
    return buf;
  }
}

/** 全局单例：整个游戏共用一个引擎 */
export const audio = new AudioEngine();
