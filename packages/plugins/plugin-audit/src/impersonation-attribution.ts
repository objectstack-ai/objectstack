// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Who was at the keyboard of an impersonation session — the metadata keys the
 * audit writers stamp, in one place.
 *
 * An administrator who impersonates a user writes AS that user: the session is
 * the user's, so `user_id`, `created_by`, ownership and every permission stay
 * theirs. What the ledger could not say was that the user did not type it. The
 * request-identity resolution now carries the administrator as the
 * attribution-only `ExecutionContext.impersonatedBy` (the session's
 * `impersonatedBy`), the engine hands it to hooks as
 * `HookContext.provenance.impersonatedBy`, and the writers record it under
 * these keys, in the additive shape an agent's write already uses
 * (`performed_by` / `on_behalf_of`):
 *
 *  - `sys_audit_log.metadata.impersonated_by` — the administrator's `sys_user`
 *    id, on the record-write row and on an action invocation's row;
 *  - `sys_activity.metadata.impersonated_by` — the same id on the timeline row,
 *    with `impersonated_by_name`, the administrator's name as the writer read
 *    it, beside it the way `actor_name` sits beside `actor_id`.
 *
 * Present ONLY on a write made from an impersonation session. The ABSENCE is
 * the record: no key means the user in `user_id` acted themselves. ⛔ Neither
 * key moves `user_id` or `actor` (ADR-0118 D1/D5 keeps `actor` two-valued and
 * answers "who else acted" with an ADDED field), and nothing in the
 * authorization path reads either.
 */

/** The metadata key naming the impersonating administrator's `sys_user` id. */
export const IMPERSONATED_BY_KEY = 'impersonated_by';

/** The `sys_activity` metadata key carrying that administrator's name snapshot. */
export const IMPERSONATED_BY_NAME_KEY = 'impersonated_by_name';

/**
 * The administrator an envelope names as the impersonator, or `undefined`.
 * Read off whichever server-stamped carrier the caller holds — a hook's
 * `provenance` or an `ExecutionContext` — and only as a non-blank string.
 */
export function impersonatorOf(carrier: { impersonatedBy?: unknown } | null | undefined): string | undefined {
  const by = carrier?.impersonatedBy;
  if (typeof by !== 'string') return undefined;
  const trimmed = by.trim();
  return trimmed ? trimmed : undefined;
}
