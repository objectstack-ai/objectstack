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
  // What the record page shows at a glance, under the title.
  highlightFields: ['industry', 'annual_revenue', 'website'],
  // Field history on the record page: the timeline shows each field change
  // with its before and after values, and offers the Changes filter. The audit
  // log records every change either way; this opt-in flag is what makes the
  // record page show it.
  enable: { trackHistory: true },

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

  // The Details sections of the record page and the form. Each group lists its
  // own fields, in order, so no field carries a `group` key.
  fieldGroups: [
    { key: 'basic', label: 'Basic', fields: ['name', 'industry', 'website'] },
    { key: 'financials', label: 'Financials', fields: ['annual_revenue'] },
  ],

  // The record page's tabs, declared in one place: only the lists named here
  // show, in this order. An entry may carry its own columns (fields of the
  // child); the built-in tabs are named by object. Leaving a list out hides its
  // tab, except a child list another package brings: that one still shows, at
  // the end of the tabs or where that package's extension places it. Without
  // this key every related list is a tab, in the automatic order.
  relatedLists: [
    { list: 'crm_contact', columns: ['full_name', 'email'] },
    'crm_opportunity',
    'crm_activity',
    'crm_lead',
    'sys_approval_request',
    'sys_activity',
  ],
});
