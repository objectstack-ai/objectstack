// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  validateAiToolReferences,
  AI_SKILL_TOOL_UNRESOLVED,
} from './validate-ai-tool-references.js';

describe('validate-ai-tool-references', () => {
  // ── The motivating corpus, measured per branch (#3806 / #3820 §3) ─────────
  // HotCRM's six skills carry 16 tool references: 6 resolve via the platform
  // registry, 10 are fictional. The rule must find exactly the 10 — a single
  // false positive on the resolvable 6 is the failure mode that got this
  // branch blocked on D0 in the first place.
  it('yields exactly the 10 fictional references on the HotCRM corpus, 0 false positives', () => {
    const stack = {
      skills: [
        { name: 'live_data', tools: ['describe_object', 'list_objects', 'query_records', 'get_record', 'aggregate_data'] },
        { name: 'customer_360', tools: ['search_knowledge'] },
        { name: 'case_triage', tools: ['triage_case'] },
        { name: 'email_drafting', tools: ['generate_email_copy', 'optimize_subject_line', 'personalize_content', 'generate_email'] },
        { name: 'lead_qualification', tools: ['analyze_lead', 'suggest_next_action'] },
        { name: 'revenue_forecasting', tools: ['analyze_pipeline', 'identify_at_risk', 'forecast_revenue'] },
      ],
    };
    const findings = validateAiToolReferences(stack);
    expect(findings).toHaveLength(10);
    expect(findings.every((f) => f.severity === 'warning')).toBe(true);
    expect(findings.every((f) => f.rule === AI_SKILL_TOOL_UNRESOLVED)).toBe(true);
    const flagged = findings.map((f) => f.message.match(/references tool "([a-z_]+)"/)?.[1]);
    expect(flagged).toEqual([
      'triage_case',
      'generate_email_copy',
      'optimize_subject_line',
      'personalize_content',
      'generate_email',
      'analyze_lead',
      'suggest_next_action',
      'analyze_pipeline',
      'identify_at_risk',
      'forecast_revenue',
    ]);
  });

  it('resolves declared stack.tools records (the optional refinement layer)', () => {
    const stack = {
      tools: [{ name: 'quote_discount', label: 'Quote', description: 'x' }],
      skills: [{ name: 's', tools: ['quote_discount'] }],
    };
    expect(validateAiToolReferences(stack)).toEqual([]);
  });

  it('resolves materialised action tools from stack-level and object-level actions', () => {
    const stack = {
      actions: [{ name: 'send_invoice', label: 'Send' }],
      objects: [{ name: 'crm_case', actions: [{ name: 'triage_case', label: 'Triage' }] }],
      skills: [{ name: 's', tools: ['action_send_invoice', 'action_triage_case'] }],
    };
    expect(validateAiToolReferences(stack)).toEqual([]);
  });

  it('does NOT resolve a bare action name — the tool is the materialised action_<name>', () => {
    // The ADR-0109 default path is `action_<name>`; naming the raw action is
    // the near-miss the hint should catch, via the suggestion.
    const stack = {
      objects: [{ name: 'crm_case', actions: [{ name: 'triage_case', label: 'Triage' }] }],
      skills: [{ name: 's', tools: ['triage_case'] }],
    };
    const findings = validateAiToolReferences(stack);
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain('Did you mean "action_triage_case"?');
  });

  it('resolves trailing-wildcard families against the universe', () => {
    const withActions = {
      objects: [{ name: 'crm_case', actions: [{ name: 'triage_case', label: 'T' }] }],
      skills: [{ name: 's', tools: ['action_*'] }],
    };
    expect(validateAiToolReferences(withActions)).toEqual([]);

    // A family subscription that matches nothing contributes zero tools.
    const withoutActions = { skills: [{ name: 's', tools: ['crm_*'] }] };
    const findings = validateAiToolReferences(withoutActions);
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain('tool family "crm_*"');
  });

  it('resolves platform registry names without any stack declarations', () => {
    const stack = { skills: [{ name: 's', tools: ['query_records', 'verify_build', 'suggest_builder'] }] };
    expect(validateAiToolReferences(stack)).toEqual([]);
  });

  it('reports stable paths and tolerates junk shapes', () => {
    const stack = {
      skills: [{ name: 's', tools: ['query_records', 'nope_tool'] }],
    };
    const findings = validateAiToolReferences(stack);
    expect(findings.map((f) => f.path)).toEqual(['skills[0].tools[1]']);

    expect(validateAiToolReferences({})).toEqual([]);
    expect(validateAiToolReferences({ skills: 'nope', tools: 42 } as never)).toEqual([]);
    expect(
      validateAiToolReferences({ skills: [null, { tools: [7, null, 'query_records'] }] } as never),
    ).toEqual([]);
  });
});
