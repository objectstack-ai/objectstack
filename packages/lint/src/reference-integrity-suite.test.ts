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
      'validateSearchableFields',
      'validateActionNameRefs',
      'validatePageFieldBindings',
      'validateChartBindings',
      'validateNavAccess',
      'validateTranslationReferences',
      'validateFlowTemplatePaths',
      'validateAiSurfaceAffinity',
      'validateAiToolReferences',
      'validateAiAgentAuthoring',
      'validateHookBodyWrites',
      'validateActionBodyWrites',
      'validateFlowNodeWrites',
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
        // validateSearchableFields: `budget` is not a field on crm_lead, so the
        // ADR-0061 declaration is stale — the engine drops it and searches a
        // narrower set than the object declares.
        searchableFields: ['name', 'budget'],
        permissions: {},
      },
    ],
    actions: [
      // validateObjectReferences: a param pointing at an object nothing declares.
      { name: 'assign', label: 'Assign', params: [{ name: 'owner', reference: 'user' }] },
      // validateActionBodyWrites, both of its rule ids from one body:
      //   - the L2 body writes a field crm_lead does not declare — on SQL that
      //     fails the whole call at the driver, on a schemaless driver it
      //     persists a stray key (#4271);
      //   - and it assigns ctx.record, a snapshot the runtime never writes
      //     back, without ever passing it anywhere (#4345).
      {
        name: 'score_now',
        label: 'Score Now',
        objectName: 'crm_lead',
        body: {
          language: 'js',
          source:
            "ctx.record.name = 'scored'; await ctx.api.object('crm_lead').update({ lead_score: 100 });",
        },
      },
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
    // validateAiSurfaceAffinity: an 'ask' agent binding a 'build' skill — the
    // runtime throws on this at chat time (ADR-0064 §3).
    // validateAiAgentAuthoring: declaring an agent at all is withdrawn
    // (ADR-0063 §2) — one fixture, two rules.
    agents: [{ name: 'helper', surface: 'ask', skills: ['metadata_authoring'] }],
    // validateAiToolReferences: a tool name nothing declares, registers, or
    // materialises (the HotCRM fictional-tool class).
    skills: [{ name: 'metadata_authoring', surface: 'build', tools: ['forecast_revenue'] }],
    hooks: [
      // validateHookBodyWrites: the L2 body writes a field crm_lead does not
      // declare — runs clean in the sandbox, then fails the whole write at a
      // SQL driver / persists a stray key on a schemaless one (#4271).
      {
        name: 'score_lead',
        object: 'crm_lead',
        events: ['beforeInsert'],
        body: { language: 'js', source: "ctx.input.lead_score = 100;" },
      },
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
          // validateFlowNodeWrites: the node's structural write map names a
          // field crm_lead does not declare — the third surface in the #4271
          // family, and the only one whose finding is a certainty rather than
          // an extraction (so it gates).
          {
            id: 'stamp',
            type: 'update_record',
            config: { objectName: 'crm_lead', fields: { lead_score: 100 } },
          },
        ],
      },
    ],
  };

  it('reports at least one finding from every member', () => {
    const findings = validateReferenceIntegrity(stack);
    const rules = new Set(findings.map((f) => f.rule));

    expect(rules).toContain('object-reference-unknown');
    expect(rules).toContain('searchable-field-unknown');
    expect(rules).toContain('action-name-undefined');
    expect(rules).toContain('page-field-unknown');
    expect(rules).toContain('chart-measure-unknown');
    expect(rules).toContain('nav-object-ungranted');
    expect(rules).toContain('translation-target-unknown');
    expect(rules).toContain('flow-template-unknown-field');
    expect(rules).toContain('ai-skill-surface-mismatch');
    expect(rules).toContain('ai-skill-tool-unresolved');
    expect(rules).toContain('agent-authoring-withdrawn');
    expect(rules).toContain('hook-body-write-unknown-field');
    expect(rules).toContain('action-body-write-unknown-field');
    // The one member that emits a second rule id — see the suite's comment on
    // why it rides along instead of becoming its own entry.
    expect(rules).toContain('action-record-write-discarded');
    expect(rules).toContain('flow-node-write-unknown-field');
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
    // Object references run first, flow-node writes last.
    expect(findings[0].rule).toBe('object-reference-unknown');
    expect(findings[findings.length - 1].rule).toBe('flow-node-write-unknown-field');
  });

  it('returns nothing for an empty stack', () => {
    expect(validateReferenceIntegrity({})).toEqual([]);
  });
});
