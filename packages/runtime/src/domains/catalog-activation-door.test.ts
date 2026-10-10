// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [ADR-0126 §3 regime C, as ADR-0131 D6 amends it] The security catalog's
// activation door, `POST /security/_activation/:type/:name`, for `position` and
// `permission`.
//
// What is pinned, and why each half:
//
//   - the AUTHORITY is the flow and action doors' — `manage_metadata`, then the
//     ADR-0126 §5 posture rule — and every refusal leaves the ledger untouched
//     (a gate that refused after the write would be the measured leak, with
//     persistence);
//   - the CONTRACT: shape, body, the name resolving in the catalog the resolver
//     reads, a store failure or a hook refusal never reading as a flip;
//   - the EFFECT is measured through `resolveUserAuthzGrants` over the very
//     engine the door wrote, not by reading the row back: a row the resolver
//     does not honour would be a switch that switches nothing.

import { describe, it, expect } from 'vitest';
import { resolveUserAuthzGrants } from '@objectstack/core';

import { HttpDispatcher } from '../http-dispatcher.js';
import type { HttpProtocolContext } from '../http-dispatcher.js';
import { bindTestSecurityCatalog, type TestSecurityCatalog } from '../security/security-catalog.testkit.js';

const LEDGER = 'sys_metadata_activation';
const USER = 'u_holder';
const POSITION = 'sales_rep';
const SET = 'sales_access';
const DIRECT_SET = 'report_reader';

const CATALOG: TestSecurityCatalog = {
    positions: [{ name: POSITION, permissionSets: [SET], _packageId: 'crm' }],
    permissions: [
        { name: SET, systemPermissions: ['cap_sales'] },
        { name: DIRECT_SET, systemPermissions: ['cap_reports'] },
        { name: 'admin_full_access', systemPermissions: ['manage_metadata'] },
    ],
};

type Row = Record<string, unknown>;

interface EngineOptions {
    /** No ledger object registered — a composition without `PlatformObjectsPlugin`. */
    omitLedger?: boolean;
    /** Bind no security catalog — an engine no security plugin started on. */
    unbound?: boolean;
    /** Throw this from every ledger write — a hook refusal or a store failure. */
    writeError?: Error;
}

/** A table-backed engine double: the store's keyed find/insert/update and the resolver's `$in` read. */
function makeEngine(opts: EngineOptions = {}) {
    const tables: Record<string, Row[]> = {
        sys_user: [{ id: USER }],
        sys_member: [],
        sys_user_position: [{ user_id: USER, position: POSITION, organization_id: null }],
        sys_user_permission_set: [
            { user_id: USER, permission_set_id: 'ps_direct', permission_set: DIRECT_SET, organization_id: null },
        ],
        [LEDGER]: [],
    };
    const writes: Array<{ op: 'insert' | 'update'; data: Row }> = [];
    const matches = (row: Row, where: Row | undefined): boolean =>
        Object.entries(where ?? {}).every(([k, v]) => {
            if (k.startsWith('$')) throw new Error(`fake driver: unsupported operator ${k}`);
            if (v && typeof v === 'object' && '$in' in (v as Row)) return ((v as Row).$in as unknown[]).includes(row[k]);
            if (v === null) return (row[k] ?? null) === null;
            return row[k] === v;
        });
    let nextId = 1;
    const engine: any = {
        registry: {
            getObject: (name: string) => (name === LEDGER && !opts.omitLedger ? { name: LEDGER } : undefined),
        },
        async find(object: string, options: any) {
            const rows = (tables[object] ?? []).filter((r) => matches(r, options?.where));
            return typeof options?.limit === 'number' ? rows.slice(0, options.limit) : rows;
        },
        async insert(object: string, data: Row) {
            if (opts.writeError) throw opts.writeError;
            writes.push({ op: 'insert', data });
            const row = { id: `act_${nextId++}`, ...data };
            (tables[object] ??= []).push(row);
            return row;
        },
        async update(object: string, data: Row) {
            if (opts.writeError) throw opts.writeError;
            writes.push({ op: 'update', data });
            const row = (tables[object] ?? []).find((r) => r.id === data.id);
            if (row) Object.assign(row, data);
            return row;
        },
    };
    if (!opts.unbound) bindTestSecurityCatalog(engine, CATALOG);
    return { engine, tables, writes };
}

interface Harness {
    dispatcher: HttpDispatcher;
    engine: any;
    tables: Record<string, Row[]>;
    writes: Array<{ op: 'insert' | 'update'; data: Row }>;
}

function boot(posture: 'single' | 'group' | 'isolated' | null, opts: EngineOptions = {}): Harness {
    const { engine, tables, writes } = makeEngine(opts);
    const services: Record<string, unknown> = { objectql: engine, data: engine };
    if (posture) services.tenancy = { posture };
    const resolve = (name: string): unknown => services[name] ?? null;
    const kernel = {
        getService: resolve,
        getServiceAsync: async (name: string) => resolve(name),
        context: { getService: resolve },
    };
    return { dispatcher: new HttpDispatcher(kernel as never), engine, tables, writes };
}

/** A tenant org admin holding `manage_metadata` — the §5 gate is then the only thing left. */
const TENANT_ADMIN = (): HttpProtocolContext => ({
    request: {},
    environmentId: 'platform',
    executionContext: {
        userId: 'u_northwind_owner',
        positions: ['org_owner', 'org_admin'],
        permissions: ['organization_admin'],
        systemPermissions: ['manage_metadata'],
        posture: 'TENANT_ADMIN',
        organizationId: 'org_northwind',
    },
} as unknown as HttpProtocolContext);

const PLAIN_MEMBER = (): HttpProtocolContext => ({
    request: {},
    environmentId: 'platform',
    executionContext: { userId: 'u_member', positions: ['org_member'], systemPermissions: [] },
} as unknown as HttpProtocolContext);

const PLATFORM_OPERATOR = (): HttpProtocolContext => ({
    request: {},
    environmentId: 'platform',
    executionContext: {
        userId: 'u_saas_operator',
        positions: ['platform_admin'],
        permissions: ['admin_full_access'],
        systemPermissions: ['manage_metadata'],
        posture: 'PLATFORM_ADMIN',
        organizationId: null,
    },
} as unknown as HttpProtocolContext);

const ANONYMOUS = (): HttpProtocolContext => ({
    request: {},
    environmentId: 'platform',
    executionContext: { positions: [], systemPermissions: [] },
} as unknown as HttpProtocolContext);

const statusOf = (r: any): unknown => r?.response?.status;
const codeOf = (r: any): unknown => r?.response?.body?.error?.code ?? r?.response?.body?.error?.details?.code;
const messageOf = (r: any): string => String(r?.response?.body?.error?.message ?? '');

const flip = (h: Harness, ctx: HttpProtocolContext, path: string, body: unknown = { enabled: false }) =>
    h.dispatcher.handleSecurity(path, 'POST', body, {}, ctx);

const grantsOf = (h: Harness) => resolveUserAuthzGrants(h.engine, USER, {});

describe('the catalog activation door — authority', () => {
    for (const [type, name] of [['position', POSITION], ['permission', SET]] as const) {
        describe(`\`${type}\``, () => {
            it('`single`: a tenant admin holding `manage_metadata` flips it', async () => {
                const h = boot('single');

                const res = await flip(h, TENANT_ADMIN(), `/_activation/${type}/${name}`);

                expect(statusOf(res)).toBe(200);
                expect(res.response?.body?.data).toEqual({ type, name, enabled: false });
                expect(h.tables[LEDGER]).toEqual([
                    expect.objectContaining({ metadata_type: type, name, active: false }),
                ]);
            });

            it('no tenancy service behaves like `single` (ADR-0093 D4/D5)', async () => {
                const h = boot(null);

                expect(statusOf(await flip(h, TENANT_ADMIN(), `/_activation/${type}/${name}`))).toBe(200);
                expect(h.writes).toHaveLength(1);
            });

            it('REFUSES a caller without `manage_metadata` 403, and writes nothing', async () => {
                const h = boot('single');

                const res = await flip(h, PLAIN_MEMBER(), `/_activation/${type}/${name}`);

                expect(statusOf(res)).toBe(403);
                expect(codeOf(res)).toBe('PERMISSION_DENIED');
                expect(messageOf(res)).toContain('manage_metadata');
                expect(h.writes).toEqual([]);
            });

            it('REFUSES an anonymous caller at the domain floor 401, and writes nothing', async () => {
                const h = boot('single');

                const res = await flip(h, ANONYMOUS(), `/_activation/${type}/${name}`);

                expect(statusOf(res)).toBe(401);
                expect(h.writes).toEqual([]);
            });

            for (const posture of ['group', 'isolated'] as const) {
                it(`\`${posture}\`: REFUSES a tenant admin 403, naming the posture, and writes nothing`, async () => {
                    const h = boot(posture);

                    const res = await flip(h, TENANT_ADMIN(), `/_activation/${type}/${name}`);

                    expect(statusOf(res)).toBe(403);
                    expect(codeOf(res)).toBe('PERMISSION_DENIED');
                    expect(messageOf(res)).toContain(posture);
                    expect(messageOf(res)).toContain('ADR-0126 §5');
                    // #7450 — nothing about the caller's own positions or sets.
                    expect(messageOf(res)).not.toContain('org_owner');
                    expect(messageOf(res)).not.toContain('organization_admin');
                    expect(h.writes).toEqual([]);
                });

                it(`\`${posture}\`: ALLOWS the platform operator`, async () => {
                    const h = boot(posture);

                    expect(statusOf(await flip(h, PLATFORM_OPERATOR(), `/_activation/${type}/${name}`))).toBe(200);
                    expect(h.writes).toHaveLength(1);
                });
            }
        });
    }

    it('the refusal names what is being switched, per type', async () => {
        const position = messageOf(await flip(boot('group'), TENANT_ADMIN(), `/_activation/position/${POSITION}`));
        const set = messageOf(await flip(boot('group'), TENANT_ADMIN(), `/_activation/permission/${SET}`));

        expect(position).toContain('a position');
        expect(set).toContain('a permission set');
    });

    it('a refused caller learns nothing about the shape or the name: refused before both', async () => {
        const h = boot('group');

        const unknownName = await flip(h, TENANT_ADMIN(), '/_activation/position/no_such_position');
        const badShape = await flip(h, TENANT_ADMIN(), '/_activation/capability/x', { enable: false });

        expect(statusOf(unknownName)).toBe(403);
        expect(statusOf(badShape)).toBe(403);
        expect(h.writes).toEqual([]);
    });
});

describe('the catalog activation door — contract', () => {
    it.each([
        ['/_activation/position', 'missing name'],
        ['/_activation/position/a/b', 'one segment too many'],
        ['/_activation/capability/manage_metadata', 'a type with no switch'],
        ['/_activation/permission_set/sales_access', 'a type spelled other than the ledger spells it'],
    ])('refuses %s (%s) 400, naming the shape', async (path) => {
        const h = boot('single');

        const res = await flip(h, TENANT_ADMIN(), path);

        expect(statusOf(res)).toBe(400);
        expect(messageOf(res)).toContain('/security/_activation/:type/:name');
        expect(h.writes).toEqual([]);
    });

    it('refuses a one-letter-off body key rather than inverting it into "enable"', async () => {
        const h = boot('single');

        const res = await flip(h, TENANT_ADMIN(), `/_activation/position/${POSITION}`, { enable: false });

        expect(statusOf(res)).toBe(400);
        expect(codeOf(res)).toBe('VALIDATION_FAILED');
        expect(h.writes).toEqual([]);
    });

    it('refuses a string `enabled`', async () => {
        const h = boot('single');

        const res = await flip(h, TENANT_ADMIN(), `/_activation/position/${POSITION}`, { enabled: 'false' });

        expect(statusOf(res)).toBe(400);
        expect(codeOf(res)).toBe('VALIDATION_FAILED');
        expect(h.writes).toEqual([]);
    });

    it('an empty body switches ON (the activation body default)', async () => {
        const h = boot('single');

        // `null`, not `undefined`: the helper's default would stand in for `undefined`.
        const res = await flip(h, TENANT_ADMIN(), `/_activation/position/${POSITION}`, null);

        expect(statusOf(res)).toBe(200);
        expect(h.tables[LEDGER]).toEqual([expect.objectContaining({ name: POSITION, active: true })]);
    });

    it('an undeclared name is 404 and writes nothing', async () => {
        const h = boot('single');

        const res = await flip(h, TENANT_ADMIN(), '/_activation/permission/no_such_set');

        expect(statusOf(res)).toBe(404);
        expect(messageOf(res)).toContain("'no_such_set'");
        expect(h.writes).toEqual([]);
    });

    it('a name of the OTHER type is 404 — the ledger row is keyed by type', async () => {
        const h = boot('single');

        const res = await flip(h, TENANT_ADMIN(), `/_activation/position/${SET}`);

        expect(statusOf(res)).toBe(404);
        expect(h.writes).toEqual([]);
    });

    it('no catalog bound is 503 SERVICE_UNAVAILABLE, never a write for an unconfirmed name', async () => {
        const h = boot('single', { unbound: true });

        const res = await flip(h, TENANT_ADMIN(), `/_activation/position/${POSITION}`);

        expect(statusOf(res)).toBe(503);
        expect(codeOf(res)).toBe('SERVICE_UNAVAILABLE');
        expect(h.writes).toEqual([]);
    });

    it('no ledger object in the composition is 501: the resolver would read no row, so no 200', async () => {
        const h = boot('single', { omitLedger: true });

        const res = await flip(h, TENANT_ADMIN(), `/_activation/position/${POSITION}`);

        expect(statusOf(res)).toBe(501);
        expect(h.writes).toEqual([]);
    });

    it('carries the definition\'s package onto the row', async () => {
        const h = boot('single');

        await flip(h, TENANT_ADMIN(), `/_activation/position/${POSITION}`);

        expect(h.tables[LEDGER][0]).toEqual(expect.objectContaining({ package_id: 'crm' }));
    });

    it('re-enabling UPDATES the one row — the ledger keeps the choice, it does not grow a second row', async () => {
        const h = boot('single');

        await flip(h, TENANT_ADMIN(), `/_activation/position/${POSITION}`, { enabled: false });
        const res = await flip(h, TENANT_ADMIN(), `/_activation/position/${POSITION}`, { enabled: true });

        expect(statusOf(res)).toBe(200);
        expect(h.tables[LEDGER]).toHaveLength(1);
        expect(h.tables[LEDGER][0]).toEqual(expect.objectContaining({ metadata_type: 'position', active: true }));
        expect(h.writes.map((w) => w.op)).toEqual(['insert', 'update']);
    });

    it('a hook refusal on the ledger keeps its own status and code (the last-admin guard\'s 403)', async () => {
        const refusal = Object.assign(
            new Error("PERMISSION_DENIED: Refusing this 'sys_metadata_activation' write"),
            { code: 'PERMISSION_DENIED', status: 403 },
        );
        const h = boot('single', { writeError: refusal });

        const res = await flip(h, TENANT_ADMIN(), '/_activation/permission/admin_full_access');

        expect(statusOf(res)).toBe(403);
        expect(codeOf(res)).toBe('PERMISSION_DENIED');
        expect(h.tables[LEDGER]).toEqual([]);
    });

    it('a store failure is 503 SERVICE_UNAVAILABLE, never a 200', async () => {
        const h = boot('single', { writeError: new Error('connection reset') });

        const res = await flip(h, TENANT_ADMIN(), `/_activation/position/${POSITION}`);

        expect(statusOf(res)).toBe(503);
        expect(codeOf(res)).toBe('SERVICE_UNAVAILABLE');
    });

    it('leaves every other `/security` route to the security service', async () => {
        const h = boot('single');

        const res = await h.dispatcher.handleSecurity('/suggested-bindings', 'GET', undefined, {}, TENANT_ADMIN());

        // No `security` service in this composition: the existing 503, not this door.
        expect(statusOf(res)).toBe(503);
        expect(messageOf(res)).toBe('Security service not available');
    });
});

describe('the catalog activation door — the resolver honours what it writes', () => {
    it('CONTROL: before any flip the holder is granted through the position and the direct set', async () => {
        const h = boot('single');

        const grants = await grantsOf(h);

        expect(grants.permissions).toEqual(expect.arrayContaining([SET, DIRECT_SET]));
        expect(grants.systemPermissions).toEqual(expect.arrayContaining(['cap_sales', 'cap_reports']));
    });

    it('a position switched off stops granting through it; switched back on, it grants again', async () => {
        const h = boot('single');

        expect(statusOf(await flip(h, TENANT_ADMIN(), `/_activation/position/${POSITION}`, { enabled: false }))).toBe(200);
        const off = await grantsOf(h);
        expect(off.positions).not.toContain(POSITION);
        expect(off.permissions).not.toContain(SET);
        expect(off.systemPermissions).not.toContain('cap_sales');
        // Only that position: the direct set still grants.
        expect(off.permissions).toContain(DIRECT_SET);

        expect(statusOf(await flip(h, TENANT_ADMIN(), `/_activation/position/${POSITION}`, { enabled: true }))).toBe(200);
        const on = await grantsOf(h);
        expect(on.positions).toContain(POSITION);
        expect(on.permissions).toContain(SET);
        expect(on.systemPermissions).toContain('cap_sales');
    });

    it('a permission set switched off stops granting, by every path that reaches it', async () => {
        const h = boot('single');

        expect(statusOf(await flip(h, TENANT_ADMIN(), `/_activation/permission/${DIRECT_SET}`))).toBe(200);
        const directOff = await grantsOf(h);
        expect(directOff.permissions).not.toContain(DIRECT_SET);
        expect(directOff.systemPermissions).not.toContain('cap_reports');
        expect(directOff.permissions).toContain(SET);

        // The set a position distributes: the position stays held, the set stops granting.
        expect(statusOf(await flip(h, TENANT_ADMIN(), `/_activation/permission/${SET}`))).toBe(200);
        const viaPositionOff = await grantsOf(h);
        expect(viaPositionOff.positions).toContain(POSITION);
        expect(viaPositionOff.permissions).not.toContain(SET);
        expect(viaPositionOff.systemPermissions).not.toContain('cap_sales');
    });
});
