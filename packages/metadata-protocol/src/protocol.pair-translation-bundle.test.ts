// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#30062, ADR-0146 D2/D3] `getPairTranslationBundle(base)`: the translations
 * a base's paired `.custom` package ships itself, locale-keyed, for the
 * translators' `pairBundle` (the first rank of ruling record 6631250894's
 * label order).
 *
 * The deployment catalog cannot answer this: the i18n service deep-merges
 * every code bundle and every authored `translation` row with the package ids
 * dropped. So the bundle is read from the pair's own active `translation` rows
 * by their binding, each read into its locale's data the way the i18n
 * service's authored layer reads it (`readAuthoredTranslationLayer`).
 *
 * The readings on a real boot (the row saved through the door, the served
 * override, the translator's answer) are pinned in `@objectstack/objectql`'s
 * `protocol-custom-override-bare-slot-envelope.test.ts`; this file pins the
 * edges a real boot does not reach.
 */
import { describe, expect, it } from 'vitest';
import { assertEngineFindOnePredicate } from '@objectstack/metadata-core';
import { ObjectStackProtocolImplementation } from './protocol.js';

const BASE = 'com.acme.crm';
const PAIR = 'com.acme.crm.custom';

const translationRow = (id: string, packageId: string | null, data: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
    id, type: 'translation', name: id, package_id: packageId, organization_id: null, state: 'active',
    metadata: JSON.stringify({ name: id, ...data }), ...extra,
});

type Row = Record<string, unknown>;

/** Plain equality and `null`; any operator or combinator is refused, so a matcher that ignored one cannot prove anything. */
function matches(row: Row, where: Record<string, unknown> = {}): boolean {
    for (const [key, want] of Object.entries(where)) {
        if (want === undefined) continue;
        if (key.startsWith('$')) throw new Error(`stub engine: unsupported combinator ${key}`);
        if (want !== null && typeof want === 'object') throw new Error(`stub engine: unsupported operator on ${key}`);
        if ((row[key] ?? null) !== want) return false;
    }
    return true;
}

function protocolOver(rows: Row[], opts: { failRead?: boolean } = {}) {
    const asked: Row[] = [];
    const read = async (table: string, q?: { where?: Record<string, unknown>; limit?: number }) => {
        const found = table === 'sys_metadata' ? rows.filter((r) => matches(r, q?.where)) : [];
        // The caller's bound, after the filter, by presence — as the engine applies it.
        return typeof q?.limit === 'number' ? found.slice(0, q.limit) : found;
    };
    const engine = {
        registry: {},
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

describe('[#30062] getPairTranslationBundle — the pair\'s own translations, by their binding', () => {
    it('answers the pair\'s active translation rows, locale-keyed, and no other package\'s', async () => {
        const { protocol, asked } = protocolOver([
            translationRow('pair_zh', PAIR, { locale: 'zh-CN', pages: { crm_welcome: { label: '新欢迎页' } } }),
            translationRow('pair_ja', PAIR, { locale: 'ja-JP', apps: { crm: { label: '顧客' } } }),
            translationRow('base_zh', BASE, { locale: 'zh-CN', pages: { crm_welcome: { label: '欢迎页' } } }),
            translationRow('loose_zh', null, { locale: 'zh-CN', pages: { crm_welcome: { label: '散行' } } }),
            translationRow('pair_draft', PAIR, { locale: 'zh-CN', pages: { crm_welcome: { label: '草稿' } } }, { state: 'draft' }),
        ]);
        expect(await protocol.getPairTranslationBundle(BASE)).toEqual({
            'zh-CN': { pages: { crm_welcome: { label: '新欢迎页' } } },
            'ja-JP': { apps: { crm: { label: '顧客' } } },
        });
        // Every read names the pair's binding.
        expect(asked.length).toBeGreaterThan(0);
        for (const q of asked) expect((q.where as Record<string, unknown>).package_id).toBe(PAIR);
    });

    it('strips the bookkeeping the publish stamps on a row, as the i18n service\'s layer does', async () => {
        const { protocol } = protocolOver([
            translationRow('pair_zh', PAIR, { locale: 'zh-CN', _packageId: PAIR, _provenance: 'org', pages: { p: { label: '页' } } }),
        ]);
        expect(await protocol.getPairTranslationBundle(BASE)).toEqual({ 'zh-CN': { pages: { p: { label: '页' } } } });
    });

    it('answers undefined for a pair that stores no translation', async () => {
        const { protocol } = protocolOver([translationRow('base_zh', BASE, { locale: 'zh-CN', pages: { p: { label: '页' } } })]);
        expect(await protocol.getPairTranslationBundle(BASE)).toBeUndefined();
    });

    it('answers undefined, reading nothing, for an id that has no pair', async () => {
        for (const id of [PAIR, '', 'Not An Id', undefined as unknown as string]) {
            const { protocol, asked } = protocolOver([translationRow('pair_zh', PAIR, { locale: 'zh-CN', pages: {} })]);
            expect(await protocol.getPairTranslationBundle(id), String(id)).toBeUndefined();
            expect(asked, String(id)).toEqual([]);
        }
    });

    it('answers undefined, never a throw, when the row read fails', async () => {
        const { protocol, asked } = protocolOver([], { failRead: true });
        await expect(protocol.getPairTranslationBundle(BASE)).resolves.toBeUndefined();
        expect(asked.length).toBeGreaterThan(0);
    });
});
