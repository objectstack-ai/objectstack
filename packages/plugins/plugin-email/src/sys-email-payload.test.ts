// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// `sys_email.headers_json` / `attachments_json` — the codec and the row
// round trip (#5177).
//
// What these pin, in one sentence each:
//  - a message's headers and attachments survive the trip through a row, in
//    the SAME JS shapes the EmailAttachment contract declares;
//  - a row written before these columns existed still reads;
//  - a column that is present but does not describe what it claims is
//    REJECTED, never silently reduced to a message missing a part.

import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import {
  SYS_EMAIL_ATTACHMENT_LIMIT_BYTES,
  encodeAttachmentsForRow,
  decodeAttachmentsFromRow,
  encodeHeadersForRow,
  decodeHeadersFromRow,
  type PersistedEmailAttachment,
} from './sys-email-payload.js';
import { rowToNormalized } from './email-service.js';

const sha = (b: Buffer | string) => `sha256:${createHash('sha256').update(b).digest('hex')}`;

/** The minimum a row needs before `rowToNormalized` will look at anything else. */
const baseRow = {
  id: 'row-1',
  from_address: 'no-reply@example.test',
  to_addresses: 'user@example.test',
  subject: 'Hi',
  body_text: 'hello',
};

/** Encode → column value, as `send()` would write it. */
function column(attachments: Parameters<typeof encodeAttachmentsForRow>[0]): string {
  const encoded = encodeAttachmentsForRow(attachments);
  if (encoded.kind !== 'inline') throw new Error(`expected inline, got ${encoded.kind}`);
  return encoded.json;
}

describe('attachments_json — encode', () => {
  it('records size, a tagged hash, the cid, and base64 content', () => {
    const json = column([
      { filename: 'invoice.pdf', content: Buffer.from([1, 2, 3]), contentType: 'application/pdf' },
      { filename: 'logo.png', content: Buffer.from('png'), cid: 'logo@inline' },
    ]);

    expect(JSON.parse(json)).toEqual([
      {
        filename: 'invoice.pdf',
        contentType: 'application/pdf',
        size: 3,
        hash: sha(Buffer.from([1, 2, 3])),
        contentForm: 'buffer',
        inline: Buffer.from([1, 2, 3]).toString('base64'),
      },
      {
        filename: 'logo.png',
        size: 3,
        hash: sha(Buffer.from('png')),
        cid: 'logo@inline',
        contentForm: 'buffer',
        inline: Buffer.from('png').toString('base64'),
      },
    ] satisfies PersistedEmailAttachment[]);
  });

  it('does NOT invent a contentType the sender never supplied', () => {
    // Writing `application/octet-stream` here would make a queued `.txt`
    // arrive as a binary blob while the same message delivered inline arrives
    // as text/plain — the transport infers from the filename when we say
    // nothing, and the two paths must agree.
    const [item] = JSON.parse(column([{ filename: 'notes.txt', content: 'hi' }]));
    expect(item).not.toHaveProperty('contentType');
  });

  it('measures RAW bytes (not base64, not UTF-16 code units) for the limit', () => {
    // '中' is 3 UTF-8 bytes; 1 JS char. A char-count limit would let ~3x
    // through.
    const encoded = encodeAttachmentsForRow([{ filename: 'cn.txt', content: '中'.repeat(1000) }]);
    expect(encoded).toMatchObject({ kind: 'inline', totalBytes: 3000 });
  });

  it('reports over-limit with the true total, and yields no column value', () => {
    const encoded = encodeAttachmentsForRow([
      { filename: 'a.bin', content: Buffer.alloc(SYS_EMAIL_ATTACHMENT_LIMIT_BYTES) },
      { filename: 'b.bin', content: Buffer.alloc(10) },
    ]);
    expect(encoded).toEqual({ kind: 'over-limit', totalBytes: SYS_EMAIL_ATTACHMENT_LIMIT_BYTES + 10 });
  });

  it('accepts a message exactly AT the limit (the bound is inclusive)', () => {
    const encoded = encodeAttachmentsForRow([
      { filename: 'a.bin', content: Buffer.alloc(SYS_EMAIL_ATTACHMENT_LIMIT_BYTES) },
    ]);
    expect(encoded.kind).toBe('inline');
  });

  it('reports content outside the string | Buffer contract instead of guessing', () => {
    const encoded = encodeAttachmentsForRow([
      { filename: 'odd.bin', content: new Uint8Array([1]) as unknown as Buffer },
    ]);
    expect(encoded).toMatchObject({ kind: 'unsupported' });
    expect((encoded as { detail: string }).detail).toContain('odd.bin');
  });

  it('treats no attachments as no column', () => {
    expect(encodeAttachmentsForRow(undefined)).toEqual({ kind: 'none' });
    expect(encodeAttachmentsForRow([])).toEqual({ kind: 'none' });
  });
});

describe('attachments_json — round trip through a row', () => {
  it('restores a Buffer attachment as a Buffer, byte for byte', () => {
    const content = Buffer.from([0x00, 0xff, 0x10, 0x80]);   // not valid UTF-8
    const msg = rowToNormalized({ ...baseRow, attachments_json: column([{ filename: 'b.bin', content }]) });

    const [att] = msg.attachments!;
    expect(Buffer.isBuffer(att.content)).toBe(true);
    expect(Buffer.compare(att.content as Buffer, content)).toBe(0);
  });

  it('restores a string attachment as a string — the charset declaration depends on it', () => {
    const content = '你好,世界';
    const msg = rowToNormalized({ ...baseRow, attachments_json: column([{ filename: '中文.txt', content }]) });

    const [att] = msg.attachments!;
    expect(typeof att.content).toBe('string');
    expect(att.content).toBe(content);
    expect(att.filename).toBe('中文.txt');
  });

  it('carries contentType and cid across, so an inline image still resolves', () => {
    const msg = rowToNormalized({
      ...baseRow,
      attachments_json: column([
        { filename: 'logo.png', content: Buffer.from('png'), contentType: 'image/png', cid: 'logo@inline' },
      ]),
    });
    expect(msg.attachments).toEqual([
      { filename: 'logo.png', content: Buffer.from('png'), contentType: 'image/png', cid: 'logo@inline' },
    ]);
  });
});

describe('headers_json', () => {
  it('round-trips custom headers', () => {
    const headers = { 'X-Campaign': 'spring', 'List-Unsubscribe': '<mailto:u@example.test>' };
    const msg = rowToNormalized({ ...baseRow, headers_json: encodeHeadersForRow(headers) });
    expect(msg.headers).toEqual(headers);
  });

  it('writes no column for an empty or missing header bag', () => {
    expect(encodeHeadersForRow(undefined)).toBeUndefined();
    expect(encodeHeadersForRow({})).toBeUndefined();
  });
});

describe('rows written before these columns existed', () => {
  it('reads with neither column, exactly as before', () => {
    const msg = rowToNormalized({ ...baseRow });
    expect(msg.headers).toBeUndefined();
    expect(msg.attachments).toBeUndefined();
    expect(msg).toMatchObject({ to: ['user@example.test'], subject: 'Hi', text: 'hello' });
  });

  it('reads with the columns explicitly null / empty', () => {
    for (const empty of [null, undefined, '', '   ', 'null']) {
      const msg = rowToNormalized({ ...baseRow, headers_json: empty, attachments_json: empty });
      expect(msg.headers).toBeUndefined();
      expect(msg.attachments).toBeUndefined();
    }
  });

  it('reads an empty array / empty object as "nothing", not as a broken row', () => {
    const msg = rowToNormalized({ ...baseRow, headers_json: '{}', attachments_json: '[]' });
    expect(msg.headers).toBeUndefined();
    expect(msg.attachments).toBeUndefined();
  });
});

describe('a column that lies is rejected, never partially delivered', () => {
  const decodeAtt = (v: unknown) => () => decodeAttachmentsFromRow(v);
  const decodeHdr = (v: unknown) => () => decodeHeadersFromRow(v);

  it('rejects malformed JSON', () => {
    expect(decodeAtt('{ nope')).toThrow(/attachments_json is not valid JSON/);
    expect(decodeHdr('{ nope')).toThrow(/headers_json is not valid JSON/);
  });

  it('rejects the wrong top-level shape', () => {
    expect(decodeAtt('{"a":1}')).toThrow(/must decode to an array/);
    expect(decodeHdr('["a"]')).toThrow(/must decode to an object/);
  });

  it('rejects a non-string header value rather than coercing it', () => {
    expect(decodeHdr('{"X-Retry":3}')).toThrow(/must be a string/);
  });

  it('rejects a missing contentForm instead of guessing which union arm to rebuild', () => {
    const [item] = JSON.parse(column([{ filename: 'a.txt', content: 'hi' }]));
    delete item.contentForm;
    expect(decodeAtt(JSON.stringify([item]))).toThrow(/contentForm must be 'string' or 'buffer'/);
  });

  it('rejects an attachment with no content at all', () => {
    expect(decodeAtt(JSON.stringify([
      { filename: 'a.txt', size: 2, hash: sha('hi'), contentForm: 'string' },
    ]))).toThrow(/carries no content/);
  });

  // #5172 gave `storageKey` a producer AND a reader, but the reader is the
  // ASYNC decoder — this synchronous one has no capability to fetch with. It
  // still refuses rather than dropping the attachment, and now names the
  // missing capability instead of the issue that was going to add it.
  it('rejects a storageKey-only attachment, naming the capability it would need', () => {
    expect(decodeAtt(JSON.stringify([
      { filename: 'a.txt', size: 2, hash: sha('hi'), contentForm: 'buffer', storageKey: 'blob/abc' },
    ]))).toThrow(/no storage capability to fetch it from/);
  });

  it('rejects truncated content (size disagrees)', () => {
    const [item] = JSON.parse(column([{ filename: 'a.txt', content: 'hello' }]));
    item.inline = Buffer.from('he').toString('base64');
    expect(decodeAtt(JSON.stringify([item]))).toThrow(/is 2 byte\(s\) but the row records size 5/);
  });

  it('rejects rewritten content (hash disagrees)', () => {
    const [item] = JSON.parse(column([{ filename: 'a.txt', content: 'hi' }]));
    item.inline = Buffer.from('HI').toString('base64');
    expect(decodeAtt(JSON.stringify([item]))).toThrow(/is not the content that was sent/);
  });

  it('names the offending index so a multi-attachment row is debuggable', () => {
    const items = JSON.parse(column([
      { filename: 'ok.txt', content: 'ok' },
      { filename: 'bad.txt', content: 'bad' },
    ]));
    delete items[1].hash;
    expect(decodeAtt(JSON.stringify(items))).toThrow(/\[1\]\.hash/);
  });
});
