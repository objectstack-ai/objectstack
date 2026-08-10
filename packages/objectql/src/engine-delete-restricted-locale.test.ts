// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #7307 — the CALL SITE of the `DELETE_RESTRICTED` copy, with a REAL
 * {@link ObjectQL} engine + stub driver.
 *
 * The refusal itself was never in doubt: `cascadeDeleteRelations` correctly
 * declines the delete with `409 DELETE_RESTRICTED` and the transport ships it
 * intact. What reached the end user was the problem. REST puts `error.message`
 * verbatim into the flat 409 envelope (`mapDataError`) and Console renders that
 * as-is in a toast, so an operator deleting a 部门 in a fully Chinese app read
 * an English sentence naming two tables and a column — ending in
 * `set deleteBehavior:'cascade' on …`, a metadata-authoring instruction they
 * cannot act on.
 *
 * These tests assert the SPLIT: `message` is the user's half (their locale,
 * labels, no developer vocabulary) and `developerMessage` is the developer's
 * half (English, API names, the remedy) — and the structured fields the wire
 * contract is built on are byte-identical to before.
 *
 * The catalog half is pinned in
 * `packages/spec/src/system/operation-message.test.ts`.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { ObjectQL } from './engine.js';

/** The reporter's shape: a business unit referenced by a REQUIRED lookup. */
const businessUnit = {
    name: 'sys_business_unit',
    label: 'Business Unit',
    fields: {
        id: { name: 'id', type: 'text' as const, primaryKey: true },
        name: { name: 'name', type: 'text' as const },
    },
};
const sporadicApplication = {
    name: 'os_ehr_sporadic_application',
    label: 'Sporadic Application',
    fields: {
        id: { name: 'id', type: 'text' as const, primaryKey: true },
        title: { name: 'title', type: 'text' as const },
        apply_dept: {
            name: 'apply_dept', type: 'lookup' as const, reference: 'sys_business_unit',
            label: 'Applying Department', required: true,
        },
    },
};
/** An EXPLICIT restrict on a NULLABLE FK — the other sentence variant. */
const archiveNote = {
    name: 'os_ehr_archive_note',
    label: 'Archive Note',
    fields: {
        id: { name: 'id', type: 'text' as const, primaryKey: true },
        body: { name: 'body', type: 'text' as const },
        dept: {
            name: 'dept', type: 'lookup' as const, reference: 'sys_business_unit',
            label: 'Department', deleteBehavior: 'restrict',
        },
    },
};

/** Every API name that must never appear in a message a business user reads. */
const API_NAMES = ['sys_business_unit', 'os_ehr_sporadic_application', 'apply_dept'];

function makeStubDriver() {
    const stores = new Map<string, Map<string, Record<string, unknown>>>();
    const storeFor = (o: string) => { let s = stores.get(o); if (!s) { s = new Map(); stores.set(o, s); } return s; };
    let nextId = 0;
    const matches = (row: Record<string, unknown>, where: any): boolean => {
        if (!where || typeof where !== 'object') return true;
        for (const [k, v] of Object.entries(where)) {
            if (k.startsWith('$')) continue;
            const exp = (v && typeof v === 'object' && '$eq' in (v as any)) ? (v as any).$eq : v;
            if ((row[k] ?? null) !== (exp ?? null)) return false;
        }
        return true;
    };
    const driver: any = {
        name: 'memory', version: '0.0.0', supports: {},
        async connect() {}, async disconnect() {}, async checkHealth() { return true; }, async execute() { return null; },
        async find(o: string, ast: any) { return Array.from(storeFor(o).values()).filter((r) => matches(r, ast?.where)); },
        async findOne(o: string, ast: any) { for (const r of storeFor(o).values()) if (matches(r, ast?.where)) return r; return null; },
        async create(o: string, data: Record<string, unknown>) {
            nextId += 1; const id = (data.id as string) ?? `r_${nextId}`; const row = { ...data, id }; storeFor(o).set(id, row); return row;
        },
        async update(o: string, id: string, data: Record<string, unknown>) {
            const s = storeFor(o); const cur = s.get(id); if (!cur) throw new Error(`nf ${o}/${id}`);
            const up = { ...cur, ...data, id }; s.set(id, up); return up;
        },
        async upsert(o: string, data: Record<string, unknown>) { const id = data.id as string | undefined; return id && storeFor(o).has(id) ? this.update(o, id, data) : this.create(o, data); },
        async delete(o: string, id: string) { return storeFor(o).delete(id); },
        async count(o: string, ast: any) { return (await this.find(o, ast)).length; },
        async bulkCreate(o: string, rows: Record<string, unknown>[]) { return Promise.all(rows.map((r) => this.create(o, r))); },
        async bulkUpdate() { return []; }, async bulkDelete() {},
        async beginTransaction() { return { commit: async () => {}, rollback: async () => {} }; }, async commit() {}, async rollback() {},
    };
    return { driver };
}

/** The zh-CN bundle the reporter's deployment ships, as an `II18nService`. */
const ZH_BUNDLE: Record<string, string> = {
    'objects.sys_business_unit.label': '部门',
    'objects.os_ehr_sporadic_application.label': '零星申请',
    'objects.os_ehr_sporadic_application.fields.apply_dept.label': '申报部门',
};
// Locale-aware, like a real `II18nService`: a bundle it does not carry echoes
// the key back, which is the contract every resolver here detects a miss by.
const zhI18n = { t: (key: string, locale: string) => (locale?.startsWith('zh') ? ZH_BUNDLE[key] ?? key : key) };

async function makeEngine(i18n?: { t: (k: string, l: string) => string }) {
    const engine = new ObjectQL();
    const { driver } = makeStubDriver();
    engine.registerDriver(driver, true);
    await engine.init();
    for (const o of [businessUnit, sporadicApplication, archiveNote]) engine.registry.registerObject(o as any);
    if (i18n) engine.setI18nService(i18n);
    return engine;
}

/** Seed one parent + one required-FK child and return the refusal it throws. */
async function refuseDelete(engine: ObjectQL, locale?: string): Promise<any> {
    const bu = await engine.insert('sys_business_unit', { name: 'HR' });
    await engine.insert('os_ehr_sporadic_application', { title: '差旅', apply_dept: bu.id });
    try {
        await engine.delete('sys_business_unit', { where: { id: bu.id }, context: { locale } } as any);
    } catch (e) {
        return e;
    }
    throw new Error('expected the delete to be refused');
}

describe('#7307 DELETE_RESTRICTED — user copy vs developer guidance', () => {
    let engine: ObjectQL;

    describe('with no i18n service (the bare-kernel / programmatic caller)', () => {
        beforeEach(async () => { engine = await makeEngine(); });

        it('still refuses the delete: 409, DELETE_RESTRICTED, structured fields unchanged', async () => {
            const err = await refuseDelete(engine);
            expect(err).toMatchObject({
                code: 'DELETE_RESTRICTED',
                status: 409,
                object: 'sys_business_unit',
                dependentObject: 'os_ehr_sporadic_application',
                dependentCount: 1,
            });
        });

        it('names the objects by their DECLARED labels, never by API name', async () => {
            const err = await refuseDelete(engine);
            expect(err.message).toContain('Business Unit');
            expect(err.message).toContain('Sporadic Application');
            expect(err.message).toContain('Applying Department');
            for (const api of API_NAMES) expect(err.message).not.toContain(api);
        });

        it('does not hand the user a metadata-authoring instruction', async () => {
            const err = await refuseDelete(engine);
            expect(err.message).not.toMatch(/deleteBehavior|cascade/i);
            // The half that IS actionable for a user survives.
            expect(err.message).toMatch(/Delete or reassign them first/);
        });
    });

    describe('with a zh-CN deployment (the reported app)', () => {
        beforeEach(async () => { engine = await makeEngine(zhI18n); });

        it('renders the toast sentence in the caller locale, with TRANSLATED labels', async () => {
            const err = await refuseDelete(engine, 'zh-CN');
            expect(err.message).toBe(
                '该部门正被 1 条零星申请记录通过「申报部门」引用,且该字段为必填、无法清空,请先删除或改派这些记录。',
            );
        });

        it('leaks no API name and no developer vocabulary into the toast', async () => {
            const err = await refuseDelete(engine, 'zh-CN');
            for (const api of API_NAMES) expect(err.message).not.toContain(api);
            expect(err.message).not.toMatch(/deleteBehavior|cascade/i);
        });

        it('an i18n service that THROWS still yields a 409, not a 500, and still no leak', async () => {
            const boom = await makeEngine({ t: () => { throw new Error('i18n down'); } });
            const err = await refuseDelete(boom, 'zh-CN');
            expect(err).toMatchObject({ code: 'DELETE_RESTRICTED', status: 409 });
            expect(err.message).not.toMatch(/deleteBehavior/i);
        });

        it('an unresolved locale falls back to English rather than to the API names', async () => {
            const err = await refuseDelete(engine, 'fr-FR');
            expect(err.message).toContain('Business Unit');
            for (const api of API_NAMES) expect(err.message).not.toContain(api);
        });
    });

    describe('developerMessage — the guidance is moved, not lost', () => {
        beforeEach(async () => { engine = await makeEngine(zhI18n); });

        it('carries the API names and the deleteBehavior remedy, in English, even for a zh-CN caller', async () => {
            const err = await refuseDelete(engine, 'zh-CN');
            expect(err.developerMessage).toContain('sys_business_unit');
            expect(err.developerMessage).toContain('os_ehr_sporadic_application');
            expect(err.developerMessage).toContain('apply_dept');
            expect(err.developerMessage).toContain(
                "set deleteBehavior:'cascade' on os_ehr_sporadic_application.apply_dept",
            );
        });

        it('is the pre-#7307 sentence verbatim, so nothing a developer relied on changed wording', async () => {
            const err = await refuseDelete(engine, 'zh-CN');
            expect(err.developerMessage).toMatch(
                /^Cannot delete sys_business_unit \(.+\): 1 dependent os_ehr_sporadic_application record\(s\) reference it via apply_dept \(apply_dept is required, so it cannot be cleared\)\. Delete or reassign them first, or set deleteBehavior:'cascade' on os_ehr_sporadic_application\.apply_dept\.$/,
            );
        });

        it('is a SEPARATE field — the user-facing message never contains it', async () => {
            const err = await refuseDelete(engine, 'zh-CN');
            expect(err.message).not.toContain(err.developerMessage);
            expect(err.message).not.toBe(err.developerMessage);
        });

        it('reaches the SERVER LOG, so a zh-CN deployment does not log its operator half in Chinese', async () => {
            const logged: Array<Record<string, unknown>> = [];
            const original = (engine as any).logger.error.bind((engine as any).logger);
            (engine as any).logger.error = (msg: string, err: unknown, meta: Record<string, unknown>) => {
                logged.push(meta ?? {});
                return original(msg, err, meta);
            };
            await refuseDelete(engine, 'zh-CN');
            expect(logged.some((m) => typeof m.developerMessage === 'string'
                && (m.developerMessage as string).includes("deleteBehavior:'cascade'"))).toBe(true);
        });
    });

    describe('an EXPLICIT restrict on a nullable FK gets the other sentence', () => {
        beforeEach(async () => { engine = await makeEngine(zhI18n); });

        it('omits the "required, cannot be cleared" clause it has no right to claim', async () => {
            const bu = await engine.insert('sys_business_unit', { name: 'Finance' });
            await engine.insert('os_ehr_archive_note', { body: 'n', dept: bu.id });
            const err = await engine
                .delete('sys_business_unit', { where: { id: bu.id }, context: { locale: 'zh-CN' } } as any)
                .then(() => { throw new Error('expected refusal'); }, (e) => e);

            expect(err).toMatchObject({ code: 'DELETE_RESTRICTED', status: 409, dependentCount: 1 });
            expect(err.message).not.toContain('必填');
            expect(err.message).toContain('请先删除或改派这些记录');
            // No label on the child object's translation entries → declared label.
            expect(err.message).toContain('Archive Note');
            expect(err.developerMessage).not.toContain('is required, so it cannot be cleared');
        });
    });
});
