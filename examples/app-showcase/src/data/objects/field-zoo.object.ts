// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field } from '@objectstack/spec/data';
import { cel } from '@objectstack/spec';

/**
 * Field Zoo — one field of (almost) every `FieldType` the protocol defines.
 *
 * This is a synthetic "standard" object whose only job is exhaustive
 * data-layer coverage: the {@link COVERAGE} manifest and the coverage test
 * assert that every member of `FieldTypeSchema` appears at least once across
 * the stack, and this object carries the bulk of them. Builder helpers
 * (`Field.text(...)`) are used where they exist; the remaining types are
 * declared as raw `{ type, ... }` literals (the field input is
 * `Omit<Partial<Field>, 'type'>`, so any valid type string is accepted).
 *
 * Relationship types (`lookup`, `master_detail`, `tree`) point at the other
 * showcase objects so $expand and hierarchy resolution have real targets.
 */
export const FieldZoo = ObjectSchema.create({
  name: 'showcase_field_zoo',
  // [ADR-0090 D1] Explicit grandfather stamp: record isolation for this demo
  // object is RLS-owned / intentionally public; without this the new secure
  // default (unset OWD => private) would owner-filter it.
  sharingModel: 'public_read_write',
  label: 'Field Zoo',
  pluralLabel: 'Field Zoo',
  icon: 'shapes',
  description: 'One field of every supported type — exhaustive data-layer coverage.',

  fields: {
    // ── Core text ───────────────────────────────────────────────────────
    name: Field.text({ label: 'Name', required: true, searchable: true, maxLength: 200 }),
    f_textarea: Field.textarea({ label: 'Textarea' }),
    f_email: Field.email({ label: 'Email', searchable: true }),
    f_url: Field.url({ label: 'URL' }),
    f_phone: Field.phone({ label: 'Phone' }),
    // field-zoo intentionally exercises every field type, so the generic
    // `password` contract (plaintext at rest, masked on read — ADR-0100) is
    // deliberate here. Affirm it so the official example boots warning-free (#3420).
    f_password: Field.password({ label: 'Password (masked on read)', ackPlaintextMasking: true }),
    f_secret: Field.secret({ label: 'Secret (encrypted at rest)' }),

    // ── Rich content ─────────────────────────────────────────────────────
    f_markdown: Field.markdown({ label: 'Markdown' }),
    f_html: Field.html({ label: 'HTML' }),
    f_richtext: Field.richtext({ label: 'Rich Text' }),

    // ── Numbers ──────────────────────────────────────────────────────────
    f_number: Field.number({ label: 'Number', min: 0, max: 1000 }),
    f_currency: Field.currency({ label: 'Currency', scale: 2, min: 0, currencyConfig: { currencyMode: 'fixed', defaultCurrency: 'USD', precision: 2 } }),
    f_percent: Field.percent({ label: 'Percent', min: 0, max: 100, defaultValue: 50 }),

    // ── Date & time ──────────────────────────────────────────────────────
    f_date: Field.date({ label: 'Date' }),
    f_datetime: Field.datetime({ label: 'Date / Time' }),
    f_time: { type: 'time', label: 'Time' },

    // ── Logic ────────────────────────────────────────────────────────────
    f_boolean: Field.boolean({ label: 'Boolean' }),
    f_toggle: { type: 'toggle', label: 'Toggle', defaultValue: false },

    // ── Selection ────────────────────────────────────────────────────────
    f_select: Field.select({
      label: 'Select',
      options: [
        { label: 'Low', value: 'low', default: true, color: '#94A3B8' },
        { label: 'Medium', value: 'medium', color: '#F59E0B' },
        { label: 'High', value: 'high', color: '#EF4444' },
      ],
    }),
    f_multiselect: {
      type: 'multiselect',
      label: 'Multi-select',
      options: [
        { label: 'Red', value: 'red' },
        { label: 'Green', value: 'green' },
        { label: 'Blue', value: 'blue' },
      ],
    },
    f_radio: {
      type: 'radio',
      label: 'Radio',
      options: [
        { label: 'Yes', value: 'yes' },
        { label: 'No', value: 'no' },
      ],
    },
    f_checkboxes: {
      type: 'checkboxes',
      label: 'Checkboxes',
      options: [
        { label: 'Email', value: 'email' },
        { label: 'SMS', value: 'sms' },
        { label: 'Push', value: 'push' },
      ],
    },
    f_tags: { type: 'tags', label: 'Tags' },

    // ── Relational ───────────────────────────────────────────────────────
    f_lookup: Field.lookup('showcase_account', { label: 'Lookup → Account' }),
    f_master_detail: Field.masterDetail('showcase_project', { label: 'Master-Detail → Project' }),
    f_tree: { type: 'tree', label: 'Tree (self/category)', reference: 'showcase_category' },

    // ── User (lookup specialized to sys_user) ────────────────────────────
    f_user: Field.user({ label: 'User → sys_user (single)' }),
    f_users: Field.user({ label: 'Users (multiple)', multiple: true }),
    f_owner: Field.user({ label: 'Owner (current_user default)', defaultValue: 'current_user' }),

    // ── Media ────────────────────────────────────────────────────────────
    f_image: Field.image({ label: 'Image' }),
    f_file: Field.file({ label: 'File' }),
    f_avatar: Field.avatar({ label: 'Avatar' }),
    f_video: { type: 'video', label: 'Video' },
    f_audio: { type: 'audio', label: 'Audio' },

    // ── Calculated / system ──────────────────────────────────────────────
    f_formula: Field.formula({
      label: 'Formula (number × percent)',
      expression: cel`(record.f_number == null ? 0 : record.f_number) * (record.f_percent == null ? 0 : record.f_percent) / 100`,
    }),
    f_summary: Field.summary({ label: 'Roll-up Summary' }),
    f_autonumber: Field.autonumber({ label: 'Auto Number' }),

    // ── Embedded structured values (stored as JSON on the row) ───────────
    f_composite: { type: 'composite', label: 'Composite (embedded object)' },
    f_repeater: { type: 'repeater', label: 'Repeater (embedded array)' },
    f_record: { type: 'record', label: 'Record (name-keyed map)' },

    // ── Enhanced types ───────────────────────────────────────────────────
    f_location: Field.location({ label: 'Location (GPS)' }),
    f_address: Field.address({ label: 'Address' }),
    f_code: Field.code('json', { label: 'Code Editor' }),
    f_json: Field.json({ label: 'JSON' }),
    f_color: Field.color({ label: 'Color' }),
    f_rating: { type: 'rating', label: 'Rating', max: 5 },
    f_slider: Field.slider({ label: 'Slider', min: 0, max: 100, step: 5 }),
    f_signature: Field.signature({ label: 'Signature' }),
    f_qrcode: Field.qrcode({ label: 'QR / Barcode' }),
    f_progress: { type: 'progress', label: 'Progress', min: 0, max: 100 },

    // ── AI / ML ──────────────────────────────────────────────────────────
    f_vector: { type: 'vector', label: 'Embedding Vector', dimensions: 1536 },
  },
});
