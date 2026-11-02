// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#28881] The mark an elevated flow write carries so it keeps the write-time
 * reference check.
 *
 * ## Why a mark
 *
 * The reference check (`assertReferencesResolve`, objectql) refuses a
 * caller-supplied id in a lookup, user or master-detail field that names no
 * row (`reference_not_found`). It returns early for a system context: seed
 * replay, package install, boot provisioning, restore and migration write rows
 * in an order that resolves only once the batch completes, and the
 * cascade/set-null legs write no new link.
 *
 * A flow that runs as system (`runAs: 'system'`) is elevated for
 * AUTHORIZATION: it writes rows other people own, past RLS and FLS, inside the
 * trigger's organization. It is not one of those batch writers, and nothing
 * about elevation needs a link to a row that does not exist. Before this mark
 * the two were bundled, so an elevated flow's `create_record` /
 * `update_record` stored a reference to a deleted row with no error, while the
 * same write on the user path was refused.
 *
 * ## Where it is set — and where it is never set
 *
 * Only where a flow run's system elevation is derived:
 * `resolveRunDataContext` (service-automation), the one envelope every flow
 * data node, and every custom node that follows the documented contract,
 * hands the data engine. Its only reader is the reference check, which keeps
 * checking for a marked context. It narrows and grants nothing: the context
 * keeps `isSystem` and every authorization exemption that comes with it.
 *
 * ⛔ Never set on `sudo()`, a seeder's, an importer's, a restore's or any
 * other platform writer's system context: they keep the exemption unchanged.
 *
 * ## Writes a flow write sets off carry it too
 *
 * The mark rides every context derived from the run's by a spread, as
 * `APP_AUTOMATION_ELEVATION` does, so a write set off under a flow-run write is
 * checked as the flow's own: a hook's `ctx.api` (the engine wraps the raw
 * operation context, with no parse), its `runAs: 'system'` or `ctx.api.sudo()`
 * elevation, and the engine's cascade legs (the `set_null` member-removal
 * write on a multi-value field spreads the deleting context). That is the
 * user path's answer for the same writes, and deliberate: stripping the mark
 * there would reopen the bypass one hop down. A cascade leg writes no new
 * link, so only a caller-supplied value it carries is judged — for the
 * member-removal leg, the members a multi-value field keeps.
 *
 * ## Why a symbol, and why it is not an `ExecutionContext` field
 *
 * No request body, query string, stored row or flow definition can spell a
 * symbol, so no author can set or clear it: it is not an authorable key and is
 * in no schema. It rides a spread of the context as any own property does.
 * `Symbol.for` rather than a module-local `Symbol()`, because this package
 * ships an ESM and a CJS build and a process may load both: the mark must be
 * the same key in each. Being undeclared, it does not survive
 * `ExecutionContextSchema.parse`, which keeps declared keys only, so a write
 * made through a parsed context (`ObjectQL#createContext`) is judged as that
 * context's own write.
 */

/** The context key of the mark. See the module header. */
export const FLOW_WRITE_REFERENCE_CHECK: unique symbol = Symbol.for('objectstack.core.flowWriteReferenceCheck');

/**
 * `context` with the mark added — a fresh object; `context` is not changed.
 * Called only where a flow run's system elevation is derived (see the module
 * header).
 */
export function markFlowWriteReferenceCheck<T extends object>(
  context: T,
): T & { [FLOW_WRITE_REFERENCE_CHECK]: true } {
  return { ...context, [FLOW_WRITE_REFERENCE_CHECK]: true };
}

/** Does `context` carry the mark? `false` for every other context. */
export function keepsFlowWriteReferenceCheck(context: unknown): boolean {
  if (context === null || typeof context !== 'object') return false;
  return (context as { [FLOW_WRITE_REFERENCE_CHECK]?: unknown })[FLOW_WRITE_REFERENCE_CHECK] === true;
}
