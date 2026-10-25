// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#13082 — the RLS editor asks `@objectstack/lint`'s
 * `validateRlsPredicateEnforceability` for EVERY clause that parses, not only
 * for one the runtime cannot lower, so a lowerable predicate the publish door
 * refuses on what it POINTS AT is refused here too: at the rule's severity, in
 * the rule's words.
 *
 * Every expected finding below is read from the published rule at call time
 * (a one-clause stack, the same input the editor builds); no message is written
 * in this file. Which passes the editor carries and which stay at the publish
 * door, and why, is `rlsPredicateVerdict`'s docblock in `celAuthoring.ts`.
 */

import { describe, it, expect } from 'vitest';
import { lintCelPredicate } from './celAuthoring';
import { isSupportedRlsExpression } from '@objectstack/formula';
import {
  validateRlsPredicateEnforceability,
  RLS_PREDICATE_UNENFORCEABLE,
  RLS_PREDICATE_UNKNOWN_FIELD,
  RLS_PREDICATE_UNKNOWN_USER_VARIABLE,
} from '@objectstack/lint';

const HINT = { objectName: 'account', fields: ['organization_id', 'owner_id', 'status', 'amount'] };
const CLAUSES = ['using', 'check'] as const;
type Clause = (typeof CLAUSES)[number];

/** The rule's verdict on the editor's input: one clause, no object. */
const ruleOn = (clause: Clause, source: string) =>
  validateRlsPredicateEnforceability({ permissions: [{ rowLevelSecurity: [{ [clause]: source }] }] });

describe('celAuthoring · the RLS rule judges a lowerable clause too (objectui#13082)', () => {
  // The card's predicate: it lowers, so the shape pass has nothing to say,
  // and the reference pass refuses it.
  for (const clause of CLAUSES) {
    it(`rates ${clause.toUpperCase()} \`current_user.nope == owner_id\` the rule's unknown-user-variable error`, async () => {
      const source = 'current_user.nope == owner_id';
      expect(isSupportedRlsExpression(source)).toBe(true);
      const findings = ruleOn(clause, source);
      expect(findings.map((f) => [f.rule, f.severity])).toEqual([[RLS_PREDICATE_UNKNOWN_USER_VARIABLE, 'error']]);
      expect(await lintCelPredicate(source, { ...HINT, clause })).toEqual([
        { severity: 'error', message: findings[0].message },
      ]);
    });

    it(`CONTROL — ${clause.toUpperCase()} \`owner_id == current_user.id\` stays clean`, async () => {
      expect(ruleOn(clause, 'owner_id == current_user.id')).toEqual([]);
      expect(await lintCelPredicate('owner_id == current_user.id', { ...HINT, clause })).toEqual([]);
    });
  }

  // The rule's other verdicts on a lowerable clause that read the clause and
  // nothing else: a `current_user` value of the wrong type for its position,
  // and a comparand the shared filter faces refuse.
  for (const [label, source] of [
    ['a membership set where one value belongs', 'owner_id == current_user.org_user_ids'],
    ['one value where a set belongs', 'owner_id in current_user.id'],
    ['the whole caller context where a set belongs', 'status in current_user'],
    ['a null list member', 'status in [null]'],
  ] as const) {
    for (const clause of CLAUSES) {
      it(`rates ${clause.toUpperCase()} with ${label} the rule's unenforceable error`, async () => {
        expect(isSupportedRlsExpression(source)).toBe(true);
        const findings = ruleOn(clause, source);
        expect(findings.map((f) => [f.rule, f.severity])).toEqual([[RLS_PREDICATE_UNENFORCEABLE, 'error']]);
        expect(await lintCelPredicate(source, { ...HINT, clause })).toEqual([
          { severity: 'error', message: findings[0].message },
        ]);
      });
    }
  }

  // The same faces refuse a `null` beside a typed member, or a `null`
  // ordering bound; the engine's type check refuses those first, as a
  // blocking parse fault, and the rule is asked only once the predicate parses.
  for (const source of ["status in ['a', null]", 'amount > null']) {
    it(`\`${source}\` is already the engine's blocking error, and only that one`, async () => {
      expect(isSupportedRlsExpression(source)).toBe(true);
      expect(ruleOn('using', source).map((f) => f.rule)).toEqual([RLS_PREDICATE_UNENFORCEABLE]);
      const issues = await lintCelPredicate(source, { ...HINT, clause: 'using' });
      const errors = issues.filter((i) => i.severity === 'error');
      expect(errors).toHaveLength(1);
      expect(errors[0].message).not.toBe(ruleOn('using', source)[0].message);
    });
  }

  it("keeps the rule's silence on an app-staged membership key (`owner_id in current_user.team_ids`)", async () => {
    for (const clause of CLAUSES) {
      expect(ruleOn(clause, 'owner_id in current_user.team_ids')).toEqual([]);
      expect(await lintCelPredicate('owner_id in current_user.team_ids', { ...HINT, clause })).toEqual([]);
    }
  });

  it('leaves the shape verdict of #13061 as it was: a clause that cannot lower carries the shape error alone', async () => {
    const source = 'upper(status) == "OPEN"';
    expect(isSupportedRlsExpression(source)).toBe(false);
    for (const clause of CLAUSES) {
      const findings = ruleOn(clause, source);
      expect(findings).toHaveLength(1);
      expect(await lintCelPredicate(source, { ...HINT, clause })).toEqual([
        { severity: 'error', message: findings[0].message },
      ]);
    }
  });
});

describe('celAuthoring · the passes that stay at the publish door give no editor error (objectui#13082)', () => {
  /** The rule's verdict with the object declared, as the publish door's universe holds it. */
  const ruleWithObject = (source: string, fields: Record<string, { type?: string }>) =>
    validateRlsPredicateEnforceability({
      objects: [{ name: 'account', fields }],
      permissions: [{ rowLevelSecurity: [{ object: 'account', operation: 'all', using: source }] }],
    });

  // The editor's field list is a name list read from the PUBLISHED object; a
  // field the author added in a pending object draft is not on it, and the
  // package publish folds that draft in. An unknown field therefore gets at
  // most the engine's non-blocking near-miss advisory here, never the rule's
  // error.
  it('a field missing from the editor list holds no Save, though the rule refuses it against that list', async () => {
    const source = "region == 'EU'";
    const listed = Object.fromEntries(HINT.fields.map((name) => [name, {}]));
    expect(ruleWithObject(source, listed).map((f) => f.rule)).toEqual([RLS_PREDICATE_UNKNOWN_FIELD]);
    expect(ruleWithObject(source, { ...listed, region: { type: 'text' } })).toEqual([]);
    const issues = await lintCelPredicate(source, { ...HINT, clause: 'using' });
    expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('absent field metadata gives no error', async () => {
    for (const fields of [undefined, []]) {
      for (const clause of CLAUSES) {
        const issues = await lintCelPredicate('nope_field == current_user.id', { objectName: 'account', fields, clause });
        expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
      }
    }
  });

  // Field TYPES decide these two arms; the editor holds names only.
  for (const [label, source, fields] of [
    ['a text field compared with a number field', 'status != amount', { status: { type: 'text' }, amount: { type: 'number' } }],
    ['a field compared with a list-holding field', 'status != tags', { status: { type: 'text' }, tags: { type: 'json' } }],
  ] as const) {
    it(`${label}: refused by the rule over declared types, no error in the editor`, async () => {
      expect(ruleWithObject(source, fields).map((f) => f.rule)).toEqual([RLS_PREDICATE_UNENFORCEABLE]);
      const issues = await lintCelPredicate(source, { objectName: 'account', fields: Object.keys(fields), clause: 'using' });
      expect(issues.filter((i) => i.severity === 'error')).toEqual([]);
    });
  }
});
