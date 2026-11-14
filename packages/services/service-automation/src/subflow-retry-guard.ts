// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The reading behind the arming gate's subflow-retry half: does a flow that
 * runs after a record change reach, through a `subflow` / `map` node, an
 * inline outbound call that is retried?
 *
 * The record-change trigger awaits an after-trigger run inside the save's hook
 * handler, and a `subflow` / `map` node awaits its child, so the child's work
 * is on the save's path too. Ruling 6810500711, letter D: the record save
 * never waits on an external system. The after-save judge
 * (`validateAfterSaveInlineRetry` in `flow-registration-checks.ts`) refuses an
 * inline call retried in the flow's OWN graph at registration. It cannot see
 * past a `subflow` / `map` node: the child is another flow, which may register
 * after the caller, so judging it at registration would depend on load order.
 * So the engine reads it here, over the flows it holds, and
 * {@link AutomationEngine.activateFlowTrigger} declines to arm such a caller,
 * and asks again whenever a flow its calls reach changes.
 *
 * A call is "retried" when anything above it on the call chain re-runs it:
 * the caller's whole-run retry or a retrying `try_catch` around the `subflow` /
 * `map` node, or the child's (or a deeper child's) own whole-run retry or
 * retrying `try_catch`. One shared walk decides that
 * (`walkRetriedNodes`), so the gate and the after-save judge never disagree
 * on what a retry is.
 *
 * An `http` node with `durable: true` is not an inline call here, exactly as
 * in the after-save judge: the messaging HTTP outbox queues it, and where none
 * is wired a run on the save path sends it in the background (`http-nodes.ts`).
 */

import type { FlowNodeParsed, FlowParsed } from '@objectstack/spec/automation';
import { afterRecordChangeTrigger, flowRunRetry, inlineCalloutFix, walkRetriedNodes } from './flow-registration-checks.js';
import type { FlowCallKey } from './subflow-notice-guard.js';

/** An inline outbound call a `subflow` / `map` node of an after-save flow reaches, retried. */
export interface SubflowRetriedCallout {
    /** The caller's start-node `triggerType` (an after-record-change token). */
    readonly triggerType: string;
    /** The caller's `subflow` / `map` node that leads there. */
    readonly callNode: { readonly id: string; readonly type: string };
    /** The flow that node calls. */
    readonly child: string;
    /** The inline outbound call: its node and the flow that holds it. */
    readonly callout: { readonly id: string; readonly type: string; readonly flow: string };
    /** The flows from `child` to the one holding the call, both included. */
    readonly through: readonly string[];
    /** What re-runs the call, as the after-save sentences name it. */
    readonly retriedBy: string;
    /** The fix the after-save judge names for that node type. */
    readonly fix: string;
}

const sameName: FlowCallKey = (_caller, name) => name;

/** The flow a `subflow` / `map` node names, or `undefined` for any other node. */
function calledFlow(node: FlowNodeParsed): string | undefined {
    if (node.type !== 'subflow' && node.type !== 'map') return undefined;
    const name = (node.config as { flowName?: unknown } | undefined)?.flowName;
    return typeof name === 'string' ? name : undefined;
}

/**
 * The first retried inline call in the flow filed under `key`, or in a flow
 * its `subflow` / `map` nodes reach, with `outerRetry` re-running everything
 * the flow does. A flow already read with the same outer retry is not read
 * again, so a cycle of calls ends.
 */
function retriedCalloutIn(
    flows: ReadonlyMap<string, FlowParsed>,
    key: string,
    outerRetry: string | undefined,
    seen: Set<string>,
    callKey: FlowCallKey,
): Omit<SubflowRetriedCallout, 'triggerType' | 'callNode' | 'child'> | undefined {
    const seenKey = `${outerRetry === undefined ? 'free' : 'retried'}:${key}`;
    if (seen.has(seenKey)) return undefined;
    seen.add(seenKey);
    const flow = flows.get(key);
    if (!flow) return undefined;
    let found: Omit<SubflowRetriedCallout, 'triggerType' | 'callNode' | 'child'> | undefined;
    walkRetriedNodes(flow, outerRetry ?? flowRunRetry(flow), (node, _path, retriedBy) => {
        if (found) return;
        const fix = inlineCalloutFix(node);
        if (fix && retriedBy) {
            found = { callout: { id: node.id, type: node.type, flow: key }, through: [key], retriedBy, fix };
            return;
        }
        const called = calledFlow(node);
        if (called === undefined) return;
        const deeper = retriedCalloutIn(flows, callKey(key, called), retriedBy, seen, callKey);
        if (deeper) found = { ...deeper, through: [key, ...deeper.through] };
    });
    return found;
}

/**
 * The first `subflow` / `map` node of the after-save flow `name` (on the
 * top-level graph or in any region body) whose child reaches a retried inline
 * outbound call, or `undefined`: when `name` is not registered, does not run
 * after a record change, or reaches no such call.
 */
export function subflowRetriedCallout(
    flows: ReadonlyMap<string, FlowParsed>,
    name: string,
    callKey: FlowCallKey = sameName,
): SubflowRetriedCallout | undefined {
    const flow = flows.get(name);
    if (!flow) return undefined;
    const triggerType = afterRecordChangeTrigger(flow);
    if (triggerType === undefined) return undefined;
    const seen = new Set<string>([`free:${name}`]);
    let found: SubflowRetriedCallout | undefined;
    walkRetriedNodes(flow, flowRunRetry(flow), (node, _path, retriedBy) => {
        if (found) return;
        const called = calledFlow(node);
        if (called === undefined) return;
        const hit = retriedCalloutIn(flows, callKey(name, called), retriedBy, seen, callKey);
        if (hit) found = { triggerType, callNode: { id: node.id, type: node.type }, child: called, ...hit };
    });
    return found;
}

/**
 * The sentence the warn and the `/_status` reason share: the call, where the
 * retried inline call sits and what retries it, why the save would wait, and
 * the fix the after-save judge names for that node.
 */
export function describeSubflowRetriedCallout(trap: SubflowRetriedCallout): string {
    const { triggerType, callNode, child, callout, through, retriedBy, fix } = trap;
    const where = callout.flow === child
        ? `child flow '${child}'`
        : `flow '${callout.flow}' (reached through ${through.map((f) => `'${f}'`).join(' → ')})`;
    return (
        `it runs after a record change (\`${triggerType}\`), and its \`${callNode.type}\` node '${callNode.id}' ` +
        `calls '${child}', where node '${callout.id}' (\`${callout.type}\`) of ${where} calls an outside system ` +
        `inline and is retried by ${retriedBy}. The save waits for this run and the run waits for its child, so ` +
        `a failing call would hold the user's save for every attempt and every backoff delay. ${fix}`
    );
}
