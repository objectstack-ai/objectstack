// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    environment: 'node',
  },
  resolve: {
    // `share-link-eligibility.test.ts` (#7861) drives the real `SqlDriver` on
    // better-sqlite3 `:memory:` so the eligibility gate's acceptance evidence
    // is end-to-end rather than a verdict about a hand-written double. That
    // import is a VALUE import, and `@objectstack/driver-sql` resolves through
    // its `exports` to `dist/` — so without this alias the suite would be
    // judging driver-sql's BUILD ARTIFACT rather than the source in the
    // checkout.
    //
    // The dangerous half is not a loud error. A dist merely BEHIND rather than
    // missing a symbol lets these pins run GREEN against driver-sql's old
    // behaviour, with nothing in the output saying so — which for a test whose
    // whole job is to prove an ineligible share link is never MINTED would be
    // a security pin quietly reporting on the wrong tree.
    //
    // Turbo already orders `test` after `^build`, so `turbo run test` was never
    // the exposed path. The exposed ones are `pnpm test` inside this package,
    // `vitest run <file>`, an editor runner, or an agent in a tree built at an
    // older commit — exactly how these pins get re-run while someone is
    // changing the driver.
    //
    // Array form with an anchored pattern, deliberately: the OBJECT form
    // matches by prefix, so a bare `@objectstack/driver-sql` key would also
    // swallow any subpath and resolve it to `…/src/index.ts/<subpath>`
    // (ENOTDIR) — a config that looks right and fails at run time. Same shape
    // as `service-storage`'s and `service-knowledge`'s.
    //
    // `@objectstack/metadata-core` (#7858) is on the same footing, and reaches
    // the tests two ways: `federated-phantom-owner-scoping.test.ts` imports
    // `OWNER_FIELD_DEF` to build its fixture, and `federated-phantom-anchors.ts`
    // — pulled in transitively by `sharing-service.ts` — imports the same
    // constant to compare against. That constant IS the provenance test's
    // subject: it decides whether a federated object's `owner_id` is the
    // platform's injected anchor or a column its author declared. Resolved from
    // `dist/`, a stale copy would move the verdict without moving the assertion
    // — the guard would answer about a definition that is no longer shipped,
    // and stay green while doing it.
    alias: [
      { find: /^@objectstack\/driver-sql$/, replacement: path.resolve(__dirname, '../../drivers/driver-sql/src/index.ts') },
      { find: /^@objectstack\/metadata-core$/, replacement: path.resolve(__dirname, '../../metadata-core/src/index.ts') },
    ],
  },
});
