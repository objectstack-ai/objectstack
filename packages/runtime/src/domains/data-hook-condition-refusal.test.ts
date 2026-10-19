// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#24662] The runtime dispatcher's `/data` door answers a write an
 * unevaluable hook condition refused the way `RestServer` does: `400
 * VALIDATION_ERROR`, with the row absent.
 *
 * The dispatcher's `/data` domain does not catch the engine's throw, so the
 * `HookConditionError` leaves `dispatch()` and the HOST's exit renders it —
 * `@objectstack/hono`'s `${prefix}/*` catch-all, the only `/data` door on a
 * host that mounts just that catch-all, answers through
 * `declaredEnvelopeForThrow` (`@objectstack/plugin-hono-server`, imported
 * here, ⛔ not restated), and `dispatcher-plugin`'s `errorResponseBase` through
 * `resolveThrownHttpError`. Both read the one recogniser in
 * `@objectstack/types` (`hook-condition-refusal.ts`).
 *
 * Measured on `origin/main` `eadea5720` before it: the throw left `dispatch()`,
 * `declaredEnvelopeForThrow` declined it, and the catch-all's fallback arm
 * answered `500 INTERNAL_ERROR` carrying the hook's message; the resolver said
 * `500 INTERNAL_ERROR`. The row was absent.
 *
 * The rig is `data-write-request-gate.test.ts`'s: a real store (better-sqlite3
 * `:memory:`, the real `ObjectQL`, a real `ObjectStackProtocolImplementation`)
 * and `HttpDispatcher.dispatch()` handed what the catch-all hands it. The hook
 * is bound by the engine's own `bindHooksToEngine`.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { ObjectQL, bindHooksToEngine } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { declaredEnvelopeForThrow } from '@objectstack/plugin-hono-server';
import { resolveThrownHttpError } from '@objectstack/types';
import { HttpDispatcher } from '../http-dispatcher.js';

const PREFIX = '/api/v1';
const PACKAGE_ID = 'objectstack-test';
const CALLER = { userId: 'u_member', isSystem: false };
const INQUIRY = {
    name: 'inquiry', label: 'Inquiry',
    fields: {
        id: { name: 'id', type: 'text' as const, primaryKey: true, label: 'ID' },
        name: { name: 'name', type: 'text' as const, label: 'Name' },
    },
};

const UNEVALUABLE = {
    name: 'qa_failclosed', object: 'inquiry', events: ['beforeInsert'],
    condition: "record.name.startsWith('qa-fc') && int(record.name) > 0", handler: async () => {},
};
const REFUSING = {
    name: 'qa_refuse', object: 'inquiry', events: ['beforeInsert'],
    handler: async () => {
        throw Object.assign(new Error('Inquiries are closed.'), { status: 403, code: 'PERMISSION_DENIED' });
    },
};
const UNCOMPILABLE = {
    name: 'qa_broken', object: 'inquiry', events: ['beforeInsert'],
    condition: 'record.name ==', handler: async () => {},
};

const UNEVALUABLE_MESSAGE =
    "Hook 'qa_failclosed' could not evaluate its condition (runtime: int() type error: cannot convert to int)"
    + ' — operation aborted.';

const liveEngines: ObjectQL[] = [];
afterEach(async () => {
    while (liveEngines.length) {
        try { await liveEngines.pop()?.destroy(); } catch { /* noop */ }
    }
});

async function boot(hooks: any[]) {
    const engine = new ObjectQL();
    liveEngines.push(engine);
    engine.registerDriver(new SqlDriver({
        client: 'better-sqlite3',
        connection: { filename: ':memory:' },
        useNullAsDefault: true,
    }), true);
    await engine.init();
    engine.registry.registerObject(INQUIRY as any, PACKAGE_ID);
    await engine.syncSchemas();
    expect(bindHooksToEngine(engine, hooks as any, { packageId: PACKAGE_ID }).registered).toBe(hooks.length);

    const protocol = new ObjectStackProtocolImplementation(engine as any);
    // `callData`'s exposure gate reads the kernel's `metadata` service.
    const metadata = { getObject: async (name: string) => engine.registry.getObject(name) };
    const services: Record<string, unknown> = { protocol, metadata };
    const get = (n: string) => services[n] ?? null;
    const kernel: any = { context: { getService: get }, getService: get, getServiceAsync: async (n: string) => get(n) };
    const dispatcher = new HttpDispatcher(kernel);
    (dispatcher as any).timedResolveExecutionContext = async () => ({ ...CALLER });

    /** `POST /data/inquiry` as the catch-all hands it: the returned answer, or what left `dispatch()`. */
    const create = async (body: Record<string, unknown>): Promise<{ returned?: any; thrown?: unknown }> => {
        const raw = new Request(`http://localhost${PREFIX}/data/inquiry`, {
            method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
        });
        try {
            return { returned: await dispatcher.dispatch('POST', '/data/inquiry', body, {}, { request: raw } as any, PREFIX) };
        } catch (thrown) {
            return { thrown };
        }
    };
    const rows = async () => ((await engine.find('inquiry', {})) as unknown[]).length;
    return { create, rows };
}

describe('[#24662] the dispatcher /data door — an unevaluable hook condition is a coded refusal', () => {
    it("the card's request: both host exits answer 400 VALIDATION_ERROR, and the row is absent", async () => {
        const stack = await boot([UNEVALUABLE]);

        const { thrown } = await stack.create({ id: 'r1', name: 'qa-fc-abc' });

        expect((thrown as Error | undefined)?.name).toBe('HookConditionError');
        // `@objectstack/hono`'s catch-all: the declared limb now serves it.
        expect(declaredEnvelopeForThrow(thrown)).toEqual({
            status: 400,
            body: { success: false, error: { code: 'VALIDATION_ERROR', message: UNEVALUABLE_MESSAGE } },
        });
        // `dispatcher-plugin`'s `errorResponseBase` reads this resolution.
        expect(resolveThrownHttpError(thrown)).toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
        expect(await stack.rows()).toBe(0);
    });

    it('CONTROL: a hook that refuses on purpose answers exactly as before', async () => {
        const stack = await boot([REFUSING]);

        const { returned, thrown } = await stack.create({ id: 'r1', name: 'qa-fc-abc' });

        expect(thrown).toBeUndefined();
        expect(returned.response.status).toBe(403);
        expect(returned.response.body).toEqual({
            success: false,
            error: { code: 'PERMISSION_DENIED', message: 'Inquiries are closed.', httpStatus: 403, details: { object: 'inquiry' } },
        });
        expect(await stack.rows()).toBe(0);
    });

    it('CONTROL: a condition that never compiled still reaches the hosts\' undeclared 500', async () => {
        const stack = await boot([UNCOMPILABLE]);

        const { thrown } = await stack.create({ id: 'r1', name: 'x' });

        expect((thrown as { reason?: unknown } | undefined)?.reason).toBe('uncompilable');
        expect(declaredEnvelopeForThrow(thrown)).toBeUndefined();
        expect(resolveThrownHttpError(thrown)).toMatchObject({ status: 500, code: 'INTERNAL_ERROR' });
        expect(await stack.rows()).toBe(0);
    });
});
