// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#37811 — the dispatcher domains' remaining `501`s answer in the
 * request's language.
 *
 * #37721 and #37737 localized the own doors' `501`s and gave them
 * `Vary: Accept-Language`. The other domain modules still answered every
 * reader in fixed English. Each of those sentences is now a key of the
 * operation-message catalog (`@objectstack/spec/system`), rendered by
 * `catalogNotImplemented` (`own-door-bridge.ts`) in the request's top
 * `Accept-Language` tag, with the header.
 *
 * Most doors pin their language case beside their existing `501` test (the
 * `[#37811]` blocks in the automation, activation, packages, `/meta`, clone
 * and `/i18n` door tests). This file pins:
 *
 *  1. the doors that had no `501` fixture: `/auth`, `/mcp`, the `/meta`
 *     layered read and save, `/share-links`, the `/security` reopen, and the
 *     `/automation` run list, resume and flow clone;
 *  2. a source walk over `src/domains/`: no `501` is written in code outside
 *     the one module that builds one on purpose, except the reasoned
 *     exemptions it names, so a new fixed-English `501` fails here and is
 *     written through the catalog instead (#37864 widened it from a literal
 *     `deps.error(…, 501)` to every `501` in code, strings and comments
 *     stripped);
 *  3. [#37864] `capabilityUnavailable`, the mounted-but-unimplemented `501`
 *     of `/ai`, `/automation`, `/notifications` and `/ui`, in the request's
 *     language, its English held equal to discovery's
 *     `serviceUnavailableMessage(slot)` for every slot; and the `/mcp/skill`
 *     door's own language case.
 */

import { describe, it, expect, vi } from 'vitest';
// [#37811] Paid at collection: the dispatcher's reach loads `@objectstack/metadata` (check:test-source-alias).
import '@objectstack/metadata';
import { readFileSync, readdirSync } from 'node:fs';
import { BUILTIN_OPERATION_MESSAGES, CoreServiceName, serviceUnavailableMessage } from '@objectstack/spec/system';
import { HttpDispatcher } from '../http-dispatcher.js';
import { capabilityUnavailableMessage } from './unavailable.js';

const LANGS = [
    ['en', {}],
    ['ja-JP', { 'accept-language': 'ja-JP,ja;q=0.9' }],
] as const;

const sentence = (locale: 'en' | 'ja-JP', key: string): string => BUILTIN_OPERATION_MESSAGES[locale][key];

function dispatcherWith(services: Record<string, unknown>): HttpDispatcher {
    const resolve = (name: string) => services[name];
    const kernel: any = {
        getService: resolve,
        getServiceAsync: async (name: string) => resolve(name),
        context: { getService: resolve },
    };
    return new HttpDispatcher(kernel);
}

const ADMIN = (headers: Record<string, string>): any => ({
    request: { headers },
    executionContext: {
        userId: 'u_admin',
        positions: [],
        systemPermissions: ['manage_metadata', 'studio.access', 'setup.access', 'manage_security', 'manage_automation'],
    },
});

function expectLocalized501(result: { response?: any }, locale: 'en' | 'ja-JP', key: string): void {
    expect(result.response?.status, key).toBe(501);
    expect(result.response?.body?.error?.code, key).toBe('NOT_IMPLEMENTED');
    expect(result.response?.body?.error?.message, key).toBe(sentence(locale, key));
    expect(result.response?.headers?.Vary, key).toBe('Accept-Language');
}

describe('#37811 · 1 · the doors with no 501 fixture of their own', () => {
    it('/auth with no auth service: auth_service_unavailable', async () => {
        for (const [locale, headers] of LANGS) {
            const result = await dispatcherWith({}).handleAuth('/sign-in/email', 'POST', {}, ADMIN(headers));
            expectLocalized501(result, locale, 'auth_service_unavailable');
        }
    });

    it('/mcp with no MCP server registered: mcp_server_unavailable', async () => {
        for (const [locale, headers] of LANGS) {
            const result = await dispatcherWith({}).handleMcp({ jsonrpc: '2.0', id: 1, method: 'ping' }, ADMIN(headers));
            expectLocalized501(result, locale, 'mcp_server_unavailable');
        }
    });

    it('/meta/:type/:name/layers on a protocol without the layered read: meta_layered_view_unsupported', async () => {
        for (const [locale, headers] of LANGS) {
            const result = await dispatcherWith({ protocol: { someUnrelatedVerb: () => undefined } })
                .handleMetadata('/page/home/layers', ADMIN(headers), 'GET', undefined, {});
            expectLocalized501(result, locale, 'meta_layered_view_unsupported');
        }
    });

    it('a conditional /meta save on a host with no protocol save: meta_save_conditions_unsupported', async () => {
        for (const [locale, headers] of LANGS) {
            const result = await dispatcherWith({})
                .handleMetadata('/page/home', ADMIN({ ...headers, 'if-match': '"v1"' }), 'PUT', { name: 'home', label: 'Home' }, {});
            expectLocalized501(result, locale, 'meta_save_conditions_unsupported');
        }
    });

    it('a /meta save on a host with neither a protocol nor a metadata service save: meta_save_unsupported', async () => {
        for (const [locale, headers] of LANGS) {
            const result = await dispatcherWith({})
                .handleMetadata('/page/home', ADMIN(headers), 'PUT', { name: 'home', label: 'Home' }, {});
            expectLocalized501(result, locale, 'meta_save_unsupported');
        }
    });

    it('/share-links with no share-link service: share_links_unconfigured', async () => {
        for (const [locale, headers] of LANGS) {
            const result = await dispatcherWith({}).handleShareLinks('', 'GET', undefined, {}, ADMIN(headers));
            expectLocalized501(result, locale, 'share_links_unconfigured');
        }
    });

    it('/security suggested-binding reopen on a service without it: security_audience_reopen_unsupported', async () => {
        const security = {
            listAudienceBindingSuggestions: vi.fn(),
            confirmAudienceBindingSuggestion: vi.fn(),
            dismissAudienceBindingSuggestion: vi.fn(),
        };
        for (const [locale, headers] of LANGS) {
            const result = await dispatcherWith({ security })
                .handleSecurity('/suggested-bindings/s_1/reopen', 'POST', undefined, {}, ADMIN(headers));
            expectLocalized501(result, locale, 'security_audience_reopen_unsupported');
        }
    });

    it('/automation on a service without the run list, resume or clone members', async () => {
        const automation = {
            handlerReady: true,
            registerFlow: vi.fn(),
            unregisterFlow: vi.fn(),
            listFlows: async () => ['flow_a'],
            getFlow: async (name: string) =>
                (name === 'flow_a' ? { name, label: 'Flow A', type: 'autolaunched', nodes: [{ id: 'start', type: 'start' }], edges: [] } : null),
        };
        for (const [locale, headers] of LANGS) {
            const d = dispatcherWith({ automation });
            expectLocalized501(await d.handleAutomation('/flow_a/runs', 'GET', undefined, ADMIN(headers), {}), locale, 'automation_runs_list_unsupported');
            expectLocalized501(await d.handleAutomation('/flow_a/runs/run_1/resume', 'POST', {}, ADMIN(headers)), locale, 'automation_resume_unsupported');
            expectLocalized501(
                await d.handleAutomation('/flow_a/clone', 'POST', { name: 'flow_b', label: 'Flow B' }, ADMIN(headers)),
                locale,
                'automation_flow_clone_unsupported',
            );
        }
    });
});

/**
 * `source` with every comment and string literal blanked out (each character
 * replaced by a space, newlines kept), so what is left is code: a `501` in a
 * message or a comment is not a status, and a parenthesis inside a string
 * cannot unbalance anything. Template literals are blanked too, their `${…}`
 * holes kept as code.
 */
function codeOnly(source: string): string {
    const out = source.split('');
    const blank = (from: number, to: number): void => {
        for (let k = from; k < to; k++) if (out[k] !== '\n') out[k] = ' ';
    };
    // A stack of open template literals: each entry is the brace depth of the
    // `${` hole the scan is in (0 = in the template's text).
    const templates: number[] = [];
    let i = 0;
    while (i < source.length) {
        const c = source[i];
        const next = source[i + 1];
        const inTemplateText = templates.length > 0 && templates[templates.length - 1] === 0;
        if (inTemplateText) {
            if (c === '\\') { blank(i, i + 2); i += 2; continue; }
            if (c === '`') { templates.pop(); blank(i, i + 1); i++; continue; }
            if (c === '$' && next === '{') { templates[templates.length - 1] = 1; i += 2; continue; }
            blank(i, i + 1); i++; continue;
        }
        if (c === '/' && next === '/') {
            const end = source.indexOf('\n', i);
            const stop = end < 0 ? source.length : end;
            blank(i, stop); i = stop; continue;
        }
        if (c === '/' && next === '*') {
            const end = source.indexOf('*/', i + 2);
            const stop = end < 0 ? source.length : end + 2;
            blank(i, stop); i = stop; continue;
        }
        if (c === '\'' || c === '"') {
            let j = i + 1;
            while (j < source.length && source[j] !== c && source[j] !== '\n') j += source[j] === '\\' ? 2 : 1;
            blank(i, j + 1); i = j + 1; continue;
        }
        if (c === '`') { templates.push(0); blank(i, i + 1); i++; continue; }
        if (templates.length > 0) {
            if (c === '{') templates[templates.length - 1]++;
            else if (c === '}' && --templates[templates.length - 1] === 0) { i++; continue; }
        }
        i++;
    }
    return out.join('');
}

/** Every `501` written in code in `source`, each with the last 160 characters of code up to it (whitespace collapsed). */
function code501Sites(source: string): string[] {
    const code = codeOnly(source);
    const out: string[] = [];
    for (const m of code.matchAll(/(?<![\w.])501(?![\w.])/g)) {
        const before = code.slice(0, m.index! + 3).replace(/\s+/g, ' ');
        out.push(before.slice(-160).trim());
    }
    return out;
}

describe('#37811 · 2 · no fixed-English 501 is left in the domain modules', () => {
    // The one module that builds a 501 from `deps.error` on purpose:
    // `own-door-bridge.ts` is `localizedNotImplemented`, the builder every
    // localized 501 goes through. [#37864] `unavailable.ts` is no longer one:
    // `capabilityUnavailable` answers through `catalogNotImplemented` too.
    const BUILDERS = new Set(['own-door-bridge.ts']);
    // [#37864] The `501`s in code that are not a fixed English sentence of a
    // domain's own, each matched by the code just before it and each with its
    // reason. A site that matches none of these fails; an exemption that
    // matches nothing fails too, so the list cannot outlive its sites.
    const EXEMPT: ReadonlyArray<{ file: string; before: RegExp; reason: string }> = [
        {
            file: 'meta.ts',
            before: /deps\.errorFromThrown\(e, 501$/,
            reason: 'the metadata service threw: the message is that error\'s own, 501 only its fallback status',
        },
        {
            file: 'mcp.ts',
            before: /throw resumeDoorError\( deps,[ +,]*501$/,
            reason: 'thrown into the resume tool\'s error mapping and read by the calling agent beside the door\'s other English refusals: it stays English',
        },
        {
            file: 'permission-set-clone.ts',
            before: /\{ statusCode: 501$/,
            reason: 'a catalog messageKey (PAIR_UNSUPPORTED_KEY), rendered in the request\'s language where it is answered',
        },
        {
            file: 'permission-set-clone.ts',
            before: /thrown\?\.statusCode === 501$/,
            reason: 'reads that same throw back, it answers nothing',
        },
    ];
    const dir = new URL('./', import.meta.url);
    const modules = readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && !BUILDERS.has(f));
    const sitesOf = (file: string): string[] => code501Sites(readFileSync(new URL(file, dir), 'utf8'));

    it('walks the domain modules (a guard against an empty walk)', () => {
        expect(modules).toEqual(expect.arrayContaining(['auth.ts', 'meta.ts', 'packages.ts', 'automation.ts', 'security.ts', 'unavailable.ts']));
    });

    it('sees a 501 through any call, and none inside a string or a comment (the walker itself)', () => {
        expect(code501Sites('return deps.error(\'a (b\', 501);')).toHaveLength(1);
        expect(code501Sites('return deps.errorFromThrown(e, 501);')).toHaveLength(1);
        expect(code501Sites('return respond501(ctx, 501);')).toHaveLength(1);
        expect(code501Sites('const s = `${x ? 501 : 0}`;')).toHaveLength(1);
        expect(code501Sites('const s = \'501 Not Implemented\'; // 501\n/* 501 */ const t = "(501"; const u = `501 ${y}`;')).toEqual([]);
        expect(code501Sites('const v = 5010; const w = x.501;')).toEqual([]);
    });

    it.each(modules)('%s writes no 501 in code but the exempted ones: its 501s go through catalogNotImplemented', (file) => {
        const unexplained = sitesOf(file).filter((site) => !EXEMPT.some((e) => e.file === file && e.before.test(site)));
        expect(unexplained).toEqual([]);
    });

    it.each(EXEMPT.map((e) => [e.file, e.before.source, e] as const))('the exemption in %s (%s) still names exactly one site', (_file, _src, e) => {
        expect(sitesOf(e.file).filter((site) => e.before.test(site))).toHaveLength(1);
    });
});

/** The catalog sentence for `key` in `locale`, its `{{params}}` filled. */
const rendered = (locale: string, key: string, params: Record<string, string> = {}): string =>
    BUILTIN_OPERATION_MESSAGES[locale][key].replace(/\{\{(\w+)\}\}/g, (_m, name: string) => params[name] ?? '');

describe('#37864 · 3 · capabilityUnavailable follows the request\'s language; its English stays discovery\'s', () => {
    const CAPABILITY_KEYS = Object.keys(BUILTIN_OPERATION_MESSAGES.en).filter((key) => key.startsWith('capability_unavailable_'));
    const placeholders = (template: string): string[] => [...template.matchAll(/\{\{(\w+)\}\}/g)].map((m) => m[1]).sort();

    it('the English of every CoreServiceName slot is serviceUnavailableMessage(slot), byte for byte', () => {
        // The drift half: discovery stays English (`services.<slot>.message`),
        // the 501 renders the catalog, and the two must name the same remedy.
        // A slot given a sentence of its own in `core-services.zod.ts` fails
        // here until `unavailable.ts` maps it to a key.
        expect(CoreServiceName.options.length).toBeGreaterThan(10);
        for (const slot of [...CoreServiceName.options, 'not-a-real-slot']) {
            expect(capabilityUnavailableMessage(slot), slot).toBe(serviceUnavailableMessage(slot));
            expect(capabilityUnavailableMessage(slot, 'en-US'), slot).toBe(serviceUnavailableMessage(slot));
        }
    });

    it('names the five keys, each translated in every locale with the English placeholders kept', () => {
        expect(CAPABILITY_KEYS.sort()).toEqual([
            'capability_unavailable_ai',
            'capability_unavailable_install',
            'capability_unavailable_search',
            'capability_unavailable_ui',
            'capability_unavailable_unshipped',
        ]);
        for (const key of CAPABILITY_KEYS) {
            const en = BUILTIN_OPERATION_MESSAGES.en[key];
            for (const locale of ['zh-CN', 'ja-JP', 'es-ES']) {
                const text = BUILTIN_OPERATION_MESSAGES[locale][key];
                expect(text, `${locale} ${key}`).toBeTruthy();
                expect(text, `${locale} ${key}`).not.toBe(en);
                expect(placeholders(text), `${locale} ${key}`).toEqual(placeholders(en));
            }
        }
    });

    it('every slot renders a non-English sentence in each catalog locale, its package and slot names untranslated', () => {
        for (const slot of CoreServiceName.options) {
            for (const locale of ['zh-CN', 'ja-JP', 'es-ES']) {
                const text = capabilityUnavailableMessage(slot, locale);
                expect(text, `${locale} ${slot}`).not.toBe(serviceUnavailableMessage(slot));
                expect(text, `${locale} ${slot}`).not.toMatch(/\{\{/);
            }
        }
        expect(capabilityUnavailableMessage('notification', 'zh-CN')).toContain('@objectstack/service-messaging');
        expect(capabilityUnavailableMessage('not-a-real-slot', 'ja-JP')).toContain('not-a-real-slot');
    });

    const LANGS3 = [
        ['en', {}],
        ['ja-JP', { 'accept-language': 'ja-JP,ja;q=0.9' }],
        ['zh-CN', { 'accept-language': 'zh-CN' }],
    ] as const;
    // Each door with nothing behind it, as the dispatcher reaches it.
    const DOORS: ReadonlyArray<readonly [string, string, (d: HttpDispatcher, ctx: any) => Promise<{ response?: any }>]> = [
        ['/ai', 'ai', (d, ctx) => d.handleAI('/ai/models', 'GET', undefined, {}, ctx)],
        ['/automation', 'automation', (d, ctx) => d.handleAutomation('', 'GET', undefined, ctx, {})],
        ['/notifications', 'notification', (d, ctx) => d.handleNotification('', 'GET', undefined, {}, ctx)],
        ['/ui', 'ui', (d, ctx) => d.handleUi('/view/account', {}, ctx)],
    ];

    it.each(DOORS)('%s with no %s service: 501, NOT_IMPLEMENTED, the slot\'s sentence in the request\'s language, Vary', async (_door, slot, call) => {
        for (const [locale, headers] of LANGS3) {
            const result = await call(dispatcherWith({}), ADMIN(headers));
            expect(result.response?.status, locale).toBe(501);
            expect(result.response?.body?.error?.code, locale).toBe('NOT_IMPLEMENTED');
            expect(result.response?.body?.error?.message, locale).toBe(capabilityUnavailableMessage(slot, locale));
            expect(result.response?.headers?.Vary, locale).toBe('Accept-Language');
        }
        // No header: the English discovery reports, byte for byte.
        const plain = await call(dispatcherWith({}), ADMIN({}));
        expect(plain.response?.body?.error?.message).toBe(serviceUnavailableMessage(slot));
    });

    it('/mcp/skill with no MCP server registered: mcp_server_unavailable in the request\'s language (N2)', async () => {
        for (const [locale, headers] of LANGS3) {
            const result = await dispatcherWith({}).handleMcpSkill('GET', ADMIN(headers));
            expect(result.response?.status, locale).toBe(501);
            expect(result.response?.body?.error?.code, locale).toBe('NOT_IMPLEMENTED');
            expect(result.response?.body?.error?.message, locale).toBe(rendered(locale, 'mcp_server_unavailable'));
            expect(result.response?.headers?.Vary, locale).toBe('Accept-Language');
        }
    });
});
