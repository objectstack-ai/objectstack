// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { TranslationCoverageResult, TranslationDiffItem } from '../system/translation.zod';

/**
 * II18nService - Internationalization Service Contract
 *
 * Defines the interface for translation and locale management in ObjectStack.
 * Concrete implementations (i18next, custom, etc.)
 * should implement this interface.
 *
 * Follows Dependency Inversion Principle - plugins depend on this interface,
 * not on concrete i18n library implementations.
 *
 * Aligned with CoreServiceName 'i18n' in core-services.zod.ts.
 */

export interface II18nService {
    /**
     * Translate a message key for a given locale
     * @param key - Translation key (e.g. 'o.account.label')
     * @param locale - BCP-47 locale code (e.g. 'en-US', 'zh-CN')
     * @param params - Optional interpolation parameters
     * @returns Translated string, or the key itself if not found
     */
    t(key: string, locale: string, params?: Record<string, unknown>): string;

    /**
     * Get all translations for a locale
     * @param locale - BCP-47 locale code
     * @returns Translation data map
     */
    getTranslations(locale: string): Record<string, unknown>;

    /**
     * Load translations for a locale
     * @param locale - BCP-47 locale code
     * @param translations - Translation key-value data
     */
    loadTranslations(locale: string, translations: Record<string, unknown>): void;

    /**
     * List available locales
     * @returns Array of BCP-47 locale codes
     */
    getLocales(): string[];

    /**
     * Get the current default locale
     *
     * [#15711] Also the language the deployment's metadata labels are
     * authored in: the serving layer threads it into the document
     * translators' `ResolveOptions.defaultLocale` (`@objectstack/spec/system`),
     * so a request for the default locale answers with the authored label
     * instead of walking the declared fallback chain — the authored label IS
     * the default locale's text. Absent, no request is treated as the default.
     * @returns BCP-47 locale code
     */
    getDefaultLocale?(): string;

    /**
     * Set the default locale
     * @param locale - BCP-47 locale code
     */
    setDefaultLocale?(locale: string): void;

    /**
     * The locale `t()` consults after the requested one — the deployment's
     * DECLARED fallback (`i18n.fallbackLocale`, else `defaultLocale`, the
     * collapse both boot paths perform before constructing the service:
     * `os serve` and the dev plugin hand `I18nServicePlugin`
     * `fallbackLocale || defaultLocale || 'en'`).
     *
     * [#14882] Declared so the serving layer can thread it into the
     * metadata-document translators (`@objectstack/spec/system`'s
     * `ResolveOptions.fallbackChain`). Those resolvers walk
     * `requested locale → fallback chain → authored label`, and without this
     * accessor no caller could tell them what the deployment declared, so the
     * chain fell to the resolver's literal `['en']`: a `zh-CN` workspace that
     * shipped a courtesy `en` bundle served ENGLISH bundle text to a `zh-CN`
     * request, ahead of its own authored Chinese labels, because `en` was
     * consulted before the authored label was ever reached.
     *
     * Contract for the value: it is the locale this service's own `t()` falls
     * back to, so a label resolved from a bundle by the document translators
     * and a message resolved by `t()` agree on which locale is consulted
     * second. `undefined` means NOTHING was declared — a provider that has no
     * fallback of its own omits the method or answers `undefined`, and the
     * serving layer then leaves the resolver's own default in place rather
     * than inventing a chain. [#15711] That default is `[]` (requested
     * locale, then the authored label), and a request for
     * {@link getDefaultLocale} never walks this chain at all.
     *
     * @returns BCP-47 locale code, or `undefined` when no fallback is declared
     */
    getFallbackLocale?(): string | undefined;

    /**
     * Set the locale `t()` consults after the requested one — the app's
     * DECLARED `i18n.fallbackLocale`.
     *
     * [#15694] The INJECTION counterpart of {@link getFallbackLocale}, and the
     * same threading `setDefaultLocale` and `setSupportedLocales` already get
     * from `AppPlugin.loadTranslations`: the declaration lives on the stack
     * artifact, which only the runtime app-plugin layer can see, so a provider
     * built without it (the kernel's in-memory fallback, auto-registered when
     * no i18n plugin is installed) has no other way to learn it. A provider
     * constructed WITH it — `FileI18nAdapter`, which both boot paths build
     * with `fallbackLocale || defaultLocale || 'en'` — omits this method and
     * keeps the value it was built with. It does implement `setDefaultLocale`
     * and `setSupportedLocales`; omitting a setter is per-value, not
     * per-provider.
     *
     * Why it exists: `i18n.fallbackLocale` is authorable
     * (`TranslationConfigSchema`), and until this was threaded it was INERT on
     * the in-memory provider. A stack declaring `defaultLocale: 'zh-CN'` with
     * `fallbackLocale: 'en'` answered a missing `zh-CN` key from `en` under
     * `I18nServicePlugin` and from `zh-CN` — i.e. not at all — under the
     * fallback. One declaration, two providers, two answers.
     *
     * Semantics implementations must honour:
     * - The value is the SECOND locale `t()` consults, per KEY, after the
     *   requested one — the same shape `FileI18nAdapter.t()` has. Not a
     *   whole-bundle swap: a requested locale that HAS a bundle but is missing
     *   the key must still reach the fallback.
     * - Never called means no declaration, which must keep the provider's
     *   existing behaviour exactly. An app that declares no `i18n.fallbackLocale`
     *   is not opting into a new chain.
     *
     * ⛔ Implementing this does NOT oblige implementing {@link getFallbackLocale}.
     * They answer different questions — what the provider was TOLD versus what
     * the serving layer may ASK it — and a provider whose accessor would have
     * to invent a value it was never given must keep omitting the accessor, so
     * the document translators fall to their own default rather than to a
     * derived one (#14882).
     *
     * @param locale - BCP-47 locale code
     */
    setFallbackLocale?(locale: string): void;

    /**
     * Narrow what `getLocales()` reports to the locales the APP declared
     * (`i18n.supportedLocales` on the stack artifact).
     *
     * [#7679] `getLocales()` on its own can only report what is LOADED, and
     * what is loaded is not the app's decision: every platform plugin pushes
     * its own `en/zh-CN/ja-JP/es-ES` bundle at `kernel:ready`, so a showcase
     * declaring `['en','zh-CN']` advertised four locales on
     * `GET /i18n/locales`. A picker built from that route then offers locales
     * in which only `sys_*` metadata is translated — a guaranteed
     * mixed-language session for everything the app owns.
     *
     * The declared set is only visible at the runtime app-plugin layer, which
     * is why it arrives here by injection rather than being read: this is the
     * same threading `setDefaultLocale` already gets from
     * `AppPlugin.loadTranslations`.
     *
     * Implementations MUST apply this as a filter at READ time, not as a prune
     * of what is stored. Bundles keep arriving after the app plugin has run
     * (the platform plugins' `kernel:ready` push), so a one-shot prune would
     * narrow only whatever happened to be loaded first. Narrowing is about
     * what is REPORTED; the extra bundles stay loaded and stay servable.
     *
     * Semantics implementations must honour, both covered by tests:
     * - Absent, empty, or a non-array → NO narrowing. An app that declares
     *   nothing keeps today's behaviour (report every loaded locale);
     *   narrowing it to zero or to the default alone would silently regress
     *   every app that never opted in.
     * - A declared locale with no loaded bundle is still REPORTED
     *   (declared-but-unserved), not silently intersected away. The
     *   declaration is the app's statement of intent, and a client that is
     *   handed a quietly shortened list has no way to see the gap. It also
     *   keeps the answer independent of plugin load order, which an
     *   intersection cannot be.
     *
     * @param locales - Declared BCP-47 locale codes, or `undefined` to clear
     */
    setSupportedLocales?(locales: readonly string[] | undefined): void;

    /**
     * Field labels for one object in one locale, keyed by field name.
     *
     * [#4127] A provider-supplied SHORTCUT, not the source of truth. Both
     * serving surfaces — the dispatcher's `/i18n/labels/:object/:locale` and
     * service-i18n's own mount — probe for it and, finding nothing, derive the
     * labels from the locale's loaded bundle (`resolveObjectFieldLabels`).
     * That derivation is the path every provider in this repo takes.
     *
     * It is declared anyway because both probes already existed and both call
     * sites documented it as "optional on `II18nService`" — which was simply
     * not true until now. An undeclared method probed in two places is how a
     * second, unwritten contract starts (#4087 is what that costs). A provider
     * that keeps labels somewhere the bundle cannot express — a translation
     * memory, a per-tenant override table — implements this and skips the
     * derivation; everyone else omits it and loses nothing.
     *
     * @param objectName - Object whose fields to label
     * @param locale - BCP-47 locale code
     * @returns Field name → label, for the fields this provider knows
     */
    getFieldLabels?(objectName: string, locale: string): Record<string, string>;

    // ── Diff detection ─────────────────────────────────────────────────

    /**
     * Get translation coverage for a locale, optionally scoped to a single object.
     *
     * Compares the supplied (or currently loaded) translation bundle against
     * the source metadata to detect missing, redundant, and stale entries.
     *
     * @param locale - BCP-47 locale code
     * @param objectName - Optional object name to scope the check
     * @returns Coverage result with per-key diff items
     */
    getCoverage?(locale: string, objectName?: string): TranslationCoverageResult;

    /**
     * Request AI-powered translation suggestions for missing or stale keys.
     *
     * Implementations may call an internal AI agent, external TMS, or
     * third-party translation API. Each returned diff item should have
     * `aiSuggested` and `aiConfidence` populated.
     *
     * @param locale - Target BCP-47 locale code
     * @param items - Diff items to generate suggestions for
     * @returns Diff items enriched with `aiSuggested` and `aiConfidence`
     */
    suggestTranslations?(locale: string, items: TranslationDiffItem[]): Promise<TranslationDiffItem[]>;
}
