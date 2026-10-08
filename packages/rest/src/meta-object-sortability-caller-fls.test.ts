// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#22250] `GET /meta/object/:name` — the `sortability` projection served
 * beside the schema follows the CALLER's field permission, per caller class.
 *
 * ADR-0106 D4 exempts a platform-admin caller (and any caller holding
 * `manage_metadata`, `studio.access` or `setup.access`, an organization admin
 * included) from the object-schema mask: Studio/Setup authoring needs the whole
 * DEFINITION, and a projected one PUT back deletes what it withheld. That is
 * all D4 exempts. The same caller's field permission still binds the data
 * route — a filter or sort on an unreadable field answers `403` — so the
 * projection a grid builds sort clicks from must not offer that field. Before
 * this, it did: the exempt caller's `sortability` was derived from the
 * unmasked document and marked the field `sortable: true`.
 *
 * Pinned per class on both branches (the cached one is THE DEFAULT):
 *  - the definition (`item.fields`) is unchanged — whole for the two admin
 *    classes, masked for the member (the control);
 *  - `sortability` never names the unreadable field, and is the same for all
 *    three classes holding the same field permission;
 *  - the cached arm's ETag folds the difference, so an exempt caller is never
 *    answered `304` against a body that offered a field it may no longer read,
 *    and never shares a validator with a member denied the same field;
 *  - an unrestricted exempt caller's answer — ETag included — is byte-identical
 *    to the pre-change one, and a sick security service never faults the
 *    exempt caller's definition read.
 */

import { describe, it, expect, vi } from 'vitest';
import { resolveObjectSortability } from '@objectstack/spec/api';
import { objectFieldVisibilityFingerprint } from '@objectstack/metadata-core';
import { RestServer } from './rest-server.js';

const OPPORTUNITY = {
    name: 'crm_opportunity',
    label: 'Opportunity',
    fields: {
        name: { type: 'text' },
        amount: { type: 'currency' },
        secret_margin: { type: 'currency' },
        expected_revenue: { type: 'formula', expression: 'amount * probability / 100' },
    },
};
const ALL_FIELDS = Object.keys(OPPORTUNITY.fields);
/** Every class below holds the same field permission: `secret_margin` is unreadable. */
const READABLE = ['name', 'amount', 'expected_revenue'];

const CLASSES = {
    'platform admin': { userId: 'u_platform_admin', systemPermissions: ['manage_metadata', 'studio.access', 'setup.access'] },
    'organization admin': { userId: 'u_org_admin', systemPermissions: ['manage_org_users', 'setup.access', 'setup.write'] },
    member: { userId: 'u_member', systemPermissions: [] as string[] },
} as const;
type CallerClass = keyof typeof CLASSES;

/** The `sortability` the member is served — the control every class must equal. */
const EXPECTED_SORTABILITY = resolveObjectSortability({
    ...OPPORTUNITY,
    fields: Object.fromEntries(Object.entries(OPPORTUNITY.fields).filter(([name]) => READABLE.includes(name))),
});

function mockServer() {
    return {
        get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(),
        use: vi.fn(), listen: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined),
    };
}

function mockRes() {
    const headers: Record<string, string> = {};
    return {
        headers,
        statusCode: 200,
        json: vi.fn(),
        send: vi.fn(),
        status: vi.fn(function (this: any, code: number) { this.statusCode = code; return this; }),
        header: vi.fn((name: string, value: string) => { headers[name] = value; }),
    };
}

interface ReadOptions {
    caller: Record<string, unknown>;
    /** What the security service answers; `'throw'` for an unhealthy one. */
    readable: readonly string[] | 'throw';
    cached: boolean;
    ifNoneMatch?: string;
}

async function read(opts: ReadOptions) {
    const clone = () => JSON.parse(JSON.stringify(OPPORTUNITY));
    const protocol: any = {
        getDiscovery: vi.fn().mockResolvedValue({ version: 'v0', routes: { data: '', metadata: '', ui: '', auth: '/auth' } }),
        getMetaTypes: vi.fn().mockResolvedValue([]),
        getMetaItems: vi.fn().mockResolvedValue([]),
        getMetaItem: vi.fn(async ({ name }: any) => ({ type: 'object', name, item: clone(), lock: 'none' })),
        findData: vi.fn().mockResolvedValue([]),
        getData: vi.fn().mockResolvedValue({}),
        createData: vi.fn().mockResolvedValue({ id: '1' }),
        updateData: vi.fn().mockResolvedValue({}),
        deleteData: vi.fn().mockResolvedValue({ success: true }),
    };
    if (opts.cached) {
        // The protocol judges a conditional request only when it is handed one;
        // this double answers `notModified` exactly as it would.
        protocol.getMetaItemCached = vi.fn(async ({ cacheRequest }: any) => ({
            data: clone(),
            etag: { value: 'v1', weak: false },
            cacheControl: { directives: ['private', 'no-cache'] },
            notModified: cacheRequest?.ifNoneMatch === '"v1"',
        }));
    }
    const answer = () => {
        if (opts.readable === 'throw') throw new Error('security service unhealthy (test)');
        return [...opts.readable];
    };
    const security = { getReadableFields: async () => answer(), getMetadataReadableFields: async () => answer() };
    const rest = new RestServer(
        mockServer() as any,
        protocol as any,
        { api: { requireAuth: false } } as any,
        undefined, undefined, undefined, undefined, undefined, undefined, undefined,
        undefined, undefined, undefined, undefined, undefined, undefined, undefined,
        async () => security as any,
    );
    (rest as any).resolveExecCtx = async () => ({ ...opts.caller });
    rest.registerRoutes();
    const route = (rest as any).getRoutes().find((r: any) => r.method === 'GET' && r.path === '/api/v1/meta/:type/:name');
    const res = mockRes();
    await route.handler({
        params: { type: 'object', name: 'crm_opportunity' },
        query: {},
        headers: opts.ifNoneMatch ? { 'if-none-match': opts.ifNoneMatch } : {},
    }, res);
    const calls = res.json.mock.calls;
    return { res, protocol, body: calls.length > 0 ? calls[calls.length - 1][0] : undefined };
}

const isExempt = (cls: CallerClass) => cls !== 'member';

for (const cached of [true, false]) {
    describe(`[#22250] ${cached ? 'cached (default)' : 'uncached'} branch — sortability follows the caller's field permission`, () => {
        for (const cls of Object.keys(CLASSES) as CallerClass[]) {
            it(`${cls}: the definition is ${isExempt(cls) ? 'served whole' : 'masked'}; sortability never offers the unreadable field`, async () => {
                const { res, body } = await read({ caller: CLASSES[cls], readable: READABLE, cached });

                expect(res.statusCode).toBe(200);
                // The definition read — unchanged by this card for every class.
                expect(Object.keys(body.item.fields)).toEqual(isExempt(cls) ? ALL_FIELDS : READABLE);
                // The runtime projection — the same for every class.
                expect(body.sortability.fields.secret_margin).toBeUndefined();
                expect(body.sortability).toEqual(EXPECTED_SORTABILITY);
                // Anti-vacuity: readable columns keep their verdicts.
                expect(body.sortability.fields.amount).toEqual({ sortable: true });
                expect(body.sortability.fields.expected_revenue).toEqual({ sortable: false, reason: 'virtual-type' });
                if (!isExempt(cls)) {
                    // Control: a member's projection is still derived from exactly what it is served (#10235).
                    expect(body.sortability).toEqual(resolveObjectSortability(body.item));
                }
            });
        }

        it('an unrestricted exempt caller is served the pre-change answer, every field sortable', async () => {
            const { body } = await read({ caller: CLASSES['platform admin'], readable: ALL_FIELDS, cached });
            expect(Object.keys(body.item.fields)).toEqual(ALL_FIELDS);
            expect(body.sortability).toEqual(resolveObjectSortability(OPPORTUNITY));
        });

        it('a sick security service never faults the exempt caller: the definition is served, sortability unprojected', async () => {
            const { res, body } = await read({ caller: CLASSES['platform admin'], readable: 'throw', cached });
            expect(res.statusCode).toBe(200);
            expect(Object.keys(body.item.fields)).toEqual(ALL_FIELDS);
            expect(body.sortability).toEqual(resolveObjectSortability(OPPORTUNITY));
        });
    });
}

describe('[#22250] the cached arm\'s validator folds the exempt caller\'s runtime view', () => {
    it('platform admin: a fingerprinted ETag the protocol is not allowed to judge, distinct from the member\'s', async () => {
        const admin = await read({ caller: CLASSES['platform admin'], readable: READABLE, cached: true, ifNoneMatch: '"v1"' });
        const member = await read({ caller: CLASSES.member, readable: READABLE, cached: true });

        // The protocol hashes the unfiltered document, so it must not answer a
        // conditional request whose served body varies with the caller.
        expect(admin.protocol.getMetaItemCached.mock.calls[0][0].cacheRequest.ifNoneMatch).toBeUndefined();
        // The pre-change validator no longer matches: 200 with the narrowed projection, not a stale 304.
        expect(admin.res.statusCode).toBe(200);
        expect(admin.body.sortability.fields.secret_margin).toBeUndefined();

        expect(member.res.headers.ETag).toBe(`"v1~${objectFieldVisibilityFingerprint(['secret_margin'])}"`);
        expect(admin.res.headers.ETag).toMatch(/^"v1~[0-9a-f]{8}"$/);
        // Same denied field, different served body: never one validator.
        expect(admin.res.headers.ETag).not.toBe(member.res.headers.ETag);
    });

    it('platform admin: its own ETag revalidates to 304; the member\'s does not', async () => {
        const first = await read({ caller: CLASSES['platform admin'], readable: READABLE, cached: true });
        const own = await read({ caller: CLASSES['platform admin'], readable: READABLE, cached: true, ifNoneMatch: first.res.headers.ETag });
        expect(own.res.statusCode).toBe(304);

        const member = await read({ caller: CLASSES.member, readable: READABLE, cached: true });
        const crossed = await read({ caller: CLASSES['platform admin'], readable: READABLE, cached: true, ifNoneMatch: member.res.headers.ETag });
        expect(crossed.res.statusCode).toBe(200);
    });

    it('an unrestricted exempt caller keeps the byte-identical ETag and its 304 (ADR-0106 D3)', async () => {
        const first = await read({ caller: CLASSES['platform admin'], readable: ALL_FIELDS, cached: true });
        expect(first.res.headers.ETag).toBe('"v1"');
        const again = await read({ caller: CLASSES['platform admin'], readable: ALL_FIELDS, cached: true, ifNoneMatch: '"v1"' });
        expect(again.res.statusCode).toBe(304);
    });
});
