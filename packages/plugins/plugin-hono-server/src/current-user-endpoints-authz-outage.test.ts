// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#24061] An authorization store that cannot be read is an OUTAGE on
// the current-user faces, never a signed-out caller.
//
// Since #24061 these faces resolve their caller through `resolveAuthzContext`,
// which places them in the transport ledger of the 2026-08-30 maintainer
// ruling (commit 6a180e42d; its text is quoted in the header of
// `packages/core/src/security/authz-store-unavailable.test.ts`). The ruling:
// a transport's fail-closed net re-raises `AuthzStoreUnavailableError` rather
// than degrading it, because the degraded answer here — `{ authenticated:
// false }`, or `{ apps: [] }` — is byte-identical to a genuine anonymous
// caller's. These cases pin what each route ANSWERS, on the real host seam
// (`HonoHttpServer`'s error envelope), not the spelling the ledger greps for:
//
//  - a permission-store read that FAILS answers `503` with the declared
//    `SERVICE_UNAVAILABLE` code on all three routes;
//  - CONTROL: a store that was never PROVISIONED (missing tables) is not an
//    outage — the face still answers its signed-in caller.

import { describe, it, expect } from 'vitest';
import { HonoHttpServer } from './adapter';
import { registerCurrentUserEndpoints } from './current-user-endpoints';

const USER = 'usr_outage';
const ROUTES = ['/api/v1/auth/me/permissions', '/api/v1/auth/me/localization', '/api/v1/me/apps'] as const;

/** A data engine whose every read throws `fault(object)`. */
const failingQl = (fault: (object: string) => Error) => ({
    find: async (object: string) => { throw fault(object); },
    registry: { getAllApps: () => [], getAllObjects: () => [] },
    getSchema: () => undefined,
});

function mount(fault: (object: string) => Error) {
    const server = new HonoHttpServer(0);
    const quiet = { debug() {}, info() {}, warn() {}, error() {}, fatal() {}, child() { return quiet; } };
    server.setLogger(quiet as never);
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
    registerCurrentUserEndpoints({
        rawApp: server.getRawApp(),
        ctx: {
            logger: { debug() {}, warn() {} },
            getService: <T,>(name: string): T => {
                if (!(name in services)) throw new Error(`[Kernel] Service '${name}' not found`);
                return services[name] as T;
            },
        },
    });
    return (path: string) => server.getRawApp().fetch(new Request(`http://localhost${path}`));
}

describe('[#24061] the current-user faces answer an authorization-store outage as one', () => {
    it.each(ROUTES)('%s: a failed permission-store read answers 503 SERVICE_UNAVAILABLE', async (route) => {
        const request = mount(() => new Error('connection refused'));

        const res = await request(route);
        const body: any = await res.json();

        expect(res.status).toBe(503);
        expect(body?.error?.code).toBe('SERVICE_UNAVAILABLE');
    });

    it('CONTROL — an unprovisioned store is not an outage: the face answers the signed-in caller', async () => {
        // The spelling SQLite answers, naming the very table each read asked for.
        const request = mount((object) => new Error(`no such table: ${object}`));

        const res = await request(ROUTES[0]);

        expect(res.status).toBe(200);
        expect(await res.json()).toMatchObject({ authenticated: true, userId: USER });
    });
});
