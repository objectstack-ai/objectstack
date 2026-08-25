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

        /**
         * [#12195] The compound arity's REGISTRATIONS, not calls to them. These
         * used to be `compoundGet()` / `compoundPut()`; the arity is retired, so
         * what is assertable now is that nothing is mounted there.
         */
        compoundRoutes: () => ['GET', 'PUT'].map((m) => route(m, COMPOUND_PATH)),
        metaRouteKeys: () => (rest as any).getRoutes()
            .map((r: any) => `${String(r.method).toUpperCase()} ${r.path}`)
            .filter((k: string) => k.includes('/api/v1/meta')),
        del: async (query: Record<string, unknown> = {}) => {
            const res = mockRes();
            await route('DELETE', SINGLE_PATH)!.handler(
                { params: { type: 'object', name: 'account' }, query, headers: {} }, res,
            );
            return { res, body: res.json.mock.calls.at(-1)?.[0] };
        },
    };
}

describe('[#7019 / #12195] the compound-name arity is retired', () => {
    /**
     * ⛔ REWORKED, not deleted. #7019 gated `PUT /meta/:type/:section/:name` on
     * `manage_metadata` because leaving it ungated made it a BYPASS of the gate
     * #6603 had just put on its single-segment twin — measured, not reasoned:
     * with #6603 in place the identical ADR-0106 round trip (read a masked
     * object schema, edit a label, PUT it back) still deleted the fields the
     * caller was never allowed to see, through this door.
     *
     * #12176 retired the arity, so the bypass is closed by removal instead of
     * by a second gate. The pin inverts to match: what must stay true is that
     * the door is not mounted, because a re-mounted compound door arrives
     * UNGATED unless whoever mounts it re-derives #6603/#7019 — which is
     * exactly the history above.
     *
     * The surviving door's own capability gate is pinned by
     * `meta-item-save-capability-gate.test.ts`; it is not duplicated here.
     */
    it('⭐ mounts neither GET nor PUT at /meta/:type/:section/:name', () => {
        expect(
            boot({ systemPermissions: [] }).compoundRoutes(),
            'a compound-name arity is mounted again. It was #6603\'s gate bypass '
            + 'until #7019, and a fresh mount does not inherit that gate',
        ).toEqual([undefined, undefined]);
    });

    it('⭐ mounts no compound `:section` arity of any method', () => {
        expect(
            boot({ systemPermissions: [] }).metaRouteKeys().filter((k: string) => k.includes(':section')),
        ).toEqual([]);
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
