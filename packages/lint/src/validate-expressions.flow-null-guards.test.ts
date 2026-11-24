// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #29026 — the null-guard gate on a record-triggered flow's start, edge and
// `decision` branch conditions. `validate-null-guards.test.ts` pins the
// decision procedure; this file pins the wiring: which flows, which slots,
// which bare names, and what the start condition proves downstream. The
// ledger row in `validate-null-guards.ts` carries the runtime measurements.

import { describe, it, expect } from 'vitest';

import { applyInjectedSystemColumns } from '@objectstack/metadata-core';
import { EXPRESSION_INVALID, runAuthoringRules } from './authoring-rules.js';
import { runRuntimeAuthoringRules } from './runtime-gate.js';
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

// #33246 — the runtime publish door hands the rules every object as the
// registry SERVES it: the system columns the registry injects (`created_at`,
// `updated_at`, `owner_id`, …) are declared fields there, `required: false`
// with no default. The platform stamps two of them (`created_at`,
// `updated_at`) on every stored row, so the door's null-guard gate leaves out
// one shape over them, the one `os build` accepts and a stored row cannot
// fault: an ordering comparison (`<`, `<=`, `>`, `>=`) on the CURRENT row's
// column (bare in a flow, or `record.`), in a record-triggered flow or in a
// hook whose every event reads a stamped stored row. Everything else keeps
// `main`'s verdict: arithmetic over either column, a `previous.` read (null on
// an insert), a `beforeInsert` hook (it can run before the stamp), a read-event
// hook (no record), and the other injected columns, which can hold null on a
// stored row. The type verdicts on an injected column are untouched: the door
// keeps the served types.
// #33435 — `os build` reads the objects as authored, with no injected column
// declared, and used to leave every one of them out of the null-guard gate, so
// it accepted what the door refused. The flow and hook condition sites now
// judge the injected columns the authored object does not declare as the door
// judges them over the served object: the six a stored row can hold null in
// at every site, and `created_at` / `updated_at` at a `beforeInsert` hook only.
describe('a flow or hook condition over an injected system column is judged by what a stored row holds, at the publish door and at os build alike (#33246, #33435)', () => {
  /** The trigger object as authored; `sharingModel` keeps `security-owd-unset` quiet. */
  const account = {
    name: 'crm_account',
    label: 'Account',
    sharingModel: 'private',
    fields: { name: { type: 'text', label: 'Name' }, amount: { type: 'number', label: 'Amount' } },
  };
  /** The same object as the registry serves it to the door. */
  const served = applyInjectedSystemColumns(account);

  /** A record-triggered flow with the condition at one of the three slots the gate judges. */
  const flowAt = (slot: 'start' | 'edge' | 'branch', condition: string, objectName = 'crm_account', triggerType = 'record-after-update'): Rec => ({
    name: `at_${slot}`,
    label: 'Probe',
    type: 'autolaunched',
    nodes: [
      {
        id: 'start', type: 'start', label: 'Start',
        config: { objectName, triggerType, ...(slot === 'start' ? { condition } : {}) },
      },
      {
        id: 'triage', type: 'decision', label: 'Triage',
        ...(slot === 'branch' ? { config: { conditions: [{ label: 'hit', expression: condition }, { label: 'rest', expression: 'true' }] } } : {}),
      },
      { id: 'alert', type: 'end', label: 'Alert' },
      { id: 'calm', type: 'end', label: 'Calm' },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'triage' },
      { id: 'e2', source: 'triage', target: 'alert', ...(slot === 'branch' ? { label: 'hit' } : slot === 'edge' ? { condition } : {}) },
      { id: 'e3', source: 'triage', target: 'calm', ...(slot === 'branch' ? { label: 'rest' } : { isDefault: true }) },
    ],
  });
  const hookOn = (object: string | string[], condition: string): Rec => ({
    name: 'probe_hook', object, events: ['beforeUpdate'], condition, body: { language: 'js', source: 'return;' },
  });

  type Write = { type: 'flow' | 'hook'; item: Rec; collection: 'flows' | 'hooks' };
  /** Every site kind the gate judges: three flow slots, a hook on one object and on a list. */
  const writes = (condition: string, objectName = 'crm_account'): Write[] => [
    ...(['start', 'edge', 'branch'] as const).map((slot): Write => ({ type: 'flow', item: flowAt(slot, condition, objectName), collection: 'flows' })),
    { type: 'hook', item: hookOn(objectName, condition), collection: 'hooks' },
    { type: 'hook', item: hookOn([objectName], condition), collection: 'hooks' },
  ];
  const label = (w: Write, condition: string) => `${w.type} ${String(w.item.name)}: ${condition}`;
  const shape = (f: { rule: string; where: string; path?: string; message: string }) =>
    ({ rule: f.rule, where: f.where, path: f.path, message: f.message });
  /** The door's expression findings on the write, over the given objects as served. */
  const atDoor = ({ type, item }: Write, objects: unknown[] = [served]) => {
    const { errors, advisories } = runRuntimeAuthoringRules({ type, item, context: { objects } });
    return [...errors, ...advisories].filter((f) => f.rule === EXPRESSION_INVALID).map(shape);
  };
  /** `os build`'s expression findings on the same item, over the object as authored. */
  const atBuild = ({ item, collection }: Write, objects: unknown[] = [account]) => {
    const stack = { objects, [collection]: [item] };
    return runAuthoringRules('build', { normalized: stack, parsed: stack })
      .filter((f) => f.rule === EXPRESSION_INVALID).map(shape);
  };
  const nullGuardOn = (column: string) => (f: { message: string }) =>
    f.message.includes(`\`record.${column}\``) && f.message.includes('declares as nullable');

  it('serves the trigger object with the injected columns declared, nullable by the field\'s own keys', () => {
    expect(Object.keys(served.fields)).toEqual(expect.arrayContaining([
      'created_at', 'updated_at', 'owner_id', 'created_by', 'updated_by', 'owning_business_unit_id', 'queue',
    ]));
  });

  it('⭐ LIT — an unguarded ordering over `created_at` / `updated_at` publishes at every flow slot and at a hook, as the build accepts it', () => {
    for (const condition of [
      "record.created_at > timestamp('2025-01-01T00:00:00Z')",
      'record.updated_at > record.created_at',
    ]) {
      for (const write of writes(condition)) {
        expect(atDoor(write), label(write, condition)).toEqual([]);
        expect(atBuild(write), label(write, condition)).toEqual([]);
      }
    }
  });

  it('⭐ LIT — an unguarded ordering over an injected column a stored row can hold null in is still refused at the door', () => {
    for (const column of ['owner_id', 'created_by', 'updated_by', 'owning_business_unit_id', 'queue']) {
      const condition = `record.${column} > 'a'`;
      for (const write of writes(condition)) {
        const door = atDoor(write);
        expect(door, label(write, condition)).toHaveLength(1);
        expect(door.filter(nullGuardOn(column)), label(write, condition)).toHaveLength(1);
      }
    }
  });

  it('⭐ LIT — the door keeps its type verdict on an injected column: date arithmetic on `created_at` is refused at a hook, a flow and an action', () => {
    // A hook reads `record.`; a record-triggered flow binds the trigger
    // record's fields as bare names, and the type verdict reads that spelling.
    const cases: Array<[label: string, type: 'flow' | 'hook' | 'action', item: Rec]> = [
      ['hook', 'hook', hookOn('crm_account', 'record.created_at + 1 > 0')],
      ['hook', 'hook', hookOn('crm_account', "record.updated_at - record.created_at > duration('1h')")],
      ['flow start', 'flow', flowAt('start', 'created_at + 1 > 0')],
      ['flow edge', 'flow', flowAt('edge', 'created_at + 1 > 0')],
      ['action', 'action', { name: 'touch', label: 'Touch', objectName: 'crm_account', type: 'script', visible: 'record.created_at + 1 > 0', body: { language: 'js', source: 'return;' } }],
    ];
    for (const [where, type, item] of cases) {
      const { errors } = runRuntimeAuthoringRules({ type, item, context: { objects: [served] } });
      const refused = errors.filter((f) => f.rule === EXPRESSION_INVALID);
      expect(refused.map((f) => f.message).join(' | '), where).toContain('date arithmetic');
    }
  });

  it('⭐ LIT — arithmetic over `created_at` / `updated_at` in a flow\'s `record.` spelling is still refused: the skip covers an ordering comparison only', () => {
    // A record-triggered flow type-checks the bare spelling, not `record.`;
    // for these two shapes the null-guard verdict is the door's only refusal.
    for (const [condition, column] of [
      ['record.created_at + 1 > 0', 'created_at'],
      ["record.updated_at - record.created_at > duration('1h')", 'updated_at'],
    ] as const) {
      const write: Write = { type: 'flow', item: flowAt('start', condition), collection: 'flows' };
      const door = atDoor(write);
      expect(door.filter(nullGuardOn(column)), label(write, condition)).toHaveLength(1);
    }
  });

  it('⭐ LIT — a hook whose events include `beforeInsert` is still judged on `created_at` / `updated_at`: it can run before the stamp', () => {
    const condition = "record.created_at > timestamp('2025-01-01T00:00:00Z')";
    for (const events of [['beforeInsert'], ['beforeInsert', 'beforeUpdate']]) {
      for (const object of ['crm_account', ['crm_account']]) {
        const write: Write = { type: 'hook', item: { ...hookOn(object, condition), events }, collection: 'hooks' };
        expect(atDoor(write).filter(nullGuardOn('created_at')), `${events.join(',')}: ${condition}`).toHaveLength(1);
      }
    }
    // The same condition on an `afterInsert` hook: the row is stamped by then.
    const after: Write = { type: 'hook', item: { ...hookOn('crm_account', condition), events: ['afterInsert'] }, collection: 'hooks' };
    expect(atDoor(after)).toEqual([]);
  });

  it('⭐ LIT — an ordering over `previous.updated_at` is still refused: `previous` is null on an insert', () => {
    const condition = 'record.updated_at > previous.updated_at';
    const cases: Write[] = [
      { type: 'hook', item: { ...hookOn('crm_account', condition), events: ['afterInsert'] }, collection: 'hooks' },
      { type: 'flow', item: flowAt('start', condition, 'crm_account', 'record-after-create'), collection: 'flows' },
    ];
    for (const write of cases) {
      const door = atDoor(write);
      // Only the `previous.` read: the current row's `record.updated_at` is stamped.
      expect(door, label(write, condition)).toHaveLength(1);
      expect(door[0]!.message, label(write, condition)).toContain('`previous.updated_at`');
      expect(door[0]!.message, label(write, condition)).toContain('previous != null && previous.updated_at != null');
    }
  });

  it('⭐ LIT — a hook on a read event is still judged on `created_at`: a read carries no record', () => {
    const condition = "record.created_at > timestamp('2025-01-01T00:00:00Z')";
    for (const events of [['beforeFind'], ['afterFind'], ['afterFind', 'afterUpdate']]) {
      const write: Write = { type: 'hook', item: { ...hookOn('crm_account', condition), events }, collection: 'hooks' };
      expect(atDoor(write).filter(nullGuardOn('created_at')), `${events.join(',')}: ${condition}`).toHaveLength(1);
    }
  });

  it('⭐ CONTROL — `created_at` stays judged where it is not the platform\'s own definition on platform-provisioned storage: an author\'s own declaration, an `external` object', () => {
    const condition = "record.created_at > timestamp('2025-01-01T00:00:00Z')";
    // The author's own column (its own label): the stamp still writes it by
    // name, but the build judges a declared field, and the door gives the
    // build's verdict on it.
    const declared = { ...account, fields: { ...account.fields, created_at: { type: 'datetime', label: 'Opened' } } };
    for (const write of writes(condition)) {
      const door = atDoor(write, [applyInjectedSystemColumns(declared)]);
      expect(door.filter(nullGuardOn('created_at')), label(write, condition)).toHaveLength(1);
      expect(door, label(write, condition)).toEqual(atBuild(write, [declared]));
    }
    // An `external` object: the remote system owns the stored row, so the platform's stamp is no warrant.
    const remote = { ...account, name: 'crm_remote', external: { connector: 'erp', remoteName: 'accounts' } };
    for (const write of writes(condition, 'crm_remote')) {
      expect(atDoor(write, [applyInjectedSystemColumns(remote)]).filter(nullGuardOn('created_at')), label(write, condition)).toHaveLength(1);
    }
  });

  /** The six injected columns a stored row can hold null in. */
  const NULLABLE_INJECTED = ['owner_id', 'created_by', 'updated_by', 'owning_business_unit_id', 'queue', 'organization_id'];

  it('⭐ LIT — os build refuses an unguarded ordering over each injected column a stored row can hold null in, with the door\'s finding, at every flow slot and at a hook', () => {
    for (const column of NULLABLE_INJECTED) {
      const condition = `record.${column} > 'a'`;
      for (const write of writes(condition)) {
        const build = atBuild(write);
        expect(build, label(write, condition)).toHaveLength(1);
        expect(build.filter(nullGuardOn(column)), label(write, condition)).toHaveLength(1);
        expect(build, label(write, condition)).toEqual(atDoor(write));
      }
    }
  });

  it('⭐ LIT — os build judges a flow\'s bare spelling of an injected column as it judges a declared nullable field\'s', () => {
    // The door's per-write snapshot judges no bare name, a declared field's
    // included (the CONTROL leg), so the build is the one reader here.
    for (const [condition, column] of [["owner_id > 'a'", 'owner_id'], ['amount > 0', 'amount']] as const) {
      const write: Write = { type: 'flow', item: flowAt('start', condition), collection: 'flows' };
      const build = atBuild(write);
      expect(build, condition).toHaveLength(1);
      expect(build[0]!.message, condition).toContain(`applies \`>\` to \`${column}\``);
      expect(atDoor(write), condition).toEqual([]);
    }
  });

  // One case per ownership tier, not one case looping the three: each tier is
  // 30 build runs and 30 door runs (six columns × five sites), the cost of the
  // un-tiered build case above. Folded into one case, the three tiers ran
  // about 0.65 s on an idle box and 5.26 s under a full CI run, over the 5 s
  // per-case cap. Every tier, column, site and assertion is still checked.
  for (const ownership of ['business_unit', 'org', 'none'] as const) {
    it(`⭐ LIT — on the \`${ownership}\` ownership tier os build judges exactly the injected columns the tier carries, as the door does`, () => {
      const tiered = { ...account, ownership };
      const servedTier = applyInjectedSystemColumns(tiered);
      for (const column of NULLABLE_INJECTED) {
        const condition = `record.${column} > 'a'`;
        for (const write of writes(condition)) {
          const build = atBuild(write, [tiered]);
          expect(build.filter(nullGuardOn(column)).length, `${ownership} · ${label(write, condition)}`)
            .toBe(column in servedTier.fields ? 1 : 0);
          expect(build, `${ownership} · ${label(write, condition)}`).toEqual(atDoor(write, [servedTier]));
        }
      }
    });
  }

  it('⭐ LIT — os build refuses an ordering over `created_at` / `updated_at` at a `beforeInsert` hook, and only there, as the door does', () => {
    for (const condition of [
      "record.created_at > timestamp('2025-01-01T00:00:00Z')",
      'record.updated_at > record.created_at',
    ]) {
      for (const events of [['beforeInsert'], ['beforeInsert', 'beforeUpdate']]) {
        for (const object of ['crm_account', ['crm_account']]) {
          const write: Write = { type: 'hook', item: { ...hookOn(object, condition), events }, collection: 'hooks' };
          expect(atBuild(write).filter((f) => f.message.includes('declares as nullable')).length, `${events.join(',')}: ${condition}`)
            .toBeGreaterThan(0);
          expect(atBuild(write), `${events.join(',')}: ${condition}`).toEqual(atDoor(write));
        }
      }
      // A hook on a stamped stored row, and every flow slot: the build accepts, as the door does.
      for (const write of [
        ...writes(condition),
        { type: 'hook', item: { ...hookOn('crm_account', condition), events: ['afterInsert'] }, collection: 'hooks' } as Write,
      ]) {
        expect(atBuild(write), label(write, condition)).toEqual([]);
        expect(atDoor(write), label(write, condition)).toEqual([]);
      }
    }
  });

  it('⭐ CONTROL — the guarded spelling publishes and builds over every injected column', () => {
    for (const column of NULLABLE_INJECTED) {
      const condition = `record.${column} != null && record.${column} > 'a'`;
      for (const write of writes(condition)) {
        expect(atBuild(write), label(write, condition)).toEqual([]);
        expect(atDoor(write), label(write, condition)).toEqual([]);
      }
    }
  });

  it('⭐ CONTROL — an injected column the author declares keeps the author\'s verdict at the build, as at the door', () => {
    // `required: true` is the author's own claim that the column is valued.
    const declared = { ...account, fields: { ...account.fields, owner_id: { type: 'lookup', reference: 'sys_user', label: 'Owner', required: true } } };
    const condition = "record.owner_id > 'a'";
    for (const write of writes(condition)) {
      expect(atBuild(write, [declared]), label(write, condition)).toEqual([]);
      expect(atDoor(write, [applyInjectedSystemColumns(declared)]), label(write, condition)).toEqual([]);
    }
  });

  it('⭐ CONTROL — a validation rule over an injected column keeps its verdict: the build judges declared fields only there, as the object door does', () => {
    const ruled = { ...account, validations: [{ name: 'owner_named', type: 'script', condition: "record.owner_id > 'a'", message: 'Owner' }] };
    const stack = { objects: [ruled] };
    const build = runAuthoringRules('build', { normalized: stack, parsed: stack }).filter((f) => f.rule === EXPRESSION_INVALID).map(shape);
    expect(build).toEqual([]);
    const { errors, advisories } = runRuntimeAuthoringRules({ type: 'object', item: ruled, context: { objects: [served] } });
    expect([...errors, ...advisories].filter((f) => f.rule === EXPRESSION_INVALID)).toEqual([]);
  });

  it('⭐ CONTROL — an unguarded ordering over a declared nullable field is refused at the door and at the build alike', () => {
    for (const write of writes('record.amount > 0')) {
      const door = atDoor(write);
      expect(door, label(write, 'record.amount > 0')).toHaveLength(1);
      expect(door[0]!.message).toContain('declares as nullable');
      expect(door, label(write, 'record.amount > 0')).toEqual(atBuild(write));
    }
  });
});
