// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * Account — a customer org. Lookup target for projects and the field zoo.
 */
export const Account = ObjectSchema.create({
  name: 'showcase_account',
  label: 'Account',
  pluralLabel: 'Accounts',
  icon: 'building',
  description: 'A company the org delivers projects for.',

  fields: {
    name: Field.text({ label: 'Account Name', required: true, searchable: true, maxLength: 200 }),
    industry: Field.select({
      label: 'Industry',
      options: [
        { label: 'Technology', value: 'technology', default: true },
        { label: 'Finance', value: 'finance' },
        { label: 'Healthcare', value: 'healthcare' },
        { label: 'Retail', value: 'retail' },
      ],
    }),
    annual_revenue: Field.currency({ label: 'Annual Revenue', scale: 2, min: 0 }),
    website: Field.url({ label: 'Website' }),
    hq: Field.location({ label: 'Headquarters' }),
  },
});
