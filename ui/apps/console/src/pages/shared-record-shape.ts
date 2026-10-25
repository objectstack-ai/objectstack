// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The wire shape of `GET /api/v1/share-links/:token/resolve`, and the one place
 * that folds it into what {@link ../pages/SharedRecordPage} renders.
 *
 * Separate from the page because it is pure — the page's own module pulls in the
 * chat renderer and the whole app-shell graph, which a shape test should not have
 * to load.
 */

import type { RegisteredErrorCode } from '@objectstack/spec/api';

/**
 * The request header a link's password travels in (objectui#11649).
 *
 * Both producers read it under this name on both public routes, `/resolve` and
 * `/messages`: the sharing plugin through its `presentedPassword` helper, the
 * runtime dispatcher's `/share-links` domain through `headerOf('x-share-password')`.
 * Header names are case-insensitive, and the server's CORS allow-list spells it
 * this way. Read once, from objectstack's source at the 17.7.0 release this
 * console resolves; nothing in this repo re-derives it.
 *
 * ⛔ Never the `?password=` query parameter. A request URL ends up in every
 * server, proxy and CDN log that records URLs, and in a captured network trace;
 * a header does not. At that same release the server still reads the parameter, and reads it
 * FIRST, for older clients — so a page that sent both would still be sending the
 * password in the URL. This page sends the header alone.
 */
export const SHARE_PASSWORD_HEADER = 'X-Share-Password';

/**
 * Whether `password` can travel in {@link SHARE_PASSWORD_HEADER} at all.
 *
 * A header value is a byte string: the Fetch standard's `Headers` refuses, with
 * a `TypeError` and before any request leaves, a value with a character above
 * U+00FF — a CJK or emoji password throws, `café` goes through. Measured once,
 * in Chromium and in Node's own `Headers`, for objectui#11649; nothing in this
 * repo re-derives it, because the test environment's `Headers` (happy-dom) does
 * not enforce the rule — the shape test pins this guard, not the platform. The
 * server reads the header as it arrives and declares no encoding for it, so the
 * page cannot transcode such a password either — and ⛔ it may not fall back to
 * the URL. The page says so instead of surfacing the `TypeError`.
 */
export function canSendSharePassword(password: string): boolean {
  for (const ch of password) {
    if ((ch.codePointAt(0) ?? 0) > 0xff) return false;
  }
  return true;
}

/**
 * The headers for a request to one of the public share-link routes. The password
 * header is present only when the visitor has entered a password.
 */
export function shareRequestHeaders(password?: string): Record<string, string> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (password) headers[SHARE_PASSWORD_HEADER] = password;
  return headers;
}

/**
 * What a `401` from resolve asks of the visitor.
 *
 * - `needs-password` — the link is protected and no password was sent.
 * - `wrong-password` — a password was sent and it did not match.
 * - `sign-in-required` — the link is shared with signed-in users only. A
 *   password prompt is the wrong answer here: no password opens it.
 */
export type ResolveGate = 'needs-password' | 'wrong-password' | 'sign-in-required';

/**
 * The `error.code` of each gate, as both producers send it. Typed against the
 * spec's error-code ledger, so a code the server never registered does not compile.
 */
const RESOLVE_GATE_BY_CODE = {
  NEEDS_PASSWORD: 'needs-password',
  WRONG_PASSWORD: 'wrong-password',
  SIGN_IN_REQUIRED: 'sign-in-required',
} as const satisfies Partial<Record<RegisteredErrorCode, ResolveGate>>;

/** The refusal envelope both producers answer with: `{ success: false, error: { code, message } }`. */
export interface ResolveErrorBody {
  error?: { code?: string; message?: string };
}

/**
 * Read which gate a `401` from resolve names. `null` for any other code: the page
 * then shows the server's message rather than guessing at a prompt.
 */
export function resolveGateOf(body: ResolveErrorBody | null | undefined): ResolveGate | null {
  const code = body?.error?.code;
  if (!code || !Object.prototype.hasOwnProperty.call(RESOLVE_GATE_BY_CODE, code)) return null;
  return RESOLVE_GATE_BY_CODE[code as keyof typeof RESOLVE_GATE_BY_CODE];
}

export interface ShareLink {
  id: string;
  token: string;
  object_name: string;
  record_id: string;
  permission: 'view' | 'comment' | 'edit';
  audience: string;
  expires_at?: string | null;
  label?: string | null;
}

/** What the page renders. Note `redactedFields` — see {@link normalizeResolvedShare}. */
export interface ResolvedShare {
  link: ShareLink;
  record: Record<string, unknown>;
  redactedFields?: string[];
}

/**
 * The resolve payload AS IT ARRIVES — `redactFields`, the server's spelling.
 * Keeping this named apart from {@link ResolvedShare} is what stops the enveloped
 * branch from silently skipping the rename, which is what it did before
 * objectstack#3983.
 */
export interface WireResolvedShare {
  record?: unknown;
  link: ShareLink;
  redactFields?: string[];
}

/** Either producer's body: enveloped (`{ success, data }`) or bare. */
export type ResolveResponseBody = { data?: WireResolvedShare } & Partial<WireResolvedShare>;

/**
 * Fold either producer's resolve body into {@link ResolvedShare}.
 *
 * Two producers serve this route: the sharing plugin's routes and the runtime
 * dispatcher's `/share-links` domain (the designed primary surface for cloud's
 * per-environment kernels). Both answer the same three fields; only the envelope
 * differs, and the dispatcher has always enveloped them — objectstack#3983 moved
 * the plugin onto the same shape, so the bare branch is what a pre-#3983 server
 * still sends.
 *
 * The rename is the point. The wire spells it `redactFields`; the page reads
 * `redactedFields`. Only the BARE branch used to do that mapping — the enveloped
 * one handed `body.data` straight through — so on the dispatcher path
 * `redactedFields` was always `undefined` and the "fields are hidden by the owner"
 * notice never rendered, on exactly the pages where fields WERE being stripped.
 */
export function normalizeResolvedShare(body: ResolveResponseBody): ResolvedShare {
  const wire = (body.data ?? body) as WireResolvedShare;
  return {
    record: (wire.record ?? {}) as Record<string, unknown>,
    link: wire.link,
    redactedFields: wire.redactFields,
  };
}
