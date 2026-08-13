#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// check-driver-conformance -- every driver runs every shared conformance
// case-set, or its absence is a recorded, tracked decision (#4363).
//
// `packages/spec/src/data/*-conformance.ts` holds the case-sets that exist so
// the independent driver implementations answer ONE standard rather than each
// having its own idea: filter combinator semantics (#3774), temporal storage
// form (ADR-0053), deterministic paged reads (objectui#3106 / #4363). Each was
// introduced with some version of the claim that a future driver "is held to
// this by a gate rather than by remembering it".
//
// There was no gate. The case-sets are exports sitting in a package; nothing
// obliged a driver to import them, and the coverage matrix had three holes on
// the day this script was written -- one of them in the very case-set whose
// changeset made the claim. That is the declared-not-enforced shape Prime
// Directive #10 is about, so the fix is the gate rather than a correction to
// the sentence.
//
//   node scripts/check-driver-conformance.mjs
//   node scripts/check-driver-conformance.mjs --self-test
//
// ## Scope: the IDataDriver implementers
//
// `packages/drivers/*` -- discovered from disk, never listed here, so a
// new driver package is in scope the moment it exists. Other consumers of the
// same case-sets (`packages/formula`'s `matchesFilter`, service-analytics'
// native-SQL strategy) are DELIBERATELY out of scope: they are not drivers,
// they implement a different subset, and enrolling them means answering "which
// case-sets even apply" per consumer -- a question this gate would have to
// guess at. Their coverage is asserted by their own suites today. If that rots,
// it wants its own gate, not a looser one here.
//
// ## Invariants
//
//   DISCOVERED  at least one driver package was found, AND every entry under
//               DRIVERS_DIR was accounted for. Zero is not an empty matrix, it
//               is a broken run: the other three invariants iterate the
//               discovered set, so they all pass vacuously and this script
//               prints OK while checking nothing. The case-set axis cannot fail
//               this way -- CASE_SETS is a declared expectation, so a vanished
//               `spec/src/data` fails CLASSIFIED's reverse direction -- but the
//               driver axis is disk-discovery with nothing declared to
//               reconcile against, and RECONCILED's reverse direction walks
//               LEDGER, which is empty in the intended steady state.
//
//               The zero floor is only half of that, which is what #4932 adds:
//               it fires when the WHOLE axis evaporates and is silent when ONE
//               row does. Rename `driver-sql/` to `sql/` and the package still
//               builds, still tests, still ships -- only this gate loses it, and
//               loses it as a matrix with one fewer row and a green verdict. So
//               the discovery is TOTAL: every entry under DRIVERS_DIR is either a
//               discovered driver, a non-directory, or a named error
//               (`discoverDrivers` reports `unnamed` / `manifestless`; nothing is
//               filtered away in silence). Note which half of that the ledger
//               covers today and why it cannot be relied on: a vanished driver
//               that HOLDS a ledger entry does fail RECONCILED, but only while
//               the ledger is non-empty -- and an empty ledger is the intended
//               steady state, so that catch is a coincidence of the current
//               FILTER_TEXT rows, not a mechanism.
//   CONSUMED    every (driver x case-set) cell is either covered -- some file
//               under the package's `src/` imports the case-set's marker export
//               from `@objectstack/spec/data` -- or carries a DEBT/EXEMPT entry
//               below. A new driver must arrive covered.
//   CLASSIFIED  every case-set exported by `spec/src/data/*-conformance.ts` is
//               named in CASE_SETS. A new shared fixture nobody classified
//               fails this run rather than silently dropping out of coverage --
//               the #4203 lesson, applied in the direction that actually rots.
//   RECONCILED  in both directions: a DEBT/EXEMPT entry for a cell that is now
//               covered, for a driver that no longer exists, or for a case-set
//               that no longer exists, is an error. A ledger that can only
//               accrete rots into a list nobody trusts.
//
// ## What "covered" means, and what it deliberately does not
//
// This checks that the shared fixture is IMPORTED AND REFERENCED, not that the
// assertions over it are good. A gate cannot judge assertion quality, and one
// that tried would be the kind of verifier that reports success while degrading
// (route-ownership rule 3). What it can do is make the absence loud, which is
// the failure mode that actually happened: three drivers silently not running a
// standard three changesets said they were held to.
//
// ## DEBT is frozen debt, not a permission slip
//
// Every entry was measured against `main`. To clear one: write the suite, then
// delete the entry in the same PR. Deleting without the suite fails CONSUMED;
// keeping the entry alongside the suite fails RECONCILED.
//
// ## Dead scan roots are a hard error (#4930)
//
// Both axes of the matrix are read off disk, from two declared directories:
// DRIVERS_DIR and CASE_SETS_DIR. `listDir` used to be
// `try { return readdirSync(dir); } catch { return []; }`, so a root that was
// renamed, moved or made unreadable simply produced an empty axis. DISCOVERED
// and CLASSIFIED do catch that today — but they catch it as a *consequence*,
// and they name the wrong cause: a renamed `packages/spec/src/data` reports five
// separate "CASE_SETS names X, which <file> no longer exports" errors, which
// reads as five deliberate deletions rather than one directory that moved. The
// author's next action follows the message, so the message has to be the cause.
//
// Both roots are therefore resolved before anything is discovered, and a dead
// one fails BY NAME up front. The `listDir` swallow is gone with them: an error
// during a walk means the corpus was only partly read, and partial evidence of
// coverage is exactly the wrong thing to resolve in coverage's favour.
// Deliberately no whitelist and no optional-root flag — see `assertRootsResolvable`.
//
// One swallow outlived that pass: `discoverDrivers`'s manifest probe was
// `try { ... } catch { return false; }`, so ANY error reading a candidate's
// package.json — not merely its absence — answered "then it is not a driver" and
// removed the row. #4932 narrowed it to ENOENT, which is the only errno that
// actually answers the question the filter asks.

import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DRIVERS_DIR = join(ROOT, 'packages', 'drivers');
const CASE_SETS_DIR = join(ROOT, 'packages', 'spec', 'src', 'data');

// ── The case-sets ───────────────────────────────────────────────────────────
//
// `marker` is the export a suite cannot run the case-set without naming, so its
// presence is evidence the fixture is actually driven rather than re-declared
// locally. Reconciled against the files on disk by CLASSIFIED below.

const CASE_SETS = [
  {
    file: 'filter-logic-conformance.ts',
    marker: 'FILTER_LOGIC_CASES',
    what: 'filter combinator semantics ($and/$or/$not nesting) — #3774',
  },
  {
    file: 'temporal-conformance.ts',
    marker: 'TEMPORAL_CASES',
    what: 'temporal storage form and comparand coercion — ADR-0053',
  },
  {
    file: 'temporal-conformance.ts',
    marker: 'TEMPORAL_TIME_CASES',
    what: 'canonical `Field.time` storage and comparison — #3994',
  },
  {
    file: 'pagination-conformance.ts',
    marker: 'PAGINATION_CASES',
    what: 'a sorted paged read is a partition — objectui#3106',
  },
  {
    file: 'pagination-conformance.ts',
    marker: 'PAGINATION_UNORDERED_CASES',
    what: 'an UNSORTED paged read is a partition too — #4363',
  },
  {
    file: 'pagination-conformance.ts',
    marker: 'PAGINATION_ZERO_LIMIT_CASES',
    what: '`limit: 0` returns no records, on presence not truthiness — #6485/#6577',
  },
  {
    file: 'filter-text-conformance.ts',
    marker: 'FILTER_TEXT_CASES',
    what: 'text operators: ASCII-only case folding, literal comparands, `$regex` refused — #4706/#5701',
  },
  {
    file: 'aggregation-conformance.ts',
    marker: 'AGGREGATION_CASES',
    what: 'the value each declared AggregationFunction produces, dedup and NULLs included — #6409',
  },
  {
    file: 'filter-comparand-type-conformance.ts',
    marker: 'FILTER_COMPARAND_TYPE_CASES',
    what: 'the comparand-type door: the six accepted types compile everywhere, everything else is refused loudly — #7872',
  },
];

// ── The ledger ──────────────────────────────────────────────────────────────
//
// One entry per uncovered (driver x case-set) cell. `kind` is DEBT (should be
// covered, is not yet) or EXEMPT (cannot meaningfully apply). Both are measured
// claims; neither is a default.
//
// It was EMPTY between #5590 and #5701. It is not any more: #5701 added the
// FILTER_TEXT_CASES column ahead of its implementations, on purpose, and its
// five rows are documented under the historical notes below — read those first,
// they are the current live entries. The paragraph that follows is the record of
// how the ledger reached empty, kept because every clearing it describes was
// done the same way the five new rows must be.
//
// EMPTY, as of #5590 — every cell of the matrix was covered by a suite. Five
// entries have passed through here across two generations, and every one of
// them was cleared the same way: by writing the suite, never by the argument
// that predicted the suite was unnecessary.
//
// The two FILTER_LOGIC_CASES rows this ledger opened with (#4405):
//
//   driver-mongodb      `translateFilter` was the independent fifth backend
//                       #3774 never enrolled when it named "the four". It now
//                       drives the shared cases twice: server-free over the
//                       MongoDB documents it emits (the half that always runs,
//                       because the mongod binary is not always fetchable), and
//                       against a real mongod.
//   driver-sqlite-wasm  Inherits SqlDriver's filter compiler, so what its suite
//                       pins is the sql.js dialect executing the compiled
//                       predicate — the same seam its temporal and pagination
//                       suites cover for their clauses. It was tracked as DEBT
//                       rather than EXEMPT because "inherits, therefore fine" is
//                       the assumption those suites exist to disprove; the suite
//                       is what disproves it, not the entry.
//
// The three driver-turso rows Phase A of #4645 measured on arrival, cleared by
// #5590. All three were DEBT for one reason — the driver is DUAL-TRANSPORT.
// Local/replica inherits SqlDriver's filter compiler and its paging; remote
// does not go through knex at all, and `src/remote-transport.ts` carries its
// own `buildWhereSQL` (combinator nesting, operator vocabulary, comparand
// refusal) and its own ORDER BY / LIMIT / OFFSET assembly. That is an
// independent Nth backend, which is what #3774 and #4363 wrote the case-sets
// for. So each cell took TWO suites, one per transport, in the shape the
// temporal cells already had:
//
//   FILTER_LOGIC_CASES         driven by `turso-filter-logic-conformance` for
//                              the local transport and by `turso-remote-filter-
//                              logic-conformance` for the remote one. Both green
//                              on arrival.
//   PAGINATION_CASES,          driven by `turso-pagination-conformance` and
//   PAGINATION_UNORDERED_CASES `turso-remote-pagination-conformance`, same two
//                              transports. Also green — but read the note below
//                              before trusting the remote half of these two the
//                              way you can trust the local half.
//
// Both remote suites run over the `libsql-sqlite-stub.testkit` SQLite stub, so
// the whole set is hermetic: no network, no credentials, on by default in CI —
// which is what the temporal pair next door already established for this
// package.
//
// ## What driver-turso's PAGINATION cells mean — read this before trusting them
//
// The local suite passes because `SqlDriver.orderKeysFor()` appends the `id`
// tie-breaker the contract asks for. The remote suite passes WITHOUT that
// mechanism: `buildSelectSQL` maps the caller's `orderBy` verbatim and appends
// no unique column, so the cases hold on the stub's twelve-row `better-sqlite3`
// table — one plan, one arrangement, every time — rather than by a promise the
// transport makes. On a real endpoint that arrangement is not promised across
// two statements, which is the defect `pagination-conformance.ts` is about.
// Filed as #5653; the remote suite carries two `records the measured mechanism`
// tests that pin the current no-tie-breaker behaviour so it cannot go quiet
// under a green cell. Not a ledger entry, because the cells ARE covered — an
// entry for a covered cell fails RECONCILED, and this is where the fact fits.
//
// An empty ledger is the intended steady state, not a reason to delete the
// mechanism: the next driver that arrives uncovered fails CONSUMED and lands
// its measured entry here. #5701 is the other way that happens — a new
// CASE-SET, rather than a new driver, arriving ahead of the work — and it is
// what the five FILTER_TEXT_CASES rows are.
//
// ## What driver-mongodb's cells mean since #5517 — read this before trusting them
//
// This gate judges coverage by IMPORT: does some file under the package's `src/`
// name the marker export. That is deliberate (see "What 'covered' means"), and it
// is why no entry below changed when #5517 made the mongodb suites that need a
// real mongod OPT-IN (`OS_TEST_MONGODB_MEMORY_SERVER_ENABLED=1`, gate in
// `packages/drivers/driver-mongodb/src/test-mongod.ts`): the files still exist
// and still import the markers, so CONSUMED still passes — honestly, but about
// less than it did. Recorded here rather than as a ledger entry because an entry
// for a covered cell fails RECONCILED; this is the only place the fact fits.
//
// Measured on the day of that change, per marker, for driver-mongodb:
//
//   FILTER_LOGIC_CASES         still runs by default — `mongodb-filter-logic-
//                              translation.test.ts` drives the whole case-set
//                              server-free over the documents `translateFilter`
//                              emits. The real-mongod twin
//                              (`mongodb-filter-logic-conformance.test.ts`) is
//                              opt-in.
//   PAGINATION_CASES,          opt-in only. `mongodb-pagination-conformance.test.ts`
//   PAGINATION_UNORDERED_CASES keeps a server-free half, but it asserts the SORT
//                              SPEC, not the partition property the case-sets
//                              define.
//   TEMPORAL_CASES,            opt-in only — `mongodb-temporal-conformance.test.ts`
//   TEMPORAL_TIME_CASES        has no server-free half.
//
// Two markers joined that column after the day it was measured, and both joined
// it SERVER-FREE, which is the shape this note asks for rather than a way around
// it — the driver's answer to each is a pure translation, so a suite that
// evaluates the emitted document tests the driver and not MongoDB:
//
//   AGGREGATION_CASES          [#6850/#6814] `mongodb-aggregation-translation.
//                              test.ts` runs the case-set by default. The
//                              real-mongod half is absent, recorded on #6814.
//   FILTER_TEXT_CASES          [#6682] `mongodb-filter-text-conformance.test.ts`
//                              runs the case-set by default, rejection rows
//                              included. The real-mongod half is absent,
//                              recorded on #6682.
//
// Why: on a cold binary cache two vitest workers downloaded the same ~123 MB
// archive and the loser's `rename` blew up an all-green run as an unhandled
// rejection, ejecting unrelated PRs from the merge queue. The maintainer retired
// the download rather than fund single-flight/prewarm for a family whose
// investment is frozen (#5499). Un-freezing it is what should re-run these cells
// in CI; until then, this note is the honest state of the mongo column.

// ## FILTER_TEXT_CASES: ONE DEBT row left of the five #5701 opened
//
// The ledger was EMPTY (see the note above) until `FILTER_TEXT_CASES` arrived.
// Those five rows were not a regression in coverage: the case-set is the
// CONTRACT half of the #4706 ruling, landed deliberately ahead of every
// implementation, and one row per driver is what made "ahead of" a counted fact
// instead of an assumption. #5702 cleared two of the three requirements; #6518
// cleared the third on the SQL family and DELETED its three rows.
//
// [#6682] `driver-mongodb`'s row is GONE too — the maintainer unfroze that
// package on 2026-08-11 (#5499), requirement 2 landed there (the hardcoded
// `$options: 'i'` is off all four `$contains`-family arms), and
// `mongodb-filter-text-conformance.test.ts` imports the marker and drives all
// SEVENTEEN cases including every rejection row. Measured rather than argued:
// on `origin/main` @ `744b8f5` that suite failed exactly the five
// case-sensitivity rows and passed the other twelve, so the fix was the whole
// remaining gap and nothing else was quietly widened to reach green. It is the
// SERVER-FREE half #5517 requires — this package's real-mongod suites are
// opt-in, so a suite needing a server would not run in CI — and it evaluates
// the emitted documents rather than pinning their spelling.
//
// What remains is `driver-memory`, still in the #5499 frozen family, where the
// freeze rather than the difficulty is why the cell is open.
//
// What the case-set demands, and where each requirement stands:
//
//   1. `$icontains` — a NEW operator (ASCII-only case fold). **DONE
//      EVERYWHERE** (#5702 + #6518 on the SQL family; #6520 on the rest). #6520
//      lifted the #5499 freeze for this operator as a sanctioned one-off
//      (maintainer ruling, 2026-08-08, semantic parity only) and gave every
//      remaining face an arm in ONE PR with the spec word-list admission —
//      driver-memory's three surfaces, driver-mongodb, objectql's `having`,
//      formula, and service-analytics' three compilers. The ordering was the
//      constraint, not the code: `FILTER_OPERATORS` is what driver-memory's
//      shape gate derives from, so admitting the name a PR earlier would have
//      turned this driver's loud refusal into a silently dropped predicate
//      (#5701 measured it; #3948 is what a dropped predicate is on a read
//      scope). Both rows below therefore keep their DEBT entry for
//      requirement 2 ALONE.
//   2. `$contains` / `$startsWith` / `$endsWith` / `$notContains` must be
//      case-SENSITIVE (#4706 Q2 = A, superseding `filter.zod.ts`'s former
//      "Case sensitivity should be handled at backend level"). **DONE on the SQL
//      family** (#6518): case sensitivity used to be the DIALECT's answer, so
//      `SqlDriver` now picks the construct per dialect — `GLOB` on the SQLite
//      dialects (whose `LIKE` folds ASCII), `LIKE` unchanged on Postgres (whose
//      `LIKE` is already case-exact), and `LIKE` over `CAST(… AS BINARY)` on
//      MySQL (whose answer otherwise follows the column's collation). turso's
//      remote transport carries the twin in `pushLike`, and the two are held to
//      the same rows by `turso-local-remote-text-parity.test.ts`. **DONE on
//      driver-mongodb too** (#6682): `translateFieldOperators` no longer sets
//      `$options: 'i'` on any of the four arms, and because every face of that
//      driver — `find`/`count`/`update`/`delete` and the aggregation `$match`
//      — routes through the one `translateFilter`, there is no second answer to
//      align. **DONE on driver-memory too** (#6682, the last cell): the `i`
//      flag came off all NINE sites — the AST spelling's four arms
//      (`convertConditionToMongo`), the `$`-spelling's four
//      (`normalizeFieldOperators`) and `filterSubstringPattern`, the #5374
//      shared rule the ANALYTICS face borrows rather than re-derives, so that
//      face moved with the query path in the direction #5374 was built for. The
//      reference matcher (`String.prototype.includes`) was case-exact all along
//      and is untouched — it was the face that had been RIGHT, which is why the
//      package disagreed with itself until this landed. Requirement 2 is now
//      answered on all five drivers.
//
//      Two faces #6518 measured and did NOT have to change, recorded because
//      "not mentioned" reads as "not checked": `formula`'s `matchesFilter` and
//      objectql's `having` were already case-exact (`String.prototype.includes`
//      and friends), and `service-analytics`'s two SQL compilers emit
//      Postgres-shaped statements, where `LIKE` is case-exact by definition.
//      That last one is the reason a driver-only change did NOT compile one
//      permission rule into two row sets (#3948): the RLS lowering and the
//      driver meet only on Postgres, where neither moved.
//   3. `$regex` / `$options` must be REFUSED, naming `$icontains`. **DONE on all
//      five** (#5702), which was blocked until #5710 flipped the last live
//      producer (`plugin-auth`'s ObjectQL adapter, on the AUTHENTICATION path).
//      Each site now prints `RETIRED_FILTER_OPERATORS[op].why` verbatim, so the
//      five refusals say one thing; driver-mongodb's `default:` arm was
//      additionally routed through its own `INVALID_FILTER` helper, which is the
//      `code` half the case-set requires and the last bare `new Error` in the
//      DRIVER family (this gate's own scope, `packages/drivers/*`). The sixth
//      refusal face — objectql's `having` (`having-filter.ts`) — was outside
//      that scope and kept its bare `new Error` until #7047.
//
// ## AGGREGATION_CASES: two DEBT rows on arrival, and they were the same pair
//
// The column arrived with #6409, which lowered `count_distinct` to
// `COUNT(DISTINCT x)` on the SQL family — the ENFORCE leg of #6188's split
// ruling. Three of the five cells were covered by that PR: `driver-sql` and
// `driver-turso` (its REMOTE transport, an independent compiler, which is what
// the case-set exists to hold against the local one) plus `driver-sqlite-wasm`,
// whose suite pins the inherited statement surviving a different ENGINE, the
// same judgement #4405 recorded for its filter-logic cell.
//
// The two open cells were `driver-memory` and `driver-mongodb` — the #5499
// frozen family, and open by that decision rather than by difficulty. #6409's
// ruling put both explicitly out of scope and left their partial
// implementations untouched, so the rows recorded what each ANSWERS, read from
// the source. Neither was a prediction, and neither was a permission slip: the
// cell clears when a suite runs the case-set, not when someone argues the
// driver would pass it.
//
// [#6850/#6814] `driver-mongodb`'s cell is now CLEARED, and its row is gone
// with the suite that replaced it (`mongodb-aggregation-translation.test.ts`)
// — the maintainer unfroze this package on 2026-08-11 (#5499). What the row
// predicted held, and it under-counted: on top of the `count_distinct` null
// (3 where the standard says 2) and the `"[object Object]"` `$group._id`, the
// suite measured a THIRD divergence neither card named — `count(col)` ignored
// `field` and answered the ROW count, so `count(stage)` came back 6 where the
// case-set says 4. That is what a cell clears against: an executed case-set,
// not a re-reading. The suite is the SERVER-FREE half #5517 requires, driving
// the emitted pipeline through an in-process evaluator; the real-mongod half
// is still absent and is recorded as such on #6814 rather than implied here.
//
// [#6814] `driver-memory`'s cell is now cleared too — the maintainer lifted the
// rest of the #5499 freeze later the same day, and
// `memory-aggregation-conformance.test.ts` replaced the row. This driver runs
// in process, so that suite is a REAL execution of the case-set through BOTH
// doors of the data face (`find()` and `aggregate(AST)`, the one objectql's
// engine uses) — no server-free half to model.
//
// What the row predicted held, and it under-read the ANALYTICS face. The row
// said that face "DOES implement `count_distinct`"; executing it showed the
// implementation stopped half way. `buildAggregator` emitted `{ $addToSet }`
// with the comment "Will need post-processing for count" and no post-processing
// existed, so the measure answered the raw ARRAY of values — `['won','lost',
// null]` — under a field `measureTypeToFieldType` describes as `number`. So the
// package answered one declared function THREE ways: `null` on the data face,
// an array on the analytics face, and the standard's number nowhere. Both are
// fixed here; the array is sized excluding null, which is the same
// null-exclusion the driver-mongodb half made on `$addToSet` (#7550).
//
// The ledger is now EMPTY, which is the state its header calls the intended
// steady one. Read the open set from a run, not from this prose.

// The intended steady state, reached on 2026-08-11: every (driver x case-set)
// cell is covered by an imported case-set, and nothing is deferred. Keep it
// that way by writing the suite, not by adding a row — a DEBT entry is a
// MEASURED, tracked exception the maintainer has agreed to, never the cheaper
// half of "enroll the driver".
const LEDGER = [];


// ── The ratchet-remedy authority convention (#8435) ─────────────────────────
//
// The rule above is the authority rule, and until now it was written only here
// — where a maintainer reading the script sees it and the author who trips the
// gate never does. CONSUMED offered "write the suite, or add a ledger entry" as
// two co-equal options, which is precisely the reading the LEDGER comment says
// is wrong. The convention landed for check-engine-double-contract.mjs and
// check-type-check-coverage.mjs; the twin blocks there are the reference.
//
// The words below are lifted from the LEDGER comment on purpose rather than
// invented: one rule stated twice in two voices is two rules by the next
// reading.
//
// ⛔ This STRENGTHENS ledger governance and weakens nothing. No cell's verdict
// moves, no entry is added, and the matrix this gate reports is byte-for-byte
// the one it reported before — only the diagnostic text changes.

/** Kept identical to the other gates' token so the convention is greppable. */
const RATCHET_AUTHORITY_MARKER = '⛔ MAINTAINER-ONLY';

/** The ledger as the message spells it — this script IS the ledger's home. */
const LEDGER_REL = 'scripts/check-driver-conformance.mjs';

/**
 * How this gate OFFERS the privileged path, as a detector rather than a string
 * compare, so the self-test can prove it still reaches its subject: a reworded
 * offer that stopped matching would make the convention check pass vacuously on
 * every message.
 *
 * RECONCILED is deliberately out of its reach — that message tells the author to
 * DELETE an entry, which is the ledger tightening and squarely the author's job.
 */
const RATCHET_EXPANSION_OFFER = new RegExp(
  `add a measured DEBT/EXEMPT entry to the ledger in\\s+${LEDGER_REL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
);

/**
 * The convention: a message that hands the author the ledger-expanding path must
 * say in the same breath that the path is not theirs. A message offering no such
 * path is unaffected — this is an authority label, not a vocabulary ban.
 *
 * @param {string} message
 * @returns {boolean}
 */
function ratchetRemedyCarriesAuthority(message) {
  if (!RATCHET_EXPANSION_OFFER.test(message)) return true;
  return message.includes(RATCHET_AUTHORITY_MARKER);
}

/**
 * CONSUMED's text, named and pure so the self-test can assert on the exact
 * string the author reads. Extracted from `audit()` for that reason — a message
 * built inline is a message no assertion can reach.
 *
 * @param {string} driver
 * @param {{marker: string, what: string}} caseSet
 * @returns {string}
 */
function consumedMessage(driver, caseSet) {
  return (
    `CONSUMED: ${driver} does not run ${caseSet.marker} (${caseSet.what}). Add a suite that `
    + 'drives the shared cases. That is the fix, and the only one of the two you can take on '
    + `your own. ${RATCHET_AUTHORITY_MARKER}, NOT a co-equal option: add a measured DEBT/EXEMPT `
    + `entry to the ledger in ${LEDGER_REL} saying why not. A ledger entry is a MEASURED, `
    + 'tracked exception the maintainer has agreed to, never the cheaper half of "enroll the '
    + 'driver" — do not take this path to get CI green.'
  );
}


// ── Discovery ───────────────────────────────────────────────────────────────

/** A declared scan root that could not be resolved to a directory. Carries the names. */
class DeadRootError extends Error {
  constructor(dead) {
    super(`unresolvable scan root(s): ${dead.map((d) => `${d.root} — ${d.reason}`).join('; ')}`);
    this.name = 'DeadRootError';
    this.dead = dead;
    /** @type {string[]} just the root paths, for callers that only need to point. */
    this.roots = dead.map((d) => d.root);
  }
}

/**
 * Resolve every declared scan root before discovering anything; throw naming the
 * ones that are not directories.
 *
 * Deliberately no whitelist and no `optional: true` marker. `packages/drivers`,
 * `packages/spec/src/data` and every driver's `src/` are git-tracked directories
 * with tracked files in them, so any checkout that can run
 * `pnpm check:driver-conformance` has all of them. An optional marker "just in
 * case" would hand the next author a supported way to silence this failure
 * instead of fixing the rename — the empty `catch { return []; }` again, only
 * spelled politely. If a root ever does become legitimately absent, that is a real
 * decision: record it with its condition and a test, don't relax the check.
 *
 * @throws {DeadRootError}
 */
function assertRootsResolvable(roots) {
  const dead = [];
  for (const root of roots) {
    let st = null;
    try {
      st = statSync(root);
    } catch (err) {
      dead.push({
        root,
        reason: err?.code === 'ENOENT' ? 'does not exist' : `cannot be read (${err?.code ?? err})`,
      });
      continue;
    }
    if (!st.isDirectory()) dead.push({ root, reason: 'exists but is not a directory' });
  }
  if (dead.length) throw new DeadRootError(dead);
}

/**
 * The entries of a directory the caller has already asserted is a scan root.
 *
 * No catch: an unresolvable root fails loudly in `assertRootsResolvable`, and an
 * error here means the axis was only partly read — which must not resolve in
 * coverage's favour (#4930).
 */
const listDir = (dir) => readdirSync(dir);

/**
 * Driver packages, from disk — never a hardcoded list.
 *
 * Reports the two kinds of entry the filters would otherwise drop in SILENCE
 * alongside the drivers, because "not discovered" and "not a driver" are
 * different facts (#4932):
 *
 *   unnamed       a real package (it has a package.json) whose directory does not
 *                 carry the `driver-` prefix. This is the evaporation the zero
 *                 floor cannot see: rename `driver-sql/` to `sql/` and the row
 *                 leaves the matrix while pnpm, turbo and its own suite carry on
 *                 as before, so this gate is the only place it shows up — and it
 *                 showed up as nothing at all.
 *   manifestless  a `driver-`-prefixed directory with no package.json. Either the
 *                 manifest is missing (a broken package, not a covered one) or the
 *                 directory should not wear the prefix. Both are decisions to
 *                 make, not states to skip past.
 *
 * @param {string} [dir] scan root; parameterised so the self-test drives the real
 *   function over a synthetic tree instead of a re-implementation of it.
 */
function discoverDrivers(dir = DRIVERS_DIR) {
  const drivers = [];
  const unnamed = [];
  const manifestless = [];
  for (const name of listDir(dir).sort()) {
    // Not caught: failing to stat an entry `readdirSync` just returned is a read
    // failure, and a read failure must not be answered "then it is not a driver".
    if (!statSync(join(dir, name)).isDirectory()) continue;
    let hasManifest = false;
    try {
      hasManifest = statSync(join(dir, name, 'package.json')).isFile();
    } catch (err) {
      // ENOENT is this filter's question, answered: there is no manifest here.
      // Any other errno means the entry could not be READ, which is the swallow
      // #4930 removed from `listDir` and #4932 removes from here — a measurement
      // failure resolved in coverage's favour.
      if (err?.code !== 'ENOENT') throw err;
    }
    if (name.startsWith('driver-')) (hasManifest ? drivers : manifestless).push(name);
    else if (hasManifest) unnamed.push(name);
  }
  return { drivers, unnamed, manifestless };
}

/**
 * DISCOVERED — the errors for a discovery that found nothing, or that found
 * something it would have dropped without saying so.
 *
 * Split out from `audit()` so the self-test can drive the invariant itself
 * rather than a proxy for it. The previous guard lived only in the self-test
 * and read `drivers.length >= 3 && drivers.includes('driver-sql')` — a
 * hardcoded name and count inside the one script whose stated rule is that
 * drivers come from disk and are never listed. Both would have needed editing
 * the next time a driver is added or the packages move, which is exactly when
 * the guard matters.
 *
 * The zero floor (#4363) is only half of non-vacuity, which is what #4932 is
 * about: it fires when the whole axis evaporates and is silent when ONE row
 * does. A single missing row is caught today only when that driver happens to
 * hold a ledger entry (RECONCILED's reverse direction) — and the ledger is empty
 * in the intended steady state, as it was between #5590 and #5701. So the
 * discovery is TOTAL instead: every entry under DRIVERS_DIR is a discovered
 * driver, a non-directory, or a named error here.
 *
 * @param {{drivers: string[], unnamed?: string[], manifestless?: string[]}} discovery
 */
function discoveredErrors({ drivers, unnamed = [], manifestless = [] }) {
  const errors = [];
  const rel = DRIVERS_DIR.slice(ROOT.length + 1);
  if (!drivers.length) {
    errors.push(
      `DISCOVERED: no driver package found under ${rel}/. `
        + 'Either these packages moved and DRIVERS_DIR is stale, or they are gone. '
        + 'Every other invariant iterates the discovered set, so a zero-driver run '
        + 'reports OK having checked nothing — it fails here instead.',
    );
  }
  for (const name of unnamed) {
    errors.push(
      `DISCOVERED: ${rel}/${name} is a package (it has a package.json) but is not named `
        + '`driver-*`, so discovery drops it and the matrix is one row short without saying so. '
        + 'Name it `driver-<backend>` if it implements IDataDriver, or move it out of this directory '
        + 'if it does not. Nothing else reports this: the driver axis is discovered from disk, and a '
        + 'renamed package keeps building and testing exactly as before (#4932).',
    );
  }
  for (const name of manifestless) {
    errors.push(
      `DISCOVERED: ${rel}/${name} is named like a driver package but has no package.json, so `
        + 'discovery drops it. Either the manifest is missing — a broken package, which is not the '
        + 'same as a covered one — or the directory should not carry the `driver-` prefix. Both are '
        + 'decisions to record rather than states to skip past (#4932).',
    );
  }
  return errors;
}

/** Every `*-conformance.ts` under spec/src/data, and the case-set exports in it. */
function discoverCaseSets() {
  const found = [];
  for (const file of listDir(CASE_SETS_DIR).filter((f) => f.endsWith('-conformance.ts'))) {
    const src = readFileSync(join(CASE_SETS_DIR, file), 'utf8');
    // A case-set is an exported `_CASES` const: the thing a suite iterates.
    // `_ROWS` / `_ALL_IDS` are its fixture data, driven through the cases.
    for (const m of src.matchAll(/^export const ([A-Z0-9_]*_CASES)\b/gm)) {
      found.push({ file, marker: m[1] });
    }
  }
  return found;
}

/**
 * Every `.ts` file under a directory, recursively.
 *
 * A driver's `src/` is a scan root like the other two: "this driver does not run
 * the shared cases" must mean the files were read and the marker was absent, never
 * that the directory could not be opened. So it is asserted, and nothing in the
 * walk is swallowed (#4930).
 */
function walkTs(dir, out = []) {
  assertRootsResolvable([dir]);
  walkTsInto(dir, out);
  return out;
}

function walkTsInto(dir, out) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist') continue;
    const full = join(dir, entry);
    const s = statSync(full);
    if (s.isDirectory()) walkTsInto(full, out);
    else if (entry.endsWith('.ts')) out.push(full);
  }
  return out;
}

/**
 * Does this driver package drive `marker`?
 *
 * Requires BOTH an import naming it from `@objectstack/spec/data` and a
 * reference outside that import — an unused import is not coverage, and it is
 * the shape a half-finished suite leaves behind.
 */
function consumes(driverDir, marker) {
  for (const file of walkTs(join(driverDir, 'src'))) {
    const src = readFileSync(file, 'utf8');
    if (!src.includes(marker)) continue;
    const imported = new RegExp(
      `import[\\s\\S]*?\\b${marker}\\b[\\s\\S]*?from\\s+['"]@objectstack/spec/data['"]`,
    ).test(src);
    if (!imported) continue;
    // Count references outside the import statement(s).
    const withoutImports = src.replace(/import[\s\S]*?from\s+['"][^'"]+['"];?/g, '');
    if (new RegExp(`\\b${marker}\\b`).test(withoutImports)) return file;
  }
  return null;
}

// ── The run ─────────────────────────────────────────────────────────────────

function audit() {
  // Both axes come off disk, so both roots must resolve before a single cell of
  // the matrix is believed. Throws DeadRootError — `report()` turns it into a red
  // that names the directory rather than the five downstream symptoms (#4930).
  assertRootsResolvable([DRIVERS_DIR, CASE_SETS_DIR]);

  const discovery = discoverDrivers();
  const { drivers } = discovery;
  const errors = [];
  const rows = [];

  // DISCOVERED — the precondition the other three iterate over. Zero drivers is a
  // broken run, and so is one driver silently missing from the axis (#4932).
  errors.push(...discoveredErrors(discovery));

  // CLASSIFIED — both directions between CASE_SETS and the files on disk.
  const onDisk = discoverCaseSets();
  const classified = new Set(CASE_SETS.map((c) => c.marker));
  for (const { file, marker } of onDisk) {
    if (!classified.has(marker)) {
      errors.push(
        `CLASSIFIED: ${file} exports ${marker}, which no row of CASE_SETS names. `
          + 'Classify it (and say which drivers must run it) rather than letting a new shared '
          + 'standard start life uncovered.',
      );
    }
  }
  const onDiskMarkers = new Set(onDisk.map((c) => c.marker));
  for (const c of CASE_SETS) {
    if (!onDiskMarkers.has(c.marker)) {
      errors.push(`CLASSIFIED: CASE_SETS names ${c.marker}, which ${c.file} no longer exports.`);
    }
  }

  // CONSUMED + collect the matrix.
  const ledgerHit = new Set();
  for (const driver of drivers) {
    const dir = join(DRIVERS_DIR, driver);
    for (const c of CASE_SETS) {
      const where = consumes(dir, c.marker);
      const entry = LEDGER.find((l) => l.driver === driver && l.marker === c.marker);
      if (entry) ledgerHit.add(`${driver}::${c.marker}`);

      if (where && entry) {
        errors.push(
          `RECONCILED: ${driver} now runs ${c.marker} (${where.slice(ROOT.length + 1)}), `
            + `but the ledger still carries a ${entry.kind} entry for it. Delete the entry.`,
        );
        rows.push({ driver, marker: c.marker, state: 'covered' });
      } else if (where) {
        rows.push({ driver, marker: c.marker, state: 'covered' });
      } else if (entry) {
        rows.push({ driver, marker: c.marker, state: entry.kind.toLowerCase() });
      } else {
        errors.push(consumedMessage(driver, c));
        rows.push({ driver, marker: c.marker, state: 'MISSING' });
      }
    }
  }

  // RECONCILED — ledger rows pointing at things that no longer exist.
  for (const entry of LEDGER) {
    if (!drivers.includes(entry.driver)) {
      errors.push(`RECONCILED: ledger entry for ${entry.driver}, which is not a driver package.`);
    } else if (!classified.has(entry.marker)) {
      errors.push(`RECONCILED: ledger entry names ${entry.marker}, which CASE_SETS does not.`);
    }
  }

  return { drivers, rows, errors };
}

function reportDeadRoots(err) {
  console.error('\n  x check-driver-conformance: declared scan root(s) do not resolve, so the matrix would\n' +
    '    have been built from an axis nothing could read:\n');
  for (const d of err.dead) console.error(`    ${d.root.startsWith(ROOT) ? d.root.slice(ROOT.length + 1) : d.root} — ${d.reason}`);
  console.error(
    '\n  DRIVERS_DIR and CASE_SETS_DIR (scripts/check-driver-conformance.mjs) must both be' +
    '\n  directories in the checkout. If one was renamed or moved, point the constant at it; if it' +
    '\n  was deleted, that is a deliberate decision to record. Do NOT restore a tolerant skip: this' +
    '\n  used to be `catch { return []; }`, and a dead root produced an empty axis whose downstream' +
    '\n  errors named the wrong cause (#4930).\n',
  );
}

function report() {
  let audited;
  try {
    audited = audit();
  } catch (err) {
    if (!(err instanceof DeadRootError)) throw err;
    reportDeadRoots(err);
    process.exit(1);
    return;
  }
  const { drivers, rows, errors } = audited;

  const covered = rows.filter((r) => r.state === 'covered').length;
  const debt = rows.filter((r) => r.state === 'debt').length;
  const exempt = rows.filter((r) => r.state === 'exempt').length;

  const width = Math.max(...drivers.map((d) => d.length), 8);
  console.log(`\ndriver conformance matrix (${drivers.length} drivers x ${CASE_SETS.length} case-sets)\n`);
  console.log(
    '  ' + 'driver'.padEnd(width) + '  ' + CASE_SETS.map((c) => c.marker.replace(/_CASES$/, '')).join('  '),
  );
  for (const driver of drivers) {
    const cells = CASE_SETS.map((c) => {
      const row = rows.find((r) => r.driver === driver && r.marker === c.marker);
      const glyph = { covered: 'ok', debt: 'DEBT', exempt: 'exempt', MISSING: 'MISSING' }[row.state];
      return glyph.padEnd(c.marker.replace(/_CASES$/, '').length);
    });
    console.log('  ' + driver.padEnd(width) + '  ' + cells.join('  '));
  }
  console.log('');

  if (errors.length) {
    for (const e of errors) console.error(`  x ${e}`);
    console.error(`\ncheck-driver-conformance: ${errors.length} problem(s).\n`);
    process.exit(1);
  }

  // Print the ledger's reasons, not only its counts. An entry whose
  // justification is never surfaced is how a ledger decays into a list nobody
  // reads — and these rows are the whole reason this run is green.
  for (const entry of LEDGER) {
    console.log(`  ${entry.kind}  ${entry.driver} × ${entry.marker}`);
    console.log(`        ${entry.why}`);
    if (entry.issue) console.log(`        tracked: ${entry.issue}`);
  }
  if (LEDGER.length) console.log('');

  console.log(
    `check-driver-conformance: OK — ${covered} covered cell(s), ${debt} in the DEBT ledger, `
      + `${exempt} exempt.\n`,
  );
}

// ── Self-test ───────────────────────────────────────────────────────────────
//
// A guard that cannot fail is not a guard. This drives the three invariants
// against synthetic inputs so a refactor that neuters the detection fails here
// rather than silently passing every future PR.

function selfTest() {
  const failures = [];
  const expect = (label, cond) => {
    if (!cond) failures.push(label);
  };

  // CONSUMED: an unused import must not count as coverage.
  const tmp = join(ROOT, 'node_modules', '.check-driver-conformance-selftest');
  try {
    mkdirSync(join(tmp, 'src'), { recursive: true });
    writeFileSync(
      join(tmp, 'src', 'a.test.ts'),
      "import { PAGINATION_CASES } from '@objectstack/spec/data';\n// never referenced again\n",
    );
    expect('unused import must not count as coverage', consumes(tmp, 'PAGINATION_CASES') === null);

    writeFileSync(
      join(tmp, 'src', 'a.test.ts'),
      "import { PAGINATION_CASES } from '@objectstack/spec/data';\nfor (const c of PAGINATION_CASES) {}\n",
    );
    expect('driven import must count as coverage', consumes(tmp, 'PAGINATION_CASES') !== null);

    // A locally re-declared fixture is not the shared standard.
    writeFileSync(
      join(tmp, 'src', 'a.test.ts'),
      'const PAGINATION_CASES = [];\nfor (const c of PAGINATION_CASES) {}\n',
    );
    expect(
      'local re-declaration must not count as coverage',
      consumes(tmp, 'PAGINATION_CASES') === null,
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }

  // CLASSIFIED: discovery must actually find the case-sets on disk, or the
  // reconciliation is vacuous and every future fixture drops out silently.
  const found = discoverCaseSets().map((c) => c.marker);
  expect('discovers FILTER_LOGIC_CASES on disk', found.includes('FILTER_LOGIC_CASES'));
  expect('discovers TEMPORAL_CASES on disk', found.includes('TEMPORAL_CASES'));
  expect('discovers PAGINATION_UNORDERED_CASES on disk', found.includes('PAGINATION_UNORDERED_CASES'));

  // DISCOVERED: the invariant itself, in both directions, then against the
  // real tree. No driver name or count is asserted — the point of the gate is
  // that the set comes from disk.
  expect('a discovery that found nothing is an error', discoveredErrors({ drivers: [] }).length === 1);
  expect('a discovery that found something is not', discoveredErrors({ drivers: ['driver-anything'] }).length === 0);
  expect('discovers driver packages from disk', discoverDrivers().drivers.length > 0);

  // ...and the half the zero floor cannot see (#4932): a row dropped in silence
  // while the axis stays non-empty. Both drop shapes are errors even though a
  // driver WAS found, because "one fewer row, still green" is the failure.
  expect(
    'a package the `driver-` filter would drop is an error, not a smaller matrix',
    discoveredErrors({ drivers: ['driver-a'], unnamed: ['sql'] }).length === 1,
  );
  expect(
    'the error names the dropped package',
    /packages\/drivers\/sql is a package/.test(discoveredErrors({ drivers: ['driver-a'], unnamed: ['sql'] })[0]),
  );
  expect(
    'a driver-named directory with no manifest is an error too',
    discoveredErrors({ drivers: ['driver-a'], manifestless: ['driver-b'] }).length === 1,
  );

  // The classification itself, driven over a synthetic tree by the real function
  // (the alternative — asserting against the live packages/drivers — can only
  // ever observe the clean case, which is the case that never fails).
  const tmpDrivers = join(ROOT, 'node_modules', '.check-driver-conformance-selftest-discovery');
  try {
    mkdirSync(join(tmpDrivers, 'driver-a'), { recursive: true });
    writeFileSync(join(tmpDrivers, 'driver-a', 'package.json'), '{}\n');
    mkdirSync(join(tmpDrivers, 'sql'), { recursive: true });          // a package, misnamed
    writeFileSync(join(tmpDrivers, 'sql', 'package.json'), '{}\n');
    mkdirSync(join(tmpDrivers, 'driver-b'), { recursive: true });     // named, no manifest
    writeFileSync(join(tmpDrivers, 'README.md'), 'not a package\n');  // not a directory
    const found = discoverDrivers(tmpDrivers);
    expect('a manifested driver- package is discovered', found.drivers.join(',') === 'driver-a');
    expect('a manifested package with the wrong name is reported', found.unnamed.join(',') === 'sql');
    expect('a driver- directory without a manifest is reported', found.manifestless.join(',') === 'driver-b');

    // An entry the discovery cannot stat is a read failure, not an answer — the
    // same direction as the walkTs case below, at the axis level.
    symlinkSync(join(tmpDrivers, 'no-such-target'), join(tmpDrivers, 'driver-dangling'));
    let danglingErr = null;
    try { discoverDrivers(tmpDrivers); } catch (err) { danglingErr = err; }
    expect('an entry discovery cannot stat is an error, not a smaller axis', danglingErr?.code === 'ENOENT');
    rmSync(join(tmpDrivers, 'driver-dangling'));

    // ...and removing the break restores the previous verdict, so the red above
    // was caused by the dangling entry and nothing else.
    expect('removing the break restores the discovery', discoverDrivers(tmpDrivers).drivers.join(',') === 'driver-a');
  } finally {
    rmSync(tmpDrivers, { recursive: true, force: true });
  }

  // The real tree is clean on both drop shapes — the assertion is wired in, not
  // merely defined, and today's packages/drivers has nothing being skipped.
  const real = discoverDrivers();
  expect('no live driver package is dropped by the name filter', real.unnamed.length === 0);
  expect('no live driver directory is missing its manifest', real.manifestless.length === 0);
  expect('the live discovery raises no DISCOVERED error', discoveredErrors(real).length === 0);

  // --- Reverse proof for the dead-root hard error (#4930), made permanent. ---
  // Everything above ran over roots that resolve, which proves nothing about a
  // gate whose failure mode is discovering an empty axis. So break a root the way
  // a rename breaks it, require red naming that root and not the survivor, then
  // restore it and require green again. Red-then-green, in the same run, every run.
  const tmpRoots = join(ROOT, 'node_modules', '.check-driver-conformance-selftest-roots');
  try {
    mkdirSync(join(tmpRoots, 'live'), { recursive: true });
    const missing = join(tmpRoots, 'renamed-away');
    let deadErr = null;
    try { assertRootsResolvable([join(tmpRoots, 'live'), missing]); } catch (err) { deadErr = err; }
    expect('a renamed scan root throws instead of yielding an empty axis', deadErr instanceof DeadRootError);
    expect('the failure names the dead root', deadErr?.roots?.join(',') === missing);
    expect('the failure does not blame the surviving root', !/live/.test(deadErr?.message ?? ''));
    expect('the failure says why', deadErr?.dead?.[0]?.reason === 'does not exist');

    // A root that exists but is not a directory is dead in the same way: the old
    // `catch { return []; }` swallowed its ENOTDIR exactly as it swallowed ENOENT.
    const asFile = join(tmpRoots, 'a-file');
    writeFileSync(asFile, 'not a directory');
    let notDirErr = null;
    try { assertRootsResolvable([asFile]); } catch (err) { notDirErr = err; }
    expect('a scan root that is a file is dead too',
      notDirErr?.dead?.[0]?.reason === 'exists but is not a directory');

    // An entry the walk cannot stat inside a driver's src/ is the same defect one
    // level in: `catch { continue; }` used to drop it, and a dropped file that
    // held the marker reads as "this driver does not run the case-set".
    mkdirSync(join(tmpRoots, 'pkg', 'src'), { recursive: true });
    writeFileSync(join(tmpRoots, 'pkg', 'src', 'a.ts'), 'export const a = 1;\n');
    expect('a readable src/ walks clean', walkTs(join(tmpRoots, 'pkg', 'src')).length === 1);
    symlinkSync(join(tmpRoots, 'no-such-target'), join(tmpRoots, 'pkg', 'src', 'dangling'));
    let partialErr = null;
    try { walkTs(join(tmpRoots, 'pkg', 'src')); } catch (err) { partialErr = err; }
    expect('an entry the walk cannot stat is an error, not a smaller corpus', partialErr?.code === 'ENOENT');
    rmSync(join(tmpRoots, 'pkg', 'src', 'dangling'));

    // ...and roots that resolve are green, so the reds above were caused by the
    // broken roots and nothing else.
    let restored = null;
    try { assertRootsResolvable([join(tmpRoots, 'live'), join(tmpRoots, 'pkg', 'src')]); } catch (err) { restored = err; }
    expect('roots that resolve raise nothing', restored === null);
    expect('restoring the tree makes the walk green again', walkTs(join(tmpRoots, 'pkg', 'src')).length === 1);

    // The real roots this gate runs against resolve — the assertion is wired in,
    // not merely defined.
    let realErr = null;
    try { assertRootsResolvable([DRIVERS_DIR, CASE_SETS_DIR]); } catch (err) { realErr = err; }
    expect('the real DRIVERS_DIR and CASE_SETS_DIR both resolve', realErr === null);
  } finally {
    rmSync(tmpRoots, { recursive: true, force: true });
  }

  // ── The ratchet-remedy authority convention (#8435) ────────────────────────
  //
  // Three assertions, deliberately non-overlapping, so each way this can rot is
  // caught by exactly one NAMED failure:
  //
  //   (1) the detector still reaches its subject — the only one that fails if
  //       the offer is reworded out from under `RATCHET_EXPANSION_OFFER`, which
  //       would make (3) pass vacuously forever after;
  //   (2) the real emitted message carries the marker — the only one that fails
  //       if the label is dropped from CONSUMED's text;
  //   (3) an offer WITHOUT the marker is REJECTED — the only one that fails if
  //       the predicate stops discriminating (e.g. is reduced to `return true`).
  //
  // (3) is what makes (2) worth having: without it, a predicate that approves
  // everything would keep this block green while the convention is gone.
  const consumed = consumedMessage('driver-example', {
    marker: 'PAGINATION_CASES',
    what: 'a sorted paged read is a partition',
  });
  expect('#8435 — the ratchet-offer DETECTOR still matches CONSUMED (else the check below is '
    + 'vacuous)',
    RATCHET_EXPANSION_OFFER.test(consumed));
  expect(`#8435 — CONSUMED marks the ledger path ${RATCHET_AUTHORITY_MARKER} (the LEDGER comment `
    + 'calls an entry a MEASURED exception the maintainer has agreed to, so the author must be '
    + 'told that where they read it, not only where a maintainer does)',
    ratchetRemedyCarriesAuthority(consumed));

  {
    // (3)'s fixture is SYNTHETIC rather than the real message with the marker
    // stripped out: derived, it also fires on a rewording — two named failures
    // for one rot, the second misdescribing the cause.
    const unmarkedOffer =
      `CONSUMED: driver-example does not run PAGINATION_CASES. Add a suite that drives the shared `
      + `cases, or add a measured DEBT/EXEMPT entry to the ledger in ${LEDGER_REL} saying why not.`;
    // if/else, not two flat asserts: a fixture that stopped being an offer would
    // ALSO fail the discrimination check, and that second failure would
    // misdescribe the cause. Exactly one of these two can fire.
    if (!RATCHET_EXPANSION_OFFER.test(unmarkedOffer)) {
      expect('#8435 — the synthetic unmarked-offer fixture is no longer recognised as an offer, so '
        + 'it cannot test discrimination at all. Re-spell it to match RATCHET_EXPANSION_OFFER',
        false);
    } else {
      expect('#8435 — ratchetRemedyCarriesAuthority() REJECTS an offer carrying no marker (proves '
        + 'the predicate discriminates rather than approving everything)',
        !ratchetRemedyCarriesAuthority(unmarkedOffer));
    }
  }

  if (failures.length) {
    for (const f of failures) console.error(`  x self-test: ${f}`);
    console.error(`\ncheck-driver-conformance --self-test: ${failures.length} failure(s).\n`);
    process.exit(1);
  }
  console.log(
    'OK  self-test: detects driven / unused / re-declared fixtures, discovers both axes, accounts for '
      + 'every entry under DRIVERS_DIR (a dropped or manifestless row is red, not a smaller matrix), '
      + 'holds the dead-root hard error (red when a scan root is renamed, green when restored), and '
      + 'keeps CONSUMED\'s ledger offer marked maintainer-only (#8435).',
  );
}

if (process.argv.includes('--self-test')) selfTest();
else report();
