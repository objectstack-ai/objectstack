// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { defineView } from '@objectstack/spec';

const data = { provider: 'object' as const, object: 'showcase_contact' };

/**
 * Contact views — the "create form ≠ edit form" pattern.
 *
 * Scenario guide: content/docs/guides/solutions/create-vs-edit-form.mdx
 * Decision record: ADR-0047 (object UI run modes — derive-default + override).
 *
 * Two projections of ONE flat, grouped field set (see objects/contact.object.ts):
 *
 *   • `form` (default edit/detail) — the FULL record, grouped into sections by
 *     each field's `group`. This mirrors what the platform auto-derives from
 *     `field.group`; it is written out explicitly here only so the example is
 *     legible. In the target model you can OMIT it and get an equivalent
 *     grouped form for free. Sections list fields as bare strings → every
 *     field inherits its type / validation / FLS / default from the object.
 *
 *   • `formViews.create` (the escape hatch) — a SPARSE override for the create
 *     experience: just the core fields, one ungrouped section. Note what is
 *     absent: `lead_score` (readonly/derived — can't be set), `stage` (has a
 *     default — self-fills), `notes` (edit-time only). Nothing here restates a
 *     field's type or rules; it only chooses WHICH fields appear and WHERE.
 *
 * The list view binds the create entry point to that form via
 * `addRecord: { mode: 'form', formView: 'create' }`.
 */
export const ContactViews = defineView({
  // Default list — carries `data` so the view registrar can resolve the object.
  list: {
    label: 'Contacts',
    type: 'grid',
    data,
    columns: [
      { field: 'name' },
      { field: 'email' },
      { field: 'company' },
      { field: 'stage' },
    ],
    // Create uses the slim, hand-shaped form rather than the full edit form.
    addRecord: { enabled: true, mode: 'form', formView: 'create' },
  },

  // ── Default (edit/detail) form: the full record, grouped by `field.group`.
  //    Bare field names → inherit everything from the object definition. ──
  form: {
    type: 'simple',
    data,
    sections: [
      { name: 'contact', label: 'Contact', columns: 2, fields: ['name', 'email', 'phone'] },
      { name: 'work', label: 'Work', columns: 2, fields: ['company', 'title'] },
      { name: 'status', label: 'Status', columns: 2, fields: ['stage', 'lead_score'] },
      { name: 'notes', label: 'Notes', columns: 1, fields: ['notes'] },
    ],
  },

  formViews: {
    // ── Sparse create override: only the core fields, one section.
    //    Omits derived (`lead_score`), defaulted (`stage`) and edit-time
    //    (`notes`) fields. `owner_id`-style overrides would go inline as
    //    `{ field: 'phone', required: true }` — only where you actually
    //    override; everything else stays a bare string and inherits. ──
    create: {
      type: 'simple',
      data,
      title: 'New contact',
      sections: [
        {
          label: 'Who is this?',
          columns: 1,
          fields: ['name', 'email', 'phone', 'company'],
        },
      ],
      submitBehavior: { kind: 'thank-you', title: 'Contact created', message: 'You can fill in the rest on the record.' },
    },
  },
});
