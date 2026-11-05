// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #30391 — an object extension that renames `label` and sets no `pluralLabel`
 * is served as an object that declares no `pluralLabel`: the base's plural
 * names the old label, so neither it nor the catalog's translation of it is
 * served for the renamed object. The pair's own translation of the plural, when
 * the extension's `.custom` package ships one, is served first (ruling record
 * 6631250894: a translation in the pair, then the override's own text, then
 * the base's translation).
 *
 * Real `SchemaRegistry`, real protocol, real `RestServer`, an i18n service
 * whose catalog is the deployment's (every package's translations merged, the
 * pair's authored row included). Both `/meta/object` reads, `en` and `zh-CN`.
 *
 * The reference is MEASURED on the same boot, never written down: an object
 * that declares no `pluralLabel` (`crm_note`) is read through the same routes,
 * and the renamed object's plural must equal what that one serves.
 */

import { describe, it, expect, vi } from 'vitest';
import { SchemaRegistry, assertEngineFindOnePredicate } from '@objectstack/objectql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { RestServer } from './rest-server.js';

const BASE = 'com.acme.crm';
const PAIR = 'com.acme.crm.custom';

/** The base package's object: both scalars declared. */
const TASK = {
    name: 'crm_task',
    label: 'Task',
    pluralLabel: 'Tasks',
    fields: { title: { name: 'title', type: 'text', label: 'Title' } },
};

/** The base package's object that declares no plural: the platform's own answer for a missing one. */
const NOTE = {
    name: 'crm_note',
    label: 'Note',
    fields: { body: { name: 'body', type: 'text', label: 'Body' } },
};

/** The base package's catalog: `en` repeats the source (what `i18n:extract` writes), `zh-CN` translates it. */
const BASE_CATALOG: Record<string, any> = {
    en: { objects: { crm_task: { label: 'Task', pluralLabel: 'Tasks' }, crm_note: { label: 'Note' } } },
    'zh-CN': { objects: { crm_task: { label: '任务', pluralLabel: '任务' }, crm_note: { label: '备注' } } },
};

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

type Row = Record<string, unknown>;

/**
 * Plain equality and `$in` (the by-name read asks `type` in both spellings);
 * any other operator or combinator is refused, so a matcher that ignored one
 * proves nothing.
 */
function matches(row: Row, where: Record<string, unknown> = {}): boolean {
    for (const [key, want] of Object.entries(where)) {
        if (want === undefined) continue;
        if (key.startsWith('$')) throw new Error(`fake engine: unsupported combinator ${key}`);
        if (want !== null && typeof want === 'object') {
            const ops = Object.keys(want);
            const list = (want as { $in?: unknown }).$in;
            if (ops.length !== 1 || !Array.isArray(list)) throw new Error(`fake engine: unsupported operator on ${key}`);
            if (!list.includes(row[key] ?? null)) return false;
            continue;
        }
        if ((row[key] ?? null) !== want) return false;
    }
    return true;
}

/** A pair's saved `translation` row, as `getPairTranslationBundle` reads it. */
function pairTranslationRow(locale: string, objects: Record<string, unknown>): Row {
    const name = `pair_${locale}`;
    return {
        id: name, type: 'translation', name, package_id: PAIR, organization_id: null, state: 'active',
        metadata: JSON.stringify({ name, locale, objects }),
    };
}

/** Deep-merge `top` over `under`, one locale's data: the deployment catalog's shape. */
function overlay(under: any, top: any): any {
    if (!top) return under;
    const out: any = { ...under };
    for (const [k, v] of Object.entries(top)) {
        out[k] = v && typeof v === 'object' && under?.[k] && typeof under[k] === 'object' ? overlay(under[k], v) : v;
    }
    return out;
}

function mockServer() {
    return {
        get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(),
        use: vi.fn(), listen: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined),
    };
}

interface Boot {
    /** The `.custom` extension of `crm_task`, or none. */
    extension?: Record<string, unknown>;
    /** The pair's own translations, locale → `objects` data; they also reach the deployment catalog. */
    pairObjects?: Record<string, Record<string, unknown>>;
}

/** Boot one host and answer `read(locale, name)` → the served object on both reads. */
function boot(opts: Boot = {}) {
    const registry = new SchemaRegistry();
    registry.registerObject(clone(TASK) as never, BASE, undefined, 'own');
    registry.registerObject(clone(NOTE) as never, BASE, undefined, 'own');
    if (opts.extension) registry.registerObjectExtension({ extend: 'crm_task', ...clone(opts.extension) }, PAIR);

    const rows: Row[] = Object.entries(opts.pairObjects ?? {}).map(([locale, objects]) => pairTranslationRow(locale, objects));
    const read = async (table: string, q?: { where?: Record<string, unknown>; limit?: number }) => {
        const found = table === 'sys_metadata' ? rows.filter((r) => matches(r, q?.where)) : [];
        return typeof q?.limit === 'number' ? found.slice(0, q.limit) : found;
    };
    const engine = {
        registry,
        find: read,
        findOne: async (table: string, q: { where: Record<string, unknown> }) => {
            assertEngineFindOnePredicate(table, q);
            return (await read(table, q))[0] ?? null;
        },
    };
    const protocol = new ObjectStackProtocolImplementation(engine as never, undefined, 'env_test');

    // The deployment catalog: every package's translations deep-merged, the pair's authored rows on top.
    const catalog = (locale: string) => overlay(BASE_CATALOG[locale], opts.pairObjects?.[locale] && { objects: opts.pairObjects[locale] });
    const i18nService = {
        getLocales: () => ['en', 'zh-CN'],
        getTranslations: (locale: string) => catalog(locale),
        getDefaultLocale: () => 'en',
    };

    const rest = new RestServer(
        mockServer() as never, protocol as never, { api: { requireAuth: false } } as never,
        undefined, undefined, undefined, undefined, undefined,
        undefined, undefined, undefined, undefined, undefined,
        // i18nServiceProvider — the 14th constructor argument.
        async () => i18nService as never,
    );
    (rest as unknown as { resolveExecCtx: () => Promise<unknown> }).resolveExecCtx = async () => ({ userId: 'u1', systemPermissions: [] });
    rest.registerRoutes();
    const routes = rest.getRouteManager();

    const run = async (path: string, params: Record<string, string>, locale: string) => {
        const entry = routes.get('GET', path);
        if (!entry) throw new Error(`route not registered: ${path}`);
        let body: any;
        const res = {
            status: () => res, header: () => res,
            json: (b: unknown) => { body = b; }, send: (b: unknown) => { body = b; },
        } as unknown as Parameters<typeof entry.handler>[1];
        await entry.handler(
            { params, query: {}, headers: { 'accept-language': locale }, method: 'GET', path } as unknown as Parameters<typeof entry.handler>[0],
            res,
        );
        return body;
    };

    /** The served object on the by-name read and on the list read, as `{ label, pluralLabel }`. */
    return async (locale: string, name: string) => {
        const byName = (await run('/api/v1/meta/:type/:name', { type: 'object', name }, locale))?.item;
        const listBody = await run('/api/v1/meta/:type', { type: 'object' }, locale);
        const listed = (Array.isArray(listBody) ? listBody : listBody?.items ?? []).find((o: any) => o?.name === name);
        const scalars = (doc: any) => ({
            label: doc?.label,
            pluralLabel: doc?.pluralLabel,
            hasPluralLabel: !!doc && Object.prototype.hasOwnProperty.call(doc, 'pluralLabel'),
        });
        return { byName: scalars(byName), listed: scalars(listed) };
    };
}

const LOCALES = ['en', 'zh-CN'] as const;

describe('#30391 — the platform\'s own answer for an object with no pluralLabel (the reference)', () => {
    for (const locale of LOCALES) {
        it(`an object that declares no pluralLabel is served with none [${locale}]`, async () => {
            const read = boot();
            const note = await read(locale, 'crm_note');
            expect(note.byName.hasPluralLabel).toBe(false);
            expect(note.listed.hasPluralLabel).toBe(false);
        });
    }
});

describe('#30391 — an extension that renames only label', () => {
    const RENAME = { label: 'Work Item' };

    for (const locale of LOCALES) {
        it(`serves the renamed label and what an object with no pluralLabel serves [${locale}]`, async () => {
            const read = boot({ extension: RENAME });
            const reference = await read(locale, 'crm_note');
            const task = await read(locale, 'crm_task');
            for (const served of [task.byName, task.listed]) {
                expect(served.label).toBe('Work Item');
                expect(served.hasPluralLabel).toBe(reference.byName.hasPluralLabel);
                expect(served.pluralLabel).toBe(reference.byName.pluralLabel);
            }
        });
    }

    it('serves the pair\'s own translation of the plural first, where the pair ships one', async () => {
        const read = boot({ extension: RENAME, pairObjects: { 'zh-CN': { crm_task: { pluralLabel: '工作项' } } } });
        const zh = await read('zh-CN', 'crm_task');
        expect(zh.byName.pluralLabel).toBe('工作项');
        expect(zh.listed.pluralLabel).toBe('工作项');
        // A locale the pair does not translate is served no plural, as before.
        const en = await read('en', 'crm_task');
        expect(en.byName.hasPluralLabel).toBe(false);
        expect(en.listed.hasPluralLabel).toBe(false);
    });

    it('a deployment translation that is not the pair\'s is not the pair\'s translation', async () => {
        // The base's catalog translates its OWN plural: with the pair silent,
        // that entry is exactly what must not come back for the renamed object.
        const read = boot({ extension: RENAME, pairObjects: { 'zh-CN': { crm_task: { label: '工作项' } } } });
        const zh = await read('zh-CN', 'crm_task');
        expect(zh.byName.hasPluralLabel).toBe(false);
        expect(zh.listed.hasPluralLabel).toBe(false);
    });
});

describe('#30391 — controls', () => {
    it('an extension that sets pluralLabel is served as set', async () => {
        const read = boot({ extension: { label: 'Work Item', pluralLabel: 'Work Items' } });
        for (const locale of LOCALES) {
            const task = await read(locale, 'crm_task');
            for (const served of [task.byName, task.listed]) {
                expect(served.label).toBe('Work Item');
                expect(served.pluralLabel).toBe('Work Items');
            }
        }
    });

    it('an extension that sets only pluralLabel keeps the base label and serves its plural', async () => {
        const read = boot({ extension: { pluralLabel: 'Work Items' } });
        const zh = await read('zh-CN', 'crm_task');
        expect(zh.byName.label).toBe('任务');
        expect(zh.byName.pluralLabel).toBe('Work Items');
    });

    it('an extension that changes neither keeps the base plural and its translation', async () => {
        const read = boot({ extension: { fields: { region__c: { name: 'region__c', type: 'text', label: 'Region' } } } });
        const en = await read('en', 'crm_task');
        const zh = await read('zh-CN', 'crm_task');
        for (const served of [en.byName, en.listed]) expect(served).toEqual({ label: 'Task', pluralLabel: 'Tasks', hasPluralLabel: true });
        for (const served of [zh.byName, zh.listed]) expect(served).toEqual({ label: '任务', pluralLabel: '任务', hasPluralLabel: true });
    });

    it('an extension that repeats the base label is no rename', async () => {
        const read = boot({ extension: { label: 'Task' } });
        const zh = await read('zh-CN', 'crm_task');
        expect(zh.byName.pluralLabel).toBe('任务');
        expect(zh.listed.pluralLabel).toBe('任务');
    });

    it('an object nothing extends keeps its plural and its translation', async () => {
        const read = boot({ extension: { label: 'Work Item' } });
        const zh = await read('zh-CN', 'crm_note');
        expect(zh.byName.label).toBe('备注');
    });
});
