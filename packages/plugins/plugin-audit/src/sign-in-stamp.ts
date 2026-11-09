// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The sign-in stamp on the compliance ledger: which `sys_audit_log` row it is,
 * and the mark the ledger writer leaves on it.
 *
 * Every successful sign-in writes two ledger rows. The auth-event sink writes
 * the `login` row on `sys_session` (actor, client address, endpoint), and
 * plugin-auth's `stampLastLogin` updates `last_login_at` / `last_login_ip` on
 * the person's `sys_user` row, which the CRUD writer mirrors as an `update`
 * under that person's own id (ADR-0069 D7; attributed rather than excluded, so
 * the address trail stays on the ledger). The second row restates the first.
 *
 * Nothing on the row told it apart from an administrator's edit of the same
 * user: both are `update` on `sys_user`, and the only columns that differ are
 * the before/after snapshots, which a list filter may not name for every
 * reader (`parent-field-query-guard.ts`). So the writer marks the stamp in
 * `metadata.event`, the column `config_change` rows already carry their event
 * name in (`settings.set`), and the ledger's default view leaves marked rows
 * out (`sys-audit-log.object.ts`, `recent`). The row is still written, and the
 * `all_events` view still lists it.
 *
 * The test is the CHANGED fields, never the write's context: an update of
 * `sys_user` whose meaningful changes are the stamp's fields and nothing else.
 * Any other change on the same write (a rename, a ban) makes it an act, and it
 * carries no mark.
 */

/** The `metadata.event` the ledger writer stamps on a sign-in stamp row. */
export const SIGN_IN_STAMP_EVENT = 'auth.last_login_stamp';

/** The object the sign-in stamp updates. */
const SIGN_IN_STAMP_OBJECT = 'sys_user';

/** The fields the sign-in stamp writes (plugin-auth `stampLastLogin`). */
const SIGN_IN_STAMP_FIELDS: ReadonlySet<string> = new Set(['last_login_at', 'last_login_ip']);

/**
 * Whether an `update` row is the sign-in stamp: the object is `sys_user` and
 * every changed field (the writer's diff, noise fields already dropped) is one
 * of the stamp's. No changed field answers `false`.
 */
export function isSignInStamp(object: string, changedFields: readonly string[]): boolean {
  return (
    object === SIGN_IN_STAMP_OBJECT
    && changedFields.length > 0
    && changedFields.every((field) => SIGN_IN_STAMP_FIELDS.has(field))
  );
}
