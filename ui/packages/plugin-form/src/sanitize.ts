/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * The refused-field roster: every field name the SERVER owns on write.
 *
 * ## What it is
 *
 * The framework's `applySystemFields` stamps these columns onto every business
 * object — record identity, audit provenance (`created_*` / `updated_*`), and
 * the reassignable ownership / tenancy FKs (`owner_id`,
 * `owning_business_unit_id`, `organization_id`, `tenant_id`, `company_id`,
 * `space`). They are not author-declared business data, and a form may never
 * echo one back.
 *
 * One of them is also a value a user may set: the record's owner. The spec
 * declares `owner_id` `system` but NOT `readonly`, because ownership is
 * transferable from a form. It stays in this roster — an untouched owner is
 * still never sent, and an auto-laid-out form still never renders it — and an
 * EDIT adds it back only when the user changed it against the record the form
 * read ({@link dirtyEditPayload}, objectui#12205), and a CREATE only when the
 * user picked it against the values the form opened with
 * ({@link createOwnerPayload}, objectui#12359). The rest of the family is
 * not reassignable from a form: the spec declares the business-unit and tenant
 * anchors `readonly`, so they stay refused even when they differ.
 *
 * ## Why one roster, and why it is THIS roster
 *
 * `filterSystemFields` in `autoLayout.ts` reads the same set to decide what an
 * auto-laid-out form RENDERS, in create and edit mode alike. The two readings
 * are deliberately the same object, because the invariant they express is one
 * invariant: **a form never writes a field it refuses to render.** Spelling the
 * refusal separately at each call site is how they drifted — the render side
 * had dropped `owner_id` since it was written, while the write side had not, so
 * an edit form that showed the user two business inputs still sent back every
 * ownership and audit column it had read (objectui#10108).
 *
 * That drift is not a cosmetic one. The platform refuses a write to a
 * system-managed ownership column unless the caller holds the transfer grant
 * (`allowTransfer` / `modifyAllRecords`), and it cannot tell a round-trip of
 * the value it just served from an attempted ownership transfer. So a form
 * echoing an UNCHANGED `owner_id` back is a 403 for every role that does not
 * hold the grant — which, for a line-entry role, is the whole point of the
 * role. The master-detail save sends its operations as one atomic batch, so a
 * single echoed column refuses the entire save.
 *
 * ## What is deliberately NOT here
 *
 * The lifecycle bookkeeping columns (`locked`, `instance_state`, `deleted`,
 * `is_deleted`) are left out. They are plausibly author-writable — a workflow
 * or an admin form that drives record state is writing business meaning, not
 * echoing provenance — and nothing has measured them refusing a write. Adding
 * one here on the strength of the pattern alone would silently drop a value a
 * form was asked to persist, which is the failure direction this module must
 * not take.
 *
 * ⚠️ A name list alone cannot close the class: the NEXT injected column the
 * platform adds will not be in it. {@link sanitizeFormData} therefore branches
 * on the spec `system` flag first whenever a field definition is available —
 * that flag is the registry's own mark on everything it injects, and
 * `isSystemManagedField` in `@object-ui/types` reads the same one. This roster
 * is the fallback for metadata that arrives without the flag.
 */
export const SERVER_OWNED_FIELD_NAMES: ReadonlySet<string> = new Set<string>([
  // Record identity
  'id', '_id', '__v', '_version', '_rev',
  // Audit provenance
  'created', 'created_at', 'createdAt', 'created_by', 'createdBy',
  'modified', 'modified_by',
  'updated_at', 'updatedAt', 'updated_by', 'updatedBy',
  'last_modified_at', 'lastModifiedAt', 'last_modified_by', 'lastModifiedBy',
  'deleted_at', 'deletedAt',
  // Ownership / tenancy — the transfer-grant family (objectui#10108)
  'owner', 'owner_id', 'ownerId',
  'owning_business_unit_id', 'owningBusinessUnitId',
  'organization_id', 'organizationId', 'org_id', 'orgId',
  'tenant_id', 'tenantId', 'company_id', 'companyId', 'space',
]);

/**
 * Field types that are read-only / computed and must not be persisted.
 */
const COMPUTED_FIELD_TYPES = new Set([
  'formula',
  'summary',
  'rollup',
  'lookup_value',
  'auto_number',
  'autonumber',
  'computed',
]);

/**
 * Strip server-owned and computed fields from a form payload before sending
 * it to `dataSource.create()` / `dataSource.update()`.
 *
 * - Drops every name in {@link SERVER_OWNED_FIELD_NAMES}.
 * - When `objectSchema` is provided, drops any field the spec marks
 *   `system: true` — the registry's own mark on the columns it injects, so a
 *   column added to the platform after this module was written is refused
 *   without anyone editing the roster.
 * - When `objectSchema` is provided, drops fields that are flagged as
 *   `computed` / `readOnly` or whose type is in {@link COMPUTED_FIELD_TYPES}.
 *   A `formula` key is NOT a flag this reads (objectui#11070 round 6): every
 *   `type: 'formula'` field is already dropped by its type, and
 *   `@objectstack/spec`'s `FieldSchema` refuses `formula` by name on every
 *   field type (renaming it to `expression`), so no served definition can use
 *   it to mark some other type computed.
 * - When `objectSchema` is provided, also drops keys that don't appear in
 *   `objectSchema.fields` at all (these are typically server-projected
 *   relationships or flattened lookups like `full_name`).
 * - When `options.canEdit` is provided, drops every field that predicate
 *   refuses — the CALLER's field-level security, which no schema can answer.
 *
 * Its output never carries the owner. An edit's changed owner is judged after
 * this, against the record the form read, by {@link dirtyEditPayload}
 * (objectui#12205), and a create's picked owner against the values the form
 * opened with, by {@link createOwnerPayload} (objectui#12359) — the two places
 * that can tell a user's pick from an echo.
 *
 * The two server-owned branches are separate on purpose and neither subsumes
 * the other: the name roster fires with no schema at all (an inline form passes
 * `null`), and the `system` flag fires for a name the roster has never heard
 * of.
 *
 * ## Why field-level security arrives as a PREDICATE, not as more schema
 *
 * The branches above are properties of the OBJECT: the same for every caller,
 * readable off metadata this function is already handed. Field-level security
 * is a property of the CALLER — `score` is writable for one principal and
 * refused for the next, on the identical object — so it cannot be read off
 * `objectSchema` and must not be re-derived here. `fieldWriteGate` in
 * `./fieldWriteGate` adapts the ONE resolver that owns that answer
 * (`checkField` in `@object-ui/permissions`, asked the question the form's
 * mode reads from the affordance-to-grant map — objectui#12082) into this
 * predicate. It arrives here, at the single outbound filter, rather than as a
 * strip loop after each container's call, because every such loop is a copy
 * that can be forgotten — and one of the three containers had forgotten it
 * (`80c54122e`).
 */
export function sanitizeFormData(
  data: Record<string, any>,
  objectSchema?: { fields?: Record<string, any> } | null,
  options?: { canEdit?: (fieldName: string) => boolean },
): Record<string, any> {
  return stripUnwritable(data, objectSchema, options?.canEdit, false);
}

/**
 * The record's owner — the one server-owned column a form writes, and only
 * when the user changed it on an edit (objectui#12205) or picked it on a create
 * (objectui#12359). It is a member of {@link SERVER_OWNED_FIELD_NAMES} and
 * stays one; this name only marks which member {@link dirtyEditPayload} and
 * {@link createOwnerPayload} may add back. ⛔ Not a second strip list.
 */
const REASSIGNABLE_OWNER_FIELD = 'owner_id';

/**
 * The loop behind {@link sanitizeFormData}. `admitOwner` lets the owner past
 * the two server-owned branches and nothing else: field-level security, the
 * unknown-key strip and the computed / read-only branches still judge it, so
 * an object that declares its owner `readonly`, or a caller who may not edit
 * it, still never writes it. Only the owner judgement behind
 * {@link dirtyEditPayload} and {@link createOwnerPayload} passes `true`.
 */
function stripUnwritable(
  data: Parameters<typeof sanitizeFormData>[0],
  objectSchema: Parameters<typeof sanitizeFormData>[1],
  canEdit: ((fieldName: string) => boolean) | undefined,
  admitOwner: boolean,
): ReturnType<typeof sanitizeFormData> {
  if (!data || typeof data !== 'object') return data;

  const out: ReturnType<typeof sanitizeFormData> = {};
  const fields = objectSchema?.fields;

  for (const [key, value] of Object.entries(data)) {
    const owner = admitOwner && key === REASSIGNABLE_OWNER_FIELD;
    if (!owner && SERVER_OWNED_FIELD_NAMES.has(key)) continue;

    // Field-level security. Runs with or without a schema: an inline form
    // passes `null` for `objectSchema` and its caller is gated all the same.
    if (canEdit && !canEdit(key)) continue;

    if (fields) {
      const fieldDef = fields[key];
      // Drop unknown keys (flattened/derived projections like full_name).
      if (!fieldDef) continue;
      // The registry stamps `system: true` on every column it injects. Reading
      // the flag rather than only the roster is what stops the NEXT injected
      // column repeating objectui#10108 — the platform's ownership guard
      // refuses an echoed value the same way whatever it is called.
      if (!owner && fieldDef.system === true) continue;
      const t = String(fieldDef.type || '').toLowerCase();
      if (COMPUTED_FIELD_TYPES.has(t)) continue;
      if (fieldDef.computed === true) continue;
      if (fieldDef.readOnly === true || fieldDef.readonly === true) continue;
    }

    out[key] = value;
  }

  return out;
}

/**
 * Whether two payload values are the SAME stored value — the one comparison
 * every dirty-field diff in this package uses: the master-detail child rows in
 * `masterDetailTx.ts` (objectui#10108) and the edit form's own record
 * (objectui#10156). ⛔ Do not write a second equality rule beside it; two rules
 * would drift, and the one that drifted towards "equal" would drop edits.
 *
 * ⚠️ The comparison is deliberately asymmetric in its failure direction. Saying
 * "changed" about an equal pair costs one redundant column on the wire; saying
 * "unchanged" about a changed pair DISCARDS the user's edit, silently, with a
 * 200 back. So every case this cannot settle confidently reads as changed.
 *
 * The rule, pair by pair:
 *
 * - The same value (`===`) is equal.
 * - `null` and `undefined` are one blank — the only two blanks a form
 *   round-trip actually interchanges. `''` is NOT a blank here: `null` and
 *   `''` read as different, and so do `undefined` and `''`.
 * - Numbers never equal strings: `1000` and `'1000'` read as different.
 * - Two `Date`s are equal only when both hold the same finite time. A `Date`
 *   and a date STRING read as different, and so do two date strings in
 *   different formats (`'2026-01-02'` and `'2026-01-02T00:00:00Z'`).
 * - Two objects or arrays are equal only when they serialize identically. A
 *   reordered key or array element reads as changed, which is the safe side.
 * - A lookup's id and its expanded object (`'a1'` and `{ id: 'a1', … }`) read
 *   as different: one is a string and the other an object.
 * - Anything else is different, including `NaN` against itself.
 */
export function isSameStoredValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null && b == null) return true; // null/undefined are one blank
  if (a == null || b == null) return false;
  if (a instanceof Date || b instanceof Date) {
    const ta = a instanceof Date ? a.getTime() : NaN;
    const tb = b instanceof Date ? b.getTime() : NaN;
    return Number.isFinite(ta) && ta === tb;
  }
  if (typeof a === 'object' && typeof b === 'object') {
    try { return JSON.stringify(a) === JSON.stringify(b); } catch { return false; }
  }
  return false;
}

/**
 * The subset of `next` that differs from the loaded snapshot `prev` — the
 * DIRTY fields, and only those, judged by {@link isSameStoredValue}.
 *
 * An update that carries an unchanged column is not free: the platform refuses
 * a write to a system-managed ownership column unless the caller holds the
 * transfer grant, and it cannot tell a round-trip of the value it just served
 * from an attempted transfer. A master-detail save commits as ONE atomic batch,
 * so one such column on any row refuses every row (objectui#10108).
 * `sanitizeFormData` already refuses the columns the server owns by name;
 * sending only what the user actually changed is the half that does not depend
 * on a roster being complete.
 */
export function changedFields(
  next: Record<string, any>,
  prev: Record<string, any>,
): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(next)) {
    if (!isSameStoredValue(v, prev[k])) out[k] = v;
  }
  return out;
}

/**
 * The record an edit form READ from its data source, tagged with the object
 * and record it was read for (objectui#10156).
 *
 * It is the baseline an edit save diffs against, and it is held by the form
 * component that performed the read — never passed in by a host. A record a
 * caller supplied (`initialData`, inline `customFields`) is a prefill, not the
 * row as stored, so no snapshot is taken for it and its save sends every field.
 */
export interface LoadedRecordSnapshot {
  objectName: string;
  recordId: string;
  record: Record<string, unknown>;
}

/** The three facts of a form schema that decide whether a snapshot applies. */
export interface EditSaveTarget {
  mode?: string;
  objectName: string;
  recordId?: string | number | null;
}

/**
 * Take the snapshot for a record just read with `findOne`, or `null` when the
 * read returned nothing usable.
 */
export function snapshotLoadedRecord(
  target: EditSaveTarget,
  data: unknown,
): LoadedRecordSnapshot | null {
  if (target.recordId == null || target.recordId === '') return null;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  return {
    objectName: target.objectName,
    recordId: String(target.recordId),
    record: { ...(data as Record<string, unknown>) },
  };
}

/** The snapshot's record when it was read for THIS edit, else `null`. */
function loadedRecordFor(
  snapshot: LoadedRecordSnapshot | null | undefined,
  target: EditSaveTarget,
): Record<string, unknown> | null {
  if (!snapshot || target.mode !== 'edit') return null;
  if (target.recordId == null || target.recordId === '') return null;
  if (snapshot.objectName !== target.objectName) return null;
  if (snapshot.recordId !== String(target.recordId)) return null;
  return snapshot.record;
}

/**
 * The payload an EDIT save writes: only the fields that differ from the record
 * the form loaded (objectui#10156).
 *
 * `payload` is the output of {@link sanitizeFormData}. Every case that cannot
 * be settled resolves towards SENDING, because a false "clean" drops the user's
 * edit and the server still answers 200:
 *
 * - Not an edit, or no snapshot was read for this object and record (a create,
 *   a caller-supplied record, a record swap still in flight) → `payload`
 *   unchanged, every field sent.
 * - A snapshot applies → the fields {@link changedFields} reports. Fields the
 *   form itself moved after the load — a cascade clear, a clear-on-hide, a
 *   value the form computed — differ from the loaded record, so they are sent.
 * - The diff is EMPTY → `payload` unchanged. A save with nothing changed stays
 *   the request it has always been: the same write, the same OCC guard and a
 *   real server record for `onSuccess`. Emitting no request instead would
 *   report success for a save no server saw, and that is the one outcome a
 *   wrong baseline must never be able to produce.
 *
 * ## The owner (objectui#12205)
 *
 * `payload` never carries the owner: `sanitizeFormData` drops it, because the
 * platform refuses an echoed owner from every role without the transfer grant
 * and cannot tell an echo from a transfer (objectui#10108). That drop also
 * swallowed a REAL reassignment or clear — the form closed as if it saved and
 * the record kept its owner. This is the one place that can tell the two
 * apart, so `owner` hands it the values the form holds and the strip's own
 * inputs, and the owner is added to the diff when, and only when:
 *
 * - a snapshot applies — with none, nothing proves the owner changed, so it
 *   stays off the wire exactly as before;
 * - the form holds a value for it (`undefined` is not a clear; a clear is
 *   `null`) and {@link changedFields} reports it against the record read;
 * - everything else `sanitizeFormData` asks still allows it: the caller's
 *   field-level security, the object declaring it, and it not being
 *   `readonly` or computed.
 *
 * The server stays the authority: a role without the transfer grant is refused
 * with a 403, which the form shows as its error. A caller that passes no
 * `owner` gets the diff it always got.
 */
export function dirtyEditPayload(
  payload: Record<string, unknown>,
  snapshot: LoadedRecordSnapshot | null | undefined,
  target: EditSaveTarget,
  owner?: EditOwnerSource | null,
): Record<string, unknown> {
  if (!payload || typeof payload !== 'object') return payload;
  const loaded = loadedRecordFor(snapshot, target);
  if (!loaded) return payload;
  const changed = { ...changedFields(payload, loaded), ...changedOwner(owner, loaded) };
  return Object.keys(changed).length > 0 ? changed : payload;
}

/**
 * The payload a CREATE save writes: `payload`, plus the owner when the user
 * picked one on this New form (objectui#12359).
 *
 * `payload` is the output of {@link sanitizeFormData}, which never carries the
 * owner. Before this, a New form that rendered Owner let the user pick a user,
 * showed the pick, and then saved the record under the creator with no error.
 *
 * "Picked" means the same thing it means on an edit, judged against the values
 * the form OPENED with instead of a record it read: `seed` is the create
 * form's opening values (`seedCreateValues` — the declared defaults, a
 * `current_user` default resolved to the acting user, and any caller-supplied
 * initial values). So the owner is added when, and only when:
 *
 * - the caller hands a `seed` — with none, nothing proves the user set the
 *   owner, so it stays off the wire exactly as before;
 * - the form holds a value for it (`undefined` is not a pick) and
 *   {@link changedFields} reports it against `seed`. An owner the form was
 *   seeded with and the user left alone — the creator from a `current_user`
 *   default, or a caller's prefill — is NOT a pick, and is never sent
 *   (objectui#10108);
 * - everything else {@link sanitizeFormData} asks still allows it: the
 *   caller's field-level security, the object declaring it, and it not being
 *   `readonly` or computed.
 *
 * The client does not guess whether the caller may assign another owner. The
 * server judges it: an insert naming another user is refused without the
 * transfer grant (`allowTransfer` / `modifyAllRecords`), and the form shows
 * that refusal as its error. A caller that passes no `owner` gets `payload`.
 */
export function createOwnerPayload(
  payload: Record<string, unknown>,
  seed: Record<string, unknown> | null | undefined,
  owner?: EditOwnerSource | null,
): Record<string, unknown> {
  if (!payload || typeof payload !== 'object') return payload;
  if (!seed || typeof seed !== 'object') return payload;
  const picked = changedOwner(owner, seed);
  return Object.keys(picked).length > 0 ? { ...payload, ...picked } : payload;
}

/**
 * What a save hands {@link dirtyEditPayload} (an edit) or
 * {@link createOwnerPayload} (a create) so it can judge the owner.
 */
export interface EditOwnerSource {
  /** The values the form holds — BEFORE `sanitizeFormData`, which drops the owner. */
  values: Record<string, unknown>;
  /** The definition `payload` was sanitized against (`null` for inline members). */
  objectSchema?: { fields?: Record<string, unknown> } | null;
  /** The field-level verdict `payload` was sanitized with. */
  canEdit?: (fieldName: string) => boolean;
}

/**
 * `{ owner_id }` when the user changed the owner against `baseline` — the
 * record an edit read, or the values a create opened with — else `{}`.
 */
function changedOwner(
  owner: EditOwnerSource | null | undefined,
  baseline: Record<string, unknown>,
): Record<string, unknown> {
  const values = owner?.values;
  if (!values || typeof values !== 'object') return {};
  const value = values[REASSIGNABLE_OWNER_FIELD];
  if (value === undefined) return {};
  const writable = stripUnwritable({ [REASSIGNABLE_OWNER_FIELD]: value }, owner.objectSchema, owner.canEdit, true);
  return changedFields(writable, baseline);
}

/**
 * The snapshot after an edit save SUCCEEDED: the fields just written, laid over
 * the record as read.
 *
 * A form that stays mounted after a save must not diff its next save against
 * the row as FIRST read. Changing a field and then changing it back to the
 * value first read would compare equal to that stale baseline and be dropped,
 * while the server still holds the first save's value. Advancing the baseline
 * by what the server accepted closes that. A snapshot read for another record
 * is returned untouched.
 */
export function advanceLoadedRecord(
  snapshot: LoadedRecordSnapshot | null | undefined,
  target: EditSaveTarget,
  written: Record<string, unknown>,
): LoadedRecordSnapshot | null {
  const loaded = loadedRecordFor(snapshot, target);
  if (!snapshot || !loaded) return snapshot ?? null;
  if (!written || typeof written !== 'object') return snapshot;
  return { ...snapshot, record: { ...loaded, ...written } };
}
