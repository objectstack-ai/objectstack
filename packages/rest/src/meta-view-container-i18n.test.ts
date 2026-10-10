// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #22614 — the by-name `/meta` read of a view CONTAINER translates it as a
 * container.
 *
 * The registry files a `defineView` container under the object it binds and
 * serves it on that key's by-name read. The read handed it to the spec's
 * single-view translator, which keys the catalog on the view's `name`:
 *
 *  - an ARTIFACT-shipped container has no `name` — `GET /meta/view/<object>`
 *    answered `500` (`reading 'startsWith'`);
 *  - the CONFIG boot's registrar stamps `name: <object>` — the same read
 *    answered `200` with a fabricated `label` equal to the object name and
 *    every view inside the container left in the authored language.
 *
 * `translateMetaDocument` now classifies the document once. Pinned here, over
 * the function both transports call: the two registrar shapes translate alike;
 * each view in the container is translated exactly as the by-name read of the
 * view it expands to (the CONTROL, unchanged); the composer's names decide the
 * catalog key in every corner it names (a collapsed default list, a renamed
 * default, a renamed named form, the default form); each view's packaged base
 * is looked up by its qualified name, so an explicit override still beats the
 * catalog; the container's own strings are keyed by its object; nothing the
 * catalog does not carry is invented.
 *
 * The boot-level twin — a real config boot and a real artifact boot of one
 * project answering the same — is
 * `packages/cli/test/serve-view-container-read.integration.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import { expandViewContainer } from '@objectstack/spec/ui';
import { translateMetaDocument, type MetaListTranslationSources } from './meta-item-read-gate.js';

const OBJ = 'acme_note';

const grid = (label?: string, extra: Record<string, unknown> = {}) => ({
    type: 'grid',
    ...(label !== undefined ? { label } : {}),
    data: { provider: 'object', object: OBJ },
    columns: ['title'],
    ...extra,
});

/** A container as `os build` ships it: no `name`. */
const shipped = (body: Record<string, any>): Record<string, any> => ({ object: OBJ, ...body });

const BUNDLE: Record<string, any> = {
    en: { objects: { [OBJ]: { _views: {} } } },
    'zh-CN': {
        objects: {
            [OBJ]: {
                _views: {
                    default: { label: '全部笔记' },
                    mine: { label: '我的笔记', description: '我创建的笔记' },
                    all: { label: '所有' },
                    default_2: { label: '默认列表（改名）' },
                    form: { label: '笔记表单' },
                    edit: { label: '编辑' },
                    edit_2: { label: '编辑表单（改名）' },
                    [OBJ]: { label: '笔记视图' },
                    bulk: { bulkActions: { close_all: { label: '全部关闭', confirmText: '确定关闭？' } } },
                },
            },
        },
    },
};

const i18nService = {
    getLocales: () => Object.keys(BUNDLE),
    getTranslations: (locale: string) => BUNDLE[locale],
    getDefaultLocale: () => 'en',
};

/** A protocol whose packaged views are `packaged`, recording every name the read asks it for. */
function protocolOf(packaged: Record<string, unknown> = {}) {
    const asked: string[] = [];
    return {
        asked,
        getPackagedViewBase(name: string) {
            asked.push(name);
            return packaged[name];
        },
    };
}

function sources(locale: string | undefined, protocol: unknown = protocolOf()): MetaListTranslationSources {
    return {
        resolveI18nService: async () => i18nService,
        resolveProtocol: async () => protocol,
        requestLocale: () => locale,
    };
}

const read = (doc: unknown, locale: string | undefined = 'zh-CN', protocol?: unknown) =>
    translateMetaDocument(sources(locale, protocol), 'view', doc) as Promise<any>;

describe('#22614 — a view container is translated as a container', () => {
    const container = shipped({ list: grid('All Notes'), listViews: { mine: grid('My Notes') } });

    it('the artifact shape (no `name`) answers, with every view translated', async () => {
        const out = await read(container);
        expect(out.list.label).toBe('全部笔记');
        expect(out.listViews.mine.label).toBe('我的笔记');
        expect(out.listViews.mine.description).toBe('我创建的笔记');
        // The container's own label: the catalog carries one for its object.
        expect(out.label).toBe('笔记视图');
        // Nothing else moved, and the served document was not mutated.
        expect(out.list.columns).toEqual(['title']);
        expect(container.list.label).toBe('All Notes');
        expect('name' in out).toBe(false);
    });

    it('the config-boot shape (`name` stamped as the object) translates exactly alike', async () => {
        const artifact = await read(container);
        const config = await read({ ...container, name: OBJ });
        expect(config).toEqual({ ...artifact, name: OBJ });
    });

    it('CONTROL — every view in the container matches the by-name read of the view it expands to, which is unchanged', async () => {
        const out = await read(container);
        const items = expandViewContainer(OBJ, container);
        const byName = Object.fromEntries(
            await Promise.all(items.map(async (item) => [item.name, await read(item)] as const)),
        );
        expect(byName[`${OBJ}.default`].label).toBe('全部笔记');
        expect(byName[`${OBJ}.mine`].label).toBe('我的笔记');
        expect(out.list.label).toBe(byName[`${OBJ}.default`].label);
        expect(out.listViews.mine.label).toBe(byName[`${OBJ}.mine`].label);
        expect(out.listViews.mine.description).toBe(byName[`${OBJ}.mine`].description);
    });

    it('invents nothing: a view and a container the catalog does not carry keep their authored shape', async () => {
        const bare = { object: 'acme_other', list: { ...grid(), data: { provider: 'object', object: 'acme_other' } } };
        const out = await read(bare);
        // `translateView` falls back to a view's NAME for a missing label — not a translation.
        expect(out).toEqual(bare);
        expect('label' in out).toBe(false);
        expect('label' in out.list).toBe(false);
    });

    it('returns the SAME document when no bundle string applies, and when no locale is resolved', async () => {
        const plain = shipped({ list: grid('All Notes') });
        const en = await read(plain, 'en');
        expect(en).toBe(plain);
        expect(await translateMetaDocument(sources(undefined), 'view', plain)).toBe(plain);
    });

    it("the composer's names decide every key: a default list restating a named list is that list's", async () => {
        // The `examples/app-crm` shape: `list` restates `listViews.all` key for key.
        const out = await read(shipped({ list: grid('All'), listViews: { all: grid('All') } }));
        expect(out.listViews.all.label).toBe('所有');
        expect(out.list.label).toBe('所有');
    });

    it("…a default list whose key a named list took is the composer's renamed key", async () => {
        const out = await read(shipped({ list: grid('Default'), listViews: { default: grid('Named default', { columns: ['body'] }) } }));
        expect(out.listViews.default.label).toBe('全部笔记');
        expect(out.list.label).toBe('默认列表（改名）');
    });

    it('…a named form a list took the key of is renamed, and the default form keeps `form`', async () => {
        const form = (label: string) => ({ type: 'simple', label, sections: [{ fields: [{ field: 'title' }] }] });
        const doc = shipped({
            listViews: { edit: grid('Edit list') },
            formViews: { skipped: null, edit: form('Edit form') },
            form: form('Note form'),
        });
        const out = await read(doc);
        expect(expandViewContainer(OBJ, doc).map((item) => item.name)).toEqual([
            `${OBJ}.edit`, `${OBJ}.edit_2`, `${OBJ}.form`,
        ]);
        expect(out.listViews.edit.label).toBe('编辑');
        expect(out.formViews.edit.label).toBe('编辑表单（改名）');
        expect(out.formViews.skipped).toBeNull();
        expect(out.form.label).toBe('笔记表单');
    });

    it("translates a list view's bulk-action defs in its slot", async () => {
        const out = await read(shipped({
            listViews: { bulk: grid('Bulk', { bulkActionDefs: [{ name: 'close_all', label: 'Close all', confirmText: 'Sure?' }] }) },
        }));
        expect(out.listViews.bulk.bulkActionDefs).toEqual([
            { name: 'close_all', label: '全部关闭', confirmText: '确定关闭？' },
        ]);
    });

    it("looks each view's packaged base up by its qualified name, so an explicit override beats the catalog", async () => {
        const packaged = shipped({ list: grid('All Notes'), listViews: { mine: grid('My Notes') } });
        const [packagedDefault, packagedMine] = expandViewContainer(OBJ, packaged).sort((a, b) => a.name.localeCompare(b.name));
        const protocol = protocolOf({
            [OBJ]: packaged,
            [`${OBJ}.default`]: packagedDefault,
            [`${OBJ}.mine`]: packagedMine,
        });
        // An org overlay edited the named view's label; the default list is as shipped.
        const overlay = shipped({ list: grid('All Notes'), listViews: { mine: grid('My Notes (edited)') } });
        const out = await read(overlay, 'zh-CN', protocol);
        expect(out.listViews.mine.label).toBe('My Notes (edited)');
        expect(out.list.label).toBe('全部笔记');
        expect([...protocol.asked].sort()).toEqual([OBJ, `${OBJ}.default`, `${OBJ}.mine`]);
    });
});
