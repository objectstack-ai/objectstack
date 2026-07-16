// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';
import { P } from '@objectstack/spec';

/**
 * Account — a customer org. Lookup target for projects and the field zoo.
 *
 * Doubles as the validation-rule showcase: besides the re-entrant
 * `state_machine` lifecycle below, it demonstrates the other write-path rule
 * types — `format` (tax id pattern), `json_schema` (support config shape), and
 * `conditional` (churn reason required only when churning). Each is exercised
 * by `test/validation.test.ts` against the real evaluator.
 */
export const Account = ObjectSchema.create({
  name: 'showcase_account',
  // [ADR-0090 D1] Explicit grandfather stamp: record isolation for this demo
  // object is RLS-owned / intentionally public; without this the new secure
  // default (unset OWD => private) would owner-filter it.
  sharingModel: 'public_read_write',
  // [ADR-0090 D11] External principals may READ accounts (portal users see
  // the customer directory) but never write them — a non-default external
  // dial that is still strictly ≤ the internal `public_read_write`.
  // Authoring-validated + Studio-surfaced today; runtime evaluation lands
  // with the principal-taxonomy phase (#2696, liveness `planned`).
  externalSharingModel: 'public_read',
  label: 'Account',
  pluralLabel: 'Accounts',
  icon: 'building',
  description: 'A company the org delivers projects for.',

  // ADR-0061: which fields `$search` matches. Includes the two selects
  // (industry/status) so searching a label like "Retail" or "Active" resolves
  // to the stored value, plus the text identifiers.
  searchableFields: ['name', 'industry', 'status', 'billing_email', 'tax_id'],

  // ADR-0085 semantic role: the record's most important fields. Drives the
  // detail-page highlight strip (formerly the deleted account-detail page's
  // `highlights` slot) plus default list columns / cards — one declaration,
  // every surface, no per-page config.
  highlightFields: ['status', 'industry', 'annual_revenue'],

  fields: {
    name: Field.text({ label: 'Account Name', required: true, searchable: true, maxLength: 200 }),
    industry: Field.select({
      label: 'Industry',
      trackHistory: true,
      options: [
        { label: 'Technology', value: 'technology', default: true },
        { label: 'Finance', value: 'finance' },
        { label: 'Healthcare', value: 'healthcare' },
        { label: 'Retail', value: 'retail' },
      ],
    }),
    // Explicit ISO code (spec channel: `currencyConfig.defaultCurrency`): a
    // currency field without a resolvable code renders as a bare grouped
    // number by design (no guessed symbol) — with it, the detail highlight
    // strip and grids show "$25,000,000" instead of "25,000,000".
    annual_revenue: Field.currency({
      label: 'Annual Revenue',
      scale: 2,
      min: 0,
      currencyConfig: { precision: 2, currencyMode: 'fixed', defaultCurrency: 'USD' },
    }),
    website: Field.url({ label: 'Website' }),
    hq: Field.location({ label: 'Headquarters' }),
    status: Field.select({
      label: 'Lifecycle',
      required: true,
      trackHistory: true,
      options: [
        { label: 'Prospect', value: 'prospect', default: true, color: '#94A3B8' },
        { label: 'Active', value: 'active', color: '#10B981' },
        { label: 'Churned', value: 'churned', color: '#EF4444' },
      ],
    }),
    // Region + signed date power the Revenue Pulse dashboard's dashboard-level
    // filters (framework#2501): the shared "region" filter maps to THIS
    // object's `sales_region` (invoices carry their own `region`), and the
    // dashboard date range maps to `signed_on` (invoices use `issued_on`) —
    // the cross-object per-widget `filterBindings` demo.
    sales_region: Field.select({
      label: 'Sales Region',
      options: [
        { label: 'AMER', value: 'amer', default: true },
        { label: 'EMEA', value: 'emea' },
        { label: 'APAC', value: 'apac' },
      ],
    }),
    signed_on: Field.date({ label: 'Customer Since' }),
    // EIN-style tax id — the `format` rule below enforces the NN-NNNNNNN shape
    // with a regex (a deliberately non-trivial pattern, unlike the built-in
    // email/url field validators).
    tax_id: Field.text({ label: 'Tax ID (EIN)', maxLength: 20 }),
    // Free-form integration settings stored as JSON — the `json_schema` rule
    // below constrains its shape.
    support_config: Field.json({ label: 'Support Config' }),
    // Captured only when an account churns; required by the `conditional` rule.
    churn_reason: Field.text({ label: 'Churn Reason', maxLength: 500 }),
    // A plain text field (deliberately NOT Field.email) so the `format` rule's
    // named `email` format is what enforces validity — demonstrating the named
    // format branch rather than the field-type's built-in check.
    billing_email: Field.text({ label: 'Billing Email', maxLength: 200 }),
  },

  // A third `state_machine` example with a different topology than
  // Task/Project: a re-entrant lifecycle (a churned account can be won
  // back). Demonstrates the guardrail is just a per-field validation rule
  // on the object — no separate metadata type, no separate file.
  validations: [
    {
      type: 'state_machine' as const,
      name: 'account_lifecycle',
      label: 'Account Lifecycle',
      description: 'Accounts move prospect → active → churned, and can be reactivated.',
      field: 'status',
      // Transitions are validated on update; insert sets the initial state.
      events: ['update'] as const,
      message: 'Invalid account lifecycle transition.',
      transitions: {
        prospect: ['active', 'churned'],
        active: ['churned'],
        churned: ['active'],
      },
    },
    {
      // `format` — a regex check on a single field. Runs on insert/update
      // whenever the write touches `tax_id` and the value is non-empty.
      type: 'format' as const,
      name: 'tax_id_format',
      label: 'Tax ID Format',
      description: 'Tax ID must be a US EIN (NN-NNNNNNN).',
      field: 'tax_id',
      regex: '^\\d{2}-\\d{7}$',
      message: 'Tax ID must look like 12-3456789.',
    },
    {
      // `format` — the *named* format branch (`email` / `url` / `phone` / `json`),
      // complementing the regex example above. Validates `billing_email` only
      // when the write supplies a non-empty value.
      type: 'format' as const,
      name: 'billing_email_format',
      label: 'Billing Email Format',
      description: 'Billing email must be a valid email address.',
      field: 'billing_email',
      format: 'email' as const,
      message: 'Billing Email must be a valid email address.',
    },
    {
      // `json_schema` — validate the JSON `support_config` blob against a
      // JSON Schema (compiled by ajv). Accepts a parsed object or a JSON
      // string; an unparseable string is itself a violation.
      type: 'json_schema' as const,
      name: 'support_config_shape',
      label: 'Support Config Shape',
      description: 'Support config must declare a known tier and a positive seat count.',
      field: 'support_config',
      message: 'Support Config must be { tier: standard|premium|enterprise, seats?: >=1 }.',
      schema: {
        type: 'object',
        properties: {
          tier: { type: 'string', enum: ['standard', 'premium', 'enterprise'] },
          seats: { type: 'integer', minimum: 1 },
        },
        required: ['tier'],
        additionalProperties: false,
      },
    },
    {
      // `conditional` with BOTH branches — `when` picks `then` (true) or
      // `otherwise` (false). A churned account must record *why*; a
      // non-churned account must NOT carry a stale churn reason. The
      // `otherwise` branch only flags an explicitly-set reason (it `has()`-
      // guards the absent case), so ordinary non-churned writes are untouched.
      type: 'conditional' as const,
      name: 'churn_reason_consistency',
      label: 'Churn Reason Consistency',
      description: 'A churned account needs a reason; a non-churned account must not have one.',
      when: P`record.status == 'churned'`,
      message: 'Churn reason consistency.',
      then: {
        type: 'script' as const,
        name: 'churn_reason_present',
        message: 'A churn reason is required when an account is marked churned.',
        // `has()` guards the absent-key case (a PATCH that never mentions
        // churn_reason); the equality checks catch an explicit null / blank.
        condition: P`!has(record.churn_reason) || record.churn_reason == null || record.churn_reason == ''`,
      },
      otherwise: {
        type: 'script' as const,
        name: 'churn_reason_absent',
        message: 'A churn reason should only be set when the account is churned.',
        // Only fires if a non-empty reason is explicitly present on a
        // non-churned account — absent/blank is fine.
        condition: P`has(record.churn_reason) && record.churn_reason != null && record.churn_reason != ''`,
      },
    },
  ],
});
