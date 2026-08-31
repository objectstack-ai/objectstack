#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * tenant-audit-census -- the committed enumeration of every APPLICATION-SURFACE
 * write call site against a tenancy-enabled object.
 *
 *   node scripts/tenant-audit-census.mjs            # human summary
 *   node scripts/tenant-audit-census.mjs --json     # the whole census, machine-readable
 *
 * `content/docs/permissions/tenant-audit-census.mdx` is the page this builds.
 * `check-tenant-audit-census.mjs` is the gate that holds the page to what this
 * reports. Together they are the `isSystem` census triple's shape applied to the
 * tenant-audit control (`SqlDriver.auditMissingTenant`).
 *
 * ## ⭐ Why this exists AS AN ARTEFACT, which is the whole point
 *
 * The measurement this replaces lived in a COMMENT on issue #13178. That issue
 * became unreachable -- it 404s on unauthenticated REST, on the rendered page and
 * on authenticated MCP alike, while its neighbours answer 200 -- and took the
 * census with it. Three open cards named it as their input. What survived did so
 * by luck: a changeset author had quoted two of the figures in prose
 * (`.changeset/tenant-audit-update-delete-half-repairs.md`), so "175 write call
 * sites, 24 of them carrying no tenant context" is still readable on `main` while
 * the list of 24 is not recoverable at all.
 *
 * ⇒ A census that decides a repair family's severity and a ruling's scope is not
 *   a comment. It is a re-runnable instrument plus a committed page, so that
 *   losing any issue costs nothing, and so the population can be RE-DERIVED
 *   rather than quoted.
 *
 * ## What the tenant-audit control actually is
 *
 * `SqlDriver.auditMissingTenant(object, op, options)` warns when a write targets
 * a tenancy-enabled object without `options.tenantId`. It is gated, in order, by
 * `OS_TENANT_AUDIT=0`, then `options.bypassTenantAudit`, then a present
 * `tenantId`, then the deployment posture, then the object having a tenant field.
 *
 * The engine sets `bypassTenantAudit` for every `ExecutionContext.isSystem` write
 * (ObjectQL's `buildDriverOptions`), and `options.tenantId` from
 * `execCtx.tenantId`. So what a CALL SITE controls is one thing: whether it
 * threads an execution context at all. That is what this census measures.
 *
 * ## The population, and the two ways a count goes wrong
 *
 * A site is a call to one of the three `IDataEngine` write doors -- `insert`,
 * `update`, `delete` -- on a receiver whose declared type is an engine, in
 * tracked non-test sources under `packages/services/` and `packages/plugins/`.
 *
 * ⛔ The identifier is not the signal. `.delete()` alone answers ~250 sites in
 * this corpus, and the overwhelming majority of them are `Map.delete`,
 * `Set.delete`, `Headers.delete`, a crypto `Hash.update`, an HTTP route
 * registration, a blob-storage delete-by-key, and a search-index de-index. A
 * census keyed on the verb name over-reports by more than it reports.
 *
 * So the receiver is TYPED, structurally: a corpus-declared interface or type
 * literal counts as an engine when it declares `insert` / `update` / `delete`
 * with a first parameter named `object` / `objectName` / `objectApiName` /
 * `name` and typed `string` -- the `IDataEngine` door signature. Interfaces that
 * EXTEND one (`IObjectQLEngine extends IDataEngine`) inherit it, and aliases that
 * NARROW one (`Partial<Pick<IDataEngine, 'insert' | …>>`) carry it. That found 56
 * engine-shaped types where a name list would have found the handful someone
 * remembered.
 *
 * ⭐ The second failure direction is the expensive one, and it is a KEYWORD.
 * Sites whose receiver the author typed `any` -- `ql: any`, `engine: any`,
 * `(engine as any)` -- have no type to read. There are 45 of them, better than a
 * fifth of the population, and they are concentrated in exactly the seed and
 * bootstrap paths this control exists for. Scoring an unreadable receiver as
 * "not an engine" would have dropped every one of them silently, with a clean
 * exit and a smaller number that reads exactly like a smaller truth.
 *
 * ⇒ `any` is NOT a classification here. It goes to the unreadable pile, and the
 *   unreadable pile is placed by facts about the tree rather than about the
 *   receiver:
 *
 *   1. the first argument is a string that NAMES A DECLARED OBJECT, or
 *   2. the first argument is a parameter declared `object: string` -- the same
 *      door signature the type index keys on, read at the argument instead of
 *      at the receiver, or
 *   3. an `UNTYPED_RECEIVERS` row says what the receiver is.
 *
 * An unreadable receiver that none of the three place is an ERROR, never a
 * default. That is the direction this census cannot survive being wrong in.
 *
 * ## Tenancy is enabled BY DEFAULT, so the registry only finds the opt-outs
 *
 * `isTenancyDisabled()` reads `tenancy.enabled === false` and nothing else, so an
 * object is tenancy-enabled unless it says otherwise. {@link declaredObjects}
 * walks every `*.object.ts` in the tree: 297 objects, of which exactly two
 * (`sys_api_key`, `sys_sso_provider`) opt out.
 *
 * ## What is DECIDABLE, and why that is reported rather than smoothed over
 *
 * A site whose object name is an inline literal or a local `const` string is
 * statically decidable. A site whose name is a parameter or a field
 * (`objectName`, `this.objectName`) is not, and no amount of AST work makes it
 * so -- the object is chosen at run time. Those are reported as `undecidable`
 * rather than assumed either way, because a census that quietly guesses on 30%
 * of its own population is the "73% coverage that reads like full coverage"
 * failure the class-level control was warned about.
 *
 * ## Refusals, never quiet passes (#4690)
 *
 * A corpus of zero sources, an object registry of zero declarations, a source
 * that cannot be read, a source that does not parse (`ts-parse.mjs` refuses), an
 * unreadable receiver with no placement, and a ledger row that matches nothing
 * are all non-zero exits naming what could not be read.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

import { isEntrypoint } from './invoked-as.mjs';
import { parseSourceFile } from './ts-parse.mjs';

export const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');

export const WRITE_VERBS = ['insert', 'update', 'delete'];
export const OBJECT_PARAM_NAMES = new Set(['object', 'objectName', 'objectApiName', 'name']);
export const SURFACE_ROOTS = ['packages/services', 'packages/plugins'];

export function isTestPath(relPath) {
  return /\.(test|spec)\./.test(relPath) || /(^|\/)(tests|__tests__|qa)\//.test(relPath);
}

export function trackedTs(root, roots) {
  return execFileSync('git', ['-C', root, 'ls-files', ...roots], { encoding: 'utf8', maxBuffer: 1 << 28 })
    .split('\n')
    .filter(Boolean)
    .filter((f) => /\.(ts|tsx|mts|cts)$/.test(f) && !f.includes('/dist/'));
}

export function collectSources(root = ROOT, roots = SURFACE_ROOTS) {
  const out = trackedTs(root, roots).filter((f) => !isTestPath(f));
  if (out.length === 0) throw new Error('tenant-audit-census: corpus resolved to ZERO source files');
  return out;
}

/** Does this member declaration look like an ObjectQL data-engine door? */
function memberIsEngineDoor(member, sf) {
  const nm = member.name && ts.isIdentifier(member.name) ? member.name.text : null;
  if (!nm) return false;
  const params = member.parameters ?? member.type?.parameters;
  if (!params || params.length === 0) return false;
  const p0 = params[0];
  if (!p0.name || !ts.isIdentifier(p0.name)) return false;
  if (!OBJECT_PARAM_NAMES.has(p0.name.text)) return false;
  const t = p0.type ? p0.type.getText(sf).replace(/\s+/g, '') : null;
  if (t !== 'string') return false;
  return { name: nm, isWrite: WRITE_VERBS.includes(nm) };
}

/** Every corpus-declared type whose shape is an ObjectQL data engine. */
export function buildEngineTypeIndex(root = ROOT) {
  const index = new Map(); // type name -> { decls, verbs }
  const files = trackedTs(root, ['packages', 'examples']);
  for (const rel of files) {
    const text = readFileSync(join(root, rel), 'utf8');
    if (!/\b(insert|update|delete)\??\s*[(<]/.test(text)) continue;
    if (!/\b(object|objectName|objectApiName)\s*:\s*string/.test(text)) continue;
    const sf = parseSourceFile(rel, text);
    const visit = (node) => {
      let name = null;
      let members = null;
      if (ts.isInterfaceDeclaration(node)) {
        name = node.name.text;
        members = node.members;
      } else if (ts.isTypeAliasDeclaration(node) && ts.isTypeLiteralNode(node.type)) {
        name = node.name.text;
        members = node.type.members;
      }
      if (name && members) {
        const verbs = [];
        let doors = 0;
        for (const m of members) {
          if (!ts.isMethodSignature(m) && !ts.isPropertySignature(m)) continue;
          const hit = memberIsEngineDoor(m, sf);
          if (!hit) continue;
          doors += 1;
          if (hit.isWrite) verbs.push(hit.name);
        }
        if (verbs.length > 0) {
          const prev = index.get(name);
          if (prev) prev.decls.push(rel);
          else index.set(name, { decls: [rel], verbs, doors });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  // An interface that EXTENDS an engine-shaped interface inherits its doors
  // (`IObjectQLEngine extends IDataEngine`). Collected in its OWN sweep because
  // the derived declaration need not restate a single door, so the shape
  // prefilter above cannot see it -- and a receiver spelled with the derived
  // name is exactly the site a census must not lose.
  for (let pass = 0; pass < 8; pass += 1) {
    let changed = false;
    for (const rel of files) {
      const text = readFileSync(join(root, rel), 'utf8');
      if (!/\bextends\b/.test(text)) continue;
      let mentions = false;
      for (const known of index.keys()) if (text.includes(known)) { mentions = true; break; }
      if (!mentions) continue;
      const sf = parseSourceFile(rel, text);
      const visit = (node) => {
        if (ts.isInterfaceDeclaration(node) && !index.has(node.name.text)) {
          const bases = (node.heritageClauses ?? []).flatMap((h) => h.types
            .filter((t) => ts.isIdentifier(t.expression)).map((t) => t.expression.text));
          const engineBases = bases.filter((b) => index.has(b));
          if (engineBases.length > 0) {
            index.set(node.name.text, {
              decls: [rel],
              verbs: [...new Set(engineBases.flatMap((b) => index.get(b).verbs))],
              via: engineBases,
            });
            changed = true;
          }
        }
        ts.forEachChild(node, visit);
      };
      visit(sf);
    }
    if (!changed) break;
  }
  return index;
}


/** Type-reference names appearing anywhere inside a type node. */
function typeRefNames(node, sf) {
  const names = [];
  const walk = (n) => {
    if (ts.isTypeReferenceNode(n) && ts.isIdentifier(n.typeName)) names.push(n.typeName.text);
    ts.forEachChild(n, walk);
  };
  walk(node);
  return names;
}

/**
 * Aliases that NARROW an engine-shaped type -- `Partial<Pick<IDataEngine, ...>>`
 * and friends. Strict on purpose: every type reference in the alias must be
 * either an engine-shaped type or one of the mapped-type wrappers below, so an
 * alias that merely MENTIONS an engine type in some unrelated position is not
 * swept in. One pass, no transitive closure.
 */
const NARROWING_WRAPPERS = new Set(['Pick', 'Partial', 'Omit', 'Readonly', 'Required', 'NonNullable']);

export function widenIndexThroughAliases(index, root = ROOT) {
  const added = new Map();
  for (const rel of trackedTs(root, ['packages', 'examples'])) {
    const text = readFileSync(join(root, rel), 'utf8');
    if (!/\btype\s+\w+\s*=/.test(text)) continue;
    let mentions = false;
    for (const known of index.keys()) if (text.includes(known)) { mentions = true; break; }
    if (!mentions) continue;
    const sf = parseSourceFile(rel, text);
    const visit = (node) => {
      if (ts.isTypeAliasDeclaration(node) && !ts.isTypeLiteralNode(node.type) && !index.has(node.name.text)) {
        const refs = typeRefNames(node.type, sf);
        const engineRefs = refs.filter((r) => index.has(r));
        const strayRefs = refs.filter((r) => !index.has(r) && !NARROWING_WRAPPERS.has(r));
        if (engineRefs.length > 0 && strayRefs.length === 0) {
          const picked = (node.type.getText(sf).match(/'(insert|update|delete)'/g) ?? []).map((q) => q.slice(1, -1));
          const verbs = picked.length > 0
            ? [...new Set(picked)]
            : [...new Set(engineRefs.flatMap((r) => index.get(r).verbs))];
          if (verbs.length > 0) added.set(node.name.text, { decls: [rel], verbs, via: engineRefs });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  for (const [k, v] of added) index.set(k, v);
  return index;
}

/** Unwrap `x!`, `(x)`, `x as T`, `<T>x` down to the receiver expression. */
function unwrap(n) {
  if (ts.isNonNullExpression(n) || ts.isParenthesizedExpression(n)) return unwrap(n.expression);
  if (ts.isAwaitExpression(n)) return unwrap(n.expression);
  if (ts.isAsExpression(n) || ts.isTypeAssertionExpression?.(n)) return n;
  return n;
}

/** Declared types visible in ONE file, keyed the way a receiver spells itself. */
export function declaredTypesIn(sf) {
  const thisProps = new Map();
  const locals = new Map();
  const fnReturns = new Map();
  // `TypeName -> member -> declared type` for shapes declared in THIS file, so
  // `deps.getDataEngine()` and `opts.engine` resolve without a type checker.
  const shapes = new Map();
  // Identifiers imported from a `node:` builtin -- never an engine.
  const builtins = new Set();
  const note = (map, key, typeNode, initializer) => {
    if (map.has(key) && map.get(key).type) return;
    map.set(key, {
      type: typeNode ? typeNode.getText(sf).replace(/\s+/g, ' ') : null,
      init: initializer ? initializer.getText(sf).replace(/\s+/g, ' ').slice(0, 120) : null,
      node: initializer ?? null,
      literal: initializer && ts.isStringLiteralLike(initializer) ? initializer.text : null,
    });
  };
  const visit = (n) => {
    if (ts.isImportDeclaration(n) && ts.isStringLiteralLike(n.moduleSpecifier)
        && /^node:/.test(n.moduleSpecifier.text)) {
      const b = n.importClause?.namedBindings;
      if (b && ts.isNamedImports(b)) for (const el of b.elements) builtins.add(el.name.text);
      if (n.importClause?.name) builtins.add(n.importClause.name.text);
    }
    if (ts.isInterfaceDeclaration(n) || (ts.isTypeAliasDeclaration(n) && ts.isTypeLiteralNode(n.type))) {
      const members = ts.isInterfaceDeclaration(n) ? n.members : n.type.members;
      const m = new Map();
      for (const mem of members) {
        if (!mem.name || !ts.isIdentifier(mem.name)) continue;
        const t = ts.isMethodSignature(mem) ? mem.type : mem.type;
        if (t) m.set(mem.name.text, t.getText(sf).replace(/\s+/g, ' '));
      }
      shapes.set(n.name.text, m);
    }
    if (ts.isPropertyDeclaration(n) && ts.isIdentifier(n.name)) note(thisProps, n.name.text, n.type, n.initializer);
    if (ts.isParameter(n) && ts.isIdentifier(n.name)) {
      if (ts.isConstructorDeclaration(n.parent) && n.modifiers?.length) note(thisProps, n.name.text, n.type, n.initializer);
      note(locals, n.name.text, n.type, n.initializer);
    }
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name)) {
      // `const getData = (): IDataEngine | undefined => …` -- the RETURN type is
      // what a caller of `getData()` receives, not what `getData` itself is.
      const init = n.initializer;
      if (!n.type && init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init)) && init.type) {
        note(fnReturns, n.name.text, init.type, null);
      }
      note(locals, n.name.text, n.type, n.initializer);
    }
    // `const { engine, cryptoProvider } = deps;` -- the member's declared type on
    // the base's own shape. Losing these loses REAL engine sites, which is the
    // one direction a census must never fail in.
    if (ts.isVariableDeclaration(n) && ts.isObjectBindingPattern(n.name)) {
      const baseText = n.type ? n.type.getText(sf)
        : (n.initializer && ts.isIdentifier(n.initializer) ? locals.get(n.initializer.text)?.type : null);
      for (const el of n.name.elements) {
        if (!ts.isIdentifier(el.name)) continue;
        const prop = el.propertyName && ts.isIdentifier(el.propertyName) ? el.propertyName.text : el.name.text;
        const mt = memberTypeOfShapes(baseText, prop, shapes);
        if (mt) locals.set(el.name.text, { type: mt, init: null, node: null });
        else if (n.initializer && ts.isAwaitExpression(n.initializer)
                 && ts.isCallExpression(n.initializer.expression)
                 && n.initializer.expression.expression.kind === ts.SyntaxKind.ImportKeyword
                 && ts.isStringLiteralLike(n.initializer.expression.arguments[0])
                 && /^node:/.test(n.initializer.expression.arguments[0].text)) {
          builtins.add(el.name.text);
        }
      }
    }
    if ((ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n)) && n.name && ts.isIdentifier(n.name)) {
      note(fnReturns, n.name.text, n.type, null);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return { thisProps, locals, fnReturns, shapes, builtins };
}

/** The declared type of `<base>.<member>` when `base`'s shape is in this file. */
function memberTypeOfShapes(baseTypeText, member, shapes) {
  if (!baseTypeText) return null;
  for (const id of baseTypeText.match(/[A-Za-z_$][\w$]*/g) ?? []) {
    const shape = shapes.get(id);
    if (shape?.has(member)) return shape.get(member);
  }
  return null;
}

function memberTypeOf(baseTypeText, member, decls) {
  return memberTypeOfShapes(baseTypeText, member, decls.shapes);
}

/** How a receiver spells itself, for ledger keys and diagnostics. */
export function receiverKey(node, sf) {
  return node.getText(sf).replace(/\s+/g, ' ');
}

/** Resolve a receiver expression to an engine-shaped type name, or a reason it is not one. */
export function resolveReceiver(recvNode, sf, decls, index, depth = 0) {
  const r = unwrap(recvNode);
  if (depth > 4) return { kind: 'unresolved', how: 'depth' };
  const nameOf = (typeText) => {
    if (!typeText) return null;
    for (const id of typeText.match(/[A-Za-z_$][\w$]*/g) ?? []) if (index.has(id)) return id;
    return null;
  };
  const fromEntry = (entry, how) => {
    if (!entry) return { kind: 'unresolved', how };
    const t = nameOf(entry.type);
    if (t) return { kind: 'engine', type: t, how };
    // ⛔ `any` / `unknown` is NOT a classification. A receiver the author erased
    // is a receiver this census could not read, and a census must never score
    // what it could not read as "nothing to report" -- it goes to the ledger.
    if (entry.type && /^(any|unknown)$/.test(entry.type.trim())) {
      return { kind: 'unresolved', how: `${how}:any`, detail: entry.type };
    }
    if (entry.type) return { kind: 'other', type: entry.type, how };
    if (entry.init) {
      const t2 = nameOf(entry.init);
      if (t2) return { kind: 'engine', type: t2, how: `${how}/init` };
      const ctor = /^new\s+([A-Za-z_$][\w$.]*)/.exec(entry.init);
      if (ctor) {
        const t3 = nameOf(ctor[1]);
        if (t3) return { kind: 'engine', type: t3, how: `${how}/new` };
        return { kind: 'other', type: `new ${ctor[1]}`, how: `${how}/new` };
      }
      if (entry.node) {
        const via = resolveReceiver(entry.node, sf, decls, index, depth + 1);
        if (via.kind !== 'unresolved') return { ...via, how: `${how}/${via.how}` };
      }
      return { kind: 'unresolved', how: `${how}/init`, detail: entry.init };
    }
    return { kind: 'unresolved', how };
  };
  if (ts.isAsExpression(r)) {
    const t = nameOf(r.type.getText(sf));
    if (t) return { kind: 'engine', type: t, how: 'as' };
    // `as any` / `as unknown` erase nothing about the VALUE -- keep walking the
    // operand, or a cast would hide a real engine receiver from the census.
    const erasing = /^(any|unknown)$/.test(r.type.getText(sf).trim());
    if (erasing) {
      const via = resolveReceiver(r.expression, sf, decls, index, depth + 1);
      if (via.kind !== 'unresolved') return { ...via, how: `as-any/${via.how}` };
      return { kind: 'unresolved', how: 'as-any', detail: receiverKey(r.expression, sf) };
    }
    return { kind: 'other', type: r.type.getText(sf), how: 'as' };
  }
  if (ts.isPropertyAccessExpression(r) && r.expression.kind === ts.SyntaxKind.ThisKeyword) {
    return fromEntry(decls.thisProps.get(r.name.text), `this.${r.name.text}`);
  }
  if (ts.isIdentifier(r)) {
    if (decls.builtins.has(r.text)) return { kind: 'other', type: `node: builtin ${r.text}`, how: 'node-import' };
    return fromEntry(decls.locals.get(r.text), r.text);
  }
  // `opts.engine`, `this.options.persistence` -- resolved through the shape the
  // base's own declared type gives the member.
  if (ts.isPropertyAccessExpression(r)) {
    const baseText = ts.isPropertyAccessExpression(r.expression) && r.expression.expression.kind === ts.SyntaxKind.ThisKeyword
      ? decls.thisProps.get(r.expression.name.text)?.type
      : ts.isIdentifier(r.expression) ? decls.locals.get(r.expression.text)?.type : null;
    const mt = memberTypeOf(baseText, r.name.text, decls);
    if (mt) {
      const t = nameOf(mt);
      if (t) return { kind: 'engine', type: t, how: `member ${r.name.text}` };
      return { kind: 'other', type: mt, how: `member ${r.name.text}` };
    }
  }
  if (ts.isCallExpression(r)) {
    const callee = r.expression;
    const fname = ts.isIdentifier(callee) ? callee.text
      : ts.isPropertyAccessExpression(callee) ? callee.name.text : null;
    const generic = r.typeArguments?.length ? nameOf(r.typeArguments[0].getText(sf)) : null;
    if (generic) return { kind: 'engine', type: generic, how: `${fname}<>` };
    if (ts.isIdentifier(callee) && decls.builtins.has(callee.text)) {
      return { kind: 'other', type: `node: builtin ${callee.text}()`, how: 'node-import' };
    }
    // `deps.getDataEngine()` / `service.getAdapter(...)` -- the member's declared
    // RETURN type, read off the base's own shape.
    if (ts.isPropertyAccessExpression(callee)) {
      const baseText = callee.expression.kind === ts.SyntaxKind.ThisKeyword
        ? null
        : ts.isIdentifier(callee.expression) ? decls.locals.get(callee.expression.text)?.type : null;
      const mt = memberTypeOf(baseText, callee.name.text, decls);
      if (mt) {
        const t = nameOf(mt);
        if (t) return { kind: 'engine', type: t, how: `${fname}() return` };
        return { kind: 'other', type: mt, how: `${fname}() return` };
      }
    }
    const entry = fname ? decls.fnReturns.get(fname) : null;
    if (entry) return fromEntry(entry, `${fname}()`);
    return { kind: 'unresolved', how: 'call', detail: receiverKey(r, sf) };
  }
  if (r.kind === ts.SyntaxKind.ThisKeyword) return { kind: 'unresolved', how: 'this' };
  return { kind: 'unresolved', how: ts.SyntaxKind[r.kind], detail: receiverKey(r, sf) };
}

/**
 * Every object the tree DECLARES, with its tenancy posture.
 *
 * Tenancy is enabled by DEFAULT: `isTenancyDisabled()` reads
 * `tenancy.enabled === false` and nothing else, so the registry only has to
 * find the objects that opt OUT. Two do, today.
 *
 * The name set doubles as the census's discriminator for `any`-typed receivers
 * -- see {@link runCensus}.
 */
export function declaredObjects(root = ROOT) {
  const objects = new Map();
  for (const rel of trackedTs(root, ['packages', 'examples'])) {
    if (!/\.object\.tsx?$/.test(rel)) continue;
    const text = readFileSync(join(root, rel), 'utf8');
    const sf = parseSourceFile(rel, text);
    const visit = (n) => {
      if (ts.isObjectLiteralExpression(n)) {
        let nm = null;
        let disabled = false;
        for (const prop of n.properties) {
          if (!ts.isPropertyAssignment(prop) || !prop.name) continue;
          const key = ts.isIdentifier(prop.name) || ts.isStringLiteralLike(prop.name) ? prop.name.text : null;
          if (key === 'name' && ts.isStringLiteralLike(prop.initializer)) nm = prop.initializer.text;
          if (key === 'tenancy' && ts.isObjectLiteralExpression(prop.initializer)) {
            for (const q of prop.initializer.properties) {
              if (ts.isPropertyAssignment(q) && ts.isIdentifier(q.name) && q.name.text === 'enabled'
                  && q.initializer.kind === ts.SyntaxKind.FalseKeyword) disabled = true;
            }
          }
        }
        if (nm && /^[a-z][a-z0-9_]*$/.test(nm) && !objects.has(nm)) objects.set(nm, { file: rel, tenancyDisabled: disabled });
        else if (nm && disabled) objects.set(nm, { file: rel, tenancyDisabled: true });
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  if (objects.size === 0) {
    throw new Error(
      'tenant-audit-census: the object registry resolved to ZERO declarations -- refusing to '
      + 'classify tenancy against nothing (a walk that found no objects and a tree with no '
      + 'objects are different).',
    );
  }
  return objects;
}

/**
 * What execution context, if any, this write call threads -- and whether that
 * context is ELEVATED.
 *
 * ## ⛔ Three answers, because "I could not read it" is not "there is none"
 *
 * `carries` is `true` / `false` / `'undecidable'`, and the third value is
 * load-bearing. The first edition had two, and folded an unreadable options
 * argument -- `engine.update(object, data, options)` inside a forwarding shim,
 * `{ ...opts }`, a variable -- into `false`. That published **84 sites
 * "carrying NO tenant context at all"** when only 17 of them said so; the other
 * 67 were arguments the walker could not read.
 *
 * ⭐ That is an over-claim in the ALARMING direction, on the one figure this page
 * tells other cards to cite. It is the same failure this whole artefact exists
 * to stop, wearing the opposite hat: not a population under-counted into
 * silence, but an unknown published as a finding. A number that cannot tell
 * "provably unscoped" from "unread" is not evidence of anything.
 *
 * So:
 *   - `false`        -- the options argument was READ and holds no context: an
 *                       object literal with no `context` / `tenantId` key, or no
 *                       options argument at all. This is the control's real
 *                       yield surface.
 *   - `'undecidable'` -- an options argument this cannot read. It may carry a
 *                       context; a static reading cannot say.
 *   - `true`         -- a `context` or `tenantId` key is there.
 *
 * A spread inside an otherwise readable literal makes the answer undecidable for
 * the same reason it does in {@link elevationOf}: the spread may carry the key
 * the literal never names.
 */
export function tenantContextOf(node, sf, decls) {
  const args = node.arguments.slice(1);
  if (args.length === 0) return { carries: false, how: 'no-options-argument', system: false };
  let opaque = null;
  let spread = null;
  for (const a of args) {
    if (ts.isObjectLiteralExpression(a)) {
      for (const prop of a.properties) {
        if (ts.isSpreadAssignment(prop)) { spread = prop.expression.getText(sf).replace(/\s+/g, ' ').slice(0, 40); continue; }
        const key = prop.name && (ts.isIdentifier(prop.name) || ts.isStringLiteralLike(prop.name)) ? prop.name.text : null;
        if (key === 'context') {
          const value = ts.isPropertyAssignment(prop) ? prop.initializer : null;
          return { carries: true, how: 'options.context', system: elevationOf(value, sf, decls) };
        }
        if (key === 'tenantId') return { carries: true, how: 'options.tenantId', system: false };
      }
    } else if (!ts.isStringLiteralLike(a) && !ts.isNumericLiteral(a)
               && a.kind !== ts.SyntaxKind.TrueKeyword && a.kind !== ts.SyntaxKind.FalseKeyword) {
      opaque = a.getText(sf).replace(/\s+/g, ' ').slice(0, 60);
    }
  }
  if (opaque) return { carries: 'undecidable', how: 'options-argument-unreadable', opaque, system: 'undecidable' };
  if (spread) return { carries: 'undecidable', how: 'options-spread-unreadable', opaque: spread, system: 'undecidable' };
  return { carries: false, how: 'no-context-key', system: false };
}

/**
 * Is this context expression an ELEVATED (`isSystem: true`) one?
 *
 * ## ⛔ A SPREAD is not evidence of absence
 *
 * The first edition of this walked an object literal's named properties looking
 * for `isSystem`, skipped anything that was not a `PropertyAssignment`, and
 * returned `false` when the loop ended. A `SpreadAssignment` carries no `name`,
 * so `{ ...SYSTEM_CTX }` fell through every branch and was reported as
 * **decidably NOT elevated** -- the exact opposite of the truth, since every
 * `SYSTEM_CTX` in the tree is `{ isSystem: true, … }`.
 *
 * That is the worst direction a classifier can fail in, and it is this repo's
 * recurring shape: a thing the walker could not read, scored as a thing with
 * nothing to report. It was measured, not reasoned about -- six sites across
 * `service-storage` were published as "decidably not elevated" while all six
 * spread an elevated context.
 *
 * So a spread is resolved, and an unresolvable one makes the whole answer
 * `undecidable`. It can never contribute `false`.
 *
 * `as const` is unwrapped on the way: the constants this has to read are
 * declared `{ isSystem: true } as const`, which is an `AsExpression` wrapping
 * the literal, not a literal.
 */
function elevationOf(value, sf, decls, depth = 0) {
  if (value == null || depth > 4) return 'undecidable';

  /** `{ … } as const` / `({ … })` down to the literal. */
  const unwrapLiteral = (n) => {
    if (!n) return null;
    if (ts.isAsExpression(n) || ts.isParenthesizedExpression(n)) return unwrapLiteral(n.expression);
    return n;
  };

  /** The object literal an expression resolves to in this file, or null. */
  const literalFor = (n) => {
    const bare = unwrapLiteral(n);
    if (!bare) return null;
    if (ts.isObjectLiteralExpression(bare)) return bare;
    if (ts.isIdentifier(bare)) return unwrapLiteral(decls?.locals.get(bare.text)?.node) ?? null;
    return null;
  };

  const readLiteral = (node, d) => {
    const lit = literalFor(node);
    if (!lit || !ts.isObjectLiteralExpression(lit)) return null;
    let sawUnresolvableSpread = false;
    // Later properties win in an object literal, so the LAST answer decides.
    let verdict = false;
    for (const prop of lit.properties) {
      if (ts.isSpreadAssignment(prop)) {
        if (d > 4) { sawUnresolvableSpread = true; continue; }
        const inner = readLiteral(prop.expression, d + 1);
        // ⛔ `null` here means "could not read it", NOT "it said no".
        if (inner === null || inner === 'undecidable') sawUnresolvableSpread = true;
        else verdict = inner;
        continue;
      }
      if (!ts.isPropertyAssignment(prop) || !prop.name || !ts.isIdentifier(prop.name)) continue;
      if (prop.name.text !== 'isSystem') continue;
      if (prop.initializer.kind === ts.SyntaxKind.TrueKeyword) verdict = true;
      else if (prop.initializer.kind === ts.SyntaxKind.FalseKeyword) verdict = false;
      else return 'undecidable';
    }
    // An unread spread can only be resolved DOWNWARD to uncertainty: it may have
    // carried the flag this literal never mentions.
    if (sawUnresolvableSpread && verdict !== true) return 'undecidable';
    return verdict;
  };

  const answer = readLiteral(value, depth);
  return answer === null ? 'undecidable' : answer;
}

/**
 * ⛔ SHRINK-ONLY, and keyed by (file, receiver) -- never by line.
 *
 * The write calls whose receiver has no readable type AND that neither placement
 * rule reaches. Each row says what the receiver really is, and `engine` says
 * whether it is one of ours. A row that matches nothing in the tree FAILS: its
 * reason has outlived the code it described.
 *
 * ⚠️ Deliberately NOT keyed by line. A ledger of line numbers rots exactly like
 * the page anchors this mechanism exists to stop rotting, and it rots INVISIBLY,
 * because a stale row still excuses a site.
 *
 * ⭐ `engine: true` rows are COUNTED into the census. Eleven of the sites below
 * are real engine writes reached through an `any`, and eleven is 5% of this
 * population -- a ledger that could only subtract would be a ledger that can only
 * shrink the truth.
 */
export const UNTYPED_RECEIVERS = [
  // ── Real engine writes, reached through an erased receiver ──────────────────
  {
    file: 'packages/plugins/plugin-auth/src/member-role-canonical.ts',
    receiver: 'ql',
    engine: true,
    what: '`ql: any` seed helper writing `MEMBER_OBJECT` (= `SystemObjectName.MEMBER`, an enum member, so the name is not a readable literal)',
  },
  {
    file: 'packages/plugins/plugin-email/src/bootstrap-declared-email-templates.ts',
    receiver: '(engine as any)',
    engine: true,
    what: 'the ObjectQL engine behind an `as any`, writing the declared email-template rows',
  },
  {
    file: 'packages/plugins/plugin-security/src/claim-seed-ownership.ts',
    receiver: 'ql',
    engine: true,
    what: '`ql: any` seed helper writing `schema.name` -- a runtime object name off the registered schema',
  },
  {
    file: 'packages/plugins/plugin-sharing/src/sharing-plugin.ts',
    receiver: 'engine',
    engine: true,
    what: '`engine: any` sharing backfill writing a runtime `object`',
  },
  {
    file: 'packages/plugins/plugin-webhooks/src/bootstrap-declared-webhooks.ts',
    receiver: 'engine',
    engine: true,
    what: '`engine: any` bootstrap writing `subscriptionsObject`',
  },
  {
    file: 'packages/services/service-settings/src/settings-service-plugin.ts',
    receiver: 'eng',
    engine: true,
    what: 'the settings service\'s engine facade forwarding to `eng: any`; its own `objectName` parameter carries no annotation to read',
  },

  // ── Not the data engine. Same three verb names, different mechanism ─────────
  {
    file: 'packages/plugins/plugin-auth/src/two-factor-reenrollment-verified-reset.ts',
    receiver: 'adapter',
    engine: false,
    what: 'the better-auth adapter -- `update({ model, update, where })`, a keyword object, not `(object, data, options)`',
  },
  {
    file: 'packages/services/service-automation/src/builtin/map-node.ts',
    receiver: 'variables',
    engine: false,
    what: 'the flow run\'s variable Map -- `delete(`${node.id}.$mapItemDone`)` clears a handoff key',
  },
  {
    file: 'packages/services/service-cluster-redis/src/pubsub.ts',
    receiver: 'b',
    engine: false,
    what: 'a `Set` of subscriber handlers read out of `this.subs`',
  },
  {
    file: 'packages/services/service-cluster/src/memory/pubsub.ts',
    receiver: 'b',
    engine: false,
    what: 'the in-memory sibling of the redis pubsub Set above',
  },
  {
    file: 'packages/services/service-cluster/src/memory/lock.ts',
    receiver: 'self.holders',
    engine: false,
    what: 'the lock\'s holder Map, dropping a released holder',
  },
  {
    file: 'packages/services/service-cluster/src/testing.ts',
    receiver: 'kv',
    engine: false,
    what: 'the cluster KV under the shared conformance suite this module EXPORTS -- `kv.delete(\'k\')` deletes a key, and the file is a suite factory rather than a test by path',
  },
  {
    file: 'packages/services/service-knowledge/src/knowledge-reap-guard.ts',
    receiver: 'adapter',
    engine: false,
    what: 'a knowledge search-index adapter -- `delete([documentId], { source })` de-indexes documents',
  },
  {
    file: 'packages/services/service-messaging/src/memory-http-outbox.ts',
    receiver: 'this',
    engine: false,
    what: 'the outbox class\'s OWN `private insert(...)`, which takes a delivery record and no object name',
  },
  {
    file: 'packages/services/service-messaging/src/sql-http-outbox.ts',
    receiver: 'this',
    engine: false,
    what: 'the SQL outbox\'s own `private insert(...)`, same shape as its in-memory sibling',
  },
  {
    file: 'packages/services/service-realtime/src/in-memory-realtime-adapter.ts',
    receiver: 'channelSubs',
    engine: false,
    what: 'a `Set` of channel subscriptions read out of `this.channelIndex`',
  },
  {
    file: 'packages/services/service-storage/src/attachment-lifecycle.ts',
    receiver: 'storage',
    engine: false,
    what: 'the blob-storage backend -- `delete(row.key)` removes BYTES by storage key, not a row by object name',
  },
];

/**
 * What the FIRST argument of a write call names.
 *
 * `literal` and `const-literal` are the statically decidable halves -- a `const`
 * object name is as decidable as an inline one, and reading it that way is what
 * keeps the undecidable bucket honest about being genuinely undecidable rather
 * than merely unread. 37 of this census's sites name their object through a
 * `const`.
 */
export function resolveObjectNameArg(a0, sf, decls) {
  if (a0 == null) return { kind: 'absent', name: null };
  if (ts.isStringLiteralLike(a0)) return { kind: 'literal', name: a0.text };
  if (ts.isIdentifier(a0)) {
    const entry = decls.locals.get(a0.text);
    if (entry?.literal) return { kind: 'const-literal', name: entry.literal };
    if (OBJECT_PARAM_NAMES.has(a0.text) && entry?.type?.trim() === 'string') {
      return { kind: 'object-name-parameter', name: a0.getText(sf) };
    }
  }
  return { kind: 'runtime', name: a0.getText(sf).replace(/\s+/g, ' ') };
}

/** Run the census. */
export function runCensus({ root = ROOT, roots = SURFACE_ROOTS } = {}) {
  const index = widenIndexThroughAliases(buildEngineTypeIndex(root), root);
  const objects = declaredObjects(root);
  const sources = collectSources(root, roots);
  const sites = [];
  const unresolved = [];
  const usedRows = new Set();
  let nonEngineCalls = 0;

  for (const rel of sources) {
    let text;
    try {
      text = readFileSync(join(root, rel), 'utf8');
    } catch (error) {
      throw new Error(`tenant-audit-census: cannot read ${rel} -- ${error.message}`);
    }
    if (!/\.(insert|update|delete)\s*[(<]/.test(text)) continue;
    const sf = parseSourceFile(rel, text);
    const decls = declaredTypesIn(sf);
    const visit = (node) => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
          && WRITE_VERBS.includes(node.expression.name.text)) {
        const verb = node.expression.name.text;
        const res = resolveReceiver(node.expression.expression, sf, decls, index);
        const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
        const a0 = node.arguments[0];
        const arg = resolveObjectNameArg(a0, sf, decls);
        const decided = arg.kind === 'literal' || arg.kind === 'const-literal';
        const objectName = arg.name;
        const where = {
          file: rel, line: line + 1,
          receiver: receiverKey(node.expression.expression, sf),
        };

        let kind = res.kind;
        let engineType = res.type ?? null;
        let placedBy = 'declared-type';
        // ⭐ THE RESCUE. A receiver the author typed `any` carries no type to
        // read, and 44 of this census's sites are spelled that way. Their write
        // calls are still placeable, because the FIRST ARGUMENT names a declared
        // object -- a fact about the tree, not about the receiver's name. Without
        // this the census silently loses a quarter of its own population to a
        // keyword.
        if (kind === 'unresolved' && decided && objects.has(objectName)) {
          kind = 'engine';
          engineType = 'untyped receiver, placed by object name';
          placedBy = 'object-name';
        } else if (kind === 'unresolved' && arg.kind === 'object-name-parameter') {
          // The second half of the same rescue. These are the RUNTIME-NAME
          // sites: `ql.insert(object, …)` inside a `(ql: any, object: string)`
          // helper. The receiver is erased AND the object is a parameter, so
          // neither the type nor the name places them -- but the argument is
          // declared with exactly the door signature the type index keys on
          // (`object: string` in first position), which is a fact about the
          // declaration rather than a guess about the identifier.
          kind = 'engine';
          engineType = 'untyped receiver, placed by object-name parameter';
          placedBy = 'object-name-parameter';
        }

        if (kind === 'unresolved') {
          const row = UNTYPED_RECEIVERS.find((r) => r.file === rel && r.receiver === where.receiver);
          if (row) {
            usedRows.add(row);
            if (row.engine) { kind = 'engine'; engineType = 'untyped receiver, placed by ledger'; placedBy = 'ledger'; }
            else kind = 'other';
          }
        }

        if (kind === 'other') { nonEngineCalls += 1; }
        else if (kind === 'unresolved') {
          unresolved.push({ ...where, verb, how: res.how, detail: res.detail ?? null, ledgered: false });
        } else {
          const ctx = tenantContextOf(node, sf, decls);
          const decl = decided ? objects.get(objectName) : null;
          sites.push({
            ...where, verb, engineType, placedBy,
            objectName,
            objectNameKind: arg.kind,
            objectDeclared: decided ? Boolean(decl) : null,
            tenancy: decided
              ? (decl ? (decl.tenancyDisabled ? 'disabled' : 'enabled') : 'undeclared-name')
              : 'undecidable',
            carriesTenantContext: ctx.carries,
            contextHow: ctx.how,
            elevatedContext: ctx.system,
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }

  sites.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  unresolved.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  const tenancyEnabled = sites.filter((s) => s.tenancy === 'enabled');
  return {
    sites,
    unresolved,
    unledgered: unresolved.filter((u) => !u.ledgered),
    staleLedgerRows: UNTYPED_RECEIVERS.filter((r) => !usedRows.has(r)),
    nonEngineCalls,
    totals: {
      writeCallSites: sites.length,
      staticallyDecidableObjectName: sites.filter((s) => s.tenancy !== 'undecidable').length,
      undecidableObjectName: sites.filter((s) => s.tenancy === 'undecidable').length,
      objectNameInline: sites.filter((s) => s.objectNameKind === 'literal').length,
      objectNameConst: sites.filter((s) => s.objectNameKind === 'const-literal').length,
      objectNameParameter: sites.filter((s) => s.objectNameKind === 'object-name-parameter').length,
      objectNameRuntime: sites.filter((s) => s.objectNameKind === 'runtime').length,
      tenancyEnabled: tenancyEnabled.length,
      tenancyDisabled: sites.filter((s) => s.tenancy === 'disabled').length,
      provablyNoTenantContext: sites.filter((s) => s.carriesTenantContext === false).length,
      tenantContextUnreadable: sites.filter((s) => s.carriesTenantContext === 'undecidable').length,
      carriesTenantContext: sites.filter((s) => s.carriesTenantContext === true).length,
      tenancyEnabledProvablyNoContext: tenancyEnabled.filter((s) => s.carriesTenantContext === false).length,
      tenancyEnabledContextUnreadable: tenancyEnabled.filter((s) => s.carriesTenantContext === 'undecidable').length,
      placedByObjectName: sites.filter((s) => s.placedBy === 'object-name').length,
      placedByObjectNameParameter: sites.filter((s) => s.placedBy === 'object-name-parameter').length,
      placedByLedger: sites.filter((s) => s.placedBy === 'ledger').length,
      elevatedContext: sites.filter((s) => s.elevatedContext === true).length,
      nonElevatedContext: sites.filter((s) => s.carriesTenantContext && s.elevatedContext === false).length,
      elevationUndecidable: sites.filter((s) => s.elevatedContext === 'undecidable').length,
    },
    engineTypes: index.size,
    declaredObjects: objects.size,
    scannedSources: sources.length,
  };
}

export const PAGE = 'content/docs/permissions/tenant-audit-census.mdx';
export const COUNTS = 'docs/audits/2026-08-tenant-audit-write-call-sites.counts.md';
export const BEGIN_MARKER = '{/* BEGIN GENERATED: tenant-audit-census (scripts/tenant-audit-census.mjs) — DO NOT EDIT */}';
export const END_MARKER = '{/* END GENERATED: tenant-audit-census */}';

/**
 * ⛔ NEITHER artefact carries LINE NUMBERS, and that is the design rather than an
 * omission.
 *
 * An artefact keyed to line numbers reds on a pure DISPLACEMENT -- an inserted
 * import above the site is enough -- so it churns on edits that changed nothing
 * it measures, and its repair arm then has to tell displacement apart from a
 * population change. That is a defect the sibling `isSystem` gate is carrying
 * right now (a false "the POPULATION changed" refusal when only ledger-excused
 * citations shifted), and inheriting its anchor scheme into a brand-new gate on
 * day one would be a choice rather than an accident.
 *
 * So the rows are AGGREGATED: one per (file, verb, object name, tenancy, context
 * posture), with a count. That key is invariant under displacement, so the only
 * thing that can move these files is the population itself -- which is the only
 * thing they claim to describe. `--json` still carries every site's `file:line`
 * for anyone navigating to one.
 *
 * ## Why the rows live in `docs/audits/` and not on the page
 *
 * Same split, and the same reason, as `packages/spec`'s strictness ledger and its
 * generated `.counts.md`: the page has prose to preserve and the row table has
 * none, so the table is regenerated WHOLE while the page keeps a small generated
 * region for the figures its prose reasons about. A reader gets a page they can
 * read; a re-deriver gets a ledger they can diff.
 *
 * It also keeps 140-odd rows of machine output out of the published docs site,
 * and out of `content/docs`-scoped prose ratchets that have no way to tell an
 * emitted source path from an author's sentence -- `check-role-word` already
 * excludes `content/docs/references/` for exactly that reason, and a hybrid page
 * is a shape its directory-level exclusion cannot express.
 */
function aggregate(census) {
  const groups = new Map();
  for (const site of census.sites) {
    const posture = site.carriesTenantContext === true
      ? (site.elevatedContext === true ? 'elevated'
        : site.elevatedContext === false ? 'tenant-scoped'
        : 'context, elevation undecidable')
      : site.carriesTenantContext === false ? 'PROVABLY NONE'
      : 'options unreadable';
    const key = JSON.stringify([site.file, site.verb, site.objectName, site.tenancy, posture]);
    groups.set(key, (groups.get(key) ?? 0) + 1);
  }
  return [...groups.entries()]
    .map(([key, count]) => ({ cells: JSON.parse(key), count }))
    .sort((a, b) => a.cells[0].localeCompare(b.cells[0])
      || a.cells[2].localeCompare(b.cells[2])
      || a.cells[1].localeCompare(b.cells[1]));
}

/** The page's generated region: the figures its prose reasons about. */
export function renderGeneratedRegion(census) {
  const t = census.totals;
  const out = [];
  out.push(BEGIN_MARKER, '');
  out.push('## The measurement', '');
  out.push('| what | count |', '| :--- | ---: |');
  out.push(`| write call sites on the application surface | **${t.writeCallSites}** |`);
  out.push(`| …whose object name is statically decidable | ${t.staticallyDecidableObjectName} |`);
  out.push(`| …whose object name is chosen at run time | ${t.undecidableObjectName} |`);
  out.push(`| …against an object with tenancy ENABLED | ${t.tenancyEnabled} |`);
  out.push(`| …against an object that declares tenancy off | ${t.tenancyDisabled} |`);
  out.push(`| threading a tenant context | ${t.carriesTenantContext} |`);
  out.push(`| PROVABLY carrying none (options read, no context key) | **${t.provablyNoTenantContext}** |`);
  out.push(`| …of those, against a decidably tenancy-enabled object | **${t.tenancyEnabledProvablyNoContext}** |`);
  out.push(`| options argument UNREADABLE — may or may not carry one | ${t.tenantContextUnreadable} |`);
  out.push(`| …of those, against a decidably tenancy-enabled object | ${t.tenancyEnabledContextUnreadable} |`);
  out.push(`| threading a decidably ELEVATED (\`isSystem\`) context | ${t.elevatedContext} |`);
  out.push(`| threading a context that is decidably NOT elevated | ${t.nonElevatedContext} |`);
  out.push(`| threading a context whose elevation is a run-time fact | ${t.elevationUndecidable} |`);
  out.push('');
  out.push('| how the instrument reached the site | count |', '| :--- | ---: |');
  out.push(`| receiver carried a readable engine type | ${t.writeCallSites - t.placedByObjectName - t.placedByObjectNameParameter - t.placedByLedger} |`);
  out.push(`| receiver erased, placed by the object NAME | ${t.placedByObjectName} |`);
  out.push(`| receiver erased, placed by an \`object: string\` PARAMETER | ${t.placedByObjectNameParameter} |`);
  out.push(`| receiver erased, placed by an \`UNTYPED_RECEIVERS\` row | ${t.placedByLedger} |`);
  out.push('');
  out.push(`| object name spelled inline | ${t.objectNameInline} |`);
  out.push(`| object name spelled through a \`const\` | ${t.objectNameConst} |`);
  out.push(`| object name is an \`object: string\` parameter | ${t.objectNameParameter} |`);
  out.push(`| object name is some other run-time expression | ${t.objectNameRuntime} |`);
  out.push('');
  out.push(`Scanned ${census.scannedSources} tracked non-test sources under \`packages/services/\` and`);
  out.push(`\`packages/plugins/\`, against ${census.engineTypes} engine-shaped types and`);
  out.push(`${census.declaredObjects} declared objects. ${census.nonEngineCalls} calls to a same-named`);
  out.push(`method on something that is not a data engine were subtracted. Every site is`);
  out.push(`listed in [\`${COUNTS}\`](https://github.com/objectstack-ai/objectstack/blob/main/${COUNTS}),`);
  out.push(`regenerated by the same command.`);
  out.push('');
  out.push(END_MARKER);
  return out.join('\n');
}

/**
 * The audit ledger: every site, regenerated WHOLE.
 *
 * No prose to preserve, so nothing here is spliced -- the file is rewritten. That
 * is what makes `merge=os-regen` the right resolution for it, the same as its
 * strictness-ledger sibling: two branches that each add a write call site produce
 * rows that git merges cleanly and a header that merges cleanly and WRONG. The
 * correct resolution is always "recompute from the merged tree".
 */
export function renderCountsFile(census) {
  const t = census.totals;
  const out = [];
  out.push('<!-- GENERATED — DO NOT EDIT BY HAND. -->');
  out.push('<!-- Regenerate: node scripts/tenant-audit-census.mjs --write -->');
  out.push('');
  out.push('# Tenant-audit census — every write call site (generated)');
  out.push('');
  out.push('Every application-surface write call site against a tenancy-enabled object, as');
  out.push('`scripts/tenant-audit-census.mjs` derives it from the tree. **The prose, the');
  out.push('method and the deviations from the figures this replaced are on the page**');
  out.push('(`content/docs/permissions/tenant-audit-census.mdx`); this file has no prose to');
  out.push('preserve and is regenerated whole.');
  out.push('');
  out.push('⛔ **Never hand-patch a row or a number here** — fix the code, or the census, and');
  out.push('regenerate. `scripts/check-tenant-audit-census.mjs` fails the build when this file');
  out.push('and the tree disagree.');
  out.push('');
  out.push('Rows are aggregated by (file, verb, object, tenancy, context posture) and carry no');
  out.push('line numbers, so a pure displacement cannot move them. Run the generator with');
  out.push('`--json` for per-site `file:line`.');
  out.push('');
  out.push('⚠️ **On a merge conflict here, regenerate — never resolve by hand.** Two branches');
  out.push('that each add a write call site produce rows git merges cleanly and totals that');
  out.push('merge cleanly and WRONG. This file is deliberately NOT `merge=os-regen`: that');
  out.push('driver resolves an artefact\'s `gen:`/`check:` scripts in `@objectstack/spec`');
  out.push('only, and these are root-level tooling. The gate is the backstop — a wrongly');
  out.push('merged file fails `check-tenant-audit-census`, so the error is loud rather than');
  out.push('silent, and `node scripts/tenant-audit-census.mjs --write` is the resolution.');
  out.push('');
  out.push('## Totals');
  out.push('');
  out.push('| Measure | Value |');
  out.push('|---|---:|');
  out.push(`| Write call sites | ${t.writeCallSites} |`);
  out.push(`| Object name statically decidable | ${t.staticallyDecidableObjectName} |`);
  out.push(`| Object name chosen at run time | ${t.undecidableObjectName} |`);
  out.push(`| Against a tenancy-enabled object | ${t.tenancyEnabled} |`);
  out.push(`| Against an object declaring tenancy off | ${t.tenancyDisabled} |`);
  out.push(`| Threading a tenant context | ${t.carriesTenantContext} |`);
  out.push(`| Provably carrying none | ${t.provablyNoTenantContext} |`);
  out.push(`| …and decidably tenancy-enabled | ${t.tenancyEnabledProvablyNoContext} |`);
  out.push(`| Options argument unreadable | ${t.tenantContextUnreadable} |`);
  out.push(`| …and decidably tenancy-enabled | ${t.tenancyEnabledContextUnreadable} |`);
  out.push(`| Threading a decidably elevated context | ${t.elevatedContext} |`);
  out.push(`| Threading a decidably non-elevated context | ${t.nonElevatedContext} |`);
  out.push(`| Threading a context of undecidable elevation | ${t.elevationUndecidable} |`);
  out.push(`| Sources scanned | ${census.scannedSources} |`);
  out.push(`| Engine-shaped types recognised | ${census.engineTypes} |`);
  out.push(`| Declared objects in the registry | ${census.declaredObjects} |`);
  out.push(`| Same-named calls subtracted as non-engine | ${census.nonEngineCalls} |`);
  out.push('');
  out.push('## Every site');
  out.push('');
  out.push('| file | verb | object | tenancy | tenant context | n |');
  out.push('|---|---|---|---|---|---:|');
  for (const r of aggregate(census)) {
    const [file, verb, object, tenancy, context] = r.cells;
    out.push(`| \`${file}\` | \`${verb}\` | \`${object}\` | ${tenancy} | ${context} | ${r.count} |`);
  }
  out.push('');
  return out.join('\n');
}

/** Splice the generated region into the page text. */
export function spliceRegion(pageText, region) {
  const begin = pageText.indexOf(BEGIN_MARKER);
  const end = pageText.indexOf(END_MARKER);
  if (begin === -1 || end === -1) {
    throw new Error(
      `tenant-audit-census: ${PAGE} has no generated region -- expected the marker pair `
      + '`BEGIN GENERATED: tenant-audit-census` / `END GENERATED: tenant-audit-census`. '
      + 'Refusing to guess where the census belongs.',
    );
  }
  return pageText.slice(0, begin) + region + pageText.slice(end + END_MARKER.length);
}

// ---------------------------------------------------------------------------
// Self-test -- the only instrument on the elevation classifier
// ---------------------------------------------------------------------------

/**
 * The classifier's defect class is a MATCHING RULE over shapes a clean tree
 * contains only by accident, so a production run cannot tell a working rule from
 * a weakened one: green means "no unplaceable receiver", and the elevation
 * verdicts are not part of that verdict at all. They are published, and nothing
 * else reads them.
 *
 * These cases are the shapes that were measured wrong. The first edition scored
 * `{ ...SYSTEM_CTX }` as decidably NOT elevated and every `context: SYSTEM_CTX`
 * as undecidable -- 51 sites' verdicts, six of them inverted outright -- because
 * it skipped spreads and never unwrapped `as const`. Both are pinned here in the
 * direction that failed, plus the direction that must NOT be over-claimed: a
 * spread this cannot read makes the answer `undecidable`, never `false`.
 */
export function selfTest() {
  const cases = [];
  const t = (name, actual, expected) => cases.push({
    name, ok: String(actual) === String(expected), detail: `got ${actual}, want ${expected}`,
  });

  /** Classify the `context:` of the single write call in a synthetic source. */
  const classify = (src) => {
    const sf = parseSourceFile('selftest.ts', src);
    const decls = declaredTypesIn(sf);
    let out = 'NO-CALL';
    const visit = (node) => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
          && WRITE_VERBS.includes(node.expression.name.text)) {
        const ctx = tenantContextOf(node, sf, decls);
        out = ctx.carries ? String(ctx.system) : 'NO-CONTEXT';
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
    return out;
  };

  const call = (opts) => `declare const e: any;\ne.insert('o', {}, ${opts});\n`;

  // ── the shapes that were measured WRONG ────────────────────────────────────
  t('a `const … as const` context resolves through the assertion',
    classify(`const SYSTEM_CTX = { isSystem: true } as const;\n${call('{ context: SYSTEM_CTX }')}`), true);
  t('a SPREAD of an elevated const is elevated -- not "no isSystem key, so false"',
    classify(`const SYSTEM_CTX = { isSystem: true } as const;\n${call('{ context: { ...SYSTEM_CTX } }')}`), true);
  t('a spread of an elevated const survives extra keys beside it',
    classify(`const S = { isSystem: true } as const;\n${call('{ context: { ...S, raw: true } }')}`), true);

  // ── the direction that must not be OVER-claimed ────────────────────────────
  t('an UNRESOLVABLE spread is undecidable, never false',
    classify(`${call('{ context: { ...someImportedThing } }')}`), 'undecidable');
  t('an unresolvable spread beside an unrelated key is still undecidable',
    classify(`${call('{ context: { ...whatever, raw: true } }')}`), 'undecidable');
  t('a spread of a const that does NOT mention the flag is undecidable, not false',
    classify(`const C = { raw: true } as const;\n${call('{ context: { ...C, ...other } }')}`), 'undecidable');

  // ── the ordinary verdicts, so the fix did not swallow them ─────────────────
  t('an inline elevated literal is elevated',
    classify(call('{ context: { isSystem: true } }')), true);
  t('an inline literal that names the flag false is NOT elevated',
    classify(call('{ context: { isSystem: false } }')), false);
  t('an inline literal with no flag and no spread is NOT elevated',
    classify(call('{ context: { userId: "u1" } }')), false);
  t('a context from a helper CALL is undecidable',
    classify(call('{ context: systemWriteContext(orgId) }')), 'undecidable');
  t('a later key wins over an earlier spread',
    classify(`const S = { isSystem: true } as const;\n${call('{ context: { ...S, isSystem: false } }')}`), false);
  t('a write with no options argument carries no context',
    classify(`declare const e: any;\ne.insert('o', {});\n`), 'NO-CONTEXT');
  t('an options object with no context key carries no context',
    classify(call('{ raw: true }')), 'NO-CONTEXT');

  // ── the three-valued `carries`, whose middle value was the second over-claim ──
  const carries = (opts) => {
    const src = `declare const e: any;\ne.insert('o', {}, ${opts});\n`;
    const sf = parseSourceFile('selftest.ts', src);
    const decls = declaredTypesIn(sf);
    let out = 'NO-CALL';
    const visit = (node) => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)
          && WRITE_VERBS.includes(node.expression.name.text)) out = String(tenantContextOf(node, sf, decls).carries);
      ts.forEachChild(node, visit);
    };
    visit(sf);
    return out;
  };
  t('an UNREADABLE options argument is undecidable, never "carries no context"',
    carries('opts'), 'undecidable');
  t('an options literal carrying only a SPREAD is undecidable',
    carries('{ ...opts }'), 'undecidable');
  t('a READ options literal with no context key provably carries none',
    carries('{ raw: true }'), 'false');
  t('no options argument at all provably carries none',
    (() => {
      const sf = parseSourceFile('selftest.ts', "declare const e: any;\ne.insert('o', {});\n");
      const decls = declaredTypesIn(sf);
      let out = 'NO-CALL';
      const visit = (n) => {
        if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)
            && WRITE_VERBS.includes(n.expression.name.text)) out = String(tenantContextOf(n, sf, decls).carries);
        ts.forEachChild(n, visit);
      };
      visit(sf);
      return out;
    })(), 'false');
  t('a context key still reads as carried', carries('{ context: ctx }'), 'true');

  const failed = cases.filter((c) => !c.ok);
  for (const c of failed) console.error(`  ✗ ${c.name} -- ${c.detail}`);
  if (failed.length > 0) {
    console.error(`✗ tenant-audit-census self-test: ${failed.length} of ${cases.length} case(s) failed.`);
    return 1;
  }
  console.log(
    `✓ tenant-audit-census self-test: ${cases.length} cases pass (an \`as const\` context, an `
    + 'elevated SPREAD, an unresolvable spread refusing to answer `false`, an unreadable '
    + 'options argument refusing to answer "carries no context", and the ordinary verdicts).',
  );
  return 0;
}

function main(argv) {
  if (argv.includes('--self-test')) return selfTest();

  const c = runCensus();
  if (argv.includes('--write')) {
    for (const [rel, next] of [
      [PAGE, spliceRegion(readFileSync(join(ROOT, PAGE), 'utf8'), renderGeneratedRegion(c))],
      [COUNTS, renderCountsFile(c)],
    ]) {
      const abs = join(ROOT, rel);
      const before = readFileSync(abs, 'utf8');
      if (before === next) { process.stdout.write(`tenant-audit-census: ${rel} already current\n`); continue; }
      writeFileSync(abs, next);
      process.stdout.write(`tenant-audit-census: rewrote ${rel}\n`);
    }
    return 0;
  }
  if (argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(c, null, 2)}\n`);
  } else {
    const t = c.totals;
    process.stdout.write([
      `tenant-audit-census: ${t.writeCallSites} engine write call sites on the application surface`,
      `  sources scanned ${c.scannedSources} · engine-shaped types ${c.engineTypes} · declared objects ${c.declaredObjects}`,
      `  object name decidable ${t.staticallyDecidableObjectName} · undecidable ${t.undecidableObjectName}`,
      `    inline literal ${t.objectNameInline} · const ${t.objectNameConst} · name parameter ${t.objectNameParameter} · other runtime ${t.objectNameRuntime}`,
      `  tenancy enabled ${t.tenancyEnabled} · declared off ${t.tenancyDisabled}`,
      `  tenant context: carried ${t.carriesTenantContext} · provably absent ${t.provablyNoTenantContext} · unreadable ${t.tenantContextUnreadable}`,
      `    provably absent AND tenancy-enabled ${t.tenancyEnabledProvablyNoContext} · unreadable AND tenancy-enabled ${t.tenancyEnabledContextUnreadable}`,
      `  threads a context: elevated ${t.elevatedContext} · not elevated ${t.nonElevatedContext} · undecidable ${t.elevationUndecidable}`,
      `  untyped receivers placed: by object name ${t.placedByObjectName} · by name parameter ${t.placedByObjectNameParameter} · by ledger ${t.placedByLedger}`,
      `  non-engine calls subtracted ${c.nonEngineCalls} · unresolved receivers ${c.unresolved.length}`,
      '',
    ].join('\n'));
  }
  for (const u of c.unledgered) {
    process.stderr.write(`::error::[untyped-receiver] ${u.file}:${u.line} \`${u.receiver}\`.${u.verb}() -- `
      + `receiver type unreadable [${u.how}] and the object name is not a literal declared object. `
      + `Add an UNTYPED_RECEIVERS row saying what it is.\n`);
  }
  for (const r of c.staleLedgerRows) {
    process.stderr.write(`::error::[stale-ledger-row] UNTYPED_RECEIVERS names ${r.file} (receiver `
      + `\`${r.receiver}\`) but no such write call exists -- delete the row.\n`);
  }
  return c.unledgered.length === 0 && c.staleLedgerRows.length === 0 ? 0 : 1;
}

if (isEntrypoint(import.meta.url)) process.exit(main(process.argv.slice(2)));
