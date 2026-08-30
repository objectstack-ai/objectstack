// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// THE REACH OF `authz-conformance.test.ts`'s `discover()` — a measurement, not
// a repair.
//
// `authz-conformance.matrix.ts`'s header states that the companion test
// "ratchets completeness over a CURATED table of HTTP/transport entry points"
// and that "a new ungated route there is UNCLASSIFIED ... and breaks CI". That
// promise is true only for the entry points a probe can actually mint a key
// for. This module measures, for EVERY one of the 11 files the `PROBES` table
// names, how far that reach extends — and records the result so it cannot rot.
//
// ⛔ WHAT IS **NOT** CLAIMED HERE. Nothing in this file asserts that any route
// is unguarded, unauthenticated or exploitable. Route-level enforcement is
// mostly in-handler (`enforceAuth` / `shouldDenyAnonymous` / per-object
// permission checks) and is not measured here at all. What IS measured is what
// the RATCHET can SEE: an entry point outside every mintable key can gain — or
// lose — a guard without this gate changing colour. That is a defect in a
// GUARANTEE, not a breach. Exactly one route in this population has ever been
// measured unguarded, and that measurement belongs to its own card.
//
// ── THE THREE PROBE KINDS, because one number does not fit them ────────────
//
// Reading every probe as "route discovery" is the mistake this file exists to
// prevent; the table mixes three instruments with three different promises.
//
//   ROUTE_ENUMERATION — the probe is pattern-based over a route/handler
//     population, and its stated promise is auto-discovery: "ANY new route
//     matching this pattern mints a new key". For these, "entry points outside
//     every mintable key" is well defined and IS the blind spot.
//
//   GATE_PIN — the key exists only while a named gate call still exists in the
//     file (`shouldDenyAnonymous(`, `buildMcpBridge(deps, context)`,
//     `resolveStdioExecutionContext(`). Its promise is ANTI-REGRESSION on one
//     named gate, never route completeness. It mints exactly one key by
//     construction, and a blind spot of 0 means "this file funnels through the
//     pinned gate", not "every route here is enumerated".
//
//   TRIPWIRE — deliberately matches nothing today (#2992 realtime transports).
//     Zero keys is the CORRECT reading, not a gap. It is recorded here so that
//     a future reader does not count six armed alarms as six holes.
//
// ── HOW EVERY NUMBER BELOW IS RE-DERIVED ──────────────────────────────────
//
// `deriveProbeFileCensus()` re-measures all of it from the same source files
// the probes read, and `authz-probe-blind-spot.test.ts` asserts the derived
// reading equals the record below. Counting is by OCCURRENCE (regex match
// count), never by matching LINES — the difference is not cosmetic: the
// control set that reverse-checks this census reads 20 / 78 by occurrence and
// 15 / 74 by line, and only the occurrence reading reproduces the original
// measurement.
//
// ⛔ EVERY ZERO CARRIES A POSITIVE CONTROL FROM THE SAME FILE. A zero from a
// file that moved, was renamed, or was emptied is INSTRUMENT FAILURE and reads
// byte-for-byte identical to a real zero. Each row therefore names control
// terms known present IN THAT FILE (never in a different one), the test asserts
// every control is non-zero, and a control that goes to zero fails this census
// rather than quietly re-labelling a broken probe as "nothing found".
//
// ── ONE READING THAT NEEDS A RUNTIME MOUNT, AND IS THEREFORE PROSE ────────
//
// `rest-server.ts` is pinned below at its STATIC reading: 80 `routeManager`
// call sites, 17 registrars, 19 sites inside the one mintable registrar, 61
// outside. A RUNTIME census — construct `RestServer` against a recording
// `RouteManager` and a protocol implementing every optional capability, then
// call each registrar — reads 85 / 17 / 19 / 66 instead. Both are correct and
// the delta is fully explained: `registerApprovalsEndpoints` builds 12 routes
// from 7 call sites through three route factories (`decisionRoute` x3,
// `flowMoveRoute` x2, `threadRoute` x4), and `registerBatchEndpoints` mounts
// all 5 of its routes only when the protocol implements `batchData` /
// `createManyData` / `updateManyData` / `deleteManyData` (1 of 5 against a bare
// protocol). The static reading is the one pinned because it is the one this
// package can re-derive without depending on `@objectstack/rest`.
//
// ── A COMPLETE ROUTE ENUMERATION ALREADY EXISTS ELSEWHERE ─────────────────
//
// Recorded because the repair this census sizes should start from it rather
// than from a wider regex: `packages/rest/src/rest-route-ledger.ts` holds 94
// audited rows over every route `@objectstack/rest` mounts, enumerated through
// `RestServer.getRoutes()` and guarded by `rest-route-ledger.conformance.test.ts`
// (measured green, 7/7, at the time of writing), and
// `packages/runtime/src/route-ledger.ts` does the same for the dispatcher with
// 80 rows. The authz ratchet's route population is a regex table that reaches 1
// of 17 registrars; a complete, runtime-derived, already-guarded enumeration of
// the same surface is sitting one package away. Choosing between them is the
// follow-up card's decision, not this file's.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
// packages/qa/dogfood/test → repo root.
const REPO_ROOT = join(HERE, '../../../..');

const read = (rel: string): string => readFileSync(join(REPO_ROOT, rel), 'utf8');

/** Occurrence count, never a line count. See the header. */
export const occurrences = (src: string, re: RegExp): number => (src.match(re) ?? []).length;

export type ProbeKind = 'ROUTE_ENUMERATION' | 'GATE_PIN' | 'TRIPWIRE';

export interface ProbeFileReading {
  /** Repo-relative path, exactly as the `PROBES` table spells it. */
  file: string;
  /** Which instruments the table points at this file. */
  kinds: ProbeKind[];
  /** `PROBES` entries naming this file. */
  probes: number;
  /** Keys those entries mint against today's source. */
  keys: number;
  /**
   * What the file exposes, under the rule named in `populationRule`. For files
   * that mount no HTTP entry point at all this is 0 — a fact about the file,
   * not a coverage claim.
   */
  population: number;
  /** Entry points some mintable key can name. */
  reachable: number;
  /** `population - reachable`: entry points no key can ever name. */
  blindSpot: number;
  /** How `population` is counted — executed by `deriveProbeFileCensus`. */
  populationRule: string;
  /** In-file terms that must stay non-zero for this row's zeros to be readings. */
  controls: Readonly<Record<string, number>>;
  note: string;
}

/** The `PROBES` table's own shape, re-derived from the companion test's source. */
export interface ProbeTableReading {
  entries: number;
  files: number;
  keys: number;
}

export const PROBE_TABLE: ProbeTableReading = { entries: 16, files: 11, keys: 9 };

/**
 * ⚠️ RECORDED DRIFT, deliberately not repaired here. `authz-conformance.matrix.ts`'s
 * header says "`discover()`: 15 probes over 11 named source files". The table
 * has held 16 entries since a 16th probe landed on 2026-08-18 without the prose
 * moving; the "15" was accurate when written two days earlier. Pinned so the
 * next author meets the discrepancy instead of inheriting it — this card is a
 * measurement, and correcting the sentence belongs to whoever repairs the probe.
 */
export const MATRIX_HEADER_PROBE_CLAIM = 15;

export const PROBE_FILE_CENSUS: readonly ProbeFileReading[] = [
  {
    file: 'packages/rest/src/rest-server.ts',
    kinds: ['ROUTE_ENUMERATION', 'TRIPWIRE'],
    probes: 3,
    keys: 1,
    population: 80,
    reachable: 19,
    blindSpot: 61,
    populationRule: '`this.routeManager.register(` call sites; reachable = those inside registerMetadataEndpoints',
    controls: { 'private register*Endpoints(': 17, 'this.routeManager.register(': 80, enforceAuth: 61 },
    note:
      'The single non-tripwire probe names ONE registrar of 17. The other 16 can never mint a key: ' +
      'registerCrudEndpoints, registerApprovalsEndpoints, registerDataActionEndpoints, registerReportsEndpoints, ' +
      'registerSharingRuleEndpoints, registerUiEndpoints and the rest. A runtime mount census reads 85/19/66. ' +
      'registerUiEndpoints is NOT special — it is simply the registrar a census happened to walk past.',
  },
  {
    file: 'packages/runtime/src/http-dispatcher.ts',
    kinds: ['ROUTE_ENUMERATION', 'TRIPWIRE'],
    probes: 3,
    keys: 2,
    population: 15,
    reachable: 2,
    blindSpot: 13,
    populationRule: '`async handle*(` methods; reachable = handleMetadata + handleMcp, the two named by probes',
    controls: { 'async handleMetadata(': 1, 'async handleMcp(': 1, HttpDispatcherResult: 18 },
    note:
      'The exclusion is ON RECORD in the probe comment ("curated NAME only, NOT handleAI / handleData / ' +
      'handleSecurity, which are separate surfaces/rows") — but "separate rows" is not "separate ratcheted ' +
      'keys": none of the other 13 handlers carries a covers key, so a new ungated sibling beside them mints ' +
      'nothing and breaks nothing.',
  },
  {
    file: 'packages/runtime/src/domains/actions.ts',
    kinds: ['GATE_PIN'],
    probes: 1,
    keys: 1,
    population: 1,
    reachable: 1,
    blindSpot: 0,
    populationRule: '`export async function handle*Request` entry points',
    controls: { 'shouldDenyAnonymous(': 1, handleActionsRequest: 2 },
    note: 'Whole domain funnels through one handler whose FIRST statement is the pinned gate. The pin is complete for this file.',
  },
  {
    file: 'packages/runtime/src/domains/automation.ts',
    kinds: ['GATE_PIN'],
    probes: 1,
    keys: 1,
    population: 1,
    reachable: 1,
    blindSpot: 0,
    populationRule: '`export async function handle*Request` entry points',
    controls: { 'shouldDenyAnonymous(': 1, handleAutomationRequest: 2 },
    note: 'Same shape as domains/actions.ts.',
  },
  {
    file: 'packages/runtime/src/domains/packages.ts',
    kinds: ['GATE_PIN'],
    probes: 1,
    keys: 1,
    population: 1,
    reachable: 1,
    blindSpot: 0,
    populationRule: '`export async function handle*Request` entry points',
    controls: { 'shouldDenyAnonymous(': 1, handlePackagesRequest: 2 },
    note: 'Same shape as domains/actions.ts.',
  },
  {
    file: 'packages/runtime/src/domains/mcp.ts',
    kinds: ['GATE_PIN'],
    probes: 1,
    keys: 1,
    population: 2,
    reachable: 1,
    blindSpot: 1,
    populationRule: '`export async function handle*Request` entry points',
    controls: { 'buildMcpBridge(deps, context)': 1, "prefix: '/": 4 },
    note:
      'Two handlers over four DomainRoute prefixes. The pin sits inside handleMcpRequest; handleMcpSkillRequest ' +
      '(/mcp/skill) mints nothing — the same shape as its dispatcher twin handleMcpSkill.',
  },
  {
    file: 'packages/plugins/plugin-hono-server/src/hono-plugin.ts',
    kinds: ['ROUTE_ENUMERATION'],
    probes: 1,
    keys: 0,
    population: 6,
    reachable: 0,
    blindSpot: 6,
    populationRule: '`rawApp.<verb>(` mount sites',
    controls: { rawApp: 11, 'rawApp.get(': 3, serveStatic: 3 },
    note:
      'A DEAD PROBE, dated. Its comment claims live discovery ("ANY new rawApp.<verb>(`${prefix}/data...`) ' +
      'mints a new key"), but that spelling occurs ZERO times in this file: commit e5a4d26901 (2026-07-31) ' +
      'deleted the plugin CRUD/discovery surface — 3 matching mounts before, 0 after — and the probe stayed. ' +
      'It has minted nothing since, in silence, because STALE only fires for a key some row COVERS and no row ' +
      'ever covered a data:hono-plugin.ts key. The spelling it watches is alive one file away, in ' +
      'current-user-endpoints.ts (3 mounts, none of them /data), which the table does not name. The 6 mounts ' +
      'counted here are middleware, static-asset and SPA-fallback routes, not data surfaces.',
  },
  {
    file: 'packages/services/service-realtime/src/in-memory-realtime-adapter.ts',
    kinds: ['GATE_PIN', 'TRIPWIRE'],
    probes: 2,
    keys: 1,
    population: 0,
    reachable: 0,
    blindSpot: 0,
    populationRule: 'HTTP route mounts in this file',
    controls: { 'async publish(': 1, subscriptions: 12 },
    note: 'Mounts no HTTP route. The pin records the trusted-internal-only posture of the fan-out; the tripwire is correctly silent.',
  },
  {
    file: 'packages/services/service-realtime/src/realtime-service-plugin.ts',
    kinds: ['TRIPWIRE'],
    probes: 1,
    keys: 0,
    population: 0,
    reachable: 0,
    blindSpot: 0,
    populationRule: 'HTTP route mounts in this file',
    controls: { RealtimeService: 10, 'async init(': 1 },
    note: 'Tripwire only. Zero keys is the designed reading (#2992): no end-user realtime transport is wired.',
  },
  {
    file: 'packages/client/src/realtime-api.ts',
    kinds: ['TRIPWIRE'],
    probes: 1,
    keys: 0,
    population: 0,
    reachable: 0,
    blindSpot: 0,
    populationRule: 'HTTP route mounts in this file',
    controls: { subscriptions: 14, WebSocket: 7 },
    note:
      'Tripwire only, and the one whose arming was PROVEN: #9083 measured that adding `new EventSource(...)` here ' +
      'goes red as UNCLASSIFIED. Note the client transport words appear in prose/types here, which is why the ' +
      'probe keys on `new WebSocket` / `new EventSource` construction rather than on the bare word.',
  },
  {
    file: 'packages/mcp/src/plugin.ts',
    kinds: ['GATE_PIN'],
    probes: 1,
    keys: 1,
    population: 0,
    reachable: 0,
    blindSpot: 0,
    populationRule: 'HTTP route mounts in this file',
    controls: { 'resolveStdioExecutionContext(': 3, 'async start(': 1 },
    note: 'Mounts no HTTP route — the stdio transport. Pin holds the ADR-0101 principal binding.',
  },
];

/**
 * Entry points inside the probe table's OWN files that no mintable key can
 * reach, counting only the route/handler surfaces the ratchet's completeness
 * claim is about: rest-server.ts (61 static / 66 runtime), http-dispatcher.ts
 * (13) and domains/mcp.ts (1).
 *
 * hono-plugin.ts's 6 mounts are deliberately EXCLUDED from this total and
 * reported beside it: they are middleware and static-asset routes, and folding
 * them in would overstate the data surface. Its real finding is the dead probe,
 * not the six.
 */
export const BLIND_SPOT_TOTAL_STATIC = 75;
export const BLIND_SPOT_TOTAL_RUNTIME = 80;

/** Re-measure every row above from the same sources the probes read. */
export function deriveProbeFileCensus(): { table: ProbeTableReading; files: Map<string, { population: number; reachable: number; controls: Record<string, number> }> } {
  const files = new Map<string, { population: number; reachable: number; controls: Record<string, number> }>();

  // ── rest-server.ts ──────────────────────────────────────────────────────
  {
    const src = read('packages/rest/src/rest-server.ts');
    const registrarRe = /^\s*private\s+register[A-Za-z]*Endpoints\s*\(/gm;
    const mountRe = /this\.routeManager\.register\(/g;
    // Slice the mintable registrar's body: from its declaration to the next one.
    const decls = [...src.matchAll(registrarRe)].map((m) => ({ at: m.index ?? 0, text: m[0] }));
    const metaIdx = decls.findIndex((d) => d.text.includes('registerMetadataEndpoints'));
    const start = decls[metaIdx]?.at ?? 0;
    const end = decls[metaIdx + 1]?.at ?? src.length;
    files.set('packages/rest/src/rest-server.ts', {
      population: occurrences(src, mountRe),
      reachable: occurrences(src.slice(start, end), /this\.routeManager\.register\(/g),
      controls: {
        'private register*Endpoints(': occurrences(src, /private\s+register[A-Za-z]*Endpoints\s*\(/g),
        'this.routeManager.register(': occurrences(src, /this\.routeManager\.register\(/g),
        enforceAuth: occurrences(src, /enforceAuth/g),
      },
    });
  }

  // ── http-dispatcher.ts ──────────────────────────────────────────────────
  {
    const src = read('packages/runtime/src/http-dispatcher.ts');
    files.set('packages/runtime/src/http-dispatcher.ts', {
      population: occurrences(src, /^\s+async\s+handle[A-Za-z]*\s*\(/gm),
      // handleMetadata + handleMcp, the two the PROBES table names by name.
      reachable:
        occurrences(src, /async\s+handleMetadata\s*\(/g) + occurrences(src, /async\s+handleMcp\s*\(/g),
      controls: {
        'async handleMetadata(': occurrences(src, /async\s+handleMetadata\s*\(/g),
        'async handleMcp(': occurrences(src, /async\s+handleMcp\s*\(/g),
        HttpDispatcherResult: occurrences(src, /HttpDispatcherResult/g),
      },
    });
  }

  // ── the four runtime domain files (GATE_PIN) ────────────────────────────
  const domains: Array<[string, string, string]> = [
    ['packages/runtime/src/domains/actions.ts', 'shouldDenyAnonymous(', 'handleActionsRequest'],
    ['packages/runtime/src/domains/automation.ts', 'shouldDenyAnonymous(', 'handleAutomationRequest'],
    ['packages/runtime/src/domains/packages.ts', 'shouldDenyAnonymous(', 'handlePackagesRequest'],
  ];
  for (const [rel, gate, handler] of domains) {
    const src = read(rel);
    files.set(rel, {
      population: occurrences(src, /^export async function handle[A-Za-z]+Request/gm),
      reachable: 1,
      controls: {
        [gate]: occurrences(src, /shouldDenyAnonymous\s*\(/g),
        [handler]: occurrences(src, new RegExp(handler, 'g')),
      },
    });
  }
  {
    const src = read('packages/runtime/src/domains/mcp.ts');
    files.set('packages/runtime/src/domains/mcp.ts', {
      population: occurrences(src, /^export async function handle[A-Za-z]+Request/gm),
      reachable: 1,
      controls: {
        'buildMcpBridge(deps, context)': occurrences(src, /buildMcpBridge\(deps, context\)/g),
        "prefix: '/": occurrences(src, /prefix: '\//g),
      },
    });
  }

  // ── hono-plugin.ts ──────────────────────────────────────────────────────
  {
    const src = read('packages/plugins/plugin-hono-server/src/hono-plugin.ts');
    files.set('packages/plugins/plugin-hono-server/src/hono-plugin.ts', {
      population: occurrences(src, /rawApp\.(?:get|post|put|patch|delete|all|use|on)\(/g),
      reachable: 0,
      controls: {
        rawApp: occurrences(src, /rawApp/g),
        'rawApp.get(': occurrences(src, /rawApp\.get\(/g),
        serveStatic: occurrences(src, /serveStatic/g),
      },
    });
  }

  // ── the four files that mount no HTTP route ─────────────────────────────
  const noMount: Array<[string, Record<string, RegExp>]> = [
    ['packages/services/service-realtime/src/in-memory-realtime-adapter.ts', { 'async publish(': /async\s+publish\s*\(/g, subscriptions: /subscriptions/g }],
    ['packages/services/service-realtime/src/realtime-service-plugin.ts', { RealtimeService: /RealtimeService/g, 'async init(': /async\s+init\s*\(/g }],
    ['packages/client/src/realtime-api.ts', { subscriptions: /subscriptions/g, WebSocket: /WebSocket/g }],
    ['packages/mcp/src/plugin.ts', { 'resolveStdioExecutionContext(': /resolveStdioExecutionContext\s*\(/g, 'async start(': /async\s+start\s*\(/g }],
  ];
  for (const [rel, controlSpec] of noMount) {
    const src = read(rel);
    const controls: Record<string, number> = {};
    for (const [term, re] of Object.entries(controlSpec)) controls[term] = occurrences(src, re);
    files.set(rel, {
      population:
        occurrences(src, /routeManager\.register\(/g) +
        occurrences(src, /\b(?:app|rawApp)\.(?:get|post|put|patch|delete)\(/g),
      reachable: 0,
      controls,
    });
  }

  // ── the PROBES table's own shape, read from the companion test's source ──
  const testSrc = readFileSync(join(HERE, 'authz-conformance.test.ts'), 'utf8');
  const from = testSrc.indexOf('const PROBES');
  const to = testSrc.indexOf('\n];', from);
  const block = testSrc.slice(from, to);
  const probeFiles = [...block.matchAll(/^\s*file: '([^']+)'/gm)].map((m) => m[1]);
  const matrixSrc = readFileSync(join(HERE, 'authz-conformance.matrix.ts'), 'utf8');
  const coverKeys = [...matrixSrc.matchAll(/covers: \[([^\]]*)\]/g)]
    .flatMap((m) => [...m[1].matchAll(/'([^']+)'/g)].map((k) => k[1]));

  return {
    table: { entries: probeFiles.length, files: new Set(probeFiles).size, keys: new Set(coverKeys).size },
    files,
  };
}
