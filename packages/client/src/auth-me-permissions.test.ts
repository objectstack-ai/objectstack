// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#28709] `client.auth.mePermissions()`, the typed read of
 * `GET /auth/me/permissions`, whose body `MePermissionsResponseSchema`
 * (`@objectstack/spec/api`) declares strictly.
 *
 * Driven over the REAL handler: plugin-hono-server's
 * `registerCurrentUserEndpoints` mounted on the adapter's raw Hono app (the
 * one `HonoServerPlugin` mounts it on), with the client's
 * transport handing every request to that app. So the URL the method builds is
 * proven by the route answering it, and the body it resolves is the one the
 * handler actually writes, not a fixture typed to look like it. Same mount
 * shape as plugin-hono-server's own has-any-queue suite: the real registrar
 * and a locator that THROWS for an unregistered slot, as the kernel's does.
 */

import { describe, it, expect } from 'vitest';
import { MePermissionsResponseSchema } from '@objectstack/spec/api';
import { OWNERSHIP_QUEUE_SERVICE } from '@objectstack/spec/contracts';
import { HonoHttpServer, registerCurrentUserEndpoints } from '@objectstack/plugin-hono-server';
import { ObjectStackClient } from './index';
import { ROUTE_LEDGER } from '../../runtime/src/route-ledger';

const BASE = 'http://localhost:3000';
const USER = 'usr_member';
const ACTIVE_ORG = 'org_active';

type Row = Record<string, any>;

/** The session's organization membership: what the resolver reads to stamp `tenantId`. */
const TABLES: Record<string, Row[]> = {
    sys_user: [{ id: USER, email: 'member@example.com' }],
    sys_member: [{ user_id: USER, organization_id: ACTIVE_ORG, role: 'member' }],
};

/** Scalar equality only; any combinator is refused rather than misread. */
function matches(row: Row, where: Row | undefined): boolean {
    return Object.entries(where ?? {}).every(([key, cond]) => {
        if (key.startsWith('$') || (cond !== null && typeof cond === 'object')) {
            throw new Error(`fake driver: unsupported predicate on ${key}`);
        }
        return (row[key] ?? null) === (cond ?? null);
    });
}

const ql = {
    find: async (object: string, opts: any) => {
        const rows = (TABLES[object] ?? []).filter((r) => matches(r, opts?.where));
        return typeof opts?.limit === 'number' ? rows.slice(0, opts.limit) : rows;
    },
    registry: { getAllApps: () => [], getAllObjects: () => [] },
    getSchema: () => undefined,
};

/** A client whose every request is answered by the real current-user handlers. */
function mount({ signedIn }: { signedIn: boolean }) {
    const services: Record<string, unknown> = {
        auth: {
            api: {
                getSession: async () => (signedIn
                    ? { user: { id: USER, email: 'member@example.com' }, session: { activeOrganizationId: ACTIVE_ORG } }
                    : null),
            },
        },
        objectql: ql,
        metadata: { list: async () => [] as unknown[] },
        security: {
            resolvePermissionSetsForContext: async () => [
                { name: 'member_default', systemPermissions: [], objects: {}, fields: {} },
            ],
        },
        [OWNERSHIP_QUEUE_SERVICE]: { hasAnyQueue: async () => true },
    };
    // The adapter's own Hono app, never listening: the app the plugin mounts on.
    const app = new HonoHttpServer(0).getRawApp();
    registerCurrentUserEndpoints({
        rawApp: app,
        ctx: {
            logger: { debug() {}, warn() {} },
            getService: <T,>(name: string): T => {
                if (!(name in services)) throw new Error(`[Kernel] Service '${name}' not found`);
                return services[name] as T;
            },
        },
    });
    const requests: Array<{ method: string; url: string }> = [];
    const client = new ObjectStackClient({
        baseUrl: BASE,
        fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
            requests.push({ method: (init?.method ?? 'GET').toUpperCase(), url: String(input) });
            return app.request(String(input), init);
        },
    });
    return { client, requests };
}

describe('[#28709] client.auth.mePermissions over the real /auth/me/permissions handler', () => {
    it('GETs /api/v1/auth/me/permissions and resolves the authenticated body the handler writes', async () => {
        const { client, requests } = mount({ signedIn: true });
        const answer = await client.auth.mePermissions();

        expect(requests).toEqual([{ method: 'GET', url: `${BASE}/api/v1/auth/me/permissions` }]);
        // The declared contract holds the resolved value: a key the handler
        // sends that the spec does not declare reds here.
        const parsed = MePermissionsResponseSchema.safeParse(answer);
        expect(parsed.success ? [] : parsed.error.issues).toEqual([]);
        // The type narrows on the discriminator, onto the caller's own facts.
        if (!answer.authenticated) throw new Error('expected the authenticated branch');
        expect(answer.userId).toBe(USER);
        expect(answer.tenantId).toBe(ACTIVE_ORG);
        expect(answer.hasAnyQueue).toBe(true);
        expect(answer.permissionSets).toContain('member_default');
    });

    it('an anonymous caller resolves { authenticated: false }, not a throw', async () => {
        const { client } = mount({ signedIn: false });
        const answer = await client.auth.mePermissions();
        expect(answer).toEqual({ authenticated: false });
        expect(MePermissionsResponseSchema.safeParse(answer).success).toBe(true);
    });

    it('the route ledger names this method and the schema these cases parse with', () => {
        const row = ROUTE_LEDGER.find((r) => r.route === 'GET /auth/me/permissions');
        expect(row).toMatchObject({
            domain: '/auth',
            disposition: 'sdk',
            client: 'auth.mePermissions',
            responseSchema: 'MePermissionsResponseSchema',
        });
    });
});
