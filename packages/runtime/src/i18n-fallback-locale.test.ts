// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The declared `i18n.fallbackLocale` reaches the kernel's in-memory i18n
 * provider (#15694).
 *
 * WHAT WENT WRONG
 *
 * `i18n.fallbackLocale` is authorable on the stack artifact
 * (`TranslationConfigSchema`), and `FileI18nAdapter` — the provider
 * `I18nServicePlugin` installs — has always honoured it: `os serve` and the
 * dev plugin construct it with `fallbackLocale || defaultLocale || 'en'`, and
 * its `t()` consults that locale after the requested one.
 *
 * The kernel's in-memory fallback is constructed with nothing. `AppPlugin`
 * injected `defaultLocale` (#4058-era) and `supportedLocales` (#7679) into
 * whichever `i18n` service was registered, but never `fallbackLocale`, and the
 * provider had no setter to receive one. So on a stack running the fallback —
 * which is every stack that declares `translations` without installing
 * `@objectstack/service-i18n` (not installed, or `tierEnabled('i18n')` false) —
 * the declaration was INERT.
 *
 * A stack declaring `defaultLocale: 'zh-CN'` with `fallbackLocale: 'en'`
 * therefore answered a missing `zh-CN` key from `en` under `I18nServicePlugin`
 * and from `zh-CN` — i.e. not at all — under the fallback. One declaration,
 * two providers, two answers. That the fallback self-declares `degraded`
 * licenses FEWER capabilities, not a different answer to the same declared key.
 *
 * WHY THE TEST LOOKS LIKE THIS
 *
 * The two halves live in two packages — `AppPlugin` is the only layer that can
 * see the declaration, and `t()` is the only thing that acts on it — so a unit
 * test on either half alone passes while the stack still answers wrong. This
 * suite wires the real `AppPlugin` to the real `createMemoryI18n` provider and
 * asserts what `t()` returns, which is the thing the issue is about. The
 * provider's own semantics are pinned next to it in
 * `packages/core/src/fallbacks/fallbacks.test.ts`; the contrast surface
 * (`FileI18nAdapter`'s second leg) is pinned in service-i18n's own suite and is
 * deliberately untouched by this card.
 */

import { describe, it, expect, vi } from 'vitest';
import { AppPlugin } from './app-plugin.js';
import { createMemoryI18n } from '@objectstack/core';
import type { PluginContext } from '@objectstack/core';

/** `en` carries a key the `zh-CN` bundle never got — the card's scenario. */
const APP_BUNDLE: Record<string, Record<string, unknown>> = {
    'en': { objects: { property: { label: 'Property', tip: 'Only in English' } } },
    'zh-CN': { objects: { property: { label: '房源' } } },
};

function makeContext(i18n: unknown): PluginContext {
    return {
        logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
        registerService: vi.fn(),
        getService: vi.fn((name: string) => {
            if (name === 'i18n') return i18n;
            if (name === 'objectql') return { registry: {} };
            return undefined;
        }),
        getServices: vi.fn(),
        hook: vi.fn(),
        trigger: vi.fn(),
    } as unknown as PluginContext;
}

/** Start a real `AppPlugin` declaring `i18nConfig`, against a real provider. */
async function bootStack(i18nConfig: Record<string, unknown> | undefined, i18n: unknown = createMemoryI18n()) {
    const ctx = makeContext(i18n);
    const plugin = new AppPlugin({
        id: 'com.test.showcase',
        ...(i18nConfig ? { i18n: i18nConfig } : {}),
        translations: [APP_BUNDLE],
    });
    await plugin.start!(ctx);
    return { i18n: i18n as ReturnType<typeof createMemoryI18n>, ctx };
}

describe('AppPlugin threads the declared i18n.fallbackLocale (#15694)', () => {
    it('a missing zh-CN key is answered from the declared en fallback', async () => {
        // The card in one assertion. Pre-fix this returned the KEY: the
        // declaration never left the stack artifact.
        const { i18n } = await bootStack({
            defaultLocale: 'zh-CN',
            supportedLocales: ['zh-CN', 'en'],
            fallbackLocale: 'en',
        });

        expect(i18n.t('objects.property.tip', 'zh-CN')).toBe('Only in English');
    });

    it('one declaration, one answer — the key the zh-CN bundle DOES carry is unchanged', async () => {
        const { i18n } = await bootStack({
            defaultLocale: 'zh-CN',
            supportedLocales: ['zh-CN', 'en'],
            fallbackLocale: 'en',
        });

        expect(i18n.t('objects.property.label', 'zh-CN')).toBe('房源');
    });

    it('DECISION — an app declaring no fallbackLocale keeps the answer it has today', async () => {
        // Every stack written before this declared nothing. Defaulting the
        // fallback for them would be a new chain nobody asked for, not a fix.
        const { i18n } = await bootStack({ defaultLocale: 'zh-CN', supportedLocales: ['zh-CN', 'en'] });

        expect(i18n.t('objects.property.tip', 'zh-CN')).toBe('objects.property.tip');
    });

    it('an app declaring no i18n block at all is untouched', async () => {
        const { i18n } = await bootStack(undefined);

        expect(i18n.t('objects.property.tip', 'zh-CN')).toBe('objects.property.tip');
        expect(i18n.t('objects.property.label', 'zh-CN')).toBe('房源');
    });

    it('the injection is an OPTIONAL capability — a provider without the setter still boots', async () => {
        // Same probe shape `setDefaultLocale` and `setSupportedLocales` use: a
        // provider that has not implemented it keeps today's behaviour rather
        // than taking the stack down. `FileI18nAdapter` is exactly such a
        // provider — it is CONSTRUCTED with its fallback and has no setter.
        const bare = {
            loadTranslations: vi.fn(),
            t: vi.fn(() => 'x'),
            getTranslations: vi.fn(() => ({})),
            getLocales: vi.fn(() => []),
        };

        await expect(bootStack({ defaultLocale: 'zh-CN', fallbackLocale: 'en' }, bare)).resolves.toBeDefined();
        expect(bare.loadTranslations).toHaveBeenCalled();
    });

    it('the declaration is threaded exactly once, with the value the app declared', async () => {
        const spy = { ...createMemoryI18n(), setFallbackLocale: vi.fn() };
        await bootStack({ defaultLocale: 'zh-CN', fallbackLocale: 'en' }, spy);

        expect(spy.setFallbackLocale).toHaveBeenCalledTimes(1);
        expect(spy.setFallbackLocale).toHaveBeenCalledWith('en');
    });
});
