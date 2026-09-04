// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#14744] Census instrument A — STATIC enumeration + classification of every
 * in-repo `beforeUpdate` handler, for the residue #14099's key-set refusal
 * deliberately leaves open: a handler that writes the SAME key on every row
 * with a PER-ROW VALUE.
 *
 * ## Why an AST walk rather than grep
 *
 * The registration spelling varies far more than a line-oriented pattern can
 * follow. Measured on `origin/main` 4dd5041bd: a single-line
 * `git grep "registerHook('beforeUpdate'"` finds 14 call sites, while 46
 * further `registerHook(` sites are multi-line, take the event through a
 * variable, or are interface declarations. A grep census would therefore have
 * under-counted the population by construction and reported a confident number.
 * This walks the syntax tree, so the argument's POSITION is what is read, not
 * its position on a line.
 *
 * ## The predicate this implements, stated so it can be argued with
 *
 * An INSTANCE is a `beforeUpdate` handler for which, on one `multi: true`
 * update matching two or more rows:
 *
 *   (a) the handler writes the payload (`ctx.input.data`), and
 *   (b) the SET of keys it writes is the same for every row — otherwise
 *       #14099's refusal already catches it and it is not this residue, and
 *   (c) the VALUE it writes for at least one of those keys is derived from
 *       PER-ROW state — `ctx.previous`, `ctx.input.id`, or anything carried
 *       from them.
 *
 * (c) is the discriminating clause and it is a DATAFLOW property, not a
 * syntactic one. This pass computes it as taint: the handler's ctx parameter
 * seeds two alias sets — payload roots and pre-image roots — which are grown
 * through local `const`/`let` bindings and destructuring, and a payload write
 * is tainted when its VALUE expression mentions anything in the pre-image set.
 *
 * ⚠️ Deliberately NOT part of (c): a value that varies per row because the
 * handler read a CLOCK inside the dispatch (`sys_stamp_audit_update`'s
 * `updated_at`). Such a value differs per row but is honest whichever row's
 * copy wins, and refusing it is precisely the non-deterministic failure that
 * killed the value-comparison variant twice on #14099. Instrument B separates
 * the two behaviourally by re-running each handler against an IDENTICAL
 * pre-image; this pass separates them by provenance.
 *
 * ## Output
 *
 * JSON on stdout: every registration site, its resolved handler, the flags
 * above, and an explicit `resolution` field naming the cases the walk could
 * NOT follow — those are the blind spots the census reports rather than
 * silently scores as clean.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const REPO = join(HERE, '..', '..');

const ROOTS = ['packages', 'examples', 'apps'];
const SKIP_DIR = new Set(['node_modules', 'dist', '.turbo', 'build', 'coverage', '.next', '.cache']);
const EVENT = 'beforeUpdate';

/** Property names that, read off the hook context, are PER-ROW state. */
const PREIMAGE_PROPS = new Set(['previous', 'previousRecord', 'record', 'existing', 'oldRecord']);
/** `ctx.input.<X>` reads that are per-row under per-row dispatch. */
const PREIMAGE_INPUT_PROPS = new Set(['id', 'ids']);

function walkFiles(dir, out) {
  let entries;
  try { entries = readdirSync(dir); } catch { return out; }
  for (const name of entries) {
    if (SKIP_DIR.has(name)) continue;
    const full = join(dir, name);
    let st;
    try { st = statSync(full); } catch { continue; }
    if (st.isDirectory()) walkFiles(full, out);
    else if (name.endsWith('.ts') && !name.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

const isTestFile = (p) => /\.(test|spec)\.[cm]?ts$/.test(p) || `${sep}test${sep}` === p.slice(-6) ;

function parse(file) {
  const text = readFileSync(file, 'utf8');
  return { text, sf: ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS) };
}

const lineOf = (sf, node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;

/** Strip `!`, `as X`, parens, `await` so pattern matching sees the core expression. */
function unwrap(node) {
  let n = node;
  for (;;) {
    if (ts.isParenthesizedExpression(n) || ts.isAsExpression(n) || ts.isNonNullExpression(n)
        || ts.isTypeAssertionExpression?.(n) || ts.isAwaitExpression(n) || ts.isSatisfiesExpression?.(n)) {
      n = n.expression;
    } else break;
  }
  return n;
}

/** Text of a property-access chain, `a.b.c`, ignoring optional-chaining tokens. */
function chain(node) {
  const n = unwrap(node);
  if (ts.isIdentifier(n)) return n.text;
  if (ts.isPropertyAccessExpression(n)) {
    const base = chain(n.expression);
    return base === null ? null : `${base}.${n.name.text}`;
  }
  return null;
}

/**
 * Collect every function-ish node in a source file keyed by the name it is
 * reachable under, so a handler passed as a bare identifier can be resolved.
 */
function indexFunctions(sf) {
  const byName = new Map();
  const visit = (node) => {
    if (ts.isFunctionDeclaration(node) && node.name) byName.set(node.name.text, node);
    if (ts.isVariableDeclaration(node) && node.name && ts.isIdentifier(node.name) && node.initializer) {
      byName.set(node.name.text, unwrap(node.initializer));
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return byName;
}

/** The parameter list of a function-ish node, or null. */
function paramsOf(node) {
  if (!node) return null;
  if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node)
      || ts.isMethodDeclaration(node)) return node.parameters;
  return null;
}

function bodyOf(node) {
  if (!node) return null;
  if (ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isMethodDeclaration(node)) return node.body ?? null;
  if (ts.isArrowFunction(node)) return node.body ?? null;
  return null;
}

/**
 * Classify one handler function: does it write the payload, does it read
 * per-row state, and is any written VALUE derived from that state.
 *
 * `ctxNames` seeds the alias sets from the parameter the hook context arrives
 * on. The walk follows same-file callees (bounded depth) so a handler whose
 * body is `(ctx) => doTheWork(engine, ctx)` is classified by `doTheWork`.
 */
function classify(fn, sf, byName, depth = 0, seedCtxIndex = 0, seen = new Set()) {
  const res = {
    writesPayload: false, readsPreImage: false, taintedWrite: false,
    writtenKeys: new Set(), preImageReads: new Set(), payloadWriteSites: [],
    delegatesUnresolved: [], replacesPayload: false,
  };
  const params = paramsOf(fn);
  const body = bodyOf(fn);
  if (!params || !body) return res;
  const ctxParam = params[seedCtxIndex];
  if (!ctxParam || !ts.isIdentifier(ctxParam.name)) return res;
  const ctxName = ctxParam.name.text;

  // Alias sets, seeded from the ctx parameter and grown through local bindings.
  const payloadAliases = new Set([`${ctxName}.input.data`, `${ctxName}.data`]);
  const preImageAliases = new Set();
  for (const p of PREIMAGE_PROPS) preImageAliases.add(`${ctxName}.${p}`);
  for (const p of PREIMAGE_INPUT_PROPS) preImageAliases.add(`${ctxName}.input.${p}`);

  const isPayloadExpr = (e) => { const c = chain(e); return c !== null && payloadAliases.has(c); };
  const isPreImageExpr = (e) => {
    const c = chain(e);
    if (c === null) return false;
    if (preImageAliases.has(c)) return true;
    // `ctx.previous.status` — any read UNDER a pre-image root counts.
    for (const root of preImageAliases) if (c === root || c.startsWith(`${root}.`)) return true;
    return false;
  };
  /** Does an expression subtree mention anything pre-image-derived? */
  const mentionsPreImage = (e) => {
    let hit = false;
    const v = (n) => {
      if (hit) return;
      if (isPreImageExpr(n)) { hit = true; return; }
      if (ts.isIdentifier(n) && preImageAliases.has(n.text)) { hit = true; return; }
      ts.forEachChild(n, v);
    };
    v(e);
    return hit;
  };

  // Two passes: grow aliases first (declarations can follow uses in hoisted
  // functions), then read writes against the settled sets.
  for (let round = 0; round < 2; round++) {
    const growth = (node) => {
      if (ts.isVariableDeclaration(node) && node.initializer) {
        const init = unwrap(node.initializer);
        if (ts.isIdentifier(node.name)) {
          if (isPayloadExpr(init)) payloadAliases.add(node.name.text);
          if (isPreImageExpr(init) || mentionsPreImage(init)) preImageAliases.add(node.name.text);
        } else if (ts.isObjectBindingPattern(node.name)) {
          // `const { data } = ctx.input` / `const { previous } = ctx`
          const base = chain(init);
          for (const el of node.name.elements) {
            if (!ts.isIdentifier(el.name)) continue;
            const prop = el.propertyName && ts.isIdentifier(el.propertyName) ? el.propertyName.text : el.name.text;
            if (base === `${ctxName}.input` && prop === 'data') payloadAliases.add(el.name.text);
            if (base === ctxName && PREIMAGE_PROPS.has(prop)) preImageAliases.add(el.name.text);
            if (base === `${ctxName}.input` && PREIMAGE_INPUT_PROPS.has(prop)) preImageAliases.add(el.name.text);
            if (base !== null && preImageAliases.has(base)) preImageAliases.add(el.name.text);
          }
        }
      }
      ts.forEachChild(node, growth);
    };
    growth(body);
  }

  const record = (node, keyText, valueExpr) => {
    res.writesPayload = true;
    if (keyText) res.writtenKeys.add(keyText);
    const tainted = valueExpr ? mentionsPreImage(valueExpr) : false;
    if (tainted) res.taintedWrite = true;
    res.payloadWriteSites.push({
      line: lineOf(sf, node), key: keyText ?? '(computed)', tainted,
      text: node.getText(sf).replace(/\s+/g, ' ').slice(0, 200),
    });
  };

  const visit = (node) => {
    // `payload.k = v`, `payload['k'] = v`, compound assignments
    if (ts.isBinaryExpression(node)
        && (node.operatorToken.kind === ts.SyntaxKind.EqualsToken
            || node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionEqualsToken
            || node.operatorToken.kind === ts.SyntaxKind.BarBarEqualsToken)) {
      const lhs = unwrap(node.left);
      if (ts.isPropertyAccessExpression(lhs) && isPayloadExpr(lhs.expression)) {
        record(node, lhs.name.text, node.right);
      } else if (ts.isElementAccessExpression(lhs) && isPayloadExpr(lhs.expression)) {
        const arg = unwrap(lhs.argumentExpression);
        record(node, ts.isStringLiteral(arg) ? arg.text : null, node.right);
        // A computed key whose INDEX is per-row is itself divergence, not this residue.
      } else if (isPayloadExpr(lhs)) {
        // `ctx.input.data = {...}` — wholesale replacement.
        res.replacesPayload = true;
        record(node, '(replaced)', node.right);
      }
    }
    // `Object.assign(payload, {...})`
    if (ts.isCallExpression(node)) {
      const callee = chain(node.expression);
      if (callee === 'Object.assign' && node.arguments.length > 1 && isPayloadExpr(node.arguments[0])) {
        for (let i = 1; i < node.arguments.length; i++) {
          const src = unwrap(node.arguments[i]);
          if (ts.isObjectLiteralExpression(src)) {
            for (const p of src.properties) {
              if (ts.isPropertyAssignment(p) && ts.isIdentifier(p.name)) record(node, p.name.text, p.initializer);
              else record(node, null, src);
            }
          } else record(node, null, src);
        }
      }
      // Same-file delegation: follow the callee, mapping our ctx to its param.
      if (depth < 3) {
        const name = ts.isIdentifier(node.expression) ? node.expression.text
          : ts.isPropertyAccessExpression(node.expression) ? null : null;
        const passesCtxAt = node.arguments.findIndex((a) => {
          const c = chain(a);
          return c === ctxName;
        });
        if (name && passesCtxAt >= 0) {
          const target = byName.get(name);
          const key = `${name}#${passesCtxAt}`;
          if (target && !seen.has(key)) {
            seen.add(key);
            const sub = classify(target, sf, byName, depth + 1, passesCtxAt, seen);
            res.writesPayload ||= sub.writesPayload;
            res.readsPreImage ||= sub.readsPreImage;
            res.taintedWrite ||= sub.taintedWrite;
            res.replacesPayload ||= sub.replacesPayload;
            for (const k of sub.writtenKeys) res.writtenKeys.add(k);
            for (const k of sub.preImageReads) res.preImageReads.add(k);
            res.payloadWriteSites.push(...sub.payloadWriteSites.map((s) => ({ ...s, via: name })));
            res.delegatesUnresolved.push(...sub.delegatesUnresolved);
          } else if (!target) {
            res.delegatesUnresolved.push({ callee: name, line: lineOf(sf, node) });
          }
        }
      }
    }
    // `delete payload.k`
    if (ts.isDeleteExpression(node)) {
      const t = unwrap(node.expression);
      if (ts.isPropertyAccessExpression(t) && isPayloadExpr(t.expression)) record(node, t.name.text, null);
    }
    if (isPreImageExpr(node)) { res.readsPreImage = true; const c = chain(node); if (c) res.preImageReads.add(c); }
    if (ts.isIdentifier(node) && preImageAliases.has(node.text) && node.text !== ctxName) {
      res.readsPreImage = true; res.preImageReads.add(node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(body);
  return res;
}

/** Resolve a handler ARGUMENT expression to a function node we can classify. */
function resolveHandler(arg, sf, byName) {
  const a = unwrap(arg);
  if (ts.isArrowFunction(a) || ts.isFunctionExpression(a)) return { fn: a, how: 'inline' };
  if (ts.isIdentifier(a)) {
    const t = byName.get(a.text);
    if (t && paramsOf(t)) return { fn: t, how: `identifier:${a.text}` };
    return { fn: null, how: `unresolved-identifier:${a.text}` };
  }
  if (ts.isCallExpression(a)) {
    // `makeGuard(false)` / `canonicalize('update')` — a factory returning the handler.
    const name = ts.isIdentifier(a.expression) ? a.expression.text : chain(a.expression);
    const factory = name ? byName.get(name.split('.').pop()) : null;
    if (factory) {
      const b = bodyOf(factory);
      if (b) {
        // Return the first function-ish expression the factory yields.
        let found = null;
        const v = (n) => {
          if (found) return;
          if (ts.isArrowFunction(n) || ts.isFunctionExpression(n)) { found = n; return; }
          ts.forEachChild(n, v);
        };
        v(b);
        if (found) return { fn: found, how: `factory:${name}` };
      }
    }
    return { fn: null, how: `unresolved-factory:${name ?? '?'}` };
  }
  if (ts.isPropertyAccessExpression(a)) return { fn: null, how: `unresolved-member:${chain(a) ?? '?'}` };
  return { fn: null, how: `unresolved:${ts.SyntaxKind[a.kind]}` };
}

const sites = [];

for (const root of ROOTS) {
  for (const file of walkFiles(join(REPO, root), [])) {
    const rel = relative(REPO, file);
    const isTest = /\.(test|spec)\.ts$/.test(file);
    let parsed;
    try { parsed = parse(file); } catch { continue; }
    const { sf, text } = parsed;
    if (!text.includes(EVENT)) continue;
    const byName = indexFunctions(sf);

    const visit = (node) => {
      // Door 1 + 2: `registerHook('beforeUpdate', handler, opts)` and `on('beforeUpdate', ...)`.
      if (ts.isCallExpression(node)) {
        const callee = ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text
          : ts.isIdentifier(node.expression) ? node.expression.text : null;
        if (callee === 'registerHook' || callee === 'on') {
          const evIdx = node.arguments.findIndex((a) => {
            const u = unwrap(a);
            return ts.isStringLiteral(u) && u.text === EVENT;
          });
          if (evIdx >= 0 && node.arguments.length > evIdx + 1) {
            const handlerArg = node.arguments[evIdx + 1];
            const r = resolveHandler(handlerArg, sf, byName);
            const cls = r.fn ? classify(r.fn, sf, byName) : null;
            sites.push({
              file: rel, line: lineOf(sf, node), door: `${callee}()`, isTest,
              resolution: r.how,
              ...(cls ? {
                writesPayload: cls.writesPayload, readsPreImage: cls.readsPreImage,
                taintedWrite: cls.taintedWrite, replacesPayload: cls.replacesPayload,
                writtenKeys: [...cls.writtenKeys], preImageReads: [...cls.preImageReads],
                payloadWriteSites: cls.payloadWriteSites,
                delegatesUnresolved: cls.delegatesUnresolved,
              } : { unclassified: true }),
            });
          }
        }
      }
      // Door 3: a Hook-shaped object literal — `{ events: ['beforeUpdate'], handler }`.
      if (ts.isObjectLiteralExpression(node)) {
        const props = new Map();
        for (const p of node.properties) {
          if ((ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p) || ts.isMethodDeclaration(p))
              && p.name && ts.isIdentifier(p.name)) props.set(p.name.text, p);
        }
        const ev = props.get('events');
        if (ev && ts.isPropertyAssignment(ev)) {
          const arr = unwrap(ev.initializer);
          const hasEvent = ts.isArrayLiteralExpression(arr)
            && arr.elements.some((e) => { const u = unwrap(e); return ts.isStringLiteral(u) && u.text === EVENT; });
          const h = props.get('handler');
          if (hasEvent && h) {
            let fnNode = null, how = 'inline';
            if (ts.isPropertyAssignment(h)) { const r = resolveHandler(h.initializer, sf, byName); fnNode = r.fn; how = r.how; }
            else if (ts.isMethodDeclaration(h)) { fnNode = h; how = 'method'; }
            else if (ts.isShorthandPropertyAssignment(h)) {
              const t = byName.get(h.name.text); fnNode = t && paramsOf(t) ? t : null;
              how = fnNode ? `identifier:${h.name.text}` : `unresolved-identifier:${h.name.text}`;
            }
            const cls = fnNode ? classify(fnNode, sf, byName) : null;
            const nameProp = props.get('name');
            sites.push({
              file: rel, line: lineOf(sf, node), door: 'events[] literal', isTest,
              hookName: nameProp && ts.isPropertyAssignment(nameProp) && ts.isStringLiteral(unwrap(nameProp.initializer))
                ? unwrap(nameProp.initializer).text : undefined,
              resolution: how,
              ...(cls ? {
                writesPayload: cls.writesPayload, readsPreImage: cls.readsPreImage,
                taintedWrite: cls.taintedWrite, replacesPayload: cls.replacesPayload,
                writtenKeys: [...cls.writtenKeys], preImageReads: [...cls.preImageReads],
                payloadWriteSites: cls.payloadWriteSites,
                delegatesUnresolved: cls.delegatesUnresolved,
              } : { unclassified: true }),
            });
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
}

const prod = sites.filter((s) => !s.isTest);
const summary = {
  base: process.env.CENSUS_BASE ?? null,
  totalSites: sites.length,
  productionSites: prod.length,
  testSites: sites.length - prod.length,
  production: {
    writesPayload: prod.filter((s) => s.writesPayload).length,
    readsPreImage: prod.filter((s) => s.readsPreImage).length,
    guardWouldFire: prod.filter((s) => s.writesPayload && s.readsPreImage).length,
    taintedWrite_INSTANCE_CANDIDATE: prod.filter((s) => s.taintedWrite).length,
    unclassified: prod.filter((s) => s.unclassified).length,
    replacesPayload: prod.filter((s) => s.replacesPayload).length,
  },
};
process.stdout.write(JSON.stringify({ summary, sites }, null, 2));
