// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { TimeRelativeTriggerSchema, LoopConfigSchema, ParallelConfigSchema, FlowSchema } from '@objectstack/spec/automation';
// [#5659] The shared identity reduction, asserted beside the rule that consumes
// it — the rule's verdict and the drivers' verdict are one object now.
import { reduceFilterVerdict } from '@objectstack/spec/data';
import { AUTHORING_RULES } from './authoring-rules.js';
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
  FLOW_APPROVAL_REVISE_TARGET_NOT_SERVICE_OWNED,
  FLOW_RUNAS_UNSCOPED,
  FLOW_ERROR_LABEL_NOT_FAULT,
  FLOW_BRANCH_LABEL_UNMATCHED,
  FLOW_DECISION_UNCONDITIONAL_BRANCH,
  FLOW_DEFAULT_EDGE_WITH_CONDITION,
  FLOW_MULTIPLE_DEFAULT_EDGES,
  FLOW_INERT_NODE_CONDITION,
  FLOW_MULTI_WRITE_UNFILTERED,
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

/**
 * The keys a container schema REFUSED on a fixture — `[]` when the shape spells
 * only declared keys, whatever the schema thinks of their VALUES (#5700).
 *
 * The criterion is deliberately key-level, and the same one
 * `validate-security-posture.test.ts` writes down for its reachability guard: a
 * rejected KEY and a rejected VALUE are different facts. A key the schema does
 * not declare is not an authoring surface at all — a fixture spelling one
 * describes a container no author can save, which is exactly the defect #5700
 * catalogued. A rejected value is a fixture choice these rules are often
 * entitled to make.
 *
 * So the container audits below use this, NOT flat `safeParse` success: most of
 * this file's fixtures are hand-written raw literals that omit the `label`
 * `FlowNodeSchema` requires on every node, and demanding full-parse green would
 * either delete that coverage or drag in a file-wide re-write #5700 explicitly
 * defers. Where a fixture IS fully authorable, it is pinned with full green
 * instead (see the `LoopConfigSchema` pins).
 */
function refusedKeys(result: {
  success: boolean;
  error?: { issues: readonly { code: string; path: readonly PropertyKey[]; message: string }[] };
}): string[] {
  if (result.success) return [];
  return (result.error?.issues ?? [])
    .filter((i) => i.code === 'unrecognized_keys')
    .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
}

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
      // Scoped to the #1315 interpolation rules on purpose: this shape DOES
      // trip `flow-inert-node-condition` (#4414 — a decision never reads
      // `config.condition`), a different finding about a different defect,
      // which must not make this case read as a brace mistake.
      const found = rules({ flows: [{ name: 'd', nodes: [
        { id: 'start', type: 'start', config: {} },
        { id: 'dec', type: 'decision', config: { condition: 'record.amount > 100' } },
      ], edges: [] }] });
      expect(found).not.toContain(FLOW_DOUBLE_BRACE_INTERP);
      expect(found).not.toContain(FLOW_BARE_DOLLAR_REF);
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
        // #3823 — the revise window is the service-owned `approval_revise`
        // node, not the bare `wait` ADR-0044 D3 originally prescribed. The
        // dedicated case below pins that the old shape is now an error.
        { id: 'wait', type: 'approval_revise' },
        { id: 'ok', type: 'end' },
        { id: 'no', type: 'end' },
      ],
      edges,
    }],
  });
  /** The same flow with the revise edge pointed at a plain `wait` (pre-#3823). */
  const legacyWaitFlow = (
    edges: Array<{ source: string; target: string; label?: string; type?: string }>,
  ) => {
    const stack = approvalFlow(edges) as any;
    stack.flows[0].nodes = stack.flows[0].nodes.map((n: any) =>
      n.id === 'wait' ? { id: 'wait', type: 'wait', config: { eventType: 'signal' } } : n,
    );
    return stack;
  };
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

  // #3823 — the shape ADR-0044 D3 prescribed until its 2026-07-28 amendment.
  // `error`, because `ApprovalService.sendBack` refuses this metadata outright:
  // the revise branch can never run, and before that refusal the pause it
  // produced was resumable by anyone holding the run id.
  it('flags a revise edge into a bare wait node as an ERROR', () => {
    const fnds = lintFlowPatterns(legacyWaitFlow(declaredLoop));
    expect(fnds).toHaveLength(1);
    expect(fnds[0]).toMatchObject({
      rule: FLOW_APPROVAL_REVISE_TARGET_NOT_SERVICE_OWNED,
      severity: 'error',
    });
    expect(fnds[0].where).toContain('mgr');
    expect(fnds[0].message).toMatch(/node 'wait' of type 'wait'/);
    expect(fnds[0].hint).toMatch(/type: 'approval_revise'/);
  });

  it('flags a revise edge into any other node type too (screen, not just wait)', () => {
    const stack = approvalFlow(declaredLoop) as any;
    stack.flows[0].nodes = stack.flows[0].nodes.map((n: any) =>
      n.id === 'wait' ? { id: 'wait', type: 'screen', config: { fields: [{ name: 'note', type: 'text' }] } } : n,
    );
    const fnds = lintFlowPatterns(stack);
    expect(fnds.map((f) => f.rule)).toEqual([FLOW_APPROVAL_REVISE_TARGET_NOT_SERVICE_OWNED]);
    expect(fnds[0].message).toMatch(/type 'screen'/);
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
    // #5693 — one wording for both authoring inputs; see the dedicated block below.
    expect(fnds[0].message).toMatch(/runAs:'user'` \(the default when none is declared\)/);
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
    // #4966 — the descriptor must be one the runtime can actually BIND. This rule
    // decides `time-relative` from `startCfg.timeRelative != null` alone
    // (`lint-flow-patterns.ts`), never from the shape, so this fixture used to
    // read `{ object, field: 'due_at', offsetDays: -1 }` and stayed green while
    // describing a flow that never gets a sweep: `TimeRelativeTriggerPlugin.start()`
    // `safeParse`s `config.timeRelative` against `TimeRelativeTriggerSchema` and
    // refuses on both counts — `field` is a diagnostic alias, not an accepted key
    // (the declared one is `dateField`), and `offsetDays` is `z.array(int).min(1)`,
    // not a scalar. A fixture the runtime would refuse teaches the wrong shape to
    // every reader of this file (#4001's first-class finding class). Hence the
    // parse assertion below: the fixture is pinned against the same schema the
    // bind path uses, so it cannot rot back into an unbindable descriptor.
    const timeRelativeDescriptor = { object: 'task', dateField: 'due_at', offsetDays: [-1] };
    expect(TimeRelativeTriggerSchema.safeParse(timeRelativeDescriptor).success).toBe(true);

    const timeRelative = lintFlowPatterns(
      scheduledDataFlow({ flowType: 'autolaunched', startConfig: { timeRelative: timeRelativeDescriptor } }),
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
      // #6637 — the token was `'record_change'` (the flow TYPE echoed into the
      // trigger slot), which is not an authored trigger token at all: the engine
      // routes only `record-*`, so that fixture described a flow that never fires.
      // The pin is about a record-change flow, so it spells one — the same token
      // the sibling guard below already uses.
      scheduledDataFlow({ flowType: 'record_change', startConfig: { triggerType: 'record-after-update', objectName: 'invoice' } }),
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

  /**
   * #5633 — the data-node search descends into every ADR-0031 region.
   *
   * #5383/#5635 gave this whole rule family the per-region walk and deliberately
   * left THIS rule reading the top-level `nodes` only, because widening a
   * build-GATING rule is its own change with its own blast radius. That exemption
   * is what this block removes.
   *
   * The evidence and the verdict are at different altitudes here, and keeping
   * them apart is the whole design:
   *
   *  - the VERDICT is flow-level. `runAs` is a flow property and the trigger is a
   *    property of the start node, so a flow is either unscoped or it is not —
   *    one finding per flow, `where` = `flow 'x' · runAs`, never per region and
   *    never once per data node.
   *  - the EVIDENCE is "does this flow touch data at all", and a `loop` body is
   *    as much part of the flow as its top level. A data node one level down is
   *    refused by exactly the same `resolveRunAsIdentity` check (#3760) as one at
   *    the top; the nesting depth is not a property the runtime consults.
   *
   * The shape missed until now is not a corner but the DEFAULT shape of a
   * scheduled data flow — query a set, loop it, write per item — so the write is
   * almost always the nested node. Every case below pins the nested finding
   * against its top-level twin, and the twin's message is asserted byte-for-byte
   * so the widening cannot drift the wording authors already see.
   */
  describe('#5633 — descends into nested regions for the data-node evidence', () => {
    /** The canonical scheduled sweep: the write lives in the loop BODY. */
    const loopConfig = (bodyNodeType = 'update_record') => ({
      collection: '{vars.rows}',
      iteratorVariable: 'row',
      body: {
        nodes: [{
          id: 'touch',
          type: bodyNodeType,
          label: 'Touch Row',
          config: { objectName: 'thing', recordId: '{row.id}', fields: { seen: true } },
        }],
        edges: [],
      },
    });

    const sweepFlow = (opts: { runAs?: 'system' | 'user'; bodyNodeType?: string } = {}) => ({
      flows: [{
        name: 'nightly_sweep',
        type: 'schedule',
        ...(opts.runAs ? { runAs: opts.runAs } : {}),
        nodes: [
          { id: 'start', type: 'start', config: { triggerType: 'schedule', cron: '0 8 * * *' } },
          { id: 'loop_rows', type: 'loop', config: loopConfig(opts.bodyNodeType) },
          { id: 'end', type: 'end' },
        ],
        edges: [
          { id: 'e1', source: 'start', target: 'loop_rows' },
          { id: 'e2', source: 'loop_rows', target: 'end' },
        ],
      }],
    });

    /**
     * The container these fixtures nest the write inside must be a shape the
     * schema ACCEPTS, or the rule is only proven on metadata that never reaches
     * it — the #4966 trap, one container down (see the `TimeRelativeTriggerSchema`
     * pin above for the same guard on a trigger descriptor).
     *
     * This one is not hypothetical: the item-binding key here is
     * `iteratorVariable`, and `LoopConfigSchema` is a `strictObject`, so the
     * plausible-looking `itemVar` is reported as an `unrecognized_key` rather
     * than quietly ignored (#4001). A fixture spelling it would still exercise
     * this rule — region collection reads `config.body`, which is unaffected —
     * so nothing here would have gone red while the fixture taught a `loop` the
     * author cannot actually write.
     *
     * Full `safeParse` green rather than merely "no unrecognized keys", because
     * what this rule judges is a VALUE verdict (`runAs` against the trigger
     * kind), and its evidence is a node that must really be reachable inside a
     * really-authorable container.
     */
    it('pins the loop container against the schema — the fixture must be authorable', () => {
      const parsed = LoopConfigSchema.safeParse(loopConfig());
      expect(parsed.success).toBe(true);
      // And the near-miss spelling really is rejected, so the pin has teeth.
      const near = LoopConfigSchema.safeParse({ ...loopConfig(), iteratorVariable: undefined, itemVar: 'row' });
      expect(near.success).toBe(false);
    });

    it('flags a loop-body write — the shape that passed the build and is refused at run time', () => {
      const fnds = lintFlowPatterns(sweepFlow());
      expect(fnds).toHaveLength(1);
      expect(fnds[0].rule).toBe(FLOW_RUNAS_UNSCOPED);
      expect(fnds[0].severity).toBe('error');
      // The verdict stays FLOW-level: `runAs` is a flow property, so the region
      // never enters `where` — it is evidence, not location.
      expect(fnds[0].where).toBe("flow 'nightly_sweep' · runAs");
      expect(fnds[0].where).not.toContain('loop');
      // …but the message names the region, or the author has to hunt for the node.
      expect(fnds[0].message).toContain("its data node 'touch' (update_record), in loop 'loop_rows' body,");
    });

    it('flags a loop-body delete_record the same way', () => {
      const fnds = lintFlowPatterns(sweepFlow({ bodyNodeType: 'delete_record' }));
      expect(fnds.map((f) => f.rule)).toEqual([FLOW_RUNAS_UNSCOPED]);
      expect(fnds[0].message).toContain("its data node 'touch' (delete_record), in loop 'loop_rows' body,");
    });

    // The A/B twin. Same flow, same node, moved out of the body — this was
    // already flagged before #5633, and its message must carry no region clause.
    // (The sentence itself was re-worded once since, by #5693 — see the block at
    // the end of this file for why the authored-vs-defaulted branch it used to
    // carry could not survive.)
    it('leaves the TOP-LEVEL twin without a region clause (no regression)', () => {
      const fnds = lintFlowPatterns({
        flows: [{
          name: 'nightly_sweep',
          type: 'schedule',
          nodes: [
            { id: 'start', type: 'start', config: { triggerType: 'schedule', cron: '0 8 * * *' } },
            { id: 'touch', type: 'update_record', config: { objectName: 'thing', fields: { seen: true } } },
          ],
          edges: [{ id: 'e1', source: 'start', target: 'touch' }],
        }],
      });
      expect(fnds).toHaveLength(1);
      expect(fnds[0].where).toBe("flow 'nightly_sweep' · runAs");
      expect(fnds[0].message).toBe(
        "schedule-triggered flow runs under `runAs:'user'` (the default when none is declared), but a " +
        "schedule run has no trigger user — so its data node 'touch' (update_record) has no identity to scope to and " +
        "will be REFUSED at run time.",
      );
      expect(fnds[0].message).not.toContain('in loop');
    });

    it('descends two levels — a loop inside a loop', () => {
      const fnds = lintFlowPatterns({
        flows: [{
          name: 'nightly_sweep',
          type: 'schedule',
          nodes: [
            { id: 'start', type: 'start', config: { triggerType: 'schedule', cron: '0 8 * * *' } },
            {
              id: 'loop_rows', type: 'loop',
              config: {
                collection: '{vars.rows}', iteratorVariable: 'row',
                body: {
                  nodes: [{
                    id: 'loop_children', type: 'loop', label: 'Loop Children',
                    config: {
                      collection: '{row.children}', iteratorVariable: 'child',
                      body: {
                        nodes: [{ id: 'touch', type: 'create_record', label: 'Create', config: { objectName: 'thing', fields: { a: 1 } } }],
                        edges: [],
                      },
                    },
                  }],
                  edges: [],
                },
              },
            },
          ],
          edges: [{ id: 'e1', source: 'start', target: 'loop_rows' }],
        }],
      }).filter((f) => f.rule === FLOW_RUNAS_UNSCOPED);
      expect(fnds).toHaveLength(1);
      expect(fnds[0].message).toContain(
        "its data node 'touch' (create_record), in loop 'loop_rows' body → loop 'loop_children' body,",
      );
    });

    // Exactly ONE finding, not one per data node and not one per region: a
    // container's config physically contains its body, and the walk visits the
    // body in its own right, so a rule that pushed per hit would double-report.
    it('reports ONCE for a flow whose regions hold several data nodes', () => {
      const fanConfig = {
        branches: [
          { name: 'writes', nodes: [{ id: 'w1', type: 'update_record', label: 'Write', config: { objectName: 'a' } }], edges: [] },
          { name: 'deletes', nodes: [{ id: 'w2', type: 'delete_record', label: 'Delete', config: { objectName: 'b' } }], edges: [] },
        ],
      };
      // #5700 container audit — the `parallel` twin of the `loop` pin above. This
      // block already declares `name`/`nodes`/`edges` and labels its branch nodes,
      // so it clears the strongest bar available: full `safeParse` green.
      expect(ParallelConfigSchema.safeParse(fanConfig).success).toBe(true);

      const fnds = lintFlowPatterns({
        flows: [{
          name: 'nightly_sweep',
          type: 'schedule',
          nodes: [
            { id: 'start', type: 'start', config: { triggerType: 'schedule', cron: '0 8 * * *' } },
            { id: 'fan', type: 'parallel', config: fanConfig },
          ],
          edges: [{ id: 'e1', source: 'start', target: 'fan' }],
        }],
      }).filter((f) => f.rule === FLOW_RUNAS_UNSCOPED);
      expect(fnds).toHaveLength(1);
      expect(fnds[0].message).toContain("in parallel 'fan' branch 0,");
    });

    // The top-level graph comes first out of `collectFlowGraphs`, so a flow with
    // data nodes at BOTH altitudes still cites the top-level one — the exact node
    // it cited before #5633.
    it('prefers the top-level node as evidence when the flow has both', () => {
      const stack = sweepFlow() as { flows: Array<{ nodes: unknown[] }> };
      stack.flows[0].nodes.splice(1, 0, {
        id: 'query', type: 'get_record', config: { objectName: 'thing', filter: { done: false } },
      });
      const fnds = lintFlowPatterns(stack).filter((f) => f.rule === FLOW_RUNAS_UNSCOPED);
      expect(fnds).toHaveLength(1);
      expect(fnds[0].message).toContain("its data node 'query' (get_record) has no identity");
      expect(fnds[0].message).not.toContain('in loop');
    });

    describe('does NOT flag', () => {
      it("a loop-body write under runAs:'system' (the correct shape for a sweep)", () => {
        expect(lintFlowPatterns(sweepFlow({ runAs: 'system' }))
          .filter((f) => f.rule === FLOW_RUNAS_UNSCOPED)).toHaveLength(0);
      });

      it('a loop-body write on a non-user-less trigger (a record-change run carries a user)', () => {
        const stack = sweepFlow() as { flows: Array<Record<string, unknown>> };
        stack.flows[0].type = 'record_change';
        (stack.flows[0].nodes as Array<Record<string, unknown>>)[0] = {
          id: 'start', type: 'start', config: { triggerType: 'record-after-update', objectName: 'thing' },
        };
        expect(lintFlowPatterns(stack).filter((f) => f.rule === FLOW_RUNAS_UNSCOPED)).toHaveLength(0);
      });

      it('a loop body holding no data node at all (runAs stays moot — a notify-only sweep)', () => {
        expect(lintFlowPatterns(sweepFlow({ bodyNodeType: 'notify' }))
          .filter((f) => f.rule === FLOW_RUNAS_UNSCOPED)).toHaveLength(0);
      });
    });
  });

  /**
   * #5693 — ONE wording, true whether the author declared `runAs:'user'` or
   * declared nothing.
   *
   * The message used to branch: `` `runAs:'user'` `` when `flow.runAs` was a
   * string, `the default …` when it was absent. The distinction is real and
   * useful — "you wrote something incoherent" is not "you inherited a default
   * that does not fit a user-less trigger" — but *this rule cannot observe it*,
   * and which arm an author got depended on the SURFACE rather than on their
   * file:
   *
   *  - **CLI** — always the explicit arm. `FlowSchema.runAs` carries
   *    `.default('user')` and the registry wires this rule `input: 'parsed'`, so
   *    `flow.runAs` is the string `'user'` either way. `os lint` does not parse,
   *    but `defineStack`/`defineFlow` parse at *definition* time, so even it
   *    receives the default already materialized. Measured on `app-todo` with the
   *    `runAs` line deleted: `os validate` AND `os lint` both told an author who
   *    had declared nothing that their flow "runs as `runAs:'user'`".
   *  - **Runtime publish gate (#4463)** — both arms, because it judges the
   *    verbatim authored body (`saveMetaItem` keeps `request.item` past the
   *    schema check).
   *
   * So the branch was not merely dead: it made one flow get two different
   * sentences from two shipped surfaces, and on the surface authors meet first it
   * produced the one that reads as an accusation. #5693 removed it in favour of a
   * sentence that is true of both inputs on every surface.
   *
   * These two cases split the work deliberately, and only the second has teeth
   * against a re-introduction — say so rather than let the pair read as one
   * assertion made twice:
   *
   *  - the PARSED case pins *why* the branch was pointless (both inputs arrive as
   *    the same object). A re-introduced branch would still pass it — that is the
   *    point: the CLI cannot tell these apart, which is the whole defect.
   *  - the UNPARSED case is the regression guard. It is the one input shape where
   *    the two authoring choices are still distinguishable (and the shape the
   *    runtime gate really passes), so any future `typeof flow.runAs === 'string'`
   *    branch in the message fails it immediately.
   */
  describe("#5693 — one wording for authored `runAs:'user'` and for none at all", () => {
    /**
     * Authorable on purpose: `FlowSchema` requires `label` on the flow and on
     * every node, so the raw literals the rest of this file feeds would fail the
     * parse — and a fixture that cannot be parsed cannot demonstrate anything
     * about the parsed tier. This one is the same sweep, declared in full.
     */
    const sweep = (runAs?: 'user') => ({
      name: 'nightly_sweep',
      label: 'Nightly Sweep',
      type: 'schedule',
      ...(runAs ? { runAs } : {}),
      nodes: [
        { id: 'start', type: 'start', label: 'Start', config: { triggerType: 'schedule', cron: '0 8 * * *' } },
        { id: 'op', type: 'update_record', label: 'Touch', config: { objectName: 'thing', fields: { a: 1 } } },
      ],
      edges: [{ id: 'e1', source: 'start', target: 'op' }],
    });

    const EXPECTED =
      "schedule-triggered flow runs under `runAs:'user'` (the default when none is declared), but a " +
      "schedule run has no trigger user — so its data node 'op' (update_record) has no identity to scope to and " +
      "will be REFUSED at run time.";

    const messagesFor = (flow: unknown) =>
      lintFlowPatterns({ flows: [flow] })
        .filter((f) => f.rule === FLOW_RUNAS_UNSCOPED)
        .map((f) => f.message);

    it('is wired to the tier where the default has already been filled in', () => {
      const wiring = AUTHORING_RULES.find((r) => r.name === 'lintFlowPatterns');
      expect(wiring?.input).toBe('parsed');
    });

    it('PARSED input: the two authoring choices are literally the same object here', () => {
      const authored = FlowSchema.parse(sweep('user'));
      const defaulted = FlowSchema.parse(sweep());
      // The premise, asserted rather than assumed: the parse materializes the
      // default, so `flow.runAs` carries no trace of what was authored.
      expect(defaulted.runAs).toBe('user');
      expect(authored.runAs).toBe('user');

      expect(messagesFor(defaulted)).toEqual([EXPECTED]);
      expect(messagesFor(authored)).toEqual([EXPECTED]);
    });

    it('UNPARSED input: an absent key and an explicit one still get the same sentence', () => {
      // The runtime publish gate's shape — the only surface where the omission
      // survives to the rule. Both must read the same, or the surfaces disagree
      // about one flow again.
      expect(messagesFor(sweep())).toEqual([EXPECTED]);
      expect(messagesFor(sweep('user'))).toEqual([EXPECTED]);
    });

    it('says the same thing to both surfaces about the same flow', () => {
      expect(messagesFor(FlowSchema.parse(sweep()))).toEqual(messagesFor(sweep()));
    });
  });
});

/**
 * #3863 — `label: 'error'` without `type: 'fault'`.
 *
 * The label is cosmetic on an ordinary edge, so the handler runs on every
 * SUCCESS (unconditional out-edges all traverse, in parallel) and never on a
 * failure. Both halves are silent, which is why this is worth a build-time
 * diagnostic rather than a runtime one.
 */
function edgeFlow(edge: Record<string, unknown>, sourceType = 'http') {
  return {
    flows: [{
      name: 'edge_flow',
      type: 'autolaunched',
      nodes: [
        { id: 'start', type: 'start', config: {} },
        { id: 'op', type: sourceType, config: { url: 'https://x.test' } },
        { id: 'handler', type: 'notify', config: { topic: 'x' } },
        { id: 'end', type: 'end' },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'op' },
        { id: 'e2', source: 'op', target: 'end' },
        { id: 'e_h', source: 'op', target: 'handler', ...edge },
      ],
    }],
  };
}

describe('flow-error-label-not-fault (#3863)', () => {
  it("flags label:'error' left at the default type", () => {
    const fnds = lintFlowPatterns(edgeFlow({ label: 'error' }));
    expect(fnds).toHaveLength(1);
    expect(fnds[0].rule).toBe(FLOW_ERROR_LABEL_NOT_FAULT);
    // The message must name the actual consequence, not just the mismatch.
    expect(fnds[0].message).toContain('SUCCESSFUL');
    expect(fnds[0].hint).toContain("type: 'fault'");
  });

  it.each(['Error', 'FAILURE', 'catch', 'on_error', 'fault'])(
    "flags the equivalent label %s",
    (label) => {
      const fnds = lintFlowPatterns(edgeFlow({ label }));
      expect(fnds.map((f) => f.rule)).toContain(FLOW_ERROR_LABEL_NOT_FAULT);
    },
  );

  it("does NOT flag the correct shape (type: 'fault')", () => {
    expect(lintFlowPatterns(edgeFlow({ label: 'error', type: 'fault' }))).toHaveLength(0);
  });

  it('does NOT flag an unlabelled fault edge', () => {
    expect(lintFlowPatterns(edgeFlow({ type: 'fault' }))).toHaveLength(0);
  });

  it('does NOT flag an ordinary labelled edge', () => {
    expect(lintFlowPatterns(edgeFlow({ label: 'approved' }))).toHaveLength(0);
  });

  it('does NOT flag a CONDITIONAL edge — a guarded path is not the footgun', () => {
    expect(lintFlowPatterns(edgeFlow({ label: 'error', condition: "status == 'bad'" }))).toHaveLength(0);
  });

  it.each(['decision', 'approval'])(
    "does NOT flag label:'error' out of a %s node — the label IS the branch selector",
    (sourceType) => {
      expect(lintFlowPatterns(edgeFlow({ label: 'error' }, sourceType))).toHaveLength(0);
    },
  );
});

/**
 * #4414 — a decision that declares a branch it cannot route.
 *
 * `guardFlow` is `examples/app-crm/src/flows/convert-lead.flow.ts`'s guard,
 * reduced: one CEL-guarded abort branch and one fallback branch.
 */
function guardFlow(opts: {
  conditions?: Array<{ label: string; expression: string }>;
  proceed?: Record<string, unknown>;
  extra?: Array<Record<string, unknown>>;
} = {}) {
  return {
    flows: [{
      name: 'convert_lead',
      type: 'screen',
      nodes: [
        { id: 'start', type: 'start', config: {} },
        {
          id: 'check', type: 'decision',
          ...(opts.conditions ? { config: { conditions: opts.conditions } } : {}),
        },
        { id: 'abort', type: 'screen', config: {} },
        { id: 'proceed', type: 'screen', config: {} },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'check' },
        { id: 'e_yes', source: 'check', target: 'abort', label: 'Yes', condition: "lead.status == 'converted'" },
        { id: 'e_no', source: 'check', target: 'proceed', label: 'No', ...(opts.proceed ?? {}) },
        ...(opts.extra ?? []),
      ],
    }],
  };
}

describe('flow-branch-label-unmatched (#4414)', () => {
  // The shipped shape: labels `'Yes — already converted'` / `'No — proceed'`
  // against out-edges labelled `'Yes'` / `'No'` — zero matches.
  it('flags decision branch labels no out-edge carries', () => {
    const fnds = lintFlowPatterns(guardFlow({
      proceed: { isDefault: true },
      conditions: [
        { label: 'Yes — already converted', expression: "lead.status == 'converted'" },
        { label: 'No — proceed', expression: 'true' },
      ],
    })).filter((f) => f.rule === FLOW_BRANCH_LABEL_UNMATCHED);

    expect(fnds).toHaveLength(1);
    // Gating: a label nothing claims cannot route under any reading (#4414).
    expect(fnds[0].severity).toBe('error');
    expect(fnds[0].where).toContain("decision 'check'");
    expect(fnds[0].message).toContain("'yes — already converted'");
    expect(fnds[0].message).toContain("'no — proceed'");
    // The consequence, not just the mismatch.
    expect(fnds[0].message).toContain('EVERY');
  });

  it('flags a partial mismatch — one claimed label does not excuse the other', () => {
    const fnds = lintFlowPatterns(guardFlow({
      proceed: { isDefault: true },
      conditions: [
        { label: 'Yes', expression: "lead.status == 'converted'" },
        { label: 'No — proceed', expression: 'true' },
      ],
    })).filter((f) => f.rule === FLOW_BRANCH_LABEL_UNMATCHED);
    expect(fnds).toHaveLength(1);
    // Only the unclaimed label is reported as unclaimed; `'yes'` still shows up
    // later in the message as one of the out-edge labels that DO exist.
    expect(fnds[0].message).toMatch(/declares branch label\(s\) 'no — proceed' that no out-edge/);
  });

  it('does NOT flag labels that match (case/whitespace-insensitively)', () => {
    expect(lintFlowPatterns(guardFlow({
      proceed: { isDefault: true },
      conditions: [{ label: ' yes ', expression: 'true' }],
    })).filter((f) => f.rule === FLOW_BRANCH_LABEL_UNMATCHED)).toHaveLength(0);
  });

  it('does NOT flag a decision that declares no conditions at all', () => {
    expect(lintFlowPatterns(guardFlow({ proceed: { isDefault: true } }))).toHaveLength(0);
  });
});

describe('flow-decision-unconditional-branch (#4414)', () => {
  // The actual hole: `e_no` has no condition and no `isDefault`, so it is
  // traversed on every pass — the abort screen AND the wizard behind it.
  it('flags an unconditional out-edge alongside a guarded one', () => {
    const fnds = lintFlowPatterns(guardFlow()).filter(
      (f) => f.rule === FLOW_DECISION_UNCONDITIONAL_BRANCH,
    );
    expect(fnds).toHaveLength(1);
    // Advisory, deliberately: one guarded + one unconditional out-edge is also
    // a legal "maybe notify, always continue" fan-out, so this shape cannot be
    // proved wrong the way the two gating rules can.
    expect(fnds[0].severity).toBeUndefined();
    expect(fnds[0].message).toContain("'proceed'");
    expect(fnds[0].message).toContain('EVERY pass');
    expect(fnds[0].hint).toContain('isDefault');
  });

  it('does NOT flag once the fallback is marked isDefault — the fix', () => {
    expect(lintFlowPatterns(guardFlow({ proceed: { isDefault: true } }))).toHaveLength(0);
  });

  it('does NOT flag once the fallback carries its own condition', () => {
    expect(lintFlowPatterns(guardFlow({
      proceed: { condition: "lead.status != 'converted'" },
    }))).toHaveLength(0);
  });

  it('does NOT flag an edge the decision CAN select by declared label', () => {
    expect(lintFlowPatterns(guardFlow({
      conditions: [{ label: 'No', expression: 'true' }, { label: 'Yes', expression: 'false' }],
    })).filter((f) => f.rule === FLOW_DECISION_UNCONDITIONAL_BRANCH)).toHaveLength(0);
  });

  it('does NOT flag a decision with no guarded edge at all — nothing to undercut', () => {
    expect(lintFlowPatterns({
      flows: [{
        name: 'plain',
        nodes: [{ id: 'start', type: 'start', config: {} }, { id: 'check', type: 'decision' }, { id: 'a', type: 'screen', config: {} }],
        edges: [
          { id: 'e1', source: 'start', target: 'check' },
          { id: 'e2', source: 'check', target: 'a' },
        ],
      }],
    })).toHaveLength(0);
  });

  it('does NOT flag a fault edge — error routing is not branch selection', () => {
    expect(lintFlowPatterns(guardFlow({
      proceed: { isDefault: true },
      extra: [{ id: 'e_err', source: 'check', target: 'abort', type: 'fault' }],
    }))).toHaveLength(0);
  });
});

describe('flow-default-edge-with-condition / flow-multiple-default-edges (#4414)', () => {
  it('flags an edge that is both the default and conditional', () => {
    const fnds = lintFlowPatterns(guardFlow({
      proceed: { isDefault: true, condition: "lead.status != 'converted'" },
    })).filter((f) => f.rule === FLOW_DEFAULT_EDGE_WITH_CONDITION);
    expect(fnds).toHaveLength(1);
    // Gating: the condition always wins, so the marker never routes (#4414).
    expect(fnds[0].severity).toBe('error');
    expect(fnds[0].message).toContain('contradictory');
  });

  it('flags two default edges out of one node', () => {
    const fnds = lintFlowPatterns(guardFlow({
      proceed: { isDefault: true },
      extra: [{ id: 'e_also', source: 'check', target: 'abort', isDefault: true }],
    })).filter((f) => f.rule === FLOW_MULTIPLE_DEFAULT_EDGES);
    expect(fnds).toHaveLength(1);
    // Advisory: two defaults can genuinely mean "when nothing matched, do both".
    expect(fnds[0].severity).toBeUndefined();
    expect(fnds[0].where).toContain("node 'check'");
  });

  it('does NOT flag one default edge per node', () => {
    expect(lintFlowPatterns(guardFlow({ proceed: { isDefault: true } }))).toHaveLength(0);
  });
});

/**
 * #4414 — `config.condition` on a node that never reads it.
 *
 * The key is LIVE on `start` (the trigger gate) and dead on every other
 * builtin. `app-todo`'s `check_recurring` carried one for years: a third copy
 * of a predicate its out-edges were already enforcing.
 */
function conditionNodeFlow(nodeType: string, config: Record<string, unknown>) {
  return {
    flows: [{
      name: 'cond_flow',
      nodes: [
        { id: 'start', type: 'start', config: { objectName: 'todo_task', triggerType: 'record-after-update' } },
        { id: 'n', type: nodeType, config },
      ],
      edges: [{ id: 'e1', source: 'start', target: 'n' }],
    }],
  };
}

describe('flow-inert-node-condition (#4414)', () => {
  it('flags `config.condition` on a decision, pointing at the out-edges', () => {
    const fnds = lintFlowPatterns(
      conditionNodeFlow('decision', { condition: 'vars.completedTask.is_recurring == true' }),
    ).filter((f) => f.rule === FLOW_INERT_NODE_CONDITION);
    expect(fnds).toHaveLength(1);
    expect(fnds[0].where).toContain("node 'n' (decision)");
    expect(fnds[0].message).toContain('nothing reads it');
    expect(fnds[0].hint).toContain('isDefault');
    // Advisory: the surrounding edges usually still route correctly.
    expect(fnds[0].severity).toBeUndefined();
  });

  it('flags it on a non-decision node too, with the generic hint', () => {
    const fnds = lintFlowPatterns(
      conditionNodeFlow('update_record', { objectName: 'todo_task', condition: 'a == b' }),
    ).filter((f) => f.rule === FLOW_INERT_NODE_CONDITION);
    expect(fnds).toHaveLength(1);
    expect(fnds[0].hint).toContain("incoming edge's `condition`");
  });

  it('does NOT flag the start node — that is where the key is read', () => {
    expect(lintFlowPatterns({
      flows: [{
        name: 'gated',
        runAs: 'system',
        nodes: [{ id: 'start', type: 'start', config: { triggerType: 'schedule', schedule: 'cron:0 9 * * *', condition: 'record.active == true' } }],
        edges: [],
      }],
    }).filter((f) => f.rule === FLOW_INERT_NODE_CONDITION)).toHaveLength(0);
  });

  it('does NOT flag a node with no condition, or an empty one', () => {
    expect(lintFlowPatterns(conditionNodeFlow('decision', {}))).toHaveLength(0);
    expect(lintFlowPatterns(conditionNodeFlow('decision', { condition: '   ' }))).toHaveLength(0);
  });

  it('does NOT flag a PLUGIN node type — its executor may legitimately read it', () => {
    // ADR-0018 keeps `node.type` open; we can only prove the key inert for the
    // builtins we ship.
    expect(lintFlowPatterns(conditionNodeFlow('acme_custom_step', { condition: 'a == b' }))).toHaveLength(0);
  });
});

/**
 * #5383 — the rule family used to read `flow.nodes` / `flow.edges` FLAT, so every
 * rule in it was blind to anything authored inside an ADR-0031 container.
 *
 * Measured in a real app (HotCRM): 8 `decision` nodes carried the inert singular
 * `config.condition` that `flow-inert-node-condition` exists to catch, all 8
 * inside a `loop` body, and `pnpm lint` reported none. The identical key on a
 * TOP-LEVEL decision in the same repo fired immediately — same key, same node
 * type, only the nesting depth differed. There was no loop-body fixture anywhere
 * in this file, which is consistent with the gap going unnoticed for that long.
 *
 * Every case below pins the nested finding against its top-level twin, so a
 * future flattening of the walk fails here instead of going quiet again.
 */

/**
 * The `loop` container `loopBodyFlow` builds, factored out (#5700) so the pin
 * below reads the REAL config object every case in this family descends into,
 * rather than a retyped copy that can drift away from it silently.
 */
const loopLeadsConfig = (body: { nodes: unknown[]; edges: unknown[] }) => ({
  collection: '{vars.leads}',
  iteratorVariable: 'lead',
  body,
});

/** A scheduled sweep: `loop` over leads, with `body` holding the per-item graph. */
function loopBodyFlow(body: { nodes: unknown[]; edges: unknown[] }) {
  return {
    flows: [{
      name: 'campaign_enrollment',
      runAs: 'system',
      nodes: [
        { id: 'start', type: 'start', config: { triggerType: 'schedule', schedule: 'cron:0 9 * * *' } },
        {
          id: 'loop_leads', type: 'loop', label: 'Loop Leads',
          config: loopLeadsConfig(body),
        },
        { id: 'end', type: 'end' },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'loop_leads' },
        { id: 'e2', source: 'loop_leads', target: 'end' },
      ],
    }],
  };
}

/**
 * #5700 — the container every case below nests its per-item graph inside must be
 * a shape the schema ACCEPTS, or those cases prove their rule against metadata
 * no author can write. That is the #4966 trap (the `TimeRelativeTriggerSchema`
 * pin near the top of this file) one container down, and it was not hypothetical
 * here: this helper bound the item with `itemVar` until #5700. `LoopConfigSchema`
 * is a `strictObject` whose declared key is `iteratorVariable`, so `itemVar` is
 * reported as an `unrecognized_key` rather than dropped (#4001) — while region
 * collection reads only `config.body`, so every assertion downstream kept passing
 * and nothing went red.
 *
 * The near-miss direction is already pinned once, in the #5633 block above
 * (`itemVar` really is refused, so this family's pins have teeth); it is not
 * repeated here.
 *
 * Full `safeParse` green rather than the key-level `refusedKeys` bar, because
 * what the rules built on this helper judge is a VALUE verdict about a node that
 * must really be REACHABLE inside a really-authorable container — so the body
 * has to parse too, `label` and all.
 *
 * What is pinned is the container SHELL plus one representative body: the body
 * is this helper's parameter, and the bodies the call sites pass are raw
 * literals that omit the node `label` `FlowNodeSchema` requires. Bringing this
 * whole file to full-flow-parse green is the separate, much broader change
 * #5700 defers by name.
 */
describe('#5700 — the shared loop container is a shape an author can actually write', () => {
  it('pins loopBodyFlow’s `loop` config against LoopConfigSchema', () => {
    const parsed = LoopConfigSchema.safeParse(loopLeadsConfig({
      nodes: [{ id: 'enroll', type: 'create_record', label: 'Enroll', config: { objectName: 'campaign_member' } }],
      edges: [],
    }));
    expect(parsed.success).toBe(true);
  });

  /**
   * Why the two nested cases below carry their OWN pins instead of leaning on
   * this one. `FlowRegionSchema.nodes` is an array of `FlowNodeSchema`, whose
   * `config` is declared `z.record(z.string(), z.unknown())` — an OPEN record.
   * So a nested container's config is accepted wholesale by the enclosing parse:
   * this shell pin stays GREEN while an inner `loop` spells `itemVar`. Measured,
   * not assumed — the assertion below is that blindness, stated as a fact, so a
   * future reader does not mistake one pin at the top for coverage of the tree.
   */
  it('does NOT see into a nested container’s config — the inner pins are load-bearing', () => {
    const shellWithBadInnerLoop = LoopConfigSchema.safeParse(loopLeadsConfig({
      nodes: [{
        id: 'loop_touchpoints', type: 'loop', label: 'Loop Touchpoints',
        config: {
          collection: '{lead.touchpoints}', itemVar: 'tp',
          body: { nodes: [{ id: 'reset', type: 'update_record', label: 'Reset', config: {} }], edges: [] },
        },
      }],
      edges: [],
    }));
    expect(shellWithBadInnerLoop.success).toBe(true);

    // …whereas the very same inner config, parsed as the container it is, is refused.
    expect(refusedKeys(LoopConfigSchema.safeParse({
      collection: '{lead.touchpoints}', itemVar: 'tp',
      body: { nodes: [{ id: 'reset', type: 'update_record', label: 'Reset', config: {} }], edges: [] },
    })).join(' ')).toMatch(/Unrecognized key\(s\) on this loop container config: `itemVar`/);
  });
});

describe('#5383 — flow-inert-node-condition descends into a loop body', () => {
  // The shipped shape, reduced: a per-item gate inside a sweep, whose predicate
  // was written on the node instead of its out-edges.
  const nested = () => loopBodyFlow({
    nodes: [
      { id: 'check_not_enrolled', type: 'decision', config: { condition: 'lead.enrolled == false' } },
      { id: 'enroll', type: 'create_record', config: { objectName: 'campaign_member' } },
    ],
    edges: [{ id: 'b1', source: 'check_not_enrolled', target: 'enroll' }],
  });

  it('flags it, scoped to the region so the message still names exactly one node', () => {
    const fnds = lintFlowPatterns(nested());
    // Exactly one finding overall: no collateral from the descent, and no second
    // copy reported against the enclosing `loop`.
    expect(fnds).toHaveLength(1);
    expect(fnds[0].rule).toBe(FLOW_INERT_NODE_CONDITION);
    expect(fnds[0].where).toBe(
      "flow 'campaign_enrollment' · loop 'loop_leads' body · node 'check_not_enrolled' (decision)",
    );
    expect(fnds[0].message).toContain('nothing reads it');
    // The decision-specific hint still applies one level down.
    expect(fnds[0].hint).toContain('isDefault');
    expect(fnds[0].severity).toBeUndefined();
  });

  it('still reports the TOP-LEVEL twin with no region breadcrumb (the A/B)', () => {
    const fnds = lintFlowPatterns({
      flows: [{
        name: 'campaign_enrollment',
        runAs: 'system',
        nodes: [
          { id: 'start', type: 'start', config: { triggerType: 'schedule', schedule: 'cron:0 9 * * *' } },
          { id: 'check_not_enrolled', type: 'decision', config: { condition: 'lead.enrolled == false' } },
        ],
        edges: [{ id: 'e1', source: 'start', target: 'check_not_enrolled' }],
      }],
    });
    expect(fnds).toHaveLength(1);
    expect(fnds[0].where).toBe("flow 'campaign_enrollment' · node 'check_not_enrolled' (decision)");
    expect(fnds[0].where).not.toContain('loop');
  });

  /**
   * The INNER container, named so the pin below reads the object the fixture
   * really descends into. The planted defect is the decision's inert
   * `config.condition` — everything else about this shape is authorable, and
   * has to be, or the case proves the descent against a `loop` the schema
   * refuses (#5700; the enclosing shell pin cannot see in here — `FlowNodeSchema`
   * declares `config` as an open record).
   */
  const nestedTouchpointsLoop = {
    collection: '{lead.touchpoints}', iteratorVariable: 'tp',
    body: {
      nodes: [{ id: 'check_recent', type: 'decision', label: 'Check Recent', config: { condition: 'tp.age_days < 7' } }],
      edges: [],
    },
  };

  it('pins that inner loop container against LoopConfigSchema (#5700)', () => {
    expect(LoopConfigSchema.safeParse(nestedTouchpointsLoop).success).toBe(true);
  });

  it('descends a loop nested inside a loop — same depth semantics as the engine', () => {
    const fnds = lintFlowPatterns(loopBodyFlow({
      nodes: [{ id: 'loop_touchpoints', type: 'loop', label: 'Loop Touchpoints', config: nestedTouchpointsLoop }],
      edges: [],
    })).filter((f) => f.rule === FLOW_INERT_NODE_CONDITION);
    expect(fnds).toHaveLength(1);
    expect(fnds[0].where).toBe(
      "flow 'campaign_enrollment' · loop 'loop_leads' body → loop 'loop_touchpoints' body · " +
      "node 'check_recent' (decision)",
    );
  });

  it('descends a parallel branch too — the scope names the branch index', () => {
    const fanConfig = {
      branches: [
        { name: 'owner', nodes: [{ id: 'gate', type: 'decision', config: { condition: 'a == b' } }], edges: [] },
        { name: 'watchers', nodes: [{ id: 'ping', type: 'notify', config: { title: 'Hi {record.name}' } }], edges: [] },
      ],
    };
    // #5700 container audit, key-level bar (see `refusedKeys`): every key here is
    // one `ParallelConfigSchema` declares. The branch nodes omit the `label`
    // `FlowNodeSchema` requires, which is the file-wide convention #5700 defers —
    // a rejected VALUE, not a key that is no authoring surface at all.
    expect(refusedKeys(ParallelConfigSchema.safeParse(fanConfig))).toEqual([]);

    const fnds = lintFlowPatterns({
      flows: [{
        name: 'fan_out',
        runAs: 'system',
        nodes: [
          { id: 'start', type: 'start', config: { triggerType: 'schedule', schedule: 'cron:0 9 * * *' } },
          { id: 'fan', type: 'parallel', config: fanConfig },
        ],
        edges: [{ id: 'e1', source: 'start', target: 'fan' }],
      }],
    }).filter((f) => f.rule === FLOW_INERT_NODE_CONDITION);
    expect(fnds).toHaveLength(1);
    expect(fnds[0].where).toBe("flow 'fan_out' · parallel 'fan' branch 0 · node 'gate' (decision)");
  });
});

/**
 * #5383 — the branch-routing family reasons about a node together with its
 * OUT-EDGES, so the walk has to hand each region its own `edges` array. These
 * cases are unreachable from the top-level edge list by construction: nothing at
 * the top level has `gate` or `push` as a source, so a walk that descended into
 * region NODES while still reading top-level EDGES would see zero out-edges and
 * skip every one of them.
 */
describe('#5383 — the branch-routing family reads the region’s own edges', () => {
  it('flags a nested edge that is both the default and conditional (GATING)', () => {
    const fnds = lintFlowPatterns(loopBodyFlow({
      nodes: [
        { id: 'gate', type: 'decision' },
        { id: 'nudge', type: 'notify', config: { title: 'Nudge {lead.name}' } },
        { id: 'skip', type: 'end' },
      ],
      edges: [
        { id: 'b1', source: 'gate', target: 'nudge', condition: 'lead.score > 50' },
        { id: 'b2', source: 'gate', target: 'skip', isDefault: true, condition: 'lead.score <= 50' },
      ],
    }));
    expect(fnds).toHaveLength(1);
    expect(fnds[0].rule).toBe(FLOW_DEFAULT_EDGE_WITH_CONDITION);
    // The severity asymmetry the issue called out: a build-stopping rule that
    // could not see a contradiction authored one level down.
    expect(fnds[0].severity).toBe('error');
    expect(fnds[0].where).toBe(
      "flow 'campaign_enrollment' · loop 'loop_leads' body · edge 'gate' → 'skip'",
    );
    expect(fnds[0].message).toContain('contradictory');
  });

  it('flags a nested unconditional out-edge alongside a guarded sibling', () => {
    const fnds = lintFlowPatterns(loopBodyFlow({
      nodes: [
        { id: 'gate', type: 'decision' },
        { id: 'nudge', type: 'notify', config: { title: 'Nudge {lead.name}' } },
        { id: 'log', type: 'create_record', config: { objectName: 'touch_log' } },
      ],
      edges: [
        { id: 'b1', source: 'gate', target: 'nudge', condition: 'lead.score > 50' },
        { id: 'b2', source: 'gate', target: 'log' },
      ],
    })).filter((f) => f.rule === FLOW_DECISION_UNCONDITIONAL_BRANCH);
    expect(fnds).toHaveLength(1);
    expect(fnds[0].where).toBe("flow 'campaign_enrollment' · loop 'loop_leads' body · decision 'gate'");
    expect(fnds[0].message).toContain("'log'");
  });

  it('flags a nested error-labelled edge left at the default type', () => {
    const fnds = lintFlowPatterns(loopBodyFlow({
      nodes: [
        { id: 'push', type: 'http', config: { url: 'https://example.test/hook' } },
        { id: 'handle', type: 'create_record', config: { objectName: 'sync_error' } },
      ],
      edges: [{ id: 'b1', source: 'push', target: 'handle', label: 'error' }],
    })).filter((f) => f.rule === FLOW_ERROR_LABEL_NOT_FAULT);
    expect(fnds).toHaveLength(1);
    expect(fnds[0].where).toBe(
      "flow 'campaign_enrollment' · loop 'loop_leads' body · edge 'push' → 'handle'",
    );
  });

  it('does NOT merge two regions into one bag — a shared node id is not a fan-out', () => {
    // `gate` exists in BOTH branches, each with exactly ONE default out-edge.
    // Node ids are unique per graph, not per flow, so flattening every region
    // into one node bag + one edge bag would see two `isDefault` edges out of
    // "gate" and raise flow-multiple-default-edges — a finding neither region
    // contains. Pairing each region with its own edges is what keeps this quiet.
    const branch = (cond: string) => ({
      nodes: [
        { id: 'gate', type: 'decision' },
        { id: 'x', type: 'end' },
        { id: 'y', type: 'end' },
      ],
      edges: [
        { id: 'g1', source: 'gate', target: 'x', condition: cond },
        { id: 'g2', source: 'gate', target: 'y', isDefault: true },
      ],
    });
    const fanConfig = {
      branches: [
        { name: 'a', ...branch('lead.score > 50') },
        { name: 'b', ...branch('lead.score > 90') },
      ],
    };
    // #5700 container audit, key-level bar (see `refusedKeys`). Covers the branch
    // EDGES too: `condition` and `isDefault` are the keys this case turns on, and
    // both are declared — so what it pins is real edge vocabulary, not a shape
    // the schema would refuse.
    expect(refusedKeys(ParallelConfigSchema.safeParse(fanConfig))).toEqual([]);

    const fnds = lintFlowPatterns({
      flows: [{
        name: 'twin_regions',
        runAs: 'system',
        nodes: [
          { id: 'start', type: 'start', config: { triggerType: 'schedule', schedule: 'cron:0 9 * * *' } },
          { id: 'fan', type: 'parallel', config: fanConfig },
        ],
        edges: [{ id: 'e1', source: 'start', target: 'fan' }],
      }],
    });
    expect(fnds.filter((f) => f.rule === FLOW_MULTIPLE_DEFAULT_EDGES)).toHaveLength(0);
    expect(fnds).toHaveLength(0);
  });
});

describe('#5383 — a recursive config scan does not double-report the container', () => {
  it('moves a nested double-brace finding onto the node carrying it, still exactly once', () => {
    const fnds = lintFlowPatterns(loopBodyFlow({
      nodes: [{ id: 'send_reminder', type: 'notify', config: { title: 'Reminder: {{lead.name}}' } }],
      edges: [],
    }));
    // Exactly one. The `loop`'s own config physically CONTAINS `body`, and
    // `collectTemplateStrings` is recursive, so descending without stripping the
    // region slots would report this a SECOND time against 'loop_leads'.
    expect(fnds).toHaveLength(1);
    expect(fnds[0].rule).toBe(FLOW_DOUBLE_BRACE_INTERP);
    expect(fnds[0].where).toBe(
      "flow 'campaign_enrollment' · loop 'loop_leads' body · node 'send_reminder' (notify)",
    );
    // Before #5383 the COUNT was already 1 here — the string was found by
    // recursing through the container's config and attributed to the `loop`.
    // That is the `validate-flow-template-paths` failure mode (#4380): visible,
    // but judged against a node that does not carry the string. So for this rule
    // the fix is re-attribution, not new visibility.
    expect(fnds[0].where).not.toContain("node 'loop_leads'");
  });
});

/**
 * #5482 — the declared WHOLE-OBJECT write: `multi: true` on a
 * `delete_record` / `update_record` with nothing bounding it.
 *
 * Reachable only since #5393 gave these nodes a bulk declaration: before it the
 * executor never passed `options.multi`, the engine refused every predicate
 * write, and "empty filter + bulk" was not an authoring surface at all. Measured
 * on `origin/main` before this rule existed, all four shapes below — top-level
 * delete, empty-object filter, update, and the same node inside a `loop` body —
 * returned `[]` from `lintFlowPatterns`. The only feedback an author got was the
 * step's `acted` row count, after the rows were gone.
 */

/** A janitor flow: one bulk write node, scheduled, correctly `runAs: 'system'`. */
function purgeFlow(nodeType: string, config: unknown) {
  return {
    flows: [{
      name: 'nightly_purge',
      runAs: 'system',
      nodes: [
        { id: 'start', type: 'start', config: { triggerType: 'schedule', schedule: 'cron:0 3 * * *' } },
        { id: 'purge', type: nodeType, config },
      ],
      edges: [{ id: 'e1', source: 'start', target: 'purge' }],
    }],
  };
}

describe('lintFlowPatterns — unbounded bulk write (#5482)', () => {
  it('flags a delete_record with `multi: true` and NO filter', () => {
    const fnds = lintFlowPatterns(purgeFlow('delete_record', { objectName: 'lead', multi: true }));
    expect(fnds).toHaveLength(1);
    expect(fnds[0].rule).toBe(FLOW_MULTI_WRITE_UNFILTERED);
    expect(fnds[0].where).toBe("flow 'nightly_purge' · node 'purge' (delete_record)");
    // Advisory: the engine's dispatch table grants "bulk intent, no predicate"
    // on purpose, so the shape is not provably wrong (severity policy at the top
    // of lint-flow-patterns.ts). `undefined` is how this family spells warning.
    expect(fnds[0].severity).toBeUndefined();
    // Says WHAT it does — the object by name, and that it is every row.
    expect(fnds[0].message).toContain('no `filter` key');
    expect(fnds[0].message).toContain('WHOLE-OBJECT write');
    expect(fnds[0].message).toContain("every row of 'lead' is deleted");
    expect(fnds[0].message).toContain('driver.deleteMany');
    // The authority it cites is the delete dispatch that is actually extracted
    // and case-set-pinned — not a hand-waved "the engine allows it".
    expect(fnds[0].message).toContain('delete-dispatch case-set');
    expect(fnds[0].message).toContain('multi with no predicate at all');
    // …and that the only run-time feedback arrives too late to help.
    expect(fnds[0].message).toMatch(/`acted` row count/);
    expect(fnds[0].message).toMatch(/AFTER the rows are gone/);
  });

  it('flags an EMPTY filter the same way, and says which of the two it saw', () => {
    const fnds = lintFlowPatterns(purgeFlow('delete_record', { objectName: 'lead', filter: {}, multi: true }));
    expect(fnds).toHaveLength(1);
    expect(fnds[0].rule).toBe(FLOW_MULTI_WRITE_UNFILTERED);
    expect(fnds[0].message).toContain('an EMPTY `filter`');
    expect(fnds[0].message).not.toContain('no `filter` key');
  });

  it('flags an update_record too, in the words of an overwrite', () => {
    const fnds = lintFlowPatterns(
      purgeFlow('update_record', { objectName: 'lead', fields: { status: 'stale' }, multi: true }),
    );
    expect(fnds).toHaveLength(1);
    expect(fnds[0].rule).toBe(FLOW_MULTI_WRITE_UNFILTERED);
    expect(fnds[0].where).toBe("flow 'nightly_purge' · node 'purge' (update_record)");
    expect(fnds[0].message).toContain("every row of 'lead' is overwritten");
    expect(fnds[0].message).toContain('driver.updateMany');
    // Update has no extracted dispatch module, so the message cites the branch
    // itself rather than borrowing delete's case-set.
    expect(fnds[0].message).toContain('bulk branch on `options.multi`');
    expect(fnds[0].message).not.toContain('delete-dispatch case-set');
  });

  it('names the #3810 run-time guard and says the two judge DIFFERENT facts', () => {
    const [f] = lintFlowPatterns(purgeFlow('delete_record', { objectName: 'lead', multi: true }));
    // Cross-naming, not duplication: the run-time guard refuses "a condition you
    // WROTE is gone"; this rule warns "no condition was ever written".
    expect(f.hint).toContain('#3810');
    expect(f.hint).toMatch(/REFUSES this node at run time/);
    expect(f.hint).toMatch(/a written condition is gone/);
    expect(f.hint).toMatch(/the filter is empty/);
    // Both ways out are offered, and the run-time path is explicitly NOT closed.
    expect(f.hint).toMatch(/Write the constraint you mean/);
    expect(f.hint).toMatch(/warning, not a gate/);
    expect(f.hint).toContain('showcase_inquiry_purge');
  });

  describe('does NOT flag (false-positive guards)', () => {
    it('a bulk write BOUNDED by a filter — the showcase purge shape', () => {
      expect(
        lintFlowPatterns(purgeFlow('delete_record', {
          objectName: 'showcase_inquiry', filter: { status: 'closed' }, multi: true,
        })),
      ).toHaveLength(0);
    });

    it('a filter whose only condition is a TEMPLATE — that is #3810\'s fact, at run time', () => {
      // `{record.ownr}` (a typo) interpolates to nothing and the run-time guard
      // REFUSES the node. At authoring time the condition is written, so warning
      // "nothing bounds this" here would be false — and would put two diagnostics
      // on one defect, one of them wrong about what the author did.
      expect(
        lintFlowPatterns(purgeFlow('delete_record', {
          objectName: 'lead', filter: { owner: '{record.ownr}' }, multi: true,
        })),
      ).toHaveLength(0);
    });

    it('no `multi` at all — the engine refuses that call BY NAME already', () => {
      // `Delete requires an ID or options.multi=true`. Nothing silent to warn
      // about, and #5482 is scoped to the declared-bulk shape.
      expect(lintFlowPatterns(purgeFlow('delete_record', { objectName: 'lead' }))).toHaveLength(0);
      expect(lintFlowPatterns(purgeFlow('delete_record', { objectName: 'lead', filter: {} }))).toHaveLength(0);
    });

    it('`multi: false` — the declaration says the opposite', () => {
      expect(lintFlowPatterns(purgeFlow('delete_record', { objectName: 'lead', multi: false }))).toHaveLength(0);
    });

    it('`multi: \'true\'` (a string) — the schema refuses the node, so it cannot run', () => {
      // The executor tests `cfg.multi === true` and the schema types the key
      // `z.boolean()`; a string is a parse refusal, not declared bulk intent.
      expect(lintFlowPatterns(purgeFlow('delete_record', { objectName: 'lead', multi: 'true' }))).toHaveLength(0);
    });

    it('a node type that carries no `multi` declaration', () => {
      // `get_record` does not write and has no bulk intent; `create_record` has
      // neither `filter` nor `multi`. A stray key there is the schema's business.
      expect(lintFlowPatterns(purgeFlow('get_record', { objectName: 'lead', multi: true }))).toHaveLength(0);
      expect(lintFlowPatterns(purgeFlow('create_record', { objectName: 'lead', multi: true }))).toHaveLength(0);
    });

    it('a non-object `filter` — refused by name at execute time, so no run to describe', () => {
      expect(
        lintFlowPatterns(purgeFlow('delete_record', { objectName: 'lead', filter: 'status = closed', multi: true })),
      ).toHaveLength(0);
    });

    /**
     * #5659 — the FALSE half of the identity family, and the reason this rule
     * consumes the shared reduction instead of testing "is it an empty
     * combinator". Both shapes below match NOTHING: warning that they write the
     * whole object would be the exact false alarm a hand-written test produces.
     */
    it('a filter that reduces to FALSE — matches no row, so nothing to warn about', () => {
      expect(
        lintFlowPatterns(purgeFlow('delete_record', { objectName: 'lead', filter: { $or: [] }, multi: true })),
      ).toHaveLength(0);
      expect(
        lintFlowPatterns(purgeFlow('delete_record', { objectName: 'lead', filter: { $not: {} }, multi: true })),
      ).toHaveLength(0);
      // FALSE dominates the AND of a node, so a TRUE combinator beside it does
      // not make the write unbounded.
      expect(
        lintFlowPatterns(
          purgeFlow('delete_record', { objectName: 'lead', filter: { $and: [], $or: [] }, multi: true }),
        ),
      ).toHaveLength(0);
    });

    it('a filter the reduction cannot resolve — `clause`, the conservative answer', () => {
      // A non-array combinator operand is refused by name at the driver door and
      // by the schema; the shared predicate answers `'clause'` for it, and this
      // rule must not turn "I cannot reduce this" into "it writes every row".
      expect(
        lintFlowPatterns(purgeFlow('delete_record', { objectName: 'lead', filter: { $and: 'x' }, multi: true })),
      ).toHaveLength(0);
      expect(
        lintFlowPatterns(
          purgeFlow('delete_record', { objectName: 'lead', filter: { $or: [{ status: 'closed' }] }, multi: true }),
        ),
      ).toHaveLength(0);
    });
  });

  /**
   * #5659 — the two shapes this rule was BLIND to until the identity reduction
   * became a shared predicate.
   *
   * Measured on `origin/main` before this change, both returned `[]`: the rule
   * answered "does the filter have zero keys", and each of these has one. They
   * are whole-object writes by the same ruling (#5322/#5134) every driver
   * executes, and the rule now asks that ruling's own implementation
   * (`@objectstack/spec` `reduceFilterVerdict`) rather than a fourth hand copy.
   */
  describe('a filter that REDUCES to TRUE (#5659)', () => {
    it('flags `{ $and: [] }` — the AND identity, i.e. the whole object', () => {
      const fnds = lintFlowPatterns(
        purgeFlow('delete_record', { objectName: 'lead', filter: { $and: [] }, multi: true }),
      );
      expect(fnds).toHaveLength(1);
      expect(fnds[0].rule).toBe(FLOW_MULTI_WRITE_UNFILTERED);
      expect(fnds[0].where).toBe("flow 'nightly_purge' · node 'purge' (delete_record)");
      expect(fnds[0].severity).toBeUndefined();
      // Named as what it is. Calling a non-empty filter "EMPTY" would send the
      // author looking for a typo instead of reading the identity.
      expect(fnds[0].message).toContain('REDUCES TO TRUE');
      expect(fnds[0].message).toContain('{"$and":[]}');
      expect(fnds[0].message).not.toContain('an EMPTY `filter`');
      expect(fnds[0].message).toContain("every row of 'lead' is deleted");
    });

    it('flags `{ $or: [{}] }` — a TRUE disjunct absorbs its `$or`', () => {
      const fnds = lintFlowPatterns(
        purgeFlow('delete_record', { objectName: 'lead', filter: { $or: [{}] }, multi: true }),
      );
      expect(fnds).toHaveLength(1);
      expect(fnds[0].rule).toBe(FLOW_MULTI_WRITE_UNFILTERED);
      expect(fnds[0].message).toContain('REDUCES TO TRUE');
      expect(fnds[0].message).toContain('{"$or":[{}]}');
    });

    it('flags the shape at depth, and on update_record too', () => {
      // `{}` is a TRUE disjunct at any nesting, and `$not` of a FALSE group is
      // TRUE — the reduction is a walk, not a top-level shape test.
      expect(
        lintFlowPatterns(
          purgeFlow('delete_record', { objectName: 'lead', filter: { $or: [{ $and: [] }] }, multi: true }),
        ),
      ).toHaveLength(1);
      expect(
        lintFlowPatterns(
          purgeFlow('update_record', {
            objectName: 'lead', fields: { status: 'stale' }, filter: { $not: { $or: [] } }, multi: true,
          }),
        ),
      ).toHaveLength(1);
    });

    it('answers the same verdict the drivers execute', () => {
      // The point of the shared predicate, asserted directly: this rule's
      // "carries no condition" IS `reduceFilterVerdict(...) === 'true'`.
      for (const filter of [{}, { $and: [] }, { $or: [{}] }, { $or: [{ $and: [] }] }]) {
        expect(reduceFilterVerdict(filter), JSON.stringify(filter)).toBe('true');
        expect(
          lintFlowPatterns(purgeFlow('delete_record', { objectName: 'lead', filter, multi: true })),
        ).toHaveLength(1);
      }
      for (const filter of [{ $or: [] }, { $not: {} }, { status: 'closed' }]) {
        expect(reduceFilterVerdict(filter), JSON.stringify(filter)).not.toBe('true');
        expect(
          lintFlowPatterns(purgeFlow('delete_record', { objectName: 'lead', filter, multi: true })),
        ).toHaveLength(0);
      }
    });
  });

  /**
   * The rule's main habitat. A scheduled sweep whose per-item work sits in a
   * `loop` body is the standard shape for a janitor flow, so a rule that only
   * saw top-level nodes would miss the case it was written for — the #5383/#5635
   * blind spot, in the exact family that closed it.
   */
  describe('inside a nested region (#5383 / #5635)', () => {
    it('flags a loop-body sweep, scoped to the region, exactly once', () => {
      const fnds = lintFlowPatterns(loopBodyFlow({
        nodes: [
          { id: 'sweep', type: 'delete_record', config: { objectName: 'campaign_member', multi: true } },
        ],
        edges: [],
      }));
      expect(fnds).toHaveLength(1);
      expect(fnds[0].rule).toBe(FLOW_MULTI_WRITE_UNFILTERED);
      expect(fnds[0].where).toBe(
        "flow 'campaign_enrollment' · loop 'loop_leads' body · node 'sweep' (delete_record)",
      );
      // Not attributed to the enclosing container: the `loop`'s own config
      // CONTAINS the body, but this rule reads named keys (`multi`, `filter`) off
      // each node, and a `loop` declares neither — so there is no second copy.
      expect(fnds[0].where).not.toContain("node 'loop_leads'");
      expect(fnds[0].message).toContain("every row of 'campaign_member' is deleted");
    });

    /**
     * The INNER container for the two-regions-deep case, named so the pin below
     * reads the object the fixture descends into (#5700). The planted defect is
     * the body node's unfiltered `multi: true`; the container around it has to
     * be authorable or the case proves this rule against a `loop` the schema
     * refuses — and the enclosing shell pin cannot see in here, because
     * `FlowNodeSchema` declares `config` as an open record.
     */
    const nestedTouchpointsResetLoop = {
      collection: '{lead.touchpoints}', iteratorVariable: 'tp',
      body: {
        nodes: [{
          id: 'reset', type: 'update_record', label: 'Reset Touchpoints',
          config: { objectName: 'touchpoint', fields: { done: false }, multi: true },
        }],
        edges: [],
      },
    };

    it('pins that inner loop container against LoopConfigSchema (#5700)', () => {
      expect(LoopConfigSchema.safeParse(nestedTouchpointsResetLoop).success).toBe(true);
    });

    it('flags an update_record two regions deep', () => {
      const fnds = lintFlowPatterns(loopBodyFlow({
        nodes: [{ id: 'loop_touchpoints', type: 'loop', label: 'Loop Touchpoints', config: nestedTouchpointsResetLoop }],
        edges: [],
      }));
      expect(fnds).toHaveLength(1);
      expect(fnds[0].rule).toBe(FLOW_MULTI_WRITE_UNFILTERED);
      expect(fnds[0].where).toBe(
        "flow 'campaign_enrollment' · loop 'loop_leads' body → loop 'loop_touchpoints' body · " +
        "node 'reset' (update_record)",
      );
    });

    it('leaves a BOUNDED loop-body sweep alone', () => {
      expect(lintFlowPatterns(loopBodyFlow({
        nodes: [{
          id: 'sweep', type: 'delete_record',
          config: { objectName: 'campaign_member', filter: { lead_id: '{lead.id}' }, multi: true },
        }],
        edges: [],
      }))).toHaveLength(0);
    });
  });
});
