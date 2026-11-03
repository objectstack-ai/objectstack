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
