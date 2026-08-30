// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// ADR-0056 D10 — the authorization conformance matrix is a CHECKED artifact,
// within the scope the mechanism can see: routes are ratcheted, primitives are
// hand-maintained (see the matrix's own header for the narrowed claim and the
// measured numbers — #8711). Refactored onto the reusable ADR-0060
// `checkLedger` helper: one call asserts every shared invariant (valid state,
// enforced-has-site, experimental/removed-has-note, proof-file-exists,
// high-risk-has-proof). A row that regresses one of THOSE invariants, or a
// deleted proof, breaks the build.
//
// #2567 Phase 2 — the anonymous-deny SURFACES are additionally pinned by the
// `discover()` ratchet: this test STATICALLY enumerates the HTTP/transport
// entry points named in the curated `PROBES` table below and asserts each is
// classified by a matrix row. A new ungated route (or a removed/stale
// `covers` key) then fails CI as UNCLASSIFIED / STALE — the surface can't
// silently regress.
//
// #9083 — classification is not unconditional. `checkLedger` asks a
// non-`enforced` row for nothing but a `note`, so a row in ANY state could
// classify a discovered surface and clear the red. For the transport
// tripwires that made the gate's stated promise false: a wired realtime
// transport could be signed off by the very row recording that no
// per-recipient authorization exists. `checkTransportWiredAdmission` closes
// it, and `checkAuthzLedger` — not `checkLedger` — is what every assertion in
// this file drives.

import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readdirSync, readFileSync } from 'node:fs';
import { checkLedger } from '@objectstack/verify';
import { AUTHZ_CONFORMANCE, type AuthzPrimitive } from './authz-conformance.matrix.js';

const HERE = dirname(fileURLToPath(import.meta.url));
// packages/qa/dogfood/test → repo root.
const REPO_ROOT = join(HERE, '../../../..');

// ── #7976 — mutual row ↔ proof attribution ────────────────────────────────
// A proof file self-declares the rows it is the proof FOR with header
// `// authz-row: <id>` lines, and `checkLedger` asserts the pairing both ways.
// The keyword is deliberately NOT `@proof:` — that channel carries ADR-0054
// LIVENESS ids, a different vocabulary from matrix row ids (the same file is
// `@proof: cbp-controlled-by-parent` and `authz-row: controlled-by-parent`), and
// collapsing them would make one gate's rename silently re-point the other's.
const ATTRIBUTION_MARKER = 'authz-row';
// Scanned so a claim can never rot unnoticed: a claim living in a dogfood file
// NO row cites is invisible to the citation walk by construction, and is exactly
// what a renamed row or a re-pointed proof leaves behind.
const scanProofCandidates = (): string[] =>
  readdirSync(HERE).filter((f) => f.endsWith('.dogfood.test.ts'));
const ATTRIBUTION = { marker: ATTRIBUTION_MARKER, scan: scanProofCandidates } as const;

// ── #9083 — the TRANSPORT-WIRED vocabulary ────────────────────────────────
//
// A transport tripwire mints a key carrying this marker. The marker is the
// channel `checkTransportWiredAdmission` (below) keys on, so it is spelled in
// exactly ONE place and every tripwire key is built through `tripwireKey` — a
// probe that hand-rolled the suffix could drift out of the rule's sight
// silently, which is the failure mode a source-scanned vocabulary always has.
//
// ⚠️ Adding a transport tripwire? Mint its key with `tripwireKey`. A tripwire
// whose key does not carry the marker is NOT held to the admission rule.
const TRANSPORT_WIRED_MARKER = 'TRANSPORT-WIRED';
const tripwireKey = (surface: string): string => `${surface}(${TRANSPORT_WIRED_MARKER})`;

// ── #2567 ratchet — static enumeration of anonymous-deny HTTP entry points ──
//
// A CURATED per-file probe table (not a blind repo grep): scoped to the
// source files and route families named in PROBES below, so control-plane
// routes (/health, /auth, /ready, /discovery) are never enumerated as data
// surfaces. But each probe is pattern-based WITHIN its file, so a genuinely
// new route or handler matching an existing probe's pattern is auto-discovered
// → new key → a missing `covers` fails CI. Keys are derived from source
// CONTENT (route literals / handler names), never line numbers, so they don't
// churn on edits.
// ── the three INSTRUMENT KINDS, declared per probe ────────────────────────
//
// The table mixes three instruments with three different promises, and reading
// them with one number is the mistake this declaration exists to prevent: it
// reads working tripwires as holes and gate pins as route enumerations. The
// taxonomy was established by the reach census
// (`authz-probe-blind-spot.census.ts`) and lived there as PROSE; it lives here
// now, as data on the probe it describes, because a comment cannot be checked
// and a `kind` can.
//
//   ROUTE_ENUMERATION — pattern-based over a route/handler population. Its
//     stated promise is auto-discovery: "ANY new route matching this pattern
//     mints a new key". For these, entry points outside every mintable key
//     ARE the blind spot.
//   GATE_PIN — the key exists only while a NAMED gate call still exists in the
//     file (`shouldDenyAnonymous(`, `buildMcpBridge(deps, context)`,
//     `resolveStdioExecutionContext(`). It mints exactly one key by
//     construction; the promise is ANTI-REGRESSION on that one gate, never
//     route completeness. Zero keys here means "this file funnels through the
//     pinned gate", NOT "every route here is enumerated".
//   TRIPWIRE — deliberately matches nothing today. Zero keys is the CORRECT
//     reading, not a gap; armed alarms are not holes.
//
// What the declaration BUYS, beyond saying so: `checkProbeInstrumentIntegrity`
// below turns it into a checked claim. A ROUTE_ENUMERATION or GATE_PIN probe
// that mints ZERO keys has lost the population it promises to watch, and that
// is now RED instead of silent — the second, independent blind-spot mechanism
// (see that function's header for the measured instance).
type ProbeKind = 'ROUTE_ENUMERATION' | 'GATE_PIN' | 'TRIPWIRE';

interface Probe {
  /** Which instrument this is. DECLARED, never inferred from the pattern. */
  kind: ProbeKind;
  file: string;
  re: RegExp;
  key: (m: RegExpExecArray) => string;
}

const PROBES: readonly Probe[] = [
  // REST /meta umbrella registrar — one guarded registrar covers all ~17 routes.
  {
    kind: 'ROUTE_ENUMERATION',
    file: 'packages/rest/src/rest-server.ts',
    re: /private\s+registerMetadataEndpoints\s*\(/g,
    key: () => 'meta:rest-server.ts:registerMetadataEndpoints',
  },
  // Dispatcher meta handler — curated NAME only (NOT handleAI /
  // handleData / handleSecurity, which are separate surfaces/rows).
  {
    kind: 'ROUTE_ENUMERATION',
    file: 'packages/runtime/src/http-dispatcher.ts',
    re: /async\s+(handleMetadata)\s*\(/g,
    key: (m) => `meta:http-dispatcher.ts:${m[1]}`,
  },
  // ── #5519 — the two dispatcher-mounted execution surfaces ──────────────
  // These are GATE pins, in the shape the MCP rows below already use: the key
  // exists only while the domain handler still consults `shouldDenyAnonymous`.
  // Delete the gate (the #5519 regression, in either domain) and the key
  // vanishes → the covering row goes STALE → red CI. `/actions` and
  // `/automation` are mounted by dispatcher-plugin.ts, a separate registration
  // path from the `@objectstack/rest` one that gates `/data` and `/meta`, which
  // is exactly why they diverged unnoticed.
  {
    kind: 'GATE_PIN',
    file: 'packages/runtime/src/domains/actions.ts',
    re: /shouldDenyAnonymous\s*\(/g,
    key: () => 'actions:domains/actions.ts:anonymous-gate',
  },
  {
    kind: 'GATE_PIN',
    file: 'packages/runtime/src/domains/automation.ts',
    re: /shouldDenyAnonymous\s*\(/g,
    key: () => 'automation:domains/automation.ts:anonymous-gate',
  },
  // #7033 / #7023 — the /packages domain gate. Same GATE-pin shape: the key
  // exists only while `handlePackagesRequest` still consults
  // `shouldDenyAnonymous`. Delete the domain floor and the key vanishes → the
  // covering `anonymous-deny-packages` row goes STALE → red CI.
  {
    kind: 'GATE_PIN',
    file: 'packages/runtime/src/domains/packages.ts',
    re: /shouldDenyAnonymous\s*\(/g,
    key: () => 'packages:domains/packages.ts:anonymous-gate',
  },

  // ── a probe whose POPULATION WAS DELETED, re-declared for what it is ────
  //
  // This probe once read as ROUTE_ENUMERATION and its comment claimed live
  // discovery: "ANY new `rawApp.<verb>(`${prefix}/data...`)` mints a new key".
  // That spelling occurs ZERO times in the file and has since 2026-07-31, when
  // commit e5a4d26901 deleted the plugin CRUD/discovery surface — 3 matching
  // mounts before, 0 after. The probe stayed behind and has minted nothing
  // since, IN SILENCE, because STALE fires only for a key some matrix row
  // `covers` and no row ever covered a `data:hono-plugin.ts` key.
  //
  // ⚠️ It is re-declared TRIPWIRE, NOT deleted, and the difference matters:
  // deleting it would make this gate see LESS. As a declared tripwire its zero
  // is a CHECKED reading rather than an accident — the census carries a
  // positive control from this same file so a zero from a moved or emptied
  // file cannot pass as "nothing found" — and the day a `/data` route is
  // mounted here again the key appears and the surface is UNCLASSIFIED, which
  // is exactly a tripwire's promise.
  //
  // ⛔ Its key deliberately carries NO `TRANSPORT-WIRED` marker, so the
  // admission rule below does NOT apply to it. That rule is the realtime
  // vocabulary's, and it demands a per-recipient DELIVERY authorization site;
  // a re-mounted `/data` route is an ordinary data surface, and holding it to
  // a realtime remedy would be the wrong checklist on a red.
  //
  // ⚠️ The live spelling this pattern watches for exists one file away, in
  // `current-user-endpoints.ts` (3 mounts, none of them `/data`), which this
  // table does not name. Naming it is a POPULATION decision and is deliberately
  // not taken here — see the census's population-source record.
  {
    kind: 'TRIPWIRE',
    file: 'packages/plugins/plugin-hono-server/src/hono-plugin.ts',
    re: /rawApp\.(get|post|put|patch|delete)\(\s*`\$\{prefix\}(\/data[^`]*)`/g,
    key: (m) => `data:hono-plugin.ts:${m[1].toUpperCase()} ${m[2]}`,
  },

  // ── #2992 / ADR-0096 D4 — latent-surface identity pins ─────────────────
  // Realtime delivery fan-out: pins the trusted-internal-only posture of the
  // in-memory adapter's publish loop (`realtime-delivery-authz` row).
  {
    kind: 'GATE_PIN',
    file: 'packages/services/service-realtime/src/in-memory-realtime-adapter.ts',
    re: /async\s+publish\s*\(/g,
    key: () => 'realtime:in-memory-realtime-adapter.ts:publish(trusted-fan-out)',
  },

  // ── #2992 transport TRIPWIRES — deliberately covered by NO row ──────────
  // Delivery today is a pure fan-out with no per-recipient authorization
  // (subscriptions carry no principal, payload is the full record), which is
  // safe ONLY while every subscriber is server-internal. These patterns match
  // nothing today; the moment someone wires an end-user realtime transport
  // (WebSocket handshake, SSE, a client transport) a NEW key appears →
  // UNCLASSIFIED surface → red CI with this checklist: add per-recipient
  // RLS/FLS/tenant re-check on delivery (or switch to id-only payloads),
  // THEN register the enforcement site in a matrix row covering the new key.
  //
  // [#9083] That last step is now MECHANICAL, not merely written down here:
  // `checkTransportWiredAdmission` below refuses a TRANSPORT-WIRED key
  // classified by a row that is not `enforced`, so the shortest path from red
  // back to green runs through an enforcement site rather than around it.
  {
    kind: 'TRIPWIRE',
    file: 'packages/services/service-realtime/src/in-memory-realtime-adapter.ts',
    re: /handleUpgrade\s*\(/g,
    key: () => tripwireKey('realtime:in-memory-realtime-adapter.ts:handleUpgrade'),
  },
  {
    kind: 'TRIPWIRE',
    file: 'packages/services/service-realtime/src/realtime-service-plugin.ts',
    re: /handleUpgrade\s*\(|new\s+WebSocketServer|text\/event-stream/g,
    key: () => tripwireKey('realtime:realtime-service-plugin.ts:transport'),
  },
  {
    kind: 'TRIPWIRE',
    file: 'packages/runtime/src/http-dispatcher.ts',
    re: /async\s+handle(Realtime|Upgrade|Subscribe)\w*\s*\(/g,
    key: (m) => tripwireKey(`realtime:http-dispatcher.ts:handle${m[1]}`),
  },
  {
    kind: 'TRIPWIRE',
    file: 'packages/client/src/realtime-api.ts',
    re: /new\s+WebSocket\b|new\s+EventSource\b/g,
    key: () => tripwireKey('realtime:client/realtime-api.ts:transport'),
  },
  // ── #9084 — the rest-server tripwire, keyed off MECHANICS ──────────────
  //
  // packages/rest/src has ZERO realtime refs today (#2992). The original
  // single probe here watched for a route literal containing `/realtime`,
  // and that spelling is one the project's own documentation contradicts:
  // `content/docs/protocol/kernel/realtime-protocol.mdx` names the planned
  // transports as WebSocket (`/ws`) and SSE (`/api/v1/stream`), NEITHER of
  // which contains `/realtime`. That page is a declared input of this package
  // (see the dogfood entry in the cross-package-test-inputs gate),
  // deliberately: these probes are only correct for as long as they cover what
  // that page documents as the planned transports, so an edit adding a third
  // spelling there must re-run this test — the coupling this card is fixing.
  // Mounting either transport produced no key, no
  // UNCLASSIFIED surface and no red CI, while the one documented path the
  // pattern did match — `/api/v1/realtime/events` — is the debug/event-log
  // endpoint that carries no subscription fan-out. The guard was aimed at the
  // least dangerous of the three documented paths and blind to the two that
  // actually deliver events to end users.
  //
  // Two probes, because the two channels were MEASURED to be complementary
  // rather than alternatives (the `#9084` block at the bottom of this file
  // pins the measurement; on the sample there, neither arm catches a single
  // spelling the other does):
  //
  //  (1) MECHANICS — the act of wiring, regardless of naming. This is the
  //      property the other four tripwires already have and this one lacked:
  //      they watch `handleUpgrade`, `new WebSocketServer`,
  //      `text/event-stream`, `new WebSocket` / `new EventSource`. A transport
  //      mounted at `/live`, `/events` or any other unforeseen spelling still
  //      has to perform one of these acts somewhere.
  //  (2) PATHS — retained and widened, NOT traded away. Mechanics alone has
  //      its own blind spot: a route mounted here whose handler delegates the
  //      SSE write or the upgrade to a helper in another module shows no
  //      mechanical marker in THIS file at all, and only the path names it.
  //      `/realtime` is kept verbatim so no coverage the incumbent had is
  //      lost, and `/ws` + `/stream` (plus the neighbouring spellings a router
  //      realistically takes) are added.
  //
  // ⚠️ The path arm keys on the route SUFFIX, never on the documented full
  // path. Measured: every `path:` value in rest-server.ts is composed
  // (`` `${basePath}/discovery` ``, `` `${metaPath}/types` ``) and every
  // verbatim `/api/v1/...` string in the file lives in a COMMENT — so a probe
  // widened to the documented literal `/api/v1/stream` would have stayed just
  // as blind as the one it replaced.
  {
    kind: 'TRIPWIRE',
    file: 'packages/rest/src/rest-server.ts',
    re: /handleUpgrade\s*\(|new\s+WebSocketServer\b|new\s+WebSocket\b|new\s+EventSource\b|upgradeWebSocket\b|WebSocketPair\b|Sec-WebSocket-|text\/event-stream|streamSSE\s*\(/g,
    key: () => tripwireKey('realtime:rest-server.ts:transport'),
  },
  {
    kind: 'TRIPWIRE',
    file: 'packages/rest/src/rest-server.ts',
    // Word-boundary lookaheads on `ws`/`stream` keep the file's 31 unrelated
    // response-streaming references (and paths like `/workspaces`) out: they
    // are matched only as a whole route segment, never as a prefix.
    re: /['"`][^'"`]*(?:\/realtime|\/(?:websockets?|ws)(?![\w-])|\/(?:streams?|sse)(?![\w-]))[^'"`]*['"`]/g,
    key: () => tripwireKey('realtime:rest-server.ts:route'),
  },

  // ── #9410 — the tripwire population's DELIBERATE boundary ─────────────
  //
  // `packages/runtime/src/dispatcher-plugin.ts` is NOT in the list above, and
  // that is a decision on record rather than an oversight — read this before
  // concluding it was simply missed. It has both properties that make a file a
  // plausible landing site for a realtime transport: it mounts routes
  // (`/actions`, `/automation`, `/packages` — the separate registration path
  // named in the #5519 note above, which is a DIFFERENT point about anonymous
  // gates, not this one), and it already writes SSE — content type,
  // `no-cache`, `keep-alive` and all.
  //
  // Its two `text/event-stream` sites are nevertheless outside the #2992
  // tripwire set, because they are per-request AI response streaming, not
  // realtime subscription fan-out: each drains one `AsyncIterable` that the
  // route handler itself returned into that same request's response body, then
  // calls `res.end()`. No subscriber is registered, no event is delivered to a
  // SET of recipients, and the file carries no upgrade handler, no subscribe
  // registration and no realtime-service call. Watching them with the mechanics
  // pattern would mint a TRANSPORT-WIRED key on day one for a surface that is
  // not the hazard #2992 is about, and the only exits from that red would be to
  // classify two non-realtime sites in the matrix vocabulary or to weaken the
  // pattern — so this record adds no probe, no key and no matrix row.
  //
  // ⚠️ The boundary is drawn on FAN-OUT, not on the SSE content type. Wire an
  // actual subscription transport into that file — an upgrade handler, a
  // subscribe registration, a realtime-service call — and it is back inside the
  // hazard while this paragraph still says otherwise: nothing here will fail
  // for you. Promoting the file into the population with a fan-out-specific
  // marker (NOT the bare content type, which is precisely what would over-match
  // the two sites above) is written into #8347's acceptance as a precondition
  // of the WS/SSE transport landing. The twin record, for a reader arriving
  // from the docs side, is the identity-admission callout in
  // `content/docs/protocol/kernel/realtime-protocol.mdx`.

  // ── ADR-0096 / #3167 — MCP execution-surface identity pins ─────────────
  // (1) The HTTP `/mcp` handler must stay classified (a new sibling MCP data
  // handler → UNCLASSIFIED). (2) Its caller-identity threading: handleMcp must
  // build the tool bridge FROM the request context (carrying the caller EC).
  // Drop the threading (or build a system/unscoped bridge for HTTP) → the
  // context-threaded key vanishes → the mcp-http-identity row goes STALE → red CI.
  {
    kind: 'ROUTE_ENUMERATION',
    file: 'packages/runtime/src/http-dispatcher.ts',
    re: /async\s+handleMcp\s*\(/g,
    key: () => 'mcp:http-dispatcher.ts:handleMcp',
  },
  {
    kind: 'GATE_PIN',
    file: 'packages/runtime/src/domains/mcp.ts',
    re: /buildMcpBridge\(deps, context\)/g,
    key: () => 'mcp:domains/mcp.ts:buildMcpBridge(context-threaded)',
  },
  // (3) The stdio transport's PRINCIPAL binding (ADR-0101): the long-lived
  // server reads record data only under an OS_MCP_STDIO_API_KEY identity,
  // resolved via resolveStdioExecutionContext and threaded into the record
  // reader. Dropping that resolution (reverting to a raw/unscoped bridge) makes
  // this key vanish → the mcp-stdio-authority row goes STALE → red CI.
  {
    kind: 'GATE_PIN',
    file: 'packages/mcp/src/plugin.ts',
    re: /resolveStdioExecutionContext\s*\(/g,
    key: () => 'mcp:plugin.ts:stdio-principal-bound',
  },
];

/**
 * Keys ONE probe mints against today's source.
 *
 * Split out from the walk below so per-probe reach is measurable on its own.
 * The union is what the ratchet classifies; the per-probe count is what says
 * whether an instrument is still pointed at anything, and a union cannot
 * answer that — a probe that has gone blind contributes nothing to the union
 * and is indistinguishable, there, from a probe that never existed.
 */
function keysMintedBy(probe: Probe): Set<string> {
  const src = readFileSync(join(REPO_ROOT, probe.file), 'utf8');
  // Fresh lastIndex per read (the RegExp is shared, `g`-flagged).
  probe.re.lastIndex = 0;
  const found = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = probe.re.exec(src)) !== null) found.add(probe.key(m));
  return found;
}

/** Statically enumerate the anonymous-deny HTTP entry points from source. */
function discoverAnonymousDenySurfaces(): Set<string> {
  const found = new Set<string>();
  for (const probe of PROBES) for (const k of keysMintedBy(probe)) found.add(k);
  return found;
}

// ── a probe whose POPULATION was deleted must not fail SILENTLY ───────────
//
// The second, independent blind-spot mechanism — and the one the surface
// ratchet structurally cannot catch. UNCLASSIFIED fires on a key that APPEARS;
// STALE fires on a `covers` key that DISAPPEARS. Both are keyed on a KEY. A
// probe that stops minting a key it never had a `covers` row for produces
// neither signal: no key appears, no `covers` goes stale, and the table keeps
// a dead instrument that reads exactly like a healthy one.
//
// Measured instance: the raw-hono `/data` probe above watched a spelling that
// commit e5a4d26901 (2026-07-31) deleted — 3 matching mounts before, 0 after —
// and said nothing for the entire time since, because no row had ever covered
// a `data:hono-plugin.ts` key.
//
// The check is the declared `kind`, applied:
//
//   ROUTE_ENUMERATION / GATE_PIN — both promise a population that EXISTS. One
//     promises to enumerate a route family, the other to hold a named gate in
//     place. Either minting zero keys means the thing it watches is gone from
//     the file, and that is now a failure rather than silence.
//   TRIPWIRE — exempt BY DECLARATION, because matching nothing is its whole
//     job. That exemption is exactly why the kind is declared per probe rather
//     than guessed from the pattern: it must be a written, reviewable claim,
//     not something an instrument infers about itself.
//
// ⛔ The exemption is not an escape hatch for a probe that has gone blind.
// Re-declaring a ROUTE_ENUMERATION probe as TRIPWIRE to clear a red is only
// honest when its population really is gone AND the zero is backed by a
// positive control from that same file (the reach census holds one per file) —
// the hono probe above is written that way, dated evidence and all.
function checkProbeInstrumentIntegrity(probes: readonly Probe[]): string[] {
  const problems: string[] = [];
  for (const probe of probes) {
    if (probe.kind === 'TRIPWIRE') continue;
    if (keysMintedBy(probe).size > 0) continue;
    problems.push(
      `DEAD PROBE — ${probe.file}: a ${probe.kind} probe minting ZERO keys. ` +
        'Its population is gone from that file, and neither UNCLASSIFIED nor STALE can say so ' +
        '(both are keyed on a key: one that appears, one that disappears). ' +
        'Three honest exits, and no fourth: repoint the probe at the surface that replaced the ' +
        'deleted one; re-declare it TRIPWIRE if the population really is gone, with the dated ' +
        'evidence and a positive control from that same file; or delete the probe TOGETHER WITH ' +
        'the surface it watched. Silence is what this check exists to remove.',
    );
  }
  return problems;
}

// ── #9083 — a wired transport is admitted ONLY by an `enforced` row ───────
//
// The defect this closes, measured on `origin/main` before the fix: the
// tripwire note promised the gate "holds out for the enforcement site", and it
// did not. `checkLedger` requires an `enforcement` site only when
// `state === 'enforced'`, while a row's `covers` keys classify a discovered
// surface REGARDLESS of state. So wiring a real client transport
// (`new EventSource(...)` in packages/client/src/realtime-api.ts) went red as
// UNCLASSIFIED — and appending that one tripwire key to the EXPERIMENTAL
// `realtime-delivery-authz` row, whose own summary records that there is NO
// per-recipient authorization, turned CI green again with zero authorization
// written. Measured both ways: `experimental` and `removed` each admitted the
// exit identically (15/15 green), because the only thing `checkLedger` asks of
// a non-enforced row is a `note`.
//
// The rule, deliberately narrow (it keys on the TRANSPORT-WIRED marker, not on
// `covers` in general): a tripwire key may be classified ONLY by an `enforced`
// row. `checkLedger`'s existing enforced-has-site invariant then supplies the
// second half for free — an `enforced` row with no `enforcement` string is
// already a problem — so this rule and that one COMPOSE into the promise the
// note makes, rather than restating it.
//
// Why here and not in `checkLedger`: TRANSPORT-WIRED is this ledger's OWN
// vocabulary, minted by the probe table 40 lines up. `checkLedger` is the
// shared ADR-0060 helper backing five other conformance ledgers, none of which
// has transport tripwires; teaching it this marker would leak one ledger's
// vocabulary into all of them.
function checkTransportWiredAdmission(rows: readonly AuthzPrimitive[]): string[] {
  const problems: string[] = [];
  for (const r of rows) {
    for (const c of r.covers ?? []) {
      if (!c.includes(TRANSPORT_WIRED_MARKER) || r.state === 'enforced') continue;
      problems.push(
        `${r.id}: a ${TRANSPORT_WIRED_MARKER} surface cannot be classified by a '${r.state}' row — ${c}. ` +
          'A wired end-user transport is admitted only by an `enforced` row naming its per-recipient ' +
          'delivery authorization site (RLS/FLS/tenant re-check with the subscriber ExecutionContext, or ' +
          'id-only payloads + client re-fetch). Write that enforcement FIRST, then classify the key on the ' +
          'enforced row — classifying it here silences the tripwire with no authorization written (#9083).',
      );
    }
  }
  return problems;
}

/**
 * This ledger's full gate: the shared ADR-0060 invariants plus the #9083
 * TRANSPORT-WIRED admission rule. Every assertion in this file drives THIS,
 * not `checkLedger` directly, so no case can pass against a weaker gate than
 * the one CI runs.
 */
function checkAuthzLedger(
  rows: readonly AuthzPrimitive[],
  opts: Parameters<typeof checkLedger>[1],
): string[] {
  return [...checkLedger(rows, opts), ...checkTransportWiredAdmission(rows)];
}

const HIGH_RISK = [
  'owd-private', 'owd-public-read', 'controlled-by-parent', 'anonymous-deny', 'default-profile',
  // #2567 — every anonymous-deny HTTP surface is high-risk: it guards the
  // same object data as REST `/data` through a sibling entry point.
  // (the raw-hono `/data` row retired with its surface — #4073 deleted the
  // entry point rather than gating it, so there is nothing left to mark
  // high-risk there)
  'anonymous-deny-meta',
  // #5519 — the dispatcher-mounted execution surfaces. `/actions` reaches a
  // `script` body that runs `isSystem: true` elevated and `/automation` starts,
  // lists and deregisters flows, so both guard the same object data as REST
  // `/data` through sibling entry points. Proven end-to-end by the same
  // surfaces proof (#5570).
  'anonymous-deny-actions',
  'anonymous-deny-automation',
  // #7033 / #7023 — the package-management surface guards destructive writes
  // (discard-drafts / publish-drafts / delete / rollback) and the whole-package
  // export/enumeration read face through a sibling dispatcher entry point, the
  // last routed domain that had no authorization at all.
  'anonymous-deny-packages',
  // #2948/#3003 — write-integrity face: without the strip, `readonly: true`
  // is false compliance (declared ≠ enforced) and approval/status columns are
  // one direct PATCH away from self-approval.
  'readonly-static-write',
  // #3167 — the MCP HTTP surface guards the same object data as REST /data
  // through a sibling execution surface (tool dispatch); proven e2e that a
  // member's MCP tools/call is RLS-scoped and anonymous is denied.
  'mcp-http-identity',
];

describe('ADR-0056 D10 — authorization conformance matrix', () => {
  it('is a sound conformance ledger (ADR-0060 checkLedger) + the #2567 surface ratchet holds', () => {
    const problems = checkAuthzLedger(AUTHZ_CONFORMANCE, {
      proofRoot: HERE, // proofs are dogfood test files alongside this one
      highRisk: HIGH_RISK,
      // The ratchet: every discovered PROBES entry point must be classified
      // by exactly one row's `covers`, and no `covers` key may be stale (no
      // longer in source).
      discover: () => discoverAnonymousDenySurfaces(),
      // #7976 — and the cited proofs must NAME the rows they prove.
      attribution: ATTRIBUTION,
    });
    expect(problems, problems.join('\n')).toEqual([]);
  });

  it('every non-tripwire probe is still pointed at a population that exists', () => {
    // The dead-probe check, on the REAL table and the REAL sources. It is a
    // separate `it` rather than a member of `checkAuthzLedger` on purpose:
    // `checkAuthzLedger` grades ROWS against a supplied `discover`, and every
    // controlled-input case below hands it a synthetic one. Folding a
    // source-reading probe check into it would make those cases depend on the
    // repo's real files for a property none of them is about.
    const problems = checkProbeInstrumentIntegrity(PROBES);
    expect(problems, problems.join('\n')).toEqual([]);
  });
});

// ── the dead-probe check BITES, and is not vacuous ────────────────────────
//
// Same discipline as every other block here: a check that has never been shown
// to fail is not evidence. Each case drives `checkProbeInstrumentIntegrity`
// with synthetic probes, so it is deterministic and needs no source edits.
describe('a probe that has lost its population is caught, not silent', () => {
  const REAL_FILE = 'packages/rest/src/rest-server.ts';
  // A pattern certain to be absent from that file, standing in for a spelling
  // whose surface was deleted. Paired with a live pattern below, so a zero here
  // is a reading about the PATTERN and not about a missing file.
  const ABSENT = /zzz_no_such_spelling_zzz/g;
  const PRESENT = /private\s+registerMetadataEndpoints\s*\(/g;

  it('CONTROL — the file is readable and the live pattern fires (the zero is a reading)', () => {
    expect(keysMintedBy({ kind: 'ROUTE_ENUMERATION', file: REAL_FILE, re: PRESENT, key: () => 'k' }).size)
      .toBeGreaterThan(0);
    expect(keysMintedBy({ kind: 'ROUTE_ENUMERATION', file: REAL_FILE, re: ABSENT, key: () => 'k' }).size)
      .toBe(0);
  });

  it('a ROUTE_ENUMERATION probe minting zero keys is a DEAD PROBE', () => {
    const problems = checkProbeInstrumentIntegrity([
      { kind: 'ROUTE_ENUMERATION', file: REAL_FILE, re: ABSENT, key: () => 'k' },
    ]);
    expect(problems.some((p) => /DEAD PROBE/.test(p) && p.includes(REAL_FILE))).toBe(true);
  });

  it('a GATE_PIN whose named gate vanished is caught even when NO row covers it', () => {
    // The exact hole: STALE needs a `covers` key to fire against. A gate pin
    // nobody classified loses its gate in total silence under the old gate,
    // and this is the check that speaks instead.
    const key = 'gate:no-row-covers-this-one';
    expect(AUTHZ_CONFORMANCE.flatMap((r) => r.covers ?? [])).not.toContain(key);
    const problems = checkProbeInstrumentIntegrity([
      { kind: 'GATE_PIN', file: REAL_FILE, re: ABSENT, key: () => key },
    ]);
    expect(problems.some((p) => /DEAD PROBE/.test(p))).toBe(true);
  });

  it('a TRIPWIRE minting zero keys is CORRECT and stays silent', () => {
    // The other direction, and the one a uniform count gets wrong: six armed
    // alarms are not six holes.
    expect(checkProbeInstrumentIntegrity([
      { kind: 'TRIPWIRE', file: REAL_FILE, re: ABSENT, key: () => 'k' },
    ])).toEqual([]);
  });

  it('the real table is all three kinds — the check is not passing for lack of subjects', () => {
    const kinds = new Set(PROBES.map((p) => p.kind));
    expect([...kinds].sort()).toEqual(['GATE_PIN', 'ROUTE_ENUMERATION', 'TRIPWIRE']);
    // …and it really is grading something: the exempt kind is not the whole table.
    expect(PROBES.filter((p) => p.kind !== 'TRIPWIRE').length).toBeGreaterThan(0);
  });
});

// #2567 — prove the ratchet actually BITES. Drives `checkLedger` with controlled
// inputs (deep-cloned matrix / synthetic discover) so it's deterministic and
// needs no source edits. If these ever pass vacuously, the ratchet is asleep.
describe('#2567 — anonymous-deny surface ratchet bites', () => {
  const clone = (): AuthzPrimitive[] => JSON.parse(JSON.stringify(AUTHZ_CONFORMANCE));
  const opts = (discover: () => Iterable<string>) => ({
    proofRoot: HERE,
    highRisk: HIGH_RISK,
    discover,
    attribution: ATTRIBUTION,
  });

  it('the real matrix + real discover is sound (baseline lock)', () => {
    const problems = checkAuthzLedger(AUTHZ_CONFORMANCE, opts(() => discoverAnonymousDenySurfaces()));
    expect(problems).toEqual([]);
  });

  it('(a) a row that DROPS its covers → UNCLASSIFIED surface failure', () => {
    // Fixture moved off the raw-hono `/data` row when #4073 deleted that
    // surface. `anonymous-deny-meta` covers a live one, so the ratchet still
    // has a real classification to lose.
    const m = clone();
    const row = m.find((r) => r.id === 'anonymous-deny-meta')!;
    row.covers = [];
    const problems = checkAuthzLedger(m, opts(() => discoverAnonymousDenySurfaces()));
    expect(problems.some((p) => /UNCLASSIFIED surface/.test(p) && /meta:/.test(p))).toBe(true);
  });

  it('(b) a NEW ungated route appearing in source → UNCLASSIFIED surface failure', () => {
    const fake = 'data:hono-plugin.ts:DELETE /data/fake';
    const problems = checkAuthzLedger(
      AUTHZ_CONFORMANCE,
      opts(() => new Set([...discoverAnonymousDenySurfaces(), fake])),
    );
    expect(problems.some((p) => p.includes('UNCLASSIFIED surface') && p.includes(fake))).toBe(true);
  });

  it('(c) a covers key no longer in source → STALE covers failure', () => {
    const m = clone();
    const row = m.find((r) => r.id === 'anonymous-deny-meta')!;
    row.covers = [...(row.covers ?? []), 'meta:http-dispatcher.ts:handleRemovedThing'];
    const problems = checkAuthzLedger(m, opts(() => discoverAnonymousDenySurfaces()));
    expect(problems.some((p) => /STALE covers/.test(p) && /handleRemovedThing/.test(p))).toBe(true);
  });

  // ── #2992 — the latent-surface pins bite too ──────────────────────────
  it('(d) wiring a realtime transport (tripwire key appears) → UNCLASSIFIED surface failure (#2992)', () => {
    const fake = 'realtime:in-memory-realtime-adapter.ts:handleUpgrade(TRANSPORT-WIRED)';
    const problems = checkAuthzLedger(
      AUTHZ_CONFORMANCE,
      opts(() => new Set([...discoverAnonymousDenySurfaces(), fake])),
    );
    expect(problems.some((p) => p.includes('UNCLASSIFIED surface') && p.includes(fake))).toBe(true);
  });

  // ── ADR-0096 / #3167 — the MCP identity pins bite too ──────────────────
  it('(f) dropping the MCP HTTP context-thread → STALE covers failure (#3167)', () => {
    const threaded = 'mcp:domains/mcp.ts:buildMcpBridge(context-threaded)';
    // Baseline sanity: the HTTP `/mcp` handler threads the caller EC today.
    expect(discoverAnonymousDenySurfaces().has(threaded)).toBe(true);
    const problems = checkAuthzLedger(
      AUTHZ_CONFORMANCE,
      opts(() => new Set([...discoverAnonymousDenySurfaces()].filter((k) => k !== threaded))),
    );
    expect(problems.some((p) => /STALE covers/.test(p) && p.includes(threaded))).toBe(true);
  });

  it('(g) the stdio principal binding is pinned; dropping it goes STALE (ADR-0101)', () => {
    const stdio = 'mcp:plugin.ts:stdio-principal-bound';
    // Baseline sanity: the stdio path resolves an API-key principal today.
    expect(discoverAnonymousDenySurfaces().has(stdio)).toBe(true);
    const problems = checkAuthzLedger(
      AUTHZ_CONFORMANCE,
      opts(() => new Set([...discoverAnonymousDenySurfaces()].filter((k) => k !== stdio))),
    );
    expect(problems.some((p) => /STALE covers/.test(p) && p.includes(stdio))).toBe(true);
  });

  // ── #5519 — the dispatcher execution-surface gates bite too ────────────
  it('(h) deleting either /actions or /automation anonymous gate → STALE covers failure (#5519)', () => {
    for (const gate of [
      'actions:domains/actions.ts:anonymous-gate',
      'automation:domains/automation.ts:anonymous-gate',
    ]) {
      // Baseline sanity: the gate is in source TODAY. If this ever goes false
      // the surface has regressed to its pre-#5569 state, which is the whole
      // point of the pin.
      expect(discoverAnonymousDenySurfaces().has(gate), `${gate} must be in source`).toBe(true);
      const problems = checkAuthzLedger(
        AUTHZ_CONFORMANCE,
        opts(() => new Set([...discoverAnonymousDenySurfaces()].filter((k) => k !== gate))),
      );
      expect(problems.some((p) => /STALE covers/.test(p) && p.includes(gate))).toBe(true);
    }
  });
});

// ── #9083 — the TRANSPORT-WIRED admission rule bites ──────────────────────
//
// This block is the filer's two-leg reverse verification, mechanised: leg 1
// (wiring a transport reds CI as UNCLASSIFIED) is case (i); leg 2 (appending
// the key to the absence-recording row turns it green again) is case (j),
// which must now STAY red. Each case that asserts a refusal also asserts that
// bare `checkLedger` — the gate as it shipped before #9083 — accepts the very
// same ledger, so none of them can pass for an unrelated reason. If that
// paired assertion ever inverts, this rule has stopped being the thing that
// holds and these cases are testing something else.
describe('#9083 — a wired transport is admitted only by an `enforced` row', () => {
  const clone = (): AuthzPrimitive[] => JSON.parse(JSON.stringify(AUTHZ_CONFORMANCE));
  const opts = (discover: () => Iterable<string>) => ({
    proofRoot: HERE,
    highRisk: HIGH_RISK,
    discover,
    attribution: ATTRIBUTION,
  });
  // The exact key the filer's `new EventSource('/api/v1/stream')` minted.
  const WIRED = tripwireKey('realtime:client/realtime-api.ts:transport');
  const wiredDiscover = () => new Set([...discoverAnonymousDenySurfaces(), WIRED]);

  it('the real matrix declares no TRANSPORT-WIRED key today (non-vacuity)', () => {
    // Every case below is about a key that does not exist yet. If the ledger
    // ever legitimately classifies one, this expectation is the place that
    // says so out loud rather than letting the block quietly go vacuous.
    const declared = AUTHZ_CONFORMANCE.flatMap((r) => r.covers ?? []).filter((c) =>
      c.includes(TRANSPORT_WIRED_MARKER),
    );
    expect(declared).toEqual([]);
    expect(checkTransportWiredAdmission(AUTHZ_CONFORMANCE)).toEqual([]);
  });

  it('(i) leg 1 — wiring a transport is an UNCLASSIFIED surface (unchanged by #9083)', () => {
    // The tripwire's original property must survive the new rule: a wired
    // transport nobody has classified is still red, for the same reason.
    const problems = checkAuthzLedger(AUTHZ_CONFORMANCE, opts(wiredDiscover));
    expect(problems.some((p) => p.includes('UNCLASSIFIED surface') && p.includes(WIRED))).toBe(true);
  });

  it('(j) leg 2 — appending the key to the EXPERIMENTAL realtime row stays red', () => {
    const m = clone();
    const row = m.find((r) => r.id === 'realtime-delivery-authz')!;
    expect(row.state).toBe('experimental');
    row.covers = [...(row.covers ?? []), WIRED];

    // The defect, pinned: the pre-#9083 gate accepted exactly this ledger —
    // a live client transport, "NO per-recipient authorization" in the row's
    // own summary, and a green build.
    expect(checkLedger(m, opts(wiredDiscover))).toEqual([]);

    // …and the composed gate refuses it, naming the row and the remedy.
    const problems = checkAuthzLedger(m, opts(wiredDiscover));
    expect(
      problems.some(
        (p) => p.startsWith('realtime-delivery-authz:') && p.includes(TRANSPORT_WIRED_MARKER),
      ),
      problems.join('\n'),
    ).toBe(true);
  });

  it('(k) the `removed` state admits no exit either — all three states measured', () => {
    // `removed` is the third AuthzState and was measured to admit the identical
    // exit (green, zero authorization written), so the rule keys on "not
    // enforced" rather than on "experimental".
    const m = clone();
    const row = m.find((r) => r.id === 'agent-visibility')!;
    expect(row.state).toBe('removed');
    row.covers = [...(row.covers ?? []), WIRED];

    expect(checkLedger(m, opts(wiredDiscover))).toEqual([]);
    expect(
      checkAuthzLedger(m, opts(wiredDiscover)).some((p) => p.startsWith('agent-visibility:')),
    ).toBe(true);
  });

  it('(l) an `enforced` row naming its enforcement site DOES admit the key', () => {
    // The rule makes the gate stricter, not impassable: the admission path the
    // note promises has to actually work, or the next author has no way out
    // except deleting the tripwire.
    const m = clone();
    m.push({
      id: 'realtime-delivery-recipient-authz',
      summary: 'per-recipient RLS/FLS/tenant re-check on realtime delivery',
      state: 'enforced',
      enforcement:
        'service-realtime/in-memory-realtime-adapter.ts — delivery re-checks each subscriber ExecutionContext before fan-out',
      covers: [WIRED],
    });
    expect(checkAuthzLedger(m, opts(wiredDiscover))).toEqual([]);
  });

  it('(m) an `enforced` row with NO enforcement site does not admit it (composition)', () => {
    // The second half comes from `checkLedger`'s own enforced-has-site
    // invariant. This case is what proves the two rules COMPOSE into the
    // note's promise — flipping the state alone must not be a way through.
    const m = clone();
    m.push({
      id: 'realtime-delivery-recipient-authz',
      summary: 'per-recipient re-check — state flipped, site never written',
      state: 'enforced',
      covers: [WIRED],
    });
    const problems = checkAuthzLedger(m, opts(wiredDiscover));
    expect(
      problems.some((p) => /enforced but names no enforcement site/.test(p)),
      problems.join('\n'),
    ).toBe(true);
  });
});

// ── #9084 — the rest-server tripwire catches what it was widened for ──────
//
// The reverse verification, mechanised. A widened guard never shown to catch
// the thing it was widened for is not a fix, and "it reads zero on the real
// file" is worth nothing on its own — a pattern that matches NOTHING reads
// zero too. So every zero asserted here is paired with a planted control that
// proves the same pattern fires, and the defect itself is pinned by running
// the INCUMBENT pattern over the identical sample.
//
// Each spelling below is written the way rest-server.ts really registers a
// route (`path: `${basePath}/x``) or writes a content type
// (`res.header('Content-Type', ...)`), not as an idealised literal.
describe('#9084 — the rest-server.ts transport tripwire keys off mechanics', () => {
  const REST_SERVER = 'packages/rest/src/rest-server.ts';
  const restProbes = PROBES.filter((p) => p.file === REST_SERVER && p.key({} as RegExpExecArray).includes(TRANSPORT_WIRED_MARKER));
  const MECHANICS = restProbes.find((p) => p.key({} as RegExpExecArray).includes(':transport('))!;
  const ROUTES = restProbes.find((p) => p.key({} as RegExpExecArray).includes(':route('))!;

  // The pattern as it shipped before #9084 — a route literal containing
  // `/realtime`, and nothing else. Restated here (not imported) because it is
  // the DEFECT being pinned, not a thing this file should keep using.
  const INCUMBENT = /['"`][^'"`]*\/realtime[^'"`]*['"`]/g;

  const hits = (re: RegExp, text: string): string[] => {
    re.lastIndex = 0;
    const out: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) out.push(m[0]);
    return out;
  };
  const fires = (text: string): boolean =>
    hits(MECHANICS.re, text).length > 0 || hits(ROUTES.re, text).length > 0;

  // The two transports the protocol page documents as planned, plus the
  // neighbouring spellings a router realistically takes, plus the mechanical
  // acts a transport cannot avoid performing.
  const DOCUMENTED = {
    'WebSocket route (/ws)': "this.routeManager.register({ method: 'GET', path: `${basePath}/ws`, handler: h });",
    'SSE route (/api/v1/stream)': "this.routeManager.register({ method: 'GET', path: `${basePath}/stream`, handler: h });",
  };
  const NEIGHBOURING = {
    'plural /streams': 'path: `${basePath}/streams`,',
    '/sse': 'path: `${basePath}/sse`,',
    '/websocket': 'path: `${basePath}/websocket`,',
    "single-quoted '/ws'": "app.get('/ws', handler);",
    'the incumbent /realtime, still covered': 'path: `${basePath}/realtime/events`,',
  };
  const MECHANICAL = {
    'SSE content-type write': "res.header('Content-Type', 'text/event-stream');",
    'WS handshake': 'this.realtime.handleUpgrade(req, socket, head);',
    'ws server': 'const wss = new WebSocketServer({ noServer: true });',
    'hono upgradeWebSocket': "app.get('/live', upgradeWebSocket(() => ({})));",
    'Workers WebSocketPair': 'const pair = new WebSocketPair();',
    'hono streamSSE helper': 'return streamSSE(c, async (stream) => {});',
    'raw handshake header': "res.setHeader('Sec-WebSocket-Accept', accept);",
    'client-side constructor': 'const es = new EventSource(url);',
  };

  it('reads ZERO on the real rest-server.ts today (the pre-wiring baseline)', () => {
    const src = readFileSync(join(REPO_ROOT, REST_SERVER), 'utf8');
    expect(hits(MECHANICS.re, src)).toEqual([]);
    expect(hits(ROUTES.re, src)).toEqual([]);
    // …and the surface walk agrees: no rest-server tripwire key is minted.
    const discovered = [...discoverAnonymousDenySurfaces()].filter((k) =>
      k.startsWith('realtime:rest-server.ts:'),
    );
    expect(discovered).toEqual([]);
  });

  it('CONTROL — that zero is meaningful: every documented transport fires', () => {
    // Without this case the zero above is unfalsifiable. A pattern matching
    // nothing at all would satisfy it just as well.
    for (const [label, line] of Object.entries({ ...DOCUMENTED, ...NEIGHBOURING, ...MECHANICAL })) {
      expect(fires(line), `${label} must mint a tripwire key: ${line}`).toBe(true);
    }
  });

  it('the DEFECT is pinned: the incumbent /realtime-only pattern is blind to both documented transports', () => {
    // This is the card's finding, kept executable. If someone narrows the
    // probes back toward a single path spelling, this case is what says so.
    for (const [label, line] of Object.entries(DOCUMENTED)) {
      expect(hits(INCUMBENT, line), `incumbent was blind to ${label}`).toEqual([]);
      expect(fires(line), `widened probe must catch ${label}`).toBe(true);
    }
    // The only documented path it did match is the debug/event-log endpoint,
    // which carries no subscription fan-out — and that coverage is retained.
    const debugEndpoint = 'path: `${basePath}/realtime/events`,';
    expect(hits(INCUMBENT, debugEndpoint).length).toBe(1);
    expect(fires(debugEndpoint)).toBe(true);
  });

  it('the two arms are COMPLEMENTARY, not alternatives (why both are kept)', () => {
    // Measured, not assumed: on this sample neither arm catches a single
    // spelling the other does. Dropping either one re-opens a blind spot.
    for (const line of Object.values({ ...DOCUMENTED, ...NEIGHBOURING })) {
      expect(hits(ROUTES.re, line).length).toBeGreaterThan(0);
      expect(hits(MECHANICS.re, line)).toEqual([]);
    }
    for (const line of Object.values(MECHANICAL)) {
      expect(hits(MECHANICS.re, line).length).toBeGreaterThan(0);
      expect(hits(ROUTES.re, line)).toEqual([]);
    }
  });

  it('does not fire on the unrelated response-streaming code already in the file', () => {
    // rest-server.ts carries ~31 occurrences of the substring "stream" (xlsx
    // export piping, chunked responses). A tripwire that reddened CI on those
    // would be pressure to weaken it back, so the boundaries are pinned.
    for (const line of [
      "const { PassThrough } = await import('node:stream');",
      "res.header('Content-Type', 'text/csv; charset=utf-8');",
      'new ExcelJS.stream.xlsx.WorkbookWriter({ stream: passthrough });',
      'path: `${basePath}/workspaces`,',
      'path: `${basePath}/streaming-imports`,',
      '// on this route the streaming CHUNK size, not the page number',
      'path: `${basePath}/data/:object`,',
    ]) {
      expect(fires(line), `must not fire on: ${line}`).toBe(false);
    }
  });

  it('a wired transport still lands as an UNCLASSIFIED surface under the #9083 rule', () => {
    // The widening has to reach the OUTCOME, not just mint a string: both new
    // keys must still be refused admission by the composed gate.
    for (const surface of ['realtime:rest-server.ts:transport', 'realtime:rest-server.ts:route']) {
      const wired = tripwireKey(surface);
      const problems = checkAuthzLedger(AUTHZ_CONFORMANCE, {
        proofRoot: HERE,
        highRisk: HIGH_RISK,
        discover: () => new Set([...discoverAnonymousDenySurfaces(), wired]),
        attribution: ATTRIBUTION,
      });
      expect(
        problems.some((p) => p.includes('UNCLASSIFIED surface') && p.includes(wired)),
        problems.join('\n'),
      ).toBe(true);
    }
  });
});

// ── #7976 — the row ↔ proof ATTRIBUTION bites ─────────────────────────────
// Existence was the whole `proof` contract before this: a row could cite a file
// that exercises a neighbouring primitive and stay green forever. These cases
// drive `checkLedger` with controlled inputs (deep-cloned matrix) so they are
// deterministic and need no source edits — the same shape as the #2567 block
// above. If they ever pass vacuously, the attribution gate is asleep and the
// ledger is back to vouching for citations nobody checked.
describe('#7976 — row ↔ proof attribution is mutual', () => {
  const clone = (): AuthzPrimitive[] => JSON.parse(JSON.stringify(AUTHZ_CONFORMANCE));
  const opts = () => ({ proofRoot: HERE, highRisk: HIGH_RISK, attribution: ATTRIBUTION });

  it('every row that cites a proof is CLAIMED by it (baseline lock)', () => {
    // Baseline sanity: the walk has real work to do — this must never become a
    // vacuous pass because the rows stopped carrying proofs.
    const cited = AUTHZ_CONFORMANCE.filter((r) => r.proof);
    expect(cited.length, 'the matrix must still cite proofs').toBeGreaterThanOrEqual(20);
    expect(checkAuthzLedger(AUTHZ_CONFORMANCE, opts())).toEqual([]);
  });

  it('a row re-pointed at a proof that does NOT claim it fails, NAMING the row', () => {
    // The exact defect #7976 filed: `flow-runas.dogfood.test.ts` exists, so the
    // pre-#7976 existence check was perfectly happy with this citation.
    const m = clone();
    m.find((r) => r.id === 'rls-read')!.proof = 'flow-runas.dogfood.test.ts';
    const problems = checkAuthzLedger(m, opts());
    expect(problems.some((p) => p.startsWith('rls-read:') && /does not claim this row/.test(p))).toBe(true);
  });

  it('a shared proof file must claim BOTH rows — dropping one is not covered by the other', () => {
    // `rls-fixture.dogfood.test.ts` proves `rls-read` AND `rls-by-id-write`
    // (PR #7975). Borrowing the sibling's credibility is the thing that must fail.
    const m = clone();
    m.find((r) => r.id === 'rls-by-id-write')!.proof = 'controlled-by-parent.dogfood.test.ts';
    const problems = checkAuthzLedger(m, opts());
    expect(problems.some((p) => p.startsWith('rls-by-id-write:') && /does not claim this row/.test(p))).toBe(true);
  });

  it('a claim naming a row the ledger does not have is an ORPHAN', () => {
    const m = clone().filter((r) => r.id !== 'flow-run-as');
    const problems = checkAuthzLedger(m, opts());
    expect(
      problems.some((p) => p.includes('flow-runas.dogfood.test.ts') && /orphaned claim/.test(p)),
    ).toBe(true);
  });

  it('a claim the row does not reciprocate fails (attribution is not one-way)', () => {
    // The row still exists and its proof still exists — only the pairing broke.
    const m = clone();
    m.find((r) => r.id === 'flow-run-as')!.proof = undefined;
    const problems = checkAuthzLedger(m, opts());
    expect(problems.some((p) => /attribution is not mutual/.test(p) && p.includes('flow-run-as'))).toBe(true);
  });

  it('scanning is what catches a claim no row cites at all', () => {
    // Without `scan`, a file nothing cites is never read — so a renamed row
    // leaves its stale claim behind, silently. With it, the same edit is loud.
    const m = clone();
    m.find((r) => r.id === 'owd-private')!.proof = undefined;
    const unscanned = checkAuthzLedger(m, { proofRoot: HERE, attribution: { marker: ATTRIBUTION_MARKER } });
    expect(unscanned.some((p) => p.includes('showcase-private-owd.dogfood.test.ts'))).toBe(false);
    const scanned = checkAuthzLedger(m, opts());
    expect(
      scanned.some((p) => p.includes('showcase-private-owd.dogfood.test.ts') && /not mutual/.test(p)),
    ).toBe(true);
  });
});
