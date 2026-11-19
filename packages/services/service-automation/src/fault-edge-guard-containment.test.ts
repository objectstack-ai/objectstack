// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeEach } from 'vitest';
import { AutomationEngine } from './engine.js';
import { registerCrudNodes } from './builtin/crud-nodes.js';

/**
 * #3863 — a `fault` edge routes a node failure to a handler instead of aborting
 * the run. That is the right primitive for the world not cooperating: an `http`
 * node that 404s, a query that matched nothing, a connector that rate-limited.
 *
 * It must NOT be the escape hatch for a GUARD. The refuse-to-execute family —
 * #3810 (interpolation erased a filter condition), #3425 (a readonly write is a
 * certain no-op), ADR-0049/#1888 (a scheduled run is unscoped) — reports "the
 * metadata is wrong", not "the operation failed". Routing those would hand every
 * author (and every AI authoring loop) a one-edge switch that silently disables
 * the platform's data-safety guarantees: attach a fault edge to a
 * `delete_record`, and #3810's protection against emptying the object is gone
 * while the run still reports success.
 *
 * So failures carry a CLASS. `runtime` failures are routable; `guard` failures
 * stay fatal, fault edge or not, and the run fails with the guard's own message.
 */

function createTestLogger(): any {
    return { info: () => {}, warn: () => {}, error: () => {}, debug: () => {}, child: () => createTestLogger() };
}

/** A data engine stub that records whether a destructive verb was ever reached. */
function fakeData() {
    const seen: { deleted: boolean; where?: unknown } = { deleted: false };
    const service = {
        find: async () => [],
        findOne: async () => null,
        update: async () => ({ modified: 0 }),
        delete: async (_o: string, o: any) => {
            seen.deleted = true;
            seen.where = o?.where;
            return { deleted: 1 };
        },
        getObject: () => ({ name: 'deal', fields: {} }),
    };
    return { service, seen };
}

function ctxWith(data: any): any {
    return {
        logger: createTestLogger(),
        getService(name: string) {
            return name === 'data' ? data : undefined;
        },
    };
}

describe('#3863 — a fault edge must not swallow a guard refusal', () => {
    let engine: AutomationEngine;
    let data: ReturnType<typeof fakeData>;

    beforeEach(() => {
        engine = new AutomationEngine(createTestLogger());
        data = fakeData();
        registerCrudNodes(engine, ctxWith(data.service));
    });

    /**
     * The exact shape #3810 exists to stop, with a fault edge bolted on: the
     * only condition's operand evaluates to nothing — the record carries no
     * `manager`, so the guarded read answers `null` — and the filter would
     * match every row in the object. ([#19939, stage S6] It was a
     * `{record.ownr}` typo that interpolated to nothing; a flow token at a
     * filter operand is refused by the contract parse now, and the guard holds
     * for an operand envelope.)
     */
    function guardedDeleteWithHandler() {
        return {
            name: 'guarded_delete',
            label: 'Guarded Delete',
            type: 'autolaunched' as const,
            runAs: 'system' as const,
            nodes: [
                { id: 'start', type: 'start' as const, label: 'Start' },
                {
                    id: 'op',
                    type: 'delete_record' as any,
                    label: 'Delete',
                    config: { objectName: 'deal', filter: { owner: { dialect: 'cel', source: 'has(record.manager) ? record.manager : null' } } },
                },
                { id: 'handler', type: 'script' as any, label: 'Handler', config: { function: 'noop' } },
                { id: 'end', type: 'end' as const, label: 'End' },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'op' },
                { id: 'e2', source: 'op', target: 'end' },
                { id: 'e_fault', source: 'op', target: 'handler', type: 'fault' as const },
                { id: 'e3', source: 'handler', target: 'end' },
            ],
        };
    }

    it('a guard refusal stays fatal even when a fault edge is declared', async () => {
        let handlerRan = false;
        engine.registerNodeExecutor({
            type: 'script',
            async execute() {
                handlerRan = true;
                return { success: true };
            },
        });
        engine.registerFlow('guarded_delete', guardedDeleteWithHandler());

        const result = await engine.execute('guarded_delete', {
            record: { id: 'r1', owner: 'usr_7' },
        } as any);

        // The run must FAIL, and it must fail with the guard's own diagnosis —
        // not be quietly rerouted into the handler.
        expect(result.success).toBe(false);
        expect(result.error).toContain('delete_record');
        expect(handlerRan).toBe(false);
        // And above all: nothing was deleted.
        expect(data.seen.deleted).toBe(false);
    });

    it('a runtime failure on the same node still routes to the handler', async () => {
        // Same flow shape, but the node fails for a reason the world caused
        // rather than a defect in the metadata. This is what fault edges are for,
        // and it must keep working — the fix is a split, not a removal.
        let handlerRan = false;
        engine.registerNodeExecutor({
            type: 'script',
            async execute(node) {
                if (node.id === 'risky') return { success: false, error: 'upstream 503' };
                handlerRan = true;
                return { success: true };
            },
        });
        engine.registerFlow('runtime_fail', {
            name: 'runtime_fail',
            label: 'Runtime Fail',
            type: 'autolaunched',
            nodes: [
                { id: 'start', type: 'start', label: 'Start' },
                { id: 'risky', type: 'script' as any, label: 'Risky', config: { function: 'noop' } },
                { id: 'handler', type: 'script' as any, label: 'Handler', config: { function: 'noop' } },
                { id: 'end', type: 'end', label: 'End' },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'risky' },
                { id: 'e2', source: 'risky', target: 'end' },
                { id: 'e_fault', source: 'risky', target: 'handler', type: 'fault' },
                { id: 'e3', source: 'handler', target: 'end' },
            ],
        });

        const result = await engine.execute('runtime_fail');
        expect(result.success).toBe(true);
        expect(handlerRan).toBe(true);
    });

    it('a THROWN guard refusal is un-routable too (ADR-0049 unscoped run)', async () => {
        // The #3810 guard RETURNS its refusal; the ADR-0049/#1888 scoping guard
        // THROWS one. Both must be contained, or the catch path becomes the
        // bypass the return path no longer is. `runAs` is left at the default
        // 'user' with no trigger user, which is exactly the unscoped case.
        let handlerRan = false;
        engine.registerNodeExecutor({
            type: 'script',
            async execute() {
                handlerRan = true;
                return { success: true };
            },
        });
        engine.registerFlow('unscoped_delete', {
            name: 'unscoped_delete',
            label: 'Unscoped Delete',
            type: 'autolaunched',
            nodes: [
                { id: 'start', type: 'start', label: 'Start' },
                {
                    id: 'op',
                    type: 'delete_record' as any,
                    label: 'Delete',
                    config: { objectName: 'deal', filter: { status: 'closed' } },
                },
                { id: 'handler', type: 'script' as any, label: 'Handler', config: { function: 'noop' } },
                { id: 'end', type: 'end', label: 'End' },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'op' },
                { id: 'e2', source: 'op', target: 'end' },
                { id: 'e_fault', source: 'op', target: 'handler', type: 'fault' },
                { id: 'e3', source: 'handler', target: 'end' },
            ],
        });

        const result = await engine.execute('unscoped_delete');

        expect(result.success).toBe(false);
        expect(result.error).toContain('runAs');
        expect(handlerRan).toBe(false);
        expect(data.seen.deleted).toBe(false);
    });

    it('publishes the failing node id as {<nodeId>.error} for the handler', async () => {
        // `$error` names only the LAST failure, so a handler shared by two fault
        // edges cannot tell which node it is handling. Keying by node id makes
        // that addressable.
        let seenNodeScoped: unknown;
        let seenGlobal: unknown;
        engine.registerNodeExecutor({
            type: 'script',
            async execute(node, variables) {
                if (node.id === 'risky') return { success: false, error: 'upstream 503' };
                seenNodeScoped = variables.get('risky');
                seenGlobal = variables.get('$error');
                return { success: true };
            },
        });
        engine.registerFlow('node_scoped_error', {
            name: 'node_scoped_error',
            label: 'Node Scoped Error',
            type: 'autolaunched',
            nodes: [
                { id: 'start', type: 'start', label: 'Start' },
                { id: 'risky', type: 'script' as any, label: 'Risky', config: { function: 'noop' } },
                { id: 'handler', type: 'script' as any, label: 'Handler', config: { function: 'noop' } },
                { id: 'end', type: 'end', label: 'End' },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'risky' },
                { id: 'e2', source: 'risky', target: 'end' },
                { id: 'e_fault', source: 'risky', target: 'handler', type: 'fault' },
                { id: 'e3', source: 'handler', target: 'end' },
            ],
        });

        await engine.execute('node_scoped_error');
        expect((seenNodeScoped as any)?.error).toBe('upstream 503');
        // The pre-existing run-wide variable is unchanged — additive, not a swap.
        expect((seenGlobal as any)?.message).toBe('upstream 503');
    });

    it('records the failure on the step even when the fault branch completes', async () => {
        // #3356/#3407 lesson: a run that recovered must not read as if nothing
        // went wrong. The run succeeds, but the failed step stays in the trace.
        engine.registerNodeExecutor({
            type: 'script',
            async execute(node) {
                if (node.id === 'risky') return { success: false, error: 'upstream 503' };
                return { success: true };
            },
        });
        engine.registerFlow('traced', {
            name: 'traced',
            label: 'Traced',
            type: 'autolaunched',
            nodes: [
                { id: 'start', type: 'start', label: 'Start' },
                { id: 'risky', type: 'script' as any, label: 'Risky', config: { function: 'noop' } },
                { id: 'handler', type: 'script' as any, label: 'Handler', config: { function: 'noop' } },
                { id: 'end', type: 'end', label: 'End' },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'risky' },
                { id: 'e2', source: 'risky', target: 'end' },
                { id: 'e_fault', source: 'risky', target: 'handler', type: 'fault' },
                { id: 'e3', source: 'handler', target: 'end' },
            ],
        });

        const result = await engine.execute('traced');
        expect(result.success).toBe(true);

        const runs = await engine.listRuns('traced');
        const riskyStep = runs[0]?.steps?.find((s: any) => s.nodeId === 'risky');
        expect(riskyStep?.status).toBe('failure');
        expect(riskyStep?.error?.message).toBe('upstream 503');
    });

    it('a guard refusal without any fault edge is fatal, as before', async () => {
        const flow = guardedDeleteWithHandler();
        flow.name = 'no_handler';
        flow.edges = flow.edges.filter((e) => e.type !== 'fault');
        engine.registerFlow('no_handler', flow);

        const result = await engine.execute('no_handler', {
            record: { id: 'r1', owner: 'usr_7' },
        } as any);

        expect(result.success).toBe(false);
        expect(data.seen.deleted).toBe(false);
    });
});

/**
 * #3863 — the boundary between the two recovery mechanisms.
 *
 * Node-level: a `fault` edge, precise — it handles one node and traversal
 * continues from the handler.
 * Flow-level: `errorHandling.retry`, blunt — it re-runs the flow FROM THE START,
 * so every node that already succeeded runs a second time, side effects and all.
 *
 * They must not compound. A node whose fault edge handled it is not a flow
 * failure, so it must not also consume a retry — otherwise declaring a handler
 * would silently multiply the side effects of everything upstream of it. That
 * holds today by construction (a routed failure never propagates out of
 * `executeNode`), and this pins it so a refactor of the catch path cannot
 * quietly change it.
 */
describe('#3863 — a handled failure does not trigger flow-level retry', () => {
    it('runs the upstream node exactly once when a fault edge handles the failure', async () => {
        const engine = new AutomationEngine(createTestLogger());
        let upstreamRuns = 0;
        let handlerRuns = 0;

        engine.registerNodeExecutor({
            type: 'script',
            async execute(node) {
                if (node.id === 'upstream') { upstreamRuns++; return { success: true }; }
                if (node.id === 'risky') return { success: false, error: 'upstream 503' };
                handlerRuns++;
                return { success: true };
            },
        });
        engine.registerFlow('handled_no_retry', {
            name: 'handled_no_retry',
            label: 'Handled No Retry',
            type: 'autolaunched',
            errorHandling: { strategy: 'retry', maxRetries: 3, backoffMs: 1 },
            nodes: [
                { id: 'start', type: 'start', label: 'Start' },
                { id: 'upstream', type: 'script' as any, label: 'Upstream', config: { function: 'noop' } },
                { id: 'risky', type: 'script' as any, label: 'Risky', config: { function: 'noop' } },
                { id: 'handler', type: 'script' as any, label: 'Handler', config: { function: 'noop' } },
                { id: 'end', type: 'end', label: 'End' },
            ],
            edges: [
                { id: 'e0', source: 'start', target: 'upstream' },
                { id: 'e1', source: 'upstream', target: 'risky' },
                { id: 'e2', source: 'risky', target: 'end' },
                { id: 'e_fault', source: 'risky', target: 'handler', type: 'fault' },
                { id: 'e3', source: 'handler', target: 'end' },
            ],
        } as any);

        const result = await engine.execute('handled_no_retry');

        expect(result.success).toBe(true);
        expect(handlerRuns).toBe(1);
        // The point: retry is configured and was NOT consumed. If a handled
        // failure counted as a flow failure, `upstream` would have run again.
        expect(upstreamRuns).toBe(1);
    });
});

/**
 * A node whose type no installed plugin provides — an `approval` node on a
 * deployment without the approvals plugin — fails with `NO_EXECUTOR`. That is
 * a node failure like any other, so a declared `fault` edge routes it: the
 * author's graceful path (notify, fall back, set the record back) runs instead
 * of the run failing with nobody told. With no `fault` edge the run fails
 * exactly as it always has, and `start`'s no-executor path is untouched.
 */
describe('a node with no installed executor is graded like any other node failure', () => {
    const NO_EXECUTOR_MESSAGE = "No executor registered for node type 'approval'";

    function approvalFlow(name: string, withFault: boolean) {
        return {
            name,
            label: name,
            type: 'autolaunched' as const,
            nodes: [
                { id: 'start', type: 'start' as const, label: 'Start' },
                { id: 'signoff', type: 'approval' as any, label: 'Sign-off', config: { approvers: [{ type: 'user', value: 'u1' }] } },
                { id: 'handler', type: 'script' as any, label: 'Handler', config: { function: 'noop' } },
                { id: 'end', type: 'end' as const, label: 'End' },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'signoff' },
                { id: 'e2', source: 'signoff', target: 'end' },
                ...(withFault ? [{ id: 'e_fault', source: 'signoff', target: 'handler', type: 'fault' as const }] : []),
                { id: 'e3', source: 'handler', target: 'end' },
            ],
        };
    }

    function engineWithHandler() {
        const engine = new AutomationEngine(createTestLogger());
        const seen: { handlerRuns: number; error?: unknown; nodeScoped?: unknown } = { handlerRuns: 0 };
        engine.registerNodeExecutor({
            type: 'script',
            async execute(_node, variables) {
                seen.handlerRuns++;
                seen.error = variables.get('$error');
                seen.nodeScoped = variables.get('signoff');
                return { success: true };
            },
        });
        return { engine, seen };
    }

    it('routes a declared fault edge, and the handler reads $error.code NO_EXECUTOR', async () => {
        const { engine, seen } = engineWithHandler();
        engine.registerFlow('approval_with_fault', approvalFlow('approval_with_fault', true));

        const result = await engine.execute('approval_with_fault');

        expect(result.success).toBe(true);
        expect(seen.handlerRuns).toBe(1);
        expect(seen.error).toEqual({ nodeId: 'signoff', message: NO_EXECUTOR_MESSAGE, code: 'NO_EXECUTOR' });
        expect((seen.nodeScoped as { error?: unknown } | undefined)?.error).toBe(NO_EXECUTOR_MESSAGE);
    });

    it('keeps the NO_EXECUTOR failure step in the run record when the fault branch completes', async () => {
        const { engine } = engineWithHandler();
        engine.registerFlow('approval_traced', approvalFlow('approval_traced', true));

        await engine.execute('approval_traced');

        const runs = await engine.listRuns('approval_traced');
        const steps = runs[0]?.steps ?? [];
        const signoff = steps.filter((s: any) => s.nodeId === 'signoff');
        expect(signoff).toHaveLength(1);
        expect(signoff[0]?.status).toBe('failure');
        expect(signoff[0]?.error).toEqual({ code: 'NO_EXECUTOR', message: NO_EXECUTOR_MESSAGE });
        expect(steps.map((s: any) => [s.nodeId, s.status])).toEqual([
            ['start', 'success'],
            ['signoff', 'failure'],
            ['handler', 'success'],
        ]);
    });

    it('CONTROL — with no fault edge the run fails exactly as before', async () => {
        const { engine, seen } = engineWithHandler();
        engine.registerFlow('approval_no_fault', approvalFlow('approval_no_fault', false));

        const result = await engine.execute('approval_no_fault');

        expect(result.success).toBe(false);
        expect(result.status).toBe('failed');
        expect(result.error).toBe(NO_EXECUTOR_MESSAGE);
        expect(seen.handlerRuns).toBe(0);
        const runs = await engine.listRuns('approval_no_fault');
        const steps = runs[0]?.steps ?? [];
        expect(steps.map((s: any) => [s.nodeId, s.status, s.error?.code])).toEqual([
            ['start', 'success', undefined],
            ['signoff', 'failure', 'NO_EXECUTOR'],
        ]);
        expect(steps[1]?.error?.message).toBe(NO_EXECUTOR_MESSAGE);
    });

    it('CONTROL — a start node with no executor still records success and the run proceeds', async () => {
        const { engine, seen } = engineWithHandler();
        engine.registerFlow('start_only', {
            name: 'start_only',
            label: 'start_only',
            type: 'autolaunched',
            nodes: [
                { id: 'start', type: 'start', label: 'Start' },
                { id: 'handler', type: 'script' as any, label: 'Handler', config: { function: 'noop' } },
                { id: 'end', type: 'end', label: 'End' },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'handler' },
                { id: 'e2', source: 'handler', target: 'end' },
            ],
        });

        const result = await engine.execute('start_only');

        expect(result.success).toBe(true);
        expect(seen.handlerRuns).toBe(1);
        expect(seen.error).toBeUndefined();
        const runs = await engine.listRuns('start_only');
        const startStep = runs[0]?.steps?.find((s: any) => s.nodeId === 'start');
        expect(startStep?.status).toBe('success');
        expect(startStep?.error).toBeUndefined();
    });

    it('CONTROL — a registered executor that throws still routes its fault edge with the thrown message', async () => {
        const { engine, seen } = engineWithHandler();
        engine.registerNodeExecutor({
            type: 'approval',
            async execute() {
                throw new Error('approval store unreachable');
            },
        });
        engine.registerFlow('approval_throws', approvalFlow('approval_throws', true));

        const result = await engine.execute('approval_throws');

        expect(result.success).toBe(true);
        expect(seen.handlerRuns).toBe(1);
        expect(seen.error).toEqual({ nodeId: 'signoff', message: 'approval store unreachable' });
        const runs = await engine.listRuns('approval_throws');
        const signoff = runs[0]?.steps?.find((s: any) => s.nodeId === 'signoff');
        expect(signoff?.error).toEqual({ code: 'EXECUTION_ERROR', message: 'approval store unreachable' });
    });
});
