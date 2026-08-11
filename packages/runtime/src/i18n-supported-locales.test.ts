// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `GET /i18n/locales` reports the locales the APP declared (#7679).
 *
 * WHAT WENT WRONG
 *
 * The showcase declares `i18n.supportedLocales = ['en','zh-CN']` and the route
 * answered with four descriptors — `en`, `zh-CN`, `ja-JP`, `es-ES`. Nothing
 * was broken in the envelope (#3636 fixed that) and nothing was broken in the
 * loading either: every platform plugin (platform-objects, service-settings,
 * service-storage, service-messaging, service-realtime, plugin-security,
 * plugin-sharing, plugin-webhooks) ships an `en/zh-CN/ja-JP/es-ES` bundle and
 * pushes it at `kernel:ready`, which is what a platform should do.
 *
 * The defect was that the LOADED set was reported as the OFFERED set. Those
 * are different facts owned by different parties: what is loaded is decided by
 * whichever plugins are installed, while what is offered is the app author's
 * declaration. A picker built from this route — the platform's own
 * Settings > Localization select included — therefore offered `ja-JP` and
 * `es-ES`, in which only `sys_*` objects are translated. Picking one gives a
 * mixed-language session for every piece of metadata the app owns.
 *
 * WHY THE TEST LOOKS LIKE THIS
 *
 * The two halves of the bug live in two packages — `AppPlugin` is the only
 * layer that can see `supportedLocales`, and `getLocales()` is the only thing
 * the route reads — so a unit test on either half alone can pass while the
 * route still answers wrong. This suite wires the real `AppPlugin`, the real
 * `createMemoryI18n` provider and the real dispatcher domain together and
 * asserts the BODY, which is the thing the issue is actually about.
 *
 * It also reproduces the LIFECYCLE ORDER, which is load-bearing: the app
 * plugin declares during its own `start`, and the platform bundles arrive
 * afterwards at `kernel:ready`. Any implementation that narrows by pruning
 * what is stored passes a naive test and fails here.
 */

import { describe, it, expect, vi } from 'vitest';
import { AppPlugin } from './app-plugin.js';
import { HttpDispatcher } from './http-dispatcher.js';
import { createMemoryI18n } from '@objectstack/core';
import { GetLocalesResponseSchema } from '@objectstack/spec/api';
import type { PluginContext } from '@objectstack/core';

/** The `en/zh-CN/ja-JP/es-ES` bundle every platform plugin pushes. */
const PLATFORM_BUNDLE: Record<string, Record<string, unknown>> = {
    'en': { objects: { sys_user: { label: 'User' } } },
    'zh-CN': { objects: { sys_user: { label: '用户' } } },
    'ja-JP': { objects: { sys_user: { label: 'ユーザー' } } },
    'es-ES': { objects: { sys_user: { label: 'Usuario' } } },
};

/** The app's own bundle — only the locales the showcase actually authors. */
const APP_BUNDLE: Record<string, Record<string, unknown>> = {
    'en': { objects: { property: { label: 'Property' } } },
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

/**
 * Boot the shape the issue describes: an app declaring `i18nConfig`, started
 * FIRST, with the platform's four-locale bundle pushed AFTERWARDS the way the
 * `kernel:ready` hooks do it.
 */
async function bootStack(i18nConfig: Record<string, unknown> | undefined) {
    const i18n = createMemoryI18n();
    const ctx = makeContext(i18n);

    const plugin = new AppPlugin({
        id: 'com.test.showcase',
        ...(i18nConfig ? { i18n: i18nConfig } : {}),
        translations: [APP_BUNDLE],
    });
    await plugin.start!(ctx);

    // …then `kernel:ready`, where the platform plugins push theirs.
    for (const [locale, data] of Object.entries(PLATFORM_BUNDLE)) {
        i18n.loadTranslations(locale, data);
    }

    const kernel = {
        getService: vi.fn(async (name: string) => (name === 'i18n' ? i18n : null)),
        services: new Map(),
        context: { getService: (name: string) => (name === 'i18n' ? i18n : null) },
    };
    return { i18n, ctx, dispatcher: new HttpDispatcher(kernel as never) };
}

/** `GET /i18n/locales`, parsed with the schema that declares its body. */
async function getLocales(dispatcher: HttpDispatcher) {
    const result = await dispatcher.handleI18n('/locales', 'GET', {}, { request: {} } as never);
    expect(result.response?.status).toBe(200);
    const parsed = GetLocalesResponseSchema.safeParse(result.response?.body?.data);
    expect(
        parsed.success,
        `locales body does not match its declared schema: ${JSON.stringify(parsed.error?.issues)}`,
    ).toBe(true);
    return parsed.data!.locales;
}

describe('GET /i18n/locales reports the app\'s declared supportedLocales (#7679)', () => {
    it('an app declaring two locales is not offered four', async () => {
        const { dispatcher } = await bootStack({ defaultLocale: 'en', supportedLocales: ['en', 'zh-CN'] });

        expect(await getLocales(dispatcher)).toEqual([
            { code: 'en', label: 'en', isDefault: true },
            { code: 'zh-CN', label: 'zh-CN', isDefault: false },
        ]);
    });

    it('the platform locales the app never opted into are gone from the body', async () => {
        // Stated as its own assertion because this is the user-visible harm:
        // `ja-JP` and `es-ES` are real and servable, so nothing else about the
        // response looks wrong — they simply translate `sys_*` and nothing the
        // app owns, which is what makes the picker offering them a trap.
        const { dispatcher } = await bootStack({ defaultLocale: 'en', supportedLocales: ['en', 'zh-CN'] });
        const codes = (await getLocales(dispatcher)).map((l) => l.code);

        expect(codes).not.toContain('ja-JP');
        expect(codes).not.toContain('es-ES');
    });

    it('narrowing survives bundles pushed after the app plugin declared', async () => {
        // The lifecycle order in one assertion: the four platform locales are
        // loaded by `bootStack` AFTER `AppPlugin.start` has run. A narrowing
        // implemented as a prune of what is stored would report them all.
        const { i18n, dispatcher } = await bootStack({ defaultLocale: 'en', supportedLocales: ['en', 'zh-CN'] });

        i18n.loadTranslations('ko-KR', { objects: { sys_user: { label: '사용자' } } });
        expect((await getLocales(dispatcher)).map((l) => l.code)).toEqual(['en', 'zh-CN']);
    });

    it('DECISION 1 — an app declaring no i18n block still sees every loaded locale', async () => {
        // The compatibility half. Every app written before #7679 declared
        // nothing, and each one must keep the answer it has today; narrowing
        // an undeclared app to zero — or to its default alone — would empty
        // the picker on a stack whose author never opted into anything.
        const { dispatcher } = await bootStack(undefined);
        const codes = (await getLocales(dispatcher)).map((l) => l.code).sort();

        expect(codes).toEqual(['en', 'es-ES', 'ja-JP', 'zh-CN']);
    });

    it('DECISION 1 — an i18n block with a defaultLocale but no supportedLocales does not narrow', async () => {
        const { dispatcher } = await bootStack({ defaultLocale: 'zh-CN' });
        const locales = await getLocales(dispatcher);

        expect(locales.map((l) => l.code).sort()).toEqual(['en', 'es-ES', 'ja-JP', 'zh-CN']);
        // …and the locale it DID declare is still threaded, unchanged.
        expect(locales.find((l) => l.code === 'zh-CN')?.isDefault).toBe(true);
    });

    it('DECISION 2 — a declared locale with no bundle is reported, not silently dropped', async () => {
        // `fr-FR` is declared by the app and shipped by nobody. It is reported
        // because the declaration is the app's statement of intent and the
        // client is entitled to see it; intersecting it away would hide the
        // authoring gap from the author AND from the client, and would make
        // the body depend on how many bundles had loaded when it was built.
        const { dispatcher } = await bootStack({
            defaultLocale: 'en',
            supportedLocales: ['en', 'zh-CN', 'fr-FR'],
        });

        expect((await getLocales(dispatcher)).map((l) => l.code)).toEqual(['en', 'zh-CN', 'fr-FR']);
    });

    it('the reported set narrows but the translations stay servable', async () => {
        // Out of scope for #7679 and pinned so the fix is not "completed" by
        // unloading bundles: `GET /i18n/translations/ja-JP` still answers.
        const { dispatcher } = await bootStack({ defaultLocale: 'en', supportedLocales: ['en', 'zh-CN'] });

        const result = await dispatcher.handleI18n('/translations/ja-JP', 'GET', {}, { request: {} } as never);
        expect(result.response?.status).toBe(200);
        expect(result.response?.body?.data?.translations)
            .toEqual({ objects: { sys_user: { label: 'ユーザー' } } });
    });

    it('the declared order is the reported order', async () => {
        // Authored order, not the insertion order of whichever plugin loaded
        // first — a picker rendering the app's own ordering is the useful
        // default, and the previous order was an accident of registration.
        const { dispatcher } = await bootStack({
            defaultLocale: 'zh-CN',
            supportedLocales: ['zh-CN', 'en'],
        });

        expect(await getLocales(dispatcher)).toEqual([
            { code: 'zh-CN', label: 'zh-CN', isDefault: true },
            { code: 'en', label: 'en', isDefault: false },
        ]);
    });
});
