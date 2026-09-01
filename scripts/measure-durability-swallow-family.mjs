#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// measure-durability-swallow-family -- the #12981 CENSUS instrument.
//
//   node scripts/measure-durability-swallow-family.mjs             # census
//   node scripts/measure-durability-swallow-family.mjs --sites     # every site
//   node scripts/measure-durability-swallow-family.mjs --json      # machine
//   node scripts/measure-durability-swallow-family.mjs --file <p>  # one file
//   node scripts/measure-durability-swallow-family.mjs --self-test # controls
//
// It is NOT a gate: it is not wired into any workflow, it exits 0 on any
// membership count, and it is deliberately not named `check:*` or `gen:*` so
// the #4203 script ledger has nothing to classify (the shape
// `measure-partial-retirement-annotation.mjs` established). The only non-zero
// exit is `--self-test` failing its declared controls, and `ts-parse`'s
// EXIT_UNPARSEABLE.
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
// The gate matches callee NAMES from an 18-entry `DURABILITY_CRITICAL_CALLEES`
// vocabulary. A seeder that reaches storage through `ql.insert(...)` is not in
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
// ## The handover (the ruling's LAST step, not this one)
//
// The programme ends by adding the seeder-helper names (`tryInsert`/`tryUpdate`)
// to the gate's `DURABILITY_CRITICAL_CALLEES` **with zero reds**, which is what
// keeps `scripts/durability-degradation.baseline.json` at its designed empty
// steady state. That step is gated on `outstanding == 0` for those wrappers in
// this census. Until then:
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
 *                           copies). These are the names the ruling's last step
 *                           hands to the gate.
 *   - `gate-vocabulary`  -- already declared in
 *                           `check-durability-degradation-log-level.mjs`.
 *                           Carried here so the census can report the OVERLAP:
 *                           how many members the gate can already see. Copied by
 *                           value on purpose -- importing the gate's map would
 *                           couple a non-gate instrument to a merge-blocking one.
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
  ['tryInsert', 'seed-wrapper'],
  ['tryUpdate', 'seed-wrapper'],
  ['tryDelete', 'seed-wrapper'],
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
    file: 'packages/plugins/plugin-sharing/src/share-link-service.ts',
    why:
      '`resolveToken`\'s usage stamp: `try { await this.engine.update(\'sys_share_link\', ...) } '
      + 'catch { /* best-effort -- usage telemetry is a nice-to-have */ }`. Silent by the log axis, an '
      + 'awaited write in the try, and nothing bound -- the dark shape exactly.\n\n'
      + 'CHOSEN FOR ITS STABILITY, which is the property a dark control needs and the previous one '
      + 'lacked. This control used to name `bootstrap-system-capabilities.ts`, whose `why` read "the '
      + 'card\'s shape, verbatim, still standing" -- and #12981 batch 2 repaired it, which turned this '
      + 'self-test red for doing exactly what the ruling asked. ANY tier-1 DARK member of the worklist '
      + 'is a control the repair programme is designed to destroy, so repointing at another one only '
      + 'moves the breakage to the batch that repairs THAT file. This member is different: batch 1 '
      + 'judged it OUT of the programme on the merits -- the swallowed write is a `use_count` / '
      + '`last_used_at` telemetry stamp, and escalating a FUNCTIONAL degradation to `error` is the '
      + 'over-application AGENTS.md forbids -- so it is a genuine dark member with a recorded reason '
      + 'to stay one. ⛔ If a later card ever does repair it, repoint this control at another member '
      + 'ruled OUT rather than at a member merely not repaired YET.',
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

function report({ sites = false } = {}) {
  const { stats, members, quiet } = census();
  const dark = members.filter((m) => m.tier === 'dark');
  const carries = members.filter((m) => m.tier === 'carries-error');
  const channelled = members.filter((m) => m.tier === 'channelled');
  const out = [];
  out.push('durability swallow-family census (#12981) — a MEASUREMENT, not a gate\n');
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
  out.push('  [1] DARK members, by file — the repair worklist:');
  const byFile = new Map();
  for (const m of dark) byFile.set(m.file, (byFile.get(m.file) ?? 0) + 1);
  for (const [file, count] of [...byFile.entries()].sort()) out.push(`    ${count}×  ${file}`);
  if (byFile.size === 0) out.push('    (none — the family is repaired; the gate handover step is unblocked)');
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

function selfTest() {
  const problems = [];
  const { members } = census();
  const byFile = new Map();
  for (const m of members) {
    if (!byFile.has(m.file)) byFile.set(m.file, []);
    byFile.get(m.file).push(m);
  }
  for (const control of POSITIVE_CONTROLS) {
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
  // The durability filter must actually filter: the raw shape is ~3.5x this.
  if (members.length === 0) {
    problems.push('census found ZERO members — on this tree that is a broken matcher, not a clean repo.');
  }
  if (problems.length > 0) {
    process.stderr.write(`x  measure-durability-swallow-family self-test FAILED\n\n${
      problems.map((p) => `  - ${p}`).join('\n\n')}\n\n`);
    return 1;
  }
  process.stdout.write(
    `✓ measure-durability-swallow-family self-test: ${POSITIVE_CONTROLS.length} positive control(s) `
    + `yield members at their declared tier, ${NEGATIVE_CONTROLS.length} negative control(s) yield none, `
    + `${REGRESSION_CONTROLS.length} regression control(s) stay clear, `
    + `${RESOLUTION_CONTROLS.length} resolution control(s) resolve as declared, `
    + `${members.length} member site(s) total\n`,
  );
  return 0;
}

function main(argv) {
  if (argv.includes('--self-test')) return selfTest();
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
