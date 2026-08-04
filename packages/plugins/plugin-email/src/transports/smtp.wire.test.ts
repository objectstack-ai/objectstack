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
import net from 'node:net';
import { SmtpTransport } from './smtp.js';

interface FakeSmtp {
  port: number;
  /** Commands the client sent, uppercased verb + raw line. */
  commands: string[];
  /** Raw DATA payloads (headers + body), one per delivered message. */
  messages: string[];
  close(): Promise<void>;
}

/**
 * Minimal ESMTP server: greeting, EHLO, AUTH PLAIN/LOGIN, MAIL/RCPT/DATA/QUIT.
 * Deliberately does NOT advertise STARTTLS — the tests connect with
 * `secure: false` so nodemailer stays in the clear against localhost.
 */
async function startFakeSmtp(opts: { authOk?: boolean } = {}): Promise<FakeSmtp> {
  const authOk = opts.authOk !== false;
  const commands: string[] = [];
  const messages: string[] = [];

  const server = net.createServer((socket) => {
    let buffer = '';
    let inData = false;
    let dataBuf = '';
    socket.setEncoding('utf8');
    socket.write('220 fake.smtp.test ESMTP ready\r\n');

    socket.on('data', (chunk: string) => {
      if (inData) {
        dataBuf += chunk;
        const end = dataBuf.indexOf('\r\n.\r\n');
        if (end === -1) return;
        messages.push(dataBuf.slice(0, end));
        dataBuf = '';
        inData = false;
        socket.write('250 2.0.0 Ok: queued as FAKE123\r\n');
        return;
      }
      buffer += chunk;
      let idx: number;
      while ((idx = buffer.indexOf('\r\n')) !== -1) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        commands.push(line);
        const verb = line.split(/[ :]/)[0].toUpperCase();
        if (verb === 'EHLO' || verb === 'HELO') {
          socket.write('250-fake.smtp.test\r\n250-AUTH PLAIN LOGIN\r\n250 SMTPUTF8\r\n');
        } else if (verb === 'AUTH') {
          if (/LOGIN/i.test(line)) {
            // LOGIN is a 3-step challenge; accept/deny at the end.
            socket.write('334 VXNlcm5hbWU6\r\n');
          } else {
            socket.write(authOk ? '235 2.7.0 Accepted\r\n' : '535 5.7.8 Error: authentication failed\r\n');
          }
        } else if (/^[A-Za-z0-9+/=]+$/.test(line) && commands.some((c) => /^AUTH LOGIN/i.test(c))) {
          // base64 continuation of AUTH LOGIN (username, then password)
          const step = commands.filter((c) => /^[A-Za-z0-9+/=]+$/.test(c)).length;
          if (step === 1) socket.write('334 UGFzc3dvcmQ6\r\n');
          else socket.write(authOk ? '235 2.7.0 Accepted\r\n' : '535 5.7.8 Error: authentication failed\r\n');
        } else if (verb === 'MAIL' || verb === 'RCPT') {
          socket.write('250 2.1.0 Ok\r\n');
        } else if (verb === 'DATA') {
          inData = true;
          socket.write('354 End data with <CR><LF>.<CR><LF>\r\n');
        } else if (verb === 'QUIT') {
          socket.write('221 2.0.0 Bye\r\n');
          socket.end();
        } else {
          socket.write('250 2.0.0 Ok\r\n');
        }
      }
    });
    socket.on('error', () => { /* client hung up */ });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as net.AddressInfo).port;
  return {
    port,
    commands,
    messages,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** Decode an RFC 2047 encoded-word run (`=?UTF-8?B?..?=` / `?Q?..?=`). */
function decodeEncodedWords(input: string): string {
  return input.replace(/=\?utf-8\?(b|q)\?([^?]+)\?=/gi, (_m, enc: string, payload: string) => {
    if (enc.toLowerCase() === 'b') return Buffer.from(payload, 'base64').toString('utf8');
    const bytes = payload
      .replace(/_/g, ' ')
      .replace(/=([0-9A-Fa-f]{2})/g, (_x, hex: string) => String.fromCharCode(parseInt(hex, 16)));
    return Buffer.from(bytes, 'binary').toString('utf8');
  });
}

/** Decode every transfer-encoded body part so the text can be asserted. */
function decodeBodies(raw: string): string {
  const out: string[] = [raw];
  // quoted-printable
  out.push(Buffer.from(
    raw.replace(/=\r?\n/g, '').replace(/=([0-9A-Fa-f]{2})/g, (_m, hex: string) => String.fromCharCode(parseInt(hex, 16))),
    'binary',
  ).toString('utf8'));
  // base64 blocks (4+ full base64 lines in a row)
  for (const block of raw.match(/(?:^[A-Za-z0-9+/=]{20,}\r?\n?){1,}/gm) ?? []) {
    out.push(Buffer.from(block.replace(/\s+/g, ''), 'base64').toString('utf8'));
  }
  return out.join('\n');
}

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
