// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#22877] The bundle member selector on the by-name `/meta` doors, and the
 * closed query-parameter set each of the five routes declares with it
 * (ruling 6116165299, Q2 i; AGENTS.md route rule 5).
 *
 * `GET`, `DELETE`, `/history`, `/publish` and `/rollback` on
 * `/meta/:type/:name` accept `?member=` — one member of a bundled type
 * (`email_template`'s `(name, locale)`), absent meaning the canonical one.
 * None of the five declared a closed set before, so a misspelled selector
 * (`?memeber=zh-CN`) would have been dropped and answered with the canonical
 * member: a plausible 200 about the wrong row. Each route now opens with
 * recognition over its measured set.
 *
 * Both halves per route, as the rule asks:
 *  - REFUSAL: status, the NESTED `error.code`, the located message, and the
 *    protocol never called;
 *  - PRESERVATION: the request the protocol actually received, measured
 *    names and the member included — never merely "still 200".
 *
 * The VALUE of the selector is the protocol's to judge, once, for every
 * transport: the value pins below drive a REAL `ObjectStackProtocolImplementation`
 * over an engine that is never reached (`{}`), so a 400 here is the
 * protocol's own refusal, before any store read, rendered by the route's one
 * error door (`handleRouteError`) as it renders every refusal the protocol
 * raises — the flat position (`body.code`, `body.error` the sentence) that
 * `check:route-envelope` ratchets repo-wide, not the nested one the door's
 * own recognition refusal writes.
 */

import { describe, it, expect, vi } from 'vitest';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
// `.js` on purpose — NodeNext resolution requires the extension.
import {
    RestServer,
    META_ITEM_MEMBER_PARAM,
    META_ITEM_READ_PARAMS,
    META_ITEM_RESET_PARAMS,
    META_ITEM_HISTORY_PARAMS,
    META_ITEM_PUBLISH_PARAMS,
    META_ITEM_ROLLBACK_PARAMS,
} from './rest-server.js';
import { unknownQueryParamMessage } from './query-allowlist.js';

const META = '/api/v1/meta';
const ITEM = `${META}/:type/:name`;

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
        _headers: {} as Record<string, string>,
        json: vi.fn(function (this: any, body: any) { this._body = body; return this; }),
        send: vi.fn(function (this: any) { return this; }),
        write: vi.fn(function (this: any) { return true; }),
        end: vi.fn(function (this: any) { return this; }),
        setHeader: vi.fn(function (this: any) { return this; }),
        status: vi.fn(function (this: any, code: number) { this.statusCode = code; return this; }),
        header: vi.fn(function (this: any, k: string, v: string) { this._headers[k] = v; return this; }),
    };
    return res;
}

const TEMPLATE = { name: 'acme.welcome', label: 'Welcome', locale: 'zh-CN', subject: 'zh', bodyHtml: '<p>zh</p>' };

/**
 * A RestServer over a stubbed protocol. `real`, when given, is a real protocol
 * whose by-name doors the stub delegates to — used by the value pins, whose
 * refusal happens before the protocol touches its (absent) engine.
 */
function boot(options: { enableCache?: boolean; real?: ObjectStackProtocolImplementation; delegated?: string } = {}) {
    const real: any = options.real;
    // Only the door under test reaches the real protocol: a door's own
    // pre-reads (the history door's per-caller refusal reads the item) stay
    // on the stub, so the answer is the door's verdict and nothing else's.
    const delegate = (name: string, answer: unknown) => vi.fn((request: unknown) =>
        (real && options.delegated === name ? real[name](request) : Promise.resolve(answer)));
    const protocol: any = {
        getDiscovery: vi.fn().mockResolvedValue({
            version: 'v0', routes: { data: '', metadata: '', ui: '', auth: '/auth' },
        }),
        getMetaTypes: vi.fn().mockResolvedValue([]),
        getMetaItems: vi.fn().mockResolvedValue({ items: [] }),
        getMetaItem: delegate('getMetaItem', { type: 'email_template', name: 'acme.welcome', item: TEMPLATE, lock: 'none' }),
        getMetaItemCached: vi.fn().mockResolvedValue({ data: TEMPLATE, etag: { value: 'e', weak: false } }),
        getMetaItemLayered: vi.fn().mockResolvedValue({ type: 'email_template', name: 'acme.welcome', code: null, overlay: null, effective: TEMPLATE }),
        deleteMetaItem: delegate('deleteMetaItem', { success: true, reset: true }),
        historyMetaItem: delegate('historyMetaItem', { events: [] }),
        publishMetaItem: delegate('publishMetaItem', { success: true, version: 'v', seq: 1 }),
        rollbackMetaItem: delegate('rollbackMetaItem', { success: true, version: 'v', seq: 2, restoredFromVersion: 1 }),
    };
    const rest = new RestServer(
        mockServer() as any,
        protocol as any,
        { api: { requireAuth: false }, metadata: { enableCache: options.enableCache ?? false } } as any,
    );
    // `isSystem` clears the capability and authoring gates that run BEFORE the
    // query is read, so every request reaches the rule it is named after.
    (rest as any).resolveExecCtx = async () => ({ isSystem: true, userId: 'u1' });
    rest.registerRoutes();

    const drive = async (
        method: string,
        path: string,
        query: Record<string, unknown>,
        body: unknown = {},
        params: Record<string, string> = { type: 'email_template', name: 'acme.welcome' },
    ) => {
        const found = (rest as any).getRoutes().find((r: any) => r.method === method && r.path === path);
        if (!found) throw new Error(`route not registered: ${method} ${path}`);
        const res = mockRes();
        await found.handler({ method, path, params, query, headers: {}, body } as any, res);
        return { status: res.statusCode, body: res.json.mock.calls.at(-1)?.[0] };
    };
    return { protocol, drive };
}

/** The five doors: the route, its declared set, the protocol method it reaches and a body it accepts. */
const DOORS = [
    { door: 'GET item', method: 'GET', path: ITEM, set: META_ITEM_READ_PARAMS, call: 'getMetaItem', body: {} },
    { door: 'DELETE item (reset)', method: 'DELETE', path: ITEM, set: META_ITEM_RESET_PARAMS, call: 'deleteMetaItem', body: {} },
    { door: 'GET /history', method: 'GET', path: `${ITEM}/history`, set: META_ITEM_HISTORY_PARAMS, call: 'historyMetaItem', body: {} },
    { door: 'POST /publish', method: 'POST', path: `${ITEM}/publish`, set: META_ITEM_PUBLISH_PARAMS, call: 'publishMetaItem', body: {} },
    { door: 'POST /rollback', method: 'POST', path: `${ITEM}/rollback`, set: META_ITEM_ROLLBACK_PARAMS, call: 'rollbackMetaItem', body: { toVersion: 1 } },
] as const;

describe('[#22877] each by-name /meta door declares a closed query set, the member selector in it', () => {
    it('the selector is `member` — never `locale`, which names the response translation locale', () => {
        expect(META_ITEM_MEMBER_PARAM).toBe('member');
        for (const { set } of DOORS) expect(set).toContain('member');
        // `locale` stays what it was on the item read: the translation locale.
        expect(META_ITEM_READ_PARAMS).toContain('locale');
    });

    it('the measured sets — paging, switches and the read a frame down included', () => {
        expect([...META_ITEM_READ_PARAMS].sort()).toEqual(['layers', 'locale', 'member', 'package', 'preview', 'state']);
        expect([...META_ITEM_RESET_PARAMS].sort()).toEqual(['dropStorage', 'member', 'state']);
        expect([...META_ITEM_HISTORY_PARAMS].sort()).toEqual(['limit', 'member', 'sinceSeq']);
        expect([...META_ITEM_PUBLISH_PARAMS].sort()).toEqual(['member', 'package']);
        expect([...META_ITEM_ROLLBACK_PARAMS].sort()).toEqual(['member', 'toVersion']);
    });

    for (const { door, method, path, set, call, body } of DOORS) {
        it(`${door}: REFUSAL — a misspelled selector is a located 400 and the protocol is never called`, async () => {
            const { protocol, drive } = boot();
            const answer = await drive(method, path, { memeber: 'zh-CN' }, body);
            expect(answer.status).toBe(400);
            expect(answer.body?.error?.code).toBe('VALIDATION_ERROR');
            expect(answer.body?.error?.message).toBe(unknownQueryParamMessage(['memeber'], [...set].sort()));
            expect(protocol[call], 'the door answered before the protocol').not.toHaveBeenCalled();
        });

        it(`${door}: REFUSAL — a repeated selector is refused, never resolved`, async () => {
            const { protocol, drive } = boot();
            const answer = await drive(method, path, { member: ['zh-CN', 'ja-JP'] }, body);
            expect(answer.status).toBe(400);
            expect(answer.body?.error?.code).toBe('VALIDATION_ERROR');
            expect(answer.body?.error?.message).toContain('"member" query parameter was supplied 2 times');
            expect(protocol[call]).not.toHaveBeenCalled();
        });
    }
});

describe('[#22877] PRESERVATION — the request each protocol door receives', () => {
    it('GET item: the member and every measured name reach `getMetaItem`, and the cache is bypassed', async () => {
        const { protocol, drive } = boot({ enableCache: true });
        const answer = await drive('GET', ITEM, { member: 'zh-CN', package: 'com.acme.mail', locale: 'zh-CN' });
        expect(answer.status, JSON.stringify(answer.body)).toBe(200);
        expect(protocol.getMetaItemCached, 'the cached read takes no member').not.toHaveBeenCalled();
        expect(protocol.getMetaItem).toHaveBeenCalledTimes(1);
        expect(protocol.getMetaItem.mock.calls[0][0]).toEqual({
            type: 'email_template', name: 'acme.welcome', packageId: 'com.acme.mail', member: 'zh-CN',
        });
    });

    it('GET item CONTROL: no member keeps the cached arm and sends no member', async () => {
        const { protocol, drive } = boot({ enableCache: true });
        const answer = await drive('GET', ITEM, { locale: 'zh-CN' });
        expect(answer.status, JSON.stringify(answer.body)).toBe(200);
        expect(protocol.getMetaItemCached).toHaveBeenCalledTimes(1);
        expect(protocol.getMetaItem).not.toHaveBeenCalled();
    });

    it('GET item: the layered view refuses a member instead of serving the canonical member\'s layers', async () => {
        const { protocol, drive } = boot();
        const answer = await drive('GET', ITEM, { layers: 'true', member: 'zh-CN' });
        expect(answer.status).toBe(400);
        expect(answer.body?.code).toBe('VALIDATION_ERROR');
        expect(answer.body?.error).toContain('"member" selector is not served by the layered view');
        expect(protocol.getMetaItemLayered).not.toHaveBeenCalled();
        expect(protocol.getMetaItem).not.toHaveBeenCalled();
    });

    it('DELETE item: the member reaches `deleteMetaItem` beside `state`', async () => {
        const { protocol, drive } = boot();
        const answer = await drive('DELETE', ITEM, { member: 'zh-CN', state: 'draft' });
        expect(answer.status, JSON.stringify(answer.body)).toBe(200);
        expect(protocol.deleteMetaItem.mock.calls[0][0]).toEqual({
            type: 'email_template', name: 'acme.welcome', actor: 'u1', state: 'draft', member: 'zh-CN',
        });
    });

    it('GET /history: the member reaches `historyMetaItem` beside the paging pair', async () => {
        const { protocol, drive } = boot();
        const answer = await drive('GET', `${ITEM}/history`, { member: 'zh-CN', sinceSeq: '3', limit: '10' });
        expect(answer.status, JSON.stringify(answer.body)).toBe(200);
        expect(protocol.historyMetaItem.mock.calls[0][0]).toEqual({
            type: 'email_template', name: 'acme.welcome', sinceSeq: 3, limit: 10, member: 'zh-CN',
        });
    });

    it('POST /publish: the member reaches `publishMetaItem` beside `package`', async () => {
        const { protocol, drive } = boot();
        const answer = await drive('POST', `${ITEM}/publish`, { member: 'zh-CN', package: 'com.acme.mail' });
        expect(answer.status, JSON.stringify(answer.body)).toBe(200);
        expect(protocol.publishMetaItem.mock.calls[0][0]).toEqual({
            type: 'email_template', name: 'acme.welcome', actor: 'u1', packageId: 'com.acme.mail', member: 'zh-CN',
        });
    });

    it('POST /rollback: the member reaches `rollbackMetaItem`, and the query `toVersion` still reads', async () => {
        const { protocol, drive } = boot();
        const answer = await drive('POST', `${ITEM}/rollback`, { member: 'zh-CN', toVersion: '4' }, {});
        expect(answer.status, JSON.stringify(answer.body)).toBe(200);
        expect(protocol.rollbackMetaItem.mock.calls[0][0]).toEqual({
            type: 'email_template', name: 'acme.welcome', toVersion: 4, actor: 'u1', member: 'zh-CN',
        });
    });

    it('CONTROL: no selector sends no `member` key on any door', async () => {
        const { protocol, drive } = boot();
        for (const { method, path, call, body } of DOORS) {
            const answer = await drive(method, path, {}, body);
            expect(answer.status, `${call}: ${JSON.stringify(answer.body)}`).toBe(200);
            expect(Object.keys(protocol[call].mock.calls[0][0]), call).not.toContain('member');
        }
    });
});

describe('[#22877] the VALUE is judged by the protocol, once, and rendered here as a located 400', () => {
    for (const { door, method, path, call, body } of DOORS) {
        it(`${door}: a selector on a type with no members — 400 VALIDATION_ERROR, before any store read`, async () => {
            const { protocol, drive } = boot({ real: new ObjectStackProtocolImplementation({} as never), delegated: call });
            const answer = await drive(method, path, { member: 'zh-CN' }, body, { type: 'view', name: 'task_grid' });
            expect(answer.status, JSON.stringify(answer.body)).toBe(400);
            expect(answer.body?.code).toBe('VALIDATION_ERROR');
            expect(answer.body?.error).toMatch(
                /^The "member" selector names a bundle member, and a 'view' item has none: its identity is its name alone\./,
            );
            // Reached, and refused there: the engine (`{}`) was never read, or
            // the answer would be a 500 from a missing engine method.
            expect(protocol[call]).toHaveBeenCalledTimes(1);
        });

        it(`${door}: a blank selector is refused, never read as the canonical member`, async () => {
            const { drive } = boot({ real: new ObjectStackProtocolImplementation({} as never), delegated: call });
            const answer = await drive(method, path, { member: '  ' }, body);
            expect(answer.status, JSON.stringify(answer.body)).toBe(400);
            expect(answer.body?.code).toBe('VALIDATION_ERROR');
            expect(answer.body?.error).toMatch(/^The "member" selector is blank\./);
        });
    }
});
