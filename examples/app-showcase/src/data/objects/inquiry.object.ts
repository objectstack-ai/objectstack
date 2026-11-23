// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * Inquiry — the inbox behind the PUBLIC FORM (ADR-0056 Option A).
 *
 * This is the Salesforce *Web-to-Lead* target: a "Contact Us / Request a Demo"
 * form is exposed to anonymous visitors (see `views/inquiry.view.ts`,
 * `sharing.allowAnonymous: true`). The submit route DERIVES authorization from
 * the form's own declaration — a narrow `publicFormGrant: { object:
 * 'showcase_inquiry' }` — so an anonymous POST can create exactly one inquiry
 * (and read it back) and nothing else, with NO `guest_portal` profile required
 * and even under secure-by-default (`requireAuth`). The grant is create +
 * read-back only; everything authenticated staff need (triage, status changes)
 * comes from a normal permission set.
 *
 * `sharingModel: 'private'` keeps inquiries owner/staff-scoped once inside —
 * the public path only ever inserts, never lists.
 */
export const Inquiry = ObjectSchema.create({
  name: 'showcase_inquiry',
  label: 'Inquiry',
  pluralLabel: 'Inquiries',
  icon: 'mail',
  color: 'pink',
  description: 'A public contact-form submission — created anonymously via the web-to-lead public form (ADR-0056 Option A).',

  // Once inside, an inquiry is staff-only. The public form does not read the
  // list; it only inserts + reads back the row it just created.
  sharingModel: 'private',

  fields: {
    name: Field.text({ label: 'Name', required: true, searchable: true, maxLength: 120 }),
    email: Field.email({ label: 'Email', required: true, searchable: true }),
    company: Field.text({ label: 'Company', maxLength: 120 }),
    message: Field.text({ label: 'Message', required: true, maxLength: 2000 }),
    // Server-controlled — anonymous submitters can never set these (the form
    // whitelist excludes them and the guest-defaults hook stamps/strips them).
    status: Field.select({
      label: 'Status',
      options: [
        { label: 'New', value: 'new', default: true, color: '#3B82F6' },
        { label: 'Contacted', value: 'contacted', color: '#F59E0B' },
        { label: 'Closed', value: 'closed', color: '#10B981' },
      ],
    }),
    source: Field.text({ label: 'Source', maxLength: 40 }),
  },
});
