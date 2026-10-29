// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #27643 — an object validation rule's expression findings carry the slot's
 * key path.
 *
 * `expression-invalid` is what publish refuses a validation rule's CEL with,
 * and its finding was located by its `where` prose alone (`object 'X' ·
 * validation rule 'NAME'`). A draft's `_diagnostics` is item-relative and
 * dotted (`validations.1.condition`), so Studio's rule editor could not ask
 * whether the refusal was its own. Every finding the validation-rule pass
 * pushes — `check()`, the `parent` root verdict and the null-guard gate, on
 * the rule's `condition` and `when` and on a `conditional` rule's nested
 * branches — now carries the key path in the spelling a flow edge's findings
 * use (#26858), beside the unchanged `where` and message.
 */

import { describe, expect, it } from 'vitest';

import { runRuntimeAuthoringRules } from './runtime-gate.js';
import { validateStackExpressions } from './validate-expressions.js';

type AnyRec = Record<string, unknown>;

/** `amount` is nullable (no `required`, no `defaultValue`), so a bare compare on it is a null-guard finding. */
function obj(validations: unknown, extra: AnyRec = {}): AnyRec {
  return {
    name: 'rule_probe',
    label: 'Rule Probe',
    sharingModel: 'private',
    fields: {
      name: { type: 'text', label: 'Name' },
      amount: { type: 'number', label: 'Amount' },
    },
    validations,
    ...extra,
  };
}

const CLEAN = { name: 'ok_rule', type: 'script', condition: 'record.name != null', message: 'ok' };
/** A null-guard finding on the rule's own `condition`. */
const NULL_UNSAFE = { name: 'amount_rule', type: 'script', condition: 'record.amount > 100', message: 'x' };
/** A `check()` finding (bare reference) on the rule's own `condition`. */
const BARE = { name: 'amount_bare', type: 'script', condition: 'amount > 1', message: 'x' };

const at = (issues: ReturnType<typeof validateStackExpressions>, fragment: string) =>
  issues.filter((i) => i.where.includes(fragment));

describe('a validation rule\'s expression finding carries a key path (#27643)', () => {
  it('null-guard gate on `condition`: indexed over the authored lists, where and message unchanged', () => {
    const issues = validateStackExpressions({ objects: [obj([CLEAN, NULL_UNSAFE])] });
    const onRule = at(issues, "'amount_rule'");
    expect(onRule).toHaveLength(1);
    expect(onRule[0]).toMatchObject({
      path: 'objects[0].validations[1].condition',
      where: "object 'rule_probe' · validation rule 'amount_rule'",
    });
    expect(onRule[0]!.message).toContain("validation rule 'amount_rule' applies `>` to `record.amount`");
  });

  it('check() on `condition`: the bare-reference finding carries the same path', () => {
    const issues = validateStackExpressions({ objects: [obj([BARE])] });
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({
      path: 'objects[0].validations[0].condition',
      where: "object 'rule_probe' · validation 'amount_bare'",
    });
    expect(issues[0]!.message).toContain('bare reference `amount`');
  });

  it('`when`: check() and the null-guard gate both carry `.when`', () => {
    const gate = {
      type: 'conditional', name: 'gate', message: 'x', when: 'sqrt(record.amount) > 1 && record.amount > 5',
      then: { type: 'script', name: 'child', condition: 'record.amount != null && record.amount > 100', message: 'y' },
    };
    const issues = validateStackExpressions({ objects: [obj([gate])] });
    const viaCheck = issues.filter((i) => i.where === "object 'rule_probe' · validation 'gate' when");
    const viaNullGuard = issues.filter((i) => i.where === "object 'rule_probe' · validation rule 'gate' when-predicate");
    expect(viaCheck.length).toBeGreaterThan(0);
    expect(viaNullGuard.length).toBeGreaterThan(0);
    for (const i of [...viaCheck, ...viaNullGuard]) expect(i.path).toBe('objects[0].validations[0].when');
    expect(issues).toHaveLength(viaCheck.length + viaNullGuard.length);
  });

  it('nested `then` / `otherwise` branches: the path walks the branch keys', () => {
    const gate = {
      type: 'conditional', name: 'outer', message: 'x', when: 'record.name != null',
      then: { type: 'script', name: 'inner', condition: 'record.amount < 1000', message: 'y' },
      otherwise: {
        type: 'conditional', name: 'mid', message: 'm', when: 'record.amount > 5',
        then: { type: 'script', name: 'deep', condition: 'sqrt(record.amount) > 1', message: 'd' },
      },
    };
    const issues = validateStackExpressions({ objects: [obj([gate])] });
    const byWhere = Object.fromEntries(issues.map((i) => [i.where, i.path]));
    expect(byWhere).toEqual({
      "object 'rule_probe' · validation rule 'outer' then → 'inner'": 'objects[0].validations[0].then.condition',
      "object 'rule_probe' · validation rule 'outer' otherwise → 'mid' when-predicate": 'objects[0].validations[0].otherwise.when',
      "object 'rule_probe' · validation rule 'outer' otherwise → 'mid' then → 'deep'": 'objects[0].validations[0].otherwise.then.condition',
    });
  });

  it('the `parent` root verdict carries the slot path too', () => {
    const rule = { name: 'paid_lock', type: 'script', condition: "parent.status == 'paid'", message: 'x' };
    const issues = validateStackExpressions({ objects: [obj([rule])] });
    const parentIssues = issues.filter((i) => i.message.includes('`parent`'));
    expect(parentIssues.length).toBeGreaterThan(0);
    for (const i of parentIssues) {
      expect(i).toMatchObject({ path: 'objects[0].validations[0].condition', where: "object 'rule_probe' · validation 'paid_lock'" });
    }
  });

  it('indexes the raw lists: a null member before the object or the rule does not renumber it', () => {
    const issues = validateStackExpressions({ objects: [null, obj([null, NULL_UNSAFE])] });
    const onRule = at(issues, "'amount_rule'");
    expect(onRule).toHaveLength(1);
    expect(onRule[0]!.path).toBe('objects[1].validations[1].condition');
  });

  it('a map-form `objects` collection has no index to spell, so the finding keeps where alone', () => {
    const { name: _name, ...body } = obj([NULL_UNSAFE]);
    const issues = validateStackExpressions({ objects: { rule_probe: body } });
    const onRule = at(issues, "'amount_rule'");
    expect(onRule).toHaveLength(1);
    expect(onRule[0]!.path).toBeUndefined();
  });

  it('a finding off a validation rule gains no path', () => {
    const issues = validateStackExpressions({
      objects: [obj([], { fields: { amount: { type: 'formula', label: 'F', expression: 'amount * 2' } } })],
    });
    expect(issues.length).toBeGreaterThan(0);
    for (const i of issues) expect(i.path).toBeUndefined();
  });

  it('reaches the publish gate: located at the rule\'s key path, the top-level index re-spelled by name', () => {
    const result = runRuntimeAuthoringRules({ type: 'object', item: obj([CLEAN, NULL_UNSAFE]), context: { objects: [] } });
    const refusals = result.errors.filter((f) => f.rule === 'expression-invalid');
    expect(refusals).toHaveLength(1);
    expect(refusals[0]).toMatchObject({
      path: 'objects.rule_probe.validations[1].condition',
      where: "object 'rule_probe' · validation rule 'amount_rule'",
    });
  });
});
