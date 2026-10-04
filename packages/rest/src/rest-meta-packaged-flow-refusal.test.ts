// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#20819, ADR-0126 §2] `PUT` / `DELETE /api/v1/meta/flow/:name` on a PACKAGED
 * flow — the refusal a client actually reads names Regime C's sanctioned paths.
 *
 * ADR-0126 §2: in a Regime C type "the packaged base is locked — in-place edit
 * refused loudly at the write door, the refusal naming the sanctioned path".
 * For a flow those paths are the clone under a new name (§7.1,
 * `POST /api/v1/automation/:name/clone`) and the enable/disable switch (§7.2,
 * `POST /api/v1/automation/:name/toggle`, operator-gated per §5). The sentence
 * is the metadata protocol's, chosen per regime there; the protocol-side pins
 * are `packages/metadata-protocol/src/protocol.packaged-base-refusal.test.ts`.
 *
 * This file answers the half a protocol-level test cannot: the REAL
 * `/meta/:type/:name` routes relay that sentence whole — `403`,
 * `NOT_OVERRIDABLE`, clone and switch named, the `OS_METADATA_WRITABLE` hatch
 * not — past the door's 500-character client-message bound, which truncates the
 * tail (where the ADR citation sits). And a type with no declared regime
 * (`page`) reads the sentence it always read (the control).
 *
 * The protocol is a REAL `ObjectStackProtocolImplementation` over a REAL
 * `SchemaRegistry`, the packaged items registered under a package id the way
 * an artifact loader registers them. Both refusals land before any store is
 * touched, so no driver is booted. `DELETE` runs on an environment kernel: on a
 * host-config kernel the `/meta` removal of a packaged base with no overlay row
 * is a no-op that leaves the artifact standing, never this refusal.
 */

import { describe, it, expect } from 'vitest';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { SchemaRegistry } from '@objectstack/objectql';
import { RestServer } from './rest-server.js';

const PACKAGE_ID = 'com.example.pkg';
const PACKAGED_FLOW = 'pkg_alert_flow';
const PACKAGED_PAGE = 'pkg_home_page';

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

function boot(environmentId: string | undefined) {
    const registry = new SchemaRegistry({ multiTenant: false, collisionPolicy: 'error' });
    registry.registerItem(
        'flow', { name: PACKAGED_FLOW, label: 'Alert', type: 'autolaunched', nodes: [], edges: [] }, 'name', PACKAGE_ID,
    );
    registry.registerItem('page', { name: PACKAGED_PAGE, label: 'Home' }, 'name', PACKAGE_ID);
    const protocol = new ObjectStackProtocolImplementation(
        { registry, findOne: async () => null } as never, () => new Map(), environmentId,
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
    const call = async (method: 'PUT' | 'DELETE', type: string, name: string, body?: unknown) => {
        const res = makeRes();
        await route(method).handler({ method, params: { type, name }, query: {}, headers: {}, body } as any, res);
        // The door's 4xx envelope: `code` beside the client-facing `error` text.
        return { status: res._status, code: res._json?.code, message: res._json?.error };
    };
    return { call };
}

const expectRegimeC = (message: unknown) => {
    const text = String(message);
    expect(text).toContain('POST /api/v1/automation/:name/clone');
    expect(text).toContain('POST /api/v1/automation/:name/toggle');
    expect(text).toContain('docs/adr/0126-packaged-metadata-customization-model.md');
    expect(text).not.toContain('OS_METADATA_WRITABLE');
    // Arrived whole: the REST door truncates a client message with a trailing ellipsis.
    expect(text.endsWith('.md.')).toBe(true);
};

describe('PUT / DELETE /api/v1/meta/flow/:name on a packaged flow — the refusal names clone and the switch', () => {
    for (const environmentId of [undefined, 'env_1']) {
        it(`PUT answers 403 NOT_OVERRIDABLE naming clone and toggle, no hatch (${environmentId ? 'environment' : 'host-config'} kernel)`, async () => {
            const { call } = boot(environmentId);
            const r = await call('PUT', 'flow', PACKAGED_FLOW, { name: PACKAGED_FLOW, label: 'Changed in place' });
            expect(r.status).toBe(403);
            expect(r.code).toBe('NOT_OVERRIDABLE');
            expectRegimeC(r.message);
        });
    }

    it('DELETE answers 403 NOT_OVERRIDABLE naming clone and toggle, no hatch (environment kernel)', async () => {
        const { call } = boot('env_1');
        const r = await call('DELETE', 'flow', PACKAGED_FLOW);
        expect(r.status).toBe(403);
        expect(r.code).toBe('NOT_OVERRIDABLE');
        expectRegimeC(r.message);
    });

    it('control: a packaged `page` (no declared regime) reads the sentence it always read', async () => {
        const { call } = boot('env_1');
        const r = await call('PUT', 'page', PACKAGED_PAGE, { name: PACKAGED_PAGE, label: 'Changed in place' });
        expect(r.status).toBe(403);
        expect(r.code).toBe('NOT_OVERRIDABLE');
        expect(r.message).toBe(
            `Metadata item 'page/${PACKAGED_PAGE}' is provided by a code package `
            + 'and the type has not opted into per-org overlay writes (allowOrgOverride=false). '
            + 'Edit the source artifact and redeploy, or set OS_METADATA_WRITABLE to grant a runtime escape hatch. '
            + 'See docs/adr/0005-metadata-customization-overlay.md.',
        );
    });
});
