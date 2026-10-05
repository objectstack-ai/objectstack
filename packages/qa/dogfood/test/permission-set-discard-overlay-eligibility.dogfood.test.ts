// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#21860] The Discard Overlay action deletes stored permission-set rows only
// for a set a code (artifact) package ships, judged by the same classifier the
// write doors use, and the drift report judges the same population. Over the
// real showcase composition, across a cold boot on one database file.
//
// ## What was broken
//
// `POST /api/v1/security/permission-sets/:id/discard-overlay` decided "is this
// set package-declared?" by asking whether any registry item of the set's name
// carried a package id. The registry holds stored rows as well as artifacts,
// and the metadata list read (`GET /meta/permission`) stamps a stored row's
// `package_id` column onto its body as `_packageId`. So a set saved into a
// writable runtime package read as package-declared after the first list read:
// the action answered 200 and deleted the set's only `sys_metadata` row. Its
// declared contract, repeated on the permission-sets page of the docs, is that
// it refuses any set that is not package-declared, so it can never
// destroy an environment-authored set. The drift report read the package id the
// same way, and its `overlay_shadow` detail names this action as the remedy.
//
// ## The pins hold both directions
//
// The three environment-authored shapes (a runtime-package set, an org's own
// set, a clone) are made through their real doors and each is refused with the
// action's existing refusal, `403 PERMISSION_DENIED`, with its rows counted
// before and after. The control is a set the showcase package ships, given a
// legacy overlay: the action still discards that overlay and heals the record
// to the shipped artifact.
//
// ## Why a booted stack, booted twice
//
// The legacy overlay cannot be minted through a door any more (the lock refuses
// both), so it is written straight into `sys_metadata` the way an older release
// left it. The second, cold boot on the same file is what makes it a real
// overlay: the boot's reconciliation projects it onto the record, so the record
// enforces the overlay's grants and the boot's drift pass reports the set as
// `overlay_shadow` — the field shape the action exists for. The list read that
// stamps the runtime package's id is issued after that boot, and a precondition
// asserts the stamp before any refusal is read: without it a refusal would
// prove nothing.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import showcaseStack from '@objectstack/example-showcase';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { securityObjects, computePermissionSetDriftDiagnostics } from '@objectstack/plugin-security';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Package-relative refs resolve against the cwd — see the sibling cold-boot files. */
const SHOWCASE_DIR = fileURLToPath(new URL('../../../../examples/app-showcase/', import.meta.url));
const SYS = { context: { isSystem: true } } as const;
const API_BASE = '/api/v1';

/** A writable runtime package, created through `POST /packages`. */
const PKG = 'com.dogfood.discard21860';
/** Shape 1 — a set saved into that runtime package. */
const PKG_SET = 'discard21860_pkgset';
/** Shape 2 — a set the org created through the data door. */
const ORG_SET = 'discard21860_orgset';
/** Shape 3 — a "Clone to customize" clone of a packaged set. */
const CLONE = 'discard21860_clone';
/** The control: a set the showcase package ships. */
const SHIPPED = 'showcase_contributor';
/** The legacy overlay's grants: fewer objects than the shipped artifact grants. */
const OVERLAY_OBJECTS = { showcase_task: { allowRead: true, allowCreate: false, allowEdit: false, allowDelete: false } };

interface Shape { label: string; name: string }
const SHAPES: Shape[] = [
    { label: 'runtime-package set', name: PKG_SET },
    { label: 'org-owned set', name: ORG_SET },
    { label: 'clone', name: CLONE },
];

interface CloneParam { name?: string; field?: string; defaultFromRow?: boolean }
interface CloneAction { method: string; target: string; bodyExtra?: Record<string, unknown>; params: CloneParam[] }

/** The shipped Clone action, read off the object the security plugin registers. */
function cloneAction(): CloneAction {
    const object = (securityObjects as any[]).find((o) => o?.name === 'sys_permission_set');
    const action = (object?.actions ?? []).find((a: any) => a?.name === 'clone_permission_set');
    if (!action) throw new Error('clone_permission_set is missing from sys_permission_set.actions');
    return action as CloneAction;
}

const grantedObjects = (row: any): string[] => {
    try { return Object.keys(JSON.parse(row?.object_permissions ?? '{}')).sort(); } catch { return []; }
};

describe('[#21860] Discard Overlay refuses every set no code package ships, with every row intact, and still discards a shipped set\'s overlay (showcase)', () => {
    let prevCwd: string;
    let dir: string;
    let dbFile: string;
    let stack: VerifyStack | undefined;
    let token: string;
    let ql: any;
    let shippedArtifactObjects: string[];

    const registryRows = (name: string): any[] =>
        (ql.registry.listItems('permission') ?? []).filter((i: any) => i?.name === name);

    /** Both tables, for one name: the record(s) and the stored definition row(s), whole. */
    const rowsOf = async (name: string) => {
        const records = await ql.find('sys_permission_set', { where: { name } }, SYS);
        const stored: any[] = [];
        for (const type of ['permission', 'permissions']) {
            stored.push(...(await ql.find('sys_metadata', { where: { type, name } }, SYS)));
        }
        return {
            records: (records as any[]).map((r) => r.id).sort(),
            stored: stored.map((r) => ({ id: r.id, state: r.state, metadata: r.metadata })).sort((a, b) => (a.id < b.id ? -1 : 1)),
        };
    };

    const discard = async (name: string) => {
        const [row] = await ql.find('sys_permission_set', { where: { name }, limit: 1 }, SYS);
        expect(row?.id, `the ${name} record exists`).toBeTruthy();
        const res = await stack!.apiAs(token, 'POST', `/security/permission-sets/${row.id}/discard-overlay`, {});
        return { status: res.status, json: (await res.json().catch(() => ({}))) as any };
    };

    beforeAll(async () => {
        prevCwd = process.cwd();
        process.chdir(SHOWCASE_DIR);
        dir = mkdtempSync(join(tmpdir(), 'dogfood-21860-'));
        dbFile = join(dir, 'showcase.db');
        stack = await bootStack(showcaseStack, { databaseFile: dbFile });
        token = await stack.signIn();
        ql = await stack.kernel.getServiceAsync('objectql');

        // Shape 1: a writable runtime package, and a set saved into it.
        const pkg = await stack.apiAs(token, 'POST', '/packages', {
            manifest: { id: PKG, name: 'Discard eligibility probe', version: '0.1.0', type: 'app' },
        });
        expect(pkg.status, JSON.stringify(await pkg.clone().json().catch(() => ({})))).toBe(201);
        const saved = await stack.apiAs(token, 'PUT', `/meta/permission/${PKG_SET}?package=${PKG}`, {
            name: PKG_SET,
            label: 'Runtime package set',
            objects: { showcase_task: { allowRead: true } },
        });
        expect(saved.status, JSON.stringify(await saved.clone().json().catch(() => ({})))).toBe(200);

        // Shape 2: the org's own set, created through the data door.
        const created = await stack.apiAs(token, 'POST', '/data/sys_permission_set', {
            name: ORG_SET,
            label: 'Org-owned set',
            object_permissions: JSON.stringify({ showcase_task: { allowRead: true } }),
        });
        expect(created.status, JSON.stringify(await created.clone().json().catch(() => ({})))).toBe(201);

        // Shape 3: a clone, made the way the Setup dialog makes it — the payload
        // is built from the shipped action's own declaration.
        const [base] = await ql.find('sys_permission_set', { where: { name: SHIPPED }, limit: 1 }, SYS);
        shippedArtifactObjects = grantedObjects(base);
        const read = await stack.apiAs(token, 'GET', `/data/sys_permission_set/${base.id}`);
        const served: any = await read.json();
        const row = served?.record ?? served?.data?.record ?? served?.data;
        const action = cloneAction();
        const body: Record<string, unknown> = { ...(action.bodyExtra ?? {}) };
        for (const p of action.params) {
            if (p.name === 'label') body.label = 'Contributor (clone)';
            else if (p.name === 'name') body.name = CLONE;
            else if (p.field && p.defaultFromRow) body[p.field] = row?.[p.field];
        }
        expect(action.target.startsWith(API_BASE), action.target).toBe(true);
        const cloned = await stack.apiAs(token, action.method, action.target.slice(API_BASE.length), body);
        expect(cloned.status, JSON.stringify(await cloned.clone().json().catch(() => ({})))).toBe(201);

        // The control's legacy overlay, as an older release left it: an active,
        // environment-wide stored definition of a name the package ships.
        const now = new Date().toISOString();
        await ql.insert('sys_metadata', {
            type: 'permission',
            name: SHIPPED,
            organization_id: null,
            package_id: null,
            state: 'active',
            version: 1,
            checksum: null,
            created_at: now,
            updated_at: now,
            metadata: JSON.stringify({ name: SHIPPED, label: 'Showcase Contributor (legacy overlay)', objects: OVERLAY_OBJECTS }),
        }, SYS);
        await stack.stop();

        // The cold boot that makes the legacy row a real overlay.
        stack = undefined;
        stack = await bootStack(showcaseStack, { databaseFile: dbFile });
        token = await stack.signIn();
        ql = await stack.kernel.getServiceAsync('objectql');

        // The producer the card names: the list read a Studio page load issues.
        const list = await stack.apiAs(token, 'GET', '/meta/permission');
        expect(list.status).toBe(200);
    }, 300_000);

    afterAll(async () => {
        await stack?.stop();
        if (prevCwd) process.chdir(prevCwd);
        if (dir) rmSync(dir, { recursive: true, force: true });
    });

    it('precondition: the list read stamped the runtime package onto its set\'s registry row, as a stored row', () => {
        // ⛔ Without this, a refusal below proves nothing: a list read that
        // stopped stamping the package id would also leave the set refused.
        const rows = registryRows(PKG_SET);
        expect(rows.map((r) => ({ _packageId: r._packageId ?? null, _provenance: r._provenance ?? null })))
            .toEqual([{ _packageId: PKG, _provenance: 'org' }]);
    });

    it('precondition: the shipped set\'s record enforces the legacy overlay, and the boot reported it overlay_shadow', async () => {
        const [record] = await ql.find('sys_permission_set', { where: { name: SHIPPED }, limit: 1 }, SYS);
        expect(grantedObjects(record)).toEqual(Object.keys(OVERLAY_OBJECTS));
        expect(shippedArtifactObjects.length).toBeGreaterThan(Object.keys(OVERLAY_OBJECTS).length);
        expect(record?.drift_status).toBe('overlay_shadow');
        expect((await rowsOf(SHIPPED)).stored).toHaveLength(1);
    });

    for (const shape of SHAPES) {
        it(`${shape.label}: Discard Overlay is refused with 403 PERMISSION_DENIED, and every row is intact`, async () => {
            const before = await rowsOf(shape.name);
            // The stored definition the old reading deleted is there to lose.
            expect(before.records).toHaveLength(1);
            expect(before.stored.length).toBeGreaterThanOrEqual(1);

            const res = await discard(shape.name);
            expect({ status: res.status, code: res.json?.error?.code }, JSON.stringify(res.json))
                .toEqual({ status: 403, code: 'PERMISSION_DENIED' });

            const after = await rowsOf(shape.name);
            expect({ records: after.records.length, stored: after.stored.length })
                .toEqual({ records: before.records.length, stored: before.stored.length });
            expect(after).toEqual(before);
        });
    }

    it('the drift report judges the same population: the shipped set is judged, none of the three shapes is', async () => {
        const judged = new Set((await computePermissionSetDriftDiagnostics(ql)).map((d) => d.name));
        expect({
            shipped: judged.has(SHIPPED),
            [PKG_SET]: judged.has(PKG_SET),
            [ORG_SET]: judged.has(ORG_SET),
            [CLONE]: judged.has(CLONE),
        }).toEqual({ shipped: true, [PKG_SET]: false, [ORG_SET]: false, [CLONE]: false });
    });

    it('control: a shipped set\'s legacy overlay is still discarded, and the record heals to the shipped artifact', async () => {
        const before = await rowsOf(SHIPPED);
        const res = await discard(SHIPPED);
        expect(res.status, JSON.stringify(res.json)).toBe(200);
        expect(res.json?.data?.overlaysDiscarded).toBe(1);

        const after = await rowsOf(SHIPPED);
        expect({ records: after.records, stored: after.stored.length }).toEqual({ records: before.records, stored: 0 });
        const [record] = await ql.find('sys_permission_set', { where: { name: SHIPPED }, limit: 1 }, SYS);
        expect(grantedObjects(record)).toEqual(shippedArtifactObjects);
    });
});
