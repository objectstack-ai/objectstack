// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';
import { messageIdsOf, parseInboundMessage, participantAddresses, rawHeaderBlockOf } from './parse-message.js';
import {
  collectMatchAddresses,
  normalizeMailAddress,
  parseMatchAddresses,
  serializeMatchAddresses,
} from './match-addresses.js';
import { forwardAsAttachment, plainMessage, rfc822 } from './messages.fixture.js';

const ORIGINAL = rfc822(
  [
    ['From', 'Customer <Customer@Acme.test>'],
    ['To', 'Rep <rep@corp.test>'],
    ['Cc', 'Buyer <buyer@acme.test>'],
    ['Subject', 'A question'],
    ['Message-ID', '<orig-1@acme.test>'],
  ],
  'What does it cost?',
);

describe('parseInboundMessage — the participants of the received message (source `outer`)', () => {
  it('reads every address of From, Sender, Reply-To, To and Cc, display names, groups and folding included', async () => {
    const parsed = await parseInboundMessage(
      rfc822(
        [
          ['From', '"Doe, Jane" <jane@acme.test>, john@acme.test'],
          ['Sender', 'assistant@acme.test'],
          ['Reply-To', 'replies@acme.test'],
          ['To', 'Sales Inbox <inbox@corp.test>,\r\n  =?utf-8?B?5byg5LiJ?= <zhang@acme.test>'],
          ['Cc', 'Team: one@acme.test, two@acme.test;'],
          ['Message-ID', '<m-1@acme.test>'],
        ],
        'Body',
      ),
    );
    expect(parsed.outer).toEqual({
      from: ['jane@acme.test', 'john@acme.test'],
      sender: ['assistant@acme.test'],
      replyTo: ['replies@acme.test'],
      to: ['inbox@corp.test', 'zhang@acme.test'],
      cc: ['one@acme.test', 'two@acme.test'],
    });
    expect(participantAddresses(parsed.outer)).toEqual([
      'jane@acme.test', 'john@acme.test', 'assistant@acme.test', 'replies@acme.test',
      'inbox@corp.test', 'zhang@acme.test', 'one@acme.test', 'two@acme.test',
    ]);
    expect(parsed.fromName).toBe('Doe, Jane');
  });

  it('reads the threading ids with their angle brackets stripped', async () => {
    const parsed = await parseInboundMessage(
      plainMessage({ 'In-Reply-To': '<a@acme.test>', References: '<root@acme.test>\r\n <a@acme.test>' }),
    );
    expect(parsed.messageId).toBe('plain-1@acme.test');
    expect(parsed.inReplyTo).toEqual(['a@acme.test']);
    expect(parsed.references).toEqual(['root@acme.test', 'a@acme.test']);
    expect(messageIdsOf('bare-token other-token')).toEqual(['bare-token', 'other-token']);
    expect(messageIdsOf(null)).toEqual([]);
  });

  it('reads the subject with its encoded words decoded, the text body and the Date as an ISO timestamp', async () => {
    const parsed = await parseInboundMessage(plainMessage({ Subject: '=?utf-8?Q?Caf=C3=A9_order?=' }, 'Line one'));
    expect(parsed.subject).toBe('Café order');
    expect(parsed.text?.trim()).toBe('Line one');
    expect(parsed.sentAt).toBe('2026-10-12T09:00:00.000Z');
  });

  it('keeps the header block exactly as received, up to the first empty line', () => {
    const raw = 'From: a@acme.test\r\nSubject: x\r\n\r\nbody\r\n\r\nmore';
    expect(rawHeaderBlockOf(raw)).toBe('From: a@acme.test\r\nSubject: x');
    expect(rawHeaderBlockOf(new TextEncoder().encode(raw))).toBe('From: a@acme.test\r\nSubject: x');
  });
});

describe('parseInboundMessage — a message forwarded as an attachment (source `attachment`)', () => {
  it("reads the headers of a top-level message/rfc822 part as the forwarded message's participants", async () => {
    const parsed = await parseInboundMessage(forwardAsAttachment({ original: ORIGINAL }));
    expect(parsed.outer.from).toEqual(['rep@corp.test']);
    expect(parsed.forwarded).toHaveLength(1);
    expect(participantAddresses(parsed.forwarded[0]!)).toEqual(['Customer@Acme.test', 'rep@corp.test', 'buyer@acme.test']);
    expect(parsed.unreadForwardedParts).toBe(0);
    // The forwarded message is not folded into the received message's own text.
    expect(parsed.text).not.toContain('What does it cost?');
  });

  it('does not read a forward nested inside the forwarded part', async () => {
    const nested = forwardAsAttachment({
      forwarder: 'Customer <customer@acme.test>',
      to: 'rep@corp.test',
      messageId: '<inner-fwd@acme.test>',
      original: rfc822([['From', 'deep@elsewhere.test'], ['Message-ID', '<deep@elsewhere.test>']], 'deep'),
    });
    const parsed = await parseInboundMessage(forwardAsAttachment({ original: nested }));
    expect(parsed.forwarded).toHaveLength(1);
    expect(participantAddresses(parsed.forwarded[0]!)).toEqual(['customer@acme.test', 'rep@corp.test']);
  });

  it('control: a forward quoted inline in the body names no forwarded participants (that is the `inline` source)', async () => {
    const parsed = await parseInboundMessage(
      plainMessage(
        { From: 'Rep <rep@corp.test>' },
        '---------- Forwarded message ---------\r\nFrom: Customer <customer@acme.test>\r\nTo: rep@corp.test\r\n\r\nHi',
      ),
    );
    expect(parsed.forwarded).toEqual([]);
    expect(participantAddresses(parsed.outer)).toEqual(['rep@corp.test', 'inbox@corp.test']);
  });
});

describe('the participant set (`match_addresses`)', () => {
  it('normalizes ASCII letters only, and refuses what is not an addr-spec', () => {
    expect(normalizeMailAddress('  Jane.DOE@Acme.TEST ')).toBe('jane.doe@acme.test');
    expect(normalizeMailAddress('Ünïcode@Acme.test')).toBe('Ünïcode@acme.test');
    for (const bad of ['', 'no-at-sign', '@acme.test', 'jane@', 'a b@acme.test', 42, null, `${'x'.repeat(320)}@a.t`]) {
      expect(normalizeMailAddress(bad), String(bad)).toBeNull();
    }
  });

  it('lists outer addresses first, drops the mailbox own address, and keeps each (address, source) pair once', () => {
    const set = collectMatchAddresses(
      [
        { source: 'outer', addresses: ['Rep@Corp.test', 'INBOX@corp.test', 'rep@corp.test', 'nonsense'] },
        { source: 'attachment', addresses: ['customer@acme.test', 'rep@corp.test', 'Inbox@Corp.Test'] },
      ],
      ['inbox@corp.test'],
    );
    expect(set).toEqual([
      { address: 'rep@corp.test', source: 'outer' },
      { address: 'customer@acme.test', source: 'attachment' },
      { address: 'rep@corp.test', source: 'attachment' },
    ]);
  });

  it('round-trips through its stored spelling, and accepts the declared `inline` source a later parser writes', () => {
    const set = [
      { address: 'a@acme.test', source: 'outer' as const },
      { address: 'b@acme.test', source: 'inline' as const },
    ];
    expect(parseMatchAddresses(serializeMatchAddresses(set))).toEqual(set);
    expect(parseMatchAddresses(null)).toEqual([]);
    expect(parseMatchAddresses('')).toEqual([]);
  });

  it('refuses a stored value that is not the stored shape rather than guessing at it', () => {
    for (const bad of [
      'a@acme.test',
      '{"address":"a@acme.test","source":"outer"}',
      '[{"address":"a@acme.test"}]',
      '[{"address":"a@acme.test","source":"body"}]',
      '[{"address":"A@acme.test","source":"outer"}]',
      '[{"address":"a@acme.test","source":"outer","extra":1}]',
      '[null]',
      42,
    ]) {
      expect(parseMatchAddresses(bad), String(bad)).toBeNull();
    }
  });
});
