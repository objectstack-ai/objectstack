// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// The claim #5177 actually has to make: a message rebuilt from a `sys_email`
// row reaches the wire as the SAME message that would have gone out inline.
//
// Nothing short of a real transport can prove that. A unit test comparing
// `EmailAttachment` objects proves the codec round-trips JS values; it says
// nothing about whether nodemailer then encodes those values into the same
// MIME parts — which is exactly where a plausible-looking shortcut goes wrong
// (restoring a text attachment as a Buffer round-trips the bytes perfectly and
// silently drops `charset=utf-8` from the part header, so the recipient's
// client mis-decodes a UTF-8 file it can no longer identify).
//
// So: REAL nodemailer, in-process fake SMTP (the `smtp.wire.test.ts` facility,
// shared via `fake-smtp.testkit.ts`), and a byte comparison of the DATA
// payload the server received in each mode.

import { describe, it, expect, afterEach } from 'vitest';
import { SmtpTransport } from './transports/smtp.js';
import { startFakeSmtp, wireAttachments, type FakeSmtp } from './transports/fake-smtp.testkit.js';
import { EmailService, normalizeMessage, rowToNormalized, type EmailPersistence } from './email-service.js';
import type { NormalizedEmailMessage, SendEmailInput } from '@objectstack/spec/contracts';

let server: FakeSmtp | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

/** A 1x1 transparent PNG — real binary bytes, including a NUL and 0xFF. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/** The message under test: Chinese filename, a cid inline image, both content forms. */
const MESSAGE: SendEmailInput = {
  to: { name: '收件人', address: 'rcpt@example.test' },
  from: { name: 'ObjectStack 通知', address: 'no-reply@example.test' },
  subject: '【ObjectStack】您的对账单',
  html: '<p>你好 <img src="cid:logo@inline"> 详见附件。</p>',
  text: '你好,详见附件。',
  headers: { 'X-Campaign': 'spring-2026', 'List-Unsubscribe': '<mailto:unsub@example.test>' },
  attachments: [
    // string content — a text part whose charset declaration is load-bearing
    { filename: '对账单.txt', content: '账户:张三\n金额:¥1,234.56\n' },
    // Buffer content with an explicit type + cid — the inline image
    { filename: 'logo.png', content: PNG, contentType: 'image/png', cid: 'logo@inline' },
  ],
};

/** Deliver `msg` through a real SMTP conversation and return the raw DATA payload. */
async function onTheWire(msg: NormalizedEmailMessage): Promise<string> {
  const fake = await startFakeSmtp();
  try {
    const transport = new SmtpTransport({ host: '127.0.0.1', port: fake.port, secure: false, timeout: 5_000 });
    await transport.send(msg);
    await transport.close();
    expect(fake.messages).toHaveLength(1);
    return fake.messages[0];
  } finally {
    await fake.close();
  }
}

/** Capture the row `send()` would persist, without delivering anything. */
async function persistedRow(input: SendEmailInput): Promise<Record<string, any>> {
  let row: Record<string, any> | undefined;
  const persistence: EmailPersistence = {
    async insert(r) { row = { ...r }; return { id: r.id }; },
    async update() { /* not reached: the transport below never succeeds */ },
  };
  const svc = new EmailService({
    transport: { async send() { throw new Error('not delivered in this fixture'); } },
    persistence,
  });
  await svc.send(input);
  if (!row) throw new Error('no row was persisted');
  return row;
}

/**
 * Strip the parts of a MIME message that legitimately differ between two
 * sends: the generated Message-ID, the Date, and the multipart boundaries.
 */
function stable(raw: string): string {
  const boundaries = [...raw.matchAll(/boundary="?([^"\r\n;]+)"?/g)].map((m) => m[1]);
  let out = raw
    .replace(/^Message-ID:.*$/gim, 'Message-ID: <stable>')
    .replace(/^Date:.*$/gim, 'Date: <stable>');
  boundaries.forEach((b, i) => { out = out.split(b).join(`<boundary-${i}>`); });
  return out;
}

describe('a message rebuilt from a sys_email row reaches the wire unchanged (#5177)', () => {
  it('produces a byte-identical MIME message, inline vs row round trip', async () => {
    const row = await persistedRow(MESSAGE);
    // The row really is carrying the parts — not silently dropping them.
    expect(row.headers_json).toBeTruthy();
    expect(row.attachments_json).toBeTruthy();

    // Normalized the same way `send()` normalizes it, so the ONLY difference
    // under test is the trip through the row.
    const direct = await onTheWire(normalizeMessage(MESSAGE));
    const viaRow = await onTheWire(rowToNormalized(row));

    expect(stable(viaRow)).toBe(stable(direct));
  }, 30_000);

  it('delivers both attachments byte for byte, with the Chinese filename intact', async () => {
    const row = await persistedRow(MESSAGE);
    const raw = await onTheWire(rowToNormalized(row));

    const parts = wireAttachments(raw);
    expect([...parts.keys()].sort()).toEqual(['logo.png', '对账单.txt']);
    expect(Buffer.compare(parts.get('logo.png')!, PNG)).toBe(0);
    expect(parts.get('对账单.txt')!.toString('utf8')).toBe('账户:张三\n金额:¥1,234.56\n');
  }, 30_000);

  it('keeps the text attachment declared as UTF-8 — the reason contentForm exists', async () => {
    const row = await persistedRow(MESSAGE);
    const raw = await onTheWire(rowToNormalized(row));

    const textPart = raw
      .split(/--[-_A-Za-z0-9]{10,}/)
      .find((p) => /filename\*0\*=utf-8''%E5%AF%B9/i.test(p.replace(/\r\n[ \t]+/g, '')));
    expect(textPart).toBeTruthy();
    expect(textPart!.replace(/\r\n[ \t]+/g, '')).toMatch(/Content-Type:\s*text\/plain;\s*charset=utf-8/i);
  }, 30_000);

  it('carries the custom headers and the cid the HTML body references', async () => {
    const row = await persistedRow(MESSAGE);
    const raw = await onTheWire(rowToNormalized(row));
    const unfolded = raw.replace(/\r\n[ \t]+/g, ' ');

    expect(unfolded).toMatch(/^X-Campaign: spring-2026$/m);
    expect(unfolded).toMatch(/^List-Unsubscribe: <mailto:unsub@example\.test>$/m);
    // Without the cid the inline <img> resolves to nothing.
    expect(unfolded).toMatch(/Content-ID: <logo@inline>/);
  }, 30_000);
});
