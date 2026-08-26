// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #5138 — `callData` answers "this id names no row" with ONE fact.
 *
 * `callData` is protocol-first with an ObjectQL fallback, and the fallback gave
 * three different answers to the single fact that `params.id` matches nothing.
 * Measured on `main` @ `c11369013` before the fix, same harnesses as below:
 *
 * ```
 * FALLBACK get   : resolved  null                                   → /data 200 {data:null}
 * FALLBACK update: rejected  Error('[ObjectStack] Not Found')       → no .status ⇒ 500
 *                            (code: undefined, status: undefined)
 * FALLBACK delete: resolved  { object, id, deleted: true }          → 200, row never existed
 * PROTOCOL get   : rejected  RECORD_NOT_FOUND / 404
 * PROTOCOL update: rejected  RECORD_NOT_FOUND / 404
 * PROTOCOL delete: rejected  RECORD_NOT_FOUND / 404
 * ```
 *
 * So the protocol path was ALREADY the canonical answer on all three verbs
 * (#4435, re-asserted for the batch path by #5088) and needed no change — only
 * pinning. The whole defect was the fallback, where the same GET answered 200
 * or 404 depending on nothing the caller can see: whether the deployment
 * registered the `protocol` slot.
 *
 * The fix imports `recordNotFoundError` from `@objectstack/metadata-protocol`
 * rather than re-spelling it, so there is one construction point for the
 * envelope and the two paths behind one `callData` cannot drift apart again.
 *
 * The suite is organised around that: the fallback's three verbs (was-red
 * cases), the protocol's three (pins), and a field-for-field identity assertion
 * across the two — which is the claim a caller actually depends on. Then the
 * two consuming faces the issue names: `/data` through the REAL `HttpDispatcher`,
 * and the declarative endpoint executor (#5092 / PR #5136) driven with the REAL
 * `callData` bound, which is where the status a client receives is decided.
 *
 * ---
 *
 * #5581 extended the suite to the SUCCESS side of the same family. `delete`'s
 * fallback answered `{ object, id, deleted: true }` where the protocol path
 * answered the spec's `{ object, id, success: true }`, so the same two paths
 * disagreed once more — this time on every successful request rather than only
 * on a mistaken id. Same fix shape: the fallback moves to what the spec
 * declares, and the identity is pinned across the two paths so it cannot drift
 * apart again. See the `#5581` describe block below.
 */

import { describe, it, expect } from 'vitest';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
// [#4550, from #4434] The REAL engine's delete-dispatch predicate. A fake whose
// `delete` is looser than the implementation it stands in for turns a green
// suite into no suite at all; importing the producer's decision (rather than
// mirroring it) is what makes that impossible. `@objectstack/objectql` is
// already a `dependencies` entry of `@objectstack/runtime`, so no manifest
// change is needed to reach it.
import { assertEngineDeleteDispatch, assertEngineFindOnePredicate } from '@objectstack/objectql';
import { ApiEndpointSchema, DeleteDataResponseSchema } from '@objectstack/spec/api';
import type { ApiEndpoint } from '@objectstack/spec/api';

import { callData, type ActionExecutionDeps } from './action-execution.js';
import { HttpDispatcher, type HttpProtocolContext } from './http-dispatcher.js';
import { buildEndpointExecutionContext, executeEndpointTarget } from './endpoint-executor.js';

const EC = { userId: 'u1', isSystem: false, positions: [], permissions: [] } as any;
/** [#5155] Every service lookup resolves off the REQUEST's kernel. */
const REQ = { request: {} } as HttpProtocolContext;
const SCHEMA = { name: 'task', fields: { title: { name: 'title', type: 'text' } } };
const GHOST = 'definitely_not_a_row';

// ---------------------------------------------------------------------------
// Harnesses — the SAME row set behind both paths, so "exists" means one thing
// ---------------------------------------------------------------------------

function rows() {
    return new Map<string, any>([['r1', { id: 'r1', title: 'one' }]]);
}

/**
 * ObjectQL-only: no `protocol` slot, so every verb takes the fallback. This is
 * the combination the issue names — a deployment WITHOUT `MetadataPlugin`
 * (`@objectstack/metadata-protocol`, which is what registers the slot). With it
 * installed the fallback is unreachable, which is why nothing caught this.
 */
function fallbackHarness(store = rows()) {
    const deleted: string[] = [];
    const ql: any = {
        // `registry` is what `HttpDispatcher.getObjectQLService` requires before
        // it will hand the service to `callData` — not decoration.
        registry: { getObject: (n: string) => (n === 'task' ? SCHEMA : undefined) },
        find: async (_o: string, bag: any) => {
            const hit = store.get(String(bag?.where?.id));
            return hit ? [hit] : [];
        },
        update: async (_o: string, data: any, opts: any) => {
            const id = String(opts?.where?.id);
            if (!store.has(id)) return null;
            store.set(id, { ...store.get(id), ...data });
            return store.get(id);
        },
        delete: async (_o: string, opts: any) => {
            // [#4550, from #4434] Open on the producer's own dispatch predicate,
            // so this double cannot accept a call the real `ObjectQL.delete`
            // refuses. It also earns its keep here: the assertion is what proves
            // `callData`'s fallback issues a SCALAR by-id delete — the shape a
            // running engine executes — rather than a predicate-shaped one that
            // would 500 in production while this suite stayed green.
            const dispatch = assertEngineDeleteDispatch(opts);
            const id = String((dispatch as { kind: 'by-id'; id: string | number | bigint }).id);
            deleted.push(id);
            return store.delete(id);
        },
    };
    const services: Record<string, any> = {
        metadata: { getObject: async () => ({ name: 'task', fields: {} }) },
        objectql: ql,
    };
    const deps: ActionExecutionDeps = {
        resolveService: (async (_c: HttpProtocolContext, name: string) => services[name]) as any,
        getObjectQL: async () => ql,
    };
    return { deps, store, deleted, ql, services };
}

/** Protocol-first, with the REAL `@objectstack/metadata-protocol` occupant. */
function protocolHarness(store = rows()) {
    const engine: any = {
        registry: { getObject: (n: string) => (n === 'task' ? SCHEMA : undefined) },
        findOne: async (_o: string, opts: any) => { assertEngineFindOnePredicate(_o, opts); return store.get(String(opts?.where?.id)) ?? null; },
        find: async () => [...store.values()],
        update: async (_o: string, data: any, opts: any) => {
            const id = String(opts?.where?.id);
            if (!store.has(id)) return null;
            store.set(id, { ...store.get(id), ...data });
            return store.get(id);
        },
        // [#4550] Same pinning as the fallback harness above — this engine sits
        // under the REAL protocol implementation, so its `delete` is reached by
        // `deleteData`'s own by-id call and must be held to the same contract.
        delete: async (_o: string, opts: any) => {
            const dispatch = assertEngineDeleteDispatch(opts);
            return store.delete(String((dispatch as { kind: 'by-id'; id: string | number | bigint }).id));
        },
    };
    const services: Record<string, any> = {
        metadata: { getObject: async () => ({ name: 'task', fields: {} }) },
        protocol: new ObjectStackProtocolImplementation(engine),
        objectql: engine,
    };
    const deps: ActionExecutionDeps = {
        resolveService: (async (_c: HttpProtocolContext, name: string) => services[name]) as any,
        getObjectQL: async () => engine,
    };
    return { deps, store, services };
}

const verb = {
    get: (id: string) => ['get', { object: 'task', id }] as const,
    update: (id: string) => ['update', { object: 'task', id, data: { title: 'x' } }] as const,
    delete: (id: string) => ['delete', { object: 'task', id }] as const,
};
type Verb = keyof typeof verb;
const VERBS: Verb[] = ['get', 'update', 'delete'];

const run = (deps: ActionExecutionDeps, v: Verb, id: string) => {
    const [action, params] = verb[v](id);
    return callData(deps, REQ, action, params, undefined, undefined, EC);
};

/** Capture the rejection as plain data so the two paths can be compared. */
async function rejection(p: Promise<unknown>) {
    let caught: any;
    let resolved: unknown;
    let didResolve = false;
    try {
        resolved = await p;
        didResolve = true;
    } catch (e) {
        caught = e;
    }
    expect(
        didResolve,
        `expected a RECORD_NOT_FOUND rejection, but the call RESOLVED with ${JSON.stringify(resolved)}`,
    ).toBe(false);
    return { code: caught?.code, status: caught?.status, message: caught?.message, object: caught?.object };
}

/** The #5088/#4435 envelope, spelled once. */
const notFoundEnvelope = (id: string) => ({
    code: 'RECORD_NOT_FOUND',
    status: 404,
    message: `Record ${id} not found in task`,
    object: 'task',
});

// ---------------------------------------------------------------------------
// The fallback — the three answers that were three different facts
// ---------------------------------------------------------------------------

describe('the ObjectQL fallback answers a missing id with RECORD_NOT_FOUND (#5138)', () => {
    it.each(VERBS)('%s rejects with the #5088 envelope — code, status, message, object', async (v) => {
        const h = fallbackHarness();
        expect(await rejection(run(h.deps, v, GHOST))).toEqual(notFoundEnvelope(GHOST));
    }, 60_000);

    it('the 404 carries a `status`, not a `statusCode` — the property every exit reads FIRST', async () => {
        // `update` used to throw a bare `Error`, so all three dispatcher exits
        // (`HttpDispatcher.errorFromThrown`, `dispatcher-plugin`'s
        // `errorResponseBase`, `endpoint-executor`'s `errorAnswer`) fell to
        // their 500 default and a caller mistake entered error reporting as an
        // internal fault. They read `.status` → `.statusCode` → 500.
        const h = fallbackHarness();
        let caught: any;
        try { await run(h.deps, 'update', GHOST); } catch (e) { caught = e; }
        expect(caught.status).toBe(404);
        expect(caught).toBeInstanceOf(Error);
        // Nothing here should look like the old bare throw.
        expect(caught.message).not.toBe('[ObjectStack] Not Found');
    }, 60_000);

    it('delete refuses BEFORE touching the store — no delete is issued for a row that is not there', async () => {
        // The old branch called `ql.delete` unconditionally and answered
        // `{ deleted: true }`. A 404 that still issued the write would be the
        // same lie with a different status code.
        const h = fallbackHarness();
        await rejection(run(h.deps, 'delete', GHOST));
        expect(h.deleted).toEqual([]);
    }, 60_000);

    it.each(VERBS)('%s is unchanged for an id that DOES exist', async (v) => {
        const h = fallbackHarness();
        await expect(run(h.deps, v, 'r1')).resolves.toBeTruthy();
    }, 60_000);

    it('a real delete still deletes, and answers the SPEC’s `success: true`', async () => {
        // [#5581] Was `{ object, id, deleted: true }` here — `success` missing,
        // `deleted` declared nowhere in `DeleteDataResponseSchema`. The delete
        // itself is unchanged; only the key the answer spells it with.
        const h = fallbackHarness();
        const out: any = await run(h.deps, 'delete', 'r1');
        expect(out).toEqual({ object: 'task', id: 'r1', success: true });
        expect(out.deleted).toBeUndefined();
        expect(h.deleted).toEqual(['r1']);
        expect(h.store.has('r1')).toBe(false);
    }, 60_000);

    it('a real update still returns the merged record', async () => {
        const h = fallbackHarness();
        const out: any = await run(h.deps, 'update', 'r1');
        expect(out).toEqual({ object: 'task', id: 'r1', record: { id: 'r1', title: 'x' } });
    }, 60_000);
});

// ---------------------------------------------------------------------------
// The protocol path — already canonical, pinned so it stays that way
// ---------------------------------------------------------------------------

describe('the protocol path answers the same missing id the same way (#4435/#5088)', () => {
    it.each(VERBS)('%s rejects with the #5088 envelope', async (v) => {
        const h = protocolHarness();
        expect(await rejection(run(h.deps, v, GHOST))).toEqual(notFoundEnvelope(GHOST));
    }, 60_000);
});

// ---------------------------------------------------------------------------
// The claim a caller depends on
// ---------------------------------------------------------------------------

describe('one `callData`, one answer — the two paths are field-for-field identical', () => {
    it.each(VERBS)('%s: fallback envelope === protocol envelope', async (v) => {
        const withoutProtocol = await rejection(run(fallbackHarness().deps, v, GHOST));
        const withProtocol = await rejection(run(protocolHarness().deps, v, GHOST));
        expect(withoutProtocol).toEqual(withProtocol);
    }, 60_000);

    it('and the envelope is built ONCE — the fallback imports the protocol’s factory', async () => {
        // If either side ever re-spells the shape, the three assertions above
        // can be kept green by editing a literal in this file. This one cannot:
        // it compares the fallback's throw against the exported factory itself.
        const { recordNotFoundError } = await import('@objectstack/metadata-protocol');
        const reference = recordNotFoundError('task', GHOST) as any;
        const actual = await rejection(run(fallbackHarness().deps, 'get', GHOST));
        expect(actual).toEqual({
            code: reference.code,
            status: reference.status,
            message: reference.message,
            object: reference.object,
        });
    }, 60_000);
});

// ---------------------------------------------------------------------------
// [#5581] The same claim on the SUCCESS side
// ---------------------------------------------------------------------------

/**
 * #5138 unified what the two paths say when the id names no row. This unifies
 * what they say when the delete SUCCEEDS — the other half of the same "one
 * `callData`, two answers" family, and the half a caller reaches on every
 * normal request rather than only on a mistake.
 *
 * Measured on `main` @ `2614aefb3`, same two harnesses, same single row:
 *
 * ```
 * PROTOCOL del (hit): {"object":"task","id":"r1","success":true}
 * FALLBACK del (hit): {"object":"task","id":"r1","deleted":true}
 * ```
 *
 * `DeleteDataResponseSchema` is the authority and declares `success`; the
 * protocol path has produced it since #4435. So the fallback was the only
 * thing to move, exactly as in #5138.
 *
 * The schema is asserted AND the two bodies are compared field-for-field,
 * because neither alone is enough: `z.object` strips unknown keys, so a body
 * carrying BOTH `success` and a leftover `deleted` parses green — only the
 * cross-path equality catches that. Conversely the equality alone would stay
 * green if both paths drifted together, which the schema parse catches.
 */
describe('one `callData`, one success body — delete answers the spec shape on both paths (#5581)', () => {
    it('the fallback’s success body parses as DeleteDataResponse', async () => {
        const out = await run(fallbackHarness().deps, 'delete', 'r1');
        const parsed = DeleteDataResponseSchema.safeParse(out);
        expect(parsed.success, JSON.stringify((parsed as any).error?.issues ?? [])).toBe(true);
    }, 60_000);

    it('the protocol’s success body parses as DeleteDataResponse', async () => {
        const out = await run(protocolHarness().deps, 'delete', 'r1');
        const parsed = DeleteDataResponseSchema.safeParse(out);
        expect(parsed.success, JSON.stringify((parsed as any).error?.issues ?? [])).toBe(true);
    }, 60_000);

    it('fallback success body === protocol success body, field for field', async () => {
        const withoutProtocol = await run(fallbackHarness().deps, 'delete', 'r1');
        const withProtocol = await run(protocolHarness().deps, 'delete', 'r1');
        expect(withoutProtocol).toEqual(withProtocol);
        expect(withoutProtocol).toEqual({ object: 'task', id: 'r1', success: true });
    }, 60_000);

    it('neither path carries the undeclared `deleted` key', async () => {
        // The was-red assertion in its narrowest form. `z.object` would strip
        // `deleted` and still report a valid parse, so the key is named here.
        for (const deps of [fallbackHarness().deps, protocolHarness().deps]) {
            const out: any = await run(deps, 'delete', 'r1');
            expect(Object.keys(out).sort()).toEqual(['id', 'object', 'success']);
        }
    }, 60_000);
});

// ---------------------------------------------------------------------------
// Consuming face 1 — `/data` through the REAL dispatcher
// ---------------------------------------------------------------------------

/**
 * A kernel with an `objectql` occupant and NO `protocol` one — the combination
 * that reaches the fallback. `auth` answers a session so the request gets past
 * the anonymous-deny gate and reaches the branch under test.
 */
function dispatcherOverFallback() {
    const h = fallbackHarness();
    const resolve = (name: string) =>
        name === 'objectql' ? h.ql
        : name === 'metadata' ? h.services.metadata
        : name === 'auth' ? { api: { getSession: async () => ({ user: { id: 'u1' } }) } }
        : undefined;
    const kernel: any = { getService: resolve, getServiceAsync: async (n: string) => resolve(n) };
    return { dispatcher: new HttpDispatcher(kernel), deleted: h.deleted };
}

describe('/data through the real HttpDispatcher inherits the one answer (#5138)', () => {
    const cases: Array<[string, string, any]> = [
        ['GET', `/data/task/${GHOST}`, undefined],
        ['PATCH', `/data/task/${GHOST}`, { title: 'x' }],
        ['DELETE', `/data/task/${GHOST}`, undefined],
    ];

    it.each(cases)('%s %s rejects with 404 RECORD_NOT_FOUND', async (method, path, body) => {
        const { dispatcher } = dispatcherOverFallback();
        // `dispatch()` re-throws everything but a permission denial; the two
        // mounts that serve this domain (`dispatcher-plugin`'s catch →
        // `errorResponseBase`, and `HttpDispatcher.errorFromThrown`) both read
        // `.status` first, which is what turns this into a 404 on the wire —
        // pinned for those exits by `domains/error-passthrough.test.ts`.
        await expect(
            dispatcher.dispatch(method, path, body, {}, { request: {} } as HttpProtocolContext),
        ).rejects.toMatchObject({ status: 404, code: 'RECORD_NOT_FOUND' });
    }, 60_000);

    it('DELETE no longer answers a 200 success for a row that never existed', async () => {
        // The was-red case in its most consequential form: this used to RESOLVE
        // `{ handled: true, response: { status: 200, ... deleted: true } }`.
        const { dispatcher, deleted } = dispatcherOverFallback();
        const result = dispatcher.dispatch('DELETE', `/data/task/${GHOST}`, undefined, {}, { request: {} } as HttpProtocolContext);
        await expect(result).rejects.toBeTruthy();
        expect(deleted).toEqual([]);
    }, 60_000);

    it('GET on a row that exists still answers 200 with the record', async () => {
        const { dispatcher } = dispatcherOverFallback();
        const res: any = await dispatcher.dispatch('GET', '/data/task/r1', undefined, {}, { request: {} } as HttpProtocolContext);
        expect(res.handled).toBe(true);
        expect(res.response.status).toBe(200);
    }, 60_000);

    it('[#5581] DELETE on a row that exists answers 200 with the spec’s `success` body', async () => {
        // The face the issue is actually about: a client reading the DELETE
        // 200 off a deployment WITHOUT the protocol slot. It used to find
        // `success === undefined` and an undeclared `deleted` in its place, so
        // "did the delete succeed" was unreadable from a 200 response.
        const { dispatcher, deleted } = dispatcherOverFallback();
        const res: any = await dispatcher.dispatch('DELETE', '/data/task/r1', undefined, {}, { request: {} } as HttpProtocolContext);
        expect(res.handled).toBe(true);
        expect(res.response.status).toBe(200);
        expect(res.response.body.data).toEqual({ object: 'task', id: 'r1', success: true });
        expect(DeleteDataResponseSchema.safeParse(res.response.body.data).success).toBe(true);
        expect(deleted).toEqual(['r1']);
    }, 60_000);
});

// ---------------------------------------------------------------------------
// Consuming face 2 — the declarative endpoint executor (#5092 / PR #5136)
// ---------------------------------------------------------------------------

/**
 * The executor reuses `/data`'s delegation byte for byte, so it inherits this
 * unification for free — and unlike `dispatch()` it BUILDS the HTTP answer, so
 * this is where the status a client receives is asserted directly.
 */
function declaredEndpoint(operation: 'get' | 'update' | 'delete'): ApiEndpoint {
    return ApiEndpointSchema.parse({
        name: 'task_by_id',
        path: '/api/v1/apps/showcase/task',
        method: operation === 'get' ? 'GET' : operation === 'update' ? 'PATCH' : 'DELETE',
        type: 'object_operation',
        target: 'task',
        objectParams: { object: 'task', operation },
    });
}

describe('a declared endpoint answers 404 RECORD_NOT_FOUND on the wire (#5092/#5136)', () => {
    it.each(['get', 'update', 'delete'] as const)('%s → status 404, code RECORD_NOT_FOUND', async (operation) => {
        const h = fallbackHarness();
        const ctx = buildEndpointExecutionContext({
            request: {
                method: 'GET',
                path: '/api/v1/apps/showcase/task',
                query: { id: GHOST },
                headers: {},
                ...(operation === 'update' ? { body: { title: 'x' } } : {}),
            },
            match: { endpoint: declaredEndpoint(operation), params: {} },
            executionContext: EC,
        });
        const answer = await executeEndpointTarget(ctx, {
            // The REAL `callData`, bound the way `dispatcher-plugin` binds it.
            callData: (action, params, driver, scope, ec) =>
                callData(h.deps, REQ, action, params, driver, scope, ec),
        });

        expect(answer.status).toBe(404);
        const error = (answer.body as any).error;
        expect(error.code).toBe('RECORD_NOT_FOUND');
        expect(error.httpStatus).toBe(404);
        // A 4xx message is a deliberate business answer and reaches the caller
        // intact — the 5xx leak sanitiser must not have touched it.
        expect(error.message).toBe(`Record ${GHOST} not found in task`);
        expect(h.deleted).toEqual([]);
    }, 60_000);

    it('[#5581] a declared DELETE endpoint carries the spec’s `success` body too', async () => {
        // The executor reuses `/data`'s delegation byte for byte, so it
        // inherited the fork the same way. Note the two `success` flags are
        // DIFFERENT facts and both are pinned here: `body.success` is the HTTP
        // envelope's ok-flag (`successAnswer`), `body.data.success` is
        // `DeleteDataResponse`'s "the deletion happened". Reading one for the
        // other is the mistake this shape invites, so neither is left implied.
        const h = fallbackHarness();
        const ctx = buildEndpointExecutionContext({
            request: { method: 'GET', path: '/api/v1/apps/showcase/task', query: { id: 'r1' }, headers: {} },
            match: { endpoint: declaredEndpoint('delete'), params: {} },
            executionContext: EC,
        });
        const answer = await executeEndpointTarget(ctx, {
            callData: (action, params, driver, scope, ec) => callData(h.deps, REQ, action, params, driver, scope, ec),
        });

        expect(answer.status).toBe(200);
        const body = answer.body as any;
        expect(body.success).toBe(true);
        expect(body.data).toEqual({ object: 'task', id: 'r1', success: true });
        expect(DeleteDataResponseSchema.safeParse(body.data).success).toBe(true);
        expect(h.deleted).toEqual(['r1']);
    }, 60_000);
});
