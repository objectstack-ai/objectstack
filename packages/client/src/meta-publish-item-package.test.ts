// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23658] `meta.publishItem` names the package whose pending draft it
 * promotes — `opts.packageId`, sent as `?package=` on
 * `POST /meta/:type/:name/publish`.
 *
 * ## The defect
 *
 * A per-item publish that names no package promotes the draft a draft save
 * naming no package writes, and the door refuses it in two states, each with
 * `?package=` as the remedy and nothing published: `409 RESOURCE_CONFLICT`
 * when two or more packages hold the item, and `404 NO_DRAFT` when the item's
 * one package holds no draft and another package's draft is stored. The
 * publish took `(type, name, { message })` and nothing else, so an SDK caller
 * was prescribed a parameter their client could not send. `saveItem` and
 * `deleteItem` already carry the option (`meta-delete-item-carriers.test.ts`
 * is the delete twin); this file is the publish half.
 *
 * ## One declaration
 *
 * `publishItem` exists only on the unscoped `ObjectStackClient.meta`; the
 * environment-scoped `client.environment(id).meta` declares none, so there is
 * no twin to hold in step here. The last case pins that absence, so a scoped
 * `publishItem` that lands later arrives with its own pins.
 *
 * ## Why the real-door rig is copied here rather than imported
 *
 * The rig (`doorFetch` / `bootDoor`) lives inside the delete twin's TEST file
 * and is exported from nothing. Importing it from there would register every
 * `describe` of that file a second time in this one (vitest collects a test
 * file's suites on import), and a shared helper module under `src/` would sit
 * in the build program, which excludes only `*.test.ts`. So the parts this
 * file drives are copied, narrowed to the publish door.
 *
 * The real-door half drives the REAL registered route handler (`RestServer`),
 * the REAL `ObjectStackProtocolImplementation` and REAL `sys_metadata*` tables
 * on a real SQLite engine. The only stub is the auth boundary
 * (`resolveExecCtx`), and the transport is a bridge from the client's `fetch`
 * into the handler rather than a socket.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { ObjectQL } from '@objectstack/objectql';
import { SqliteWasmDriver } from '@objectstack/driver-sqlite-wasm';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
// The REAL stores the protocol writes to — not a mirror.
import {
    SysMetadataObject,
    SysMetadataHistoryObject,
    SysMetadataAuditObject,
} from '@objectstack/metadata-core';
import { RestServer } from '@objectstack/runtime';
import { ObjectStackClient } from './index';
import type { PublishMetaItemResponse } from '@objectstack/spec/api';

// ---------------------------------------------------------------------------
// Part 1 — what the CLIENT puts on the wire
// ---------------------------------------------------------------------------

const PKG = 'com.qa.alpha';
const OTHER_PKG = 'com.qa.beta';
const PUBLISH_URL = 'http://localhost:3000/api/v1/meta/view/shared_grid/publish';

const PUBLISH_OK = { success: true, version: 'hmac-sha256:' + 'c'.repeat(64), seq: 1 };

function createMockClient(body: any, status = 200) {
    const fetchMock = vi.fn().mockResolvedValue({
        ok: status >= 200 && status < 300,
        status,
        statusText: status === 200 ? 'OK' : 'Error',
        json: async () => body,
        headers: new Headers(),
    });
    const client = new ObjectStackClient({ baseUrl: 'http://localhost:3000', fetch: fetchMock });
    return { client, fetchMock };
}

/** The body the client handed `fetch` on its Nth call, parsed. */
function bodyOfCall(fetchMock: ReturnType<typeof vi.fn>, i = 0): unknown {
    return JSON.parse(String(fetchMock.mock.calls[i]?.[1]?.body));
}

describe('[#23658] meta.publishItem `packageId` — what reaches the wire', () => {
    it('a publish naming a package sends it as `?package=` on the publish URL', async () => {
        const { client, fetchMock } = createMockClient(PUBLISH_OK);
        await client.meta.publishItem('view', 'shared_grid', { packageId: 'pkg' });
        expect(String(fetchMock.mock.calls[0][0])).toBe(`${PUBLISH_URL}?package=pkg`);
        expect(fetchMock.mock.calls[0][1].method).toBe('POST');
        // A query parameter, never a body member: the body names no package.
        expect(bodyOfCall(fetchMock)).toEqual({});
    });

    it('NEGATIVE CONTROL: a publish naming none sends no query string, and `\'\'` names none', async () => {
        const { client, fetchMock } = createMockClient(PUBLISH_OK);
        await client.meta.publishItem('view', 'shared_grid');
        await client.meta.publishItem('view', 'shared_grid', {});
        await client.meta.publishItem('view', 'shared_grid', { packageId: '' });
        await client.meta.publishItem('view', 'shared_grid', { packageId: undefined });
        for (let i = 0; i < 4; i++) {
            expect(String(fetchMock.mock.calls[i][0])).toBe(PUBLISH_URL);
            expect(bodyOfCall(fetchMock, i)).toEqual({});
        }
    });

    it('`message` still rides the body, beside the package and without it, the key sent once', async () => {
        const { client, fetchMock } = createMockClient(PUBLISH_OK);
        await client.meta.publishItem('view', 'shared_grid', { message: 'ship it', packageId: PKG });
        await client.meta.publishItem('view', 'shared_grid', { message: 'ship it' });

        const url = new URL(String(fetchMock.mock.calls[0][0]));
        expect(url.search).toBe(`?package=${PKG}`);
        // The door refuses a repeated `?package=` with a 400.
        expect(url.searchParams.getAll('package')).toEqual([PKG]);
        expect(bodyOfCall(fetchMock, 0)).toEqual({ message: 'ship it' });

        // Without a package: the URL and body this method sent before the option existed.
        expect(String(fetchMock.mock.calls[1][0])).toBe(PUBLISH_URL);
        expect(bodyOfCall(fetchMock, 1)).toEqual({ message: 'ship it' });
    });

    it('url-encodes a package id that needs it, in step with `saveItem` and `deleteItem`', async () => {
        const { client, fetchMock } = createMockClient(PUBLISH_OK);
        await client.meta.publishItem('view', 'shared_grid', { packageId: 'acme/crm suite' });
        await client.meta.saveItem('view', 'shared_grid', {}, { packageId: 'acme/crm suite' });
        await client.meta.deleteItem('view', 'shared_grid', { packageId: 'acme/crm suite' });
        const queryOf = (i: number) => new URL(String(fetchMock.mock.calls[i][0])).search;
        expect(queryOf(0)).toBe('?package=acme%2Fcrm+suite');
        // The same id, the same bytes, on all three doors of the item.
        expect(queryOf(1)).toBe(queryOf(0));
        expect(queryOf(2)).toBe(queryOf(0));
    });

    it('the environment-scoped `meta` declares no `publishItem` (one declaration, no twin)', () => {
        const { client } = createMockClient(PUBLISH_OK);
        expect(typeof client.meta.publishItem).toBe('function');
        // Positive control on the same scoped object: its sibling writes are there.
        const scoped = client.environment('env-123').meta as Record<string, unknown>;
        expect(typeof scoped.deleteItem).toBe('function');
        expect('publishItem' in scoped).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// Part 2 — what the REAL door does with it
// ---------------------------------------------------------------------------

const ADMIN = 'usr_admin_23658';
/** `registry.registerObject` takes `(schema, packageId, …)`; the argument is required. */
const TEST_PACKAGE_ID = 'objectstack-test';

const TASK = {
    name: 'task',
    label: 'Task',
    fields: {
        id: { name: 'id', type: 'text' as const, primaryKey: true, label: 'ID' },
        name: { name: 'name', type: 'text' as const, label: 'Name' },
    },
};

const VIEW = (name: string, label: string) => ({
    name,
    label,
    object: 'task',
    viewKind: 'list',
    columns: [{ field: 'name', label: 'Name' }],
});

function createMockHttpServer() {
    const noop = () => {};
    return {
        get: noop, post: noop, put: noop, delete: noop, patch: noop, use: noop,
        listen: async () => {}, close: async () => {},
    };
}

function makeRes() {
    const res: any = {
        _status: 200,
        write: () => true,
        end: () => {},
        header: () => res,
        status: (code: number) => { res._status = code; return res; },
        json: (body: any) => { res._json = body; return res; },
    };
    return res;
}

/** Match a request path against the registered `/:param` route patterns. */
function matchRoute(routes: any[], method: string, pathname: string) {
    for (const route of routes) {
        if (String(route.method).toUpperCase() !== method) continue;
        const pattern = String(route.path).split('/');
        const actual = pathname.split('/');
        if (pattern.length !== actual.length) continue;
        const params: Record<string, string> = {};
        let ok = true;
        for (let i = 0; i < pattern.length; i++) {
            if (pattern[i].startsWith(':')) params[pattern[i].slice(1)] = decodeURIComponent(actual[i]);
            else if (pattern[i] !== actual[i]) { ok = false; break; }
        }
        if (ok) return { route, params };
    }
    return undefined;
}

/**
 * A `fetch` that hands the client's request to the REAL registered handler.
 * A repeated query key arrives as an ARRAY — the shape
 * `refuseRepeatedQueryParams` exists to catch — and header names arrive
 * lowercased, the way an HTTP server delivers them.
 */
function doorFetch(rest: RestServer) {
    const routes = (rest as any).getRoutes();
    return async (input: any, init: any = {}) => {
        const url = new URL(String(input));
        const hit = matchRoute(routes, String(init.method ?? 'GET').toUpperCase(), url.pathname);
        if (!hit) throw new Error(`no route registered for ${init.method ?? 'GET'} ${url.pathname}`);
        const query: Record<string, string | string[]> = {};
        for (const key of new Set(url.searchParams.keys())) {
            const all = url.searchParams.getAll(key);
            query[key] = all.length > 1 ? all : all[0];
        }
        const headers: Record<string, string> = {};
        for (const [k, v] of Object.entries((init.headers ?? {}) as Record<string, string>)) {
            headers[k.toLowerCase()] = String(v);
        }
        const res = makeRes();
        await hit.route.handler(
            {
                params: hit.params,
                query,
                headers,
                body: init.body ? JSON.parse(String(init.body)) : undefined,
            } as any,
            res,
        );
        const status = res._status ?? 200;
        return {
            ok: status >= 200 && status < 300,
            status,
            statusText: status === 200 ? 'OK' : 'Error',
            json: async () => res._json,
            headers: new Headers(),
        } as any;
    };
}

const liveEngines: ObjectQL[] = [];
afterEach(async () => {
    while (liveEngines.length) {
        try { await liveEngines.pop()?.destroy(); } catch { /* noop */ }
    }
});

/** Boot the real stack: real engine, real tables, real protocol, real routes. */
async function bootDoor() {
    const engine = new ObjectQL();
    liveEngines.push(engine);
    engine.registerDriver(new SqliteWasmDriver({ filename: ':memory:' }) as never, true);
    await engine.init();
    engine.registry.registerObject(TASK as any, TEST_PACKAGE_ID);
    engine.registry.registerObject(SysMetadataObject as any, TEST_PACKAGE_ID);
    engine.registry.registerObject(SysMetadataHistoryObject as any, TEST_PACKAGE_ID);
    engine.registry.registerObject(SysMetadataAuditObject as any, TEST_PACKAGE_ID);
    // [#26708] A save naming a package the registry does not hold is refused,
    // so the two packages the item is saved into are installed first, as a
    // boot or `POST /packages` does. Each depends on the package owning
    // `task`, so a view over `task` stays inside its closure.
    for (const id of [PKG, OTHER_PKG]) {
        engine.registry.installPackage(
            { id, name: id, version: '1.0.0', dependencies: { [TEST_PACKAGE_ID]: '*' } } as any,
            'authored',
        );
    }
    // Real DDL — the overlay rows the assertions read are physically there.
    await engine.syncSchemas();

    const protocol: any = new ObjectStackProtocolImplementation(engine as any);

    /**
     * The PROBE: the request the door hands the protocol, so "no package
     * reached it" is measured on the same instrument that shows one arriving
     * in the next case — the positive control that keeps the absence honest.
     */
    const publishRequests: any[] = [];
    const realPublish = protocol.publishMetaItem.bind(protocol);
    protocol.publishMetaItem = async (request: any) => {
        publishRequests.push(request);
        return realPublish(request);
    };

    const rest = new RestServer(
        createMockHttpServer() as any,
        protocol as any,
        { api: { requireAuth: false, enableProjectScoping: true, projectResolution: 'auto' } } as any,
    );
    // The ONLY stub: the auth boundary. The capability gate's verdict, the
    // query parse, the protocol's address resolution and the repository's
    // promotion are the real code.
    (rest as any).resolveExecCtx = async () => ({
        userId: ADMIN,
        systemPermissions: ['manage_metadata'],
    });
    rest.registerRoutes();

    const client = new ObjectStackClient({ baseUrl: 'http://door.test', fetch: doorFetch(rest) });
    return { engine, client, publishRequests };
}

/**
 * Every stored row of `name` as `package:state:label`, sorted — which
 * package's row is in which state, and which body it carries.
 */
async function rowsOf(engine: any, name: string): Promise<string[]> {
    const rows = await engine.find('sys_metadata', { where: { name }, context: { isSystem: true } });
    return rows
        .map((r: any) => {
            const body = typeof r.metadata === 'string' ? JSON.parse(r.metadata) : r.metadata;
            return `${r.package_id}:${r.state}:${body?.label}`;
        })
        .sort();
}

/** Refused, as the caller sees it: the error the client throws, or a failure when it resolves. */
async function refusalOf(pending: Promise<unknown>): Promise<any> {
    return pending.then(
        () => { throw new Error('expected the package-less publish to be refused'); },
        (e: any) => e,
    );
}

describe('[#23658] the real publish door: an item two packages hold is published by naming its package', () => {
    /**
     * One item saved into two packages THROUGH THE SDK, one active row per
     * package (ADR-0048), and a pending draft of `PKG`'s.
     */
    async function twoPackageItemWithDraft(client: ObjectStackClient, name: string) {
        await client.meta.saveItem('view', name, VIEW(name, 'A'), { packageId: PKG });
        await client.meta.saveItem('view', name, VIEW(name, 'B'), { packageId: OTHER_PKG });
        await client.meta.saveItem('view', name, VIEW(name, 'A-next'), { packageId: PKG, mode: 'draft' });
    }

    const BEFORE = [`${PKG}:active:A`, `${PKG}:draft:A-next`, `${OTHER_PKG}:active:B`].sort();

    it('NAMING NONE (the only publish the SDK could express before): refused 409 RESOURCE_CONFLICT, and nothing is published', async () => {
        const { engine, client, publishRequests } = await bootDoor();
        await twoPackageItemWithDraft(client, 'two_pkg_publish');
        expect(await rowsOf(engine, 'two_pkg_publish')).toEqual(BEFORE);

        const err = await refusalOf(client.meta.publishItem('view', 'two_pkg_publish'));
        // The envelope the caller branches on, not merely that something threw.
        expect(err.code).toBe('RESOURCE_CONFLICT');
        expect(err.httpStatus).toBe(409);
        // Nothing moved: the draft is still pending and both active rows stand.
        expect(await rowsOf(engine, 'two_pkg_publish')).toEqual(BEFORE);
        // The probe: no package reached the protocol.
        expect(publishRequests).toHaveLength(1);
        expect(publishRequests[0]).not.toHaveProperty('packageId');
    }, 60_000);

    it('NAMING ONE: `{ packageId }` promotes that package\'s draft into that package\'s row, and no other', async () => {
        const { engine, client, publishRequests } = await bootDoor();
        await twoPackageItemWithDraft(client, 'two_pkg_publish');

        const published: PublishMetaItemResponse = await client.meta.publishItem(
            'view', 'two_pkg_publish', { packageId: PKG, message: 'promote alpha' },
        );

        expect(published.success).toBe(true);
        // `PKG`'s draft is now `PKG`'s active row; `OTHER_PKG`'s row is untouched.
        expect(await rowsOf(engine, 'two_pkg_publish')).toEqual(
            [`${PKG}:active:A-next`, `${OTHER_PKG}:active:B`].sort(),
        );
        // POSITIVE CONTROL for the previous case's absence: the same probe sees
        // the package arrive, read off `?package=` by the door, and the
        // message arrive off the body.
        expect(publishRequests).toHaveLength(1);
        expect(publishRequests[0].packageId).toBe(PKG);
        expect(publishRequests[0].message).toBe('promote alpha');
    }, 60_000);
});

describe('[#23658] the real publish door: the only draft is another package\'s', () => {
    it('NAMING NONE is refused 404 NO_DRAFT; naming the draft\'s package promotes it into that package\'s row', async () => {
        const { engine, client, publishRequests } = await bootDoor();
        // The item is bound to `PKG`; the only pending draft is `OTHER_PKG`'s.
        await client.meta.saveItem('view', 'other_pkg_draft', VIEW('other_pkg_draft', 'A'), { packageId: PKG });
        await client.meta.saveItem('view', 'other_pkg_draft', VIEW('other_pkg_draft', 'B-next'), {
            packageId: OTHER_PKG,
            mode: 'draft',
        });
        const before = [`${PKG}:active:A`, `${OTHER_PKG}:draft:B-next`].sort();
        expect(await rowsOf(engine, 'other_pkg_draft')).toEqual(before);

        const err = await refusalOf(client.meta.publishItem('view', 'other_pkg_draft'));
        expect(err.code).toBe('NO_DRAFT');
        expect(err.httpStatus).toBe(404);
        expect(await rowsOf(engine, 'other_pkg_draft')).toEqual(before);
        expect(publishRequests[0]).not.toHaveProperty('packageId');

        const published: PublishMetaItemResponse = await client.meta.publishItem(
            'view', 'other_pkg_draft', { packageId: OTHER_PKG },
        );
        expect(published.success).toBe(true);
        expect(await rowsOf(engine, 'other_pkg_draft')).toEqual(
            [`${PKG}:active:A`, `${OTHER_PKG}:active:B-next`].sort(),
        );
        expect(publishRequests[1].packageId).toBe(OTHER_PKG);
    }, 60_000);
});
