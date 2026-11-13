// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#32768] The body of `ObjectQL#judgeFieldWriteLock`: is `field` writable on
 * the record `id` names, NOW, as far as its `readonlyWhen` lock goes — asked
 * without writing anything.
 *
 * ## Why it exists
 *
 * A door that hands out a promise to write a field later (the upload link
 * `create_upload_link` mints) needs the update's verdict on that field before
 * the write happens. The update preview (`validate`) names `readonlyWhen` as a
 * limit it does not run (`ValidateDataResponse`), and the field-access read
 * (`getRecordFieldAccess`) leaves conditional read-only out. So the door could
 * only learn the lock by attempting the write. This answers it without one.
 *
 * ## The same evaluation, not a second one
 *
 * The verdict is the update's own conditional strip
 * ({@link stripReadonlyWhenFields}), run over the inputs the by-id update
 * hands it: the stored row as `previous`, read by the update's own prior-row
 * read ({@link ObjectQL.readUpdatePriorRow}); the master-detail header as
 * `parent`, resolved by the update's own resolver and under the same gate
 * ({@link hasParentScopedReadonlyWhenInPayload}); and a payload carrying the
 * field. The field is LOCKED when that strip would take it back out. A
 * predicate that faults refuses here as it refuses the write (the
 * `ValidationError` the strip throws), and an unbound root holds the lock, as
 * on the write. No logger is handed to the strip: nothing is written, so no
 * "ignoring incoming change" line is true.
 *
 * ## What it judges the field with
 *
 * The payload carries the value the field holds NOW (the stored row's), so a
 * predicate reads the record exactly as it stands: `record` is the stored row,
 * `previous` is the stored row. A lock whose predicate reads the INCOMING
 * value of its own field cannot be judged before that value exists; it is
 * judged here against the value already there.
 *
 * ## Named limits
 *
 * - The update's `beforeUpdate` hooks are not run. A hook that rewrites a
 *   field a predicate reads moves the write's verdict and not this one.
 * - Static `readonly` is not judged here: it is a property of the field's
 *   definition, readable off the schema without the record.
 * - Neither are the update's other refusals (permissions, an approval's
 *   record lock, validation rules): they belong to their own doors.
 *
 * ## Reads
 *
 * None for a field that declares no `readonlyWhen`. Otherwise: the READ DOOR
 * first, under the caller's own context — a row the caller cannot read is a
 * row that does not exist, answered `recordNotFoundError` as the by-id update
 * answers it — then the stored row, then the header when a predicate on the
 * field reads `parent`.
 */

import { recordNotFoundError } from '@objectstack/core';
import type { EngineQueryOptions } from '@objectstack/spec/data';
import type { ExecutionContext } from '@objectstack/spec/kernel';
import type { ObjectQL } from './engine.js';
import { readonlyDropReasonPhrase } from './readonly-strict-errors.js';
import { hasParentScopedReadonlyWhenInPayload, stripReadonlyWhenFields } from './validation/rule-validator.js';

/**
 * A lock that keeps a field from taking a caller's write now. `reason` is the
 * `DroppedFieldsEvent['reason']` the update reports the field under
 * (`onFieldsDropped`, `droppedFields`); `phrase` is how the update's strict
 * refusal (`ReadonlyFieldRejectedError`) names that reason.
 */
export interface FieldWriteLock {
  readonly reason: 'readonly_when';
  readonly phrase: string;
}

/** The members of `ObjectQL` the judgement reads. */
export interface FieldWriteLockHost {
  resolveObjectName: ObjectQL['resolveObjectName'];
  readonly _registry: ObjectQL['_registry'];
  findOne: ObjectQL['findOne'];
  readUpdatePriorRow: ObjectQL['readUpdatePriorRow'];
  resolveMasterDetailParent: ObjectQL['resolveMasterDetailParent'];
}

/** The body of `ObjectQL#judgeFieldWriteLock`; the method's docblock there is its contract. */
export async function judgeFieldWriteLock(
  this: FieldWriteLockHost,
  objectName: string,
  id: unknown,
  field: string,
  options?: { context?: ExecutionContext },
): Promise<FieldWriteLock | null> {
  const object = this.resolveObjectName(objectName);
  const schema = this._registry.getObject(object) as { fields?: Record<string, { readonlyWhen?: unknown }> } | undefined;
  const def = schema?.fields?.[field];
  if (!def || !def.readonlyWhen) return null;

  const context = options?.context;
  const visible = await this.findOne(object, { where: { id }, context } as EngineQueryOptions);
  const prior = visible && typeof visible === 'object' ? await this.readUpdatePriorRow(object, id, context) : null;
  if (!prior) throw recordNotFoundError(object, id as string);

  const payload: Record<string, unknown> = { [field]: Object.prototype.hasOwnProperty.call(prior, field) ? prior[field] : null };
  const parent = hasParentScopedReadonlyWhenInPayload(schema as never, payload)
    ? await this.resolveMasterDetailParent(schema, payload, prior, context)
    : undefined;
  const kept = stripReadonlyWhenFields(schema as never, payload, prior, undefined, parent);
  if (kept && Object.prototype.hasOwnProperty.call(kept, field)) return null;
  return { reason: 'readonly_when', phrase: readonlyDropReasonPhrase('readonly_when') };
}
