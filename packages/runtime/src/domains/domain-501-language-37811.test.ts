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
 *  2. a source walk over `src/domains/`: no `deps.error(…, 501)` is left
 *     outside the two modules that build one on purpose, so a new fixed-English
 *     `501` fails here and is written through the catalog instead.
 */

import { describe, it, expect, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { BUILTIN_OPERATION_MESSAGES } from '@objectstack/spec/system';
import { HttpDispatcher } from '../http-dispatcher.js';

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

/** Every `deps.error(` call in `source` whose status argument is the literal `501`. */
function literal501Calls(source: string): string[] {
    const out: string[] = [];
    let from = 0;
    for (;;) {
        const at = source.indexOf('deps.error(', from);
        if (at < 0) return out;
        let depth = 0;
        let end = at + 'deps.error'.length;
        for (; end < source.length; end++) {
            const c = source[end];
            if (c === '(') depth++;
            else if (c === ')' && --depth === 0) break;
        }
        const call = source.slice(at, end + 1);
        if (/,\s*501\s*[,)]/.test(call)) out.push(call.replace(/\s+/g, ' ').slice(0, 160));
        from = end + 1;
    }
}

describe('#37811 · 2 · no fixed-English 501 is left in the domain modules', () => {
    // The two modules that build a 501 from `deps.error` on purpose:
    //  - `own-door-bridge.ts` is `localizedNotImplemented`, the builder every
    //    localized 501 goes through;
    //  - `unavailable.ts` is `capabilityUnavailable`, whose sentence is the
    //    discovery remedy (`serviceUnavailableMessage`, `services.<slot>.message`)
    //    by contract, byte for byte: it stays English while discovery is English.
    // The MCP resume door's `501` (`mcp.ts`, `resumeDoorError`) is not a
    // `deps.error` call either: it is thrown into the resume tool's error
    // mapping, read by the calling agent beside the door's other English
    // refusals, and it stays English.
    const BUILDERS = new Set(['own-door-bridge.ts', 'unavailable.ts']);
    const dir = new URL('./', import.meta.url);
    const modules = readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts') && !BUILDERS.has(f));

    it('walks the domain modules (a guard against an empty walk)', () => {
        expect(modules).toEqual(expect.arrayContaining(['auth.ts', 'meta.ts', 'packages.ts', 'automation.ts', 'security.ts']));
    });

    it.each(modules)('%s answers no deps.error(…, 501): its 501s go through catalogNotImplemented', (file) => {
        expect(literal501Calls(readFileSync(new URL(file, dir), 'utf8'))).toEqual([]);
    });
});
