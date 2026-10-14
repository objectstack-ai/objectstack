// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23214] The package WRITE doors refuse a REPEATED single-valued flag —
 * `?keepData=` on `DELETE /packages/:id`, `?overwrite=` on `POST /packages` —
 * as this domain already refuses `enabled` and `version`.
 *
 * ## Why these two
 *
 * Both were read as `query?.<name> === 'true'`. An adapter that keeps a
 * repeated name hands the domain an array (`plugin-hono-server`'s `readQuery`
 * always has; `@objectstack/hono`'s catch-all does from this card), which
 * compares unequal and so read as ABSENT. Measured before this change, driving
 * `dispatch()` with the array:
 *
 * | request | answer |
 * |---|---|
 * | `DELETE /packages/:id?keepData=true&keepData=true` | `200`; `deletePackage` received no `keepData`, and the protocol drops object storage unless `keepData === true` — the tables the caller asked to keep |
 * | `POST /packages?overwrite=true&overwrite=true` (installed id) | `409` "already exists", where one `true` overwrites with `201` |
 *
 * Both halves per name (AGENTS.md route rule 5): a REFUSAL pin — `400`, the
 * nested `VALIDATION_ERROR`, the domain's one multiplicity sentence, and
 * neither the registry nor the protocol touched — beside a PRESERVATION pin on
 * what the service received for one value.
 */

import { describe, it, expect, vi } from 'vitest';
import { SchemaRegistry } from '@objectstack/objectql';
import { repeatedQueryParamMessage } from '@objectstack/rest';
import { HttpDispatcher } from '../http-dispatcher.js';

const PKG = 'com.acme.app';

/** Admitted by both write doors' capability gate. */
const AUTHOR = { userId: 'u_author', isSystem: false, systemPermissions: ['manage_metadata', 'studio.access'] };

/** The dispatcher over a REAL registry holding one installed, writable package, and a recording protocol. */
function boot() {
    const registry = new SchemaRegistry({ multiTenant: false, collisionPolicy: 'error' });
    (registry as any).logLevel = 'silent';
    registry.installPackage({ id: PKG, name: PKG, namespace: 'app', version: '1.0.0', type: 'app' } as any);
    const getPackage = vi.spyOn(registry, 'getPackage');
    const protocol = {
        deletePackage: vi.fn(async (_r: any) => ({ success: true })),
        installPackage: vi.fn(async (r: any) => ({ package: { manifest: r.manifest, status: 'installed', enabled: true } })),
    };
    const services: Record<string, unknown> = { objectql: { registry }, protocol };
    const get = (n: string) => services[n] ?? null;
    const kernel: any = { context: { getService: get }, getService: get, getServiceAsync: async (n: string) => get(n) };
    const dispatcher = new HttpDispatcher(kernel);
    // The seam `dispatch()` resolves identity through (as the sibling dispatch-level pins do).
    (dispatcher as any).timedResolveExecutionContext = async () => ({ ...AUTHOR });
    return { dispatcher, protocol, getPackage };
}

interface Answer { status: number; body: any }

async function call(dispatcher: HttpDispatcher, method: string, path: string, body: unknown, query: Record<string, unknown>): Promise<Answer> {
    const res = await dispatcher.dispatch(method, path, body, query, { request: { headers: {} } } as any);
    return { status: res.response?.status ?? (res.handled ? 200 : 0), body: res.response?.body };
}

function expectArityRefusal(answer: Answer, name: string, count = 2): void {
    expect(answer.status, `expected 400 for a repeated "${name}", got ${JSON.stringify(answer)}`).toBe(400);
    expect(answer.body?.success).toBe(false);
    expect(answer.body?.error?.code).toBe('VALIDATION_ERROR');
    expect(answer.body?.error?.message).toBe(repeatedQueryParamMessage(name, count));
}

const UPGRADE = { manifest: { id: PKG, name: PKG, namespace: 'app', version: '1.0.1', type: 'app' } };

describe('[#23214] DELETE /packages/:id — `keepData` is one flag', () => {
    it.each([
        [['true', 'true']],
        [['1', 'true']],
        [['false', 'true', 'true']],
    ])('refuses a repeated `keepData` (%j) before the registry or the protocol is touched', async (keepData) => {
        const { dispatcher, protocol, getPackage } = boot();
        expectArityRefusal(await call(dispatcher, 'DELETE', `/packages/${PKG}`, undefined, { keepData }), 'keepData', keepData.length);
        expect(protocol.deletePackage).not.toHaveBeenCalled();
        expect(getPackage).not.toHaveBeenCalled();
    });

    it.each([
        ['true', { packageId: PKG, keepData: true }],
        ['1', { packageId: PKG, keepData: true }],
        [['true'], { packageId: PKG, keepData: true }],
        [undefined, { packageId: PKG }],
    ])('preserves one `keepData` (%j): deletePackage receives %j', async (keepData, received) => {
        const { dispatcher, protocol } = boot();
        const answer = await call(dispatcher, 'DELETE', `/packages/${PKG}`, undefined, keepData === undefined ? {} : { keepData });
        expect(answer.status).toBe(200);
        expect(protocol.deletePackage).toHaveBeenCalledTimes(1);
        expect(protocol.deletePackage.mock.calls[0][0]).toEqual(received);
    });
});

describe('[#23214] POST /packages — `overwrite` is one flag', () => {
    it('refuses a repeated `overwrite` before the registry or the protocol is touched', async () => {
        const { dispatcher, protocol, getPackage } = boot();
        expectArityRefusal(await call(dispatcher, 'POST', '/packages', UPGRADE, { overwrite: ['true', 'true'] }), 'overwrite');
        expect(protocol.installPackage).not.toHaveBeenCalled();
        expect(getPackage).not.toHaveBeenCalled();
    });

    it.each(['true', ['true']])('preserves one `overwrite` (%j): the installed id is overwritten', async (overwrite) => {
        const { dispatcher, protocol } = boot();
        const answer = await call(dispatcher, 'POST', '/packages', UPGRADE, { overwrite });
        expect(answer.status).toBe(201);
        expect(protocol.installPackage).toHaveBeenCalledTimes(1);
        expect(protocol.installPackage.mock.calls[0][0].manifest).toEqual(UPGRADE.manifest);
    });

    it('control: without `overwrite` the installed id is still refused 409', async () => {
        const { dispatcher, protocol } = boot();
        const answer = await call(dispatcher, 'POST', '/packages', UPGRADE, {});
        expect(answer.status).toBe(409);
        expect(protocol.installPackage).not.toHaveBeenCalled();
    });
});
