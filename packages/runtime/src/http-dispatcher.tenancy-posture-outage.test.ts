// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#13906 decision 1 option A — at the RUNTIME door, measured end to end]
 *
 * The runtime resolver (`security/resolve-execution-context.ts`) has ONE
 * production caller: `HttpDispatcher.resolveRequestScope`, reached from
 * `dispatch()` and from the declarative-endpoint fallback. Between the
 * resolver's tenancy read and the transport's error envelope sat THREE nets,
 * every one of them collapsing "the posture could not be READ" into "there is
 * no posture":
 *
 *   1. the resolver's own bare `catch { tenancyPosture = undefined }`;
 *   2. the dispatcher's `getService` facade — `resolveService`, a capability
 *      PROBE whose fallback chain absorbs every rejection at every step and
 *      hands back `undefined`, so the resolver's catch was never even reached;
 *   3. `resolveRequestScope`'s bare `catch` ("anonymous request") around the
 *      whole identity step.
 *
 * With all three in place a tenancy service that was REGISTERED AND FAILED TO
 * BUILD read as "no wall": both posture-conditional API-key refusals were
 * skipped and an ex-member's org-stamped key was admitted with full grants.
 * The REST seam (`rest-server.ts`) already answers this class with
 * `AuthzStoreUnavailableError` (503); this file pins the same answer on the
 * runtime door, against a REAL `ObjectKernel` so the rejections under test are
 * the registry's own (#13905: branded on "never registered", unbranded on
 * "registered and could not be built").
 */

import { describe, it, expect } from 'vitest';

import { ObjectKernel, isAuthzStoreUnavailableError } from '@objectstack/core';
import { ApiErrorSchema, BaseResponseSchema } from '@objectstack/spec/api';

import { HttpDispatcher } from './http-dispatcher.js';
import { createDispatcherPlugin } from './dispatcher-plugin.js';
import { hashApiKey } from './security/api-key.js';

const FUTURE = '2999-01-01T00:00:00Z';
const RAW_EXMEMBER = 'osk_exmember_dispatcher_door';

function qlWith() {
    const tables: Record<string, any[]> = {
        // Stamped org_A; the owner's ONLY current membership is org_B.
        sys_api_key: [
            { id: 'k_ex', key: hashApiKey(RAW_EXMEMBER), revoked: false, user_id: 'u_exmember', active_organization_id: 'org_A', expires_at: FUTURE },
        ],
        sys_member: [{ user_id: 'u_exmember', organization_id: 'org_B' }],
        sys_user_permission_set: [], sys_permission_set: [],
        sys_position: [], sys_position_permission_set: [], sys_user_position: [],
    };
    return {
        async find(object: string, opts: any) {
            const rows = tables[object] ?? [];
            const where = opts?.where ?? {};
            const matched = rows.filter((row) => {
                for (const [k, v] of Object.entries(where)) {
                    if (v !== null && typeof v === 'object') {
                        if (Array.isArray((v as any).$in) && !(v as any).$in.includes(row[k])) return false;
                        continue;
                    }
                    if ((v ?? null) !== (row[k] ?? null)) return false;
                }
                return true;
            });
            return typeof opts?.limit === 'number' ? matched.slice(0, opts.limit) : matched;
        },
    };
}

type Tenancy = 'healthy-isolated' | 'factory-throws' | 'unregistered';

/** A REAL kernel, as the host would hand the dispatcher. */
function kernelWith(tenancy: Tenancy): ObjectKernel {
    // `gracefulShutdown: false` — a fixture kernel must not hook the test
    // runner's process signals.
    const kernel = new ObjectKernel({ skipSystemValidation: true, gracefulShutdown: false } as any);
    kernel.registerService('objectql', qlWith());
    if (tenancy === 'healthy-isolated') {
        kernel.registerService('tenancy', { posture: 'isolated' });
    } else if (tenancy === 'factory-throws') {
        // The REAL failure class: the registry's own unbranded rejection.
        kernel.registerServiceFactory('tenancy', () => {
            throw new Error('tenancy backend unavailable');
        });
    }
    // 'unregistered' → nothing: the branded not-registered rejection.
    return kernel;
}

function dispatcherOn(kernel: ObjectKernel) {
    return new HttpDispatcher(kernel, undefined, { enforceProjectMembership: false });
}

/** The context shape the plugin hands `dispatch()`: `{ request }`, nothing resolved yet. */
function requestWith(headers: Record<string, string>): any {
    return { request: { headers } };
}

/** Settle to the rejection, or to `undefined` when the call RESOLVED. */
const rejectionOf = (p: Promise<unknown>) => p.then(() => undefined, (e) => e);

// ---------------------------------------------------------------------------
// §1 — the identity step (`resolveRequestScope`): what the door DERIVES
// ---------------------------------------------------------------------------

describe('[#13906 / 1A] HttpDispatcher.resolveRequestScope — the tenancy posture seam on the dispatcher wiring', () => {
    it('POSITIVE CONTROL: a healthy `isolated` tenancy service reaches the resolver on THIS wiring — the ex-member key is refused (guest)', async () => {
        const context = requestWith({ 'x-api-key': RAW_EXMEMBER });
        await dispatcherOn(kernelWith('healthy-isolated')).resolveRequestScope(context, '/data/task');
        // The membership refusal fires and the request resolves as a GUEST —
        // this is what distinguishes "the refusal was skipped" (next test)
        // from "the refusal never applied to this fixture".
        expect(context.executionContext).toBeDefined();
        expect(context.executionContext.userId).toBeUndefined();
    });

    it('REPAIRED: tenancy REGISTERED AND FAILING (factory throws) → the identity step raises AuthzStoreUnavailableError (503) — no longer an admitted principal', async () => {
        // SUPERSEDED PIN, quoted — what origin/main answered on this wiring:
        //     await dispatcher.resolveRequestScope(context, '/data/task');   // resolved
        //     expect(context.executionContext.userId).toBe('u_exmember');    // admitted, full grants
        // `resolveService` absorbed the factory's rejection into `undefined`,
        // the resolver read that as "no posture", and the Layer 0 refusal
        // never ran.
        const context = requestWith({ 'x-api-key': RAW_EXMEMBER });
        const err: any = await rejectionOf(dispatcherOn(kernelWith('factory-throws')).resolveRequestScope(context, '/data/task'));
        expect(err, 'the identity step RESOLVED — the failed build read as "no wall"').toBeDefined();
        expect(isAuthzStoreUnavailableError(err)).toBe(true);
        expect(err.code).toBe('SERVICE_UNAVAILABLE');
        expect(err.status).toBe(503);
        expect(err.object).toBe('tenancy');
        // Nothing was written on the context — an outage leaves no principal behind.
        expect(context.executionContext).toBeUndefined();
    });

    it('SUPPORTED, unchanged: tenancy NEVER registered → quiet `undefined` posture, the key is admitted (the no-tenancy composition)', async () => {
        // No wall exists here, and an org-stamped key working is by design.
        // This is the composition a careless repair breaks; it must be
        // byte-for-byte what it was.
        const context = requestWith({ 'x-api-key': RAW_EXMEMBER });
        await dispatcherOn(kernelWith('unregistered')).resolveRequestScope(context, '/data/task');
        expect(context.executionContext.userId).toBe('u_exmember');
        expect(context.executionContext.tenantId).toBe('org_A');
    });

    it('THE COLLAPSE IS ENDED: "registered and failed" and "never registered" no longer answer alike on this wiring', async () => {
        const failedCtx = requestWith({ 'x-api-key': RAW_EXMEMBER });
        const failed: any = await rejectionOf(dispatcherOn(kernelWith('factory-throws')).resolveRequestScope(failedCtx, '/data/task'));
        const absentCtx = requestWith({ 'x-api-key': RAW_EXMEMBER });
        await dispatcherOn(kernelWith('unregistered')).resolveRequestScope(absentCtx, '/data/task');
        expect(isAuthzStoreUnavailableError(failed)).toBe(true);
        expect(absentCtx.executionContext.userId).toBe('u_exmember');
    });

    it('every OTHER fault of the identity step still degrades to anonymous — only the branded outage is re-raised', async () => {
        // The net around the identity step keeps its fail-closed shape for
        // everything except the one class the ruling requires to stay loud:
        // an engine whose `find` throws a plain Error is not an authz-store
        // outage (the API-key lookup fails closed to "no key"), so the request
        // resolves as a guest exactly as before.
        const kernel = new ObjectKernel({ skipSystemValidation: true, gracefulShutdown: false } as any);
        kernel.registerService('objectql', { find: async () => { throw new Error('plain engine fault'); } });
        kernel.registerService('tenancy', { posture: 'isolated' });
        const context = requestWith({ 'x-api-key': RAW_EXMEMBER });
        await dispatcherOn(kernel).resolveRequestScope(context, '/data/task');
        expect(context.executionContext).toBeDefined();
        expect(context.executionContext.userId).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// §2 — the door: the outage LEAVES `dispatch()` and reaches the envelope
// ---------------------------------------------------------------------------

describe('[#13906 / 1A] the outage reaches the transport envelope as 503 SERVICE_UNAVAILABLE', () => {
    it('`dispatch()` re-raises the outage — no net inside the pipeline turns it back into an anonymous 200/401', async () => {
        const err: any = await rejectionOf(
            dispatcherOn(kernelWith('factory-throws')).dispatch('GET', '/data/task', undefined, {}, requestWith({ 'x-api-key': RAW_EXMEMBER })),
        );
        expect(err, '`dispatch()` RESOLVED — the outage was absorbed inside the pipeline').toBeDefined();
        expect(err.code).toBe('SERVICE_UNAVAILABLE');
        expect(err.status).toBe(503);
    });

    /** A fake `IHttpServer` recording the handlers the plugin mounts. */
    function makeFakeServer() {
        const handlers: Record<string, (req: any, res: any) => any> = {};
        const rec = (verb: string) => (path: string, handler: any) => { handlers[`${verb} ${path}`] = handler; };
        return {
            handlers,
            server: { get: rec('GET'), post: rec('POST'), put: rec('PUT'), delete: rec('DELETE'), patch: rec('PATCH') },
        };
    }

    async function mountOn(kernel: ObjectKernel) {
        const { server, handlers } = makeFakeServer();
        const plugin = createDispatcherPlugin({ prefix: '/api/v1', securityHeaders: false });
        await plugin.start?.({
            getKernel: () => kernel,
            getService: (n: string) => (n === 'http.server' ? server : undefined),
            environmentId: undefined,
            logger: { info() {}, warn() {}, error() {}, debug() {} },
            hook: () => {}, on: () => {},
        } as any);
        return handlers;
    }

    async function drive(handler: (req: any, res: any) => any, req: any) {
        expect(handler, 'route must be mounted').toBeTypeOf('function');
        const res: any = {
            statusCode: undefined, body: undefined,
            status(c: number) { res.statusCode = c; return res; },
            header() { return res; },
            json(b: any) { res.body = b; return res; },
            end() { return res; },
        };
        await handler(req, res);
        return { status: res.statusCode as number, body: res.body };
    }

    // The wire route is `GET /automation` with the ex-member key, chosen by
    // MEASUREMENT on the unrepaired tree so that each tenancy state answers
    // differently and no domain-side 503 is in the way (`POST /keys` answers
    // its own `503 Data service not available` against a fixture engine
    // with no `insert`, so it cannot pin this seam):
    //
    //   tenancy service   | before (origin/main) | after
    //   ------------------|----------------------|-------
    //   healthy isolated  | 401 UNAUTHENTICATED  | 401 — the membership refusal, unchanged
    //   never registered  | 501 NOT_IMPLEMENTED  | 501 — admitted, then "no automation service", unchanged
    //   registered+FAILED | 501 NOT_IMPLEMENTED  | 503 SERVICE_UNAVAILABLE
    //
    // The 501 on the failed leg is the defect on the wire: byte-for-byte the
    // "never registered" answer, i.e. the ex-member was ADMITTED.
    const AUTOMATION = 'GET /api/v1/automation';
    const withKey = { headers: { 'x-api-key': RAW_EXMEMBER }, query: {} };

    it('POSITIVE CONTROL on the wire: healthy `isolated` tenancy → the ex-member key is refused on the anonymous floor (401)', async () => {
        const handlers = await mountOn(kernelWith('healthy-isolated'));
        const { status, body } = await drive(handlers[AUTOMATION], withKey);
        expect(status).toBe(401);
        expect(body?.error?.code).toBe('UNAUTHENTICATED');
    });

    it('REPAIRED on the wire (real route, real `errorResponseBase`): registered and FAILING → 503 with a declared `SERVICE_UNAVAILABLE` envelope', async () => {
        // SUPERSEDED PIN, quoted — measured on origin/main:
        //     expect(status).toBe(501);
        //     expect(body?.error?.code).toBe('NOT_IMPLEMENTED');
        const handlers = await mountOn(kernelWith('factory-throws'));
        const { status, body } = await drive(handlers[AUTOMATION], withKey);
        expect(status).toBe(503);
        expect(BaseResponseSchema.safeParse(body).success).toBe(true);
        expect(body?.success).toBe(false);
        const parsed = ApiErrorSchema.safeParse(body?.error);
        expect(parsed.error?.issues ?? []).toEqual([]);
        expect(body?.error?.code).toBe('SERVICE_UNAVAILABLE');
    });

    it('THE COLLAPSE IS ENDED on the wire: never registered keeps its 501 (admitted, no automation service) — only the FAILED leg moved', async () => {
        const handlers = await mountOn(kernelWith('unregistered'));
        const { status, body } = await drive(handlers[AUTOMATION], withKey);
        expect(status).toBe(501);
        expect(body?.error?.code).toBe('NOT_IMPLEMENTED');
    });

    it('CONTROL on the wire: with tenancy never registered the same door serves — the no-tenancy composition is untouched', async () => {
        const handlers = await mountOn(kernelWith('unregistered'));
        const { status } = await drive(handlers['GET /api/v1/health'], { headers: {} });
        expect(status).toBe(200);
    });
});
