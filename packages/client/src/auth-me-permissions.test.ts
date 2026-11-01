// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#28508] `client.auth.mePermissions()` — the typed read of
 * `GET /auth/me/permissions`, whose body `MePermissionsResponseSchema`
 * (`@objectstack/spec/api`) declares strictly. The console reads this once per
 * session; `hasAnyQueue` is on it for the list toolbar's queue toggle.
 */

import { describe, it, expect, vi } from 'vitest';
import { MePermissionsResponseSchema } from '@objectstack/spec/api';
import { ObjectStackClient } from './index';

function createMockClient(body: unknown, status = 200) {
    const fetchMock = vi.fn().mockResolvedValue({
        ok: status >= 200 && status < 300,
        status,
        statusText: status === 200 ? 'OK' : 'Error',
        json: async () => body,
        headers: new Headers(),
    });
    const client = new ObjectStackClient({ baseUrl: 'http://localhost:3000', fetch: fetchMock });
    return { client, fetchMock };
}

const AUTHENTICATED = {
    authenticated: true,
    userId: 'usr_1',
    tenantId: 'org_1',
    positions: ['org_member', 'everyone'],
    permissionSets: ['member_default'],
    objects: {},
    fields: {},
    systemPermissions: [],
    tabPermissions: {},
    hasAnyQueue: true,
} as const;

describe('[#28508] client.auth.mePermissions', () => {
    it('GETs /api/v1/auth/me/permissions and resolves the body as the route answers it', async () => {
        const { client, fetchMock } = createMockClient(AUTHENTICATED);
        const answer = await client.auth.mePermissions();

        const [url, init] = fetchMock.mock.calls[0];
        expect(String(url)).toBe('http://localhost:3000/api/v1/auth/me/permissions');
        expect(init?.method ?? 'GET').toBe('GET');
        expect(answer).toEqual(AUTHENTICATED);
        // The fixture is a body the declared contract accepts, so this case
        // cannot pass on a shape the server would never send.
        expect(MePermissionsResponseSchema.safeParse(answer).success).toBe(true);
        // The type narrows on the discriminator.
        if (answer.authenticated) expect(answer.hasAnyQueue).toBe(true);
        else throw new Error('expected the authenticated branch');
    });

    it('an anonymous caller resolves { authenticated: false }, not a throw', async () => {
        const { client } = createMockClient({ authenticated: false });
        const answer = await client.auth.mePermissions();
        expect(answer).toEqual({ authenticated: false });
        expect(MePermissionsResponseSchema.safeParse(answer).success).toBe(true);
    });
});
