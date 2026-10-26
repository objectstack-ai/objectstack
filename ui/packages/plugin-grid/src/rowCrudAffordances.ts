/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Resolve whether a list row's kebab should surface the GENERIC Edit / Delete
 * entries.
 *
 * Two inputs decide this:
 *
 *  1. Whether the consumer wired the affordance at all — i.e. the view's
 *     `operations.update` / `operations.delete` AND an `onEdit` / `onDelete`
 *     callback exists. [objectui#9819] `operations` is the CEILING of this
 *     input, not one half of a union with `rowActions` — see "`operations` is
 *     the ceiling" below.
 *
 *  2. The OBJECT's resolved verdict — the `rowEdit` / `rowDelete` rows of the
 *     affordance-to-grant map (`resolveAffordance` in `@object-ui/core`,
 *     objectui#12082), the SAME resolver the toolbar, the record header, the
 *     form and the related lists read. The caller resolves it and hands it in
 *     as `edit` / `delete`; it folds four layers:
 *
 *       a. the ADR-0103 lifecycle bucket (`managedBy`) — engine-owned
 *          `system` / `append-only` / `better-auth` objects default their
 *          generic edit/delete OFF;
 *       b. the object's `userActions.edit` / `userActions.delete` overrides,
 *          which both opt a bucket-locked object back IN and opt a `platform`
 *          object OUT — the latter typically because it ships dedicated
 *          actions instead (e.g. `sys_environment` replaces generic edit with
 *          a `Rename` action and generic delete with a cascade-teardown
 *          `Delete` action, and the generic entries would otherwise render a
 *          confusing duplicate);
 *       c. [objectstack#3720] the SERVER's effective API operation set for the object
 *          (`/me/permissions` `apiOperations`, objectstack#3391) — `edit` is ANDed with
 *          `update` and `delete` with `delete`, so a row never offers a
 *          mutation the server would reject.
 *
 * and on top of that verdict:
 *
 *       d. [#4096] the CURRENT PRINCIPAL's effective permission on the object
 *          (`/me/permissions` `allowEdit` / `allowDelete`, reached through
 *          `usePermissions().can(obj, 'update' | 'delete')`) — the grant the
 *          map's rows name.
 *
 * Layer (c) and layer (d) answer DIFFERENT questions and neither substitutes
 * for the other. `apiOperations` is the object's API EXPOSURE SURFACE — "which
 * verbs does this object publish at all" — and is principal-independent: two
 * accounts with opposite write grants receive a byte-identical set (measured in
 * #4096: 30/30 shared objects identical between an account with `allowEdit`
 * and one without). Intersecting only with (c) therefore fails OPEN for every
 * unprivileged account. Layer (d) is the per-principal verdict the toolbar's
 * `affordances.create && can(obj, 'create')` and the record header's
 * `objectAffordances.edit && recordWriteAllowed` already AND in; the row kebab
 * and the bulk-delete bar now run the same judgement, so one screen no longer
 * carries three different answers to "may this user write this object".
 *
 * Every layer is an INTERSECTION, never a union: a server grant cannot re-open
 * what the bucket or `userActions` closed, a `userActions` opt-in cannot
 * survive a server denial, and neither can survive a permission denial. An
 * absent effective set (unrestricted object / old backend / no
 * `PermissionProvider`) leaves the bucket verdict untouched, an absent
 * grant answer likewise leaves it untouched — the
 * no-provider host keeps today's behavior, because `usePermissions()` without a
 * `PermissionProvider` answers `can: () => true` by design (standalone embeds
 * have no permission source and must not lose their Edit/Delete) — and an
 * absent `managedBy` resolves to the `platform` bucket, so every main list on
 * an ordinary object keeps its Edit/Delete kebab out of the box.
 *
 * ## [objectui#9819] `operations` is the ceiling
 *
 * Input 1 above used to be a UNION — `(operations.update OR rowActions names
 * 'edit') AND onEdit` — so `operations: { update: false }`, a block whose very
 * name reads as "which operations this grid allows", could not close what
 * `rowActions: ['edit']` opened. An author who turned an operation off got the
 * button anyway: no error, no warning, no degraded state, and nothing to
 * observe but a button they believed was gone. The delete gate carried the same
 * `||`, so `operations: { delete: false }` failed identically.
 *
 * Maintainer ruling of 2026-09-18 (batch #162 item 1, letter A), operative
 * words quoted: "`object-grid`'s `operations` is the CEILING: the edit gate and
 * the delete gate … become intersections — `rowActions` can only select an
 * action `operations` allows; `operations: { update: false }` turns row editing
 * off whatever `rowActions` says".
 *
 * So the row-wiring input is now an intersection like every layer above it:
 *
 *  - A truthy `operationsUpdate` / `operationsDelete` is REQUIRED. Falsy covers
 *    both spellings of "not allowed": an explicit `false`, and a member an
 *    authored block does not name — a present `operations` block REPLACES the
 *    wired-callback default instead of merging under it, so a block naming
 *    neither `update` nor `delete` allows neither. That replacement is decided
 *    at the call site and pinned by `__tests__/gridOperationsMembers-8071.test.tsx`;
 *    this gate only reads the member it is handed.
 *  - `wantEditAction` / `wantDeleteAction` can no longer OPEN anything, and
 *    they NARROW: the ruling leaves `rowActions` the power to choose "among
 *    what `operations` allows", so the gate is the ruled formula
 *    `operationsX AND (wantXAction OR DEFAULT-WHEN-ROWACTIONS-ABSENT) AND
 *    hasOnX AND objectCanX` [objectui#10083]. The default arm is selected by
 *    `rowActionsDeclared`, a signal only the call site can produce: a bare
 *    `wantXAction === false` cannot tell "`rowActions` absent" from
 *    "`rowActions` present without this name", and narrowing on the former
 *    would close the generic Edit/Delete on every grid that declares no
 *    `rowActions` at all — the outcome the same ruling forbids ("`operations`
 *    absent ⇒ today's defaults"). So an absent list keeps the default, and a
 *    DECLARED list — including an empty one, and one naming only custom
 *    actions — offers the generic entry only for the canonical names it
 *    carries.
 *
 * ⚠️ Both halves NARROW published behaviour: a page that wrote
 * `operations.<op>: false` together with a `rowActions` entry for that same op
 * rendered the button before and hides it now (objectui#9819), and a page that
 * declared a `rowActions` list without `'edit'` / `'delete'` rendered the
 * generic entry before and hides it now (objectui#10083). That is the ruled
 * intent. ⛔ No tolerant `??` / alias fallback softens it — a fallback here
 * would rebuild the second de-facto contract this ruling closed.
 *
 * Since objectui#2614, `userActions.edit` / `delete` also accept an object
 * form `{ enabled?, visibleWhen?, disabledWhen? }`: `enabled` carries the
 * boolean opt-out, and the two CEL predicates gate the affordance
 * **per record**. The predicates are returned untouched as
 * `editPredicates` / `deletePredicates` for the row renderer to evaluate
 * (they never affect the object-level `canEdit` / `canDelete` verdict).
 *
 * On top of all of the above sits one more layer, applied PER ROW rather than
 * per object and therefore resolved by {@link resolveRowRecordCrudAffordance}
 * rather than here:
 *
 *       e. [#4296] the RECORD-level verdict — the explain engine's answer for
 *          this one row (`security/explain` with `recordIds`, batched per page
 *          by `./hooks/useRecordCrudVerdicts`).
 *
 * Layers (d) and (e) answer different questions for the same reason (c) and (d)
 * do. `allowEdit` is the principal's verdict on the OBJECT; `writeScope`, the
 * sharing model and RLS narrow it per row, so layer (d) fails OPEN for every
 * record the principal does not own — a user with a legitimately broad object
 * grant saw Edit/Delete on every row they could read, and the server answered
 * 403 on the ones it does not own. The record detail header has ANDed the
 * record-level verdict since objectstack#3821; the row kebab now runs the same
 * judgement against the same engine, so one screen no longer carries two
 * opposite answers to "may this user write THIS record".
 */

import type { AffordanceVerdict, RowCrudPredicates, UserActionOverride } from '@object-ui/core';

// The `userActions.{edit,delete}` override shape (bare boolean or #2614 object
// form) and its per-record predicates are parsed in exactly one place —
// `@object-ui/core`'s `normalizeUserAction`. Re-exported under the historical
// names so existing `./rowCrudAffordances` importers keep resolving.
export type { RowCrudPredicates } from '@object-ui/core';
/** A `userActions.edit` / `delete` flag: bare boolean or the #2614 object form. */
export type RowCrudUserAction = UserActionOverride;

/** No object to judge (no verdict handed in): nothing narrows, no predicates. */
const NO_OBJECT_VERDICT: AffordanceVerdict = Object.freeze({ allowed: true });

export function resolveRowCrudAffordances(opts: {
  operationsUpdate?: boolean;
  operationsDelete?: boolean;
  /**
   * [objectui#9819] Whether `rowActions` names the canonical `'edit'`. A
   * SELECTION inside what `operations` allows, ⛔ never a grant: since
   * `operations` became the ceiling this can no longer open the entry, and
   * [objectui#10083] when {@link rowActionsDeclared} is true a `false` here
   * closes it. See "`operations` is the ceiling" in this module's header.
   */
  wantEditAction?: boolean;
  /** [objectui#9819] The `'delete'` half of {@link wantEditAction}, same rule. */
  wantDeleteAction?: boolean;
  /**
   * [objectui#10083] Whether the view DECLARED a `rowActions` list at all
   * (`Array.isArray(schema.rowActions)`), whatever it names. Selects the
   * ruling's default arm: absent (`false` / omitted) ⇒ `wantEditAction` /
   * `wantDeleteAction` are not consulted and the generic entries keep today's
   * default; declared ⇒ only the canonical names the list carries survive.
   */
  rowActionsDeclared?: boolean;
  hasOnEdit?: boolean;
  hasOnDelete?: boolean;
  /**
   * [objectui#12082] The OBJECT-level verdict for the generic Edit: the
   * `rowEdit` row of the affordance-to-grant map, as `resolveAffordance`
   * returns it — layers (a)–(d) in this module's header, with the object's
   * `userActions.edit` predicates surfaced only when it allows. Absent: no
   * object to have a verdict about, which narrows nothing.
   */
  edit?: AffordanceVerdict;
  /** [objectui#12082] The `rowDelete` half of {@link edit}, same rule. */
  delete?: AffordanceVerdict;
}): {
  canEdit: boolean;
  canDelete: boolean;
  /**
   * The OBJECT-level delete verdict, independent of the row `onDelete`
   * wiring. BULK delete rides a different callback (`onBulkDelete`), so it
   * gates on this rather than on `canDelete` — otherwise a consumer that
   * wires only the bulk handler would be judged by whether the *row* handler
   * happens to be present.
   */
  objectCanDelete: boolean;
  editPredicates?: RowCrudPredicates;
  deletePredicates?: RowCrudPredicates;
  /**
   * [objectui#4420] The per-record delete predicates tied to
   * {@link objectCanDelete} rather than to `canDelete` — the BULK bar's half.
   *
   * `deletePredicates` above rides `canDelete`, which folds in the ROW wiring
   * (`operations.delete` ∧ the `rowActions` selection ∧ `onDelete`). That is right for the row
   * kebab and wrong for the selection bar for the same reason `objectCanDelete`
   * exists: bulk delete rides `onBulkDelete`, so a consumer that wires only the
   * bulk handler would otherwise have its author-declared `visibleWhen`
   * silently dropped — judged by whether the *row* handler happens to be
   * present. Same predicates, gated on the same verdict the bulk bar itself is
   * gated on.
   */
  objectDeletePredicates?: RowCrudPredicates;
} {
  // The object-level verdict is the map's (objectui#12082): bucket default,
  // `userActions` override, the server's effective operation set and — [#4096]
  // — the principal's own grant, which the operation set cannot stand in for
  // (it is the object's exposure surface and says nothing about WHO is
  // asking). The row gate is that verdict AND the consumer having actually
  // wired the affordance.
  const editVerdict = opts.edit ?? NO_OBJECT_VERDICT;
  const deleteVerdict = opts.delete ?? NO_OBJECT_VERDICT;
  const objectCanEdit = editVerdict.allowed;
  const objectCanDelete = deleteVerdict.allowed;
  // [objectui#9819] `operations` is the CEILING — an INTERSECTION, like every
  // layer above. `rowActions` (`wantEditAction` / `wantDeleteAction`) can no
  // longer re-open what the block withheld, and a member the authored block
  // does not name is withheld too. [objectui#10083] Inside that ceiling a
  // DECLARED `rowActions` list narrows to the canonical names it carries; an
  // absent one takes the default arm. The ruling is in this module's header
  // under "`operations` is the ceiling".
  const selectsEdit = opts.rowActionsDeclared ? !!opts.wantEditAction : true;
  const selectsDelete = opts.rowActionsDeclared ? !!opts.wantDeleteAction : true;
  const canEdit = !!(opts.operationsUpdate && selectsEdit && opts.hasOnEdit) && objectCanEdit;
  const canDelete = !!(opts.operationsDelete && selectsDelete && opts.hasOnDelete) && objectCanDelete;
  return {
    canEdit,
    canDelete,
    objectCanDelete,
    editPredicates: canEdit ? editVerdict.predicates : undefined,
    deletePredicates: canDelete ? deleteVerdict.predicates : undefined,
    objectDeletePredicates: objectCanDelete ? deleteVerdict.predicates : undefined,
  };
}

/**
 * [#4296] Layer (e): narrow ONE row's Edit/Delete affordance by the
 * RECORD-level verdict, on top of the object-level answer this module's
 * {@link resolveRowCrudAffordances} resolved.
 *
 * An INTERSECTION like every layer above it: a record-level grant cannot
 * re-open what the bucket, `userActions`, the effective operation set or the
 * principal's object permission closed. It only ever removes.
 *
 * `recordVerdict === undefined` means the record-grained answer is UNKNOWN —
 * the batch verdict has not arrived yet, the endpoint failed or is absent, the
 * row carries no id, or the response did not answer this row. Unknown leaves
 * the object verdict untouched, i.e. renders exactly what this list rendered
 * before layer (e) existed. That direction is deliberate and pinned: the server
 * is the authority and already fail-closes with a 403, so an over-hidden row
 * would cost a permitted user a capability they have, which is strictly worse
 * than the wasted click this layer removes. It is the same `!== false` posture
 * layer (d) takes for an absent `permissionUpdate` / `permissionDelete`, and
 * the same fail-open posture `useRecordEditable` takes on the detail header.
 *
 * @param objectVerdict `canEdit` / `canDelete` for the object, from
 *   {@link resolveRowCrudAffordances}.
 * @param recordVerdict this row's `decision.records[i].visible`, or `undefined`
 *   when no record-grained answer is available for it.
 */
export function resolveRowRecordCrudAffordance(
  objectVerdict: boolean | undefined,
  recordVerdict: boolean | undefined,
): boolean {
  return !!objectVerdict && recordVerdict !== false;
}
