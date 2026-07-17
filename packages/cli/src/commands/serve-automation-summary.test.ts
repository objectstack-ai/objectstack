// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// Startup-banner automation summary (2026-07-17 third-party eval).
//
// Flow registration and trigger binding happen entirely inside serve's
// boot-quiet stdout window, so the automation engine's own logs never reach
// the terminal — a project whose flows silently failed to arm looked exactly
// like one whose flows armed fine. `collectAutomationSummary` gathers the
// live binding facts after stdout is restored so the banner can answer
// "did my flows actually arm?" — including the three silent author mistakes:
// engine not enabled, trigger not registered, and objectName mismatch.

import { describe, it, expect } from 'vitest';
import { collectAutomationSummary } from './serve.js';

type FlowState = {
  name: string;
  enabled: boolean;
  bound: boolean;
  status?: string;
  triggerType?: string;
  object?: string;
};

function fakeKernel(services: Record<string, unknown>) {
  return {
    getService(name: string) {
      if (!(name in services)) throw new Error(`Service '${name}' not found`);
      return services[name];
    },
  };
}

function fakeAutomation(states: FlowState[], triggerTypes: string[] = ['record_change']) {
  return {
    getFlowRuntimeStates: () => states,
    getRegisteredTriggerTypes: () => triggerTypes,
    getTriggerBindingAudit: () =>
      states
        .filter((s) => s.enabled && !s.bound && s.triggerType)
        .map((s) => ({
          flowName: s.name,
          triggerType: s.triggerType!,
          reason: `no '${s.triggerType}' trigger is registered`,
        })),
  };
}

describe('collectAutomationSummary', () => {
  it('flags declared flows when the automation engine is not enabled at all', () => {
    const summary = collectAutomationSummary(fakeKernel({}), 2);
    expect(summary).toMatchObject({ enabled: false, declaredFlowCount: 2 });
  });

  it('returns undefined when there is nothing automation-related to show', () => {
    expect(collectAutomationSummary(fakeKernel({}), 0)).toBeUndefined();
  });

  it('reports bound/unbound counts and surfaces the unbound audit', () => {
    const automation = fakeAutomation([
      { name: 'wired', enabled: true, bound: true, status: 'active', triggerType: 'record_change', object: 'task' },
      { name: 'orphan', enabled: true, bound: false, status: 'active', triggerType: 'record_change', object: 'task' },
    ]);
    const summary = collectAutomationSummary(fakeKernel({ automation }), 2)!;
    expect(summary.enabled).toBe(true);
    expect(summary.flowCount).toBe(2);
    expect(summary.boundCount).toBe(1);
    expect(summary.unbound).toHaveLength(1);
    expect(summary.unbound[0].flowName).toBe('orphan');
  });

  it('flags a bound record-change flow whose target object is unknown (dead binding)', () => {
    const automation = fakeAutomation([
      { name: 'dead', enabled: true, bound: true, status: 'active', triggerType: 'record_change', object: 'candidate' },
      { name: 'alive', enabled: true, bound: true, status: 'active', triggerType: 'record_change', object: 'eval_app_candidate' },
    ]);
    const ql = { getObject: (n: string) => (n === 'eval_app_candidate' ? { name: n } : undefined) };
    const summary = collectAutomationSummary(fakeKernel({ automation, objectql: ql }), 2)!;
    expect(summary.unknownObject).toEqual([{ flowName: 'dead', object: 'candidate' }]);
  });

  it('counts enabled draft flows (draft still fires — make it visible)', () => {
    const automation = fakeAutomation([
      { name: 'd1', enabled: true, bound: true, status: 'draft', triggerType: 'record_change', object: 'task' },
      { name: 'implicit', enabled: true, bound: true, status: undefined, triggerType: 'record_change', object: 'task' },
      { name: 'a1', enabled: true, bound: true, status: 'active', triggerType: 'record_change', object: 'task' },
    ]);
    const summary = collectAutomationSummary(fakeKernel({ automation }), 3)!;
    expect(summary.draftCount).toBe(2);
  });

  it('degrades gracefully on an older engine without the audit APIs', () => {
    const automation = { getFlowRuntimeStates: () => [{ name: 'x', enabled: true, bound: true }] };
    const summary = collectAutomationSummary(fakeKernel({ automation }), 1)!;
    expect(summary.enabled).toBe(true);
    expect(summary.flowCount).toBe(1);
    expect(summary.unbound).toEqual([]);
    expect(summary.triggerTypes).toEqual([]);
  });
});
