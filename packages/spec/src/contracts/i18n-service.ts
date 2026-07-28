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
     * @returns BCP-47 locale code
     */
    getDefaultLocale?(): string;

    /**
     * Set the default locale
     * @param locale - BCP-47 locale code
     */
    setDefaultLocale?(locale: string): void;

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
