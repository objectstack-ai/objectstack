// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0146 D10 · ADR-0029 D9.2a] A published object extension's
 * `fieldPatches` label survives the served `/meta` exit.
 *
 * The registry folds the patch onto every read of the base object
 * (`registry-extension-field-patches.test.ts` pins that), but that pin reads
 * registry bodies directly and never runs the localization this package
 * applies on the way out. Measured on the booted showcase before the fix: the
 * read naming no package, the read naming the base and the type's list all
 * served the shipped field `label` and option label, because the catalog's
 * entries (`objects.<object>.fields.<field>.label` / `.options.<value>`) were
 * written over the folded body unconditionally; only the untranslated
 * `/layers` showed the patch, and a patched `description` was served, since
 * that slot already compared against the packaged field.
 *
 * So this pin runs the exit itself — {@link translateMetaDocument} (the item
 * read) and {@link translateMetaList} (the list) — over a REAL
 * `SchemaRegistry` carrying an owner and a patching extender, with the
 * packaged base read the way the protocol reads it
 * (`getPackagedObjectBase`, the owner's declaration before the fold). The
 * rule itself is spec's (`i18n-resolver.test.ts`); what only this layer can
 * show is that the folded body and the pre-fold base both reach it.
 */

import { describe, it, expect } from 'vitest';
// The read gate loads `@objectstack/spec/ui` with a dynamic import; pay that load at collection.
import '@objectstack/spec/ui';
import { SchemaRegistry } from '@objectstack/objectql';
import { translateMetaDocument, translateMetaList, type MetaListTranslationSources } from './meta-item-read-gate.js';

const OWNER_PKG = 'com.example.showcase';
const EXT_PKG = 'com.example.showcase.custom';
const OBJ = 'showcase_task';

function owner(): any {
    return {
        name: OBJ,
        label: 'Task',
        fields: {
            title: { name: 'title', type: 'text', label: 'Title', description: 'What the task is.' },
            status: {
                name: 'status',
                type: 'select',
                label: 'Status',
                options: [
                    { value: 'todo', label: 'To Do' },
                    { value: 'done', label: 'Done' },
                ],
            },
        },
    };
}

/** The extension's patch, the shape the dev report measured on the showcase. */
const PATCH = {
    title: { label: 'Headline', description: 'Patched description' },
    status: { options: { todo: { label: 'Queued' } } },
};

/** `en` repeats the packaged strings (what `i18n:extract` writes); `zh-CN` translates them. */
const BUNDLE: Record<string, any> = {
    en: {
        objects: {
            [OBJ]: {
                label: 'Task',
                fields: {
                    title: { label: 'Title' },
                    status: { label: 'Status', options: { todo: 'To Do', done: 'Done' } },
                },
            },
        },
    },
    'zh-CN': {
        objects: {
            [OBJ]: {
                label: '任务',
                fields: {
                    title: { label: '标题' },
                    status: { label: '状态', options: { todo: '待办', done: '已完成' } },
                },
            },
        },
    },
};

const i18nService = {
    getLocales: () => ['en', 'zh-CN'],
    getTranslations: (locale: string) => BUNDLE[locale],
    getDefaultLocale: () => 'en',
};

function registry(withPatch: boolean): SchemaRegistry {
    const reg = new SchemaRegistry({ multiTenant: false, searchCompanion: false } as never);
    reg.logLevel = 'silent';
    reg.registerObject(owner(), OWNER_PKG, undefined, 'own');
    if (withPatch) reg.registerObject({ name: OBJ, fieldPatches: PATCH } as any, EXT_PKG, undefined, 'extend', 200);
    return reg;
}

/** The transport's sources, with the protocol's packaged-base accessor over the registry. */
function sources(reg: SchemaRegistry, locale: string): MetaListTranslationSources {
    const protocol = { getPackagedObjectBase: (name: string) => reg.getPackagedObjectBase(name) };
    return {
        resolveI18nService: async () => i18nService,
        resolveProtocol: async () => protocol,
        requestLocale: () => locale,
    };
}

/** The served (folded) body, as the protocol's reads hand it to the exit. */
const served = (reg: SchemaRegistry) => structuredClone(reg.getObject(OBJ)) as any;

const titleOf = (doc: any) => doc.fields.title;
const todoOf = (doc: any) => doc.fields.status.options.find((o: any) => o.value === 'todo');
const doneOf = (doc: any) => doc.fields.status.options.find((o: any) => o.value === 'done');

describe('a published fieldPatches label survives the served /meta exit', () => {
    it('the registry folds the patch, and the packaged base is the pre-fold owner', () => {
        // The premise of every case below, read off the same registry: if
        // either half moved, the cases would pass or fail for another reason.
        const reg = registry(true);
        expect(titleOf(served(reg)).label).toBe('Headline');
        expect(todoOf(served(reg)).label).toBe('Queued');
        const base: any = reg.getPackagedObjectBase(OBJ);
        expect(base.fields.title.label).toBe('Title');
        expect(base.fields.status.options[0].label).toBe('To Do');
    });

    for (const locale of ['zh-CN', 'en']) {
        it(`the item read serves the patched field and option labels (${locale})`, async () => {
            const reg = registry(true);
            const out: any = await translateMetaDocument(sources(reg, locale), 'object', served(reg));
            expect(titleOf(out).label).toBe('Headline');
            expect(titleOf(out).description).toBe('Patched description');
            expect(todoOf(out).label).toBe('Queued');
        });

        it(`the list read serves them too (${locale})`, async () => {
            const reg = registry(true);
            const out: any = await translateMetaList(sources(reg, locale), 'object', [served(reg)]);
            expect(titleOf(out[0]).label).toBe('Headline');
            expect(todoOf(out[0]).label).toBe('Queued');
        });
    }

    it('the slots the patch leaves alone are still translated', async () => {
        const reg = registry(true);
        const out: any = await translateMetaDocument(sources(reg, 'zh-CN'), 'object', served(reg));
        expect(out.label).toBe('任务');
        expect(out.fields.status.label).toBe('状态');
        expect(doneOf(out).label).toBe('已完成');
    });

    it('with no extension, the shipped labels are translated as before', async () => {
        const reg = registry(false);
        const out: any = await translateMetaDocument(sources(reg, 'zh-CN'), 'object', served(reg));
        expect(titleOf(out).label).toBe('标题');
        expect(todoOf(out).label).toBe('待办');
    });
});

describe('a field a dependent package adds through objectExtensions is translated from its own pack rows', () => {
    // The dependent ships `cb_market` (a select) on the base's object and the
    // zh-CN rows for it; the deployment catalog deep-merges every package's
    // rows, so they sit beside the owner's. Measured before the fix: the item
    // and list reads served `Market` / `Domestic` / `Export` under zh-CN,
    // because the packaged base (the owner alone) did not declare the field
    // and every slot of it counted as authored after the fact.
    const DEP_PKG = 'com.example.carbon';
    const MARKET = {
        name: 'cb_market',
        type: 'select',
        label: 'Market',
        options: [
            { value: 'domestic', label: 'Domestic' },
            { value: 'export', label: 'Export' },
        ],
    };
    const DEP_ROWS: Record<string, any> = {
        en: { cb_market: { label: 'Market', options: { domestic: 'Domestic', export: 'Export' } } },
        'zh-CN': {
            cb_market: { label: '市场', options: { domestic: '内销', export: '出口' } },
            tenant_note: { label: '备注' },
        },
    };
    const merged: Record<string, any> = structuredClone(BUNDLE);
    for (const locale of Object.keys(DEP_ROWS)) Object.assign(merged[locale].objects[OBJ].fields, DEP_ROWS[locale]);
    const mergedI18n = { ...i18nService, getTranslations: (locale: string) => merged[locale] };

    function withDependent(extensionFields: Record<string, unknown> = { cb_market: MARKET }): SchemaRegistry {
        const reg = registry(false);
        reg.registerObject({ name: OBJ, fields: extensionFields } as any, DEP_PKG, undefined, 'extend', 200);
        return reg;
    }

    function mergedSources(reg: SchemaRegistry, locale: string): MetaListTranslationSources {
        return { ...sources(reg, locale), resolveI18nService: async () => mergedI18n };
    }

    const marketOf = (doc: any) => doc.fields.cb_market;

    it('the item read serves the added field\'s label and option labels translated (zh-CN)', async () => {
        const reg = withDependent();
        const out: any = await translateMetaDocument(mergedSources(reg, 'zh-CN'), 'object', served(reg));
        expect(marketOf(out).label).toBe('市场');
        expect(marketOf(out).options.map((o: any) => o.label)).toEqual(['内销', '出口']);
    });

    it('the list read serves them translated too (zh-CN), and the source text in en', async () => {
        const reg = withDependent();
        const zh: any = await translateMetaList(mergedSources(reg, 'zh-CN'), 'object', [served(reg)]);
        expect(marketOf(zh[0]).label).toBe('市场');
        expect(marketOf(zh[0]).options.map((o: any) => o.label)).toEqual(['内销', '出口']);
        const en: any = await translateMetaList(mergedSources(reg, 'en'), 'object', [served(reg)]);
        expect(marketOf(en[0]).label).toBe('Market');
    });

    it('the base package\'s own fields are translated as before', async () => {
        const reg = withDependent();
        const out: any = await translateMetaDocument(mergedSources(reg, 'zh-CN'), 'object', served(reg));
        expect(out.label).toBe('任务');
        expect(titleOf(out).label).toBe('标题');
        expect(out.fields.status.options.map((o: any) => o.label)).toEqual(['待办', '已完成']);
    });

    it('a dependent that redeclares an OWNER field keeps its label: the owner stays that field\'s packaged base', async () => {
        const reg = withDependent({ cb_market: MARKET, title: { name: 'title', type: 'text', label: 'Headline' } });
        const out: any = await translateMetaDocument(mergedSources(reg, 'zh-CN'), 'object', served(reg));
        expect(titleOf(out).label).toBe('Headline');
        expect(marketOf(out).label).toBe('市场');
    });

    it('a later extender that adds the same name and is DISABLED is withheld from the base as from the fold: the enabled one\'s field is translated', async () => {
        const reg = withDependent();
        reg.installPackage({ id: 'com.example.later', name: 'later', version: '1.0.0' } as any, 'code');
        reg.registerObject(
            { name: OBJ, fields: { cb_market: { ...MARKET, label: 'Sales Market' } } } as any,
            'com.example.later',
            undefined,
            'extend',
            300,
        );
        reg.disablePackage('com.example.later');
        // The premise: the fold serves the enabled extender's declaration.
        expect(marketOf(served(reg)).label).toBe('Market');
        expect((reg.getPackagedObjectBase(OBJ) as any).fields.cb_market.label).toBe('Market');
        const out: any = await translateMetaDocument(mergedSources(reg, 'zh-CN'), 'object', served(reg));
        expect(marketOf(out).label).toBe('市场');
        expect(marketOf(out).options.map((o: any) => o.label)).toEqual(['内销', '出口']);
    });

    it('a field a tenant overlay adds stays authored after the fact and keeps its text', async () => {
        const reg = withDependent();
        reg.registerObject(
            {
                ...owner(),
                fields: { ...owner().fields, tenant_note: { name: 'tenant_note', type: 'text', label: 'Note' } },
                _packageId: 'sys_metadata', _provenance: 'org',
            } as any,
            'sys_metadata',
            undefined,
            'overlay',
        );
        const out: any = await translateMetaDocument(mergedSources(reg, 'zh-CN'), 'object', served(reg));
        expect(out.fields.tenant_note.label).toBe('Note');
        expect(marketOf(out).label).toBe('市场');
    });
});

describe('[#33952] a patched slot reads the patching package\'s own translations', () => {
    // The protocol answers which code package patches what
    // (`getPackagedFieldPatchBases`, the registry's read) and that package's
    // own translations (`getPackageTranslationBundle`). The deployment
    // catalog keeps the OWNER's rows under the very keys the patch's text is
    // translated under (`BUNDLE`, merged in load order), which is why the
    // patch above was served untranslated: measured on `origin/main`
    // dc66d330, the item read answered `Headline` / `Patched description` /
    // `Queued` under zh-CN with the patching package's zh-CN rows merged in.
    const EXT_ROWS: Record<string, any> = {
        'zh-CN': {
            objects: {
                [OBJ]: {
                    fields: {
                        title: { label: '大标题', help: '补丁说明' },
                        status: { options: { todo: '排队中' } },
                    },
                },
            },
        },
    };

    function patchSources(reg: SchemaRegistry, locale: string, bundles: Record<string, unknown> = { [EXT_PKG]: EXT_ROWS }): MetaListTranslationSources & { asked: string[] } {
        const asked: string[] = [];
        const protocol = {
            getPackagedObjectBase: (name: string) => reg.getPackagedObjectBase(name),
            getPackagedFieldPatchBases: (name: string) => reg.getPackagedFieldPatchBases(name),
            getPackageTranslationBundle: async (packageId: string) => {
                asked.push(packageId);
                return bundles[packageId];
            },
        };
        return { ...sources(reg, locale), resolveProtocol: async () => protocol, asked };
    }

    it('the item read serves the patched label, help text and option label in the patching package\'s zh-CN', async () => {
        const reg = registry(true);
        const out: any = await translateMetaDocument(patchSources(reg, 'zh-CN'), 'object', served(reg));
        expect([titleOf(out).label, titleOf(out).description, todoOf(out).label]).toEqual(['大标题', '补丁说明', '排队中']);
        // The slots the patch leaves alone still read the deployment catalog.
        expect([out.label, out.fields.status.label, doneOf(out).label]).toEqual(['任务', '状态', '已完成']);
    });

    it('the list read does too, reading each patching package\'s translations once for the page', async () => {
        const reg = registry(true);
        const src = patchSources(reg, 'zh-CN');
        const out: any = await translateMetaList(src, 'object', [served(reg), served(reg)]);
        for (const doc of out) expect([titleOf(doc).label, todoOf(doc).label]).toEqual(['大标题', '排队中']);
        expect(src.asked).toEqual([EXT_PKG]);
    });

    it('a locale the patching package does not translate keeps the patch text, never the owner\'s translation of the replaced text', async () => {
        const reg = registry(true);
        for (const locale of ['en', 'zh-CN']) {
            const bundles = locale === 'en' ? { [EXT_PKG]: EXT_ROWS } : { [EXT_PKG]: undefined };
            const out: any = await translateMetaDocument(patchSources(reg, locale, bundles), 'object', served(reg));
            expect([locale, titleOf(out).label, todoOf(out).label]).toEqual([locale, 'Headline', 'Queued']);
        }
    });

    it('a tenant rename on top of the patch keeps its own text', async () => {
        const reg = registry(true);
        const doc = served(reg);
        titleOf(doc).label = 'Tenant headline';
        const out: any = await translateMetaDocument(patchSources(reg, 'zh-CN'), 'object', doc);
        expect([titleOf(out).label, titleOf(out).description]).toEqual(['Tenant headline', '补丁说明']);
    });

    it('an object nobody patches reads no package translations', async () => {
        const reg = registry(false);
        const src = patchSources(reg, 'zh-CN');
        const out: any = await translateMetaDocument(src, 'object', served(reg));
        expect(titleOf(out).label).toBe('标题');
        expect(src.asked).toEqual([]);
    });
});
