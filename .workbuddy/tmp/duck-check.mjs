// 浏览器实测：技能音闪避（ducking）是否真的把背景音乐压下去
import { chromium } from 'file:///C:/Program%20Files/nodejs/node_modules/playwright/index.mjs';

const URL = 'http://localhost:9999/';
const MUSIC_BUS_GAIN = 0.5;
const DUCK_FACTOR = 0.3;

const INIT = () => {
  window.__gainNodes = [];
  window.__osc = [];
  const proto = window.AudioContext && window.AudioContext.prototype;
  if (!proto) return;

  const origGain = proto.createGain;
  proto.createGain = function () {
    const n = origGain.call(this);
    window.__gainNodes.push(n);
    const p = n.gain;
    const origSet = p.setTargetAtTime ? p.setTargetAtTime.bind(p) : null;
    n.__duckLog = [];
    if (origSet) {
      p.setTargetAtTime = (v, t, tc) => {
        n.__duckLog.push(v);
        return origSet(v, t, tc);
      };
    }
    return n;
  };

  const origOsc = proto.createOscillator;
  proto.createOscillator = function () {
    const o = origOsc.call(this);
    const rec = { freq: 0, start: -1, stop: -1 };
    window.__osc.push(rec);
    const p = o.frequency;
    const origV = p.setValueAtTime.bind(p);
    p.setValueAtTime = (v, t) => {
      rec.freq = v;
      return origV(v, t);
    };
    const origStart = o.start.bind(o);
    const origStop = o.stop.bind(o);
    o.start = (t) => {
      rec.start = t;
      return origStart(t);
    };
    o.stop = (t) => {
      rec.stop = t;
      return origStop(t);
    };
    return o;
  };
};

async function attempt() {
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--autoplay-policy=no-user-gesture-required'],
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const errs = [];
    page.on('pageerror', (e) => errs.push(e.message));
    await page.addInitScript(INIT);
    await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 25000 });
    await page.waitForSelector('canvas', { timeout: 20000 });
    // 真实点击一次解锁 AudioContext
    await page.mouse.click(640, 500);
    await page.waitForTimeout(2500);

    const base = await page.evaluate(() => {
      const g = window.__gainNodes || [];
      return {
        gains: g.length,
        musicBusValue: g[1] ? g[1].gain.value : null,
        playing: !!(window.__demo && window.__demo.audio().playing),
        oscs: (window.__osc || []).length,
      };
    });

    // 清空记录后放一发狂暴（W），看音乐总线有没有被压下去
    await page.evaluate(() => {
      (window.__gainNodes || []).forEach((n) => (n.__duckLog.length = 0));
      window.__osc.length = 0;
    });
    await page.keyboard.press('w');
    await page.waitForTimeout(900);

    const after = await page.evaluate(() => {
      const g = window.__gainNodes || [];
      // Phaser 自己也会建 AudioContext，索引会错位，这里全量扫：
      // 被 duck 的那个总线一定收到过 ≈ MUSIC_BUS_GAIN*0.3 的目标值
      const logs = g.map((n) => n.__duckLog || []).filter((l) => l.length > 0);
      const all = logs.flat();
      const notes = (window.__osc || [])
        .filter((r) => r.freq > 0 && r.stop > r.start)
        .map((r) => ({ f: Math.round(r.freq * 10) / 10, dur: Math.round((r.stop - r.start) * 100) / 100 }));
      return {
        duckedNodes: logs.length,
        duckLog: logs[0] ? logs[0].slice(0, 4) : [],
        minDuck: all.length ? Math.min(...all) : null,
        notes: notes.slice(0, 8),
        noteCount: notes.length,
        heartbeats: notes.filter((n) => n.dur < 0.25 && n.f < 110).length,
      };
    });

    await page.screenshot({ path: '.workbuddy/tmp/duck.png' });
    console.log('base:', JSON.stringify(base));
    console.log('afterSkill:', JSON.stringify(after));

    const ducked = after.minDuck !== null && Math.abs(after.minDuck - MUSIC_BUS_GAIN * DUCK_FACTOR) < 0.01;
    const restored = after.duckLog.length >= 2 && Math.abs(after.duckLog[1] - MUSIC_BUS_GAIN) < 0.01;
    console.log('RESULT duckApplied=' + ducked + ' duckRestored=' + restored + ' heartbeats=' + after.heartbeats);
    console.log('consoleErrors=' + errs.length + (errs.length ? ' ' + errs.slice(0, 2).join(' | ') : ''));
    return true;
  } finally {
    await browser.close();
  }
}

for (let i = 1; i <= 4; i++) {
  try {
    await attempt();
    break;
  } catch (e) {
    console.log('attempt ' + i + ' failed: ' + String(e).split('\n')[0]);
    if (i === 4) process.exitCode = 1;
  }
}
