// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23965] `showcase_approver_bindings` is a DESIGNER specimen: it loads, and
 * it is never armed.
 *
 * Its approval nodes carry empty values over directory kinds a fresh org has
 * no rows for, so an armed copy resolves to nobody — and, under
 * `onEmptyApprovers: 'admin_rescue'`, every Field Zoo update starts a run that
 * parks a pending approval request on the org administrators. It used to ship
 * as `status: 'draft'` on the belief that draft keeps a flow out of the
 * runtime. It does not: the engine disables a flow on `obsolete` / `invalid`
 * only, and binds a draft flow exactly like an `active` one.
 *
 * This is an ENGINE reading, not a reading of the `status` literal. A literal
 * check stays green on any spelling, including one the engine happens not to
 * disable, which is exactly how `draft` shipped. So the shipped definition —
 * the module's own export, which the first case proves is the very object
 * `allFlows` loads, not a copy — is registered on
 * a real `AutomationEngine` with a recording `record_change` trigger standing
 * in for `@objectstack/trigger-record-change` (whose `start()` is what
 * subscribes a flow to the object's write hooks), and the pin asserts what the
 * engine did with it:
 *
 *   - it still LOADS: the engine holds the definition and lists it, which is
 *     what the metadata door and the designer read;
 *   - it is NOT ARMED: the trigger was never handed a binding for it, so an
 *     update to `showcase_field_zoo` has nothing to call;
 *   - a direct start is refused with `FLOW_DISABLED` and records no run.
 *
 * The positive control registers the SAME definition under `draft` and must
 * see it bound to `showcase_field_zoo` / `record-after-update`. Without it, a
 * harness whose trigger never binds anything would green every assertion here.
 */

import { describe, it, expect } from 'vitest';
import { AutomationEngine } from '@objectstack/service-automation';
import type { FlowTrigger, FlowTriggerBinding } from '@objectstack/service-automation';

import { ApproverBindingsFlow } from '../src/automation/flows/approver-bindings.flow.js';
import { allFlows } from '../src/automation/flows/index.js';

const SPECIMEN = 'showcase_approver_bindings';

function silentLogger(): any {
  const logger: any = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
  logger.child = () => logger;
  return logger;
}

/** A `record_change` trigger that records every binding the engine hands it. */
function recordingRecordChangeTrigger() {
  const started: FlowTriggerBinding[] = [];
  const trigger: FlowTrigger = {
    type: 'record_change',
    start(binding) {
      started.push(binding);
    },
    stop() {},
  };
  return { trigger, started };
}

function engineWithTrigger() {
  const engine = new AutomationEngine(silentLogger());
  const rec = recordingRecordChangeTrigger();
  engine.registerTrigger(rec.trigger);
  return { engine, started: rec.started };
}

describe('#23965 — showcase_approver_bindings loads but is never armed', () => {
  it('is part of the app, so the designer has it to open', () => {
    expect(ApproverBindingsFlow.name).toBe(SPECIMEN);
    expect(allFlows).toContain(ApproverBindingsFlow);
  });

  it('positive control: the same definition under `draft` IS bound to Field Zoo updates', () => {
    const { engine, started } = engineWithTrigger();
    const control = `${SPECIMEN}_draft_control`;
    engine.registerFlow(control, { ...ApproverBindingsFlow, name: control, status: 'draft' } as never);

    expect(started.map((b) => ({ flowName: b.flowName, object: b.object, event: b.event }))).toEqual([
      { flowName: control, object: 'showcase_field_zoo', event: 'record-after-update' },
    ]);
  });

  it('the shipped definition registers and lists, but is handed to no trigger', async () => {
    const { engine, started } = engineWithTrigger();
    engine.registerFlow(SPECIMEN, ApproverBindingsFlow as never);

    // Loads: the engine holds and lists it.
    expect(await engine.listFlows()).toContain(SPECIMEN);
    expect(await engine.getFlow(SPECIMEN)).not.toBeNull();

    // Not armed: no binding reached the record-change trigger, so a Field Zoo
    // update has no callback to run it through.
    expect(started.map((b) => b.flowName)).not.toContain(SPECIMEN);
    expect(engine.getActiveTriggerBindings().map((b) => b.flowName)).not.toContain(SPECIMEN);

    const state = engine.getFlowRuntimeStates().find((s) => s.name === SPECIMEN);
    expect(state).toMatchObject({ enabled: false, bound: false, status: 'obsolete' });
  });

  it('a direct start is refused with FLOW_DISABLED and records no run', async () => {
    const { engine } = engineWithTrigger();
    engine.registerFlow(SPECIMEN, ApproverBindingsFlow as never);

    const result = await engine.execute(SPECIMEN);
    expect(result).toMatchObject({ success: false, code: 'FLOW_DISABLED' });
    expect(await engine.listRuns(SPECIMEN)).toEqual([]);
  });
});
