// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [ADR-0150 D8 rows R1, R3, R5, R6, R13] The security and sharing stored
// references gain a package column beside the name, backfilled at boot from
// the one package that holds the name.
//
// ## What only a boot can measure
//
// The plugin suites pin the row rules on a real SQL engine with a stand-in
// holder set (one holder, two holders, none). What they cannot pin is that a
// real boot runs both backfills after the holder seal, against the showcase's
// real registry, and that no reader moves onto the new columns. So, on the SQL
// driver across restarts of one database file:
//
//  - the boot's own rows: the platform's bootstrap grants name the security
//    plugin's package, and the showcase's audience-binding suggestion names
//    the showcase package, on the first boot;
//  - rows written with no package (a grant of a showcase set, a managed
//    sharing-rule row of a showcase rule) name the showcase package after the
//    next boot; an organization's own rule, a queue member and a cursor naming
//    nothing a package holds stay null;
//  - CONTROL: the administrator's resolved permissions answer byte-identically
//    with the column null, filled, and forged to a package that holds nothing
//    — no reader reads it. Since #32164 (F3) the engine refuses to write that
//    forged value for every writer, a system column-only bind included, so the
//    forge is asserted refused there and then written below the engine, as a
//    raw write or an earlier release could leave it;
//  - a further boot moves no row it bound (a forged value stays forged: a row
//    that names a package is never a candidate) and rewrites nothing.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type VerifyStack } from '@objectstack/verify';
import { bootShowcase } from './showcase-boot.js';

/** Infrastructure rows, not tenant data: written and read the way the platform's passes do. */
const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] };
const SHOWCASE_DIR = fileURLToPath(new URL('../../../../examples/app-showcase/', import.meta.url));

const SHOWCASE = 'com.example.showcase';
const SECURITY = 'com.objectstack.plugin-security';
/** A showcase permission set the administrator does not hold at boot. */
const SHOWCASE_SET = 'showcase_auditor';
/** The showcase's `isDefault` set, which the boot suggests binding to everyone. */
const SUGGESTED_SET = 'showcase_member_default';
/** A sharing rule the showcase declares. */
const SHOWCASE_RULE = 'showcase_share_new_inquiries_with_field_ops';
/** A name no package declares, of any type. */
const NOBODY = 'qa_s2_nothing_declares_this';
/** A package id that holds nothing. */
const FORGED = 'com.qa.holds-nothing';

interface Engine {
    find(object: string, options?: unknown): Promise<Array<Record<string, unknown>>>;
    insert(object: string, data: unknown, options?: unknown): Promise<Record<string, unknown>>;
    update(object: string, data: unknown, options?: unknown): Promise<unknown>;
    getDriverForObject(object: string): unknown;
}

/** The SQL driver's own query builder, for a write that must not pass the engine's hooks. */
type Knex = (table: string) => { whereIn(column: string, values: unknown[]): { update(data: Record<string, unknown>): Promise<number> } };

describe('security and sharing references name the package that holds them (SQL driver, one database file)', () => {
    let stack: VerifyStack | undefined;
    let prevCwd: string;
    let dir: string;
    let dbFile: string;
    let admin: { userId: string; organizationId: string };
    let permissionsAtFirstBoot: string;
    let bootGrantPackages: Record<string, unknown>;
    let suggestionPackage: unknown;

    const engine = async () => (await stack!.kernel.getServiceAsync('objectql')) as unknown as Engine;
    const rowsOf = async (object: string, where: Record<string, unknown>) => (await engine()).find(object, { where, context: SYSTEM_CTX });
    const restart = async () => {
        await stack?.stop();
        stack = await bootShowcase({ databaseFile: dbFile });
    };
    /** The administrator's resolved permissions, as the door serves them. */
    const adminPermissions = async (): Promise<string> => {
        const token = await stack!.signIn();
        const res = await stack!.apiAs(token, 'GET', '/auth/me/permissions');
        expect(res.status).toBe(200);
        return JSON.stringify(await res.json());
    };

    beforeAll(async () => {
        prevCwd = process.cwd();
        process.chdir(SHOWCASE_DIR);
        dir = mkdtempSync(join(tmpdir(), 'dogfood-31683-'));
        dbFile = join(dir, 'showcase.db');
        stack = await bootShowcase({ databaseFile: dbFile });

        // What the first boot bound by itself.
        const grants = await rowsOf('sys_user_permission_set', {});
        bootGrantPackages = Object.fromEntries(grants.map((g) => [String(g.permission_set), g.permission_set_package ?? null]));
        const full = grants.find((g) => g.permission_set === 'admin_full_access');
        admin = { userId: String(full?.user_id), organizationId: String(full?.organization_id) };
        suggestionPackage = (await rowsOf('sys_audience_binding_suggestion', { permission_set_name: SUGGESTED_SET }))[0]?.permission_set_package ?? null;

        // Rows as a release before the package column could leave them: no package.
        const ql = await engine();
        const inOrg = { ...SYSTEM_CTX, tenantId: admin.organizationId };
        await ql.insert('sys_user_permission_set', {
            user_id: admin.userId, permission_set: SHOWCASE_SET, organization_id: admin.organizationId,
        }, { context: inOrg });
        const rule = (name: string, managedBy: string) => ({
            name, label: name, object_name: 'showcase_account', criteria_json: '{"status":"active"}',
            recipient_type: 'user', recipient_id: admin.userId, access_level: 'read', active: false,
            managed_by: managedBy, organization_id: admin.organizationId,
        });
        await ql.insert('sys_sharing_rule', rule(SHOWCASE_RULE, 'package'), { context: inOrg });
        await ql.insert('sys_sharing_rule', rule(`${SHOWCASE_RULE}_admin_copy`, 'admin'), { context: inOrg });
        await ql.insert('sys_queue_member', {
            queue: NOBODY, recipient_type: 'position', recipient_id: 'showcase_ops', organization_id: admin.organizationId,
        }, { context: inOrg });
        await ql.insert('sys_assignment_cursor', {
            rule: NOBODY, entry: 'first', version: 0, organization_id: admin.organizationId,
        }, { context: inOrg });

        permissionsAtFirstBoot = await adminPermissions();
        await restart();
    }, 480_000);

    afterAll(async () => {
        await stack?.stop();
        if (prevCwd) process.chdir(prevCwd);
        if (dir) rmSync(dir, { recursive: true, force: true });
    });

    it('the first boot binds its own rows: the bootstrap grants name the security plugin, the suggestion names the showcase', () => {
        expect(bootGrantPackages).toEqual({ admin_full_access: SECURITY, organization_admin_no_bypass: SECURITY });
        expect(suggestionPackage).toBe(SHOWCASE);
    });

    it('R1: a grant written with no package names the showcase package after the next boot', async () => {
        const rows = await rowsOf('sys_user_permission_set', { permission_set: SHOWCASE_SET });
        expect(rows).toHaveLength(1);
        expect(rows[0].permission_set_package).toBe(SHOWCASE);
    });

    it('R5: a managed rule row names the showcase package; an organization\'s own rule stays null', async () => {
        const managed = await rowsOf('sys_sharing_rule', { name: SHOWCASE_RULE });
        const own = await rowsOf('sys_sharing_rule', { name: `${SHOWCASE_RULE}_admin_copy` });
        expect(managed[0]?.package_id).toBe(SHOWCASE);
        expect(own[0]?.package_id ?? null).toBeNull();
    });

    it('R6, R13: a queue member and a cursor naming nothing a package holds stay null', async () => {
        expect((await rowsOf('sys_queue_member', { queue: NOBODY }))[0]?.queue_package ?? null).toBeNull();
        expect((await rowsOf('sys_assignment_cursor', { rule: NOBODY }))[0]?.rule_package ?? null).toBeNull();
    });

    it('CONTROL: the administrator\'s permissions answer byte-identically with the column null and filled', async () => {
        expect(await adminPermissions()).toBe(permissionsAtFirstBoot);
    });

    it('CONTROL: forged to a package that holds nothing, the column changes no answer, and a further boot neither moves it nor rewrites a bound row', async () => {
        const ql = await engine();
        const before = (await rowsOf('sys_user_permission_set', { permission_set: SHOWCASE_SET }))[0];
        const others = (await rowsOf('sys_user_permission_set', { user_id: admin.userId }))
            .filter((g) => g.permission_set !== SHOWCASE_SET);
        expect(others.length).toBeGreaterThan(0);
        // [#32164 F3] The engine refuses the forge: a named package that does not
        // hold the set is `409 RESOURCE_CONFLICT`, `not-held-by-qualifier`, for a
        // system column-only bind too, and the row is left as it was.
        for (const g of others) {
            const refused = await ql
                .update('sys_user_permission_set', { id: g.id, permission_set_package: FORGED }, { context: SYSTEM_CTX })
                .then(() => undefined, (e: unknown) => e as { code?: string; refusal?: { status?: string; reason?: string } });
            expect([refused?.code, refused?.refusal?.status, refused?.refusal?.reason], String(g.permission_set))
                .toEqual(['RESOURCE_CONFLICT', 'refused', 'not-held-by-qualifier']);
        }
        const unchanged = (await rowsOf('sys_user_permission_set', { user_id: admin.userId }))
            .filter((g) => g.permission_set !== SHOWCASE_SET);
        expect(unchanged.map((g) => g.permission_set_package)).toEqual(others.map((g) => g.permission_set_package));
        // So the forged value is written below the engine, straight through the driver.
        const knex = (ql.getDriverForObject('sys_user_permission_set') as { knex: Knex }).knex;
        expect(await knex('sys_user_permission_set').whereIn('id', others.map((g) => g.id)).update({ permission_set_package: FORGED }))
            .toBe(others.length);
        await restart();

        expect(await adminPermissions()).toBe(permissionsAtFirstBoot);
        const forged = (await rowsOf('sys_user_permission_set', { user_id: admin.userId }))
            .filter((g) => g.permission_set !== SHOWCASE_SET)
            .map((g) => g.permission_set_package);
        expect(forged.length).toBeGreaterThan(0);
        expect(new Set(forged)).toEqual(new Set([FORGED]));
        const after = (await rowsOf('sys_user_permission_set', { permission_set: SHOWCASE_SET }))[0];
        expect(after.permission_set_package).toBe(SHOWCASE);
        expect(after.updated_at).toEqual(before.updated_at);
    }, 240_000);
});

describe('the memory driver binds the boot\'s own grants too (its null filter matches a column never written)', () => {
    let stack: VerifyStack | undefined;

    beforeAll(async () => {
        stack = await bootShowcase({ databaseDriver: 'memory' });
    }, 180_000);

    afterAll(async () => {
        await stack?.stop();
    });

    // Grants only: on this driver the boot's suggestion sync writes no row at
    // all (the driver refuses an organization-scoped write), which is not this
    // backfill's to change.
    it('the bootstrap grants name the security plugin', async () => {
        const ql = (await stack!.kernel.getServiceAsync('objectql')) as unknown as Engine;
        const grants = await ql.find('sys_user_permission_set', { where: {}, context: SYSTEM_CTX });
        expect(Object.fromEntries(grants.map((g) => [String(g.permission_set), g.permission_set_package ?? null])))
            .toEqual({ admin_full_access: SECURITY, organization_admin_no_bypass: SECURITY });
    });
});
