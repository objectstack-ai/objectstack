// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#27237] The connector credential door — `GET /automation/connectors/
// credential-refs`, `PUT` / `DELETE …/credential-refs/:ref` (ruling A on
// #27230).
//
// What is pinned here is the DOOR: who may reach it (`manage_metadata`, then
// no walled posture at all — S1 on #27230), what it accepts (no query
// parameter, a closed `{ value }` body), how the service's refusals reach the
// wire, and that the value it carries in never travels back out — not in a
// success body and not in an error body. The store, the resolver chain and the
// reconcile behind it are pinned in service-automation
// (`connector-credential-door.test.ts`).

import { describe, it, expect, vi } from 'vitest';

import { HttpDispatcher } from '../http-dispatcher.js';
import type { HttpProtocolContext } from '../http-dispatcher.js';
import { connectorCredentialWalledMessage } from './automation.js';

/** An obvious dummy; never a real credential. */
const DUMMY_VALUE = 'dummy-credential-value-0001';
const REF = 'BILLING_TOKEN';

const ENTRY = {
    ref: REF,
    status: 'set',
    source: 'object',
    writable: true,
    declared: true,
    connectors: [{ name: 'billing', state: 'ready' }],
};

interface Harness {
    dispatcher: HttpDispatcher;
    list: ReturnType<typeof vi.fn>;
    set: ReturnType<typeof vi.fn>;
    clear: ReturnType<typeof vi.fn>;
}

function boot(opts: {
    posture?: 'single' | 'group' | 'isolated' | null;
    service?: Record<string, unknown>;
    set?: (req: any) => Promise<unknown>;
} = {}): Harness {
    const list = vi.fn(async () => [ENTRY]);
    const set = vi.fn(opts.set ?? (async () => ENTRY));
    const clear = vi.fn(async () => ({ ...ENTRY, status: 'missing', source: null }));
    const services: Record<string, unknown> = {
        automation: opts.service ?? {
            handlerReady: true,
            listConnectorCredentialRefs: list,
            setConnectorCredential: set,
            clearConnectorCredential: clear,
        },
    };
    const posture = opts.posture === undefined ? 'single' : opts.posture;
    if (posture) services.tenancy = { posture };
    const resolve = (name: string): unknown => services[name];
    const kernel = {
        getService: resolve,
        getServiceAsync: async (name: string) => resolve(name),
        context: { getService: resolve },
    };
    return { dispatcher: new HttpDispatcher(kernel as never), list, set, clear };
}

const ADMIN = (): HttpProtocolContext => ({
    request: {},
    executionContext: { userId: 'u_admin', positions: [], permissions: [], systemPermissions: ['manage_metadata'] },
} as HttpProtocolContext);

const MEMBER = (): HttpProtocolContext => ({
    request: {},
    executionContext: { userId: 'u_member', positions: [], permissions: [], systemPermissions: [] },
} as HttpProtocolContext);

/** The platform operator — refused under a wall all the same: the ruling admits nobody there. */
const OPERATOR = (): HttpProtocolContext => ({
    request: {},
    executionContext: {
        userId: 'u_operator',
        positions: ['platform_admin'],
        permissions: ['admin_full_access'],
        systemPermissions: ['manage_metadata'],
        posture: 'PLATFORM_ADMIN',
    },
} as HttpProtocolContext);

const ANONYMOUS = (): HttpProtocolContext => ({ request: {}, executionContext: {} } as HttpProtocolContext);

const statusOf = (r: unknown): unknown => (r as any)?.status;
const codeOf = (r: unknown): unknown => (r as any)?.body?.error?.code;
const messageOf = (r: unknown): string => String((r as any)?.body?.error?.message ?? '');

const get = (h: Harness, ctx: HttpProtocolContext, query?: unknown) =>
    h.dispatcher.handleAutomation('/connectors/credential-refs', 'GET', undefined, ctx, query);
const put = (h: Harness, ctx: HttpProtocolContext, body: unknown, ref = REF, query?: unknown) =>
    h.dispatcher.handleAutomation(`/connectors/credential-refs/${encodeURIComponent(ref)}`, 'PUT', body, ctx, query);
const del = (h: Harness, ctx: HttpProtocolContext, ref = REF) =>
    h.dispatcher.handleAutomation(`/connectors/credential-refs/${encodeURIComponent(ref)}`, 'DELETE', undefined, ctx, undefined);

describe('[#27237] connector credential door — who may reach it', () => {
    it('answers an anonymous caller 401 before anything else', async () => {
        const h = boot();
        const { response } = await get(h, ANONYMOUS());
        expect(statusOf(response)).toBe(401);
        expect(h.list).not.toHaveBeenCalled();
    });

    it.each([
        ['GET', (h: Harness) => get(h, MEMBER())],
        ['PUT', (h: Harness) => put(h, MEMBER(), { value: DUMMY_VALUE })],
        ['DELETE', (h: Harness) => del(h, MEMBER())],
    ] as const)('%s without `manage_metadata` is refused 403 and never reaches the service', async (_verb, call) => {
        const h = boot();
        const { response } = await call(h);
        expect(statusOf(response)).toBe(403);
        expect(codeOf(response)).toBe('PERMISSION_DENIED');
        expect(messageOf(response)).toContain('`manage_metadata`');
        expect(h.list).not.toHaveBeenCalled();
        expect(h.set).not.toHaveBeenCalled();
        expect(h.clear).not.toHaveBeenCalled();
    });

    for (const posture of ['group', 'isolated'] as const) {
        it.each([
            ['GET', (h: Harness, ctx: HttpProtocolContext) => get(h, ctx)],
            ['PUT', (h: Harness, ctx: HttpProtocolContext) => put(h, ctx, { value: DUMMY_VALUE })],
            ['DELETE', (h: Harness, ctx: HttpProtocolContext) => del(h, ctx)],
        ] as const)(`\`${posture}\`: %s is refused for every caller, naming the posture`, async (_verb, call) => {
            for (const ctx of [ADMIN(), OPERATOR()]) {
                const h = boot({ posture });
                const { response } = await call(h, ctx);
                expect(statusOf(response)).toBe(403);
                expect(codeOf(response)).toBe('PERMISSION_DENIED');
                expect(messageOf(response)).toBe(connectorCredentialWalledMessage(posture));
                expect(messageOf(response)).toContain(`'${posture}' tenancy posture`);
                expect(h.list).not.toHaveBeenCalled();
                expect(h.set).not.toHaveBeenCalled();
                expect(h.clear).not.toHaveBeenCalled();
            }
        });
    }

    it('`single` and no tenancy service at all admit the `manage_metadata` holder', async () => {
        for (const posture of ['single', null] as const) {
            const h = boot({ posture });
            const { response } = await get(h, ADMIN());
            expect(statusOf(response)).toBe(200);
            expect((response as any).body.data).toEqual({ credentialRefs: [ENTRY], total: 1 });
        }
    });
});

describe('[#27237] connector credential door — what it accepts', () => {
    it('route rule 5: any query parameter is refused 400, naming it', async () => {
        const h = boot();
        const { response } = await get(h, ADMIN(), { status: 'missing' });
        expect(statusOf(response)).toBe(400);
        expect(codeOf(response)).toBe('VALIDATION_ERROR');
        expect(messageOf(response)).toContain('status');
        expect(h.list).not.toHaveBeenCalled();
        const { response: putResponse } = await put(h, ADMIN(), { value: DUMMY_VALUE }, REF, { force: 'true' });
        expect(statusOf(putResponse)).toBe(400);
        expect(h.set).not.toHaveBeenCalled();
    });

    it('PUT hands the decoded reference, the value and the caller to the service, and answers the entry without the value', async () => {
        const h = boot();
        const { response } = await put(h, ADMIN(), { value: DUMMY_VALUE }, 'VENDOR/KEY');
        expect(statusOf(response)).toBe(200);
        expect(h.set).toHaveBeenCalledWith(expect.objectContaining({
            ref: 'VENDOR/KEY',
            value: DUMMY_VALUE,
            context: expect.objectContaining({ userId: 'u_admin' }),
        }));
        expect((response as any).body.data).toEqual(ENTRY);
        expect(JSON.stringify(response)).not.toContain(DUMMY_VALUE);
    });

    it('PUT refuses a body that is not an object, and an unknown key by NAME, never echoing what it carried', async () => {
        const h = boot();
        const notObject = await put(h, ADMIN(), DUMMY_VALUE);
        expect(statusOf(notObject.response)).toBe(400);
        expect(JSON.stringify(notObject.response)).not.toContain(DUMMY_VALUE);

        const misspelled = await put(h, ADMIN(), { secret: DUMMY_VALUE });
        expect(statusOf(misspelled.response)).toBe(400);
        expect(codeOf(misspelled.response)).toBe('VALIDATION_ERROR');
        expect(messageOf(misspelled.response)).toContain('`secret`');
        expect(JSON.stringify(misspelled.response)).not.toContain(DUMMY_VALUE);
        expect(h.set).not.toHaveBeenCalled();
    });

    it("answers the service's own refusals with their status and code", async () => {
        const refusal = (message: string, code: string, status: number) =>
            Object.assign(new Error(message), { code, status });
        for (const [code, status] of [
            ['VALIDATION_ERROR', 400],
            ['RESOURCE_NOT_FOUND', 404],
            ['RESOURCE_CONFLICT', 409],
            ['SERVICE_UNAVAILABLE', 503],
        ] as const) {
            const h = boot({ set: async () => { throw refusal(`refused ${code}`, code, status); } });
            const { response } = await put(h, ADMIN(), { value: DUMMY_VALUE });
            expect(statusOf(response)).toBe(status);
            expect(codeOf(response)).toBe(code);
            expect(messageOf(response)).toBe(`refused ${code}`);
            expect(JSON.stringify(response)).not.toContain(DUMMY_VALUE);
        }
    });

    it('DELETE hands the reference and the caller to the service', async () => {
        const h = boot();
        const { response } = await del(h, ADMIN());
        expect(statusOf(response)).toBe(200);
        expect(h.clear).toHaveBeenCalledWith(expect.objectContaining({
            ref: REF,
            context: expect.objectContaining({ userId: 'u_admin' }),
        }));
    });

    it('a service without the optional members answers 501, never a 200 or a fall-through', async () => {
        const h = boot({ service: { handlerReady: true } });
        for (const call of [() => get(h, ADMIN()), () => put(h, ADMIN(), { value: DUMMY_VALUE }), () => del(h, ADMIN())]) {
            const { response } = await call();
            expect(statusOf(response)).toBe(501);
            expect(codeOf(response)).toBe('NOT_IMPLEMENTED');
        }
    });
});
