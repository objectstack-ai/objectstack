// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Raw RFC 822 message → the facts the ingest seam stores and matches on.
 *
 * MIME is read by `postal-mime` (MIT-0, no dependencies, one TypeScript source
 * compiled to both an ES module and a CommonJS build, and written for Node,
 * browsers and Workers alike): RFC 5322 header unfolding, RFC 2047 encoded
 * words, address lists and groups, the RFC 2046 multipart walk, and the
 * transfer and charset decoding of the text and HTML bodies. This module adds
 * only what the seam itself decides:
 *
 *  - the participant addresses, per part: the received message's own From,
 *    Sender, Reply-To, To and Cc (`outer`), and the same five headers of each
 *    `message/rfc822` part of the received message (`attachment` — a message
 *    forwarded as an attachment, RFC 2046 §5.2.1). Such a part is read for its
 *    headers only, and a part nested inside it is not read at all: the seam
 *    reads the forward the user made, not the forwards inside it. A forwarded
 *    message quoted inline in the body is not read (that is the `inline`
 *    source, and its parser is separate work);
 *  - the threading ids (Message-ID, In-Reply-To, References, RFC 5322 §3.6.4),
 *    angle brackets stripped;
 *  - the header values automatic-mail suppression reads, and the top-level
 *    media type (`multipart/report`, RFC 6522, carries delivery reports);
 *  - the header block as received, for the dedupe fallback.
 */

import PostalMime, { addressParser } from 'postal-mime';
import type { Address, Email, Header } from 'postal-mime';

/** What the ingest seam accepts as one raw message. */
export type RawMailMessage = string | Uint8Array | ArrayBuffer;

/** The addresses one part of a message names, per participant header. */
export interface MailParticipantHeaders {
  from: string[];
  sender: string[];
  replyTo: string[];
  to: string[];
  cc: string[];
}

/** One parsed inbound message. */
export interface ParsedInboundMessage {
  /** Message-ID, angle brackets stripped, or `null` when the message has none. */
  messageId: string | null;
  inReplyTo: string[];
  references: string[];
  subject: string | null;
  /** The display name of the first From mailbox. */
  fromName: string | null;
  /** The `Date` header as an ISO timestamp, or `null` when absent or unreadable. */
  sentAt: string | null;
  text: string | null;
  html: string | null;
  /** The received message's own participants (the `outer` source). */
  outer: MailParticipantHeaders;
  /** One entry per `message/rfc822` part of the received message (the `attachment` source). */
  forwarded: MailParticipantHeaders[];
  /**
   * How many `message/rfc822` parts could not be read (the parser refused
   * them) or were past {@link MAX_FORWARDED_PARTS}. Their addresses are not in
   * {@link forwarded}; the message itself is still stored.
   */
  unreadForwardedParts: number;
  /** Lower-cased header name → the first value, unfolded, encoded words left as sent. */
  header(name: string): string | null;
  /** The top-level media type, lower-cased, without parameters (`text/plain` when absent). */
  mediaType: string;
  /** The value of the top-level Content-Type's `report-type` parameter, lower-cased. */
  reportType: string | null;
  /** The header block exactly as received: everything before the first empty line. */
  rawHeaderBlock: string;
}

/**
 * Parser bounds. `postal-mime`'s own limits stay at its defaults (nesting
 * depth, header bytes, part count); this one bounds how many forwarded parts
 * a single message may hand the matcher.
 */
export const MAX_FORWARDED_PARTS = 20;

const PARSE_OPTIONS = {
  // Every `message/rfc822` part is an attachment, never folded into the outer
  // body: its headers are read separately below, and its body is not the
  // received message's own text.
  forceRfc822Attachments: true,
  attachmentEncoding: 'arraybuffer',
} as const;

/** The angle-bracketed msg-ids of a header value; bare tokens when it has none. */
export function messageIdsOf(value: string | null | undefined): string[] {
  if (!value) return [];
  const bracketed = [...value.matchAll(/<([^<>]*)>/g)].map((m) => m[1]!.trim()).filter((id) => id.length > 0);
  if (bracketed.length > 0) return bracketed;
  return value.split(/\s+/).map((t) => t.trim()).filter((t) => t.length > 0);
}

function firstHeader(headers: ReadonlyArray<Header>, name: string): string | null {
  const hit = headers.find((h) => h.key === name);
  return hit ? hit.value : null;
}

function addressesOf(value: string | null): string[] {
  if (!value) return [];
  const out: string[] = [];
  const visit = (list: ReadonlyArray<Address>) => {
    for (const entry of list) {
      if (entry.group) visit(entry.group);
      else if (entry.address) out.push(entry.address);
    }
  };
  visit(addressParser(value));
  return out;
}

function participantsOf(headers: ReadonlyArray<Header>): MailParticipantHeaders {
  return {
    from: addressesOf(firstHeader(headers, 'from')),
    sender: addressesOf(firstHeader(headers, 'sender')),
    replyTo: addressesOf(firstHeader(headers, 'reply-to')),
    to: addressesOf(firstHeader(headers, 'to')),
    cc: addressesOf(firstHeader(headers, 'cc')),
  };
}

function firstMailboxName(value: string | null): string | null {
  if (!value) return null;
  for (const entry of addressParser(value, { flatten: true })) {
    if (entry.address) return entry.name ? entry.name : null;
  }
  return null;
}

function isoDate(value: string | undefined): string | null {
  if (!value) return null;
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? null : at.toISOString();
}

function asText(raw: RawMailMessage): string {
  if (typeof raw === 'string') return raw;
  // The WHATWG `latin1` label decodes one character per byte, so the header
  // block below stands for the bytes as received whatever their encoding.
  return new TextDecoder('latin1').decode(raw instanceof Uint8Array ? raw : new Uint8Array(raw));
}

/** Everything before the first empty line, line breaks as received. */
export function rawHeaderBlockOf(raw: RawMailMessage): string {
  const text = asText(raw);
  const match = /\r?\n\r?\n/.exec(text);
  return match ? text.slice(0, match.index) : text;
}

function mediaTypeOf(contentType: string | null): { mediaType: string; reportType: string | null } {
  if (!contentType) return { mediaType: 'text/plain', reportType: null };
  const mediaType = contentType.split(';')[0]!.trim().toLowerCase() || 'text/plain';
  const report = /(?:^|;)\s*report-type\s*=\s*"?([^";\s]+)"?/i.exec(contentType);
  return { mediaType, reportType: report ? report[1]!.toLowerCase() : null };
}

/** Parse one raw message. Throws when `postal-mime` refuses it (a bound exceeded). */
export async function parseInboundMessage(raw: RawMailMessage): Promise<ParsedInboundMessage> {
  const email: Email = await PostalMime.parse(raw, PARSE_OPTIONS);
  const forwarded: MailParticipantHeaders[] = [];
  let unreadForwardedParts = 0;
  for (const attachment of email.attachments) {
    if (attachment.mimeType.toLowerCase() !== 'message/rfc822') continue;
    if (forwarded.length >= MAX_FORWARDED_PARTS) {
      unreadForwardedParts++;
      continue;
    }
    const content = attachment.content;
    try {
      const inner: Email = await PostalMime.parse(
        typeof content === 'string' ? content : content instanceof Uint8Array ? content : new Uint8Array(content),
        PARSE_OPTIONS,
      );
      forwarded.push(participantsOf(inner.headers));
    } catch {
      // A forwarded part the parser refuses names no addresses; the received
      // message is still mirrored (never dropped), and the count says so.
      unreadForwardedParts++;
    }
  }

  const headers = email.headers;
  const { mediaType, reportType } = mediaTypeOf(firstHeader(headers, 'content-type'));
  const [messageId] = messageIdsOf(email.messageId ?? null);
  return {
    messageId: messageId ?? null,
    inReplyTo: messageIdsOf(firstHeader(headers, 'in-reply-to')),
    references: messageIdsOf(firstHeader(headers, 'references')),
    subject: email.subject ?? null,
    fromName: firstMailboxName(firstHeader(headers, 'from')),
    sentAt: isoDate(email.date),
    text: email.text ?? null,
    html: email.html ?? null,
    outer: participantsOf(headers),
    forwarded,
    unreadForwardedParts,
    header: (name: string) => firstHeader(headers, name.toLowerCase()),
    mediaType,
    reportType,
    rawHeaderBlock: rawHeaderBlockOf(raw),
  };
}

/** Every address one part names, in header order: From, Sender, Reply-To, To, Cc. */
export function participantAddresses(part: MailParticipantHeaders): string[] {
  return [...part.from, ...part.sender, ...part.replyTo, ...part.to, ...part.cc];
}
