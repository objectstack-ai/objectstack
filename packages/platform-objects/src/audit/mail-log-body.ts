// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { SysEmail } from './sys-email.object.js';
import { SysIdentityEmail } from './sys-identity-email.object.js';

/**
 * [#24625] The mail logs' BODY columns, named once for the readers that copy a
 * mail-log row somewhere else.
 *
 * Both logs (`sys_email` and its identity sibling `sys_identity_email`) gate
 * these columns on `manage_platform_settings` at the field: identity mail —
 * password reset, account invitation, verification, magic link, email-change
 * notice — carries sign-in and reset links in its body, and the 18.0 identity
 * rows still in `sys_email` cannot be told apart from tenant mail by any
 * column. A writer that COPIES a mail-log row (the `sys_activity` and
 * `sys_audit_log` mirrors) masks these columns in the copy the way it masks a
 * credential field, so the body is never held in clear a second time; the log
 * row itself stays the one place the body lives, behind its gate.
 */

/** The two mail logs whose rows carry a body. */
export const MAIL_LOG_OBJECTS: readonly string[] = [SysEmail.name, SysIdentityEmail.name];

/** The body columns a copy of a mail-log row masks. */
export const MAIL_LOG_BODY_FIELDS: readonly string[] = ['body_text', 'body_html'];

/** True when `objectName` is one of the two mail logs. */
export function isMailLogObject(objectName: string): boolean {
  return MAIL_LOG_OBJECTS.includes(objectName);
}
