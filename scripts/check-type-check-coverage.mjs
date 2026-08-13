#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// check-type-check-coverage -- every workspace package's TypeScript is read by
// tsc somewhere, or its absence is a recorded, tracked decision (#4311).
//
// 66 of 77 workspace packages build with tsup, which transpiles with esbuild
// and never type-checks. `vitest run` does not type-check either. And the CI
// typecheck job covered exactly four targets (spec, examples,
// downstream-contract, docs code blocks) -- so for most packages NOTHING read
// src/ or the tests with a type checker at all. #4311 measured the hole:
// 380 code-tier errors across 18 packages, 241 of them in driver-sql. A green
// test suite no tsc has ever read is not evidence of a contract; this gate
// makes the coverage hole itself the failure, so it can only shrink.
//
// What the first burn-down found is worth knowing before reading a number
// below as "N test literals to fix". The three drivers (driver-sql 241,
// driver-sqlite-wasm 27, driver-memory 23) were filed as one playbook --
// author-tier literals in a parsed-tier parameter -- and 165 of their 292
// were something else entirely: 118 for a `bypassTenantAudit` driver option
// that SqlDriver read (through an `as any`), the engine set, and two services
// passed, while `DriverOptionsSchema` had never declared it; 41 for a bare-id
// `findOne(object, id)` branch on no contract, which the other two drivers
// answered differently; 4 for a `tenancy` key `initObjects` consumed but did
// not declare; 19 for an analytics `timezone` default. The tests were right
// and the types were wrong. A tsc count is a place to look, never a verdict.
//
// The reverse also holds: a LOW count can be call sites opting out. Those same
// three packages carried 111 `as any` casts on driver-call arguments. Removing
// them left 66 fresh errors -- every one a real missing `object` the cast had
// hidden, including an `orderBy: [['id','asc']]` tuple the driver reads as
// `item.field` and therefore silently dropped, inside a helper whose whole job
// was reading rows in order. 43 of the casts were needed by nothing at all;
// exactly 2 were load-bearing (tests feeding a filter the AST gate refuses, on
// purpose). Onboarding a package is supposed to make its `typecheck` mean
// something, so the casts belong in the diff too.
//
//   node scripts/check-type-check-coverage.mjs                # structural, sub-second
//   node scripts/check-type-check-coverage.mjs --re-measure   # + refreshes the
//                                    #   ledgered packages' dependency closure,
//                                    #   then runs tsc per ledger entry
//   node scripts/check-type-check-coverage.mjs --re-measure --lower
//                                    # + writes each measured number back into
//                                    #   the ledger below (#6376). Refuses on a
//                                    #   closure it cannot make current itself
//                                    #   -- see BUILT CLOSURE.
//   node scripts/check-type-check-coverage.mjs --self-test
//
// Invariants, per workspace package (the root workspace package included --
// #4311's audit counted its top-level TypeScript like any other package's):
//
//   COVERED     the package declares a `typecheck` script, OR carries a DEBT
//               entry (measured tsc error count + tracking issue) or an EXEMPT
//               entry (why type-checking cannot apply) below. A new package
//               must arrive covered -- the ledger is closed to new debt.
//   REAL        a declared `typecheck` script actually invokes tsc. A script
//               that echoes, lints, or runs tests is not type coverage.
//   TESTS_COVERED
//               a package whose own `*.test.ts` / `*.spec.ts` files sit outside
//               every tsc program that accounts for it carries a measured
//               TEST_DEBT entry. `tsc --noEmit` reads the package tsconfig, so a
//               test file that config never reaches is hidden from the very
//               check the `typecheck` script advertises -- COVERED and REAL both
//               pass while nothing reads the files #4311 is actually about. This
//               invariant is why the ledger is two ledgers: DEBT is "src does
//               not check", TEST_DEBT is "src checks, tests are hidden", and
//               they are independent.
//
//               DECIDED PER FILE, and both ways a file can fall out (#7353).
//               Until then this asked one per-config question -- does some
//               `exclude` name the tests -- which detects a config that steers
//               tsc AWAY from them and NEVER a config that simply never steered
//               tsc TOWARD them. `include: ["src"]` beside a sibling `test/`
//               tree, no `exclude` at all, read as fully covered: #7312 moved
//               two example apps from hiding their tests to compiling them and
//               this headline did not move by one file, because neither app had
//               ever counted toward it. The census that came with the repair
//               found 3 such packages and 65 such files, `packages/cli` alone
//               hiding 56 test files worth 188 raw errors that no gate, ledger
//               or CI job had ever read. Per file also makes PARTIAL coverage
//               sayable: cli keeps 54 of its 110 test files under `include`,
//               and 56 is the true number rather than 0 or 110.
//
//               Read across ALL of a package's tsconfigs, not just
//               `tsconfig.json` (#5286). The build config has a reason to
//               exclude tests -- ci.yml gates that no test file reaches the
//               published artifact -- so the supported repair is a SIBLING
//               `tsconfig.test.json` wired into the `typecheck` script. Judging
//               only `tsconfig.json` would keep calling such a package hidden
//               while tsc reads every one of its tests. The sibling must be
//               NAMED in the typecheck script chain: a config no script invokes
//               reads as coverage and delivers none, which is this gate's own
//               subject matter.
//   PINS_CHECKED
//               a test file containing a `@ts-expect-error` directive sits
//               inside a tsc program, or is listed in PHANTOM_PIN_DEBT below.
//               `@ts-expect-error` is the retirement channel the
//               spec-property-retirement playbook leans on ("tsc is the best
//               sweeper"): the directive is supposed to go red the day the
//               removed key comes back. In an unchecked file it evaluates
//               NEVER -- deleting the directive line leaves the suite just as
//               green, which is a phantom check wearing a pin's clothes
//               (#5286). Independent of TESTS_COVERED: a file can sit outside
//               `include` without any exclusion naming it, which is how
//               `packages/metadata-core/test/` hid.
//   RUNNABLE    turbo.json declares the `typecheck` task, the root `typecheck`
//               script aggregates it (`turbo run typecheck`, the build/test
//               convention), and lint.yml invokes it -- a script CI never
//               executes is not coverage either (#4203: gates that only run
//               where nobody runs them, rot).
//   RECONCILED  in both directions: a DEBT/EXEMPT entry for a package that now
//               declares `typecheck`, or that no longer exists, is an error.
//               A ledger that can only accrete rots into a list nobody trusts.
//   MEASURED    (--re-measure only) every DEBT / TEST_DEBT number is RE-RUN, and
//               a package whose real `tsc --noEmit` count now EXCEEDS its
//               recorded one is an error. Without this the ledger asserted only
//               that a positive number was written down: `errors: 28` and
//               `errors: 1` were equally acceptable, so a package's real count
//               could grow without bound while the gate reported success
//               (#5278). Measured drift at filing time, all in one direction:
//               metadata-protocol 28 -> 63, service-analytics 3 -> 7,
//               service-automation 2 -> 5.
//
//               Asymmetric on purpose. Growth is red -- that is the ratchet.
//               SHRINKAGE is an informational line, never red: making a package
//               better must not also make CI fail until someone edits a number,
//               or the ledger starts charging a toll on exactly the work it
//               exists to encourage. A count that reaches 0 is reported as a
//               graduation candidate, and graduating is still a deliberate PR
//               (add the `typecheck` script, delete the entry -- COVERED and
//               RECONCILED are what force the pair).
//
//               THE SURPLUS (#6376). That asymmetry has a price, and it is not
//               bookkeeping: the gap between a recorded number and a smaller
//               measured one is a live PERMISSION ALLOWANCE. Nothing else reads
//               these layers. A DEBT entry exists ONLY where no `typecheck`
//               script does (RECONCILED forbids both at once) and a TEST_DEBT
//               entry ONLY where no tsconfig the typecheck script invokes reads
//               the tests -- so for EVERY entry in both ledgers, this number is
//               the sole gatekeeper of the layer it measures, and while the gap
//               is open any regression smaller than it lands green.
//
//               Not a hypothesis. driver-mongodb recorded 43 while measuring 10:
//               #6210 had narrowed six contract methods and retired 33 errors,
//               and nothing lowered the entry. Reverting `aggregate(object,
//               query: DriverQuery)` back to `QueryAST` measured 12 -- and
//               12 < 43, so the only gate that could pin that signature stayed
//               silent. PR #6356 lowered the entry to 10; the same reversion
//               then reported +2 and went red. Read it as the sentence it is:
//               A LEGITIMATE IMPROVEMENT SILENTLY MUTED THE NEXT PERSON'S PIN.
//
//               So the surplus is now REPORTED -- per entry and as a total, on
//               every green re-measure -- because an allowance nobody can see is
//               the part that does the damage. Measured on main @ 1818998: 11 of
//               34 entries carried a combined surplus of 310 raw errors, 15% of
//               everything the two ledgers record, with 199 of it in a single
//               entry (plugin-approvals, 547 recorded / 348 measured). What this
//               gate deliberately does NOT do is make a surplus red: the ruling
//               above stands and an improvement still lands green. What it does
//               instead is make closing one FREE -- `--lower` writes the
//               measured numbers back into the ledger, so flattening an entry
//               never requires a human to type a measured number. Whether the
//               surplus should additionally be enforced is #6376's open
//               question, not this paragraph's, and the cost of guessing it is
//               argued there.
//
//               What drifts is not only the NUMBER but the note's COMPOSITION:
//               service-automation's note named `engine.test.ts:2547/2577` as
//               the whole debt while three TS2341 in a different file, from an
//               unrelated PR, had joined it. So when this invariant makes you
//               raise a count, rewrite the note to match what the pile is now
//               made of -- and when the delta cannot be attributed, say so in
//               the note rather than inventing composition.
//
//               One thing to know before re-measuring: a `pull_request` run
//               compiles your branch MERGED INTO the current main, not your
//               branch. So the number to record is the one measured on a tree
//               merged with main as of that moment, and a sweep that re-measures
//               MANY entries races every PR landing beside it -- #5278's own PR
//               went red on `@objectstack/rest` twice for exactly that reason,
//               three rest-touching PRs having landed between the sweep and the
//               run. That race is a bootstrapping cost, not a standing one: once
//               this invariant is on main, the PR that adds the errors is the PR
//               that goes red, which is the whole point.
//
//               The MERGE QUEUE sharpens the same edge, and is worth its own
//               paragraph because the usual remedy does not work there. The queue
//               builds your PR as merged onto the head of the queue, which keeps
//               moving as the entries ahead of you land -- so a count frozen even
//               minutes earlier can already be stale, and RE-RUNNING the failed
//               job cannot fix it (a rerun replays the same merge ref, so it
//               re-measures the same stale base). The only repair is a new commit
//               carrying a re-measured number. #5278's PR was kicked from the
//               queue on `@objectstack/objectql` +2 -- #5802's registry tests and
//               #5850's new file -- and while it sat there red-looping, two
//               unrelated PRs queued behind it were each kicked once as
//               collateral, then landed untouched once it left the queue. So: if
//               a re-measure PR goes red in the queue, take it OUT of the queue
//               before repairing it, and if you are the one re-measuring, push
//               the calibration immediately after measuring rather than batching
//               it with other work.
//
//               Before treating any such red as base drift, falsify the other
//               explanation: run `--re-measure` TWICE on the same tree. Identical
//               output means the count is deterministic and calibration is the
//               right answer; a count that oscillates would mean tsc itself is
//               nondeterministic here, which is a tolerance question for this
//               ratchet and NOT a calibration -- take it back to #5278. Measured
//               2026-08-06 on the objectql case: two back-to-back runs were
//               byte-identical, so this gate has no known nondeterminism.
//
//               BOOTSTRAP MARGINS (#5278 option A). The two paragraphs above
//               describe a race that the exact-calibration loop lost five times
//               running -- objectql 333 -> 334 -> 335 -> 339 and lint 30 -> 32,
//               each calibration stale within minutes of being pushed, while
//               seven unrelated PRs were kicked from the queue as collateral.
//               The maintainer's ruling was to land the invariant with a
//               DOCUMENTED margin on the packages that proved hottest rather
//               than run a sixth lap: `@objectstack/objectql`,
//               `@objectstack/lint`, `@objectstack/rest`,
//               `@objectstack/service-storage` and `@objectstack/mcp` are
//               recorded at their measurement PLUS TEN, and each says so in its
//               own note, naming the measured number and the sha. This is the
//               ledger's ONLY
//               slack and it is deliberately loud: nothing else here may sit
//               above its measurement, and a margin is not a place to hide a
//               real increase. Because shrinkage is informational, each of the
//               five prints its own `ℹ ... can be lowered` line on every run --
//               that line IS the tightening worklist, and closing it is a
//               follow-up PR, not a thing to leave running for months.
//
//               The margins were not a precaution; two of the first four were
//               paid out inside a single hour of the landing flight. objectql
//               moved 339 -> 345 (#5749 / PR #6013 extending
//               summary-rollup.test.ts)
//               and service-storage 42 -> 41 -> 42 (the two halves of the
//               `IStorageService.list(prefix)` retirement, #5540 / PR #5983 then
//               #5541 / PR #6061, landing hours apart). Recorded exactly, both
//               would have been red on a base nobody could have measured in
//               advance. Note the second shape especially: a retirement split
//               across two PRs moves a count DOWN and then back UP, so an exact
//               number recorded between the halves is stale before it is pushed.
//
//               The FIFTH margin, `@objectstack/mcp`, is the one the gate found
//               by itself, and it is the cleanest evidence that this invariant
//               does what it was built for. #5278's own PR reached the merge
//               queue and was kicked at 03:25:18Z on a single red line: mcp
//               TEST_DEBT recorded 52, tsc reported 53. The +1 was NOT
//               introduced by the PR ahead of it in the queue (#6077's own
//               queue generation was green) -- it is a pre-existing drift that
//               nothing in this repo had ever been able to see, surfaced the
//               first time the ledger was re-measured against a moving base.
//               A ratchet whose introducing PR is the first thing it catches is
//               a ratchet that works. It takes a margin rather than an exact
//               number for the same reason the other four do: packages/mcp took
//               a feature landing the same day (#6077 projecting skill
//               `instructions` as MCP prompts), so it is an actively-moving
//               package, and an exact number on an actively-moving package is
//               precisely the bet option D lost five times running.
//
// The root is the one asymmetry: its `typecheck` script is the workspace
// aggregator, so its OWN top-level TypeScript is covered by a `typecheck:root`
// script (tsc, invoked from lint.yml) or by a ledger entry like anyone else.
//
// DEBT is frozen debt, not a permission slip. Every entry below was measured
// by running the package's own `tsc --noEmit` on main (see the issue for the
// code-tier / config-tier / noise split -- raw counts here include all three),
// and every entry is RE-MEASURED by `--re-measure` (the MEASURED invariant), so
// "frozen" is now enforced rather than asserted. To onboard a package: fix (or
// config-fix) its errors, add `"typecheck": "tsc --noEmit"` to its package.json,
// and delete its entry here in the same PR. Deleting the entry without the
// script fails COVERED; keeping the entry alongside the script fails RECONCILED.
//
// TEST_DEBT is the same discipline for the second hole. The first pass of this
// gate (#4324) counted a package covered the moment it declared `typecheck` --
// and 27 of the 48 it waved through exclude `**/*.test.ts` from the tsconfig
// that very script runs against, hiding 568 test files and 1451 errors behind
// a green check. `spec` alone hid 902 across 272 test files. To onboard: drop
// the exclusion from tsconfig.json and delete the entry here in the same PR.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, posix, resolve } from 'node:path';

// Anchored to the script, not to cwd: the verdict must not depend on where the
// guard was invoked from.
const ROOT = resolve(import.meta.dirname, '..');
const SELF = 'scripts/check-type-check-coverage.mjs';
const WORKSPACE_FILE = 'pnpm-workspace.yaml';
const TRACKING_ISSUE = 'https://github.com/objectstack-ai/objectstack/issues/4311';
// An `exclude` pattern that names tests (`**/*.test.ts`, `**/*.spec.tsx`, ...)
// and the files such a pattern hides. Kept deliberately broad: the question is
// "does this config steer tsc away from the test layer", not "which exact glob".
const TEST_GLOB = /\*\.(test|spec)\.tsx?$/;
const TEST_FILE = /\.(test|spec)\.tsx?$/;
// A TypeScript source file, i.e. one whose content can reach a generated
// `.d.ts`. Used only by the built-closure freshness read (#8271).
const SOURCE_FILE = /\.([cm]?ts|tsx)$/;
// A `@ts-expect-error` in DIRECTIVE position -- first thing on its own comment
// line, where the compiler reads it. Prose that merely mentions the directive
// (several files in this repo explain why they do NOT use one) must not count,
// or PINS_CHECKED would fire on documentation.
const PIN_DIRECTIVE = /^[ \t]*(?:\/\/|\/\*|\*)[ \t]*@ts-expect-error\b/m;
const PIN_ISSUE = 'https://github.com/objectstack-ai/objectstack/issues/5286';

// Package name -> { errors, note? }. `errors` is the raw `tsc --noEmit` count
// measured per package. Seeded on main @ b07d829 (2026-07-31), re-measured
// after the NodeNext repair below, and re-measured WHOLESALE on main @ 5ab08428
// (2026-08-06) when #5278 found the ledger had been drifting untested since:
// 7 of these 15 entries were understated, none overstated. Notes carry the
// composition as measured at that sha; where the delta could not be attributed
// (this repo's clone is shallow, so per-file blame was not available) the note
// says so rather than inventing a story for it.
// Raw counts include all three of #4311's tiers -- code-tier (real defects),
// config-tier (the check itself misconfigured: TS2591/TS2584 missing
// `types:["node"]`, TS2835/TS2307 module resolution) and noise (TS7006
// implicit-any params, TS6133 unused) -- so each note says what the pile is
// made of. Nobody should mistake a config-tier pile for real breakage, or --
// worse -- the reverse: `core` at 91 raw has 3 real errors, while
// `driver-sql`'s 241 were ALL real (and, as the header notes, mostly real
// about the types rather than about the tests).
//
// The tiers are not independent, which is why these numbers get re-measured
// rather than decremented. Under `moduleResolution: NodeNext` a relative
// import without its `.js` extension does not resolve, so every symbol it
// names degrades to `any` -- and each callback over one of those symbols then
// reports TS7006 "implicitly any". Repairing 44 such imports in this PR closed
// 110 errors across eight packages, most of them "noise" that was never noise
// at all, and simultaneously EXPOSED 12 real defects in `service-settings`
// that the unresolved imports had been masking. A config-tier count is an
// upper bound on nothing: fix the config first, then read the residue.
const DEBT = {
  '@objectstack/cloud-connection': {
    errors: 13,
    note: 'code-tier 11 (TS2493 tuple indexing) + 2 config-tier.',
  },
  '@objectstack/core': {
    errors: 98,
    note: 'code-tier 3 (TS18046/TS2739/TS2352); the rest is config-tier 23 (TS2835 x22 / TS2347 module '
      + 'resolution) and noise 72 (TS7006 x71, TS6133). Re-measured 98 at 5ab08428, up from 91: the '
      + 'code-tier count is UNCHANGED at 3, so the whole +7 landed in the NodeNext/implicit-any residue '
      + '-- which is the tier the note at the top of this ledger says to fix first, not last.',
  },
  '@objectstack/hono': {
    errors: 3,
    note: 'all code-tier (TS2769/TS18046).',
  },
  '@objectstack/knowledge-ragflow': {
    errors: 4,
    note: 'code-tier 3 (TS2353) + 1 config-tier (TS2550 lib).',
  },
  '@objectstack/metadata': {
    errors: 89,
    note: 'code-tier 34 (TS2345 x30, TS2322 x4); config-tier 24 (TS2835); noise 34 (TS7006 x33, TS6133). '
      + 'Re-measured 92 at 5ab08428, up from 87. Composition moved as well as the count: the note used to '
      + 'name TS2353, which is gone, and TS2322 has taken its place. Two thirds of the pile sits in '
      + 'metadata.test.ts (34) and register-notifies-watchers.test.ts (16).',
  },
  '@objectstack/metadata-protocol': {
    errors: 63,
    note: 'code-tier 40 (TS2322 x34, TS2532/TS2493 x2 each, TS2353, TS2339); config-tier 10 (TS2835 x9, '
      + 'TS2550); noise 13 (TS7006). Re-measured 63 at 5ab08428 -- the 2.25x drift that opened #5278, and '
      + 'the entry whose note was most misleading: it read "code-tier 9, the rest config-tier and noise", '
      + 'while code-tier alone is now 40. 27 of the TS2322 are in protocol.stored-migration.test.ts and 10 '
      + 'in seed-loader-multi-value-reference.test.ts, so this is concentrated debt in two files rather '
      + 'than a package-wide drizzle -- read it as two repairs, not as forty.',
  },
  '@objectstack/observability': {
    errors: 11,
    note: 'all code-tier (TS2554 wrong arity x10, TS2552).',
  },
  '@objectstack/service-analytics': {
    errors: 10,
    note: 'code-tier 9 (TS2339 x7, TS7053 x2) + 1 noise (TS6133). Re-measured 10 at e8db1a230, up from 7 '
      + 'at 5ab08428 and 3 before that. All 7 TS2339 sit in __tests__/measure-source-field-gate.test.ts, '
      + 'the same file that carried 4 of them when this entry was last written; the +3 arrived with #5716 '
      + '/ PR #5963 rewriting that gate\'s refusals -- no new file, no new error class. This entry is the '
      + 'standing specimen for why the ERROR-COUNT layer needed a ratchet of its own: the PACKAGE layer '
      + 'of this gate has been closed to new debt the whole time, and the count still walked 3 -> 7 -> 10 '
      + 'unremarked (#5278).',
  },
  '@objectstack/service-automation': {
    errors: 3,
    note: 'code-tier 5. Two are the TS2741 this note used to describe as the whole debt: '
      + 'engine.test.ts:2547/2577 build a descriptor literal missing a required field, the #4198 discovery '
      + 'that opened #4311 (the missing field TS names moved from resumeAuthority to handlerContract in '
      + '#5561, which made resumeAuthority optional; both literals omit both, and TS reports one at a '
      + 'time). The other 3 are TS2341 in src/nested-region-parity.test.ts, where the tests dot-read the '
      + 'private `engine.flows` -- not `engine[\'flows\']`, not `as any`. Re-measured 5 at 5ab08428. This is '
      + 'the specimen #5278 cites for composition drift: an entry reading "2, two descriptor literals" '
      + 'looks like a free graduation, while the real residue includes a decision about whether tests may '
      + 'read private state at all.',
  },
  '@objectstack/service-cluster': {
    errors: 1,
    note: 'code-tier 1 (TS2322).',
  },
  '@objectstack/service-knowledge': {
    errors: 10,
    note: 'code-tier 3 (TS2339/TS2352/TS2493); config-tier 3 (TS2835); noise 4 (TS7006). Re-measured 10 at '
      + '5ab08428, up from 8; code-tier is unchanged at 3, so the +2 is config-tier/noise. 8 of the 10 are '
      + 'in __tests__/knowledge-service.test.ts.',
  },
  '@objectstack/service-storage': {
    errors: 51,
    note: 'code-tier 8 (TS2339 x4, TS2347 x4); config-tier 21 (TS2835); noise 13 (TS7006 x11, TS6196, '
      + 'TS6133). This entry is the fourth bootstrap margin, and it earned the label the hard way inside '
      + 'one flight: 42 -> 41 at e8db1a230 (the spec half of the `IStorageService.list(prefix)` '
      + 'retirement, #5540 / PR #5983, removed one error, and it was lowered rather than left standing) '
      + '-> 42 again at 77c7c884b an hour later, when the adapter half (#5541 / PR #6061) deleted the '
      + 'old list tests (-1 TS7006) and added storage-adapter-list-retirement.test.ts (+2 TS2835). A '
      + 'two-PR retirement moves a count twice, and an exact number recorded between the halves is stale '
      + 'before it is pushed -- so this one takes the same documented margin as the three proven-hot '
      + 'packages instead of a sixth calibration lap. 11 of the 42 are in '
      + 'storage-route-ledger.conformance.test.ts and 7 in storage-service-plugin.test.ts. RECORDED 52 '
      + 'is a bootstrap margin (+10 over 42 measured at 77c7c884b) -- tighten via the ℹ hint immediately '
      + 'after landing (#5278 option A).',
  },
  '@objectstack/spec-monorepo': {
    errors: 80,
    note: 'the workspace root itself: code-tier 4 (TS2304 x2, TS2339 x2); config-tier 68 '
      + '(TS2591 x28 / TS2584 x22 -- the root tsconfig still has no `types:["node"]` -- plus TS2307 x17 '
      + 'and TS2550); noise 8 (TS7006 x7, TS6133). Re-measured 80 at 5ab08428, up from 50. This entry '
      + 'drifts differently from a package: the root program is `scripts/` and the top-level configs '
      + '(everything outside packages/apps/examples), so it grows whenever the repo gains a script -- '
      + 'scripts/check-test-typecheck.mts alone accounts for 29 of the 80, and the analytics-reconcile '
      + 'tree for 32. Almost all of it is one missing `types:["node"]`, not 80 defects. One wrinkle to '
      + 'know before reading this number as "the root scripts": `exclude` only drops files from the '
      + 'initial walk, so example sources IMPORTED by a script are still pulled into the program -- 4 of '
      + 'the 80 are reported in examples/app-showcase/src, and this entry therefore moves with the '
      + 'showcase as well as with scripts/.',
  },
};

// Package name -> why running tsc over it is not applicable at all. An EXEMPT
// entry is a statement about the package's nature, not about its debt; if the
// nature changes, the RECONCILED direction forces this entry out.
const EXEMPT = {
  '@objectstack/console':
    'Published objectui build artifact -- package.json/README/CHANGELOG plus a dist/ pulled in by `pnpm objectui:refresh`. No TypeScript sources, no tsconfig; the sources are type-checked in the objectui repo.',
};

// Package name -> { errors, note? } for packages whose tsconfig excludes their
// own test files. `errors` is what `tsc --noEmit` reports once the exclusion is
// lifted, measured by re-running each package's own config with the test globs
// dropped. HOW MANY files that exclusion hides is NOT recorded here: this gate
// counts them on every run (`testCoverage()` -> `pkg.testFiles`, sub-second, no
// compiler), so the summary derives the number instead of reading a copy of it
// (#5826). An entry that carries a `tests` field is rejected -- see the
// RECONCILED loop in evaluate(). These packages are NOT uncovered: their src
// type-checks and most declare `typecheck`. What they hide is the test layer,
// which is where #4311 found the defects (a passing vitest run proves the code
// executes, not that the call shapes match). Sorted by what each is hiding,
// worst first.
// `@objectstack/spec` graduated in #5286: `tsconfig.test.json` (a sibling of
// the build config, named by the `typecheck` script) compiles its 295 test
// files, so nothing is hidden any more and TESTS_COVERED no longer wants an
// entry here. The residue that lifting the exclusion surfaced did not vanish
// with the entry -- it moved to `packages/spec/test-typecheck-debt.json`, a
// PER-FILE exact ratchet re-measured by tsc on every run, which is strictly
// stronger than the frozen package-level number this ledger could hold. The
// number that used to sit here (272 files / 902 errors) was also stale by 23
// files, which is the other argument for a measurement the gate derives -- an
// argument this ledger has now acted on rather than only recorded (#5826).
//
// Re-measured wholesale on main @ 5ab08428 (2026-08-06) with the DEBT ledger
// above, for the same reason (#5278): 10 of these 19 `errors` numbers were
// understated, 2 overstated, 7 exact. That sweep also refreshed a SECOND
// hand-written number, `tests`, which had drifted just as far in the same
// direction (66 -> 101 for runtime, 87 -> 125 for objectql; 12 of 19 entries
// stale, every one of them understated) because adding a test file to an
// excluded package was invisible to everything. The two numbers needed
// OPPOSITE repairs, which is why they were two issues: `errors` cannot be
// known without running the compiler, so freeze + re-measure (#5278) is the
// only shape available to it; the file count is FREE -- this gate already
// computes it on every run to decide TESTS_COVERED -- so the fix is to delete
// the copy and read the live count (#5826). A refreshed copy would have been
// accurate for exactly as long as it took the next test file to land; a
// derived one cannot drift at all, which is why this one is gone rather than
// re-ratcheted.
//
// THE THREE ENTRIES THAT ARRIVED WITH #7353 -- cli 188, metadata-fs 6,
// example-showcase 4 -- were not new debt and did not slip past a ledger that is
// closed to it. They are debt this gate had never been able to SEE: TESTS_COVERED
// asked whether an `exclude` named the tests, so a package that had simply never
// pointed `include` at its test tree answered "covered" while nothing compiled a
// line of it. All three were in that state before this ledger existed. 198 raw
// errors is what the blind spot was worth on the day it was measured, and the
// only thing that changed to surface them is the question.
//
// TWO OF THE THREE HAVE SINCE GRADUATED (#7923), which is the point of a TEST_DEBT
// entry: it is a holding position that makes a layer ratchet, not a destination.
// Both were re-measured on the merged ref before repair and both matched their
// recorded numbers exactly (metadata-fs 6, example-showcase 4), so the entries
// were deleted against measurements rather than against hope.
//   - `@objectstack/metadata-fs` took the sibling-config route, because its
//     `rootDir` is `src` and its `dev` script emits (`tsc --watch`, `outDir:
//     dist`): a package-root `rootDir` in the BUILD config would relocate
//     `dist/index.js` and start emitting compiled tests. `tsconfig.test.json`
//     beside it is named by the `typecheck` script -- the #5286 mechanism, the
//     same one `packages/metadata-core` uses for the structurally identical hole.
//   - `@objectstack/example-showcase` took the widened-`include` route (#7312's
//     shape for app-crm / app-todo), because its `rootDir` is already `.` and
//     nothing needed neutralising. Its glob was `e2e/**/*.spec.ts` and NOT
//     `e2e/**/*`, holding the same line the deleted entry's note drew: the
//     wholesale glob would pull in `e2e/global-setup.ts`, a fixture rather than a
//     test, and bill the test layer 6 errors that are not its own.
//     (historical: until #8062 / PR #8178, that file sat read by no tsc program
//     at all. The package's own tsconfig now takes the wholesale `e2e/**/*`
//     glob directly, and the 6 errors are fixed at their source -- a file-local
//     `declare const process` plus `mkdirSync`/`writeFileSync` on the `node:fs`
//     shim in `examples/app-showcase/types/node-shim.d.ts` -- so
//     `global-setup.ts` is now read and type-checks clean. The lesson survives
//     the fix: widen a hidden test layer's `include` one file at a time and
//     measure each addition, because a wholesale glob can bill the layer for a
//     non-test file it never asked to cover.)
// `@objectstack/cli` (188 raw across 56 files) is deliberately NOT part of that
// graduation -- it is a programme rather than a sitting, and its entry stands.
const TEST_DEBT = {
  '@objectstack/plugin-approvals': {
    errors: 348,
    note: 'TS2339 x296, TS2550 x20, TS2345 x16, TS18048 x10, plus 6 singletons (TS2554 x2, TS1470, '
      + 'TS2352, TS2353, TS6133). Was 547 (re-measured at 5ab08428, up from 467; TS2345 x213 then). '
      + 'Lowered 547 -> 348 at b5e09b21 (#7888), and the -199 is ONE CLASS COLLAPSING rather than a '
      + 'measured surface shrinking -- the distinction the surplus finding asked to be settled before a '
      + 'gap this size was written in as a floor. Three readings say collapse: (a) TS2339 x296, TS2550 '
      + 'x20 and TS18048 x10 are unchanged TO THE UNIT against the 547 composition and only TS2345 moved, '
      + '213 -> 16 -- a program that had DEGRADED instead (an unresolved import turning a type into any) '
      + 'would have wiped the 296 property errors first, since property access on any is legal; (b) all '
      + '21 test files are on disk and all 21 are in the program (tsc --listFiles), none deleted, and the '
      + 'package\'s other test files gained 406 lines and lost 204 over the window -- the set grew; (c) '
      + 'src/approval-service.test.ts, which holds 273 of the 348 as it held 443 of the 547, is '
      + 'BYTE-IDENTICAL between 5ab08428 and b5e09b21 (blob 3fc272f, 3335 lines both ends). Same bytes, '
      + '170 fewer errors, so the repair landed in a producer\'s types and no assertion was deleted to '
      + 'get it. The 16 TS2345 that survive are still reported against a fully-resolved approver-config '
      + 'union, so that parameter type is still strict -- the 197 that went were repaired, not loosened '
      + 'away. Still entirely test-only (src is clean), so nothing but this ledger has ever seen it.',
  },
  '@objectstack/objectql': {
    errors: 355,
    note: 'TS2339 x115, TS2554 x93 (wrong arity), TS7006 x47, TS2345 x19, TS2322 x12, TS2749 x11. '
      + 'Re-measured 333 at 5ab08428, up from 219 -- the largest absolute growth in either ledger. The '
      + 'shape held (TS2339/TS2554/TS7006 still lead) but every number roughly tripled, and the hidden '
      + 'test layer took on ~40 more files over the same window; src/engine.test.ts alone carries 103 of '
      + 'the errors. Then +2 at 909895dc (+1 TS2339 in '
      + 'src/registry.test.ts, #5802 having added ~116 lines of registry tests; +1 TS2554 in the file '
      + '#5850 introduced, src/engine-update-prior-read-scope.test.ts), and +4 more at c15fcee4c -- ALL '
      + 'FOUR in one file #5861 added, src/save-meta-response-conformance.test.ts: one TS2554 at :115, '
      + 'and at :119 a TS6133 (`LOG` declared, never read) beside two TS2304 (`appendFileSync` and `OUT` '
      + 'are not names in scope). That last line is worth a look by whoever next touches the file -- an '
      + 'unresolved name is a line that cannot run, not a typing nicety -- but it is that PR\'s to fix, '
      + 'not this ledger\'s. This is the package that showed what the merge queue does to a frozen '
      + 'number: the queue builds the PR as merged onto the CURRENT queue head, so a count frozen minutes '
      + 'earlier is already stale, and #5278\'s own PR was kicked on this entry three times before it '
      + 'landed. Re-measured at e8db1a230 (this PR merged with main after a day of drift): still 339, '
      + 'the histogram unchanged code for code. Then 345 at 77c7c884b ONE HOUR LATER: +6 TS2554 in '
      + 'src/summary-rollup.test.ts, which #5749 / PR #6013 extended while this PR was in flight. That '
      + '+6 is what the bootstrap margin is FOR -- recorded at 349 it was absorbed silently, and an '
      + 'exactly-calibrated 339 would have been the sixth red in the same race. RECORDED 355 is a '
      + 'bootstrap margin (+10 over 345 measured at 77c7c884b) -- tighten via the ℹ hint immediately '
      + 'after landing (#5278 option A).',
  },
  '@objectstack/runtime': {
    errors: 227,
    note: 'TS18048 x98 (possibly-undefined), TS2345 x26, TS18046 x20, TS2339 x16, TS2493 x15, TS2835 x11, '
      + 'TS2554 x11. Src '
      + 'graduated in #4311 (declares `typecheck`); this is purely the hidden test layer. Measured 220 -> '
      + '218 (5ab08428, one of only two entries that ever shrank; TS6133 x25 collapsed to x7 while '
      + 'possibly-undefined grew, so that net -2 hid a much larger churn in both directions) -> 227 '
      + '(e8db1a230). The latest +9 is fully attributed and is ONE file: every one of the nine is a '
      + 'TS18048 in src/domains/meta-item-envelope.test.ts, added by #5563 / PR #5895 (the '
      + '`GET /meta/:type/:name` envelope convergence). Nothing else in the package moved.',
  },
  '@objectstack/cli': {
    errors: 188,
    note: 'TS7006 x100 (implicit any), TS2835 x59 (NodeNext extensions), TS2339 x24, TS2307 x3, TS18046 x2. '
      + 'The package #7353 was really about, and the largest single thing the exclude-shaped detector could '
      + 'not see: `tsconfig.json` says `include: ["src"]` and has no `exclude` AT ALL, so there was never an '
      + 'exclusion to notice, and the 56 test files in the sibling `test/` tree were read by nothing -- not '
      + 'this gate, not `pnpm typecheck`, not CI. The other 54 test files DO sit under `src` and always '
      + 'compiled; 188 is the outside-`test/` layer only, which is why the file count reads 56 and not 110. '
      + 'Read the top-of-ledger NodeNext note before sizing this: TS2835 plus the TS7006 cascade it causes '
      + 'are 159 of the 188 and are one repair, not 159. Concentrated rather than spread -- '
      + 'test/i18n-coverage.test.ts x35, test/data-model-rules.test.ts x26, '
      + 'test/i18n-declared-surface-gate.test.ts x19, test/i18n-section-coverage.test.ts x18, '
      + 'test/commands.test.ts x15 are 113 of it. Measured at b9f930b with the closure built. RECORDED '
      + 'EXACTLY, no bootstrap margin: this layer has never been gated, so the first new error in it should '
      + 'go red rather than be absorbed.',
  },
  '@objectstack/rest': {
    errors: 155,
    note: 'TS2835 x67 (NodeNext extensions), TS7006 x57, TS2554 x13, TS2550 x10 (composition as counted at '
      + '153; not re-tallied by class at the 155 below). Graduated from DEBT in #6905 -- this TEST_DEBT '
      + 'entry is now the sole gate on the package\'s test layer (src moved to `turbo run typecheck`). '
      + 'Measured '
      + '105 -> 136 (5ab08428) -> 143 (77adf29, hours later the same day) -> 153 (e8db1a230). Read the '
      + 'top-of-ledger NodeNext note before sizing this one: TS2835 and the implicit-any pile it causes '
      + 'are 124 of the 153, and '
      + 'they are one repair, not 124. Of the +10 that then bumped 153 to a bootstrap-margin RECORDED 163, '
      + '8 are attributable to three test files that '
      + 'window added -- rest-meta-save-receipt-envelope.test.ts x4 (#5265 / PR #5926), '
      + 'meta-item-envelope.test.ts x2 (#5563 / PR #5895), '
      + 'analytics-dataset-unlisted-refusal-envelope.test.ts x2; the remaining 2 landed in files that '
      + 'already existed and are NOT attributed further, because the pre-merge per-file counts were not '
      + 'retained and a made-up attribution is worse than an admitted gap. This is also the '
      + 'fastest-moving entry in either ledger, and it is '
      + 'the one that proved the gate works: #5278\'s own PR went red in CI on it, because a `pull_request` '
      + 'run builds the branch MERGED INTO main and three rest-touching PRs had landed since the sweep. A '
      + 'ledger number is always a number about a moment. RECORDED 163 stood as that bootstrap margin (+10 '
      + 'over 153 measured at e8db1a230 and re-confirmed at 153 an hour later at 77c7c884b) until #6939 '
      + '(a surplus finding filed right after the #6905 DEBT graduation) re-measured tsc at 155 -- an 8-error '
      + 'surplus the margin had been silently absorbing, and #7038 caught the note\'s "Also in DEBT." sentence '
      + 'going stale in the same graduation. Lowered 163 -> 155 at 55da611 (#6939, #7038): RECORDED now '
      + 'equals the exact measurement, no margin, so the next new error here goes red immediately -- a '
      + 'bootstrap margin can be re-established deliberately later if that slack is wanted again '
      + '(#5278 option A).',
  },
  '@objectstack/plugin-auth': {
    errors: 111,
    note: 'TS2493 x42 (tuple index out of range), TS18048 x24, TS2740 x19, TS2322 x11, TS2532 x9, '
      + 'TS2339 x8, TS2741 x8. Lowered 131 -> 111 at b16dcb45 (#7888); the intermediate 108 in this PR\'s '
      + 'first commit was measured at b5e09b21 and was already stale when the merge queue built it -- the '
      + 'package took +3 inside the hour, which is the same "a ledger number is a number about a moment" '
      + 'race that kicked #5278 three times, and 111 is the merge-queue run\'s own re-measure on the ref '
      + 'this PR actually lands on. Composition below predates both and is NOT re-tallied at 111. '
      + 'Measured 124 -> 129 (5ab08428, composition unchanged in shape) -> 131 (e8db1a230). Half of the '
      + 'latest +2 is a TS2554 in src/last-admin-guard.test.ts, a file added by #5941 / PR #5993 '
      + '(the break-glass delete guard); the other 1 landed in a file that already existed and is not '
      + 'attributed further. 64 of the 131 sit in src/auth-manager.test.ts, 22 in '
      + 'src/admin-import-users.test.ts and 18 in src/admin-user-endpoints.test.ts.',
  },
  '@objectstack/mcp': {
    errors: 53,
    note: 'TS18046 x51 -- `json` is of type unknown, one `await res.json()` idiom repeated across four '
      + 'files (23 in mcp-server-runtime.http.test.ts, 14 in mcp-action-tools.test.ts, 8 in '
      + 'mcp-http-tools.scopes.test.ts, 6 in mcp-validate-expression.test.ts); TS6133 x1; TS2352 x1. '
      + 'Measured 52 at 5ab08428 -> 53 at 34558c2cc. This entry is the fifth bootstrap margin and the '
      + 'one the ratchet found on its OWN introducing PR: #5278 reached the merge queue and was kicked '
      + 'at 03:25:18Z on this single +1, which is not #6077\'s doing (that PR\'s own queue generation '
      + 'was green) but a pre-existing drift no gate in this repo could see until the ledger was '
      + 're-measured against a moving base. The +1 is fully attributed: '
      + 'src/skill-prompts.test.ts(185,23), a TS2352 casting `SkillPrompt | null` to `Record< string, '
      + 'unknown >` -- the file #3905 / PR #6077 added when it projected skill `instructions` as MCP '
      + 'prompt primitives, which is also why this package\'s hidden test-file count moved up by one '
      + '(the count itself is derived by this gate, not recorded here -- #5826). The old note\'s composition '
      + 'was misleading in the way the top of this ledger warns about: it read "`error` is of type '
      + 'unknown, one catch-block idiom", while all 51 are the response-body `json` binding, not a '
      + 'catch block. packages/mcp took a feature landing the same day, so it is an actively-moving '
      + 'package and an exact number here would very likely lose the same race that killed option D '
      + 'five times over. RECORDED 63 is a bootstrap margin (+10 over 53 measured at 34558c2cc) -- '
      + 'tighten via the ℹ hint immediately after landing (#5278 option A).',
  },
  '@objectstack/driver-mongodb': {
    errors: 10,
    note: 'TS1309 x7, TS2550 x3. Was 43 (TS2345 x33 + these 10), measured at 5ab08428 and still exactly '
      + '43 at d367f03d6^ -- the commit immediately before PR #6210. That PR (#6075) narrowed this '
      + "driver's six IDataDriver query methods to `DriverQuery`, which is what retired all 33 TS2345: "
      + "they were this package's OWN test literals failing `Property 'object' is missing in type` "
      + 'against a `QueryAST` that still required it. The ledger was never ratcheted down, so 33 errors '
      + 'of slack sat here. #6212 batch C lowers it to the measured 10 because that slack made the batch '
      + "OWN change unpinnable: this package's tsconfig excludes `*.test.ts`, so `pnpm typecheck` cannot "
      + "see `aggregate`'s narrowing at all, and its only consumers are those excluded tests. Reverting "
      + '`aggregate(object, query: DriverQuery)` back to `QueryAST` measures 12 here -- which the old '
      + '43-ceiling would have swallowed in silence. At 10 it goes red, which is the whole point of a '
      + 'ratchet. Re-measured 10 at 2bc187641, and the pristine tree at that commit reports the same 10, '
      + "so none of the -33 is this PR's doing.",
  },
  '@objectstack/lint': {
    errors: 20,
    note: 'TS7006 x22, TS2835 x6, TS6059 x4. Measured 26 -> 30 (5ab08428, the +4 being TS6059, a file '
      + 'outside rootDir, a class the pre-#5278 note did not list) -> 32 (e8db1a230). The latest +2 are '
      + 'both TS7006 and both in files that already existed; three lint test files changed in this window '
      + '(#5762 / PR #5952, #5378 / PR #5904) and the pre-merge per-file counts were not retained, so the '
      + 'delta is recorded rather than attributed. 10 of the 32 sit in '
      + 'src/validate-visibility-predicates.test.ts. RECORDED 42 is a bootstrap margin (+10 over 32 '
      + 'measured at e8db1a230 and re-confirmed at 32 an hour later at 77c7c884b) -- tighten via the ℹ '
      + 'hint immediately after landing (#5278 option A).',
  },
  '@objectstack/plugin-security': { errors: 11, note: 'TS2739 x8, TS2740 x5, TS2345/TS2322/TS2741 x2 each -- incomplete literals. Re-measured 21 at 5ab08428, up from 20, and still 21 at e8db1a230 after the package gained a test file -- the file count moved, the error count did not (which is why the file count is derived here rather than written down, #5826).' },
  '@objectstack/formula': { errors: 17, note: 'TS2591 x6 (`process`), TS2345 x3, TS2352 x3, TS1470 x2, TS2339 x2. Re-measured 17 at 5ab08428, up from 12; the TS2591 half doubled, which is the missing `types:["node"]` again rather than five new defects.' },
  '@objectstack/trigger-record-change': { errors: 9, note: 'TS2353 x9 -- still the one unknown-property shape repeated, now in four files. Re-measured 9 at 5ab08428, up from 8.' },
  '@objectstack/verify': { errors: 8, note: 'TS2835 x4, TS7006 x4. Re-measured 8 at 5ab08428, up from 6; both classes are the NodeNext pair from the top-of-ledger note.' },
  '@objectstack/connector-mcp': { errors: 5, note: 'TS2339 x5. Re-measured 5 at 5ab08428, exact.' },
  '@objectstack/connector-openapi': { errors: 5, note: 'TS2339 x5. Re-measured 5 at 5ab08428, exact.' },
  '@objectstack/http-conformance': {
    errors: 3,
    note: 'TS2307 x2, TS2304 x1, TS2740 x1. Re-measured 4 at 5ab08428, up from 1. Worth knowing before '
      + 'anyone tries to graduate it: 2 of the 4 are reported inside node_modules `.d.ts` files '
      + '(@better-auth/core, @better-fetch/fetch), so this entry moves with the lockfile and not only with '
      + 'this package\'s own code. Raw `tsc --noEmit` counts are what every number in these ledgers means, '
      + 'so they are counted here rather than filtered out -- but they are not this package\'s debt to fix.',
  },
  '@objectstack/platform-objects': { errors: 3, note: 'TS2339 x2, TS7006 x1. Re-measured 3 at 5ab08428, exact.' },
  '@objectstack/plugin-sharing': { errors: 3, note: 'TS6133 x2, TS18048 x1. Re-measured 3 at 5ab08428, exact.' },
  '@objectstack/service-sms': { errors: 1, note: 'TS2493 x1, in transports.test.ts. Re-measured 1 at 5ab08428 and still 1 at e8db1a230, after two more hidden test files: #5773 added sms-manifest-providers.contract.test.ts and #2814 / PR #6042 added sms-daily-quota.test.ts. The file count moved twice while the error count did not -- both new files are type-clean with the exclusion lifted.' },
  '@objectstack/connector-rest': { errors: 1, note: 'TS6133 x1. Re-measured 1 at 5ab08428, exact.' },
};

// Repo-relative path -> why this test file's `@ts-expect-error` directives are
// still phantom. PINS_CHECKED's escape hatch, and the narrowest of the three
// ledgers on purpose: an unchecked pin is not "debt we measured", it is a
// retirement guard that reads as enforced and enforces nothing. A directive in
// one of these files can be DELETED with no gate noticing -- which is how
// #5286's 17 spec directives were found.
//
// Shrink-only, and closed: a file that starts carrying a pin while unchecked
// fails PINS_CHECKED rather than joining this list. The repair is the same one
// spec took -- put the file in a tsc program (drop the exclusion, widen
// `include`, or add a sibling `tsconfig.test.json` the typecheck script names)
// -- and then delete the entry, which RECONCILED forces anyway.
//
// EMPTY, and that is the intended end state: both seeds #5286 planted have been
// repaired and their entries deleted -- `packages/client` in #5449 (PR #5546),
// `packages/metadata-core/test/types.test.ts` in #5476, each by naming a sibling
// `tsconfig.test.json` in its `typecheck` script. A new entry here is not the
// route for the next such finding; PINS_CHECKED going red is.
const PHANTOM_PIN_DEBT = {};

/**
 * The `packages:` globs from pnpm-workspace.yaml. Blank lines and comments are
 * skipped rather than treated as the end of the list: stopping early would
 * drop members from the scan and report a clean run over a partial workspace.
 */
function workspaceGlobs() {
  const lines = readFileSync(join(ROOT, WORKSPACE_FILE), 'utf8').split(/\r?\n/);
  const start = lines.findIndex((l) => /^packages\s*:\s*$/.test(l));
  if (start === -1) throw new Error(`${WORKSPACE_FILE}: no top-level \`packages:\` block`);
  const globs = [];
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i].replace(/#.*$/, '').trimEnd();
    if (!line.trim()) continue;
    const m = line.match(/^\s+-\s+['"]?([^'"\s]+)['"]?\s*$/);
    if (m) {
      globs.push(m[1]);
      continue;
    }
    if (/^\S/.test(line)) break; // the next top-level key ends the block
  }
  if (globs.length === 0) throw new Error(`${WORKSPACE_FILE}: \`packages:\` block is empty`);
  return globs;
}

/**
 * One `tsconfig*.json` of a package, read with a tolerant parse -- these configs
 * carry `//` comments, and a parse failure must not silently read as "excludes
 * nothing" (that would turn TESTS_COVERED into a gate that passes on
 * unparseable input).
 *
 * `roots` come from the `include` glob prefixes (`src/**\/*` -> `src`); no
 * `include` at all means tsc walks the whole package directory, which is the
 * empty root.
 *
 * @returns {{file: string, roots: string[], excludesTests: boolean}}
 */
function readTsconfig(dir, file) {
  const raw = readFileSync(join(ROOT, dir, file), 'utf8').replace(/^\s*\/\/.*$/gm, '');
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new Error(`${dir}/${file} is not parseable, so its test coverage cannot be judged`, { cause });
  }
  const include = parsed.include ?? null;
  const roots = Array.isArray(include) && include.length > 0
    ? [...new Set(include.map((g) => g.split('*')[0].replace(/\/$/, '')).filter((p) => !p.includes('..')))]
    : [''];
  return {
    file,
    roots,
    excludesTests: (parsed.exclude ?? []).some((pattern) => TEST_GLOB.test(pattern)),
  };
}

/** Is `rel` (posix, relative to the package) inside this config's program? */
function configCovers(config, rel) {
  if (config.excludesTests && TEST_FILE.test(rel)) return false;
  return config.roots.some((root) => root === '' || rel === root || rel.startsWith(`${root}/`));
}

/**
 * Which tsconfig files does the `typecheck` script actually put in front of
 * tsc? Expanded through same-package `pnpm <script>` / `npm run <script>`
 * indirection, because a package that splits the work across two scripts is
 * still running both. A bare `tsc` reads `tsconfig.json`, so any mention of tsc
 * credits the default config; every other config must be NAMED (`-p
 * tsconfig.test.json`), which is what keeps a decorative sibling config from
 * reading as coverage (#5286).
 */
function configsNamedByTypecheck(scripts) {
  const visited = new Set();
  let text = '';
  const visit = (name, depth) => {
    if (depth > 4 || visited.has(name) || typeof scripts[name] !== 'string') return;
    visited.add(name);
    text += ` ${scripts[name]}`;
    for (const m of scripts[name].matchAll(/\b(?:pnpm(?:\s+run)?|npm\s+run|yarn(?:\s+run)?)\s+([\w:.-]+)/g)) {
      visit(m[1], depth + 1);
    }
  };
  visit('typecheck', 0);
  const named = new Set();
  for (const m of text.matchAll(/tsconfig[\w.-]*\.json/g)) named.add(m[0]);
  if (/\btsc\b/.test(text)) named.add('tsconfig.json');
  return named;
}

/**
 * Which tsc programs ACCOUNT for a package's test files -- the ones whose error
 * count somebody actually reads.
 *
 * Normally that is the set the `typecheck` script invokes. A package with NO
 * such script has no invoked program at all, but it is not therefore unmeasured:
 * `measureDebt` runs `tsc -p tsconfig.json`, so the primary config is what its
 * DEBT number was taken through, and a test file that config reads is counted
 * there rather than hidden. Answering "hidden" for every test file of every
 * DEBT package would move 353 files into the wrong ledger -- TEST_DEBT means
 * "src checks, tests are hidden" and DEBT already owns "nothing checks this".
 *
 * @returns {Array<{file: string, roots: string[], excludesTests: boolean}>}
 */
function accountedPrograms(configs, invoked) {
  if (invoked.length > 0) return invoked;
  const primary = configs.find((c) => c.file === 'tsconfig.json');
  return primary ? [primary] : [];
}

/**
 * The test files no accounted program reads -- TESTS_COVERED's subject, decided
 * per FILE rather than per config.
 *
 * The per-config form this replaces asked only whether some `exclude` named the
 * tests, so it saw a config that steered tsc AWAY from them and never a config
 * that had simply never steered tsc TOWARD them: a package with no `exclude` at
 * all and an `include` of `["src"]` beside a sibling `test/` tree reported as
 * fully covered while nothing read a line of it (#7353). Measured at the time:
 * `packages/cli` hid 56 test files carrying 188 raw errors and the headline
 * count did not know it existed.
 *
 * Asking it per file also makes PARTIAL coverage countable, which the old shape
 * could not express -- `packages/cli` puts 54 of its 110 test files under
 * `include` and 56 outside it, and the honest number is 56, not 0 and not 110.
 *
 * @param {string[]} testRels package-relative posix paths of every test file
 * @returns {string[]} the unread ones, in walk order
 */
function unreadTests(testRels, programs) {
  return testRels.filter((rel) => !programs.some((c) => configCovers(c, rel)));
}

/**
 * What this package's tsc programs read, and what they leave out.
 *
 * `hidesTests` is the TESTS_COVERED trigger and means "at least one of this
 * package's test files sits outside every program that accounts for it" -- by
 * an `exclude` that names it, or by an `include` that never reached it. A
 * package repaired the supported way (a sibling `tsconfig.test.json` named in
 * the script) is covered rather than eternally in debt, while a package that
 * merely OWNS such a file without invoking it is not (#5286).
 *
 * `pinFiles` is PINS_CHECKED's input: test files carrying a `@ts-expect-error`
 * directive that no invoked program compiles. The scan walks the whole package,
 * not just the include roots -- `packages/metadata-core/test/` sat outside
 * `include` with no exclusion naming it (until #5476 put it in a program), and
 * that is just as unchecked. PINS_CHECKED used to be the ONLY half that looked
 * outside `include`, which is why an unpinned test tree out there was reported
 * by neither: it collects `@ts-expect-error` files and nothing else.
 *
 * @returns {{hidesTests: boolean, testFiles: number, hiddenTests: string[], pinFiles: string[]}}
 */
function testCoverage(dir, scripts) {
  let configFiles = [];
  try {
    configFiles = readdirSync(join(ROOT, dir)).filter((f) => /^tsconfig[\w.-]*\.json$/.test(f)).sort();
  } catch {
    configFiles = [];
  }
  const configs = configFiles.map((file) => readTsconfig(dir, file));
  const named = configsNamedByTypecheck(scripts);
  const invoked = configs.filter((c) => named.has(c.file));

  // One walk of the whole package. Both halves need the same list now: the
  // hidden-file count is no longer confined to the include roots, because a
  // file outside them is precisely the case this invariant had been missing.
  const testRels = [];
  const pinned = new Set();
  const walk = (abs, rel, depth) => {
    let entries = [];
    try {
      entries = readdirSync(abs, { withFileTypes: true });
    } catch {
      return; // no such root, or unreadable -- nothing to hide either way
    }
    for (const entry of entries) {
      const child = join(abs, entry.name);
      const childRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name.startsWith('.')) continue;
        if (depth > 0 && existsSync(join(child, 'package.json'))) continue; // another package's problem
        walk(child, childRel, depth + 1);
      } else if (TEST_FILE.test(entry.name)) {
        testRels.push(childRel);
        if (PIN_DIRECTIVE.test(readFileSync(child, 'utf8'))) pinned.add(childRel);
      }
    }
  };
  walk(join(ROOT, dir), '', 0);

  const hiddenTests = unreadTests(testRels, accountedPrograms(configs, invoked));
  // PINS_CHECKED stays anchored to the INVOKED programs, not the accounted
  // ones: a pin's whole job is to go red in a check somebody runs, and the
  // `--re-measure` path a DEBT number comes from is not that check.
  const pinFiles = unreadTests([...pinned], invoked).map((rel) => posix.join(dir, rel));

  return {
    hidesTests: hiddenTests.length > 0,
    testFiles: hiddenTests.length,
    hiddenTests,
    pinFiles: pinFiles.sort(),
  };
}

/** Every workspace member as { name, dir, scripts, hasTsconfig, hidesTests, testFiles }. */
function workspacePackages() {
  const dirs = [];
  for (const glob of workspaceGlobs()) {
    // Every pattern in this repo is `<dir>` or `<dir>/*`. Anything richer
    // would silently resolve to nothing, so reject it rather than under-report.
    const star = glob.endsWith('/*');
    const base = star ? glob.slice(0, -2) : glob;
    if (base.includes('*')) {
      throw new Error(`${WORKSPACE_FILE}: pattern "${glob}" is richer than <dir> or <dir>/*; extend ${SELF}`);
    }
    const abs = join(ROOT, base);
    if (!existsSync(abs)) continue;
    const candidates = star ? readdirSync(abs).map((e) => posix.join(base, e)) : [base];
    for (const c of candidates) {
      if (existsSync(join(ROOT, c, 'package.json'))) dirs.push(c);
    }
  }
  return dirs.sort().map((dir) => {
    const manifest = JSON.parse(readFileSync(join(ROOT, dir, 'package.json'), 'utf8'));
    return {
      name: manifest.name ?? dir,
      dir,
      scripts: manifest.scripts ?? {},
      hasTsconfig: existsSync(join(ROOT, dir, 'tsconfig.json')),
      ...testCoverage(dir, manifest.scripts ?? {}),
    };
  });
}

/**
 * Pure verdict over an observed workspace state; the real run and the
 * self-test both go through here, so the semantics the fixtures prove are the
 * semantics the gate applies.
 *
 * @param {Array<{name: string, dir: string, scripts: Record<string,string>, hasTsconfig: boolean,
 *                hidesTests?: boolean, testFiles?: number, pinFiles?: string[]}>} packages
 * @param {{name: string, scripts: Record<string,string>}} root
 * @param {{ debt: Record<string, {errors: number, note?: string}>,
 *           exempt: Record<string, string>,
 *           testDebt: Record<string, {errors: number, note?: string}>,
 *           phantomPins: Record<string, string>,
 *           turboHasTask: boolean, ciInvokesTask: boolean, ciInvokesRoot: boolean }} state
 * @returns {string[]} problems, empty when the ratchet holds
 */
function evaluate(packages, root, state) {
  const problems = [];
  const byName = new Map(packages.map((p) => [p.name, p]));
  byName.set(root.name, root);

  for (const pkg of packages) {
    const script = pkg.scripts.typecheck;
    const inDebt = Object.hasOwn(state.debt, pkg.name);
    const inExempt = Object.hasOwn(state.exempt, pkg.name);

    // TESTS_COVERED, and its RECONCILED counterpart. Independent of whether the
    // package is covered or in DEBT: this is about what the tsconfig hides, not
    // about whether a script exists to run against it.
    const inTestDebt = Object.hasOwn(state.testDebt, pkg.name);
    if (pkg.hidesTests && pkg.testFiles > 0) {
      if (!inTestDebt) {
        problems.push(
          `${pkg.name} (${pkg.dir}): ${pkg.testFiles} of its test file(s) sit outside every tsc program that ` +
            `accounts for this package -- named by an \`exclude\`, or never reached by any \`include\` -- so ` +
            `the check reports green over source it never read (${TRACKING_ISSUE}). Drop the ` +
            `\`*.test.ts\`/\`*.spec.ts\` entry from \`exclude\`, widen \`include\` to reach the test tree, add a ` +
            `sibling \`tsconfig.test.json\` and name it in the \`typecheck\` script (the #5286 route, when the ` +
            `build config must keep the exclusion), or measure what surfaces and add a TEST_DEBT entry in ${SELF}.`,
        );
      } else {
        const entry = state.testDebt[pkg.name];
        if (!entry || typeof entry.errors !== 'number' || entry.errors <= 0) {
          problems.push(
            `${pkg.name}: TEST_DEBT entry has no measured error count -- put the files in a program, run ` +
              `\`tsc --noEmit\`, record the number, or put them in a program for good.`,
          );
        }
      }
    } else if (inTestDebt) {
      problems.push(
        `${pkg.name}: has a TEST_DEBT entry but ${pkg.testFiles === 0 ? 'has no test files' : 'no longer hides its tests'} -- ` +
          `it graduated; delete its entry from TEST_DEBT in ${SELF}.`,
      );
    }

    // PINS_CHECKED. A `@ts-expect-error` outside every invoked tsc program is a
    // retirement guard that cannot fail -- deleting the directive changes
    // nothing, which is the definition of a phantom check (${PIN_ISSUE}).
    for (const file of pkg.pinFiles ?? []) {
      if (!Object.hasOwn(state.phantomPins, file)) {
        problems.push(
          `${file}: carries a \`@ts-expect-error\` directive but no tsc program the \`typecheck\` script ` +
            `runs compiles it, so the directive is never evaluated -- delete the line and every gate stays ` +
            `green (${PIN_ISSUE}). Put the file in a program (drop the exclusion, widen \`include\`, or add a ` +
            `sibling \`tsconfig.test.json\` the typecheck script names), or replace the pin with a runtime ` +
            `assertion. PHANTOM_PIN_DEBT in ${SELF} is closed to new entries.`,
        );
      } else if (!String(state.phantomPins[file] ?? '').trim()) {
        problems.push(`${file}: PHANTOM_PIN_DEBT entry has no reason -- say why the pin is still unchecked.`);
      }
    }

    if (script !== undefined) {
      // REAL: the script must put tsc in front of the package's sources.
      if (!/\btsc\b/.test(script)) {
        problems.push(
          `${pkg.name} (${pkg.dir}): \`typecheck\` script does not invoke tsc ("${script}") -- ` +
            `a typecheck that never type-checks satisfies the letter of COVERED and nothing else.`,
        );
      }
      // RECONCILED: covered packages must not also sit in the ledger.
      if (inDebt) {
        problems.push(
          `${pkg.name}: declares \`typecheck\` but still has a DEBT entry -- it graduated; ` +
            `delete its entry from DEBT in ${SELF}.`,
        );
      }
      if (inExempt) {
        problems.push(
          `${pkg.name}: declares \`typecheck\` but still has an EXEMPT entry -- ` +
            `delete its entry from EXEMPT in ${SELF}.`,
        );
      }
      continue;
    }

    // COVERED: no script, so the ledger must own the gap -- with substance.
    if (inDebt) {
      const entry = state.debt[pkg.name];
      if (!entry || typeof entry.errors !== 'number' || entry.errors <= 0) {
        problems.push(
          `${pkg.name}: DEBT entry has no measured error count -- run its \`tsc --noEmit\`, ` +
            `record the number, or onboard it outright.`,
        );
      }
    } else if (inExempt) {
      if (!String(state.exempt[pkg.name] ?? '').trim()) {
        problems.push(`${pkg.name}: EXEMPT entry has no reason -- say why tsc cannot apply, or onboard it.`);
      }
    } else {
      problems.push(
        `${pkg.name} (${pkg.dir}): no \`typecheck\` script and no ledger entry. ` +
          `Add \`"typecheck": "tsc --noEmit"\` to its package.json (tsup/vitest never type-check, ` +
          `so without it nothing reads this package's types at all -- see ${TRACKING_ISSUE}). ` +
          `Only if the errors are too large to fix now: measure them and add a DEBT entry in ${SELF}.`,
      );
    }
  }

  // The root's own top-level TypeScript, covered via `typecheck:root` (its
  // `typecheck` slot is the workspace aggregator, asserted under RUNNABLE).
  const rootScript = root.scripts['typecheck:root'];
  const rootInDebt = Object.hasOwn(state.debt, root.name);
  const rootInExempt = Object.hasOwn(state.exempt, root.name);
  if (rootScript !== undefined) {
    if (!/\btsc\b/.test(rootScript)) {
      problems.push(`${root.name}: \`typecheck:root\` does not invoke tsc ("${rootScript}").`);
    }
    if (rootInDebt) {
      problems.push(
        `${root.name}: declares \`typecheck:root\` but still has a DEBT entry -- it graduated; ` +
          `delete its entry from DEBT in ${SELF}.`,
      );
    }
    if (rootInExempt) {
      problems.push(`${root.name}: declares \`typecheck:root\` but still has an EXEMPT entry -- delete it from ${SELF}.`);
    }
    if (!state.ciInvokesRoot) {
      problems.push(
        `.github/workflows/lint.yml never invokes \`typecheck:root\` -- the root's own ` +
          `TypeScript is declared covered but CI never reads it. Add the step.`,
      );
    }
  } else if (rootInDebt) {
    const entry = state.debt[root.name];
    if (!entry || typeof entry.errors !== 'number' || entry.errors <= 0) {
      problems.push(`${root.name}: DEBT entry has no measured error count.`);
    }
  } else if (rootInExempt) {
    if (!String(state.exempt[root.name] ?? '').trim()) {
      problems.push(`${root.name}: EXEMPT entry has no reason.`);
    }
  } else {
    problems.push(
      `${root.name} (workspace root): no \`typecheck:root\` script and no ledger entry -- ` +
        `the root's own top-level TypeScript (tsup.config.ts and friends) is in the audit too (${TRACKING_ISSUE}).`,
    );
  }

  // RECONCILED, other direction: ledger entries must point at live packages.
  for (const name of Object.keys(state.debt)) {
    if (!byName.has(name)) {
      problems.push(`DEBT entry for "${name}" names no workspace package -- remove it from ${SELF}.`);
    }
  }
  for (const name of Object.keys(state.exempt)) {
    if (!byName.has(name)) {
      problems.push(`EXEMPT entry for "${name}" names no workspace package -- remove it from ${SELF}.`);
    }
  }
  for (const [name, entry] of Object.entries(state.testDebt)) {
    if (!byName.has(name)) {
      problems.push(`TEST_DEBT entry for "${name}" names no workspace package -- remove it from ${SELF}.`);
      continue;
    }
    // The ledger is closed to a hand-written file count (#5826). `errors` has to
    // be recorded because knowing it means running the compiler; the number of
    // hidden test files does NOT -- `testCoverage()` counts it on every run, in
    // under a second, and TESTS_COVERED already judges by that live count. A
    // copy beside it is a second source of truth for a fact the gate holds, and
    // it drifted exactly as #5278's `errors` did: 12 of 19 entries were stale
    // when this was measured, all understated, the worst by 53% (runtime 66 vs
    // 101 real files). Deriving it removes the drift by construction; this
    // branch is what stops the copy from being pasted back in.
    if (entry && typeof entry === 'object' && Object.hasOwn(entry, 'tests')) {
      problems.push(
        `${name}: TEST_DEBT entry carries a hand-written \`tests\` count -- that number is DERIVED from ` +
          `this run's own scan (\`testCoverage()\` already counts the hidden files to decide TESTS_COVERED), ` +
          `so a copy here is a second source of truth that drifts silently and nothing compares. ` +
          `Delete the field; the summary reports the live count (#5826).`,
      );
    }
  }
  // RECONCILED for PINS_CHECKED: an entry survives only while the file really
  // is an unchecked pin. Once it is compiled -- or loses its directives, or
  // moves -- the entry is a claim about nothing, and a worklist that outlives
  // its work is the failure mode this repo keeps paying for.
  const phantomSeen = new Set(packages.flatMap((p) => p.pinFiles ?? []));
  for (const file of Object.keys(state.phantomPins)) {
    if (!phantomSeen.has(file)) {
      problems.push(
        `PHANTOM_PIN_DEBT entry for "${file}" is no longer an unchecked pin (compiled now, or the file/` +
          `directives are gone) -- delete it from ${SELF}. That is the ratchet: this list only shrinks.`,
      );
    }
  }

  // RUNNABLE: coverage that nothing executes is not coverage.
  if (!state.turboHasTask) {
    problems.push(
      `turbo.json does not declare a \`typecheck\` task -- \`turbo run typecheck\` runs nothing, ` +
        `so every per-package script above is dead. Restore the task (dependsOn ^build).`,
    );
  }
  if (!/\bturbo run typecheck\b/.test(root.scripts.typecheck ?? '')) {
    problems.push(
      `the root \`typecheck\` script must aggregate the workspace (\`turbo run typecheck\`, ` +
        `the build/test convention) so one command runs every declared check locally.`,
    );
  }
  if (!state.ciInvokesTask) {
    problems.push(
      `.github/workflows/lint.yml does not invoke \`turbo run typecheck\` -- the per-package ` +
        `scripts exist but CI never runs them (#4203 is the history of exactly this). Restore the step.`,
    );
  }

  return problems;
}

/**
 * How many test files the TEST_DEBT packages are hiding RIGHT NOW -- summed from
 * what this run's own scan counted, never from a number written down beside the
 * entry (#5826).
 *
 * This is the one summary figure the gate can know for free: `testCoverage()`
 * walks each package's include roots on every run to decide TESTS_COVERED, so
 * `pkg.testFiles` is already in hand before the summary is printed. A recorded
 * copy could only ever agree with it by coincidence -- adding a test file to an
 * excluded package moves the real count and nothing asks the ledger to follow.
 *
 * Sums over PACKAGES rather than over ledger entries, so an entry naming no live
 * package contributes nothing instead of throwing; RECONCILED has already made
 * that state a failure, and the summary only prints after the verdict is clean.
 *
 * @param {Array<{name: string, testFiles?: number}>} packages
 * @param {Record<string, unknown>} testDebt
 * @returns {number}
 */
function hiddenTestFiles(packages, testDebt) {
  return packages.reduce(
    (sum, pkg) => (Object.hasOwn(testDebt, pkg.name) ? sum + (pkg.testFiles ?? 0) : sum),
    0,
  );
}

// ---------------------------------------------------------------------------
// MEASURED -- the re-measure half (#5278).
//
// Everything above reads package.json / tsconfig.json and finishes in under a
// second, which is why it sits before the build in lint.yml's typecheck job.
// Everything below runs the real compiler and therefore needs each package's
// DEPENDENCIES built (tsc resolves workspace imports through `dist/*.d.ts`) --
// so it is opt-in behind `--re-measure` and wired into the same job AFTER its
// build step, rather than made the default and paid for on every gate run.
// ---------------------------------------------------------------------------

/**
 * One `tsc --noEmit` diagnostic line, counted the way every number in the
 * ledgers above was originally counted (`| grep -c "error TS"`). A diagnostic's
 * elaboration lines are INDENTED and carry no code of their own, so anchoring
 * at a non-space start is what keeps a single 5-line TS2322 from counting five
 * times. Global diagnostics (`error TS5055: ...`) have no file prefix at all and
 * still count -- they are errors the same as any other.
 */
const TSC_ERROR_LINE = /^(?!\s)(?:.*\s)?error TS\d+: /;

/**
 * Diagnostics that mean the MEASUREMENT failed, not that the package has debt.
 * A missing/unreadable project or an empty file list would otherwise be counted
 * as one tidy little error and silently *lower* a package's number -- a gate
 * that measures nothing and reports an improvement is worse than no gate.
 *
 * TS2688 ("Cannot find type definition file for 'node'") is here for the same
 * reason and was measured, not reasoned about (#8218). A generated project whose
 * `typeRoots` do not resolve loses every global the package compiles against, so
 * tsc stops at the type-library entry point and prints ONE diagnostic:
 * packages/cli measured 188 with `typeRoots` resolving and **1** without, same
 * tree, same sources. Counted as debt that is a 187-error improvement handed to
 * the ledger by a broken measurement -- and `--lower` would then write it down.
 * No ledger `note` in this file records a TS2688, and none can while this line
 * stands: a package that really cannot resolve its own type libraries has a
 * broken tsconfig, which is a defect to fix rather than a number to freeze.
 */
const TSC_SETUP_ERROR = /\berror TS(5058|5083|6053|18003|5012|2688)\b/;

/**
 * Temp project used to lift a tsconfig's own test exclusion. Written into a
 * fresh `os.tmpdir()` directory -- never anywhere inside the repository. See
 * `remeasureProject` for why that costs a page of path rewriting, and what the
 * in-tree version cost instead.
 */
const REMEASURE_CONFIG = 'tsconfig.debt-remeasure.json';
const REMEASURE_ISSUE = 'https://github.com/objectstack-ai/objectstack/issues/5278';
const SURPLUS_ISSUE = 'https://github.com/objectstack-ai/objectstack/issues/6376';

// ---------------------------------------------------------------------------
// BUILT CLOSURE -- the precondition every number in both ledgers is measured
// under, and until #6376 the only one nothing checked.
//
// tsc resolves a workspace import through the DEPENDENCY'S BUILT `dist/*.d.ts`,
// never through its sources (no `paths` mapping exists anywhere in this repo).
// So an unbuilt closure does not make the measurement fail -- it makes it
// MEAN SOMETHING ELSE, and `--re-measure` used to record the result either way.
// Measured on packages/lint at 1818998, same tree, same commit, twice:
//
//   closure built    19  (TS7006 x11, TS2835 x4, TS6059 x4)
//   closure unbuilt  147 (TS2307 x71 -- cannot find module -- then the cascade
//                         it causes: TS7006 x38, TS18046 x20, ...)
//
// 7.7x, and NEITHER run printed a warning. The direction is not fixed either:
// an unresolved import degrades every symbol it names to `any`, which INVENTS
// TS2307/TS7006 while ERASING the structural mismatches (TS2345/TS2322) that
// are usually the real debt -- driver-mongodb's 33 TS2345 were exactly such
// mismatches and would have measured 0 against an unbuilt `@objectstack/spec`.
// So a stale closure can hand an entry a number far above its truth (a false
// red, loud) or far below it (a false ceiling, silent, and the ledger would
// then be tightened onto a number nobody can reproduce).
//
// This is not theoretical bookkeeping: on 2026-08-08 three readings of ONE
// entry (`@objectstack/lint`) were in circulation between parallel agents in a
// single day -- 19, 39 and 147 -- and the ledger's whole discipline is
// "recorded vs measured". A quantity that is not reproducible cannot carry a
// policy. lint.yml already builds the closure before invoking this gate; what
// was missing is that NOTHING SAID SO, so a local run silently measured a
// different world. Now it refuses instead.
//
// Deliberately a PRECONDITION (does each workspace dependency have a built type
// entry point on disk?) rather than a scan of tsc's output for TS2307: several
// ledger entries legitimately RECORD unresolved-module errors as part of their
// debt -- the workspace root's note names TS2307 x17 -- and a gate that cannot
// tell a recorded defect from a broken measurement would refuse the very
// entries it exists to measure.
//
// PRESENT is not CURRENT (#8271). The precondition above asks whether a
// `dist/*.d.ts` EXISTS, which is silent about whether it describes today's
// source -- and the stale case is worse than the missing one, because nothing
// fires. Measured: #8235 was filed in good faith as a `priority:p0` main-red
// stanch off four errors (TS2614/TS2339/TS7006) this gate reported locally
// against a `dist/` predating #8198, while CI's own re-measure was green on two
// consecutive runs; the errors were not in the source and never had been. The
// mirror direction is quieter and worse: a stale artifact can HIDE real drift
// until CI finds it, which is the entire reason to run this locally.
//
// So the closure is now REFRESHED, not merely asserted -- `refreshBuiltClosure`
// runs the same turbo command with the same filters lint.yml runs immediately
// before this gate, which is why CI has never seen this failure and a local run
// always could. Three measurements decided that shape over "detect staleness and
// refuse", which was the other direction on the card:
//
//   9.5s    a closure build with everything already current (70/70 turbo cache
//           hits), against a ~257s re-measure -- under 4% to remove the variable
//   3m2s    ONE ledgered package's 7-task closure built COLD, which is why the
//           refusal above still owns the nothing-is-built case rather than
//           silently disappearing for minutes on a gate people run before pushing
//   3 of 3  packages that an mtime read flagged as stale in the first worktree
//           it was pointed at were false alarms (2 dated by a `*.test.ts` that
//           no `dist/` is generated from, 1 by a `git checkout` that rewrote a
//           file to byte-identical content) -- an error rate that is fine for a
//           backstop and disqualifying for a refusal, because refusing costs a
//           4-minute lap and the rebuild it would demand costs 9.5 seconds
//
// turbo decides what is genuinely out of date by hashing inputs, and its cache
// replay rewrites the outputs it restores, so a refreshed closure reads as
// current afterwards. The mtime read survives only as the backstop over what
// those filters do not reach.
// ---------------------------------------------------------------------------

/**
 * Every root-export type entry point a manifest declares, from `types` /
 * `typings` and from any `exports` condition naming a declaration file. Pure
 * over the manifest so the self-test can pin the shapes this workspace actually
 * uses (a flat `types`, a conditional `exports` map, a package that declares
 * none at all -- `@objectstack/console` publishes a prebuilt artifact and has
 * no type entry point, and must never read as "unbuilt").
 *
 * @param {Record<string, unknown>} manifest
 * @returns {string[]}
 */
function declaredTypeEntries(manifest) {
  const found = new Set();
  const collect = (node, depth) => {
    if (depth > 6 || node == null) return;
    if (typeof node === 'string') {
      if (/\.d\.[cm]?ts$/.test(node)) found.add(node.replace(/^\.\//, ''));
      return;
    }
    if (typeof node !== 'object') return;
    for (const value of Object.values(node)) collect(value, depth + 1);
  };
  for (const key of ['types', 'typings']) collect(manifest[key], 0);
  collect(manifest.exports, 0);
  return [...found].sort();
}

/**
 * Every workspace package reachable from the ledgered packages' dependencies.
 * Pure over a described graph, so the traversal (transitive, cycle-safe) is
 * pinned without a filesystem.
 *
 * The ROOTS themselves are never members: measuring a package reads its own
 * SOURCES, so its own `dist` is irrelevant to its own number. A root appears
 * only when some other ledgered package depends on it, which is the case where
 * its `dist` really is the input.
 *
 * @param {string[]} roots ledgered package names
 * @param {Map<string, {deps: string[]}>} graph
 * @returns {string[]} sorted names
 */
function closureMembers(roots, graph) {
  const seen = new Set();
  const visit = (name) => {
    if (seen.has(name)) return;
    seen.add(name);
    const node = graph.get(name);
    if (!node) return; // not a workspace member -- node_modules, not our build
    for (const dep of node.deps) visit(dep);
  };
  for (const root of roots) {
    for (const dep of graph.get(root)?.deps ?? []) visit(dep);
  }
  return [...seen].filter((name) => graph.has(name)).sort();
}

/**
 * Which packages in that closure have no built type entry point at all. Pure --
 * `built` is decided by the caller's fs read -- and blind to a package that
 * declares no type entry point in the first place.
 *
 * @param {string[]} roots ledgered package names
 * @param {Map<string, {deps: string[], typeEntries: string[], built: boolean}>} graph
 * @returns {string[]} sorted names
 */
function unbuiltClosure(roots, graph) {
  return closureMembers(roots, graph).filter((name) => {
    const node = graph.get(name);
    return node.typeEntries.length > 0 && !node.built;
  });
}

/**
 * Which packages in that closure have a type entry point that is OLDER than the
 * sources it is generated from -- present, so `unbuiltClosure` waves it through,
 * and describing a package that no longer exists (#8271).
 *
 * Same shape and the same purity as its sibling: `stale` is the caller's fs
 * read, this function only walks. A package with no type entry point on disk is
 * `unbuiltClosure`'s finding, never this one's -- reporting it twice would name
 * one package in two different remedies.
 *
 * @param {string[]} roots ledgered package names
 * @param {Map<string, {deps: string[], typeEntries: string[], built: boolean, stale?: boolean}>} graph
 * @returns {string[]} sorted names
 */
function staleClosure(roots, graph) {
  return closureMembers(roots, graph).filter((name) => {
    const node = graph.get(name);
    return node.typeEntries.length > 0 && node.built && node.stale === true;
  });
}

/**
 * Whether a file name is one a package's `dist/*.d.ts` can be generated from.
 * Named, rather than inlined into the walk below, so the self-test asserts the
 * predicate the walk actually applies instead of a copy of it.
 *
 * @param {string} name basename
 */
function isBuildSource(name) {
  return SOURCE_FILE.test(name) && !TEST_FILE.test(name);
}

/**
 * The newest mtime among the TypeScript sources a package's `dist/*.d.ts` is
 * generated from, or 0 when it has none.
 *
 * Deliberately narrow on both axes, because every file it reads that cannot
 * reach a declaration file is a false "your build is stale":
 *   - `src/` when there is one, since that is this workspace's build root, and
 *     a package-wide walk would let a README or a fixture date the build;
 *   - `.ts`/`.tsx`/`.mts`/`.cts` only, and never a `*.test.ts` / `*.spec.ts` --
 *     no test file is reachable from a package's entry point, so none of them
 *     can change the emitted types. Measured before this exclusion existed:
 *     3 packages read as stale in a worktree where 2 of the 3 were flagged by
 *     nothing but a test file (driver-sqlite-wasm by
 *     sqlite-wasm-cross-field-conformance.test.ts, service-analytics by
 *     __tests__/cross-field-engine-fallback.test.ts).
 *
 * @param {string} dir package directory, repo-relative
 * @returns {number} epoch ms
 */
function newestSourceMtime(dir) {
  const from = existsSync(join(ROOT, dir, 'src')) ? join(ROOT, dir, 'src') : join(ROOT, dir);
  let newest = 0;
  const walk = (abs) => {
    let entries;
    try {
      entries = readdirSync(abs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist') continue;
      const child = join(abs, entry.name);
      if (entry.isDirectory()) {
        walk(child);
        continue;
      }
      if (!isBuildSource(entry.name)) continue;
      const { mtimeMs } = statSync(child);
      if (mtimeMs > newest) newest = mtimeMs;
    }
  };
  walk(from);
  return newest;
}

/**
 * The observed build graph: every workspace member, its `workspace:` deps
 * (runtime, dev and peer -- a hidden test layer imports all three), whether any
 * type entry point it declares exists on disk, and whether the ones that do
 * predate the sources they are generated from.
 *
 * `stale` compares against the OLDEST existing entry, not the newest: a package
 * that declares `dist/index.d.ts` and `dist/index.d.mts` has both written by one
 * build, so the older of the two is when that build actually ran.
 *
 * @param {Array<{name: string, dir: string}>} packages
 * @returns {Map<string, {deps: string[], typeEntries: string[], built: boolean, stale: boolean}>}
 */
function workspaceBuildGraph(packages) {
  const graph = new Map();
  for (const pkg of packages) {
    let manifest;
    try {
      manifest = JSON.parse(readFileSync(join(ROOT, pkg.dir, 'package.json'), 'utf8'));
    } catch {
      continue;
    }
    const deps = [];
    for (const field of ['dependencies', 'devDependencies', 'peerDependencies']) {
      for (const [name, range] of Object.entries(manifest[field] ?? {})) {
        if (typeof range === 'string' && range.startsWith('workspace:')) deps.push(name);
      }
    }
    const typeEntries = declaredTypeEntries(manifest);
    const onDisk = typeEntries.filter((entry) => existsSync(join(ROOT, pkg.dir, entry)));
    const builtAt = onDisk.length > 0
      ? Math.min(...onDisk.map((entry) => statSync(join(ROOT, pkg.dir, entry)).mtimeMs))
      : 0;
    graph.set(pkg.name, {
      deps: [...new Set(deps)].sort(),
      typeEntries,
      built: onDisk.length > 0,
      stale: onDisk.length > 0 && newestSourceMtime(pkg.dir) > builtAt,
    });
  }
  return graph;
}

/**
 * Rebuild the ledgered packages' dependency closure, with the same command and
 * the same filters `lint.yml` runs immediately before this gate. Parity is the
 * whole point: two different build commands are two different worlds, and the
 * ledger's discipline is that a number is reproducible.
 *
 * turbo decides what is actually out of date by hashing inputs, which is
 * strictly better than the mtime read below and is why this runs FIRST and the
 * freshness check is only a backstop over what it leaves behind.
 */
function refreshBuiltClosure() {
  const bin = join(ROOT, 'node_modules', '.bin', 'turbo');
  if (!existsSync(bin)) {
    throw new Error(`--re-measure needs the workspace's own turbo at ${bin}; run \`pnpm install\` first.`);
  }
  const args = ['run', 'build', '--filter=./packages/*', '--filter=./packages/*/*'];
  const run = spawnSync(bin, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (run.error) throw new Error(`the closure build could not be run: ${run.error.message}`);
  if (run.status !== 0) {
    const output = `${run.stdout ?? ''}${run.stderr ?? ''}`.trim();
    throw new Error(
      `--re-measure cannot run: the ledgered packages' dependency closure does not build, so there is no `
        + `world to measure against. Fix the build first -- every number in DEBT and TEST_DEBT is measured `
        + `with tsc resolving workspace imports through each dependency's built \`dist/*.d.ts\`.\n`
        + `  ${bin} ${args.join(' ')}\n${output.slice(-4000)}`,
    );
  }
}

/** @param {string} output */
function countTscErrors(output) {
  let n = 0;
  for (const line of output.split(/\r?\n/)) if (TSC_ERROR_LINE.test(line)) n++;
  return n;
}

/**
 * Run the repo's own tsc over one project and return its raw error count.
 * `--pretty false` so the count does not depend on whether a TTY is attached;
 * cwd is ROOT so reported paths are repo-relative however the gate was invoked.
 *
 * @param {string} project path to a tsconfig -- repo-relative for the ledgered
 *   packages' own configs, absolute for the generated re-measure project, which
 *   lives outside the repo entirely
 * @returns {number}
 */
function tscErrorCount(project) {
  const bin = join(ROOT, 'node_modules', '.bin', 'tsc');
  if (!existsSync(bin)) {
    throw new Error(`--re-measure needs the workspace's own tsc at ${bin}; run \`pnpm install\` first.`);
  }
  const run = spawnSync(bin, ['--noEmit', '--pretty', 'false', '-p', project], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  if (run.error) throw new Error(`tsc could not be run for ${project}: ${run.error.message}`);
  const output = `${run.stdout ?? ''}${run.stderr ?? ''}`;
  if (TSC_SETUP_ERROR.test(output)) {
    throw new Error(`tsc could not read ${project} -- the measurement is invalid, not zero:\n${output.trim()}`);
  }
  const errors = countTscErrors(output);
  // Exit 0 means a clean program; anything else must have produced diagnostics
  // we recognised. If it did not, tsc failed in a way this parser cannot see,
  // and reporting 0 would quietly hand the package a graduation certificate.
  if (run.status !== 0 && errors === 0) {
    throw new Error(
      `tsc exited ${run.status} for ${project} but printed no recognisable diagnostics -- ` +
        `refusing to record 0:\n${output.trim().slice(0, 2000)}`,
    );
  }
  return errors;
}

/**
 * The DEBT number: what the package's OWN config reports today, which is exactly
 * what `pnpm --filter <pkg> exec tsc --noEmit` would print for an author sizing
 * the package up.
 */
function measureDebt(dir) {
  // `dir` is '' for the workspace root, and posix.join('', 'tsconfig.json')
  // is already 'tsconfig.json' -- no special case needed.
  return tscErrorCount(posix.join(dir, 'tsconfig.json'));
}

/**
 * What the extends chain above one package's `tsconfig.json` already decides for
 * itself. Two facts, and both of them are only interesting because the generated
 * project below lives OUTSIDE the repository:
 *
 *   `include`   whether anything in the chain selects files at all. If nothing
 *               does, tsc falls back to `**\/*` resolved against the directory of
 *               the config it was handed -- which used to be the package and is
 *               now a temp dir holding one file.
 *   `typeRoots` whether the chain names them explicitly. If it does, they are
 *               already absolute-by-origin and the generated project must not
 *               override them.
 *
 * `files` counts as selecting: a chain that declares `files` and no `include`
 * compiles exactly those, and adding an `include` would widen the program.
 *
 * Relative `extends` only -- which is every one in this workspace. A bare
 * specifier (`@tsconfig/node22/tsconfig.json`) stops the walk and reads as
 * "declares neither", the conservative answer for shared bases that carry
 * `compilerOptions` and nothing else.
 *
 * @returns {{selectsFiles: boolean, declaresTypeRoots: boolean}}
 */
function tsconfigChainFacts(dir) {
  let configAbs = join(ROOT, dir, 'tsconfig.json');
  const facts = { selectsFiles: false, declaresTypeRoots: false };
  for (let depth = 0; depth < 8; depth++) {
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(configAbs, 'utf8').replace(/^\s*\/\/.*$/gm, ''));
    } catch {
      return facts;
    }
    if (Array.isArray(parsed.include) && parsed.include.length > 0) facts.selectsFiles = true;
    if (Array.isArray(parsed.files)) facts.selectsFiles = true;
    if (parsed.compilerOptions?.typeRoots !== undefined) facts.declaresTypeRoots = true;
    const next = parsed.extends;
    if (typeof next !== 'string' || !next.startsWith('.')) return facts;
    configAbs = resolve(configAbs, '..', next.endsWith('.json') ? next : `${next}.json`);
  }
  return facts;
}

/**
 * The default `typeRoots` tsc would have computed for a config sitting IN the
 * package: every `node_modules/@types` from the package directory up. Stopped at
 * the repo root on purpose -- tsc would keep walking to `/`, and a measurement
 * that changes with whatever is installed above the checkout is not a
 * measurement. Nothing above ROOT resolves in CI either way.
 *
 * @param {string} pkgAbs absolute, posix-separated package directory
 * @param {string} rootAbs absolute, posix-separated repo root
 * @returns {string[]} outermost-last, the order tsc searches
 */
function defaultTypeRoots(pkgAbs, rootAbs) {
  const roots = [];
  let cursor = pkgAbs;
  for (let depth = 0; depth < 12; depth++) {
    roots.push(`${cursor}/node_modules/@types`);
    if (cursor === rootAbs) break;
    const parent = cursor.slice(0, cursor.lastIndexOf('/'));
    if (!parent || parent === cursor) break;
    cursor = parent;
  }
  return roots;
}

/**
 * The generated re-measure project, pure over one package's own tsconfig so the
 * self-test can pin the property the whole design rests on: EVERY path it emits
 * is absolute and rooted at the package.
 *
 * It has to be, because the file is written into `os.tmpdir()` rather than
 * beside the config it extends (#8218). The old sibling-in-the-package-directory
 * placement made the relative paths free, and charged for them somewhere else:
 * the scratch file sat in a TRACKED directory, matched by no `.gitignore` rule,
 * for as long as that package's tsc ran -- around 250s across the ledger. Any
 * `git add -A` in the same worktree during that window staged it, which is how a
 * 71-line generated tsconfig reached a real commit, and no crash was required.
 * The `finally` that removes it was never the gap; the ADDRESS was.
 *
 * What the move costs, item by item -- each one is a path tsc would otherwise
 * resolve against the temp dir:
 *
 *   `extends`     absolute, so the chain still starts at the real config. Paths
 *                 declared UP that chain keep resolving against the file that
 *                 declared them, which is why the package's own `include`,
 *                 `outDir` and `rootDir` need no help here.
 *   `exclude`     absolutised: these patterns are re-declared HERE, so they
 *                 originate in this file and would otherwise mean `/tmp/x/dist`.
 *   `include`     same, and additionally never left implicit -- see
 *                 `tsconfigChainFacts`.
 *   `rootDir`     absolute for the same reason as `exclude`.
 *   `typeRoots`   not a re-declared path at all, and the one that bites. tsc
 *                 derives the default from the directory of the ROOT config
 *                 file, so from a temp dir `types: ["node"]` resolves to
 *                 nothing: packages/cli measures 188 with them and 1 without.
 *                 Reconstructed here, and TS2688 joined TSC_SETUP_ERROR above so
 *                 the next way this breaks is loud instead of a free 187.
 *
 * Dropping exclusions is only half of un-hiding, because only half of hiding is
 * an exclusion (#7353). A package whose `include` never named its `test/` tree
 * has nothing to drop, and this measured its src twice over and called that the
 * test layer's number. `hiddenTests` names the files the observation half found
 * unread, so they are added to `include` ONE FILE AT A TIME rather than as a
 * directory glob -- `e2e/**\/*` would have pulled `e2e/global-setup.ts` into
 * app-showcase's measurement and billed the test layer 6 errors from a file that
 * is not a test.
 * (historical: until #8062 / PR #8178, app-showcase held the narrow
 * `e2e/**\/*.spec.ts` glob for exactly this reason. That card fixed the 6
 * errors at their source instead and moved the package to the wholesale
 * `e2e/**\/*` glob directly, so `global-setup.ts` is now in the program and
 * type-checks clean. The general point stands regardless: widen a hidden test
 * layer one file at a time and measure each addition, because a wholesale glob
 * can bill the layer for a non-test file it never asked to cover.)
 *
 * `rootDir` goes with them. It is `src` in most of these packages, so widening
 * `include` past it makes tsc answer with one TS6059 per added file and nothing
 * else -- packages/cli measured 56 TS6059 that way and 188 real errors with
 * `rootDir` neutralised. Under `--noEmit` there is no output layout for it to
 * protect, so a TS6059 here is a diagnostic about this generated config rather
 * than about the package, and counting it would be measuring the tape measure.
 *
 * @param {object} input
 * @param {string} input.pkgAbs absolute, posix-separated package directory
 * @param {string} input.rootAbs absolute, posix-separated repo root
 * @param {object} input.parsed the package's own parsed `tsconfig.json`
 * @param {string[]} input.unreachable package-relative test files its `include` cannot reach
 * @param {{selectsFiles: boolean, declaresTypeRoots: boolean}} input.chain
 * @returns {object} the project to serialise
 */
function remeasureProject({ pkgAbs, rootAbs, parsed, unreachable, chain }) {
  const absolutise = (p) => (p.startsWith('/') ? p : posix.join(pkgAbs, p));
  const kept = (parsed.exclude ?? []).filter((pattern) => !TEST_GLOB.test(pattern));
  const project = {
    extends: `${pkgAbs}/tsconfig.json`,
    exclude: kept.map(absolutise),
  };
  const compilerOptions = {};

  // Only the files this config's OWN `include` cannot reach need adding; the
  // ones it already selects are back in the program the moment `exclude` stops
  // subtracting them, and re-listing those would say nothing.
  const include = Array.isArray(parsed.include) && parsed.include.length > 0 ? parsed.include : null;
  if (include) {
    project.include = (unreachable.length > 0 ? [...include, ...unreachable] : include).map(absolutise);
    if (unreachable.length > 0) compilerOptions.rootDir = pkgAbs;
  } else if (!chain.selectsFiles) {
    project.include = [`${pkgAbs}/**/*`];
  }

  if (!chain.declaresTypeRoots) compilerOptions.typeRoots = defaultTypeRoots(pkgAbs, rootAbs);
  if (Object.keys(compilerOptions).length > 0) project.compilerOptions = compilerOptions;
  return project;
}

/**
 * The TEST_DEBT number: what the package reports once its tsconfig stops
 * steering tsc away from its own tests -- AND once it starts steering tsc toward
 * the ones it had merely never reached.
 *
 * The project is `remeasureProject`'s, and it is written into a fresh temp
 * directory that this function owns and removes. Nothing is created inside the
 * repository at any point, so there is no window in which `git status`, `git add
 * -A`, a `git clean`, an editor's file watcher or a parallel agent can see a
 * generated artifact in a tracked directory -- and no `tsconfig.*.json` for this
 * script's own next-run scan to trip over either. The cleanup below is now
 * housekeeping rather than the only thing standing between a scratch file and a
 * commit: a `finally` covers a throw and a non-zero exit, and covers neither a
 * SIGKILL nor a cancelled CI step, which is what an in-tree address needed it to.
 *
 * @param {string[]} hiddenTests package-relative paths of the unread test files
 */
function measureTestDebt(dir, hiddenTests = []) {
  const rootAbs = ROOT.replaceAll('\\', '/').replace(/\/$/, '');
  const pkgAbs = join(ROOT, dir).replaceAll('\\', '/').replace(/\/$/, '');
  const parsed = JSON.parse(
    readFileSync(join(ROOT, dir, 'tsconfig.json'), 'utf8').replace(/^\s*\/\/.*$/gm, ''),
  );
  const { roots } = readTsconfig(dir, 'tsconfig.json');
  const unreachable = hiddenTests.filter(
    (rel) => !roots.some((root) => root === '' || rel === root || rel.startsWith(`${root}/`)),
  );
  const project = remeasureProject({
    pkgAbs,
    rootAbs,
    parsed,
    unreachable,
    chain: tsconfigChainFacts(dir),
  });

  const holder = mkdtempSync(join(tmpdir(), 'objectstack-debt-remeasure-'));
  const configPath = join(holder, REMEASURE_CONFIG);
  writeFileSync(configPath, `${JSON.stringify(project, null, 2)}\n`);
  try {
    return tscErrorCount(configPath);
  } finally {
    rmSync(holder, { force: true, recursive: true });
  }
}

/**
 * Re-run every ledger number. Sequential on purpose: the ledgered packages are
 * the big ones, and N parallel tsc processes on a 2-core runner trade wall clock
 * for an OOM risk on the job that also just built the whole workspace.
 *
 * @returns {Array<{ledger: 'DEBT'|'TEST_DEBT', name: string, dir: string, recorded: number, actual: number}>}
 */
function measureLedgers(packages, rootName, state) {
  const dirOf = new Map(packages.map((p) => [p.name, p.dir]));
  dirOf.set(rootName, ''); // the workspace root is a member like any other
  // The observation half already walked every package; TEST_DEBT's measurement
  // needs the file list it produced, not a second walk that could disagree.
  const hiddenOf = new Map(packages.map((p) => [p.name, p.hiddenTests ?? []]));

  // BUILT CLOSURE, checked ONCE for the whole ledger rather than per entry: an
  // unbuilt dependency invalidates every number that resolves through it, so
  // there is nothing useful to report entry by entry, and 34 sequential tsc
  // runs against the wrong world is four minutes spent measuring nothing.
  const ledgered = [...new Set([...Object.keys(state.debt), ...Object.keys(state.testDebt)])]
    .filter((name) => dirOf.has(name));
  const unbuilt = unbuiltClosure(ledgered, workspaceBuildGraph(packages));
  if (unbuilt.length > 0) {
    throw new Error(
      `--re-measure cannot run: ${unbuilt.length} workspace dependenc(ies) of the ledgered packages have `
        + `no built type entry point on disk -- ${unbuilt.join(', ')}.\n`
        + `Every number in DEBT and TEST_DEBT is measured with tsc resolving workspace imports through each `
        + `dependency's built \`dist/*.d.ts\`, so measuring now would not fail, it would silently measure a `
        + `DIFFERENT WORLD: packages/lint reports 19 with its closure built and 147 without (TS2307 x71 plus `
        + `the implicit-any cascade), same tree, same commit. The error is unbounded in BOTH directions -- an `
        + `unresolved import invents TS2307/TS7006 and erases the structural mismatches that are usually the `
        + `real debt -- so a number recorded from here is not this package's debt and must not enter the `
        + `ledger (${SURPLUS_ISSUE}).\n`
        + `Build the closure first, exactly as lint.yml does before this step:\n`
        + `  pnpm exec turbo run build --filter='./packages/*' --filter='./packages/*/*'`,
    );
  }

  // PRESENT is not CURRENT (#8271). Every dependency having SOME `dist/*.d.ts`
  // says nothing about whether it describes today's source, and the stale case
  // is the silent one: the refusal above never fires, tsc resolves through an
  // artifact of a package that no longer exists, and the drift it reports is
  // not in the source at all. So the closure is refreshed rather than merely
  // asserted -- the same command, with the same filters, that lint.yml runs
  // immediately before this gate, which is why CI has never seen this failure.
  refreshBuiltClosure();
  // BACKSTOP, deliberately after the build and never before it. An mtime read
  // is a guess (a `git checkout` that rewrites a file to identical content ages
  // a `dist/` that is perfectly current, and 3 of 3 packages flagged in the
  // first worktree measured this way were exactly that kind of false alarm), so
  // it is not fit to decide whether to spend a build. After one, it is a
  // different question with a different error rate: turbo has just rebuilt
  // everything its filters reach, so anything still older than its own sources
  // is a package the build did not cover, and naming it is the only remedy the
  // caller can act on.
  const stale = staleClosure(ledgered, workspaceBuildGraph(packages));
  if (stale.length > 0) {
    throw new Error(
      `--re-measure cannot run: ${stale.length} workspace dependenc(ies) of the ledgered packages still have `
        + `a type entry point OLDER than their own sources after a full closure build -- ${stale.join(', ')}.\n`
        + `The build covers \`./packages/*\` and \`./packages/*/*\`, so a package that survives it is one those `
        + `filters do not reach, or one whose build does not write the entry point its own manifest declares. `
        + `Measuring now would resolve imports through a \`dist/*.d.ts\` describing a package that no longer `
        + `exists, and a number recorded from there is not this package's debt (${SURPLUS_ISSUE}).\n`
        + `Build the named package(s) directly, then re-run:\n`
        + `  pnpm --filter ${stale[0]} build`,
    );
  }

  const measurements = [];
  for (const [name, entry] of Object.entries(state.debt)) {
    const dir = dirOf.get(name);
    if (dir === undefined) continue; // RECONCILED already failed on this one
    measurements.push({ ledger: 'DEBT', name, dir, recorded: entry.errors ?? 0, actual: measureDebt(dir) });
  }
  for (const [name, entry] of Object.entries(state.testDebt)) {
    const dir = dirOf.get(name);
    if (dir === undefined) continue;
    measurements.push({
      ledger: 'TEST_DEBT',
      name,
      dir,
      recorded: entry.errors ?? 0,
      actual: measureTestDebt(dir, hiddenOf.get(name) ?? []),
    });
  }
  return measurements;
}

// ── The ratchet-remedy authority convention (#8435) ──────────────────────────
//
// A gate that offers two remedies teaches whichever one the author can act on.
// This gate's second remedy -- raise the TEST_DEBT entry -- edits a SHRINK-ONLY
// ledger, so taking it is not a fix at all: it is a ratchet weakening, and
// #8225 had already paid to press plugin-auth's entry from 131 to 111 hours
// before a +1 drift arrived on that same entry the same shift. Raising it would
// have handed part of that cost back with every gate green and nothing anywhere
// recording the reversion.
//
// The ledger's shrink-only semantics were ALREADY written into the message
// below ("frozen debt, not a permission slip"). What was missing is the half a
// reader needs in order to act: WHOSE call it is. An author reading this output
// sees two paths that both turn CI green, and no marker saying one of them is
// not theirs to take. So the fix is not more explanation -- it is an authority
// label on the privileged path.
//
// Measured as a FARM-LEVEL shape, not a one-gate nit: the same structure --
// second remedy edits a shrink-only ratchet, presented co-equally -- also lives
// in check-engine-double-contract.mjs (which this PR fixes), and in
// check-durability-degradation-log-level.mjs, check-role-word.mjs and
// check-driver-conformance.mjs (which it does not; see the report/finding).
// `check-driver-memory-census.mjs` is the precedent worth copying: its output
// already refuses the weakening remedy outright ("Do NOT add an entry to make
// ...").
//
// ⛔ This convention STRENGTHENS ratchet governance. Nothing here relaxes a
// threshold, adds a baseline entry, or raises a ledger number -- the verdicts
// this gate reaches are byte-for-byte the ones it reached before.

/**
 * The marker token every gate in the farm uses for the same purpose, kept short
 * and identical across gates so it is greppable and reads as one convention
 * rather than one author's phrasing.
 */
const RATCHET_AUTHORITY_MARKER = '⛔ MAINTAINER-ONLY';

/**
 * How this gate OFFERS the privileged path, as a detector rather than a string
 * compare. Built from `SELF` so a rename of this file moves both halves
 * together; the phrase in front of it is what the self-test pins, because a
 * reworded offer that no longer matches would make the convention check below
 * pass vacuously on every message.
 */
const RATCHET_EXPANSION_OFFER = new RegExp(
  `raise the entry in\\s+${SELF.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
);

/**
 * The convention itself, as a predicate: a message that hands the author the
 * ratchet-raising path must say, in the same breath, that the path is not
 * theirs. A message that offers no such path is unaffected -- this is an
 * authority label, not a vocabulary ban.
 *
 * @param {string} message
 * @returns {boolean}
 */
function ratchetRemedyCarriesAuthority(message) {
  if (!RATCHET_EXPANSION_OFFER.test(message)) return true;
  return message.includes(RATCHET_AUTHORITY_MARKER);
}

/**
 * MEASURED's verdict, pure over already-taken measurements so the self-test
 * pins the semantics without running a compiler.
 *
 * `surplus` is the sum of every entry's `recorded - actual`, and it is the
 * number #6376 is about: not "how stale is the bookkeeping" but "how many
 * regressions can land in these layers without this gate saying anything".
 * Reported, never red -- see the SURPLUS paragraph at the top of this file for
 * why the direction of that ruling is deliberate, and `--lower` for the way out
 * that costs an improvement nothing.
 *
 * @param {Array<{ledger: string, name: string, recorded: number, actual: number}>} measurements
 * @returns {{problems: string[], notes: string[], surplus: number, surplusEntries: number}}
 */
function evaluateMeasurements(measurements) {
  const problems = [];
  const notes = [];
  let surplus = 0;
  let surplusEntries = 0;
  for (const m of measurements) {
    if (m.actual < m.recorded) {
      surplus += m.recorded - m.actual;
      surplusEntries++;
    }
    if (m.actual > m.recorded) {
      problems.push(
        `${m.name}: ${m.ledger} records ${m.recorded} raw tsc error(s), \`tsc --noEmit\` now reports ` +
          `${m.actual} (+${m.actual - m.recorded}). ${m.ledger} is frozen debt, not a permission slip -- ` +
          `the ledger is a ratchet and may only shrink (${REMEASURE_ISSUE}). Fix the new errors -- that is ` +
          `the author's remedy, and the only one of the two below that you can take on your own. ` +
          `${RATCHET_AUTHORITY_MARKER}, NOT a co-equal option: if they are genuinely irreducible today, ` +
          `raise the entry in ${SELF} AND rewrite its \`note\` to match what ` +
          `the pile is now made of: the composition drifts too, and a note still naming only the old errors ` +
          `reads as "nearly graduated" to the next author while something else entirely has moved in. ` +
          `If the delta cannot be attributed, say that in the note rather than inventing composition. ` +
          `Raising the entry weakens a shrink-only ratchet and hands back what an earlier PR paid to press ` +
          `it down, so it needs a maintainer's agreement first -- do not take this path to get CI green.`,
      );
    } else if (m.actual === 0 && m.recorded > 0) {
      notes.push(
        `${m.name}: ${m.ledger} records ${m.recorded}, and tsc now reports 0 -- graduation candidate. ` +
          `Onboard it (add \`"typecheck": "tsc --noEmit"\`, or drop the test exclusion, and delete the ` +
          `ledger entry in the same PR). \`--lower\` deliberately leaves this one alone: 0 is not a lower ` +
          `ceiling, it is a graduation, and an entry recording 0 fails the structural half of this gate.`,
      );
    } else if (m.actual < m.recorded) {
      notes.push(
        `${m.name}: ${m.ledger} records ${m.recorded}, tsc now reports ${m.actual} ` +
          `(-${m.recorded - m.actual}) -- the entry can be lowered. Not an error: an improvement must not ` +
          `have to pay a bookkeeping toll to land. But the gap is not bookkeeping while it is open: nothing ` +
          `else reads this layer, so ${m.recorded - m.actual} new error(s) can land here and this gate will ` +
          `report success (${SURPLUS_ISSUE} -- driver-mongodb's 33 swallowed a whole signature reversion). ` +
          `Close it with \`pnpm check:type-check-debt --lower\`, which writes the measured number for you.`,
      );
    }
  }
  return { problems, notes, surplus, surplusEntries };
}

/**
 * Which entries `--lower` may rewrite, and which it must not. Pure, because the
 * "must not" half is the part that is easy to get wrong: an entry measuring 0 is
 * a GRADUATION (delete the entry and add the script -- a deliberate PR), and
 * writing 0 into the ledger would fail COVERED/TESTS_COVERED on the very next
 * run, turning a free improvement into a broken tree.
 *
 * @param {Array<{ledger: string, name: string, recorded: number, actual: number}>} measurements
 * @returns {{lowerings: Array<{ledger: string, name: string, from: number, to: number}>, graduations: string[]}}
 */
function plannedLowerings(measurements) {
  const lowerings = [];
  const graduations = [];
  for (const m of measurements) {
    if (m.actual >= m.recorded) continue;
    if (m.actual <= 0) {
      graduations.push(`${m.name} (${m.ledger})`);
      continue;
    }
    lowerings.push({ ledger: m.ledger, name: m.name, from: m.recorded, to: m.actual });
  }
  return { lowerings, graduations };
}

/**
 * The span of one ledger's object literal in this file's own source. Anchored on
 * `\n};` rather than brace-matched: a `note` is a single-line string
 * concatenation, so it can contain a brace but never a line that STARTS a
 * closing one -- and a parser that can be fooled by prose is the wrong tool for
 * rewriting the file the prose lives in.
 *
 * @returns {{start: number, end: number} | null}
 */
function ledgerBlockRange(source, ledgerName) {
  const start = source.indexOf(`const ${ledgerName} = {`);
  if (start === -1) return null;
  const end = source.indexOf('\n};', start);
  if (end === -1) return null;
  return { start, end };
}

/**
 * AUTO-LOWERING (#6376). Rewrites `errors:` downward for the named entries, in
 * this file's own ledger source, and reports what it refused to touch instead of
 * guessing. The point is not convenience: the measured number is only knowable
 * by running the compiler against a built closure, so a human typing it is a
 * human copying a number out of an environment that may not be the one CI
 * measures in. The tool that took the measurement is the only honest author of
 * the number.
 *
 * Notes are deliberately NOT rewritten. Raising a count demands a rewritten
 * composition (the invariant above says so, and says why); lowering one leaves a
 * note describing a pile LARGER than what exists, which misleads in the safe
 * direction -- and inventing a composition for errors that are gone would be the
 * exact sin that rule was written against.
 *
 * @param {string} source
 * @param {Array<{ledger: string, name: string, from: number, to: number}>} lowerings
 * @returns {{source: string, applied: string[], skipped: string[]}}
 */
function lowerLedgerEntries(source, lowerings) {
  const applied = [];
  const skipped = [];
  let out = source;
  for (const l of lowerings) {
    const block = ledgerBlockRange(out, l.ledger);
    if (!block) {
      skipped.push(`${l.name}: no \`const ${l.ledger} = {\` block in ${SELF}`);
      continue;
    }
    const text = out.slice(block.start, block.end);
    const pattern = new RegExp(`('${l.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'\\s*:\\s*\\{[\\s\\S]*?errors:\\s*)(\\d+)`);
    const match = text.match(pattern);
    if (!match) {
      skipped.push(`${l.name}: no \`errors:\` found under its ${l.ledger} entry`);
      continue;
    }
    if (Number(match[2]) !== l.from) {
      // The file moved under the measurement. Refusing is the only safe answer:
      // writing anyway would record a number measured against a different tree.
      skipped.push(`${l.name}: ${l.ledger} reads ${match[2]}, not the measured-against ${l.from} -- re-measure`);
      continue;
    }
    out = out.slice(0, block.start) + text.replace(pattern, `$1${l.to}`) + out.slice(block.end);
    applied.push(`${l.ledger} ${l.name}: ${l.from} -> ${l.to}`);
  }
  return { source: out, applied, skipped };
}

/** The observed non-fixture state. */
function observed() {
  const turbo = JSON.parse(readFileSync(join(ROOT, 'turbo.json'), 'utf8'));
  const lintYml = readFileSync(join(ROOT, '.github/workflows/lint.yml'), 'utf8');
  const rootManifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
  return {
    root: { name: rootManifest.name, scripts: rootManifest.scripts ?? {} },
    state: {
      debt: DEBT,
      exempt: EXEMPT,
      testDebt: TEST_DEBT,
      phantomPins: PHANTOM_PIN_DEBT,
      turboHasTask: Object.hasOwn(turbo.tasks ?? {}, 'typecheck'),
      ciInvokesTask: /turbo run typecheck/.test(lintYml),
      ciInvokesRoot: /typecheck:root/.test(lintYml),
    },
  };
}

/**
 * The ledger semantics are the one part of this gate that can be wrong while
 * every package is right -- an evaluate() that under-reports waves the next
 * uncovered package through, silently. So each failure class is asserted
 * against a fixture before the real run is allowed to say OK.
 */
function selfTest() {
  const pkg = (name, extra = {}) => ({ name, dir: `packages/${name}`, scripts: {}, hasTsconfig: true, ...extra });
  const okRoot = {
    name: 'root',
    scripts: { typecheck: 'turbo run typecheck', 'typecheck:root': 'tsc --noEmit' },
  };
  const okState = { debt: {}, exempt: {}, testDebt: {}, phantomPins: {}, turboHasTask: true, ciInvokesTask: true, ciInvokesRoot: true };
  const cases = [
    {
      label: 'covered package passes',
      packages: [pkg('a', { scripts: { typecheck: 'tsc --noEmit' } })],
      root: okRoot,
      state: okState,
      expect: [],
    },
    {
      label: 'a covered package that hides its tests fails TESTS_COVERED',
      packages: [pkg('a', { scripts: { typecheck: 'tsc --noEmit' }, hidesTests: true, testFiles: 12 })],
      root: okRoot,
      state: okState,
      expect: [/12 of its test file\(s\) sit outside every tsc program/],
    },
    {
      label: 'a test-debt entry covers the exclusion, but an empty measurement fails',
      packages: [
        pkg('a', { scripts: { typecheck: 'tsc --noEmit' }, hidesTests: true, testFiles: 3 }),
        pkg('b', { scripts: { typecheck: 'tsc --noEmit' }, hidesTests: true, testFiles: 4 }),
      ],
      root: okRoot,
      state: { ...okState, testDebt: { a: { errors: 9 }, b: { errors: 0 } } },
      expect: [/b: TEST_DEBT entry has no measured error count/],
    },
    {
      // #5826. The rejection is STRUCTURAL, not a reconciliation: this fixture's
      // copy agrees exactly with the live count (7 and 7) and is still refused,
      // because agreement is a property of the moment a number was written, not
      // of the field. Comparing the two instead would bill the next author for
      // adding a clean test file -- a bookkeeping toll on the one action this
      // ledger exists to encourage, which is what #5278 ruled out for `errors`.
      label: 'a TEST_DEBT entry that writes the derived file count down fails, even when it is right today',
      packages: [pkg('a', { scripts: { typecheck: 'tsc --noEmit' }, hidesTests: true, testFiles: 7 })],
      root: okRoot,
      state: { ...okState, testDebt: { a: { tests: 7, errors: 9 } } },
      expect: [/a: TEST_DEBT entry carries a hand-written `tests` count/],
    },
    {
      label: 'a pin in a file no tsc program compiles fails PINS_CHECKED',
      packages: [
        pkg('a', { scripts: { typecheck: 'tsc --noEmit' }, pinFiles: ['packages/a/src/x.test.ts'] }),
      ],
      root: okRoot,
      state: okState,
      expect: [/packages\/a\/src\/x\.test\.ts: carries a `@ts-expect-error` directive but no tsc program/],
    },
    {
      label: 'a PHANTOM_PIN_DEBT entry covers it, but only with a reason',
      packages: [
        pkg('a', { scripts: { typecheck: 'tsc --noEmit' }, pinFiles: ['packages/a/src/x.test.ts'] }),
        pkg('b', { scripts: { typecheck: 'tsc --noEmit' }, pinFiles: ['packages/b/src/y.test.ts'] }),
      ],
      root: okRoot,
      state: {
        ...okState,
        phantomPins: { 'packages/a/src/x.test.ts': 'excluded, tracked by #9999', 'packages/b/src/y.test.ts': '  ' },
      },
      expect: [/packages\/b\/src\/y\.test\.ts: PHANTOM_PIN_DEBT entry has no reason/],
    },
    {
      label: 'a pin that entered a tsc program fails RECONCILED until its entry is deleted',
      packages: [pkg('a', { scripts: { typecheck: 'tsc --noEmit && tsc -p tsconfig.test.json' }, pinFiles: [] })],
      root: okRoot,
      state: { ...okState, phantomPins: { 'packages/a/src/x.test.ts': 'excluded, tracked by #9999' } },
      expect: [/PHANTOM_PIN_DEBT entry for "packages\/a\/src\/x\.test\.ts" is no longer an unchecked pin/],
    },
    {
      label: 'a checked test file with pins is silent — PINS_CHECKED is about the unchecked ones only',
      packages: [pkg('a', { scripts: { typecheck: 'tsc --noEmit' }, pinFiles: [] })],
      root: okRoot,
      state: okState,
      expect: [],
    },
    {
      label: 'excluding tests when there are none to hide is not debt',
      packages: [pkg('a', { scripts: { typecheck: 'tsc --noEmit' }, hidesTests: true, testFiles: 0 })],
      root: okRoot,
      state: okState,
      expect: [],
    },
    {
      label: 'dropping the exclusion without deleting TEST_DEBT fails RECONCILED',
      packages: [pkg('a', { scripts: { typecheck: 'tsc --noEmit' }, hidesTests: false, testFiles: 5 })],
      root: okRoot,
      state: { ...okState, testDebt: { a: { errors: 7 } } },
      expect: [/a: has a TEST_DEBT entry but no longer hides its tests/],
    },
    {
      label: 'TEST_DEBT for a vanished package fails RECONCILED',
      packages: [pkg('a', { scripts: { typecheck: 'tsc --noEmit' } })],
      root: okRoot,
      state: { ...okState, testDebt: { gone: { errors: 1 } } },
      expect: [/TEST_DEBT entry for "gone" names no workspace package/],
    },
    {
      label: 'a hidden test layer is judged independently of src coverage',
      packages: [pkg('a', { hidesTests: true, testFiles: 6 })],
      root: okRoot,
      state: { ...okState, debt: { a: { errors: 4 } } },
      expect: [/a \(packages\/a\): 6 of its test file\(s\) sit outside every tsc program/],
    },
    {
      label: 'uncovered, unledgered package fails COVERED',
      packages: [pkg('a')],
      root: okRoot,
      state: okState,
      expect: [/no `typecheck` script and no ledger entry/],
    },
    {
      label: 'debt-ledgered package passes, but an empty measurement fails',
      packages: [pkg('a'), pkg('b')],
      root: okRoot,
      state: { ...okState, debt: { a: { errors: 12 }, b: {} } },
      expect: [/b: DEBT entry has no measured error count/],
    },
    {
      label: 'exempt package passes only with a reason',
      packages: [pkg('a'), pkg('b')],
      root: okRoot,
      state: { ...okState, exempt: { a: 'no sources', b: '  ' } },
      expect: [/b: EXEMPT entry has no reason/],
    },
    {
      label: 'a typecheck script that never runs tsc fails REAL',
      packages: [pkg('a', { scripts: { typecheck: 'echo ok' } })],
      root: okRoot,
      state: okState,
      expect: [/does not invoke tsc/],
    },
    {
      label: 'graduating without deleting the ledger entry fails RECONCILED',
      packages: [pkg('a', { scripts: { typecheck: 'tsc --noEmit' } })],
      root: okRoot,
      state: { ...okState, debt: { a: { errors: 3 } } },
      expect: [/declares `typecheck` but still has a DEBT entry/],
    },
    {
      label: 'ledger entries for vanished packages fail RECONCILED',
      packages: [pkg('a', { scripts: { typecheck: 'tsc --noEmit' } })],
      root: okRoot,
      state: { ...okState, debt: { gone: { errors: 1 } }, exempt: { also_gone: 'x' } },
      expect: [/DEBT entry for "gone"/, /EXEMPT entry for "also_gone"/],
    },
    {
      label: 'a missing turbo task or CI step fails RUNNABLE',
      packages: [pkg('a', { scripts: { typecheck: 'tsc --noEmit' } })],
      root: okRoot,
      state: { ...okState, turboHasTask: false, ciInvokesTask: false },
      expect: [/turbo\.json does not declare/, /lint\.yml does not invoke/],
    },
    {
      label: 'an unledgered root without typecheck:root fails COVERED',
      packages: [],
      root: { name: 'root', scripts: { typecheck: 'turbo run typecheck' } },
      state: okState,
      expect: [/root.*no `typecheck:root` script and no ledger entry/],
    },
    {
      label: 'a debt-ledgered root passes; graduating it stale-fails like anyone else',
      packages: [],
      root: { name: 'root', scripts: { typecheck: 'turbo run typecheck' } },
      state: { ...okState, debt: { root: { errors: 50 } } },
      expect: [],
    },
    {
      label: 'a root aggregator that does not run turbo fails RUNNABLE',
      packages: [],
      root: { name: 'root', scripts: { typecheck: 'tsc --noEmit', 'typecheck:root': 'tsc --noEmit' } },
      state: okState,
      expect: [/root `typecheck` script must aggregate/],
    },
    {
      label: 'a covered root that CI never runs fails RUNNABLE',
      packages: [],
      root: okRoot,
      state: { ...okState, ciInvokesRoot: false },
      expect: [/never invokes `typecheck:root`/],
    },
  ];

  const failures = [];
  for (const c of cases) {
    const got = evaluate(c.packages, c.root, c.state);
    if (got.length !== c.expect.length || !c.expect.every((rx, i) => rx.test(got[i]))) {
      failures.push(`${c.label}: expected ${c.expect.length} problem(s) matching ${c.expect}, got ${JSON.stringify(got)}`);
    }
  }

  // The observation half is where the :267 blind spot lived: `excludesTests`
  // read only `tsconfig.json`, so a sibling test config was invisible however
  // it was wired. These two helpers now decide it, so they are pinned too.
  const namedCases = [
    { label: 'a bare tsc credits the default config only', scripts: { typecheck: 'tsc --noEmit' }, expect: ['tsconfig.json'] },
    {
      label: 'an explicitly named sibling config counts',
      scripts: { typecheck: 'tsc --noEmit && tsc --noEmit -p tsconfig.test.json' },
      expect: ['tsconfig.json', 'tsconfig.test.json'],
    },
    {
      label: 'one level of `pnpm <script>` indirection is followed',
      scripts: { typecheck: 'tsc --noEmit && pnpm check:tests', 'check:tests': 'tsx x.mts --project tsconfig.test.json' },
      expect: ['tsconfig.json', 'tsconfig.test.json'],
    },
    {
      label: 'a config no script names is not coverage, however present the file is',
      scripts: { typecheck: 'tsc --noEmit', 'some:other': 'tsc -p tsconfig.test.json' },
      expect: ['tsconfig.json'],
    },
    { label: 'no typecheck script names nothing', scripts: {}, expect: [] },
  ];
  for (const c of namedCases) {
    const got = [...configsNamedByTypecheck(c.scripts)].sort();
    if (JSON.stringify(got) !== JSON.stringify([...c.expect].sort())) {
      failures.push(`configsNamedByTypecheck — ${c.label}: expected ${JSON.stringify(c.expect)}, got ${JSON.stringify(got)}`);
    }
  }

  const src = { file: 'tsconfig.json', roots: ['src'], excludesTests: false };
  const srcNoTests = { file: 'tsconfig.json', roots: ['src'], excludesTests: true };
  const whole = { file: 'tsconfig.test.json', roots: [''], excludesTests: false };
  const coverCases = [
    { label: 'a file under the include root is in the program', config: src, rel: 'src/a.test.ts', expect: true },
    { label: 'a sibling test/ tree outside include is not', config: src, rel: 'test/a.test.ts', expect: false },
    { label: 'an exclusion takes the test back out', config: srcNoTests, rel: 'src/a.test.ts', expect: false },
    { label: 'an exclusion does not touch non-test sources', config: srcNoTests, rel: 'src/a.ts', expect: true },
    { label: 'no include walks the whole package', config: whole, rel: 'test/a.test.ts', expect: true },
    { label: 'a root prefix must match a path SEGMENT', config: src, rel: 'srcfixtures/a.test.ts', expect: false },
  ];
  for (const c of coverCases) {
    const got = configCovers(c.config, c.rel);
    if (got !== c.expect) failures.push(`configCovers — ${c.label}: expected ${c.expect}, got ${got}`);
  }

  // #7353. The two halves that decide WHICH test files are unread, and by which
  // programs. Case 2 is the whole card: no `exclude` anywhere, and every one of
  // the package's tests outside the program regardless -- the shape that read as
  // fully covered while nothing compiled a line of it.
  const buildCfg = { file: 'tsconfig.build.json', roots: ['src'], excludesTests: true };
  const unreadCases = [
    {
      label: 'an exclusion hides the tests it names -- the shape this always saw',
      testRels: ['src/a.test.ts', 'src/b.test.ts'],
      programs: [srcNoTests],
      expect: ['src/a.test.ts', 'src/b.test.ts'],
    },
    {
      label: 'an `include` that never reached the tests hides them just as completely, with no `exclude` at all',
      testRels: ['test/a.test.ts', 'test/b.test.ts'],
      programs: [src],
      expect: ['test/a.test.ts', 'test/b.test.ts'],
    },
    {
      label: 'PARTIAL coverage counts only the files left out, which the per-config form could not say',
      testRels: ['src/a.test.ts', 'test/b.test.ts'],
      programs: [src],
      expect: ['test/b.test.ts'],
    },
    {
      label: 'a sibling test config the script names picks the outsiders back up (#5286)',
      testRels: ['src/a.test.ts', 'test/b.test.ts'],
      programs: [srcNoTests, whole],
      expect: [],
    },
    {
      label: 'nothing invoked reads them, so every test file is unread',
      testRels: ['src/a.test.ts', 'test/b.test.ts'],
      programs: [],
      expect: ['src/a.test.ts', 'test/b.test.ts'],
    },
  ];
  for (const c of unreadCases) {
    const got = unreadTests(c.testRels, c.programs);
    if (JSON.stringify(got) !== JSON.stringify(c.expect)) {
      failures.push(`unreadTests — ${c.label}: expected ${JSON.stringify(c.expect)}, got ${JSON.stringify(got)}`);
    }
  }

  const accountedCases = [
    {
      label: 'the typecheck script\'s configs are what account for a covered package',
      configs: [buildCfg, src],
      invoked: [src],
      expect: ['tsconfig.json'],
    },
    {
      // Without this, every DEBT package's whole test tree would land in
      // TEST_DEBT for the sole reason that DEBT already owns it -- 353 files
      // into the ledger that means "src checks, tests are hidden".
      label: 'with no typecheck script, `tsconfig.json` accounts for them -- it is what measureDebt runs',
      configs: [buildCfg, src],
      invoked: [],
      expect: ['tsconfig.json'],
    },
    {
      label: 'a package with no tsconfig.json at all has nothing accounting for it',
      configs: [buildCfg],
      invoked: [],
      expect: [],
    },
  ];
  for (const c of accountedCases) {
    const got = accountedPrograms(c.configs, c.invoked).map((p) => p.file);
    if (JSON.stringify(got) !== JSON.stringify(c.expect)) {
      failures.push(`accountedPrograms — ${c.label}: expected ${JSON.stringify(c.expect)}, got ${JSON.stringify(got)}`);
    }
  }

  // The summary's hidden-file figure (#5826). It used to be the sum of a
  // hand-written `tests` field, which nothing reconciled -- so the third case
  // below is the whole issue in one line: the same ledger, one more test file,
  // a total that follows without anybody editing anything.
  const derivedCases = [
    {
      label: 'the total is the live count of the ledgered packages',
      packages: [pkg('a', { testFiles: 3 }), pkg('b', { testFiles: 4 })],
      testDebt: { a: { errors: 9 }, b: { errors: 2 } },
      expect: 7,
    },
    {
      label: 'a package outside the ledger contributes nothing, however many tests it has',
      packages: [pkg('a', { testFiles: 3 }), pkg('covered', { testFiles: 99 })],
      testDebt: { a: { errors: 9 } },
      expect: 3,
    },
    {
      label: 'one more test file moves the total with no ledger edit — the drift, removed by construction',
      packages: [pkg('a', { testFiles: 4 }), pkg('b', { testFiles: 4 })],
      testDebt: { a: { errors: 9 }, b: { errors: 2 } },
      expect: 8,
    },
    {
      label: 'an entry naming no live package contributes nothing rather than throwing',
      packages: [pkg('a', { testFiles: 3 })],
      testDebt: { a: { errors: 9 }, gone: { errors: 1 } },
      expect: 3,
    },
    {
      label: 'a package the scan never counted reads as zero, not as NaN',
      packages: [pkg('a', {})],
      testDebt: { a: { errors: 9 } },
      expect: 0,
    },
  ];
  for (const c of derivedCases) {
    const got = hiddenTestFiles(c.packages, c.testDebt);
    if (got !== c.expect) failures.push(`hiddenTestFiles — ${c.label}: expected ${c.expect}, got ${got}`);
  }

  // MEASURED (#5278). The whole point of this invariant is a DIRECTION, so both
  // directions are pinned: up is red, down is a note, equal is silence. A
  // symmetric implementation would pass a "does it notice a change" test and
  // still be wrong -- it would make every improvement red.
  const driftCases = [
    {
      label: 'a count that grew is red',
      measurements: [{ ledger: 'DEBT', name: 'a', recorded: 28, actual: 63 }],
      problems: [/a: DEBT records 28 raw tsc error\(s\).*now reports 63 \(\+35\)/s],
      notes: [],
    },
    {
      label: 'a count that grew by one is red too — no tolerance band',
      measurements: [{ ledger: 'TEST_DEBT', name: 'a', recorded: 2, actual: 3 }],
      problems: [/a: TEST_DEBT records 2 raw tsc error\(s\).*now reports 3 \(\+1\)/s],
      notes: [],
    },
    {
      label: 'a count that shrank is a note, never red',
      measurements: [{ ledger: 'DEBT', name: 'a', recorded: 13, actual: 5 }],
      problems: [],
      notes: [/a: DEBT records 13, tsc now reports 5 \(-8\) -- the entry can be lowered/],
    },
    {
      label: 'a count that reached zero is a graduation candidate, not a failure',
      measurements: [{ ledger: 'DEBT', name: 'a', recorded: 4, actual: 0 }],
      problems: [],
      notes: [/a: DEBT records 4, and tsc now reports 0 -- graduation candidate/],
    },
    {
      label: 'an unchanged count is silent — a green run says nothing at all',
      measurements: [
        { ledger: 'DEBT', name: 'a', recorded: 91, actual: 91 },
        { ledger: 'TEST_DEBT', name: 'b', recorded: 467, actual: 467 },
      ],
      problems: [],
      notes: [],
    },
    {
      label: 'each entry is judged on its own — one growing does not mask another shrinking',
      measurements: [
        { ledger: 'DEBT', name: 'grew', recorded: 3, actual: 7 },
        { ledger: 'DEBT', name: 'shrank', recorded: 9, actual: 8 },
      ],
      problems: [/grew: DEBT records 3/],
      notes: [/shrank: DEBT records 9, tsc now reports 8/],
      surplus: 1,
    },
    // #6376, THE CASUALTY, as measured on driver-mongodb rather than as a
    // parable. These two cases are ONE scenario at two ceilings, and the pair is
    // the whole issue: the tree is identical, the regression is identical, and
    // only the recorded number decides whether this gate speaks.
    //
    // Read the first case for what it is -- a CHARACTERISATION of a live
    // allowance, not a regression test of a fix. It asserts that the gate says
    // NOTHING about a 12-error regression, because 12 < 43. That is today's
    // deliberate behaviour (an improvement must not pay a toll), and it is
    // pinned here so it is a decision on the record instead of an accident: if
    // the surplus is ever made red, THIS is the assertion that flips, and the
    // second case is what it must flip to.
    {
      label: '#6376 — a regression SMALLER than the surplus is invisible: 12 errors under a stale 43-ceiling',
      measurements: [{ ledger: 'TEST_DEBT', name: 'driver-mongodb', recorded: 43, actual: 12 }],
      problems: [],
      notes: [/driver-mongodb: TEST_DEBT records 43, tsc now reports 12 \(-31\).*31 new error\(s\) can land here/s],
      surplus: 31,
    },
    {
      label: '#6376 — the same regression against the flattened ceiling is red: PR #6356 is why 10, not 43',
      measurements: [{ ledger: 'TEST_DEBT', name: 'driver-mongodb', recorded: 10, actual: 12 }],
      problems: [/driver-mongodb: TEST_DEBT records 10 raw tsc error\(s\).*now reports 12 \(\+2\)/s],
      notes: [],
      surplus: 0,
    },
    {
      label: '#6376 — the surplus total is the allowance, summed over shrunk entries only',
      measurements: [
        { ledger: 'TEST_DEBT', name: 'approvals', recorded: 547, actual: 348 },
        { ledger: 'TEST_DEBT', name: 'lint', recorded: 42, actual: 19 },
        { ledger: 'DEBT', name: 'exact', recorded: 5, actual: 5 },
        { ledger: 'DEBT', name: 'grew', recorded: 3, actual: 9 },
      ],
      problems: [/grew: DEBT records 3/],
      notes: [/approvals: TEST_DEBT records 547/, /lint: TEST_DEBT records 42/],
      surplus: 222,
      surplusEntries: 2,
    },
    {
      label: '#6376 — an exactly-calibrated ledger reports no allowance at all',
      measurements: [
        { ledger: 'DEBT', name: 'a', recorded: 91, actual: 91 },
        { ledger: 'TEST_DEBT', name: 'b', recorded: 467, actual: 467 },
      ],
      problems: [],
      notes: [],
      surplus: 0,
      surplusEntries: 0,
    },
  ];
  for (const c of driftCases) {
    const got = evaluateMeasurements(c.measurements);
    const ok =
      got.problems.length === c.problems.length &&
      got.notes.length === c.notes.length &&
      c.problems.every((rx, i) => rx.test(got.problems[i])) &&
      c.notes.every((rx, i) => rx.test(got.notes[i])) &&
      (c.surplus === undefined || got.surplus === c.surplus) &&
      (c.surplusEntries === undefined || got.surplusEntries === c.surplusEntries);
    if (!ok) {
      failures.push(
        `evaluateMeasurements — ${c.label}: expected ${c.problems.length} problem(s) / ${c.notes.length} note(s) ` +
          `matching${c.surplus === undefined ? '' : ` / surplus ${c.surplus}`}, got ${JSON.stringify(got)}`,
      );
    }
  }

  // ── The ratchet-remedy authority convention (#8435) ────────────────────────
  //
  // Three assertions, deliberately non-overlapping, so each way this can rot is
  // caught by exactly one NAMED failure:
  //
  //   (1) the detector still reaches its subject -- the only one that fails if
  //       the offer is reworded out from under `RATCHET_EXPANSION_OFFER`,
  //       which would make (3) pass vacuously forever after;
  //   (2) the real emitted message carries the marker -- the only one that
  //       fails if the label is dropped from the drift text;
  //   (3) an offer WITHOUT the marker is REJECTED -- the only one that fails if
  //       the predicate stops discriminating (e.g. is reduced to `return true`).
  //
  // (3) is what makes (2) worth having: without it, a predicate that approves
  // everything would keep this block green while the convention is gone.
  const driftMessage = evaluateMeasurements([
    { ledger: 'TEST_DEBT', name: 'plugin-auth', recorded: 111, actual: 112 },
  ]).problems[0];

  if (!RATCHET_EXPANSION_OFFER.test(driftMessage)) {
    failures.push(
      '#8435 convention — the ratchet-offer DETECTOR no longer matches the drift message it is ' +
        'written against. Either the offer was reworded (re-point RATCHET_EXPANSION_OFFER at the new ' +
        'wording) or the ratchet path was removed (delete the convention block). Until then the ' +
        'convention check passes vacuously on every message.',
    );
  }
  if (!ratchetRemedyCarriesAuthority(driftMessage)) {
    failures.push(
      '#8435 convention — the drift message offers the ratchet-raising path in ' +
        `${SELF} without the ${RATCHET_AUTHORITY_MARKER} marker. The ledger is shrink-only, so that ` +
        'path is a maintainer action; presenting it unmarked next to the real fix is what let a +1 ' +
        'drift read as "two ways to go green".',
    );
  }
  {
    const unmarked = driftMessage.split(RATCHET_AUTHORITY_MARKER).join('(unmarked)');
    if (ratchetRemedyCarriesAuthority(unmarked)) {
      failures.push(
        '#8435 convention — ratchetRemedyCarriesAuthority() ACCEPTED a message that offers the ' +
          'ratchet-raising path with the marker stripped out. The predicate is not discriminating, so ' +
          'the assertion above proves nothing.',
      );
    }
  }

  // The counter is the other half that can be silently wrong: over-count and
  // main goes red for nothing, under-count and the ratchet hands out free
  // headroom. Multi-line elaborations are the trap -- one TS2322 can print five
  // lines, four of them indented.
  const countCases = [
    { label: 'no output is no errors', output: '', expect: 0 },
    {
      label: 'one diagnostic per line',
      output: 'packages/a/src/x.ts(1,2): error TS2345: Argument of type X.\npackages/a/src/y.ts(3,4): error TS7006: Parameter implicitly any.',
      expect: 2,
    },
    {
      label: 'indented elaboration lines belong to the diagnostic above them',
      output:
        "packages/a/src/x.ts(1,2): error TS2322: Type 'A' is not assignable to type 'B'.\n" +
        "  Type 'A' is not assignable to type 'C'.\n" +
        "    Types of property 'p' are incompatible.\n",
      expect: 1,
    },
    { label: 'a global diagnostic with no file prefix still counts', output: 'error TS5055: Cannot write file.', expect: 1 },
    {
      label: 'prose mentioning the phrase mid-line without a code does not count',
      output: 'Checked 40 files, no error TS reported by the previous run.',
      expect: 0,
    },
  ];
  for (const c of countCases) {
    const got = countTscErrors(c.output);
    if (got !== c.expect) failures.push(`countTscErrors — ${c.label}: expected ${c.expect}, got ${got}`);
  }

  // BUILT CLOSURE (#6376). The precondition is only worth having if it can tell
  // "this package publishes no types" from "this package was never built" --
  // confusing those two either refuses every run (console has no type entry) or
  // refuses none.
  const typeEntryCases = [
    { label: 'a flat `types` entry', manifest: { types: 'dist/index.d.ts' }, expect: ['dist/index.d.ts'] },
    {
      label: 'conditional exports contribute every declaration file they name',
      manifest: {
        types: 'dist/index.d.ts',
        exports: { '.': { import: { types: './dist/index.d.mts' }, require: { types: './dist/index.d.ts' } } },
      },
      expect: ['dist/index.d.mts', 'dist/index.d.ts'],
    },
    { label: 'a package that publishes no types declares none', manifest: { exports: { './package.json': './package.json' } }, expect: [] },
    { label: 'runtime entry points are not type entry points', manifest: { main: 'dist/index.js', module: 'dist/index.mjs' }, expect: [] },
  ];
  for (const c of typeEntryCases) {
    const got = declaredTypeEntries(c.manifest);
    if (JSON.stringify(got) !== JSON.stringify(c.expect)) {
      failures.push(`declaredTypeEntries — ${c.label}: expected ${JSON.stringify(c.expect)}, got ${JSON.stringify(got)}`);
    }
  }

  // The graph below is shared by the next two cases ON PURPOSE, and they are a
  // PAIR: a "nothing is reported" assertion passes vacuously over an empty
  // measurement set, so the same 4-package graph is asserted twice -- once
  // fully built (exactly 0 reported) and once with a single `built` flag
  // flipped (exactly 1 reported, by name). The second is what proves the first
  // was measuring something.
  const built = (deps, isBuilt = true) => ({ deps, typeEntries: ['dist/index.d.ts'], built: isBuilt });
  const closureGraph = (specBuilt) => new Map([
    ['ledgered', built(['spec', 'formula'])],
    ['spec', built([], specBuilt)],
    ['formula', built(['spec'])],
    ['untouched', built([], false)], // unbuilt, but nothing in the closure needs it
  ]);
  const closureCases = [
    { label: 'a fully built closure reports nothing, over a graph of 4 packages', roots: ['ledgered'], graph: closureGraph(true), expect: [] },
    { label: 'flipping one dependency to unbuilt reports exactly that one', roots: ['ledgered'], graph: closureGraph(false), expect: ['spec'] },
    {
      label: 'a transitive dependency counts — the closure is walked, not just the direct deps',
      roots: ['ledgered'],
      graph: new Map([['ledgered', built(['formula'])], ['formula', built(['spec'])], ['spec', built([], false)]]),
      expect: ['spec'],
    },
    {
      label: 'a ledgered package\'s OWN dist is irrelevant to its OWN number',
      roots: ['ledgered'],
      graph: new Map([['ledgered', built([], false)]]),
      expect: [],
    },
    {
      label: 'but it IS reported when another ledgered package depends on it',
      roots: ['a', 'ledgered'],
      graph: new Map([['a', built(['ledgered'])], ['ledgered', built([], false)]]),
      expect: ['ledgered'],
    },
    {
      label: 'a package that declares no type entry point is never unbuilt',
      roots: ['ledgered'],
      graph: new Map([['ledgered', built(['console'])], ['console', { deps: [], typeEntries: [], built: false }]]),
      expect: [],
    },
    {
      label: 'a dependency cycle terminates instead of hanging the gate',
      roots: ['ledgered'],
      graph: new Map([['ledgered', built(['a'])], ['a', built(['b'])], ['b', built(['a'], false)]]),
      expect: ['b'],
    },
    {
      label: 'a dependency outside the workspace is npm\'s problem, not the build\'s',
      roots: ['ledgered'],
      graph: new Map([['ledgered', built(['zod'])]]),
      expect: [],
    },
  ];
  for (const c of closureCases) {
    const got = unbuiltClosure(c.roots, c.graph);
    if (JSON.stringify(got) !== JSON.stringify(c.expect)) {
      failures.push(`unbuiltClosure — ${c.label}: expected ${JSON.stringify(c.expect)}, got ${JSON.stringify(got)}`);
    }
  }

  // STALE CLOSURE (#8271) -- present but older than the source it describes,
  // which is the case `built` alone cannot see and the one that reported four
  // errors that were not in any source. Paired the same way its sibling is: the
  // SAME graph asserted quiet and then with one `stale` flag flipped, because
  // "nothing is reported" is a sentence an empty traversal also says.
  //
  // The first case is load-bearing beyond the pairing: `unbuiltClosure`'s own
  // table describes nodes with no `stale` key at all, so it also pins that a
  // graph read by the older function cannot be read as stale by this one.
  const fresh = (deps, isStale = false) => ({ deps, typeEntries: ['dist/index.d.ts'], built: true, stale: isStale });
  const staleGraph = (specStale) => new Map([
    ['ledgered', fresh(['spec', 'formula'])],
    ['spec', fresh([], specStale)],
    ['formula', fresh(['spec'])],
    ['untouched', fresh([], true)], // stale, but nothing in the closure needs it
  ]);
  const staleCases = [
    { label: 'a current closure reports nothing, over a graph of 4 packages', roots: ['ledgered'], graph: staleGraph(false), expect: [] },
    { label: 'flipping one dependency to stale reports exactly that one', roots: ['ledgered'], graph: staleGraph(true), expect: ['spec'] },
    {
      label: 'a transitive dependency counts — the closure is walked, not just the direct deps',
      roots: ['ledgered'],
      graph: new Map([['ledgered', fresh(['formula'])], ['formula', fresh(['spec'])], ['spec', fresh([], true)]]),
      expect: ['spec'],
    },
    {
      label: 'a ledgered package\'s OWN dist is irrelevant to its OWN number',
      roots: ['ledgered'],
      graph: new Map([['ledgered', fresh([], true)]]),
      expect: [],
    },
    {
      label: 'but it IS reported when another ledgered package depends on it',
      roots: ['a', 'ledgered'],
      graph: new Map([['a', fresh(['ledgered'])], ['ledgered', fresh([], true)]]),
      expect: ['ledgered'],
    },
    {
      // Described as BUILT on purpose, which the fs read cannot currently
      // produce (`built` is "some declared entry exists", so no entries means
      // not built). Written the other way the case passes on the `built` guard
      // alone and pins nothing about type entries -- measured: deleting the
      // type-entry guard left the whole table green until this node said
      // `built: true`.
      label: 'a package that declares no type entry point is never stale, however it is described',
      roots: ['ledgered'],
      graph: new Map([['ledgered', fresh(['console'])], ['console', { deps: [], typeEntries: [], built: true, stale: true }]]),
      expect: [],
    },
    {
      // The two findings are different remedies -- build it once, versus build
      // it again -- so a package with nothing on disk must reach the caller as
      // exactly one of them, and it is unbuiltClosure's.
      label: 'an UNBUILT dependency is not also reported as stale',
      roots: ['ledgered'],
      graph: new Map([['ledgered', fresh(['spec'])], ['spec', { deps: [], typeEntries: ['dist/index.d.ts'], built: false, stale: true }]]),
      expect: [],
    },
    {
      label: 'a dependency cycle terminates instead of hanging the gate',
      roots: ['ledgered'],
      graph: new Map([['ledgered', fresh(['a'])], ['a', fresh(['b'])], ['b', fresh(['a'], true)]]),
      expect: ['b'],
    },
    {
      label: 'a dependency outside the workspace is npm\'s problem, not the build\'s',
      roots: ['ledgered'],
      graph: new Map([['ledgered', fresh(['zod'])]]),
      expect: [],
    },
  ];
  for (const c of staleCases) {
    const got = staleClosure(c.roots, c.graph);
    if (JSON.stringify(got) !== JSON.stringify(c.expect)) {
      failures.push(`staleClosure — ${c.label}: expected ${JSON.stringify(c.expect)}, got ${JSON.stringify(got)}`);
    }
  }

  // The freshness READ, as opposed to the traversal over its result. Two files
  // decide it and they are not interchangeable: a source file dates the build,
  // a test file must not, because no `dist/*.d.ts` is generated from one. This
  // is the exclusion that took the first worktree's flag count from 3 to 1.
  const sourceFileCases = [
    { label: 'a plain source file is read', name: 'index.ts', expect: true },
    { label: 'a .tsx source file is read', name: 'view.tsx', expect: true },
    { label: 'an .mts source file is read', name: 'entry.mts', expect: true },
    { label: 'a .test.ts file is not', name: 'engine.test.ts', expect: false },
    { label: 'a .spec.tsx file is not', name: 'form.spec.tsx', expect: false },
    { label: 'a non-TypeScript file is not', name: 'README.md', expect: false },
    { label: 'a .json fixture is not', name: 'fixture.json', expect: false },
  ];
  for (const c of sourceFileCases) {
    const got = isBuildSource(c.name);
    if (got !== c.expect) {
      failures.push(`source-file read — ${c.label}: expected ${c.expect}, got ${got}`);
    }
  }

  // THE GENERATED RE-MEASURE PROJECT (#8218). The invariant is one sentence --
  // no path in this object may be relative -- and it is worth a case table
  // because the file is written into `os.tmpdir()`, where a relative path does
  // not fail, it QUIETLY MEANS SOMETHING ELSE. The two shapes that bit hardest
  // are the ones nobody writes down: an omitted `include` (tsc substitutes
  // `**\/*` against the temp dir) and an omitted `typeRoots` (tsc derives them
  // from the temp dir, and packages/cli drops from 188 errors to 1).
  const PKG = '/repo/packages/a';
  const REPO = '/repo';
  const chain = (extra = {}) => ({ selectsFiles: false, declaresTypeRoots: false, ...extra });
  const projectCases = [
    {
      label: 'the usual shape: own include, no exclude, nothing unreachable',
      input: { parsed: { include: ['src/**/*'] }, unreachable: [], chain: chain({ selectsFiles: true }) },
      expect: {
        extends: '/repo/packages/a/tsconfig.json',
        exclude: [],
        include: ['/repo/packages/a/src/**/*'],
        compilerOptions: { typeRoots: ['/repo/packages/a/node_modules/@types', '/repo/packages/node_modules/@types', '/repo/node_modules/@types'] },
      },
    },
    {
      label: 'the test globs are dropped from exclude and the survivors are absolutised',
      input: {
        parsed: { include: ['src/**/*'], exclude: ['dist', 'node_modules', '**/*.test.ts', '**/*.spec.tsx'] },
        unreachable: [],
        chain: chain({ selectsFiles: true }),
      },
      expectPart: { exclude: ['/repo/packages/a/dist', '/repo/packages/a/node_modules'] },
    },
    {
      label: 'unreachable test files are appended one at a time and rootDir is neutralised to the package',
      input: {
        parsed: { include: ['src'], exclude: [] },
        unreachable: ['test/x.test.ts', 'e2e/y.spec.ts'],
        chain: chain({ selectsFiles: true }),
      },
      expectPart: {
        include: ['/repo/packages/a/src', '/repo/packages/a/test/x.test.ts', '/repo/packages/a/e2e/y.spec.ts'],
      },
      expectOption: { rootDir: '/repo/packages/a' },
    },
    {
      label: 'a config that selects nothing gets an EXPLICIT include — the default would name the temp dir',
      input: { parsed: {}, unreachable: [], chain: chain() },
      expectPart: { include: ['/repo/packages/a/**/*'] },
    },
    {
      label: 'a chain that selects files keeps selecting them: no include is invented over its head',
      input: { parsed: {}, unreachable: [], chain: chain({ selectsFiles: true }) },
      expectAbsent: ['include'],
    },
    {
      label: 'a chain that names its own typeRoots is not overridden — those already resolve from their own file',
      input: { parsed: { include: ['src'] }, unreachable: [], chain: chain({ selectsFiles: true, declaresTypeRoots: true }) },
      expectAbsentOption: ['typeRoots'],
    },
  ];
  for (const c of projectCases) {
    const got = remeasureProject({ pkgAbs: PKG, rootAbs: REPO, ...c.input });
    const problems = [];
    if (c.expect && JSON.stringify(got) !== JSON.stringify(c.expect)) {
      problems.push(`expected ${JSON.stringify(c.expect)}, got ${JSON.stringify(got)}`);
    }
    for (const [key, want] of Object.entries(c.expectPart ?? {})) {
      if (JSON.stringify(got[key]) !== JSON.stringify(want)) {
        problems.push(`${key}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got[key])}`);
      }
    }
    for (const [key, want] of Object.entries(c.expectOption ?? {})) {
      if (JSON.stringify(got.compilerOptions?.[key]) !== JSON.stringify(want)) {
        problems.push(`compilerOptions.${key}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got.compilerOptions?.[key])}`);
      }
    }
    for (const key of c.expectAbsent ?? []) {
      if (got[key] !== undefined) problems.push(`${key} should be absent, got ${JSON.stringify(got[key])}`);
    }
    for (const key of c.expectAbsentOption ?? []) {
      if (got.compilerOptions?.[key] !== undefined) {
        problems.push(`compilerOptions.${key} should be absent, got ${JSON.stringify(got.compilerOptions[key])}`);
      }
    }
    // The blanket property, checked on EVERY case rather than spelled per
    // expectation: one relative path anywhere in this object is a silently
    // different measurement, so no case is allowed to introduce one.
    for (const [where, value] of [
      ['extends', [got.extends]],
      ['include', got.include ?? []],
      ['exclude', got.exclude ?? []],
      ['compilerOptions.rootDir', got.compilerOptions?.rootDir ? [got.compilerOptions.rootDir] : []],
      ['compilerOptions.typeRoots', got.compilerOptions?.typeRoots ?? []],
    ]) {
      for (const p of value) {
        if (!String(p).startsWith('/')) problems.push(`${where} emits a relative path: ${JSON.stringify(p)}`);
      }
    }
    if (problems.length > 0) failures.push(`remeasureProject — ${c.label}: ${problems.join('; ')}`);
  }

  // The measurement is only as good as its refusal to record a broken one. A
  // generated project whose type libraries do not resolve prints ONE diagnostic
  // and nothing else, which is why TS2688 must never reach the counter (#8218).
  const setupErrorCases = [
    { label: 'an unresolvable type library is a broken measurement, not one error', output: "error TS2688: Cannot find type definition file for 'node'.", expect: true },
    { label: 'an unreadable project is a broken measurement', output: "error TS5058: The specified path does not exist: 'x.json'.", expect: true },
    { label: 'an ordinary type error is debt', output: "packages/a/src/x.ts(1,2): error TS2322: Type 'A' is not assignable to type 'B'.", expect: false },
    { label: 'a code that merely starts with the same digits is not a setup error', output: 'packages/a/src/x.ts(1,2): error TS26881: invented.', expect: false },
  ];
  for (const c of setupErrorCases) {
    const got = TSC_SETUP_ERROR.test(c.output);
    if (got !== c.expect) failures.push(`TSC_SETUP_ERROR — ${c.label}: expected ${c.expect}, got ${got}`);
  }

  // AUTO-LOWERING (#6376). What it refuses matters more than what it writes.
  const planCases = [
    {
      label: 'a shrunk entry is lowered to its measurement',
      measurements: [{ ledger: 'DEBT', name: 'a', recorded: 52, actual: 42 }],
      lowerings: [{ ledger: 'DEBT', name: 'a', from: 52, to: 42 }],
      graduations: [],
    },
    { label: 'a grown entry is never lowered', measurements: [{ ledger: 'DEBT', name: 'a', recorded: 3, actual: 7 }], lowerings: [], graduations: [] },
    { label: 'an exact entry is left alone', measurements: [{ ledger: 'DEBT', name: 'a', recorded: 3, actual: 3 }], lowerings: [], graduations: [] },
    {
      label: 'an entry measuring 0 is a graduation, not a lowering — writing 0 would fail the structural gate',
      measurements: [{ ledger: 'TEST_DEBT', name: 'a', recorded: 4, actual: 0 }],
      lowerings: [],
      graduations: ['a (TEST_DEBT)'],
    },
  ];
  for (const c of planCases) {
    const got = plannedLowerings(c.measurements);
    if (JSON.stringify(got.lowerings) !== JSON.stringify(c.lowerings) || JSON.stringify(got.graduations) !== JSON.stringify(c.graduations)) {
      failures.push(`plannedLowerings — ${c.label}: expected ${JSON.stringify(c)}, got ${JSON.stringify(got)}`);
    }
  }

  // The rewriter, against a fixture shaped like this file's own ledgers --
  // including the two traps they really contain: ONE package name that appears
  // in BOTH ledgers with different numbers (`@objectstack/rest` is 2 in DEBT and
  // 163 in TEST_DEBT), and a `note` whose PROSE contains the word it is
  // searching for.
  const ledgerFixture = [
    'const DEBT = {',
    "  '@objectstack/rest': {",
    '    errors: 2,',
    "    note: 'code-tier 2. An earlier sweep read errors: 99 here, which is prose and not the field.',",
    '  },',
    "  '@objectstack/other': { errors: 5, note: 'x' },",
    '};',
    '',
    'const TEST_DEBT = {',
    "  '@objectstack/rest': { errors: 163, note: 'y' },",
    '};',
    '',
  ].join('\n');
  const rewriteCases = [
    {
      label: 'lowers the entry in the NAMED ledger, leaving the same name in the other ledger untouched',
      lowerings: [{ ledger: 'TEST_DEBT', name: '@objectstack/rest', from: 163, to: 144 }],
      applied: 1,
      skipped: 0,
      assert: (out) => /const DEBT[\s\S]*'@objectstack\/rest': \{\n    errors: 2,/.test(out)
        && /const TEST_DEBT[\s\S]*'@objectstack\/rest': \{ errors: 144,/.test(out),
    },
    {
      label: 'the field is the first `errors:` under the name — prose inside the note is not a field',
      lowerings: [{ ledger: 'DEBT', name: '@objectstack/rest', from: 2, to: 1 }],
      applied: 1,
      skipped: 0,
      assert: (out) => /errors: 1,/.test(out) && /read errors: 99 here/.test(out),
    },
    {
      label: 'refuses when the file no longer reads the number the measurement was taken against',
      lowerings: [{ ledger: 'DEBT', name: '@objectstack/other', from: 9, to: 4 }],
      applied: 0,
      skipped: 1,
      assert: (out) => out === ledgerFixture,
    },
    {
      label: 'refuses an entry that is not in that ledger rather than writing somewhere plausible',
      lowerings: [{ ledger: 'DEBT', name: '@objectstack/absent', from: 3, to: 1 }],
      applied: 0,
      skipped: 1,
      assert: (out) => out === ledgerFixture,
    },
    {
      label: 'an empty plan leaves the source byte-identical',
      lowerings: [],
      applied: 0,
      skipped: 0,
      assert: (out) => out === ledgerFixture,
    },
  ];
  for (const c of rewriteCases) {
    const got = lowerLedgerEntries(ledgerFixture, c.lowerings);
    if (got.applied.length !== c.applied || got.skipped.length !== c.skipped || !c.assert(got.source)) {
      failures.push(
        `lowerLedgerEntries — ${c.label}: expected ${c.applied} applied / ${c.skipped} skipped and the ` +
          `documented source, got ${JSON.stringify({ applied: got.applied, skipped: got.skipped })}`,
      );
    }
  }

  if (failures.length) {
    console.error(`✗ check:type-check-coverage --self-test — ${failures.length} failure(s)\n`);
    for (const f of failures) console.error('  • ' + f);
    process.exit(1);
  }
  console.log(
    `✓ check:type-check-coverage --self-test — ${cases.length} semantic case(s) + ` +
      `${namedCases.length + coverCases.length + unreadCases.length + accountedCases.length
        + derivedCases.length} observation case(s) + ` +
      `${driftCases.length + countCases.length + projectCases.length + setupErrorCases.length} re-measure case(s) + ` +
      `${typeEntryCases.length + closureCases.length + staleCases.length + sourceFileCases.length} ` +
      `built-closure case(s) + ` +
      `${planCases.length + rewriteCases.length} auto-lowering case(s) hold.`,
  );
}

if (process.argv.includes('--self-test')) {
  selfTest();
  process.exit(0);
}

const packages = workspacePackages();
const { root, state } = observed();
const problems = evaluate(packages, root, state);

if (problems.length) {
  console.error(`check-type-check-coverage: ${problems.length} problem(s)\n`);
  for (const p of problems) console.error('  • ' + p);
  process.exit(1);
}

const covered = packages.filter((p) => p.scripts.typecheck !== undefined).length;
const debtTotal = Object.values(DEBT).reduce((sum, e) => sum + (e.errors ?? 0), 0);
const testDebtErrors = Object.values(TEST_DEBT).reduce((sum, e) => sum + (e.errors ?? 0), 0);
// Counted on this run, not read from the ledger: the file count is the one
// number here the gate already knows (#5826).
const testDebtFiles = hiddenTestFiles(packages, TEST_DEBT);
// Both numbers, always. Reporting only the src figure is how the first pass of
// this gate read as 48/77 green while 568 test files went unchecked.
console.log(
  `check-type-check-coverage: OK — ${covered}/${packages.length} workspace packages type-checked ` +
    `(plus the root), ${Object.keys(DEBT).length} in the DEBT ledger (${debtTotal} frozen raw errors, ` +
    `${TRACKING_ISSUE}), ${Object.keys(EXEMPT).length} exempt.\n` +
    `  test layer: ${Object.keys(TEST_DEBT).length} package(s) still hide their own tests from tsc ` +
    `(${testDebtFiles} files hidden as counted by this run, ${testDebtErrors} frozen raw errors in TEST_DEBT).`,
);

// MEASURED runs only when asked, and only after the structural verdict above is
// clean: a ledger entry naming a package that no longer exists has nothing to
// measure, and a wall of tsc output would bury the real failure. Reported after
// the summary so the two verdicts read in the order they were reached.
if (process.argv.includes('--re-measure')) {
  const started = Date.now();
  const measurements = measureLedgers(packages, root.name, state);
  const { problems: drift, notes, surplus, surplusEntries } = evaluateMeasurements(measurements);
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  for (const n of notes) console.log('  ℹ ' + n);

  // AUTO-LOWERING. Opt-in, like the `--update` on this repo's other two
  // ratchets, and run BEFORE the drift verdict so a tree that has both a
  // regression and a surplus still gets the surplus closed in the same lap.
  if (process.argv.includes('--lower')) {
    const { lowerings, graduations } = plannedLowerings(measurements);
    const file = join(ROOT, SELF);
    const { source, applied, skipped } = lowerLedgerEntries(readFileSync(file, 'utf8'), lowerings);
    if (applied.length > 0) writeFileSync(file, source);
    console.log(
      `\ncheck-type-check-coverage --lower: ${applied.length} ledger entr(ies) lowered to their measurement.`,
    );
    for (const a of applied) console.log('  ↓ ' + a);
    for (const s of skipped) console.log('  ! ' + s);
    for (const g of graduations) {
      console.log(`  ! ${g} measures 0 -- not lowered: that is a graduation, and it is a deliberate PR.`);
    }
    if (applied.length > 0) {
      console.log(
        `  Review and commit ${SELF}. Each \`note\` still describes the LARGER pile it was written for; ` +
          `rewrite the ones you can attribute, and leave the rest rather than inventing a composition.`,
      );
    }
  }

  if (drift.length) {
    console.error(`\ncheck-type-check-coverage --re-measure: ${drift.length} ledger entr(ies) drifted upward\n`);
    for (const p of drift) console.error('  • ' + p);
    process.exit(1);
  }
  const measuredTotal = measurements.reduce((sum, m) => sum + m.actual, 0);
  console.log(
    `check-type-check-coverage --re-measure: OK — ${measurements.length} ledger entr(ies) re-measured ` +
      `in ${elapsed}s, ${measuredTotal} raw tsc error(s) total, none above its recorded number.`,
  );
  // Printed on a GREEN run, on purpose. This is the one number the old summary
  // could not have told you: how much silence the ledger is currently buying
  // (#6376). Zero is the goal and `--lower` is one command away from it.
  console.log(
    surplusEntries === 0
      ? `  surplus: none — every entry sits exactly at its measurement, so any new error is red.`
      : `  surplus: ${surplus} raw error(s) across ${surplusEntries} entr(ies) sit BELOW their recorded ` +
        `ceiling — that many regressions can land in layers no other gate reads without this one saying ` +
        `anything (${SURPLUS_ISSUE}). Close it with \`pnpm check:type-check-debt --lower\`.`,
  );
}
