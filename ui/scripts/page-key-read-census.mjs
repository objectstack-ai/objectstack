#!/usr/bin/env node
/**
 * ObjectUI
 * Copyright (c) 2024-present ObjectStack Inc.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * Page-key read census -- every page-level key a renderer reads off page
 * METADATA, put to `PageSchema` itself for a verdict (objectui#9438).
 *
 * Run:  node scripts/page-key-read-census.mjs   (also `pnpm census:page-key-reads`)
 *       node scripts/page-key-read-census.mjs --list   (every read site, verdict included)
 * Exit: 0 whatever it finds. 1 only when the census COLLAPSES -- see "Report-only".
 *
 * ## The asymmetry this measures
 *
 * `PageSchema` (`@objectstack/spec/ui`) is a `strictObject`. A key it does not
 * declare is a HARD PARSE ERROR, not a dropped key -- the opposite of
 * `BaseSchema`, which is `.passthrough()` and KEEPS what it does not judge. So
 * a renderer that reads a page-level key off authored metadata, where the spec
 * refuses that key, is documenting an affordance NO AUTHOR CAN EVER REACH: the
 * page carrying it never parses, the read yields `undefined` on every page that
 * does parse, and the branch behind it is dead in a way that reads as a feature.
 *
 * Two instances were found by hand and retired before this instrument existed
 * (objectui#9438 records both): a `priority` sort in
 * `packages/react/src/hooks/usePageAssignment.ts`, and
 * `(effectivePage as any)?.disableDiscussion` in
 * `packages/app-shell/src/views/RecordDetailView.tsx`. Both are restored as
 * fixtures in `scripts/__tests__/page-key-read-census.test.ts`, because an
 * instrument authored against zero live instances has to show it can fire at
 * all before a zero from it means anything.
 *
 * ## The instrument, stated -- WHICH ORACLE, and WHICH POPULATION
 *
 * objectui#9438's first ask is not a gate; it is a statement of which
 * instrument a gate would read. This script answers with two halves, and
 * neither half is a list written down here.
 *
 *   ORACLE      `PageSchema` at RUNTIME, by `safeParse`. Every key this census
 *               finds being read is put on a minimal valid page and handed to
 *               the schema, and the SCHEMA's answer is the verdict:
 *               `declared` (the page parses), `alias` (refused, and the schema
 *               names the canonical key it should have been -- `pageType` ->
 *               `type` is one), or `refused` (refused outright).
 *               ⛔ NOT `Object.keys(PageSchema.shape)` compared against a
 *               hand-kept list: the shape is printed for context only. Asking
 *               the schema is what makes the verdict survive a spec bump, an
 *               alias being added, or a key being retired behind a tombstone.
 *
 *   POPULATION  every property read on a value that FLOWS FROM the page
 *               metadata cache, derived by a syntactic walk (`typescript`
 *               parser, no type checker) from ONE declared seam:
 *               `useMetadata()`'s `pages` member -- the cache slot the `page`
 *               metadata type fills, declared on the metadata context value in
 *               `packages/react/src/context/AppShellContext.tsx` and pinned by
 *               `usePageAssignment`'s own `ensureType('page')`.
 *
 * ## Why NOT a grep, and why NOT the type checker
 *
 * Both dead ends are measured rather than assumed.
 *
 * A GREP for a dotted key read cannot find the population. `git grep '\.pages'`
 * over `packages/*''/src` returns `usePageAssignment.ts` and nothing else --
 * `PageView.tsx` reaches the same cache slot through
 * `const { pages } = useMetadata()`, which has no `.pages` text in it at all.
 * A grep that misses a root misses every read downstream of it, and reports the
 * miss as a clean zero. (The mirror-image hazard one level down -- a renderer
 * consuming a key it never names, because the node's remaining keys are spread
 * as props -- is why this tree already refuses grep as an instrument for
 * "nothing reads this key".)
 *
 * The TYPE CHECKER cannot see it either, and this is the sharper half: BOTH
 * retired instances were written through a type escape. `usePageAssignment`
 * declares `pages: any[]` and returns `page: any | null`; the
 * `RecordDetailView` read was spelled `(effectivePage as any)?.disableDiscussion`.
 * A checker-driven walk over "expressions whose type is the spec's page type"
 * finds neither, and finds them no better after the spec's types improve,
 * because the escape is on the VALUE. What survives the escape is the SEAM:
 * the cache member is declared even where the value it yields is `any`. So this
 * census anchors on the seam and propagates syntactically, looking THROUGH
 * `as`-casts rather than at them.
 *
 * ## Propagation -- four rules, each one a shape this tree actually writes
 *
 *   ALIAS       `const a = t`, `a = t ?? u`, `a = t || u`, `cond ? t : u`,
 *               `(t)`, `t!`, `t as X` -- casts are transparent, which is the
 *               whole point.
 *   ELEMENT     an array that flows from the cache yields page VALUES through
 *               `find` / `at` / `pop` / `shift`, through indexing (`t[0]`),
 *               through `for (const p of t)`, and through the first parameter
 *               of a `filter` / `find` / `map` / `some` / `every` / `sort` /
 *               `flatMap` / `forEach` callback. `filter` / `slice` / `sort` /
 *               `concat` / `reverse` keep the ARRAY kind.
 *   RETURN      a function that returns a page value is itself a page source;
 *               one that returns `{ page: <a page value> }` is a source AT THAT
 *               MEMBER, so destructuring it binds the taint. `useMemo` /
 *               `useCallback` are transparent to their callback's returns.
 *               This is how `usePageAssignment` becomes a root for its callers
 *               without being named here.
 *   PASS-THROUGH a call to a workspace function whose signature is generic
 *               pass-through -- a type parameter arriving as `T[]` /
 *               `readonly T[]` / `Array<T>` and leaving in the return type --
 *               yields a page value from a page array. `preferLocal` in
 *               `packages/app-shell/src/utils` is the instance; the RULE is
 *               derived from every such signature in the tree, not from its
 *               name.
 *
 * Both source halves iterate to a fixpoint: within a file, and across files
 * (a function only becomes a root once the file that defines it has been read).
 *
 * ## What this deliberately does NOT answer
 *
 * Each is a boundary, not an oversight. A census that overstates its reach is
 * the defect it exists to find, one level up.
 *
 *   1. PAGE NODES ARE NOT PAGE METADATA. `PageNodeSchema`
 *      (`packages/types/src/zod/layout.zod.ts`) is objectui's component-node
 *      schema; it is derived from `PageSchema`'s FIELDS but adds its own
 *      (`pageType` is the node's page-kind discriminator) and inherits
 *      `BaseSchema`'s passthrough. `PageView` deliberately MAPS metadata into a
 *      node (`pageType: page.type`) before handing it to `SchemaRenderer`.
 *      Reads on the node side are a different question with a different oracle,
 *      and this census does not judge them: it stops at the cache.
 *   2. VALUES PASSED AS ARGUMENTS into an ordinary function are not followed.
 *      `hasExplicitAttachments(effectivePage as any)` ends the walk. Following
 *      it means interprocedural parameter taint, which is a type checker's job.
 *   3. KEYS REACHED WITHOUT BEING NAMED -- a spread, a `Object.keys(page)` loop,
 *      a computed `page[k]`. There is no read site to judge, the same boundary
 *      the handler-key gate states for props spreads.
 *   4. WHETHER A DECLARED KEY IS ACTUALLY HONOURED. `isDefault` is declared and
 *      nothing consults it; that is the OPPOSITE asymmetry (declared-not-read)
 *      and it belongs to the `ComponentPropsMap` family of cards.
 *   5. TAINT IS BY IDENTIFIER NAME within a file. A local shadowing a page
 *      binding in a nested scope is judged as the page binding. The direction
 *      is over-report, which a reader can refute; the alternative is a scope
 *      resolver.
 *
 * ## Report-only, and why the NAME is what keeps it that way
 *
 * This is a `census:*` script, and in this tree that spelling already means
 * "runnable, reported, not blocking" -- `census:body-dialect` and
 * `census:cross-file-line-citations` appear in no workflow, while a
 * `check:*` name invites the next sweep to wire it in. objectui#9438's triage
 * drew that line explicitly: a REPORTING scan is this card's to deliver, an
 * ENFORCING gate is a new required check and belongs to the maintainer. So
 * findings NEVER set the exit code.
 *
 * The one nonzero exit is instrument integrity: if the seam moves and the
 * census finds no roots at all, it reports ZERO READS -- which renders exactly
 * like a clean tree. That reading is refused rather than printed.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

import { isEntrypoint } from './invoked-as.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
export const REPO_ROOT = resolve(HERE, '..');

// ---------------------------------------------------------------------------
// The seam -- the ONE anchor, and the integrity check that it still exists
// ---------------------------------------------------------------------------

/** The hook that hands out the metadata cache. */
export const METADATA_HOOK = 'useMetadata';

/** The cache member the `page` metadata type fills. */
export const PAGE_CACHE_MEMBER = 'pages';

/** Where that member is declared, for the integrity check. */
export const SEAM_DECLARATION = 'packages/react/src/context/AppShellContext.tsx';

// ---------------------------------------------------------------------------
// The oracle -- PageSchema itself, asked one key at a time
// ---------------------------------------------------------------------------

/** A page that must parse clean, so a refusal below is about the added key. */
export const BASE_PAGE = Object.freeze({ name: 'page_census_probe', label: 'Census probe' });

/** A key no schema will ever declare -- the control that must come back refused. */
export const NONSENSE_KEY = 'zzzNotAPageKeyEver';

/**
 * Ask `PageSchema` what it does with `key`.
 *
 * @param {{ safeParse: (v: unknown) => { success: boolean, error?: any } }} PageSchema
 * @param {string} key
 * @returns {{ verdict: 'declared'|'alias'|'refused', canonical?: string, message?: string }}
 */
export function askSchema(PageSchema, key) {
  const result = PageSchema.safeParse({ ...BASE_PAGE, [key]: PROBE_VALUE });
  if (result.success) return { verdict: 'declared' };
  const issues = result.error?.issues ?? [];
  // A key the schema DECLARES can still fail on its VALUE -- the probe value is
  // deliberately a shape nothing accepts. That is a declared key, not a refused
  // one: the difference is whether the complaint is about the key or the value.
  const unrecognized = issues.find(
    (i) => i.code === 'unrecognized_keys' && (i.keys ?? []).includes(key),
  );
  if (!unrecognized) return { verdict: 'declared' };
  const canonical = aliasFromMessage(String(unrecognized.message ?? ''), key);
  return canonical
    ? { verdict: 'alias', canonical, message: String(unrecognized.message ?? '') }
    : { verdict: 'refused', message: String(unrecognized.message ?? '') };
}

/**
 * A value chosen so it is wrong for every declared key -- forcing a declared
 * key to fail on its VALUE, which is what makes the `unrecognized_keys` test
 * above the thing that separates declared from refused.
 */
const PROBE_VALUE = Symbol.for('objectui.page-key-census.probe');

/**
 * The canonical key `PageSchema`'s own alias guidance names for `key`, or null.
 *
 * The schema spells it `Did you mean \`pageType\` -> \`type\`?` inside the
 * refusal message. Parsing the message is reading the schema's answer; the
 * alternative is a second copy of the alias table, which is the drift this
 * census exists to catch.
 */
export function aliasFromMessage(message, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp('`' + escaped + '`\\s*(?:->|→)\\s*`([^`]+)`').exec(message);
  return m ? m[1] : null;
}

// ---------------------------------------------------------------------------
// Source discovery
// ---------------------------------------------------------------------------

const SOURCE_EXT = /\.(ts|tsx)$/;
const SKIP_DIR = new Set(['node_modules', 'dist', 'build', '.turbo', '__tests__', '__mocks__']);
const TEST_FILE = /\.(test|spec)\.tsx?$/;

/** Every non-test source file under `packages/<pkg>/src`. */
export function listPackageSources(root = REPO_ROOT) {
  const out = [];
  const packagesDir = join(root, 'packages');
  let entries;
  try {
    entries = readdirSync(packagesDir);
  } catch {
    return out;
  }
  for (const pkg of entries) {
    const src = join(packagesDir, pkg, 'src');
    try {
      if (!statSync(src).isDirectory()) continue;
    } catch {
      continue;
    }
    walk(src, out);
  }
  return out.sort();
}

function walk(dir, out) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIR.has(entry.name)) continue;
      walk(join(dir, entry.name), out);
      continue;
    }
    if (!SOURCE_EXT.test(entry.name)) continue;
    if (TEST_FILE.test(entry.name)) continue;
    out.push(join(dir, entry.name));
  }
}

// ---------------------------------------------------------------------------
// The walk
// ---------------------------------------------------------------------------

const ELEMENT_CALLBACK_METHODS = new Set([
  'filter', 'find', 'findLast', 'findIndex', 'map', 'flatMap', 'forEach', 'some', 'every', 'sort',
]);
const ARRAY_KEEPING_METHODS = new Set(['filter', 'slice', 'sort', 'concat', 'reverse', 'toSorted']);
const ELEMENT_YIELDING_METHODS = new Set(['find', 'findLast', 'at', 'pop', 'shift']);

/**
 * Property names that belong to every JavaScript object, so reading one says
 * nothing about the page contract.
 */
export const JS_OBJECT_MEMBERS = new Set([
  'constructor', 'hasOwnProperty', 'isPrototypeOf', 'propertyIsEnumerable',
  'toLocaleString', 'toString', 'valueOf', '__proto__',
]);

/** Strip the wrappers a read can hide behind. `as any` is the important one. */
export function unwrap(node) {
  let n = node;
  for (;;) {
    if (ts.isParenthesizedExpression(n) || ts.isAsExpression(n) || ts.isNonNullExpression(n)
      || ts.isTypeAssertionExpression?.(n) || ts.isSatisfiesExpression?.(n)) {
      n = n.expression;
      continue;
    }
    return n;
  }
}

/**
 * Generic pass-through signatures in the tree: a type parameter arriving as an
 * array and leaving in the return type. Derived, never named.
 *
 * @returns {Map<string, { index: number, from: 'array'|'value' }>}
 */
export function derivePassThroughHelpers(sources) {
  const helpers = new Map();
  for (const { text, path } of sources) {
    const sf = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, scriptKind(path));
    const visit = (node) => {
      if (ts.isFunctionDeclaration(node) && node.name && node.typeParameters?.length && node.type) {
        const params = node.typeParameters.map((p) => p.name.text);
        const returnNames = typeRefNames(node.type);
        const carried = params.find((p) => returnNames.has(p));
        if (carried) {
          for (let i = 0; i < node.parameters.length; i += 1) {
            const pt = node.parameters[i].type;
            if (!pt) continue;
            const kind = parameterCarrier(pt, carried);
            if (kind) {
              helpers.set(node.name.text, { index: i, from: kind });
              break;
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return helpers;
}

/** Is `typeNode` the type parameter `name` itself, or an array of it? */
function parameterCarrier(typeNode, name) {
  let t = typeNode;
  while (ts.isParenthesizedTypeNode(t)) t = t.type;
  if (ts.isTypeOperatorNode(t) && t.operator === ts.SyntaxKind.ReadonlyKeyword) t = t.type;
  if (ts.isUnionTypeNode(t)) {
    for (const member of t.types) {
      const kind = parameterCarrier(member, name);
      if (kind) return kind;
    }
    return null;
  }
  if (ts.isArrayTypeNode(t)) return isNamed(t.elementType, name) ? 'array' : null;
  if (ts.isTypeReferenceNode(t) && t.typeName.getText?.() === 'Array' && t.typeArguments?.length === 1) {
    return isNamed(t.typeArguments[0], name) ? 'array' : null;
  }
  return isNamed(t, name) ? 'value' : null;
}

function isNamed(typeNode, name) {
  let t = typeNode;
  while (ts.isParenthesizedTypeNode(t)) t = t.type;
  return ts.isTypeReferenceNode(t) && !t.typeArguments && t.typeName.getText?.() === name;
}

function typeRefNames(typeNode) {
  const names = new Set();
  const visit = (n) => {
    if (ts.isTypeReferenceNode(n) && n.typeName.getText?.()) names.add(n.typeName.getText());
    ts.forEachChild(n, visit);
  };
  visit(typeNode);
  return names;
}

function scriptKind(path) {
  return path.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
}

/**
 * Walk one file.
 *
 * @param {{ path: string, text: string }} file
 * @param {Map<string, Set<string>>} exportTaint  symbol -> {'*'} | member names
 * @param {Map<string, { index: number, from: 'array'|'value' }>} helpers
 * @returns {{ reads: Array, exports: Map<string, Set<string>>, roots: number }}
 */
export function analyzeFile(file, exportTaint, helpers) {
  const sf = ts.createSourceFile(file.path, file.text, ts.ScriptTarget.Latest, true, scriptKind(file.path));
  const valueTaint = new Set();
  const arrayTaint = new Set();
  const metaLocals = new Set();
  const exports = new Map();

  /** 'value' | 'array' | null */
  const kindOf = (raw) => {
    const node = unwrap(raw);
    if (ts.isIdentifier(node)) {
      if (valueTaint.has(node.text)) return 'value';
      if (arrayTaint.has(node.text)) return 'array';
      return null;
    }
    if (ts.isBinaryExpression(node)) {
      const op = node.operatorToken.kind;
      if (op === ts.SyntaxKind.BarBarToken || op === ts.SyntaxKind.QuestionQuestionToken) {
        return kindOf(node.left) ?? kindOf(node.right);
      }
      return null;
    }
    if (ts.isConditionalExpression(node)) return kindOf(node.whenTrue) ?? kindOf(node.whenFalse);
    if (ts.isPropertyAccessExpression(node)) {
      if (node.name.text === PAGE_CACHE_MEMBER && isMetadataValue(node.expression)) return 'array';
      return null;
    }
    if (ts.isElementAccessExpression(node)) {
      return kindOf(node.expression) === 'array' ? 'value' : null;
    }
    if (ts.isCallExpression(node)) return callKind(node);
    if (ts.isAwaitExpression(node)) return kindOf(node.expression);
    return null;
  };

  const isMetadataValue = (raw) => {
    const node = unwrap(raw);
    if (ts.isIdentifier(node)) return metaLocals.has(node.text);
    if (ts.isCallExpression(node)) {
      const callee = unwrap(node.expression);
      return ts.isIdentifier(callee) && callee.text === METADATA_HOOK;
    }
    return false;
  };

  const callKind = (node) => {
    const callee = unwrap(node.expression);
    // useMemo / useCallback are transparent to their callback's returns.
    if (ts.isIdentifier(callee) && (callee.text === 'useMemo' || callee.text === 'useCallback')) {
      return functionKind(node.arguments[0]);
    }
    if (ts.isIdentifier(callee)) {
      const helper = helpers.get(callee.text);
      if (helper) {
        const arg = node.arguments[helper.index];
        if (arg && kindOf(arg) === helper.from) return 'value';
      }
      const exported = exportTaint.get(callee.text);
      if (exported?.has('*')) return 'value';
      return null;
    }
    if (ts.isPropertyAccessExpression(callee)) {
      const receiver = kindOf(callee.expression);
      if (receiver !== 'array') return null;
      const method = callee.name.text;
      if (ELEMENT_YIELDING_METHODS.has(method)) return 'value';
      if (ARRAY_KEEPING_METHODS.has(method)) return 'array';
      return null;
    }
    return null;
  };

  /** The union of what a function-ish node returns. */
  const functionKind = (raw) => {
    if (!raw) return null;
    const fn = unwrap(raw);
    if (!isFunctionish(fn)) return null;
    if (fn.body && !ts.isBlock(fn.body)) return kindOf(fn.body);
    let found = null;
    forEachReturn(fn, (expr) => {
      found = found ?? kindOf(expr);
    });
    return found;
  };

  /** The members a function-ish node returns as page values. */
  const functionMemberKinds = (raw) => {
    const out = new Set();
    if (!raw) return out;
    const fn = unwrap(raw);
    if (!isFunctionish(fn)) return out;
    const collect = (expr) => {
      const obj = unwrap(expr);
      if (!ts.isObjectLiteralExpression(obj)) return;
      for (const prop of obj.properties) {
        if (ts.isPropertyAssignment(prop) && prop.name && !ts.isComputedPropertyName(prop.name)) {
          if (kindOf(prop.initializer) === 'value') out.add(prop.name.getText());
        } else if (ts.isShorthandPropertyAssignment(prop)) {
          if (valueTaint.has(prop.name.text)) out.add(prop.name.text);
        }
      }
    };
    if (fn.body && !ts.isBlock(fn.body)) collect(fn.body);
    else forEachReturn(fn, collect);
    return out;
  };

  /** Members a call/expression yields as page values, for destructuring. */
  const memberKinds = (raw) => {
    const node = unwrap(raw);
    if (ts.isCallExpression(node)) {
      const callee = unwrap(node.expression);
      if (ts.isIdentifier(callee)) {
        if (callee.text === 'useMemo' || callee.text === 'useCallback') {
          return functionMemberKinds(node.arguments[0]);
        }
        if (callee.text === METADATA_HOOK) return new Set([PAGE_CACHE_MEMBER]);
        const exported = exportTaint.get(callee.text);
        if (exported) return new Set([...exported].filter((m) => m !== '*'));
      }
      return new Set();
    }
    if (ts.isObjectLiteralExpression(node)) return functionMemberKinds(node);
    return new Set();
  };

  const bind = (nameNode, kind) => {
    if (!ts.isIdentifier(nameNode)) return false;
    const set = kind === 'array' ? arrayTaint : valueTaint;
    if (set.has(nameNode.text)) return false;
    set.add(nameNode.text);
    return true;
  };

  // --- fixpoint over the file -------------------------------------------------
  let grew = true;
  let passes = 0;
  while (grew && passes < 12) {
    grew = false;
    passes += 1;

    const seed = (node) => {
      if (ts.isVariableDeclaration(node) && node.initializer) {
        const init = node.initializer;
        // `const meta = useMetadata()`
        if (ts.isIdentifier(node.name) && isMetadataValue(init) && !metaLocals.has(node.name.text)) {
          metaLocals.add(node.name.text);
          grew = true;
        }
        const kind = kindOf(init);
        if (kind && bind(node.name, kind)) grew = true;
        if (ts.isObjectBindingPattern(node.name)) {
          const members = memberKinds(init);
          const arrayMembers = isMetadataValue(init) ? new Set([PAGE_CACHE_MEMBER]) : new Set();
          for (const element of node.name.elements) {
            if (element.dotDotDotToken || ts.isComputedPropertyName(element.propertyName ?? element.name)) continue;
            const from = (element.propertyName ?? element.name).getText();
            if (arrayMembers.has(from)) {
              if (bind(element.name, 'array')) grew = true;
            } else if (members.has(from)) {
              if (bind(element.name, 'value')) grew = true;
            }
          }
        }
      }

      // `for (const p of <page array>)`
      if (ts.isForOfStatement(node) && kindOf(node.expression) === 'array') {
        const decl = node.initializer;
        if (ts.isVariableDeclarationList(decl) && decl.declarations[0]) {
          if (bind(decl.declarations[0].name, 'value')) grew = true;
        }
      }

      // `<page array>.filter(p => ...)` binds `p`
      if (ts.isCallExpression(node)) {
        const callee = unwrap(node.expression);
        if (ts.isPropertyAccessExpression(callee)
          && ELEMENT_CALLBACK_METHODS.has(callee.name.text)
          && kindOf(callee.expression) === 'array') {
          const cb = node.arguments[0] ? unwrap(node.arguments[0]) : undefined;
          if (cb && isFunctionish(cb) && cb.parameters?.length) {
            if (bind(cb.parameters[0].name, 'value')) grew = true;
          }
        }
      }

      // plain reassignment: `x = <page value>`
      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
        const kind = kindOf(node.right);
        const target = unwrap(node.left);
        if (kind && ts.isIdentifier(target)) {
          if (bind(target, kind)) grew = true;
        }
      }

      ts.forEachChild(node, seed);
    };
    seed(sf);
  }

  // --- what this file exports as a page source -------------------------------
  const collectExports = (node) => {
    if ((ts.isFunctionDeclaration(node) || ts.isVariableStatement(node)) && isExported(node)) {
      if (ts.isFunctionDeclaration(node) && node.name) {
        const members = functionMemberKinds(node);
        const whole = functionKind(node);
        const set = new Set(members);
        if (whole === 'value') set.add('*');
        if (set.size) exports.set(node.name.text, set);
      } else if (ts.isVariableStatement(node)) {
        for (const decl of node.declarationList.declarations) {
          if (!ts.isIdentifier(decl.name) || !decl.initializer) continue;
          const members = functionMemberKinds(decl.initializer);
          const whole = functionKind(decl.initializer);
          const set = new Set(members);
          if (whole === 'value') set.add('*');
          if (set.size) exports.set(decl.name.text, set);
        }
      }
    }
    ts.forEachChild(node, collectExports);
  };
  collectExports(sf);

  // --- the reads --------------------------------------------------------------
  const reads = [];
  const seen = new Set();
  const collectReads = (node) => {
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const key = readKey(node);
      if (key !== null && kindOf(node.expression) === 'value' && !JS_OBJECT_MEMBERS.has(key)) {
        const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
        const id = `${key}:${line}`;
        if (!seen.has(id)) {
          seen.add(id);
          reads.push({
            file: relative(REPO_ROOT, file.path),
            line: line + 1,
            key,
            text: node.getText(sf).replace(/\s+/g, ' ').slice(0, 100),
          });
        }
      }
    }
    ts.forEachChild(node, collectReads);
  };
  collectReads(sf);

  return { reads, exports };
}

/** The property name a read names, or null when it is computed. */
function readKey(node) {
  if (ts.isPropertyAccessExpression(node)) return node.name.text;
  const arg = node.argumentExpression;
  if (arg && ts.isStringLiteralLike(arg)) return arg.text;
  return null;
}

function isFunctionish(node) {
  return ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isFunctionDeclaration(node);
}

function forEachReturn(fn, fn2) {
  const visit = (node) => {
    if (node !== fn && isFunctionish(node)) return; // a nested function returns for itself
    if (ts.isReturnStatement(node) && node.expression) fn2(node.expression);
    ts.forEachChild(node, visit);
  };
  if (fn.body) visit(fn.body);
}

function isExported(node) {
  return Boolean(node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword));
}

// ---------------------------------------------------------------------------
// The census
// ---------------------------------------------------------------------------

/**
 * Walk every source, to a fixpoint across files.
 *
 * @param {Array<{ path: string, text: string }>} sources
 */
export function censusReads(sources) {
  const helpers = derivePassThroughHelpers(sources);
  const exportTaint = new Map();
  let reads = [];

  for (let round = 0; round < 4; round += 1) {
    reads = [];
    let grew = false;
    for (const file of sources) {
      const result = analyzeFile(file, exportTaint, helpers);
      if (result.reads.length) reads.push(...result.reads);
      for (const [name, members] of result.exports) {
        const prev = exportTaint.get(name);
        if (!prev) {
          exportTaint.set(name, members);
          grew = true;
          continue;
        }
        for (const m of members) {
          if (!prev.has(m)) {
            prev.add(m);
            grew = true;
          }
        }
      }
    }
    if (!grew) break;
  }

  return { reads, helpers, exportTaint, readFiles: new Set(reads.map((r) => r.file)) };
}

/** Group reads by key and attach the schema's verdict. */
export function judgeReads(reads, PageSchema) {
  const byKey = new Map();
  for (const read of reads) {
    if (!byKey.has(read.key)) byKey.set(read.key, []);
    byKey.get(read.key).push(read);
  }
  const rows = [];
  for (const [key, sites] of [...byKey].sort((a, b) => a[0].localeCompare(b[0]))) {
    rows.push({ key, sites, ...askSchema(PageSchema, key) });
  }
  return rows;
}

/**
 * The three controls the card itself printed, re-derived on every run. A census
 * whose oracle has stopped discriminating reports a clean tree.
 */
export function evaluateControls(PageSchema) {
  const base = PageSchema.safeParse({ ...BASE_PAGE });
  const nonsense = askSchema(PageSchema, NONSENSE_KEY);
  return {
    baseGreen: base.success === true,
    nonsenseRefused: nonsense.verdict === 'refused',
    ok: base.success === true && nonsense.verdict === 'refused',
  };
}

async function main() {
  const list = process.argv.includes('--list');
  const { PageSchema } = await import('@objectstack/spec/ui');

  const paths = listPackageSources();
  const sources = paths.map((path) => ({ path, text: readFileSync(path, 'utf8') }));
  const { reads, helpers, readFiles } = censusReads(sources);
  const rows = judgeReads(reads, PageSchema);

  const controls = evaluateControls(PageSchema);
  const declared = Object.keys(PageSchema.shape).sort();

  console.log(`page-key read census -- ${sources.length} source file(s) under packages/*/src`);
  console.log(`  oracle    PageSchema.safeParse (@objectstack/spec/ui), ${declared.length} declared key(s)`);
  console.log(`  seam      ${METADATA_HOOK}().${PAGE_CACHE_MEMBER}  (declared in ${SEAM_DECLARATION})`);
  console.log(`  controls  BASE parses: ${controls.baseGreen} | \`${NONSENSE_KEY}\` refused: ${controls.nonsenseRefused}`);
  console.log(`  helpers   ${helpers.size} generic pass-through signature(s) derived`);
  console.log(`  reads     ${reads.length} page-key read(s) in ${readFiles.size} file(s) reached from the seam`);
  console.log('');

  if (!controls.ok) {
    console.error(
      'x  The ORACLE stopped discriminating: a base page must parse and a nonsense key must be\n' +
        '   refused. Until both hold, every verdict below is meaningless.',
    );
    process.exit(1);
  }

  if (!reads.length) {
    console.error(
      'x  The census found NO page-key reads at all. A tree with no reader of page metadata and a\n' +
        `   census whose seam has moved print the same thing, so this reading is refused rather\n` +
        `   than reported. Check that \`${METADATA_HOOK}()\`'s \`${PAGE_CACHE_MEMBER}\` member is still\n` +
        `   the cache slot the \`page\` metadata type fills (${SEAM_DECLARATION}).`,
    );
    process.exit(1);
  }

  const refused = rows.filter((r) => r.verdict !== 'declared');
  for (const row of rows) {
    if (row.verdict === 'declared' && !list) continue;
    const verdict = row.verdict === 'alias' ? `ALIAS -> \`${row.canonical}\`` : row.verdict.toUpperCase();
    console.log(`  ${row.key}  [${verdict}]`);
    for (const site of row.sites) console.log(`      ${site.file}:${site.line}  ${site.text}`);
  }

  console.log('');
  if (!refused.length) {
    console.log(
      `OK  every one of the ${rows.length} page key(s) read off the metadata cache is one PageSchema accepts.`,
    );
  } else {
    console.log(
      `${refused.length} of ${rows.length} page key(s) read off the metadata cache are keys PageSchema REFUSES.\n` +
        'A page carrying one is a hard parse error, so the read yields `undefined` on every page that\n' +
        'parses: the behaviour behind it is unreachable by any author. Either stop reading the key, or\n' +
        'have it DECLARED on `PageSchema` in @objectstack/spec -- declaring it is a spec change, never a\n' +
        'renderer-side one (AGENTS.md #0.1).',
    );
  }
  console.log('\nThis census is report-only: findings never set the exit code (objectui#9438).');
  process.exit(0);
}

if (isEntrypoint(import.meta.url)) {
  await main();
}
