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
  });
});
