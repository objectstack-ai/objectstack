// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The two objects the mail pipeline persists to and reads back from.
 *
 * `sys_email` is the tenant mail log; `sys_identity_email` is its
 * deployment-level sibling for mail about a person rather than an
 * organization (ADR-0131 D7, ruling of record 6257510973, letter Q2 A). One
 * row shape, one pipeline: every reader that re-reads a row by id or by
 * status — the queue worker, the outbox drain hook, the boot outbox sweep,
 * attachment reclamation, the internal-header readback — names the object it
 * reads from one of these, never a literal of its own.
 *
 * A row id is minted by the service and unique across both objects; what a
 * reader cannot recover from the id is WHICH object holds it, so a durable
 * job carries the object beside the id. A job with no object is one an 18.0
 * process published, when `sys_email` was the only log — it reads
 * `sys_email` (expand-first: those rows and jobs stay where they are).
 */

/** The tenant mail log. */
export const TENANT_EMAIL_OBJECT = 'sys_email';

/** The deployment-level identity mail log. */
export const IDENTITY_EMAIL_OBJECT = 'sys_identity_email';

/** Both logs, tenant first. */
export const EMAIL_LOG_OBJECTS = [TENANT_EMAIL_OBJECT, IDENTITY_EMAIL_OBJECT] as const;

export type EmailLogObject = (typeof EMAIL_LOG_OBJECTS)[number];

/** True when `value` names one of the two mail logs. */
export function isEmailLogObject(value: unknown): value is EmailLogObject {
  return value === TENANT_EMAIL_OBJECT || value === IDENTITY_EMAIL_OBJECT;
}

/**
 * The object a durable job's `object` member names: absent ⇒ `sys_email` (a
 * job published before the sibling existed), a log's name ⇒ that log, and
 * anything else ⇒ `undefined`, which the caller refuses loudly — reading a
 * guessed object would deliver or reclaim the wrong row.
 */
export function emailLogObjectOfJob(object: unknown): EmailLogObject | undefined {
  if (object === undefined || object === null) return TENANT_EMAIL_OBJECT;
  return isEmailLogObject(object) ? object : undefined;
}
