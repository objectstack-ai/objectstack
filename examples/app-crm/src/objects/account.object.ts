// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

export const Account = ObjectSchema.create({
  name: 'crm_account',
  // [ADR-0090 D1] Explicit grandfather stamp: record isolation for this demo
  // object is intentionally org-shared; without this the new secure default
  // (unset OWD => private) would owner-filter it, and the D7 publish linter
  // (security-owd-unset) fails the build on an undeclared baseline.
  sharingModel: 'public_read_write',
  label: 'Account',
  pluralLabel: 'Accounts',
  icon: 'building',
  description: 'A company that the org sells to or supports.',

  fields: {
    name: Field.text({
      label: 'Account Name',
      required: true,
      searchable: true,
      maxLength: 200,
    }),
    industry: Field.select({
      label: 'Industry',
      options: [
        { label: 'Technology', value: 'technology', default: true },
        { label: 'Finance', value: 'finance' },
        { label: 'Healthcare', value: 'healthcare' },
        { label: 'Retail', value: 'retail' },
        { label: 'Other', value: 'other' },
      ],
    }),
    annual_revenue: Field.currency({
      label: 'Annual Revenue',
      min: 0,
    }),
    website: Field.url({
      label: 'Website',
    }),
  },
});
