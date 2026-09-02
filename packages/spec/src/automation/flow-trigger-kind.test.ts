// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';
import { FLOW_TRIGGER_KINDS, resolveFlowTriggerKind } from './flow-trigger-kind';

// `resolveFlowTriggerKind` is the authoring-time mirror of the automation
// engine's `resolveTriggerBinding` chain (kind only). These pins hold it to
// that chain — the reads, the precedence, and the one documented divergence —
// because two authoring surfaces (`defineStack`'s trigger-capability refusal
// and lint's `validate-flow-trigger-readiness`) answer "does this flow
// auto-launch?" through it.

function flow(type: string, config?: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return {
    name: 'f',
    label: 'F',
    type,
    nodes: [
      { id: 'start', type: 'start', label: 'Start', ...(config ? { config } : {}) },
      { id: 'end', type: 'end', label: 'End' },
    ],
    edges: [{ id: 'e1', source: 'start', target: 'end' }],
    ...extra,
  };
}

describe('resolveFlowTriggerKind — the engine binding chain, kind only', () => {
  it("record_change: a string triggerType starting with 'record-', whatever the flow's type says", () => {
    expect(resolveFlowTriggerKind(flow('record_change', { objectName: 'task', triggerType: 'record-after-update' })))
      .toBe('record_change');
    expect(resolveFlowTriggerKind(flow('autolaunched', { objectName: 'task', triggerType: 'record-after-create' })))
      .toBe('record_change');
    expect(resolveFlowTriggerKind(flow('record_change', { objectName: 'task', triggerType: 'record-before-write' })))
      .toBe('record_change');
  });

  it('time_relative: an object descriptor — and it outranks a sibling schedule cadence (the sweep interval)', () => {
    const descriptor = { object: 'contract', dateField: 'end_date', offsetDays: [30, 7] };
    expect(resolveFlowTriggerKind(flow('schedule', { timeRelative: descriptor }))).toBe('time_relative');
    expect(resolveFlowTriggerKind(flow('schedule', { timeRelative: descriptor, schedule: '0 8 * * *' })))
      .toBe('time_relative');
    // `typeof … === 'object'` is the engine's routing predicate, character for
    // character: an array or a Date IS routed to the sweep (and refused there
    // by TimeRelativeTriggerSchema); a scalar is not routed anywhere.
    expect(resolveFlowTriggerKind(flow('schedule', { timeRelative: [] }))).toBe('time_relative');
    expect(resolveFlowTriggerKind(flow('autolaunched', { timeRelative: 'daily' }))).toBeUndefined();
  });

  it('schedule: a config.schedule cadence, or type schedule with no start config at all', () => {
    expect(resolveFlowTriggerKind(flow('schedule', { schedule: '0 8 * * *' }))).toBe('schedule');
    expect(resolveFlowTriggerKind(flow('schedule', { schedule: { type: 'interval', every: '5m' } }))).toBe('schedule');
    expect(resolveFlowTriggerKind(flow('autolaunched', { schedule: '0 8 * * *' }))).toBe('schedule');
    expect(resolveFlowTriggerKind(flow('schedule'))).toBe('schedule');
  });

  it("api: type api, or a start node whose triggerType is 'api'", () => {
    expect(resolveFlowTriggerKind(flow('api'))).toBe('api');
    expect(resolveFlowTriggerKind(flow('autolaunched', { triggerType: 'api' }))).toBe('api');
  });

  it('undefined: screen flows, autolaunched-by-hand flows, and anything that is not a flow shape', () => {
    expect(resolveFlowTriggerKind(flow('screen'))).toBeUndefined();
    expect(resolveFlowTriggerKind(flow('autolaunched'))).toBeUndefined();
    expect(resolveFlowTriggerKind(flow('autolaunched', { objectName: 'task' }))).toBeUndefined();
    // A `type: 'record_change'` flow with an off-grammar token falls off the end
    // of the chain exactly as it does in the engine (lint 1f names that one).
    expect(resolveFlowTriggerKind(flow('record_change', { objectName: 'task', triggerType: 'onCreate' })))
      .toBeUndefined();
    expect(resolveFlowTriggerKind({ name: 'no_nodes', type: 'record_change' })).toBeUndefined();
    expect(resolveFlowTriggerKind(undefined)).toBeUndefined();
    expect(resolveFlowTriggerKind(null)).toBeUndefined();
    expect(resolveFlowTriggerKind('record_change')).toBeUndefined();
    expect(resolveFlowTriggerKind({ type: 'schedule', nodes: 'not-an-array' })).toBe('schedule');
  });

  it('the ARRAY form of triggerType resolves to no kind — the documented divergence from the engine', () => {
    // Unsupported (#3457). The engine routes it to the record-change trigger
    // only so that trigger can refuse it loudly at bind time; lint reports the
    // shape itself as an error. Neither authoring surface should read it as a
    // flow that asks for (and could use) a trigger.
    expect(resolveFlowTriggerKind(flow('record_change', {
      objectName: 'task', triggerType: ['record-after-create', 'record-after-delete'],
    }))).toBeUndefined();
    // …unless the same start node ALSO carries a trigger the chain does read.
    expect(resolveFlowTriggerKind(flow('record_change', {
      objectName: 'task', triggerType: ['record-after-create'], schedule: '0 8 * * *',
    }))).toBe('schedule');
  });

  it('reads the FIRST start node, like the engine', () => {
    const f = {
      type: 'autolaunched',
      nodes: [
        { id: 'a', type: 'start', label: 'A', config: { schedule: '0 8 * * *' } },
        { id: 'b', type: 'start', label: 'B', config: { objectName: 'task', triggerType: 'record-after-create' } },
      ],
    };
    expect(resolveFlowTriggerKind(f)).toBe('schedule');
  });

  it('FLOW_TRIGGER_KINDS lists exactly the answers, in precedence order, and is frozen', () => {
    expect([...FLOW_TRIGGER_KINDS]).toEqual(['record_change', 'time_relative', 'schedule', 'api']);
    expect(Object.isFrozen(FLOW_TRIGGER_KINDS)).toBe(true);
  });
});
