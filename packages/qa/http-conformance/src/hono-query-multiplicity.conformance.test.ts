// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23214] Through a REAL `createHonoApp` host, a single-valued query name
 * supplied twice is refused by the dispatcher's arity rules — the composed-host
 * pin.
 *
 * ## What this pins
 *
 * A host that mounts only `@objectstack/hono`'s `${prefix}/*` catch-all has no
 * `RestServer` and no explicit dispatcher mounts: every request below goes
 * catch-all → `HttpDispatcher.dispatch()` → the domain registry → the domain.
 * The catch-all used to flatten a repeated name to its LAST value, so the
 * dispatcher's arity refusals — `metaItemQueryRefusal` on the by-name `/meta`
 * doors, `/packages`' list filters, and the `?keepData` guard on
 * `DELETE /packages/:id` — never saw the repeat, and the request was answered
 * with one of the two values the caller sent. Measured on this host before the
 * change: `GET /meta/app/x?package=a&package=b` answered `200` with `getMetaItem`
 * handed `packageId: 'b'`, and `GET /packages?status=installed&status=error`
 * answered `200` with no packages.
 *
 * Each row holds the ANSWER ON THE WIRE — status, nested `error.code`, the
 * named parameter and its count, and that the service was never reached — and
 * each refusal has a single-value control on the same host, asserting what the
 * service received.
 *
 * ## ⚠️ Why this lives HERE and not in `packages/adapters/hono`
 *
 * `packages/adapters/hono/vitest.config.ts` aliases `@objectstack/runtime` to a
 * hand-written stub for its whole suite, and `createHonoApp` imports
 * `HttpDispatcher` from that specifier — so no test in that package can reach
 * the real dispatcher. That package pins the adapter's half (the query SHAPE:
 * `src/hono-query-multiplicity.test.ts`). Here `@objectstack/hono` is aliased to
 * this checkout's adapter SOURCE, and `@objectstack/runtime` is the real
 * package (through its `dist/`, a ledgered pair in
 * `scripts/check-test-source-alias.mjs`), as in the six sibling
 * `hono-*.conformance.test.ts` files. A runtime change reaches these rows only
 * once `@objectstack/runtime` is rebuilt, which is how CI builds the closure.
 *
 * This is not the multiplicity conformance file
 * (`query-multiplicity.conformance.test.ts`), whose `describe.each` takes an
 * `IHttpServer`; `createHonoApp` is not one.
 *
 * ## The one seam that is stubbed
 *
 * WHO the caller is comes from the dispatcher's identity step
 * (`timedResolveExecutionContext`), replaced on the prototype (the instance
 * `createHonoApp` constructs for itself is the one that runs) with an author
 * holding `manage_metadata`. Everything after identity — the catch-all, the
 * registry, the domain, the refusal, the adapter's rendering — is real code.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { LiteKernel } from '@objectstack/core';
import { HttpDispatcher } from '@objectstack/runtime';
import { createHonoApp } from '@objectstack/hono';

const PREFIX = '/api/v1';
const PKG = 'com.acme.app';
const AUTHOR = { userId: 'u_author', isSystem: false, systemPermissions: ['manage_metadata', 'studio.access'] };

/**
 * A real `LiteKernel` carrying what these doors consult — the package registry
 * (`objectql`), a recording `protocol`, and `security` for the `/meta` item
 * read's gate — and the REAL `createHonoApp` over it.
 *
 * The registry is a three-method double over one installed package
 * (`getAllPackages`, `getPackage`, `uninstallPackage` — every call these rows'
 * `/packages` branches make, `isWritablePackage` included): the rows assert
 * what the DOMAIN answers through the adapter, not what a registry does, and
 * the domain's own pins over a real `SchemaRegistry` live in
 * `packages/runtime/src/domains/packages-write-flag-arity.test.ts`.
 */
async function boot() {
    const installed = new Map<string, any>([[PKG, {
        manifest: { id: PKG, name: PKG, namespace: 'app', version: '1.0.0', type: 'app' },
        status: 'installed',
        enabled: true,
    }]]);
    const registry = {
        getAllPackages: () => [...installed.values()],
        getPackage: (id: string) => installed.get(id),
        uninstallPackage: (id: string) => installed.delete(id),
    };
    const protocol = {
        getMetaItem: vi.fn(async ({ type, name }: any) => ({ type, name, item: { name, label: 'CRM' } })),
        deletePackage: vi.fn(async (_r: any) => ({ success: true })),
    };
    const kernel = new LiteKernel();
    kernel.use({
        metadata: { name: 'test-query-multiplicity-services', version: '1.0.0' },
        init: (c: any) => {
            c.registerService('objectql', { registry });
            c.registerService('protocol', protocol);
            c.registerService('security', { resolvePermissionSetNames: async () => [] });
        },
    } as any);
    await kernel.bootstrap();

    vi.spyOn(HttpDispatcher.prototype as any, 'timedResolveExecutionContext')
        .mockImplementation(async () => ({ ...AUTHOR }));

    const app = createHonoApp({ kernel: kernel as any, prefix: PREFIX, cors: false });
    const send = async (method: string, path: string) => {
        const res = await app.request(`http://localhost${PREFIX}${path}`, { method });
        const text = await res.text();
        return { status: res.status, body: JSON.parse(text) };
    };
    return { send, protocol };
}

afterEach(() => { vi.restoreAllMocks(); });

/** The dispatcher's multiplicity refusal, as this host renders it. */
function expectRepeatRefused(answer: { status: number; body: any }, name: string, count = 2): void {
    expect(answer.status, JSON.stringify(answer.body)).toBe(400);
    expect(answer.body?.success).toBe(false);
    expect(answer.body?.error?.code).toBe('VALIDATION_ERROR');
    expect(answer.body?.error?.message).toContain(`"${name}" query parameter was supplied ${count} times`);
}

const packageIds = (answer: { body: any }): string[] =>
    (answer.body?.data?.packages ?? []).map((p: any) => p.manifest.id);

describe('[#23214] a real createHonoApp host refuses a repeated single-valued name', () => {
    it('GET /meta/:type/:name — a repeated `package` is refused before the item is read', async () => {
        const { send, protocol } = await boot();
        expectRepeatRefused(await send('GET', '/meta/app/crm?package=a&package=b'), 'package');
        expect(protocol.getMetaItem).not.toHaveBeenCalled();
    });

    it('GET /meta/:type/:name — control: one `package` is read as that package', async () => {
        const { send, protocol } = await boot();
        const answer = await send('GET', '/meta/app/crm?package=a');
        expect(answer.status).toBe(200);
        expect(protocol.getMetaItem).toHaveBeenCalledTimes(1);
        expect(protocol.getMetaItem.mock.calls[0][0]).toMatchObject({ type: 'app', name: 'crm', packageId: 'a' });
    });

    it.each([
        ['status', '?status=installed&status=error'],
        ['enabled', '?enabled=true&enabled=false'],
    ])('GET /packages — a repeated `%s` is refused', async (name, search) => {
        const { send } = await boot();
        expectRepeatRefused(await send('GET', `/packages${search}`), name);
    });

    it('GET /packages — control: one `status` filters', async () => {
        const { send } = await boot();
        const answer = await send('GET', '/packages?status=installed');
        expect(answer.status).toBe(200);
        expect(packageIds(answer)).toEqual([PKG]);
    });

    it('DELETE /packages/:id — a repeated `keepData` is refused, and nothing is deleted', async () => {
        const { send, protocol } = await boot();
        expectRepeatRefused(await send('DELETE', `/packages/${PKG}?keepData=true&keepData=true`), 'keepData');
        expect(protocol.deletePackage).not.toHaveBeenCalled();
    });

    it('DELETE /packages/:id — control: one `keepData=true` reaches deletePackage as keepData', async () => {
        const { send, protocol } = await boot();
        const answer = await send('DELETE', `/packages/${PKG}?keepData=true`);
        expect(answer.status).toBe(200);
        expect(protocol.deletePackage.mock.calls.map((c) => c[0])).toEqual([{ packageId: PKG, keepData: true }]);
    });
});
