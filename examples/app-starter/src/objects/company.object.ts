// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * A company the organization works with — a customer, a prospect, a supplier
 * or a partner.
 *
 * The API names carry the package namespace (`starter_`), so a tenant that
 * installs this starter beside a CRM package keeps both: the CRM's own account
 * and contact objects use other names.
 *
 * There is no owner field here: every package object gets the platform's
 * `owner_id` column, set to the creator on insert.
 */
export const Company = ObjectSchema.create({
  name: 'starter_company',
  // Shared inside the organization: a starter workspace where everyone sees
  // every company. An organization that wants owner-only records changes this
  // after it installs the starter.
  sharingModel: 'public_read_write',
  label: 'Company',
  pluralLabel: 'Companies',
  icon: 'building-2',
  color: 'blue',
  description: 'A company the organization works with.',
  highlightFields: ['type', 'industry', 'phone', 'owner_id'],

  fields: {
    name: Field.text({
      label: 'Company Name',
      required: true,
      searchable: true,
      maxLength: 200,
    }),
    type: Field.select({
      label: 'Type',
      options: [
        { label: 'Prospect', value: 'prospect', color: '#F59E0B', default: true },
        { label: 'Customer', value: 'customer', color: '#10B981' },
        { label: 'Partner', value: 'partner', color: '#3B82F6' },
        { label: 'Supplier', value: 'supplier', color: '#8B5CF6' },
        { label: 'Other', value: 'other', color: '#6B7280' },
      ],
    }),
    industry: Field.select({
      label: 'Industry',
      options: [
        { label: 'Technology', value: 'technology' },
        { label: 'Manufacturing', value: 'manufacturing' },
        { label: 'Retail', value: 'retail' },
        { label: 'Finance', value: 'finance' },
        { label: 'Healthcare', value: 'healthcare' },
        { label: 'Education', value: 'education' },
        { label: 'Other', value: 'other' },
      ],
    }),
    website: Field.url({
      label: 'Website',
    }),
    phone: Field.phone({
      label: 'Phone',
    }),
    address: Field.textarea({
      label: 'Address',
    }),
    description: Field.textarea({
      label: 'Description',
    }),
  },

  // The Details sections of the record page and of the create and edit form.
  fieldGroups: [
    { key: 'basic', label: 'Basic Information', fields: ['name', 'type', 'industry', 'owner_id'] },
    { key: 'contact_info', label: 'Contact Information', fields: ['phone', 'website', 'address'] },
    { key: 'more', label: 'More', fields: ['description'] },
  ],

  // The company's record page lists its contacts.
  relatedLists: [
    { list: 'starter_contact', columns: ['name', 'title', 'email', 'phone'] },
  ],
});
