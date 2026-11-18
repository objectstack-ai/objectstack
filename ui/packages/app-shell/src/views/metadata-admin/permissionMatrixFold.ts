// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * permissionMatrixFold — how the Studio Objects matrix answers a narrow content
 * column (objectstack#35061, item 2).
 *
 * At {@link PERM_MATRIX_FOLD_WIDTH} px of pane and wider, the matrix keeps its
 * full flat form: the eight permission boxes, the two record-scope pickers and
 * the "All · Read only · None · Read & write" strip on every row. Narrower than
 * that, a row keeps the four CRUD boxes flat; the other six (Export, Transfer,
 * View all, Modify all, read scope, write scope) move behind the row's "More
 * permissions" button, which counts the ones that are on and opens a row of its
 * own beneath; and the strip folds into one "Bulk" menu.
 *
 * The rule is the one `studio-design/dataTabsFold.ts` records (decision B of
 * epic objectui#12446): a CSS container query on the matrix's scroll pane
 * (`MATRIX_PANE`, an `@container`), never a JS width read — the pane narrows
 * when the right slot opens or widens, and a container query answers those
 * moves with no observer and no re-render. Both forms are in the DOM and
 * exactly one of them is displayed at any width.
 *
 * The class strings are literals, not built from the number: Tailwind finds a
 * class by scanning source text, so a template literal would generate no CSS.
 * `PermissionMatrixEditor.fold-35061.test.tsx` checks that every string names
 * {@link PERM_MATRIX_FOLD_WIDTH}.
 */

/** The pane width (px) at and above which the matrix is fully flat. */
export const PERM_MATRIX_FOLD_WIDTH = 1000;

/** The four boxes that stay flat in the folded form, in column order. */
export const PERM_MATRIX_FLAT_KEYS = ['allowCreate', 'allowRead', 'allowEdit', 'allowDelete'] as const;

/** On a cell drawn only in the flat form: not displayed below the fold width. */
export const PERM_FLAT_ONLY_CELL = 'hidden @min-[1000px]:table-cell';

/** On a cell or row drawn only in the folded form: not displayed at and above the fold width. */
export const PERM_FOLDED_ONLY = '@min-[1000px]:hidden';

/** On the flat bulk strip: not displayed below the fold width, a flex row at and above it. */
export const PERM_FLAT_ONLY_FLEX = 'hidden @min-[1000px]:flex';

/** On the matrix table: the 1304 px floor of the flat form applies only where the flat form is drawn. */
export const PERM_MATRIX_TABLE_FLOOR = '@min-[1000px]:min-w-[1304px]';

/** On the bulk column's header: the flat strip's width, only where the strip is drawn. */
export const PERM_BULK_COLUMN_WIDTH = '@min-[1000px]:w-56';
