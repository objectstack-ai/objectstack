// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeAll } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';

/**
 * #9457 — the alias table in `vitest.config.ts` must resolve EVERY published
 * `@objectstack/spec` subpath, not the ones today's tests happen to reach.
 *
 * ## What went wrong, and why a one-subpath test would not have caught it
 *
 * The table used to enumerate twelve subpaths by hand. Three published ones —
 * `cloud`, `integration` and `studio` — were missing, and a string `find`
 * matches by PREFIX, so with a FILE replacement the bare `@objectstack/spec`
 * entry swallowed each of them: `@objectstack/spec/cloud` resolved to
 * `…/spec/src/index.ts/cloud`. Measured on `origin/main` in this package:
 *
 *     Error: ENOTDIR: not a directory, open
 *       '…/packages/spec/src/index.ts/cloud'
 *
 * raised out of `MetadataPlugin._parseAndRegisterArtifact`, which does
 * `await import('@objectstack/spec/cloud')`. The error named the metadata
 * plugin; the defect was this table, one package away. That diagnostic distance
 * is the real cost, and it recurs for every subpath a hand-written list has not
 * reached yet — so this pin is written over the RULE (every published subpath
 * resolves into `spec/src`), never over `cloud`.
 *
 * ## The three axes, and why each is separate
 *
 *  1. **Resolution really happens** — every published subpath is `import()`ed,
 *     so this is Vite's own resolution rather than a re-implementation of it.
 *     This is the axis that fails with `ENOTDIR`.
 *  2. **It lands on SOURCE, not `dist`** — axis 1 alone would stay green with
 *     the alias table deleted outright, because the specifiers would then
 *     resolve through `exports` to `packages/spec/dist`, a build artifact (the
 *     #7668 / #7991 failure `pnpm check:test-source-alias` exists for). The
 *     discriminator is `@objectstack/spec/conversions`, which exists in the
 *     source tree and is deliberately absent from spec's `exports` map: through
 *     `exports` it is `ERR_PACKAGE_PATH_NOT_EXPORTED`, so it can only resolve
 *     through a source alias. The same discriminator
 *     `packages/qa/downstream-contract/test/source-resolution.pin.test.ts` uses.
 *  3. **The rule stays a rule** — the config's own alias array is read and
 *     Vite's first-match-wins resolution simulated over it, asserting the
 *     winning entry produces `…/spec/src/<namespace>/index.ts` and that no
 *     `@objectstack/spec` entry matches by prefix. This is the axis that goes
 *     red on a revert to the enumerated shape, rather than staying green until
 *     somebody reaches an unlisted namespace.
 *
 * The population for all three comes from `@objectstack/spec`'s published
 * `exports` map, read through node's own resolution of the dependency — never a
 * repo-relative path climbing out of this package, which is the read
 * `pnpm check:cross-package-test-inputs` exists to keep declared. An installed
 * dependency reached by its package specifier is covered by the ordinary
 * dependency edge instead.
 *
 * Both `import()` specifiers below are held in variables rather than written as
 * literals, deliberately: a literal is resolved by `tsc` as well as by Vite, and
 * this file sits inside the program `check:type-check-debt` re-measures. One
 * axis, one config — a vitest alias defect must not be able to surface as a type
 * error, nor to be masked by `tsconfig.json`.
 */

/** Vite normalizes an alias object into this array shape; the config uses it directly. */
interface AliasEntry {
  find: string | RegExp;
  replacement: string;
}

const require_ = createRequire(import.meta.url);

/** `@objectstack/spec`'s own `package.json`, resolved as a dependency rather than by path. */
const specPackageJson = require_('@objectstack/spec/package.json') as { exports: Record<string, unknown> };

const SPEC_SRC = path.join(path.dirname(require_.resolve('@objectstack/spec/package.json')), 'src');

/**
 * Every namespace subpath `@objectstack/spec` publishes.
 *
 * `.` is the bare entry (covered by its own case) and the `*.json` keys are data
 * files rather than namespaces — the anchored `([a-z-]+)` rule deliberately does
 * not match a key containing a dot, so those fall through to node resolution and
 * land on the real files instead of being mangled by a prefix match.
 */
const PUBLISHED_SUBPATHS = Object.keys(specPackageJson.exports)
  .filter((key) => key.startsWith('./') && !key.includes('.', 2))
  .map((key) => `@objectstack/spec/${key.slice(2)}`)
  .sort();

let aliasEntries: AliasEntry[];

beforeAll(async () => {
  const configModule = '../vitest.config.ts';
  const loaded = (await import(/* @vite-ignore */ configModule)) as { default?: { resolve?: { alias?: unknown } } };
  const alias = loaded.default?.resolve?.alias;
  if (!Array.isArray(alias)) {
    throw new Error('vitest.config.ts must use the ARRAY alias form — only it accepts a RegExp `find`.');
  }
  aliasEntries = alias as AliasEntry[];
});

/**
 * Resolve `specifier` the way Vite does: entries in order, FIRST MATCH WINS, a
 * string `find` replacing by PREFIX and a RegExp `find` by `String.replace`.
 * `null` means no entry matched — a real answer, not an error: it means the
 * specifier falls through to node resolution, i.e. to `dist`.
 */
function resolveThroughAlias(specifier: string): string | null {
  for (const entry of aliasEntries) {
    if (typeof entry.find === 'string') {
      if (specifier.startsWith(entry.find)) return specifier.replace(entry.find, entry.replacement);
    } else if (entry.find.test(specifier)) {
      return specifier.replace(entry.find, entry.replacement);
    }
  }
  return null;
}

describe('every published `@objectstack/spec` subpath resolves to spec SOURCE (#9457)', () => {
  it('finds a population to check — the guard on this guard', () => {
    // A short population would make every loop below pass vacuously, which is
    // the exact shape of the defect this file pins.
    expect(PUBLISHED_SUBPATHS.length).toBeGreaterThanOrEqual(15);
    // The three the hand-written enumeration had missed, named individually so
    // that a filter bug dropping them cannot be invisible.
    expect(PUBLISHED_SUBPATHS).toContain('@objectstack/spec/cloud');
    expect(PUBLISHED_SUBPATHS).toContain('@objectstack/spec/integration');
    expect(PUBLISHED_SUBPATHS).toContain('@objectstack/spec/studio');
  });

  // The explicit timeout is load-bearing rather than defensive. This case
  // transforms up to fifteen spec namespaces through Vite, and when it is the
  // first file in the run to reach one of them that is a cold transform:
  // measured at ~5.3s for the set, against vitest's 5000ms default. A default
  // timeout makes the case report `Test timed out in 5000ms` INSTEAD of the
  // resolution failure it exists to name — measured in both directions, so it
  // is a fault in both: flaky green-path noise when the file runs alone, and a
  // misleading diagnostic on the red path, which is precisely the
  // points-at-the-wrong-thing failure this card is about.
  it(
    'imports every one of them — real Vite resolution, not a simulation of it',
    async () => {
      const failures: string[] = [];
      for (const specifier of PUBLISHED_SUBPATHS) {
        try {
          expect(await import(/* @vite-ignore */ specifier)).toBeTypeOf('object');
        } catch (error) {
          failures.push(`${specifier}: ${(error as Error).message}`);
        }
      }
      expect(failures, 'published subpaths this vitest config cannot resolve').toEqual([]);
    },
    60_000,
  );

  it('resolves a namespace the published `exports` map does NOT publish', async () => {
    // `packages/spec/src/conversions/` exists in source and is deliberately
    // absent from the `exports` map, so this specifier can only arrive through
    // the source alias — through `exports` it is
    // `ERR_PACKAGE_PATH_NOT_EXPORTED`. That asymmetry is what makes it a real
    // source-vs-dist discriminator rather than a check that passes either way.
    const sourceOnlySubpath = '@objectstack/spec/conversions';
    const conversions = (await import(/* @vite-ignore */ sourceOnlySubpath)) as { CONVERSION_NOTICE_CODE?: unknown };

    expect(conversions.CONVERSION_NOTICE_CODE).toBeTypeOf('string');
  });

  it('maps every published subpath onto `spec/src/<namespace>/index.ts`, never dist', () => {
    for (const specifier of PUBLISHED_SUBPATHS) {
      const namespace = specifier.slice('@objectstack/spec/'.length);
      const target = resolveThroughAlias(specifier);

      expect(target, `${specifier} matches no alias entry, so it falls through to dist`).not.toBeNull();
      expect(target, `${specifier} does not resolve to spec/src/${namespace}/index.ts`).toBe(
        path.join(SPEC_SRC, namespace, 'index.ts'),
      );
    }
  });

  it('keeps the bare package entry on source too', () => {
    expect(resolveThroughAlias('@objectstack/spec')).toBe(path.join(SPEC_SRC, 'index.ts'));
  });

  it('refuses a `@objectstack/spec` entry that matches subpaths by prefix', () => {
    // The trap itself, pinned so that a revert to the enumerated shape is loud
    // here rather than silent until someone reaches an unlisted namespace. A
    // string `find` of `@objectstack/spec` swallows every subpath; a string
    // `find` of `@objectstack/spec/<ns>` is the enumeration this card removed.
    for (const entry of aliasEntries) {
      if (typeof entry.find !== 'string') continue;
      expect(
        entry.find.startsWith('@objectstack/spec'),
        `alias entry '${entry.find}' matches @objectstack/spec specifiers by PREFIX — anchor it instead`,
      ).toBe(false);
    }
  });
});
