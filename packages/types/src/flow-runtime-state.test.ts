// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';
import { FLOW_RUNTIME_STATE_KEY, flowRuntimeStateOf } from './flow-runtime-state.js';

describe('[#36856] flowRuntimeStateOf reads a flow\'s switch off the engine\'s status reading', () => {
  const engine = (rows: unknown) => ({ getFlowRuntimeStates: () => rows });

  it('the one row for the name answers its enabled bit, switched off included', () => {
    const rows = [
      { name: 'opportunity_approval', enabled: false, bound: true, status: 'active' },
      { name: 'lead_intake', enabled: true, bound: true },
    ];
    expect(flowRuntimeStateOf(engine(rows), 'opportunity_approval')).toEqual({ enabled: false });
    expect(flowRuntimeStateOf(engine(rows), 'lead_intake')).toEqual({ enabled: true });
  });

  it('answers unknown, never enabled, where the reading cannot name one row', () => {
    const two = [{ name: 'shared', enabled: false }, { name: 'shared', enabled: true }];
    expect(flowRuntimeStateOf(engine(two), 'shared')).toBeUndefined();
    expect(flowRuntimeStateOf(engine([{ name: 'other', enabled: false }]), 'shared')).toBeUndefined();
    expect(flowRuntimeStateOf(engine([{ name: 'shared' }]), 'shared')).toBeUndefined();
    expect(flowRuntimeStateOf(engine('not rows'), 'shared')).toBeUndefined();
    expect(flowRuntimeStateOf({ getFlowRuntimeStates: () => { throw new Error('down'); } }, 'shared')).toBeUndefined();
    expect(flowRuntimeStateOf({}, 'shared')).toBeUndefined();
    expect(flowRuntimeStateOf(undefined, 'shared')).toBeUndefined();
  });

  it('calls the reading on its service, as a method', () => {
    const service = {
      rows: [{ name: 'f', enabled: false }],
      getFlowRuntimeStates(this: { rows: unknown[] }) { return this.rows; },
    };
    expect(flowRuntimeStateOf(service, 'f')).toEqual({ enabled: false });
  });

  it('the answer key is runtimeState', () => {
    expect(FLOW_RUNTIME_STATE_KEY).toBe('runtimeState');
  });
});
