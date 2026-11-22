// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `callData`'s engine arms answer a nested-relation condition on a DISABLED
 * package's object the way the data route answers it: `404
 * OBJECT_PACKAGE_DISABLED`, never a count.
 *
 * A disable takes a package's records off the data plane: the data route
 * answers its object `404 OBJECT_PACKAGE_DISABLED`, and so does a relation
 * condition into it through an enabled object's lookup (the protocol's
 * `refuseUnservedRelationTarget`). `callData` hands a caller's `where` to the
 * ENGINE on two arms that never reach that protocol check: the `aggregate`
 * arm (the `/mcp` bridge's `aggregate_records`), and the `query` fallback on a
 * host that registers no protocol. The engine lowers the condition by reading
 * the related object, so `count where { b_ref: { secret_note: X } }` answered
 * 1 for the stored value and 0 for any other: a yes/no oracle on a field of an
 * object nobody may read.
 *
 * Driven against a REAL `ObjectQL` over `SqlDriver` (in-memory SQLite), with the real
 * `ObjectStackProtocolImplementation` as the protocol where the host has one.
 * Package `dp35526_b` owns `dp_beta`; package `dp35526_a` owns `dp_alpha`,
 * whose lookup `b_ref` points at `dp_beta` and `c_ref` at `dp_gamma`
 * (package `dp35526_c`).
 *
 * What these pins hold, for a NON-SYSTEM caller:
 *
 *   - the aggregate arm refuses the condition `404 OBJECT_PACKAGE_DISABLED`
 *     naming the target and the position, for the stored value AND for a
 *     value nothing holds (the same answer both ways: no oracle), with and
 *     without a protocol service;
 *   - the query fallback on a host with no protocol refuses it the same way;
 *   - CONTROLS: the package re-enabled answers the count 1 / 0 again, and a
 *     condition into an enabled package's object is served while `dp_beta`'s
 *     package is disabled.
 *
 * For a SYSTEM caller this file pins TODAY's answer (the count) and does not
 * judge it: whether a system context is refused too is an open point the
 * maintainer decides (an in-process caller — a hook's `ctx.api` — is a system
 * context, and in-process access is ruled served). The pin is there so a
 * change to that answer is a decision someone made, not a side effect.
 */

import { afterEach, describe, expect, it } from 'vitest';
// The source under test reaches `@objectstack/metadata` through a dynamic
// import; loaded here at module scope so its first load lands during
// collection, not inside a clocked window (`pnpm check:test-source-alias`).
import '@objectstack/metadata';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { callData, type ActionExecutionDeps } from './action-execution.js';
import type { HttpProtocolContext } from './http-dispatcher.js';

const REQ = { request: {} } as HttpProtocolContext;
const MEMBER = { userId: 'dp_member', isSystem: false, positions: [], permissions: [] } as any;
const SYSTEM = { isSystem: true } as any;

const PKG_A = 'dp35526_a';
const PKG_B = 'dp35526_b';
const PKG_C = 'dp35526_c';
const SECRET = 'BETA_SECRET';

const text = (name: string) => ({ name, label: name, type: 'text' });
const lookup = (name: string, reference: string) => ({ name, label: name, type: 'lookup', reference });

const ALPHA = { name: 'dp_alpha', label: 'Alpha', fields: { name: text('name'), b_ref: lookup('b_ref', 'dp_beta'), c_ref: lookup('c_ref', 'dp_gamma') } };
const BETA = { name: 'dp_beta', label: 'Beta', fields: { name: text('name'), secret_note: text('secret_note') } };
const GAMMA = { name: 'dp_gamma', label: 'Gamma', fields: { name: text('name'), note: text('note') } };

const manifest = (id: string) => ({ id, name: id, version: '1.0.0', type: 'app' } as any);

const live: ObjectQL[] = [];
afterEach(async () => {
    while (live.length) {
        try { await live.pop()?.destroy(); } catch { /* noop */ }
    }
});

async function makeHarness(opts: { withProtocol: boolean }) {
    const engine = new ObjectQL();
    live.push(engine);
    engine.registerDriver(new SqlDriver({ client: 'better-sqlite3', connection: { filename: ':memory:' }, useNullAsDefault: true }) as any, true);
    await engine.init();
    for (const id of [PKG_A, PKG_B, PKG_C]) engine.registry.installPackage(manifest(id), 'code');
    engine.registry.registerObject(ALPHA as any, PKG_A, undefined, 'own');
    engine.registry.registerObject(BETA as any, PKG_B, undefined, 'own');
    engine.registry.registerObject(GAMMA as any, PKG_C, undefined, 'own');
    await engine.syncSchemas();
    const beta: any = await engine.insert('dp_beta', { name: 'beta', secret_note: SECRET });
    const gamma: any = await engine.insert('dp_gamma', { name: 'gamma', note: 'open' });
    await engine.insert('dp_alpha', { name: 'alpha', b_ref: beta.id, c_ref: gamma.id });
    const services: Record<string, any> = {
        metadata: { getObject: async () => undefined },
        objectql: engine,
        ...(opts.withProtocol ? { protocol: new ObjectStackProtocolImplementation(engine as any) } : {}),
    };
    const deps: ActionExecutionDeps = {
        resolveService: (async (_ctx: HttpProtocolContext, name: string) => services[name]) as any,
        getObjectQL: async () => engine,
    };
    return { engine, deps };
}

const COUNT = [{ function: 'count', alias: 'n' }];
const envelope = (e: any) => ({ code: e?.code, status: e?.status, object: e?.object, param: e?.param });

async function aggregateCount(deps: ActionExecutionDeps, where: unknown, context: unknown): Promise<number> {
    const res: any = await callData(deps, REQ, 'aggregate', { object: 'dp_alpha', where, aggregations: COUNT }, undefined, undefined, context as any);
    return Number(res.rows?.[0]?.n ?? 0);
}

async function refusalOf(run: () => Promise<unknown>): Promise<any> {
    const err = await run().then(() => undefined, (e) => e);
    expect(err, 'served where the data route refuses').toBeInstanceOf(Error);
    return err;
}

const REFUSED = { code: 'OBJECT_PACKAGE_DISABLED', status: 404, object: 'dp_beta', param: 'where.b_ref' };

for (const withProtocol of [true, false]) {
    const host = withProtocol ? 'a host with a protocol service' : 'a host that registers no protocol service';

    describe(`[#35526] callData's aggregate arm — ${host}`, () => {
        it('THE PIN: a member\'s condition into the disabled package is refused 404, for the stored value and for any other', async () => {
            const h = await makeHarness({ withProtocol });
            h.engine.registry.disablePackage(PKG_B);
            for (const value of [SECRET, 'NOPE']) {
                const err = await refusalOf(() => aggregateCount(h.deps, { b_ref: { secret_note: value } }, MEMBER));
                expect(envelope(err)).toEqual(REFUSED);
            }
        });

        it('CONTROL: the package re-enabled answers the count again (1 for the stored value, 0 otherwise)', async () => {
            const h = await makeHarness({ withProtocol });
            h.engine.registry.disablePackage(PKG_B);
            h.engine.registry.enablePackage(PKG_B);
            expect(await aggregateCount(h.deps, { b_ref: { secret_note: SECRET } }, MEMBER)).toBe(1);
            expect(await aggregateCount(h.deps, { b_ref: { secret_note: 'NOPE' } }, MEMBER)).toBe(0);
        });

        it('CONTROL: a condition into an enabled package\'s object is served while dp_beta\'s package is disabled', async () => {
            const h = await makeHarness({ withProtocol });
            h.engine.registry.disablePackage(PKG_B);
            expect(await aggregateCount(h.deps, { c_ref: { note: 'open' } }, MEMBER)).toBe(1);
            expect(await aggregateCount(h.deps, { c_ref: { note: 'NOPE' } }, MEMBER)).toBe(0);
        });

        // OPEN POINT, not a verdict: a system context is not asked (the
        // exposure gate's own system bypass), so today it is answered the
        // count. Whether the package check skips system contexts too is the
        // maintainer's to decide; this pin moves only with that decision.
        it('SYSTEM (today\'s answer, pinned pending the open point): the count is served', async () => {
            const h = await makeHarness({ withProtocol });
            h.engine.registry.disablePackage(PKG_B);
            expect(await aggregateCount(h.deps, { b_ref: { secret_note: SECRET } }, SYSTEM)).toBe(1);
            expect(await aggregateCount(h.deps, { b_ref: { secret_note: 'NOPE' } }, SYSTEM)).toBe(0);
        });
    });
}

describe('[#35526] callData\'s query fallback — a host that registers no protocol service', () => {
    const query = (deps: ActionExecutionDeps, where: unknown, context: unknown) =>
        callData(deps, REQ, 'query', { object: 'dp_alpha', query: { where } }, undefined, undefined, context as any);

    it('THE PIN: a member\'s condition into the disabled package is refused 404, for the stored value and for any other', async () => {
        const h = await makeHarness({ withProtocol: false });
        h.engine.registry.disablePackage(PKG_B);
        for (const value of [SECRET, 'NOPE']) {
            const err = await refusalOf(() => query(h.deps, { b_ref: { secret_note: value } }, MEMBER));
            expect(envelope(err)).toEqual(REFUSED);
        }
    });

    it('CONTROL: the package re-enabled returns the matching record again', async () => {
        const h = await makeHarness({ withProtocol: false });
        const res: any = await query(h.deps, { b_ref: { secret_note: SECRET } }, MEMBER);
        expect(res.records.map((r: any) => r.name)).toEqual(['alpha']);
    });

    it('CONTROL: a condition into an enabled package\'s object is served while dp_beta\'s package is disabled', async () => {
        const h = await makeHarness({ withProtocol: false });
        h.engine.registry.disablePackage(PKG_B);
        const res: any = await query(h.deps, { c_ref: { note: 'open' } }, MEMBER);
        expect(res.records.map((r: any) => r.name)).toEqual(['alpha']);
    });
});

describe('[#35526] the query arm through the protocol (the data route\'s own answer, unchanged)', () => {
    it('a member\'s condition into the disabled package is refused 404 by the protocol', async () => {
        const h = await makeHarness({ withProtocol: true });
        h.engine.registry.disablePackage(PKG_B);
        const err = await refusalOf(() => callData(h.deps, REQ, 'query', { object: 'dp_alpha', query: { where: { b_ref: { secret_note: SECRET } } } }, undefined, undefined, MEMBER));
        expect({ code: err.code, status: err.status, object: err.object }).toEqual({ code: 'OBJECT_PACKAGE_DISABLED', status: 404, object: 'dp_beta' });
    });
});
