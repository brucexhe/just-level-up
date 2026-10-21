/**
 * 纯代码合成的音频引擎（不依赖任何音频资源文件）。
 *
 * - 背景音乐：用调度器按 16 分音符步进，实时合成循环乐句（琶音 + 长音铺底，
 *   没有鼓、**也没有贝斯**），所以音乐是"算出来的"，没有 mp3。
 *   **10 个关卡各一首**：速度、和弦进行、节奏密度、波形都不一样（见 `MUSIC_THEMES`），
 *   换关时 `setStage()` 换曲。
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
  | 'magic'
  | 'coin'
  | 'click'
  | 'heal'
  | 'equip'
  | 'die';

/** 一小节 16 步，4 小节一个循环 */
export const STEPS_PER_BAR = 16;
export const LOOP_STEPS = STEPS_PER_BAR * 4;
export const BPM = 116;
/** 一个 16 分音符的秒数 */
export const STEP_SEC = 60 / BPM / 4;

/**
 * 音符类型。
 * - `arp` 琶音、`pad` 长音铺底：现在真正在响的两个声部。
 * - `kick` / `snare` / `hat`：打击乐，早就不用了（用户不要鼓声），保留仅为兼容旧数据。
 * - 曾经的 `bass` 已删除：低频根音听着像心跳，已从曲子里彻底移除。
 */
export type NoteKind = 'arp' | 'pad' | 'kick' | 'snare' | 'hat';

export interface NoteEvent {
  kind: NoteKind;
  /** MIDI 音高（打击乐为 0） */
  midi: number;
  /** 力度 0~1 */
  vel: number;
}

export interface Chord {
  /** 和弦根音（MIDI），用于铺底长音 */
  root: number;
  /** 琶音用的和弦音（MIDI） */
  tones: number[];
}

/**
 * 一套 BGM = 一个「曲子配方」：速度 + 4 小节和弦进行 + 琶音节奏与音色 + 长音铺底。
 *
 * 10 个关卡各配一套，风格跟着场景走（草原轻快、雪原空灵、火山躁动…）。
 * 全部是**纯数据**，由 `stepEvents()` 实时算成音符，所以不需要任何音频文件。
 *
 * 注意：**贝斯声部已经删掉了**。低音根音每小节"咚"几下，在慢速关卡里听感像心跳，
 * 体验很差；低声部现在只保留慢起慢落的 `pad` 长音（见 padVel）。
 * 想再加节奏型低音的话，一定要用长 attack（≥0.03s），别再用 0.003s 的冲击式起音。
 */
export interface MusicTheme {
  /** 关卡序号 1~10 */
  stage: number;
  name: string;
  bpm: number;
  /** 4 小节的和弦进行（不足 4 个就循环取） */
  chords: Chord[];
  /** 琶音在小节内的步号（越密越紧张） */
  arpSteps: number[];
  /** 琶音走向：单向循环 / 上下往复（往复更"波浪感"） */
  arpDir: 'up' | 'updown';
  arpType: OscillatorType;
  /** 每小节琶音的八度偏移（高八度 = 更飘/更亮） */
  octaves: number[];
  /** 琶音力度 */
  arpVel: number;
  /** 每小节第一拍的持续和声（0 = 不要，用于空灵/阴暗场景的铺底） */
  padVel: number;
}

const ALL_16 = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];

export const MUSIC_THEMES: MusicTheme[] = [
  {
    // 草原：明朗的小调流行进行，十六分琶音跑动 = 轻快
    stage: 1,
    name: '草原',
    bpm: 116,
    chords: [
      { root: 45, tones: [57, 60, 64] }, // Am
      { root: 41, tones: [53, 57, 60] }, // F
      { root: 48, tones: [52, 55, 60] }, // C
      { root: 43, tones: [50, 55, 59] }, // G
    ],
    arpSteps: ALL_16,
    arpDir: 'up',
    arpType: 'square',
    octaves: [0, 12],
    arpVel: 0.3,
    padVel: 0,
  },
  {
    // 森林：慢一档、和声更暗（小调 + 大三度下行），琶音稀疏留白
    stage: 2,
    name: '森林',
    bpm: 96,
    chords: [
      { root: 38, tones: [50, 53, 57] }, // Dm
      { root: 46, tones: [50, 53, 58] }, // Bb
      { root: 41, tones: [53, 57, 60] }, // F
      { root: 45, tones: [57, 60, 64] }, // Am
    ],
    arpSteps: [0, 3, 6, 9, 12],
    arpDir: 'updown',
    arpType: 'triangle',
    octaves: [0, 12, 12, 0],
    arpVel: 0.26,
    padVel: 0.12,
  },
  {
    // 荒漠：弗里几亚属（E - F 的 b2 音程）做异域感，节奏带切分像蛇笛
    stage: 3,
    name: '荒漠',
    bpm: 104,
    chords: [
      { root: 40, tones: [52, 56, 59] }, // E（G# 大三度）
      { root: 41, tones: [53, 57, 60] }, // F（b2）
      { root: 40, tones: [52, 56, 59] }, // E
      { root: 38, tones: [50, 53, 57] }, // Dm
    ],
    arpSteps: [0, 2, 4, 6, 8, 10, 12, 13, 14, 15],
    arpDir: 'updown',
    arpType: 'square',
    octaves: [0, 12],
    arpVel: 0.3,
    padVel: 0,
  },
  {
    // 雪原：最慢，纯八分音符的"冰铃"高八度，底下一层暖 pad 撑着
    stage: 4,
    name: '雪原',
    bpm: 78,
    chords: [
      { root: 48, tones: [52, 55, 60] }, // C
      { root: 43, tones: [50, 55, 59] }, // G
      { root: 45, tones: [57, 60, 64] }, // Am
      { root: 41, tones: [53, 57, 60] }, // F
    ],
    arpSteps: [0, 4, 8, 12],
    arpDir: 'updown',
    arpType: 'sine',
    octaves: [12, 24],
    arpVel: 0.22,
    padVel: 0.14,
  },
  {
    // 沼泽：低沉浑浊，半音下行（Cm - Db）加拖沓的附点，像冒泡
    stage: 5,
    name: '沼泽',
    bpm: 84,
    chords: [
      { root: 36, tones: [48, 51, 55] }, // Cm
      { root: 37, tones: [49, 53, 56] }, // Db
      { root: 36, tones: [48, 51, 55] }, // Cm
      { root: 46, tones: [50, 53, 58] }, // Bb
    ],
    arpSteps: [0, 3, 6, 10, 12, 14],
    arpDir: 'updown',
    arpType: 'triangle',
    octaves: [0, 0],
    arpVel: 0.24,
    padVel: 0.1,
  },
  {
    // 火山：最快最躁，锯齿波 + 满十六分，末小节用和声小调的 V（A 大三度）推一把
    stage: 6,
    name: '火山',
    bpm: 132,
    chords: [
      { root: 38, tones: [50, 53, 57] }, // Dm
      { root: 39, tones: [51, 55, 58] }, // Eb（b2，凶）
      { root: 38, tones: [50, 53, 57] }, // Dm
      { root: 45, tones: [57, 61, 64] }, // A（和声小调 V）
    ],
    arpSteps: ALL_16,
    arpDir: 'up',
    arpType: 'sawtooth',
    octaves: [0, 12],
    arpVel: 0.26,
    padVel: 0.08,
  },
  {
    // 深渊：最慢最暗，减五度 + 半音上行制造不安，pad 很重
    // （原先写了 -12 八度，但低频短音听着像心跳，已去掉；暗色靠调式和重 pad 撑）
    stage: 7,
    name: '深渊',
    bpm: 68,
    chords: [
      { root: 36, tones: [48, 51, 54] }, // C + b5（减五度）
      { root: 37, tones: [49, 52, 56] }, // C#m
      { root: 36, tones: [48, 51, 54] }, // C + b5
      { root: 43, tones: [50, 55, 58] }, // Gm
    ],
    arpSteps: [0, 6, 10],
    arpDir: 'updown',
    arpType: 'triangle',
    octaves: [0, 0],
    arpVel: 0.2,
    padVel: 0.16,
  },
  {
    // 天空：明亮的大调上行，高两个八度的正弦琶音 = 云海里的闪光
    stage: 8,
    name: '天空',
    bpm: 124,
    chords: [
      { root: 48, tones: [52, 55, 60] }, // C
      { root: 43, tones: [50, 55, 59] }, // G
      { root: 45, tones: [57, 60, 64] }, // Am
      { root: 41, tones: [53, 57, 60] }, // F
    ],
    arpSteps: ALL_16,
    arpDir: 'updown',
    arpType: 'sine',
    octaves: [12, 24],
    arpVel: 0.28,
    padVel: 0.06,
  },
  {
    // 废墟：多利亚调式（Dm - G 而非 Gm）的苍凉感，中速八分音符
    stage: 9,
    name: '废墟',
    bpm: 88,
    chords: [
      { root: 38, tones: [50, 53, 57] }, // Dm
      { root: 43, tones: [50, 55, 59] }, // G（多利亚的 IV）
      { root: 38, tones: [50, 53, 57] }, // Dm
      { root: 45, tones: [57, 60, 64] }, // Am
    ],
    arpSteps: [0, 2, 4, 6, 8, 10, 12, 14],
    arpDir: 'updown',
    arpType: 'triangle',
    octaves: [0, 12],
    arpVel: 0.26,
    padVel: 0.12,
  },
  {
    // 星界：一连串大七和弦 + 高八度正弦，往复琶音像星光闪烁
    stage: 10,
    name: '星界',
    bpm: 108,
    chords: [
      { root: 36, tones: [60, 64, 67, 71] }, // Cmaj7
      { root: 41, tones: [53, 57, 60, 64] }, // Fmaj7
      { root: 43, tones: [55, 59, 62, 66] }, // Gmaj7（利底亚的 #4）
      { root: 45, tones: [57, 60, 64, 67] }, // Am7
    ],
    arpSteps: ALL_16,
    arpDir: 'updown',
    arpType: 'sine',
    octaves: [12, 24],
    arpVel: 0.24,
    padVel: 0.12,
  },
];

/** Am - F - C - G：根音 + 和弦音（MIDI）——草原主题的进行，保留导出兼容旧调用 */
export const CHORDS: Chord[] = MUSIC_THEMES[0]!.chords;

/** 按关卡取 BGM 主题；第 11 关及以后沿用第 10 关（星界） */
export function musicThemeForStage(stage: number): MusicTheme {
  const i = Math.min(Math.max(1, Math.floor(stage || 1)), MUSIC_THEMES.length);
  return MUSIC_THEMES[i - 1]!;
}

/**
 * 背景音乐允许的最低音（MIDI 45 = A2 ≈ 110Hz）。
 *
 * 低于这个音就整段升八度。原因有两个，都很实在：
 * 1. 低频短音的听感是"咚、咚"的心跳，非常难受（贝斯就是这么被删掉的）；
 * 2. 笔记本电脑/小音箱基本放不出 100Hz 以下，写那么低只是白白占掉音量余量，
 *    还会把技能音的低频一起糊住。
 *
 * 所以**所有**背景声部（琶音 arp 和长音 pad）都要过这道地板。
 */
export const MIN_MUSIC_MIDI = 45;

/** 把音符抬到不闷的高度：低于 MIN_MUSIC_MIDI 就升八度 */
export function liftAboveFloor(midi: number): number {
  let m = midi;
  while (m < MIN_MUSIC_MIDI) m += 12;
  return m;
}

/** 琶音取和弦音的下标：'up' 单向循环，'updown' 上下往复 */
function arpIndex(i: number, len: number, dir: 'up' | 'updown'): number {
  if (dir === 'up' || len < 2) return i % len;
  const period = 2 * len - 2;
  const k = i % period;
  return k < len ? k : period - k;
}

/**
 * 纯函数：给定步号与主题，返回这一拍要响的音符，便于单测且方便以后换曲子。
 */
export function stepEvents(step: number, theme: MusicTheme = MUSIC_THEMES[0]!): NoteEvent[] {
  const s = ((step % LOOP_STEPS) + LOOP_STEPS) % LOOP_STEPS;
  const bar = Math.floor(s / STEPS_PER_BAR);
  const inBar = s % STEPS_PER_BAR;
  const chord = theme.chords[bar % theme.chords.length]!;
  const out: NoteEvent[] = [];

  // 持续和声：每小节头上铺一层长音（慢起慢落的 drone，只做"空气"不做节奏）
  if (inBar === 0 && theme.padVel > 0) {
    // 同样要过音高地板：以前这里写 -12 八度，深渊关会掉到 65Hz 变成低频轰鸣
    out.push({ kind: 'pad', midi: liftAboveFloor(chord.tones[0]!), vel: theme.padVel });
  }
  const ai = theme.arpSteps.indexOf(inBar);
  if (ai >= 0) {
    const tone = chord.tones[arpIndex(ai, chord.tones.length, theme.arpDir)]!;
    const oct = theme.octaves[bar % theme.octaves.length]!;
    out.push({
      kind: 'arp',
      // 抬过低音地板：就算主题写了 -12 八度，也不会掉到"心跳"那个频段
      midi: liftAboveFloor(tone + oct),
      vel: ai === 0 ? theme.arpVel * 1.4 : theme.arpVel,
    });
  }
  // 鼓和贝斯都不要：背景层只剩琶音 + 长音铺底，避免出现"心跳"一样的低频冲击
  return out;
}

/**
 * 音乐总线的基准增益（BGM 相对音效的比例）。
 *
 * 这个值来回改过两轮，定在 0.5 是踩出来的平衡点：
 * - 0.34：相对音效低约 8dB，默认音量下**几乎听不见**（第一轮的问题）；
 * - 0.75：听得见了，但轮到**技能音被背景盖住**（第二轮的问题）；
 * - 0.5：还能当背景听，同时把余量让给音效，配合下面的 ducking 足够清晰。
 */
export const MUSIC_BUS_GAIN = 0.5;

/** 各音轨的峰值增益（乘上音符力度后才是实际音量）；贝斯已删除，只剩琶音与铺底 */
export const NOTE_PEAK = { arp: 0.4, pad: 0.6 } as const;

/**
 * 音效的增益倍数。BGM 调响之后，技能音如果还是老音量会被背景盖住，
 * 所以技能整体抬一档；普通攻击因为每次挥砍都响（太频繁），只小幅提升。
 */
export const SFX_GAIN = { skill: 2.0, swing: 1.35 } as const;

/**
 * 闪避（ducking）：技能这类**不能漏听**的音效一响，就把音乐短暂压低再放回来。
 *
 * 光靠调音量解决不了"技能被背景盖住"——背景是连着的十六分音符流，
 * 频段又和技能音撞在一起，属于听觉掩蔽，不是谁声音大的问题。
 * 让背景在关键时刻让路，才是真的听得清。
 *
 * - factor：压到原来的多少（0.3 = 三成）
 * - attack：压下去的快慢（太长就压了个寂寞）
 * - hold：压住不动的时间，盖住技能音最响的那一截
 * - release：放回原音量，慢一点才没有"一跳一跳"的抽水感
 */
export const DUCK = { factor: 0.3, attack: 0.02, hold: 0.18, release: 0.32 } as const;

/** 会触发闪避的音效：三个技能音，外加不能漏掉的提示音 */
const DUCK_SFX: ReadonlySet<SfxName> = new Set<SfxName>([
  'fire',
  'frenzy',
  'poison',
  'levelup',
  'boss',
  'die',
]);

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
  /** 当前 BGM 主题（随关卡切换） */
  private theme: MusicTheme = MUSIC_THEMES[0]!;
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
  /** 当前背景音乐主题（设置面板 / 测试可读） */
  get currentTheme(): MusicTheme {
    return this.theme;
  }
  /** 一个 16 分音符的秒数（随主题的 BPM 变化） */
  private get stepSec(): number {
    return 60 / this.theme.bpm / 4;
  }

  private buildGraph(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    this.master = ctx.createGain();
    this.master.gain.value = this.vol;
    this.master.connect(ctx.destination);

    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = MUSIC_BUS_GAIN;
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

  /**
   * 切换关卡的 BGM。曲子从头开始放，并把调度时间轴重置到"现在"，
   * 否则上一首按旧 BPM 排下去的音符还会接着响。
   */
  setStage(stage: number): void {
    const next = musicThemeForStage(stage);
    if (next === this.theme) return;
    this.theme = next;
    if (this.bgmRunning && this.ctx) {
      this.step = 0;
      this.nextAt = this.ctx.currentTime + 0.06;
    }
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
      this.scheduleStep(stepEvents(this.step, this.theme), this.nextAt);
      this.nextAt += this.stepSec;
      this.step = (this.step + 1) % LOOP_STEPS;
    }
  }

  private scheduleStep(events: NoteEvent[], at: number): void {
    const bus = this.musicBus;
    if (!bus || !this.ctx) return;
    for (const e of events) {
      switch (e.kind) {
        // 'bass' 分支已删除：低音根音听感像心跳，背景层不再出任何低频冲击音
        case 'arp':
          // 波形由主题决定（方波亮、三角/正弦柔和、锯齿躁）
          this.tone({
            type: this.theme.arpType,
            freq: midiToFreq(e.midi),
            at,
            dur: 0.11,
            peak: NOTE_PEAK.arp * e.vel,
            bus,
            attack: 0.002,
            detune: 6,
          });
          break;
        case 'pad':
          // 每小节一层的持续和声：起落都慢（attack 0.18s），只做"空气"不做节奏
          this.tone({
            type: 'sine',
            freq: midiToFreq(e.midi),
            at,
            dur: this.stepSec * STEPS_PER_BAR * 0.95,
            peak: NOTE_PEAK.pad * e.vel,
            bus,
            attack: 0.18,
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

  /** 上次闪避全部走完的时刻（用来做冷却，避免连续触发把音乐压死） */
  private duckUntil = 0;

  /**
   * 把背景音乐短暂压低再放回原音量。
   *
   * 全程用 setTargetAtTime（指数平滑）而不是硬跳，否则会有咔哒声。
   */
  private duck(): void {
    const ctx = this.ctx;
    const bus = this.musicBus;
    if (!ctx || !bus) return;
    const t = ctx.currentTime;
    // 冷却：上一次还没放回来就别重排了，不然密集放技能时音乐会一直趴着
    if (t < this.duckUntil - DUCK.hold) return;
    this.duckUntil = t + DUCK.attack + DUCK.hold + DUCK.release;

    const g = bus.gain;
    g.cancelScheduledValues(t);
    g.setTargetAtTime(MUSIC_BUS_GAIN * DUCK.factor, t, DUCK.attack);
    g.setTargetAtTime(MUSIC_BUS_GAIN, t + DUCK.hold, DUCK.release);
  }

  // ---------------- 音效 ----------------

  /**
   * @param gain 单次播放的音量倍率（0~1）。持续伤害每 0.5s 一跳，
   *   全音量命中音会变成噪音，所以需要能压低。
   */
  play(name: SfxName, gain = 1): void {
    const ctx = this.ensure();
    if (!ctx || !this.sfxBus || !this.sfxOn) return;
    // 技能音开嗓前先把背景让开。只对「不能漏听」的那几个生效：
    // 普攻的 hit 一秒好几下，也去压背景的话音乐会变成一抽一抽的，很难受。
    if (this.bgmRunning && DUCK_SFX.has(name)) this.duck();
    let bus: GainNode = this.sfxBus;
    if (gain < 1) {
      const g = ctx.createGain();
      g.gain.value = Math.max(0, Math.min(1, gain));
      g.connect(this.sfxBus);
      bus = g;
    }
    const t = ctx.currentTime + 0.001;
    switch (name) {
      case 'swing':
        this.noise({
          at: t,
          dur: 0.13,
          peak: 0.3 * SFX_GAIN.swing,
          bus,
          filter: 'bandpass',
          freq: 900,
          sweepTo: 3000,
          q: 1.4,
        });
        this.tone({
          type: 'sine',
          freq: 320,
          to: 130,
          at: t,
          dur: 0.1,
          peak: 0.18 * SFX_GAIN.swing,
          bus,
        });
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
      // ↓ 下面三个是技能音：BGM 调响后一起抬一档，免得被背景盖住
      case 'fire':
        this.noise({
          at: t,
          dur: 0.36,
          peak: 0.34 * SFX_GAIN.skill,
          bus,
          filter: 'lowpass',
          freq: 2600,
          sweepTo: 320,
        });
        this.tone({
          type: 'sawtooth',
          freq: 420,
          to: 120,
          at: t,
          dur: 0.28,
          peak: 0.14 * SFX_GAIN.skill,
          bus,
        });
        break;
      case 'frenzy':
        this.tone({
          type: 'sawtooth',
          freq: 220,
          to: 700,
          at: t,
          dur: 0.42,
          peak: 0.24 * SFX_GAIN.skill,
          bus,
        });
        this.tone({
          type: 'square',
          freq: 330,
          to: 990,
          at: t + 0.04,
          dur: 0.36,
          peak: 0.1 * SFX_GAIN.skill,
          bus,
        });
        break;
      case 'poison':
        this.tone({
          type: 'triangle',
          freq: 165,
          to: 110,
          at: t,
          dur: 0.45,
          peak: 0.24 * SFX_GAIN.skill,
          bus,
        });
        this.noise({
          at: t,
          dur: 0.5,
          peak: 0.12 * SFX_GAIN.skill,
          bus,
          filter: 'lowpass',
          freq: 620,
        });
        break;
      case 'magic':
        // BOSS 的法术：下行扫频 + 一点点噪声尾，听感上和近战挨打明显不同，
        // 让玩家知道"这一下掉血是因为法防不够"
        this.tone({
          type: 'sine',
          freq: 880,
          to: 180,
          at: t,
          dur: 0.34,
          peak: 0.5,
          bus,
          attack: 0.004,
          detune: 12,
        });
        this.noise({
          at: t,
          dur: 0.42,
          peak: 0.34,
          bus,
          filter: 'bandpass',
          freq: 1800,
          sweepTo: 400,
          q: 2.2,
        });
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
