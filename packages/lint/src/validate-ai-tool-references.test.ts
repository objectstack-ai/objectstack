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

  const exposed = (name: string, type = 'script') => ({
    name,
    label: name,
    type,
    target: name,
    ai: { exposed: true, description: 'A sufficiently long LLM-facing description of the action.' },
  });

  it('resolves materialised action tools from stack-level and object-level actions', () => {
    const stack = {
      actions: [exposed('send_invoice')],
      objects: [{ name: 'crm_case', actions: [exposed('triage_case', 'flow')] }],
      skills: [{ name: 's', tools: ['action_send_invoice', 'action_triage_case'] }],
    };
    expect(validateAiToolReferences(stack)).toEqual([]);
  });

  // ADR-0011 — the runtime materialises `action_<name>` ONLY for an action
  // that opted in AND has a headless path. Resolving against every declared
  // action would bless a reference the agent can never call: the exact
  // failure this rule exists to catch, one layer down.
  it('does NOT resolve an action that is not AI-exposed', () => {
    const stack = {
      actions: [{ name: 'send_invoice', label: 'Send', type: 'script', target: 'send_invoice' }],
      skills: [{ name: 's', tools: ['action_send_invoice'] }],
    };
    const findings = validateAiToolReferences(stack);
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain('does not become an AI tool');
    expect(findings[0].hint).toContain('ai: { exposed: true');
  });

  it('does NOT resolve a UI-only action type, even when opted in', () => {
    // `modal`/`form`/`url` have no headless invocation path — staying
    // human-driven is a legitimate design answer, and the hint says so.
    for (const type of ['modal', 'form', 'url']) {
      const stack = {
        actions: [{ ...exposed('escalate_case'), type }],
        skills: [{ name: 's', tools: ['action_escalate_case'] }],
      };
      const findings = validateAiToolReferences(stack);
      expect(findings, type).toHaveLength(1);
      expect(findings[0].hint).toContain('stays human-driven by design');
    }
  });

  it('does NOT resolve an exposed action missing its LLM-facing description', () => {
    const stack = {
      actions: [{ name: 'send_invoice', type: 'script', target: 'x', ai: { exposed: true } }],
      skills: [{ name: 's', tools: ['action_send_invoice'] }],
    };
    expect(validateAiToolReferences(stack)).toHaveLength(1);
  });

  it('does NOT resolve a flow/api action with no target to dispatch', () => {
    const stack = {
      actions: [{ name: 'run_it', type: 'flow', ai: { exposed: true, description: 'x'.repeat(45) } }],
      skills: [{ name: 's', tools: ['action_run_it'] }],
    };
    expect(validateAiToolReferences(stack)).toHaveLength(1);
  });

  it('does NOT resolve a bare action name — the tool is the materialised action_<name>', () => {
    // The ADR-0109 default path is `action_<name>`; naming the raw action is
    // the near-miss the hint should catch, via the suggestion.
    const stack = {
      objects: [{ name: 'crm_case', actions: [exposed('triage_case', 'flow')] }],
      skills: [{ name: 's', tools: ['triage_case'] }],
    };
    const findings = validateAiToolReferences(stack);
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain('Did you mean "action_triage_case"?');
  });

  it('resolves trailing-wildcard families against the universe', () => {
    const withActions = {
      objects: [{ name: 'crm_case', actions: [exposed('triage_case', 'flow')] }],
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
