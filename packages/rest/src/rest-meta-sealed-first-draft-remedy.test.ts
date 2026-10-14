// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23406] A first draft of a sealed, package-shipped item is an EDIT of that
 * item, so the refusal a client reads at `PUT /api/v1/meta/:type/:name?mode=draft`
 * names the edit remedy, whether or not the draft carries the first-write pin.
 *
 * The spec reads a present `null` parent (`If-None-Match: *` on this door) as
 * "no current row of THIS lifecycle" (`SaveMetaItemRequestSchema.parentVersion`).
 * On a draft save that lifecycle is the draft's: the pin says no draft is
 * pending, never that the name is free. Read as a create, it told the author
 * the name was taken and to choose another one, and a client following that
 * remedy authors a second object instead of editing the source artifact.
 *
 * Three requests onto one object a code package ships (`object` has no
 * environment overlay, so it is sealed), on both kernel shapes:
 *
 *  - an unpinned draft save: the edit remedy, as before;
 *  - a first draft pinned `If-None-Match: *`: the edit remedy, the SAME sentence
 *    the unpinned draft reads (it named a free name before this change);
 *  - the control, a create: a publish-mode save pinned `If-None-Match: *`, which
 *    asserts the item has no live row, keeps the create remedy.
 *
 * Every refusal is `403 NOT_OVERRIDABLE`: which requests are refused does not
 * move, only the remedy a refusal names. The remedy KIND is read off what the
 * sentence points at (the type's listing route for a create; the source and
 * redeploy remedy for an edit), never off its wording.
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

type RemedyKind = 'new-name' | 'edit' | 'both' | 'none';

/** The remedy KIND a sentence names — read off what it points at, not off its wording. */
function remedyKind(message: string): RemedyKind {
    const newName = message.includes('GET /api/v1/meta/object');
    const edit = /\bredeploy\b/.test(message) || /\bsource\b/.test(message);
    if (newName && edit) return 'both';
    if (newName) return 'new-name';
    return edit ? 'edit' : 'none';
}

const DRAFT = { mode: 'draft' };
const FIRST_WRITE = { 'if-none-match': '*' };

describe('[#23406] a first draft of a sealed package-shipped item names the edit remedy at the REST door', () => {
    for (const environmentId of [undefined, 'env_1']) {
        const kernel = environmentId ? 'environment' : 'host-config';

        it(`PUT ?mode=draft, unpinned and pinned If-None-Match: *, both read the edit remedy; a pinned create keeps the create remedy (${kernel} kernel)`, async () => {
            const { save } = boot(environmentId);
            const unpinned = await save(DRAFT, {});
            const firstDraft = await save(DRAFT, FIRST_WRITE);
            const create = await save({}, FIRST_WRITE);

            // The verdict does not move: one code and one status for all three.
            for (const r of [unpinned, firstDraft, create]) {
                expect({ status: r.status, code: r.code }, r.message).toEqual({ status: 403, code: 'NOT_OVERRIDABLE' });
            }
            expect({
                unpinnedDraft: remedyKind(unpinned.message),
                firstDraft: remedyKind(firstDraft.message),
                create: remedyKind(create.message),
            }).toEqual({ unpinnedDraft: 'edit', firstDraft: 'edit', create: 'new-name' });
            // One edit sentence: the pin changes nothing about the remedy a draft reads.
            expect(firstDraft.message).toBe(unpinned.message);
            // Both name the item the client addressed.
            for (const r of [firstDraft, create]) expect(r.message).toContain(`object/${NAME}`);
        });
    }
});
