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
// `discover()` ratchet: this test STATICALLY enumerates the data/meta/graphql
// HTTP entry points from source and asserts each is classified by a matrix row.
// A new ungated `/data` route (or a removed/stale `covers` key) then fails CI as
// UNCLASSIFIED / STALE — the surface can't silently regress.

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
  // Dispatcher meta handler — curated NAME only (NOT handleAI /
  // handleData / handleSecurity, which are separate surfaces/rows).
  {
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
    file: 'packages/runtime/src/domains/actions.ts',
    re: /shouldDenyAnonymous\s*\(/g,
    key: () => 'actions:domains/actions.ts:anonymous-gate',
  },
  {
    file: 'packages/runtime/src/domains/automation.ts',
    re: /shouldDenyAnonymous\s*\(/g,
    key: () => 'automation:domains/automation.ts:anonymous-gate',
  },
  // #7033 / #7023 — the /packages domain gate. Same GATE-pin shape: the key
  // exists only while `handlePackagesRequest` still consults
  // `shouldDenyAnonymous`. Delete the domain floor and the key vanishes → the
  // covering `anonymous-deny-packages` row goes STALE → red CI.
  {
    file: 'packages/runtime/src/domains/packages.ts',
    re: /shouldDenyAnonymous\s*\(/g,
    key: () => 'packages:domains/packages.ts:anonymous-gate',
  },

  // Raw-hono standard /data routes — genuinely pattern-based: ANY new
  // `rawApp.<verb>(`${prefix}/data...`)` → a new key → CI fails until a row covers it.
  {
    file: 'packages/plugins/plugin-hono-server/src/hono-plugin.ts',
    re: /rawApp\.(get|post|put|patch|delete)\(\s*`\$\{prefix\}(\/data[^`]*)`/g,
    key: (m) => `data:hono-plugin.ts:${m[1].toUpperCase()} ${m[2]}`,
  },

  // ── #2992 / ADR-0096 D4 — latent-surface identity pins ─────────────────
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
    file: 'packages/mcp/src/plugin.ts',
    re: /resolveStdioExecutionContext\s*\(/g,
    key: () => 'mcp:plugin.ts:stdio-principal-bound',
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
    const problems = checkLedger(AUTHZ_CONFORMANCE, {
      proofRoot: HERE, // proofs are dogfood test files alongside this one
      highRisk: HIGH_RISK,
      // The ratchet: every discovered data/meta/graphql entry point must be
      // classified by exactly one row's `covers`, and no `covers` key may be
      // stale (no longer in source).
      discover: () => discoverAnonymousDenySurfaces(),
      // #7976 — and the cited proofs must NAME the rows they prove.
      attribution: ATTRIBUTION,
    });
    expect(problems, problems.join('\n')).toEqual([]);
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
    const problems = checkLedger(AUTHZ_CONFORMANCE, opts(() => discoverAnonymousDenySurfaces()));
    expect(problems).toEqual([]);
  });

  it('(a) a row that DROPS its covers → UNCLASSIFIED surface failure', () => {
    // Fixture moved off the raw-hono `/data` row when #4073 deleted that
    // surface. `anonymous-deny-meta` covers a live one, so the ratchet still
    // has a real classification to lose.
    const m = clone();
    const row = m.find((r) => r.id === 'anonymous-deny-meta')!;
    row.covers = [];
    const problems = checkLedger(m, opts(() => discoverAnonymousDenySurfaces()));
    expect(problems.some((p) => /UNCLASSIFIED surface/.test(p) && /meta:/.test(p))).toBe(true);
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
    const row = m.find((r) => r.id === 'anonymous-deny-meta')!;
    row.covers = [...(row.covers ?? []), 'meta:http-dispatcher.ts:handleRemovedThing'];
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

  // ── ADR-0096 / #3167 — the MCP identity pins bite too ──────────────────
  it('(f) dropping the MCP HTTP context-thread → STALE covers failure (#3167)', () => {
    const threaded = 'mcp:domains/mcp.ts:buildMcpBridge(context-threaded)';
    // Baseline sanity: the HTTP `/mcp` handler threads the caller EC today.
    expect(discoverAnonymousDenySurfaces().has(threaded)).toBe(true);
    const problems = checkLedger(
      AUTHZ_CONFORMANCE,
      opts(() => new Set([...discoverAnonymousDenySurfaces()].filter((k) => k !== threaded))),
    );
    expect(problems.some((p) => /STALE covers/.test(p) && p.includes(threaded))).toBe(true);
  });

  it('(g) the stdio principal binding is pinned; dropping it goes STALE (ADR-0101)', () => {
    const stdio = 'mcp:plugin.ts:stdio-principal-bound';
    // Baseline sanity: the stdio path resolves an API-key principal today.
    expect(discoverAnonymousDenySurfaces().has(stdio)).toBe(true);
    const problems = checkLedger(
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
      const problems = checkLedger(
        AUTHZ_CONFORMANCE,
        opts(() => new Set([...discoverAnonymousDenySurfaces()].filter((k) => k !== gate))),
      );
      expect(problems.some((p) => /STALE covers/.test(p) && p.includes(gate))).toBe(true);
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
    expect(checkLedger(AUTHZ_CONFORMANCE, opts())).toEqual([]);
  });

  it('a row re-pointed at a proof that does NOT claim it fails, NAMING the row', () => {
    // The exact defect #7976 filed: `flow-runas.dogfood.test.ts` exists, so the
    // pre-#7976 existence check was perfectly happy with this citation.
    const m = clone();
    m.find((r) => r.id === 'rls-read')!.proof = 'flow-runas.dogfood.test.ts';
    const problems = checkLedger(m, opts());
    expect(problems.some((p) => p.startsWith('rls-read:') && /does not claim this row/.test(p))).toBe(true);
  });

  it('a shared proof file must claim BOTH rows — dropping one is not covered by the other', () => {
    // `rls-fixture.dogfood.test.ts` proves `rls-read` AND `rls-by-id-write`
    // (PR #7975). Borrowing the sibling's credibility is the thing that must fail.
    const m = clone();
    m.find((r) => r.id === 'rls-by-id-write')!.proof = 'controlled-by-parent.dogfood.test.ts';
    const problems = checkLedger(m, opts());
    expect(problems.some((p) => p.startsWith('rls-by-id-write:') && /does not claim this row/.test(p))).toBe(true);
  });

  it('a claim naming a row the ledger does not have is an ORPHAN', () => {
    const m = clone().filter((r) => r.id !== 'flow-run-as');
    const problems = checkLedger(m, opts());
    expect(
      problems.some((p) => p.includes('flow-runas.dogfood.test.ts') && /orphaned claim/.test(p)),
    ).toBe(true);
  });

  it('a claim the row does not reciprocate fails (attribution is not one-way)', () => {
    // The row still exists and its proof still exists — only the pairing broke.
    const m = clone();
    m.find((r) => r.id === 'flow-run-as')!.proof = undefined;
    const problems = checkLedger(m, opts());
    expect(problems.some((p) => /attribution is not mutual/.test(p) && p.includes('flow-run-as'))).toBe(true);
  });

  it('scanning is what catches a claim no row cites at all', () => {
    // Without `scan`, a file nothing cites is never read — so a renamed row
    // leaves its stale claim behind, silently. With it, the same edit is loud.
    const m = clone();
    m.find((r) => r.id === 'owd-private')!.proof = undefined;
    const unscanned = checkLedger(m, { proofRoot: HERE, attribution: { marker: ATTRIBUTION_MARKER } });
    expect(unscanned.some((p) => p.includes('showcase-private-owd.dogfood.test.ts'))).toBe(false);
    const scanned = checkLedger(m, opts());
    expect(
      scanned.some((p) => p.includes('showcase-private-owd.dogfood.test.ts') && /not mutual/.test(p)),
    ).toBe(true);
  });
});
