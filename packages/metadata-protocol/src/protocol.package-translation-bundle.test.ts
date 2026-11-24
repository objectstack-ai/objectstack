// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#33952] `getPackageTranslationBundle(packageId)` — one package's own share
 * of the deployment catalog, locale-keyed, for the translators'
 * `patchBundles`: the `translations` its installed package record carries,
 * then its own active `translation` rows over them (the order the i18n
 * service lays the shipped bundles and the authored layer). And
 * `getPackagedFieldPatchBases(name)`, the registry read it is paired with,
 * on its edges.
 *
 * The catalog the deployment serves cannot answer either: it deep-merges
 * every package's translations with the package ids dropped. The readings on
 * a real registry (what `registerApp` keeps on the record, which package
 * patches what) are pinned in `@objectstack/objectql`'s
 * `registry-field-patch-bases.test.ts`; this file pins the protocol's edges.
 */
import { describe, expect, it } from 'vitest';
import { assertEngineFindOnePredicate } from '@objectstack/metadata-core';
// The protocol module reaches a dynamic `import('@objectstack/lint')` (metadata diagnostics): pay its load at collection.
import '@objectstack/lint';
import { ObjectStackProtocolImplementation } from './protocol.js';

const DEP = 'com.customer.blackcat';
const OTHER = 'com.vendor.crm';

const translationRow = (id: string, packageId: string | null, data: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
    id, type: 'translation', name: id, package_id: packageId, organization_id: null, state: 'active',
    metadata: JSON.stringify({ name: id, ...data }), ...extra,
});

type Row = Record<string, unknown>;

/** Plain equality and `null`; any operator or combinator is refused. */
function matches(row: Row, where: Record<string, unknown> = {}): boolean {
    for (const [key, want] of Object.entries(where)) {
        if (want === undefined) continue;
        if (key.startsWith('$')) throw new Error(`stub engine: unsupported combinator ${key}`);
        if (want !== null && typeof want === 'object') throw new Error(`stub engine: unsupported operator on ${key}`);
        if ((row[key] ?? null) !== want) return false;
    }
    return true;
}

function protocolOver(rows: Row[], registry: Record<string, unknown>, opts: { failRead?: boolean } = {}) {
    const asked: Row[] = [];
    const read = async (table: string, q?: { where?: Record<string, unknown>; limit?: number }) => {
        const found = table === 'sys_metadata' ? rows.filter((r) => matches(r, q?.where)) : [];
        return typeof q?.limit === 'number' ? found.slice(0, q.limit) : found;
    };
    const engine = {
        registry,
        async find(table: string, q?: { where?: Record<string, unknown>; limit?: number }) {
            asked.push({ table, where: q?.where });
            if (opts.failRead) throw new Error('store unreachable');
            return read(table, q);
        },
        async findOne(table: string, q: { where: Record<string, unknown> }) {
            assertEngineFindOnePredicate(table, q);
            return (await read(table, q))[0] ?? null;
        },
    };
    return { protocol: new ObjectStackProtocolImplementation(engine as never, undefined, 'env_test'), asked };
}

/** A registry double holding one installed package record per id. */
const installed = (manifests: Record<string, unknown>) => ({
    getPackage: (id: string) => (manifests[id] === undefined ? undefined : { manifest: manifests[id] }),
});

describe('[#33952] getPackageTranslationBundle — one package\'s own translations', () => {
    it('lays its record\'s translations, list by list, then its own active rows over them; no other package\'s', async () => {
        const { protocol, asked } = protocolOver([
            translationRow('dep_zh', DEP, { locale: 'zh-CN', objects: { crm_account: { fields: { registration_number: { help: '统一社会信用代码（行）' } } } } }),
            translationRow('other_zh', OTHER, { locale: 'zh-CN', objects: { crm_account: { fields: { registration_number: { label: '注册号' } } } } }),
            translationRow('dep_draft', DEP, { locale: 'zh-CN', objects: { crm_account: { label: '草稿' } } }, { state: 'draft' }),
        ], installed({
            [DEP]: {
                id: DEP,
                translations: [
                    { 'zh-CN': { objects: { crm_account: { fields: { registration_number: { label: '税号', help: '统一社会信用代码' } } } } } },
                    { 'ja-JP': { objects: { crm_account: { fields: { registration_number: { label: '税番号' } } } } } },
                ],
            },
            [OTHER]: { id: OTHER, translations: [{ 'zh-CN': { objects: { crm_account: { label: '客户' } } } }] },
        }));
        expect(await protocol.getPackageTranslationBundle(DEP)).toEqual({
            'zh-CN': { objects: { crm_account: { fields: { registration_number: { label: '税号', help: '统一社会信用代码（行）' } } } } },
            'ja-JP': { objects: { crm_account: { fields: { registration_number: { label: '税番号' } } } } },
        });
        expect(asked.length).toBeGreaterThan(0);
        for (const q of asked) expect((q.where as Record<string, unknown>).package_id).toBe(DEP);
    });

    it('answers the record\'s translations alone when the row read fails, and undefined when the package carries neither', async () => {
        const record = installed({ [DEP]: { id: DEP, translations: [{ 'zh-CN': { objects: { crm_account: { label: '客户' } } } }] } });
        const failing = protocolOver([], record, { failRead: true });
        await expect(failing.protocol.getPackageTranslationBundle(DEP)).resolves.toEqual({ 'zh-CN': { objects: { crm_account: { label: '客户' } } } });
        const empty = protocolOver([], installed({ [DEP]: { id: DEP } }));
        await expect(empty.protocol.getPackageTranslationBundle(DEP)).resolves.toBeUndefined();
        const absent = protocolOver([], {});
        await expect(absent.protocol.getPackageTranslationBundle(DEP)).resolves.toBeUndefined();
    });

    it('answers undefined, reading nothing, for an empty id', async () => {
        for (const id of ['', undefined as unknown as string]) {
            const { protocol, asked } = protocolOver([translationRow('dep_zh', DEP, { locale: 'zh-CN', objects: {} })], {});
            expect(await protocol.getPackageTranslationBundle(id), String(id)).toBeUndefined();
            expect(asked, String(id)).toEqual([]);
        }
    });
});

describe('[#33952] getPackagedFieldPatchBases — the registry\'s read, feature-detected', () => {
    it('answers the registry\'s entries as they are', () => {
        const entries = [{ packageId: DEP, base: { name: 'crm_account', fields: {} } }];
        const { protocol } = protocolOver([], { getPackagedFieldPatchBases: (name: string) => (name === 'crm_account' ? entries : []) });
        expect(protocol.getPackagedFieldPatchBases('crm_account')).toBe(entries);
        expect(protocol.getPackagedFieldPatchBases('other')).toEqual([]);
    });

    it('answers [] for an empty name, a registry without the read, and a read that throws', () => {
        expect(protocolOver([], { getPackagedFieldPatchBases: () => [{ packageId: DEP, base: {} }] }).protocol.getPackagedFieldPatchBases('')).toEqual([]);
        expect(protocolOver([], {}).protocol.getPackagedFieldPatchBases('crm_account')).toEqual([]);
        expect(protocolOver([], { getPackagedFieldPatchBases: () => { throw new Error('boom'); } }).protocol.getPackagedFieldPatchBases('crm_account')).toEqual([]);
    });
});
