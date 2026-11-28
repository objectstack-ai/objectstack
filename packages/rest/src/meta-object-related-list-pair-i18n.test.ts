// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #37622 — a record-page tab title the paired `.custom` package's arrangement
 * (`objectExtensions[].relatedLists`, ADR-0146 D10) sets or changes is
 * translated by the pair's own `objects.<object>._relatedLists.<list>.label`
 * on both `/meta/object` reads. Before it, the object read handed the
 * translator no pair catalog (an object is extended, never replaced, so it
 * answers no `servedOverrideBaseOf`), and a title that diverges from the
 * packaged base read nothing, though `os validate` accepts the key.
 *
 * Only the pair's tab titles are handed on: every other string of the object
 * keeps the ranking it had (D10), which the scope pin below holds.
 *
 * Real `SchemaRegistry`, real protocol, real `RestServer`, an i18n service
 * whose catalog is the deployment's (every package's translations merged, the
 * pair's authored rows included) — the harness of
 * `meta-object-extension-plural-label.test.ts`.
 */

import { describe, it, expect, vi } from 'vitest';
import { SchemaRegistry, assertEngineFindOnePredicate } from '@objectstack/objectql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { RestServer } from './rest-server.js';

const BASE = 'com.acme.crm';
const PAIR = 'com.acme.crm.custom';

/** The base package's parent: one labelled tab, one bare. */
const ACCOUNT = {
    name: 'crm_account',
    label: 'Account',
    fields: { name: { name: 'name', type: 'text', label: 'Name' } },
    relatedLists: [{ list: 'crm_contact', label: 'Contacts' }, 'crm_case'],
};

const child = (name: string, label: string) => ({
    name,
    label,
    fields: { account_id: { name: 'account_id', type: 'lookup', label: 'Account', reference: 'crm_account' } },
});

/** The base package's catalog: `en` repeats the source, `zh-CN` translates it. */
const BASE_CATALOG: Record<string, any> = {
    en: { objects: { crm_account: { label: 'Account', _relatedLists: { crm_contact: { label: 'Contacts' } } } } },
    'zh-CN': { objects: { crm_account: { label: '客户', _relatedLists: { crm_contact: { label: '联系人' } } } } },
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
    /** The `.custom` extension of `crm_account`, or none. */
    extension?: Record<string, unknown>;
    /** The pair's own translations, locale → `objects` data; they also reach the deployment catalog. */
    pairObjects?: Record<string, Record<string, unknown>>;
}

/** Boot one host and answer `read(locale)` → `crm_account` as both reads serve it. */
function boot(opts: Boot = {}) {
    const registry = new SchemaRegistry();
    registry.registerObject(clone(ACCOUNT) as never, BASE, undefined, 'own');
    for (const [name, label] of [['crm_contact', 'Contact'], ['crm_case', 'Case']]) {
        registry.registerObject(child(name, label) as never, BASE, undefined, 'own');
    }
    if (opts.extension) registry.registerObjectExtension({ extend: 'crm_account', ...clone(opts.extension) }, PAIR);

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

    const titles = (doc: any) => (Array.isArray(doc?.relatedLists) ? doc.relatedLists : [])
        .map((entry: any) => (typeof entry === 'string' ? entry : entry?.label ?? entry?.list));

    /** `crm_account` on the by-name read and on the list read: its label and its tab titles. */
    return async (locale: string) => {
        const byName = (await run('/api/v1/meta/:type/:name', { type: 'object', name: 'crm_account' }, locale))?.item;
        const listBody = await run('/api/v1/meta/:type', { type: 'object' }, locale);
        const listed = (Array.isArray(listBody) ? listBody : listBody?.items ?? []).find((o: any) => o?.name === 'crm_account');
        return [byName, listed].map((doc) => ({ label: doc?.label, tabs: titles(doc) }));
    };
}

/** The arrangement: relabels the owner's labelled tab and titles its bare one. */
const ARRANGEMENT = { relatedLists: [{ list: 'crm_contact', label: 'People' }, { list: 'crm_case', label: 'Tickets' }] };

describe('#37622 — the pair translates the tab titles its arrangement sets', () => {
    it('serves the pair\'s translation of a relabelled tab and of a newly titled one, on both reads', async () => {
        const read = boot({
            extension: ARRANGEMENT,
            pairObjects: { 'zh-CN': { crm_account: { _relatedLists: { crm_contact: { label: '人员' }, crm_case: { label: '工单' } } } } },
        });
        for (const served of await read('zh-CN')) expect(served.tabs).toEqual(['人员', '工单']);
        // A locale the pair does not translate keeps the arrangement's own text.
        for (const served of await read('en')) expect(served.tabs).toEqual(['People', 'Tickets']);
    });

    it('a title the pair does not translate keeps its own text, never the base\'s translation of another', async () => {
        const read = boot({
            extension: ARRANGEMENT,
            pairObjects: { 'zh-CN': { crm_account: { _relatedLists: { crm_case: { label: '工单' } } } } },
        });
        // `联系人` translates the base's `Contacts`, not the arrangement's `People`.
        for (const served of await read('zh-CN')) expect(served.tabs).toEqual(['People', '工单']);
    });

    it('hands on the pair\'s tab titles only: a label the extension renames keeps its ranking (D10)', async () => {
        const read = boot({
            extension: { ...ARRANGEMENT, label: 'Client' },
            pairObjects: { 'zh-CN': { crm_account: { label: '顾客', _relatedLists: { crm_contact: { label: '人员' } } } } },
        });
        for (const served of await read('zh-CN')) {
            expect(served.label).toBe('Client');
            expect(served.tabs).toEqual(['人员', 'Tickets']);
        }
    });
});

describe('#37622 — controls', () => {
    it('with no arrangement, the owner\'s tab title reads the deployment catalog as before', async () => {
        const read = boot();
        for (const served of await read('zh-CN')) expect(served.tabs).toEqual(['联系人', 'crm_case']);
    });

    it('an arrangement that keeps the owner\'s title reads the deployment catalog, and the pair first where it ships one', async () => {
        const kept = { relatedLists: [{ list: 'crm_contact', label: 'Contacts' }, 'crm_case'] };
        for (const served of await boot({ extension: kept })('zh-CN')) expect(served.tabs).toEqual(['联系人', 'crm_case']);
        const pairFirst = boot({
            extension: kept,
            pairObjects: { 'zh-CN': { crm_account: { _relatedLists: { crm_contact: { label: '人员' } } } } },
        });
        for (const served of await pairFirst('zh-CN')) expect(served.tabs).toEqual(['人员', 'crm_case']);
    });
});
