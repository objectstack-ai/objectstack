// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Tests for the ADR-0078 completeness validator.
 *
 * The predicate's own rules are proven in
 * `@objectstack/spec`'s `functional-completeness.test.ts`; this file proves the
 * WALK — that the rules reach every place a field or list view can be authored,
 * in both collection spellings, with a usable location.
 *
 * That split matters here more than usual. This campaign's recurring finding is
 * instruments that report coverage they do not have, and a completeness gate
 * that walks half the stack is exactly that: green, and blind to the other half.
 */

import { describe, expect, it } from 'vitest';

import { runAuthoringRules, splitBySeverity } from './authoring-rules.js';
import { validateFunctionalCompleteness } from './validate-functional-completeness.js';

const bareSummary = { type: 'summary' };

describe('validateFunctionalCompleteness — the walk', () => {
  it('finds an inert field when objects and fields are ARRAYS', () => {
    const findings = validateFunctionalCompleteness({
      objects: [{ name: 'order', fields: [{ name: 'total', ...bareSummary }] }],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe('field/summary-without-operations');
    expect(findings[0].where).toBe('object "order" › fields.total');
    expect(findings[0].path).toBe('objects[0].fields[0].summaryOperations');
  });

  it('finds the same field when objects and fields are name-keyed MAPS', () => {
    // Both spellings are authorable, and a walk that handles only one is the
    // half-blind instrument this suite exists to prevent.
    const findings = validateFunctionalCompleteness({
      objects: { order: { fields: { total: bareSummary } } },
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].where).toBe('object "order" › fields.total');
    expect(findings[0].path).toBe('objects[0].fields.total.summaryOperations');
  });

  it('carries the fix through as the hint', () => {
    const [f] = validateFunctionalCompleteness({
      objects: [{ name: 'o', fields: [{ name: 'rel', type: 'lookup' }] }],
    });
    expect(f.hint).toContain('reference');
    expect(f.severity).toBe('error');
  });

  it('reports every inert field, not just the first', () => {
    const findings = validateFunctionalCompleteness({
      objects: [{
        name: 'order',
        fields: [
          { name: 'total', type: 'summary' },
          { name: 'rate', type: 'formula' },
          { name: 'acct', type: 'lookup' },
          { name: 'stage', type: 'select' },
          { name: 'ok', type: 'text' },
        ],
      }],
    });
    expect(findings.map((f) => f.rule).sort()).toEqual([
      'field/choice-without-options',
      'field/formula-without-expression',
      'field/relationship-without-reference',
      'field/summary-without-operations',
    ]);
  });

  it('walks list views in a container — both `list` and named `listViews`', () => {
    const findings = validateFunctionalCompleteness({
      views: [{
        object: 'task',
        list: { type: 'kanban' },
        listViews: { by_month: { type: 'calendar' } },
      }],
    });
    expect(findings.map((f) => f.path).sort()).toEqual([
      'views[0].list.kanban',
      'views[0].listViews.by_month.calendar',
    ]);
    expect(findings.every((f) => f.severity === 'warning')).toBe(true);
  });

  it('hands the bound object to the view predicate — the tree parent pointer resolves against `stack.objects`', () => {
    // The predicate's tree rule needs the object's fields; this proves the
    // walk actually delivers them, in every resolution the sibling
    // reference-integrity rules use. Array-form objects, container binding:
    const flat = validateFunctionalCompleteness({
      objects: [{ name: 'unit', fields: [{ name: 'name', type: 'text' }] }],
      views: [{ object: 'unit', listViews: { org: { type: 'tree', tree: {} } } }],
    });
    expect(flat.map((f) => [f.rule, f.severity, f.path])).toEqual([
      ['view/tree-without-parent-field', 'warning', 'views[0].listViews.org.tree.parentField'],
    ]);
    expect(flat[0].where).toMatch(/› listViews\.org$/);

    // Map-form objects (the walk injects `name`), a self-lookup → silent.
    expect(validateFunctionalCompleteness({
      objects: { unit: { fields: { parent: { type: 'lookup', reference: 'unit' } } } },
      views: [{ object: 'unit', listViews: { org: { type: 'tree', tree: {} } } }],
    })).toEqual([]);

    // The container's default `list` slot is handed the object too.
    expect(validateFunctionalCompleteness({
      objects: [{ name: 'unit', fields: [] }],
      views: [{ object: 'unit', list: { type: 'tree', tree: {} } }],
    }).map((f) => f.path)).toEqual(['views[0].list.tree.parentField']);

    // A list view's own `data.object` retargets the lookup (ADR-0047):
    // `cat` carries a `tree` field, so the view bound to it is clean even
    // though the container's object has nothing to detect.
    expect(validateFunctionalCompleteness({
      objects: [
        { name: 'unit', fields: [] },
        { name: 'cat', fields: [{ name: 'parent', type: 'tree' }] },
      ],
      views: [{
        object: 'unit',
        listViews: { org: { type: 'tree', tree: {}, data: { provider: 'object', object: 'cat' } } },
      }],
    })).toEqual([]);

    // An object the stack does not declare: nothing is handed over and the
    // tree rule stays silent — `validate-object-references` owns that miss.
    expect(validateFunctionalCompleteness({
      views: [{ object: 'ghost', listViews: { org: { type: 'tree', tree: {} } } }],
    })).toEqual([]);
  });

  // ── The OBJECT-NESTED door (ADR-0017 "Object has-many View") ────────────
  // A container authored on the object itself — `objects[].list` /
  // `objects[].listViews.*` — reaches the same renderer as the top-level
  // `views[]` copy, so it must reach the same rules. The walk used to stop at
  // `stack.views`, which is precisely the half-blind instrument this suite's
  // docblock names.

  it('walks an object-nested `listViews` view — ARRAY-form objects', () => {
    const findings = validateFunctionalCompleteness({
      objects: [{ name: 'task', fields: [{ name: 'title', type: 'text' }], listViews: { plan: { type: 'gantt' } } }],
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe('view/layout-without-binding');
    expect(findings[0].severity).toBe('warning');
    expect(findings[0].where).toBe('object "task" › listViews.plan');
    expect(findings[0].path).toBe('objects[0].listViews.plan.gantt');
  });

  it('walks the same view when objects are name-keyed MAPS', () => {
    // The fixture pair the card asks for: both authorable object spellings,
    // one rule, one location grammar (the object segment is positional in
    // both — the field walk above and `validate-list-view-field-refs` spell
    // it the same way).
    const findings = validateFunctionalCompleteness({
      objects: { task: { fields: { title: { type: 'text' } }, listViews: { plan: { type: 'gantt' } } } },
    });
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe('view/layout-without-binding');
    expect(findings[0].where).toBe('object "task" › listViews.plan');
    expect(findings[0].path).toBe('objects[0].listViews.plan.gantt');
  });

  it('walks the object-nested default `list` slot too', () => {
    expect(validateFunctionalCompleteness({
      objects: [{ name: 'task', fields: [], list: { type: 'timeline' } }],
    }).map((f) => [f.rule, f.where, f.path])).toEqual([
      ['view/layout-without-binding', 'object "task" › list', 'objects[0].list.timeline'],
    ]);
  });

  it('carries `view/tree-without-parent-field` through the nested door as well', () => {
    // Not a second wiring step: the tree rule needs the BOUND OBJECT, and the
    // nested door resolves it to the container's own object, so every rule the
    // predicate has arrives here by construction.
    expect(validateFunctionalCompleteness({
      objects: [{ name: 'unit', fields: [{ name: 'name', type: 'text' }], listViews: { org: { type: 'tree', tree: {} } } }],
    }).map((f) => [f.rule, f.where, f.path])).toEqual([
      ['view/tree-without-parent-field', 'object "unit" › listViews.org', 'objects[0].listViews.org.tree.parentField'],
    ]);

    // A self-lookup on the object → the renderer auto-detects → silent.
    expect(validateFunctionalCompleteness({
      objects: { unit: { fields: { parent: { type: 'lookup', reference: 'unit' } }, listViews: { org: { type: 'tree', tree: {} } } } },
    })).toEqual([]);

    // ADR-0047: the nested view's own `data.object` retargets the lookup, so
    // the rule reads `cat`'s fields, not `unit`'s.
    expect(validateFunctionalCompleteness({
      objects: [
        { name: 'unit', fields: [], listViews: { org: { type: 'tree', tree: {}, data: { provider: 'object', object: 'cat' } } } },
        { name: 'cat', fields: [{ name: 'parent', type: 'tree' }] },
      ],
    })).toEqual([]);
  });

  it('does not over-report: a nested view WITH its binding is silent', () => {
    // The negative half of the pair. A widened walk that fired on complete
    // metadata would be worse than the blind one it replaces.
    expect(validateFunctionalCompleteness({
      objects: [{
        name: 'task',
        fields: [{ name: 'title', type: 'text' }, { name: 'starts', type: 'datetime' }, { name: 'parent', type: 'lookup', reference: 'task' }],
        list: { type: 'grid' },
        listViews: {
          plan: { type: 'gantt', gantt: { startDateField: 'starts', titleField: 'title' } },
          org: { type: 'tree', tree: {} },
          flat: { type: 'grid' },
        },
      }],
    })).toEqual([]);
  });

  it('reports the nested and the top-level copy independently', () => {
    // The two doors are separate authorable surfaces, not two readings of one
    // definition — an author who wrote both gets a finding for each.
    expect(validateFunctionalCompleteness({
      objects: [{ name: 'task', fields: [], listViews: { plan: { type: 'gantt' } } }],
      views: [{ object: 'task', listViews: { plan: { type: 'gantt' } } }],
    }).map((f) => f.path).sort()).toEqual([
      'objects[0].listViews.plan.gantt',
      'views[0].listViews.plan.gantt',
    ]);
  });

  it('walks webhooks in both spellings', () => {
    expect(validateFunctionalCompleteness({
      webhooks: [{ name: 'notify', url: 'https://x' }],
    })[0]).toMatchObject({
      rule: 'webhook/without-triggers',
      severity: 'error',
      where: 'webhook "notify"',
      path: 'webhooks[0].triggers',
    });
    expect(validateFunctionalCompleteness({
      webhooks: { notify: { url: 'https://x' } },
    })[0]).toMatchObject({ where: 'webhook "notify"', path: 'webhooks.notify.triggers' });
  });

  it('is silent on a complete stack', () => {
    expect(validateFunctionalCompleteness({
      objects: [{
        name: 'order',
        fields: [
          { name: 'total', type: 'summary', summaryOperations: { object: 'line', field: 'amt', function: 'sum' } },
          { name: 'acct', type: 'lookup', reference: 'account' },
          { name: 'stage', type: 'select', options: [{ label: 'New', value: 'new' }] },
          { name: 'tags', type: 'multiselect' },
        ],
      }],
      views: [{ object: 'order', list: { type: 'grid' } }],
      webhooks: [{ name: 'notify', url: 'https://x', triggers: ['create'] }],
    })).toEqual([]);
  });

  it('never throws on junk or partial stacks', () => {
    for (const junk of [
      undefined, null, 42, 'x', [], {},
      { objects: 'nope' }, { objects: [null, 7] },
      { objects: [{ name: 'o', fields: 'nope' }] },
      { objects: [{ name: 'o', list: null, listViews: 'nope' }] },
      { objects: { o: { list: 7, listViews: [null, 'x'] } } },
      { views: [{ list: null }] },
      { views: 'nope' },
      { webhooks: 'nope' }, { webhooks: [null, 7] },
    ]) {
      expect(() => validateFunctionalCompleteness(junk)).not.toThrow();
    }
  });
});

/**
 * The card's acceptance criteria, pinned end-to-end through the rule table
 * (the #14108 precedent): `timeline` / `map` / `tree` without their binding
 * block must produce a diagnostic on `os validate` (and `os build`), and a
 * `tree` view bound to an object with no self-reference must produce one
 * whether its block is empty or absent. The clean twins prove the fixtures
 * fail for the right reason.
 */
describe('#14106 acceptance — timeline / map / tree bindings reach `validate` AND `build`', () => {
  const object = {
    name: 'duly_task',
    fields: {
      subject: { type: 'text' },
      last_update_at: { type: 'datetime' },
      site: { type: 'text' },
    },
  };
  const repro = {
    objects: [object],
    views: [{
      object: 'duly_task',
      listViews: {
        recent: { type: 'timeline', columns: ['subject'] },
        sites: { type: 'map', columns: ['subject'] },
        flat: { type: 'tree', tree: {}, columns: ['subject'] },
        flatter: { type: 'tree', columns: ['subject'] },
      },
    }],
  };
  const clean = {
    objects: [{
      ...object,
      fields: { ...object.fields, parent: { type: 'lookup', reference: 'duly_task' } },
    }],
    views: [{
      object: 'duly_task',
      listViews: {
        recent: {
          type: 'timeline', columns: ['subject'],
          timeline: { startDateField: 'last_update_at', titleField: 'subject' },
        },
        sites: { type: 'map', columns: ['subject'], map: { locationField: 'site' } },
        flat: { type: 'tree', tree: {}, columns: ['subject'] },
        declared: { type: 'tree', tree: { parentField: 'parent' }, columns: ['subject'] },
      },
    }],
  };
  const BINDING_RULES = ['view/layout-without-binding', 'view/tree-without-parent-field'];

  for (const command of ['validate', 'build'] as const) {
    it(`the measured repro is diagnosed by \`${command}\``, () => {
      const { advisories } = splitBySeverity(runAuthoringRules(command, { normalized: repro as never }));
      const hits = advisories.filter((f) => BINDING_RULES.includes(f.rule)).map((f) => `${f.rule} @ ${f.path}`).sort();
      expect(hits).toEqual([
        'view/layout-without-binding @ views[0].listViews.flatter.tree',
        'view/layout-without-binding @ views[0].listViews.recent.timeline',
        'view/layout-without-binding @ views[0].listViews.sites.map',
        'view/tree-without-parent-field @ views[0].listViews.flat.tree.parentField',
        'view/tree-without-parent-field @ views[0].listViews.flatter.tree.parentField',
      ]);
    });

    it(`the bound stack passes \`${command}\``, () => {
      const { errors, advisories } = splitBySeverity(runAuthoringRules(command, { normalized: clean as never }));
      expect([...errors, ...advisories].filter((f) => BINDING_RULES.includes(f.rule))).toEqual([]);
    });
  }
});

/**
 * The #14320 acceptance criteria, pinned end-to-end through the rule table on
 * the card's own repro path (`runAuthoringRules('validate' | 'build', …)`) —
 * because the walk being wired is only worth as much as the surface it reaches.
 *
 * The stack below authors nothing at `stack.views`: every list view lives on
 * its object, the ADR-0017 spelling `os validate` used to walk right past.
 */
describe('#14320 acceptance — object-nested `list` / `listViews` reach `validate` AND `build`', () => {
  const fields = {
    subject: { type: 'text' },
    last_update_at: { type: 'datetime' },
    site: { type: 'text' },
  };
  const BINDING_RULES = ['view/layout-without-binding', 'view/tree-without-parent-field'];

  /** Array-form objects — the `defineObject` spelling. */
  const repro = {
    objects: [{
      name: 'duly_task',
      fields,
      list: { type: 'timeline', columns: ['subject'] },
      listViews: {
        plan: { type: 'gantt', columns: ['subject'] },
        sites: { type: 'map', columns: ['subject'] },
        flat: { type: 'tree', tree: {}, columns: ['subject'] },
      },
    }],
  };

  /** Map-form objects — the same stack, the other authorable spelling. */
  const reproMap = {
    objects: {
      duly_task: {
        fields,
        list: { type: 'timeline', columns: ['subject'] },
        listViews: {
          plan: { type: 'gantt', columns: ['subject'] },
          sites: { type: 'map', columns: ['subject'] },
          flat: { type: 'tree', tree: {}, columns: ['subject'] },
        },
      },
    },
  };

  const EXPECTED = [
    'view/layout-without-binding @ objects[0].list.timeline',
    'view/layout-without-binding @ objects[0].listViews.plan.gantt',
    'view/layout-without-binding @ objects[0].listViews.sites.map',
    'view/tree-without-parent-field @ objects[0].listViews.flat.tree.parentField',
  ];

  const clean = {
    objects: [{
      name: 'duly_task',
      fields: { ...fields, parent: { type: 'lookup', reference: 'duly_task' } },
      list: { type: 'timeline', columns: ['subject'], timeline: { startDateField: 'last_update_at', titleField: 'subject' } },
      listViews: {
        plan: { type: 'gantt', columns: ['subject'], gantt: { startDateField: 'last_update_at', titleField: 'subject' } },
        sites: { type: 'map', columns: ['subject'], map: { locationField: 'site' } },
        flat: { type: 'tree', tree: {}, columns: ['subject'] },
        declared: { type: 'tree', tree: { parentField: 'parent' }, columns: ['subject'] },
      },
    }],
  };

  for (const command of ['validate', 'build'] as const) {
    for (const [spelling, stack] of [['array-form', repro], ['map-form', reproMap]] as const) {
      it(`the ${spelling} repro is diagnosed by \`${command}\``, () => {
        const { advisories } = splitBySeverity(runAuthoringRules(command, { normalized: stack as never }));
        const hits = advisories
          .filter((f) => BINDING_RULES.includes(f.rule))
          .map((f) => `${f.rule} @ ${f.path}`)
          .sort();
        expect(hits).toEqual(EXPECTED);
      });
    }

    it(`the bound object-nested stack passes \`${command}\``, () => {
      const { errors, advisories } = splitBySeverity(runAuthoringRules(command, { normalized: clean as never }));
      expect([...errors, ...advisories].filter((f) => BINDING_RULES.includes(f.rule))).toEqual([]);
    });
  }
});
