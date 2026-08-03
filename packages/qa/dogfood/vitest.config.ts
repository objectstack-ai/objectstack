// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Two projects, one suite (#3622 follow-up: dogfood boot-overhead surgery).
//
// Measured on this suite: test BODIES are ~61s of aggregate compute while
// per-file setup (TS module graph ~3.5s + kernel boot ~4.1s + hooks) is
// ~800s — ~93% of the gate's cost was booting the same app over and over.
//
// `shared-showcase` runs the files that boot the IDENTICAL plain showcase
// stack with `isolate: false`: files on the same worker share one module
// registry, so test/shared-showcase.ts memoizes ONE boot per worker instead
// of one per file. Eligibility rules live in that helper's header — files
// with custom boot options, /meta writes, org/BU mutation, exact-count
// assertions over shared objects, or process.env toggles stay isolated.
//
// `isolated` keeps vitest defaults (fresh fork registry per file) for
// everything else — fixture stacks, custom security/plugins, env-flag files.
import { defineConfig } from 'vitest/config';

// Files proven eligible for the worker-shared plain showcase stack.
const SHARED_SHOWCASE = [
  'test/form-self-auth.dogfood.test.ts',
  'test/showcase-agent-intersection.dogfood.test.ts',
  'test/showcase-agent-scope-ceiling.dogfood.test.ts',
  'test/showcase-anonymous-deny.dogfood.test.ts',
  'test/showcase-anonymous-deny-surfaces.dogfood.test.ts',
  'test/showcase-declarative-rbac-seeding.dogfood.test.ts',
  'test/showcase-permission-zoo.dogfood.test.ts',
  'test/showcase-private-owd.dogfood.test.ts',
  'test/showcase-public-read-owd.dogfood.test.ts',
  'test/showcase-readonly-when-parent.dogfood.test.ts',
  'test/showcase-search.dogfood.test.ts',
  'test/showcase-static-readonly.dogfood.test.ts',
  'test/two-doors-permission.dogfood.test.ts',
];

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'shared-showcase',
          include: SHARED_SHOWCASE,
          isolate: false,
        },
      },
      {
        test: {
          name: 'isolated',
          include: ['test/**/*.test.ts'],
          exclude: SHARED_SHOWCASE,
        },
      },
    ],
  },
});
