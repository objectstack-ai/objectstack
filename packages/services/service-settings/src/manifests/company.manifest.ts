// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import type { SettingsManifest } from '@objectstack/spec/system';

/**
 * Company — the workspace's legal organization identity.
 *
 * Distinct from `branding` (the public-facing workspace name / logo / theme):
 * this is the **legal entity** — registered name, address, tax IDs, and the
 * primary contact. Downstream consumers are invoices/receipts, email footers
 * (CAN-SPAM requires a physical postal address), contracts, and compliance
 * exports. Benchmarked against Salesforce "Company Information" and Stripe's
 * business profile.
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
      description: 'Registered legal name of the organization (may differ from the workspace name).',
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
      type: 'text', key: 'country', label: 'Country', required: false,
      description: 'ISO 3166-1 alpha-2 code (e.g. US, GB, CN).',
      // Fourth case of the hole #5712 closed on timezone/currency (#6579): the
      // pattern constrains SHAPE only, and `ZZ` is a shape-valid code assigned
      // to nobody. The domain constrains membership; both still apply.
      pattern: '^[A-Za-z]{2}$', minLength: 2, maxLength: 2,
      valueDomain: 'iso_3166_alpha2',
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
