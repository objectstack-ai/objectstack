// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The child field names that hold a line's sort position — ONE declaration,
 * read by every place the spec states which field an inline grid stamps.
 *
 * The renderer derives the field it stamps with each line's position on
 * drag-reorder from the child object: the first of these names the child
 * declares (objectui `packages/plugin-form/src/deriveMasterDetail.ts`,
 * `SORT_FIELD_NAMES`, the same six names in the same order at the
 * `.objectui-sha` pin `89cad75d5570`). Two readers here:
 *
 * - `inline-grid-columns.ts`, whose derived grid columns and per-row form
 *   fields skip these names, as the renderer's do;
 * - `ui/component.zod.ts`, whose prescriptions for the retired
 *   `object-master-detail-form` detail entry `sortField` name them: the
 *   authored override is gone, so naming the child's field IS the remedy.
 *
 * Why a module of its own: both files must print the SAME list, never two
 * copies of it, and exported from `inline-grid-columns.ts` it would ride the
 * `data` barrel into the published API — a contract for what is the
 * renderer's derivation rule, mirrored here so the spec's text agrees with it.
 * This module is reached by relative import only, like
 * `ui/action-target-aliases.ts`.
 */

/** Field names that hold a line's sort position: the grid stamps them on drag-reorder. */
export const INLINE_GRID_SORT_FIELDS: ReadonlySet<string> = new Set([
  'position', 'sort_order', 'sequence', 'line_no', 'line_number', 'sort',
]);

/**
 * {@link INLINE_GRID_SORT_FIELDS} as a prescription prints it, in order:
 * `` `position` / `sort_order` / … / `sort` ``. A module-level constant of a
 * module that imports nothing, so it is initialised before any importer's body
 * runs — `OS_EAGER_SCHEMAS=1` included.
 */
export const INLINE_GRID_SORT_FIELD_LIST: string = [...INLINE_GRID_SORT_FIELDS]
  .map((name) => `\`${name}\``)
  .join(' / ');
