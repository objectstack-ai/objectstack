// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #35143 — the second batch of publish-time flow checks: the flow family of
 * the hosted build checks the framework did not have. Each rule has a pin
 * that fires, a pin that stays silent, and (for the rules the runtime publish
 * gate runs) the gate's own verdict on a `flow` write.
 */

import { describe, expect, it } from 'vitest';
import { runAuthoringRules } from './authoring-rules.js';
import { runRuntimeAuthoringRules } from './runtime-gate.js';
import { FLOW_CREATE_UPDATE_PAIR, lintFlowPatterns } from './lint-flow-patterns.js';
import {
  FLOW_NODE_WRITE_DATE_HELPER_TEXT,
  FLOW_NODE_WRITE_UNKNOWN_OPTION,
  validateFlowNodeWrites,
} from './validate-flow-node-writes.js';
import {
  FLOW_CONDITION_OPTION_LABEL,
  FLOW_SCHEDULE_TIMEZONE_MISSING,
  FLOW_SUBFLOW_UNKNOWN,
  FLOW_TIME_RELATIVE_DATE_FIELD_INVALID,
  FLOW_TIME_RELATIVE_KEY_MISPLACED,
  FLOW_TIME_RELATIVE_SHADOWED,
  FLOW_TRIGGER_OBJECT_MISSING,
  validateFlowSubflowTargets,
  validateFlowTriggerReadiness,
} from './validate-flow-trigger-readiness.js';
import { explainRule } from './rule-explanations.js';

type AnyRec = Record<string, any>;

const DEAL = {
  name: 'deal',
  label: 'Deal',
  fields: {
    name: { type: 'text', label: 'Name' },
    stage: {
      type: 'select',
      label: 'Stage',
      options: [
        { value: 'open', label: 'Open' },
        { value: 'closed_lost', label: 'Closed Lost' },
      ],
    },
    tags: {
      type: 'multiselect',
      label: 'Tags',
      options: [
        { value: 'hot', label: 'Hot' },
        { value: 'cold', label: 'Cold' },
      ],
    },
    region: { type: 'select', label: 'Region', picklist: 'regions' },
    locked_stage: {
      type: 'select',
      label: 'Locked stage',
      readonly: true,
      options: [{ value: 'a', label: 'A' }],
    },
    due_on: { type: 'date', label: 'Due on' },
    amount: { type: 'number', label: 'Amount' },
  },
};

const startNode = (config: AnyRec) => ({ id: 'start', type: 'start', label: 'Start', config });

const flow = (name: string, config: AnyRec, nodes: AnyRec[] = [], extra: AnyRec = {}): AnyRec => ({
  name,
  label: name,
  type: 'autolaunched',
  status: 'active',
  nodes: [startNode(config), ...nodes],
  edges: nodes.map((n, i) => ({ id: `e${i}`, source: i === 0 ? 'start' : nodes[i - 1].id, target: n.id })),
  ...extra,
});

const stack = (...flows: AnyRec[]): AnyRec => ({ objects: [DEAL], flows });

const rulesOf = (findings: readonly { rule: string }[]) => findings.map((f) => f.rule);

const SWEEP = { object: 'deal', dateField: 'due_on', withinDays: 7 };

describe('flow-trigger-object-missing', () => {
  it('refuses a record-change start that names no object', () => {
    const findings = validateFlowTriggerReadiness(stack(flow('notify', { triggerType: 'record-after-update' })));
    const hit = findings.filter((f) => f.rule === FLOW_TRIGGER_OBJECT_MISSING);
    expect(hit).toHaveLength(1);
    expect(hit[0]).toMatchObject({ severity: 'error', path: 'flows[0].nodes[0].config.objectName' });
    expect(hit[0].message).toMatch(/every object/);
  });

  it('refuses a blank object name, saying the flow is never bound (not that it watches every object)', () => {
    const findings = validateFlowTriggerReadiness(
      stack(flow('notify', { triggerType: 'record-after-create', objectName: '  ' })),
    );
    const hit = findings.filter((f) => f.rule === FLOW_TRIGGER_OBJECT_MISSING);
    expect(hit).toHaveLength(1);
    expect(hit[0].message).toMatch(/never bound/);
    expect(hit[0].message).not.toMatch(/every object/);
  });

  it('is silent on a record-change start that names its object, and on a flow with no record trigger', () => {
    const findings = validateFlowTriggerReadiness(
      stack(
        flow('notify', { triggerType: 'record-after-update', objectName: 'deal' }),
        flow('manual', {}),
      ),
    );
    expect(rulesOf(findings)).not.toContain(FLOW_TRIGGER_OBJECT_MISSING);
  });

  it('the runtime publish gate refuses the flow write', () => {
    const verdict = runRuntimeAuthoringRules({
      type: 'flow',
      item: flow('notify', { triggerType: 'record-after-update' }),
      context: { objects: [DEAL] },
    });
    expect(rulesOf(verdict.errors)).toContain(FLOW_TRIGGER_OBJECT_MISSING);
  });
});

describe('flow-condition-option-label', () => {
  const withCondition = (condition: unknown) =>
    stack(flow('lost', { triggerType: 'record-after-update', objectName: 'deal', condition }));

  it('refuses a start condition comparing a select field with an option label', () => {
    const findings = validateFlowTriggerReadiness(withCondition("record.stage == 'Closed Lost'"));
    const hit = findings.filter((f) => f.rule === FLOW_CONDITION_OPTION_LABEL);
    expect(hit).toHaveLength(1);
    expect(hit[0]).toMatchObject({ severity: 'error', path: 'flows[0].nodes[0].config.condition' });
    expect(hit[0].hint).toContain("'closed_lost'");
  });

  it('reads a CEL envelope and double quotes too', () => {
    const findings = validateFlowTriggerReadiness(
      withCondition({ dialect: 'cel', source: 'previous.stage != "Closed Lost"' }),
    );
    expect(rulesOf(findings)).toContain(FLOW_CONDITION_OPTION_LABEL);
  });

  it('is silent when the condition compares the value, or names the value as well', () => {
    for (const condition of [
      "record.stage == 'closed_lost'",
      "record.stage == 'closed_lost' || record.name == 'Closed Lost'",
    ]) {
      expect(rulesOf(validateFlowTriggerReadiness(withCondition(condition)))).not.toContain(
        FLOW_CONDITION_OPTION_LABEL,
      );
    }
  });

  it('reads the literal-first spelling and each member of an `in` list', () => {
    for (const condition of ["'Closed Lost' == record.stage", "stage in ['open', 'Closed Lost']"]) {
      const hit = validateFlowTriggerReadiness(withCondition(condition)).filter(
        (f) => f.rule === FLOW_CONDITION_OPTION_LABEL,
      );
      expect(hit, condition).toHaveLength(1);
      expect(hit[0].hint).toContain("'closed_lost'");
    }
  });

  it('is silent when the label is the comparand of another field, not of the select field', () => {
    expect(
      rulesOf(validateFlowTriggerReadiness(withCondition("record.stage == 'open' && record.name == 'Closed Lost'"))),
    ).not.toContain(FLOW_CONDITION_OPTION_LABEL);

    // One select field's label is the other's value: comparing `severity` with 'High' is right.
    const TICKET = {
      name: 'ticket',
      label: 'Ticket',
      fields: {
        priority: { type: 'select', label: 'Priority', options: [{ value: 'high', label: 'High' }, { value: 'low', label: 'Low' }] },
        severity: { type: 'select', label: 'Severity', options: ['High', 'Low'] },
      },
    };
    const ticketStack = (condition: string) => ({
      objects: [TICKET],
      flows: [flow('triage', { triggerType: 'record-after-update', objectName: 'ticket', condition })],
    });
    expect(
      rulesOf(validateFlowTriggerReadiness(ticketStack("record.severity == 'High' && record.priority != null"))),
    ).not.toContain(FLOW_CONDITION_OPTION_LABEL);
    // …while comparing `priority` with its own label still is reported.
    expect(rulesOf(validateFlowTriggerReadiness(ticketStack("record.priority == 'High'")))).toContain(
      FLOW_CONDITION_OPTION_LABEL,
    );
  });

  it('is silent when no select field is read, and for an object the stack does not declare', () => {
    expect(
      rulesOf(validateFlowTriggerReadiness(withCondition("record.name == 'Closed Lost'"))),
    ).not.toContain(FLOW_CONDITION_OPTION_LABEL);
    const foreign = { objects: [], flows: [flow('lost', { triggerType: 'record-after-update', objectName: 'deal', condition: "record.stage == 'Closed Lost'" })] };
    expect(rulesOf(validateFlowTriggerReadiness(foreign))).not.toContain(FLOW_CONDITION_OPTION_LABEL);
  });

  it('the runtime publish gate refuses the flow write', () => {
    const verdict = runRuntimeAuthoringRules({
      type: 'flow',
      item: flow('lost', { triggerType: 'record-after-update', objectName: 'deal', condition: "record.stage == 'Closed Lost'" }),
      context: { objects: [DEAL] },
    });
    expect(rulesOf(verdict.errors)).toContain(FLOW_CONDITION_OPTION_LABEL);
  });
});

describe('flow-condition-option-label past the start condition (#36964)', () => {
  const labelHits = (findings: readonly { rule: string }[]) =>
    findings.filter((f) => f.rule === FLOW_CONDITION_OPTION_LABEL) as AnyRec[];

  /** A manual flow: no trigger record, so every hit below is the filter's or a bound row's. */
  const manual = (nodes: AnyRec[], extra: AnyRec = {}) => stack(flow('sweep', {}, nodes, extra));
  const crud = (type: string, filter: unknown, extra: AnyRec = {}) => ({
    id: 'step',
    type,
    label: 'Step',
    config: { objectName: 'deal', filter, ...extra },
  });

  it('refuses a label in a get_record filter, at the operand, naming the value', () => {
    const hit = labelHits(validateFlowTriggerReadiness(manual([crud('get_record', { stage: 'Closed Lost' }, { outputVariable: 'deal' })])));
    expect(hit).toHaveLength(1);
    expect(hit[0]).toMatchObject({ severity: 'error', path: 'flows[0].nodes[1].config.filter.stage' });
    expect(hit[0].message).toContain('matches no record');
    expect(hit[0].hint).toBe("Filter on the option's value: write 'closed_lost' in place of 'Closed Lost'");
  });

  it('refuses a label in an update_record and a delete_record filter, operator, list and combinator forms included', () => {
    const update = labelHits(
      validateFlowTriggerReadiness(manual([crud('update_record', { stage: { $eq: 'Closed Lost' } }, { multi: true, fields: { name: 'x' } })])),
    );
    expect(update.map((f) => f.path)).toEqual(['flows[0].nodes[1].config.filter.stage.$eq']);

    const remove = labelHits(
      validateFlowTriggerReadiness(
        manual([crud('delete_record', { $or: [{ stage: { $in: ['open', 'Closed Lost'] } }, { tags: 'Hot' }] })]),
      ),
    );
    expect(remove.map((f) => f.path)).toEqual([
      'flows[0].nodes[1].config.filter.$or[0].stage.$in[1]',
      'flows[0].nodes[1].config.filter.$or[1].tags',
    ]);
  });

  it('says an excluding operand excludes no record', () => {
    const hit = labelHits(validateFlowTriggerReadiness(manual([crud('get_record', { stage: { $ne: 'Closed Lost' } })])));
    expect(hit).toHaveLength(1);
    expect(hit[0].message).toContain('excludes no record');
  });

  it('reads a filter inside a region, and a time-relative sweep filter', () => {
    const loop = {
      id: 'each',
      type: 'loop',
      label: 'Each',
      config: { collection: { dialect: 'cel', source: '[1]' }, iteratorVariable: 'i', body: { nodes: [crud('get_record', { stage: 'Closed Lost' })], edges: [] } },
    };
    expect(labelHits(validateFlowTriggerReadiness(manual([loop]))).map((f) => f.path)).toEqual([
      'flows[0].nodes[1].config.body.nodes[0].config.filter.stage',
    ]);
    const sweep = labelHits(
      validateFlowTriggerReadiness(stack(flow('remind', { objectName: 'deal', timeRelative: { ...SWEEP, filter: { stage: 'Closed Lost' } } }))),
    );
    expect(sweep.map((f) => f.path)).toEqual(['flows[0].nodes[0].config.timeRelative.filter.stage']);
  });

  it('is silent on the value, an expression operand, a template string, a picklist field and a nested relation', () => {
    for (const filter of [
      { stage: 'closed_lost' },
      { stage: { dialect: 'cel', source: "'Closed Lost'" } },
      { stage: '{{wanted_stage}}' },
      { stage: { $in: [{ dialect: 'cel', source: 'wanted' }] } },
      { region: 'Anywhere' },
      { account: { stage: 'Closed Lost' } },
      { stage: { $gt: 'Closed Lost' } },
    ]) {
      expect(rulesOf(validateFlowTriggerReadiness(manual([crud('get_record', filter)]))), JSON.stringify(filter)).not.toContain(
        FLOW_CONDITION_OPTION_LABEL,
      );
    }
  });

  /** A get_record binding `deal`, then a decision whose out-edges compare. */
  const branching = (condition: unknown, getConfig: AnyRec = {}, extra: AnyRec = {}): AnyRec =>
    stack({
      ...flow('route', {}, [], extra),
      nodes: [
        startNode({}),
        { id: 'load', type: 'get_record', label: 'Load', config: { objectName: 'deal', filter: { id: 'd1' }, outputVariable: 'deal', ...getConfig } },
        { id: 'check', type: 'decision', label: 'Check', config: {} },
        { id: 'lost', type: 'end', label: 'Lost', config: {} },
        { id: 'other', type: 'end', label: 'Other', config: {} },
      ],
      edges: [
        { id: 'e0', source: 'start', target: 'load' },
        { id: 'e1', source: 'load', target: 'check' },
        { id: 'e2', source: 'check', target: 'lost', condition },
        { id: 'e3', source: 'check', target: 'other', isDefault: true },
      ],
    });

  it('refuses a decision edge condition comparing a row a get_record bound with a label', () => {
    const hit = labelHits(validateFlowTriggerReadiness(branching("deal.stage == 'Closed Lost'")));
    expect(hit).toHaveLength(1);
    expect(hit[0]).toMatchObject({ severity: 'error', path: 'flows[0].edges[2].condition' });
    expect(hit[0].hint).toContain("'closed_lost'");
    expect(rulesOf(validateFlowTriggerReadiness(branching({ dialect: 'cel', source: "deal.stage in ['Closed Lost']" })))).toContain(
      FLOW_CONDITION_OPTION_LABEL,
    );
  });

  it("refuses an edge on a record-change flow comparing the trigger record, and a decision node's branch", () => {
    const onRecord = stack(
      flow('lost', { triggerType: 'record-after-update', objectName: 'deal' }, [{ id: 'tell', type: 'end', label: 'Tell', config: {} }]),
    );
    onRecord.flows[0].edges[0].condition = "record.stage == 'Closed Lost'";
    expect(labelHits(validateFlowTriggerReadiness(onRecord)).map((f) => f.path)).toEqual(['flows[0].edges[0].condition']);

    const branched = branching(undefined);
    branched.flows[0].nodes[2].config = { conditions: [{ label: 'lost', expression: "deal.stage == 'Closed Lost'" }] };
    expect(labelHits(validateFlowTriggerReadiness(branched)).map((f) => f.path)).toEqual([
      'flows[0].nodes[2].config.conditions[0].expression',
    ]);
  });

  it('is silent on the value, an expression comparand, and a row the condition cannot be sure of', () => {
    const cases: Array<[string, AnyRec]> = [
      ['the value', branching("deal.stage == 'closed_lost'")],
      ['a variable comparand', branching('deal.stage == wanted_stage')],
      ['a template comparand', branching("deal.stage == '{{wanted_stage}}'")],
      ['a list read (limit > 1)', branching("deal.stage == 'Closed Lost'", { limit: 5 })],
      ['a templated object', branching("deal.stage == 'Closed Lost'", { objectName: '{object}' })],
      [
        'a name also declared as a flow variable',
        branching("deal.stage == 'Closed Lost'", {}, { variables: [{ name: 'deal', type: 'object' }] }),
      ],
      ['a manual flow reading a bare field (no trigger record)', branching("stage == 'Closed Lost'")],
    ];
    for (const [label, s] of cases) {
      expect(rulesOf(validateFlowTriggerReadiness(s)), label).not.toContain(FLOW_CONDITION_OPTION_LABEL);
    }
    // A bare read on a record-change flow is the trigger field — unless a variable of that name shadows it.
    const bare = (extra: AnyRec) => {
      const s = stack(
        flow('lost', { triggerType: 'record-after-update', objectName: 'deal' }, [{ id: 'tell', type: 'end', label: 'Tell', config: {} }], extra),
      );
      s.flows[0].edges[0].condition = "stage == 'Closed Lost'";
      return rulesOf(validateFlowTriggerReadiness(s));
    };
    expect(bare({})).toContain(FLOW_CONDITION_OPTION_LABEL);
    expect(bare({ variables: [{ name: 'stage', type: 'text' }] })).not.toContain(FLOW_CONDITION_OPTION_LABEL);
  });

  it('os validate reports it, and the runtime publish gate refuses the flow write', () => {
    const s = branching("deal.stage == 'Closed Lost'");
    expect(rulesOf(runAuthoringRules('validate', { normalized: s } as never))).toContain(FLOW_CONDITION_OPTION_LABEL);
    const verdict = runRuntimeAuthoringRules({ type: 'flow', item: s.flows[0], context: { objects: [DEAL] } });
    expect(rulesOf(verdict.errors)).toContain(FLOW_CONDITION_OPTION_LABEL);
    const filtered = manual([crud('update_record', { stage: 'Closed Lost' }, { fields: { name: 'x' } })]);
    const filterVerdict = runRuntimeAuthoringRules({ type: 'flow', item: filtered.flows[0], context: { objects: [DEAL] } });
    expect(rulesOf(filterVerdict.errors)).toContain(FLOW_CONDITION_OPTION_LABEL);
  });
});

describe('flow-time-relative-shadowed', () => {
  it('refuses a record-* token beside a sweep descriptor', () => {
    const findings = validateFlowTriggerReadiness(
      stack(flow('remind', { triggerType: 'record-after-update', objectName: 'deal', timeRelative: SWEEP })),
    );
    const hit = findings.filter((f) => f.rule === FLOW_TIME_RELATIVE_SHADOWED);
    expect(hit).toHaveLength(1);
    expect(hit[0]).toMatchObject({ severity: 'error', path: 'flows[0].nodes[0].config.triggerType' });
  });

  it('is silent on a sweep with no record token', () => {
    const findings = validateFlowTriggerReadiness(stack(flow('remind', { timeRelative: SWEEP }, [], { runAs: 'system' })));
    expect(rulesOf(findings)).not.toContain(FLOW_TIME_RELATIVE_SHADOWED);
  });
});

describe('flow-time-relative-key-misplaced', () => {
  it('refuses filter and maxRecords written beside the descriptor', () => {
    const findings = validateFlowTriggerReadiness(
      stack(flow('remind', { timeRelative: SWEEP, filter: { stage: 'open' }, maxRecords: 50 })),
    );
    const hits = findings.filter((f) => f.rule === FLOW_TIME_RELATIVE_KEY_MISPLACED);
    expect(hits.map((f) => f.path)).toEqual([
      'flows[0].nodes[0].config.filter',
      'flows[0].nodes[0].config.maxRecords',
    ]);
    expect(hits.every((f) => f.severity === 'error')).toBe(true);
  });

  it('is silent when the keys sit inside the descriptor', () => {
    const findings = validateFlowTriggerReadiness(
      stack(flow('remind', { timeRelative: { ...SWEEP, filter: { stage: 'open' }, maxRecords: 50 } })),
    );
    expect(rulesOf(findings)).not.toContain(FLOW_TIME_RELATIVE_KEY_MISPLACED);
  });

  it('is silent on a start with no descriptor', () => {
    const findings = validateFlowTriggerReadiness(
      stack(flow('notify', { triggerType: 'record-after-update', objectName: 'deal', filter: { stage: 'open' } })),
    );
    expect(rulesOf(findings)).not.toContain(FLOW_TIME_RELATIVE_KEY_MISPLACED);
  });
});

describe('flow-time-relative-date-field-invalid', () => {
  const sweeping = (dateField: string) =>
    validateFlowTriggerReadiness(stack(flow('remind', { timeRelative: { ...SWEEP, dateField } })));

  it('refuses a swept field that is not a date', () => {
    const hit = sweeping('amount').filter((f) => f.rule === FLOW_TIME_RELATIVE_DATE_FIELD_INVALID);
    expect(hit).toHaveLength(1);
    expect(hit[0]).toMatchObject({ severity: 'error', path: 'flows[0].nodes[0].config.timeRelative.dateField' });
    expect(hit[0].message).toContain("'number'");
    expect(hit[0].hint).toContain('due_on');
  });

  it('refuses a swept field the object does not have', () => {
    const hit = sweeping('due_date').filter((f) => f.rule === FLOW_TIME_RELATIVE_DATE_FIELD_INVALID);
    expect(hit).toHaveLength(1);
    expect(hit[0].message).toContain("no field 'due_date'");
  });

  it('is silent on a date field, on a platform timestamp column, and on an object the stack does not declare', () => {
    expect(rulesOf(sweeping('due_on'))).not.toContain(FLOW_TIME_RELATIVE_DATE_FIELD_INVALID);
    expect(rulesOf(sweeping('created_at'))).not.toContain(FLOW_TIME_RELATIVE_DATE_FIELD_INVALID);
    const foreign = validateFlowTriggerReadiness({
      objects: [],
      flows: [flow('remind', { timeRelative: { ...SWEEP, object: 'invoice', dateField: 'amount' } })],
    });
    expect(rulesOf(foreign)).not.toContain(FLOW_TIME_RELATIVE_DATE_FIELD_INVALID);
  });
});

describe('flow-schedule-timezone-missing', () => {
  const scheduled = (schedule: unknown, extra: AnyRec = {}) =>
    validateFlowTriggerReadiness(stack(flow('digest', { schedule, ...extra }, [], { type: 'schedule' })));

  it('advises on a cron with no zone, in both spellings', () => {
    for (const schedule of ['0 9 * * *', { type: 'cron', expression: '0 9 * * *' }]) {
      const hit = scheduled(schedule).filter((f) => f.rule === FLOW_SCHEDULE_TIMEZONE_MISSING);
      expect(hit).toHaveLength(1);
      expect(hit[0]).toMatchObject({ severity: 'warning', path: 'flows[0].nodes[0].config.schedule' });
    }
  });

  it("advises on a sweep's cadence too", () => {
    const findings = validateFlowTriggerReadiness(
      stack(flow('remind', { timeRelative: SWEEP, schedule: { type: 'cron', expression: '0 9 * * *' } })),
    );
    expect(rulesOf(findings)).toContain(FLOW_SCHEDULE_TIMEZONE_MISSING);
  });

  it('is silent on a cron that names its zone, on an interval, and on a record-change flow', () => {
    expect(
      rulesOf(scheduled({ type: 'cron', expression: '0 9 * * *', timezone: 'Asia/Shanghai' })),
    ).not.toContain(FLOW_SCHEDULE_TIMEZONE_MISSING);
    expect(rulesOf(scheduled({ type: 'interval', intervalMs: 60000 }))).not.toContain(FLOW_SCHEDULE_TIMEZONE_MISSING);
    const recordFlow = validateFlowTriggerReadiness(
      stack(flow('notify', { triggerType: 'record-after-update', objectName: 'deal', schedule: '0 9 * * *' })),
    );
    expect(rulesOf(recordFlow)).not.toContain(FLOW_SCHEDULE_TIMEZONE_MISSING);
  });
});

describe('flow-subflow-unknown', () => {
  const calling = (flowName: string) =>
    flow('parent', {}, [{ id: 'call', type: 'subflow', label: 'Call', config: { flowName } }]);

  it('advises on a subflow step calling a flow the stack does not define', () => {
    const findings = validateFlowSubflowTargets(stack(calling('missing_child')));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      rule: FLOW_SUBFLOW_UNKNOWN,
      severity: 'warning',
      path: 'flows[0].nodes[1].config.flowName',
    });
  });

  it('is silent when the called flow is in the stack or in a carried package', () => {
    expect(validateFlowSubflowTargets(stack(calling('child'), flow('child', {})))).toEqual([]);
    expect(
      validateFlowSubflowTargets({ ...stack(calling('child')), packages: [{ manifest: { id: 'dep' }, flows: [{ name: 'child' }] }] }),
    ).toEqual([]);
  });

  it('runs on the CLI commands and not on the runtime publish gate', () => {
    const cli = runAuthoringRules('validate', { normalized: stack(calling('missing_child')) } as never);
    expect(rulesOf(cli)).toContain(FLOW_SUBFLOW_UNKNOWN);
    const verdict = runRuntimeAuthoringRules({ type: 'flow', item: calling('missing_child'), context: { objects: [DEAL] } });
    expect(rulesOf([...verdict.errors, ...verdict.advisories])).not.toContain(FLOW_SUBFLOW_UNKNOWN);
  });
});

describe('flow-node-write-unknown-option', () => {
  const writing = (fields: AnyRec) =>
    stack(
      flow('close', { triggerType: 'record-after-update', objectName: 'deal' }, [
        { id: 'set_stage', type: 'update_record', label: 'Set stage', config: { objectName: 'deal', filter: { id: 'x' }, fields } },
      ]),
    );

  it("refuses an option's label written where its value belongs, naming the value", () => {
    const hit = validateFlowNodeWrites(writing({ stage: 'Closed Lost' })).filter((f) => f.rule === FLOW_NODE_WRITE_UNKNOWN_OPTION);
    expect(hit).toHaveLength(1);
    expect(hit[0]).toMatchObject({ severity: 'error', path: 'flows[0].nodes[1].config.fields.stage' });
    expect(hit[0].hint).toBe("Write the option's value: 'closed_lost'");
  });

  it('refuses a literal no option carries, and each bad member of a multi-value write', () => {
    expect(rulesOf(validateFlowNodeWrites(writing({ stage: 'won' })))).toContain(FLOW_NODE_WRITE_UNKNOWN_OPTION);
    const multi = validateFlowNodeWrites(writing({ tags: ['hot', 'Cold'] })).filter((f) => f.rule === FLOW_NODE_WRITE_UNKNOWN_OPTION);
    expect(multi).toHaveLength(1);
    expect(multi[0].hint).toContain("'cold'");
  });

  it('is silent on a value, a CEL envelope, a picklist field, a readonly field and an empty write', () => {
    for (const fields of [
      { stage: 'closed_lost' },
      { stage: { dialect: 'cel', source: "'closed_lost'" } },
      { region: 'Anywhere' },
      { locked_stage: 'zzz' },
      { stage: '' },
      { tags: ['hot', 'cold'] },
    ]) {
      expect(rulesOf(validateFlowNodeWrites(writing(fields))), JSON.stringify(fields)).not.toContain(
        FLOW_NODE_WRITE_UNKNOWN_OPTION,
      );
    }
  });

  it('the runtime publish gate refuses the flow write', () => {
    const item = writing({ stage: 'Closed Lost' }).flows[0];
    const verdict = runRuntimeAuthoringRules({ type: 'flow', item, context: { objects: [DEAL] } });
    expect(rulesOf(verdict.errors)).toContain(FLOW_NODE_WRITE_UNKNOWN_OPTION);
  });
});

describe('flow-node-write-date-helper-text', () => {
  const writing = (fields: AnyRec) =>
    stack(
      flow('create_followup', { triggerType: 'record-after-create', objectName: 'deal' }, [
        { id: 'make', type: 'create_record', label: 'Make', config: { objectName: 'deal', fields: { name: 'x', ...fields } } },
      ]),
    );

  it('refuses a date helper inside a plain string written to a date field', () => {
    for (const text of ['today()', 'isoDate(daysFromNow(7))']) {
      const hit = validateFlowNodeWrites(writing({ due_on: text })).filter((f) => f.rule === FLOW_NODE_WRITE_DATE_HELPER_TEXT);
      expect(hit, text).toHaveLength(1);
      expect(hit[0]).toMatchObject({ severity: 'error', path: 'flows[0].nodes[1].config.fields.due_on' });
    }
  });

  it('is silent on a CEL envelope, a literal day, and helper text in a text field', () => {
    for (const fields of [
      { due_on: { dialect: 'cel', source: 'isoDate(today())' } },
      { due_on: '2026-01-15' },
      { name: 'call back today()' },
    ]) {
      expect(rulesOf(validateFlowNodeWrites(writing(fields))), JSON.stringify(fields)).not.toContain(
        FLOW_NODE_WRITE_DATE_HELPER_TEXT,
      );
    }
  });

  it('the runtime publish gate refuses the flow write', () => {
    const item = writing({ due_on: 'today()' }).flows[0];
    const verdict = runRuntimeAuthoringRules({ type: 'flow', item, context: { objects: [DEAL] } });
    expect(rulesOf(verdict.errors)).toContain(FLOW_NODE_WRITE_DATE_HELPER_TEXT);
  });
});

describe('flow-create-update-pair', () => {
  const notifyNode = { id: 'tell', type: 'notify', label: 'Tell', config: { recipients: ['owner'], title: 'Changed' } };
  const onEvent = (name: string, triggerType: string, objectName = 'deal', node: AnyRec = notifyNode) =>
    flow(name, { triggerType, objectName }, [node]);

  it('advises on an after-create and an after-update flow running the same steps', () => {
    const findings = lintFlowPatterns(
      stack(onEvent('on_create', 'record-after-create'), onEvent('on_update', 'record-after-update')),
    ).filter((f) => f.rule === FLOW_CREATE_UPDATE_PAIR);
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe('warning');
    expect(findings[0].message).toContain("'on_create'");
    expect(findings[0].message).toContain("'on_update'");
  });

  it('is silent when the steps differ, when the objects differ, and for one flow alone', () => {
    const other = { ...notifyNode, config: { ...notifyNode.config, title: 'Other' } };
    // Two connector steps whose work rides on `connectorConfig`, not `config`.
    const connector = (connectorId: string) => ({
      id: 'call',
      type: 'connector_action',
      label: 'Call',
      connectorConfig: { connectorId, actionId: 'request', input: {} },
    });
    for (const flows of [
      [
        onEvent('on_create', 'record-after-create', 'deal', connector('status_api')),
        onEvent('on_update', 'record-after-update', 'deal', connector('slack')),
      ],
      [onEvent('on_create', 'record-after-create'), onEvent('on_update', 'record-after-update', 'deal', other)],
      [onEvent('on_create', 'record-after-create'), onEvent('on_update', 'record-after-update', 'lead')],
      [onEvent('on_create', 'record-after-create')],
    ]) {
      expect(rulesOf(lintFlowPatterns(stack(...flows)))).not.toContain(FLOW_CREATE_UPDATE_PAIR);
    }
  });
});

describe('every new rule has its explanation', () => {
  it('os explain answers each id', () => {
    for (const rule of [
      FLOW_TRIGGER_OBJECT_MISSING,
      FLOW_CONDITION_OPTION_LABEL,
      FLOW_TIME_RELATIVE_SHADOWED,
      FLOW_TIME_RELATIVE_KEY_MISPLACED,
      FLOW_TIME_RELATIVE_DATE_FIELD_INVALID,
      FLOW_SCHEDULE_TIMEZONE_MISSING,
      FLOW_SUBFLOW_UNKNOWN,
      FLOW_NODE_WRITE_UNKNOWN_OPTION,
      FLOW_NODE_WRITE_DATE_HELPER_TEXT,
      FLOW_CREATE_UPDATE_PAIR,
    ]) {
      expect(explainRule(rule)?.rule, rule).toBe(rule);
    }
  });
});
