#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// check-engine-double-contract -- a fake ObjectQL engine's WRITE VERBS must be
// pinned to the real engine's dispatch contract, not a looser hand-written
// approximation of it (objectstack#4550, from objectstack#4434; the `update`
// slice added by objectstack#5480).
//
//   node scripts/check-engine-double-contract.mjs
//   node scripts/check-engine-double-contract.mjs --self-test
//
// ## The failure mode this exists for
//
// `DELETE /api/v1/sharing/rules/:idOrName` answered **500 for every rule and
// both address forms** from the day it was written. It was not untested:
// plugin-sharing's `deleteRule drops rule + all its grants` asserted success on
// it the whole time -- against a FAKE ENGINE whose `delete` accepted a call the
// real engine refuses. `deleteRule` purged `sys_record_share` with a
// predicate-shaped delete carrying neither a scalar `where.id` nor
// `options.multi`, which is precisely the one shape `ObjectQL.delete` throws
// on. The fake deleted by predicate happily, so the suite was green, the gate
// was green, and the route was dead. That is #4434.
//
// The general shape, and the reason this is a gate rather than a fixed test:
// **a test double looser than the implementation it replaces converts a green
// suite into no suite at all**, silently, on exactly the paths a double was
// introduced for -- which are the paths that were hard to test, which are
// usually the paths where the contract is densest.
//
// ## Slices: the WRITE-VERB dispatches, and only on ENGINE doubles
//
// #4550 lists four instances of the family. This gate takes the ones whose
// criterion is mechanically decidable with no judgment call: a write verb's
// dispatch is a total function from a call to one of three verdicts, so "is
// this double looser?" has a yes/no answer that does not depend on reading the
// test's intent.
//
//   - `delete` -- `assertEngineDeleteDispatch` / `resolveEngineDeleteDispatch`
//     (#4550, from #4434).
//   - `update` -- `assertEngineUpdateDispatch` / `resolveEngineUpdateDispatch`
//     (#5480). Same three-way dispatch, same destructiveness: a predicate
//     update rewrites every matching row's fields. It sat in the "not covered"
//     list below until #5480 extracted the producer-side predicate it needed,
//     which is the ONLY thing that was ever missing -- the criterion, the
//     scanner and the ledger are shared verbatim.
//
// A slice is exactly two facts: which member of the double to look at, and
// which producer-side predicate that member must reach. Everything else --
// the shape attribution below, the one-helper-deep indirection, the ledger,
// the both-directions reconciliation -- is one implementation serving both.
//
// ## Three data-access shapes, not two (#6327, from #5945)
//
// A discovered literal is attributed to one of THREE contracts, because the
// repo has three. The write verbs side by side are the whole taxonomy:
//
//   IDataEngine            update(objectName, data, options?)   object name FIRST
//   IDataDriver            update(objectName, id, data, …)      primary key SECOND
//   IScopedObjectRepository update(data, options?)              NO object name
//
// Only the first is this gate's subject. The driver is vetoed by
// DRIVER_ONLY_MEMBERS and the primary-key parameter test; the scoped repository
// -- added by #5945 as `packages/spec/src/contracts/scoped-context.ts`, and
// implemented by objectql's `ObjectRepository` -- is vetoed by
// REPOSITORY_ONLY_MEMBERS. Both vetoes put their shape OUT OF SCAN SCOPE rather
// than into the ledger, because neither is a looser copy of `ObjectQL.<verb>`:
// it is a different function with a different arity, so there is no dispatch
// contract for it to be looser THAN.
//
// Why the third arm had to be built rather than baselined: a scoped repository
// binds to one object, so its literal reads as engine-shaped to a scan that can
// only see member names (`find`/`findOne`/`count`/`insert`, and `insert` is in
// ENGINE_ONLY_MEMBERS). Accurate for what the scan can see, wrong about what the
// object is. `@objectstack/spec` -- where the contract and both of its
// conformance witnesses live -- cannot import `assertEngineUpdateDispatch` even
// in principle, since the predicate's two homes both DEPEND ON spec, so every
// witness of this interface could only ever leave the gate through a
// hand-written EXEMPT. A gate that reddens correct code and can only be digested
// through its ledger grows the ledger into noise, and the ledger's readability
// is this gate's whole value (see the baseline's `$comment`: shrink-only, hand
// reviewed).
//
// Deliberately NOT covered, and why (each wants its own slice, not a vaguer
// version of these -- a gate whose scope is fuzzy is indistinguishable from
// no gate to everyone downstream of it):
//
//   - fixtures that disable a platform constraint in prose (`// FK enforcement
//     is off in this harness`, #4441). The criterion is a comment, so it is
//     both evadable by deleting the comment and unable to find the silent
//     cases. That one wants a declared debt ledger, not a scanner.
//   - stubbing the very thing under assertion (objectui#3129) and missing
//     counterparts (objectui#3134). Both live in the `objectui` repo, which
//     this script cannot see, and #3134 names no double at all.
//   - the option surface (unknown-option rejection). Same family, but it needs
//     its own producer-side predicate extracted first -- the two write verbs
//     have one because #4434 and #5480 paid for them.
//   - the READ side (`find` filter semantics) is no longer uncovered:
//     `scripts/check-where-matcher-conformance.mjs` (#8494) holds it. It could
//     not follow this gate's pattern, because extracting the producer-side
//     predicate a read slice would need -- a shared `matchesWhere` -- was ruled
//     NO on #7620 for these doubles specifically. So it asks each independent
//     double a behavioural question instead of handing it an implementation.
//   - a scoped repository that declares NO repository-only member. Measured on
//     the corpus this landed against: `packages/runtime/src/action-body-identity
//     .test.ts:71` is a real scoped facade (`createContext().object(name)`)
//     spelling only `find`/`count`/`insert`/`update`/`delete`, and it stays in
//     the ledger. Seeing it would mean reading its parameter NAMES, and `o` is
//     ambiguous in exactly this repo: `o: string` is the object name in twelve
//     discovered doubles and `o?: any` is the options bag in that facade. A
//     criterion that guessed would trade a ledger row for the risk of putting a
//     genuine engine double out of scan scope, which is the one error this gate
//     cannot report. One ledger row is the cheaper half.
//
// ## Invariants
//
// Each holds PER SLICE -- a green `delete` slice says nothing about `update`,
// and the ledger is keyed on (file, verb) for the same reason.
//
//   DISCOVERED  the scan found engine doubles at all. Zero is not "a clean
//               repo", it is a broken scan: PINNED iterates the discovered set,
//               so a discovery that silently stops matching makes this script
//               print OK while checking nothing -- the #4868 family, where a
//               check runs, is green, and structurally cannot reach its subject.
//   PINNED      every discovered engine double's verb routes through that
//               slice's `assert…Dispatch` / `resolve…Dispatch` -- the predicate
//               the real `ObjectQL.<verb>` itself uses, importable from
//               `@objectstack/metadata-core` (where it lives since #5619) or
//               from `@objectstack/objectql` (which re-exports it from the
//               original path) -- or its file carries a measured baseline entry
//               for that verb.
//   RECONCILED  in both directions. A baseline entry for a file with no
//               unguarded doubles left, for a file that no longer exists, or
//               whose count is now lower, is an error. A ratchet that can only
//               accrete rots into a list nobody trusts.
//   DECLARED    every baseline entry names a `verb` this script actually
//               scans. Without it a typo'd or retired verb makes an entry
//               unreachable -- it would reconcile against nothing, forever,
//               and read as a live exemption.
//   RETAINED    a double that WAS pinned still is. The pinned population is
//               enumerated in `engine-double-contract.pinned.json`, so a pin
//               that leaves names itself instead of decrementing a printed
//               integer nobody compares (#9680). See the block below.
//
// ## RETAINED, and why the pinned set is enumerated rather than counted (#9680)
//
// The four invariants above ratchet the LEDGERED population in both directions
// -- measured on this branch, deleting a DEBT-ledgered double's member reddens
// (`RECONCILED: baseline entry for … declares no engine double with a delete
// any more`), and so does dropping one of the five doubles behind the EXEMPT
// entry (`down to 4 … from the baseline's 5`). The PINNED population had no
// such ratchet, and that asymmetry is the whole of #9680: DISCOVERED fires at
// zero, never at one-fewer-than-yesterday, and PINNED iterates the discovered
// set, so a pinned double that stops declaring the member simply LEAVES.
//
// Discovery requires the member to exist, so absence is invisible by
// construction. Measured, two directions, on `packages/core/src/utils/
// migration-journal.test.ts`:
//
//   delete the whole `async delete(…)` member   OK -- 318 pinned (was 319), exit 0
//   delete only the `assertEngineDeleteDispatch` call   x PINNED …, exit 1
//
// The control going red is what makes the first line a blind spot rather than a
// broken harness: the gate pins the dispatch behaviour of a member that EXISTS.
//
// ## Why an identity ledger and not a count, priced rather than assumed
//
// A count-delta ("319, shrink-fails") is the cheaper artifact and was rejected
// on two measurements, not on taste:
//
//   - It cannot see a SWAP. One double loses `delete` while another gains one
//     and the total is unchanged, so the instrument reads clean while coverage
//     moved. An enumeration compares membership, so the swap is two rows.
//   - Its remedy carries no information. A legitimate removal and this card's
//     defect produce the SAME one-character diff (`319` -> `318`), so review
//     cannot tell them apart and the only available habit is "bump the number"
//     -- the failure mode a ratchet exists to prevent, re-created by the
//     ratchet itself.
//
// The maintenance objection to an enumeration is real but was measured and is
// small. Measured over the FULL population: 3,103 first-parent commits on
// `main` in the month to 2026-08-18 (`git log --first-parent
// --since=2026-07-18 --until=2026-08-18 origin/main`). Membership of the pinned
// set changed in 111 of them for `delete` (3.6%) and 103 for `update` (3.3%);
// 162 and 160 files ENTERED, and exactly ONE left per verb.
//
// ⛔ An earlier revision of this comment read "the 269 commits ... changed in 7
// commits (2.6%) ... zero left". 269 was the depth of the shallow clone the
// measuring agent ran in, not the month's traffic, and the 7 and the "zero"
// were themselves computed over only those 269 commits -- so every number in
// the sentence, numerator included, described a ~9% sample. It is re-measured
// here rather than rescaled: the true rate is HIGHER than the sample reported,
// which is the direction that swapping only the denominator would have hidden.
//
// The single departure per verb is the case worth stating precisely, because it
// is the nuisance an identity ledger is accused of and it did not behave like
// one: f16e54e1d deleted `protocol-delete-object-package-binding-guard.test.ts`
// and added a replacement carrying both pins in the SAME commit, so repo-wide
// coverage never dropped. It lands in the "file gone from disk" world below,
// whose remedy is mechanical and carries no judgement call. Across the whole
// month there were ZERO instances of the shape this ratchet exists to catch --
// file present, verb gone -- and zero per-file counts that shrank without
// reaching zero.
//
// Method, stated so this can be redone rather than trusted: membership is
// proxied by `assertEngine…Dispatch(` call sites in test files under the scan
// roots, calibrated on 2026-08-19 against this gate's own ledger as it then
// stood -- 0 false negatives on the file sets, and every (file, verb) row but
// ONE agreeing on the exact count. That calibration is a dated measurement, not
// a standing property; anyone re-running it must first prove their clone covers
// the window; a shallow one silently answers for its own depth, which is the
// whole reason this paragraph had to be rewritten.
//
// So the additions the ratchet does redden on are already in conversation with
// this gate (they are new fakes that had to write `assert…Dispatch` because
// PINNED demanded it). Set against the DEBT ledger this gate already carries,
// the pinned ledger is the same file format, the same order of magnitude and
// the same reconciliation shape -- so it is the maintenance cost already being
// paid for the other ledger, not a new one. Both sizes are printed by a run and
// countable in the artifacts; they are deliberately not copied into this prose,
// because `--write` moves one of them and nothing here would notice.
//
// ## How a LEGITIMATE decrease is expressed (the anti-nuisance half)
//
// `node scripts/check-engine-double-contract.mjs --write`, then commit. That is
// the whole remedy, it is the repo's existing ratchet idiom (see
// check-slot-lookup-ratchet.mjs's `--update`), and it is mechanical -- there is
// no number to choose, so there is no number to fudge.
//
// What keeps that from degenerating into "regenerate on red" is that the gate
// CLASSIFIES the loss before asking for anything, and says which of three
// worlds it is in:
//
//   file gone from disk         a deleted test. Legitimate; regenerate.
//   file present, verb gone     THE #9680 DEFECT. The member was dropped while
//                               the fake and its file live on. Loud, and named.
//   fewer doubles than pinned   the same defect at a finer grain: the file pins
//                               several and one member was deleted. Nothing else
//                               in this gate reacts, because a fake is still there.
//   all doubles present,        the double went UNGUARDED -- already an error
//   fewer pinned                under PINNED above, and cross-named here so one
//                               output explains the whole picture.
//
// A count can reach none of those three, because by the time it has been
// decremented the identity is gone. And `--write` prints every loss it is about
// to record, so the author reads what left at the moment they regenerate rather
// than discovering it in review.
//
// ## Why "routes through the shared predicate" and not "mirrors the guard"
//
// The #4434 fix mirrored the engine's guard into that one fake by hand. That
// closes one fake and opens a second copy of the contract -- and the scalar
// test is the half a hand-written copy drops: `where: { id: { $in: [...] } }`
// LOOKS like an id and is a multi-row predicate, so the real engine rejects it
// without `multi` and a mirrored `if (!opts?.where?.id && !opts?.multi)` accepts
// it. Requiring the producer's own function removes the class: a double that
// imports the decision cannot be looser than the decision. Same reasoning as
// objectstack#4455 -- the scan and the validator must answer with ONE predicate.
//
// `update` adds a second way a copy goes wrong, in the opposite direction: its
// id also comes from the PAYLOAD (`data.id`, taken verbatim when truthy, ahead
// of `where` and ahead of `multi`), so a copyist who "improves" the rule by
// scalar-testing `data.id` writes a double STRICTER than the producer, which
// fails calls a running server accepts. Looser hides bugs, stricter invents
// them; importing the decision is the only spelling that does neither.
//
// ## What this deliberately does NOT claim
//
// It checks that the shared predicate is CALLED, not that the double's by-id
// and multi branches then behave like the driver would. A gate cannot judge
// that, and one that pretended to would be the verifier that reports success
// while degrading. What it can do is make the rejection surface impossible to
// drift, which is the half that shipped #4434.

import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { join, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { parseSourceFile } from './ts-parse.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE_PATH = join(ROOT, 'scripts', 'engine-double-contract.baseline.json');
const PINNED_LEDGER_PATH = join(ROOT, 'scripts', 'engine-double-contract.pinned.json');
const SEAM_LEDGER_PATH = join(ROOT, 'scripts', 'engine-double-contract.seams.json');
const SCAN_ROOTS = ['packages', 'examples'];

/**
 * The slices. Each names ONE member of an engine double and the producer-side
 * predicate that member must reach; everything else in this file is shared.
 *
 * `symbols` is the pair the producer exports (`assert…` throws, `resolve…`
 * classifies -- a double may legitimately use either), and `modules` is where
 * they may come from.
 *
 * ## Why `modules` names TWO packages and not one (#5619)
 *
 * The predicates were written in `packages/objectql/src/` and MOVED to
 * `@objectstack/metadata-core` by #5619 -- the implementation lives there now,
 * and `@objectstack/objectql` re-exports every symbol from the original paths.
 * Both spellings therefore reach the SAME function, which is the only property
 * this list has ever been about: a double that imports the producer's decision
 * cannot be looser than the producer, whichever door it came through.
 *
 * The move was not cosmetic. `@objectstack/objectql` DEPENDS ON
 * `@objectstack/metadata-protocol`, so that package's thirteen fake engines
 * could not import from `@objectstack/objectql` at all -- turbo 2.10.7 rejects
 * the resulting task graph outright ("Circular package dependency detected") --
 * and all 26 of their (file, verb) pairs sat in the ledger for that one
 * structural reason. Sinking the predicate into a package both sides already
 * depend on is the route the EXEMPT entry for
 * `packages/spec/src/contracts/data-engine.test.ts` names, and #5619 took it.
 *
 * Note what this does NOT relax: `@objectstack/spec` stays unpinnable in
 * principle, because `metadata-core` depends on `spec` -- the import would
 * invert that edge exactly as it inverted `objectql -> spec`. That entry's
 * EXEMPT reasoning survives the move unchanged.
 */
const SLICES = [
  {
    verb: 'delete',
    producer: 'ObjectQL.delete',
    symbols: new Set(['assertEngineDeleteDispatch', 'resolveEngineDeleteDispatch']),
    modules: [
      /^@objectstack\/objectql$/,
      /^@objectstack\/metadata-core$/,
      /engine-delete-dispatch(\.js)?$/,
    ],
    pinCall: 'assertEngineDeleteDispatch(options)',
    origin: '#4434',
  },
  {
    verb: 'update',
    producer: 'ObjectQL.update',
    symbols: new Set(['assertEngineUpdateDispatch', 'resolveEngineUpdateDispatch']),
    modules: [
      /^@objectstack\/objectql$/,
      /^@objectstack\/metadata-core$/,
      /engine-update-dispatch(\.js)?$/,
    ],
    pinCall: 'assertEngineUpdateDispatch(data, options)',
    origin: '#5480',
  },
];

/** The verbs the ledger may name -- see the DECLARED invariant. */
const SCANNED_VERBS = new Set(SLICES.map((s) => s.verb));

/**
 * Members that mark an object literal as standing in for the ENGINE.
 *
 * The engine and the driver share every name here, so the sibling set is what
 * separates them alongside the parameter test below: drivers speak
 * `create`/`bulkCreate`/`checkHealth`, the engine speaks `insert`/`findOne`.
 *
 * A slice never counts its OWN verb as a sibling (`scanSource` filters it),
 * which is why `delete` can sit in this set without changing the delete
 * slice's discovery by one file: it is evidence for the `update` slice --
 * `{ find, update, delete }` is an engine-shaped trio -- and self-excluded
 * for its own.
 */
const ENGINE_SIBLINGS = new Set([
  'find', 'findOne', 'insert', 'update', 'delete', 'count', 'aggregate', 'getSchema', 'registry',
  'insertMany',
]);

/**
 * Parameter names that mean "this is the DRIVER's signature": the primary key
 * sits in the second position for both write verbs -- `delete(object, id,
 * options)` and `update(object, id, data, options)` -- where the engine takes
 * an options bag and a payload respectively.
 */
const ID_PARAM = /^_*(id|recordId|ids|pk)$/i;

/**
 * Members present on `IDataDriver` and on NEITHER `IDataEngine` nor the ObjectQL
 * class — so declaring one is positive evidence of the DRIVER contract.
 *
 * Consulted only when the parameter test cannot answer (see `isEngineDeleteShape`).
 * Deliberately excludes every name both contracts share — `find`, `findOne`,
 * `update`, `count`, `delete` and `execute` (the engine declares `execute?` too,
 * `data-engine.ts`) — because a name on both sides separates nothing.
 */
const DRIVER_ONLY_MEMBERS = new Set([
  'connect', 'disconnect', 'checkHealth', 'getPoolStats', 'create', 'upsert',
  'bulkCreate', 'bulkUpdate', 'bulkDelete', 'updateMany', 'deleteMany',
  'beginTransaction', 'commit', 'rollback', 'syncSchema', 'syncSchemasBatch',
  'registerExternalObject', 'getSchemaSyncStats', 'dropTable', 'reclaimSpace',
  'explain', 'temporalFilterValue', 'temporalFilterColumnSql',
]);

/**
 * The engine-side half of the same evidence: on `IDataEngine` (`insert`,
 * `aggregate`) or on the ObjectQL class itself (`getSchema`, `registry`,
 * `insertMany`), and absent from `IDataDriver`.
 *
 * A subset of ENGINE_SIBLINGS, and the distinction is the whole point: `find` /
 * `findOne` / `update` / `count` are engine siblings for DISCOVERY (they mark a
 * data-access object) while being useless for ATTRIBUTION (drivers speak all
 * four). Only the names here answer "engine, not driver".
 */
const ENGINE_ONLY_MEMBERS = new Set(['insert', 'insertMany', 'aggregate', 'getSchema', 'registry']);

/**
 * The third arm of the same evidence architecture (#6327, from #5945): members
 * present on the SCOPED REPOSITORY — `IScopedObjectRepository`
 * (`packages/spec/src/contracts/scoped-context.ts`) and the `ObjectRepository`
 * class that declares `implements` it — and on NEITHER `IDataEngine` NOR
 * `IDataDriver` NOR the ObjectQL class. Declaring one is positive evidence of
 * an object-BOUND repository, which is not this gate's subject.
 *
 * Verified member by member rather than assumed, on the tree this landed
 * against: `IDataEngine` declares find/findOne/insert/update/delete/count/
 * aggregate/vectorFind/execute and no by-id form; `IDataDriver` reaches for
 * records by `id` in a PARAMETER (`update(object, id, data)`) and spells its
 * bulk forms `bulkUpdate`/`updateMany`/`bulkDelete`/`deleteMany`; and inside
 * `packages/objectql/src/engine.ts` the only declarations of these two names
 * are on `class ObjectRepository implements IScopedObjectRepository`.
 *
 * Kept to the names that answer, exactly as DRIVER_ONLY_MEMBERS is. The
 * repository's `create` / `upsert` / `delete` / `aggregate` / `execute` are
 * real members and are deliberately absent: every one of them is also on the
 * driver or the engine, so it separates nothing. (`create` already sits in
 * DRIVER_ONLY_MEMBERS, so a repository double spelling it leaves scan scope
 * through that veto instead — the right outcome by the wrong name, recorded
 * here so the next reader does not read it as a gap.)
 */
const REPOSITORY_ONLY_MEMBERS = new Set(['updateById', 'deleteById']);

/**
 * Parameter names that mean "this position holds an OBJECT NAME" — the
 * complement of ID_PARAM, and the first position rather than the second.
 *
 * Both contracts this gate DOES judge take the object name first, so positive
 * evidence of one is positive evidence that the literal is NOT an object-bound
 * repository. `t` and `table` are here because this repo's fakes use them
 * (`_t: string` is the commonest spelling in the discovered corpus after
 * `object: string`).
 */
const OBJECT_NAME_PARAM = /^_*(o|obj|object|objectName|objectname|name|table|tableName|t)$/i;

// ── Discovery ───────────────────────────────────────────────────────────────

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e.name === 'node_modules' || e.name === 'dist' || e.name === '.git' || e.name === '.cache') continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(test|spec)\.(ts|tsx|mts)$/.test(e.name)) out.push(p);
  }
  return out;
}

function testFiles() {
  const out = [];
  for (const r of SCAN_ROOTS) walk(join(ROOT, r), out);
  return out.sort();
}

/**
 * The cheap pre-filter EVERY walk in this file shares: could this text declare
 * a member named `verb` at all? If not, there is nothing to parse.
 *
 * ⛔ It is one function because it was FOUR copies and two of them were
 * narrower than the others (#10175). `scanSlice` and the `--census` veto
 * ablation tested `\b<verb>\s*[(:]`, which admits `delete(` and `delete:` and
 * nothing else; the two census walks tested `[(:,}]`, which also admits the
 * SHORTHAND spellings `update,` and `update }`. While `implOf` could not read a
 * shorthand that difference was invisible -- discovery would have found nothing
 * in those files anyway. The moment it can (below), the narrow copies become a
 * silent skip: a file whose ONLY spelling of the verb is a shorthand member is
 * never parsed by discovery while the census parses it and reports it, so the
 * two walks disagree for a reason that is nowhere near the code that decides.
 *
 * That is #9747's self-test failure with a pre-filter wearing the costume, and
 * it is the same class as the widening hazard #10175's structural note names --
 * one step further upstream, where a reader looking at `implOf` cannot see it.
 * So the class is closed rather than the instance: there is one spelling now,
 * and a fifth walk gets it by calling this.
 */
function mentionsVerb(text, verb) {
  return new RegExp(`\\b${verb}\\s*[(:,}]`).test(text);
}

/**
 * The implementation a MOCK CONSTRUCTOR wraps, or null (#8639).
 *
 * `delete: vi.fn(async (o, opts) => …)` is a CallExpression, so the two
 * initializer branches of `implOf` below used to answer `null` for it —
 * `consider()` then returned before the sibling and shape tests ever ran, and
 * the double was discovered by NEITHER side of a ledger that reconciles in both
 * directions. Not "declared out of scope": absent. That is the DISCOVERED
 * invariant's blind half, one layer down — `DISCOVERED != 0` catches a scan
 * that breaks entirely and cannot catch a scan that quietly skips one spelling,
 * and `vi.fn` is the spelling a test reaches for precisely when it wants to
 * assert call counts on the double it just wrote.
 *
 * ## How wide to unwrap, measured rather than assumed
 *
 * The criterion is STRUCTURAL and callee-agnostic: a call carrying EXACTLY ONE
 * argument which is a function expression / arrow function. That admits every
 * spelling holding an implementation (`vi.fn(fn)` and, for free and correctly,
 * the chained `.mockImplementation(fn)` — the arrow there IS what the double
 * runs) and rejects the ones that hold a VALUE or nothing at all, without an
 * allowlist of callee names that would go silently blind the day someone writes
 * `vitest.fn` or a local wrapper.
 *
 * Deliberately NOT widened, both measured at ZERO occurrences on this corpus:
 *
 *   - a function among SEVERAL arguments (`traced('delete', fn)`). The card's
 *     phrasing is "sole function argument" and the narrow reading is the one
 *     that cannot mistake a lifecycle callback for the verb's implementation.
 *   - a function in the chained receiver (`vi.fn(fn).mockResolvedValue(v)`),
 *     which would need this to recurse into `init.expression`.
 *
 * ## ⛔ The per-spelling counts are NOT written here any more (#9943)
 *
 * This header used to carry the census as CONSTANTS — `310` CallExpression
 * members, a callee table summing to it, `93` admitted and `217` rejected.
 * Nothing regenerated them, so nothing could catch them drifting, and by
 * 2026-08-19 they had. Writing fresher constants in their place would reproduce
 * the defect with newer values (#9803 / PR #9909), so they are gone and
 * `--census` prints the same table from THIS FILE'S OWN `implOf` walk instead.
 * `#9943` had to hand-copy the criterion to re-scan and got 341 against the
 * recorded 310 with no way to say which was wrong; that question no longer
 * exists. The two ZERO readings above are printed by `--census` too, and were
 * still ZERO on 2026-08-20 — re-run it rather than trusting this sentence.
 *
 * ## What the old census could not have told you, and #9877 is the proof
 *
 * Its population was "every member whose initializer is a CallExpression" —
 * the shape this function already reads. A census of what the matcher already
 * matches cannot report the matcher's blind spots however carefully it is
 * re-run, and both spellings it listed as ZERO are CallExpression spellings for
 * that reason. #9877's defaulted initializer (`overrides.delete ?? vi.fn(fn)`)
 * is a BinaryExpression and was never in the population at all, while hiding a
 * live unguarded engine `delete` double. `--census` buckets by initializer KIND
 * first for exactly this reason: a spelling the gate cannot read shows up as a
 * row with a low read-rate, not as silence.
 *
 * Both remain measurements, not opinions — run `--census` before widening,
 * exactly as the REPOSITORY_ONLY_MEMBERS note above asks.
 *
 * Note which way the remaining error leans. A `vi.fn()` with no argument stays
 * `null` and stays undiscovered, and that is correct rather than a residual
 * gap: there is no implementation to read, so there is no function for
 * `isEngineVerbShape` to judge and nothing that could be looser than
 * `ObjectQL.<verb>` — the double's behaviour is `undefined`, not a lax guard.
 */
function unwrapCallImpl(init) {
  if (!ts.isCallExpression(init)) return null;
  const args = init.arguments ?? [];
  if (args.length !== 1) return null;
  const only = args[0];
  if (ts.isFunctionExpression(only) || ts.isArrowFunction(only)) return only;
  return null;
}

/**
 * The implementation behind a DEFAULTED initializer, or null (#9877).
 *
 * `delete: overrides.delete ?? vi.fn(async (o, arg) => …)` is a
 * BinaryExpression, which is neither of the two shapes `fnInitializer` knew, so
 * `implOf` answered null, `consider()` returned before `isEngineVerbShape` was
 * ever asked, and the double left the population with no verdict recorded --
 * not baselined, not exempt, not pinned. Absent. `rest-batch-endpoint.test.ts`
 * held a live unguarded engine `delete` double behind exactly this spelling and
 * the gate reddens on it the moment it can read it, so this is not cosmetic.
 *
 * ## Why the census above could not have found this, which is the real lesson
 *
 * That census enumerates "every delete/update member whose initializer is a
 * CallExpression". A defaulted initializer is a BinaryExpression, so it was
 * never in the census POPULATION -- the census is scoped to the shape the
 * recognizer already reads, and a census of what the matcher already matches
 * cannot report the matcher's blind spots however carefully it is re-run. The
 * two spellings it lists as "measured at ZERO" are both CallExpression
 * spellings for the same reason. `--census` fixes the population, not the
 * arithmetic: it now buckets EVERY initializer by kind first, so a spelling
 * outside the recognizer shows up as its own row rather than as silence.
 *
 * ## Which side, and why both are read
 *
 * `a ?? b` and `a || b` reach the subject as `a` when `a` is present and as `b`
 * otherwise, so BOTH sides are implementations the double may run. The default
 * is read first because it is the one this file itself authored and the only
 * one that is statically knowable -- the left side of a `??` default is by
 * construction the maybe-absent, caller-supplied one, and where it IS statically
 * a function (`f ?? g`, both literals) reading the left as a fallback keeps the
 * spelling from going dark again.
 *
 * Deliberately NOT widened, and this one is a judgement rather than a count:
 * `cond ? a : b`. A conditional's arms are selected by a test this gate cannot
 * evaluate, so "the implementation" is not a property of the initializer at all
 * -- unlike `??`/`||`, where the fallback is unconditionally reachable. Measured
 * at ZERO occurrences on this corpus (`--census`, ConditionalExpression row);
 * re-run that before widening it, not the number in this sentence.
 */
function unwrapDefaultedImpl(init, seen) {
  if (!ts.isBinaryExpression(init)) return null;
  const op = init.operatorToken.kind;
  if (op !== ts.SyntaxKind.QuestionQuestionToken && op !== ts.SyntaxKind.BarBarToken) return null;
  return fnInitializer(init.right, seen) ?? fnInitializer(init.left, seen);
}

/**
 * The NEAREST declaration of `name` visible from `node`, or null (#10175).
 *
 * Resolution is by SCOPE CHAIN -- walk out through the enclosing statement
 * lists and take the first one that declares the name -- and not by a
 * file-wide `name -> node` map, which is the cheaper shape and the one the
 * card proposed. The reason is measured on this corpus rather than argued:
 *
 *   packages/metadata-protocol/src/protocol.dropped-fields.bulk.test.ts
 *     declares `const update` TWICE (two fakes, two `describe` blocks)
 *   packages/plugins/plugin-auth/src/admin-user-endpoints.test.ts
 *     declares `const engineUpdate` TWICE (module scope and a nested block)
 *
 * A file-wide map has to pick one of each pair for every use site, so on three
 * of the constructs this card is about it would be reading a DIFFERENT
 * function than the one that runs. Today the two spellings happen to agree --
 * each pair's members carry the same shape, so the verdict is the same either
 * way -- and "they agree today" is exactly the kind of property that is true
 * until someone edits one half of a pair. Getting it right costs a parent
 * walk, which `setParentNodes: true` (fixed in `ts-parse.mjs`) already pays
 * for.
 *
 * What it deliberately does NOT reach, both for the same reason -- the
 * implementation is not statically knowable, so refusing keeps the construct
 * in the UNRECOGNISED census instead of guessing at it:
 *
 *   - PARAMETERS (`function make(del) { return { delete: del }; }`). The
 *     implementation is whatever the caller passed.
 *   - imported bindings. The function is in another file, and one file is all
 *     any walk here has.
 *
 * Note which way the error leans, the same way `takesObjectNameFirst` states
 * it: answering null leaves a construct UNRECOGNISED -- printed, counted, and
 * visible -- while answering with the wrong function would put a verdict on a
 * double this gate never read. The first is a row in a census; the second is
 * the failure mode this gate exists to prevent, wearing the gate's own badge.
 */
function resolveBinding(node, name) {
  for (let scope = node.parent; scope; scope = scope.parent) {
    let statements = null;
    if (ts.isSourceFile(scope) || ts.isBlock(scope) || ts.isModuleBlock(scope)) statements = scope.statements;
    else if (ts.isCaseClause(scope) || ts.isDefaultClause(scope)) statements = scope.statements;
    if (!statements) continue;
    let found = null;
    for (const st of statements) {
      if (ts.isFunctionDeclaration(st) && st.name?.text === name) found = st;
      else if (ts.isVariableStatement(st)) {
        for (const d of st.declarationList.declarations) {
          if (ts.isIdentifier(d.name) && d.name.text === name && d.initializer) found = d.initializer;
        }
      }
    }
    if (found) return found;
  }
  return null;
}

/**
 * The implementation behind a BARE LOCAL BINDING, or null (#10175).
 *
 * `delete: del` (with `const del = vi.fn(async (o, opts) => …)` above it) and
 * the shorthand `{ registry, insert, findOne, update }` are the two remaining
 * spellings #9877 named and narrowed away from. Both are the same shape: the
 * initializer is an IDENTIFIER, so `fnInitializer` had nothing to unwrap,
 * `implOf` answered null, and the double left the population with no verdict
 * recorded -- not pinned, not baselined, not exempt. Absent. Measured on the
 * tree this landed against, they were the WHOLE of the UNRECOGNISED census:
 * 21 constructs, 7 rooting at a named binding and 14 shorthand.
 *
 * ## Why it recurses through `fnInitializer` rather than reading the binding
 *
 * The binding is not usually a bare arrow -- every one of the 21 is
 * `vi.fn(async (…) => …)`, which is the CallExpression spelling `unwrapCallImpl`
 * already reads. Handing the resolved initializer back to `fnInitializer` means
 * this spelling composes with every other one for free (`const del =
 * overrides.delete ?? vi.fn(fn)` reads, and so does a binding that is itself
 * another binding) instead of re-implementing a second, narrower unwrap that
 * would drift from the first -- the drift `fnInitializer` was extracted to
 * remove (#8639's sibling half).
 *
 * `seen` is keyed on the resolved DECLARATION NODE rather than on the name,
 * because `const a = b` in one scope and `const b = a` in another are two
 * different bindings that share a spelling. A cycle answers null, which leaves
 * the construct in the census where it belongs.
 *
 * A `FunctionDeclaration` is returned as itself: everything downstream reads
 * `.parameters` and walks the body (`isEngineVerbShape`, `calleesIn`), and both
 * work on a declaration exactly as they do on the expression forms. One without
 * a body is an overload signature -- no implementation, so null.
 */
function unwrapBoundImpl(init, seen) {
  if (!ts.isIdentifier(init)) return null;
  const decl = resolveBinding(init, init.text);
  if (!decl || seen.has(decl)) return null;
  seen.add(decl);
  if (ts.isFunctionDeclaration(decl)) return decl.body ? decl : null;
  return fnInitializer(decl, seen);
}

/**
 * One initializer reading, shared by BOTH initializer spellings below.
 *
 * Shared on purpose: the object-literal (`PropertyAssignment`) and class-field
 * (`PropertyDeclaration`) branches carried the same three lines twice and drifted
 * apart in exactly the way that produced #8639's sibling half — a fix applied to
 * one spelling and not the other reproduces this card at the next reading. With
 * one function there is no second copy to forget.
 */
function fnInitializer(init, seen = new Set()) {
  if (!init) return null;
  if (ts.isFunctionExpression(init) || ts.isArrowFunction(init)) return init;
  const defaulted = unwrapDefaultedImpl(init, seen);
  if (defaulted) return defaulted;
  const called = unwrapCallImpl(init);
  if (called) return called;
  return unwrapBoundImpl(init, seen);
}

/**
 * A member's function-ish implementation, or null.
 *
 * ⛔ It takes no binding map and no `SourceFile`, and that is deliberate rather
 * than an omission: `resolveBinding` walks `node.parent`, so the ONE function
 * every walk in this file already calls gained the local-binding spellings
 * without a second parameter to thread -- and therefore without a call site
 * that could be missed. #10175's structural note is about exactly that hazard:
 * a widening applied to `scanSource` alone leaves `censusSource` reporting the
 * same constructs as UNRECOGNISED, the two walks disagree, and #9747's
 * self-test reddens. Here there is no second place to apply it.
 */
function implOf(member) {
  if (ts.isMethodDeclaration(member) || ts.isMethodSignature(member)) return member;
  if (ts.isPropertyAssignment(member)) return fnInitializer(member.initializer);
  if (ts.isPropertyDeclaration(member)) return fnInitializer(member.initializer);
  // `{ registry, insert, findOne, update }` -- the member's NAME is the binding.
  if (ts.isShorthandPropertyAssignment(member)) return unwrapBoundImpl(member.name, new Set());
  return null;
}

function memberName(member) {
  const n = member.name;
  if (!n) return null;
  if (ts.isIdentifier(n) || ts.isStringLiteral(n)) return n.text;
  return null;
}

/**
 * Is this `<verb>(a, b, …)` the ENGINE's shape rather than the DRIVER's?
 * (Named `isEngineDeleteShape` until #5480 made it serve both write verbs; the
 * body never was delete-specific.)
 *
 *   engine   `delete(object, options)`      `update(object, data, options)`
 *   driver   `delete(object, id, options)`  `update(object, id, data, options)`
 *
 * The second parameter is the whole question for both: the engine takes an
 * options bag / a payload there, the driver takes a primary key. Judged on the
 * name first (the repo writes `id` when it means one) and on a scalar type
 * annotation second.
 *
 * ## When there IS no second parameter (#5629)
 *
 * A fake omits the parameters it ignores — `async delete() { return false; }` —
 * and this function used to open with `if (params.length < 2) return false`,
 * which discarded the double before any other test ran. Not "declared out of
 * scope": unreachable. Those deletes reached neither PINNED nor the ledger and
 * produced no output at all, which is the #4868 shape this script's own
 * DISCOVERED invariant is written against. Measured on this branch: 92 such
 * deletes behind that one line, 0 of them pinned.
 *
 * So when arity cannot answer, the SIBLING SET answers instead — and it has to
 * be a real test, not a waved-through `return true`. #5629's premise for a
 * blanket admit ("a zero-parameter delete cannot be the driver's, since the
 * driver's signature has a primary-key position") does not survive measurement:
 * fake DRIVERS drop their unused parameters exactly like fake engines do, so 43
 * of those 92 are driver doubles — `spec/src/contracts/data-driver.test.ts`
 * itself, and `objectql/src/engine-aggregate-having.test.ts`'s self-described
 * "driver WITH native aggregate()". Admitting them unconditionally would have
 * pointed this gate at the wrong contract 43 times.
 *
 * The evidence that does separate them is which members the object declares
 * ALONGSIDE delete: it must show a member only the engine has, and none that
 * only the driver has. Both halves are load-bearing — `aggregate` alone admits
 * the native-aggregate driver above, and "no driver members" alone admits any
 * `{ find, findOne, update, delete }` store mock that is neither contract.
 */
/**
 * Does this verb take an OBJECT NAME in first position? Positive evidence only
 * — an unreadable or absent first parameter answers `false`, never `true`.
 *
 * The asymmetry is deliberate and is the whole safety property of the scoped-
 * repository veto below: this function's `true` KEEPS a literal in scan scope,
 * so being generous with it can only cost a ledger row, while being generous
 * with `false` would put a genuine engine double out of scan scope — the one
 * error a gate cannot report about itself.
 */
function takesObjectNameFirst(fn) {
  const first = (fn.parameters ?? [])[0];
  if (!first) return false;
  const name = ts.isIdentifier(first.name) ? first.name.text : '';
  if (OBJECT_NAME_PARAM.test(name)) return true;
  const t = first.type ? first.type.getText().trim() : '';
  return /^(string|string \| number)$/.test(t);
}

function isEngineVerbShape(fn, memberNames = new Set(), opts = {}) {
  const params = fn.parameters ?? [];
  // The DRIVER veto outranks everything, at every arity (#5480).
  //
  // It used to run only when arity could not answer. That was survivable while
  // the only verb was `delete`, whose driver spelling puts a parameter the repo
  // consistently names `id` in second position — but it does not survive
  // `update`. `plugin.integration.test.ts` writes its fake DRIVERS as
  // `update: async (_o: string, _i: any, d: any) => d`: `_i` IS the primary
  // key, it just is not spelled `id`, so the parameter test reads the payload
  // position as an options bag and admits 19 driver doubles in one file as
  // engine doubles. A ledger that records false positives is worse than a
  // narrow one — it teaches readers the gate does not know what it is looking
  // at. Declaring `connect`/`create`/`syncSchema`/`updateMany` is positive
  // evidence of the DRIVER contract at ANY arity (`IDataEngine` declares none
  // of them), so it decides first. Same precedence the arity path always used,
  // now applied uniformly.
  for (const n of memberNames) if (DRIVER_ONLY_MEMBERS.has(n)) return false;
  // The SCOPED-REPOSITORY veto (#6327), same precedence and the same shape as
  // the driver veto above: a name only the third contract has, decided at ANY
  // arity, before ENGINE_ONLY_MEMBERS gets to read `insert` as engine evidence
  // — which is precisely how #5945's two conformance witnesses were attributed
  // to the engine and could only leave through a hand-written EXEMPT.
  //
  // BOTH halves are required, and each has a job. The member is the evidence
  // that this is a repository; the parameter test is what stops the member from
  // silencing a fake that is ALSO engine-shaped — a double spelling
  // `update(objectName, data, opts)` takes the object name the engine takes, so
  // it stays in scope and stays pinnable however many convenience members it
  // hangs off the side. Requiring the member is the other half: object-lessness
  // alone would have to be inferred from parameter names, and `o` means the
  // object in twelve discovered doubles and the options bag in one scoped
  // facade, so a member-free reading would be guessing on a corpus that
  // genuinely disagrees with itself.
  //
  // Measured, not assumed — and the measurement is the gate's own now. This
  // comment used to state the corpus as constants (`250 doubles this gate
  // discovers`, `82 PINNED`), in the present tense, so they read as standing
  // properties rather than as the dated reading they were; nothing regenerated
  // them and by 2026-08-19 they had drifted roughly 2x and 4x (#9943).
  // `--census` prints this veto's effect directly — which constructs the pair
  // moves, and how many of them are pinned — so the claim below is re-derivable
  // instead of restated.
  //
  // Re-derived 2026-08-20 on the grown corpus: the pair still moves EXACTLY 2
  // constructs, still both of #5945's `IScopedContext` witnesses under
  // packages/spec, and still 0 pinned doubles. The conclusion survived the
  // growth even though every number describing the corpus did not — which is
  // the argument for deriving them rather than writing them down. Widening this
  // is a measurement, not an opinion: run `--census` before adding a name here.
  if (!opts.skipRepositoryVeto && !takesObjectNameFirst(fn)) {
    for (const n of memberNames) if (REPOSITORY_ONLY_MEMBERS.has(n)) return false;
  }
  if (params.length < 2) {
    let engineEvidence = false;
    for (const n of memberNames) {
      if (ENGINE_ONLY_MEMBERS.has(n)) engineEvidence = true;
    }
    return engineEvidence;
  }
  const second = params[1];
  const name = ts.isIdentifier(second.name) ? second.name.text : '';
  if (ID_PARAM.test(name)) return false;
  const t = second.type ? second.type.getText() : '';
  if (/^(string|number|bigint|string \| number)$/.test(t.trim())) return false;
  return true;
}

/** Collect every identifier that is CALLED anywhere inside `node`. */
function calleesIn(node) {
  const names = new Set();
  const visit = (n) => {
    if (ts.isCallExpression(n)) {
      const e = n.expression;
      if (ts.isIdentifier(e)) names.add(e.text);
      else if (ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.name)) names.add(e.name.text);
    }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return names;
}

/**
 * LOCAL names in this file that are bound to THIS SLICE's pinned predicates by
 * an import from the producer.
 *
 * Keyed on the local binding (so `import { assertEngineDeleteDispatch as guard }`
 * still counts) but only when the IMPORTED name is one of the slice's symbols —
 * a same-named local look-alike must not qualify, since the whole property is
 * that one predicate answers. Per slice, so a file that pins `delete` and not
 * `update` is credited for exactly the one it pinned, which is the state most
 * of this repo's doubles are in the day #5480 lands.
 */
function pinnedImportsOf(sourceFile, slice) {
  const found = new Set();
  for (const st of sourceFile.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier)) continue;
    const spec = st.moduleSpecifier.text;
    if (!slice.modules.some((re) => re.test(spec))) continue;
    const named = st.importClause?.namedBindings;
    if (named && ts.isNamedImports(named)) {
      for (const el of named.elements) {
        const imported = (el.propertyName ?? el.name).text;
        if (slice.symbols.has(imported)) found.add(el.name.text);
      }
    }
  }
  return found;
}

/** Top-level function declarations / const-arrow functions, by name. */
function localFunctions(sourceFile) {
  const map = new Map();
  const visit = (n) => {
    if (ts.isFunctionDeclaration(n) && n.name) map.set(n.name.text, n);
    if (ts.isVariableStatement(n)) {
      for (const d of n.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.initializer
          && (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))) {
          map.set(d.name.text, d.initializer);
        }
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sourceFile);
  return map;
}

/**
 * Every engine double in one file, with a verdict on whether the SLICE's verb
 * is pinned to that slice's shared predicate.
 *
 * Pinning is accepted one level of indirection deep: a fake that opens with a
 * local `assertDeletable(opts)` helper which itself calls the shared predicate
 * is pinned. Two hops is not — at that point the gate would be guessing.
 *
 * One double may be pinned for one verb and not the other; the scan answers
 * per slice and the ledger records per slice, because a fake bound to the
 * producer on `delete` and hand-waving on `update` is exactly the asymmetry
 * #5393 hit and #5480 removed the excuse for.
 */
function scanSource(fileName, text, slice = SLICES[0], opts = {}) {
  const sf = parseSourceFile(fileName, text);
  const pinnedNames = pinnedImportsOf(sf, slice);
  const locals = localFunctions(sf);
  const doubles = [];

  const bodyIsPinned = (fn) => {
    if (pinnedNames.size === 0) return false;
    const direct = calleesIn(fn);
    for (const n of direct) if (pinnedNames.has(n)) return true;
    for (const n of direct) {
      const local = locals.get(n);
      if (!local) continue;
      for (const m of calleesIn(local)) if (pinnedNames.has(m)) return true;
    }
    return false;
  };

  const consider = (members, node) => {
    const names = new Set();
    let target = null;
    for (const m of members) {
      const n = memberName(m);
      if (!n) continue;
      names.add(n);
      if (n === slice.verb) target = implOf(m);
    }
    if (!target) return;
    // The verb under test is never its own sibling: `{ find, update }` is two
    // pieces of engine evidence for the update slice, `{ update }` is none.
    const siblings = [...names].filter((n) => ENGINE_SIBLINGS.has(n) && n !== slice.verb);
    if (siblings.length < 2) return;
    if (!isEngineVerbShape(target, names, opts)) return;
    const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;
    doubles.push({ line, siblings: siblings.sort(), pinned: bodyIsPinned(target) });
  };

  const visit = (n) => {
    if (ts.isObjectLiteralExpression(n)) consider(n.properties, n);
    else if (ts.isClassDeclaration(n) || ts.isClassExpression(n)) consider(n.members, n);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return doubles;
}

// ════════════════════════════════════════════════════════════════════════════
// THE UNRECOGNISED CENSUS (#9747) -- the third verdict, printed and never fatal
// ════════════════════════════════════════════════════════════════════════════
//
// The four invariants above answer "is the discovered population guarded".
// DISCOVERED answers "is the population non-empty". Neither can answer the
// question #9747 measured across nine instances in this repo:
//
//   > how many constructs did this gate SEE and fail to understand?
//
// A construct the recognizer cannot read is in NEITHER half of the ledger. It
// is not pinned, it is not baselined, it is not exempt -- it is absent, and
// absence reads to every consumer of this script's output as "clean". That is
// #8639's shape exactly (a `vi.fn(fn)` initializer the unwrap did not read),
// and #8639 was found by luck rather than by this gate saying anything.
//
// ## What this section is NOT
//
// ⛔ It does not widen discovery by one construct. `scanSource` is untouched
// and this census cannot reach it: the two walks share no state, so no count
// here can move a double into or out of the pinned population. Widening the
// matcher has been separately priced and separately DECLINED (#8845, #9165's
// 2b), and this card's own scoping says so. Counting is the whole act.
//
// ⛔ It never fails a run. Per the 2026-08-18 ruling on #9747 the third state
// is VISIBILITY ONLY: no new required context, no new merge-blocking failure.
//
// ## Why not `exit 2`, when the in-tree prior art uses `exit 2`
//
// Four places in this repo already spell a third state -- `check-where-matcher-
// conformance` (missing baseline => `exit 2`, explicitly distinct from a
// finding's `exit 1`), `check-published-readme-exports` (hard refusal),
// `check-governed-merges`' header ("non-zero exits classify the ENVIRONMENT,
// not the tree"), and the drift guard added by #9700. Every one of them exits
// non-zero because the gate is REFUSING TO RUN: the environment is broken and
// no verdict about the tree is available.
//
// This verdict is the opposite. The run completed, every invariant was
// evaluated, and the count is an observation ABOUT the run. Spelling it
// `exit 2` would make it a failing CI job, which is precisely what the ruling
// forbids. So it matches the convention where the convention is about
// SEMANTICS -- a named third state, distinct from both "clean" and "finding",
// printed rather than inferred -- and deliberately not where the convention is
// about the exit code. The line carries a stable, greppable prefix
// (`UNRECOGNISED [<gate>]:`) so a round report can pick it up without a new
// merge-blocking context existing anywhere.
//
// ## SCOPED-OUT is not UNRECOGNISED, and the difference is the whole point
//
// #8662 is the instance that sharpens this: `check-where-matcher-conformance`
// drops inverted survivor filters as OUT_OF_SCOPE **correctly, by its own
// definition**, and that correct verdict still reads as "nothing to see". A
// census that folded those into "unrecognised" would report noise on day one
// and discredit the direction. So the two are counted apart:
//
//   SCOPED OUT    the gate has a STATED criterion that excludes this construct
//                 and the criterion is right. `delete: vi.fn()` carries no
//                 implementation at all, so there is no behaviour that could be
//                 looser than `ObjectQL.delete` -- `unwrapCallImpl`'s own
//                 census argues exactly this. Reported as a number only.
//
//   UNRECOGNISED  an implementation demonstrably EXISTS and this gate cannot
//                 reach it: the initializer carries a function the unwrap
//                 declined, or it roots at a binding this file declares whose
//                 value the recogniser cannot resolve. Each one is a double
//                 that could be looser than the producer and is in no ledger.
//                 Reported by file, line and spelling.
//
// The membership of the second bucket is not fixed, and it MOVES when the
// recogniser learns a spelling: #9877 took the `??` default out of it and
// #10175 took the bare local binding and the shorthand -- 21 constructs, the
// whole census on the tree that card was measured against. That is the
// direction this section exists to produce. What must never happen is a
// construct leaving this census WITHOUT entering the population, so every
// migration is asserted from both sides in the self-test.
//
// The discriminator is structural, never an allowlist of callee names -- the
// same choice `unwrapCallImpl` documents, and for the same reason: an
// allowlist goes silently blind the day someone writes a new wrapper.

/** Short, single-line echo of a construct, for the census rows. */
function censusSnippet(node, sf) {
  return node.getText(sf).replace(/\s+/g, ' ').slice(0, 96);
}

/** Every identifier this file itself declares (functions, consts, lets). */
function declaredBindings(sf) {
  const names = new Set();
  const visit = (n) => {
    if (ts.isFunctionDeclaration(n) && n.name) names.add(n.name.text);
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name)) names.add(n.name.text);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return names;
}

/**
 * One file's unrecognised / scoped-out constructs for one slice.
 *
 * The population it walks is the same structural evidence discovery uses -- a
 * construct declaring the slice's verb alongside at least two engine siblings
 * -- so a row here is never something the gate had no business reading. What
 * separates it from `scanSource` is the single step where discovery stops:
 * `implOf` answered null, so `isEngineVerbShape` was never asked and the
 * construct left the population without any verdict being recorded.
 */
function censusSource(fileName, text, slice) {
  const sf = parseSourceFile(fileName, text);
  const declared = declaredBindings(sf);
  const unrecognised = [];
  const scopedOut = [];

  const consider = (members, node) => {
    const names = new Set();
    let member = null;
    for (const m of members) {
      const n = memberName(m);
      if (n) names.add(n);
      // `memberName` reads a shorthand's identifier too, so `{ update }` lands
      // here as a declaration of the verb -- which is what we want.
      if (n === slice.verb) member = m;
    }
    if (!member) return;
    const siblings = [...names].filter((n) => ENGINE_SIBLINGS.has(n) && n !== slice.verb);
    if (siblings.length < 2) return;
    if (implOf(member)) return;                 // discovery read it -- in the population
    const line = sf.getLineAndCharacterOfPosition(member.getStart(sf)).line + 1;
    const row = { line, text: censusSnippet(member, sf) };

    if (ts.isShorthandPropertyAssignment(member)) {
      unrecognised.push({ ...row, why: 'shorthand -- the implementation is a binding elsewhere in scope' });
      return;
    }
    const init = (ts.isPropertyAssignment(member) || ts.isPropertyDeclaration(member))
      ? member.initializer : null;
    if (!init) {
      scopedOut.push({ ...row, why: 'declaration only (a signature or an abstract member): no body exists' });
      return;
    }
    let carriesFn = false;
    const scan = (n) => {
      if (ts.isFunctionExpression(n) || ts.isArrowFunction(n)) carriesFn = true;
      ts.forEachChild(n, scan);
    };
    scan(init);
    if (carriesFn) {
      unrecognised.push({ ...row, why: 'the initializer carries a function this gate declined to unwrap' });
      return;
    }
    let root = init;
    while (ts.isCallExpression(root) || ts.isPropertyAccessExpression(root)) root = root.expression;
    if (ts.isIdentifier(root) && declared.has(root.text)) {
      unrecognised.push({ ...row, why: `the initializer roots at \`${root.text}\`, which this file declares` });
      return;
    }
    scopedOut.push({ ...row, why: 'no implementation anywhere (a bare mock or a value), so nothing can be looser than the producer' });
  };

  const visit = (n) => {
    if (ts.isObjectLiteralExpression(n)) consider(n.properties, n);
    else if (ts.isClassDeclaration(n) || ts.isClassExpression(n)) consider(n.members, n);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return { unrecognised, scopedOut };
}

/** The census across every scanned file and every slice. */
function censusUnrecognised() {
  const rows = [];
  let scopedOut = 0;
  for (const abs of testFiles()) {
    const rel = relative(ROOT, abs).split(sep).join('/');
    const text = readFileSync(abs, 'utf8');
    for (const slice of SLICES) {
      if (!mentionsVerb(text, slice.verb)) continue;
      const c = censusSource(abs, text, slice);
      scopedOut += c.scopedOut.length;
      for (const u of c.unrecognised) rows.push({ verb: slice.verb, file: rel, ...u });
    }
  }
  rows.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file < b.file ? -1 : 1));
  return { rows, scopedOut };
}

// ════════════════════════════════════════════════════════════════════════════
// THE RECOGNIZER CENSUS (#9943) -- `--census`, the gate's own walk, printed
// ════════════════════════════════════════════════════════════════════════════
//
// Every figure this file's prose used to carry about its own corpus was a
// CONSTANT: `310` CallExpression members, `250 doubles this gate discovers`,
// `82 PINNED`, and two spellings "measured at ZERO". Nothing regenerated any of
// them, so nothing could catch them drifting, and by 2026-08-19 (#9943) they
// had -- `250` had roughly doubled and `82` had roughly quadrupled. Refreshing
// the constants would reproduce the defect with newer values (#9803 / PR
// #9909); the answer is to stop writing them down.
//
// So this mode exists, and the prose above points at it instead of quoting
// itself. It is the GATE'S OWN walk -- `implOf`, `unwrapCallImpl`,
// `fnInitializer`, `isEngineVerbShape`, the same functions the verdict uses --
// so its numbers cannot disagree with the criterion the way a hand-written
// re-scan can. #9943 recorded that a hand copy of the criterion read 341 where
// the comment said 310 and could not say which of the two was wrong. This mode
// removes the question.
//
// ⛔ It reaches no verdict and changes no exit code. `--census` is a separate
// invocation; `report()` does not call it.
//
// ## Why the POPULATION is by initializer kind, and this is the #9877 lesson
//
// The doc census was scoped to "every delete/update member whose initializer is
// a CallExpression" -- i.e. to the shape `unwrapCallImpl` already reads. A
// census of what the matcher already matches cannot report the matcher's blind
// spots however carefully it is re-run: #9877's defaulted initializer
// (`overrides.delete ?? vi.fn(fn)`) is a BinaryExpression, so it was never in
// that population at all, and neither was the shorthand or the bare local
// binding. Both spellings the old note listed as "measured at ZERO" are
// CallExpression spellings -- the census could only ever have found more of
// what it already understood.
//
// This one buckets EVERY member first, by initializer kind, and prints how many
// of each kind the recognizer can read. A spelling the gate is blind to shows
// up as a row with a low read-rate rather than as silence.

/** The initializer bucket a member falls in, for the census rows. */
function initializerKind(member) {
  if (ts.isMethodDeclaration(member) || ts.isMethodSignature(member)) return 'method body';
  if (ts.isShorthandPropertyAssignment(member)) return 'shorthand member';
  const init = (ts.isPropertyAssignment(member) || ts.isPropertyDeclaration(member))
    ? member.initializer : null;
  if (!init) return 'no initializer (signature or abstract)';
  if (ts.isFunctionExpression(init) || ts.isArrowFunction(init)) return 'function literal';
  if (ts.isCallExpression(init)) return 'CallExpression';
  if (ts.isBinaryExpression(init)) {
    const op = init.operatorToken.kind;
    if (op === ts.SyntaxKind.QuestionQuestionToken) return 'defaulted `??`';
    if (op === ts.SyntaxKind.BarBarToken) return 'defaulted `||`';
    return 'BinaryExpression (other operator)';
  }
  if (ts.isConditionalExpression(init)) return 'conditional `? :`';
  if (ts.isIdentifier(init)) return 'identifier (a binding elsewhere)';
  if (ts.isPropertyAccessExpression(init)) return 'property access';
  if (ts.isAsExpression(init) || ts.isParenthesizedExpression(init)) return 'parenthesised / `as`';
  return `other (${ts.SyntaxKind[init.kind]})`;
}

/** `vi.fn`, `vi.fn().mockResolvedValue`, `rec` -- the callee, whitespace-collapsed. */
function calleeSpelling(init, sf) {
  return init.expression.getText(sf).replace(/\s+/g, '');
}

/** How a CallExpression's argument list reads, for the callee buckets. */
function argShape(init) {
  const args = init.arguments ?? [];
  if (args.length === 0) return '()';
  const fns = args.filter((a) => ts.isFunctionExpression(a) || ts.isArrowFunction(a));
  if (args.length === 1) return fns.length === 1 ? '(fn)' : '(value)';
  return fns.length > 0 ? `(${args.length} args, ${fns.length} fn)` : `(${args.length} args)`;
}

/** Does a function literal sit in the RECEIVER chain, `vi.fn(fn).mockResolvedValue(v)`? */
function fnInChainedReceiver(init) {
  let recv = init.expression;
  while (recv) {
    if (ts.isCallExpression(recv) && unwrapCallImpl(recv)) return true;
    if (ts.isPropertyAccessExpression(recv) || ts.isCallExpression(recv)) recv = recv.expression;
    else return false;
  }
  return false;
}

/**
 * `Object.assign(base, { … })` sites that carry a scanned verb (#8553).
 *
 * The override literal is walked by `scanSource` like any other object literal,
 * so what decides whether it is COUNTED is the two-engine-sibling test: an
 * override literal typically carries only the one or two members it varies, and
 * inherits `find`/`insert`/`registry` from the base it is spread over. Fewer
 * than two siblings in the literal ITSELF, so `consider()` returns and the
 * override is accounted for by whatever the base was pinned or baselined as --
 * which is precisely #8553's question, and this row is the measurement of how
 * often the situation actually arises.
 */
function objectAssignSites(sf, verbs) {
  const sites = [];
  const visit = (n) => {
    if (
      ts.isCallExpression(n)
      && ts.isPropertyAccessExpression(n.expression)
      && ts.isIdentifier(n.expression.expression)
      && n.expression.expression.text === 'Object'
      && n.expression.name.text === 'assign'
    ) {
      for (const arg of n.arguments.slice(1)) {
        if (!ts.isObjectLiteralExpression(arg)) continue;
        const names = new Set();
        for (const m of arg.properties) {
          const nm = memberName(m);
          if (nm) names.add(nm);
        }
        const declaresVerb = [...verbs].filter((v) => names.has(v));
        const siblings = [...names].filter((x) => ENGINE_SIBLINGS.has(x) && !declaresVerb.includes(x));
        // Two different shapes, and only the first can hide a double this gate
        // would otherwise have judged:
        //   VERB   the override literal restates `delete`/`update` itself. If it
        //          carries fewer than two engine siblings of its own it is not
        //          counted, and its implementation is neither pinned nor
        //          baselined in its own right. This is #8553's hole proper.
        //   BASE   the override varies OTHER engine members (`find`, `insert`)
        //          and inherits the verb from the double it is spread over.
        //          Nothing about the verb changed, so the base's accounting is
        //          the right accounting -- the shape #8553 actually observed.
        if (declaresVerb.length === 0 && siblings.length === 0) continue;
        sites.push({
          line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1,
          shape: declaresVerb.length ? 'VERB' : 'BASE',
          verbs: declaresVerb.sort(),
          members: [...names].filter((x) => ENGINE_SIBLINGS.has(x)).sort(),
          siblings: siblings.length,
          counted: declaresVerb.length > 0 && siblings.length >= 2,
        });
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return sites;
}

/** The whole census, computed from the recognizer's own functions. */
function censusRecognizer() {
  const files = testFiles();
  const byKind = new Map();
  const byCallee = new Map();
  const notWidened = { severalArgs: 0, chainedReceiver: 0, conditionalArms: 0 };
  const assignSites = [];
  let members = 0;

  const bump = (map, key, read) => {
    const row = map.get(key) ?? { total: 0, read: 0 };
    row.total += 1;
    if (read) row.read += 1;
    map.set(key, row);
  };

  for (const abs of files) {
    const rel = relative(ROOT, abs).split(sep).join('/');
    const text = readFileSync(abs, 'utf8');
    if (![...SCANNED_VERBS].some((v) => mentionsVerb(text, v))) continue;
    const sf = parseSourceFile(abs, text);

    const consider = (props) => {
      for (const m of props) {
        const nm = memberName(m);
        if (!SCANNED_VERBS.has(nm)) continue;
        members += 1;
        const read = implOf(m) !== null;
        bump(byKind, initializerKind(m), read);
        const init = (ts.isPropertyAssignment(m) || ts.isPropertyDeclaration(m)) ? m.initializer : null;
        if (init && ts.isCallExpression(init)) {
          bump(byCallee, `${calleeSpelling(init, sf)}${argShape(init)}`, read);
          const args = init.arguments ?? [];
          if (args.length > 1 && args.some((a) => ts.isFunctionExpression(a) || ts.isArrowFunction(a))) {
            notWidened.severalArgs += 1;
          }
          if (fnInChainedReceiver(init)) notWidened.chainedReceiver += 1;
        }
        if (init && ts.isConditionalExpression(init)) {
          const arm = (x) => ts.isFunctionExpression(x) || ts.isArrowFunction(x) || unwrapCallImpl(x);
          if (arm(init.whenTrue) || arm(init.whenFalse)) notWidened.conditionalArms += 1;
        }
      }
    };

    const visit = (n) => {
      if (ts.isObjectLiteralExpression(n)) consider(n.properties);
      else if (ts.isClassDeclaration(n) || ts.isClassExpression(n)) consider(n.members);
      ts.forEachChild(n, visit);
    };
    visit(sf);

    for (const site of objectAssignSites(sf, SCANNED_VERBS)) assignSites.push({ file: rel, ...site });
  }

  // The REPOSITORY_ONLY_MEMBERS ablation: run discovery again with that veto
  // off and diff. The prose used to assert "the pair moves exactly 2, and 0 of
  // the PINNED doubles" as a constant; this recomputes it on today's corpus,
  // which is the only form of that claim worth having.
  const vetoed = [];
  for (const slice of SLICES) {
    for (const abs of files) {
      const rel = relative(ROOT, abs).split(sep).join('/');
      const text = readFileSync(abs, 'utf8');
      if (!mentionsVerb(text, slice.verb)) continue;
      const withVeto = scanSource(abs, text, slice);
      const without = scanSource(abs, text, slice, { skipRepositoryVeto: true });
      if (without.length === withVeto.length) continue;
      const kept = new Set(withVeto.map((d) => d.line));
      for (const d of without) {
        if (!kept.has(d.line)) vetoed.push({ verb: slice.verb, file: rel, line: d.line, pinned: d.pinned });
      }
    }
  }

  return { files: files.length, members, byKind, byCallee, notWidened, assignSites, vetoed };
}

function censusReport() {
  const c = censusRecognizer();
  const rows = (map) => [...map].sort((a, b) => b[1].total - a[1].total);
  const pad = (n) => String(n).padStart(5);

  console.log('');
  console.log(
    `CENSUS [engine-double-contract]: ${c.members} member(s) named ${[...SCANNED_VERBS].join('/')} on an `
      + `object literal or class body, across ${c.files} scanned test file(s) in ${SCAN_ROOTS.join(', ')}. `
      + 'Computed by this gate\'s own `implOf`, so it cannot disagree with the verdict. '
      + 'This mode reaches no verdict and never fails a run.',
  );

  console.log('\n  BY INITIALIZER KIND -- `read` is how many of them `implOf` can reach:');
  for (const [kind, r] of rows(c.byKind)) {
    console.log(`  ${pad(r.total)}  ${kind.padEnd(38)} read ${r.read}/${r.total}`);
  }

  console.log('\n  CallExpression initializers, by callee spelling:');
  for (const [callee, r] of rows(c.byCallee)) {
    console.log(`  ${pad(r.total)}  ${callee.padEnd(38)} read ${r.read}/${r.total}`);
  }

  console.log('\n  Spellings this criterion deliberately does NOT read:');
  console.log(`  ${pad(c.notWidened.severalArgs)}  a function among SEVERAL arguments      traced('delete', fn)`);
  console.log(`  ${pad(c.notWidened.chainedReceiver)}  a function in the chained receiver     vi.fn(fn).mockResolvedValue(v)`);
  console.log(`  ${pad(c.notWidened.conditionalArms)}  a conditional's arms                   cond ? a : b`);

  const verbSites = c.assignSites.filter((x) => x.shape === 'VERB');
  const baseSites = c.assignSites.filter((x) => x.shape === 'BASE');
  console.log(
    `\n  Object.assign over an engine double (#8553): ${verbSites.length} override literal(s) restate a `
      + `scanned verb, ${baseSites.length} vary other engine members and inherit the verb:`,
  );
  for (const s of c.assignSites) {
    console.log(
      `  ${pad(s.siblings)}  [${s.shape}] ${s.file}:${s.line}  {${s.members.join(', ')}} -- `
        + `${s.counted ? 'COUNTED in its own right' : 'accounted for by its base'}`,
    );
  }

  console.log(
    `\n  REPOSITORY_ONLY_MEMBERS veto moves ${c.vetoed.length} construct(s); `
      + `${c.vetoed.filter((v) => v.pinned).length} of them pinned:`,
  );
  for (const v of c.vetoed) console.log(`         [${v.verb}] ${v.file}:${v.line}${v.pinned ? ' (pinned)' : ''}`);
  console.log('');
}

// ════════════════════════════════════════════════════════════════════════════
// THE CONSUMER SEAMS (#8194, from #8058's audited sweep)
// ════════════════════════════════════════════════════════════════════════════
//
// Everything above judges TEST DOUBLES. This section judges PRODUCTION code,
// and it is a different subject reached by the same reasoning, so it is walled
// off rather than folded into SLICES: a slice's verdict is "is this fake looser
// than the producer", a seam's is "does this consumer answer a receipt it
// cannot prove".
//
// ## Why the subject is the seam and not the double (the measurement)
//
// #8058 audited every data-access double in `packages/objectql/src` -- 154
// doubles, 24,385 instrumented calls -- and found ZERO that took a by-id write
// their own read side denied. What it did find is that 37 doubles in that one
// package statically carry a read side that denies every row, and every one of
// them is CORRECT: they simply never take a by-id write. So the obvious gate
// over doubles ("read side unconditionally empty") would open with a 37-entry
// exemption ledger in one package, which is the failure this file's own header
// names -- a gate that reddens correct code and can only be digested through
// its ledger grows the ledger into noise.
//
// The subject that IS decidable is the consumer. #8194 inverts it: rather than
// ask which double could be handed a by-id write, ask which CONSUMER performs
// one and then tells its caller the write landed.
//
// ## What "every consumer performing a by-id write probes first" measured to be
//
// FALSE, and the numbers are the reason this scan carries three conjuncts
// instead of one. Measured on the tree this landed against:
//
//   45  by-id writes in production sources (`update`/`delete` carrying a
//       scalar `where.id`), in 23 files
//   ~40 of them correctly perform NO existence probe of their own
//
// Because #7867/#7989 put the gate at the funnel: `ObjectQL.update` and
// `.delete` read the prior row UNCONDITIONALLY on their by-id branch and throw
// `recordNotFoundError` when it is missing -- engine.ts says so in as many
// words ("placed at the one point all of them funnel through, so it is not a
// fourth site"). Every consumer that reaches the engine is therefore already
// refused, and a gate demanding a second probe from each of them would redden
// ~40 correct call sites -- the same 37-false-positive shape, one layer out.
//
// A `sql-http-outbox.ack(id)` or a `db-queue-adapter.purgeFailed(messageId)`
// deletes by an id it was handed and returns nothing; there is no receipt for
// it to get wrong, and the engine refuses the ghost id anyway. Those are not
// seams and this scan must not report them.
//
// ## The three conjuncts, and what each one removes
//
// A SEAM is a function that does all three. Dropping any one of them puts
// correct code in the report (the count after each is what the tree measured):
//
//   1. performs a BY-ID WRITE                                         45 sites
//      `<x>.update|delete(…)` carrying a scalar `where: { id }` -- inline, or
//      through a same-function `const` binding (`protocol.updateData` and
//      `deleteData` both build `const opts = { where: { id: request.id } }`
//      and pass the variable, so a scan reading only inline literals misses
//      the card's own named seam), or through one wrapping helper call
//      (`callData`'s `findOpts({ where: { id } })`).
//      `where: { id: { $in: […] } }` is a MULTI-ROW predicate and is not a
//      by-id write -- the same line `ObjectQL` itself draws.
//
//   2. on a CALLER-SUPPLIED id                                        16 sites
//      the id expression's root is a parameter of the enclosing function, or a
//      property of one (`request.id`, `params.id`). An id read off a row this
//      function just fetched (`row.id`, `existing.id`) cannot name a missing
//      record -- it came from one. This conjunct removes 29 sites, and it is
//      the one that keeps `reassignOrphanedMetadata` and `rebuildApproverIndex`
//      out: both answer a receipt, both write by an id they just read.
//
//   3. and ANSWERS A RECEIPT                                           4 sites
//      returns an object literal carrying `success` / `record` / `deleted` /
//      `updated` / `removed`. This is the harm: an integrator reading a success
//      body records the change as landed. A function returning nothing cannot
//      commit that error however missing the row was.
//
// A handful of seams, zero exemptions and no DEBT ledger -- which is the whole
// reason this invariant is worth having and the per-double one was not. The
// live count is deliberately not written here: `--write` keeps the population
// in `engine-double-contract.seams.json` and every run prints it, because every
// figure this file's prose once carried about its own corpus drifted unnoticed
// (#9943). ⚠️ That population ledger (#9708, below) is not an exemption ledger
// and reads the opposite way to the DEBT baseline: it records WHICH seams
// exist, never that any of them is accepted as looser than this invariant asks.
//
// ## What the seams must reach, and why it is REFUSAL rather than "probe"
//
// The four seams do NOT share a mechanism, and a gate demanding the one they
// happen to share most often would redden correct code:
//
//   `protocol.updateData`   probes (`probeRecord`, #4435) -- and shares the
//                           read with its OCC gate rather than issuing two
//   `protocol.deleteData`   reads the DRIVER's `Promise<boolean>` (`=== false`
//                           is the contract's own positive not-found signal)
//   `callData`'s fallback   probes with a `find` (#5138)
//   the MCP stdio bridge    probes with `findById`
//
// So the assertion is mechanism-agnostic: before the receipt is answered, the
// function must REFUSE -- throw, on a guarded not-found path. How it learned
// the row is missing is the consumer's business; that it answers a receipt
// instead is not. This is the same contract-first shape as the slices above:
// pin the decision that must be reached, not the spelling of the road to it.
//
// ## What this deliberately does NOT claim, and the one over-approximation
//
// The refusal test is FUNCTION-WIDE: it asks whether a throw that reaches a
// not-found envelope sits before the receipt, not whether it guards this
// verb's branch specifically. `callData` is the shape that makes the
// difference visible — one function, an update fallback and a delete fallback,
// each with its own probe — so a refusal in one branch is credited to the
// other. Narrowing it would need per-branch reachability, which is the whole-
// suite dataflow #8194 excluded on the double side for the same reason.
//
// What that costs is bounded and worth naming: this gate cannot catch a seam
// that refuses on ONE of its verbs and answers blind on the other. What it does
// catch — a receipt-answering by-id write with no refusal anywhere before it —
// is the shape every instance of this defect family actually took (#4435,
// #5138, #5581, #7867). A narrower gate that could not be written is not a
// better gate than a wide one that can.
//
// ## WHICH not-found envelope (#8194, tightened to SHARED_ONLY by #8422)
//
// #8194 measured all four seams and found three reaching `recordNotFoundError`
// -- the repo's ONE not-found envelope (`@objectstack/core`, moved there by
// #7867 for exactly the "two layers cannot disagree about it" reason its
// header argues) -- while the fourth, `packages/mcp/src/stdio-data-bridge.ts`,
// minted its own local `recordNotFound` returning a bare `Error` with neither
// `code` nor `status`.
//
// That was a real divergence and #8194 filed it as its own card rather than
// laundering it through a ledger entry here: opening this gate RED on a
// defect outside the change that introduced it would have taught readers that
// a red run means "someone else's problem". So the verdict recorded WHICH
// envelope each seam reached and printed it, with `refusal: 'local'` as the
// visible-but-not-failing state -- deliberately not `!x.refusal` (that already
// failed) and not silence either.
//
// #8422 fixed the fourth seam, so all four now reach the shared envelope --
// the SHARED_ONLY tightening below is that one-line change, made the day the
// seam list actually went both-directions complete. `refusal !== 'shared'`
// now fails on EITHER a local mint or no refusal at all: a future fifth seam
// that reinvents the envelope reddens here instead of shipping unnoticed.
//
// ## The POPULATION is ratcheted (#9708), and what deciding that cost
//
// Everything above judges the seams the scan DISCOVERS. Until #9708 nothing
// judged the discovery itself except `SEAMS_DISCOVERED`, which fires at ZERO
// and never at one-fewer-than-yesterday -- and `REFUSES` iterates the
// discovered set, so a seam that LEAVES the set is judged by nothing at all.
// Measured by ablation: deleting the whole `remove()` seam from
// `packages/mcp/src/stdio-data-bridge.ts` took the census down by one and left
// this script printing OK, exit 0. That is #9680's blind spot exactly, one
// population over.
//
// The card refused to inherit #9680's answer by reflex, so "should a vanished
// seam be an error, a ledger row, or a distinct verdict" was decided on a
// MEASUREMENT rather than a preference. This file's own `scanAllSeams`,
// unmodified, was replayed over 58 daily trees of `origin/main` -- one commit
// per day, 2026-06-25 through 2026-08-21:
//
//    3  MEMBERSHIP changes in 58 days: 2026-06-28 the protocol seams moved
//       package (objectql -> metadata-protocol); 2026-07-27 `callData` moved
//       file (http-dispatcher.ts -> action-execution.ts); 2026-08-12 the MCP
//       stdio bridge ARRIVED, +2 seams
//    2  further changes were refusal-state transitions (local -> shared), which
//       SHARED_ONLY already governs and this ledger deliberately does not
//    0  outright departures: every row that left a key reappeared under another
//       one in the same sample, so no seam has yet left the population
//
// One event a fortnight, and a legitimate one costs a single `--write` commit.
// Against that, the loss it closes is a site of the #4435/#5138/#5581/#7867
// family -- four SHIPPED instances of a receipt answered for a write that
// touched zero rows -- silently ceasing to be judged. Cheap ratchet, expensive
// miss, so it is built rather than left as a printed integer.
//
// What that buys, beyond the ablation the card measured: the ledger is also the
// scan's ANCHOR. `SEAMS_DISCOVERED` only notices a scan that breaks COMPLETELY;
// a scan that drifts off one seam -- the shape a rename or a two-hop options
// build produces -- keeps the other rows and passes it. The ledger names each
// row, so partial drift reddens with the row's own identity in the message.
//
// ⚠️ What this does NOT do is widen the population BEYOND the roots the rest
// of this file already reads, and the scope is worth stating because a census
// scoped by the wrong instrument holds a blind spot no amount of re-running
// finds (#8999). `productionFiles()` used to walk `packages/` only while the
// DOUBLE side walked `SCAN_ROOTS` (`packages`, `examples`); measured
// 2026-08-21 with the walk widened to `examples`, `apps`, `skills` and
// `scripts`, that asymmetry cost the SAME rows, zero extra -- a controlled
// zero, since the widened walk still found all of the known ones rather than
// silently returning nothing. Filed as #10496 and CLOSED there by taking the
// asymmetry out: both scans now read `SCAN_ROOTS`, so one constant governs
// which roots this gate reads. The reading above is left as the dated
// measurement it was; `productionFiles()` carries the re-measurement on this
// branch and the planted-seam positive control that makes its zero mean
// something. Why it was worth doing for zero rows: a seam landing in an
// example app tomorrow was outside this population and therefore outside its
// ledger too, so neither half would have reported it.

/** Where the repo's ONE not-found envelope may be imported from (#7867). */
const ENVELOPE_MODULES = [
  /^@objectstack\/core$/,
  /^@objectstack\/metadata-protocol$/,
  /record-not-found(\.js)?$/,
];

/** The envelope factory itself. */
const ENVELOPE_SYMBOLS = new Set(['recordNotFoundError']);

/**
 * Keys whose presence in a returned object literal makes it a RECEIPT — a
 * statement to the caller about what the write did.
 *
 * Taken from the shapes the spec actually declares for these responses:
 * `DeleteDataResponseSchema` is `{ object, id, success }` (#5581) and
 * `UpdateDataResponse` carries `record`. `deleted` / `updated` / `removed` are
 * the off-spec spellings the same defect family produced before #5581 named
 * one, kept so a consumer re-inventing them is still judged.
 */
const RECEIPT_KEYS = new Set(['success', 'record', 'deleted', 'updated', 'removed']);

/**
 * The verbs the seam scan reads.
 *
 * Named rather than spelled inline in `scanSeams` because the seam ledger
 * (#9708) has to reject an entry naming a verb this scan never reaches -- such
 * a row can never lose its seam, so it would record a population nothing
 * checks. That check and the scan must read ONE constant or they can disagree.
 * It is deliberately its own set and not `SCANNED_VERBS`: that one is derived
 * from `SLICES`, which is the TEST DOUBLE side, and the two populations are
 * free to diverge.
 */
const SEAM_VERBS = new Set(['update', 'delete']);

/**
 * Production sources: the seams live in `src`, never in a test.
 *
 * Walks `SCAN_ROOTS` -- the SAME constant the TEST DOUBLE side walks (#10496).
 * It used to walk `packages/` alone, and nothing anywhere stated the narrower
 * scope as a decision: the stated scope test is the sentence above, which
 * `examples/` satisfies exactly as much as `packages/` does. An example app
 * performing a by-id write on a caller-supplied id and answering a success
 * receipt is the three-conjunct seam this invariant is about, and it would have
 * been judged by nothing -- and since #9708's ledger is keyed on the rows THIS
 * walk discovers, it would have been outside the ledger too, so neither half
 * would have reported it.
 *
 * ## What widening bought TODAY: nothing, and that is the point
 *
 * Re-measured on this branch (the numbers in the CONSUMER SEAMS header above
 * were taken before #10573 and are left as the dated reading they were):
 *
 *     narrow (packages only)                     6 seams in 3 files
 *     wide   (SCAN_ROOTS = packages, examples)   6 seams in 3 files
 *     rows the wider walk adds                   []
 *
 * ⛔ A zero is worth nothing without a POSITIVE CONTROL, because a walk that
 * silently stopped working returns the same zero. Two were run, and the second
 * is the one that matters: the wide walk still returns all six known rows (so
 * it did not stop walking `packages/`), AND a synthetic seam planted at
 * `examples/app-showcase/src/os-10496-seam-control.ts` -- a by-id update on a
 * caller-supplied id answering `{ success: true }` -- was discovered by the
 * wide walk (7 seams in 4 files, the new row reported `[NONE]`) and NOT by the
 * narrow one (6 in 3, no row), then removed.
 * Without that limb "zero extra rows" and "never looked at `examples/`" are the
 * same reading.
 *
 * So this is not a fix for a live defect. It removes an unexplained asymmetry
 * between two scans in one file, at a measured cost of zero rows, and puts the
 * next example app's write seam inside the population instead of outside it.
 */
function productionFiles() {
  const out = [];
  const walkSrc = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name === 'dist' || e.name === '.git' || e.name === '.cache') continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) walkSrc(p);
      else if (/\.(ts|tsx|mts)$/.test(e.name) && !/\.(test|spec|bench)\.(ts|tsx|mts)$/.test(e.name)) out.push(p);
    }
  };
  for (const r of SCAN_ROOTS) walkSrc(join(ROOT, r));
  return out.sort();
}

function objectLiteral(n) {
  return n && ts.isObjectLiteralExpression(n) ? n : null;
}

/** A named property of an object literal, or null. */
function propertyNamed(obj, name) {
  for (const p of obj.properties) {
    if (!p.name) continue;
    const nm = ts.isIdentifier(p.name) || ts.isStringLiteral(p.name) ? p.name.text : null;
    if (nm === name) return p;
  }
  return null;
}

/**
 * The id expression of a SCALAR `where: { id: … }`, or null.
 *
 * `{ $in: [...] }` and an array both answer null: those are multi-row
 * predicates, and a predicate write matching zero rows is legitimately
 * "0 rows affected" rather than a missing record — the line `ObjectQL.delete`
 * itself draws, quoted in engine.ts ("Scope: the BY-ID branch only").
 */
function scalarWhereIdOf(obj) {
  const w = propertyNamed(obj, 'where');
  if (!w || !ts.isPropertyAssignment(w)) return null;
  const wo = objectLiteral(w.initializer);
  if (!wo) return null;
  const idp = propertyNamed(wo, 'id');
  if (!idp) return null;
  if (ts.isShorthandPropertyAssignment(idp)) return idp.name;
  if (!ts.isPropertyAssignment(idp)) return null;
  const init = idp.initializer;
  if (ts.isObjectLiteralExpression(init) || ts.isArrayLiteralExpression(init)) return null;
  return init;
}

/** The nearest enclosing function-ish node, or null. */
function enclosingFunction(node) {
  let cur = node.parent;
  while (cur) {
    if (ts.isFunctionDeclaration(cur) || ts.isMethodDeclaration(cur)
      || ts.isArrowFunction(cur) || ts.isFunctionExpression(cur)) return cur;
    cur = cur.parent;
  }
  return null;
}

/** Every parameter name of `fn`, including the members of a destructured one. */
function parameterNames(fn) {
  const names = new Set();
  for (const p of fn.parameters ?? []) {
    if (ts.isIdentifier(p.name)) names.add(p.name.text);
    else if (ts.isObjectBindingPattern(p.name)) {
      for (const el of p.name.elements) if (ts.isIdentifier(el.name)) names.add(el.name.text);
    }
  }
  return names;
}

/**
 * `const <name> = { where: { id: … } }` bindings inside `fn`.
 *
 * Required, not a nicety: `protocol.updateData` and `protocol.deleteData` —
 * the seam this card is named after — both build their options into a variable
 * and pass the variable, so a scan reading only inline literals discovers
 * neither and reports a green tree it never looked at.
 */
function localWhereIdBindings(fn) {
  const map = new Map();
  const visit = (n) => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) {
      const o = objectLiteral(n.initializer);
      if (o) {
        const id = scalarWhereIdOf(o);
        if (id) map.set(n.name.text, id);
      }
    }
    ts.forEachChild(n, visit);
  };
  if (fn.body) visit(fn.body);
  return map;
}

/** The root identifier of an expression: `request.id` → `request`. */
function rootIdentifier(expr) {
  let cur = expr;
  for (;;) {
    if (ts.isPropertyAccessExpression(cur)) { cur = cur.expression; continue; }
    if (ts.isElementAccessExpression(cur)) { cur = cur.expression; continue; }
    if (ts.isNonNullExpression(cur) || ts.isParenthesizedExpression(cur)) { cur = cur.expression; continue; }
    if (ts.isAsExpression(cur)) { cur = cur.expression; continue; }
    break;
  }
  return ts.isIdentifier(cur) ? cur.text : null;
}

/**
 * Which not-found envelope a `throw` reaches: the shared factory, a local mint,
 * or nothing.
 *
 * One helper deep, exactly as the slices' `bodyIsPinned` is, and for the same
 * reason: `protocol.updateData`'s sibling ingresses refuse through
 * `this.assertRecordExists(object, id)`, which is a method rather than an
 * import. Two hops is not accepted — at that point the gate would be guessing.
 */
function refusalKindOf(fn, sf, envelopeNames, localFns, methodFns) {
  let kind = null;
  const reaches = (node, depth) => {
    let hit = null;
    const visit = (n) => {
      if (hit === 'shared') return;
      if (ts.isCallExpression(n)) {
        const e = n.expression;
        if (ts.isIdentifier(e) && envelopeNames.has(e.text)) { hit = 'shared'; return; }
        if (ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.name)
          && envelopeNames.has(e.name.text)) { hit = 'shared'; return; }
        if (depth > 0) {
          const name = ts.isIdentifier(e) ? e.text
            : (ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.name) ? e.name.text : null);
          const helper = name ? (localFns.get(name) ?? methodFns.get(name)) : null;
          if (helper) {
            const deeper = reaches(helper, depth - 1);
            if (deeper === 'shared') { hit = 'shared'; return; }
            if (deeper && !hit) hit = deeper;
          }
        }
        if (!hit) hit = 'local';
        return;
      }
      if (ts.isNewExpression(n) && ts.isIdentifier(n.expression) && /Error$/.test(n.expression.text)) {
        if (!hit) hit = 'local';
        return;
      }
      ts.forEachChild(n, visit);
    };
    visit(node);
    return hit;
  };

  /** Does this function body throw a not-found DIRECTLY? */
  const throwsDirectly = (node) => {
    let k = null;
    const visit = (n) => {
      if (k === 'shared') return;
      if (ts.isThrowStatement(n) && n.expression) {
        const got = reaches(n.expression, 0);
        if (got === 'shared') { k = 'shared'; return; }
        if (got && !k) k = got;
      }
      ts.forEachChild(n, visit);
    };
    visit(node);
    return k;
  };

  let earliest = Infinity;
  const note = (k, pos) => {
    if (!k) return;
    if (k === 'shared' || !kind) kind = kind === 'shared' ? 'shared' : k;
    earliest = Math.min(earliest, pos);
  };

  const walk = (n) => {
    // A throw in the seam's own body.
    if (ts.isThrowStatement(n) && n.expression) note(reaches(n.expression, 1), n.getStart(sf));
    // Or ONE hop: a call to a same-file helper that throws the not-found
    // itself. `protocol`'s siblings refuse through
    // `this.assertRecordExists(object, id)`, whose throw never appears in the
    // seam at all — a scan reading only the seam's own `throw` statements
    // would call that seam unrefusing and redden correct code.
    if (ts.isCallExpression(n)) {
      const e = n.expression;
      const name = ts.isIdentifier(e) ? e.text
        : (ts.isPropertyAccessExpression(e) && ts.isIdentifier(e.name) ? e.name.text : null);
      const helper = name ? (localFns.get(name) ?? methodFns.get(name)) : null;
      if (helper && helper !== fn && helper.body) note(throwsDirectly(helper.body), n.getStart(sf));
    }
    ts.forEachChild(n, walk);
  };
  if (fn.body) walk(fn.body);
  return { kind, at: earliest };
}

/** The position of the LAST receipt-shaped `return` in `fn`, or -1. */
function receiptReturnPos(fn, sf) {
  let pos = -1;
  const visit = (n) => {
    if (ts.isReturnStatement(n) && n.expression) {
      const o = objectLiteral(n.expression);
      if (o) {
        for (const p of o.properties) {
          if (!p.name) continue;
          const nm = ts.isIdentifier(p.name) || ts.isStringLiteral(p.name) ? p.name.text : null;
          if (nm && RECEIPT_KEYS.has(nm)) { pos = Math.max(pos, n.getStart(sf)); break; }
        }
      }
    }
    ts.forEachChild(n, visit);
  };
  if (fn.body) visit(fn.body);
  return pos;
}

/** Class methods of this file, by name — for the `this.assertRecordExists` hop. */
function classMethods(sourceFile) {
  const map = new Map();
  const visit = (n) => {
    if ((ts.isClassDeclaration(n) || ts.isClassExpression(n))) {
      for (const m of n.members) {
        if (ts.isMethodDeclaration(m) && m.name && ts.isIdentifier(m.name)) map.set(m.name.text, m);
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sourceFile);
  return map;
}

/** Local names bound to the shared envelope factory by an import. */
function envelopeImportsOf(sourceFile) {
  const found = new Set();
  for (const st of sourceFile.statements) {
    if (!ts.isImportDeclaration(st) || !ts.isStringLiteral(st.moduleSpecifier)) continue;
    if (!ENVELOPE_MODULES.some((re) => re.test(st.moduleSpecifier.text))) continue;
    const named = st.importClause?.namedBindings;
    if (named && ts.isNamedImports(named)) {
      for (const el of named.elements) {
        const imported = (el.propertyName ?? el.name).text;
        if (ENVELOPE_SYMBOLS.has(imported)) found.add(el.name.text);
      }
    }
  }
  return found;
}

/**
 * Every CONSUMER SEAM in one file, with a verdict on whether it refuses before
 * it answers.
 *
 * A seam is the three-conjunct object documented above: a by-id write, on a
 * caller-supplied id, in a function that answers a receipt.
 */
function scanSeams(fileName, text) {
  const sf = parseSourceFile(fileName, text, ts.ScriptKind.TS);
  const envelopeNames = envelopeImportsOf(sf);
  const localFns = localFunctions(sf);
  const methodFns = classMethods(sf);
  const seams = [];
  const seen = new Set();

  const visit = (n) => {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)
      && ts.isIdentifier(n.expression.name)) {
      const verb = n.expression.name.text;
      if (SEAM_VERBS.has(verb)) {
        const fn = enclosingFunction(n);
        if (fn) {
          const bindings = localWhereIdBindings(fn);
          let idExpr = null;
          for (const arg of n.arguments) {
            const direct = objectLiteral(arg);
            if (direct) { idExpr = scalarWhereIdOf(direct); if (idExpr) break; }
            // A same-function `const opts = { where: { id } }`, passed by name.
            if (ts.isIdentifier(arg) && bindings.has(arg.text)) { idExpr = bindings.get(arg.text); break; }
            // One wrapping helper call: `findOpts({ where: { id } })`.
            if (ts.isCallExpression(arg)) {
              for (const a of arg.arguments) {
                const o = objectLiteral(a);
                if (o) { const got = scalarWhereIdOf(o); if (got) { idExpr = got; break; } }
              }
              if (idExpr) break;
            }
          }
          if (idExpr) {
            const root = rootIdentifier(idExpr);
            const params = parameterNames(fn);
            if (root && params.has(root)) {
              const receiptAt = receiptReturnPos(fn, sf);
              if (receiptAt >= 0) {
                // Keyed on (function, VERB), not on the function alone:
                // `callData` is one function holding both the update and the
                // delete fallback, and a per-function key reports only
                // whichever the walk reached first. The refusal test below is
                // still function-wide — see the header's note on what that
                // over-approximates.
                const fnStart = `${fn.getStart(sf)}:${verb}`;
                if (!seen.has(fnStart)) {
                  seen.add(fnStart);
                  const { kind, at } = refusalKindOf(fn, sf, envelopeNames, localFns, methodFns);
                  const name = fn.name && ts.isIdentifier(fn.name) ? fn.name.text : '<anonymous>';
                  seams.push({
                    line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1,
                    fn: name,
                    verb,
                    // A refusal AFTER the receipt is no refusal: the caller has
                    // already been told the write landed.
                    refusal: kind && at < receiptAt ? kind : null,
                  });
                }
              }
            }
          }
        }
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return seams;
}

/** The seam scan over the whole tree. */
function scanAllSeams() {
  const found = [];
  for (const abs of productionFiles()) {
    const text = readFileSync(abs, 'utf8');
    // Cheap pre-filter: no by-id options shape anywhere, nothing to parse.
    if (!/where\s*:\s*\{\s*id/.test(text)) continue;
    const seams = scanSeams(abs, text);
    if (seams.length === 0) continue;
    found.push({ file: relative(ROOT, abs).split(sep).join('/'), seams });
  }
  return found;
}

// ── The SEAM POPULATION ledger (#9708) ──────────────────────────────────────
//
// Why the population is ratcheted at all, the 58-day measurement that chose
// this shape over a bare verdict, and what it deliberately leaves outside are
// in the CONSUMER SEAMS header above. The mechanism here is #9680's, re-keyed
// for this population: rows carry identity, only `--write` moves them, and a
// row that disappears names itself instead of shrinking an integer.

/**
 * The (file, fn, verb) key for every map in this section.
 *
 * Keyed on the FUNCTION and not on the file alone, because `callData` is one
 * function holding both a by-id update and a by-id delete while
 * `stdio-data-bridge.ts` holds two different functions: a file-keyed ledger
 * could not separate "one of this file's two seams left" from "the file
 * changed shape". `JSON.stringify` of the triple for the reason `pairKey`
 * gives -- no separator to collide on.
 *
 * Deliberately NOT keyed on the LINE. A seam's line moves on every edit above
 * it, so a line-keyed ledger would demand a regeneration for changes that
 * touched no seam, and a ledger regenerated reflexively is a number nobody
 * reads -- the state this card exists to leave.
 */
const seamKey = (file, fn, verb) => JSON.stringify([file, fn, verb]);

/**
 * Every function-ish NAME a source file declares.
 *
 * Its whole job is to separate "the function was renamed or deleted" from "the
 * function is still there and the scan stopped reading it as a seam" -- two
 * losses that want opposite remedies, and the second is the blind spot this
 * ledger exists for.
 *
 * So it has to reach every shape a live seam actually takes, and they are not
 * all one shape: `callData` is a top-level `export async function`, while
 * `protocol.updateData`/`deleteData` and the MCP bridge's `update`/`remove`
 * are OBJECT LITERAL methods -- which neither `localFunctions` (top-level
 * bindings) nor `classMethods` (class bodies) sees. A walker missing them
 * would classify every loss as `function-removed`: the quieter story, told
 * about the louder defect. The self-test drives it against the real tree for
 * exactly that reason.
 */
function declaredFunctionNames(sourceFile) {
  const names = new Set();
  const nameText = (nm) => (nm && (ts.isIdentifier(nm) || ts.isStringLiteral(nm)) ? nm.text : null);
  const visit = (n) => {
    if (ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n)) {
      const nm = nameText(n.name);
      if (nm) names.add(nm);
    }
    if (ts.isPropertyAssignment(n) || ts.isPropertyDeclaration(n) || ts.isVariableDeclaration(n)) {
      const nm = nameText(n.name);
      if (nm && n.initializer
        && (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer))) names.add(nm);
    }
    ts.forEachChild(n, visit);
  };
  visit(sourceFile);
  return names;
}

/** The disk half of the above: does `file` still declare a function named `fn`? */
function fileDeclaresFunction(file, fn) {
  const abs = join(ROOT, file);
  if (!existsSync(abs)) return false;
  const sf = parseSourceFile(file, readFileSync(abs, 'utf8'), ts.ScriptKind.TS);
  return declaredFunctionNames(sf).has(fn);
}

/**
 * The discovered seam population as (file, fn, verb, seams) rows, sorted for a
 * stable diff.
 *
 * Counted per key rather than recorded as membership, for `censusPinned`'s
 * reason at this population's grain: two same-named functions in one file
 * (an object literal and a class, say) share a key, and membership alone could
 * not tell that one of them stopped being a seam.
 */
function censusSeams(seamFiles) {
  const counts = new Map();
  for (const { file, seams } of seamFiles) {
    for (const s of seams) {
      const k = seamKey(file, s.fn, s.verb);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
  }
  const rows = [...counts].map(([k, seams]) => {
    const [file, fn, verb] = JSON.parse(k);
    return { file, fn, verb, seams };
  });
  rows.sort((a, b) => (a.file !== b.file ? a.file.localeCompare(b.file)
    : a.fn !== b.fn ? a.fn.localeCompare(b.fn) : a.verb.localeCompare(b.verb)));
  return rows;
}

/**
 * The seam ledger. A missing file reads as empty so a fresh checkout
 * bootstraps through `--write` rather than crashing, exactly as `readBaseline`
 * and `readPinnedLedger` do.
 */
function readSeamLedger() {
  if (!existsSync(SEAM_LEDGER_PATH)) return { entries: [] };
  return JSON.parse(readFileSync(SEAM_LEDGER_PATH, 'utf8'));
}

/**
 * Which world a lost seam is in. A pure function so the self-test can drive
 * all four without a filesystem full of fixtures.
 *
 * Order matters: a file that is gone cannot also have "renamed a function", so
 * disk is asked first; then whether the function is declared at all, which is
 * the ordinary refactor; then whether the scan still reads ANY seam under that
 * name. That last split is the point of the whole classifier -- a function
 * that is still on disk under its own name and no longer discovered is the one
 * loss that may mean the scan drifted rather than the seam left.
 */
function classifySeamLoss({ onDisk, fnDeclared, discovered }) {
  if (!onDisk) return 'file-removed';
  if (!fnDeclared) return 'function-removed';
  if (discovered === 0) return 'unrecognised';
  return 'sites-removed';
}

const SEAM_REGEN = 'node scripts/check-engine-double-contract.mjs --write';

/**
 * SEAMS_RETAINED's errors, as a pure function of the census and the ledger.
 *
 * `onDisk` and `fnDeclared` are injected so the self-test can drive every loss
 * world without creating and deleting real files.
 */
function seamsRetainedErrors(census, ledger, ledgerExists, onDisk, fnDeclared) {
  const errors = [];

  // Bootstrap, for `retainedErrors`' reason: without it a missing artifact
  // reports one "not in the ledger" error per seam and buries the one-line fix.
  if (!ledgerExists) {
    return [
      `SEAMS_RETAINED: ${relative(ROOT, SEAM_LEDGER_PATH)} is missing. That file IS the consumer-seam `
        + 'population; without it this gate is back to printing an integer nobody compares, which is '
        + `the #9708 defect. Bootstrap it with \`${SEAM_REGEN}\` and commit it.`,
    ];
  }

  const found = new Map(census.map((r) => [seamKey(r.file, r.fn, r.verb), r.seams]));
  const recorded = new Map();

  for (const entry of ledger.entries ?? []) {
    if (!SEAM_VERBS.has(entry.verb)) {
      errors.push(
        `SEAMS_RETAINED: seam-ledger entry for ${entry.file} names verb ${JSON.stringify(entry.verb)}, `
          + `which the seam scan does not read (known: ${[...SEAM_VERBS].join(', ')}). An entry no scan `
          + 'reaches can never lose its seam, so it records a population that cannot be checked — fix '
          + 'the verb or delete the entry.',
      );
      continue;
    }
    recorded.set(seamKey(entry.file, entry.fn, entry.verb), entry.seams);
  }

  // ── The loss direction: a seam the ledger records that the scan no longer sees.
  for (const [k, was] of recorded) {
    const [file, fn, verb] = JSON.parse(k);
    const now = found.get(k) ?? 0;
    if (now >= was) continue;

    const world = classifySeamLoss({
      onDisk: onDisk(file),
      fnDeclared: fnDeclared(file, fn),
      discovered: now,
    });
    const head = `SEAMS_RETAINED [${verb}]: ${file}`;

    if (world === 'file-removed') {
      errors.push(
        `${head} is gone from disk, and the seam ledger still records ${fn}() there as a by-id `
          + `${verb} seam. A deleted source file is a LEGITIMATE decrease: run \`${SEAM_REGEN}\` and `
          + 'commit the ledger. There is no number to choose and no judgement to make — the diff '
          + 'records which seam left, which is the review signal a printed census could never carry.',
      );
    } else if (world === 'function-removed') {
      errors.push(
        `${head} is still on disk but declares no function named ${fn}() any more, while the seam `
          + `ledger records a by-id ${verb} seam there. A rename or a refactor is a legitimate `
          + 'decrease and the ordinary case — but read the new spelling first and confirm it still '
          + 'refuses before it answers, because while it is outside the population nothing in this '
          + `gate is judging it. Then run \`${SEAM_REGEN}\` and commit, so the ledger diff records `
          + 'the move rather than absorbing it.',
      );
    } else if (world === 'unrecognised') {
      errors.push(
        `${head} still declares ${fn}(), and the seam scan no longer reads a by-id ${verb} seam in `
          + 'it. This is the loss this ledger exists for, and the one to READ before regenerating. '
          + 'Either the by-id write or the receipt genuinely went away — in which case the function '
          + 'is no longer a seam and the decrease is real — or the seam is still there in a spelling '
          + 'the three conjuncts no longer match, in which case REFUSES has silently stopped judging '
          + 'it and the next change that drops its refusal ships unseen (#4435/#5138/#5581/#7867 are '
          + 'four shipped instances of exactly that). If it still performs a by-id write on a '
          + 'caller-supplied id and still answers a receipt, teach the scan its spelling and add the '
          + `case to \`--self-test\`; do NOT run \`${SEAM_REGEN}\`, which would record the blind spot `
          + 'as intended.',
      );
    } else {
      errors.push(
        `${head} holds ${now} function(s) named ${fn}() performing a by-id ${verb} seam, down from `
          + `the ${was} the seam ledger records. Same-named functions in one file share a ledger row, `
          + 'so one of them stopped being a seam while another still is — read which, then either '
          + `restore it or run \`${SEAM_REGEN}\` and commit so the diff records the loss.`,
      );
    }
  }

  // ── The growth direction: a seam the ledger does not yet know about.
  //
  // An error rather than a silent accept, for `retainedErrors`' reason: a
  // ledger touched only on removals is never touched at all, and every seam
  // that arrived after it was written would sit outside the ratchet forever —
  // this card's blind spot, re-opened on the newest code. Measured over the 58
  // days to 2026-08-21, two seams ARRIVED and none left, so the growth
  // direction is the one that actually fires.
  for (const row of census) {
    const was = recorded.get(seamKey(row.file, row.fn, row.verb));
    if (was === undefined) {
      errors.push(
        `SEAMS_RETAINED [${row.verb}]: ${row.file} — ${row.fn}() performs a by-id ${row.verb} on a `
          + 'caller-supplied id and answers a receipt, and the seam ledger does not record it. A NEW '
          + 'seam is not a defect and nothing is wrong with your change: SHARED_ONLY above has '
          + 'already judged whether it refuses. The ledger just has to learn the seam exists, or its '
          + `disappearance is the one thing this gate will not see. Run \`${SEAM_REGEN}\` and commit.`,
      );
    } else if (row.seams > was) {
      errors.push(
        `SEAMS_RETAINED [${row.verb}]: ${row.file} now holds ${row.seams} by-id ${row.verb} seam(s) `
          + `named ${row.fn}(), ledger records ${was}. The population grew, which is not a problem in `
          + `itself — run \`${SEAM_REGEN}\` and commit so the new seam is ratcheted too.`,
      );
    }
  }

  return errors;
}

const SEAM_LEDGER_COMMENT =
  'GENERATED — the consumer-seam population of check-engine-double-contract.mjs (#9708). Regenerate '
  + 'with `node scripts/check-engine-double-contract.mjs --write`; never hand-edit. Each row is one '
  + '(file, fn, verb) the seam scan discovers: a by-id write on a caller-supplied id, in a function '
  + 'that answers a receipt. It records WHICH seams exist — never that any of them is accepted as '
  + 'looser than the SHARED_ONLY invariant asks, which is what the shrink-only '
  + 'engine-double-contract.baseline.json is for. A row that disappears is a seam that left the '
  + 'population, and while it is outside REFUSES nothing judges it: read a removal in this file\'s '
  + 'diff as a governance loss and check it was intended.';

// ── Baseline ────────────────────────────────────────────────────────────────

function readBaseline() {
  if (!existsSync(BASELINE_PATH)) return { entries: [] };
  return JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
}

/**
 * The RETAINED ledger (#9680) — the enumerated pinned population.
 *
 * Deliberately a SEPARATE artifact from `engine-double-contract.baseline.json`
 * rather than more rows in it. The baseline is a set of hand-written MEASURED
 * justifications whose readability this file's header calls the gate's whole
 * value ("shrink-only, hand reviewed"); folding the generated rows in would
 * bury the reasons under a census that ALREADY OUTNUMBERS them -- and, by the
 * opposite polarities below, can only outnumber them further -- blurring which
 * rows a human must agree to.
 * These two ledgers also answer to opposite polarities — the baseline records
 * debt and may only SHRINK, this one records coverage and may only GROW — so a
 * reader who conflates them reads every ratchet in this file backwards.
 *
 * A missing file reads as an empty ledger so a fresh checkout bootstraps
 * through `--write` rather than crashing, exactly as `readBaseline` does.
 */
function readPinnedLedger() {
  if (!existsSync(PINNED_LEDGER_PATH)) return { entries: [] };
  return JSON.parse(readFileSync(PINNED_LEDGER_PATH, 'utf8'));
}

/**
 * The pinned population as (file, verb, pinned-count) rows, sorted for a stable
 * diff.
 *
 * Counted per FILE and not merely as membership, because a file may hold more
 * than one pinned double for a verb — the rows reading `"pinned"` above 1 in
 * `engine-double-contract.pinned.json` are the live list, and the ledger is
 * where to read how many there are rather than here. A membership-only ledger
 * would let a file that pins two deletes drop to one in silence, which is this
 * card's defect at a finer grain.
 */
function censusPinned(slices) {
  const rows = [];
  for (const { slice, found } of slices) {
    for (const { file, doubles } of found) {
      const pinned = doubles.filter((d) => d.pinned).length;
      if (pinned > 0) rows.push({ file, verb: slice.verb, pinned });
    }
  }
  rows.sort((a, b) => (a.file === b.file ? a.verb.localeCompare(b.verb) : a.file.localeCompare(b.file)));
  return rows;
}

/**
 * The (file, verb) key for every map in this section.
 *
 * `JSON.stringify` of the pair rather than a joined string: a separator has to
 * be a character neither half can contain, and the obvious candidates are worse
 * than they look -- a space can appear in a path, and the NUL that would be
 * unambiguous is a raw control byte this repo bans outright
 * (`scripts/check-nul-bytes.mjs`), which is not a rule to route around inside a
 * gate. Stringifying the pair has no separator to collide on at all.
 */
const pairKey = (file, verb) => JSON.stringify([file, verb]);

/**
 * How many doubles the scan still DECLARES per (file, verb), pinned or not.
 *
 * Distinct from `censusPinned`, and the distinction carries the whole
 * classification below. A double that went UNGUARDED leaves the census (which
 * counts pinned doubles) but stays here (which counts declared ones), while a
 * double whose member was DELETED leaves both. Reading the census alone would
 * report every newly-unguarded double as "the member was dropped" -- the wrong
 * remedy attached to the wrong story.
 *
 * Counted rather than a membership Set, because a file may pin several doubles
 * for one verb (the ledger rows reading `"pinned"` above 1 are the live list,
 * as above). Membership alone cannot separate
 * "the file pinned two deletes and now pins one because a MEMBER WAS DELETED"
 * from "...because a member stopped calling the predicate", and those two want
 * opposite remedies: restore the member vs re-pin it.
 */
function declaredCounts(slices) {
  const counts = new Map();
  for (const { slice, found } of slices) {
    for (const { file, doubles } of found) counts.set(pairKey(file, slice.verb), doubles.length);
  }
  return counts;
}

/**
 * Which of the four worlds a lost pin is in -- see the RETAINED block in the
 * header. A pure function so the self-test can drive all four without a
 * filesystem full of fixtures.
 *
 * Order matters: a file that is gone cannot also have "lost a member", so disk
 * is asked first; then whether the verb is declared at all; then whether FEWER
 * doubles are declared than the ledger pinned, which is the only evidence that
 * separates a deleted member from a member that merely stopped being pinned.
 */
function classifyPinLoss({ onDisk, declared, wasPinned }) {
  if (!onDisk) return 'file-removed';
  if (declared === 0) return 'double-removed';
  if (declared < wasPinned) return 'members-removed';
  return 'unpinned';
}

const REGEN = 'node scripts/check-engine-double-contract.mjs --write';

/**
 * RETAINED's errors, as a pure function of two censuses and the ledger.
 *
 * `onDisk` is injected so the self-test can drive all three loss worlds without
 * creating and deleting real files.
 */
function retainedErrors(census, ledger, ledgerExists, declared, onDisk) {
  const errors = [];

  // Bootstrap. Without this a missing artifact reports one "not in the ledger"
  // error per census row -- hundreds of them, and growing, since this ledger is
  // grow-only -- which reads as a catastrophe and buries the one-line fix.
  if (!ledgerExists) {
    return [
      `RETAINED: ${relative(ROOT, PINNED_LEDGER_PATH)} is missing. That file IS the pinned `
        + 'population; without it this gate is back to printing an integer nobody compares '
        + `(#9680). Bootstrap it with \`${REGEN}\` and commit it.`,
    ];
  }

  const found = new Map(census.map((r) => [pairKey(r.file, r.verb), r.pinned]));
  const recorded = new Map();

  for (const entry of ledger.entries) {
    // Same reasoning as DECLARED: an entry naming a verb no slice scans
    // reconciles against nothing forever, so it would read as permanent
    // coverage while protecting nothing.
    if (!SCANNED_VERBS.has(entry.verb)) {
      errors.push(
        `RETAINED: pinned-ledger entry for ${entry.file} names verb ${JSON.stringify(entry.verb)}, `
          + `which no slice scans (known: ${[...SCANNED_VERBS].join(', ')}). An entry no slice `
          + 'reaches can never lose its pin, so it records coverage that cannot be checked — fix '
          + 'the verb or delete the entry.',
      );
      continue;
    }
    recorded.set(pairKey(entry.file, entry.verb), entry.pinned);
  }

  // ── The loss direction: a pin the ledger records that the scan no longer sees.
  for (const entry of ledger.entries) {
    if (!SCANNED_VERBS.has(entry.verb)) continue;
    const now = found.get(pairKey(entry.file, entry.verb)) ?? 0;
    if (now >= entry.pinned) continue;

    const world = classifyPinLoss({
      onDisk: onDisk(entry.file),
      declared: declared.get(pairKey(entry.file, entry.verb)) ?? 0,
      wasPinned: entry.pinned,
    });
    const slice = SLICES.find((s) => s.verb === entry.verb);
    const head = `RETAINED [${entry.verb}]: ${entry.file}`;

    if (world === 'file-removed') {
      errors.push(
        `${head} is gone from disk, and the pinned ledger still records ${entry.pinned} pinned `
          + `${entry.verb} double(s) there. A deleted test is a LEGITIMATE decrease: run `
          + `\`${REGEN}\` and commit the ledger. There is no number to choose and no judgement to `
          + 'make — the diff records which pin left, which is the review signal a bare count '
          + 'could never carry.',
      );
    } else if (world === 'double-removed') {
      errors.push(
        `${head} is still on disk but declares NO engine double with a ${entry.verb} any more, `
          + `while the pinned ledger records ${entry.pinned}. This is the #9680 shape exactly: the `
          + 'member was DROPPED rather than the test deleted, and discovery needs the member to '
          + 'exist, so the double left the population and every other invariant in this gate '
          + `passed over it in silence (measured: 319 pinned -> 318, exit 0). Restore the `
          + `${entry.verb}() member and its \`${slice.pinCall}\` call. ONLY if the double is `
          + `genuinely and intentionally gone — the fake no longer stands in for the engine at `
          + `all — run \`${REGEN}\` and commit, so the ledger diff records which pin left.`,
      );
    } else if (world === 'members-removed') {
      const declaredNow = declared.get(pairKey(entry.file, entry.verb)) ?? 0;
      errors.push(
        `${head} declares ${declaredNow} engine double(s) with a ${entry.verb}, down from the `
          + `${entry.pinned} the pinned ledger records as pinned. This is the #9680 shape at a `
          + 'finer grain: the file still holds a fake, so nothing else in this gate reacts, but '
          + `${entry.pinned - declaredNow} ${entry.verb}() member(s) were DELETED and the coverage `
          + 'they carried left with them. Restore the member(s) and their '
          + `\`${slice.pinCall}\` call. ONLY if the double(s) are genuinely and intentionally gone `
          + `— that fake no longer stands in for the engine — run \`${REGEN}\` and commit, so the `
          + 'ledger diff records which pin left.',
      );
    } else {
      errors.push(
        `${head} still declares every ${entry.verb} double the ledger counted, but only ${now} of `
          + `${entry.pinned} route through ${[...slice.symbols][0]} any more. The double went `
          + 'UNGUARDED rather than absent, so the PINNED error naming this same file is the one to '
          + 'act on — this line exists so one output explains the whole picture. Re-pin it; do '
          + `NOT reach for \`${REGEN}\`, which would record the loss as intended.`,
      );
    }
  }

  // ── The growth direction: coverage the ledger does not yet know about.
  //
  // An error rather than a silent accept, and the reason is decay: measured over
  // the month to 2026-08-18, 8 files ENTERED the pinned set per verb and none
  // left, so a ledger that only had to be touched on removals would never be
  // touched at all and every new double would sit outside the ratchet forever —
  // this card's blind spot, re-opened on the newest code. The remedy is the same
  // one command, and the author is already in conversation with this gate.
  for (const row of census) {
    const was = recorded.get(pairKey(row.file, row.verb));
    if (was === undefined) {
      errors.push(
        `RETAINED [${row.verb}]: ${row.file} pins ${row.pinned} engine double(s) that the pinned `
          + 'ledger does not record. New pinned coverage is GOOD and nothing is wrong with your '
          + `change — the ledger just has to learn about it, or it never protects this file. Run `
          + `\`${REGEN}\` and commit.`,
      );
    } else if (row.pinned > was) {
      errors.push(
        `RETAINED [${row.verb}]: ${row.file} now pins ${row.pinned} engine double(s), ledger `
          + `records ${was}. Coverage grew, which is the direction this ledger wants — run `
          + `\`${REGEN}\` and commit so the new double is ratcheted too.`,
      );
    }
  }

  return errors;
}

// ── The ratchet-remedy authority convention (#8435) ──────────────────────────
//
// Four independent PRs, four authors, four brand-new test files, one shift --
// all four tripped this gate on a hand-rolled `update` double, and all four
// were told about it for the first time by CI. That half is a DISCOVERY-POINT
// problem this message cannot fix: the author writes the double first and meets
// the requirement only when the gate rejects it.
//
// The half this message CAN fix is which remedy it teaches. The text below
// offers two, and it used to offer them symmetrically -- pin the fake, "Or add
// a MEASURED entry to scripts/engine-double-contract.baseline.json". That
// baseline is SHRINK-ONLY, so the second path is not a fix: it is a ratchet
// weakening, and a maintainer action rather than an author's. All four devs
// took the correct path, but they had been told so out of band; a dev reading
// only this output had nothing to go on. Marking the privileged path is the
// cheap, unconditional half of #8435.
//
// Measured as a FARM-LEVEL shape, not a one-gate nit -- see the twin block in
// check-type-check-coverage.mjs for the other instance this PR fixes, and the
// report/finding for the three it does not
// (check-durability-degradation-log-level.mjs, check-role-word.mjs,
// check-driver-conformance.mjs). check-driver-memory-census.mjs is the
// precedent worth copying: it already refuses the weakening remedy outright.
//
// ⛔ Strengthens ratchet governance; weakens nothing. No threshold moves, no
// baseline entry is added, and the verdicts this gate reaches are unchanged --
// this edits the diagnostic text only.

/** Kept identical to the twin gate's token so the convention is greppable. */
const RATCHET_AUTHORITY_MARKER = '⛔ MAINTAINER-ONLY';

/** The baseline as the message spells it (BASELINE_PATH is absolute). */
const BASELINE_REL = 'scripts/engine-double-contract.baseline.json';

/**
 * How this gate OFFERS the privileged path. A detector rather than a string
 * compare, so the self-test can prove it still reaches its subject: a reworded
 * offer that stopped matching would make the convention check below pass
 * vacuously on every message.
 */
const RATCHET_EXPANSION_OFFER = new RegExp(
  `add a MEASURED entry to\\s+${BASELINE_REL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`,
);

/**
 * The convention: a message that hands the author the baseline-expanding path
 * must say in the same breath that the path is not theirs. Messages that offer
 * no such path are unaffected -- RECONCILED tells the author to DELETE or lower
 * an entry, which is the ratchet tightening and squarely the author's job.
 *
 * @param {string} message
 * @returns {boolean}
 */
function ratchetRemedyCarriesAuthority(message) {
  if (!RATCHET_EXPANSION_OFFER.test(message)) return true;
  return message.includes(RATCHET_AUTHORITY_MARKER);
}

/**
 * The INHERITANCE rule, spelled out in both ratchet remedies (#8553).
 *
 * The gate counts DECLARATION SITES: an object literal (or class body) that
 * declares the verb alongside at least two engine siblings. Restating a double
 * as `Object.assign(base, { … })` or `{ ...base, … }` therefore hands this gate
 * the OVERRIDE literal, which normally carries only the members it varies —
 * fewer than two engine siblings — so `consider()` returns and the construct is
 * accounted for by the base it was spread over.
 *
 * That is CORRECT wherever the override leaves this verb alone, and #8553's own
 * observed instance is that shape: the base is counted, the override varies
 * `find`/`insert`, nothing about the verb changed. What made it worth a card is
 * that the two-option framing below ("pin it" / "raise the baseline, do not")
 * reads as exhaustive, so an author who reaches for the override spelling to
 * get out of a red gate cannot tell from the message whether they satisfied the
 * rule or side-stepped it — and it is cheaper than either sanctioned path. A
 * ratchet does not erode by someone defeating it; it erodes when the cheapest
 * route out happens to be the invisible one.
 *
 * ⛔ Named rather than closed by counting VALUES instead of sites, and the
 * reason is a measurement rather than a preference: `--census` reports both
 * `Object.assign` shapes, and on 2026-08-20 the corpus held ZERO override
 * literals restating `delete`/`update` and six that vary other engine members
 * and inherit the verb. Counting by value would move no construct today, at the
 * price of a resolution step over an empty population — while every construct
 * it might later admit arrives UNPINNED against a shrink-only, maintainer-only
 * baseline. So the hole is documented where an author meets it and MEASURED
 * where a maintainer can watch it: the day a VERB-shaped override lands,
 * `--census` names it and this becomes a priced act rather than a hypothesis.
 */
const INHERITANCE_MARKER = 'A THIRD spelling exists and is NOT a third option';

/**
 * Same convention as `ratchetRemedyCarriesAuthority` above and for the same
 * reason: a detector, so the self-test can prove the assertion still reaches
 * its subject instead of passing vacuously after a rewording.
 *
 * @param {string} message
 * @returns {boolean}
 */
function remedyNamesInheritance(message) {
  return message.includes(INHERITANCE_MARKER) && message.includes('Object.assign');
}

const INHERITANCE_NOTE = (verb) => (
  ` ${INHERITANCE_MARKER}: restating this double as `
  + '`Object.assign(base, { … })` or `{ ...base, … }` over an already-counted double leaves this '
  + `gate reading the OVERRIDE literal, which usually declares too few engine siblings to be `
  + `counted in its own right — so it inherits the base's accounting. That is correct while the `
  + `override leaves ${verb}() alone. If your override RESTATES ${verb}() with a different `
  + `contract, inheriting is a hole and not a pass: pin it there, or keep it in the literal this `
  + 'ledger already names. `node scripts/check-engine-double-contract.mjs --census` counts both '
  + 'shapes.'
);

/**
 * PINNED's text, named and pure so the self-test can assert on the exact string
 * the author reads. Extracted from the audit loop by #8435 for that reason --
 * a message built inline is a message no assertion can reach.
 *
 * @param {{verb: string, symbols: Set<string>, producer: string, pinCall: string}} slice
 * @param {string} file
 * @param {Array<{line: number}>} unguarded
 * @returns {string}
 */
function pinnedMessage(slice, file, unguarded) {
  return (
    `PINNED [${slice.verb}]: ${file} declares ${unguarded.length} engine double(s) whose `
      + `${slice.verb}() does not route through ${[...slice.symbols][0]} `
      + `(line${unguarded.length > 1 ? 's' : ''} ${unguarded.map((d) => d.line).join(', ')}). `
      + `A fake looser than ${slice.producer} is how #4434 shipped a dead REST route with its `
      + `suite green. Open the fake's ${slice.verb} with \`${slice.pinCall}\` from `
      + "'@objectstack/metadata-core' (where the predicate lives since #5619) or from "
      + "'@objectstack/objectql' (which re-exports it) — add whichever you pick as a "
      + 'devDependency if the package lacks it, and prefer metadata-core when '
      + '@objectstack/objectql DEPENDS ON the package you are pinning, since that reverse edge '
      + 'is a cycle turbo refuses. That is the fix, and the only one of the two you can take on '
      + `your own. ${RATCHET_AUTHORITY_MARKER}, NOT a co-equal option: add a MEASURED entry to `
      + `${BASELINE_REL} saying why not — with `
      + `"verb": ${JSON.stringify(slice.verb)}. That baseline is shrink-only, so an entry weakens a `
      + 'ratchet and needs a maintainer to agree first — do not take this path to get CI green.'
      + INHERITANCE_NOTE(slice.verb)
  );
}

// ── Audit ───────────────────────────────────────────────────────────────────

/** One slice's scan over the whole tree. */
function scanSlice(slice) {
  const found = [];
  for (const abs of testFiles()) {
    const rel = relative(ROOT, abs).split(sep).join('/');
    const text = readFileSync(abs, 'utf8');
    // Cheap pre-filter: no member with this verb's name, nothing to parse.
    if (!mentionsVerb(text, slice.verb)) continue;
    const doubles = scanSource(abs, text, slice);
    if (doubles.length === 0) continue;
    found.push({ file: rel, doubles });
  }
  return found;
}

function audit() {
  const baseline = readBaseline();
  const errors = [];
  const slices = [];

  // DECLARED — before anything reconciles, every entry must name a verb this
  // script scans. An entry whose verb nothing scans reconciles against nothing
  // and reads as a live exemption forever.
  for (const entry of baseline.entries) {
    if (!SCANNED_VERBS.has(entry.verb)) {
      errors.push(
        `DECLARED: baseline entry for ${entry.file} names verb ${JSON.stringify(entry.verb)}, which `
          + `no slice scans (known: ${[...SCANNED_VERBS].join(', ')}). An entry no slice reaches is `
          + 'an exemption nothing can ever retire — fix the verb or delete the entry.',
      );
    }
  }

  for (const slice of SLICES) {
    const found = scanSlice(slice);
    const byFile = new Map(
      baseline.entries.filter((e) => e.verb === slice.verb).map((e) => [e.file, e]),
    );
    slices.push({ slice, found });

    // DISCOVERED
    if (found.length === 0) {
      errors.push(
        `DISCOVERED: the ${slice.verb} scan found no engine doubles anywhere. That is not a clean `
          + 'repo, it is a broken scan — PINNED iterates this set, so every other invariant passes '
          + 'vacuously and this script reports OK while reading nothing. Fix the discovery before '
          + 'trusting a green run.',
      );
    }

    const seen = new Set();
    for (const { file, doubles } of found) {
      const unguarded = doubles.filter((d) => !d.pinned);
      const entry = byFile.get(file);
      if (entry) seen.add(file);

      if (unguarded.length === 0) {
        if (entry) {
          errors.push(
            `RECONCILED [${slice.verb}]: ${file} has no unguarded engine double left, but the `
              + `baseline still records ${entry.unguarded}. Delete the entry in the same PR that `
              + 'fixed it.',
          );
        }
        continue;
      }
      if (!entry) {
        errors.push(pinnedMessage(slice, file, unguarded));
        continue;
      }
      if (unguarded.length > entry.unguarded) {
        errors.push(
          `PINNED [${slice.verb}]: ${file} now has ${unguarded.length} unguarded engine double(s), `
            + `baseline records ${entry.unguarded}. The baseline is shrink-only — pin the new one `
            + 'rather than raising it.'
            + INHERITANCE_NOTE(slice.verb),
        );
      } else if (unguarded.length < entry.unguarded) {
        errors.push(
          `RECONCILED [${slice.verb}]: ${file} is down to ${unguarded.length} unguarded engine `
            + `double(s) from the baseline's ${entry.unguarded}. Lower the number in the same PR, so `
            + 'the ratchet holds.',
        );
      }
    }

    for (const entry of baseline.entries) {
      if (entry.verb !== slice.verb || seen.has(entry.file)) continue;
      errors.push(
        `RECONCILED [${slice.verb}]: baseline entry for ${entry.file}, which declares no engine `
          + `double with a ${slice.verb} any more (file deleted, fake removed, or the shape `
          + 'changed). Delete the entry.',
      );
    }
  }

  // ── RETAINED (#9680) — the pinned population is enumerated, not counted ───
  //
  // Runs AFTER the per-slice loop because it reads the same `slices` the loop
  // built. It adds no criterion to the four above and changes no verdict any of
  // them reaches: every error below concerns a (file, verb) pair the ledger
  // names, or one the census found and the ledger does not.
  const census = censusPinned(slices);
  const pinnedLedger = readPinnedLedger();
  errors.push(...retainedErrors(
    census,
    pinnedLedger,
    existsSync(PINNED_LEDGER_PATH),
    declaredCounts(slices),
    (file) => existsSync(join(ROOT, file)),
  ));

  // ── The consumer seams (#8194) ────────────────────────────────────────────
  const seamFiles = scanAllSeams();
  const seamCount = seamFiles.reduce((n, f) => n + f.seams.length, 0);

  // SEAMS_DISCOVERED — the #4868 shape again, and the reason this is an ERROR
  // rather than a quiet zero: REFUSES iterates the discovered set, so a scan
  // that silently stops matching (a seam refactored to a shape the three
  // conjuncts no longer read) makes this script print OK while checking
  // nothing. A non-empty population is what every tree since #8194 has
  // measured, and SEAMS_RETAINED below names each member; zero is a broken
  // scan, which is why the two verdicts are separate rather than one.
  if (seamCount === 0) {
    errors.push(
      'SEAMS_DISCOVERED: the consumer-seam scan found no by-id write seam anywhere in '
        + 'packages/*/src. That is not a clean repo, it is a broken scan — REFUSES iterates this '
        + 'set, so it passes vacuously and this script reports OK while reading nothing. '
        + 'protocol.updateData/deleteData and callData\'s ObjectQL fallback are seams by '
        + 'construction; if none is found, the three conjuncts have drifted off the code.',
    );
  }

  // SHARED_ONLY (#8422): a seam must reach the shared envelope specifically --
  // `refusal !== 'shared'` catches both a local mint (`refusal === 'local'`)
  // and no refusal at all (`refusal === null`), so a seam that merely throws
  // SOME error no longer reads as compliant.
  for (const { file, seams } of seamFiles) {
    for (const s of seams.filter((x) => x.refusal !== 'shared')) {
      const state = s.refusal === 'local'
        ? 'refuses through a locally minted error rather than the shared envelope'
        : 'does not refuse anywhere before it';
      errors.push(
        `REFUSES: ${file}:${s.line} — ${s.fn}() performs a by-id ${s.verb} on a caller-supplied id `
          + `and then answers a success receipt, and ${state}. A write that `
          + 'touched zero rows reporting success is the #4435/#5138/#7867 defect: a typo\'d id, an '
          + 'already-deleted row and a real write become indistinguishable, and an integrator '
          + 'reading the receipt records the change as landed. Refuse before you answer — probe '
          + '(`protocol.updateData`), read the driver\'s `=== false` (`protocol.deleteData`), or '
          + 'read the prior row (`ObjectQL.update`) — and throw `recordNotFoundError` from '
          + "'@objectstack/core' rather than minting a second not-found shape.",
      );
    }
  }

  // SEAMS_RETAINED (#9708) — the discovered seam population is enumerated, not
  // counted. Runs AFTER SHARED_ONLY because it judges a different thing: that
  // one asks whether each discovered seam refuses, this one asks whether the
  // set of discovered seams is still the set the repo agreed to. Without it a
  // seam leaving the set is judged by nothing, since REFUSES only ever iterates
  // what discovery hands it.
  const seamCensus = censusSeams(seamFiles);
  errors.push(...seamsRetainedErrors(
    seamCensus,
    readSeamLedger(),
    existsSync(SEAM_LEDGER_PATH),
    (file) => existsSync(join(ROOT, file)),
    fileDeclaresFunction,
  ));

  return { slices, baseline, errors, seamFiles, seamCount, seamCensus, census, pinnedLedger };
}

const PINNED_LEDGER_COMMENT =
  'GENERATED — the RETAINED ledger of check-engine-double-contract.mjs (#9680). Regenerate with '
  + '`node scripts/check-engine-double-contract.mjs --write`; never hand-edit. Each row is one '
  + '(file, verb) whose engine double routes through the producer\'s dispatch predicate. This is '
  + 'the OPPOSITE polarity to engine-double-contract.baseline.json: that ledger records DEBT and '
  + 'may only shrink, this one records COVERAGE and may only grow. A row that disappears is a '
  + 'pinned double that left the population — the blind spot #9680 measured, where deleting a '
  + 'double\'s delete() member took 319 pinned to 318 with the gate green. Read a removal in this '
  + 'file\'s diff as a coverage loss and check it was intended.';

/**
 * Regenerate the RETAINED ledger (#9680).
 *
 * Prints every LOSS it is about to record before writing. That is the half that
 * keeps `--write` from becoming the "bump the number" reflex ruling this gate
 * out was meant to prevent: the author reads which pin left at the moment they
 * regenerate, rather than meeting it in review — or not at all.
 */
function writeLedger() {
  const { slices, seamFiles } = audit();
  const census = censusPinned(slices);
  const before = readPinnedLedger();
  const was = new Map((before.entries ?? []).map((e) => [pairKey(e.file, e.verb), e.pinned]));
  const now = new Map(census.map((r) => [pairKey(r.file, r.verb), r.pinned]));

  const losses = [];
  for (const [k, n] of was) {
    const after = now.get(k) ?? 0;
    const [file, verb] = JSON.parse(k);
    if (after < n) losses.push(`[${verb}] ${file}: ${n} pinned -> ${after}`);
  }
  const gains = [...now].filter(([k, n]) => n > (was.get(k) ?? 0)).length;

  writeFileSync(
    PINNED_LEDGER_PATH,
    `${JSON.stringify({ $comment: PINNED_LEDGER_COMMENT, entries: census }, null, 2)}\n`,
  );

  console.log('');
  if (losses.length) {
    console.log(`  ⛔ RECORDING ${losses.length} PIN LOSS(ES) — read these before you commit:`);
    for (const l of losses) console.log(`     - ${l}`);
    console.log('     Each line is coverage this gate will no longer hold. If any of them is a');
    console.log('     dropped member rather than a deleted test, restore it instead of committing.');
  } else {
    console.log('  No pin losses — this regeneration only records new or grown coverage.');
  }
  console.log(
    `\ncheck-engine-double-contract --write: ${census.length} (file, verb) row(s), `
      + `${gains} added or grown, ${losses.length} lost.\n`,
  );

  writeSeamLedger(seamFiles);
}

/**
 * Regenerate the SEAM POPULATION ledger (#9708).
 *
 * Written by the SAME `--write` as the pinned ledger, deliberately: two
 * regeneration commands for one gate is how a second artifact goes stale while
 * every message about it says "run --write". It prints its losses first, for
 * `writeLedger`'s reason — the author reads which seam left at the moment they
 * record the loss, rather than meeting it in review or not at all.
 */
function writeSeamLedger(seamFiles) {
  const census = censusSeams(seamFiles);
  const before = readSeamLedger();
  const was = new Map((before.entries ?? []).map((e) => [seamKey(e.file, e.fn, e.verb), e.seams]));
  const now = new Map(census.map((r) => [seamKey(r.file, r.fn, r.verb), r.seams]));

  const losses = [];
  for (const [k, n] of was) {
    const after = now.get(k) ?? 0;
    const [file, fn, verb] = JSON.parse(k);
    if (after < n) losses.push(`[${verb}] ${file} — ${fn}(): ${n} seam(s) -> ${after}`);
  }
  const gains = [...now].filter(([k, n]) => n > (was.get(k) ?? 0)).length;

  writeFileSync(
    SEAM_LEDGER_PATH,
    `${JSON.stringify({ $comment: SEAM_LEDGER_COMMENT, entries: census }, null, 2)}\n`,
  );

  if (losses.length) {
    console.log(`  ⛔ RECORDING ${losses.length} SEAM LOSS(ES) — read these before you commit:`);
    for (const l of losses) console.log(`     - ${l}`);
    console.log('     Each line is a consumer seam this gate will no longer judge. If the function');
    console.log('     is still performing a by-id write and still answering a receipt, it left the');
    console.log('     population because the SCAN stopped reading it — fix the scan, not the ledger.');
  } else {
    console.log('  No seam losses — this regeneration only records new seams.');
  }
  console.log(
    `\ncheck-engine-double-contract --write: ${census.length} seam row(s), `
      + `${gains} added or grown, ${losses.length} lost.\n`,
  );
}

function report() {
  const { slices, baseline, errors, seamFiles, seamCount, seamCensus, census } = audit();

  console.log('');
  let totalPinned = 0;
  for (const { slice, found } of slices) {
    const doubles = found.reduce((n, f) => n + f.doubles.length, 0);
    const pinned = found.reduce((n, f) => n + f.doubles.filter((d) => d.pinned).length, 0);
    totalPinned += pinned;
    console.log(
      `${slice.verb} doubles: ${doubles} in ${found.length} test file(s) — ${pinned} pinned to `
        + `${slice.producer}'s dispatch predicate, ${doubles - pinned} in the shrink-only baseline.`,
    );
  }
  const shared = seamFiles.reduce((n, f) => n + f.seams.filter((s) => s.refusal === 'shared').length, 0);
  const local = seamFiles.reduce((n, f) => n + f.seams.filter((s) => s.refusal === 'local').length, 0);
  console.log(
    `consumer seams: ${seamCount} in ${seamFiles.length} source file(s) — ${shared} refusing through `
      + `recordNotFoundError, ${local} through a locally minted error, `
      + `${seamCount - shared - local} not refusing at all.`,
  );

  // The seam list, refusal spelling included, printed on EVERY run — green or
  // red. It used to print only after the failure branch below, which made the
  // whole population invisible exactly when a reader was looking hardest; the
  // UNRECOGNISED verdict states the same reasoning a few lines down. Since
  // #9708 it is also the list a SEAMS_RETAINED error is about, so a reader
  // meeting one needs it in front of them rather than after an exit.
  for (const { file, seams } of seamFiles) {
    for (const s of seams) {
      console.log(`  seam [${s.refusal ?? 'NONE'}]  ${file}:${s.line}  ${s.fn}() — by-id ${s.verb}`);
    }
  }
  // Say that the population is RATCHETED, not merely printed — the distinction
  // #9680 had to add on the pinned side for the same reason: before it, the
  // count was the only trace a vanished member left and a reader had no way to
  // tell a checked number from a reported one.
  console.log(
    `consumer-seam population: ${seamCensus.length} row(s), ratcheted against the SEAMS ledger `
      + '(#9708) — a seam that leaves the population names itself.',
  );
  console.log('');

  // ── The UNRECOGNISED verdict (#9747) ──────────────────────────────────────
  // Printed on EVERY run, green or red, and before the failure branch below:
  // a count that only appears on a clean run would be invisible exactly when a
  // reader is looking hardest. It is a verdict, never a finding -- nothing
  // here can change this script's exit code.
  // Named `unrecognised`, not `census`: report() already holds the PINNED
  // census destructured from audit() (#9680's RETAINED ledger). Two distinct
  // populations in one scope, so they carry two distinct names.
  const unrecognised = censusUnrecognised();
  console.log(
    `UNRECOGNISED [engine-double-contract]: ${unrecognised.rows.length} construct(s) in ${SCAN_ROOTS.join(", ")} `
      + `declare a scanned verb (${[...SCANNED_VERBS].join(', ')}) alongside engine siblings, and this gate `
      + 'could not read the implementation -- so they are in NEITHER the pinned population nor the ledger. '
      + `${unrecognised.scopedOut} further construct(s) are SCOPED OUT by a stated criterion and are not counted here. `
      + 'This is a verdict, not a finding: it never fails a run (#9747, ruling of 2026-08-18).',
  );
  for (const r of unrecognised.rows) {
    console.log(`  unrecognised [${r.verb}]  ${r.file}:${r.line}  ${r.why}`);
    console.log(`      ${r.text}`);
  }
  console.log('');

  if (errors.length) {
    for (const e of errors) console.error(`  x ${e}`);
    console.error(`\ncheck-engine-double-contract: ${errors.length} problem(s).\n`);
    process.exit(1);
  }

  for (const { slice, found } of slices) {
    for (const f of found.filter((f) => f.doubles.some((d) => d.pinned))) {
      console.log(`  pinned [${slice.verb}]  ${f.file}`);
    }
  }

  // Print the EXEMPT reasons, not only the count. An entry whose justification
  // is never surfaced is how a ledger decays into a list nobody reads — and
  // these rows are part of why this run is green.
  const exempt = baseline.entries.filter((e) => e.kind === 'EXEMPT');
  if (exempt.length) console.log('');
  for (const e of exempt) {
    console.log(`  EXEMPT [${e.verb}]  ${e.file}`);
    console.log(`          ${e.why}`);
  }
  console.log('');
  const debt = baseline.entries.filter((e) => e.kind !== 'EXEMPT').length;
  console.log(
    `check-engine-double-contract: OK — ${totalPinned} pinned, ${debt} in the DEBT ledger, `
      + `${exempt.length} exempt.`,
  );
  // Say that the pinned number is now RATCHETED, not merely printed. Before
  // #9680 this line ended at "319 pinned" and that integer was the only trace a
  // vanished double left; a reader had no way to tell a checked count from a
  // reported one, which is what let 319 -> 318 read as success.
  console.log(
    `check-engine-double-contract: ${census.length} (file, verb) row(s) held by the RETAINED `
      + `ledger — a pin that leaves names itself.\n`,
  );
}

// ── Self-test ───────────────────────────────────────────────────────────────
//
// A guard that cannot fail is not a guard (#4118). This drives the detector
// against synthetic sources on BOTH sides of every decision it makes, so a
// refactor that neuters it fails here instead of turning every future PR green.

function selfTest() {
  const failures = [];
  const expect = (label, cond) => { if (!cond) failures.push(label); };

  const IMPORT = "import { assertEngineDeleteDispatch } from '@objectstack/objectql';\n";
  const engineFake = (deleteBody, header = '') => `${header}
function makeEngine() {
  return {
    async find(o: string, opts?: any) { return []; },
    async insert(o: string, data: any) { return data; },
    async update(o: string, d: any) { return d; },
    async delete(o: string, opts?: any) { ${deleteBody} },
  };
}
`;

  // ── Detection: an unpinned engine fake is found, a pinned one is not flagged.
  let d = scanSource('a.test.ts', engineFake('return { ok: true };'));
  expect('finds an unpinned engine double', d.length === 1 && d[0].pinned === false);

  d = scanSource('a.test.ts', engineFake('assertEngineDeleteDispatch(opts); return { ok: true };', IMPORT));
  expect('a directly pinned double is not flagged', d.length === 1 && d[0].pinned === true);

  // One level of indirection through a local helper counts; the helper must
  // itself reach the shared predicate.
  d = scanSource('a.test.ts', engineFake('assertDeletable(opts); return 1;',
    IMPORT + 'function assertDeletable(o: any) { assertEngineDeleteDispatch(o); }\n'));
  expect('a local helper that calls the predicate counts as pinned', d.length === 1 && d[0].pinned === true);

  d = scanSource('a.test.ts', engineFake('assertDeletable(opts); return 1;',
    IMPORT + 'function assertDeletable(o: any) { if (!o?.where?.id && !o?.multi) throw new Error("x"); }\n'));
  expect('a HAND-MIRRORED local helper does not count as pinned',
    d.length === 1 && d[0].pinned === false);

  // Importing the symbol without calling it is not pinning — the #4434 fake
  // would have passed a check that only looked at imports.
  d = scanSource('a.test.ts', engineFake('return { ok: true };', IMPORT));
  expect('an unused import is not pinning', d.length === 1 && d[0].pinned === false);

  // ── Scope: the DRIVER's delete(object, id, options) is a different contract
  //    and must not be swept in, or the gate drowns in false positives.
  const driverFake = `
const driver = {
  async find(o: string) { return []; },
  async create(o: string, d: any) { return d; },
  async update(o: string, id: string, d: any) { return d; },
  async delete(object: string, id: string) { return true; },
};
`;
  expect('a driver double (delete by scalar id) is out of scope', scanSource('d.test.ts', driverFake).length === 0);

  const typedIdDriver = `
const driver = {
  async find(o: string) { return []; },
  async insert(o: string, d: any) { return d; },
  async delete(object: string, key: string) { return true; },
};
`;
  expect('a scalar-typed second parameter is out of scope',
    scanSource('d.test.ts', typedIdDriver).length === 0);

  // A lone `delete` with no engine siblings is a Map-ish or route helper.
  const bare = 'const cache = { delete(k: string, o: any) { return true; } };\n';
  expect('an object with no engine siblings is out of scope', scanSource('c.test.ts', bare).length === 0);

  // ── Shape coverage: the fake shapes this repo actually writes.
  const classFake = `${IMPORT}
class FakeEngine {
  async find(o: string, q?: any) { return []; }
  async insert(o: string, d: any) { return d; }
  async delete(o: string, opts?: any) { assertEngineDeleteDispatch(opts); return 1; }
}
`;
  d = scanSource('k.test.ts', classFake);
  expect('a class-shaped fake engine is in scope and pinnable', d.length === 1 && d[0].pinned === true);

  const arrowFake = `
const engine = {
  find: async (o: string) => [],
  insert: async (o: string, d: any) => d,
  update: async (o: string, d: any) => d,
  delete: async (o: string, opts: any) => ({ ok: true }),
};
`;
  d = scanSource('p.test.ts', arrowFake);
  expect('an arrow-property fake engine is in scope', d.length === 1 && d[0].pinned === false);

  // ── The MOCK CONSTRUCTOR spelling (#8639).
  //
  // `delete: vi.fn(async …)` is a CallExpression, so `implOf` answered null and
  // the double was discovered by NEITHER side of the ledger — no output at all,
  // the same silence #5629 found behind the arity test. Each fixture below
  // drives ONE arm of `unwrapCallImpl`, because this file has already measured
  // what an unfixtured arm is worth: "with only the `new Error` fixture above,
  // neutering the call-expression arm left the self-test GREEN".
  const viFake = (init) => `
const engine = {
  find: vi.fn(async (o: string) => []),
  insert: vi.fn(async (o: string, d: any) => d),
  update: vi.fn(async (o: string, d: any) => d),
  delete: ${init},
};
`;
  d = scanSource('v.test.ts', viFake('vi.fn(async (o: string, opts?: any) => ({ ok: true }))'));
  expect('a vi.fn-wrapped engine delete is in scope', d.length === 1 && d[0].pinned === false);

  d = scanSource('v.test.ts', IMPORT
    + viFake('vi.fn(async (o: string, opts?: any) => { assertEngineDeleteDispatch(opts); return 1; })'));
  expect('a vi.fn-wrapped delete that calls the predicate is pinned',
    d.length === 1 && d[0].pinned === true);

  // `.mockImplementation(fn)` holds the implementation in the SAME position the
  // criterion reads, so it is admitted by the same rule rather than a special case.
  d = scanSource('v.test.ts', viFake('vi.fn().mockImplementation(async (o: string, opts?: any) => 1)'));
  expect('a .mockImplementation-wrapped engine delete is in scope', d.length === 1);

  // The three call shapes that hold NO implementation must stay out: there is no
  // function to judge, so there is nothing that could be looser than the producer.
  expect('a bare vi.fn() with no argument is not an implementation',
    scanSource('v.test.ts', viFake('vi.fn()')).length === 0);
  expect('a call whose sole argument is not a function is not an implementation',
    scanSource('v.test.ts', viFake("rec('DELETE')")).length === 0);
  expect('a mock resolving to a VALUE is not an implementation',
    scanSource('v.test.ts', viFake('vi.fn().mockResolvedValue(true)')).length === 0);

  // ── The DEFAULTED spelling (#9877), driven arm by arm.
  //
  // `delete: overrides.delete ?? vi.fn(fn)` is a BinaryExpression, so `implOf`
  // answered null and the double was in NEITHER half of the ledger — absent,
  // which reads as clean, while `rest-batch-endpoint.test.ts` held a live
  // unguarded engine delete behind it. Same discipline as the #8639 block
  // above: one fixture per arm, because an unfixtured arm has already been
  // measured in this file to be worth nothing.
  d = scanSource('v.test.ts', viFake('overrides.delete ?? vi.fn(async (o: string, opts?: any) => ({ ok: true }))'));
  expect('#9877 — a `??`-defaulted engine delete is in scope', d.length === 1 && d[0].pinned === false);

  d = scanSource('v.test.ts', viFake('overrides.delete || vi.fn(async (o: string, opts?: any) => ({ ok: true }))'));
  expect('#9877 — the `||` spelling of the same default is in scope too', d.length === 1);

  d = scanSource('v.test.ts', IMPORT + viFake(
    'overrides.delete ?? vi.fn(async (o: string, opts?: any) => { assertEngineDeleteDispatch(opts); return 1; })'));
  expect('#9877 — a defaulted delete whose default calls the predicate is PINNED',
    d.length === 1 && d[0].pinned === true);

  // The LEFT arm. `a ?? b` runs `a` whenever `a` is present, so a function on
  // the left is an implementation this double may run and reading only the
  // default would go blind to it. Without this fixture that fallback is
  // untested and could be deleted with the self-test still green.
  d = scanSource('v.test.ts', viFake('vi.fn(async (o: string, opts?: any) => ({ ok: true })) ?? overrides.delete'));
  expect('#9877 — a function on the LEFT of the default is read as well', d.length === 1);

  // Both arms unreadable: still absent, and correctly so — there is no function
  // anywhere in the initializer for `isEngineVerbShape` to judge.
  expect('#9877 — a default with no function on either side is still not an implementation',
    scanSource('v.test.ts', viFake('overrides.delete ?? base.delete')).length === 0);

  // The DRIVER veto must still decide at this spelling, or the widening admits
  // driver doubles the shape test exists to keep out (#5480's measured harm was
  // 19 in one file).
  expect('#9877 — a DRIVER double at the defaulted spelling is still vetoed',
    scanSource('v.test.ts', viFake('overrides.delete ?? vi.fn(async (o: string, id: string) => true)')).length === 0);

  // Deliberately NOT widened, and this is the negative that says so: a
  // conditional's arms are selected by a test this gate cannot evaluate, unlike
  // a `??` fallback which is unconditionally reachable.
  expect('#9877 — a conditional `? :` initializer is deliberately NOT read',
    scanSource('v.test.ts', viFake('flag ? vi.fn(async (o: string, opts?: any) => 1) : vi.fn(async (o: string, opts?: any) => 2)')).length === 0);

  // The CLASS-FIELD spelling of the same thing — `implOf`'s PropertyDeclaration
  // branch. Measured at ZERO occurrences in the corpus the fix landed against,
  // so this fixture is the only evidence that branch works at all; without it
  // the branch would be reachable only by a future test nobody has written yet,
  // which is exactly how the object-literal half stayed broken unnoticed.
  const viClassFake = `
class FakeEngine {
  find = vi.fn(async (o: string) => []);
  insert = vi.fn(async (o: string, d: any) => d);
  update = vi.fn(async (o: string, d: any) => d);
  delete = vi.fn(async (o: string, opts?: any) => ({ ok: true }));
}
`;
  d = scanSource('vc.test.ts', viClassFake);
  expect('a vi.fn-wrapped delete on a CLASS FIELD is in scope', d.length === 1 && d[0].pinned === false);

  // Unwrapping must not smuggle a double past the vetoes: the driver evidence
  // still outranks, at the new spelling exactly as at every other one.
  const viDriverFake = `
const driver = {
  find: vi.fn(async (o: string) => []),
  create: vi.fn(async (o: string, d: any) => d),
  update: vi.fn(async (o: string, id: string, d: any) => d),
  delete: vi.fn(async (o: string, opts?: any) => true),
};
`;
  expect('a vi.fn-wrapped DRIVER delete stays out of scope',
    scanSource('vd.test.ts', viDriverFake).length === 0);

  // ── Arity: a fake omits the parameters it ignores (#5629).
  //
  // `async delete() { return false; }` is the commonest engine-double spelling
  // in this repo, and it used to leave the scan before any other test ran — 92
  // deletes, none of them pinned, none of them in the ledger, no output. These
  // cases drive both halves of the sibling evidence that admits them now,
  // because the obvious cheap fix (admit every short-arity delete) is WRONG:
  // fake drivers drop their unused parameters exactly like fake engines do.
  const zeroArityEngine = `
const engine = {
  async find(o: string) { return []; },
  async findOne(o: string) { return null; },
  async insert(o: string, d: any) { return d; },
  async update(o: string, d: any) { return d; },
  async delete() { return false; },
};
`;
  d = scanSource('z.test.ts', zeroArityEngine);
  expect('a zero-parameter engine delete is in scope', d.length === 1 && d[0].pinned === false);

  // Same shape, one parameter — `action-body-identity.test.ts`'s scoped facade.
  const oneArityEngine = `
const engine = {
  find: async (o: string) => [],
  insert: async (o: string, d: any) => d,
  update: async (o: string, d: any) => d,
  delete: async (opts?: any) => ({ ok: true }),
};
`;
  d = scanSource('y.test.ts', oneArityEngine);
  expect('a single-parameter engine delete is in scope', d.length === 1 && d[0].pinned === false);

  // A fake DRIVER with the same zero-parameter delete must stay out: driver-only
  // members veto. `spec/src/contracts/data-driver.test.ts` is this shape.
  const zeroArityDriver = `
const driver = {
  async find(o: string) { return []; },
  async findOne(o: string) { return null; },
  async update(o: string, id: string, d: any) { return d; },
  async create(o: string, d: any) { return d; },
  async checkHealth() { return true; },
  async delete() { return true; },
};
`;
  expect('a zero-parameter DRIVER delete stays out of scope',
    scanSource('zd.test.ts', zeroArityDriver).length === 0);

  // The veto has to outrank engine-looking evidence, or `engine-aggregate-
  // having.test.ts`'s self-described "driver WITH native aggregate()" is read as
  // an engine: drivers may implement `aggregate` for pushdown.
  const nativeAggregateDriver = `
const driver = {
  async find() { return []; },
  async count() { return 0; },
  async create(o: string, d: any) { return d; },
  async bulkCreate(o: string, rows: any[]) { return rows; },
  async aggregate(o: string, ast: any) { return []; },
  async delete() { return true; },
};
`;
  expect('a zero-parameter driver that implements aggregate() stays out of scope',
    scanSource('zn.test.ts', nativeAggregateDriver).length === 0);

  // And the positive half must be required too, or every `{ find, findOne,
  // update, delete }` store mock — neither contract — becomes a finding.
  const zeroArityStoreMock = `
const store = {
  async find(k: string) { return []; },
  async findOne(k: string) { return null; },
  async update(k: string, v: any) { return v; },
  async delete() { return true; },
};
`;
  expect('a zero-parameter mock with no engine-only member stays out of scope',
    scanSource('zs.test.ts', zeroArityStoreMock).length === 0);

  // The import must come from the producer. A same-named local function is not
  // the contract — the whole point is that ONE predicate answers.
  d = scanSource('q.test.ts', engineFake('assertEngineDeleteDispatch(opts); return 1;',
    'function assertEngineDeleteDispatch(o: any) { /* look-alike */ }\n'));
  expect('a locally re-declared look-alike is not pinning', d.length === 1 && d[0].pinned === false);

  d = scanSource('r.test.ts', engineFake('assertEngineDeleteDispatch(opts); return 1;',
    "import { assertEngineDeleteDispatch } from './my-helpers.js';\n"));
  expect('the predicate imported from an unrelated module is not pinning',
    d.length === 1 && d[0].pinned === false);

  // objectql's own tests import it by relative path; that IS the producer.
  d = scanSource('s.test.ts', engineFake('assertEngineDeleteDispatch(opts); return 1;',
    "import { assertEngineDeleteDispatch } from './engine-delete-dispatch.js';\n"));
  expect("objectql's relative import of the producer counts", d.length === 1 && d[0].pinned === true);

  expect('a file with no fakes yields no doubles',
    scanSource('empty.test.ts', 'export const x = 1;\n').length === 0);

  // ── The `update` slice (#5480).
  //
  // Same detector, second verb. Driven on both sides of every decision again
  // rather than trusted to generalise: the two slices differ in exactly the
  // places that could silently mis-fire — `update` IS one of the engine
  // siblings (so it must not count itself), and the driver's `update` carries
  // its primary key in the same second position `delete`'s does but with a
  // payload behind it.
  const U = SLICES.find((s) => s.verb === 'update');
  const UIMPORT = "import { assertEngineUpdateDispatch } from '@objectstack/objectql';\n";
  const engineFakeU = (updateBody, header = '') => `${header}
function makeEngine() {
  return {
    async find(o: string, opts?: any) { return []; },
    async insert(o: string, data: any) { return data; },
    async delete(o: string, opts?: any) { return true; },
    async update(o: string, data: any, opts?: any) { ${updateBody} },
  };
}
`;

  d = scanSource('u.test.ts', engineFakeU('return data;'), U);
  expect('finds an unpinned engine update double', d.length === 1 && d[0].pinned === false);

  d = scanSource('u.test.ts', engineFakeU('assertEngineUpdateDispatch(data, opts); return data;', UIMPORT), U);
  expect('a directly pinned update double is not flagged', d.length === 1 && d[0].pinned === true);

  d = scanSource('u.test.ts', engineFakeU('assertUpdatable(data, opts); return data;',
    UIMPORT + 'function assertUpdatable(dd: any, o: any) { assertEngineUpdateDispatch(dd, o); }\n'), U);
  expect('a local helper that calls the update predicate counts as pinned',
    d.length === 1 && d[0].pinned === true);

  d = scanSource('u.test.ts', engineFakeU('assertUpdatable(data, opts); return data;',
    UIMPORT + 'function assertUpdatable(dd: any, o: any) { if (!dd?.id && !o?.where?.id && !o?.multi) throw new Error("x"); }\n'), U);
  expect('a HAND-MIRRORED update helper does not count as pinned',
    d.length === 1 && d[0].pinned === false);

  d = scanSource('u.test.ts', engineFakeU('return data;', UIMPORT), U);
  expect('an unused update import is not pinning', d.length === 1 && d[0].pinned === false);

  // The slices must not cross-credit. This is the whole reason the ledger is
  // keyed on (file, verb): #5393's fake is the live specimen — pinned on
  // `delete`, hand-waving on `update` — and a scan that let the delete pin
  // vouch for the update would report the asymmetry as fixed.
  const pinnedDeleteOnly = `${IMPORT}
const engine = {
  async find(o: string, opts?: any) { return []; },
  async insert(o: string, data: any) { return data; },
  async update(o: string, data: any, opts?: any) { return data; },
  async delete(o: string, opts?: any) { assertEngineDeleteDispatch(opts); return true; },
};
`;
  expect('a delete-pinned fake is still unpinned for update',
    scanSource('x.test.ts', pinnedDeleteOnly, U).length === 1
      && scanSource('x.test.ts', pinnedDeleteOnly, U)[0].pinned === false);
  expect('…and the same fake IS pinned for delete',
    scanSource('x.test.ts', pinnedDeleteOnly)[0].pinned === true);
  // The sharp case, and the one a copy-paste actually produces: the WRONG
  // slice's predicate called from inside the right verb's body. It reads as a
  // pin, it imports from the producer, and it answers a different question —
  // `assertEngineDeleteDispatch(opts)` never looks at `data.id`, so a double
  // guarded by it rejects `update(o, { id: 'r1' })`, which the engine accepts.
  // Nothing above catches this: the earlier fixtures differ in which BODY calls
  // the predicate, so a scan that credited symbols across slices would still
  // pass them.
  const crossSlicePredicate = `${IMPORT}
const engine = {
  async find(o: string, opts?: any) { return []; },
  async insert(o: string, data: any) { return data; },
  async delete(o: string, opts?: any) { return true; },
  async update(o: string, data: any, opts?: any) { assertEngineDeleteDispatch(opts); return data; },
};
`;
  expect("delete's predicate inside update() does not pin the update slice",
    scanSource('xs.test.ts', crossSlicePredicate, U)[0].pinned === false);
  // The mirror image, so neither direction is the one that happens to work.
  const pinnedUpdateOnly = `${UIMPORT}
const engine = {
  async find(o: string, opts?: any) { return []; },
  async insert(o: string, data: any) { return data; },
  async update(o: string, data: any, opts?: any) { assertEngineUpdateDispatch(data, opts); return data; },
  async delete(o: string, opts?: any) { return true; },
};
`;
  expect('an update-pinned fake is still unpinned for delete',
    scanSource('x.test.ts', pinnedUpdateOnly)[0].pinned === false);
  expect('…and the same fake IS pinned for update',
    scanSource('x.test.ts', pinnedUpdateOnly, U)[0].pinned === true);

  // Scope: the DRIVER's update(object, id, data, options) is a different
  // contract — the primary key sits where the engine takes the payload.
  const driverUpdate = `
const driver = {
  async find(o: string) { return []; },
  async create(o: string, d: any) { return d; },
  async delete(object: string, id: string) { return true; },
  async update(object: string, id: string, data: any) { return data; },
};
`;
  expect('a driver double (update by scalar id) is out of scope for the update slice',
    scanSource('du.test.ts', driverUpdate, U).length === 0);

  // Arity, both halves, exactly as for delete: sibling evidence decides when
  // the parameter list cannot.
  const zeroArityEngineU = `
const engine = {
  async find(o: string) { return []; },
  async findOne(o: string) { return null; },
  async insert(o: string, d: any) { return d; },
  async delete(o: string, opts?: any) { return true; },
  async update() { return null; },
};
`;
  expect('a zero-parameter engine update is in scope',
    scanSource('zu.test.ts', zeroArityEngineU, U).length === 1);

  const zeroArityDriverU = `
const driver = {
  async find(o: string) { return []; },
  async findOne(o: string) { return null; },
  async create(o: string, d: any) { return d; },
  async checkHealth() { return true; },
  async update() { return null; },
};
`;
  expect('a zero-parameter DRIVER update stays out of scope',
    scanSource('zdu.test.ts', zeroArityDriverU, U).length === 0);

  // `update` must not count itself as its own sibling, or a lone `update` on
  // any object literal becomes a finding.
  const loneUpdate = 'const store = { update(k: string, v: any) { return v; } };\n';
  expect('an object whose only engine member IS update is out of scope',
    scanSource('lu.test.ts', loneUpdate, U).length === 0);

  // objectql's own tests import by relative path; that IS the producer — and
  // the update slice must accept its OWN module, not delete's.
  d = scanSource('su.test.ts', engineFakeU('assertEngineUpdateDispatch(data, opts); return data;',
    "import { assertEngineUpdateDispatch } from './engine-update-dispatch.js';\n"), U);
  expect("objectql's relative import of the update producer counts",
    d.length === 1 && d[0].pinned === true);

  // ── The SCOPED REPOSITORY, the third shape (#6327, from #5945).
  //
  // Driven as an A/B on ONE literal, because every assertion here is a negative
  // ("not reported") and a negative passes vacuously the day the scan stops
  // discovering anything. The two fixtures below differ by a single member, so
  // the control does not merely accompany the claim — it is the same object
  // with the evidence removed, which is the only version that can distinguish
  // "the veto fired" from "discovery died".
  const repoBody = `
  find: async (query?: any) => [],
  findOne: async (query?: any) => null,
  count: async (query?: any) => 0,
  insert: async (data: any) => data,
  update: async (data: any, options?: any) => data,`;
  const scopedRepo = `const repo = {${repoBody}
  updateById: async (id: string | number, data: any) => ({ id, ...data }),
};
`;
  const sameRepoWithoutMarker = `const repo = {${repoBody}
};
`;
  expect('a scoped-repository witness is out of scope for the update slice',
    scanSource('sr.test.ts', scopedRepo, U).length === 0);
  expect('…and the SAME literal without updateById is still discovered',
    scanSource('sr.test.ts', sameRepoWithoutMarker, U).length === 1);

  // The second spelling #5945 actually wrote, and the one direction-2 ("look
  // for a `: IScopedObjectRepository` annotation") cannot see: the repository
  // handed back by `object(name)`, which carries no annotation anywhere.
  const returnedRepo = `
const liveApi = {
  object: (_name: string) => ({
    find: async () => [],
    findOne: async () => null,
    count: async () => 0,
    insert: async (data: unknown) => data,
    update: async (data: unknown) => data,
    updateById: async (id: string | number, data: object) => ({ id, ...data }),
  }),
};
`;
  expect('an UNANNOTATED repository handed back by object(name) is out of scope',
    scanSource('rr.test.ts', returnedRepo, U).length === 0);

  // The veto must not be a licence the member alone grants. A fake that takes
  // the object name where the ENGINE takes it is an engine double no matter
  // what convenience members hang off it — otherwise adding one `updateById`
  // to any fake would silently retire it from this gate.
  const engineWithByIdHelper = `
const engine = {
  async find(objectName: string, q?: any) { return []; },
  async insert(objectName: string, data: any) { return data; },
  async delete(objectName: string, opts?: any) { return true; },
  async update(objectName: string, data: any, opts?: any) { return data; },
  async updateById(id: string, data: any) { return data; },
};
`;
  d = scanSource('eb.test.ts', engineWithByIdHelper, U);
  expect('an engine double that ALSO declares updateById stays in scope',
    d.length === 1 && d[0].pinned === false);

  // The delete slice needs its own arm exercised, and its own marker: the
  // repository's delete is `delete(options)` — no object name, no id.
  const scopedRepoDelete = `
const repo = {
  find: async (query?: any) => [],
  findOne: async (query?: any) => null,
  count: async (query?: any) => 0,
  insert: async (data: any) => data,
  delete: async (options?: any) => ({ ok: true }),
  deleteById: async (id: string | number) => true,
};
`;
  expect("a scoped repository's delete is out of scope when the literal declares deleteById",
    scanSource('srd.test.ts', scopedRepoDelete).length === 0);

  // The sharpest form of the same guard, and the one the negative-assertion
  // asymmetry actually demands: one fixture holding BOTH shapes, asserted on
  // the EXACT reported set rather than on a count of zero. A criterion that
  // silenced everything would pass every assertion above and fail this one.
  const mixed = `${UIMPORT}
const repo = {
  find: async (query?: any) => [],
  findOne: async (query?: any) => null,
  count: async (query?: any) => 0,
  insert: async (data: any) => data,
  update: async (data: any, options?: any) => data,
  updateById: async (id: string | number, data: any) => ({ id, ...data }),
};
const engine = {
  async find(o: string, opts?: any) { return []; },
  async insert(o: string, data: any) { return data; },
  async delete(o: string, opts?: any) { return true; },
  async update(o: string, data: any, opts?: any) { return data; },
};
`;
  const mixedFound = scanSource('mx.test.ts', mixed, U);
  expect('a mixed fixture reports EXACTLY the engine double, not the repository',
    mixedFound.length === 1 && mixedFound[0].line === 11 && mixedFound[0].pinned === false);

  // Discovery must reach the real tree, for EVERY slice, and specifically must
  // reach the fake #4434 was shipped past. Everything above is synthetic; this
  // is the wiring.
  //
  // Deliberately NOT asserted here: that the real tree is clean, or that any
  // particular fake is pinned. That is the job of the run this self-test gates,
  // and duplicating it would make a genuine violation surface as a self-test
  // failure — the least legible message available.
  const { slices } = audit();
  expect('every slice is exercised', slices.length === SLICES.length);
  for (const { slice, found } of slices) {
    expect(`discovers engine doubles in the real tree [${slice.verb}]`, found.length > 0);
  }
  expect(
    'discovery reaches the #4434 fake',
    slices.find((s) => s.slice.verb === 'delete').found
      .some((f) => f.file === 'packages/plugins/plugin-sharing/src/sharing-rule.test.ts'),
  );

  // ── The CONSUMER SEAMS (#8194) ────────────────────────────────────────────
  //
  // Driven on both sides of all four decisions the seam scan makes — the three
  // conjuncts that admit a seam, and the refusal that clears it. The negative
  // fixtures are A/B pairs wherever the claim is "not reported": a criterion
  // that silenced everything would pass every bare negative here, so each one
  // is the SAME source with one thing changed, and the control asserts the
  // seam IS found without it.

  const ENV = "import { recordNotFoundError } from '@objectstack/core';\n";
  const seamSrc = (body, header = '') => `${header}
class Ingress {
  async updateData(request: { object: string, id: string, data: any }) {
${body}
  }
}
`;

  // The shape every seam in the tree has: refuse, then answer.
  let s = scanSeams('seam.ts', seamSrc(`
    const current = await this.probe(request.object, request.id);
    if (!current) throw recordNotFoundError(request.object, request.id);
    await this.engine.update(request.object, request.data, { where: { id: request.id } });
    return { object: request.object, id: request.id, success: true };`, ENV));
  expect('a seam that refuses through the shared envelope is clean',
    s.length === 1 && s[0].refusal === 'shared');

  // ⚠️ THE DELIVERABLE'S PROOF (#8194's whole point): the same seam with the
  // refusal deleted must be REPORTED. This is the hypothetical new consumer
  // written without a probe — nothing else in this file catches it, and if this
  // assertion ever passes vacuously the gate is worth nothing.
  s = scanSeams('seam.ts', seamSrc(`
    await this.engine.update(request.object, request.data, { where: { id: request.id } });
    return { object: request.object, id: request.id, success: true };`, ENV));
  expect('a seam that answers a receipt without refusing is reported',
    s.length === 1 && s[0].refusal === null);

  // Conjunct 2: an id read off a row this function already fetched cannot name
  // a missing record. `reassignOrphanedMetadata` and `rebuildApproverIndex` are
  // this shape and must stay out — they answer receipts and probe nothing.
  const rowIdBody = `
    const row = await this.engine.findOne(request.object, {});
    await this.engine.update(request.object, request.data, { where: { id: row.id } });
    return { object: request.object, id: row.id, success: true };`;
  expect('an id read from a row is not a seam', scanSeams('r.ts', seamSrc(rowIdBody)).length === 0);
  expect('…and the SAME function on a caller-supplied id IS a seam',
    scanSeams('r.ts', seamSrc(rowIdBody.replace(/row\.id/g, 'request.id'))).length === 1);

  // Conjunct 3: no receipt, no harm. `sql-http-outbox.ack(id)` is this shape,
  // and the engine funnel refuses its ghost id anyway.
  const noReceiptBody = `
    await this.engine.update(request.object, request.data, { where: { id: request.id } });`;
  expect('a by-id write that answers nothing is not a seam',
    scanSeams('n.ts', seamSrc(noReceiptBody)).length === 0);
  expect('…and the SAME write with a receipt IS a seam',
    scanSeams('n.ts', seamSrc(`${noReceiptBody}
    return { object: request.object, id: request.id, success: true };`)).length === 1);

  // Conjunct 1, the scalar test: a `$in` predicate is a multi-row write, and a
  // predicate write matching zero rows is legitimately "0 rows affected" — the
  // line ObjectQL itself draws ("Scope: the BY-ID branch only").
  //
  // Asserted on `scalarWhereIdOf` DIRECTLY rather than through `scanSeams`,
  // and the difference is not stylistic. Through `scanSeams` this claim passes
  // for the wrong reason: `rootIdentifier` answers null for an object literal
  // too, so the seam is dropped by the caller-supplied conjunct and the
  // scalar test is never what decided. Measured by neutering the scalar test
  // and watching the end-to-end assertion stay GREEN — a phantom check, which
  // is the one thing a gate must not ship. The rule keeps its named home here
  // (`scalarWhereIdOf` is where "scalar" means something) and this pins it
  // where a mutation can reach it.
  const whereIdOf = (src) => {
    const f = parseSourceFile('t.ts', src, ts.ScriptKind.TS);
    let lit = null;
    const v = (n) => { if (!lit && ts.isObjectLiteralExpression(n) && propertyNamed(n, 'where')) lit = n; ts.forEachChild(n, v); };
    v(f);
    return lit ? scalarWhereIdOf(lit) : undefined;
  };
  expect('a multi-row $in predicate is not a scalar by-id write',
    whereIdOf('const o = { where: { id: { $in: xs } } };') === null);
  expect('an array of ids is not a scalar by-id write',
    whereIdOf('const o = { where: { id: [1, 2] } };') === null);
  expect('…and a plain scalar id IS one — the control for both',
    whereIdOf('const o = { where: { id: request.id } };') !== null);
  expect('a $in predicate never reaches the seam report end to end',
    scanSeams('m.ts', seamSrc(`
    await this.engine.update(request.object, request.data, { where: { id: { $in: request.ids } } });
    return { object: request.object, success: true };`)).length === 0);

  // Discovery form 2 — the one the card's OWN named seam needs. Both
  // `protocol.updateData` and `deleteData` bind `const opts = { where: { id:
  // request.id } }` and pass the variable, so a scan reading only inline
  // literals discovers neither and reports a tree it never looked at.
  s = scanSeams('c.ts', seamSrc(`
    const opts: any = { where: { id: request.id } };
    await this.engine.update(request.object, request.data, opts);
    return { object: request.object, id: request.id, success: true };`, ENV));
  expect('the const-bound options form is discovered', s.length === 1 && s[0].refusal === null);

  // Discovery form 3 — `callData`'s `findOpts({ where: { id } })` wrapper.
  s = scanSeams('w.ts', seamSrc(`
    await this.engine.update(request.object, request.data, findOpts({ where: { id: request.id } }));
    return { object: request.object, id: request.id, record: request.data };`, ENV));
  expect('the one-wrapper-call options form is discovered', s.length === 1);

  // Refusal mechanism 2 — `protocol.deleteData` reads the DRIVER's boolean
  // rather than probing. Mechanism-agnostic is the point: a gate demanding a
  // probe would redden this correct code.
  s = scanSeams('b.ts', seamSrc(`
    const opts: any = { where: { id: request.id } };
    const deleted = await this.engine.delete(request.object, opts);
    if (deleted === false) throw recordNotFoundError(request.object, request.id);
    return { object: request.object, id: request.id, success: true };`, ENV));
  expect('a driver-boolean refusal counts, without any probe',
    s.length === 1 && s[0].refusal === 'shared');

  // One helper deep, through a `this` METHOD — `assertRecordExists` is not an
  // import, so a scan that only followed top-level functions would miss it.
  s = scanSeams('h.ts', `${ENV}
class Ingress {
  private async assertRecordExists(object: string, id: string) {
    const current = await this.engine.findOne(object, {});
    if (!current) throw recordNotFoundError(object, id);
  }
  async updateData(request: { object: string, id: string, data: any }) {
    await this.assertRecordExists(request.object, request.id);
    await this.engine.update(request.object, request.data, { where: { id: request.id } });
    return { object: request.object, id: request.id, success: true };
  }
}
`);
  expect('a refusal one method-hop deep reaches the shared envelope',
    s.length === 1 && s[0].refusal === 'shared');

  // The envelope attribution must SEPARATE, or the `local` row that keeps the
  // MCP divergence visible degrades into "everything is shared".
  s = scanSeams('l.ts', seamSrc(`
    const current = await this.probe(request.object, request.id);
    if (!current) throw new Error('not found');
    await this.engine.update(request.object, request.data, { where: { id: request.id } });
    return { object: request.object, id: request.id, success: true };`));
  expect('a locally minted error is NOT the shared envelope',
    s.length === 1 && s[0].refusal === 'local');

  // The same claim on the two OTHER spellings a mint takes, because each
  // reaches a different arm of `refusalKindOf` and a fixture only proves the
  // arm it touches. Measured: with only the `new Error` fixture above,
  // neutering the call-expression arm left the self-test GREEN.
  //
  // Spelling 2 — a local FACTORY function, which is `packages/mcp/src/
  // stdio-data-bridge.ts`'s live shape: `throw recordNotFound(object, id)`
  // where `recordNotFound` is a same-file function returning a bare `Error`.
  s = scanSeams('lf.ts', `
function recordNotFound(object: string, id: string): Error {
  return new Error(\`Record "\${id}" not found in "\${object}"\`);
}
class Bridge {
  async update(request: { object: string, id: string, data: any }) {
    const existing = await this.engine.findOne(request.object, {});
    if (!existing) throw recordNotFound(request.object, request.id);
    await this.engine.update(request.object, request.data, { where: { id: request.id } });
    return { object: request.object, id: request.id, record: request.data };
  }
}
`);
  expect('a local FACTORY call is a mint, not the shared envelope',
    s.length === 1 && s[0].refusal === 'local');

  // Spelling 3 — an imported factory this scan cannot resolve (plugin-sharing's
  // `makeError(404, 'RECORD_NOT_FOUND', …)`). It refuses, so it clears the
  // invariant; it is not the shared envelope, so it must not be counted as one.
  s = scanSeams('if.ts', `${"import { makeError } from './errors.js';\n"}
class Svc {
  async deleteData(request: { object: string, id: string }) {
    const existing = await this.engine.findOne(request.object, {});
    if (!existing) throw makeError(404, 'RECORD_NOT_FOUND', 'gone');
    await this.engine.delete(request.object, { where: { id: request.id } });
    return { object: request.object, id: request.id, success: true };
  }
}
`);
  expect('an unresolvable imported error factory is a mint, not the shared envelope',
    s.length === 1 && s[0].refusal === 'local');

  // A refusal AFTER the receipt is no refusal — the caller has already been
  // told the write landed.
  s = scanSeams('a.ts', seamSrc(`
    await this.engine.update(request.object, request.data, { where: { id: request.id } });
    if (request.id) return { object: request.object, id: request.id, success: true };
    throw recordNotFoundError(request.object, request.id);`, ENV));
  expect('a refusal AFTER the receipt does not count', s.length === 1 && s[0].refusal === null);

  // Wiring: the seam scan must reach the real tree, and specifically the seam
  // the card names. Deliberately NOT asserted: that every seam refuses — that
  // is the job of the run this self-test gates.
  const { seamFiles } = audit();
  expect('the seam scan discovers seams in the real tree', seamFiles.length > 0);
  expect('discovery reaches protocol.updateData/deleteData — the seam #8194 names',
    seamFiles.some((f) => f.file === 'packages/metadata-protocol/src/protocol.ts'
      && f.seams.some((x) => x.fn === 'updateData') && f.seams.some((x) => x.fn === 'deleteData')));

  // ── The ratchet-remedy authority convention (#8435) ────────────────────────
  //
  // Three assertions, deliberately non-overlapping, so each way this can rot is
  // caught by exactly one NAMED failure: (1) the detector still reaches its
  // subject, (2) the real message carries the marker, (3) an unmarked offer is
  // REJECTED. (3) is what makes (2) worth having -- a predicate that approved
  // everything would keep (2) green with the convention gone. Its fixture is
  // SYNTHETIC rather than the real message with the marker stripped: derived,
  // it also fired on a rewording and misdescribed the cause.
  const pinned = pinnedMessage(
    { verb: 'update', symbols: new Set(['assertEngineUpdateDispatch']),
      producer: 'ObjectQL.update', pinCall: 'assertEngineUpdateDispatch(data, options)' },
    'packages/plugins/plugin-auth/src/a.test.ts',
    [{ line: 72 }],
  );
  expect('#8435 — the ratchet-offer DETECTOR still matches PINNED (else the check below is vacuous)',
    RATCHET_EXPANSION_OFFER.test(pinned));
  expect(`#8435 — PINNED marks the baseline path ${RATCHET_AUTHORITY_MARKER} (it is shrink-only, so `
    + 'adding an entry is a maintainer action, not the author\'s second option)',
    ratchetRemedyCarriesAuthority(pinned));
  // ── The INHERITANCE clause (#8553) ─────────────────────────────────────────
  //
  // The card's finding was that the two-option framing ("pin it" / "raise the
  // baseline, do not") reads as exhaustive while a third, cheaper, INVISIBLE
  // route exists — restate the double as an override of a counted one. Three
  // assertions on the same non-overlapping plan as #8435 above: the clause is
  // on BOTH ratchet remedies (an author meets whichever one their file's
  // baseline state produces, so a clause on only one of them is a coin flip),
  // and the detector discriminates.
  expect('#8553 — the PINNED remedy names the inheritance rule, so an author who reaches for '
    + '`Object.assign` can tell whether they satisfied the rule or side-stepped it',
    remedyNamesInheritance(pinned));
  const shrinkOnlyRemedy = `PINNED [update]: f.test.ts now has 2 unguarded engine double(s), `
    + 'baseline records 1. The baseline is shrink-only — pin the new one rather than raising it.'
    + INHERITANCE_NOTE('update');
  expect('#8553 — …and so does the SHRINK-ONLY remedy, which is the one #8537 actually hit',
    remedyNamesInheritance(shrinkOnlyRemedy));
  expect('#8553 — remedyNamesInheritance() REJECTS the two-option framing this card filed against '
    + '(proves the detector discriminates rather than approving everything)',
    !remedyNamesInheritance('The baseline is shrink-only — pin the new one rather than raising it.'));

  const unmarkedOffer = `PINNED: add a MEASURED entry to ${BASELINE_REL} saying why not.`;
  expect('#8435 — the synthetic unmarked-offer fixture is still recognised as an offer',
    RATCHET_EXPANSION_OFFER.test(unmarkedOffer));
  expect('#8435 — ratchetRemedyCarriesAuthority() REJECTS an offer carrying no marker (proves the '
    + 'predicate discriminates rather than approving everything)',
    !ratchetRemedyCarriesAuthority(unmarkedOffer));


  // ── RETAINED (#9680): the pinned population is enumerated, not counted ─────
  //
  // Driven through the two pure functions the invariant is built from, so all
  // four loss worlds are exercised without creating and deleting real files.
  // `onDisk` and the two censuses are injected for exactly that reason.
  const LEDGER_OK = true;
  const noDisk = () => false;
  const onDisk = () => true;
  const dcount = (pairs) => new Map(pairs.map(([f, v, n]) => [pairKey(f, v), n]));
  const anyOf = (errs, needle) => errs.some((e) => e.includes(needle));

  // The census reads PINNED doubles, the declared census reads ALL of them.
  // Both directions, because conflating them is what made the first draft of
  // this invariant tell a file whose member was deleted to "re-pin" it.
  const mixedSlices = [{
    slice: SLICES[0],
    found: [{ file: 'a.test.ts', doubles: [{ pinned: true }, { pinned: false }] }],
  }];
  expect('censusPinned counts only the PINNED doubles',
    censusPinned(mixedSlices).length === 1 && censusPinned(mixedSlices)[0].pinned === 1);
  expect('declaredCounts counts pinned AND unpinned doubles',
    declaredCounts(mixedSlices).get(pairKey('a.test.ts', 'delete')) === 2);
  expect('censusPinned omits a file whose doubles are all unpinned',
    censusPinned([{ slice: SLICES[0], found: [{ file: 'b.test.ts', doubles: [{ pinned: false }] }] }])
      .length === 0);

  // ── The four loss worlds, each separated from its neighbours.
  expect('a file gone from disk classifies as file-removed',
    classifyPinLoss({ onDisk: false, declared: 0, wasPinned: 1 }) === 'file-removed');
  expect('a file on disk declaring no double classifies as double-removed',
    classifyPinLoss({ onDisk: true, declared: 0, wasPinned: 1 }) === 'double-removed');
  expect('fewer doubles declared than pinned classifies as members-removed',
    classifyPinLoss({ onDisk: true, declared: 1, wasPinned: 2 }) === 'members-removed');
  expect('every double still declared classifies as unpinned',
    classifyPinLoss({ onDisk: true, declared: 2, wasPinned: 2 }) === 'unpinned');

  // ── The clean direction: a ledger that matches the census reports nothing.
  // Without this every assertion below could pass on a function that always
  // errors, which is the guard-that-cannot-pass twin of #4118.
  const cleanLedger = { entries: [{ file: 'a.test.ts', verb: 'delete', pinned: 1 }] };
  const cleanCensus = [{ file: 'a.test.ts', verb: 'delete', pinned: 1 }];
  expect('a ledger matching the census is silent',
    retainedErrors(cleanCensus, cleanLedger, LEDGER_OK,
      dcount([['a.test.ts', 'delete', 1]]), onDisk).length === 0);

  // ── Each loss world reaches its OWN message, and never a neighbour's.
  const lostFile = retainedErrors([], cleanLedger, LEDGER_OK, dcount([]), noDisk);
  expect('a deleted test file is reported as a legitimate decrease',
    lostFile.length === 1 && anyOf(lostFile, 'gone from disk')
      && anyOf(lostFile, 'LEGITIMATE decrease'));

  const lostDouble = retainedErrors([], cleanLedger, LEDGER_OK, dcount([]), onDisk);
  expect('a dropped member on a live file is reported as the #9680 defect',
    lostDouble.length === 1 && anyOf(lostDouble, 'declares NO engine double')
      && anyOf(lostDouble, '#9680'));
  expect('the dropped-member message does NOT read as a legitimate decrease',
    !anyOf(lostDouble, 'gone from disk'));

  const twoPinned = { entries: [{ file: 'a.test.ts', verb: 'delete', pinned: 2 }] };
  const lostOne = retainedErrors([{ file: 'a.test.ts', verb: 'delete', pinned: 1 }], twoPinned,
    LEDGER_OK, dcount([['a.test.ts', 'delete', 1]]), onDisk);
  expect('one member deleted out of two pinned is reported as members-removed',
    lostOne.length === 1 && anyOf(lostOne, 'down from the 2'));
  expect('the members-removed message does not tell the author to re-pin',
    !anyOf(lostOne, 'Re-pin it'));

  const wentLoose = retainedErrors([], cleanLedger, LEDGER_OK,
    dcount([['a.test.ts', 'delete', 1]]), onDisk);
  expect('a double that went unguarded is reported as unpinned, not as absent',
    wentLoose.length === 1 && anyOf(wentLoose, 'went UNGUARDED')
      && !anyOf(wentLoose, 'declares NO engine double'));
  expect('the unpinned message refuses the regeneration remedy',
    anyOf(wentLoose, 'do NOT reach for'));

  // ── The growth direction. Both spellings, because a new FILE and a new double
  // in a known file arrive by different routes and only one was in the first draft.
  const grewNew = retainedErrors([{ file: 'new.test.ts', verb: 'delete', pinned: 1 }],
    { entries: [] }, LEDGER_OK, dcount([['new.test.ts', 'delete', 1]]), onDisk);
  expect('a newly pinned file the ledger does not record is reported',
    grewNew.length === 1 && anyOf(grewNew, 'does not record'));
  expect('new coverage is not reported as anyone’s mistake',
    anyOf(grewNew, 'nothing is wrong with your change'));

  const grewMore = retainedErrors([{ file: 'a.test.ts', verb: 'delete', pinned: 2 }], cleanLedger,
    LEDGER_OK, dcount([['a.test.ts', 'delete', 2]]), onDisk);
  expect('a file that pins MORE than the ledger records is reported',
    grewMore.length === 1 && anyOf(grewMore, 'Coverage grew'));

  // ── Bootstrap: a missing ledger is ONE error, not one per row. The failure
  // this guards is a fresh checkout reporting one problem per census row for a
  // single missing file.
  const missing = retainedErrors(
    [{ file: 'a.test.ts', verb: 'delete', pinned: 1 }, { file: 'b.test.ts', verb: 'update', pinned: 1 }],
    { entries: [] }, false, dcount([]), onDisk);
  expect('a missing pinned ledger reports exactly one bootstrap error',
    missing.length === 1 && anyOf(missing, 'is missing'));

  // ── DECLARED's twin for this ledger: an entry naming a verb no slice scans
  // can never lose its pin, so it would record coverage nothing checks.
  const badVerb = retainedErrors([], { entries: [{ file: 'a.test.ts', verb: 'destroy', pinned: 1 }] },
    LEDGER_OK, dcount([]), onDisk);
  expect('a pinned-ledger entry naming an unscanned verb is rejected',
    badVerb.length === 1 && anyOf(badVerb, 'no slice scans'));
  expect('an unscanned-verb entry is not ALSO reported as a lost pin',
    !anyOf(badVerb, 'gone from disk') && !anyOf(badVerb, 'declares NO engine double'));

  // ── The reason this invariant exists, stated as an assertion: the pinned
  // population must be enumerated. A ledger holding only a COUNT cannot express
  // the swap that motivated #9680 -- one file loses a pin, another gains one --
  // so the census rows carry identity, and this fails if they ever stop.
  expect('census rows carry file identity, not just a total',
    censusPinned(mixedSlices)[0].file === 'a.test.ts'
      && typeof censusPinned(mixedSlices)[0].verb === 'string');
  const swapBefore = { entries: [{ file: 'x.test.ts', verb: 'delete', pinned: 1 }] };
  const swapAfter = [{ file: 'y.test.ts', verb: 'delete', pinned: 1 }];
  const swap = retainedErrors(swapAfter, swapBefore, LEDGER_OK,
    dcount([['y.test.ts', 'delete', 1]]), onDisk);
  expect('a SWAP (one pin lost, one gained, total unchanged) is reported both ways',
    swap.length === 2 && anyOf(swap, 'x.test.ts') && anyOf(swap, 'y.test.ts'));


  // ── SEAMS_RETAINED (#9708): the seam POPULATION is enumerated, not counted ──
  //
  // Same plan as RETAINED above: the invariant is built from pure functions, so
  // every loss world is driven without creating and deleting real files, and
  // each assertion has a control that fails if the predicate under it started
  // approving everything.
  const seamLedgerOf = (rows) => ({ entries: rows.map(([file, fn, verb, seams]) => ({ file, fn, verb, seams: seams ?? 1 })) });
  const seamCensusOf = (rows) => rows.map(([file, fn, verb, seams]) => ({ file, fn, verb, seams: seams ?? 1 }));
  const declared = () => true;
  const notDeclared = () => false;

  // The census reads the scan's own output shape, and it must carry IDENTITY:
  // a ledger holding a total could not express the move this population has
  // actually made twice (2026-06-28, 2026-07-27 — see the header), where one
  // key leaves and another arrives with the count unchanged.
  const twoSeamFiles = [{ file: 'a.ts', seams: [{ fn: 'f', verb: 'update' }, { fn: 'f', verb: 'delete' }] }];
  expect('censusSeams keys on (file, fn, verb), so one function with two verbs is two rows',
    censusSeams(twoSeamFiles).length === 2);
  expect('censusSeams counts same-named functions in one file into one row',
    censusSeams([{ file: 'a.ts', seams: [{ fn: 'f', verb: 'update' }, { fn: 'f', verb: 'update' }] }])
      .length === 1
    && censusSeams([{ file: 'a.ts', seams: [{ fn: 'f', verb: 'update' }, { fn: 'f', verb: 'update' }] }])[0].seams === 2);
  expect('censusSeams rows carry file identity, not just a total',
    censusSeams(twoSeamFiles)[0].file === 'a.ts' && typeof censusSeams(twoSeamFiles)[0].fn === 'string');
  expect('censusSeams does NOT record the line, so an unrelated edit above a seam cannot churn the ledger',
    Object.keys(censusSeams([{ file: 'a.ts', seams: [{ fn: 'f', verb: 'update', line: 42 }] }])[0])
      .includes('line') === false);

  // ── The four loss worlds, each separated from its neighbours.
  expect('a seam file gone from disk classifies as file-removed',
    classifySeamLoss({ onDisk: false, fnDeclared: false, discovered: 0 }) === 'file-removed');
  expect('a live file no longer declaring the function classifies as function-removed',
    classifySeamLoss({ onDisk: true, fnDeclared: false, discovered: 0 }) === 'function-removed');
  expect('a function still declared and no longer discovered classifies as unrecognised',
    classifySeamLoss({ onDisk: true, fnDeclared: true, discovered: 0 }) === 'unrecognised');
  expect('fewer discovered than recorded, with the name still there, classifies as sites-removed',
    classifySeamLoss({ onDisk: true, fnDeclared: true, discovered: 1 }) === 'sites-removed');

  // ── The clean direction, first: without it every assertion below could pass
  // on a function that always errors (#4118's twin).
  const cleanSeamLedger = seamLedgerOf([['a.ts', 'f', 'update']]);
  const cleanSeamCensus = seamCensusOf([['a.ts', 'f', 'update']]);
  expect('a seam ledger matching the census is silent',
    seamsRetainedErrors(cleanSeamCensus, cleanSeamLedger, LEDGER_OK, onDisk, declared).length === 0);

  // ── Each loss world reaches its OWN message, and never a neighbour's.
  const seamFileGone = seamsRetainedErrors([], cleanSeamLedger, LEDGER_OK, noDisk, notDeclared);
  expect('a deleted source file is reported as a legitimate decrease',
    seamFileGone.length === 1 && anyOf(seamFileGone, 'gone from disk')
      && anyOf(seamFileGone, 'LEGITIMATE decrease'));

  const seamFnGone = seamsRetainedErrors([], cleanSeamLedger, LEDGER_OK, onDisk, notDeclared);
  expect('a renamed-away function is reported as a rename, on a file still on disk',
    seamFnGone.length === 1 && anyOf(seamFnGone, 'declares no function named')
      && !anyOf(seamFnGone, 'gone from disk'));

  // ⚠️ THE DELIVERABLE'S PROOF (#9708's whole point): the function is still
  // there, under its own name, and the scan no longer reads a seam in it. This
  // is the world where a regeneration would record a blind spot as intended,
  // so the message must refuse the remedy the other three offer.
  const seamUnread = seamsRetainedErrors([], cleanSeamLedger, LEDGER_OK, onDisk, declared);
  expect('a seam the scan stopped reading, on a function still declared, is reported as unrecognised',
    seamUnread.length === 1 && anyOf(seamUnread, 'still declares')
      && anyOf(seamUnread, 'the loss this ledger exists for'));
  expect('the unrecognised message REFUSES the regeneration remedy (the other three offer it)',
    anyOf(seamUnread, 'do NOT run') && !anyOf(seamUnread, 'LEGITIMATE decrease'));

  const seamSitesGone = seamsRetainedErrors(seamCensusOf([['a.ts', 'f', 'update', 1]]),
    seamLedgerOf([['a.ts', 'f', 'update', 2]]), LEDGER_OK, onDisk, declared);
  expect('one of two same-named seams leaving is reported at that grain',
    seamSitesGone.length === 1 && anyOf(seamSitesGone, 'down from the 2'));

  // ── The growth direction — the one measured to fire most often (2 arrivals,
  // 0 departures in the 58 days to 2026-08-21).
  const seamNew = seamsRetainedErrors(cleanSeamCensus, seamLedgerOf([]), LEDGER_OK, onDisk, declared);
  expect('a seam the ledger does not record is reported',
    seamNew.length === 1 && anyOf(seamNew, 'does not record it'));
  expect('a new seam is not reported as anyone’s mistake',
    anyOf(seamNew, 'nothing is wrong with your change'));

  const seamGrew = seamsRetainedErrors(seamCensusOf([['a.ts', 'f', 'update', 2]]), cleanSeamLedger,
    LEDGER_OK, onDisk, declared);
  expect('a file holding MORE seams than the ledger records is reported',
    seamGrew.length === 1 && anyOf(seamGrew, 'The population grew'));

  // ── A MOVE — the shape this population has actually taken twice — must be
  // reported from both ends, or a rename reads as a silent swap.
  const seamMoved = seamsRetainedErrors(seamCensusOf([['b.ts', 'f', 'update']]), cleanSeamLedger,
    LEDGER_OK, onDisk, notDeclared);
  expect('a seam that MOVED file is reported as both a loss and an arrival',
    seamMoved.length === 2 && anyOf(seamMoved, 'a.ts') && anyOf(seamMoved, 'b.ts'));

  // ── Bootstrap: one error for a missing artifact, not one per seam.
  const seamMissing = seamsRetainedErrors(
    seamCensusOf([['a.ts', 'f', 'update'], ['b.ts', 'g', 'delete']]),
    seamLedgerOf([]), false, onDisk, declared);
  expect('a missing seam ledger reports exactly one bootstrap error',
    seamMissing.length === 1 && anyOf(seamMissing, 'is missing'));

  // ── An entry naming a verb the seam scan never reads can never lose its
  // seam, so it would record a population nothing checks.
  const seamBadVerb = seamsRetainedErrors([], seamLedgerOf([['a.ts', 'f', 'destroy']]),
    LEDGER_OK, onDisk, declared);
  expect('a seam-ledger entry naming an unread verb is rejected',
    seamBadVerb.length === 1 && anyOf(seamBadVerb, 'the seam scan does not read'));
  expect('an unread-verb entry is not ALSO reported as a lost seam',
    !anyOf(seamBadVerb, 'gone from disk') && !anyOf(seamBadVerb, 'still declares'));

  // ── The declaration walker, which is what separates `function-removed` from
  // `unrecognised`. Both directions on every shape a LIVE seam takes, because
  // a walker blind to one of them would classify that seam's loss as the
  // quieter story — and the classifier would still look healthy.
  const namesOf = (src) => declaredFunctionNames(
    parseSourceFile('d.ts', src, ts.ScriptKind.TS));
  expect('declaredFunctionNames reads a top-level function declaration (`callData`s shape)',
    namesOf('export async function callData(deps) { return 1; }').has('callData'));
  expect('…an OBJECT LITERAL method (`protocol.updateData` / the MCP bridge’s shape)',
    namesOf('const bridge = { async remove(object, id) { return 1; } };').has('remove'));
  expect('…a class method',
    namesOf('class C { async updateData(r) { return 1; } }').has('updateData'));
  expect('…and an arrow bound to a const',
    namesOf('const deleteData = async (r) => r;').has('deleteData'));
  expect('…and does NOT answer for a name the file never declares (the control)',
    !namesOf('const bridge = { async remove(object, id) { return 1; } };').has('updateData'));

  // ⚠️ The anti-vacuity control the #8999 lesson asks for, and the reason it is
  // driven against the REAL tree rather than fixtures: every fixture above is
  // one I wrote to match the walker. If the walker stopped reading the live
  // seams' shapes, `function-removed` would become the permanent verdict — the
  // wrong remedy attached to the wrong story, on every loss. So: every row the
  // scan discovers today must have its function findable in its own file.
  for (const { file, seams } of seamFiles) {
    for (const s of seams) {
      expect(`the declaration walker finds ${s.fn}() in ${file} — else every loss reads as a rename`,
        fileDeclaresFunction(file, s.fn));
    }
  }

  // ⛔ Deliberately NOT asserted here: that the ledger on disk MATCHES the tree.
  // That is the verdict of the run this self-test gates, and duplicating it
  // would make a genuine seam removal surface as a self-test failure — the
  // least legible message available, and the reason the double half of this
  // file states the same exclusion.

  // ── The UNRECOGNISED census (#9747) ────────────────────────────────────────
  //
  // Both directions on every limb, and the third direction this card exists for:
  // a construct that is CORRECTLY out of scope must count as SCOPED OUT, never
  // as unrecognised. #8662 is why -- a correct OUT_OF_SCOPE verdict that reads
  // as noise discredits the whole direction on day one.
  const D = SLICES.find((s) => s.verb === 'delete');
  const censusFake = (deleteMember, header = '') => `${header}
function makeEngine() {
  return {
    async find(o: string, opts?: any) { return []; },
    async insert(o: string, data: any) { return data; },
    ${deleteMember}
  };
}
`;

  let c = censusSource('c.test.ts', censusFake('async delete(o: string, opts?: any) { return true; },'), D);
  expect('#9747 — a construct the gate CAN read is not in the census (it is in the population)',
    c.unrecognised.length === 0 && c.scopedOut.length === 0);

  // ⛔ This fixture used to be the census's "carries a function the unwrap
  // declined" witness. #9877 taught `fnInitializer` to descend a `??`/`||`
  // default, so the SAME source is now READ -- and the census must follow the
  // recognizer rather than keep a row the population already owns. Asserted
  // from both sides: absent from the census, present in the population.
  const defaulted = censusFake('delete: overrides.delete ?? vi.fn(async (o: string, opts?: any) => true),');
  c = censusSource('c.test.ts', defaulted, D);
  expect('#9877 — a DEFAULTED initializer left the census when the recognizer learned to read it',
    c.unrecognised.length === 0 && c.scopedOut.length === 0);
  expect('#9877 — …and landed in the population instead (the two walks agree)',
    scanSource('c.test.ts', defaulted, D).length === 1);

  // The limb the fixture above used to drive still needs a witness, or the
  // "declined to unwrap" branch becomes unreachable and rots silently. A
  // function among SEVERAL arguments is the spelling `unwrapCallImpl`
  // deliberately does not read (`--census` reports it, ZERO on 2026-08-20).
  c = censusSource('c.test.ts', censusFake("delete: traced('DELETE', async (o: string, opts?: any) => true),"), D);
  expect('#9747 — an initializer carrying a function the unwrap declined is UNRECOGNISED',
    c.unrecognised.length === 1 && c.unrecognised[0].why.includes('declined to unwrap'));

  // ⛔ The two fixtures below used to be this census's "local binding" and
  // "shorthand" witnesses. #10175 taught `fnInitializer` to resolve a bare
  // binding through the file's own scopes, so BOTH sources are now read -- and,
  // exactly as the `??` limb above states it, the census must follow the
  // recognizer rather than keep a row the population already owns. Each is
  // asserted from both sides, because "left the census" and "entered the
  // population" are two different facts and the failure this card exists for is
  // a construct that is in NEITHER.
  const bound = censusFake('delete: del,', 'const del = async (o: string, opts?: any) => true;\n');
  c = censusSource('c.test.ts', bound, D);
  expect('#10175 — an initializer rooting at a LOCAL BINDING left the census when the recognizer '
    + 'learned to resolve it',
    c.unrecognised.length === 0 && c.scopedOut.length === 0);
  expect('#10175 — …and landed in the population instead (the two walks agree)',
    scanSource('c.test.ts', bound, D).length === 1);

  // The shorthand limb is driven on the UPDATE slice, not delete: `{ delete }`
  // is not valid shorthand (a reserved word), so the delete spelling could
  // never occur in the tree and a fixture using it would assert nothing. Every
  // shorthand row the real corpus carries is an `update`.
  const U9747 = SLICES.find((s) => s.verb === 'update');
  const shorthand = `
const update = async (o: string, data: any, opts?: any) => data;
const engine: any = { registry: {}, insert: async (o: string, d: any) => d, findOne: async (o: string) => null, update };
`;
  c = censusSource('c.test.ts', shorthand, U9747);
  expect('#10175 — a SHORTHAND member left the census the same way (the member name IS the binding)',
    c.unrecognised.length === 0 && c.scopedOut.length === 0);
  expect('#10175 — …and landed in the population instead',
    scanSource('c.test.ts', shorthand, U9747).length === 1);

  // Both limbs above removed a census witness, so both branches need a fixture
  // that STILL fires or they become unreachable and rot silently -- the same
  // debt the `traced(…)` fixture above pays for the "declined to unwrap" arm.
  // These are the honest residue of the widening: a binding whose value is not
  // a function this gate can read, and a name this file never declares.
  c = censusSource('c.test.ts', censusFake('delete: del,', 'const del = makeDeleter();\n'), D);
  expect('#10175 — a binding whose value is NOT a readable function is still UNRECOGNISED '
    + '(resolution answers null; it does not invent a verdict)',
    c.unrecognised.length === 1 && c.unrecognised[0].why.includes('`del`'));

  c = censusSource('c.test.ts', `
import { update } from './fixtures.js';
const engine: any = { registry: {}, insert: async (o: string, d: any) => d, findOne: async (o: string) => null, update };
`, U9747);
  expect('#10175 — a shorthand whose binding is IMPORTED is still UNRECOGNISED (one file is all '
    + 'this walk has, so the implementation is not knowable here)',
    c.unrecognised.length === 1 && c.unrecognised[0].why.includes('shorthand'));

  expect('#10175 — a binding bound to a PARAMETER is not resolved either: the implementation is '
    + 'whatever the caller passed',
    scanSource('c.test.ts', `
function makeEngine(del: any) {
  return { registry: {}, async insert(o: string, d: any) { return d; }, async find(o: string) { return []; }, delete: del };
}
`, D).length === 0);

  // A cycle must answer null rather than recurse forever. `seen` is keyed on
  // the resolved DECLARATION, so this terminates on the second visit.
  expect('#10175 — a cyclic binding pair answers null instead of looping',
    scanSource('c.test.ts', `
const a = b;
const b = a;
const engine: any = { registry: {}, insert: async (o: string, d: any) => d, find: async (o: string) => [], delete: a };
`, D).length === 0);

  // A `function` declaration is the other spelling of the same binding, and it
  // has to be read as itself: everything downstream takes `.parameters` and
  // walks the body, which works on a declaration exactly as on an arrow.
  expect('#10175 — a binding that is a FUNCTION DECLARATION is read',
    scanSource('c.test.ts', `
function del(o: string, opts?: any) { return true; }
const engine: any = { registry: {}, insert: async (o: string, d: any) => d, find: async (o: string) => [], delete: del };
`, D).length === 1);

  // ⭐ The discriminating limb for resolving by SCOPE CHAIN rather than by a
  // file-wide name map. Two bindings share the name; the NEARER one is the one
  // that runs. It is driven in the direction where the two answers DIFFER --
  // the inner `del` takes a primary key in second position, so reading it
  // vetoes the construct as a DRIVER while reading the outer one would admit it
  // as an engine double. A file-wide map picks one binding for every use site
  // and gets this wrong in one direction or the other; two files in this repo's
  // own corpus declare the same name twice (see `resolveBinding`).
  const shadowed = `
const del = async (o: string, opts?: any) => true;
function inner() {
  const del = async (o: string, id: string) => true;
  const engine: any = { registry: {}, insert: async (o: string, d: any) => d, find: async (o: string) => [], delete: del };
  return engine;
}
`;
  expect('#10175 — a SHADOWED binding resolves to the nearest declaration, not to a file-wide '
    + 'name match (here the inner one is the driver shape, so the construct is out of scope)',
    scanSource('c.test.ts', shadowed, D).length === 0);
  expect('#10175 — …and the control: the SAME construct with no inner shadow reads the outer '
    + 'binding and IS discovered, so the limb above measures the shadow and not the fixture',
    scanSource('c.test.ts', shadowed.replace('  const del = async (o: string, id: string) => true;\n', ''), D)
      .length === 1);

  // The pinning verdict has to survive the extra hop, in both directions --
  // resolution that lost the body would report every newly-read double as
  // unpinned, which is the noisiest possible way to be wrong.
  expect('#10175 — a resolved binding whose body calls the predicate is PINNED',
    scanSource('c.test.ts', IMPORT + `
const del = async (o: string, opts?: any) => { assertEngineDeleteDispatch(opts); return true; };
const engine: any = { registry: {}, insert: async (o: string, d: any) => d, find: async (o: string) => [], delete: del };
`, D)[0].pinned === true);
  expect('#10175 — …and one that does not is NOT pinned',
    scanSource('c.test.ts', IMPORT + `
const del = async (o: string, opts?: any) => true;
const engine: any = { registry: {}, insert: async (o: string, d: any) => d, find: async (o: string) => [], delete: del };
`, D)[0].pinned === false);

  // The DRIVER veto is decided on the sibling members, so it must still fire
  // when the implementation arrived through a binding. Widening a recogniser
  // into a veto is how a gate starts reporting the wrong contract.
  expect('#10175 — the driver veto still applies at the bound spelling',
    scanSource('d.test.ts', `
const del = async (o: string, opts?: any) => true;
const driver: any = { create: async (o: string, d: any) => d, find: async (o: string) => [], connect: async () => {}, delete: del };
`, D).length === 0);

  // ⛔ The pre-filter is part of the recogniser, and it was FOUR copies with two
  // different character classes (#10175). While a shorthand could not be read
  // the difference was invisible; the moment it can, a narrow copy silently
  // skips any file whose only spelling of the verb is a shorthand member -- and
  // the two walks then disagree for a reason nowhere near `implOf`.
  expect('#10175 — the shared pre-filter admits the SHORTHAND spellings, not just `verb(` / `verb:`',
    mentionsVerb('const e = { registry, insert, update, findOne };', 'update')
      && mentionsVerb('return { engine, insert, update }', 'update')
      && mentionsVerb('async update(o: string, d: any) {}', 'update')
      && mentionsVerb('const e = { update: fn }', 'update')
      && !mentionsVerb('await p.updateManyData({});', 'update'));

  // ⛔ The H4 trap, pinned in both spellings: a bare mock and a mock returning a
  // VALUE carry no implementation at all, so nothing about them could be looser
  // than the producer. `unwrapCallImpl`'s own census argues this. They must be
  // SCOPED OUT -- counting them would put 117 correct rows in the report today.
  c = censusSource('c.test.ts', censusFake('delete: vi.fn(),'), D);
  expect('#9747 — `vi.fn()` is SCOPED OUT, not unrecognised',
    c.unrecognised.length === 0 && c.scopedOut.length === 1);

  c = censusSource('c.test.ts', censusFake('delete: vi.fn().mockResolvedValue(true),'), D);
  expect('#9747 — a mock returning a VALUE is SCOPED OUT, not unrecognised',
    c.unrecognised.length === 0 && c.scopedOut.length === 1);

  // The census reads the SAME structural evidence discovery does: a construct
  // with fewer than two engine siblings was never this gate's business, and
  // reporting it would be the noise the ruling's pilot is meant to avoid.
  c = censusSource('c.test.ts', `const notAnEngine = { delete: del };\nconst del = async (o: string) => true;\n`, D);
  expect('#9747 — a construct with fewer than two engine siblings is in NEITHER census bucket',
    c.unrecognised.length === 0 && c.scopedOut.length === 0);

  // ⛔ Visibility only: the census must not be able to move discovery. Same
  // source, both walks -- the double count is what it was before this section
  // existed. Without this limb "it only counts" is a claim, not a property.
  // (Re-based by #10175: the `delete: del` fixture this used to drive is READ
  // now, so it proves nothing about the census's inability to widen discovery.
  // A function among SEVERAL arguments is the spelling that is still outside
  // the recognizer, so it is the one that can carry this property.)
  const visSrc = censusFake("delete: traced('DELETE', async (o: string, opts?: any) => true),");
  expect('#9747 — a construct in the UNRECOGNISED census is still absent from the population '
    + '(the census cannot widen discovery)',
    censusSource('c.test.ts', visSrc, D).unrecognised.length === 1
      && scanSource('c.test.ts', visSrc, D).length === 0);

  // ── The RECOGNIZER CENSUS (#9943) ─────────────────────────────────────────
  //
  // `--census` exists so this file stops writing its own corpus down as
  // constants that nothing regenerates. It only earns that if its buckets are
  // proved on both sides -- a census whose kinds silently collapsed into one
  // another would print a confident table and hide the same blind spot the
  // constants did.
  const kindsOf = (src) => {
    const sf = parseSourceFile('k.test.ts', src, ts.ScriptKind.TSX);
    const out = [];
    const visit = (n) => {
      if (ts.isObjectLiteralExpression(n) || ts.isClassDeclaration(n)) {
        for (const m of (ts.isObjectLiteralExpression(n) ? n.properties : n.members)) {
          if (SCANNED_VERBS.has(memberName(m))) out.push(initializerKind(m));
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
    return out.join();
  };
  expect('#9943 — the census gives a DEFAULTED initializer a bucket of its own, which is the row '
    + 'the CallExpression-scoped census could not have had',
    kindsOf('const e = { delete: o.delete ?? vi.fn(f) };') === 'defaulted `??`');
  expect('#9943 — …and a plain call still reads as CallExpression (the split discriminates)',
    kindsOf('const e = { delete: vi.fn(f) };') === 'CallExpression');
  expect('#9943 — a shorthand member is its own kind, so it cannot hide inside another bucket',
    kindsOf('const e = { update };') === 'shorthand member');
  expect('#9943 — a method body is its own kind too', kindsOf('const e = { async update(o, d) {} };') === 'method body');

  const assignSites = (src) => objectAssignSites(
    parseSourceFile('a.test.ts', src, ts.ScriptKind.TSX), SCANNED_VERBS,
  );
  let sites = assignSites('const ql = Object.assign(makeQl(), { async find() { return []; }, async insert() { return null; } });');
  expect('#8553 — an Object.assign override varying OTHER engine members reads as BASE-accounted '
    + '(the shape #8537 actually used, and inheriting is correct there)',
    sites.length === 1 && sites[0].shape === 'BASE' && sites[0].counted === false);
  sites = assignSites('const ql = Object.assign(makeQl(), { async delete(o: string, opts?: any) { return true; } });');
  expect('#8553 — an override that RESTATES the verb with too few siblings of its own is the hole, '
    + 'and the census names it rather than leaving it silent',
    sites.length === 1 && sites[0].shape === 'VERB' && sites[0].counted === false);
  sites = assignSites('const ql = Object.assign(makeQl(), { async delete(o: string, opts?: any) { return true; }, '
    + 'async find() { return []; }, async insert() { return null; } });');
  expect('#8553 — …and an override carrying two engine siblings of its own IS counted in its own '
    + 'right, so the census does not report a double the population already holds',
    sites.length === 1 && sites[0].shape === 'VERB' && sites[0].counted === true);

  if (failures.length) {
    for (const f of failures) console.error(`  x self-test: ${f}`);
    console.error(`\ncheck-engine-double-contract --self-test: ${failures.length} failure(s).\n`);
    process.exit(1);
  }
  console.log(
    'OK  self-test: separates engine doubles from driver doubles AND from scoped repositories on '
      + 'BOTH write verbs, admits a verb that declares fewer than two parameters only on '
      + "engine-vs-driver sibling evidence, accepts only that slice's producer predicate (direct or "
      + "one helper deep) and never the other slice's, rejects unused imports, hand-mirrored guards "
      + 'and look-alikes, keeps an engine double in scope however many by-id helpers it declares, '
      + 'reads the implementation a MOCK CONSTRUCTOR wraps on both the object-literal and the '
      + 'class-field spelling while refusing the three call shapes that wrap no implementation and '
      + 'still vetoing a driver at that spelling, '
      + 'reports EXACTLY the engine double out of a fixture holding both shapes, and proves '
      + 'discovery reaches the real tree for every slice; and, on the CONSUMER SEAMS, admits a '
      + 'by-id write only when the id is caller-supplied AND a receipt is answered, reads the '
      + 'inline / const-bound / one-wrapper options forms, refuses to read a $in predicate as '
      + 'by-id, accepts a probe, a driver boolean and a one-method-hop helper as refusals alike, '
      + 'separates the shared envelope from a local mint, discounts a refusal that lands after '
      + 'the receipt, and REPORTS the seam that answers without refusing at all; and, on the '
      + 'UNRECOGNISED CENSUS (#9747), counts a construct whose implementation exists but cannot '
      + 'be reached (a function among several arguments, a binding whose value it cannot read, an '
      + 'imported one), SCOPES '
      + 'OUT the two '
      + 'spellings that carry no implementation at all rather than reporting them as noise, '
      + 'ignores constructs with too few engine siblings to be in scope, and cannot move one '
      + 'double into or out of the population it counts; and reads a DEFAULTED initializer '
      + '(#9877) on both arms of `??` and `||`, pinned and unpinned alike, while still vetoing a '
      + 'driver there and still refusing a conditional; carries the INHERITANCE rule (#8553) on '
      + 'BOTH ratchet remedies with a detector that rejects the two-option framing; and buckets '
      + 'the RECOGNIZER CENSUS (#9943) by initializer kind so a spelling this gate cannot read '
      + 'shows up as its own row rather than as silence; and resolves a BARE LOCAL BINDING '
      + '(#10175) on both the named-initializer and the shorthand spelling -- through the SCOPE '
      + 'CHAIN, so a shadowed name reads the nearest declaration and not a file-wide match -- '
      + 'carrying the pinned verdict and the driver veto across that hop, refusing a parameter, an '
      + 'import and a cycle, and reading one shared pre-filter that admits the shorthand spellings '
      + 'so discovery and the census cannot be scoped differently.',
  );
}

if (process.argv.includes('--self-test')) selfTest();
else if (process.argv.includes('--write')) writeLedger();
else if (process.argv.includes('--census')) censusReport();
else report();
