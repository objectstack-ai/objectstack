/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * 「May this caller write this field through this form?」 — asked once, of the
 * resolver that owns the answer (`80c54122e`), with the question the form's
 * mode asks (objectui#12082).
 *
 * ## The one answer, and where it lives
 *
 * `checkField(object, field, action)` in `@object-ui/permissions` IS that
 * resolver: `MePermissionsProvider` reads the server's `/me/permissions`
 * envelope, looks the caller's field-level grant up by `"<object>.<field>"`,
 * and falls back to the object-level grant for a field the permission set
 * never mentions. WHICH question a form asks is not this module's to decide
 * either: it is the form's row in the affordance-to-grant map
 * (`AFFORDANCE_GRANTS` in `@object-ui/core`, read through
 * `formFieldsAffordance` / `resolveFieldAffordance`). A create form asks
 * `create` — the server's insert rule, whose fallback is `allowCreate` — and
 * every other form that writes asks `write`, whose fallback is `allowEdit`.
 * Asking `write` in create mode was objectui#12082: a create-only role met a
 * create form with every field disabled and a save that posted `{}`.
 * ⛔ Nothing in this module re-derives any rung of it. It only ADAPTS that one
 * verdict into the shapes a form container needs:
 *
 *  - {@link fieldWriteGate} — the predicate `sanitizeFormData` takes, so the
 *    OUTBOUND payload never carries a field the caller may read but not edit;
 *  - {@link applyFieldPermissions} — the field-list pass that decides what
 *    RENDERS, so the form does not offer an affordance whose write the server
 *    will refuse;
 *  - {@link applyColumnPermissions} — the same pass over a line-items grid's
 *    columns, spelled in the one lock the grid reads (objectui#10163).
 *
 * And one form-level step built on the render pass: {@link gateFormFields},
 * which adds the form-wide lock to it — the form's affordance closed by the
 * ADR-0092 D4 managed-object policy, the effective API operation set or the
 * caller's object grant (objectui#12082). It is the ONE step
 * every `ObjectForm` layout draws its resolved fields through (objectui#10612).
 *
 * ## Why both halves live in one module
 *
 * They express ONE invariant — *a form never submits a field it refuses to
 * render editable* — and that is the same invariant `sanitize.ts` states for
 * the server-owned roster. Spelling it separately at each container is how it
 * drifted: `ObjectForm` and `ModalForm` each carried their own copy of the
 * outbound strip and of the render pass, and `DrawerForm` — the third
 * container of the same family, reachable from the same authored
 * `formType: 'drawer'` metadata — carried NEITHER. Measured before this
 * module existed: the same edit, on the same record, with the same permission
 * set, sent `score` (field-level `editable: false`) from the drawer and
 * withheld it from the other two, and the drawer rendered it as an enabled
 * input while the other two rendered it disabled. One family, three answers.
 *
 * ## Fail-open is preserved, deliberately
 *
 * With no `PermissionProvider` / `MePermissionsProvider` mounted (`isLoaded`
 * false) every function here is a no-op and the form behaves exactly as it did
 * before permissions existed. That is the standing contract of this seam — a
 * standalone form, a designer preview and a public/guest surface have no
 * resolvable principal, and the server still enforces. Tightening it here
 * would brick those surfaces without adding any security the server does not
 * already provide.
 *
 * ⚠️ The form-wide lock {@link gateFormFields} adds is only PARTLY a
 * per-principal answer, and only that part fails open: its first input is the
 * object's own `managedBy` bucket and `userActions`, read with no principal at
 * all, exactly as the default arm has always read it. Its second input — the
 * server's effective API operation set — is absent without a provider, and
 * absent leaves the bucket's answer standing; its third — the caller's object
 * grant, `can` — answers `true` without a provider.
 */

import {
  formFieldsAffordance,
  resolveAffordance,
  resolveFieldAffordance,
  type SchemaLike,
} from '@object-ui/core';

/**
 * The permission surface this module consumes — structurally the subset of
 * `usePermissions()` that answers the write question. Declared structurally so
 * `@object-ui/plugin-form` binds to the two members it actually reads rather
 * than to the whole context type.
 */
export interface FieldWritePrincipal {
  isLoaded: boolean;
  checkField(object: string, field: string, action: 'read' | 'write' | 'create'): boolean;
}

/** A field-name predicate: `true` when the caller may write that field. */
export type FieldWriteGate = (fieldName: string) => boolean;

/**
 * Build the outbound write gate for one object, or `undefined` when there is
 * no resolved principal to ask.
 *
 * `undefined` rather than an always-true function on purpose: the callers hand
 * this straight to `sanitizeFormData`, whose option is absent-or-predicate, so
 * an unresolved principal produces the byte-identical payload it produced
 * before this gate existed.
 *
 * `mode` is required, not optional: it picks the question (objectui#12082),
 * and a container that forgot it would silently strip a create-only caller's
 * whole body again. A mode that writes nothing (`view`) gets the edit
 * question, the stricter of the two.
 */
export function fieldWriteGate(
  perms: FieldWritePrincipal | null | undefined,
  objectName: string,
  mode: string | undefined,
): FieldWriteGate | undefined {
  if (!perms?.isLoaded) return undefined;
  const affordance = formFieldsAffordance(mode) ?? 'editFormFields';
  return (fieldName: string) => resolveFieldAffordance(affordance, perms, objectName, fieldName);
}

export interface ApplyFieldPermissionsOptions {
  perms: FieldWritePrincipal | null | undefined;
  objectName: string;
  /**
   * The form's mode, which picks the field question (objectui#12082): `create`
   * asks the insert rule, any other mode but `view` the update rule. A
   * `view`-mode form renders everything read-only already.
   */
  mode?: string;
  /**
   * Optional hint placed on a field the caller may read but not edit, used
   * only when the field declares no description of its own. `ObjectForm`'s
   * simple variant is the one container that shows it.
   */
  deniedDescription?: string;
}

/**
 * The ONE render pass, independent of how a container spells "not editable".
 *
 * It asks the resolver the two questions and decides one of three outcomes per
 * entry — omit, keep, or hand to `markDenied` — so every container that renders
 * through it agrees on WHICH fields are refused. What differs between them is
 * only the vocabulary their widget reads for "this one is locked", which is
 * what `markDenied` supplies (objectui#10163).
 *
 * Entries with no `name` (a section divider, a string field reference the
 * container has not resolved yet) pass through untouched — there is nothing to
 * ask the resolver about.
 */
function gateByPermission<T extends Record<string, any>>(
  fields: T[] | undefined,
  perms: FieldWritePrincipal | null | undefined,
  objectName: string,
  mode: string | undefined,
  markDenied: (entry: T) => T,
): T[] | undefined {
  if (!Array.isArray(fields)) return fields;
  if (!perms?.isLoaded) return fields;
  // The form's row in the affordance-to-grant map: `undefined` for a `view`
  // form, which asks no write question at all.
  const affordance = formFieldsAffordance(mode);
  const out: T[] = [];
  for (const f of fields) {
    if (!f?.name) { out.push(f); continue; }
    if (!perms.checkField(objectName, f.name, 'read')) continue; // omit entirely
    if (affordance && !resolveFieldAffordance(affordance, perms, objectName, f.name)) {
      out.push(markDenied(f));
      continue;
    }
    out.push(f);
  }
  return out;
}

/**
 * The render half for a FORM: drop what the caller may not READ, and mark what
 * they may read but not WRITE as non-editable.
 */
export function applyFieldPermissions<T extends Record<string, any>>(
  fields: T[] | undefined,
  { perms, objectName, mode, deniedDescription }: ApplyFieldPermissionsOptions,
): T[] | undefined {
  return gateByPermission(fields, perms, objectName, mode, (f) =>
    deniedDescription
      ? { ...f, readOnly: true, disabled: true, description: f.description ?? deniedDescription }
      : { ...f, readOnly: true, disabled: true },
  );
}

/**
 * The principal surface {@link gateFormFields} reads: the field-level resolver,
 * the server's effective API operation set for an object (`/me/permissions`
 * `apiOperations`, objectstack#3391; `undefined` means "no effective set",
 * which leaves the object's own affordance standing), and the caller's object
 * grant (`usePermissions().can`, objectui#12082).
 */
export interface FormFieldPrincipal extends FieldWritePrincipal {
  can(object: string, action: 'create' | 'update' | 'delete'): boolean;
  getObjectApiOperations?: (object: string) => readonly string[] | undefined;
}

export interface GateFormFieldsOptions extends ApplyFieldPermissionsOptions {
  perms: FormFieldPrincipal | null | undefined;
  /**
   * The object schema the form resolved (its `managedBy` bucket and
   * `userActions` opt-ins). `null` while it has not loaded, or when the form
   * has no metadata source, reads as the default bucket.
   */
  objectSchema: SchemaLike | null | undefined;
}

/**
 * The form-wide lock: `true` when the form's affordance is CLOSED — the
 * `createFormFields` row for a create form, `editFormFields` for an edit form,
 * resolved through the affordance-to-grant map (`resolveAffordance` in
 * `@object-ui/core`, objectui#12082).
 *
 * That resolver is the SAME one the record header, the list toolbar, the
 * related lists and the grids read, so a form cannot disagree with the button
 * that opened it. Three layers, intersected:
 *
 *  - the managed-object policy (ADR-0092 D4 / ADR-0103): `platform` and
 *    admin-editable `config` resolve open; the engine-owned buckets
 *    (`engine-owned`, `append-only`, `better-auth`) resolve closed unless the
 *    object OPENED per-record writing via `userActions.{edit,create}` (e.g.
 *    sys_user opens `edit` for its profile fields);
 *  - the server's effective API operation set for the object (objectstack#3546),
 *    so the lock engages when the server denies `update` (edit) or `create`
 *    (create);
 *  - the caller's object grant (objectui#12082): `allowEdit` for an edit form,
 *    `allowCreate` for a create form. Before the map, the edit form's half of
 *    this reached the fields only through the field question's `allowEdit`
 *    fallback, and the create form's half not at all.
 *
 * Any other mode never locks here: a `view` form disables every field on its
 * own, and a form with no declared mode was never locked by the default arm.
 * The server-side write guard remains the real boundary; this is UX only.
 */
function managedModeLocked(
  objectSchema: SchemaLike | null | undefined,
  perms: FormFieldPrincipal | null | undefined,
  objectName: string,
  mode: string | undefined,
): boolean {
  if (mode !== 'edit' && mode !== 'create') return false;
  const affordance = formFieldsAffordance(mode);
  if (!affordance) return false;
  return !resolveAffordance(affordance, { objectSchema, objectName, perms }).allowed;
}

/** The form-level affordance {@link closedFormAffordance} can report closed. */
export type ClosedFormAffordance = 'create' | 'edit';

/**
 * Which affordance the form-wide lock found CLOSED for this form, or
 * `undefined` when the lock does not engage (objectui#11000) — closed by the
 * managed-object policy, the effective API operation set or, since
 * objectui#12082, the caller's object grant.
 *
 * It is {@link managedModeLocked}, the very predicate {@link gateFormFields}
 * disables every drawn field on, read for its reason: `create` for a create
 * form, `edit` for an edit form. The locked form's notice
 * (`ClosedAffordanceNotice`) and the wizard's navigation gate read THIS, not a
 * verdict of their own, so a form cannot explain a lock it did not draw, nor
 * draw one it does not explain.
 *
 * A per-field lock never answers here: a field the caller may read but not
 * edit ({@link applyFieldPermissions}) or a field declared `readonly` locks
 * that one field while the form's affordance stays open.
 */
export function closedFormAffordance({
  perms,
  objectName,
  mode,
  objectSchema,
}: Pick<GateFormFieldsOptions, 'perms' | 'objectName' | 'mode' | 'objectSchema'>):
  | ClosedFormAffordance
  | undefined {
  if (!managedModeLocked(objectSchema, perms, objectName, mode)) return undefined;
  return mode === 'edit' ? 'edit' : 'create';
}

/**
 * The ONE field-gate step every `ObjectForm` layout draws its RESOLVED fields
 * through (objectui#10612): the default arm (flat and sectioned), `DrawerForm`
 * and `ModalForm` (sections, derived field groups and flat), and `TabbedForm`,
 * `SplitForm` and `WizardForm` (sections).
 *
 * Two gates, in one pass, so no layout can apply one and skip the other:
 *
 *  1. field-level security — {@link applyFieldPermissions}: drop what the
 *     caller may not READ, lock what they may read but not WRITE;
 *  2. the form-wide lock — every drawn field is `disabled` when
 *     {@link managedModeLocked} says the mode's affordance is closed. Only
 *     `disabled`, not `readOnly`: the default arm's lock always drew a
 *     disabled input, and the submit button is left as it is.
 *
 * Before this step the lock was stamped by the default arm's field generator
 * alone, so the drawer, modal, tabbed, split and wizard layouts drew live
 * inputs on a managed object whose write the server refuses (objectui#10613,
 * folded into objectui#10612). It runs on the resolved list rather than in a
 * generator, so every drawn field is locked — an inline `customFields` member
 * and an already-built section entry as much as a field generated from the
 * object — which is what "blanket" says.
 *
 * Entries with no `name` pass through untouched, as in the render pass.
 */
export function gateFormFields<T extends Record<string, any>>(
  fields: T[] | undefined,
  { objectSchema, ...options }: GateFormFieldsOptions,
): T[] | undefined {
  const permitted = applyFieldPermissions(fields, options);
  if (!Array.isArray(permitted)) return permitted;
  if (!managedModeLocked(objectSchema, options.perms, options.objectName, options.mode)) {
    return permitted;
  }
  return permitted.map((f) => (f?.name ? { ...f, disabled: true } : f));
}

/**
 * The CEL predicate a line-items cell reads as "locked on every row".
 *
 * A grid column has exactly one per-cell lock channel: `readonlyWhen`, which
 * the grid evaluates per row and renders as a disabled control when TRUE. The
 * form half's `disabled` / `readOnly` marks are keys a grid column does not
 * carry, so handing the grid {@link applyFieldPermissions}' output would drop
 * the unreadable columns and lock nothing. A field-level refusal does not
 * depend on the row, so the predicate that expresses it is the constant one.
 */
const LOCKED_ON_EVERY_ROW = 'true';

/**
 * The render half for a line-items GRID: the same pass over its columns — drop
 * what the caller may not READ, and lock the cells of what they may read but
 * not WRITE (objectui#10163).
 *
 * ⛔ Not a second gate: the verdict is {@link gateByPermission}'s, the same one
 * the three form containers render through, so the grid and the form above it
 * cannot disagree about which field is refused. A column that is refused
 * replaces any `readonlyWhen` it declared — a lock on every row already covers
 * every row a narrower lock would. Rows are untouched: whether a line may be
 * added or removed stays the container's own answer.
 *
 * `mode` is the form the grid sits in, and picks the question the cells ask
 * the same way it does for a form's fields (objectui#12082): a CREATE form's
 * lines are all new child records, so their cells ask the create question. A
 * grid anywhere else — an edit form, a record page's line-items block — may
 * hold existing lines beside new ones, and one lock per column cannot split
 * per row, so it asks the edit question, as it always did.
 */
export function applyColumnPermissions<T extends Record<string, any>>(
  columns: T[] | undefined,
  { perms, objectName, mode }: Pick<ApplyFieldPermissionsOptions, 'perms' | 'objectName' | 'mode'>,
): T[] | undefined {
  return gateByPermission(columns, perms, objectName, mode, (c) => ({
    ...c,
    readonlyWhen: LOCKED_ON_EVERY_ROW,
  }));
}
