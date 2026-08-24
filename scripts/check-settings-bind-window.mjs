#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Settings bind-window guard (#11045, ADR-0116 one lifecycle phase later).
 *
 * ## The window
 *
 * `SettingsServicePlugin` registers the service in `init()` but binds the DATA
 * ENGINE to it from a `kernel:ready` hook it registers in `start()`. Between
 * those two moments the service is resolvable and answers reads — from the
 * empty in-memory fallback and the manifest defaults, with `source: 'default'`,
 * while a real `sys_setting` row sits unread. Nothing at any level
 * distinguishes that from "no row exists". `SettingsService.reportPreBindRead`
 * (#10250) makes it audible at runtime; this gate is the CI half, because the
 * runtime half requires someone to be reading the boot log of a deployment
 * whose composition order happens to be wrong.
 *
 * ## Why `check:init-service-contract` does not cover it
 *
 * That gate (#4471) is exactly the right SHAPE, and this one is built on its
 * machinery — but its population is `init()`-reachable lookups. Both sides of
 * this ordering constraint live one phase later: the provider binds from a
 * `start()`-registered `kernel:ready` hook, and the readers acquire their
 * handle from their own `start()`-registered `kernel:ready` hooks. A walk
 * rooted at `init()` sees neither. Measured on `0320a52d`:
 * `check:init-service-contract` reports `34 declared / 1 self-provided / 3
 * without a workspace provider (68 plugin unit(s) scanned)` and is green with
 * and without the three declarations #10250 landed — it is indifferent to the
 * property this file guards.
 *
 * ## The population, and the two remedies
 *
 * Everything that runs before that bind hook is the window. Where a read sits
 * inside it decides which repair is even POSSIBLE, so the two are separate
 * verdicts with separate messages:
 *
 *  - `ready-hook-from-start` — a `kernel:ready` handler registered from
 *    `start()`. FIXABLE BY DECLARATION: `optionalDependencies:
 *    ['com.objectstack.service.settings']` hoists the settings plugin's
 *    `start()` ahead, so its bind hook is registered — and therefore fires —
 *    first (handlers run in registration order). This is the #10250 repair,
 *    and the three shipped always-on readers (`plugin-email`, `service-sms`,
 *    `service-storage`) carry exactly it.
 *
 *  - `init-body` / `start-body` / `ready-hook-from-init` — NOT FIXABLE BY
 *    DECLARATION, and the reason is worth stating because a gate that printed
 *    the declaration remedy here would be giving advice that cannot work: the
 *    bind happens in the settings plugin's OWN `kernel:ready` hook, which is
 *    strictly after every plugin's `init()` and `start()` and after every
 *    handler registered during `init()`. No ordering edge can move a read in
 *    those phases out of the window. The repair is to move the read to
 *    `kernel:bootstrapped` (the earliest safe phase — the same one
 *    `reportPreBindRead`'s message names) or to make it lazy so it resolves at
 *    first use.
 *
 * A plugin the settings plugin itself depends on gets a third verdict,
 * `cycle`: it can never be ordered after the settings plugin, because the
 * reverse edge already exists. Measured with the real `resolvePluginOrder`:
 * giving `ObjectQLPlugin` `optionalDependencies:
 * ['com.objectstack.service.settings']` throws `[Kernel] Circular dependency
 * detected`. That set is DERIVED from the settings plugin's own declarations,
 * never hardcoded, so it tracks a change to those declarations instead of
 * going stale. Such a plugin must not read settings VALUES in the window; it
 * may hold the handle and call registry-only methods (`registerManifest`),
 * which is what `ObjectQLPlugin` does.
 *
 * ## Why AST, and why the transitive arm is the load-bearing part
 *
 * #10250's census of this same surface used a name-based walker. It hit 4 of 6
 * known readers, EVERY HIT AT DEPTH 0, and an earlier revision mis-parsed every
 * `(ctx as any).hook(...)` registration and returned 1-line bodies for 8 of 16
 * hooks — "a zero that looked completely clean". Two consequences are baked in
 * here:
 *
 *  1. This walks the TypeScript AST (via `scripts/ts-parse.mjs`, so a file that
 *     fails to parse is a loud failure and never a quiet clean score). The
 *     `(ctx as any).hook(...)` form and multi-line function signatures are
 *     ordinary nodes to an AST and cannot drop out of the index. `--self-test`
 *     pins both anyway, so a future rewrite back toward text matching fails
 *     here rather than in a boot log.
 *  2. The walk resolves handlers and callees through same-class methods,
 *     same-file free functions AND LOCAL (block-scoped) bindings. The last one
 *     is not a nicety: the live `plugin-auth` case is
 *     `ctx.hook('kernel:ready', () => runBackfill('kernel:ready'))` where
 *     `runBackfill` is a `const` inside `start()` that calls
 *     `this.ensureAuthSettingsBound(ctx)` which calls `this.bindAuthSettings(ctx)`
 *     which does the read — depth 3. A depth-0 walker reports zero for it.
 *     `--self-test` case "transitive" is written so that a depth-0-only walker
 *     FAILS it.
 *
 * Nested function bodies are deliberately NOT entered: a closure defined inside
 * a hook and handed to a collaborator runs when that collaborator calls it, not
 * during the hook. `plugin-audit`'s `getLocale` (`audit-plugin.ts:200`) is the
 * measured case — it is passed to `installAuditWriters` and invoked from
 * `resolveWriteLocale` on CRUD writes (`audit-writers.ts:781`), i.e. long after
 * the window closed. `packages/rest`'s `settingsServiceProvider` and
 * `ObjectQLPlugin`'s `getSettings` are the same shape.
 *
 * ## Usage
 *
 *     node scripts/check-settings-bind-window.mjs             # audit the repo
 *     node scripts/check-settings-bind-window.mjs --list      # print every read
 *     node scripts/check-settings-bind-window.mjs --self-test # verify the checker
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { parseSourceFile } from './ts-parse.mjs';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');

const DECLARATION_FIELDS = ['dependencies', 'optionalDependencies', 'requiresServices', 'providesServices'];

/** The service name whose provider late-binds its engine — see the header. */
const SETTINGS_SERVICE = 'settings';

/**
 * The kernel hook the settings plugin binds its engine from. Named once: a
 * second spelling of this string is a second definition of "the window".
 */
const READY_HOOK = 'kernel:ready';

/**
 * The accessors that RESOLVE A NAMED SERVICE out of the kernel registry.
 *
 * Identical to `check-init-service-contract.mjs`'s `SERVICE_LOOKUP_CALLEES`,
 * and for the identical reason: the hazard is a property of the registry, not
 * of one method name, so a name missing here is a silent hole that reports a
 * confident green. #4772 shipped an undeclared `getServiceAsync` straight
 * through the sibling gate while it knew only `getService`.
 */
const SERVICE_LOOKUP_CALLEES = new Set(['getService', 'getServiceAsync', 'getServiceScoped']);

/** Tokens whose absence proves a file can contribute nothing — see `scan()`. */
const PREFILTER_TOKENS = [...SERVICE_LOOKUP_CALLEES, 'providesServices'];

/**
 * Pre-bind reads that are KNOWN, MEASURED and owned by another card.
 *
 * This ledger is shrink-only in both directions: an entry that stops being a
 * problem is an ERROR here (delete it in the PR that fixes it), and a new
 * offender cannot be admitted without editing this file. It exists because
 * #11045 is the GATE card — the two live readers below were found by its
 * step-1 measurement and routed to their owning lanes rather than fixed here,
 * so landing the gate without them means landing it red.
 *
 * Keyed by plugin id + verdict, because the two entries need DIFFERENT repairs
 * and a single "known bad" bucket would let one be closed by the other's fix.
 */
const KNOWN_PRE_BIND_READS = [
  {
    plugin: 'com.objectstack.mcp',
    verdict: 'unfixable-by-declaration',
    issue: '#11580',
    note:
      'MCPServerPlugin.start() resolves settings on the stdio auto-start path and immediately ' +
      'awaits resolveLocalizationContext with it, once for the life of the transport (#7279). ' +
      'A start()-body read is inside the window under EVERY composition order, so no ' +
      'declaration repairs it — the read has to move or become lazy.',
  },
];

// ── Discovery ────────────────────────────────────────────────────────────────

/** Recursively collect candidate source files under `packages/`. */
function discoverFiles() {
  const out = [];
  const skip = new Set(['node_modules', 'dist', 'build', '.turbo', '.next', 'coverage']);
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      if (skip.has(entry)) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) { walk(full); continue; }
      if (!entry.endsWith('.ts') || entry.endsWith('.d.ts')) continue;
      if (entry.includes('.test.') || entry.includes('.spec.') || entry.includes('.conformance.')) continue;
      out.push(relative(ROOT, full).split(sep).join('/'));
    }
  };
  walk(join(ROOT, 'packages'));
  return out.sort();
}

// ── Parsing plugin units ─────────────────────────────────────────────────────

/** String elements of an array-literal initializer, or undefined when absent /
 *  not statically readable. */
function stringArray(initializer) {
  if (!initializer || !ts.isArrayLiteralExpression(initializer)) return undefined;
  const out = [];
  for (const el of initializer.elements) {
    if (!ts.isStringLiteralLike(el)) return undefined;
    out.push(el.text);
  }
  return out;
}

/** Function-like kinds whose bodies do NOT run synchronously inside the
 *  enclosing call — the walk must not descend into them. */
function isDeferredFunctionLike(node) {
  return ts.isArrowFunction(node) || ts.isFunctionExpression(node) ||
    ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isClassExpression(node) ||
    ts.isMethodDeclaration(node);
}

/**
 * One plugin declaration site — a class or an object literal carrying a `name`
 * and at least one of `init` / `start`. Both shapes ship here: `AuthPlugin` is
 * a class with `async start(ctx)`, `ObjectQLPlugin` is a class with
 * `start = async (ctx) => {}`, and `createRestApiPlugin` returns an object
 * literal with `start: async (ctx) => {}`. All three are pinned in `--self-test`.
 */
function collectPluginUnits(file, src) {
  const units = [];
  /** Same-file free functions (declarations + const initializers), by name. */
  const fileFunctions = new Map();
  /** Same-file `const X = 'literal'`, by name — see `resolvePluginNames`. */
  const fileConsts = new Map();

  const indexFileFunction = (name, fnNode) => {
    if (name && fnNode && !fileFunctions.has(name)) fileFunctions.set(name, fnNode);
  };

  const topWalk = (node) => {
    if (ts.isFunctionDeclaration(node) && node.name) {
      indexFileFunction(node.name.text, node);
    } else if (ts.isVariableStatement(node)) {
      for (const d of node.declarationList.declarations) {
        if (!ts.isIdentifier(d.name) || !d.initializer) continue;
        if (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer)) {
          indexFileFunction(d.name.text, d.initializer);
        } else if (ts.isStringLiteralLike(d.initializer) && !fileConsts.has(d.name.text)) {
          fileConsts.set(d.name.text, d.initializer.text);
        }
      }
    }

    if (ts.isClassDeclaration(node) || ts.isClassExpression(node)) {
      const unit = classUnit(file, src, node, fileFunctions);
      if (unit) units.push(unit);
    }
    if (ts.isObjectLiteralExpression(node)) {
      const unit = objectUnit(file, src, node, fileFunctions);
      if (unit) units.push(unit);
    }
    ts.forEachChild(node, topWalk);
  };
  ts.forEachChild(src, topWalk);

  // `name = SOME_CONST` is not an exotic spelling — it is how the settings
  // plugin itself spells its id (`name = SETTINGS_PLUGIN_ID`). A unit whose
  // name stays unresolved is a unit no declaration can point at, and for the
  // PROVIDER it would sink the whole scan, so resolve what is resolvable here
  // and let `scan()` take the one import hop for the rest.
  for (const unit of units) {
    if (unit.pluginName || !unit.nameRef) continue;
    const literal = fileConsts.get(unit.nameRef);
    if (literal !== undefined) unit.pluginName = literal;
  }
  return units;
}

/**
 * Resolve a `name = IMPORTED_CONST` through exactly ONE import hop.
 *
 * Deliberately one hop and literals only: this is name resolution for a
 * declaration field, not a module system. A name that needs more than that
 * stays unresolved, and `audit()` refuses loudly when the unresolved one is the
 * provider rather than reporting a green over a population it could not name.
 */
function resolveNameThroughImport(file, src, ident, readFile) {
  let spec;
  for (const st of src.statements) {
    if (!ts.isImportDeclaration(st) || !st.importClause) continue;
    const named = st.importClause.namedBindings;
    if (!named || !ts.isNamedImports(named)) continue;
    if (!named.elements.some((e) => e.name.text === ident)) continue;
    if (ts.isStringLiteralLike(st.moduleSpecifier)) spec = st.moduleSpecifier.text;
    if (spec) break;
  }
  if (!spec || !spec.startsWith('.')) return undefined;

  const dir = file.split('/').slice(0, -1).join('/');
  const base = spec.replace(/\.js$/, '');
  const parts = `${dir}/${base}`.split('/');
  const stack = [];
  for (const p of parts) {
    if (p === '.' || p === '') continue;
    if (p === '..') stack.pop();
    else stack.push(p);
  }
  const resolvedBase = stack.join('/');
  for (const candidate of [`${resolvedBase}.ts`, `${resolvedBase}/index.ts`]) {
    let text;
    try { text = readFile(candidate); } catch { continue; }
    const mod = parseSourceFile(candidate, text);
    for (const st of mod.statements) {
      if (!ts.isVariableStatement(st)) continue;
      for (const d of st.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.name.text === ident &&
          d.initializer && ts.isStringLiteralLike(d.initializer)) {
          return d.initializer.text;
        }
      }
    }
  }
  return undefined;
}

function classUnit(file, src, cls, fileFunctions) {
  const methods = new Map();
  const decl = {};
  let nameLiteral;
  let nameRef;
  let hasNameProp = false;

  for (const member of cls.members) {
    const memberName = member.name && (ts.isIdentifier(member.name) || ts.isStringLiteralLike(member.name))
      ? member.name.text : undefined;
    if (!memberName) continue;

    if (ts.isMethodDeclaration(member)) { methods.set(memberName, member); continue; }
    if (ts.isPropertyDeclaration(member)) {
      if (memberName === 'name') {
        hasNameProp = true;
        if (member.initializer && ts.isStringLiteralLike(member.initializer)) {
          nameLiteral = member.initializer.text;
        } else if (member.initializer && ts.isIdentifier(member.initializer)) {
          nameRef = member.initializer.text;
        }
      }
      if (DECLARATION_FIELDS.includes(memberName)) decl[memberName] = stringArray(member.initializer);
      // A property initialized to a function is a callable too — `ObjectQLPlugin`
      // spells its lifecycle hook as `start = async (ctx) => {}`.
      if (member.initializer &&
        (ts.isArrowFunction(member.initializer) || ts.isFunctionExpression(member.initializer))) {
        methods.set(memberName, member.initializer);
      }
    }
  }

  if (!methods.has('init') && !methods.has('start')) return undefined;
  const implementsPlugin = (cls.heritageClauses ?? []).some((h) =>
    h.types.some((t) => /Plugin/.test(t.expression.getText(src))));
  if (!hasNameProp && !implementsPlugin) return undefined;

  return {
    file,
    anchor: cls.name ? cls.name.text : '(anonymous class)',
    pluginName: nameLiteral,
    nameRef,
    decl,
    methods,
    fileFunctions,
    line: src.getLineAndCharacterOfPosition(cls.getStart(src)).line + 1,
  };
}

function objectUnit(file, src, obj, fileFunctions) {
  const methods = new Map();
  const decl = {};
  let nameLiteral;
  let nameRef;

  for (const prop of obj.properties) {
    const propName = prop.name && (ts.isIdentifier(prop.name) || ts.isStringLiteralLike(prop.name))
      ? prop.name.text : undefined;
    if (!propName) continue;

    if (ts.isMethodDeclaration(prop)) { methods.set(propName, prop); continue; }
    if (ts.isPropertyAssignment(prop)) {
      if (propName === 'name') {
        if (ts.isStringLiteralLike(prop.initializer)) nameLiteral = prop.initializer.text;
        else if (ts.isIdentifier(prop.initializer)) nameRef = prop.initializer.text;
      }
      if (DECLARATION_FIELDS.includes(propName)) decl[propName] = stringArray(prop.initializer);
      if (ts.isArrowFunction(prop.initializer) || ts.isFunctionExpression(prop.initializer)) {
        methods.set(propName, prop.initializer);
      }
    }
  }

  if (!nameLiteral && !nameRef) return undefined;
  if (!methods.has('init') && !methods.has('start')) return undefined;
  return {
    file,
    anchor: nameLiteral ?? nameRef,
    pluginName: nameLiteral,
    nameRef,
    decl,
    methods,
    fileFunctions,
    line: src.getLineAndCharacterOfPosition(obj.getStart(src)).line + 1,
  };
}

// ── Pre-bind read analysis ───────────────────────────────────────────────────

/**
 * Every settings lookup that executes BEFORE the settings plugin's engine bind,
 * tagged with the sub-window it sits in (see the header for why that decides
 * the remedy).
 *
 * The walk starts at `init()` and `start()`, follows same-class `this.m(...)`,
 * same-file free functions and local block-scoped bindings transitively, and
 * does NOT descend into nested function bodies. Every `<expr>.hook('kernel:ready',
 * handler)` it passes hands `handler` to a second walk of the same kind, whose
 * origin records which lifecycle method registered it.
 */
function preBindReads(unit, src) {
  const reads = [];

  /** Local (block-scoped) function bindings seen anywhere along the walk. */
  const locals = new Map();

  const walk = (fnNode, origin, visited, onReadyHook) => {
    if (!fnNode || visited.has(fnNode)) return;
    visited.add(fnNode);
    const body = fnNode.body;
    if (!body) return;

    const resolveCallable = (node) => {
      if (!node) return undefined;
      if (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) return node;
      if (ts.isIdentifier(node)) return locals.get(node.text) ?? unit.fileFunctions.get(node.text);
      if (ts.isPropertyAccessExpression(node) && node.expression.kind === ts.SyntaxKind.ThisKeyword) {
        return unit.methods.get(node.name.text);
      }
      return undefined;
    };

    const visit = (node) => {
      // Index local callables BEFORE the deferred-body early return: the
      // binding is in scope for the enclosing body even though its own body is
      // not executed here. `plugin-auth`'s `runBackfill` is exactly this, and
      // without it the walk stops one call short of the read.
      if (ts.isFunctionDeclaration(node) && node.name && !locals.has(node.name.text)) {
        locals.set(node.name.text, node);
      }
      if (ts.isVariableStatement(node)) {
        for (const d of node.declarationList.declarations) {
          if (ts.isIdentifier(d.name) && d.initializer &&
            (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer)) &&
            !locals.has(d.name.text)) {
            locals.set(d.name.text, d.initializer);
          }
        }
      }

      if (isDeferredFunctionLike(node)) return;

      if (ts.isCallExpression(node)) {
        const callee = node.expression;

        if (ts.isPropertyAccessExpression(callee)) {
          // `<anything>.getService('settings')` — including the optional-call
          // form and `(ctx as any).getService(...)`, both ordinary property
          // accesses to the AST.
          if (SERVICE_LOOKUP_CALLEES.has(callee.name.text)) {
            const arg = node.arguments[0];
            if (arg && ts.isStringLiteralLike(arg) && arg.text === SETTINGS_SERVICE) {
              reads.push({
                accessor: callee.name.text,
                origin,
                line: src.getLineAndCharacterOfPosition(node.getStart(src)).line + 1,
              });
            }
          }
          // `<anything>.hook('kernel:ready', handler)` — `ctx.hook`,
          // `(ctx as any).hook`, `this.ctx.hook` all land here.
          if (callee.name.text === 'hook' && onReadyHook) {
            const [nameArg, handlerArg] = node.arguments;
            if (nameArg && ts.isStringLiteralLike(nameArg) && nameArg.text === READY_HOOK) {
              const handler = resolveCallable(handlerArg);
              if (handler) onReadyHook(handler);
            }
          }
          // `this.m(...)` → same-class method or function-valued property.
          if (callee.expression.kind === ts.SyntaxKind.ThisKeyword) {
            const target = unit.methods.get(callee.name.text);
            if (target) walk(target, origin, visited, onReadyHook);
          }
        }

        // `f(...)` → local binding first (inner scope wins), then same-file.
        if (ts.isIdentifier(callee)) {
          const target = locals.get(callee.text) ?? unit.fileFunctions.get(callee.text);
          if (target) walk(target, origin, visited, onReadyHook);
        }
      }
      ts.forEachChild(node, visit);
    };
    // A CONCISE arrow body (`() => runBackfill('kernel:ready')`) is an
    // expression, not a Block: descending straight into its children would step
    // past the CallExpression itself and lose the only call it makes. That is
    // not a fixture-shaped worry — it is `plugin-auth`'s live registration, and
    // the first draft of this walker returned a clean zero for it.
    if (ts.isBlock(body)) ts.forEachChild(body, visit);
    else visit(body);
  };

  for (const [phase, bodyOrigin, hookOrigin] of [
    ['init', 'init-body', 'ready-hook-from-init'],
    ['start', 'start-body', 'ready-hook-from-start'],
  ]) {
    const root = unit.methods.get(phase);
    if (!root) continue;
    const handlers = [];
    walk(root, bodyOrigin, new Set(), (h) => handlers.push(h));
    // Handlers registered by a handler inherit the registering phase's window.
    for (let i = 0; i < handlers.length; i++) {
      walk(handlers[i], hookOrigin, new Set(), (h) => handlers.push(h));
    }
  }

  return reads;
}

// ── Scan + audit ─────────────────────────────────────────────────────────────

function scan(files = discoverFiles()) {
  const readSource = (rel) => readFileSync(join(ROOT, rel), 'utf8');
  const units = [];
  for (const file of files) {
    const text = readFileSync(join(ROOT, file), 'utf8');
    // Cheap pre-filter, derived from the vocabulary rather than hardcoded to
    // 'getService' — a hardcoded token would filter a newly added accessor out
    // before the AST ever saw it, which is the silent hole this gate's #4772
    // note is about.
    if (!PREFILTER_TOKENS.some((token) => text.includes(token))) continue;
    const src = parseSourceFile(file, text);
    for (const unit of collectPluginUnits(file, src)) {
      if (!unit.pluginName && unit.nameRef) {
        unit.pluginName = resolveNameThroughImport(file, src, unit.nameRef, readSource);
      }
      units.push({ ...unit, reads: preBindReads(unit, src) });
    }
  }
  return units;
}

/**
 * The settings provider, DERIVED: the unit whose `providesServices` names the
 * settings service. Its own `dependencies` / `optionalDependencies` are the
 * plugins that can never be ordered after it.
 */
function findSettingsProvider(units) {
  for (const unit of units) {
    if (!unit.pluginName) continue;
    if ((unit.decl.providesServices ?? []).includes(SETTINGS_SERVICE)) {
      return {
        pluginName: unit.pluginName,
        file: unit.file,
        upstream: new Set([
          ...(unit.decl.dependencies ?? []),
          ...(unit.decl.optionalDependencies ?? []),
        ]),
      };
    }
  }
  return undefined;
}

const FIXABLE_ORIGIN = 'ready-hook-from-start';

/**
 * The verdict for one plugin's pre-bind reads:
 *   - 'self'                     — the settings provider reading its own service.
 *   - 'cycle'                    — the provider depends on THIS plugin; no edge
 *                                  can order it later. Reported, not an error.
 *   - 'declared'                 — names the provider in dependencies /
 *                                  optionalDependencies, and every read is in
 *                                  the sub-window that declaration repairs.
 *   - 'unfixable-by-declaration' — at least one read runs in init()/start() or
 *                                  in an init()-registered hook.
 *   - 'undeclared'               — a start()-registered hook read with no edge.
 */
function judgeUnit(unit, reads, provider) {
  if (unit.pluginName === provider.pluginName) return { verdict: 'self' };
  if (unit.pluginName && provider.upstream.has(unit.pluginName)) return { verdict: 'cycle' };

  const unfixable = reads.filter((r) => r.origin !== FIXABLE_ORIGIN);
  if (unfixable.length > 0) return { verdict: 'unfixable-by-declaration', reads: unfixable };

  const mentioned = new Set([
    ...(unit.decl.dependencies ?? []),
    ...(unit.decl.optionalDependencies ?? []),
  ]);
  // `requiresServices` deliberately does NOT satisfy this gate. It asserts the
  // service is REGISTERED before init() — which it always is, from the settings
  // plugin's own init() — and carries no ordering for start(). Accepting it
  // here would issue a green for a declaration that moves nothing.
  if (mentioned.has(provider.pluginName)) {
    return { verdict: 'declared', via: `dependencies/optionalDependencies → ${provider.pluginName}` };
  }
  return { verdict: 'undeclared', reads };
}

function auditUnits(units, providerOverride) {
  const provider = providerOverride ?? findSettingsProvider(units);
  const problems = [];
  const findings = [];
  if (!provider) return { problems, findings, provider };

  for (const unit of units) {
    if (unit.reads.length === 0) continue;
    const judged = judgeUnit(unit, unit.reads, provider);
    findings.push({ unit, ...judged });

    if (judged.verdict === 'undeclared') {
      const first = judged.reads[0];
      problems.push({
        plugin: unit.pluginName ?? unit.anchor,
        verdict: 'undeclared',
        text:
          `${unit.file}:${first.line} — ${unit.anchor}\n` +
          `    A '${READY_HOOK}' handler registered from start() resolves ` +
          `${first.accessor}('${SETTINGS_SERVICE}')\n` +
          `    (directly or through a helper it calls), and NOTHING declares that this plugin\n` +
          `    must start after '${provider.pluginName}'. Handlers run in REGISTRATION order, so\n` +
          `    under a composition that registers this plugin first the read lands in the\n` +
          `    pre-bind window: the in-memory fallback and the manifest defaults answer it,\n` +
          `    with source: 'default', while a persisted sys_setting row goes unread.\n` +
          `    Declare the ordering (ADR-0116):\n` +
          `      - optionalDependencies: ['${provider.pluginName}']   degrade-if-absent (the #10250 shape);\n` +
          `      - dependencies: ['${provider.pluginName}']           if this plugin cannot run without it.\n` +
          `    requiresServices does NOT repair this — it asserts registration, not start() order.`,
      });
    }

    if (judged.verdict === 'unfixable-by-declaration') {
      const first = judged.reads[0];
      problems.push({
        plugin: unit.pluginName ?? unit.anchor,
        verdict: 'unfixable-by-declaration',
        text:
          `${unit.file}:${first.line} — ${unit.anchor}\n` +
          `    ${first.accessor}('${SETTINGS_SERVICE}') runs in [${first.origin}], which is inside the\n` +
          `    pre-bind window under EVERY composition order: '${provider.pluginName}' binds its\n` +
          `    engine from its own '${READY_HOOK}' hook, strictly after every plugin's init() and\n` +
          `    start() and after every handler registered during init(). No dependency edge can\n` +
          `    move this read out of the window — do not add one and call it fixed.\n` +
          `    Move the read to 'kernel:bootstrapped' (the earliest safe phase, and the one\n` +
          `    SettingsService.reportPreBindRead names), or make it lazy so it resolves at\n` +
          `    first use rather than at boot.`,
      });
    }
  }
  return { problems, findings, provider };
}

/**
 * Apply the shrink-only ledger. Returns the problems that remain, plus the
 * ledger entries that no longer match anything — which are errors in their own
 * right, because a ledger that outlives its defect quietly re-admits it.
 */
function applyLedger(problems, ledger = KNOWN_PRE_BIND_READS) {
  const remaining = [];
  const used = new Set();
  for (const p of problems) {
    const hit = ledger.find((e) => e.plugin === p.plugin && e.verdict === p.verdict);
    if (hit) { used.add(hit); continue; }
    remaining.push(p);
  }
  const stale = ledger.filter((e) => !used.has(e));
  return { remaining, stale, ledgered: ledger.length - stale.length };
}

function audit() {
  const units = scan();
  const { problems, findings, provider } = auditUnits(units);

  if (!provider) {
    console.error(
      `✗ settings bind-window guard: no plugin unit declares providesServices: ['${SETTINGS_SERVICE}'].\n` +
      '  The provider is DERIVED, so this is not a missing hardcoded constant — either the\n' +
      "  settings plugin stopped declaring the service it provides, or the scan stopped\n" +
      '  reading its file. Both make every verdict below meaningless, so this refuses rather\n' +
      '  than reporting a green over an empty population.',
    );
    process.exit(1);
  }

  const { remaining, stale, ledgered } = applyLedger(problems);

  if (stale.length) {
    console.error('✗ settings bind-window guard: stale ledger entr(ies) in KNOWN_PRE_BIND_READS\n');
    for (const e of stale) {
      console.error(`  ${e.plugin} [${e.verdict}] (${e.issue}) is no longer a pre-bind read.`);
      console.error('    Delete the entry — the ledger is shrink-only, and one that outlives its\n' +
        '    defect silently re-admits the next instance of it.\n');
    }
    process.exit(1);
  }

  if (remaining.length) {
    console.error('✗ settings bind-window guard (#11045)\n');
    for (const p of remaining) console.error('  ' + p.text + '\n');
    console.error(`${remaining.length} settings read(s) in the pre-bind window with no declaration covering them.`);
    process.exit(1);
  }

  const declared = findings.filter((f) => f.verdict === 'declared').length;
  const cycle = findings.filter((f) => f.verdict === 'cycle').length;
  const self = findings.filter((f) => f.verdict === 'self').length;
  console.log(
    `✓ settings bind-window: ${declared} declared / ${self} self / ${cycle} structurally upstream / ` +
    `${ledgered} ledgered (${units.length} plugin unit(s) scanned, provider '${provider.pluginName}').`,
  );
}

function list() {
  const units = scan();
  const { findings, provider } = auditUnits(units);
  if (!provider) { console.log('(no settings provider found)'); return; }
  for (const f of findings) {
    for (const r of f.unit.reads) {
      const via = f.via ? `  [${f.via}]` : '';
      console.log(
        `${f.verdict.padEnd(25)}  ${f.unit.file}:${r.line}  ${f.unit.anchor} → ` +
        `${r.accessor}('${SETTINGS_SERVICE}')  <${r.origin}>${via}`,
      );
    }
  }
  if (findings.length === 0) console.log('(no pre-bind settings reads found)');
}

// ── Self-test ────────────────────────────────────────────────────────────────

function selfTest() {
  const assert = (cond, msg) => { if (!cond) { console.error('✗ self-test: ' + msg); process.exit(1); } };

  const auditSource = (code, ledger = []) => {
    const src = parseSourceFile('fixture.ts', code);
    const units = collectPluginUnits('fixture.ts', src).map((u) => ({ ...u, reads: preBindReads(u, src) }));
    const { problems, findings, provider } = auditUnits(units);
    const { remaining, stale } = applyLedger(problems, ledger);
    return { problems, remaining, stale, findings, provider, units };
  };

  /** The real shape of `SettingsServicePlugin`, reduced to what this gate reads. */
  const PROVIDER = `
    export class SettingsServicePlugin implements Plugin {
      name = 'com.objectstack.service.settings';
      providesServices = ['settings'];
      optionalDependencies = ['com.objectstack.engine.objectql'];
      async init(ctx: PluginContext) { ctx.registerService('settings', this.service); }
      async start(ctx: PluginContext) {
        ctx.hook('kernel:ready', async () => { this.service.bindEngine(ctx.getService('objectql')); });
      }
    }
  `;

  // 1. The provider is DERIVED from providesServices, not hardcoded.
  {
    const { provider } = auditSource(PROVIDER);
    assert(provider?.pluginName === 'com.objectstack.service.settings', 'provider is derived from providesServices');
    assert(provider.upstream.has('com.objectstack.engine.objectql'), "provider's own deps become the upstream set");
  }

  // 2. THE LOAD-BEARING CASE — the transitive arm, written so a depth-0-only
  //    walker FAILS it. This is `plugin-auth`'s live shape reduced: the hook
  //    handler is an arrow that calls a LOCAL const, which calls a class
  //    method, which calls another class method that does the read. Depth 3,
  //    and nothing resembling `getService('settings')` appears in the hook body.
  {
    const { problems } = auditSource(PROVIDER + `
      export class AuthPlugin implements Plugin {
        name = 'com.objectstack.auth';
        dependencies: string[] = ['com.objectstack.engine.objectql'];
        private ensureAuthSettingsBound(ctx: PluginContext) {
          this.authSettingsBinding ??= this.bindAuthSettings(ctx);
          return this.authSettingsBinding;
        }
        private async bindAuthSettings(ctx: PluginContext) {
          const settings = ctx.getService<SettingsReadSurface>('settings');
          await settings.getNamespace('auth');
        }
        async start(ctx: PluginContext) {
          const runBackfill = async (source: string) => {
            await this.ensureAuthSettingsBound(ctx);
          };
          ctx.hook('kernel:ready', () => runBackfill('kernel:ready'));
        }
      }
    `);
    assert(problems.length === 1, `the depth-3 transitive read is caught (got ${problems.length})`);
    assert(problems[0].verdict === 'undeclared', 'a start()-registered hook read is the declarable verdict');
    assert(problems[0].text.includes('com.objectstack.service.settings'), 'the message names the provider to declare');
  }

  // 2b. The same shape with the declaration present is green — the other
  //     direction of case 2, so a walker that simply never fires cannot pass
  //     both.
  {
    const { problems } = auditSource(PROVIDER + `
      export class AuthPlugin implements Plugin {
        name = 'com.objectstack.auth';
        optionalDependencies = ['com.objectstack.service.settings'];
        private async bindAuthSettings(ctx: PluginContext) { ctx.getService('settings'); }
        async start(ctx: PluginContext) {
          const run = async () => { await this.bindAuthSettings(ctx); };
          ctx.hook('kernel:ready', () => run());
        }
      }
    `);
    assert(problems.length === 0, 'the declaration makes the same transitive shape green');
  }

  // 3. `(ctx as any).hook(...)` — the registration form #10250's census
  //    mis-parsed on every site. To an AST it is an ordinary property access.
  {
    const { problems } = auditSource(PROVIDER + `
      export class CastHookPlugin implements Plugin {
        name = 'plugin.cast-hook';
        async start(ctx: PluginContext) {
          (ctx as any).hook('kernel:ready', async () => { ctx.getService('settings'); });
        }
      }
    `);
    assert(problems.length === 1, `(ctx as any).hook registration is parsed (got ${problems.length})`);
  }

  // 4. A multi-line function signature must stay in the definition index —
  //    `bootAutoEnqueue(` was the measured drop-out.
  {
    const { problems } = auditSource(PROVIDER + `
      function bootAutoEnqueue(
        ctx: PluginContext,
        logger: Logger,
      ): void {
        ctx.getService('settings');
      }
      export class MultilinePlugin implements Plugin {
        name = 'plugin.multiline';
        async start(ctx: PluginContext) {
          ctx.hook('kernel:ready', async () => { bootAutoEnqueue(ctx, ctx.logger); });
        }
      }
    `);
    assert(problems.length === 1, `a multi-line signature stays in the definition index (got ${problems.length})`);
  }

  // 5. `start = async (ctx) => {}` (the ObjectQLPlugin shape) is a lifecycle
  //    root like a method is.
  {
    const { problems } = auditSource(PROVIDER + `
      export class PropStartPlugin implements Plugin {
        name = 'plugin.prop-start';
        start = async (ctx: PluginContext) => {
          ctx.hook('kernel:ready', async () => { ctx.getService('settings'); });
        };
      }
    `);
    assert(problems.length === 1, `start-as-property is a lifecycle root (got ${problems.length})`);
  }

  // 6. Object-literal plugins (the createRestApiPlugin shape) are scanned too.
  {
    const { problems } = auditSource(PROVIDER + `
      export function createThingPlugin(): Plugin {
        return {
          name: 'plugin.object-literal',
          start: async (ctx: PluginContext) => {
            ctx.hook('kernel:ready', async () => { ctx.getService('settings'); });
          },
        };
      }
    `);
    assert(problems.length === 1, `an object-literal plugin is scanned (got ${problems.length})`);
  }

  // 7. `requiresServices: ['settings']` must NOT satisfy the gate — it asserts
  //    registration, which the provider's init() always does, and moves no
  //    start() order. Accepting it would issue a green for a no-op repair.
  {
    const { problems } = auditSource(PROVIDER + `
      export class RequiresOnlyPlugin implements Plugin {
        name = 'plugin.requires-only';
        requiresServices = ['settings'];
        async start(ctx: PluginContext) {
          ctx.hook('kernel:ready', async () => { ctx.getService('settings'); });
        }
      }
    `);
    assert(problems.length === 1, 'requiresServices does not satisfy the ordering requirement');
  }

  // 8. A read in start()'s own body, and one in an init()-registered hook, are
  //    the unfixable-by-declaration class — DECLARED OR NOT. The second half is
  //    the point: a gate that accepted the declaration here would bless a
  //    repair that cannot work.
  {
    const { problems } = auditSource(PROVIDER + `
      export class StartBodyPlugin implements Plugin {
        name = 'plugin.start-body';
        optionalDependencies = ['com.objectstack.service.settings'];
        async start(ctx: PluginContext) { const s = ctx.getService('settings'); await s.getMany('localization', []); }
      }
    `);
    assert(problems.length === 1, 'a start()-body read is flagged even with the declaration');
    assert(problems[0].verdict === 'unfixable-by-declaration', 'a start()-body read gets the move-it remedy');
    assert(problems[0].text.includes("kernel:bootstrapped"), 'the message names the earliest safe phase');
  }
  {
    const { problems } = auditSource(PROVIDER + `
      export class InitHookPlugin implements Plugin {
        name = 'plugin.init-hook';
        optionalDependencies = ['com.objectstack.service.settings'];
        async init(ctx: PluginContext) {
          ctx.hook('kernel:ready', async () => { ctx.getService('settings'); });
        }
      }
    `);
    assert(problems.length === 1, 'an init()-registered hook read is flagged even with the declaration');
    assert(problems[0].verdict === 'unfixable-by-declaration', 'an init()-registered hook read gets the move-it remedy');
  }

  // 9. A closure DEFINED in the hook but handed to a collaborator is not a
  //    read in the window — `plugin-audit`'s getLocale, `rest`'s
  //    settingsServiceProvider, `ObjectQLPlugin`'s getSettings.
  {
    const { problems } = auditSource(PROVIDER + `
      export class DeferredClosurePlugin implements Plugin {
        name = 'plugin.deferred-closure';
        async start(ctx: PluginContext) {
          ctx.hook('kernel:ready', async () => {
            const getLocale = async () => { return ctx.getService('settings'); };
            installAuditWriters(engine, this.name, { getLocale });
          });
        }
      }
    `);
    assert(problems.length === 0, 'a closure handed to a collaborator is not a read in the window');
  }

  // 10. A plugin the PROVIDER depends on cannot be ordered after it — verdict
  //     'cycle', reported and not an error. Measured with the real
  //     resolvePluginOrder: the reverse edge throws "Circular dependency
  //     detected". Derived from the provider's declarations, so changing them
  //     changes this set.
  {
    const { problems, findings } = auditSource(PROVIDER + `
      export class ObjectQLPlugin implements Plugin {
        name = 'com.objectstack.engine.objectql';
        providesServices = ['objectql', 'data', 'manifest'];
        start = async (ctx: PluginContext) => {
          ctx.hook('kernel:ready', async () => {
            const settings = ctx.getService('settings');
            settings?.registerManifest?.(lifecycleSettingsManifest);
          });
        };
      }
    `);
    assert(problems.length === 0, 'a plugin the provider depends on is not an error');
    assert(findings.some((f) => f.verdict === 'cycle'), "it is reported as 'cycle', not dropped");
  }

  // 11. The provider reading its own service is not an edge.
  {
    const { problems, findings } = auditSource(`
      export class SettingsServicePlugin implements Plugin {
        name = 'com.objectstack.service.settings';
        providesServices = ['settings'];
        async start(ctx: PluginContext) {
          ctx.hook('kernel:ready', async () => { ctx.getService('settings'); });
        }
      }
    `);
    assert(problems.length === 0, 'the provider reading its own service is not an edge');
    assert(findings.some((f) => f.verdict === 'self'), "it is reported as 'self'");
  }

  // 12. A read of some OTHER service in a start()-registered hook is not this
  //     gate's business — the window is a property of the settings provider.
  {
    const { problems } = auditSource(PROVIDER + `
      export class OtherServicePlugin implements Plugin {
        name = 'plugin.other';
        async start(ctx: PluginContext) {
          ctx.hook('kernel:ready', async () => { ctx.getService('i18n').loadTranslations('en', {}); });
        }
      }
    `);
    assert(problems.length === 0, 'a non-settings lookup is not flagged');
  }

  // 13. The whole accessor vocabulary is live, not just getService. #4772 shipped
  //     an undeclared getServiceAsync through the sibling gate that knew one name.
  for (const accessor of ['getService', 'getServiceAsync', 'getServiceScoped']) {
    const { problems } = auditSource(PROVIDER + `
      export class VocabPlugin implements Plugin {
        name = 'plugin.vocab';
        async start(ctx: PluginContext) {
          ctx.hook('kernel:ready', async () => { ctx.${accessor}('settings', 'scope'); });
        }
      }
    `);
    assert(problems.length === 1, `${accessor} is in the vocabulary (got ${problems.length})`);
  }

  // 14. Mutually recursive helpers terminate and still report.
  {
    const { problems } = auditSource(PROVIDER + `
      export class LoopPlugin implements Plugin {
        name = 'plugin.loop';
        private a(ctx: PluginContext) { this.b(ctx); }
        private b(ctx: PluginContext) { this.a(ctx); ctx.getService('settings'); }
        async start(ctx: PluginContext) { ctx.hook('kernel:ready', async () => { this.a(ctx); }); }
      }
    `);
    assert(problems.length === 1, 'mutually recursive helpers terminate and still report');
  }

  // 15. The ledger suppresses a matching problem, and ONLY a matching one: an
  //     entry whose verdict differs does not cover it. Two different repairs
  //     must not be closed by one entry.
  {
    const code = PROVIDER + `
      export class StartBodyPlugin implements Plugin {
        name = 'plugin.start-body';
        async start(ctx: PluginContext) { ctx.getService('settings'); }
      }
    `;
    const matching = auditSource(code, [{ plugin: 'plugin.start-body', verdict: 'unfixable-by-declaration', issue: '#0' }]);
    assert(matching.remaining.length === 0, 'a matching ledger entry suppresses the problem');
    assert(matching.stale.length === 0, 'a matching ledger entry is not stale');

    const mismatched = auditSource(code, [{ plugin: 'plugin.start-body', verdict: 'undeclared', issue: '#0' }]);
    assert(mismatched.remaining.length === 1, 'a ledger entry for a different verdict does not cover it');
    assert(mismatched.stale.length === 1, 'and the mismatched entry is reported stale');
  }

  // 16. A ledger entry with nothing to suppress is an ERROR — a ledger that
  //     outlives its defect silently re-admits the next instance.
  {
    const { stale } = auditSource(PROVIDER, [{ plugin: 'plugin.gone', verdict: 'undeclared', issue: '#0' }]);
    assert(stale.length === 1, 'a ledger entry with no matching problem is stale');
  }

  console.log(`✓ settings bind-window guard self-test: all cases pass.`);
}

// ── Entry ────────────────────────────────────────────────────────────────────

const arg = process.argv[2];
if (arg === '--self-test') selfTest();
else if (arg === '--list') list();
else audit();
