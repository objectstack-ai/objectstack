// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import {
  ObjectSchema,
  Field,
  ORGANIZATION_UNIT_CODE_PATTERN,
  UNIT_DIMENSIONS,
  UNIT_DIMENSION_BASE_CODES,
} from '@objectstack/spec/data';

/**
 * Decimal places a `ratio` keeps — twelve, as U7 R2 rules for every unit
 * ratio ("decimal, scale 12, never float") and as `sys_exchange_rate`'s
 * `rate` keeps. A write carrying more is refused at the engine's `scale`
 * seam, never rounded.
 */
export const UNIT_RATIO_SCALE = 12;

/** Total digits a `ratio` may carry: twelve on each side of the point. */
export const UNIT_RATIO_PRECISION = 24;

/**
 * The most decimal places a unit's display default may name. It is a display
 * default only (ADR-0158 L4): the field's own `scale` stays the storage
 * ceiling, and nothing is rounded at write by it.
 */
export const UNIT_DECIMAL_PLACES_MAX = 12;

/**
 * The ratio direction, stated once and read by every face that has to say it:
 * the `ratio` field's description and the Setup list page's description carry
 * this sentence verbatim. The base units are read from the standard unit
 * table, so the sentence cannot drift from it.
 */
export const UNIT_RATIO_DIRECTION =
  '1 of this unit = Ratio × the base unit of its dimension (' +
  `mass ${UNIT_DIMENSION_BASE_CODES.mass}, length ${UNIT_DIMENSION_BASE_CODES.length}, ` +
  `area ${UNIT_DIMENSION_BASE_CODES.area}, volume ${UNIT_DIMENSION_BASE_CODES.volume}, ` +
  `time ${UNIT_DIMENSION_BASE_CODES.time}, count ${UNIT_DIMENSION_BASE_CODES.count}). ` +
  'Example: a unit of half a kilogram in the mass dimension has ratio 0.5. A package unit takes no ratio.';

/**
 * What editing a ratio does (ADR-0158 L1, the maintainer's pick 「可改，只影响以后」
 * with the owning seat's UI sentence): an edit applies to records saved after
 * it and leaves stored records as they are.
 */
export const UNIT_RATIO_EDIT_NOTICE =
  'Changing the ratio affects only records saved afterwards; records already saved keep the quantity and conversion they were saved with. ' +
  'A changed specification is a new unit, not an edited ratio.';

/** The Setup labels of the closed dimension vocabulary, in its order. */
const DIMENSION_LABELS: Record<(typeof UNIT_DIMENSIONS)[number], string> = {
  mass: 'Mass',
  length: 'Length',
  area: 'Area',
  volume: 'Volume',
  time: 'Time',
  count: 'Count',
  package: 'Package',
};

/**
 * sys_unit — Unit of Measure (ADR-0158 U3; its Open items 2 and 11 settled
 * here)
 *
 * One row per unit of measure an ORGANIZATION adds beside the standard unit
 * table (`STANDARD_UNITS` in `@objectstack/spec`, U1). The platform ships
 * zero rows (U3). A quantity names a unit by its code, never by this row's id
 * (U4), and the membership check that admits a code (U5) reads the standard
 * table and this object (`validation/unit-code-membership.ts`,
 * `@objectstack/objectql`).
 *
 * - **Code** — exact uppercase, in the organization namespace
 *   (`ORGANIZATION_UNIT_CODE_PATTERN`, U3): at least four characters, or
 *   containing an underscore, so it can never collide with a standard code.
 *   Unique within the organization, refused on every write when outside the
 *   namespace, and immutable after create (L1).
 * - **Dimension** — one of the standard table's closed vocabulary
 *   (`UNIT_DIMENSIONS`); immutable after create (L1).
 * - **Ratio** — to the dimension's base unit, {@link UNIT_RATIO_DIRECTION}:
 *   required for every dimension but `package`, refused on `package`, the
 *   shape a standard code has (U1). An exact decimal, scale
 *   {@link UNIT_RATIO_SCALE}. Editable, and an edit affects later writes only
 *   (L1, {@link UNIT_RATIO_EDIT_NOTICE}); audited by field history.
 * - **Label** — one per unit, written by the organization in its own
 *   language (L2); translation of organization labels is a later card.
 * - **Decimal places** — the unit's display default (U6), never a storage
 *   rule: the field's `scale` is the ceiling (L4).
 * - **Retired** — the delete of L1, spelled as a one-way flag (Open item 11):
 *   a retired row keeps its code, so the code can never be created again with
 *   another dimension, ratio or label, and resting quantities never take a
 *   stranger's meaning. A hard delete is not served (`apiMethods` has no
 *   `delete`) and the engine refuses a direct one in every context, a system
 *   writer's and an automation run's included (`ERR_UNIT_DELETE_REFUSED`). The
 *   one exemption is the organization's own delete, whose cascade removes
 *   every unit of that organization (#35812). A retired unit cannot be
 *   brought back, and a new save with a retired code is refused
 *   (`ERR_UNIT_CODE_RETIRED`).
 * - **Tenancy** — no tenancy opt-out, so `organization_id` is injected and the
 *   Layer 0 tenant wall (ADR-0095 D1) scopes every read and write.
 * - **Who reads, who writes** — every member READS it (`member_default` names
 *   this object, read only), so a quantity's unit label displays to everyone
 *   who reads the quantity (the seat's U3 note). Organization administrators
 *   create, edit and retire units through `organization_admin`'s `sys_unit`
 *   line (Open item 2), which grants no delete; a member holds no write bit
 *   on it.
 *
 * @namespace sys
 */
export const SysUnit = ObjectSchema.create({
  name: 'sys_unit',
  label: 'Unit of Measure',
  pluralLabel: 'Units of Measure',
  icon: 'ruler',
  isSystem: true,
  // Platform-defined schema, organization-administered data.
  managedBy: 'system-data',
  // Retiring is the delete (Open item 11): no row is ever removed, so no
  // delete affordance is offered and the data API serves none.
  userActions: { delete: false },
  description:
    "The organization's own units of measure, beside the standard units every organization has — " +
    'one row per unit, named by a code in the organization namespace.',
  displayNameField: 'code',
  nameField: 'code', // [ADR-0079] canonical primary-title pointer (mirrors deprecated displayNameField)
  highlightFields: ['code', 'label', 'dimension', 'ratio', 'retired'],

  fields: {
    id: Field.text({ label: 'ID', required: true, readonly: true, group: 'System' }),

    code: Field.text({
      label: 'Code',
      required: true,
      searchable: true,
      maxLength: 32,
      trackHistory: true,
      description:
        'The code a quantity stores, in exact uppercase: letters, digits and underscores, at least 4 characters or containing an underscore (BOX_12, JIN1). ' +
        'Standard codes such as KGM and H87 are available to every organization and are not added here. The code cannot be changed after the unit is created.',
      group: 'Unit',
    }),

    label: Field.text({
      label: 'Label',
      required: true,
      searchable: true,
      maxLength: 80,
      trackHistory: true,
      description: "The name shown beside a quantity in this unit, in the organization's own language.",
      group: 'Unit',
    }),

    dimension: Field.select(
      UNIT_DIMENSIONS.map((value) => ({ value, label: DIMENSION_LABELS[value] })),
      {
        label: 'Dimension',
        required: true,
        trackHistory: true,
        description:
          'What the unit measures. A package unit (a box, a bag) has no fixed ratio. The dimension cannot be changed after the unit is created.',
        group: 'Unit',
      },
    ),

    ratio: Field.number({
      label: 'Ratio',
      // The smallest positive value at this scale: a zero or negative ratio
      // would silently zero or flip every quantity converted through it.
      min: 10 ** -UNIT_RATIO_SCALE,
      scale: UNIT_RATIO_SCALE,
      precision: UNIT_RATIO_PRECISION,
      trackHistory: true,
      description: `${UNIT_RATIO_DIRECTION} ${UNIT_RATIO_EDIT_NOTICE}`,
      group: 'Conversion',
    }),

    decimal_places: Field.number({
      label: 'Decimal Places',
      min: 0,
      max: UNIT_DECIMAL_PLACES_MAX,
      scale: 0,
      trackHistory: true,
      description:
        "How many decimal places a quantity in this unit displays with by default. It never rounds a stored value, and a field's own decimal places still limit what is stored.",
      group: 'Display',
    }),

    retired: Field.boolean({
      label: 'Retired',
      defaultValue: false,
      trackHistory: true,
      description:
        'A retired unit stays on file so its code can never be reused, and records that already use it keep showing it. ' +
        'New records cannot use a retired unit. Retiring cannot be undone.',
      group: 'Unit',
    }),
  },

  indexes: [
    { fields: ['code'], unique: 'organization' },
  ],

  // `validations` is the server-enforced channel: objectql's rule validator runs
  // it on insert, by-id update and bulk update (ADR-0049 declared = enforced).
  validations: [
    {
      // U3: the organization namespace. An absent value is left to `required`.
      type: 'format',
      name: 'unit_code_organization_namespace',
      field: 'code',
      regex: ORGANIZATION_UNIT_CODE_PATTERN,
      severity: 'error',
      message:
        'A unit code is uppercase letters, digits and underscores, at least 4 characters long or containing an underscore (for example BOX_12 or JIN1). ' +
        'Shorter codes are reserved for the standard units.',
    },
    {
      // L1: a unit's code is immutable after create. `cross_field` so the
      // refusal is attached to the field it is about.
      type: 'cross_field',
      name: 'unit_code_immutable',
      events: ['update'],
      condition: 'previous != null && record.code != previous.code',
      fields: ['code'],
      severity: 'error',
      message: "A unit's code cannot be changed after it is created. Create a new unit with the new code instead.",
    },
    {
      // L1: a unit's dimension is immutable after create.
      type: 'cross_field',
      name: 'unit_dimension_immutable',
      events: ['update'],
      condition: 'previous != null && record.dimension != previous.dimension',
      fields: ['dimension'],
      severity: 'error',
      message: "A unit's dimension cannot be changed after it is created. Create a new unit with the new dimension instead.",
    },
    {
      // U1's shape: a ratio dimension carries a ratio.
      type: 'cross_field',
      name: 'unit_ratio_required',
      condition: "record.dimension != 'package' && record.ratio == null",
      fields: ['ratio'],
      severity: 'error',
      message: 'Enter the ratio to the base unit of this dimension.',
    },
    {
      // U1's shape: a package unit carries no ratio.
      type: 'cross_field',
      name: 'unit_package_has_no_ratio',
      condition: "record.dimension == 'package' && record.ratio != null",
      fields: ['ratio'],
      severity: 'error',
      message: 'A package unit has no ratio: how much a package holds belongs to the item, not to the unit. Clear the ratio.',
    },
    {
      // Open item 11: retiring is one-way, like the delete it stands for.
      type: 'cross_field',
      name: 'unit_retired_one_way',
      events: ['update'],
      condition: 'previous != null && previous.retired == true && record.retired != true',
      fields: ['retired'],
      severity: 'error',
      message: 'A retired unit cannot be brought back. Create a unit with a new code instead.',
    },
  ],

  listViews: {
    all_units: {
      type: 'grid',
      name: 'all_units',
      label: 'All',
      description: UNIT_RATIO_DIRECTION,
      data: { provider: 'object', object: 'sys_unit' },
      columns: ['code', 'label', 'dimension', 'ratio', 'decimal_places', 'retired'],
      sort: [
        { field: 'dimension', order: 'asc' },
        { field: 'code', order: 'asc' },
      ],
      pagination: { pageSize: 50 },
      emptyState: {
        title: 'No units of measure yet',
        message:
          'Standard units such as kilogram (KGM) and piece (H87) are available already. Add a unit here only when your organization needs one they do not cover.',
      },
    },
  },

  enable: {
    trackHistory: true,
    searchable: false,
    apiEnabled: true,
    // Retiring is the delete (Open item 11): the generic data API serves no
    // delete, so no request can free a code. `bulk` batches only the verbs
    // granted here (`bulk ∧ child`), so a batched delete is refused too.
    apiMethods: ['get', 'list', 'create', 'update', 'bulk'],
    // A unit is reference data, not a discussion surface.
    feeds: false,
  },
});
