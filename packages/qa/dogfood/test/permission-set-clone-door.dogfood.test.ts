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
//   - a caller without `manage_metadata` is refused 403 and nothing is saved.

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

interface Engine {
    find(object: string, options?: unknown): Promise<Array<Record<string, unknown>>>;
    insert(object: string, data: Record<string, unknown>, options?: unknown): Promise<unknown>;
    delete(object: string, options?: unknown): Promise<unknown>;
}

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

        // The source's catalog ROWS are removed first: the door reads the
        // catalog, so the clone must land with no row to read.
        const rows = await ql.find('sys_permission_set', { where: { name: DELEGATE_SET }, context: SYSTEM_CTX });
        for (const row of rows) await ql.delete('sys_permission_set', { where: { id: row.id }, context: SYSTEM_CTX });
        expect(await ql.find('sys_permission_set', { where: { name: DELEGATE_SET }, context: SYSTEM_CTX })).toEqual([]);

        const res = await clone(token, DELEGATE_SET, { name: DELEGATE_COPY, label: 'My Field Ops Delegate' });
        const text = await res.clone().text();
        expect(res.status, text).toBe(200);
        const data = JSON.parse(text).data as { permissionSet: Record<string, unknown>; notice: string };
        expect(data.permissionSet.name).toBe(DELEGATE_COPY);
        expect(data.permissionSet).not.toHaveProperty('adminScope');
        expect(data.notice).toContain('adminScope');

        const copy = await reader!.resolve('permission', DELEGATE_COPY);
        expect(copy?.name, 'the copy does not resolve through the catalog').toBe(DELEGATE_COPY);
        expect(copy?.packageId).toBeUndefined();
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

        const copy = await reader.resolve('permission', DEFAULT_COPY);
        expect(copy?.name).toBe(DEFAULT_COPY);
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
        const grants = await resolveUserAuthzGrants(ql as never, String(user.id), {});
        expect(grants.positions).toContain(COPY_POSITION);
        expect(grants.permissions).toContain(DEFAULT_COPY);
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

    it('a caller without manage_metadata is refused 403, and nothing is saved', async () => {
        const member = await stack.signUp(MEMBER_EMAIL);

        const res = await clone(member, DEFAULT_SET, { name: 'member_copy', label: 'Member Copy' });
        const body = await res.json() as { error?: { code?: string } };

        expect(res.status).toBe(403);
        expect(body.error?.code).toBe('PERMISSION_DENIED');
        expect(await securityCatalogReaderOf(ql)!.resolve('permission', 'member_copy')).toBeUndefined();
    });
});
