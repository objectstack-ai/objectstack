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
