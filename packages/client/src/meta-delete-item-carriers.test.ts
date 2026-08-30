// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#12181] `meta.deleteItem` sends the carriers the REST reset door reads —
 * the `If-Match` OCC pin and `?state=draft` — on BOTH declarations.
 *
 * ## The defect
 *
 * `DELETE /meta/:type/:name` ("reset metadata item to artifact default")
 * reads three carriers off the request: the `If-Match` header (threaded into
 * the protocol call as `parentVersion`), `?state=`, and `?dropStorage=`. Both
 * `deleteItem` declarations on this client took exactly `(type, name)` — no
 * options bag, nothing that became a header — so a first-party SDK caller
 * could reach none of them. The sharpest consequence is the first: on the one
 * verb whose whole job is destroying an overlay row, a concurrent edit was
 * silently destroyed instead of answering 409, and
 * `DeleteMetaItemRequest.parentVersion` describes that pin in the spec text
 * itself.
 *
 * ## What this card ships, and what it deliberately does NOT
 *
 * Two of the three carriers, per the 2026-08-28 dispatch ruling:
 *
 *  - `ifMatch` — a pure data-protection gap; the door already reads it and
 *    the sibling first-party client (`@object-ui/data-objectstack`
 *    `MetadataClient.reset`) already sends it.
 *  - `state: 'draft'` — makes the NARROWER reset reachable. Its absence did
 *    not make the SDK safer; it forced every caller onto the full reset,
 *    which drops the published overlay too.
 *
 * ⛔ `?dropStorage` is WITHHELD on purpose — the one carrier that ADDS
 * destructive reach, with no measured caller. Its absence is pinned below
 * (`the withheld third carrier`) so a later "completeness" patch has to argue
 * with a test rather than with a comment.
 *
 * ## ⚠️ The instrument trap this file is shaped around
 *
 * The two declarations are TEXTUALLY IDENTICAL — `deleteItem: async (type:
 * string, name: string)` appeared twice in one file. So a global count is not
 * evidence: 2 → 1 is equally consistent with "half the fix landed". Every
 * claim here is therefore made TWICE, once per client — the unscoped
 * `ObjectStackClient.meta` and the environment-scoped
 * `ScopedEnvironmentClient.meta` twin — and the `IN STEP` cases compare the
 * two against each other rather than restating a literal.
 *
 * ## Why the second half of this file boots a real door
 *
 * A mock-fetch pin can only show what the client PUT ON THE WIRE. The card's
 * claim is about what the door does with it — that the same stale reset is a
 * silent 200 unpinned and a 409 pinned. So the reproduction drives the REAL
 * registered route handler (`RestServer`), the REAL
 * `ObjectStackProtocolImplementation`, and REAL `sys_metadata*` tables on a
 * real SQLite engine. The only stub is the auth boundary
 * (`resolveExecCtx` — "better-auth says this bearer holds
 * `manage_metadata`"), which is the same seam every neighbouring `/meta` door
 * test stubs (`packages/rest/src/meta-write-actor-identity.test.ts`), and the
 * transport, which is a bridge from the client's `fetch` into the handler
 * rather than a socket. Everything the card is about — the header read at
 * `rest-server.ts`, `refuseRepeatedQueryParams`, the `?state` parse, the
 * threading into `deleteMetaItem`, and the repository's parent-version check
 * — is real code running here.
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
// [#13023] The reset door's response contract. Every `deleteItem` result below
// is bound to it instead of `any`: these reads used to be `const r: any`
// PRECISELY because the declared return (`{ type, name, deleted }`) named none
// of the fields the door actually sends, so reading the truth required dodging
// the type. With the declaration corrected the cast is not merely unnecessary,
// it would hide the fix — and `reset`, the flag this file already asserts in
// BOTH directions against the real door, is now a typed read.
import type { DeleteMetaItemResponse } from '@objectstack/spec/api';

// ---------------------------------------------------------------------------
// Part 1 — what the CLIENT puts on the wire (both declarations)
// ---------------------------------------------------------------------------

const OCC_TOKEN = 'sha256:' + 'c'.repeat(64);

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

/** Pull the headers object the client handed `fetch` on its Nth call. */
function headersOfCall(fetchMock: ReturnType<typeof vi.fn>, i = 0): Record<string, string> {
    return (fetchMock.mock.calls[i]?.[1]?.headers ?? {}) as Record<string, string>;
}

/**
 * The header NAMES that call put on the wire, sorted.
 *
 * The byte-identity claim has to be spelled this way rather than as "the
 * `init` has no `headers` key": the client's private `fetch` always hands the
 * mock a merged header object. `metaDeleteHeaders` returning `undefined` is
 * what keeps that merge byte-identical to an unpinned reset.
 */
function headerNamesOf(fetchMock: ReturnType<typeof vi.fn>, i = 0): string[] {
    return Object.keys(headersOfCall(fetchMock, i)).sort();
}

/** What an un-pinned reset sends on this bare mock client. */
const BASELINE_HEADERS = ['Content-Type'];

const RESET_OK = { success: true, reset: true, message: 'Customization overlay deleted' };

describe('[#12181] meta.deleteItem carriers — UNSCOPED ObjectStackClient.meta', () => {
    it('sends `ifMatch` as the If-Match request header, verbatim', async () => {
        const { client, fetchMock } = createMockClient(RESET_OK);
        await client.meta.deleteItem('view', 'shared_grid', { ifMatch: OCC_TOKEN });
        // THE assertion this card exists for, on declaration #1.
        expect(headersOfCall(fetchMock)['If-Match']).toBe(OCC_TOKEN);
        // Verbatim and unquoted — the door strips ETag quotes rather than
        // requiring them, and the sibling first-party client sends none.
        expect(headersOfCall(fetchMock)['If-Match']).not.toContain('"');
        expect(fetchMock.mock.calls[0][1].method).toBe('DELETE');
    });

    it('ABSENT when the caller does not pin: no If-Match, and no `headers` key at all', async () => {
        const { client, fetchMock } = createMockClient(RESET_OK);
        await client.meta.deleteItem('view', 'shared_grid');
        expect(headersOfCall(fetchMock)['If-Match']).toBeUndefined();
        // Byte-identity, not merely "no If-Match": last-write-wins stays the
        // default, exactly as the door and the spec text describe.
        expect(headerNamesOf(fetchMock)).toEqual(BASELINE_HEADERS);
        expect(String(fetchMock.mock.calls[0][0])).toBe(
            'http://localhost:3000/api/v1/meta/view/shared_grid',
        );
    });

    it("ABSENT for an empty token — `''` never reaches the wire", async () => {
        const { client, fetchMock } = createMockClient(RESET_OK);
        await client.meta.deleteItem('view', 'shared_grid', { ifMatch: '' });
        // An empty `If-Match` is not a no-op on the door: presence means "pin
        // this reset", so an emitted empty header would pin against the empty
        // string and refuse a reset the caller never asked to pin.
        expect(headersOfCall(fetchMock)['If-Match']).toBeUndefined();
        expect(headerNamesOf(fetchMock)).toEqual(BASELINE_HEADERS);
    });

    it('is a HEADER, not a query parameter: the URL is byte-identical to an unpinned reset', async () => {
        const { client, fetchMock } = createMockClient(RESET_OK);
        await client.meta.deleteItem('view', 'shared_grid', { ifMatch: OCC_TOKEN });
        // `?ifMatch=` is read by no door. If it appeared here it would look
        // set at the call site and protect nothing.
        expect(String(fetchMock.mock.calls[0][0])).toBe(
            'http://localhost:3000/api/v1/meta/view/shared_grid',
        );
    });

    it("sends `?state=draft` — and `'active'` deliberately sends NOTHING", async () => {
        const { client, fetchMock } = createMockClient(RESET_OK);
        await client.meta.deleteItem('view', 'shared_grid', { state: 'draft' });
        expect(String(fetchMock.mock.calls[0][0])).toBe(
            'http://localhost:3000/api/v1/meta/view/shared_grid?state=draft',
        );
        // `'active'` is the explicit spelling of the default: the door acts on
        // `state=draft` alone, so emitting `?state=active` would put a value
        // on the wire the server ignores.
        await client.meta.deleteItem('view', 'shared_grid', { state: 'active' });
        expect(String(fetchMock.mock.calls[1][0])).toBe(
            'http://localhost:3000/api/v1/meta/view/shared_grid',
        );
    });

    it('carries both carriers at once without disturbing either', async () => {
        const { client, fetchMock } = createMockClient(RESET_OK);
        await client.meta.deleteItem('view', 'shared_grid', { ifMatch: OCC_TOKEN, state: 'draft' });
        expect(String(fetchMock.mock.calls[0][0])).toBe(
            'http://localhost:3000/api/v1/meta/view/shared_grid?state=draft',
        );
        expect(headersOfCall(fetchMock)['If-Match']).toBe(OCC_TOKEN);
    });

    it('encodes the item name like every other /meta address in this file', async () => {
        const { client, fetchMock } = createMockClient(RESET_OK);
        await client.meta.deleteItem('view', 'views/all_leads', { ifMatch: OCC_TOKEN });
        expect(String(fetchMock.mock.calls[0][0])).toBe(
            'http://localhost:3000/api/v1/meta/view/views%2Fall_leads',
        );
        expect(headersOfCall(fetchMock)['If-Match']).toBe(OCC_TOKEN);
    });
});

describe('[#12181] meta.deleteItem carriers — ENVIRONMENT-SCOPED twin', () => {
    it('sends the If-Match header on the scoped client too', async () => {
        const { client, fetchMock } = createMockClient(RESET_OK);
        await client.environment('env-123').meta.deleteItem('view', 'shared_grid', { ifMatch: OCC_TOKEN });
        // THE assertion this card exists for, on declaration #2 — asserted
        // separately from #1 on purpose: the two are textually identical, and
        // a fix that landed on one only is exactly what this card guards.
        expect(String(fetchMock.mock.calls[0][0])).toBe(
            'http://localhost:3000/api/v1/environments/env-123/meta/view/shared_grid',
        );
        expect(headersOfCall(fetchMock)['If-Match']).toBe(OCC_TOKEN);
    });

    it('sends `?state=draft` on the scoped client too', async () => {
        const { client, fetchMock } = createMockClient(RESET_OK);
        await client.environment('env-123').meta.deleteItem('view', 'shared_grid', { state: 'draft' });
        expect(String(fetchMock.mock.calls[0][0])).toBe(
            'http://localhost:3000/api/v1/environments/env-123/meta/view/shared_grid?state=draft',
        );
    });

    it('ABSENT on the scoped client when the caller does not pin', async () => {
        const { client, fetchMock } = createMockClient(RESET_OK);
        await client.environment('env-123').meta.deleteItem('view', 'shared_grid');
        expect(headersOfCall(fetchMock)['If-Match']).toBeUndefined();
        expect(headerNamesOf(fetchMock)).toEqual(BASELINE_HEADERS);
        expect(String(fetchMock.mock.calls[0][0])).toBe(
            'http://localhost:3000/api/v1/environments/env-123/meta/view/shared_grid',
        );
    });

    it('IN STEP with the unscoped twin: identical header and identical query for identical options', async () => {
        // The divergence this card is about is a fix landing on one twin only.
        // Comparing the two keeps holding if either path changes, rather than
        // restating a literal on both sides.
        const { client, fetchMock } = createMockClient(RESET_OK);
        const opts = { ifMatch: OCC_TOKEN, state: 'draft' } as const;
        await client.meta.deleteItem('view', 'shared_grid', opts);
        await client.environment('env-123').meta.deleteItem('view', 'shared_grid', opts);
        expect(headersOfCall(fetchMock, 1)['If-Match']).toBe(headersOfCall(fetchMock, 0)['If-Match']);
        expect(headersOfCall(fetchMock, 0)['If-Match']).toBe(OCC_TOKEN);
        const queryOf = (i: number) => new URL(String(fetchMock.mock.calls[i][0])).search;
        expect(queryOf(1)).toBe(queryOf(0));
        expect(queryOf(0)).toBe('?state=draft');
    });

    it('IN STEP when unpinned too: neither twin adds a header or a query', async () => {
        const { client, fetchMock } = createMockClient(RESET_OK);
        await client.meta.deleteItem('view', 'shared_grid');
        await client.environment('env-123').meta.deleteItem('view', 'shared_grid');
        expect(headerNamesOf(fetchMock, 0)).toEqual(BASELINE_HEADERS);
        expect(headerNamesOf(fetchMock, 1)).toEqual(BASELINE_HEADERS);
        expect(new URL(String(fetchMock.mock.calls[0][0])).search).toBe('');
        expect(new URL(String(fetchMock.mock.calls[1][0])).search).toBe('');
    });
});

describe('[#12181] the withheld third carrier', () => {
    it('`dropStorage` is not a member of the bag, and never reaches the wire', async () => {
        const { client, fetchMock } = createMockClient(RESET_OK);
        await client.meta.deleteItem('view', 'shared_grid', {
            // `dropStorage` is deliberately NOT a member of
            // `DeleteMetaItemOptions` (2026-08-28 ruling on #12181: the one
            // carrier that ADDS destructive reach, with no measured caller).
            // This is the type-level half of the withholding; the runtime half
            // is below. Adding the member turns the directive on the next line
            // into an "unused '@ts-expect-error'" error (TS2578), so the
            // withholding cannot be undone silently.
            // @ts-expect-error — dropStorage is not part of this bag, on purpose.
            dropStorage: true,
        });
        // …and nothing leaks onto the URL through the excess property either.
        expect(String(fetchMock.mock.calls[0][0])).toBe(
            'http://localhost:3000/api/v1/meta/view/shared_grid',
        );
        expect(String(fetchMock.mock.calls[0][0])).not.toContain('dropStorage');
    });
});

// ---------------------------------------------------------------------------
// Part 2 — the REAL door: what actually happens to a concurrent edit
// ---------------------------------------------------------------------------

const ADMIN = 'usr_admin_12181';
/**
 * `registry.registerObject` takes `(schema, packageId, …)`. Passed explicitly
 * rather than left off: the argument is REQUIRED by the signature.
 */
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
 *
 * Faithful where fidelity is load-bearing for this card: header names are
 * lowercased the way an HTTP server delivers them (so the door's
 * `req.headers['if-match']` read is the one exercised, not its `If-Match`
 * fallback), and a repeated query key arrives as an ARRAY — the shape
 * `refuseRepeatedQueryParams` exists to catch.
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
    // Real DDL — the overlay rows the assertions read are physically there.
    await engine.syncSchemas();

    const protocol: any = new ObjectStackProtocolImplementation(engine as any);

    /**
     * The PROBE. Records the request the door hands the protocol, so
     * "`parentVersion` was not sent" is measured on the same instrument that
     * shows it BEING sent two cases later — the positive control that keeps
     * an absence assertion honest.
     */
    const deleteRequests: any[] = [];
    const realDelete = protocol.deleteMetaItem.bind(protocol);
    protocol.deleteMetaItem = async (request: any) => {
        deleteRequests.push(request);
        return realDelete(request);
    };

    const rest = new RestServer(
        createMockHttpServer() as any,
        protocol as any,
        { api: { requireAuth: false, enableProjectScoping: true, projectResolution: 'auto' } } as any,
    );
    // The ONLY stub: the auth boundary. Everything downstream — the capability
    // gate's verdict, the header read, the query parse, the protocol and the
    // repository's parent-version check — is the real code.
    (rest as any).resolveExecCtx = async () => ({
        userId: ADMIN,
        systemPermissions: ['manage_metadata'],
    });
    rest.registerRoutes();

    const client = new ObjectStackClient({ baseUrl: 'http://door.test', fetch: doorFetch(rest) });
    return { engine, protocol, rest, client, deleteRequests };
}

/** The overlay rows for one item, straight out of `sys_metadata`. */
async function overlayRows(engine: any, name: string) {
    return engine.find('sys_metadata', { where: { name }, context: { isSystem: true } });
}

describe('[#12181] the real reset door: a concurrent edit is destroyed unpinned, refused pinned', () => {
    it('both mounts of the reset door are registered — the twins really do reach one handler', async () => {
        const { rest } = await bootDoor();
        const paths = (rest as any).getRoutes()
            .filter((r: any) => String(r.method).toUpperCase() === 'DELETE')
            .map((r: any) => r.path);
        expect(paths).toContain('/api/v1/meta/:type/:name');
        expect(paths).toContain('/api/v1/environments/:environmentId/meta/:type/:name');
    }, 60_000);

    it('UNPINNED (the only reset the SDK could express before this card): the stale reset SUCCEEDS and the row is gone', async () => {
        const { engine, client, deleteRequests } = await bootDoor();

        // Author A writes, and reads back the OCC token the docstring names.
        const first: any = await client.meta.saveItem('view', 'race_probe', VIEW('race_probe', 'A'));
        expect(first.success).toBe(true);
        const staleToken = first.version;
        expect(typeof staleToken).toBe('string');

        // Author B edits the same item. A's token is now stale.
        const second: any = await client.meta.saveItem('view', 'race_probe', VIEW('race_probe', 'B'));
        expect(second.version).not.toBe(staleToken);
        expect(await overlayRows(engine, 'race_probe')).toHaveLength(1);

        // A resets, holding a version that is no longer current. This is the
        // BEFORE state of the card: with no options bag there was no other
        // call to make.
        const reset: DeleteMetaItemResponse = await client.meta.deleteItem('view', 'race_probe');

        // Silently destroyed: success, and B's edit is gone from the store.
        // These two are TYPED reads since #13023 — under the phantom
        // `{ type, name, deleted }` declaration they were TS2339 and this
        // binding had to be `any` to compile at all.
        expect(reset.success).toBe(true);
        expect(reset.reset).toBe(true);

        // [#13023] The phantom shape, refuted on the REAL door rather than
        // argued from the schema. `deleted` — the flag the declaration told
        // every caller to branch on — is not a key on this body, and neither
        // are `type` and `name`. A first-party consumer writing
        // `if (r.deleted)` took the FALSE branch here, on the reset that
        // really did destroy a row.
        expect('deleted' in (reset as object)).toBe(false);
        expect('type' in (reset as object)).toBe(false);
        expect('name' in (reset as object)).toBe(false);
        // The positive control that keeps those three absences honest: the
        // same instrument, same body, sees the keys that ARE there.
        expect('success' in (reset as object)).toBe(true);
        expect('reset' in (reset as object)).toBe(true);
        expect(await overlayRows(engine, 'race_probe')).toHaveLength(0);
        // The probe: no pin ever reached the protocol.
        expect(deleteRequests).toHaveLength(1);
        expect(deleteRequests[0]).not.toHaveProperty('parentVersion');
    }, 60_000);

    it('PINNED: the same stale reset is REFUSED 409 metadata_conflict, and the other author\'s row survives', async () => {
        const { engine, client, deleteRequests } = await bootDoor();

        const first: any = await client.meta.saveItem('view', 'race_probe', VIEW('race_probe', 'A'));
        const staleToken = first.version;
        const second: any = await client.meta.saveItem('view', 'race_probe', VIEW('race_probe', 'B'));
        expect(second.version).not.toBe(staleToken);

        // Do literally what the docstring prescribes — impossible before this
        // card, because there was no argument to pass it in.
        const err: any = await client.meta
            .deleteItem('view', 'race_probe', { ifMatch: staleToken })
            .then(
                () => { throw new Error('expected the stale reset to be refused'); },
                (e: any) => e,
            );

        // Assert the ENVELOPE the caller branches on, not merely that
        // something threw: a bare `.toThrow()` stays green against an error
        // from a client that never sent the header at all.
        expect(err.code).toBe('METADATA_CONFLICT');
        expect(err.httpStatus).toBe(409);

        // The point of the pin: the other author's row is still there.
        expect(await overlayRows(engine, 'race_probe')).toHaveLength(1);
        // POSITIVE CONTROL for the previous case's absence assertion — the
        // same probe, on the same door, sees the token arrive.
        expect(deleteRequests).toHaveLength(1);
        expect(deleteRequests[0].parentVersion).toBe(staleToken);
    }, 60_000);

    it('PINNED with the CURRENT version: the reset is allowed through', async () => {
        // The other half of the pin — it refuses a stale write, not every
        // write. Without this, "always 409" would pass the case above.
        const { engine, client } = await bootDoor();
        const saved: any = await client.meta.saveItem('view', 'fresh_probe', VIEW('fresh_probe', 'A'));
        const reset: DeleteMetaItemResponse = await client.meta.deleteItem('view', 'fresh_probe', { ifMatch: saved.version });
        expect(reset.success).toBe(true);
        expect(await overlayRows(engine, 'fresh_probe')).toHaveLength(0);
    }, 60_000);

    it('the ENVIRONMENT-SCOPED twin pins against the same door, with the same verdict', async () => {
        // Declaration #2, driven through the real scoped mount — the fix has
        // to be proven on both clients separately, not counted once.
        const { engine, client, deleteRequests } = await bootDoor();
        const scoped = client.environment('env-123').meta;

        const first: any = await scoped.saveItem('view', 'scoped_race', VIEW('scoped_race', 'A'));
        const staleToken = first.version;
        await scoped.saveItem('view', 'scoped_race', VIEW('scoped_race', 'B'));

        const err: any = await scoped
            .deleteItem('view', 'scoped_race', { ifMatch: staleToken })
            .then(
                () => { throw new Error('expected the stale scoped reset to be refused'); },
                (e: any) => e,
            );
        expect(err.code).toBe('METADATA_CONFLICT');
        expect(err.httpStatus).toBe(409);
        expect(await overlayRows(engine, 'scoped_race')).toHaveLength(1);
        expect(deleteRequests[0].parentVersion).toBe(staleToken);

        // …and unpinned, the scoped twin destroys it exactly like the
        // unscoped one — same handler, same last-write-wins default.
        const reset: DeleteMetaItemResponse = await scoped.deleteItem('view', 'scoped_race');
        expect(reset.success).toBe(true);
        expect(await overlayRows(engine, 'scoped_race')).toHaveLength(0);
    }, 60_000);
});

describe('[#12181] the real reset door: `?state=draft` discards ONLY the pending draft', () => {
    it('the narrow reset leaves the published overlay serving; the full reset does not', async () => {
        const { engine, client, deleteRequests } = await bootDoor();

        // A published overlay, then a pending draft on top of it.
        await client.meta.saveItem('view', 'draft_probe', VIEW('draft_probe', 'published'));
        await client.meta.saveItem('view', 'draft_probe', VIEW('draft_probe', 'pending'), { mode: 'draft' });
        const before = await overlayRows(engine, 'draft_probe');
        // Two rows: the active overlay and the draft.
        expect(before.length).toBe(2);
        expect(before.map((r: any) => r.state).sort()).toEqual(['active', 'draft']);

        // The narrow reset — unreachable from this SDK before this card.
        const discarded: DeleteMetaItemResponse = await client.meta.deleteItem('view', 'draft_probe', { state: 'draft' });
        expect(discarded.success).toBe(true);
        // The door parsed `?state=draft` and threaded it into the protocol
        // call. (Positive control for the sibling case below, where the same
        // probe shows the key ABSENT on a full reset.)
        expect(deleteRequests[0].state).toBe('draft');

        // THE claim: the published overlay is untouched, and only the draft is
        // gone.
        const after = await overlayRows(engine, 'draft_probe');
        expect(after).toHaveLength(1);
        expect(after[0].state).toBe('active');

        // A second draft discard has nothing left to discard — the door says
        // so rather than falling through to the active row.
        const again: DeleteMetaItemResponse = await client.meta.deleteItem('view', 'draft_probe', { state: 'draft' });
        expect(again.reset).toBe(false);
        expect(await overlayRows(engine, 'draft_probe')).toHaveLength(1);

        // …and the FULL reset — the only one the SDK could express before —
        // takes the published overlay with it. This is why withholding
        // `?state=draft` did not make the client safer.
        const full: DeleteMetaItemResponse = await client.meta.deleteItem('view', 'draft_probe');
        expect(full.reset).toBe(true);
        expect(await overlayRows(engine, 'draft_probe')).toHaveLength(0);
        // The probe again: `state` is absent on the full reset — measured on
        // the same instrument that showed it present above.
        expect(deleteRequests[deleteRequests.length - 1]).not.toHaveProperty('state');
    }, 60_000);

    it('the scoped twin reaches the same narrow reset', async () => {
        const { engine, client, deleteRequests } = await bootDoor();
        const scoped = client.environment('env-123').meta;

        await scoped.saveItem('view', 'scoped_draft', VIEW('scoped_draft', 'published'));
        await scoped.saveItem('view', 'scoped_draft', VIEW('scoped_draft', 'pending'), { mode: 'draft' });

        const discarded: DeleteMetaItemResponse = await scoped.deleteItem('view', 'scoped_draft', { state: 'draft' });
        expect(discarded.success).toBe(true);
        expect(deleteRequests[0].state).toBe('draft');
        const after = await overlayRows(engine, 'scoped_draft');
        expect(after).toHaveLength(1);
        expect(after[0].state).toBe('active');
    }, 60_000);
});
