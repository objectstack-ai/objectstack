// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#29460] `FieldSchema.referenceNameVisible` served (director ruling
 * 6574398310, letter B): a reader who may read the record carrying a `lookup`
 * or `user` field that declares the key, but may not read the record that
 * field points at, is served that record's NAME and ID, and nothing else of it.
 *
 * ## Where it is served, and where not
 *
 * On the `$expand` sub-read only ({@link serveReferenceNames} runs from
 * `ObjectQL#expandRelatedRecords`, after the caller's own expansion), because
 * the expanded form is the only read form a name lives in. ADR-0104 D1: an
 * UNEXPANDED read answers the stored form, and a reference's stored form is
 * the bare id, for every caller, a reader of the target included. The bare id
 * is already the "id" half the ruling serves, and serving a name there would
 * hand the refused reader a richer value than a reader of the target gets on
 * the same read.
 *
 * ## The served value
 *
 * `{ id, name, readRefused: true }` ({@link ReferenceNameOnlyValue}), per
 * element on a `multiple: true` field. `id` is the id the referencing row
 * holds; `name` is the target's display name as ADR-0079 resolves it
 * (`resolveRecordDisplayName`: `nameField ?? displayNameField ?? derivation`,
 * floor `Record #<id>`); `readRefused` says in the value that the reader was
 * refused the target, the `metadataRefused` precedent of a refused file value
 * (`FileRefusedValueSchema`), so a renderer can tell it from a target the
 * reader expanded with a narrow projection and must not link it. Each other
 * value of the field keeps the answer it has without the key: a target the
 * reader can read is expanded as the caller's own read expands it, and an id
 * no record has stays the bare id.
 *
 * ## The two reads, and what each one is handed
 *
 * 1. **Which ids are refused** is asked AS THE CALLER, of exactly the ids the
 *    caller's own expansion left bare: the security service's object-level
 *    admission first (`canReadObject`, as the file path asks before its read),
 *    then an id-only read for the row scope. None of the caller's `$expand`
 *    nesting (projection, filter, order, nested expand) is forwarded, so an id
 *    the caller's own nested filter left bare is still found readable here and
 *    keeps today's answer.
 * 2. **The name** is an engine-owned read of the refused ids only, projected to
 *    `id` and the resolved name field and nothing else, under the tenant-kept
 *    elevation (`{ ...caller, isSystem: true }`, operation-private keys
 *    stripped, so `buildDriverOptions` still scopes it to the caller's tenant).
 *    ⛔ The caller's projection, nesting and filters never reach it, and the
 *    field's own `displayField` does not choose the column it reads.
 *
 * ## What the key does not lift
 *
 * The key lifts the RECORD-level refusal (the object CRUD gate, its
 * `requiredPermissions`, the row scope). It does not lift a field-level rule
 * on the name field itself: when the caller's field answer
 * (`getReadableFields`) does not hold the resolved name field, or the field
 * declares a `maskingRule` (whose mask the security layer computes, not the
 * engine), or it is a formula reading through a reference (that hop would be
 * read under the elevation), or it is not a title-typed column, or no field
 * answer can be had, the name is the ADR-0079 floor `Record #<id>`. A reader
 * who can read the target row but not its name field is served exactly what
 * it is served without the key.
 *
 * This module imports the engine only as a TYPE, so there is no module cycle
 * at run time, and nothing re-exports it.
 *
 * [#30053 codemod] A PRIVATE method's docblock has since moved here,
 * onto its function (`--hand-docs` of `scripts/codemod-split-engine.mjs`),
 * and the class keeps none for it; a public or protected method's docblock
 * stays on the class, the contract, and its function keeps the placeholder.
 */

import { isTitleEligible, resolveDisplayField, resolveRecordDisplayName } from '@objectstack/spec/data';
// The value a `referenceNameVisible` reference is served as when the reader
// was refused its target. Derived from the spec's `ReferenceNameOnlyValueSchema`,
// which owns the shape; the engine never declares its own copy.
import type { ReferenceNameOnlyValue } from '@objectstack/spec/data';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import { withoutOperationPrivateKeys } from '@objectstack/core';
import type { ObjectQL } from './engine.js';
import { isReadRefusal } from './engine-file-reference-hydration.js';
import { formulaPlanEntry } from './engine-top-level.js';

/**
 * The `ObjectQL` members {@link serveReferenceNames} reads, every one of them
 * and no other, each typed AS the class member. See the module header of
 * `engine-file-reference-hydration.ts` for the host shape.
 */
export interface ReferenceNameVisibleHost {
  readonly _registry: ObjectQL['_registry'];
  readonly logger: ObjectQL['logger'];
  find: ObjectQL['find'];
  resolveReadableIdsSecurity: ObjectQL['resolveReadableIdsSecurity'];
  /**
   * Does this formula field read through a reference? Judged by the engine's
   * own formula planner, so the read and this gate see the same hops.
   */
  formulaReadsReference: (fieldName: string, fieldDef: unknown, fields: unknown) => boolean;
}

/** The ids a value of the field holds that are still bare after the caller's expansion. */
function bareIdsOf(value: unknown, into: Set<string>): void {
  if (value == null) return;
  for (const element of Array.isArray(value) ? value : [value]) {
    if (element != null && typeof element !== 'object') into.add(String(element));
  }
}

/**
 * [#29460] Serve `FieldSchema.referenceNameVisible` on an expanded read
 * (director ruling 6574398310, letter B). Runs from
 * {@link expandRelatedRecords} for a field declaring the key, after the
 * caller's own expansion of it, and rewrites only the ids that expansion
 * left bare.
 *
 * For each such id it asks, as the caller and with none of the caller's
 * `$expand` nesting, whether the caller may read it (the security service's
 * object-level admission, then an id-only read for the row scope). A refused
 * id whose record exists in the caller's tenant becomes
 * `{ id, name, readRefused: true }`: `name` is ADR-0079's display name,
 * read by the engine under the tenant-kept elevation from exactly `id` and
 * the resolved name field, with the floor `Record #<id>` when field-level
 * security keeps that field from the caller. A readable target keeps its
 * expansion, an id the caller's own nested filter left bare stays bare, an
 * id no record has stays bare. `multiple: true` is judged per element.
 *
 * ⛔ Never served on an unexpanded read: ADR-0104 D1's stored form is the
 * bare id for every caller. ⛔ The caller's projection, filter, order and
 * nested expand never reach the elevated read, and the field's
 * `displayField` does not choose its column.
 */
export async function serveReferenceNames(
  this: ReferenceNameVisibleHost,
  objectName: string,
  records: any[],
  fieldName: string,
  referenceObject: string,
  execCtx?: ExecutionContext,
): Promise<void> {
  const targetSchema = this._registry.getObject(referenceObject);
  if (!targetSchema) return;

  const bare = new Set<string>();
  for (const record of records) bareIdsOf(record?.[fieldName], bare);
  if (bare.size === 0) return;

  const caller = withoutOperationPrivateKeys((execCtx ?? {}) as Record<string, unknown>) as ExecutionContext;
  const refused = await callerRefusedIds.call(this, referenceObject, [...bare], caller, execCtx);
  if (refused.length === 0) return;

  const nameField = await servableNameField.call(this, referenceObject, targetSchema, caller);
  let rows: any[];
  try {
    rows = (await this.find(referenceObject, {
      where: { id: { $in: refused } },
      fields: nameField ? ['id', nameField] : ['id'],
      context: { ...caller, isSystem: true } as ExecutionContext,
    })) ?? [];
  } catch (error) {
    this.logger.warn(
      'referenceNameVisible: the name read of a refused target failed; the field keeps the bare ids for this read',
      { object: objectName, field: fieldName, reference: referenceObject, refusedIds: refused.length, error: (error as Error)?.message },
    );
    return;
  }

  const asked = new Set(refused);
  const served = new Map<string, ReferenceNameOnlyValue>();
  for (const row of rows) {
    if (row?.id == null) continue;
    const id = String(row.id);
    if (!asked.has(id)) continue;
    // Exactly the two columns this read asked for go to the resolver.
    const shown: Record<string, unknown> = { id };
    if (nameField) shown[nameField] = row[nameField];
    served.set(id, { id, name: resolveRecordDisplayName(targetSchema as never, shown), readRefused: true });
  }
  this.logger.debug('referenceNameVisible: refused targets served by name and id', {
    object: objectName, field: fieldName, reference: referenceObject, refusedIds: refused.length, served: served.size,
  });
  if (served.size === 0) return;

  const valueFor = (element: unknown): unknown => {
    if (element == null || typeof element === 'object') return element;
    const hit = served.get(String(element));
    return hit ? { ...hit } : element;
  };
  for (const record of records) {
    const value = record?.[fieldName];
    if (value == null) continue;
    record[fieldName] = Array.isArray(value) ? value.map(valueFor) : valueFor(value);
  }
}

/**
 * The ids of `ids` the CALLER may not read on `referenceObject`: every one
 * when the object-level admission or the read refuses the caller, otherwise
 * the ones its id-only read does not return. An outage (any failure that is
 * not a refusal) answers none, so the field keeps today's bare ids.
 */
async function callerRefusedIds(
  this: ReferenceNameVisibleHost,
  referenceObject: string,
  ids: string[],
  caller: ExecutionContext,
  execCtx: ExecutionContext | undefined,
): Promise<string[]> {
  const security = this.resolveReadableIdsSecurity();
  if (security.kind === 'usable' && typeof security.svc.canReadObject === 'function') {
    let admitted: unknown = true;
    try {
      admitted = await security.svc.canReadObject(referenceObject, caller);
    } catch {
      admitted = true;
    }
    if (admitted === false) return ids;
  }
  try {
    const rows = (await this.find(referenceObject, {
      where: { id: { $in: ids } },
      fields: ['id'],
      context: { ...(execCtx ?? {}), __expandRead: true } as ExecutionContext,
    })) ?? [];
    const readable = new Set(rows.map((row: any) => row?.id).filter((id: unknown) => id != null).map(String));
    return ids.filter((id) => !readable.has(id));
  } catch (error) {
    if (isReadRefusal(error)) return ids;
    this.logger.warn(
      'referenceNameVisible: the caller\'s read of the target failed; the field keeps the bare ids for this read',
      { reference: referenceObject, ids: ids.length, error: (error as Error)?.message },
    );
    return [];
  }
}

/**
 * The column the name read may take: the target's ADR-0079 display field,
 * when field-level security lets this caller read it and the engine can read
 * it without computing anything the security layer owns. `undefined` serves
 * the floor `Record #<id>`.
 */
async function servableNameField(
  this: ReferenceNameVisibleHost,
  referenceObject: string,
  targetSchema: any,
  caller: ExecutionContext,
): Promise<string | undefined> {
  const field = resolveDisplayField(targetSchema);
  if (!field) return undefined;
  const fields = targetSchema?.fields ?? {};
  const def = fields[field];
  if (!def) return undefined;
  // A title-typed column, or the explicit autonumber primary (ADR-0079 D5).
  if (!isTitleEligible(def) && def.type !== 'autonumber') return undefined;
  if (def.maskingRule != null) return undefined;
  if (def.type === 'formula' && this.formulaReadsReference(field, def, fields)) return undefined;
  const security = this.resolveReadableIdsSecurity();
  if (security.kind !== 'usable') return undefined;
  const svc = security.svc as { getReadableFields?: (object: string, context?: unknown) => Promise<string[] | undefined> };
  if (typeof svc.getReadableFields !== 'function') return undefined;
  try {
    const readable = await svc.getReadableFields(referenceObject, caller);
    return Array.isArray(readable) && readable.includes(field) ? field : undefined;
  } catch {
    return undefined;
  }
}

/**
 * [#30020 codemod] The `formulaReadsReference` slot of the host
 * `ObjectQL#serveReferenceNames` hands {@link serveReferenceNames}: moved here
 * whole by `--hand-slots` of `scripts/codemod-split-engine.mjs`, and the slot
 * names it.
 */
export const formulaReadsReference: ReferenceNameVisibleHost['formulaReadsReference'] = (name, def, fields) => {
  try {
    const entry = formulaPlanEntry(name, def, fields);
    return entry.hops !== undefined || entry.hopConflict !== undefined;
  } catch {
    // An expression the planner cannot compile is not served by name.
    return true;
  }
};
