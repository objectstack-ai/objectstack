// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// THE UNCLASSIFIED BASELINE for the route-ledger population — enumerated,
// dated, shrink-only.
//
// ── WHY IT EXISTS ─────────────────────────────────────────────────────────
//
// `authz-conformance.test.ts` sources its route population from the two route
// ledgers at FAMILY / DOMAIN granularity (2026-08-31). That mints 40 keys
// where the probe table alone minted 9, and 34 of the 40 name a surface no
// authorization row in `authz-conformance.matrix.ts` classifies today.
//
// Those 34 are a REAL, MEASURED gap and they are written down here one by one.
// The alternative shapes were both refused:
//
//   ⛔ CLASSIFYING THEM IN BULK. A `covers` append is a claim that a reviewed
//     enforcement site accounts for the surface. Writing 34 of them in one
//     change would manufacture 34 unreviewed claims — the exact "declared but
//     unverified" surface every ratchet in this repo exists to remove, and the
//     triage that opened this work forbade it explicitly when the number was
//     16.
//   ⛔ SILENCING THEM. A count, a pattern, a prefix skip or a "known gaps"
//     tolerance would make the gate see LESS than it does with the keys
//     enumerated. None of those can tell a NEW unclassified family from an old
//     one, which is the only thing this ratchet is for.
//
// ⭐ WHAT THIS SHAPE BUYS, and why it is not a weakening. Before this file the
// 34 surfaces below were not merely unclassified — they were UNMINTABLE: no
// key, no UNCLASSIFIED, no STALE, nothing to be silent about. Enumerating them
// converts an invisible absence into a written, dated, checked list that can
// only get shorter. A 41st family or domain is not on this list and fails CI
// as UNCLASSIFIED on the day it lands.
//
// ── THE FOUR RULES, ENFORCED BY `authz-conformance.test.ts` ───────────────
//
//  1. GROWTH IS RED. `LEDGER_POPULATION_BASELINE_MAX` pins the length. Adding
//     an entry needs that literal moved, which is a reviewed edit and not a
//     side effect of adding a route.
//  2. A STALE ENTRY IS RED. Every entry must still be a key the ledgers mint
//     today. A family that is renamed or retired takes its entry with it.
//  3. A CLASSIFIED ENTRY IS RED. The moment a matrix row `covers` one of these
//     keys, the entry here is a duplicate and must be deleted in the same
//     change. The list cannot silently outlive the gap it records.
//  4. A DUPLICATE ENTRY IS RED. The count has to mean what it says.
//
// ⛔ NOTHING HERE ASSERTS THAT ANY ROUTE IS UNGUARDED, UNAUTHENTICATED OR
// EXPLOITABLE. Route-level enforcement is mostly in-handler (`enforceAuth` /
// `shouldDenyAnonymous` / per-object permission checks) and is not measured
// here at all. What is recorded is what the RATCHET can SEE. That is a defect
// in a GUARANTEE, not a breach.
//
// ── HOW AN ENTRY LEAVES THIS LIST ─────────────────────────────────────────
//
// Write (or cite) the enforcement site, add a matrix row whose `covers` names
// the key, and delete the line below. Rule 3 makes that deletion mandatory
// rather than optional, so the list burns down instead of accreting.

/**
 * Ledger-sourced population keys with no classifying matrix row.
 *
 * MEASURED 2026-08-31 against `rest-route-ledger.ts` (94 rows / 19 families)
 * and `route-ledger.ts` (80 rows / 21 domains): 40 keys minted, 6 classified
 * by rows that already pin the same surface through the probe table, 34 here.
 *
 * ⛔ SHRINK-ONLY. See rules 1–4 above; the test enforces all four.
 */
export const LEDGER_POPULATION_BASELINE: readonly string[] = [
  // ── REST families (`packages/rest/src/rest-route-ledger.ts`) ────────────
  // `metadata` is absent because it IS classified — `anonymous-deny-meta`
  // covers it through the guarded registrar. The other 18 families are here.
  'rest-family:rest-route-ledger.ts:analytics',
  'rest-family:rest-route-ledger.ts:approvals',
  'rest-family:rest-route-ledger.ts:batch',
  'rest-family:rest-route-ledger.ts:crud',
  'rest-family:rest-route-ledger.ts:data-actions',
  'rest-family:rest-route-ledger.ts:discovery',
  'rest-family:rest-route-ledger.ts:email',
  'rest-family:rest-route-ledger.ts:external-datasource',
  'rest-family:rest-route-ledger.ts:forms',
  'rest-family:rest-route-ledger.ts:openapi',
  // ⚠️ NOT the same surface as `dispatcher-domain:route-ledger.ts:/packages`,
  // which IS classified: that key names the dispatcher domain whose single
  // handler body carries the domain-wide gate. This one names the four routes
  // `@objectstack/rest` mounts itself, through a different registrar.
  'rest-family:rest-route-ledger.ts:packages',
  'rest-family:rest-route-ledger.ts:record-shares',
  'rest-family:rest-route-ledger.ts:reports',
  'rest-family:rest-route-ledger.ts:search',
  'rest-family:rest-route-ledger.ts:security',
  'rest-family:rest-route-ledger.ts:security-explain',
  'rest-family:rest-route-ledger.ts:sharing-rules',
  'rest-family:rest-route-ledger.ts:ui',

  // ── dispatcher domains (`packages/runtime/src/route-ledger.ts`) ─────────
  // Absent because classified: `/meta`, `/actions`, `/automation`,
  // `/packages`, `/mcp`. The other 16 domains are here.
  'dispatcher-domain:route-ledger.ts:/.well-known/objectstack',
  'dispatcher-domain:route-ledger.ts:/ai',
  'dispatcher-domain:route-ledger.ts:/analytics',
  'dispatcher-domain:route-ledger.ts:/apps',
  'dispatcher-domain:route-ledger.ts:/auth',
  'dispatcher-domain:route-ledger.ts:/data',
  'dispatcher-domain:route-ledger.ts:/discovery',
  'dispatcher-domain:route-ledger.ts:/health',
  'dispatcher-domain:route-ledger.ts:/i18n',
  'dispatcher-domain:route-ledger.ts:/keys',
  // ⚠️ Separate from `/mcp`, deliberately. The `/mcp` key is classified by
  // `mcp-http-identity`, whose enforcement site is `handleMcp`; `/mcp/skill`
  // is a different handler body (`handleMcpSkillRequest`) that the probe
  // table was already measured not to reach.
  'dispatcher-domain:route-ledger.ts:/mcp/skill',
  'dispatcher-domain:route-ledger.ts:/notifications',
  'dispatcher-domain:route-ledger.ts:/ready',
  'dispatcher-domain:route-ledger.ts:/security',
  'dispatcher-domain:route-ledger.ts:/share-links',
  'dispatcher-domain:route-ledger.ts:/ui',
];

/**
 * The pinned ceiling. ⛔ SHRINK-ONLY — lower it as entries are classified
 * away; raising it is a reviewed decision, never a side effect of adding a
 * route family.
 *
 * 34 at 2026-08-31, the day the ledger population was adopted.
 */
export const LEDGER_POPULATION_BASELINE_MAX = 34;
