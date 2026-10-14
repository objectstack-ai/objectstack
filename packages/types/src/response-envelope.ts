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
import { logServerFault, type ServerFaultRequest } from './server-fault-log.js';

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
 * Commit 79c46da90's producer-side opt-in (maintainer ruling 2026-08-19 on objectui#5210,
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
  // [#14310] A 5xx is never silent. This writer and {@link sendServerFault}
  // are the two exits for every nested-envelope error in the repo, and each
  // logs the line itself, so the rule is applied at the writer rather than at
  // each registrar's catch block — a per-door call is a thing a new door can
  // forget, and the `/api/v1/packages` 500 that motivated the card went
  // unlogged for a week through exactly such a door.
  //
  // ⛔ Not a second opinion about the answer: `logServerFault` reads the same
  // `status` this call is about to write, and its own 5xx gate keeps every
  // deliberate 4xx refusal — the coded `409 DESTRUCTIVE_CHANGE`, the
  // `403 FORBIDDEN` capability denials above it — as quiet as they were.
  //
  // The thrown value is not available here (callers resolve it into `message`
  // before arriving), so this line carries the message and code rather than a
  // stack. A door still holding a CAUGHT fault answers through
  // {@link sendServerFault} instead, which logs the throw with its stack and
  // writes the route's generic text — one line, not this one plus its own.
  logServerFault({ status, code, message, ...(extra?.requestId ? { request: { requestId: extra.requestId } } : {}) });
  writeErrorEnvelope(res, status, code, message, extra);
}

/**
 * [#23174] Answer a CAUGHT fault: the route's own generic text on the wire,
 * and the caught error, stack included, in the fault log, as one line.
 *
 * ## The hole this closes
 *
 * {@link sendError} writes the `message` it is handed, verbatim, at every
 * status. That is right for a 4xx, and right for an AUTHORED 5xx: product copy
 * a consumer renders, or a branded error relaying the code and message its
 * producer declared. It is wrong for a route's catch-all arm,
 * `sendError(res, 500, 'INTERNAL', err?.message ?? 'Internal error')`, whose
 * `message` is whatever the caught error happened to say. For an adapter or a
 * driver error that text names server internals. The REST door has withheld it
 * since #5437 ("a declared 5xx never ships its own message text"), but that
 * door writes the FLAT dialect and lives in a package the route families
 * answering THIS envelope cannot import, and no export they could reach carried
 * the decision. So each family's catch-all shipped the caught text.
 *
 * ## What it decides
 *
 *  - **The wire carries `message`, the route's generic text, and nothing of
 *    `thrown`.** The thrown value has no path into the body: it is handed to
 *    the log and nowhere else.
 *  - **The operator keeps the text.** `thrown` goes to {@link logServerFault}
 *    with its stack, as the ONE line this fault costs. Calling
 *    `logServerFault` and then `sendError` logs that line plus `sendError`'s
 *    own stackless one; this writer shares `sendError`'s envelope write and
 *    not its log call, so a converted arm logs once.
 *  - **`request` names the MOUNTED route pattern, when a door passes one.**
 *    ⛔ Never the request URL: on a token route the last path segment is a
 *    live capability token, and a log line is no place for it.
 *
 * ## What the caller decides
 *
 * Which arm is a catch-all. ⛔ The rule withholds only text that came from a
 * caught error; it is not widened to authored copy. An authored 5xx stays on
 * `sendError` with its text: a refusal the console renders as the operator's
 * prescription, a branded outage relaying its own declared code and message.
 * So does every 4xx, where a caller-facing message is the answer by design.
 *
 * `status` is expected to be a 5xx, the band {@link logServerFault} logs. The
 * same funnel rules apply as for `sendError`, unchanged: one record per fault,
 * and the #14656 capability-absence quieting reads the `code` passed here.
 */
export function sendServerFault(
  res: EnvelopeResponse,
  status: number,
  code: ErrorCode,
  message: string,
  thrown: unknown,
  request?: ServerFaultRequest,
): void {
  logServerFault({ status, code, error: thrown, message, ...(request ? { request } : {}) });
  writeErrorEnvelope(res, status, code, message);
}

/**
 * The ONE write of the declared error envelope. Module-private: the exported
 * writers above decide what is logged and what text is written, and this only
 * writes it, so the envelope's error shape still lives in one place.
 */
function writeErrorEnvelope(
  res: EnvelopeResponse,
  status: number,
  code: ErrorCode,
  message: string,
  extra?: Pick<ApiError, 'category' | 'httpStatus' | 'details' | 'requestId' | 'declaredCode' | 'userMessage'>,
): void {
  res.status(status).json({ success: false, error: { code, message, ...extra } });
}
