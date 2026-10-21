import { afterEach, describe, expect, it } from 'vitest';
import {
  AudioEngine,
  DUCK,
  LOOP_STEPS,
  MIN_MUSIC_MIDI,
  MUSIC_BUS_GAIN,
  MUSIC_THEMES,
  NOTE_PEAK,
  SFX_GAIN,
  STEPS_PER_BAR,
  liftAboveFloor,
  midiToFreq,
  musicThemeForStage,
  stepEvents,
  type SfxName,
} from '../src/game/audio';

// ---------------- 极简 AudioContext 替身 ----------------

class FakeParam {
  value = 0;
  /** 记录包络爬到过的最高值（= 这个音的峰值音量） */
  peak = 0;
  /** 记录所有 setTargetAtTime 的目标值（用来断言 ducking 真的压低过） */
  targets: number[] = [];
  setValueAtTime(v: number) {
    this.value = v;
    return this;
  }
  linearRampToValueAtTime(v: number) {
    this.value = v;
    if (v > this.peak) this.peak = v;
    return this;
  }
  exponentialRampToValueAtTime() {
    return this;
  }
  cancelScheduledValues() {
    return this;
  }
  /** 近似处理：直接落到目标值，方便断言音量确实被改了 */
  setTargetAtTime(v: number) {
    this.value = v;
    this.targets.push(v);
    return this;
  }
}

class FakeNode {
  gain = new FakeParam();
  frequency = new FakeParam();
  detune = new FakeParam();
  Q = new FakeParam();
  type = '';
  connected = 0;
  connect() {
    this.connected++;
    return this;
  }
  disconnect() {
    return this;
  }
  start() {
    this.started++;
    return this;
  }
  stop() {
    return this;
  }
  started = 0;
}

class FakeCtx {
  currentTime = 0;
  state = 'suspended';
  sampleRate = 44100;
  destination = new FakeNode();
  oscs = 0;
  noises = 0;
  gains = 0;
  resumed = 0;
  /** 按创建顺序记录所有 GainNode：0=master 1=musicBus 2=sfxBus */
  gainNodes: FakeNode[] = [];

  createGain() {
    this.gains++;
    const n = new FakeNode();
    this.gainNodes.push(n);
    return n;
  }
  createOscillator() {
    this.oscs++;
    return new FakeNode();
  }
  createBufferSource() {
    this.noises++;
    return new FakeNode();
  }
  createBiquadFilter() {
    return new FakeNode();
  }
  createBuffer(_ch: number, len: number, _sr: number) {
    return {
      getChannelData: () => new Float32Array(len),
    } as unknown as AudioBuffer;
  }
  resume() {
    this.resumed++;
    this.state = 'running';
    return Promise.resolve();
  }
}

function engine(): { e: AudioEngine; ctx: FakeCtx } {
  const ctx = new FakeCtx();
  const e = new AudioEngine();
  // 测试里手动注入，避免依赖真实 AudioContext
  e.attach(ctx as unknown as AudioContext);
  return { e, ctx };
}

const engines: AudioEngine[] = [];
function tracked(): { e: AudioEngine; ctx: FakeCtx } {
  const r = engine();
  engines.push(r.e);
  return r;
}

afterEach(() => {
  while (engines.length) engines.pop()!.stopBgm();
});

describe('BGM 序列（纯函数）', () => {
  it('第 0 拍有琶音，没有贝斯也没有鼓', () => {
    const evs = stepEvents(0);
    const kinds = evs.map((e) => e.kind);
    expect(kinds).toContain('arp');
    expect(kinds).not.toContain('bass');
    expect(kinds).not.toContain('kick');
  });

  it('贝斯已彻底删除：整段循环（十套主题）一声都不响', () => {
    for (const t of MUSIC_THEMES) {
      for (let s = 0; s < LOOP_STEPS; s++) {
        const kinds = stepEvents(s, t).map((e) => e.kind);
        expect(kinds, `${t.name} 第 ${s} 步不该有贝斯`).not.toContain('bass');
      }
    }
  });

  it('背景音乐没有鼓：整段循环里不出现任何打击乐', () => {
    for (let s = 0; s < LOOP_STEPS; s++) {
      const kinds = stepEvents(s).map((e) => e.kind);
      expect(kinds).not.toContain('kick');
      expect(kinds).not.toContain('snare');
      expect(kinds).not.toContain('hat');
    }
  });

  it('去掉贝斯后每小节仍有骨架：每一小节都有琶音', () => {
    for (const t of MUSIC_THEMES) {
      for (let bar = 0; bar < 4; bar++) {
        let n = 0;
        for (let i = 0; i < STEPS_PER_BAR; i++) {
          n += stepEvents(bar * STEPS_PER_BAR + i, t).filter((e) => e.kind === 'arp').length;
        }
        expect(n, `${t.name} 第 ${bar + 1} 小节`).toBeGreaterThan(0);
      }
    }
  });

  it('没有一个音符掉到"心跳"频段：琶音和长音全部 ≥ MIDI 45（≈110Hz）', () => {
    for (const t of MUSIC_THEMES) {
      for (let s = 0; s < LOOP_STEPS; s++) {
        for (const e of stepEvents(s, t)) {
          if (e.kind === 'arp' || e.kind === 'pad') {
            expect(e.midi, `${t.name} 第 ${s} 步的 ${e.kind}`).toBeGreaterThanOrEqual(MIN_MUSIC_MIDI);
          }
        }
      }
    }
  });

  it('liftAboveFloor：低于地板的音逐八度抬上来，够高的不动', () => {
    expect(liftAboveFloor(36)).toBe(48); // C2 → C3（+2 个八度才够）
    expect(liftAboveFloor(40)).toBe(52);
    expect(liftAboveFloor(44)).toBe(56);
    expect(liftAboveFloor(48)).toBe(48);
    expect(liftAboveFloor(72)).toBe(72);
  });

  it('四个小节的和弦确实在走（至少 3 种不同的琶音音组）', () => {
    const groups = new Set<string>();
    for (let bar = 0; bar < 4; bar++) {
      const tones: number[] = [];
      for (let i = 0; i < STEPS_PER_BAR; i++) {
        for (const e of stepEvents(bar * STEPS_PER_BAR + i)) {
          if (e.kind === 'arp') tones.push(e.midi % 12);
        }
      }
      groups.add([...new Set(tones)].sort().join(','));
    }
    expect(groups.size).toBeGreaterThanOrEqual(3);
  });

  it('步号取模安全（负数 / 超界）', () => {
    expect(stepEvents(-1)).toEqual(stepEvents(LOOP_STEPS - 1));
    expect(stepEvents(LOOP_STEPS + 3)).toEqual(stepEvents(3));
  });

  it('MIDI 转频率：A4 = 440Hz', () => {
    expect(midiToFreq(69)).toBeCloseTo(440, 6);
    expect(midiToFreq(57)).toBeCloseTo(220, 1);
  });
});

describe('10 个关卡各一首 BGM', () => {
  /** 把整套循环压成一个字符串指纹，用来判断两首曲子是否真的不同 */
  const fingerprint = (t: (typeof MUSIC_THEMES)[number]) =>
    Array.from({ length: LOOP_STEPS }, (_, s) =>
      stepEvents(s, t)
        .map((e) => `${e.kind}${e.midi}`)
        .join(','),
    ).join('|');

  it('一共 10 套主题，编号 1~10 与关卡一一对应', () => {
    expect(MUSIC_THEMES).toHaveLength(10);
    MUSIC_THEMES.forEach((t, i) => expect(t.stage).toBe(i + 1));
  });

  it('每套曲子都真的会响，且速度都在合理区间', () => {
    for (const t of MUSIC_THEMES) {
      let n = 0;
      for (let s = 0; s < LOOP_STEPS; s++) n += stepEvents(s, t).length;
      expect(n, `${t.name} 应该有音符`).toBeGreaterThan(8);
      expect(t.bpm, `${t.name} 的速度`).toBeGreaterThanOrEqual(60);
      expect(t.bpm).toBeLessThanOrEqual(140);
    }
  });

  it('10 首曲子两两不同（指纹互异）', () => {
    const fps = MUSIC_THEMES.map(fingerprint);
    expect(new Set(fps).size).toBe(10);
  });

  it('整段循环里依然没有鼓', () => {
    for (const t of MUSIC_THEMES) {
      for (let s = 0; s < LOOP_STEPS; s++) {
        const kinds = stepEvents(s, t).map((e) => e.kind);
        expect(kinds).not.toContain('kick');
        expect(kinds).not.toContain('snare');
        expect(kinds).not.toContain('hat');
      }
    }
  });

  it('铺底长音：有 pad 的主题每小节 1 下，没有的一下都不响', () => {
    for (const t of MUSIC_THEMES) {
      let n = 0;
      for (let s = 0; s < LOOP_STEPS; s++) n += stepEvents(s, t).filter((e) => e.kind === 'pad').length;
      expect(n, `${t.name} 的 pad 数`).toBe(t.padVel > 0 ? 4 : 0);
    }
  });

  it('按关卡取曲子：第 11 关以后沿用第 10 关（星界）', () => {
    expect(musicThemeForStage(1).name).toBe('草原');
    expect(musicThemeForStage(6).name).toBe('火山');
    expect(musicThemeForStage(10).name).toBe('星界');
    expect(musicThemeForStage(11)).toBe(musicThemeForStage(10));
    expect(musicThemeForStage(999)).toBe(musicThemeForStage(10));
    expect(musicThemeForStage(0).name).toBe('草原');
  });

  it('引擎切关会换主题，相同关卡不重复触发', () => {
    const { e } = tracked();
    expect(e.currentTheme.name).toBe('草原');
    e.setStage(6);
    expect(e.currentTheme.name).toBe('火山');
    e.setStage(6);
    expect(e.currentTheme.name).toBe('火山');
    e.setStage(1);
    expect(e.currentTheme.name).toBe('草原');
  });

  it('切换主题后调度出来的音符跟着换（雪原有长音铺底，草原没有）', () => {
    const { e } = tracked();
    const grass = Array.from({ length: LOOP_STEPS }, (_, s) => stepEvents(s, e.currentTheme));
    expect(grass.flat().some((x) => x.kind === 'pad')).toBe(false);

    e.setStage(4); // 雪原
    const snow = Array.from({ length: LOOP_STEPS }, (_, s) => stepEvents(s, e.currentTheme));
    expect(snow.flat().some((x) => x.kind === 'pad')).toBe(true);
  });
});

describe('AudioEngine 开关与音量', () => {
  it('默认音乐/音效都开，音量 0.6', () => {
    const { e } = tracked();
    expect(e.musicEnabled).toBe(true);
    expect(e.sfxEnabled).toBe(true);
    expect(e.volume).toBeCloseTo(0.6, 5);
  });

  it('关掉音效后 play 不再产生任何发声节点', () => {
    const { e, ctx } = tracked();
    e.play('hit');
    const after = ctx.oscs + ctx.noises;
    expect(after).toBeGreaterThan(0);

    e.setSfx(false);
    e.play('hit');
    expect(ctx.oscs + ctx.noises).toBe(after);
  });

  it('音量会被钳制到 0~1', () => {
    const { e } = tracked();
    e.setVolume(2);
    expect(e.volume).toBe(1);
    e.setVolume(-1);
    expect(e.volume).toBe(0);
    e.setVolume(Number.NaN);
    expect(e.volume).toBe(0);
  });

  it('背景音乐压回背景该有的位置：总线 0.5（比听不见的 0.34 响，比盖住技能的 0.75 小）', () => {
    const { ctx } = tracked();
    expect(MUSIC_BUS_GAIN).toBeGreaterThan(0.34);
    expect(MUSIC_BUS_GAIN).toBeLessThan(0.75);
    const musicBus = ctx.gainNodes[1]!;
    expect(musicBus.gain.value).toBeCloseTo(MUSIC_BUS_GAIN, 5);
  });

  it('只有一个音量滑块：master 跟着 setVolume 走，音乐总线不受影响', () => {
    const { e, ctx } = tracked();
    const master = ctx.gainNodes[0]!;
    const musicBus = ctx.gainNodes[1]!;
    e.setVolume(0.3);
    expect(master.gain.value).toBeCloseTo(0.3, 5);
    expect(musicBus.gain.value).toBeCloseTo(MUSIC_BUS_GAIN, 5);
  });

  it('只剩琶音和铺底两个声部的峰值（贝斯已删除）', () => {
    expect(NOTE_PEAK).not.toHaveProperty('bass');
    expect(NOTE_PEAK.arp).toBeGreaterThan(0.3);
    expect(NOTE_PEAK.pad).toBeGreaterThan(0.5);
  });

  it('解锁后 BGM 起播，关掉音乐即停', () => {
    const { e, ctx } = tracked();
    e.unlock();
    expect(ctx.resumed).toBe(1);
    expect(e.playing).toBe(true);

    e.setMusic(false);
    expect(e.playing).toBe(false);
    expect(e.musicEnabled).toBe(false);

    e.setMusic(true);
    expect(e.playing).toBe(true);
  });

  it('暂停会停 BGM，恢复后重新起播', () => {
    const { e } = tracked();
    e.unlock();
    e.setPaused(true);
    expect(e.playing).toBe(false);
    e.setPaused(false);
    expect(e.playing).toBe(true);
  });

  it('没有 AudioContext 时（node/SSR）所有调用都是安全的空操作', () => {
    const e = new AudioEngine(() => {
      throw new Error('no audio here');
    });
    expect(() => {
      e.unlock();
      e.play('hit');
      e.setVolume(0.5);
      e.setPaused(true);
    }).not.toThrow();
    expect(e.playing).toBe(false);
  });

  it('每种音效都能合成出声音（不报错且有节点）', () => {
    const names = [
      'swing',
      'hit',
      'crit',
      'hurt',
      'kill',
      'boss',
      'levelup',
      'fire',
      'frenzy',
      'poison',
      'coin',
      'click',
      'heal',
      'equip',
      'die',
    ] as const;
    for (const n of names) {
      const { e, ctx } = tracked();
      const before = ctx.oscs + ctx.noises;
      e.play(n);
      expect(ctx.oscs + ctx.noises).toBeGreaterThan(before);
      e.stopBgm();
    }
  });

  /** 播放一个音效，返回它用到的最大峰值音量 */
  const peakOf = (name: SfxName): number => {
    const { e, ctx } = tracked();
    const from = ctx.gainNodes.length;
    e.play(name);
    e.stopBgm();
    return Math.max(...ctx.gainNodes.slice(from).map((n) => n.gain.peak));
  };

  it('技能音跟着 BGM 一起变响：三个技能音都比原来的基础值大', () => {
    expect(SFX_GAIN.skill).toBeGreaterThan(1);
    // 括号里是提升前的基础峰值
    expect(peakOf('fire')).toBeGreaterThan(0.34);
    expect(peakOf('frenzy')).toBeGreaterThan(0.24);
    expect(peakOf('poison')).toBeGreaterThan(0.24);
  });

  it('普通攻击也提了一档，但幅度比技能小（挥砍太频繁，不能太吵）', () => {
    expect(SFX_GAIN.swing).toBeGreaterThan(1);
    expect(SFX_GAIN.swing).toBeLessThan(SFX_GAIN.skill);
    expect(peakOf('swing')).toBeGreaterThan(0.3);
  });

  it('技能音压得过背景：就算 BGM 调响过，技能峰值仍然大于琶音最响的一下', () => {
    const sfxBus = 0.9;
    // 贝斯删掉后，BGM 里最响的是小节头那一下琶音（力度 ×1.4）
    const loudestNote = NOTE_PEAK.arp * MUSIC_THEMES[0]!.arpVel * 1.4 * MUSIC_BUS_GAIN;
    for (const n of ['fire', 'frenzy', 'poison'] as const) {
      expect(peakOf(n) * sfxBus, `${n} 相对琶音`).toBeGreaterThan(loudestNote);
    }
  });
});

describe('闪避（ducking）：技能响时给背景让路', () => {
  it('放技能会把音乐总线压下去再放回原音量', () => {
    const { e, ctx } = tracked();
    e.unlock(); // 起播 BGM
    const musicBus = ctx.gainNodes[1]!;
    musicBus.gain.targets.length = 0;

    e.play('fire');
    const ducked = Math.min(...musicBus.gain.targets);
    expect(ducked).toBeCloseTo(MUSIC_BUS_GAIN * DUCK.factor, 5);
    expect(ducked).toBeLessThan(MUSIC_BUS_GAIN);
    // 最后是放回原音量，不是压着不放
    expect(musicBus.gain.targets.at(-1)).toBeCloseTo(MUSIC_BUS_GAIN, 5);
  });

  it('普攻命中不去压背景（一秒好几下，压了会抽水）', () => {
    const { e, ctx } = tracked();
    e.unlock();
    const musicBus = ctx.gainNodes[1]!;
    musicBus.gain.targets.length = 0;

    e.play('hit');
    expect(musicBus.gain.targets).toHaveLength(0);
    e.play('swing');
    expect(musicBus.gain.targets).toHaveLength(0);
  });

  it('重要提示音也闪避：升级 / BOSS / 死亡', () => {
    for (const n of ['levelup', 'boss', 'die'] as const) {
      const { e, ctx } = tracked();
      e.unlock();
      const musicBus = ctx.gainNodes[1]!;
      musicBus.gain.targets.length = 0;
      e.play(n);
      expect(Math.min(...musicBus.gain.targets), n).toBeLessThan(MUSIC_BUS_GAIN);
    }
  });

  it('音乐关掉时不闪避（没有背景可让）', () => {
    const { e, ctx } = tracked();
    e.setMusic(false);
    const musicBus = ctx.gainNodes[1]!;
    musicBus.gain.targets.length = 0;
    e.play('fire');
    expect(musicBus.gain.targets).toHaveLength(0);
  });
});
