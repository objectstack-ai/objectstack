// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// One collection coercion, in one place (#15636).
//
// A stack collection is authored either as a list or as a name-keyed map, so
// every rule that reads one has to coerce `unknown` into `AnyRec[]` first. That
// coercion is ONE decision — what to do with a member that is not a record —
// and `recordsOf` in `object-graph.ts` is where it is made: a non-record member
// of the ARRAY shape is dropped whole (it carries no key, so it is nothing at
// all), while the map shape keeps the author's key and drops only its
// unreadable body. Its docblock argues both branches; this file only pins that
// the decision has one home.
//
// ## Why a source-text gate and not a code review
//
// The decision had 40 homes. #15494 guarded the seam every field-path rule
// opens with, and re-measuring the whole `AUTHORING_RULES` table over
// `{ objects: [null, validObject] }` still counted 13 of 42 rules throwing,
// through eleven more reader sites — every one of them a hand-copied `asArray`
// whose array branch was spelled `return v as AnyRec[]`, unchecked. #15552
// re-pointed the `stack.objects` readers; #15636 re-pointed 22 more, one per
// collection family (`flows`, `pages`, `dashboards`, `datasets`, `apps`,
// `permissions`, `capabilities`, `data`, `hooks`, `views`, `actions`,
// `translations`, and the per-object sub-collections).
//
// The 39 copies were not identical, which is the part worth pinning. Twelve had
// already grown the array-branch filter LOCALLY, in two different spellings;
// four more read only the list shape and lean on an `if (!page) continue` three
// lines down; and two are load-bearing for a finding PATH rather than for a
// crash. A fix applied to some copies and not their siblings is the whole
// failure mode restated as evidence: a predicate with N copies is N chances to
// fix one and leave N-1, and no reviewer counts to 39. So the count is asserted
// here instead.
//
// ## The three clauses, and what each one refuses
//
//  1. `object-graph.ts` declares exactly one such coercion, named `recordsOf`.
//     Without this the other two clauses could pass over a package that had
//     lost the canonical one entirely.
//  2. Every OTHER module declaring one is in `COPY_LEDGER`. This is the ratchet
//     and it is exact in BOTH directions: a new copy fails because it is not
//     listed, and a copy that has been re-pointed fails because its ledger row
//     is now a lie. The ledger may only shrink, and shrinking it is one line.
//  3. No coercion carries the UNCHECKED array branch — the spelling that
//     actually crashes — outside `UNGUARDED_ALLOWANCE`. Clause 2 alone would let
//     a re-introduced copy through as long as someone added a ledger row; clause
//     3 is what refuses the defect itself regardless of bookkeeping.
//
// Both allowances are DATED and name the change that deletes them, and both are
// exact in both directions: the day an allowed file is re-pointed, this test
// fails until its row goes, so an allowance cannot outlive its reason by being
// forgotten. That is load-bearing, not decoration — `validate-chart-bindings.ts`
// was carried in both lists for one change, #15741 re-pointed it, and both of
// its rows came out because this test went red, not because anyone remembered.
//
// Scope: `src/*.ts` excluding tests. A coercion inside a test file is a fixture,
// not a reader, and no tenant stack reaches it.
import { readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC_DIR = dirname(fileURLToPath(import.meta.url));
const SELF = basename(fileURLToPath(import.meta.url));

/**
 * A local collection coercion, matched by SHAPE rather than by name: a
 * module-level `(v: unknown) => AnyRec[]`, in either the `function` or the
 * arrow spelling. Matching the shape and not the identifier `asArray` is what
 * makes clause 2 hold against a copy that renames itself.
 */
const COERCION =
  /(?:function\s+(\w+)\s*\(\s*v:\s*unknown\s*\)\s*:\s*AnyRec\[\]|const\s+(\w+)\s*=\s*\(\s*v:\s*unknown\s*\)\s*:\s*AnyRec\[\])/g;

/**
 * The array branch that crashes: `Array.isArray` proves it is a LIST and the
 * cast then asserts every MEMBER is a record, which a list out of YAML does not
 * promise. The back-reference keeps this to a cast of the same binding that was
 * just tested, and the test below is applied to a coercion's own body — never
 * to a whole file, or every inline `x as AnyRec[]` a rule writes for a field it
 * has already narrowed would answer for this predicate.
 */
const UNCHECKED_ARRAY_BRANCH = /Array\.isArray\((\w+)\)\s*\)?\s*(?:return|\?)\s*\(?\s*\1\s+as\s+AnyRec\[\]/;

/** Where the one coercion lives. */
const CANONICAL_MODULE = 'object-graph.ts';
const CANONICAL_NAME = 'recordsOf';

/**
 * Modules still holding a private copy, each with the issue that removes it.
 * Rows may be DELETED as copies are re-pointed and must never be added: a new
 * entry here is a new copy of the predicate, which is the defect this file
 * exists to refuse. Every row is asserted to still be true below.
 */
const COPY_LEDGER: Readonly<Record<string, string>> = {
  // 2026-09-05 — the two reference-integrity members #15494 deliberately left
  // walking the RAW array. Their own loop guards each member with `isRec`, so
  // neither ever threw; what the copy buys them is the INDEX, because
  // `reference-integrity-suite.test.ts` pins their finding paths
  // (`objects[1].highlightFields[1]`) against the author's file and `recordsOf`
  // renumbers past a dropped member. Re-pointing them is blocked on an
  // index-preserving reader, not on anyone's attention (#15740).
  'validate-object-field-refs.ts': '#15740',
  'validate-list-view-field-refs.ts': '#15740',
  // 2026-09-05 — the sixteen copies that do not crash today: twelve grew a
  // local array-branch filter and four read only the list shape behind a
  // call-site `if (!page) continue`. They are not #15636's defect; they are its
  // cause, and re-pointing them is bookkeeping this ledger now forces.
  'validate-action-body-writes.ts': '#15728',
  'validate-ai-agent-authoring.ts': '#15728',
  'validate-ai-surface-affinity.ts': '#15728',
  'validate-ai-tool-references.ts': '#15728',
  'validate-flow-node-writes.ts': '#15728',
  'validate-hook-body-writes.ts': '#15728',
  'validate-jsx-pages.ts': '#15728',
  'validate-nav-object-servability.ts': '#15728',
  'validate-nav-target-refs.ts': '#15728',
  'validate-page-source-styling.ts': '#15728',
  'validate-page-visualization-bindings.ts': '#15728',
  'validate-react-page-props.ts': '#15728',
  'validate-react-pages.ts': '#15728',
  'validate-readonly-action-writes.ts': '#15728',
  'validate-rule-compilability.ts': '#15728',
  'validate-view-page-refs.ts': '#15728',
};

/**
 * The coercions still spelling the array branch unchecked, dated and named by
 * the change that removes each. What remains is unchecked at the COERCION and
 * guarded at the CALL SITE — the two reference-integrity members re-test every
 * member with `isRec` inside their loop, and the four page walks skip on
 * `if (!page) continue` three lines down — so a junk member costs none of them
 * anything today. That is a guard standing somewhere the reader does not
 * promise it, which is why they are allowed rather than accepted: each is still
 * a copy of a predicate that has a home, and none may grow a sibling.
 */
const UNGUARDED_ALLOWANCE: Readonly<Record<string, string>> = {
  // 2026-09-05 — removed by #15740, which needs an index-preserving reader
  // first; both guard every member with `isRec` at the call site.
  'validate-object-field-refs.ts': '#15740',
  'validate-list-view-field-refs.ts': '#15740',
  // 2026-09-05 — removed by #15728.
  'validate-jsx-pages.ts': '#15728',
  'validate-page-source-styling.ts': '#15728',
  'validate-react-page-props.ts': '#15728',
  'validate-react-pages.ts': '#15728',
};

/** Every rule/reader module — tests excluded, this file excluded. */
const modules = (): string[] =>
  readdirSync(SRC_DIR)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && !f.endsWith('.d.ts') && f !== SELF)
    .sort();

const read = (file: string): string => readFileSync(join(SRC_DIR, file), 'utf8');

/**
 * One coercion's own body: from its declaration to the first line-initial `}`
 * (the `function` form), capped at twelve lines (the arrow form is one
 * statement, and no spelling of this helper in the package runs longer).
 */
const bodyAt = (src: string, index: number): string => {
  const window = src.slice(index).split('\n').slice(0, 12);
  const close = window.findIndex((line, i) => i > 0 && line === '}');
  return (close >= 0 ? window.slice(0, close + 1) : window).join('\n');
};

/** The coercions a module declares, by name. */
const coercionsIn = (file: string): string[] =>
  [...read(file).matchAll(COERCION)].map((m) => m[1] ?? m[2]);

/** Whether any coercion this module declares casts its array branch unchecked. */
const castsUnchecked = (file: string): boolean => {
  const src = read(file);
  return [...src.matchAll(COERCION)].some((m) => UNCHECKED_ARRAY_BRANCH.test(bodyAt(src, m.index ?? 0)));
};

describe('one collection coercion, in one place (#15636)', () => {
  /**
   * The floor first: a scan that found nothing would satisfy every assertion
   * below vacuously. A reading under 50 means the discovery changed, not the
   * package.
   */
  it('reads the rule modules it claims to scan', () => {
    expect(modules().length).toBeGreaterThanOrEqual(50);
    expect(modules()).toContain(CANONICAL_MODULE);
  });

  it(`declares the coercion once, as \`${CANONICAL_NAME}\` in \`${CANONICAL_MODULE}\``, () => {
    expect(coercionsIn(CANONICAL_MODULE)).toEqual([CANONICAL_NAME]);
  });

  it('holds no copy that the ledger does not name', () => {
    const unlisted = modules()
      .filter((f) => f !== CANONICAL_MODULE && coercionsIn(f).length > 0)
      .filter((f) => !(f in COPY_LEDGER));
    expect(
      unlisted,
      `${unlisted.join(', ')} declares its own \`(v: unknown) => AnyRec[]\`. Read the collection ` +
        `through \`recordsOf\` from './object-graph.js' instead — a second copy of this predicate ` +
        `is a second place to forget the non-record filter (#15636).`,
    ).toEqual([]);
  });

  it('names no copy the ledger has outlived', () => {
    const stale = Object.keys(COPY_LEDGER)
      .sort()
      .filter((f) => coercionsIn(f).length === 0);
    expect(
      stale,
      `${stale.join(', ')} no longer declares a private coercion. Delete its COPY_LEDGER row — ` +
        `a ledger that outlives its subject stops describing the package and starts excusing it.`,
    ).toEqual([]);
  });

  it('carries no unchecked array branch outside the dated allowance', () => {
    const offenders = modules()
      .filter((f) => castsUnchecked(f))
      .filter((f) => !(f in UNGUARDED_ALLOWANCE));
    expect(
      offenders,
      `${offenders.join(', ')} casts an array to \`AnyRec[]\` without filtering its members. ` +
        `A YAML list item left empty deserialises to \`null\`, and the next property read throws ` +
        `out of a rule that is contractually \`(stack) => Finding[]\` (#15636). Use \`recordsOf\`.`,
    ).toEqual([]);
  });

  it('allows no unchecked branch the allowance has outlived', () => {
    const stale = Object.keys(UNGUARDED_ALLOWANCE)
      .sort()
      .filter((f) => !castsUnchecked(f));
    expect(
      stale,
      `${stale.join(', ')} no longer casts unchecked. Delete its UNGUARDED_ALLOWANCE row — the ` +
        `allowance was dated to the change that removes it, not granted to the file.`,
    ).toEqual([]);
  });
});
