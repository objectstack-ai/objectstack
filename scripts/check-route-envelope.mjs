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
    ratchet: '#7035 (option 1: convert onto the shared sendOk/sendError)',
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

  console.log('✓ check-route-envelope self-test passed');
}

if (process.argv.includes('--self-test')) selfTest();
else audit();
