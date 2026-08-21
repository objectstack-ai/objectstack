#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// check-where-matcher-conformance -- an in-memory WHERE matcher inside a test
// double must never answer a combinator query SILENTLY WRONG (#8494, from
// #7620; the three correction lanes #7846, #8493 and #7619).
//
//   node scripts/check-where-matcher-conformance.mjs
//   node scripts/check-where-matcher-conformance.mjs --self-test
//
// ## The failure mode this exists for
//
// Sixteen hand-written `matches(row, where)` doubles across `objectql`,
// `plugin-sharing`, `plugin-security` and `runtime` short-circuited on `$or`:
//
//     if (Array.isArray(filter.$or)) return filter.$or.some((f) => matches(row, f));
//     // every sibling equality key below this line is never reached
//
// A real driver ANDs the combinator with its siblings. The double ORed it and
// dropped the rest, so `{ state:'draft', package_id:P, $or:[…] }` became
// `{ $or:[…] }` -- a DIFFERENT query. Every suite standing on those doubles
// stayed green while asserting on scenarios nobody had written. Three lanes
// corrected the instances; #8494 is the observation one level up: **the
// doubles were made right, and nothing held them right.** Reinstating the
// early return failed nothing.
//
// ## Two failure shapes, one criterion
//
// #8494 binds this gate to cover both, and they look nothing alike in source:
//
//   (a) EARLY RETURN -- a combinator branch that `return`s, discarding the
//       sibling keys the loop had not reached yet. The matcher understands
//       `$or`; it just answers a narrower query than it was handed.
//
//   (b) NO COMBINATOR BRANCH -- an `Object.entries(where).every(…)` matcher
//       that never mentions `$or` at all. It treats `$or` as an ordinary
//       FIELD NAME, compares `row.$or` (`undefined`) against the array, gets
//       no match, and silently excludes the row. The suite then asserts on an
//       empty result set with nothing erroring. Arguably worse than (a), and
//       invisible to any guard that looks for a premature `return`.
//
// A syntactic rule cannot span both: shape (b) is an ABSENCE, and the correct
// forms in this repo already vary far too much to pattern-match (an
// `if (…) return false` prelude before the entries loop, and a combinator arm
// INSIDE the entries loop, are both correct and share no shape). So the
// criterion here is behavioural, and it is one sentence:
//
//   > A discovered matcher must answer every combinator probe CORRECTLY, or
//   > REFUSE it by throwing. What it must never do is answer silently wrong.
//
// Refusal counts as conforming on purpose -- the defect class is *silence*,
// not incompleteness. A double that throws on an operator it does not
// implement cannot make a suite green while testing a different query; it
// makes the suite RED the moment a combinator arrives. That is not this
// gate's invention: `packages/objectql/src/engine-autonumber-*.test.ts`
// already does it, with its own recorded reason -- "silently ignoring an
// unknown operator would let a bad query pass as a good one". This gate
// generalises the pattern that file already argued for, and it is why the
// cheap correct answer for a double that only ever sees scalar equality is
// one `throw`, not a full combinator implementation.
//
// ## Why NOT a shared `matchesWhere`
//
// Ruled NO on #7620 and NOT re-litigated here. The twelve are not one lowest
// common denominator -- `plugin-sharing`'s matchers vary between `$in`-only
// and `$in`+`$ne`+`$gte`/`$gt` by file (measured by #8493) -- so extraction
// would either flatten capability or need per-call-site configuration. The
// repo's own recorded reason stands too: "a gate that imports its own
// substrate from another gate's file couples two tripwires that must be able
// to fail independently." This gate takes the opposite approach on purpose:
// it never GIVES a matcher an implementation, it only ASKS each independent
// double a question. The doubles stay independent; only the question is
// shared.
//
// (Contrast `scripts/check-engine-double-contract.mjs`, whose write-verb
// slices pin doubles to a producer-side predicate imported from the real
// engine. That gate's header lists "the READ side ... `find` filter
// semantics" as deliberately not covered, wanting its own slice with its own
// producer-side predicate. This is that coverage, built the only way #7620's
// ruling leaves open: a behavioural battery instead of a shared predicate.)
//
// ## How a candidate is discovered -- and why the control probe IS the filter
//
// Discovery is structural: a function in `packages/**/*.test.ts` whose body
// both indexes its FIRST parameter R by a computed key (`R[k]` -- it reads
// fields off a row generically) and treats some other identifier W as a filter
// object (`Object.entries(W)` / `Object.keys(W)`, or a read of `W.$or` /
// `W.$and`).
//
// W is looked for in two places, in this order (#8615):
//
//   1. the function's OWN second parameter -- the `(row, where)` spelling, and
//      the only one this gate could see before #8615.
//   2. FAILING THAT, an ACCESS PATH the body reads as a filter, whose root is
//      not one of this function's own parameters and RESOLVES in an enclosing
//      scope -- either a same-file declaration (the `visibleDeclarations` walk
//      already built for extraction) or a parameter bound by an enclosing
//      function. This is the single-param `.filter()` callback that CLOSES OVER
//      its `where`:
//
//        const where = query?.where ?? {};
//        return rows.filter((r) => Object.entries(where).every(([k,v]) => r[k]===v));
//
//      Byte-for-byte the shape (b) body this gate already grades everywhere it
//      appears as a second parameter -- the arity was never the defect, it was
//      only what discovery happened to key on. "Not in the ledger" read as
//      "conforming" for every one of them.
//
// A PATH rather than a bare identifier, because the capture is written both
// ways and roughly half the corpus uses the indirect spelling: `where` (a local
// `const`), but equally `opts.where`, `query?.where`, `q.where`,
// `options.where`, `query.filter`. Keying on the identifier alone read the ROOT
// of those (`opts`) as the filter, which is not a widening but a MIS-binding --
// it made 21 real matchers UNJUDGED with a `TypeError` from the control probe,
// i.e. it manufactured exactly the "could not run" failures this gate treats as
// errors. Paths are reduced only through plain dotted access (optional chaining
// and a `?? {}` / `|| {}` tail unwrapped); a call or a computed key yields no
// path and no candidate, because the battery could not synthesise a binding.
//
// Requiring the root to RESOLVE is the load-bearing half of arm 2, and it is a
// real scope walk rather than a name test on purpose: a root that binds nowhere
// same-file is an import or a global, and grading those would have this gate
// judge code it cannot see. What it is NOT is a tightening substitute for the
// control probe -- arm 2 deliberately admits more structural candidates than it
// admits matchers, and the probe below is what decides membership. Measured on
// the corpus at #8615: arm 2 proposed 64 structural candidates, of which the
// control probe seated 62 and dropped 2.
//
// The 2 it dropped are worth naming, because they are a REAL residual blind
// spot rather than noise: both are inverted survivor filters inside a `delete`
// double -- `(r) => !Object.entries(opts.where).every(…)`. They carry the same
// shape (b) defect (a `$or` matches nothing, so the row is not deleted), but
// they answer the control probe `false`/`true` instead of `true`/`false` and so
// are correctly not row-SELECTING predicates by this gate's definition. Left
// ungraded on purpose: teaching the probe to recognise a negated predicate
// means guessing at intent, which is the naming-based reasoning this gate
// exists to avoid. Tracked separately.
//
// For extraction, a captured W is RE-BOUND as a synthetic second parameter, so
// the battery drives `(row, where)` uniformly whatever the source arity was --
// the path is rebuilt outwards, so `opts.where` binds `opts` to
// `{ where: <probe> }`. Re-binding rather than inlining W's declaration is
// deliberate: the local-`const` spellings all initialise W from an enclosing
// parameter (`query?.where ?? {}`, `opts?.where ?? {}`, `args.query?.$filter ??
// {}`) that no standalone lift can supply, so inlining would have made every
// one of them UNJUDGED -- a different way of not grading them.
//
// That heuristic alone over-matches. Rather than tighten it by guessing at
// PARAMETER NAMES -- the failure `check-engine-double-contract` documents,
// where `o` is the object name in twelve doubles and the options bag in a
// thirteenth -- every candidate must then pass a CONTROL probe:
//
//     f({a:'yes', b:'keep'}, {a:'yes'})  === true      // matches on equality
//     f({a:'yes', b:'keep'}, {b:'drop'}) === false     // and really filters
//
// A candidate that cannot do that is not a row-filtering predicate, and is
// dropped as OUT OF SCOPE rather than reported. So discovery is
// self-verifying: membership is decided by behaviour, not by a name. It also
// means a matcher cannot pass the battery vacuously by answering `true` to
// everything -- the control catches that before the battery runs.
//
// ## The battery
//
// Against row `{ F:'yes', G:'keep' }`, with MATCH = `{F:'yes'}` (satisfied)
// and MISS = `{G:'drop'}` (not satisfied):
//
//   orRecognised   { $or: [MATCH, MISS] }        -> true
//   orConjoined    { $or: [MATCH], ...MISS }     -> false
//   andRecognised  { $and: [MATCH] }             -> true
//   andConjoined   { $and: [MATCH], ...MISS }    -> false
//
// The RECOGNITION probes and the CONJUNCTION probes are load-bearing only as
// a PAIR, and the pairing is the whole reason this battery has four entries
// instead of two. `orConjoined` on its own proves nothing: a shape-(b)
// matcher, blind to `$or`, also returns `false` there -- for the opposite
// reason, and it would ride through as "conjoins correctly". Only
// `orRecognised === true` establishes that the matcher can see the combinator
// at all, which is what makes the `false` on `orConjoined` mean "conjoined"
// rather than "excluded the row by accident". Shape (a) fails the second
// probe, shape (b) fails the first, and neither can pass by borrowing the
// other's answer.
//
// ## Invariants
//
//   DISCOVERED  the scan found matchers at all. Zero is not "a clean repo",
//               it is a broken scan: every other invariant iterates the
//               discovered set, so a discovery that silently stops matching
//               would make this script print OK while checking nothing.
//   CONFORMING  every discovered matcher answers the battery correctly or
//               refuses it loudly -- or its file carries a measured baseline
//               entry.
//   JUDGED      every discovered matcher was actually executable. "Could not
//               run" is a failure, not a skip (AGENTS.md, "Absence must be
//               loud"), and is declared per file in the baseline's `unjudged`
//               count rather than passed over in silence.
//   RECONCILED  in both directions. An entry whose count is now LOWER, or
//               whose file is now clean or gone, is an error -- ratchet it
//               down in the same PR. A ratchet that can only accrete rots
//               into a list nobody reads.
//   MONOTONIC   the baseline key set only ever SHRINKS, measured against the
//               merge base with origin/main. Counts alone cannot see the last
//               move: a newly-added file matching its own count would sail
//               through, turning the ledger into a general-purpose mute
//               button (the `SLOT_LOOKUP_UNSWEPT` precedent, #4251).
//
// There is deliberately no `--update` / `--fix` flag, for the reason
// `check-engine-double-contract` gives: a generator would let a new silently
// wrong double be admitted by "just run the update command", which is
// precisely how a gate stops meaning anything. Ratcheting down is editing one
// number by hand -- the failure output prints exactly what was measured.
//
// ## Extraction, and its honest limits
//
// A matcher is a closure inside a test file, so it is lifted out: its source
// is transpiled with the same-file declarations it references (resolved from
// its enclosing scopes, transitively) and evaluated. Only the matcher and the
// declarations it names are executed -- never the test file, never a suite.
// Anything that cannot be lifted this way is UNJUDGED and must be declared;
// it is never treated as passing.

import { readdirSync, statSync, readFileSync, existsSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { isEntrypoint } from './invoked-as.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const BASELINE_PATH = 'scripts/where-matcher-conformance.baseline.json';
const SCAN_ROOT = 'packages';

// ---------------------------------------------------------------------------
// The probe vocabulary. Field names are deliberately synthetic so no matcher
// can special-case them (several doubles branch on `organization_id`, `id`,
// `owner_id` and friends).
// ---------------------------------------------------------------------------
const F = '__os_guard_field';
const G = '__os_guard_other';
const ROW = Object.freeze({ [F]: 'yes', [G]: 'keep' });
const MATCH = Object.freeze({ [F]: 'yes' });
const MISS = Object.freeze({ [G]: 'drop' });

const BATTERY = [
  { id: 'orRecognised', where: () => ({ $or: [{ ...MATCH }, { ...MISS }] }), want: true },
  { id: 'orConjoined', where: () => ({ $or: [{ ...MATCH }], ...MISS }), want: false },
  { id: 'andRecognised', where: () => ({ $and: [{ ...MATCH }] }), want: true },
  { id: 'andConjoined', where: () => ({ $and: [{ ...MATCH }], ...MISS }), want: false },
];

const REFUSED = Symbol('refused');

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------
const isFn = (n) =>
  ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n);

function declaredName(node) {
  const p = node.parent;
  if (p && ts.isVariableDeclaration(p) && ts.isIdentifier(p.name)) return p.name.text;
  if (ts.isFunctionDeclaration(node) && node.name) return node.name.text;
  if (p && ts.isPropertyAssignment(p) && ts.isIdentifier(p.name)) return p.name.text;
  return null;
}

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
            decls.set(d.name.text, `const ${d.name.text} = ${d.initializer.getText(sf)};`);
          }
        }
      } else if (ts.isFunctionDeclaration(s) && s.name && !decls.has(s.name.text)) {
        decls.set(s.name.text, s.getText(sf));
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

/**
 * Does `body` read `id` as a filter object? The two spellings are exactly the
 * ones the two-parameter rule has always tested for — kept as one helper so the
 * own-parameter arm and the captured arm cannot drift apart (the drift that let
 * one spelling get fixed and the other not, in `check-engine-double-contract`).
 */
const readsAsFilter = (body, id) =>
  new RegExp(`Object\\.(entries|keys)\\(\\s*${id}`).test(body) ||
  new RegExp(`\\b${id}\\s*\\??\\.\\s*\\$(or|and)`).test(body);

/** `where ?? {}`, `(where)`, `where!`, `where as any` -> `where`. */
function unwrapExpr(e) {
  for (;;) {
    if (ts.isParenthesizedExpression(e) || ts.isNonNullExpression(e) || ts.isAsExpression(e)) {
      e = e.expression;
    } else if (
      ts.isBinaryExpression(e) &&
      (e.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken ||
        e.operatorToken.kind === ts.SyntaxKind.BarBarToken)
    ) {
      e = e.left;
    } else {
      return e;
    }
  }
}

/**
 * Reduce an expression to a plain ACCESS PATH: a root identifier plus dotted
 * property names (`where` -> [where]; `opts?.where` -> [opts, where];
 * `args.query.$filter` -> [args, query, $filter]). Anything else — a call, an
 * element access, a computed key — returns null, because the battery cannot
 * synthesise a binding for it.
 */
function accessPath(e) {
  const parts = [];
  for (let cur = unwrapExpr(e); ; cur = unwrapExpr(cur.expression)) {
    if (ts.isIdentifier(cur)) return [cur.text, ...parts];
    if (!ts.isPropertyAccessExpression(cur) || !ts.isIdentifier(cur.name)) return null;
    parts.unshift(cur.name.text);
  }
}

/**
 * The two filter spellings, harvested as access paths instead of asserted
 * against a known parameter name. Source order, deduplicated.
 */
function filterPathsIn(fnNode) {
  const out = [];
  const seen = new Set();
  const add = (expr) => {
    const path = accessPath(expr);
    if (!path) return;
    const k = path.join('.');
    if (!seen.has(k)) { seen.add(k); out.push(path); }
  };
  const visit = (n) => {
    if (
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      ts.isIdentifier(n.expression.expression) &&
      n.expression.expression.text === 'Object' &&
      (n.expression.name.text === 'entries' || n.expression.name.text === 'keys') &&
      n.arguments.length >= 1
    ) {
      add(n.arguments[0]);
    }
    if (ts.isPropertyAccessExpression(n) && (n.name.text === '$or' || n.name.text === '$and')) {
      add(n.expression);
    }
    ts.forEachChild(n, visit);
  };
  visit(fnNode.body);
  return out;
}

/** Parameter names bound by the functions/methods enclosing `node`. */
function enclosingParameters(node) {
  const out = new Set();
  for (let cur = node.parent; cur; cur = cur.parent) {
    if (Array.isArray(cur.parameters)) {
      for (const p of cur.parameters) if (ts.isIdentifier(p.name)) out.add(p.name.text);
    }
  }
  return out;
}

/**
 * Structural candidates in one source text. Behavioural admission (the control
 * probe) happens later, in `judge` — this stage only proposes.
 */
export function discoverInSource(text, label) {
  const out = [];
  if (!/Object\.(entries|keys)|\$or|\$and/.test(text)) return out;
  const sf = ts.createSourceFile(label, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const visit = (node) => {
    if (isFn(node) && node.body) {
      const params = node.parameters.map((p) => (ts.isIdentifier(p.name) ? p.name.text : null));
      const r = params[0];
      const body = r ? node.body.getText(sf) : '';
      if (r && new RegExp(`\\b${r}\\s*\\??\\.?\\[`).test(body)) {
        // Arm 1 — the filter is this function's own second parameter.
        let w = params.length >= 2 && params[1] && readsAsFilter(body, params[1]) ? params[1] : null;
        let captured = false;
        let declarations = null;
        // Arm 2 (#8615) — no own filter parameter, so look for one CAPTURED
        // from an enclosing scope. Resolution of the path's ROOT is required; a
        // root binding nowhere in this file is an import or a global, and this
        // gate does not grade code it cannot see.
        if (!w) {
          const own = new Set(params.filter(Boolean));
          declarations = visibleDeclarations(node, sf);
          const enclosing = enclosingParameters(node);
          for (const path of filterPathsIn(node)) {
            const root = path[0];
            if (own.has(root)) continue;
            if (!declarations.has(root) && !enclosing.has(root)) continue;
            w = path;
            captured = true;
            break;
          }
        }
        if (w) {
          const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
          out.push({
            file: label,
            line: line + 1,
            name: declaredName(node) ?? '(anonymous)',
            source: node.getText(sf),
            declarations: declarations ?? visibleDeclarations(node, sf),
            capturedPath: captured ? w : null,
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

// ---------------------------------------------------------------------------
// Extraction + judgment
// ---------------------------------------------------------------------------
function buildCallable(candidate, dropped = new Set()) {
  const self = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(candidate.name) ? candidate.name : '__matcher';
  const captured = candidate.capturedPath ?? null;
  // A captured filter is supplied by the battery, so the path's ROOT must NOT
  // be lifted in: its declaration would shadow the synthetic binding below, and
  // every real instance initialises it from an enclosing parameter this lift
  // cannot supply anyway (`query?.where ?? {}`).
  const skip = captured ? new Set([...dropped, captured[0]]) : dropped;
  const included = new Map();
  let frontier = identifiersIn(candidate.source);
  for (let depth = 0; depth < 6; depth++) {
    const next = new Set();
    for (const id of frontier) {
      if (included.has(id) || id === self || skip.has(id)) continue;
      const decl = candidate.declarations.get(id);
      if (!decl) continue;
      included.set(id, decl);
      for (const x of identifiersIn(decl)) next.add(x);
    }
    if (next.size === 0) break;
    frontier = next;
  }
  const normalised = candidate.source.replace(
    /^(export\s+)?(default\s+)?(async\s+)?function\s+[A-Za-z_$][A-Za-z0-9_$]*/,
    'function',
  );
  // Re-bind a captured filter as a synthetic second parameter so the battery
  // drives `(row, where)` uniformly, whatever arity the source was written at.
  // The path is rebuilt outwards, so `opts.where` becomes `{ where: <probe> }`
  // and `args.query.$filter` becomes `{ query: { $filter: <probe> } }`.
  let definition = `const ${self} = ${normalised};`;
  if (captured) {
    let bound = '__os_where';
    for (const prop of captured.slice(1).reverse()) bound = `{ ${JSON.stringify(prop)}: ${bound} }`;
    definition =
      `const ${self} = (__os_row, __os_where) => {\n` +
      `  const ${captured[0]} = ${bound};\n` +
      `  return (${normalised})(__os_row);\n` +
      `};`;
  }
  const code = `${[...included.values()].join('\n')}\n${definition}\nreturn ${self};`;
  const js = ts.transpileModule(code, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, isolatedModules: true },
  }).outputText;
  return { fn: new Function(js)(), included };
}

/**
 * Lift the matcher out and run it. Returns one of:
 *   { verdict: 'OUT_OF_SCOPE' }  — failed the control probe; not a row filter
 *   { verdict: 'CONFORMING', refused }  — correct or loudly refusing throughout
 *   { verdict: 'SILENT', probes, shapes } — answered silently wrong
 *   { verdict: 'UNJUDGED', why }  — could not be lifted or ran away
 */
export function judge(candidate) {
  let fn;
  const dropped = new Set();
  // A referenced declaration may itself close over a runtime value we cannot
  // supply (a factory parameter). Drop the offender and retry rather than
  // giving up: over-inclusion is a resolution artefact, not a property of the
  // matcher. A name the matcher genuinely needs still ends UNJUDGED below.
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      const built = buildCallable(candidate, dropped);
      if (typeof built.fn !== 'function') return { verdict: 'UNJUDGED', why: 'not callable' };
      fn = built.fn;
      break;
    } catch (e) {
      const missing = /(?:^|\W)([A-Za-z_$][A-Za-z0-9_$]*) is not defined/.exec(String(e))?.[1];
      if (missing && !dropped.has(missing)) {
        dropped.add(missing);
        continue;
      }
      return { verdict: 'UNJUDGED', why: `could not lift: ${String(e).slice(0, 120)}` };
    }
  }
  if (!fn) return { verdict: 'UNJUDGED', why: 'could not lift after retries' };

  const call = (where) => fn({ ...ROW }, where);
  let hit, skip;
  try {
    hit = call({ ...MATCH });
    skip = call({ ...MISS });
  } catch (e) {
    return { verdict: 'UNJUDGED', why: `control probe threw: ${String(e).slice(0, 100)}` };
  }
  if (hit !== true || skip !== false) return { verdict: 'OUT_OF_SCOPE' };

  const probes = {};
  let refused = false;
  for (const p of BATTERY) {
    try {
      probes[p.id] = call(p.where());
    } catch {
      probes[p.id] = REFUSED;
      refused = true;
    }
  }
  const wrong = BATTERY.filter((p) => probes[p.id] !== p.want && probes[p.id] !== REFUSED);
  if (wrong.length === 0) return { verdict: 'CONFORMING', refused, probes };

  // Attribute the shape, for the report only — the verdict does not depend on
  // it. A matcher can carry both (blind to `$or`, early-returning on `$and`).
  const shapes = [];
  const sees = (id) => probes[id] === true;
  if ((sees('orRecognised') && probes.orConjoined === true) ||
      (sees('andRecognised') && probes.andConjoined === true)) {
    shapes.push('early-return (sibling keys discarded)');
  }
  if (!sees('orRecognised') || !sees('andRecognised')) {
    shapes.push('no combinator branch (combinator read as a field name)');
  }
  return { verdict: 'SILENT', probes, shapes };
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

/** Measure the whole corpus: file -> { silent, unjudged, details[] }. */
export function measure() {
  const measured = new Map();
  let discovered = 0;
  let conforming = 0;
  let refusing = 0;
  for (const abs of testFilesUnder(join(repoRoot, SCAN_ROOT))) {
    const rel = relative(repoRoot, abs).replace(/\\/g, '/');
    for (const candidate of discoverInSource(readFileSync(abs, 'utf8'), rel)) {
      const result = judge(candidate);
      if (result.verdict === 'OUT_OF_SCOPE') continue;
      discovered++;
      if (result.verdict === 'CONFORMING') {
        conforming++;
        if (result.refused) refusing++;
        continue;
      }
      if (!measured.has(rel)) measured.set(rel, { silent: 0, unjudged: 0, details: [] });
      const bucket = measured.get(rel);
      if (result.verdict === 'SILENT') bucket.silent++;
      else bucket.unjudged++;
      bucket.details.push({ ...candidate, declarations: undefined, result });
    }
  }
  return { measured, discovered, conforming, refusing };
}

const countsOf = (v) => ({ silent: v.silent ?? 0, unjudged: v.unjudged ?? 0 });

function reconcile(measured, baselineFiles) {
  const errors = [];
  for (const [file, v] of measured) {
    const now = countsOf(v);
    const allowed = baselineFiles[file] ? countsOf(baselineFiles[file]) : null;
    if (!allowed) {
      errors.push(
        `${file}: NEW silently-wrong WHERE matcher (${now.silent} silent, ${now.unjudged} unjudged).\n` +
        `      ${v.details.map((d) => `line ${d.line} \`${d.name}\`: ${d.result.shapes?.join('; ') ?? d.result.why}`).join('\n      ')}\n` +
        `      Fix it, or make the double REFUSE the combinator it does not implement\n` +
        `      (\`throw new Error(...)\` — see the header). The baseline never grows.`,
      );
      continue;
    }
    for (const kind of ['silent', 'unjudged']) {
      if (now[kind] > allowed[kind]) {
        errors.push(
          `${file}: ${kind} matcher count grew ${allowed[kind]} → ${now[kind]}. The file is ` +
          `grandfathered for its EXISTING matchers only.`,
        );
      } else if (now[kind] < allowed[kind]) {
        errors.push(
          `${file}: ${kind} count fell ${allowed[kind]} → ${now[kind]} — ratchet DOWN: set it to ` +
          `${now[kind]} in ${BASELINE_PATH} (delete the entry when both counts reach 0).`,
        );
      }
    }
  }
  for (const file of Object.keys(baselineFiles)) {
    if (!measured.has(file)) {
      errors.push(
        `${file}: baselined file is clean or gone — ratchet DOWN: delete its entry from ` +
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
    // rather than passed over — a check that could not run must not read as a
    // check that passed.
    return null;
  }
}

// ---------------------------------------------------------------------------
// Self-test — the detector can be broken while every double is fine
// ---------------------------------------------------------------------------
const FIXTURE_CORRECT = `
const matches = (row: any, where: any): boolean => {
  if (Array.isArray(where.$or) && !where.$or.some((w: any) => matches(row, w))) return false;
  if (Array.isArray(where.$and) && !where.$and.every((w: any) => matches(row, w))) return false;
  for (const [k, v] of Object.entries(where)) {
    if (k === '$or' || k === '$and') continue;
    if (row[k] !== v) return false;
  }
  return true;
};`;

const FIXTURE_EARLY_RETURN = `
const matches = (row: any, where: any): boolean => {
  if (Array.isArray(where.$or)) return where.$or.some((w: any) => matches(row, w));
  for (const [k, v] of Object.entries(where)) {
    if (k === '$and') continue;
    if (row[k] !== v) return false;
  }
  return true;
};`;

const FIXTURE_BLIND = `
const matches = (row: any, where: any): boolean =>
  Object.entries(where ?? {}).every(([k, v]) => row[k] === v);`;

const FIXTURE_REFUSES = `
const matches = (row: any, where: any): boolean => {
  for (const [k, v] of Object.entries(where)) {
    if (k.startsWith('$')) throw new Error('fake driver: unsupported logical operator ' + k);
    if (row[k] !== v) return false;
  }
  return true;
};`;

// Structurally a candidate (indexes the row, reads the filter) but not a
// row-filtering predicate: the control probe must drop it.
const FIXTURE_NOT_A_MATCHER = `
const project = (row: any, where: any): any => {
  const out: any = {};
  for (const k of Object.keys(where)) out[k] = row[k];
  return out;
};`;

const FIXTURE_HELPER_CLOSURE = `
const eq = (a: any, b: any) => a === b;
const matches = (row: any, where: any): boolean => {
  if (Array.isArray(where.$or) && !where.$or.some((w: any) => matches(row, w))) return false;
  if (Array.isArray(where.$and) && !where.$and.every((w: any) => matches(row, w))) return false;
  return Object.entries(where).every(([k, v]) => k.startsWith('$') || eq(row[k], v));
};`;

// --- #8615: the captured-filter arm -------------------------------------
// Every fixture below is a SINGLE-parameter callback. None of them has a second
// parameter to key on, which is the whole point: before #8615 discovery could
// not see one of these, so the gate could grade them neither green nor red.

// Captured from a same-file `const`, combinator-blind. The shape the 17 sites
// on the card were written in.
const FIXTURE_CAPTURED_BLIND = `
const run = (rows: any[], query: any) => {
  const where = query?.where ?? {};
  return rows.filter((r) => Object.entries(where).every(([k, v]) => r[k] === v));
};`;

// Captured through an ACCESS PATH rooted at an ENCLOSING PARAMETER. Roughly
// half the corpus is spelled this way (`opts.where`, `q.where`, `query.filter`)
// and keying on the root identifier alone mis-binds it into a TypeError.
const FIXTURE_CAPTURED_PATH = `
function makeDriver(rows: any[]) {
  return {
    find: (opts: any) => rows.filter((r) => Object.entries(opts.where).every(([k, v]) => r[k] === v)),
  };
}`;

// Same shape, but the filter root binds NOWHERE in the file — an import or a
// global. Discovery must decline it: this gate does not grade code it cannot
// see. This is the fixture that holds the resolution requirement in place.
const FIXTURE_CAPTURED_UNRESOLVED = `
const run = (rows: any[]) =>
  rows.filter((r) => Object.entries(IMPORTED_FILTER).every(([k, v]) => r[k] === v));`;

// The filter expression is a CALL, so it reduces to no access path and the
// battery could not synthesise a binding for it. Declined, not guessed at.
const FIXTURE_CAPTURED_CALL = `
const run = (rows: any[], get: any) =>
  rows.filter((r) => Object.entries(get()).every(([k, v]) => r[k] === v));`;

// A captured matcher that conjoins correctly — discovery must not assume that
// "single-param callback" implies "defective".
const FIXTURE_CAPTURED_CORRECT = `
const run = (rows: any[], query: any) => {
  const where = query?.where ?? {};
  return rows.filter((r) =>
    Object.entries(where).every(([k, v]) =>
      k === '$or'
        ? (v as any[]).some((b) => Object.entries(b).every(([bk, bv]) => r[bk] === bv))
        : k === '$and'
          ? (v as any[]).every((b) => Object.entries(b).every(([bk, bv]) => r[bk] === bv))
          : r[k] === v));
};`;

// An INVERTED survivor filter inside a delete double. Structurally a candidate,
// and it carries the same shape (b) defect — but it answers the control probe
// backwards, so it is not a row-SELECTING predicate and the probe drops it.
// Pinned as a fixture so this residual stays a KNOWN limit rather than drifting
// into an accidental one.
const FIXTURE_CAPTURED_NEGATED = `
const run = (rows: any[], opts: any) =>
  rows.filter((r) => !Object.entries(opts.where).every(([k, v]) => r[k] === v));`;

function judgeFixture(src) {
  const found = discoverInSource(src, 'fixture.test.ts');
  return { found, results: found.map(judge) };
}

function selfTest() {
  const failures = [];
  const expect = (label, cond) => { if (!cond) failures.push(label); };

  const correct = judgeFixture(FIXTURE_CORRECT);
  expect('the conjoining fixture is discovered', correct.found.length === 1);
  expect('the conjoining fixture is CONFORMING', correct.results[0]?.verdict === 'CONFORMING');

  const early = judgeFixture(FIXTURE_EARLY_RETURN);
  expect('the early-return fixture is discovered', early.found.length === 1);
  expect('the early-return fixture is SILENT', early.results[0]?.verdict === 'SILENT');
  expect(
    'the early-return fixture is attributed to shape (a)',
    early.results[0]?.shapes?.some((s) => s.startsWith('early-return')) === true,
  );
  expect(
    'the early-return fixture recognises $or but drops the sibling',
    early.results[0]?.probes?.orRecognised === true && early.results[0]?.probes?.orConjoined === true,
  );

  const blind = judgeFixture(FIXTURE_BLIND);
  expect('the combinator-blind fixture is discovered', blind.found.length === 1);
  expect('the combinator-blind fixture is SILENT', blind.results[0]?.verdict === 'SILENT');
  expect(
    'the combinator-blind fixture is attributed to shape (b)',
    blind.results[0]?.shapes?.some((s) => s.startsWith('no combinator branch')) === true,
  );
  expect(
    'the combinator-blind fixture fails RECOGNITION, not conjunction',
    blind.results[0]?.probes?.orRecognised === false && blind.results[0]?.probes?.orConjoined === false,
  );

  const refuses = judgeFixture(FIXTURE_REFUSES);
  expect('the refusing fixture is discovered', refuses.found.length === 1);
  expect('the refusing fixture is CONFORMING', refuses.results[0]?.verdict === 'CONFORMING');
  expect('the refusing fixture is recorded as refusing', refuses.results[0]?.refused === true);

  const notMatcher = judgeFixture(FIXTURE_NOT_A_MATCHER);
  expect('the non-predicate fixture is a structural candidate', notMatcher.found.length === 1);
  expect(
    'the control probe drops the non-predicate fixture',
    notMatcher.results[0]?.verdict === 'OUT_OF_SCOPE',
  );

  const closure = judgeFixture(FIXTURE_HELPER_CLOSURE);
  expect('a matcher using a same-file helper is lifted', closure.results[0]?.verdict === 'CONFORMING');

  // --- #8615: the captured-filter arm ------------------------------------
  const capBlind = judgeFixture(FIXTURE_CAPTURED_BLIND);
  expect('a single-param callback capturing a same-file `where` is discovered', capBlind.found.length === 1);
  expect('its captured path is recorded', capBlind.found[0]?.capturedPath?.join('.') === 'where');
  expect('a captured combinator-blind matcher is SILENT', capBlind.results[0]?.verdict === 'SILENT');

  const capPath = judgeFixture(FIXTURE_CAPTURED_PATH);
  expect('a filter captured through opts.where is discovered', capPath.found.length === 1);
  expect('the whole access path is recorded', capPath.found[0]?.capturedPath?.join('.') === 'opts.where');
  expect(
    'a path-captured matcher is JUDGED, not left unrunnable',
    capPath.results[0]?.verdict === 'SILENT',
  );

  const capUnresolved = judgeFixture(FIXTURE_CAPTURED_UNRESOLVED);
  expect(
    'a filter root that resolves nowhere same-file is NOT discovered',
    capUnresolved.found.length === 0,
  );

  const capCall = judgeFixture(FIXTURE_CAPTURED_CALL);
  expect('a filter expression that is a call yields no candidate', capCall.found.length === 0);

  const capCorrect = judgeFixture(FIXTURE_CAPTURED_CORRECT);
  expect('a conjoining captured matcher is discovered', capCorrect.found.length === 1);
  expect('a conjoining captured matcher is CONFORMING', capCorrect.results[0]?.verdict === 'CONFORMING');

  const capNegated = judgeFixture(FIXTURE_CAPTURED_NEGATED);
  expect('an inverted survivor filter is a structural candidate', capNegated.found.length === 1);
  expect(
    'the control probe drops the inverted survivor filter (documented residual)',
    capNegated.results[0]?.verdict === 'OUT_OF_SCOPE',
  );

  // Reconciliation, both directions.
  const fakeMeasured = new Map([['a.test.ts', { silent: 1, unjudged: 0, details: [{ line: 1, name: 'm', result: { shapes: ['x'] } }] }]]);
  expect('an unbaselined silent matcher is an error', reconcile(fakeMeasured, {}).length === 1);
  expect('a matching baseline entry passes', reconcile(fakeMeasured, { 'a.test.ts': { silent: 1 } }).length === 0);
  expect('a grown count is an error', reconcile(fakeMeasured, { 'a.test.ts': { silent: 0 } }).length === 1);
  expect('a fallen count is an error (ratchet down)', reconcile(fakeMeasured, { 'a.test.ts': { silent: 2 } }).length === 1);
  expect('a stale entry is an error', reconcile(new Map(), { 'gone.test.ts': { silent: 1 } }).length === 1);

  if (failures.length > 0) {
    console.error(`✗ check-where-matcher-conformance --self-test (${failures.length} failure(s)):\n`);
    for (const f of failures) console.error(`  • ${f}`);
    console.error('');
    process.exit(1);
  }
  console.log(
    'OK  self-test: separates conjoining, early-returning, combinator-blind and refusing\n' +
    '    matchers on synthetic fixtures; the control probe drops a non-predicate; single-\n' +
    '    parameter callbacks capturing their filter — by name and by access path — are\n' +
    '    discovered and judged, while an unresolvable root, a computed filter and an\n' +
    '    inverted survivor filter are each declined for their own recorded reason; the\n' +
    '    ledger reconciles in both directions.',
  );
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------
const invokedDirectly =
  isEntrypoint(import.meta.url);

if (!invokedDirectly) {
  // Imported (the self-test of another gate, or a measurement helper). Running
  // the corpus scan as an import side effect would make this file impossible to
  // reuse without also failing someone else's process.
} else if (process.argv.includes('--self-test')) {
  selfTest();
} else {
  if (!existsSync(resolve(repoRoot, BASELINE_PATH))) {
    console.error(`check-where-matcher-conformance: missing ${BASELINE_PATH}`);
    process.exit(2);
  }
  const baseline = JSON.parse(readFileSync(resolve(repoRoot, BASELINE_PATH), 'utf8'));
  const baselineFiles = baseline.files ?? {};
  const { measured, discovered, conforming, refusing } = measure();

  const errors = [];
  if (discovered === 0) {
    errors.push(
      'DISCOVERED: the scan found no WHERE matchers at all. That is a broken scan, not a ' +
      'clean repo — every other invariant iterates the discovered set.',
    );
  }
  errors.push(...reconcile(measured, baselineFiles));

  const mono = monotonicity(baselineFiles);
  for (const file of mono?.added ?? []) {
    errors.push(
      `${file}: ADDED to the baseline (not present at ${mono.base}). The grandfather list is ` +
      `not a mute button — it only ever shrinks.`,
    );
  }

  const silent = [...measured.values()].reduce((a, v) => a + v.silent, 0);
  const unjudged = [...measured.values()].reduce((a, v) => a + v.unjudged, 0);

  if (errors.length > 0) {
    console.error(`✗ where-matcher conformance (${errors.length} problem(s)):\n`);
    for (const e of errors) console.error(`  • ${e}`);
    console.error(
      `\nDiscovered ${discovered} matcher(s): ${conforming} conforming (${refusing} by refusing), ` +
      `${silent} silently wrong, ${unjudged} unjudged.`,
    );
    process.exit(1);
  }

  console.log(
    `✓ where-matcher conformance holds: ${discovered} matcher(s) discovered, ${conforming} ` +
    `answer the combinator battery correctly or refuse it loudly (${refusing} refuse).`,
  );
  console.log(
    `  ${silent} silently-wrong and ${unjudged} unjudged matcher(s) in ${measured.size} ` +
    `grandfathered file(s); none new.`,
  );
  console.log(
    mono
      ? `  baseline key set verified against ${mono.base}: no files added.`
      : `  NOT verified: could not read the baseline at the merge base with main, so ` +
        `"no files added" is unchecked this run.`,
  );
}
