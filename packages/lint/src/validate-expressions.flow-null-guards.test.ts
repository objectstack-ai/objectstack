// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #29026 — the null-guard gate on a record-triggered flow's start, edge and
// `decision` branch conditions. `validate-null-guards.test.ts` pins the
// decision procedure; this file pins the wiring: which flows, which slots,
// which bare names, and what the start condition proves downstream. The
// ledger row in `validate-null-guards.ts` carries the runtime measurements.

import { describe, it, expect } from 'vitest';

import { runStackExpressionPasses, validateStackExpressions } from './validate-expressions.js';

// `budget` and `owner` are optional, as on `showcase_project`; `name` is
// required and `spent` has a default, so neither may ever be flagged.
const project = {
  name: 'showcase_project',
  fields: {
    name: { type: 'text', required: true },
    owner: { type: 'text' },
    health: { type: 'select', options: [{ value: 'green', default: true }, { value: 'red' }] },
    budget: { type: 'currency' },
    spent: { type: 'currency', defaultValue: 0 },
  },
};

type Rec = Record<string, unknown>;

const start = (config: Rec = {}): Rec => ({
  id: 'start',
  type: 'start',
  config: { objectName: 'showcase_project', triggerType: 'record-after-update', ...config },
});

const flow = (overrides: Rec): Rec => ({
  name: 'escalate',
  label: 'Escalate',
  type: 'autolaunched',
  nodes: [start(), { id: 'triage', type: 'decision' }, { id: 'alert', type: 'end' }, { id: 'calm', type: 'end' }],
  edges: [
    { id: 'e1', source: 'start', target: 'triage' },
    { id: 'e2', source: 'triage', target: 'alert', condition: 'budget > 200000' },
    { id: 'e3', source: 'triage', target: 'calm', isDefault: true },
  ],
  ...overrides,
});

/** The null-guard findings alone — other passes judge other things about these flows. */
const nullGuardIssues = (flows: Rec[]) =>
  validateStackExpressions({ objects: [project], flows }).filter((i) => i.message.includes('declares as nullable'));

describe('flow conditions under the null-guard gate (#29026)', () => {
  it('rejects the bare unguarded comparison that failed the showcase escalation run', () => {
    const issues = nullGuardIssues([flow({})]);
    expect(issues).toHaveLength(1);
    const [issue] = issues;
    expect(issue!.severity).toBe('error');
    expect(issue!.where).toContain("edge 'e2'");
    expect(issue!.path).toBe('flows[0].edges[1].condition');
    expect(issue!.message).toContain('`budget`');
    expect(issue!.message).toContain('the flow run fails at this condition');
    expect(issue!.message).toContain("Guard it with '!= null'");
  });

  it('rejects the `record.` spelling too, and accepts either guarded spelling', () => {
    const edges = (condition: string) => [
      { id: 'e1', source: 'start', target: 'triage' },
      { id: 'e2', source: 'triage', target: 'alert', condition },
      { id: 'e3', source: 'triage', target: 'calm', isDefault: true },
    ];
    expect(nullGuardIssues([flow({ edges: edges('record.budget > 200000') })])).toHaveLength(1);
    expect(nullGuardIssues([flow({ edges: edges('record.budget != null && record.budget > 200000') })])).toEqual([]);
    expect(nullGuardIssues([flow({ edges: edges('budget != null && budget > 200000') })])).toEqual([]);
    // `has()` is true on the materialized null, so it is no guard here either.
    const hasOnly = nullGuardIssues([flow({ edges: edges('has(record.budget) && record.budget > 200000') })]);
    expect(hasOnly).toHaveLength(1);
    expect(hasOnly[0]!.message).toContain('`has(record.budget)` does not guard it');
  });

  it('judges the start condition, and presumes what it proves at every edge downstream', () => {
    const unguardedStart = nullGuardIssues([flow({
      nodes: [start({ condition: 'health == "red" && budget > 100000' }), { id: 'triage', type: 'decision' }, { id: 'alert', type: 'end' }, { id: 'calm', type: 'end' }],
      edges: [{ id: 'e1', source: 'start', target: 'triage' }],
    })]);
    expect(unguardedStart).toHaveLength(1);
    expect(unguardedStart[0]!.where).toContain("node 'start' (start) condition");
    expect(unguardedStart[0]!.path).toBe('flows[0].nodes[0].config.condition');

    // The start condition gates every run, so its guard holds at e2.
    expect(nullGuardIssues([flow({
      nodes: [start({ condition: 'budget != null && budget > 100000' }), { id: 'triage', type: 'decision' }, { id: 'alert', type: 'end' }, { id: 'calm', type: 'end' }],
    })])).toEqual([]);
  });

  it('records the two doors disagreeing on a BARE start guard: the runtime publish gate refuses what `os validate` accepts (#29491)', () => {
    const guardedBy = (condition: string) => flow({
      nodes: [start({ condition }), { id: 'triage', type: 'decision' }, { id: 'alert', type: 'end' }, { id: 'calm', type: 'end' }],
      edges: [
        { id: 'e1', source: 'start', target: 'triage' },
        { id: 'e2', source: 'triage', target: 'alert', condition: 'record.budget > 200000' },
        { id: 'e3', source: 'triage', target: 'calm', isDefault: true },
      ],
    });
    const atRuntimeGate = (f: Rec) =>
      runStackExpressionPasses({ objects: [project], flows: [f] }, { runtimeWriteType: 'flow' })
        .filter((i) => i.message.includes('declares as nullable'));

    // A bare guard: the build door proves `record.budget` from it, the runtime
    // door cannot (its bound set is not provable), so only the runtime refuses.
    const bare = guardedBy('budget != null');
    expect(nullGuardIssues([bare])).toEqual([]);
    const refused = atRuntimeGate(bare);
    expect(refused).toHaveLength(1);
    expect(refused[0]!.where).toContain("edge 'e2'");

    // The `record.` spelling of the same guard is accepted at both doors.
    const spelled = guardedBy('record.budget != null');
    expect(nullGuardIssues([spelled])).toEqual([]);
    expect(atRuntimeGate(spelled)).toEqual([]);
  });

  it('judges a `decision` branch expression', () => {
    const issues = nullGuardIssues([flow({
      nodes: [
        start(),
        { id: 'triage', type: 'decision', config: { conditions: [{ label: 'critical', expression: 'record.budget > 200000' }, { label: 'normal', expression: 'true' }] } },
        { id: 'alert', type: 'end' },
        { id: 'calm', type: 'end' },
      ],
      edges: [{ id: 'e1', source: 'start', target: 'triage' }],
    })]);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.where).toContain('conditions[0].expression');
  });

  it('judges an edge inside a container region', () => {
    const issues = nullGuardIssues([flow({
      nodes: [
        start(),
        {
          id: 'fan',
          type: 'parallel',
          config: {
            branches: [{
              name: 'Owner',
              nodes: [{ id: 'gate', type: 'decision' }, { id: 'ping', type: 'end' }],
              edges: [{ id: 'b1', source: 'gate', target: 'ping', condition: 'record.budget * 2 > 10' }],
            }],
          },
        },
      ],
      edges: [{ id: 'e1', source: 'start', target: 'fan' }],
    })]);
    expect(issues).toHaveLength(1);
    expect(issues[0]!.where).toContain("edge 'b1'");
  });

  it('leaves a flow with no record trigger alone: nothing makes its record total', () => {
    const noTrigger = flow({ nodes: [{ id: 'start', type: 'start', config: { objectName: 'showcase_project' } }, { id: 'triage', type: 'decision' }, { id: 'alert', type: 'end' }, { id: 'calm', type: 'end' }] });
    expect(nullGuardIssues([noTrigger])).toEqual([]);
    const api = flow({ type: 'api', nodes: [{ id: 'start', type: 'start', config: { objectName: 'showcase_project', triggerType: 'api' } }, { id: 'triage', type: 'decision' }, { id: 'alert', type: 'end' }, { id: 'calm', type: 'end' }] });
    expect(nullGuardIssues([api])).toEqual([]);
  });

  it('leaves a bare name a declared variable holds alone — the variable wins — and still judges `record.`', () => {
    const variables = [{ name: 'budget', type: 'number', defaultValue: 5 }];
    expect(nullGuardIssues([flow({ variables })])).toEqual([]);
    const issues = nullGuardIssues([flow({
      variables,
      edges: [
        { id: 'e1', source: 'start', target: 'triage' },
        { id: 'e2', source: 'triage', target: 'alert', condition: 'record.budget > 200000' },
        { id: 'e3', source: 'triage', target: 'calm', isDefault: true },
      ],
    })]);
    expect(issues).toHaveLength(1);
  });

  it('leaves bare names alone on a flow whose nodes can bind names nobody declared', () => {
    const withScript = (condition: string) => flow({
      nodes: [start(), { id: 'calc', type: 'script', config: { function: 'calc' } }, { id: 'triage', type: 'decision' }, { id: 'alert', type: 'end' }, { id: 'calm', type: 'end' }],
      edges: [
        { id: 'e0', source: 'start', target: 'calc' },
        { id: 'e1', source: 'calc', target: 'triage' },
        { id: 'e2', source: 'triage', target: 'alert', condition },
        { id: 'e3', source: 'triage', target: 'calm', isDefault: true },
      ],
    });
    expect(nullGuardIssues([withScript('budget > 200000')])).toEqual([]);
    expect(nullGuardIssues([withScript('record.budget > 200000')])).toHaveLength(1);
  });

  it('does not judge an inert `config.condition` on a non-start node', () => {
    expect(nullGuardIssues([flow({
      nodes: [start(), { id: 'triage', type: 'decision', config: { condition: 'record.budget > 1' } }, { id: 'alert', type: 'end' }, { id: 'calm', type: 'end' }],
      edges: [{ id: 'e1', source: 'start', target: 'triage' }],
    })])).toEqual([]);
  });

  it('treats a `count` / `sum` roll-up as always valued, and a `max` one as nullable', () => {
    // Zero children is zero for `count` / `sum` (objectql's
    // `summaryEmptySetValue`); `min` / `max` / `avg` over no rows is `null`.
    const report = {
      name: 'expense_report',
      fields: {
        status: { type: 'select', options: [{ value: 'draft', default: true }, { value: 'submitted' }] },
        total_amount: { type: 'summary', summaryOperations: { object: 'expense_line', field: 'amount', function: 'sum' } },
        line_count: { type: 'summary', summaryOperations: { object: 'expense_line', function: 'count' } },
        largest_line: { type: 'summary', summaryOperations: { object: 'expense_line', field: 'amount', function: 'max' } },
      },
    };
    const quorum = (condition: string): Rec => ({
      name: 'quorum',
      label: 'Quorum',
      type: 'autolaunched',
      nodes: [{ id: 'start', type: 'start', config: { objectName: 'expense_report', triggerType: 'record-after-update', condition } }, { id: 'end', type: 'end' }],
      edges: [{ id: 'e1', source: 'start', target: 'end' }],
    });
    const judge = (condition: string) =>
      validateStackExpressions({ objects: [report], flows: [quorum(condition)] })
        .filter((i) => i.message.includes('declares as nullable'));
    expect(judge('status == "submitted" && total_amount >= 5000 && line_count > 1')).toEqual([]);
    expect(judge('largest_line > 1000').map((i) => i.message)).toEqual([expect.stringContaining('`largest_line`')]);
  });

  it('never flags a non-nullable field', () => {
    expect(nullGuardIssues([flow({
      edges: [{ id: 'e1', source: 'start', target: 'triage' }, { id: 'e2', source: 'triage', target: 'alert', condition: 'spent > 5 && size(name) > 1' }],
    })])).toEqual([]);
  });
});
