#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// measure-durability-swallow-family -- the #12981 CENSUS instrument.
//
//   node scripts/measure-durability-swallow-family.mjs             # census
//   node scripts/measure-durability-swallow-family.mjs --sites     # every site
//   node scripts/measure-durability-swallow-family.mjs --json      # machine
//   node scripts/measure-durability-swallow-family.mjs --file <p>  # one file
//   node scripts/measure-durability-swallow-family.mjs --self-test # all 4 control families
//   node scripts/measure-durability-swallow-family.mjs --self-test=gated
//                                                      # the 3 families CI runs
//
// THE CENSUS is NOT a gate: it exits 0 on any membership count, it prints "a
// MEASUREMENT, not a gate" on every run of it, and the file is deliberately not
// named `check:*` or `gen:*` so the #4203 script ledger has nothing to classify
// (the shape `measure-partial-retirement-annotation.mjs` established). The only
// non-zero exits are a `--self-test` failing its declared controls, an unknown
// `--self-test=` mode (REFUSED, exit 2), and `ts-parse`'s EXIT_UNPARSEABLE.
//
// WHAT CI RUNS, since #13919 (maintainer ruling of 2026-09-01, verbatim 「同意」):
// the root alias `check:swallow-census-controls` runs `--self-test=gated` from
// `lint.yml` -- the same shape as the sanctioned precedent
// `check:stall-guard-headroom` -> `measure-stall-guard-headroom.mjs --self-test`,
// and the same asymmetry: the SELF-TEST leg only, never a bare invocation. What
// is gated is THIS INSTRUMENT'S OWN CONTROLS; no membership count can redden it,
// so the census stays a measurement. That ruling also amends #12981's sanctioned
// single-entry-point shape to "single entry point + a family flag" -- read
// SELF_TEST_MODES for the split's whole rationale and for why POSITIVE_CONTROLS
// is excluded permanently rather than pending.
//
// THE PRINTED WORKLIST vs MEMBERSHIP, since #13886: the tier-1 heading says
// "the repair worklist", and four of its five rows were settled determinations.
// A determination is a comment, and a comment is trivia to the AST, so it cannot
// move a site out of the bucket -- measured: writing one left this census
// byte-identical. `DETERMINED` is the register that lets the HEADING be true
// without touching the census: a registered site stays a MEMBER and stays in
// every count, and only the heading it prints under changes. Every row is
// cross-checked against the determination as it is written in the file, and a
// row that outlives its determination goes STALE, reddens both self-test modes
// and excuses nothing. Read `DETERMINED` for the whole rationale.
//
// ## Why it exists
//
// #12981, maintainer ruling of 2026-08-29 (verbatim 「同意」), adopting option A
// -- a repair-first worklist. Step one of that programme is, in the ruling's
// own words, "a mechanical census WITH positive controls enumerating the full
// membership". This is that census.
//
// ## The premise the census carries (#12981, recorded by the ruling)
//
//   > A green from `check-durability-degradation-log-level.mjs` over a
//   > swallow-shaped file means NOT MEASURED for that site, never
//   > "level approved."
//
// The gate matches callee NAMES from a 20-entry `DURABILITY_CRITICAL_CALLEES`
// vocabulary -- 18 until PR #15458 added the seeder wrappers `tryInsert` and
// `tryUpdate`. A seeder that reaches storage through `ql.insert(...)` is not in
// that vocabulary and never was, so the gate walks the file, finds no seam it
// understands, and scores it clean. #12923 measured the cost: the RBAC catalog
// seeders swallowed refused writes in `catch { return null; }`, and a boot
// logged "RBAC catalog seeded" at `info` over zero landed rows, on a deployed
// plane, for weeks -- under a green gate the whole time.
//
// ## Why a census may use a vocabulary the GATE may not
//
// The gate's header excludes `find`/`findOne`/`count` as "names too generic to
// declare repo-wide", and `insert`/`update`/`delete` sit in the same class:
// `.insert(` alone has ~144 non-test call sites. That exclusion is right FOR A
// GATE, because a gate BLOCKS -- a false positive there gets the gate disabled,
// and a disabled gate is worse than none because it also reports success.
//
// A census REPORTS. Its failure mode is the opposite one: a member it cannot
// see is a member nobody repairs. So it over-collects on purpose, labels every
// bucket, and prints what it dropped. Nothing here may ever be promoted into
// the gate's vocabulary by copying this list -- see "The handover" below.
//
// ## The predicate, stated so it can be argued with
//
// A `try`/`catch` is a MEMBER of the swallow family when all three hold:
//
//   1. SILENT CATCH -- no log call at ANY level is reachable from the catch
//      body, following same-file helpers transitively (the gate's own choice,
//      and for its reason: extracting a shared reporter must not defeat the
//      analysis). A catch that logs at `warn`/`info`/`debug` is NOT silent; it
//      is collected into the separate QUIET bucket below and never counted as a
//      member.
//   2. NO RETHROW -- some path leaves the catch normally, so the failure does
//      not propagate as an exception.
//   3. A WRITE IS REACHED IN THE `try` -- the guarded block reaches a call whose
//      callee name is in `WRITE_SHAPED_CALLEES` below, directly or through
//      same-file helpers, AND that call is AWAITED.
//
// Conjunct 3 is the whole durability filter, and it is what separates this
// census from the raw syntactic shape. The raw multiline shape
// `/catch\s*(\([^)]*\))?\s*\{\s*return null;\s*\}/` over non-test `packages/**`
// matches 52 files on this tree -- `formula/src/cel-engine.ts`,
// `spec/scripts/lib/zod-graph.ts`, `plugin-pinyin-search`, and other benign
// parse/lookup returns that have nothing to do with durability. The card's
// "15" is a DURABILITY-FILTERED subset of that population, and the filter was
// never written down. Conjunct 3 is that filter, written down.
//
// ## AWAITED, and why that narrowing carries its own weight
//
// `delete` is the sharpest example of the gate header's "too generic" warning,
// and it bites this census too: `temporalRewriteCache.delete(first)` in
// `formula/src/cel-engine.ts` is a Map eviction spelled exactly like a driver
// delete. Type information would separate them and a full Program is not worth
// its cost here, so the discriminator is STRUCTURAL: every driver and ObjectQL
// write in this repo is async and is awaited at its call site, and no
// `Map`/`Set`/`Array` mutation ever is. A write-shaped callee that is not
// awaited is DROPPED -- and the drop count is printed on every run, because a
// narrowing nobody can see is indistinguishable from a matcher that stopped
// matching.
//
// ## Same-file resolution is by SCOPE, not by spelling
//
// Conjunct 3 follows same-file helpers, so it has to answer "which body does
// this call reach?" -- and answering that by NAME alone is how a census invents
// a write. Two measured cases, and they are one defect at two depths:
//
//   - `db-job-adapter.ts :: cancel` resolved the DOTTED path `this.cron.cancel`
//     by its last segment and walked into the file's own `cancel()`. Answered by
//     `sameFileCallee`: only `foo(...)` and `this.foo(...)` may resolve at all.
//   - `action-execution.ts :: invokeBusinessAction` PASSES that test -- its
//     `callData(...)` is a bare identifier -- and still reached the wrong body.
//     The name is destructured from the function's own `wiring` parameter, and
//     the module-level `callData` a thousand lines up is a different function
//     (its first parameter is `deps`; the call site passes `'get'`). The census
//     reported a record READ as `write=insert@170`, in the exact class the
//     header above forbids: a write that is not in the guarded block.
//   - `engine.ts :: this.update(...)` PASSES BOTH of those -- a `this.foo` path
//     is exactly what `sameFileCallee` admits, and no local binding shadows it
//     -- and STILL reached the wrong body, because the third and last step was
//     a lookup in a flat file-wide index keyed by BARE NAME and filled
//     LAST-WINS. `engine.ts` declares `update`, `delete`, `find`, `findOne` on
//     `class ObjectQL` and again on `class ObjectRepository` thousands of lines
//     later, plus `transaction` on `ScopedContext`; every one of those calls
//     written inside `ObjectQL` was answered with the OTHER class's method. 26
//     reached call sites, on names that are in `WRITE_SHAPED_CALLEES`.
//
// So resolution is decided by SCOPE at both steps, and neither one is optional.
//
// A bare identifier is first resolved against the LEXICAL SCOPE CHAIN at the
// call site (`resolveSameFileBody`): the innermost binding of the name wins, and
// a binding that holds no function -- a parameter, a destructured member, a
// plain `const`/`let`, a catch variable, an import -- REFUSES the call rather
// than falling through to a same-named body elsewhere in the file. The refusal
// count is printed on every run, for the same reason the AWAITED drop count is.
//
// Whatever reaches the body index -- a `this.foo` path, or a bare name the chain
// did not bind -- is then resolved BY THE SCOPE THE BODY IS VISIBLE FROM
// (`indexFunctionBodies`), never by file order: a method is keyed by the class
// or object literal that owns it, a lexical form by its enclosing block. A name
// declared exactly ONCE still resolves from anywhere, so this narrowing touches
// only collisions; a name declared several times with none of them enclosing the
// call site is REFUSED, because file order is not evidence. Both departures are
// transferred from the sibling gate with their reasons -- see
// `indexFunctionBodies`.
//
// ⚠️ MEMBERSHIP CANNOT SEE ANY OF THIS. When the repair above landed, the census
// printed byte-identical output on both sides of it -- 56 members, 98 quiet, the
// same stats -- while 27 reached call sites changed which body they resolved to.
// A control that reads the output is green against the bug, which is what
// `RESOLUTION_CONTROLS` exists for: it reads the resolver and pins what resolved
// to what.
//
// This keys on SCOPE, which is what decides a bare identifier in JavaScript, and
// it deliberately does not compare signatures. Once the innermost binding IS the
// file-scope function, a disagreeing signature would mean the call does not
// type-check, so there is nothing left for a second key to catch; both disproofs
// recorded against `invokeBusinessAction` are answered by the first one. The
// narrowing can only REMOVE a resolution that JavaScript itself would not make,
// so it cannot hide a member: where the census still resolves, it resolves to
// the body the call actually reaches.
//
// ## What is NOT mechanical, and is not pretended to be
//
// The card's own phrasing of the family includes "...and the caller still
// reports success". That conjunct is INTER-PROCEDURAL and this census does not
// decide it. Deciding it needs the call graph of every caller of the enclosing
// function across package boundaries, and a judgement about whether the
// counter the caller increments is the one it later prints.
//
// What the census does instead is print the EVIDENCE for that judgement, per
// site, and leave the verdict to a person: the enclosing function's name, and
// whether the file carries a quiet-level summary log OUTSIDE any catch -- the
// "RBAC catalog seeded" line that makes a zero-row seed read as healthy. A site
// with `healthySummary: true` is where the card's shape is most likely
// complete. It is a POINTER, never a verdict, and it is not part of membership.
//
// Picking a regex that happens to return 15 would have been the other option.
// It would also have been a false green about false greens.
//
// ## The handover (the ruling's LAST step) -- LANDED in PR #15458
//
// The programme ended by adding the seeder-helper names (`tryInsert`/`tryUpdate`)
// to the gate's `DURABILITY_CRITICAL_CALLEES` **with zero reds**, which is what
// keeps `scripts/durability-degradation.baseline.json` at its designed empty
// steady state. PR #15458 performed that step and measured it: the gate's
// verdict line was unchanged, the baseline stayed empty, and THIS census's
// reading was byte-identical across it -- the vocabulary below is copied by
// VALUE, so the gate's map growing moved nothing here. #12981 then closed with
// PR #15472.
//
// Those two names are therefore labelled `gate-vocabulary` below (#15459): after
// that PR they ARE declared in the gate, and the census's OVERLAP reading has to
// say what the tree says. `tryDelete` is not in the gate and stays
// `seed-wrapper`. The copy stays a copy, and is now cross-checked against the
// gate's own declaration on every `--self-test` -- see `readGateVocabulary`.
//
// The prohibitions this step was held behind did NOT expire with it. Two of them
// were re-affirmed by the ruling that closed the programme (#12981 comment
// 5543738972, Q1 = A), and they are standing:
//
//   - ⛔ do NOT add an entry to `durability-degradation.baseline.json` (option B,
//     refused by the ruling: filling the empty ledger teaches every seat that
//     adding entries is routine, which destroys its value);
//   - ⛔ do NOT add `insert`/`update` to the gate vocabulary (option C, refused
//     by the gate's own design);
//   - ⛔ do NOT quiet a member by turning `catch { return null; }` into
//     `catch {}` or by swallowing deeper.
//
// ## Known narrownesses, stated up front rather than discovered later
//
//   1. A catch that reports through a receiver spelled anything other than
//      `logger`/`log`/`console` reads as SILENT here, exactly as it does to the
//      gate (#8897's `port.warn?.(...)`). That direction is safe for a census --
//      it over-collects -- but such a site will look like a member and is not.
//   2. Helper following is FILE-SCOPED. A catch whose reporter was extracted to
//      another module reads as silent. Same constraint the gate lives with.
//   3. Cross-file write resolution is by NAME only: `tryInsert`/`tryUpdate` are
//      declared in the vocabulary because they are the seeder wrappers this
//      family is made of, so a caller that imports them is seen. An arbitrary
//      imported wrapper around `ql.insert` is not.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { parseSourceFile } from './ts-parse.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SCAN_ROOT = join(ROOT, 'packages');

/** The sibling GATE, READ (never imported) so the copy below can be cross-checked. */
const GATE_SCRIPT = 'scripts/check-durability-degradation-log-level.mjs';
const GATE_VOCABULARY_IDENT = 'DURABILITY_CRITICAL_CALLEES';

/**
 * Callees whose failure means "the bytes did not land".
 *
 * `origin` records where each name comes from, so a reader can tell a name
 * anchored in a shipped interface from one anchored in a seeder convention:
 *
 *   - `driver-contract`  -- a write/DDL method of `IDataDriver`
 *                           (`packages/spec/src/contracts/data-driver.ts`).
 *   - `objectql`         -- the ObjectQL-level write surface the seeders use.
 *   - `seed-wrapper`     -- the `catch { return null; }` helpers this family IS
 *                           (`permission-set-projection.ts` and its per-file
 *                           copies) that the gate does NOT declare. `tryInsert`
 *                           and `tryUpdate` sat here until the ruling's last step
 *                           handed them over (PR #15458); they are
 *                           `gate-vocabulary` now, because that is what the tree
 *                           says. `tryDelete` was not part of that handover and
 *                           is still this census's alone.
 *   - `gate-vocabulary`  -- already declared in
 *                           `check-durability-degradation-log-level.mjs`.
 *                           Carried here so the census can report the OVERLAP:
 *                           how many members the gate can already see. Copied by
 *                           value on purpose -- importing the gate's map would
 *                           couple a non-gate instrument to a merge-blocking one.
 *                           A by-value copy's failure mode is SILENCE, so this
 *                           subset is cross-checked against the gate's own
 *                           declaration on every `--self-test` and reddens on
 *                           drift -- see `readGateVocabulary`. It announces;
 *                           it never absorbs.
 */
const WRITE_SHAPED_CALLEES = new Map([
  ['insert', 'objectql'],
  ['update', 'objectql'],
  ['upsert', 'objectql'],
  ['delete', 'objectql'],
  ['create', 'driver-contract'],
  ['bulkCreate', 'driver-contract'],
  ['bulkUpdate', 'driver-contract'],
  ['bulkDelete', 'driver-contract'],
  ['updateMany', 'driver-contract'],
  ['deleteMany', 'driver-contract'],
  ['dropTable', 'driver-contract'],
  ['tryDelete', 'seed-wrapper'],
  ['tryInsert', 'gate-vocabulary'],
  ['tryUpdate', 'gate-vocabulary'],
  ['syncSchema', 'gate-vocabulary'],
  ['syncSchemasBatch', 'gate-vocabulary'],
  ['syncRegisteredSchemas', 'gate-vocabulary'],
  ['initObjects', 'gate-vocabulary'],
  ['rearmSuspendedWaitTimers', 'gate-vocabulary'],
  ['writeDeferredReference', 'gate-vocabulary'],
  ['writeRecord', 'gate-vocabulary'],
  ['performSeedWrite', 'gate-vocabulary'],
  ['deliverPersistedRow', 'gate-vocabulary'],
  ['dropPromotedDraftRow', 'gate-vocabulary'],
  ['saveMetaItem', 'gate-vocabulary'],
  ['persistAuditTrailRow', 'gate-vocabulary'],
  ['persistReadAuditRows', 'gate-vocabulary'],
  ['persistAuthEventAuditRow', 'gate-vocabulary'],
  ['deleteMetaItemFromLoader', 'gate-vocabulary'],
  ['persistPackageCommitRow', 'gate-vocabulary'],
  ['persistSeedTenancyReceiptRow', 'gate-vocabulary'],
  ['runWideningAlters', 'gate-vocabulary'],
]);

/**
 * How a catch can already be answering, short of a log.
 *
 * `record` is declared here NOT as a repo-wide spelling ("a name-shaped guess
 * would let a genuinely swallowing catch buy its way out by calling something
 * that sounds like a reporter" -- the gate's own words) but as a RECEIVER-BOUND
 * shape: the receiver must be a name this file can tie back to
 * `createSeedWriteRefusals()`, either as a same-file initializer or as a
 * parameter declared `SeedWriteRefusals`. That is the #12923 channel, and it is
 * why the two seams #12970 repaired come back CHANNELLED rather than
 * OUTSTANDING on a re-run -- which is the property that makes this census a
 * worklist rather than a snapshot.
 */
const REFUSAL_ACCUMULATOR_TYPE = 'SeedWriteRefusals';
const REFUSAL_ACCUMULATOR_FACTORY = 'createSeedWriteRefusals';
const REFUSAL_RECORD_METHOD = 'record';

/** The gate's own propagation vocabulary (#5241) -- a catch reaching one answers its caller. */
const PROPAGATION_CALLEES = new Set(['errorFromThrown', 'handleRouteError']);

/**
 * The WEAKEST channel, and the one the gate's own #9748 limb already models: the
 * catch increments a counter declared outside the `try`, and the enclosing
 * function reads that counter back — into a log line, or into what it returns.
 *
 * Weakest because only the COUNT survives; the driver code, the message and the
 * identity of the refused row do not. It is still categorically different from
 * darkness: `catch { refused++; }` beside `if (refused > 0) logger.warn(...)`
 * cannot produce the failure this card is about, where a pass that landed
 * nothing prints the same bytes as a pass with nothing to do.
 *
 * Both halves are checked, and the second is why this is not a spelling
 * heuristic: an accumulator nothing ever reads is darkness with an extra
 * variable, and is reported as dark.
 */
const ACCUMULATOR_CHANNEL = 'accumulator-reported';

const LOGGER_RECEIVERS = /^(logger|log|console)$/i;
const LOG_LEVELS = new Set(['error', 'fatal', 'warn', 'info', 'debug', 'trace', 'log']);
const LOUD_LEVELS = new Set(['error', 'fatal']);
const SKIP_DIRS = new Set(['node_modules', 'dist', 'build', '.git', '.turbo', 'coverage', '.cache']);
const MAX_HELPER_DEPTH = 4;

/* ------------------------------------------------------------------------- *
 *  Declared controls -- asserted by `--self-test`, never derived from a run
 * ------------------------------------------------------------------------- */

/**
 * POSITIVE controls: files that MUST yield at least one member.
 *
 * Chosen by reading the code, before the instrument was first run -- a control
 * read off the output would only prove the instrument agrees with itself.
 */
const POSITIVE_CONTROLS = [
  {
    file: 'packages/plugins/plugin-security/src/permission-set-projection.ts',
    why:
      'The SHARED `tryInsert`/`tryUpdate` #12923 repaired. `catch (e) { refusals?.record(object, e); return null; }` '
      + '-- silent by the log axis, a write in the try, and answering through the #12923 accumulator. It must be a '
      + 'member AND it must come back CHANNELLED, or the instrument cannot tell a repair from a swallow.',
    tier: 'channelled',
  },
  {
    file: 'packages/plugins/plugin-sharing/src/primary-bu-projection.ts',
    why:
      '`backfillPrimaryBu`\'s per-row `catch { refused++; }`, read back by the report branch below it '
      + '(#12981). It pins the WEAKEST channel — the one where only the count survives — because that '
      + 'is the one a repair reaches when the loud-report contract belongs to another card. Without '
      + 'it, a caller-side repair is invisible to this instrument and the census stops working as a '
      + 'progress measure, which is the property the ruling asked for.',
    tier: 'channelled',
    channel: 'accumulator-reported',
  },
  {
    file: 'packages/services/service-automation/src/builtin/crud-nodes.ts',
    why:
      'Three `catch (err) { return { success: false, error: `...${err.message}` }; }` around a CRUD node\'s write. '
      + 'Silent by the log axis and a write in the try, so it IS a member — but the caught error is the answer, '
      + 'which is the gate\'s own third legal ending. It pins the tier-2 boundary: an instrument that folded these '
      + 'into the dark count would hand a worklist 26 sites of already-answered code.',
    tier: 'carries-error',
  },
  {
    file: 'packages/verify/src/harness.ts',
    why:
      '`inviteForAudienceGate`\'s invitation row: `try { await engine.insert(\'sys_invitation\', ...) } '
      + 'catch { /* Best-effort -- the gate answers either way. */ }`. Silent by the log axis, an awaited '
      + 'write in the try, and nothing bound -- the dark shape exactly.\n\n'
      + 'CHOSEN FOR ITS STABILITY, which is the property a dark control needs and the previous two '
      + 'lacked. This control first named `bootstrap-system-capabilities.ts`, whose `why` read "the '
      + 'card\'s shape, verbatim, still standing" -- and #12981 batch 2 repaired it, which turned this '
      + 'self-test red for doing exactly what the ruling asked. It then named `share-link-service.ts`\'s '
      + 'usage stamp on the strength of batch 1\'s reading that a `use_count` / `last_used_at` stamp is '
      + 'telemetry -- and batch 8 REVERSED that reading (the persistence claim is made by the field '
      + 'declarations and the shipped `active_links` grid, not by the resolve response), so batch 9 '
      + 'repaired it and this self-test went red again. ANY tier-1 DARK member of the worklist is a '
      + 'control the repair programme is designed to destroy, so repointing at another one only moves '
      + 'the breakage to the batch that repairs THAT file. This member is different: batch 8 judged it '
      + 'OUT of the programme on the merits and wrote the determination into the file itself (the '
      + 'comment inside this very catch): nothing claims to have persisted -- the helper answers `void` '
      + 'and its only caller is the `signUp` that POSTs the sign-up on the very next line -- and the '
      + 'loss is answered one line later, LOUDLY: under the default `invite_only` posture a missing '
      + 'invitation makes that POST refuse and `signUp` throws with the audience gate\'s own status and '
      + 'body. So it is a genuine dark member with a recorded reason to stay one. ⛔ If a later card '
      + 'ever does repair it, repoint this control at another member ruled OUT rather than at a member '
      + 'merely not repaired YET.',
    tier: 'dark',
  },
];

/**
 * NEGATIVE controls: files that MUST yield ZERO members.
 *
 * Every one of them matches the RAW syntactic shape the card's number came
 * from, so they are the population the durability filter has to remove. A
 * membership number with no negative control is the same false green this whole
 * card is about.
 */
const NEGATIVE_CONTROLS = [
  {
    file: 'packages/formula/src/cel-engine.ts',
    why:
      'Matches the raw `catch { return null; }` shape and is a CEL parse/compile swallow -- nothing persists. It '
      + 'also carries `temporalRewriteCache.delete(first)`, a Map eviction spelled exactly like a driver delete, '
      + 'which is what the AWAITED discriminator exists to remove.',
  },
  {
    file: 'packages/plugins/plugin-pinyin-search/src/pinyin-search-plugin.ts',
    why: 'Matches the raw shape; its catches guard transliteration lookups and it reaches no write callee at all.',
  },
  {
    file: 'packages/spec/scripts/lib/zod-graph.ts',
    why: 'Matches the raw shape; a build-time Zod graph walk with no storage seam anywhere in the file.',
  },
];

/**
 * REGRESSION controls: a (file, function) that must never come back as a member.
 *
 * A negative control is a whole FILE with nothing to find. These are the other
 * direction: a file that legitimately holds members, plus one site in it that a
 * measured over-collection once invented. Pinning the site rather than the file
 * keeps the control alive while the file keeps changing around it.
 */
const REGRESSION_CONTROLS = [
  {
    file: 'packages/services/service-job/src/db-job-adapter.ts',
    enclosing: 'cancel',
    why:
      'Its try block is `await this.cron.cancel(name)` — the CronJobAdapter\'s method. Resolving a dotted callee '
      + 'to a same-file body by its LAST segment walked into this file\'s own `cancel()`, reached `setActive()`\'s '
      + '`engine.update(...)` two frames on, and reported a cron-registry cleanup as a swallowed durability write. '
      + 'See `sameFileCallee`.',
  },
  {
    file: 'packages/runtime/src/action-execution.ts',
    enclosing: 'invokeBusinessAction',
    why:
      'Its try block is `await callData(\'get\', { object, id }, driver, envId, ec)` -- a READ, through the wiring '
      + 'callback this function destructures from its own `wiring` parameter (`const { driver, envId, ec, getMeta, '
      + 'callData } = wiring;`). Resolving that BARE identifier against the whole-file body index walked into the '
      + 'MODULE-LEVEL `callData` a thousand lines up, reached the `await ql.insert(...)` inside its `if (action === '
      + '\'create\')` branch, and reported the record load as `write=insert@170`. Two disproofs, either alone fatal: '
      + 'the identifier is a local binding, and the signatures disagree (the module-level function takes `deps` '
      + 'first; the call site passes `\'get\'`). The dotted-path rule above does NOT catch this one -- `callData(...)` '
      + 'is exactly the bare shape that rule permits -- which is why `resolveSameFileBody` decides bare identifiers '
      + 'by scope. See `resolveSameFileBody`.',
  },
];

/**
 * RESOLUTION controls: a (call site -> body) pair that must not move.
 *
 * The other three families all read MEMBERSHIP, and membership cannot see this
 * defect. Measured, on the tree the scope-aware index landed against: the flat
 * last-wins index misresolved 27 reached call sites, and the census printed
 * byte-identical output before and after the repair — 56 members, 98 quiet, the
 * same stats. A control that reads the census output is therefore GREEN against
 * the exact bug it would exist to catch, which is why these read the resolver
 * directly and pin WHAT RESOLVED TO WHAT.
 *
 * Each control names a call site by `(file, callee)` plus `fromClass` and/or
 * `enclosing`, and declares `resolvesIn`: the class that owns the body the call
 * must reach, the named function the body must be declared inside, or `null`
 * for "must refuse". Two properties are asserted, and the second is the one
 * that keeps this family honest:
 *
 *   1. every matching call site resolves as declared;
 *   2. at least ONE call site matches. A control whose site has been renamed
 *      away stops matching, and a control that matches nothing would otherwise
 *      pass VACUOUSLY — green because it asked nothing.
 *
 * Both directions are represented on purpose, because the mechanism has no safe
 * direction: a control set that only pinned refusals would be satisfied by a
 * resolver that refuses everything.
 */
const RESOLUTION_CONTROLS = [
  {
    file: 'packages/objectql/src/engine.ts',
    callee: 'update',
    fromClass: 'ObjectQL',
    resolvesIn: 'ObjectQL',
    why:
      'INVENTED direction, and the live instance this repair was measured on. `engine.ts` declares '
      + '`update()` on `class ObjectQL` (line ~9913) and again on `class ObjectRepository` (~13397), '
      + 'some 3,500 lines later. The flat last-wins index answered EVERY `this.update(...)` written '
      + 'inside `ObjectQL` with `ObjectRepository`\'s method — chosen for no reason but being last in '
      + 'the file — and `update` is in `WRITE_SHAPED_CALLEES`, so the hop feeds conjunct 3 directly. '
      + 'It cost nothing on that tree: both bodies bottom out in driver writes, so the census was '
      + 'accidentally right. Accidentally right is not an invariant, and membership cannot tell the '
      + 'two apart — which is the whole reason this family reads the resolver instead of the output.',
  },
  {
    file: 'packages/objectql/src/engine.ts',
    callee: 'delete',
    fromClass: 'ObjectQL',
    resolvesIn: 'ObjectQL',
    why:
      'The same collision on the sharpest name in the vocabulary. `delete` is the callee the AWAITED '
      + 'discriminator exists to police, and `ObjectRepository.delete` is a different method from '
      + '`ObjectQL.delete`; resolving one into the other is exactly the "invents a write" failure the '
      + '`sameFileCallee` rule was written for, arriving one layer further in.',
  },
  {
    file: 'packages/objectql/src/engine.ts',
    callee: 'transaction',
    fromClass: 'ObjectQL',
    resolvesIn: 'ObjectQL',
    why:
      'Third class in the same file: `ScopedContext` (line ~13469) also declares `transaction()`, and '
      + 'it is the LAST one, so the flat index handed `ObjectQL`\'s own `this.transaction(...)` to a '
      + 'class it has no relationship with. Pinned separately from `update`/`delete` because it proves '
      + 'the key is the OWNING CLASS and not "the second declaration".',
  },
  {
    file: 'packages/runtime/src/app-plugin.ts',
    callee: 'push',
    enclosing: 'resolveMappedObjects',
    resolvesIn: null,
    why:
      'REFUSAL direction — departure TWO, ambiguous and out of scope. The call is '
      + '`(out[mapped] ??= []).push(name)`: an Array method, which `calleePath` reduces to the bare '
      + 'name `push`. The file also declares two unrelated `const push = (arr) => {…}` helpers, local '
      + 'to `collectBundleHooks` and `collectBundleActions`, and neither encloses this call. The flat '
      + 'index answered with the later of the two and the census walked into a bundle-collection '
      + 'helper from an array append. File order is not evidence: with several bodies and none in '
      + 'scope, the hop is declined.',
  },
  {
    file: 'packages/runtime/src/app-plugin.ts',
    callee: 'push',
    enclosing: 'collectBundleActions',
    resolvesIn: 'collectBundleActions',
    why:
      'DROPPED direction, on the SAME collision as the control above — which is why the pair is worth '
      + 'more than either half: one name, one file, one collision, REFUSED from outside and RESOLVED '
      + 'from inside. `collectBundleActions` calls its OWN `const push`, and that hop must survive a '
      + 'repair aimed at the refusal case.\n\n'
      + '⚠️ Its sensitivity is MEASURED, not assumed, and it is narrower than it looks. This site is '
      + 'answered by `resolveSameFileBody`\'s LEXICAL WALK, which binds the local `push` before the '
      + 'body index is ever consulted — so ablating the index (last-wins, or refusing every ambiguous '
      + 'name) leaves this control GREEN, and ablating the lexical walk turns it RED. What it pins is '
      + 'that the #13459 bare-identifier rule still answers an in-scope binding, which is exactly the '
      + 'half this change reaches past when it replaces what that walk falls back TO.',
  },
  {
    file: 'packages/plugins/plugin-email/src/email-plugin.ts',
    callee: 'update',
    enclosing: 'upsertTemplate',
    resolvesIn: 'EmailServicePlugin',
    why:
      'Departure ONE — one declaration, unchanged — and this site was CHOSEN BY MEASUREMENT, after an '
      + 'ablation showed the two controls above stay green when that departure is removed. Exactly 7 '
      + 'call sites in the scan root depend on it; this is one of the four whose callee is in '
      + '`WRITE_SHAPED_CALLEES`. `update` has a single body in this file, declared as a method of an '
      + 'object literal, so the object literal is its scope and is NOT on this call site\'s ancestor '
      + 'chain — a strict lexical resolver DECLINES the hop. This control does not claim the hop is '
      + 'semantically right (the call is `(engine as any).update(...)`, whose receiver `calleePath` '
      + 'erases). It pins the INVARIANT that this repair touches only COLLISIONS: tighten past that '
      + 'and this goes red, forcing the census delta to be re-measured instead of narrowed in silence.',
  },
];

/**
 * What the tier-1 worklist PRINTS, pinned against a declared population.
 *
 * ## Why a fixture, in an instrument that measures
 *
 * The worklist body has three readings and this tree can only reach one of
 * them: it prints a row per file with an outstanding DARK member, and there is
 * one outstanding member here (`auth-manager.ts::verifyMcpAccessToken`) beside
 * three DETERMINED rows. So neither `(none …)` line has ever been printed by a
 * run of this instrument, and an unreachable reading is a reading nobody
 * proofreads.
 *
 * That is measured, not feared. The empty-worklist line said the ruling's gate
 * handover step "is unblocked" — and went on saying it after PR #15458
 * performed that step and PR #15472 closed #12981, and through the sweep that
 * repaired the four stale statements around it (#15459, #15473, PR #15502),
 * because a string no run can print is a string no run can contradict (#15503).
 *
 * ## What is asserted, and what is deliberately not
 *
 * `worklistLines` is handed a population this tree does not have, and what it
 * returns is pinned BY VALUE below. The pin is a SECOND, INDEPENDENT spelling
 * of each line on purpose: a control that compared the producer against a
 * shared constant would pass whatever that constant said, which is the vacuous
 * shape the rest of this file argues against.
 *
 * ⛔ No row here is a claim about the tree. Membership is measured from
 * `packages/**` and is decided before this family is consulted; the only thing
 * asserted is what the report SAYS about a population it is handed. The
 * census's own reading is byte-identical across the change that added this
 * family.
 *
 * The third row is the family's NEGATIVE leg and is not optional: without a
 * population that must NOT print either `(none …)` line, the two pins above
 * would stay green against a producer that had stopped consulting its
 * population at all. It pins the row format and the by-file sort with the same
 * stroke.
 *
 * Asserted in BOTH self-test modes, by the test `SELF_TEST_MODES` states: can a
 * successful repair destroy it? No — the empty worklist it pins is the state
 * the repair programme is trying to reach, so the day this family matters most
 * is the day the programme succeeds.
 */
const WORKLIST_READING_CONTROLS = [
  {
    when: 'no outstanding member and no DETERMINED row — the programme has finished',
    outstanding: [],
    determined: [],
    expect: [
      '    (none — the family is repaired; the gate handover step landed in PR #15458, and #12981 closed with PR #15472)',
    ],
    why:
      'The reading this family was added for (#15503). It must state the handover as LANDED: PR #15458 '
      + 'declared `tryInsert`/`tryUpdate` in the gate\'s `DURABILITY_CRITICAL_CALLEES` and PR #15472 closed '
      + '#12981. A future tense here would announce a step that already happened, on the one day this '
      + 'instrument is finally read for its verdict rather than its worklist.',
  },
  {
    when: 'no outstanding member, but the register still holds rows',
    outstanding: [],
    determined: [{ file: 'packages/fixture/src/register-only.ts' }],
    expect: [
      '    (none outstanding — every DARK member is DETERMINED below, and every one is still a member)',
    ],
    why:
      'The other unreachable reading. It has to keep saying that a DETERMINED site is STILL A MEMBER — '
      + 'the whole point of the #13886 register is that it partitions the printed worklist and moves no '
      + 'count, and this is the one line a reader meets that claim in.',
  },
  {
    when: 'two outstanding members in two files — the shape this tree actually prints',
    outstanding: [
      { file: 'packages/fixture/src/beta.ts' },
      { file: 'packages/fixture/src/alpha.ts' },
      { file: 'packages/fixture/src/alpha.ts' },
    ],
    determined: [],
    expect: [
      '    2×  packages/fixture/src/alpha.ts',
      '    1×  packages/fixture/src/beta.ts',
    ],
    why:
      'The NEGATIVE leg: a population with work in it must print the work and NEITHER `(none …)` line. '
      + 'Without it the two pins above would also pass for a producer that ignored its population and '
      + 'printed the empty reading unconditionally. It pins the count column and the by-file sort too.',
  },
];

/**
 * The DETERMINED register (#13886) — DARK sites whose determination is settled.
 *
 * ## The defect it repairs, and the one thing it must NOT do
 *
 * The tier-1 bucket prints under "the repair worklist". Membership is decided on
 * three mechanical conjuncts and a comment is trivia to the AST, so a site the
 * programme has already RULED ON stays in that bucket forever: measured, writing
 * the batch-8 determination into `harness.ts` left this census byte-identical.
 * Four of the five rows in that bucket were settled determinations and one was
 * an outstanding repair; two rounds were spent re-deriving rows that had already
 * been read. "5 site(s) — the repair worklist" is a true statement about
 * membership and a false one about work.
 *
 * ⛔ The repair is NOT to move a site out of the bucket. Over-collection is the
 * census's whole design: a member it cannot see is a member nobody repairs. A
 * registered site stays a MEMBER, stays counted in every total, and stays at
 * tier `dark`. This register changes exactly one thing — which HEADING the row
 * is printed under — so that the heading's claim becomes true. Membership counts
 * are computed before this register is consulted and cannot be moved by it; that
 * is asserted rather than asserted-about (`register + positive control coexist`
 * in `selfTest`).
 *
 * ## Keyed `file::function`, never by line
 *
 * The same granularity and the same reason as the sibling gate's
 * `FAILURE_PROPAGATION_SITES` (`check-durability-degradation-log-level.mjs`):
 * line numbers churn on every unrelated edit, and a whole-FILE key would licence
 * every future catch that lands anywhere in a nine-thousand-line file. That
 * script is read here as precedent and never imported — coupling a non-gate
 * instrument to a merge-blocking one is the same mistake `WRITE_SHAPED_CALLEES`
 * declines by copying the gate vocabulary by value.
 *
 * ## Every row is CROSS-CHECKED, because otherwise this is a new lie carrier
 *
 * A row that outlives its determination would print "settled" over a site nobody
 * has read in a year — the same defect one layer up, and worse, because it would
 * carry the programme's own authority. So a row is honoured only while all three
 * hold, and a row that fails any of them goes STALE: it is reported loudly, it
 * reddens the self-test in BOTH modes, and — the part that matters — it does NOT
 * excuse its site, which goes back onto the printed worklist.
 *
 *   1. the file still exists;
 *   2. the determination is still WRITTEN DOWN, at the declared `scope` (below);
 *   3. the `file::function` still resolves to a tier-1 DARK member. A determined
 *      site that stopped being a member is stale too — the determination was
 *      about a site that is no longer there, whether it was repaired, renamed or
 *      re-tiered.
 *
 * ## `scope`, and why a file-wide anchor is not the default
 *
 *   `site` — the anchor text must appear inside the ENCLOSING FUNCTION's own
 *            source. The right default: the determination is written where the
 *            next reader of the catch will find it.
 *   `file` — anywhere in the file. For the case where the determination is
 *            genuinely recorded at the CALLER, in the same file. It costs
 *            something real (a file-wide anchor survives an edit that forgets
 *            the site) and is why each `file`-scoped row states its reason.
 *
 * ⛔ The anchor is a distinctive SENTENCE from the determination itself, not a
 * bare `[#12981]` marker. A bare marker in a large file is kept alive by every
 * unrelated repair that mentions the programme, so the cross-check would pass
 * for a determination that had been deleted entirely — a green that certifies
 * nothing. Matching is whitespace-normalised and comment-prefix-stripped, so
 * re-wrapping a comment is safe and REWORDING it is not: a reworded
 * determination is one a person should re-read.
 *
 * ⛔ A DARK site with no determination written down anywhere gets no row. It
 * stays on the printed worklist, which is the honest answer:
 * `auth-manager.ts::verifyMcpAccessToken` is one today — the census reaches its
 * `update` through a same-file helper hop and batch 6 read it as a FALSE MEMBER,
 * but that reading lives in a report, not in the file, so there is nothing here
 * to cross-check against.
 */
const DETERMINED = new Map([
  [
    'packages/plugins/plugin-auth/src/ensure-default-organization.ts::tryInsert',
    {
      verdict: 'the fence is lifted — the CALLER reports the refused insert at `error`',
      ref: 'PR #13685',
      anchor: '`warn` was wrong here, and #12981 is why.',
      scope: 'file',
      why:
        '`tryInsert` is the shared `catch { return null; }` helper, so the site itself is dark by '
        + 'construction and stays that way. What was repaired is its caller: `ensureDefaultOrganization` '
        + 'now answers a null insert with `logDurabilityFailure`, naming the consequence and the remedy. '
        + 'The determination is therefore recorded AT THE CALLER, in this same file, which is why this '
        + 'row is `file`-scoped: the anchor sentence is the caller\'s own note, and it is distinctive '
        + 'enough that deleting the loud report deletes the anchor with it.',
    },
  ],
  [
    'packages/runtime/src/domains/keys.ts::handleKeysRequest',
    {
      verdict: 'silent BY DESIGN — every path out of the catch hands the caller a 500 envelope',
      ref: '#12981, in-file determination',
      anchor: '[#12981] This catch is silent BY DESIGN and it is NOT a durability swallow.',
      scope: 'site',
      why:
        'The standing proof this card was filed over: the catch has carried its determination for '
        + 'several rounds and was listed under "the repair worklist" on every run, so batch 7 had to '
        + 'open the file to discover it was already settled. Nothing claims to have persisted and the '
        + 'request does not look normal from the outside — AGENTS.md\'s third legal ending. Its '
        + 'delivery is pinned in `http-dispatcher.keys.test.ts`. ⛔ This site is waiting for '
        + 'nothing: the #12981 ruling (comment 5543738972, Q1 = A) settled that no gate declaration is '
        + 'owed here, ever. The widening that landed (PR #15458) added `tryInsert`/`tryUpdate`, and '
        + 'neither matches a seam in this function; the only name that would is bare `insert`, which '
        + 'this census refuses by design. An entry keyed here would be STALE on arrival, so THIS ROW '
        + 'is the record -- which is what the ruling relies on. PR #15472 rewrote the in-file note to '
        + 'say so and kept the anchor sentence byte-identical.',
    },
  ],
  [
    'packages/verify/src/harness.ts::inviteForAudienceGate',
    {
      verdict: 'NOT a claim-to-persist — the helper answers `void` and the loss is refused one line later',
      ref: '#12981 batch 8, in-file determination',
      anchor: '[#12981] This catch is silent BY DESIGN and it is NOT a durability swallow.',
      scope: 'site',
      why:
        'Batch 8 read this site on the merits and wrote the reading into the catch. It is the '
        + 'measurement that produced this card: writing that annotation left the census byte-identical, '
        + 'which is the proof that an annotation cannot move a site out of the bucket. ⚠️ This file is '
        + 'also where the tier-1 DARK positive control is headed; the two do not compete — the control '
        + 'asserts the file yields a member at tier `dark`, and this row asserts the same site IS still '
        + 'such a member before it excuses anything.',
    },
  ],
]);

/** `<file>::<enclosing function>` — the register key of a census finding. */
function determinedKey(finding) {
  return `${finding.file}::${finding.enclosing}`;
}

/**
 * Comment prose with its markers and line breaks removed.
 *
 * The anchor is a sentence a human wrote inside a `//` block, so it arrives
 * wrapped across lines behind comment prefixes. Normalising both sides lets a
 * re-wrap pass and a rewrite fail, which is the sensitivity this cross-check
 * wants.
 */
function normalizeProse(text) {
  return text
    .replace(/^[ \t]*(\/\/+|\/\*+|\*+\/|\*)/gm, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The name a function-like declaration is known by, as `enclosingFunctionName` reads it. */
function declaredFunctionName(node) {
  if (ts.isFunctionDeclaration(node) && node.name) return node.name.text;
  if (ts.isMethodDeclaration(node) && node.name && ts.isIdentifier(node.name)) return node.name.text;
  if ((ts.isArrowFunction(node) || ts.isFunctionExpression(node))
    && ts.isVariableDeclaration(node.parent) && ts.isIdentifier(node.parent.name)) {
    return node.parent.name.text;
  }
  return null;
}

/** Concatenated source of every function in `sf` declared under `name`; '' when there is none. */
function functionSourceByName(sf, name) {
  const parts = [];
  walkAll(sf, (node) => {
    if (!ts.isFunctionDeclaration(node) && !ts.isMethodDeclaration(node)
      && !ts.isArrowFunction(node) && !ts.isFunctionExpression(node)) return;
    if (declaredFunctionName(node) === name) parts.push(node.getText(sf));
  });
  return parts.join('\n');
}

/**
 * Judge every register row against the tree and the census.
 *
 * Pure in its inputs so the self-test can run it against synthetic registers —
 * a control that had to mutate the working tree to prove the STALE leg fires
 * would be a control nobody runs.
 *
 * @param register The `DETERMINED` map (or a synthetic one).
 * @param dark The tier-1 DARK members of a census run.
 * @returns `{ excused, stale }` — `excused` is the set of keys whose site the
 *          printed worklist may hand to the register; `stale` the rows that
 *          failed, each with the `kind` of failure. A stale row excuses NOTHING.
 */
function evaluateDetermined(register, dark) {
  const darkKeys = new Set(dark.map(determinedKey));
  const excused = new Set();
  const stale = [];
  for (const [key, row] of register) {
    const [file, fn] = [key.slice(0, key.lastIndexOf('::')), key.slice(key.lastIndexOf('::') + 2)];
    const abs = join(ROOT, file);
    let source;
    try {
      source = readFileSync(abs, 'utf8');
    } catch {
      stale.push({ key, row, kind: 'file-gone', detail: `${file} no longer exists.` });
      continue;
    }
    let haystack;
    if (row.scope === 'site') {
      const sf = parseSourceFile(abs, source, scriptKindFor(abs));
      haystack = functionSourceByName(sf, fn);
      if (haystack === '') {
        stale.push({
          key,
          row,
          kind: 'function-gone',
          detail: `${file} declares no function \`${fn}\` — the key names a site this file no longer has.`,
        });
        continue;
      }
    } else {
      haystack = source;
    }
    if (!normalizeProse(haystack).includes(normalizeProse(row.anchor))) {
      stale.push({
        key,
        row,
        kind: 'anchor-gone',
        detail: `the determination is no longer written ${row.scope === 'site' ? `in \`${fn}\`` : `in ${file}`}: `
          + `the anchor sentence "${row.anchor}" is not there.`,
      });
      continue;
    }
    if (!darkKeys.has(key)) {
      stale.push({
        key,
        row,
        kind: 'not-a-member',
        detail: 'the census no longer reports this site as a tier-1 DARK member, so the determination '
          + 'is about a site that is not in the bucket any more.',
      });
      continue;
    }
    excused.add(key);
  }
  return { excused, stale };
}

/** The author-facing block a STALE row prints, shared by the census and the self-test. */
function staleLines(stale) {
  const lines = [
    `  ✗ ${stale.length} STALE row(s) in the DETERMINED register — each one still counts as OUTSTANDING above,`,
    '    because a determination that is no longer recorded excuses nothing:',
  ];
  for (const s of stale) {
    lines.push(`    ${s.key}  [${s.kind}]`);
    lines.push(`      ${s.detail}`);
    lines.push(`      it was registered because: ${s.row.why}`);
  }
  lines.push('    If the function was RENAMED, re-key the row. If the determination was reversed or the site');
  lines.push('    repaired, delete the row — it is a reading of a site, and there is no site to read.');
  return lines;
}

/**
 * Which control families a `--self-test` run asserts (#13919).
 *
 * ## Why there is a subset at all
 *
 * All four families were green only while somebody remembered to run them by
 * hand: measured on `origin/main`, nothing in `package.json` or `.github/**`
 * named this script. The same resolver was then repaired three times (#13459,
 * #13474, PR #13915) with no gate holding any of the previous repairs, and the
 * census's numbers feed #12981's repair worklist, so a wrong denominator
 * propagates into that programme unwatched.
 *
 * ## Why the subset is not simply "all of them"
 *
 * Wiring `all` into CI would redden the farm WHEN THE REPAIR PROGRAMME
 * SUCCEEDS. `POSITIVE_CONTROLS` pins members, and its tier-1 DARK entry pins a
 * member of the #12981 worklist -- precisely what that programme exists to
 * remove. That is not a forecast: the `dark` control's own `why` above records
 * it already happening once, when batch 2 repaired the file the control then
 * named and turned this self-test red for doing exactly what the ruling asked.
 * Repointing at another dark member only moves the breakage to the batch that
 * repairs THAT file. ⛔ A gate that reddens on success is not a gate, and worse,
 * it teaches the fleet to route around gates.
 *
 * So `gated` is the families the repair programme CANNOT destroy — three at
 * #13919, joined by the `DETERMINED` register at #13886 (last section) — and the
 * exclusion is PERMANENT rather than pending (#13919 ruling of 2026-09-01,
 * boundary 1): repairs move a member from tier `dark` to tier `channelled` and
 * it stays a member, so neither the negative controls, the regression controls,
 * the resolution controls, nor the zero-member floor can be destroyed by a
 * successful repair.
 *
 * ⛔ `gated` is NOT a lighter self-test to reach for by default. Anything that
 * asserts membership at a declared TIER lives in `all`, and `all` is what a
 * human or an agent touching this instrument runs.
 *
 * ⛔ This subset was also not, and must never be used as, a route to the
 * ruling's handover step (`tryInsert`/`tryUpdate` into the real gate's
 * `DURABILITY_CRITICAL_CALLEES`). That step landed on its own terms in PR
 * #15458 -- see "The handover" above.
 *
 * ## The FIFTH family (#13886) is in BOTH modes, and that is the point
 *
 * The `DETERMINED` register's cross-check is asserted in `gated` as well as
 * `all`, for the reason #13919 exists at all: a control nobody runs is a control
 * that is not there. A register whose STALE leg only fired in a mode the farm
 * never invokes would be exactly the "new lie carrier" the #13886 ruling
 * forbids -- a row printing "settled" over a determination that had been
 * deleted, under a green farm.
 *
 * It belongs in `gated` on the merits too, and the test is the one this comment
 * already applies: CAN A SUCCESSFUL REPAIR DESTROY IT? No. A register row names
 * a site the programme ruled OUT of repair, so the worklist emptying does not
 * touch one. A row does go STALE if someone repairs its site anyway -- and that
 * red is the sibling gate's own stale-entry discipline
 * (`FAILURE_PROPAGATION_SITES`), demanding a one-line deletion that lands with
 * the repair. That is categorically unlike `POSITIVE_CONTROLS`, where the
 * cheapest way to green is to WEAKEN the control.
 *
 * ## The COPIED gate vocabulary (#15459) is in both modes, for the same reason
 *
 * `WRITE_SHAPED_CALLEES` carries the gate's vocabulary BY VALUE, and the
 * `--self-test` compares that copy against the gate's own declaration
 * (`readGateVocabulary`). It passes the same test: a successful repair cannot
 * destroy it, because it compares two DECLARATIONS and never touches membership.
 * It is in `gated` because drift is exactly the failure a farm has to catch --
 * PR #15458 grew the gate's map from 18 names to 20 and this file went stale in
 * four places the same afternoon (#15459, #15473), under a green farm the whole
 * time, which is the cost of an uncross-checked copy stated as a measurement.
 */
const SELF_TEST_MODES = new Set(['all', 'gated']);

/** The banner the instrument prints on every run that is not a bare `--file`/`--json` dump. */
const MEASUREMENT_BANNER = 'durability swallow-family census (#12981) — a MEASUREMENT, not a gate';

/**
 * Read the self-test mode out of argv.
 *
 * @returns `null` (not a self-test run), a member of `SELF_TEST_MODES`, or
 *          `{ unknown }` -- REFUSED rather than silently falling through to the
 *          census, because a typo'd mode reaching `report()` would exit 0 and
 *          read in a CI log exactly like a self-test that passed.
 */
function selfTestMode(argv) {
  for (const arg of argv) {
    if (arg === '--self-test') return 'all';
    if (arg.startsWith('--self-test=')) {
      const mode = arg.slice('--self-test='.length);
      return SELF_TEST_MODES.has(mode) ? mode : { unknown: mode };
    }
  }
  return null;
}

/* ------------------------------------------------------------------------- *
 *  AST helpers
 * ------------------------------------------------------------------------- */

function collectSourceFiles(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      collectSourceFiles(full, out);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!/\.(ts|mts|cts|tsx)$/.test(entry.name)) continue;
    if (/\.(test|spec)\.(ts|mts|cts|tsx)$/.test(entry.name)) continue;
    if (/\.d\.(ts|mts|cts)$/.test(entry.name)) continue;
    out.push(full);
  }
  return out;
}

function scriptKindFor(file) {
  return file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
}

function walkAll(node, visit) {
  visit(node);
  node.forEachChild((child) => walkAll(child, visit));
}

/** The dotted text of a call's callee, `a.b?.c` -> ['a','b','c']; null when unreadable. */
function calleePath(expr) {
  const segments = [];
  let cursor = expr;
  for (;;) {
    if (ts.isParenthesizedExpression(cursor) || ts.isNonNullExpression(cursor)) {
      cursor = cursor.expression;
      continue;
    }
    if (ts.isPropertyAccessExpression(cursor)) {
      segments.unshift(cursor.name.text);
      cursor = cursor.expression;
      continue;
    }
    if (ts.isCallExpression(cursor)) {
      // `getLogger().error(...)` -- the receiver is a call; stop, keep what we have.
      segments.unshift('()');
      break;
    }
    if (ts.isIdentifier(cursor)) {
      segments.unshift(cursor.text);
      break;
    }
    if (cursor.kind === ts.SyntaxKind.ThisKeyword) {
      segments.unshift('this');
      break;
    }
    return segments.length > 0 ? segments : null;
  }
  return segments;
}

function isLogCall(node) {
  if (!ts.isCallExpression(node)) return null;
  const path = calleePath(node.expression);
  if (!path || path.length < 2) return null;
  const level = path[path.length - 1];
  if (!LOG_LEVELS.has(level)) return null;
  const hasReceiver = path.slice(0, -1).some((seg) => LOGGER_RECEIVERS.test(seg));
  if (!hasReceiver) return null;
  return level;
}

/**
 * The scope a declaration is visible FROM — the key the body index resolves by.
 *
 * Transferred from `check-durability-degradation-log-level.mjs` (#13474), whose
 * header carries the full argument. Two forms, because JavaScript has two:
 *
 *   LEXICAL (`function foo`, `const foo = () => {}`) — the enclosing block,
 *   module block, `case` block, `for` head, or the `SourceFile`. Hoisting means
 *   a `function` declaration is visible from the whole block, which is what this
 *   returns; a `var` function binding is treated as block-scoped, which can only
 *   make the resolver DECLINE a hop, never follow a wrong one — the direction of
 *   error this census declares.
 *
 *   MEMBER (`foo() {}` in a class or object literal) — not a lexical binding at
 *   all; it is reached through a receiver. Its key is the class or object
 *   literal that OWNS it, so `this.foo(...)` written in a sibling member of the
 *   same class resolves, and the same call in an unrelated class in the same
 *   file does not.
 *
 * @param node The declaration node.
 * @param member `true` for a method declaration, `false` for the lexical forms.
 * @returns The scope node, or `undefined` when there is none (cannot happen for
 *          a parsed file — `SourceFile` terminates every chain).
 */
function declarationScopeOf(node, member) {
  for (let n = node.parent; n; n = n.parent) {
    if (member) {
      if (ts.isClassDeclaration(n) || ts.isClassExpression(n) || ts.isObjectLiteralExpression(n)) return n;
      continue;
    }
    if (ts.isBlock(n) || ts.isSourceFile(n) || ts.isModuleBlock(n) || ts.isCaseBlock(n)
      || ts.isForStatement(n) || ts.isForInStatement(n) || ts.isForOfStatement(n)) {
      return n;
    }
  }
  return undefined;
}

/**
 * Every function body in a file, resolvable BY THE SCOPE IT IS VISIBLE FROM.
 *
 * Covers `function foo() {}`, `const foo = () => {}` / `= function () {}`, and
 * class methods `foo() {}` — the three shapes the scan root uses.
 *
 * ## Why this is not keyed by bare name alone (#13785)
 *
 * It was, and it was LAST-WINS: one `Map<name, body>` filled in source order, so
 * a file that declared the same name more than once resolved EVERY call to it
 * to the LAST declaration, wherever the call was written. That is not an
 * approximation with a direction — a collision where only SOME of the same-named
 * bodies reach a write either INVENTS a member or DROPS a real one, and nothing
 * in the output distinguishes either case from a correct resolution. It is the
 * same defect #13474 recorded in the gate next door, and it was measured here
 * over a wider corpus: 209 collision inserts across 73 names in 44 files.
 *
 * The live instance, measured on the tree this landed against:
 * `packages/objectql/src/engine.ts` declares `find`, `findOne`, `update`,
 * `delete` on BOTH `class ObjectQL` and — a few thousand lines later — `class
 * ObjectRepository`, and `transaction` on both `ObjectQL` and `ScopedContext`.
 * The flat index answered every `this.update(...)` written INSIDE `ObjectQL`
 * with `ObjectRepository`'s method, chosen only because it is last in the file:
 * 26 call sites, on four names that are in `WRITE_SHAPED_CALLEES` above. The
 * census happened not to move — both bodies bottom out in driver writes, so
 * conjunct 3 was satisfied either way — but "accidentally right" is not an
 * invariant, and it is the property `RESOLUTION_CONTROLS` now pins directly,
 * because membership cannot see it.
 *
 * ## What the resolver does, and what it deliberately leaves alone
 *
 * `get(name, from)` walks OUTWARD from the call site and returns the first
 * declaration of `name` whose scope is one of the call site's ancestors —
 * innermost wins, which is what the language does. Two deliberate departures
 * from a strict lexical resolver, transferred from #13474 with its reasons:
 *
 *   ONE DECLARATION ⇒ UNCHANGED. When a name has exactly one body in the file
 *   there is nothing to choose and no lexical information can improve on the
 *   answer, so it is returned whatever the call site is. This confines the
 *   change to exactly the collisions and keeps every hop the census already
 *   depends on. Over-fixing here is as dangerous as under-fixing, for the same
 *   reason: the mechanism has no safe direction.
 *
 *   AMBIGUOUS AND OUT OF SCOPE ⇒ REFUSE. When a name has several bodies and none
 *   of them encloses the call site, the hop is NOT followed. File order is not
 *   evidence, and declining is this census's declared direction of error.
 *
 * ⛔ This does NOT subsume `resolveSameFileBody`'s lexical walk, and must not be
 * read as replacing it: this index knows only where a body is DECLARED, so it
 * cannot see a call site where the name is bound to something that holds no
 * function (`const { callData } = wiring;`). That refusal is the other half of
 * the rule and is still decided there, before this index is consulted.
 *
 * @returns `{ has(name), get(name, from) }` — `has` is membership only (no call
 *          site needed, and it is what the shadow-refusal counter keys on);
 *          `get` needs the call site and returns `undefined` when it cannot
 *          settle the name.
 */
function indexFunctionBodies(sf) {
  const byName = new Map();
  const record = (name, body, scope) => {
    const declared = byName.get(name);
    if (declared) declared.push({ body, scope });
    else byName.set(name, [{ body, scope }]);
  };
  walkAll(sf, (node) => {
    if (ts.isFunctionDeclaration(node) && node.name && node.body) {
      record(node.name.text, node.body, declarationScopeOf(node, false));
      return;
    }
    if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name) && node.body) {
      record(node.name.text, node.body, declarationScopeOf(node, true));
      return;
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const init = node.initializer;
      if ((ts.isArrowFunction(init) || ts.isFunctionExpression(init)) && init.body) {
        record(node.name.text, init.body, declarationScopeOf(node, false));
      }
    }
  });
  return {
    has: (name) => byName.has(name),
    get: (name, from) => {
      const declared = byName.get(name);
      if (!declared) return undefined;
      if (declared.length === 1) return declared[0].body;
      if (!from) return undefined;
      for (let n = from; n; n = n.parent) {
        // Last within ONE scope: two declarations sharing a scope are the only
        // case file order was ever evidence for, and it is the tie-break the
        // flat index already made.
        let hit;
        for (const d of declared) if (d.scope === n) hit = d;
        if (hit) return hit.body;
      }
      return undefined;
    },
  };
}

/** Names in this file that hold a #12923 refusal accumulator. */
function indexRefusalAccumulators(sf) {
  const names = new Set();
  walkAll(sf, (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const path = ts.isCallExpression(node.initializer) ? calleePath(node.initializer.expression) : null;
      if (path && path[path.length - 1] === REFUSAL_ACCUMULATOR_FACTORY) names.add(node.name.text);
      return;
    }
    if (ts.isParameter(node) && ts.isIdentifier(node.name) && node.type) {
      if (node.type.getText(sf).includes(REFUSAL_ACCUMULATOR_TYPE)) names.add(node.name.text);
    }
  });
  return names;
}

/** Is this call's value consumed by an `await` in its own expression? */
function isAwaited(node) {
  let cursor = node.parent;
  while (cursor) {
    if (ts.isAwaitExpression(cursor)) return true;
    if (
      ts.isParenthesizedExpression(cursor)
      || ts.isNonNullExpression(cursor)
      || ts.isAsExpression(cursor)
      || ts.isPropertyAccessExpression(cursor)
      || ts.isCallExpression(cursor)
      || ts.isArrayLiteralExpression(cursor)
      || ts.isSpreadElement(cursor)
    ) {
      cursor = cursor.parent;
      continue;
    }
    return false;
  }
  return false;
}

/**
 * Is this callee a call to a SAME-FILE helper, or a method on some other object
 * that merely shares a name with one?
 *
 * Only `foo(...)` and `this.foo(...)` may resolve to a same-file body. Measured
 * cost of the looser rule, which resolved any dotted path by its LAST segment:
 * `packages/services/service-job/src/db-job-adapter.ts:139` calls
 * `this.cron.cancel(name)` — the CronJobAdapter's method — and the loose rule
 * walked into the file's OWN `cancel()` method, reached `setActive()`'s
 * `engine.update(...)` two frames down, and reported a cron-registry cleanup as
 * a swallowed durability write. A census may over-collect on the SILENCE axis,
 * where the cost is a site a person triages away; it may not over-collect by
 * inventing a write that is not in the guarded block, because that is a member
 * nobody can act on and it discredits the list it sits in.
 *
 * Passing this test is NECESSARY and NOT SUFFICIENT, for either shape. A bare
 * `foo(...)` reaches the file-scope `foo` only while no LOCAL binding shadows the
 * name at the call site (`resolveSameFileBody`), and a `this.foo(...)` reaches a
 * method only of the class that ENCLOSES the call -- `engine.ts` declares
 * `update()` on two classes, and answering by name alone handed one class's call
 * to the other's method. `indexFunctionBodies` decides that half. Together they
 * are the other half of this rule -- see "Same-file resolution is by SCOPE"
 * above.
 */
function sameFileCallee(path) {
  if (path.length === 1) return path[0];
  if (path.length === 2 && path[0] === 'this') return path[1];
  return null;
}

/** Every name a binding pattern introduces: `{ a, b: c }`, `[d]`, `...rest`. */
function bindingNames(nameNode, out = new Set()) {
  if (ts.isIdentifier(nameNode)) {
    out.add(nameNode.text);
    return out;
  }
  if (ts.isObjectBindingPattern(nameNode) || ts.isArrayBindingPattern(nameNode)) {
    for (const element of nameNode.elements) {
      if (ts.isBindingElement(element)) bindingNames(element.name, out);
    }
  }
  return out;
}

/** The body a declaration offers a caller, or null when it holds no function. */
function declaredFunctionBody(decl) {
  if (ts.isFunctionDeclaration(decl) || ts.isFunctionExpression(decl)) return decl.body ?? null;
  if (ts.isVariableDeclaration(decl) && decl.initializer
    && (ts.isArrowFunction(decl.initializer) || ts.isFunctionExpression(decl.initializer))) {
    return decl.initializer.body ?? null;
  }
  return null;
}

function importBindsName(node, name) {
  const clause = node.importClause;
  if (!clause) return false;
  if (clause.name?.text === name) return true;
  const bindings = clause.namedBindings;
  if (!bindings) return false;
  if (ts.isNamespaceImport(bindings)) return bindings.name.text === name;
  return bindings.elements.some((element) => element.name.text === name);
}

/**
 * The declaration of `name` introduced BY this node, or null.
 *
 * One node of the scope chain at a time, so the caller can stop at the INNERMOST
 * binding — which is the one JavaScript resolves the identifier to.
 */
function bindingIntroducedBy(node, name) {
  if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node)
    || ts.isMethodDeclaration(node) || ts.isConstructorDeclaration(node)
    || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node)) {
    for (const parameter of node.parameters) {
      if (bindingNames(parameter.name).has(name)) return parameter;
    }
    // A named function expression binds its own name inside its own body.
    if (ts.isFunctionExpression(node) && node.name?.text === name) return node;
  }
  if (ts.isCatchClause(node) && node.variableDeclaration
    && bindingNames(node.variableDeclaration.name).has(name)) {
    return node.variableDeclaration;
  }
  if ((ts.isForStatement(node) || ts.isForInStatement(node) || ts.isForOfStatement(node))
    && node.initializer && ts.isVariableDeclarationList(node.initializer)) {
    for (const decl of node.initializer.declarations) {
      if (bindingNames(decl.name).has(name)) return decl;
    }
  }
  let statements = null;
  if (ts.isSourceFile(node) || ts.isBlock(node) || ts.isModuleBlock(node)) statements = node.statements;
  else if (ts.isCaseBlock(node)) statements = node.clauses.flatMap((clause) => clause.statements);
  if (!statements) return null;
  for (const statement of statements) {
    if (ts.isVariableStatement(statement)) {
      for (const decl of statement.declarationList.declarations) {
        if (bindingNames(decl.name).has(name)) return decl;
      }
      continue;
    }
    if (ts.isFunctionDeclaration(statement) && statement.name?.text === name) return statement;
    if (ts.isClassDeclaration(statement) && statement.name?.text === name) return statement;
    if (ts.isImportDeclaration(statement) && importBindsName(statement, name)) return statement;
  }
  return null;
}

/**
 * The same-file body this call reaches — decided by SCOPE, not by spelling.
 *
 * `sameFileCallee` has already refused every dotted path but `this.foo`. What is
 * left is the case it cannot see: a BARE `foo(...)` whose name is bound locally.
 * Walking outward from the call site, the innermost binding of the name wins:
 *
 *   - it declares a function (`function foo`, `const foo = () => {}`)  -> that body,
 *     which is the one the call reaches even when the file holds another `foo`;
 *   - it declares anything else — a parameter, a destructured member, a plain
 *     `const`/`let`, a catch variable, an import — -> REFUSED, and counted. The
 *     call reaches something this file does not contain, so following a
 *     same-named body would be inventing a write. `action-execution.ts ::
 *     invokeBusinessAction` is the measured case (#12981): `const { ..., callData
 *     } = wiring;` shadows the module-level `callData`, and following it turned a
 *     record READ into `write=insert@170`.
 *
 * When NO binding is found the name is handed to the body index, which resolves
 * it by the scope the body is VISIBLE FROM rather than by file order -- as is
 * the `this.foo` path above, which this lexical walk never sees. Neither step
 * can invent a body the language would not reach; both only ever REMOVE a
 * resolution, which is this census's declared direction of error. See
 * `indexFunctionBodies` for the two deliberate departures and their measured
 * reasons.
 */
function resolveSameFileBody(callNode, path, bodies, stats) {
  const name = sameFileCallee(path);
  if (!name) return null;
  if (path.length > 1) return bodies.get(name, callNode) ?? null;
  for (let cursor = callNode.parent; cursor; cursor = cursor.parent) {
    const decl = bindingIntroducedBy(cursor, name);
    if (!decl) continue;
    const body = declaredFunctionBody(decl);
    if (body) return body;
    // Counted only when the file-wide index HOLDS this name — that is exactly the
    // set of calls the previous rule would have followed, so the printed number
    // measures the narrowing rather than every locally-bound callback in the repo.
    if (stats && bodies.has(name)) {
      stats.refusedShadowed += 1;
      stats.shadowedNames.set(name, (stats.shadowedNames.get(name) ?? 0) + 1);
    }
    return null;
  }
  return bodies.get(name, callNode) ?? null;
}

/** Walk a block plus, transitively, the same-file helpers it calls. */
function walkWithHelpers(block, bodies, visit, stats, seen = new Set(), depth = 0) {
  if (depth > MAX_HELPER_DEPTH) return;
  walkAll(block, (node) => {
    visit(node);
    if (!ts.isCallExpression(node)) return;
    const path = calleePath(node.expression);
    if (!path) return;
    const name = sameFileCallee(path);
    if (!name || seen.has(name)) return;
    const body = resolveSameFileBody(node, path, bodies, stats);
    if (!body) return;
    seen.add(name);
    walkWithHelpers(body, bodies, visit, stats, seen, depth + 1);
  });
}

/* ------------------------------------------------------------------------- *
 *  The predicate
 * ------------------------------------------------------------------------- */

function analyzeFile(file, relPath, findings, stats) {
  const sf = parseSourceFile(file, readFileSync(file, 'utf8'), scriptKindFor(file));
  const bodies = indexFunctionBodies(sf);
  const accumulators = indexRefusalAccumulators(sf);
  const lineOf = (node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;

  // A quiet-level log OUTSIDE any catch: the "seeded N rows" summary that makes
  // a zero-row pass read healthy. Evidence for the judgement conjunct, not part
  // of membership.
  let healthySummary = 0;
  walkAll(sf, (node) => {
    const level = isLogCall(node);
    if (!level || LOUD_LEVELS.has(level)) return;
    for (let c = node.parent; c; c = c.parent) if (ts.isCatchClause(c)) return;
    healthySummary += 1;
  });

  walkAll(sf, (node) => {
    if (!ts.isTryStatement(node) || !node.catchClause) return;
    stats.tryStatements += 1;

    // -- conjunct 3: an AWAITED write-shaped callee in the guarded block.
    let write = null;
    walkWithHelpers(node.tryBlock, bodies, (inner) => {
      if (write || !ts.isCallExpression(inner)) return;
      const path = calleePath(inner.expression);
      if (!path) return;
      const name = path[path.length - 1];
      const origin = WRITE_SHAPED_CALLEES.get(name);
      if (!origin) return;
      if (!isAwaited(inner)) {
        stats.droppedNotAwaited += 1;
        stats.droppedNames.set(name, (stats.droppedNames.get(name) ?? 0) + 1);
        return;
      }
      write = { callee: name, origin, line: lineOf(inner) };
    }, stats);
    if (!write) return;
    stats.guardedWrites += 1;

    // -- conjunct 1: is anything loud, quiet, or a channel, reachable from the catch?
    //
    // `binding` answers the DARKNESS axis, which is separate from the log axis
    // and is what the card's own shape turns on: `catch { return null; }` has no
    // error binding at all, so nothing about the failure — not the driver code,
    // not the message, not the fact that there WAS one — survives the catch.
    // A catch that reads its binding and hands it onward may still be unheard,
    // but that is an inter-procedural question this instrument does not decide;
    // it is reported as its own tier for a person to triage, never folded into
    // the dark count.
    const binding = node.catchClause.variableDeclaration?.name;
    const bindingName = binding && ts.isIdentifier(binding) ? binding.text : null;
    let bindingRead = false;
    if (bindingName) {
      // The catch BLOCK only — a same-file helper whose own parameter happens to
      // be spelled `e` is a different binding in a different scope, and reading
      // it would be this instrument inventing a channel.
      walkAll(node.catchClause.block, (inner) => {
        if (ts.isIdentifier(inner) && inner.text === bindingName) bindingRead = true;
      });
    }
    const levels = new Set();
    let rethrows = false;
    let channel = null;
    walkWithHelpers(node.catchClause.block, bodies, (inner) => {
      if (ts.isThrowStatement(inner)) rethrows = true;
      const level = isLogCall(inner);
      if (level) levels.add(level);
      if (!ts.isCallExpression(inner)) return;
      const path = calleePath(inner.expression);
      if (!path) return;
      const name = path[path.length - 1];
      if (PROPAGATION_CALLEES.has(name)) channel = channel ?? 'propagation-vocabulary';
      if (name !== REFUSAL_RECORD_METHOD || path.length < 2) return;
      if (path.slice(0, -1).some((seg) => accumulators.has(seg))) channel = 'refusal-accumulator';
    }, stats);

    // -- conjunct 2: does the failure leave as an exception?
    if (rethrows) {
      stats.rethrows += 1;
      return;
    }

    const loud = [...levels].some((l) => LOUD_LEVELS.has(l));
    const bucket = loud ? 'loud' : levels.size > 0 ? 'quiet' : 'silent';
    stats.buckets[bucket] += 1;
    if (bucket === 'loud') return;

    if (!channel) {
      const accumulators = catchAccumulators(node, node.catchClause.block);
      if (accumulatorIsRead(node, accumulators, sf)) channel = ACCUMULATOR_CHANNEL;
    }
    const tier = channel ? 'channelled' : bindingRead ? 'carries-error' : 'dark';
    findings.push({
      file: relPath,
      line: lineOf(node),
      bucket,
      tier,
      levels: [...levels].sort(),
      channel: channel ?? 'none',
      write,
      enclosing: enclosingFunctionName(node, sf),
      healthySummaryInFile: healthySummary > 0,
      snippet: catchSnippet(node.catchClause, sf),
    });
  });
}

/** Names this catch increments (`n++`, `n += 1`) that are NOT declared inside the try. */
function catchAccumulators(tryNode, catchBlock) {
  const declaredInTry = new Set();
  walkAll(tryNode, (n) => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name)) declaredInTry.add(n.name.text);
  });
  const names = new Set();
  walkAll(catchBlock, (n) => {
    let target = null;
    if ((ts.isPostfixUnaryExpression(n) || ts.isPrefixUnaryExpression(n))
      && n.operator === ts.SyntaxKind.PlusPlusToken) target = n.operand;
    if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.PlusEqualsToken) target = n.left;
    if (target && ts.isIdentifier(target) && !declaredInTry.has(target.text)) names.add(target.text);
  });
  return names;
}

/** Does the enclosing function read one of these names OUTSIDE the catch clause? */
function accumulatorIsRead(node, names, sf) {
  if (names.size === 0) return false;
  const fn = enclosingFunctionNode(node);
  if (!fn?.body) return false;
  let read = false;
  walkAll(fn.body, (n) => {
    if (read || !ts.isIdentifier(n) || !names.has(n.text)) return;
    for (let c = n.parent; c && c !== fn; c = c.parent) {
      if (ts.isCatchClause(c)) return;
      // A read that decides or reports: a return value, a call argument
      // (`logger.warn(msg, { refused })`), or an `if` the report hangs off.
      if (ts.isReturnStatement(c) || ts.isCallExpression(c) || ts.isIfStatement(c)) {
        read = true;
        return;
      }
    }
  });
  return read;
}

function enclosingFunctionNode(node) {
  for (let c = node.parent; c; c = c.parent) {
    if (ts.isFunctionDeclaration(c) || ts.isMethodDeclaration(c)
      || ts.isArrowFunction(c) || ts.isFunctionExpression(c)) return c;
  }
  return null;
}

function enclosingFunctionName(node, sf) {
  for (let c = node.parent; c; c = c.parent) {
    if (ts.isFunctionDeclaration(c) && c.name) return c.name.text;
    if (ts.isMethodDeclaration(c) && c.name && ts.isIdentifier(c.name)) return c.name.text;
    if ((ts.isArrowFunction(c) || ts.isFunctionExpression(c)) && ts.isVariableDeclaration(c.parent)
      && ts.isIdentifier(c.parent.name)) return c.parent.name.text;
  }
  return '(top level)';
}

function catchSnippet(catchClause, sf) {
  const text = catchClause.getText(sf).replace(/\s+/g, ' ').trim();
  return text.length > 110 ? `${text.slice(0, 107)}...` : text;
}

/* ------------------------------------------------------------------------- *
 *  Run
 * ------------------------------------------------------------------------- */

function census({ only } = {}) {
  const files = only
    ? [join(ROOT, only)]
    : collectSourceFiles(SCAN_ROOT);
  const findings = [];
  const stats = {
    files: 0,
    tryStatements: 0,
    guardedWrites: 0,
    rethrows: 0,
    droppedNotAwaited: 0,
    droppedNames: new Map(),
    refusedShadowed: 0,
    shadowedNames: new Map(),
    buckets: { silent: 0, quiet: 0, loud: 0 },
  };
  for (const file of files) {
    try {
      if (!statSync(file).isFile()) continue;
    } catch {
      continue;
    }
    stats.files += 1;
    analyzeFile(file, relative(ROOT, file).split(sep).join('/'), findings, stats);
  }
  const members = findings.filter((f) => f.bucket === 'silent');
  const quiet = findings.filter((f) => f.bucket === 'quiet');
  return { stats, members, quiet };
}

function memberFiles(members) {
  return [...new Set(members.map((m) => m.file))].sort();
}

function formatSite(f) {
  return `    ${f.file}:${f.line}  ${f.enclosing}()  write=${f.write.callee}@${f.write.line} `
    + `(${f.write.origin})  ${f.bucket}/${f.tier}${f.channel === 'none' ? '' : `:${f.channel}`}`
    + `${f.healthySummaryInFile ? '  healthySummary' : ''}\n      ${f.snippet}`;
}

/**
 * The BODY of the tier-1 worklist: one row per file that still holds an
 * outstanding DARK member, or the one line the report prints when it holds
 * none.
 *
 * Split out of `report()` so the two `(none …)` readings can be exercised
 * against a declared population instead of only against this tree — see
 * `WORKLIST_READING_CONTROLS`, which is the reason this function exists as a
 * function. It takes its population as arguments and reads nothing else, so a
 * control can hand it a tree that does not exist without touching the census.
 *
 * @param outstanding tier-1 DARK members with no DETERMINED row honouring them.
 * @param determined  tier-1 DARK members a DETERMINED row does honour. Only its
 *                    LENGTH is read here: the rows themselves are printed by the
 *                    register's own block below this one in `report()`.
 */
function worklistLines(outstanding, determined) {
  const out = [];
  const byFile = new Map();
  for (const m of outstanding) byFile.set(m.file, (byFile.get(m.file) ?? 0) + 1);
  for (const [file, count] of [...byFile.entries()].sort()) out.push(`    ${count}×  ${file}`);
  if (byFile.size === 0 && determined.length === 0) {
    out.push('    (none — the family is repaired; the gate handover step landed in PR #15458, and #12981 closed with PR #15472)');
  } else if (byFile.size === 0) {
    out.push('    (none outstanding — every DARK member is DETERMINED below, and every one is still a member)');
  }
  return out;
}

function report({ sites = false } = {}) {
  const { stats, members, quiet } = census();
  const dark = members.filter((m) => m.tier === 'dark');
  const carries = members.filter((m) => m.tier === 'carries-error');
  const channelled = members.filter((m) => m.tier === 'channelled');
  const out = [];
  out.push(`${MEASUREMENT_BANNER}\n`);
  out.push(`  scanned                    ${stats.files} non-test source file(s) under packages/`);
  out.push(`  try/catch statements       ${stats.tryStatements}`);
  out.push(`  ...guarding an awaited write ${stats.guardedWrites}`);
  out.push(`  ...of those, rethrowing    ${stats.rethrows}  (the failure propagates — not a member)`);
  out.push(`  ...answering LOUD           ${stats.buckets.loud}  (error/fatal — already correct)`);
  out.push('');
  out.push(`  MEMBERS (silent catch over an awaited write)   ${members.length} site(s) in ${memberFiles(members).length} file(s)`);
  out.push('  split by what survives the catch — the three tiers are the worklist:');
  out.push(`    [1] DARK          ${String(dark.length).padStart(3)} site(s) in ${String(memberFiles(dark).length).padStart(2)} file(s)  no error binding, or bound and never read`);
  out.push('                                            — this is the card\'s family, and it is mechanically decided');
  out.push(`    [2] carries-error ${String(carries.length).padStart(3)} site(s) in ${String(memberFiles(carries).length).padStart(2)} file(s)  the caught value leaves the catch`);
  out.push('                                            — whether a CALLER reports it is inter-procedural: NOT decided here');
  out.push(`    [3] channelled    ${String(channelled.length).padStart(3)} site(s) in ${String(memberFiles(channelled).length).padStart(2)} file(s)  #12923 refusal log / #5241 propagation`);
  out.push('                                            — repaired; listed so a regression is legible');
  out.push('');
  out.push(`  ADJACENT, not members: QUIET answers          ${quiet.length} site(s)`);
  out.push('    a warn/info/debug over a swallowed write — a LEVEL defect, not a silence defect');
  out.push('');
  out.push(`  dropped by the AWAITED discriminator          ${stats.droppedNotAwaited} call(s)`);
  const dropped = [...stats.droppedNames.entries()].sort((a, b) => b[1] - a[1]);
  if (dropped.length > 0) {
    out.push(`    by name: ${dropped.map(([n, c]) => `${n}×${c}`).join(', ')}`);
  }
  out.push('');
  out.push(`  refused by the SCOPE resolver                 ${stats.refusedShadowed} call(s)`);
  out.push('    a bare identifier bound locally at the call site — a parameter, a destructured');
  out.push('    member, a `const`/`let`, a catch variable, an import — where the file also holds');
  out.push('    a same-named body. Following it would invent a write (see `resolveSameFileBody`).');
  const shadowed = [...stats.shadowedNames.entries()].sort((a, b) => b[1] - a[1]);
  if (shadowed.length > 0) {
    out.push(`    by name: ${shadowed.map(([n, c]) => `${n}×${c}`).join(', ')}`);
  }
  out.push('');
  // #13886: the bucket above is MEMBERSHIP and does not move; this heading is
  // about WORK, so the rows it prints are the ones with no settled
  // determination. A registered site is printed below, still a member, still
  // counted in [1]. A STALE row excuses nothing and its site prints here.
  const { excused, stale } = evaluateDetermined(DETERMINED, dark);
  const outstanding = dark.filter((m) => !excused.has(determinedKey(m)));
  const determined = dark.filter((m) => excused.has(determinedKey(m)));
  out.push('  [1] DARK members, by file — the repair worklist:');
  for (const line of worklistLines(outstanding, determined)) out.push(line);
  if (determined.length > 0) {
    out.push('');
    out.push(`  DETERMINED, not outstanding                  ${determined.length} site(s) in ${memberFiles(determined).length} file(s)`);
    out.push('    read on the merits and recorded in the file; still MEMBERS, still counted in [1] above —');
    out.push('    a determination is a reading of a site, never a change to it:');
    for (const m of [...determined].sort((a, b) => determinedKey(a).localeCompare(determinedKey(b)))) {
      const row = DETERMINED.get(determinedKey(m));
      out.push(`    ${determinedKey(m)}`);
      out.push(`      ${row.verdict}  (${row.ref})`);
    }
  }
  if (stale.length > 0) {
    out.push('');
    for (const line of staleLines(stale)) out.push(line);
  }
  out.push('');
  if (sites) {
    for (const [label, rows] of [
      ['[1] DARK', dark],
      ['[2] carries-error', carries],
      ['[3] channelled', channelled],
      ['ADJACENT: quiet answers (level, not silence)', quiet],
    ]) {
      out.push(`  Every ${label} site:`);
      for (const f of rows) out.push(formatSite(f));
      out.push('');
    }
  }
  out.push('  ⚠️  A green from check-durability-degradation-log-level.mjs over any file listed');
  out.push('      above means NOT MEASURED for that site, never "level approved" (#12981 ruling).');
  process.stdout.write(`${out.join('\n')}\n`);
  return 0;
}

/**
 * The class a call site is written inside, or null at module scope.
 *
 * Keyed on for `RESOLUTION_CONTROLS` because a class name outlives the method
 * names around it, and because the defect these controls pin is precisely a
 * resolution that CROSSES a class boundary.
 */
function enclosingClassName(node) {
  for (let c = node.parent; c; c = c.parent) {
    if (ts.isClassDeclaration(c) || ts.isClassExpression(c)) return c.name?.text ?? '(anonymous class)';
  }
  return null;
}

/** Where a resolved body was DECLARED: its owning class, else the function containing it. */
function resolvedBodyLabel(body, sf) {
  const decl = body.parent;
  for (let c = decl.parent; c; c = c.parent) {
    if (ts.isClassDeclaration(c) || ts.isClassExpression(c)) return c.name?.text ?? '(anonymous class)';
  }
  return enclosingFunctionName(decl, sf);
}

/**
 * Run one `RESOLUTION_CONTROLS` entry against the real resolver.
 *
 * @returns `{ matched, wrong[] }` — `matched` is the non-vacuity count, `wrong`
 *          the sites whose resolution disagrees with the declaration.
 */
function checkResolutionControl(control) {
  const file = join(ROOT, control.file);
  const sf = parseSourceFile(file, readFileSync(file, 'utf8'), scriptKindFor(file));
  const bodies = indexFunctionBodies(sf);
  let matched = 0;
  const wrong = [];
  walkAll(sf, (node) => {
    if (!ts.isCallExpression(node)) return;
    const path = calleePath(node.expression);
    if (!path) return;
    if (sameFileCallee(path) !== control.callee) return;
    if (control.fromClass !== undefined && enclosingClassName(node) !== control.fromClass) return;
    if (control.enclosing !== undefined && enclosingFunctionName(node, sf) !== control.enclosing) return;
    matched += 1;
    const body = resolveSameFileBody(node, path, bodies, null);
    const actual = body ? resolvedBodyLabel(body, sf) : null;
    if (actual !== control.resolvesIn) {
      wrong.push({ line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1, actual });
    }
  });
  return { matched, wrong };
}

/**
 * The gate's `DURABILITY_CRITICAL_CALLEES` names, read out of its SOURCE.
 *
 * `WRITE_SHAPED_CALLEES` copies that vocabulary by value on purpose (its header
 * says why), and a by-value copy's failure mode is SILENCE: the gate grows a
 * name, the copy does not, and this census keeps printing an OVERLAP reading
 * that is simply wrong with nothing anywhere to say so. That is the lie-carrier
 * shape the `DETERMINED` register closes one layer down, and it is not
 * hypothetical here -- see the section above.
 *
 * So the copy is CROSS-CHECKED, not replaced. The gate is still never imported:
 * a non-gate instrument that imports a merge-blocking one inherits its blocking,
 * and the map is not exported in any case. It is PARSED, the way every other
 * fact in this file is read -- through `parseSourceFile`, which refuses an
 * unparseable source instead of scoring it empty.
 *
 * ⛔ Announce, never absorb. The census does not adopt the gate's names on the
 * fly; drift reddens the self-test and a person decides which side moved.
 *
 * @returns the declared names in source order, or `null` when the declaration
 *          cannot be read in the shape this cross-check understands -- which the
 *          caller reports as a FAILURE, never as "no names".
 */
function readGateVocabulary() {
  const file = join(ROOT, GATE_SCRIPT);
  const sf = parseSourceFile(file, readFileSync(file, 'utf8'), scriptKindFor(file));
  let names = null;
  walkAll(sf, (node) => {
    if (names !== null || !ts.isVariableDeclaration(node)) return;
    if (!ts.isIdentifier(node.name) || node.name.text !== GATE_VOCABULARY_IDENT) return;
    const init = node.initializer;
    if (!init || !ts.isNewExpression(init) || init.arguments?.length !== 1) return;
    const [entries] = init.arguments;
    if (!ts.isArrayLiteralExpression(entries)) return;
    const collected = [];
    for (const entry of entries.elements) {
      // A shape this reader does not understand must not degrade to a shorter
      // list: that would green the comparison against a vocabulary nobody read.
      if (!ts.isArrayLiteralExpression(entry) || entry.elements.length === 0) return;
      const [key] = entry.elements;
      if (!ts.isStringLiteralLike(key)) return;
      collected.push(key.text);
    }
    names = collected;
  });
  return names;
}

/** The census's copy of that vocabulary: the `gate-vocabulary` origin subset. */
function copiedGateVocabulary() {
  return [...WRITE_SHAPED_CALLEES]
    .filter(([, origin]) => origin === 'gate-vocabulary')
    .map(([name]) => name);
}

/**
 * @returns `{ missing, extra }` -- names the gate declares that the copy lacks,
 *          and names labelled `gate-vocabulary` here that the gate does not
 *          declare. Both directions matter: the first is a member the census
 *          under-reports as overlap, the second is overlap it invents.
 */
function compareGateVocabulary(copied, declared) {
  const copiedSet = new Set(copied);
  const declaredSet = new Set(declared);
  return {
    missing: declared.filter((name) => !copiedSet.has(name)),
    extra: copied.filter((name) => !declaredSet.has(name)),
  };
}

function selfTest(mode = 'all') {
  const gated = mode === 'gated';
  const problems = [];
  const { members } = census();
  const byFile = new Map();
  for (const m of members) {
    if (!byFile.has(m.file)) byFile.set(m.file, []);
    byFile.get(m.file).push(m);
  }
  for (const control of gated ? [] : POSITIVE_CONTROLS) {
    const hits = byFile.get(control.file) ?? [];
    if (hits.length === 0) {
      problems.push(`positive control found NO member: ${control.file}\n    ${control.why}`);
      continue;
    }
    if (control.channel && !hits.some((h) => h.channel === control.channel)) {
      problems.push(`positive control ${control.file} yielded no member on channel `
        + `\`${control.channel}\` (saw: ${[...new Set(hits.map((h) => h.channel))].join(', ')}).`);
    }
    if (!hits.some((h) => h.tier === control.tier)) {
      problems.push(`positive control ${control.file} yielded ${hits.length} member(s) but none at tier `
        + `\`${control.tier}\` (saw: ${[...new Set(hits.map((h) => h.tier))].join(', ')}). `
        + 'The tier split is the worklist; an instrument that cannot hold it apart is not a worklist.');
    }
  }
  for (const control of REGRESSION_CONTROLS) {
    const hits = (byFile.get(control.file) ?? []).filter((h) => h.enclosing === control.enclosing);
    if (hits.length > 0) {
      problems.push(`regression control fired again: ${control.file} :: ${control.enclosing}()\n    ${control.why}`);
    }
  }
  for (const control of NEGATIVE_CONTROLS) {
    const hits = byFile.get(control.file) ?? [];
    if (hits.length > 0) {
      problems.push(`negative control yielded ${hits.length} member(s): ${control.file}\n    ${control.why}`);
    }
  }
  for (const control of RESOLUTION_CONTROLS) {
    const { matched, wrong } = checkResolutionControl(control);
    const target = control.resolvesIn === null ? 'REFUSAL' : `\`${control.resolvesIn}\``;
    const site = `${control.file} :: ${control.fromClass ?? control.enclosing} :: ${control.callee}()`;
    if (matched === 0) {
      problems.push(`resolution control matched NO call site: ${site}\n    A control that matches `
        + `nothing passes VACUOUSLY. Re-point it at a live site or delete it.\n    ${control.why}`);
      continue;
    }
    if (wrong.length > 0) {
      problems.push(`resolution control moved: ${site} -> expected ${target}, got `
        + `${wrong.map((w) => `${w.actual ?? 'REFUSAL'}@${w.line}`).join(', ')}\n    ${control.why}`);
    }
  }
  // ── The DETERMINED register (#13886), asserted in BOTH modes ──────────────
  //
  // See SELF_TEST_MODES for why this family is gated. Three legs: the real
  // register must be clean, both STALE legs must actually fire, and the
  // register must be unable to move membership.
  const dark = members.filter((m) => m.tier === 'dark');
  const live = evaluateDetermined(DETERMINED, dark);
  for (const s of live.stale) {
    problems.push(`DETERMINED register row is STALE: ${s.key} [${s.kind}]\n    ${s.detail}\n    `
      + `it was registered because: ${s.row.why}`);
  }

  // (i) NEGATIVE leg — a row whose determination is not written where it says.
  //     Run against a REAL registered file with a sentence nobody wrote, so the
  //     control proves the anchor is read rather than that a missing file trips.
  const anchorProbeKey = [...DETERMINED.keys()].find((k) => DETERMINED.get(k).scope === 'site');
  const anchorProbe = evaluateDetermined(
    new Map([[anchorProbeKey, { ...DETERMINED.get(anchorProbeKey), anchor: 'this sentence is in no file in this repo' }]]),
    dark,
  );
  if (anchorProbe.stale.length !== 1 || anchorProbe.stale[0].kind !== 'anchor-gone'
    || anchorProbe.excused.size !== 0) {
    problems.push('DETERMINED cross-check did not fire: a row whose anchor sentence is absent from its own '
      + `function was not reported STALE (saw: ${anchorProbe.stale.map((s) => s.kind).join(', ') || 'nothing'}, `
      + `${anchorProbe.excused.size} excused). Without this leg the register excuses sites on its own `
      + 'authority, which is the failure it exists to prevent.');
  }

  // (ii) NEGATIVE leg — a row whose site is not a DARK member. Keyed on a real
  //      file and a function that exists and carries the anchor, so the ONLY
  //      thing wrong with it is that the census does not report it in tier 1.
  const memberProbeKey = 'packages/runtime/src/domains/keys.ts::handleKeysRequest';
  const memberProbe = evaluateDetermined(
    new Map([[memberProbeKey, DETERMINED.get(memberProbeKey)]]),
    dark.filter((m) => determinedKey(m) !== memberProbeKey),
  );
  if (memberProbe.stale.length !== 1 || memberProbe.stale[0].kind !== 'not-a-member'
    || memberProbe.excused.size !== 0) {
    problems.push('DETERMINED membership check did not fire: a row whose site the census does not report '
      + `as a tier-1 DARK member was not reported STALE (saw: ${memberProbe.stale.map((s) => s.kind).join(', ') || 'nothing'}, `
      + `${memberProbe.excused.size} excused). A determination about a site that left the bucket is stale.`);
  }

  // (iii) COEXISTENCE — the register partitions the printed worklist and moves
  //       no count. Asserted arithmetically rather than described, because this
  //       is the property the whole card turns on, and because a positive
  //       control asserting membership of a registered file must keep passing.
  const excusedSites = dark.filter((m) => live.excused.has(determinedKey(m)));
  const outstandingSites = dark.filter((m) => !live.excused.has(determinedKey(m)));
  if (excusedSites.length + outstandingSites.length !== dark.length) {
    problems.push('DETERMINED register changed the tier-1 population: '
      + `${excusedSites.length} + ${outstandingSites.length} != ${dark.length}. The register may only `
      + 'partition what is printed; membership is decided before it is consulted.');
  }
  for (const key of live.excused) {
    if (!members.some((m) => determinedKey(m) === key)) {
      problems.push(`DETERMINED row ${key} was excused without being a member — a registered site must `
        + 'remain in the census, at tier `dark`, or the over-collection this instrument depends on is gone.');
    }
  }

  // ── The COPIED gate vocabulary (#15459), asserted in BOTH modes ───────────
  //
  // See SELF_TEST_MODES for why this leg is gated. Two legs: the copy must equal
  // the gate's own declaration, and the comparison must be able to say it does
  // not.
  const declaredGateNames = readGateVocabulary();
  const copiedGateNames = copiedGateVocabulary();
  if (declaredGateNames === null) {
    problems.push(`the gate's \`${GATE_VOCABULARY_IDENT}\` could not be read out of ${GATE_SCRIPT} in the `
      + 'shape this cross-check understands. Reported as a FAILURE and never as "no names": an '
      + 'unreadable declaration compared silently would green this leg forever, which is the exact '
      + 'defect the cross-check exists to close. Re-point `readGateVocabulary` at its new shape.');
  } else {
    const drift = compareGateVocabulary(copiedGateNames, declaredGateNames);
    if (drift.missing.length > 0 || drift.extra.length > 0) {
      problems.push('the `gate-vocabulary` copy in `WRITE_SHAPED_CALLEES` has DRIFTED from the gate\'s own '
        + `\`${GATE_VOCABULARY_IDENT}\` (${copiedGateNames.length} copied, ${declaredGateNames.length} declared)`
        + (drift.missing.length > 0
          ? `\n    declared by the gate, missing from the copy: ${drift.missing.join(', ')}` : '')
        + (drift.extra.length > 0
          ? `\n    labelled \`gate-vocabulary\` here, NOT declared by the gate: ${drift.extra.join(', ')}` : '')
        + '\n    The copy is deliberate and is NOT adopted automatically (see `WRITE_SHAPED_CALLEES`):'
        + ' decide which side moved. A name the gate gained belongs in the copy; a name this census'
        + ' wants that the gate does not declare belongs under a different `origin`.');
    }
    // NEGATIVE leg — the comparison must actually fire. A cross-check that
    // cannot report drift is the by-value copy's own failure mode wearing a
    // green tick, so perturb the copy in BOTH directions and require both back.
    const probeAbsent = copiedGateNames[0];
    const probeInvented = 'aNameNoGateWillEverDeclare';
    const probe = compareGateVocabulary([...copiedGateNames.slice(1), probeInvented], declaredGateNames);
    if (!probe.missing.includes(probeAbsent) || !probe.extra.includes(probeInvented)) {
      problems.push('the gate-vocabulary cross-check did not fire: a copy with one declared name dropped '
        + `and one undeclared name added was compared as ${probe.missing.length} missing / `
        + `${probe.extra.length} extra. Without this leg the comparison can pass VACUOUSLY.`);
    }
  }

  // ── What the WORKLIST PRINTS (#15503), asserted in BOTH modes ────────────
  //
  // See WORKLIST_READING_CONTROLS for why these readings are exercised against
  // a declared population rather than against the tree — two of the three
  // cannot be reached from `packages/**` today — and SELF_TEST_MODES for why
  // this family is gated: it compares a producer against a declared population
  // and never touches membership, so no repair can destroy it.
  //
  // The table is pinned to its own length first (#13799's floor recipe): a loop
  // over an emptied table runs zero cases and prints nothing, which reads in a
  // CI log exactly like a pass.
  const WORKLIST_READING_CONTROL_COUNT = 3;
  if (WORKLIST_READING_CONTROLS.length !== WORKLIST_READING_CONTROL_COUNT) {
    problems.push(`the worklist reading table holds ${WORKLIST_READING_CONTROLS.length} control(s), not the `
      + `${WORKLIST_READING_CONTROL_COUNT} it is pinned at. Both empty readings and the negative leg that `
      + 'keeps them honest are declared there; a row deleted rather than re-pointed takes its reading out '
      + 'of every run silently, which is the failure this family exists to close.');
  }
  for (const control of WORKLIST_READING_CONTROLS) {
    const printed = worklistLines(control.outstanding, control.determined);
    const same = printed.length === control.expect.length
      && printed.every((line, i) => line === control.expect[i]);
    if (!same) {
      problems.push(`the worklist's reading moved: ${control.when}\n`
        + `${control.expect.map((l) => `      declared: |${l}|`).join('\n')}\n`
        + `${printed.map((l) => `      printed:  |${l}|`).join('\n') || '      printed:  (nothing)'}\n`
        + `    ${control.why}`);
    }
  }

  // The durability filter must actually filter: the raw shape is ~3.5x this.
  if (members.length === 0) {
    problems.push('census found ZERO members — on this tree that is a broken matcher, not a clean repo.');
  }
  if (problems.length > 0) {
    process.stderr.write(`x  measure-durability-swallow-family self-test${gated ? ' (gated families)' : ''} FAILED\n\n${
      problems.map((p) => `  - ${p}`).join('\n\n')}\n\n`);
    return 1;
  }
  if (gated) {
    process.stdout.write(
      `${MEASUREMENT_BANNER}\n`
      + '✓ measure-durability-swallow-family self-test, gated families (#13919): '
      + `${NEGATIVE_CONTROLS.length} negative control(s) yield none, `
      + `${REGRESSION_CONTROLS.length} regression control(s) stay clear, `
      + `${RESOLUTION_CONTROLS.length} resolution control(s) resolve as declared, `
      + `${DETERMINED.size} DETERMINED register row(s) cross-check clean, `
      + `${copiedGateNames.length} copied gate-vocabulary name(s) match the gate's own declaration, `
      + `${WORKLIST_READING_CONTROLS.length} worklist reading(s) print as declared over a fixture population, `
      + `${members.length} member site(s) total\n`
      + `   ${POSITIVE_CONTROLS.length} positive control(s) are NOT asserted here, permanently: they pin `
      + 'members of the #12981 worklist, which\n   that programme exists to remove — a control the repair '
      + 'is designed to destroy cannot hold a CI gate.\n   Run `--self-test` for every family; see '
      + '`SELF_TEST_MODES` for the whole rationale.\n',
    );
    return 0;
  }
  process.stdout.write(
    `✓ measure-durability-swallow-family self-test: ${POSITIVE_CONTROLS.length} positive control(s) `
    + `yield members at their declared tier, ${NEGATIVE_CONTROLS.length} negative control(s) yield none, `
    + `${REGRESSION_CONTROLS.length} regression control(s) stay clear, `
    + `${RESOLUTION_CONTROLS.length} resolution control(s) resolve as declared, `
    + `${DETERMINED.size} DETERMINED register row(s) cross-check clean, `
    + `${copiedGateNames.length} copied gate-vocabulary name(s) match the gate's own declaration, `
    + `${WORKLIST_READING_CONTROLS.length} worklist reading(s) print as declared over a fixture population, `
    + `${members.length} member site(s) total\n`,
  );
  return 0;
}

function main(argv) {
  const mode = selfTestMode(argv);
  if (mode !== null) {
    if (typeof mode === 'object') {
      process.stderr.write(
        `x  REFUSED: unknown self-test mode \`${mode.unknown}\`. Known modes: `
        + `${[...SELF_TEST_MODES].map((m) => `--self-test=${m}`).join(', ')} (bare \`--self-test\` means `
        + '`=all`).\n   Refused rather than run, because falling through to the census would exit 0 and '
        + 'read in a CI log\n   exactly like a self-test that passed.\n',
      );
      return 2;
    }
    return selfTest(mode);
  }
  const fileIdx = argv.indexOf('--file');
  if (fileIdx !== -1) {
    const { members, quiet } = census({ only: argv[fileIdx + 1] });
    for (const f of [...members, ...quiet]) process.stdout.write(`${formatSite(f)}\n`);
    return 0;
  }
  if (argv.includes('--json')) {
    const { stats, members, quiet } = census();
    process.stdout.write(`${JSON.stringify({
      members,
      quiet,
      stats: {
        ...stats,
        droppedNames: Object.fromEntries(stats.droppedNames),
        shadowedNames: Object.fromEntries(stats.shadowedNames),
      },
    }, null, 2)}\n`);
    return 0;
  }
  return report({ sites: argv.includes('--sites') });
}

process.exitCode = main(process.argv.slice(2));
