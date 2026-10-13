// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23072] The runtime dispatcher's by-name `/meta` doors ask THE query
 * decision `RestServer`'s doors ask (`metaItemQueryRefusal` in
 * `@objectstack/rest`, ruling 6138588561), and the item read honours the
 * bundle member selector.
 *
 * The dispatcher is the only `/meta` answer on a host that mounts just the
 * `${prefix}/*` catch-all (`@objectstack/hono`'s `createHonoApp`). Its item
 * read, `PUT`, `/layers` and `/published` declared no closed query set: a
 * `GET …?member=zh-CN` was answered with the CANONICAL member, a misspelled
 * `?memeber=` the same, and a `PUT ?member=zh-CN` beside an `en-US` body wrote
 * `en-US` — each a plausible answer to a request it did not read.
 *
 * Both halves per door, as AGENTS.md route rule 5 asks:
 *  - REFUSAL — status, the nested `error.code`, the located sentence (the one
 *    `RestServer` answers, where the doors share a set), and the protocol
 *    never called;
 *  - PRESERVATION — the request the protocol actually received.
 *
 * The VALUE of `?member=` is the protocol's to judge: those pins drive a REAL
 * `ObjectStackProtocolImplementation` over an engine that is never reached
 * (`{}`), so a 400 there is the protocol's own refusal, before any store read,
 * and it must come out of this transport as itself — never swallowed by a
 * lookup's `catch` and answered by a name-keyed fallback.
 */

import { describe, it, expect, vi } from 'vitest';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
import { RestServer } from '@objectstack/rest';
import { HttpDispatcher } from '../http-dispatcher.js';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const NAME = 'acme.welcome';
/** One `email_template` bundle: the canonical member (`en-US`) and one more. */
const MEMBERS: Record<string, Record<string, unknown>> = {
    'en-US': { name: NAME, label: 'Welcome', locale: 'en-US', subject: 'Welcome', bodyHtml: '<p>en</p>' },
    'zh-CN': { name: NAME, label: 'Welcome', locale: 'zh-CN', subject: '欢迎', bodyHtml: '<p>zh</p>' },
};

/** A caller every gate before the query admits: the save door's `manage_metadata`, the draft doors' exemption. */
const AUTHOR = { userId: 'u_author', isSystem: false, systemPermissions: ['manage_metadata'] };

/**
 * The protocol, as `metadata-protocol` answers these reads for one bundle: a
 * named member's body or, for a member the bundle does not hold, the
 * item-less envelope; no member, the canonical one.
 */
function protocolDouble() {
    const envelope = (item: unknown) => ({
        type: 'email_template', name: NAME, item, lock: 'none', editable: true, deletable: true, resettable: false,
    });
    return {
        getMetaTypes: vi.fn(async () => ({ types: ['email_template', 'view', 'object'] })),
        getMetaItem: vi.fn(async ({ member }: any) => envelope(MEMBERS[member ?? 'en-US'])),
        getMetaItemLayered: vi.fn(async ({ type, name }: any) => ({
            type, name, code: MEMBERS['en-US'], overlay: null, overlayScope: null, effective: MEMBERS['en-US'],
            lock: 'none', editable: true, deletable: true, resettable: false,
        })),
        saveMetaItem: vi.fn(async (_request: unknown) => ({ success: true, version: 'v1' })),
    };
}

/** A `MetadataService` that answers every name — with the canonical member, the only one it keys. */
function metadataServiceDouble() {
    return {
        getItem: vi.fn(async () => MEMBERS['en-US']),
        getPublished: vi.fn(async () => MEMBERS['en-US']),
    };
}

// ── The dispatcher ────────────────────────────────────────────────────────────

function bootDispatcher(services: Record<string, unknown>, caller: Record<string, unknown> = AUTHOR) {
    const get = (n: string) => services[n] ?? null;
    const kernel: any = { context: { getService: get }, getService: get, getServiceAsync: async (n: string) => get(n) };
    const dispatcher = new HttpDispatcher(kernel);
    const call = async (method: string, path: string, query: Record<string, unknown> = {}, body?: unknown) => {
        const res = await dispatcher.handleMetadata(path, {
            request: { headers: {} },
            environmentId: 'platform',
            executionContext: { ...caller },
        } as any, method, body, query);
        if (!res.response) throw new Error(`the dispatcher did not handle ${method} ${path}`);
        return { status: res.response.status, body: res.response.body };
    };
    return { call };
}

// ── RestServer, the reference refusals ────────────────────────────────────────

function bootRest(protocol: unknown) {
    const server = {
        get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(), use: vi.fn(),
        listen: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined),
    };
    const rest: any = new RestServer(server as any, protocol as any, { api: { requireAuth: false }, metadata: { enableCache: false } } as any);
    rest.resolveExecCtx = async () => ({ ...AUTHOR });
    rest.registerRoutes();
    const drive = async (routePath: string, params: Record<string, string>, query: Record<string, unknown>) => {
        const route = rest.getRoutes().find((r: any) => r.method === 'GET' && r.path === routePath);
        if (!route) throw new Error(`GET ${routePath} is not registered`);
        const res: any = { statusCode: 200, headers: {} };
        res.status = (c: number) => { res.statusCode = c; return res; };
        res.json = (b: unknown) => { res.body = b; return res; };
        res.header = (k: string, v: string) => { res.headers[k] = v; return res; };
        res.send = () => res; res.setHeader = () => res; res.write = () => true; res.end = () => res;
        await route.handler({ method: 'GET', path: routePath, params, query, headers: {}, body: {} }, res);
        // The nested gates write `{ error: { code, message } }`; the route error door the flat `{ error, code }`.
        const body = res.body;
        return {
            status: res.statusCode,
            code: typeof body?.error === 'object' ? body.error.code : body?.code,
            message: typeof body?.error === 'object' ? body.error.message : body?.error,
        };
    };
    const META = '/api/v1/meta';
    return {
        item: (query: Record<string, unknown>) => drive(`${META}/:type/:name`, { type: 'email_template', name: NAME }, query),
        layers: (query: Record<string, unknown>) => drive(`${META}/:type/:name/layers`, { type: 'email_template', name: NAME }, query),
        published: (query: Record<string, unknown>) => drive(`${META}/:type/:name/published`, { type: 'email_template', name: NAME }, query),
    };
}

const ITEM = `/email_template/${NAME}`;

/** The two transports refuse one request with one code and one sentence, each in its own body. */
async function sameRefusal(
    door: 'item' | 'layers' | 'published',
    query: Record<string, unknown>,
    dispatcherAnswer: { status: number; body: any },
) {
    const reference = await bootRest(protocolDouble())[door]({ ...query });
    expect(reference.status).toBe(400);
    expect(dispatcherAnswer.status).toBe(400);
    expect(dispatcherAnswer.body?.success).toBe(false);
    expect(dispatcherAnswer.body?.error?.code).toBe(reference.code);
    expect(dispatcherAnswer.body?.error?.message).toBe(reference.message);
    return reference;
}

// ── The item read ─────────────────────────────────────────────────────────────

describe('[#23072] GET /meta/:type/:name on the dispatcher: the member selector is honoured', () => {
    it('PRESERVATION — `?member=zh-CN` reaches `getMetaItem` and answers THAT member\'s body', async () => {
        const protocol = protocolDouble();
        const { call } = bootDispatcher({ protocol });
        const answer = await call('GET', ITEM, { member: 'zh-CN', package: 'com.acme.mail' });
        expect(answer.status, JSON.stringify(answer.body)).toBe(200);
        expect(answer.body?.data?.item?.locale).toBe('zh-CN');
        expect(answer.body?.data?.item?.subject).toBe('欢迎');
        expect(protocol.getMetaItem).toHaveBeenCalledTimes(1);
        expect(protocol.getMetaItem.mock.calls[0][0]).toMatchObject({
            type: 'email_template', name: NAME, packageId: 'com.acme.mail', member: 'zh-CN',
        });
    });

    it('CONTROL — no selector sends no `member` key and answers the canonical member', async () => {
        const protocol = protocolDouble();
        const { call } = bootDispatcher({ protocol });
        const answer = await call('GET', ITEM, {});
        expect(answer.status, JSON.stringify(answer.body)).toBe(200);
        expect(answer.body?.data?.item?.locale).toBe('en-US');
        expect(Object.keys(protocol.getMetaItem.mock.calls[0][0])).not.toContain('member');
    });

    it('PRESERVATION — the draft read (`?state=draft`) and the preview (`?preview=draft`) hand the member on too', async () => {
        for (const query of [{ state: 'draft', member: 'zh-CN' }, { preview: 'draft', member: 'zh-CN' }]) {
            const protocol = protocolDouble();
            const { call } = bootDispatcher({ protocol });
            const answer = await call('GET', ITEM, query);
            expect(answer.status, `${JSON.stringify(query)}: ${JSON.stringify(answer.body)}`).toBe(200);
            expect(protocol.getMetaItem.mock.calls[0][0], JSON.stringify(query)).toMatchObject({ member: 'zh-CN' });
        }
        const protocol = protocolDouble();
        await bootDispatcher({ protocol }).call('GET', ITEM, { state: 'draft', member: 'zh-CN' });
        expect(protocol.getMetaItem.mock.calls[0][0]).toMatchObject({ state: 'draft', member: 'zh-CN' });
    });

    it('a member the bundle does not hold is ABSENT — the name-keyed MetadataService never answers it with the canonical one', async () => {
        const protocol = protocolDouble();
        const metadata = metadataServiceDouble();
        const { call } = bootDispatcher({ protocol, metadata });
        const answer = await call('GET', ITEM, { member: 'ja-JP' });
        expect(answer.status, JSON.stringify(answer.body)).toBe(404);
        expect(metadata.getItem, 'the fallback keys by name, so it can only answer the canonical member').not.toHaveBeenCalled();
    });

    it('CONTROL — with no member named, an item the protocol misses still falls through to the MetadataService', async () => {
        const protocol = { ...protocolDouble(), getMetaItem: vi.fn(async () => ({ type: 'email_template', name: NAME, item: undefined })) };
        const metadata = metadataServiceDouble();
        const answer = await bootDispatcher({ protocol, metadata }).call('GET', ITEM, {});
        expect(answer.status, JSON.stringify(answer.body)).toBe(200);
        expect(metadata.getItem).toHaveBeenCalledTimes(1);
    });
});

describe('[#23072] GET /meta/:type/:name on the dispatcher: the query decision refuses what RestServer refuses', () => {
    it('REFUSAL — a misspelled selector is the located 400, with RestServer\'s code and sentence, and nothing is read', async () => {
        const protocol = protocolDouble();
        const metadata = metadataServiceDouble();
        const answer = await bootDispatcher({ protocol, metadata }).call('GET', ITEM, { memeber: 'zh-CN' });
        const reference = await sameRefusal('item', { memeber: 'zh-CN' }, answer);
        expect(reference.code).toBe('VALIDATION_ERROR');
        expect(reference.message).toContain('"memeber" query parameter is not supported');
        expect(reference.message).toContain('Supported parameters: layers, locale, member, package, preview, state.');
        expect(protocol.getMetaItem).not.toHaveBeenCalled();
        expect(metadata.getItem).not.toHaveBeenCalled();
    });

    it('REFUSAL — a repeated selector is refused, never resolved', async () => {
        const protocol = protocolDouble();
        const answer = await bootDispatcher({ protocol }).call('GET', ITEM, { member: ['zh-CN', 'ja-JP'] });
        const reference = await sameRefusal('item', { member: ['zh-CN', 'ja-JP'] }, answer);
        expect(reference.message).toContain('"member" query parameter was supplied 2 times');
        expect(protocol.getMetaItem).not.toHaveBeenCalled();
    });

    it('PRESERVATION — a selector supplied once as a one-element array is read as that one member', async () => {
        const protocol = protocolDouble();
        const answer = await bootDispatcher({ protocol }).call('GET', ITEM, { member: ['zh-CN'] });
        expect(answer.status, JSON.stringify(answer.body)).toBe(200);
        expect(protocol.getMetaItem.mock.calls[0][0]).toMatchObject({ member: 'zh-CN' });
    });

    it('REFUSAL — a member on the layered view (`?layers=`) is refused, not answered with the canonical member\'s layers', async () => {
        const protocol = protocolDouble();
        const answer = await bootDispatcher({ protocol }).call('GET', ITEM, { layers: 'true', member: 'zh-CN' });
        const reference = await sameRefusal('item', { layers: 'true', member: 'zh-CN' }, answer);
        expect(reference.message).toContain('"member" selector is not served by the layered view');
        expect(protocol.getMetaItemLayered).not.toHaveBeenCalled();
        expect(protocol.getMetaItem).not.toHaveBeenCalled();
    });

    it('CONTROL — every name the route reads still passes the decision', async () => {
        const protocol = protocolDouble();
        const answer = await bootDispatcher({ protocol }).call('GET', ITEM, {
            state: 'active', preview: 'none', package: 'com.acme.mail', locale: 'zh-CN', layers: '', member: 'zh-CN',
        });
        expect(answer.status, JSON.stringify(answer.body)).toBe(200);
        expect(protocol.getMetaItem.mock.calls[0][0]).toMatchObject({ packageId: 'com.acme.mail', member: 'zh-CN' });
    });
});

describe('[#23072] the selector\'s VALUE is the protocol\'s refusal, and it comes out as itself', () => {
    const real = () => new ObjectStackProtocolImplementation({} as never);

    it('a selector on a type with no members: the protocol\'s located 400 — never swallowed into the MetadataService fallback', async () => {
        const protocol = real();
        const spy = vi.spyOn(protocol, 'getMetaItem');
        const metadata = metadataServiceDouble();
        const answer = await bootDispatcher({ protocol, metadata }).call('GET', '/view/task_grid', { member: 'zh-CN' });
        expect(answer.status, JSON.stringify(answer.body)).toBe(400);
        expect(answer.body?.error?.code).toBe('VALIDATION_ERROR');
        expect(answer.body?.error?.message).toMatch(
            /^The "member" selector names a bundle member, and a 'view' item has none: its identity is its name alone\./,
        );
        // Reached, and refused there: the engine (`{}`) was never read.
        expect(spy).toHaveBeenCalledTimes(1);
        expect(metadata.getItem).not.toHaveBeenCalled();
    });

    it('the `object` branch: the protocol answers a named member first, and the registry never serves its schema for it', async () => {
        const protocol = real();
        const getObject = vi.fn(() => ({ name: 'invoice', fields: {} }));
        const objectql = { registry: { getObject } };
        const answer = await bootDispatcher({ protocol, objectql }).call('GET', '/object/invoice', { member: 'zh-CN' });
        expect(answer.status, JSON.stringify(answer.body)).toBe(400);
        expect(answer.body?.error?.code).toBe('VALIDATION_ERROR');
        expect(answer.body?.error?.message).toMatch(/^The "member" selector names a bundle member, and a 'object' item has none/);
        expect(getObject).not.toHaveBeenCalled();
    });

    it('a blank selector is refused, never read as the canonical member', async () => {
        const answer = await bootDispatcher({ protocol: real(), metadata: metadataServiceDouble() })
            .call('GET', ITEM, { member: '  ' });
        expect(answer.status, JSON.stringify(answer.body)).toBe(400);
        expect(answer.body?.error?.code).toBe('VALIDATION_ERROR');
        expect(answer.body?.error?.message).toMatch(/^The "member" selector is blank\./);
    });
});

// ── /layers and /published ────────────────────────────────────────────────────

describe('[#23072] GET /meta/:type/:name/layers on the dispatcher: its closed set is `package`', () => {
    it('REFUSAL — `?member=` is the located 400 RestServer\'s `/layers` answers, before the layered read', async () => {
        const protocol = protocolDouble();
        const answer = await bootDispatcher({ protocol }).call('GET', `${ITEM}/layers`, { member: 'zh-CN' });
        const reference = await sameRefusal('layers', { member: 'zh-CN' }, answer);
        expect(reference.message).toContain('Supported parameters: package.');
        expect(protocol.getMetaItemLayered).not.toHaveBeenCalled();
    });

    it('REFUSAL — a repeated `package` is refused, never read as no package', async () => {
        const protocol = protocolDouble();
        const answer = await bootDispatcher({ protocol }).call('GET', `${ITEM}/layers`, { package: ['a', 'b'] });
        expect(answer.status).toBe(400);
        expect(answer.body?.error?.code).toBe('VALIDATION_ERROR');
        expect(answer.body?.error?.message).toContain('"package" query parameter was supplied 2 times');
        expect(protocol.getMetaItemLayered).not.toHaveBeenCalled();
    });

    it('PRESERVATION — `?package=` still scopes the layered read', async () => {
        const protocol = protocolDouble();
        const answer = await bootDispatcher({ protocol }).call('GET', `${ITEM}/layers`, { package: 'com.acme.mail' });
        expect(answer.status, JSON.stringify(answer.body)).toBe(200);
        expect(protocol.getMetaItemLayered.mock.calls[0][0]).toEqual({ type: 'email_template', name: NAME, packageId: 'com.acme.mail' });
    });
});

describe('[#23072] GET /meta/:type/:name/published on the dispatcher: its closed set is EMPTY', () => {
    it('REFUSAL — `?member=` is the located 400 RestServer\'s `/published` answers, and nothing is read', async () => {
        const protocol = protocolDouble();
        const metadata = metadataServiceDouble();
        const answer = await bootDispatcher({ protocol, metadata }).call('GET', `${ITEM}/published`, { member: 'zh-CN' });
        const reference = await sameRefusal('published', { member: 'zh-CN' }, answer);
        expect(reference.message).toContain('This endpoint takes no query parameters.');
        expect(protocol.getMetaItemLayered).not.toHaveBeenCalled();
        expect(metadata.getPublished).not.toHaveBeenCalled();
    });

    it('PRESERVATION — no query still serves the published document', async () => {
        const protocol = protocolDouble();
        const metadata = metadataServiceDouble();
        const answer = await bootDispatcher({ protocol, metadata }).call('GET', `${ITEM}/published`, {});
        expect(answer.status, JSON.stringify(answer.body)).toBe(200);
        expect(answer.body?.data?.locale).toBe('en-US');
    });
});

// ── PUT ───────────────────────────────────────────────────────────────────────

describe('[#23072] PUT /meta/:type/:name on the dispatcher: its closed set is `package` and `mode`', () => {
    const ZH_BODY = MEMBERS['zh-CN'];
    const EN_BODY = MEMBERS['en-US'];

    it('REFUSAL — `?member=zh-CN` beside an `en-US` body is the located 400, and nothing is written', async () => {
        const protocol = protocolDouble();
        const answer = await bootDispatcher({ protocol }).call('PUT', ITEM, { member: 'zh-CN' }, EN_BODY);
        expect(answer.status).toBe(400);
        expect(answer.body?.error?.code).toBe('VALIDATION_ERROR');
        expect(answer.body?.error?.message).toContain('"member" query parameter is not supported');
        expect(answer.body?.error?.message).toContain('Supported parameters: mode, package.');
        expect(protocol.saveMetaItem).not.toHaveBeenCalled();
    });

    it('REFUSAL — `?force=true` is refused here: this door takes no `force`, and dropping it answered as if unasked', async () => {
        const protocol = protocolDouble();
        const answer = await bootDispatcher({ protocol }).call('PUT', ITEM, { force: 'true' }, ZH_BODY);
        expect(answer.status).toBe(400);
        expect(answer.body?.error?.code).toBe('VALIDATION_ERROR');
        expect(answer.body?.error?.message).toContain('"force" query parameter is not supported');
        expect(protocol.saveMetaItem).not.toHaveBeenCalled();
    });

    it('REFUSAL — a repeated `mode` is refused, never read as an ACTIVE save', async () => {
        const protocol = protocolDouble();
        const answer = await bootDispatcher({ protocol }).call('PUT', ITEM, { mode: ['draft', 'active'] }, ZH_BODY);
        expect(answer.status).toBe(400);
        expect(answer.body?.error?.message).toContain('"mode" query parameter was supplied 2 times');
        expect(protocol.saveMetaItem).not.toHaveBeenCalled();
    });

    it('REFUSAL — the capability gate still answers first: a caller who may not save learns nothing from the query', async () => {
        const protocol = protocolDouble();
        const answer = await bootDispatcher({ protocol }, { userId: 'u_member', isSystem: false, systemPermissions: [] })
            .call('PUT', ITEM, { member: 'zh-CN' }, ZH_BODY);
        expect(answer.status).toBe(403);
        expect(protocol.saveMetaItem).not.toHaveBeenCalled();
    });

    it('PRESERVATION — `package` and `mode` still reach `saveMetaItem`, the body\'s member written', async () => {
        const protocol = protocolDouble();
        const answer = await bootDispatcher({ protocol }).call('PUT', ITEM, { package: 'com.acme.mail', mode: 'draft' }, ZH_BODY);
        expect(answer.status, JSON.stringify(answer.body)).toBe(200);
        expect(protocol.saveMetaItem).toHaveBeenCalledTimes(1);
        expect(protocol.saveMetaItem.mock.calls[0][0]).toMatchObject({
            type: 'email_template', name: NAME, item: ZH_BODY, packageId: 'com.acme.mail', mode: 'draft',
        });
    });
});
