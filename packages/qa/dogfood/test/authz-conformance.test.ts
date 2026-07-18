// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// ADR-0056 D10 — the authorization conformance matrix is a CHECKED artifact.
// Refactored onto the reusable ADR-0060 `checkLedger` helper: one call asserts
// every shared invariant (valid state, enforced-has-site, experimental/removed-
// has-note, proof-file-exists, high-risk-has-proof). A new fail-open or a deleted
// proof breaks the build.
//
// #2567 Phase 2 — the anonymous-deny SURFACES are additionally pinned by the
// `discover()` ratchet: this test STATICALLY enumerates the data/meta/graphql
// HTTP entry points from source and asserts each is classified by a matrix row.
// A new ungated `/data` route (or a removed/stale `covers` key) then fails CI as
// UNCLASSIFIED / STALE — the surface can't silently regress.

import { describe, expect, it } from 'vitest';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';
import { checkLedger } from '@objectstack/verify';
import { AUTHZ_CONFORMANCE, type AuthzPrimitive } from './authz-conformance.matrix.js';

const HERE = dirname(fileURLToPath(import.meta.url));
// packages/qa/dogfood/test → repo root.
const REPO_ROOT = join(HERE, '../../../..');

// ── #2567 ratchet — static enumeration of anonymous-deny HTTP entry points ──
//
// A CURATED per-file probe table (not a blind repo grep): scoped to the four
// source files and to data/meta/graphql segments only, so control-plane routes
// (/health, /auth, /ready, /discovery) are never enumerated as data surfaces.
// But each probe is pattern-based WITHIN its file, so a genuinely new `/data`
// route (or a new graphql/meta handler) is auto-discovered → new key → a
// missing `covers` fails CI. Keys are derived from source CONTENT (route
// literals / handler names), never line numbers, so they don't churn on edits.
const PROBES: ReadonlyArray<{ file: string; re: RegExp; key: (m: RegExpExecArray) => string }> = [
  // REST /meta umbrella registrar — one guarded registrar covers all ~17 routes.
  {
    file: 'packages/rest/src/rest-server.ts',
    re: /private\s+registerMetadataEndpoints\s*\(/g,
    key: () => 'meta:rest-server.ts:registerMetadataEndpoints',
  },
  // Dispatcher meta + graphql handlers — curated NAMES only (NOT handleAI /
  // handleData / handleSecurity, which are separate surfaces/rows).
  {
    file: 'packages/runtime/src/http-dispatcher.ts',
    re: /async\s+(handleMetadata|handleGraphQL)\s*\(/g,
    key: (m) => `${m[1] === 'handleGraphQL' ? 'graphql' : 'meta'}:http-dispatcher.ts:${m[1]}`,
  },
  // Dispatcher-plugin direct GraphQL route (other server.post routes are
  // control-plane / feature endpoints, deliberately not enumerated here).
  {
    file: 'packages/runtime/src/dispatcher-plugin.ts',
    re: /server\.post\(\s*`\$\{prefix\}\/graphql`/g,
    key: () => 'graphql:dispatcher-plugin.ts:POST /api/v1/graphql',
  },
  // Raw-hono standard /data routes — genuinely pattern-based: ANY new
  // `rawApp.<verb>(`${prefix}/data...`)` → a new key → CI fails until a row covers it.
  {
    file: 'packages/plugins/plugin-hono-server/src/hono-plugin.ts',
    re: /rawApp\.(get|post|put|patch|delete)\(\s*`\$\{prefix\}(\/data[^`]*)`/g,
    key: (m) => `data:hono-plugin.ts:${m[1].toUpperCase()} ${m[2]}`,
  },

  // ── #2992 / ADR-0096 D4 — latent-surface identity pins ─────────────────
  // GraphQL identity threading: the ONLY kernel.graphql(...) call site must
  // carry `context:` in its options. If a refactor drops the threading the key
  // vanishes → the `graphql-identity-thread` row's covers goes STALE → red CI.
  {
    file: 'packages/runtime/src/http-dispatcher.ts',
    re: /kernel\.graphql\([^)]*\bcontext:/g,
    key: () => 'graphql:http-dispatcher.ts:kernel.graphql(context-threaded)',
  },
  // Realtime delivery fan-out: pins the trusted-internal-only posture of the
  // in-memory adapter's publish loop (`realtime-delivery-authz` row).
  {
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
  {
    file: 'packages/services/service-realtime/src/in-memory-realtime-adapter.ts',
    re: /handleUpgrade\s*\(/g,
    key: () => 'realtime:in-memory-realtime-adapter.ts:handleUpgrade(TRANSPORT-WIRED)',
  },
  {
    file: 'packages/services/service-realtime/src/realtime-service-plugin.ts',
    re: /handleUpgrade\s*\(|new\s+WebSocketServer|text\/event-stream/g,
    key: () => 'realtime:realtime-service-plugin.ts:transport(TRANSPORT-WIRED)',
  },
  {
    file: 'packages/runtime/src/http-dispatcher.ts',
    re: /async\s+handle(Realtime|Upgrade|Subscribe)\w*\s*\(/g,
    key: (m) => `realtime:http-dispatcher.ts:handle${m[1]}(TRANSPORT-WIRED)`,
  },
  {
    file: 'packages/client/src/realtime-api.ts',
    re: /new\s+WebSocket\b|new\s+EventSource\b/g,
    key: () => 'realtime:client/realtime-api.ts:transport(TRANSPORT-WIRED)',
  },
  // packages/rest/src has ZERO realtime refs today (#2992) — a `/realtime`
  // route literal appearing there is a subscribe endpoint. Same tripwire.
  {
    file: 'packages/rest/src/rest-server.ts',
    re: /['"`][^'"`]*\/realtime[^'"`]*['"`]/g,
    key: () => 'realtime:rest-server.ts:route(TRANSPORT-WIRED)',
  },

  // ── ADR-0096 / #3167 — MCP execution-surface identity pins ─────────────
  // (1) The HTTP `/mcp` handler must stay classified (a new sibling MCP data
  // handler → UNCLASSIFIED). (2) Its caller-identity threading: handleMcp must
  // build the tool bridge FROM the request context (carrying the caller EC).
  // Drop the threading (or build a system/unscoped bridge for HTTP) → the
  // context-threaded key vanishes → the mcp-http-identity row goes STALE → red CI.
  {
    file: 'packages/runtime/src/http-dispatcher.ts',
    re: /async\s+handleMcp\s*\(/g,
    key: () => 'mcp:http-dispatcher.ts:handleMcp',
  },
  {
    file: 'packages/runtime/src/http-dispatcher.ts',
    re: /this\.buildMcpBridge\(context\)/g,
    key: () => 'mcp:http-dispatcher.ts:buildMcpBridge(context-threaded)',
  },
  // (3) The stdio transport's UNSCOPED data bridge: the long-lived server is fed
  // the raw metadata service + data engine with no principal. Wrapping these in
  // a principal-bound bridge (the admission fix) changes this line → the
  // unscoped-stdio key goes STALE → forces re-classifying mcp-stdio-authority.
  {
    file: 'packages/mcp/src/plugin.ts',
    re: /bridgeResources\(metadataService, dataEngine\)/g,
    key: () => 'mcp:plugin.ts:bridgeResources(unscoped-stdio)',
  },
];

/** Statically enumerate the anonymous-deny HTTP entry points from source. */
function discoverAnonymousDenySurfaces(): Set<string> {
  const found = new Set<string>();
  for (const probe of PROBES) {
    const src = readFileSync(join(REPO_ROOT, probe.file), 'utf8');
    // Fresh lastIndex per file (the RegExp is shared, `g`-flagged).
    probe.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = probe.re.exec(src)) !== null) found.add(probe.key(m));
  }
  return found;
}

const HIGH_RISK = [
  'owd-private', 'owd-public-read', 'controlled-by-parent', 'anonymous-deny', 'default-profile',
  // #2567 — every anonymous-deny HTTP surface is high-risk: it guards the
  // same object data as REST `/data` through a sibling entry point.
  'anonymous-deny-meta', 'anonymous-deny-graphql', 'anonymous-deny-hono-data',
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
    const problems = checkLedger(AUTHZ_CONFORMANCE, {
      proofRoot: HERE, // proofs are dogfood test files alongside this one
      highRisk: HIGH_RISK,
      // The ratchet: every discovered data/meta/graphql entry point must be
      // classified by exactly one row's `covers`, and no `covers` key may be
      // stale (no longer in source).
      discover: () => discoverAnonymousDenySurfaces(),
    });
    expect(problems, problems.join('\n')).toEqual([]);
  });
});

// #2567 — prove the ratchet actually BITES. Drives `checkLedger` with controlled
// inputs (deep-cloned matrix / synthetic discover) so it's deterministic and
// needs no source edits. If these ever pass vacuously, the ratchet is asleep.
describe('#2567 — anonymous-deny surface ratchet bites', () => {
  const clone = (): AuthzPrimitive[] => JSON.parse(JSON.stringify(AUTHZ_CONFORMANCE));
  const opts = (discover: () => Iterable<string>) => ({ proofRoot: HERE, highRisk: HIGH_RISK, discover });

  it('the real matrix + real discover is sound (baseline lock)', () => {
    const problems = checkLedger(AUTHZ_CONFORMANCE, opts(() => discoverAnonymousDenySurfaces()));
    expect(problems).toEqual([]);
  });

  it('(a) a row that DROPS its covers → UNCLASSIFIED surface failure', () => {
    const m = clone();
    const row = m.find((r) => r.id === 'anonymous-deny-hono-data')!;
    row.covers = [];
    const problems = checkLedger(m, opts(() => discoverAnonymousDenySurfaces()));
    expect(problems.some((p) => /UNCLASSIFIED surface/.test(p) && /data:hono-plugin\.ts/.test(p))).toBe(true);
  });

  it('(b) a NEW ungated route appearing in source → UNCLASSIFIED surface failure', () => {
    const fake = 'data:hono-plugin.ts:DELETE /data/fake';
    const problems = checkLedger(
      AUTHZ_CONFORMANCE,
      opts(() => new Set([...discoverAnonymousDenySurfaces(), fake])),
    );
    expect(problems.some((p) => p.includes('UNCLASSIFIED surface') && p.includes(fake))).toBe(true);
  });

  it('(c) a covers key no longer in source → STALE covers failure', () => {
    const m = clone();
    const row = m.find((r) => r.id === 'anonymous-deny-graphql')!;
    row.covers = [...(row.covers ?? []), 'graphql:http-dispatcher.ts:handleRemovedThing'];
    const problems = checkLedger(m, opts(() => discoverAnonymousDenySurfaces()));
    expect(problems.some((p) => /STALE covers/.test(p) && /handleRemovedThing/.test(p))).toBe(true);
  });

  // ── #2992 — the latent-surface pins bite too ──────────────────────────
  it('(d) wiring a realtime transport (tripwire key appears) → UNCLASSIFIED surface failure (#2992)', () => {
    const fake = 'realtime:in-memory-realtime-adapter.ts:handleUpgrade(TRANSPORT-WIRED)';
    const problems = checkLedger(
      AUTHZ_CONFORMANCE,
      opts(() => new Set([...discoverAnonymousDenySurfaces(), fake])),
    );
    expect(problems.some((p) => p.includes('UNCLASSIFIED surface') && p.includes(fake))).toBe(true);
  });

  it('(e) dropping the GraphQL context-thread → STALE covers failure (#2992)', () => {
    const threaded = 'graphql:http-dispatcher.ts:kernel.graphql(context-threaded)';
    // Baseline sanity: the threading is discovered from source today.
    expect(discoverAnonymousDenySurfaces().has(threaded)).toBe(true);
    const problems = checkLedger(
      AUTHZ_CONFORMANCE,
      opts(() => new Set([...discoverAnonymousDenySurfaces()].filter((k) => k !== threaded))),
    );
    expect(problems.some((p) => /STALE covers/.test(p) && p.includes(threaded))).toBe(true);
  });

  // ── ADR-0096 / #3167 — the MCP identity pins bite too ──────────────────
  it('(f) dropping the MCP HTTP context-thread → STALE covers failure (#3167)', () => {
    const threaded = 'mcp:http-dispatcher.ts:buildMcpBridge(context-threaded)';
    // Baseline sanity: the HTTP `/mcp` handler threads the caller EC today.
    expect(discoverAnonymousDenySurfaces().has(threaded)).toBe(true);
    const problems = checkLedger(
      AUTHZ_CONFORMANCE,
      opts(() => new Set([...discoverAnonymousDenySurfaces()].filter((k) => k !== threaded))),
    );
    expect(problems.some((p) => /STALE covers/.test(p) && p.includes(threaded))).toBe(true);
  });

  it('(g) the stdio unscoped-bridge posture is pinned; changing it goes STALE (#3167)', () => {
    const stdio = 'mcp:plugin.ts:bridgeResources(unscoped-stdio)';
    // Baseline sanity: the long-lived server bridges the raw services today.
    expect(discoverAnonymousDenySurfaces().has(stdio)).toBe(true);
    const problems = checkLedger(
      AUTHZ_CONFORMANCE,
      opts(() => new Set([...discoverAnonymousDenySurfaces()].filter((k) => k !== stdio))),
    );
    expect(problems.some((p) => /STALE covers/.test(p) && p.includes(stdio))).toBe(true);
  });
});
