// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [ADR-0126 §3 regime C, as ADR-0131 D6 amends it] The security catalog's
// activation door on a REAL booted showcase:
// `POST /api/v1/security/_activation/:type/:name`, body `{ enabled?: boolean }`.
//
// What only a boot can measure, and so what this file is for:
//
//   - the door is MOUNTED on the wire and reachable — the rest of `/security`
//     is the REST server's, and a dispatcher arm nothing routes to is the
//     defect class the live-mount parity gate exists for;
//   - the name is checked against the catalog the security plugin really binds
//     (a declared position, a declared permission set, a name nobody declares);
//   - the write goes through the engine, so the last-admin guard's ledger hook
//     really refuses switching `admin_full_access` off;
//   - the resolver over the booted engine stops granting through a position
//     the door switched off, for a persona the app really provisions.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resolveUserAuthzGrants } from '@objectstack/core';
import { type VerifyStack } from '@objectstack/verify';
import { bootShowcase } from './showcase-boot.js';

const LEDGER = 'sys_metadata_activation';
/** Infrastructure rows, not tenant data — the store's own posture. */
const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] };

/** A showcase position (`src/security/positions.ts`) and the set it names. */
const POSITION = 'auditor';
const POSITION_SET = 'showcase_auditor';
/** The persona `seed-approval-demo.ts` provisions holding ONLY `auditor`. */
const AUDITOR_USER = 'usr_showcase_auditor_demo';

interface Engine {
    find(object: string, options?: unknown): Promise<Array<Record<string, unknown>>>;
}

describe('the catalog activation door, on a booted showcase', () => {
    let stack: VerifyStack;
    let token: string;
    let ql: Engine;

    const flip = (type: string, name: string, body: unknown) =>
        stack.apiAs(token, 'POST', `/security/_activation/${type}/${name}`, body);
    const rowsOf = (type: string, name: string) =>
        ql.find(LEDGER, { where: { metadata_type: type, name }, context: SYSTEM_CTX });

    beforeAll(async () => {
        stack = await bootShowcase();
        token = await stack.signIn();
        ql = (await stack.kernel.getServiceAsync('objectql')) as unknown as Engine;
    }, 120_000);

    afterAll(async () => {
        await stack?.stop();
    });

    it('a declared position switches off: 200, one deployment-level row', async () => {
        const res = await flip('position', POSITION, { enabled: false });
        const text = await res.clone().text();

        expect(res.status, `answered ${res.status}: ${text}`).toBe(200);
        expect(JSON.parse(text).data).toEqual({ type: 'position', name: POSITION, enabled: false });
        const rows = await rowsOf('position', POSITION);
        expect(rows).toHaveLength(1);
        // SQLite/libsql round-trip booleans as 0/1 — either spelling is "off".
        expect(rows[0].active === false || rows[0].active === 0).toBe(true);
    });

    it('the resolver over the booted engine stops granting through it, and grants again once it is back on', async () => {
        const held = await ql.find('sys_user_position', {
            where: { user_id: AUDITOR_USER, position: POSITION },
            context: SYSTEM_CTX,
        });
        // Anti-vacuity: the persona really holds the position on this boot.
        expect(held.length, `no '${POSITION}' assignment for ${AUDITOR_USER}`).toBeGreaterThan(0);
        const tenantId = (held[0].organization_id as string | null | undefined) ?? undefined;

        const off = await resolveUserAuthzGrants(ql as never, AUDITOR_USER, { tenantId });
        expect(off.positions).not.toContain(POSITION);
        expect(off.permissions).not.toContain(POSITION_SET);

        const res = await flip('position', POSITION, { enabled: true });
        expect(res.status, await res.clone().text()).toBe(200);
        expect(await rowsOf('position', POSITION)).toHaveLength(1);

        const on = await resolveUserAuthzGrants(ql as never, AUDITOR_USER, { tenantId });
        expect(on.positions).toContain(POSITION);
        expect(on.permissions).toContain(POSITION_SET);
    });

    it('a declared permission set switches off and back on', async () => {
        const off = await flip('permission', POSITION_SET, { enabled: false });
        expect(off.status, await off.clone().text()).toBe(200);
        const on = await flip('permission', POSITION_SET, { enabled: true });
        expect(on.status, await on.clone().text()).toBe(200);
        const rows = await rowsOf('permission', POSITION_SET);
        expect(rows).toHaveLength(1);
        expect(rows[0].active === true || rows[0].active === 1).toBe(true);
    });

    it('switching `admin_full_access` off is refused 403 by the last-admin guard, and no row lands', async () => {
        const res = await flip('permission', 'admin_full_access', { enabled: false });
        const body = await res.json() as { error?: { code?: string } };

        expect(res.status).toBe(403);
        expect(body.error?.code).toBe('PERMISSION_DENIED');
        expect(await rowsOf('permission', 'admin_full_access')).toEqual([]);
    });

    it('a name nobody declares is 404 and writes nothing', async () => {
        const res = await flip('position', 'no_such_position', { enabled: false });

        expect(res.status).toBe(404);
        expect(await rowsOf('position', 'no_such_position')).toEqual([]);
    });

    it('a type with no switch is refused 400 by the door itself — the route is the door\'s, not a router miss', async () => {
        const res = await flip('capability', 'manage_metadata', { enabled: false });
        const text = await res.text();

        expect(res.status, text).toBe(400);
        expect(text).toContain('/security/_activation/:type/:name');
    });
});
