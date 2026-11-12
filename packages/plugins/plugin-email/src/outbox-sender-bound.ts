// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * An outbox row is sent as the deployment's configured sender.
 *
 * A mail-log row (`sys_email`, `sys_identity_email`) inserted at `queued` with
 * no `message_id` by anyone other than the mail service's own `send()` is an
 * outbox entry: the drain (`email-plugin.ts`) and the boot sweep
 * (`outbox-sweep.ts`) deliver it, and a row's `from_address` is the From the
 * transport sends. Such a row's sender is therefore the configured sender,
 * whatever the row says: this `beforeInsert` bound writes the configured value
 * over the row's `from_address` before the row lands, so the row records the
 * From that is actually sent. A deployment that reports no configured sender
 * leaves the column empty, and the delivery fails that row for want of a
 * sender rather than sending as an address nobody configured.
 *
 * Out of scope, deliberately:
 *  - A row the service's own `send()` writes (it reserves the row id first,
 *    `EmailService.isServiceManaged`): its sender was already decided by
 *    `send()` — the configured default, a caller's `from` bounded by its door
 *    (`boundCallerMail`, `@objectstack/core`), or a platform template's
 *    declared sender.
 *  - A row that is not an outbox entry (any other status, or one carrying a
 *    `message_id`): it is a record of mail, not a request to send one.
 */

import type { EmailAddress } from '@objectstack/spec/contracts';
import { isEmailLogObject } from './email-log-objects.js';

/** The part of the mail service this bound reads. */
export interface OutboxSenderSource {
  getDefaultFrom(): EmailAddress | undefined;
  isServiceManaged(id: string): boolean;
}

/** The address text a mail-log row stores for one sender. */
function senderText(from: EmailAddress | undefined): string {
  if (from == null) return '';
  if (typeof from === 'string') return from.trim();
  const address = String(from.address ?? '').trim();
  if (!address) return '';
  const name = typeof from.name === 'string' ? from.name.trim() : '';
  return name ? `${name} <${address}>` : address;
}

/**
 * Bound one row about to be inserted into `object`: when it is an outbox entry
 * the service did not write, its `from_address` becomes the configured
 * sender's (empty when none is configured). Answers whether it rewrote the row.
 */
export function boundOutboxRowSender(object: unknown, row: unknown, source: OutboxSenderSource): boolean {
  if (!isEmailLogObject(object)) return false;
  if (!row || typeof row !== 'object' || Array.isArray(row)) return false;
  const record = row as Record<string, unknown>;
  if (record.status !== 'queued' || record.message_id) return false;
  if (record.id != null && source.isServiceManaged(String(record.id))) return false;
  record.from_address = senderText(source.getDefaultFrom());
  return true;
}

/** The engine surface {@link installOutboxSenderBound} registers on. */
interface HookEngine {
  registerHook(event: string, handler: (ctx: any) => unknown, options?: Record<string, unknown>): void;
}

/**
 * Register the bound as a `beforeInsert` hook on both mail logs, under
 * `packageId` (the drain's, so the two come and go together).
 */
export function installOutboxSenderBound(engine: HookEngine, source: OutboxSenderSource, packageId: string): void {
  const handler = (hookCtx: any): void => {
    // The engine hands an insert's row (or rows, for a batch) as `input.data`.
    const data = hookCtx?.input?.data;
    for (const row of Array.isArray(data) ? data : [data]) boundOutboxRowSender(hookCtx?.object, row, source);
  };
  for (const object of ['sys_email', 'sys_identity_email']) {
    engine.registerHook('beforeInsert', handler, { object, packageId });
  }
}
