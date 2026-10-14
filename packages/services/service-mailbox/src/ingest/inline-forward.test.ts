// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The inline-forward parser on its own: the three client formats it reads,
 * and the blocks it refuses to guess at. The blocks are the fixtures'
 * reproductions of each client's text/plain output (`messages.fixture.ts`
 * names the source of each shape), and the end-to-end cases read them back
 * through the MIME parser, as the ingest seam does.
 */

import { describe, expect, it } from 'vitest';
import { INLINE_FORWARD_FORMATS, parseInlineForward } from './inline-forward.js';
import { parseInboundMessage, participantAddresses } from './parse-message.js';
import {
  appleMailForwardBlock,
  forwardInline,
  gmailForwardBlock,
  outlookForwardBlock,
  rfc822,
} from './messages.fixture.js';

const CUSTOMER_SET = ['customer@acme.test', 'rep@corp.test', 'buyer@acme.test', 'partner@globex.test'];

describe('parseInlineForward — the three client formats', () => {
  it('reads exactly the formats it declares', () => {
    expect([...INLINE_FORWARD_FORMATS]).toEqual(['gmail', 'outlook', 'apple_mail']);
  });

  it('reads a Gmail block: From, To and Cc, in header order', () => {
    expect(parseInlineForward(gmailForwardBlock())).toEqual({
      format: 'gmail',
      participants: {
        from: ['customer@acme.test'],
        sender: [],
        replyTo: [],
        to: ['rep@corp.test'],
        cc: ['buyer@acme.test', 'partner@globex.test'],
      },
    });
  });

  it('reads an Outlook block, its `addr <addr>` To and its `;` Cc list included', () => {
    expect(parseInlineForward(outlookForwardBlock())).toEqual({
      format: 'outlook',
      participants: {
        from: ['customer@acme.test'],
        sender: [],
        replyTo: [],
        to: ['rep@corp.test'],
        cc: ['buyer@acme.test', 'partner@globex.test'],
      },
    });
  });

  it('reads an Apple Mail block through its quote markers, Reply-To included', () => {
    expect(parseInlineForward(appleMailForwardBlock({ replyTo: 'Replies <replies@acme.test>' }))).toEqual({
      format: 'apple_mail',
      participants: {
        from: ['customer@acme.test'],
        sender: [],
        replyTo: ['replies@acme.test'],
        to: ['rep@corp.test'],
        cc: ['buyer@acme.test', 'partner@globex.test'],
      },
    });
  });

  it('reads each format out of a received message body, through the MIME parser', async () => {
    for (const [format, block] of [
      ['gmail', gmailForwardBlock()],
      ['outlook', outlookForwardBlock()],
      ['apple_mail', appleMailForwardBlock()],
    ] as const) {
      const parsed = await parseInboundMessage(forwardInline({ messageId: `<e2e-${format}@corp.test>`, block }));
      const forward = parseInlineForward(parsed.text);
      expect(forward?.format, format).toBe(format);
      expect(participantAddresses(forward!.participants), format).toEqual(CUSTOMER_SET);
    }
  });

  it('control: the same message without the block carries no forward', async () => {
    const parsed = await parseInboundMessage(forwardInline({ messageId: '<e2e-none@corp.test>', block: null }));
    expect(parsed.text).toContain('below');
    expect(parseInlineForward(parsed.text)).toBeNull();
  });

  it('reads the forward the user made, not a forward quoted inside it', () => {
    const nested = gmailForwardBlock({ body: `Forwarding this on.\r\n\r\n${outlookForwardBlock({ from: 'Deep <deep@elsewhere.test>' })}` });
    expect(participantAddresses(parseInlineForward(nested)!.participants)).toEqual(CUSTOMER_SET);
  });
});

describe('parseInlineForward — a block it does not recognise is not guessed at', () => {
  const unrecognised: Array<[string, string]> = [
    ['no separator at all', 'From: Customer <customer@acme.test>\r\nDate: today\r\n\r\nHi'],
    ['a separator followed by prose', '---------- Forwarded message ---------\r\nHere it is.'],
    ['a localized From label (Gmail in German writes `Von:`)', gmailForwardBlock().replace('From: ', 'Von: ')],
    ['a label of another format (`Sent:` in a Gmail block)', gmailForwardBlock().replace('Date: ', 'Sent: ')],
    ['a label no format writes', gmailForwardBlock().replace('Cc: ', 'Bcc: ')],
    ['a label twice', gmailForwardBlock({ cc: null }).replace('Subject: A question', 'To: second@acme.test')],
    ['From not first', gmailForwardBlock().replace(/(From: [^\r]*)\r\n(Date: [^\r]*)/, '$2\r\n$1')],
    ['no date line', gmailForwardBlock().replace(/Date: [^\r]*\r\n/, '')],
    ['a From that names no address', gmailForwardBlock({ from: 'Customer' })],
    ['a wrapped header line', gmailForwardBlock({ cc: 'Buyer <buyer@acme.test>,\r\n  Partner <partner@globex.test>' })],
    ['a Gmail block quoted by a reply', gmailForwardBlock().split('\r\n').map((l) => `> ${l}`).join('\r\n')],
    ['the separator of a client it does not read (Thunderbird)', gmailForwardBlock().replace('---------- Forwarded message ---------', '-------- Forwarded Message --------')],
    ['the separator of a client it does not read (Outlook desktop, plain text)', outlookForwardBlock().replace('________________________________', '-----Original Message-----')],
    ['an Apple Mail separator followed by prose', '> Begin forwarded message:\r\n>\r\n> Have a look.'],
  ];

  for (const [name, text] of unrecognised) {
    it(`answers null for ${name}`, () => {
      expect(parseInlineForward(text)).toBeNull();
    });
  }

  it('the first separator decides: an incomplete block is not skipped to reach a complete one below it', () => {
    const text = `${gmailForwardBlock().replace('From: ', 'Von: ')}\r\n\r\n${outlookForwardBlock()}`;
    expect(parseInlineForward(text)).toBeNull();
    // Control: the complete block alone is read.
    expect(parseInlineForward(outlookForwardBlock())?.format).toBe('outlook');
  });

  it('answers null for an empty or absent body', () => {
    expect(parseInlineForward('')).toBeNull();
    expect(parseInlineForward(null)).toBeNull();
    expect(parseInlineForward(undefined)).toBeNull();
  });

  it('reads the text/plain body only: a message with an HTML body only carries no text to read', async () => {
    const html = `<div>See below.<br><br>${gmailForwardBlock().split('\r\n').join('<br>')}</div>`;
    const parsed = await parseInboundMessage(
      rfc822(
        [
          ['From', 'Rep <rep@corp.test>'],
          ['To', 'inbox@corp.test'],
          ['Message-ID', '<html-only@corp.test>'],
          ['MIME-Version', '1.0'],
          ['Content-Type', 'text/html; charset=utf-8'],
        ],
        html,
      ),
    );
    expect(parsed.html).toContain('Forwarded message');
    expect(parsed.text).toBeNull();
    expect(parseInlineForward(parsed.text)).toBeNull();
  });
});
