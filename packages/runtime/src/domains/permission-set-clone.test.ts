// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [ADR-0126 §7.1] The permission-set clone door,
// `POST /security/permission-sets/:name/clone`, body `{ name, label }`.
//
// What is pinned, and why each half:
//
//   - the AUTHORITY is the metadata door's own (`manage_metadata`), asked
//     before anything else, and a refusal saves nothing;
//   - the SOURCE comes from the security catalog, never from a
//     `sys_permission_set` row: the engine double here holds NO rows and throws
//     on every data read, so a door that reached for a row would fail loudly;
//   - the COPY is the whole definition minus the one server-declared list —
//     asserted against the same constant the door applies, so no facet can be
//     dropped by omission and no dropped key can ride across;
//   - every refusal answers in the ADR-0112 envelope (status + code) and saves
//     nothing.

import { describe, it, expect } from 'vitest';

import { HttpDispatcher } from '../http-dispatcher.js';
import type { HttpProtocolContext } from '../http-dispatcher.js';
import { bindTestSecurityCatalog, type TestSecurityCatalog } from '../security/security-catalog.testkit.js';
import {
    PERMISSION_SET_CLONE_DROPPED_KEYS,
    PERMISSION_SET_CLONE_MUTATED_FIELDS,
    PERMISSION_SET_CLONE_NOTICE,
    clonePermissionSetDefinition,
} from './permission-set-clone.js';

/** A packaged set carrying every facet AND every key the server drops. */
const PACKAGED = {
    name: 'crm_sales_rep',
    label: 'Sales Rep',
    description: 'Packaged sales access',
    objects: { account: { allowRead: true, allowEdit: true } },
    fields: { 'account.revenue': { readable: true, editable: false } },
    systemPermissions: ['export_reports'],
    tabPermissions: { app_crm: 'visible' },
    rowLevelSecurity: [{ name: 'own_accounts', object: 'account', operation: 'select', using: 'owner_id == current_user.id' }],
    adminScope: { businessUnit: 'east', manageAssignments: true },
    isDefault: true,
    packageId: 'crm',
    managedBy: 'package',
    protection: { lock: 'full' },
    _packageId: 'crm',
    _packageVersion: '1.2.0',
    _provenance: 'package',
    _lock: 'full',
};
const ENV_SET = { name: 'env_reader', label: 'Env Reader', objects: { account: { allowRead: true } } };

const CATALOG: TestSecurityCatalog = { permissions: [PACKAGED, ENV_SET] };

interface Saved { type: string; name: string; item: Record<string, unknown>; parentVersion?: string | null }

interface BootOptions {
    unbound?: boolean;
    noProtocol?: boolean;
    saveError?: Error;
    catalogError?: Error;
    /** The `tenancy` service's posture; absent ⇒ no `tenancy` service (the `single` shape). */
    posture?: 'single' | 'isolated' | 'group';
}

function boot(opts: BootOptions = {}) {
    // ZERO `sys_permission_set` rows: every data read throws, so the door
    // passing proves it reads no row.
    const engine: any = {
        registry: { getObject: () => undefined },
        find: async (object: string) => { throw new Error(`the clone door read a ${object} row`); },
    };
    if (opts.catalogError) {
        bindTestSecurityCatalog(engine, () => { throw opts.catalogError; });
    } else if (!opts.unbound) {
        bindTestSecurityCatalog(engine, CATALOG);
    }
    const saves: Saved[] = [];
    const protocol = {
        async saveMetaItem(request: Saved) {
            if (opts.saveError) throw opts.saveError;
            saves.push(structuredClone(request));
            return { success: true };
        },
    };
    const services: Record<string, unknown> = { objectql: engine, data: engine };
    if (!opts.noProtocol) services.protocol = protocol;
    if (opts.posture) services.tenancy = { posture: opts.posture };
    const resolve = (name: string): unknown => services[name] ?? null;
    const kernel = {
        getService: resolve,
        getServiceAsync: async (name: string) => resolve(name),
        context: { getService: resolve },
    };
    return { dispatcher: new HttpDispatcher(kernel as never), saves };
}

const ctx = (executionContext: Record<string, unknown>): HttpProtocolContext =>
    ({ request: {}, environmentId: 'platform', executionContext } as unknown as HttpProtocolContext);
const HOLDER = () => ctx({ userId: 'u_admin', positions: [], systemPermissions: ['manage_metadata'] });
const NON_HOLDER = () => ctx({ userId: 'u_member', positions: ['org_member'], systemPermissions: [] });
const ANONYMOUS = () => ctx({ positions: [], systemPermissions: [] });

const statusOf = (r: any): unknown => r?.response?.status;
const codeOf = (r: any): unknown => r?.response?.body?.error?.code;

const clone = (h: ReturnType<typeof boot>, c: HttpProtocolContext, source: string, body: unknown) =>
    h.dispatcher.handleSecurity(`/permission-sets/${source}/clone`, 'POST', body, {}, c);

describe('the permission-set clone door — success', () => {
    it('copies the whole definition under the new name, drops the declared keys, and saves create-only as an environment item', async () => {
        const h = boot();

        const res = await clone(h, HOLDER(), PACKAGED.name, { name: 'my_sales_rep', label: 'My Sales Rep' });

        expect(statusOf(res)).toBe(200);
        expect(h.saves).toHaveLength(1);
        const [save] = h.saves;
        expect(save.type).toBe('permission');
        expect(save.name).toBe('my_sales_rep');
        // Create-only: a row written under the name in between is refused.
        expect(save.parentVersion).toBeNull();
        // No organization and no package on the save.
        expect(Object.keys(save).sort()).toEqual(['item', 'name', 'parentVersion', 'type']);

        // Whole-definition copy: the source minus the declared keys, the two
        // mutated fields set. Deep equality, so a dropped facet fails here.
        const expected: Record<string, unknown> = structuredClone(PACKAGED);
        for (const key of PERMISSION_SET_CLONE_DROPPED_KEYS) delete expected[key];
        expected.name = 'my_sales_rep';
        expected.label = 'My Sales Rep';
        expect(save.item).toEqual(expected);
        for (const key of ['adminScope', 'isDefault', 'packageId', 'managedBy', 'protection', '_packageId', '_lock', '_provenance']) {
            expect(save.item, key).not.toHaveProperty(key);
        }

        // ⛔ No ancestry in the answer.
        const data = (res as any).response.body.data;
        expect(data).toEqual({ permissionSet: save.item, notice: PERMISSION_SET_CLONE_NOTICE });
        expect(JSON.stringify(data.permissionSet)).not.toContain(PACKAGED.name);
    });

    it('clones an environment-authored set the same way', async () => {
        const h = boot();

        const res = await clone(h, HOLDER(), ENV_SET.name, { name: 'env_reader_copy', label: 'Env Reader Copy' });

        expect(statusOf(res)).toBe(200);
        expect(h.saves[0].item).toEqual({ ...ENV_SET, name: 'env_reader_copy', label: 'Env Reader Copy' });
    });

    it('the copy shares no object with the catalog definition it was read from', () => {
        const copy = clonePermissionSetDefinition(PACKAGED, { name: 'x_copy', label: 'X' });
        (copy.objects as any).account.allowDelete = true;

        expect((PACKAGED.objects.account as Record<string, unknown>).allowDelete).toBeUndefined();
    });

    it('declares the mutation set and the dropped list once', () => {
        expect(PERMISSION_SET_CLONE_MUTATED_FIELDS).toEqual(['name', 'label']);
        for (const key of ['adminScope', 'isDefault', 'packageId', 'managedBy', 'protection', '_packageId', '_lock']) {
            expect(PERMISSION_SET_CLONE_DROPPED_KEYS).toContain(key);
        }
        // The copied facets are never on the list.
        for (const key of ['objects', 'fields', 'systemPermissions', 'tabPermissions', 'rowLevelSecurity', 'description']) {
            expect(PERMISSION_SET_CLONE_DROPPED_KEYS).not.toContain(key);
        }
    });
});

describe('the permission-set clone door — authority', () => {
    it('REFUSES a caller without `manage_metadata` 403 before any lookup, and saves nothing', async () => {
        const h = boot();

        // An unknown source and an invalid body: a 403 here proves the gate runs first.
        const res = await clone(h, NON_HOLDER(), 'no_such_set', { nope: true });

        expect(statusOf(res)).toBe(403);
        expect(codeOf(res)).toBe('PERMISSION_DENIED');
        expect((res as any).response.body.error.message).toContain('manage_metadata');
        expect(h.saves).toEqual([]);
    });

    it('REFUSES an anonymous caller 401 at the domain floor', async () => {
        const h = boot();

        const res = await clone(h, ANONYMOUS(), PACKAGED.name, { name: 'a_copy', label: 'A' });

        expect(statusOf(res)).toBe(401);
        expect(h.saves).toEqual([]);
    });

    it('admits engine self-invocation (`isSystem`)', async () => {
        const h = boot();

        const res = await clone(h, ctx({ isSystem: true, positions: [], systemPermissions: [] }), PACKAGED.name, { name: 'sys_copy', label: 'S' });

        expect(statusOf(res)).toBe(200);
    });
});

describe('the permission-set clone door — refusals', () => {
    const refusal = async (opts: BootOptions, source: string, body: unknown, status: number, code: string) => {
        const h = boot(opts);
        const res = await clone(h, HOLDER(), source, body);
        expect(statusOf(res), JSON.stringify((res as any)?.response?.body)).toBe(status);
        expect(codeOf(res)).toBe(code);
        expect(h.saves).toEqual([]);
        return res;
    };

    it('an unknown source is 404', async () => {
        await refusal({}, 'no_such_set', { name: 'x_copy', label: 'X' }, 404, 'RESOURCE_NOT_FOUND');
    });

    it('a target name the catalog holds is 409 — another set\'s name, and the source\'s own', async () => {
        await refusal({}, PACKAGED.name, { name: ENV_SET.name, label: 'X' }, 409, 'RESOURCE_CONFLICT');
        await refusal({}, PACKAGED.name, { name: PACKAGED.name, label: 'X' }, 409, 'RESOURCE_CONFLICT');
    });

    it('a name failing the metadata name rule is 400, and the message states the rule the schema enforces', async () => {
        const res = await refusal({}, PACKAGED.name, { name: 'My Copy', label: 'X' }, 400, 'VALIDATION_FAILED');
        await refusal({}, PACKAGED.name, { name: '9copy', label: 'X' }, 400, 'VALIDATION_FAILED');
        // `SnakeCaseIdentifierSchema` is `^[a-z][a-z0-9_]*$`: a leading
        // underscore is refused, so the message must not offer one.
        await refusal({}, PACKAGED.name, { name: '_copy', label: 'X' }, 400, 'VALIDATION_FAILED');
        const message = String((res as any).response.body.error.message);
        expect(message).toContain('start with a lowercase letter');
        expect(message).not.toContain('underscore)');
        expect(message).not.toMatch(/letter or underscore/);
    });

    it('the body is closed and both keys are required — 400', async () => {
        await refusal({}, PACKAGED.name, { label: 'X' }, 400, 'VALIDATION_FAILED');
        await refusal({}, PACKAGED.name, { name: 'x_copy' }, 400, 'VALIDATION_FAILED');
        await refusal({}, PACKAGED.name, { name: 'x_copy', label: 'X', adminScope: {} }, 400, 'VALIDATION_FAILED');
        await refusal({}, PACKAGED.name, ['x_copy'], 400, 'VALIDATION_FAILED');
    });

    it('a deeper path is refused with the shape named, never passed on', async () => {
        const h = boot();
        const res = await h.dispatcher.handleSecurity(`/permission-sets/${PACKAGED.name}/clone/extra`, 'POST', { name: 'x_copy', label: 'X' }, {}, HOLDER());
        expect(statusOf(res)).toBe(400);
        expect(h.saves).toEqual([]);
    });

    it('no security catalog bound is 503, never a 404', async () => {
        await refusal({ unbound: true }, PACKAGED.name, { name: 'x_copy', label: 'X' }, 503, 'SERVICE_UNAVAILABLE');
    });

    it('a catalog read that fails is 503, never a 404', async () => {
        await refusal({ catalogError: new Error('registry down') }, PACKAGED.name, { name: 'x_copy', label: 'X' }, 503, 'SERVICE_UNAVAILABLE');
    });

    it('a save the store refuses keeps the store\'s own status and code', async () => {
        const conflict = Object.assign(new Error('a row already exists'), { status: 409, statusCode: 409, code: 'RESOURCE_CONFLICT' });
        await refusal({ saveError: conflict }, PACKAGED.name, { name: 'x_copy', label: 'X' }, 409, 'RESOURCE_CONFLICT');
    });

    it('no metadata protocol to save through is 501', async () => {
        const h = boot({ noProtocol: true });
        const res = await clone(h, HOLDER(), PACKAGED.name, { name: 'x_copy', label: 'X' });
        expect(statusOf(res)).toBe(501);
    });
});

// [ADR-0131 D3] The walled catalog refusal: a clone creates an environment
// permission set, so under a wall it is the platform operator's. Same predicate
// and envelope as the dispatcher's `PUT /meta` (`meta-walled-catalog-refusal.test.ts`).
describe('the permission-set clone door — the walled catalog refusal (ADR-0131 D3)', () => {
    const TENANT_HOLDER = () => ctx({ userId: 'u_tenant', tenantId: 'org_a', positions: [], systemPermissions: ['manage_metadata'], posture: 'TENANT_ADMIN' });
    const OPERATOR = () => ctx({ userId: 'u_operator', positions: [], systemPermissions: ['manage_metadata'], posture: 'PLATFORM_ADMIN' });

    for (const posture of ['isolated', 'group'] as const) {
        it(`${posture}: a tenant manage_metadata holder is refused 403 PERMISSION_DENIED, and nothing is saved`, async () => {
            const h = boot({ posture });
            const res = await clone(h, TENANT_HOLDER(), PACKAGED.name, { name: 'my_sales_rep', label: 'My Sales Rep' });
            expect(statusOf(res)).toBe(403);
            expect(codeOf(res)).toBe('PERMISSION_DENIED');
            expect(String((res as any)?.response?.body?.error?.message)).toContain(`'${posture}' tenancy posture`);
            expect(h.saves).toHaveLength(0);
        });

        it(`${posture}: CONTROL — the platform operator rung clones`, async () => {
            const h = boot({ posture });
            const res = await clone(h, OPERATOR(), PACKAGED.name, { name: 'my_sales_rep', label: 'My Sales Rep' });
            expect(statusOf(res)).toBe(200);
            expect(h.saves).toHaveLength(1);
        });
    }

    it('single: CONTROL — the same tenant holder clones, unchanged', async () => {
        const h = boot({ posture: 'single' });
        const res = await clone(h, TENANT_HOLDER(), PACKAGED.name, { name: 'my_sales_rep', label: 'My Sales Rep' });
        expect(statusOf(res)).toBe(200);
        expect(h.saves).toHaveLength(1);
    });

    it('the capability gate still answers first under a wall', async () => {
        const h = boot({ posture: 'isolated' });
        const res = await clone(h, NON_HOLDER(), PACKAGED.name, { name: 'my_sales_rep', label: 'My Sales Rep' });
        expect(statusOf(res)).toBe(403);
        expect(String((res as any)?.response?.body?.error?.message)).toContain('`manage_metadata`');
        expect(h.saves).toHaveLength(0);
    });
});
