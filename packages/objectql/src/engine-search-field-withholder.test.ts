// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#34700] A `search` resolves only over fields a guard of the object's own
 * lets the caller query (`ObjectQL#registerSearchFieldWithholder`).
 *
 * plugin-audit's parent-field query guard (#21154) runs as a middleware after
 * the expansion and refuses a reader withheld any parent field a predicate over
 * the audit log's snapshot columns. The server put those columns in the
 * auto-default search set, so the auditor's whole audit-log search answered
 * 403. The #25672 narrowing asked only the security service, which does not
 * carry that guard. A withholder registered for the object is now asked too,
 * and what it names leaves the server-resolved set.
 *
 * Pinned beside the narrowing, so a fix that over-reaches goes red here too: a
 * field the caller NAMES in `searchFields` is never withheld; a context-less
 * read and a blank term ask nothing; a withholder of another object is not
 * asked; a set withheld down to nothing is the #24284 refusal, not every row;
 * and a throw propagates.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ObjectQL } from './engine.js';
import type { SearchFieldWithholdingRequest } from './engine.js';

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

describe('[#34700] search resolves only over the fields a registered withholder lets the caller query', () => {
    let engine: ObjectQL;
    let seen: ReturnType<typeof makeDriver>['seen'];
    let asked: SearchFieldWithholdingRequest[];
    let withhold: string[];

    beforeEach(async () => {
        const made = makeDriver();
        seen = made.seen;
        engine = new ObjectQL();
        engine.registerDriver(made.driver, true);
        await engine.init();
        const registry = engine.registry as any;
        // The audit-log shape: the auto-default set holds the guarded columns.
        registry.registerObject({
            name: 'app_ledger',
            fields: { action: { type: 'text' }, old_value: { type: 'textarea' }, new_value: { type: 'textarea' }, object_name: { type: 'text' } },
            searchableFields: ['action', 'old_value', 'new_value'],
        }, 'test');
        registry.registerObject({
            name: 'app_snapshot_only',
            searchableFields: ['old_value'],
            fields: { old_value: { type: 'textarea' }, label: { type: 'text' } },
        }, 'test');
        registry.registerObject({ name: 'app_other', fields: { title: { type: 'text' } } }, 'test');
        asked = [];
        withhold = ['old_value', 'new_value'];
        const withholder = async (request: SearchFieldWithholdingRequest) => {
            asked.push(request);
            return withhold.filter((f) => request.searchFields.includes(f));
        };
        engine.registerSearchFieldWithholder('app_ledger', withholder);
        engine.registerSearchFieldWithholder('app_snapshot_only', withholder);
    });

    const lastWhere = () => seen[seen.length - 1]?.where;

    it.each([
        ['find', (e: ObjectQL) => e.find('app_ledger', { where: { object_name: 'crm_deal' }, search: 'ann', context: MEMBER as any })],
        ['findOne', (e: ObjectQL) => e.findOne('app_ledger', { where: { object_name: 'crm_deal' }, search: 'ann', context: MEMBER as any })],
        ['count', (e: ObjectQL) => e.count('app_ledger', { where: { object_name: 'crm_deal' }, search: 'ann', context: MEMBER as any })],
    ] as const)('%s searches only the fields the withholder leaves, asked with the caller where, context and resolved set', async (_verb, run) => {
        await run(engine);
        expect([...fieldsOf(lastWhere())].sort()).toEqual(['action', 'object_name']);
        expect(asked).toHaveLength(1);
        expect(asked[0]).toMatchObject({
            object: 'app_ledger',
            where: { object_name: 'crm_deal' },
            context: expect.objectContaining(MEMBER),
            searchFields: ['action', 'old_value', 'new_value'],
        });
    });

    it('a field the caller names in searchFields is never withheld', async () => {
        await engine.find('app_ledger', { search: 'ann', searchFields: ['action', 'old_value'], context: MEMBER as any });
        expect([...fieldsOf(lastWhere())].sort()).toEqual(['action', 'old_value']);
    });

    it('a withholder that withholds nothing leaves the set whole', async () => {
        withhold = [];
        await engine.find('app_ledger', { search: 'ann', context: MEMBER as any });
        expect([...fieldsOf(lastWhere())].sort()).toEqual(['action', 'new_value', 'old_value']);
    });

    it('a context-less read and a blank term ask nothing and narrow nothing', async () => {
        await engine.find('app_ledger', { search: 'ann' });
        expect([...fieldsOf(lastWhere())].sort()).toEqual(['action', 'new_value', 'old_value']);
        await engine.find('app_ledger', { search: '   ', context: MEMBER as any });
        expect(asked).toEqual([]);
    });

    it('a withholder registered for another object is not asked', async () => {
        await engine.find('app_other', { search: 'ann', context: MEMBER as any });
        expect(asked).toEqual([]);
        expect([...fieldsOf(lastWhere())]).toEqual(['title']);
    });

    it('a set withheld down to nothing is the #24284 refusal, naming the caller, not every row', async () => {
        const err: any = await engine.find('app_snapshot_only', { search: 'ann', context: MEMBER as any }).catch((e) => e);
        expect(err?.code).toBe('INVALID_FIELD');
        expect(err?.status).toBe(400);
        expect(String(err?.message)).toContain('no field this caller may search');
        expect(seen.filter((s) => s.object === 'app_snapshot_only')).toEqual([]);
    });

    it('a throw from a withholder propagates', async () => {
        engine.registerSearchFieldWithholder('app_other', async () => { throw new Error('withholder fault'); });
        await expect(engine.find('app_other', { search: 'ann', context: MEMBER as any })).rejects.toThrow('withholder fault');
    });
});
