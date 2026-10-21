import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // 纯逻辑测试，串行跑更快也更稳（避免多 worker 并发写临时缓存目录的竞争）
    fileParallelism: false,
  },
});
