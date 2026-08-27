// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #5856 — `callData` has no `batch` arm, and `batch` is refused like every
 * other action it does not serve.
 *
 * The removed code was three lines:
 *
 * ```ts
 * if (action === 'batch') {
 *     // Batch operations — not yet supported via direct service dispatch
 *     return { object: params.object, results: [] };
 * }
 * ```
 *
 * It was the ONLY arm in `callData` that answered an unimplemented action with
 * SUCCESS. Every other unhandled action throws `400 Unknown data action: …`,
 * and `aggregate` throws `503` when the engine cannot serve it — this one
 * returned an HTTP 200 whose body is shaped exactly like a batch that ran and
 * matched nothing, having opened no transaction and written nothing. Retry,
 * idempotency and audit all read that as one successful empty operation.
 *
 * ## Why deleting it changed no online behaviour — the enumeration
 *
 * Nothing could reach the arm, and its unreachability lived UPSTREAM of it
 * (ADR-0115 Evidence 5 / #4451: "the slot exists, nobody registers it"), which
 * is why removal is the fix rather than a comment. Every entry point into
 * `callData`, on `main` at the time of the fix:
 *
 * | entry point | what it passes as `action` |
 * |---|---|
 * | `domains/data.ts` (`/data`) | the literals `query` / `get` / `create` / `update` / `delete`; `parts[1]` is compared against `'query'` and otherwise read as a record **id**, never as an action |
 * | `domains/mcp.ts` (MCP bridge, `run_action`) | the literals `query` / `get` / `aggregate` / `create` / `update` / `delete` |
 * | `domains/actions.ts` + `invokeBusinessAction` | the literal `get` |
 * | `endpoint-executor.ts` (declarative endpoints, bound in `dispatcher-plugin.ts`) | one literal per `ObjectOperation`, and that type is `ApiEndpointSchema.objectParams.operation` — a CLOSED enum of find/get/create/update/delete |
 * | outside this package | nothing: `callData` is not re-exported from `packages/runtime/src/index.ts` |
 *
 * The two structural halves of that table are pinned below (the `/data` route
 * table, and the endpoint vocabulary) so a future re-wiring has to face them.
 *
 * ## What this suite pins
 *
 * 1. `batch` is refused with the SAME `{ statusCode: 400, message }` shape as
 *    any other unknown action — on a deployment WITH the `protocol` slot and
 *    on one WITHOUT it, since the removed arm sat past both paths;
 * 2. the actions `callData` really serves are untouched (positive control);
 * 3. the two upstream facts that made the arm unreachable.
 *
 * Reverse verification (direction predicted BEFORE running, then measured —
 * see the PR): restoring the three lines turns case 1 RED in the ordinary
 * direction — the call RESOLVES `{ object: 'task', results: [] }` instead of
 * rejecting, so every `rejects` assertion in `describe('batch is refused …')`
 * fails with "promise resolved instead of rejected". Cases 2 and 3 stay green
 * under the restore: they describe the paths the arm never sat on, which is
 * the same claim the enumeration above makes.
 */

import { describe, it, expect } from 'vitest';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { ApiEndpointSchema } from '@objectstack/spec/api';

import { callData, type ActionExecutionDeps } from './action-execution.js';
import { HttpDispatcher, type HttpProtocolContext } from './http-dispatcher.js';
import { assertEngineFindOnePredicate } from '@objectstack/metadata-core';

const EC = { userId: 'u1', isSystem: false, positions: [], permissions: [] } as any;
/** [#5155] Every service lookup resolves off the REQUEST's kernel. */
const REQ = { request: {} } as HttpProtocolContext;
const SCHEMA = { name: 'task', fields: { title: { name: 'title', type: 'text' } } };

// ---------------------------------------------------------------------------
// Harnesses — the same row set behind both deployments
// ---------------------------------------------------------------------------

function rows() {
    return [{ id: 'r1', title: 'one' }];
}

/** The read surface both harnesses share. No write verb is defined: this suite
 *  never writes, and a double that declares one it does not need is a contract
 *  to keep in sync for nothing (`check:engine-double-contract`'s subject). */
function engine(store = rows()) {
    return {
        // `registry` is what `HttpDispatcher.getObjectQLService` requires before
        // it will hand the service to `callData` — not decoration.
        registry: { getObject: (n: string) => (n === 'task' ? SCHEMA : undefined) },
        find: async (_o: string, bag: any) => {
            const id = bag?.where?.id;
            return id == null ? [...store] : store.filter((r) => r.id === String(id));
        },
        findOne: async (_o: string, opts: any) => { assertEngineFindOnePredicate(_o, opts); return store.find((r) => r.id === String(opts?.where?.id)) ?? null; },
    } as any;
}

/** No `protocol` slot — every verb takes `callData`'s ObjectQL fallback. */
function fallbackHarness() {
    const ql = engine();
    const services: Record<string, any> = {
        metadata: { getObject: async () => ({ name: 'task', fields: {} }) },
        objectql: ql,
    };
    const deps: ActionExecutionDeps = {
        resolveService: (async (_c: HttpProtocolContext, name: string) => services[name]) as any,
        getObjectQL: async () => ql,
    };
    return { deps, ql, services };
}

/** Protocol-first, with the REAL `@objectstack/metadata-protocol` occupant. */
function protocolHarness() {
    const ql = engine();
    const services: Record<string, any> = {
        metadata: { getObject: async () => ({ name: 'task', fields: {} }) },
        protocol: new ObjectStackProtocolImplementation(ql),
        objectql: ql,
    };
    const deps: ActionExecutionDeps = {
        resolveService: (async (_c: HttpProtocolContext, name: string) => services[name]) as any,
        getObjectQL: async () => ql,
    };
    return { deps, ql, services };
}

const DEPLOYMENTS: Array<[string, () => { deps: ActionExecutionDeps }]> = [
    ['without the protocol slot (ObjectQL fallback)', fallbackHarness],
    ['with the protocol slot', protocolHarness],
];

/** Capture a rejection as plain data so two of them can be compared. */
async function rejection(p: Promise<unknown>) {
    try {
        const resolved = await p;
        return { rejected: false as const, resolved };
    } catch (e) {
        return { rejected: true as const, error: e as any };
    }
}

// ---------------------------------------------------------------------------
// 1. `batch` is refused, and refused like everything else unknown
// ---------------------------------------------------------------------------

describe('batch is refused with the unknown-action answer (#5856)', () => {
    it.each(DEPLOYMENTS)('%s → 400 Unknown data action: batch', async (_label, harness) => {
        const { deps } = harness();
        await expect(
            callData(deps, REQ, 'batch', { object: 'task' }, undefined, undefined, EC),
        ).rejects.toEqual({ statusCode: 400, message: 'Unknown data action: batch' });
    }, 60_000);

    it('answers `batch` in the SAME shape as any other unknown action', async () => {
        // The claim the issue is about, stated as an identity rather than as a
        // literal: `batch` is no longer a special case of anything. Only the
        // action name may differ between the two rejections.
        const { deps } = fallbackHarness();
        const forBatch = await rejection(callData(deps, REQ, 'batch', { object: 'task' }, undefined, undefined, EC));
        const forOther = await rejection(callData(deps, REQ, 'frobnicate', { object: 'task' }, undefined, undefined, EC));

        expect(forBatch.rejected).toBe(true);
        expect(forOther.rejected).toBe(true);
        expect(Object.keys(forBatch.error).sort()).toEqual(Object.keys(forOther.error).sort());
        expect(forBatch.error.statusCode).toBe(forOther.error.statusCode);
        expect(forBatch.error.message.replace('batch', 'X')).toBe(forOther.error.message.replace('frobnicate', 'X'));
    }, 60_000);

    it('never answers a 200 whose body reads as "the batch ran and matched nothing"', async () => {
        // The was-red assertion in its narrowest form. `{ results: [] }` is
        // indistinguishable from a real empty batch, which is what made this
        // worse than a 501: nothing downstream can tell the two apart.
        for (const [, harness] of DEPLOYMENTS) {
            const outcome = await rejection(
                callData(harness().deps, REQ, 'batch', { object: 'task' }, undefined, undefined, EC),
            );
            expect(outcome.rejected).toBe(true);
            expect(outcome).not.toMatchObject({ resolved: { results: [] } });
        }
    }, 60_000);
});

// ---------------------------------------------------------------------------
// 2. Positive control — the actions `callData` DOES serve are untouched
// ---------------------------------------------------------------------------

describe('the served actions still answer (positive control)', () => {
    it.each(DEPLOYMENTS)('%s → query lists, get reads', async (_label, harness) => {
        const { deps } = harness();
        const list: any = await callData(deps, REQ, 'query', { object: 'task', query: {} }, undefined, undefined, EC);
        expect(list.object).toBe('task');
        expect(list.records).toEqual([{ id: 'r1', title: 'one' }]);

        const one: any = await callData(deps, REQ, 'get', { object: 'task', id: 'r1' }, undefined, undefined, EC);
        expect(one).toMatchObject({ object: 'task', id: 'r1', record: { id: 'r1', title: 'one' } });
    }, 60_000);
});

// ---------------------------------------------------------------------------
// 3. The two upstream facts that made the arm unreachable
// ---------------------------------------------------------------------------

describe('nothing upstream can spell `batch` (#5856 enumeration)', () => {
    it('the dispatcher’s `/data` domain declines `/data/:object/batch` — it routes only `query`', async () => {
        // `handleDataRequest` compares `parts[1]` against the literal 'query'
        // and otherwise reads it as a record id, so this POST matches no branch
        // and the domain DECLINES it (`handled: false`). This is the upstream
        // constraint the removed arm was relying on for its safety.
        //
        // Note what this does NOT say: `POST /data/:object/batch` is a real
        // endpoint — `@objectstack/rest` mounts it (`registerBatchEndpoints`,
        // `rest-server.ts`), together with the cross-object `POST /batch`.
        // That is the point of route-ownership rule 1: batching has one owner,
        // and a host that wants it mounts REST. What is pinned here is that
        // THIS domain is not a second owner of the same path.
        const h = fallbackHarness();
        const resolve = (name: string) =>
            name === 'objectql' ? h.ql
            : name === 'metadata' ? h.services.metadata
            : name === 'auth' ? { api: { getSession: async () => ({ user: { id: 'u1' } }) } }
            : undefined;
        const kernel: any = { getService: resolve, getServiceAsync: async (n: string) => resolve(n) };
        const dispatcher = new HttpDispatcher(kernel);

        const res: any = await dispatcher.dispatch('POST', '/data/task/batch', { operations: [] }, {}, { request: {} } as HttpProtocolContext);
        expect(res.handled).toBe(false);

        // The sibling that IS routed, so the assertion above cannot pass by the
        // whole domain being broken.
        const served: any = await dispatcher.dispatch('POST', '/data/task/query', {}, {}, { request: {} } as HttpProtocolContext);
        expect(served.handled).toBe(true);
        expect(served.response.status).toBe(200);
    }, 60_000);

    it('a declared endpoint cannot ask for `batch` — the operation enum is closed', () => {
        // `endpoint-executor.ts`'s `ObjectOperation` is this enum, so the
        // declarative-endpoint path can only ever hand `callData` one of five
        // literals. Publish rejects the rest.
        const declare = (operation: string) =>
            ApiEndpointSchema.safeParse({
                name: 'task_batch',
                path: '/api/v1/apps/showcase/task',
                method: 'POST',
                type: 'object_operation',
                target: 'task',
                objectParams: { object: 'task', operation },
            });

        expect(declare('batch').success).toBe(false);
        expect(declare('create').success).toBe(true);
    });
});
