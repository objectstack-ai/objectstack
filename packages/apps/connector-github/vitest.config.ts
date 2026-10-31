// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // A late console.* must not redden a green suite: the boot test starts a
    // whole kernel, whose logger can write after teardown. Mechanism and
    // measured costs: examples/app-showcase/vitest.config.ts; enforced
    // repo-wide by scripts/check-console-intercept-disarm.mjs.
    disableConsoleIntercept: true,
  },
});
