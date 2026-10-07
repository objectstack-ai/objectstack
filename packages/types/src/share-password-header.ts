// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#22049] How a share-link password travels in a request header — the ONE
 * reading both mounts of the public share-link routes (`/:token/resolve` and
 * `/:token/messages`) decode the header pair through: `plugin-sharing`'s
 * `presentedPassword` and the runtime dispatcher's `/share-links` domain.
 *
 * ## Why an encoding has to be declared at all
 *
 * A header value is a byte string. The Fetch standard's `Headers` refuses, with
 * a `TypeError` and before any request leaves, a value with a character above
 * U+00FF — so a CJK or emoji password could not be sent from a browser, while
 * `createLink` hashes any string and the console's share dialog mints any
 * string. Both ends also strip leading and trailing whitespace from a header
 * value, so a password that begins or ends with a space could not travel raw
 * either.
 *
 * ## The encoding is SIGNALLED, never guessed
 *
 * {@link SHARE_PASSWORD_ENCODING_HEADER} is a companion request header naming
 * how {@link SHARE_PASSWORD_HEADER} is encoded. Its one accepted value is
 * {@link SHARE_PASSWORD_ENCODING_UTF8}, compared case-insensitively: the
 * password header then carries the password's UTF-8 bytes, percent-encoded —
 * exactly what `encodeURIComponent(password)` produces (`+` is a literal plus,
 * never a space).
 *
 * Without the companion header the password header is read exactly as it
 * always was: raw, as it arrives. That is what keeps every value accepted
 * before this reading unchanged — a raw Latin-1 password, and a raw password
 * containing `%`, still resolve as themselves. Percent-decoding every value
 * would have silently re-read those, and an in-value prefix (an RFC 8187-style
 * `UTF-8''`) would have re-read every raw password that happened to begin with
 * it; a separate header re-reads nothing that was sent before it existed.
 *
 * ## A declared encoding that does not hold is refused, never fallen through
 *
 * A companion header naming any other encoding, or a password header that is
 * not percent-encoded UTF-8 under it, is a {@link SharePasswordHeaderRefusal}.
 * Each door answers it `400` in its own registered vocabulary
 * (`VALIDATION_FAILED`, which both packages already list), BEFORE the token is
 * looked up, so the refusal says nothing about the link. ⛔ Never compare the
 * undecodable value raw instead: the client declared it encoded, and a raw
 * compare would answer `401 WRONG_PASSWORD` for what is a malformed request.
 *
 * This module spells no error code on purpose: the code is the emitting door's
 * (the error-code ledger registers it per package), the reading is shared.
 *
 * Nothing here trims, logs or echoes the value: a refusal message names the
 * headers and the rule, never the presented password.
 */

/** The request header a share-link password travels in. Header names are case-insensitive. */
export const SHARE_PASSWORD_HEADER = 'X-Share-Password';

/**
 * The companion request header that declares how {@link SHARE_PASSWORD_HEADER}
 * is encoded. Absent, the password header is read raw.
 */
export const SHARE_PASSWORD_ENCODING_HEADER = 'X-Share-Password-Encoding';

/**
 * The one encoding {@link SHARE_PASSWORD_ENCODING_HEADER} may name (compared
 * case-insensitively): the password's UTF-8 bytes, percent-encoded, as
 * `encodeURIComponent` produces them.
 */
export const SHARE_PASSWORD_ENCODING_UTF8 = 'utf-8';

/**
 * The `Vary` value both public share-link routes answer with: the answer
 * depends on the password header AND on the header that declares its encoding.
 */
export const SHARE_PASSWORD_VARY = `${SHARE_PASSWORD_HEADER}, ${SHARE_PASSWORD_ENCODING_HEADER}`;

/** Why a header pair was refused. */
export type SharePasswordHeaderRefusalReason = 'unknown-encoding' | 'malformed-value';

/** A header pair the door must refuse with `400`. `message` never carries the presented value. */
export interface SharePasswordHeaderRefusal {
  readonly ok: false;
  readonly reason: SharePasswordHeaderRefusalReason;
  readonly message: string;
}

/** The password the header pair presented — `undefined` when the password header is absent. */
export interface SharePasswordHeaderPassword {
  readonly ok: true;
  readonly password: string | undefined;
}

export type SharePasswordHeaderReading = SharePasswordHeaderPassword | SharePasswordHeaderRefusal;

const UNKNOWN_ENCODING_MESSAGE =
  `${SHARE_PASSWORD_ENCODING_HEADER} names an encoding this server does not read. ` +
  `The one accepted value is "${SHARE_PASSWORD_ENCODING_UTF8}": ${SHARE_PASSWORD_HEADER} then carries ` +
  `the password's UTF-8 bytes, percent-encoded. Leave ${SHARE_PASSWORD_ENCODING_HEADER} out to send the password raw.`;

const MALFORMED_VALUE_MESSAGE =
  `${SHARE_PASSWORD_HEADER} is not percent-encoded UTF-8, which ` +
  `"${SHARE_PASSWORD_ENCODING_HEADER}: ${SHARE_PASSWORD_ENCODING_UTF8}" declares it to be. ` +
  `Send the password's UTF-8 bytes percent-encoded, as encodeURIComponent produces them.`;

/**
 * A percent-encoded value is visible ASCII by construction: `encodeURIComponent`
 * escapes everything else, a space included. A character outside that range is
 * a value that was never encoded, refused rather than passed through.
 */
const PERCENT_ENCODED_CHARS = /^[\x21-\x7E]*$/;

/** One header value as both doors hand it over: the first of a repeated header, as the raw read always took it. */
function firstValue(value: unknown): string | undefined {
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === 'string' ? first : undefined;
}

/**
 * Read the password a request presented in {@link SHARE_PASSWORD_HEADER}, as
 * declared by {@link SHARE_PASSWORD_ENCODING_HEADER}.
 *
 * @param passwordHeader the raw `x-share-password` value (a repeated header's
 *   array is read by its first value, as before).
 * @param encodingHeader the raw `x-share-password-encoding` value.
 *
 * Absent encoding header: the password header, raw and unchanged. Encoding
 * header `utf-8` (any case): the password header percent-decoded as UTF-8.
 * Any other encoding header, or a value that does not decode: a refusal.
 */
export function readSharePasswordHeader(passwordHeader: unknown, encodingHeader: unknown): SharePasswordHeaderReading {
  const value = firstValue(passwordHeader);
  const encoding = firstValue(encodingHeader);
  if (encoding === undefined) return { ok: true, password: value };
  if (encoding.toLowerCase() !== SHARE_PASSWORD_ENCODING_UTF8) {
    return { ok: false, reason: 'unknown-encoding', message: UNKNOWN_ENCODING_MESSAGE };
  }
  if (value === undefined) return { ok: true, password: undefined };
  if (!PERCENT_ENCODED_CHARS.test(value)) {
    return { ok: false, reason: 'malformed-value', message: MALFORMED_VALUE_MESSAGE };
  }
  try {
    return { ok: true, password: decodeURIComponent(value) };
  } catch {
    // `decodeURIComponent` throws `URIError` on a `%` not followed by two hex
    // digits and on octets that are not well-formed UTF-8 (a truncated
    // sequence, `%FF`, an overlong form, an encoded surrogate).
    return { ok: false, reason: 'malformed-value', message: MALFORMED_VALUE_MESSAGE };
  }
}
