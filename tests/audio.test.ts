import { afterEach, describe, expect, it } from 'vitest';
import {
  AudioEngine,
  LOOP_STEPS,
  STEPS_PER_BAR,
  midiToFreq,
  stepEvents,
} from '../src/game/audio';

// ---------------- 极简 AudioContext 替身 ----------------

class FakeParam {
  value = 0;
  setValueAtTime(v: number) {
    this.value = v;
    return this;
  }
  linearRampToValueAtTime() {
    return this;
  }
  exponentialRampToValueAtTime() {
    return this;
  }
  setTargetAtTime() {
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

  createGain() {
    this.gains++;
    return new FakeNode();
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
  it('第 0 拍同时有贝斯 / 琶音 / 底鼓', () => {
    const evs = stepEvents(0);
    const kinds = evs.map((e) => e.kind);
    expect(kinds).toContain('bass');
    expect(kinds).toContain('arp');
    expect(kinds).toContain('kick');
  });

  it('底鼓是「正拍 + 切分」：0/8 重拍，6/14 轻拍', () => {
    for (let s = 0; s < LOOP_STEPS; s++) {
      const hasKick = stepEvents(s).some((e) => e.kind === 'kick');
      expect(hasKick).toBe([0, 6, 8, 14].includes(s % STEPS_PER_BAR));
    }
  });

  it('贝斯是切分节奏：每小节 4 下，一循环 16 下', () => {
    let n = 0;
    for (let s = 0; s < LOOP_STEPS; s++) {
      n += stepEvents(s).filter((e) => e.kind === 'bass').length;
    }
    expect(n).toBe(16);
  });

  it('一循环内四个小节各用不同和弦根音', () => {
    const roots = new Set<number>();
    for (let bar = 0; bar < 4; bar++) {
      const ev = stepEvents(bar * STEPS_PER_BAR).find((e) => e.kind === 'bass');
      if (ev) roots.add(ev.midi);
    }
    expect(roots.size).toBe(4);
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
});
