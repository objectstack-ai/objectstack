// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#22360] A position the showcase package declares has its DEFINITION locked
// at the data door, the way the metadata door already locks it, while its ROW
// STATE stays switchable — over the real showcase composition under `single`,
// across a cold boot on one database file.
//
// ## What was broken
//
// The declared-position seeder wrote its rows with no provenance stamp, so they
// carried the object default (`managed_by: 'admin'`) and the system-row write
// gate did not protect them. Measured on `origin/main` before the fix, through
// this file's own steps: `PATCH /api/v1/data/sys_position/:id` of `manager`'s
// label answered 200 and the row carried the new label; the next boot wrote the
// declared label back over it, with no message. The metadata door refused the
// same edit (403 `NOT_OVERRIDABLE`).
//
// ## The rule now
//
// The seeder stamps `managed_by: 'package'`, and a package position row is
// locked the way a packaged permission set is (`permission-set-projection.ts`,
// #4669): a patch touching only row state (`active`, `is_default` — Setup's
// Activate, Deactivate and Set as Default) passes; a definition column
// (`label`, `delegatable`, …) and a delete are refused with the gate's code.
//
// ## What each case pins
//
//   - precondition: the showcase package holds the name, and the metadata door
//     refuses an edit of it;
//   - the declared row carries `managed_by: 'package'`; a label edit, a
//     `delegatable` edit and a delete are refused with the gate's code and
//     leave the row as it was;
//   - Deactivate, Activate and Set as Default answer 200; a multi-row
//     (`updateMany`) row-state patch lands, a multi-row label patch is refused;
//   - after a cold boot: the declared label and the refused columns stand, the
//     row-state writes persisted, an upgraded deployment's row (stamped `admin`
//     before the fix) is re-stamped and refused the same way;
//   - controls: an administrator-authored position and an environment-authored
//     one (saved through the metadata door) stay editable; a built-in refuses
//     even a bare `{ active }` patch; the seeder's own system write still
//     refreshes a declared row's display text from the declaration.

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
const SHOWCASE_PACKAGE = 'com.example.showcase';

/** Positions the showcase package declares, with the labels it declares them with. */
const declaredLabel = (name: string): string => {
    const declared = ((showcaseStack as any).positions ?? []).find((p: any) => p?.name === name);
    if (!declared?.label) throw new Error(`the showcase no longer declares a labelled position '${name}'`);
    return declared.label;
};
/** Definition edits and the delete are tried here. */
const EDITED = 'manager';
const DELETED = 'auditor';
/** Row-state writes, one position each, so every write is read back on its own row. */
const DEACTIVATED = 'contributor';
const ACTIVATED = 'legal';
const DEFAULTED = 'ops';
const BULK = ['finance', 'client_liaison'];
/** The upgraded-deployment and drift simulations. */
const UPGRADED = 'exec';
const DRIFTED = 'field_ops_delegate';
const ADMIN_AUTHORED = 'p22360_admin_authored';
const ENV_AUTHORED = 'p22360_env_authored';
const REFUSED = { status: 403, code: 'PERMISSION_DENIED' };

describe('[#22360] a package-declared position: definition locked at the data door, row state switchable, across a cold boot (showcase)', () => {
    let prevCwd: string;
    let dir: string;
    let dbFile: string;
    let stack: VerifyStack | undefined;
    let token: string;
    let ql: any;

    const call = async (method: string, path: string, body?: unknown) => {
        const res = await stack!.apiAs(token, method, path, body);
        const json: any = await res.json().catch(() => ({}));
        return { status: res.status, code: json?.code ?? null, json };
    };
    const rows = async (name: string) =>
        ((await ql.find('sys_position', { where: { name }, limit: 2 }, SYS)) as any[]);
    const one = async (name: string) => {
        const found = await rows(name);
        expect(found.length, `exactly one '${name}' row`).toBe(1);
        return found[0];
    };
    const patch = async (name: string, body: Record<string, unknown>) =>
        call('PATCH', `/data/sys_position/${(await one(name)).id}`, body);
    const outcome = (r: { status: number; code: unknown }) => ({ status: r.status, code: r.code });
    const start = async () => {
        stack = await bootStack(showcaseStack, { databaseFile: dbFile });
        token = await stack.signIn();
        ql = await stack.kernel.getServiceAsync('objectql');
    };

    beforeAll(async () => {
        prevCwd = process.cwd();
        process.chdir(SHOWCASE_DIR);
        dir = mkdtempSync(join(tmpdir(), 'dogfood-22360-'));
        dbFile = join(dir, 'showcase.db');
        await start();
    }, 300_000);

    afterAll(async () => {
        await stack?.stop();
        if (prevCwd) process.chdir(prevCwd);
        if (dir) rmSync(dir, { recursive: true, force: true });
    });

    it('PRECONDITION: single posture; the showcase package holds the name, and the metadata door refuses an edit of it', async () => {
        expect(stack!.tenancy().requestedPosture).toBe('single');
        expect((ql.registry.getArtifactItem('position', EDITED) as any)?._packageId).toBe(SHOWCASE_PACKAGE);
        const put = await call('PUT', `/meta/position/${EDITED}`, { name: EDITED, label: 'Manager (metadata door)' });
        expect(outcome(put), JSON.stringify(put.json)).toEqual({ status: 403, code: 'NOT_OVERRIDABLE' });
    });

    it('the declared row carries package provenance', async () => {
        const row = await one(EDITED);
        expect({ label: row.label, managed_by: row.managed_by })
            .toEqual({ label: declaredLabel(EDITED), managed_by: 'package' });
    });

    it('a label edit and a delegatable edit are refused with the gate\'s code, and the row is unchanged', async () => {
        const before = await one(EDITED);
        const label = await patch(EDITED, { label: 'Manager (edited in Setup)' });
        expect(outcome(label), JSON.stringify(label.json)).toEqual(REFUSED);
        const delegatable = await patch(EDITED, { delegatable: !before.delegatable });
        expect(outcome(delegatable), JSON.stringify(delegatable.json)).toEqual(REFUSED);
        const after = await one(EDITED);
        expect({ label: after.label, delegatable: after.delegatable })
            .toEqual({ label: declaredLabel(EDITED), delegatable: before.delegatable });
    });

    it('a delete is refused with the gate\'s code, and the row stays', async () => {
        const row = await one(DELETED);
        const deleted = await call('DELETE', `/data/sys_position/${row.id}`);
        expect(outcome(deleted), JSON.stringify(deleted.json)).toEqual(REFUSED);
        expect((await rows(DELETED)).map((r) => r.id)).toEqual([row.id]);
    });

    it('Deactivate, Activate and Set as Default answer 200 and land on the row', async () => {
        const deactivated = await patch(DEACTIVATED, { active: false });
        expect(deactivated.status, JSON.stringify(deactivated.json)).toBe(200);

        // Activate needs a deactivated row first; only a system write can make one here
        // without going through the door under test.
        await ql.update('sys_position', { id: (await one(ACTIVATED)).id, active: false }, SYS);
        const activated = await patch(ACTIVATED, { active: true });
        expect(activated.status, JSON.stringify(activated.json)).toBe(200);

        const defaulted = await patch(DEFAULTED, { is_default: true });
        expect(defaulted.status, JSON.stringify(defaulted.json)).toBe(200);

        expect({
            deactivated: (await one(DEACTIVATED)).active,
            activated: (await one(ACTIVATED)).active,
            defaulted: (await one(DEFAULTED)).is_default,
        }).toEqual({ deactivated: false, activated: true, defaulted: true });
    });

    it('a multi-row row-state patch lands, and a multi-row label patch over a package row is refused', async () => {
        const ids = await Promise.all(BULK.map(async (name) => (await one(name)).id));
        const switched = await call('POST', '/data/sys_position/updateMany', {
            records: ids.map((id) => ({ id, data: { active: false } })),
        });
        expect(switched.status, JSON.stringify(switched.json)).toBe(200);
        expect(await Promise.all(BULK.map(async (name) => (await one(name)).active))).toEqual([false, false]);

        const relabelled = await call('POST', '/data/sys_position/updateMany', {
            records: [{ id: ids[0], data: { label: 'Finance (edited in Setup)' } }],
        });
        const refusals = JSON.stringify(relabelled.json);
        expect(refusals, `status ${relabelled.status}`).toContain('PERMISSION_DENIED');
        expect((await one(BULK[0])).label).toBe(declaredLabel(BULK[0]));
    });

    it('control: an administrator-authored position stays editable', async () => {
        const created = await call('POST', '/data/sys_position', { name: ADMIN_AUTHORED, label: 'Admin authored' });
        expect(created.status, JSON.stringify(created.json)).toBe(201);
        expect((await one(ADMIN_AUTHORED)).managed_by).toBe('admin');
        const edited = await patch(ADMIN_AUTHORED, { label: 'Admin authored (edited)' });
        expect(edited.status, JSON.stringify(edited.json)).toBe(200);
        expect((await one(ADMIN_AUTHORED)).label).toBe('Admin authored (edited)');
    });

    it('control: a built-in refuses even a bare { active } patch', async () => {
        const everyone = await one('everyone');
        expect(everyone.managed_by).toBe('platform');
        const switched = await patch('everyone', { active: false });
        expect(outcome(switched), JSON.stringify(switched.json)).toEqual(REFUSED);
        const relabelled = await patch('everyone', { label: 'Everyone (edited)' });
        expect(outcome(relabelled), JSON.stringify(relabelled.json)).toEqual(REFUSED);
        expect((await one('everyone')).active).toBe(everyone.active);
    });

    it('after a cold boot: the definition stands, the row-state writes persisted, an upgraded deployment\'s row is re-stamped and refused, the seeder still refreshes display text', async () => {
        // The upgraded shape: the row a pre-fix boot wrote (the object default,
        // `admin`) carrying a column an administrator set before the upgrade.
        const upgraded = await one(UPGRADED);
        await ql.update('sys_position', { id: upgraded.id, managed_by: 'admin', delegatable: true }, SYS);
        expect([(await one(UPGRADED)).managed_by, (await one(UPGRADED)).delegatable]).toEqual(['admin', true]);
        // Drifted display text, which only a system write can reach now.
        await ql.update('sys_position', { id: (await one(DRIFTED)).id, label: 'Field ops delegate (stale)' }, SYS);
        // An environment-authored position: a metadata-door save, whose row the
        // seeder writes at the next boot.
        const saved = await call('PUT', `/meta/position/${ENV_AUTHORED}`, { name: ENV_AUTHORED, label: 'Environment authored' });
        expect(saved.status, JSON.stringify(saved.json)).toBe(200);

        await stack!.stop();
        await start();

        const edited = await one(EDITED);
        expect({ label: edited.label, managed_by: edited.managed_by })
            .toEqual({ label: declaredLabel(EDITED), managed_by: 'package' });
        expect((await rows(DELETED)).length).toBe(1);
        expect({
            deactivated: (await one(DEACTIVATED)).active,
            activated: (await one(ACTIVATED)).active,
            defaulted: (await one(DEFAULTED)).is_default,
            bulk: await Promise.all(BULK.map(async (name) => (await one(name)).active)),
        }).toEqual({ deactivated: false, activated: true, defaulted: true, bulk: [false, false] });

        const restamped = await one(UPGRADED);
        expect({ managed_by: restamped.managed_by, delegatable: restamped.delegatable, label: restamped.label })
            .toEqual({ managed_by: 'package', delegatable: true, label: declaredLabel(UPGRADED) });
        const refused = await patch(UPGRADED, { label: 'Executive (edited in Setup)' });
        expect(outcome(refused), JSON.stringify(refused.json)).toEqual(REFUSED);

        expect((await one(DRIFTED)).label).toBe(declaredLabel(DRIFTED));
    });

    it('controls after the cold boot: administrator- and environment-authored positions keep unmanaged, editable rows', async () => {
        const admin = await one(ADMIN_AUTHORED);
        expect([admin.label, admin.managed_by]).toEqual(['Admin authored (edited)', 'admin']);
        const env = await one(ENV_AUTHORED);
        expect(env.managed_by, 'the seeder wrote the environment definition\'s row').toBe('admin');
        const edited = await patch(ENV_AUTHORED, { label: 'Environment authored (edited)' });
        expect(edited.status, JSON.stringify(edited.json)).toBe(200);
    });
});
