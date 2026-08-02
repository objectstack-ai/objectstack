import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // The only DOM environment in the workspace, and deliberately so (#4682):
    // these hooks are exercised through React's real renderer, so `document`
    // and friends must exist. Every other package here runs `environment:
    // 'node'` — copying that default would fail at `document is not defined`
    // before a single assertion ran.
    environment: 'jsdom',
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
    ],
  },
});
