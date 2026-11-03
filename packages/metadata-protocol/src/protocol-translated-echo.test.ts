// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29673] `restoreTranslatedEchoes` — the save door's inverse of the `/meta`
 * read's translation, as a pure function. The echo every case hands it is
 * built with the spec translator the read exits call, so a case can only pass
 * when the inverse matches what a read really serves.
 *
 * The door end to end (the real registry, the real protocol, the publish and
 * the stored-row repair) is pinned in `@objectstack/objectql`'s
 * `protocol-meta-effective-schema.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import { translateObject, type TranslationBundle } from '@objectstack/spec/system';
import { QUEUE_FIELD_DEF, OWNER_FIELD_DEF } from '@objectstack/spec/data';
import { restoreTranslatedEchoes, translatedEchoLocales } from './protocol-translated-echo.js';

const bundle: TranslationBundle = {
    'zh-CN': {
        objects: {
            crm_invoice: {
                label: '发票',
                fields: {
                    amount: { label: '金额' },
                    status: { label: '状态', options: { open: '打开', closed: '关闭' } },
                },
            },
        },
    },
} as unknown as TranslationBundle;

/** The source a stored row carries. */
const stored = () => ({
    name: 'crm_invoice',
    label: 'Invoice',
    sharingModel: 'private',
    fields: {
        amount: { type: 'currency', label: 'Amount' },
        status: { type: 'select', label: 'Status', options: [{ value: 'open', label: 'Open' }, { value: 'closed', label: 'Closed' }] },
    },
});

/** What a read serves in `locale`: the stored row plus the injected columns, translated. */
const read = (locale: string, b: TranslationBundle | undefined = bundle): any => {
    const doc: any = stored();
    doc.fields = { ...doc.fields, queue: { ...QUEUE_FIELD_DEF }, owner_id: { ...OWNER_FIELD_DEF } };
    return translateObject(doc, b, { locale });
};

describe('[#29673] restoreTranslatedEchoes', () => {
    it('a zh-CN echo is put back to the source on every slot the read translated', () => {
        const echo = read('zh-CN');
        // The precondition: the read really translated each slot.
        expect([echo.label, echo.fields.amount.label, echo.fields.status.options[0].label, echo.fields.queue.label, echo.fields.owner_id.label])
            .toEqual(['发票', '金额', '打开', '队列', '负责人']);
        const { item, restored } = restoreTranslatedEchoes(echo, { source: stored(), bundle });
        expect(item.label).toBe('Invoice');
        expect(item.fields.amount.label).toBe('Amount');
        expect(item.fields.status.label).toBe('Status');
        expect(item.fields.status.options.map((o: any) => o.label)).toEqual(['Open', 'Closed']);
        // The injected columns are the platform's own again, byte for byte: the strip that follows removes them.
        expect(item.fields.queue).toEqual(QUEUE_FIELD_DEF);
        expect(item.fields.owner_id).toEqual(OWNER_FIELD_DEF);
        expect(restored.map((r) => r.path).sort()).toEqual([
            'fields.amount.label', 'fields.owner_id.label', 'fields.queue.label',
            'fields.status.label', 'fields.status.options[closed].label', 'fields.status.options[open].label', 'label',
        ]);
    });

    it('a built-in locale with no bundle at all is recognised (the read translates injected columns without one)', () => {
        expect(translatedEchoLocales(undefined)).toEqual(expect.arrayContaining(['zh-CN', 'ja-JP', 'es-ES']));
        const echo = read('ja-JP', undefined);
        expect(echo.fields.queue.label).toBe('キュー');
        const { item } = restoreTranslatedEchoes(echo, { source: stored(), bundle: undefined });
        expect(item.fields.queue).toEqual(QUEUE_FIELD_DEF);
    });

    it('the author\'s own text is kept: an edit that is not a translation, a new field, an own owner_id label', () => {
        const echo = read('zh-CN');
        echo.fields.amount.label = 'Total';
        echo.fields.memo = { type: 'text', label: '备注' };
        echo.fields.owner_id = { ...OWNER_FIELD_DEF, label: 'Account Owner' };
        const source: any = stored();
        source.fields.owner_id = { ...OWNER_FIELD_DEF, label: 'Account Owner' };
        const { item } = restoreTranslatedEchoes(echo, { source, bundle });
        expect(item.fields.amount.label).toBe('Total');
        expect(item.fields.memo.label).toBe('备注');
        expect(item.fields.owner_id.label).toBe('Account Owner');
    });

    it('a row that already stored the echo is repaired against the platform\'s definition', () => {
        const echo = read('zh-CN');
        // The stored row IS the echo (a zh-CN session saved it before this door existed).
        const { item } = restoreTranslatedEchoes(echo, { source: echo, bundle });
        expect(item.fields.queue).toEqual(QUEUE_FIELD_DEF);
        expect(item.fields.owner_id).toEqual(OWNER_FIELD_DEF);
    });

    it('the array `fields` shape is restored in place, and an untranslated body comes back as the same reference', () => {
        const echo = read('zh-CN');
        const asArray = { ...echo, fields: Object.entries(echo.fields).map(([name, f]: [string, any]) => ({ name, ...f })) };
        const { item } = restoreTranslatedEchoes(asArray, { source: stored(), bundle });
        expect(item.fields.map((f: any) => f.name)).toEqual(asArray.fields.map((f: any) => f.name));
        expect(item.fields.find((f: any) => f.name === 'amount').label).toBe('Amount');

        const untouched = read('en');
        const same = restoreTranslatedEchoes(untouched, { source: stored(), bundle });
        expect(same.item).toBe(untouched);
        expect(same.restored).toEqual([]);
    });

    it('a packaged object\'s overlay slot that diverged from the packaged text is no translation\'s source: the catalog string an author types is kept', () => {
        // The packaged base ships `amount: Amount`; the catalog translates that
        // packaged text. The tenant's overlay renamed it `Total`, which the read
        // serves untranslated in every locale (ADR-0029 D9.2a).
        const packagedBase = stored();
        const overlay: any = stored();
        overlay.fields.amount = { ...overlay.fields.amount, label: 'Total' };
        // The precondition: the read, with the packaged base, serves `Total` in zh-CN.
        expect((translateObject(overlay, bundle, { locale: 'zh-CN', packagedBase }) as any).fields.amount.label).toBe('Total');

        const typed: any = stored();
        typed.fields.amount = { ...typed.fields.amount, label: '金额' };
        const kept = restoreTranslatedEchoes(typed, { source: overlay, bundle, packagedBase });
        expect(kept.item.fields.amount.label).toBe('金额');
        expect(kept.restored).toEqual([]);

        // Control: the same typed string over a slot that still equals the
        // packaged text IS the read's translation, and is put back.
        const echoed = restoreTranslatedEchoes(typed, { source: packagedBase, bundle, packagedBase });
        expect(echoed.item.fields.amount.label).toBe('Amount');
    });
});
