/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#9816 — the Reference Rail has ONE route, and this file is what
 * keeps the package saying so.
 *
 * ADR-0085 removed the per-object `detail` hints block; this package's own
 * CHANGELOG records that block — naming `showReferenceRail`,
 * `hideReferenceRail` and `hideRelatedTab` — as no longer consulted. A reader
 * who follows a text that still teaches it authors a key nothing reads: no
 * warning, no degradation, no rail. That text has now been corrected three
 * times (twice in the README under objectui#7998, once in
 * `buildDefaultPageSchema`'s own docblock here), which is why the correction
 * is no longer trusted to stay corrected.
 *
 * ## The two sides, and why each assertion picks one on purpose
 *
 * The subject of this card IS a comment, so the sides cannot be read the same
 * way:
 *
 * - **The retired route** is prose. It is asserted ABSENT over the raw text of
 *   every file in this package, comments included — a comment carrier is
 *   exactly the carrier that bit three times.
 * - **The synthesizer's own route** (`showReferenceRail` and its siblings)
 *   was deleted by objectstack#27055. It is asserted ABSENT over the source
 *   with whole-line comments STRIPPED, because the synthesizer keeps a note
 *   naming the deleted hints: over the raw text the assertion would fail on
 *   the note while the code was clean, and a stripper that silently kept the
 *   note would hide nothing. `scripts/__tests__/body-dialect-census.test.ts`
 *   carries the `readCode` helper this one follows.
 *
 * ## Boundary, stated rather than implied
 *
 * The sweep is this PACKAGE's files. `CHANGELOG.md` is excluded — it records
 * what was once true rather than what the tree now teaches — and THIS file is
 * excluded by its own path, because it must carry the retired spelling as a
 * fixture; the discriminator below re-derives that it is the only carrier, so
 * the exclusion cannot quietly grow.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, it, expect } from 'vitest';

/**
 * Rooted on THIS FILE, never on `process.cwd()` (objectui#7799): the package
 * and repo-root invocations have different cwds and would read different
 * trees. Bare `import.meta.url` taken apart by hand — the spelling PR #7796
 * landed and #7806 reused.
 */
const SELF_DEPTH_BELOW_REPO_ROOT = 5; // packages / plugin-detail / src / __tests__ / this file
const SELF_ABS = decodeURIComponent(new URL(import.meta.url).pathname);
const REPO_ROOT = SELF_ABS.split('/').slice(0, -SELF_DEPTH_BELOW_REPO_ROOT).join('/');
/** This file, addressed the way `git grep` prints it. */
const SELF = SELF_ABS.slice(REPO_ROOT.length + 1);

const PACKAGE = 'packages/plugin-detail';
const SUBJECT = `${PACKAGE}/src/synth/buildDefaultPageSchema.ts`;

/**
 * The retired route, as ONE pattern feeding both consumers — the tree sweep
 * (POSIX ERE, via `git grep -E`) and the docblock check (`RegExp`). Two
 * spellings of "the same" pattern is how one of them rots into a no-op.
 *
 * It keys on the `detail.`-SCOPED rail keys, so the live option
 * (`options.showReferenceRail`) and this package's i18n keys (`detail.save`)
 * are outside it by construction — the control below pins both exclusions.
 */
const RETIRED_ROUTE_SRC = 'detail\\.[A-Za-z0-9_]*([Rr]eferenceRail|[Rr]elatedTab)';
const RETIRED_ROUTE = new RegExp(RETIRED_ROUTE_SRC);

/** Read a tracked file, and prove the read landed or every assertion on it is vacuous. */
function sourceOf(rel: string): string {
  const path = join(REPO_ROOT, rel);
  expect(existsSync(path), `source not found at ${path}`).toBe(true);
  const text = readFileSync(path, 'utf8');
  expect(text.length, `${rel} read back empty`).toBeGreaterThan(0);
  return text;
}

/**
 * `sourceOf`, with whole-line comments removed — the code side.
 *
 * Only WHOLE-LINE comments go, so a `//` inside a string survives. This is the
 * helper `scripts/__tests__/body-dialect-census.test.ts` introduced after a
 * `toContain` over raw text stayed green with the implementation it named
 * ablated away, because a comment above that line quoted it.
 */
function codeOf(rel: string): string {
  return sourceOf(rel)
    .split('\n')
    .filter((line) => {
      const trimmed = line.trimStart();
      return !trimmed.startsWith('//') && !trimmed.startsWith('*') && !trimmed.startsWith('/*');
    })
    .join('\n');
}

/**
 * Files in this package matching `pattern`, read from the WORKING TREE.
 *
 * `--untracked` is deliberate: a rot arriving in a not-yet-committed file is
 * the case a contributor is standing in when this runs, and ignored paths stay
 * excluded either way.
 */
function packageFilesMatching(pattern: string): string[] {
  const res = spawnSync(
    'git',
    ['grep', '--untracked', '-lIE', '--', pattern, PACKAGE, `:(exclude)${PACKAGE}/CHANGELOG.md`],
    { cwd: REPO_ROOT, encoding: 'utf8' },
  );
  // git grep: 0 = matched, 1 = no match (a legitimate answer here), >1 = broken.
  expect([0, 1], `git grep failed: ${res.stderr}`).toContain(res.status);
  return res.stdout.split('\n').filter(Boolean);
}

describe('objectui#9816 — the retired `detail.`-scoped rail route stays out of this package', () => {
  it('no file in the package teaches it, and the sweep that says so is firing', () => {
    // CONTROL, in the same command shape and the same pathspec: a string this
    // package certainly carries. Without it the zero below is a dead grep —
    // a wrong pathspec, a wrong cwd and a clean tree all read identically.
    const control = packageFilesMatching('showReferenceRail');
    expect(control, 'the sweep reaches nothing — the zero below would be vacuous').toContain(SUBJECT);

    const offenders = packageFilesMatching(RETIRED_ROUTE_SRC).filter((f) => f !== SELF);
    expect(
      offenders,
      'a file teaches the ADR-0085-retired objectDef route — an author following it gets a silently inert key',
    ).toEqual([]);
  });

  it('DISCRIMINATOR — the sweep does find that spelling, in exactly one excluded file', () => {
    // If the pattern ever stops matching the thing it is about, the case above
    // goes green for the wrong reason. This file carries the spelling as its
    // own fixture, so the sweep must report it and nothing else.
    expect(packageFilesMatching(RETIRED_ROUTE_SRC)).toEqual([SELF]);
  });

  it('CONTROL — the pattern matches the retired spelling and neither of its true neighbours', () => {
    expect(RETIRED_ROUTE.test('(per object via `detail.showReferenceRail`)')).toBe(true);
    expect(RETIRED_ROUTE.test('`detail.hideReferenceRail`')).toBe(true);
    expect(RETIRED_ROUTE.test('`detail.hideRelatedTab`')).toBe(true);
    // The synthesizer's own (now deleted) option spelling is a different
    // pattern, pinned absent by the case below on the code side.
    expect(RETIRED_ROUTE.test('options.showReferenceRail === true &&')).toBe(false);
    // Nor this package's i18n keys, which are `detail.`-scoped for an
    // unrelated reason (`useDetailTranslation`).
    expect(RETIRED_ROUTE.test("t('detail.save')")).toBe(false);
  });
});

/**
 * objectstack#27055 (ADR-0085) deleted the synthesizer's own rail route too:
 * `showReferenceRail` / `hideReferenceRail` / `hideRelatedTab` and the
 * `rightRail` slot are gone from `BuildPageOptions`, so the rail's ONE route
 * is now an authored `record:reference_rail` node in an assigned page. The
 * code side of the synthesizer must therefore read no rail hint and emit no
 * rail node; the note that names the deleted hints is a comment, which is
 * why the assertion runs over the code side and the discriminator proves the
 * stripper removes that note.
 */
describe('objectstack#27055 — the synthesizer has no rail route of its own', () => {
  it('no code in the synthesizer reads a rail hint or emits a rail node', () => {
    const code = codeOf(SUBJECT);
    expect(code, 'the synthesizer reads a deleted rail hint again').not.toContain('showReferenceRail');
    expect(code, 'the synthesizer reads a deleted rail hint again').not.toContain('hideReferenceRail');
    expect(code, 'the synthesizer emits a reference rail again').not.toContain("'record:reference_rail'");
    expect(code, 'the synthesizer takes the deleted `rightRail` slot again').not.toContain('rightRail');
  });

  it('DISCRIMINATOR — the comment stripper really removes the note naming the deleted hints', () => {
    // Without this, the case above could pass because the stripper kept the
    // note and the note happened not to spell a hint the way it asserts.
    const raw = sourceOf(SUBJECT);
    expect(raw).toContain('`showReferenceRail`, `hideReferenceRail`, `hideRelatedTab`');
    expect(codeOf(SUBJECT)).not.toContain('`showReferenceRail`, `hideReferenceRail`, `hideRelatedTab`');
  });
});
