/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The browser `process` shim is SOURCE-ONLY — objectui#6809.
 *
 * ## What was wrong
 *
 * `src/global.d.ts` carried an ambient `declare const process: { env: {
 * NODE_ENV: string } }`, and `tsconfig.test.json` globs `src/**` + `/*.d.ts` in
 * for the ambient declarations its tests rely on. That project also sets
 * `"types": ["node"]`, so `@types/node` IS in the program — but the ambient
 * declaration does not AUGMENT the node global, it REPLACES it, and because
 * `@types/node` spells its module as `export = process` it also became what
 * `import process from 'node:process'` resolved to. All three obvious spellings
 * failed identically:
 *
 *     process.cwd()                                     TS2339
 *     import process from 'node:process';  process.cwd()      TS2339
 *     import nodeProcess from 'node:process'; nodeProcess.cwd()  TS2339
 *
 *     error TS2339: Property 'cwd' does not exist on type
 *                   '{ env: { NODE_ENV: string; }; }'
 *
 * Runtime was plain node in every case and all three worked — only the
 * declaration was wrong. The asymmetry is what cost real time: `packages/i18n`
 * tests read their ratchet baselines with the plain `join(process.cwd(), …)`
 * idiom, which simply did not compile one directory over. (Those reads are no
 * longer rooted at the cwd — objectui#7799 rerooted them at each test file's own
 * location — but the compile asymmetry above is what this file pins, and that is
 * unchanged.)
 *
 * ## Why the shim was NOT simply deleted
 *
 * Measured before choosing (`tsc --listFiles`, both projects): the SOURCE
 * project (`tsconfig.json`, which names no `types`) contains **zero**
 * `@types/node` files, while the TEST project contains 82. Five source sites
 * read `process.env.NODE_ENV`, and an ablation — the declaration removed, the
 * source project recompiled — turned it red with five `TS2591: Cannot find name
 * 'process'` across `renderers/basic/div.tsx`, `renderers/basic/span.tsx` and
 * `renderers/form/form.tsx`. The shim is load-bearing for the source. So it was
 * NARROWED, not removed: it moved to `src/browser-process-shim.d.ts` and
 * `tsconfig.test.json` names that one file in `exclude`.
 *
 * ## What this file pins, and how
 *
 * The compile-time half is THIS FILE COMPILING. `packages/components/
 * tsconfig.json` excludes tests, so `tsc --noEmit` says nothing about it —
 * `tsc -p tsconfig.test.json` (the second half of the package's `type-check`
 * script) is the only thing that reads it, and `process.cwd()` below is exactly
 * the spelling that failed. Put the shim back in `global.d.ts`, or drop the
 * `exclude`, and `type-check` goes red here. That is deliberate: a runtime
 * assertion cannot see this defect at all, because at runtime all three
 * spellings always worked.
 *
 * The runtime half guards the two ways the arrangement can be dismantled while
 * still compiling: deleting the shim outright (which breaks the SOURCE build,
 * a different project than the one that reads this file) and re-adding a
 * `process` declaration to the shared `global.d.ts`.
 */

import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { uiRoot } from '../../../../scripts/ui-root.mjs';

/**
 * The repo root, derived from THIS FILE's own location — never from
 * `process.cwd()` (objectui#7799).
 *
 * What stood here was `const REPO_ROOT = process.cwd();` under the comment
 * "Root-form Vitest only (`scripts/vitest-invocation-guard.mjs` rejects a
 * package-cwd run), so `process.cwd()` is the repo root". THAT PREMISE IS FALSE,
 * and objectui#7791 is where it was falsified: the guard rejects a run whose
 * VITEST root is not the repo root, and this package's own `test` script —
 * `vitest run --root ../.. packages/components/`, which is what
 * `pnpm --filter @object-ui/components test` and `turbo run test` both run — sets
 * that root correctly while leaving `process.cwd()` at `packages/components/`.
 * The guard passes and the cwd is the package. Measured on objectui#7799 with
 * cwd as the only variable: 5 passed from the repo root, 4 failed / 1 passed
 * from the package directory.
 *
 * Spelled in string operations, copying the landed precedent of objectui#7791
 * (PR #7796): `new URL(rel, import.meta.url)` is REWRITTEN by Vite into a
 * `http://localhost:3000/@fs/…` dev-server URL, so only bare `import.meta.url`
 * is read here and taken apart by hand.
 */
const SELF_DEPTH_BELOW_REPO_ROOT = 5; // packages / components / src / __tests__ / this file
const REPO_ROOT = decodeURIComponent(new URL(import.meta.url).pathname)
  .split('/')
  .slice(0, -SELF_DEPTH_BELOW_REPO_ROOT)
  .join('/');
const PKG = join(REPO_ROOT, 'packages/components');

const read = (rel: string): string => {
  const abs = join(PKG, rel);
  // A path that silently does not exist reads as an empty string and every
  // "does not contain" assertion below would pass vacuously — the one direction
  // this pin must not fail in.
  expect(existsSync(abs), `missing file: ${abs}`).toBe(true);
  return readFileSync(abs, 'utf8');
};

describe('browser `process` shim scope (objectui#6809)', () => {
  it('compiles the plain `process.cwd()` spelling the shim used to break', () => {
    // The assertion that matters is that this file TYPE-CHECKS: before the fix
    // this line was `TS2339: Property 'cwd' does not exist on type
    // '{ env: { NODE_ENV: string; }; }'`. The runtime check just proves the
    // binding is the real one rather than a compile-time fiction.
    const cwd: string = process.cwd();
    expect(typeof cwd).toBe('string');
    // The binding is the real node one rather than a compile-time fiction: it
    // names an absolute directory that exists. This was
    // `expect(existsSync(join(cwd, 'pnpm-workspace.yaml'))).toBe(true)`, which
    // asserted something else entirely — that cwd IS THE REPO ROOT. That holds
    // only under the repo-root invocation and is false under this package's own
    // `test` script (objectui#7799). The repo-root claim it was making is kept,
    // on the line below, rooted at this file instead of at the cwd; nothing is
    // dropped, and the `process.cwd()` call this test exists to compile is
    // still made and still checked.
    expect(isAbsolute(cwd)).toBe(true);
    expect(existsSync(cwd)).toBe(true);
    expect(REPO_ROOT).toBe(uiRoot());
  });

  it('sees node\'s process surface, not the two-property browser shim', () => {
    // `platform` and `versions.node` exist on `NodeJS.Process` and on neither
    // shape the shim could produce, so this is a second, independent spelling
    // of "the node global won".
    const platform: string = process.platform;
    const nodeVersion: string = process.versions.node;
    expect(platform.length).toBeGreaterThan(0);
    expect(nodeVersion.length).toBeGreaterThan(0);
  });

  it('keeps the shim — the SOURCE project has no `@types/node` and needs it', () => {
    const shim = read('src/browser-process-shim.d.ts');
    expect(
      /declare const process\s*:/.test(shim),
      'The browser `process` shim is load-bearing for this package\'s SOURCE ' +
        'project: `tsconfig.json` names no `types`, `@types/node` is not ' +
        'reachable from packages/components, and five source sites read ' +
        '`process.env.NODE_ENV`. Removing this declaration fails the SOURCE ' +
        'build with TS2591 — a different tsconfig project than the one that ' +
        'compiles this test, so nothing here would have caught it. See ' +
        'objectui#6809.'
    ).toBe(true);
  });

  it('keeps the shim out of `global.d.ts`, which BOTH projects read', () => {
    const shared = read('src/global.d.ts');
    expect(
      /declare (const|var|let)\s+process\b/.test(shared),
      '`src/global.d.ts` is globbed into `tsconfig.test.json` as well as the ' +
        'source project, so a `process` declaration here REPLACES the real node ' +
        'global that `types: ["node"]` provides — reintroducing objectui#6809. ' +
        'Source-only ambients belong in `src/browser-process-shim.d.ts`.'
    ).toBe(false);
  });

  it('pins the `exclude` that makes the shim source-only', () => {
    const testProject = read('tsconfig.test.json');
    expect(
      testProject.includes('"exclude": ["src/browser-process-shim.d.ts"]'),
      '`tsconfig.test.json` must exclude `src/browser-process-shim.d.ts`. Its ' +
        '`include` globs `src/**/*.d.ts`, so without the exclusion the ' +
        'source-only shim is back in the test program and objectui#6809 ' +
        'returns. Dropping it also turns this file red at compile time; this ' +
        'assertion is here to name the cause in one line.'
    ).toBe(true);
  });
});
