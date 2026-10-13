// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The IMAP wire format (RFC 3501 §4, §7, §9) — the subset a read-only mirror
 * needs, and nothing it does not:
 *
 *  - framing server responses: a response is a line, except that a line ending
 *    in a literal marker `{n}` continues with exactly `n` octets and then more
 *    line ({@link ImapResponseReader});
 *  - reading the values inside a response: atoms, quoted strings, literals,
 *    `NIL` and parenthesized lists ({@link parseImapValues});
 *  - writing the strings a command carries: a quoted string, or a literal when
 *    quoting cannot carry the text ({@link imapAstring}), and a mailbox name in
 *    modified UTF-7 ({@link encodeMailboxName}).
 */

import { ImapError } from './imap-error.js';

/**
 * The most literals one response may carry. A response this client asks for
 * carries at most one (a message body); the bound refuses a server that
 * announces literal after literal — `{0}` after `{0}` — to grow one response
 * forever.
 */
export const IMAP_MAX_RESPONSE_LITERALS = 32;

/** One server response: text segments, each followed by the literal its `{n}` announced. */
export type ImapResponseParts = Array<string | Uint8Array>;

/** A value inside a response: an atom or quoted string, a literal's octets, `NIL`, or a list. */
export type ImapValue = string | Uint8Array | null | ImapValue[];

const LF = 0x0a;
const CR = 0x0d;
const LITERAL_MARKER = /\{(\d+)\}$/;

/**
 * Frames a server's byte stream into responses. Bounded on every axis: a line
 * longer than `maxLineBytes`, a literal larger than `maxLiteralBytes` and a
 * response of more than {@link IMAP_MAX_RESPONSE_LITERALS} literals are refused
 * (`oversized`) before the excess is kept, never an unbounded buffer.
 */
export class ImapResponseReader {
  private pending: Buffer[] = [];
  private pendingBytes = 0;
  private parts: ImapResponseParts = [];
  private literalRemaining: number | null = null;
  private literalsInResponse = 0;

  constructor(
    private readonly limits: { maxLineBytes: number; maxLiteralBytes: number },
  ) {}

  /** Feed the next chunk; answers every response it completed. */
  push(chunk: Uint8Array): ImapResponseParts[] {
    if (chunk.length > 0) {
      this.pending.push(Buffer.from(chunk.buffer, chunk.byteOffset, chunk.length));
      this.pendingBytes += chunk.length;
    }
    const done: ImapResponseParts[] = [];
    for (;;) {
      if (this.literalRemaining !== null) {
        if (this.pendingBytes < this.literalRemaining) break;
        this.parts.push(new Uint8Array(this.take(this.literalRemaining)));
        this.literalRemaining = null;
        continue;
      }
      const lineLength = this.indexOfLf();
      if (lineLength < 0) {
        if (this.pendingBytes > this.limits.maxLineBytes) {
          throw new ImapError('oversized', `The server sent a line longer than ${this.limits.maxLineBytes} bytes.`);
        }
        break;
      }
      const raw = this.take(lineLength + 1);
      const end = lineLength > 0 && raw[lineLength - 1] === CR ? lineLength - 1 : lineLength;
      const line = raw.toString('utf8', 0, end);
      const marker = LITERAL_MARKER.exec(line);
      this.parts.push(line);
      if (marker) {
        if (++this.literalsInResponse > IMAP_MAX_RESPONSE_LITERALS) {
          throw new ImapError(
            'oversized',
            `The server sent a response of more than ${IMAP_MAX_RESPONSE_LITERALS} literals; this session accepts no more.`,
          );
        }
        const size = Number(marker[1]);
        if (!Number.isSafeInteger(size) || size > this.limits.maxLiteralBytes) {
          throw new ImapError(
            'oversized',
            `The server announced a ${marker[1]}-byte literal; this session accepts at most ${this.limits.maxLiteralBytes}.`,
          );
        }
        this.literalRemaining = size;
        continue;
      }
      done.push(this.parts);
      this.parts = [];
      this.literalsInResponse = 0;
    }
    return done;
  }

  /** The offset of the first LF across the pending chunks, or -1. */
  private indexOfLf(): number {
    let offset = 0;
    for (const chunk of this.pending) {
      const at = chunk.indexOf(LF);
      if (at >= 0) return offset + at;
      offset += chunk.length;
    }
    return -1;
  }

  /** Remove and answer the first `count` pending bytes, copying once. */
  private take(count: number): Buffer {
    const out = Buffer.allocUnsafe(count);
    let filled = 0;
    while (filled < count) {
      const head = this.pending[0]!;
      const want = count - filled;
      if (head.length <= want) {
        head.copy(out, filled);
        filled += head.length;
        this.pending.shift();
      } else {
        head.copy(out, filled, 0, want);
        this.pending[0] = head.subarray(want);
        filled += want;
      }
    }
    this.pendingBytes -= count;
    return out;
  }
}

/**
 * Read the values of a response, starting at `offset` of its first text part.
 * Atoms keep any `[...]` section they carry (`BODY[]`, `BODY[HEADER]`), so a
 * FETCH item name reads as one value.
 */
export function parseImapValues(parts: ImapResponseParts, offset = 0): ImapValue[] {
  const scanner = new Scanner(parts, offset);
  const root: ImapValue[] = [];
  const stack: ImapValue[][] = [root];
  for (;;) {
    scanner.skipSpaces();
    if (scanner.atEnd()) break;
    const top = stack[stack.length - 1]!;
    const ch = scanner.peek();
    if (ch === undefined) {
      // End of a text part: the literal it announced (already consumed with
      // its marker) or the end of the response.
      const literal = scanner.takeLiteral();
      if (literal === null) break;
      top.push(literal);
      continue;
    }
    if (ch === '(') {
      scanner.advance();
      const list: ImapValue[] = [];
      top.push(list);
      stack.push(list);
    } else if (ch === ')') {
      scanner.advance();
      if (stack.length === 1) throw new ImapError('protocol', 'The server sent an unbalanced ")".');
      stack.pop();
    } else if (ch === '"') {
      top.push(scanner.quoted());
    } else if (ch === '{' && scanner.atLiteralMarker()) {
      scanner.skipLiteralMarker();
      const literal = scanner.takeLiteral();
      if (literal === null) throw new ImapError('protocol', 'A literal marker was not followed by its octets.');
      top.push(literal);
    } else {
      const atom = scanner.atom();
      top.push(atom.toUpperCase() === 'NIL' ? null : atom);
    }
  }
  if (stack.length !== 1) throw new ImapError('protocol', 'The server sent an unbalanced "(".');
  return root;
}

class Scanner {
  private part = 0;
  private pos: number;

  constructor(private readonly parts: ImapResponseParts, offset: number) {
    this.pos = offset;
  }

  private text(): string | null {
    const current = this.parts[this.part];
    return typeof current === 'string' ? current : null;
  }

  atEnd(): boolean {
    const text = this.text();
    return text !== null && this.pos >= text.length && this.part >= this.parts.length - 1;
  }

  peek(): string | undefined {
    const text = this.text();
    return text !== null && this.pos < text.length ? text[this.pos] : undefined;
  }

  advance(): void {
    this.pos++;
  }

  skipSpaces(): void {
    const text = this.text();
    while (text !== null && this.pos < text.length && text[this.pos] === ' ') this.pos++;
  }

  /** At a `{n}` that ends the current text part. */
  atLiteralMarker(): boolean {
    const text = this.text();
    return text !== null && /^\{\d+\}$/.test(text.slice(this.pos)) && this.parts[this.part + 1] instanceof Uint8Array;
  }

  skipLiteralMarker(): void {
    const text = this.text();
    if (text !== null) this.pos = text.length;
  }

  /** At the end of a text part: take the literal after it and move to the text that follows. */
  takeLiteral(): Uint8Array | null {
    const next = this.parts[this.part + 1];
    if (!(next instanceof Uint8Array)) return null;
    this.part += 2;
    this.pos = 0;
    return next;
  }

  quoted(): string {
    const text = this.text()!;
    let out = '';
    let i = this.pos + 1;
    for (; i < text.length; i++) {
      const c = text[i]!;
      if (c === '\\' && i + 1 < text.length) {
        out += text[++i];
      } else if (c === '"') {
        this.pos = i + 1;
        return out;
      } else {
        out += c;
      }
    }
    throw new ImapError('protocol', 'The server sent an unterminated quoted string.');
  }

  atom(): string {
    const text = this.text()!;
    const start = this.pos;
    let depth = 0;
    while (this.pos < text.length) {
      const c = text[this.pos]!;
      if (c === '[') depth++;
      else if (c === ']' && depth > 0) depth--;
      else if (depth === 0 && (c === ' ' || c === '(' || c === ')' || c === '"')) break;
      this.pos++;
    }
    if (this.pos === start) throw new ImapError('protocol', `The server sent an unreadable value at "${text.slice(start, start + 16)}".`);
    return text.slice(start, this.pos);
  }
}

/** A command argument as sent: inline text, or a synchronizing literal (RFC 3501 §4.3). */
export type ImapArgument = { text: string } | { literal: Uint8Array };

/**
 * An astring argument: a quoted string when the text is printable 7-bit, a
 * literal otherwise (8-bit text, CR or LF), so no value is ever mangled into
 * a different one.
 */
export function imapAstring(value: string): ImapArgument {
  if (/^[\x20-\x7e]*$/.test(value)) return { text: `"${value.replace(/[\\"]/g, (c) => `\\${c}`)}"` };
  return { literal: new TextEncoder().encode(value) };
}

/**
 * A mailbox name in modified UTF-7 (RFC 3501 §5.1.3): printable ASCII stays as
 * it is (`&` as `&-`), every other run becomes `&` + the modified BASE64 of its
 * UTF-16BE + `-`.
 */
export function encodeMailboxName(name: string): string {
  let out = '';
  let run: number[] = [];
  const flush = () => {
    if (run.length === 0) return;
    const bytes = Buffer.alloc(run.length * 2);
    run.forEach((unit, i) => bytes.writeUInt16BE(unit, i * 2));
    out += `&${bytes.toString('base64').replace(/=+$/, '').replace(/\//g, ',')}-`;
    run = [];
  };
  for (let i = 0; i < name.length; i++) {
    const unit = name.charCodeAt(i);
    if (unit >= 0x20 && unit <= 0x7e) {
      flush();
      out += unit === 0x26 ? '&-' : name[i];
    } else {
      run.push(unit);
    }
  }
  flush();
  return out;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** An INTERNALDATE (`dd-Mon-yyyy hh:mm:ss +zzzz`, RFC 3501 §9 date-time) as a Date, or `null`. */
export function parseInternalDate(value: string): Date | null {
  const m = /^\s?(\d{1,2})-([A-Za-z]{3})-(\d{4}) (\d{2}):(\d{2}):(\d{2}) ([+-])(\d{2})(\d{2})$/.exec(value);
  if (!m) return null;
  const month = MONTHS.indexOf(m[2]!.toLowerCase());
  if (month < 0) return null;
  const offsetMinutes = (Number(m[8]) * 60 + Number(m[9])) * (m[7] === '-' ? -1 : 1);
  const utc = Date.UTC(Number(m[3]), month, Number(m[1]), Number(m[4]), Number(m[5]), Number(m[6])) - offsetMinutes * 60_000;
  const at = new Date(utc);
  return Number.isNaN(at.getTime()) ? null : at;
}
