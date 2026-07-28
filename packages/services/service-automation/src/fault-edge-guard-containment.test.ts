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
     * The exact shape #3810 exists to stop, with a fault edge bolted on:
     * `{record.ownr}` is a typo, so the only condition is erased and the filter
     * would collapse to `{}` — every row in the object.
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
                    config: { objectName: 'deal', filter: { owner: '{record.ownr}' } },
                },
                { id: 'handler', type: 'script' as any, label: 'Handler' },
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
                { id: 'risky', type: 'script' as any, label: 'Risky' },
                { id: 'handler', type: 'script' as any, label: 'Handler' },
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
                { id: 'handler', type: 'script' as any, label: 'Handler' },
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
                { id: 'risky', type: 'script' as any, label: 'Risky' },
                { id: 'handler', type: 'script' as any, label: 'Handler' },
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
                { id: 'risky', type: 'script' as any, label: 'Risky' },
                { id: 'handler', type: 'script' as any, label: 'Handler' },
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
            errorHandling: { strategy: 'retry', maxRetries: 3, retryDelayMs: 1 },
            nodes: [
                { id: 'start', type: 'start', label: 'Start' },
                { id: 'upstream', type: 'script' as any, label: 'Upstream' },
                { id: 'risky', type: 'script' as any, label: 'Risky' },
                { id: 'handler', type: 'script' as any, label: 'Handler' },
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
