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
// ## Exit codes -- and why a REFUSAL has one of its own
//
//   0  the tree was read and every invariant above holds.
//   1  a FINDING: a structural problem, or -- under `--re-measure` -- a ledger
//      entry that drifted UPWARD. A claim about the tree.
//   3  PREREQUISITE NOT MET. The gate refused to measure, so nothing was
//      measured and the run says NOTHING about the ledger. NOT a pass, and
//      NOT a finding.
//
// The split is the sibling convention, not a local invention:
// `check-test-completeness.mjs` states it in its own failure text ("Exit code
// 3, distinct from a finding's 1") and `check-dual-build-cjs-loads.mjs`
// answers the IDENTICAL condition -- a gate that reads built output, run
// against a tree with no `dist/` -- with 3. This gate used to answer it by
// letting the refusal reach node's uncaught handler, which exits 1.
//
// ⭐ Why the class matters HERE in particular, more than it does for a gate
// whose 1 means "something is wrong somewhere". Exit 1 from this gate has one
// specific meaning: a package's recorded debt went UP. The remedy that meaning
// prescribes ends at the ledger below, and raising a DEBT/TEST_DEBT entry is a
// MAINTAINER-only act this file spells out at length. So a reader who takes an
// unmeasurable run for that red is pointed straight at the one place this
// evidence must never send them. The prose said so all along -- but the prose
// is not what an exit-code reader reads. A CI step, a wrapper, or an agent
// reconciling a derived gate family sees the number and nothing else.
//
// ⛔ The boundary, deliberately. Exit 3 is for a prerequisite the WORLD failed
// to supply and that the caller clears with a named command: an unbuilt or
// stale dependency closure, a closure that does not build, an absent `turbo`
// or `tsc` binary, a tsc that could not be spawned or could not read the
// project it was handed. A malformed `tsconfig.json` checked INTO the tree
// stays exit 1 -- that is a fact about the tree, which is what a finding is,
// and `readTsconfig` keeps throwing it.
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
//   SOURCES_COVERED
//               a package that DECLARES a `typecheck` script has no directory of
//               non-test source sitting outside every tsc program that script
//               runs, or the directory carries an UNCHECKED_SOURCE_DEBT entry
//               below (#10756).
//
//               The layer above is package-granular and this one is not, which
//               is the whole gap. COVERED asks "does a `typecheck` script
//               exist"; it cannot see a package that has one whose tsconfig
//               `include` omits an entire source directory.
//               `@objectstack/objectql` passed as covered with
//               `packages/objectql/scripts/**` -- a compatibility checker with a
//               documented CLI, imported by one of its own tests -- in no
//               program its `typecheck` ran, and a `number` initialised with a
//               string could sit in that directory without moving the gate.
//
//               NOT the same invariant as TESTS_COVERED, and worth saying why
//               it is not folded into it: that one decides per test FILE, and a
//               non-test module is hidden by the same `include` for the same
//               reason while belonging to neither ledger --
//               `packages/cli/test/helpers/serve-process.ts` is the measured
//               instance. The AGENTS.md rule both generalise ("never `exclude`
//               tests from a package's tsconfig") is written about a file glob,
//               so it does not reach a directory no `include` ever named.
//
//               Scoped to SUBDIRECTORIES: a package-root tool config
//               (`vitest.config.ts`, `tsup.config.ts`) is unchecked TypeScript
//               too, but it is one repo-wide convention across 42 packages
//               rather than 42 decisions, and the census that seeded this
//               invariant kept the two apart -- 54 root configs, 11 files in a
//               source directory. The exclusion is argued in full, both ways,
//               on UNCHECKED_SOURCE_DEBT below.
//   GENERATED_COVERED
//               a tsconfig `include` entry rooted in a GENERATED path -- one the
//               repo's own ignore rules say is not checked in -- is either
//               produced by the package's own `typecheck` script BEFORE tsc
//               runs, or carries a row in GENERATED_INCLUDE_ROOTS below saying
//               it is deliberately not produced, and why (#10880).
//
//               One notch further along than REAL, and the distance is the
//               whole point. REAL asks whether the script invokes tsc at all;
//               this asks whether the PROGRAM tsc gets is the one the config
//               advertises. `apps/docs/tsconfig.json` includes
//               `.next/types/**/*.ts`, written by `next typegen`, and the wired
//               script was a bare `tsc --noEmit`: measured on main @ 7d483e1e5f
//               with `.next` deleted, it exited 0 having compiled none of the
//               generated route types (`tsc --listFiles` 1225 -> 1231 once
//               typegen ran, the difference including a 160-line `validator.ts`
//               that checks 13 route entry points). An ablation gave a layout a
//               `params` shape its route cannot supply: the bare script stayed
//               at exit 0 / 0 errors and the typegen'd one failed TS2344.
//               COVERED, REAL, TESTS_COVERED, SOURCES_COVERED and RUNNABLE all
//               passed the whole time, because every one of them is a question
//               about files that EXIST.
//
//               The failure DIRECTION is what makes this an invariant rather
//               than a lint. An absent generated directory makes tsc read GREEN
//               over files that were never in the program -- silence that looks
//               exactly like success. Every other way of getting the same
//               config wrong (a stale directory, a generator that fails) ends
//               in a red somebody reads.
//
//               "Declared, and deliberately NOT generated" has to be a passing
//               state, because deleting the offending glob is not available as
//               a repair: Next owns that array and `writeConfigurationDefaults`
//               re-adds `.next/dev/types/**/*.ts` on the next `next dev` /
//               `next build` (#10879 measured it by running that routine
//               against a narrowed copy -- the glob came straight back and the
//               file was rewritten). A guard that only accepted "generated by
//               the script" would leave the honest answer unsayable and push
//               the next author toward a narrowing Next undoes. So a row may
//               declare no generator at all -- with a reason, which is the part
//               a human reviews and the part nothing mechanical can supply.
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
//               surplus should additionally be enforced WAS #6376's open
//               question; #6376 closed (PR #6510) deciding NOT to -- report
//               and offer `--lower`, never fail on a surplus by itself -- and
//               that decision is this paragraph's ruling above, not a pointer
//               to an issue that is now closed with nothing left to read there
//               (#11497).
//
//               SWEPT LEDGER-WIDE at ead731756 (#12723), which is the first time
//               all 31 entries were re-measured to answer the surplus question
//               rather than one entry noticed in passing. 4 carried slack, worth
//               118 raw errors: objectql 354 -> 251, runtime 227 -> 217,
//               plugin-auth 97 -> 94, plugin-approvals 347 -> 345. The shape of
//               that result is the part worth keeping, and it is not the one the
//               card predicted. ALL FOUR ARE TEST_DEBT; not one of the 13 DEBT
//               entries had moved, each measuring its recorded number to the
//               unit. That asymmetry has a mechanical cause rather than a moral
//               one: a DEBT entry's number is what the package's OWN `typecheck`
//               would report if it had one, so ordinary repair work in those
//               packages is visible to whoever does it, while a TEST_DEBT number
//               is only ever produced by the temp project this file generates --
//               nothing a contributor runs reports it, so fixing a test-layer
//               type error here moves a number NOBODY SEES until the next
//               re-measure. The surplus is therefore not evenly distributed
//               noise; it accumulates in exactly the layer whose measurement is
//               invisible outside this gate.
//
//               ⛔ Read that 118 as a measurement of ONE MOMENT, not as a
//               standing property. It is what four months of ordinary repair
//               work banked between sweeps, and the entries above sit at their
//               measurement again as of that sha -- so the next reader must
//               re-measure rather than quote this paragraph, exactly as the
//               bootstrap-margin roster above must not be read as a current
//               inventory. What the number IS good for is sizing the open
//               design question: whether a surplus should additionally make this
//               gate RED (a self-tightening ratchet). #6376 decided not to when
//               the mechanism was built, and this sweep is the first evidence
//               about what that costs in practice.
//
//               What drifts is not only the NUMBER but the note's COMPOSITION:
//               service-automation's note named `engine.test.ts:2547/2577` as
//               the whole debt while three TS2341 in a different file, from an
//               unrelated PR, had joined it. So when this invariant makes you
//               raise a count, rewrite the note to match what the pile is now
//               made of -- and when the delta cannot be attributed, say so in
//               the note rather than inventing composition.
//
//               LOWERING desynchronises the composition too, and for a long
//               time this paragraph only said "raise". It was written that way
//               because a note describing a pile LARGER than what exists reads
//               as misleading in the safe direction -- but a note that itemises
//               34 + 24 + 34 above a field reading 89 does not mislead safely,
//               it CONTRADICTS ITS OWN FIELD, and nothing mechanical read the
//               prose to say so. Two instances were repaired by hand on the
//               same day: service-automation opening `code-tier 5.` over
//               `errors: 3` (#10721), and metadata itemising 92 over
//               `errors: 89` (#10775). Neither repair closed the class, because
//               `--lower` MINTS it -- it rewrites the digits and carries the
//               note through untouched, so the sanctioned one-command way to
//               close a surplus was also the way to desynchronise a note
//               (#10722).
//
//               So the rule has a mechanical half in both places now. A leading
//               tier itemisation must sum to `errors` (COMPOSITION, below), and
//               `--lower` writes `compositionAt` beside the number it lowers so
//               the itemisation says out loud which pile it still describes.
//               Raising a count still means rewriting the note: `compositionAt`
//               may only ever declare a pile LARGER than the field, so it
//               cannot launder a raise -- and an unattributable delta is still
//               an admitted gap rather than an invented composition.
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
//               BOOTSTRAP MARGINS (#5278 option A) -- ALL FIVE PAID OFF, kept
//               here because the shape is what the next hot landing will want.
//               The two paragraphs above describe a race that the
//               exact-calibration loop lost five times running -- objectql
//               333 -> 334 -> 335 -> 339 and lint 30 -> 32, each calibration
//               stale within minutes of being pushed, while seven unrelated PRs
//               were kicked from the queue as collateral. The maintainer's
//               ruling was to land the invariant with a DOCUMENTED margin on the
//               packages that proved hottest rather than run a sixth lap:
//               `@objectstack/objectql`, `@objectstack/lint`,
//               `@objectstack/rest`, `@objectstack/service-storage` and
//               `@objectstack/mcp` were recorded at their measurement PLUS TEN,
//               each saying so in its own note with the measured number and sha.
//
//               ⚠️ NONE OF THE FIVE CARRIES THAT SLACK TODAY. The roster above is
//               the ruling's, not a current inventory, and reading it as one is
//               the mistake this paragraph exists to stop. Four were tightened
//               onto their exact measurement: rest 163 -> 155 (#6939 / #7038,
//               PR #7248), then lint 42 -> 20, mcp 63 -> 53 and
//               service-storage 52 -> 51 in one sweep (#7888 / PR #8225), with
//               lint going 20 -> 19 in #8728. The fifth was never lowered and did
//               not need to be: objectql's RECORDED 355 is untouched and now
//               MEASURES 355 exactly, so its +10 was spent by real growth rather
//               than handed back. Both routes end in the same place, and it is
//               the intended one -- every entry in both ledgers now sits at its
//               measurement, so the next new error anywhere is red on arrival.
//
//               A margin remains the ledger's ONLY sanctioned slack, and it is
//               deliberately loud: nothing here may sit above its measurement,
//               and a margin is not a place to hide a real increase. Because
//               shrinkage is informational, any entry above its measurement
//               prints its own `ℹ ... can be lowered` line on every run -- that
//               line IS the tightening worklist, and closing it is a follow-up
//               PR, not a thing to leave running for months. Re-establishing a
//               margin deliberately is still available and is a maintainer call,
//               exactly as raising any ceiling is.
//
//               ALL FIVE per-entry notes now narrate the present tense, and
//               each carries a tally re-measured rather than rescaled: lint in
//               #8728, then mcp, service-storage and objectql at 62b2655d8. The
//               two that had to be fixed as ARITHMETIC were mcp and
//               service-storage, whose notes still read "RECORDED 63 is a
//               bootstrap margin" against an `errors` field that already
//               disagreed with them. objectql needed something else, and the
//               difference is the part worth keeping: its note was TRUE AS
//               HISTORY and misleading only as present tense, because its
//               margin was never tightened away -- it was spent by growth, so
//               the entry stands at a recorded number it now measures exactly.
//               A note that states a RECORDED number the field beside it
//               contradicts is the single most reliable way to make the next
//               reader mis-derive this policy: it is what made #8728's dispatch
//               conclude the margins might still be live, costing a full
//               five-package re-measure to disprove.
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
import { getHeapStatistics } from 'node:v8';
import {
  selfTest as workspaceEnumeratorSelfTest,
  workspacePackageDirs,
} from './workspace-enumerator.mjs';
// `typecheck`-script -> tsconfig program set. Shared with
// `check-type-source-resolution.mjs` since #11490, which needs the identical
// answer to decide its POPULATION: two copies of this predicate drift, and the
// symptom of drift is a green gate on either side.
import {
  configsNamedByTypecheck,
  typecheckScriptChain,
  SELF_TEST_CASE_COUNT as TYPECHECK_CONFIGS_CASES,
  selfTest as typecheckConfigsSelfTest,
} from './typecheck-configs.mjs';

// Anchored to the script, not to cwd: the verdict must not depend on where the
// guard was invoked from.
const ROOT = resolve(import.meta.dirname, '..');
const SELF = 'scripts/check-type-check-coverage.mjs';
const TRACKING_ISSUE = 'https://github.com/objectstack-ai/objectstack/issues/4311';

// The exit-code contract, NAMED rather than spelled inline at each site, so the
// self-test pins the value each path actually returns instead of a comment
// about it -- the shape `check-test-completeness.mjs` uses for the same split.
//
// ⛔ Module-local, NOT exported, and that is a decision rather than an
// oversight: this file's top level RUNS (it is a gate, invoked as a script and
// nothing else), so exporting any binding at all would make it importable for
// that binding and run the whole gate inside the importer -- the class
// `check:entry-guard` refuses, and it caught this constant block on its first
// run. The sibling that does export its codes carries `isEntrypoint` for
// exactly this reason. Nothing imports this file today; the day something
// needs to, the guard comes with the export.
const EXIT_OK = 0;
const EXIT_FINDINGS = 1;
const EXIT_PREREQUISITE_NOT_MET = 3;

/**
 * The text a refusal prints, as a VALUE -- so the self-test can assert on the
 * advisory without spawning a process or stubbing `process.exit`, the split
 * `import-prerequisite.mjs` documents for the same reason.
 *
 * The gate's own refusal message is embedded VERBATIM. Every one of them was
 * already argued at length at its throw site, and none of that reasoning is
 * this frame's to restate, shorten or improve -- the frame adds only the two
 * things a reader could not get from the message: what CLASS of result this is,
 * and which exit code carries it.
 *
 * The pipe advisory is not decoration. `EXIT=$?` written after `cmd | tail -40`
 * reads TAIL's status, and `head`/`tail` essentially never fail -- so a refusal
 * and a green run are the same `0` there, which is the one reading this whole
 * exit-code split exists to make impossible.
 *
 * @param {string} message the refusal, in the words of the site that raised it
 * @returns {string}
 */
function prerequisiteNotMetText(message) {
  return (
    `\ncheck-type-check-coverage: PREREQUISITE NOT MET\n\n` +
    `${message}\n\n` +
    `  ⛔ This is NOT a pass and NOT a finding: nothing was measured, so this run says\n` +
    `  NOTHING about whether any DEBT or TEST_DEBT number is still correct. In particular\n` +
    `  it is NOT evidence that a recorded number went up, and ⛔ no ledger entry below may\n` +
    `  be raised on it -- raising one is a maintainer's act even when the evidence is real.\n` +
    `  (Exit code ${EXIT_PREREQUISITE_NOT_MET}, distinct from a finding's ${EXIT_FINDINGS} — capture it BEFORE any pipe:\n` +
    `  \`node ${SELF} --re-measure > /tmp/type-check-debt.log 2>&1; echo "EXIT=$?"\`.\n` +
    `  Piped, \`$?\` is the LAST command's status, and \`head\`/\`tail\` essentially never fail — that\n` +
    `  is the false green. \`\${PIPESTATUS[0]}\`/\`pipefail\` do recover this gate's own code.)`
  );
}

/**
 * Refuse to measure, and say so in the exit code as well as in the prose.
 *
 * ⛔ Prints and EXITS rather than throwing. A thrown refusal reaches node's
 * uncaught handler, which exits 1 -- the code this gate reserves for "a
 * recorded debt number went UP" -- and prints a stack trace over a message
 * whose whole job is to be read. The self-test pins that the three functions
 * that refuse contain no bare `throw new Error(` for exactly this reason: the
 * rot this repairs is one careless `throw` away from returning.
 *
 * @param {string} message the refusal, in the words of the site that raised it
 * @returns {never}
 */
function refusePrerequisite(message) {
  console.error(prerequisiteNotMetText(message));
  process.exit(EXIT_PREREQUISITE_NOT_MET);
}
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
// The in-tree precedent SOURCES_COVERED's remedy points at: the sibling config
// that put `packages/spec/scripts/**` into a program, named in that package's
// `typecheck` script. Its own header states this defect class in the words the
// finding later used ("the directory was never INCLUDED by anything"), which is
// why the remedy names a file rather than describing a shape (#10756).
const SPEC_SCRIPTS_PRECEDENT = 'packages/spec/tsconfig.scripts.json';
const GENERATED_INCLUDE_ISSUE = 'https://github.com/objectstack-ai/objectstack/issues/10880';

// A path in the root program whose edits move the `@objectstack/spec-monorepo`
// count below, declared as a bare, whole-literal path so the dispatch
// derivation can read it. It accounts for 29 of that entry's 80 -- the largest
// single contributor, and the one an ordinary card actually edits. The note on
// that entry carries the accounting and references this constant instead of
// spelling the path inside its sentence.
//
// Why the SHAPE and not just the mention: scripts/pm/dispatch-gates.mjs scans
// each gate's own module body for path literals and accepts one only when the
// WHOLE string is path-shaped. Named mid-sentence, this path was discarded, and
// the family then scored neither matched nor undetermined but SILENT -- printed
// nowhere at all. A card editing that file was told no check family names its
// paths, which reads as "no gates apply" when it means "no gate names this
// path", and a dev who trusted it would skip the gate most likely to redden the
// diff (measured on such a card: this gate stayed green only because the change
// was designed around the coupling).
//
// This is per-coupling manual upkeep, deliberately. The root program is
// everything outside packages/apps/examples, so no list here can ever be
// complete -- add a constant when a coupling has actually been measured, the way
// this one was. Deleting this one does not go quiet: dispatch-gates' own
// self-test pins that a card editing this path derives check:type-check-coverage.
const ROOT_PROGRAM_COUPLED_SCRIPT = 'scripts/check-test-typecheck.mts';

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
  '@objectstack/metadata': {
    errors: 89,
    note: 'code-tier 30 (TS2345 x30); config-tier 25 (TS2835 x25); noise 34 (TS7006 x33, TS6133). '
      + 'Re-measured 89 at 4b84834a32, DOWN from 92 at 5ab08428 -- itself up from 87, so this entry has '
      + 'now drifted both ways. Against the composition recorded here at 92 the delta is attributable '
      + 'tier by tier: code-tier lost the 4 TS2322 (-4), config-tier gained one TS2835 (+1), noise did '
      + 'not move. TS2353 then TS2322 have each passed through the code tier and left; TS2345 x30 is its '
      + 'only lasting resident. Read the 89 as three mechanical repairs, not 89 problems: all 30 TS2345 '
      + 'are one defect thirty times over, in metadata.test.ts between 608 and 945, every one the same '
      + 'mock PluginContext literal missing registerServiceFactory and getServiceScoped, so one shared '
      + 'fixture closes the code tier outright; the 25 TS2835 are the widest spread (12 files) and are '
      + 'one codemod, a relative import wanting an explicit .js extension under node16 resolution. '
      + 'metadata.test.ts (34) and register-notifies-watchers.test.ts (16) do still hold 50 of the 89, '
      + 'but that is over HALF -- the "two thirds" claimed here was true at neither 92 nor 89.',
  },
  '@objectstack/observability': {
    errors: 11,
    note: 'all code-tier (TS2554 wrong arity x10, TS2552).',
  },
  '@objectstack/service-automation': {
    errors: 3,
    note: 'code-tier 3 (TS2341 x3), all in src/nested-region-parity.test.ts at 95/151/180, where the '
      + 'tests dot-read the private `engine.flows` -- not `engine[\'flows\']`, not `as any` (the casts on '
      + 'two of those lines sit on `.config`, not on the engine, so they do not suppress it). Re-measured '
      + '3 at 53a48c93f4, DOWN from 5 at 5ab08428: the two TS2741 in engine.test.ts this note used to '
      + 'itemise alongside them have graduated -- that file now builds its pausing fixtures through a '
      + 'single defineActionDescriptor helper that declares resumeAuthority (#5561), and engine.test.ts '
      + 'still compiles in this project (`--listFiles` lists it) while reporting nothing. The residue is '
      + 'therefore one decision, not an oversight: whether tests may read private state at all. This '
      + 'entry is the specimen #5278 cites for composition drift and has now drifted BOTH ways -- 2 -> 5 '
      + 'by acquiring a second file, then 5 -> 3 by graduating the first -- so re-read what the pile is '
      + 'made of before sizing it, never just the number.',
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
    note: 'code-tier 8 (TS2339 x4, TS2347 x4); config-tier 26 (TS2835 x23, TS2550 x3); noise 17 '
      + '(TS7006 x15, TS6196, TS6133). RE-TALLIED from tsc at the 51 below (62b2655d8), not the older '
      + '42-composition rescaled -- the previous tally summed to 42 and was never restated when this '
      + 'entry was lowered onto 51. The code tier is the half that did NOT move: the same 8, and all 8 '
      + 'sit in two files (src/file-reference-lifecycle.test.ts x4, src/storage-service-plugin.test.ts '
      + 'x4). Everything in the 42 -> 51 delta is config-tier and noise -- TS2835 21 -> 23, TS7006 '
      + '11 -> 15, plus TS2550 x3 (`Array.prototype.at` against a `lib` older than es2022, in '
      + 'src/storage-adapter-list.conformance.test.ts), a class the old tally did not list at all. Which '
      + 'PRs contributed the +9 is NOT attributed: the pre-#8225 per-file counts were not retained, and '
      + 'an invented attribution is worse than an admitted gap. '
      + 'This entry WAS the fourth bootstrap margin, and it earned the label the hard way inside '
      + 'one flight: 42 -> 41 at e8db1a230 (the spec half of the `IStorageService.list(prefix)` '
      + 'retirement, #5540 / PR #5983, removed one error, and it was lowered rather than left standing) '
      + '-> 42 again at 77c7c884b an hour later, when the adapter half (#5541 / PR #6061) deleted the '
      + 'old list tests (-1 TS7006) and added storage-adapter-list-retirement.test.ts (+2 TS2835). A '
      + 'two-PR retirement moves a count twice, and an exact number recorded between the halves is stale '
      + 'before it is pushed -- so this one took the same documented margin as the three proven-hot '
      + 'packages instead of a sixth calibration lap. (The `storage-adapter-list-retirement.test.ts` '
      + 'that history names no longer exists under that name; the adapter-list coverage is now '
      + 'src/storage-adapter-list.conformance.test.ts and src/storage-adapter-list-contract.test.ts.) '
      + 'The two concentrations the old note gave for the 42 both re-verify at 51: 11 in '
      + 'storage-route-ledger.conformance.test.ts and 7 in storage-service-plugin.test.ts, with '
      + 'swappable-storage-service.test.ts x7 and storage-routes.test.ts x5 next. '
      + 'THE MARGIN IS GONE. RECORDED 52 was a bootstrap margin (+10 over 42 measured at 77c7c884b), '
      + 'and it was spending itself the whole time it stood: the real count climbed 42 -> 51 underneath '
      + 'it, which is why the composition above had to be re-tallied rather than adjusted. #7888 / '
      + 'PR #8225 then lowered 52 -> 51 onto the exact measurement, re-confirmed at 51 at 62b2655d8, so '
      + 'the next new error here goes red on arrival (#5278 option A).',
  },
  '@objectstack/spec-monorepo': {
    errors: 26,
    compositionAt: 80,
    note: 'the workspace root itself: code-tier 4 (TS2304 x2, TS2339 x2); config-tier 68 '
      + '(TS2591 x28 / TS2584 x22 -- the root tsconfig still has no `types:["node"]` -- plus TS2307 x17 '
      + 'and TS2550); noise 8 (TS7006 x7, TS6133). Re-measured 80 at 5ab08428, up from 50. This entry '
      + 'drifts differently from a package: the root program is `scripts/` and the top-level configs '
      + '(everything outside packages/apps/examples), so it grows whenever the repo gains a script -- '
      + ROOT_PROGRAM_COUPLED_SCRIPT + ' alone accounts for 29 of the 80, and the analytics-reconcile '
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
// `@objectstack/cli` (144 raw across 65 files, after #8612 repaired the first
// two of its 59 missing import extensions) is deliberately NOT part of that
// graduation -- it is a programme rather than a sitting, and its entry stands.
//
// `@objectstack/trigger-record-change` GRADUATED from this ledger (entry: 9 raw
// TS2353, re-measured 0). It is worth a line here because BOTH remedies the
// graduation message offered at the time were wrong for it -- that message has
// since been split per ledger (#11491), and this is the case it was split on:
//   - "add a `typecheck` script" -- it already had one, and always had. The
//     package was never in DEBT's hole ("src does not check"); it was in this
//     ledger's ("src checks, tests are hidden"), which is why the message's
//     first branch has nothing to do.
//   - "drop the test exclusion" -- MEASURED as a red `main`. It resolves
//     exactly the 10-file program this ledger's re-measure scored at 0 and
//     leaves `dist/` byte-identical (tsup builds `src/index.ts` alone), but the
//     7 tests it re-admits import four workspace packages the BUILD config's
//     program never contained, and `check:type-source-resolution` goes 0 -> 1
//     naming them, against a registry that is shrink-only and whose own message
//     rules that widening the entry is not the fix.
// So it took the #5286 sibling route (`tsconfig.test.json` named by the
// `typecheck` script), which puts the same 10 files in front of tsc while
// leaving `tsconfig.json` -- the only config that gate reads -- untouched. The
// general lesson, which is this ledger's to carry: the two remedies are
// interchangeable only where the excluded tests import nothing the src layer
// does not, and that is a property to MEASURE per package, never to assume.
//
// `@objectstack/rest` GRADUATED from this ledger (#12542; entry: 155 raw,
// re-measured 37 raw across 13 files under the sibling program). It is worth a
// line because the gap between those two numbers is the whole argument for
// fixing the CONFIG before reading the residue, and this entry's own note had
// predicted it: 121 of the 155 were TS2835 plus the implicit-any pile it
// causes, and TS2550 x16 was one `Array.prototype.at` message against a `lib`
// older than es2022. Under `tsconfig.test.json`'s vitest-matching module
// semantics both classes go to ZERO -- TS2835 x72 -> 0, TS2550 x16 -> 0,
// TS7006 x49 -> 4 -- because this package is `"type": "module"`, so NodeNext
// was compiling extensionless relative imports as unresolvable ESM and every
// symbol they named was `any`. What is LEFT is a different shape from what the
// old tally described, and it grew in one place while collapsing in four:
// TS2554 x14 (unchanged to the unit), TS18048 x13 (a class the 155 never
// contained AT ALL -- 'possibly undefined' reads that only become visible once
// the imports above them resolve to real types), TS2345 x5, TS7006 x4,
// TS6133 x1 = 37. That is the #8612 lesson this ledger already carries,
// measured a second time: collapsing a cascade EXPOSES errors as well as
// removing them, and a note sized on the TS2835 line alone would have read as
// "155 minus 121 = 34" and been wrong in both directions.
//
// `@objectstack/plugin-security` GRADUATED from this ledger (#13176; entry: 11
// raw, re-measured 11 EXACTLY at aa16721b6 before repair — same 6 files, same
// per-file counts as the card measured at 1a540e82b, so the number was still
// true when it was retired). It is worth a line for what the split between the
// two module semantics says, because this package is the third shape:
// `packages/rest` fixed the CONFIG and 118 of its 155 collapsed; here the
// config-tier is only 2 of the 11 — TS1470 (`import.meta` compiled as CommonJS)
// and TS2550 (`Array.prototype.at` against a `lib` older than es2022) — and the
// other 9 were real test-code type errors, every one of them REPAIRED in the
// same PR rather than ledgered. So this package leaves with no
// `test-typecheck-debt.json` at all, the call `metadata-core`, `metadata-fs` and
// `trigger-record-change` made: at zero residue a bare
// `tsc --noEmit -p tsconfig.test.json` is the stronger gate, since any error is
// red immediately with no ledger to be added to. The TS1470 is the one worth
// carrying forward: `src/seed-write-refusal.test.ts` documents an author
// steering AROUND that diagnostic — writing `__dirname` instead of
// `import.meta.url` — to keep this entry from going 11 to 12, for a program
// whose verdict no `typecheck` script ever ran. A hidden layer does not only
// hide errors; it also shapes the code written into it.
//
// SINCE MEASURED, across this whole ledger rather than on that one package
// (#11491, at e47d5ef61, by dropping each entry's `"**/*.test.ts"` exclusion
// and reading `check:type-source-resolution`): 14 of the 18 entries that HAVE
// an exclusion go red the way trigger-record-change did, 4 stay green
// (`objectql`, `lint`, `formula`, `verify`), and the 19th (`cli`) has no
// exclusion to drop at all -- its tests are hidden by an `include` that never
// reaches them. So that package was the majority case, not the exception, and
// the graduation message no longer offers the exclusion route without its
// precondition. Re-measure before relying on the split: it moves with every
// import a test file gains.
//
// ── #14062: three plugin entries GRADUATED, and what replaced them ───────────
//
// `plugin-approvals` (345), `plugin-auth` (94) and `plugin-sharing` (3) left
// this ledger on 2026-09-02, and `knowledge-ragflow` (4) left DEBT above in the
// same change. ⛔ None of them was PAID DOWN — read that first, because a
// deleted debt entry normally means the errors are gone and here it does not.
//
// The director ruling of 2026-09-01 on #14062 (maintainer verbatim: 「同意」)
// onboarded all fourteen `packages/plugins/**` packages into the
// `check:test-typecheck` instrument: each has a `tsconfig.test.json` its
// `typecheck` script NAMES, so `hidesTests` is false for all of them and this
// gate's per-PACKAGE approximation of the debt has nothing left to approximate.
// The same errors are now held one level finer, per FILE and per SIGNATURE, in
// each package's own `test-typecheck-debt.json` — 324 / 94 / 3 / 3 respectively
// (approvals reads 324 rather than 345 because the test program uses vitest's
// module semantics, which subtracts 21 config-tier diagnostics that were never
// about the tests). That is the graduation this ledger's own message asks for:
// "the repair is the same one spec took -- put the file in a tsc program", and
// the entry goes when the program exists, not when the number reaches zero.
//
// So the shrink-only guarantee did not loosen here; it moved to a strictly
// sharper instrument, one that also reddens on a wholesale substitution of
// error IDENTITY at a constant total, which a per-package integer cannot see.
const TEST_DEBT = {
  '@objectstack/runtime': {
    errors: 206,
    note: 'TS18048 x91 (possibly-undefined), TS18046 x27, TS2339 x17, TS2493 x15, TS2835 x13, TS2345 x10, '
      + 'TS7006 x8, TS6133 x6, TS2554 x4, TS2353 x4, TS2571 x3, TS2550 x2 -- RE-TALLIED at 206 (#13408). '
      + 'The previous note carried its composition from a 227-era sweep that measured per-entry TOTALS '
      + 'only and said so; this one is a fresh per-code count of the same program the ratchet measures. '
      + 'LOWERED 217 -> 206 (#13408), and the -11 is fully attributed to ONE file: '
      + 'src/http-dispatcher.ready.test.ts held 30 TS18048 reads of the optional '
      + '`HttpDispatcherResult.response` -- 19 added by that card\'s own new /ready suite and 11 that '
      + 'pre-dated it -- and all 30 were replaced by a `responseOf()` narrowing helper, the shape already '
      + 'used by the #8287 suite in src/http-dispatcher.keys.test.ts. That card found them the hard way: '
      + 'the package `typecheck` excludes test files, so its green said nothing about the 19 it had just '
      + 'added, and only this ratchet saw them. Nothing else in the package moved. Earlier lineage: 220 -> '
      + '218 (5ab08428, one of only two entries that ever shrank; TS6133 x25 collapsed to x7 while '
      + 'possibly-undefined grew, so that net -2 hid a much larger churn in both directions) -> 227 '
      + '(e8db1a230, +9 all TS18048 in src/domains/meta-item-envelope.test.ts from #5563 / PR #5895) -> '
      + '217 (ead731756, #12723). Src graduated in #4311 (declares `typecheck`); this is purely the '
      + 'hidden test layer.',
  },
  '@objectstack/cli': {
    errors: 144,
    note: 'TS7006 x59 (implicit any), TS2835 x56 (NodeNext extensions), TS2339 x24, TS2307 x3, TS18046 x2. '
      + 'LOWERED 146 -> 144 (#13109) and RE-TALLIED above from the same run, not rescaled: '
      + 'test/platform-page-i18n-parity.test.ts 2 -> 0 (1 TS2835 + 1 TS7006), from adding the `.js` '
      + 'extension to its one `../src/utils/i18n-extract` import -- the same one-import repair #8612 made '
      + 'twice below, taken here because that file gained new tests in the same PR and untyped test code '
      + 'is what let the cascade grow. FULLY ATTRIBUTED: no other file moved, and the per-code and '
      + 'per-file tallies below were re-measured whole rather than decremented. '
      + 'The package #7353 was really about, and the largest single thing the exclude-shaped detector could '
      + 'not see: `tsconfig.json` says `include: ["src"]` and has no `exclude` AT ALL, so there was never an '
      + 'exclusion to notice, and the test files in the sibling `test/` tree are read by nothing -- not '
      + '`pnpm --filter @objectstack/cli typecheck`, which exits 0 on this package today, not CI, only this '
      + 'ledger. 65 hidden files now, up from 56 at #7353 while the layer itself stayed frozen; the other 57 '
      + 'test files sit under `src` and always compiled, which is why the file count reads 65 and not 122. '
      + 'Lowered 188 -> 146 (#8612), both numbers measured on main at 35086781b with the closure built and '
      + 'the two import extensions as the ONLY difference between the two trees, so the -42 is FULLY '
      + 'ATTRIBUTED with no unexplained remainder: test/i18n-coverage.test.ts 35 -> 0 '
      + '(1 TS2835 + 34 TS7006) and test/i18n-extract.test.ts 7 -> 0 (1 TS2835 + 6 TS7006), from adding the '
      + '`.js` extension to one import each. Outside those two files the before and after diagnostic sets '
      + 'are identical line for line, and nothing new appeared anywhere. '
      + 'WHAT THE PILE IS NOW MADE OF, and it is not a nearly-graduated one: 56 of the 59 extension-less '
      + 'relative imports this layer carried are still there, spread over 23 files, and every one of the 59 '
      + 'surviving TS7006 sits in a file that also carries a TS2835 -- there is no implicit-any anywhere in '
      + 'this layer without a broken import above it, and the 23 files carrying a TS2835 are EVERY file in '
      + 'this layer that carries any error at all. Read the top-of-ledger NodeNext note before sizing it: '
      + 'TS2835 plus the cascade it causes are 115 of the 144 and are 56 repairs, not 115. Concentrated '
      + 'rather than spread -- test/data-model-rules.test.ts x26, test/i18n-declared-surface-gate.test.ts '
      + 'x19, test/i18n-section-coverage.test.ts x18, test/commands.test.ts x15, '
      + 'test/remote-api-commands.test.ts x12 are 90 of it. '
      + 'One thing #8612 learned that the next extension fix here should expect: collapsing a cascade can '
      + 'EXPOSE errors rather than only remove them. Fixing the i18n-extract import took that file from 7 '
      + 'errors to 4 NEW TS2339, because it carried an `(e: { path: string[] })` parameter annotation '
      + 'written to dodge the implicit-any while the import was broken, and that annotation narrowed the '
      + 'real `ExpectedEntry` away; deleting the annotation took the file to 0. Those workaround '
      + 'annotations are part of this debt and are invisible to the count until the import above them '
      + 'resolves, so budget for a repair being bigger than its TS2835 line suggests. '
      + 'RECORDED EXACTLY, no bootstrap margin: this layer has never been gated, so the first new error in '
      + 'it should go red rather than be absorbed.',
  },
  '@objectstack/mcp': {
    errors: 53,
    note: 'TS18046 x51 -- `json` is of type unknown, one `await res.json()` idiom repeated across four '
      + 'files (23 in mcp-server-runtime.http.test.ts, 14 in mcp-action-tools.test.ts, 8 in '
      + 'mcp-http-tools.scopes.test.ts, 6 in mcp-validate-expression.test.ts); TS6133 x1; TS2352 x1. '
      + 'RE-TALLIED from tsc at the 53 below (62b2655d8) and unchanged class for class, which is why the '
      + 'composition above is kept rather than rewritten: the 51 TS18046 sit in exactly those four files '
      + 'in exactly those counts. The two singletons the old tally named by class without saying where '
      + 'are src/skill-prompts.test.ts(185,23) for the TS2352 and '
      + 'src/__tests__/mcp-server-runtime.test.ts(7,1) for the TS6133 (`MCPServerRuntimeConfig` declared, '
      + 'never read). '
      + 'Measured 52 at 5ab08428 -> 53 at 34558c2cc. This entry WAS the fifth bootstrap margin and the '
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
      + 'five times over. THE MARGIN IS GONE, and has been since #7888 / PR #8225 lowered 63 -> 53 onto '
      + 'the exact measurement; RECORDED 63 was that margin (+10 over 53 measured at 34558c2cc) and this '
      + 'sentence is its history, not this entry\'s present state. RECORDED now equals what tsc reports, '
      + 're-confirmed at 53 at 62b2655d8, so the next new error in this package goes red on arrival -- '
      + 're-establishing a margin deliberately remains a maintainer call (#5278 option A).',
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
    errors: 16,
    note: 'TS7006 x11, TS2835 x5, re-tallied from tsc at the 16 below -- not the older '
      + 'composition rescaled. Per file: src/validate-semantic-roles.test.ts x5, '
      + 'src/validate-dashboard-action-refs.test.ts x4, '
      + 'src/validate-filter-tokens.test.ts x3, src/validate-capability-references.test.ts x3, '
      + 'src/validate-managed-api-methods.test.ts x1. The 5 TS2835 are one per file and all the same '
      + "shape -- the test's own relative import of the module under test, missing its `.js`. "
      + 'LOWERED 19 -> 16 in #10779, re-tallied rather than declared stale because the delta is exactly '
      + 'attributable: the 3 that left are the TS6059 this itemisation used to list, all of them in '
      + 'validate-translatable-sections.test.ts, which imports contact.object.ts, contact.view.ts and '
      + 'system/translations/index.ts from examples/app-showcase -- outside this package entirely. They '
      + 'were never this package\'s debt; they were the generated re-measure project reporting on its '
      + 'own inherited `rootDir`, and no author here could have retired them by fixing lint. That file '
      + 'held exactly those 3 and so leaves the per-file list altogether. '
      + 'Measured 26 -> 30 (5ab08428, the +4 being TS6059, a file outside rootDir, a class the pre-#5278 '
      + 'note did not list) -> 32 (e8db1a230), and RECORDED 42 was a bootstrap margin (+10 over that 32). '
      + 'THE MARGIN IS GONE, and has been since #7888 / PR #8225 lowered 42 -> 20 against a measured 20 at '
      + 'b5e09b21 -- that PR deliberately left this note describing the larger pile, because inventing a '
      + 'composition for errors that are gone is the one thing this ledger forbids, so the tally above is '
      + 'the first one taken at the size the entry actually is. Lowered 20 -> 19 at 585edf738 (#8728). '
      + 'The -1 is attributed: #8515 / PR #8610 moved the translation-section-name-missing pins onto the '
      + 'frozen src/showcase-shape.fixtures.ts snapshot and dropped the live `TaskViews` import, which is '
      + 'the TS6059 that left -- the surviving three name exactly the three example files those tests '
      + 'still import. One older claim is now false and is corrected rather than carried: '
      + 'src/validate-visibility-predicates.test.ts held 10 of the 32 and reports none today.',
  },
  '@objectstack/formula': {
    errors: 17,
    note: 'TS2591 x6 (`process`), TS2345 x3, TS2352 x3, TS1470 x2, TS2339 x2, TS2739 x1. Re-measured 17 '
      + 'at 5ab08428, up from 12; the TS2591 half doubled, which is the missing `types:["node"]` again '
      + 'rather than five new defects. The TS2739 was inside that 17 from the start and simply went '
      + 'UNLISTED, so this tally read 16 over a field of 17 until #13631 re-measured 17 at cc837dbfec '
      + 'and restored it -- COMPOSITION reads tier itemisations and does not sum per-code tallies, so '
      + 'nothing mechanical read the gap. It is the only one of the 17 in `src/cel-to-filter.test.ts` '
      + '(173,52), where the local `ok()` helper pins its second argument to the exact shape of the '
      + 'module-level `VARS` and a partial context cannot satisfy it; the same file already carries a '
      + 'hand-widened copy of that helper (`filterOf`) written for exactly that reason.',
  },
  '@objectstack/verify': {
    errors: 3,
    note: 'TS2835 x3 -- `harness.host-resolution`, `harness.posture-only` and `harness.posture` each '
      + 'import `./harness` without the `.js` extension. Re-tallied from the 8 measured at 5ab08428 '
      + '(TS2835 x4, TS7006 x4) when `derive.test.ts` gained its own extension: that ONE unresolved '
      + 'import was carrying 1 x TS2835 plus every TS7006 in the file, because a specifier that does '
      + 'not resolve under NodeNext makes every symbol it names `any` and so every callback parameter '
      + 'implicitly any. The remainder is the same NodeNext pair from the top-of-ledger note, and the '
      + 'same one-line fix graduates this entry.',
  },
  '@objectstack/connector-mcp': { errors: 5, note: 'TS2339 x5. Re-measured 5 at 5ab08428, exact.' },
  '@objectstack/connector-openapi': { errors: 5, note: 'TS2339 x5. Re-measured 5 at 5ab08428, exact.' },
  '@objectstack/http-conformance': {
    errors: 2,
    note: 'TS2307 x1, TS2304 x1, and BOTH are reported inside node_modules `.d.ts` files '
      + '(@better-auth/core\'s `bun:sqlite` import, @better-fetch/fetch\'s `Timer`), so this entry now '
      + 'moves with the lockfile and NOT with this package\'s own code at all -- every file this package '
      + 'checks in is clean with the test exclusion lifted. Raw `tsc --noEmit` counts are what every '
      + 'number in these ledgers means, so they are counted here rather than filtered out -- but they are '
      + 'not this package\'s debt to fix, and this entry cannot graduate by fixing code. Re-measured 2 at '
      + '3954fb7df, DOWN from 3 (#11788). The retired third diagnostic was a TS2307 on '
      + '`@objectstack/spec/contracts` in conformance.integration.test.ts, which this package imported '
      + 'without declaring @objectstack/spec: under pnpm\'s strict layout that specifier reached no '
      + '@objectstack/spec anywhere on its resolution walk, so the old ceiling was a reading of the '
      + 'INSTALL LAYOUT rather than of this package\'s types. Measured three ways on one tree at '
      + '3954fb7df, same sources, same built closure: 3 as installed, 2 with @objectstack/spec merely '
      + 'symlinked into the root node_modules and nothing else touched, 125 with packages/spec/dist moved '
      + 'aside. #11788 declared the dependency, so the specifier now resolves through the closure this '
      + 'gate refreshes and refuses on -- the number dropped because the program became well-defined, '
      + 'not because anything was suppressed.',
  },
  '@objectstack/platform-objects': { errors: 3, note: 'TS2339 x2, TS7006 x1. Re-measured 3 at 5ab08428, exact.' },
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

// Repo-relative DIRECTORY -> why a package that advertises a `typecheck` script
// still has real source in here that no tsc program reads. SOURCES_COVERED's
// ledger (#10756).
//
// The hole this closes, stated as the finding did: `check:type-check-coverage`
// was PACKAGE-granular on the source layer. It asked whether a package declares
// a `typecheck` script, and could not see a package that declares one whose
// tsconfig `include` omits an entire source directory. `@objectstack/objectql`
// passed as COVERED with `packages/objectql/scripts/**` -- a compatibility
// checker with a documented CLI, imported by one of its own tests -- in no
// program its `typecheck` runs. `packages/spec/tsconfig.scripts.json` had
// already written the same observation down for itself in #5475 ("the directory
// was never INCLUDED by anything ... `check:type-check-coverage` could not even
// count it"); this is that observation turned into the count.
//
// SAME CLASS AS TESTS_COVERED, one level up, and deliberately its own invariant
// rather than a widening of it. TESTS_COVERED asks a per-FILE question about
// test files; a non-test module is hidden by the same `include` for the same
// reason and shows up in neither ledger. The AGENTS.md rule these generalise --
// never `exclude` tests from a package's tsconfig -- is written about a file
// glob, so it does not reach a whole directory that no `include` ever named.
//
// THE CENSUS, on main @ 5886ee6d22, since the shape of this ledger is an answer
// to it. Over the 64 packages the headline calls covered, 65 non-test `.ts`
// files sit outside every program that accounts for them:
//
//   54  package-root tool configs -- `vitest.config.ts` x32, `tsup.config.ts`
//       x16, `objectstack.config.ts` x5, `vitest.integration.config.ts` x1
//   11  files in a SOURCE DIRECTORY -- `scripts/i18n-extract.config.ts` x8,
//       `packages/objectql/scripts/dry-run-hash-compat.ts`,
//       `packages/plugins/plugin-auth/examples/basic-usage.ts`,
//       `packages/cli/test/helpers/serve-process.ts`
//
// This invariant governs the SECOND group only, which is why the observation
// half takes files at `depth > 0`. The line is drawn there on evidence rather
// than convenience, and the evidence cuts both ways, so both halves are here:
//
//   FOR -- the 54 are one repo-wide convention, not 42 independent decisions.
//   Every package's `include` is `src/**/*`; a tool config sits at the package
//   root because that is where its tool looks for it, and it is loaded by that
//   tool rather than imported by the package. Ledgering them would seed 42
//   entries that all say the same sentence, and a ledger whose every line is
//   identical is one nobody reads -- which is the failure mode #4311's own
//   header warns about ("a ledger that can only accrete rots into a list nobody
//   trusts").
//
//   AGAINST -- a `vitest.config.ts` is unchecked TypeScript exactly as much as
//   `scripts/dry-run-hash-compat.ts` is, and this line can be walked around by
//   moving a file UP into the package root. That is a real hole and it is left
//   open knowingly, not overlooked: closing it is a decision about 42 packages'
//   conventions rather than about this gate, and it is filed as its own card
//   rather than decided here by whoever happened to be holding this one.
//
// SHRINK-ONLY and CLOSED to new entries, like PHANTOM_PIN_DEBT above. A package
// that grows a new unread source directory fails SOURCES_COVERED; it does not
// get a line here. The repair is the supported one this repo already has a
// precedent for -- a sibling `tsconfig.scripts.json` NAMED in the `typecheck`
// script (`packages/spec`, #5475) -- and then the entry goes, which RECONCILED
// forces anyway.
//
// SEEDED AT 10, from the census above minus the one entry this gate's own PR
// repaired: `packages/objectql/scripts` -- the directory the finding was filed
// about -- now has `packages/objectql/tsconfig.scripts.json` named in that
// package's `typecheck` script, and type-checks clean. Each remaining reason
// carries what the directory MEASURES, taken with the package's own config and
// `rootDir` neutralised (it emits nothing) against a built dependency closure on
// main @ 5886ee6d22. Those counts are prose, deliberately: nothing here compares
// them, and a number this gate does not read must not look like one it does.
//
// GRADUATED SINCE, so the seed count above is a starting line and not a census
// of what is left: `packages/plugins/plugin-auth/examples` (#10869). Its entry
// recorded 1 x TS2307 for `@objectstack/plugin-hono-server`, a package
// plugin-auth declared in none of its dependency blocks -- and the file was the
// census's only instance of source in NO tsc program at all, which is precisely
// why the missing dependency could sit in a PUBLISHED example
// (`content/docs/permissions/authentication.mdx` links it as "Basic Auth
// Example") without any gate reading it. Repaired on the terms this header
// names rather than by rewriting the entry: the dependency is declared
// (`devDependencies`, `workspace:*`) AND `packages/plugins/plugin-auth/
// tsconfig.examples.json` puts the directory in a program named in that
// package's `typecheck` script, so the compile that reproduced the TS2307 now
// runs on every typecheck. It type-checks clean, so it graduated with zero debt
// recorded anywhere -- and RECONCILED forced the entry out, as this header said
// it would.
//
// AND THE EIGHT `*/scripts` ENTRIES (#11351), which is why this ledger is down
// to one line. All eight were the SAME file -- `scripts/i18n-extract.config.ts`
// -- and all eight notes recorded a TS2883 count (1 for platform-objects, 3 for
// the other seven) that #10868 had already driven to zero by annotating the
// nine configs' `default` export. #10868 did not graduate them, because a
// directory in no tsc program does not graduate by itself; it only made the
// repair this header names possible. Each package now carries a
// `tsconfig.scripts.json` named in its `typecheck` script, and every one of the
// eight measures 0 errors under it.
//
// TWO THINGS WORTH KEEPING from doing it, because both would otherwise be
// rediscovered the hard way:
//
//   `rootDir` IS NOT UNIFORM across the eight, and copying one of these files
//   to the next package is therefore wrong. Five inherit `rootDir: "src"` and
//   must widen it to `"."`; three (plugin-approvals, plugin-audit,
//   plugin-security) already widen it to `"../.."` in `tsconfig.json` to carry
//   a `paths` redirect of a sibling package to SOURCE, so the inherited value
//   already contains `scripts/` and overriding it to `"."` would re-narrow the
//   root below the redirected source. Measured both ways: the `"."` variant is
//   0 for all eight today, the inherited variant is 0 for those three and
//   1 x TS6059 for the other five.
//
//   `packages/spec/tsconfig.scripts.json` IS NOT THE SHAPE TO COPY, even though
//   this header cites it as the precedent for the IDEA. Its
//   `allowImportingTsExtensions`, `module: esnext`,
//   `moduleResolution: bundler`, DOM `lib` and `exclude` are argued in its own
//   header as things that package needs; none of the eight needs any of them,
//   because these configs already spell their relative imports with `.js`.
//   The shape these eight copy is the minimal one -- `packages/objectql`
//   (#10756) and `packages/plugins/plugin-auth` (#10869).
//
// THE NINTH CONFIG IS NOT HERE, deliberately.
// `packages/services/service-storage/scripts/i18n-extract.config.ts` is the
// ninth instance #10868 annotated, and that package appears in no line of this
// ledger for a reason SOURCES_COVERED makes structural: the invariant only asks
// its question of a package that DECLARES a `typecheck` script, and
// service-storage declares none. It is covered instead by
// DEBT['@objectstack/service-storage'], which records 51 errors -- so giving it
// a `typecheck` script is not a one-line graduation, it is a 51-error
// burn-down, and wiring one that ran ONLY `tsconfig.scripts.json` would be
// worse than leaving it: COVERED would start passing on a script that never
// reads `src`, and RECONCILED would then force out a 51-error DEBT entry whose
// errors are all still there. It graduates with that entry, not before it.
const UNCHECKED_SOURCE_DEBT = {
  'packages/cli/test': 'One non-test module, `test/helpers/serve-process.ts`, the spawn harness the '
    + '`os serve` e2e tests share. It measures 0 errors on its own, and it is not separate debt: it '
    + 'sits inside the hidden test tree already measured by TEST_DEBT[\'@objectstack/cli\'] (56 of '
    + 'that package\'s 110 test files are outside `include`). Repairing it means repairing that '
    + 'layer, so this entry graduates with the TEST_DEBT one rather than before it.',
};

/**
 * GENERATED_COVERED's declared table (#10880) -- the generated `include` roots
 * this workspace's tsconfigs name, each paired with the command that produces
 * it, so the framework-specific knowledge sits in DATA and the invariant stays
 * a question about scripts.
 *
 * Keyed by the root PACKAGE-RELATIVE (`.next/types`, not
 * `apps/docs/.next/types`), so one row holds for every Next app the workspace
 * ever gains rather than for the one that seeded it.
 *
 * Two row kinds, and the second is why this is a table rather than a hard-coded
 * `next typegen` test:
 *
 *   generator: '<command>'   the `typecheck` script must run it, and must run
 *                            it BEFORE tsc. Enforced.
 *   generator: null          nothing a typecheck runs produces this, ON
 *                            PURPOSE. `why` then has to carry the argument
 *                            that its absence cannot make the check read
 *                            green -- the one claim here nothing mechanical
 *                            can check, which is exactly why it is written
 *                            down where a reviewer reads it rather than
 *                            inferred.
 *
 * NOT a debt ledger, and deliberately not closed the way DEBT and
 * UNCHECKED_SOURCE_DEBT are: a `generator` row is durable knowledge about a
 * correct config, not a hole waiting to be filled. It is still RECONCILED in
 * the other direction -- a row no `include` names any more is dead knowledge
 * and has to go.
 *
 * The generator claims below are read out of next@16.3.1, the version
 * `apps/docs` resolves (`dist/cli/next-typegen.js`), not inferred from the
 * command name.
 */
const GENERATED_INCLUDE_ROOTS = {
  'next-env.d.ts': {
    generator: 'next typegen',
    why: 'Written by `writeAppTypeDeclarations`, which `next typegen` reaches through '
      + '`verifyAndRunTypeScript` (`dist/cli/next-typegen.js` -> `dist/lib/verify-typescript-setup.js`) '
      + 'before it generates a route type. Gitignored (`next-env.d.ts`, root .gitignore), so in a clean '
      + 'checkout the entry names nothing until that command has run.',
  },
  '.next/types': {
    generator: 'next typegen',
    why: 'The route types themselves: `next typegen` writes `<distDir>/types/routes.d.ts`, '
      + '`validator.ts`, `cache-life.d.ts` and `root-params.d.ts` into exactly this directory '
      + '(`dist/cli/next-typegen.js`). This is the root #10880 was filed about -- a bare `tsc --noEmit` '
      + 'read green over its absence and an ablation proved the missing files were load-bearing.',
  },
  '.next/dev/types': {
    generator: null,
    why: 'Written only by `next dev`, and a typecheck must NOT run a dev server to satisfy a glob. Its '
      + "absence cannot make this check read green: it holds no route entry point of its own -- Next's "
      + 'own build-mode type check FILTERS this directory out of the program (`getDevTypesPath`, '
      + '`lib/typescript/runTypeCheck.js`) "to prevent stale dev types from causing errors when routes '
      + 'have been deleted since the last dev session", so what it can produce locally is a false RED, '
      + 'never a false green (remedy: `rm -rf apps/docs/.next`). The glob cannot be deleted either -- '
      + '`writeConfigurationDefaults` re-adds it on the next `next dev` / `next build` (#10879). '
      + 'Declared, and deliberately not generated.',
  },
};

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
/**
 * The fixed path prefix of an `include` glob -- everything before the first
 * wildcard, with a trailing slash dropped (`src/**\/*` -> `src`,
 * `.next/types/**\/*.ts` -> `.next/types`, `**\/*.ts` -> `''`, i.e. the whole
 * package). A literal entry with no wildcard at all IS its own root
 * (`next-env.d.ts`).
 *
 * Extracted rather than inlined twice because two invariants now read it and
 * they must agree: TESTS_COVERED/SOURCES_COVERED decide what a program reads
 * from these prefixes, and GENERATED_COVERED asks whether the same prefix is
 * checked in. Two copies of this three-operation expression would be two
 * chances to answer the same question differently (#10880).
 */
function includeRoot(glob) {
  return glob.split('*')[0].replace(/\/$/, '');
}

function readTsconfig(dir, file) {
  const raw = readFileSync(join(ROOT, dir, file), 'utf8').replace(/^\s*\/\/.*$/gm, '');
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new Error(`${dir}/${file} is not parseable, so its test coverage cannot be judged`, { cause });
  }
  const include = parsed.include ?? null;
  const declared = Array.isArray(include) ? include.filter((g) => typeof g === 'string') : [];
  const roots = declared.length > 0
    ? [...new Set(declared.map(includeRoot).filter((p) => !p.includes('..')))]
    : [''];
  const exclude = parsed.exclude ?? [];
  return {
    file,
    roots,
    // The `include` array AS AUTHORED, which `roots` cannot stand in for: it is
    // deduped and star-stripped, so it can no longer say WHICH glob promised a
    // given root. GENERATED_COVERED quotes the entry back at the author
    // (#10880), and a message naming `.next/types` where the file says
    // `.next/types/**/*.ts` sends them looking for a line that is not there.
    includes: declared,
    excludesTests: exclude.some((pattern) => TEST_GLOB.test(pattern)),
    // The NON-test exclusions, as path prefixes, for SOURCES_COVERED (#10756).
    // TESTS_COVERED never needed these -- an `exclude` that hides a test file
    // names it with a test glob, which `excludesTests` already answers -- but a
    // source directory can be subtracted by a plain path (`src/templates`), and
    // reading `include` alone would call such a file covered while tsc never
    // opens it.
    excludedPrefixes: exclude
      .filter((pattern) => !TEST_GLOB.test(pattern))
      .map((pattern) => pattern.split('*')[0].replace(/\/$/, ''))
      .filter((prefix) => prefix !== '' && !prefix.includes('..')),
  };
}

/** Is `rel` (posix, relative to the package) inside this config's program? */
function configCovers(config, rel) {
  if (config.excludesTests && TEST_FILE.test(rel)) return false;
  const under = (base) => base === '' || rel === base || rel.startsWith(`${base}/`);
  if ((config.excludedPrefixes ?? []).some((prefix) => under(prefix))) return false;
  return config.roots.some(under);
}

/**
 * A declared generator command as a pattern that matches it in a script body:
 * tokens in order, any run of whitespace between them, and a word boundary at
 * each end that has one. `next typegen` must not be found inside
 * `prenext typegen`, and `next    typegen` in a script is the same command.
 *
 * Built FROM the declared string rather than stored as a regex, so
 * GENERATED_INCLUDE_ROOTS stays a table of commands a reader can copy into a
 * shell (#10880).
 */
function commandPattern(command) {
  const trimmed = command.trim();
  const body = trimmed.split(/\s+/).map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+');
  return new RegExp(`${/^\w/.test(trimmed) ? '\\b' : ''}${body}${/\w$/.test(trimmed) ? '\\b' : ''}`);
}

/**
 * Does this `typecheck` chain run `command`, and run it before tsc?
 *
 *   'missing'  no body mentions it -- the generated directory is whatever an
 *              earlier build left behind, and nothing at all in a clean
 *              checkout.
 *   'after'    a body runs it AFTER its own tsc, so the program tsc read was
 *              still the pre-generator one. Reported ONLY from inside a single
 *              body, where text order is shell order.
 *   'ok'       runs it, and nothing proves it runs late.
 *
 * The abstention is deliberate and is the difference between a guard and a
 * false red: a generator reached through `pnpm <script>` indirection has no
 * knowable position relative to a tsc in a different body, so this answers
 * 'ok' there rather than guessing. Under-reporting one ordering is the safe
 * direction; the missing-command half, which is the measured defect, is not
 * affected by it.
 */
function generatorVerdict(chain, command) {
  const pattern = commandPattern(command);
  let seen = false;
  for (const body of chain) {
    const m = pattern.exec(body);
    if (!m) continue;
    seen = true;
    const tsc = body.search(/\btsc\b/);
    if (tsc === -1) continue; // different body: order is not decidable, abstain
    if (m.index < tsc) return 'ok'; // decided, in the one place order is real
  }
  if (!seen) return 'missing';
  return chain.some((body) => {
    const m = pattern.exec(body);
    const tsc = body.search(/\btsc\b/);
    return m !== null && tsc !== -1 && m.index > tsc;
  })
    ? 'after'
    : 'ok';
}

/**
 * Which of these repo-relative paths does git consider IGNORED -- i.e. which
 * are not checked in, and therefore exist only because something produced them?
 *
 * One batched `check-ignore` for the whole workspace rather than one call per
 * root: the structural pass is the sub-second half of this gate and 100-odd
 * spawns would end that.
 *
 * Three properties this rests on, each chosen over an alternative:
 *
 *   * The ignore RULES are checked in, so the verdict is a property of the
 *     tree rather than of the machine. `core.excludesFile` is emptied on the
 *     command line for the same reason -- a developer's global ignore list
 *     must not be able to change what CI's gate concludes. (`.git/info/exclude`
 *     is per-clone and cannot be neutralised this way; a fresh CI checkout has
 *     none.)
 *   * The INDEX is consulted (no `--no-index`): a path that is tracked reads
 *     as not-ignored even when a rule matches it, which is the right answer --
 *     a force-added directory IS present in a clean checkout.
 *   * Existence is never consulted, so the verdict does not depend on whether
 *     anybody has run a build here. That is what makes this invariant mean the
 *     same thing locally and in CI.
 *
 * A git that cannot answer is a THROW, never an empty set: reading a failed
 * spawn as "nothing here is generated" would retire the invariant silently,
 * which is the failure mode this whole file is about. Requiring git is already
 * this repo's convention for a gate (check-nul-bytes, check-closing-keyword-parity).
 *
 * The self-test does NOT call this -- its fixtures state which entries are
 * generated, so the battery stays hermetic and instant. What guards this
 * function on the real tree is the RECONCILED half of GENERATED_COVERED: if
 * this ever silently answered "nothing is generated", every row in
 * GENERATED_INCLUDE_ROOTS would immediately be a row no `include` names, and
 * the gate goes red naming all three. A broken detector cannot be a quiet one.
 */
function gitIgnoredPaths(rels) {
  if (rels.length === 0) return new Set();
  const res = spawnSync('git', ['-c', 'core.excludesFile=', 'check-ignore', '--stdin', '-z'], {
    cwd: ROOT,
    input: rels.map((r) => `${r}\0`).join(''),
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  });
  if (res.error) {
    refusePrerequisite(
      `git check-ignore could not run, so GENERATED_COVERED cannot be judged: ${res.error.message}`,
    );
  }
  // 0 = some path is ignored, 1 = none is. Anything else (128: not a git
  // checkout, bad option) is a failed MEASUREMENT, not a clean tree.
  if (res.status !== 0 && res.status !== 1) {
    refusePrerequisite(
      `git check-ignore exited ${res.status}, so GENERATED_COVERED cannot be judged: ${String(res.stderr).trim()}`,
    );
  }
  return new Set(res.stdout.split('\0').filter(Boolean));
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
 * Asked about SOURCE files too since #10756, which is why it is named for files
 * rather than for tests: the question "does any program that accounts for this
 * package read this file" is the same question whichever layer the file is in,
 * and answering it in two places would let the two answers drift.
 *
 * @param {string[]} rels package-relative posix paths
 * @returns {string[]} the unread ones, in walk order
 */
function unreadFiles(rels, programs) {
  return rels.filter((rel) => !programs.some((c) => configCovers(c, rel)));
}

/**
 * Is this file one SOURCES_COVERED asks about (#10756)?
 *
 * Three exclusions, each load-bearing:
 *
 *   `depth > 0`   the package-root line. A `vitest.config.ts` beside the
 *                 manifest is a tool's entry point, not a directory of source,
 *                 and the census kept the two apart -- 54 root configs against
 *                 11 files in a source directory. Argued both ways on
 *                 UNCHECKED_SOURCE_DEBT.
 *   `.d.ts`       a declaration file STATES types rather than being checked for
 *                 them, so "no program reads it" is not the same finding.
 *   test files    TESTS_COVERED's subject, decided per file over there. Counting
 *                 them here too would bill one hidden file to two ledgers.
 *
 * @param {string} name basename
 * @param {number} depth 0 at the package root
 */
function isUncheckedSourceCandidate(name, depth) {
  if (depth === 0) return false;
  if (!SOURCE_FILE.test(name) || TEST_FILE.test(name)) return false;
  return !name.endsWith('.d.ts');
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
  const sourceRels = [];
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
      } else if (isUncheckedSourceCandidate(entry.name, depth)) {
        sourceRels.push(childRel);
      }
    }
  };
  walk(join(ROOT, dir), '', 0);

  const hiddenTests = unreadFiles(testRels, accountedPrograms(configs, invoked));
  // PINS_CHECKED stays anchored to the INVOKED programs, not the accounted
  // ones: a pin's whole job is to go red in a check somebody runs, and the
  // `--re-measure` path a DEBT number comes from is not that check.
  const pinFiles = unreadFiles([...pinned], invoked).map((rel) => posix.join(dir, rel));

  // SOURCES_COVERED (#10756), asked ONLY of a package that declares a
  // `typecheck` script. A DEBT package's answer is already "nothing reads this
  // package", which its own ledger owns; asking again here would bill the same
  // hole to two ledgers and make the smaller one unreadable. The subject is a
  // package the coverage headline counts as COVERED.
  const uncheckedByDir = new Map();
  if (scripts.typecheck !== undefined) {
    for (const rel of unreadFiles(sourceRels, accountedPrograms(configs, invoked))) {
      const top = rel.slice(0, rel.indexOf('/'));
      uncheckedByDir.set(top, (uncheckedByDir.get(top) ?? 0) + 1);
    }
  }

  // GENERATED_COVERED's candidates (#10880): every `include` entry of every
  // config the `typecheck` script INVOKES, with the glob kept beside its root.
  // Scoped exactly like SOURCES_COVERED above and for the same two reasons --
  // a package with no `typecheck` script makes no coverage claim to falsify,
  // and the question this invariant asks ("does the script run the generator")
  // has no subject there. Which of these roots are actually generated is not
  // decided here: that is one batched git call in `workspacePackages`, because
  // it is a question about the repo rather than about this package.
  const declaredIncludes = scripts.typecheck === undefined
    ? []
    : invoked.flatMap((config) =>
      (config.includes ?? [])
        .map((glob) => ({ config: config.file, glob, root: includeRoot(glob) }))
        .filter((entry) => entry.root !== '' && !entry.root.includes('..')));

  return {
    hidesTests: hiddenTests.length > 0,
    testFiles: hiddenTests.length,
    hiddenTests,
    pinFiles: pinFiles.sort(),
    declaredIncludes,
    // The script bodies GENERATED_COVERED asks "does this run the generator,
    // and before tsc" of. Carried on the package so `evaluate` stays a pure
    // function of observations, the way every other invariant here is tested.
    typecheckChain: typecheckScriptChain(scripts),
    // Repo-relative, one entry per top-level directory, with the file count
    // DERIVED on this run and never written down anywhere -- #5826's ruling for
    // the test layer applies here for the same reason.
    uncheckedSources: [...uncheckedByDir]
      .map(([top, files]) => ({ dir: posix.join(dir, top), files }))
      .sort((a, b) => a.dir.localeCompare(b.dir)),
  };
}

/** Every workspace member as { name, dir, scripts, hasTsconfig, hidesTests, testFiles }. */
function workspacePackages() {
  // Membership comes from scripts/workspace-enumerator.mjs (#11510) — this repo's
  // one parse of the workspace file, and one of nine private copies before it.
  // It refuses a glob richer than `<dir>` or `<dir>/*` rather than expanding it
  // to nothing, which is the posture this function already took.
  const dirs = workspacePackageDirs(ROOT);
  const packages = dirs.map((dir) => {
    const manifest = JSON.parse(readFileSync(join(ROOT, dir, 'package.json'), 'utf8'));
    return {
      name: manifest.name ?? dir,
      dir,
      scripts: manifest.scripts ?? {},
      hasTsconfig: existsSync(join(ROOT, dir, 'tsconfig.json')),
      ...testCoverage(dir, manifest.scripts ?? {}),
    };
  });

  // GENERATED_COVERED's observation half (#10880), in ONE git call for the
  // whole workspace: of the `include` roots the typecheck scripts put in front
  // of tsc, which are not checked in? Measured on main @ 7c02a4529c: 101 roots,
  // of which 3 -- all in `apps/docs` -- are generated.
  //
  // The workspace ROOT package is not in this list and so is not asked. Its own
  // `typecheck:root` config is judged by `evaluate`'s root branch, which has no
  // observation of this kind; giving it one would mean walking the entire repo
  // through `testCoverage`. No root-level `include` names a generated path
  // today (same measurement), and this is the limit rather than an oversight.
  const roots = new Set();
  for (const pkg of packages) {
    for (const entry of pkg.declaredIncludes ?? []) roots.add(posix.join(pkg.dir, entry.root));
  }
  const generated = gitIgnoredPaths([...roots].sort());
  for (const pkg of packages) {
    pkg.generatedIncludes = (pkg.declaredIncludes ?? [])
      .filter((entry) => generated.has(posix.join(pkg.dir, entry.root)));
  }
  return packages;
}

// ---------------------------------------------------------------------------
// COMPOSITION -- does the note agree with the number beside it (#10722)?
//
// Each ledger entry pairs a measured `errors` with free prose, and until this
// block existed nothing read the prose. A note could narrate any count at all,
// including one its own field contradicts, and every gate stayed green: #7038,
// #8982, #10721 and #10775 are four hand repairs of that one shape, the last
// two landed on the same day. Repairing prose a gate never reads does not close
// a class; this does, from the other end.
//
// What is read is deliberately SMALL. A general "does this prose agree with
// this number" reader is not tractable and must not be attempted -- these notes
// carry several numbers apiece (`Re-measured 333 at 5ab08428`, `up from 219`,
// `TS2554 x113`, per-file splits), and only some of them are the entry's total.
// A rule that guesses wrong produces a FALSE RED ON AN ACCURATE LEDGER, which
// is strictly worse than the silence it replaces. So it reads exactly one
// thing -- the house-convention tier itemisation the notes already open with --
// and abstains, silently, everywhere else:
//
//   * the itemisation must be the note's OPENING clause, reachable across a
//     lead-in that carries no digit and no sentence break (spec-monorepo's
//     "the workspace root itself: code-tier 4 ..." qualifies);
//   * a tier counted twice, or a further `code-tier 9`-shaped count ANYWHERE
//     later in the note, means the note is quoting its own history and the
//     entry is skipped. metadata-protocol's entry quoted the misleading note
//     #5278 found ("code-tier 9, the rest config-tier and noise") and was
//     skipped for exactly that reason -- correct entry, no verdict. That entry
//     has since GRADUATED (the package declares `typecheck` and its 63 errors
//     are repaired), so the rule's live example is the self-test case below
//     rather than a ledger row you can still read here;
//   * per-code tallies (`TS2835 x72, TS7006 x49, ...`) are NOT summed. They are
//     partial by construction, and the worked example this rule was written
//     against says why: `@objectstack/rest`'s tally summed to 147 while saying
//     so in the same breath ("composition as counted at 153"), so summing it
//     would have redded an entry whose author was being precise. That entry has
//     since been RE-TALLIED and now sums to its recorded 155 exactly (#10821),
//     which retires the example and changes nothing about the rule: a tally that
//     happens to be complete today is still not one a gate may REQUIRE to be
//     complete, and the next deliberately partial tally must stay writable.
//
// FALSE-POSITIVE DIRECTION: an entry whose opening itemisation is deliberately
// partial, with the remainder described in words rather than digits, would fire
// wrongly. None exists today -- run over all 33 entries on main at f4e5d916d6,
// 11 are checked and 0 fire.
// FALSE-NEGATIVE DIRECTION: everything else, and it is most of the ledger. 21
// of 33 entries carry no tier itemisation and are unguarded here; 1 more is
// skipped as ambiguous. That is the intended trade -- a floor under one known
// class, not a reader of prose.
//
// The two instances this was written for both fire, on the trees that carried
// them: at 699132f259^, service-automation (`code-tier 5` over `errors: 3`) and
// metadata (34 + 24 + 34 = 92 over `errors: 89`); at 699132f259, metadata
// alone. Nothing else fires on either tree.
// ---------------------------------------------------------------------------

/**
 * Any tier count in either word order, used both to FIND the opening
 * itemisation and to detect a second one later in the note. Liberal on purpose:
 * every extra match it makes turns into an abstention, never a verdict.
 */
const TIER_COUNT = /(?:code-tier|config-tier|noise)[ \t]+\d|\d[ \t]+(?:code-tier|config-tier|noise)/;

/** One tier term, anchored, in either word order. */
const TIER_TERM = /^(?:(code-tier|config-tier|noise)[ \t]+(\d+)|(\d+)[ \t]+(code-tier|config-tier|noise))\b/;

/**
 * The connective glue the notes really use between tier terms, as a CLOSED set:
 * whitespace, `;`, `,`, `+`, a parenthetical of per-code detail, and the three
 * words the ledger joins tiers with. Anything outside it ends the itemisation,
 * which is what keeps the reader inside the opening clause instead of walking
 * on into the narrative.
 */
const TIER_GLUE = /^(?:[\s;,+]|\([^()]*\)|and\b|plus\b|the rest is\b)+/;

/**
 * The opening tier itemisation of a note, or nothing.
 *
 * @param {unknown} note
 * @returns {{tiers: Map<string, number>, sum: number} | {ambiguous: string} | null}
 *   `null` when the note states no tier itemisation at all (nothing to check),
 *   `{ambiguous}` when one is stated but cannot be read with certainty, and the
 *   tiers plus their sum otherwise.
 */
function tierItemisation(note) {
  if (typeof note !== 'string') return null;
  const first = note.search(TIER_COUNT);
  if (first === -1) return null;
  if (/[\d.]/.test(note.slice(0, first))) {
    return { ambiguous: 'the text before its first tier count carries a digit or a sentence break' };
  }
  let cursor = first;
  const tiers = new Map();
  for (;;) {
    const term = TIER_TERM.exec(note.slice(cursor));
    if (!term) break;
    const tier = term[1] ?? term[4];
    if (tiers.has(tier)) return { ambiguous: `\`${tier}\` is counted twice in its opening itemisation` };
    tiers.set(tier, Number(term[2] ?? term[3]));
    cursor += term[0].length;
    const glue = TIER_GLUE.exec(note.slice(cursor));
    if (!glue) break;
    cursor += glue[0].length;
  }
  if (tiers.size === 0) return null;
  if (TIER_COUNT.test(note.slice(cursor))) {
    return { ambiguous: 'a further tier count appears later in the note, so the opening one may be a quotation of its own history' };
  }
  return { tiers, sum: [...tiers.values()].reduce((a, b) => a + b, 0) };
}

/**
 * COMPOSITION, over one ledger. Also reconciles `compositionAt` -- the field
 * `--lower` writes to say which pile the itemisation still describes after the
 * number moved out from under it.
 *
 * @param {string} ledgerName
 * @param {Record<string, unknown>} entries
 * @returns {string[]}
 */
function compositionProblems(ledgerName, entries) {
  const problems = [];
  for (const [name, entry] of Object.entries(entries)) {
    if (!entry || typeof entry !== 'object') continue;
    const errors = /** @type {{errors?: unknown}} */ (entry).errors;
    const declared = /** @type {{compositionAt?: unknown}} */ (entry).compositionAt;
    const itemised = tierItemisation(/** @type {{note?: unknown}} */ (entry).note);
    const readable = itemised !== null && !('ambiguous' in itemised);

    if (declared !== undefined) {
      if (!Number.isInteger(declared) || Number(declared) <= 0) {
        problems.push(
          `${name}: ${ledgerName} \`compositionAt\` must be the whole number its note's tier itemisation ` +
            `was tallied at -- got ${JSON.stringify(declared)}.`,
        );
        continue;
      }
      if (!readable) {
        problems.push(
          `${name}: ${ledgerName} declares \`compositionAt: ${declared}\` but its note carries no readable ` +
            `tier itemisation for that number to describe -- delete the field, or restore the itemisation ` +
            `it was written for.`,
        );
        continue;
      }
      if (typeof errors === 'number' && declared === errors) {
        problems.push(
          `${name}: ${ledgerName} declares \`compositionAt: ${declared}\`, which is \`errors\` -- the note ` +
            `is not stale, so the declaration states nothing. Delete the field.`,
        );
        continue;
      }
      if (typeof errors === 'number' && Number(declared) < errors) {
        problems.push(
          `${name}: ${ledgerName} declares \`compositionAt: ${declared}\` BELOW \`errors: ${errors}\`, which ` +
            `is a RAISED count wearing an unrewritten note. \`compositionAt\` may only ever declare a pile ` +
            `LARGER than the field -- rewrite the note to match what the pile is now made of, and where the ` +
            `delta cannot be attributed say so rather than inventing a composition.`,
        );
        continue;
      }
    }

    if (!readable) continue;
    const target = declared === undefined ? errors : Number(declared);
    if (typeof target !== 'number' || itemised.sum === target) continue;
    const breakdown = [...itemised.tiers].map(([tier, n]) => `${tier} ${n}`).join(' + ');
    problems.push(
      `${name}: ${ledgerName} note opens with a tier itemisation summing to ${itemised.sum} (${breakdown}) ` +
        `while the entry ${declared === undefined ? `records \`errors: ${errors}\`` : `declares \`compositionAt: ${declared}\``} -- ` +
        `the note contradicts the field beside it, and nothing but this check reads prose, so the ` +
        `disagreement is invisible everywhere else (#10722). Re-tally the itemisation onto the recorded ` +
        `number, or -- if the composition genuinely describes the larger pile it was measured at -- record ` +
        `that size as \`compositionAt\` instead of rescaling a tally nobody re-took. ` +
        `⛔ Do NOT change \`errors\` to make this agree: that number is the measurement.`,
    );
  }
  return problems;
}

/**
 * Pure verdict over an observed workspace state; the real run and the
 * self-test both go through here, so the semantics the fixtures prove are the
 * semantics the gate applies.
 *
 * @param {Array<{name: string, dir: string, scripts: Record<string,string>, hasTsconfig: boolean,
 *                hidesTests?: boolean, testFiles?: number, pinFiles?: string[]}>} packages
 * @param {{name: string, scripts: Record<string,string>}} root
 * @param {{ debt: Record<string, {errors: number, note?: string, compositionAt?: number}>,
 *           exempt: Record<string, string>,
 *           testDebt: Record<string, {errors: number, note?: string, compositionAt?: number}>,
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

    // SOURCES_COVERED (#10756). A package that ADVERTISES a `typecheck` script
    // and keeps a whole source directory outside every program that script
    // runs. The observation half asks this only of such packages, so no DEBT
    // package reaches here.
    for (const { dir, files } of pkg.uncheckedSources ?? []) {
      if (!Object.hasOwn(state.uncheckedSources, dir)) {
        problems.push(
          `${dir}: ${files} non-test source file(s) here sit outside every tsc program that ` +
            `\`${pkg.name}\`'s \`typecheck\` script runs, while that script is what makes the package ` +
            `count as COVERED -- so the gate reports green over a directory nothing type-checks ` +
            `(${TRACKING_ISSUE}). Add a sibling \`tsconfig.scripts.json\` and NAME it in the \`typecheck\` ` +
            `script (the ${SPEC_SCRIPTS_PRECEDENT} pattern), or widen \`include\` to reach the directory. ` +
            `⛔ Widening \`include\` on the BUILD config is not the same repair: it puts the directory in ` +
            `front of the emit too, and \`rootDir\` will reject it. UNCHECKED_SOURCE_DEBT in ${SELF} is ` +
            `closed to new entries.`,
        );
      } else if (!String(state.uncheckedSources[dir] ?? '').trim()) {
        problems.push(
          `${dir}: UNCHECKED_SOURCE_DEBT entry has no reason -- say why this directory is still ` +
            `outside every program, or put it in one.`,
        );
      }
    }

    // GENERATED_COVERED (#10880). An `include` entry rooted in a path the repo
    // does not check in: the program tsc gets is only as complete as whatever
    // produced that path, and a missing one is SILENT -- the check exits 0
    // having compiled none of it. Scoped by the observation half to packages
    // that declare a `typecheck` script, exactly as SOURCES_COVERED is.
    for (const { config, glob, root } of pkg.generatedIncludes ?? []) {
      const where = `${pkg.name} (${pkg.dir}/${config})`;
      if (!Object.hasOwn(state.generatedRoots, root)) {
        problems.push(
          `${where}: \`include\` names "${glob}", rooted in \`${root}\` -- a path the repo's own ignore ` +
            `rules say is NOT checked in, so it is empty until something produces it -- and no row in ` +
            `GENERATED_INCLUDE_ROOTS in ${SELF} says what does. tsc then reports green over a program ` +
            `missing every file that glob promised, which is the one failure COVERED, REAL and RUNNABLE ` +
            `all pass through (${GENERATED_INCLUDE_ISSUE}). Add a row naming the command the \`typecheck\` ` +
            `script has to run first -- or, if nothing a typecheck runs should produce it, a row with ` +
            `\`generator: null\` and the argument for why its absence cannot make this check read green. ` +
            `⛔ Deleting the glob is not automatically the repair: a framework that writes the config ` +
            `back (Next's \`writeConfigurationDefaults\`) will re-add it.`,
        );
        continue;
      }
      const row = state.generatedRoots[root] ?? {};
      const declares = row.generator === null || (typeof row.generator === 'string' && row.generator.trim() !== '');
      if (!declares) {
        problems.push(
          `GENERATED_INCLUDE_ROOTS["${root}"] in ${SELF} declares no generator -- give it the command ` +
            `that produces the directory, or \`generator: null\` to say out loud that nothing a typecheck ` +
            `runs produces it. A row with the key missing would read as the second answer while nobody ` +
            `ever decided it.`,
        );
        continue;
      }
      if (!String(row.why ?? '').trim()) {
        problems.push(
          `GENERATED_INCLUDE_ROOTS["${root}"] in ${SELF} has no reason -- say what writes this path and ` +
            `why the \`typecheck\` script's relationship to it is the right one. For a \`generator: null\` ` +
            `row that reason is the whole guard: nothing mechanical can check that an ungenerated ` +
            `directory's absence cannot make tsc read green.`,
        );
        continue;
      }
      if (row.generator === null) continue; // declared, and deliberately not generated
      const verdict = generatorVerdict(pkg.typecheckChain ?? [], row.generator);
      if (verdict === 'missing') {
        problems.push(
          `${where}: \`include\` names "${glob}", which nothing checked in provides -- ` +
            `GENERATED_INCLUDE_ROOTS says \`${row.generator}\` writes it -- and this package's ` +
            `\`typecheck\` script never runs that command ("${script ?? ''}"). So tsc compiles whatever an ` +
            `earlier build happened to leave in \`${root}\`, and in a clean checkout it compiles nothing ` +
            `from there and still exits 0 (${GENERATED_INCLUDE_ISSUE}). Put \`${row.generator}\` in the ` +
            `\`typecheck\` script ahead of tsc.`,
        );
      } else if (verdict === 'after') {
        problems.push(
          `${where}: the \`typecheck\` script runs \`${row.generator}\` -- which is what writes "${glob}" -- ` +
            `AFTER tsc in the same command ("${script ?? ''}"), so the program tsc read was still the one ` +
            `from before the generator ran, and the files that glob promises were checked by nothing ` +
            `(${GENERATED_INCLUDE_ISSUE}). Move it in front: \`${row.generator} && tsc --noEmit\`.`,
        );
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

  // RECONCILED for SOURCES_COVERED, on the same terms (#10756). An entry lives
  // only while its directory really is unread: once a `tsconfig.scripts.json`
  // names it -- or the directory is deleted, or the package stops declaring a
  // `typecheck` script and moves into DEBT -- the line is a claim about nothing.
  const uncheckedSeen = new Set(packages.flatMap((p) => (p.uncheckedSources ?? []).map((u) => u.dir)));
  for (const dir of Object.keys(state.uncheckedSources)) {
    if (!uncheckedSeen.has(dir)) {
      problems.push(
        `UNCHECKED_SOURCE_DEBT entry for "${dir}" is no longer unread source (a tsc program reads it ` +
          `now, or the directory is gone) -- delete it from ${SELF}. That is the ratchet: this list ` +
          `only shrinks.`,
      );
    }
  }

  // RECONCILED for GENERATED_COVERED (#10880). This table is knowledge rather
  // than debt -- a `generator` row describes a config that is RIGHT -- but
  // knowledge about an `include` entry nobody has any more is just as stale as
  // a debt entry for a repaired directory, and it is worse than inert: the next
  // author reads it as evidence that the shape is still in use. A row survives
  // exactly as long as some typecheck-invoked config names its root.
  const generatedSeen = new Set(packages.flatMap((p) => (p.generatedIncludes ?? []).map((g) => g.root)));
  for (const root of Object.keys(state.generatedRoots)) {
    if (!generatedSeen.has(root)) {
      problems.push(
        `GENERATED_INCLUDE_ROOTS entry for "${root}" is named by no \`include\` that any package's ` +
          `\`typecheck\` script invokes (the glob is gone, the path is checked in now, or the package ` +
          `stopped declaring \`typecheck\`) -- delete it from ${SELF}. That is the ratchet: this table ` +
          `only ever describes live configs.`,
      );
    }
  }

  // COMPOSITION (#10722). Runs over the ledger objects rather than over live
  // packages: a note contradicting its own field is wrong whether or not the
  // package it names still exists, and the reconciliation above already fails
  // an entry naming nothing.
  problems.push(...compositionProblems('DEBT', state.debt));
  problems.push(...compositionProblems('TEST_DEBT', state.testDebt));

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

/**
 * The source layer's headline figure, DERIVED on every run for the same reason
 * the test layer's is (#5826): this gate already walks the files to decide
 * SOURCES_COVERED, so a copy in the ledger would be a second source of truth
 * that drifts with nothing comparing it.
 *
 * @returns {{dirs: number, files: number}}
 */
function uncheckedSourceLayer(packages, ledger) {
  let dirs = 0;
  let files = 0;
  for (const pkg of packages) {
    for (const entry of pkg.uncheckedSources ?? []) {
      if (!Object.hasOwn(ledger, entry.dir)) continue;
      dirs++;
      files += entry.files;
    }
  }
  return { dirs, files };
}

/**
 * The generated layer's headline figures (#10880), derived on every run like
 * the two layers above it -- this gate has already asked git which roots are
 * generated and already read the table, so writing any of it down would be a
 * second source of truth for a fact it holds.
 *
 * Only printed after the verdict is clean, so every entry counted here has a
 * row: `produced` and `ungenerated` therefore sum to `entries`.
 *
 * @returns {{entries: number, packages: number, produced: number, ungenerated: number}}
 */
function generatedIncludeLayer(packages, table) {
  let entries = 0;
  let withEntries = 0;
  let produced = 0;
  for (const pkg of packages) {
    const found = pkg.generatedIncludes ?? [];
    if (found.length === 0) continue;
    withEntries++;
    entries += found.length;
    produced += found.filter((g) => typeof table[g.root]?.generator === 'string').length;
  }
  return { entries, packages: withEntries, produced, ungenerated: entries - produced };
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
    refusePrerequisite(`--re-measure needs the workspace's own turbo at ${bin}; run \`pnpm install\` first.`);
  }
  const args = ['run', 'build', '--filter=./packages/*', '--filter=./packages/*/*'];
  const run = spawnSync(bin, args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (run.error) refusePrerequisite(`the closure build could not be run: ${run.error.message}`);
  if (run.status !== 0) {
    const output = `${run.stdout ?? ''}${run.stderr ?? ''}`.trim();
    refusePrerequisite(
      `--re-measure cannot run: the ledgered packages' dependency closure does not build, so there is no `
        + `world to measure against. Fix the build first -- every number in DEBT and TEST_DEBT is measured `
        + `with tsc resolving workspace imports through each dependency's built \`dist/*.d.ts\`.\n`
        + `  ${bin} ${args.join(' ')}\n${output.slice(-4000)}`,
    );
  }
}

/**
 * TS6059 -- "File X is not under 'rootDir'" -- which is counted for a package's
 * OWN config and never for the generated re-measure project (#10779).
 *
 * The asymmetry is the whole point, so it is stated rather than implied. A
 * TS6059 from `measureDebt` is tsc reading the config the package ships, and
 * that config governs a real emit (`dev` runs `tsc -w`), so the diagnostic is
 * about the package. A TS6059 from `measureTestDebt` is tsc reading a project
 * this file invented seconds earlier, purely to ask a question about the test
 * layer, under `--noEmit` where there is no output layout for `rootDir` to
 * protect -- `remeasureProject`'s docstring rules that counting it would be
 * "measuring the tape measure", and that ruling is what this implements.
 *
 * Dropped at COUNT time rather than prevented at config time because the
 * preventive shape cannot be written correctly: it would mean choosing a
 * `rootDir` wide enough for every file tsc pulls in transitively, which is not
 * knowable before running tsc, and the obvious guess (the package directory)
 * MEASURED as a ratchet break on `packages/rest`, whose own config widens
 * `rootDir` past it on purpose. See the ⛔ paragraph in `remeasureProject`.
 *
 * ⛔ This does not hide a real error from any ledger. The generated project is
 * built for TEST_DEBT alone; nothing else reads it, and no package's own
 * `typecheck` goes through it.
 */
const TSC_ROOTDIR_DIAGNOSTIC = /\berror TS6059\b/;

/**
 * @param {string} output
 * @param {{dropRootDirDiagnostics?: boolean}} [options] set only by the
 *   generated re-measure project -- see `TSC_ROOTDIR_DIAGNOSTIC`.
 */
function countTscErrors(output, { dropRootDirDiagnostics = false } = {}) {
  let n = 0;
  for (const line of output.split(/\r?\n/)) {
    if (!TSC_ERROR_LINE.test(line)) continue;
    if (dropRootDirDiagnostics && TSC_ROOTDIR_DIAGNOSTIC.test(line)) continue;
    n++;
  }
  return n;
}

// ---------------------------------------------------------------------------
// The heap ceiling `--re-measure` runs tsc under (#12856).
//
// ## The defect this closes
//
// tsc's ceiling is V8's default old-space size, and V8 derives that from the
// PHYSICAL MEMORY of the box the process starts on. Nothing here said so, so
// this gate measured a different world on every machine -- while the only
// verdict that counts is CI's. Three devs ran `--re-measure` on the agent
// container against the tree below, all three read green, and CI OOM'd on that
// same tree. ⚠️ The asymmetry IS the defect: a local pass was never a claim
// about CI, and nothing said so out loud.
//
// ## Where the number comes from -- CI, never this box
//
// Read off the CI runner itself: run 33136681083, job `Type Check · debt
// ledger`, at 6d097a604, Node v22.23.2. The `packages/qa/http-conformance`
// TEST_DEBT program died there, and the last GC before it says how much heap it
// was allowed:
//
//     [5950] 65768 ms: Mark-Compact 4040.3 (4143.8) -> 4029.5 (4147.5) MB,
//       ... allocation failure; GC in old space requested
//     FATAL ERROR: Ineffective mark-compacts near heap limit
//       Allocation failed - JavaScript heap out of memory
//
// V8 gave up with 4040.3 MB live and 4147.5 MB of heap committed, which
// brackets that runner's old-space limit into [4040, 4148] MB. 4096 is the only
// V8 default that lands in the window, and the two sides agree on the offset:
// `getHeapStatistics().heap_size_limit` reports the old space plus a fixed
// ~48 MB of other spaces (8240 reported for 8192 and 560 for 512, both measured
// with `NODE_OPTIONS` on a box under this file's own eyes), so a 4096 old space
// reports 4144 and commits the 4147.5 above it.
//
// ⚠️ If 4096 is wrong, it is wrong DOWNWARD -- the only safe direction. This
// number's entire job is to be no HIGHER than CI's ceiling. A pin ABOVE CI's is
// worse than no pin at all: it makes local runs pass where CI still OOMs, which
// is exactly this defect with extra confidence attached.
//
// ⛔ Do not raise this to make a local measurement complete. `--re-measure`
// OOMing under this ceiling is the gate WORKING -- it is CI's failure,
// reproduced on your box before you push. What grew is the type graph, not the
// memory CI has. (`packages/spec/tsup.config.ts` carries the other half of this
// lesson from the build side: a ceiling above the box's real memory does not
// buy a bigger run, it converts a recoverable heap error into an exit-137
// SIGKILL that carries no diagnostic at all.)
const CI_TSC_HEAP_CEILING_MB = 4096;

/**
 * The last `--max-old-space-size` in a `NODE_OPTIONS` string, in MB, or null.
 *
 * LAST, not first, because that is what V8 does with a repeated flag -- measured
 * both ways: `--max-old-space-size=8192 --max-old-space-size=512` reports a
 * 560 MB limit and the reverse order reports 8240. That is the whole reason
 * `heapCappedEnv` below can APPEND rather than having to rewrite what the
 * caller set, and the reason this parser has to agree with V8 about which
 * occurrence wins: reading the first one would let a caller's stale flag decide
 * a ceiling V8 has already discarded.
 *
 * Only the `=` spelling exists to parse. `NODE_OPTIONS="--max-old-space-size 512"`
 * is not a lower ceiling, it is a node startup error (measured: the space-split
 * form makes node reject an unrelated option and exit), so a run that reaches
 * this gate at all never carries one. Both the dashed and the underscored flag
 * names are accepted, because V8 accepts both.
 *
 * @param {string | undefined} nodeOptions
 * @returns {number | null}
 */
function maxOldSpaceMb(nodeOptions) {
  let mb = null;
  for (const m of String(nodeOptions ?? '').matchAll(/--max[-_]old[-_]space[-_]size=(\d+)/g)) {
    mb = Number(m[1]);
  }
  return mb;
}

/**
 * The ceiling this run will hand tsc, and the honest name of where it came from.
 *
 * The rule is a MINIMUM over three numbers, and each one is there for a failure
 * that has actually happened somewhere in this repo:
 *
 *   the CI ceiling      the point of the exercise -- a roomier box must not
 *                       measure a roomier world than the box whose verdict
 *                       counts.
 *   this process's own  never RAISE a ceiling. On a box smaller than CI,
 *                       promising V8 memory the box does not have does not buy
 *                       a bigger run: the kernel kills the process at the
 *                       container limit long before V8 reaches the ceiling, and
 *                       exit 137 carries no diagnostic (`packages/spec`'s DTS
 *                       pass was killed on every docs deploy for two days that
 *                       way). Lower than CI is the safe direction anyway: heap
 *                       headroom is monotone, so a program that fits under a
 *                       smaller ceiling fits under CI's.
 *   the caller's        an explicit `NODE_OPTIONS` cap is honoured when it is
 *                       TIGHTER, and refused when it is roomier. A caller who
 *                       could hand this gate more heap than CI has could hand
 *                       back the exact green-here-red-there reading this
 *                       ceiling exists to abolish.
 *
 * `stale` is the other direction, and it is the one nothing else can catch. If
 * the runner's OWN default is below the pinned constant, then the constant is
 * no longer a description of CI: every local run is roomier than CI again,
 * silently, and this file's green is back to meaning nothing. That is only
 * measurable on the runner itself, so it is measured there and refused there --
 * an advisory would be a declaration nobody reads, which is the shape this
 * repo's ledgers exist to stop.
 *
 * @param {{heapLimitMb: number, nodeOptions?: string, onCi?: boolean}} where
 * @returns {{mb: number, from: string, machineMb: number, stale: string | null}}
 */
function remeasureHeapCeiling({ heapLimitMb, nodeOptions, onCi = false }) {
  const caller = maxOldSpaceMb(nodeOptions);
  const candidates = [
    { mb: CI_TSC_HEAP_CEILING_MB, from: `the CI-shaped ceiling pinned by ${SELF}` },
    { mb: heapLimitMb, from: "this machine's own default, which is BELOW CI's ceiling" },
    ...(caller === null ? [] : [{ mb: caller, from: "the caller's NODE_OPTIONS, which is tighter" }]),
  ];
  // Ties keep the earlier candidate, so the CI ceiling keeps its name on the
  // machine that IS CI -- where all three numbers agree and the label is the
  // only thing left to read.
  const chosen = candidates.reduce((a, b) => (b.mb < a.mb ? b : a));
  const stale = onCi && heapLimitMb < CI_TSC_HEAP_CEILING_MB
    ? `${SELF} pins a CI heap ceiling of ${CI_TSC_HEAP_CEILING_MB} MB, but THIS CI runner's own default is `
      + `${heapLimitMb} MB -- the pin is now ABOVE the ceiling it claims to describe, so every local run of `
      + `this gate is roomier than CI again and its green says nothing about this job. Re-pin `
      + `CI_TSC_HEAP_CEILING_MB from this reading (the runner shrank; the remedy is one constant), and `
      + `⛔ do not delete the pin instead -- an unpinned run is the defect #12856 closed.`
    : null;
  return { mb: chosen.mb, from: chosen.from, machineMb: heapLimitMb, stale };
}

/**
 * `env` with the ceiling appended to `NODE_OPTIONS`.
 *
 * APPENDED, never substituted: V8 takes the last occurrence (see
 * `maxOldSpaceMb`), so this wins over whatever the caller set without this
 * function having to understand the rest of their `NODE_OPTIONS` -- and the
 * caller's own flags, which may be the reason their run works at all, survive.
 *
 * @param {NodeJS.ProcessEnv} env
 * @param {number} mb
 * @returns {NodeJS.ProcessEnv}
 */
function heapCappedEnv(env, mb) {
  return { ...env, NODE_OPTIONS: `${(env.NODE_OPTIONS ?? '').trim()} --max-old-space-size=${mb}`.trim() };
}

// Read once, at the ceiling this process actually got rather than at a number
// about the box: `heap_size_limit` already accounts for a caller's flags, a
// cgroup, and whatever V8 decided from physical memory, which is three ways of
// being wrong that this file then does not have to model.
const REMEASURE_HEAP = remeasureHeapCeiling({
  heapLimitMb: Math.floor(getHeapStatistics().heap_size_limit / (1024 * 1024)),
  nodeOptions: process.env.NODE_OPTIONS,
  onCi: process.env.GITHUB_ACTIONS === 'true',
});

/**
 * Run the repo's own tsc over one project and return its raw error count.
 * `--pretty false` so the count does not depend on whether a TTY is attached;
 * cwd is ROOT so reported paths are repo-relative however the gate was invoked.
 *
 * @param {string} project path to a tsconfig -- repo-relative for the ledgered
 *   packages' own configs, absolute for the generated re-measure project, which
 *   lives outside the repo entirely
 * @param {{dropRootDirDiagnostics?: boolean}} [options]
 * @returns {number}
 */
function tscErrorCount(project, options = {}) {
  const bin = join(ROOT, 'node_modules', '.bin', 'tsc');
  if (!existsSync(bin)) {
    refusePrerequisite(`--re-measure needs the workspace's own tsc at ${bin}; run \`pnpm install\` first.`);
  }
  const run = spawnSync(bin, ['--noEmit', '--pretty', 'false', '-p', project], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    // The CI-shaped ceiling (#12856). Every tsc this gate runs gets it, not
    // just the generated TEST_DEBT program that happened to OOM first: a DEBT
    // entry measured under a roomier ceiling than CI's is the same reading
    // dressed as a different one.
    env: heapCappedEnv(process.env, REMEASURE_HEAP.mb),
  });
  if (run.error) refusePrerequisite(`tsc could not be run for ${project}: ${run.error.message}`);
  const output = `${run.stdout ?? ''}${run.stderr ?? ''}`;
  if (TSC_SETUP_ERROR.test(output)) {
    refusePrerequisite(`tsc could not read ${project} -- the measurement is invalid, not zero:\n${output.trim()}`);
  }
  const errors = countTscErrors(output, options);
  // Exit 0 means a clean program; anything else must have produced diagnostics
  // we recognised. If it did not, tsc failed in a way this parser cannot see,
  // and reporting 0 would quietly hand the package a graduation certificate.
  //
  // Read BEFORE the TS6059 drop, deliberately. A project whose only diagnostics
  // are dropped ones is a program tsc did read and understand, so it must reach
  // the `return 0` below -- refusing there would turn "this test layer is clean
  // apart from an artefact of our own generated config" into a hard crash.
  if (run.status !== 0 && countTscErrors(output) === 0) {
    refusePrerequisite(
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
 * That reasoning does not depend on how the file entered the program, and the
 * `unreachable.length > 0` guard below does (#10779). Dropping the test globs
 * from `exclude` is ALSO a widening: a test it re-admits can import a module
 * from outside `rootDir`, tsc pulls that module in transitively, and the TS6059
 * it then reports is a statement about this generated config in exactly the
 * sense the paragraph above rules on -- but the guard bills it to the package,
 * because `unreachable` was empty and no widening had been "done" by this code.
 * Measured on main @ 5886ee6d22: `@objectstack/objectql` has all 225 of its
 * test files under `src/`, so `unreachable` was empty, the generated project
 * inherited `rootDir: "src"`, and `src/dry-run-hash-compat.test.ts` importing
 * `../scripts/dry-run-hash-compat` billed the frozen 355 for one TS6059 that no
 * author of that package could ever retire by fixing code.
 *
 * ⛔ The remedy is NOT to set `compilerOptions.rootDir = pkgAbs` unconditionally
 * here, which is the shape this reads as wanting. That was implemented and
 * MEASURED, and it raises a ledger count: `pkgAbs` is wider than the `src` most
 * of these packages declare, but it is NARROWER than a package that has
 * deliberately widened its own. `packages/rest` sets `rootDir: ".."` because a
 * `paths` rule redirects `@objectstack/metadata-protocol` to the producer's
 * SOURCE, putting a sibling package's files in the program (#9960, which paid
 * to remove exactly these); pinning that back to the package directory
 * re-created them, and `@objectstack/rest` went 155 -> 175 (+20 x TS6059) on a
 * shrink-only ledger. A "neutralisation" that can narrow is not one.
 *
 * So the diagnostic is dropped where it is counted rather than legislated away
 * here -- see `countTscErrors`. That is complete where a `rootDir` value cannot
 * be: it holds for every shape a package's own config declares, including ones
 * no rule here could predict, and it leaves each package's own `rootDir` -- the
 * one that governs its real emit -- untouched.
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
  // Registered on `exit` as WELL as in the `finally`, because `tscErrorCount`
  // can now REFUSE, and a refusal calls `process.exit` -- which runs `exit`
  // handlers and does NOT run `finally`. Belt and braces on purpose: the
  // `finally` keeps the directory's lifetime visible where it is created, and
  // the handler is what makes the refusal path leave nothing behind. `off`
  // first in the `finally` so a run measuring 34 entries does not accumulate 34
  // live handlers on a directory each has already removed.
  const cleanup = () => rmSync(holder, { force: true, recursive: true });
  process.once('exit', cleanup);
  try {
    return tscErrorCount(configPath, { dropRootDirDiagnostics: true });
  } finally {
    process.off('exit', cleanup);
    cleanup();
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
    refusePrerequisite(
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
    refusePrerequisite(
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
    measurements.push({
      ledger: 'DEBT',
      name,
      dir,
      // The root is a ledger member like any other and its remedy is NOT the
      // same edit -- its `typecheck` slot is the workspace aggregator (#11491).
      isRoot: name === rootName,
      recorded: entry.errors ?? 0,
      note: entry.note,
      compositionAt: entry.compositionAt,
      actual: measureDebt(dir),
    });
  }
  for (const [name, entry] of Object.entries(state.testDebt)) {
    const dir = dirOf.get(name);
    if (dir === undefined) continue;
    measurements.push({
      ledger: 'TEST_DEBT',
      name,
      dir,
      isRoot: name === rootName,
      recorded: entry.errors ?? 0,
      note: entry.note,
      compositionAt: entry.compositionAt,
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

// ── The graduation remedy is a function of the LEDGER (#11491) ──────────────
//
// This message used to offer both ledgers' remedies in one breath -- `add a
// "typecheck" script, OR drop the test exclusion` -- joined by an "or" that
// says they are alternatives a reader may pick between. They are not
// alternatives. Each one belongs to exactly one ledger, and the header three
// screens above already states the distinction the message dropped: DEBT is
// "src does not check", TEST_DEBT is "src checks, tests are hidden".
//
// The reader is, by construction, someone who does NOT already know which
// applies -- a graduation is a once-per-package event and this note is what
// tells them what to do about it. Measured on the ledgers as they stand at
// e47d5ef61, both halves of the old sentence misfire, and not marginally:
//
//   * "add a `typecheck` script" is a NO-OP for 19 of the 19 TEST_DEBT
//     entries. Every one of them already declares one -- that is what makes
//     them TEST_DEBT rather than DEBT. A taker adds a script that is already
//     there, or concludes the reading is wrong.
//   * "drop the test exclusion" is a RED `main` for 14 of the 18 TEST_DEBT
//     entries that have an exclusion to drop, measured by doing it: remove
//     `"**/*.test.ts"` from the package's `tsconfig.json` and
//     `check:type-source-resolution` goes exit 0 -> exit 1, naming the
//     workspace packages the re-admitted tests import and the src program
//     never held (plugin-approvals surfaces 6, runtime 9, http-conformance 5).
//     That gate's registry is shrink-only and its own message rules that
//     widening the entry is not the fix, so the author who followed this note
//     arrives at a second gate with no remedy at all. The 19th entry,
//     `@objectstack/cli`, has no exclusion to drop -- its tests are hidden by
//     an `include` that never reaches them -- so the remedy names an edit that
//     does not exist for it.
//   * on DEBT the sentence misfires once more, on the entry it is easiest to
//     get wrong: the workspace root's `typecheck` slot is the aggregator
//     (`turbo run typecheck`), and its own TypeScript is read through
//     `typecheck:root`. A taker following this note verbatim overwrites every
//     other package's typecheck with a bare `tsc --noEmit`.
//
// `@objectstack/trigger-record-change` is the worked case behind #11491 -- it
// graduated by the #5286 sibling route after both offered remedies proved
// wrong for it, and the paragraph above TEST_DEBT records it. That package is
// gone from the ledger; the shape it demonstrated is what the 19 still there
// would each hit.
//
// So the fix is not more words. It is the branch: `m.ledger` is already on
// every measurement, and each ledger's remedy prints only where it is the
// remedy. Neither is dropped -- both are still offered, in the branch that
// owns them. Within TEST_DEBT there IS a real choice of route, so that one
// keeps both and names the PRECONDITION plus the command that decides it: a
// message the reader has to open a gate's source to act on has not fixed
// anything.
//
// ⛔ This changes no verdict and no number. Graduation candidates were, and
// remain, a NOTE -- never a failure.

/**
 * The remedy for one graduation candidate, keyed on the ledger it is
 * graduating from. Pure, and separate from the note that frames it, so the
 * self-test can pin each branch's content AND its ANTI-content -- the DEBT
 * branch must not carry TEST_DEBT's remedy, which is the exact defect this
 * replaces and the one a well-meaning re-merge would reintroduce.
 *
 * An unrecognised ledger gets no remedy text rather than an inherited one: a
 * third ledger silently receiving DEBT's advice is how this message became
 * wrong in the first place.
 *
 * @param {{ledger: string, isRoot?: boolean}} measurement
 * @returns {string}
 */
function graduationRemedy({ ledger, isRoot = false }) {
  if (ledger === 'TEST_DEBT') {
    return (
      `Onboard it: put the hidden test files in front of tsc, and delete the TEST_DEBT entry in the same ` +
      `PR. ⛔ Adding a \`typecheck\` script is NOT the remedy here -- this ledger is "src checks, tests ` +
      `are hidden", so the package already has one.\n` +
      `    (a) The #5286 sibling route: add a \`tsconfig.test.json\` that reaches the ` +
      `tests and NAME it in the \`typecheck\` script. Always available -- it leaves \`tsconfig.json\` alone.\n` +
      `    (b) Drop the \`**/*.test.ts\` entry from \`exclude\` in \`tsconfig.json\` (or widen \`include\` to ` +
      `reach the test tree). Available ONLY while \`pnpm check:type-source-resolution\` still passes with ` +
      `the tests re-admitted: that gate reads \`tsconfig.json\` and nothing else, the re-admitted tests ` +
      `import workspace packages this package's src program never held, and its registry is ⛔ SHRINK-ONLY ` +
      `-- registering the new ones is not the way out. Measured red on 14 of the 18 entries that have an ` +
      `exclusion to drop, so assume (b) is unavailable until that gate says otherwise. Run it before you ` +
      `commit; nothing in this gate's own verdict will tell you.`
    );
  }
  if (ledger === 'DEBT') {
    return isRoot
      ? `Onboard it: add a \`typecheck:root\` script that invokes tsc AND the step in ` +
          `.github/workflows/lint.yml that runs it -- this gate requires both -- then delete the DEBT ` +
          `entry in the same PR. ⛔ NOT \`typecheck\`: the root's \`typecheck\` slot is the workspace ` +
          `aggregator (\`turbo run typecheck\`), and overwriting it with \`tsc --noEmit\` would stop every ` +
          `other package's typecheck from running while this gate went green.`
      : `Onboard it: add \`"typecheck": "tsc --noEmit"\` to its package.json, and delete the DEBT entry ` +
          `in the same PR. This ledger is "src does not check", so the package has no \`typecheck\` script ` +
          `to begin with -- COVERED would already be red if it did.`;
  }
  return `Onboard it and delete the ${ledger} entry in the same PR.`;
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
        `${m.name}: ${m.ledger} records ${m.recorded}, and tsc now reports 0 -- graduation candidate.\n` +
          `    ${graduationRemedy(m)}\n` +
          `    \`--lower\` deliberately leaves this one alone: 0 is not a lower ` +
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
 * The second "must not" is newer and is the whole of #10722: lowering the digits
 * ALONE mints a note-vs-field contradiction, because the note's tier itemisation
 * keeps describing the pile the number just left. So each lowering carries the
 * declaration that keeps the entry honest -- `declareCompositionAt`, the size
 * the itemisation was tallied at -- computed HERE, where it is pure and
 * fixture-testable, rather than inside the rewriter. It is null whenever there
 * is nothing to declare: no readable itemisation, one that already sums to the
 * new number, or an entry that has declared its composition size before (the
 * tally does not move just because the field does).
 *
 * @param {Array<{ledger: string, name: string, recorded: number, actual: number,
 *                note?: unknown, compositionAt?: unknown}>} measurements
 * @returns {{lowerings: Array<{ledger: string, name: string, from: number, to: number,
 *            declareCompositionAt: number | null}>, graduations: string[]}}
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
    const itemised = tierItemisation(m.note);
    const declareCompositionAt =
      m.compositionAt === undefined && itemised !== null && !('ambiguous' in itemised) && itemised.sum !== m.actual
        ? itemised.sum
        : null;
    lowerings.push({ ledger: m.ledger, name: m.name, from: m.recorded, to: m.actual, declareCompositionAt });
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
 * Notes are still NOT rewritten, and for the reason that has always stood:
 * inventing a composition for errors that are gone is the exact sin the
 * invariant above was written against, and this tool knows the new TOTAL but
 * nothing about which tier gave it up. What changed with #10722 is the claim
 * that leaving the note alone "misleads in the safe direction". It does not: a
 * note itemising 34 + 24 + 34 over a field reading 89 CONTRADICTS ITS OWN
 * FIELD, and every run of this tool minted another one of those. So a lowering
 * that would strand an itemisation now carries `declareCompositionAt`, and the
 * rewriter writes it as a `compositionAt` field beside the number -- one
 * integer, planned upstream in `plannedLowerings()`, inserted next to the digits
 * the regex has already located rather than spliced into the prose. That keeps
 * the advertised one-command path FREE (no hand-edit, no red in the next
 * person's PR) while making the staleness a declared fact that COMPOSITION
 * reads, instead of a silent one nothing reads at all.
 *
 * @param {string} source
 * @param {Array<{ledger: string, name: string, from: number, to: number,
 *                declareCompositionAt?: number | null}>} lowerings
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
    // The declaration goes in as a sibling FIELD, indented like the `errors:` it
    // follows when the entry is written over several lines and inline when it is
    // not -- the shape is read off the match rather than assumed, because this
    // file's ledgers hold both.
    const declare = typeof l.declareCompositionAt === 'number' ? l.declareCompositionAt : null;
    const indent = /\n([ \t]*)errors:[ \t]*$/.exec(match[1]);
    const insert = declare === null ? '' : indent ? `,\n${indent[1]}compositionAt: ${declare}` : `, compositionAt: ${declare}`;
    out = out.slice(0, block.start) + text.replace(pattern, (_m, head) => `${head}${l.to}${insert}`) + out.slice(block.end);
    applied.push(
      `${l.ledger} ${l.name}: ${l.from} -> ${l.to}`
        + (declare === null
          ? ''
          : ` (+ compositionAt: ${declare} -- its note's tier itemisation was tallied at ${declare} and is `
            + `NOT re-tallied here; re-tally it if you can attribute the delta, then delete the field)`),
    );
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
      uncheckedSources: UNCHECKED_SOURCE_DEBT,
      generatedRoots: GENERATED_INCLUDE_ROOTS,
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
  const okState = { debt: {}, exempt: {}, testDebt: {}, phantomPins: {}, uncheckedSources: {}, generatedRoots: {}, turboHasTask: true, ciInvokesTask: true, ciInvokesRoot: true };
  // GENERATED_COVERED's fixtures (#10880). A LITERAL fixture, never the real
  // workspace: `apps/docs` is correct today (#10879 put `next typegen` in its
  // script), so a self-test that leaned on the real tree would assert only that
  // a repaired package stays repaired -- and would go quiet the day somebody
  // deletes the app. The negative controls below are what make this invariant
  // able to fail at all.
  const nextTypes = { config: 'tsconfig.json', glob: '.next/types/**/*.ts', root: '.next/types' };
  const typegenRow = { '.next/types': { generator: 'next typegen', why: 'route types' } };
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
      label: 'an unread source directory in a COVERED package fails SOURCES_COVERED',
      packages: [
        pkg('a', {
          scripts: { typecheck: 'tsc --noEmit' },
          uncheckedSources: [{ dir: 'packages/a/scripts', files: 2 }],
        }),
      ],
      root: okRoot,
      state: okState,
      expect: [/packages\/a\/scripts: 2 non-test source file\(s\) here sit outside every tsc program/],
    },
    {
      label: 'an UNCHECKED_SOURCE_DEBT entry covers it, but only with a reason',
      packages: [
        pkg('a', {
          scripts: { typecheck: 'tsc --noEmit' },
          uncheckedSources: [{ dir: 'packages/a/scripts', files: 2 }],
        }),
        pkg('b', {
          scripts: { typecheck: 'tsc --noEmit' },
          uncheckedSources: [{ dir: 'packages/b/examples', files: 1 }],
        }),
      ],
      root: okRoot,
      state: {
        ...okState,
        uncheckedSources: { 'packages/a/scripts': 'measured: 3 x TS2883.', 'packages/b/examples': '  ' },
      },
      expect: [/packages\/b\/examples: UNCHECKED_SOURCE_DEBT entry has no reason/],
    },
    {
      // RECONCILED, the half that keeps the list shrink-only. Without it the
      // ledger outlives the repair and reads as a worklist that never ends --
      // the failure this repo keeps paying for, per PHANTOM_PIN_DEBT above.
      label: 'an UNCHECKED_SOURCE_DEBT entry whose directory is now read fails RECONCILED',
      packages: [pkg('a', { scripts: { typecheck: 'tsc --noEmit' }, uncheckedSources: [] })],
      root: okRoot,
      state: { ...okState, uncheckedSources: { 'packages/a/scripts': 'measured: 3 x TS2883.' } },
      expect: [/UNCHECKED_SOURCE_DEBT entry for "packages\/a\/scripts" is no longer unread source/],
    },
    {
      // The scope line. A DEBT package's uncovered source is already owned by
      // DEBT ("nothing reads this package"), so billing it here too would put
      // one hole in two ledgers. The observation half enforces this by asking
      // only of packages with a `typecheck` script; this pins that a package
      // WITHOUT one is not dragged in by some later refactor of evaluate().
      label: 'a DEBT package is not also billed for unread source',
      packages: [pkg('a', { scripts: {}, uncheckedSources: [] })],
      root: okRoot,
      state: { ...okState, debt: { a: { errors: 4 } } },
      expect: [],
    },
    {
      // The measured defect, as it stood before #10879: the script invokes tsc
      // (REAL passes), every file that exists is in a program (TESTS_COVERED
      // and SOURCES_COVERED pass), and the program is missing an entire
      // generated directory the config promised.
      label: 'a generated `include` root with no declared row fails GENERATED_COVERED',
      packages: [
        pkg('a', {
          scripts: { typecheck: 'tsc --noEmit' },
          typecheckChain: ['tsc --noEmit'],
          generatedIncludes: [nextTypes],
        }),
      ],
      root: okRoot,
      state: okState,
      expect: [/`include` names "\.next\/types\/\*\*\/\*\.ts".*no row in\s+GENERATED_INCLUDE_ROOTS/s],
    },
    {
      label: 'a declared generator the typecheck script runs before tsc passes',
      packages: [
        pkg('a', {
          scripts: { typecheck: 'next typegen && tsc --noEmit' },
          typecheckChain: ['next typegen && tsc --noEmit'],
          generatedIncludes: [nextTypes],
        }),
      ],
      root: okRoot,
      state: { ...okState, generatedRoots: typegenRow },
      expect: [],
    },
    {
      // The negative control for the row above: same table, same include, and
      // the one thing that differs is the command the script runs.
      label: 'a declared generator the script never runs fails',
      packages: [
        pkg('a', {
          scripts: { typecheck: 'tsc --noEmit' },
          typecheckChain: ['tsc --noEmit'],
          generatedIncludes: [nextTypes],
        }),
      ],
      root: okRoot,
      state: { ...okState, generatedRoots: typegenRow },
      expect: [/never runs that command/],
    },
    {
      // Order is the half a blob of script text could not answer. Same command,
      // same config, and the program tsc reads is still the pre-generator one.
      label: 'a generator that runs AFTER tsc in the same command fails',
      packages: [
        pkg('a', {
          scripts: { typecheck: 'tsc --noEmit && next typegen' },
          typecheckChain: ['tsc --noEmit && next typegen'],
          generatedIncludes: [nextTypes],
        }),
      ],
      root: okRoot,
      state: { ...okState, generatedRoots: typegenRow },
      expect: [/AFTER tsc in the same command/],
    },
    {
      // `.next/dev/types`: the state the card said had to be sayable. Deleting
      // the glob is not the repair -- Next writes it back -- so "declared, and
      // deliberately not generated" has to pass.
      label: 'a row declaring the root deliberately ungenerated passes',
      packages: [
        pkg('a', {
          scripts: { typecheck: 'next typegen && tsc --noEmit' },
          typecheckChain: ['next typegen && tsc --noEmit'],
          generatedIncludes: [{ config: 'tsconfig.json', glob: '.next/dev/types/**/*.ts', root: '.next/dev/types' }],
        }),
      ],
      root: okRoot,
      state: {
        ...okState,
        generatedRoots: { '.next/dev/types': { generator: null, why: 'written only by `next dev`; absence is a false red at worst' } },
      },
      expect: [],
    },
    {
      label: 'an ungenerated row without a reason fails -- the reason IS the guard there',
      packages: [
        pkg('a', {
          scripts: { typecheck: 'tsc --noEmit' },
          typecheckChain: ['tsc --noEmit'],
          generatedIncludes: [nextTypes],
        }),
      ],
      root: okRoot,
      state: { ...okState, generatedRoots: { '.next/types': { generator: null, why: '  ' } } },
      expect: [/GENERATED_INCLUDE_ROOTS\["\.next\/types"\] in .*has no reason/],
    },
    {
      // A row that simply omits the key must not read as `generator: null`:
      // that would let the strict half be switched off by a typo.
      label: 'a row that declares no generator at all fails rather than defaulting to ungenerated',
      packages: [
        pkg('a', {
          scripts: { typecheck: 'tsc --noEmit' },
          typecheckChain: ['tsc --noEmit'],
          generatedIncludes: [nextTypes],
        }),
      ],
      root: okRoot,
      state: { ...okState, generatedRoots: { '.next/types': { why: 'route types' } } },
      expect: [/declares no generator/],
    },
    {
      label: 'a GENERATED_INCLUDE_ROOTS row no `include` names any more fails RECONCILED',
      packages: [pkg('a', { scripts: { typecheck: 'tsc --noEmit' }, generatedIncludes: [] })],
      root: okRoot,
      state: { ...okState, generatedRoots: typegenRow },
      expect: [/GENERATED_INCLUDE_ROOTS entry for "\.next\/types" is named by no `include`/],
    },
    {
      // The quiet half. 100 of the workspace's 101 include roots are ordinary
      // checked-in source and this invariant must have nothing to say about
      // them, or it becomes the thing nobody can keep green.
      label: 'include roots that are checked-in source are not this invariant\'s business',
      packages: [
        pkg('a', {
          scripts: { typecheck: 'tsc --noEmit' },
          typecheckChain: ['tsc --noEmit'],
          generatedIncludes: [],
        }),
      ],
      root: okRoot,
      state: okState,
      expect: [],
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
    // COMPOSITION (#10722). The fixtures are the real instances, transplanted:
    // service-automation's `code-tier 5` over `errors: 3`, and metadata's
    // 34 + 24 + 34 over `errors: 89`.
    {
      label: 'a note whose opening tier itemisation contradicts its own field fails COMPOSITION',
      packages: [],
      root: { name: 'root', scripts: { typecheck: 'turbo run typecheck' } },
      state: { ...okState, debt: { root: { errors: 3, note: 'code-tier 5.' } } },
      expect: [/root: DEBT note opens with a tier itemisation summing to 5 \(code-tier 5\) while the entry records `errors: 3`/],
    },
    {
      label: 'a multi-tier itemisation is summed across the tiers, not read one tier at a time',
      packages: [],
      root: { name: 'root', scripts: { typecheck: 'turbo run typecheck' } },
      state: {
        ...okState,
        debt: { root: { errors: 89, note: 'code-tier 34 (TS2345 x30, TS2322 x4); config-tier 24 (TS2835); noise 34 (TS7006 x33, TS6133). Re-measured 92 at 5ab08428.' } },
      },
      expect: [/summing to 92 \(code-tier 34 \+ config-tier 24 \+ noise 34\)/],
    },
    {
      label: 'the same itemisation agreeing with the field is silent',
      packages: [],
      root: { name: 'root', scripts: { typecheck: 'turbo run typecheck' } },
      state: {
        ...okState,
        debt: { root: { errors: 89, note: 'code-tier 30 (TS2345 x30); config-tier 25 (TS2835 x25); noise 34 (TS7006 x33, TS6133). Re-measured 89 at 4b84834a32, DOWN from 92.' } },
      },
      expect: [],
    },
    {
      // The false-positive guard, and the reason the rule abstains rather than
      // reasons: metadata-protocol's real note quoted the misleading one #5278
      // found (that entry has since graduated, which is why this synthetic case
      // now carries the shape). Reading either count as the entry's own would
      // red a correct entry, which is worse than the silence this check
      // replaces.
      label: 'a note quoting its own history is SKIPPED, not guessed at',
      packages: [],
      root: { name: 'root', scripts: { typecheck: 'turbo run typecheck' } },
      state: {
        ...okState,
        debt: { root: { errors: 63, note: 'code-tier 40 (TS2322 x34); config-tier 10; noise 13. Re-measured 63 -- the entry whose note was most misleading: it read "code-tier 9, the rest config-tier and noise".' } },
      },
      expect: [],
    },
    {
      label: 'a note carrying no tier itemisation at all is not a note this check reads',
      packages: [],
      root: { name: 'root', scripts: { typecheck: 'turbo run typecheck' } },
      state: { ...okState, debt: { root: { errors: 53, note: 'TS18046 x51; TS6133 x1; TS2352 x1. Measured 52 at 5ab08428 -> 53 at 34558c2cc.' } } },
      expect: [],
    },
    {
      label: 'a composition declared stale at the size it was tallied at passes, and the field is what is compared',
      packages: [],
      root: { name: 'root', scripts: { typecheck: 'turbo run typecheck' } },
      state: { ...okState, debt: { root: { errors: 80, compositionAt: 89, note: 'code-tier 30; config-tier 25; noise 34.' } } },
      expect: [],
    },
    {
      label: 'a declaration that does not match the tally it claims to describe still fails',
      packages: [],
      root: { name: 'root', scripts: { typecheck: 'turbo run typecheck' } },
      state: { ...okState, debt: { root: { errors: 80, compositionAt: 92, note: 'code-tier 30; config-tier 25; noise 34.' } } },
      expect: [/summing to 89 .* while the entry declares `compositionAt: 92`/],
    },
    {
      label: 'a declaration BELOW the field is a raised count wearing an unrewritten note, and is refused',
      packages: [],
      root: { name: 'root', scripts: { typecheck: 'turbo run typecheck' } },
      state: { ...okState, debt: { root: { errors: 95, compositionAt: 89, note: 'code-tier 30; config-tier 25; noise 34.' } } },
      expect: [/declares `compositionAt: 89` BELOW `errors: 95`/],
    },
    {
      label: 'a declaration equal to the field states nothing and is refused, so the field only ever shrinks away',
      packages: [],
      root: { name: 'root', scripts: { typecheck: 'turbo run typecheck' } },
      state: { ...okState, debt: { root: { errors: 89, compositionAt: 89, note: 'code-tier 30; config-tier 25; noise 34.' } } },
      expect: [/declares `compositionAt: 89`, which is `errors`/],
    },
    {
      label: 'a declaration over a note with no readable itemisation describes nothing and is refused',
      packages: [],
      root: { name: 'root', scripts: { typecheck: 'turbo run typecheck' } },
      state: { ...okState, debt: { root: { errors: 80, compositionAt: 89, note: 'TS18046 x51; TS6133 x1.' } } },
      expect: [/carries no readable tier itemisation for that number to describe/],
    },
    {
      label: 'COMPOSITION reads TEST_DEBT on the same terms as DEBT',
      packages: [pkg('a', { scripts: { typecheck: 'tsc --noEmit' }, hidesTests: true, testFiles: 3 })],
      root: okRoot,
      state: { ...okState, testDebt: { a: { errors: 355, note: 'code-tier 300; config-tier 9; noise 40.' } } },
      expect: [/a: TEST_DEBT note opens with a tier itemisation summing to 349/],
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
  // it was wired. `configsNamedByTypecheck` and `typecheckScriptChain` now
  // decide it, and since #11490 they live in `scripts/typecheck-configs.mjs`
  // because `check-type-source-resolution.mjs` needs the same answer for its
  // population. Their cases moved WITH them -- one rule, one home, one battery
  // -- and are folded in here so this gate still fails when the predicate it
  // depends on breaks.
  for (const failure of typecheckConfigsSelfTest()) failures.push(failure);

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
    // #10756. A source directory can be subtracted by a PLAIN PATH exclusion
    // rather than a test glob (`packages/create-objectstack` excludes
    // `src/templates`), and reading `include` alone would call such a file
    // covered while tsc never opens it.
    {
      label: 'a plain-path exclusion takes a source file back out of the program',
      config: { file: 'tsconfig.json', roots: ['src'], excludesTests: false, excludedPrefixes: ['src/templates'] },
      rel: 'src/templates/blank/index.ts',
      expect: false,
    },
    {
      label: 'that exclusion leaves the rest of the include root alone',
      config: { file: 'tsconfig.json', roots: ['src'], excludesTests: false, excludedPrefixes: ['src/templates'] },
      rel: 'src/engine.ts',
      expect: true,
    },
    {
      label: 'a plain-path exclusion must match a path SEGMENT too',
      config: { file: 'tsconfig.json', roots: ['src'], excludesTests: false, excludedPrefixes: ['src/temp'] },
      rel: 'src/templates/blank/index.ts',
      expect: true,
    },
    {
      label: 'a config carrying no excludedPrefixes at all still reads (older fixtures, real configs with no exclude)',
      config: src,
      rel: 'src/engine.ts',
      expect: true,
    },
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
    const got = unreadFiles(c.testRels, c.programs);
    if (JSON.stringify(got) !== JSON.stringify(c.expect)) {
      failures.push(`unreadFiles — ${c.label}: expected ${JSON.stringify(c.expect)}, got ${JSON.stringify(got)}`);
    }
  }

  // SOURCES_COVERED's file-level predicate (#10756). Each exclusion is a way
  // this invariant can be silently wrong: lose `depth > 0` and 42 packages'
  // tool configs flood the ledger, lose the test check and one hidden file is
  // billed to two ledgers, lose `.d.ts` and the gate reports a finding about a
  // file that states types rather than being checked for them.
  const sourceCandidateCases = [
    { label: 'a module in a subdirectory is the subject', name: 'dry-run-hash-compat.ts', depth: 1, expect: true },
    { label: 'the same module at the package root is not', name: 'dry-run-hash-compat.ts', depth: 0, expect: false },
    { label: 'a package-root tool config is out of scope by the depth rule', name: 'vitest.config.ts', depth: 0, expect: false },
    { label: 'the SAME tool config inside a directory IS in scope', name: 'i18n-extract.config.ts', depth: 1, expect: true },
    { label: 'a test file belongs to TESTS_COVERED, not here', name: 'engine.test.ts', depth: 1, expect: false },
    { label: 'a spec file likewise', name: 'engine.spec.tsx', depth: 2, expect: false },
    { label: 'a declaration file states types rather than being checked for them', name: 'globals.d.ts', depth: 1, expect: false },
    { label: 'a .mts module counts', name: 'check-liveness.mts', depth: 1, expect: true },
    { label: 'a .tsx module counts', name: 'panel.tsx', depth: 1, expect: true },
    { label: 'a non-TypeScript file is not source for this purpose', name: 'README.md', depth: 1, expect: false },
  ];
  for (const c of sourceCandidateCases) {
    const got = isUncheckedSourceCandidate(c.name, c.depth);
    if (got !== c.expect) {
      failures.push(`isUncheckedSourceCandidate — ${c.label}: expected ${c.expect}, got ${got}`);
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

  // GENERATED_COVERED's three observation helpers (#10880). Between them they
  // decide WHICH include entry is asked about and whether the script answers
  // it, so each is pinned where a wrong answer would be silent.
  const includeRootCases = [
    { label: 'a directory glob roots at the directory', glob: '.next/types/**/*.ts', expect: '.next/types' },
    { label: 'the ordinary source glob', glob: 'src/**/*', expect: 'src' },
    { label: 'a whole-package glob has the empty root', glob: '**/*.ts', expect: '' },
    { label: 'a literal file IS its own root', glob: 'next-env.d.ts', expect: 'next-env.d.ts' },
    { label: 'a trailing slash is not part of the root', glob: 'src/', expect: 'src' },
    { label: 'a single star roots the same way a double one does', glob: '.next/types/*.ts', expect: '.next/types' },
  ];
  for (const c of includeRootCases) {
    const got = includeRoot(c.glob);
    if (got !== c.expect) failures.push(`includeRoot — ${c.label}: expected ${JSON.stringify(c.expect)}, got ${JSON.stringify(got)}`);
  }

  const chainCases = [
    { label: 'the typecheck body is the chain', scripts: { typecheck: 'next typegen && tsc --noEmit' }, expect: ['next typegen && tsc --noEmit'] },
    {
      label: 'delegated bodies are kept SEPARATE, which is what makes order decidable',
      scripts: { typecheck: 'pnpm gen && tsc --noEmit', gen: 'next typegen' },
      expect: ['pnpm gen && tsc --noEmit', 'next typegen'],
    },
    { label: 'no typecheck script is an empty chain', scripts: { build: 'tsup' }, expect: [] },
  ];
  for (const c of chainCases) {
    const got = typecheckScriptChain(c.scripts);
    if (JSON.stringify(got) !== JSON.stringify(c.expect)) {
      failures.push(`typecheckScriptChain — ${c.label}: expected ${JSON.stringify(c.expect)}, got ${JSON.stringify(got)}`);
    }
  }

  const generatorCases = [
    { label: 'generator before tsc in one body', chain: ['next typegen && tsc --noEmit'], expect: 'ok' },
    { label: 'the measured defect: tsc alone', chain: ['tsc --noEmit'], expect: 'missing' },
    { label: 'generator after tsc in one body', chain: ['tsc --noEmit && next typegen'], expect: 'after' },
    { label: 'the real apps/docs shape, with a third command in front', chain: ['fumadocs-mdx && next typegen && tsc --noEmit'], expect: 'ok' },
    {
      // The abstention. Text order across bodies is VISIT order, not shell
      // order -- `pnpm gen && tsc` runs the generator first while the chain
      // lists it second, so an order verdict here would be a false red on a
      // correct config.
      label: 'a generator reached through indirection is present, and its order is not guessed at',
      chain: ['pnpm gen && tsc --noEmit', 'next typegen'],
      expect: 'ok',
    },
    { label: 'extra whitespace is the same command', chain: ['next   typegen && tsc'], expect: 'ok' },
    { label: 'a command that merely CONTAINS the name is not it', chain: ['prenext typegen && tsc'], expect: 'missing' },
    { label: 'a body that runs the generator and no tsc at all still counts as running it', chain: ['next typegen'], expect: 'ok' },
    { label: 'nothing at all', chain: [], expect: 'missing' },
  ];
  for (const c of generatorCases) {
    const got = generatorVerdict(c.chain, 'next typegen');
    if (got !== c.expect) failures.push(`generatorVerdict — ${c.label}: expected ${c.expect}, got ${got}`);
  }

  // The generated layer's summary arithmetic. `produced` + `ungenerated` must
  // equal `entries` or the line printed on a green run is telling the reader
  // about a state the verdict already forbade.
  const layerCases = [
    {
      label: 'one produced and one ungenerated entry in one package',
      packages: [pkg('a', { generatedIncludes: [{ root: '.next/types' }, { root: '.next/dev/types' }] })],
      table: { '.next/types': { generator: 'next typegen' }, '.next/dev/types': { generator: null } },
      expect: { entries: 2, packages: 1, produced: 1, ungenerated: 1 },
    },
    {
      label: 'packages with no generated include are not counted as packages',
      packages: [pkg('a', { generatedIncludes: [] }), pkg('b', { generatedIncludes: [{ root: '.next/types' }] })],
      table: { '.next/types': { generator: 'next typegen' } },
      expect: { entries: 1, packages: 1, produced: 1, ungenerated: 0 },
    },
    { label: 'a workspace with none', packages: [pkg('a')], table: {}, expect: { entries: 0, packages: 0, produced: 0, ungenerated: 0 } },
  ];
  for (const c of layerCases) {
    const got = generatedIncludeLayer(c.packages, c.table);
    if (JSON.stringify(got) !== JSON.stringify(c.expect)) {
      failures.push(`generatedIncludeLayer — ${c.label}: expected ${JSON.stringify(c.expect)}, got ${JSON.stringify(got)}`);
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
    // (3)'s fixture is SYNTHETIC, not the real message with the marker stripped
    // out. Derived from the real message, this assertion also fired whenever the
    // offer was reworded -- two named failures for one rot, and the second one
    // misdescribed the cause ("the predicate is not discriminating" when in fact
    // the detector had simply stopped matching). Built here from the same
    // constant the detector is, it stays green under a rewording, so (1) owns
    // that failure alone. Measured, not assumed: this exact case is why.
    const unmarkedOffer = `TEST_DEBT drifted upward. raise the entry in ${SELF} AND rewrite its note.`;
    if (!RATCHET_EXPANSION_OFFER.test(unmarkedOffer)) {
      failures.push(
        '#8435 convention — the synthetic unmarked-offer fixture is no longer recognised as an offer, ' +
          'so it cannot test discrimination at all. Re-spell it to match RATCHET_EXPANSION_OFFER.',
      );
    } else if (ratchetRemedyCarriesAuthority(unmarkedOffer)) {
      failures.push(
        '#8435 convention — ratchetRemedyCarriesAuthority() ACCEPTED a message that offers the ' +
          'ratchet-raising path with no marker at all. The predicate is not discriminating, so the ' +
          'assertion above proves nothing.',
      );
    }
  }

  // ── The graduation remedy is a function of the LEDGER (#11491) ─────────────
  //
  // The defect this replaces was a message that read CORRECTLY on the ledger it
  // happened to be written for and wrongly on the other one, so every assertion
  // here comes in a pair: the remedy that must be present, and the remedy that
  // must be ABSENT. A regex that only checks presence would stay green if the
  // two branches were re-merged into one sentence -- which is precisely the
  // state this replaces, and the state a well-meaning "simplification" returns
  // to.
  //
  // The graduation note is a NOTE in every case below. None of these fixtures
  // produces a problem, and an implementation that made a graduation red would
  // fail the `problems.length` half of every one of them.
  const gradNote = (m) => evaluateMeasurements([{ recorded: 7, actual: 0, name: 'a', ...m }]).notes[0];
  const debtGrad = gradNote({ ledger: 'DEBT' });
  const testDebtGrad = gradNote({ ledger: 'TEST_DEBT' });
  const rootGrad = gradNote({ ledger: 'DEBT', isRoot: true });

  const ADD_SCRIPT = '`"typecheck": "tsc --noEmit"`';
  const gradCases = [
    {
      label: 'DEBT graduation offers the script remedy -- that ledger IS "src does not check"',
      message: debtGrad,
      present: [ADD_SCRIPT],
      absent: ['drop the test exclusion'],
      why: 'a DEBT graduate has no `typecheck` script at all; naming the test exclusion here sends the '
        + 'author to edit a tsconfig that is not the hole.',
    },
    {
      label: 'TEST_DEBT graduation does NOT tell the author to add a script it already has',
      message: testDebtGrad,
      present: ['put the hidden test files in front of tsc'],
      absent: [ADD_SCRIPT],
      why: 'measured at e47d5ef61: 19 of 19 TEST_DEBT entries already declare a `typecheck` script, so '
        + 'that remedy is a no-op on every one of them -- the misfire #11491 was filed on.',
    },
    {
      label: 'TEST_DEBT graduation names the gate that DECIDES whether the exclusion route is available',
      message: testDebtGrad,
      present: ['check:type-source-resolution', 'SHRINK-ONLY', 'tsconfig.test.json'],
      absent: [],
      why: 'the exclusion route reds that gate on 14 of the 18 entries that have an exclusion, and this '
        + 'gate never runs it. A message the author has to read a second gate\'s SOURCE to act on is the '
        + 'half of #11491 that a correct-but-terse rewrite would leave unfixed.',
    },
    {
      label: 'the workspace root graduates through `typecheck:root`, never through `typecheck`',
      message: rootGrad,
      present: ['`typecheck:root`', 'aggregator'],
      absent: [ADD_SCRIPT],
      why: 'the root\'s `typecheck` slot is `turbo run typecheck`; an author who overwrote it with '
        + '`tsc --noEmit` would stop every other package from being type-checked and this gate would '
        + 'still go green.',
    },
    {
      label: 'an unrecognised ledger inherits NEITHER remedy',
      message: gradNote({ ledger: 'FUTURE_DEBT' }),
      present: ['FUTURE_DEBT'],
      absent: [ADD_SCRIPT, 'drop the test exclusion', 'check:type-source-resolution'],
      why: 'a third ledger silently receiving DEBT\'s advice is how this message was wrong for TEST_DEBT '
        + 'for its whole life. Saying less is the only safe default.',
    },
  ];
  for (const c of gradCases) {
    for (const needle of c.present) {
      if (!c.message.includes(needle))
        failures.push(`#11491 graduation remedy — ${c.label}: message does not contain ${needle}. ${c.why}`);
    }
    for (const needle of c.absent) {
      if (c.message.includes(needle))
        failures.push(
          `#11491 graduation remedy — ${c.label}: message STILL contains ${needle}, which is the other `
            + `ledger's remedy. ${c.why}`,
        );
    }
  }

  // THE CONTROL. Splitting the remedy must not move the half of this note that
  // is about `--lower` rather than about either ledger: it is the same sentence
  // for a graduation from anywhere, and it is the one that stops a graduation
  // being auto-written into the ledger as a 0. Pinned across ALL branches, so a
  // future branch that forgets to carry it is named here rather than noticed
  // when someone runs `--lower` on a graduate.
  const LOWER_CLAUSE =
    '`--lower` deliberately leaves this one alone: 0 is not a lower ceiling, it is a graduation, and an '
    + 'entry recording 0 fails the structural half of this gate.';
  for (const [what, message] of [['DEBT', debtGrad], ['TEST_DEBT', testDebtGrad], ['the root', rootGrad]]) {
    if (!message.includes(LOWER_CLAUSE))
      failures.push(
        `#11491 graduation remedy — the \`--lower\` clause is missing from the ${what} branch. That `
          + 'sentence is ledger-independent and must survive the split; without it a graduate reads as '
          + 'something `--lower` could write back as 0, which fails the structural half of this gate.',
      );
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
    // TS6059 in the GENERATED re-measure project (#10779). Both directions,
    // because each is a way this can be silently wrong: still counting it bills
    // a package for a diagnostic about a config this file wrote, and dropping
    // it everywhere would blind `measureDebt` to a real property of a config
    // the package ships and emits from.
    {
      label: 'TS6059 counts for a package\'s own config, which is what DEBT measures',
      output: "packages/a/src/x.test.ts(5,51): error TS6059: File '/r/packages/a/scripts/y.ts' is not under 'rootDir'.",
      expect: 1,
    },
    {
      label: 'TS6059 does NOT count in the generated re-measure project -- measuring the tape measure',
      output: "packages/a/src/x.test.ts(5,51): error TS6059: File '/r/packages/a/scripts/y.ts' is not under 'rootDir'.",
      options: { dropRootDirDiagnostics: true },
      expect: 0,
    },
    {
      label: 'dropping TS6059 leaves every other diagnostic in the generated project counted',
      output:
        "packages/a/src/x.test.ts(5,51): error TS6059: File '/r/packages/a/scripts/y.ts' is not under 'rootDir'.\n" +
        'packages/a/src/x.test.ts(9,1): error TS2345: Argument of type X.\n' +
        "packages/a/src/z.test.ts(2,2): error TS6059: File '/r/packages/a/scripts/w.ts' is not under 'rootDir'.\n" +
        'packages/a/src/z.test.ts(4,4): error TS7006: Parameter implicitly any.',
      options: { dropRootDirDiagnostics: true },
      expect: 2,
    },
    {
      label: 'a TS6059 elaboration line is not counted twice when the drop is off',
      output:
        "packages/a/src/x.test.ts(5,51): error TS6059: File '/r/packages/a/scripts/y.ts' is not under 'rootDir'.\n" +
        "  'rootDir' is expected to contain all source files.\n",
      expect: 1,
    },
  ];
  for (const c of countCases) {
    const got = countTscErrors(c.output, c.options);
    if (got !== c.expect) failures.push(`countTscErrors — ${c.label}: expected ${c.expect}, got ${got}`);
  }

  // The generated project is the ONLY caller that drops TS6059, and that is a
  // property of the wiring rather than of the counter -- so it is pinned on the
  // wiring. A `measureTestDebt` that stopped passing the flag, or a
  // `measureDebt` that started, would leave every case above green.
  {
    const src = readFileSync(join(ROOT, SELF), 'utf8');
    // Matched as a CALL, not as the bare option name: the fixtures above spell
    // that name too, and a scan that counted those would report 6 and fail on
    // its own test data.
    const dropCallers = [...src.matchAll(/tscErrorCount\([^)]*\{ dropRootDirDiagnostics: true \}/g)].length;
    if (dropCallers !== 1) {
      failures.push(
        `#10779 wiring — ${dropCallers} call site(s) in ${SELF} ask \`tscErrorCount\` to drop TS6059; ` +
          'exactly one may, and it is the generated re-measure project. A second caller would be ' +
          "measuring a package's own shipped config with the tape measure's allowance.",
      );
    }
    if (!/return tscErrorCount\(configPath, \{ dropRootDirDiagnostics: true \}\)/.test(src)) {
      failures.push(
        `#10779 wiring — \`measureTestDebt\` no longer asks \`tscErrorCount\` to drop TS6059, so the ` +
          'generated project is billing packages for its own `rootDir` again (objectql measured 355 ' +
          'that way and 354 without).',
      );
    }
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

  // THE CI-SHAPED HEAP CEILING (#12856). The only instrument this rule can
  // have. Its production reading is a ceiling that is applied and a run that
  // then passes -- and a run that passes is precisely what the UNPINNED gate
  // also produced on every machine that had the memory to spare. So the
  // production verdict cannot tell a correct ceiling from no ceiling at all,
  // and the adversarial inputs below are the whole difference.
  const ceilingCases = [
    {
      label: 'a roomier box than CI is capped to the CI ceiling -- the defect this pin closes',
      where: { heapLimitMb: 8240 },
      expect: { mb: CI_TSC_HEAP_CEILING_MB, stale: false },
    },
    {
      label: 'on a box shaped like CI the ceiling is a no-op that still names itself',
      where: { heapLimitMb: CI_TSC_HEAP_CEILING_MB + 48, onCi: true },
      expect: { mb: CI_TSC_HEAP_CEILING_MB, stale: false },
    },
    {
      // Never RAISE. Promising V8 memory the box does not have trades a
      // recoverable heap error for a kernel SIGKILL that says nothing.
      label: 'a box SMALLER than CI keeps its own lower ceiling',
      where: { heapLimitMb: 2096 },
      expect: { mb: 2096, stale: false },
    },
    {
      label: "a caller's TIGHTER NODE_OPTIONS cap is honoured",
      where: { heapLimitMb: 8240, nodeOptions: '--max-old-space-size=1024' },
      expect: { mb: 1024, stale: false },
    },
    {
      // The hole a "respect the caller" rule would leave: a roomier explicit
      // cap is the green-here-red-there reading, handed back by request.
      label: "a caller's ROOMIER NODE_OPTIONS cap is refused, not respected",
      where: { heapLimitMb: 12288, nodeOptions: '--max-old-space-size=12288' },
      expect: { mb: CI_TSC_HEAP_CEILING_MB, stale: false },
    },
    {
      // The direction nothing else can catch: the runner shrank, so the pin is
      // now ABOVE the ceiling it describes and every local run is roomier than
      // CI again -- silently, and with the pin's own confidence attached.
      label: 'a CI runner whose own default is BELOW the pin is refused, loudly',
      where: { heapLimitMb: 2096, onCi: true },
      expect: { mb: 2096, stale: true },
    },
    {
      // THE CONTROL for the case above. Off CI the same numbers are an
      // ordinary small box, not evidence about CI -- reading them as a stale
      // pin would refuse on every laptop with 4 GB in it.
      label: 'the same reading OFF ci is a small box, not a stale pin',
      where: { heapLimitMb: 2096, onCi: false },
      expect: { mb: 2096, stale: false },
    },
  ];
  for (const c of ceilingCases) {
    const got = remeasureHeapCeiling(c.where);
    if (got.mb !== c.expect.mb || (got.stale !== null) !== c.expect.stale) {
      failures.push(
        `remeasureHeapCeiling — ${c.label}: expected ${c.expect.mb} MB and stale=${c.expect.stale}, `
          + `got ${got.mb} MB and stale=${got.stale === null ? 'false' : JSON.stringify(got.stale)}`,
      );
    }
    if (got.machineMb !== c.where.heapLimitMb) {
      failures.push(
        `remeasureHeapCeiling — ${c.label}: reported machineMb ${got.machineMb} for a box of `
          + `${c.where.heapLimitMb} MB. That figure is what a CI log carries forward as the runner's own `
          + `reading, so a wrong one re-pins the constant wrong.`,
      );
    }
  }

  // The two mechanical halves of the ceiling: which occurrence V8 obeys, and
  // that appending is therefore enough. Both measured against node itself
  // before they were written down -- `--max-old-space-size=8192
  // --max-old-space-size=512` reports a 560 MB limit, the reverse 8240.
  const heapEnvCases = [
    { label: 'no NODE_OPTIONS is no caller cap', options: undefined, expect: null },
    { label: 'an unrelated flag is not a cap', options: '--enable-source-maps', expect: null },
    { label: 'the flag without a value is not a cap', options: '--max-old-space-size', expect: null },
    { label: 'the dashed spelling parses', options: '--max-old-space-size=4096', expect: 4096 },
    { label: 'the underscored spelling V8 also accepts parses', options: '--max_old_space_size=512', expect: 512 },
    { label: 'a repeated flag reads the LAST, as V8 does', options: '--max-old-space-size=8192 --max-old-space-size=512', expect: 512 },
    { label: 'the cap is found among other flags', options: '--enable-source-maps --max-old-space-size=2048 --no-warnings', expect: 2048 },
  ];
  for (const c of heapEnvCases) {
    const got = maxOldSpaceMb(c.options);
    if (got !== c.expect) failures.push(`maxOldSpaceMb — ${c.label}: expected ${c.expect}, got ${got}`);
    // The appended env must be the thing V8 then obeys -- i.e. OUR flag has to
    // be the last one in the string, whatever the caller put there.
    const appended = heapCappedEnv({ PATH: '/usr/bin', NODE_OPTIONS: c.options }, 777);
    if (maxOldSpaceMb(appended.NODE_OPTIONS) !== 777) {
      failures.push(
        `heapCappedEnv — ${c.label}: the appended ceiling does not win; V8 would obey `
          + `${maxOldSpaceMb(appended.NODE_OPTIONS)} from ${JSON.stringify(appended.NODE_OPTIONS)}`,
      );
    }
    if (appended.PATH !== '/usr/bin') {
      failures.push(`heapCappedEnv — ${c.label}: dropped the rest of the environment`);
    }
    if (c.options !== undefined && !appended.NODE_OPTIONS.startsWith(c.options)) {
      failures.push(
        `heapCappedEnv — ${c.label}: dropped the caller's own NODE_OPTIONS (${JSON.stringify(c.options)}), `
          + `which may be the reason their run works at all`,
      );
    }
  }

  // AUTO-LOWERING (#6376). What it refuses matters more than what it writes.
  const planCases = [
    {
      label: 'a shrunk entry is lowered to its measurement',
      measurements: [{ ledger: 'DEBT', name: 'a', recorded: 52, actual: 42 }],
      lowerings: [{ ledger: 'DEBT', name: 'a', from: 52, to: 42, declareCompositionAt: null }],
      graduations: [],
    },
    {
      // #10722, the root cause. Without the declaration this plan is the whole
      // defect: the digits move to 42 and the note keeps itemising 52.
      label: 'a lowering that would strand a tier itemisation carries the declaration that keeps the entry honest',
      measurements: [{ ledger: 'DEBT', name: 'a', recorded: 52, actual: 42, note: 'code-tier 30; config-tier 12; noise 10.' }],
      lowerings: [{ ledger: 'DEBT', name: 'a', from: 52, to: 42, declareCompositionAt: 52 }],
      graduations: [],
    },
    {
      label: 'an itemisation that already sums to the MEASURED number needs no declaration',
      measurements: [{ ledger: 'DEBT', name: 'a', recorded: 52, actual: 42, note: 'code-tier 30; config-tier 10; noise 2.' }],
      lowerings: [{ ledger: 'DEBT', name: 'a', from: 52, to: 42, declareCompositionAt: null }],
      graduations: [],
    },
    {
      label: 'an entry that already declared its tally size keeps it — the tally does not move because the field did',
      measurements: [{ ledger: 'DEBT', name: 'a', recorded: 52, actual: 42, compositionAt: 89, note: 'code-tier 30; config-tier 12; noise 47.' }],
      lowerings: [{ ledger: 'DEBT', name: 'a', from: 52, to: 42, declareCompositionAt: null }],
      graduations: [],
    },
    {
      label: 'an ambiguous note is declared about by nobody — the planner abstains exactly where the check does',
      measurements: [{ ledger: 'DEBT', name: 'a', recorded: 52, actual: 42, note: 'code-tier 30; config-tier 12; noise 10. The old note read "code-tier 9".' }],
      lowerings: [{ ledger: 'DEBT', name: 'a', from: 52, to: 42, declareCompositionAt: null }],
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
    "  '@objectstack/inline': { errors: 9, note: 'code-tier 9.' },",
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
      // #10722, both halves meeting. The lowering writes `compositionAt`
      // beside the number, indented like the `errors:` it follows.
      label: 'a lowering that would strand a tier itemisation writes the declaration beside the number',
      lowerings: [{ ledger: 'DEBT', name: '@objectstack/rest', from: 2, to: 1, declareCompositionAt: 2 }],
      applied: 1,
      skipped: 0,
      assert: (out) => /const DEBT[\s\S]*?errors: 1,\n    compositionAt: 2,\n    note: 'code-tier 2\./.test(out),
    },
    {
      label: 'a single-line entry takes the declaration inline rather than inventing an indent',
      lowerings: [{ ledger: 'DEBT', name: '@objectstack/inline', from: 9, to: 4, declareCompositionAt: 9 }],
      applied: 1,
      skipped: 0,
      assert: (out) => /'@objectstack\/inline': \{ errors: 4, compositionAt: 9, note: 'code-tier 9\.' \},/.test(out),
    },
    {
      label: 'a lowering with nothing to declare leaves the entry the shape it was',
      lowerings: [{ ledger: 'DEBT', name: '@objectstack/inline', from: 9, to: 4, declareCompositionAt: null }],
      applied: 1,
      skipped: 0,
      assert: (out) => /'@objectstack\/inline': \{ errors: 4, note: 'code-tier 9\.' \},/.test(out)
        && !out.includes('compositionAt'),
    },
    {
      label: 'the declaration lands in the NAMED ledger only, never on the same name in the other one',
      lowerings: [{ ledger: 'TEST_DEBT', name: '@objectstack/rest', from: 163, to: 144, declareCompositionAt: 163 }],
      applied: 1,
      skipped: 0,
      assert: (out) => /const TEST_DEBT[\s\S]*'@objectstack\/rest': \{ errors: 144, compositionAt: 163, note: 'y' \}/.test(out)
        && /const DEBT[\s\S]*'@objectstack\/rest': \{\n    errors: 2,\n    note:/.test(out),
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

  // #10722 END TO END, over the rewriter's own output rather than over a
  // regex: lower an entry whose note itemises the pile it is leaving, then read
  // the rewritten ledger back with the check that guards the real one. WITHOUT
  // the declaration the result is a freshly minted note-vs-field contradiction
  // -- which is what every `--lower` run produced before this change, and is
  // the assertion that fails if either half is ever taken back out.
  const debtOf = (source) => {
    const start = source.indexOf('const DEBT = {');
    const end = source.indexOf('\n};', start);
    return new Function(`return ${source.slice(source.indexOf('{', start), end + 2)}`)();
  };
  const stranded = { ledger: 'DEBT', name: '@objectstack/inline', from: 9, to: 4 };
  const roundTripCases = [
    {
      label: 'lowering the digits ALONE leaves a note contradicting its field — the root cause, pinned',
      lowering: { ...stranded, declareCompositionAt: null },
      expect: [/summing to 9 \(code-tier 9\) while the entry records `errors: 4`/],
    },
    {
      label: 'the same lowering, declared, reads back clean through the check that guards the real ledger',
      lowering: { ...stranded, declareCompositionAt: 9 },
      expect: [],
    },
  ];
  for (const c of roundTripCases) {
    const got = compositionProblems('DEBT', debtOf(lowerLedgerEntries(ledgerFixture, [c.lowering]).source));
    if (got.length !== c.expect.length || !c.expect.every((rx, i) => rx.test(got[i]))) {
      failures.push(`lowerLedgerEntries round-trip — ${c.label}: expected ${c.expect}, got ${JSON.stringify(got)}`);
    }
  }

  // ── THE EXIT-CODE CLASS ───────────────────────────────────────────────────
  //
  // Pinned because it is exactly the kind of fact that rots back silently. The
  // defect this replaces was not a wrong number typed anywhere: it was a
  // refusal that reached node's UNCAUGHT handler, which exits 1 -- so the
  // regression shape is one careless `throw new Error(...)` added to a refusing
  // function by an author who never thought about exit codes at all, and it
  // announces itself with a green CI (every consumer of this gate treats any
  // non-zero as failure, so 1-instead-of-3 is invisible to all of them) and a
  // human-readable message that still says the right thing. Nothing else in
  // this file would notice.
  //
  // So the pin is over the FUNCTION BODIES, not over a constant. Reading the
  // real `Function.prototype.toString()` of the four functions that refuse is
  // what makes a re-added `throw` fail here rather than in six weeks, on a card
  // about something else.
  const REFUSING = [refreshBuiltClosure, tscErrorCount, measureLedgers, gitIgnoredPaths];
  for (const fn of REFUSING) {
    const body = fn.toString();
    if (/throw new Error\(/.test(body)) {
      failures.push(
        `${fn.name} raises a bare \`throw new Error(\` — an uncaught throw exits 1, the code this gate ` +
          `reserves for a ledger entry that drifted UPWARD. A refusal must go through ` +
          `refusePrerequisite() so it exits ${EXIT_PREREQUISITE_NOT_MET}.`,
      );
    }
    if (!body.includes('refusePrerequisite(')) {
      failures.push(`${fn.name} no longer refuses through refusePrerequisite() — the exit-code class is unpinned`);
    }
  }
  // The NEGATIVE control, and the reason the loop above is a measurement rather
  // than a tautology over an empty set: `readTsconfig` still throws, on purpose.
  // A `tsconfig.json` checked into the tree that does not parse is a fact about
  // the TREE -- a finding -- not a prerequisite the caller forgot to supply, so
  // it keeps exit 1 and the pin above must be able to SEE a bare throw.
  if (!/throw new Error\(/.test(readTsconfig.toString())) {
    failures.push(
      'readTsconfig no longer throws — the bare-throw pin above can no longer fail, so it stopped measuring',
    );
  }

  const exitCodeCases = [
    { label: 'the refusal code is 3', ok: EXIT_PREREQUISITE_NOT_MET === 3 },
    { label: 'a finding is 1', ok: EXIT_FINDINGS === 1 },
    { label: 'the refusal code is distinct from a finding and from a pass',
      ok: EXIT_PREREQUISITE_NOT_MET !== EXIT_FINDINGS && EXIT_PREREQUISITE_NOT_MET !== EXIT_OK },
  ];
  for (const c of exitCodeCases) {
    if (!c.ok) failures.push(`exit-code contract — ${c.label}`);
  }

  // The refusal TEXT. Four load-bearing clauses, each one a thing a reader who
  // sees only the exit code cannot get anywhere else.
  const refusalFixture = '--re-measure cannot run: 48 workspace dependenc(ies) have no built type entry point';
  const refusalText = prerequisiteNotMetText(refusalFixture);
  const textCases = [
    { label: 'carries the raising site\'s own message VERBATIM', ok: refusalText.includes(refusalFixture) },
    { label: 'names the class', ok: refusalText.includes('PREREQUISITE NOT MET') },
    { label: 'says it is neither a pass nor a finding', ok: /NOT a pass and NOT a finding/.test(refusalText) },
    { label: 'names its own code and the finding code it is distinct from',
      ok: refusalText.includes(`Exit code ${EXIT_PREREQUISITE_NOT_MET}`)
        && refusalText.includes(`a finding's ${EXIT_FINDINGS}`) },
    // The specific misreading this whole change exists to stop: taking an
    // unmeasurable run for "a recorded debt went up" routes the reader to the
    // ledger, and raising an entry there is a maintainer's act.
    { label: 'turns the reader away from the ledger rather than toward it',
      ok: /no ledger entry below may\n?\s*be raised on it/.test(refusalText) },
    { label: 'warns that the code must be captured before any pipe', ok: refusalText.includes('BEFORE any pipe') },
  ];
  for (const c of textCases) {
    if (!c.ok) failures.push(`prerequisiteNotMetText — ${c.label}`);
  }

  // The shared workspace enumerator is a plain module with no CI invocation of
  // its own (#11510); every gate that consolidated onto it folds in its checks.
  failures.push(...workspaceEnumeratorSelfTest({ root: ROOT }));

  if (failures.length) {
    console.error(`✗ check:type-check-coverage --self-test — ${failures.length} failure(s)\n`);
    for (const f of failures) console.error('  • ' + f);
    process.exit(1);
  }
  console.log(
    `✓ check:type-check-coverage --self-test — ${cases.length} semantic case(s) + ` +
      `${TYPECHECK_CONFIGS_CASES + coverCases.length + unreadCases.length + accountedCases.length
        + derivedCases.length + sourceCandidateCases.length + includeRootCases.length
        + chainCases.length + generatorCases.length + layerCases.length} observation case(s) + ` +
      `${driftCases.length + countCases.length + projectCases.length + setupErrorCases.length
        + ceilingCases.length + heapEnvCases.length} re-measure case(s) + ` +
      `${typeEntryCases.length + closureCases.length + staleCases.length + sourceFileCases.length} ` +
      `built-closure case(s) + ` +
      `${planCases.length + rewriteCases.length + roundTripCases.length} auto-lowering case(s) + ` +
      `${REFUSING.length * 2 + 1 + exitCodeCases.length + textCases.length} exit-code case(s) hold.`,
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
const sourceLayer = uncheckedSourceLayer(packages, UNCHECKED_SOURCE_DEBT);
const generatedLayer = generatedIncludeLayer(packages, GENERATED_INCLUDE_ROOTS);
const declaredStale = [...Object.entries(DEBT), ...Object.entries(TEST_DEBT)]
  .filter(([, entry]) => typeof entry?.compositionAt === 'number');
// Both numbers, always. Reporting only the src figure is how the first pass of
// this gate read as 48/77 green while 568 test files went unchecked.
console.log(
  `check-type-check-coverage: OK — ${covered}/${packages.length} workspace packages type-checked ` +
    `(plus the root), ${Object.keys(DEBT).length} in the DEBT ledger (${debtTotal} frozen raw errors, ` +
    `${TRACKING_ISSUE}), ${Object.keys(EXEMPT).length} exempt.\n` +
    `  test layer: ${Object.keys(TEST_DEBT).length} package(s) still hide their own tests from tsc ` +
    `(${testDebtFiles} files hidden as counted by this run, ${testDebtErrors} frozen raw errors in TEST_DEBT).` +
    // The THIRD layer, printed for the reason the second one is: a package can
    // be COVERED, have every test in a program, and still keep a whole source
    // directory out of both (#10756). Reporting only the first two figures is
    // how that stayed invisible.
    `\n  source layer: ${sourceLayer.dirs} directory(ies) of non-test source in ` +
    `${Object.keys(UNCHECKED_SOURCE_DEBT).length} ledgered entr(y/ies) sit outside every tsc program ` +
    `their package's own \`typecheck\` runs (${sourceLayer.files} files as counted by this run).` +
    // The FOURTH layer (#10880), printed for the reason the other two are: an
    // `include` entry pointing at a directory nothing produces is invisible in
    // every count above, because those are all questions about files that
    // exist. Both halves are reported -- an ungenerated row is a standing
    // decision, and a decision nobody can see is the half that rots.
    `\n  generated layer: ${generatedLayer.entries} \`include\` entr(ies) across ` +
    `${generatedLayer.packages} package(s) name a path this repo does not check in -- ` +
    `${generatedLayer.produced} produced by their own \`typecheck\` before tsc, ` +
    `${generatedLayer.ungenerated} declared deliberately ungenerated in GENERATED_INCLUDE_ROOTS.` +
    // Printed on a GREEN run, for the same reason the surplus is (#6376): a
    // declared-stale composition is honest but it is still drift, and a
    // declaration nobody can see is the half that does the damage. Zero is the
    // goal; re-tallying an entry and deleting its `compositionAt` gets there.
    (declaredStale.length === 0
      ? ''
      : `\n  composition: ${declaredStale.length} entr(ies) carry a tier itemisation DECLARED stale by ` +
        `\`compositionAt\` -- ${declaredStale.map(([name, e]) => `${name} (tallied at ${e.compositionAt}, ` +
          `recorded ${e.errors})`).join(', ')}. Each is a note waiting to be re-tallied onto what its ` +
        `package now measures (#10722).`),
);

// MEASURED runs only when asked, and only after the structural verdict above is
// clean: a ledger entry naming a package that no longer exists has nothing to
// measure, and a wall of tsc output would bury the real failure. Reported after
// the summary so the two verdicts read in the order they were reached.
if (process.argv.includes('--re-measure')) {
  // The ceiling FIRST, before the four minutes of tsc it shapes (#12856). Two
  // jobs, and the second is the one that keeps the constant honest: on CI this
  // line prints the RUNNER's own default into the run log, so the number
  // `CI_TSC_HEAP_CEILING_MB` claims is re-derivable from any CI log of this
  // step rather than from archaeology through a failed job's GC trace.
  if (REMEASURE_HEAP.stale) {
    if (process.env.GITHUB_ACTIONS === 'true') console.log(`::error::${REMEASURE_HEAP.stale}`);
    console.error(`\ncheck-type-check-coverage --re-measure: ${REMEASURE_HEAP.stale}`);
    process.exit(1);
  }
  console.log(
    `  heap: tsc runs under --max-old-space-size=${REMEASURE_HEAP.mb} MB -- ${REMEASURE_HEAP.from}; `
      + `this process's own limit is ${REMEASURE_HEAP.machineMb} MB. A measurement is only as portable as `
      + `the ceiling it ran under (#12856).`,
  );
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
        `  Review and commit ${SELF}. Each \`note\` still describes the LARGER pile it was written for -- ` +
          `where that pile was itemised by tier, the \`compositionAt\` written beside the number now says so ` +
          `out loud, which is what stops the note from quietly contradicting its field (#10722). Re-tally ` +
          `the ones you can attribute and delete their \`compositionAt\`; leave the rest rather than ` +
          `inventing a composition.`,
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
  // could not have told you: how much silence the ledger is currently buying.
  // Zero is the goal and `--lower` is one command away from it.
  //
  // No issue number belongs in this line. It named #6376 until #11497: #6376
  // was the design discussion that PRODUCED this very mechanism (the surplus
  // print plus `--lower`, shipped by PR #6510) and closed once that landed --
  // it was never a standing tracker for individual surpluses, and treating it
  // as one routed readers to a closed issue with nothing left to do there
  // (#11497 measured this happening: a dev read the advisory, followed it to
  // #6376, and filed nothing). There is no successor tracking issue and none
  // is needed -- the mechanism IS the successor: a surplus this line reports
  // is closed by running `--lower`, not by reading a card.
  console.log(
    surplusEntries === 0
      ? `  surplus: none — every entry sits exactly at its measurement, so any new error is red.`
      : `  surplus: ${surplus} raw error(s) across ${surplusEntries} entr(ies) sit BELOW their recorded ` +
        `ceiling — that many regressions can land in layers no other gate reads without this one saying ` +
        `anything. Close it with \`pnpm check:type-check-debt --lower\`.`,
  );
}
