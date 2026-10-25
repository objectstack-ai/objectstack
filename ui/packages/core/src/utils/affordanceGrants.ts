/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The affordance-to-grant map (objectui#12082): ONE table naming, for every
 * console affordance that offers a write, the grant the caller must hold for
 * it — and ONE resolver every such affordance reads.
 *
 * ## The family this closes
 *
 * Each console surface used to decide on its own which grant its affordance
 * reads, and each surface that decided wrongly was found and fixed alone
 * (objectui#4296, #10107, #11000, #12047). objectui#12082 is the member that
 * hurt most: a create form gated its fields on the EDIT grant, so a
 * create-only role could not fill the form it was allowed to submit. The same
 * pass found the record header not reading the update grant at all, and a
 * lookup offering "Create new" with no grant read either (objectui#12081). The
 * cause is one shape — an affordance spelling its own permission logic — so
 * the fix is one table every affordance reads, not another one-off repair.
 *
 * ## What a row says
 *
 * `crud` — the resolved CRUD-affordance bit the affordance also needs: the
 * object's managed-object policy (ADR-0103, the spec's
 * `resolveCrudAffordances`) intersected with the server's effective API
 * operation set (`/me/permissions` `apiOperations`, objectstack#3391), both
 * through {@link resolveEffectiveCrudAffordances}. `null` for an affordance
 * whose write does not go through the object's generic data door (an
 * attachment upload goes through the storage route; the import template has
 * its own endpoint), so that door's operation set says nothing about it.
 *
 * `grant` — the caller's object grant it exercises, asked as `can(object,
 * grant)` (`MePermissionsProvider` maps `create` → `allowCreate`, `update` →
 * `allowEdit`, `delete` → `allowDelete`).
 *
 * `field` — for an affordance that offers FIELDS to write, the field-level
 * question asked of each one: `create` for an insert, `write` for an update.
 * They differ only for a field the permission set does not mention, which the
 * server's field step lets through so that object admission decides: on an
 * insert that is `allowCreate`, on an update `allowEdit`. A field the set marks
 * `editable: false` is refused on both, and the resolver answers that the same
 * way for both questions. So a create form follows what the server enforces on
 * insert, and adds no rule the server does not have.
 *
 * The `write` question is the server's whole update rule for the field, so it
 * also carries the one field whose update needs an OBJECT grant beyond
 * `allowEdit`: the record's owner, the field the spec's `SystemFieldName`
 * constant names `OWNER_ID`. The server refuses an update that writes it without
 * the transfer grant (`allowTransfer`, or `modifyAllRecords`), so the resolver
 * answers `write` for it with that grant too (objectui#12103). Every row that
 * asks `write` therefore offers the owner field only to a caller who may
 * transfer the record — the in-place edit, the list's in-cell edit and an edit
 * form alike, with no row of its own to forget.
 *
 * ## The verdict
 *
 * An affordance shows when the managed-object policy, the effective API
 * operation set AND the caller's grant all allow it ({@link resolveAffordance}).
 * Its `userActions` predicates (the #2614 object form) are surfaced only then:
 * a predicate narrows, and never re-opens what policy, operation set or grant
 * closed.
 *
 * ## Fail-open, as before
 *
 * With no permission provider mounted, `usePermissions()` answers `can` with
 * `true` and `isLoaded` with `false`, so every grant here reads open and the
 * field question is not asked at all — a standalone embed, a designer preview
 * and a public surface behave as they did before permissions existed, and the
 * server still enforces (the `fieldWriteGate.ts` contract in
 * `@object-ui/plugin-form`). The policy half is not a per-principal answer and
 * does not fail open with it, exactly as `resolveEffectiveCrudAffordances`
 * never did.
 *
 * ## Adding an affordance
 *
 * Add its row here and read it through {@link resolveAffordance} (or
 * {@link resolveFieldAffordance} for fields). The enumeration pin in
 * `@object-ui/plugin-form` (`affordanceGrantMap-12082.test.tsx`) runs every row
 * against four grant shapes and holds the row set to its own expectation table,
 * and its census refuses a console source file that reads a CRUD grant without
 * this map.
 *
 * An affordance that reads NO grant is invisible to a census of grant reads —
 * the calendar's quick-create and drag-to-reschedule and the kanban card move
 * were such affordances until they gained their rows. So the same pin also
 * counts the WRITES: every call site that invokes a create, update or delete on
 * a data source has an entry there naming the row it sits behind and the file
 * that reads it, or the reason it has none. A write site added without an entry
 * turns that pin red.
 */

import {
  resolveEffectiveCrudAffordances,
  type CrudAffordances,
  type RowCrudPredicates,
  type SchemaLike,
} from './managedBy.js';

/** The caller's object grant an affordance exercises. */
export type AffordanceGrant = 'create' | 'update' | 'delete';

/**
 * The field-level question a field affordance asks: `create` follows the
 * server's insert rule, `write` its update rule.
 */
export type FieldAffordanceGrant = 'create' | 'write';

/** One row of {@link AFFORDANCE_GRANTS}. */
export interface AffordanceGrantRow {
  /** The resolved CRUD-affordance bit it also needs, or `null` for none. */
  readonly crud: 'create' | 'import' | 'edit' | 'delete' | null;
  /** The caller's object grant it exercises. */
  readonly grant: AffordanceGrant;
  /** For an affordance that offers fields to write: the field-level question. */
  readonly field?: FieldAffordanceGrant;
}

/**
 * Every console affordance that offers a write → the grant it reads. Each
 * row's comment names the affordance and the object the grant is asked of;
 * where no object is named, it is the object the surface shows.
 */
export const AFFORDANCE_GRANTS = {
  /** A create form's fields (every `ObjectForm` layout) and its form-wide lock. */
  createFormFields: { crud: 'create', grant: 'create', field: 'create' },
  /** An edit form's fields (every `ObjectForm` layout) and its form-wide lock. */
  editFormFields: { crud: 'edit', grant: 'update', field: 'write' },
  /**
   * The record page's Edit — the header CTA and the record body's in-place
   * editing (the details body and the highlights strip), each of whose fields
   * asks the update question (objectui#12103) — and the record overlay's
   * inline edit, the same body in the overlay the calendar, kanban and gantt
   * open (`RecordDetailPanel` in `@object-ui/plugin-detail`).
   */
  recordEdit: { crud: 'edit', grant: 'update', field: 'write' },
  /** The record page's Delete. */
  recordDelete: { crud: 'delete', grant: 'delete' },
  /**
   * An object list's New: the console list page's toolbar button and phone
   * "+", and the `object-view` node's toolbar button (`@object-ui/plugin-view`).
   */
  listNew: { crud: 'create', grant: 'create' },
  /**
   * An object list's Import, and the import wizard's writable target fields —
   * and the AI build panel's spreadsheet import (`ExcelImportBar` in
   * `@object-ui/app-shell`), the wizard's second mount, asked of the object it
   * imports into.
   */
  listImport: { crud: 'import', grant: 'create', field: 'create' },
  /** The import wizard's template download — its endpoint answers 403 without the create grant. */
  importTemplate: { crud: null, grant: 'create' },
  /** A list's inline (in-cell) editing, each of whose cells asks the update question (objectui#12103). */
  listInlineEdit: { crud: 'edit', grant: 'update', field: 'write' },
  /** A list's bulk Delete. */
  listBulkDelete: { crud: 'delete', grant: 'delete' },
  /**
   * A grid row's Edit — and the writes that update the same rows in place: a
   * grid's bulk field update (a `bulkActionDefs` `update` operation, with its
   * undo and retry), and a gantt task's in-chart edits (a bar's drag, resize
   * and progress, its title edited in place, and its dependency links).
   */
  rowEdit: { crud: 'edit', grant: 'update' },
  /** A grid row's Delete — and a gantt row's Delete. */
  rowDelete: { crud: 'delete', grant: 'delete' },
  /** A grid's inline add-record row. */
  gridAddRow: { crud: 'create', grant: 'create' },
  /**
   * A related list's "+ New", asked of the CHILD object — and a line-items
   * panel's or a master-detail form's add-a-line (its Add, entry row and
   * Duplicate), which creates a child under the same parent.
   */
  relatedNew: { crud: 'create', grant: 'create' },
  /** A related list row's Edit, asked of the child object. */
  relatedRowEdit: { crud: 'edit', grant: 'update' },
  /**
   * A related list row's Delete, asked of the child object — and a line-items
   * panel's or a master-detail EDIT form's remove-a-line, which deletes that
   * child on Save.
   */
  relatedRowDelete: { crud: 'delete', grant: 'delete' },
  /**
   * Setup's Clone of a declared item (objectui#12982): a declared sharing
   * rule's Clone creates an organization rule, asked of the object the
   * environment authors such items as (`sys_sharing_rule`).
   */
  declarationClone: { crud: 'create', grant: 'create' },
  /** A lookup picker's "Create new", asked of the TARGET object. */
  lookupCreateNew: { crud: 'create', grant: 'create' },
  /** The record Attachments panel's Upload, asked of `sys_attachment` (storage route, not the data door). */
  attachmentUpload: { crud: null, grant: 'create' },
  /** The record Attachments panel's per-row delete, asked of `sys_attachment`. */
  attachmentDelete: { crud: null, grant: 'delete' },
  /**
   * The record feed's comment composer and its reply composer, asked of
   * `sys_comment`: each creates a comment row.
   */
  feedComment: { crud: 'create', grant: 'create' },
  /**
   * The record feed's reaction control, adding the caller's reaction (its Add
   * button, or an emoji the caller has not reacted with), asked of
   * `sys_comment_reaction`: it creates the caller's own reaction row.
   */
  feedReactionAdd: { crud: 'create', grant: 'create' },
  /**
   * The same control taking the caller's reaction back, asked of
   * `sys_comment_reaction`: it deletes the caller's own reaction row.
   */
  feedReactionRemove: { crud: 'delete', grant: 'delete' },
  /**
   * The same control on a deployment with no `sys_comment_reaction` (the
   * reactions column store), asked of `sys_comment`: a click updates the
   * comment's `reactions` column.
   */
  feedReactionColumn: { crud: 'edit', grant: 'update' },
  /**
   * The record feed's Edit on a comment or reply the caller wrote, asked of
   * `sys_comment`: it updates that comment row (objectui#12268). Whose comment
   * it is decides only which rows offer it; the server's own rule decides the
   * write.
   */
  feedCommentEdit: { crud: 'edit', grant: 'update' },
  /** The same rows' Delete, asked of `sys_comment`: it deletes that comment row. */
  feedCommentDelete: { crud: 'delete', grant: 'delete' },
  /** A calendar's quick-create: an empty-day click, or a time-range drag in the week / day grid. */
  calendarQuickCreate: { crud: 'create', grant: 'create' },
  /** A calendar's drag-to-reschedule: moving or resizing an event writes its date fields. */
  calendarReschedule: { crud: 'edit', grant: 'update' },
  /** A kanban's card move: a cross-column drop writes the record's `groupBy` field. */
  kanbanCardMove: { crud: 'edit', grant: 'update' },
} as const satisfies Record<string, AffordanceGrantRow>;

/** A console affordance with a row in {@link AFFORDANCE_GRANTS}. */
export type ConsoleAffordance = keyof typeof AFFORDANCE_GRANTS;

/** The affordances that offer fields to write. */
export type FieldAffordance = {
  [K in ConsoleAffordance]: (typeof AFFORDANCE_GRANTS)[K] extends { field: FieldAffordanceGrant } ? K : never;
}[ConsoleAffordance];

/**
 * The principal surface {@link resolveAffordance} reads — structurally the
 * subset of `usePermissions()` that answers it, declared here so this module
 * stays React-free and binds to no provider.
 */
export interface AffordanceGrantPrincipal {
  /** `usePermissions().can` — `true` for every grant with no provider mounted. */
  can(object: string, grant: AffordanceGrant): boolean;
  /** The server's effective API operation set for an object; `undefined` leaves the policy as it is. */
  getObjectApiOperations?(object: string): readonly string[] | undefined;
}

/** The principal surface {@link resolveFieldAffordance} reads. */
export interface FieldAffordancePrincipal {
  /** `false` with no provider mounted: no field question is asked. */
  isLoaded: boolean;
  checkField(object: string, field: string, action: FieldAffordanceGrant): boolean;
}

/** What an affordance is resolved against. */
export interface AffordanceSource {
  /** The schema of the object the grant is asked of; `null` reads as the default bucket. */
  objectSchema?: SchemaLike | null;
  /** That object's name. Absent: no grant and no operation set can be asked, so both read open. */
  objectName?: string | null;
  /** The caller's permissions; absent reads open, as no provider does. */
  perms?: AffordanceGrantPrincipal | null;
}

/** One affordance's verdict. */
export interface AffordanceVerdict {
  /** Policy ∧ effective API operation set ∧ the caller's grant. */
  readonly allowed: boolean;
  /** The row's `userActions` predicate envelope — only when {@link allowed}. */
  readonly predicates?: RowCrudPredicates;
}

const PREDICATES: Record<NonNullable<AffordanceGrantRow['crud']>, keyof CrudAffordances> = {
  create: 'createPredicates',
  import: 'importPredicates',
  edit: 'editPredicates',
  delete: 'deletePredicates',
};

/**
 * Resolve one affordance: its row's CRUD-affordance bit (managed-object policy
 * ∧ the effective API operation set) AND the caller's grant.
 */
export function resolveAffordance(
  affordance: ConsoleAffordance,
  { objectSchema, objectName, perms }: AffordanceSource = {},
): AffordanceVerdict {
  const row: AffordanceGrantRow = AFFORDANCE_GRANTS[affordance];
  let predicates: RowCrudPredicates | undefined;
  if (row.crud !== null) {
    const ops = objectName ? perms?.getObjectApiOperations?.(objectName) : undefined;
    const crud = resolveEffectiveCrudAffordances(objectSchema, ops);
    if (!crud[row.crud]) return { allowed: false };
    predicates = crud[PREDICATES[row.crud]] as RowCrudPredicates | undefined;
  }
  if (objectName && perms && !perms.can(objectName, row.grant)) return { allowed: false };
  return predicates ? { allowed: true, predicates } : { allowed: true };
}

/**
 * The field-level half of a field affordance: may the caller write `field`
 * through it? Asks the resolver the row's question (`create` or `write`); with
 * no provider mounted (`isLoaded` false) it asks nothing and answers `true`.
 */
export function resolveFieldAffordance(
  affordance: FieldAffordance,
  perms: FieldAffordancePrincipal | null | undefined,
  objectName: string,
  field: string,
): boolean {
  if (!perms?.isLoaded) return true;
  return perms.checkField(objectName, field, AFFORDANCE_GRANTS[affordance].field);
}

/**
 * The form row for a form's mode: a create form's fields ask the create
 * question, every other form that writes asks the edit question, and a `view`
 * form writes nothing (`undefined`).
 */
export function formFieldsAffordance(
  mode: string | undefined,
): 'createFormFields' | 'editFormFields' | undefined {
  if (mode === 'view') return undefined;
  return mode === 'create' ? 'createFormFields' : 'editFormFields';
}
