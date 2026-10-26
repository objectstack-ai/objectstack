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
 * - **The live route** is a read in code. It is asserted PRESENT over the
 *   source with whole-line comments STRIPPED, because this very file's subject
 *   is a docblock that spells `showReferenceRail` out: over the raw text the
 *   assertion would pass off the prose while the read it claims to find was
 *   gone. That shape was measured inside objectui#7181's repair — green before
 *   the ablation and green after it, invisible to the assertion's own result —
 *   and `scripts/__tests__/body-dialect-census.test.ts` carries the `readCode`
 *   helper this one follows.
 *
 * Each direction was ablated: restoring the retired parenthetical reddens the
 * absence pins, and deleting the live read reddens the presence pin while the
 * absence pins stay green (that green being the trap, made visible).
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
    // The LIVE option must never be caught by it — a pattern that did would
    // demand the deletion of the read this card exists to point at.
    expect(RETIRED_ROUTE.test('options.showReferenceRail === true &&')).toBe(false);
    // Nor this package's i18n keys, which are `detail.`-scoped for an
    // unrelated reason (`useDetailTranslation`).
    expect(RETIRED_ROUTE.test("t('detail.save')")).toBe(false);
  });
});

/** The docblock immediately above a member, re-derived rather than transcribed. */
function docblockAbove(source: string, member: string): string {
  const at = source.indexOf(`\n  ${member}`);
  expect(at, `member \`${member}\` not found — the docblock reader has nothing to read`).toBeGreaterThan(-1);
  const before = source.slice(0, at);
  const opens = before.lastIndexOf('/**');
  expect(opens, `no docblock above \`${member}\``).toBeGreaterThan(-1);
  const block = before.slice(opens);
  expect(block.trimEnd().endsWith('*/'), `the block above \`${member}\` is not a closed docblock`).toBe(true);
  return block;
}

describe('objectui#9816 — the `showReferenceRail` docblock, where the comment IS the subject', () => {
  it('names the ruling that removed the object-definition route, and no route it removed', () => {
    const block = docblockAbove(sourceOf(SUBJECT), 'showReferenceRail?: boolean;');
    // Landing proof: a block this reader failed to find would satisfy the two
    // assertions below by describing nothing.
    expect(block, 'the extracted block is not the Reference Rail docblock').toContain('Reference Rail');

    expect(
      RETIRED_ROUTE.test(block),
      'the docblock teaches a `detail.`-scoped route again — ADR-0085 removed the read',
    ).toBe(false);
    expect(block, 'the docblock no longer says what removed the objectDef route').toContain('ADR-0085');
  });

  it('the LIVE route is a read in code, not a sentence about one', () => {
    // Asserted over the code side on purpose — see this file's header.
    expect(
      codeOf(SUBJECT),
      'nothing reads `options.showReferenceRail` — the docblock now describes a route of its own',
    ).toContain('options.showReferenceRail');
  });

  it('DISCRIMINATOR — the comment stripper really removes the docblock this file is about', () => {
    // Without this, the case above could be reading the very prose it exists to
    // check, and would survive the read being deleted.
    const raw = sourceOf(SUBJECT);
    expect(raw).toContain('Opt in to the Reference Rail');
    expect(codeOf(SUBJECT)).not.toContain('Opt in to the Reference Rail');
  });
});
