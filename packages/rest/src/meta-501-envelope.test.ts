// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#7035] One error envelope for every `/meta` write refusal a kernel forces.
 *
 * ## What was wrong
 *
 * Three adjacent `/meta` handlers in `rest-server.ts` answered "the protocol
 * implementation does not have this method" with THREE different shapes:
 *
 *   | handler                         | shape                                            |
 *   | :------------------------------ | :----------------------------------------------- |
 *   | `POST /meta/_migrate-stored`    | `{ error: { code, message } }` — ADR-0112         |
 *   | `DELETE /meta/:type/:name`      | `{ error: '<msg>' }` — bare string, NO code       |
 *   | `PUT /meta/:type/:section/:name`| `{ error: '<msg>', code }` — code as a SIBLING    |
 *
 * A fourth site, `PUT /meta/:type/:name`, was byte-identical to the compound
 * `PUT` (the file's own gate comment calls the pair "WORD FOR WORD the same
 * mechanism"), so it carried the sibling-key shape too — the card's table
 * sampled one of the twins, not both.
 *
 * The cost is not cosmetic. A client reading `err.error.code` — the one position
 * ADR-0112 declares — got `undefined` on three of the four routes, and
 * `undefined` takes the "no code" branch rather than an error branch. That is
 * Prime Directive #12's producer-is-the-contract broken in the shape that forces
 * consumers into `??` chains.
 *
 * ## What these cases assert, and why not `toThrow`
 *
 * These handlers *send*, they never throw, so a `toThrow`-shaped assertion here
 * would report "the promise resolved" and could not separate "refused with the
 * wrong envelope" from "did not refuse at all" — and the wrong envelope IS the
 * defect. So every case asserts the ADR-0112 pair — `status` AND
 * `body.error.code` — at the **nested** position, plus the two dialects being
 * retired: no top-level `code` sibling, and `error` is an object rather than a
 * bare string.
 *
 * `NOT_IMPLEMENTED` is deliberately unchanged. It is already the standard
 * catalog's member for this condition (`packages/spec/src/api/errors.zod.ts`
 * lists it, and `standardErrorCodeForHttpStatus(501)` returns it), so no catalog
 * entry is minted here — a catalog change would touch `packages/spec`, which is
 * out of this card.
 *
 * ## Reachability
 *
 * All four branches are reachable only when the protocol implementation lacks
 * the method, so the stub below deliberately OMITS `saveMetaItem`,
 * `deleteMetaItem` and `migrateStoredMetadata`. The shipped kernel has them,
 * which is why these were `finding`-grade rather than a live bug — they are
 * templates, and the next author copies whichever one they scrolled to.
 */

import { describe, it, expect, vi } from 'vitest';
// `.js` on purpose — NodeNext resolution requires the extension, and this
// package's TEST_DEBT ceiling has no margin for another TS2835 (#7248).
import { RestServer } from './rest-server.js';

const MIGRATE_PATH = '/api/v1/meta/_migrate-stored';
const SINGLE_PATH = '/api/v1/meta/:type/:name';
const COMPOUND_PATH = '/api/v1/meta/:type/:section/:name';

function mockServer() {
    return {
        get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(),
        use: vi.fn(),
        listen: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
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

/**
 * A kernel whose protocol implements the READ side and none of the three write
 * methods these routes probe for. Minimal and in-file on purpose: the point of
 * the stub is the ABSENCE of `saveMetaItem` / `deleteMetaItem` /
 * `migrateStoredMetadata`, so anything it gains beyond making the routes
 * register weakens what the cases below prove.
 */
function boot() {
    const protocol: any = {
        getDiscovery: vi.fn().mockResolvedValue({
            version: 'v0',
            routes: { data: '', metadata: '', ui: '', auth: '/auth' },
        }),
        getMetaTypes: vi.fn().mockResolvedValue([]),
        getMetaItems: vi.fn().mockResolvedValue([]),
        getMetaItem: vi.fn().mockResolvedValue({ type: 'object', name: 'account', item: {}, lock: 'none' }),
        findData: vi.fn().mockResolvedValue([]),
        getData: vi.fn().mockResolvedValue({}),
        createData: vi.fn().mockResolvedValue({ id: '1' }),
        updateData: vi.fn().mockResolvedValue({}),
        deleteData: vi.fn().mockResolvedValue({ success: true }),
        // NO saveMetaItem, NO deleteMetaItem, NO migrateStoredMetadata.
    };

    const rest = new RestServer(
        mockServer() as any,
        protocol as any,
        { api: { requireAuth: false } } as any,
    );
    // `isSystem` clears the `manage_metadata` capability gate that fires BEFORE
    // the protocol is probed, so the request reaches the 501 branch under test.
    (rest as any).resolveExecCtx = async () => ({ isSystem: true });
    rest.registerRoutes();

    const route = (method: string, path: string) => {
        const found = (rest as any).getRoutes().find(
            (r: any) => r.method === method && r.path === path,
        );
        if (!found) throw new Error(`route not registered: ${method} ${path}`);
        return found;
    };

    const drive = async (method: string, path: string, req: Record<string, unknown>) => {
        const res = mockRes();
        await route(method, path).handler(
            { query: {}, headers: {}, body: {}, ...req }, res,
        );
        return { status: res.statusCode, body: res.json.mock.calls.at(-1)?.[0] };
    };

    return {
        /** The shape the other three converged ON — the ADR-0112 anchor. */
        migrateStored: () => drive('POST', MIGRATE_PATH, { params: {} }),
        singleSave: () => drive('PUT', SINGLE_PATH, { params: { type: 'object', name: 'account' } }),
        compoundSave: () => drive('PUT', COMPOUND_PATH, { params: { type: 'object', section: 'crm', name: 'account' } }),
        reset: (query: Record<string, unknown> = {}) =>
            drive('DELETE', SINGLE_PATH, { params: { type: 'object', name: 'account' }, query }),
    };
}

/**
 * The full ADR-0112 assertion for one refusal: the pair (`status` + `code`) at
 * the nested position, and both retired dialects absent.
 */
function expectNestedEnvelope(
    answer: { status: number; body: any },
    message: string,
) {
    expect(answer.status).toBe(501);
    // The pair ADR-0112 declares. `body.error.code` — nested, because the
    // flat-sibling position is exactly the defect.
    expect(answer.body?.error?.code).toBe('NOT_IMPLEMENTED');
    expect(answer.body?.error?.message).toBe(message);
    // Dialect 1 retired: `code` as a sibling of `error`.
    expect(answer.body).not.toHaveProperty('code');
    // Dialect 2 retired: `error` as a bare string (which also made
    // `error.message` read `undefined`).
    expect(typeof answer.body?.error).toBe('object');
}

describe('#7035 — the `/meta` 501 refusals all speak the ADR-0112 envelope', () => {
    it('POST /meta/_migrate-stored — the anchor shape, pinned so it cannot drift back', async () => {
        // This one was already conformant. It is asserted here because it is the
        // shape the other three were converged onto: if it drifts, the
        // convergence loses its reference point and the file has three shapes
        // again.
        const answer = await boot().migrateStored();
        expectNestedEnvelope(answer, 'protocol.migrateStoredMetadata() is not available in this kernel');
    });

    it('DELETE /meta/:type/:name — was a bare-string `error` with no code at all', async () => {
        const answer = await boot().reset();
        expectNestedEnvelope(answer, 'Reset operation not supported by protocol implementation');
    });

    it('DELETE /meta/:type/:name?dropStorage=true — the destructive form answers the same envelope', async () => {
        // The `dropStorage` variant reaches the same protocol probe; asserting it
        // separately keeps a future short-circuit on that query parameter from
        // reintroducing a second shape on the same route.
        const answer = await boot().reset({ dropStorage: 'true' });
        expectNestedEnvelope(answer, 'Reset operation not supported by protocol implementation');
    });

    it('PUT /meta/:type/:name — was `code` as a sibling of `error`', async () => {
        const answer = await boot().singleSave();
        expectNestedEnvelope(answer, 'Save operation not supported by protocol implementation');
    });

    it('PUT /meta/:type/:section/:name — the compound twin, same dialect, same fix', async () => {
        const answer = await boot().compoundSave();
        expectNestedEnvelope(answer, 'Save operation not supported by protocol implementation');
    });

    it('the two `PUT` twins answer byte-identical bodies — the pair is one contract', async () => {
        // The file's own comment calls these "WORD FOR WORD the same mechanism".
        // Pinning their equality is what stops the pair splitting again: a fix
        // applied to whichever line the next author scrolled to would show up
        // here rather than shipping as a fourth shape.
        const stack = boot();
        const single = await stack.singleSave();
        const compound = await stack.compoundSave();
        expect(compound.status).toBe(single.status);
        expect(compound.body).toEqual(single.body);
    });

    it('one code path reads every refusal — `err.error.code` on all four routes', async () => {
        // The consumer-side statement of the whole card: ONE way of reading the
        // code works everywhere, instead of three per-route ways of which any
        // single choice silently yielded `undefined` on the other two.
        const stack = boot();
        const answers = [
            await stack.migrateStored(),
            await stack.reset(),
            await stack.singleSave(),
            await stack.compoundSave(),
        ];
        expect(answers.map((a) => a.status)).toEqual([501, 501, 501, 501]);
        expect(answers.map((a) => a.body?.error?.code)).toEqual([
            'NOT_IMPLEMENTED', 'NOT_IMPLEMENTED', 'NOT_IMPLEMENTED', 'NOT_IMPLEMENTED',
        ]);
        // And every message is readable at the declared position — the bare-string
        // dialect made this one `undefined`.
        for (const a of answers) expect(typeof a.body?.error?.message).toBe('string');
    });
});
