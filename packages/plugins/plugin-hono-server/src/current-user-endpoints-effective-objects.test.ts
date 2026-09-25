// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#18783] `/auth/me/permissions`' `objects` slot is `buildEffectiveObjectPermissions`
// (`@objectstack/core`) over the resolved sets and the request's engine — the
// ONE function `ISecurityService.getEffectiveObjectPermissions` also answers
// from (plugin-security's `get-effective-object-permissions.test.ts` pins that
// half). Together the two pins are the byte-equality the contract member
// promises: "the `objects` slot of the published /auth/me/permissions
// response … the same answer computed once rather than twice". A local merge
// reintroduced here — the second copy that would let the console and the
// server's own `current_user.can()` disagree — turns this red.
//
// The fixtures make every step of the composition fire (merge, super-user
// seed, plain-wildcard coverage, fold, managed-write clamp, apiOperations
// annotation), because an equality over a map none of them touched would pin
// nothing.

import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { buildEffectiveObjectPermissions } from '@objectstack/core';
import { registerCurrentUserEndpoints } from './current-user-endpoints';

const ME_PERMISSIONS = '/api/v1/auth/me/permissions';
const USER = 'usr_admin';

/** The sets the resolver hands back — a super-user wildcard beside an explicit deny, and a plain grant. */
const RESOLVED = [
    {
        name: 'ops_admin',
        objects: {
            '*': { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true, viewAllRecords: true, modifyAllRecords: true },
            sys_member: { allowRead: true, allowEdit: false },
        },
        fields: {},
    },
    { name: 'sales', objects: { deal: { allowRead: true, allowEdit: false } }, fields: {} },
];

/**
 * Registered schemas: plain, better-auth-managed, one whose `apiMethods` tighten exposure,
 * [#20135] one with its API switched off, and one private.
 */
const SCHEMAS: Record<string, any> = {
    deal: { name: 'deal' },
    sys_member: { name: 'sys_member', managedBy: 'better-auth' },
    report: { name: 'report', enable: { apiMethods: ['get', 'list'] } },
    hidden: { name: 'hidden', enable: { apiEnabled: false } },
    vault: { name: 'vault', access: { default: 'private' } },
};

const ql = {
    find: async () => [],
    registry: { getAllApps: () => [], getAllObjects: () => Object.values(SCHEMAS) },
    getSchema: (name: string) => SCHEMAS[name],
};

function mount(resolved: unknown[] = RESOLVED) {
    const services: Record<string, unknown> = {
        auth: {
            api: {
                getSession: async () => ({
                    user: { id: USER, email: 'admin@example.com' },
                    session: { activeOrganizationId: 'org_1' },
                }),
            },
        },
        objectql: ql,
        metadata: { list: async () => [] as unknown[] },
        security: { resolvePermissionSetsForContext: async () => resolved },
    };
    const app = new Hono();
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
    return app;
}

describe('[#18783] /auth/me/permissions `objects` is the one effective-map function', () => {
    it('serves buildEffectiveObjectPermissions over the resolved sets, byte for byte', async () => {
        const body: any = await (await mount().request(`http://localhost${ME_PERMISSIONS}`)).json();
        const expected = buildEffectiveObjectPermissions(RESOLVED, {
            allSchemas: () => ql.registry.getAllObjects(),
            schemaOf: (name) => ql.getSchema(name),
        });
        expect(JSON.stringify(body.objects)).toBe(JSON.stringify(expected));

        // …and the fixture really exercised every step, so the equality means something.
        expect(body.objects.deal).toMatchObject({ allowEdit: true });            // fold over an explicit deny
        expect(body.objects.sys_member).toMatchObject({ allowEdit: false });     // clamp over the fold
        expect(body.objects.report).toMatchObject({ allowRead: true });          // seed for a super-user
        expect(Array.isArray(body.objects.report.apiOperations)).toBe(true);     // annotation
        // [#20134] the per-set super-user fold: `modifyAllRecords` grants transfer, on a seeded
        // entry and on one another set names narrower alike.
        expect(body.objects.report).toMatchObject({ allowTransfer: true });
        expect(body.objects.deal).toMatchObject({ allowTransfer: true });
    });

    it('[#20083] a PLAIN wildcard reaches every registered public object it covers — the same bytes', async () => {
        // The wall-less org admin's shape: a `'*'` with no super-user bit, and a
        // second set naming one object explicitly. The server lets this subject
        // write `report` and `deal` through the wildcard, so the map carries them.
        const plain = [
            { name: 'ops_plain', objects: { '*': { allowRead: true, allowCreate: true, allowEdit: true, allowDelete: true } }, fields: {} },
            { name: 'sales', objects: { deal: { allowRead: true, allowEdit: false } }, fields: {} },
        ];
        const body: any = await (await mount(plain).request(`http://localhost${ME_PERMISSIONS}`)).json();
        const expected = buildEffectiveObjectPermissions(plain, {
            allSchemas: () => ql.registry.getAllObjects(),
            schemaOf: (name) => ql.getSchema(name),
        });
        expect(JSON.stringify(body.objects)).toBe(JSON.stringify(expected));
        expect(body.objects.report).toMatchObject({ allowRead: true, allowEdit: true });        // named by no set
        expect(body.objects.deal).toMatchObject({ allowRead: true, allowEdit: true });          // another set's wildcard widens it
        expect(body.objects.sys_member).toMatchObject({ allowRead: true, allowEdit: false });   // the clamp still has the last word
    });

    it('[#20135] apiOperations offers what the REST door serves — the same bytes', async () => {
        // The platform admin's super-user wildcard beside a plain export-only one.
        const resolved = [
            RESOLVED[0],
            { name: 'exporter', objects: { '*': { allowExport: true } }, fields: {} },
        ];
        const body: any = await (await mount(resolved).request(`http://localhost${ME_PERMISSIONS}`)).json();
        const expected = buildEffectiveObjectPermissions(resolved, {
            allSchemas: () => ql.registry.getAllObjects(),
            schemaOf: (name) => ql.getSchema(name),
        });
        expect(JSON.stringify(body.objects)).toBe(JSON.stringify(expected));
        // `enable.apiEnabled: false`: the door answers 404 OBJECT_API_DISABLED for every verb, so
        // nothing is offered — while the entry keeps the grants the data plane honours.
        expect(body.objects.hidden.apiOperations).toEqual([]);
        expect(body.objects.hidden).toMatchObject({ allowRead: true, allowEdit: true });
        // A private object: the plain `'*'` does not reach it and the super-user `'*'` grants no
        // export, so the export door answers 403 EXPORT_NOT_PERMITTED — and export is not offered…
        expect(body.objects.vault.apiOperations).toBeDefined();
        expect(body.objects.vault.apiOperations).not.toContain('export');
        // …while a public object the plain `'*'` covers keeps its whole closure, export included.
        expect(body.objects.deal).not.toHaveProperty('apiOperations');
        expect(body.objects.report.apiOperations).toContain('export');
    });

    it('keeps the rest of the envelope on its own merges', async () => {
        const body: any = await (await mount().request(`http://localhost${ME_PERMISSIONS}`)).json();
        expect(body.permissionSets).toEqual(['ops_admin', 'sales']);
        expect(body.fields).toEqual({});
        expect(body.systemPermissions).toEqual([]);
        expect(body.tabPermissions).toEqual({});
    });
});
