import { describe, it, expect } from 'vitest';
import { validateStackExpressions } from './validate-expressions.js';

describe('validateStackExpressions (ADR-0032 build-time)', () => {
  const objects = [
    { name: 'crm_lead', fields: { rating: { type: 'number' }, status: { type: 'text' } } },
  ];

  it('passes a clean stack', () => {
    const issues = validateStackExpressions({
      objects,
      flows: [{
        name: 'lead_flow',
        nodes: [
          { id: 'start', type: 'start', config: { objectName: 'crm_lead' } },
          { id: 'check', type: 'decision', config: { condition: 'record.rating >= 4' } },
        ],
        edges: [{ id: 'e1', source: 'check', target: 'end', condition: 'record.rating < 4' }],
      }],
    });
    expect(issues).toHaveLength(0);
  });

  it('flags a brace-in-CEL condition with location + corrective message', () => {
    const issues = validateStackExpressions({
      objects,
      flows: [{
        name: 'lead_flow',
        nodes: [
          { id: 'start', type: 'start', config: { objectName: 'crm_lead' } },
          { id: 'check', type: 'decision', config: { condition: '{record.rating} >= 4' } },
        ],
        edges: [],
      }],
    });
    expect(issues).toHaveLength(1);
    expect(issues[0].where).toContain("flow 'lead_flow'");
    expect(issues[0].where).toContain("node 'check'");
    expect(issues[0].message).toMatch(/map literal|bare reference/);
    expect(issues[0].source).toBe('{record.rating} >= 4');
  });

  it('flags an unknown record field against the resolved schema (did-you-mean)', () => {
    const issues = validateStackExpressions({
      objects,
      flows: [{
        name: 'lead_flow',
        nodes: [
          { id: 'start', type: 'start', config: { objectName: 'crm_lead' } },
          { id: 'check', type: 'decision', config: { condition: 'record.raitng >= 4' } },
        ],
        edges: [],
      }],
    });
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toMatch(/unknown field `raitng`/);
    expect(issues[0].message).toMatch(/did you mean `rating`/);
  });

  it('validates object validation-rule predicates too', () => {
    const issues = validateStackExpressions({
      objects: [
        { name: 'crm_lead', fields: { rating: {} }, validations: [{ name: 'r1', expression: '{record.rating} > 0' }] },
      ],
    });
    expect(issues).toHaveLength(1);
    expect(issues[0].where).toContain("validation 'r1'");
  });

  // #1870 — a `script` node that names no callable is a silent no-op.
  it('flags a script node that declares neither actionType nor function (#1870)', () => {
    const issues = validateStackExpressions({
      flows: [{
        name: 'helpdesk_flow',
        nodes: [
          { id: 'start', type: 'start', config: {} },
          { id: 'triage', type: 'script', config: { actionType: undefined } },
        ],
        edges: [],
      }],
    });
    expect(issues).toHaveLength(1);
    expect(issues[0].where).toContain("node 'triage' (script) callable");
    expect(issues[0].message).toMatch(/neither .*actionType.* nor .*function/);
  });

  it('accepts a script node that names a built-in action or a function (#1870)', () => {
    const issues = validateStackExpressions({
      flows: [{
        name: 'helpdesk_flow',
        nodes: [
          { id: 'start', type: 'start', config: {} },
          { id: 'mail', type: 'script', config: { actionType: 'email' } },
          { id: 'triage', type: 'script', config: { function: 'helpdesk.aiTriageStub' } },
          { id: 'inline', type: 'script', config: { script: 'variables.x = 1;' } },
        ],
        edges: [],
      }],
    });
    expect(issues).toHaveLength(0);
  });

  // #1870 DX — `functionName` is an accepted alias for `function`.
  it('accepts a script node that names a callable via the functionName alias', () => {
    const issues = validateStackExpressions({
      flows: [{
        name: 'helpdesk_flow',
        nodes: [
          { id: 'start', type: 'start', config: {} },
          { id: 'triage', type: 'script', config: { actionType: 'invoke_function', functionName: 'helpdesk.aiTriageStub' } },
        ],
        edges: [],
      }],
    });
    expect(issues).toHaveLength(0);
  });

  it('flags actionType invoke_function with no function/functionName', () => {
    const issues = validateStackExpressions({
      flows: [{
        name: 'helpdesk_flow',
        nodes: [
          { id: 'start', type: 'start', config: {} },
          { id: 'triage', type: 'script', config: { actionType: 'invoke_function', inputs: { x: 1 } } },
        ],
        edges: [],
      }],
    });
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toMatch(/invoke_function.*no .*function/i);
  });

  // #1928 — bare field references are silently null in `record`-scoped sites
  // (field formulas + validation predicates) but correct in flattened flow
  // conditions. The validator wires the scope per site.
  describe('bare-reference detection by site scope (#1928)', () => {
    it('flags a bare reference in a field formula', () => {
      const issues = validateStackExpressions({
        objects: [{
          name: 'crm_opportunity',
          fields: {
            amount: { type: 'currency' },
            probability: { type: 'percent' },
            expected_revenue: { type: 'formula', name: 'expected_revenue', formula: 'amount * probability / 100' },
          },
        }],
      });
      expect(issues).toHaveLength(1);
      expect(issues[0].where).toContain("field 'expected_revenue' formula");
      expect(issues[0].message).toMatch(/bare reference `(amount|probability)`/);
    });

    it('flags a bare reference in a validation predicate', () => {
      const issues = validateStackExpressions({
        objects: [{
          name: 'crm_lead',
          fields: { lead_score: { type: 'number' } },
          validations: [{ name: 'lead_score_range', expression: 'lead_score != null && lead_score > 100' }],
        }],
      });
      expect(issues).toHaveLength(1);
      expect(issues[0].where).toContain("validation 'lead_score_range'");
      expect(issues[0].message).toMatch(/bare reference `lead_score`/);
    });

    it('accepts the record-qualified forms', () => {
      const issues = validateStackExpressions({
        objects: [{
          name: 'crm_opportunity',
          fields: {
            amount: { type: 'currency' },
            probability: { type: 'percent' },
            expected_revenue: { type: 'formula', name: 'expected_revenue', formula: 'record.amount * record.probability / 100' },
          },
          validations: [{ name: 'amt', expression: 'record.amount != null && record.amount >= 0' }],
        }],
      });
      expect(issues).toHaveLength(0);
    });

    it('does NOT flag bare references in a flow condition (flattened scope)', () => {
      const issues = validateStackExpressions({
        objects: [{ name: 'crm_opportunity', fields: { stage: { type: 'select' }, amount: { type: 'currency' } } }],
        flows: [{
          name: 'high_value_deal',
          nodes: [
            { id: 'start', type: 'start', config: { objectName: 'crm_opportunity', condition: 'amount > 100000 && previous.amount <= 100000' } },
          ],
          edges: [{ id: 'e1', source: 'start', target: 'end', condition: 'stage != "closed_won"' }],
        }],
      });
      expect(issues).toHaveLength(0);
    });

    // #1928 tier 3 — a likely field typo in a flow condition is a non-blocking warning.
    it('warns (severity=warning) on a likely field typo in a flow condition', () => {
      const issues = validateStackExpressions({
        objects: [{ name: 'crm_opportunity', fields: { stage: { type: 'select' }, amount: { type: 'currency' } } }],
        flows: [{
          name: 'opp_won',
          nodes: [
            { id: 'start', type: 'start', config: { objectName: 'crm_opportunity', condition: 'stagee == "closed_won"' } },
          ],
          edges: [],
        }],
      });
      expect(issues).toHaveLength(1);
      expect(issues[0].severity).toBe('warning');
      expect(issues[0].message).toMatch(/did you mean `stage`/);
    });

    it('does not warn when the bare ref is far from any field (likely a flow variable)', () => {
      const issues = validateStackExpressions({
        objects: [{ name: 'crm_opportunity', fields: { stage: { type: 'select' } } }],
        flows: [{
          name: 'renewal',
          nodes: [{ id: 'start', type: 'start', config: { objectName: 'crm_opportunity' } }],
          edges: [{ id: 'e1', source: 'start', target: 'end', condition: 'expiring_deals.length > 0' }],
        }],
      });
      expect(issues).toHaveLength(0);
    });

    it('tags record-scoped bare-ref issues as errors', () => {
      const issues = validateStackExpressions({
        objects: [{
          name: 'crm_lead',
          fields: { lead_score: { type: 'number' } },
          validations: [{ name: 'r', expression: 'lead_score > 100' }],
        }],
      });
      expect(issues).toHaveLength(1);
      expect(issues[0].severity).toBe('error');
    });
  });

  describe('action visible/disabled predicates (record-scoped) — #2183 class', () => {
    it('flags a bare-field `visible` on a stack action (the trap that hid Mark Done)', () => {
      const issues = validateStackExpressions({
        objects: [{ name: 'showcase_task', fields: { done: { type: 'boolean' }, status: { type: 'select' } } }],
        actions: [{ name: 'mark_done', objectName: 'showcase_task', type: 'script', locations: ['record_header'], visible: '!done' }],
      });
      const v = issues.filter(i => i.where.includes("action 'mark_done' visible"));
      expect(v).toHaveLength(1);
      expect(v[0].severity).toBe('error');
      expect(v[0].message).toMatch(/bare reference `done`/);
    });

    it('accepts the record-qualified form', () => {
      const issues = validateStackExpressions({
        objects: [{ name: 'showcase_task', fields: { done: { type: 'boolean' } } }],
        actions: [{ name: 'mark_done', objectName: 'showcase_task', type: 'script', visible: '!record.done' }],
      });
      expect(issues).toHaveLength(0);
    });

    it('accepts ambient globals (ctx / features / user) used by platform actions', () => {
      const issues = validateStackExpressions({
        objects: [{ name: 'sys_user', fields: { id: { type: 'text' }, email_verified: { type: 'boolean' } } }],
        actions: [{ name: 'verify_email', objectName: 'sys_user', visible: 'record.id == ctx.user.id && record.email_verified == false && features.x != true' }],
      });
      expect(issues).toHaveLength(0);
    });

    it('flags a bare-field `disabled` predicate but ignores a boolean `disabled`', () => {
      const bad = validateStackExpressions({
        objects: [{ name: 'crm_lead', fields: { status: { type: 'select' } } }],
        actions: [{ name: 'park', objectName: 'crm_lead', disabled: 'status == "converted"' }],
      });
      expect(bad.filter(i => i.where.includes("action 'park' disabled"))).toHaveLength(1);

      const ok = validateStackExpressions({
        objects: [{ name: 'crm_lead', fields: { status: { type: 'select' } } }],
        actions: [{ name: 'park', objectName: 'crm_lead', disabled: true }],
      });
      expect(ok).toHaveLength(0);
    });

    it('validates an action attached to an object (record scope = parent object)', () => {
      const issues = validateStackExpressions({
        objects: [{
          name: 'showcase_task',
          fields: { done: { type: 'boolean' } },
          actions: [{ name: 'mark_done', type: 'script', visible: '!done' }],
        }],
      });
      expect(issues.filter(i => i.where.includes("action 'mark_done' visible"))).toHaveLength(1);
    });
  });

  describe('record-scoped coverage extensions (field rules / sharing / hooks / nested when)', () => {
    it('flags a bare-field `readonlyWhen`/`requiredWhen` on a field', () => {
      const issues = validateStackExpressions({
        objects: [{
          name: 'showcase_task',
          fields: {
            done: { type: 'boolean', readonlyWhen: 'done == true' },
            title: { type: 'text', requiredWhen: 'status == "x"' },
          },
        }],
      });
      expect(issues.some(i => i.where.includes('readonlyWhen') && /bare reference `done`/.test(i.message))).toBe(true);
      expect(issues.some(i => i.where.includes('requiredWhen') && /bare reference `status`/.test(i.message))).toBe(true);
    });

    it('accepts record-qualified field rules and the master-detail `parent` namespace', () => {
      const issues = validateStackExpressions({
        objects: [{
          name: 'inv_line',
          fields: {
            qty: { type: 'number', readonlyWhen: "parent.status == 'paid'" },
            note: { type: 'text', requiredWhen: 'record.qty >= 100' },
          },
        }],
      });
      expect(issues).toHaveLength(0);
    });

    it('flags a bare-field sharing-rule condition', () => {
      const issues = validateStackExpressions({
        objects: [{ name: 'crm_account', fields: { region: { type: 'text' } } }],
        sharingRules: [{ name: 'sales_region', object: 'crm_account', condition: 'region == "EMEA"' }],
      });
      expect(issues.some(i => i.where.includes("sharingRule 'sales_region'") && /bare reference `region`/.test(i.message))).toBe(true);
    });

    it('flags a bare-field hook condition', () => {
      const issues = validateStackExpressions({
        objects: [{ name: 'crm_lead', fields: { status: { type: 'select' } } }],
        hooks: [{ name: 'on_close', object: 'crm_lead', condition: 'status == "closed"' }],
      });
      expect(issues.some(i => i.where.includes("hook 'on_close'") && /bare reference `status`/.test(i.message))).toBe(true);
    });

    it('flags a bare-field nested `when` on a conditional validation rule', () => {
      const issues = validateStackExpressions({
        objects: [{
          name: 'crm_account',
          fields: { tier: { type: 'select' } },
          validations: [{ name: 'cond', type: 'conditional', when: 'tier == "gold"', then: { type: 'required' } }],
        }],
      });
      expect(issues.some(i => i.where.includes('when') && /bare reference `tier`/.test(i.message))).toBe(true);
    });
  });
});
