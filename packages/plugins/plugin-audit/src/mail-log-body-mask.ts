// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#24625] The one mask a COPY of a mail-log row gets, shared by the two
 * places that hold such a copy to it: the audit writer (`ledgerView` in
 * `audit-writers.ts`), which masks every new `sys_audit_log` / `sys_activity`
 * copy at write time, and [#24693] the at-rest rewrite of the copies written
 * before it did (`mail-log-body-migration.ts`). One function, so a copy the
 * writer makes today and a copy the rewrite repaired read the same.
 *
 * The object names and the body columns are `@objectstack/platform-objects`'
 * (`mail-log-body.ts`); the mask value is the credential read mask
 * (`SECRET_MASK`). Neither is spelled here.
 */

import { SECRET_MASK } from '@objectstack/objectql/core';
import { MAIL_LOG_BODY_FIELDS, isMailLogObject } from '@objectstack/platform-objects/audit';

/**
 * Mask the body columns of one copy of an `objectName` row, IN PLACE, the way
 * a credential field is masked: a set body becomes {@link SECRET_MASK}, an
 * unset one stays `null` (so "no body" and "a body was sent" remain
 * distinguishable), and a column the copy does not carry is never invented. A
 * copy of any object other than the two mail logs is left as it is.
 *
 * Returns whether any column changed — `false` on a copy already masked, which
 * is what makes the at-rest rewrite idempotent.
 */
export function maskMailLogBodyCopy(objectName: unknown, copy: Record<string, unknown>): boolean {
  if (typeof objectName !== 'string' || !isMailLogObject(objectName)) return false;
  let changed = false;
  for (const field of MAIL_LOG_BODY_FIELDS) {
    if (!(field in copy)) continue;
    const masked = copy[field] == null ? null : SECRET_MASK;
    if (copy[field] === masked) continue;
    copy[field] = masked;
    changed = true;
  }
  return changed;
}
