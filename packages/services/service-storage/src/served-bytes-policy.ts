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
 *     {@link STORED_BYTES_CONTENT_SECURITY_POLICY} — an opaque-origin document
 *     that loads nothing — on every answer but one: allow-listed audio or video
 *     answered inline carries {@link STORED_MEDIA_CONTENT_SECURITY_POLICY}.
 *     A browser plays those in a media document that loads the file's own URL;
 *     measured in Chromium, that load is refused under an opaque origin and
 *     under `default-src 'none'` alike, so the player never starts. The media
 *     policy keeps the sandbox and its script ban, keeps the document's origin
 *     so the load is same-origin, and allows media from that origin only.
 *     Under `nosniff` those bytes are only ever read as media.
 *
 * Consumers:
 *  - the local adapter's raw byte route (`GET …/_local/raw/:token`), which
 *    sets every header in {@link servedBytesHeaders};
 *  - the S3 adapter's signed download URL, which bakes the type and the
 *    disposition into `ResponseContentType` / `ResponseContentDisposition`. A
 *    `GetObject` signed URL can carry no other response header, so rules 2
 *    and 3 are the bucket's to send; rule 1 holds there as everywhere.
 *
 * ⛔ Never widen the list for one surface: a type earns a place here only if
 * nothing it carries runs with the page's authority. SVG and HTML are never
 * inline.
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

/** The CSP a stored-bytes answer carries: a sandboxed, opaque-origin document that may load nothing and run nothing. */
export const STORED_BYTES_CONTENT_SECURITY_POLICY = "sandbox; default-src 'none'; style-src 'unsafe-inline'";

/**
 * The CSP an allow-listed audio or video answer carries inline: still a
 * sandbox with no script allowed (no `allow-scripts`, and `default-src 'none'`
 * covers scripts too), keeping the document's origin so the media document
 * may load its own URL, and media from that origin only.
 */
export const STORED_MEDIA_CONTENT_SECURITY_POLICY =
  "sandbox allow-same-origin; default-src 'none'; media-src 'self'; style-src 'unsafe-inline'";

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

/** Every header a stored-bytes answer on the app's origin carries (rules 1–3). */
export function servedBytesHeaders(input: {
  contentType: string | null | undefined;
  filename: string | undefined;
  disposition: 'inline' | 'attachment' | undefined;
}): Record<string, string> {
  return {
    'content-type': servedContentType(input.contentType),
    'content-disposition': servedContentDisposition(input.contentType, input.filename, input.disposition),
    'x-content-type-options': 'nosniff',
    'content-security-policy': servedContentSecurityPolicy(input.contentType, input.disposition),
  };
}
