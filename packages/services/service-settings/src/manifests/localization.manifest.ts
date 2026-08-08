// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { SettingsManifest } from '@objectstack/spec/system';

/**
 * Localization — workspace-wide regional defaults (ADR-0053 Phase 2 follow-up).
 *
 * The single source of truth for the platform's reference timezone, language,
 * currency, and display formats. `resolveExecutionContext` reads `timezone`
 * and `locale` from here (cascade: platform default → global → tenant) onto
 * every `ExecutionContext`, so formulas (`today()`), analytics date bucketing,
 * and rendered `datetime` instants all resolve against the org's region.
 *
 * Scope is `tenant`: one org per physical tenant (ADR-0002) sets its regional
 * defaults; the manifest `default` of each key is the platform built-in, and a
 * `global` row (or `OS_LOCALIZATION_*` env) can pin a deployment-wide value.
 * Per-user overrides are intentionally out of scope for v1.
 */
export const localizationSettingsManifest: SettingsManifest = {
  namespace: 'localization',
  version: 1,
  label: 'Localization',
  icon: 'Globe',
  description: 'Default timezone, language, currency, and date/number formats.',
  scope: 'tenant',
  readPermission: 'setup.access',
  writePermission: 'setup.write',
  category: 'Workspace',
  order: 2,
  specifiers: [
    // ── Region ────────────────────────────────────────────────────────────
    { type: 'group', id: 'region', label: 'Region', required: false },
    {
      type: 'select', key: 'timezone', label: 'Default timezone', required: false, default: 'UTC',
      description: 'IANA zone used to resolve today()/daysFromNow, analytics date buckets, and rendered datetimes.',
      // The description has always promised the IANA domain; since #5712 the
      // declaration matches it: any valid IANA zone is accepted on the write
      // and env doors, and the curated options below are a UI convenience
      // list, not an exhaustive statement of what is legal.
      valueDomain: 'iana_time_zone',
      options: [
        { value: 'UTC', label: 'UTC' },
        { value: 'America/Los_Angeles', label: '(UTC−08/−07) Los Angeles' },
        { value: 'America/Denver', label: '(UTC−07/−06) Denver' },
        { value: 'America/Chicago', label: '(UTC−06/−05) Chicago' },
        { value: 'America/New_York', label: '(UTC−05/−04) New York' },
        { value: 'America/Sao_Paulo', label: '(UTC−03) São Paulo' },
        { value: 'Europe/London', label: '(UTC±00/+01) London' },
        { value: 'Europe/Paris', label: '(UTC+01/+02) Paris' },
        { value: 'Europe/Berlin', label: '(UTC+01/+02) Berlin' },
        { value: 'Europe/Moscow', label: '(UTC+03) Moscow' },
        { value: 'Asia/Dubai', label: '(UTC+04) Dubai' },
        { value: 'Asia/Kolkata', label: '(UTC+05:30) Kolkata' },
        { value: 'Asia/Singapore', label: '(UTC+08) Singapore' },
        { value: 'Asia/Shanghai', label: '(UTC+08) Shanghai' },
        { value: 'Asia/Tokyo', label: '(UTC+09) Tokyo' },
        { value: 'Australia/Sydney', label: '(UTC+10/+11) Sydney' },
        { value: 'Pacific/Auckland', label: '(UTC+12/+13) Auckland' },
      ],
    },
    {
      type: 'select', key: 'locale', label: 'Default language', required: false, default: 'en-US',
      description: 'BCP-47 locale for message catalogs and number/date formatting.',
      options: [
        { value: 'en-US', label: 'English (US)' },
        { value: 'zh-CN', label: '简体中文' },
        { value: 'ja-JP', label: '日本語' },
        { value: 'es-ES', label: 'Español (España)' },
      ],
    },
    {
      type: 'text', key: 'default_country', label: 'Default country', required: false, default: 'US',
      description: 'ISO 3166-1 alpha-2 code (e.g. US, GB, CN). Used for address and phone defaults.',
      // Third case of the same hole #5712 closed on timezone/currency: the
      // pattern constrains SHAPE only, and `ZZ` is a shape-valid code assigned
      // to nobody. The domain constrains membership; both still apply.
      pattern: '^[A-Za-z]{2}$', minLength: 2, maxLength: 2,
      valueDomain: 'iso_3166_alpha2',
    },

    // ── Formats ───────────────────────────────────────────────────────────
    { type: 'group', id: 'formats', label: 'Formats', required: false },
    {
      type: 'select', key: 'date_format', label: 'Date format', required: false, default: 'YYYY-MM-DD',
      options: [
        { value: 'YYYY-MM-DD', label: '2026-06-17 (ISO)' },
        { value: 'MM/DD/YYYY', label: '06/17/2026 (US)' },
        { value: 'DD/MM/YYYY', label: '17/06/2026 (EU)' },
        { value: 'DD.MM.YYYY', label: '17.06.2026' },
        { value: 'DD-MMM-YYYY', label: '17-Jun-2026' },
      ],
    },
    {
      type: 'select', key: 'time_format', label: 'Time format', required: false, default: '24h',
      options: [
        { value: '24h', label: '24-hour (14:30)' },
        { value: '12h', label: '12-hour (2:30 PM)' },
      ],
    },
    {
      type: 'select', key: 'number_format', label: 'Number format', required: false, default: '1,234.56',
      description: 'Grouping and decimal separators for displayed numbers.',
      options: [
        { value: '1,234.56', label: '1,234.56 (comma / dot)' },
        { value: '1.234,56', label: '1.234,56 (dot / comma)' },
        { value: '1 234,56', label: '1 234,56 (space / comma)' },
        { value: '1,23,456.78', label: '1,23,456.78 (Indian)' },
      ],
    },
    {
      type: 'select', key: 'first_day_of_week', label: 'First day of week', required: false, default: 'monday',
      description: 'Anchors weekly analytics buckets and calendar grids.',
      options: [
        { value: 'monday', label: 'Monday (ISO)' },
        { value: 'sunday', label: 'Sunday' },
        { value: 'saturday', label: 'Saturday' },
      ],
    },

    // ── Finance ───────────────────────────────────────────────────────────
    { type: 'group', id: 'finance', label: 'Finance', required: false },
    {
      type: 'select', key: 'currency', label: 'Default currency', required: false,
      // No platform default: when a currency field omits its own code AND the
      // workspace has not set a default here, amounts render as plain numbers
      // rather than inheriting a guessed symbol (previously hard-defaulted to
      // 'USD', which surfaced an unwanted "$"/"US$" on every code-less amount).
      // A workspace can still pick a default to apply org-wide.
      description: 'ISO 4217 code applied when a currency field omits its own. Leave unset to render code-less amounts as plain numbers.',
      // As with `timezone`: the description promises ISO 4217, and since #5712
      // the declaration delivers it — any ISO 4217 code is accepted, the
      // curated options are a UI convenience list.
      valueDomain: 'iso_4217_currency',
      options: [
        { value: 'USD', label: 'USD — US Dollar' },
        { value: 'EUR', label: 'EUR — Euro' },
        { value: 'GBP', label: 'GBP — British Pound' },
        { value: 'JPY', label: 'JPY — Japanese Yen' },
        { value: 'CNY', label: 'CNY — Chinese Yuan' },
        { value: 'INR', label: 'INR — Indian Rupee' },
        { value: 'AUD', label: 'AUD — Australian Dollar' },
        { value: 'CAD', label: 'CAD — Canadian Dollar' },
        { value: 'BRL', label: 'BRL — Brazilian Real' },
      ],
    },
    {
      type: 'select', key: 'fiscal_year_start', label: 'Fiscal year start', required: false, default: 'january',
      description: 'First month of the fiscal year — drives "this quarter / fiscal year" in reports.',
      options: [
        { value: 'january', label: 'January' },
        { value: 'february', label: 'February' },
        { value: 'march', label: 'March' },
        { value: 'april', label: 'April' },
        { value: 'may', label: 'May' },
        { value: 'june', label: 'June' },
        { value: 'july', label: 'July' },
        { value: 'august', label: 'August' },
        { value: 'september', label: 'September' },
        { value: 'october', label: 'October' },
        { value: 'november', label: 'November' },
        { value: 'december', label: 'December' },
      ],
    },
  ],
};
