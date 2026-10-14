// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The participant set a message is matched with — its addresses and where in
 * the message each one was read (ruling 6116489638 on #22870, Q3 C phase 1).
 *
 * A message row stores the set it was matched with in `match_addresses`, so a
 * re-match replays exactly that input (decision 2: an association is a
 * deterministic, auditable fact) and a reader can tell which part of the
 * message supplied an address.
 *
 * ## The stored shape
 *
 * A JSON array of `{ "address": string, "source": MailMatchAddressSource }`
 * objects, in the order the message carried them, outer headers first. One
 * entry per (address, source) pair: an address the outer headers and a
 * forwarded part both name appears once under each source. The address is a
 * normalized addr-spec ({@link normalizeMailAddress}).
 *
 * A stored value that is not this shape is not replayed: {@link
 * parseMatchAddresses} answers `null`, and the re-match that read it reports
 * the message as unreadable instead of matching it against a guess.
 */

/**
 * Where in a message an address was read.
 *
 *  - `outer` — the received message's own From, Sender, Reply-To, To and Cc;
 *  - `attachment` — the same headers of a `message/rfc822` (RFC 2046 §5.2.1)
 *    or `message/global` (RFC 6532 §3.7) part of the received message: a
 *    message forwarded as an attachment;
 *  - `inline` — the From, Reply-To, To and Cc of a forwarded message quoted
 *    in the body text: the "Forwarded message" block of Gmail, Outlook or
 *    Apple Mail (`inline-forward.ts`), read only for a message sent by a user
 *    of the mailbox's organization (`mail-ingest-service.ts`).
 */
export const MAIL_MATCH_ADDRESS_SOURCES = ['outer', 'attachment', 'inline'] as const;

/** One of {@link MAIL_MATCH_ADDRESS_SOURCES}. */
export type MailMatchAddressSource = (typeof MAIL_MATCH_ADDRESS_SOURCES)[number];

/** One participant address and the part of the message it was read from. */
export interface MailMatchAddress {
  /** A normalized addr-spec: trimmed, ASCII letters lower-cased. */
  address: string;
  source: MailMatchAddressSource;
}

/** The longest address the association row stores (`matched_address`). */
export const MAIL_ADDRESS_MAX_LENGTH = 320;

const SOURCES: ReadonlySet<string> = new Set(MAIL_MATCH_ADDRESS_SOURCES);

/**
 * An addr-spec as the matcher compares it, or `null` when the value is not one.
 *
 * Matching is ASCII case-insensitive (the `mailAssociation` contract), so only
 * ASCII letters are folded; every other character is kept as written. A value
 * with no `@`, an empty local part or domain, whitespace inside it, or more than
 * {@link MAIL_ADDRESS_MAX_LENGTH} characters is not an address anything can
 * match.
 */
export function normalizeMailAddress(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAIL_ADDRESS_MAX_LENGTH) return null;
  if (/\s/.test(trimmed)) return null;
  const at = trimmed.lastIndexOf('@');
  if (at <= 0 || at === trimmed.length - 1) return null;
  return trimmed.replace(/[A-Z]/g, (c) => c.toLowerCase());
}

/**
 * The participant set for one message: `outer` addresses first, then
 * `attachment` ones, then `inline` ones — the order of `parts` — each
 * normalized, the mailbox's own addresses removed, and each (address, source)
 * pair kept once.
 */
export function collectMatchAddresses(
  parts: ReadonlyArray<{ source: MailMatchAddressSource; addresses: ReadonlyArray<string> }>,
  mailboxAddresses: ReadonlyArray<string>,
): MailMatchAddress[] {
  const own = new Set(mailboxAddresses.map(normalizeMailAddress).filter((a): a is string => a !== null));
  const seen = new Set<string>();
  const out: MailMatchAddress[] = [];
  for (const part of parts) {
    for (const raw of part.addresses) {
      const address = normalizeMailAddress(raw);
      if (address === null || own.has(address)) continue;
      const key = `${part.source} ${address}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ address, source: part.source });
    }
  }
  return out;
}

/** The stored spelling of a participant set (`match_addresses`). */
export function serializeMatchAddresses(addresses: ReadonlyArray<MailMatchAddress>): string {
  return JSON.stringify(addresses.map(({ address, source }) => ({ address, source })));
}

/**
 * A stored participant set, or `null` when the value is not the stored shape:
 * not a JSON array, an entry that is not exactly `{ address, source }`, a source
 * outside {@link MAIL_MATCH_ADDRESS_SOURCES}, or an address that is not already
 * normalized. An empty stored value (`null`, `''`) is the empty set.
 */
export function parseMatchAddresses(stored: unknown): MailMatchAddress[] | null {
  if (stored === null || stored === undefined || stored === '') return [];
  if (typeof stored !== 'string') return null;
  let value: unknown;
  try {
    value = JSON.parse(stored);
  } catch {
    return null;
  }
  if (!Array.isArray(value)) return null;
  const out: MailMatchAddress[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return null;
    const keys = Object.keys(entry);
    if (keys.length !== 2 || !keys.includes('address') || !keys.includes('source')) return null;
    const { address, source } = entry as Record<string, unknown>;
    if (typeof source !== 'string' || !SOURCES.has(source)) return null;
    if (typeof address !== 'string' || normalizeMailAddress(address) !== address) return null;
    out.push({ address, source: source as MailMatchAddressSource });
  }
  return out;
}
