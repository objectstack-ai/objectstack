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
 * over the row's `from_address`, and takes every sender header
 * (`SENDER_HEADER_NAMES`, `@objectstack/core`) out of its `headers_json`,
 * before the row lands, so the row records the sender that is actually sent.
 * The drain sends such a row from the configured sender again at delivery
 * (`DeliverAttemptOptions.asConfiguredSender`), whatever the row says by then.
 * A deployment that reports no configured sender empties the column, and the
 * mail log refuses the insert itself (`from_address` is required): no row
 * lands, and nothing is sent as an address nobody configured.
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
import { SENDER_HEADER_NAMES } from '@objectstack/core';
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
 * A row's `headers_json` with every sender header taken out; `null` when none
 * is left. One that does not decode to an object of headers is left as it is:
 * delivery refuses it.
 */
function withoutSenderHeaders(value: unknown): unknown {
  if (typeof value !== 'string' || value.trim() === '') return value;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return value;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return value;
  const kept = Object.entries(parsed as Record<string, unknown>).filter(
    ([name]) => !SENDER_HEADER_NAMES.has(name.trim().toLowerCase()),
  );
  return kept.length > 0 ? JSON.stringify(Object.fromEntries(kept)) : null;
}

/**
 * Bound one row about to be inserted into `object`: when it is an outbox entry
 * the service did not write, its `from_address` becomes the configured
 * sender's (empty when none is configured) and its `headers_json` loses every
 * sender header. Answers whether it rewrote the row.
 */
export function boundOutboxRowSender(object: unknown, row: unknown, source: OutboxSenderSource): boolean {
  if (!isEmailLogObject(object)) return false;
  if (!row || typeof row !== 'object' || Array.isArray(row)) return false;
  const record = row as Record<string, unknown>;
  if (record.status !== 'queued' || record.message_id) return false;
  if (record.id != null && source.isServiceManaged(String(record.id))) return false;
  record.from_address = senderText(source.getDefaultFrom());
  if ('headers_json' in record) record.headers_json = withoutSenderHeaders(record.headers_json);
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
