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
    })).toEqual([]);
  });

  it('never throws on junk or partial stacks', () => {
    for (const junk of [
      undefined, null, 42, 'x', [], {},
      { objects: 'nope' }, { objects: [null, 7] },
      { objects: [{ name: 'o', fields: 'nope' }] },
      { views: [{ list: null }] },
      { views: 'nope' },
    ]) {
      expect(() => validateFunctionalCompleteness(junk)).not.toThrow();
    }
  });
});
