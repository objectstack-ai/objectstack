// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import path from 'path';

// Source aliases for the two workspace packages this package's tests read by
// VALUE. `src/kernel-cache.ts` reads a service's self-description from
// `@objectstack/spec/api`, the daily-quota cache pin boots a real
// `ObjectKernel` from `@objectstack/core`, and the `sms/test` copy pin reads
// the platform locale table from `@objectstack/spec/system`. Unaliased, both would follow the
// workspace link to the package's last build, so a pin about the source next
// to it would report on build state instead (`check:test-source-alias` is the
// gate; aliasing is its intended repair).
//
// Array form with anchored patterns, deliberately: the object form matches by
// PREFIX, so a bare `@objectstack/spec` key would swallow `@objectstack/spec/api`
// and resolve it to `spec/src/index.ts/api` (ENOTDIR).
export default {
  test: {
    // Late console writes must not redden a green suite (#10374) — see the
    // mechanism docblock in examples/app-showcase/vitest.config.ts. Enforced
    // by scripts/check-console-intercept-disarm.mjs.
    disableConsoleIntercept: true,
  },
  resolve: {
    alias: [
      { find: /^@objectstack\/core$/, replacement: path.resolve(__dirname, '../../core/src/index.ts') },
      { find: /^@objectstack\/spec\/api$/, replacement: path.resolve(__dirname, '../../spec/src/api/index.ts') },
      { find: /^@objectstack\/spec\/system$/, replacement: path.resolve(__dirname, '../../spec/src/system/index.ts') },
    ],
  },
};
