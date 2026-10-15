// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23686] The runtime dispatcher's own catch arms answer the engine's
 * `DuplicateRecordError` with the ruled wire spelling, `409 UNIQUE_VIOLATION`.
 *
 * Maintainer ruling (2026-09-03, recorded in commit 65846bc46): one wire
 * spelling on every route, `UNIQUE_VIOLATION`; the row reports it too.
 *
 * ## What was wrong
 *
 * `HttpDispatcher.errorFromThrown` is the one writer the dispatcher domains
 * hand a caught throw to. It passed the engine's registered in-process code
 * through unchanged, so a door whose catch arm reaches it answered
 * `409 DUPLICATE_RECORD` for a repeated unique value, while `RestServer`'s
 * arm, the batch and import rows and both Hono doors answer the same throw as
 * `UNIQUE_VIOLATION`. Measured before the fix on the rig below:
 *
 *  - `POST /actions/:object/:action`, a handler whose engine write repeats a
 *    unique value, and a declarative `operation: 'update'` action doing the
 *    same: `409 {"code":"DUPLICATE_RECORD", …, "httpStatus":409}`, no `details`;
 *  - `POST /security/_activation/:type/:name` and
 *    `POST /actions/_activation/:object/:action`, a flip whose ledger read
 *    misses the row a concurrent flip is inserting (two real concurrent
 *    flips reproduce it): the same answer, for `sys_metadata_activation`'s
 *    `(metadata_type, name)` key.
 *
 * ## The rig
 *
 * A REAL store per describe: better-sqlite3 `:memory:`, the real `ObjectQL`
 * engine, so every duplicate here is the engine's own envelope over a real
 * driver refusal, not a double's. The dispatcher is reached the way
 * `@objectstack/hono`'s catch-all reaches it, `dispatch()` over a real Fetch
 * `Request`, with the identity step the one stubbed seam; the activation
 * doors are entered at their domain handlers, as their sibling pins do.
 *
 * Codes and key presence are asserted, never wording.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { ObjectQL, DuplicateRecordError, ObjectStoreActionActivationStore } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { SysMetadataActivation } from '@objectstack/platform-objects/system';
import { HttpDispatcher } from './http-dispatcher.js';
import type { HttpProtocolContext } from './http-dispatcher.js';
import { bindTestSecurityCatalog } from './security/security-catalog.testkit.js';

const PREFIX = '/api/v1';
/** `registry.registerObject` requires a package id (see the sibling real-stack tests). */
const TEST_PACKAGE_ID = 'objectstack-test';
const LEDGER = 'sys_metadata_activation';

/** The value `r1` holds; every write below that repeats it is refused by the unique key. */
const TAKEN = 'taken@example.com';

const UDOC = {
    name: 'udoc',
    label: 'Unique doc',
    fields: {
        id: { name: 'id', type: 'text' as const, primaryKey: true, label: 'ID' },
        name: { name: 'name', type: 'text' as const, label: 'Name' },
        email: { name: 'email', type: 'text' as const, label: 'Email', unique: true },
    },
    actions: [
        { name: 'add_duplicate', label: 'Add duplicate', type: 'script', target: 'add_duplicate' },
        { name: 'take_email', label: 'Take email', type: 'script', operation: 'update', patch: { email: TAKEN } },
        { name: 'throw_named_duplicate', label: 'Throw named duplicate', type: 'script', target: 'throw_named_duplicate' },
        { name: 'speak_duplicate', label: 'Speak duplicate', type: 'script', target: 'speak_duplicate' },
        { name: 'delete_parent', label: 'Delete parent', type: 'script', target: 'delete_parent' },
    ],
};

const UPARENT = {
    name: 'uparent',
    label: 'Parent',
    fields: {
        id: { name: 'id', type: 'text' as const, primaryKey: true, label: 'ID' },
        name: { name: 'name', type: 'text' as const, label: 'Name' },
    },
};

const UCHILD = {
    name: 'uchild',
    label: 'Child',
    fields: {
        id: { name: 'id', type: 'text' as const, primaryKey: true, label: 'ID' },
        name: { name: 'name', type: 'text' as const, label: 'Name' },
        parent: { name: 'parent', type: 'lookup' as const, reference: 'uparent', deleteBehavior: 'restrict', label: 'Parent' },
    },
};

const MEMBER = { userId: 'u_member', isSystem: false };

const ADMIN = (): HttpProtocolContext => ({
    request: {},
    environmentId: 'platform',
    executionContext: { userId: 'u_admin', systemPermissions: ['manage_metadata'] },
} as unknown as HttpProtocolContext);

const liveEngines: ObjectQL[] = [];
afterAll(async () => {
    while (liveEngines.length) {
        try { await liveEngines.pop()?.destroy(); } catch { /* noop */ }
    }
});

async function bootEngine(objects: readonly object[]): Promise<ObjectQL> {
    const engine = new ObjectQL();
    liveEngines.push(engine);
    engine.registerDriver(new SqlDriver({
        client: 'better-sqlite3',
        connection: { filename: ':memory:' },
        useNullAsDefault: true,
    }), true);
    await engine.init();
    for (const o of objects) engine.registry.registerObject(o as any, TEST_PACKAGE_ID);
    await engine.syncSchemas();
    return engine;
}

function dispatcherOver(services: Record<string, unknown>): HttpDispatcher {
    const get = (n: string) => services[n] ?? null;
    const kernel: any = { context: { getService: get }, getService: get, getServiceAsync: async (n: string) => get(n) };
    const dispatcher = new HttpDispatcher(kernel);
    (dispatcher as any).timedResolveExecutionContext = async () => ({ ...MEMBER });
    return dispatcher;
}

/** `POST /api/v1/actions/<rest>` as `@objectstack/hono`'s catch-all hands it to `dispatch()`. */
async function postAction(dispatcher: HttpDispatcher, rest: string) {
    const path = `/actions/${rest}`;
    const request = new Request(`http://localhost${PREFIX}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
    });
    const res: any = await dispatcher.dispatch('POST', path, {}, {}, { request } as any, PREFIX);
    return res.response as { status: number; body: any };
}

/** The answer a repeated unique value earns at this door: the ruled code, and the REST arm's fields. */
function expectUniqueViolation(response: { status: number; body: any }, detailKeys: readonly string[], object: string) {
    expect(response.status, JSON.stringify(response.body)).toBe(409);
    const error = response.body?.error;
    expect(error?.code).toBe('UNIQUE_VIOLATION');
    expect(error?.httpStatus).toBe(409);
    expect(typeof error?.message).toBe('string');
    expect(Object.keys(error?.details ?? {}).sort()).toEqual([...detailKeys].sort());
    expect(error.details.object).toBe(object);
    expect(typeof error.details.developerMessage).toBe('string');
    // `DUPLICATE_RECORD` is a registered member, so nothing was demoted.
    expect(error).not.toHaveProperty('declaredCode');
    // The in-process spelling does not cross, and neither does the driver's text.
    const wire = JSON.stringify(response.body);
    expect(wire).not.toContain('DUPLICATE_RECORD');
    expect(wire).not.toContain('UNIQUE constraint failed');
}

describe('[#23686] the actions door answers the engine\'s duplicate as 409 UNIQUE_VIOLATION', () => {
    let dispatcher: HttpDispatcher;
    let engine: ObjectQL;

    beforeAll(async () => {
        engine = await bootEngine([UDOC, UPARENT, UCHILD]);
        const ql = engine as any;
        ql.registerAction('udoc', 'add_duplicate', async (ctx: any) => {
            await ctx.engine.insert('udoc', { id: 'r_dup', name: 'second', email: TAKEN });
            return { written: true };
        });
        ql.registerAction('udoc', 'throw_named_duplicate', async () => {
            // The engine's own class, stating the column the driver named.
            throw new DuplicateRecordError('udoc', new Error('driver refusal'), 'email');
        });
        ql.registerAction('udoc', 'speak_duplicate', async () => {
            // A producer that SPEAKS the registered code without being the engine's class.
            throw Object.assign(new Error('That address is already on file'), { code: 'DUPLICATE_RECORD', status: 409 });
        });
        ql.registerAction('udoc', 'delete_parent', async (ctx: any) => {
            await ctx.engine.delete('uparent', 'p1');
            return { deleted: true };
        });
        await engine.insert('udoc', { id: 'r1', name: 'first', email: TAKEN });
        await engine.insert('udoc', { id: 'r2', name: 'other', email: 'other@example.com' });
        await engine.insert('uparent', { id: 'p1', name: 'kept' });
        await engine.insert('uchild', { id: 'c1', name: 'dependent', parent: 'p1' });
        const protocol = new ObjectStackProtocolImplementation(engine as any);
        dispatcher = dispatcherOver({ objectql: engine, data: engine, protocol });
    }, 60_000);

    it('a handler whose engine write repeats a unique value', async () => {
        const response = await postAction(dispatcher, 'udoc/add_duplicate');

        // The driver names no single column: the index is the tenancy-scoped composite.
        expectUniqueViolation(response, ['developerMessage', 'object'], 'udoc');
        // Non-vacuity: the refusal is real, nothing was written.
        expect(await engine.find('udoc', { where: { email: TAKEN } })).toHaveLength(1);
    });

    it('a declarative `operation: \'update\'` action whose write repeats a unique value', async () => {
        const response = await postAction(dispatcher, 'udoc/take_email/r2');

        expectUniqueViolation(response, ['developerMessage', 'object'], 'udoc');
        expect(((await engine.findOne('udoc', { where: { id: 'r2' } })) as any)?.email).toBe('other@example.com');
    });

    it('the engine\'s class stating a column: `field` rides `details` beside the other two', async () => {
        const response = await postAction(dispatcher, 'udoc/throw_named_duplicate');

        expectUniqueViolation(response, ['developerMessage', 'field', 'object'], 'udoc');
        expect(response.body.error.details.field).toBe('email');
    });

    it('CONTROL: a producer that merely speaks `DUPLICATE_RECORD` keeps its own code and body', async () => {
        const response = await postAction(dispatcher, 'udoc/speak_duplicate');

        expect(response.status).toBe(409);
        expect(response.body?.error?.code).toBe('DUPLICATE_RECORD');
        expect(response.body?.error).not.toHaveProperty('details');
        expect(response.body?.error).not.toHaveProperty('declaredCode');
    });

    it('CONTROL: another engine 409 (`DELETE_RESTRICTED`) keeps its code and its body', async () => {
        const response = await postAction(dispatcher, 'udoc/delete_parent');

        expect(response.status).toBe(409);
        expect(response.body?.error?.code).toBe('DELETE_RESTRICTED');
        expect(response.body?.error).not.toHaveProperty('details');
        expect(await engine.find('uparent', { where: { id: 'p1' } })).toHaveLength(1);
    });
});

/**
 * The engine as a flip that races another sees it: its read of the activation
 * ledger misses the row the other flip has inserted, so its own insert is the
 * one the ledger's unique `(metadata_type, name)` key refuses. Every other
 * call reaches the real engine, the insert included, so the refusal is the
 * engine's own envelope over a real driver error. Two real concurrent flips
 * reproduce the same answer; this holds the race window open so the pin does
 * not depend on scheduling.
 */
function ledgerReadMissingTheRacer(engine: ObjectQL): ObjectQL {
    return new Proxy(engine, {
        get(target, prop) {
            if (prop === 'find') {
                return async (object: string, options?: unknown) =>
                    object === LEDGER ? [] : (target as any).find(object, options);
            }
            const value = Reflect.get(target, prop, target);
            return typeof value === 'function' ? value.bind(target) : value;
        },
    });
}

describe('[#23686] the activation doors answer a ledger write that loses a race as 409 UNIQUE_VIOLATION', () => {
    let engine: ObjectQL;
    let racing: ObjectQL;
    let dispatcher: HttpDispatcher;

    beforeAll(async () => {
        engine = await bootEngine([UDOC, SysMetadataActivation]);
        bindTestSecurityCatalog(engine, {
            positions: [{ name: 'sales_rep', permissionSets: ['sales_access'] }],
            permissions: [
                { name: 'sales_access', systemPermissions: ['cap_sales'] },
                { name: 'admin_full_access', systemPermissions: ['manage_metadata'] },
            ],
        });
        (engine as any).registerAction('udoc', 'add_duplicate', async () => ({ ok: true }));
        racing = ledgerReadMissingTheRacer(engine);
        const store = new ObjectStoreActionActivationStore(racing as any);
        await store.probe();
        (engine as any).setActionActivationStore(store);
        dispatcher = dispatcherOver({ objectql: racing, data: racing });
    }, 60_000);

    const ledgerRows = async (type: string, name: string) =>
        engine.find(LEDGER, { where: { metadata_type: type, name } });

    it('`POST /security/_activation/position/:name` (catalog activation)', async () => {
        const flip = () => dispatcher.handleSecurity('/_activation/position/sales_rep', 'POST', { enabled: false }, {}, ADMIN());

        const first: any = await flip();
        expect(first.response?.status, JSON.stringify(first.response?.body)).toBe(200);
        const racer: any = await flip();

        expectUniqueViolation(racer.response, ['developerMessage', 'object'], LEDGER);
        expect(await ledgerRows('position', 'sales_rep')).toHaveLength(1);
    });

    it('`POST /actions/_activation/:object/:action` (action activation)', async () => {
        const flip = () => dispatcher.handleActions('/_activation/udoc/add_duplicate', 'POST', { enabled: false }, ADMIN());

        const first: any = await flip();
        expect(first.response?.status, JSON.stringify(first.response?.body)).toBe(200);
        const racer: any = await flip();

        expectUniqueViolation(racer.response, ['developerMessage', 'object'], LEDGER);
        expect(await ledgerRows('action', 'add_duplicate')).toHaveLength(1);
    });
});
