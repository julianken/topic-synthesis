import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Pure domain + store-logic tests run in node; component tests can add a
    // jsdom project later when the app surfaces land.
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
