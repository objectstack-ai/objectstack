// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// The other object this project starts with, beside `company.object.ts`, and
// the same definition as the platform's Starter app.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * A person outside the organization — someone at a company it works with.
 *
 * Not a user and not an employee: the platform's own people objects stay what
 * they are, and a contact never signs in. A contact belongs to at most one
 * company (`company`), and the company's record page lists its contacts.
 */
export const Contact = ObjectSchema.create({
  name: 'blank_contact',
  // Shared inside the organization, as the companies are.
  sharingModel: 'public_read_write',
  label: 'Contact',
  pluralLabel: 'Contacts',
  icon: 'contact',
  color: 'green',
  description: 'A person at a company the organization works with.',
  nameField: 'name',
  highlightFields: ['company', 'title', 'email', 'phone'],

  fields: {
    name: Field.text({
      label: 'Name',
      required: true,
      searchable: true,
      maxLength: 120,
    }),
    company: Field.lookup('blank_company', {
      label: 'Company',
    }),
    title: Field.text({
      label: 'Job Title',
      maxLength: 120,
    }),
    influence: Field.select({
      label: 'Influence',
      options: [
        { label: 'Decision Maker', value: 'decision_maker', color: '#EF4444' },
        { label: 'Influencer', value: 'influencer', color: '#F59E0B' },
        { label: 'User', value: 'user', color: '#3B82F6' },
        { label: 'Other', value: 'other', color: '#6B7280', default: true },
      ],
    }),
    email: Field.email({
      label: 'Email',
      searchable: true,
    }),
    phone: Field.phone({
      label: 'Phone',
      searchable: true,
    }),
    notes: Field.textarea({
      label: 'Notes',
    }),
  },

  fieldGroups: [
    { key: 'basic', label: 'Basic Information', fields: ['name', 'company', 'title', 'influence', 'owner_id'] },
    { key: 'contact_info', label: 'Contact Information', fields: ['email', 'phone'] },
    { key: 'more', label: 'More', fields: ['notes'] },
  ],
});
