// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// ADR-0143 D5 — the connector connection door: `GET` / `POST` / `DELETE
// /automation/connectors/:name/connection` and `GET /automation/connectors/
// oauth/callback`.
//
// What is pinned here is the DOOR: who may reach it (the organization-scoped
// `manage_connector_connections`, and not the platform-scoped `manage_metadata`,
// under every posture — a connection belongs to its organization), what it accepts
// (no query parameter on the connection routes; the closed authorization-
// response set on the callback, each once), how the service's refusals reach
// the wire, and that a token never travels back out. The connect flow, the
// store and the dispatch behind it are pinned in service-automation
// (`connector-connection-door.test.ts`).

import { describe, it, expect, vi } from 'vitest';

import { PLATFORM_CAPABILITIES } from '@objectstack/spec/security';

import { HttpDispatcher } from '../http-dispatcher.js';
import type { HttpProtocolContext } from '../http-dispatcher.js';
import { CONNECTOR_CONNECTION_CAPABILITY, CONNECTOR_OAUTH_CALLBACK_QUERY_PARAMS } from './automation.js';

/** An authorization code as a callback carries it — a dummy. */
const AUTH_CODE = 'dummy-authorization-code';

const STATE = { connector: 'crm', organizationId: 'org_a', status: 'connected', scopes: 'crm.read' };
const BEGUN = { connector: 'crm', organizationId: 'org_a', authorizationUrl: 'https://idp.example.com/authorize?state=s', expiresAt: '2026-10-31T00:10:00.000Z' };

interface Harness {
    dispatcher: HttpDispatcher;
    get: ReturnType<typeof vi.fn>;
    begin: ReturnType<typeof vi.fn>;
    complete: ReturnType<typeof vi.fn>;
    revoke: ReturnType<typeof vi.fn>;
}

function boot(opts: { posture?: 'single' | 'group' | 'isolated'; service?: Record<string, unknown>; complete?: (req: any) => Promise<unknown> } = {}): Harness {
    const get = vi.fn(async () => STATE);
    const begin = vi.fn(async () => BEGUN);
    const complete = vi.fn(opts.complete ?? (async () => STATE));
    const revoke = vi.fn(async () => ({ connector: 'crm', organizationId: 'org_a', status: 'not_connected' }));
    const services: Record<string, unknown> = {
        automation: opts.service ?? {
            handlerReady: true,
            getConnectorConnection: get,
            beginConnectorConnection: begin,
            completeConnectorConnection: complete,
            revokeConnectorConnection: revoke,
        },
        tenancy: { posture: opts.posture ?? 'single' },
    };
    const resolve = (name: string): unknown => services[name];
    const kernel = { getService: resolve, getServiceAsync: async (name: string) => resolve(name), context: { getService: resolve } };
    return { dispatcher: new HttpDispatcher(kernel as never), get, begin, complete, revoke };
}

/** A caller holding exactly `systemPermissions`, in organization `tenantId` (default `org_a`). */
const HOLDING = (systemPermissions: string[], userId = 'u_admin', tenantId = 'org_a'): HttpProtocolContext => ({
    request: {},
    executionContext: { userId, tenantId, positions: [], permissions: [], systemPermissions },
} as HttpProtocolContext);

/** The connection administrator: the capability, and nothing else. */
const ADMIN = (): HttpProtocolContext => HOLDING(['manage_connector_connections']);

const MEMBER = (): HttpProtocolContext => HOLDING([], 'u_member');

/**
 * The organization administrator's shipped grant (`organization_admin` in
 * plugin-security's default sets, which `organization_admin_no_bypass`
 * inherits), transcribed: since ruling B (record 6545223261) it carries the
 * connection capability. The source is pinned in plugin-security's
 * `default-permission-sets.test.ts`; this transcription pins what the door does
 * with it.
 */
const ORG_ADMIN_GRANT = ['manage_org_users', 'setup.access', 'setup.write', 'manage_mailboxes', 'manage_connector_connections'];

/**
 * The same organization administrator, active in ANOTHER organization where they
 * are a plain member. Their `organization_admin` grant is organization-scoped,
 * and core's resolver applies such a grant only in the organization it names
 * (`grantAppliesInTenant`), so what reaches the door there is the member
 * baseline: no system permission at all.
 */
const ORG_ADMIN_IN_ANOTHER_ORGANIZATION = (): HttpProtocolContext => HOLDING([], 'u_orgadmin', 'org_b');

const ANONYMOUS = (): HttpProtocolContext => ({ request: {}, executionContext: {} } as HttpProtocolContext);

const statusOf = (r: unknown): unknown => (r as any)?.status;
const codeOf = (r: unknown): unknown => (r as any)?.body?.error?.code;
const messageOf = (r: unknown): string => String((r as any)?.body?.error?.message ?? '');

const connection = (h: Harness, verb: 'GET' | 'POST' | 'DELETE', ctx: HttpProtocolContext, name = 'crm', query?: unknown) =>
    h.dispatcher.handleAutomation(`/connectors/${encodeURIComponent(name)}/connection`, verb, undefined, ctx, query);
const callback = (h: Harness, ctx: HttpProtocolContext, query?: unknown) =>
    h.dispatcher.handleAutomation('/connectors/oauth/callback', 'GET', undefined, ctx, query);

describe('ADR-0143 D5 — connector connection door: who may reach it', () => {
    it('answers an anonymous caller 401 before anything else', async () => {
        const h = boot();
        for (const call of [() => connection(h, 'GET', ANONYMOUS()), () => callback(h, ANONYMOUS(), { code: AUTH_CODE, state: 's' })]) {
            expect(statusOf((await call()).response)).toBe(401);
        }
        expect(h.get).not.toHaveBeenCalled();
        expect(h.complete).not.toHaveBeenCalled();
    });

    it.each([
        ['GET', (h: Harness) => connection(h, 'GET', MEMBER())],
        ['POST', (h: Harness) => connection(h, 'POST', MEMBER())],
        ['DELETE', (h: Harness) => connection(h, 'DELETE', MEMBER())],
        ['GET callback', (h: Harness) => callback(h, MEMBER(), { code: AUTH_CODE, state: 's' })],
    ] as const)('%s without `manage_connector_connections` is refused 403 and never reaches the service', async (_verb, call) => {
        const h = boot();
        const { response } = await call(h);
        expect(statusOf(response)).toBe(403);
        expect(codeOf(response)).toBe('PERMISSION_DENIED');
        expect(messageOf(response)).toContain('`manage_connector_connections`');
        for (const member of [h.get, h.begin, h.complete, h.revoke]) expect(member).not.toHaveBeenCalled();
    });

    it('asks the organization-scoped capability the spec declares for it', () => {
        expect(CONNECTOR_CONNECTION_CAPABILITY).toBe('manage_connector_connections');
        expect(PLATFORM_CAPABILITIES.find((c) => c.name === CONNECTOR_CONNECTION_CAPABILITY)?.scope).toBe('org');
    });

    const EVERY_MEMBER = [
        ['GET', (h: Harness, ctx: HttpProtocolContext) => connection(h, 'GET', ctx), (h: Harness) => h.get],
        ['POST', (h: Harness, ctx: HttpProtocolContext) => connection(h, 'POST', ctx), (h: Harness) => h.begin],
        ['DELETE', (h: Harness, ctx: HttpProtocolContext) => connection(h, 'DELETE', ctx), (h: Harness) => h.revoke],
        ['GET callback', (h: Harness, ctx: HttpProtocolContext) => callback(h, ctx, { code: AUTH_CODE, state: 's' }), (h: Harness) => h.complete],
    ] as const;

    it.each(EVERY_MEMBER)('%s: the platform-scoped `manage_metadata` alone no longer admits the caller', async (_verb, call) => {
        for (const grant of [['manage_metadata'], ['manage_metadata', 'studio.access', 'setup.access', 'manage_users', 'manage_platform_settings']]) {
            const h = boot();
            const { response } = await call(h, HOLDING(grant));
            expect(statusOf(response)).toBe(403);
            expect(codeOf(response)).toBe('PERMISSION_DENIED');
            for (const member of [h.get, h.begin, h.complete, h.revoke]) expect(member).not.toHaveBeenCalled();
        }
    });

    it.each(EVERY_MEMBER)('%s: an organization administrator on the shipped grant is admitted for their own organization, and refused in another', async (_verb, call, member) => {
        const admitted = boot();
        const allowed = await call(admitted, HOLDING(ORG_ADMIN_GRANT, 'u_orgadmin'));
        expect(statusOf(allowed.response)).toBe(200);
        expect(member(admitted)).toHaveBeenCalledTimes(1);
        // The door acts on the caller's own organization: the service is handed
        // `org_a` and nothing that could name another.
        expect(member(admitted)).toHaveBeenCalledWith(
            expect.objectContaining({ context: expect.objectContaining({ userId: 'u_orgadmin', tenantId: 'org_a' }) }),
        );

        const refused = boot();
        const denied = await call(refused, ORG_ADMIN_IN_ANOTHER_ORGANIZATION());
        expect(statusOf(denied.response)).toBe(403);
        expect(codeOf(denied.response)).toBe('PERMISSION_DENIED');
        expect(messageOf(denied.response)).toContain('`manage_connector_connections`');
        for (const m of [refused.get, refused.begin, refused.complete, refused.revoke]) expect(m).not.toHaveBeenCalled();
    });

    it('the system context passes without the capability; an absent capability list is refused (fail-closed)', async () => {
        const system = boot();
        const sys = { request: {}, executionContext: { userId: 'system', isSystem: true } } as HttpProtocolContext;
        expect(statusOf((await connection(system, 'GET', sys)).response)).toBe(200);
        const absent = boot();
        const noList = { request: {}, executionContext: { userId: 'u_x', tenantId: 'org_a' } } as HttpProtocolContext;
        expect(statusOf((await connection(absent, 'GET', noList)).response)).toBe(403);
        expect(absent.get).not.toHaveBeenCalled();
    });

    it('a walled posture does not refuse the holder: a connection belongs to its organization', async () => {
        for (const posture of ['group', 'isolated'] as const) {
            const h = boot({ posture });
            expect(statusOf((await connection(h, 'GET', ADMIN())).response)).toBe(200);
        }
    });
});

describe('ADR-0143 D5 — connector connection door: what it accepts', () => {
    it('GET / POST / DELETE hand the decoded name and the caller to their members, and answer what they answer', async () => {
        const h = boot();
        const got = await connection(h, 'GET', ADMIN(), 'vendor/crm');
        expect((got.response as any).body.data).toEqual(STATE);
        expect(h.get).toHaveBeenCalledWith({ connector: 'vendor/crm', context: expect.objectContaining({ userId: 'u_admin', tenantId: 'org_a' }) });
        const begun = await connection(h, 'POST', ADMIN());
        expect((begun.response as any).body.data).toEqual(BEGUN);
        expect(h.begin).toHaveBeenCalledWith({ connector: 'crm', context: expect.objectContaining({ userId: 'u_admin' }) });
        const revoked = await connection(h, 'DELETE', ADMIN());
        expect((revoked.response as any).body.data).toMatchObject({ status: 'not_connected' });
        expect(h.revoke).toHaveBeenCalledTimes(1);
    });

    it('route rule 5: the connection routes take no query parameter, refused 400 naming it', async () => {
        const h = boot();
        for (const verb of ['GET', 'POST', 'DELETE'] as const) {
            const { response } = await connection(h, verb, ADMIN(), 'crm', { redirect_uri: 'https://evil.example.com' });
            expect(statusOf(response)).toBe(400);
            expect(codeOf(response)).toBe('VALIDATION_ERROR');
            expect(messageOf(response)).toContain('redirect_uri');
        }
        for (const member of [h.get, h.begin, h.revoke]) expect(member).not.toHaveBeenCalled();
    });

    it('the callback takes exactly the authorization-response set, and hands it over as given', async () => {
        expect([...CONNECTOR_OAUTH_CALLBACK_QUERY_PARAMS]).toEqual(['code', 'state', 'error', 'error_description', 'error_uri', 'iss']);
        const h = boot();
        const query = { code: 'dummy-code', state: 'dummy-state', iss: 'https://idp.example.com' };
        const { response } = await callback(h, ADMIN(), query);
        expect(statusOf(response)).toBe(200);
        expect((response as any).body.data).toEqual(STATE);
        expect(h.complete).toHaveBeenCalledWith({ query, context: expect.objectContaining({ userId: 'u_admin', tenantId: 'org_a' }) });
        // Every member of the set is accepted (preservation pin for the closed set).
        const all = Object.fromEntries(CONNECTOR_OAUTH_CALLBACK_QUERY_PARAMS.map((k) => [k, `v-${k}`]));
        expect(statusOf((await callback(h, ADMIN(), all)).response)).toBe(200);
    });

    it('the callback refuses an unknown parameter (a redirect_uri above all) and a repeated one, before the service', async () => {
        const h = boot();
        const unknown = await callback(h, ADMIN(), { code: AUTH_CODE, state: 's', redirect_uri: 'https://evil.example.com' });
        expect(statusOf(unknown.response)).toBe(400);
        expect(messageOf(unknown.response)).toContain('redirect_uri');
        const repeated = await callback(h, ADMIN(), { code: AUTH_CODE, state: ['s1', 's2'] });
        expect(statusOf(repeated.response)).toBe(400);
        expect(codeOf(repeated.response)).toBe('VALIDATION_ERROR');
        expect(messageOf(repeated.response)).toContain('`state` is repeated');
        expect(h.complete).not.toHaveBeenCalled();
    });

    it("answers the service's own refusals with their status and code, never the code it was handed", async () => {
        const refusal = (message: string, code: string, status: number) => Object.assign(new Error(message), { code, status });
        for (const [code, status] of [['VALIDATION_ERROR', 400], ['RESOURCE_NOT_FOUND', 404], ['SERVICE_UNAVAILABLE', 503]] as const) {
            const h = boot({ complete: async () => { throw refusal(`refused ${code}`, code, status); } });
            const { response } = await callback(h, ADMIN(), { code: 'dummy-code-26702', state: 's' });
            expect(statusOf(response)).toBe(status);
            expect(codeOf(response)).toBe(code);
            expect(messageOf(response)).toBe(`refused ${code}`);
            expect(JSON.stringify(response)).not.toContain('dummy-code-26702');
        }
    });

    it('a service without the optional members answers 501, never a 200 or a fall-through', async () => {
        const h = boot({ service: { handlerReady: true } });
        for (const call of [
            () => connection(h, 'GET', ADMIN()),
            () => connection(h, 'POST', ADMIN()),
            () => connection(h, 'DELETE', ADMIN()),
            () => callback(h, ADMIN(), { code: AUTH_CODE, state: 's' }),
        ]) {
            const { response } = await call();
            expect(statusOf(response)).toBe(501);
            expect(codeOf(response)).toBe('NOT_IMPLEMENTED');
        }
    });
});
