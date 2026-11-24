// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * objectstack#36809 — `GET /i18n/locales` names the deployment's DECLARED
 * fallback chain (`fallbackChain`), produced from the i18n service's
 * `getFallbackLocale()`: the accessor the server's own metadata translations
 * read to hand the spec resolvers their `fallbackChain`
 * (`metaTranslateOptions`, `@objectstack/rest`). The console reads it to walk
 * the same locales for the strings it resolves itself (its flow labels).
 *
 * Pinned: the member is the accessor's answer, wrapped as a one-entry chain;
 * a service that declares no fallback (no accessor, or one answering nothing)
 * serves no member, never an invented `en` or default; the body still parses
 * as `GetLocalesResponseSchema`.
 */

import { describe, it, expect, vi } from 'vitest';
import { createMemoryI18n } from '@objectstack/core';
import { GetLocalesResponseSchema } from '@objectstack/spec/api';

import { handleI18nRequest } from './i18n.js';
import { apiErrorResponse } from '../error-envelope.js';
import type { DomainHandlerDeps } from '../domain-handler-registry.js';
import type { HttpProtocolContext } from '../http-dispatcher.js';

const member = () => ({
    request: { headers: {} },
    executionContext: { userId: 'usr_member', isSystem: false, positions: [], permissions: [], systemPermissions: [] },
}) as unknown as HttpProtocolContext;

function makeDeps(service: unknown): DomainHandlerDeps {
    return {
        getService: vi.fn(async () => service),
        resolveService: vi.fn(async () => service),
        success: (data: any) => ({ status: 200, body: { success: true, data } }),
        error: (message: string, httpStatus = 500, details?: any) => apiErrorResponse({ message, httpStatus, details }),
    } as unknown as DomainHandlerDeps;
}

async function readLocales(service: unknown) {
    const result: any = await handleI18nRequest(makeDeps(service), '/locales', 'GET', {}, member());
    expect(result.handled).toBe(true);
    expect(result.response.status).toBe(200);
    const parsed = GetLocalesResponseSchema.safeParse(result.response.body.data);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    return result.response.body.data as Record<string, unknown>;
}

function serviceWith(extra: Record<string, unknown>) {
    return {
        getLocales: vi.fn(() => ['zh-CN', 'en']),
        getDefaultLocale: vi.fn(() => 'zh-CN'),
        getTranslations: vi.fn(() => ({})),
        ...extra,
    };
}

describe('GET /i18n/locales names the declared fallback chain (objectstack#36809)', () => {
    it('is produced from getFallbackLocale(): the declared fallback, as a one-entry chain', async () => {
        const getFallbackLocale = vi.fn(() => 'en');
        const data = await readLocales(serviceWith({ getFallbackLocale }));
        expect(getFallbackLocale).toHaveBeenCalled();
        expect(data.fallbackChain).toEqual(['en']);
        // Beside the authored language the resolvers take as `defaultLocale`.
        expect(data.sourceLocale).toBe('zh-CN');
    });

    it('follows the accessor, not a constant: another declared fallback is served as declared', async () => {
        const data = await readLocales(serviceWith({ getFallbackLocale: () => 'ja-JP' }));
        expect(data.fallbackChain).toEqual(['ja-JP']);
    });

    it.each([
        ['a service with no getFallbackLocale accessor', {}],
        ['an accessor answering undefined', { getFallbackLocale: () => undefined }],
        ['an accessor answering an empty string', { getFallbackLocale: () => '' }],
    ])('%s serves no fallbackChain member', async (_label, extra) => {
        const data = await readLocales(serviceWith(extra));
        expect('fallbackChain' in data).toBe(false);
    });

    it('the core in-memory provider, which declares no accessor, serves none even when told a fallback', async () => {
        const i18n = createMemoryI18n();
        i18n.setDefaultLocale?.('zh-CN');
        i18n.setFallbackLocale?.('en');
        const data = await readLocales(i18n);
        expect('fallbackChain' in data).toBe(false);
    });
});
