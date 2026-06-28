// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';
import { hashSpec } from '@objectstack/metadata-core';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';

/**
 * Repository write-path coverage (post PR-10d.6).
 *
 * `saveMetaItem` unconditionally routes overlay-allowed metadata types
 * through `SysMetadataRepository.put`; the feature flag is gone. These
 * tests stub the engine surface that both the protocol and the repository
 * touch: findOne / find / insert / update / delete on `sys_metadata`,
 * plus a minimal registry (only consulted for `type === 'object'`).
 */

interface Row {
    id: string;
    type: string;
    name: string;
    organization_id: string | null;
    state: string;
    metadata: string;
    checksum?: string;
    version?: number;
    updated_at?: string;
    created_at?: string;
}

function keyOf(w: Record<string, unknown>) {
    return `${w.type}|${w.name}|${w.organization_id ?? '__env__'}`;
}

function makeStubEngine() {
    const rows = new Map<string, Row>();
    let nextId = 0;
    const findRow = (w: Record<string, unknown>): { key: string; row: Row } | null => {
        if (w.id !== undefined) {
            for (const [k, r] of rows) if (r.id === w.id) return { key: k, row: r };
            return null;
        }
        const k = keyOf(w);
        const r = rows.get(k);
        return r ? { key: k, row: r } : null;
    };
    const engine: any = {
        async findOne(_t: string, opts: { where: Record<string, unknown> }) {
            return findRow(opts.where)?.row ?? null;
        },
        async find(_t: string, opts: { where: Record<string, unknown> }) {
            return Array.from(rows.values()).filter((r) => {
                if (opts.where.type && r.type !== opts.where.type) return false;
                if (opts.where.organization_id !== undefined
                    && r.organization_id !== opts.where.organization_id) return false;
                if (opts.where.state && r.state !== opts.where.state) return false;
                return true;
            });
        },
        async insert(_t: string, data: Record<string, unknown>) {
            if (_t === 'sys_metadata_audit') return { id: 'audit_skip' };
            nextId += 1;
            const row = { id: `r_${nextId}`, ...(data as any) } as Row;
            rows.set(keyOf(data), row);
            return { id: row.id };
        },
        async update(_t: string, data: Record<string, unknown>, opts: { where: Record<string, unknown> }) {
            const found = findRow(opts.where);
            if (!found) return { id: null };
            rows.set(found.key, { ...found.row, ...(data as any) });
            return { id: found.row.id };
        },
        async delete(_t: string, opts: { where: Record<string, unknown> }) {
            const found = findRow(opts.where);
            if (!found) return { deleted: 0 };
            rows.delete(found.key);
            return { deleted: 1 };
        },
        registry: {
            registerItem: () => {},
            registerObject: () => {},
        },
    };
    return { engine, rows };
}

describe('saveMetaItem — repository write path (post PR-10d.6)', () => {
    it('overlay-allowed types take the repository path: checksum + seq are emitted', async () => {
        // PR-10d.6 removed the `useRepositoryWritePath` flag — overlay-allowed
        // types unconditionally route through SysMetadataRepository.put.
        const { engine, rows } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);
        const result = await protocol.saveMetaItem({
            type: 'view',
            name: 'case_grid',
            organizationId: 'org_alpha',
            item: { name: 'case_grid', type: 'grid', label: 'Cases', columns: ['id', 'title'] },
        });
        expect(result.success).toBe(true);
        expect((result as any).seq).toBeGreaterThan(0);
        const row = Array.from(rows.values())[0];
        expect(typeof row.checksum).toBe('string');
        expect(row.checksum.startsWith('sha256:')).toBe(true);
    });

    it('repository path writes the checksum and surfaces seq', async () => {
        const { engine, rows } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);
        const body = { name: 'case_grid', type: 'grid', label: 'Cases', columns: ['id', 'title'] };
        const result = await protocol.saveMetaItem({
            type: 'view',
            name: 'case_grid',
            organizationId: 'org_alpha',
            item: body,
        });
        expect(result.success).toBe(true);
        expect((result as any).seq).toBe(1);
        const row = Array.from(rows.values())[0];
        expect(row.checksum).toBe(hashSpec(body));
    });

    it('repository path increments seq across writes and updates the body', async () => {
        const { engine, rows } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);
        const r1 = await protocol.saveMetaItem({
            type: 'view', name: 'v', organizationId: 'org',
            item: { name: 'view_one', type: 'grid', label: 'A', columns: ['id'] },
        });
        const r2 = await protocol.saveMetaItem({
            type: 'view', name: 'v', organizationId: 'org',
            item: { name: 'view_one', type: 'grid', label: 'B', columns: ['id'] },
        });
        expect((r1 as any).seq).toBe(1);
        expect((r2 as any).seq).toBe(2);
        const row = Array.from(rows.values())[0];
        expect(JSON.parse(row.metadata).label).toBe('B');
    });

    it('repository path returns 409 on parentVersion mismatch', async () => {
        const { engine } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);
        // First write establishes a HEAD.
        await protocol.saveMetaItem({
            type: 'view', name: 'v', organizationId: 'org',
            item: { name: 'view_one', type: 'grid', label: 'A', columns: ['id'] },
        });
        // Second write with an explicit stale parentVersion → conflict.
        await expect(
            protocol.saveMetaItem({
                type: 'view', name: 'v', organizationId: 'org',
                item: { name: 'view_one', type: 'grid', label: 'B', columns: ['id'] },
                parentVersion: 'sha256:notTheCurrentHead',
            }),
        ).rejects.toMatchObject({
            code: 'metadata_conflict',
            status: 409,
        });
    });

    it('repository path no-ops when body is identical (idempotent put)', async () => {
        const { engine, rows } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);
        const body = { name: 'view_one', type: 'grid', label: 'A', columns: ['id'] };
        const r1 = await protocol.saveMetaItem({
            type: 'view', name: 'v', organizationId: 'org', item: body,
        });
        const r2 = await protocol.saveMetaItem({
            type: 'view', name: 'v', organizationId: 'org', item: body,
        });
        // No new seq allocated for an identical body.
        expect((r1 as any).seq).toBe(1);
        expect((r2 as any).seq).toBe(1);
        // Still only one row in the store.
        expect(rows.size).toBe(1);
    });

    it('env-wide overlays (organizationId omitted) use a separate repo bucket', async () => {
        const { engine, rows } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);
        await protocol.saveMetaItem({
            type: 'view', name: 'v',
            item: { name: 'view_one', type: 'grid', label: 'env-wide', columns: ['id'] },
        });
        await protocol.saveMetaItem({
            type: 'view', name: 'v', organizationId: 'org_alpha',
            item: { name: 'view_one', type: 'grid', label: 'org_alpha', columns: ['id'] },
        });
        // Two rows: one with organization_id=null, one with org_alpha.
        expect(rows.size).toBe(2);
        const orgs = Array.from(rows.values()).map((r) => r.organization_id).sort();
        expect(orgs).toEqual([null, 'org_alpha']);
    });

    it('plural type (e.g. "views") is normalized to singular before the repo gate (rubber-duck #5)', async () => {
        const { engine, rows } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);
        // 'views' must succeed — the repo only knows the singular form, so
        // without normalization this would throw 403 not_overridable.
        const result = await protocol.saveMetaItem({
            type: 'views',
            name: 'case_grid',
            organizationId: 'org',
            item: { name: 'case_grid', type: 'grid', label: 'OK', columns: ['id'] },
        });
        expect(result.success).toBe(true);
        const row = Array.from(rows.values())[0];
        // The stored row keeps the SINGULAR type since the repo writes it.
        expect(row.type).toBe('view');
    });

    it('rejects the layered read envelope as a write body (regression: stub overlay rows)', async () => {
        // A designer surface that lacks a dedicated editor for a type can
        // accidentally PUT the layered GET (`?layers=true`) envelope straight
        // back. That shape — { type, name, code, overlay, overlayScope,
        // effective } — is never a real metadata body, and persisting it
        // produced all-null stub rows that surfaced as metadata diagnostic
        // errors in the admin UI. saveMetaItem must reject it before any write.
        const { engine, rows } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);
        await expect(
            protocol.saveMetaItem({
                type: 'report',
                name: 'accounts_by_industry_type',
                organizationId: 'org',
                item: {
                    type: 'report',
                    name: 'accounts_by_industry_type',
                    code: null,
                    overlay: null,
                    overlayScope: null,
                    effective: null,
                },
            }),
        ).rejects.toMatchObject({ code: 'invalid_metadata', status: 422 });
        // Nothing was persisted.
        expect(rows.size).toBe(0);
    });

    it('on ConflictError the overlay row body is unchanged (rubber-duck #3 invariant)', async () => {
        const { engine, rows } = makeStubEngine();
        const protocol = new ObjectStackProtocolImplementation(engine);

        // Establish a HEAD overlay.
        await protocol.saveMetaItem({
            type: 'view',
            name: 'cases',
            organizationId: 'org_x',
            item: { name: 'cases', type: 'grid', label: 'Original', columns: ['id'] },
        });
        const beforeBody = (Array.from(rows.values())[0] as any).metadata;

        // Stale parentVersion → 409. The stored body must not change.
        await expect(
            protocol.saveMetaItem({
                type: 'view',
                name: 'cases',
                organizationId: 'org_x',
                item: { name: 'cases', type: 'grid', label: 'Mutated (should not land)', columns: ['id'] },
                parentVersion: 'sha256:stale',
            }),
        ).rejects.toMatchObject({ code: 'metadata_conflict', status: 409 });

        const afterBody = (Array.from(rows.values())[0] as any).metadata;
        expect(afterBody).toBe(beforeBody);
    });

    // ── runtime-only writes must not be stamped into a code package ──────
    // Regression: a custom object authored in Studio while a CODE package was
    // selected in the dropdown (`?package=`) was persisted with
    // `package_id = <code package>`, then read back as "code-provided" and
    // locked read-only after publish. saveMetaItem now coerces such a
    // runtime-only write to an org-owned overlay (`package_id = null`).
    //
    // We spy on the `sys_metadata` insert rather than reading back the stub
    // row map (whose key ignores the table, so lineage/history inserts can
    // collide with — and clobber — the parent row's `package_id`).
    function spyInserts(engine: any): Array<Record<string, unknown>> {
        const captured: Array<Record<string, unknown>> = [];
        const orig = engine.insert.bind(engine);
        engine.insert = async (t: string, data: Record<string, unknown>, opts?: unknown) => {
            if (t === 'sys_metadata') captured.push(data);
            return orig(t, data, opts);
        };
        return captured;
    }

    it('runtime-only create into a LOADED code package is rejected (writable_package_required)', async () => {
        // ADR-0070 D1: a brand-new object authored while a loaded code package
        // is selected must NOT be silently coerced to a package-less orphan
        // (the old #2252 behaviour) — it is rejected so the authoring surface
        // redirects the user to pick or create a writable base first.
        const { engine } = makeStubEngine();
        engine.manifests = new Map([['app.objectstack.hotcrm', { id: 'app.objectstack.hotcrm' }]]);
        const inserts = spyInserts(engine);
        const protocol = new ObjectStackProtocolImplementation(engine);
        await expect(
            protocol.saveMetaItem({
                type: 'object',
                name: 'maint_asset',
                organizationId: 'org_alpha',
                packageId: 'app.objectstack.hotcrm', // Studio had a code package selected
                mode: 'draft',
                item: { name: 'maint_asset', label: 'Asset', fields: { name: { type: 'text', label: 'Name' } } },
            }),
        ).rejects.toMatchObject({ code: 'writable_package_required', status: 422 });
        // The orphan is never created — nothing was persisted.
        expect(inserts.find((d) => d.type === 'object' && d.name === 'maint_asset')).toBeUndefined();
    });

    it('runtime-only create into a system-scoped installed package is rejected', async () => {
        // ADR-0070 D2: read-only is also detected via manifest scope — an
        // installed/platform package (scope system|cloud) that is NOT in the
        // engine manifest map is still not a writable base.
        const { engine } = makeStubEngine();
        engine.registry.getPackage = (id: string) =>
            id === 'platform.core' ? { manifest: { id, scope: 'system' } } : undefined;
        const inserts = spyInserts(engine);
        const protocol = new ObjectStackProtocolImplementation(engine);
        await expect(
            protocol.saveMetaItem({
                type: 'object',
                name: 'maint_asset',
                organizationId: 'org_alpha',
                packageId: 'platform.core',
                mode: 'draft',
                item: { name: 'maint_asset', label: 'Asset', fields: { name: { type: 'text', label: 'Name' } } },
            }),
        ).rejects.toMatchObject({ code: 'writable_package_required', status: 422 });
        expect(inserts.find((d) => d.type === 'object' && d.name === 'maint_asset')).toBeUndefined();
    });

    it('runtime-only create into a NON-loaded package keeps its binding (ADR-0048 #1824 authoring scope)', async () => {
        // A package *authoring workspace* is a bare id with no booted manifest
        // and no registered metadata. Per-package authoring scope must survive,
        // so the guard must leave such a binding intact.
        const { engine } = makeStubEngine();
        // No manifests map / empty → isLoadedPackage('com.acme.beta') is false.
        const inserts = spyInserts(engine);
        const protocol = new ObjectStackProtocolImplementation(engine);
        await protocol.saveMetaItem({
            type: 'object',
            name: 'maint_ticket',
            organizationId: 'org_alpha',
            packageId: 'com.acme.beta',
            mode: 'draft',
            item: { name: 'maint_ticket', label: 'Ticket', fields: { name: { type: 'text', label: 'Name' } } },
        });
        const create = inserts.find((d) => d.type === 'object' && d.name === 'maint_ticket');
        expect(create).toBeTruthy();
        expect(create!.package_id).toBe('com.acme.beta');
    });

    it('override-artifact write keeps its package binding (guard only touches runtime-only creates)', async () => {
        // An org overlay OF a packaged item (intent = 'override-artifact') must
        // stay bound to that package even though the package is loaded. Make the
        // packaged view artifact-backed so the write is an override, not a fresh
        // create. (Objects are not override-allowed, so the control uses a view.)
        const { engine } = makeStubEngine();
        engine.manifests = new Map([['app.objectstack.hotcrm', { id: 'app.objectstack.hotcrm' }]]);
        engine.registry.getArtifactItem = (type: string, name: string) =>
            type === 'view' && name === 'case_grid'
                ? { _packageId: 'app.objectstack.hotcrm', name, type: 'grid' }
                : undefined;
        const inserts = spyInserts(engine);
        const protocol = new ObjectStackProtocolImplementation(engine);
        await protocol.saveMetaItem({
            type: 'view',
            name: 'case_grid',
            organizationId: 'org_alpha',
            packageId: 'app.objectstack.hotcrm',
            mode: 'draft',
            item: { name: 'case_grid', type: 'grid', label: 'Cases (org overlay)', columns: ['id', 'title'] },
        });
        const create = inserts.find((d) => d.type === 'view' && d.name === 'case_grid');
        expect(create).toBeTruthy();
        expect(create!.package_id).toBe('app.objectstack.hotcrm');
    });
});
