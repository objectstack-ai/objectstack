// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#21861] A data-door edit of a permission set updates the set's OWN
// `sys_metadata` row. For a set saved into a writable runtime package, that row
// is bound to the package, and the edit must land on it rather than beside it.
// Over the real showcase composition.
//
// ## What was broken
//
// The data door (`PATCH /api/v1/data/sys_permission_set/:id`) redirects a
// definition edit into the metadata store (`createPermissionSetWriteThrough`,
// plugin-security). Its update leg merged the patch into the stored body and
// saved it with no package. A `sys_metadata` row is keyed
// `(org, type, name, package_id)`, and a save that names no package targets the
// package-less row, so for a set whose only row was bound to a runtime package
// the save minted a SECOND, package-less active row carrying the edit, and left
// the package-bound row as it was. Two active rows for one name; the package's
// copy of the set silently stopped receiving the org's edits.
//
// Measured on `origin/main` (88a39c09) through this file's own steps before the
// fix: the runtime-package set's first data-door edit answered `200`, and the
// active rows for its name went from one, bound to the package, to two: the
// untouched package-bound row and a package-less row carrying the edit.
//
// ## The pins hold all three populations
//
//  - a set saved into a writable runtime package: `200`, exactly one active row
//    before and after, still bound to the package and carrying the edit. Edited
//    twice, before and after the list read every Studio page load issues,
//    because that read is what made the edit reachable from Setup at all (it
//    used to trip the packaged-set lock until the lock read the row's
//    provenance);
//  - a package-less set: `200`, one package-less row before and after, carrying
//    the edit — the fix must not start binding sets that have no package;
//  - a set a code package ships: still `403 NOT_OVERRIDABLE`, and the edit
//    mints no row — the lock is untouched.
//
// Rows are counted under both type spellings, across every scope, so a fork in
// any of them is visible. Each case counts before and after its edit.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import showcaseStack from '@objectstack/example-showcase';
import { bootStack, type VerifyStack } from '@objectstack/verify';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** Package-relative refs resolve against the cwd — see the sibling cold-boot files. */
const SHOWCASE_DIR = fileURLToPath(new URL('../../../../examples/app-showcase/', import.meta.url));
const SYS = { context: { isSystem: true } } as const;

/** A writable runtime package, created through `POST /packages`. */
const PKG = 'com.dogfood.bind21861';
/** A set saved into that package through the metadata door. */
const PKG_SET = 'bind21861_pkgset';
/** A set the org created through the data door: no package. */
const ORG_SET = 'bind21861_orgset';
/** The control: a set the showcase package (`com.example.showcase`) ships. */
const SHIPPED = 'showcase_contributor';

/** Both doors answer the lock's refusal as `{ error: <sentence>, code }`: the code is top-level. */
const refusalCode = (json: any): unknown => json?.code;

interface StoredRow { organization_id: string | null; package_id: string | null; description: unknown }

describe('[#21861] a data-door edit of a permission set updates its own sys_metadata row (showcase)', () => {
    let prevCwd: string;
    let dir: string;
    let stack: VerifyStack | undefined;
    let token: string;
    let ql: any;

    /**
     * Every ACTIVE stored row for `name`, under either type spelling and in any
     * scope, as its scope, its package binding and the description its body
     * carries.
     */
    const activeRows = async (name: string): Promise<StoredRow[]> => {
        const rows: any[] = [];
        for (const type of ['permission', 'permissions']) {
            rows.push(...await ql.find('sys_metadata', { where: { type, name, state: 'active' }, limit: 10 }, SYS));
        }
        return rows.map((r) => {
            const body = typeof r.metadata === 'string' ? JSON.parse(r.metadata) : r.metadata;
            return {
                organization_id: r.organization_id ?? null,
                package_id: r.package_id ?? null,
                description: body?.description,
            };
        });
    };

    /** A data-door edit of the record, the way Setup saves it. */
    const patchRecord = async (name: string, description: string) => {
        const [row] = await ql.find('sys_permission_set', { where: { name }, limit: 1 }, SYS);
        expect(row?.id, `the ${name} record exists`).toBeTruthy();
        const res = await stack!.apiAs(token, 'PATCH', `/data/sys_permission_set/${row.id}`, { description });
        return { status: res.status, json: await res.json().catch(() => ({})), id: row.id as string };
    };

    /** Edit `name` through the data door and assert it landed on its one row, bound to `packageId`. */
    const editLandsOnItsOwnRow = async (name: string, packageId: string | null, description: string) => {
        const before = await activeRows(name);
        expect(before.map(({ organization_id, package_id }) => ({ organization_id, package_id })), 'before the edit')
            .toEqual([{ organization_id: null, package_id: packageId }]);

        const patch = await patchRecord(name, description);
        expect(patch.status, JSON.stringify(patch.json)).toBe(200);

        const after = await activeRows(name);
        expect(after, 'after the edit: still one active row, same binding, carrying the edit')
            .toEqual([{ organization_id: null, package_id: packageId, description }]);
        const [record] = await ql.find('sys_permission_set', { where: { id: patch.id }, limit: 1 }, SYS);
        expect(record?.description, 'the projected record follows the row').toBe(description);
    };

    beforeAll(async () => {
        prevCwd = process.cwd();
        process.chdir(SHOWCASE_DIR);
        dir = mkdtempSync(join(tmpdir(), 'dogfood-21861-'));
        stack = await bootStack(showcaseStack, { databaseFile: join(dir, 'showcase.db') });
        token = await stack.signIn();
        ql = await stack.kernel.getServiceAsync('objectql');

        // A writable runtime package, and a set saved into it at the metadata door.
        const pkg = await stack.apiAs(token, 'POST', '/packages', {
            manifest: { id: PKG, name: 'Write-through binding probe', version: '0.1.0', type: 'app' },
        });
        expect(pkg.status, JSON.stringify(await pkg.clone().json().catch(() => ({})))).toBe(201);
        const saved = await stack.apiAs(token, 'PUT', `/meta/permission/${PKG_SET}?package=${PKG}`, {
            name: PKG_SET,
            label: 'Runtime package set',
            objects: { showcase_task: { allowRead: true } },
        });
        expect(saved.status, JSON.stringify(await saved.clone().json().catch(() => ({})))).toBe(200);

        // The org's own set, created through the data door.
        const created = await stack.apiAs(token, 'POST', '/data/sys_permission_set', {
            name: ORG_SET,
            label: 'Org-owned set',
            object_permissions: JSON.stringify({ showcase_task: { allowRead: true } }),
        });
        expect(created.status, JSON.stringify(await created.clone().json().catch(() => ({})))).toBe(201);
    }, 300_000);

    afterAll(async () => {
        await stack?.stop();
        if (prevCwd) process.chdir(prevCwd);
        if (dir) rmSync(dir, { recursive: true, force: true });
    });

    it('runtime-package set: the data-door edit answers 200 and lands on its own package-bound row', async () => {
        await editLandsOnItsOwnRow(PKG_SET, PKG, 'Edited at the data door');
    });

    it('runtime-package set: the same holds after the list read every Studio page load issues', async () => {
        const list = await stack!.apiAs(token, 'GET', '/meta/permission');
        expect(list.status).toBe(200);
        await editLandsOnItsOwnRow(PKG_SET, PKG, 'Edited again, after the list read');
    });

    it('package-less set: the data-door edit still saves package-less, on its one row', async () => {
        await editLandsOnItsOwnRow(ORG_SET, null, 'Org set, edited at the data door');
    });

    it('control: a set a code package ships is still refused with 403 NOT_OVERRIDABLE, and no row is minted', async () => {
        const before = await activeRows(SHIPPED);
        const patch = await patchRecord(SHIPPED, 'customized');
        expect({ status: patch.status, code: refusalCode(patch.json) }, JSON.stringify(patch.json))
            .toEqual({ status: 403, code: 'NOT_OVERRIDABLE' });
        expect(await activeRows(SHIPPED), 'the refused edit stored nothing').toEqual(before);
    });
});
