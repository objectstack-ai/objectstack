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
// ⭐ These kinds are no longer prose. Each `PROBES` entry now DECLARES its
// `kind`, `deriveProbeFileCensus()` reads the declarations back out of the
// companion test's source, and the census test holds the `kinds` recorded
// below equal to them — so the taxonomy is a checked artifact rather than a
// comment two files away from the thing it describes. The declaration also
// earns its keep at runtime: a ROUTE_ENUMERATION or GATE_PIN probe minting
// ZERO keys now fails as a DEAD PROBE, which is the mechanism row 7 below was
// measured losing.
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
// ── THE POPULATION SOURCE: measured, and still an OPEN CONTRACT DECISION ──
//
// The obvious repair is to source this ratchet's route population from the
// route ledgers instead of from a regex table, and that was measured before
// anything was written. The reading, in full, because it is the kind of
// conclusion that gets re-derived from scratch otherwise:
//
// WHAT THE LEDGERS DO COVER — richly, and more than this table ever has.
//   `packages/rest/src/rest-route-ledger.ts`: 94 audited rows over 19 families,
//     every route `@objectstack/rest` mounts, enumerated through
//     `RestServer.getRoutes()` on a booted server and guarded per route by
//     `rest-route-ledger.conformance.test.ts`. It reaches all 17 registrars;
//     this table reaches 1.
//   `packages/runtime/src/route-ledger.ts`: 80 rows over 21 domains. Its
//     machine contract is DOMAIN-level, by live registry introspection
//     (`domainRegistry.list()`), the per-route rows being documentation. It
//     covers all 15 `async handle*(` methods in `http-dispatcher.ts` and all
//     16 `DomainRoute` prefixes declared by the 15 domain files.
//   Nine more ledgers exist repo-wide (290 rows in total).
//
// ⭐ On FILE SELECTION the ledgers are simply the right answer, and that is
// worth stating separately: a domain file that no probe names emits no signal
// at all today — no key, no STALE, no UNCLASSIFIED — so its absence is
// structurally unobservable, and a probe table naming 4 of 17 domain files
// cannot see the other 13. Ledger domains are enumerated from the LIVE
// registry, so a new domain file cannot be silently absent from them.
//
// ⛔ WHAT THEY CANNOT SUPPLY IS THIS RATCHET'S GUARANTEE. Three measured
// blockers, each independently sufficient:
//
//  1. NO NOTION OF "GATED", and this ratchet's promise is about UNGATED
//     routes. Ledger dispositions grade SDK expressibility, not authorization:
//     REST reads `sdk` 84 / `server-only` 7 / `public` 3. Cross-checked
//     directly rather than assumed — of the 8 REST route mounts measured to
//     carry no `enforceAuth`, the ledger grades 3 `server-only`, 3 `public`
//     and 2 `sdk`; and one of those two `sdk` rows is
//     `GET /api/v1/ui/view/:object/:type`, the single route in this whole
//     population ever measured unguarded. Its ledger row is shape-identical to
//     the 83 `sdk` rows that ARE gated. `public` states INTENT for 3
//     browser-facing form routes; it is not a gate measurement and was never
//     built as one.
//
//  2. DERIVING "gated" FROM SOURCE SYNTAX IS UNSAFE — measured, not assumed.
//     Scanning each of the 80 `this.routeManager.register(` call sites in
//     `rest-server.ts` for `enforceAuth` reads 50 gated / 30 ungated, and 22 of
//     those 30 are FALSE, in two structural shapes: `registerMetadataEndpoints`
//     installs a wrapping `guardedRouteManager` so its 19 inner routes are
//     gated with no `enforceAuth` at the call site, and
//     `registerSecurityExplainEndpoints` shares one `handler` const declared
//     outside its 3 `register(` calls. A 73% false-ungated rate, concentrated
//     on the largest registrar, and hand-annotating the exceptions is the same
//     rot this instrument already has.
//
//  3. A LEDGER IS A DERIVED DATA FILE, ONE GUARDED STEP BEHIND THE SOURCE.
//     Adding a route to a registrar in `rest-server.ts` does not touch
//     `rest-route-ledger.ts`, so a ledger-sourced population mints no new key
//     and this ratchet stays GREEN on exactly the mutation it should catch.
//     The red lands in `rest-route-ledger.conformance.test.ts` instead — a
//     different gate, in a different package, promising something else. A
//     COMPOSED guarantee (no route without a ledger row; no ledger row without
//     a classification) is a defensible design, but it is a different promise
//     from the one this matrix header states, and adopting it is a contract
//     decision rather than a repair.
//
// ⇒ ⛔ NOT DECIDED HERE, and deliberately not worked around: widening the
// regex is the rot this instrument already has, and inventing a syntactic
// "gated" reading would convert a visible gap into a written-down false
// assurance — strictly worse than an honest UNCLASSIFIED. What this file does
// instead is close the mechanism that was SILENT (the dead probe), leave the
// population untouched, and hand the decision on with the reading attached.

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
 * The probe count `authz-conformance.matrix.ts`'s header states.
 *
 * ⭐ REPAIRED, and the pin INVERTED with it. This was recorded drift: the
 * header said "15 probes" from 2026-08-16, when it was true, and the table has
 * held 16 since a 16th probe landed on 2026-08-18 without the sentence moving.
 * A measurement pinned the discrepancy deliberately rather than fixing it, so
 * that its own no-repair fence stayed unambiguous; the repair belonged with
 * whoever touched the probe table, and this is that change.
 *
 * ⚠️ The assertion that reads this constant flipped from "these must DIFFER"
 * (drift pinned) to "these must be EQUAL" (drift closed). That inversion is
 * the point: the sentence is now held equal to the table by a test, so the
 * next probe added without moving the prose is RED instead of a fact recorded
 * in a third file. ⛔ Do not re-point this at a hand-written number — it is
 * read out of the matrix header's own text.
 */
export const MATRIX_HEADER_PROBE_CLAIM = 16;

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
    // [#13214] `enforceAuth` 61 -> 64. ⛔ RE-ANCHORED, not relaxed: the control
    // exists to prove this census is still reading the file it thinks it is, and
    // a rising `enforceAuth` is precisely what the 2026-08-30 ruling on #13214
    // was supposed to cause — `registerUiEndpoints` was the ONE route in this
    // file that resolved no identity, and it is now guarded. The move is +3 over
    // the whole file (`occurrences` counts the bare term, comments included):
    // one new call site — `if (this.enforceAuth(req, res, context)) return;`,
    // 52 -> 53 — plus two prose mentions in the new doc-comments. ⛔ Kept as an
    // EXACT count rather than a range or a floor: a range would stop this row
    // noticing the next move, which is the only thing it is for.
    //
    // ⚠️ The three sibling numbers were re-derived and did NOT move, which is
    // what says this is a guard change and not a surface change: `population`
    // 80, `reachable` 19, `private register*Endpoints(` 17 and
    // `this.routeManager.register(` 80 are all unchanged — #13214 added no route
    // and no registrar. `blindSpot` therefore stays 61 as well.
    controls: { 'private register*Endpoints(': 17, 'this.routeManager.register(': 80, enforceAuth: 64 },
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
    // Re-declared from ROUTE_ENUMERATION: the probe's population was deleted
    // and the probe stayed, which is the dead-probe mechanism this census
    // measured. It is re-aimed as an armed tripwire, NOT deleted — deleting it
    // would make the ratchet see less.
    kinds: ['TRIPWIRE'],
    probes: 1,
    keys: 0,
    population: 6,
    reachable: 0,
    blindSpot: 6,
    populationRule: '`rawApp.<verb>(` mount sites',
    controls: { rawApp: 11, 'rawApp.get(': 3, serveStatic: 3 },
    note:
      'WAS a dead probe, dated; now a declared TRIPWIRE. Its comment claimed live discovery ("ANY new ' +
      'rawApp.<verb>(`${prefix}/data...`) mints a new key"), but that spelling occurs ZERO times in this ' +
      'file: commit e5a4d26901 (2026-07-31) deleted the plugin CRUD/discovery surface — 3 matching mounts ' +
      'before, 0 after — and the probe stayed. It minted nothing for the whole time since, in silence, ' +
      'because STALE only fires for a key some row COVERS and no row ever covered a data:hono-plugin.ts key. ' +
      'That silence is now closed generically: a non-tripwire probe minting zero keys fails as a DEAD PROBE, ' +
      'so this probe had to be either repaired or honestly re-declared, and re-declaring is what its measured ' +
      'population supports. The spelling it watches is alive one file away, in current-user-endpoints.ts ' +
      '(3 mounts, none of them /data), which the table does not name — naming it is a POPULATION decision, ' +
      'recorded below and not taken here. The 6 mounts counted here are middleware, static-asset and ' +
      'SPA-fallback routes, not data surfaces.',
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
    // The designed-silence decision is the #2992 realtime-transport tripwire record.
    note: 'Tripwire only. Zero keys is the designed reading: no end-user realtime transport is wired.',
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
    // The arming proof is the #9083 measurement, recorded in authz-conformance.test.ts.
    note:
      'Tripwire only, and the one whose arming was PROVEN: a recorded measurement wired ' +
      '`new EventSource(...)` into this file and the ratchet went red as UNCLASSIFIED. Note that the client ' +
      'transport words appear in prose and types here, which is why the probe keys on `new WebSocket` / ' +
      '`new EventSource` construction rather than on the bare word.',
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

/**
 * Re-measure every row above from the same sources the probes read.
 *
 * `kinds` comes back from the companion test's OWN source: each `PROBES` entry
 * declares its instrument kind, and reading the declarations back is what makes
 * the taxonomy recorded above a checked artifact instead of a comment that can
 * quietly stop describing the table.
 */
export function deriveProbeFileCensus(): {
  table: ProbeTableReading;
  files: Map<string, { population: number; reachable: number; controls: Record<string, number> }>;
  kinds: Map<string, ProbeKind[]>;
} {
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

  // Kind ↔ file pairing, read in DOCUMENT ORDER. Every entry spells `kind`
  // immediately before `file`, so walking both tokens in order pairs them
  // without parsing TypeScript. The pairing is self-checking: if the two counts
  // ever disagree, an entry is missing one of them and the census test's
  // `entries` assertion catches it rather than a silently short map.
  const kinds = new Map<string, ProbeKind[]>();
  const tokens = [...block.matchAll(/^\s*(kind|file): '([^']+)'/gm)];
  let pendingKind: ProbeKind | undefined;
  for (const t of tokens) {
    if (t[1] === 'kind') { pendingKind = t[2] as ProbeKind; continue; }
    const file = t[2];
    const list = kinds.get(file) ?? [];
    if (pendingKind && !list.includes(pendingKind)) list.push(pendingKind);
    kinds.set(file, list.sort());
    pendingKind = undefined;
  }
  const matrixSrc = readFileSync(join(HERE, 'authz-conformance.matrix.ts'), 'utf8');
  const coverKeys = [...matrixSrc.matchAll(/covers: \[([^\]]*)\]/g)]
    .flatMap((m) => [...m[1].matchAll(/'([^']+)'/g)].map((k) => k[1]));

  return {
    table: { entries: probeFiles.length, files: new Set(probeFiles).size, keys: new Set(coverKeys).size },
    files,
    kinds,
  };
}
