// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * A forward quoted INLINE in the body text: the `inline` source of the
 * participant set (ruling 6116489638 on #22870, Q3 C, the staged half).
 *
 * Exactly three client formats are read, as each client writes the forward
 * into the text/plain body with English labels:
 *
 *  - **Gmail** — the line `---------- Forwarded message ---------`, then
 *    `From:`, `Date:`, `Subject:`, `To:` and `Cc:` lines;
 *  - **Outlook** (Outlook on the web, Outlook.com, Microsoft 365) — a line of
 *    32 underscores, then `From:`, `Sent:`, `To:`, `Cc:` and `Subject:` lines;
 *  - **Apple Mail** — the line `Begin forwarded message:`, an empty line, then
 *    `From:`, `Subject:`, `Date:`, `To:`, `Cc:` and `Reply-To:` lines, each
 *    line of the block carrying the `>` quote marker the client's plain-text
 *    rendering adds (or not).
 *
 * The shapes are those of the client output collected in the MIT-licensed
 * `email-forward-parser` (Crisp IM SAS) — its fixtures `gmail_en_body.txt`,
 * `outlook_live_body.txt` and `apple_mail_en_body.txt`, and the separator
 * patterns its parser documents per client. The fixtures in
 * `messages.fixture.ts` reproduce them.
 *
 * ## What is recognised, and nothing else
 *
 * The FIRST separator line of the three formats in the body decides: the
 * forward the user made sits above any forward quoted inside it, which is not
 * read (as a `message/rfc822` part nested in a forwarded part is not). Its
 * block is recognised only when it is complete:
 *
 *  - the header lines follow the separator directly (Apple Mail: after at most
 *    one empty line) and run to the first empty line or the end of the text;
 *  - every one of them is `Label: value` with a label of THAT format, each
 *    label at most once, and `From:` comes first;
 *  - the format's date line (`Date:`, or Outlook's `Sent:`) is present;
 *  - `From:` names at least one address.
 *
 * Anything else — a separator followed by prose, a label of another format or
 * locale (Gmail's `Von:`, Outlook's `Gesendet:`), a wrapped header line, a
 * block with no date line, a `From:` naming no address — is not recognised,
 * and {@link parseInlineForward} answers `null`: nothing is guessed, and the
 * message is matched on its other participants only, which may pool it.
 *
 * The body read is the text/plain one (`ParsedInboundMessage.text`). A message
 * with an HTML body only has none, so its forward is not read either.
 *
 * Pure: text in, participants out. Whether a recognised forward's participants
 * are USED is the ingest seam's decision (`mail-ingest-service.ts`): only for a
 * forward sent by a user of the mailbox's organization.
 */

import { addressParser } from 'postal-mime';
import type { Address } from 'postal-mime';
import { normalizeMailAddress } from './match-addresses.js';
import type { MailParticipantHeaders } from './parse-message.js';

/** The client formats {@link parseInlineForward} reads. */
export const INLINE_FORWARD_FORMATS = ['gmail', 'outlook', 'apple_mail'] as const;

/** One of {@link INLINE_FORWARD_FORMATS}. */
export type InlineForwardFormat = (typeof INLINE_FORWARD_FORMATS)[number];

/** A recognised inline forward: its format and the original message's participants. */
export interface InlineForward {
  format: InlineForwardFormat;
  /** The addresses the block names, per participant header (`sender` is always empty). */
  participants: MailParticipantHeaders;
}

type ParticipantHeader = keyof MailParticipantHeaders;

interface ClientFormat {
  format: InlineForwardFormat;
  /** Matched against one line, trailing whitespace removed (and the quote marker, where the client quotes). */
  separator: RegExp;
  /** Every label of the block → the participant header it fills, or `null` for a label read for its presence only. */
  labels: ReadonlyMap<string, ParticipantHeader | null>;
  /** The label the format always writes the original's date under. */
  dateLabel: string;
  /** Each line of the block may carry one `>` quote marker. */
  quoted: boolean;
  /** One empty line may sit between the separator and the header lines. */
  emptyLineBeforeHeaders: boolean;
}

const FORMATS: ReadonlyArray<ClientFormat> = [
  {
    format: 'gmail',
    // Ten dashes and nine today; the pattern documented for the client allows 8–10 either side.
    separator: /^-{8,10} Forwarded message -{8,10}$/,
    labels: new Map<string, ParticipantHeader | null>([
      ['From', 'from'],
      ['Date', null],
      ['Subject', null],
      ['To', 'to'],
      ['Cc', 'cc'],
    ]),
    dateLabel: 'Date',
    quoted: false,
    emptyLineBeforeHeaders: false,
  },
  {
    format: 'outlook',
    separator: /^_{32}$/,
    labels: new Map<string, ParticipantHeader | null>([
      ['From', 'from'],
      ['Sent', null],
      ['To', 'to'],
      ['Cc', 'cc'],
      ['Subject', null],
    ]),
    dateLabel: 'Sent',
    quoted: false,
    emptyLineBeforeHeaders: false,
  },
  {
    format: 'apple_mail',
    separator: /^Begin forwarded message:$/,
    labels: new Map<string, ParticipantHeader | null>([
      ['From', 'from'],
      ['Subject', null],
      ['Date', null],
      ['To', 'to'],
      ['Cc', 'cc'],
      ['Reply-To', 'replyTo'],
    ]),
    dateLabel: 'Date',
    quoted: true,
    emptyLineBeforeHeaders: true,
  },
];

const HEADER_LINE = /^([^\s:]+):(?: (.*))?$/;

/** One line as a format reads it: trailing whitespace dropped, and one quote marker where the client quotes. */
function lineAs(format: ClientFormat, raw: string): string {
  const line = raw.trimEnd();
  return format.quoted ? line.replace(/^> ?/, '') : line;
}

/** The addresses of one header value, in order; a name with no address names none. */
function addressesOf(value: string): string[] {
  const out: string[] = [];
  const visit = (list: ReadonlyArray<Address>) => {
    for (const entry of list) {
      if (entry.group) visit(entry.group);
      else if (entry.address && normalizeMailAddress(entry.address) !== null) out.push(entry.address);
    }
  };
  visit(addressParser(value));
  return out;
}

/** The block after a separator at `lines[start - 1]`, or `null` when it is not complete. */
function readBlock(format: ClientFormat, lines: ReadonlyArray<string>, start: number): InlineForward | null {
  let at = start;
  if (format.emptyLineBeforeHeaders && at < lines.length && lineAs(format, lines[at]!) === '') at++;

  const participants: MailParticipantHeaders = { from: [], sender: [], replyTo: [], to: [], cc: [] };
  const seen = new Set<string>();
  for (; at < lines.length; at++) {
    const line = lineAs(format, lines[at]!);
    if (line === '') break;
    const header = HEADER_LINE.exec(line);
    if (!header) return null;
    const label = header[1]!;
    if (!format.labels.has(label) || seen.has(label)) return null;
    if (seen.size === 0 && label !== 'From') return null;
    seen.add(label);
    const target = format.labels.get(label);
    if (target) participants[target] = addressesOf(header[2] ?? '');
  }
  if (!seen.has(format.dateLabel) || participants.from.length === 0) return null;
  return { format: format.format, participants };
}

/**
 * The inline forward the body text carries, or `null` when it carries none
 * this module recognises (see the module docblock for what is recognised).
 */
export function parseInlineForward(text: string | null | undefined): InlineForward | null {
  if (!text) return null;
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    for (const format of FORMATS) {
      if (format.separator.test(lineAs(format, lines[i]!))) return readBlock(format, lines, i + 1);
    }
  }
  return null;
}
