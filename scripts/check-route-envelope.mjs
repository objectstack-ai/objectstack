#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Response-envelope guard for the REST route modules (#3843).
 *
 * ## What it guards
 *
 * `BaseResponseSchema` (`packages/spec/src/api/contract.zod.ts`) declares ONE
 * envelope for every REST body the platform emits:
 *
 *     { success: true,  data }
 *     { success: false, error: { code, message } }
 *
 * The route *ledgers* (#3563 → #3656) audit which routes exist and whether the
 * SDK can address them — never what comes back. That is how six route modules
 * carried green `sdk` rows while emitting something else, including an `error`
 * that was a bare string, so `body.error.message` read `undefined`
 * (#3636 → #3675 → #3689 → #3843).
 *
 * ## Two surfaces
 *
 * The platform answers REST from two kinds of file, and this audits both:
 *
 *   1. **Route modules** (`*-routes.ts`) — write to a response object. Since
 *      #3973 every one of them writes through ONE shared pair — `sendOk` /
 *      `sendError` in `@objectstack/types` — so a converted module calls
 *      `res.json` zero times itself. Counted below in `MODULES`; the shared
 *      pair is pinned separately in `SHARED_BUILDER`.
 *   2. **Dispatcher domains** (`runtime/src/domains/*.ts`) — RETURN
 *      `{ status, body }` for a central sender, so they never call `res.json`
 *      and the first scan cannot see them. Counted in `DISPATCHER_DOMAINS`.
 *
 * Surface 2 was added after that blind spot cost something real: `/share-links`
 * emitted its payload under both `data` and a legacy `link` / `links` for as
 * long as nothing looked, and it was found by hand while sweeping consumers for
 * #3983 rather than by any guard (#4038).
 *
 * ## Why a whole-repo scan rather than a per-module test
 *
 * The load-bearing check is structural, not per-route: it COUNTS the sites where
 * a response gets built. A module that routes every body through the shared
 * `sendOk` / `sendError` builds none itself, so that count is fixed at ZERO and
 * does not grow with the route list — a *new* route that hand-rolls a body moves
 * it off zero and fails here, which is the one thing a driven-body test can never
 * cover (it can only drive the routes that existed the day it was written). The
 * domain table applies the same idea from the other end: a domain that answers
 * only through the `deps.*` helpers hand-builds zero responses, so any hand-built
 * one has to be classified.
 *
 * Until #3973 each module carried its own copy of the pair and so declared a
 * fixed `2 / 1 / 1`. That proved the seven copies agreed — it could not stop an
 * eighth module from copying the pair again, which is what moving them onto one
 * writer does. So what the count asserts per module is now strictly
 * stronger: not "your two builders are the enveloped ones" but "you have no
 * builders". The two write sites that remain in the whole surface are the shared
 * pair itself, pinned by `SHARED_BUILDER` below.
 *
 * #3675 / #3689 shipped this as a regex block copied into each converted
 * package. Three copies was the signal it wanted lifting (#3843 option 3), and
 * lifting it to a repo-wide scan buys the thing per-package copies structurally
 * cannot: **a module nobody thought to convert still gets audited.** Two modules
 * in the table below were found exactly that way, neither of them in #3843's
 * hand-written survey — `share-link-routes.ts` (ratcheted on discovery, converted
 * by #3983) and `hmr-routes.ts` (exempt). The first turned out to be the one where
 * the drift had actually broken SDK methods, which is the case for scanning rather
 * than surveying.
 *
 * A module discovered by the scan but absent from the table is an ERROR, not a
 * default: silently applying `0 / 0 / 0` to an unknown module would let a new
 * one pass by coincidence.
 *
 * ## Two ways to be held: full counts, or dialect facts only
 *
 * `responses` counts WRITE SITES, and that only works where the honest
 * declaration is zero: a module routing every body through the shared pair has
 * no write sites to gain or lose, so the number cannot move under an edit that
 * is not the drift being guarded.
 *
 * `packages/rest/src/rest-server.ts` is the one file where that is false, and
 * that is why it sat outside `discover()` until #7295. It is by a wide margin
 * the largest response-emitting file in the repo (#5949) — 208 write sites,
 * changing several times a day — so pinning `responses` there would go red for
 * every route added or removed, and the pressure would be to raise the ratchet
 * rather than fix anything. That is #7295's option 2, and the maintainer ruling
 * of 2026-08-10 rejected it for exactly that reason.
 *
 * What it takes instead is `dialectOnly`: the file IS audited, but only for the
 * two non-conforming error DIALECTS it emits — never for how many bodies it
 * builds.
 *
 *     { error: 'some message' }         → stringError  (the pre-#3675 dialect)
 *     { error: someMessage, code }      → siblingCode  (the second one, #7035)
 *
 * Both are the same failure one key apart: the declared envelope nests the code
 * and the message INSIDE `error`, so a consumer reading `body.error.message`
 * (#3843) or `body.error.code` reads `undefined`. And both counts move only when
 * an error SHAPE is added or removed, which is the thing being guarded — so an
 * ordinary edit to this file cannot move them, and the gate stays quiet until it
 * has something to say.
 *
 * The baselines below were measured on the file, not chosen, and the rule is
 * one-directional: they only ever tick DOWN. A higher count is a new
 * non-conforming body — fix the body. A lower one is progress, and banking it by
 * lowering the declared number is what stops ground already won from being given
 * back.
 *
 * Leaving `responses` unasserted is a deliberately narrower guarantee, not an
 * oversight, and `dialectOnly` refuses to be declared beside it. This file is
 * NOT held to "you build no bodies" — only to "you add no new dialects". The
 * `exempt` state would have said less (nothing asserted at all); a full ratchet
 * would have claimed more than a hot write-site count can honestly carry.
 * Converting the file onto the shared pair (#7035 option 1) is the end state
 * that retires this entry into an ordinary `0 / 0 / 0`.
 *
 * ## Why AST, not regex
 *
 * The three copied blocks stripped comments with two `String.replace` calls and
 * then counted `.json(` textually. That is wrong twice over:
 *
 *   1. the line-comment regex also ate `//` inside string literals, truncating
 *      the rest of that line — response writes included. A guard that
 *      under-counts passes while drift ships.
 *   2. `.json(` does not mean "write a response". `hmr-routes.ts` calls
 *      `c.req.json()` twice to READ a request body; a textual count reports it
 *      as two unenveloped responses.
 *
 * Parsing with the TypeScript AST makes both disappear: comments and literals
 * are not tokens, and the request/response distinction is a property of the
 * callee. No stripping pass is needed at all.
 *
 * ## Usage
 *
 *     node scripts/check-route-envelope.mjs              # audit (CI)
 *     node scripts/check-route-envelope.mjs --self-test  # verify the checker
 *
 * The nine sibling `check:*` scripts carry no self-test. This one does, because
 * the two bugs above were found by hand AFTER the regex version had shipped and
 * been reviewed — a guard nobody tests is a guard that silently stops guarding.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');

/**
 * Every route module in the repo, with the envelope structure it is DECLARED to
 * have. A module the scan finds that is not listed here fails — see the header.
 *
 *   responses  — response write sites (`res.json(…)`); one per envelope builder
 *   ok / err   — literal `success: true` / `success: false` (one builder each)
 *   privateOk  — literal `ok: true|false` at the TOP of a response body, i.e. a
 *                sibling of where `success` belongs: a second word for it (#3689).
 *                Inside `data` the same literal is payload, not a flag (#3983).
 *   stringError— bodies whose `error` is a bare string (the pre-#3675 dialect)
 *   siblingCode— bodies with a top-level `code` NEXT TO `error` rather than
 *                inside it (the second dialect, #7035). Nested is conformant:
 *                `{ error: { code, message } }` is what the envelope declares.
 *   ratchet    — set ONLY for a module with outstanding drift. It pins the
 *                CURRENT numbers so nothing gets worse, and names the issue that
 *                will drive them to the conformant 2 / 1 / 1 / 0 / 0 / 0.
 *   exempt     — a REASON string for a module the envelope does not govern. The
 *                counts are then not asserted at all.
 *   dialectOnly— a REASON string for a module whose write-site count is too hot
 *                to pin (see the header). Only `stringError` and `siblingCode`
 *                are asserted, both tick DOWN only, and declaring any write-site
 *                key beside it is an error. Requires a `ratchet`.
 *
 * Four states, deliberately — conformant / ratcheted / dialect-only / exempt —
 * because that is the honest classification ADR-0049 requires: a module is
 * either held to the contract, tracked as failing it, held to the part of it a
 * stable number can carry, or declared outside it *with a reason*. There is no
 * fifth state where nobody looked.
 */
const MODULES = {
  // ── Conformant (#3675, #3689, #3843, #3983 — consolidated by #3973) ──────
  //
  // All zero: every body these seven emit is written by the shared pair, so
  // none of them builds a response itself. They each declared `2 / 1 / 1` while
  // they carried their own copy of that pair.
  'packages/services/service-storage/src/storage-routes.ts': { responses: 0, ok: 0, err: 0 },
  'packages/services/service-settings/src/settings-routes.ts': { responses: 0, ok: 0, err: 0 },
  'packages/services/service-datasource/src/admin-routes.ts': { responses: 0, ok: 0, err: 0 },
  'packages/rest/src/external-datasource-routes.ts': { responses: 0, ok: 0, err: 0 },
  'packages/rest/src/package-routes.ts': { responses: 0, ok: 0, err: 0 },
  // #3636 put the right envelope on this module's three read routes but built it
  // inline in four places, so it carried a ratchet at 5 / 4 / 1 until those
  // collapsed behind a local `sendOk` — and then onto the shared one.
  'packages/services/service-i18n/src/i18n-service-plugin.ts': { responses: 0, ok: 0, err: 0 },
  // Converted by #3983, the last ratchet. This module was never emitting a
  // `success` flag at all, which broke `client.shareLinks.create()`/`.list()`
  // through `unwrapResponse`; it converged onto the shapes its dispatcher twin
  // (`runtime/src/domains/share-links.ts`) had always returned.
  'packages/plugins/plugin-sharing/src/share-link-routes.ts': { responses: 0, ok: 0, err: 0 },

  // ── Exempt ──────────────────────────────────────────────────────────────

  // A dev-only SSE endpoint (`GET|POST /api/v1/dev/metadata-events`) that closes
  // the "agent edits a source file → Studio preview refreshes" loop. Not on the
  // SDK surface and not a CRUD/metadata API, so `BaseResponseSchema` — the
  // contract for what `ObjectStackClient` unwraps — does not govern it.
  //
  // Recorded here rather than skipped, because it does emit a third shape the
  // scan should not silently pass over: it bypasses `.json()` entirely, writing
  // `new Response(JSON.stringify({ ok: true, … }))` / `{ ok: false, error: '…' }`
  // directly. If this endpoint is ever promoted to a product API, that is the
  // conversion, and deleting this entry is what surfaces it.
  'packages/metadata/src/routes/hmr-routes.ts': {
    exempt: 'dev-only SSE endpoint (/api/v1/dev/*), not on the SDK surface',
  },

  // ── Ratchet: real, tracked, NOT blessed ─────────────────────────────────
  //
  // The mechanism is how a drifting module gets recorded honestly instead of
  // being either fixed on the spot or quietly skipped. Declare current counts
  // plus a `ratchet` naming the issue.

  // Dialect-only (#7295, maintainer ruling of 2026-08-10 — option 3). The file
  // this gate was written about and never looked at: `discover()` collected
  // `*-routes.ts` plus one named exception, and the repo's largest
  // response-emitting file matched neither, so 208 hand-built write sites sat
  // outside the surface whose own header says "a module nobody thought to
  // convert still gets audited".
  //
  // `responses` is deliberately NOT declared — see the header. What is pinned
  // is the two dialects, measured on this file at branch point:
  //
  //   stringError 44 — the ~44 bodies #7035 / PR #7293 deliberately left when it
  //                    converged three `/meta` 501 sites.
  //   siblingCode 77 — invisible to every counter this gate had, which is the
  //                    half of #7035 that "add the file to the table" would have
  //                    passed in silence. Not a subset of the 44: most of these
  //                    carry a computed message (`String(err)`, `.replace(…)`),
  //                    so `stringError` cannot see them.
  //
  // Both only ever tick down. The end state is #7035 option 1 — route the file
  // through the shared sendOk/sendError — at which point this entry becomes
  // `{ responses: 0, ok: 0, err: 0 }` like every other module above.
  'packages/rest/src/rest-server.ts': {
    dialectOnly:
      'the repo\'s hottest response file (208 write sites, edited several times a day) — a `responses` ratchet would go red for edits that are not envelope drift',
    ratchet: '#9559 (option 1: convert onto the shared sendOk/sendError)',
    stringError: 44,
    // 77 → 75 (#7981): registerSecurityEndpoints' two `handleError` arms moved
    // off the `{ code, error }` sibling-code literal onto the shared
    // `respondError` helper, banking that progress per the ratchet's own rule.
    //
    // 75 → 73 (#8073): the ADJACENT registrar, `registerSecurityExplainEndpoints`,
    // followed — its two 500 arms (`EXPLAIN_FAILED`, `DELEGABLE_SCOPE_FAILED`)
    // now emit through the shared `sendError` from `@objectstack/types`.
    // Measured: merge-base (6ceffe0ac) siblingCode=75, branch head=73; the two
    // vanished sites are merge-base lines 9332/9390, both inside that function,
    // and every surviving site maps 1:1 onto a head line by the edit's own line
    // shift. `stringError` is unmoved at 44 by construction: both arms carried a
    // COMPUTED message (`msg.slice(0, 500)`), which that counter cannot see —
    // the six flat `{ code, message }` arms converted alongside them were never
    // counted by either dialect, having no `error` key at all.
    //
    // 73 → 69 (#8111): `registerSharingEndpoints` — the record-sharing family —
    // followed. Its four `{ code, error }` sites (the shared `respondSharingError`
    // literal feeding 400/403/404/409/422, plus the three verb-specific 500s
    // `SHARES_LIST_FAILED` / `SHARE_GRANT_FAILED` / `SHARE_REVOKE_FAILED`) now
    // emit through the shared `sendError` from `@objectstack/types`.
    // Measured: merge-base (2473cd2d3) siblingCode=73, branch head=69; the four
    // vanished sites are merge-base lines 9480, 9507, 9541, 9570, all inside
    // that one function, and the head has NO site left in that range while all
    // 69 survivors map 1:1 onto a head line by the edit's own line shift (0
    // before the emitter, +37 after it). `stringError`
    // is unmoved at 44 by construction: all four arms carried a COMPUTED message
    // (`msg.replace(…)`, `String(…).slice(0, 500)`), which that counter cannot
    // see — and `respond501`, converted alongside them, was never counted by
    // either dialect, having no `error` key at all.
    siblingCode: 69,
  },

  // [#8850] The ADR-0112 error/fault-classification prologue, extracted from
  // `rest-server.ts` above. A MOVE — no wire answer changed — but the two response
  // write sites it took with it (`sendError`, `handleRouteError`) left an audited
  // file for a brand-new one, and a new module outside the `*-routes.ts` convention
  // is invisible until it is named (see OFF_CONVENTION_MODULES). Declared in the
  // same PR that created it so the gap never exists.
  //
  // `responses: 2` is the first non-zero write-site count in this table, and it is
  // pinned rather than waived because this module is the OPPOSITE of `rest-server.ts`
  // on the one axis that made that file `dialectOnly`: its write sites are the two
  // doors themselves, so the count is structurally stable — it moves only if a THIRD
  // door is added, which is precisely what deserves a review.
  //
  // The `0 / 0` on both dialects is a real statement and not a formality, but read
  // it for what it is: both sites write `resolved.body`, an IDENTIFIER, and the
  // dialect counters only see object literals. So the flat `{ error, code }` shapes
  // that `mapDataError` builds are not counted here — nor were they counted in
  // `rest-server.ts` before the move, for the same reason. What these zeros pin is
  // that no NEW literal body gets written at this boundary without a reviewer
  // seeing the number change. Measured at extraction, not chosen.
  //
  // `ratchet` for the same reason `rest-server.ts` carries one: `responses: 2` IS
  // outstanding drift by this table's own definition (the conformant state is 0 —
  // every body through the shared pair), and #7035 option 1 is its end state. When
  // that lands, this entry becomes `{ responses: 0, ok: 0, err: 0 }` like the seven
  // above and the ratchet goes.
  'packages/rest/src/error-response.ts': {
    responses: 2,
    ok: 0,
    err: 0,
    ratchet: '#9559 (option 1: convert onto the shared sendOk/sendError)',
  },
};

/** Identifiers whose `.json()` READS a request rather than writing a response. */
const REQUEST_RECEIVERS = new Set(['req', 'request']);

/**
 * The one file that writes the envelope for surface 1, and the counts that make
 * it that file (#3973).
 *
 * Every zero in `MODULES` above is only meaningful because these two write sites
 * exist somewhere: a module can reach `0 / 0 / 0` either by routing everything
 * through the shared pair, or by answering nothing at all. Pinning the pair here
 * keeps the invariant total rather than per-module — two write sites, one
 * `success: true`, one `success: false`, for every REST body the route modules
 * emit.
 *
 * It also makes deleting or relocating the builders a loud failure instead of a
 * silent one: the path is asserted to exist, so moving it without updating this
 * line fails the gate rather than quietly leaving nothing pinned.
 */
const SHARED_BUILDER = {
  file: 'packages/types/src/response-envelope.ts',
  counts: { responses: 2, ok: 1, err: 1 },
};

// ── The dispatcher's OTHER surface ───────────────────────────────────────────

/**
 * `packages/runtime/src/domains/*.ts` — the dispatcher domain handlers.
 *
 * These serve REST paths too, but they never call `res.json(...)`: they RETURN
 * `{ status, body }` for a central sender. So the scan above cannot see them, by
 * construction — which is not a theoretical gap. `/share-links` emitted the
 * payload under both `data` and a legacy `link` / `links` for as long as that
 * blind spot existed, and it was found by hand while sweeping consumers for
 * #3983, not by any guard (#4038).
 *
 * The structural fact here is the mirror of `responses` above. A domain that
 * routes every answer through the `deps.success` / `deps.error` /
 * `deps.routeNotFound` / `deps.errorFromThrown` helpers hand-builds **zero**
 * response literals, and cannot drift: the envelope lives in one place for all
 * of them. So this counts hand-built `response: { … }` object literals per file,
 * and a new one has to be classified rather than merged quietly.
 *
 *   handBuilt — `response:` assigned an object literal instead of a `deps.*` call
 *   note      — why those exist. REQUIRED whenever handBuilt > 0.
 *   ratchet   — set when one of them is real, tracked drift.
 *
 * Hand-building is not automatically wrong. Four kinds show up, and only the
 * last is drift:
 *
 *   1. Enveloped, but the helper cannot express the response. `deps.success`
 *      hardcodes status 200, so a 201 must be built by hand, and `deps.error`
 *      carries no headers, so a 405 with `Allow:` must be too. These emit the
 *      declared envelope — they just assemble it themselves.
 *   2. Passthrough of a body this dispatcher does not own (an upstream Web
 *      Response, another service's result). The envelope does not govern bytes
 *      we are only relaying.
 *   3. A foreign wire format a client library requires — `/auth` answers
 *      better-auth's shapes because better-auth's client parses them.
 *   4. Drift.
 */
const DISPATCHER_DOMAIN_DIR = 'packages/runtime/src/domains';

const DISPATCHER_DOMAINS = {
  'actions.ts': { handBuilt: 0 },
  'analytics.ts': { handBuilt: 0 },
  'automation.ts': { handBuilt: 0 },
  'data.ts': { handBuilt: 0 },
  'i18n.ts': { handBuilt: 0 },
  'notifications.ts': { handBuilt: 0 },
  'packages.ts': { handBuilt: 0 },
  'security.ts': { handBuilt: 0 },
  // No `storage.ts` — the `/storage` domain was retired in #4087 (it called
  // the storage contract with the wrong arity and read a Buffer as a
  // descriptor). `/api/v1/storage` is service-storage's surface; its envelope
  // is audited in that package's own routes, not here.
  'ui.ts': { handBuilt: 0 },

  // [#4093 follow-up] Not a domain — the shared 501 every mounted-but-
  // unimplemented domain answers with. It exists precisely so that refusal is
  // built in ONE place instead of once per domain, which is this check's own
  // thesis; it answers through `deps.error` like any domain body.
  'unavailable.ts': { handBuilt: 0 },

  // Kind 1 — enveloped, hand-built only because the helper cannot say it.
  'keys.ts': {
    handBuilt: 1,
    note: 'POST /keys is a 201 and `deps.success` hardcodes 200; the body is the declared envelope',
  },
  'share-links.ts': {
    handBuilt: 1,
    note: 'POST /share-links is a 201, same reason as /keys (#4038 removed the duplicate key it also carried)',
  },
  // [#8848] Was 0. `/metadata/:type/:name` used to answer EVERY non-PUT verb
  // with the ordinary metadata read — a DELETE came back `200` plus the
  // document while nothing was deleted. The restored guard answers 405, and it
  // must carry `Allow:` to name what is allowed to a machine, which
  // `deps.error` cannot express — the same reason `mcp.ts` hand-rolls its 405.
  'meta.ts': {
    handBuilt: 1,
    note: 'one 405 on /metadata/:type/:name that must carry an `Allow:` header (`deps.error` takes none); the body is the declared envelope and its code is derived from the status',
  },

  // Kinds 1 and 2 together.
  'mcp.ts': {
    handBuilt: 2,
    note: 'one 405 that must carry an `Allow:` header (`deps.error` takes none) and emits the declared envelope; one passthrough of the upstream MCP Web Response',
  },

  // Kind 3 — a foreign wire format, all four in the mock/fallback path.
  // [#4113] Was 4, for the mock fallback's better-auth-shaped bodies
  // (`{ user, session }`, `{ session: null, user: null }`, `{ success: true }`).
  // That mock is deleted — it fabricated a 200 + a 24h session for any
  // credentials — so the exemption it needed is gone with it. What remains is
  // the real service's own `Response`, returned as `result` rather than built
  // here, plus one `deps.error` 501.
  'auth.ts': { handBuilt: 0 },

  // Kind 2 — the `{ agents: [] }` fallback moved onto `deps.success` in #4053;
  // what remains is the passthrough of the AI service's own result.
  'ai.ts': {
    handBuilt: 1,
    note: "passthrough of the AI service result (status and body are the service's, streaming included)",
  },
};

// ── The plugin-mounted Hono routes: the THIRD surface ────────────────────────

/**
 * Surface 3 — a plugin that mounts its OWN Hono routes and answers with
 * `c.json(body, status)` (#9267).
 *
 * Neither scan above can see these. They do not write to a response object
 * (surface 1) and they do not return `{ status, body }` for a central sender
 * (surface 2): they call the Hono context directly, from a plugin entry point
 * that is not named `*-routes.ts`. So they were outside this gate for as long as
 * it has existed — `cloud-connection` appeared nowhere in this file — while
 * `packages/cloud-connection` alone hand-builds ~80 response bodies.
 *
 * That blind spot cost something real, twice. `UNIQUE_SCOPE_CONFIRMATION_REQUIRED`
 * reached a wire unregistered for as long as the gate was green, because the
 * body passed through neither the dispatcher's `errorFromThrown` nor
 * `packages/rest`'s responders (#9223 named the door, #9246 registered the
 * code). And eight refusals on `/api/v1/cloud-connection/*` emitted
 * `error: { code }` with no `message` at all — `ApiErrorSchema.message` is
 * REQUIRED — until #9267 measured them. The Console had already grown the
 * consumer-side accommodation that produces: it displays
 * `body?.error?.message ?? body?.error?.code`, showing a machine code to a human
 * because the readable half was never sent.
 *
 * ## What is counted, and what is deliberately NOT
 *
 * The `rest-server.ts` lesson (#7295, maintainer ruling 2026-08-10) applies here
 * in full: these files are hot — `marketplace-install-local-plugin.ts` changed
 * twice in one day — so pinning how many bodies they build would go red for
 * every route added, and the pressure would be to raise the number rather than
 * fix anything. So the TOTAL write-site count is reported and never asserted.
 *
 * What IS pinned is the count of bodies that DEPART from the declared envelope.
 * Those numbers move only when a non-conforming body is added or removed — which
 * is precisely the guarded event — so an ordinary edit cannot move them, and
 * every one of them ticks DOWN only, like the dialect ratchets above.
 *
 *   unenveloped         — a literal body with no `success` key at all. The whole
 *                         body is off-envelope, so its stray keys are NOT also
 *                         counted below: one defect, one number.
 *   errorWithoutMessage — `success: false` whose `error` literal has no
 *                         `message`, so `body.error.message` reads `undefined`.
 *                         The #3843 class, one key in from the bare string.
 *   errorCodeNotString  — `error.code` is a NUMERIC literal (the HTTP status
 *                         written into the semantic slot). `ApiErrorSchema.code`
 *                         is a string enum, so such a body fails its own
 *                         contract while looking nested and correct.
 *   strayKeys           — a body that DOES carry `success` but also a top-level
 *                         key outside `success`/`data`/`error`/`meta` — the
 *                         general form of the duplicate-payload drift (#4038).
 *   stringError         — `error` is a bare string (the pre-#3675 dialect).
 *   siblingCode         — `code` beside `error` rather than inside it (#7035).
 *
 * ## Relayed bodies are not counted, on purpose
 *
 * Every counter reads an OBJECT LITERAL. A `c.json(upstreamBody, status)` that
 * relays a control plane's own answer is invisible to all six, which is the
 * correct answer rather than a gap: this gate governs the bodies this repo
 * BUILDS, not the bytes it passes through — the same reasoning that makes a
 * dispatcher domain's passthrough "kind 2" rather than drift.
 *
 * ## Discovery is by BEHAVIOUR, not by filename
 *
 * `discoverHonoRoutes()` parses every non-test file under `packages/` and keeps
 * the ones that actually write a Hono context response. That is deliberate and
 * it is the lesson of this gate's own history: surface 1 discovers by the
 * `*-routes.ts` convention, and so `rest-server.ts` — the largest
 * response-emitting file in the repo — sat unaudited for as long as the gate
 * existed, until it was named by hand (#7295); #8884 closed the same
 * "module outside the naming convention" gap. A plugin mounting Hono routes
 * follows no naming convention at all, so a name-based surface here would have
 * to be extended by hand for every new plugin — and the one nobody remembered to
 * add is exactly the one that drifts.
 *
 * A discovered file absent from the table is an ERROR, never a default.
 *
 * ## Two ways to be held here: tracked drift, or a RULED boundary
 *
 * `ratchet` is the first. It is a measured count of bodies that depart from the
 * envelope plus the issue that will drive it to zero, and it says nothing about
 * whether the shape is acceptable — only that somebody is counting.
 *
 * `exempt` is the second, and it arrived with a maintainer ruling: 2026-08-17,
 * on #9389, option B of that card. **Pre-auth discovery/bootstrap payloads are
 * outside `BaseResponseSchema` by design.** The boundary the ruling drew is not
 * about age and not about taste — it is about WHO reads the body and WHEN:
 * these are read before authentication, by our own shells, before an envelope
 * reader exists. The SPA fetching `/api/v1/runtime/config` is deciding what to
 * boot; there is no `unwrapResponse` in the page yet, and after the flip there
 * would still be none, because the code that would do the unwrapping is what the
 * payload is being read to choose. `/bootstrap-status` is polled to decide
 * between `/login` and first-run `/setup`, by a caller that by construction has
 * no credential to authenticate with.
 *
 * Say what this is NOT, because both misreadings are available and both are
 * wrong. It is not "these are legacy" — the payloads are current and correct.
 * It is not "bare bodies are fine here" — the other entries on this surface
 * (`plugin-hono-server/src/adapter.ts`, `adapters/hono/src/index.ts`,
 * `cli/src/commands/serve.ts`) are ordinary refusals at ordinary doors, and the
 * ruling never reached them. #9364 converted them instead, which is what a
 * ratchet is FOR and the visible contrast with this block: all three are
 * conformant above. `adapters/hono/src/index.ts`'s last two counters — its
 * `{ data }` discovery bodies, pre-auth like this block but read by SDKs and
 * codegen rather than by our own shells — carried the SAME fork on a different
 * consumer population, and the maintainer ruled it the OTHER way (#9436,
 * 2026-08-18, option A: envelope them). The two rulings are one boundary read
 * from both sides: WHO reads the body decides. Our own shells, pre-auth, high
 * migration cost → exempt (here); SDKs/codegen/AI clients, one-key migration →
 * envelope (#9436). The option #9389 rejected (A: envelope the SPA surfaces,
 * flip objectui's readers, carry a skew window on the least versionable seam
 * in the product) is on record in #9389 rather than lost.
 *
 * The reason is the deliverable. The entry is only where it is written down.
 *
 * ## An `exempt` on THIS surface stays COUNTED — unlike surface 1's
 *
 * `hmr-routes.ts` (surface 1) is a whole file that is one dev-only endpoint, so
 * exempting the file and exempting the surface are the same act there, and its
 * counts are not asserted at all.
 *
 * Here they are not the same act. `plugin-auth/src/auth-plugin.ts` builds 49
 * bodies, of which THREE are the ruled `/bootstrap-status` payloads; among the
 * other 46 is the conformant `{ success: true, data: config }` of
 * `/auth/public-config`. A file-level waiver there would stop asserting anything
 * about any of them, so the next bare body added to that file — pre-auth or not
 * — would land in silence. That is precisely the state the ruling exists to end
 * ("neither enveloped nor ruled exempt"), re-entered one file at a time.
 *
 * So an `exempt` entry declares the same counters a `ratchet` does and they are
 * asserted the same way: the boundary is closed at exactly N bodies, in exactly
 * these files. A new pre-auth bare surface fails the gate until it carries its
 * own exempt-with-reason — by being declared at all if it is a new file, or by
 * moving a number and amending a reason if it is inside one of these. That
 * second path widens a ruled boundary and is therefore not an author's to take;
 * the diagnostics mark it `⛔ MAINTAINER-ONLY` (#8435).
 *
 * `ratchet` and `exempt` are mutually exclusive. A count is either tracked drift
 * heading for zero or a boundary somebody ruled; declaring both says neither.
 *
 * Where the ruling is recorded: HERE. This gate names no doc location of its own
 * — the `hmr-routes.ts` precedent's reasoning lives in this file's prose and
 * nowhere else, `content/docs/references/` is generated and must not be
 * hand-edited, and the ruling governs this table rather than the wire format
 * docs. #9389 carries the four-prism analysis and the maintainer's acceptance.
 */
const HONO_CONTEXT_RECEIVERS = new Set(['c', 'ctx']);

const PLUGIN_ROUTE_MODULES = {
  // ── Conformant ──────────────────────────────────────────────────────────
  //
  // Every hand-built body these emit is the declared envelope. They still build
  // their own — there is no shared Hono sender to route through — so the zeros
  // here mean "nothing you build departs from the contract", not "you build
  // nothing". That is a weaker claim than surface 1's `responses: 0`, and it is
  // the strongest one a hot, sender-less surface can honestly carry.
  'packages/cloud-connection/src/cloud-connection-plugin.ts': {},
  'packages/cloud-connection/src/marketplace-install-local-plugin.ts': {},
  'packages/cloud-connection/src/marketplace-proxy-plugin.ts': {},
  'packages/plugins/plugin-webhooks/src/webhook-outbox-plugin.ts': {},

  // Converted by #9364: the four refusals now answer the declared envelope,
  // `{ success: false, error: { code, message } }`, with the 405's
  // `method`/`path`/`allowed` moved into `error.details`. Conformant, so it
  // joins the zero-entries above — and `@objectstack/http-conformance`'s
  // `NodeHttpServer` mirrors these bodies byte-for-byte, locked cross-adapter
  // by `fallback-seam.conformance.test.ts`.
  'packages/plugins/plugin-hono-server/src/adapter.ts': {},

  // Converted by #9364: `{ error: 'environment_not_found', message, hostname }`
  // became the declared envelope with `ENVIRONMENT_NOT_FOUND` in the semantic
  // slot and `hostname` under `error.details`.
  'packages/cli/src/commands/serve.ts': {},

  // Converted by #9436 (maintainer ruling 2026-08-18, option A): the two
  // `{ data }` discovery bodies gained `success: true`. This file's
  // `errorCodeNotString 1` had already been removed by #9364 (the shared
  // `errorJson` wrote the HTTP status into `error.code` and now derives the
  // ADR-0112 member from it through `resolveThrownHttpError`), so this was the
  // file's last counter. The ruling deliberately did NOT extend #9389's
  // pre-auth exemption here: these bodies are read by SDKs and codegen, not by
  // our own shells, and the migration was one key.
  'packages/adapters/hono/src/index.ts': {},

  // ── Ratchet: real, tracked, NOT blessed ─────────────────────────────────
  //
  // Measured by #9267 when this surface was added, not chosen. Each entry names
  // the issue that will drive it to zero; every number ticks DOWN only. These
  // are the finding this surface was worth adding for — none of them was
  // visible to any check in the repo before it. #9436 graduated the last
  // ratcheted member (`adapters/hono`, above); the section stays because the
  // next measured drift lands here. `trigger-api` below was measured clean
  // when the surface was added and is a pinned zero, not a ratchet.
  'packages/triggers/trigger-api/src/plugin.ts': {},

  // ── Ruled exempt: the pre-auth bootstrap seam (#9389) ────────────────────
  //
  // Maintainer ruling of 2026-08-17, option B. These three entries were
  // `ratchet`ed under #9364 until that ruling: measured as drift, tracked as
  // drift, and heading for an envelope flip that was never going to be worth its
  // skew window. The ruling settled the direction instead of the schedule, so
  // the classification changes and the NUMBERS DO NOT — the count is what keeps
  // the boundary a closed list rather than a waiver. See the header on why an
  // `exempt` here stays counted where surface 1's does not, and on what the
  // ruling does and does not say.
  //
  // ⛔ No route behaviour changed with this classification, by design: the
  // payloads stay bare and the SPAs keep reading them bare. This is the gate
  // learning a ruled boundary, not the boundary moving.

  // ONE body — `GET|POST /api/v1/runtime/config`, at line 521. objectui's
  // `app-shell/src/runtime-config.ts` reads `body.cloudUrl` / `body.features` /
  // `body.branding` straight off the top level.
  'packages/cloud-connection/src/runtime-config-plugin.ts': {
    unenveloped: 1,
    exempt:
      'pre-auth discovery, ruled outside BaseResponseSchema by design (2026-08-17, #9389 option B): /api/v1/runtime/config is read by the app shell before first paint and before any credential exists, to decide what to boot — at that moment no envelope reader exists in the page to unwrap anything, and the payload is what selects the code that would be it',
  },

  // NINE bodies across three shell-bootstrap routes. Measured here, and NOT what
  // the pre-ruling note said: SIX are `{ authenticated, … }` (`/auth/me/permissions`
  // at 732/802/908/921, `/auth/me/localization` at 934/936) and THREE are
  // `{ apps }` (`/me/apps` at 958/1050/1053). What puts the whole family on the
  // pre-auth side of the boundary is that each route answers an unauthenticated
  // caller in the SAME bare shape it answers an authenticated one — a
  // `{ authenticated: false }` / `{ apps: [] }` body rather than a refusal — so
  // the anonymous case is a first-class answer here, not an error arm.
  'packages/plugins/plugin-hono-server/src/current-user-endpoints.ts': {
    unenveloped: 9,
    exempt:
      'pre-auth bootstrap, ruled outside BaseResponseSchema by design (2026-08-17, #9389 option B): the shell reads /auth/me/permissions, /auth/me/localization and /me/apps to decide what to render, and each answers an unauthenticated caller a bare `{ authenticated: false }` / `{ apps: [] }` instead of refusing — our own shells branch on that top-level field with no unwrap step in between',
  },

  // THREE bodies, all `{ hasOwner: … }` from `/bootstrap-status` (1681/1684/
  // 1687), whose own comment states the boundary: "Public, unauthenticated; only
  // returns a boolean so it can be polled before the user has any credentials."
  //
  // The count is also what keeps this file's OTHER 46 bodies audited — the
  // conformant `{ success: true, data: config }` of `/auth/public-config` at
  // 1663 among them — instead of one waiver retiring the lot.
  'packages/plugins/plugin-auth/src/auth-plugin.ts': {
    unenveloped: 3,
    exempt:
      'pre-auth bootstrap, ruled outside BaseResponseSchema by design (2026-08-17, #9389 option B): /bootstrap-status is polled by the Account SPA to choose between /login and first-run /setup, by a caller that has no credential to authenticate with yet. The rest of this file (~46 bodies) is better-auth\'s own wire format, relayed rather than built, and stays invisible to these counters by design',
  },
};

const EXPRESS_RESPONSE_RECEIVERS = new Set(['res']);

/**
 * Surface 4 (#9813): modules that write express-style `res.json(…)` responses
 * on an `IHttpServer` — the dialect none of the other three surfaces can see.
 * `dispatcher-plugin.ts` served the exact `{ data }` discovery shape #9436 was
 * ruled on for a day with no counter anywhere, because it writes through `res`
 * rather than a Hono context and returns nothing to a central sender.
 *
 * ⚠ ENUMERATED, not discovered. The other populations refuse an undeclared
 * response-writing module; this one audits only the files named here, because
 * a discovery walk for this dialect first needs a read/write discriminator —
 * fetch's `Response.json()` is a zero-argument READ on the same receiver name
 * (`const res = await fetch(…); await res.json()`), and 20 non-test files
 * under packages/ carry the `res.json(` spelling today, most of them fetch
 * readers. Growing the walk is #9937; adding a NEW express-style route module
 * to this table is part of adding the module.
 *
 * Entries carry the same counters, `ratchet`/`exempt`/`note` grammar and
 * audit (`auditPluginRouteModule`) as PLUGIN_ROUTE_MODULES — one grammar, two
 * receiver dialects.
 */
const IHTTP_ROUTE_MODULES = {
  // Ten bodies. The two discovery bodies (`/.well-known/objectstack`,
  // unconditional, and the REST-less `${prefix}/discovery` fallback) were
  // enveloped by #9813 under the #9436 maintainer ruling (2026-08-18, option
  // A, inherited with its reason intact: machine-read discovery bodies are
  // the envelope's core constituency and the migration is one additive key —
  // deliberately NOT #9389's pre-auth exemption, whose closed SPA-read list
  // these sites are not on). The two `{ success: false, error: buildApiError(…) }`
  // exits are conformant, and five relayed bodies (`result.body`,
  // `ANONYMOUS_DENY_BODY`, …) are deliberately invisible, as everywhere.
  'packages/runtime/src/dispatcher-plugin.ts': {
    unenveloped: 1,
    ratchet: '#9936 (envelope or rule on the SSE-fallback `{ events }` body)',
    note: 'the streaming branch\'s JSON fallback — a transport whose `res` cannot stream gets the collected events as a bare `{ events }`, no `success` flag and the payload beside the envelope rather than under `data`. A different consumer population from the discovery bodies (callers that asked for an SSE stream), so #9813\'s inherited ruling does not reach it; #9936 carries the fork',
  },
};

/**
 * Count the ways one plugin-route module's hand-built Hono bodies depart from
 * the declared envelope.
 *
 * Only `<ctx>.json(<objectLiteral>, …)` is judged — see the header on why
 * relayed bodies are deliberately invisible here.
 *
 * `receivers` names the identifiers that count as a response receiver. The
 * default is the Hono pair; passing `EXPRESS_RESPONSE_RECEIVERS` reads the
 * express-style `res.json(…)` dialect instead (#9813) — same body grammar,
 * different receiver, so the counters and their meanings are shared.
 *
 * @param {string} source TypeScript source text.
 * @param {string} fileName reported in sites.
 * @param {Set<string>} receivers identifiers judged as response receivers.
 * @returns {{bodies: number, unenveloped: number, errorWithoutMessage: number, errorCodeNotString: number, strayKeys: number, stringError: number, siblingCode: number, sites: Record<string, string[]>}}
 */
export function scanHonoRouteSource(source, fileName = 'plugin.ts', receivers = HONO_CONTEXT_RECEIVERS) {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const found = {
    bodies: 0,
    unenveloped: 0, errorWithoutMessage: 0, errorCodeNotString: 0,
    strayKeys: 0, stringError: 0, siblingCode: 0,
    sites: {
      unenveloped: [], errorWithoutMessage: [], errorCodeNotString: [],
      strayKeys: [], stringError: [], siblingCode: [],
    },
  };
  const line = (node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
  const hit = (key, node) => { found[key] += 1; found.sites[key].push(`${fileName}:${line(node)}`); };

  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'json' &&
      ts.isIdentifier(node.expression.expression) &&
      receivers.has(node.expression.expression.text)
    ) {
      found.bodies += 1;
      const arg = node.arguments[0];
      // A relayed body (an identifier, a call, a member access) is not one this
      // repo built — see the header.
      if (arg && ts.isObjectLiteralExpression(arg)) {
        const topKeys = new Set();
        let errorInit;
        let successInit;
        for (const prop of arg.properties) {
          if (ts.isShorthandPropertyAssignment(prop)) { topKeys.add(prop.name.text); continue; }
          if (ts.isSpreadAssignment(prop)) continue;
          if (!ts.isPropertyAssignment(prop) || !ts.isIdentifier(prop.name)) continue;
          topKeys.add(prop.name.text);
          if (prop.name.text === 'error') errorInit = prop.initializer;
          if (prop.name.text === 'success') successInit = prop.initializer;
        }

        // A body with no `success` at all is wholly off-envelope. Counted ONCE
        // here rather than again per stray key: one defect, one number.
        if (!topKeys.has('success')) {
          hit('unenveloped', node);
        } else if ([...topKeys].some((k) => !['success', 'data', 'error', 'meta'].includes(k))) {
          hit('strayKeys', node);
        }

        if (errorInit) {
          // The pre-#3675 dialect: `error` is a bare string.
          if (
            ts.isStringLiteral(errorInit) || ts.isTemplateExpression(errorInit) ||
            ts.isNoSubstitutionTemplateLiteral(errorInit)
          ) hit('stringError', node);

          // The #7035 dialect: `code` beside `error` rather than inside it.
          if (topKeys.has('code')) hit('siblingCode', node);

          if (ts.isObjectLiteralExpression(errorInit)) {
            const errKeys = new Map();
            for (const p of errorInit.properties) {
              // A shorthand `{ code }` stands for `code: code` — record the
              // implied identifier, or the status-carrying form below is
              // invisible in exactly the spelling that ships it.
              if (ts.isShorthandPropertyAssignment(p)) { errKeys.set(p.name.text, p.name); continue; }
              if (ts.isPropertyAssignment(p) && ts.isIdentifier(p.name)) errKeys.set(p.name.text, p.initializer);
            }
            // `message` is REQUIRED by ApiErrorSchema. Only judged where the
            // producer declared a failure — a conditional `error` on a body
            // whose `success` is computed is not a failure body statically.
            const declaresFailure = successInit && successInit.kind === ts.SyntaxKind.FalseKeyword;
            if (declaresFailure && !errKeys.has('message')) hit('errorWithoutMessage', node);

            // `error.code` carrying the HTTP STATUS rather than a semantic code.
            // Two syntactically decidable forms, and no others — a guess about
            // what an arbitrary expression evaluates to is not something a
            // source scan can honestly make:
            //   1. a numeric literal:  `error: { code: 404 }`
            //   2. the SAME identifier that is passed as this call's status
            //      argument: `c.json({ error: { message, code } }, code)`. That
            //      one is the shape `packages/adapters/hono` ships, and the
            //      shorthand is why a value-blind scan sees nothing wrong.
            const codeInit = errKeys.get('code');
            const statusArg = node.arguments[1];
            if (codeInit && ts.isNumericLiteral(codeInit)) {
              hit('errorCodeNotString', node);
            } else if (
              codeInit && ts.isIdentifier(codeInit) &&
              statusArg && ts.isIdentifier(statusArg) &&
              statusArg.text === codeInit.text
            ) {
              hit('errorCodeNotString', node);
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

/** The counters a plugin-route module is held to. All tick DOWN only. */
const PLUGIN_ROUTE_COUNTERS = {
  unenveloped: 'the body carries no `success` flag at all — `unwrapResponse` hands it to callers raw',
  errorWithoutMessage: '`error` has no `message`, so `body.error.message` reads `undefined`',
  errorCodeNotString: '`error.code` is a number — ApiErrorSchema declares a string enum there',
  strayKeys: 'a top-level key outside `success`/`data`/`error`/`meta` — the payload belongs under `data`',
  stringError: '`error` is a bare string, so `body.error.message` reads `undefined`',
  siblingCode: '`code` sits beside `error` rather than inside it, so `body.error.code` reads `undefined`',
};

/**
 * The #8435 authority token. Byte-identical to every instrumented gate's const.
 *
 * Widening a `ratchet` and widening an `exempt` are both remedies that EXPAND a
 * registry which only ever shrinks, and the second is the sharper case: an
 * `exempt` boundary is a maintainer's ruling, so an author who raises its number
 * has amended the ruling rather than applied it.
 */
const RATCHET_AUTHORITY_MARKER = '⛔ MAINTAINER-ONLY';

/**
 * Classify one plugin-route module against its declaration.
 *
 * Pure on purpose — it takes the declaration and the scan result rather than
 * reading the filesystem, and that is what lets the self-test drive the property
 * this table exists to hold. The closed-list guarantee the #9389 ruling names
 * ("any NEW pre-auth bare surface must carry its own exempt-with-reason entry to
 * pass") is a property of the TABLE, not of the scanner: `scanHonoRouteSource`
 * will happily count a new bare body, and whether that is a failure depends
 * entirely on what is declared for the file. A self-test that only drove the
 * scanner would be asserting the easy half.
 *
 * @param {string} file      repo-relative path
 * @param {object|undefined} declared its `PLUGIN_ROUTE_MODULES` entry, if any
 * @param {object} got       `scanHonoRouteSource` output for it
 * @returns {string[]} problems, empty when the module is in order
 */
export function auditPluginRouteModule(file, declared, got) {
  const problems = [];

  if (!declared) {
    problems.push(
      `${file}\n    NOT DECLARED. This file writes Hono responses (\`c.json(…)\`), so it is a\n` +
      `    plugin-route module — add it to PLUGIN_ROUTE_MODULES in\n` +
      `    scripts/check-route-envelope.mjs. If every body it BUILDS is the declared\n` +
      `    envelope, declare {}. If some are not, declare the CURRENT counts plus a\n` +
      `    \`ratchet\` naming the issue that will fix them, and a \`note\` saying what they\n` +
      `    are — never leave a response-emitting module unaudited.\n` +
      `    A pre-auth discovery/bootstrap payload is the one class that is ruled rather\n` +
      `    than tracked (#9389, 2026-08-17). It is a CLOSED list of files, so a new one\n` +
      `    does not inherit the ruling by resembling it: declaring the counts plus an\n` +
      `    \`exempt\` reason is how it joins, and that is ${RATCHET_AUTHORITY_MARKER} —\n` +
      `    a maintainer widens a ruled boundary, an author enveloping the body does not\n` +
      `    need anyone's leave.`,
    );
    return problems;
  }

  // Tracked drift and a ruled boundary are different claims about the same
  // number, and an entry asserting both asserts neither.
  if (declared.ratchet && declared.exempt) {
    problems.push(
      `${file}\n    declares both \`ratchet\` and \`exempt\` — those are exclusive.\n` +
      `    A ratchet says "this is drift and it is heading for zero"; an exempt says\n` +
      `    "this was ruled outside the envelope and is staying". Pick the one that is\n` +
      `    true. See the header of scripts/check-route-envelope.mjs.`,
    );
  }

  for (const [key, what] of Object.entries(PLUGIN_ROUTE_COUNTERS)) {
    const want = declared[key] ?? 0;
    if (got[key] === want) continue;
    const sites = got.sites[key].map((s) => s.slice(s.lastIndexOf(':') + 1)).join(', ') || '(none)';

    if (got[key] > want) {
      problems.push(
        declared.exempt
          ? `${file}\n    ${key}: found ${got[key]}, declared ${want} — a NEW body outside the envelope\n` +
            `    in a module whose departures are RULED rather than tracked.\n` +
            `    ${what}.\n` +
            `    A ruled exemption is a CLOSED list of the bodies that were measured when the\n` +
            `    ruling was made, not a standing waiver over this file. If this body is NOT a\n` +
            `    pre-auth discovery/bootstrap payload, the ruling does not reach it: emit\n` +
            `    { success: false, error: { code, message } } with an ADR-0112 code, and no\n` +
            `    number here moves. If it IS one, widening the boundary to cover it is\n` +
            `    ${RATCHET_AUTHORITY_MARKER}, NOT a co-equal option — raising this count and\n` +
            `    amending the reason amends a maintainer ruling (#9389, 2026-08-17), so it is\n` +
            `    a decision to take to the maintainer rather than a fix to apply.\n` +
            `    (exempt: ${declared.exempt})\n` +
            `    Lines: ${sites}`
          : `${file}\n    ${key}: found ${got[key]}, declared ${want} — a NEW non-conforming body.\n` +
            `    ${what}.\n` +
            `    Emit the envelope BaseResponseSchema declares —\n` +
            `    { success: false, error: { code, message } } — with \`code\` a member of the\n` +
            `    ADR-0112 vocabulary. Raising the declared number is not the fix.\n` +
            (declared.ratchet ? `    (ratchet for ${declared.ratchet})\n` : '') +
            `    Lines: ${sites}`,
      );
      continue;
    }

    problems.push(
      declared.exempt
        ? `${file}\n    ${key}: found ${got[key]}, declared ${want} — ${want - got[key]} fewer than pinned.\n` +
          `    A ruled exemption is an exact enumeration, so this is a body the reason still\n` +
          `    describes and the file no longer emits. Lower the count to ${got[key]} and amend\n` +
          `    the \`exempt\` reason to match what is left` +
          (got[key] === 0 ? `, or drop the entry entirely — nothing departs from the envelope here any more` : '') + `.\n` +
          `    Shrinking a ruled boundary needs nobody's leave; it is the widening direction\n` +
          `    that is ${RATCHET_AUTHORITY_MARKER}.\n` +
          `    Lines: ${sites}`
        : `${file}\n    ${key}: found ${got[key]}, declared ${want} — ${want - got[key]} fewer than pinned.\n` +
          `    That is progress, and banking it is the other half of the ratchet: lower the\n` +
          `    declared number to ${got[key]} in PLUGIN_ROUTE_MODULES so the ground cannot be\n` +
          `    given back` + (got[key] === 0 ? ` (and drop the \`ratchet\`/\`note\` if this was the last one)` : ``) + `.\n` +
          (declared.ratchet ? `    (ratchet for ${declared.ratchet})\n` : '') +
          `    Lines: ${sites}`,
    );
  }

  const pinned = Object.keys(PLUGIN_ROUTE_COUNTERS).reduce((n, k) => n + (declared[k] ?? 0), 0);

  if (pinned > 0 && !declared.ratchet && !declared.exempt) {
    problems.push(
      `${file}\n    pins ${pinned} non-conforming body/bodies with neither a \`ratchet\` nor an\n` +
      `    \`exempt\` reason.\n` +
      `    A pinned count is tracked drift or a ruled boundary — never a blessing that\n` +
      `    arrived by itself. Name the issue that will drive it to zero, or write the\n` +
      `    reason it is outside the envelope.`,
    );
  }
  if (pinned > 0 && declared.ratchet && !declared.note) {
    problems.push(
      `${file}\n    pins ${pinned} non-conforming body/bodies with no \`note\`.\n` +
      `    Say what they are, so the next reader can tell tracked drift from a shape\n` +
      `    somebody decided was fine.`,
    );
  }
  // An exemption with nothing to exempt reads as a standing waiver over whatever
  // this file emits next — which is the file-level shape the #9389 ruling was
  // deliberately not given (see the header).
  if (declared.exempt && pinned === 0) {
    problems.push(
      `${file}\n    declares \`exempt\` but pins no non-conforming body.\n` +
      `    An exemption over nothing is a waiver over whatever this file emits next: the\n` +
      `    counters would stop meaning anything here the moment a bare body appeared. A\n` +
      `    module that departs from the envelope in no way these counters can see is\n` +
      `    conformant — declare {}.`,
    );
  }

  return problems;
}

/**
 * Files that write a Hono context response, found by parsing rather than by
 * name — see the header on why.
 *
 * Files already audited as surface 1 are excluded so no module is governed by
 * two tables at once.
 */
function discoverHonoRoutes() {
  const out = [];
  const skip = new Set(['node_modules', 'dist', 'build', '.turbo', '.next', 'coverage']);
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      if (skip.has(entry)) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) { walk(full); continue; }
      if (!entry.endsWith('.ts') || entry.endsWith('.d.ts')) continue;
      if (entry.includes('.test.') || entry.includes('.conformance.')) continue;
      const rel = relative(ROOT, full).split(sep).join('/');
      if (MODULES[rel]) continue;
      const source = readFileSync(full, 'utf8');
      // Cheap text pre-filter, then the AST decides. The pre-filter can only
      // over-select (a mention in a comment), never under-select a real call.
      if (!source.includes('.json(')) continue;
      if (scanHonoRouteSource(source, rel).bodies > 0) out.push(rel);
    }
  };
  walk(join(ROOT, 'packages'));
  return out.sort();
}

/**
 * Count the envelope-relevant facts in one module's source.
 *
 * @param {string} source TypeScript source text.
 * @returns {{responses: number, ok: number, err: number, privateOk: number, stringError: number, siblingCode: number, sites: string[], stringErrorSites: string[], siblingCodeSites: string[]}}
 */
export function scanSource(source, fileName = 'module.ts') {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const found = {
    responses: 0, ok: 0, err: 0, privateOk: 0, stringError: 0, siblingCode: 0,
    sites: [], stringErrorSites: [], siblingCodeSites: [],
  };

  /** `req.json()` / `c.req.json()` read a request body — not a response write. */
  const isRequestRead = (expr) => {
    const recv = expr.expression;
    if (ts.isIdentifier(recv)) return REQUEST_RECEIVERS.has(recv.text);
    // `c.req.json()` — the receiver is itself a property access ending in `req`.
    if (ts.isPropertyAccessExpression(recv)) return REQUEST_RECEIVERS.has(recv.name.text);
    return false;
  };

  const line = (node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;

  const visit = (node) => {
    // Response write sites: `<something>.json(...)`, excluding request reads.
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'json' &&
      !isRequestRead(node.expression)
    ) {
      found.responses += 1;
      found.sites.push(`${fileName}:${line(node)}`);

      // Facts that only mean something at the ROOT of a response body, so they
      // are read off this call's own object literal rather than the whole module.
      const arg = node.arguments[0];
      if (arg && ts.isObjectLiteralExpression(arg)) {
        // Every key written at the TOP of this body. Shorthand counts: the
        // dialect `{ error: msg, code: 'X' }` and the dialect `{ error, code }`
        // are the same body written two ways, and rest-server.ts writes both.
        const topKeys = new Set();
        for (const prop of arg.properties) {
          if (ts.isShorthandPropertyAssignment(prop)) {
            topKeys.add(prop.name.text);
            continue;
          }
          if (!ts.isPropertyAssignment(prop) || !ts.isIdentifier(prop.name)) continue;
          const key = prop.name.text;
          topKeys.add(key);
          const init = prop.initializer;
          // `error` as a bare string — the pre-#3675 dialect.
          if (
            key === 'error' &&
            (ts.isStringLiteral(init) || ts.isTemplateExpression(init) ||
              ts.isNoSubstitutionTemplateLiteral(init))
          ) {
            found.stringError += 1;
            found.stringErrorSites.push(`${fileName}:${line(node)}`);
          }
          // A literal `ok` is a second word for `success` only where it could BE
          // the flag: a sibling of `success` at the top of the body. The same
          // literal inside `data` is payload — `data: { ok: true }` is what a
          // revoke endpoint legitimately returns, and the dispatcher twin
          // (`runtime/src/domains/share-links.ts`) has always returned it (#3983).
          if (key === 'ok' && (init.kind === ts.SyntaxKind.TrueKeyword || init.kind === ts.SyntaxKind.FalseKeyword)) {
            found.privateOk += 1;
          }
        }

        // The second dialect (#7035): `code` as a SIBLING of `error` instead of
        // a key inside it. Read off this body's own top level for the same
        // reason `ok` is — the envelope puts the code inside `error`, so a
        // `code` one level down (`data: { code }`, or the conformant
        // `error: { code, message }`) is not this dialect at all. What makes it
        // worth a counter of its own is that `stringError` cannot stand in for
        // it: most of these carry a computed message, so the pair is invisible
        // to every count this gate had before #7295.
        if (topKeys.has('error') && topKeys.has('code')) {
          found.siblingCode += 1;
          found.siblingCodeSites.push(`${fileName}:${line(node)}`);
        }
      }
    }

    // The `success` flag counts ANYWHERE in the module, unlike `ok` above: it is
    // the envelope's own flag wherever the body gets built, including the
    // `const body = { success: true, data }; res.json(body)` form that a
    // call-local scan cannot see.
    if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) && node.name.text === 'success') {
      if (node.initializer.kind === ts.SyntaxKind.TrueKeyword) found.ok += 1;
      if (node.initializer.kind === ts.SyntaxKind.FalseKeyword) found.err += 1;
    }

    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

/**
 * Count hand-built response literals in one dispatcher domain's source.
 *
 * `response: { … }` is hand-built; `response: deps.success(…)` is not. Comments
 * and strings are not tokens, so quoting either form in prose cannot move the
 * count.
 *
 * Only a `response` that is a sibling of `handled` counts — that pair IS the
 * `HttpDispatcherResult`. A payload field that happens to be named `response`
 * (`deps.success({ response: … })`) is data, not a response, and the self-test
 * pins the difference: matching the key alone counted it.
 *
 * @param {string} source TypeScript source text.
 * @returns {{handBuilt: number, sites: string[]}}
 */
export function scanDomainSource(source, fileName = 'domain.ts') {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const found = { handBuilt: 0, sites: [] };

  const isDispatcherResult = (obj) =>
    ts.isObjectLiteralExpression(obj) &&
    obj.properties.some(
      (p) => ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === 'handled',
    );

  const visit = (node) => {
    if (
      ts.isPropertyAssignment(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'response' &&
      ts.isObjectLiteralExpression(node.initializer) &&
      isDispatcherResult(node.parent)
    ) {
      found.handBuilt += 1;
      found.sites.push(`${fileName}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

/** Domain handler files, by basename. */
function discoverDomains() {
  return readdirSync(join(ROOT, DISPATCHER_DOMAIN_DIR))
    .filter((n) => n.endsWith('.ts') && !n.endsWith('.d.ts') && !n.includes('.test.') && !n.includes('.conformance.'))
    .sort();
}

/**
 * Files that answer REST but are not named `*-routes.ts`, by basename.
 *
 * The convention is the discovery surface, so anything outside it is invisible
 * until it is named here — which is not a hypothetical cost. `rest-server.ts`
 * was outside for as long as this gate has existed (#7295), while being the
 * largest response-emitting file in the repo; the header's promise that "a
 * module nobody thought to convert still gets audited" only holds over the
 * files the walk can see. Adding a name here is cheap; the module then has to
 * appear in `MODULES` or the audit fails, which is the point.
 */
const OFF_CONVENTION_MODULES = new Set([
  // Registers its routes from a plugin entry point rather than a route module.
  'i18n-service-plugin.ts',
  // The dispatcher's own server. Audited `dialectOnly` — see the header.
  'rest-server.ts',
  // [#8850] `rest-server.ts`'s ADR-0112 error/fault-classification prologue, moved
  // to its own module. It answers no route itself, but it owns the two doors every
  // route catch exits through (`sendError` / `handleRouteError`), so it emits REST
  // bodies and belongs in the audit. Named here the same day the module was created
  // — the extraction is exactly the event this list exists to survive.
  'error-response.ts',
]);

/** Recursively collect candidate route-module paths under `packages/`. */
function discover() {
  const out = [];
  const skip = new Set(['node_modules', 'dist', 'build', '.turbo', '.next', 'coverage']);
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      if (skip.has(entry)) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) { walk(full); continue; }
      if (!entry.endsWith('.ts') || entry.endsWith('.d.ts')) continue;
      if (entry.includes('.test.') || entry.includes('.conformance.')) continue;
      // The repo's naming convention for a route registrar, plus the files that
      // emit REST bodies without following it.
      if (entry.endsWith('-routes.ts') || OFF_CONVENTION_MODULES.has(entry)) {
        out.push(relative(ROOT, full).split(sep).join('/'));
      }
    }
  };
  walk(join(ROOT, 'packages'));
  return out.sort();
}

/**
 * The two non-conforming error dialects, and what each one costs a consumer.
 *
 * These are the only keys a `dialectOnly` module is held to, and the only ones
 * that ratchet in one direction — see the header.
 */
const DIALECTS = {
  stringError: {
    sites: 'stringErrorSites',
    what: '`error` is a bare string, so `body.error.message` reads `undefined`',
  },
  siblingCode: {
    sites: 'siblingCodeSites',
    what: '`code` sits beside `error` rather than inside it, so `body.error.code` reads `undefined`',
  },
};

/** Keys a `dialectOnly` module must NOT declare — every one of them moves with the write-site list. */
const NON_DIALECT_KEYS = ['responses', 'ok', 'err', 'privateOk'];

/**
 * Audit a module held to dialect facts only: a one-directional ratchet on
 * `stringError` and `siblingCode`, and nothing else.
 *
 * @param {string} file            repo-relative path
 * @param {object} declared        its `MODULES` entry
 * @param {object} got             `scanSource` output for it
 * @param {string[]} problems      collector, appended in place
 */
function auditDialectOnly(file, declared, got, problems) {
  // A `dialectOnly` entry that also pins write sites is the ratchet #7295
  // rejected, re-entered one key at a time. Refuse it here rather than let the
  // table drift back into a number nobody can keep green.
  for (const key of NON_DIALECT_KEYS) {
    if (declared[key] !== undefined) {
      problems.push(
        `${file}\n    declares dialectOnly AND \`${key}\` — those are exclusive.\n` +
        `    dialectOnly exists because this module's write-site count moves under\n` +
        `    edits that are not envelope drift. Pin the dialects or convert the module;\n` +
        `    do not pin both. See the header of scripts/check-route-envelope.mjs.`,
      );
    }
  }
  if (!declared.ratchet) {
    problems.push(
      `${file}\n    declares dialectOnly with no \`ratchet\`.\n` +
      `    A pinned dialect count is tracked drift, not a blessing — name the issue\n` +
      `    that will drive it to zero.`,
    );
  }

  for (const [key, dialect] of Object.entries(DIALECTS)) {
    const want = declared[key];
    if (want === undefined) {
      problems.push(
        `${file}\n    dialectOnly but declares no \`${key}\` baseline.\n` +
        `    Both dialects are asserted for such a module; a missing one is a dialect\n` +
        `    nobody is counting. Measure it and enter the number.`,
      );
      continue;
    }
    if (got[key] === want) continue;

    // Line numbers only: the file is named on the line above, and a dialect
    // ratchet lists tens of sites where `responses` lists one or two.
    const sites = got[dialect.sites].map((s) => s.slice(s.lastIndexOf(':') + 1)).join(', ') || '(none)';
    problems.push(
      got[key] > want
        ? `${file}\n    ${key}: found ${got[key]}, declared ${want} — a NEW non-conforming body.\n` +
          `    ${dialect.what}.\n` +
          `    This ratchet only ticks DOWN: build the body through sendOk/sendError from\n` +
          `    @objectstack/types (packages/types/src/response-envelope.ts), or put the code\n` +
          `    and message inside \`error\`. Raising the declared number is not the fix.\n` +
          `    (ratchet for ${declared.ratchet})\n` +
          `    Lines: ${sites}`
        : `${file}\n    ${key}: found ${got[key]}, declared ${want} — ${want - got[key]} fewer than pinned.\n` +
          `    That is progress, and banking it is the other half of the ratchet: lower the\n` +
          `    declared number to ${got[key]} in MODULES so the ground cannot be given back.\n` +
          `    (ratchet for ${declared.ratchet})\n` +
          `    Lines: ${sites}`,
    );
  }
}

function audit() {
  const problems = [];
  const discovered = discover();

  for (const file of discovered) {
    const declared = MODULES[file];
    if (!declared) {
      problems.push(
        `${file}\n    NOT DECLARED. Add it to MODULES in scripts/check-route-envelope.mjs.\n` +
        `    If it emits the envelope through the shared sendOk/sendError from\n` +
        `    @objectstack/types, declare { responses: 0, ok: 0, err: 0 }. If it still\n` +
        `    drifts, declare its CURRENT counts plus a \`ratchet\` naming the issue that\n` +
        `    will fix it — never leave a route module unaudited.`,
      );
      continue;
    }
    if (declared.exempt) continue;

    const got = scanSource(readFileSync(join(ROOT, file), 'utf8'), file);

    if (declared.dialectOnly) {
      auditDialectOnly(file, declared, got, problems);
      continue;
    }

    const want = { privateOk: 0, stringError: 0, siblingCode: 0, ...declared };

    for (const key of ['responses', 'ok', 'err', 'privateOk', 'stringError', 'siblingCode']) {
      if (got[key] !== want[key]) {
        problems.push(
          `${file}\n    ${key}: found ${got[key]}, declared ${want[key]}` +
          (key === 'responses' && got[key] > want[key]
            ? `\n    A route is building its own body instead of calling the shared envelope` +
              `\n    helper. Import { sendOk, sendError } from '@objectstack/types' rather than` +
              `\n    writing the shape again — see packages/types/src/response-envelope.ts.` +
              `\n    Write sites: ${got.sites.join(', ')}`
            : '') +
          (want.ratchet ? `\n    (ratchet for ${want.ratchet} — the declared numbers pin current drift)` : ''),
        );
      }
    }
  }

  for (const file of Object.keys(MODULES)) {
    if (!discovered.includes(file)) {
      problems.push(`${file}\n    declared in MODULES but not found — moved or deleted? Update the table.`);
    }
  }

  // ── The shared builder every zero above depends on ────────────────────────
  let sharedSource;
  try {
    sharedSource = readFileSync(join(ROOT, SHARED_BUILDER.file), 'utf8');
  } catch {
    problems.push(
      `${SHARED_BUILDER.file}\n    the shared envelope builder is MISSING. Every route module declares\n` +
      `    0 write sites because this file holds them; without it nothing pins the\n` +
      `    envelope's shape at all. Restore it, or update SHARED_BUILDER if it moved.`,
    );
  }
  if (sharedSource !== undefined) {
    const got = scanSource(sharedSource, SHARED_BUILDER.file);
    for (const [key, want] of Object.entries(SHARED_BUILDER.counts)) {
      if (got[key] !== want) {
        problems.push(
          `${SHARED_BUILDER.file}\n    ${key}: found ${got[key]}, declared ${want}\n` +
          `    This is the ONE writer for every route module's bodies. A third write site\n` +
          `    here is a third dialect for all of them at once; a missing one means a half\n` +
          `    of the envelope nobody emits. Sites: ${got.sites.join(', ') || '(none)'}`,
        );
      }
    }
  }

  // ── The dispatcher domains ────────────────────────────────────────────────
  const domains = discoverDomains();

  for (const name of domains) {
    const declared = DISPATCHER_DOMAINS[name];
    if (!declared) {
      problems.push(
        `${DISPATCHER_DOMAIN_DIR}/${name}\n    NOT DECLARED. Add it to DISPATCHER_DOMAINS in\n` +
        `    scripts/check-route-envelope.mjs. A domain that answers only through the\n` +
        `    \`deps.*\` helpers declares { handBuilt: 0 }; any hand-built response needs a\n` +
        `    \`note\` saying which of the four kinds it is.`,
      );
      continue;
    }
    const got = scanDomainSource(readFileSync(join(ROOT, DISPATCHER_DOMAIN_DIR, name), 'utf8'), name);
    if (got.handBuilt !== declared.handBuilt) {
      problems.push(
        `${DISPATCHER_DOMAIN_DIR}/${name}\n    handBuilt: found ${got.handBuilt}, declared ${declared.handBuilt}` +
        (got.handBuilt > declared.handBuilt
          ? `\n    A handler is assembling its own response instead of returning a \`deps.*\`\n` +
            `    envelope. If that is deliberate (a status or header the helper cannot\n` +
            `    express, or a body this dispatcher only relays), raise the count and say\n` +
            `    which in \`note\`. Sites: ${got.sites.join(', ')}`
          : `\n    Fewer than declared — if a hand-built response moved onto \`deps.*\`, lower\n` +
            `    the count (and drop the \`ratchet\` if that was the drift it named).`) +
        (declared.ratchet ? `\n    (ratchet for ${declared.ratchet} — the declared count pins current drift)` : ''),
      );
    }
    if (declared.handBuilt > 0 && !declared.note) {
      problems.push(
        `${DISPATCHER_DOMAIN_DIR}/${name}\n    declares handBuilt: ${declared.handBuilt} with no \`note\`.\n` +
        `    A hand-built response has to say why it is not a \`deps.*\` call.`,
      );
    }
  }

  for (const name of Object.keys(DISPATCHER_DOMAINS)) {
    if (!domains.includes(name)) {
      problems.push(
        `${DISPATCHER_DOMAIN_DIR}/${name}\n    declared in DISPATCHER_DOMAINS but not found — moved or deleted?`,
      );
    }
  }

  // ── The plugin-mounted Hono routes (#9267) ────────────────────────────────
  const honoRoutes = discoverHonoRoutes();

  for (const file of honoRoutes) {
    const declared = PLUGIN_ROUTE_MODULES[file];
    // An `exempt` module is still SCANNED and still COUNTED — the ruling closed
    // a list of bodies, not a list of files. See the header.
    const got = declared
      ? scanHonoRouteSource(readFileSync(join(ROOT, file), 'utf8'), file)
      : null;
    problems.push(...auditPluginRouteModule(file, declared, got));
  }

  for (const file of Object.keys(PLUGIN_ROUTE_MODULES)) {
    if (!honoRoutes.includes(file)) {
      problems.push(
        `${file}\n    declared in PLUGIN_ROUTE_MODULES but no longer writes a Hono response —\n` +
        `    moved, deleted, or converted? Update the table.`,
      );
    }
  }

  // ── The IHttpServer express-style modules (#9813) — enumerated, see table ──
  const ihttpScans = {};
  for (const [file, declared] of Object.entries(IHTTP_ROUTE_MODULES)) {
    let source;
    try {
      source = readFileSync(join(ROOT, file), 'utf8');
    } catch {
      problems.push(
        `${file}\n    declared in IHTTP_ROUTE_MODULES but not found — moved or deleted?\n` +
        `    Update the table.`,
      );
      continue;
    }
    const got = scanHonoRouteSource(source, file, EXPRESS_RESPONSE_RECEIVERS);
    if (got.bodies === 0) {
      problems.push(
        `${file}\n    declared in IHTTP_ROUTE_MODULES but no longer writes an express-style\n` +
        `    response (\`res.json(…)\`) — moved, deleted, or converted? Update the table.`,
      );
      continue;
    }
    ihttpScans[file] = got;
    problems.push(...auditPluginRouteModule(file, declared, got));
  }

  if (problems.length) {
    console.error('✗ Route-envelope conformance (#3843)\n');
    for (const p of problems) console.error('  ' + p + '\n');
    console.error(
      'Every REST body must be built in ONE place per surface, in the envelope\n' +
      'BaseResponseSchema declares — the shared sendOk / sendError in\n' +
      '@objectstack/types for route modules, or a dispatcher domain\'s deps.* helpers.\n' +
      'See scripts/check-route-envelope.mjs.',
    );
    process.exit(1);
  }

  const entries = Object.entries(MODULES);
  const exempt = entries.filter(([, m]) => m.exempt);
  const ratcheted = entries.filter(([, m]) => m.ratchet);
  const conformant = discovered.length - exempt.length - ratcheted.length;
  console.log(
    `✓ Route-envelope conformance — ${discovered.length} route module(s) audited: ` +
    `${conformant} conformant, ${ratcheted.length} ratcheted, ${exempt.length} exempt`,
  );
  console.log(
    `  all bodies written by ${SHARED_BUILDER.file} ` +
    `(${SHARED_BUILDER.counts.responses} write sites, pinned)`,
  );
  for (const [file, m] of ratcheted) {
    console.log(
      `  ⚠ ratchet ${m.ratchet}: ${file} ` +
      (m.dialectOnly
        ? `(dialect facts only — stringError ${m.stringError}, siblingCode ${m.siblingCode}; ticks down only, write sites NOT pinned)`
        : '(pinned at current drift, not conformant)'),
    );
  }
  for (const [file, m] of exempt) {
    console.log(`  – exempt: ${file} — ${m.exempt}`);
  }

  const dEntries = Object.entries(DISPATCHER_DOMAINS);
  const dRatcheted = dEntries.filter(([, m]) => m.ratchet);
  const helperOnly = dEntries.filter(([, m]) => m.handBuilt === 0);
  console.log(
    `✓ Dispatcher domains — ${domains.length} audited: ` +
    `${helperOnly.length} helper-only, ${dEntries.length - helperOnly.length} with declared hand-built responses ` +
    `(${dRatcheted.length} ratcheted)`,
  );
  for (const [name, m] of dRatcheted) {
    console.log(`  ⚠ ratchet ${m.ratchet}: ${DISPATCHER_DOMAIN_DIR}/${name} — ${m.note}`);
  }

  const pEntries = Object.entries(PLUGIN_ROUTE_MODULES);
  const pRatcheted = pEntries.filter(([, m]) => m.ratchet);
  const pExempt = pEntries.filter(([, m]) => m.exempt);
  const totalBodies = honoRoutes.reduce(
    (n, f) => n + scanHonoRouteSource(readFileSync(join(ROOT, f), 'utf8'), f).bodies, 0,
  );
  console.log(
    `✓ Plugin-mounted Hono routes — ${honoRoutes.length} module(s) audited, ` +
    `${totalBodies} hand-built body/bodies (count reported, NOT pinned): ` +
    `${honoRoutes.length - pRatcheted.length - pExempt.length} conformant, ` +
    `${pRatcheted.length} ratcheted, ${pExempt.length} exempt`,
  );
  const pCounts = (m) => Object.keys(PLUGIN_ROUTE_COUNTERS)
    .filter((k) => m[k]).map((k) => `${k} ${m[k]}`).join(', ');
  for (const [file, m] of pRatcheted) {
    console.log(`  ⚠ ratchet ${m.ratchet}: ${file} (${pCounts(m)}; ticks down only) — ${m.note}`);
  }
  // The counts belong in the exempt line too: an exemption here is a closed
  // enumeration, and printing it without its number would report the ruling as
  // the file-level waiver it deliberately is not.
  for (const [file, m] of pExempt) {
    console.log(`  – exempt, closed at ${pCounts(m)}: ${file} — ${m.exempt}`);
  }

  const iEntries = Object.entries(IHTTP_ROUTE_MODULES);
  const iRatcheted = iEntries.filter(([, m]) => m.ratchet);
  const iExempt = iEntries.filter(([, m]) => m.exempt);
  const iBodies = Object.values(ihttpScans).reduce((n, s) => n + s.bodies, 0);
  console.log(
    `✓ IHttpServer express-style modules — ${iEntries.length} module(s) audited ` +
    `(ENUMERATED, not discovered — the walk is #9937), ` +
    `${iBodies} hand-built body/bodies (count reported, NOT pinned): ` +
    `${iEntries.length - iRatcheted.length - iExempt.length} conformant, ` +
    `${iRatcheted.length} ratcheted, ${iExempt.length} exempt`,
  );
  for (const [file, m] of iRatcheted) {
    console.log(`  ⚠ ratchet ${m.ratchet}: ${file} (${pCounts(m)}; ticks down only) — ${m.note}`);
  }
  for (const [file, m] of iExempt) {
    console.log(`  – exempt, closed at ${pCounts(m)}: ${file} — ${m.exempt}`);
  }
}

// ── Self-test ────────────────────────────────────────────────────────────────
// Both cases below are regressions the regex predecessor actually had.

function selfTest() {
  const assert = (cond, msg) => { if (!cond) { console.error('✗ self-test: ' + msg); process.exit(1); } };

  const sound = `
    function sendError(res, s, code, message) { res.status(s).json({ success: false, error: { code, message } }); }
    function sendOk(res, data) { res.json({ success: true, data }); }
    http.get('/a', (q, res) => sendOk(res, { a: 1 }));
    http.get('/b', (q, res) => sendError(res, 404, 'NOPE', 'gone'));
  `;
  let r = scanSource(sound);
  assert(r.responses === 2 && r.ok === 1 && r.err === 1, `sound module → ${JSON.stringify(r)}`);

  // The shape every route module has had since #3973: the builders live in
  // @objectstack/types, so the module itself writes NOTHING. This is the state
  // the MODULES table now declares, and the reason it declares zeros.
  r = scanSource(`
    import { sendOk, sendError } from '@objectstack/types';
    http.get('/a', (q, res) => sendOk(res, { a: 1 }));
    http.post('/b', (q, res) => sendOk(res, { b: 2 }, 201));
    http.get('/c', (q, res) => sendError(res, 404, 'RESOURCE_NOT_FOUND', 'gone'));
  `);
  assert(
    r.responses === 0 && r.ok === 0 && r.err === 0,
    `a fully consolidated module must scan to zero → ${JSON.stringify(r)}`,
  );

  // …and a module that consolidated MOST of its bodies is exactly what the
  // zeros are for: one hand-rolled body moves the count off zero and fails.
  r = scanSource(`
    import { sendOk } from '@objectstack/types';
    http.get('/a', (q, res) => sendOk(res, { a: 1 }));
    http.get('/b', (q, res) => res.status(200).json({ success: true, data: { b: 2 } }));
  `);
  assert(
    r.responses === 1 && r.ok === 1,
    `one hand-rolled body among helper calls must be seen → ${JSON.stringify(r)}`,
  );

  // (1) A `//` inside a string truncated the rest of the line for the regex
  // version, hiding the response write after it.
  r = scanSource(`const base = 'http://local'; res.json({ success: true, data });`);
  assert(r.responses === 1, `url-in-string must not hide the write site → ${JSON.stringify(r)}`);

  // (2) `c.req.json()` READS a request. The regex version counted it as two
  // unenveloped responses in hmr-routes.ts.
  r = scanSource(`const body = await c.req.json(); const b2 = await req.json();`);
  assert(r.responses === 0, `request reads must not count as responses → ${JSON.stringify(r)}`);

  // Comments quoting both dialects are not code paths.
  r = scanSource(`
    /* Was: res.status(404).json({ error: 'not_found' }); and { ok: true } */
    // res.json({ success: true, data });
    ${sound}
  `);
  assert(r.responses === 2 && r.privateOk === 0 && r.stringError === 0, `comments counted → ${JSON.stringify(r)}`);

  // The pre-#3675 bare-string error.
  r = scanSource(`res.status(503).json({ error: 'datasource_admin_unavailable' });`);
  assert(r.stringError === 1, `bare-string error not caught → ${JSON.stringify(r)}`);

  // ── The sibling-`code` dialect (#7035, counted since #7295) ───────────────
  // A top-level `code` NEXT TO `error` instead of inside it. Same failure as
  // the bare string one key over: `body.error.code` reads `undefined`.
  r = scanSource(`res.status(400).json({ error: 'Batch too large', code: 'BATCH_TOO_LARGE' });`);
  assert(
    r.siblingCode === 1 && r.stringError === 1,
    `sibling code not caught → ${JSON.stringify(r)}`,
  );
  // Order is not the fact — rest-server.ts writes the pair both ways round —
  // and a COMPUTED message is the common case, which is exactly why
  // `stringError` cannot stand in for this counter.
  r = scanSource(`res.status(403).json({ code: 'PERMISSION_DENIED', error: msg.replace(/^X:/, '') });`);
  assert(
    r.siblingCode === 1 && r.stringError === 0,
    `a computed message must not hide the sibling code → ${JSON.stringify(r)}`,
  );
  // Shorthand is the same dialect written shorter — the form #7295 quoted.
  r = scanSource(`res.status(500).json({ error, code });`);
  assert(r.siblingCode === 1, `shorthand sibling code not caught → ${JSON.stringify(r)}`);
  // NEGATIVE: the declared envelope nests both keys inside `error`, so the
  // conformant body — the one the shared sendError writes — is not this dialect.
  // If this ever counted, every module in the table would fail at once.
  r = scanSource(`res.status(404).json({ success: false, error: { code: 'GONE', message: 'gone' } });`);
  assert(r.siblingCode === 0, `the conformant nested code counted → ${JSON.stringify(r)}`);
  // NEGATIVE: one level down is payload, not the envelope — the same reasoning
  // that keeps `ok` inside `data` from counting as a second success word.
  r = scanSource(`res.json({ success: true, data: { error: 'row 3 failed', code: 'BAD_ROW' } });`);
  assert(r.siblingCode === 0, `a code inside data counted → ${JSON.stringify(r)}`);
  // NEGATIVE: `code` on its own is an ordinary payload key (a locale, a status,
  // a country). Only the PAIR is the dialect.
  r = scanSource(`res.json({ success: true, code: 'en-GB' });`);
  assert(r.siblingCode === 0, `a lone code counted → ${JSON.stringify(r)}`);
  // NEGATIVE: prose quoting the dialect is not a code path — the table above
  // quotes it, and must not move anyone's count.
  r = scanSource(`
    /* Was: res.status(400).json({ error: 'nope', code: 'NOPE' }); */
    // res.json({ error, code });
    ${sound}
  `);
  assert(r.siblingCode === 0, `commented-out sibling code counted → ${JSON.stringify(r)}`);

  // A literal `ok` at the top of a body is a second success word.
  r = scanSource(`res.json({ ok: true, key });`);
  assert(r.privateOk === 1, `literal ok not caught → ${JSON.stringify(r)}`);
  // A COMPUTED one is a domain verdict that happens to share the name —
  // `POST /external/validate` reports `ok: results.every(r => r.ok)`.
  r = scanSource(`sendOk(res, { ok: results.every((x) => x.ok), results });`);
  assert(r.privateOk === 0, `computed ok must be left alone → ${JSON.stringify(r)}`);
  // …and a literal one INSIDE `data` is payload, not a competing flag. Both
  // forms below are what a conformant revoke endpoint returns (#3983); the
  // `responses`/`ok`/`err` counts stay the real guarantee that the two writers
  // are the enveloped ones.
  r = scanSource(`res.json({ success: true, data: { ok: true } });`);
  assert(r.privateOk === 0 && r.ok === 1, `nested ok is payload → ${JSON.stringify(r)}`);
  r = scanSource(`${sound}\nhttp.delete('/c', (q, res) => sendOk(res, { ok: true }));`);
  assert(
    r.privateOk === 0 && r.responses === 2 && r.ok === 1 && r.err === 1,
    `ok passed as a helper's data must not count → ${JSON.stringify(r)}`,
  );

  // ── Dispatcher domains ────────────────────────────────────────────────────
  // A domain that answers only through the helpers hand-builds nothing.
  let d = scanDomainSource(`
    if (m === 'GET') return { handled: true, response: deps.success(rows) };
    if (m === 'DELETE') return { handled: true, response: deps.success({ ok: true }) };
    return { handled: true, response: deps.routeNotFound('/x') };
  `);
  assert(d.handBuilt === 0, `helper-only domain → ${JSON.stringify(d)}`);

  // An assembled literal is what the count is for — this is how /share-links
  // carried a duplicate `link` beside `data` unseen (#4038).
  d = scanDomainSource(`return { handled: true, response: { status: 201, body: { success: true, data: link, link } } };`);
  assert(d.handBuilt === 1, `hand-built response not caught → ${JSON.stringify(d)}`);

  // Both forms in one file, counted once each.
  d = scanDomainSource(`
    if (a) return { handled: true, response: deps.success(x) };
    if (b) return { handled: true, response: { status: 405, headers: { Allow: 'GET' }, body } };
    return { handled: true, response: { status: 200, body: { agents: [] } } };
  `);
  assert(d.handBuilt === 2, `mixed domain miscounted → ${JSON.stringify(d)}`);

  // Prose quoting either form is not code — the note fields in the table above
  // quote both, and must not move anyone's count.
  d = scanDomainSource(`
    /* was: response: { status: 200, body: { agents: [] } } — see #4053 */
    // return { handled: true, response: { status: 201, body } };
    return { handled: true, response: deps.success(x) };
  `);
  assert(d.handBuilt === 0, `commented-out responses counted → ${JSON.stringify(d)}`);

  // A nested `response` key inside a payload is not a response assignment.
  d = scanDomainSource(`return { handled: true, response: deps.success({ response: { status: 'queued' } }) };`);
  assert(d.handBuilt === 0, `a data field named response must not count → ${JSON.stringify(d)}`);

  // ── Plugin-mounted Hono routes (#9267) ────────────────────────────────────
  // Every case below is a shape measured in the repo when this surface was
  // added, not an invented one.

  // The conformant body: nothing to report, and the write site is still seen.
  let p = scanHonoRouteSource(`
    return c.json({ success: false, error: { code: 'UNAUTHENTICATED', message: 'Sign in.' } }, 401);
  `);
  assert(
    p.bodies === 1 && p.unenveloped === 0 && p.errorWithoutMessage === 0 &&
    p.strayKeys === 0 && p.stringError === 0 && p.siblingCode === 0 && p.errorCodeNotString === 0,
    `a conformant Hono body must report nothing → ${JSON.stringify(p)}`,
  );

  // The #9267 finding itself: `error` with no `message`. ApiErrorSchema requires
  // it, so `body.error.message` read `undefined` on eight cloud-connection exits.
  p = scanHonoRouteSource(`return c.json({ success: false, error: { code: 'ENVIRONMENT_NOT_FOUND' } }, 404);`);
  assert(p.errorWithoutMessage === 1, `a message-less error not caught → ${JSON.stringify(p)}`);

  // A body with no `success` at all — counted ONCE, not again per stray key.
  p = scanHonoRouteSource(`return c.json({ cloudUrl, features, branding });`);
  assert(
    p.unenveloped === 1 && p.strayKeys === 0,
    `a bare payload must count once as unenveloped → ${JSON.stringify(p)}`,
  );

  // …while a body that IS trying to be an envelope and leaks a key counts as
  // strayKeys, not unenveloped. The two are exclusive on purpose.
  p = scanHonoRouteSource(`return c.json({ success: true, data: link, link });`);
  assert(
    p.strayKeys === 1 && p.unenveloped === 0,
    `a leaked payload key must count as strayKeys → ${JSON.stringify(p)}`,
  );

  // Both pre-existing dialects reach this door too.
  p = scanHonoRouteSource(`return c.json({ error: 'Not found' }, 404);`);
  assert(p.stringError === 1 && p.unenveloped === 1, `bare-string error at this door → ${JSON.stringify(p)}`);
  p = scanHonoRouteSource(`return c.json({ error: 'Method Not Allowed', code: 'METHOD_NOT_ALLOWED', method }, 405);`);
  assert(p.siblingCode === 1, `sibling code at this door → ${JSON.stringify(p)}`);

  // `error.code` carrying the HTTP STATUS. The literal form…
  p = scanHonoRouteSource(`return c.json({ success: false, error: { message, code: 404 } }, 404);`);
  assert(p.errorCodeNotString === 1, `a numeric error.code not caught → ${JSON.stringify(p)}`);
  // …and the SHORTHAND form that actually ships (packages/adapters/hono). This
  // is the case a value-blind scan misses: `code` reads like a semantic code and
  // is the status argument. Pinned because dropping the shorthand handling in
  // `errKeys` silently returns this counter to zero.
  p = scanHonoRouteSource(`
    const errorJson = (c, message, code = 500) => c.json({ success: false, error: { message, code } }, code);
  `);
  assert(p.errorCodeNotString === 1, `the shorthand status-as-code not caught → ${JSON.stringify(p)}`);
  // NEGATIVE: a `code` identifier that is NOT this call's status is an ordinary
  // semantic code passed in a variable — the common conformant spelling.
  p = scanHonoRouteSource(`return c.json({ success: false, error: { message, code } }, 400);`);
  assert(p.errorCodeNotString === 0, `a semantic code in a variable counted → ${JSON.stringify(p)}`);

  // NEGATIVE: a RELAYED body is not one this repo built — see the header.
  p = scanHonoRouteSource(`return c.json(upstreamJson, resp.status);`);
  assert(
    p.bodies === 1 && p.unenveloped === 0,
    `a relayed body must be counted as a site but judged as nothing → ${JSON.stringify(p)}`,
  );

  // NEGATIVE: `c.req.json()` READS a request — the bug the regex predecessor had.
  p = scanHonoRouteSource(`const body = await c.req.json();`);
  assert(p.bodies === 0, `a request read must not count as a body → ${JSON.stringify(p)}`);

  // NEGATIVE: prose quoting any of these is not a code path. The table above
  // quotes several, and must not move anyone's count.
  p = scanHonoRouteSource(`
    /* was: c.json({ error: 'Not found' }, 404) — see #9267 */
    // return c.json({ hasOwner: true });
    return c.json({ success: true, data });
  `);
  assert(
    p.bodies === 1 && p.stringError === 0 && p.unenveloped === 0,
    `commented-out Hono bodies counted → ${JSON.stringify(p)}`,
  );

  // NEGATIVE: `res.json(...)` is surface 1's shape, not this one — the two
  // scans must not both claim the same write site.
  p = scanHonoRouteSource(`res.status(404).json({ error: 'nope' });`);
  assert(p.bodies === 0, `a res.json write must not enter surface 3 → ${JSON.stringify(p)}`);

  // ── Surface 4 (#9813): the same grammar under express receivers ───────────
  //
  // The receiver set is the load-bearing difference: identical source reads as
  // zero bodies under the default (Hono) receivers and as a bare body under
  // EXPRESS_RESPONSE_RECEIVERS — which is exactly how dispatcher-plugin.ts's
  // discovery bodies sat invisible beside a green surface 3.
  const expressBare = `res.json({ data: await dispatcher.getDiscoveryInfo(prefix) });`;
  p = scanHonoRouteSource(expressBare, 'x.ts', EXPRESS_RESPONSE_RECEIVERS);
  assert(
    p.bodies === 1 && p.unenveloped === 1,
    `a bare express body must count under express receivers → ${JSON.stringify(p)}`,
  );
  assert(
    scanHonoRouteSource(expressBare, 'x.ts').bodies === 0,
    'the same express body must stay invisible to the default (Hono) receivers',
  );
  p = scanHonoRouteSource(`res.json({ success: true, data: await x() });`, 'x.ts', EXPRESS_RESPONSE_RECEIVERS);
  assert(
    p.bodies === 1 && p.unenveloped === 0,
    `the enveloped flip must read conformant under express receivers → ${JSON.stringify(p)}`,
  );
  // Relayed bodies are counted but never judged, in this dialect like the others.
  p = scanHonoRouteSource(`res.json(result.body); res.json(ANONYMOUS_DENY_BODY);`, 'x.ts', EXPRESS_RESPONSE_RECEIVERS);
  assert(
    p.bodies === 2 && p.unenveloped === 0,
    `relayed express bodies must count as bodies, never as counters → ${JSON.stringify(p)}`,
  );

  // ── The #9389 ruling: an exemption is a CLOSED list ───────────────────────
  //
  // The ruling's own load-bearing clause is that the boundary stays enumerated:
  // a NEW pre-auth bare surface must carry its own exempt-with-reason to pass.
  // That is a property of the TABLE, not of the scanner — the scanner counts a
  // new bare body either way, and whether that is a failure is decided by what
  // is declared. So these cases drive `auditPluginRouteModule`, which is why it
  // is a pure function; asserting only that `scanHonoRouteSource` still sees a
  // bare body would be pinning the half that was never in doubt.

  // The shape the ruling covers, so every case below is the real one.
  const preAuth = `rawApp.get('/bootstrap-status', async (c) => c.json({ hasOwner: true }));`;
  const ruled = {
    unenveloped: 1,
    exempt: 'pre-auth bootstrap, ruled outside BaseResponseSchema by design (2026-08-17, #9389 option B)',
  };
  const scanOf = (src) => scanHonoRouteSource(src, 'x.ts');
  assert(scanOf(preAuth).unenveloped === 1, 'the fixture must be a bare pre-auth body');

  // (1) A NEW FILE carrying one. Undeclared is an ERROR, never a default — the
  // closed list at file granularity. A new pre-auth surface does not inherit the
  // ruling by resembling the three files it named.
  let probs = auditPluginRouteModule('packages/plugins/plugin-new/src/plugin.ts', undefined, scanOf(preAuth));
  assert(
    probs.length === 1 && probs[0].includes('NOT DECLARED'),
    `an unlisted bare pre-auth route must fail the gate → ${JSON.stringify(probs)}`,
  );

  // (2) …and the same body added INSIDE a file that is already ruled exempt.
  // This is the case a file-level waiver would have passed in silence, and the
  // reason `exempt` stays counted on this surface.
  probs = auditPluginRouteModule('x.ts', ruled, scanOf(`${preAuth}\n${preAuth}`));
  assert(
    probs.length === 1 && probs[0].includes('CLOSED list'),
    `a second bare body on a ruled-exempt module must fail → ${JSON.stringify(probs)}`,
  );
  // …and it must send the author to the envelope, naming the widening path as
  // the maintainer's (#8435). A diagnostic offering "raise the number" as a
  // co-equal fix would let the ruling grow by author fiat.
  assert(
    probs[0].includes(RATCHET_AUTHORITY_MARKER),
    `widening a ruled boundary must be marked ${RATCHET_AUTHORITY_MARKER} → ${JSON.stringify(probs)}`,
  );

  // (3) At exactly the ruled count it is green — the exemption does its job.
  probs = auditPluginRouteModule('x.ts', ruled, scanOf(preAuth));
  assert(probs.length === 0, `a ruled-exempt module at its pinned count must pass → ${JSON.stringify(probs)}`);

  // (4) BELOW the count is red too. An enumeration that over-counts describes a
  // body the file no longer emits, and the reason is the deliverable here — a
  // reason nobody has to keep true decays into the waiver this is not.
  probs = auditPluginRouteModule('x.ts', ruled, scanOf(`c.json({ success: true, data });`));
  assert(
    probs.length === 1 && probs[0].includes('fewer than pinned'),
    `a ruled-exempt module below its pinned count must fail → ${JSON.stringify(probs)}`,
  );

  // (5) Tracked drift and a ruled boundary are exclusive claims about one
  // number. The fixture carries a `note` so this asserts the exclusivity rule
  // alone rather than tripping the ratchet's own note requirement as well.
  probs = auditPluginRouteModule('x.ts', { ...ruled, ratchet: '#9364', note: 'n' }, scanOf(preAuth));
  assert(
    probs.length === 1 && probs[0].includes('exclusive'),
    `ratchet + exempt must be refused → ${JSON.stringify(probs)}`,
  );

  // (6) An exemption with nothing to exempt is the file-level waiver again,
  // spelled as an empty one: it would sit dormant until the next bare body made
  // it retroactively cover something nobody ruled on.
  probs = auditPluginRouteModule('x.ts', { exempt: 'because' }, scanOf(`c.json({ success: true, data });`));
  assert(
    probs.length === 1 && probs[0].includes('pins no non-conforming body'),
    `an exemption over nothing must be refused → ${JSON.stringify(probs)}`,
  );

  // (7) NEGATIVE: the ordinary tracked-drift path is untouched by all of the
  // above — a ratchet gaining a body still says "raising the declared number is
  // not the fix", not the ruling's text.
  probs = auditPluginRouteModule('y.ts', { unenveloped: 1, ratchet: '#9364', note: 'n' }, scanOf(`${preAuth}\n${preAuth}`));
  assert(
    probs.length === 1 && probs[0].includes('Raising the declared number is not the fix') &&
    !probs[0].includes('CLOSED list'),
    `a ratchet must keep its own diagnostic → ${JSON.stringify(probs)}`,
  );

  console.log('✓ check-route-envelope self-test passed');
}

if (process.argv.includes('--self-test')) selfTest();
else audit();
