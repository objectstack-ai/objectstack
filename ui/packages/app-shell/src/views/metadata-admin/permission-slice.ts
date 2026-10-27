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

import type { HierarchyScope } from '@objectstack/spec/contracts';
import { objectPermissionGrants, type ObjectAccessScope } from '@objectstack/spec/security';

// A type alias, not an interface: a row is handed to the spec's
// `objectPermissionGrants` (objectstack#26597), whose input is an open record,
// and only an alias carries the implicit index signature that accepts.
export type ObjectPerm = {
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
  /**
   * objectstack#26187 — the record-scope (access DEPTH, ADR-0057 D1) columns
   * ADR-0084 declares for the matrix. Authored by the row's two pickers. The
   * BASE schema refuses `readScope` beside either super-user bit and
   * `writeScope` beside `modifyAllRecords` (#16870), so the matrix greys the
   * pickers on those bits and drops the scope when it grants one.
   */
  readScope?: ObjectAccessScope;
  writeScope?: ObjectAccessScope;
};

/** The boolean columns of a row — every {@link ObjectPerm} key but the two scopes. */
export type ObjectPermFlag = Exclude<keyof ObjectPerm, 'readScope' | 'writeScope'>;

/**
 * objectstack#26187 — `ObjectAccessScopeSchema`'s values, narrowest first, in
 * the spec's own order. Restated rather than imported for the reason
 * `useTenancyPosture` gives: the `@objectstack/spec/security` value entry adds
 * its schema modules to the console bundle for a five-value list. The type is
 * the spec's, so a value the spec does not declare does not compile, and
 * `PermissionMatrixEditor.recordScope-26187.test.tsx` compares this list with
 * the schema's `options`, so one the spec adds fails CI here.
 */
export const OBJECT_ACCESS_SCOPES: readonly ObjectAccessScope[] = [
  'own',
  'own_and_reports',
  'unit',
  'unit_and_below',
  'org',
];

/**
 * The three scopes only a hierarchy resolver enforces (`HierarchyScope`):
 * `hierarchy-security`, an enterprise capability. The open runtime resolves
 * them to the owner alone (fails closed), so the pickers keep them selectable
 * and say so.
 */
export const HIERARCHY_SCOPES: ReadonlySet<HierarchyScope> = new Set<HierarchyScope>([
  'own_and_reports',
  'unit',
  'unit_and_below',
]);

export function isHierarchyScope(value: string | undefined): boolean {
  return value !== undefined && (HIERARCHY_SCOPES as ReadonlySet<string>).has(value);
}

export interface FieldPerm {
  readable?: boolean;
  editable?: boolean;
  /**
   * objectstack#25866 — a row condition on the EDIT vote, in the CEL of
   * `rowLevelSecurity[].using`. The entry votes as declared on a row the
   * condition matches and is absent on every other row. The spec refuses it
   * beside `readable: false`, so the matrix clears it when Read is switched
   * off and never authors that shape.
   */
  when?: string;
}

/**
 * objectstack#26597 — what one field row of the matrix draws.
 *
 * A set's `fields` map constrains only the fields it names (ADR-0066 ⑧): the
 * write gate refuses a field only on an entry that is not `editable`, the read
 * mask hides one only on an entry that is not `readable`, and a field the set
 * does not name passes both, so the object grant alone decides
 * (`FieldMasker.detectForbiddenWrites` / `maskResults` in
 * `@objectstack/plugin-security`). A row WITHOUT an entry therefore draws the
 * object row's own Read and Edit, read through the spec's
 * `objectPermissionGrants` (the fold the evaluator answers from, the
 * super-user bits included), and is marked `inherited`. The defaults of
 * `FieldPermissionSchema` (`readable: true`, `editable: false`) are the
 * defaults of an entry that EXISTS; they are never the reading of a missing one.
 *
 * A row WITH an entry draws the entry's bits, read as the runtime's merge reads
 * them (`=== true`, `fieldPermissionVote` in `@objectstack/core`). A bit the
 * entry grants and the object row does not is `capped`: the entry still votes
 * in the most-permissive merge across a holder's sets, but on its own it opens
 * nothing, because the object grant is judged first.
 *
 * The runtime half of this reading is pinned in plugin-security's
 * `field-rule-object-grant.test.ts`; change the two together.
 */
export interface FieldRuleCell {
  /** No entry: the row draws the object grant and writes nothing until changed. */
  inherited: boolean;
  readable: boolean;
  editable: boolean;
  /** The entry grants Read and the object row does not. */
  readCapped: boolean;
  /** The entry grants Edit and the object row does not. */
  editCapped: boolean;
}

export function fieldRuleCell(entry: FieldPerm | undefined, objectPerm: ObjectPerm | undefined): FieldRuleCell {
  const objectRead = objectPermissionGrants(objectPerm, 'allowRead');
  const objectEdit = objectPermissionGrants(objectPerm, 'allowEdit');
  if (!entry) {
    return { inherited: true, readable: objectRead, editable: objectEdit, readCapped: false, editCapped: false };
  }
  const readable = entry.readable === true;
  const editable = entry.editable === true;
  return {
    inherited: false,
    readable,
    editable,
    readCapped: readable && !objectRead,
    editCapped: editable && !objectEdit,
  };
}

/**
 * The entry a click on a field row starts from: the entry itself, or — on a
 * row without one — exactly the bits the row draws, so a click changes only
 * the box it lands on and every other bit is written as the admin saw it.
 */
export function fieldRuleSeed(entry: FieldPerm | undefined, objectPerm: ObjectPerm | undefined): FieldPerm {
  if (entry) return entry;
  const cell = fieldRuleCell(undefined, objectPerm);
  return { readable: cell.readable, editable: cell.editable };
}

/**
 * objectstack#25866 — a bulk shortcut rewrites the two booleans and keeps an
 * authored row condition, so it never silently widens a conditioned entry into
 * an unconditioned one. Clearing a condition is its own act, in the row.
 */
export function withFieldBits(cur: FieldPerm | undefined, readable: boolean, editable: boolean): FieldPerm {
  const next: FieldPerm = { readable, editable };
  if (cur?.when !== undefined) next.when = cur.when;
  return next;
}

/** The field sub-table's bulk shortcuts: read-only, read and edit, or drop the rules. */
export type FieldBulkAction = 'readable' | 'writable' | 'clear';

/**
 * objectstack#26597 — a field bulk shortcut over `fieldNames` (the rows the
 * filter leaves visible). `readable` moves each row to Read on / Edit off and
 * `writable` to Read on / Edit on; a row that already DRAWS the target
 * ({@link fieldRuleCell}) is left exactly as it is, an inherited row included,
 * so the shortcut writes only the rows whose boxes change on screen. `clear`
 * drops the entries, and those rows draw the object grant again. Returns the
 * next `fields` map; `fields` is not mutated.
 */
export function applyFieldBulk(
  fields: Record<string, FieldPerm>,
  objectName: string,
  objectPerm: ObjectPerm | undefined,
  action: FieldBulkAction,
  fieldNames: readonly string[],
): Record<string, FieldPerm> {
  const next = { ...fields };
  const editable = action === 'writable';
  for (const fieldName of fieldNames) {
    const key = `${objectName}.${fieldName}`;
    if (action === 'clear') {
      delete next[key];
      continue;
    }
    const cell = fieldRuleCell(next[key], objectPerm);
    if (cell.readable && cell.editable === editable) continue;
    next[key] = withFieldBits(next[key], true, editable);
  }
  return next;
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
