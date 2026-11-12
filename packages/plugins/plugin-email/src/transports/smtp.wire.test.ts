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

import net from 'node:net';
import http from 'node:http';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { describe, it, expect, afterEach } from 'vitest';
import type { NormalizedEmailMessage } from '@objectstack/spec/contracts';
import { SmtpTransport, SMTP_CONNECT_POLICY_NO_SOCKET, type SmtpConnectPolicy } from './smtp.js';
// The fake server + wire decoders live in a testkit since #5177, so the
// sys_email round-trip suite proves itself against the SAME wire, not a second
// hand-written copy of it.
import { startFakeSmtp, decodeEncodedWords, decodeBodies, wireAttachments, type FakeSmtp } from './fake-smtp.testkit.js';

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

// A host's connect policy, against the real library: nodemailer asks the
// policy for every connection, a refusal fails the send in the policy's own
// words, and an admitted connection is the socket the policy opened.
describe('SmtpTransport — a host connect policy over a real SMTP conversation', () => {
  /** Admit by opening the socket to the configured host and port, and record each request. */
  function admitting() {
    const seen: Array<{ host?: string; port?: number }> = [];
    const connect: SmtpConnectPolicy = {
      getSocket(request, callback) {
        seen.push({ host: request.host, port: request.port });
        const socket = net.connect(Number(request.port), String(request.host));
        const onError = (err: Error) => callback(err);
        socket.once('error', onError);
        socket.once('connect', () => {
          socket.removeListener('error', onError);
          callback(null, { connection: socket });
        });
      },
    };
    return { connect, seen };
  }

  const SEND = { to: ['rcpt@example.test'], from: 'no-reply@example.test', subject: 'Hello', text: 'plain' };

  it('fails the send with the policy\'s own words, and the server is never reached', async () => {
    server = await startFakeSmtp();
    const connect: SmtpConnectPolicy = {
      getSocket(_request, callback) { callback(new Error('the host does not allow this destination')); },
    };
    const transport = new SmtpTransport({ host: '127.0.0.1', port: server.port, secure: false, timeout: 5_000, connect });
    await expect(transport.send(SEND)).rejects.toThrow('the host does not allow this destination');
    await transport.close();
    expect(server.connections).toBe(0);
    expect(server.commands).toEqual([]);
    expect(server.messages).toHaveLength(0);
  }, 20_000);

  it.each([
    ['false', false],
    ['undefined', undefined],
    ['an object without a connection', {}],
  ] as const)('an answer without a socket (%s) fails the send, and the server is never reached', async (_label, answer) => {
    server = await startFakeSmtp();
    const connect: SmtpConnectPolicy = {
      getSocket(_request, callback) { (callback as (e: Error | null, s?: unknown) => void)(null, answer); },
    };
    const transport = new SmtpTransport({ host: '127.0.0.1', port: server.port, secure: false, timeout: 5_000, connect });
    await expect(transport.send(SEND)).rejects.toThrow(SMTP_CONNECT_POLICY_NO_SOCKET);
    await transport.close();
    expect(server.connections).toBe(0);
    expect(server.messages).toHaveLength(0);
  }, 20_000);

  it('delivers over the socket the policy admitted, asked with the configured host and port', async () => {
    server = await startFakeSmtp();
    const { connect, seen } = admitting();
    const transport = new SmtpTransport({ host: '127.0.0.1', port: server.port, secure: false, timeout: 5_000, connect });
    const res = await transport.send(SEND);
    await transport.close();
    expect(res.response).toContain('250');
    expect(server.messages).toHaveLength(1);
    expect(seen).toEqual([{ host: '127.0.0.1', port: server.port }]);
  }, 20_000);

  it('asks the policy once per connection: twice for two sends on a non-pooled transport', async () => {
    server = await startFakeSmtp();
    const { connect, seen } = admitting();
    const transport = new SmtpTransport({ host: '127.0.0.1', port: server.port, secure: false, timeout: 5_000, connect });
    await transport.send(SEND);
    await transport.send(SEND);
    await transport.close();
    expect(server.messages).toHaveLength(2);
    expect(seen).toEqual([
      { host: '127.0.0.1', port: server.port },
      { host: '127.0.0.1', port: server.port },
    ]);
  }, 20_000);

  it('still asks the policy on a pooled transport', async () => {
    server = await startFakeSmtp();
    const { connect, seen } = admitting();
    const transport = new SmtpTransport({
      host: '127.0.0.1', port: server.port, secure: false, timeout: 5_000, connect,
      transportOptions: { pool: true },
    });
    await transport.send(SEND);
    await transport.close();
    expect(server.messages).toHaveLength(1);
    expect(seen.length).toBeGreaterThanOrEqual(1);
    expect(seen[0]).toEqual({ host: '127.0.0.1', port: server.port });
  }, 20_000);

  it('a getSocket in transportOptions is never asked in the policy\'s place', async () => {
    server = await startFakeSmtp();
    const { connect, seen } = admitting();
    let otherAsked = 0;
    const transport = new SmtpTransport({
      host: '127.0.0.1', port: server.port, secure: false, timeout: 5_000, connect,
      transportOptions: {
        getSocket: (_o: unknown, cb: (err: Error | null) => void) => { otherAsked += 1; cb(new Error('not this one')); },
      },
    });
    await transport.send(SEND);
    await transport.close();
    expect(otherAsked).toBe(0);
    expect(seen).toHaveLength(1);
    expect(server.messages).toHaveLength(1);
  }, 20_000);
});

describe('SmtpTransport — a message\'s content reaches the wire only as a string or as bytes', () => {
  // `SmtpTransport.send()` is driven directly, past the type: `normalizeMessage`
  // refuses these shapes first, so this pins the transport on its own.
  // The fixtures are a temp file this test writes and a loopback listener it
  // owns; no system path, no other host.
  const MARK = `canary-${randomBytes(6).toString('hex')}`;
  const FILE_BYTES = `file-${MARK}`;
  const URL_BYTES = `url-${MARK}`;

  let dir: string | undefined;
  let listener: http.Server | undefined;
  let requests = 0;

  afterEach(async () => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = undefined;
    if (listener) await new Promise<void>((resolve) => listener!.close(() => resolve()));
    listener = undefined;
    requests = 0;
  });

  async function fixtures(): Promise<{ file: string; url: string }> {
    dir = mkdtempSync(join(tmpdir(), 'os-smtp-content-'));
    const file = join(dir, 'canary.txt');
    writeFileSync(file, FILE_BYTES);
    listener = http.createServer((_req, res) => { requests += 1; res.end(URL_BYTES); });
    await new Promise<void>((resolve) => listener!.listen(0, '127.0.0.1', () => resolve()));
    const { port } = listener.address() as net.AddressInfo;
    return { file, url: `http://127.0.0.1:${port}/canary` };
  }

  /** True when `payload` carries either canary, raw or base64-encoded. */
  function carriesCanary(payload: string): boolean {
    return [FILE_BYTES, URL_BYTES].some(
      (text) => payload.includes(text) || payload.includes(Buffer.from(text).toString('base64')),
    );
  }

  function messageWith(content: unknown): NormalizedEmailMessage {
    return {
      to: ['rcpt@example.test'],
      from: 'no-reply@example.test',
      subject: 'content',
      text: 'see attachment',
      attachments: [{ filename: 'canary.txt', content: content as string }],
    };
  }

  /**
   * A nodemailer plugin transport supplied through `transportOptions`: it
   * renders the message and records the bytes, and opens no connection.
   */
  function pluginTransport(rendered: string[]) {
    return {
      name: 'record',
      version: '1',
      send(mail: any, callback: (err: Error | null, info?: unknown) => void) {
        let done = false;
        const finish = (err: Error | null, info?: unknown) => { if (!done) { done = true; callback(err, info); } };
        const chunks: Buffer[] = [];
        const stream = mail.message.createReadStream();
        stream.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
        stream.on('error', (err: Error) => { rendered.push(Buffer.concat(chunks).toString('utf8')); finish(err); });
        stream.on('end', () => {
          rendered.push(Buffer.concat(chunks).toString('utf8'));
          finish(null, { messageId: '<record@example.test>', response: 'recorded' });
        });
      },
    };
  }

  for (const shape of ['path', 'href'] as const) {
    for (const leg of ['the SMTP transport', 'the SMTP transport with transportOptions turning the flags off'] as const) {
      it(`content \`{ ${shape} }\` over ${leg}: the send rejects, and the transport reads no file and fetches no URL`, async () => {
        const { file, url } = await fixtures();
        server = await startFakeSmtp();
        const transport = new SmtpTransport({
          host: '127.0.0.1',
          port: server.port,
          secure: false,
          timeout: 5_000,
          ...(leg === 'the SMTP transport' ? {} : {
            transportOptions: { disableFileAccess: false, disableUrlAccess: false },
          }),
        });

        await expect(transport.send(messageWith(shape === 'path' ? { path: file } : { href: url }))).rejects.toThrow();
        await transport.close();

        expect(server.messages.some(carriesCanary)).toBe(false);
        expect(requests).toBe(0);
      }, 20_000);
    }

    it(`content \`{ ${shape} }\` over a transportOptions plugin transport: the send rejects, and the transport reads no file and fetches no URL`, async () => {
      const { file, url } = await fixtures();
      const rendered: string[] = [];
      const transport = new SmtpTransport({
        host: 'smtp.example.test',
        transportOptions: { ...pluginTransport(rendered), disableFileAccess: false, disableUrlAccess: false },
      });

      await expect(transport.send(messageWith(shape === 'path' ? { path: file } : { href: url }))).rejects.toThrow();
      await transport.close();

      expect(rendered.some(carriesCanary)).toBe(false);
      expect(requests).toBe(0);
    });
  }

  it('CONTROL — the plugin transport leg can see attachment bytes: a string attachment renders', async () => {
    const rendered: string[] = [];
    const transport = new SmtpTransport({ host: 'smtp.example.test', transportOptions: pluginTransport(rendered) });

    await transport.send(messageWith(FILE_BYTES));

    expect(rendered).toHaveLength(1);
    expect(carriesCanary(rendered[0]!)).toBe(true);
  });

  it('CONTROL — a Buffer attachment with a cid still arrives inline, bytes intact', async () => {
    server = await startFakeSmtp();
    const transport = new SmtpTransport({ host: '127.0.0.1', port: server.port, secure: false, timeout: 5_000 });
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]);

    await transport.send({
      to: ['rcpt@example.test'],
      from: 'no-reply@example.test',
      subject: 'inline',
      html: '<img src="cid:logo@inline">',
      attachments: [{ filename: 'logo.png', content: bytes, contentType: 'image/png', cid: 'logo@inline' }],
    });
    await transport.close();

    expect(server.messages).toHaveLength(1);
    expect(server.messages[0]).toMatch(/Content-ID: <logo@inline>/i);
    expect(wireAttachments(server.messages[0]!).get('logo.png')?.equals(bytes)).toBe(true);
  }, 20_000);
});
