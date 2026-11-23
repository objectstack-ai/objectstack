// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { contentDispositionValue } from './content-disposition.js';

/**
 * How stored bytes are answered — one rule, stated once, for every door that
 * hands them out.
 *
 * A stored file's type is the one recorded for it at upload; it is never on
 * its own the deciding word on how a browser treats the bytes:
 *
 *  1. **Inline only for the allow-list.** {@link INLINE_CONTENT_TYPES} names
 *     the types a browser may render in place — raster images, PDF, plain
 *     text, audio and video. Every other type, `image/svg+xml` and `text/html`
 *     among them, and a missing or malformed type, is answered as an
 *     `attachment`: the browser saves it and renders nothing.
 *  2. **`X-Content-Type-Options: nosniff`, always** — the browser takes the
 *     answered type as final and never sniffs the bytes into another one.
 *  3. **A sandbox CSP, always**, with no script allowed to run.
 *     {@link STORED_BYTES_CONTENT_SECURITY_POLICY}, which asks for a sandboxed
 *     document that runs nothing and loads nothing, on every answer but one:
 *     allow-listed audio or video answered inline carries
 *     {@link STORED_MEDIA_CONTENT_SECURITY_POLICY}. A browser plays those in a
 *     media document that loads the file's own URL; measured in Chromium, that
 *     load is refused under an opaque origin and under `default-src 'none'`
 *     alike, so the player never starts. The media policy keeps the sandbox
 *     and its script ban, keeps the document's origin so the load is
 *     same-origin, and allows media from that origin only. Under `nosniff`
 *     those bytes are only ever read as media. The policy is a request: how a
 *     browser's built-in viewer applies it (Chromium's PDF viewer among them)
 *     is the browser's, so no rule here rests on any answer being rendered as
 *     an opaque-origin document — it rests on rules 1, 2 and 4.
 *  4. **Inline only for bytes that begin with their type's signature.** A
 *     door that holds the bytes when it answers previews an allow-listed type
 *     in place only when {@link bytesBeginWithTheirTypeSignature}; any other
 *     body, an empty one included, is an `attachment` under the default
 *     policy. {@link LEADING_SIGNATURES} holds one test per allow-listed type.
 *
 * Consumers:
 *  - the local adapter's raw byte route (`GET …/_local/raw/:token`), which
 *    sets every header in {@link servedBytesHeaders} from the bytes it holds;
 *  - the S3 adapter's signed download URL, which bakes the type and the
 *    disposition into `ResponseContentType` / `ResponseContentDisposition`. A
 *    `GetObject` signed URL is minted without reading the object and can
 *    carry no other response header, so rule 1 is what it bakes in; rules 2
 *    and 3 are the bucket's to send.
 *
 * ⛔ Never widen the list for one surface: a type earns a place here only if
 * nothing it carries runs with the page's authority, and only with a leading
 * signature beside it. SVG and HTML are never inline.
 */
const INLINE_MEDIA_TYPES: ReadonlySet<string> = new Set([
  // Audio.
  'audio/mpeg',
  'audio/mp4',
  'audio/aac',
  'audio/ogg',
  'audio/wav',
  'audio/wave',
  'audio/x-wav',
  'audio/webm',
  'audio/flac',
  // Video.
  'video/mp4',
  'video/webm',
  'video/ogg',
  'video/quicktime',
]);

/** Every type a browser may render in place (rule 1). */
export const INLINE_CONTENT_TYPES: ReadonlySet<string> = new Set([
  // Raster images.
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/bmp',
  // Documents.
  'application/pdf',
  'text/plain',
  // Audio and video.
  ...INLINE_MEDIA_TYPES,
]);

/** The CSP a stored-bytes answer carries: it asks for a sandboxed document that may load nothing and run nothing (rule 3). */
export const STORED_BYTES_CONTENT_SECURITY_POLICY = "sandbox; default-src 'none'; style-src 'unsafe-inline'";

/**
 * The CSP an allow-listed audio or video answer carries inline: still a
 * sandbox with no script allowed (no `allow-scripts`, and `default-src 'none'`
 * covers scripts too), keeping the document's origin so the media document
 * may load its own URL, and media from that origin only.
 */
export const STORED_MEDIA_CONTENT_SECURITY_POLICY =
  "sandbox allow-same-origin; default-src 'none'; media-src 'self'; style-src 'unsafe-inline'";

// ── Leading signatures (rule 4) ──────────────────────────────────────────────

type Signature = (head: Uint8Array) => boolean;

/** Whether `head` carries `expected` (ASCII text or byte values) at offset `at`. */
function carries(head: Uint8Array, at: number, expected: string | readonly number[]): boolean {
  const want = typeof expected === 'string' ? [...expected].map((c) => c.charCodeAt(0)) : expected;
  return head.length >= at + want.length && want.every((byte, i) => head[at + i] === byte);
}

const oneOf = (...tests: Signature[]): Signature => (head) => tests.some((test) => test(head));
const at = (offset: number, expected: string | readonly number[]): Signature => (head) => carries(head, offset, expected);

const RIFF = (form: string): Signature => (head) => carries(head, 0, 'RIFF') && carries(head, 8, form);
const OGG = at(0, 'OggS');
const EBML = at(0, [0x1a, 0x45, 0xdf, 0xa3]);
const ID3 = at(0, 'ID3');
/** An ISO base media file: a leading `ftyp` box. */
const FTYP = at(4, 'ftyp');
/** A leading `ftyp` box whose major or compatible brands name one of `brands`. */
const ftypBrand = (...brands: string[]): Signature => (head) => {
  if (!FTYP(head)) return false;
  const end = Math.min(((head[0] << 24) | (head[1] << 16) | (head[2] << 8) | head[3]) >>> 0, head.length);
  for (let i = 8; i + 4 <= end; i += 4) if (i !== 12 && brands.some((brand) => carries(head, i, brand))) return true;
  return false;
};
/** An MPEG audio frame header: an 11-bit sync, a defined version and a defined layer. */
const MPEG_FRAME: Signature = (head) =>
  head.length >= 2 && head[0] === 0xff && (head[1] & 0xe0) === 0xe0 && ((head[1] >> 3) & 3) !== 1 && ((head[1] >> 1) & 3) !== 0;
/** An ADTS frame header: a 12-bit sync and layer `00`. */
const ADTS_FRAME: Signature = (head) => head.length >= 2 && head[0] === 0xff && (head[1] & 0xf6) === 0xf0;

/** The window the text test reads, and the bytes text never carries: the WHATWG MIME Sniffing standard's resource header and binary data bytes. */
const TEXT_WINDOW = 1445;
const isBinaryDataByte = (b: number) => b <= 0x08 || b === 0x0b || (b >= 0x0e && b <= 0x1a) || (b >= 0x1c && b <= 0x1f);
/** Plain text has no signature; its test is the standard text-or-binary one: a byte-order mark, or no binary data byte in the window. */
const TEXT: Signature = (head) =>
  head.length > 0 &&
  (carries(head, 0, [0xef, 0xbb, 0xbf]) ||
    carries(head, 0, [0xfe, 0xff]) ||
    carries(head, 0, [0xff, 0xfe]) ||
    !head.subarray(0, TEXT_WINDOW).some(isBinaryDataByte));

/**
 * The leading-signature test for every allow-listed type (rule 4), keyed by
 * the served essence. A type on {@link INLINE_CONTENT_TYPES} with no entry
 * here is never inline; the table-completeness pin holds the two equal.
 */
export const LEADING_SIGNATURES: ReadonlyMap<string, Signature> = new Map<string, Signature>([
  ['image/png', at(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
  ['image/jpeg', at(0, [0xff, 0xd8, 0xff])],
  ['image/gif', oneOf(at(0, 'GIF87a'), at(0, 'GIF89a'))],
  ['image/webp', RIFF('WEBP')],
  ['image/avif', ftypBrand('avif', 'avis')],
  ['image/bmp', at(0, 'BM')],
  ['application/pdf', at(0, '%PDF-')],
  ['text/plain', TEXT],
  ['audio/mpeg', oneOf(ID3, MPEG_FRAME)],
  ['audio/mp4', FTYP],
  ['audio/aac', oneOf(ADTS_FRAME, at(0, 'ADIF'), ID3)],
  ['audio/ogg', OGG],
  ['audio/wav', RIFF('WAVE')],
  ['audio/wave', RIFF('WAVE')],
  ['audio/x-wav', RIFF('WAVE')],
  ['audio/webm', EBML],
  ['audio/flac', at(0, 'fLaC')],
  ['video/mp4', FTYP],
  ['video/webm', EBML],
  ['video/ogg', OGG],
  ['video/quicktime', oneOf(FTYP, ...['moov', 'mdat', 'wide', 'free', 'skip'].map((atom) => at(4, atom)))],
]);

/** Whether the bytes begin with the leading signature of their served type (rule 4); false for a type with no entry. */
export function bytesBeginWithTheirTypeSignature(declared: string | null | undefined, bytes: Uint8Array): boolean {
  return LEADING_SIGNATURES.get(servedContentType(declared).split(';')[0])?.(bytes) ?? false;
}

/** The type answered for bytes whose declared type is missing or is not a media type. */
const OPAQUE_BYTES = 'application/octet-stream';

const MEDIA_TYPE = /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/;
const CHARSET = /(?:^|;)\s*charset\s*=\s*"?([a-z0-9_.:-]+)"?\s*(?:;|$)/i;

/**
 * The type the bytes are answered under: the declared type's essence
 * (lower-cased, parameters dropped), or `application/octet-stream` when it is
 * missing or is not a media type. A `charset` is kept on `text/plain` only,
 * the one allow-listed type it means anything to.
 */
export function servedContentType(declared: string | null | undefined): string {
  if (typeof declared !== 'string') return OPAQUE_BYTES;
  const essence = declared.split(';')[0].trim().toLowerCase();
  if (!MEDIA_TYPE.test(essence)) return OPAQUE_BYTES;
  if (essence === 'text/plain') {
    const charset = CHARSET.exec(declared)?.[1];
    if (charset) return `text/plain; charset=${charset.toLowerCase()}`;
  }
  return essence;
}

/** Whether bytes of this declared type may be rendered in place (rule 1). */
export function isInlineContentType(declared: string | null | undefined): boolean {
  return INLINE_CONTENT_TYPES.has(servedContentType(declared).split(';')[0]);
}

/**
 * The disposition the bytes are answered with: `inline` only when the caller
 * asked for it (the default) AND the type is on the allow-list; `attachment`
 * otherwise. A caller's `inline` never overrides the list.
 */
export function servedDisposition(
  declared: string | null | undefined,
  requested: 'inline' | 'attachment' | undefined,
): 'inline' | 'attachment' {
  return requested !== 'attachment' && isInlineContentType(declared) ? 'inline' : 'attachment';
}

/** The `Content-Disposition` value: the filename forms when there is a name, the bare disposition otherwise. */
export function servedContentDisposition(
  declared: string | null | undefined,
  filename: string | undefined,
  requested: 'inline' | 'attachment' | undefined,
): string {
  const disposition = servedDisposition(declared, requested);
  return filename ? contentDispositionValue(filename, disposition) : disposition;
}

/** The CSP for an answer (rule 3): the media policy only for allow-listed audio or video answered inline. */
export function servedContentSecurityPolicy(
  declared: string | null | undefined,
  requested: 'inline' | 'attachment' | undefined,
): string {
  const essence = servedContentType(declared).split(';')[0];
  return INLINE_MEDIA_TYPES.has(essence) && servedDisposition(declared, requested) === 'inline'
    ? STORED_MEDIA_CONTENT_SECURITY_POLICY
    : STORED_BYTES_CONTENT_SECURITY_POLICY;
}

/** Every header a stored-bytes answer on the app's origin carries (rules 1–4), judged on the bytes it answers with. */
export function servedBytesHeaders(input: {
  contentType: string | null | undefined;
  filename: string | undefined;
  disposition: 'inline' | 'attachment' | undefined;
  bytes: Uint8Array;
}): Record<string, string> {
  const disposition = bytesBeginWithTheirTypeSignature(input.contentType, input.bytes) ? input.disposition : 'attachment';
  return {
    'content-type': servedContentType(input.contentType),
    'content-disposition': servedContentDisposition(input.contentType, input.filename, disposition),
    'x-content-type-options': 'nosniff',
    'content-security-policy': servedContentSecurityPolicy(input.contentType, disposition),
  };
}
