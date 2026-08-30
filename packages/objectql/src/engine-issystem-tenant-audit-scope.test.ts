// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// #13491 — the engine DECLARES the tenant-audit scope exclusion, and that
// declaration is now enforced instead of merely written down.
//
// `buildDriverOptions` sets `bypassTenantAudit` for every write made under
// `ExecutionContext.isSystem`. That is the producing half of the driver's
// `[tenant-audit]` control scope: the driver's second guard reads the flag,
// and this is the only thing that puts it there for a system write.
//
// It lived as a three-line comment ("unscoped by design") that nothing checked,
// which is exactly how the exclusion came to be a declaration nobody had ruled
// on. The ruling arrived on 2026-08-30 (第 5 场总监席决裁批 #9, verbatim
// 「同意」, option A) — 追认「`isSystem` 写入不在本控制范围内」为正式裁定 — and
// this file is the other half of `declared = enforced`: delete the branch and
// something fails.
//
// ⚠️ The ruling states its own condition for return (回头条款): should a system
// write be measured landing a NULL-tenant row on a walled deployment (#13497),
// the scoping goes back to the maintainer. These pins record the scope as ruled
// today, not a permanent property.
//
// The driver leg — what the flag buys once it arrives, and why its guard sits
// where it does — is `driver-sql/src/sql-driver-13491-tenant-audit-scope.test.ts`.

import { describe, it, expect, beforeEach } from 'vitest';
import { ObjectQL } from './engine.js';

const account = {
    name: 'account',
    label: 'Account',
    fields: {
        id: { name: 'id', type: 'text' as const, primaryKey: true },
        name: { name: 'name', type: 'text' as const },
        organization_id: { name: 'organization_id', type: 'text' as const },
    },
};

interface DriverCall {
    method: string;
    options: Record<string, unknown> | undefined;
}

function makeRecordingDriver(calls: DriverCall[]) {
    const rows = new Map<string, Record<string, unknown>>();
    let next = 0;
    const record = (method: string, options: any) => { calls.push({ method, options }); };
    const driver: any = {
        name: 'memory',
        version: '0.0.0',
        supports: {},
        async connect() {}, async disconnect() {}, async checkHealth() { return true; },
        async execute() { return null; },
        async find(_o: string, _ast: any, options: any) {
            record('find', options);
            return Array.from(rows.values());
        },
        async findOne(_o: string, _ast: any, options: any) {
            record('findOne', options);
            return rows.values().next().value ?? null;
        },
        async count(_o: string, _ast: any, options: any) { record('count', options); return rows.size; },
        async create(_o: string, data: any, options: any) {
            record('create', options);
            const id = String(data.id ?? `r${++next}`);
            const row = { ...data, id };
            rows.set(id, row);
            return { ...row };
        },
        async update(_o: string, id: string, data: any, options: any) {
            record('update', options);
            const row = { ...(rows.get(String(id)) ?? { id }), ...data };
            rows.set(String(id), row);
            return { ...row };
        },
        async delete(_o: string, id: string, options: any) {
            record('delete', options);
            rows.delete(String(id));
            return true;
        },
        async bulkCreate() { return []; },
        async bulkUpdate() { return []; },
        async bulkDelete() { return 0; },
        async syncSchema() {},
    };
    return driver;
}

describe('#13491 — `isSystem` declares the write out of the tenant-audit control’s scope', () => {
    let engine: ObjectQL;
    let calls: DriverCall[];

    const optionsFor = (method: string) => calls.find((c) => c.method === method)?.options;

    beforeEach(async () => {
        engine = new ObjectQL();
        calls = [];
        engine.registerDriver(makeRecordingDriver(calls), true);
        await engine.init();
        engine.registry.registerObject(account);
    });

    it('an elevated insert reaches the driver carrying the exclusion', async () => {
        await engine.insert('account', { id: 'a1', name: 'A1' }, { context: { isSystem: true } } as any);
        expect(optionsFor('create')).toMatchObject({ bypassTenantAudit: true });
    });

    it('so do the elevated update and delete verbs', async () => {
        await engine.insert('account', { id: 'a1', name: 'A1' }, { context: { isSystem: true } } as any);
        calls.length = 0;
        await engine.update('account', { name: 'A2' }, { where: { id: 'a1' }, context: { isSystem: true } } as any);
        await engine.delete('account', { where: { id: 'a1' }, context: { isSystem: true } } as any);
        expect(optionsFor('update')).toMatchObject({ bypassTenantAudit: true });
        expect(optionsFor('delete')).toMatchObject({ bypassTenantAudit: true });
    });

    it('an APPLICATION-SURFACE write declares nothing — it stays the control’s subject', async () => {
        // The other half of the reading. Without it, "elevated writes carry the
        // flag" would also pass against an engine that set it on every write —
        // which would silence the control everywhere instead of scoping it.
        await engine.insert('account', { id: 'a1', name: 'A1' });
        expect(optionsFor('create')?.bypassTenantAudit).toBeUndefined();
    });

    it('and neither does a write that carries a tenant but no elevation', async () => {
        await engine.insert('account', { id: 'a1', name: 'A1' }, { context: { tenantId: 'org_a' } } as any);
        const opts = optionsFor('create');
        expect(opts).toMatchObject({ tenantId: 'org_a' });
        expect(opts?.bypassTenantAudit).toBeUndefined();
    });

    it('an explicit caller value is never overwritten by the elevation', async () => {
        // The branch is `=== undefined`-guarded. A caller that deliberately put
        // an elevated write back INSIDE the control keeps that choice — the
        // ruling excludes system writes from the control's scope, it does not
        // forbid opting one back in.
        await engine.insert(
            'account',
            { id: 'a1', name: 'A1' },
            { context: { isSystem: true }, bypassTenantAudit: false } as any,
        );
        expect(optionsFor('create')?.bypassTenantAudit).toBe(false);
    });
});
