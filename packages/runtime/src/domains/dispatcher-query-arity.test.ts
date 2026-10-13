// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23214 slice 1] The runtime dispatcher's read points refuse a REPEATED
 * single-valued query name with the answer their `RestServer` twins give,
 * instead of reading an array.
 *
 * ## Why these points, and why now
 *
 * `@objectstack/hono`'s `createHonoApp` catch-all is the only door in front of
 * these dispatcher read points, and it has always handed `dispatch()` a
 * repeated name as its LAST value. So none of them ever met an array, and none
 * guards against one. The adapter is about to keep repeats as arrays, as
 * `plugin-hono-server`'s `readQuery` does (#23214 slice 2). Measured by driving
 * `dispatch()` with that array shape before this change:
 *
 * | point | the answer to a repeat |
 * |---|---|
 * | `GET /meta/object/:name/state/:field?from=` | `200`, `from: 'done,todo'`, `next: []`: a dead end for a state that does not exist |
 * | `GET /meta/_drafts?packageId=` / `?type=` | the array reached `listDrafts` |
 * | `GET /meta/:type?object=` (the view switcher) | `200 []` |
 * | `GET /meta/:type?package=` (and `preview`, `id`, `include`), `GET /meta/book/:name/tree?package=` | read as ABSENT: an unscoped list of every package |
 * | `GET /ui/view/:object?type=` | the array reached `getUiView` |
 * | `GET /i18n/translations?locale=`, `GET /i18n/labels/:object?locale=` | a `TypeError` in `resolveLocale`, so a `500` |
 * | `GET /security/suggested-bindings?packageId=` / `?status=` | a joined package no row has (`200 []`), and an "unknown status" refusal |
 * | `GET /packages?status=` / `?type=` | `===` against an array: `200` with no packages |
 * | `GET /data/:object?filter=` | the array reached `findData`, where a filter AST is an array too |
 *
 * Each now answers `400` with its twin's code and sentence. AGENTS.md route
 * rule 5: both halves per route, a REFUSAL pin (status, the nested
 * `error.code`, the sentence, and the service never called) beside a
 * PRESERVATION pin (the arguments the service received for one value).
 *
 * The four `/meta` doors' names are read from `META_QUERY_ARITY_DOORS`, the
 * one list `RestServer` reads too, so a name added there is pinned here
 * without a second spelling.
 */

import { describe, it, expect, vi } from 'vitest';
import { SchemaRegistry } from '@objectstack/objectql';
import { META_QUERY_ARITY_DOORS, assertFilterParamSuppliedOnce, repeatedQueryParamMessage } from '@objectstack/rest';
import { HttpDispatcher } from '../http-dispatcher.js';

const SCHEMA = {
    name: 'task',
    label: 'Task',
    fields: { id: { type: 'text' }, status: { type: 'text' } },
    validations: [{
        type: 'state_machine', name: 'task_status_fsm', field: 'status',
        transitions: { todo: ['backlog', 'in_progress'], done: [] },
    }],
};

const VIEWS = [
    { name: 'task_grid', viewKind: 'grid', object: 'task' },
    { name: 'task_form', viewKind: 'form', object: 'task' },
    { name: 'account_grid', viewKind: 'grid', object: 'account' },
];

/** Admitted everywhere these doors gate: the draft doors and `/packages` included. */
const AUTHOR = { userId: 'u_author', isSystem: false, systemPermissions: ['manage_metadata', 'studio.access'] };

/** The dispatcher exactly as `createHonoApp` builds it, over recording service doubles. */
function boot() {
    const protocol = {
        getMetaTypes: vi.fn(async () => ({ types: ['app', 'view', 'doc', 'book', 'object'] })),
        getMetaItems: vi.fn(async (r: any) => (r?.type === 'view' ? VIEWS.map((v) => ({ ...v })) : [])),
        listDrafts: vi.fn(async (_r: any) => ({ items: [] })),
        getUiView: vi.fn(async (r: any) => ({ object: r.object, type: r.type })),
        findData: vi.fn(async (r: any) => ({ object: r.object, records: [] })),
    };
    const i18n = {
        getLocales: vi.fn(() => ['en', 'fr']),
        getDefaultLocale: vi.fn(() => 'en'),
        getTranslations: vi.fn((_l: unknown) => ({ greeting: 'bonjour' })),
        getFieldLabels: vi.fn((_o: string, _l: unknown) => ({})),
    };
    const security = {
        resolvePermissionSetNames: async () => [],
        getMetadataReadableFields: async () => undefined,
        listAudienceBindingSuggestions: vi.fn(async (_ec: unknown, _r: unknown) => []),
    };
    const getObject = vi.fn((n: string) => (n === 'task' ? SCHEMA : undefined));
    const services: Record<string, unknown> = { protocol, i18n, security, objectql: { registry: { getObject } } };
    const get = (n: string) => services[n] ?? null;
    const kernel: any = { context: { getService: get }, getService: get, getServiceAsync: async (n: string) => get(n) };
    const dispatcher = new HttpDispatcher(kernel);
    // The seam `dispatch()` resolves identity through (as the sibling dispatch-level pins do).
    (dispatcher as any).timedResolveExecutionContext = async () => ({ ...AUTHOR });
    return { dispatcher, protocol, i18n, security, getObject };
}

/** `/packages` over a REAL registry: two packages whose `status` and `type` differ. */
function bootPackages() {
    const registry = new SchemaRegistry({ multiTenant: false, collisionPolicy: 'error' });
    (registry as any).logLevel = 'silent';
    registry.installPackage({ id: 'com.acme.app', name: 'com.acme.app', namespace: 'app', version: '1.0.0', type: 'app' } as any);
    registry.installPackage({ id: 'com.acme.plugin', name: 'com.acme.plugin', namespace: 'plugin', version: '1.0.0', type: 'plugin' } as any);
    (registry.getPackage('com.acme.plugin') as any).status = 'error';
    const getAllPackages = vi.spyOn(registry, 'getAllPackages');
    const get = (n: string) => (n === 'objectql' ? { registry } : null);
    const kernel: any = { context: { getService: get }, getService: get, getServiceAsync: async (n: string) => get(n) };
    const dispatcher = new HttpDispatcher(kernel);
    (dispatcher as any).timedResolveExecutionContext = async () => ({ ...AUTHOR });
    return { dispatcher, getAllPackages };
}

interface Answer { status: number; body: any }

async function get(dispatcher: HttpDispatcher, path: string, query: Record<string, unknown> = {}): Promise<Answer> {
    const res = await dispatcher.dispatch('GET', path, undefined, query, { request: { headers: {} } } as any);
    return { status: res.response?.status ?? (res.handled ? 200 : 0), body: res.response?.body };
}

/** The multiplicity refusal, in the dispatcher's envelope, with the twin's code and sentence. */
function expectArityRefusal(answer: Answer, name: string, count = 2): void {
    expect(answer.status, `expected 400 for a repeated "${name}", got ${JSON.stringify(answer)}`).toBe(400);
    expect(answer.body?.success).toBe(false);
    expect(answer.body?.error?.code).toBe('VALIDATION_ERROR');
    expect(answer.body?.error?.message).toBe(repeatedQueryParamMessage(name, count));
}

describe('[#23214] /meta — the four arity doors, over the list both transports read', () => {
    it('declares exactly the doors and names RestServer refuses (the one list)', () => {
        expect(META_QUERY_ARITY_DOORS).toEqual({
            list: ['package', 'preview', 'object', 'include', 'id'],
            'book-tree': ['package'],
            drafts: ['packageId', 'type'],
            state: ['from'],
        });
    });

    describe('GET /meta/object/:name/state/:field — `from` is ONE current state', () => {
        it('refuses a repeated `from` before the object is looked up', async () => {
            const { dispatcher, getObject } = boot();
            const answer = await get(dispatcher, '/meta/object/task/state/status', { from: ['done', 'todo'] });
            expectArityRefusal(answer, 'from');
            expect(getObject).not.toHaveBeenCalled();
        });

        it('preserves one `from` (and one encoded as a one-element array)', async () => {
            for (const from of ['todo', ['todo']]) {
                const { dispatcher } = boot();
                const answer = await get(dispatcher, '/meta/object/task/state/status', { from });
                expect(answer.status).toBe(200);
                expect(answer.body?.data).toEqual({ object: 'task', field: 'status', from: 'todo', next: ['backlog', 'in_progress'] });
            }
        });
    });

    describe('GET /meta/_drafts — one package, one type', () => {
        it.each(META_QUERY_ARITY_DOORS.drafts)('refuses a repeated `%s` before `listDrafts`', async (name) => {
            const { dispatcher, protocol } = boot();
            const answer = await get(dispatcher, '/meta/_drafts', { [name]: ['a', 'b'] });
            expectArityRefusal(answer, name);
            expect(protocol.listDrafts).not.toHaveBeenCalled();
        });

        it('preserves one of each, handed to `listDrafts` as strings', async () => {
            const { dispatcher, protocol } = boot();
            const answer = await get(dispatcher, '/meta/_drafts', { packageId: 'com.acme', type: ['view'] });
            expect(answer.status).toBe(200);
            expect(protocol.listDrafts).toHaveBeenCalledWith({ packageId: 'com.acme', type: 'view' });
        });
    });

    describe('GET /meta/:type — the list', () => {
        it.each(META_QUERY_ARITY_DOORS.list)('refuses a repeated `%s` before any list read', async (name) => {
            const { dispatcher, protocol } = boot();
            const answer = await get(dispatcher, '/meta/view', { [name]: ['a', 'b'] });
            expectArityRefusal(answer, name);
            expect(protocol.getMetaItems).not.toHaveBeenCalled();
        });

        it('names the count it saw, and answers two repeated names for the first declared', async () => {
            const three = await get(boot().dispatcher, '/meta/view', { object: ['a', 'b', 'c'] });
            expectArityRefusal(three, 'object', 3);
            const two = await get(boot().dispatcher, '/meta/view', { id: ['a', 'b'], package: ['c', 'd'] });
            expectArityRefusal(two, 'package');
        });

        it('preserves one `package` (it scopes the read) and one `object` (the view switcher)', async () => {
            const scoped = boot();
            expect((await get(scoped.dispatcher, '/meta/view', { package: ['com.acme'] })).status).toBe(200);
            expect(scoped.protocol.getMetaItems.mock.calls[0][0]).toMatchObject({ type: 'view', packageId: 'com.acme' });

            const switched = boot();
            const answer = await get(switched.dispatcher, '/meta/view', { object: 'task' });
            expect(answer.status).toBe(200);
            expect(answer.body?.data.map((v: any) => v.name).sort()).toEqual(['task_form', 'task_grid']);
        });

        it('leaves a name it does not declare alone (`locale` falls back to the default locale)', async () => {
            const { dispatcher } = boot();
            expect((await get(dispatcher, '/meta/view', { locale: ['en', 'fr'] })).status).toBe(200);
        });
    });

    describe('GET /meta/book/:name/tree — one package scopes the book', () => {
        it.each(META_QUERY_ARITY_DOORS['book-tree'])('refuses a repeated `%s` before the book is read', async (name) => {
            const { dispatcher, protocol } = boot();
            const answer = await get(dispatcher, '/meta/book/handbook/tree', { [name]: ['a', 'b'] });
            expectArityRefusal(answer, name);
            expect(protocol.getMetaItems).not.toHaveBeenCalled();
        });

        it('preserves one `package`, handed to the book read', async () => {
            const { dispatcher, protocol } = boot();
            await get(dispatcher, '/meta/book/handbook/tree', { package: 'com.acme' });
            expect(protocol.getMetaItems).toHaveBeenCalled();
            expect(protocol.getMetaItems.mock.calls[0][0]).toMatchObject({ packageId: 'com.acme' });
        });
    });
});

describe('[#23214] GET /ui/view/:object — `?type=` is one view type, read only when the path names none', () => {
    it('refuses a repeated `type` before `getUiView`', async () => {
        const { dispatcher, protocol } = boot();
        expectArityRefusal(await get(dispatcher, '/ui/view/task', { type: ['list', 'form'] }), 'type');
        expect(protocol.getUiView).not.toHaveBeenCalled();
    });

    it('preserves one `type`, and never reads the query when the path names the type', async () => {
        const { dispatcher, protocol } = boot();
        expect((await get(dispatcher, '/ui/view/task', { type: 'form' })).status).toBe(200);
        expect(protocol.getUiView).toHaveBeenLastCalledWith({ object: 'task', type: 'form' });
        expect((await get(dispatcher, '/ui/view/task/grid', { type: ['list', 'form'] })).status).toBe(200);
        expect(protocol.getUiView).toHaveBeenLastCalledWith({ object: 'task', type: 'grid' });
    });
});

describe('[#23214] /i18n — `?locale=` on the two arms whose path names no locale', () => {
    it('refuses a repeated `locale` on /translations before any i18n call', async () => {
        const { dispatcher, i18n } = boot();
        expectArityRefusal(await get(dispatcher, '/i18n/translations', { locale: ['en', 'fr'] }), 'locale');
        expect(i18n.getTranslations).not.toHaveBeenCalled();
    });

    it('refuses a repeated `locale` on /labels/:object before any i18n call', async () => {
        const { dispatcher, i18n } = boot();
        expectArityRefusal(await get(dispatcher, '/i18n/labels/task', { locale: ['en', 'fr'] }), 'locale');
        expect(i18n.getFieldLabels).not.toHaveBeenCalled();
    });

    it('preserves one `locale`, and never reads the query when the path names the locale', async () => {
        const { dispatcher, i18n } = boot();
        expect((await get(dispatcher, '/i18n/translations', { locale: ['fr'] })).status).toBe(200);
        expect(i18n.getTranslations).toHaveBeenLastCalledWith('fr');
        expect((await get(dispatcher, '/i18n/labels/task', { locale: 'fr' })).status).toBe(200);
        expect(i18n.getFieldLabels).toHaveBeenLastCalledWith('task', 'fr');
        expect((await get(dispatcher, '/i18n/translations/fr', { locale: ['en', 'fr'] })).status).toBe(200);
        expect(i18n.getTranslations).toHaveBeenLastCalledWith('fr');
    });
});

describe('[#23214] GET /security/suggested-bindings — one status, one package', () => {
    it.each(['status', 'packageId'])('refuses a repeated `%s` with the multiplicity sentence, before the service', async (name) => {
        const { dispatcher, security } = boot();
        expectArityRefusal(await get(dispatcher, '/security/suggested-bindings', { [name]: ['pending', 'pending'] }), name);
        expect(security.listAudienceBindingSuggestions).not.toHaveBeenCalled();
    });

    it('preserves one of each, handed to the service as strings', async () => {
        const { dispatcher, security } = boot();
        expect((await get(dispatcher, '/security/suggested-bindings', { status: 'pending', packageId: ['com.acme'] })).status).toBe(200);
        expect(security.listAudienceBindingSuggestions.mock.calls[0][1]).toEqual({ status: 'pending', packageId: 'com.acme' });
    });
});

describe('[#23214] GET /packages — `status` and `type` are each one value', () => {
    it.each(['status', 'type'])('refuses a repeated `%s` before the registry is read', async (name) => {
        const { dispatcher, getAllPackages } = bootPackages();
        expectArityRefusal(await get(dispatcher, '/packages', { [name]: ['a', 'b'] }), name);
        expect(getAllPackages).not.toHaveBeenCalled();
    });

    it('preserves one `status` and one `type` as filters', async () => {
        const ids = (a: Answer) => (a.body?.data?.packages ?? []).map((p: any) => p.manifest.id).sort();
        const byStatus = await get(bootPackages().dispatcher, '/packages', { status: ['error'] });
        expect(byStatus.status).toBe(200);
        expect(ids(byStatus)).toEqual(['com.acme.plugin']);
        const byType = await get(bootPackages().dispatcher, '/packages', { type: 'app' });
        expect(ids(byType)).toEqual(['com.acme.app']);
    });
});

describe('[#23214] GET /data/:object — the filter slot, through the rule RestServer asks', () => {
    /** REST's answer for this query: the code and sentence `assertFilterParamSuppliedOnce` throws. */
    function restAnswer(query: Record<string, unknown>): { code: string; message: string } {
        try {
            assertFilterParamSuppliedOnce({ ...query });
        } catch (e: any) {
            return { code: e.code, message: e.message };
        }
        throw new Error(`assertFilterParamSuppliedOnce accepted ${JSON.stringify(query)}: not a filter-slot spelling`);
    }

    it.each(['filter', 'where', '$filter', 'filters'])('refuses a repeated `%s` before `findData`', async (name) => {
        const { dispatcher, protocol } = boot();
        const query = { [name]: ['{"status":"a"}', '{"status":"b"}'] };
        const answer = await get(dispatcher, '/data/task', query);
        expect(answer.status).toBe(400);
        expect(answer.body?.success).toBe(false);
        expect(answer.body?.error).toMatchObject(restAnswer(query));
        expect(answer.body?.error?.code).toBe('INVALID_FILTER');
        expect(protocol.findData).not.toHaveBeenCalled();
    });

    it('preserves one filter, and leaves a genuinely multi-valued `select` an array', async () => {
        const { dispatcher, protocol } = boot();
        const answer = await get(dispatcher, '/data/task', { filter: '{"status":"open"}', select: ['id', 'status'] });
        expect(answer.status).toBe(200);
        expect(protocol.findData.mock.calls[0][0].query).toEqual({ filter: '{"status":"open"}', select: ['id', 'status'] });
    });

    it('reads a one-element filter array as the one filter it encodes, as RestServer does', async () => {
        const { dispatcher, protocol } = boot();
        expect((await get(dispatcher, '/data/task', { filter: ['{"status":"open"}'] })).status).toBe(200);
        expect(protocol.findData.mock.calls[0][0].query).toEqual({ filter: '{"status":"open"}' });
    });
});
