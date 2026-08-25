#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// check-objectql-double-limit -- an in-memory ObjectQL `find` double inside a
// test file must APPLY the caller's `limit`, or REFUSE it loudly (#11525, from
// #10978; the conversion lane PR #11521).
//
//   node scripts/check-objectql-double-limit.mjs
//   node scripts/check-objectql-double-limit.mjs --self-test
//   node scripts/check-objectql-double-limit.mjs --census   # measure, never fail
//
// ## The failure mode this exists for
//
// A hand-written `find(object, opts)` double that matches `opts.where` and
// hands back every matched row cannot tell a read bounded at 200 from the same
// read bounded at 1000, or from one carrying no bound at all. Every limit
// change on such a read is green BY CONSTRUCTION, and the production symptom is
// a SILENTLY TRUNCATED result set rather than an error -- so the suite never
// goes red and the truncation reaches an authorization input.
//
// The worked example is #10978's: `resolveUserAuthzGrants` reads `sys_member`
// twice, `{user_id}` at 200 and `{organization_id}` at 1000. The obvious "same
// object, fold the two reads" cleanup caps the fellow-org peer list
// (`org_user_ids`, an RLS input) at 200 for any organization with more members.
// Under a limit-blind double both bounds return every row and the fold is
// invisible.
//
// #7620 / `check-where-matcher-conformance` is the precedent, and its lesson is
// the reason this is a GATE rather than a second conversion PR:
//
//   > the doubles were made right, and nothing held them right
//
// PR #11521 made nine right. Nothing held them right, and nothing stopped the
// rest from being joined by one more.
//
// ## The criterion, in one sentence
//
//   > A discovered `find` double must APPLY the caller's `limit` -- by
//   > PRESENCE, AFTER the filter, and BEFORE any stage that touches the rows --
//   > or REFUSE it by throwing. What it must never do is silently ignore it.
//
// Refusal counts as conforming on purpose, for the same reason it does next
// door: the defect class is SILENCE, not incompleteness. A double that throws
// the moment a bound arrives cannot make a suite green while answering a
// different query; it makes the suite RED. That is not this gate's invention --
// `packages/objectql/src/engine-autonumber-*.test.ts` already refuses unknown
// operators with its own recorded reason.
//
// ## The three shape rules, and how each is ENCODED
//
// #11525 pins three details settled by the landed nine. This gate encodes them
// as probes, and the encoding of the third is honest about a limit it cannot
// cross:
//
//   1. PRESENCE, NOT TRUTHINESS -- `typeof opts?.limit === 'number'`, so
//      `limit: 0` returns NOTHING rather than the whole table. `0` is falsy, so
//      `opts.limit ? ... : rows` answers a request for nothing with everything.
//      Measured precedent in-repo: `driver-memory`'s `query.limit !== undefined`.
//      ENCODED by the `presence` probe: `limit: 0` must return zero rows.
//
//   2. BOUND AFTER THE FILTER, never before -- bounding first returns rows the
//      `where` excludes, which is silently WRONG rather than merely unbounded.
//      ENCODED by putting the NON-matching rows FIRST in the probe corpus: a
//      double that slices before it filters cannot reach the requested count.
//
//   3. BOUND BEFORE ANY STAGE THAT TOUCHES THE ROWS (the "bound before the
//      wrap" rule) -- where a double wraps rows, a row the real read would
//      never have returned must not be handed to the wrapper either.
//      ENCODED by per-row READ COUNTERS; see the next section, which also
//      states exactly where the encoding stops and why stopping there is not a
//      hole.
//
// ## Rule 3 is PROVABLE in one direction only -- and that is not a hole
//
// Bounding before or after a PURE wrap produces identical returned values: the
// wrappers built for rows outside the bound are discarded, and nothing outside
// the double can count objects that were never returned. So no black-box probe
// can distinguish the two orders in general. What a probe CAN see is the rows
// the later stage TOUCHED, via accessor properties that count their own reads.
//
// In the bounded probe run (misses at 0..1, matches at 2..8, `limit: 3`):
//
//     W = reads of row 2   a match INSIDE the bound
//     B = reads of row 8   a match OUTSIDE the bound
//     M = reads of row 0   a miss -- read by the filter and nothing else
//
//   W > B                 -> PROVEN: the touching stage ran only for rows the
//                           bound admitted. Conforming.
//   W === B === M         -> nothing after the filter touched any row. Either
//                           there is no transform, or it is LAZY (an observation
//                           Proxy reads nothing when it is constructed).
//                           Conforming -- see below.
//   W === B > M, and the
//   double TRANSFORMS     -> rows outside the bound were touched exactly as much
//   and does not reorder     as rows inside it. The bound is applied after a
//                           row-touching stage. RED.
//
// The middle row is the one worth being precise about, because it looks like a
// gap and is not. When the later stage touches nothing -- the lazy observation
// Proxy, which is the ONLY wrapper shape in this corpus -- the order is not
// merely unobservable, it is BEHAVIOURALLY IRRELEVANT: a wrapper built for a
// row that is then discarded records nothing, because a lazy wrapper does its
// recording when the CONSUMER reads it and no consumer ever sees it. Rule 3
// bites exactly when the later stage is EAGER, and that is exactly the case
// these counters can see.
//
// The residual is therefore narrow and named rather than broad and implied: a
// transform with a side effect that does not read the row it transforms (a bare
// counter increment inside the `.map`) is invisible here, as is a double that
// reads its matched rows after filtering WITHOUT reordering them and then wraps
// them lazily. Both are pinned as self-test fixtures so they stay KNOWN limits,
// and every run PRINTS how many doubles landed in each wrap-order state.
//
// ## How a candidate is discovered -- and why the control probe IS the filter
//
// Discovery is structural: a function bound to a property named `find` (a method
// in an object literal or class, or `find: (…) => …`) in `packages/**/*.test.ts`,
// taking at least one parameter. That over-matches enormously on its own --
// `find` is also a Map lookup, a registry read, an array search -- so, exactly
// as next door, every candidate must then pass a CONTROL probe before it is
// graded at all:
//
//     await f(OBJ, { where: { F: 'yes' } })  -> only the F:'yes' rows, >= 1
//     await f(OBJ, { where: { F: 'no'  } })  -> only the F:'no'  rows, >= 1
//
// A candidate that cannot do that is not a query-honouring row-selecting `find`
// and is dropped OUT OF SCOPE rather than reported. Membership is decided by
// BEHAVIOUR, never by a name -- the failure `check-engine-double-contract`
// documents, where `o` is the object name in twelve doubles and the options bag
// in a thirteenth. It also means a double cannot pass vacuously by returning
// everything: the control catches that before the battery runs.
//
// The seat is granted on a POSITIVE reading, never on the absence of a negative
// one. A double may answer both control probes with rows of its OWN -- constant
// stubs (`async find(o, q) { return [{ id: 'r1' }]; }`), or schema-signature
// fixtures that exist only to satisfy a `parse()`. Those rows carry none of the
// probe's fields, so the control reads nothing from them and obtains no evidence
// of filtering whatever. Treating "could not read" as "did not fail" seats them,
// and they then grade BLIND -- debt with NO POSSIBLE REMEDY, because there is no
// corpus to bound. Measured on this corpus: 19 of 294 seated candidates. They are
// routed by structure instead, by the same fallthrough every unseated candidate
// takes: OUT OF SCOPE when the body never filters, UNJUDGED -- declared, never
// skipped -- when it does but this lift cannot drive it.
//
// ## Driving a double whose rows live in a closure
//
// Unlike a `matches(row, where)` matcher, a `find` double reads its rows from an
// ENCLOSING binding -- `makeQl(tables)`, `makeQl(rows)`, a module-scope fixture
// array. So the lift binds them: the double's source is transpiled together with
// the same-file declarations it references, and any name still free at call time
// is bound to a ROW STUB -- one value that answers as an array (`rows.filter`),
// as a table map (`tables[object] ?? []`), and as a callable (`store.get(o)`),
// so a single binding covers every row-source spelling in the corpus without
// this gate guessing which one it is looking at.
//
// Two binding strategies are tried, in order, and the control probe decides:
//
//   1. lift same-file declarations, stub what is still free. The common shape --
//      the rows come from a factory PARAMETER no standalone lift can supply.
//   2. additionally stub every same-file declaration whose initializer is an
//      array or object literal. The module-scope FIXTURE shape, where lifting
//      the declaration succeeds but binds the file's own rows, which carry none
//      of the probe's fields -- a double that would then read as "returns
//      nothing" and be dropped as out of scope.
//
// The object NAME is searched the same way: many doubles answer `[]` for every
// object but one (`if (object !== 'sys_api_key') return []`). The probe tries a
// synthetic name first, then each string literal in the body, and keeps the
// first that passes the control probe. Nothing here asserts what the right name
// is; the control probe reports it.
//
// Only the double and the declarations it names are executed -- never the test
// file, never a suite. Anything that cannot be driven this way is UNJUDGED and
// must be declared; it is never treated as passing.
//
// ## Why this gate hand-copies its scope walk instead of importing one
//
// `check-where-matcher-conformance` carries a near-identical `visibleDeclarations`
// walk. Importing it was rejected for that gate's own recorded reason, which
// applies unchanged here: "a gate that imports its own substrate from another
// gate's file couples two tripwires that must be able to fail independently."
// The two gates must be able to go red separately and be edited separately.
//
// ## Invariants
//
//   DISCOVERED  the scan seated `find` doubles at all. Zero is not "a clean
//               repo", it is a broken scan: every other invariant iterates the
//               seated set, so a discovery that silently stopped matching would
//               print OK while checking nothing.
//   BOUNDED     every seated double applies the caller's `limit`, or refuses it
//               loudly -- or its file carries a measured baseline entry.
//   SHAPED      every double that DOES apply the bound applies it by presence,
//               after the filter, and before any row-touching stage. The measured
//               population DOES contain shape breakers (32 of them, nearly all
//               reading the bound by truthiness), so they are grandfathered like
//               the blind ones -- but under their OWN `wrong` count, never folded
//               into `blind`. The two have different remedies, and a folded count
//               cannot tell a repair from a regression.
//   JUDGED      every seated double was actually drivable. "Could not run" is a
//               failure, not a skip (AGENTS.md, "Absence must be loud"), and is
//               declared per file in the baseline's `unjudged` count.
//   RECONCILED  in both directions. An entry whose count is now LOWER, or whose
//               file is now clean or gone, is an error -- ratchet it down in the
//               same PR. A ratchet that can only accrete rots into a list nobody
//               reads.
//   MONOTONIC   the baseline key set only ever SHRINKS, measured against the
//               merge base with origin/main. Counts alone cannot see the last
//               move: a newly-added file matching its own count would sail
//               through, turning the ledger into a general-purpose mute button
//               (the SLOT_LOOKUP_UNSWEPT precedent, #4251).
//
// The baseline records the STANDING DEBT this gate was filed over and never
// grows. There is deliberately no `--update` / `--fix` flag, for the reason
// `check-engine-double-contract` gives: a generator would let a new limit-blind
// double be admitted by "just run the update command", which is precisely how a
// gate stops meaning anything. Ratcheting down is editing one number by hand --
// the failure output prints exactly what was measured.

import { readdirSync, statSync, readFileSync, existsSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { requireDefaultExport } from './import-prerequisite.mjs';
const ts = await requireDefaultExport('typescript', () => import('typescript'), import.meta.url);
import { parseSourceFile, transpileChecked } from './ts-parse.mjs';
import { isEntrypoint } from './invoked-as.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const BASELINE_PATH = 'scripts/objectql-double-limit.baseline.json';
const SCAN_ROOT = 'packages';

// ---------------------------------------------------------------------------
// The probe vocabulary. Field names are deliberately synthetic so no double can
// special-case them (many branch on `organization_id`, `user_id`, `id`).
// ---------------------------------------------------------------------------
const F = '__os_bound_field';
const G = '__os_bound_other';
const SYNTHETIC_OBJECT = '__os_bound_object';

/** Row plan: MISSES FIRST, so a double that bounds before it filters is short. */
const MISS_COUNT = 2;
const MATCH_COUNT = 7;
const ROW_COUNT = MISS_COUNT + MATCH_COUNT;
const NARROW_LIMIT = 3; // < MATCH_COUNT, and > MISS_COUNT so slicing first shows
const WIDE_LIMIT = 5;

const MATCH_WHERE = () => ({ [F]: 'yes' });
const MISS_WHERE = () => ({ [F]: 'no' });

/**
 * Probe rows whose fields COUNT THEIR OWN READS. The counters are what make
 * rule 3 (bound before any row-touching stage) observable at all: the filter
 * reads every row once, so a later stage shows up as reads a MISS row never
 * gets. Enumerable and configurable so a spread / clone / `JSON.stringify`
 * transform reads them exactly as it would read a plain row.
 */
function makeProbeRows(counters) {
  const rows = [];
  for (let i = 0; i < ROW_COUNT; i++) {
    const matched = i >= MISS_COUNT;
    const row = {};
    const define = (key, value) => {
      Object.defineProperty(row, key, {
        get() { counters[i] += 1; return value; },
        enumerable: true,
        configurable: true,
      });
    };
    define(F, matched ? 'yes' : 'no');
    define(G, `g${i}`);
    rows.push(row);
  }
  return rows;
}

/**
 * The ROW STUB -- one value standing in for every row-source spelling in the
 * corpus, so the lift never has to guess which one a double uses:
 *
 *   rows.filter(...)          array methods, indices, length, iteration
 *   tables[object] ?? []      any unknown property answers with the stub again
 *   store.get(object)         and the stub is callable, answering with the rows
 *
 * A Proxy over a FUNCTION target, because only a callable target can carry an
 * `apply` trap; array behaviour is forwarded to the real rows array.
 */
function makeRowStub(rows) {
  // The target is an ARROW, not `function () {}`: a normal function carries a
  // non-configurable own `prototype`, and the proxy invariant then rejects an
  // `ownKeys` trap that does not report it ("trap result did not include
  // 'prototype'"), which surfaces as an unjudged double rather than as anything
  // legible. An arrow has no `prototype`, so the array's keys are the whole
  // answer -- and it is not a constructor, which nothing here needs it to be.
  const stub = new Proxy(() => {}, {
    get(_t, prop, receiver) {
      if (prop === Symbol.toStringTag) return 'Array';
      // `then` must answer UNDEFINED, never the stub. A double that returns the
      // stub itself is then `await`ed as a thenable, the stub's `apply` trap
      // answers instead of calling `resolve`, and the probe hangs FOREVER --
      // measured, and it presents as "unsettled top-level await" with no clue
      // which double did it.
      if (prop === 'then' || prop === 'catch' || prop === 'finally') {
        return Reflect.has(rows, prop) ? Reflect.get(rows, prop).bind(rows) : undefined;
      }
      if (Reflect.has(rows, prop)) {
        const value = Reflect.get(rows, prop, receiver === stub ? rows : receiver);
        return typeof value === 'function' ? value.bind(rows) : value;
      }
      return stub;
    },
    has(_t, prop) { return Reflect.has(rows, prop); },
    ownKeys() { return Reflect.ownKeys(rows); },
    getOwnPropertyDescriptor(_t, prop) {
      const d = Reflect.getOwnPropertyDescriptor(rows, prop);
      return d ? { ...d, configurable: true } : undefined;
    },
    // Answers with the STUB, never with the bare rows array. `seen.get(t)`
    // and `storeFor(object)` are the same shape as `rows`, and a call that
    // handed back the raw array made the NEXT hop fail (`cols.add is not a
    // function`) -- filing a perfectly drivable double as unjudged. The stub is
    // array-like, so `Array.from(x.values())` and `x.filter(...)` both still work.
    apply() { return stub; },
  });
  return stub;
}

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------
const isFnExpr = (n) => ts.isFunctionExpression(n) || ts.isArrowFunction(n);
const isAsync = (n) =>
  (n.modifiers ?? []).some((m) => m.kind === ts.SyntaxKind.AsyncKeyword);

/** Same-file declarations visible from `node`, innermost scope first. */
function visibleDeclarations(node, sf) {
  const decls = new Map();
  for (let cur = node.parent; cur; cur = cur.parent) {
    const stmts = ts.isSourceFile(cur)
      ? cur.statements
      : (cur.statements ?? (cur.body && cur.body.statements));
    if (!stmts) continue;
    for (const s of stmts) {
      if (ts.isVariableStatement(s)) {
        for (const d of s.declarationList.declarations) {
          if (ts.isIdentifier(d.name) && d.initializer && !decls.has(d.name.text)) {
            const literal =
              ts.isArrayLiteralExpression(d.initializer) ||
              ts.isObjectLiteralExpression(d.initializer);
            const fnLike =
              ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer);
            decls.set(d.name.text, {
              text: `let ${d.name.text} = ${d.initializer.getText(sf)};`,
              literal,
              fnLike,
            });
          }
        }
      } else if (ts.isFunctionDeclaration(s) && s.name && !decls.has(s.name.text)) {
        decls.set(s.name.text, { text: s.getText(sf), literal: false, fnLike: true });
      }
    }
  }
  return decls;
}

const identifiersIn = (src) => {
  const out = new Set();
  for (const m of src.matchAll(/\b([A-Za-z_$][A-Za-z0-9_$]*)\b/g)) out.add(m[1]);
  return out;
};

/** String literals in the body -- the object names a double may branch on. */
function stringLiteralsIn(fnNode, sf) {
  const out = [];
  const seen = new Set();
  const visit = (n) => {
    if (ts.isStringLiteral(n) && n.text && !seen.has(n.text)) {
      seen.add(n.text);
      out.push(n.text);
    }
    ts.forEachChild(n, visit);
  };
  visit(fnNode.body ?? fnNode);
  return out.slice(0, 10);
}

/**
 * Does this body READ LIKE an ObjectQL query double? This is NOT the admission
 * criterion -- the control probe is, and it is behavioural. This decides only
 * what an UNSEATED candidate MEANS: `find` is also a Map lookup, a registry read
 * and an array search, and a scan that filed every one of those as "could not
 * judge" would bury the population that matters under hundreds of entries of
 * manufactured debt. So a candidate that never seats is DEBT when it reads like
 * a query double and OUT OF SCOPE when it does not.
 */
const looksQueryShaped = (body) =>
  /\bwhere\b|\$filter|\bfilters\b/.test(body) && /\.filter\(|\.every\(|\.some\(|\bfor\s*\(/.test(body);

/** The lifted source of a `find`, as a standalone EXPRESSION. */
function expressionSourceOf(node, sf) {
  if (ts.isMethodDeclaration(node)) {
    const params = node.parameters.map((p) => p.getText(sf)).join(', ');
    return `${isAsync(node) ? 'async ' : ''}function (${params}) ${node.body.getText(sf)}`;
  }
  // A function expression or an arrow is already a valid expression; a named
  // function expression keeps its name, which is harmless inside the lift.
  return node.getText(sf);
}

/**
 * Structural candidates in one source text. Behavioural admission (the control
 * probe) happens later, in `judge` -- this stage only proposes.
 */
export function discoverInSource(text, label) {
  const out = [];
  if (!/\bfind\b/.test(text)) return out;
  const sf = parseSourceFile(label, text, ts.ScriptKind.TS);
  const visit = (node) => {
    let fn = null;
    if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'find') {
      fn = node;
    } else if (
      ts.isPropertyAssignment(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'find' &&
      isFnExpr(node.initializer)
    ) {
      fn = node.initializer;
    }
    if (fn && fn.body && fn.parameters.length >= 1) {
      const { line } = sf.getLineAndCharacterOfPosition(fn.getStart(sf));
      out.push({
        file: label,
        line: line + 1,
        queryShaped: looksQueryShaped(fn.body.getText(sf)),
        source: expressionSourceOf(fn, sf),
        declarations: visibleDeclarations(fn, sf),
        objectNames: [SYNTHETIC_OBJECT, ...stringLiteralsIn(fn, sf)],
      });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

// ---------------------------------------------------------------------------
// Lift
// ---------------------------------------------------------------------------
/**
 * `stubClass` widens what the lift REPLACES with the row stub, one class at a
 * time, because the row source is not always a parameter:
 *
 *   0  lift every same-file declaration; stub only what is still free at call
 *      time. The `makeQl(tables)` shape -- the rows come from a factory
 *      parameter no standalone lift can supply.
 *   1  + array / object literals. The module-scope FIXTURE shape: lifting
 *      succeeds and binds the file's OWN rows, which carry none of the probe's
 *      fields, so the double reads as "returns nothing" and would be dropped.
 *   2  + every non-function initializer. The STORE shape: `new Map()`, reached
 *      directly or through a same-file `storeFor(object)` helper. Measured: this
 *      class alone is the difference between judging and not judging a large
 *      fraction of the corpus, because a Map-backed store is the most common
 *      spelling in this repo and an empty lifted Map answers every probe with
 *      an empty array.
 *
 * Function-like declarations are never stubbed at any class: they are the
 * double's own `matches(row, where)` helpers, and replacing one would remove
 * the very filtering the control probe is there to observe.
 */
function buildCallable(candidate, stubbed, stubClass) {
  const self = '__os_find';
  const skip = new Set(stubbed);
  const included = new Map();
  let frontier = identifiersIn(candidate.source);
  for (let depth = 0; depth < 6; depth++) {
    const next = new Set();
    for (const id of frontier) {
      if (included.has(id) || id === self || skip.has(id)) continue;
      const decl = candidate.declarations.get(id);
      if (!decl) continue;
      if (stubClass >= 1 && decl.literal) { skip.add(id); continue; }
      if (stubClass >= 2 && !decl.fnLike) { skip.add(id); continue; }
      included.set(id, decl.text);
      for (const x of identifiersIn(decl.text)) next.add(x);
    }
    if (next.size === 0) break;
    frontier = next;
  }
  // The stub bindings come FIRST. A lifted declaration may itself name a stubbed
  // root (`let seeded = seed.map(...)`), and with the stubs emitted last that read
  // lands in the temporal dead zone -- which surfaces as `Cannot access 'seed'
  // before initialization` and files a perfectly drivable double as unjudged.
  const stubs = [...skip].map((id) => `let ${id} = __os_stub;`).join('\n');
  const code =
    `${stubs}\n${[...included.values()].join('\n')}\n` +
    `const ${self} = ${candidate.source};\nreturn ${self};`;
  // `transpileChecked` rather than the raw call: the raw one reports NOTHING
  // without `reportDiagnostics` and still returns an `outputText`, so a dropped
  // operand comes back as code `new Function` throws on, and that reads as
  // "could not judge" standing in for "could not read".
  const js = transpileChecked(`${candidate.file}#L${candidate.line}.lifted.ts`, code, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, isolatedModules: true },
  }).outputText;
  return { fn: new Function('__os_stub', js), stubbedNames: skip };
}

const REFERENCE_ERROR = /(?:^|\W)([A-Za-z_$][A-Za-z0-9_$]*) is not defined/;

/**
 * Describe a thrown value without ever throwing again. A double handed the row
 * stub can throw the stub itself, and `String(stub)` raises "Cannot convert
 * object to primitive value" -- an error INSIDE the error path, which took the
 * whole scan down on the first corpus run rather than filing one candidate as
 * unjudged.
 */
function describeThrown(e) {
  try {
    if (e instanceof Error) return `${e.name}: ${e.message}`;
    return String(e);
  } catch {
    return 'a value that cannot be described';
  }
}

/** One probe call: fresh rows, fresh counters, snapshot before we inspect. */
async function callOnce(factory, objectName, where, limit) {
  const counters = new Array(ROW_COUNT).fill(0);
  const rows = makeProbeRows(counters);
  const fn = factory(makeRowStub(rows));
  const opts = limit === undefined ? { where } : { where, limit };
  const value = await fn(objectName, opts);
  return { value, counters: [...counters], rows };
}

const asArray = (v) => (Array.isArray(v) ? v : null);

/** Does every returned row carry `F === want`? `null` when unreadable. */
function allCarry(list, want) {
  let seen = 0;
  for (const r of list) {
    if (r == null || typeof r !== 'object') return false;
    let v;
    try { v = r[F]; } catch { return false; }
    if (v === undefined) continue;
    seen += 1;
    if (v !== want) return false;
  }
  return seen === 0 ? null : true;
}

// ---------------------------------------------------------------------------
// Judgment
// ---------------------------------------------------------------------------
/**
 * Lift the double out and drive it. Returns one of:
 *   { verdict: 'OUT_OF_SCOPE' }        -- not a query-honouring row-selecting find
 *   { verdict: 'CONFORMING', … }       -- applies the bound, or refuses it loudly
 *   { verdict: 'BLIND' }               -- ignores the bound
 *   { verdict: 'WRONG', shapes }       -- applies it, but breaks a shape rule
 *   { verdict: 'UNJUDGED', why }       -- could not be lifted or driven
 */
export async function judge(candidate) {
  let seated = null;
  let lastError = null;
  let notAList = false;
  for (const stubClass of [0, 1, 2]) {
    const stubbed = new Set();
    let built = null;
    for (let attempt = 0; attempt < 10 && !seated; attempt++) {
      try {
        built = buildCallable(candidate, stubbed, stubClass);
      } catch (e) {
        lastError = `could not lift: ${describeThrown(e).slice(0, 110)}`;
        break;
      }
      const factory = (stub) => built.fn(stub);
      let retryName = null;
      for (const objectName of candidate.objectNames) {
        let hit, skip;
        try {
          hit = await callOnce(factory, objectName, MATCH_WHERE(), undefined);
          skip = await callOnce(factory, objectName, MISS_WHERE(), undefined);
        } catch (e) {
          const missing = REFERENCE_ERROR.exec(describeThrown(e))?.[1];
          if (missing && !stubbed.has(missing)) { retryName = missing; break; }
          lastError = `probe threw: ${describeThrown(e).slice(0, 110)}`;
          continue;
        }
        const hits = asArray(hit.value);
        const skips = asArray(skip.value);
        // An ObjectQL `find` answers with a LIST. A `find` that answers with a
        // record, a boolean or nothing is a different verb, not a double this
        // gate could not drive -- out of scope rather than debt.
        if (!hits || !skips) { notAList = true; continue; }
        if (hits.length === 0 || skips.length === 0) continue;
        // Seating demands a POSITIVE answer, never merely the absence of a
        // negative one. `allCarry` answers `null` when NO returned row carried
        // the probe's field -- the double handed back rows of its own, so the
        // control obtained no evidence that it filtered on the probe's `where`
        // at all. Reading `null` as "not disproven" seats a double the control
        // could not read (measured: 19 of 294, among them constant-returning
        // stubs like `async find(o, q) { return [{ id: 'r1' }]; }` and schema-
        // signature fixtures that exist only to satisfy a `parse()`), and then
        // grades it BLIND -- debt with no possible remedy, since there is no
        // corpus to bound. Unseated candidates fall through below and are
        // routed by structure: OUT_OF_SCOPE when the body never filters,
        // UNJUDGED -- declared, never skipped -- when it does.
        if (allCarry(hits, 'yes') !== true || allCarry(skips, 'no') !== true) continue;
        if (hits.length === ROW_COUNT || skips.length === ROW_COUNT) continue; // no filtering
        seated = { factory, objectName, unbounded: hit };
        break;
      }
      if (retryName) { stubbed.add(retryName); continue; }
      break;
    }
    if (seated) break;
  }
  if (!seated) {
    // A candidate the control probe never seated is either not a
    // query-honouring `find` at all (the common case -- `find` is also a Map
    // lookup and an array search) or one this lift could not drive. Only the
    // second is debt, and only a candidate that ERRORED can be told apart.
    if (!candidate.queryShaped || notAList) return { verdict: 'OUT_OF_SCOPE' };
    return { verdict: 'UNJUDGED', why: lastError ?? 'the control probe never seated it' };
  }

  const { factory, objectName, unbounded } = seated;
  const matched = asArray(unbounded.value).length;
  const run = async (limit) => callOnce(factory, objectName, MATCH_WHERE(), limit);

  let narrow, wide, zero;
  let refused = false;
  try {
    narrow = await run(NARROW_LIMIT);
  } catch {
    refused = true; // threw on a bound it does not implement -- loud, not silent
  }
  if (refused) return { verdict: 'CONFORMING', refused: true, matched, wrapOrder: 'n/a' };
  try {
    wide = await run(WIDE_LIMIT);
    zero = await run(0);
  } catch (e) {
    return { verdict: 'UNJUDGED', why: `bounded probe threw: ${describeThrown(e).slice(0, 110)}` };
  }

  const len = (p) => asArray(p.value)?.length ?? -1;
  const probes = {
    matched,
    unbounded: matched,
    narrow: len(narrow),
    wide: len(wide),
    zero: len(zero),
  };
  if (probes.narrow < 0 || probes.wide < 0 || probes.zero < 0) {
    return { verdict: 'UNJUDGED', why: 'a bounded probe did not return an array' };
  }

  // Blind: the bound changes nothing at all.
  if (probes.narrow === matched && probes.zero === matched) {
    return { verdict: 'BLIND', probes };
  }

  const shapes = [];
  if (probes.zero !== 0) {
    shapes.push('truthiness, not presence (`limit: 0` returns rows -- `0` is falsy)');
  }
  if (probes.narrow !== NARROW_LIMIT || probes.wide !== WIDE_LIMIT) {
    // The misses sit FIRST, so a double that slices before it filters cannot
    // reach the requested count. Reported with both readings so the message
    // still means something if a double is short for another reason.
    shapes.push(
      `bound applied BEFORE the filter (asked for ${NARROW_LIMIT}/${WIDE_LIMIT} of ` +
      `${matched} matches, got ${probes.narrow}/${probes.wide})`,
    );
  }

  // --- rule 3: the bound must precede any stage that touches the rows -------
  const returned = asArray(narrow.value) ?? [];
  const supplied = new Set(narrow.rows);
  const transforms = returned.length > 0 && returned.every((r) => !supplied.has(r));
  const c = narrow.counters;
  const within = c[MISS_COUNT];              // a match INSIDE the bound
  const beyond = c[ROW_COUNT - 1];           // a match OUTSIDE the bound
  const miss = c[0];                         // read by the filter and nothing else
  const ordered = returned.every((r, i) => {
    try { return r?.[G] === `g${MISS_COUNT + i}`; } catch { return false; }
  });
  let wrapOrder;
  if (!transforms) wrapOrder = 'no-transform';
  else if (within > beyond) wrapOrder = 'proven-after-bound';
  else if (beyond > miss && ordered) wrapOrder = 'before-bound';
  else wrapOrder = 'lazy-transform';
  if (wrapOrder === 'before-bound') {
    shapes.push(
      'a row-touching stage runs BEFORE the bound (rows outside the bound were ' +
      `read as often as rows inside it: ${within}/${beyond} vs ${miss} for a filtered-out row)`,
    );
  }

  if (shapes.length > 0) return { verdict: 'WRONG', probes, shapes, wrapOrder };
  return { verdict: 'CONFORMING', refused: false, matched, probes, wrapOrder };
}

// ---------------------------------------------------------------------------
// Corpus walk
// ---------------------------------------------------------------------------
function testFilesUnder(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === 'dist' || entry === '.git' || entry === '.cache') continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) testFilesUnder(p, acc);
    else if (/\.test\.ts$/.test(entry)) acc.push(p);
  }
  return acc;
}

/** Measure the whole corpus: file -> { blind, unjudged, details[] }. */
export async function measure() {
  const measured = new Map();
  const census = {
    proposed: 0, graded: 0, dropped: 0,
    conforming: 0, refusing: 0, blind: 0, wrong: 0, unjudged: 0,
    wrapOrder: { 'no-transform': 0, 'proven-after-bound': 0, 'lazy-transform': 0, 'before-bound': 0, 'n/a': 0 },
  };
  for (const abs of testFilesUnder(join(repoRoot, SCAN_ROOT))) {
    const rel = relative(repoRoot, abs).replace(/\\/g, '/');
    for (const candidate of discoverInSource(readFileSync(abs, 'utf8'), rel)) {
      census.proposed += 1;
      const result = await judge(candidate);
      if (result.verdict === 'OUT_OF_SCOPE') { census.dropped += 1; continue; }
      if (result.verdict !== 'UNJUDGED') census.graded += 1;
      if (result.wrapOrder) census.wrapOrder[result.wrapOrder] += 1;
      if (result.verdict === 'CONFORMING') {
        census.conforming += 1;
        if (result.refused) census.refusing += 1;
        continue;
      }
      if (!measured.has(rel)) measured.set(rel, { blind: 0, wrong: 0, unjudged: 0, details: [] });
      const bucket = measured.get(rel);
      if (result.verdict === 'BLIND') { bucket.blind += 1; census.blind += 1; }
      else if (result.verdict === 'WRONG') { bucket.wrong += 1; census.wrong += 1; }
      else { bucket.unjudged += 1; census.unjudged += 1; }
      bucket.details.push({ line: candidate.line, result });
    }
  }
  return { measured, census };
}

const KINDS = ['blind', 'wrong', 'unjudged'];
const countsOf = (v) => ({ blind: v.blind ?? 0, wrong: v.wrong ?? 0, unjudged: v.unjudged ?? 0 });

const describeDetail = (d) =>
  `line ${d.line}: ${d.result.verdict}` +
  (d.result.shapes ? ` -- ${d.result.shapes.join('; ')}` : '') +
  (d.result.why ? ` -- ${d.result.why}` : '');

export function reconcile(measured, baselineFiles) {
  const errors = [];
  for (const [file, v] of measured) {
    const now = countsOf(v);
    const allowed = baselineFiles[file] ? countsOf(baselineFiles[file]) : null;
    if (!allowed) {
      errors.push(
        `${file}: NEW ObjectQL \`find\` double that does not hold the caller's bound ` +
        `(${now.blind} blind, ${now.wrong} breaking a shape rule, ${now.unjudged} unjudged).\n` +
        `      ${v.details.map(describeDetail).join('\n      ')}\n` +
        `      Apply the caller's bound AFTER the filter, by PRESENCE:\n` +
        `        const page = typeof opts?.limit === 'number' ? rows.slice(0, opts.limit) : rows;\n` +
        `      or make the double THROW when it is handed a bound it does not implement.\n` +
        `      The baseline never grows.`,
      );
      continue;
    }
    for (const kind of KINDS) {
      if (now[kind] > allowed[kind]) {
        errors.push(
          `${file}: ${kind} double count grew ${allowed[kind]} -> ${now[kind]}. The file is ` +
          `grandfathered for its EXISTING doubles only.\n` +
          `      ${v.details.map(describeDetail).join('\n      ')}`,
        );
      } else if (now[kind] < allowed[kind]) {
        errors.push(
          `${file}: ${kind} count fell ${allowed[kind]} -> ${now[kind]} -- ratchet DOWN: set it ` +
          `to ${now[kind]} in ${BASELINE_PATH} (delete the entry when every count reaches 0).`,
        );
      }
    }
  }
  for (const file of Object.keys(baselineFiles)) {
    if (!measured.has(file)) {
      errors.push(
        `${file}: baselined file is clean or gone -- ratchet DOWN: delete its entry from ` +
        `${BASELINE_PATH}.`,
      );
    }
  }
  return errors;
}

function monotonicity(baselineFiles) {
  try {
    const git = (...args) =>
      execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    let base;
    for (const ref of ['origin/main', 'main']) {
      try { base = git('merge-base', 'HEAD', ref); break; } catch { /* try the next ref */ }
    }
    if (!base) return null;
    const previous = JSON.parse(git('show', `${base}:${BASELINE_PATH}`)).files ?? {};
    return { base: base.slice(0, 7), added: Object.keys(baselineFiles).filter((f) => !(f in previous)) };
  } catch {
    // No git, a shallow clone, or the baseline is new on this branch. Reported
    // rather than passed over -- a check that could not run must not read as a
    // check that passed.
    return null;
  }
}

// ---------------------------------------------------------------------------
// Self-test -- the detector can be broken while every double is fine
//
// Every fixture below is a whole test-file source, driven through the same
// `discoverInSource` + `judge` path the corpus walk uses. They cover the four
// verdicts, all three shape rules IN BOTH DIRECTIONS, both binding strategies,
// both wrap-order proofs, and the two residuals this gate declines to grade.
// ---------------------------------------------------------------------------
const MATCHER = `Object.entries(where).every(([k, v]) => (r as any)[k] === v)`;

/** The correct shape: presence, after the filter, inline. */
const FIXTURE_CORRECT = `
function makeQl(rows: any[]) {
  return {
    async find(object: string, opts: any) {
      const where = opts?.where ?? {};
      const matched = rows.filter((r: any) => ${MATCHER});
      return typeof opts?.limit === 'number' ? matched.slice(0, opts.limit) : matched;
    },
  };
}`;

/** The defect class: the bound is read by nobody. */
const FIXTURE_BLIND = `
function makeQl(rows: any[]) {
  return {
    async find(object: string, opts: any) {
      const where = opts?.where ?? {};
      return rows.filter((r: any) => ${MATCHER});
    },
  };
}`;

/** Shape rule 1, violated: `0` is falsy, so a request for NOTHING gets everything. */
const FIXTURE_TRUTHINESS = `
function makeQl(rows: any[]) {
  return {
    async find(object: string, opts: any) {
      const where = opts?.where ?? {};
      const matched = rows.filter((r: any) => ${MATCHER});
      return opts?.limit ? matched.slice(0, opts.limit) : matched;
    },
  };
}`;

/** Shape rule 2, violated: bounding first returns rows the `where` excludes. */
const FIXTURE_BEFORE_FILTER = `
function makeQl(rows: any[]) {
  return {
    async find(object: string, opts: any) {
      const where = opts?.where ?? {};
      const page = typeof opts?.limit === 'number' ? rows.slice(0, opts.limit) : rows;
      return page.filter((r: any) => ${MATCHER});
    },
  };
}`;

/** Shape rule 3, honoured, and PROVABLY so: the eager copy runs after the bound. */
const FIXTURE_EAGER_AFTER_BOUND = `
function makeQl(rows: any[]) {
  return {
    async find(object: string, opts: any) {
      const where = opts?.where ?? {};
      const matched = rows.filter((r: any) => ${MATCHER});
      const page = typeof opts?.limit === 'number' ? matched.slice(0, opts.limit) : matched;
      return page.map((r: any) => ({ ...r }));
    },
  };
}`;

/** Shape rule 3, violated: rows outside the bound are copied anyway. */
const FIXTURE_EAGER_BEFORE_BOUND = `
function makeQl(rows: any[]) {
  return {
    async find(object: string, opts: any) {
      const where = opts?.where ?? {};
      const matched = rows.filter((r: any) => ${MATCHER}).map((r: any) => ({ ...r }));
      return typeof opts?.limit === 'number' ? matched.slice(0, opts.limit) : matched;
    },
  };
}`;

/**
 * A LAZY wrapper placed before the bound. Not a finding, and the reason is the
 * point: a Proxy built for a row that is then discarded reads nothing and
 * records nothing, because a lazy wrapper does its work when the CONSUMER reads
 * it and no consumer ever sees it. Pinned so the "unprovable" state stays a
 * declared, GREEN state rather than drifting into a red one.
 */
const FIXTURE_LAZY_WRAP_BEFORE_BOUND = `
function makeQl(rows: any[]) {
  return {
    async find(object: string, opts: any) {
      const where = opts?.where ?? {};
      const matched = rows
        .filter((r: any) => ${MATCHER})
        .map((r: any) => new Proxy(r, { get: (t, p, rc) => Reflect.get(t, p, rc) }));
      return typeof opts?.limit === 'number' ? matched.slice(0, opts.limit) : matched;
    },
  };
}`;

/**
 * RESIDUAL, pinned: a transform whose side effect never reads the row it
 * transforms. The counter over-counts under this ordering and no black-box probe
 * can see it. A KNOWN limit, not an accidental one.
 */
const FIXTURE_ROW_BLIND_SIDE_EFFECT = `
function makeQl(rows: any[]) {
  let wrapped = 0;
  return {
    async find(object: string, opts: any) {
      const where = opts?.where ?? {};
      const matched = rows
        .filter((r: any) => ${MATCHER})
        .map((r: any) => { wrapped += 1; return new Proxy(r, {}); });
      return typeof opts?.limit === 'number' ? matched.slice(0, opts.limit) : matched;
    },
  };
}`;

/** Refusal conforms: the suite goes RED the moment a bound arrives. */
const FIXTURE_REFUSES = `
function makeQl(rows: any[]) {
  return {
    async find(object: string, opts: any) {
      if (opts?.limit !== undefined) throw new Error('fake driver: limit is not implemented');
      const where = opts?.where ?? {};
      return rows.filter((r: any) => ${MATCHER});
    },
  };
}`;

/** Structurally a candidate, behaviourally not a query double. Dropped. */
const FIXTURE_NOT_A_QUERY = `
const registry = {
  find(name: string) {
    return name.toUpperCase();
  },
};`;

/** A `find` that returns every row whatever the `where` says. Dropped. */
const FIXTURE_NO_FILTERING = `
function makeQl(rows: any[]) {
  return {
    async find(object: string, opts: any) {
      const where = opts?.where ?? {};
      void where;
      return rows;
    },
  };
}`;

/**
 * A `find` that answers with rows OF ITS OWN -- constants that carry none of the
 * probe's fields -- and never consults `where` at all. The control probe reads
 * nothing from the returned rows, so it obtains NO evidence of filtering; the
 * seat therefore has to be refused. Graded, it would read as limit-blind debt
 * with no possible remedy: there is no corpus to bound. This is the commonest
 * shape in the corpus (`async find(o, q) { return [{ id: 'r1' }]; }`).
 */
const FIXTURE_CONSTANT_ROWS = `
function makeQl(rows: any[]) {
  return {
    async find(object: string, opts: any) {
      void opts;
      return [{ id: 'r1' }];
    },
  };
}`;

/**
 * The same refusal, one step harder: the body IS query-shaped -- it names
 * `where` and it filters -- but the rows it answers with are its own, so the
 * control probe still reads nothing. Structure alone cannot dismiss this one,
 * so it must be DECLARED (`UNJUDGED`) rather than dropped or graded. Pinning
 * both fixtures pins the seating rule in both directions: a control that reads
 * "not disproven" as "proven" grades both of these BLIND.
 */
const FIXTURE_FOREIGN_ROWS = `
function makeQl(rows: any[]) {
  return {
    async find(object: string, opts: any) {
      const where = opts?.where ?? {};
      const roster = [{ user_id: 'u1' }, { user_id: 'u2' }];
      return roster.filter((r: any) => where.user_id == null || r.user_id === where.user_id);
    },
  };
}`;

/**
 * The shared-helper spelling. The gate is deliberately blind to WHICH spelling a
 * double uses -- it asks a question, it never hands out an implementation -- so
 * a repo-shared `bounded()` and a per-file copy grade identically. Pinned so the
 * answer to #11525's shared-vs-per-file question cannot be smuggled into the
 * gate as a preference.
 */
const FIXTURE_SHARED_HELPER = `
const bounded = <T,>(rows: T[], opts: any): T[] =>
  (typeof opts?.limit === 'number' ? rows.slice(0, opts.limit) : rows);
function makeQl(table: any[]) {
  return {
    async find(object: string, opts: any) {
      const where = opts?.where ?? {};
      return bounded(table.filter((r: any) => ${MATCHER}), opts);
    },
  };
}`;

/** Rows behind a table map keyed by the object name, and an object-name guard. */
const FIXTURE_TABLE_MAP = `
function makeQl(tables: Record<string, any[]>) {
  return {
    async find(object: string, opts: any) {
      if (object !== 'sys_member') return [];
      const rows = tables[object] ?? [];
      const where = opts?.where ?? {};
      return rows.filter((r: any) => ${MATCHER});
    },
  };
}`;

/** Binding strategy 2: rows come from a module-scope fixture, not a parameter. */
const FIXTURE_MODULE_FIXTURE = `
const seedRows = [{ id: 'a' }, { id: 'b' }];
const ql = {
  async find(object: string, opts: any) {
    const where = opts?.where ?? {};
    return seedRows.filter((r: any) => ${MATCHER});
  },
};`;

async function judgeFixture(src) {
  const found = discoverInSource(src, 'fixture.test.ts');
  const results = [];
  for (const c of found) results.push(await judge(c));
  return { found, results };
}

async function selfTest() {
  const failures = [];
  const expect = (label, cond) => { if (!cond) failures.push(label); };
  const one = async (src) => {
    const { found, results } = await judgeFixture(src);
    return { found, r: results[0], n: found.length };
  };

  const correct = await one(FIXTURE_CORRECT);
  expect('the correct fixture is discovered', correct.n === 1);
  expect('the correct fixture is CONFORMING', correct.r?.verdict === 'CONFORMING');
  expect('the correct fixture bounds, and reports what it measured',
    correct.r?.probes?.narrow === NARROW_LIMIT && correct.r?.probes?.zero === 0);

  const blind = await one(FIXTURE_BLIND);
  expect('the limit-blind fixture is discovered', blind.n === 1);
  expect('the limit-blind fixture is BLIND', blind.r?.verdict === 'BLIND');
  expect('the limit-blind fixture returns every match under a bound',
    blind.r?.probes?.narrow === MATCH_COUNT && blind.r?.probes?.zero === MATCH_COUNT);

  const truthy = await one(FIXTURE_TRUTHINESS);
  expect('shape rule 1 red: the truthiness fixture is WRONG', truthy.r?.verdict === 'WRONG');
  expect('shape rule 1 is attributed to presence, not to anything else',
    truthy.r?.shapes?.length === 1 && truthy.r.shapes[0].startsWith('truthiness'));
  expect('shape rule 1 red is driven by `limit: 0`, and the narrow bound still held',
    truthy.r?.probes?.zero === MATCH_COUNT && truthy.r?.probes?.narrow === NARROW_LIMIT);

  const early = await one(FIXTURE_BEFORE_FILTER);
  expect('shape rule 2 red: bounding before the filter is WRONG', early.r?.verdict === 'WRONG');
  expect('shape rule 2 is attributed to the filter order',
    early.r?.shapes?.some((s) => s.startsWith('bound applied BEFORE the filter')) === true);
  expect('shape rule 2 red is a SHORT read, not a long one',
    early.r?.probes?.narrow < NARROW_LIMIT && early.r?.probes?.wide < WIDE_LIMIT);

  const eagerOk = await one(FIXTURE_EAGER_AFTER_BOUND);
  expect('shape rule 3 green: an eager copy after the bound is CONFORMING',
    eagerOk.r?.verdict === 'CONFORMING');
  expect('shape rule 3 green is PROVEN, not assumed',
    eagerOk.r?.wrapOrder === 'proven-after-bound');

  const eagerBad = await one(FIXTURE_EAGER_BEFORE_BOUND);
  expect('shape rule 3 red: an eager copy before the bound is WRONG',
    eagerBad.r?.verdict === 'WRONG');
  expect('shape rule 3 is attributed to the row-touching stage',
    eagerBad.r?.shapes?.some((s) => s.startsWith('a row-touching stage runs BEFORE')) === true);
  expect('shape rule 3 red records the wrap-order state', eagerBad.r?.wrapOrder === 'before-bound');

  const lazy = await one(FIXTURE_LAZY_WRAP_BEFORE_BOUND);
  expect('a LAZY wrapper before the bound is CONFORMING -- the discarded wrappers do nothing',
    lazy.r?.verdict === 'CONFORMING');
  expect('and it is recorded as the lazy state rather than as a proof',
    lazy.r?.wrapOrder === 'lazy-transform');

  const sideEffect = await one(FIXTURE_ROW_BLIND_SIDE_EFFECT);
  expect('RESIDUAL: a row-blind side effect before the bound is not graded (declared limit)',
    sideEffect.r?.verdict === 'CONFORMING' && sideEffect.r?.wrapOrder === 'lazy-transform');

  const refuses = await one(FIXTURE_REFUSES);
  expect('the refusing fixture is CONFORMING', refuses.r?.verdict === 'CONFORMING');
  expect('the refusing fixture is recorded as refusing', refuses.r?.refused === true);

  const notQuery = await one(FIXTURE_NOT_A_QUERY);
  expect('a non-query `find` is a structural candidate', notQuery.n === 1);
  expect('the control probe drops a non-query `find`', notQuery.r?.verdict === 'OUT_OF_SCOPE');

  const noFilter = await one(FIXTURE_NO_FILTERING);
  expect('a `find` that never filters cannot pass vacuously',
    noFilter.r?.verdict === 'OUT_OF_SCOPE');

  const constant = await one(FIXTURE_CONSTANT_ROWS);
  expect('a constant-returning `find` is a structural candidate', constant.n === 1);
  expect('the control probe refuses a seat it could not read -- constants are OUT OF SCOPE, never BLIND',
    constant.r?.verdict === 'OUT_OF_SCOPE');

  const foreign = await one(FIXTURE_FOREIGN_ROWS);
  expect('a query-shaped double answering with rows of its own is not graded BLIND',
    foreign.r?.verdict !== 'BLIND');
  expect('it is DECLARED unjudged rather than dropped -- absence must be loud',
    foreign.r?.verdict === 'UNJUDGED');

  const shared = await one(FIXTURE_SHARED_HELPER);
  expect('a double bounded through a SHARED helper is discovered', shared.n === 1);
  expect('a double bounded through a SHARED helper is CONFORMING -- the gate reads behaviour, not spelling',
    shared.r?.verdict === 'CONFORMING');

  const tableMap = await one(FIXTURE_TABLE_MAP);
  expect('rows behind a table map keyed by the object name are reachable', tableMap.n === 1);
  expect('and the object-name guard is searched, not guessed', tableMap.r?.verdict === 'BLIND');

  const moduleFixture = await one(FIXTURE_MODULE_FIXTURE);
  expect('binding strategy 2 reaches a module-scope fixture array', moduleFixture.n === 1);
  expect('a module-scope-fixture double is judged, not dropped',
    moduleFixture.r?.verdict === 'BLIND');

  // Reconciliation, both directions.
  const fake = new Map([['a.test.ts', { blind: 1, wrong: 0, unjudged: 0, details: [{ line: 1, result: { verdict: 'BLIND' } }] }]]);
  expect('an unbaselined blind double is an error', reconcile(fake, {}).length === 1);
  expect('a matching baseline entry passes', reconcile(fake, { 'a.test.ts': { blind: 1 } }).length === 0);
  expect('a grown count is an error', reconcile(fake, { 'a.test.ts': { blind: 0 } }).length === 1);
  expect('a fallen count is an error (ratchet down)', reconcile(fake, { 'a.test.ts': { blind: 2 } }).length === 1);
  expect('a stale entry is an error', reconcile(new Map(), { 'gone.test.ts': { blind: 1 } }).length === 1);
  const fakeWrong = new Map([['b.test.ts', { blind: 0, wrong: 1, unjudged: 0, details: [{ line: 2, result: { verdict: 'WRONG', shapes: ['truthiness'] } }] }]]);
  expect('a shape-breaking double is ledgered in its own kind, not folded into blind',
    reconcile(fakeWrong, { 'b.test.ts': { blind: 0, wrong: 1 } }).length === 0
    && reconcile(fakeWrong, { 'b.test.ts': { blind: 1 } }).length === 2);

  if (failures.length > 0) {
    console.error(`x check-objectql-double-limit --self-test (${failures.length} failure(s)):\n`);
    for (const f of failures) console.error(`  - ${f}`);
    console.error('');
    process.exit(1);
  }
  console.log(
    'OK  self-test: separates bounding, limit-blind, truthiness, bound-before-filter and\n' +
    '    refusing doubles on synthetic fixtures; all three shape rules are pinned in BOTH\n' +
    '    directions, with the wrap-order proof separated from the two states it cannot\n' +
    '    prove; the control probe drops a non-query `find`, one that never filters, and\n' +
    '    one answering with rows of its own that it could read no evidence from;\n' +
    '    a SHARED helper and a per-file copy grade identically; rows reached through a\n' +
    '    table map and through a module-scope fixture are both driven; the ledger\n' +
    '    reconciles in both directions.',
  );
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
function reportCensus(census, prefix = '  ') {
  const w = census.wrapOrder;
  console.log(
    `${prefix}${census.proposed} structural candidate(s): ${census.graded} graded, ` +
    `${census.unjudged} unjudged, ${census.dropped} dropped as out of scope.`,
  );
  console.log(
    `${prefix}of the graded: ${census.conforming} apply the bound or refuse it loudly ` +
    `(${census.refusing} refuse), ${census.blind} are limit-blind, ` +
    `${census.wrong} break a shape rule.`,
  );
  console.log(
    `${prefix}wrap order: ${w['no-transform']} return their rows untouched, ` +
    `${w['proven-after-bound']} PROVE the bound precedes a row-touching stage, ` +
    `${w['lazy-transform']} transform without reading (order is behaviourally moot), ` +
    `${w['before-bound']} touch rows outside the bound.`,
  );
}

if (!isEntrypoint(import.meta.url)) {
  // Imported (another gate's self-test, or a measurement helper). Running the
  // corpus scan as an import side effect would make this file impossible to
  // reuse without also failing someone else's process.
} else if (process.argv.includes('--self-test')) {
  await selfTest();
} else if (process.argv.includes('--census')) {
  const { measured, census } = await measure();
  reportCensus(census, '');
  for (const [file, v] of [...measured].sort()) {
    console.log(`  ${file}: blind=${v.blind} wrong=${v.wrong} unjudged=${v.unjudged}`);
    if (process.argv.includes('--why')) {
      for (const d of v.details) console.log(`      L${d.line} ${describeDetail(d)}`);
    }
  }
} else {
  if (!existsSync(resolve(repoRoot, BASELINE_PATH))) {
    console.error(`check-objectql-double-limit: missing ${BASELINE_PATH}`);
    process.exit(2);
  }
  const baseline = JSON.parse(readFileSync(resolve(repoRoot, BASELINE_PATH), 'utf8'));
  const baselineFiles = baseline.files ?? {};
  const { measured, census } = await measure();

  const errors = [];
  if (census.graded === 0) {
    errors.push(
      'DISCOVERED: the control probe graded no ObjectQL `find` doubles at all. That is a ' +
      'broken scan, not a clean repo -- every other invariant iterates the graded set.',
    );
  }
  errors.push(...reconcile(measured, baselineFiles));

  const mono = monotonicity(baselineFiles);
  for (const file of mono?.added ?? []) {
    errors.push(
      `${file}: ADDED to the baseline (not present at ${mono.base}). The grandfather list is ` +
      `not a mute button -- it only ever shrinks.`,
    );
  }

  if (errors.length > 0) {
    console.error(`x ObjectQL double \`limit\` conformance (${errors.length} problem(s)):\n`);
    for (const e of errors) console.error(`  - ${e}`);
    console.error('');
    reportCensus(census, '  ');
    process.exit(1);
  }

  console.log(
    `OK  ObjectQL double \`limit\` conformance holds: ${census.graded} double(s) graded, ` +
    `${census.conforming} apply the caller's bound or refuse it loudly.`,
  );
  reportCensus(census, '    ');
  console.log(
    `    ${census.blind} limit-blind, ${census.wrong} shape-breaking and ${census.unjudged} ` +
    `unjudged double(s) in ${measured.size} grandfathered file(s); none new.`,
  );
  console.log(
    mono
      ? `    baseline key set verified against ${mono.base}: no files added.`
      : `    NOT verified: could not read the baseline at the merge base with main, so ` +
        `"no files added" is unchecked this run.`,
  );
}
