import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // A late console.* must not redden a green suite (#10374).
    // Mechanism + measured costs: examples/app-showcase/vitest.config.ts.
    // Enforced repo-wide by scripts/check-console-intercept-disarm.mjs.
    disableConsoleIntercept: true,
  },
});
