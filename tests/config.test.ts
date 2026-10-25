import { describe, expect, it } from 'vitest';
import { cycleOf, nextResetAt, tzOffsetMs } from '../shared/config';

const SH = { tz: 'Asia/Shanghai', periodMs: 24 * 3600_000, anchor: '00:00' };

describe('cycleOf 周期重刷', () => {
  it('上海时区偏移 +8h', () => {
    expect(tzOffsetMs(Date.UTC(2026, 9, 25, 3), 'Asia/Shanghai')).toBe(8 * 3600_000);
  });

  it('默认 24h：北京时间 0 点切周期', () => {
    // 北京时间 2026-10-25 23:59 与 2026-10-26 00:00（= UTC 10-25 15:59 / 16:00）
    const before = Date.UTC(2026, 9, 25, 15, 59);
    const after = Date.UTC(2026, 9, 25, 16, 0);
    expect(cycleOf(after, SH)).toBe(cycleOf(before, SH) + 1);
    // 同一天内不变
    expect(cycleOf(Date.UTC(2026, 9, 25, 1), SH)).toBe(cycleOf(before, SH));
  });

  it('nextResetAt 是下一个北京时间 0 点', () => {
    expect(nextResetAt(Date.UTC(2026, 9, 25, 3), SH)).toBe(Date.UTC(2026, 9, 25, 16, 0));
  });

  it('周期可配置：1 小时一刷', () => {
    const hourly = { ...SH, periodMs: 3600_000 };
    const t = Date.UTC(2026, 9, 25, 3, 10);
    expect(cycleOf(t + 3600_000, hourly)).toBe(cycleOf(t, hourly) + 1);
  });

  it('锚点可配置：每天 05:00 刷', () => {
    const at5 = { ...SH, anchor: '05:00' };
    // 北京时间 04:59 与 05:00（= UTC 20:59 / 21:00 前一天）
    const a = Date.UTC(2026, 9, 24, 20, 59);
    const b = Date.UTC(2026, 9, 24, 21, 0);
    expect(cycleOf(b, at5)).toBe(cycleOf(a, at5) + 1);
  });
});
