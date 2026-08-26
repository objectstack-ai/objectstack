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
 * beside `code` and `message` — `details`, `category`, `requestId`,
 * `httpStatus`, `declaredCode`, `userMessage`.
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
 *
 * ## `declaredCode` — declared by the schema, barred by this writer
 *
 * ADR-0112's 2026-08-17 amendment (#9106, extended to the flat `/data` door by
 * #9232) rules the demote at EVERY door: `code` stays the closed vocabulary,
 * and a thrown code that is not a member is demoted to a declared sibling,
 * `ApiError.declaredCode` — the open, author-authored channel that carries a
 * metadata app's OWN `.code` across the QuickJS boundary (#7867) and onto the
 * wire.
 *
 * `ApiErrorSchema` has declared that field since #9106 and the flat door emits
 * it, but it was absent from the `Pick` above — so it was a COMPILE ERROR for
 * any route answering the NESTED envelope to pass one, and every such route
 * dropped the producer's spelling. Nothing invalid shipped (the closed `code`
 * still carried the derived member), which is what made the loss silent and
 * one-directional: the author's spelling gone, and a consumer told by the ADR
 * to read `declaredCode` finding nothing there. Declared-but-unemittable is a
 * `declared = enforced` gap, and admitting the field closes it at the ONE
 * writer rather than in each module that later notices.
 *
 * ⛔ Presence MEANS demotion, and this writer does not re-derive that — the
 * CALLER does, with `demotedDeclaredCode` (`thrown-http-error.ts`, one file
 * over), exactly as the flat door's `thrownCodeFields` already does. That
 * helper answers `undefined` when the producer's spelling IS the vocabulary
 * member already sitting in `code`, which is what stops a registered refusal
 * from carrying two spellings of one fact — `ApiErrorSchema.declaredCode`'s
 * documented invariant. Passing a raw `thrown.declaredCode` re-opens exactly
 * that, and no type here can catch it: vocabulary and position stay two
 * decisions (#9232), so the demotion rule stays with the resolver that owns
 * it rather than being restated in the envelope writer.
 *
 * ## `userMessage` — the second declared channel, and why this `Pick` stays explicit
 *
 * #9934's producer-side opt-in (maintainer ruling 2026-08-19 on objectui#5210,
 * option 1) declares `ApiError.userMessage`: the text a producer marked, AT
 * THROW TIME, as addressed to the END USER. Presence IS the marking — a
 * consumer that sees the field renders it verbatim and keeps its generic
 * substitution (#3821) for everything unmarked.
 *
 * The schema declared it and this writer barred it, with the same
 * one-directional silence `declaredCode` had: the other two doors already emit
 * it — the flat `/data` door through `withDeclaredUserMessage`
 * (`rest/error-response.ts`) and the dispatcher door through
 * `thrown.userMessage` (`runtime/http-dispatcher.ts`) — while a route
 * answering the NESTED envelope could not, so an author's deliberate,
 * localized refusal text was dropped on this door alone. Nothing invalid
 * shipped; the text simply was not there.
 *
 * The channel is live on both ends, which is what makes admitting it a repair
 * rather than a new declared-but-dead surface: a hook sets it at throw time —
 * host-side, or a metadata app's sandboxed body whose `e.userMessage` crosses
 * the QuickJS boundary through `SANDBOX_ERROR_PASSTHROUGH`
 * (`runtime/sandbox/quickjs-runner.ts`) — and `resolveThrownHttpError` already
 * carries it onto `ThrownHttpError` for every caller of the shared resolver.
 *
 * ⛔ Unlike `declaredCode`, this field carries NO invariant for the caller to
 * re-derive. `declaredCode`'s presence MEANS demotion, so its caller passes
 * `demotedDeclaredCode(thrown)` rather than the raw field; `userMessage`'s
 * presence means only that the producer opted in, and `declaredUserMessage`
 * has already decided that (a non-empty string, or nothing at all). The caller
 * passes `thrown.userMessage` straight through, exactly as the dispatcher door
 * does.
 *
 * That difference is why `extra` stays an explicit `Pick` rather than becoming
 * "every optional field of `ApiError`". A derivation would admit each future
 * optional on the day it lands, with nobody asked whether that channel should
 * cross this door or what obligation it hands the caller — and the two fields
 * above needed opposite answers to exactly that question. Recorded for the next
 * reader, because it is the honest cost: with `userMessage` admitted the `Pick`
 * now names ALL SIX of `ApiError`'s optional fields, so this gate has to date
 * rejected none. What it has produced is a different caller obligation per
 * field, which a derivation cannot produce at all.
 */
export function sendError(
  res: EnvelopeResponse,
  status: number,
  code: ErrorCode,
  message: string,
  extra?: Pick<ApiError, 'category' | 'httpStatus' | 'details' | 'requestId' | 'declaredCode' | 'userMessage'>,
): void {
  res.status(status).json({ success: false, error: { code, message, ...extra } });
}
