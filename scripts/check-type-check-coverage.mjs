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
//   node scripts/check-type-check-coverage.mjs --re-measure   # + runs tsc per ledger entry
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
//               a package whose tsconfig `exclude`s its own `*.test.ts` /
//               `*.spec.ts` carries a measured TEST_DEBT entry. `tsc --noEmit`
//               reads the package tsconfig, so an exclusion there hides the
//               tests from the very check the `typecheck` script advertises --
//               COVERED and REAL both pass while nothing reads the files
//               #4311 is actually about. This invariant is why the ledger is
//               two ledgers: DEBT is "src does not check", TEST_DEBT is "src
//               checks, tests are hidden", and they are independent.
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
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
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
    errors: 92,
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
  '@objectstack/rest': {
    errors: 2,
    note: 'code-tier 2 (TS2345).',
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
    errors: 5,
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
  '@objectstack/service-settings': {
    errors: 13,
    note: 'code-tier 12 (TS2345 x7: manifest action handlers called without `namespace`/`actionId`; TS2322) + 1 noise. Was ledgered at 44 with "no code-tier finding" -- wrong in both directions: 31 of those 44 were unresolved imports (see the NodeNext note at the top of this ledger), and the resolution they were blocking is what made the 12 real ones visible.',
  },
  '@objectstack/service-storage': {
    errors: 52,
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

// Package name -> { tests, errors, note? } for packages whose tsconfig excludes
// their own test files. `tests` is the number of hidden `*.test.ts`/`*.spec.ts`
// files, `errors` what `tsc --noEmit` reports once the exclusion is lifted --
// both measured by re-running each package's own config with the test globs
// dropped. These packages are NOT uncovered: their src type-checks and most
// declare `typecheck`. What they hide is the test layer, which is where #4311
// found the defects (a passing vitest run proves the code executes, not that
// the call shapes match). Sorted by what each is hiding, worst first.
// `@objectstack/spec` graduated in #5286: `tsconfig.test.json` (a sibling of
// the build config, named by the `typecheck` script) compiles its 295 test
// files, so nothing is hidden any more and TESTS_COVERED no longer wants an
// entry here. The residue that lifting the exclusion surfaced did not vanish
// with the entry -- it moved to `packages/spec/test-typecheck-debt.json`, a
// PER-FILE exact ratchet re-measured by tsc on every run, which is strictly
// stronger than the frozen package-level number this ledger could hold. The
// number that used to sit here (272 files / 902 errors) was also stale by 23
// files, which is the other argument for a measurement the gate derives.
//
// Re-measured wholesale on main @ 5ab08428 (2026-08-06) with the DEBT ledger
// above, for the same reason (#5278): 10 of these 19 `errors` numbers were
// understated, 2 overstated, 7 exact. `errors` is now re-run by --re-measure;
// `tests` is not, and it had drifted just as far in the same direction (66 ->
// 101 for runtime, 87 -> 125 for objectql) because adding a test file to an
// excluded package is invisible to everything. Both fields are accurate as of
// that sha; only one of them is enforced, which is filed rather than silently
// widened here.
const TEST_DEBT = {
  '@objectstack/plugin-approvals': {
    tests: 19,
    errors: 547,
    note: 'TS2339 x296, TS2345 x213, TS2550 x20, TS18048 x10. Re-measured 547 at 5ab08428, up from 467. '
      + 'Still larger than driver-sql ever was, and still entirely test-only (src is clean), so nothing '
      + 'but this ledger has ever seen it. 443 of the 547 are in one file, src/approval-service.test.ts.',
  },
  '@objectstack/objectql': {
    tests: 130,
    errors: 355,
    note: 'TS2339 x115, TS2554 x93 (wrong arity), TS7006 x47, TS2345 x19, TS2322 x12, TS2749 x11. '
      + 'Re-measured 333 at 5ab08428, up from 219 -- the largest absolute growth in either ledger. The '
      + 'shape held (TS2339/TS2554/TS7006 still lead) but every number roughly tripled, and the file count '
      + 'went 87 -> 127; src/engine.test.ts alone carries 103. Then +2 at 909895dc (+1 TS2339 in '
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
    tests: 102,
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
  '@objectstack/rest': {
    tests: 62,
    errors: 163,
    note: 'TS2835 x67 (NodeNext extensions), TS7006 x57, TS2554 x13, TS2550 x10. Also in DEBT. Measured '
      + '105 -> 136 (5ab08428) -> 143 (77adf29, hours later the same day) -> 153 (e8db1a230). Read the '
      + 'top-of-ledger NodeNext note before sizing this one: TS2835 and the implicit-any pile it causes '
      + 'are 124 of the 153, and '
      + 'they are one repair, not 124. Of the latest +10, 8 are attributable to three test files this '
      + 'window added -- rest-meta-save-receipt-envelope.test.ts x4 (#5265 / PR #5926), '
      + 'meta-item-envelope.test.ts x2 (#5563 / PR #5895), '
      + 'analytics-dataset-unlisted-refusal-envelope.test.ts x2; the remaining 2 landed in files that '
      + 'already existed and are NOT attributed further, because the pre-merge per-file counts were not '
      + 'retained and a made-up attribution is worse than an admitted gap. This is also the '
      + 'fastest-moving entry in either ledger, and it is '
      + 'the one that proved the gate works: #5278\'s own PR went red in CI on it, because a `pull_request` '
      + 'run builds the branch MERGED INTO main and three rest-touching PRs had landed since the sweep. A '
      + 'ledger number is always a number about a moment. RECORDED 163 is a bootstrap margin (+10 over 153 '
      + 'measured at e8db1a230 and re-confirmed at 153 an hour later at 77c7c884b) -- tighten via the ℹ '
      + 'hint immediately after landing (#5278 option A).',
  },
  '@objectstack/plugin-auth': {
    tests: 38,
    errors: 131,
    note: 'TS2493 x42 (tuple index out of range), TS18048 x24, TS2740 x19, TS2322 x11, TS2532 x9, '
      + 'TS2339 x8, TS2741 x8. '
      + 'Measured 124 -> 129 (5ab08428, composition unchanged in shape) -> 131 (e8db1a230). Half of the '
      + 'latest +2 is a TS2554 in src/last-admin-guard.test.ts, a file added by #5941 / PR #5993 '
      + '(the break-glass delete guard); the other 1 landed in a file that already existed and is not '
      + 'attributed further. 64 of the 131 sit in src/auth-manager.test.ts, 22 in '
      + 'src/admin-import-users.test.ts and 18 in src/admin-user-endpoints.test.ts.',
  },
  '@objectstack/mcp': {
    tests: 9,
    errors: 63,
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
      + 'prompt primitives, which is also why the file count moved 8 -> 9. The old note\'s composition '
      + 'was misleading in the way the top of this ledger warns about: it read "`error` is of type '
      + 'unknown, one catch-block idiom", while all 51 are the response-body `json` binding, not a '
      + 'catch block. packages/mcp took a feature landing the same day, so it is an actively-moving '
      + 'package and an exact number here would very likely lose the same race that killed option D '
      + 'five times over. RECORDED 63 is a bootstrap margin (+10 over 53 measured at 34558c2cc) -- '
      + 'tighten via the ℹ hint immediately after landing (#5278 option A).',
  },
  '@objectstack/driver-mongodb': {
    tests: 15,
    errors: 43,
    note: 'TS2345 x33, TS1309 x7, TS2550 x3. Re-measured 43 at 5ab08428, DOWN from 44 -- but the '
      + 'composition changed completely: the TS2591 x15 the old note pinned on a missing `types:["node"]` '
      + 'are all gone, and TS1309 (await in a non-async context) has appeared. A -1 delta over a ledger '
      + 'entry that turned over two thirds of its content is exactly why counts alone cannot be trusted '
      + 'to describe debt (#5278).',
  },
  '@objectstack/lint': {
    tests: 61,
    errors: 42,
    note: 'TS7006 x22, TS2835 x6, TS6059 x4. Measured 26 -> 30 (5ab08428, the +4 being TS6059, a file '
      + 'outside rootDir, a class the pre-#5278 note did not list) -> 32 (e8db1a230). The latest +2 are '
      + 'both TS7006 and both in files that already existed; three lint test files changed in this window '
      + '(#5762 / PR #5952, #5378 / PR #5904) and the pre-merge per-file counts were not retained, so the '
      + 'delta is recorded rather than attributed. 10 of the 32 sit in '
      + 'src/validate-visibility-predicates.test.ts. RECORDED 42 is a bootstrap margin (+10 over 32 '
      + 'measured at e8db1a230 and re-confirmed at 32 an hour later at 77c7c884b) -- tighten via the ℹ '
      + 'hint immediately after landing (#5278 option A).',
  },
  '@objectstack/plugin-security': { tests: 35, errors: 21, note: 'TS2739 x8, TS2740 x5, TS2345/TS2322/TS2741 x2 each -- incomplete literals. Re-measured 21 at 5ab08428, up from 20, and still 21 at e8db1a230 across 35 test files rather than 34 -- the file count moved, the error count did not.' },
  '@objectstack/formula': { tests: 16, errors: 17, note: 'TS2591 x6 (`process`), TS2345 x3, TS2352 x3, TS1470 x2, TS2339 x2. Re-measured 17 at 5ab08428, up from 12; the TS2591 half doubled, which is the missing `types:["node"]` again rather than five new defects.' },
  '@objectstack/trigger-record-change': { tests: 5, errors: 9, note: 'TS2353 x9 -- still the one unknown-property shape repeated, now in four files. Re-measured 9 at 5ab08428, up from 8.' },
  '@objectstack/verify': { tests: 4, errors: 8, note: 'TS2835 x4, TS7006 x4. Re-measured 8 at 5ab08428, up from 6; both classes are the NodeNext pair from the top-of-ledger note.' },
  '@objectstack/connector-mcp': { tests: 3, errors: 5, note: 'TS2339 x5. Re-measured 5 at 5ab08428, exact.' },
  '@objectstack/connector-openapi': { tests: 3, errors: 5, note: 'TS2339 x5. Re-measured 5 at 5ab08428, exact.' },
  '@objectstack/http-conformance': {
    tests: 2,
    errors: 4,
    note: 'TS2307 x2, TS2304 x1, TS2740 x1. Re-measured 4 at 5ab08428, up from 1. Worth knowing before '
      + 'anyone tries to graduate it: 2 of the 4 are reported inside node_modules `.d.ts` files '
      + '(@better-auth/core, @better-fetch/fetch), so this entry moves with the lockfile and not only with '
      + 'this package\'s own code. Raw `tsc --noEmit` counts are what every number in these ledgers means, '
      + 'so they are counted here rather than filtered out -- but they are not this package\'s debt to fix.',
  },
  '@objectstack/platform-objects': { tests: 9, errors: 3, note: 'TS2339 x2, TS7006 x1. Re-measured 3 at 5ab08428, exact.' },
  '@objectstack/plugin-sharing': { tests: 13, errors: 3, note: 'TS6133 x2, TS18048 x1. Re-measured 3 at 5ab08428, exact.' },
  '@objectstack/service-sms': { tests: 5, errors: 1, note: 'TS2493 x1, in transports.test.ts. Re-measured 1 at 5ab08428 and still 1 at e8db1a230, across 5 test files rather than 3: #5773 added sms-manifest-providers.contract.test.ts and #2814 / PR #6042 added sms-daily-quota.test.ts. The file count moved twice while the error count did not -- both new files are type-clean with the exclusion lifted.' },
  '@objectstack/connector-rest': { tests: 3, errors: 1, note: 'TS6133 x1. Re-measured 1 at 5ab08428, exact.' },
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
 * What this package's tsc programs read, and what they leave out.
 *
 * `excludesTests` is the TESTS_COVERED trigger and now means "some config
 * steers tsc away from the tests AND no config the typecheck script invokes
 * reads them" -- so a package repaired the supported way (a sibling
 * `tsconfig.test.json` named in the script) is covered rather than eternally in
 * debt, while a package that merely OWNS such a file without invoking it is not
 * (#5286).
 *
 * `pinFiles` is PINS_CHECKED's input: test files carrying a `@ts-expect-error`
 * directive that no invoked program compiles. The scan walks the whole package,
 * not just the include roots -- `packages/metadata-core/test/` sat outside
 * `include` with no exclusion naming it (until #5476 put it in a program), and
 * that is just as unchecked.
 *
 * @returns {{excludesTests: boolean, testFiles: number, pinFiles: string[]}}
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
  const anyExcludesTests = configs.some((c) => c.excludesTests);
  const testsInvoked = invoked.filter((c) => !c.excludesTests);

  const primary = configs.find((c) => c.file === 'tsconfig.json');
  // Count only under the primary config's `include` roots: `exclude` subtracts
  // from what `include` selected, so a test file outside those roots is already
  // out of the program and is not what this exclusion hides. Several packages
  // keep a sibling `test/` tree that their `include` never mentions -- counting
  // it here would attribute files to an exclusion that has no bearing on them
  // (PINS_CHECKED is what covers those).
  const countRoots = primary ? primary.roots : [''];

  let testFiles = 0;
  const pinFiles = [];
  const seen = new Set();
  const walk = (abs, rel, depth, counting) => {
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
        walk(child, childRel, depth + 1, counting);
      } else if (TEST_FILE.test(entry.name)) {
        if (counting && !seen.has(child)) {
          seen.add(child); // overlapping include roots must not double-count
          testFiles++;
        }
        if (!counting && PIN_DIRECTIVE.test(readFileSync(child, 'utf8'))) {
          if (!testsInvoked.some((c) => configCovers(c, childRel))) pinFiles.push(posix.join(dir, childRel));
        }
      }
    }
  };
  for (const root of countRoots) walk(join(ROOT, dir, root), root, 0, true);
  walk(join(ROOT, dir), '', 0, false);

  return {
    excludesTests: anyExcludesTests && testsInvoked.length === 0,
    testFiles,
    pinFiles: pinFiles.sort(),
  };
}

/** Every workspace member as { name, dir, scripts, hasTsconfig, excludesTests, testFiles }. */
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
 *                excludesTests?: boolean, testFiles?: number, pinFiles?: string[]}>} packages
 * @param {{name: string, scripts: Record<string,string>}} root
 * @param {{ debt: Record<string, {errors: number, note?: string}>,
 *           exempt: Record<string, string>,
 *           testDebt: Record<string, {tests: number, errors: number, note?: string}>,
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
    if (pkg.excludesTests && pkg.testFiles > 0) {
      if (!inTestDebt) {
        problems.push(
          `${pkg.name} (${pkg.dir}): tsconfig.json excludes its own test files, hiding ${pkg.testFiles} of them ` +
            `from \`tsc --noEmit\` -- the check reports green over source it never read (${TRACKING_ISSUE}). ` +
            `Drop the \`*.test.ts\`/\`*.spec.ts\` entry from \`exclude\`, add a sibling \`tsconfig.test.json\` ` +
            `and name it in the \`typecheck\` script (the #5286 route, when the build config must keep the ` +
            `exclusion), or measure what surfaces and add a TEST_DEBT entry in ${SELF}.`,
        );
      } else {
        const entry = state.testDebt[pkg.name];
        if (!entry || typeof entry.errors !== 'number' || entry.errors <= 0) {
          problems.push(
            `${pkg.name}: TEST_DEBT entry has no measured error count -- lift the exclusion, run ` +
              `\`tsc --noEmit\`, record the number, or drop the exclusion for good.`,
          );
        }
      }
    } else if (inTestDebt) {
      problems.push(
        `${pkg.name}: has a TEST_DEBT entry but ${pkg.testFiles === 0 ? 'has no test files' : 'no longer excludes its tests'} -- ` +
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
  for (const name of Object.keys(state.testDebt)) {
    if (!byName.has(name)) {
      problems.push(`TEST_DEBT entry for "${name}" names no workspace package -- remove it from ${SELF}.`);
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
 */
const TSC_SETUP_ERROR = /\berror TS(5058|5083|6053|18003|5012)\b/;

/** Temp project used to lift a tsconfig's own test exclusion. Never committed. */
const REMEASURE_CONFIG = 'tsconfig.debt-remeasure.json';
const REMEASURE_ISSUE = 'https://github.com/objectstack-ai/objectstack/issues/5278';

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
 * @param {string} project repo-relative path to a tsconfig
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
 * The TEST_DEBT number: what the package reports once its tsconfig stops
 * steering tsc away from its own tests. Written as a sibling project that
 * `extends` the real one and re-declares `exclude` without the test globs --
 * a sibling, in the package's own directory, because tsconfig resolves
 * `include`/`outDir`/`rootDir` relative to the file that DECLARES them, so a
 * config generated anywhere else would silently repoint every one of them.
 *
 * Removed in a `finally`: a stray `tsconfig.*.json` left behind would be picked
 * up by this very script's own tsconfig scan on the next run.
 */
function measureTestDebt(dir) {
  const configPath = join(ROOT, dir, REMEASURE_CONFIG);
  const raw = readFileSync(join(ROOT, dir, 'tsconfig.json'), 'utf8').replace(/^\s*\/\/.*$/gm, '');
  const parsed = JSON.parse(raw);
  const kept = (parsed.exclude ?? []).filter((pattern) => !TEST_GLOB.test(pattern));
  writeFileSync(configPath, `${JSON.stringify({ extends: './tsconfig.json', exclude: kept }, null, 2)}\n`);
  try {
    return tscErrorCount(posix.join(dir, REMEASURE_CONFIG));
  } finally {
    rmSync(configPath, { force: true });
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
  const measurements = [];
  for (const [name, entry] of Object.entries(state.debt)) {
    const dir = dirOf.get(name);
    if (dir === undefined) continue; // RECONCILED already failed on this one
    measurements.push({ ledger: 'DEBT', name, dir, recorded: entry.errors ?? 0, actual: measureDebt(dir) });
  }
  for (const [name, entry] of Object.entries(state.testDebt)) {
    const dir = dirOf.get(name);
    if (dir === undefined) continue;
    measurements.push({ ledger: 'TEST_DEBT', name, dir, recorded: entry.errors ?? 0, actual: measureTestDebt(dir) });
  }
  return measurements;
}

/**
 * MEASURED's verdict, pure over already-taken measurements so the self-test
 * pins the semantics without running a compiler.
 *
 * @param {Array<{ledger: string, name: string, recorded: number, actual: number}>} measurements
 * @returns {{problems: string[], notes: string[]}}
 */
function evaluateMeasurements(measurements) {
  const problems = [];
  const notes = [];
  for (const m of measurements) {
    if (m.actual > m.recorded) {
      problems.push(
        `${m.name}: ${m.ledger} records ${m.recorded} raw tsc error(s), \`tsc --noEmit\` now reports ` +
          `${m.actual} (+${m.actual - m.recorded}). ${m.ledger} is frozen debt, not a permission slip -- ` +
          `the ledger is a ratchet and may only shrink (${REMEASURE_ISSUE}). Fix the new errors, or, if they ` +
          `are genuinely irreducible today, raise the entry in ${SELF} AND rewrite its \`note\` to match what ` +
          `the pile is now made of: the composition drifts too, and a note still naming only the old errors ` +
          `reads as "nearly graduated" to the next author while something else entirely has moved in. ` +
          `If the delta cannot be attributed, say that in the note rather than inventing composition.`,
      );
    } else if (m.actual === 0 && m.recorded > 0) {
      notes.push(
        `${m.name}: ${m.ledger} records ${m.recorded}, and tsc now reports 0 -- graduation candidate. ` +
          `Onboard it (add \`"typecheck": "tsc --noEmit"\`, or drop the test exclusion, and delete the ` +
          `ledger entry in the same PR).`,
      );
    } else if (m.actual < m.recorded) {
      notes.push(
        `${m.name}: ${m.ledger} records ${m.recorded}, tsc now reports ${m.actual} ` +
          `(-${m.recorded - m.actual}) -- the entry can be lowered. Not an error: an improvement must not ` +
          `have to pay a bookkeeping toll to land.`,
      );
    }
  }
  return { problems, notes };
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
      label: 'a covered package that excludes its tests fails TESTS_COVERED',
      packages: [pkg('a', { scripts: { typecheck: 'tsc --noEmit' }, excludesTests: true, testFiles: 12 })],
      root: okRoot,
      state: okState,
      expect: [/excludes its own test files, hiding 12 of them/],
    },
    {
      label: 'a test-debt entry covers the exclusion, but an empty measurement fails',
      packages: [
        pkg('a', { scripts: { typecheck: 'tsc --noEmit' }, excludesTests: true, testFiles: 3 }),
        pkg('b', { scripts: { typecheck: 'tsc --noEmit' }, excludesTests: true, testFiles: 4 }),
      ],
      root: okRoot,
      state: { ...okState, testDebt: { a: { tests: 3, errors: 9 }, b: { tests: 4, errors: 0 } } },
      expect: [/b: TEST_DEBT entry has no measured error count/],
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
      packages: [pkg('a', { scripts: { typecheck: 'tsc --noEmit' }, excludesTests: true, testFiles: 0 })],
      root: okRoot,
      state: okState,
      expect: [],
    },
    {
      label: 'dropping the exclusion without deleting TEST_DEBT fails RECONCILED',
      packages: [pkg('a', { scripts: { typecheck: 'tsc --noEmit' }, excludesTests: false, testFiles: 5 })],
      root: okRoot,
      state: { ...okState, testDebt: { a: { tests: 5, errors: 7 } } },
      expect: [/a: has a TEST_DEBT entry but no longer excludes its tests/],
    },
    {
      label: 'TEST_DEBT for a vanished package fails RECONCILED',
      packages: [pkg('a', { scripts: { typecheck: 'tsc --noEmit' } })],
      root: okRoot,
      state: { ...okState, testDebt: { gone: { tests: 1, errors: 1 } } },
      expect: [/TEST_DEBT entry for "gone" names no workspace package/],
    },
    {
      label: 'test exclusion is judged independently of src coverage',
      packages: [pkg('a', { excludesTests: true, testFiles: 6 })],
      root: okRoot,
      state: { ...okState, debt: { a: { errors: 4 } } },
      expect: [/a \(packages\/a\): tsconfig.json excludes its own test files/],
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
    },
  ];
  for (const c of driftCases) {
    const got = evaluateMeasurements(c.measurements);
    const ok =
      got.problems.length === c.problems.length &&
      got.notes.length === c.notes.length &&
      c.problems.every((rx, i) => rx.test(got.problems[i])) &&
      c.notes.every((rx, i) => rx.test(got.notes[i]));
    if (!ok) {
      failures.push(
        `evaluateMeasurements — ${c.label}: expected ${c.problems.length} problem(s) / ${c.notes.length} note(s) ` +
          `matching, got ${JSON.stringify(got)}`,
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

  if (failures.length) {
    console.error(`✗ check:type-check-coverage --self-test — ${failures.length} failure(s)\n`);
    for (const f of failures) console.error('  • ' + f);
    process.exit(1);
  }
  console.log(
    `✓ check:type-check-coverage --self-test — ${cases.length} semantic case(s) + ` +
      `${namedCases.length + coverCases.length} observation case(s) + ` +
      `${driftCases.length + countCases.length} re-measure case(s) hold.`,
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
const testDebtFiles = Object.values(TEST_DEBT).reduce((sum, e) => sum + (e.tests ?? 0), 0);
// Both numbers, always. Reporting only the src figure is how the first pass of
// this gate read as 48/77 green while 568 test files went unchecked.
console.log(
  `check-type-check-coverage: OK — ${covered}/${packages.length} workspace packages type-checked ` +
    `(plus the root), ${Object.keys(DEBT).length} in the DEBT ledger (${debtTotal} frozen raw errors, ` +
    `${TRACKING_ISSUE}), ${Object.keys(EXEMPT).length} exempt.\n` +
    `  test layer: ${Object.keys(TEST_DEBT).length} package(s) still exclude their own tests ` +
    `(${testDebtFiles} files, ${testDebtErrors} frozen raw errors in TEST_DEBT).`,
);

// MEASURED runs only when asked, and only after the structural verdict above is
// clean: a ledger entry naming a package that no longer exists has nothing to
// measure, and a wall of tsc output would bury the real failure. Reported after
// the summary so the two verdicts read in the order they were reached.
if (process.argv.includes('--re-measure')) {
  const started = Date.now();
  const measurements = measureLedgers(packages, root.name, state);
  const { problems: drift, notes } = evaluateMeasurements(measurements);
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  for (const n of notes) console.log('  ℹ ' + n);
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
}
