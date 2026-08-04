// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// In-process fake ESMTP server + the decoders needed to read what a REAL
// nodemailer put on the wire.
//
// Extracted from `smtp.wire.test.ts` (#5087) when a second suite needed it
// (#5177: proving a message rebuilt from a `sys_email` row reaches the wire
// with the same bytes as the same message sent inline). Shared rather than
// copied on purpose: two hand-written fake servers drift, and the whole value
// of this facility is that nothing stands between the transport and the wire —
// a claim only one implementation can keep making.
//
// Not a test file (`.testkit.ts` ⇒ vitest does not collect it) and not part of
// the published bundle (tsup builds from `src/index.ts`, which never imports
// it).

import net from 'node:net';

export interface FakeSmtp {
  port: number;
  /** Commands the client sent, uppercased verb + raw line. */
  commands: string[];
  /** Raw DATA payloads (headers + body), one per delivered message. */
  messages: string[];
  close(): Promise<void>;
}

/**
 * Minimal ESMTP server: greeting, EHLO, AUTH PLAIN/LOGIN, MAIL/RCPT/DATA/QUIT.
 * Deliberately does NOT advertise STARTTLS — callers connect with
 * `secure: false` so nodemailer stays in the clear against localhost.
 */
export async function startFakeSmtp(opts: { authOk?: boolean } = {}): Promise<FakeSmtp> {
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
export function decodeEncodedWords(input: string): string {
  return input.replace(/=\?utf-8\?(b|q)\?([^?]+)\?=/gi, (_m, enc: string, payload: string) => {
    if (enc.toLowerCase() === 'b') return Buffer.from(payload, 'base64').toString('utf8');
    const bytes = payload
      .replace(/_/g, ' ')
      .replace(/=([0-9A-Fa-f]{2})/g, (_x, hex: string) => String.fromCharCode(parseInt(hex, 16)));
    return Buffer.from(bytes, 'binary').toString('utf8');
  });
}

/** Decode every transfer-encoded body part so the text can be asserted. */
export function decodeBodies(raw: string): string {
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

/** One MIME part of a multipart message, as it appeared on the wire. */
export interface WireMimePart {
  /** Unfolded header block of the part. */
  headers: string;
  /** Raw (still transfer-encoded) body of the part. */
  body: string;
}

/**
 * Split a raw DATA payload into its MIME parts, flattening nested multiparts.
 *
 * The nesting is not incidental: a message with a `cid:` inline image AND a
 * regular attachment comes out as `multipart/mixed` wrapping a
 * `multipart/related`, so a splitter that only knows the outermost boundary
 * simply cannot see the inline image — which is precisely the part a `cid`
 * test is about. Every declared boundary is therefore used at once.
 *
 * Header continuation lines are unfolded so a single
 * `Content-Disposition: attachment; filename*0*=…` can be matched in one go.
 */
export function splitMimeParts(raw: string): WireMimePart[] {
  const boundaries = [...new Set([...raw.matchAll(/boundary="?([^"\r\n;]+)"?/g)].map((m) => m[1]))];
  if (boundaries.length === 0) return [];
  const alternation = boundaries.map((b) => b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const parts: WireMimePart[] = [];
  for (const chunk of raw.split(new RegExp(`--(?:${alternation})(?:--)?`))) {
    const body = chunk.replace(/^\r\n/, '');
    const sep = body.indexOf('\r\n\r\n');
    if (sep === -1) continue;
    parts.push({
      headers: body.slice(0, sep).replace(/\r\n[ \t]+/g, ''),
      body: body.slice(sep + 4).trim(),
    });
  }
  return parts;
}

/**
 * The base64-decoded content of every `Content-Disposition: attachment` /
 * `inline` part, keyed by the decoded filename. This is what "the attachment
 * arrived byte for byte" is asserted against.
 */
export function wireAttachments(raw: string): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  for (const part of splitMimeParts(raw)) {
    if (!/Content-Disposition:\s*(attachment|inline)/i.test(part.headers)) continue;
    // RFC 2231 (`filename*0*=utf-8''%E4%B8%AD`) or an RFC 2047 encoded word.
    const ext = /filename\*\d*\*?=(?:utf-8'')?([^;\r\n]+)/i.exec(part.headers)?.[1];
    const plain = /filename="?([^";\r\n]+)"?/i.exec(part.headers)?.[1];
    const filename = ext
      ? decodeURIComponent(ext)
      : decodeEncodedWords(plain ?? '');
    out.set(filename, Buffer.from(part.body.replace(/\s+/g, ''), 'base64'));
  }
  return out;
}
