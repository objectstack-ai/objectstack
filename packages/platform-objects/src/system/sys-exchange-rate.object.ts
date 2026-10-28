// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * The rate direction, stated once and read by every face that has to say it:
 * the `rate` field's description and the Setup list page's description both
 * carry this sentence verbatim, so the two can never disagree about which way
 * a rate points (ruling 6465431966, parameter 3).
 */
export const EXCHANGE_RATE_DIRECTION =
  "1 unit of the organization's home currency (Localization → Default currency) = Rate units of this currency. " +
  'Example: home currency USD, currency EUR, rate 0.92 means 1 USD = 0.92 EUR.';

/**
 * Decimal places a `rate` keeps (ruling 6465431966, parameter 4). A write
 * carrying more is refused at the engine's `scale` seam, never rounded.
 */
export const EXCHANGE_RATE_SCALE = 12;

/**
 * sys_exchange_rate — Exchange Rate (multi-currency M1-1, epic #8345)
 *
 * One row per (currency, effective date) per organization: the rate that
 * converts the organization's home currency into a foreign currency from that
 * date on. It is the only source the write-time home-currency projection reads
 * (shape C′, ruling 6465431966): a record-mode amount is converted at write
 * from the rate in force on the record's own document date, and a missing
 * rate refuses the write. Cross rates derive through the home currency — there
 * is no pair table.
 *
 * - **Direction** — {@link EXCHANGE_RATE_DIRECTION}; one direction only, so
 *   no reader has to guess whether a row is the rate or its reciprocal.
 * - **Precision** — `rate` is a `number` field (the platform's exact-decimal
 *   column, never a float column) with `scale` {@link EXCHANGE_RATE_SCALE}.
 * - **Uniqueness** — `(currency, effective_date)` within an organization. Two
 *   organizations both holding EUR on the same day is the normal case, so the
 *   key is spelled `'organization'` (ADR-0120 D1), never bare `true`.
 * - **Tenancy** — no tenancy opt-out, so `organization_id` is injected and the
 *   Layer 0 tenant wall (ADR-0095 D1) scopes every read and write.
 * - **Who writes** — organization administrators: `organization_admin`'s
 *   wildcard grant reaches this object and `member_default` names no business
 *   object (explicit-allow baseline), so a rank-and-file member neither reads
 *   nor writes it (ruling 6465431966, parameter 2). Changing a rate changes
 *   the basis of every amount converted after it, which is why it is an admin
 *   act.
 * - **Audit** — not on the audit writer's skip list, so every create, edit
 *   and delete lands in `sys_audit_log`; `enable.trackHistory` plus the
 *   per-field flags surface the History tab with readable diffs.
 * - **Sources** — `source` records how the row arrived: typed in Setup
 *   (`manual`), loaded from a file (`import`), or written by an app flow that
 *   fetches a provider feed (`app`). The platform ships no provider feed.
 *
 * @namespace sys
 */
export const SysExchangeRate = ObjectSchema.create({
  name: 'sys_exchange_rate',
  label: 'Exchange Rate',
  pluralLabel: 'Exchange Rates',
  icon: 'arrow-right-left',
  isSystem: true,
  // Platform-defined schema, organization-administered data.
  managedBy: 'system-data',
  description:
    "Exchange rates from the organization's home currency to a foreign currency, by effective date — " +
    'the rates foreign-currency amounts are converted to the home currency with.',
  displayNameField: 'currency',
  nameField: 'currency', // [ADR-0079] canonical primary-title pointer (mirrors deprecated displayNameField)
  titleFormat: '{currency} · {effective_date}',
  highlightFields: ['currency', 'rate', 'effective_date', 'source'],

  fields: {
    id: Field.text({ label: 'ID', required: true, readonly: true, group: 'System' }),

    currency: Field.text({
      label: 'Currency',
      required: true,
      searchable: true,
      maxLength: 3,
      valueDomain: 'iso_4217_currency',
      trackHistory: true,
      description: 'ISO 4217 code of the foreign currency, uppercase (EUR, JPY, CHF).',
      group: 'Rate',
    }),

    rate: Field.number({
      label: 'Rate',
      required: true,
      // The smallest positive value at this scale: a zero or negative rate has
      // no meaning, and a conversion through one would silently zero or flip
      // every amount it touched.
      min: 0.000000000001,
      scale: EXCHANGE_RATE_SCALE,
      trackHistory: true,
      description: EXCHANGE_RATE_DIRECTION,
      group: 'Rate',
    }),

    effective_date: Field.date({
      label: 'Effective Date',
      required: true,
      trackHistory: true,
      description:
        'First date this rate applies to. It stays in force until a later row for the same currency takes over.',
      group: 'Rate',
    }),

    source: Field.select(
      [
        { value: 'manual', label: 'Manual' },
        { value: 'import', label: 'Import' },
        { value: 'app', label: 'App' },
      ],
      {
        label: 'Source',
        required: true,
        defaultValue: 'manual',
        trackHistory: true,
        description:
          'How the row arrived: typed in Setup (manual), loaded from a file (import), or written by an app flow (app).',
        group: 'Rate',
      },
    ),
  },

  indexes: [
    { fields: ['currency', 'effective_date'], unique: 'organization' },
  ],

  listViews: {
    all_rates: {
      type: 'grid',
      name: 'all_rates',
      label: 'All',
      description: EXCHANGE_RATE_DIRECTION,
      data: { provider: 'object', object: 'sys_exchange_rate' },
      columns: ['currency', 'rate', 'effective_date', 'source'],
      sort: [
        { field: 'effective_date', order: 'desc' },
        { field: 'currency', order: 'asc' },
      ],
      pagination: { pageSize: 50 },
      emptyState: {
        title: 'No exchange rates yet',
        message:
          'Add one row per currency for each date its rate changes, for example one row per currency at the start of each month.',
      },
    },
  },

  enable: {
    trackHistory: true,
    searchable: false,
    apiEnabled: true,
    // A rate is reference data, not a discussion surface.
    feeds: false,
  },
});
