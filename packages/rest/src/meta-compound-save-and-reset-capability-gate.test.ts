// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#7019] The two REST metadata-write doors #6603 did not gate:
 *
 *   1. `PUT /api/v1/meta/:type/:section/:name` — the compound-name save;
 *   2. `DELETE /api/v1/meta/:type/:name`      — the reset-to-artifact-default.
 *
 * Both now demand the `manage_metadata` authoring capability (ADR-0066 D1), by
 * the same mechanism as the single-name `PUT` next door
 * (`meta-item-save-capability-gate.test.ts`) and `POST /meta/_migrate-stored`.
 *
 * ## Why these two are one file but not one argument
 *
 * The compound `PUT` is the same defect as #6603's, one route over: it was
 * MEASURED that with #6603's gate in place, the identical ADR-0106
 * GET → edit → PUT still round-tripped a masked object schema back into the
 * store through this door, deleting the fields the caller was never allowed to
 * see. The headline case below drives exactly that sequence.
 *
 * The `DELETE` is a different argument reaching the same fix. Nothing is masked
 * and nothing is round-tripped — it discards a customization overlay outright.
 * What was wrong there is simply that an authenticated session holding no
 * authoring capability could reset any customized metadata item in the
 * deployment (and, with `?dropStorage=true`, drop the object's table with it).
 * Keeping the two arguments distinct matters: a reader who takes the masking
 * story as the reason for the DELETE gate would conclude, wrongly, that a
 * caller with unmasked reads needs no gate.
 *
 * ## What the refusal cases assert
 *
 * `status` AND `code` (the ADR-0112 envelope), and — the load-bearing part —
 * that the target function was **never entered**, checked against the STORE.
 * "Wrote/deleted first, refused second" is precisely the failure worth
 * guarding, and it passes any status-only assertion. This route answers by
 * *sending* rather than throwing, so a `toThrow`-shaped assertion could not
 * separate "refused with the wrong envelope" from "did not refuse at all".
 */

import { describe, it, expect, vi } from 'vitest';
import { FLS_CONTRACT_OBJECT } from '@objectstack/metadata-core/testing';
import { RestServer } from './rest-server';

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));

/** The four fields `FLS_CONTRACT_OBJECT` declares, sorted. */
const ALL_FIELDS = ['bonus_formula', 'id', 'name', 'salary_grade'];
/** What the security double lets a restricted caller read. */
const READABLE_TO_RESTRICTED = ['id', 'name'];

const COMPOUND_PATH = '/api/v1/meta/:type/:section/:name';
const SINGLE_PATH = '/api/v1/meta/:type/:name';
/** The compound name the section + name params spell. */
const COMPOUND_NAME = 'crm/account';

function mockServer() {
    return {
        get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(),
        use: vi.fn(), listen: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined),
    };
}

function mockRes() {
    const res: any = {
        statusCode: 200,
        json: vi.fn(function (this: any, body: any) { this._body = body; return this; }),
        send: vi.fn(),
        status: vi.fn(function (this: any, code: number) { this.statusCode = code; return this; }),
        header: vi.fn(),
    };
    return res;
}

interface BootOptions {
    /** The caller, as `resolveExecCtx` resolves it. `undefined` = anonymous. */
    context: Record<string, unknown> | undefined;
    /** What `security.getMetadataReadableFields` answers; omit for no security service. */
    readable?: readonly string[];
    /** Drop `saveMetaItem` / `deleteMetaItem` from the protocol (the 501 kernel). */
    withoutWriters?: boolean;
}

/**
 * Boot both routes over a protocol backed by a REAL in-memory store, so the
 * compound GET → edit → PUT sequence actually round-trips, and so a refused
 * DELETE can be checked against the store rather than only against the answer.
 */
function boot(opts: BootOptions) {
    const stored: Record<string, any> = {
        [COMPOUND_NAME]: copy(FLS_CONTRACT_OBJECT as unknown as Record<string, unknown>),
        account: copy(FLS_CONTRACT_OBJECT as unknown as Record<string, unknown>),
    };
    /** The customization overlay rows `DELETE` exists to remove (ADR-0005). */
    const overlays = new Set<string>(['account']);

    const saveMetaItem = vi.fn(async ({ name, item }: any) => {
        stored[name] = copy(item);
        return { success: true, type: 'object', name };
    });

    const deleteMetaItem = vi.fn(async ({ name }: any) => {
        overlays.delete(name);
        delete stored[name];
        return { success: true, reset: true };
    });

    const protocol: any = {
        getDiscovery: vi.fn().mockResolvedValue({ version: 'v0', routes: { data: '', metadata: '', ui: '', auth: '/auth' } }),
        getMetaTypes: vi.fn().mockResolvedValue([]),
        getMetaItems: vi.fn(async () => Object.values(stored).map(copy)),
        getMetaItem: vi.fn(async ({ type, name }: any) => ({ type, name, item: copy(stored[name]), lock: 'none' })),
        findData: vi.fn().mockResolvedValue([]),
        getData: vi.fn().mockResolvedValue({}),
        createData: vi.fn().mockResolvedValue({ id: '1' }),
        updateData: vi.fn().mockResolvedValue({}),
        deleteData: vi.fn().mockResolvedValue({ success: true }),
    };
    if (!opts.withoutWriters) {
        protocol.saveMetaItem = saveMetaItem;
        protocol.deleteMetaItem = deleteMetaItem;
    }

    const security = opts.readable === undefined ? undefined : {
        getReadableFields: async () => [...opts.readable!],
        getMetadataReadableFields: async () => [...opts.readable!],
    };

    const rest = new RestServer(
        mockServer() as any,
        protocol as any,
        { api: { requireAuth: false } } as any,
        undefined, undefined, undefined, undefined, undefined, undefined, undefined,
        undefined, undefined, undefined, undefined, undefined, undefined, undefined,
        security ? (async () => security as any) : undefined,
    );
    (rest as any).resolveExecCtx = async () => opts.context;
    rest.registerRoutes();

    const route = (method: string, path: string) => (rest as any).getRoutes().find(
        (r: any) => r.method === method && r.path === path,
    );

    return {
        saveMetaItem,
        deleteMetaItem,
        /** Field names of the COMPOUND-named document in the store. */
        compoundFields: () => Object.keys(stored[COMPOUND_NAME].fields ?? {}).sort(),
        compoundLabel: () => stored[COMPOUND_NAME].label,
        /** Whether the single-name item's customization overlay still exists. */
        hasOverlay: () => overlays.has('account'),

        compoundGet: async () => {
            const res = mockRes();
            await route('GET', COMPOUND_PATH)!.handler(
                { params: { type: 'object', section: 'crm', name: 'account' }, query: {}, headers: {} }, res,
            );
            return { res, body: res.json.mock.calls.at(-1)?.[0] };
        },
        compoundPut: async (item: unknown) => {
            const res = mockRes();
            await route('PUT', COMPOUND_PATH)!.handler(
                { params: { type: 'object', section: 'crm', name: 'account' }, query: {}, headers: {}, body: item }, res,
            );
            return { res, body: res.json.mock.calls.at(-1)?.[0] };
        },
        del: async (query: Record<string, unknown> = {}) => {
            const res = mockRes();
            await route('DELETE', SINGLE_PATH)!.handler(
                { params: { type: 'object', name: 'account' }, query, headers: {} }, res,
            );
            return { res, body: res.json.mock.calls.at(-1)?.[0] };
        },
    };
}

describe('#7019 — compound-name PUT: the ADR-0106 round trip, one route over', () => {
    it('refuses the restricted round-trip write, and the masked fields SURVIVE in the store', async () => {
        const stack = boot({
            context: { userId: 'u_portal', systemPermissions: [] },
            readable: READABLE_TO_RESTRICTED,
        });

        // 1. The compound read is masked — the premise, asserted rather than
        //    assumed so this case cannot go quietly green if masking stops.
        const read = await stack.compoundGet();
        expect(Object.keys(read.body.item.fields).sort()).toEqual(READABLE_TO_RESTRICTED);
        expect(read.body.item.fields).not.toHaveProperty('salary_grade');
        expect(read.body.item.fields).not.toHaveProperty('bonus_formula');

        // 2. The caller edits something unrelated and sends the body back —
        //    the exact sequence that was MEASURED to still lose fields here
        //    after #6603 gated the single-name door.
        const write = await stack.compoundPut({ ...copy(read.body.item), label: 'Account (renamed)' });

        // 3. Refused, with the envelope.
        expect(write.res.statusCode).toBe(403);
        expect(write.body).toMatchObject({ error: { code: 'FORBIDDEN' } });

        // 4. THE POINT: nothing was written.
        expect(stack.saveMetaItem).not.toHaveBeenCalled();
        expect(stack.compoundFields()).toEqual(ALL_FIELDS);
        expect(stack.compoundLabel()).toBe('Account');
    });

    it('the refusal is the gate, not the masking: an UNRESTRICTED but uncapable caller is refused too', async () => {
        // Everything readable ⇒ no field would have been lost. Still refused,
        // because the second reason — any authenticated session could clobber
        // any metadata item — is independent of ADR-0106.
        const stack = boot({ context: { userId: 'u_staff', systemPermissions: [] }, readable: ALL_FIELDS });

        const read = await stack.compoundGet();
        expect(Object.keys(read.body.item.fields).sort()).toEqual(ALL_FIELDS);

        const write = await stack.compoundPut({ ...copy(read.body.item), label: 'clobbered' });
        expect(write.res.statusCode).toBe(403);
        expect(write.body).toMatchObject({ error: { code: 'FORBIDDEN' } });
        expect(stack.compoundLabel()).toBe('Account');
    });

    it('fires BEFORE the protocol is probed, so 403-vs-501 leaks no kernel capability', async () => {
        const stack = boot({ context: { userId: 'u1', systemPermissions: [] }, withoutWriters: true });
        const write = await stack.compoundPut({ name: 'account' });
        // An authorized caller would get 501 here.
        expect(write.res.statusCode).toBe(403);
        expect(write.body).toMatchObject({ error: { code: 'FORBIDDEN' } });
    });

    it('an anonymous caller never reaches the capability gate — 401 from the /meta umbrella', async () => {
        const stack = boot({ context: undefined });
        const write = await stack.compoundPut({ name: 'account' });
        expect(write.res.statusCode).toBe(401);
        expect(stack.saveMetaItem).not.toHaveBeenCalled();
    });

    it.each([
        { held: 'no capabilities at all', systemPermissions: [] as string[], status: 403 },
        { held: '`studio.access` alone — ADR-0106 D4-exempt, but not an authoring capability', systemPermissions: ['studio.access'], status: 403 },
        { held: '`setup.access` alone — this is `organization_admin`', systemPermissions: ['setup.access'], status: 403 },
        { held: '`manage_metadata` alone', systemPermissions: ['manage_metadata'], status: 200 },
        { held: 'the shipped `admin_full_access` shape', systemPermissions: ['manage_metadata', 'studio.access', 'setup.access'], status: 200 },
    ])('$held → $status', async ({ systemPermissions, status }) => {
        const stack = boot({ context: { userId: 'u1', systemPermissions } });
        const write = await stack.compoundPut({ name: 'account', label: 'Account', fields: {} });
        expect(write.res.statusCode).toBe(status);
    });

    it('`isSystem` bypasses, matching every other capability gate on the platform', async () => {
        const stack = boot({ context: { isSystem: true } });
        const write = await stack.compoundPut({ name: 'account', label: 'Account', fields: {} });
        expect(write.res.statusCode).toBe(200);
        expect(stack.saveMetaItem).toHaveBeenCalledTimes(1);
    });

    it('leaves the compound READ alone — this card gates writes', async () => {
        // The read side has its own posture (the ADR-0106 projection asserted
        // in the headline case). Turning this into a blanket gate on the
        // compound route pair would be a different, unruled change.
        const stack = boot({ context: { userId: 'u_portal', systemPermissions: [] }, readable: READABLE_TO_RESTRICTED });
        const read = await stack.compoundGet();
        expect(read.res.statusCode).not.toBe(403);
        expect(Object.keys(read.body.item.fields).sort()).toEqual(READABLE_TO_RESTRICTED);
    });
});

describe('#7019 — DELETE /meta/:type/:name: an ungated reset, not a round trip', () => {
    it('refuses an uncapable caller, and the overlay is STILL THERE', async () => {
        const stack = boot({ context: { userId: 'u_portal', systemPermissions: [] } });

        const res = await stack.del();

        expect(res.res.statusCode).toBe(403);
        expect(res.body).toMatchObject({ error: { code: 'FORBIDDEN' } });
        // THE POINT, and the reason this is not a status-only assertion:
        // "deleted first, refused second" is the failure mode worth guarding,
        // and it answers 403 too.
        expect(stack.deleteMetaItem).not.toHaveBeenCalled();
        expect(stack.hasOverlay()).toBe(true);
    });

    it('refuses the DESTRUCTIVE `?dropStorage=true` form with the same gate', async () => {
        // This variant also tears down the object's physical table, so an
        // ungated door here discards data, not just customization.
        const stack = boot({ context: { userId: 'u_portal', systemPermissions: [] } });

        const res = await stack.del({ dropStorage: 'true' });

        expect(res.res.statusCode).toBe(403);
        expect(res.body).toMatchObject({ error: { code: 'FORBIDDEN' } });
        expect(stack.deleteMetaItem).not.toHaveBeenCalled();
        expect(stack.hasOverlay()).toBe(true);
    });

    it('fires BEFORE the protocol is probed, so 403-vs-501 leaks no kernel capability', async () => {
        const stack = boot({ context: { userId: 'u1', systemPermissions: [] }, withoutWriters: true });
        const res = await stack.del();
        expect(res.res.statusCode).toBe(403);
        expect(res.body).toMatchObject({ error: { code: 'FORBIDDEN' } });
    });

    it('an anonymous caller never reaches the capability gate — 401 from the /meta umbrella', async () => {
        const stack = boot({ context: undefined });
        const res = await stack.del();
        expect(res.res.statusCode).toBe(401);
        expect(stack.deleteMetaItem).not.toHaveBeenCalled();
    });

    it('allows a caller holding `manage_metadata` — the overlay is removed', async () => {
        const stack = boot({ context: { userId: 'u_author', systemPermissions: ['manage_metadata'] } });

        const res = await stack.del();

        expect(res.res.statusCode).toBe(200);
        expect(stack.deleteMetaItem).toHaveBeenCalledTimes(1);
        expect(stack.hasOverlay()).toBe(false);
    });

    it('`isSystem` bypasses, matching every other capability gate on the platform', async () => {
        const stack = boot({ context: { isSystem: true } });
        const res = await stack.del();
        expect(res.res.statusCode).toBe(200);
        expect(stack.deleteMetaItem).toHaveBeenCalledTimes(1);
    });

    it('holding an unrelated capability is not enough', async () => {
        const stack = boot({ context: { userId: 'u_admin', systemPermissions: ['setup.access', 'studio.access'] } });
        const res = await stack.del();
        expect(res.res.statusCode).toBe(403);
        expect(stack.deleteMetaItem).not.toHaveBeenCalled();
        expect(stack.hasOverlay()).toBe(true);
    });
});
