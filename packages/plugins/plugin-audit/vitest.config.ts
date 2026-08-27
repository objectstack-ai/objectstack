// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

// #3071: without these aliases, vitest resolves workspace deps through their
// package.json `exports` — i.e. `dist/` — so whether this package's tests
// even LOAD depends on turbo build ordering and cache-restore integrity on
// the runner (the deterministic zero-output CI failure). Aliasing to `src/`
// (the same convention plugin-hono-server et al. already use) removes the
// dist dependency entirely.
import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
  },
  resolve: {
    // Array form with ANCHORED patterns, deliberately — the same correction
    // `service-knowledge` recorded, arriving here for the same reason. The
    // object form matches by PREFIX, so the bare `@objectstack/spec` entry
    // swallowed every subpath not spelled out above it: `@objectstack/spec/ui`
    // resolved to `spec/src/index.ts/ui` and failed with `ENOTDIR`. That kept
    // the namespace list a thing every new import had to extend by hand, and
    // the failure landed on whoever added the import, naming a path nobody
    // wrote — which is exactly how it surfaced for #5860's real-engine test
    // (`@objectstack/objectql` reaches `@objectstack/spec/ui` transitively).
    // One rule for all namespaces cannot go stale that way.
    alias: [
      { find: /^@objectstack\/core$/, replacement: path.resolve(__dirname, '../../core/src/index.ts') },
      // [#10101] The shared platform-row resolver's home — aliased to source
      // so the suite's verdict is about the checkout, not metadata-core's
      // dist build state (`pnpm check:test-source-alias`).
      { find: /^@objectstack\/metadata-core$/, replacement: path.resolve(__dirname, '../../metadata-core/src/index.ts') },
      {
        find: /^@objectstack\/platform-objects\/audit$/,
        replacement: path.resolve(__dirname, '../../platform-objects/src/audit/index.ts'),
      },
      // [#12642] The i18n provenance seam. This package's translation barrel
      // passes its committed `<locale>.source-hashes.generated.ts` companions
      // through `withSourceFallback`, whose home is this subpath — so without
      // the alias the suite's verdict would be about `platform-objects/dist`
      // build state rather than the checkout (`pnpm check:test-source-alias`).
      {
        find: /^@objectstack\/platform-objects\/apps$/,
        replacement: path.resolve(__dirname, '../../platform-objects/src/apps/index.ts'),
      },
      // Covers `data` / `system` / `kernel` / `api` / `contracts` / `ui` /
      // `shared` and, [ADR-0105 D1], `security` reached transitively via
      // `@objectstack/types` (tenancy posture).
      {
        find: /^@objectstack\/spec\/([a-z-]+)$/,
        replacement: `${path.resolve(__dirname, '../../spec/src')}/$1/index.ts`,
      },
      { find: /^@objectstack\/spec$/, replacement: path.resolve(__dirname, '../../spec/src/index.ts') },
      { find: /^@objectstack\/types$/, replacement: path.resolve(__dirname, '../../types/src/index.ts') },
    ],
  },
});
