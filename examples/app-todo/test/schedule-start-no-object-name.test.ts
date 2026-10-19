// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#24067] No schedule flow this example ships stores `objectName` on its
 * start node.
 *
 * A schedule binding carries no object. `AutomationEngine.deriveTriggerBinding`
 * lifts the start node's `config.objectName` into the record-change binding
 * (and, as a fallback behind `timeRelative.object`, into the time-relative
 * one); its `schedule` branch hands the trigger `schedule` and `organization`
 * only, and `ScheduleTrigger` never reads `objectName`. On a schedule start
 * node the key is stored and never acted on, and the console's flow designer
 * labels it "kept, not in effect". An example is what an AI copies, so the
 * example must not model it: a sweep names its object where it reads, on its
 * `get_record` step, as both daily sweeps here do.
 *
 * The flows are read off the stack the example ships (its default
 * `defineStack` export), never a hand list, so a schedule flow added later is
 * covered on the day it lands. "Schedule" is the spec's
 * `resolveFlowTriggerKind` answer, the one predicate the engine binds by: a
 * time-relative sweep, whose binding DOES fall back to `objectName`, is
 * correctly left out, and every other `type: 'schedule'` flow is in.
 */

import { describe, it, expect } from 'vitest';
import { resolveFlowTriggerKind } from '@objectstack/spec/automation';

import TodoApp from '../objectstack.config.js';

type NodeLike = { id?: string; type?: string; config?: Record<string, unknown> };
type FlowLike = { name?: string; type?: string; nodes?: NodeLike[] };

const shippedFlows = ((TodoApp as unknown as { flows?: FlowLike[] }).flows ?? []);
const scheduleFlows = shippedFlows.filter((flow) => resolveFlowTriggerKind(flow) === 'schedule');

function startConfig(flow: FlowLike): Record<string, unknown> {
  const start = (flow.nodes ?? []).find((node) => node.type === 'start');
  if (!start) throw new Error(`harness: flow '${flow.name}' has no start node`);
  return start.config ?? {};
}

describe('#24067: a schedule start node carries no objectName', () => {
  it('reads real schedule flows off the shipped stack (anti-vacuity)', () => {
    expect(scheduleFlows.length).toBeGreaterThan(0);
    // Each start node read here is the one the schedule binding reads: it
    // carries the cadence that binding DOES act on.
    for (const flow of scheduleFlows) {
      expect(startConfig(flow), `flow '${flow.name}' start node`).toHaveProperty('schedule');
    }
  });

  it('no schedule flow stores objectName on its start node', () => {
    const offenders = scheduleFlows
      .filter((flow) => Object.hasOwn(startConfig(flow), 'objectName'))
      .map((flow) => `flow '${flow.name}' · start node config.objectName`);
    expect(offenders).toEqual([]);
  });
});
