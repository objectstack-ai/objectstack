// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23577] Every write over a sealed, package-held name reads ONE sentence at
 * `PUT /api/v1/meta/:type/:name`, whatever the write meant to do. It replaces
 * [#23406]'s pin of a draft/publish split (a first draft read the edit remedy,
 * a publish-mode `If-None-Match: *` read the create remedy): the door cannot
 * tell a create from an edit, so the sentence advises neither. It states what
 * the door knows and where the names are listed: "'object/NAME' is provided by
 * a managed package and is sealed: it cannot be written here. GET
 * /api/v1/meta/object lists the names in use."
 *
 * Four requests onto one object a code package ships (`object` has no
 * environment overlay, so it is sealed), on both kernel shapes:
 *
 *  - an unpinned draft save;
 *  - the console's generic create: a draft pinned `If-None-Match: *`;
 *  - a publish-mode save pinned `If-None-Match: *`;
 *  - an unpinned publish save.
 *
 * Every refusal is `403 NOT_OVERRIDABLE` and reads the same ruled sentence.
 *
 * Same harness as `rest-meta-managed-seal-hatch.test.ts`: a REAL
 * `ObjectStackProtocolImplementation` over a REAL `SchemaRegistry`, the object
 * registered under a package id the way an artifact loader registers it. The
 * refusal lands before any store is touched, so no driver is booted. The
 * protocol-side pins are in `@objectstack/metadata-protocol`'s
 * `protocol.sealed-remedy-kind.test.ts`.
 */

import { describe, it, expect } from 'vitest';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { SchemaRegistry } from '@objectstack/objectql';
import { RestServer } from './rest-server.js';

const PACKAGE_ID = 'com.example.pkg';
const NAME = 'pkg_ticket';

const OBJECT = {
    name: NAME,
    label: 'Ticket',
    sharingModel: 'private',
    fields: { name: { type: 'text', label: 'Name' } },
};

/** The body a client edits the object with: one field relabelled. */
const EDITED = { ...OBJECT, fields: { name: { type: 'text', label: 'Subject' } } };

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
    registry.registerObject(OBJECT as never, PACKAGE_ID);
    const protocol = new ObjectStackProtocolImplementation(
        { registry, findOne: async () => null } as never, () => new Map(), environmentId,
    );
    const rest = new RestServer(createMockServer() as any, protocol as any, { api: { requireAuth: false } } as any);
    // The write door demands `manage_metadata`; held here, so every 403 below is the SEAL.
    (rest as any).resolveExecCtx = async () => ({ userId: 'u_admin', systemPermissions: ['manage_metadata'] });
    rest.registerRoutes();
    const put = rest.getRoutes().find((r: any) => r.method === 'PUT' && r.path === '/api/v1/meta/:type/:name');
    if (!put) throw new Error('PUT /api/v1/meta/:type/:name is not registered');
    /** `PUT /api/v1/meta/object/pkg_ticket`, with the request's query and headers. */
    const save = async (query: Record<string, string>, headers: Record<string, string>) => {
        const res = makeRes();
        await put.handler({ method: 'PUT', params: { type: 'object', name: NAME }, query, headers, body: EDITED } as any, res);
        return { status: res._status, code: res._json?.code, message: String(res._json?.error ?? '') };
    };
    return { save };
}

/** The ruled sentence for a write over the held object. */
const ONE_SENTENCE = `'object/${NAME}' is provided by a managed package and is sealed: it cannot be written here. `
    + 'GET /api/v1/meta/object lists the names in use.';

const DRAFT = { mode: 'draft' };
const FIRST_WRITE = { 'if-none-match': '*' };

describe('[#23577] every write over a sealed package-shipped item reads one sentence at the REST door', () => {
    for (const environmentId of [undefined, 'env_1']) {
        const kernel = environmentId ? 'environment' : 'host-config';

        it(`PUT draft and publish, unpinned and pinned If-None-Match: *, all read the one sentence (${kernel} kernel)`, async () => {
            const { save } = boot(environmentId);
            const requests = {
                unpinnedDraft: await save(DRAFT, {}),
                consoleCreate: await save(DRAFT, FIRST_WRITE),
                publishPin: await save({}, FIRST_WRITE),
                unpinned: await save({}, {}),
            };
            for (const [request, r] of Object.entries(requests)) {
                expect({ status: r.status, code: r.code }, `${request}: ${r.message}`).toEqual({ status: 403, code: 'NOT_OVERRIDABLE' });
                expect(r.message, request).toBe(ONE_SENTENCE);
            }
        });
    }
});
