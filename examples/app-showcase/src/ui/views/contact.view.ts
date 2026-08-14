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
 *     each field's `group`. This mirrors what the platform auto-derives, and
 *     it is written out explicitly here only so the example is legible: OMIT
 *     it and `deriveFieldGroupLayout` (ADR-0085 §5) produces these same four
 *     sections, in this order, with these members. Sections list fields as
 *     bare strings → every field inherits its type / validation / FLS /
 *     default from the object.
 *
 *     The derivation's authority is the object's `fieldGroups` DECLARATION,
 *     not `field.group` on its own: a field whose `group` names no declared
 *     key falls into the trailing ungrouped bucket exactly as if it carried no
 *     `group` at all (`os lint` reports it as `field-group-undeclared`). That
 *     is why `objects/contact.object.ts` declares all four keys — without them
 *     this comment would be promising a grouping the platform never derives
 *     (#5443).
 *
 *     Two honest differences from the hand-written version below, both of them
 *     the reason the explicit `form` is still worth authoring here: the
 *     derived layout appends the platform-injected `owner_id` in a trailing
 *     untitled section (audit/system columns are excluded, ownership is not),
 *     and per-section presentation like `columns: 2` is a form-view knob the
 *     group declaration does not carry.
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
      { name: 'work', label: 'Work', columns: 2, fields: ['company', 'title', 'account'] },
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
          // #8231 remainder — a stable `name` is the only thing that makes
          // this heading translatable; see `_sections.who_is_this` in
          // `system/translations/index.ts`.
          name: 'who_is_this',
          label: 'Who is this?',
          columns: 1,
          fields: ['name', 'email', 'phone', 'company'],
        },
      ],
      submitBehavior: { kind: 'thank-you', title: 'Contact created', message: 'You can fill in the rest on the record.' },
    },
  },
});
