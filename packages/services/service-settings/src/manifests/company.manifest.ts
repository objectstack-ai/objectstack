// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ISO_3166_ALPHA2_CODES } from '@objectstack/spec/shared';
import type { SettingsManifest } from '@objectstack/spec/system';

/**
 * The country of `locale` named for an administrator, as `Name (CODE)`, keyed
 * by its ISO 3166-1 alpha-2 code — one entry per member of the
 * `iso_3166_alpha2` value domain, so the picker offers exactly the codes the
 * write door accepts and never a second, hand-kept list.
 *
 * The names come from CLDR through `Intl.DisplayNames`. That is a NAMING
 * source only: the shared value-domain module records why it is no membership
 * test (`ZZ` and `UK` get names too), and membership stays with
 * `ISO_3166_ALPHA2_CODES`. A runtime with no region names for `locale` falls
 * back to the bare code, never to a missing option.
 */
export function countryOptionLabels(locale: string): Record<string, string> {
  let names: Intl.DisplayNames | undefined;
  try {
    names = new Intl.DisplayNames([locale], { type: 'region', fallback: 'none' });
  } catch {
    names = undefined;
  }
  const labels: Record<string, string> = {};
  for (const code of ISO_3166_ALPHA2_CODES) {
    const name = names?.of(code);
    labels[code] = name && name !== code ? `${name} (${code})` : code;
  }
  return labels;
}

/**
 * The `options` of a country picker: every ISO 3166-1 alpha-2 code with its
 * English name, ordered by that name. Shared by Company's `country` and
 * Localization's `default_country`; each locale pack names the same codes
 * through {@link countryOptionLabels}.
 */
export const COUNTRY_OPTIONS: ReadonlyArray<{ value: string; label: string }> = Object.entries(
  countryOptionLabels('en'),
)
  .map(([value, label]) => ({ value, label }))
  .sort((a, b) => a.label.localeCompare(b.label, 'en'));

/**
 * Company — the workspace's legal organization identity.
 *
 * Distinct from `branding` (the product name / logo / accent colour the console
 * shows; not offered under the walled `group` / `isolated` postures): this is
 * the **legal entity** — registered name, address, tax IDs, and the primary
 * contact. Downstream consumers are invoices/receipts, email footers (CAN-SPAM
 * requires a physical postal address), contracts, and compliance exports.
 * Benchmarked against Salesforce "Company Information" and Stripe's business
 * profile.
 *
 * Scope is `tenant`: one org per physical tenant (ADR-0002).
 */
export const companySettingsManifest: SettingsManifest = {
  namespace: 'company',
  version: 1,
  label: 'Company',
  icon: 'Building2',
  description: 'Legal entity identity — registered name, address, tax IDs, and primary contact.',
  scope: 'tenant',
  readPermission: 'setup.access',
  writePermission: 'setup.write',
  category: 'Workspace',
  order: 3,
  specifiers: [
    // ── Identity ──────────────────────────────────────────────────────────
    { type: 'group', id: 'identity', label: 'Identity', required: false },
    {
      type: 'text', key: 'legal_name', label: 'Legal name', required: false,
      description: 'Registered legal name of the organization, as it appears on contracts and invoices.',
      maxLength: 200,
    },
    {
      type: 'text', key: 'registration_number', label: 'Registration number', required: false,
      description: 'Company registration / incorporation number (e.g. EIN, company no.).',
      maxLength: 80,
    },
    {
      type: 'text', key: 'tax_id', label: 'Tax / VAT ID', required: false,
      description: 'Tax identifier shown on invoices (e.g. VAT, GST, ABN).',
      maxLength: 80,
    },

    // ── Registered address ────────────────────────────────────────────────
    { type: 'group', id: 'address', label: 'Registered address', required: false },
    { type: 'text', key: 'address_line1', label: 'Address line 1', required: false, maxLength: 200 },
    { type: 'text', key: 'address_line2', label: 'Address line 2', required: false, maxLength: 200 },
    { type: 'text', key: 'city', label: 'City', required: false, maxLength: 120 },
    { type: 'text', key: 'state', label: 'State / Province', required: false, maxLength: 120 },
    { type: 'text', key: 'postal_code', label: 'Postal code', required: false, maxLength: 32 },
    {
      // A picker that shows country names and stores the code (#27867). The
      // value domain stays the enforcement boundary, so the accepted set is
      // unchanged; `options` lists every member of it, named.
      type: 'select', key: 'country', label: 'Country', required: false,
      description: 'Country of the registered address. Type a country name and pick it from the list.',
      // Fourth case of the hole #5712 closed on timezone/currency (#6579): the
      // pattern constrains SHAPE only, and `ZZ` is a shape-valid code assigned
      // to nobody. The domain constrains membership; both still apply.
      pattern: '^[A-Za-z]{2}$', minLength: 2, maxLength: 2,
      valueDomain: 'iso_3166_alpha2',
      options: [...COUNTRY_OPTIONS],
    },

    // ── Contact ───────────────────────────────────────────────────────────
    { type: 'group', id: 'contact', label: 'Contact', required: false },
    {
      type: 'text', key: 'phone', label: 'Phone', required: false,
      description: 'Primary business phone (E.164 recommended, e.g. +1 415 555 0100).',
      maxLength: 40,
    },
    {
      type: 'url', key: 'website', label: 'Website', required: false,
      description: 'Example: https://example.com',
    },
    { type: 'text', key: 'primary_contact_name', label: 'Primary contact name', required: false, maxLength: 120 },
    {
      type: 'email', key: 'primary_contact_email', label: 'Primary contact email', required: false,
      description: 'Example: ops@example.com',
    },
  ],
};
