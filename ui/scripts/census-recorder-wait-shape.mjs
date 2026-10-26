#!/usr/bin/env node
/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Census: `await waitFor(...)` keyed on ONE recorder array, followed by a read
 * of a DIFFERENT recorder array, with nothing establishing the second was
 * filled. The shape objectui#8688 was one instance of; the corpus reading is
 * objectui#8690, and this file is that card's detector, kept so the next person
 * does not have to re-derive it.
 *
 * ⚠️ It answers WHERE TO LOOK, never WHAT IS WRONG. A flag is a site to read,
 * not a defect: objectui#8690 read all nine of its strict-shape flags and found
 * one worth repairing. ⛔ Never batch-repair a flag list.
 *
 * ---------------------------------------------------------------------------
 * TWO MATCHERS LIVE HERE
 * ---------------------------------------------------------------------------
 *
 *   --matcher=ast     (default) binding identity, test-scoped windows, and
 *                     read / write / declaration classification. objectui#8704.
 *   --matcher=regex   the original objectui#8690 census, verbatim, with its
 *                     `--recorder-match=ident|path` modes. Kept so the numbers
 *                     objectui#8690 and objectui#8703 published stay
 *                     REPRODUCIBLE from this file instead of being claims about
 *                     a deleted script. ⛔ Do not read anything it prints as a
 *                     corpus fact — objectui#8703 measured why, and the header
 *                     section below says exactly what it gets wrong.
 *
 * ---------------------------------------------------------------------------
 * WHAT THE REGEX MATCHER GETS WRONG (objectui#8703, measured on fixtures)
 * ---------------------------------------------------------------------------
 *
 * A recorder's identity there is its SPELLING at the `.push(` site, matched
 * textually at the read site by a name regex whose lookbehind forbids a
 * preceding `.`. Four consequences, each FORCED on a fixture — the fixtures are
 * committed next to this file's pin test and every one of them was observed
 * producing the wrong answer on the pre-objectui#8704 script:
 *
 *   M1  The two modes are INCOMPARABLE BY CONSTRUCTION. `path` alone sees a
 *       recorder pushed and read as the same member path (fixture f1); `ident`
 *       alone sees one pushed as a member and read under a bare alias (f2).
 *   M2  A recorder pushed bare and read through a host that holds the SAME
 *       array is missed by BOTH modes (f3) — a shared blind spot, not a `path`
 *       one. ⛔ An earlier header called this a `path`-only miss. It is not:
 *       the lookbehind forbids a dotted read in BOTH modes, so NO mode of the
 *       regex instrument can see that shape.
 *   D1  The forward window ends at the next textual `await` IN THE FILE, not at
 *       the end of the enclosing test. A wait that is the last `await` of its
 *       test gets a window running on into the NEXT test (f4, cases a/b and
 *       d/e), and the same truncation LOSES a genuine hazard sitting one
 *       ordinary `await` further on (f5).
 *   D2  ANY textual occurrence counts as a "read"; only `X.push(` is excluded.
 *       A declaration, a destructuring, a reset (`gridSchemas.length = 0`),
 *       even a parameter named `log`, all register as reads (f4, case c).
 *
 * Of the 18 strict flags the `path` mode reported at da5e4f69e, SEVEN point at
 * something that is not a read at all — objectui#8703 read all seven and
 * repaired none.
 *
 * ⚠️ M1 is a claim about SHAPES, and it is FALSE as a measurement of this tree.
 * Run `--matcher=regex` in both modes and diff the site lists: the strict
 * buckets are NESTED, not disjoint.
 *
 *     at da5e4f69e            ident 15 ⊂ path 18   ident-only EMPTY, 3 path-only
 *     with main @ a9bc02996   ident 12 ⊂ path 15   ident-only EMPTY, the SAME 3
 *
 * and in both readings the three path-only sites are the `server.saved` /
 * `server.savedOpts` reads in `PermissionMatrixEditor.{scope,packageDoorFacets}
 * .test.tsx`. The union of the two modes is just `path`'s bucket. ⛔ Never cite
 * M1 as a reason the two modes must be run and unioned — on this tree that buys
 * nothing.
 *
 * ⭐ Which is the short way to see that the mode choice was never the largest
 * source of movement. At da5e4f69e the mode choice separates THREE sites; D1
 * and D2 together separate SIXTEEN. `path` 18 → AST 20 is not +2: it is −7 (the
 * seven non-reads above) and +9 (seven recorders no name matcher could follow
 * through a host, a factory or a destructuring, plus two reads D1 had truncated
 * away). The mode was the visible knob and the smallest one.
 *
 * ---------------------------------------------------------------------------
 * WHAT THE AST MATCHER DOES INSTEAD (objectui#8704)
 * ---------------------------------------------------------------------------
 *
 *   1. IDENTITY, not spelling. Every identifier is resolved to its binding over
 *      a scope chain, and six forms are unioned onto one key, so the same array
 *      object is one recorder however it is written:
 *        `const a = b`            ·  `const { p } = obj`
 *        `const obj = { p }`      ·  `const obj = { p: expr }`
 *        `f(arr)` reaching `arr` through f's PARAMETER          (one hop)
 *        `const h = f()` / `const { p } = f()` through f's      (one hop)
 *            single returned object literal
 *      Canonicalisation is PREFIX-AWARE: an alias declared on `server` has to
 *      reach `server.savedOpts` below it, and comparing whole keys does not do
 *      that.
 *      ⇒ the `--recorder-match` mode choice DISAPPEARS. It was an artefact of
 *        matching names.
 *      ⚠️ The two hops are why this matcher agrees with all 16 hand-verified
 *      labels. Without the parameter hop the three `PermissionMatrixEditor`
 *      reads go dark; without the return hop `ObjectChart.optionColors` and
 *      `DatasetWidget.relabel` do. All five are hand-verified GENUINE reads.
 *   2. TEST-SCOPED WINDOWS, in statements. The window is the statements that
 *      follow the wait inside its ENCLOSING FUNCTION BODY (a test callback, a
 *      helper) and stops at the function's end — it can never reach the next
 *      `it`. Within that, it stops at the next awaited SETTLING ANCHOR
 *      (`waitFor`, `waitForElementToBeRemoved`, `findBy*`/`findAllBy*`),
 *      because that is what re-anchors the reads after it. ⚠️ A plain `await`
 *      does NOT close the window: `await Promise.resolve()` settles nothing,
 *      and treating it as an anchor is what made the regex matcher blind on f5.
 *      `await act(...)` is likewise not an anchor — it drains effects, it does
 *      not wait for a recorder to fill.
 *      ⚠️ This repairs only ONE HALF of D1 — the runaway half. R2' below is
 *      the half that survives, pointed the other way.
 *   3. READ / WRITE / DECLARATION. An occurrence is a DECLARATION when the node
 *      is a binding name (variable, binding element, parameter, function,
 *      class, import) or an object-literal key; a WRITE when it is the target
 *      of an assignment (`x = …`, `x.length = 0`, `x[0] = …`, `x++`, `delete`)
 *      or the receiver of `push` / `unshift`; a READ otherwise. Only reads
 *      flag. ⚠️ Deliberately conservative: `pop`, `shift` and `splice` observe
 *      contents, so they count as READS. Over-flagging is recoverable by
 *      reading the site; going blind is not.
 *
 * ⇒ Fixtures f1, f2, f3, f5 and f6 flag; f4 does not. Every one of those six
 *   answers was observed WRONG on the pre-repair script first
 *   (`scripts/__tests__/census-recorder-wait-shape.test.ts` holds the matrix).
 *
 * ---------------------------------------------------------------------------
 * ⛔ THE CAVEAT STAYS. A COUNT PRINTED HERE IS STILL NOT A CORPUS FACT.
 * ---------------------------------------------------------------------------
 *
 * Two of the three error sources objectui#8703 named are gone outright, and
 * HALF of the third (R2' below is the surviving half); the six fixtures prove
 * that much. Measured over the same tree the earlier numbers were read on
 * (da5e4f69e, 2776 tracked test files):
 *
 *     regex ident   159 flags, 15 strict, 10 files    (as objectui#8703 published)
 *     regex path    167 flags, 18 strict, 12 files    (as objectui#8703 published)
 *     AST           138 flags, 20 strict, 12 files
 *
 * and the strict delta decomposes EXACTLY: −7, which are precisely the seven
 * objectui#8703 read and found were not reads at all, and +9 — seven recorders
 * the name matcher could not see through a host, a factory or a destructuring,
 * and two reads it had truncated away behind an ordinary `await`. Two of the
 * nine are hand-verified genuine reads the old matcher had LOST.
 *
 * And a count moves with the TREE alone, which this branch's own merge with
 * main measured on a byte-identical matcher: merging a9bc02996 — where #8707,
 * #8711 and #8713 had each anchored a wait — moves the population 2776 → 2786
 * and every strict bucket down, AST 20 → 18, `path` 18 → 15, `ident` 15 → 12.
 * Nothing about the instrument changed. The tree did.
 *
 * That makes the number better, and STILL NOT QUOTABLE. What is left, measured
 * rather than supposed:
 *
 *   R1  No type checker. Identity is resolved syntactically, ONE FILE at a
 *       time, and the two interprocedural rules above are ONE HOP each. An
 *       array reaching a test from another MODULE, through two helpers, or out
 *       of a factory with more than one `return`, is still a different key from
 *       the array the helper pushes into. There is no measurement of how many
 *       exist — by construction, the instrument cannot count what it cannot see.
 *   R1' The parameter hop OVER-MERGES: a helper called with different arrays
 *       unions them onto one key. That can only ever LOSE a flag — the wait set
 *       then already contains the read's key — never invent one, and the
 *       test-scoped window keeps it from reaching across tests. Unmeasured, for
 *       the same reason as R1.
 *   R2  The window rule is a JUDGEMENT about which awaits settle a recorder,
 *       not a fact about the code. `await act(…)` is deliberately NOT an anchor;
 *       moving it into the set removes at least one flag measured here
 *       (`rowRecordCrudVerdict.test.tsx`), and neither choice is provably right.
 *   R2' The window is scoped to the ENCLOSING FUNCTION BODY, and that repairs
 *       only ONE half of D1. The runaway half is gone: a window can never
 *       reach the next `it`. The truncation half SURVIVES, pointed the other
 *       way — when the wait is hosted in a helper the test awaits, or in any
 *       inner callback, the window is that inner body and the CALLER's
 *       statements sit outside it. Forced on a probe: `await settleSaves();
 *       expect(deletes).toEqual([])` draws ZERO, while the identical read with
 *       the wait inlined into the test draws a flag. Not a corner — measured
 *       on this tree, 503 of the 3945 `await waitFor(...)` sites have their
 *       window owned by an inner function, 464 of them a named or arrow
 *       helper. The regex matcher was blind here too, differently (its textual
 *       window ran past the helper's closing brace rather than into the
 *       caller), so this is a SURVIVING blind spot and not a regression — with
 *       one measured exception: for a wait inside an `await act(...)` callback
 *       the regex window did reach the read and this one does not (forced on a
 *       constructed probe; zero such sites in this tree).
 *   R3  A flag is still not a defect, and this is the residual that matters
 *       most. objectui#8690 read its nine and found ONE worth repairing;
 *       objectui#8703 read seven more and repaired none. All 16 hand-verified
 *       labels agree with this matcher — and that agreement says the list is
 *       now a good list of PLACES TO READ, not that anything on it is wrong.
 *       8 of the 9 genuine reads were, and remain, SOUND BY CONSTRUCTION, which
 *       no matcher can see.
 *
 * ⇒ Quote a number from here as "sites this instrument points at", never as
 *   "sites of this shape", and never as "defects". ⛔ This file stays OUT of
 *   CI: R2 and R2' alone make it matcher-dependent, and a gate on this list would
 *   institutionalise the batch repair objectui#8690 exists to prevent. Its pin
 *   test runs the matcher over the six committed FIXTURES only — never over the
 *   corpus — so nothing in CI depends on what the corpus reads.
 *
 * Usage:
 *   node scripts/census-recorder-wait-shape.mjs
 *   node scripts/census-recorder-wait-shape.mjs --matcher=regex --recorder-match=ident
 *   node scripts/census-recorder-wait-shape.mjs --files a.test.ts b.test.ts
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

import { isEntrypoint } from './invoked-as.mjs';

// ---------------------------------------------------------------------------
// The regex matcher — objectui#8690's census, unchanged. Kept reproducible.
// ---------------------------------------------------------------------------

/**
 * @param {string[]} files
 * @param {'ident'|'path'} mode
 */
export function analyzeRegex(files, mode) {
  const PUSH = mode === 'ident'
    ? /([A-Za-z_$][\w$]*)\s*\.push\s*\(/g
    : /([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*\.push\s*\(/g;
  const nameRe = (n) => new RegExp(`(?<![\\w$.])${n.replace(/\./g, '\\.')}(?![\\w$])`, 'g');
  const lineOf = (src, index) => src.slice(0, index).split('\n').length;

  const flags = [];
  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    const recorders = new Set();
    for (const m of src.matchAll(PUSH)) recorders.add(m[1]);
    if (recorders.size === 0) continue;

    for (const w of src.matchAll(/await\s+waitFor\s*\(/g)) {
      const open = w.index + w[0].length - 1;
      let depth = 0;
      let end = -1;
      for (let j = open; j < src.length; j++) {
        if (src[j] === '(') depth++;
        else if (src[j] === ')' && --depth === 0) { end = j; break; }
      }
      if (end < 0) continue;
      const waitBody = src.slice(open, end + 1);
      const waitSet = new Set([...recorders].filter((r) => nameRe(r).test(waitBody)));

      const rest = src.slice(end + 1);
      const nextAwait = rest.search(/\bawait\b/);
      const window = nextAwait === -1 ? rest : rest.slice(0, nextAwait);

      for (const r of recorders) {
        if (waitSet.has(r)) continue;
        for (const hit of window.matchAll(nameRe(r))) {
          if (/^\s*\.push\s*\(/.test(window.slice(hit.index + r.length))) continue;
          flags.push({
            file,
            line: lineOf(src, end + 1 + hit.index),
            waitLine: lineOf(src, w.index),
            recorder: r,
            waitSet: [...waitSet],
          });
          break;
        }
      }
    }
  }
  return flags;
}

// ---------------------------------------------------------------------------
// The AST matcher — objectui#8704.
// ---------------------------------------------------------------------------

/** Awaited calls that settle a condition, and so re-anchor the reads after them. */
const SETTLING_ANCHORS = new Set(['waitFor', 'waitForElementToBeRemoved']);
const isFindByQuery = (name) => /^find(?:All)?By[A-Z]/.test(name);

/** Array methods that only WRITE. `pop`/`shift`/`splice` observe contents — reads. */
const PURE_MUTATORS = new Set(['push', 'unshift']);

const isFunctionLike = (n) =>
  ts.isArrowFunction(n) || ts.isFunctionExpression(n) || ts.isFunctionDeclaration(n)
  || ts.isMethodDeclaration(n) || ts.isConstructorDeclaration(n)
  || ts.isGetAccessor(n) || ts.isSetAccessor(n);

/** A union-find over identity keys, so four alias forms collapse to one recorder. */
function makeAliases() {
  const parent = new Map();
  const find = (k) => {
    let root = k;
    while (parent.has(root) && parent.get(root) !== root) root = parent.get(root);
    let cur = k;
    while (parent.has(cur) && parent.get(cur) !== cur) {
      const next = parent.get(cur);
      parent.set(cur, root);
      cur = next;
    }
    return root;
  };
  return {
    find,
    union(a, b) {
      if (!a || !b) return;
      const ra = find(a);
      const rb = find(b);
      if (ra === rb) return;
      parent.set(ra, rb);
      parent.set(rb, rb);
    },
  };
}

/**
 * Resolve every identifier REFERENCE in a source file to the binding it names,
 * and collect the alias unions. Returns the pieces the passes below need.
 *
 * Scoping is approximate on purpose — no type checker, one file at a time (R1
 * in the header). Declarations are hoisted into their scope before the scope's
 * children are walked, so use-before-declare resolves the same as after.
 *
 * @param {ts.SourceFile} sf
 */
function resolveBindings(sf) {
  const aliases = makeAliases();
  /** @type {Map<ts.Identifier, string>} reference identifier -> binding key */
  const resolved = new Map();
  /** @type {Set<ts.Node>} identifier nodes that are DECLARATION names */
  const declNames = new Set();

  const keyOfBinding = (nameNode) => `d${nameNode.pos}:${nameNode.getText(sf)}`;

  const scopeOf = (parentScope) => ({ parent: parentScope, names: new Map() });
  const lookup = (scope, name) => {
    for (let s = scope; s; s = s.parent) if (s.names.has(name)) return s.names.get(name);
    return null;
  };

  /** Every identifier a binding name introduces, including destructuring. */
  const bindingIdentifiers = (nameNode, out) => {
    if (ts.isIdentifier(nameNode)) { out.push(nameNode); return; }
    if (ts.isObjectBindingPattern(nameNode) || ts.isArrayBindingPattern(nameNode)) {
      for (const el of nameNode.elements) {
        if (ts.isBindingElement(el)) bindingIdentifiers(el.name, out);
      }
    }
  };

  const declare = (scope, nameNode) => {
    const ids = [];
    bindingIdentifiers(nameNode, ids);
    for (const id of ids) {
      declNames.add(id);
      scope.names.set(id.text, keyOfBinding(id));
    }
  };

  // Pass A: build the scope tree and the name tables, hoisting per scope.
  const scopeFor = new Map();
  const buildScopes = (node, scope) => {
    let inner = scope;
    if (node === sf || ts.isBlock(node) || ts.isModuleBlock(node) || isFunctionLike(node)
      || ts.isForStatement(node) || ts.isForInStatement(node) || ts.isForOfStatement(node)
      || ts.isCatchClause(node) || ts.isCaseBlock(node) || ts.isClassDeclaration(node)) {
      inner = scopeOf(scope);
    }
    scopeFor.set(node, inner);

    if (isFunctionLike(node)) for (const p of node.parameters) declare(inner, p.name);
    if (ts.isCatchClause(node) && node.variableDeclaration) declare(inner, node.variableDeclaration.name);

    // Hoist the declarations this scope owns before descending.
    const hoist = (n) => {
      if (n !== node && (ts.isBlock(n) || isFunctionLike(n) || ts.isModuleBlock(n))) {
        // A nested block owns its own `const`/`let`; only `var` and function
        // declarations would climb out, and test files do not rely on that.
        if (ts.isFunctionDeclaration(n) && n.name) declare(inner, n.name);
        return;
      }
      if (ts.isVariableDeclaration(n)) declare(inner, n.name);
      else if (ts.isFunctionDeclaration(n) && n.name) declare(inner, n.name);
      else if (ts.isClassDeclaration(n) && n.name) declare(inner, n.name);
      else if (ts.isImportSpecifier(n) || ts.isImportClause(n) || ts.isNamespaceImport(n)) {
        if (n.name) declare(inner, n.name);
      }
      ts.forEachChild(n, hoist);
    };
    ts.forEachChild(node, hoist);

    ts.forEachChild(node, (child) => buildScopes(child, inner));
  };
  buildScopes(sf, null);

  // Pass B: resolve references, and record the alias unions.
  const pathOf = (node) => {
    const parts = [];
    let cur = node;
    while (ts.isPropertyAccessExpression(cur)) {
      parts.unshift(cur.name.text);
      cur = cur.expression;
      while (ts.isParenthesizedExpression(cur) || ts.isAsExpression(cur)
        || ts.isNonNullExpression(cur) || ts.isSatisfiesExpression(cur)) cur = cur.expression;
    }
    if (!ts.isIdentifier(cur)) return null;
    return { root: cur, parts };
  };

  /** `(x)`, `x as T`, `x!` and `x satisfies T` all still name `x`. */
  const unwrap = (node) => {
    let cur = node;
    for (;;) {
      if (ts.isParenthesizedExpression(cur) || ts.isAsExpression(cur)
        || ts.isNonNullExpression(cur) || ts.isSatisfiesExpression(cur)
        || ts.isTypeAssertionExpression(cur)) {
        cur = cur.expression;
      } else return cur;
    }
  };

  /** Identity key of an identifier / dotted path expression, or null. */
  const identityOf = (raw) => {
    const node = unwrap(raw);
    const p = pathOf(node);
    if (!p) return null;
    const rootKey = resolved.get(p.root) ?? (declNames.has(p.root) ? null : `free:${p.root.text}`);
    if (!rootKey) return null;
    return [rootKey, ...p.parts].join('.');
  };

  // Resolve references against the scope map built above.
  const resolveWithScope = (node, scope) => {
    const here = scopeFor.get(node) ?? scope;
    if (ts.isIdentifier(node) && !declNames.has(node)) {
      const parent = node.parent;
      const isPropertyName = parent
        && ((ts.isPropertyAccessExpression(parent) && parent.name === node)
          || (ts.isPropertyAssignment(parent) && parent.name === node)
          || (ts.isBindingElement(parent) && parent.propertyName === node)
          || (ts.isMethodDeclaration(parent) && parent.name === node)
          || (ts.isPropertyDeclaration(parent) && parent.name === node)
          || (ts.isPropertySignature(parent) && parent.name === node));
      if (!isPropertyName) {
        const key = lookup(here, node.text);
        if (key) resolved.set(node, key);
      }
    }
    ts.forEachChild(node, (child) => resolveWithScope(child, here));
  };
  resolveWithScope(sf, scopeFor.get(sf));

  // Pass C: alias unions. Every form here means "the same array object".
  const objectLiteralAliases = (ownerKey, obj) => {
    for (const prop of obj.properties) {
      if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name)) {
        const rhs = identityOf(prop.initializer);
        if (rhs) aliases.union(`${ownerKey}.${prop.name.text}`, rhs);
      } else if (ts.isShorthandPropertyAssignment(prop)) {
        const rhs = resolved.get(prop.name) ?? null;
        if (rhs) aliases.union(`${ownerKey}.${prop.name.text}`, rhs);
      }
    }
  };

  // Which binding key names which function, so a call can be matched to its
  // parameter list one hop deep (see `collectAliases` below).
  /** @type {Map<string, ts.SignatureDeclaration>} */
  const functionOf = new Map();
  const collectFunctions = (node) => {
    if (ts.isFunctionDeclaration(node) && node.name) functionOf.set(keyOfBinding(node.name), node);
    else if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer
      && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) {
      functionOf.set(keyOfBinding(node.name), node.initializer);
    }
    ts.forEachChild(node, collectFunctions);
  };
  collectFunctions(sf);

  /** `{ a }` binds `a` from property `a`; `{ a: b }` binds `b` from `a`. */
  const propertyNameOf = (el) => (el.propertyName && ts.isIdentifier(el.propertyName)
    ? el.propertyName.text
    : el.name.text);

  /** The single expression a same-file helper returns, or null. */
  const singleReturnExpression = (fn) => {
    if (!fn.body) return null;
    if (!ts.isBlock(fn.body)) return fn.body; // concise arrow body
    const returns = [];
    const walk = (n) => {
      if (n !== fn.body && isFunctionLike(n)) return;
      if (ts.isReturnStatement(n) && n.expression) returns.push(n.expression);
      ts.forEachChild(n, walk);
    };
    walk(fn.body);
    return returns.length === 1 ? returns[0] : null;
  };

  const collectAliases = (node) => {
    // ONE HOP INTERPROCEDURAL. A recorder pushed inside a same-file helper is
    // reached there through the helper's PARAMETER, which is a different
    // binding from the array the test holds — measured on
    // `PermissionMatrixEditor.{scope,packageDoorFacets}.test.tsx`, where it
    // cost three hand-verified genuine reads. At a direct call the parameter
    // and the argument ARE the same array object, so they are unioned.
    // ⚠️ A helper called with DIFFERENT arrays merges them onto one key. That
    // over-merge can only ever LOSE a flag (the wait set then already contains
    // the read's key), never invent one — and the test-scoped window keeps it
    // from reaching across tests. It is R1' in this file's header.
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const fn = functionOf.get(resolved.get(node.expression) ?? '');
      if (fn) {
        for (let i = 0; i < node.arguments.length && i < fn.parameters.length; i++) {
          const param = fn.parameters[i];
          if (!ts.isIdentifier(param.name)) continue;
          const arg = identityOf(node.arguments[i]);
          if (arg) aliases.union(keyOfBinding(param.name), arg);
        }
      }
    }
    if (ts.isVariableDeclaration(node) && node.initializer) {
      if (ts.isIdentifier(node.name)) {
        const lhs = keyOfBinding(node.name);
        const init = unwrap(node.initializer);
        const rhs = identityOf(init);
        if (rhs) aliases.union(lhs, rhs);
        else if (ts.isObjectLiteralExpression(init)) {
          objectLiteralAliases(lhs, init);
        } else if (ts.isCallExpression(init) && ts.isIdentifier(init.expression)) {
          // `const host = makeHost()` — the factory's returned object literal
          // holds the very arrays its body pushes into. Same file, one hop.
          // Measured: without it, `ObjectChart.optionColors` and
          // `DatasetWidget.relabel` — both hand-verified GENUINE reads by
          // objectui#8690 — are invisible.
          const fn = functionOf.get(resolved.get(init.expression) ?? '');
          const ret = fn ? singleReturnExpression(fn) : null;
          if (ret) {
            const retExpr = unwrap(ret);
            if (ts.isObjectLiteralExpression(retExpr)) objectLiteralAliases(lhs, retExpr);
            else {
              const r = identityOf(retExpr);
              if (r) aliases.union(lhs, r);
            }
          }
        }
      } else if (ts.isObjectBindingPattern(node.name)) {
        const init = unwrap(node.initializer);
        const src = identityOf(init);
        // `const { p } = obj` — p IS obj.p.
        if (src) {
          for (const el of node.name.elements) {
            if (!ts.isBindingElement(el) || !ts.isIdentifier(el.name)) continue;
            aliases.union(keyOfBinding(el.name), `${src}.${propertyNameOf(el)}`);
          }
        } else if (ts.isCallExpression(init) && ts.isIdentifier(init.expression)) {
          // `const { ctxSeen } = makeProbe()` — the SAME hop as `const host =
          // makeHost()`, one destructuring further. Without it the test's
          // `ctxSeen` is a fresh binding with no link to the array the factory
          // pushes into, and the site goes dark.
          const fn = functionOf.get(resolved.get(init.expression) ?? '');
          const ret = fn ? singleReturnExpression(fn) : null;
          const retExpr = ret ? unwrap(ret) : null;
          if (retExpr && ts.isObjectLiteralExpression(retExpr)) {
            const byName = new Map();
            for (const prop of retExpr.properties) {
              if (ts.isPropertyAssignment(prop) && ts.isIdentifier(prop.name)) {
                byName.set(prop.name.text, identityOf(prop.initializer));
              } else if (ts.isShorthandPropertyAssignment(prop)) {
                byName.set(prop.name.text, resolved.get(prop.name) ?? null);
              }
            }
            for (const el of node.name.elements) {
              if (!ts.isBindingElement(el) || !ts.isIdentifier(el.name)) continue;
              const rhs = byName.get(propertyNameOf(el));
              if (rhs) aliases.union(keyOfBinding(el.name), rhs);
            }
          }
        }
      }
    } else if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      const lhs = identityOf(node.left);
      const rhs = identityOf(node.right);
      if (lhs && rhs) aliases.union(lhs, rhs);
      else if (lhs && ts.isObjectLiteralExpression(node.right)) objectLiteralAliases(lhs, node.right);
    }
    ts.forEachChild(node, collectAliases);
  };
  collectAliases(sf);

  // Canonicalisation is PREFIX-AWARE. `union` relates whole keys, but an alias
  // is usually declared on a prefix (`makeClient(server)` relates the two
  // `server` bindings) while the recorder is a path below it
  // (`server.savedOpts`). Rewriting the longest aliased prefix and re-resolving
  // is what makes the two meet; comparing whole strings does not, and that is
  // what lost the three `PermissionMatrixEditor` reads on the first draft.
  const memo = new Map();
  const canonical = (key) => {
    if (!key) return null;
    if (memo.has(key)) return memo.get(key);
    memo.set(key, key); // cycle guard: an unresolved key answers itself
    let out = key;
    const direct = aliases.find(key);
    if (direct !== key) {
      out = canonical(direct);
    } else {
      const cut = key.lastIndexOf('.');
      if (cut !== -1) {
        const head = key.slice(0, cut);
        const headCanon = canonical(head);
        if (headCanon !== head) out = canonical(headCanon + key.slice(cut));
      }
    }
    memo.set(key, out);
    return out;
  };

  return { aliases, resolved, declNames, identityOf, canonical };
}

/**
 * Classify what an occurrence of `node` (the expression naming the recorder)
 * does to it: 'declare' | 'write' | 'read'.
 */
function classifyOccurrence(node, declNames) {
  if (ts.isIdentifier(node) && declNames.has(node)) return 'declare';

  const parent = node.parent;
  if (parent) {
    // An object-literal key is a name, not a reference. A SHORTHAND property
    // (`{ calls }`) is a genuine read of `calls`, and is deliberately not here.
    if (ts.isPropertyAssignment(parent) && parent.name === node) return 'declare';
    // `x.push(...)` / `x.unshift(...)` — the recorder is the receiver.
    if (ts.isPropertyAccessExpression(parent) && parent.expression === node
      && PURE_MUTATORS.has(parent.name.text)
      && ts.isCallExpression(parent.parent) && parent.parent.expression === parent) {
      return 'write';
    }
  }

  // Climb the whole access chain rooted at the recorder: `x`, `x.length`,
  // `x[0].name`. Whatever the chain ends in decides read vs write.
  let top = node;
  while (top.parent
    && ((ts.isPropertyAccessExpression(top.parent) && top.parent.expression === top)
      || (ts.isElementAccessExpression(top.parent) && top.parent.expression === top))) {
    top = top.parent;
  }
  const p = top.parent;
  if (!p) return 'read';
  if (ts.isBinaryExpression(p) && p.left === top
    && p.operatorToken.kind >= ts.SyntaxKind.FirstAssignment
    && p.operatorToken.kind <= ts.SyntaxKind.LastAssignment) {
    return 'write';
  }
  if ((ts.isPrefixUnaryExpression(p) || ts.isPostfixUnaryExpression(p))
    && p.operand === top
    && (p.operator === ts.SyntaxKind.PlusPlusToken || p.operator === ts.SyntaxKind.MinusMinusToken)) {
    return 'write';
  }
  if (ts.isDeleteExpression(p)) return 'write';
  return 'read';
}

/** Does this statement contain an awaited settling anchor, outside nested functions? */
function containsSettlingAwait(stmt) {
  let found = false;
  const walk = (n) => {
    if (found) return;
    if (n !== stmt && isFunctionLike(n)) return;
    if (ts.isAwaitExpression(n) && ts.isCallExpression(n.expression)) {
      const callee = n.expression.expression;
      const name = ts.isIdentifier(callee)
        ? callee.text
        : (ts.isPropertyAccessExpression(callee) ? callee.name.text : null);
      if (name && (SETTLING_ANCHORS.has(name) || isFindByQuery(name))) { found = true; return; }
    }
    ts.forEachChild(n, walk);
  };
  walk(stmt);
  return found;
}

/**
 * The statements a wait's window covers: everything after the wait's own
 * statement, inside the ENCLOSING FUNCTION BODY, stopping at the next settling
 * anchor. It can never cross into the next `it`.
 */
function windowStatements(awaitNode) {
  // The statement the wait sits in, and the function body that owns it.
  let stmt = awaitNode;
  while (stmt.parent && !(ts.isBlock(stmt.parent) || ts.isSourceFile(stmt.parent) || ts.isCaseClause(stmt.parent) || ts.isDefaultClause(stmt.parent))) {
    stmt = stmt.parent;
  }
  if (!stmt.parent) return [];

  let fnBody = null;
  for (let n = awaitNode.parent; n; n = n.parent) {
    if (isFunctionLike(n)) { fnBody = n.body ?? null; break; }
    if (ts.isSourceFile(n)) { fnBody = n; break; }
  }

  const out = [];
  let cursor = stmt;
  for (;;) {
    const container = cursor.parent;
    const list = container.statements;
    if (!list) break;
    const idx = list.indexOf(cursor);
    if (idx < 0) break;
    for (let i = idx + 1; i < list.length; i++) out.push(list[i]);
    if (container === fnBody || ts.isSourceFile(container)) break;
    // Climb out of a nested block (an `if`, a `try`) but never out of the test.
    let next = container;
    while (next.parent && !(ts.isBlock(next.parent) || ts.isSourceFile(next.parent))) next = next.parent;
    if (!next.parent || isFunctionLike(container.parent)) break;
    cursor = next;
  }

  const stop = out.findIndex(containsSettlingAwait);
  return stop === -1 ? out : out.slice(0, stop);
}

/**
 * @param {string[]} files
 * @returns {{file:string,line:number,waitLine:number,recorder:string,waitSet:string[]}[]}
 */
export function analyzeAst(files) {
  const flags = [];
  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    if (!src.includes('waitFor')) continue;
    const sf = ts.createSourceFile(
      file,
      src,
      { languageVersion: ts.ScriptTarget.Latest, jsDocParsingMode: ts.JSDocParsingMode.ParseNone },
      /* setParentNodes */ true,
      file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    const { declNames, identityOf, canonical } = resolveBindings(sf);
    const lineOf = (pos) => sf.getLineAndCharacterOfPosition(pos).line + 1;

    // 1. Recorders: the receiver of every `X.push(...)`, by binding identity.
    /** @type {Map<string, string>} canonical key -> a readable spelling */
    const recorders = new Map();
    const findRecorders = (n) => {
      if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)
        && n.expression.name.text === 'push') {
        const key = canonical(identityOf(n.expression.expression));
        if (key) recorders.set(key, n.expression.expression.getText(sf));
      }
      ts.forEachChild(n, findRecorders);
    };
    findRecorders(sf);
    if (recorders.size === 0) continue;

    /** The recorder an identifier occurrence names, longest path prefix first. */
    const recorderAt = (id) => {
      const chain = [id];
      let node = id;
      while (node.parent && ts.isPropertyAccessExpression(node.parent) && node.parent.expression === node) {
        node = node.parent;
        chain.push(node);
      }
      for (let i = chain.length - 1; i >= 0; i--) {
        const key = canonical(identityOf(chain[i]));
        if (key && recorders.has(key)) return { key, node: chain[i] };
      }
      return null;
    };

    // A dotted path is entered at its ROOT identifier exactly once; the
    // identifiers in property-name position are names, not references, so
    // skipping them is what keeps `x.foo` from colliding with a free `foo`.
    const isPropertyNamePosition = (n) => {
      const p = n.parent;
      return !!p && ((ts.isPropertyAccessExpression(p) && p.name === n)
        || (ts.isPropertyAssignment(p) && p.name === n)
        || (ts.isBindingElement(p) && p.propertyName === n)
        || (ts.isMethodDeclaration(p) && p.name === n)
        || (ts.isPropertyDeclaration(p) && p.name === n)
        || (ts.isPropertySignature(p) && p.name === n));
    };

    const eachRecorderOccurrence = (root, cb) => {
      const walk = (n) => {
        if (ts.isIdentifier(n) && !isPropertyNamePosition(n)) {
          const hit = recorderAt(n);
          if (hit) cb(hit, n);
        }
        ts.forEachChild(n, walk);
      };
      walk(root);
    };

    // 2. Every `await waitFor(...)`.
    const waits = [];
    const findWaits = (n) => {
      if (ts.isAwaitExpression(n) && ts.isCallExpression(n.expression)) {
        const callee = n.expression.expression;
        if (ts.isIdentifier(callee) && callee.text === 'waitFor') waits.push(n);
      }
      ts.forEachChild(n, findWaits);
    };
    findWaits(sf);

    for (const wait of waits) {
      const waitSet = new Set();
      const waitSpelling = new Map();
      for (const arg of wait.expression.arguments) {
        eachRecorderOccurrence(arg, (hit) => {
          waitSet.add(hit.key);
          // Spell a recorder as the WAIT writes it, not as its push site does:
          // two distinct arrays can share a push-site spelling, and printing
          // that makes a correct flag read as "waits [calls] reads calls".
          waitSpelling.set(hit.key, hit.node.getText(sf));
        });
      }

      // 3. The forward window, scoped to the enclosing test body.
      const seen = new Set();
      for (const stmt of windowStatements(wait)) {
        eachRecorderOccurrence(stmt, (hit, id) => {
          if (waitSet.has(hit.key) || seen.has(hit.key)) return;
          if (classifyOccurrence(hit.node, declNames) !== 'read') return;
          seen.add(hit.key);
          flags.push({
            file,
            line: lineOf(id.getStart(sf)),
            waitLine: lineOf(wait.getStart(sf)),
            recorder: hit.node.getText(sf),
            waitSet: [...waitSet].map((k) => waitSpelling.get(k) ?? recorders.get(k) ?? k),
          });
        });
      }
    }
  }
  return flags;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export function trackedTestFiles() {
  return execSync("git ls-files '*.test.ts' '*.test.tsx'", {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  }).split('\n').filter(Boolean);
}

function main() {
  const argOf = (flag) => {
    const hit = process.argv.find((a) => a.startsWith(`${flag}=`));
    return hit ? hit.slice(flag.length + 1) : null;
  };
  const matcher = argOf('--matcher') ?? 'ast';
  const mode = argOf('--recorder-match') ?? 'path';
  if (!['ast', 'regex'].includes(matcher)) {
    console.error(`unknown --matcher=${matcher} (expected ast|regex)`);
    process.exit(2);
  }
  if (!['ident', 'path'].includes(mode)) {
    console.error(`unknown --recorder-match=${mode} (expected ident|path)`);
    process.exit(2);
  }

  const filesIdx = process.argv.indexOf('--files');
  const files = filesIdx === -1
    ? trackedTestFiles()
    : process.argv.slice(filesIdx + 1).filter((a) => !a.startsWith('--'));

  const flags = matcher === 'ast' ? analyzeAst(files) : analyzeRegex(files, mode);
  const strict = flags.filter((f) => f.waitSet.length > 0);

  console.log(`matcher:        ${matcher}${matcher === 'regex' ? ` (--recorder-match=${mode})` : ''}`);
  console.log(`population:     ${files.length} test files`);
  console.log(`total flags:    ${flags.length}`);
  console.log(`  wait named a recorder (the strict shape): ${strict.length} in ${new Set(strict.map((f) => f.file)).size} files`);
  console.log(`  wait named no recorder (a DOM node, a hook result, a test id): ${flags.length - strict.length}`);
  console.log(
    matcher === 'ast'
      ? '⚠️  READINGS, not corpus facts. objectui#8704 removed name-matching and\n'
        + '    declarations-read-as-reads outright, and only the RUNAWAY half of the\n'
        + '    window rule: a wait hosted in a helper still cannot see its caller.\n'
        + '    R1-R3 in this file\'s header are what is left, and a flag is still a\n'
        + '    site to READ, never a defect. ⛔ Not a gate.'
      : '⚠️  the ORIGINAL objectui#8690 matcher, kept only so its published numbers\n'
        + '    stay reproducible. About a third of its strict bucket is not a read at\n'
        + '    all (objectui#8703). ⛔ Never quote it — run the default AST matcher.',
  );
  console.log('--- strict-shape sites (READ each one; this list is not a defect list) ---');
  for (const f of strict.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line)) {
    console.log(`${f.file}:${f.line}  wait@${f.waitLine} waits [${f.waitSet.join(', ')}] reads ${f.recorder}`);
  }
}

if (isEntrypoint(import.meta.url)) main();
