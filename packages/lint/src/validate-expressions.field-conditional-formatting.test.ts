// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#22228] A field's cell formatting rules — `FieldSchema.conditionalFormatting`,
 * each `{ condition, style }`, the list view's own rule element — at the
 * authoring gate.
 *
 * The CEL scope is `value` (this field's value on the record) and `record`
 * (the row), by the card's ruling. The gate judges each condition with the
 * `record`-scoped check, naming `value` as a root this surface binds, plus this
 * surface's own root verdict (`fieldFormattingRootIssue`): it parses, it reads
 * `record.<field>` and never a bare field, the field exists, and it reads no
 * root but those two. The parse-level half — the rule's shape, and that the
 * element is the list view's — is pinned in the spec's
 * `field-conditional-formatting.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { SCOPE_ROOTS } from '@objectstack/formula';

import { EXPRESSION_INVALID, runAuthoringRules } from './authoring-rules.js';
import { runRuntimeAuthoringRules } from './runtime-gate.js';
import {
  validateStackExpressions,
  runStackExpressionPasses,
  FIELD_FORMATTING_BOUND_ROOTS,
  FIELD_RULE_JUDGED_ROOTS,
  fieldFormattingRootIssue,
} from './validate-expressions.js';
import type { ExprIssue } from './validate-expressions.js';

const RED = { color: '#b91c1c' };

/** One object whose `amount` field carries `rules`; `sharingModel` keeps the door's OWD rule quiet. */
const fxObject = (rules: unknown, extra: Record<string, unknown> = {}) => ({
  name: 'fx_invoice',
  label: 'Invoice',
  sharingModel: 'private',
  fields: {
    amount: { type: 'currency', label: 'Amount', conditionalFormatting: rules, ...extra },
    status: {
      type: 'select',
      label: 'Status',
      options: [{ label: 'Open', value: 'open' }, { label: 'Paid', value: 'paid' }],
    },
    safety_level: { type: 'number', label: 'Safety Level' },
  },
});
const stackWith = (rules: unknown, extra: Record<string, unknown> = {}) => ({ objects: [fxObject(rules, extra)] });

const whereOf = (i: number) => `object 'fx_invoice' · field 'amount' conditionalFormatting[${i}].condition`;
const errorsOf = (issues: ExprIssue[]) => issues.filter((x) => (x.severity ?? 'error') === 'error');
const at = (issues: ExprIssue[], i: number) => errorsOf(issues).filter((x) => x.where === whereOf(i));
const dump = (r: unknown) => JSON.stringify(r, null, 2);

describe('[#22228] field conditionalFormatting — the authoring gate', () => {
  it('accepts a rule whose condition parses and reads `value` — the card\'s worked example', () => {
    const issues = validateStackExpressions(stackWith([{ condition: 'value < 0', style: RED }]));
    expect(errorsOf(issues), dump(issues)).toEqual([]);
  });

  it('accepts `record`, `today()` and both roots in one condition, over every rule in the list', () => {
    const issues = validateStackExpressions(stackWith([
      { condition: "record.status == 'open' && value > 1000", style: { backgroundColor: '#fef3c7' } },
      { condition: 'value < record.safety_level', style: { color: '#b45309' } },
      { condition: { dialect: 'cel', source: 'today() > timestamp("2020-01-01T00:00:00Z")' }, style: RED },
    ]));
    expect(errorsOf(issues), dump(issues)).toEqual([]);
  });

  it('refuses a condition that does not parse, naming the field and the rule', () => {
    const issues = validateStackExpressions(stackWith([
      { condition: 'value < 0', style: RED },
      { condition: 'value < ', style: RED },
    ]));
    expect(at(issues, 0)).toEqual([]);
    const errors = at(issues, 1);
    expect(errors, dump(issues)).toHaveLength(1);
    expect(errors[0]!.where).toBe("object 'fx_invoice' · field 'amount' conditionalFormatting[1].condition");
    expect(errors[0]!.source).toBe('value < ');
    expect(errors[0]!.message).toMatch(/^invalid CEL predicate: /);
  });

  it('refuses a bare field reference — the row is `record`, as on every record-scoped slot', () => {
    const errors = at(validateStackExpressions(stackWith([{ condition: "status == 'paid'", style: RED }])), 0);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.message).toMatch(/^bare reference `status`/);
  });

  it('refuses a read of a field the object does not declare', () => {
    const errors = at(validateStackExpressions(stackWith([{ condition: 'record.balance < 0', style: RED }])), 0);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.message).toMatch(/`balance`/);
  });

  describe('the scope — `value` and `record`, and no other root', () => {
    it('binds exactly `value` and `record`', () => {
      expect([...FIELD_FORMATTING_BOUND_ROOTS]).toEqual(['value', 'record']);
      // `value` is this surface's own name, never a platform root: the shared
      // baseline is not widened for it.
      expect((SCOPE_ROOTS as readonly string[]).includes('value')).toBe(false);
    });

    // Every root the judged vocabulary carries other than `record`, each in
    // its own reading position — the field-rule family's `previous` and
    // `parent` and the user roots included.
    const UNBOUND = FIELD_RULE_JUDGED_ROOTS.filter((r) => r !== 'record');

    it('the unbound set is not vacuous', () => {
      expect(UNBOUND).toEqual(expect.arrayContaining(['previous', 'parent', 'current_user', 'app']));
    });

    it.each(UNBOUND)('refuses `%s` with this surface\'s root verdict, and only that one', (root) => {
      const source = `${root}.status == 'paid'`;
      const errors = at(validateStackExpressions(stackWith([{ condition: source, style: RED }])), 0);
      expect(errors, dump(errors)).toHaveLength(1);
      expect(errors[0]!.message).toMatch(
        new RegExp(`^\`conditionalFormatting\\[0\\]\\.condition\` reads \`${root}\`, but a field's conditional formatting rule binds only \`value\``),
      );
      expect(errors[0]!.source).toBe(source);
    });

    it('a predicate reading two unbound roots earns one verdict, user roots first', () => {
      const verdict = fieldFormattingRootIssue('conditionalFormatting[0].condition', "previous.amount < 0 && current_user.id != ''");
      expect(verdict?.root).toBe('current_user');
    });

    it('no verdict for a condition that does not parse — the syntax pass owns it', () => {
      expect(fieldFormattingRootIssue('conditionalFormatting[0].condition', 'previous.amount <')).toBeNull();
    });
  });

  it('control: a field without the key keeps its verdicts — the field-rule slots are judged as before', () => {
    const issues = validateStackExpressions(stackWith(undefined, { visibleWhen: "status == 'open'" }));
    expect(errorsOf(issues).filter((x) => x.where.includes('conditionalFormatting'))).toEqual([]);
    const visible = errorsOf(issues).filter((x) => x.where === "object 'fx_invoice' · field 'amount' visibleWhen");
    expect(visible).toHaveLength(1);
    expect(visible[0]!.message).toMatch(/^bare reference `status`/);
    // `value` stays a bare reference on the field-rule family's own slots.
    const family = errorsOf(validateStackExpressions(stackWith(undefined, { visibleWhen: 'value > 0' })))
      .filter((x) => x.where === "object 'fx_invoice' · field 'amount' visibleWhen");
    expect(family).toHaveLength(1);
    expect(family[0]!.message).toMatch(/`value`/);
  });

  it('a stack with no rules on any field earns no conditional-formatting finding', () => {
    const issues = validateStackExpressions(stackWith([]));
    expect(issues.filter((x) => x.where.includes('conditionalFormatting'))).toEqual([]);
  });

  describe('the doors', () => {
    it('the object save door runs the same pass, at the same position', () => {
      const errors = errorsOf(runStackExpressionPasses(stackWith([{ condition: 'value <', style: RED }]), { runtimeWriteType: 'object' }));
      expect(errors.map((x) => x.where)).toEqual([whereOf(0)]);
    });

    it('`os build` refuses it under the expression rule id, as an error', () => {
      const stack = stackWith([{ condition: 'previous.amount < 0', style: RED }]);
      const findings = runAuthoringRules('build', { normalized: stack, parsed: stack }).filter((f) => f.rule === EXPRESSION_INVALID);
      expect(findings, dump(findings)).toHaveLength(1);
      expect(findings[0]).toMatchObject({ rule: EXPRESSION_INVALID, severity: 'error', where: whereOf(0) });
    });

    it('the runtime object door refuses it under the same rule id, and publishes the valid rule clean', () => {
      const refused = runRuntimeAuthoringRules({ type: 'object', item: fxObject([{ condition: 'value <', style: RED }]), context: { objects: [] } });
      const errs = refused.errors.filter((f) => f.rule === EXPRESSION_INVALID);
      expect(errs, dump(refused)).toHaveLength(1);
      expect(errs[0]).toMatchObject({ rule: EXPRESSION_INVALID, severity: 'error', where: whereOf(0) });

      const clean = runRuntimeAuthoringRules({ type: 'object', item: fxObject([{ condition: 'value < 0', style: RED }]), context: { objects: [] } });
      expect(clean.errors.filter((f) => f.rule === EXPRESSION_INVALID), dump(clean)).toEqual([]);
    });
  });
});
