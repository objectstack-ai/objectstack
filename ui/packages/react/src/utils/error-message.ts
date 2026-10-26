/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Helpers for turning a failed data-source read or write into user-facing
 * feedback.
 *
 * Different DataSource adapters throw differently shaped errors:
 *   - the ObjectStack adapter (`@object-ui/data-objectstack`) decorates the
 *     thrown Error with `httpStatus` + a machine-readable `code` and puts the
 *     server text on `.message` (sometimes also a parsed body on `.details`);
 *   - `ApiDataSource` appends the raw JSON response body as a tail on the
 *     message string (`… — {"error":…,"code":…}`).
 *
 * These helpers normalise across both so a caller's `catch` can surface the
 * real reason (e.g. a row-level-security denial) instead of swallowing it.
 */

import { isApiAccessDeniedError } from '@object-ui/data-objectstack';
import type { ApiError } from '@objectstack/spec/api';

/**
 * The producer-side user-facing marking, taken from the SPEC's own declaration
 * rather than a key name typed out here.
 *
 * `ApiError` is `z.input<typeof ApiErrorSchema>` in `@objectstack/spec/api`, so
 * this `Pick` stops compiling the moment the contract renames the field or
 * changes its type — the pin test below it (`error-message.test.ts`) makes the
 * same assertion at RUNTIME against `ApiErrorSchema.shape`, because a type-only
 * check passes against a stale `.d.ts`.
 */
type MarkedRefusal = Pick<ApiError, 'userMessage'>;

function firstString(...vals: unknown[]): string | null {
  for (const v of vals) {
    if (typeof v === 'string' && v.trim()) return v;
  }
  return null;
}

/**
 * Pull a clean, human-readable message out of a failed write. Strips noisy
 * backend prefixes (`[Security] `, `PERMISSION_DENIED: `) so it reads well in a
 * toast — mirrors `plugin-detail`'s `cleanError`. Returns `null` when nothing
 * usable can be extracted, so callers fall back to a generic localized string.
 */
export function extractWriteErrorMessage(err: unknown): string | null {
  const e = err as Record<string, any> | null | undefined;

  // 1) Structured server body, when the adapter attaches one.
  let msg =
    e && typeof e === 'object'
      ? firstString(e.details?.error, e.details?.message, e.error)
      : null;

  // 2) Otherwise the Error message itself. ApiDataSource embeds the raw JSON
  //    response body as a tail — parse it out when present.
  if (!msg) {
    const raw =
      err instanceof Error
        ? err.message
        : typeof err === 'string'
          ? err
          : typeof e?.message === 'string'
            ? e.message
            : '';
    const brace = raw.indexOf('{');
    if (brace >= 0) {
      try {
        const body = JSON.parse(raw.slice(brace));
        msg = firstString(body?.error, body?.message);
      } catch {
        /* tail wasn't JSON — fall through to the raw message */
      }
    }
    if (!msg && raw.trim()) msg = raw;
  }

  if (!msg) return null;
  const clean = msg
    .replace(/^\[[^\]]+\]\s*/, '')
    .replace(/^[A-Z][A-Z0-9_]+:\s*/, '')
    .trim();
  return clean || null;
}

/**
 * The refusal text the PRODUCER explicitly marked as addressed to the end user,
 * or `null` when the refusal carries no marking.
 *
 * `userMessage` is the opt-in channel added by objectstack `79c46da90` (maintainer
 * ruling 2026-08-19 on objectui#5210), declared on `ApiErrorSchema` /
 * `EnhancedApiErrorSchema` in the pinned `@objectstack/spec`.
 * Three properties of the contract decide this reader's whole shape:
 *
 *   - **Presence IS the marking.** The mark and the marked text are ONE value —
 *     a field carrying the text, not a boolean beside `message` — so no boundary
 *     that rewraps or substitutes `message` can promote platform prose into the
 *     marked channel. Platform and driver code never set it.
 *   - **Status-agnostic.** Not a 403 special case; any refusal status may carry
 *     it. Callers must not gate this read on a status.
 *   - **Verbatim.** The author wrote it for their user, already localized. It is
 *     returned untouched — none of {@link extractWriteErrorMessage}'s prefix
 *     stripping applies, because there is no machine prefix to strip.
 *
 * Read from the two places the adapter boundary parks the envelope, both under
 * the SAME declared key: the error itself (`@objectstack/client` lifts a marked
 * body onto `err.userMessage`, from either wire dialect) and `details`, which
 * the client falls back to the whole response body — the identical pair
 * {@link isPermissionError} reads `code` from. Deliberately NOT read: the raw
 * JSON tail `ApiDataSource` bakes into its message string. Scraping a marking
 * out of a transport's prose is the consumer-side guessing objectstack#3821
 * exists to prevent; a transport that flattens the envelope should carry the
 * field instead.
 *
 * Everything unmarked answers `null`, so callers keep their generic localized
 * substitution and objectstack#3821's protection holds BY CONSTRUCTION: this
 * function can never return text the producer did not opt in.
 */
export function declaredUserMessage(err: unknown): string | null {
  if (!err || typeof err !== 'object') return null;
  const e = err as Partial<MarkedRefusal> & { details?: unknown };
  // Non-empty after trimming, returned untrimmed — the same predicate
  // `@objectstack/client` applies when it lifts the field off the wire.
  if (typeof e.userMessage === 'string' && e.userMessage.trim()) return e.userMessage;
  const details = e.details as Partial<MarkedRefusal> | null | undefined;
  if (details && typeof details === 'object'
      && typeof details.userMessage === 'string' && details.userMessage.trim()) {
    return details.userMessage;
  }
  return null;
}

/** One field the server rejected, normalised for `form.setError`. */
export interface WriteFieldError {
  /** Field name, matching the form control's `name`. */
  field: string;
  /** Human-readable reason, already localized by the server when it can be. */
  message: string;
}

/**
 * Per-field errors from a rejected write, or `null` when the failure was not
 * field-scoped.
 *
 * The server has always sent these. `@objectstack/objectql`'s validators throw
 * `{ code: 'VALIDATION_FAILED', fields: [{ field, code, message }] }`, and both
 * the REST layer and the runtime dispatcher serve that as a 400 with `fields[]`
 * intact. What was missing was the last hop: every form caught the rejection,
 * showed one generic toast, and dropped `fields[]` on the floor — so a user told
 * "Validation failed" had to guess WHICH input was wrong, on a surface that
 * already knows how to mark it.
 *
 * Reads three shapes, because the error can arrive from either side of the
 * adapter boundary:
 *   - `validationErrors` — a `ValidationError` from `@object-ui/data-objectstack`;
 *   - `details.fields` — the raw `@objectstack/client` error, whose `details`
 *     falls back to the whole response body;
 *   - `fields` — a hand-rolled error of the same shape (the server duck-types
 *     these identically, so we do too).
 *
 * Entries without a usable `field` are dropped rather than guessed at: a wrong
 * mark on an innocent input is worse than the generic toast we already show.
 */
export function extractFieldErrors(err: unknown): WriteFieldError[] | null {
  const e = err as Record<string, any> | null | undefined;
  if (!e || typeof e !== 'object') return null;

  const raw: unknown =
    (Array.isArray(e.validationErrors) && e.validationErrors) ||
    (Array.isArray(e.details?.fields) && e.details.fields) ||
    (Array.isArray(e.fields) && e.fields) ||
    null;
  if (!raw || !Array.isArray(raw)) return null;

  const out: WriteFieldError[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const rec = entry as Record<string, unknown>;
    const field = firstString(rec.field, rec.name, rec.path);
    if (!field) continue;
    // `code` is the machine enum (`required`, `invalid_option`, …). It is a
    // last resort only: the server builds `message` to be shown verbatim, and
    // an untranslated enum in the UI reads as a bug.
    const message = firstString(rec.message, rec.error, rec.code) ?? '';
    out.push({ field, message });
  }
  return out.length > 0 ? out : null;
}

/**
 * True when a failed write was rejected for authorization reasons (HTTP 403 /
 * `PERMISSION_DENIED` / `FORBIDDEN` / a row-level-security denial). Lets a
 * caller show a friendly "you don't have permission" toast rather than dumping
 * the raw server text.
 */
export function isPermissionError(err: unknown): boolean {
  const e = err as Record<string, any> | null | undefined;
  if (!e || typeof e !== 'object') return false;
  const status = e.httpStatus ?? e.status ?? e.statusCode;
  if (status === 403) return true;
  const code = firstString(e.code, e.details?.code) ?? '';
  if (code === 'PERMISSION_DENIED' || code === 'FORBIDDEN') return true;
  const text = `${typeof e.message === 'string' ? e.message : ''} ${
    e.details?.error ?? e.error ?? ''
  }`;
  return /row-level security|access denied|permission denied|not permitted/i.test(
    text,
  );
}

/** 400-class error codes the data API returns for a request it will never accept. */
const REJECTED_REQUEST_CODES = new Set([
  'INVALID_FILTER',
  'UNSUPPORTED_QUERY_PARAM',
  'INVALID_QUERY',
]);

/** What {@link classifyLoadError} answers. */
export type LoadErrorKind = 'api-disabled' | 'forbidden' | 'unauthorized' | 'rejected' | 'network';

/**
 * Classify a failed data FETCH (as opposed to a failed write, above) by HTTP
 * status / error code, so an error panel can say what actually happened. A
 * 403 rendered as "check your connection" is indistinguishable from a real
 * outage — users were told to debug their network when the server had
 * (correctly) denied them access.
 *
 * Originally `ListView`'s module-local `classifyLoadError`
 * (`packages/plugin-list/src/ListView.tsx`); lifted here (objectui#4693) so
 * `RecordAttachmentsPanel` can reuse the same "is this retry-invariant"
 * verdict for the `sys_attachment` list read instead of re-deriving it. Both
 * `@object-ui/plugin-list` and `@object-ui/app-shell` already depend on this
 * package, so the lift adds no new dependency edge to either.
 *
 * Purely a classifier — it returns a KIND, never rendered text. Each caller
 * owns its own copy for what a kind means on its surface (`ListView` shows a
 * title + message per kind and a Retry for every kind but `api-disabled`;
 * `RecordAttachmentsPanel` only distinguishes `api-disabled` from everything
 * else, folding `forbidden`/`unauthorized`/`rejected`/`network` into its own
 * coarser `denied`/`unavailable` split via {@link isPermissionError}) — so
 * lifting this function does not couple the two surfaces' i18n or copy.
 */
export function classifyLoadError(err: unknown): LoadErrorKind {
  const e = err as any;
  // The ObjectStack client decorates errors with `httpStatus`; raw fetch
  // wrappers surface `status` / `statusCode`; some adapters only embed the
  // status in the message ("HTTP 403 Forbidden — …").
  let status = [e?.httpStatus, e?.status, e?.statusCode]
    .find((s: unknown): s is number => typeof s === 'number');
  if (status === undefined) {
    const m = /HTTP (\d{3})\b/.exec(String(e?.message ?? ''));
    if (m) status = Number(m[1]);
  }
  const code = typeof e?.code === 'string' ? e.code.toUpperCase() : '';
  // The object's `enable` block withholds this operation — checked FIRST, on
  // the CODE alone (delegated to the shared predicate so this file and
  // `@object-ui/data-objectstack` cannot drift on which codes count). Status
  // cannot carry this verdict: the denial is a 404, the same status a missing
  // collection and a missing record answer with, and its 405 sibling is the
  // same status any other method rejection uses. Unlike every kind below it
  // this one is not about the request, the session or the network — it is a
  // permanent property of the object, identical for every persona and every
  // retry (objectui#4408).
  if (isApiAccessDeniedError(err)) return 'api-disabled';
  if (status === 403 || code === 'PERMISSION_DENIED' || code === 'FORBIDDEN') return 'forbidden';
  if (status === 401 || code === 'UNAUTHORIZED' || code === 'UNAUTHENTICATED') return 'unauthorized';
  // The server understood the request and refused it as malformed. Retrying
  // sends the identical bad request, so "check your connection and try again"
  // is the same wrong advice this function exists to stop giving — one status
  // code over. The server now rejects a `$filter` that is not a filter AST
  // (objectstack#4121) and an unsupported `$`-parameter, both as 400.
  if (status === 400 || REJECTED_REQUEST_CODES.has(code)) return 'rejected';
  return 'network';
}
