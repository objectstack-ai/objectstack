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
import path from 'path';

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
  resolve: {
    // [#7865] `federated-anchor-provenance.dogfood.test.ts` imports the
    // provenance marker from `@objectstack/metadata-core` — alias it to SOURCE
    // so the pin is a verdict about the checkout, not about a build artifact
    // (`check-test-source-alias`; #7668 is what a dist-resolved pin costs).
    // Anchored array form on purpose: the object form matches by prefix and
    // would swallow subpath imports (the ENOTDIR trap the gate's header names).
    // Aliasing is graph-wide, so packages still loaded from dist (objectql,
    // plugin-security, …) resolve their own `@objectstack/metadata-core`
    // imports to this same single source instance rather than a second copy.
    alias: [
      {
        find: /^@objectstack\/metadata-core$/,
        replacement: path.resolve(__dirname, '../../metadata-core/src/index.ts'),
      },
    ],
  },
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
