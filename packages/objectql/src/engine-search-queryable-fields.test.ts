// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#25672] A `search` resolves only over fields the caller may QUERY.
 *
 * The field-read predicate guard (plugin-security) runs after the expansion and
 * judges the expanded `$or` as the caller's own predicate, so one hidden column
 * in the server-resolved set refused the whole search with 403: `sys_user`
 * searches `role` / `ban_reason` / `last_login_ip`, and every user picker broke
 * for members. The engine now asks the registered `security` service's
 * `getQueryableFields` (the complement of what that guard refuses) and
 * withholds the rest from the RESOLVED set.
 *
 * Pinned beside the narrowing, so a fix that over-reaches goes red here too: a
 * field the caller NAMES in `searchFields` is never withheld (the guard refuses
 * it loudly); a context-less read, an absent service and an `undefined` answer
 * narrow nothing; a declaration whose fields are all hidden does not fall
 * through to the auto-default; and a set withheld down to nothing is the
 * #24284 refusal, not every row.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ObjectQL, SECURITY_SERVICE_SOURCE_SLOT } from './engine.js';

type Row = Record<string, unknown>;

const MEMBER = { userId: 'u_member', organizationId: 'org_1' };

function makeDriver() {
    const seen: Array<{ verb: string; object: string; where: unknown }> = [];
    const record = (verb: string) => async (object: string, ast: any) => {
        seen.push({ verb, object, where: ast?.where });
        return verb === 'count' ? 0 : verb === 'findOne' ? null : [];
    };
    const driver: any = {
        name: 'mem', version: '0.0.0', supports: {},
        async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
        find: record('find'),
        findOne: record('findOne'),
        count: record('count'),
        async create(_o: string, d: any) { return d; },
        async update(_o: string, _id: string, d: any) { return d; },
        async delete() { return true; },
        async bulkCreate(_o: string, r: any[]) { return r; },
        async bulkUpdate() { return []; }, async bulkDelete() {},
        async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; },
        async commit() {}, async rollback() {},
    };
    return { driver, seen };
}

/** Every field name a filter tree mentions as a key. */
function fieldsOf(where: unknown, out: Set<string> = new Set()): Set<string> {
    if (Array.isArray(where)) { for (const w of where) fieldsOf(w, out); return out; }
    if (!where || typeof where !== 'object') return out;
    for (const [k, v] of Object.entries(where as Row)) {
        if (k.startsWith('$')) fieldsOf(v, out);
        else out.add(k);
    }
    return out;
}

describe('[#25672] search resolves only over the fields the caller may query', () => {
    let engine: ObjectQL;
    let seen: ReturnType<typeof makeDriver>['seen'];
    let asked: Array<{ object: string; context: unknown }>;
    let queryable: Record<string, string[] | undefined>;

    const wire = (svc: unknown) => {
        (engine as unknown as Record<symbol, unknown>)[SECURITY_SERVICE_SOURCE_SLOT] = () => svc;
    };

    beforeEach(async () => {
        const made = makeDriver();
        seen = made.seen;
        engine = new ObjectQL();
        engine.registerDriver(made.driver, true);
        await engine.init();
        const registry = engine.registry as any;
        // The `sys_user` shape: a declared search set holding admin-only columns.
        registry.registerObject({
            name: 'app_person',
            nameField: 'name',
            searchableFields: ['name', 'email', 'role', 'ban_reason'],
            fields: {
                name: { type: 'text' },
                email: { type: 'email' },
                role: { type: 'text' },
                ban_reason: { type: 'text' },
            },
        }, 'test');
        // A second shape: the auto-default set, one textual column hidden.
        registry.registerObject({
            name: 'app_ticket',
            fields: { subject: { type: 'text' }, private_note: { type: 'textarea' } },
        }, 'test');
        // Every declared search field hidden from the member.
        registry.registerObject({
            name: 'app_secret',
            searchableFields: ['code'],
            fields: { code: { type: 'text' }, label: { type: 'text' } },
        }, 'test');
        asked = [];
        queryable = {
            app_person: ['id', 'name', 'email'],
            app_ticket: ['id', 'subject'],
            app_secret: ['id', 'label'],
        };
        wire({
            async getQueryableFields(object: string, context: unknown) {
                asked.push({ object, context });
                return queryable[object];
            },
        });
    });

    const lastWhere = () => seen[seen.length - 1]?.where;

    it.each([
        ['find', (e: ObjectQL) => e.find('app_person', { search: 'ann', context: MEMBER as any })],
        ['findOne', (e: ObjectQL) => e.findOne('app_person', { search: 'ann', context: MEMBER as any })],
        ['count', (e: ObjectQL) => e.count('app_person', { search: 'ann', context: MEMBER as any })],
    ] as const)('%s searches only the queryable declared fields, asked with the caller context', async (_verb, run) => {
        await run(engine);
        expect([...fieldsOf(lastWhere())].sort()).toEqual(['email', 'name']);
        expect(asked).toEqual([{ object: 'app_person', context: expect.objectContaining(MEMBER) }]);
    });

    it('aggregate searches the same narrowed set', async () => {
        const where: unknown[] = [];
        (engine as any).getDriver('app_person').aggregate = async (_o: string, ast: any) => { where.push(ast?.where); return []; };
        await engine.aggregate('app_person', {
            search: 'ann', groupBy: ['name'], aggregations: [{ function: 'count', alias: 'n' }], context: MEMBER as any,
        }).catch(() => undefined);
        const named = new Set([...where, lastWhere()].flatMap((w) => [...fieldsOf(w)]));
        expect(named.has('role')).toBe(false);
        expect(named.has('ban_reason')).toBe(false);
        expect(named.has('name')).toBe(true);
    });

    it('is general: an auto-default set loses its hidden column on another object', async () => {
        await engine.find('app_ticket', { search: 'printer', context: MEMBER as any });
        expect([...fieldsOf(lastWhere())]).toEqual(['subject']);
    });

    it('a field the caller NAMES in searchFields is not withheld — the guard judges it', async () => {
        await engine.find('app_person', { search: 'spam', searchFields: ['name', 'ban_reason'], context: MEMBER as any });
        expect([...fieldsOf(lastWhere())].sort()).toEqual(['ban_reason', 'name']);
    });

    it('a caller who may query every field gets the full declared set', async () => {
        queryable.app_person = ['id', 'name', 'email', 'role', 'ban_reason'];
        await engine.find('app_person', { search: 'ann', context: { userId: 'u_admin' } as any });
        expect([...fieldsOf(lastWhere())].sort()).toEqual(['ban_reason', 'email', 'name', 'role']);
    });

    it('narrows nothing without an answer: no context, no service, no method, or undefined', async () => {
        const full = ['ban_reason', 'email', 'name', 'role'];
        await engine.find('app_person', { search: 'ann' });
        expect([...fieldsOf(lastWhere())].sort()).toEqual(full);
        expect(asked).toEqual([]);

        queryable.app_person = undefined;
        await engine.find('app_person', { search: 'ann', context: MEMBER as any });
        expect([...fieldsOf(lastWhere())].sort()).toEqual(full);

        wire({});
        await engine.find('app_person', { search: 'ann', context: MEMBER as any });
        expect([...fieldsOf(lastWhere())].sort()).toEqual(full);

        (engine as unknown as Record<symbol, unknown>)[SECURITY_SERVICE_SOURCE_SLOT] = () => { throw new Error('not registered'); };
        await engine.find('app_person', { search: 'ann', context: MEMBER as any });
        expect([...fieldsOf(lastWhere())].sort()).toEqual(full);
    });

    it('a blank term asks nothing and adds no predicate', async () => {
        await engine.find('app_person', { search: '   ', context: MEMBER as any });
        expect(asked).toEqual([]);
        expect(lastWhere()).toBeUndefined();
    });

    it('a declared set withheld to nothing is the #24284 refusal, never every row nor the auto-default', async () => {
        const err: any = await engine.find('app_secret', { search: 'x', context: MEMBER as any }).then(() => null, (e) => e);
        expect(err).toMatchObject({ code: 'INVALID_FIELD', status: 400, object: 'app_secret', param: 'search' });
        expect(String(err.message)).toMatch(/^Object 'app_secret' has no field this caller may search/);
        expect(seen.filter((s) => s.object === 'app_secret')).toEqual([]);
    });
});
