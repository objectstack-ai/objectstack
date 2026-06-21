// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

// Builder authoring path (object/field already have a good entry point).
import { ObjectSchema, Field } from '@objectstack/spec/data';

export const Account = ObjectSchema.create({
  name: 'dc_account',
  label: 'Account',
  pluralLabel: 'Accounts',
  icon: 'building',
  description: 'Downstream-contract account object (builder authoring path).',
  fields: {
    name: Field.text({ label: 'Name', required: true, searchable: true, maxLength: 255 }),
    stage: Field.select({
      label: 'Stage',
      options: [
        { label: 'Prospect', value: 'prospect', default: true },
        { label: 'Customer', value: 'customer' },
        { label: 'Churned', value: 'churned' },
      ],
    }),
  },
});
