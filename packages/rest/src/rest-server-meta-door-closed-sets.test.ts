// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23072] The by-name `/meta` doors OUTSIDE ruling 6116165299's list each
 * declare a closed query-parameter set (AGENTS.md route rule 5), so the bundle
 * member selector `member` — honoured by the five doors in the ruling's list
 * (`rest-server-meta-member-selector.test.ts`, this card's CONTROL) — is
 * refused here with a located 400 instead of being dropped.
 *
 * Before, none of the six declared a set: `PUT /meta/email_template/x?member=zh-CN`
 * with an `en-US` body wrote `en-US` and answered 200, and `/diff`, `/layers`,
 * `/audit`, `/published` and `/references` answered the canonical member to a
 * request that named another — plausible answers about the wrong row, with no
 * status, header or field to tell them apart.
 *
 * Both halves per door, as the rule asks:
 *  - REFUSAL: `member`, and any other name the door does not read — status,
 *    the NESTED `error.code`, the located message, and the protocol never
 *    called (for `PUT`: nothing saved);
 *  - PRESERVATION: every name the door reads still reaches the protocol, and
 *    the request it received is asserted whole — never merely "still 200".
 */

import { describe, it, expect, vi } from 'vitest';
// `.js` on purpose — NodeNext resolution requires the extension.
import {
    RestServer,
    META_ITEM_SAVE_PARAMS,
    META_ITEM_REFERENCES_PARAMS,
    META_ITEM_LAYERS_PARAMS,
    META_ITEM_AUDIT_PARAMS,
    META_ITEM_DIFF_PARAMS,
    META_ITEM_PUBLISHED_PARAMS,
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

const EN = { name: 'acme.welcome', label: 'Welcome', locale: 'en-US', subject: 'en', bodyHtml: '<p>en</p>' };

/** A RestServer over a stubbed protocol whose six doors each answer something servable. */
function boot() {
    const protocol: any = {
        getDiscovery: vi.fn().mockResolvedValue({
            version: 'v0', routes: { data: '', metadata: '', ui: '', auth: '/auth' },
        }),
        getMetaTypes: vi.fn().mockResolvedValue([]),
        getMetaItems: vi.fn().mockResolvedValue({ items: [] }),
        getMetaItem: vi.fn().mockResolvedValue({ type: 'email_template', name: 'acme.welcome', item: EN, lock: 'none' }),
        getMetaItemLayered: vi.fn().mockResolvedValue({
            type: 'email_template', name: 'acme.welcome', code: null, overlay: EN, overlayScope: 'env', effective: EN,
        }),
        saveMetaItem: vi.fn().mockResolvedValue({ success: true, version: 'v1', seq: 1 }),
        findReferencesToMeta: vi.fn().mockResolvedValue({ references: [] }),
        auditMetaItem: vi.fn().mockResolvedValue({ events: [] }),
        diffMetaItem: vi.fn().mockResolvedValue({
            type: 'email_template', name: 'acme.welcome', fromVersion: 1, toVersion: 2, added: [], removed: [], changed: [],
        }),
    };
    const rest = new RestServer(
        mockServer() as any,
        protocol as any,
        { api: { requireAuth: false }, metadata: { enableCache: false } } as any,
    );
    // `isSystem` clears the capability and authoring gates that run BEFORE the
    // query is read, so every request reaches the rule it is named after.
    (rest as any).resolveExecCtx = async () => ({ isSystem: true, userId: 'u1' });
    rest.registerRoutes();

    const drive = async (method: string, path: string, query: Record<string, unknown>, body: unknown = {}) => {
        const found = (rest as any).getRoutes().find((r: any) => r.method === method && r.path === path);
        if (!found) throw new Error(`route not registered: ${method} ${path}`);
        const res = mockRes();
        await found.handler({
            method, path, params: { type: 'email_template', name: 'acme.welcome' }, query, headers: {}, body,
        } as any, res);
        return { status: res.statusCode, body: res.json.mock.calls.at(-1)?.[0] };
    };
    return { protocol, drive };
}

/** The six doors: the route, its declared set, the protocol method it reaches and a body it accepts. */
const DOORS = [
    { door: 'PUT item (save)', method: 'PUT', path: ITEM, set: META_ITEM_SAVE_PARAMS, call: 'saveMetaItem', body: EN },
    { door: 'GET /references', method: 'GET', path: `${ITEM}/references`, set: META_ITEM_REFERENCES_PARAMS, call: 'findReferencesToMeta', body: {} },
    { door: 'GET /layers', method: 'GET', path: `${ITEM}/layers`, set: META_ITEM_LAYERS_PARAMS, call: 'getMetaItemLayered', body: {} },
    { door: 'GET /audit', method: 'GET', path: `${ITEM}/audit`, set: META_ITEM_AUDIT_PARAMS, call: 'auditMetaItem', body: {} },
    { door: 'GET /diff', method: 'GET', path: `${ITEM}/diff`, set: META_ITEM_DIFF_PARAMS, call: 'diffMetaItem', body: {} },
    { door: 'GET /published', method: 'GET', path: `${ITEM}/published`, set: META_ITEM_PUBLISHED_PARAMS, call: 'getMetaItemLayered', body: {} },
] as const;

describe('[#23072] each by-name /meta door outside the ruling\'s list declares a closed query set', () => {
    it('the measured sets — none carries the member selector', () => {
        expect([...META_ITEM_SAVE_PARAMS].sort()).toEqual(['force', 'mode', 'package']);
        expect([...META_ITEM_REFERENCES_PARAMS]).toEqual([]);
        expect([...META_ITEM_LAYERS_PARAMS]).toEqual(['package']);
        expect([...META_ITEM_AUDIT_PARAMS]).toEqual(['limit']);
        expect([...META_ITEM_DIFF_PARAMS].sort()).toEqual(['from', 'fromVersion', 'to', 'toVersion']);
        expect([...META_ITEM_PUBLISHED_PARAMS]).toEqual([]);
        for (const { set } of DOORS) expect(set).not.toContain('member');
    });

    for (const { door, method, path, set, call, body } of DOORS) {
        it(`${door}: REFUSAL — \`?member=\` is a located 400 naming it, and the protocol is never called`, async () => {
            const { protocol, drive } = boot();
            const answer = await drive(method, path, { member: 'zh-CN' }, body);
            expect(answer.status, JSON.stringify(answer.body)).toBe(400);
            expect(answer.body?.error?.code).toBe('VALIDATION_ERROR');
            expect(answer.body?.error?.message).toBe(unknownQueryParamMessage(['member'], [...set].sort()));
            expect(protocol[call], 'the door answered before the protocol').not.toHaveBeenCalled();
        });

        it(`${door}: REFUSAL — an unrecognised name is refused the same way`, async () => {
            const { protocol, drive } = boot();
            const answer = await drive(method, path, { memeber: 'zh-CN' }, body);
            expect(answer.status, JSON.stringify(answer.body)).toBe(400);
            expect(answer.body?.error?.code).toBe('VALIDATION_ERROR');
            expect(answer.body?.error?.message).toBe(unknownQueryParamMessage(['memeber'], [...set].sort()));
            expect(protocol[call]).not.toHaveBeenCalled();
        });
    }

    it('PUT: the card\'s case — `?member=zh-CN` beside an `en-US` body saves nothing', async () => {
        const { protocol, drive } = boot();
        const answer = await drive('PUT', ITEM, { member: 'zh-CN', mode: 'draft' }, EN);
        expect(answer.status).toBe(400);
        expect(answer.body?.error?.message).toMatch(/^The "member" query parameter is not supported by this endpoint\./);
        expect(answer.body?.error?.message).toContain('Supported parameters: force, mode, package.');
        expect(protocol.saveMetaItem).not.toHaveBeenCalled();
    });

    it('a door that reads no parameter says so, rather than listing nothing', async () => {
        const { drive } = boot();
        for (const path of [`${ITEM}/references`, `${ITEM}/published`]) {
            const answer = await drive('GET', path, { member: 'zh-CN' });
            expect(answer.body?.error?.message, path).toMatch(/This endpoint takes no query parameters\.$/);
            expect(answer.body?.error?.message, path).not.toContain('Supported parameters');
        }
    });
});

describe('[#23072] PRESERVATION — every name each door reads still reaches its protocol method', () => {
    it('PUT item: `force`, `package` and `mode` reach `saveMetaItem`', async () => {
        const { protocol, drive } = boot();
        const answer = await drive('PUT', ITEM, { force: 'true', package: 'com.acme.mail', mode: 'draft' }, EN);
        expect(answer.status, JSON.stringify(answer.body)).toBe(200);
        expect(protocol.saveMetaItem.mock.calls[0][0]).toEqual({
            type: 'email_template', name: 'acme.welcome', item: EN, writeFace: 'meta-envelope',
            mode: 'draft', actor: 'u1', force: true, packageId: 'com.acme.mail',
        });
    });

    it('GET /references: no parameter, the type and the name reach `findReferencesToMeta`', async () => {
        const { protocol, drive } = boot();
        const answer = await drive('GET', `${ITEM}/references`, {});
        expect(answer.status, JSON.stringify(answer.body)).toBe(200);
        expect(protocol.findReferencesToMeta.mock.calls[0][0]).toEqual({ type: 'email_template', name: 'acme.welcome' });
    });

    it('GET /layers: `package` reaches `getMetaItemLayered`', async () => {
        const { protocol, drive } = boot();
        const answer = await drive('GET', `${ITEM}/layers`, { package: 'com.acme.mail' });
        expect(answer.status, JSON.stringify(answer.body)).toBe(200);
        expect(protocol.getMetaItemLayered.mock.calls[0][0]).toEqual({
            type: 'email_template', name: 'acme.welcome', packageId: 'com.acme.mail',
        });
    });

    it('GET /audit: `limit` reaches `auditMetaItem`', async () => {
        const { protocol, drive } = boot();
        const answer = await drive('GET', `${ITEM}/audit`, { limit: '5' });
        expect(answer.status, JSON.stringify(answer.body)).toBe(200);
        expect(protocol.auditMetaItem.mock.calls[0][0]).toEqual({ type: 'email_template', name: 'acme.welcome', limit: 5 });
    });

    it('GET /diff: both bounds reach `diffMetaItem`, under either spelling', async () => {
        for (const query of [{ from: '1', to: '2' }, { fromVersion: '1', toVersion: '2' }]) {
            const { protocol, drive } = boot();
            const answer = await drive('GET', `${ITEM}/diff`, query);
            expect(answer.status, JSON.stringify(answer.body)).toBe(200);
            expect(protocol.diffMetaItem.mock.calls[0][0], JSON.stringify(query)).toEqual({
                type: 'email_template', name: 'acme.welcome', fromVersion: 1, toVersion: 2,
            });
        }
    });

    it('GET /published: no parameter, the overlay is read and served', async () => {
        const { protocol, drive } = boot();
        const answer = await drive('GET', `${ITEM}/published`, {});
        expect(answer.status, JSON.stringify(answer.body)).toBe(200);
        expect(protocol.getMetaItemLayered.mock.calls[0][0]).toEqual({ type: 'email_template', name: 'acme.welcome' });
        expect(answer.body).toEqual(EN);
    });
});
