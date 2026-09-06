// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #14955 — the run-wide `$error` must name the LAST failure, whichever way
 * that failure arrived.
 *
 * `executeNode` has two failure arms. The returned-failure arm (`!result.success`)
 * rewrites `$error` and `<nodeId>.error` unconditionally, then decides whether a
 * `fault` edge may route it. The throw arm used to do both inside `if (faultEdge)`,
 * so a thrown failure with no fault edge of its own left `$error` holding an
 * EARLIER failure's value — and a node inside a region never has a fault edge of
 * its own, because the region's synthetic sub-flow carries only the region's own
 * edges (`runRegion`).
 *
 * **The message and the code come from two different failures.** That is the
 * shape this file drives: not a variable read back in isolation, but two real
 * flows whose recovery takes a DIFFERENT EDGE depending on whether `$error` is
 * fresh — because the failure mode here is a plausible-looking wrong value, not
 * a crash, and an assertion on the value alone would not have caught it either.
 */
import { describe, it, expect } from 'vitest';
import { AutomationEngine } from './engine.js';
import type { NodeExecutor } from './engine.js';
import { registerCrudNodes } from './builtin/crud-nodes.js';
import { registerTryCatchNode } from './builtin/try-catch-node.js';
import { DuplicateRecordError } from '@objectstack/objectql';

function makeLogger(): any {
    const l: any = { info() {}, warn() {}, error() {}, debug() {} };
    l.child = () => l;
    return l;
}

const ctxWith = (data: any): any => ({
    logger: makeLogger(),
    getService: (n: string) => (n === 'data' ? data : undefined),
});

describe('#14955 — the throw arm refreshes `$error` like the returned-failure arm', () => {
    it('a thrown failure with no fault edge of its own names ITSELF on the run-wide `$error`', async () => {
        // `tc` binds its caught error to `$caught`, deliberately NOT to `$error`,
        // so the catch region reads the ENGINE's run-wide variable rather than
        // `try_catch`'s own rebuilt binding.
        const engine = new AutomationEngine(makeLogger());
        let seenError: any;
        let seenNodeScoped: any;
        const data: any = {
            async insert() {
                throw new DuplicateRecordError('lead', new Error('driver: unique violation'), 'email');
            },
        };
        registerCrudNodes(engine, ctxWith(data));
        registerTryCatchNode(engine, ctxWith(data));
        engine.registerNodeExecutor({
            type: 'store_down',
            async execute() {
                throw new Error('ECONNREFUSED: could not reach the store');
            },
        } as NodeExecutor);
        engine.registerNodeExecutor({
            type: 'probe',
            async execute(_node, variables) {
                seenError = variables.get('$error');
                seenNodeScoped = variables.get('boom');
                return { success: true };
            },
        } as NodeExecutor);
        engine.registerFlow('stale_error', {
            name: 'stale_error', label: 'Stale error', type: 'autolaunched',
            nodes: [
                { id: 'start', type: 'start', label: 'Start' },
                { id: 'a', type: 'create_record', label: 'A', config: { objectName: 'lead', fields: { email: 'a@b.com' } } },
                { id: 'recoverA', type: 'probe_noop', label: 'Recover A' },
                {
                    id: 'tc', type: 'try_catch', label: 'Guarded',
                    config: {
                        errorVariable: '$caught',
                        try: { nodes: [{ id: 'boom', type: 'store_down', label: 'Boom' }], edges: [] },
                        catch: { nodes: [{ id: 'look', type: 'probe', label: 'Look' }], edges: [] },
                    },
                },
                { id: 'end', type: 'end', label: 'End' },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'a' },
                // `a` fails as a duplicate and is fault-routed — this is what leaves
                // `DUPLICATE_RECORD` sitting on `$error` before `boom` ever runs.
                { id: 'ef', source: 'a', target: 'recoverA', type: 'fault' },
                { id: 'e2', source: 'recoverA', target: 'tc' },
                { id: 'e3', source: 'tc', target: 'end' },
            ],
        } as any);
        engine.registerNodeExecutor({ type: 'probe_noop', async execute() { return { success: true }; } } as NodeExecutor);

        await engine.execute('stale_error', { userId: 'u1' } as any);

        // The last failure was `boom`'s throw, not `a`'s duplicate.
        expect(seenError?.nodeId).toBe('boom');
        expect(seenError?.message).toContain('ECONNREFUSED');
        // `a`'s classified code must not still be sitting there.
        expect(seenError?.code).toBeUndefined();
        // `<nodeId>.error` is written on the same terms as on the returned-failure arm.
        expect(seenNodeScoped?.error).toContain('ECONNREFUSED');
    });

    it('a swallowed failure\'s code does not leak onto a LATER thrown failure in the same try region', async () => {
        // The residual the PR #14948 identity guard cannot see: that guard
        // compares `$error` against what the attempt STARTED with, so a rewrite
        // that happens INSIDE the attempt window (here: an inner `try_catch`
        // binding its own swallowed duplicate) passes the identity check, and the
        // outer container binds a `DUPLICATE_RECORD` code onto a timeout's message.
        const engine = new AutomationEngine(makeLogger());
        const ran: string[] = [];
        const seen: Array<{ code?: string; message?: string }> = [];
        let call = 0;
        const data: any = {
            async insert() {
                call++;
                if (call === 1) throw new DuplicateRecordError('lead', new Error('driver: unique violation'), 'email');
                // The store hangs — the node's own `timeoutMs` fires, which is a
                // THROW, not a returned failure.
                await new Promise(() => {});
            },
        };
        registerCrudNodes(engine, ctxWith(data));
        registerTryCatchNode(engine, ctxWith(data));
        engine.registerNodeExecutor({
            type: 'checkpoint',
            async execute(node) { ran.push(String((node.config as any)?.tag)); return { success: true }; },
        } as NodeExecutor);
        engine.registerNodeExecutor({
            type: 'swallow_duplicate_else_reraise',
            async execute(_node, variables) {
                const err = variables.get('$error') as { code?: string; message?: string } | undefined;
                seen.push({ code: err?.code, message: err?.message });
                if (err?.code === 'DUPLICATE_RECORD') { ran.push('swallowed'); return { success: true }; }
                ran.push('reraised');
                throw new Error(`re-raising: ${err?.message}`);
            },
        } as NodeExecutor);
        engine.registerFlow('nested', {
            name: 'nested', label: 'Nested', type: 'autolaunched',
            nodes: [
                { id: 'start', type: 'start', label: 'Start' },
                {
                    id: 'outer', type: 'try_catch', label: 'Outer',
                    config: {
                        try: {
                            nodes: [
                                {
                                    id: 'inner', type: 'try_catch', label: 'Inner',
                                    config: {
                                        try: { nodes: [{ id: 'mk', type: 'create_record', label: 'Create', config: { objectName: 'lead', fields: { email: 'a@b.com' } } }], edges: [] },
                                        catch: { nodes: [{ id: 'innerHandle', type: 'checkpoint', label: 'Inner handle', config: { tag: 'inner-swallowed' } }], edges: [] },
                                    },
                                },
                                { id: 'slow', type: 'create_record', label: 'Slow create', timeoutMs: 20, config: { objectName: 'lead', fields: { email: 'c@d.com' } } },
                            ],
                            edges: [{ id: 'r1', source: 'inner', target: 'slow' }],
                        },
                        catch: { nodes: [{ id: 'outerHandle', type: 'swallow_duplicate_else_reraise', label: 'Outer handle' }], edges: [] },
                    },
                },
                { id: 'after', type: 'checkpoint', label: 'After', config: { tag: 'after' } },
                { id: 'escalate', type: 'checkpoint', label: 'Escalate', config: { tag: 'escalate' } },
                { id: 'end', type: 'end', label: 'End' },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'outer' },
                { id: 'e2', source: 'outer', target: 'after' },
                { id: 'e3', source: 'outer', target: 'escalate', type: 'fault' },
                { id: 'e4', source: 'after', target: 'end' },
                { id: 'e5', source: 'escalate', target: 'end' },
            ],
        } as any);

        await engine.execute('nested', { userId: 'u1' } as any);

        // The outer handler saw a TIMEOUT, and must not have been told it was a duplicate.
        expect(seen[0]?.message).toContain('timed out');
        expect(seen[0]?.code).toBeUndefined();
        // Different edges, not just a different value: the timeout escalates.
        expect(ran).toEqual(['inner-swallowed', 'reraised', 'escalate']);
    });

    it('a THROWN guard refusal is still un-routable, refresh or no refresh (#3863)', async () => {
        // The refresh moved OUT of `if (faultEdge)`; the guard-refusal rule that
        // decides ROUTING did not move. A guard refusal that throws must still
        // abort the run with its own message and never reach the destructive
        // verb — including when an earlier fault-routed failure left a
        // recoverable-looking `$error` behind for the new unconditional write to
        // overwrite.
        //
        // The seed is a plain executor, NOT a `create_record`: this run carries
        // no trigger user (that is what arms the ADR-0049 guard below), and a
        // data node in the same run would be refused by that very guard before it
        // could seed anything.
        const engine = new AutomationEngine(makeLogger());
        const ran: string[] = [];
        const seen: { deleted: boolean } = { deleted: false };
        const data: any = {
            find: async () => [],
            findOne: async () => null,
            update: async () => ({ modified: 0 }),
            delete: async () => { seen.deleted = true; return { deleted: 1 }; },
            getObject: () => ({ name: 'deal', fields: {} }),
        };
        registerCrudNodes(engine, ctxWith(data));
        engine.registerNodeExecutor({
            type: 'fails_with_code',
            async execute() { return { success: false, error: 'upstream 503', code: 'DUPLICATE_RECORD' }; },
        } as NodeExecutor);
        engine.registerNodeExecutor({
            type: 'checkpoint',
            async execute(node) { ran.push(String((node.config as any)?.tag)); return { success: true }; },
        } as NodeExecutor);
        engine.registerFlow('guard_after_stale', {
            name: 'guard_after_stale', label: 'Guard after stale', type: 'autolaunched',
            nodes: [
                { id: 'start', type: 'start', label: 'Start' },
                { id: 'a', type: 'fails_with_code', label: 'A' },
                { id: 'recoverA', type: 'checkpoint', label: 'Recover A', config: { tag: 'recoverA' } },
                { id: 'op', type: 'delete_record', label: 'Delete', config: { objectName: 'deal', filter: { status: 'closed' } } },
                { id: 'handler', type: 'checkpoint', label: 'Handler', config: { tag: 'handler' } },
                { id: 'end', type: 'end', label: 'End' },
            ],
            edges: [
                { id: 'e1', source: 'start', target: 'a' },
                { id: 'ef', source: 'a', target: 'recoverA', type: 'fault' },
                { id: 'e2', source: 'recoverA', target: 'op' },
                { id: 'e3', source: 'op', target: 'end' },
                { id: 'e_fault', source: 'op', target: 'handler', type: 'fault' },
                { id: 'e4', source: 'handler', target: 'end' },
            ],
        } as any);

        // No trigger user and the default `runAs: 'user'` — the ADR-0049/#1888
        // unscoped case, which THROWS its refusal.
        const result = await engine.execute('guard_after_stale');

        expect(result.success).toBe(false);
        expect(result.error).toContain('runAs');
        // The seed recovered; the guard refusal did NOT route to its handler.
        expect(ran).toEqual(['recoverA']);
        expect(seen.deleted).toBe(false);
    });
});
