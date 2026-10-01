// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20910, ADR-0126 §2 / §3] `PUT` / `DELETE /api/v1/meta/:type/:name` on a
 * PACKAGED action and a PACKAGED permission set — the refusal a client actually
 * reads names that type's OWN sanctioned path, not the `OS_METADATA_WRITABLE`
 * hatch and not a redeploy.
 *
 * ADR-0126 §3 puts both in Regime C beside `flow`, and §2 requires the Regime C
 * refusal to name the sanctioned path. Each type's row in the metadata
 * protocol's regime table supplies its routes, so the two read differently from
 * the flow and from each other:
 *
 *  - an ACTION has the activation switch (§8 item 2,
 *    `POST /api/v1/actions/_activation/:object/:action`) and no clone — the
 *    action-clone half is not chartered;
 *  - a PERMISSION SET has its clone (§8 item 3, the "Clone" action, which posts
 *    to `POST /api/v1/data/sys_permission_set`) and no switch named here.
 *
 * The protocol-side pins are
 * `packages/metadata-protocol/src/protocol.packaged-base-refusal.test.ts`; this
 * file answers the half a protocol-level test cannot: the REAL `/meta` routes
 * relay the sentence whole — `403`, `NOT_OVERRIDABLE`, the path named, no hatch
 * — past the door's 500-character client-message bound, which truncates the
 * tail (where the routes and the ADR citation sit).
 *
 * Same harness as `rest-meta-packaged-flow-refusal.test.ts`: a REAL
 * `ObjectStackProtocolImplementation` over a REAL `SchemaRegistry`, the packaged
 * items registered under a package id the way an artifact loader registers
 * them, and that package booted as code (`manifests`), so it is read-only. The
 * refusals land before any store is touched. Three doors, one table:
 *
 *  - an ENVIRONMENT kernel, where `saveMetaItem` / `deleteMetaItem` ask the
 *    protocol's package door;
 *  - [#20910] a HOST-CONFIG kernel (no environment id — the shape the default
 *    `pnpm dev` boot measured), where that door is not asked and the write is
 *    refused one layer down by `SysMetadataRepository.assertAllowed`'s type
 *    door — with the same row-built sentence;
 *  - [#20910] a write NAMING the read-only base (`?package=`), refused by the
 *    named-base `ITEM_LOCKED` limb, which speaks for the row with the hatch
 *    closed.
 */

import { describe, it, expect } from 'vitest';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { SchemaRegistry } from '@objectstack/objectql';
import { RestServer } from './rest-server.js';

const PACKAGE_ID = 'com.example.pkg';
const PACKAGED_ACTION = 'pkg_approve';
const PACKAGED_PERMISSION = 'pkg_perm';
/** 88 characters — the longest name the flow row (411 before the name) still delivers whole. */
const LONG_ACTION = `pkg_${'x'.repeat(84)}`;

function createMockServer() {
    const noop = () => {};
    return { get: noop, post: noop, put: noop, delete: noop, patch: noop, use: noop, listen: async () => {}, close: async () => {} };
}

function makeRes() {
    const res: any = {
        write: () => true, end: () => {},
        header: () => res, setHeader: () => res,
        status: (code: number) => { res._status = code; return res; },
        json: (body: any) => { res._json = body; return res; },
    };
    return res;
}

function boot(environmentId: string | undefined = 'env_1') {
    const registry = new SchemaRegistry({ multiTenant: false, collisionPolicy: 'error' });
    for (const name of [PACKAGED_ACTION, LONG_ACTION]) {
        registry.registerItem('action', { name, label: 'Approve', type: 'script', target: 'approve_fn' }, 'name', PACKAGE_ID);
    }
    registry.registerItem('permission', { name: PACKAGED_PERMISSION, label: 'Contributor', objects: {} }, 'name', PACKAGE_ID);
    const protocol = new ObjectStackProtocolImplementation(
        { registry, findOne: async () => null, manifests: new Map([[PACKAGE_ID, {}]]) } as never,
        () => new Map(), environmentId,
    );
    const rest = new RestServer(createMockServer() as any, protocol as any, { api: { requireAuth: false } } as any);
    // The write doors demand `manage_metadata`; held here, so every 403 below is the LOCK.
    (rest as any).resolveExecCtx = async () => ({ userId: 'u_admin', systemPermissions: ['manage_metadata'] });
    rest.registerRoutes();
    const route = (method: string) => {
        const found = rest.getRoutes().find((r: any) => r.method === method && r.path === '/api/v1/meta/:type/:name');
        if (!found) throw new Error(`${method} /api/v1/meta/:type/:name is not registered`);
        return found;
    };
    const call = async (method: 'PUT' | 'DELETE', type: string, name: string, body?: unknown, query: Record<string, string> = {}) => {
        const res = makeRes();
        await route(method).handler({ method, params: { type, name }, query, headers: {}, body } as any, res);
        // The door's 4xx envelope: `code` beside the client-facing `error` text.
        return { status: res._status, code: res._json?.code, message: res._json?.error };
    };
    return { call };
}

/** What every Regime C refusal owes at the wire, whatever the type. */
const expectRegimeC = (message: unknown, type: string, name: string, operation: 'save' | 'delete') => {
    const text = String(message);
    expect(text.startsWith(
        `Metadata item '${type}/${name}' is provided by a code package, and its packaged base is locked `
        + (operation === 'delete' ? 'against removal. ' : 'against in-place edits. '),
    )).toBe(true);
    expect(text).not.toContain('OS_METADATA_WRITABLE');
    expect(text).not.toContain('redeploy');
    // Arrived whole: the REST door truncates a client message with a trailing ellipsis.
    expect(text.endsWith('See docs/adr/0126-packaged-metadata-customization-model.md.')).toBe(true);
    return text;
};

const ACTION_SWITCH = 'Switch it off (POST /api/v1/actions/_activation/:object/:action, body {enabled: false}';
const PERMISSION_CLONE = 'Clone it under a new name to customize it (the "Clone" action on the permission set, '
    + 'or POST /api/v1/data/sys_permission_set with a new name).';

describe('PUT / DELETE /api/v1/meta/action/:name on a packaged action — the refusal names the activation switch', () => {
    it('PUT answers 403 NOT_OVERRIDABLE naming the switch, no clone, no hatch', async () => {
        const { call } = boot();
        const r = await call('PUT', 'action', PACKAGED_ACTION, {
            name: PACKAGED_ACTION, label: 'Changed in place', type: 'script', target: 'approve_fn',
        });
        expect(r.status).toBe(403);
        expect(r.code).toBe('NOT_OVERRIDABLE');
        const text = expectRegimeC(r.message, 'action', PACKAGED_ACTION, 'save');
        expect(text).toContain(ACTION_SWITCH);
        expect(text.toLowerCase()).not.toContain('clone');
    });

    it('DELETE answers 403 NOT_OVERRIDABLE naming the switch too — a removal names a path', async () => {
        const { call } = boot();
        const r = await call('DELETE', 'action', PACKAGED_ACTION);
        expect(r.status).toBe(403);
        expect(r.code).toBe('NOT_OVERRIDABLE');
        const text = expectRegimeC(r.message, 'action', PACKAGED_ACTION, 'delete');
        expect(text).toContain(ACTION_SWITCH);
    });

    it('an 88-character action name still arrives whole, ADR citation included', async () => {
        const { call } = boot();
        expect(LONG_ACTION).toHaveLength(88);
        const r = await call('DELETE', 'action', LONG_ACTION);
        expect(r.code).toBe('NOT_OVERRIDABLE');
        expectRegimeC(r.message, 'action', LONG_ACTION, 'delete');
    });
});

describe('PUT /api/v1/meta/permission/:name on a packaged permission set — the refusal names its clone', () => {
    it('PUT answers 403 NOT_OVERRIDABLE naming the clone, no switch, no hatch', async () => {
        const { call } = boot();
        const r = await call('PUT', 'permission', PACKAGED_PERMISSION, {
            name: PACKAGED_PERMISSION, label: 'Changed in place', objects: {},
        });
        expect(r.status).toBe(403);
        expect(r.code).toBe('NOT_OVERRIDABLE');
        const text = expectRegimeC(r.message, 'permission', PACKAGED_PERMISSION, 'save');
        expect(text).toContain(PERMISSION_CLONE);
        expect(text.toLowerCase()).not.toContain('switch it off');
    });

    it('DELETE is not refused on this ground — a permission set\'s overlay removal is repair (the #6960 carve-out)', async () => {
        const { call } = boot();
        const r = await call('DELETE', 'permission', PACKAGED_PERMISSION);
        expect(r.code).not.toBe('NOT_OVERRIDABLE');
        expect(r.status ?? 200).not.toBe(403);
    });
});

const ACTION_BODY = { name: PACKAGED_ACTION, label: 'Changed in place', type: 'script', target: 'approve_fn' };
const PERMISSION_BODY = { name: PACKAGED_PERMISSION, label: 'Changed in place', objects: {} };

describe('[#20910] a host-config kernel — the repository\'s type door answers with the same row-built sentence', () => {
    it('PUT action answers 403 NOT_OVERRIDABLE naming the switch, no hatch', async () => {
        const { call } = boot(undefined);
        const r = await call('PUT', 'action', PACKAGED_ACTION, ACTION_BODY);
        expect(r.status).toBe(403);
        expect(r.code).toBe('NOT_OVERRIDABLE');
        expect(expectRegimeC(r.message, 'action', PACKAGED_ACTION, 'save')).toContain(ACTION_SWITCH);
    });

    it('PUT permission answers 403 NOT_OVERRIDABLE naming the clone, no hatch', async () => {
        const { call } = boot(undefined);
        const r = await call('PUT', 'permission', PACKAGED_PERMISSION, PERMISSION_BODY);
        expect(r.status).toBe(403);
        expect(r.code).toBe('NOT_OVERRIDABLE');
        expect(expectRegimeC(r.message, 'permission', PACKAGED_PERMISSION, 'save')).toContain(PERMISSION_CLONE);
    });
});

describe('[#20910] a write naming the read-only base (?package=) — the named-base ITEM_LOCKED limb names the row\'s path', () => {
    for (const environmentId of [undefined, 'env_1']) {
        const kernel = environmentId ? 'environment' : 'host-config';
        for (const [type, name, body, path] of [
            ['action', PACKAGED_ACTION, ACTION_BODY, ACTION_SWITCH],
            ['permission', PACKAGED_PERMISSION, PERMISSION_BODY, PERMISSION_CLONE],
        ] as const) {
            it(`PUT ${type}?package= answers 403 ITEM_LOCKED with the path and no hatch (${kernel} kernel)`, async () => {
                const { call } = boot(environmentId);
                const r = await call('PUT', type, name, body, { package: PACKAGE_ID });
                expect(r.status).toBe(403);
                expect(r.code).toBe('ITEM_LOCKED');
                const text = String(r.message);
                expect(text.startsWith(
                    `Cannot overlay '${type}' in package '${PACKAGE_ID}': that package is read-only, and its packaged base `
                    + 'is locked against in-place edits. ',
                )).toBe(true);
                expect(text).toContain(path);
                expect(text).not.toContain('OS_METADATA_WRITABLE');
                expect(text).not.toContain('redeploy');
                expect(text.endsWith('See docs/adr/0126-packaged-metadata-customization-model.md.')).toBe(true);
            });
        }
    }
});
