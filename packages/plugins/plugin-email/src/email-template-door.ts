// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The `sys_email_template` organization door, CLOSED (ADR-0131 D6; ruling C on
 * ADR-0131 §6 Q1).
 *
 * ## What it refuses
 *
 * An organization's create and update of a `sys_email_template` row: every
 * engine `insert` / `update` whose execution context names a caller and is not
 * system-elevated. That is the generic data door (`POST` / `PATCH
 * /api/v1/data/sys_email_template`, the Studio record editor behind it, batch
 * and import routes, scripts and flows running as a user or a service
 * principal), because every one of them reaches the engine with the caller's
 * context. The refusal is `PERMISSION_DENIED` / 403 — the ADR-0112 catalog code,
 * the same code and status ADR-0123 D2 put on a permission-class refusal — and
 * its message names the closed door and the door that stays open (ADR-0123 D4:
 * a refusal that cannot be told apart from an unrelated denial is a wall nobody
 * can act on).
 *
 * ## What passes
 *
 *  - **System-context writes** (`isSystem: true`): the built-in seed, the
 *    declared-template boot sweep, the live projector that writes a Studio save
 *    of an `email_template` into its sending row, and the v18 migration
 *    ceremony's promotion. Studio editing of a template is the METADATA door
 *    (`PUT /api/v1/meta/email_template/:name`), which stays open; its projection
 *    into this table is a system write.
 *  - **A write with no caller at all** — an engine call made with no execution
 *    context, whose hook session is `undefined` ("no caller", never "an
 *    anonymous caller"; see the engine's `buildSession`). It is not an
 *    organization's write, and the scope of this refusal is that and no wider,
 *    the same scope ADR-0123 D2 draws for its own write refusal.
 *  - **Delete.** It places nothing and is not part of this door; a row an
 *    organization customized before the door closed is the v18 migration
 *    ceremony's to promote (ruling C), never this module's to remove.
 *
 * ## What it replaced
 *
 * The provenance stamp (`email-template-provenance.ts`, retired here) marked a
 * package- or platform-seeded row `customized: true` when a non-system caller
 * updated it, so the boot seeders would skip that row from then on. With this
 * door closed no non-system update reaches the engine's write, so there is
 * nothing left to stamp: rows already marked keep their mark, and nothing marks
 * a row again. Both hooks sat on the same seat — `beforeUpdate` on this object —
 * which is why the stamp's own "deliberately NOT a write gate" rationale is the
 * one this ruling reversed.
 */

interface MinimalEngine {
  registerHook(event: string, handler: (ctx: any) => any, options?: Record<string, any>): void;
  unregisterHooksByPackage(packageId: string): number;
}

interface MinimalLogger {
  info?: (msg: string, meta?: Record<string, any>) => void;
}

/** Package id the door's hooks are registered under — unbound by it on teardown. */
export const EMAIL_TEMPLATE_DOOR_PACKAGE = 'plugin-email:template-organization-door';

/** The verb a refused write is named by in its message. */
type DoorVerb = 'create' | 'edit';

/**
 * The refusal: `PERMISSION_DENIED` / 403, naming the closed door, why it is
 * closed and the door that stays open.
 */
export function emailTemplateDoorRefusal(object: string, verb: DoorVerb): Error {
  const err: any = new Error(
    `PERMISSION_DENIED: ${object} is closed to organization writes — an organization cannot ${verb} an `
    + 'email template row. Email templates are not overridden per organization: the rows are written by '
    + 'the platform alone, from the built-in templates and the email_template metadata. To change what a '
    + 'template sends, edit the email template in Studio.',
  );
  err.code = 'PERMISSION_DENIED';
  err.status = 403;
  err.object = object;
  return err;
}

/**
 * A write an organization makes: the hook session names a caller and is not
 * system-elevated. `undefined` is the engine's "no caller" — see the module doc.
 */
function isOrganizationWrite(session: unknown): boolean {
  if (!session || typeof session !== 'object') return false;
  return (session as Record<string, unknown>).isSystem !== true;
}

/**
 * Bind the closed door on `object`'s `beforeInsert` and `beforeUpdate`.
 * Re-binding replaces the previous binding rather than stacking a second one.
 */
export function bindEmailTemplateDoor(
  engine: MinimalEngine,
  logger?: MinimalLogger,
  object = 'sys_email_template',
): void {
  if (typeof engine?.registerHook !== 'function') return;
  if (typeof engine.unregisterHooksByPackage === 'function') {
    engine.unregisterHooksByPackage(EMAIL_TEMPLATE_DOOR_PACKAGE);
  }
  const guard = (verb: DoorVerb) => async (ctx: any) => {
    if (isOrganizationWrite(ctx?.session)) throw emailTemplateDoorRefusal(object, verb);
  };
  // Priority 10 — ahead of the default-100 hooks, so a refused write runs
  // nothing else first (the identity write guard's slot, for the same reason).
  const options = { object, packageId: EMAIL_TEMPLATE_DOOR_PACKAGE, priority: 10 };
  engine.registerHook('beforeInsert', guard('create'), options);
  engine.registerHook('beforeUpdate', guard('edit'), options);
  logger?.info?.('[email] sys_email_template organization door closed (system writes only)');
}

/** Remove the door's hooks from `engine`. */
export function unbindEmailTemplateDoor(engine: MinimalEngine): void {
  if (typeof engine?.unregisterHooksByPackage === 'function') {
    engine.unregisterHooksByPackage(EMAIL_TEMPLATE_DOOR_PACKAGE);
  }
}
