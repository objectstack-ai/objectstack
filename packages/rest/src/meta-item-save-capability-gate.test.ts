// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#6603] `PUT /api/v1/meta/:type/:name` demands the `manage_metadata`
 * authoring capability (ADR-0066 D1) — the same gate, by the same mechanism,
 * that `POST /meta/_migrate-stored` already demands next door.
 *
 * ## What this suite exists to stop
 *
 * ADR-0106 D1 removes an unreadable field **whole** from a served object
 * schema, and this route persists the body it is handed. Until this gate, a
 * non-exempt caller's most ordinary sequence —
 *
 *   1. `GET /meta/object/account` → a schema with `salary_grade` and
 *      `bonus_formula` absent (correct: that is the whole point of D1);
 *   2. edit something unrelated — a label;
 *   3. `PUT /meta/object/account` with that body,
 *
 * — stored the schema back MINUS the two fields, i.e. the caller deleted
 * exactly the fields they were never allowed to see, and nothing in the
 * exchange said so. The headline case below drives that real sequence against
 * a real store, so what is pinned is the DATA LOSS, not just a status code: a
 * gate that answers 403 after `saveMetaItem` has already run would still be
 * the bug, and would still pass a status-only assertion.
 *
 * The gate also closes a hole that has nothing to do with masking: before it,
 * any authenticated session could clobber any metadata item.
 *
 * ## Rejection cases assert the ENVELOPE (ADR-0112)
 *
 * Every refusal here asserts `code` AND `status`, never a bare "it threw" —
 * this route answers by *sending* rather than throwing, so a throw-shaped
 * assertion could not tell "refused with the wrong envelope" from "did not
 * refuse at all".
 */

import { describe, it, expect, vi } from 'vitest';
import { FLS_CONTRACT_OBJECT } from '@objectstack/metadata-core/testing';
import { RestServer } from './rest-server';

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));

/** The four fields `FLS_CONTRACT_OBJECT` declares, sorted. */
const ALL_FIELDS = ['bonus_formula', 'id', 'name', 'salary_grade'];
/** What the security double lets a restricted caller read. */
const READABLE_TO_RESTRICTED = ['id', 'name'];

const SINGLE_PATH = '/api/v1/meta/:type/:name';

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
    /** Drop `saveMetaItem` from the protocol (the 501 kernel). */
    withoutSave?: boolean;
}

/**
 * Boot the route over a protocol backed by a REAL in-memory store, so a GET →
 * edit → PUT sequence actually round-trips and the stored document can be
 * inspected after the write is refused.
 */
function boot(opts: BootOptions) {
    const stored: Record<string, any> = { account: copy(FLS_CONTRACT_OBJECT as unknown as Record<string, unknown>) };

    const saveMetaItem = vi.fn(async ({ name, item }: any) => {
        stored[name] = copy(item);
        return { success: true, type: 'object', name };
    });

    const protocol: any = {
        getDiscovery: vi.fn().mockResolvedValue({ version: 'v0', routes: { data: '', metadata: '', ui: '', auth: '/auth' } }),
        getMetaTypes: vi.fn().mockResolvedValue([]),
        getMetaItems: vi.fn(async () => Object.values(stored).map(copy)),
        // No `getMetaItemCached` — the uncached branch, so the read always
        // reflects the store rather than a fixture snapshot.
        getMetaItem: vi.fn(async ({ type, name }: any) => ({ type, name, item: copy(stored[name]), lock: 'none' })),
        findData: vi.fn().mockResolvedValue([]),
        getData: vi.fn().mockResolvedValue({}),
        createData: vi.fn().mockResolvedValue({ id: '1' }),
        updateData: vi.fn().mockResolvedValue({}),
        deleteData: vi.fn().mockResolvedValue({ success: true }),
    };
    if (!opts.withoutSave) protocol.saveMetaItem = saveMetaItem;

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

    const route = (method: string) => (rest as any).getRoutes().find(
        (r: any) => r.method === method && r.path === SINGLE_PATH,
    );

    return {
        rest,
        saveMetaItem,
        /** Field names currently in the STORE (not in any response). */
        storedFields: () => Object.keys(stored.account.fields ?? {}).sort(),
        storedLabel: () => stored.account.label,
        get: async () => {
            const res = mockRes();
            await route('GET')!.handler({ params: { type: 'object', name: 'account' }, query: {}, headers: {} }, res);
            return { res, body: res.json.mock.calls.at(-1)?.[0] };
        },
        put: async (item: unknown) => {
            const res = mockRes();
            await route('PUT')!.handler(
                { params: { type: 'object', name: 'account' }, query: {}, headers: {}, body: item },
                res,
            );
            return { res, body: res.json.mock.calls.at(-1)?.[0] };
        },
    };
}

describe('#6603 — PUT /meta/:type/:name: the ADR-0106 GET → edit → PUT round trip', () => {
    it('refuses a restricted caller\'s round-trip write, and the masked fields SURVIVE in the store', async () => {
        const stack = boot({
            context: { userId: 'u_portal', systemPermissions: [] },
            readable: READABLE_TO_RESTRICTED,
        });

        // 1. The read is masked — the premise. Asserted rather than assumed so
        //    this case cannot go quietly green by the masking disappearing.
        const read = await stack.get();
        expect(Object.keys(read.body.item.fields).sort()).toEqual(READABLE_TO_RESTRICTED);
        expect(read.body.item.fields).not.toHaveProperty('salary_grade');
        expect(read.body.item.fields).not.toHaveProperty('bonus_formula');

        // 2. The caller edits something unrelated and sends the body back.
        const edited = { ...copy(read.body.item), label: 'Account (renamed)' };

        // 3. The write is refused — envelope, not just "it failed".
        const write = await stack.put(edited);
        expect(write.res.statusCode).toBe(403);
        expect(write.body).toMatchObject({ error: { code: 'FORBIDDEN' } });

        // 4. THE POINT: nothing was written. A gate that 403s *after* the
        //    store has already been overwritten is the failure mode worth
        //    guarding, and a status-only assertion cannot see it.
        expect(stack.saveMetaItem).not.toHaveBeenCalled();
        expect(stack.storedFields()).toEqual(ALL_FIELDS);
        expect(stack.storedLabel()).toBe('Account');
    });

    it('the refusal is the gate, not the masking: an UNRESTRICTED but uncapable caller is refused too', async () => {
        // Everything readable ⇒ no field would have been lost. The write is
        // still refused, because reason (2) — any authenticated session could
        // clobber any metadata item — is independent of ADR-0106.
        const stack = boot({
            context: { userId: 'u_staff', systemPermissions: [] },
            readable: ALL_FIELDS,
        });
        const read = await stack.get();
        expect(Object.keys(read.body.item.fields).sort()).toEqual(ALL_FIELDS);

        const write = await stack.put({ ...copy(read.body.item), label: 'clobbered' });
        expect(write.res.statusCode).toBe(403);
        expect(write.body).toMatchObject({ error: { code: 'FORBIDDEN' } });
        expect(stack.storedLabel()).toBe('Account');
    });
});

describe('#6603 — the gate itself', () => {
    it('fires BEFORE the protocol is probed, so 403-vs-501 leaks no kernel capability', async () => {
        const stack = boot({ context: { userId: 'u1', systemPermissions: [] }, withoutSave: true });
        const write = await stack.put({ name: 'account' });
        // An authorized caller would get 501 here. An unauthorized one must
        // not be able to tell the two kernels apart.
        expect(write.res.statusCode).toBe(403);
        expect(write.body).toMatchObject({ error: { code: 'FORBIDDEN' } });
    });

    it('an anonymous caller never reaches the capability gate — 401 from the /meta umbrella', async () => {
        // Every `/meta` route inherits the anonymous-deny wrapper, so this gate
        // is the second layer rather than the only one.
        const stack = boot({ context: undefined });
        const write = await stack.put({ name: 'account' });
        expect(write.res.statusCode).toBe(401);
        expect(stack.saveMetaItem).not.toHaveBeenCalled();
    });

    it('allows a caller holding `manage_metadata`', async () => {
        const stack = boot({ context: { userId: 'u_author', systemPermissions: ['manage_metadata'] } });
        const write = await stack.put({ name: 'account', label: 'Account', fields: {} });
        expect(write.res.statusCode).toBe(200);
        expect(stack.saveMetaItem).toHaveBeenCalledTimes(1);
    });

    it('`isSystem` bypasses, matching every other capability gate on the platform', async () => {
        const stack = boot({ context: { isSystem: true } });
        const write = await stack.put({ name: 'account', label: 'Account', fields: {} });
        expect(write.res.statusCode).toBe(200);
        expect(stack.saveMetaItem).toHaveBeenCalledTimes(1);
    });

    /**
     * MEASURED, and deliberately pinned as-is: the capability this gate demands
     * (`manage_metadata`) and the ADR-0106 D4 mask-exemption set
     * (`OBJECT_SCHEMA_MASK_EXEMPT_CAPABILITIES` = `studio.access`,
     * `setup.access`) are DIFFERENT SETS. So holding a D4 exemption is not by
     * itself permission to write.
     *
     * In the permission sets the platform ships this never separates on the
     * write side: `admin_full_access` carries `manage_metadata` AND
     * `studio.access` AND `setup.access`, and it is the only shipped set with
     * `studio.access`. `organization_admin` carries `setup.access` without
     * `manage_metadata` — D4-exempt (so it never had the round-trip hazard) but
     * refused here, which is consistent with its own declaration that a tenant
     * does not mutate shared metadata.
     */
    it.each([
        ['no capabilities at all', [] as string[], 403],
        ['`studio.access` alone — D4-exempt, but not an authoring capability', ['studio.access'], 403],
        ['`setup.access` alone — likewise (this is `organization_admin`)', ['setup.access'], 403],
        ['`manage_metadata` alone', ['manage_metadata'], 200],
        ['the shipped `admin_full_access` shape', ['manage_metadata', 'studio.access', 'setup.access'], 200],
    ])('%s → %i', async (_label, systemPermissions, expected) => {
        const stack = boot({ context: { userId: 'u1', systemPermissions } });
        const write = await stack.put({ name: 'account', label: 'Account', fields: {} });
        expect(write.res.statusCode).toBe(expected);
    });
});

describe('#6603 — the exempt authoring caller is unaffected', () => {
    /**
     * A GUARD, not evidence: this case is green both before and after the gate
     * (a platform admin could always write, and being D4-exempt their read was
     * never masked, so their round trip was never lossy). It is here so a
     * future tightening of the gate cannot silently lock the platform
     * administrator out of the console's own schema designer.
     */
    it('an `admin_full_access`-shaped caller round-trips losslessly', async () => {
        const stack = boot({
            context: { userId: 'u_admin', systemPermissions: ['manage_metadata', 'studio.access', 'setup.access'] },
            readable: READABLE_TO_RESTRICTED, // the service would restrict — D4 exemption outranks it
        });

        const read = await stack.get();
        // D4 — exempt callers are served the UNMASKED schema.
        expect(Object.keys(read.body.item.fields).sort()).toEqual(ALL_FIELDS);

        const write = await stack.put({ ...copy(read.body.item), label: 'Account (renamed)' });
        expect(write.res.statusCode).toBe(200);
        expect(stack.storedFields()).toEqual(ALL_FIELDS);
        expect(stack.storedLabel()).toBe('Account (renamed)');
    });
});
