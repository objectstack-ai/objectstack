// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  validateReferenceIntegrity,
  REFERENCE_INTEGRITY_RULES,
} from './reference-integrity-suite.js';
import { validateObjectReferences } from './validate-object-references.js';
import { validateTranslationReferences } from './validate-translation-references.js';

describe('reference-integrity suite — membership', () => {
  // Deliberately a written-out list: adding a rule to the suite should be a
  // conscious edit in two places (the suite and this test), not something that
  // slips in unreviewed. The list is also the answer to "which rules run on
  // `validate` / `lint` / `compile`?".
  it('holds exactly the reference-resolution rules, in report order', () => {
    expect(REFERENCE_INTEGRITY_RULES.map((r) => r.name)).toEqual([
      'validateObjectReferences',
      'validateActionNameRefs',
      'validatePageFieldBindings',
      'validateChartBindings',
      'validateNavAccess',
      'validateTranslationReferences',
      'validateFlowTemplatePaths',
    ]);
  });

  it('wires the same function the package exports', () => {
    const byName = new Map(REFERENCE_INTEGRITY_RULES.map((r) => [r.name, r.run]));
    expect(byName.get('validateObjectReferences')).toBe(validateObjectReferences);
    expect(byName.get('validateTranslationReferences')).toBe(validateTranslationReferences);
  });
});

describe('reference-integrity suite — every member actually runs', () => {
  /**
   * One live instance per rule, so a member that silently stops being invoked
   * (or is dropped from the list) fails here instead of quietly narrowing what
   * the CLI checks. A suite that returns nothing is indistinguishable from a
   * clean stack — which is exactly how the dead quick-actions check in #3684
   * survived its own tests.
   */
  const stack = {
    objects: [
      {
        name: 'crm_lead',
        fields: { name: { type: 'text', label: 'Name' } },
        permissions: {},
      },
    ],
    actions: [
      // validateObjectReferences: a param pointing at an object nothing declares.
      { name: 'assign', label: 'Assign', params: [{ name: 'owner', reference: 'user' }] },
    ],
    views: [
      {
        list: {
          type: 'grid',
          name: 'all_leads',
          data: { provider: 'object', object: 'crm_lead' },
          // validateActionNameRefs: no such action.
          bulkActions: ['mass_update'],
        },
      },
    ],
    pages: [
      {
        name: 'lead_detail',
        object: 'crm_lead',
        regions: [
          {
            components: [
              // validatePageFieldBindings: `budget` is not a field on crm_lead.
              { type: 'record:highlights', properties: { fields: [{ name: 'budget' }] } },
            ],
          },
        ],
      },
    ],
    datasets: [
      {
        name: 'lead_metrics',
        object: 'crm_lead',
        dimensions: [{ name: 'source' }],
        measures: [{ name: 'count_leads', aggregate: 'count' }],
      },
    ],
    reports: [
      {
        name: 'leads_by_source',
        dataset: 'lead_metrics',
        values: ['count_leads'],
        // validateChartBindings: a raw field where a declared measure is required.
        chart: { type: 'bar', xAxis: 'source', yAxis: 'lead_score' },
      },
    ],
    apps: [
      {
        name: 'crm_app',
        navigation: [{ id: 'nav_leads', type: 'object', objectName: 'crm_lead' }],
      },
    ],
    // validateNavAccess: a declared permission set that grants nothing on the
    // nav-exposed object.
    permissions: [{ name: 'sales_user', label: 'Sales User', objects: {} }],
    translations: [
      // validateTranslationReferences: a field the object does not declare.
      { en: { objects: { crm_lead: { label: 'Lead', fields: { assigned_to: { label: 'Owner' } } } } } },
    ],
    flows: [
      {
        name: 'lead_followup',
        type: 'record_change',
        nodes: [
          { id: 'start', type: 'start', config: { objectName: 'crm_lead', triggerType: 'record-created' } },
          // validateFlowTemplatePaths: `budget` is not a field on crm_lead. In a
          // FILTER position an erased condition widens the query rather than
          // narrowing it, so the runtime refuses the node — gating, not advisory
          // (#3810). This member is the suite's only source of `error` findings
          // from a flow, so it also pins that both severities survive the suite.
          {
            id: 'fetch',
            type: 'get_record',
            config: { objectName: 'crm_lead', filter: { name: '{record.budget}' } },
          },
        ],
      },
    ],
  };

  it('reports at least one finding from every member', () => {
    const findings = validateReferenceIntegrity(stack);
    const rules = new Set(findings.map((f) => f.rule));

    expect(rules).toContain('object-reference-unknown');
    expect(rules).toContain('action-name-undefined');
    expect(rules).toContain('page-field-unknown');
    expect(rules).toContain('chart-measure-unknown');
    expect(rules).toContain('nav-object-ungranted');
    expect(rules).toContain('translation-target-unknown');
    expect(rules).toContain('flow-template-unknown-field');
  });

  it('carries a gating flow-template finding through the suite (#3810)', () => {
    const findings = validateReferenceIntegrity(stack);
    const flow = findings.find((f) => f.rule === 'flow-template-unknown-field');
    // A filter-position miss must reach the CLI as an ERROR, or `os lint` and
    // `os compile` would print a yellow line and ship a flow that cannot run.
    expect(flow?.severity).toBe('error');
  });

  it('concatenates in list order and carries the common finding shape', () => {
    const findings = validateReferenceIntegrity(stack);
    expect(findings.length).toBeGreaterThan(0);
    for (const f of findings) {
      expect(['error', 'warning']).toContain(f.severity);
      expect(typeof f.rule).toBe('string');
      expect(typeof f.where).toBe('string');
      expect(typeof f.path).toBe('string');
      expect(typeof f.message).toBe('string');
      expect(typeof f.hint).toBe('string');
    }
    // Object references run first, flow template paths last.
    expect(findings[0].rule).toBe('object-reference-unknown');
    expect(findings[findings.length - 1].rule).toBe('flow-template-unknown-field');
  });

  it('returns nothing for an empty stack', () => {
    expect(validateReferenceIntegrity({})).toEqual([]);
  });
});
