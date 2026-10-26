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
 *
 * The translation bundle is the one face a browser revalidates: it carries an
 * `ETag` and `Cache-Control: private, no-cache`, and a matching
 * `If-None-Match` is answered `304` with no body (#25785, see
 * {@link translationsAnswer}).
 */

import { createHash } from 'node:crypto';
import {
    resolveLocale,
    shouldDenyAnonymous, ANONYMOUS_DENY_STATUS, ANONYMOUS_DENY_CODE, ANONYMOUS_DENY_MESSAGE,
} from '@objectstack/core';
import { CoreServiceName, resolveObjectFieldLabels, toLocaleDescriptors } from '@objectstack/spec/system';
import { isServiceServeable } from '../service-serveable.js';
import type { TranslationData } from '@objectstack/spec/system';
import type { HttpProtocolContext, HttpDispatcherResult } from '../http-dispatcher.js';
import type { DomainHandlerDeps, DomainRoute } from '../domain-handler-registry.js';
// [#23214] The repo's one sentence for a repeated single-valued parameter.
import { repeatedQueryParamMessage } from '@objectstack/rest';

/**
 * [#23214] `?locale=` on the two arms whose PATH names no locale
 * (`/translations?locale=`, `/labels/:object?locale=`): ONE locale. A repeat
 * reached `getTranslations` and `resolveLocale` as an array, and the latter's
 * `toLowerCase()` threw, so the caller was answered a 500. Refused instead with
 * the multiplicity sentence, before any i18n call; a one-element array is one
 * occurrence and an empty one is none.
 */
function readQueryLocale(deps: DomainHandlerDeps, query: any): { locale: any } | { refused: HttpDispatcherResult } {
    const raw = query?.locale;
    if (!Array.isArray(raw)) return { locale: raw };
    if (raw.length > 1) {
        return {
            refused: {
                handled: true,
                response: deps.error(repeatedQueryParamMessage('locale', raw.length), 400, { code: 'VALIDATION_ERROR' }),
            },
        };
    }
    return { locale: raw[0] };
}

/**
 * [#25785] The bundle's cache directive. `no-cache` lets the browser store the
 * bundle but makes it ask again on every use, so an unchanged bundle costs a
 * `304` and a changed one (an authored translation, a package installed) is
 * served the moment it changes; a TTL would pin the old strings until it ran
 * out. `private`, because the bundle is served to a signed-in caller only (see
 * the floor in {@link handleI18nRequest}) and names the application's own
 * objects: no shared cache may keep it.
 */
const TRANSLATIONS_CACHE_CONTROL = 'private, no-cache';

/**
 * One request header, read from either shape a transport hands in: a Fetch
 * `Headers` (the `@objectstack/hono` catch-all hands its raw `Request`) or a
 * plain record (`plugin-hono-server`'s `IHttpRequest`). `Headers.get` answers
 * `null` for an absent header; that is folded to `undefined`, the record's
 * absence, and a repeated header in the record shape is one comma list, as
 * RFC 9110 §5.3 reads it.
 */
function requestHeader(headers: unknown, lower: string): string | undefined {
    if (!headers || typeof headers !== 'object') return undefined;
    const h = headers as { get?: unknown } & Record<string, unknown>;
    const raw = typeof h.get === 'function' ? (h.get as (name: string) => unknown).call(headers, lower) : h[lower];
    if (typeof raw === 'string') return raw;
    if (Array.isArray(raw)) return raw.filter((v) => typeof v === 'string').join(', ');
    return undefined;
}

/**
 * [#25785] Does `If-None-Match` name the representation this request would be
 * served? RFC 9110 §13.1.2: a comma list of entity tags compared WEAKLY (the
 * `W/` prefix is ignored on both sides), or `*`, which any current
 * representation matches. A malformed member matches nothing, so the caller is
 * served the full bundle: the safe direction.
 */
function ifNoneMatchHits(header: string | undefined, etag: string): boolean {
    if (header === undefined) return false;
    const opaque = etag.replace(/^W\//, '');
    return header.split(',').some((member) => {
        const tag = member.trim();
        return tag === '*' || tag.replace(/^W\//, '') === opaque;
    });
}

/**
 * [#25785] Answer a translations read with its validator. Every console open
 * read the whole locale bundle again (80–88 KB compressed on a hosted tenant)
 * because nothing let the browser revalidate it.
 *
 * ⛔ The ONE invariant: the validator is a hash of the bytes this answer
 * serves — the whole success envelope, `locale` and `requestedLocale`
 * included — computed on every request. A `304` is answered only on an exact
 * match over those bytes, so a caller is only ever pinned to the bundle it
 * really holds, whatever changed underneath it (an authored translation, a
 * package, the environment the request resolved to). Hashing anything cheaper
 * than the body — a version counter, the bundle object's identity — would
 * break that silently: a missed bump is a stale `304`, and nothing reports it.
 * It is weak (`W/`) because it vouches for the JSON, not for the encoding a
 * compressing layer puts on the wire.
 *
 * The `304` carries the same `ETag` and `Cache-Control` the `200` would
 * (RFC 9110 §15.4.5) and no body: `body` is left out, which both transports
 * write as a body-less response (`JSON.stringify(undefined)` is `undefined`),
 * pinned over a real socket in `i18n-translations-etag.hono.integration.test.ts`.
 */
function translationsAnswer(
    deps: DomainHandlerDeps,
    data: Record<string, unknown>,
    context: HttpProtocolContext,
): HttpDispatcherResult {
    const response = deps.success(data);
    const etag = `W/"${createHash('sha256').update(JSON.stringify(response.body)).digest('base64url')}"`;
    const headers = { ETag: etag, 'Cache-Control': TRANSLATIONS_CACHE_CONTROL };
    if (ifNoneMatchHits(requestHeader(context?.request?.headers, 'if-none-match'), etag)) {
        return { handled: true, response: { status: 304, headers } };
    }
    return { handled: true, response: { ...response, headers } };
}

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
        let locale = parts[1] ? decodeURIComponent(parts[1]) : undefined;
        if (!parts[1]) {
            const read = readQueryLocale(deps, query);
            if ('refused' in read) return read.refused;
            locale = read.locale;
        }
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
                return translationsAnswer(deps, { locale: resolved, requestedLocale: locale, translations }, context);
            }
        }

        return translationsAnswer(deps, { locale, translations }, context);
    }

    // GET /i18n/labels/:object/:locale  OR  /i18n/labels/:object?locale=xx
    if (parts[0] === 'labels' && parts.length >= 2) {
        const objectName = decodeURIComponent(parts[1]);
        let locale = parts[2] ? decodeURIComponent(parts[2]) : undefined;
        if (!parts[2]) {
            const read = readQueryLocale(deps, query);
            if ('refused' in read) return read.refused;
            locale = read.locale;
        }
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
