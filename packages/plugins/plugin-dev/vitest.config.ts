// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

// #3071/#3060: alias workspace deps to `src/` so the tests load regardless of
// whether upstream `dist/` has been built — same convention as
// plugin-hono-server. Without this, vitest resolves @objectstack/core through
// its package.json `exports` (dist), which on a fresh tree / CI runner may
// not exist yet.
import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
  },
  resolve: {
    alias: [
      // [#10112] `@objectstack/plugin-security` and the source graph it drags in.
      //
      // `dev-plugin.ts` boots the real SecurityPlugin through a dynamic
      // `await import('@objectstack/plugin-security')`, and
      // `dev-plugin-security-enforcement-warning.test.ts` deliberately leaves that
      // chain unmocked -- the real plugin's `init()`/`start()` phase split IS the
      // subject. Without these entries that import resolves through `exports` to
      // `dist/`, so the file's verdict was a function of build state: on an unbuilt
      // closure the whole file died at COLLECTION with `Failed to resolve entry for
      // package "@objectstack/plugin-security"` (`Test Files 1 failed` / `Tests no
      // tests`), and on a built-but-STALE closure it would have passed against the
      // old artifact silently -- the quiet failure `check:test-source-alias` exists
      // to make impossible.
      //
      // ⛔ The alias belongs HERE, never on the test's line-51 specifier. Measured:
      // rewriting line 51 to a source path leaves `dev-plugin.ts`'s dynamic import
      // still pointing at `dist/`, so the two diverge and line 51 pre-warms a copy
      // nothing uses -- bail #1 went 28ms -> 476ms on a built closure, re-arming the
      // clocked-window cost that #10115 / PR #10120 landed to remove. A config alias
      // covers BOTH specifiers because Vite resolves the whole module graph through
      // it, which is why one entry here beats an edit at either import site.
      //
      // Aliasing a dep to source imports its ENTIRE surface into this package's
      // resolution domain (see the gate's "Where the walk goes" note), so
      // plugin-security's own `formula` / `metadata-core` / `platform-objects`
      // imports have to be aliased too -- without them the failure merely MOVES
      // outward one package at a time.
      //
      // Subpaths precede the bare entry, and the FILE-shaped `./plugin` gets its own
      // rule ahead of the directory-shaped group: `platform-objects` publishes both
      // kinds, so a single `([a-z-]+)` rule of the sort `@objectstack/spec` can use
      // below would resolve `./plugin` to `…/src/plugin/index.ts`. The group
      // enumerates the directory-shaped subpaths for exactly that reason.
      { find: /^@objectstack\/platform-objects\/plugin$/, replacement: path.resolve(__dirname, '../../platform-objects/src/plugin.ts') },
      {
        find: /^@objectstack\/platform-objects\/(identity|pages|security|metadata|system|apps|audit|integration|metadata-translations)$/,
        replacement: path.join(path.resolve(__dirname, '../..'), 'platform-objects/src/$1/index.ts'),
      },
      { find: /^@objectstack\/platform-objects$/, replacement: path.resolve(__dirname, '../../platform-objects/src/index.ts') },
      { find: /^@objectstack\/plugin-security$/, replacement: path.resolve(__dirname, '../plugin-security/src/index.ts') },
      { find: /^@objectstack\/formula$/, replacement: path.resolve(__dirname, '../../formula/src/index.ts') },
      { find: /^@objectstack\/metadata-core$/, replacement: path.resolve(__dirname, '../../metadata-core/src/index.ts') },
      // Subpath BEFORE the bare package: `@objectstack/core` is a PREFIX match with a
      // FILE replacement, so without this entry it swallows the published `./logger`
      // subpath and resolves it to `…/core/src/index.ts/logger` — ENOTDIR at run time.
      // Pinned by the published-subpath rule in `scripts/check-test-source-alias.mjs`,
      // which derives the population from `@objectstack/core`'s own `exports` map.
      { find: /^@objectstack\/core\/logger$/, replacement: path.resolve(__dirname, '../../core/src/logger.ts') },
      { find: '@objectstack/core', replacement: path.resolve(__dirname, '../../core/src/index.ts') },
      // Subpath BEFORE the bare package, same prefix-match reason: `./node` is a
      // published subpath served by a FILE (`types/src/node.ts` — the node-only slice
      // the root export deliberately excludes), so the bare entry would resolve it to
      // `…/types/src/index.ts/node`. Same published-subpath rule pins it.
      { find: /^@objectstack\/types\/node$/, replacement: path.resolve(__dirname, '../../types/src/node.ts') },
      { find: '@objectstack/types', replacement: path.resolve(__dirname, '../../types/src/index.ts') },
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
      // Kept from the enumeration because the reasons outlive it: `security` is
      // reached transitively via `@objectstack/types` ([ADR-0105 D1] tenancy
      // posture) and `shared` via `@objectstack/core`'s plural→singular fold
      // (`pluralToSingular`, #7378). Neither is a reason to keep listing
      // namespaces by hand.
      {
        find: /^@objectstack\/spec\/([a-z-]+)$/,
        replacement: path.join(path.resolve(__dirname, '../..'), 'spec/src/$1/index.ts'),
      },
      { find: /^@objectstack\/spec$/, replacement: path.resolve(__dirname, '../../spec/src/index.ts') },
    ],
  },
});
