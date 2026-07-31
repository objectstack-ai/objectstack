// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The ONE writer for the declared REST response envelope (#3973).
 *
 * `BaseResponseSchema` (`packages/spec/src/api/contract.zod.ts`) declares one
 * envelope for every REST body the platform emits:
 *
 *     { success: true,  data }
 *     { success: false, error: { code, message } }
 *
 * The schema declares it once. Until this file, the code that *wrote* it was
 * copied per route module — seven `sendOk` / `sendError` pairs after #3843 and
 * #3983 converted the last drifting one, so the envelope's shape lived in
 * fourteen places rather than one.
 *
 * ## Why a shared builder rather than seven agreeing copies
 *
 * `scripts/check-route-envelope.mjs` proves the copies agree today, and that is
 * exactly why this is a cleanup and not a bug fix. But a guard proves agreement;
 * it does not create it. An eighth module starts by copying the pair again —
 * which is not hypothetical, it is the observed history: `share-link-routes.ts`
 * was found by the repo-wide scan already drifting, and its drift had broken
 * `client.shareLinks.create()` / `.list()` through `unwrapResponse` (#3983).
 *
 * ## Why here
 *
 * Placement was the open question in #3973, not design. `packages/spec` is
 * schemas-only (Prime Directive #2), and the callers span `packages/rest`, four
 * `services/*` and one `plugins/*`, which rules out anything that depends on
 * them. `@objectstack/types` depends on nothing but `@objectstack/spec`, so
 * every caller can reach it, and it is where the repo already puts a helper the
 * HTTP boundaries share: {@link looksLikeInternalErrorLeak} lives one file over
 * for the same reason, and made the same argument first — "do not ship driver
 * internals to clients" is a property of the boundary, not of one router.
 *
 * Writing the declared envelope is the same kind of property.
 *
 * ## What this does NOT change
 *
 * Every byte on the wire. The seven pairs were already identical modulo the
 * optional `status` and `extra` parameters unioned below; this file is their
 * union, and each module's driven conformance suite still parses its real
 * bodies against the real spec schemas.
 *
 * The dispatcher surface (`packages/runtime/src/domains/*`) is deliberately not
 * a caller: those handlers RETURN `{ status, body }` for a central sender rather
 * than writing to a response, so they are already consolidated behind their own
 * `deps.success` / `deps.error` helpers and audited by the other half of
 * `check-route-envelope.mjs`.
 */

import type { ApiError, ErrorCode } from '@objectstack/spec/api';

/**
 * The only thing an envelope builder needs from a response object.
 *
 * Structural on purpose, so this file depends on no HTTP contract at all:
 * `IHttpResponse` (`@objectstack/spec/contracts`) satisfies it, and so does the
 * `any`-typed `res` the three older route modules still carry. That is what lets
 * a package import the builders without also importing a server abstraction.
 */
export interface EnvelopeResponse {
  status(code: number): EnvelopeResponse;
  json(body: unknown): unknown;
}

/**
 * Emit a success body in the DECLARED envelope — `{ success: true, data }`.
 *
 * `data` carries the route's payload; it is not spread. A payload duplicated
 * into a stray top-level key (`{ success: true, data: link, link }`) parses
 * clean against `BaseResponseSchema` and is still drift — that shipped on
 * `/share-links` for as long as nobody looked (#4038), which is why
 * `envelopeViolations` exists beside the schema and why there is one `data`
 * slot here rather than a spread.
 *
 * `status` defaults to 200 and is set explicitly even then. Five of the seven
 * modules already did that; the two that called `res.json(...)` bare are
 * unaffected, because the default they were relying on is the value now passed.
 */
export function sendOk(res: EnvelopeResponse, data: unknown, status = 200): void {
  res.status(status).json({ success: true, data });
}

/**
 * Emit an error in the DECLARED envelope — `{ success: false, error: { code,
 * message } }`, with `code` a semantic STRING and `message` a field OF `error`
 * rather than a sibling of it.
 *
 * Both halves of that sentence were once wrong somewhere: `error` was a bare
 * string in `service-storage` and `admin-routes` (so `body.error.message` read
 * `undefined`), and `code` was the human message in `package-routes` (#3675 →
 * #3689 → #3843).
 *
 * ## `code` is the closed ADR-0112 vocabulary, not `string`
 *
 * All seven copies typed this parameter `string`, so an invented code was caught
 * only at runtime, by a conformance suite parsing a driven body against
 * `ApiErrorSchema` — i.e. only on the routes a test happened to drive. `ErrorCode`
 * is `StandardErrorCode ∪ ERROR_CODE_LEDGER` (`error-code-ledger.zod.ts`), the
 * same union that schema validates against, so consolidating here moves the check
 * to compile time for every call site at once. It cost no call-site churn: every
 * code the seven modules emit was already registered.
 *
 * A new code is registered in `ERROR_CODE_LEDGER` under its owning package —
 * and if the condition is generic (not found / permission / validation), the
 * standard catalog is used instead of registering a synonym for it.
 *
 * ## `extra` is `ApiError`'s own optional fields, not a `Record`
 *
 * Merged into `error`, and typed as exactly what `ApiErrorSchema` declares
 * beside `code` and `message` — `details`, `category`, `requestId`, `httpStatus`.
 * `details` is the slot for structured context: `package-routes` puts a partial
 * delete's per-item failures there, `settings-routes` the whole
 * `SettingsActionResult`.
 *
 * This started as `Record<string, unknown>`, because `settings-routes` also hung
 * `namespace` / `key` / `reason` / `fields` beside `code`, which the schema does
 * not declare. Those bodies passed every gate anyway — `ApiErrorSchema` is a
 * plain `z.object`, so unknown keys were STRIPPED rather than rejected, and
 * `envelopeViolations` inspects only the body's top level — making them
 * conformant *by stripping* rather than by declaration. #4224 moved that module's
 * four branches onto `details`, which is what lets the parameter close here.
 *
 * Closing it at the shared builder is the part that lasts: an undeclared sibling
 * is now a compile error in every module at once, rather than a key that quietly
 * evaporates at the schema boundary in whichever module reintroduces it.
 */
export function sendError(
  res: EnvelopeResponse,
  status: number,
  code: ErrorCode,
  message: string,
  extra?: Pick<ApiError, 'category' | 'httpStatus' | 'details' | 'requestId'>,
): void {
  res.status(status).json({ success: false, error: { code, message, ...extra } });
}
