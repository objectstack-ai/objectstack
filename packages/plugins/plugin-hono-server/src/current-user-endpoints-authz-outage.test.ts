// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#13279 / #24061] An authorization store that cannot be read is an OUTAGE on
// the current-user faces, never a signed-out caller.
//
// Since #24061 these faces resolve their caller through `resolveAuthzContext`,
// which places them in the #13279 ruling's transport ledger
// (`packages/core/src/security/authz-store-unavailable.test.ts`). The ruling:
// a transport's fail-closed net re-raises `AuthzStoreUnavailableError` rather
// than degrading it, because the degraded answer here — `{ authenticated:
// false }` — is byte-identical to a genuine anonymous caller. These cases pin
// the behaviour at the route, not the spelling the ledger greps for:
//
//  - a permission-store read that FAILS escapes to the host's error seam as the
//    branded outage (on `HonoHttpServer` that seam answers `503
//    SERVICE_UNAVAILABLE`);
//  - CONTROL: a store that was never PROVISIONED (missing tables) is not an
//    outage — the face still answers its authenticated, empty-grant body.

import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { isAuthzStoreUnavailableError } from '@objectstack/core';
import { registerCurrentUserEndpoints } from './current-user-endpoints';

const ME_PERMISSIONS = '/api/v1/auth/me/permissions';
const USER = 'usr_outage';

/** A data engine whose every read throws `fault`. */
const failingQl = (fault: () => Error) => ({
    find: async () => { throw fault(); },
    registry: { getAllApps: () => [], getAllObjects: () => [] },
    getSchema: () => undefined,
});

function mount(fault: () => Error) {
    const escaped: unknown[] = [];
    const services: Record<string, unknown> = {
        auth: {
            api: {
                getSession: async () => ({
                    user: { id: USER, email: 'outage@example.com' },
                    session: { activeOrganizationId: null },
                }),
            },
        },
        objectql: failingQl(fault),
    };
    const app = new Hono();
    app.onError((err, c) => {
        escaped.push(err);
        return c.json({ escaped: true }, 503);
    });
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
    return { app, escaped };
}

describe('[#13279] the current-user faces re-raise an authorization-store outage', () => {
    it('a failed permission-store read escapes as the branded outage, not as a signed-out body', async () => {
        const { app, escaped } = mount(() => new Error('connection refused'));

        const res = await app.request(`http://localhost${ME_PERMISSIONS}`);

        expect(res.status).toBe(503);
        expect(await res.json()).not.toMatchObject({ authenticated: false });
        expect(escaped).toHaveLength(1);
        expect(isAuthzStoreUnavailableError(escaped[0])).toBe(true);
    });

    it('CONTROL — an unprovisioned store is not an outage: the face answers the signed-in caller', async () => {
        const { app, escaped } = mount(() => new Error('no such table: sys_member'));

        const res = await app.request(`http://localhost${ME_PERMISSIONS}`);

        expect(res.status).toBe(200);
        expect(await res.json()).toMatchObject({ authenticated: true, userId: USER });
        expect(escaped).toEqual([]);
    });
});
