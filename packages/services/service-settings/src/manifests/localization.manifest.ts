// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { SettingsManifest } from '@objectstack/spec/system';

/**
 * Localization — workspace-wide regional defaults (ADR-0053 Phase 2 follow-up).
 *
 * The single source of truth for the platform's reference timezone, language,
 * country and currency. `resolveLocalizationContext` (`@objectstack/core`)
 * reads `timezone`, `locale` and `currency` from here (cascade: platform
 * default → global → tenant) onto every `ExecutionContext`, so formulas
 * (`today()`), analytics date bucketing, and rendered `datetime` instants all
 * resolve against the org's region.
 *
 * Display formats follow the locale. How dates, times and numbers are written,
 * and which day a week starts on, come from `locale` (language and region), the
 * way Salesforce derives them from a user's Locale. Four separate settings for
 * them (`date_format`, `time_format`, `number_format`, `first_day_of_week`)
 * were offered here until #21958 and nothing ever read them; they were retired
 * rather than implemented (the ruling recorded on objectui#11675). Removing
 * them is why `version` is 2: the spec's `SettingsManifest.version` contract is
 * "increment when keys are renamed/removed". A `sys_setting` row stored for one
 * of them is kept, never deleted. The service no longer resolves it (it does
 * not appear in `GET /api/settings/localization`), and a write naming the key
 * is refused `400 UNKNOWN_KEY`, the answer every undeclared key gets.
 *
 * Scope is `tenant`: one org per physical tenant (ADR-0002) sets its regional
 * defaults; the manifest `default` of each key is the platform built-in, and a
 * `global` row (or `OS_LOCALIZATION_*` env) can pin a deployment-wide value.
 * Per-user overrides are intentionally out of scope for v1.
 */
export const localizationSettingsManifest: SettingsManifest = {
  namespace: 'localization',
  version: 2,
  label: 'Localization',
  icon: 'Globe',
  description: 'Default timezone, language, country, currency, and fiscal year.',
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
