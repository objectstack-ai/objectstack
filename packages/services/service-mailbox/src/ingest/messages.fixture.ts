// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Raw RFC 822 fixtures for the ingest tests — synthetic addresses only, CRLF
 * line breaks as a mail store hands them over.
 */

export type HeaderList = ReadonlyArray<readonly [string, string]>;

/** One message: its header lines, an empty line, its body. */
export function rfc822(headers: HeaderList, body: string): string {
  return [...headers.map(([name, value]) => `${name}: ${value}`), '', body].join('\r\n');
}

/** A plain-text message with the usual headers, overridable one by one. */
export function plainMessage(over: Record<string, string | null> = {}, body = 'Hello.'): string {
  const base: Record<string, string> = {
    From: 'Customer <customer@acme.test>',
    To: 'Sales Inbox <inbox@corp.test>',
    Subject: 'A question',
    'Message-ID': '<plain-1@acme.test>',
    Date: 'Mon, 12 Oct 2026 09:00:00 +0000',
    'MIME-Version': '1.0',
    'Content-Type': 'text/plain; charset=utf-8',
  };
  const merged: Array<[string, string]> = [];
  for (const [name, value] of Object.entries({ ...base, ...over })) if (value !== null) merged.push([name, value]);
  return rfc822(merged, body);
}

/**
 * A message forwarded AS AN ATTACHMENT (RFC 2046 §5.2.1): the forwarder's note
 * plus the original message as a `message/rfc822` part — or, with
 * `mediaType: 'message/global'`, as the internationalized part of RFC 6532
 * §3.7, optionally base64-encoded (that type allows any transfer encoding).
 */
let boundarySeq = 0;

export function forwardAsAttachment(options: {
  forwarder?: string;
  to?: string;
  messageId?: string;
  original: string;
  mediaType?: 'message/rfc822' | 'message/global';
  base64?: boolean;
}): string {
  // A boundary of its own per message, as every client mints one: a forward
  // nested inside another must not share its delimiter.
  const boundary = `fwd-${++boundarySeq}-boundary`;
  return rfc822(
    [
      ['From', options.forwarder ?? 'Rep <rep@corp.test>'],
      ['To', options.to ?? 'inbox@corp.test'],
      ['Subject', 'Fwd: A question'],
      ['Message-ID', options.messageId ?? '<fwd-1@corp.test>'],
      ['Date', 'Mon, 12 Oct 2026 10:00:00 +0000'],
      ['MIME-Version', '1.0'],
      ['Content-Type', `multipart/mixed; boundary="${boundary}"`],
    ],
    [
      `--${boundary}`,
      'Content-Type: text/plain; charset=utf-8',
      '',
      "See the customer's question attached.",
      `--${boundary}`,
      `Content-Type: ${options.mediaType ?? 'message/rfc822'}`,
      ...(options.base64 ? ['Content-Transfer-Encoding: base64'] : []),
      'Content-Disposition: attachment; filename="question.eml"',
      '',
      options.base64
        ? (Buffer.from(options.original, 'utf8').toString('base64').match(/.{1,76}/g) ?? []).join('\r\n')
        : options.original,
      `--${boundary}--`,
      '',
    ].join('\r\n'),
  );
}

/**
 * The original message an inline forward quotes: header values exactly as the
 * client writes them into its block (display names, angle brackets and list
 * separators included).
 */
export interface InlineOriginal {
  from?: string;
  to?: string;
  cc?: string | null;
  replyTo?: string;
  subject?: string;
  body?: string;
}

/**
 * The "Forwarded message" block of a Gmail forward, as Gmail writes it into
 * the text/plain body: the shape of `test/fixtures/gmail_en_body.txt` in
 * `email-forward-parser` (MIT, Crisp IM SAS) — separator, then From, Date,
 * Subject, To and Cc, an empty line, the original's text.
 */
export function gmailForwardBlock(original: InlineOriginal = {}): string {
  return [
    '---------- Forwarded message ---------',
    `From: ${original.from ?? 'Customer <customer@acme.test>'}`,
    'Date: Wed, Oct 27, 2021 at 9:31 AM',
    `Subject: ${original.subject ?? 'A question'}`,
    `To: ${original.to ?? '<rep@corp.test>'}`,
    ...(original.cc === null ? [] : [`Cc: ${original.cc ?? 'Buyer <buyer@acme.test>, Partner <partner@globex.test>'}`]),
    '',
    original.body ?? 'What does it cost?',
  ].join('\r\n');
}

/**
 * The block of an Outlook forward (Outlook on the web / Microsoft 365), as it
 * writes the text/plain body: the shape of `test/fixtures/outlook_live_body.txt`
 * in `email-forward-parser` — 32 underscores, then From, Sent, To, Cc (a `;`
 * list) and Subject, an empty line, the original's text.
 */
export function outlookForwardBlock(original: InlineOriginal = {}): string {
  return [
    '________________________________',
    `From: ${original.from ?? 'Customer <customer@acme.test>'}`,
    'Sent: Wednesday, October 27, 2021 15:14',
    `To: ${original.to ?? 'rep@corp.test <rep@corp.test>'}`,
    ...(original.cc === null ? [] : [`Cc: ${original.cc ?? 'Buyer <buyer@acme.test>; Partner <partner@globex.test>'}`]),
    `Subject: ${original.subject ?? 'A question'}`,
    '',
    original.body ?? 'What does it cost?',
  ].join('\r\n');
}

/**
 * The block of an Apple Mail forward, as its text/plain rendering writes it:
 * the shape of `test/fixtures/apple_mail_en_body.txt` in
 * `email-forward-parser` — every line quoted with `>`, the separator, an empty
 * line, then From, Subject, Date, To and Cc (and Reply-To when the original
 * carried one), an empty line, the original's text.
 */
export function appleMailForwardBlock(original: InlineOriginal = {}): string {
  return [
    'Begin forwarded message:',
    '',
    `From: ${original.from ?? 'Customer <customer@acme.test>'}`,
    `Subject: ${original.subject ?? 'A question'}`,
    'Date: 25 October 2021 at 11:17:21 EEST',
    `To: ${original.to ?? 'rep@corp.test'}`,
    ...(original.cc === null ? [] : [`Cc: ${original.cc ?? 'Buyer <buyer@acme.test>, Partner <partner@globex.test>'}`]),
    ...(original.replyTo === undefined ? [] : [`Reply-To: ${original.replyTo}`]),
    '',
    original.body ?? 'What does it cost?',
  ]
    .map((line) => (line === '' ? '>' : `> ${line}`))
    .join('\r\n');
}

/**
 * A message forwarded INLINE: a plain-text message from the forwarder whose
 * body is a note followed by the client's forward `block` — or, with `block`
 * `null`, the same message carrying the note only (the control).
 */
export function forwardInline(options: { forwarder?: string; messageId: string; block: string | null }): string {
  const note = "See the customer's question below.";
  return plainMessage(
    {
      From: options.forwarder ?? 'Rep <rep@corp.test>',
      Subject: 'Fwd: A question',
      'Message-ID': options.messageId,
    },
    options.block === null ? note : `${note}\r\n\r\n${options.block}`,
  );
}

/** A delivery-status report (RFC 3464 inside RFC 6522 `multipart/report`): a bounce. */
export function bounce(): string {
  return rfc822(
    [
      ['From', 'Mail Delivery System <mailer-daemon@relay.test>'],
      ['To', 'inbox@corp.test'],
      ['Subject', 'Undelivered Mail Returned to Sender'],
      ['Message-ID', '<bounce-1@relay.test>'],
      ['MIME-Version', '1.0'],
      ['Content-Type', 'multipart/report; report-type=delivery-status; boundary="dsn"'],
    ],
    [
      '--dsn',
      'Content-Type: text/plain; charset=us-ascii',
      '',
      'Your message to customer@acme.test could not be delivered.',
      '--dsn',
      'Content-Type: message/delivery-status',
      '',
      'Reporting-MTA: dns; relay.test',
      '',
      'Final-Recipient: rfc822; customer@acme.test',
      'Action: failed',
      'Status: 5.1.1',
      '--dsn--',
      '',
    ].join('\r\n'),
  );
}
