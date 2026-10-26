// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Package-scoped slice merge for the permission matrix (ADR-0086 P0).
 *
 * A Permission Set / Profile is a single metadata record whose `objects` and
 * `fields` maps accumulate authorization rows contributed by many packages.
 * When the Access matrix is opened inside a package context it must:
 *
 *   1. show only the objects that package declares (scope), and
 *   2. on Save write back ONLY that slice — leaving every row contributed by
 *      other packages byte-for-byte intact.
 *
 * Overwriting the whole record (the pre-P0 behavior) silently drops the rows
 * other packages contributed. {@link mergePermissionSlice} rebuilds the record
 * from a freshly-read base, keeping every out-of-scope row, and overlaying the
 * in-scope rows plus every facet the editor can author
 * ({@link EDITOR_AUTHORED_KEYS}).
 */

export interface ObjectPerm {
  allowCreate?: boolean;
  allowRead?: boolean;
  allowEdit?: boolean;
  allowDelete?: boolean;
  allowTransfer?: boolean;
  // `allowRestore` / `allowPurge` were REMOVED here (objectui#6595). Both gated
  // `restore` / `purge` ObjectQL operations that have never existed — a
  // dispatched restore/purge is denied unconditionally by the evaluator's
  // fail-closed destructive-operation backstop — so the matrix authored two
  // checkboxes no runtime has ever read. `@objectstack/spec` retired both keys
  // as `retiredKey()` tombstones (objectstack#12497; maintainer ruling
  // 2026-08-26 accepting objectstack#1883 recommendation B, ADR-0049
  // enforce-or-remove).
  //
  // THE RETURN PATH: both keys come back with the M2 lifecycle initiative,
  // whose restart is recorded upstream on objectstack#1883. Restoring them
  // means restoring three things together — these fields, the columns in
  // `PermissionMatrixEditor`, the rows in `previews/PermissionPreview` — and
  // only alongside the operations that make them enforceable.
  //
  // A value written by an older editor is not modelled here and not authorable.
  // It is carried through save untouched, as any key this editor does not model
  // is (`PermissionSetDraft`'s index signature below states that rule for the
  // record; `updateObjectPerm`'s spread applies it per row). Stripping it is
  // NOT this change: the installed spec still accepts both keys, so a strip
  // today would delete stored data the schema still honours. That belongs with
  // the `@objectstack/spec` bump that lands the retirement.
  viewAllRecords?: boolean;
  modifyAllRecords?: boolean;
}

export interface FieldPerm {
  readable?: boolean;
  editable?: boolean;
}

export interface PermissionSetDraft {
  name: string;
  label?: string;
  isDefault?: boolean;   // install-time suggestion (ADR-0090 D5); packageId is provenance
  objects: Record<string, ObjectPerm>;
  fields?: Record<string, FieldPerm>;
  systemPermissions?: string[];
  tabPermissions?: Record<string, 'visible' | 'hidden' | 'default_on' | 'default_off'>;
  rowLevelSecurity?: unknown[];
  adminScope?: Record<string, unknown>;
  // Any extra keys are carried through untouched on save.
  [extra: string]: unknown;
}

/**
 * The facets the Access matrix editor can AUTHOR — the keys {@link
 * mergePermissionSlice} must take from the edited draft rather than from the
 * freshly-read base (objectui#4302).
 *
 * This list is the whole contract of the package door's save: a facet the
 * editor can author and this list does not name is silently reverted on Save,
 * with a 200 and no error anywhere — which is how a row-level-security policy
 * authored in Studio was discarded while the surface showed it as configured.
 * `permission-slice.authoredKeys.test.ts` scans the editor sources for the keys
 * their `setDraft(...)` updaters write and fails if any is missing here, so the
 * next facet added to the editor cannot repeat that silently.
 *
 * `objects` / `fields` are authored too, but only within the package's scope —
 * {@link mergePermissionSlice} carries them through its row-level merge instead
 * of wholesale, so other packages' contributions survive (ADR-0086 P0).
 */
export const EDITOR_AUTHORED_KEYS = [
  'name',
  'label',
  'isDefault',
  'objects',
  'fields',
  'systemPermissions',
  'rowLevelSecurity',
  'tabPermissions',
  'adminScope',
] as const;

/**
 * Object name embedded in a `${object}.${field}` field-permission key. Object
 * and field names are field-name-safe (snake_case, no dots), so the object is
 * everything up to the first dot.
 */
export function fieldKeyObject(key: string): string {
  const dot = key.indexOf('.');
  return dot === -1 ? key : key.slice(0, dot);
}

function asScopeSet(scope: Iterable<string>): Set<string> {
  return scope instanceof Set ? scope : new Set(scope);
}

/**
 * Narrow a permission set down to just the rows whose object is in `scope`.
 * Used to drive the matrix display so a package panel lists only its own
 * objects (and their field overrides), never the whole environment.
 */
export function scopePermissionSet(
  set: Pick<PermissionSetDraft, 'objects' | 'fields'>,
  scope: Iterable<string>,
): { objects: Record<string, ObjectPerm>; fields: Record<string, FieldPerm> } {
  const scopeSet = asScopeSet(scope);
  const objects: Record<string, ObjectPerm> = {};
  for (const [k, v] of Object.entries(set.objects ?? {})) {
    if (scopeSet.has(k)) objects[k] = v;
  }
  const fields: Record<string, FieldPerm> = {};
  for (const [k, v] of Object.entries(set.fields ?? {})) {
    if (scopeSet.has(fieldKeyObject(k))) fields[k] = v;
  }
  return { objects, fields };
}

/**
 * Merge the edited in-scope slice back onto a freshly-read full `base`.
 *
 * Out-of-scope rows (other packages' contributions) are copied verbatim from
 * `base`; in-scope rows are taken entirely from `edited` (so removing a grant
 * in the package panel deletes only that package's row).
 *
 * Everything else follows one rule (objectui#4302): a facet the editor can
 * author ({@link EDITOR_AUTHORED_KEYS}) comes from `edited`; `base` supplies
 * only what the editor cannot author. It used to be the other way round — five
 * named keys from `edited` and every remaining facet from `base` — which meant
 * `rowLevelSecurity`, `tabPermissions` and `adminScope` were reverted to the
 * stored values the moment they were edited under a package, with a 200 and no
 * error. The scoping the package door needs is `objects` / `fields` and nothing
 * else: the load path narrows exactly those two maps and hands every other
 * facet to the editors unscoped, so a facet held back here protected no one and
 * only discarded the author's work.
 *
 * A key ABSENT from `edited` still comes from `base`. Absence means "this
 * caller does not model the facet", not "the author cleared it" — the facet
 * editors always write a value (an emptied policy list is `[]`, present), so
 * clearing still persists as clearing.
 */
export function mergePermissionSlice(
  base: PermissionSetDraft,
  edited: PermissionSetDraft,
  scope: Iterable<string>,
): PermissionSetDraft {
  const scopeSet = asScopeSet(scope);

  const objects: Record<string, ObjectPerm> = {};
  for (const [k, v] of Object.entries(base.objects ?? {})) {
    if (!scopeSet.has(k)) objects[k] = v; // preserve other packages' rows
  }
  for (const [k, v] of Object.entries(edited.objects ?? {})) {
    if (scopeSet.has(k)) objects[k] = v; // write this package's slice
  }

  const fields: Record<string, FieldPerm> = {};
  for (const [k, v] of Object.entries(base.fields ?? {})) {
    if (!scopeSet.has(fieldKeyObject(k))) fields[k] = v;
  }
  for (const [k, v] of Object.entries(edited.fields ?? {})) {
    if (scopeSet.has(fieldKeyObject(k))) fields[k] = v;
  }

  const merged: PermissionSetDraft = { ...base };
  for (const key of EDITOR_AUTHORED_KEYS) {
    if (key in edited) {
      (merged as Record<string, unknown>)[key] = (edited as Record<string, unknown>)[key];
    }
  }
  // …except `objects` / `fields`, which are authored per-row: the maps built
  // above already carry the in-scope rows from `edited` and every out-of-scope
  // row from `base`, so they override the wholesale copies the loop made.
  merged.objects = objects;
  merged.fields = fields;
  return merged;
}
