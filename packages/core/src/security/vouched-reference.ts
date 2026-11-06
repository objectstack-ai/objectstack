// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The mark a service's own write carries for ONE reference value it vouches
 * for: a record the same call has itself authorized and created.
 *
 * ## The rule it answers to
 *
 * A write that is not a system write may name, in a `lookup`, `user` or
 * `master_detail` field, only a record its caller's own read door returns; a
 * record the caller cannot read answers `reference_not_found`
 * (`assertReferencesResolve`, objectql). That rule judges a reference the
 * CALLER chose. Some service verbs write, as the caller, a row that links to a
 * record the verb created a moment earlier in the same call, after asking its
 * own authorization question first. The file-attachments verb is the case: it
 * asks the attach rule (`assertMayAttach`), stores a new `sys_file` for the
 * caller, then inserts the `sys_attachment` naming it AS the caller, so every
 * gate on that insert judges the caller. The caller did not choose that file
 * id, and a caller who may attach files need not read `sys_file` at all, so
 * the read-door question has nothing to judge there; asking it refuses the
 * verb outright.
 *
 * ## What it admits, and what it does not
 *
 * The mark names one `(object, field, id)`. The reference check reads it for
 * exactly that value on a write to that object: the caller's read door is not
 * asked for it, and the elevated, tenant-kept existence probe still is, so an
 * id that names no row of the caller's organization is refused as before.
 * Everything else about the write stays the caller's: every other field and
 * every other value in the same field is judged through the caller's read door,
 * and nothing about RLS, FLS, the owner and audit stamps, the object's hooks
 * or the caller's read of anything changes. It grants no read.
 *
 * ## Where it is set — and where it is never set
 *
 * Only by a service verb, on the one write it makes for the record it just
 * created, after that verb's own authorization: today the file-attachments
 * writer's `sys_attachment` insert (`FileAttachmentService.attachFileAs`,
 * service-storage). ⛔ Never on a context a request, an import, a flow, an
 * agent tool or any other generic data door hands the engine: a reference such
 * a door carries is the caller's choice, and the read-door rule judges it.
 *
 * ## Why a symbol, and why it is not an `ExecutionContext` field
 *
 * The same reasons as `FLOW_WRITE_REFERENCE_CHECK`: no request body, query
 * string, stored row or flow definition can spell a symbol, so no author can
 * set it; it is in no schema; `Symbol.for` keeps it one key across the ESM and
 * CJS builds; and, being undeclared, it does not survive
 * `ExecutionContextSchema.parse`. It rides a spread of the context as any own
 * property does, so a write a hook sets off under the vouched write carries it
 * too, and is admitted only for the same object, field and id.
 */

/** The context key of the mark. See the module header. */
export const VOUCHED_REFERENCES: unique symbol = Symbol.for('objectstack.core.vouchedReferences');

/** One reference value a service vouches for: `field` of a write to `object`, naming `id`. */
export interface VouchedReference {
  readonly object: string;
  readonly field: string;
  readonly id: string;
}

/**
 * `context` with `reference` added to the references it vouches for — a fresh
 * object; `context` is not changed. Called only by a service verb, for a
 * record the same call created (see the module header).
 */
export function vouchForReference<T extends object>(
  context: T,
  reference: VouchedReference,
): T & { [VOUCHED_REFERENCES]: ReadonlyArray<VouchedReference> } {
  const held = (context as { [VOUCHED_REFERENCES]?: unknown })[VOUCHED_REFERENCES];
  const prior = Array.isArray(held) ? (held as ReadonlyArray<VouchedReference>) : [];
  const entry: VouchedReference = Object.freeze({
    object: String(reference.object),
    field: String(reference.field),
    id: String(reference.id),
  });
  return { ...context, [VOUCHED_REFERENCES]: Object.freeze([...prior, entry]) };
}

/**
 * Does `context` vouch for `id` in `field` of a write to `object`? `false` for
 * every other value, field, object and context.
 */
export function isVouchedReference(context: unknown, object: unknown, field: unknown, id: unknown): boolean {
  if (context === null || typeof context !== 'object') return false;
  if (typeof object !== 'string' || typeof field !== 'string') return false;
  if (typeof id !== 'string' && typeof id !== 'number') return false;
  const held = (context as { [VOUCHED_REFERENCES]?: unknown })[VOUCHED_REFERENCES];
  if (!Array.isArray(held)) return false;
  const value = String(id);
  return held.some(
    (r) => r !== null && typeof r === 'object'
      && (r as VouchedReference).object === object
      && (r as VouchedReference).field === field
      && (r as VouchedReference).id === value,
  );
}
