// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

// One of the two objects this project starts with: the companies, and the
// people at them in `contact.object.ts`. They are the same definitions as the
// platform's Starter app, so a project scaffolded today and an environment
// that installed the Starter hold the same companies and contacts. They are
// yours now: rename a field, add one, or delete both objects once your own
// exist (the README's "What this project starts with" says what goes with
// them).
//
// The object's API name carries this project's namespace: scaffolding renamed
// every name in `src/`, references included, from the template's own. Write
// any new name the same way, `<namespace>_<name>`.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * A company the organization works with — a customer, a prospect, a supplier
 * or a partner.
 *
 * There is no owner field here: every package object gets the platform's
 * `owner_id` column, set to the creator on insert.
 */
export const Company = ObjectSchema.create({
  name: 'blank_company',
  // Org-wide default (OWD): who can see records they don't own.
  // `public_read_write` shares every company inside the organization;
  // `private` makes them owner-only until a permission grant or a sharing rule
  // widens access. Declaring it is required, deliberately: `objectstack build`
  // refuses an object that declares no OWD, so the baseline is always an
  // authored decision rather than an accident. The other values, and how to
  // widen access safely:
  // https://objectstack.ai/docs/permissions/sharing-rules
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

  // The Details sections of the record page and of the create and edit form,
  // top to bottom in this order. A field shows on the form only once a section
  // lists it, and `objectstack validate` reports a field that nothing displays
  // or reads, so list each field you add here too. Field groups versus a
  // view's own form sections:
  // https://objectstack.ai/docs/ui/field-grouping-and-order
  fieldGroups: [
    { key: 'basic', label: 'Basic Information', fields: ['name', 'type', 'industry', 'owner_id'] },
    { key: 'contact_info', label: 'Contact Information', fields: ['phone', 'website', 'address'] },
    { key: 'more', label: 'More', fields: ['description'] },
  ],

  // The company's record page lists its contacts.
  relatedLists: [
    { list: 'blank_contact', columns: ['name', 'title', 'email', 'phone'] },
  ],
});
