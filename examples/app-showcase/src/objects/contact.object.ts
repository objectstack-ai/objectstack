// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * Contact — the canonical "create form ≠ edit form" example.
 *
 * See the scenario guide: content/docs/guides/solutions/create-vs-edit-form.mdx
 * and ADR-0047 (object UI run modes) for the model this demonstrates.
 *
 * The object declares a FLAT field set. Each field carries enough *intent* that
 * both the full edit form AND the slimmed create form can be DERIVED from this
 * single source — no second hand-maintained field list:
 *
 *   - `group`     → which section a field belongs to (semantic grouping that
 *                   travels with the data model, not a per-form layout).
 *   - declaration order = display order (there is no `field.order`; the order
 *                   you write fields in IS the default order everywhere).
 *   - `required`  → must appear on the create form.
 *   - `readonly` / derived → never on the create form (you can't set it).
 *   - `defaultValue` present → can be OMITTED from create (it self-fills).
 *
 * `views/contact.view.ts` then shows the two projections:
 *   - the full grouped edit form (mirrors what the platform auto-derives), and
 *   - a SPARSE `formViews.create` override for the rare case where you want to
 *     hand-shape the create experience.
 */
export const Contact = ObjectSchema.create({
  name: 'showcase_contact',
  label: 'Contact',
  pluralLabel: 'Contacts',
  icon: 'user',
  description:
    'Demonstrates derive-default + sparse-override forms: one flat, grouped, intent-tagged field set projects into both a full edit form and a slim create form (ADR-0047).',
  sharingModel: 'private',

  fields: {
    // ── Contact group: the core identity. These are what a create form asks. ──
    name: Field.text({ label: 'Full name', required: true, searchable: true, maxLength: 120, group: 'contact' }),
    email: Field.email({ label: 'Email', required: true, searchable: true, group: 'contact' }),
    phone: Field.text({ label: 'Phone', maxLength: 40, group: 'contact' }),

    // ── Work group: useful context, not required to bring a contact into being. ──
    company: Field.text({ label: 'Company', maxLength: 120, searchable: true, group: 'work' }),
    title: Field.text({ label: 'Job title', maxLength: 120, group: 'work' }),

    // ── Status group: lifecycle. `stage` has a default (so it can be omitted
    //    from create); `lead_score` is derived/readonly (so it must never be
    //    on the create form — you can't set it).
    stage: Field.select({
      label: 'Stage',
      group: 'status',
      options: [
        { label: 'New', value: 'new', default: true, color: '#3B82F6' },
        { label: 'Working', value: 'working', color: '#F59E0B' },
        { label: 'Qualified', value: 'qualified', color: '#10B981' },
        { label: 'Closed', value: 'closed', color: '#6B7280' },
      ],
    }),
    lead_score: Field.number({ label: 'Lead score', readonly: true, group: 'status', inlineHelpText: 'Computed by scoring rules — not user-editable.' }),

    // ── Notes group: long-form, edit-time only. ──
    notes: Field.text({ label: 'Notes', maxLength: 4000, group: 'notes' }),
  },
});
