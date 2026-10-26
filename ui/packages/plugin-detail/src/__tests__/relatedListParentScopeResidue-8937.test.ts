/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * objectui#8937 — the published texts objectui#8886 left behind, each pinned to
 * the thing it describes rather than to a transcription of it.
 *
 * Every pin RE-DERIVES on every run. A pin that hard-coded the sentence would
 * only assert that nobody edited the sentence, which is the failure mode these
 * defects already are: text that stayed put while the thing it described moved.
 *
 * ⚠️ Two of these pins read `@object-ui/core`'s `parent-scope` seam from a
 * plugin-detail test file, which is deliberate and is why it is said out loud:
 * objectui#8882 / PR objectui#9184 moved the arity compiler OUT of
 * `RelatedList.tsx` and into that seam while this card was in flight, taking
 * the false sentence with it. The pins follow the claim, not the package — and
 * the README half of the subject is still plugin-detail's own published text,
 * so this is the one file that can see both ends.
 *
 * ## Pin one — the shipped README's parent-scope claim, against the compiler
 *
 * `packages/plugin-detail/README.md` is in that package's `files[]`, so it
 * SHIPS. It used to say the node's `filter` is AND-combined with
 * `{ [relationshipField]: parentId }` full stop, which stopped being true when
 * objectui#7299 made the parent condition arity-dependent. The pin reads the
 * spellings out of `composeParentScopeFilter`'s own returned literal and
 * requires the README paragraph to name EXACTLY that set — both directions, so
 * the README cannot over-claim an operator the seam never composes either.
 *
 * ## Pin two — the divergence the seam records, against the installed spec
 *
 * The seam's header used to say `isMultiValueField` is "the same predicate the
 * driver that executes the query decides on", and `RelatedList.tsx` used to say
 * the equivalent. Neither is true: `driver-sql` gates the equality family on
 * its own storage question, which treats `multiple` as truthy on ANY type, so
 * the two rules disagree for a type OUTSIDE `MULTI_CAPABLE_TYPES` carrying
 * `multiple: true`.
 *
 * The DRIVER half cannot be imported here — it lives in objectstack's
 * `driver-sql`. What can be re-derived is the SPEC half, and it is the half
 * that moves: the likely settlement of objectstack#17469 is the spec admitting
 * these types, at which point the seam's list stops being a divergence and this
 * file reddens. The driver half is a constant for the cases listed — its rule
 * contains the disjunct "`multiple` is truthy", `true` for every
 * `multiple: true` def regardless of the type set beside it — so no import is
 * needed to know the driver answers "JSON column" for all of them.
 *
 * ## Pin three — a THIRD file may not relate the two sides without the citation
 *
 * The rework this file is part of exists because the claim was COPIED into a
 * new file rather than edited in place. Pins one and two judge the text where
 * it lives today and would both stay green through exactly that move, so the
 * sweep below is the one that would have caught it: every file in this tree
 * that names both the spec predicate and the driver must cite the card that
 * owns their disagreement.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

import {
  FieldType,
  MULTI_CAPABLE_TYPES,
  MULTI_OPTION_TYPES,
  isMultiValueField,
} from '@objectstack/spec/data';
import { describe, it, expect } from 'vitest';

/**
 * Rooted on THIS FILE, never on `process.cwd()` (objectui#7799): the package
 * and repo-root invocations have different cwds and would read different trees.
 * Bare `import.meta.url` taken apart by hand — `new URL(rel, import.meta.url)`
 * is rewritten by Vite into a dev-server URL that `fileURLToPath` rejects.
 */
const SELF_DEPTH_BELOW_REPO_ROOT = 5; // packages / plugin-detail / src / __tests__ / this file
const REPO_ROOT = decodeURIComponent(new URL(import.meta.url).pathname)
  .split('/')
  .slice(0, -SELF_DEPTH_BELOW_REPO_ROOT)
  .join('/');

/** Read a tracked file, and prove the read landed or every assertion on it is vacuous. */
function sourceOf(rel: string): string {
  const path = join(REPO_ROOT, rel);
  expect(existsSync(path), `source not found at ${path}`).toBe(true);
  const text = readFileSync(path, 'utf8');
  expect(text.length, `${rel} read back empty`).toBeGreaterThan(0);
  return text;
}

/** The one compiler of the parent-relationship condition (objectui#8882). */
const SEAM = 'packages/core/src/utils/parent-scope.ts';
/** The shipped text that describes what that compiler puts on the wire. */
const README = 'packages/plugin-detail/README.md';

// ── pin one: README ↔ the compiler it describes ──────────────────────────────

/** The object literal `composeParentScopeFilter` returns, as written. */
function composedLiteralBody(source: string): string {
  const fn = /export function composeParentScopeFilter\([\s\S]*?\n\}/.exec(source);
  expect(fn, `could not find composeParentScopeFilter in ${SEAM}`).not.toBeNull();
  const lit = /return \{([\s\S]*?)\};/.exec((fn as RegExpExecArray)[0]);
  expect(lit, 'could not find the returned condition literal').not.toBeNull();
  return (lit as RegExpExecArray)[1];
}

/** Query-DSL operators the parent condition composes, e.g. `$contains`. */
function composedOperators(body: string): string[] {
  return [...new Set(body.match(/\$[A-Za-z][A-Za-z0-9_]*/g) ?? [])].sort();
}

/**
 * Does the parent condition still have a BARE equality arm?
 *
 * Operator objects are stripped first, so `{ $contains: parentId }` cannot
 * masquerade as one — the question is whether `parentId` is ever placed on the
 * field key directly.
 */
function hasBareEqualityArm(body: string): boolean {
  return /:\s*parentId\s*(?:[,}]|$)/.test(body.replace(/\{[^{}]*\}/g, '').trim());
}

/** The blank-line-delimited README paragraph carrying the AND-combination claim. */
function parentScopeParagraph(readme: string): string {
  const hits = readme.split(/\n\s*\n/).filter((p) => p.includes('**AND-combined**'));
  expect(hits, 'expected exactly one README paragraph claiming the AND-combination').toHaveLength(1);
  return hits[0];
}

describe('objectui#8937 pin one — the shipped README states the condition the seam compiles', () => {
  it('names every operator the seam composes, and no operator it does not', () => {
    const body = composedLiteralBody(sourceOf(SEAM));
    const paragraph = parentScopeParagraph(sourceOf(README));

    const composed = composedOperators(body);
    // Landing proof: a body this extraction failed to read would make every
    // assertion below pass by describing nothing.
    expect(composed.length, 'the condition composes no operator at all — extraction likely missed').toBeGreaterThan(0);

    const claimed = [...new Set(paragraph.match(/\$[A-Za-z][A-Za-z0-9_]*/g) ?? [])].sort();
    expect(claimed, 'the README paragraph must name exactly the operators the seam composes').toEqual(composed);
  });

  it('names the equality spelling exactly when the seam still has a bare equality arm', () => {
    const body = composedLiteralBody(sourceOf(SEAM));
    const paragraph = parentScopeParagraph(sourceOf(README));
    const EQUALITY = '{ [relationshipField]: parentId }';

    expect(paragraph.includes(EQUALITY)).toBe(hasBareEqualityArm(body));
  });

  it('spells the membership form in full whenever the seam composes `$contains`', () => {
    const body = composedLiteralBody(sourceOf(SEAM));
    const paragraph = parentScopeParagraph(sourceOf(README));
    const MEMBERSHIP = '{ [relationshipField]: { $contains: parentId } }';

    expect(paragraph.includes(MEMBERSHIP)).toBe(composedOperators(body).includes('$contains'));
  });
});

// ── pin two: the seam's divergence list ↔ the installed spec ─────────────────

/** Comment prose, un-commented: leading ` * ` stripped, whitespace collapsed. */
function docblockProse(source: string): string {
  return source
    .split('\n')
    .map((line) => line.replace(/^\s*\*\s?/, ''))
    .join(' ')
    .replace(/\s+/g, ' ');
}

/** The field types the seam names as diverging, read back out of its header. */
function divergentTypesFrom(source: string): string[] {
  const match = /They diverge for[^(]*\(([^)]*)\)/.exec(docblockProse(source));
  expect(match, 'the seam no longer records a divergence set — pin two has nothing to judge').not.toBeNull();
  return [...((match as RegExpExecArray)[1].match(/`([a-z_]+)`/g) ?? [])].map((t) => t.replace(/`/g, ''));
}

describe('objectui#8937 pin two — the seam divergence is re-derived from the installed spec', () => {
  it('names real spec field types that the spec predicate still calls single-valued', () => {
    const types = divergentTypesFrom(sourceOf(SEAM));
    expect(types.length, 'expected the seam to name the diverging types').toBeGreaterThanOrEqual(3);

    for (const type of types) {
      expect(FieldType.safeParse(type).success, `${type} is not a spec field type`).toBe(true);
      expect(MULTI_CAPABLE_TYPES.has(type), `${type} joined MULTI_CAPABLE_TYPES`).toBe(false);
      expect(MULTI_OPTION_TYPES.has(type), `${type} joined MULTI_OPTION_TYPES`).toBe(false);
      // The spec half of the divergence. The driver half is its `multiple`
      // disjunct, which is `true` for each of these by construction.
      expect(isMultiValueField({ type, multiple: true }), `the spec now calls ${type} multi-valued`).toBe(false);
    }
  });

  it('CONTROL — the same predicate answers `true` where it should, so the cases above are not vacuous', () => {
    // Without this, a predicate stuck at `false` would satisfy every assertion
    // in the case above while asserting nothing about any divergence.
    expect(isMultiValueField({ type: 'lookup', multiple: true })).toBe(true);
    expect(isMultiValueField({ type: 'user', multiple: true })).toBe(true);
    expect(isMultiValueField({ type: 'multiselect' })).toBe(true);
  });

  it('points at the upstream card that owns which of the two rules is right', () => {
    expect(sourceOf(SEAM)).toContain('objectstack#17469');
  });
});

// ── pin three: relating the spec predicate to the driver obliges a citation ──

/**
 * The population: every tracked file under `packages` that mentions BOTH the
 * spec predicate and the driver, i.e. every place in this tree that relates the
 * two sides of the divergence. Each one must cite the card that owns which side
 * is right, so a fresh comment asserting they agree cannot land silently.
 *
 * ⚠️ Why the sweep is not for the retired SENTENCE. The obvious pin would grep
 * for the wording objectui#8886 and objectui#9184 each used. It was built that
 * way first and measured degenerate: the two corrections rephrase the claim
 * across a line break, a line-oriented grep therefore misses them, and the only
 * remaining match in the tree was the pattern string in this file matching
 * itself. A sweep whose sole carrier is its own pattern asserts nothing. This
 * one keys on the two SUBJECTS instead, which no rewording moves.
 *
 * Boundary, stated rather than implied: a file that discusses the divergence
 * without naming the driver in those words is outside the population, and
 * generated release history (`CHANGELOG.md`) is excluded because it records
 * what was once written rather than what the tree now claims.
 *
 * Enumeration and reading come from the SAME tree — the working tree — so the
 * population cannot be drawn from one source and the content from another
 * (AGENTS.md's enumeration-vs-read rule).
 */
function filesRelatingPredicateToDriver(): { carriers: string[]; predicateOnly: string[] } {
  const out = execFileSync('git', ['grep', '-l', '--', 'isMultiValueField', 'packages'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  const mentionsPredicate = out
    .split('\n')
    .filter(Boolean)
    .filter((rel) => !rel.endsWith('CHANGELOG.md'));
  const carriers: string[] = [];
  const predicateOnly: string[] = [];
  for (const rel of mentionsPredicate) {
    (/driver/i.test(sourceOf(rel)) ? carriers : predicateOnly).push(rel);
  }
  return { carriers, predicateOnly };
}

describe('objectui#8937 pin three — relating the predicate to the driver obliges the divergence citation', () => {
  it('cites objectstack#17469 in every file that relates the two sides', () => {
    const { carriers } = filesRelatingPredicateToDriver();

    // Landing proof: a sweep that matched nothing would pass while checking
    // nothing. Three is under the four carriers this tree has today, so the
    // number is an alarm rather than a census needing an edit per new file.
    expect(carriers.length, 'the sweep found almost no carrier — the enumeration has gone stale').toBeGreaterThanOrEqual(3);

    const uncited = carriers.filter((rel) => !sourceOf(rel).includes('objectstack#17469'));
    expect(
      uncited,
      'a file relates the spec predicate to the driver without citing the card that owns their divergence',
    ).toEqual([]);
  });

  it('DISCRIMINATOR — the driver filter narrows, so the citation demand is not made of every mention', () => {
    // Without this, a filter that matched every file would turn the case above
    // into "every file mentioning the predicate must cite objectstack#17469",
    // which is a different and wrong demand that would happen to be green.
    const { carriers, predicateOnly } = filesRelatingPredicateToDriver();
    expect(predicateOnly.length, 'the driver filter excluded nothing — it is a no-op').toBeGreaterThan(0);
    // `plugin-grid`'s wrapper names the spec predicate and the server-side
    // WRITE pipeline that shares it, and says nothing about the driver. It is
    // the nearest true neighbour of the retired claim, so it is the right file
    // to require on the excluded side.
    expect(predicateOnly).toContain('packages/plugin-grid/src/hooks/multiValueFields.ts');
    expect(carriers).not.toContain('packages/plugin-grid/src/hooks/multiValueFields.ts');
  });
});
