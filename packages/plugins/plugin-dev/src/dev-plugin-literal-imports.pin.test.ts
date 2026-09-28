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
// happens on every call, not only the first. Measured with a throwaway vite
// plugin logging every `resolveId` and `transform` the main process served,
// around six back-to-back `init()`s with setup and account mocked absent:
//
//   - With the loop importing through `spec[0]` (`dev-plugin.ts` as of
//     `0fcb10184`), the six `init()`s made the main process serve 20
//     requests: a `resolveId` of `@objectstack/setup` and one of
//     `@objectstack/account` on EVERY `init()`, and on the first one also the
//     transform of both packages' `dist` entries and the resolution of their
//     imports. The mount-refusal suite's nine `init()`s made 18 of those
//     `resolveId`s.
//   - With literal specifiers, the same six `init()`s made ZERO. Every
//     specifier this file names, the twelve literal loads beside the loop
//     included, is resolved once, when the file is transformed at collection.
//   - The main process is one process shared by every worker in the run, so
//     a request to it waits on whatever it is doing for OTHER files. On
//     `Test Core (6/6)` (job 108779589417), the mount-refusal suite's first
//     case timed out at 5026 ms and its second took 2336 ms, while its other
//     four took 16-72 ms, in a package run that read `transform 74.29s,
//     import 137.46s, tests 11.87s`.
//
// So re-introducing a variable specifier puts a main-process round trip back
// into every clocked window that boots this plugin, whatever the suite. A
// timeout raised to absorb it would only move the cliff to the next heavier
// shard.
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
import { resolve } from 'node:path';

// `__dirname`, not `import.meta.url`: this package's build config compiles
// `src/**` as CommonJS, where `import.meta` is TS1470. Vitest's evaluator
// provides `__dirname` to every module it runs.
const HERE = __dirname;
const SOURCE = readFileSync(resolve(HERE, 'dev-plugin.ts'), 'utf8');

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
