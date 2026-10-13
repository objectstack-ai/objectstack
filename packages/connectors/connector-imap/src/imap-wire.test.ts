// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { ImapError } from './imap-error.js';
import {
  IMAP_MAX_RESPONSE_LITERALS,
  ImapResponseReader,
  encodeMailboxName,
  imapAstring,
  parseImapValues,
  parseInternalDate,
} from './imap-wire.js';

const bytes = (s: string) => new Uint8Array(Buffer.from(s, 'utf8'));
const reader = () => new ImapResponseReader({ maxLineBytes: 1024, maxLiteralBytes: 64 });

describe('ImapResponseReader frames a byte stream into responses', () => {
  it('answers one response per line, holding a partial line back until its LF arrives', () => {
    const r = reader();
    expect(r.push(bytes('* OK ready\r\nA1 OK do'))).toEqual([['* OK ready']]);
    expect(r.push(bytes('ne\r\n'))).toEqual([['A1 OK done']]);
  });

  it('continues a line past a literal of exactly the announced length, split across chunks', () => {
    const r = reader();
    expect(r.push(bytes('* 1 FETCH (UID 7 BODY[] {5}\r\nab'))).toEqual([]);
    const [response] = r.push(bytes('c\r\n)\r\n'));
    expect(response).toHaveLength(3);
    expect(response![0]).toBe('* 1 FETCH (UID 7 BODY[] {5}');
    expect(Buffer.from(response![1] as Uint8Array).toString('utf8')).toBe('abc\r\n');
    expect(response![2]).toBe(')');
  });

  it('keeps 8-bit octets of a literal exactly as sent', () => {
    const r = reader();
    const body = Buffer.from([0xc3, 0xa9, 0x00, 0xff]);
    const [response] = r.push(Buffer.concat([Buffer.from('* 1 FETCH (BODY[] {4}\r\n'), body, Buffer.from(')\r\n')]));
    expect([...(response![1] as Uint8Array)]).toEqual([0xc3, 0xa9, 0x00, 0xff]);
  });

  const kindOf = (fn: () => unknown): string | undefined => {
    try {
      fn();
    } catch (err) {
      expect(err).toBeInstanceOf(ImapError);
      return (err as ImapError).kind;
    }
    return undefined;
  };

  it('refuses a literal larger than its bound, before reading it', () => {
    expect(kindOf(() => reader().push(bytes('* 1 FETCH (BODY[] {65}\r\n')))).toBe('oversized');
  });

  it('refuses a line longer than its bound', () => {
    expect(() => reader().push(bytes('*'.repeat(1025)))).toThrow(/longer than 1024 bytes/);
    expect(kindOf(() => reader().push(bytes('*'.repeat(1025))))).toBe('oversized');
  });

  it(`refuses a response of more than ${IMAP_MAX_RESPONSE_LITERALS} literals — an endless {0} run — and admits ${IMAP_MAX_RESPONSE_LITERALS}`, () => {
    const run = (literals: number) => `* 1 FETCH (BODY[] {0}\r\n${' X {0}\r\n'.repeat(literals - 1)})\r\n`;
    // Control: exactly the bound is one complete response.
    expect(reader().push(bytes(run(IMAP_MAX_RESPONSE_LITERALS)))).toHaveLength(1);
    expect(kindOf(() => reader().push(bytes(run(IMAP_MAX_RESPONSE_LITERALS + 1))))).toBe('oversized');
    // The count is per response: two responses at the bound are both admitted.
    expect(reader().push(bytes(run(IMAP_MAX_RESPONSE_LITERALS).repeat(2)))).toHaveLength(2);
  });
});

describe('parseImapValues reads the values of a response', () => {
  it('reads atoms, quoted strings with escapes, NIL and nested lists', () => {
    expect(parseImapValues(['(UID 4 FLAGS (\\Seen $Junk) X "a \\"q\\" \\\\ b" NIL)'])).toEqual([
      ['UID', '4', 'FLAGS', ['\\Seen', '$Junk'], 'X', 'a "q" \\ b', null],
    ]);
  });

  it('reads a FETCH item with a section, spaces inside the brackets included, as one atom', () => {
    expect(parseImapValues(['(BODY[HEADER.FIELDS (FROM TO)] NIL BODY[] NIL)'])).toEqual([
      ['BODY[HEADER.FIELDS (FROM TO)]', null, 'BODY[]', null],
    ]);
  });

  it('reads a literal where its marker stood, and the text after it', () => {
    const parts = ['* 1 FETCH (UID 9 BODY[] {3}', new Uint8Array([1, 2, 3]), ' RFC822.SIZE 3)'];
    const [, , , list] = parseImapValues(parts);
    expect(list).toEqual(['UID', '9', 'BODY[]', new Uint8Array([1, 2, 3]), 'RFC822.SIZE', '3']);
  });

  it('refuses an unbalanced list', () => {
    expect(() => parseImapValues(['(UID 1'])).toThrow(/unbalanced/);
    expect(() => parseImapValues(['UID 1)'])).toThrow(/unbalanced/);
  });
});

describe('command arguments', () => {
  it('quotes printable 7-bit text, escaping the quote and the backslash', () => {
    expect(imapAstring('a"b\\c')).toEqual({ text: '"a\\"b\\\\c"' });
  });

  it('sends 8-bit text and line breaks as a literal, never mangled into a quoted string', () => {
    expect(imapAstring('pässword')).toEqual({ literal: new TextEncoder().encode('pässword') });
    expect(imapAstring('a\r\nb')).toEqual({ literal: new TextEncoder().encode('a\r\nb') });
  });

  it('encodes a mailbox name in modified UTF-7 (the RFC 3501 §5.1.3 example)', () => {
    expect(encodeMailboxName('~peter/mail/台北/日本語')).toBe('~peter/mail/&U,BTFw-/&ZeVnLIqe-');
    expect(encodeMailboxName('INBOX')).toBe('INBOX');
    expect(encodeMailboxName('R&D')).toBe('R&-D');
  });
});

describe('parseInternalDate', () => {
  it('reads the RFC 3501 date-time, offset applied, a space-padded day included', () => {
    expect(parseInternalDate('12-Oct-2026 09:30:00 +0200')?.toISOString()).toBe('2026-10-12T07:30:00.000Z');
    expect(parseInternalDate(' 2-Jan-2026 00:00:00 -0500')?.toISOString()).toBe('2026-01-02T05:00:00.000Z');
  });

  it('answers null for anything else', () => {
    expect(parseInternalDate('2026-10-12T09:30:00Z')).toBeNull();
    expect(parseInternalDate('12-Foo-2026 09:30:00 +0000')).toBeNull();
  });
});
