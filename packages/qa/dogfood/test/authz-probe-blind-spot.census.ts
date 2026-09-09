// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// THE REACH OF `authz-conformance.test.ts`'s `discover()` — a measurement, not
// a repair.
//
// `authz-conformance.matrix.ts`'s header states that the companion test
// "ratchets completeness over a CURATED table of HTTP/transport entry points"
// and that "a new ungated route there is UNCLASSIFIED ... and breaks CI". That
// promise is true only for the entry points a probe can actually mint a key
// for. This module measures, for EVERY one of the 13 files the `PROBES` table
// names, how far that reach extends — and records the result so it cannot rot.
//
// ⭐ Since 2026-08-31 two of those files are the ROUTE LEDGERS, and they are
// the reason the matrix header now claims family/domain completeness rather
// than route completeness. Their rows read `blindSpot: 0` for a reason no
// other row here has — every ledger row is reachable by a mintable key — and
// that must NOT be read as "the route blind spot is closed". It is not:
// `BLIND_SPOT_TOTAL_STATIC` / `_RUNTIME` below are UNCHANGED at 75 / 80.
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
// outside. ⭐ [#15542] Those 80 are counted across TWO spellings since the
// per-item family gained a switch-carrying helper — 72 direct
// `this.routeManager.register(` sites plus 8 `registerPerItemRoute(` calls, the
// helper's own forwarding call excluded so it is not counted twice. The total
// did not move; the rule had to learn the second spelling to keep reading it.
// A RUNTIME census — construct `RestServer` against a recording
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
// ── THE POPULATION SOURCE: measured, then DECIDED (2026-08-31) ────────────
//
// The obvious repair is to source this ratchet's route population from the
// route ledgers instead of from a regex table, and that was measured before
// anything was written. The reading, in full, because it is the kind of
// conclusion that gets re-derived from scratch otherwise:
//
// WHAT THE LEDGERS DO COVER — richly, and more than this table ever has.
//   `packages/rest/src/rest-route-ledger.ts`: 91 audited rows over 19 families,
//     every route `@objectstack/rest` mounts, enumerated through
//     `RestServer.getRoutes()` on a booted server and guarded per route by
//     `rest-route-ledger.conformance.test.ts`. It reaches all 17 registrars;
//     this table reaches 1.
//   `packages/runtime/src/route-ledger.ts`: 82 rows over 21 domains. Its
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
//     REST reads `sdk` 81 / `server-only` 7 / `public` 3. Cross-checked
//     directly rather than assumed — of the 7 REST route mounts measured to
//     carry no `enforceAuth`, the ledger grades 3 `server-only`, 3 `public`
//     and 1 `sdk`, and that one row is `GET /api/v1/discovery`.
//
//     ⚠️ RE-MEASURED 2026-09-09 against `f6b7c53db7`. Both halves of the
//     sentence above moved, FOR TWO UNRELATED REASONS, and separating them is
//     the whole value of re-recording it.
//
//     THE SET LOST A ROW: 8 -> 7, and the row it lost is
//     `GET /api/v1/ui/view/:object/:type`, the single route in this whole
//     population ever measured unguarded. Guarding it at `cc837dbfec` is the
//     same repair that moved 30 ungated to 29 one paragraph below, so it is
//     gated at the call site now and leaves this set, taking the second `sdk`
//     with it: 3 / 3 / 2 became 3 / 3 / 1. ⛔ Its LEDGER row did not move at
//     all — still `sdk`, still shape-identical to every other `sdk` row, the
//     79 that are gated and the 1 that is not. That is this blocker restated
//     by a live example: the grade did not notice the gate arriving, and it
//     would not notice one leaving either.
//
//     THE LEDGER TOTAL MOVED FOR A REASON THAT IS NOT ABOUT GATES AT ALL, and
//     ⛔ must not be read as evidence about them: `sdk` 84 -> 81 when #14503
//     took the three REST package read/delete rows out of the ledger
//     (94 rows -> 91, already recorded on the `rest-route-ledger.ts` probe row
//     in the PROBES table below). It is written down here only because both
//     figures live in one sentence, where a reader has no way to tell which of
//     them moved for which reason — the failure this whole census is named for.
//
//     `public` states INTENT for 3 browser-facing form routes; it is not a
//     gate measurement and was never built as one.
//
//  2. DERIVING "gated" FROM SOURCE SYNTAX IS UNSAFE — measured, not assumed.
//     Scanning each of the 80 registration sites in `rest-server.ts` for
//     `enforceAuth` — the SAME two spellings the `populationRule` below counts,
//     72 direct `this.routeManager.register(` call sites plus 8
//     `registerPerItemRoute(` calls — reads 51 gated / 29 ungated, and 22 of
//     those 29 are FALSE, in two structural shapes: `registerMetadataEndpoints`
//     installs a wrapping `guardedRouteManager` so its 19 inner routes are
//     gated with no `enforceAuth` at the call site, and
//     `registerSecurityExplainEndpoints` shares one `handler` const declared
//     outside its 3 `register(` calls. A 76% false-ungated rate, concentrated
//     on the largest registrar, and hand-annotating the exceptions is the same
//     rot this instrument already has.
//
//     ⚠️ RE-MEASURED 2026-09-08 against `5abca1792e`, because the 19 is a count
//     inside the very registrar the per-item helper re-spelled, and because
//     this paragraph attributed all 80 sites to the direct spelling alone
//     while `:82` above already knew there were two — the authority on this
//     population contradicting itself 57 lines apart.
//
//     WHAT DID NOT MOVE: 22 = 19 + 3. The same 19 routes, 11 still direct and
//     8 now helper-routed, all through the same wrapping; the same 3 sharing
//     one handler const; the population still 80. The re-spelling moved none
//     of the five figures.
//
//     WHAT DID MOVE, and not here: 50 gated / 30 ungated became 51 / 29 when
//     `registerUiEndpoints` — the one route in this file that resolved no
//     identity, the same repair recorded as `enforceAuth` 61 -> 64 on the
//     rest-server.ts row below — was guarded. That landed the day AFTER this
//     paragraph was first written and hours BEFORE it was copied into
//     `rest-route-ledger.ts`, `route-ledger.ts` and `authz-conformance.test.ts`,
//     which is why four sites carried 50/30 in step. ⛔ Written down as a
//     checked figure rather than left as one nobody dared touch: the two read
//     identically on the page, and only this note tells them apart.
//
//     ⛔ The rejection stands whatever the numbers do, and the second spelling
//     strengthens it: a naive scanner now has to know both spellings before it
//     can read the file even this badly.
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
// ⇒ ⭐ DECIDED 2026-08-31, and the three blockers above are why the answer is
// what it is rather than the obvious one. The ledgers now supply the
// POPULATION at FAMILY / DOMAIN granularity — 19 REST families + 21 dispatcher
// domains = 40 keys — and nothing else. They do NOT supply the
// CLASSIFICATION: blocker 1 stands, so "is it gated" remains a reviewed matrix
// row, never a ledger disposition. Blocker 2 stands as the reason no syntactic
// reading was attempted anywhere. Blocker 3 is not fixed and is not hidden: a
// route added inside an existing family mints nothing and this gate stays
// green, which is stated at that exact granularity in the matrix header with
// no caveat attached to a wider claim.
//
// What the change buys is the FILE-SELECTION layer rather than the route
// layer: a family or domain can no longer be silently absent, because both
// ledgers are enumerated from a running server and guarded in both directions.
// 6 of the 40 keys are classified by rows that already pinned the same
// surface; the other 34 are enumerated, dated and pinned shrink-only in
// `authz-ledger-population.baseline.ts`. Before that date those 34 surfaces
// minted no key at all — no UNCLASSIFIED, no STALE, nothing.
//
// The DIRECTION half went to the producer: a ledger row may declare the authz
// posture it has been reviewed to have (`authz:`, phased exactly like
// `responseSchema` — optional, no coverage no fill, never mass-produced), and
// the companion test resolves every declaration against an `enforced` matrix
// row. That is what eventually makes blocker 3 answerable at the ledger review
// point, where a new route is already being read.
//
// ⛔ Two readings stay REJECTED and are recorded here so they are not
// re-proposed: deriving "gated" from source syntax (76% false-ungated), and
// taking a ledger disposition as an authorization fact (blocker 1).

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

export const PROBE_TABLE: ProbeTableReading = { entries: 18, files: 13, keys: 15 };

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
export const MATRIX_HEADER_PROBE_CLAIM = 18;

export const PROBE_FILE_CENSUS: readonly ProbeFileReading[] = [
  // ── the two LEDGER files: the population source since 2026-08-31 ───────
  //
  // ⭐ These two rows read differently from every other row here, and the
  // difference is the point of the change that added them: `blindSpot` is 0
  // NOT because the file mounts nothing (the reading four rows below give) but
  // because EVERY row in the table is reachable by a mintable key. Each ledger
  // row carries a `family` / `domain`, and each distinct value mints a key, so
  // there is no row the ratchet cannot name.
  //
  // ⚠️ `population` here counts LEDGER ROWS, not registrar call sites, and the
  // two are not interchangeable. A `blindSpot` of 0 says every ledger row is
  // covered by some key at FAMILY / DOMAIN granularity; it does NOT say every
  // route mints its own key, and it does not touch the 75/80 route-level blind
  // spot recorded below — that number is unchanged by this change and Leg A of
  // the reverse verification is what proves it unchanged.
  {
    file: 'packages/rest/src/rest-route-ledger.ts',
    kinds: ['ROUTE_ENUMERATION'],
    probes: 1,
    keys: 19,
    population: 91,
    reachable: 91,
    blindSpot: 0,
    populationRule: 'ledger rows inside REST_ROUTE_LEDGER; reachable = rows carrying a `family` (each distinct value mints a key)',
    controls: { "route: '": 91, "family: '": 91, RestRouteLedgerEntry: 2 },
    note:
      'The audited disposition of every route @objectstack/rest mounts, enumerated through ' +
      'RestServer.getRoutes() on a booted server and guarded per route by rest-route-ledger.conformance.test.ts. ' +
      'That guard is why this file can be a population source and a regex table cannot: a mounted route with no ' +
      'row here is already RED in another package, so a new family cannot be silently absent from this file, ' +
      'and therefore cannot be silently absent from the authz ratchet either. 19 families; 1 classified by a ' +
      'matrix row (metadata), 18 enumerated in the shrink-only baseline. Re-measured 94 -> 91 when the ' +
      'three REST package read/delete rows (GET /packages, GET /packages/:id, DELETE /packages/:id) left the ' +
      'ledger with their routes; each carried `family: packages`, so `reachable` moved with ' +
      '`population` (91/91) and the blind spot stays 0 -- the family itself survives on the publish row.',
    // The 94 -> 91 re-measurement above landed with #14503 (the REST registrar
    // keeps only POST /packages/publish; the dispatcher domain is the single
    // implementation of the reads and the delete). The id lives here, not in
    // the string: a runtime string reaches readers who cannot resolve it.
  },
  {
    file: 'packages/runtime/src/route-ledger.ts',
    kinds: ['ROUTE_ENUMERATION'],
    probes: 1,
    keys: 21,
    // [#13953] 80 -> 82: the two operator run-lifecycle rows
    // (`POST /automation/:name/runs/:runId/cancel` and `.../restore-suspension`).
    // Both carry `domain: '/automation'`, an EXISTING key, so `reachable` moves
    // with `population`, `blindSpot` stays 0 and `keys` stays 21 — a population
    // that grows inside an already-classified domain mints nothing new.
    population: 82,
    reachable: 82,
    blindSpot: 0,
    populationRule: 'ledger rows inside ROUTE_LEDGER; reachable = rows carrying a `domain` (each distinct value mints a key)',
    controls: { "route: '": 82, "domain: '": 82, RouteLedgerEntry: 2 },
    note:
      'The dispatcher half. Its machine contract is DOMAIN-level by live registry introspection ' +
      '(domainRegistry.list()), guarded in BOTH directions by route-ledger.conformance.test.ts: every ' +
      'registered domain needs a row, and every ledger domain must be a live prefix or a pinned legacy / ' +
      'non-dispatch branch. That two-way guard is what settles the FILE-SELECTION layer by ' +
      'construction — all 16 DomainRoute prefixes declared across the 15 domain files that declare one are ' +
      'ledger domains today, including the 11 files no probe has ever named. 21 domains; 5 classified ' +
      '(/meta, /actions, /automation, /packages, /mcp), 16 in the shrink-only baseline.',
  },
  {
    file: 'packages/rest/src/rest-server.ts',
    kinds: ['ROUTE_ENUMERATION', 'TRIPWIRE'],
    probes: 3,
    keys: 1,
    population: 80,
    reachable: 19,
    blindSpot: 61,
    populationRule:
      'route registration sites — `this.routeManager.register(` call sites, LESS the one inside ' +
      '`registerPerItemRoute` (the shared forwarder, not a route; its extent is bounded by the declaration\'s own ' +
      'indentation and the subtrahend is pinned at 1 by the `forwarder slice:` control, never inferred from a ' +
      'terminator spelling), PLUS `registerPerItemRoute(` call sites; ' +
      'reachable = those inside registerMetadataEndpoints',
    // [#15542 / #15854] ⭐ THE POPULATION RULE LEARNED A SECOND SPELLING, and
    // the numbers it produces did NOT move: 80 / 19 / 61, exactly as before.
    //
    // WHAT MOVED IN THE SOURCE. The per-item family's later members (`PUT`,
    // `DELETE`, `/history`, `/audit`, `/diff`, `/published`, `/publish`,
    // `/rollback`) stopped being direct `this.routeManager.register(` call
    // sites and became `registerPerItemRoute(` calls — a local helper carrying
    // the `endpoints.item` switch. Net -7 on the old one-spelling reading: 8
    // sites left that spelling and the helper's own forwarding call added 1
    // back. So the old rule read population 73 / reachable 12.
    //
    // ⛔ 73 / 12 WAS NOT RE-RECORDED, and the reason is this file's whole
    // purpose. Those 8 routes are still mounted and still registered exactly
    // where they were; only the spelling of the call changed. Writing 73 down
    // would have ratified a population 7 short of the real one and encoded a
    // 7-route hole in the very blind-spot count this census exists to keep
    // honest — the failure it is named for, committed by its own record.
    //
    // ⚠️ REACHABILITY WAS CHECKED BEFORE THE COUNT WAS WIDENED, because if the
    // helper HID those routes from the probe the repair would belong in
    // `rest-server.ts` and not here. It does not. `registerPerItemRoute` reads
    // `this.routeManager` at CALL time and every one of its 8 call sites is
    // lexically inside `registerMetadataEndpointsInner`, which
    // `registerMetadataEndpoints` runs with `this.routeManager` swapped to the
    // anonymous-deny `guardedRouteManager` and restored in a `finally`. So a
    // helper-routed registration goes through the identical wrapping the 11
    // remaining direct sites in that registrar do, and the umbrella key
    // `meta:rest-server.ts:registerMetadataEndpoints` covers it unchanged.
    // Pinned at runtime rather than argued from source:
    // `packages/rest/src/rest-meta-auth.test.ts` drives an anonymous
    // `GET {meta}/:type/:name/history` — a helper-routed route — to 401.
    //
    // The decomposition, so the two halves stay legible: 72 direct route
    // registrations + 8 helper-routed = 80 population; 11 + 8 = 19 reachable.
    // `this.routeManager.register(` reads 73 because the helper's forwarder is
    // one of them, and it is sliced out before counting.
    //
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
    // ⚠️ That last figure is the reading AS OF #13214 and is left as written:
    // the control is 73 today for the spelling reason recorded above, and the
    // population it feeds is still 80. Do not "correct" the paragraph — it is a
    // dated measurement, not a live claim.
    //
    // [#16306] ⭐ A THIRD CONTROL, AND WHAT THE OTHER TWO CANNOT SEE. The two
    // above were measured insufficient rather than argued insufficient. Respell
    // the helper's terminator `};` as `}` — no semicolon, nothing lints it —
    // and BOTH stay green (the declaration is still present and still matches;
    // only its terminator moved) while the rule's old unanchored
    // `indexOf('\n        };', at)` ran the forwarder slice 5132 → 9004, 3873
    // lines, swallowing 21 registrations: population read 60 and reachable read
    // 20, one measurement LOW and one HIGH, from a single edit. Measured
    // 2026-09-08 against 44c849c7d6, before and after the repair.
    //
    // ⚠️ 60 is what a genuine removal of 20 routes reads too, and NOTHING in
    // this record separated the two. `forwarder slice:
    // this.routeManager.register(` is the reading that does: it is the
    // subtrahend itself, pinned at 1, so a low population with it at 1 is a
    // real drop and a low population with it off 1 is the slice eating too
    // much. It is deliberately the one SLICE-scoped control on this row.
    controls: {
      'private register*Endpoints(': 17,
      'this.routeManager.register(': 73,
      // Both halves of the new rule carry their own control, so neither can go
      // silently to zero: a helper deleted and its routes inlined back would
      // still read population 80, and only these two controls would notice the
      // shape moved and force this provenance to be re-read.
      'registerPerItemRoute(': 8,
      'const registerPerItemRoute =': 1,
      'forwarder slice: this.routeManager.register(': 1,
      enforceAuth: 64,
    },
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
    // ⚠️ `RealtimeService` read 10 until #14646 added a comment to that file
    // recording why its occupant names no discovery channel route. The pattern
    // is a bare `/RealtimeService/g`, so it matches inside `IRealtimeService`
    // and PROSE about the symbol moves the symbol's count exactly as code
    // does — the mirror image of a retirement whose count goes UP because the
    // codebase started documenting an absence. Re-measured here rather than
    // reworded there: this control's job is to prove the file is still present
    // and readable (the non-zero assertion), and shrinking a comment to hold a
    // counter still is how the documentation gets worse to keep a number.
    // Nothing else in the row moves — the file still mounts no HTTP route, so
    // population / reachable / blindSpot / keys stay 0.
    controls: { RealtimeService: 11, 'async init(': 1 },
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

  // ── the two ledger files (the population source) ────────────────────────
  //
  // Scoped to the exported array literal, exactly as the probes are: the
  // patterns are the ledger's own row vocabulary, so a doc-comment or a type
  // declaration spelling the same tokens outside the table would inflate the
  // reading. `controls` here stay WHOLE-FILE counts — they answer "is this
  // still the file I think it is", which is a question about the file and not
  // about the table.
  //
  // ⚠️ [#16306] That is the rule on every row but one. `rest-server.ts` carries
  // a single SLICE-scoped control (`forwarder slice:
  // this.routeManager.register(`) because its population rule SUBTRACTS a
  // slice, and no whole-file count can see that slice grow — the four
  // whole-file controls on that row were measured staying green while the
  // slice ran 3873 lines long. A subtracted slice needs a control on the
  // slice; the exception is exactly that wide and no wider.
  for (const [rel, marker, keyField] of [
    ['packages/rest/src/rest-route-ledger.ts', 'REST_ROUTE_LEDGER', 'family'],
    ['packages/runtime/src/route-ledger.ts', 'ROUTE_LEDGER', 'domain'],
  ] as ReadonlyArray<readonly [string, string, string]>) {
    const src = read(rel);
    const from = src.indexOf(`export const ${marker}`);
    const to = from < 0 ? -1 : src.indexOf('\n];', from);
    // A marker that has moved reads as an EMPTY table, never as the whole file:
    // a silently wider scope would still produce plausible numbers.
    const table = from < 0 || to < 0 ? '' : src.slice(from, to);
    const rowRe = /route: '/g;
    const keyRe = new RegExp(`${keyField}: '`, 'g');
    const entryName = keyField === 'family' ? 'RestRouteLedgerEntry' : 'RouteLedgerEntry';
    files.set(rel, {
      population: occurrences(table, rowRe),
      // Every row carrying the key field is reachable: each distinct value
      // mints a key. A row that ever loses it shows up as a blind spot here.
      reachable: occurrences(table, keyRe),
      controls: {
        "route: '": occurrences(src, /route: '/g),
        [`${keyField}: '`]: occurrences(src, new RegExp(`${keyField}: '`, 'g')),
        [entryName]: occurrences(src, new RegExp(entryName, 'g')),
      },
    });
  }

  // ── rest-server.ts ──────────────────────────────────────────────────────
  //
  // [#15542 / #15854] TWO SPELLINGS, ONE POPULATION. A route registration in
  // this file is EITHER a direct `this.routeManager.register(` call site OR a
  // `registerPerItemRoute(` call — the local helper the per-item family's later
  // members go through, which carries the `endpoints.item` switch and forwards
  // to `this.routeManager.register(entry)`. Both are registrations; counting
  // only the first spelling reads 7 short.
  //
  // ⛔ The helper's OWN forwarding call is NOT a registration site — it is the
  // one shared mechanism 8 sites go through — so its body is sliced out before
  // counting. Counting it would double-count every helper-routed route.
  {
    const src = read('packages/rest/src/rest-server.ts');
    const registrarRe = /^\s*private\s+register[A-Za-z]*Endpoints\s*\(/gm;
    const mountRe = /this\.routeManager\.register\(/g;
    // Matches the CALL sites only. The declaration reads
    // `const registerPerItemRoute = (` and the docblock mentions read
    // `{@link registerPerItemRoute}` — in neither is the name followed by `(`.
    const helperCallRe = /registerPerItemRoute\(/g;
    const helperDeclRe = /const\s+registerPerItemRoute\s*=/;

    /**
     * The helper's OWN extent, bounded by its OWN indentation.
     *
     * ⛔ NEVER a forward search for the terminator's literal text. The rule
     * this replaced ended the slice at `hay.indexOf('\n        };', at)` — an
     * unanchored forward search with no upper bound. Respell that terminator
     * as `}` with no semicolon (the single most ordinary way that line
     * changes, and nothing lints it — there is no ESLint `semi` rule in this
     * repo) and `indexOf` does not fail: it finds the NEXT `\n        };`
     * anywhere later in the file. Measured 2026-09-08 against 44c849c7d6: the
     * slice ran from line 5132 to line 9004 — 3873 lines — and swallowed 21
     * direct `this.routeManager.register(` sites.
     *
     * The extent ends instead at the first non-blank line indented no deeper
     * than the declaration itself, whatever that line is spelled as. That is
     * spelling-independent, so the respelling above moves nothing.
     *
     * ⛔ It is still not TRUSTED — see `sites` below. An indentation scan can
     * land short (a body line dedented to the declaration's own level) or land
     * long (the closing line indented deeper), so the number of forwarding
     * calls it returns is read back as an exact control rather than assumed.
     */
    const forwarderSlice = (hay: string): string => {
      const at = hay.search(helperDeclRe);
      if (at < 0) return '';
      const indent = at - (hay.lastIndexOf('\n', at) + 1);
      let cursor = hay.indexOf('\n', at);
      while (cursor >= 0) {
        const nl = hay.indexOf('\n', cursor + 1);
        const line = hay.slice(cursor + 1, nl < 0 ? hay.length : nl);
        if (line.trim() !== '' && line.length - line.trimStart().length <= indent) {
          return hay.slice(at, cursor + 1 + line.length);
        }
        if (nl < 0) break;
        cursor = nl;
      }
      return '';
    };

    /**
     * Registration sites in one haystack: direct call sites, LESS the helper's
     * own forwarding call, PLUS the helper's call sites.
     *
     * ⭐ THE SUBTRAHEND IS CHECKED, NOT TRUSTED, and that is the repair.
     * `occurrences(forwarderSlice(hay), mountRe)` is recorded as its own exact
     * control, pinned at 1 — the helper forwards exactly once. So:
     *
     *   slice lands SHORT — declaration gone, or the extent scan stops early
     *     ⇒ subtrahend 0, the reading comes out ONE HIGH, and the control
     *       reads 0 against a recorded 1;
     *   slice lands LONG — the extent scan overshoots the helper's own body
     *     ⇒ subtrahend > 1, the reading comes out low, and the control reads
     *       > 1 against a recorded 1.
     *
     * ⛔ It never silently shrinks. Not "it cannot shrink" — it can; the word
     * carrying the weight is SILENTLY. A low reading with the forwarder
     * control at 1 is a real population drop; a low reading with that control
     * off 1 is the slice eating too much. Before this control existed the two
     * were indistinguishable — the day someone genuinely removes 20 routes the
     * census reads 60 either way — and the two exact controls the spelling
     * change added (`registerPerItemRoute(` = 8,
     * `const registerPerItemRoute =` = 1) stay GREEN right through it, because
     * the declaration is still present and still matches; only its terminator
     * moved. Both legs measured, not argued.
     *
     * The control IS the subtrahend, which is what keeps it from being noise:
     * it fires exactly when an overshoot actually distorts the reading, and
     * stays at 1 through an overshoot over text that registers nothing — where
     * there is no distortion to report.
     *
     * ⚠️ The ledger marker slice above is NOT symmetric with this one, which is
     * why borrowing its "fail-loud" reasoning was the mistake. Its `\n];`
     * overshoot can only ADD rows, so it reads HIGH; this slice's overshoot
     * SUBTRACTS registrations, so it reads LOW — and low is the direction that
     * looks like an ordinary answer.
     */
    const sites = (hay: string): number =>
      occurrences(hay, mountRe) -
      occurrences(forwarderSlice(hay), mountRe) +
      occurrences(hay, helperCallRe);

    // Slice the mintable registrar's body: from its declaration to the next one.
    const decls = [...src.matchAll(registrarRe)].map((m) => ({ at: m.index ?? 0, text: m[0] }));
    const metaIdx = decls.findIndex((d) => d.text.includes('registerMetadataEndpoints'));
    const start = decls[metaIdx]?.at ?? 0;
    const end = decls[metaIdx + 1]?.at ?? src.length;
    files.set('packages/rest/src/rest-server.ts', {
      population: sites(src),
      reachable: sites(src.slice(start, end)),
      controls: {
        'private register*Endpoints(': occurrences(src, /private\s+register[A-Za-z]*Endpoints\s*\(/g),
        'this.routeManager.register(': occurrences(src, /this\.routeManager\.register\(/g),
        'registerPerItemRoute(': occurrences(src, /registerPerItemRoute\(/g),
        'const registerPerItemRoute =': occurrences(src, /const\s+registerPerItemRoute\s*=/g),
        // ⭐ The one control here that is NOT a whole-file count, deliberately:
        // it is the SHAPE of the slice the population rule subtracts, and it is
        // the only reading that can tell "the slice ate too much" apart from a
        // real population drop. The four counts around it cannot — all four are
        // green while the slice is running 3873 lines long.
        'forwarder slice: this.routeManager.register(': occurrences(forwarderSlice(src), mountRe),
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
