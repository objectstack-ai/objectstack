// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [#22360] A position the showcase package declares is refused at the data
// door, the way the metadata door already refuses it, and keeps its declared
// label across a cold boot on one database file — over the real showcase
// composition under `single`.
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
// ## What each case pins
//
//   - precondition: the showcase package holds the name, and the metadata door
//     refuses an edit of it;
//   - the declared row carries `managed_by: 'package'`, and a data-door edit of
//     its label is refused with the gate's code, the row unchanged;
//   - after a cold boot the row still carries the declared label;
//   - an upgraded deployment's declared row (stamped `admin` before the fix) is
//     re-stamped at boot — the columns an administrator set before are kept —
//     and then refused the same way;
//   - controls: an administrator-authored position and an environment-authored
//     one (saved through the metadata door) stay editable; a built-in's refusal
//     is unchanged; the seeder's own system write still refreshes a declared
//     row's display text from the declaration.

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
const EDITED = 'manager';
const UPGRADED = 'exec';
const DRIFTED = 'contributor';
const ADMIN_AUTHORED = 'p22360_admin_authored';
const ENV_AUTHORED = 'p22360_env_authored';

describe('[#22360] a package-declared position is refused at the data door and survives a cold boot (showcase)', () => {
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
    const row = async (name: string) =>
        ((await ql.find('sys_position', { where: { name }, limit: 2 }, SYS)) as any[]);
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
        expect({ status: put.status, code: put.code }, JSON.stringify(put.json)).toEqual({ status: 403, code: 'NOT_OVERRIDABLE' });
    });

    it('the declared row carries package provenance', async () => {
        const rows = await row(EDITED);
        expect(rows.map((r) => ({ label: r.label, managed_by: r.managed_by })))
            .toEqual([{ label: declaredLabel(EDITED), managed_by: 'package' }]);
    });

    it('a data-door edit of its label is refused with the gate\'s code, and the row is unchanged', async () => {
        const [before] = await row(EDITED);
        const edited = await call('PATCH', `/data/sys_position/${before.id}`, { label: 'Manager (edited in Setup)' });
        expect({ status: edited.status, code: edited.code }, JSON.stringify(edited.json))
            .toEqual({ status: 403, code: 'PERMISSION_DENIED' });
        expect((await row(EDITED)).map((r) => r.label)).toEqual([declaredLabel(EDITED)]);
    });

    it('control: an administrator-authored position stays editable', async () => {
        const created = await call('POST', '/data/sys_position', { name: ADMIN_AUTHORED, label: 'Admin authored' });
        expect(created.status, JSON.stringify(created.json)).toBe(201);
        const [r] = await row(ADMIN_AUTHORED);
        expect(r.managed_by).toBe('admin');
        const edited = await call('PATCH', `/data/sys_position/${r.id}`, { label: 'Admin authored (edited)' });
        expect(edited.status, JSON.stringify(edited.json)).toBe(200);
        expect((await row(ADMIN_AUTHORED)).map((x) => x.label)).toEqual(['Admin authored (edited)']);
    });

    it('control: a built-in\'s refusal is unchanged', async () => {
        const [everyone] = await row('everyone');
        expect(everyone.managed_by).toBe('platform');
        const edited = await call('PATCH', `/data/sys_position/${everyone.id}`, { label: 'Everyone (edited)' });
        expect({ status: edited.status, code: edited.code }, JSON.stringify(edited.json))
            .toEqual({ status: 403, code: 'PERMISSION_DENIED' });
    });

    it('after a cold boot: the declared label stands, an upgraded deployment\'s row is re-stamped and refused, the seeder still refreshes display text', async () => {
        // The upgraded shape: the row a pre-fix boot wrote (the object default,
        // `admin`) carrying a column an administrator set before the upgrade.
        const [upgraded] = await row(UPGRADED);
        await ql.update('sys_position', { id: upgraded.id, managed_by: 'admin', delegatable: true }, SYS);
        expect((await row(UPGRADED)).map((r) => [r.managed_by, r.delegatable])).toEqual([['admin', true]]);
        // Drifted display text, which only a system write can reach now.
        const [drifted] = await row(DRIFTED);
        await ql.update('sys_position', { id: drifted.id, label: 'Contributor (stale)' }, SYS);
        // An environment-authored position: a metadata-door save, whose row the
        // seeder writes at the next boot.
        const saved = await call('PUT', `/meta/position/${ENV_AUTHORED}`, { name: ENV_AUTHORED, label: 'Environment authored' });
        expect(saved.status, JSON.stringify(saved.json)).toBe(200);

        await stack!.stop();
        await start();

        expect((await row(EDITED)).map((r) => ({ label: r.label, managed_by: r.managed_by })))
            .toEqual([{ label: declaredLabel(EDITED), managed_by: 'package' }]);

        const [restamped] = await row(UPGRADED);
        expect({ managed_by: restamped.managed_by, delegatable: restamped.delegatable, label: restamped.label })
            .toEqual({ managed_by: 'package', delegatable: true, label: declaredLabel(UPGRADED) });
        const refused = await call('PATCH', `/data/sys_position/${restamped.id}`, { label: 'Executive (edited in Setup)' });
        expect({ status: refused.status, code: refused.code }, JSON.stringify(refused.json))
            .toEqual({ status: 403, code: 'PERMISSION_DENIED' });

        expect((await row(DRIFTED)).map((r) => r.label)).toEqual([declaredLabel(DRIFTED)]);
    });

    it('controls after the cold boot: administrator- and environment-authored positions keep unmanaged, editable rows', async () => {
        expect((await row(ADMIN_AUTHORED)).map((r) => [r.label, r.managed_by])).toEqual([['Admin authored (edited)', 'admin']]);
        const [env] = await row(ENV_AUTHORED);
        expect(env?.managed_by, 'the seeder wrote the environment definition\'s row').toBe('admin');
        const edited = await call('PATCH', `/data/sys_position/${env.id}`, { label: 'Environment authored (edited)' });
        expect(edited.status, JSON.stringify(edited.json)).toBe(200);
    });
});
