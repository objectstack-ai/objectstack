// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `/i18n` domain — extracted dispatcher body (ADR-0076 D11 step ③, PR-2).
 * Serves translations / locales / labels from whatever provides the `i18n`
 * service slot: I18nServicePlugin (service-i18n) when installed, or the
 * AppPlugin in-memory fallback auto-registered for stacks that declare
 * translation bundles — multi-provider slot, so route registration stays
 * dispatcher-owned (moving it into one provider would 404 the other).
 *
 * Routes (path is the sub-path after `/i18n`):
 *   GET /locales                    → getLocales
 *   GET /translations/:locale       → getTranslations (locale from path)
 *   GET /translations?locale=xx     → getTranslations (locale from query)
 *   GET /labels/:object/:locale     → getFieldLabels  (both from path)
 *   GET /labels/:object?locale=xx   → getFieldLabels  (locale from query)
 *
 * Every one of those answers is for an authenticated caller: an anonymous one
 * is refused before the slot is consulted (ADR-0056 D2, see the first
 * statement of {@link handleI18nRequest}). The translation bundle carries the
 * labels of the application's objects, fields, apps and pages, so it stands on
 * the same floor as the metadata it translates. A client renders its sign-in
 * page from its own built-in strings and reads this domain once it holds a
 * session.
 */

import {
    resolveLocale,
    shouldDenyAnonymous, ANONYMOUS_DENY_STATUS, ANONYMOUS_DENY_CODE, ANONYMOUS_DENY_MESSAGE,
} from '@objectstack/core';
import { CoreServiceName, resolveObjectFieldLabels, toLocaleDescriptors } from '@objectstack/spec/system';
import { isServiceServeable } from '../service-serveable.js';
import type { TranslationData } from '@objectstack/spec/system';
import type { HttpProtocolContext, HttpDispatcherResult } from '../http-dispatcher.js';
import type { DomainHandlerDeps, DomainRoute } from '../domain-handler-registry.js';

export function createI18nDomain(deps: DomainHandlerDeps): DomainRoute {
    return {
        prefix: '/i18n',
        handler: (req, context) =>
            handleI18nRequest(deps, req.path.substring(5), req.method, req.query, context),
    };
}

/** Body kept signature-compatible with the legacy `HttpDispatcher.handleI18n`. */
export async function handleI18nRequest(
    deps: DomainHandlerDeps,
    path: string,
    method: string,
    query: any,
    context: HttpProtocolContext,
): Promise<HttpDispatcherResult> {
    // [#22432] ANONYMOUS BASELINE (ADR-0056 D2) — the FIRST statement, ahead
    // of the service-availability probe and every route below, in the hoisted
    // form `domains/analytics.ts` and `domains/security.ts` use. The bundle
    // this domain serves names every object, field, app, page and dashboard
    // the application declares, and the metadata read of the same object
    // already answers an anonymous caller 401; ADR-0138 D2's door classes and
    // the control-plane allowlist name no translation door.
    //
    // Why here and nowhere else: every `/i18n` face (locales, translations,
    // field labels, both spellings of each) converges on this ONE handler
    // body, whichever transport delivered it, so a single domain-wide gate
    // covers them all and a face added later cannot arrive ungated. ⛔ No
    // second gate at the dispatcher mount.
    //
    // Why ahead of the probe: an anonymous caller must not learn from a 501
    // versus a 401 whether this deployment carries an i18n provider, nor from
    // a 400 which parameters a route reads.
    //
    // The dispatcher hands an unauthenticated request to this handler as the
    // guest envelope (`assembleExecutionContextOrGuest`), which carries no
    // `userId`; an unresolved context carries none either. Both are denied.
    // A client renders its sign-in page from its own built-in strings and
    // reads this domain once it holds a session.
    const ec = context?.executionContext;
    if (shouldDenyAnonymous({ userId: ec?.userId, isSystem: ec?.isSystem, method })) {
        return {
            handled: true,
            response: deps.error(ANONYMOUS_DENY_MESSAGE, ANONYMOUS_DENY_STATUS, { code: ANONYMOUS_DENY_CODE }),
        };
    }

    const i18nService = await deps.getService(context, CoreServiceName.enum.i18n);
    // [#4058] An empty slot and a slot filled by a self-declared non-handler
    // (`handlerReady: false`, ADR-0076 D12) are the same amount of i18n. Both
    // in-memory providers of this slot really translate, so both declare
    // `degraded` (#4058 step 1 — `createMemoryI18n`, which plugin-dev also
    // wraps) and `handlerReady` defaults to `true` for them: they keep serving.
    // This gate is for an occupant that would answer with invented strings.
    if (!isServiceServeable(i18nService)) return { handled: true, response: deps.error('i18n service not available', 501) };

    const m = method.toUpperCase();
    const parts = path.replace(/^\/+/, '').split('/').filter(Boolean);

    if (m !== 'GET') return { handled: false };

    // GET /i18n/locales
    if (parts[0] === 'locales' && parts.length === 1) {
        // Descriptors, not the raw `string[]` `getLocales()` hands back —
        // that is what `GetLocalesResponseSchema` declares and what
        // service-i18n already emitted for this same route. Passing the bare
        // array through made one endpoint answer in two shapes depending on
        // which provider mounted it, the dispatcher's contradicting the SDK's
        // own `GetLocalesResponse` type.
        const locales = toLocaleDescriptors(
            i18nService.getLocales(),
            typeof i18nService.getDefaultLocale === 'function' ? i18nService.getDefaultLocale() : undefined,
        );
        return { handled: true, response: deps.success({ locales }) };
    }

    // GET /i18n/translations/:locale  OR  /i18n/translations?locale=xx
    if (parts[0] === 'translations') {
        const locale = parts[1] ? decodeURIComponent(parts[1]) : query?.locale;
        if (!locale) return { handled: true, response: deps.error('Missing locale parameter', 400) };

        let translations = i18nService.getTranslations(locale);

        // Locale fallback: try resolving to an available locale when
        // the exact code yields empty translations (e.g. zh → zh-CN).
        if (Object.keys(translations).length === 0) {
            const availableLocales = typeof i18nService.getLocales === 'function'
                ? i18nService.getLocales() : [];
            const resolved = resolveLocale(locale, availableLocales);
            if (resolved && resolved !== locale) {
                translations = i18nService.getTranslations(resolved);
                return { handled: true, response: deps.success({ locale: resolved, requestedLocale: locale, translations }) };
            }
        }

        return { handled: true, response: deps.success({ locale, translations }) };
    }

    // GET /i18n/labels/:object/:locale  OR  /i18n/labels/:object?locale=xx
    if (parts[0] === 'labels' && parts.length >= 2) {
        const objectName = decodeURIComponent(parts[1]);
        let locale = parts[2] ? decodeURIComponent(parts[2]) : query?.locale;
        if (!locale) return { handled: true, response: deps.error('Missing locale parameter', 400) };

        // Locale fallback for labels endpoint
        const availableLocales = typeof i18nService.getLocales === 'function'
            ? i18nService.getLocales() : [];
        const resolved = resolveLocale(locale, availableLocales);
        if (resolved) locale = resolved;

        if (typeof i18nService.getFieldLabels === 'function') {
            const labels = i18nService.getFieldLabels(objectName, locale);
            return { handled: true, response: deps.success({ object: objectName, locale, labels }) };
        }
        // Fallback: derive field labels from the locale's translation bundle.
        // This is not really a fallback — `getFieldLabels` is optional on
        // `II18nService` and nothing implements it, so this is the path every
        // provider takes. [#4127] That first clause only became TRUE with this
        // change: the method was probed here and in service-i18n while the
        // contract never declared it. Declared now, so the probe reads an
        // optional capability instead of a second, unwritten contract.
        // Shared with service-i18n's identical derivation so
        // the next bundle-shape change cannot fix one copy and miss the other,
        // which is how this one went on scanning the retired flat
        // `o.<object>.fields.<field>` dialect after #3778 and returned `{}`
        // for every provider (#3833).
        const translations = i18nService.getTranslations(locale) as TranslationData | undefined;
        const labels = resolveObjectFieldLabels(translations, objectName);
        return { handled: true, response: deps.success({ object: objectName, locale, labels }) };
    }

    return { handled: false };
}
