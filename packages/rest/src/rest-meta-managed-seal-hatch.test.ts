// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [ADR-0131 D6] Managed content is sealed — the `OS_METADATA_WRITABLE` hatch no
 * longer opens a write onto, or a removal of, an item a managed package ships,
 * at the REAL `/api/v1/meta/:type/:name` routes.
 *
 * The protocol-side pins are `protocol.packaged-base-refusal.test.ts` and
 * `sys-metadata-repository.package-writability.test.ts` in
 * `@objectstack/metadata-protocol`. This file answers what they cannot: the
 * REST door relays the seal — `403` and `NOT_OVERRIDABLE` — for every type the
 * hatch used to open, on both kernel shapes, and the sentence that reaches the
 * client names the managed package.
 *
 * [#22411] Only `OS_METADATA_WRITABLE` opens the hatch. The legacy spelling
 * `OBJECTSTACK_METADATA_WRITABLE` was removed in 11.0, and the protocol's own
 * copy of the reader kept honouring it until the protocol read the setting
 * through the repository's one reader. Under the legacy spelling alone the
 * hatch is shut at this door: the type listing reports no env override and
 * every PUT and DELETE answers what it answers with nothing set.
 *
 * Same harness as `rest-meta-packaged-flow-refusal.test.ts`: a REAL
 * `ObjectStackProtocolImplementation` over a REAL `SchemaRegistry`, the
 * packaged items registered under a package id the way an artifact loader
 * registers them. Every refusal lands before any store is touched, so no driver
 * is booted. The removals run on an environment kernel, where the removal door
 * is asked before the store; the end-to-end removal readings, the controls
 * (a regime-O overlay, a new flow, the switch, the clone) and the legacy-row
 * cases are pinned on a booted app in
 * `packages/qa/dogfood/test/managed-content-sealed.dogfood.test.ts`.
 */

import { afterEach, describe, it, expect } from 'vitest';
import { ObjectStackProtocolImplementation, resetEnvWritableMetadataTypes } from '@objectstack/metadata-protocol';
import { SchemaRegistry } from '@objectstack/objectql';
import { RestServer } from './rest-server.js';

const PACKAGE_ID = 'com.example.pkg';
const HATCH = 'flow,object,field,permission,position';

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

const OBJECT = {
    name: 'pkg_invoice',
    label: 'Invoice',
    sharingModel: 'private',
    fields: { name: { type: 'text', label: 'Name' } },
};

function boot(environmentId: string | undefined) {
    const registry = new SchemaRegistry({ multiTenant: false, collisionPolicy: 'error' });
    registry.registerItem('flow', { name: 'pkg_flow', label: 'Alert', type: 'autolaunched', nodes: [], edges: [] }, 'name', PACKAGE_ID);
    registry.registerObject(OBJECT as never, PACKAGE_ID);
    registry.registerItem('permission', { name: 'pkg_perm', label: 'Perm', objects: {} }, 'name', PACKAGE_ID);
    registry.registerItem('position', { name: 'pkg_position', label: 'Position' }, 'name', PACKAGE_ID);
    const protocol = new ObjectStackProtocolImplementation(
        { registry, findOne: async () => null } as never, () => new Map(), environmentId,
    );
    const rest = new RestServer(createMockServer() as any, protocol as any, { api: { requireAuth: false } } as any);
    // The write doors demand `manage_metadata`; held here, so every 403 below is the SEAL.
    (rest as any).resolveExecCtx = async () => ({ userId: 'u_admin', systemPermissions: ['manage_metadata'] });
    rest.registerRoutes();
    const route = (method: string) => {
        const found = rest.getRoutes().find((r: any) => r.method === method && r.path === '/api/v1/meta/:type/:name');
        if (!found) throw new Error(`${method} /api/v1/meta/:type/:name is not registered`);
        return found;
    };
    const call = async (method: 'PUT' | 'DELETE', type: string, name: string, body?: unknown) => {
        const res = makeRes();
        await route(method).handler({ method, params: { type, name }, query: {}, headers: {}, body } as any, res);
        return { status: res._status, code: res._json?.code, message: String(res._json?.error ?? '') };
    };
    /** `GET /api/v1/meta/types` — each named type's hatch reading, as the listing reports it. */
    const listing = async (types: readonly string[]) => {
        const found = rest.getRoutes().find((r: any) => r.method === 'GET' && r.path === '/api/v1/meta/types');
        if (!found) throw new Error('GET /api/v1/meta/types is not registered');
        const res = makeRes();
        await found.handler({ method: 'GET', params: {}, query: {}, headers: {} } as any, res);
        const entries: any[] = res._json?.entries ?? [];
        return Object.fromEntries(types.map((t) => {
            const e = entries.find((x) => x.type === t);
            return [t, e ? { allowOrgOverride: e.allowOrgOverride, overrideSource: e.overrideSource } : 'absent'];
        }));
    };
    return { call, listing };
}

function open(variable: 'OS_METADATA_WRITABLE' | 'OBJECTSTACK_METADATA_WRITABLE' = 'OS_METADATA_WRITABLE') {
    process.env[variable] = HATCH;
    ObjectStackProtocolImplementation.resetEnvWritableCache();
    resetEnvWritableMetadataTypes();
}

afterEach(() => {
    delete process.env.OS_METADATA_WRITABLE;
    delete process.env.OBJECTSTACK_METADATA_WRITABLE;
    ObjectStackProtocolImplementation.resetEnvWritableCache();
    resetEnvWritableMetadataTypes();
});

/** The managed items the hatch used to open, and the PUT body each one is edited with. */
const EDITS: ReadonlyArray<readonly [string, string, Record<string, unknown>]> = [
    ['flow', 'pkg_flow', { name: 'pkg_flow', label: 'Edited', type: 'autolaunched', nodes: [], edges: [] }],
    ['object', 'pkg_invoice', { ...OBJECT, fields: { name: { type: 'text', label: 'Renamed field' } } }],
    ['field', 'pkg_invoice.name', { name: 'name', type: 'text', label: 'Renamed field' }],
    ['permission', 'pkg_perm', { name: 'pkg_perm', label: 'Edited', objects: {} }],
    ['position', 'pkg_position', { name: 'pkg_position', label: 'Edited' }],
];

describe('[ADR-0131 D6] the hatch opens no PUT onto a managed item at the REST door', () => {
    for (const environmentId of [undefined, 'env_1']) {
        const kernel = environmentId ? 'environment' : 'host-config';
        it(`OS_METADATA_WRITABLE=${HATCH}: PUT of each managed item answers 403 NOT_OVERRIDABLE, as with the hatch shut (${kernel} kernel)`, async () => {
            const shut = boot(environmentId);
            const sealed = await Promise.all(EDITS.map(([type, name, body]) => shut.call('PUT', type, name, body)));
            open();
            const { call } = boot(environmentId);
            for (const [i, [type, name, body]] of EDITS.entries()) {
                const r = await call('PUT', type, name, body);
                expect({ status: r.status, code: r.code }, `${type}/${name}`).toEqual({ status: 403, code: 'NOT_OVERRIDABLE' });
                expect(r.message, `${type}/${name}`).toBe(sealed[i].message);
                expect(r.message, `${type}/${name}`).toContain('managed package');
            }
        });
    }
});

describe('[ADR-0131 D6] the hatch opens no removal of a managed item at the REST door', () => {
    it(`OS_METADATA_WRITABLE=${HATCH}: DELETE of a managed flow and a managed object answers 403 NOT_OVERRIDABLE (environment kernel)`, async () => {
        open();
        const { call } = boot('env_1');
        for (const [type, name] of [['flow', 'pkg_flow'], ['object', 'pkg_invoice']] as const) {
            const r = await call('DELETE', type, name);
            expect({ status: r.status, code: r.code }, `${type}/${name}`).toEqual({ status: 403, code: 'NOT_OVERRIDABLE' });
            expect(r.message, `${type}/${name}`).toContain('is provided by a managed package and is sealed against removal');
        }
    });
});

describe('[#22411] the removed spelling OBJECTSTACK_METADATA_WRITABLE is not read: the hatch is shut at the REST door', () => {
    // The types this registry lists (`field` is named in the variable but is no registered type here:
    // its items live inside an object, so the listing carries no entry for it).
    const HATCH_TYPES = ['flow', 'object', 'permission', 'position'] as const;
    const SHUT = { allowOrgOverride: false, overrideSource: 'registry' };

    for (const environmentId of [undefined, 'env_1']) {
        const kernel = environmentId ? 'environment' : 'host-config';
        it(`OBJECTSTACK_METADATA_WRITABLE=${HATCH}: the listing reports no env override, and every ${environmentId ? 'PUT and DELETE' : 'PUT'} answers as with nothing set (${kernel} kernel)`, async () => {
            const shut = boot(environmentId);
            const shutPuts = await Promise.all(EDITS.map(([type, name, body]) => shut.call('PUT', type, name, body)));
            // Removals only on an environment kernel, where the removal door is asked before the store
            // (this harness boots none) — the same scope as the removal pins above.
            const REMOVALS = environmentId ? EDITS : [];
            const shutDeletes = await Promise.all(REMOVALS.map(([type, name]) => shut.call('DELETE', type, name)));
            expect(await shut.listing(HATCH_TYPES)).toEqual(Object.fromEntries(HATCH_TYPES.map((t) => [t, SHUT])));

            open('OBJECTSTACK_METADATA_WRITABLE');
            const legacy = boot(environmentId);
            expect(await legacy.listing(HATCH_TYPES)).toEqual(Object.fromEntries(HATCH_TYPES.map((t) => [t, SHUT])));
            for (const [i, [type, name, body]] of EDITS.entries()) {
                expect(await legacy.call('PUT', type, name, body), `PUT ${type}/${name}`).toEqual(shutPuts[i]);
            }
            for (const [i, [type, name]] of REMOVALS.entries()) {
                expect(await legacy.call('DELETE', type, name), `DELETE ${type}/${name}`).toEqual(shutDeletes[i]);
            }
        });

        it(`control — OS_METADATA_WRITABLE=${HATCH}: the listing reports the env override for the same types (${kernel} kernel)`, async () => {
            open();
            const { listing } = boot(environmentId);
            expect(await listing(HATCH_TYPES)).toEqual(
                Object.fromEntries(HATCH_TYPES.map((t) => [t, { allowOrgOverride: true, overrideSource: 'env' }])),
            );
        });
    }
});
