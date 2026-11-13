// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The bounds a caller's message passes before the mail service sends it, for
 * every door a caller reaches mail through: the HTTP send door
 * (`POST /api/v1/email/send`, `@objectstack/rest`) and the script-body door
 * (`ctx.email.send`, `@objectstack/runtime`). One implementation, so the two
 * doors cannot admit different messages.
 *
 * What a door decides itself, before it calls this: WHO may use it (the HTTP
 * door's capability; the body door's declared `email.send` token) and what
 * shape a body may have. What this module decides, for both:
 *
 *  1. ATTRIBUTION — `sentBy` is the calling user. A message naming another
 *     user is refused; one naming the caller (or none) is stamped with the
 *     caller. A call with no calling user (a scheduled job's body) records no
 *     sender, and a message naming one is refused.
 *  2. SENDER — the envelope sender is the deployment's configured sender
 *     (`IEmailService.getDefaultFrom`). A `from` naming any other address is
 *     refused; one naming the configured address is replaced by the configured
 *     value. A deployment that reports no configured sender refuses a caller
 *     `from`. Custom `headers` may not name the sender
 *     ({@link SENDER_HEADER_NAMES}), and are accepted in one shape only: a
 *     plain object mapping each header field name to a single-line string.
 *  3. TENANT — the message belongs to the caller's organization, which this
 *     stamps as `organizationId`. A message naming another organization, or
 *     naming one when the caller has none, is refused. `identityMail` is
 *     refused: identity mail is sent by the server itself. A message restating
 *     `identityMail: false` is admitted, and the forwarded message never
 *     carries the caller's value.
 *
 * `replyTo` is not bounded: it is the caller's choice of Reply-To address and
 * makes no claim about the sender.
 */

import type { EmailAddress } from '@objectstack/spec/contracts';

/**
 * Custom header names (compared case-insensitively) a caller may not set: each
 * one states who the message is from, which bound 2 reserves to the configured
 * sender.
 */
export const SENDER_HEADER_NAMES: ReadonlySet<string> = new Set(['from', 'sender', 'return-path']);

/**
 * A header field name: one or more printable US-ASCII characters other than
 * the colon (RFC 5322 §2.2).
 */
const HEADER_FIELD_NAME = /^[\x21-\x39\x3b-\x7e]+$/;

/** A plain object — an object literal or a JSON-parsed object, never an array or a class instance. */
export function isPlainMailObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Why a caller's `headers` cannot be forwarded, or `undefined` when it can.
 * Absent is fine. Otherwise it must be the contract's `Record<string, string>`
 * exactly, with no key one of {@link SENDER_HEADER_NAMES}.
 */
function headersRefusal(headers: unknown): string | undefined {
  if (headers === undefined) return undefined;
  if (!isPlainMailObject(headers)) {
    return 'Custom `headers` must be an object mapping each header name to a string value.';
  }
  for (const [name, value] of Object.entries(headers)) {
    if (!HEADER_FIELD_NAME.test(name)) {
      return 'Custom `headers` must be keyed by header field names: printable ASCII with no space, control character or colon.';
    }
    if (typeof value !== 'string' || /[\r\n]/.test(value)) {
      return `Custom \`headers\` value for \`${name}\` must be a single-line string.`;
    }
    if (SENDER_HEADER_NAMES.has(name.toLowerCase())) {
      return `Custom header \`${name}\` cannot be set: the sender is the deployment's configured sender.`;
    }
  }
  return undefined;
}

/**
 * The bare address an {@link EmailAddress} names, lower-cased for comparison,
 * or `undefined` when it names none. For the string form a trailing
 * `<address>` wins over the display name before it.
 */
export function mailAddressOf(value: unknown): string | undefined {
  let raw: unknown = value;
  if (value && typeof value === 'object') raw = (value as { address?: unknown }).address;
  if (typeof raw !== 'string') return undefined;
  const angled = /<([^<>]*)>\s*$/.exec(raw);
  const address = (angled ? angled[1] : raw).trim().toLowerCase();
  return address.length > 0 ? address : undefined;
}

/** Who is sending, as the door resolved it — never as the message says. */
export interface CallerMailIdentity {
  /** The calling user, or `undefined` for a call with none (a scheduled job). */
  userId: string | undefined;
  /** The caller's active organization, or `undefined` when it has none. */
  organizationId: string | undefined;
}

/** The part of the mail service the bounds read: its configured sender. */
export interface CallerMailSenderSource {
  getDefaultFrom?: () => EmailAddress | undefined;
}

/** The bounded message, or the reason the caller's message is refused. */
export type CallerMailBoundsResult =
  | { ok: true; input: Record<string, unknown> }
  | { ok: false; reason: string };

/**
 * Apply the three bounds of the module header to a caller's `message`, and
 * answer the message the mail service is handed, or the refusal. Pure: it
 * reads only its arguments and the service's configured sender.
 */
export function boundCallerMail(
  message: Record<string, unknown>,
  caller: CallerMailIdentity,
  sender: CallerMailSenderSource,
): CallerMailBoundsResult {
  // Bound 1: attribution.
  if (message.sentBy !== undefined && message.sentBy !== caller.userId) {
    return {
      ok: false,
      reason: caller.userId
        ? '`sentBy` is the authenticated caller; a send cannot be attributed to another user.'
        : '`sentBy` cannot be set: this call has no calling user. Omit it.',
    };
  }

  // Bound 2: the sender is the configured one.
  const headersRefused = headersRefusal(message.headers);
  if (headersRefused !== undefined) return { ok: false, reason: headersRefused };
  let from: EmailAddress | undefined;
  if (message.from !== undefined) {
    const configured = typeof sender.getDefaultFrom === 'function' ? sender.getDefaultFrom() : undefined;
    const configuredAddress = mailAddressOf(configured);
    if (!configuredAddress || mailAddressOf(message.from) !== configuredAddress) {
      return {
        ok: false,
        reason: configuredAddress
          ? `\`from\` must be the deployment's configured sender (${configuredAddress}); omit it to send as that sender.`
          : '`from` cannot be chosen by the caller: this deployment reports no configured sender. Configure one in Settings → Mail → From address and omit `from`.',
      };
    }
    from = configured;
  }

  // Bound 3: the caller's organization, and identity mail is the server's.
  const organizationId = caller.organizationId;
  if (message.organizationId !== undefined && message.organizationId !== organizationId) {
    return {
      ok: false,
      reason: organizationId
        ? '`organizationId` is the caller\'s active organization; a send cannot be recorded under another organization.'
        : '`organizationId` cannot be set: the caller has no active organization. Omit it.',
    };
  }
  if (message.identityMail !== undefined && message.identityMail !== false) {
    return {
      ok: false,
      reason: '`identityMail` cannot be set through this door: identity mail is sent by the server itself. Omit it.',
    };
  }

  const rest = { ...message };
  delete rest.organizationId;
  delete rest.identityMail;
  delete rest.sentBy;
  return {
    ok: true,
    input: {
      ...rest,
      ...(caller.userId !== undefined ? { sentBy: caller.userId } : {}),
      ...(organizationId !== undefined ? { organizationId } : {}),
      ...(from !== undefined ? { from } : {}),
    },
  };
}
