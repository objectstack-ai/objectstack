#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Rejects a `vi.mock` factory whose OVERRIDE VALUE has a different shape from
 * the export it stands in for.
 *
 * Run:  node scripts/check-vi-mock-override-shape.mjs
 *       node scripts/check-vi-mock-override-shape.mjs --list   # every override, with its verdict
 *       node scripts/check-vi-mock-override-shape.mjs --json
 * Exit: 0 = OK, 1 = an unregistered mismatch, a stale baseline entry, or a
 *       collapsed population.
 *
 * ## The defect (objectui#8903, measured on objectui#8083 / PR #8902)
 *
 * Thirteen `RecordDetailView` test files stubbed `useRecordPresence` as
 * `{ viewers: [], others: [] }`. The real hook returns `PresenceUser[]`, and its
 * only consumer reads `recordPresence.length > 0` -- an object has no `length`,
 * so the presence row was structurally unrenderable in those files. They
 * exercised the no-presence branch through a SHAPE MISMATCH rather than through
 * the empty array the branch is about.
 *
 * Nothing saw it. `tsc` does not: a `vi.mock` factory is untyped, so the
 * compiler never compares the stub against `PresenceUser[]`. Neither did either
 * sibling gate, and that is not an inference -- it was measured by putting the
 * thirteen drifted stubs back on disk and running both:
 *
 *     check-vi-mock-specifiers   verdict line byte-identical, exit 0
 *     check-vi-mock-inherit      verdict line byte-identical, exit 0
 *
 * Byte-identical to the repaired tree, in both cases. `check-vi-mock-specifiers`
 * judges whether a RELATIVE specifier resolves to a file, and these mock the
 * bare specifier `@object-ui/collaboration`, which its own summary counts under
 * `bare (out of scope)`. `check-vi-mock-inherit` judges whether the factory
 * OBTAINS AND SPREADS the real module, and all thirteen already did -- they were
 * fully compliant WITH the drift inside them. Two gates over the same population,
 * neither of which judges the override's VALUE.
 *
 * ⚠️ The failure mode is the asymmetric one. When the stubbed contract changes,
 * the files that stubbed it CORRECTLY go red and the drifted ones stay green:
 * the suite splits down the middle and the majority quietly stops tracking the
 * hook. objectui#8083 put it as "the 9 correct files move and the 13 stay green".
 *
 * ⭐ And the shape `{ viewers, others }` exists NOWHERE else in this tree -- a
 * full scan found it only in those thirteen stubs. So this drift is not a
 * misread type; it is a neighbouring-but-different shape arriving by COPY-PASTE.
 * A guard that only asks "does the factory spread the real module" has no
 * discriminating power over it whatever, which is precisely
 * `check-vi-mock-inherit`'s blind spot. This gate compares the override's value
 * shape against the export's DECLARED shape, or it is not a guard at all.
 *
 * ## Why a third gate, and not an extension -- measured, not preferred
 *
 * The natural first move is to widen `check-vi-mock-inherit.mjs`: same call
 * sites, same covered specifiers, one fewer file to read. It is not available,
 * and the reason is mechanical rather than aesthetic.
 *
 * Reading a DECLARED shape means parsing TypeScript -- return-type annotations,
 * re-export chains, type-only exports. This file therefore imports `typescript`.
 * `check-vi-mock-inherit.mjs` runs in `.github/workflows/repo-gates.yml`, in a
 * step deliberately placed BEFORE that job's install step so that it can run on
 * every pull request shape at the cost of a checkout plus one `node` call; the import graph
 * of every pre-install gate is enforced to be node builtins plus repo-relative
 * modules only (objectui#6148). Adding the import to the sibling was measured
 * rather than argued -- injected on disk, blob hash before/after recorded:
 *
 *     node scripts/check-pre-install-import-graph.mjs
 *       before injection : exit 0
 *       after  injection : exit 1 -- "scripts/check-vi-mock-inherit.mjs reaches
 *                                     the package `typescript`"
 *
 * Extending the sibling would REDDEN AN EXISTING GATE. That settles the route:
 * this is a new gate, and it lives in `lint.yml`, after `pnpm install`.
 *
 * `lint.yml` gates its steps behind a "needs a full run" switch, so the second
 * half of the route question is whether that switch is a blind spot here. Its
 * ignore list covers Markdown files anywhere, plus the `content`, `docs` and
 * `.changeset` trees. An
 * override lives in a `.ts`/`.tsx` file and a declared export shape lives in
 * one too, so no change this gate can judge is reachable through those paths.
 * `scripts/__tests__/check-vi-mock-override-shape.test.ts` pins that, and fails
 * if a pattern matching a TypeScript file is ever added to the list.
 *
 * Two further properties argue the same way. `check-vi-mock-inherit` judges
 * 100% of its population -- every covered call site gets a verdict. This
 * predicate is PARTIAL by construction (see below), so fusing them would make
 * one census line mean two different things about two different denominators.
 * And its predicate is a property of the factory's own text; this one has to
 * resolve modules. Different inputs, different failure modes, different homes.
 *
 * ## Certainty or nothing -- the rule that keeps this gate alive
 *
 * A gate that reddens correct code gets deleted rather than fixed. So both
 * sides of every comparison are read for CERTAINTY, and anything less is
 * `unknown` -- and `unknown` on either side is never a conflict, in either
 * direction. Concretely:
 *
 *   - `T[]`, `Array<T>`, `ReadonlyArray<T>` and a tuple are certainly arrays;
 *     an object type literal and `Record<K, V>` are certainly objects.
 *   - A bare type reference (`PresenceUser`, `ReactNode`, `Promise<X>`) is
 *     `unknown` unless it names an interface or type alias declared in the SAME
 *     file, without type parameters, at most four hops deep.
 *   - An interface or type literal carrying a CALL or CONSTRUCT signature reads
 *     `unknown`, never "object": it is a function at runtime, and reading it as
 *     an object would redden a correct function stub.
 *   - A union, a conditional, a generic instantiation and an inferred return
 *     with disagreeing `return` statements are all `unknown`.
 *   - On the stub side: an array literal, an object literal and the string,
 *     number and boolean literals are certain; an identifier, a call and
 *     `vi.fn()` are `unknown`.
 *
 * That is why the census reports three denominators and not one. Measured on
 * `aeaa0f6`:
 *
 *     1496 override(s) found on covered specifiers
 *      923 judged            -- the DECLARED side has a certain top-level kind,
 *                               so a stub of a different kind conflicts
 *      391 to the RETURN shape -- the declared function's return kind is certain
 *                               too, which is the depth THIS card's drift lives
 *                               at (a function returning an array, stubbed as a
 *                               function returning an object)
 *       14 export not resolvable
 *      559 shape not statically certain
 *
 * The gate is GREEN AT REST over all of it: zero mismatches in the tree today,
 * which is why `KNOWN_SHAPE_MISMATCHES` is empty. The existing bare-specifier
 * population is NOT reddened by this gate -- 937 of them at `aeaa0f6`, and the
 * ruling that landed this gate named leaving them alone as a boundary. Nothing
 * had to be grandfathered because nothing in the tree violates the predicate.
 *
 * ## Which direction can this gate FAIL in?
 *
 * It fails when a judged override's shape CONFLICTS with the declared export.
 * That is proved, not asserted: the thirteen historical stubs, restored to disk
 * byte-for-byte from PR #8902's pre-image, make it print thirteen findings and
 * exit 1, each naming the file, the export, the declared shape and the stub's;
 * repairing them returns it to exit 0. Both legs are in this gate's test file,
 * and neither is decoration.
 *
 * It CANNOT fail on an `unknown`, by design -- which is a real limit and is
 * stated here rather than hidden: an override whose value is a `vi.fn()` or a
 * local identifier is counted and never judged.
 *
 * ## The ledger, and why it is SHRINK-ONLY
 *
 * `KNOWN_SHAPE_MISMATCHES` registers mismatches that are known and tolerated,
 * by `<file>:<specifier>:<export>`. It is empty today. A registered entry that
 * NO LONGER mismatches is itself a failure: that is what stops the ledger from
 * quietly becoming a blanket over a class it was meant to be retiring. Adding
 * an entry is a deliberate admission; it is never the way to make a red run
 * green.
 *
 * ## Green at rest
 *
 * A scan that finds nothing reports OK and reads as coverage -- this gate's own
 * defect, one level up. `FLOORS` therefore fails the run if the population
 * collapses. The floors are set with room: they exist to catch a walk that
 * broke, not to pin today's figures, which move every day.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { isEntrypoint } from './invoked-as.mjs';
import { COVERED_SPECIFIERS } from './check-vi-mock-inherit.mjs';

const SOURCE_FILE_RE = /\.[cm]?[jt]sx?$/;
const TEST_FILE_RE = /(\.(test|spec)\.[cm]?[jt]sx?$)|((^|\/)__tests__\/)/;
const EXCLUDED = /(^|\/)(node_modules|dist|build|\.next|\.turbo|\.wt-[^/]*)\//;
const NUL = String.fromCharCode(0);

export const FLOORS = Object.freeze({ sources: 1000, testFiles: 1000, overrides: 500, judged: 50 });

export const KNOWN_SHAPE_MISMATCHES = Object.freeze([]);

const UNKNOWN = Object.freeze({ kind: 'unknown' });
const of = (kind, returns) => (returns ? { kind, returns } : { kind });

export function describeShape(shape) {
  if (!shape || shape.kind === 'unknown') return 'unknown';
  if (shape.kind === 'function') return `a function returning ${describeShape(shape.returns)}`;
  if (shape.kind === 'array') return 'an array';
  if (shape.kind === 'object') return 'an object';
  return `a ${shape.kind}`;
}

export function shapeOfTypeNode(node, resolveRef = null, depth = 0) {
  if (!node || depth > 4) return UNKNOWN;
  const recur = (n) => shapeOfTypeNode(n, resolveRef, depth + 1);
  if (ts.isParenthesizedTypeNode(node)) return recur(node.type);
  if (ts.isArrayTypeNode(node)) return of('array');
  if (ts.isTupleTypeNode(node)) return of('array');
  if (ts.isTypeLiteralNode(node)) return callableMembers(node.members) ? UNKNOWN : of('object');
  if (ts.isFunctionTypeNode(node)) return of('function', recur(node.type));
  if (node.kind === ts.SyntaxKind.StringKeyword) return of('string');
  if (node.kind === ts.SyntaxKind.NumberKeyword) return of('number');
  if (node.kind === ts.SyntaxKind.BooleanKeyword) return of('boolean');
  if (ts.isTypeReferenceNode(node)) {
    const name = node.typeName.getText(node.getSourceFile());
    if (name === 'Array' || name === 'ReadonlyArray') return of('array');
    if (name === 'Record') return of('object');
    // One hop through a LOCAL declaration. Anything imported, generic,
    // conditional or union stays `unknown` -- see "Certainty or nothing".
    if (resolveRef && !node.typeArguments) {
      const target = resolveRef(name);
      if (target) return recur(target);
    }
    return UNKNOWN;
  }
  return UNKNOWN;
}

/**
 * Does this member list make the type CALLABLE or CONSTRUCTABLE? An interface
 * with a call signature is a function at runtime, so reading it as an object
 * would redden a correct function stub -- a false positive in the direction
 * that gets gates deleted.
 */
function callableMembers(members) {
  return (members || []).some((m) => ts.isCallSignatureDeclaration(m) || ts.isConstructSignatureDeclaration(m));
}

/**
 * A resolver for type names declared in `sf` itself: an interface, or a type
 * alias. Returns the TYPE NODE to read, or null when the name is not a local
 * declaration this gate is willing to read.
 */
function localTypeResolver(sf) {
  return (name) => {
    for (const st of sf.statements) {
      if (ts.isInterfaceDeclaration(st) && st.name.text === name) {
        if (st.typeParameters && st.typeParameters.length > 0) return null;
        if (callableMembers(st.members)) return null;
        // An interface is an object type; hand back a synthetic empty literal.
        return ts.factory.createTypeLiteralNode([]);
      }
      if (ts.isTypeAliasDeclaration(st) && st.name.text === name) {
        if (st.typeParameters && st.typeParameters.length > 0) return null;
        return st.type;
      }
    }
    return null;
  };
}

export function shapeOfExpression(node, resolveRef = null) {
  if (!node) return UNKNOWN;
  if (ts.isParenthesizedExpression(node)) return shapeOfExpression(node.expression, resolveRef);
  if (ts.isAsExpression(node)) return shapeOfExpression(node.expression, resolveRef);
  if (ts.isSatisfiesExpression && ts.isSatisfiesExpression(node)) return shapeOfExpression(node.expression, resolveRef);
  if (ts.isArrayLiteralExpression(node)) return of('array');
  if (ts.isObjectLiteralExpression(node)) return of('object');
  if (ts.isStringLiteralLike(node)) return of('string');
  if (ts.isNumericLiteral(node)) return of('number');
  if (node.kind === ts.SyntaxKind.TrueKeyword || node.kind === ts.SyntaxKind.FalseKeyword) return of('boolean');
  if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) {
    if (node.type) return of('function', shapeOfTypeNode(node.type, resolveRef));
    return of('function', shapeOfFunctionBody(node.body, resolveRef));
  }
  return UNKNOWN;
}

function shapeOfFunctionBody(body, resolveRef = null) {
  if (!body) return UNKNOWN;
  if (!ts.isBlock(body)) return shapeOfExpression(body, resolveRef);
  const shapes = [];
  const walk = (n) => {
    if (ts.isFunctionDeclaration(n) || ts.isFunctionExpression(n) || ts.isArrowFunction(n)) return;
    if (ts.isReturnStatement(n)) shapes.push(n.expression ? shapeOfExpression(n.expression, resolveRef) : UNKNOWN);
    ts.forEachChild(n, walk);
  };
  ts.forEachChild(body, walk);
  if (shapes.length === 0) return UNKNOWN;
  const first = shapes[0];
  if (first.kind === 'unknown') return UNKNOWN;
  return shapes.every((s) => s.kind === first.kind) ? of(first.kind) : UNKNOWN;
}

export function conflicts(declared, actual) {
  if (!declared || !actual) return false;
  if (declared.kind === 'unknown' || actual.kind === 'unknown') return false;
  if (declared.kind !== actual.kind) return true;
  if (declared.kind === 'function') return conflicts(declared.returns, actual.returns);
  return false;
}

function parseFile(abs, cache) {
  if (cache.has(abs)) return cache.get(abs);
  let sf = null;
  try {
    const text = readFileSync(abs, 'utf8');
    sf = ts.createSourceFile(abs, text, ts.ScriptTarget.Latest, true, /\.tsx$/.test(abs) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  } catch {
    sf = null;
  }
  cache.set(abs, sf);
  return sf;
}

function resolveRelative(fromFile, spec) {
  const base = resolve(dirname(fromFile), spec.replace(/\.jsx?$/, ''));
  for (const cand of [`${base}.ts`, `${base}.tsx`, `${base}.mts`, `${base}.d.ts`, join(base, 'index.ts'), join(base, 'index.tsx')]) {
    if (existsSync(cand)) return cand;
  }
  return null;
}

export function workspaceEntries(root) {
  const map = new Map();
  for (const group of ['packages', 'apps']) {
    const dir = join(root, group);
    if (!existsSync(dir)) continue;
    let names = [];
    try {
      names = readdirSync(dir);
    } catch {
      names = [];
    }
    for (const name of names) {
      const pj = join(dir, name, 'package.json');
      if (!existsSync(pj)) continue;
      let parsed;
      try {
        parsed = JSON.parse(readFileSync(pj, 'utf8'));
      } catch {
        continue;
      }
      if (!parsed || !parsed.name) continue;
      for (const cand of ['src/index.ts', 'src/index.tsx', 'src/index.mts']) {
        const abs = join(dir, name, cand);
        if (existsSync(abs)) {
          map.set(parsed.name, abs);
          break;
        }
      }
    }
  }
  return map;
}

function declaredShapeIn(file, name, ctx, depth = 0) {
  if (depth > 8 || !file) return null;
  const key = `${file} ${name}`;
  if (ctx.seen.has(key)) return null;
  ctx.seen.add(key);
  const sf = parseFile(file, ctx.files);
  if (!sf) return null;

  const localImports = new Map();
  const starExports = [];

  for (const st of sf.statements) {
    if (ts.isImportDeclaration(st) && st.importClause && st.importClause.namedBindings && ts.isNamedImports(st.importClause.namedBindings)) {
      const spec = st.moduleSpecifier.text;
      for (const el of st.importClause.namedBindings.elements) {
        localImports.set(el.name.text, {
          spec,
          imported: (el.propertyName || el.name).text,
          typeOnly: st.importClause.isTypeOnly || el.isTypeOnly,
        });
      }
    }
    if (ts.isExportDeclaration(st)) {
      if (st.exportClause && ts.isNamedExports(st.exportClause)) {
        for (const el of st.exportClause.elements) {
          if (el.name.text !== name) continue;
          if (st.isTypeOnly || el.isTypeOnly) return null;
          const source = (el.propertyName || el.name).text;
          if (st.moduleSpecifier) return followSpecifier(file, st.moduleSpecifier.text, source, ctx, depth);
          const here = declarationShape(sf, source);
          if (here) return here;
          const via = localImports.get(source);
          if (via && !via.typeOnly) return followSpecifier(file, via.spec, via.imported, ctx, depth);
          return null;
        }
      } else if (st.moduleSpecifier && !st.isTypeOnly) {
        starExports.push(st.moduleSpecifier.text);
      }
    }
  }

  const direct = declarationShape(sf, name, true);
  if (direct) return direct;

  for (const spec of starExports) {
    const found = followSpecifier(file, spec, name, ctx, depth);
    if (found) return found;
  }
  return null;
}

function followSpecifier(fromFile, spec, name, ctx, depth) {
  if (spec.startsWith('.')) {
    const next = resolveRelative(fromFile, spec);
    return next ? declaredShapeIn(next, name, ctx, depth + 1) : null;
  }
  const entry = ctx.entries.get(spec);
  return entry ? declaredShapeIn(entry, name, ctx, depth + 1) : null;
}

function declarationShape(sf, name, exportedOnly = false) {
  const resolveRef = localTypeResolver(sf);
  for (const st of sf.statements) {
    const exported = ts.canHaveModifiers(st) && (ts.getModifiers(st) || []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
    if (exportedOnly && !exported) continue;
    if (ts.isFunctionDeclaration(st) && st.name && st.name.text === name) {
      return {
        shape: of('function', st.type ? shapeOfTypeNode(st.type, resolveRef) : shapeOfFunctionBody(st.body, resolveRef)),
        where: `${sf.fileName}:${lineOf(sf, st)}`,
      };
    }
    if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations) {
        if (!ts.isIdentifier(d.name) || d.name.text !== name) continue;
        if (d.type) return { shape: shapeOfTypeNode(d.type, resolveRef), where: `${sf.fileName}:${lineOf(sf, d)}` };
        return { shape: shapeOfExpression(d.initializer, resolveRef), where: `${sf.fileName}:${lineOf(sf, d)}` };
      }
    }
  }
  return null;
}

const lineOf = (sf, n) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;

function returnedObject(fn) {
  let body = fn.body;
  if (!body) return null;
  if (ts.isBlock(body)) {
    let found = null;
    for (const st of body.statements) {
      if (ts.isReturnStatement(st) && st.expression) {
        found = st.expression;
        break;
      }
    }
    if (!found) return null;
    body = found;
  }
  while (ts.isParenthesizedExpression(body) || ts.isAwaitExpression(body) || ts.isAsExpression(body)) body = body.expression;
  return ts.isObjectLiteralExpression(body) ? body : null;
}

export function findOverrides(rel, source, { covered = COVERED_SPECIFIERS } = {}) {
  const coveredSet = new Set(covered);
  const prefixes = [...coveredSet].map((m) => `${m}/`);
  const isCovered = (s) => coveredSet.has(s) || prefixes.some((p) => s.startsWith(p));
  const sf = ts.createSourceFile(rel, source, ts.ScriptTarget.Latest, true, /\.tsx$/.test(rel) ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out = [];
  const visit = (n) => {
    if (
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      ts.isIdentifier(n.expression.expression) &&
      n.expression.expression.text === 'vi' &&
      (n.expression.name.text === 'mock' || n.expression.name.text === 'doMock')
    ) {
      const a0 = n.arguments[0];
      let spec = null;
      if (a0 && ts.isStringLiteralLike(a0)) spec = a0.text;
      else if (
        a0 &&
        ts.isCallExpression(a0) &&
        a0.expression.kind === ts.SyntaxKind.ImportKeyword &&
        a0.arguments[0] &&
        ts.isStringLiteralLike(a0.arguments[0])
      ) {
        spec = a0.arguments[0].text;
      }
      const factory = n.arguments[1];
      if (spec && isCovered(spec) && factory && (ts.isArrowFunction(factory) || ts.isFunctionExpression(factory))) {
        const obj = returnedObject(factory);
        if (obj) {
          for (const p of obj.properties) {
            if (!ts.isPropertyAssignment(p)) continue;
            if (!ts.isIdentifier(p.name) && !ts.isStringLiteralLike(p.name)) continue;
            out.push({
              specifier: spec,
              exportName: p.name.text,
              line: lineOf(sf, p),
              shape: shapeOfExpression(p.initializer, localTypeResolver(sf)),
              text: p.initializer.getText(sf).replace(/\s+/g, ' ').slice(0, 80),
            });
          }
        }
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

function trackedFiles(root) {
  return execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 })
    .toString('utf8')
    .split(NUL)
    .filter(Boolean);
}

/**
 * The one scan. `main()`, `--list`, `--json` and the test suite all go through
 * here, so the tests exercise the real code path rather than an imitation.
 *
 * @param {string} root  Repository root to scan.
 * @param {{ files?: string[] | null, floors?: Record<string, number>, covered?: readonly string[], baseline?: readonly string[] }} [options]
 *   `files` overrides the `git ls-files` walk (fixtures pass their own list);
 *   `floors` overrides `FLOORS` -- pass `{}` to switch the collapse check off
 *   for a fixture tree, which is legitimately far below every repo floor;
 *   `covered` overrides `COVERED_SPECIFIERS`, so a fixture can exercise the
 *   scope boundary without waiting for the real list to grow;
 *   `baseline` overrides `KNOWN_SHAPE_MISMATCHES`, so the ledger's two
 *   behaviours -- suppress a registered entry, FAIL on a stale one -- are
 *   testable without registering anything in the real tree.
 */
export function scan(root, { files = null, floors = FLOORS, covered = COVERED_SPECIFIERS, baseline = KNOWN_SHAPE_MISMATCHES } = {}) {
  const tracked = files || trackedFiles(root);
  const sources = tracked.filter((f) => SOURCE_FILE_RE.test(f) && !EXCLUDED.test(f));
  const testFiles = sources.filter((f) => TEST_FILE_RE.test(f));
  const entries = workspaceEntries(root);

  const census = { sources: sources.length, testFiles: testFiles.length, filesWithMocks: 0, overrides: 0, judged: 0, deep: 0, unresolved: 0, opaque: 0 };
  const mismatches = [];
  const sites = [];
  const shapeCache = new Map();

  for (const rel of sources) {
    let text;
    try {
      text = readFileSync(join(root, rel), 'utf8');
    } catch {
      continue;
    }
    if (!text.includes('vi.mock') && !text.includes('vi.doMock')) continue;
    const found = findOverrides(rel, text, { covered });
    if (found.length === 0) continue;
    census.filesWithMocks++;
    for (const o of found) {
      census.overrides++;
      const entry = entries.get(o.specifier) || entries.get(o.specifier.split('/').slice(0, 2).join('/'));
      const declared = entry ? declaredShapeIn(entry, o.exportName, { entries, files: shapeCache, seen: new Set() }) : null;
      if (!declared) {
        census.unresolved++;
        sites.push({ file: rel, line: o.line, specifier: o.specifier, exportName: o.exportName, verdict: 'unresolved', declared: 'not found', actual: describeShape(o.shape) });
        continue;
      }
      if (declared.shape.kind === 'unknown' || o.shape.kind === 'unknown') {
        census.opaque++;
        sites.push({ file: rel, line: o.line, specifier: o.specifier, exportName: o.exportName, verdict: 'opaque', declared: describeShape(declared.shape), actual: describeShape(o.shape) });
        continue;
      }
      census.judged++;
      const isDeep = declared.shape.kind !== 'function' || declared.shape.returns.kind !== 'unknown';
      if (isDeep) census.deep++;
      sites.push({ file: rel, line: o.line, specifier: o.specifier, exportName: o.exportName, verdict: conflicts(declared.shape, o.shape) ? 'mismatch' : 'match', declared: describeShape(declared.shape), actual: describeShape(o.shape) });
      if (conflicts(declared.shape, o.shape)) {
        mismatches.push({
          file: rel,
          line: o.line,
          specifier: o.specifier,
          exportName: o.exportName,
          declared: describeShape(declared.shape),
          actual: describeShape(o.shape),
          declaredAt: declared.where.replace(`${root}/`, ''),
          text: o.text,
          id: `${rel}:${o.specifier}:${o.exportName}`,
        });
      }
    }
  }

  const registered = new Set(baseline);
  const unregistered = mismatches.filter((m) => !registered.has(m.id));
  const stale = [...registered].filter((id) => !mismatches.some((m) => m.id === id));

  const vacuous = [];
  for (const [counter, floor] of Object.entries(floors)) {
    if (census[counter] < floor) vacuous.push({ counter, value: census[counter], floor });
  }

  return { census, sites, mismatches, unregistered, stale, vacuous, covered: [...covered] };
}

export function summarise({ census }) {
  return (
    `${census.sources} tracked source file(s), ${census.testFiles} test-named; ` +
    `${census.filesWithMocks} carry a covered mock; ` +
    `${census.overrides} override(s), ${census.judged} judged, ${census.deep} to the RETURN shape ` +
    `(${census.unresolved} export not resolvable, ${census.opaque} shape not statically certain)`
  );
}

function repoRoot() {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..');
}

function main() {
  const result = scan(repoRoot());
  const { unregistered, stale, vacuous } = result;
  if (unregistered.length === 0 && stale.length === 0 && vacuous.length === 0) {
    console.log(`✅  check-vi-mock-override-shape: OK (${summarise(result)}).`);
    process.exit(0);
  }
  if (unregistered.length > 0) {
    console.error(`❌  check-vi-mock-override-shape: ${unregistered.length} override(s) do not match the declared export\n`);
    for (const m of unregistered) {
      console.error(`    - ${m.file}:${m.line} -- vi.mock(${JSON.stringify(m.specifier)}) overrides ${m.exportName}`);
      console.error(`      declared ${m.declared} at ${m.declaredAt}, stub is ${m.actual}: ${m.text}`);
    }
  }
  if (stale.length > 0) {
    console.error(`\n❌  check-vi-mock-override-shape: ${stale.length} registered baseline entry/entries no longer mismatch\n`);
    for (const id of stale) console.error(`    - ${id}`);
  }
  if (vacuous.length > 0) {
    console.error('\n❌  check-vi-mock-override-shape: the population COLLAPSED\n');
    for (const v of vacuous) console.error(`    - ${v.counter}: found ${v.value}, floor is ${v.floor}`);
    console.error(`\nCensus: ${summarise(result)}`);
  }
  process.exit(1);
}

if (isEntrypoint(import.meta.url)) {
  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(scan(repoRoot()), null, 2));
  } else if (process.argv.includes('--list')) {
    const result = scan(repoRoot());
    for (const s of result.sites) {
      console.log(`${s.verdict.toUpperCase().padEnd(10)}  ${s.file}:${s.line}  ${s.specifier} :: ${s.exportName}  declared=${s.declared} stub=${s.actual}`);
    }
    console.log(`\n${summarise(result)}`);
  } else {
    main();
  }
}
