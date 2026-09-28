// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #20376 — every dynamic `import()` in `dev-plugin.ts` names its package
// LITERALLY, except the one ADR-0132 requires to stay a variable.
//
// ## Why the FORM of the specifier is pinned
//
// Every suite in this family mocks the packages `DevPlugin.init()` loads, so
// `init()` should run in-process. For a literal `import('x')` it does: the
// specifier is rewritten when `dev-plugin.ts` is transformed, and the test's
// `vi.mock('x')` serves it inside the worker. A VARIABLE specifier is resolved
// at CALL time instead, by a round trip to the main vitest process, and that
// happens on every call, not only the first. Measured at `2f122b6e4`, before
// the fix:
//
//   - The setup / account app-package loop imported through `spec[0]`. Every
//     `init()` then made two main-process round trips, and the first `init()`
//     also made the main process transform both packages' `dist` entries. A
//     vite plugin logging the main process's requests showed exactly those
//     two per `init()`, and none for the twelve literal loads beside them.
//   - With 24 CPU-bound busy loops on 4 vCPU, those two round trips cost
//     44.5-102.0 ms per `init()`. A round-trip-free `init()` did 0.6-1.0 ms
//     of real work. That term made CI's clocked windows depend on what the
//     main process was doing for OTHER files. On `Test Core (6/6)` (job
//     108779589417), the mount-refusal suite's first two cases absorbed a
//     7.36 s stall, and the first one timed out at 5000 ms. Locally,
//     `dev-plugin-tenancy-failfast.test.ts` case 7 (eleven `init()`s) timed
//     out at 5048 ms.
//   - With literal specifiers, the same log shows ZERO main-process requests
//     in the test phase.
//
// So re-introducing a variable specifier puts a load-dependent term back into
// every clocked window that boots this plugin, whatever the suite. A timeout
// raised to absorb it would only move the cliff to the next heavier shard.
//
// ## The one exception
//
// `@objectstack/organizations` is imported through `organizationsPkg`, with
// `webpackIgnore`, on purpose: ADR-0132's entitlement boundary forbids any
// framework package from declaring it (`no-framework-dependents.pin.test.ts`),
// so no bundler may try to resolve it. In the suites that mock it, its mock
// URL is the raw specifier, so the worker serves it without a round trip.
//
// ## How it reads the file
//
// Off the source text, with comments masked first, so that prose mentioning
// `await import()` is not read as code. The lit control (③) proves the scan
// still sees literal loads, so a masking bug that hid every import cannot
// pass ① vacuously.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SOURCE = readFileSync(fileURLToPath(new URL('./dev-plugin.ts', import.meta.url)), 'utf8');

/**
 * The source with comments masked. Block comments go first. A `//` comment is
 * one that opens a line or follows whitespace, so a `://` inside a URL string
 * is not taken for one.
 */
const CODE = SOURCE
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .split('\n')
  .map((line) => line.replace(/(^|\s)\/\/.*$/, '$1'))
  .join('\n');

/** The trimmed argument text of every dynamic `import(…)` in the code. */
const DYNAMIC_IMPORT_ARGS = [...CODE.matchAll(/\bimport\s*\(([^)]*)\)/g)].map((m) => m[1].trim());

/** A single- or double-quoted string literal and nothing else. */
const LITERAL = /^(['"])[^'"]+\1$/;

describe('#20376 — dev-plugin.ts loads its packages through literal specifiers', () => {
  it('① every dynamic import names its package literally, except the organizations one', () => {
    const variable = DYNAMIC_IMPORT_ARGS.filter((arg) => !LITERAL.test(arg));
    expect(variable, 'a variable specifier costs a main-process round trip per call under vitest').toEqual([
      'organizationsPkg',
    ]);
  });

  it('② the exception is the ADR-0132 package, and nothing else hides behind that name', () => {
    expect(CODE.match(/\bconst organizationsPkg = '@objectstack\/organizations';/g) ?? []).toHaveLength(1);
  });

  it('③ lit control: the scan sees the setup / account loads, and the loads beside them, as literals', () => {
    for (const pkg of ['@objectstack/setup', '@objectstack/account', '@objectstack/objectql']) {
      expect(DYNAMIC_IMPORT_ARGS, pkg).toContain(`'${pkg}'`);
    }
  });
});
