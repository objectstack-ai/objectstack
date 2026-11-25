// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { ObjectSchema, Field, STANDARD_UNITS } from '@objectstack/spec/data';
import { UNIT_DECIMAL_PLACES_MAX } from './sys-unit.object.js';

/**
 * The codes a row may name: every key of the standard unit table (ADR-0158
 * U1), in its order. Read from the table, so a code the table gains is
 * selectable here with no second edit, and a code it never held is refused
 * by the select's closed option set.
 */
export const STANDARD_UNIT_SETTING_CODES: readonly string[] = Object.freeze(Object.keys(STANDARD_UNITS));

/**
 * sys_standard_unit_setting — Standard Unit Setting (ADR-0158 U6, its Open
 * item 10 answered by the maintainer's option A 「组织可改,新开一处设置」)
 *
 * One row per standard unit an ORGANIZATION has set a display default for.
 * The standard unit table (`STANDARD_UNITS` in `@objectstack/spec`, U1) is a
 * closed spec constant, and `sys_unit` holds org-added units only (U3), so the
 * decimal places of a standard code such as `KGM` or `H87` live here, beside
 * the `decimal_places` column an org-added unit carries on its own row. The
 * platform ships zero rows: a standard unit with no row has no display
 * default of its own (U1 names none).
 *
 * - **Code** — one of the standard table's codes
 *   ({@link STANDARD_UNIT_SETTING_CODES}). Unique within the organization and
 *   immutable after create: a row is the setting OF that code, so a wrong code
 *   is corrected by deleting the row and adding the right one.
 * - **Decimal places** — the unit's display default (U6), a whole number from
 *   0 to {@link UNIT_DECIMAL_PLACES_MAX}, the same range as `sys_unit`'s
 *   column. Never a storage rule (L4): the field's own `scale` is the ceiling,
 *   a display never shows more places than it, and nothing is rounded at write
 *   by this value. Required: a row exists only while a value is set.
 * - **Clearing** — deleting the row. The standard unit then has no display
 *   default of its own again. A deleted row frees nothing a stored record
 *   depends on (a record stores the code, and the code stays standard), so
 *   unlike `sys_unit` the delete is served; it is also what lets an
 *   organization delete itself, which refuses while any of its records
 *   remain, as an exchange rate does.
 * - **Tenancy** — no tenancy opt-out, so `organization_id` is injected and the
 *   Layer 0 tenant wall (ADR-0095 D1) scopes every read and write: another
 *   organization's value is never read.
 * - **Who reads, who writes** — every member READS it (`member_default` names
 *   this object, read only), as `sys_unit` is read, so a quantity displays
 *   with the same default for everyone who reads it. Organization
 *   administrators create, edit and delete rows through
 *   `organization_admin`'s line; a member holds no write bit on it.
 * - **Audit** — not on the audit writer's skip list, so every create, edit
 *   and delete lands in `sys_audit_log`, and `enable.trackHistory` plus the
 *   per-field flags keep the old and new values, as a unit's ratio edit is
 *   kept (L1).
 *
 * @namespace sys
 */
export const SysStandardUnitSetting = ObjectSchema.create({
  name: 'sys_standard_unit_setting',
  label: 'Standard Unit Setting',
  pluralLabel: 'Standard Unit Settings',
  icon: 'ruler',
  color: 'green',
  isSystem: true,
  // Platform-defined schema, organization-administered data.
  managedBy: 'system-data',
  description:
    'How many decimal places a quantity in a standard unit of measure (KGM, H87, …) displays with in this organization — ' +
    'one row per standard unit the organization has set.',
  displayNameField: 'code',
  nameField: 'code', // [ADR-0079] canonical primary-title pointer (mirrors deprecated displayNameField)
  highlightFields: ['code', 'decimal_places'],

  fields: {
    id: Field.text({ label: 'ID', required: true, readonly: true, group: 'System' }),

    code: Field.select(
      STANDARD_UNIT_SETTING_CODES.map((value) => ({ value, label: value })),
      {
        label: 'Standard Unit',
        required: true,
        searchable: true,
        trackHistory: true,
        description:
          'The standard unit code (UN/ECE Recommendation 20), for example KGM for kilogram or H87 for piece. ' +
          "The organization's own units carry their decimal places on the unit itself, under Units of Measure. " +
          'The code cannot be changed after the setting is created.',
        group: 'Unit',
      },
    ),

    decimal_places: Field.number({
      label: 'Decimal Places',
      required: true,
      min: 0,
      max: UNIT_DECIMAL_PLACES_MAX,
      scale: 0,
      trackHistory: true,
      description:
        "How many decimal places a quantity in this unit displays with by default. It never rounds a stored value, and a field's own decimal places still limit what is stored and shown. " +
        'Delete the setting to clear it.',
      group: 'Display',
    }),
  },

  indexes: [
    { fields: ['code'], unique: 'organization' },
  ],

  // `validations` is the server-enforced channel: objectql's rule validator runs
  // it on insert, by-id update and bulk update (ADR-0049 declared = enforced).
  validations: [
    {
      // A row is the setting of its code: the code is immutable after create.
      // `cross_field` so the refusal is attached to the field it is about.
      type: 'cross_field',
      name: 'standard_unit_setting_code_immutable',
      events: ['update'],
      condition: 'previous != null && record.code != previous.code',
      fields: ['code'],
      severity: 'error',
      message: "A setting's unit cannot be changed after it is created. Delete it and add a setting for the other unit instead.",
    },
  ],

  listViews: {
    all_settings: {
      type: 'grid',
      name: 'all_settings',
      label: 'All',
      description:
        'Decimal places a quantity in a standard unit displays with in this organization. ' +
        "A field's own decimal places still limit what is stored and shown.",
      data: { provider: 'object', object: 'sys_standard_unit_setting' },
      columns: ['code', 'decimal_places'],
      sort: [{ field: 'code', order: 'asc' }],
      pagination: { pageSize: 50 },
      emptyState: {
        title: 'No standard unit settings yet',
        message:
          'Standard units display with the decimal places of the field that holds the quantity. ' +
          'Add a setting to give a standard unit, such as grams or kilograms, its own number of decimal places.',
      },
    },
  },

  enable: {
    trackHistory: true,
    searchable: false,
    apiEnabled: true,
    // A setting is reference data, not a discussion surface.
    feeds: false,
  },
});
