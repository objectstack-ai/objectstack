// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { TimeRelativeTriggerSchema, LoopConfigSchema, ParallelConfigSchema, TryCatchConfigSchema, HttpConfigSchema, FlowSchema, NotifyConfigSchema, textSlotTemplateRefusal } from '@objectstack/spec/automation';
// [#19939] The value-slot judge, asked by the `flow-bare-dollar-reference` pins
// below for the spelling its hint must carry and for the verdict on it.
import { flowNodeValueTemplateRefusals, VALUE_SLOT_TEMPLATE_REFUSAL, valueSlotTemplateRefusals } from '@objectstack/spec/automation';
import { TYPED_EXPRESSION_DIALECT_ONLY, TYPED_EXPRESSION_SOURCE_REQUIRED } from '@objectstack/spec/shared';
// [#5659] The shared identity reduction, asserted beside the rule that consumes
// it — the rule's verdict and the drivers' verdict are one object now.
import { reduceFilterVerdict } from '@objectstack/spec/data';
// [#17495] The published sentence the blank-condition refusal leads with,
// asserted from the spec's own export rather than re-spelled here — see the
// re-judged pin in `flow-inert-node-condition` below.
import { EVALUATED_EXPRESSION_SOURCE_REQUIRED } from '@objectstack/spec';
import { AUTHORING_RULES } from './authoring-rules.js';
import { explainRule } from './rule-explanations.js';
import {
  lintFlowPatterns as lintFlowPatternsUnrecorded,
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
  FLOW_LOOP_BODY_UNCONTAINED,
  FLOW_TRY_CATCH_WITHOUT_CATCH,
  FLOW_DECISION_MODE_INVALID,
  FLOW_DECISION_INCLUSIVE_OVERLAP,
} from './lint-flow-patterns.js';
// [#17495] Cross-site pin only — the re-judged `flow-inert-node-condition`
// case below. This family's own coverage is unaffected by it;
// `validate-expressions.test.ts` owns the rest of that rule's coverage.
import { validateStackExpressions } from './validate-expressions.js';

// [#22161] Slice 19: every finding of the two wrong-syntax ids is recorded, and
// the hint block at the foot of the file holds each recorded `fix:` line to one
// line of at most 200 characters.
const firedHints: Array<{ rule: string; message: string; hint: string }> = [];
// [#22161] Slice 20: the twelve anti-pattern ids, recorded the same way for the
// second hint block at the foot of the file.
const SLICE_20_IDS: readonly string[] = [
  FLOW_LOOP_BODY_UNCONTAINED,
  FLOW_MULTI_WRITE_UNFILTERED,
  FLOW_TRY_CATCH_WITHOUT_CATCH,
  FLOW_DECISION_INCLUSIVE_OVERLAP,
  FLOW_APPROVAL_REVISE_TARGET_NOT_SERVICE_OWNED,
  FLOW_TIME_RELATIVE_ANTIPATTERN,
  FLOW_DATE_EQUALITY_FILTER,
  FLOW_RUNAS_UNSCOPED,
  FLOW_DECISION_MODE_INVALID,
  FLOW_DECISION_UNCONDITIONAL_BRANCH,
  FLOW_ERROR_LABEL_NOT_FAULT,
  FLOW_BRANCH_LABEL_UNMATCHED,
];
const firedSlice20Hints: Array<{ rule: string; message: string; hint: string }> = [];
const lintFlowPatterns: typeof lintFlowPatternsUnrecorded = (...args) => {
  const findings = lintFlowPatternsUnrecorded(...args);
  for (const f of findings) {
    if (f.rule === FLOW_DOUBLE_BRACE_INTERP || f.rule === FLOW_BARE_DOLLAR_REF) firedHints.push(f as { rule: string; message: string; hint: string });
    if (SLICE_20_IDS.includes(f.rule)) firedSlice20Hints.push(f as { rule: string; message: string; hint: string });
  }
  return findings;
};
/** [#22161] What `os explain RULE_ID` prints for `rule`, one paragraph per line. */
const explained = (rule: string) => explainRule(rule)!.paragraphs.join('\n');

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
      expect(lintFlowPatterns(filterFlow({ status: 'active', id: CEL('record.id') }))).toHaveLength(0);
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
    // A single-brace token is neither a double brace nor a bare `$` reference,
    // so neither #1315 rule fires on it. In a value slot like this one the
    // token is refused anyway — by the value-slot judge (#19939), a different
    // finding (`expression-invalid` at `objectstack validate`), not this rule's.
    it('a single-brace token draws neither interpolation rule (the value-slot judge refuses it, a different finding)', () => {
      expect(rules(nodeFlow({ objectName: 'm', fields: { body: '{ai_reply}', t: 'Hi {record.name}' } }))).toEqual([]);
    });
    it('a braced $User token is not a BARE $ reference (the value-slot judge refuses it, a different finding)', () => {
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
      n.id === 'wait' ? { id: 'wait', type: 'wait', waitEventConfig: { eventType: 'signal' } } : n,
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
      collection: { dialect: 'cel', source: 'vars.rows' },
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
      // Scoped to this rule (#14394): the same fixture now also trips the
      // containment warning — an `update_record` inside a `loop` body with no
      // `try_catch` — a different verdict about a different node. The twin
      // below pins that co-occurrence explicitly rather than filtering it away.
      const fnds = lintFlowPatterns(sweepFlow()).filter((f) => f.rule === FLOW_RUNAS_UNSCOPED);
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
      // Both verdicts, in the order the pass emits them: the flow-level `runAs`
      // error, then the #14394 containment warning for the same nested write —
      // an unscoped loop-body write is ALSO an uncontained one, and each rule
      // says its own thing about it exactly once.
      expect(fnds.map((f) => f.rule)).toEqual([FLOW_RUNAS_UNSCOPED, FLOW_LOOP_BODY_UNCONTAINED]);
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
                collection: { dialect: 'cel', source: 'vars.rows' }, iteratorVariable: 'row',
                body: {
                  nodes: [{
                    id: 'loop_children', type: 'loop', label: 'Loop Children',
                    config: {
                      collection: { dialect: 'cel', source: 'row.children' }, iteratorVariable: 'child',
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
      // Scoped to THIS rule since #16093. The assertion was a global zero,
      // which held only because the fully-inert decision was invisible: the
      // `decision` half of this fixture declares no `conditions[]` and no edge
      // is guarded, so it now (correctly) draws a `flow-decision-unconditional-
      // branch` warning of its own. A bare `label` is not a guard in either
      // half of that rule — the mixed branch has always counted a labelled
      // edge the decision cannot select as ungated — so exempting it here to
      // keep the zero would make one rule id answer two ways. What this case
      // tests is unchanged: an error-ish label out of a branching node is not
      // the #3863 footgun.
      const fnds = lintFlowPatterns(edgeFlow({ label: 'error' }, sourceType));
      expect(fnds.filter((f) => f.rule === FLOW_ERROR_LABEL_NOT_FAULT)).toHaveLength(0);
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

  // #16093 — the fully-inert gateway, the shape the rule could not see. Until
  // this case landed, `if (gated.length === 0) continue` dropped exactly the
  // node whose declared branching is worst: a `decision` with NO edge
  // `condition`, NO `isDefault` and NO `config.conditions[]`. The mixed case
  // (one guarded edge, one not) was at least partially routed; this one was not
  // routed at all, and it is the harder one to spot, because the node still
  // says `type: 'decision'`.
  it('flags a decision that gates on NOTHING — no edge guard, no conditions[]', () => {
    const fnds = lintFlowPatterns({
      flows: [{
        name: 'plain',
        nodes: [{ id: 'start', type: 'start', config: {} }, { id: 'check', type: 'decision' }, { id: 'a', type: 'screen', config: {} }],
        edges: [
          { id: 'e1', source: 'start', target: 'check' },
          { id: 'e2', source: 'check', target: 'a' },
        ],
      }],
    }).filter((f) => f.rule === FLOW_DECISION_UNCONDITIONAL_BRANCH);

    expect(fnds).toHaveLength(1);
    // Advisory, like the mixed shape: an unconditional fan-out is legal — the
    // node is merely typed `decision` while behaving as a plain step. See the
    // severity policy at the top of the rule module.
    expect(fnds[0].severity).toBeUndefined();
    expect(fnds[0].where).toContain("decision 'check'");
    // Names the node's out-edge targets and what the decision gates on.
    expect(fnds[0].message).toContain('gates on NOTHING');
    expect(fnds[0].message).toContain("'a'");
    expect(fnds[0].message).toContain('EVERY pass');
    expect(fnds[0].hint).toContain('conditions');
  });

  // The wording is the whole point of keeping this under the SAME rule id: the
  // fully-inert shape must NOT read as the mixed "guarded alongside unguarded"
  // sentence, which would send the author looking for a guard that is not there.
  it('does not describe the inert decision with the mixed-branch wording', () => {
    const inert = lintFlowPatterns({
      flows: [{
        name: 'plain',
        nodes: [{ id: 'start', type: 'start', config: {} }, { id: 'check', type: 'decision' }, { id: 'a', type: 'screen', config: {} }],
        edges: [
          { id: 'e1', source: 'start', target: 'check' },
          { id: 'e2', source: 'check', target: 'a' },
        ],
      }],
    }).filter((f) => f.rule === FLOW_DECISION_UNCONDITIONAL_BRANCH);
    expect(inert[0].message).not.toContain('alongside');

    const mixed = lintFlowPatterns(guardFlow()).filter(
      (f) => f.rule === FLOW_DECISION_UNCONDITIONAL_BRANCH,
    );
    expect(mixed[0].message).toContain('alongside');
    // One finding each — the inert branch must not double-report the mixed one.
    expect(mixed).toHaveLength(1);
  });

  it('flags EVERY out-edge of an inert decision in one finding, not one each', () => {
    const fnds = lintFlowPatterns({
      flows: [{
        name: 'plain',
        nodes: [
          { id: 'start', type: 'start', config: {} },
          { id: 'check', type: 'decision' },
          { id: 'a', type: 'screen', config: {} },
          { id: 'b', type: 'screen', config: {} },
        ],
        edges: [
          { id: 'e1', source: 'start', target: 'check' },
          { id: 'e2', source: 'check', target: 'a' },
          { id: 'e3', source: 'check', target: 'b' },
        ],
      }],
    }).filter((f) => f.rule === FLOW_DECISION_UNCONDITIONAL_BRANCH);
    expect(fnds).toHaveLength(1);
    expect(fnds[0].message).toContain("'a'");
    expect(fnds[0].message).toContain("'b'");
  });

  // As measured on the reporting app: the inert decision sat inside a `loop`
  // body, so the finding has to survive region descent (#5383) too.
  it('flags a nested inert decision inside a loop body', () => {
    const fnds = lintFlowPatterns(loopBodyFlow({
      nodes: [
        { id: 'gate', type: 'decision' },
        { id: 'nudge', type: 'create_record', config: { objectName: 'touch_log' } },
      ],
      edges: [{ id: 'b1', source: 'gate', target: 'nudge' }],
    })).filter((f) => f.rule === FLOW_DECISION_UNCONDITIONAL_BRANCH);
    expect(fnds).toHaveLength(1);
    expect(fnds[0].where).toBe("flow 'campaign_enrollment' · loop 'loop_leads' body · decision 'gate'");
    expect(fnds[0].message).toContain("'nudge'");
  });

  // ⛔ NEGATIVE CONTROL — the ordinary gateway. Guarded edges AND a matching
  // `config.conditions[]`: the shape every correct flow has, and the one a new
  // positive case is most likely to break. It must stay silent.
  it('does NOT flag a normal decision — guarded edges plus matching conditions[]', () => {
    expect(lintFlowPatterns(guardFlow({
      proceed: { isDefault: true },
      conditions: [{ label: 'Yes', expression: "lead.status == 'converted'" }],
    }))).toHaveLength(0);
  });

  // ⛔ NEGATIVE CONTROL — routing by `config.conditions[]` alone. The edges
  // carry no `condition` and no `isDefault`, so `gated` is empty, but the
  // decision DOES declare its branching: the labels select the path. Not inert.
  it('does NOT flag a decision that routes by conditions[] alone', () => {
    expect(lintFlowPatterns({
      flows: [{
        name: 'by_label',
        nodes: [
          { id: 'start', type: 'start', config: {} },
          {
            id: 'check', type: 'decision',
            config: { conditions: [{ label: 'Yes', expression: 'lead.score > 50' }, { label: 'No', expression: 'true' }] },
          },
          { id: 'a', type: 'screen', config: {} },
          { id: 'b', type: 'screen', config: {} },
        ],
        edges: [
          { id: 'e1', source: 'start', target: 'check' },
          { id: 'e2', source: 'check', target: 'a', label: 'Yes' },
          { id: 'e3', source: 'check', target: 'b', label: 'No' },
        ],
      }],
    })).toHaveLength(0);
  });

  // ⛔ NO DOUBLE REPORT — a decision that declares `conditions[]` no out-edge
  // claims is already the GATING `flow-branch-label-unmatched`; the inert branch
  // must not pile a second, contradictory finding on the same node.
  it('leaves an unmatched-label decision to flow-branch-label-unmatched alone', () => {
    const fnds = lintFlowPatterns({
      flows: [{
        name: 'unmatched',
        nodes: [
          { id: 'start', type: 'start', config: {} },
          { id: 'check', type: 'decision', config: { conditions: [{ label: 'Yes', expression: 'true' }] } },
          { id: 'a', type: 'screen', config: {} },
        ],
        edges: [
          { id: 'e1', source: 'start', target: 'check' },
          { id: 'e2', source: 'check', target: 'a' },
        ],
      }],
    });
    expect(fnds.filter((f) => f.rule === FLOW_DECISION_UNCONDITIONAL_BRANCH)).toHaveLength(0);
    expect(fnds.filter((f) => f.rule === FLOW_BRANCH_LABEL_UNMATCHED)).toHaveLength(1);
  });

  // A decision with no out-edge at all is a different defect and is skipped
  // before any of this (`outs.length === 0`); the inert branch must not claim it.
  it('does NOT flag a decision with no out-edge at all', () => {
    expect(lintFlowPatterns({
      flows: [{
        name: 'dead_end',
        nodes: [{ id: 'start', type: 'start', config: {} }, { id: 'check', type: 'decision' }],
        edges: [{ id: 'e1', source: 'start', target: 'check' }],
      }],
    }).filter((f) => f.rule === FLOW_DECISION_UNCONDITIONAL_BRANCH)).toHaveLength(0);
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

  it('does NOT flag a node with no condition, or an empty one — but validate no longer stays silent on the blank (#17495)', () => {
    expect(lintFlowPatterns(conditionNodeFlow('decision', {}))).toHaveLength(0);
    expect(lintFlowPatterns(conditionNodeFlow('decision', { condition: '   ' }))).toHaveLength(0);
    // RE-JUDGED IN PLACE (#17495), not deleted — the two zeros above are
    // deliberate and they still stand, but the REASON the blank one stands has
    // changed and the pin now says so.
    //
    // What it recorded: this pin sat over the whole `lintFlowPatterns` answer,
    // taken at a time when `objectstack validate` as a whole admitted a blank
    // `config.condition` — `registerFlow` admitted it too, and #15662 ruled
    // that agreement correct. It was therefore readable as "validate says
    // nothing about a blank condition". Since #17322 rebound `registerFlow` to
    // the edge door's non-blank rule, that reading would be a false record.
    //
    // What it records now: `flow-inert-node-condition` (#4414) is about a key
    // NOTHING READS, and a blank condition is not that — this family has no
    // opinion on blankness and never had one, so its zero is unchanged and is
    // NOT a statement about validate's answer. The refusal lives one pass over,
    // in `validateStackExpressions` (#17495), and the cross-site assertion
    // below is what keeps the zero above from being read as silence again.
    const blank = conditionNodeFlow('decision', { condition: '   ' });
    const refusals = validateStackExpressions(blank);
    expect(refusals).toHaveLength(1);
    expect(refusals[0].message).toBe(EVALUATED_EXPRESSION_SOURCE_REQUIRED);
    expect(refusals[0].where).toContain("node 'n' (decision) condition");
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
  collection: { dialect: 'cel', source: 'vars.leads' },
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
          collection: { dialect: 'cel', source: 'lead.touchpoints' }, itemVar: 'tp',
          body: { nodes: [{ id: 'reset', type: 'update_record', label: 'Reset', config: {} }], edges: [] },
        },
      }],
      edges: [],
    }));
    expect(shellWithBadInnerLoop.success).toBe(true);

    // …whereas the very same inner config, parsed as the container it is, is refused.
    expect(refusedKeys(LoopConfigSchema.safeParse({
      collection: { dialect: 'cel', source: 'lead.touchpoints' }, itemVar: 'tp',
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
    // Scoped to this rule: the fixture's `create_record` also trips the #14394
    // containment warning, which is a different rule about a different node.
    const fnds = lintFlowPatterns(nested()).filter((f) => f.rule === FLOW_INERT_NODE_CONDITION);
    // Exactly one finding for this rule: no collateral from the descent, and no
    // second copy reported against the enclosing `loop`.
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
    collection: { dialect: 'cel', source: 'lead.touchpoints' }, iteratorVariable: 'tp',
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
    // Scoped to this rule: the body's `notify` also trips the #14394
    // containment warning.
    })).filter((f) => f.rule === FLOW_DEFAULT_EDGE_WITH_CONDITION);
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
      // A value slot (`recipients`, since #19939), where a doubled brace is
      // no hole: the notify `title` reads `{{ }}` since #22110, so a doubled
      // brace there is no finding.
      nodes: [{ id: 'send_reminder', type: 'notify', config: { title: 'Reminder: {{ lead.name }}', recipients: ['{{lead.owner}}'] } }],
      edges: [],
    // Scoped to this rule: the body's `notify` also trips the #14394
    // containment warning.
    })).filter((f) => f.rule === FLOW_DOUBLE_BRACE_INTERP);
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
    // [#22161] The `fix:` line is the remedy alone; the cross-naming and the
    // way to keep a meant whole-object write are `os explain` (pinned here
    // where they were pinned on the hint before).
    const text = explained(FLOW_MULTI_WRITE_UNFILTERED);
    // Cross-naming, not duplication: the run-time guard refuses "a condition you
    // WROTE is gone"; this rule warns "no condition was ever written".
    expect(text).toContain('the run-time erased-condition guard');
    expect(text).toMatch(/REFUSES this node at run time/);
    expect(text).toMatch(/a written condition is gone/);
    expect(text).toMatch(/the filter is empty/);
    // Both ways out are offered, and the run-time path is explicitly NOT closed.
    expect(f.hint).toMatch(/Write the constraint you mean/);
    expect(text).toMatch(/warning, not a gate/);
    expect(text).toContain('showcase_inquiry_purge');
    expect(f.hint).not.toContain('erased-condition guard');
  });

  describe('does NOT flag (false-positive guards)', () => {
    it('a bulk write BOUNDED by a filter — the showcase purge shape', () => {
      expect(
        lintFlowPatterns(purgeFlow('delete_record', {
          objectName: 'showcase_inquiry', filter: { status: 'closed' }, multi: true,
        })),
      ).toHaveLength(0);
    });

    // [#19939, stage S6] RE-JUDGED IN PLACE: the operand was a `{record.ownr}`
    // token, refused at every door since S6; the run-time fact is the same for
    // an operand envelope that evaluates to nothing.
    it('a filter whose only operand is COMPUTED — that is #3810\'s fact, at run time', () => {
      // An operand envelope that evaluates to nothing (a record with no owner)
      // and the run-time guard REFUSES the node. At authoring time the
      // condition is written, so warning "nothing bounds this" here would be
      // false — and would put two diagnostics on one defect, one of them wrong
      // about what the author did.
      expect(
        lintFlowPatterns(purgeFlow('delete_record', {
          objectName: 'lead', filter: { owner: CEL('record.owner') }, multi: true,
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
      // Scoped to this rule: a `delete_record` in a loop body also trips the
      // #14394 containment warning.
      const fnds = lintFlowPatterns(loopBodyFlow({
        nodes: [
          { id: 'sweep', type: 'delete_record', config: { objectName: 'campaign_member', multi: true } },
        ],
        edges: [],
      })).filter((f) => f.rule === FLOW_MULTI_WRITE_UNFILTERED);
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
      collection: { dialect: 'cel', source: 'lead.touchpoints' }, iteratorVariable: 'tp',
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
      })).filter((f) => f.rule === FLOW_MULTI_WRITE_UNFILTERED);
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
          config: { objectName: 'campaign_member', filter: { lead_id: CEL('lead.id') }, multi: true },
        }],
        edges: [],
        // Scoped to this rule: a bounded write is still an uncontained one, so
        // the #14394 warning is present and is not this rule's business.
      })).filter((f) => f.rule === FLOW_MULTI_WRITE_UNFILTERED)).toHaveLength(0);
    });
  });
});

/**
 * #13681 / #14394 — per-iteration containment, the rule PAIR.
 *
 * The measured facts these cases pin (measurement on the real `AutomationEngine`,
 * recorded on #13681): a 5-item sweep whose 3rd item fails processes 3 items and
 * reports `acted: 0` when the body is bare; the same sweep processes all 5 and
 * completes when the body is `try_catch { try, catch }`; and a `try_catch` with
 * NO `catch` produces output byte-identical to the bare control. Hence one rule
 * for the missing wrapper and one for the wrapper that contains nothing.
 */
describe('per-iteration containment (#13681 / #14394)', () => {
  /** A scheduled sweep whose per-item work is whatever the case puts in the body. */
  const sweep = (bodyNodes: unknown[], bodyEdges: unknown[] = [], loopExtra: Record<string, unknown> = {}) => ({
    flows: [{
      name: 'case_sla_monitor',
      label: 'Case SLA monitor',
      type: 'schedule',
      // `system`, so the fixture answers about containment only and does not
      // also trip the user-less `runAs` gate (FLOW_RUNAS_UNSCOPED).
      runAs: 'system',
      nodes: [
        { id: 'start', type: 'start', label: 'Start', config: { triggerType: 'schedule', schedule: 'cron:0 9 * * *' } },
        {
          id: 'each', type: 'loop', label: 'For each breached case',
          config: {
            collection: { dialect: 'cel', source: 'cases' }, iteratorVariable: 'currentCase',
            body: { nodes: bodyNodes, edges: bodyEdges },
            ...loopExtra,
          },
        },
      ],
      edges: [{ id: 'e1', source: 'start', target: 'each' }],
    }],
  });

  const notifyOwner = {
    id: 'notify_owner', type: 'notify', label: 'Notify owner',
    config: { title: 'SLA breach', recipients: ['{currentCase.owner}'] },
  };

  /**
   * The measured minimal `catch`: one bare `assignment` node with NO `config`.
   * `edges` omitted (defaults to `[]`), `errorVariable` omitted (defaults to
   * `$error`). Quoted verbatim from #13681's measurement — not re-derived.
   */
  const MINIMAL_CATCH = { nodes: [{ id: 'handled', type: 'assignment', label: 'Handled' }] };

  describe('rule A — a loop body with a fallible node and no containment', () => {
    it('flags the fallible node, naming the loop AND the node', () => {
      const fnds = lintFlowPatterns(sweep([notifyOwner]));
      expect(fnds).toHaveLength(1);
      expect(fnds[0].rule).toBe(FLOW_LOOP_BODY_UNCONTAINED);
      expect(fnds[0].where).toBe(
        "flow 'case_sla_monitor' · loop 'each' body · node 'notify_owner' (notify)",
      );
      // The loop is named in the message too — `where` locates the node, the
      // message says which iteration boundary is unprotected.
      expect(fnds[0].message).toContain("inside loop 'each'");
      expect(fnds[0].message).toContain('no `try_catch` between them');
      // Warning, not a build gate: fail-fast is a legitimate reading.
      expect(fnds[0].severity).toBeUndefined();
      // The prescribed spelling, with the measured minimal `catch`.
      expect(fnds[0].hint).toContain("type: 'try_catch'");
      expect(fnds[0].hint).toContain("{ id: 'handled', type: 'assignment', label: 'Handled' }");
      // [#22161] The empty spellings the parse refuses moved to `os explain`.
      expect(explained(FLOW_LOOP_BODY_UNCONTAINED)).toContain('`catch: {}` and `catch: { nodes: [] }` are both refused');
      expect(fnds[0].hint).not.toContain('are both refused');
    });

    it('flags every fallible builtin in the body, once each', () => {
      const fallible = [
        { id: 'n1', type: 'get_record', label: 'Get', config: { objectName: 'case', filter: { id: CEL('currentCase.id') } } },
        { id: 'n2', type: 'create_record', label: 'Create', config: { objectName: 'task' } },
        { id: 'n3', type: 'update_record', label: 'Update', config: { objectName: 'case', fields: { seen: true }, filter: { id: CEL('currentCase.id') } } },
        { id: 'n4', type: 'delete_record', label: 'Delete', config: { objectName: 'task', filter: { case_id: CEL('currentCase.id') } } },
        { id: 'n5', type: 'http', label: 'Call', config: { url: 'https://example.test' } },
        { id: 'n6', type: 'notify', label: 'Notify', config: { title: 'x' } },
        { id: 'n7', type: 'connector_action', label: 'Connector', connectorConfig: { connectorId: 'c', actionId: 'a' } },
        { id: 'n8', type: 'script', label: 'Script', config: { function: 'f' } },
        { id: 'n9', type: 'subflow', label: 'Subflow', config: { flowName: 'child' } },
        { id: 'n10', type: 'map', label: 'Map', config: { collection: { dialect: 'cel', source: 'items' } } },
        { id: 'n11', type: 'approval', label: 'Approval', config: { approvers: ['{$User.Id}'] } },
      ];
      const fnds = lintFlowPatterns(sweep(fallible)).filter((f) => f.rule === FLOW_LOOP_BODY_UNCONTAINED);
      expect(fnds.map((f) => f.where)).toEqual(
        fallible.map((n) => `flow 'case_sla_monitor' · loop 'each' body · node '${n.id}' (${n.type})`),
      );
    });

    it('leaves the provably non-fallible builtins alone', () => {
      // Read off their executors: `assignment` / `decision` return success on
      // every path; `wait` and `screen` suspend and have no failure return.
      const fnds = lintFlowPatterns(sweep([
        { id: 'a', type: 'assignment', label: 'Set', config: { assignments: { seen: true } } },
        { id: 'd', type: 'decision', label: 'Gate' },
        { id: 'w', type: 'wait', label: 'Wait', config: { durationMs: 1000 } },
      ]));
      expect(fnds).toHaveLength(0);
    });

    it('leaves an UNKNOWN (plugin-registered) node type alone — the declared decision', () => {
      // Counting unread executors fallible would flag every third-party node in
      // every loop; this family's list is a record of readings, not a guess.
      // The cost is a false negative here, stated in the rule's docblock.
      expect(lintFlowPatterns(sweep([
        { id: 'x', type: 'acme_charge_card', label: 'Charge', config: { amount: 10 } },
      ]))).toHaveLength(0);
    });

    it('leaves a legacy flat-graph loop (no `body`) alone', () => {
      // `LoopConfigSchema.body` is optional — a body-less loop is the legacy
      // flat-graph form and has no region to judge.
      const legacy = {
        flows: [{
          name: 'case_sla_monitor', label: 'Case SLA monitor', type: 'schedule', runAs: 'system',
          nodes: [
            { id: 'start', type: 'start', label: 'Start', config: { triggerType: 'schedule', schedule: 'cron:0 9 * * *' } },
            { id: 'each', type: 'loop', label: 'Loop', config: { collection: { dialect: 'cel', source: 'cases' }, iteratorVariable: 'currentCase' } },
            { id: 'notify_owner', type: 'notify', label: 'Notify owner', config: { title: 'SLA breach' } },
          ],
          edges: [{ id: 'e1', source: 'start', target: 'each' }, { id: 'e2', source: 'each', target: 'notify_owner' }],
        }],
      };
      expect(lintFlowPatterns(legacy).filter((f) => f.rule === FLOW_LOOP_BODY_UNCONTAINED)).toHaveLength(0);
    });

    it('reads ancestry, not depth — a `try_catch` inside a `parallel` branch still contains', () => {
      const guarded = {
        id: 'guard', type: 'try_catch', label: 'Guarded',
        config: { try: { nodes: [notifyOwner], edges: [] }, catch: MINIMAL_CATCH },
      };
      expect(lintFlowPatterns(sweep([{
        id: 'fan', type: 'parallel', label: 'Fan out',
        config: {
          branches: [
            { name: 'notify', nodes: [guarded], edges: [] },
            { name: 'log', nodes: [{ id: 'note', type: 'assignment', label: 'Note' }], edges: [] },
          ],
        },
      }]))).toHaveLength(0);
    });

    it('flags a fallible node inside a `parallel` branch, with the branch in `where`', () => {
      const fnds = lintFlowPatterns(sweep([{
        id: 'fan', type: 'parallel', label: 'Fan out',
        config: {
          branches: [
            { name: 'email', nodes: [{ id: 'send', type: 'notify', label: 'Send', config: { title: 'x' } }], edges: [] },
            { name: 'log', nodes: [{ id: 'note', type: 'assignment', label: 'Note' }], edges: [] },
          ],
        },
      }]));
      expect(fnds).toHaveLength(1);
      expect(fnds[0].rule).toBe(FLOW_LOOP_BODY_UNCONTAINED);
      expect(fnds[0].where).toBe(
        "flow 'case_sla_monitor' · loop 'each' body → parallel 'fan' branch 0 · node 'send' (notify)",
      );
    });

    it('reports a nested loop ONCE, against the inner loop where the wrap belongs', () => {
      const fnds = lintFlowPatterns(sweep([{
        id: 'each_line', type: 'loop', label: 'For each line',
        config: {
          collection: { dialect: 'cel', source: 'currentCase.lines' }, iteratorVariable: 'line',
          body: { nodes: [notifyOwner], edges: [] },
        },
      }]));
      expect(fnds).toHaveLength(1);
      // Scoped to the INNER loop's own graph, not reported a second time through
      // the outer one: per-iteration containment is a per-loop question, and the
      // `try_catch` belongs in the innermost body.
      expect(fnds[0].where).toBe(
        "flow 'case_sla_monitor' · loop 'each' body · loop 'each_line' body · node 'notify_owner' (notify)",
      );
    });
  });

  describe('rule B — a `try_catch` with no `catch` region', () => {
    it('flags the near-miss inside a loop body, and says it dies like an unwrapped node', () => {
      const fnds = lintFlowPatterns(sweep([{
        id: 'guard', type: 'try_catch', label: 'Guarded',
        config: { try: { nodes: [notifyOwner], edges: [] } },
      }]));
      // Exactly one finding: rule A treats ANY enclosing `try_catch` as
      // containment precisely so this shape is named once, by the rule that can
      // name the missing key.
      expect(fnds).toHaveLength(1);
      expect(fnds[0].rule).toBe(FLOW_TRY_CATCH_WITHOUT_CATCH);
      expect(fnds[0].where).toBe(
        "flow 'case_sla_monitor' · loop 'each' body · node 'guard' (try_catch)",
      );
      expect(fnds[0].severity).toBeUndefined();
      expect(fnds[0].message).toContain('declares no `catch` region');
      expect(fnds[0].message).toContain('identical output');
      expect(fnds[0].hint).toContain("{ id: 'handled', type: 'assignment', label: 'Handled' }");
    });

    it('flags a TOP-LEVEL catch-less `try_catch` too — it fails through wherever it is written', () => {
      const fnds = lintFlowPatterns({
        flows: [{
          name: 'charge', label: 'Charge', type: 'autolaunched',
          nodes: [
            { id: 'start', type: 'start', label: 'Start', config: { triggerType: 'api' } },
            { id: 'guard', type: 'try_catch', label: 'Guarded', config: { try: { nodes: [{ id: 'pay', type: 'http', label: 'Pay', config: { url: 'https://example.test' } }], edges: [] } } },
          ],
          edges: [{ id: 'e1', source: 'start', target: 'guard' }],
        }],
      });
      expect(fnds).toHaveLength(1);
      expect(fnds[0].rule).toBe(FLOW_TRY_CATCH_WITHOUT_CATCH);
      expect(fnds[0].where).toBe("flow 'charge' · node 'guard' (try_catch)");
    });

    it('says what `retry` does and does not buy, when one is declared', () => {
      const fnds = lintFlowPatterns(sweep([{
        id: 'guard', type: 'try_catch', label: 'Guarded',
        config: {
          try: { nodes: [notifyOwner], edges: [] },
          retry: { maxRetries: 3, backoffMs: 1000, backoffMultiplier: 2 },
        },
      }]));
      expect(fnds).toHaveLength(1);
      expect(fnds[0].rule).toBe(FLOW_TRY_CATCH_WITHOUT_CATCH);
      expect(fnds[0].message).toContain('delays that outcome rather than changing it');
    });

    it('says NOTHING about a `catch` that is present but malformed — the schema refuses those', () => {
      // `catch: {}` and `catch: { nodes: [] }` are rejected by the parse itself
      // (`FlowRegionSchema.nodes` is `.min(1)`), loudly and with the schema's own
      // message. Lint speaks for the shape the schema ACCEPTS and the runtime
      // then makes useless.
      for (const malformed of [{}, { nodes: [] }]) {
        expect(TryCatchConfigSchema.safeParse({
          try: { nodes: [{ id: 'x', type: 'assignment', label: 'X' }] }, catch: malformed,
        }).success).toBe(false);
        expect(lintFlowPatterns(sweep([{
          id: 'guard', type: 'try_catch', label: 'Guarded',
          config: { try: { nodes: [notifyOwner], edges: [] }, catch: malformed },
        }])).filter((f) => f.rule === FLOW_TRY_CATCH_WITHOUT_CATCH)).toHaveLength(0);
      }
      // …and the minimal spelling the docs prescribe IS accepted.
      expect(TryCatchConfigSchema.safeParse({
        try: { nodes: [{ id: 'x', type: 'assignment', label: 'X' }] }, catch: MINIMAL_CATCH,
      }).success).toBe(true);
    });
  });

  /**
   * The NEGATIVE CONTROL the ruling asks for, made executable: the exact
   * spelling `content/docs/automation/flows.mdx` §"Per-iteration containment"
   * teaches — same ids, same labels — must both PARSE under `FlowSchema` and
   * produce no finding from either rule.
   */
  describe('the documented spelling — `loop { try_catch { try, catch } }`', () => {
    const DOCUMENTED_FLOW = {
      name: 'case_sla_monitor',
      label: 'Case SLA monitor',
      type: 'schedule' as const,
      runAs: 'system' as const,
      nodes: [
        { id: 'start', type: 'start', label: 'Start', config: { triggerType: 'schedule', schedule: 'cron:0 9 * * *' } },
        { id: 'find_cases', type: 'get_record', label: 'Find breached cases', config: { objectName: 'case', filter: { sla_breached: true }, outputVariable: 'cases' } },
        {
          id: 'each_case', type: 'loop', label: 'For each breached case',
          config: {
            collection: { dialect: 'cel', source: 'cases' },
            iteratorVariable: 'currentCase',
            body: {
              nodes: [{
                id: 'guard', type: 'try_catch', label: 'Guarded iteration',
                config: {
                  try: {
                    nodes: [{ id: 'notify_owner', type: 'notify', label: 'Notify owner', config: { title: 'SLA breach', recipients: ['{currentCase.owner}'] } }],
                    edges: [],
                  },
                  // The measured minimal handler: one bare `assignment`, no
                  // `config`; `edges` and `errorVariable` both omitted.
                  catch: { nodes: [{ id: 'handled', type: 'assignment', label: 'Handled' }] },
                },
              }],
              edges: [],
            },
          },
        },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'find_cases' },
        { id: 'e2', source: 'find_cases', target: 'each_case' },
      ],
    };

    it('parses under FlowSchema — the docs example is authorable', () => {
      const parsed = FlowSchema.safeParse(DOCUMENTED_FLOW);
      expect(parsed.success ? [] : parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`)).toEqual([]);
      expect(parsed.success).toBe(true);
    });

    it('raises NO finding from either containment rule', () => {
      const fnds = lintFlowPatterns({ flows: [DOCUMENTED_FLOW] });
      expect(fnds.filter((f) => f.rule === FLOW_LOOP_BODY_UNCONTAINED)).toHaveLength(0);
      expect(fnds.filter((f) => f.rule === FLOW_TRY_CATCH_WITHOUT_CATCH)).toHaveLength(0);
    });

    it('raises no finding from ANY flow rule — the page teaches a clean shape', () => {
      expect(lintFlowPatterns({ flows: [DOCUMENTED_FLOW] })).toHaveLength(0);
    });
  });
});

/**
 * #16405 — the two #1315 template rules reach an `http` node's REQUEST PAYLOAD.
 *
 * The recursive template scan read a region-stripped view of each node's config
 * built from the FLAT UNION of every region key on ANY node type (`body`,
 * `try`, `catch`, `branches`), rather than from the slots the node in hand
 * actually owns. `body` is `loop`'s region slot AND the canonical request-payload
 * key on an `http` node (`HttpConfigSchema.body`), so `config.body` was deleted
 * from EVERY node's view before the scan read it — and the payload is a
 * place an unresolved reference reaches a real outbound request. (Since
 * #19939 the body is a value slot: a literal there is sent as written, so a
 * `{{ }}` or a bare `$ref.x` in it ships as literal text, and both hints name
 * its CEL envelope.)
 *
 * Measured on the parent commit, both directions: every case in this block
 * returned ZERO findings for its rule before the call site passed
 * `ownRegionKeys(node.type)`.
 *
 * The over-correction direction is pinned too, and it is the one that breaks if
 * a repair strips NOTHING: the last case here keeps a payload token inside a
 * `loop` body reported exactly ONCE, on the node carrying it.
 */

/** An `http` push node's config: a real URL, a real method, and the payload under test. */
const httpPushConfig = (body: unknown) => ({
  url: 'https://api.example.com/v1/incidents',
  method: 'POST',
  body,
});

/** A scheduled flow whose one `http` node carries the payload under test. */
function httpFlow(body: unknown) {
  return {
    flows: [{
      name: 'incident_push',
      runAs: 'system',
      nodes: [
        { id: 'start', type: 'start', config: { triggerType: 'schedule', schedule: 'cron:0 3 * * *' } },
        { id: 'push', type: 'http', label: 'POST incident', config: httpPushConfig(body) },
      ],
      edges: [{ id: 'e1', source: 'start', target: 'push' }],
    }],
  };
}

/** The same `http` node, moved inside a `try_catch`'s `try` region. */
function guardedHttpFlow(body: unknown) {
  return {
    flows: [{
      name: 'incident_push',
      runAs: 'system',
      nodes: [
        { id: 'start', type: 'start', config: { triggerType: 'schedule', schedule: 'cron:0 3 * * *' } },
        {
          id: 'guard', type: 'try_catch', label: 'Guard',
          config: {
            try: {
              nodes: [{ id: 'push', type: 'http', label: 'POST incident', config: httpPushConfig(body) }],
              edges: [],
            },
            catch: {
              nodes: [{ id: 'log_failure', type: 'create_record', label: 'Log failure', config: { objectName: 'sync_error' } }],
              edges: [],
            },
          },
        },
      ],
      edges: [{ id: 'e1', source: 'start', target: 'guard' }],
    }],
  };
}

describe('#16405 — an `http` node payload is not a region, and both #1315 rules read it', () => {
  /**
   * #5700's bar, applied here: a payload these rules judge has to be one an
   * author can really write, or the pins prove a rule against metadata the
   * schema refuses. `HttpConfigSchema` is a `strictObject`, so a misspelled key
   * would surface as an `unrecognized_key` rather than being dropped.
   */
  it('pins the fixture payload as an authorable `http` config', () => {
    // [#19939] The fixture's keys and shape are authorable; the wrong-syntax
    // content these rules flag is refused by the body's own judge since the
    // body became a value slot — the one issue, at the string that carries it.
    const clean = HttpConfigSchema.safeParse(httpPushConfig({ text: 'Incident' }));
    expect(clean.success ? [] : clean.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`)).toEqual([]);
    const flagged = HttpConfigSchema.safeParse(httpPushConfig({ text: 'Incident {{record.title}}' }));
    expect(flagged.success ? [] : flagged.error.issues.map((i) => i.path.join('.'))).toEqual(['body.text']);
  });

  it('pins the guarded fixture as an authorable `try_catch` config', () => {
    const cfg = (guardedHttpFlow({ text: '{{record.title}}' }).flows[0].nodes[1] as { config: unknown }).config;
    const parsed = TryCatchConfigSchema.safeParse(cfg);
    expect(parsed.success ? [] : parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`)).toEqual([]);
    expect(parsed.success).toBe(true);
  });

  describe('flow-double-brace-interpolation', () => {
    it('flags a `{{ }}` token in a top-level `http` node payload', () => {
      const fnds = lintFlowPatterns(httpFlow({ text: 'Incident {{record.title}}' }))
        .filter((f) => f.rule === FLOW_DOUBLE_BRACE_INTERP);
      expect(fnds).toHaveLength(1);
      expect(fnds[0].where).toBe("flow 'incident_push' · node 'push' (http)");
      expect(fnds[0].message).toContain('{{record.title}}');
    });

    it('flags the same token when the `http` node sits inside a region', () => {
      const fnds = lintFlowPatterns(guardedHttpFlow({ text: 'Incident {{record.title}}' }))
        .filter((f) => f.rule === FLOW_DOUBLE_BRACE_INTERP);
      expect(fnds).toHaveLength(1);
      expect(fnds[0].where).toBe("flow 'incident_push' · try_catch 'guard' try · node 'push' (http)");
    });

    it('reaches a token nested deep inside the payload, not only its top level', () => {
      const fnds = lintFlowPatterns(httpFlow({ fields: [{ value: '{{record.amount}}' }] }))
        .filter((f) => f.rule === FLOW_DOUBLE_BRACE_INTERP);
      expect(fnds).toHaveLength(1);
    });

    /**
     * [#22081] The round trip an author makes after a refusal: write what it
     * prescribes, then build. A notify node's `title` / `message` refusal
     * (`NotifyConfigSchema`, `@objectstack/spec`) must never prescribe a
     * spelling this rule then flags on the same node. Every spelling the
     * refusal prescribes, read out of the refusal text itself rather than
     * re-spelled here, must parse and draw no finding. Since #22110 the two
     * slots read `{{ }}` and the prescription is a hole; the control is the
     * same spelling on the node's single-brace `actionUrl`, which still draws
     * the finding, so this pin can fail.
     */
    describe('a notify slot refusal prescribes only spellings this rule passes', () => {
      function notifyFlow(key: 'title' | 'message' | 'actionUrl' | 'sourceId', value: unknown) {
        return {
          flows: [{
            name: 'deal_won_notice',
            label: 'Deal won notice',
            type: 'autolaunched',
            nodes: [
              { id: 'start', type: 'start', label: 'Start' },
              { id: 'tell', type: 'notify', label: 'Tell owner', config: { recipients: ['u1'], title: 'Deal won', [key]: value } },
              { id: 'done', type: 'end', label: 'Done' },
            ],
            edges: [{ id: 'e1', source: 'start', target: 'tell' }, { id: 'e2', source: 'tell', target: 'done' }],
          }],
        };
      }

      /** The two spellings a template refusal prescribes — "Write `'X'` or `{ dialect: 'template', source: 'X' }`". */
      function prescribedIn(refusal: string): unknown[] {
        const bare = /Write `'([^`']+)'`/.exec(refusal)?.[1];
        const envelope = /`\{ dialect: 'template', source: '([^`']+)' \}`/.exec(refusal)?.[1];
        return [bare, envelope === undefined ? undefined : { dialect: 'template', source: envelope }];
      }

      function doubleBraceFindings(key: 'title' | 'message' | 'actionUrl' | 'sourceId', value: unknown) {
        return lintFlowPatterns(notifyFlow(key, value)).filter((f) => f.rule === FLOW_DOUBLE_BRACE_INTERP);
      }

      it.each(['title', 'message'] as const)('`%s`: each prescribed spelling parses and draws no `flow-double-brace-interpolation`', (key) => {
        for (const refused of ['   ', 42]) {
          const parsed = NotifyConfigSchema.safeParse({ recipients: ['u1'], title: 'Deal won', [key]: refused });
          const refusal = parsed.success ? undefined : parsed.error.issues.find((i) => i.path[0] === key);
          expect(refusal?.code, `${key} = ${JSON.stringify(refused)}`).toBe('invalid_union');
          const prescribed = prescribedIn(refusal!.message);
          expect(prescribed.every((p) => p !== undefined), `no prescription read out of: ${refusal!.message}`).toBe(true);
          for (const spelling of prescribed) {
            const label = `${key} = ${JSON.stringify(spelling)}`;
            const flow = notifyFlow(key, spelling).flows[0];
            const config = NotifyConfigSchema.safeParse(flow.nodes[1]!.config);
            expect(config.success, `${label}: ${JSON.stringify(config.error?.issues)}`).toBe(true);
            const whole = FlowSchema.safeParse(flow);
            expect(whole.success, `${label}: ${JSON.stringify(whole.error?.issues)}`).toBe(true);
            expect(doubleBraceFindings(key, spelling), label).toEqual([]);
          }
        }
      });

      // [#19939] The control moved from `actionUrl`, a text slot since stage
      // S4 (a `{{ }}` hole is its spelling, so it draws no finding there now),
      // to `sourceId`, a value slot, where a doubled brace is no hole.
      it('control: the same prescribed hole draws the finding on the node\'s value slot `sourceId`, and none on its text slot `actionUrl`', () => {
        for (const sentence of [TYPED_EXPRESSION_SOURCE_REQUIRED.template, TYPED_EXPRESSION_DIALECT_ONLY.template]) {
          const prescribed = prescribedIn(sentence);
          expect(prescribed.every((p) => p !== undefined), sentence).toBe(true);
          const bare = prescribed[0] as string;
          expect(doubleBraceFindings('sourceId', bare), bare).toHaveLength(1);
          expect(doubleBraceFindings('actionUrl', `/deals/${bare}`), bare).toEqual([]);
          expect(doubleBraceFindings('title', bare), bare).toEqual([]);
        }
      });
    });
  });

  describe('flow-bare-dollar-reference', () => {
    it('flags a bare `$ref.field` in a top-level `http` node payload', () => {
      const fnds = lintFlowPatterns(httpFlow({ ticket: '$source.id' }))
        .filter((f) => f.rule === FLOW_BARE_DOLLAR_REF);
      expect(fnds).toHaveLength(1);
      expect(fnds[0].where).toBe("flow 'incident_push' · node 'push' (http)");
      expect(fnds[0].message).toContain('$source.id');
    });

    it('flags the same reference when the `http` node sits inside a region', () => {
      const fnds = lintFlowPatterns(guardedHttpFlow({ ticket: '$source.id' }))
        .filter((f) => f.rule === FLOW_BARE_DOLLAR_REF);
      expect(fnds).toHaveLength(1);
      expect(fnds[0].where).toBe("flow 'incident_push' · try_catch 'guard' try · node 'push' (http)");
    });

    // [#22110] A text slot reads `{{ }}` holes, where `$error.message` is a
    // hole's correct content; a bare one OUTSIDE a hole is still a literal.
    describe('in a text slot', () => {
      function notifyText(title: string) {
        return lintFlowPatterns({
          flows: [{
            name: 'fault_notice', label: 'Fault notice', type: 'autolaunched',
            nodes: [
              { id: 'start', type: 'start', label: 'Start' },
              { id: 'tell', type: 'notify', label: 'Tell', config: { recipients: ['u1'], title } },
            ],
            edges: [{ id: 'e1', source: 'start', target: 'tell' }],
          }],
        }).filter((f) => f.rule === FLOW_BARE_DOLLAR_REF || f.rule === FLOW_DOUBLE_BRACE_INTERP);
      }

      it('raises nothing for a `$`-named variable inside a hole', () => {
        expect(notifyText('Failed: {{ $error.message }}')).toEqual([]);
      });

      it('flags a bare `$ref.field` outside the holes, prescribing the hole', () => {
        const fnds = notifyText('Failed: $error.message ({{ record.name }})');
        expect(fnds.map((f) => f.rule)).toEqual([FLOW_BARE_DOLLAR_REF]);
        expect(fnds[0].message).toContain('notify title');
        expect(fnds[0].hint).toContain('{{ $error.message }}');
      });

      // [#22477] The hole a bare `$User.Id` would become is refused by the
      // spec's text-slot judge (the engine binds no `$User`), so the hint gives
      // the judge's own remedy — asked of the judge, not re-listed here.
      it('gives the judge\'s remedy, not a refused hole, for a bare `$User.Id`', () => {
        const fnds = notifyText('Closed by $User.Id');
        expect(fnds.map((f) => f.rule)).toEqual([FLOW_BARE_DOLLAR_REF]);
        const refusal = textSlotTemplateRefusal('{{ $User.Id }}');
        expect(refusal).toBeDefined();
        // [#22161] One line: the remedy every refusal of an unbound `$` root
        // ends with; the judge's run-user remedy is the `os explain` entry's.
        expect(fnds[0].hint).toBe(
          'A text slot renders only `{{ }}` holes. `$User.Id` has no hole: compute the value into a variable with an ' +
            '`assignment` node and write `{{ v }}`.',
        );
        expect(fnds[0].hint).not.toContain('{{ $User.Id }}');
        expect(explained(FLOW_BARE_DOLLAR_REF)).toContain("assignments: { v: { dialect: 'cel', source: 'current_user.id' } }");
      });

      it('control: a bare engine-bound `$error.message` keeps the hole prescription and no remedy', () => {
        const fnds = notifyText('Failed: $error.message');
        expect(fnds.map((f) => f.rule)).toEqual([FLOW_BARE_DOLLAR_REF]);
        expect(fnds[0].hint).toContain('`{{ $error.message }}`');
        expect(fnds[0].hint).not.toContain('assignments:');
      });

      it('answers each bare reference on its own when one slot carries both kinds', () => {
        const fnds = notifyText('Failed: $error.message, closed by $User.Id');
        expect(fnds).toHaveLength(1);
        expect(fnds[0].hint).toContain('`{{ $error.message }}`');
        expect(fnds[0].hint).toContain('`$User.Id` has no hole');
        expect(fnds[0].hint).not.toContain('{{ $User.Id }}');
      });
      // [#19939] What the hint prescribes in a text slot, put back in the
      // slot, is refused by no judge the slot has: the hole for an
      // engine-bound reference, and for the run user the judge's own remedy —
      // its id computed by an `assignment` node's CEL envelope, written as a hole.
      it('each spelling it prescribes passes the text-slot judge and the build door with 0 refusals', () => {
        const [errorRef] = notifyText('Failed: $error.message');
        const hole = /`(\{\{ [^`]* \}\})`/.exec(errorRef!.hint!)?.[1];
        expect(hole).toBe('{{ $error.message }}');
        const [userRef] = notifyText('Closed by $User.Id');
        // [#22161] The line names the hole `{{ v }}`; the run user's computation is the `os explain` entry's.
        expect(userRef!.hint).toContain('write `{{ v }}`');
        const computed = /assignments: \{ v: \{ dialect: 'cel', source: '([^']*)' \} \}/.exec(explained(FLOW_BARE_DOLLAR_REF))?.[1];
        expect(computed).toBe('current_user.id');
        const title = `Failed: ${hole}, closed by {{ v }}`;
        expect(textSlotTemplateRefusal(title)).toBeUndefined();
        const stack = {
          flows: [{
            name: 'fault_notice', label: 'Fault notice', type: 'autolaunched',
            nodes: [
              { id: 'start', type: 'start', label: 'Start' },
              { id: 'who', type: 'assignment', label: 'Who', config: { assignments: { v: CEL(computed!) } } },
              { id: 'tell', type: 'notify', label: 'Tell', config: { recipients: ['u1'], title } },
              { id: 'done', type: 'end', label: 'Done' },
            ],
            edges: [
              { id: 'e1', source: 'start', target: 'who' },
              { id: 'e2', source: 'who', target: 'tell' },
              { id: 'e3', source: 'tell', target: 'done' },
            ],
          }],
        };
        expect(validateStackExpressions(stack).filter((i) => i.severity === 'error')).toEqual([]);
        expect(lintFlowPatterns(stack).filter((f) => f.rule === FLOW_BARE_DOLLAR_REF || f.rule === FLOW_DOUBLE_BRACE_INTERP)).toEqual([]);
      });
    });

    // [#19939] A value slot (`create_record` / `update_record` `fields.*`,
    // `assignment` values) reads the CEL value envelope, and refuses every
    // `{…}` token but the date macros — `{$User.*}` since the second pass. So
    // the hint there names the envelope the spec's value-slot judge writes for
    // the token the reference names, asked of the judge and never re-spelled,
    // and each envelope it prescribes, put back in the slot, passes every
    // judge the slot has: the value-slot judge, the build door, the flow
    // contract and this rule.
    describe('in a value slot', () => {
      /** A start → write → end flow, the whole shape the build door judges. */
      function valueFlow(type: string, config: Record<string, unknown>) {
        return {
          flows: [{
            name: 'stamp_owner', label: 'Stamp owner', type: 'autolaunched',
            // The variables the prescriptions below read, bound as their hints
            // say they must be: the flow's own `source` (`$source`'s remedy) and
            // the `me` a `get_record` binds (`$User.Email`'s). The build door
            // refuses a root the flow does not bind (#22565), as the run does.
            variables: [{ name: 'source', type: 'object' }, { name: 'me', type: 'object' }],
            nodes: [
              { id: 'start', type: 'start', label: 'Start' },
              { id: 'write', type, label: 'Write', config },
              { id: 'done', type: 'end', label: 'Done' },
            ],
            edges: [{ id: 'e1', source: 'start', target: 'write' }, { id: 'e2', source: 'write', target: 'done' }],
          }],
        };
      }
      const bareDollar = (stack: ReturnType<typeof valueFlow>) =>
        lintFlowPatterns(stack).filter((f) => f.rule === FLOW_BARE_DOLLAR_REF);
      /** The value-slot judge's own CEL spelling of a `{…}` token — what the hint carries word for word. */
      const judgeSpelling = (token: string) =>
        valueSlotTemplateRefusals(token)[0]!.message.slice(VALUE_SLOT_TEMPLATE_REFUSAL.length).trim();
      /** [#22161] The judge's direct spelling of a token, `TOKEN as ENVELOPE` — what the one-line hint carries word for word. */
      const judgeDirect = (token: string) =>
        /^Write (`[^`]+`) as (\{ dialect: 'cel', source: (?:'[^']*'|"(?:[^"\\]|\\.)*") \})/.exec(judgeSpelling(token))!.slice(1).join(' as ');
      /** [#22161] The line where no envelope at the string's place would evaluate. */
      const NO_DIRECT_SPELLING =
        "A value slot stores a bare `$` reference as written: compute it in a CEL value envelope, `{ dialect: 'cel', " +
        "source: '…' }`, spelled as `os explain flow-bare-dollar-reference` says for this position.";
      /** Every concrete envelope source a hint prescribes; the `'…'` of its lead sentence is a placeholder. */
      function prescribedSources(hint: string): string[] {
        const out: string[] = [];
        for (const m of hint.matchAll(/\{ dialect: 'cel', source: (?:'([^']*)'|("(?:[^"\\]|\\.)*")) \}/g)) {
          const source = m[1] ?? (JSON.parse(m[2]!) as string);
          if (source !== '…') out.push(source);
        }
        return out;
      }
      /** The refusals of the slot's judges on `stack`'s write node. */
      function refusalsOf(stack: ReturnType<typeof valueFlow>) {
        const node = stack.flows[0]!.nodes[1]!;
        const parsed = FlowSchema.safeParse(stack.flows[0]);
        return {
          valueJudge: flowNodeValueTemplateRefusals(node.type, node.config).length,
          buildDoor: validateStackExpressions(stack).filter((i) => i.severity === 'error').length,
          contract: parsed.success ? 0 : parsed.error.issues.length,
          lint: lintFlowPatterns(stack).filter((f) => f.rule === FLOW_BARE_DOLLAR_REF || f.rule === FLOW_DOUBLE_BRACE_INTERP).length,
        };
      }
      const NONE = { valueJudge: 0, buildDoor: 0, contract: 0, lint: 0 };

      it('names the CEL envelope, not a `{…}` token the slot refuses (`fields: { owner: \'$User.Id\', who: \'$source.id\' }`)', () => {
        const fnds = bareDollar(valueFlow('create_record', { objectName: 'task', fields: { owner: '$User.Id', who: '$source.id' } }));
        expect(fnds).toHaveLength(2);
        for (const f of fnds) {
          expect(f.message).toContain('in the create_record field value');
          expect(f.hint).toMatch(/^A value slot stores a bare `\$` reference as written: write /);
          expect(f.hint).not.toContain('Wrap it and bind a variable');
        }
        const [owner, who] = fnds;
        // The run user: the judge's spelling of `{$User.Id}`, `current_user.id`. [#22161] The guard for a
        // flow that can run without a user is the `os explain` entry's.
        expect(owner!.hint).toContain(judgeDirect('{$User.Id}'));
        expect(prescribedSources(owner!.hint!)).toEqual(['current_user.id']);
        expect(explained(FLOW_BARE_DOLLAR_REF)).toContain('`current_user != null ? current_user.id : null`');
        // `$source` is no `$` variable the engine binds: the flow's own `source`, written without the `$`.
        expect(who!.hint).toContain(judgeDirect('{source.id}'));
        expect(prescribedSources(who!.hint!)).toEqual(['source.id']);
      });

      it('reads a `$` root the engine binds as that variable (`$error.message`)', () => {
        const [f] = bareDollar(valueFlow('update_record', { objectName: 'task', filter: { id: CEL('source.id') }, fields: { note: '$error.message' } }));
        expect(f!.message).toContain('in the update_record field value');
        expect(f!.hint).toContain(judgeDirect('{$error.message}'));
        expect(prescribedSources(f!.hint!)).toEqual(['vars["$error"].message']);
      });

      it.each([
        ['$User.Id', 'create_record', (v: unknown) => ({ objectName: 'task', fields: { v } })],
        ['$source.id', 'create_record', (v: unknown) => ({ objectName: 'task', fields: { v } })],
        // [#19939, stage S6] The filter operand is an envelope over a bound
        // variable: a `{record.id}` token there is refused since S6.
        ['$error.message', 'update_record', (v: unknown) => ({ objectName: 'task', filter: { id: CEL('source.id') }, fields: { v } })],
        ['$User.Id', 'assignment', (v: unknown) => ({ assignments: { v } })],
        // [#19939] The maps a node hands to a callee joined the value slots:
        // the hint flips there by asking the judge, with no line of its own.
        ['$source.id', 'subflow', (v: unknown) => ({ flowName: 'child_flow', input: { v } })],
        ['$User.Id', 'map', (v: unknown) => ({ flowName: 'child_flow', collection: { dialect: 'cel', source: 'rows' }, input: { v } })],
        ['$error.message', 'script', (v: unknown) => ({ function: 'score', inputs: { v } })],
      ] as const)('`%s` in the %s value slot: each envelope it prescribes passes every judge with 0 refusals', (ref, type, configOf) => {
        const fnds = bareDollar(valueFlow(type, configOf(ref)));
        expect(fnds).toHaveLength(1);
        const prescribed = prescribedSources(fnds[0]!.hint!);
        expect(prescribed.length, fnds[0]!.hint).toBeGreaterThan(0);
        for (const source of prescribed) {
          expect(refusalsOf(valueFlow(type, configOf(CEL(source)))), `${ref} → ${source}`).toEqual(NONE);
        }
      });

      // [#22161] A `$User` path other than the id never resolved, and the judge's remedy
      // opens with the user-record read, not a spelling: the line names no envelope, and
      // the `os explain` entry names the read.
      it('`$User.Email`: the line names no envelope, and the explanation names the user-record read', () => {
        const fnds = bareDollar(valueFlow('create_record', { objectName: 'task', fields: { v: '$User.Email' } }));
        expect(fnds.map((f) => f.hint)).toEqual([NO_DIRECT_SPELLING]);
        expect(prescribedSources(fnds[0]!.hint!)).toEqual([]);
        expect(explained(FLOW_BARE_DOLLAR_REF)).toContain("a `get_record` node (`objectName: 'sys_user'`)");
      });

      // [#19939] `subflow.input`, `map.input` and `script.inputs` are value
      // slots now. Before, the hint there named `{source.id}` — the single
      // brace the interpolator resolved — and that spelling is refused there
      // now; the hint names the envelope, with the callee sentence the judge
      // gives at that position.
      it.each([
        ['subflow', 'subflow input value', { flowName: 'child_flow', input: { who: '$source.id' } }, "the child flow's input variable `who`"],
        ['map', 'map item input value', { flowName: 'child_flow', collection: { dialect: 'cel', source: 'rows' }, input: { who: '$source.id' } }, "each item's child flow's input variable `who`"],
        ['script', 'script input value', { function: 'score', inputs: { who: '$source.id' } }, "the function's `input.who`"],
      ] as const)('%s: names the CEL envelope and what the callee is handed, not `{source.id}`', (type, label, config, callee) => {
        const [f] = bareDollar(valueFlow(type, config));
        expect(f!.message).toContain(`in the ${label}`);
        expect(f!.hint).toMatch(/^A value slot stores a bare `\$` reference as written: write /);
        expect(f!.hint).not.toContain('Wrap it and bind a variable');
        expect(prescribedSources(f!.hint!)).toEqual(['source.id']);
        // [#22161] What the callee is handed left the line; the entry names the guarded form's `null`.
        expect(f!.hint).not.toContain(callee);
        expect(explained(FLOW_BARE_DOLLAR_REF)).toContain('hands) `null`');
        expect(refusalsOf(valueFlow(type, { ...config, [type === 'script' ? 'inputs' : 'input']: { who: '{source.id}' } })).valueJudge)
          .toBe(1);
      });

      // [#19939, stage S2] A screen's prefill and record id joined the value
      // slots: the hint flips there by asking the judge — no line of its own —
      // with the sentence the judge gives at that position.
      it.each([
        ['defaults', 'screen form default', (v: unknown) => ({ objectName: 'task', defaults: { who: v } }), 'prefills the object form\'s `who` field'],
        ['field defaultValue', 'screen field default value', (v: unknown) => ({ fields: [{ name: 'who', type: 'text', defaultValue: v }] }), 'prefills this screen field'],
        ['recordId', 'screen record id', (v: unknown) => ({ objectName: 'task', mode: 'edit', recordId: v }), 'names the record an `edit` form opens'],
      ] as const)('screen %s: names the CEL envelope and what the client is served, not `{source.id}`', (_what, label, configOf, sentence) => {
        const [f] = bareDollar(valueFlow('screen', configOf('$source.id')));
        expect(f!.message).toContain(`in the ${label}`);
        expect(f!.hint).toMatch(/^A value slot stores a bare `\$` reference as written: write /);
        expect(f!.hint).not.toContain('Wrap it and bind a variable');
        expect(prescribedSources(f!.hint!)).toEqual(['source.id']);
        // [#22161] What the client is served left the line.
        expect(f!.hint).not.toContain(sentence);
        expect(refusalsOf(valueFlow('screen', configOf('{source.id}'))).valueJudge).toBe(1);
        expect(refusalsOf(valueFlow('screen', configOf(CEL('source.id'))))).toEqual(NONE);
      });

      it('control: both spellings the hint used to prescribe are refused in the same slot', () => {
        for (const old of ['{source.id}', '{$User.Id}']) {
          expect(refusalsOf(valueFlow('create_record', { objectName: 'task', fields: { v: old } })).valueJudge, old).toBe(1);
        }
      });

      // #19939 pass 3: the hint asks the judge AT the string's position, so
      // where an envelope is literal data — a string nested in an object
      // literal, a legacy `assignment` shape — it names the spelling that
      // evaluates there, never an envelope at the position.
      it('a reference nested in an object literal: the whole value built as one CEL literal, not an envelope at the position', () => {
        const [f] = bareDollar(valueFlow('create_record', { objectName: 'task', fields: { payload: { who: '$source.id' } } }));
        // [#22161] An envelope at the string's place would not evaluate, so the line names none; the
        // whole-value literal is the `os explain` entry's.
        expect(f!.hint).toBe(NO_DIRECT_SPELLING);
        expect(prescribedSources(f!.hint!)).toEqual([]);
        expect(explained(FLOW_BARE_DOLLAR_REF)).toContain('A string inside an object or list literal is stored as the object it spells');
        expect(refusalsOf(valueFlow('create_record', { objectName: 'task', fields: { payload: CEL("{'who': source.id}") } })))
          .toEqual(NONE);
      });

      it('a reference in the legacy `assignments` array: the canonical map, where the envelope evaluates', () => {
        const [f] = bareDollar(valueFlow('assignment', { assignments: [{ variable: 'v', value: '$User.Id' }] }));
        // [#22161] An envelope in the legacy shape evaluates nothing, so the line names none; the move
        // to the canonical map is the `os explain` entry's.
        expect(f!.hint).toBe(NO_DIRECT_SPELLING);
        expect(prescribedSources(f!.hint!)).toEqual([]);
        expect(explained(FLOW_BARE_DOLLAR_REF)).toContain('move the assignments into the canonical `assignments: { … }` map');
        for (const source of ['current_user.id', 'current_user != null ? current_user.id : null']) {
          expect(refusalsOf(valueFlow('assignment', { assignments: { v: CEL(source) } })), source).toEqual(NONE);
        }
      });

      // #19939 pass 3: the `has()` guard the hint carries for "one that may be
      // absent" must hold where the VARIABLE is absent too: `has(source.id)`
      // fails the run when `source` was never bound (an `isInput` variable the
      // caller left out). The judge's guard tests each step off `vars`, and
      // the hint carries the judge's words — that the guard answers `null`
      // there is pinned through the engine in `service-automation`'s
      // `value-slot-template-grammar.test.ts`.
      it('the `has()` guard it carries tests each step off `vars`, and passes every judge as an envelope', () => {
        const [f] = bareDollar(valueFlow('create_record', { objectName: 'task', fields: { who: '$source.id' } }));
        const guard = 'has(vars.source) && has(vars.source.id) ? vars.source.id : null';
        // [#22161] The guard left the line; the `os explain` entry states its shape.
        expect(f!.hint).not.toContain('has(');
        expect(explained(FLOW_BARE_DOLLAR_REF)).toContain('`has(vars.a) && has(vars.a.b) ? vars.a.b : null`');
        expect(refusalsOf(valueFlow('create_record', { objectName: 'task', fields: { who: CEL(guard) } }))).toEqual(NONE);
      });

      // [#19939, stage S6] RE-JUDGED IN PLACE: the control's position was a
      // CRUD `filter` value — "the position S6 has not reached". Each filter
      // operand is a value slot since S6, so the hint there names the operand's
      // envelope and the filter operand's remedy. [#19939 S7] At a position no
      // slot judges (a plugin node's own config) nothing resolves a reference
      // since the single-brace interpolator is deleted, so the hint says the
      // value is read as written and offers no `{var}` token.
      it('control: a filter operand names its envelope now; outside every slot the hint says the value is read as written', () => {
        const filtered = (owner: string) => valueFlow('get_record', { objectName: 'task', filter: { owner } });
        const [f] = bareDollar(filtered('$source.id'));
        expect(f!.message).toContain('in the get_record filter operand');
        expect(f!.hint).toMatch(/^A value slot stores a bare `\$` reference as written: write /);
        expect(explained(FLOW_BARE_DOLLAR_REF)).toContain('A filter operand envelope is evaluated before the query');
        expect(prescribedSources(f!.hint!)).toEqual(['source.id']);
        expect(refusalsOf(valueFlow('get_record', { objectName: 'task', filter: { owner: CEL('source.id') } }))).toEqual(NONE);
        expect(flowNodeValueTemplateRefusals('get_record', { objectName: 'task', filter: { owner: '{source.id}' } })).toHaveLength(1);
        const [plugin] = bareDollar(valueFlow('acme_custom_step', { note: '$source.id' }));
        expect(plugin!.message).toContain('this flow node value is read as written');
        expect(plugin!.hint).toContain('neither `{var}` nor `{{ }}` resolves here');
        expect(plugin!.hint).not.toContain('`{source.id}`');
        // …and the http body names its envelope.
        const [body] = lintFlowPatterns(httpFlow({ ticket: '$source.id' })).filter((x) => x.rule === FLOW_BARE_DOLLAR_REF);
        expect(body!.hint).toMatch(/^A value slot stores a bare `\$` reference as written/);
      });
    });

    // #19939 pass 3 (carry from pass 2): `flow-double-brace-interpolation`'s
    // hint said `Use {var} (e.g. {record.title})` in a value slot too — a
    // spelling the value-slot judge refuses there. In a value slot it now names
    // the CEL envelope the judge writes for the string with each `{{ }}` hole
    // read as the token it means, asked at the string's position. (Elsewhere,
    // since #19939 S7, the hint says the value is read as written.)
    describe('a double brace in a value slot', () => {
      // [#22677] The prescriptions read `record.title`, so the flow is handed a
      // record (a record trigger on a declared `task`): with no entrance the
      // build door refuses `record` itself, whatever the slot's spelling.
      function valueFlow(type: string, config: Record<string, unknown>) {
        return {
          objects: [{ name: 'task', fields: { title: { type: 'text' }, subject: { type: 'text' } } }],
          flows: [{
            name: 'stamp_title', label: 'Stamp title', type: 'record_change',
            nodes: [
              { id: 'start', type: 'start', label: 'Start', config: { objectName: 'task', triggerType: 'record-after-update' } },
              { id: 'write', type, label: 'Write', config },
              { id: 'done', type: 'end', label: 'Done' },
            ],
            edges: [{ id: 'e1', source: 'start', target: 'write' }, { id: 'e2', source: 'write', target: 'done' }],
          }],
        };
      }
      const doubleBrace = (stack: ReturnType<typeof valueFlow>) =>
        lintFlowPatterns(stack).filter((f) => f.rule === FLOW_DOUBLE_BRACE_INTERP);
      function prescribedSources(hint: string): string[] {
        const out: string[] = [];
        for (const m of hint.matchAll(/\{ dialect: 'cel', source: (?:'([^']*)'|("(?:[^"\\]|\\.)*")) \}/g)) {
          const source = m[1] ?? (JSON.parse(m[2]!) as string);
          if (source !== '…') out.push(source);
        }
        return out;
      }
      function refusalsOf(stack: ReturnType<typeof valueFlow>) {
        const node = stack.flows[0]!.nodes[1]!;
        const parsed = FlowSchema.safeParse(stack.flows[0]);
        return {
          valueJudge: flowNodeValueTemplateRefusals(node.type, node.config).length,
          buildDoor: validateStackExpressions(stack).filter((i) => i.severity === 'error').length,
          contract: parsed.success ? 0 : parsed.error.issues.length,
          lint: lintFlowPatterns(stack).filter((f) => f.rule === FLOW_BARE_DOLLAR_REF || f.rule === FLOW_DOUBLE_BRACE_INTERP).length,
        };
      }
      const NONE = { valueJudge: 0, buildDoor: 0, contract: 0, lint: 0 };

      it.each([
        ['a whole hole', '{{ record.title }}', 'record.title'],
        ['text with a hole', 'Re: {{ record.title }}', "'Re: ' + record.title"],
      ])('%s: names the envelope for the hole it means, not `{record.title}`', (_label, text, source) => {
        const [f] = doubleBrace(valueFlow('create_record', { objectName: 'task', fields: { subject: text } }));
        expect(f!.message).toContain('the create_record field value reads a CEL value envelope, not a template');
        expect(f!.hint).not.toContain('Use `{var}`');
        // [#22161] One line, the judge's spelling; the outer-brace reading is the `os explain` entry's.
        expect(f!.hint).toMatch(/^A value slot reads no `\{\{ \}\}` template: write /);
        expect(explained(FLOW_DOUBLE_BRACE_INTERP)).toContain('the value-slot refusal reads a `{{ }}` string\'s outer braces as literal text');
        expect(prescribedSources(f!.hint!)).toEqual([source]);
        expect(refusalsOf(valueFlow('create_record', { objectName: 'task', fields: { subject: CEL(source) } }))).toEqual(NONE);
      });

      it('control: the spelling it used to prescribe is refused in the same slot', () => {
        expect(refusalsOf(valueFlow('create_record', { objectName: 'task', fields: { subject: '{record.title}' } })).valueJudge).toBe(1);
      });

      it('in an assignment value nested in a literal: the whole value as a CEL literal', () => {
        const [f] = doubleBrace(valueFlow('assignment', { assignments: { o: { t: '{{ record.title }}' } } }));
        expect(f!.message).toContain('the assignment value reads a CEL value envelope');
        // [#22161] An envelope at the string's place would not evaluate, so the line names none and points
        // at the build's value-slot refusal, which carries the whole-value literal.
        expect(prescribedSources(f!.hint!)).toEqual([]);
        expect(f!.hint).toContain('`os explain flow-double-brace-interpolation`');
        expect(explained(FLOW_DOUBLE_BRACE_INTERP)).toContain('each `{{ x }}` hole is the CEL path `x`');
        // Control: why the line does not point at the build's refusal — it reads the outer braces as
        // literal text, so its spelling keeps them rather than the hole the author meant.
        const refusal = flowNodeValueTemplateRefusals('assignment', { assignments: { o: { t: '{{ record.title }}' } } });
        expect(refusal.map((r) => r.message).join(' ')).toContain("'{' + record.title + '}'");
      });

      // [#19939] A callee's input map is a value slot now: the hint names the
      // envelope there too, by asking the judge — no line of its own.
      it.each([
        ['subflow', 'subflow input value', (v: unknown) => ({ flowName: 'child_flow', input: { subject: v } })],
        ['map', 'map item input value', (v: unknown) => ({ flowName: 'child_flow', collection: { dialect: 'cel', source: 'rows' }, input: { subject: v } })],
        ['script', 'script input value', (v: unknown) => ({ function: 'score', inputs: { subject: v } })],
      ] as const)('in a %s input: names the envelope for the hole it means', (type, label, configOf) => {
        const [f] = doubleBrace(valueFlow(type, configOf('Re: {{ record.title }}')));
        expect(f!.message).toContain(`the ${label} reads a CEL value envelope, not a template`);
        expect(f!.hint).not.toContain('Use `{var}`');
        expect(prescribedSources(f!.hint!)).toEqual(["'Re: ' + record.title"]);
        expect(refusalsOf(valueFlow(type, configOf(CEL("'Re: ' + record.title"))))).toEqual(NONE);
      });

      // [#19939, stage S2] …and at a screen's value slots.
      it.each([
        ['defaults', 'screen form default', (v: unknown) => ({ objectName: 'task', defaults: { subject: v } })],
        ['field defaultValue', 'screen field default value', (v: unknown) => ({ fields: [{ name: 'subject', type: 'text', defaultValue: v }] })],
        ['recordId', 'screen record id', (v: unknown) => ({ objectName: 'task', mode: 'edit', recordId: v })],
      ] as const)('in a screen %s: names the envelope for the hole it means', (_what, label, configOf) => {
        const [f] = doubleBrace(valueFlow('screen', configOf('Re: {{ record.title }}')));
        expect(f!.message).toContain(`the ${label} reads a CEL value envelope, not a template`);
        expect(f!.hint).not.toContain('Use `{var}`');
        expect(prescribedSources(f!.hint!)).toEqual(["'Re: ' + record.title"]);
        expect(refusalsOf(valueFlow('screen', configOf(CEL("'Re: ' + record.title"))))).toEqual(NONE);
      });

      // [#19939, stage S6] RE-JUDGED IN PLACE, as the bare-`$` control above:
      // a CRUD `filter` operand is a value slot since S6.
      it('control: a filter operand names its envelope now; outside every slot the double-brace hint says the value is read as written', () => {
        const [f] = doubleBrace(valueFlow('get_record', { objectName: 'task', filter: { title: '{{ record.title }}' } }));
        expect(f!.message).toContain('the get_record filter operand reads a CEL value envelope, not a template');
        expect(f!.hint).not.toContain('Use `{var}`');
        expect(prescribedSources(f!.hint!)).toEqual(['record.title']);
        const [plugin] = doubleBrace(valueFlow('acme_custom_step', { note: '{{ record.title }}' }));
        expect(plugin!.message).toContain('nothing renders a template here');
        expect(plugin!.hint).toContain('neither `{var}` nor `{{ }}` resolves here');
        expect(plugin!.hint).not.toContain('Use `{var}`');
        // …and the http body, a value slot since S5, names its envelope.
        const [body] = lintFlowPatterns(httpFlow({ title: '{{ record.title }}' })).filter((x) => x.rule === FLOW_DOUBLE_BRACE_INTERP);
        expect(body!.hint).not.toContain('Use `{var}`');
      });
    });
  });

  it('raises neither finding for a single-brace token in a payload — the body\'s own judge refuses that one', () => {
    const fnds = lintFlowPatterns(httpFlow({ id: '{record.id}', owner: '{$User.Id}', note: 'Total $5' }))
      .filter((f) => f.rule === FLOW_DOUBLE_BRACE_INTERP || f.rule === FLOW_BARE_DOLLAR_REF);
    expect(fnds).toEqual([]);
    // [#19939] Since the body became a value slot, the value-slot judge refuses each token at its string.
    expect(flowNodeValueTemplateRefusals('http', httpPushConfig({ id: '{record.id}', owner: '{$User.Id}', note: 'Total $5' })).map((r) => r.path))
      .toEqual(['body.id', 'body.owner']);
  });

  /**
   * The over-correction guard, and the reason the second argument must be the
   * node's OWN slots rather than nothing at all: a `loop`'s config physically
   * CONTAINS its body, so a repair that stopped stripping would report this
   * payload token twice — once on the `http` node that carries it, once on the
   * `loop` that merely wraps it.
   */
  it('reports a payload token inside a `loop` body ONCE, on the node carrying it', () => {
    const fnds = lintFlowPatterns(loopBodyFlow({
      nodes: [{
        id: 'push', type: 'http', label: 'POST incident',
        config: httpPushConfig({ text: 'Lead {{lead.name}}' }),
      }],
      edges: [],
    // Scoped to this rule: an `http` node in a bare loop body also trips the
    // #14394 containment warning, a different finding about a different defect.
    })).filter((f) => f.rule === FLOW_DOUBLE_BRACE_INTERP);
    expect(fnds).toHaveLength(1);
    expect(fnds[0].where).toBe(
      "flow 'campaign_enrollment' · loop 'loop_leads' body · node 'push' (http)",
    );
    expect(fnds[0].where).not.toContain("node 'loop_leads'");
  });

  /**
   * `try` / `catch` / `branches` — the rest of the flat union — for the same
   * reason, on a node type that does not own them. No node type in the protocol
   * declares these as ordinary config today (only `try_catch` and `parallel`
   * own them, as regions), but `FlowNodeSchema.config` is an open `z.record`, so
   * an authored key by any of those names on any other node type is metadata a
   * rule must still read rather than silently delete.
   */
  it('reads a `try` / `catch` / `branches` key authored on a node that owns no region', () => {
    const fnds = lintFlowPatterns(nodeFlow({
      objectName: 'm',
      fields: { try: '{{a}}', catch: '{{b}}', branches: '{{c}}' },
    })).filter((f) => f.rule === FLOW_DOUBLE_BRACE_INTERP);
    expect(fnds).toHaveLength(3);
    // Top level too, not only nested under a declared key.
    const top = lintFlowPatterns(nodeFlow({ objectName: 'm', try: '{{a}}', catch: '{{b}}', branches: '{{c}}' }))
      .filter((f) => f.rule === FLOW_DOUBLE_BRACE_INTERP);
    expect(top).toHaveLength(3);
  });
});

/**
 * #16910 — a non-record member of a flow's `edges` list must not throw, and the
 * VALID edge beside it must still be judged.
 *
 * ## Why both halves are asserted, and why the second one is the real one
 *
 * A linter that throws instead of reporting takes the whole gate down on
 * malformed input — and malformed input is exactly what a linter exists to
 * catch, so the tool failed hardest on the documents it is most needed for and
 * the author got a stack trace where a diagnostic belongs. That is the defect.
 * But "no longer throws" is half a contract: a guard that abandoned the whole
 * edge list would satisfy it and would have traded the crash for silence, which
 * is strictly worse than the crash because nothing reports it. So every case
 * below pins the surviving finding by IDENTITY — rule id and `where` — against
 * a control holding the same flow without the junk member, never by "did not
 * throw" alone.
 *
 * ## The semantics, and why it matches #16751
 *
 * The junk member is DROPPED, silently, by `recordsOf`'s `isRec` filter — the
 * same coercion and the same one home (`object-graph.ts`) #16751 chose for the
 * seven flow-NODE-list readers, so the two sibling lists on the same flow
 * member cannot disagree about what a malformed member means. Dropping is not
 * reporting: a rule that INVENTED a finding about an entry no author wrote is
 * the phantom half of this same defect class, which is why the control
 * comparison below is an equality and not a `toBeGreaterThan`.
 *
 * ## Both addressing depths
 *
 * The flow's own list and a nested region's list are separate readers reached by
 * separate routes — the second arrives through `collectFlowGraphs`, out of a
 * container's open `z.record` config, behind nothing but `Array.isArray`, so no
 * coercion at the call site can reach it. The top-level repair alone left it
 * throwing; measured, not assumed.
 */
describe('a non-record member of a flow `edges` list (#16910)', () => {
  /** Labelled like an error path, left at the default type: the #3863 shape. */
  const VALID_EDGE = { source: 'act', target: 'done', label: 'error' };
  const ENDPOINTS = [
    { id: 'start', type: 'start', config: {} },
    { id: 'act', type: 'create_record', config: {} },
    { id: 'done', type: 'end', config: {} },
  ];

  /** The four shapes a raw `edges` list can hold that are not a record. */
  const JUNK: readonly (readonly [string, unknown])[] = [
    ['null', null],
    ['undefined', undefined],
    ['a string', 'x'],
    ['a number', 42],
  ];

  const topLevel = (edges: readonly unknown[]) => ({
    objects: [{ name: 'crm_account', fields: [{ name: 'name', type: 'text' }] }],
    flows: [{ name: 'crm_flow', nodes: ENDPOINTS, edges }],
  });

  const nestedRegion = (edges: readonly unknown[]) => ({
    objects: [{ name: 'crm_account', fields: [{ name: 'name', type: 'text' }] }],
    flows: [{
      name: 'crm_flow',
      nodes: [
        { id: 'start', type: 'start', config: {} },
        { id: 'lp', type: 'loop', config: { collection: { dialect: 'cel', source: 'x' }, body: { nodes: ENDPOINTS, edges } } },
      ],
      edges: [],
    }],
  });

  const errorLabelFindings = (stack: unknown) =>
    lintFlowPatterns(stack as Record<string, unknown>)
      .filter((f) => f.rule === FLOW_ERROR_LABEL_NOT_FAULT);

  describe.each([
    ["the flow's own list", topLevel, "flow 'crm_flow' · edge 'act' → 'done'"],
    ["a nested region's list", nestedRegion, "flow 'crm_flow' · loop 'lp' body · edge 'act' → 'done'"],
  ])('%s', (_label, build, expectedWhere) => {
    it('judges the valid edge with no junk member beside it (the control)', () => {
      const fnds = errorLabelFindings(build([VALID_EDGE]));
      expect(fnds).toHaveLength(1);
      expect(fnds[0].where).toBe(expectedWhere);
    });

    it.each(JUNK)('drops %s and still judges the valid edge beside it', (_shape, junk) => {
      // Half one: the rule returns rather than throwing. `lintFlowPatterns` is
      // typed `(stack) => FlowLintFinding[]` and its docblock promises it never
      // throws; before this repair a `null` here broke that promise outright.
      expect(() => lintFlowPatterns(build([junk, VALID_EDGE]) as Record<string, unknown>)).not.toThrow();

      // Half two — the one that matters: the surviving edge is still JUDGED,
      // by identity against the control, so a guard that abandoned the list
      // reds here instead of passing half the assertion.
      const fnds = errorLabelFindings(build([junk, VALID_EDGE]));
      expect(fnds).toHaveLength(1);
      expect(fnds[0].where).toBe(expectedWhere);
    });

    it.each(JUNK)('invents no finding about %s, which no author wrote', (_shape, junk) => {
      // The phantom half of the same defect class: dropping a member must be
      // invisible to the rule table in BOTH directions, so this is an equality
      // against the control and not a lower bound.
      expect(lintFlowPatterns(build([junk, VALID_EDGE]) as Record<string, unknown>))
        .toEqual(lintFlowPatterns(build([VALID_EDGE]) as Record<string, unknown>));
    });
  });

  /**
   * The whole gate, not one rule: `os validate` runs the rule TABLE, so a single
   * throwing reader takes every other rule's verdict down with it. Measured on
   * this input, `validateStackExpressions` threw from its own `graph.edges`
   * reader after `lintFlowPatterns` stopped — the same defect one file over,
   * repaired in the same change for the same reason.
   */
  it.each(JUNK)('takes no rule in the authoring table down with %s', (_shape, junk) => {
    for (const rule of AUTHORING_RULES) {
      expect(() => rule.run(topLevel([junk, VALID_EDGE]) as Record<string, unknown>, {}), rule.name).not.toThrow();
      expect(() => rule.run(nestedRegion([junk, VALID_EDGE]) as Record<string, unknown>, {}), rule.name).not.toThrow();
    }
  });
});

/**
 * #15429 — the decision's `mode`, at the `os validate` door.
 *
 * Two rules, two severities. `flow-decision-mode-invalid` GATES: the finding is
 * the spec's own `DecisionConfigSchema` issue message, and `registerFlow`
 * refuses the same declaration with the same sentence, so the flow can never
 * arm. `flow-decision-inclusive-overlap` (ruling item 4) is advisory: an
 * inclusive gateway with two or more conditioned out-edges is legal, and the
 * rule says what it does rather than proving the conditions overlap.
 */
describe('decision `mode` (#15429)', () => {
  /** One edge-branched decision with two conditioned out-edges, plus whatever config the case declares. */
  const modeFlow = (config: Record<string, unknown> | undefined, edges?: Record<string, unknown>[]) => ({
    flows: [{
      name: 'verdict',
      nodes: [
        { id: 'start', type: 'start', config: {} },
        { id: 'check', type: 'decision', ...(config ? { config } : {}) },
        { id: 'refuse', type: 'screen', config: {} },
        { id: 'convert', type: 'screen', config: {} },
      ],
      edges: edges ?? [
        { id: 'e1', source: 'start', target: 'check' },
        { id: 'e2', source: 'check', target: 'refuse', condition: "lead.status != 'suspected'" },
        { id: 'e3', source: 'check', target: 'convert', condition: "lead.status == 'confirmed'" },
      ],
    }],
  });
  const ofRule = (stack: unknown, rule: string) => lintFlowPatterns(stack as AnyRec).filter((f) => f.rule === rule);
  type AnyRec = Record<string, unknown>;

  /** The same decision inside a loop body — the region walk must reach it. */
  const nestedModeFlow = (config: Record<string, unknown>) => ({
    flows: [{
      name: 'sweep',
      runAs: 'system',
      nodes: [
        { id: 'start', type: 'start', config: { triggerType: 'schedule', schedule: 'cron:0 9 * * *' } },
        {
          id: 'each', type: 'loop', label: 'Each',
          config: {
            collection: { dialect: 'cel', source: 'vars.rows' },
            iteratorVariable: 'row',
            body: {
              nodes: [
                { id: 'check', type: 'decision', config },
                { id: 'refuse', type: 'screen', config: {} },
                { id: 'convert', type: 'screen', config: {} },
              ],
              edges: [
                { id: 'e2', source: 'check', target: 'refuse', condition: "row.status != 'suspected'" },
                { id: 'e3', source: 'check', target: 'convert', condition: "row.status == 'confirmed'" },
              ],
            },
          },
        },
      ],
      edges: [{ id: 'e1', source: 'start', target: 'each' }],
    }],
  });

  describe('flow-decision-mode-invalid — gating, with the schema sentence', () => {
    it('gates `mode` beside a non-empty `conditions` list, either member, at config.mode', () => {
      for (const mode of ['inclusive', 'exclusive']) {
        const fnds = ofRule(modeFlow({ mode, conditions: [{ label: 'Refuse', expression: "lead.status != 'suspected'" }] }), FLOW_DECISION_MODE_INVALID);
        expect(fnds).toHaveLength(1);
        expect(fnds[0].severity).toBe('error');
        expect(fnds[0].where).toBe("flow 'verdict' · decision 'check' · config.mode");
        expect(fnds[0].message).toContain(`\`mode: '${mode}'\` is not valid on a decision that declares a \`conditions\` list`);
        expect(fnds[0].message).toContain('Either delete `mode` and keep the list');
        // [#22161] Why it gates moved to `os explain`; the line is the remedy.
        expect(explained(FLOW_DECISION_MODE_INVALID)).toContain('`registerFlow` refuses this flow with the same sentence');
        expect(fnds[0].hint).toContain("set `mode: 'inclusive'`");
        expect(fnds[0].hint).not.toContain('registerFlow');
      }
    });

    it('gates a `mode` outside the closed pair with the value prescription', () => {
      const fnds = ofRule(modeFlow({ mode: 'all' }), FLOW_DECISION_MODE_INVALID);
      expect(fnds).toHaveLength(1);
      expect(fnds[0].severity).toBe('error');
      expect(fnds[0].message).toContain("`mode: 'all'` is not a decision mode");
      expect(fnds[0].message).toContain("'exclusive' declares that only the FIRST out-edge");
    });

    it('CONTROLS — an omitted `mode`, `mode` alone, `mode` on an empty list, and a list without `mode` are clean', () => {
      for (const config of [undefined, { mode: 'inclusive' }, { mode: 'exclusive' }, { mode: 'inclusive', conditions: [] }]) {
        expect(ofRule(modeFlow(config), FLOW_DECISION_MODE_INVALID)).toHaveLength(0);
      }
      expect(ofRule(modeFlow(
        { conditions: [{ label: 'Refuse', expression: "lead.status != 'suspected'" }] },
        [
          { id: 'e1', source: 'start', target: 'check' },
          { id: 'e2', source: 'check', target: 'refuse', label: 'Refuse' },
          { id: 'e3', source: 'check', target: 'convert', isDefault: true },
        ],
      ), FLOW_DECISION_MODE_INVALID)).toHaveLength(0);
    });

    it('reaches a decision inside a loop body and names the region', () => {
      const fnds = ofRule(nestedModeFlow({ mode: 'parallel' }), FLOW_DECISION_MODE_INVALID);
      expect(fnds).toHaveLength(1);
      expect(fnds[0].where).toContain("loop 'each'");
      expect(fnds[0].where).toContain("decision 'check' · config.mode");
    });
  });

  describe('flow-decision-inclusive-overlap — advisory (ruling item 4)', () => {
    it("advises an inclusive decision with two conditioned out-edges, naming them and what the mode does", () => {
      const fnds = ofRule(modeFlow({ mode: 'inclusive' }), FLOW_DECISION_INCLUSIVE_OVERLAP);
      expect(fnds).toHaveLength(1);
      // Advisory: the declaration is legal and the rule cannot prove overlap.
      expect(fnds[0].severity).toBeUndefined();
      expect(fnds[0].where).toBe("flow 'verdict' · decision 'check'");
      expect(fnds[0].message).toContain('2 conditioned out-edge(s)');
      expect(fnds[0].message).toContain("'refuse', 'convert'");
      expect(fnds[0].message).toContain('EVERY one whose condition holds runs');
      expect(fnds[0].hint).toContain('delete `mode`');
      // [#22161] Where the migration left the key moved to `os explain`.
      expect(explained(FLOW_DECISION_INCLUSIVE_OVERLAP)).toContain('authored against protocol major 17 and converted by `os migrate meta`');
      expect(fnds[0].hint).not.toContain('os migrate meta');
    });

    it('does NOT advise an exclusive decision — omitted or written — with the same two edges', () => {
      expect(ofRule(modeFlow(undefined), FLOW_DECISION_INCLUSIVE_OVERLAP)).toHaveLength(0);
      expect(ofRule(modeFlow({ mode: 'exclusive' }), FLOW_DECISION_INCLUSIVE_OVERLAP)).toHaveLength(0);
    });

    it('does NOT advise one conditioned out-edge plus a default: inclusive and exclusive cannot differ there', () => {
      const stack = modeFlow({ mode: 'inclusive' }, [
        { id: 'e1', source: 'start', target: 'check' },
        { id: 'e2', source: 'check', target: 'refuse', condition: "lead.status == 'suspected'" },
        { id: 'e3', source: 'check', target: 'convert', isDefault: true },
      ]);
      expect(ofRule(stack, FLOW_DECISION_INCLUSIVE_OVERLAP)).toHaveLength(0);
    });

    it('does not double-report through flow-decision-unconditional-branch — both edges are gated', () => {
      expect(ofRule(modeFlow({ mode: 'inclusive' }), FLOW_DECISION_UNCONDITIONAL_BRANCH)).toHaveLength(0);
    });

    it('reaches a decision inside a loop body', () => {
      const fnds = ofRule(nestedModeFlow({ mode: 'inclusive' }), FLOW_DECISION_INCLUSIVE_OVERLAP);
      expect(fnds).toHaveLength(1);
      expect(fnds[0].where).toContain("loop 'each'");
    });
  });
});

/**
 * [#19939, stage S4] A notify node's `sourceObject`, `actorId` and `payload`
 * are literals the executor reads as written: no flow computed one, so no
 * value slot is built there, and the contract refuses a `{…}` token in one.
 * Neither brace dialect resolves there, so the two wrong-syntax hints name the
 * value itself — never `{var}`, which the build would refuse there.
 */
describe('the notify literals: neither brace dialect resolves, and the hints say so (#19939)', () => {
  function notifyFlow(config: Record<string, unknown>) {
    return {
      flows: [{
        name: 'literal_notice',
        label: 'Literal notice',
        type: 'autolaunched',
        nodes: [
          { id: 'start', type: 'start', label: 'Start' },
          { id: 'tell', type: 'notify', label: 'Tell', config: { recipients: ['u1'], title: 'T', ...config } },
          { id: 'done', type: 'end', label: 'Done' },
        ],
        edges: [{ id: 'e1', source: 'start', target: 'tell' }, { id: 'e2', source: 'tell', target: 'done' }],
      }],
    };
  }
  const findingsOf = (config: Record<string, unknown>, rule: string) =>
    lintFlowPatterns(notifyFlow(config)).filter((f) => f.rule === rule);

  /** The keys the spec contract refuses a `{…}` token at with the literal's lead — asked of the contract, never listed. */
  function contractLiteralKeys(): string[] {
    const shape = (NotifyConfigSchema as unknown as { shape: Record<string, unknown> }).shape;
    return Object.keys(shape).filter((key) => {
      const value = key === 'payload' ? { k: '{x}' } : '{x}';
      const parsed = NotifyConfigSchema.safeParse({ recipients: ['u1'], title: 'T', [key]: value });
      return !parsed.success
        && parsed.error.issues.some((i) => i.path[0] === key && i.message.includes('a literal the executor reads as written'));
    });
  }

  it('the contract\'s literals are the keys this rule reads as literals — in step, both ways', () => {
    expect(contractLiteralKeys()).toEqual(['sourceObject', 'actorId', 'payload']);
    for (const [key, config] of [
      ['sourceObject', { sourceObject: '{{ record.object }}' }],
      ['actorId', { actorId: '{{ record.owner }}' }],
      ['payload', { payload: { meta: { by: '{{ record.owner }}' } } }],
    ] as const) {
      const found = findingsOf(config, FLOW_DOUBLE_BRACE_INTERP);
      expect(found, key).toHaveLength(1);
      expect(found[0]!.message, key).toContain('is a literal, read as written.');
      expect(found[0]!.hint, key).toContain('neither `{var}` nor `{{ }}` resolves there');
      expect(found[0]!.hint, key).not.toContain('Use `{var}`');
    }
    expect(findingsOf({ payload: { meta: { by: '{{ x }}' } } }, FLOW_DOUBLE_BRACE_INTERP)[0]!.message)
      .toContain('`payload.meta.by` is a literal');
    // Control: a notify key outside the contract's literals does not take their hint.
    const topic = findingsOf({ topic: '{{ record.kind }}' }, FLOW_DOUBLE_BRACE_INTERP);
    expect(topic).toHaveLength(1);
    expect(topic[0]!.hint).not.toContain('neither `{var}` nor `{{ }}` resolves there');
  });

  it('a bare `$ref.field` at a literal is named as read as written — no braces offered', () => {
    const found = findingsOf({ actorId: '$source.id' }, FLOW_BARE_DOLLAR_REF);
    expect(found).toHaveLength(1);
    expect(found[0]!.message).toContain('at `actorId` is NOT resolved: it is read as written.');
    expect(found[0]!.hint).toContain('Write the value itself.');
    expect(found[0]!.hint).not.toContain('`{source.id}`');
  });
});

/**
 * [#19939, stage S5] An http node's `method`, `durable`, `timeoutMs` and
 * `signingSecret` are literals the executor reads as written: no shipped flow
 * computed one, so no value slot is built there, and the contract refuses a
 * `{…}` token in one. Neither brace dialect resolves there, so the two
 * wrong-syntax hints name the value itself — never `{var}`, which the build
 * would refuse there. Its `url` and `headers` values are text slots, where a
 * double brace is the spelling, and its `body` a value slot.
 */
describe('the http literals: neither brace dialect resolves, and the hints say so (#19939)', () => {
  function httpFlow(config: Record<string, unknown>) {
    return {
      flows: [{
        name: 'literal_call',
        label: 'Literal call',
        type: 'autolaunched',
        nodes: [
          { id: 'start', type: 'start', label: 'Start' },
          { id: 'call', type: 'http', label: 'Call', config: { url: 'https://x.test/hook', ...config } },
          { id: 'done', type: 'end', label: 'Done' },
        ],
        edges: [{ id: 'e1', source: 'start', target: 'call' }, { id: 'e2', source: 'call', target: 'done' }],
      }],
    };
  }
  const findingsOf = (config: Record<string, unknown>, rule: string) =>
    lintFlowPatterns(httpFlow(config)).filter((f) => f.rule === rule);

  /** The keys the spec contract refuses a `{…}` token at as a literal — asked of the contract, never listed. */
  function contractLiteralKeys(): string[] {
    const shape = (HttpConfigSchema as unknown as { shape: Record<string, unknown> }).shape;
    return Object.keys(shape).filter((key) => {
      const parsed = HttpConfigSchema.safeParse({ url: 'https://x.test/hook', [key]: 'pre-{x}' });
      return !parsed.success
        && parsed.error.issues.some((i) => i.path.length === 1 && i.path[0] === key && / as written[:,]/.test(i.message));
    });
  }

  it('the contract\'s literals are the keys this rule reads as literals — in step, both ways', () => {
    // `headers` refuses a token written as the whole map, read as written, but
    // its values are text slots, where a double brace is the spelling: not a literal here.
    expect(contractLiteralKeys()).toEqual(['method', 'headers', 'durable', 'timeoutMs', 'signingSecret']);
    for (const key of ['method', 'durable', 'timeoutMs', 'signingSecret'] as const) {
      const found = findingsOf({ [key]: '{{ record.x }}' }, FLOW_DOUBLE_BRACE_INTERP);
      expect(found, key).toHaveLength(1);
      expect(found[0]!.message, key).toContain(`\`${key}\` is a literal, read as written.`);
      expect(found[0]!.hint, key).toContain('neither `{var}` nor `{{ }}` resolves there');
      expect(found[0]!.hint, key).not.toContain('Use `{var}`');
    }
    // Controls: a double brace in a text slot is the spelling, and in the body it is a value slot's finding.
    expect(findingsOf({ url: 'https://x.test/{{ id }}', headers: { 'X-Ref': '{{ id }}' } }, FLOW_DOUBLE_BRACE_INTERP)).toEqual([]);
    const body = findingsOf({ body: { id: '{{ record.id }}' } }, FLOW_DOUBLE_BRACE_INTERP);
    expect(body).toHaveLength(1);
    expect(body[0]!.hint).not.toContain('neither `{var}` nor `{{ }}` resolves there');
    expect(body[0]!.hint).toContain('A value slot reads no `{{ }}` template');
  });

  it('a bare `$ref.field` at a literal is named as read as written — no braces offered', () => {
    const found = findingsOf({ method: '$verb.name' }, FLOW_BARE_DOLLAR_REF);
    expect(found).toHaveLength(1);
    expect(found[0]!.message).toContain('at `method` is NOT resolved: it is read as written.');
    expect(found[0]!.hint).toContain('Write the value itself.');
    expect(found[0]!.hint).not.toContain('`{verb.name}`');
  });
});

// [#22161] Slice 19: the `fix:` line of the two wrong-syntax ids. One remedy
// line each: the judge's own spelling where the position takes one envelope,
// the hole in a text slot, the value itself at a literal; the judge's caveats
// (guards, the run user's null, callee and client sentences, literal and
// legacy positions, which slots read `{{ }}`) are each id's `os explain` entry.
describe('[#22161] one-line fix — flow-double-brace-interpolation and flow-bare-dollar-reference', () => {
  const NO_DIRECT_BARE =
    "A value slot stores a bare `$` reference as written: compute it in a CEL value envelope, `{ dialect: 'cel', " +
    "source: '…' }`, spelled as `os explain flow-bare-dollar-reference` says for this position.";
  const NO_DIRECT_DOUBLE =
    "A value slot reads no `{{ }}` template: compute the value in a CEL value envelope, `{ dialect: 'cel', " +
    "source: '…' }`, spelled as `os explain flow-double-brace-interpolation` says for this position.";
  const TEXT_SLOT_BOUNDED =
    'A text slot renders only `{{ }}` holes: write each reference as a hole over a variable the run binds ' +
    '(`os explain flow-bare-dollar-reference`).';
  function oneNode(type: string, config: Record<string, unknown>) {
    return {
      flows: [{
        name: 'one_node', label: 'One node', type: 'autolaunched',
        variables: [{ name: 'source', type: 'object' }],
        nodes: [
          { id: 'start', type: 'start', label: 'Start' },
          { id: 'n', type, label: 'N', config },
          { id: 'done', type: 'end', label: 'Done' },
        ],
        edges: [{ id: 'e1', source: 'start', target: 'n' }, { id: 'e2', source: 'n', target: 'done' }],
      }],
    };
  }
  const ofRule = (stack: ReturnType<typeof oneNode>, rule: string) => lintFlowPatterns(stack).filter((f) => f.rule === rule);

  it('a reference list that does not fit in one line takes the bounded line, in each slot kind', () => {
    const many = ['alpha_reference_name', 'beta_reference_name', 'gamma_reference_name', 'delta_reference_name'];
    const textRefs = many.map((n) => `$error.${n}`).join(' and ');
    expect(ofRule(oneNode('notify', { recipients: ['u1'], title: `Failed: ${textRefs}` }), FLOW_BARE_DOLLAR_REF).map((f) => f.hint))
      .toEqual([TEXT_SLOT_BOUNDED]);
    const valueRefs = many.map((n) => `$source.${n}`).join(' and ');
    expect(ofRule(oneNode('create_record', { objectName: 'task', fields: { v: valueRefs } }), FLOW_BARE_DOLLAR_REF).map((f) => f.hint))
      .toEqual([NO_DIRECT_BARE]);
    const longText = `${'A long literal sentence before the hole, '.repeat(4)}{{ source.id }}`;
    expect(ofRule(oneNode('create_record', { objectName: 'task', fields: { v: longText } }), FLOW_DOUBLE_BRACE_INTERP).map((f) => f.hint))
      .toEqual([NO_DIRECT_DOUBLE]);
  });

  it('every `fix:` line the cases above fired for the two ids is one line of at most 200 characters', () => {
    // Coverage control: both ids fired, and every hint arm of each.
    expect([...new Set(firedHints.map((f) => f.rule))].sort()).toEqual([FLOW_BARE_DOLLAR_REF, FLOW_DOUBLE_BRACE_INTERP].sort());
    type Fired = { rule: string; hint: string };
    const arms: Array<[string, (f: Fired) => boolean]> = [
      ['text slot: hole', (f) => f.rule === FLOW_BARE_DOLLAR_REF && f.hint.includes('Write it as a hole: ')],
      ['text slot: no hole', (f) => f.rule === FLOW_BARE_DOLLAR_REF && f.hint.includes('no hole: compute the value')],
      ['text slot: bounded', (f) => f.hint === TEXT_SLOT_BOUNDED],
      ['value slot: bare, spelled', (f) => f.hint.startsWith('A value slot stores a bare `$` reference as written: write ')],
      ['value slot: bare, unspelled', (f) => f.hint === NO_DIRECT_BARE],
      ['value slot: double, spelled', (f) => f.hint.startsWith('A value slot reads no `{{ }}` template: write ')],
      ['value slot: double, unspelled', (f) => f.hint === NO_DIRECT_DOUBLE],
      ['elsewhere: double', (f) => f.rule === FLOW_DOUBLE_BRACE_INTERP && f.hint.startsWith('This flow node value is read as written')],
      ['elsewhere: bare', (f) => f.rule === FLOW_BARE_DOLLAR_REF && f.hint.startsWith('This flow node value is read as written')],
      ['literal: notify', (f) => f.hint.startsWith('A notify node\'s `sourceObject`')],
      ['literal: http', (f) => f.hint.startsWith('An http node\'s `method`')],
    ];
    for (const [arm, test] of arms) expect(firedHints.some(test), arm).toBe(true);
    for (const f of firedHints) {
      expect(f.hint, f.rule).not.toContain('\n');
      expect(f.hint.length, `${f.rule}: ${f.hint}`).toBeLessThanOrEqual(200);
      for (const gone of [
        'CEL refuses an absent variable',
        'sits inside an object or list literal',
        'Move the node\'s assignments',
        'template dialect of the text slots only',
        'refused at `objectstack validate`',
        'may name a `$` variable only when',
        '`current_user` is `null`',
      ]) {
        expect(f.hint, `${f.rule}: ${gone}`).not.toContain(gone);
      }
    }
  });

  // What each `fix:` line stopped saying, which `os explain RULE_ID` now prints.
  const MOVED_FROM_HINT: Record<string, readonly string[]> = {
    [FLOW_DOUBLE_BRACE_INTERP]: [
      'a notify `title` / `message` / `actionUrl`, an http `url` and `headers` values',
      'reads a `{{ }}` string\'s outer braces as literal text',
      'inside an object or list literal',
      'a step at a time from `vars`',
      '`coalesce(…, \'\')`',
      'route around the node with a `decision`',
      'refused at `objectstack validate` and `registerFlow`',
      'by the executor\'s parse',
    ],
    [FLOW_BARE_DOLLAR_REF]: [
      'when the flow engine binds its `$` root',
      'is written without the `$`',
      '`current_user != null ? current_user.id : null`',
      'which on `update_record` clears a stored value',
      'read the user record by `current_user.id`',
      'canonical `assignments: { … }` map',
      'a step at a time from `vars`',
      'refused at `objectstack validate` and `registerFlow`',
    ],
  };

  it.each(Object.keys(MOVED_FROM_HINT))('`os explain %s` carries what its `fix:` line no longer says', (rule) => {
    const text = explained(rule);
    for (const fact of MOVED_FROM_HINT[rule]!) expect(text, `${rule} explanation names ${fact}`).toContain(fact);
  });
});

// [#22161] Slice 20: the twelve anti-pattern ids. Each `fix:` line is one remedy
// line; what it used to carry (why the shape fails, when it is a legitimate
// reading, what the rule does not judge, the history and the worked examples)
// is each id's `os explain` entry. The cases above fire every id, and the
// recorder at the top of the file collects every hint they produced.
describe('[#22161] one-line fix — the twelve flow anti-pattern ids', () => {
  it('every `fix:` line the cases above fired for the twelve ids is one line of at most 200 characters', () => {
    // Coverage control: every id fired, and every hint arm of each.
    expect([...new Set(firedSlice20Hints.map((f) => f.rule))].sort()).toEqual([...SLICE_20_IDS].sort());
    const ofRule = (rule: string) => firedSlice20Hints.filter((f) => f.rule === rule);
    // `flow-decision-unconditional-branch` has two arms, by message.
    expect(ofRule(FLOW_DECISION_UNCONDITIONAL_BRANCH).some((f) => f.message.startsWith('gates on NOTHING')), 'no-gate arm').toBe(true);
    expect(ofRule(FLOW_DECISION_UNCONDITIONAL_BRANCH).some((f) => f.message.startsWith('has guarded out-edge(s)')), 'mixed arm').toBe(true);
    // `flow-runas-unscoped` once named the trigger kind in its line; every kind still fires.
    for (const kind of ['schedule', 'time-relative', 'api']) {
      expect(ofRule(FLOW_RUNAS_UNSCOPED).some((f) => f.message.startsWith(`${kind}-triggered`)), kind).toBe(true);
    }
    for (const f of firedSlice20Hints) {
      expect(f.hint, f.rule).not.toContain('\n');
      expect(f.hint.length, `${f.rule}: ${f.hint}`).toBeLessThanOrEqual(200);
    }
  });

  it('the two containment entries spell the `catch` region their `fix:` lines prescribe', () => {
    for (const rule of [FLOW_LOOP_BODY_UNCONTAINED, FLOW_TRY_CATCH_WITHOUT_CATCH]) {
      const hints = firedSlice20Hints.filter((f) => f.rule === rule).map((f) => f.hint);
      expect(hints.length, rule).toBeGreaterThan(0);
      for (const hint of hints) {
        const region = /`catch: \{[^`]*\}`/.exec(hint)?.[0];
        expect(region, `${rule}: ${hint}`).toBeDefined();
        expect(explained(rule), rule).toContain(region!);
      }
    }
  });

  // What each `fix:` line stopped saying, which `os explain RULE_ID` now prints.
  const MOVED_FROM_SLICE_20_HINT: Record<string, readonly string[]> = {
    [FLOW_LOOP_BODY_UNCONTAINED]: [
      '`catch: {}` and `catch: { nodes: [] }` are both refused by the parse',
      'one bare `assignment` node with no `config`',
      'processes all 5 items and the run completes',
      'a legitimate reading',
      'content/docs/automation/flows.mdx §"Per-iteration containment"',
    ],
    [FLOW_TRY_CATCH_WITHOUT_CATCH]: [
      '`catch: {}` and `catch: { nodes: [] }` are both refused by the parse',
      '`errorVariable`',
      'legitimate retry-then-fail shape',
      'content/docs/automation/flows.mdx §"Per-iteration containment"',
    ],
    [FLOW_MULTI_WRITE_UNFILTERED]: [
      'showcase_inquiry_purge',
      'warning, not a gate',
      'the run-time erased-condition guard',
      '"the filter is empty"',
    ],
    [FLOW_DECISION_INCLUSIVE_OVERLAP]: [
      "Keep `mode: 'inclusive'` only where running every matching branch is the intent",
      'authored against protocol major 17 and converted by `os migrate meta`',
    ],
    [FLOW_APPROVAL_REVISE_TARGET_NOT_SERVICE_OWNED]: [
      'POST /api/v1/approvals/requests/:id/resubmit',
      'ADR-0044 D3 originally said `wait` here',
      'resumable by anyone with the run id',
    ],
    [FLOW_TIME_RELATIVE_ANTIPATTERN]: [
      'is swept daily',
      'a range (`$gte` / `$lt`)',
    ],
    [FLOW_DATE_EQUALITY_FILTER]: [
      'abutting windows tile the timeline',
      'each row matches exactly once',
      '`offsetDays` runs once per record on each offset day',
    ],
    [FLOW_RUNAS_UNSCOPED]: [
      'scopes each data operation to the triggering user\'s grants',
      'refuses the operation rather than run it unscoped',
      'ADR-0049, ADR-0073 D5',
    ],
    [FLOW_DECISION_MODE_INVALID]: [
      '`registerFlow` refuses this flow with the same sentence',
      'Fix the node in the flow definition',
    ],
    [FLOW_DECISION_UNCONDITIONAL_BRANCH]: [
      'drop `type: \'decision\'` and use the node it already behaves as',
    ],
    [FLOW_ERROR_LABEL_NOT_FAULT]: [
      'A guard refusal (a filter token that resolved to nothing, a missing required config key, an unscoped run) stays fatal by design',
    ],
    [FLOW_BRANCH_LABEL_UNMATCHED]: [
      'one mechanism per decision, never both',
      '`isDefault: true` on the fallback',
    ],
  };

  it('every one of the twelve ids has its facts listed', () => {
    expect(Object.keys(MOVED_FROM_SLICE_20_HINT).sort()).toEqual([...SLICE_20_IDS].sort());
  });

  it.each(SLICE_20_IDS)('`os explain %s` carries what its `fix:` line no longer says, and the line does not', (rule) => {
    const text = explained(rule);
    const hints = firedSlice20Hints.filter((f) => f.rule === rule).map((f) => f.hint);
    expect(hints.length, rule).toBeGreaterThan(0);
    for (const fact of MOVED_FROM_SLICE_20_HINT[rule]!) {
      expect(text, `${rule} explanation names ${fact}`).toContain(fact);
      for (const hint of hints) expect(hint, `${rule} fix: line still says ${fact}`).not.toContain(fact);
    }
  });
});
