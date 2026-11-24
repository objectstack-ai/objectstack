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
import { ProtocolDiscoveryAndBasesFacet } from './protocol-discovery-and-bases.js';

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

    it('a self-lookup\'s translated relatedListTitle is put back to its source like every other field slot the read writes', () => {
        const selfBundle = {
            'zh-CN': { objects: { clm_contract: { fields: { renewed_from: { relatedListTitle: '续签合同' } } } } },
        } as unknown as TranslationBundle;
        const source = () => ({
            name: 'clm_contract',
            label: 'Contract',
            fields: {
                renewed_from: { type: 'lookup', label: 'Renewed From', reference: 'clm_contract', relatedListTitle: 'Renewals' },
            },
        });
        const echo: any = translateObject(source(), selfBundle, { locale: 'zh-CN' });
        // The precondition: the read really translated the slot.
        expect(echo.fields.renewed_from.relatedListTitle).toBe('续签合同');
        const { item, restored } = restoreTranslatedEchoes(echo, { source: source(), bundle: selfBundle });
        expect((item as any).fields.renewed_from.relatedListTitle).toBe('Renewals');
        expect(restored.map((r) => r.path)).toEqual(['fields.renewed_from.relatedListTitle']);
    });
});

describe('[#33952] restoreTranslatedEchoes with the read\'s patchBundles', () => {
    const catalog = { 'zh-CN': { objects: { crm_account: { fields: { name: { label: '名称' }, registration_number: { label: '注册号' } } } } } } as unknown as TranslationBundle;
    const packagedBase = {
        name: 'crm_account',
        fields: { name: { type: 'text', label: 'Name' }, registration_number: { type: 'text', label: 'Registration No.' } },
    };
    const patchedBase = { ...packagedBase, fields: { ...packagedBase.fields, registration_number: { type: 'text', label: 'Tax ID' } } };
    const patchBundles = [{
        patchedBase,
        bundle: { 'zh-CN': { objects: { crm_account: { fields: { registration_number: { label: '税号' } } } } } } as unknown as TranslationBundle,
    }];
    const body = (name: string, reg: string) => ({ name: 'crm_account', fields: { name: { type: 'text', label: name }, registration_number: { type: 'text', label: reg } } });

    it('the patching package\'s translation of a patched slot is put back to the patch text, with or without a stored row carrying it', () => {
        for (const source of [body('Name', 'Tax ID'), packagedBase]) {
            const { item, restored } = restoreTranslatedEchoes(body('名称', '税号'), { source, bundle: catalog, packagedBase, patchBundles }) as any;
            expect([item.fields.name.label, item.fields.registration_number.label]).toEqual(['Name', 'Tax ID']);
            expect(restored.map((r: any) => r.path)).toContain('fields.registration_number.label');
        }
    });

    it('a field the patch left as packaged is no patch source: a tenant\'s rename typed as the catalog string is kept', () => {
        // The stored row renamed `name` to `Customer`; the read serves that untranslated, so `名称` is the author's.
        const { item } = restoreTranslatedEchoes(body('名称', 'Tax ID'), { source: body('Customer', 'Tax ID'), bundle: catalog, packagedBase, patchBundles }) as any;
        expect(item.fields.name.label).toBe('名称');
    });

    it('without patchBundles the patched slot\'s translation is no echo (the read before #33952 never served it)', () => {
        const { item } = restoreTranslatedEchoes(body('Name', '税号'), { source: body('Name', 'Tax ID'), bundle: catalog, packagedBase }) as any;
        expect(item.fields.registration_number.label).toBe('税号');
    });
});

describe('[#34836] a patch entry answers a slot its patch changed, and only where the stored row has no text of its own there', () => {
    const catalog = {
        'zh-CN': { objects: { crm_account: { fields: { name: { label: '名称' }, registration_number: { label: '注册号', help: '注册号说明' } } } } },
    } as unknown as TranslationBundle;
    const regField = { type: 'text', label: 'Registration No.', description: 'Registration number' };
    const packagedBase = { name: 'crm_account', fields: { name: { type: 'text', label: 'Name' }, registration_number: regField } };
    // The patch changes the label only; the description stays the packaged text.
    const patchedBase = { ...packagedBase, fields: { ...packagedBase.fields, registration_number: { ...regField, label: 'Tax ID' } } };
    const patchBundles = [{
        patchedBase,
        bundle: { 'zh-CN': { objects: { crm_account: { fields: { registration_number: { label: '税号' } } } } } } as unknown as TranslationBundle,
    }];
    const row = (reg: Record<string, unknown>) => ({ name: 'crm_account', fields: { name: { type: 'text', label: 'Name' }, registration_number: { type: 'text', ...reg } } });
    const read = (doc: unknown, locale: string) =>
        structuredClone(translateObject(doc as any, catalog, { locale, packagedBase, patchBundles } as any)) as any;

    it('a stored `税号` typed over the patched slot survives a whole-body save in another locale with an unrelated edit', () => {
        const source = row({ label: '税号', description: 'Registration number' });
        const echo = read(source, 'en');
        // The precondition: the read serves the tenant's text as written.
        expect(echo.fields.registration_number.label).toBe('税号');
        echo.fields.name.label = 'Account Name';
        const { item, restored } = restoreTranslatedEchoes(echo, { source, bundle: catalog, packagedBase, patchBundles }) as any;
        expect(item.fields.registration_number.label).toBe('税号');
        expect(item.fields.name.label).toBe('Account Name');
        expect(restored).toEqual([]);
    });

    it('the catalog\'s translation of a packaged slot the patch left alone, typed over a tenant\'s rename, is the author\'s', () => {
        const source = row({ label: 'Tax ID', description: 'Our own note' });
        const echo = read(source, 'zh-CN');
        expect(echo.fields.registration_number.description).toBe('Our own note');
        echo.fields.registration_number.description = '注册号说明';
        const { item } = restoreTranslatedEchoes(echo, { source, bundle: catalog, packagedBase, patchBundles }) as any;
        expect(item.fields.registration_number.description).toBe('注册号说明');
    });

    it('a stored empty string on the patched slot is no text of its own: the patch text the fold serves over it is put back', () => {
        // The fold applies the patch over `''` (scalarOverridesPackagedBase is false for it), so the read serves `Tax ID`.
        const source = row({ label: '', description: 'Registration number' });
        const echo = read(row({ label: 'Tax ID', description: 'Registration number' }), 'zh-CN');
        expect(echo.fields.registration_number.label).toBe('税号');
        const { item } = restoreTranslatedEchoes(echo, { source, bundle: catalog, packagedBase, patchBundles }) as any;
        expect(item.fields.registration_number.label).toBe('Tax ID');
    });

    it('a slot the patch left alone is no patch source even where the stored row does not declare the field', () => {
        const source = { name: 'crm_account', fields: { name: { type: 'text', label: 'Name' } } };
        const { item, restored } = restoreTranslatedEchoes(row({ label: 'Tax ID', description: '注册号说明' }), { source, bundle: catalog, packagedBase, patchBundles }) as any;
        expect(item.fields.registration_number.description).toBe('注册号说明');
        expect(restored).toEqual([]);
    });
});

/**
 * What a CODE extender brings, over a stored row saved before the extending
 * package was installed: the fold serves the extender's added field and the
 * entry its `place` splices into `relatedLists`, translated against the
 * packaged base, and the stored row carries no copy of either. The packaged
 * base is the last source for them, told from the owner's own declaration.
 */
describe('a code extender\'s placed title or added field, over a stored row that predates it', () => {
    const catalog = {
        'zh-CN': {
            objects: {
                crm_lead: {
                    fields: { name: { label: '名称' }, cb_market: { label: '市场' } },
                    _relatedLists: { crm_task: { label: '任务' }, acme_audit: { label: '审计' } },
                },
            },
        },
    } as unknown as TranslationBundle;
    const owner = () => ({
        name: 'crm_lead',
        label: 'Lead',
        fields: { name: { type: 'text', label: 'Name' } } as Record<string, unknown>,
        relatedLists: [{ list: 'crm_task', label: 'Tasks' }, 'crm_note'] as unknown[],
    });
    /** The packaged base: the owner, the extender's added field and its placed tab. */
    const packagedBase = () => ({
        ...owner(),
        fields: { ...owner().fields, cb_market: { type: 'text', label: 'Market' } },
        relatedLists: [{ list: 'crm_task', label: 'Tasks' }, { list: 'acme_audit', label: 'Audit trail' }, 'crm_note'],
    });
    /** The stored overlay row, saved before the extender: it declares `relatedLists` without the placed entry. */
    const storedRow = () => ({ ...owner(), label: 'Prospect' });
    /** The `/meta` read in zh-CN: the fold over the stored row, translated against the packaged base. */
    const zhRead = (): any => {
        const served = { ...storedRow(), fields: packagedBase().fields, relatedLists: packagedBase().relatedLists };
        return structuredClone(translateObject(served as any, catalog, { locale: 'zh-CN', packagedBase: packagedBase() } as any));
    };
    const labelOf = (body: any, list: string) => body.relatedLists.find((e: any) => typeof e === 'object' && e.list === list)?.label;

    it('the read does translate both: the case is real, not a no-op', () => {
        const echo = zhRead();
        expect(labelOf(echo, 'acme_audit')).toBe('审计');
        expect(echo.fields.cb_market.label).toBe('市场');
    });

    it('a zh-CN save of the folded read keeps the placed title and the added field\'s label as their source', () => {
        const { item, restored } = restoreTranslatedEchoes(zhRead(), {
            source: storedRow(), bundle: catalog, packagedBase: packagedBase(), packagedOwner: owner(),
        }) as any;
        expect(labelOf(item, 'acme_audit')).toBe('Audit trail');
        expect(item.fields.cb_market.label).toBe('Market');
        expect(restored.map((r: any) => r.path).sort()).toEqual([
            'fields.cb_market.label', 'fields.name.label', 'relatedLists[acme_audit].label', 'relatedLists[crm_task].label',
        ]);
        // The stored row's own text is what it was: the object label diverged, so the read served it as written.
        expect(item.label).toBe('Prospect');
    });

    it('a placed entry the stored row declares is the stored row\'s to explain: a tenant\'s rename, typed over as the catalog string, is kept', () => {
        const source: any = storedRow();
        source.relatedLists = [...source.relatedLists, { list: 'acme_audit', label: 'Audit log' }];
        const body = zhRead();
        expect(labelOf(body, 'acme_audit')).toBe('审计');
        const { item } = restoreTranslatedEchoes(body, { source, bundle: catalog, packagedBase: packagedBase(), packagedOwner: owner() }) as any;
        expect(labelOf(item, 'acme_audit')).toBe('审计');
    });

    it('an entry or field the OWNER declares and the stored row dropped is no extender\'s: the body\'s text is kept', () => {
        const source: any = { ...storedRow(), fields: {}, relatedLists: ['crm_note'] };
        const body = zhRead();
        const { item } = restoreTranslatedEchoes(body, { source, bundle: catalog, packagedBase: packagedBase(), packagedOwner: owner() }) as any;
        expect(labelOf(item, 'crm_task')).toBe('任务');
        expect(item.fields.name.label).toBe('名称');
        // …while the extender's own still come back as their source.
        expect(labelOf(item, 'acme_audit')).toBe('Audit trail');
        expect(item.fields.cb_market.label).toBe('Market');
    });

    it('the save door hands the restore the packaged owner: a non-source-locale save over the stored row lacking the entry keeps the source title', async () => {
        const host = {
            engine: { registry: { getPackagedObjectOwner: (name: string) => (name === 'crm_lead' ? { definition: owner() } : undefined) } },
            getPackagedObjectBase: (name: string) => (name === 'crm_lead' ? packagedBase() : undefined),
            getPackagedFieldPatchBases: () => [],
            getPackageTranslationBundle: async () => undefined,
            registeredTranslationBundle: () => catalog,
        };
        const repo = { headAt: async () => ({ head: { body: storedRow() }, packageId: null }) };
        const { item, restored } = await ProtocolDiscoveryAndBasesFacet.restoreTranslatedObjectEchoes(
            host as any,
            { type: 'object', name: 'crm_lead', item: zhRead() } as any,
            repo as any,
            { type: 'object', name: 'crm_lead', org: 'env' } as any,
            'publish',
        ) as any;
        expect(labelOf(item, 'acme_audit')).toBe('Audit trail');
        expect(item.fields.cb_market.label).toBe('Market');
        expect(restored.map((r: any) => r.path)).toEqual(expect.arrayContaining(['relatedLists[acme_audit].label', 'fields.cb_market.label']));
    });
});
