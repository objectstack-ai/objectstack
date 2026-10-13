// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';
import { parseInboundMessage } from './parse-message.js';
import { suppressionReasonOf } from './suppression.js';
import { dedupeKeyOf } from './dedupe-key.js';
import { bounce, plainMessage, rfc822 } from './messages.fixture.js';

const reasonFor = async (raw: string) => suppressionReasonOf(await parseInboundMessage(raw));

describe('automatic-mail suppression', () => {
  it('control: a message a correspondent wrote is not suppressed', async () => {
    expect(await reasonFor(plainMessage())).toBeNull();
  });

  it.each([
    ['Auto-Submitted', 'auto-replied', 'auto_submitted'],
    ['Auto-Submitted', 'auto-generated (vacation)', 'auto_submitted'],
    ['Auto-Submitted', 'Auto-Notified; owner-email="a@acme.test"', 'auto_submitted'],
    ['Precedence', 'bulk', 'precedence'],
    ['Precedence', 'Junk', 'precedence'],
    ['Precedence', 'list', 'precedence'],
    ['X-Autoreply', 'yes', 'autoreply_header'],
    ['X-Autorespond', 'Out of office', 'autoreply_header'],
  ])('%s: %s is suppressed as %s', async (name, value, reason) => {
    expect(await reasonFor(plainMessage({ [name]: value }))).toBe(reason);
  });

  it.each([
    ['Auto-Submitted', 'no'],
    ['Precedence', 'first-class'],
    ['X-Autoreply', 'no'],
    ['X-Autorespond', 'false'],
  ])('control: %s: %s is not suppressed', async (name, value) => {
    expect(await reasonFor(plainMessage({ [name]: value }))).toBeNull();
  });

  it('a delivery-status report (a bounce) is suppressed', async () => {
    expect(await reasonFor(bounce())).toBe('delivery_report');
  });

  it('control: a multipart/report of another report type is not read as a bounce', async () => {
    const receipt = rfc822(
      [
        ['From', 'customer@acme.test'],
        ['Message-ID', '<mdn-1@acme.test>'],
        ['MIME-Version', '1.0'],
        ['Content-Type', 'multipart/report; report-type=disposition-notification; boundary="r"'],
      ],
      '--r\r\nContent-Type: text/plain\r\n\r\nRead.\r\n--r--\r\n',
    );
    expect(await reasonFor(receipt)).toBeNull();
  });
});

describe('the dedupe key', () => {
  it('is the Message-ID identity, prefixed `mid:`, whatever the brackets', async () => {
    const a = await dedupeKeyOf({ messageId: 'x@acme.test', rawHeaderBlock: 'one' });
    const b = await dedupeKeyOf({ messageId: ' x@acme.test ', rawHeaderBlock: 'two' });
    expect(a).toBe(b);
    expect(a).toMatch(/^mid:[0-9a-f]{64}$/);
    expect(await dedupeKeyOf({ messageId: 'y@acme.test', rawHeaderBlock: 'one' })).not.toBe(a);
  });

  it('falls back to the header block as received, prefixed `hdr:`, for a message with no Message-ID', async () => {
    const a = await dedupeKeyOf({ messageId: null, rawHeaderBlock: 'From: a@acme.test\r\nDate: x' });
    expect(a).toMatch(/^hdr:[0-9a-f]{64}$/);
    expect(await dedupeKeyOf({ messageId: '', rawHeaderBlock: 'From: a@acme.test\r\nDate: x' })).toBe(a);
    expect(await dedupeKeyOf({ messageId: null, rawHeaderBlock: 'From: a@acme.test\r\nDate: y' })).not.toBe(a);
    expect(a.length).toBeLessThanOrEqual(128);
  });
});
