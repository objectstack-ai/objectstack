// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
  },
  resolve: {
    alias: [
      // #9457: ONE anchored rule for every `@objectstack/spec` namespace, in place
      // of the hand-maintained list of the subpaths this package's tests happened
      // to reach. A string `find` matches by PREFIX, so with a FILE replacement the
      // bare `@objectstack/spec` entry also swallowed every published namespace the
      // list had not reached — `cloud`, `integration` and `studio` among them — and
      // resolved it to `…/spec/src/index.ts/<ns>`: `ENOTDIR`, at run time, from a
      // config that reads as correct, naming whichever module performed the import
      // rather than this table.
      //
      // spec's export map is UNIFORM — every published namespace is
      // `src/<ns>/index.ts`, with no FILE-shaped subpath of the kind
      // `@objectstack/platform-objects/plugin` is — so one rule covers all of them
      // and cannot go stale as tests reach new namespaces. Same shape as
      // `packages/qa/downstream-contract` (PR #8129), `service-knowledge`,
      // `service-settings` and `plugin-audit`; `packages/runtime` carries the pin
      // over the rule (`src/spec-subpath-alias-coverage.pin.test.ts`).
      //
      // Kept from the enumeration because the reason outlives it: `security` is
      // reached transitively via `@objectstack/types` ([ADR-0105 D1] tenancy
      // posture). That is not a reason to keep listing namespaces by hand.
      {
        find: /^@objectstack\/spec\/([a-z-]+)$/,
        replacement: path.join(path.resolve(__dirname, '../..'), 'spec/src/$1/index.ts'),
      },
      { find: /^@objectstack\/spec$/, replacement: path.resolve(__dirname, '../../spec/src/index.ts') },
    ],
  },
});
