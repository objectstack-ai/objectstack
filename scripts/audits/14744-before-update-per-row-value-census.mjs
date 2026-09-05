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
 * syntactic one. This pass computes it as taint over a per-function alias
 * lattice: the payload and the pre-image each seed an alias set, the sets grow
 * through local bindings, destructuring and `for…of`, and they PROPAGATE ACROSS
 * CALLS — a helper handed the payload (rather than the context) is analysed
 * with the payload seeded on that parameter. That last part is not a
 * refinement: `sys_stamp_audit_update`, the hook registered on `'*'` in every
 * deployment, writes the payload only through `stampData(hookCtx.input.data,…)`
 * → `applyToRecord(record,…)`, so a classifier that followed only the context
 * scores the single most important handler in the population as "writes
 * nothing". The first revision of this script did exactly that.
 *
 * ⚠️ Deliberately NOT part of (c): a value that varies per row because the
 * handler read a CLOCK inside the dispatch (`sys_stamp_audit_update`'s
 * `updated_at`). Such a value differs per row but is honest whichever row's
 * copy wins, and refusing it is precisely the non-deterministic failure that
 * killed the value-comparison variant twice on #14099. Instrument B separates
 * the two behaviourally by re-running each handler against an IDENTICAL
 * pre-image; this pass separates them by provenance.
 *
 * ## The candidate guard this also scores
 *
 * `guardWouldFire` = writes the payload AND reads the pre-image — the
 * provenance instrument #14744 asks to be measured for over-fire. It is
 * deliberately a WIDER predicate than `taintedWrite`: the gap between the two
 * counts is the guard's false-positive population, which is the answer to
 * deliverable (2).
 *
 * ## Output
 *
 * JSON on stdout: every registration site, its resolved handler, the flags
 * above, and an explicit `resolution` / `delegatesUnresolved` field naming the
 * cases the walk could NOT follow — those are the blind spots the census
 * reports rather than silently scoring as clean.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireDefaultExport } from '../import-prerequisite.mjs';
const ts = await requireDefaultExport('typescript', () => import('typescript'), import.meta.url);
// ⛔ Never `ts.createSourceFile` directly. It does not throw on a source it
// cannot read — the errors are parked on `parseDiagnostics` and the recovered
// tree walks like any other, so a file this census could not parse would be
// scored as a file with NO `beforeUpdate` handlers and quietly lower the
// population. `parseSourceFile` reads those diagnostics and refuses loudly.
// `pnpm check:parse-guard` enforces this; `scripts/ts-parse.mjs` is the
// authority on why.
import { parseSourceFile } from '../ts-parse.mjs';

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

const lineOf = (sf, node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;

/** Strip `!`, `as X`, parens, `await` so pattern matching sees the core expression. */
function unwrap(node) {
  let n = node;
  for (;;) {
    if (ts.isParenthesizedExpression(n) || ts.isAsExpression(n) || ts.isNonNullExpression(n)
        || ts.isAwaitExpression(n) || (ts.isSatisfiesExpression && ts.isSatisfiesExpression(n))) {
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

/** Every function-ish node in a file, keyed by the name it is reachable under. */
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

const emptyResult = () => ({
  writesPayload: false, readsPreImage: false, taintedWrite: false, replacesPayload: false,
  writtenKeys: new Set(), preImageReads: new Set(), payloadWriteSites: [], delegatesUnresolved: [],
});

function merge(into, sub, viaName) {
  into.writesPayload ||= sub.writesPayload;
  into.readsPreImage ||= sub.readsPreImage;
  into.taintedWrite ||= sub.taintedWrite;
  into.replacesPayload ||= sub.replacesPayload;
  for (const k of sub.writtenKeys) into.writtenKeys.add(k);
  for (const k of sub.preImageReads) into.preImageReads.add(k);
  into.payloadWriteSites.push(...sub.payloadWriteSites.map((s) => (viaName ? { ...s, via: viaName } : s)));
  into.delegatesUnresolved.push(...sub.delegatesUnresolved);
}

/**
 * Classify one function against a SEED descriptor saying which of its
 * parameters already carry the payload, the pre-image, or the whole context.
 * `{ ctx: 0 }` is the entry shape for a hook handler.
 */
function classify(fn, sf, byName, seeds, depth = 0, seen = new Set()) {
  const res = emptyResult();
  const params = paramsOf(fn);
  const body = bodyOf(fn);
  if (!params || !body) return res;

  const payloadAliases = new Set();
  const preImageAliases = new Set();
  let ctxName = null;

  const nameAt = (i) => {
    const p = params[i];
    return p && ts.isIdentifier(p.name) ? p.name.text : null;
  };
  if (seeds.ctx != null) {
    ctxName = nameAt(seeds.ctx);
    if (ctxName) {
      payloadAliases.add(`${ctxName}.input.data`);
      payloadAliases.add(`${ctxName}.data`);
      for (const p of PREIMAGE_PROPS) preImageAliases.add(`${ctxName}.${p}`);
      for (const p of PREIMAGE_INPUT_PROPS) preImageAliases.add(`${ctxName}.input.${p}`);
    }
  }
  for (const i of seeds.payload ?? []) { const n = nameAt(i); if (n) payloadAliases.add(n); }
  for (const i of seeds.preImage ?? []) { const n = nameAt(i); if (n) preImageAliases.add(n); }
  if (payloadAliases.size === 0 && preImageAliases.size === 0) return res;

  const underAny = (c, set) => {
    if (c === null) return false;
    if (set.has(c)) return true;
    for (const root of set) if (c === root || c.startsWith(`${root}.`)) return true;
    return false;
  };
  const isPayloadExpr = (e) => { const c = chain(e); return c !== null && payloadAliases.has(c); };
  const isPreImageExpr = (e) => underAny(chain(e), preImageAliases);
  const mentionsPreImage = (e) => {
    let hit = false;
    const v = (n) => {
      if (hit) return;
      if (isPreImageExpr(n)) { hit = true; return; }
      if (ts.isIdentifier(n) && preImageAliases.has(n.text)) { hit = true; return; }
      ts.forEachChild(n, v);
    };
    if (e) v(e);
    return hit;
  };

  // Grow the alias sets to a fixed point (bounded), so a declaration that
  // follows its use — or a chain of them — still lands.
  for (let round = 0; round < 3; round++) {
    const growth = (node) => {
      if (ts.isVariableDeclaration(node) && node.initializer) {
        const init = unwrap(node.initializer);
        if (ts.isIdentifier(node.name)) {
          if (isPayloadExpr(init)) payloadAliases.add(node.name.text);
          if (isPreImageExpr(init) || mentionsPreImage(init)) preImageAliases.add(node.name.text);
        } else if (ts.isObjectBindingPattern(node.name)) {
          const base = chain(init);
          for (const el of node.name.elements) {
            if (!ts.isIdentifier(el.name)) continue;
            const prop = el.propertyName && ts.isIdentifier(el.propertyName) ? el.propertyName.text : el.name.text;
            if (ctxName && base === `${ctxName}.input` && prop === 'data') payloadAliases.add(el.name.text);
            if (ctxName && base === ctxName && PREIMAGE_PROPS.has(prop)) preImageAliases.add(el.name.text);
            if (ctxName && base === `${ctxName}.input` && PREIMAGE_INPUT_PROPS.has(prop)) preImageAliases.add(el.name.text);
            if (underAny(base, preImageAliases)) preImageAliases.add(el.name.text);
          }
        }
      }
      // `for (const row of data)` — iterating a payload yields payload rows.
      if (ts.isForOfStatement(node) && node.initializer && ts.isVariableDeclarationList(node.initializer)) {
        const d = node.initializer.declarations[0];
        if (d && ts.isIdentifier(d.name)) {
          if (isPayloadExpr(node.expression)) payloadAliases.add(d.name.text);
          if (isPreImageExpr(node.expression)) preImageAliases.add(d.name.text);
        }
      }
      ts.forEachChild(node, growth);
    };
    growth(body);
  }

  const record = (node, keyText, valueExpr) => {
    res.writesPayload = true;
    if (keyText) res.writtenKeys.add(keyText);
    const tainted = mentionsPreImage(valueExpr);
    if (tainted) res.taintedWrite = true;
    res.payloadWriteSites.push({
      line: lineOf(sf, node), key: keyText ?? '(computed)', tainted,
      text: node.getText(sf).replace(/\s+/g, ' ').slice(0, 180),
    });
  };

  const visit = (node) => {
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
      } else if (isPayloadExpr(lhs)) {
        res.replacesPayload = true;
        record(node, '(replaced)', node.right);
      }
    }
    if (ts.isDeleteExpression(node)) {
      const t = unwrap(node.expression);
      if (ts.isPropertyAccessExpression(t) && isPayloadExpr(t.expression)) record(node, t.name.text, null);
    }
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
      // Delegation: propagate whichever of payload / pre-image / ctx we hand on.
      if (depth < 5) {
        const fname = ts.isIdentifier(node.expression) ? node.expression.text : null;
        if (fname && !['String', 'Number', 'Boolean', 'Array'].includes(fname)) {
          const sub = { payload: [], preImage: [], ctx: null };
          node.arguments.forEach((a, i) => {
            const u = unwrap(a);
            const c = chain(u);
            if (ctxName && c === ctxName) sub.ctx = i;
            else if (isPayloadExpr(u)) sub.payload.push(i);
            else if (isPreImageExpr(u) || (c !== null && preImageAliases.has(c))) sub.preImage.push(i);
          });
          const hands = sub.ctx != null || sub.payload.length || sub.preImage.length;
          if (hands) {
            const target = byName.get(fname);
            const key = `${fname}|${sub.ctx}|${sub.payload}|${sub.preImage}`;
            if (target && paramsOf(target) && !seen.has(key)) {
              seen.add(key);
              merge(res, classify(target, sf, byName, sub, depth + 1, seen), fname);
            } else if (!target) {
              res.delegatesUnresolved.push({
                callee: fname, line: lineOf(sf, node),
                hands: { ctx: sub.ctx != null, payload: sub.payload.length > 0, preImage: sub.preImage.length > 0 },
              });
            }
          }
        }
      }
    }
    if (isPreImageExpr(node)) { res.readsPreImage = true; const c = chain(node); if (c) res.preImageReads.add(c); }
    if (ts.isIdentifier(node) && preImageAliases.has(node.text)) { res.readsPreImage = true; res.preImageReads.add(node.text); }
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
    const name = ts.isIdentifier(a.expression) ? a.expression.text : chain(a.expression);
    const factory = name ? byName.get(String(name).split('.').pop()) : null;
    if (factory) {
      const b = bodyOf(factory);
      if (b) {
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

/** Analyse one already-parsed source file, appending every registration site found. */
function analyzeSource(sf, rel, isTest, sites) {
  const byName = indexFunctions(sf);

  const emit = (node, door, fnNode, how, hookName) => {
    const cls = fnNode ? classify(fnNode, sf, byName, { ctx: 0 }) : null;
    sites.push({
      file: rel, line: lineOf(sf, node), door, isTest, hookName, resolution: how,
      ...(cls ? {
        writesPayload: cls.writesPayload, readsPreImage: cls.readsPreImage,
        taintedWrite: cls.taintedWrite, replacesPayload: cls.replacesPayload,
        guardWouldFire: cls.writesPayload && cls.readsPreImage,
        writtenKeys: [...cls.writtenKeys], preImageReads: [...cls.preImageReads],
        payloadWriteSites: cls.payloadWriteSites, delegatesUnresolved: cls.delegatesUnresolved,
      } : { unclassified: true }),
    });
  };

  const visit = (node) => {
    if (ts.isCallExpression(node)) {
      const callee = ts.isPropertyAccessExpression(node.expression) ? node.expression.name.text
        : ts.isIdentifier(node.expression) ? node.expression.text : null;
      if (callee === 'registerHook' || callee === 'on') {
        const evIdx = node.arguments.findIndex((a) => {
          const u = unwrap(a);
          return ts.isStringLiteral(u) && u.text === EVENT;
        });
        if (evIdx >= 0 && node.arguments.length > evIdx + 1) {
          const r = resolveHandler(node.arguments[evIdx + 1], sf, byName);
          emit(node, `${callee}()`, r.fn, r.how, undefined);
        }
      }
    }
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
          const nameProp = props.get('name');
          const hookName = nameProp && ts.isPropertyAssignment(nameProp) && ts.isStringLiteral(unwrap(nameProp.initializer))
            ? unwrap(nameProp.initializer).text : undefined;
          emit(node, 'events[] literal', fnNode, how, hookName);
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return sites;
}

function analyzeText(text, name = 'fixture.ts') {
  const sf = parseSourceFile(name, text);
  return analyzeSource(sf, name, false, []);
}

/**
 * ⭐ The firing positive control this census's headline ZERO is worthless
 * without, plus the negative controls that keep the predicate from being
 * trivially true. Every fixture below is a shape the census claims to
 * DISTINGUISH, so a change that collapses two of them reddens here rather than
 * silently re-scoring the tree.
 */
const SELF_TEST_CASES = [
  {
    name: 'POSITIVE — the card\'s own pinned residue (value from ctx.previous)',
    expect: { writesPayload: true, readsPreImage: true, taintedWrite: true },
    src: `engine.registerHook('beforeUpdate', (ctx) => {
      const prev = ctx.previous;
      ctx.input.data.priority = prev.status === 'blocked' ? 'high' : 'low';
    });`,
  },
  {
    name: 'POSITIVE — value derived from the per-row id',
    expect: { writesPayload: true, readsPreImage: true, taintedWrite: true },
    src: `engine.registerHook('beforeUpdate', (ctx) => {
      ctx.input.data.slug = String(ctx.input.id) + '-x';
    });`,
  },
  {
    name: 'POSITIVE — taint carried through a local binding',
    expect: { writesPayload: true, readsPreImage: true, taintedWrite: true },
    src: `engine.registerHook('beforeUpdate', (ctx) => {
      const prev = ctx.previous;
      const bumped = (prev.count ?? 0) + 1;
      const data = ctx.input.data;
      data.count = bumped;
    });`,
  },
  {
    name: 'POSITIVE — taint across a helper handed payload AND pre-image',
    expect: { writesPayload: true, readsPreImage: true, taintedWrite: true },
    src: `function apply(record, prior) { record.rank = prior.rank + 1; }
    engine.registerHook('beforeUpdate', (ctx) => { apply(ctx.input.data, ctx.previous); });`,
  },
  {
    name: 'POSITIVE — Hook metadata literal door, not registerHook()',
    expect: { writesPayload: true, readsPreImage: true, taintedWrite: true },
    src: `const h = { name: 'x', object: 'task', events: ['beforeUpdate'],
      handler: (ctx) => { ctx.input.data.tier = ctx.previous.tier; } };`,
  },
  {
    name: 'NEGATIVE — audit-stamp shape: writes via a payload-passing helper, clock value, no pre-image read',
    expect: { writesPayload: true, readsPreImage: false, taintedWrite: false },
    src: `function applyToRecord(record) { record.updated_at = new Date().toISOString(); }
    function stampData(data) { applyToRecord(data); }
    engine.registerHook('beforeUpdate', (ctx) => { stampData(ctx.input.data); });`,
  },
  {
    name: 'NEGATIVE — CONSTANT value gated on a pre-image read (the guard\'s over-fire shape)',
    expect: { writesPayload: true, readsPreImage: true, taintedWrite: false },
    src: `engine.registerHook('beforeUpdate', (ctx) => {
      if (ctx.previous.managed_by === 'package') ctx.input.data.customized = true;
    });`,
  },
  {
    name: 'NEGATIVE — reads the pre-image but never writes the payload (a pure guard)',
    expect: { writesPayload: false, readsPreImage: true, taintedWrite: false },
    src: `engine.registerHook('beforeUpdate', (ctx) => {
      if (ctx.previous.locked) throw new Error('locked');
    });`,
  },
  {
    name: 'NEGATIVE — writes a value derived only from the PAYLOAD (row-invariant)',
    expect: { writesPayload: true, readsPreImage: false, taintedWrite: false },
    src: `engine.registerHook('beforeUpdate', (ctx) => {
      ctx.input.data.name_lower = String(ctx.input.data.name).toLowerCase();
    });`,
  },
  {
    name: 'CONTROL — a beforeInsert registration must not be counted at all',
    expect: null,
    src: `engine.registerHook('beforeInsert', (ctx) => { ctx.input.data.x = ctx.previous.y; });`,
  },
];

function runSelfTest() {
  let failures = 0;
  for (const c of SELF_TEST_CASES) {
    const found = analyzeText(c.src, `${c.name}.ts`);
    if (c.expect === null) {
      const ok = found.length === 0;
      if (!ok) failures++;
      console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.name}  (sites=${found.length}, expected 0)`);
      continue;
    }
    if (found.length !== 1) {
      failures++;
      console.log(`FAIL  ${c.name}  (expected exactly 1 site, got ${found.length})`);
      continue;
    }
    const s = found[0];
    const bad = Object.entries(c.expect).filter(([k, v]) => s[k] !== v);
    if (bad.length) failures++;
    console.log(`${bad.length ? 'FAIL' : 'PASS'}  ${c.name}`
      + (bad.length ? `  → ${bad.map(([k, v]) => `${k}: expected ${v}, got ${s[k]}`).join('; ')}` : ''));
  }
  console.log(`\n${failures === 0 ? 'SELF-TEST PASSED' : 'SELF-TEST FAILED'} — ${SELF_TEST_CASES.length - failures}/${SELF_TEST_CASES.length} cases`);
  return failures;
}

if (process.argv.includes('--self-test')) {
  process.exit(runSelfTest() === 0 ? 0 : 1);
}

const sites = [];
for (const root of ROOTS) {
  for (const file of walkFiles(join(REPO, root), [])) {
    const rel = relative(REPO, file);
    let text;
    try { text = readFileSync(file, 'utf8'); } catch { continue; }
    if (!text.includes(EVENT)) continue;
    const sf = parseSourceFile(file, text);
    analyzeSource(sf, rel, /\.(test|spec)\.ts$/.test(file), sites);
  }
}

/**
 * What this instrument CANNOT see, enumerated rather than assumed away. A
 * census that reports a population without bounding its own blind spots is a
 * hypothesis wearing a number.
 *
 *  - `nonLiteralEventArg` — a `registerHook(<expr>, …)` whose event argument is
 *    not a plain string literal. The walker keys on the literal, so any such
 *    site is invisible to the population count and has to be read by hand.
 *  - `nonTsFilesMentioningBeforeUpdate` — hooks can also arrive as METADATA
 *    (a stored `sys_metadata` row, a JSON/YAML object definition) and be bound
 *    by `bindHooksToEngine` at boot. Nothing in a TS syntax tree sees those.
 *  - `tsFilesOutsideScannedRoots` — anything under a root this walk never
 *    entered.
 */
function collectBlindSpots() {
  const nonLiteral = [];
  for (const root of ROOTS) {
    for (const file of walkFiles(join(REPO, root), [])) {
      let text;
      try { text = readFileSync(file, 'utf8'); } catch { continue; }
      if (!text.includes('registerHook')) continue;
      const sf = parseSourceFile(file, text);
      const v = (n) => {
        if (ts.isCallExpression(n)) {
          const c = ts.isPropertyAccessExpression(n.expression) ? n.expression.name.text
            : ts.isIdentifier(n.expression) ? n.expression.text : null;
          if (c === 'registerHook' && n.arguments.length > 0 && !ts.isStringLiteral(unwrap(n.arguments[0]))) {
            nonLiteral.push({
              file: relative(REPO, file), line: lineOf(sf, n),
              arg: n.arguments[0].getText(sf).replace(/\s+/g, ' ').slice(0, 60),
              isTest: /\.(test|spec)\.ts$/.test(file),
            });
          }
        }
        ts.forEachChild(n, v);
      };
      v(sf);
    }
  }
  const nonTs = [];
  const outside = [];
  const scanAll = (dir) => {
    let entries;
    try { entries = readdirSync(dir); } catch { return; }
    for (const name of entries) {
      if (SKIP_DIR.has(name) || name === '.git') continue;
      const full = join(dir, name);
      let st;
      try { st = statSync(full); } catch { continue; }
      if (st.isDirectory()) { scanAll(full); continue; }
      const rel = relative(REPO, full);
      const isData = /\.(json|ya?ml|[cm]?js)$/.test(name);
      const isTs = name.endsWith('.ts') && !name.endsWith('.d.ts');
      if (!isData && !isTs) continue;
      let text;
      try { text = readFileSync(full, 'utf8'); } catch { continue; }
      if (!text.includes(EVENT)) continue;
      if (isData) nonTs.push(rel);
      else if (!ROOTS.some((r) => rel.startsWith(`${r}/`))) outside.push(rel);
    }
  };
  scanAll(REPO);
  return {
    nonLiteralEventArg: {
      production: nonLiteral.filter((x) => !x.isTest),
      testCount: nonLiteral.filter((x) => x.isTest).length,
    },
    nonTsFilesMentioningBeforeUpdate: nonTs,
    tsFilesOutsideScannedRoots: outside,
  };
}

const prod = sites.filter((s) => !s.isTest);
const blindSpots = collectBlindSpots();
const summary = {
  base: process.env.CENSUS_BASE ?? null,
  totalSites: sites.length,
  productionSites: prod.length,
  testSites: sites.length - prod.length,
  production: {
    writesPayload: prod.filter((s) => s.writesPayload).length,
    readsPreImage: prod.filter((s) => s.readsPreImage).length,
    guardWouldFire: prod.filter((s) => s.guardWouldFire).length,
    taintedWrite_INSTANCE_CANDIDATE: prod.filter((s) => s.taintedWrite).length,
    unclassified: prod.filter((s) => s.unclassified).length,
    replacesPayload: prod.filter((s) => s.replacesPayload).length,
    withUnresolvedDelegation: prod.filter((s) => (s.delegatesUnresolved ?? []).length > 0).length,
  },
};
process.stdout.write(JSON.stringify({ summary, blindSpots, sites }, null, 2));
