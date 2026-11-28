import { afterEach, describe, expect, it, vi } from 'vitest';
import { isTouchPrimary, joystickScreenPos, shouldEmitJoystickDir } from '../client/game/input/touchEnv';

describe('isTouchPrimary', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('coarse pointer returns true', () => {
    vi.stubGlobal('window', {
      matchMedia: (query: string) => ({ matches: query === '(pointer: coarse)' }),
    });
    expect(isTouchPrimary()).toBe(true);
  });

  it('fine pointer returns false', () => {
    vi.stubGlobal('window', {
      matchMedia: () => ({ matches: false }),
    });
    expect(isTouchPrimary()).toBe(false);
  });

  it('no window returns false', () => {
    vi.stubGlobal('window', undefined);
    expect(isTouchPrimary()).toBe(false);
  });
});

describe('shouldEmitJoystickDir', () => {
  it('松开方向绕过 60ms 节流，避免快速抬手后继续移动', () => {
    expect(shouldEmitJoystickDir(0, 1000, null, 1010, 60)).toBe(true);
  });

  it('相同方向不重复发送，窗口内的新方向延后到下帧重试', () => {
    expect(shouldEmitJoystickDir(0, 1000, 0, 1010, 60)).toBe(false);
    expect(shouldEmitJoystickDir(0, 1000, Math.PI / 2, 1010, 60)).toBe(false);
    expect(shouldEmitJoystickDir(0, 1000, Math.PI / 2, 1060, 60)).toBe(true);
  });
});

describe('joystickScreenPos', () => {
  const noInsets = { top: 0, right: 0, bottom: 0, left: 0 };

  it('places the stick at bottom-left in physical pixels', () => {
    expect(joystickScreenPos(800, 360, 1, noInsets)).toEqual({ x: 70, y: 290, radius: 54 });
    expect(joystickScreenPos(800, 360, 2, noInsets)).toEqual({ x: 140, y: 580, radius: 108 });
    expect(joystickScreenPos(800, 360, 3, noInsets)).toEqual({ x: 210, y: 870, radius: 162 });
  });

  it('respects safe-area insets', () => {
    const insets = { top: 20, right: 30, bottom: 40, left: 10 };
    expect(joystickScreenPos(800, 360, 2, insets)).toEqual({ x: 160, y: 500, radius: 108 });
  });
});
