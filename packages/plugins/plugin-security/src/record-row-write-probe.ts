// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#27175] Would a by-id update of this stored row pass the row-level write
 * gates? — the verdict the record field-access answer carries as `writable`,
 * so a record's edit form stops offering an edit the gate refuses whole.
 *
 * ⛔ No second evaluator. The answer is not composed here from the gates'
 * parts: the probe RUNS the gates. It hands the authorization middleware this
 * plugin registers on the engine — the same function object, so every step
 * the write meets is the step the probe meets — a synthetic by-id `update` of
 * `recordId` with an empty payload, and ends the chain where the engine would
 * take over. Reaching that point means the middleware admitted the write; any
 * refusal on the way is `false`. Ruling of record 6457467702 (letter B) on the
 * record projection: the client never re-derives a lock, the server answers
 * with the gate's own judgement.
 *
 * Two middlewares refuse a by-id write for its ROW, and the probe asks both:
 *
 *  - this plugin's: the object grant (step 2, with the ADR-0066 D3 capability
 *    gate and the ADR-0090 D10 delegator ahead of it), the row-level security
 *    pre-image with the platform ownership floor and its sharing deferral
 *    (step 2.7), and the controlled-by-parent master (step 2.8);
 *  - plugin-sharing's, which runs inside this one: its by-id gate, asked
 *    through `SharingService.admitsByIdWrite` — the method its middleware
 *    refuses on — with the context exactly as this middleware stamped it for
 *    the next one (the write depth, an external principal's grant). Skipped
 *    when the deployment runs without that middleware (`enforce: false`), as
 *    the write skips it.
 *
 * ## Why an empty payload
 *
 * The question is the ROW, not a change set: every gate above judges the
 * stored row and the caller, and none reads the payload. The gates that do —
 * field-level security (its own answer is `editable`, field by field), the
 * masked echo, the owner forge, the RLS `check` post-image — admit an empty
 * one, so the probe asks nothing about which values a save may carry.
 *
 * ## Why it writes nothing
 *
 * The engine's executor — the `beforeUpdate` hooks, validation, the driver
 * write, the `afterUpdate` hooks and every audit row they produce — runs
 * after the last middleware, and the probe never reaches it: the chain's end
 * throws a sentinel that only this function catches. Before that point the
 * middleware refuses, reads, and stamps its operation and the context it is
 * handed; the probe owns the operation and hands a copy of the caller's
 * context, so the caller's own is never stamped. Its one shared write, the
 * permission-set memo epoch it advances for a write, is skipped for a probe
 * ({@link isRowWriteProbe}): a probe changes no grant.
 *
 * ## What `true` does not cover
 *
 * Rules outside those two middlewares, which a save can still meet: a
 * pending approval's record lock (its own reader, the approval service's
 * `getRecordLock`), conditional read-only rules and validation rules on the
 * values sent, an external datasource that refuses writes, and another
 * plugin's own rules for its own objects. ⛔ So `true` never means "this save
 * will succeed"; `false` always means the gate refuses the whole row.
 *
 * Fails CLOSED: no middleware registered (no engine), an unexpected throw, or
 * a middleware that answers without passing the operation on are all `false`.
 */

/**
 * Marks the synthetic operation {@link probeRecordRowWrite} hands the
 * middleware. A module-private symbol on the operation context, which only
 * this module constructs — no request, payload or execution context can carry
 * it.
 */
export const ROW_WRITE_PROBE: unique symbol = Symbol('objectstack.security.rowWriteProbe');

/** Whether `opCtx` is a row write probe's synthetic operation. */
export function isRowWriteProbe(opCtx: unknown): boolean {
  return !!opCtx && typeof opCtx === 'object' && (opCtx as Record<symbol, unknown>)[ROW_WRITE_PROBE] === true;
}

/** The engine middleware signature `registerAuthzMiddleware` registers. */
export type AuthzMiddlewareFn = (opCtx: any, chainNext: () => Promise<void>) => Promise<void>;

/** Thrown at the chain's end: the middleware admitted the write. Never escapes. */
class RowWriteProbeReachedEngine {}

/**
 * Run `middleware` over a synthetic by-id update of `object`/`recordId` under
 * a copy of `context`, and answer whether the write reaches the engine.
 * `sharingAdmits` is asked at the chain's end with the context as the
 * middleware stamped it; see the module header for both legs.
 */
export async function probeRecordRowWrite(
  middleware: AuthzMiddlewareFn | null | undefined,
  object: string,
  recordId: string,
  context: unknown,
  sharingAdmits: (stampedContext: any) => Promise<boolean>,
): Promise<boolean> {
  if (typeof middleware !== 'function') return false;
  const probeContext: Record<string, unknown> = { ...((context ?? {}) as Record<string, unknown>) };
  // The shape the engine's `update()` builds for a by-id update.
  const opCtx: Record<string | symbol, unknown> = {
    object,
    operation: 'update',
    data: {},
    options: { where: { id: recordId }, context: probeContext },
    context: probeContext,
    [ROW_WRITE_PROBE]: true,
  };
  const reachedEngine = new RowWriteProbeReachedEngine();
  let admitted = false;
  try {
    await middleware(opCtx, async () => {
      admitted = (await sharingAdmits(opCtx.context)) === true;
      throw reachedEngine;
    });
  } catch (e) {
    if (e === reachedEngine) return admitted;
    return false;
  }
  return false;
}
