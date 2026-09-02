// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Tests for the shared functional-completeness predicate (ADR-0078 Phase 1).
 *
 * Two disciplines from the #4001 campaign carry over:
 *
 * 1. Every rule is proven to GO RED on the inert shape it exists for — a
 *    completeness gate that cannot fail on a known-inert instance is the
 *    hollow-probe defect reproduced in the instrument built against it.
 * 2. The deliberate NON-rules are pinned as hard as the rules. `multiselect`
 *    without options is runtime-blessed free-form (`record-validator.ts:471`,
 *    verbatim: "free-form (tags without options)") — if someone "completes"
 *    this module by flagging it, that is a false prescription, and this test
 *    is where the attempt fails first.
 */

import { describe, expect, it } from 'vitest';

import {
  checkFieldCompleteness,
  checkViewCompleteness,
  checkWebhookCompleteness,
  FUNCTIONAL_COMPLETENESS_RULES,
  FIELD_SUMMARY_WITHOUT_OPERATIONS,
  FIELD_FORMULA_WITHOUT_EXPRESSION,
  FIELD_RELATIONSHIP_WITHOUT_REFERENCE,
  FIELD_CHOICE_WITHOUT_OPTIONS,
  VIEW_LAYOUT_WITHOUT_BINDING,
  VIEW_TREE_WITHOUT_PARENT_FIELD,
  WEBHOOK_WITHOUT_TRIGGERS,
} from './functional-completeness';

const only = (findings: ReturnType<typeof checkFieldCompleteness>) => {
  expect(findings).toHaveLength(1);
  return findings[0];
};

describe('checkFieldCompleteness — the verified inert shapes go red', () => {
  it('flags a bare summary as an ERROR (the cloud#687 founding case)', () => {
    const f = only(checkFieldCompleteness({ type: 'summary' }));
    expect(f.rule).toBe(FIELD_SUMMARY_WITHOUT_OPERATIONS);
    expect(f.severity).toBe('error');
    expect(f.fix).toContain('summaryOperations');
    // The message must carry the runtime evidence — a prescription with no
    // "why" is the kind this campaign shipped four wrong ones of.
    expect(f.message).toContain('engine.ts');
  });

  it('is silent on a complete summary', () => {
    expect(checkFieldCompleteness({
      type: 'summary',
      summaryOperations: { object: 'order_line', field: 'amount', function: 'sum' },
    })).toEqual([]);
  });

  it('flags a bare formula as an ERROR', () => {
    const f = only(checkFieldCompleteness({ type: 'formula' }));
    expect(f.rule).toBe(FIELD_FORMULA_WITHOUT_EXPRESSION);
    expect(f.severity).toBe('error');
  });

  it('is silent on a formula with an expression — either input form', () => {
    expect(checkFieldCompleteness({ type: 'formula', expression: 'record.a * record.b' })).toEqual([]);
    expect(checkFieldCompleteness({
      type: 'formula',
      expression: { dialect: 'cel', source: 'record.a * record.b' },
    })).toEqual([]);
  });

  it.each(['lookup', 'master_detail'])('flags a %s without reference as an ERROR', (type) => {
    const f = only(checkFieldCompleteness({ type }));
    expect(f.rule).toBe(FIELD_RELATIONSHIP_WITHOUT_REFERENCE);
    expect(f.severity).toBe('error');
    expect(checkFieldCompleteness({ type, reference: 'account' })).toEqual([]);
  });

  it('does NOT flag `user` — its target is implicitly sys_user', () => {
    expect(checkFieldCompleteness({ type: 'user' })).toEqual([]);
  });

  it.each(['select', 'radio'])('flags a %s without options as an ERROR', (type) => {
    const f = only(checkFieldCompleteness({ type }));
    expect(f.rule).toBe(FIELD_CHOICE_WITHOUT_OPTIONS);
    expect(f.severity).toBe('error');
    expect(checkFieldCompleteness({ type, options: [] })).toHaveLength(1);
    expect(checkFieldCompleteness({
      type,
      options: [{ label: 'Open', value: 'open' }],
    })).toEqual([]);
  });

  it('flags checkboxes without options as a WARNING, not an error', () => {
    // Shares the validator's free-form multi branch, so it MAY be deliberate —
    // but a zero-box checkbox group almost never is. ADR-0078 §1: degrades → warning.
    const f = only(checkFieldCompleteness({ type: 'checkboxes' }));
    expect(f.rule).toBe(FIELD_CHOICE_WITHOUT_OPTIONS);
    expect(f.severity).toBe('warning');
  });

  it('does NOT flag multiselect without options — the pinned NON-rule', () => {
    // record-validator.ts:471, verbatim: "free-form (tags without options)".
    // The runtime blesses this as a mode; flagging it would be a false
    // prescription. If product direction ever changes, change the runtime
    // first — this pin makes the lint follow the code, never lead it.
    expect(checkFieldCompleteness({ type: 'multiselect' })).toEqual([]);
  });

  it('never throws on junk — a lint must not be what crashes a build', () => {
    for (const junk of [undefined, null, 42, 'x', [], {}, { type: 7 }, { type: 'nonsense' }]) {
      expect(() => checkFieldCompleteness(junk)).not.toThrow();
      expect(checkFieldCompleteness(junk)).toEqual([]);
    }
  });
});

describe('checkViewCompleteness — layout bindings', () => {
  // Six of the view `type` members carry a binding block. The renderer's
  // fallback for every one is a literal field name (measured in objectui's
  // ListView adapter — see the table's docblock), so the missing block is the
  // same defect on all six, not a lesser one on the last three.
  it.each(['kanban', 'calendar', 'gantt', 'timeline', 'map', 'tree'])('flags a %s view missing its block as a WARNING', (type) => {
    const f = only(checkViewCompleteness({ type }) as never);
    expect(f.rule).toBe(VIEW_LAYOUT_WITHOUT_BINDING);
    expect(f.severity).toBe('warning');
    expect(f.path).toBe(type);
    // The prescription names the block and the keys that make it a binding.
    expect(f.fix.startsWith(`${type}: {`)).toBe(true);
  });

  it('is silent when the block is present and bound — one fixture per covered type', () => {
    expect(checkViewCompleteness({
      type: 'calendar',
      calendar: { startDateField: 'due_at', titleField: 'title' },
    })).toEqual([]);
    // The card's own repro, the direction that was silent before this table
    // reached `timeline`: the declared block must stay clean.
    expect(checkViewCompleteness({
      type: 'timeline',
      timeline: { startDateField: 'last_update_at', titleField: 'subject' },
    })).toEqual([]);
    // Both coordinate forms `ListMapConfigSchema` documents.
    expect(checkViewCompleteness({ type: 'map', map: { locationField: 'site' } })).toEqual([]);
    expect(checkViewCompleteness({
      type: 'map',
      map: { latitudeField: 'lat', longitudeField: 'lng' },
    })).toEqual([]);
    expect(checkViewCompleteness({ type: 'tree', tree: { parentField: 'parent' } })).toEqual([]);
  });

  it('names the schema-required keys in the timeline prescription', () => {
    // `TimelineConfigSchema` requires exactly these two; the hint must not
    // send an author to declare a block the parser then refuses.
    const f = only(checkViewCompleteness({ type: 'timeline' }) as never);
    expect(f.fix).toContain('startDateField');
    expect(f.fix).toContain('titleField');
  });

  it('flags a `map` block that declares neither coordinate form — `map: {}` is the unbound view with braces', () => {
    // `ListMapConfigSchema` requires no key, so block presence alone would
    // bless `map: { titleField }` on its way to `locationField || 'location'`.
    for (const map of [{}, { titleField: 'title' }, { latitudeField: 'lat' }, { longitudeField: 'lng' }]) {
      const f = only(checkViewCompleteness({ type: 'map', map }) as never);
      expect(f.rule).toBe(VIEW_LAYOUT_WITHOUT_BINDING);
      expect(f.severity).toBe('warning');
      expect(f.path).toBe('map.locationField');
      expect(f.message).toContain("locationField || 'location'");
      expect(f.fix).toContain('locationField');
      expect(f.fix).toContain('latitudeField');
    }
  });

  it('is silent on the types with no binding block to demand (grid, gallery, chart)', () => {
    // `gallery` IS measured (`titleField || 'name'`) and deliberately absent:
    // `GalleryConfigSchema` requires no key, so block presence would assert
    // nothing, and the fallback mis-titles cards rather than emptying them.
    for (const type of ['grid', 'gallery', 'chart']) {
      expect(checkViewCompleteness({ type })).toEqual([]);
    }
  });
});

describe('checkViewCompleteness — the tree parent pointer (the silent-flat half)', () => {
  // A `tree: {}` block satisfies the binding-block table (every key is
  // optional) and still renders flat on an object with no self-reference —
  // the shape a block-presence gate would vouch for. This rule is the second
  // check the triage asked for, and it mirrors objectui's `detectParentField`
  // exactly: `type: 'tree'`, else a lookup / master_detail back to the object.
  const flatObject = {
    name: 'business_unit',
    fields: { name: { type: 'text' }, manager: { type: 'lookup', reference: 'sys_user' } },
  };
  const rulesOf = (view: unknown, object: unknown) =>
    checkViewCompleteness(view, object).map((f) => f.rule).sort();

  it('flags a tree view whose block is EMPTY on an object with nothing to auto-detect', () => {
    const f = only(checkViewCompleteness({ type: 'tree', tree: {} }, flatObject) as never);
    expect(f.rule).toBe(VIEW_TREE_WITHOUT_PARENT_FIELD);
    expect(f.severity).toBe('warning');
    expect(f.path).toBe('tree.parentField');
    // The message carries the renderer evidence — the discipline every rule
    // in this module is held to.
    expect(f.message).toContain('ObjectTree.tsx');
    expect(f.message).toContain('depth 0');
    expect(f.fix).toContain('parentField');
  });

  it('flags a tree view whose block is ABSENT — both the binding rule and the parent-pointer rule', () => {
    expect(rulesOf({ type: 'tree' }, flatObject)).toEqual([
      VIEW_LAYOUT_WITHOUT_BINDING,
      VIEW_TREE_WITHOUT_PARENT_FIELD,
    ]);
  });

  it('a block that binds only the label is still flat', () => {
    expect(rulesOf({ type: 'tree', tree: { labelField: 'name' } }, flatObject))
      .toEqual([VIEW_TREE_WITHOUT_PARENT_FIELD]);
    // An empty string is not a declaration either.
    expect(rulesOf({ type: 'tree', tree: { parentField: '' } }, flatObject))
      .toEqual([VIEW_TREE_WITHOUT_PARENT_FIELD]);
  });

  it('is silent when `parentField` is declared, whatever the object declares', () => {
    expect(checkViewCompleteness({ type: 'tree', tree: { parentField: 'parent' } }, flatObject)).toEqual([]);
  });

  it('is silent when the object carries a `tree` field — the renderer auto-detects it', () => {
    expect(checkViewCompleteness({ type: 'tree', tree: {} }, {
      name: 'category',
      fields: { name: { type: 'text' }, parent: { type: 'tree' } },
    })).toEqual([]);
  });

  it.each(['lookup', 'master_detail'])('is silent when the object carries a %s back to itself', (type) => {
    expect(checkViewCompleteness({ type: 'tree', tree: {} }, {
      name: 'business_unit',
      fields: { name: { type: 'text' }, parent: { type, reference: 'business_unit' } },
    })).toEqual([]);
    // …and not when the same field points at ANOTHER object: a lookup is only
    // a parent pointer when it comes back to the object it lives on.
    expect(rulesOf({ type: 'tree', tree: {} }, {
      name: 'business_unit',
      fields: { name: { type: 'text' }, parent: { type, reference: 'department' } },
    })).toEqual([VIEW_TREE_WITHOUT_PARENT_FIELD]);
  });

  it('reads array-form fields too — both authorable spellings', () => {
    expect(checkViewCompleteness({ type: 'tree', tree: {} }, {
      name: 'business_unit',
      fields: [{ name: 'name', type: 'text' }, { name: 'parent', type: 'lookup', reference: 'business_unit' }],
    })).toEqual([]);
    expect(rulesOf({ type: 'tree', tree: {} }, {
      name: 'business_unit',
      fields: [{ name: 'name', type: 'text' }],
    })).toEqual([VIEW_TREE_WITHOUT_PARENT_FIELD]);
  });

  it('needs the object name to recognise a self-reference — mirrors the renderer, which needs it too', () => {
    expect(rulesOf({ type: 'tree', tree: {} }, {
      fields: { parent: { type: 'lookup', reference: 'business_unit' } },
    })).toEqual([VIEW_TREE_WITHOUT_PARENT_FIELD]);
  });

  it('stays silent with no object in hand — the second clause cannot be asserted', () => {
    // The one-argument call is the pre-existing signature every other consumer
    // uses; it must not start guessing about objects it was never shown. A
    // view naming an object the stack does not declare belongs to
    // `validate-object-references`.
    expect(checkViewCompleteness({ type: 'tree', tree: {} })).toEqual([]);
    expect(checkViewCompleteness({ type: 'tree', tree: {} }, undefined)).toEqual([]);
  });

  it('never throws on junk objects', () => {
    for (const junk of [null, 42, 'x', [], {}, { fields: 'nope' }, { fields: [null, 7] }, { fields: { a: null } }]) {
      expect(() => checkViewCompleteness({ type: 'tree', tree: {} }, junk)).not.toThrow();
    }
  });
});

describe('checkWebhookCompleteness — the rule the runtime comment argued against', () => {
  it('flags a webhook with no `triggers` as an ERROR', () => {
    const f = only(checkWebhookCompleteness({ name: 'notify_slack', url: 'https://x' }) as never);
    expect(f.rule).toBe(WEBHOOK_WITHOUT_TRIGGERS);
    expect(f.severity).toBe('error');
  });

  it('flags `triggers: []` the same — an empty array is not an off switch here', () => {
    // Contrast with an action's `locations: []`, which IS the documented
    // headless spelling. A webhook's off switch is `isActive: false`, so an
    // empty trigger list carries no "I meant it" signal — it is the same dead
    // shape written out longhand.
    const f = only(checkWebhookCompleteness({ triggers: [] }) as never);
    expect(f.severity).toBe('error');
  });

  it('is silent once a trigger is declared', () => {
    expect(checkWebhookCompleteness({ triggers: ['create'] })).toEqual([]);
    expect(checkWebhookCompleteness({ triggers: ['create', 'update', 'delete'] })).toEqual([]);
  });

  it('carries BOTH sources, because either one alone gets this wrong', () => {
    // The skip site's own comment says "or a manual-only webhook with none",
    // which reads as a runtime blessing — the exact shape that makes
    // `multiselect` a NON-rule. What defeats it is webhook.zod.ts's #3196 note
    // that no manual fire path exists, so the blessed mode is unreachable.
    // If someone later demotes or deletes this rule on the strength of that
    // comment alone, this assertion is where the missing half is stated.
    const [f] = checkWebhookCompleteness({});
    expect(f.message).toContain('auto-enqueuer.ts');
    expect(f.message).toContain('no manual fire path exists');
    expect(f.message).toContain('isActive');
  });

  it('never throws on junk', () => {
    for (const junk of [undefined, null, 42, 'x', [], { triggers: 'create' }, { triggers: 7 }]) {
      expect(() => checkWebhookCompleteness(junk)).not.toThrow();
    }
    // A non-array `triggers` is not a declared trigger list — it is the dead
    // shape wearing the wrong type, so it must not slip through as "declared".
    expect(checkWebhookCompleteness({ triggers: 'create' })).toHaveLength(1);
  });
});

describe('registry hygiene', () => {
  it('pins the rule-id list — ids are API for suppressions and dashboards', () => {
    expect([...FUNCTIONAL_COMPLETENESS_RULES].sort()).toEqual([
      'field/choice-without-options',
      'field/formula-without-expression',
      'field/relationship-without-reference',
      'field/summary-without-operations',
      'view/layout-without-binding',
      'view/tree-without-parent-field',
      'webhook/without-triggers',
    ]);
  });

  it('every emitted finding carries a fix — the prescription IS the payload', () => {
    const all = [
      ...checkFieldCompleteness({ type: 'summary' }),
      ...checkFieldCompleteness({ type: 'formula' }),
      ...checkFieldCompleteness({ type: 'lookup' }),
      ...checkFieldCompleteness({ type: 'select' }),
      ...checkFieldCompleteness({ type: 'checkboxes' }),
      ...checkViewCompleteness({ type: 'kanban' }),
      ...checkViewCompleteness({ type: 'tree', tree: {} }, { name: 'unit', fields: {} }),
      ...checkWebhookCompleteness({ url: 'https://x' }),
    ];
    expect(all).toHaveLength(8);
    for (const f of all) {
      expect(f.fix.length).toBeGreaterThan(8);
      expect(f.message.length).toBeGreaterThan(60);
    }
  });
});
