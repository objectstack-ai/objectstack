/**
 * The README's BUILT-IN LOCALE COUNT, derived instead of restated
 * (objectui#7989).
 *
 * ## What this stops
 *
 * `packages/i18n/README.md` claimed **11** built-in locales in the two places a
 * reader looks first — the one-line description and the feature bullet — while
 * the package has shipped **10** for as long as the locale set has been settled.
 * The same document reasons correctly on **ten** six times further down ("the
 * other nine are separate chunks", "all ten codes", "of the ten packs"), which
 * is the signature of a number that was written once and never re-derived.
 *
 * ⛔ Correcting the two numbers is not the repair. A RESTATED number is the
 * construct that permits the error, and it has already been corrected once in
 * isolation without stopping the next instance: objectui#3351 fixed the same
 * off-by-one in a changeset file ("eleven locale packs — the repo has ten") and
 * nobody swept the README. So this pin makes the count DERIVED: the README's
 * number is read off the document and compared against what the package
 * actually exports, and the next pack to land or leave reds this test instead
 * of rotting the prose.
 *
 * ## Two instruments, because one of them moved
 *
 * The card measured the count as `Object.keys(builtInLocales).length` off the
 * package ENTRY. That import no longer exists: objectui#7479 removed the
 * `builtInLocales` re-export from `./index.js` precisely because an object
 * literal naming ten catalogue modules is the one shape no bundler can shake.
 * What a consumer of the entry gets today is `BUILT_IN_LANGUAGE_CODES`, which
 * enumerates the same packs at zero payload, and the all-ten map is behind the
 * published `@object-ui/i18n/locales` subpath.
 *
 * Both are asserted, and they are asserted to AGREE. The agreement leg is the
 * one that matters: a pack added to `./locales/index.ts` but never registered,
 * or registered but never exported, moves one instrument and not the other, and
 * a README pinned to only one of them would keep reporting green over a package
 * that disagrees with itself.
 *
 * ⛔ Deliberately NOT a third instrument: the number of `.ts` files under
 * `src/locales/`. That directory holds 13 files and 10 of them are packs —
 * `index.ts`, `registry.ts` and `rtl.ts` are not locales. A re-derivation that
 * counts files reproduces the very error this pin exists to stop, and the count
 * of non-pack files in there has already grown from one to three.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { BUILT_IN_LANGUAGE_CODES } from '../index.js';
import { builtInLocales } from '../locales/index.js';

// Root the read on THIS FILE, never on `process.cwd()` — the package-level and
// repo-root vitest invocations have different working directories and the same
// assertion would otherwise read two different trees (AGENTS.md).
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const README = readFileSync(path.join(repoRoot, 'packages/i18n/README.md'), 'utf8');

describe('the built-in locale count the README states', () => {
  const codes = [...BUILT_IN_LANGUAGE_CODES];

  it('is the same number on both published doors', () => {
    expect(Object.keys(builtInLocales).sort()).toEqual(codes.slice().sort());
    expect(Object.keys(builtInLocales)).toHaveLength(codes.length);
  });

  it('is what the one-line description restates', () => {
    const match = README.match(/^Internationalization for Object UI — (\d+) built-in locales,/m);
    expect(match, 'the description line no longer has the shape this pin reads').not.toBeNull();
    expect(Number(match?.[1])).toBe(codes.length);
  });

  it('is what the feature bullet restates', () => {
    const match = README.match(/^- 🌍 \*\*(\d+) Built-in Locales\*\* - (.+)$/m);
    expect(match, 'the feature bullet no longer has the shape this pin reads').not.toBeNull();
    expect(Number(match?.[1])).toBe(codes.length);
  });

  it('is how many languages the feature bullet actually enumerates, with no hedge', () => {
    // The bullet used to end in "and more" while already naming every pack. A
    // hedge on a complete list is false in its own right, and it is what let
    // the number in front of it drift unchallenged.
    const match = README.match(/^- 🌍 \*\*\d+ Built-in Locales\*\* - (.+)$/m);
    const enumerated = (match?.[1] ?? '').split(', ').filter(Boolean);
    expect(enumerated).toHaveLength(codes.length);
    expect(enumerated).not.toContain('and more');
  });
});
