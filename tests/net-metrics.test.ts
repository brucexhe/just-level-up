import { describe, expect, it } from 'vitest';
import { NetMetrics } from '../client/net/online';

describe('NetMetrics', () => {
  it('汇总 RTT p95 / 抖动、技能 ACK、帧卡顿和位置校正', () => {
    const m = new NetMetrics();
    for (const rtt of [100, 110, 120, 130, 200]) m.recordRtt(rtt);
    for (const ack of [80, 90, 100, 150, 180]) m.recordAck(ack);
    m.recordFrame(16);
    m.recordFrame(150);
    m.recordSnap(180, 'revive');

    expect(m.snapshot(2)).toEqual({
      rttMs: 120,
      p95RttMs: 200,
      jitterMs: 80,
      p95CastAckMs: 180,
      frameHitches: 1,
      maxFrameMs: 150,
      snaps: 1,
      lastSnapDistance: 180,
      lastSnapReason: 'revive',
      reconnects: 2,
    });
  });

  it('样本队列有上限，不会随挂机时间无限增长', () => {
    const m = new NetMetrics();
    for (let i = 0; i < 500; i++) m.recordRtt(i);
    expect(m.snapshot(0).p95RttMs).toBe(493);
  });
});
