// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import {
  lintFlowPatterns,
  FLOW_TIME_RELATIVE_ANTIPATTERN,
  FLOW_DATE_EQUALITY_FILTER,
  FLOW_PHANTOM_AGGREGATION,
  FLOW_DOUBLE_BRACE_INTERP,
  FLOW_BARE_DOLLAR_REF,
  FLOW_APPROVAL_REVISE_DEAD_END,
  FLOW_APPROVAL_REVISE_UNMARKED_BACKEDGE,
  FLOW_APPROVAL_REVISE_DISABLED,
  FLOW_RUNAS_UNSCOPED,
} from './lint-flow-patterns.js';

const CEL = (source: string) => ({ dialect: 'cel', source });
/**
 * A scheduled flow with a get_record node carrying `filter`. Declares
 * `runAs: 'system'` so it is the correct shape for a scheduled data flow and
 * does not also trip the user-less runAs lint (FLOW_RUNAS_UNSCOPED) —
 * keeping these date-equality cases focused on the filter rule.
 */
const filterFlow = (filter: unknown) => ({
  flows: [{
    name: 'expiry_alert',
    runAs: 'system',
    nodes: [
      { id: 'start', type: 'start', config: { triggerType: 'schedule', schedule: 'cron:0 9 * * *' } },
      { id: 'query', type: 'get_record', config: { objectName: 'contract', filter } },
    ],
    edges: [],
  }],
});

const flow = (condition: unknown, triggerType = 'record-after-update') => ({
  flows: [{
    name: 'renewal_alert',
    nodes: [{ id: 'start', type: 'start', config: { objectName: 'contract', triggerType, condition } }],
    edges: [],
  }],
});

describe('lintFlowPatterns — time-relative anti-pattern (#1874)', () => {
  it('flags record-change date-EQUALITY against a time function', () => {
    const fnds = lintFlowPatterns(flow('end_date == daysFromNow(60)'));
    expect(fnds).toHaveLength(1);
    expect(fnds[0].rule).toBe(FLOW_TIME_RELATIVE_ANTIPATTERN);
    expect(fnds[0].where).toContain("renewal_alert");
    expect(fnds[0].hint).toMatch(/schedule/i);
  });

  it('flags the function-on-the-left form too', () => {
    expect(lintFlowPatterns(flow('today() != record.start_date'))).toHaveLength(1);
  });

  it('flags an Expression-envelope condition', () => {
    expect(lintFlowPatterns(flow({ dialect: 'cel', source: 'record.due == daysFromNow(7)' }))).toHaveLength(1);
  });

  describe('does NOT flag (false-positive guards)', () => {
    it('a RANGE comparison (the correct building block)', () => {
      expect(lintFlowPatterns(flow('end_date <= daysFromNow(60)'))).toHaveLength(0);
      expect(lintFlowPatterns(flow('end_date >= daysFromNow(7) && end_date <= daysFromNow(30)'))).toHaveLength(0);
    });
    it('equality on a non-time field', () => {
      expect(lintFlowPatterns(flow('status == "expired"'))).toHaveLength(0);
    });
    it('a SCHEDULE trigger (only record-* triggers are linted)', () => {
      expect(lintFlowPatterns(flow('end_date == daysFromNow(60)', 'schedule'))).toHaveLength(0);
    });
    it('no condition', () => {
      expect(lintFlowPatterns(flow(undefined))).toHaveLength(0);
    });
  });
});

describe('lintFlowPatterns — date-equality in query filter (#1874)', () => {
  it('flags a field bound directly to a time value (implicit equality)', () => {
    const fnds = lintFlowPatterns(filterFlow({ expires_at: CEL('daysFromNow(30)') }));
    expect(fnds).toHaveLength(1);
    expect(fnds[0].rule).toBe(FLOW_DATE_EQUALITY_FILTER);
    expect(fnds[0].hint).toMatch(/\$gte.*daysFromNow\(N\).*\$lt/);
  });

  it('flags `$in` against time values (the original renewal_alert bug)', () => {
    const fnds = lintFlowPatterns(filterFlow({
      status: 'active',
      end_date: { $in: [CEL('daysFromNow(60)'), CEL('daysFromNow(30)'), CEL('daysFromNow(7)')] },
    }));
    expect(fnds).toHaveLength(1);
    expect(fnds[0].rule).toBe(FLOW_DATE_EQUALITY_FILTER);
  });

  it('flags `$eq` against a time value', () => {
    expect(lintFlowPatterns(filterFlow({ d: { $eq: CEL('today()') } }))).toHaveLength(1);
  });

  describe('does NOT flag (false-positive guards)', () => {
    it('a one-day window (the correct fix)', () => {
      expect(lintFlowPatterns(filterFlow({
        end_date: { $gte: CEL('daysFromNow(7)'), $lt: CEL('daysFromNow(8)') },
      }))).toHaveLength(0);
    });
    it('multi-tier windows wrapped in $or', () => {
      expect(lintFlowPatterns(filterFlow({
        status: 'active',
        $or: [
          { end_date: { $gte: CEL('daysFromNow(7)'), $lt: CEL('daysFromNow(8)') } },
          { end_date: { $gte: CEL('daysFromNow(30)'), $lt: CEL('daysFromNow(31)') } },
        ],
      }))).toHaveLength(0);
    });
    it('a plain range like `due_date < today()` (overdue query)', () => {
      expect(lintFlowPatterns(filterFlow({ status: 'open', due_date: { $lt: CEL('today()') } }))).toHaveLength(0);
    });
    it('equality against a non-time value (status, interpolated id)', () => {
      expect(lintFlowPatterns(filterFlow({ status: 'active', id: '{record.id}' }))).toHaveLength(0);
      expect(lintFlowPatterns(filterFlow({ amount: { $eq: CEL('record.threshold') } }))).toHaveLength(0);
    });
  });
});

describe('lintFlowPatterns — phantom aggregation capability (#1870)', () => {
  const scriptNode = (config: Record<string, unknown>) => ({
    flows: [{
      name: 'rollup',
      nodes: [
        { id: 'start', type: 'start', config: {} },
        { id: 'sum', type: 'script', config },
      ],
      edges: [],
    }],
  });

  it('flags `aggregations` on a script node (publication_rollup bug)', () => {
    const fnds = lintFlowPatterns(scriptNode({ aggregations: { total: { sum: 'amount' } } }));
    expect(fnds).toHaveLength(1);
    expect(fnds[0].rule).toBe(FLOW_PHANTOM_AGGREGATION);
    expect(fnds[0].hint).toMatch(/Field\.summary/);
  });

  it('flags groupBy / rollup / aggregate / having too', () => {
    for (const key of ['groupBy', 'rollup', 'aggregate', 'having']) {
      expect(lintFlowPatterns(scriptNode({ [key]: {} })).map((f) => f.rule)).toContain(FLOW_PHANTOM_AGGREGATION);
    }
  });

  it('does NOT flag an ordinary script/function node', () => {
    expect(lintFlowPatterns(scriptNode({ function: 'helpdesk.triage', inputs: { x: 1 } }))).toHaveLength(0);
  });
});

/** A flow with a create_record node carrying `config`. */
const nodeFlow = (config: Record<string, unknown>) => ({
  flows: [{
    name: 'mk',
    nodes: [
      { id: 'start', type: 'start', config: {} },
      { id: 'create', type: 'create_record', config },
    ],
    edges: [],
  }],
});
const rules = (s: any) => lintFlowPatterns(s).map((f) => f.rule);

describe('lintFlowPatterns — wrong interpolation syntax (#1315)', () => {
  it('flags double-brace interpolation in a node value', () => {
    expect(rules(nodeFlow({ objectName: 'm', fields: { body: '{{ai_reply}}' } })))
      .toContain(FLOW_DOUBLE_BRACE_INTERP);
  });
  it('flags a bare $ref.field written as a literal', () => {
    expect(rules(nodeFlow({ objectName: 'm', fields: { ticket: '$source.id' } })))
      .toContain(FLOW_BARE_DOLLAR_REF);
  });
  describe('does NOT flag (false-positive guards)', () => {
    it('correct single-brace interpolation', () => {
      expect(rules(nodeFlow({ objectName: 'm', fields: { body: '{ai_reply}', t: 'Hi {record.name}' } }))).toEqual([]);
    });
    it('a braced $User reference', () => {
      expect(rules(nodeFlow({ objectName: 'm', fields: { owner: '{$User.Id}' } }))).toEqual([]);
    });
    it('a currency literal', () => {
      expect(rules(nodeFlow({ objectName: 'm', fields: { price: '$5.00', label: 'Total $5' } }))).toEqual([]);
    });
    it('a CEL condition (skipped — not a template value)', () => {
      expect(rules({ flows: [{ name: 'd', nodes: [
        { id: 'start', type: 'start', config: {} },
        { id: 'dec', type: 'decision', config: { condition: 'record.amount > 100' } },
      ], edges: [] }] })).toEqual([]);
    });
  });
});


describe('lintFlowPatterns — approval revise loop (ADR-0044)', () => {
  const approvalFlow = (
    edges: Array<{ source: string; target: string; label?: string; type?: string }>,
    approvalConfig: Record<string, unknown> = {},
  ) => ({
    flows: [{
      name: 'budget_approval',
      nodes: [
        { id: 'start', type: 'start', config: { triggerType: 'manual' } },
        { id: 'mgr', type: 'approval', config: approvalConfig },
        { id: 'wait', type: 'wait', config: { eventType: 'signal' } },
        { id: 'ok', type: 'end' },
        { id: 'no', type: 'end' },
      ],
      edges,
    }],
  });
  const declaredLoop = [
    { source: 'start', target: 'mgr' },
    { source: 'mgr', target: 'ok', label: 'approve' },
    { source: 'mgr', target: 'no', label: 'reject' },
    { source: 'mgr', target: 'wait', label: 'revise' },
    { source: 'wait', target: 'mgr', label: 'resubmit', type: 'back' },
  ];

  it('accepts a properly declared revise loop (closing edge type:back)', () => {
    expect(lintFlowPatterns(approvalFlow(declaredLoop))).toEqual([]);
  });

  it('flags a revise loop whose closing edge is NOT type:back', () => {
    const edges = declaredLoop.map((e) =>
      e.source === 'wait' && e.target === 'mgr' ? { source: 'wait', target: 'mgr', label: 'resubmit' } : e,
    );
    const fnds = lintFlowPatterns(approvalFlow(edges));
    expect(fnds).toHaveLength(1);
    expect(fnds[0].rule).toBe(FLOW_APPROVAL_REVISE_UNMARKED_BACKEDGE);
    expect(fnds[0].where).toContain('mgr');
    expect(fnds[0].hint).toMatch(/back/i);
  });

  it('flags a revise branch that never loops back (dead-end; registerFlow would accept it)', () => {
    const edges = [
      { source: 'start', target: 'mgr' },
      { source: 'mgr', target: 'ok', label: 'approve' },
      { source: 'mgr', target: 'wait', label: 'revise' },
    ];
    const fnds = lintFlowPatterns(approvalFlow(edges));
    expect(fnds).toHaveLength(1);
    expect(fnds[0].rule).toBe(FLOW_APPROVAL_REVISE_DEAD_END);
  });

  it('flags maxRevisions:0 alongside a revise edge', () => {
    const fnds = lintFlowPatterns(approvalFlow(declaredLoop, { maxRevisions: 0 }));
    expect(fnds).toHaveLength(1);
    expect(fnds[0].rule).toBe(FLOW_APPROVAL_REVISE_DISABLED);
  });

  it('does NOT flag a normal approval with no revise edge', () => {
    const edges = [
      { source: 'start', target: 'mgr' },
      { source: 'mgr', target: 'ok', label: 'approve' },
      { source: 'mgr', target: 'no', label: 'reject' },
    ];
    expect(lintFlowPatterns(approvalFlow(edges))).toEqual([]);
  });
});

describe('lintFlowPatterns — user-less runAs unscoped (#1888 / ADR-0049 / ADR-0073 D5 / #3760)', () => {
  /** A schedule-triggered flow that performs a data op, parameterized by runAs / detection signal. */
  const scheduledDataFlow = (opts: {
    runAs?: 'system' | 'user';
    flowType?: string;
    startConfig?: Record<string, unknown>;
    nodeType?: string;
  } = {}) => ({
    flows: [{
      name: 'nightly_sweep',
      ...(opts.flowType !== undefined ? { type: opts.flowType } : { type: 'schedule' }),
      ...(opts.runAs ? { runAs: opts.runAs } : {}),
      nodes: [
        { id: 'start', type: 'start', config: opts.startConfig ?? { triggerType: 'schedule', cron: '0 8 * * *' } },
        { id: 'op', type: opts.nodeType ?? 'create_record', config: { objectName: 'thing', fields: { a: 1 } } },
      ],
      edges: [],
    }],
  });

  it('flags a schedule flow whose runAs is unset (defaults to user → unscoped)', () => {
    const fnds = lintFlowPatterns(scheduledDataFlow());
    expect(fnds).toHaveLength(1);
    expect(fnds[0].rule).toBe(FLOW_RUNAS_UNSCOPED);
    expect(fnds[0].where).toContain('nightly_sweep');
    expect(fnds[0].message).toMatch(/default .*runAs:'user'/);
    expect(fnds[0].message).toMatch(/REFUSED/);
    expect(fnds[0].hint).toMatch(/runAs:'system'/);
  });

  it("flags an EXPLICIT runAs:'user' on a schedule (incoherent — no user to scope to)", () => {
    const fnds = lintFlowPatterns(scheduledDataFlow({ runAs: 'user' }));
    expect(fnds).toHaveLength(1);
    expect(fnds[0].rule).toBe(FLOW_RUNAS_UNSCOPED);
    expect(fnds[0].message).toMatch(/runAs:'user'/);
  });

  it('detects the schedule trigger via any of the three signals', () => {
    // (a) flow.type === 'schedule' (default in the helper)
    expect(lintFlowPatterns(scheduledDataFlow({ startConfig: {} }))).toHaveLength(1);
    // (b) start config.triggerType === 'schedule'
    expect(lintFlowPatterns(scheduledDataFlow({ flowType: 'autolaunched', startConfig: { triggerType: 'schedule' } }))).toHaveLength(1);
    // (c) start config carries a schedule descriptor
    expect(lintFlowPatterns(scheduledDataFlow({ flowType: 'autolaunched', startConfig: { schedule: { type: 'interval', intervalMs: 60000 } } }))).toHaveLength(1);
  });

  it('flags each data-op node type (get/create/update/delete)', () => {
    for (const t of ['get_record', 'create_record', 'update_record', 'delete_record']) {
      const fnds = lintFlowPatterns(scheduledDataFlow({ nodeType: t }));
      expect(fnds.map((f) => f.rule), `node ${t}`).toContain(FLOW_RUNAS_UNSCOPED);
    }
  });

  // #3760 — this rule FAILS the build. Every other rule in this file is
  // advisory; this one flags metadata the runtime refuses to execute, so a
  // warning would just be a slower way of finding out. If this assertion is ever
  // relaxed the gate silently becomes a comment again — which is exactly the
  // state #3760 found it in.
  it('is a BLOCKING finding (severity: error), unlike every advisory rule here', () => {
    const fnds = lintFlowPatterns(scheduledDataFlow());
    expect(fnds[0].severity).toBe('error');
  });

  // ADR-0073 D5 — the rule was scoped to `schedule`, but a schedule is not the
  // boundary: these triggers build an AutomationContext with no `userId` at all,
  // so they hit the identical refusal.
  it('flags the OTHER provably user-less triggers too — time-relative and api', () => {
    const timeRelative = lintFlowPatterns(
      scheduledDataFlow({ flowType: 'autolaunched', startConfig: { timeRelative: { object: 'task', field: 'due_at', offsetDays: -1 } } }),
    );
    expect(timeRelative.map((f) => f.rule)).toContain(FLOW_RUNAS_UNSCOPED);
    expect(timeRelative[0].message).toMatch(/time-relative/);

    const api = lintFlowPatterns(scheduledDataFlow({ flowType: 'api', startConfig: {} }));
    expect(api.map((f) => f.rule)).toContain(FLOW_RUNAS_UNSCOPED);
    expect(api[0].message).toMatch(/api/);

    const apiByTriggerType = lintFlowPatterns(
      scheduledDataFlow({ flowType: 'autolaunched', startConfig: { triggerType: 'api' } }),
    );
    expect(apiByTriggerType.map((f) => f.rule)).toContain(FLOW_RUNAS_UNSCOPED);
  });

  // The deliberate limit of this rule. A record-change flow hits the same
  // refusal when its triggering write carried no user, but that is a RUNTIME
  // property — approximating it here would fire on every record-change flow in
  // existence. Pinned so nobody "fixes" the gap by guessing.
  it('does NOT flag record_change — undecidable at authoring time, caught at run time', () => {
    const fnds = lintFlowPatterns(
      scheduledDataFlow({ flowType: 'record_change', startConfig: { triggerType: 'record_change', objectName: 'invoice' } }),
    );
    expect(fnds.map((f) => f.rule)).not.toContain(FLOW_RUNAS_UNSCOPED);
  });

  describe('does NOT flag (false-positive guards)', () => {
    it("a schedule flow that declares runAs:'system' (the correct shape)", () => {
      expect(lintFlowPatterns(scheduledDataFlow({ runAs: 'system' }))).toHaveLength(0);
    });
    it('a schedule flow with NO data node (runAs is moot — e.g. a notify-only digest)', () => {
      expect(lintFlowPatterns({
        flows: [{
          name: 'digest',
          type: 'schedule',
          nodes: [
            { id: 'start', type: 'start', config: { schedule: { type: 'interval', intervalMs: 60000 } } },
            { id: 'notify', type: 'notify', config: { topic: 'x' } },
          ],
          edges: [],
        }],
      })).toHaveLength(0);
    });
    it('a NON-schedule flow with a data op (record-change / screen runs carry a user)', () => {
      expect(lintFlowPatterns(scheduledDataFlow({ flowType: 'record_change', startConfig: { triggerType: 'record-after-update', objectName: 'thing' } }))).toHaveLength(0);
      expect(lintFlowPatterns(scheduledDataFlow({ flowType: 'screen', startConfig: {} }))).toHaveLength(0);
    });
  });
});
