// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #22032, pass 1 — the OBJECT write door runs the build's validation-rule
 * pass.
 *
 * ## The state this closes
 *
 * `validateStackExpressions` is the build's expression rule. Its
 * validation-rule pass judges every `validations[]` predicate: the
 * `condition` (record-scoped, with the relationship-traversal checks the rule
 * validator serves), the `conditional` rule's `when`, and the #4763 null-guard
 * gate over every predicate the rule carries, its nested `then` / `otherwise`
 * branches included. #22019 put that rule on the object door for its
 * field-formula pass alone and fenced the rest off by name, so a rule whose
 * `condition` called an unregistered function (`sqrt(record.amount) > 1`) or
 * read a bare field (`amount > 1`) published clean — and then faulted on every
 * write the rule judged.
 *
 * ## The crossing
 *
 * No registry change: the entry already declares `object`. The fence in
 * `runStackExpressionPasses` admits this pass on an object write, at the
 * build's own position in the walk, so the door's finding IS the build's
 * finding — rule, location, message and hint. The other object-borne passes
 * (the field-rule slots, option `visibleWhen`, the object's own action
 * predicates) stay fenced; that pin is in
 * `runtime-gate.object-formula-writes.test.ts`.
 *
 * The protocol-level half — the same verdict through the real `saveMetaItem`
 * and `publishMetaItem` — is the #22032 block of
 * `packages/metadata-protocol/src/protocol.runtime-authoring-gate.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { EXPRESSION_INVALID, runAuthoringRules } from './authoring-rules.js';
import { runRuntimeAuthoringRules, runtimeAuthoringRulesFor } from './runtime-gate.js';

/** `sharingModel` keeps `security-owd-unset` quiet, so the refusal is the rule's. */
const fxRule = (validations: unknown[]) => ({
  name: 'fx_rule',
  label: 'Rule Probe',
  sharingModel: 'private',
  fields: {
    name: { type: 'text', label: 'Name' },
    amount: { type: 'number', label: 'Amount' },
    status: {
      type: 'select',
      label: 'Status',
      options: [{ label: 'Open', value: 'open' }, { label: 'Closed', value: 'closed' }],
    },
  },
  validations,
});

/** The card's first body: a `condition` calling a function the stdlib does not register. */
const UNREGISTERED = { name: 'amount_root', type: 'script', condition: 'sqrt(record.amount) > 1', message: 'x' };
/** The card's second body, on this pass's own key: a bare field reference. */
const BARE = { name: 'amount_bare', type: 'script', condition: 'amount > 1', message: 'x' };
/** A `conditional` rule whose `when` is the faulting predicate (its `then` is clean). */
const WHEN = {
  type: 'conditional',
  name: 'gate',
  when: 'sqrt(record.amount) > 1',
  message: 'x',
  then: { type: 'script', name: 'child', condition: 'record.amount != null && record.amount > 100', message: 'y' },
};
/** The null-guard gate's reach into the nested branches: `amount` is nullable, and `has()` is no guard on a total binding. */
const NESTED = {
  type: 'conditional',
  name: 'gate',
  when: "record.status == 'open'",
  message: 'x',
  then: { type: 'script', name: 'child', condition: 'record.amount > 100', message: 'y' },
  otherwise: { type: 'script', name: 'other', condition: 'has(record.amount) && record.amount < 0', message: 'z' },
};
/** Valid, guarded predicates — at the top level and inside a branch. */
const VALID = [
  { name: 'cap', type: 'script', condition: 'record.amount != null && record.amount > 100', message: 'x' },
  {
    type: 'conditional',
    name: 'gate',
    when: "record.status == 'open'",
    message: 'x',
    then: { type: 'script', name: 'child', condition: 'record.amount != null && record.amount > 100', message: 'y' },
  },
];

const gateObject = (item: unknown) =>
  runRuntimeAuthoringRules({ type: 'object', item, context: { objects: [] } });

const expressionFindings = <T extends { rule: string }>(fs: readonly T[]): T[] =>
  fs.filter((f) => f.rule === EXPRESSION_INVALID);

const buildFindings = (body: unknown) => {
  const stack = { objects: [body] };
  return expressionFindings(runAuthoringRules('build', { normalized: stack, parsed: stack }));
};

const dump = (r: unknown) => JSON.stringify(r, null, 2);

describe('#22032 pass 1 — the object door gives the build\'s validation-rule verdict', () => {
  it('needs no registry change: `validateStackExpressions` is already on the object door', () => {
    expect(runtimeAuthoringRulesFor('object').map((r) => r.name)).toContain('validateStackExpressions');
  });

  it('⭐ LIT — a `condition` calling an unregistered function (`sqrt`) is REFUSED, located at the rule', () => {
    const result = gateObject(fxRule([UNREGISTERED]));

    expect(result.rulesRun).toContain('validateStackExpressions');
    const errs = expressionFindings(result.errors);
    const where = "object 'fx_rule' · validation 'amount_root'";
    expect(errs, dump(result)).toHaveLength(1);
    expect(errs[0]).toMatchObject({ severity: 'error', where, path: where });
    expect(errs[0]!.message).toContain('`sqrt` is not a callable name here');
  });

  it('⭐ LIT — a bare field reference in a `condition` (`amount > 1`) is REFUSED', () => {
    const errs = expressionFindings(gateObject(fxRule([BARE])).errors);

    expect(errs, dump(errs)).toHaveLength(1);
    expect(errs[0]).toMatchObject({ where: "object 'fx_rule' · validation 'amount_bare'" });
    expect(errs[0]!.message).toContain('bare reference `amount`');
  });

  it('⭐ LIT — a `conditional` rule\'s `when` is judged', () => {
    const errs = expressionFindings(gateObject(fxRule([WHEN])).errors);

    expect(errs, dump(errs)).toHaveLength(1);
    expect(errs[0]).toMatchObject({ where: "object 'fx_rule' · validation 'gate' when" });
    expect(errs[0]!.message).toContain('`sqrt` is not a callable name here');
  });

  it('⭐ LIT — the null-guard gate reaches the nested `then` / `otherwise` predicates', () => {
    const errs = expressionFindings(gateObject(fxRule([NESTED])).errors);

    expect(errs.map((e) => e.where), dump(errs)).toEqual([
      "object 'fx_rule' · validation rule 'gate' then → 'child'",
      "object 'fx_rule' · validation rule 'gate' otherwise → 'other'",
    ]);
    for (const e of errs) expect(e.message).toContain('`record.amount`');
  });

  it('⭐ CONTROL — valid, guarded predicates publish clean, top level and nested', () => {
    const result = gateObject(fxRule(VALID));

    expect(result.rulesRun).toContain('validateStackExpressions');
    expect(expressionFindings(result.errors), dump(result)).toEqual([]);
    expect(expressionFindings(result.advisories), dump(result)).toEqual([]);
    // And the build agrees: the control is clean at both doors, not only this one.
    expect(buildFindings(fxRule(VALID))).toEqual([]);
  });

  it('⭐ PARITY — for each refused body the door findings ARE the build findings', () => {
    for (const rule of [UNREGISTERED, BARE, WHEN, NESTED]) {
      const body = fxRule([rule]);
      const atBuild = buildFindings(body);
      const atDoor = expressionFindings(gateObject(body).errors);

      // Non-vacuous: the build refuses each of them.
      expect(atBuild.length, dump(rule)).toBeGreaterThan(0);
      expect(atDoor, dump(rule)).toEqual(atBuild);
    }
  });

  it('a stored sibling\'s broken rule is not this write\'s to answer for (the differential)', () => {
    const sibling = { ...fxRule([UNREGISTERED, BARE]), name: 'fx_sibling' };
    const result = runRuntimeAuthoringRules({
      type: 'object',
      item: fxRule(VALID),
      context: { objects: [sibling] },
    });

    expect(expressionFindings(result.errors), dump(result)).toEqual([]);
  });
});
