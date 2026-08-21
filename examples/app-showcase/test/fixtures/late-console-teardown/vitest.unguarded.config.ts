// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The ABLATION leg of `test/vitest-console-teardown-race.test.ts`.
 *
 * `disableConsoleIntercept: false` is vitest's own default, spelled out here
 * rather than left implicit: this config exists to state that the ONE variable
 * between the two legs is the guard, and to keep the leg honest if the default
 * ever changes upstream. It deliberately does not extend the app's real config
 * — the fixture imports nothing from the workspace, so the app's aliases and
 * excludes cannot affect the measurement, and re-exporting a config that reads
 * `__dirname` from a different directory would silently repoint them.
 */

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    disableConsoleIntercept: false,
  },
});
