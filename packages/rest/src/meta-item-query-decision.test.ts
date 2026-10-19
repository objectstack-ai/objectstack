// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23072] THE query decision of the by-name `/meta` doors —
 * `metaItemQueryRefusal` in `./meta-item-read-gate.ts`, ruling 6138588561
 * (option B) — and `RestServer`'s item read re-pointed at it.
 *
 * The decision is DATA: the rule that refused, `400 VALIDATION_ERROR` and the
 * sentence. Each transport writes it in its own envelope, so this file pins
 * the decision itself (every door's set, the arity of its single-valued names,
 * the item read's refusal of a member on the layered view, and their order)
 * and that `RestServer`'s item read writes exactly the decision — the nested
 * body for the first two rules, its route error door's flat body for the third,
 * as before (`rest-server-meta-member-selector.test.ts`, unchanged, pins the
 * same answers from the request side).
 */

import { describe, it, expect, vi } from 'vitest';
// `.js` on purpose — NodeNext resolution requires the extension.
import {
    META_ITEM_LAYERS_PARAMS,
    META_ITEM_PUBLISHED_PARAMS,
    META_ITEM_READ_PARAMS,
    META_ITEM_SAVE_PARAMS,
    metaItemQueryRefusal,
    metaMemberSelector,
} from './meta-item-read-gate.js';
import { RestServer } from './rest-server.js';
import { unknownQueryParamMessage } from './query-allowlist.js';
import { repeatedQueryParamMessage } from './query-multiplicity.js';

const LAYERED_MEMBER = 'The "member" selector is not served by the layered view (`?layers=`), which shows the '
    + 'canonical member\'s layers. Read one member with `?member=` alone.';

const refusal = (rule: string, message: string) => ({ status: 400, code: 'VALIDATION_ERROR', message, rule });

describe('[#23072] metaItemQueryRefusal — each door\'s closed set', () => {
    it('the measured sets: the item read\'s six, `/layers`\' one, `/published`\' none, and the dispatcher save\'s three (no `force`)', () => {
        expect([...META_ITEM_READ_PARAMS].sort()).toEqual(['layers', 'locale', 'member', 'package', 'preview', 'state']);
        expect([...META_ITEM_LAYERS_PARAMS]).toEqual(['package']);
        expect([...META_ITEM_PUBLISHED_PARAMS]).toEqual([]);
        // RestServer's own save door reads `force`; the dispatcher's does not.
        // [#24395] `surface` joined both save doors' sets.
        expect([...META_ITEM_SAVE_PARAMS].sort()).toEqual(['force', 'mode', 'package', 'surface']);
        expect(metaItemQueryRefusal('save', { force: 'true' })).toEqual(refusal(
            'unknown-parameter', unknownQueryParamMessage(['force'], ['mode', 'package', 'surface']),
        ));
        expect(metaItemQueryRefusal('save', { surface: 'studio', mode: 'draft' })).toBeUndefined();
        expect(metaItemQueryRefusal('save', { surface: ['studio', 'api'] })?.rule).toBe('repeated-parameter');
    });

    const DOORS = [
        { door: 'item', set: META_ITEM_READ_PARAMS },
        { door: 'layers', set: META_ITEM_LAYERS_PARAMS },
        { door: 'published', set: META_ITEM_PUBLISHED_PARAMS },
        { door: 'save', set: ['package', 'mode', 'surface'] },
    ] as const;

    for (const { door, set } of DOORS) {
        it(`${door}: an unread name is refused with the located sentence, every unknown name and every accepted one in it`, () => {
            expect(metaItemQueryRefusal(door, { memeber: 'zh-CN' })).toEqual(refusal(
                'unknown-parameter', unknownQueryParamMessage(['memeber'], [...set].sort()),
            ));
            // Sorted, whatever order the adapter built the object in.
            expect(metaItemQueryRefusal(door, { zeta: '1', alpha: '2' })?.message)
                .toBe(unknownQueryParamMessage(['alpha', 'zeta'], [...set].sort()));
        });

        it(`${door}: every name it reads passes, and so does a query that is no object at all`, () => {
            // `layers` empty: the plain read, so the member beside it is not rule 3's case.
            expect(metaItemQueryRefusal(door, Object.fromEntries(set.map((n) => [n, n === 'layers' ? '' : 'x']))))
                .toBeUndefined();
            expect(metaItemQueryRefusal(door, {})).toBeUndefined();
            expect(metaItemQueryRefusal(door, undefined)).toBeUndefined();
            expect(metaItemQueryRefusal(door, 'member=zh-CN')).toBeUndefined();
        });
    }

    it('`member` is refused by every door that does not read it — the layered view, the published document and the body-addressed save', () => {
        for (const door of ['layers', 'published', 'save'] as const) {
            expect(metaItemQueryRefusal(door, { member: 'zh-CN' })?.rule, door).toBe('unknown-parameter');
        }
        expect(metaItemQueryRefusal('item', { member: 'zh-CN' })).toBeUndefined();
    });
});

describe('[#23072] metaItemQueryRefusal — arity, and the order of the three rules', () => {
    it('a single-valued name supplied twice is the multiplicity rule\'s sentence', () => {
        expect(metaItemQueryRefusal('item', { member: ['zh-CN', 'ja-JP'] })).toEqual(refusal(
            'repeated-parameter', repeatedQueryParamMessage('member', 2),
        ));
        expect(metaItemQueryRefusal('layers', { package: ['a', 'b', 'c'] })).toEqual(refusal(
            'repeated-parameter', repeatedQueryParamMessage('package', 3),
        ));
        expect(metaItemQueryRefusal('save', { mode: ['draft', 'active'] })?.message)
            .toBe(repeatedQueryParamMessage('mode', 2));
    });

    it('`locale` stays outside the item read\'s arity declaration, as on RestServer: its reader sends a repeat to the default', () => {
        expect(metaItemQueryRefusal('item', { locale: ['zh-CN', 'ja-JP'] })).toBeUndefined();
    });

    it('a name supplied once as a one-element array is unwrapped IN PLACE, so the reads after it see the string', () => {
        const query: Record<string, unknown> = { member: ['zh-CN'], package: ['com.acme.mail'] };
        expect(metaItemQueryRefusal('item', query)).toBeUndefined();
        expect(query).toEqual({ member: 'zh-CN', package: 'com.acme.mail' });
        expect(metaMemberSelector(query)).toEqual({ member: 'zh-CN' });
    });

    it('item: a member on the layered view is refused with RestServer\'s sentence; the empty flag is the plain read', () => {
        expect(metaItemQueryRefusal('item', { layers: 'true', member: 'zh-CN' })).toEqual(refusal('layered-member', LAYERED_MEMBER));
        expect(metaItemQueryRefusal('item', { layers: '', member: 'zh-CN' })).toBeUndefined();
        expect(metaItemQueryRefusal('item', { layers: 'true' })).toBeUndefined();
    });

    it('recognition outranks arity, and arity outranks the layered rule', () => {
        expect(metaItemQueryRefusal('item', { memeber: 'x', member: ['a', 'b'], layers: 'true' })?.rule).toBe('unknown-parameter');
        expect(metaItemQueryRefusal('item', { member: ['a', 'b'], layers: 'true' })?.rule).toBe('repeated-parameter');
    });
});

describe('[#22877 · #23072] metaMemberSelector — the one reading of the selector', () => {
    it('a named member, no member, and a non-string handed over as received for the protocol to refuse', () => {
        expect(metaMemberSelector({ member: 'zh-CN' })).toEqual({ member: 'zh-CN' });
        expect(metaMemberSelector({})).toEqual({});
        expect(metaMemberSelector(undefined)).toEqual({});
        expect(metaMemberSelector({ member: { nested: 'x' } })).toEqual({ member: { nested: 'x' } });
    });
});

// ── RestServer's item read writes exactly the decision ────────────────────────

function bootRest() {
    const protocol: any = {
        getDiscovery: vi.fn().mockResolvedValue({ version: 'v0', routes: { data: '', metadata: '', ui: '', auth: '/auth' } }),
        getMetaTypes: vi.fn().mockResolvedValue([]),
        getMetaItems: vi.fn().mockResolvedValue({ items: [] }),
        getMetaItem: vi.fn().mockResolvedValue({ type: 'email_template', name: 'acme.welcome', item: { name: 'acme.welcome' } }),
        getMetaItemLayered: vi.fn().mockResolvedValue({ type: 'email_template', name: 'acme.welcome', code: null, overlay: null, effective: null }),
    };
    const server = {
        get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), patch: vi.fn(), use: vi.fn(),
        listen: vi.fn().mockResolvedValue(undefined), close: vi.fn().mockResolvedValue(undefined),
    };
    const rest: any = new RestServer(server as any, protocol, { api: { requireAuth: false }, metadata: { enableCache: false } } as any);
    rest.resolveExecCtx = async () => ({ isSystem: true, userId: 'u1' });
    rest.registerRoutes();
    const route = rest.getRoutes().find((r: any) => r.method === 'GET' && r.path === '/api/v1/meta/:type/:name');
    const read = async (query: Record<string, unknown>) => {
        const res: any = { statusCode: 200 };
        res.status = (c: number) => { res.statusCode = c; return res; };
        res.json = (b: unknown) => { res.body = b; return res; };
        res.header = () => res; res.send = () => res; res.setHeader = () => res;
        await route.handler({ method: 'GET', path: '/api/v1/meta/email_template/acme.welcome', params: { type: 'email_template', name: 'acme.welcome' }, query, headers: {}, body: {} }, res);
        return { status: res.statusCode, body: res.body };
    };
    return { protocol, read };
}

describe('[#23072] RestServer\'s item read is re-pointed at the decision, its answers unchanged', () => {
    it('rules 1 and 2: the nested `{ error: { code, message } }` its recognition and arity gates wrote, byte for byte', async () => {
        for (const query of [{ memeber: 'zh-CN' }, { member: ['zh-CN', 'ja-JP'] }, { state: ['draft', 'active'] }]) {
            const decided = metaItemQueryRefusal('item', JSON.parse(JSON.stringify(query)))!;
            const { protocol, read } = bootRest();
            const answer = await read(query);
            expect(answer.status).toBe(400);
            expect(JSON.stringify(answer.body)).toBe(JSON.stringify({ error: { code: decided.code, message: decided.message } }));
            expect(protocol.getMetaItem).not.toHaveBeenCalled();
        }
    });

    it('rule 3: thrown to the route error door, which writes its flat body with the decision\'s code and sentence', async () => {
        const { protocol, read } = bootRest();
        const answer = await read({ layers: 'true', member: 'zh-CN' });
        expect(answer.status).toBe(400);
        expect(answer.body?.code).toBe('VALIDATION_ERROR');
        expect(answer.body?.error).toBe(LAYERED_MEMBER);
        expect(protocol.getMetaItemLayered).not.toHaveBeenCalled();
        expect(protocol.getMetaItem).not.toHaveBeenCalled();
    });

    it('CONTROL: a query the decision passes reaches the protocol with the member it named', async () => {
        const { protocol, read } = bootRest();
        const answer = await read({ member: ['zh-CN'], locale: 'zh-CN' });
        expect(answer.status, JSON.stringify(answer.body)).toBe(200);
        expect(protocol.getMetaItem.mock.calls[0][0]).toMatchObject({ member: 'zh-CN' });
    });
});
