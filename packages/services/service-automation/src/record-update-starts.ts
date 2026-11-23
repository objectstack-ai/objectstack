// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#35928] {@link AutomationEngine.listRecordUpdateStarts}: which flows a
 * proposed update of one record would start. The contract is
 * `IAutomationService.listRecordUpdateStarts`'s docblock
 * (`@objectstack/spec/contracts`); ruling record 7073655354 decided what is
 * served and to whom.
 *
 * Nothing here is a second reading of a live run's rules:
 *
 *  - WHICH flows can start on the write is the engine's own arming state: a
 *    flow is asked only when it is enabled and armed on a trigger
 *    (`isFlowEnabled`, `boundFlowTriggers`), of the record-change kind, on
 *    this object (`resolveTriggerBinding`, the binding the trigger was handed).
 *  - WHICH writes bind it is the spec's `recordChangeTriggerFiresOnUpdate`,
 *    the token grammar `@objectstack/trigger-record-change` binds hooks by.
 *  - WHETHER it starts is `startConditionHolds`, the ONE start-condition gate
 *    every run attempt passes, over the variables `seedRunVariables` seeds for
 *    a run (`record`, its flattened fields, `previous`).
 *  - WHETHER it starts an approval is the presence of an approval node
 *    (`APPROVAL_NODE_TYPE`, ADR-0019: an approval is a node inside a flow),
 *    in the flow or in a flow its run calls (#36322): the calls are the
 *    engine's own reading of a `subflow` / `map` node's target
 *    (`subflowTargets`, every region depth, a shared name resolved to the slot
 *    the caller's run dispatches to), and each flow reached is asked the same
 *    one approval test.
 *
 * A condition that throws (one that reads a field the record does not carry)
 * is not listed: the preview names only what it could judge to start, and the
 * confirm keeps its generic sentence beside any list it shows.
 */

import type { FlowParsed } from '@objectstack/spec/automation';
import { APPROVAL_NODE_TYPE, recordChangeTriggerFiresOnUpdate } from '@objectstack/spec/automation';
import type { AutomationContext, RecordUpdateStartsInput } from '@objectstack/spec/contracts';
import type { RecordUpdateStart } from '@objectstack/spec/api';
import { startConditionHolds } from './dag-traversal.js';
import type { AutomationEngine, FlowTriggerBinding } from './engine.js';

/** The `AutomationEngine` members the preview reads, each typed as the member itself. */
export interface RecordUpdateStartsHost {
    readonly flows: ReadonlyMap<string, FlowParsed>;
    readonly boundFlowTriggers: ReadonlyMap<string, string>;
    isFlowEnabled(name: string): boolean;
    resolveTriggerBinding(name: string): { triggerType: string; binding: FlowTriggerBinding } | undefined;
    seedRunVariables(flow: FlowParsed, flowName: string, context: AutomationContext | undefined, runId: string): Map<string, unknown>;
    evaluateCondition: AutomationEngine['evaluateCondition'];
    flowSlotName(key: string): string;
    subflowTargets: AutomationEngine['subflowTargets'];
}

/** The run id a preview's variables carry: no run exists, and none is recorded. */
const PREVIEW_RUN_ID = 'record-update-preview';

/** Whether `flow` holds an approval node, so a run of it starts an approval (ADR-0019). */
export function flowStartsApproval(flow: FlowParsed): boolean {
    return flow.nodes.some((node) => node.type === APPROVAL_NODE_TYPE);
}

/**
 * [#36322] Whether a run of the flow filed under `key` starts an approval:
 * the flow, or a flow it calls through a `subflow` / `map` node at any depth,
 * passes {@link flowStartsApproval} — the one approval test, never a second.
 * A call to a flow the engine does not hold, or holds disabled, starts no
 * child run, so it is not followed. Each flow is visited once: a flow that
 * calls itself, or a cycle of flows, ends.
 */
function flowReachesApproval(this: Pick<RecordUpdateStartsHost, 'flows' | 'isFlowEnabled' | 'subflowTargets'>, key: string): boolean {
    const visited = new Set<string>([key]);
    const pending = [key];
    while (pending.length > 0) {
        const flow = this.flows.get(pending.pop() as string);
        if (!flow) continue;
        if (flowStartsApproval(flow)) return true;
        for (const target of this.subflowTargets(flow)) {
            if (visited.has(target)) continue;
            visited.add(target);
            if (this.flows.has(target) && this.isFlowEnabled(target)) pending.push(target);
        }
    }
    return false;
}

/** The body of {@link AutomationEngine.listRecordUpdateStarts}; the contract's docblock is its contract. */
export function listRecordUpdateStarts(
    this: RecordUpdateStartsHost,
    input: RecordUpdateStartsInput,
): RecordUpdateStart[] {
    const context: AutomationContext = {
        record: input.record,
        previous: input.previous,
        object: input.object,
        event: 'afterUpdate',
        ...(typeof input.userId === 'string' && input.userId !== '' ? { userId: input.userId } : {}),
        ...(typeof input.tenantId === 'string' && input.tenantId !== '' ? { tenantId: input.tenantId } : {}),
    };
    const starts: RecordUpdateStart[] = [];
    for (const [key, flow] of this.flows) {
        if (!this.isFlowEnabled(key) || !this.boundFlowTriggers.has(key)) continue;
        const resolved = this.resolveTriggerBinding(key);
        if (resolved?.triggerType !== 'record_change') continue;
        if (resolved.binding.object !== input.object) continue;
        if (!recordChangeTriggerFiresOnUpdate(resolved.binding.event)) continue;
        const startNode = flow.nodes.find((node) => node.type === 'start');
        if (!startNode) continue;
        let holds: boolean;
        try {
            const variables = this.seedRunVariables(flow, key, context, PREVIEW_RUN_ID);
            holds = startConditionHolds.call(this, startNode, variables, context);
        } catch {
            // Not judged: a condition that cannot be evaluated against this
            // record is not named as starting (see the module note).
            holds = false;
        }
        if (!holds) continue;
        // `label` is required by `FlowSchema`, so every registered flow carries one.
        starts.push({ name: this.flowSlotName(key), label: flow.label, startsApproval: flowReachesApproval.call(this, key) });
    }
    return starts;
}
