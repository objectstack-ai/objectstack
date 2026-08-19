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

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE_PATH = join(ROOT, 'scripts', 'engine-double-contract.baseline.json');
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
 * Full census of the scanned corpus — every `delete`/`update` member whose
 * initializer is a CallExpression, 310 of them, no truncation:
 *
 *   163  vi.fn()                              no argument at all
 *    89  vi.fn(fn)                            ← the implementation
 *    39  vi.fn().mockResolvedValue(value)     a VALUE, not an implementation
 *     9  rec('DELETE')                        local recorder factory, string arg
 *     4  vi.fn().mockImplementation(fn)       ← the implementation
 *     3  record('DELETE')                     ditto
 *     2  on('DELETE')                         ditto
 *     1  vi.fn().mockRejectedValue(ERR())     a value, from a call
 *
 * So the criterion is STRUCTURAL and callee-agnostic: a call carrying EXACTLY
 * ONE argument which is a function expression / arrow function. That admits the
 * 93 that hold an implementation (`vi.fn(fn)` and, for free and correctly, the
 * chained `.mockImplementation(fn)` — the arrow there IS what the double runs)
 * and rejects all 217 that do not, without an allowlist of callee names that
 * would go silently blind the day someone writes `vitest.fn` or a local wrapper.
 *
 * Deliberately NOT widened, both measured at ZERO occurrences on this corpus:
 *
 *   - a function among SEVERAL arguments (`traced('delete', fn)`). The card's
 *     phrasing is "sole function argument" and the narrow reading is the one
 *     that cannot mistake a lifecycle callback for the verb's implementation.
 *   - a function in the chained receiver (`vi.fn(fn).mockResolvedValue(v)`),
 *     which would need this to recurse into `init.expression`.
 *
 * Both are measurements, not opinions — re-run that census before widening,
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
 * One initializer reading, shared by BOTH initializer spellings below.
 *
 * Shared on purpose: the object-literal (`PropertyAssignment`) and class-field
 * (`PropertyDeclaration`) branches carried the same three lines twice and drifted
 * apart in exactly the way that produced #8639's sibling half — a fix applied to
 * one spelling and not the other reproduces this card at the next reading. With
 * one function there is no second copy to forget.
 */
function fnInitializer(init) {
  if (!init) return null;
  if (ts.isFunctionExpression(init) || ts.isArrowFunction(init)) return init;
  return unwrapCallImpl(init);
}

/** A member's function-ish implementation, or null. */
function implOf(member) {
  if (ts.isMethodDeclaration(member) || ts.isMethodSignature(member)) return member;
  if (ts.isPropertyAssignment(member)) return fnInitializer(member.initializer);
  if (ts.isPropertyDeclaration(member)) return fnInitializer(member.initializer);
  if (ts.isShorthandPropertyAssignment(member)) return null;
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

function isEngineVerbShape(fn, memberNames = new Set()) {
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
  // Measured before it was written, over the 250 doubles this gate discovers:
  // the pair moves exactly 2, both of them #5945's witnesses, and 0 of the 82
  // PINNED doubles. Widening it is a measurement, not an opinion — re-run that
  // count before adding a name here.
  if (!takesObjectNameFirst(fn)) {
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
function scanSource(fileName, text, slice = SLICES[0]) {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
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
    if (!isEngineVerbShape(target, names)) return;
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
//                 declined, or it roots at a binding this file declares. Each
//                 one is a double that could be looser than the producer and
//                 is in no ledger. Reported by file, line and spelling.
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
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
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
      if (!new RegExp(`\\b${slice.verb}\\s*[(:,}]`).test(text)) continue;
      const c = censusSource(abs, text, slice);
      scopedOut += c.scopedOut.length;
      for (const u of c.unrecognised) rows.push({ verb: slice.verb, file: rel, ...u });
    }
  }
  rows.sort((a, b) => (a.file === b.file ? a.line - b.line : a.file < b.file ? -1 : 1));
  return { rows, scopedOut };
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
// Four seams, zero exemptions, and no ledger -- which is the whole reason this
// invariant is worth having and the per-double one was not.
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

/** Production sources: the seams live in `src`, never in a test. */
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
  walkSrc(join(ROOT, 'packages'));
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
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const envelopeNames = envelopeImportsOf(sf);
  const localFns = localFunctions(sf);
  const methodFns = classMethods(sf);
  const seams = [];
  const seen = new Set();

  const visit = (n) => {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)
      && ts.isIdentifier(n.expression.name)) {
      const verb = n.expression.name.text;
      if (verb === 'update' || verb === 'delete') {
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

// ── Baseline ────────────────────────────────────────────────────────────────

function readBaseline() {
  if (!existsSync(BASELINE_PATH)) return { entries: [] };
  return JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
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
    if (!new RegExp(`\\b${slice.verb}\\s*[(:]`).test(text)) continue;
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
            + 'rather than raising it.',
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

  // ── The consumer seams (#8194) ────────────────────────────────────────────
  const seamFiles = scanAllSeams();
  const seamCount = seamFiles.reduce((n, f) => n + f.seams.length, 0);

  // SEAMS_DISCOVERED — the #4868 shape again, and the reason this is an ERROR
  // rather than a quiet zero: REFUSES iterates the discovered set, so a scan
  // that silently stops matching (a seam refactored to a shape the three
  // conjuncts no longer read) makes this script print OK while checking
  // nothing. Four seams is what the tree measured; zero is a broken scan.
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

  return { slices, baseline, errors, seamFiles, seamCount };
}

function report() {
  const { slices, baseline, errors, seamFiles, seamCount } = audit();

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
  console.log('');

  // ── The UNRECOGNISED verdict (#9747) ──────────────────────────────────────
  // Printed on EVERY run, green or red, and before the failure branch below:
  // a count that only appears on a clean run would be invisible exactly when a
  // reader is looking hardest. It is a verdict, never a finding -- nothing
  // here can change this script's exit code.
  const census = censusUnrecognised();
  console.log(
    `UNRECOGNISED [engine-double-contract]: ${census.rows.length} construct(s) in ${SCAN_ROOTS.join(", ")} `
      + `declare a scanned verb (${[...SCANNED_VERBS].join(', ')}) alongside engine siblings, and this gate `
      + 'could not read the implementation -- so they are in NEITHER the pinned population nor the ledger. '
      + `${census.scopedOut} further construct(s) are SCOPED OUT by a stated criterion and are not counted here. `
      + 'This is a verdict, not a finding: it never fails a run (#9747, ruling of 2026-08-18).',
  );
  for (const r of census.rows) {
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

  // The seam list is printed in full, refusal spelling included. It is four
  // rows, it is the whole subject of the #8194 invariant, and a `local` row is
  // how the one remaining divergence stays visible without a ledger entry
  // pretending it is accepted.
  if (seamFiles.length) console.log('');
  for (const { file, seams } of seamFiles) {
    for (const s of seams) {
      console.log(`  seam [${s.refusal ?? 'NONE'}]  ${file}:${s.line}  ${s.fn}() — by-id ${s.verb}`);
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
      + `${exempt.length} exempt.\n`,
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
    const f = ts.createSourceFile('t.ts', src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
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
  const unmarkedOffer = `PINNED: add a MEASURED entry to ${BASELINE_REL} saying why not.`;
  expect('#8435 — the synthetic unmarked-offer fixture is still recognised as an offer',
    RATCHET_EXPANSION_OFFER.test(unmarkedOffer));
  expect('#8435 — ratchetRemedyCarriesAuthority() REJECTS an offer carrying no marker (proves the '
    + 'predicate discriminates rather than approving everything)',
    !ratchetRemedyCarriesAuthority(unmarkedOffer));

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

  c = censusSource('c.test.ts', censusFake('delete: overrides.delete ?? vi.fn(async (o: string, opts?: any) => true),'), D);
  expect('#9747 — an initializer carrying a function the unwrap declined is UNRECOGNISED',
    c.unrecognised.length === 1 && c.unrecognised[0].why.includes('declined to unwrap'));

  c = censusSource('c.test.ts', censusFake('delete: del,',
    'const del = async (o: string, opts?: any) => true;\n'), D);
  expect('#9747 — an initializer rooting at a binding this file declares is UNRECOGNISED',
    c.unrecognised.length === 1 && c.unrecognised[0].why.includes('`del`'));

  // The shorthand limb is driven on the UPDATE slice, not delete: `{ delete }`
  // is not valid shorthand (a reserved word), so the delete spelling could
  // never occur in the tree and a fixture using it would assert nothing. Every
  // shorthand row the real corpus carries is an `update`.
  c = censusSource('c.test.ts', `
const update = async (o: string, data: any, opts?: any) => data;
const engine: any = { registry: {}, insert: async (o: string, d: any) => d, findOne: async (o: string) => null, update };
`, SLICES.find((s) => s.verb === 'update'));
  expect('#9747 — a shorthand member is UNRECOGNISED',
    c.unrecognised.length === 1 && c.unrecognised[0].why.includes('shorthand'));

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
  const visSrc = censusFake('delete: del,', 'const del = async (o: string, opts?: any) => true;\n');
  expect('#9747 — a construct in the UNRECOGNISED census is still absent from the population '
    + '(the census cannot widen discovery)',
    censusSource('c.test.ts', visSrc, D).unrecognised.length === 1
      && scanSource('c.test.ts', visSrc, D).length === 0);

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
      + 'be reached (a defaulted mock, a local binding, a shorthand), SCOPES OUT the two '
      + 'spellings that carry no implementation at all rather than reporting them as noise, '
      + 'ignores constructs with too few engine siblings to be in scope, and cannot move one '
      + 'double into or out of the population it counts.',
  );
}

if (process.argv.includes('--self-test')) selfTest();
else report();
