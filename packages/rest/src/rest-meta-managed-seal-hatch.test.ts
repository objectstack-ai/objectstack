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
 * hatch used to open, under both spellings of the variable, on both kernel
 * shapes, and the sentence that reaches the client names the managed package.
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
    return { call };
}

function open(variable: 'OS_METADATA_WRITABLE' | 'OBJECTSTACK_METADATA_WRITABLE') {
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
    for (const variable of ['OS_METADATA_WRITABLE', 'OBJECTSTACK_METADATA_WRITABLE'] as const) {
        for (const environmentId of [undefined, 'env_1']) {
            const kernel = environmentId ? 'environment' : 'host-config';
            it(`${variable}=${HATCH}: PUT of each managed item answers 403 NOT_OVERRIDABLE, as with the hatch shut (${kernel} kernel)`, async () => {
                const shut = boot(environmentId);
                const sealed = await Promise.all(EDITS.map(([type, name, body]) => shut.call('PUT', type, name, body)));
                open(variable);
                const { call } = boot(environmentId);
                for (const [i, [type, name, body]] of EDITS.entries()) {
                    const r = await call('PUT', type, name, body);
                    expect({ status: r.status, code: r.code }, `${type}/${name}`).toEqual({ status: 403, code: 'NOT_OVERRIDABLE' });
                    expect(r.message, `${type}/${name}`).toBe(sealed[i].message);
                    expect(r.message, `${type}/${name}`).toContain('managed package');
                }
            });
        }
    }
});

describe('[ADR-0131 D6] the hatch opens no removal of a managed item at the REST door', () => {
    for (const variable of ['OS_METADATA_WRITABLE', 'OBJECTSTACK_METADATA_WRITABLE'] as const) {
        it(`${variable}=${HATCH}: DELETE of a managed flow and a managed object answers 403 NOT_OVERRIDABLE (environment kernel)`, async () => {
            open(variable);
            const { call } = boot('env_1');
            for (const [type, name] of [['flow', 'pkg_flow'], ['object', 'pkg_invoice']] as const) {
                const r = await call('DELETE', type, name);
                expect({ status: r.status, code: r.code }, `${type}/${name}`).toEqual({ status: 403, code: 'NOT_OVERRIDABLE' });
                expect(r.message, `${type}/${name}`).toContain('is provided by a managed package and is sealed against removal');
            }
        });
    }
});
