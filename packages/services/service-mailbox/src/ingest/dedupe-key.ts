// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The dedupe key of one inbound message: the value of `sys_mail_message`'s
 * `dedupe_key`, unique per mailbox (`(mailbox_id, dedupe_key)`), so a message
 * fetched twice is one row.
 *
 *  - `mid:<sha256 hex>` — of the Message-ID (angle brackets stripped, trimmed;
 *    RFC 5322 §3.6.4 makes it the message's identity), for a message that has
 *    one;
 *  - `hdr:<sha256 hex>` — of the header block exactly as received, for a
 *    message that has none. A second fetch of the same stored message hands
 *    over the same header block; two different messages without a Message-ID
 *    do not share one, because their `Received` / `Date` lines differ.
 *
 * The prefix says which derivation produced the key, so a reader of the row
 * can tell a Message-ID identity from the fallback. Hashing keeps the key
 * within the column's 128 characters whatever the input's length.
 *
 * SHA-256 is read from the Web Crypto global (`crypto.subtle`), which Node 20+,
 * browsers and Workers all provide.
 */

import type { ParsedInboundMessage } from './parse-message.js';

async function sha256Hex(text: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** The dedupe key of `message` (see the module header for the two derivations). */
export async function dedupeKeyOf(message: Pick<ParsedInboundMessage, 'messageId' | 'rawHeaderBlock'>): Promise<string> {
  const id = message.messageId?.trim();
  if (id) return `mid:${await sha256Hex(id)}`;
  return `hdr:${await sha256Hex(message.rawHeaderBlock)}`;
}
