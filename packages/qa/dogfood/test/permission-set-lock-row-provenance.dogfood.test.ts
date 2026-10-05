// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#21789] The packaged-permission-set lock fires only for a set a code
// (artifact) package ships, judged from the row's provenance — and the read
// the console renders from reports the same judgment the write doors enforce.
// Over the real showcase composition, across a cold boot on one database file.
//
// ## What was broken
//
// The lock (`packaged-permission-set-lock.ts`, plugin-security) asked the
// engine registry "does any item of this name carry a package id?". The
// registry holds stored rows as well as artifacts, and a list read
// (`GET /meta/permission`) hydrates every env-wide `sys_metadata` row into it
// with the row's `package_id` column stamped onto the body as `_packageId`.
// So a set saved into a writable runtime package read as
// code-shipped after the first list read, and every edit of it answered
// `403 NOT_OVERRIDABLE` at both doors. The provenance that tells the two apart
// was on the same body all along: the hydrator writes `_provenance: 'org'` on
// every stored row (ADR-0010), and `isCodeArtifactBody` already reads it.
//
// The READ had its own half. The security plugin syncs an overlay-backed body
// into the metadata manager as a marked "projection echo", and the protocol's
// layered read serves that echo as the item's `code` layer. The echo carried
// no provenance, so an org's own set, a clone, and a runtime-package set all
// reported a code layer with no provenance, which is how objectui's
// permission-matrix editor reads "a code package ships this": it rendered them
// locked while the doors accepted the save. The echo now carries the lock's
// verdict (`_provenance: 'org'` exactly when the lock answers `org`).
//
// Measured on `origin/main` (088428fb) through this file's own steps before the
// fix: the runtime-package set's registry row was
// `{ _packageId: <the package>, _provenance: 'org' }` after the list read,
// then `PUT /meta/permission/<name>?package=` and
// `PATCH /data/sys_permission_set/<id>` both answered 403 `NOT_OVERRIDABLE`;
// all three shapes' layered reads served a `code` layer with no provenance and
// no envelope `provenance`, beside `editable: true`.
//
// ## The pins hold both directions
//
// The lock's declared population is code-shipped sets. This file pins the three
// shapes the card names as editable (the metadata door, the data door, and the
// layered read's report), and pins that a set the showcase package ships is
// still refused at both doors with the same code and status and is still
// reported code-shipped by the read.
//
// ## Why a booted stack, booted twice
//
// The lock's input has one producer, the list read: boot 1 issues it and
// asserts the runtime package was stamped onto the set's registry row BEFORE it
// asserts any edit lands — without that precondition an accepted edit would
// prove nothing. (The boot's own hydration does not stamp the package id; that
// was measured, so no cold-boot leg pretends to exercise it.) The read's input
// has a second producer: the projection echo is minted again by the boot's
// reconciliation rather than by a save, so boot 2, on the same file, reads the
// three shapes again before anything is written.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import showcaseStack from '@objectstack/example-showcase';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { securityObjects } from '@objectstack/plugin-security';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Package-relative refs resolve against the cwd — see the sibling cold-boot files. */
const SHOWCASE_DIR = fileURLToPath(new URL('../../../../examples/app-showcase/', import.meta.url));
const SYS = { context: { isSystem: true } } as const;
const API_BASE = '/api/v1';

/** A writable runtime package, created through `POST /packages`. */
const PKG = 'com.dogfood.lock21789';
/** Shape 1 — a set saved into that runtime package. */
const PKG_SET = 'lock21789_pkgset';
/** Shape 2 — a set the org created through the data door. */
const ORG_SET = 'lock21789_orgset';
/** Shape 3 — a "Clone to customize" clone of a packaged set. */
const CLONE = 'lock21789_clone';
/** The control: a set the showcase package (`com.example.showcase`) ships. */
const SHIPPED = 'showcase_contributor';
const SHIPPED_PACKAGE = 'com.example.showcase';

interface Shape { label: string; name: string; packageQuery: string }
const SHAPES: Shape[] = [
    { label: 'runtime-package set', name: PKG_SET, packageQuery: `?package=${PKG}` },
    { label: 'org-owned set', name: ORG_SET, packageQuery: '' },
    { label: 'clone', name: CLONE, packageQuery: '' },
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

/** Both doors answer this refusal as `{ error: <sentence>, code }`: the code is top-level. */
const refusalCode = (json: any): unknown => json?.code;

describe('[#21789] the permission-set lock reads the row\'s provenance — the three org-owned shapes edit, a code-shipped set stays refused (showcase)', () => {
    let prevCwd: string;
    let dir: string;
    let dbFile: string;
    let stack: VerifyStack | undefined;
    let token: string;
    let ql: any;

    const registryRows = (name: string): any[] =>
        (ql.registry.listItems('permission') ?? []).filter((i: any) => i?.name === name);

    const layered = async (name: string): Promise<any> => {
        const res = await stack!.apiAs(token, 'GET', `/meta/permission/${name}/layers`);
        expect(res.status, `layered read of ${name}`).toBe(200);
        const json: any = await res.json();
        return json?.data ?? json;
    };

    /** A metadata-door save of the whole definition, through the door the console's editor uses. */
    const putDefinition = async (shape: Pick<Shape, 'name' | 'packageQuery'>, label: string) => {
        const res = await stack!.apiAs(token, 'PUT', `/meta/permission/${shape.name}${shape.packageQuery}`, {
            name: shape.name,
            label,
            objects: { showcase_task: { allowRead: true } },
        });
        return { status: res.status, json: await res.json().catch(() => ({})) };
    };

    /** A data-door edit of the record, the way Setup saves it. */
    const patchRecord = async (name: string, description: string) => {
        const [row] = await ql.find('sys_permission_set', { where: { name }, limit: 1 }, SYS);
        expect(row?.id, `the ${name} record exists`).toBeTruthy();
        const res = await stack!.apiAs(token, 'PATCH', `/data/sys_permission_set/${row.id}`, { description });
        return { status: res.status, json: await res.json().catch(() => ({})), id: row.id as string };
    };

    beforeAll(async () => {
        prevCwd = process.cwd();
        process.chdir(SHOWCASE_DIR);
        dir = mkdtempSync(join(tmpdir(), 'dogfood-21789-'));
        dbFile = join(dir, 'showcase.db');
        stack = await bootStack(showcaseStack, { databaseFile: dbFile });
        token = await stack.signIn();
        ql = await stack.kernel.getServiceAsync('objectql');

        // Shape 1: a writable runtime package, and a set saved into it.
        const pkg = await stack.apiAs(token, 'POST', '/packages', {
            manifest: { id: PKG, name: 'Lock provenance probe', version: '0.1.0', type: 'app' },
        });
        expect(pkg.status, JSON.stringify(await pkg.clone().json().catch(() => ({})))).toBe(201);
        const saved = await putDefinition({ name: PKG_SET, packageQuery: `?package=${PKG}` }, 'Runtime package set');
        expect(saved.status, JSON.stringify(saved.json)).toBe(200);

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
        // ⛔ Without this, an accepted edit below proves nothing: a list read
        // that stopped stamping the package id would also leave the set editable.
        const rows = registryRows(PKG_SET);
        expect(rows.map((r) => ({ _packageId: r._packageId ?? null, _provenance: r._provenance ?? null })))
            .toEqual([{ _packageId: PKG, _provenance: 'org' }]);
    });

    for (const shape of SHAPES) {
        it(`${shape.label}: the metadata door accepts an edit, and the edit lands`, async () => {
            const label = `${shape.label} (edited at the metadata door)`;
            const put = await putDefinition(shape, label);
            expect(put.status, JSON.stringify(put.json)).toBe(200);
            expect((await layered(shape.name))?.effective?.label).toBe(label);
        });

        it(`${shape.label}: the data door accepts an edit, and the edit lands`, async () => {
            const description = `${shape.label} (edited at the data door)`;
            const patch = await patchRecord(shape.name, description);
            expect(patch.status, JSON.stringify(patch.json)).toBe(200);
            const [after] = await ql.find('sys_permission_set', { where: { id: patch.id }, limit: 1 }, SYS);
            expect(after?.description).toBe(description);
        });

        it(`${shape.label}: the layered read reports it editable and tenant-authored, not code-shipped`, async () => {
            // The console's artifact test reads the `code` layer and the
            // envelope's `provenance`; `'org'` is the value it carves out.
            const env = await layered(shape.name);
            expect({ editable: env?.editable, provenance: env?.provenance }).toEqual({ editable: true, provenance: 'org' });
        });
    }

    it('control: a set the showcase package ships is still refused at both doors with 403 NOT_OVERRIDABLE', async () => {
        const put = await putDefinition({ name: SHIPPED, packageQuery: '' }, 'Contributor (customized)');
        expect({ status: put.status, code: refusalCode(put.json) }, JSON.stringify(put.json))
            .toEqual({ status: 403, code: 'NOT_OVERRIDABLE' });
        const patch = await patchRecord(SHIPPED, 'customized');
        expect({ status: patch.status, code: refusalCode(patch.json) }, JSON.stringify(patch.json))
            .toEqual({ status: 403, code: 'NOT_OVERRIDABLE' });
    });

    it('control: the layered read still reports the shipped set as code-shipped and not editable', async () => {
        const env = await layered(SHIPPED);
        expect({
            editable: env?.editable,
            provenance: env?.provenance,
            packageId: env?.packageId,
            codePackageId: env?.code?._packageId,
        }).toEqual({ editable: false, provenance: 'package', packageId: SHIPPED_PACKAGE, codePackageId: SHIPPED_PACKAGE });
    });

    describe('after a cold boot on the same database file', () => {
        // The echo the read serves is minted again here by the boot's
        // reconciliation, not by a save: nothing is written before the reads.
        beforeAll(async () => {
            await stack?.stop();
            stack = undefined;
            stack = await bootStack(showcaseStack, { databaseFile: dbFile });
            token = await stack.signIn();
            ql = await stack.kernel.getServiceAsync('objectql');
        }, 300_000);

        it('the echo the boot mints carries the lock\'s verdict: all three shapes read editable and tenant-authored', async () => {
            for (const shape of SHAPES) {
                const env = await layered(shape.name);
                expect({ name: shape.name, editable: env?.editable, provenance: env?.provenance })
                    .toEqual({ name: shape.name, editable: true, provenance: 'org' });
            }
        });

        it('control: the shipped set is still refused at the metadata door with 403 NOT_OVERRIDABLE', async () => {
            const put = await putDefinition({ name: SHIPPED, packageQuery: '' }, 'Contributor (customized)');
            expect({ status: put.status, code: refusalCode(put.json) }, JSON.stringify(put.json))
                .toEqual({ status: 403, code: 'NOT_OVERRIDABLE' });
        });
    });
});
