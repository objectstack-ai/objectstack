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
} from './lint-flow-patterns.js';

const CEL = (source: string) => ({ dialect: 'cel', source });
/** A scheduled flow with a get_record node carrying `filter`. */
const filterFlow = (filter: unknown) => ({
  flows: [{
    name: 'expiry_alert',
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
