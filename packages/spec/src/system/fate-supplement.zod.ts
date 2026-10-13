// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { z } from 'zod';
import { lazySchema } from '../shared/lazy-schema';
import { strictObject } from '../shared/strict-object';
import { SnakeCaseIdentifierSchema } from '../shared/identifiers.zod';

/**
 * The host fate supplement — the fates a HOST declares for the objects it
 * provides, read by the v18 organization-ownership ceremony
 * (`os migrate organization-ownership --fate-supplement FILE`, ADR-0131 D10).
 *
 * ## Why a host declares anything
 *
 * ADR-0131 D10 drives the ceremony from one inventory: one fate, with its
 * citation, for every object that carries `organization_id` — "the two
 * censuses seed it … cloud's supplement for cloud-declared ones". The
 * platform's rows live with the ceremony (`@objectstack/cli`). An object a
 * host provides is not the platform's to give a fate: the ceremony refuses a
 * platform-prefixed table it holds no fate for rather than guess one. This
 * file is the declared channel through which the host supplies those rows. It
 * is a JSON array of {@link OrganizationOwnershipSupplementEntrySchema} rows,
 * and nothing reads it unless the command is handed it: no environment
 * variable, no conventional path.
 *
 * ## The same terms as the platform's rows
 *
 * Each row is the platform inventory's entry shape, minus what only the
 * platform states (the census that counted the object, and its own
 * markers). The ceremony stamps the row's census itself and plans it exactly
 * as it plans a platform row: the same fates, anchors, mirror selector,
 * departures and counted categories. What it refuses beyond this schema is
 * the ceremony's to say: a row naming an object the platform inventory
 * already gives a fate, and a second row for one object.
 *
 * ## The four fates (ADR-0131 D10)
 *
 *  1. `column-drop` — the object ends with no `organization_id` column.
 *  2. `mirror-deletion` — rows re-derivable from code; deleted only after the
 *     verified id-to-name rewrite. `mirror` says which rows are mirrors.
 *  3. `attribution` — NULL rows take their organization from an anchor, in
 *     order; under the `single` posture, the Default Organization.
 *  4. `report` — rows are listed, never guessed and never deleted.
 *
 * Each fate admits only the keys that fate reads, so a key written on the
 * wrong fate is refused instead of read by nothing.
 */

const SUPPLEMENT_HISTORY =
  'The host fate supplement is strict from birth: no earlier spelling of this file existed, so an unknown key '
  + 'was never accepted.';

/**
 * A physical column a row predicate, anchor or category reads. The ceremony
 * binds every value and quotes every identifier, so a column is a plain
 * snake_case name (object name = table name; machine names are snake_case).
 */
const ColumnNameSchema = SnakeCaseIdentifierSchema;

/** Prose the ceremony prints beside a count; at least one non-whitespace character. */
const ProseSchema = z.string().min(1).regex(/\S/);

/** The four ADR-0131 D10 fates. */
export const OrganizationOwnershipFateSchema = lazySchema(() => z
  .enum(['column-drop', 'mirror-deletion', 'attribution', 'report'])
  .describe('ADR-0131 D10 fate: column-drop, mirror-deletion, attribution or report'));
export type OrganizationOwnershipFate = z.infer<typeof OrganizationOwnershipFateSchema>;

/**
 * One condition on a row. A predicate ANDs them. Data, never SQL text: the
 * ceremony binds every value and quotes the column.
 */
export const OrganizationOwnershipRowConditionSchema = lazySchema(() => z
  .union([
    strictObject(
      { surface: 'an `equals` row condition', history: SUPPLEMENT_HISTORY },
      {
        column: ColumnNameSchema.describe('Column the condition reads'),
        equals: z.union([z.string(), z.number(), z.boolean()]).describe('The column equals this value'),
      },
    ),
    strictObject(
      { surface: 'an `in` row condition', history: SUPPLEMENT_HISTORY },
      {
        column: ColumnNameSchema.describe('Column the condition reads'),
        in: z.array(z.string()).min(1).describe('The column holds one of these values'),
      },
    ),
    strictObject(
      { surface: 'a `notIn` row condition', history: SUPPLEMENT_HISTORY },
      {
        column: ColumnNameSchema.describe('Column the condition reads'),
        notIn: z.array(z.string()).min(1).describe('The column is NULL or holds none of these values'),
      },
    ),
    strictObject(
      { surface: 'an `isNull` row condition', history: SUPPLEMENT_HISTORY },
      {
        column: ColumnNameSchema.describe('Column the condition reads'),
        isNull: z.boolean().describe('true: the column is NULL; false: it is not'),
      },
    ),
    strictObject(
      { surface: 'a `notTrue` row condition', history: SUPPLEMENT_HISTORY },
      {
        column: ColumnNameSchema.describe('Column the condition reads'),
        notTrue: z.literal(true).describe('The column is NULL or holds anything but true'),
      },
    ),
  ])
  .describe('One condition on a row: equals, in, notIn, isNull or notTrue on one column'));
export type OrganizationOwnershipRowCondition = z.infer<typeof OrganizationOwnershipRowConditionSchema>;

const RowPredicateSchema = z.array(OrganizationOwnershipRowConditionSchema);

/**
 * Where a NULL row's organization comes from (fate 3). Tried in order; the
 * first that answers wins.
 */
export const OrganizationOwnershipAnchorSchema = lazySchema(() => z
  .discriminatedUnion('kind', [
    strictObject(
      { surface: 'a `parent` anchor', history: SUPPLEMENT_HISTORY },
      {
        kind: z.literal('parent'),
        childKey: ColumnNameSchema.describe('Column of this row naming a row of parentObject'),
        parentObject: SnakeCaseIdentifierSchema.describe('Object whose row carries the organization'),
      },
    ),
    strictObject(
      { surface: 'a `subject` anchor', history: SUPPLEMENT_HISTORY },
      {
        kind: z.literal('subject'),
        objectColumn: ColumnNameSchema.describe('Column naming the object of the record the row is about'),
        idColumn: ColumnNameSchema.describe('Column naming that record\'s id'),
      },
    ),
    strictObject(
      { surface: 'a `holder` anchor', history: SUPPLEMENT_HISTORY },
      {
        kind: z.literal('holder'),
        holderObject: SnakeCaseIdentifierSchema.describe('Object whose rows point at this row'),
        holderKey: ColumnNameSchema.describe('Column of holderObject naming this row; every stamped holder must agree'),
      },
    ),
  ])
  .describe('Fate 3 anchor: parent, subject or holder'));
export type OrganizationOwnershipAnchor = z.infer<typeof OrganizationOwnershipAnchorSchema>;

/** A named row population the ceremony counts on the table. */
export const OrganizationOwnershipCategorySchema = lazySchema(() => strictObject(
  { surface: 'a counted category', history: SUPPLEMENT_HISTORY },
  {
    id: z.string().regex(/^[a-z][a-z0-9-]*$/).describe('Category id (kebab-case), as the plan labels the count'),
    label: ProseSchema.describe('What the population is, in the operator\'s terms'),
    citation: ProseSchema.describe('The ruling or record that names the population'),
    where: RowPredicateSchema.optional().describe('Rows of the population; absent = every row'),
    conflictBy: strictObject(
      { surface: 'a category `conflictBy`', history: SUPPLEMENT_HISTORY },
      {
        groupBy: z.array(ColumnNameSchema).min(1).describe('Columns the rows are grouped by'),
        distinct: ColumnNameSchema.optional()
          .describe('Count a group only when it holds more than one distinct value of this column'),
      },
    ).optional().describe('Count groups holding more than one row instead of rows'),
  },
).describe('A named row population the ceremony counts on the table'));
export type OrganizationOwnershipCategory = z.infer<typeof OrganizationOwnershipCategorySchema>;

/** Rows that leave the table by another step before its NOT NULL gate is read. */
export const OrganizationOwnershipDepartureSchema = lazySchema(() => strictObject(
  { surface: 'a departure', history: SUPPLEMENT_HISTORY },
  {
    id: z.string().regex(/^[a-z][a-z0-9-]*$/).describe('Departure id (kebab-case), as the plan labels the count'),
    label: ProseSchema.describe('Which rows leave, and by which step'),
    citation: ProseSchema.describe('The ruling or record that names the step'),
    as: z.enum(['mirror-deletion', 'moved']).describe('mirror-deletion for mirrors; moved for rows re-homed elsewhere'),
    where: RowPredicateSchema.describe('The rows that leave'),
  },
).describe('Rows that leave the table before the NOT NULL gate: neither attributed nor reported'));
export type OrganizationOwnershipDeparture = z.infer<typeof OrganizationOwnershipDepartureSchema>;

/** The keys every fate admits. */
const commonShape = () => ({
  object: SnakeCaseIdentifierSchema.describe('The object (= its table) the host provides'),
  citation: ProseSchema.describe('The host\'s source for this fate'),
  categories: z.array(OrganizationOwnershipCategorySchema).optional()
    .describe('Named row populations the plan counts on the table'),
  note: z.string().optional().describe('A note the plan carries beside the table'),
});

const entrySurface = (fate: string) => ({ surface: `a \`${fate}\` supplement row`, history: SUPPLEMENT_HISTORY });

/**
 * One row of the host fate supplement: the fate of one object the host
 * provides, with the fields that fate reads and no others.
 */
export const OrganizationOwnershipSupplementEntrySchema = lazySchema(() => z
  .discriminatedUnion('fate', [
    strictObject(entrySurface('column-drop'), {
      ...commonShape(),
      fate: z.literal('column-drop').describe('Fate 1: the object ends with no organization_id column'),
    }),
    strictObject(entrySurface('mirror-deletion'), {
      ...commonShape(),
      fate: z.literal('mirror-deletion').describe('Fate 2: mirror rows are deleted after the verified rewrite'),
      mirror: RowPredicateSchema.optional().describe('Which rows are mirrors; absent = every row'),
    }),
    strictObject(entrySurface('attribution'), {
      ...commonShape(),
      fate: z.literal('attribution').describe('Fate 3: NULL rows take their organization from an anchor'),
      anchors: z.array(OrganizationOwnershipAnchorSchema)
        .describe('The anchors, in order; empty = the Default Organization under single, otherwise reported'),
      departures: z.array(OrganizationOwnershipDepartureSchema).optional()
        .describe('Rows that leave the table before the NOT NULL gate'),
    }),
    strictObject(entrySurface('report'), {
      ...commonShape(),
      fate: z.literal('report').describe('Fate 4: NULL rows are listed, never guessed, never deleted'),
      departures: z.array(OrganizationOwnershipDepartureSchema).optional()
        .describe('Rows that leave the table before the NOT NULL gate'),
      notNullExempt: ProseSchema.optional()
        .describe('The column is not the tenancy anchor, so it never receives NOT NULL: the reason'),
    }),
  ])
  .describe('The fate of one object the host provides (ADR-0131 D10)'));
export type OrganizationOwnershipSupplementEntry = z.infer<typeof OrganizationOwnershipSupplementEntrySchema>;

/**
 * The host fate supplement file: a JSON array of rows, one per object the
 * host provides. `os migrate organization-ownership --fate-supplement FILE`
 * reads it in both its plan and apply modes.
 */
export const OrganizationOwnershipSupplementSchema = lazySchema(() => z
  .array(OrganizationOwnershipSupplementEntrySchema)
  .describe('The host fate supplement: the ADR-0131 D10 fates of the objects a host provides, one row per object'));
export type OrganizationOwnershipSupplement = z.infer<typeof OrganizationOwnershipSupplementSchema>;
