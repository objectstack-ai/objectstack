/**
 * Pins `@object-ui/types`' `package.json` `exports` map to the shape its
 * bare-`tsc` build can actually produce (objectui#4896).
 *
 * ## The defect this guards against
 *
 * The shipped `exports["."].require` condition used to point at
 * `dist/index.cjs` — a file the package's `"build": "tsc"` script structurally
 * never emits (`tsc` alone writes `.js` + `.d.ts`, never `.cjs`; a second
 * output format needs a bundler or an explicit dual-emit step, and this
 * package has neither). Any CJS consumer resolving the `require` condition
 * therefore hit `MODULE_NOT_FOUND` against a published tarball that declared
 * an entry point it never shipped.
 *
 * Measured directly against a clean rebuild before this fix (`rm -rf dist
 * tsconfig.tsbuildinfo && tsc`): zero `.cjs` files under `dist/`, and
 * `require.resolve('.../packages/types/dist/index.cjs')` throws
 * `MODULE_NOT_FOUND`. The package declares `"type": "module"` and is
 * types-first (no bundler in its build), so ESM-only — dropping the dead
 * `require` condition rather than adding a second build format — is the
 * contract-honest fix; see the PR body for the full premise verification
 * (nothing in-repo `require()`s this package, and the one in-repo CJS-format
 * bundle consumer, `packages/vscode-extension` via `tsup --format cjs` with
 * `noExternal: ['@object-ui/types', ...]`, builds byte-identically with the
 * condition present or absent — it resolves the value imports it re-exports
 * via the `import` condition regardless of its own output format).
 *
 * ## What this test is, and is not
 *
 * This is a MANIFEST-level pin — it reads `package.json` as text and asserts
 * on its shape. It does NOT build the package or inspect `dist/`: this
 * repo's per-PR `test` job (`ci.yml`) runs `pnpm test` with no build step
 * ahead of it (turbo's `test` task only `dependsOn: ["^build"]` — the
 * DEPENDENCY closure, never the package's own build — see
 * `scripts/check-package-self-import.mjs`'s header for the same trap hitting
 * a different gate), so a test that required a fresh `dist/` to exist would
 * be vacuously absent-or-red on a cold CI cache, not a meaningful signal.
 * The artifact-level claim (a clean `tsc` build never emits `.cjs`) was
 * verified by hand for this fix and is not expected to regress silently: the
 * package's bare-`tsc` EMIT step and lack of any bundler/dual-emit step
 * are exactly the two other things this test pins, so a future edit that
 * reintroduces a `require` condition without ALSO reintroducing the emit step
 * would still need to touch this file's expectations to pass CI.
 *
 * The build script is read as a chain rather than as one string: its first
 * segment is the emit and must be bare `tsc`, and every later segment is
 * enumerated in the test, so non-emitting post-build checks can be added
 * without weakening any of the above. See that case for why.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, it, expect } from 'vitest';

const require = createRequire(import.meta.url);
const pkg = JSON.parse(
  readFileSync(require.resolve('../../package.json'), 'utf8'),
) as {
  type?: string;
  scripts?: Record<string, string>;
  exports?: Record<string, Record<string, string> | string>;
};

describe('@object-ui/types package.json exports map (objectui#4896)', () => {
  it('declares "type": "module" — the premise for an ESM-only exports map', () => {
    expect(pkg.type).toBe('module');
  });

  it('emits with bare tsc — no build step emits a second (CJS) format', () => {
    // If this ever changes to a bundler/dual-emit build, the `require`-less
    // exports map below should be revisited rather than assumed to still be
    // correct.
    //
    // ⭐ THAT REVISION HAS BEEN DONE, for the `vite build` step objectui#8598
    // added below. It is a lib-mode build with `formats: ['es']` — ONE format,
    // asserted by name in `zod-subpath-bundle-config-8598.test.ts` rather than
    // trusted here — writing a single file, `dist/zod/index.zod.js`, over the
    // one `tsc` already emitted at that path. It adds no output, no `exports`
    // entry and no `require` condition, so the map below is still correct for
    // the reason it always was. ⛔ A SECOND format arriving in that config is
    // what would reopen this question, and it reds that file, not this one.
    //
    // What that sentence pins is that NOTHING IN THE BUILD EMITS A SECOND
    // FORMAT. `toBe('tsc')` conflated it with the literal string, so appending
    // a post-build assertion that emits nothing at all (objectui#6703) turned
    // this red while the CJS question was untouched — a spelling too strict for
    // its own stated meaning.
    //
    // The chain is therefore split instead of compared whole. The EMITTING step
    // must be bare `tsc`; every other step is enumerated right here, so a
    // bundler — or any new step whatsoever — still cannot arrive without
    // editing this expectation and justifying it. That is exactly what the
    // header above asks for, and it is no weaker than the old spelling: both
    // fail on any change, this one just fails for the right reason.
    //
    // The first assertion is the same question `buildsWithTsc()` asks in
    // `scripts/check-dist-completeness.mjs`, RESTATED rather than imported:
    // this package's test program sets `allowJs: false` and includes only
    // `src/**/*.test.ts`, so importing that `.mjs` fails with TS7016 (measured,
    // not assumed). The duplication is structural — change one, change the
    // other.
    const steps = (pkg.scripts?.build ?? '').split('&&').map((step) => step.trim());
    expect(steps[0]).toBe('tsc');
    expect(steps.slice(1)).toEqual([
      // objectui#8598. ⛔ The ORDER is the contract, not a preference: `tsc`
      // writes all of `dist/` first, this step replaces exactly one of its
      // outputs in place, and the count then verifies `tsc`'s expected set is
      // still whole. Reversed, the count runs before the overwrite and stops
      // covering it.
      'vite build',
      'node ../../scripts/check-dist-completeness.mjs',
    ]);
  });

  it('the root "." export carries exactly {types, import} — no "require" condition', () => {
    const rootExport = pkg.exports?.['.'];
    expect(rootExport).toEqual({
      types: './dist/index.d.ts',
      import: './dist/index.js',
    });
  });

  it('no export condition anywhere in the map points at a bare-tsc build never emits (*.cjs)', () => {
    const offenders: string[] = [];
    for (const [subpath, conditions] of Object.entries(pkg.exports ?? {})) {
      if (typeof conditions === 'string') continue;
      for (const [condition, target] of Object.entries(conditions)) {
        if (typeof target === 'string' && target.endsWith('.cjs')) {
          offenders.push(`${subpath} -> ${condition}: ${target}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
