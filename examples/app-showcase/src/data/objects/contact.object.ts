// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * Contact — the canonical "create form ≠ edit form" example.
 *
 * See the scenario guide: content/docs/ui/create-vs-edit-form.mdx
 * and ADR-0047 (object UI run modes) for the model this demonstrates.
 *
 * The object declares ONE flat field set, and both forms come from it. No
 * form view is written for either (`ui/views/contact.view.ts` holds the list
 * only):
 *
 *   - `fieldGroups` + `group` → the sections, on the create form, the edit
 *                   form and the record page alike (ADR-0085 §5). A `group`
 *                   counts only when `fieldGroups` below DECLARES its key.
 *   - declaration order = display order (there is no `field.order`; the order
 *                   you write fields in IS the order inside a group).
 *   - `required`  → always asked for on create.
 *   - `showOnCreate: false` → left out of create; still on edit, the record
 *                   page and lists. Here: `title` and `account` (context, not
 *                   needed to bring a contact into being), `stage` (it has a
 *                   default, so it self-fills), `lead_score` (readonly — it
 *                   cannot be set) and `notes` (edit-time only). The create
 *                   form therefore asks for name, email, phone and company.
 */
export const Contact = ObjectSchema.create({
  name: 'showcase_contact',
  label: 'Contact',
  pluralLabel: 'Contacts',
  icon: 'user',
  color: 'blue',
  description:
    'Demonstrates one field set for two forms: its field groups lay out both the full edit form and the create form, and the fields marked showOnCreate false are left out of create (ADR-0047).',
  sharingModel: 'private',

  fields: {
    // ── Contact group: the core identity. These are what a create form asks. ──
    name: Field.text({ label: 'Full name', required: true, searchable: true, maxLength: 120, group: 'contact' }),
    email: Field.email({ label: 'Email', required: true, searchable: true, group: 'contact' }),
    phone: Field.text({ label: 'Phone', maxLength: 40, group: 'contact' }),

    // ── Work group: useful context, not required to bring a contact into being.
    //    The create form asks for the company only. ──
    company: Field.text({ label: 'Company', maxLength: 120, searchable: true, group: 'work' }),
    title: Field.text({ label: 'Job title', maxLength: 120, group: 'work', showOnCreate: false }),
    // Which account this person belongs to — the parent side of the dependent
    // (cascading) lookup demo: showcase_invoice.contact declares
    // `dependsOn: ['account']`, so the invoice's contact picker only offers
    // contacts whose `account` matches the invoice's selected account.
    account: Field.lookup('showcase_account', { label: 'Account', group: 'work', showOnCreate: false }),

    // ── Status group: lifecycle. `stage` has a default (so create leaves it
    //    out and it self-fills); `lead_score` is derived/readonly (so create
    //    leaves it out — you can't set it).
    stage: Field.select({
      label: 'Stage',
      group: 'status',
      showOnCreate: false,
      options: [
        { label: 'New', value: 'new', default: true, color: '#3B82F6' },
        { label: 'Working', value: 'working', color: '#F59E0B' },
        { label: 'Qualified', value: 'qualified', color: '#10B981' },
        { label: 'Closed', value: 'closed', color: '#6B7280' },
      ],
    }),
    lead_score: Field.number({ label: 'Lead score', readonly: true, group: 'status', showOnCreate: false, inlineHelpText: 'Computed by scoring rules — not user-editable.' }),

    // ── Notes group: long-form, edit-time only. ──
    notes: Field.text({ label: 'Notes', maxLength: 4000, group: 'notes', showOnCreate: false }),
  },

  // [ADR-0085 §5] The DECLARATION side of the grouping edge, and the reason the
  // section headings above are real sections rather than decoration.
  //
  // `Field.group` alone does not create a group: `deriveFieldGroupLayout` —
  // the one derivation every renderer and the i18n walker consume — only
  // buckets a field whose `group` matches a key declared HERE, and drops
  // everything else into the trailing untitled bucket. So a `group` with no
  // matching entry renders exactly like no `group` at all (`os lint` says so
  // as `field-group-undeclared`), which is what these nine fields did before
  // #5443. Array order is display order. These four are the sections of the
  // create form, the edit form and the record page: no form view restates
  // them.
  fieldGroups: [
    { key: 'contact', label: 'Contact' },
    { key: 'work', label: 'Work' },
    { key: 'status', label: 'Status' },
    { key: 'notes', label: 'Notes' },
  ],
});
