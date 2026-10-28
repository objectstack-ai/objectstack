// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A session is born with `last_activity_at` = `created_at`.
 *
 * `sys_session.last_activity_at` is "the last request on this session", kept by
 * the throttled heartbeat (`auth-manager-password-session-policy.ts`, at most
 * one write a minute). Until that first write the column was empty, so Setup ›
 * Sessions read 「—」 for a live session, and a session nobody used again — a
 * token minted at sign-in — read 「—」 for good. The creation instant is the
 * session's first activity, so the row is written with it.
 *
 * ## Why an engine hook, not better-auth's session hook or the adapter
 *
 * better-auth's session model does not declare the column, so a field set in
 * its `session.create.before` hook is dropped before the write. The adapter
 * could add it, but `created_at` is not the adapter's to know: ObjectQL's own
 * `beforeInsert` stamp (`sys_stamp_audit_insert`, priority 10) replaces
 * whatever the caller sent with the insert instant. This hook runs after that
 * stamp, at {@link SESSION_FIRST_ACTIVITY_PRIORITY}, and copies the value the
 * row is actually stored with — on every `sys_session` insert, whichever path
 * made it.
 *
 * A `last_activity_at` the insert already carries is kept. The heartbeat is
 * unchanged: it writes once the stored value is more than a minute old, so its
 * first write comes on the first request a minute after creation.
 */

/** After ObjectQL's `created_at` stamp (10), so the copy is of the stored value. */
export const SESSION_FIRST_ACTIVITY_PRIORITY = 15;

const SESSION_OBJECT = 'sys_session';

/** Register the hook on an ObjectQL engine. Performs no I/O. */
export function registerSessionFirstActivity(engine: any, opts: { packageId: string }): void {
  engine.registerHook(
    'beforeInsert',
    async (ctx: any): Promise<void> => {
      const data = ctx?.input?.data;
      if (!data || typeof data !== 'object') return;
      const row = data as Record<string, unknown>;
      if (row.last_activity_at != null || row.created_at == null) return;
      row.last_activity_at = row.created_at;
    },
    { object: SESSION_OBJECT, priority: SESSION_FIRST_ACTIVITY_PRIORITY, packageId: opts.packageId },
  );
}
