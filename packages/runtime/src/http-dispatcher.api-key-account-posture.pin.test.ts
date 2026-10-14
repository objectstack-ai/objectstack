// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23287 — ruling C′ item 3] The dispatcher face judges a key-admitted
 * request by the KEY's answer, from the shared key-admission seam.
 *
 * ## What was open
 *
 * `HttpDispatcher.enforceAuthGate` re-read the session cookie whatever had
 * admitted the caller. A key sent alone carried no posture at all, so a key
 * whose owner owes MFA enrolment was served; the same key beside a held cookie
 * was refused with the cookie's posture.
 *
 * ## What is pinned, through `dispatch()`
 *
 *  - a key whose owner holds `MFA_REQUIRED` (scope `account`) → `403
 *    MFA_REQUIRED` with the session's message, and the route never runs;
 *  - a key whose owner holds only `PASSWORD_EXPIRED` / `PASSWORD_RESET_REQUIRED`
 *    → served;
 *  - a held cookie beside an un-held owner's key → served, the cookie never
 *    re-read for the gate;
 *  - the refusal is not a revocation: the same key is served once the posture
 *    clears;
 *  - control: a held SESSION, no key, is still refused through the re-read.
 *
 * The harness is `http-dispatcher.auth-gate-outage.pin.test.ts`'s, with a data
 * engine that knows the key.
 */

import { describe, it, expect, vi } from 'vitest';
import { hashApiKey } from '@objectstack/core';

import { HttpDispatcher } from './http-dispatcher.js';
import type { HttpProtocolContext } from './http-dispatcher.js';

const ORIGIN = 'http://tenant.example';
/** Not allow-listed, and the domain hands the request to a recording member. */
const ROUTE = '/webhooks/redeliver';
const JSON_HEADERS = { 'Content-Type': 'application/json' };

const KEY = 'osk_dispatcher_account_posture_pin';
const OWNER = 'u_key_owner';
const COOKIE_USER = 'u_cookie_holder';

const MFA_REQUIRED = {
    code: 'MFA_REQUIRED',
    message: 'Multi-factor authentication is required. Please set up an authenticator app to continue.',
};
const PASSWORD_EXPIRED = { code: 'PASSWORD_EXPIRED', message: 'Your password has expired. Please change it to continue.' };
const PASSWORD_RESET_REQUIRED = { code: 'PASSWORD_RESET_REQUIRED', message: 'You must change your password before continuing.' };

type Gate = { code: string; message: string };

function authService(postures: Record<string, Gate[]>, cookieGate?: Gate) {
    const getSession = vi.fn(async ({ headers }: { headers: Headers }) => {
        if (!headers.get('cookie')) return null;
        return {
            user: { id: COOKIE_USER, ...(cookieGate ? { authGate: cookieGate } : {}) },
            session: { userId: COOKIE_USER, activeOrganizationId: 'org_tenant' },
        };
    });
    return {
        getSession,
        service: {
            isAuthGateActive: () => true,
            getApi: async () => ({ getSession }),
            resolveUserAuthGates: async (userId: string) => postures[userId] ?? [],
        },
    };
}

function kernelWith(services: Record<string, unknown>): any {
    return {
        getState: () => 'running',
        getService: (n: string) => services[n] ?? null,
        getServiceAsync: async (n: string) => services[n] ?? null,
        context: { getService: (n: string) => services[n] ?? null },
    };
}

/** A data engine that knows exactly one API key, owned by `OWNER`. */
function objectqlWithKey() {
    const keyHash = hashApiKey(KEY);
    return {
        find: vi.fn(async (object: string, q: any) => (
            object === 'sys_api_key' && q?.where?.key === keyHash
                ? [{ id: 'key_1', key: keyHash, user_id: OWNER, revoked: false, scopes: '[]' }]
                : []
        )),
        getObjects: vi.fn().mockReturnValue({}),
        registry: {
            getObject: vi.fn().mockReturnValue(null),
            getRegisteredTypes: vi.fn().mockReturnValue([]),
        },
    };
}

function harness(postures: Record<string, Gate[]>, cookieGate?: Gate) {
    const auth = authService(postures, cookieGate);
    const handleRedeliver = vi.fn(async () => new Response(
        JSON.stringify({ success: true, data: { status: 'pending' } }),
        { status: 200, headers: JSON_HEADERS },
    ));
    const services = { objectql: objectqlWithKey(), auth: auth.service, webhooks: { handleRedeliver } };
    const dispatcher = new HttpDispatcher(kernelWith(services), undefined, { enforceProjectMembership: false });
    (dispatcher as any).domainDeps.logger = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
    return { dispatcher, auth, handleRedeliver };
}

const request = (headers: Record<string, string>) => new Request(`${ORIGIN}/api/v1${ROUTE}`, {
    method: 'POST',
    headers: { ...JSON_HEADERS, ...headers },
    body: JSON.stringify({ deliveryId: 'del_1' }),
});
const ctx = (r: Request): HttpProtocolContext => ({ request: r });

describe('dispatcher face — a key answers as its owner\'s session does (#23287, ruling C′)', () => {
    it('REFUSES a key whose owner holds MFA_REQUIRED with the session\'s 403 code and message, before the route', async () => {
        const { dispatcher, handleRedeliver } = harness({ [OWNER]: [MFA_REQUIRED] });
        const result: any = await dispatcher.dispatch('POST', ROUTE, {}, {}, ctx(request({ 'x-api-key': KEY })));
        expect(result.response?.status).toBe(403);
        expect(result.response?.body?.error?.code).toBe('MFA_REQUIRED');
        expect(result.response?.body?.error?.message).toBe(MFA_REQUIRED.message);
        expect(handleRedeliver).not.toHaveBeenCalled();
    });

    it('SERVES a key whose owner holds only credential-scope postures', async () => {
        const { dispatcher, handleRedeliver } = harness({ [OWNER]: [PASSWORD_RESET_REQUIRED, PASSWORD_EXPIRED] });
        const result: any = await dispatcher.dispatch('POST', ROUTE, {}, {}, ctx(request({ 'x-api-key': KEY })));
        expect(result.response?.status).not.toBe(403);
        expect(handleRedeliver).toHaveBeenCalledTimes(1);
    });

    it('judges the KEY, not a held cookie beside it, and never re-reads the cookie for it', async () => {
        const { dispatcher, auth, handleRedeliver } = harness({ [OWNER]: [] }, MFA_REQUIRED);
        const result: any = await dispatcher.dispatch(
            'POST', ROUTE, {}, {}, ctx(request({ 'x-api-key': KEY, cookie: 'session=held' })),
        );
        expect(result.response?.status).not.toBe(403);
        expect(handleRedeliver).toHaveBeenCalledTimes(1);
        expect(auth.getSession).not.toHaveBeenCalled();
    });

    it('the refusal is not a revocation: the same key is served again once the posture clears', async () => {
        const postures: Record<string, Gate[]> = { [OWNER]: [MFA_REQUIRED] };
        const { dispatcher, handleRedeliver } = harness(postures);
        const held: any = await dispatcher.dispatch('POST', ROUTE, {}, {}, ctx(request({ 'x-api-key': KEY })));
        expect(held.response?.status).toBe(403);
        postures[OWNER] = [];
        await dispatcher.dispatch('POST', ROUTE, {}, {}, ctx(request({ 'x-api-key': KEY })));
        expect(handleRedeliver).toHaveBeenCalledTimes(1);
    });

    it('control: a held SESSION, no key, is still refused through the gate\'s re-read', async () => {
        const { dispatcher, handleRedeliver } = harness({}, PASSWORD_EXPIRED);
        const result: any = await dispatcher.dispatch('POST', ROUTE, {}, {}, ctx(request({ cookie: 'session=held' })));
        expect(result.response?.status).toBe(403);
        expect(result.response?.body?.error?.code).toBe('PASSWORD_EXPIRED');
        expect(handleRedeliver).not.toHaveBeenCalled();
    });
});
