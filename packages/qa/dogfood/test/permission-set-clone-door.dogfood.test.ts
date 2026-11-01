// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// [ADR-0126 §7.1] The permission-set clone door on a REAL booted showcase:
// `POST /api/v1/security/permission-sets/:name/clone`, body `{ name, label }`.
//
// What only a boot can measure, and so what this file is for:
//
//   - the door is MOUNTED on the wire (a dispatcher arm nothing routes to
//     answers the transport's 404 while its unit test stays green — the flow
//     clone door's history);
//   - a `manage_metadata` holder clones a PACKAGED set by name, and the copy
//     resolves through the security catalog the resolver reads — the real
//     `saveMetaItem` takes the copy, so the real schema judged it;
//   - the keys the server drops (`adminScope`, `isDefault`) are absent from the
//     copy the catalog serves, while the permission facets came across;
//   - the copy GRANTS: a holder of it resolves its object grants;
//   - the source is read from the catalog, not from a `sys_permission_set` row:
//     the source's rows are removed first, and the clone still lands;
//   - a caller without `manage_metadata` is refused 403 and nothing is saved;
//   - [ADR-0146 D3/D6] "new similar": a copy of a PACKAGED set with no target
//     lands in the source package's paired `<X>.custom`, created by N-13's
//     ensure door on the first copy and reused on the next — the stored row
//     bound to the pair, the item itself naming no package — and is granted
//     through a position AND a direct assignment by its bare name; a given
//     target is judged (writable and in closure lands, read-only / unknown /
//     out-of-closure are refused with no row); an environment-authored source
//     still copies environment-wide.

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { resolveUserAuthzGrants, securityCatalogReaderOf } from '@objectstack/core';
import { type VerifyStack } from '@objectstack/verify';
import { bootShowcase } from './showcase-boot.js';

/** Infrastructure rows, not tenant data. */
const SYSTEM_CTX = { isSystem: true, positions: [], permissions: [] };

/** Showcase sets (`src/security/permission-sets.ts`): one carries `adminScope`, one `isDefault: true`. */
const DELEGATE_SET = 'showcase_field_ops_delegate';
const DEFAULT_SET = 'showcase_member_default';
const DELEGATE_COPY = 'my_field_ops_delegate';
const DEFAULT_COPY = 'my_member_default';
const MEMBER_EMAIL = 'clone.member@example.com';
const HOLDER_EMAIL = 'clone.holder@example.com';
const COPY_POSITION = 'clone_door_position';
/** The showcase's manifest id, and its paired customization package (ADR-0146 D3). */
const SHOWCASE = 'com.example.showcase';
const SHOWCASE_PAIR = `${SHOWCASE}.custom`;
/** A Studio-created writable package that declares the showcase, and one that declares nothing. */
const IN_CLOSURE = 'com.acme.clone-in-closure';
const OUT_OF_CLOSURE = 'com.acme.clone-out-of-closure';

interface Engine {
    find(object: string, options?: unknown): Promise<Array<Record<string, unknown>>>;
    insert(object: string, data: Record<string, unknown>, options?: unknown): Promise<unknown>;
    delete(object: string, options?: unknown): Promise<unknown>;
    getObject?(object: string): unknown;
}

/**
 * [C8 stage 8b] The organization a `single` session is active in: the Default
 * Organization, which an organization-less system insert of a grant or a
 * position is now stamped with (ADR-0131 D9). Resolving with no organization
 * would read the global arm only, which no fresh `single` install writes any more.
 */
const sessionOrgOf = async (s: VerifyStack): Promise<string | undefined> =>
    (await (await s.kernel.getServiceAsync<{ defaultOrgId(): Promise<string | null> }>('tenancy')).defaultOrgId()) ?? undefined;

describe('the permission-set clone door, on a booted showcase', () => {
    let stack: VerifyStack;
    let token: string;
    let ql: Engine;

    const clone = (as: string, source: string, body: unknown) =>
        stack.apiAs(as, 'POST', `/security/permission-sets/${source}/clone`, body);

    beforeAll(async () => {
        stack = await bootShowcase();
        token = await stack.signIn();
        ql = (await stack.kernel.getServiceAsync('objectql')) as unknown as Engine;
    }, 120_000);

    afterAll(async () => {
        await stack?.stop();
    });

    it('a manage_metadata holder clones a packaged set by name; the copy resolves through the catalog without the dropped keys', async () => {
        const reader = securityCatalogReaderOf(ql);
        expect(reader, 'no security catalog bound to the booted engine').toBeTruthy();
        // Anti-vacuity: the source is a PACKAGED set that really carries the
        // key the clone must drop.
        const source = await reader!.resolve('permission', DELEGATE_SET);
        expect(source?.packageId, 'the source is not packaged on this boot').toBeTruthy();
        expect(source?.definition.adminScope, 'the source carries no adminScope').toBeTruthy();

        // The door reads the catalog, and no row stands for the source: C3
        // stage 8 retired the `sys_permission_set` row object.
        expect(ql.getObject?.('sys_permission_set')).toBeFalsy();

        // Anti-vacuity for the landing: the source is the showcase's, and no
        // pair exists before the first copy.
        expect(source?.packageId).toBe(SHOWCASE);
        expect((await stack.apiAs(token, 'GET', `/packages/${SHOWCASE_PAIR}`)).status).toBe(404);

        const res = await clone(token, DELEGATE_SET, { name: DELEGATE_COPY, label: 'My Field Ops Delegate' });
        const text = await res.clone().text();
        expect(res.status, text).toBe(200);
        const data = JSON.parse(text).data as { permissionSet: Record<string, unknown>; package: string | null; notice: string };
        expect(data.permissionSet.name).toBe(DELEGATE_COPY);
        expect(data.permissionSet).not.toHaveProperty('adminScope');
        expect(data.permissionSet).not.toHaveProperty('packageId');
        expect(data.notice).toContain('adminScope');
        // [ADR-0146 D3/D6] The copy landed in the showcase's pair, which the
        // ensure door created for it.
        expect(data.package).toBe(SHOWCASE_PAIR);
        expect(data.notice).toContain(`'${SHOWCASE_PAIR}'`);
        const pair = await stack.apiAs(token, 'GET', `/packages/${SHOWCASE_PAIR}`);
        expect(pair.status, await pair.clone().text()).toBe(200);

        // The stored row is bound to the pair (its `package_id`), and the item
        // names no package of its own.
        const rows = await ql.find('sys_metadata', { where: { type: 'permission', name: DELEGATE_COPY }, context: SYSTEM_CTX });
        expect(rows.map((r) => r.package_id)).toEqual([SHOWCASE_PAIR]);
        expect(JSON.parse(String(rows[0].metadata))).not.toHaveProperty('packageId');

        const copy = await reader!.resolve('permission', DELEGATE_COPY);
        expect(copy?.name, 'the copy does not resolve through the catalog').toBe(DELEGATE_COPY);
        expect(copy?.packageId).toBe(SHOWCASE_PAIR);
        expect(copy?.definition).not.toHaveProperty('adminScope');
        expect(copy?.definition.label).toBe('My Field Ops Delegate');
        // The facets came across whole.
        expect(copy?.definition.objects).toEqual(source!.definition.objects);
    });

    it('`isDefault` is dropped too, and the copy grants its objects to a holder', async () => {
        const reader = securityCatalogReaderOf(ql)!;
        const source = await reader.resolve('permission', DEFAULT_SET);
        expect(source?.definition.isDefault, 'the source is not isDefault on this boot').toBe(true);

        const res = await clone(token, DEFAULT_SET, { name: DEFAULT_COPY, label: 'My Member Default' });
        expect(res.status, await res.clone().text()).toBe(200);
        // The second copy REUSES the pair the first created: one pair, the same id.
        expect(((await res.json()) as any).data.package).toBe(SHOWCASE_PAIR);
        const listed = ((await (await stack.apiAs(token, 'GET', '/packages')).json()) as any).data;
        const pairs = (Array.isArray(listed) ? listed : listed?.packages ?? [])
            .filter((p: any) => (p?.manifest?.id ?? p?.id) === SHOWCASE_PAIR);
        expect(pairs).toHaveLength(1);

        const copy = await reader.resolve('permission', DEFAULT_COPY);
        expect(copy?.name).toBe(DEFAULT_COPY);
        expect(copy?.packageId).toBe(SHOWCASE_PAIR);
        expect(copy?.definition.isDefault === undefined || copy?.definition.isDefault === false).toBe(true);
        expect(copy?.definition.objects).toEqual(source!.definition.objects);

        // The copy is a real set: a holder resolves it. Distributed through a
        // position saved by name, so the leg needs no catalog row id.
        const saved = await stack.apiAs(token, 'PUT', `/meta/position/${COPY_POSITION}`, {
            name: COPY_POSITION, label: 'Holds the clone', permissionSets: [DEFAULT_COPY],
        });
        expect(saved.status, await saved.clone().text()).toBe(200);
        await stack.signUp(HOLDER_EMAIL);
        const [user] = await ql.find('sys_user', { where: { email: HOLDER_EMAIL }, limit: 1, context: SYSTEM_CTX });
        expect(user?.id, `no sys_user row for ${HOLDER_EMAIL}`).toBeTruthy();
        await ql.insert(
            'sys_user_position',
            { id: 'usp_clone_door_holder', user_id: String(user.id), position: COPY_POSITION },
            { context: SYSTEM_CTX },
        );
        const grants = await resolveUserAuthzGrants(ql as never, String(user.id), { tenantId: await sessionOrgOf(stack) });
        expect(grants.positions).toContain(COPY_POSITION);
        expect(grants.permissions).toContain(DEFAULT_COPY);
    });

    it('a copy in the pair is granted through a direct assignment too, by its bare name', async () => {
        const email = 'clone.direct@example.com';
        await stack.signUp(email);
        const [user] = await ql.find('sys_user', { where: { email }, limit: 1, context: SYSTEM_CTX });
        expect(user?.id, `no sys_user row for ${email}`).toBeTruthy();
        const tenantId = await sessionOrgOf(stack);
        // Anti-vacuity: the user holds no copy before the assignment.
        const before = await resolveUserAuthzGrants(ql as never, String(user.id), { tenantId });
        expect(before.permissions).not.toContain(DELEGATE_COPY);
        await ql.insert(
            'sys_user_permission_set',
            { id: 'ups_clone_door_direct', user_id: String(user.id), permission_set: DELEGATE_COPY },
            { context: SYSTEM_CTX },
        );
        const after = await resolveUserAuthzGrants(ql as never, String(user.id), { tenantId });
        expect(after.permissions).toContain(DELEGATE_COPY);
    });

    it('a given writable target inside the closure lands there; read-only, unknown and out-of-closure targets are refused with no row', async () => {
        const reader = securityCatalogReaderOf(ql)!;
        for (const [id, namespace, dependencies] of [
            [IN_CLOSURE, 'clone_in', { [SHOWCASE]: '*' }],
            [OUT_OF_CLOSURE, 'clone_out', {}],
        ] as const) {
            const created = await stack.apiAs(token, 'POST', '/packages', {
                manifest: { id, name: id, version: '0.1.0', type: 'app', namespace, dependencies },
            });
            expect(created.status, await created.clone().text()).toBe(201);
        }

        const landed = await clone(token, DEFAULT_SET, { name: 'in_closure_copy', label: 'In Closure', package: IN_CLOSURE });
        expect(landed.status, await landed.clone().text()).toBe(200);
        expect(((await landed.json()) as any).data.package).toBe(IN_CLOSURE);
        expect((await reader.resolve('permission', 'in_closure_copy'))?.packageId).toBe(IN_CLOSURE);

        const refused: Array<[string, string, number, string]> = [
            ['read_only_copy', SHOWCASE, 422, 'WRITABLE_PACKAGE_REQUIRED'],
            ['unknown_copy', 'com.acme.no_such_package', 422, 'WRITABLE_PACKAGE_REQUIRED'],
            ['out_closure_copy', OUT_OF_CLOSURE, 409, 'RESOURCE_CONFLICT'],
        ];
        for (const [name, target, status, code] of refused) {
            const res = await clone(token, DEFAULT_SET, { name, label: 'X', package: target });
            const text = await res.clone().text();
            expect(res.status, `${target}: ${text}`).toBe(status);
            expect(((await res.json()) as any).error?.code, target).toBe(code);
            expect(await reader.resolve('permission', name), target).toBeUndefined();
            const rows = await ql.find('sys_metadata', { where: { type: 'permission', name }, context: SYSTEM_CTX });
            expect(rows, target).toEqual([]);
        }
    });

    it('a platform set (the lock-and-clone rule\'s commonest source) copies into its shipping package\'s pair', async () => {
        const reader = securityCatalogReaderOf(ql)!;
        const source = await reader.resolve('permission', 'member_default');
        expect(source?.packageId, 'member_default is not packaged on this boot').toBeTruthy();

        const res = await clone(token, 'member_default', { name: 'my_member_baseline', label: 'My Member Baseline' });
        const text = await res.clone().text();
        expect(res.status, text).toBe(200);
        const landed = ((await res.json()) as any).data.package;
        expect(landed).toBe(`${source!.packageId}.custom`);
        expect((await reader.resolve('permission', 'my_member_baseline'))?.packageId).toBe(landed);
    });

    it('CONTROL — an environment-authored source still copies environment-wide, with no package', async () => {
        const saved = await stack.apiAs(token, 'PUT', '/meta/permission/env_authored_source', {
            name: 'env_authored_source', label: 'Env Authored', objects: { showcase_task: { allowRead: true } },
        });
        expect(saved.status, await saved.clone().text()).toBe(200);
        const source = await securityCatalogReaderOf(ql)!.resolve('permission', 'env_authored_source');
        expect(source?.packageId, 'the control source is packaged').toBeUndefined();

        const res = await clone(token, 'env_authored_source', { name: 'env_authored_copy', label: 'Env Authored Copy' });
        expect(res.status, await res.clone().text()).toBe(200);
        expect(((await res.json()) as any).data.package).toBeNull();
        expect((await securityCatalogReaderOf(ql)!.resolve('permission', 'env_authored_copy'))?.packageId).toBeUndefined();
        const rows = await ql.find('sys_metadata', { where: { type: 'permission', name: 'env_authored_copy' }, context: SYSTEM_CTX });
        expect(rows.map((r) => r.package_id ?? null)).toEqual([null]);
    });

    it('a taken name is 409, an unknown source 404, a bad name 400', async () => {
        const taken = await clone(token, DEFAULT_SET, { name: DELEGATE_SET, label: 'X' });
        expect(taken.status, await taken.clone().text()).toBe(409);
        expect(((await taken.json()) as any).error?.code).toBe('RESOURCE_CONFLICT');

        const unknown = await clone(token, 'no_such_set', { name: 'no_such_copy', label: 'X' });
        expect(unknown.status).toBe(404);

        const badName = await clone(token, DEFAULT_SET, { name: 'Not Snake', label: 'X' });
        expect(badName.status).toBe(400);
    });

    // [#26571] access-security.security-catalog-activation-and-clone-doors
    // acceptance[3]'s arms that only the unit pin reached, now over HTTP.
    it('the source\'s OWN name is 409 too — the catalog already holds it', async () => {
        const res = await clone(token, DEFAULT_SET, { name: DEFAULT_SET, label: 'X' });
        expect(res.status, await res.clone().text()).toBe(409);
        expect(((await res.json()) as any).error?.code).toBe('RESOURCE_CONFLICT');
    });

    it('the body is closed and both keys are required — 400 VALIDATION_FAILED, and nothing is saved', async () => {
        for (const body of [
            { label: 'X' },
            { name: 'closed_body_copy' },
            { name: 'closed_body_copy', label: 'X', adminScope: {} },
        ]) {
            const res = await clone(token, DEFAULT_SET, body);
            expect(res.status, JSON.stringify(body)).toBe(400);
            expect(((await res.json()) as any).error?.code).toBe('VALIDATION_FAILED');
        }
        expect(await securityCatalogReaderOf(ql)!.resolve('permission', 'closed_body_copy')).toBeUndefined();
    });

    it('an anonymous caller is refused 401 at the floor, and nothing is saved', async () => {
        const res = await stack.api(`/security/permission-sets/${DEFAULT_SET}/clone`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: 'anon_copy', label: 'Anon Copy' }),
        });
        expect(res.status).toBe(401);
        expect(await securityCatalogReaderOf(ql)!.resolve('permission', 'anon_copy')).toBeUndefined();
    });

    it('a caller without manage_metadata is refused 403, and nothing is saved', async () => {
        const member = await stack.signUp(MEMBER_EMAIL);

        const res = await clone(member, DEFAULT_SET, { name: 'member_copy', label: 'Member Copy' });
        const body = await res.json() as { error?: { code?: string } };

        expect(res.status).toBe(403);
        expect(body.error?.code).toBe('PERMISSION_DENIED');
        expect(await securityCatalogReaderOf(ql)!.resolve('permission', 'member_copy')).toBeUndefined();
    });
});
