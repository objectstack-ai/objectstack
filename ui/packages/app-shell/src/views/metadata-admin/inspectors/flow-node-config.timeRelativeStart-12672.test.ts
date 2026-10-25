// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectui#12672 — the start node's sweep and cadence gates, table half.
 *
 * `resolveFlowTriggerKind` (`@objectstack/spec/automation`) is the one reader
 * of a flow's trigger kind, and the engine binds through it. It makes a start
 * node a time-relative sweep by the PRESENCE of `config.timeRelative`, and a
 * schedule flow by `config.schedule` or a flow-level `type: 'schedule'` — never
 * by a `triggerType` token. The sweep fields and the cron field were gated on
 * that token alone, so the canonical node, which stores none, had every stored
 * sweep value flagged "kept, not in effect" over a live trigger.
 *
 * These pins ask the resolver for each shape rather than restating its
 * precedence, so a spec that moves the precedence moves the expected answer
 * with it.
 *
 * What the author SEES is pinned in
 * `FlowNodeInspector.timeRelativeStart-12672.test.tsx`.
 */

import { describe, it, expect } from 'vitest';
import { FLOW_TRIGGER_KINDS, resolveFlowTriggerKind } from '@objectstack/spec/automation';
import {
  fieldsForNodeType,
  isFieldVisible,
  inactiveRetainedKind,
  unsetTriggerReading,
  type FlowConfigField,
} from './flow-node-config';

const fields = fieldsForNodeType('start');
const byId = (id: string): FlowConfigField => {
  const f = fields.find((x) => x.id === id);
  expect(f, `start field ${id} exists`).toBeDefined();
  return f as FlowConfigField;
};

const SWEEP_IDS = [
  'timeRelative.object',
  'timeRelative.dateField',
  'timeRelative.withinDays',
  'timeRelative.offsetDays',
  'timeRelative.filter',
  'timeRelative.maxRecords',
];

/** A descriptor holding a value under EVERY sweep field, so each one is "stored". */
const FULL_SWEEP = {
  object: 'showcase_task',
  dateField: 'due_date',
  withinDays: 7,
  offsetDays: [3, 1],
  filter: { status: { $ne: 'done' } },
  maxRecords: 50,
};
const CRON = { type: 'cron', expression: '0 7 * * *' };

/** A one-node flow of `type` whose start node carries `config`. */
function flowWith(config: Record<string, unknown>, type = 'autolaunched') {
  return { name: 'f', type, nodes: [{ id: 'start', type: 'start', config }], edges: [] };
}

/**
 * Start shapes covering every precedence step the resolver takes: no token, a
 * `record-*` token (which outranks a descriptor), and the tokens it never reads
 * (`schedule`, `time_relative`, `manual`) or reads last (`api`).
 */
const SHAPES: Array<{ name: string; flow: ReturnType<typeof flowWith> }> = [
  { name: 'canonical sweep, no token', flow: flowWith({ timeRelative: FULL_SWEEP }, 'schedule') },
  { name: 'sweep with cadence, no token', flow: flowWith({ timeRelative: FULL_SWEEP, schedule: CRON }, 'schedule') },
  { name: 'canonical schedule, no token', flow: flowWith({ schedule: CRON }, 'schedule') },
  { name: 'cadence on an autolaunched flow, no token', flow: flowWith({ schedule: CRON }) },
  { name: 'record token beside a leftover sweep', flow: flowWith({ triggerType: 'record-after-update', objectName: 'x', timeRelative: FULL_SWEEP, schedule: CRON }, 'record_change') },
  { name: 'schedule token beside a sweep', flow: flowWith({ triggerType: 'schedule', timeRelative: FULL_SWEEP, schedule: CRON }, 'schedule') },
  { name: 'manual token beside a sweep', flow: flowWith({ triggerType: 'manual', timeRelative: FULL_SWEEP }) },
  { name: 'api token beside a sweep', flow: flowWith({ triggerType: 'api', timeRelative: FULL_SWEEP }, 'api') },
  { name: 'manual token beside a cadence', flow: flowWith({ triggerType: 'manual', schedule: CRON }) },
];

describe('a stored sweep value is "not in effect" exactly when the spec binds no sweep (objectui#12672)', () => {
  for (const { name, flow } of SHAPES.filter(({ flow }) => 'timeRelative' in flow.nodes[0].config)) {
    it(name, () => {
      const kind = resolveFlowTriggerKind(flow);
      const node = flow.nodes[0];
      for (const id of SWEEP_IDS) {
        const verdict = inactiveRetainedKind(byId(id), node, fields, kind);
        if (kind === 'time_relative') expect(verdict, `${id} under ${kind}`).toBeNull();
        else expect(verdict, `${id} under ${kind}`).toBe('controller-off');
      }
    });
  }

  it('the matrix reaches both answers (the loop above is not one-sided)', () => {
    const kinds = SHAPES.filter(({ flow }) => 'timeRelative' in flow.nodes[0].config).map(({ flow }) => resolveFlowTriggerKind(flow));
    expect(kinds).toContain('time_relative');
    expect(kinds).toContain('record_change');
  });
});

describe('a stored cron is "not in effect" exactly when the spec binds no time trigger (objectui#12672)', () => {
  const cron = byId('schedule.expression');

  for (const { name, flow } of SHAPES.filter(({ flow }) => 'schedule' in flow.nodes[0].config)) {
    it(name, () => {
      const kind = resolveFlowTriggerKind(flow);
      const node = flow.nodes[0];
      const verdict = inactiveRetainedKind(cron, node, fields, kind);
      if (kind === 'schedule' || kind === 'time_relative') expect(verdict, String(kind)).toBeNull();
      else expect(verdict, String(kind)).toBe('controller-off');
    });
  }
});

describe('a stored entry condition is in effect on every start node the spec binds (objectui#12672)', () => {
  // The engine evaluates the start node's `condition` itself for every trigger
  // type, so whatever kind the spec resolves, the predicate gates the run.
  const condition = byId('condition');

  for (const { name, flow } of SHAPES) {
    it(name, () => {
      const kind = resolveFlowTriggerKind(flow);
      expect(kind, 'every shape here resolves to a kind').toBeDefined();
      const node = { ...flow.nodes[0], config: { ...flow.nodes[0].config, condition: 'status != "done"' } };
      expect(inactiveRetainedKind(condition, node, fields, kind), String(kind)).toBeNull();
    });
  }

  it('offered empty on a sweep the spec resolves, as on a node whose select asks for one', () => {
    const canonical = flowWith({ timeRelative: { object: 'showcase_task' } }, 'schedule');
    const asked = flowWith({ triggerType: 'time_relative' });
    expect(isFieldVisible(condition, canonical.nodes[0], fields, resolveFlowTriggerKind(canonical))).toBe(true);
    expect(isFieldVisible(condition, asked.nodes[0], fields, resolveFlowTriggerKind(asked))).toBe(true);
  });
});

describe('the empty sweep fields are offered for a sweep, or for an author who asks for one (objectui#12672)', () => {
  it('offered on a sweep the spec resolves, with no token stored', () => {
    const flow = flowWith({ timeRelative: { object: 'showcase_task' } }, 'schedule');
    const kind = resolveFlowTriggerKind(flow);
    expect(kind).toBe('time_relative');
    expect(isFieldVisible(byId('timeRelative.withinDays'), flow.nodes[0], fields, kind)).toBe(true);
  });

  it('offered when the author picks the time-relative option before the descriptor exists', () => {
    // The select's token is not what the spec reads — it resolves no sweep here —
    // so this is the `showWhen` leg alone.
    const flow = flowWith({ triggerType: 'time_relative' });
    const kind = resolveFlowTriggerKind(flow);
    expect(kind).not.toBe('time_relative');
    for (const id of SWEEP_IDS) expect(isFieldVisible(byId(id), flow.nodes[0], fields, kind), id).toBe(true);
  });

  it('not offered on a schedule flow, nor on a record trigger, that asks for no sweep', () => {
    for (const flow of [flowWith({ schedule: CRON }, 'schedule'), flowWith({ triggerType: 'record-after-update', objectName: 'x' }, 'record_change')]) {
      const kind = resolveFlowTriggerKind(flow);
      for (const id of SWEEP_IDS) expect(isFieldVisible(byId(id), flow.nodes[0], fields, kind), `${id} ${kind}`).toBe(false);
    }
  });
});

describe('the Trigger select reads the resolved kind while it stores nothing (objectui#12672)', () => {
  const trigger = byId('triggerType');

  it('reads the option named by every kind a start node can resolve to without a token', () => {
    // `record_change` resolves only from a stored `record-*` token, so every
    // OTHER kind is one a token-less start node can resolve to — and each must
    // have an option to read, or the select draws `—` over a bound trigger.
    const tokenless = FLOW_TRIGGER_KINDS.filter((k) => k !== 'record_change');
    expect(tokenless.length).toBeGreaterThan(0);
    for (const kind of tokenless) {
      expect(unsetTriggerReading(trigger, { id: 'start', type: 'start', config: {} }, kind), kind).toBe(kind);
    }
  });

  it('reads nothing once a token is stored, for a flow with no kind, or for a kind it offers no option for', () => {
    const start = (config: Record<string, unknown>) => ({ id: 'start', type: 'start', config });
    expect(unsetTriggerReading(trigger, start({ triggerType: 'manual', timeRelative: FULL_SWEEP }), 'time_relative')).toBeUndefined();
    expect(unsetTriggerReading(trigger, start({}), undefined)).toBeUndefined();
    expect(unsetTriggerReading(trigger, start({}), 'record_change')).toBeUndefined();
    // Control: the same unset node with a kind DOES read.
    expect(unsetTriggerReading(trigger, start({}), 'time_relative')).toBe('time_relative');
  });

  it('is a reading of the Trigger select only', () => {
    expect(unsetTriggerReading(byId('objectName'), { id: 'start', type: 'start', config: {} }, 'time_relative')).toBeUndefined();
  });
});

describe('a field gated on both the kind and the select is admitted by either (objectui#12672)', () => {
  const both: FlowConfigField = {
    id: 'probe',
    path: ['config', 'probe'],
    label: 'Probe',
    kind: 'text',
    flowKind: ['time_relative'],
    showWhen: { field: 'triggerType', equals: ['time_relative'] },
  };
  const node = (config: Record<string, unknown>) => ({ id: 'start', type: 'start', config });

  it('admitted by the kind alone, by the select alone, and by neither not at all', () => {
    expect(isFieldVisible(both, node({}), fields, 'time_relative')).toBe(true);
    expect(isFieldVisible(both, node({ triggerType: 'time_relative' }), fields, 'schedule')).toBe(true);
    expect(isFieldVisible(both, node({ triggerType: 'schedule' }), fields, 'schedule')).toBe(false);
    expect(isFieldVisible(both, node({}), fields, undefined)).toBe(false);
  });

  it('a kind-only field still needs the kind (the secret gate is unchanged)', () => {
    const secret = byId('secret');
    expect(isFieldVisible(secret, node({}), fields, 'api')).toBe(true);
    expect(isFieldVisible(secret, node({}), fields, 'time_relative')).toBe(false);
    expect(isFieldVisible(secret, node({}), fields)).toBe(false);
  });
});
