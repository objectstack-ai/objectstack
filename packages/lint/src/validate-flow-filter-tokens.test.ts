// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';

import { validateFlowFilterTokens, FLOW_FILTER_TOKEN_UNKNOWN } from './validate-flow-filter-tokens.js';
import { validateFilterTokens } from './validate-filter-tokens.js';

/** A flow whose `query_stalled` node filters on `value` — #16096's own shape. */
function flowStack(value: unknown): Record<string, unknown> {
  return {
    flows: [
      {
        name: 'opportunity_stagnation',
        nodes: [
          { id: 'query_stalled', type: 'query_records', config: { objectName: 'opportunity', filter: { close_date: { $lt: value } } } },
        ],
      },
    ],
  };
}

/** The card's CONTROL: the identical string in a list view's filter. */
function viewStack(value: unknown): Record<string, unknown> {
  return {
    views: [
      { name: 'account_list', object: 'account', filter: [{ field: 'close_date', operator: 'lt', value }] },
    ],
  };
}

describe('#16096 — the reach gap, reproduced with the card\'s own control', () => {
  it('reports an unresolvable {TOMORROW()} in a flow node config.filter', () => {
    const findings = validateFlowFilterTokens(flowStack('{TOMORROW()}'));
    expect(findings).toHaveLength(1);
    expect(findings[0].rule).toBe(FLOW_FILTER_TOKEN_UNKNOWN);
    expect(findings[0].severity).toBe('error');
    expect(findings[0].where).toBe('flow "opportunity_stagnation"');
    expect(findings[0].path).toBe('flows[0].nodes[0].config.filter.close_date.$lt');
    expect(findings[0].message).toContain('TOMORROW');
    // The consequence claim is the flow one, NOT the view one. A message that
    // said "renders empty" here would be false: the node refuses to run.
    expect(findings[0].message).toContain('cannot run');
    expect(findings[0].message).not.toContain('renders empty');
  });

  it('CONTROL — the same string in a view filter still fires the ORIGINAL rule, unchanged', () => {
    const control = validateFilterTokens(viewStack('{TOMORROW()}'));
    expect(control).toHaveLength(1);
    expect(control[0].rule).toBe('filter-token-unknown');
    expect(control[0].severity).toBe('error');
  });

  it('the original rule STILL does not reach flows — this rule did not widen it', () => {
    expect(validateFilterTokens(flowStack('{TOMORROW()}'))).toEqual([]);
  });

  it('and the new rule does not reach views — the two surfaces stay disjoint', () => {
    expect(validateFlowFilterTokens(viewStack('{TOMORROW()}'))).toEqual([]);
  });
});

describe('the NEGATIVE CONTROL — legitimate flow template tokens stay silent', () => {
  // Triage's binding instruction: a legitimate `{TODAY() - 45}` must stay
  // silent, and it is the easiest thing to regress. It survives only because
  // the date-function form is tried BEFORE the call-position scan.
  const legitimate = [
    '{TODAY() - 45}', '{TODAY()}', '{TODAY() + 90}', '{NOW()}', '{NOW() - 1}',
    '{TODAY()-45}', '{ TODAY() + 7 }',
    '{$User.Id}', '{$User.Email}',
    '{record.id}', '{recordId}', '{currentTask.id}', '{record.target_channels.0}',
    '{round(amount)}', '{max(a, b)}', '{floor(x / 2)}',
    '{current_user_id}', '{current_org_id}', '{today}', '{30_days_ago}', '{week_start}',
    'closed', 42, true, null, 'acme {x} deal', '{a}{b}', '{{x}}',
  ];
  for (const value of legitimate) {
    it(`stays silent on ${JSON.stringify(value)}`, () => {
      expect(validateFlowFilterTokens(flowStack(value))).toEqual([]);
    });
  }
});

describe('the third class — a call to a name NEITHER dialect knows', () => {
  const unresolvable: Array<[string, string]> = [
    ['{TOMORROW()}', 'TOMORROW'],
    ['{YESTERDAY()}', 'YESTERDAY'],
    ['{ROUND(x)}', 'ROUND'],
    ['{DATEADD(day, -45)}', 'DATEADD'],
    ['{Math.round(x)}', 'Math.round'],
    ['{upper(name)}', 'upper'],
  ];
  for (const [value, name] of unresolvable) {
    it(`reports ${value} naming '${name}'`, () => {
      const findings = validateFlowFilterTokens(flowStack(value));
      expect(findings).toHaveLength(1);
      expect(findings[0].message).toContain(name);
    });
  }

  it("prescribes the whole-token form when TODAY() is called in an expression it cannot carry", () => {
    // `{TODAY() - 45 - 10}` misses the `± N` grammar, so the runtime reaches
    // the scan and refuses TODAY in call position. The hint must say why.
    const findings = validateFlowFilterTokens(flowStack('{TODAY() - 45 - 10}'));
    expect(findings).toHaveLength(1);
    expect(findings[0].hint).toContain('whole token');
    expect(findings[0].hint).toContain('± N day offset');
  });

  it("suggests the supported spelling for a case mistake", () => {
    const findings = validateFlowFilterTokens(flowStack('{ROUND(x)}'));
    expect(findings[0].hint).toContain("Did you mean 'round'?");
  });

  it('reports the FIRST unknown call, the one the runtime throws on', () => {
    const findings = validateFlowFilterTokens(flowStack('{FOO(1) + BAR(2)}'));
    expect(findings).toHaveLength(1);
    // Assert on the NAMED call, not on the echoed value — the message quotes
    // the whole authored string, which contains both names.
    expect(findings[0].message).toContain("calls 'FOO'");
    expect(findings[0].message).not.toContain("calls 'BAR'");
  });
});

describe('walk reach', () => {
  it('reaches a filter nested inside a container node (try/catch region)', () => {
    const stack = {
      flows: [{
        name: 'resilient_sync',
        nodes: [{
          id: 'guard', type: 'try_catch',
          config: { catch: { nodes: [{ id: 'purge', type: 'delete_record', config: { filter: { at: '{TOMORROW()}' } } }] } },
        }],
      }],
    };
    const findings = validateFlowFilterTokens(stack);
    expect(findings).toHaveLength(1);
    expect(findings[0].path).toBe('flows[0].nodes[0].config.catch.nodes[0].config.filter.at');
  });

  it('judges every authored filter shape — triples and rule objects too', () => {
    const triple = { flows: [{ name: 'f', nodes: [{ id: 'n', config: { filter: [['close_date', '<', '{TOMORROW()}']] } }] }] };
    const ruleObj = { flows: [{ name: 'f', nodes: [{ id: 'n', config: { filter: [{ field: 'close_date', operator: 'lt', value: '{TOMORROW()}' }] } }] }] };
    expect(validateFlowFilterTokens(triple)).toHaveLength(1);
    expect(validateFlowFilterTokens(ruleObj)).toHaveLength(1);
  });

  it('is a strict SUBSET of what a bare `flows` root addition would report', () => {
    // Every finding this rule emits is one `classifyFilterToken` also calls
    // unknown — the layering the rule is built on, asserted rather than
    // assumed. The converse does NOT hold, which is the whole point.
    for (const value of ['{TOMORROW()}', '{ROUND(x)}', '{recordId}', '{TODAY() - 45}']) {
      const mine = validateFlowFilterTokens(flowStack(value));
      const naive = validateFilterTokens({ ...flowStack(value), views: [{ name: 'v', filter: [{ field: 'f', operator: 'lt', value }] }] });
      if (mine.length > 0) expect(naive.length).toBeGreaterThan(0);
    }
  });

  it('tolerates an absent / malformed flows collection', () => {
    expect(validateFlowFilterTokens(null)).toEqual([]);
    expect(validateFlowFilterTokens({})).toEqual([]);
    expect(validateFlowFilterTokens({ flows: 'nope' })).toEqual([]);
  });

  it('guards a cyclic graph', () => {
    const cyclic: Record<string, unknown> = { filter: {} };
    (cyclic.filter as Record<string, unknown>).self = cyclic;
    expect(() => validateFlowFilterTokens({ flows: [{ name: 'f', nodes: [cyclic] }] })).not.toThrow();
  });
});
