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
import { ObjectStackProtocolImplementation } from './protocol.js';

const BASE = 'com.acme.crm';
const PAIR = 'com.acme.crm.custom';

const translationRow = (id: string, packageId: string | null, data: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
    id, type: 'translation', name: id, package_id: packageId, organization_id: null, state: 'active',
    metadata: JSON.stringify({ name: id, ...data }), ...extra,
});

function protocolOver(rows: Record<string, unknown>[], opts: { failRead?: boolean } = {}) {
    const asked: Record<string, unknown>[] = [];
    const matches = (row: Record<string, unknown>, where: Record<string, unknown>) =>
        Object.entries(where ?? {}).every(([k, v]) => (row[k] ?? null) === (v ?? null));
    const engine = {
        registry: {},
        async find(table: string, q: { where: Record<string, unknown> }) {
            asked.push({ table, where: q.where });
            if (opts.failRead) throw new Error('store unreachable');
            return table === 'sys_metadata' ? rows.filter((r) => matches(r, q.where)) : [];
        },
        async findOne() { return null; },
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
