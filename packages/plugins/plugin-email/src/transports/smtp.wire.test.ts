// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.
//
// SmtpTransport against a REAL nodemailer talking to an in-process fake SMTP
// server (#5087). No network leaves the box and no mock stands between the
// transport and the wire, so this is the only place that can prove:
//
//   * the SMTP conversation actually happens (EHLO / AUTH / MAIL / RCPT / DATA);
//   * a Chinese subject is RFC 2047 encoded and a Chinese HTML body survives
//     the transfer encoding — the encoding a hand-rolled SMTP client gets
//     wrong quietly, which is why ADR-0012 says nodemailer;
//   * an AUTH rejection (535) reaches the caller instead of being swallowed.

import { describe, it, expect, afterEach } from 'vitest';
import { SmtpTransport } from './smtp.js';
// The fake server + wire decoders live in a testkit since #5177, so the
// sys_email round-trip suite proves itself against the SAME wire, not a second
// hand-written copy of it.
import { startFakeSmtp, decodeEncodedWords, decodeBodies, type FakeSmtp } from './fake-smtp.testkit.js';

let server: FakeSmtp | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

describe('SmtpTransport over a real SMTP conversation', () => {
  it('delivers through EHLO/AUTH/MAIL/RCPT/DATA and returns the server response', async () => {
    server = await startFakeSmtp();
    const transport = new SmtpTransport({
      host: '127.0.0.1',
      port: server.port,
      secure: false,
      user: 'ops@example.test',
      password: 'sekrit',
      timeout: 5_000,
    });

    const res = await transport.send({
      to: ['rcpt@example.test'],
      from: 'ObjectStack <no-reply@example.test>',
      subject: 'Hello',
      text: 'plain',
    });
    await transport.close();

    expect(res.messageId).toMatch(/@/);
    expect(res.response).toContain('250');
    expect(server.commands.some((c) => /^EHLO /i.test(c))).toBe(true);
    expect(server.commands.some((c) => /^AUTH /i.test(c))).toBe(true);
    expect(server.commands.some((c) => /^MAIL FROM:<no-reply@example\.test>/i.test(c))).toBe(true);
    expect(server.commands.some((c) => /^RCPT TO:<rcpt@example\.test>/i.test(c))).toBe(true);
    expect(server.messages).toHaveLength(1);
  }, 20_000);

  it('encodes a Chinese subject (RFC 2047) and a Chinese HTML body', async () => {
    server = await startFakeSmtp();
    const transport = new SmtpTransport({
      host: '127.0.0.1',
      port: server.port,
      secure: false,
      timeout: 5_000,
    });

    await transport.send({
      to: ['收件人 <rcpt@example.test>'],
      from: 'ObjectStack 通知 <no-reply@example.test>',
      subject: '【ObjectStack】您的验证码',
      html: '<p>你好,世界 — 这是一封测试邮件。</p>',
      text: '你好,世界 — 这是一封测试邮件。',
    });
    await transport.close();

    const raw = server.messages[0];
    expect(raw).toBeTruthy();
    // Unfold first: a long encoded subject is split across continuation
    // lines, and adjacent encoded-words rejoin without whitespace.
    const headerLines = raw.replace(/\r\n[ \t]+/g, '').split('\r\n');

    // The header must not carry raw non-ASCII bytes...
    const subjectLine = headerLines.find((l) => l.startsWith('Subject:'))!;
    expect(subjectLine).not.toContain('您的验证码');
    // ...and must decode back to exactly what was sent.
    expect(decodeEncodedWords(subjectLine.replace(/^Subject:\s*/, '')))
      .toContain('【ObjectStack】您的验证码');
    // Display names travel as encoded words too.
    expect(decodeEncodedWords(headerLines.find((l) => l.startsWith('To:'))!)).toContain('收件人');

    const decoded = decodeBodies(raw);
    expect(decoded).toContain('你好,世界');
    expect(decoded).toContain('<p>你好,世界 — 这是一封测试邮件。</p>');
    expect(raw.toLowerCase()).toContain('charset=utf-8');
  }, 20_000);

  it('fails loudly when the server rejects the credentials', async () => {
    server = await startFakeSmtp({ authOk: false });
    const transport = new SmtpTransport({
      host: '127.0.0.1',
      port: server.port,
      secure: false,
      user: 'ops@example.test',
      password: 'wrong',
      timeout: 5_000,
    });

    await expect(transport.send({
      to: ['rcpt@example.test'],
      from: 'no-reply@example.test',
      subject: 'Hello',
      text: 'plain',
    })).rejects.toThrow(/535|[Ii]nvalid login|authentication/);
    await transport.close();
    expect(server.messages).toHaveLength(0);
  }, 20_000);
});
