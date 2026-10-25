/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * @object-ui/i18n - locale formatting helpers
 *
 * ## Provenance of the four shapes below (objectui#4597)
 *
 * They were authored against `@objectstack/spec/ui`, which exported
 * `PluralRuleSchema`, `DateFormatSchema`, `NumberFormatSchema` and
 * `LocaleConfigSchema` up to and including 17.0.0-rc.5. The pinned
 * 17.0.0-rc.6 removed all four under ADR-0049 enforce-or-remove
 * (objectstack#5055, maintainer ruling 2026-08-06): they carried no key on any
 * authorable shape and nothing ever parsed them, so the vocabulary was retired
 * rather than given a door. The key sets here were faithful to the retired
 * schemas — this is a retirement, not a drift.
 *
 * Nothing in the pinned protocol models locale formatting today, so the
 * interfaces below are declarations this package owns outright, not a view onto
 * a protocol type. The retirement note records that localisation returns as
 * authorable metadata through a new ADR — "the formatter that reads a
 * LocaleConfig first, the vocabulary second" — so re-derive these at that point
 * instead of assuming they still track anything upstream.
 *
 * @module spec-formatters
 */

import { isRealCalendarDate, toDisplayDate } from '@object-ui/core';

// ============================================================================
// Plural rules
// ============================================================================

/**
 * Plural forms for a single translation key, in CLDR categories.
 *
 * Local shape — authored against the protocol's `PluralRuleSchema`, retired in
 * 17.0.0-rc.6 (see the module doc), so there is nothing upstream to derive from.
 */
export interface SpecPluralRule {
  /** Translation key */
  key: string;
  /** Form for zero items */
  zero?: string;
  /** Form for exactly one item */
  one?: string;
  /** Form for exactly two items */
  two?: string;
  /** Form for few items (language-specific) */
  few?: string;
  /** Form for many items (language-specific) */
  many?: string;
  /** Default/fallback form (required) */
  other: string;
}

/**
 * Resolve a plural form based on count, following CLDR plural rules.
 * Uses the Intl.PluralRules API for correct locale-aware pluralization.
 *
 * @example
 * ```ts
 * const rule: SpecPluralRule = {
 *   key: 'items.count',
 *   zero: 'No items',
 *   one: '{count} item',
 *   other: '{count} items',
 * };
 * resolvePlural(rule, 0, 'en'); // → 'No items'
 * resolvePlural(rule, 1, 'en'); // → '1 item'
 * resolvePlural(rule, 5, 'en'); // → '5 items'
 * ```
 */
export function resolvePlural(
  rule: SpecPluralRule,
  count: number,
  locale = 'en',
): string {
  const pr = new Intl.PluralRules(locale);
  const category = pr.select(count);

  // Prefer the explicit form, fall back to 'other'
  const template =
    (category === 'zero' && rule.zero) ||
    (category === 'one' && rule.one) ||
    (category === 'two' && rule.two) ||
    (category === 'few' && rule.few) ||
    (category === 'many' && rule.many) ||
    rule.other;

  // Replace {count} placeholder
  return template.replace(/\{count\}/g, String(count));
}

// ============================================================================
// Date formatting
// ============================================================================

/**
 * Date/time formatting options passed through to `Intl.DateTimeFormat`.
 *
 * Local shape — authored against the protocol's `DateFormatSchema`, retired in
 * 17.0.0-rc.6 (see the module doc), so there is nothing upstream to derive from.
 */
export interface SpecDateFormat {
  dateStyle?: 'full' | 'long' | 'medium' | 'short';
  timeStyle?: 'full' | 'long' | 'medium' | 'short';
  timeZone?: string;
  hour12?: boolean;
}

/**
 * Format a date using a {@link SpecDateFormat} configuration.
 *
 * A string is read through `toDisplayDate` (`@object-ui/core`), the one parse
 * step behind the date faces (objectui#10866): a date-only `2026-09-01` names
 * a calendar day and is rebuilt at local midnight of that day, while a value
 * with a time part keeps its instant. The engine's own parse read the
 * date-only form as UTC midnight, so it named August 31st west of UTC, and
 * for every viewer once `timeZone` was west of UTC.
 *
 * `timeZone` therefore applies to an instant only. A date-only value carries
 * no instant for a zone to place, and the local midnight the shared step
 * built reads back as its day only in the local zone, so it is formatted
 * there. A value the shared step refuses, such as a day its month does not
 * have (objectui#10026), comes back as its string.
 *
 * @example
 * ```ts
 * formatDateSpec(new Date(), {
 *   dateStyle: 'medium',
 *   timeStyle: 'short',
 *   timeZone: 'America/New_York',
 * }, 'en-US');
 * ```
 */
export function formatDateSpec(
  date: Date | string | number,
  format: SpecDateFormat,
  locale = 'en',
): string {
  const d = toDisplayDate(date);
  if (isNaN(d.getTime())) return String(date);
  // The value's shape tells the two apart, the same test the shared step makes.
  const dateOnly = typeof date === 'string' && isRealCalendarDate(date);

  const options: Intl.DateTimeFormatOptions = {};
  if (format.dateStyle) options.dateStyle = format.dateStyle;
  if (format.timeStyle) options.timeStyle = format.timeStyle;
  if (format.timeZone && !dateOnly) options.timeZone = format.timeZone;
  if (format.hour12 !== undefined) options.hour12 = format.hour12;

  return new Intl.DateTimeFormat(locale, options).format(d);
}

// ============================================================================
// Number formatting
// ============================================================================

/**
 * Number formatting options passed through to `Intl.NumberFormat`.
 *
 * Local shape — authored against the protocol's `NumberFormatSchema`, retired
 * in 17.0.0-rc.6 (see the module doc), so there is nothing upstream to derive
 * from.
 */
export interface SpecNumberFormat {
  style?: 'currency' | 'percent' | 'decimal' | 'unit';
  currency?: string;
  unit?: string;
  minimumFractionDigits?: number;
  maximumFractionDigits?: number;
  useGrouping?: boolean;
}

/**
 * Format a number using a {@link SpecNumberFormat} configuration.
 *
 * @example
 * ```ts
 * formatNumberSpec(1234.56, {
 *   style: 'currency',
 *   currency: 'USD',
 *   maximumFractionDigits: 2,
 * }, 'en-US'); // → '$1,234.56'
 * ```
 */
export function formatNumberSpec(
  value: number,
  format: SpecNumberFormat,
  locale = 'en',
): string {
  const options: Intl.NumberFormatOptions = {
    style: format.style || 'decimal',
  };

  if (format.currency) options.currency = format.currency;
  if (format.unit) options.unit = format.unit;
  if (format.minimumFractionDigits !== undefined) options.minimumFractionDigits = format.minimumFractionDigits;
  if (format.maximumFractionDigits !== undefined) options.maximumFractionDigits = format.maximumFractionDigits;
  if (format.useGrouping !== undefined) options.useGrouping = format.useGrouping;

  return new Intl.NumberFormat(locale, options).format(value);
}

// ============================================================================
// Locale configuration
// ============================================================================

/**
 * One locale's formatting defaults, resolved by `applyLocaleConfig()`.
 *
 * Local shape — authored against the protocol's `LocaleConfigSchema`, retired
 * in 17.0.0-rc.6 (see the module doc), so there is nothing upstream to derive
 * from.
 */
export interface SpecLocaleConfig {
  /** BCP 47 language code (e.g., 'en-US', 'zh-CN') */
  code: string;
  /** Fallback locale chain */
  fallbackChain?: string[];
  /** Text direction */
  direction?: 'ltr' | 'rtl';
  /** Number formatting defaults */
  numberFormat?: SpecNumberFormat;
  /** Date formatting defaults */
  dateFormat?: SpecDateFormat;
}

/**
 * Apply a {@link SpecLocaleConfig} to configure i18n formatting defaults.
 * Returns resolved formatting functions bound to the locale config.
 *
 * @example
 * ```ts
 * const locale = applyLocaleConfig({
 *   code: 'zh-CN',
 *   direction: 'ltr',
 *   numberFormat: { style: 'decimal', useGrouping: true },
 *   dateFormat: { dateStyle: 'medium' },
 * });
 * locale.formatDate(new Date()); // Chinese medium date
 * locale.formatNumber(1234.5);   // 1,234.5
 * ```
 */
export function applyLocaleConfig(config: SpecLocaleConfig) {
  return {
    code: config.code,
    direction: config.direction || 'ltr',
    fallbackChain: config.fallbackChain || [],
    formatDate: (date: Date | string | number, overrides?: Partial<SpecDateFormat>) =>
      formatDateSpec(date, { ...config.dateFormat, ...overrides }, config.code),
    formatNumber: (value: number, overrides?: Partial<SpecNumberFormat>) =>
      formatNumberSpec(value, { ...config.numberFormat, ...overrides }, config.code),
    resolvePlural: (rule: SpecPluralRule, count: number) =>
      resolvePlural(rule, count, config.code),
  };
}
