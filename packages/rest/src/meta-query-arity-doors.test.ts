// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23214 slice 1] ONE list per `/meta` arity door, read by both transports.
 *
 * `META_QUERY_ARITY_DOORS` holds the single-valued names of the four `/meta`
 * doors whose only query rule is arity: the list, the book tree, `_drafts` and
 * the state machine read. `RestServer` hands each list to
 * `refuseRepeatedQueryParams`, and the runtime dispatcher's twin asks
 * `metaQueryArityRefusal` over it (`packages/runtime/src/domains/
 * dispatcher-query-arity.test.ts` pins that side). Before this, each list was
 * spelled inline in `rest-server.ts` and nowhere else, so the dispatcher had
 * none: a repeat reached its read points as an array.
 *
 * This file pins the decision itself, and that `RestServer` refuses exactly the
 * names the shared list declares, door by door. `RestServer`'s answers did not
 * move when the lists did: a BASE/HEAD differential of every name on all four
 * doors (two and three repeats, a one-element array, an empty array, one value,
 * two repeated names, an undeclared repeat) was byte-identical.
 */

import { describe, it, expect, vi } from 'vitest';
import {
    META_LIST_QUERY_PARAMS,
    META_QUERY_ARITY_DOORS,
    NAMES_ON_PACKAGE_LIST_MESSAGE,
    metaListQueryRefusal,
    metaQueryArityRefusal,
    type MetaQueryArityDoor,
} from './meta-item-read-gate.js';
import { unknownQueryParamMessage } from './query-allowlist.js';
import { repeatedQueryParamMessage } from './query-multiplicity.js';
import { RestServer } from './rest-server.js';

const DOORS = Object.keys(META_QUERY_ARITY_DOORS) as MetaQueryArityDoor[];

describe('metaQueryArityRefusal — the arity rule as data', () => {
    it.each(DOORS.flatMap((door) => META_QUERY_ARITY_DOORS[door].map((name) => [door, name] as const)))(
        '%s door: a repeated `%s` is refused with the multiplicity sentence',
        (door, name) => {
            expect(metaQueryArityRefusal(door, { [name]: ['a', 'b', 'c'] })).toEqual({
                status: 400,
                code: 'VALIDATION_ERROR',
                message: repeatedQueryParamMessage(name, 3),
                rule: 'repeated-parameter',
            });
        },
    );

    it('unwraps one occurrence IN PLACE, reads an empty array as none, and leaves strings alone', () => {
        const query: Record<string, unknown> = { package: ['com.acme'], preview: [], object: 'task' };
        expect(metaQueryArityRefusal('list', query)).toBeUndefined();
        expect(query).toEqual({ package: 'com.acme', preview: undefined, object: 'task' });
    });

    it('never touches a name its door does not declare', () => {
        const query: Record<string, unknown> = { locale: ['en', 'fr'], select: ['a', 'b'] };
        expect(metaQueryArityRefusal('list', query)).toBeUndefined();
        expect(query).toEqual({ locale: ['en', 'fr'], select: ['a', 'b'] });
    });

    it('answers two repeated names for the first one the door declares', () => {
        expect(metaQueryArityRefusal('list', { id: ['a', 'b'], package: ['c', 'd'] })?.message)
            .toBe(repeatedQueryParamMessage('package', 2));
    });

    it('carries no name in a query that is not an object', () => {
        expect(metaQueryArityRefusal('state', undefined)).toBeUndefined();
        expect(metaQueryArityRefusal('state', 'from=a')).toBeUndefined();
    });
});

function mockRes() {
    const res: any = {
        statusCode: 200,
        json: vi.fn(function (this: any) { return this; }),
        status: vi.fn(function (this: any, code: number) { this.statusCode = code; return this; }),
        header: vi.fn(function (this: any) { return this; }),
        setHeader: vi.fn(function (this: any) { return this; }),
        send: vi.fn(function (this: any) { return this; }),
        end: vi.fn(function (this: any) { return this; }),
    };
    return res;
}

/** Each door's route on a `RestServer` whose protocol records every read. */
function bootRest() {
    const protocol: any = {
        getDiscovery: vi.fn().mockResolvedValue({ version: 'v0', routes: { data: '', metadata: '', ui: '', auth: '/auth' } }),
        getMetaTypes: vi.fn().mockResolvedValue({ types: ['view', 'book', 'doc'] }),
        getMetaItems: vi.fn().mockResolvedValue({ items: [] }),
        getMetaItem: vi.fn().mockResolvedValue({ type: 'book', name: 'handbook', item: { name: 'handbook' }, lock: 'none' }),
        listDrafts: vi.fn().mockResolvedValue({ items: [] }),
    };
    const server = { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(), use: vi.fn() };
    const rest = new RestServer(server as any, protocol as any, { api: { requireAuth: false } } as any);
    // `isSystem` clears the capability gates that run before the query is read.
    (rest as any).resolveExecCtx = async () => ({ isSystem: true, userId: 'u1' });
    rest.registerRoutes();
    const route = (path: string) => (rest as any).getRoutes().find((r: any) => r.method === 'GET' && r.path === path);
    return { protocol, route };
}

const DOOR_ROUTES: Record<MetaQueryArityDoor, { path: string; params: Record<string, string> }> = {
    list: { path: '/api/v1/meta/:type', params: { type: 'view' } },
    'book-tree': { path: '/api/v1/meta/book/:name/tree', params: { name: 'handbook' } },
    drafts: { path: '/api/v1/meta/_drafts', params: {} },
    state: { path: '/api/v1/meta/object/:name/state/:field', params: { name: 'task', field: 'status' } },
};

async function drive(door: MetaQueryArityDoor, query: Record<string, unknown>) {
    const { protocol, route } = bootRest();
    const { path, params } = DOOR_ROUTES[door];
    const res = mockRes();
    await route(path).handler({ method: 'GET', path, params, query, headers: {}, body: {} }, res);
    return { protocol, status: res.statusCode, body: res.json.mock.calls.at(-1)?.[0] };
}

describe('RestServer refuses exactly the names the shared list declares, door by door', () => {
    it.each(DOORS.flatMap((door) => META_QUERY_ARITY_DOORS[door].map((name) => [door, name] as const)))(
        '%s door: a repeated `%s` answers the nested 400 before any protocol read',
        async (door, name) => {
            const { protocol, status, body } = await drive(door, { [name]: ['a', 'b'] });
            expect(status).toBe(400);
            expect(body).toEqual({ error: { code: 'VALIDATION_ERROR', message: repeatedQueryParamMessage(name, 2) } });
            expect(protocol.getMetaItems).not.toHaveBeenCalled();
            expect(protocol.listDrafts).not.toHaveBeenCalled();
        },
    );

    it('preserves one value on each door: it reaches the protocol as the string', async () => {
        expect((await drive('list', { package: ['com.acme'] })).protocol.getMetaItems.mock.calls[0][0])
            .toMatchObject({ packageId: 'com.acme' });
        expect((await drive('book-tree', { package: 'com.acme' })).protocol.getMetaItems.mock.calls[0][0])
            .toMatchObject({ packageId: 'com.acme' });
        expect((await drive('drafts', { packageId: 'com.acme', type: ['view'] })).protocol.listDrafts)
            .toHaveBeenCalledWith({ packageId: 'com.acme', type: 'view' });
        // The state read reaches its engine seam with one `from`; this RestServer
        // wires no engine, so the honest answer is the not-found it always gave.
        expect((await drive('state', { from: 'todo' })).status).not.toBe(400);
    });
});

/**
 * A client that serialises arrays qs-style sends `?package[]=com.acme` or
 * `?package[0]=com.acme`. The adapters hand the key through as spelled, so
 * `metaItemPackageBinding(query.package)` read no package and the list (and
 * the book tree) answered across EVERY package for a request that named one.
 * The two doors that read `package` with no closed set refuse it where they
 * ask their arity, before any read; every by-name door already refuses the
 * key as an unknown name (recognition).
 */
const bracketedPackageMessage = (key: string, served: 'list' | 'tree', unscoped: string): string =>
    `Query parameter '${key}' names no package; the 'package' filter takes exactly one package id, `
    + `spelled ?package=ID. The ${served} was not served: a bracketed 'package' key is not a filter. `
    + `Name one package, or leave the parameter out to ${unscoped}.`;
const PACKAGE_DOORS = [
    ['list', 'list', 'list across every package'],
    ['book-tree', 'tree', 'read the tree across every package'],
] as const;

describe('a BRACKETED `package` key on the two arity doors that read `package`', () => {
    it.each(PACKAGE_DOORS.flatMap(([door, served, unscoped]) =>
        ['package[]', 'package[0]', 'package[id]'].map((key) => [door, key, served, unscoped] as const)))(
        '%s door: `%s` is refused as data, naming the key',
        (door, key, served, unscoped) => {
            expect(metaQueryArityRefusal(door, { [key]: 'com.acme' })).toEqual({
                status: 400,
                code: 'VALIDATION_ERROR',
                message: bracketedPackageMessage(key, served, unscoped),
                rule: 'bracketed-parameter',
            });
            // Beside a plain `package` it is two spellings of one scope.
            expect(metaQueryArityRefusal(door, { package: 'com.acme', [key]: 'com.other' })?.rule)
                .toBe('bracketed-parameter');
        },
    );

    it('a repeated plain `package` still answers the multiplicity sentence first', () => {
        expect(metaQueryArityRefusal('list', { package: ['a', 'b'], 'package[]': 'c' })?.message)
            .toBe(repeatedQueryParamMessage('package', 2));
    });

    it('is judged only where `package` is read: not on `_drafts`, `state`, or a key that merely starts alike', () => {
        expect(metaQueryArityRefusal('drafts', { 'package[]': 'com.acme' })).toBeUndefined();
        expect(metaQueryArityRefusal('state', { 'package[]': 'com.acme' })).toBeUndefined();
        expect(metaQueryArityRefusal('list', { 'packages[]': 'com.acme', packageId: 'x' })).toBeUndefined();
    });

    it.each(PACKAGE_DOORS.flatMap(([door, served, unscoped]) =>
        ['package[]', 'package[0]'].map((key) => [door, key, served, unscoped] as const)))(
        'RestServer %s door: `%s` answers the nested 400 before any protocol read',
        async (door, key, served, unscoped) => {
            const { protocol, status, body } = await drive(door, { [key]: 'com.acme' });
            expect(status).toBe(400);
            expect(body).toEqual({ error: { code: 'VALIDATION_ERROR', message: bracketedPackageMessage(key, served, unscoped) } });
            expect(protocol.getMetaItems).not.toHaveBeenCalled();
        },
    );

    it('RestServer: the plain spelling still scopes, and an absent one reads every package (controls)', async () => {
        for (const door of ['list', 'book-tree'] as const) {
            expect((await drive(door, { package: 'com.acme' })).protocol.getMetaItems.mock.calls[0][0])
                .toMatchObject({ packageId: 'com.acme' });
            expect((await drive(door, {})).protocol.getMetaItems.mock.calls[0][0].packageId).toBeUndefined();
        }
    });
});

/**
 * The same class on `_drafts`' own two filters. `?packageId[]=ID`,
 * `?packageId[0]=ID`, `?type[]=TYPE` and `?type[0]=TYPE` reached the door under
 * the key as spelled, so `listDrafts` was handed no package and no type, and a
 * caller who named one package's (or one type's) drafts got every draft it may
 * read. Refused at the door's arity step, before `listDrafts`, in the same
 * sentence frame as the list's bracketed `package`.
 */
const bracketedDraftsMessage = (key: string, param: 'packageId' | 'type'): string => (param === 'packageId'
    ? `Query parameter '${key}' names no package; the 'packageId' filter takes exactly one package id, `
        + `spelled ?packageId=ID. The list was not served: a bracketed 'packageId' key is not a filter. `
        + `Name one package, or leave the parameter out to list the drafts of every package.`
    : `Query parameter '${key}' names no metadata type; the 'type' filter takes exactly one metadata type, `
        + `spelled ?type=TYPE. The list was not served: a bracketed 'type' key is not a filter. `
        + `Name one metadata type, or leave the parameter out to list the drafts of every type.`);
const DRAFTS_KEYS = [
    ['packageId[]', 'packageId'], ['packageId[0]', 'packageId'], ['packageId[id]', 'packageId'],
    ['type[]', 'type'], ['type[0]', 'type'], ['type[name]', 'type'],
] as const;

describe('a BRACKETED `packageId` or `type` key on `_drafts`', () => {
    it.each(DRAFTS_KEYS)('`%s` is refused as data, naming the key', (key, param) => {
        expect(metaQueryArityRefusal('drafts', { [key]: 'x' })).toEqual({
            status: 400,
            code: 'VALIDATION_ERROR',
            message: bracketedDraftsMessage(key, param),
            rule: 'bracketed-parameter',
        });
        // Beside the plain key it is two spellings of one filter.
        expect(metaQueryArityRefusal('drafts', { [param]: 'x', [key]: 'y' })?.rule).toBe('bracketed-parameter');
    });

    it('a repeated plain `packageId` still answers the multiplicity sentence first', () => {
        expect(metaQueryArityRefusal('drafts', { packageId: ['a', 'b'], 'type[]': 'view' })?.message)
            .toBe(repeatedQueryParamMessage('packageId', 2));
    });

    it('is judged only on `_drafts`, and not for a key that merely starts alike', () => {
        expect(metaQueryArityRefusal('list', { 'packageId[]': 'x', 'type[]': 'view' })).toBeUndefined();
        expect(metaQueryArityRefusal('book-tree', { 'type[]': 'view' })).toBeUndefined();
        expect(metaQueryArityRefusal('drafts', { 'types[]': 'view', 'packageIds[]': 'x', 'package[]': 'x' })).toBeUndefined();
    });

    it.each(DRAFTS_KEYS.filter(([key]) => key.endsWith('[]') || key.endsWith('[0]')))(
        'RestServer: `%s` answers the nested 400 before `listDrafts`',
        async (key, param) => {
            const { protocol, status, body } = await drive('drafts', { [key]: 'x' });
            expect(status).toBe(400);
            expect(body).toEqual({ error: { code: 'VALIDATION_ERROR', message: bracketedDraftsMessage(key, param) } });
            expect(protocol.listDrafts).not.toHaveBeenCalled();
        },
    );

    it('RestServer: the plain spellings still narrow, and absent ones read every draft (controls)', async () => {
        expect((await drive('drafts', { packageId: 'com.acme', type: 'view' })).protocol.listDrafts)
            .toHaveBeenCalledWith({ packageId: 'com.acme', type: 'view' });
        expect((await drive('drafts', {})).protocol.listDrafts)
            .toHaveBeenCalledWith({ packageId: undefined, type: undefined });
    });
});

/**
 * [#29236] The list's closed query set. `GET /meta/:type` declared none, so a
 * name it does not read was dropped: `?names=` before it was served, a misspelt
 * `?name=` or `?ids=`, each answered the whole list with `200`. Recognition now
 * runs first at the list's entry, on both transports (`metaListQueryRefusal`;
 * the dispatcher's side is pinned in `packages/runtime/src/domains/
 * dispatcher-query-arity.test.ts` and the parity census).
 */
const SUPPORTED_LIST_PARAMS = [...META_LIST_QUERY_PARAMS].sort();
const unknownListParam = (...names: string[]) => unknownQueryParamMessage(names, SUPPORTED_LIST_PARAMS);

async function driveList(type: string, query: Record<string, unknown>) {
    const { protocol, route } = bootRest();
    const path = '/api/v1/meta/:type';
    const res = mockRes();
    await route(path).handler({ method: 'GET', path, params: { type }, query, headers: {}, body: {} }, res);
    return { protocol, status: res.statusCode, body: res.json.mock.calls.at(-1)?.[0] };
}

describe('[#29236] the list\'s closed query set — recognition before arity', () => {
    it('declares the ruled six, and `locale`, which the list already reads', () => {
        expect(SUPPORTED_LIST_PARAMS).toEqual(['id', 'include', 'locale', 'names', 'object', 'package', 'preview']);
    });

    it.each(['name', 'ids', 'filter', 'select', 'names_', 'Names'])(
        'an undeclared `%s` is refused as data with the located sentence', (name) => {
            expect(metaListQueryRefusal('object', { [name]: 'a,b' })).toEqual({
                status: 400, code: 'VALIDATION_ERROR', message: unknownListParam(name), rule: 'unknown-parameter',
            });
        },
    );

    it('names every unknown key, sorted, and outranks a repeat of a declared one', () => {
        expect(metaListQueryRefusal('object', { zeta: '1', alpha: '2', names: ['a', 'b'] })?.message)
            .toBe(unknownListParam('alpha', 'zeta'));
        expect(metaListQueryRefusal('object', { names: ['a', 'b'] })?.rule).toBe('repeated-parameter');
    });

    it('leaves every declared name, once, to the rest of the list (controls)', () => {
        const query = { package: 'crm', preview: 'draft', object: 'lead', include: 'content', id: 'crm', names: 'a,b', locale: 'zh-CN' };
        expect(metaListQueryRefusal('object', query)).toBeUndefined();
        expect(metaListQueryRefusal('object', {})).toBeUndefined();
        expect(metaListQueryRefusal('object', undefined)).toBeUndefined();
    });

    it('leaves a bracketed spelling to its own located sentence only on the type whose step reads it', () => {
        // `package[` on every type: the arity step's bracketed refusal answers it.
        expect(metaListQueryRefusal('object', { 'package[]': 'crm' })?.rule).toBe('bracketed-parameter');
        // `id[` on `app` and `object[` on `view` are the chain's: recognition passes them on.
        expect(metaListQueryRefusal('app', { 'id[]': 'crm' })).toBeUndefined();
        expect(metaListQueryRefusal('view', { 'object[0]': 'lead' })).toBeUndefined();
        // Anywhere else no step reads them, so they are names the list does not read.
        expect(metaListQueryRefusal('object', { 'id[]': 'crm' })?.message).toBe(unknownListParam('id[]'));
        expect(metaListQueryRefusal('app', { 'object[]': 'lead' })?.message).toBe(unknownListParam('object[]'));
        expect(metaListQueryRefusal('object', { 'names[]': 'a' })?.message).toBe(unknownListParam('names[]'));
    });

    it('RestServer: an undeclared key answers the nested 400 before any protocol read', async () => {
        for (const type of ['object', 'app', 'view']) {
            const { protocol, status, body } = await driveList(type, { name: 'account' });
            expect({ type, status, body }).toEqual({
                type, status: 400, body: { error: { code: 'VALIDATION_ERROR', message: unknownListParam('name') } },
            });
            expect(protocol.getMetaItems).not.toHaveBeenCalled();
            expect(protocol.getMetaTypes).not.toHaveBeenCalled();
        }
    });

    it('RestServer: `?locale=zh-CN` and every other declared name still answer 200 (controls)', async () => {
        for (const query of [{ locale: 'zh-CN' }, { names: 'account' }, { include: 'content' }, { preview: 'draft' }, {}]) {
            const { protocol, status } = await driveList('object', query);
            expect({ query, status }).toEqual({ query, status: 200 });
            expect(protocol.getMetaItems).toHaveBeenCalledTimes(1);
        }
    });

    it('RestServer: `?names[]=` is refused by recognition; `?id[]=` keeps the app list\'s own sentence', async () => {
        expect((await driveList('object', { 'names[]': 'account' })).body)
            .toEqual({ error: { code: 'VALIDATION_ERROR', message: unknownListParam('names[]') } });
        const app = await driveList('app', { 'id[]': 'crm' });
        expect(app.status).toBe(400);
        expect(JSON.stringify(app.body)).toContain("Query parameter 'id[]' names no app");
    });

    // [contract review 6672872746] A `package` list item is keyed by id and carries no `name`, so
    // `?names=` there could only ever answer `200 []`. It is refused instead, before any read.
    it('refuses `?names=` on the `package` list with its own located sentence', () => {
        expect(NAMES_ON_PACKAGE_LIST_MESSAGE).toBe(
            "Query parameter 'names' is not served on the 'package' list: package items are keyed by id, not by name, "
            + 'so no name could match. The list was not served. Leave the parameter out to list every package you can see.',
        );
        for (const names of ['crm', 'crm,helpdesk', '', ['a', 'b']]) {
            expect(metaListQueryRefusal('package', { names })).toEqual({
                status: 400, code: 'VALIDATION_ERROR', message: NAMES_ON_PACKAGE_LIST_MESSAGE, rule: 'names-on-package',
            });
        }
        // An undeclared key on the `package` list keeps the recognition sentence, which outranks it.
        expect(metaListQueryRefusal('package', { names: 'crm', zeta: '1' })?.message).toBe(unknownListParam('zeta'));
        // Controls: the `package` list without `names`, and `names` on every other type.
        expect(metaListQueryRefusal('package', {})).toBeUndefined();
        expect(metaListQueryRefusal('package', { preview: 'draft' })).toBeUndefined();
        for (const type of ['object', 'app', 'view', 'flow']) expect(metaListQueryRefusal(type, { names: 'crm' })).toBeUndefined();
    });

    it('RestServer: `?names=` on `/meta/package` answers the nested 400 before any protocol read', async () => {
        const { protocol, status, body } = await driveList('package', { names: 'com.acme.crm' });
        expect({ status, body }).toEqual({
            status: 400, body: { error: { code: 'VALIDATION_ERROR', message: NAMES_ON_PACKAGE_LIST_MESSAGE } },
        });
        expect(protocol.getMetaItems).not.toHaveBeenCalled();
        // Control: the same door without `names` reaches the protocol read (this double declares no
        // `package` type, so what answers then is the type check, not the names refusal).
        const control = await driveList('package', {});
        expect(JSON.stringify(control.body)).not.toContain('keyed by id');
        expect(control.protocol.getMetaTypes).toHaveBeenCalled();
    });
});
