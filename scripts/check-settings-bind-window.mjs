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
 *  - `init-body` / `start-body` / `ready-hook-from-init` /
 *    `<hook>-hook-from-<phase>` — NOT FIXABLE BY DECLARATION, and the reason is
 *    worth stating because a gate that printed the declaration remedy here
 *    would be giving advice that cannot work: the bind happens in the settings
 *    plugin's OWN `kernel:ready` hook, which is strictly after every plugin's
 *    `init()` and `start()`, after every handler registered during `init()`,
 *    and after every handler of a hook those phases FIRE. No ordering edge can
 *    move a read in those phases out of the window. The repair is to move the
 *    read to `kernel:bootstrapped` (the earliest safe phase — the same one
 *    `reportPreBindRead`'s message names) or to make it lazy so it resolves at
 *    first use.
 *
 * The fired hooks are the third sub-window, and the one this gate was blind to
 * until #22316: `AppPlugin.start()` fires `app:seeded` when its inline seed
 * lands, so an `app:seeded` handler registered from `start()` ran during Phase
 * 2 — and `plugin-auth`'s did, reading the `auth` namespace from the manifest
 * defaults on every seeded boot while this gate printed green. Which hooks
 * belong here is DERIVED from the fire sites and pinned in
 * {@link PRE_BIND_HOOKS}; a handler of one of them registered from inside a
 * `kernel:ready` handler inherits THAT handler's window instead, because it
 * cannot exist before the registering handler runs — which is also the
 * structural way to keep such a handler out of the window.
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
 *     FAILS it. `runBackfill` has since come to serialize its runs through
 *     `backfillChain.then(async () => { … })`, which puts that call inside a
 *     promise continuation — see the next paragraph for why it is entered.
 *
 * Nested function bodies are deliberately NOT entered — with ONE exception, a
 * promise continuation: the callback of `.then` / `.catch` / `.finally`
 * ({@link PROMISE_CONTINUATIONS}) runs when a promise the phase started
 * settles, and the kernel awaits each handler before the next, so it runs in
 * the window the walk is in. Measured at `4e4111ca0`, entering continuations
 * adds exactly one read to the population — `plugin-auth`'s `app:seeded` path
 * above, the read `[SettingsService] Pre-bind READ` logged — and no other.
 * Any OTHER closure defined inside a hook and handed to a collaborator runs
 * when that collaborator calls it, not during the hook. `plugin-audit`'s `getLocale`
 * (`packages/plugins/plugin-audit/src/audit-plugin.ts`, line 200 as measured)
 * is the measured case — it is passed to `installAuditWriters` and invoked from
 * `packages/plugins/plugin-audit/src/audit-writers.ts#resolveWriteLocale` on
 * CRUD writes (line 781 as measured), i.e. long after
 * the window closed. `packages/rest`'s `settingsServiceProvider` and
 * `ObjectQLPlugin`'s `getSettings` are the same shape.
 *
 * ## Usage
 *
 *     node scripts/check-settings-bind-window.mjs             # audit the repo
 *     node scripts/check-settings-bind-window.mjs --list      # print every read
 *     node scripts/check-settings-bind-window.mjs --self-test # verify the checker
 */

// dispatch-gates: wide-population -- walk(join(ROOT, 'packages')) admits every non-test .ts source under the packages root -- 2182 of 5837 tracked files (37.4%, base 2aa8456cf), recorded REFUSE-WIDE in CENSUS_REFUSE_WIDE in scripts/pm/bare-root-worklist.mjs, the identical corpus its three census siblings walk. The population is every source in that root, so the only true subtree spelling is the bare root and it would name this gate on every card touching a package.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { requireDefaultExport } from './import-prerequisite.mjs';
const ts = await requireDefaultExport('typescript', () => import('typescript'), import.meta.url);
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
 * The hooks a PLUGIN fires during Phase 1 / Phase 2 — from its own `init()` or
 * `start()` — and therefore before the kernel triggers {@link READY_HOOK} at
 * all. A handler of one of these registered from `init()` / `start()` runs
 * before the settings bind whenever the hook fires in that phase, under every
 * composition order (`app:seeded` fires there for an in-budget seed and after
 * `kernel:ready` for one that overran its budget; the rest fire there always),
 * so its settings reads belong to this gate's population exactly as an
 * `init()` / `start()` body does.
 *
 * The kernel never fires these; plugins do, so the list is not knowable from
 * `packages/core`. It is NOT hand-trusted either: `audit()` re-derives the set
 * from the source on every run — every `.trigger('<name>', …)` and
 * `trigger.call(<ctx>, '<name>', …)` the walk below reaches from a plugin's
 * `init()` / `start()` or from a pre-bind handler — and refuses on drift in
 * EITHER direction: a newly fired name that is missing here (its handlers would
 * fall outside the population, the hole `app:seeded` sat in), and a pinned name
 * no longer fired before the bind (a stale pin, and the anti-vacuity limb — a
 * scan that finds no emit at all stales every row). Each value is the emit site
 * the derivation found, so a reader can check the row without re-running it.
 * All eight were derived from Phase 1/2 bodies at `4e4111ca0`; a hook fired
 * from a `kernel:ready` handler would be derived too and is judged the same
 * way — conservatively, since it precedes the bind only when its emitter's
 * handler does.
 */
const PRE_BIND_HOOKS = Object.freeze({
  'app:registered':
    'packages/runtime/src/app-plugin.ts — AppPlugin.start() → this.emitCatalogEvent(ctx, \'app:registered\', sys) → trigger.call(ctx, event, payload)',
  'app:seeded':
    'packages/runtime/src/app-plugin.ts — AppPlugin.start() → emitSeedSettled(false), the in-budget inline seed → trigger.call(ctx, \'app:seeded\', …)',
  'auth:configure':
    'packages/plugins/plugin-auth/src/auth-plugin.ts — AuthPlugin.init() → ctx.trigger(\'auth:configure\', authConfig, ctx)',
  'automation:ready':
    'packages/services/service-automation/src/plugin.ts — AutomationServicePlugin.start() → ctx.trigger(\'automation:ready\', this.engine)',
  'analytics:ready':
    'packages/services/service-analytics/src/plugin.ts — AnalyticsServicePlugin.start() → ctx.trigger(\'analytics:ready\', this.service)',
  'datasource-admin:ready':
    'packages/services/service-datasource/src/datasource-admin-plugin.ts — DatasourceAdminServicePlugin.start() → ctx.trigger(\'datasource-admin:ready\', this.service)',
  'external-datasource:ready':
    'packages/services/service-datasource/src/plugin.ts — ExternalDatasourceServicePlugin.start() → ctx.trigger(\'external-datasource:ready\', this.service)',
  'mcp:ready':
    'packages/mcp/src/plugin.ts — MCPServerPlugin.start() → ctx.trigger(\'mcp:ready\', this.runtime)',
});

/** The method a plugin context fires a hook through. */
const EMIT_CALLEE = 'trigger';

/**
 * The promise methods whose callback argument is a CONTINUATION of the phase
 * the walk is in — see "Nested function bodies" in the header.
 */
const PROMISE_CONTINUATIONS = new Set(['then', 'catch', 'finally']);

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

/**
 * Tokens whose absence proves a file can contribute nothing — see `scan()`.
 * `EMIT_CALLEE` is here because a file that fires a pre-bind hook contributes
 * to the population's DERIVATION even when it reads no service itself.
 */
const PREFILTER_TOKENS = [...SERVICE_LOOKUP_CALLEES, 'providesServices', EMIT_CALLEE];

/**
 * Pre-bind reads that are KNOWN, MEASURED and owned by another card.
 *
 * This ledger is shrink-only in both directions: an entry that stops being a
 * problem is an ERROR here (delete it in the PR that fixes it), and a new
 * offender cannot be admitted without editing this file. It exists because
 * #11045 is the GATE card — the two live readers it carried were found by that
 * card's step-1 measurement and routed to their owning lanes rather than fixed
 * here, so landing the gate without them would have meant landing it red.
 *
 * **It is now EMPTY, and that is the burned-down state, not a disabled gate.**
 * Both entries were deleted by the PRs that repaired their sites —
 * `com.objectstack.auth` (#11579, the ordering declaration) and
 * `com.objectstack.mcp` (#11580, the read moved to `kernel:bootstrapped`). An
 * empty array suppresses nothing, so every pre-bind read the scan finds from
 * here on is reported. Re-admitting one is a ratchet weakening and needs the
 * same scrutiny as raising any other baseline in this repo.
 *
 * Keyed by plugin id + verdict, because two entries can need DIFFERENT repairs
 * and a single "known bad" bucket would let one be closed by the other's fix.
 */
const KNOWN_PRE_BIND_READS = [];

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
 * the remedy) — plus every hook the same walk sees FIRED, which is what
 * `audit()` derives {@link PRE_BIND_HOOKS} from.
 *
 * The walk starts at `init()` and `start()`, follows same-class `this.m(...)`,
 * same-file free functions and local block-scoped bindings transitively, and
 * does NOT descend into nested function bodies. Every `<expr>.hook(name,
 * handler)` it passes for a name in `hookNames` (the ready hook plus the
 * pre-bind hooks) hands `handler` to a second walk of the same kind:
 *
 *  - `kernel:ready` registered from a lifecycle body → `ready-hook-from-<phase>`;
 *  - a pre-bind hook registered from a lifecycle body → `<name>-hook-from-<phase>`,
 *    which is never the fixable origin — the hook fires before `kernel:ready`;
 *  - ANY of them registered from inside a handler → that handler's own origin,
 *    because it can only run once the registering handler has.
 *
 * A hook is fired by `.trigger` on the PLUGIN CONTEXT (or `trigger.call` with
 * the context as `this`). Its name is a string literal, or a parameter the call
 * site bound to one (`emitCatalogEvent(ctx, 'app:registered', sys)` reaches
 * `trigger.call(ctx, event, payload)`); anything else is recorded UNRESOLVED,
 * and `audit()` refuses on it rather than derive a population it cannot name.
 */
function preBindReads(unit, src, hookNames = new Set([READY_HOOK, ...Object.keys(PRE_BIND_HOOKS)])) {
  const reads = [];
  const emits = [];

  /** Local (block-scoped) function bindings seen anywhere along the walk. */
  const locals = new Map();

  // The PLUGIN CONTEXT, by the names it travels under: the lifecycle methods'
  // first parameter, every helper parameter a call site hands it to, and every
  // `this.X = <context>` field. Only a `.trigger` on the context fires a kernel
  // hook — a job or flow service's `.trigger(name)` is not one, and reading it
  // as one would refuse a correct plugin with a remedy that does not apply.
  const contextNames = new Set();
  const contextFields = new Set();
  for (const phase of ['init', 'start']) {
    const p = unit.methods.get(phase)?.parameters?.[0];
    if (p && ts.isIdentifier(p.name)) contextNames.add(p.name.text);
  }
  const unwrap = (node) => {
    let n = node;
    while (n && (ts.isParenthesizedExpression(n) || ts.isAsExpression(n) ||
      ts.isNonNullExpression(n) || ts.isTypeAssertionExpression(n))) n = n.expression;
    return n;
  };
  const isContext = (node) => {
    const n = unwrap(node);
    if (!n) return false;
    if (ts.isIdentifier(n)) return contextNames.has(n.text);
    return ts.isPropertyAccessExpression(n) && n.expression.kind === ts.SyntaxKind.ThisKeyword &&
      contextFields.has(n.name.text);
  };
  for (const method of unit.methods.values()) {
    const scanFields = (node) => {
      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
        ts.isPropertyAccessExpression(node.left) && node.left.expression.kind === ts.SyntaxKind.ThisKeyword &&
        isContext(node.right)) {
        contextFields.add(node.left.name.text);
      }
      ts.forEachChild(node, scanFields);
    };
    if (method.body) scanFields(method.body);
  }

  const walk = (fnNode, origin, visited, onHook, bindings = new Map()) => {
    if (!fnNode) return;
    // Keyed on the node AND its string bindings: one helper reached twice with
    // two different literal arguments fires two different hooks.
    const key = bindings.size ? `${fnNode.pos}:${JSON.stringify([...bindings])}` : fnNode;
    if (visited.has(key)) return;
    visited.add(key);
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

    /** A string-literal argument, or a parameter this call frame bound to one. */
    const resolveString = (node) => {
      if (!node) return undefined;
      if (ts.isStringLiteralLike(node)) return node.text;
      if (ts.isIdentifier(node)) return bindings.get(node.text);
      return undefined;
    };

    /** The callee's parameters bound to whatever string arguments resolve —
     *  and, unit-wide, the parameters it receives the context through. */
    const bindArgs = (target, args) => {
      const out = new Map();
      (target.parameters ?? []).forEach((p, i) => {
        if (!ts.isIdentifier(p.name)) return;
        if (isContext(args[i])) contextNames.add(p.name.text);
        const value = resolveString(args[i]);
        if (value !== undefined) out.set(p.name.text, value);
      });
      return out;
    };

    const recordEmit = (nameArg, node) => {
      const line = src.getLineAndCharacterOfPosition(node.getStart(src)).line + 1;
      const name = resolveString(nameArg);
      emits.push(name === undefined
        ? { name: undefined, unresolved: nameArg ? nameArg.getText(src) : '(no argument)', origin, line }
        : { name, origin, line });
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
          // `<anything>.hook(name, handler)` — `ctx.hook`, `(ctx as any).hook`,
          // `this.ctx.hook` and the optional-call form all land here.
          if (callee.name.text === 'hook' && onHook) {
            const [nameArg, handlerArg] = node.arguments;
            if (nameArg && ts.isStringLiteralLike(nameArg) && hookNames.has(nameArg.text)) {
              const handler = resolveCallable(handlerArg);
              if (handler) onHook(nameArg.text, handler);
            }
          }
          // `<context>.trigger(name, …)` — the hook is FIRED here.
          if (callee.name.text === EMIT_CALLEE && isContext(callee.expression)) {
            recordEmit(node.arguments[0], node);
          }
          // `trigger.call(<context>, name, …)` — AppPlugin's spelling, which
          // reads the method off the context first so a kernel without one
          // is a no-op rather than a throw. The context is the `this` argument.
          if (callee.name.text === 'call' && isContext(node.arguments[0]) &&
            ((ts.isIdentifier(callee.expression) && callee.expression.text === EMIT_CALLEE) ||
              (ts.isPropertyAccessExpression(callee.expression) && callee.expression.name.text === EMIT_CALLEE))) {
            recordEmit(node.arguments[1], node);
          }
          // `<promise>.then(cb)` / `.catch(cb)` / `.finally(cb)` → `cb` is a
          // CONTINUATION, the one nested function this walk does enter: it runs
          // when a promise the phase started settles, and the kernel awaits
          // every handler in turn, so it runs inside the same window. A closure
          // handed to any OTHER callee still runs at that callee's discretion.
          if (PROMISE_CONTINUATIONS.has(callee.name.text)) {
            for (const arg of node.arguments) {
              const continuation = resolveCallable(arg);
              // A closure sees its enclosing frame, parameters included.
              if (continuation) walk(continuation, origin, visited, onHook, bindings);
            }
          }
          // `this.m(...)` → same-class method or function-valued property.
          if (callee.expression.kind === ts.SyntaxKind.ThisKeyword) {
            const target = unit.methods.get(callee.name.text);
            if (target) walk(target, origin, visited, onHook, bindArgs(target, node.arguments));
          }
        }

        // `f(...)` → local binding first (inner scope wins), then same-file.
        if (ts.isIdentifier(callee)) {
          const target = locals.get(callee.text) ?? unit.fileFunctions.get(callee.text);
          if (target) walk(target, origin, visited, onHook, bindArgs(target, node.arguments));
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
    /** [handler, origin] — origin decided by WHAT registered it, see above. */
    const handlers = [];
    walk(root, bodyOrigin, new Set(), (name, h) => {
      handlers.push([h, name === READY_HOOK ? hookOrigin : `${name}-hook-from-${phase}`]);
    });
    // Handlers registered by a handler inherit the registering handler's window.
    for (let i = 0; i < handlers.length; i++) {
      const [handler, origin] = handlers[i];
      walk(handler, origin, new Set(), (_name, h) => handlers.push([h, origin]));
    }
  }

  // One read reached along two paths is one read.
  const seen = new Set();
  const uniqueReads = reads.filter((r) => {
    const k = `${r.line}|${r.origin}|${r.accessor}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return { reads: uniqueReads, emits };
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
      units.push({ ...unit, ...preBindReads(unit, src) });
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
      const hook = Object.keys(PRE_BIND_HOOKS).find((h) => first.origin.startsWith(`${h}-hook-from-`));
      problems.push({
        plugin: unit.pluginName ?? unit.anchor,
        verdict: 'unfixable-by-declaration',
        text:
          `${unit.file}:${first.line} — ${unit.anchor}\n` +
          `    ${first.accessor}('${SETTINGS_SERVICE}') runs in [${first.origin}], which is inside the\n` +
          `    pre-bind window under EVERY composition order: '${provider.pluginName}' binds its\n` +
          `    engine from its own '${READY_HOOK}' hook, strictly after every plugin's init() and\n` +
          `    start(), after every handler registered during init(), and after every handler of\n` +
          `    a hook those phases fire. No dependency edge can move this read out of the window —\n` +
          `    do not add one and call it fixed.\n` +
          `    Move the read to 'kernel:bootstrapped' (the earliest safe phase, and the one\n` +
          `    SettingsService.reportPreBindRead names), or make it lazy so it resolves at\n` +
          `    first use rather than at boot.` +
          (hook
            ? `\n    '${hook}' fires before '${READY_HOOK}' — ${PRE_BIND_HOOKS[hook]}.\n` +
              `    If the handler is only meant to act after the bind, register it from this plugin's own\n` +
              `    start()-registered '${READY_HOOK}' handler (with the ordering on '${provider.pluginName}'\n` +
              `    declared): it then cannot exist before the bind, and this gate can see that. A runtime\n` +
              `    flag that makes the early calls no-ops is invisible to it.`
            : ''),
      });
    }
  }
  return { problems, findings, provider };
}

/**
 * The pre-bind hooks, DERIVED from the source: every hook name the walk saw
 * FIRED. Emits are recorded only along walks rooted at `init()` / `start()` or
 * at a handler of a pre-bind hook, so every recorded emit fires before the bind
 * under at least one composition order. `READY_HOOK` itself is the kernel's,
 * fired after Phase 2, and is never a derived name.
 */
function derivePreBindHooks(units) {
  /** name → the sites that fire it */
  const fired = new Map();
  const unresolved = [];
  for (const unit of units) {
    for (const e of unit.emits ?? []) {
      const site = { file: unit.file, line: e.line, anchor: unit.anchor, origin: e.origin };
      if (e.name === undefined) { unresolved.push({ ...site, text: e.unresolved }); continue; }
      if (e.name === READY_HOOK) continue;
      if (!fired.has(e.name)) fired.set(e.name, []);
      fired.get(e.name).push(site);
    }
  }
  return { fired, unresolved };
}

/**
 * Hold {@link PRE_BIND_HOOKS} equal to the derivation, in both directions.
 * `missing` — fired before the bind and absent from the pin, so its handlers
 * are outside the population; `stalePins` — pinned and no longer fired, which
 * is also what an empty derivation produces (the anti-vacuity limb);
 * `unresolved` — a fire site whose hook name this walk cannot name.
 */
function reconcilePreBindHooks(derived, pinned = PRE_BIND_HOOKS) {
  return {
    missing: [...derived.fired.keys()].filter((n) => !Object.hasOwn(pinned, n)).sort(),
    stalePins: Object.keys(pinned).filter((n) => !derived.fired.has(n)).sort(),
    unresolved: derived.unresolved,
  };
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

  // The population's hook list is held equal to the fire sites BEFORE any
  // verdict is trusted: a hook missing from it is a set of handlers this run
  // never walked, so a green below would be a green over an unnamed hole.
  const derived = derivePreBindHooks(units);
  const drift = reconcilePreBindHooks(derived);
  if (drift.missing.length || drift.stalePins.length || drift.unresolved.length) {
    console.error('✗ settings bind-window guard: PRE_BIND_HOOKS does not match the hooks the source fires before the bind\n');
    for (const name of drift.missing) {
      for (const s of derived.fired.get(name)) {
        console.error(`  ${s.file}:${s.line} — ${s.anchor} fires '${name}' in [${s.origin}]`);
      }
      console.error(
        `    '${name}' fires before '${READY_HOOK}', so its handlers run before the settings bind, and it is\n` +
        '    not in PRE_BIND_HOOKS — none of its handlers is in this gate\'s population. Add it, with\n' +
        '    the fire site above as its value.\n',
      );
    }
    for (const name of drift.stalePins) {
      console.error(
        `  '${name}' is pinned in PRE_BIND_HOOKS (${PRE_BIND_HOOKS[name]}),\n` +
        '    but no plugin\'s init() / start() fires it any more. Delete the row if the emit moved\n' +
        '    out of Phase 1/2 or was removed. If EVERY pinned row reads stale, the walk stopped\n' +
        '    seeing fire sites at all, and the population this run judged is empty.\n',
      );
    }
    for (const s of drift.unresolved) {
      console.error(
        `  ${s.file}:${s.line} — ${s.anchor} fires a hook named by \`${s.text}\` in [${s.origin}]\n` +
        '    The name is neither a string literal nor a parameter its caller bound to one, so this\n' +
        '    gate cannot tell whether its handlers belong to the population. Pass the name as a\n' +
        '    literal at the call site.\n',
      );
    }
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
    `${ledgered} ledgered (${units.length} plugin unit(s) scanned, ${derived.fired.size} pre-bind hook(s) ` +
    `fired = pinned, provider '${provider.pluginName}').`,
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
  const { fired, unresolved } = derivePreBindHooks(units);
  for (const [name, sites] of [...fired].sort(([a], [b]) => a.localeCompare(b))) {
    const pin = Object.hasOwn(PRE_BIND_HOOKS, name) ? 'pinned  ' : 'UNPINNED';
    for (const s of sites) console.log(`fires ${pin}  ${name.padEnd(26)} ${s.file}:${s.line}  ${s.anchor}  <${s.origin}>`);
  }
  for (const s of unresolved) console.log(`fires UNRESOLVED  ${s.text}  ${s.file}:${s.line}  ${s.anchor}  <${s.origin}>`);
}

// ── Self-test ────────────────────────────────────────────────────────────────

// Set by `selfTest()` only after a verdict is printed -- either verdict -- and
// read at the dispatch below: a `return` that leaves the function above those
// lines prints nothing and still exits 0, so a self-test that never finished
// reports as one that passed. The self-test's own exit code stays load-bearing,
// so the handshake is a flag rather than a returned sentinel. The failure path
// sets it too: the refusal below must fire only when NEITHER verdict was
// printed, never on a genuine red that already said what failed.
let selfTestReachedVerdict = false;

function selfTest() {
  const assert = (cond, msg) => { if (!cond) { console.error('✗ self-test: ' + msg); process.exit(1); } };

  const auditSource = (code, ledger = []) => {
    const src = parseSourceFile('fixture.ts', code);
    const units = collectPluginUnits('fixture.ts', src).map((u) => ({ ...u, ...preBindReads(u, src) }));
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

  // 17. POSITIVE CONTROL — the reader this gate missed: `plugin-auth` before
  //     its fix, reduced. The `app:seeded` handler is registered in start(),
  //     the plugin DECLARES the ordering, and the read sits inside a
  //     `backfillChain.then(async () => …)` continuation, three calls down.
  //     It needs BOTH arms to go red: a walker without `app:seeded` in its
  //     population scores it 'declared' (the kernel:ready path), and a walker
  //     that does not enter continuations finds no read at all.
  {
    const { problems, units } = auditSource(PROVIDER + `
      export class AuthPlugin implements Plugin {
        name = 'com.objectstack.auth';
        optionalDependencies = ['com.objectstack.service.settings'];
        private ensureAuthSettingsBound(ctx: PluginContext) {
          this.authSettingsBinding ??= this.bindAuthSettings(ctx);
          return this.authSettingsBinding;
        }
        private async bindAuthSettings(ctx: PluginContext) {
          const settings = ctx.getService<SettingsReadSurface>('settings');
          await settings.getNamespace('auth');
        }
        async start(ctx: PluginContext) {
          let backfillChain: Promise<void> = Promise.resolve();
          const runBackfill = (source: string): Promise<void> => {
            backfillChain = backfillChain.then(async () => {
              await this.ensureAuthSettingsBound(ctx);
            });
            return backfillChain;
          };
          ctx.hook('kernel:ready', () => runBackfill('kernel:ready'));
          ctx.hook('app:seeded', () => runBackfill('app:seeded'));
        }
      }
    `);
    assert(problems.length === 1, `the pre-fix plugin-auth app:seeded reader is red (got ${problems.length})`);
    assert(problems[0].verdict === 'unfixable-by-declaration', 'a pre-bind-hook read is not repaired by the declaration it already has');
    const auth = units.find((u) => u.anchor === 'AuthPlugin');
    assert(auth.reads.some((r) => r.origin === 'app:seeded-hook-from-start'), 'the read is attributed to the app:seeded handler');
    assert(auth.reads.some((r) => r.origin === 'ready-hook-from-start'), 'the kernel:ready path through the continuation is seen too');
    assert(problems[0].text.includes("'app:seeded' fires before 'kernel:ready'"), 'the message names the hook and its fire site');
  }

  // 17b. Each arm on its own, so a regression in one cannot hide behind the
  //      other: the hook population with a direct call path, and a
  //      continuation inside a plain kernel:ready handler.
  {
    const { problems } = auditSource(PROVIDER + `
      export class SeededDirectPlugin implements Plugin {
        name = 'plugin.seeded-direct';
        optionalDependencies = ['com.objectstack.service.settings'];
        private readPolicy(ctx: PluginContext) { return ctx.getService('settings'); }
        async start(ctx: PluginContext) { ctx.hook('app:seeded', () => this.readPolicy(ctx)); }
      }
    `);
    assert(problems.length === 1, `an app:seeded handler with a direct read is red (got ${problems.length})`);
  }
  {
    const { problems } = auditSource(PROVIDER + `
      export class ContinuationPlugin implements Plugin {
        name = 'plugin.continuation';
        async start(ctx: PluginContext) {
          ctx.hook('kernel:ready', () => warmUp().then(async () => { ctx.getService('settings'); }));
        }
      }
    `);
    assert(problems.length === 1, `a read in a .then continuation is a read in the handler (got ${problems.length})`);
    assert(problems[0].verdict === 'undeclared', 'and it keeps the handler\'s own sub-window');
  }

  // 18. NEGATIVE CONTROL — a reader after the bind stays green.
  //     `kernel:bootstrapped` fires once every kernel:ready handler, the bind
  //     included, has settled; it is not in the population at all.
  {
    const { problems, findings } = auditSource(PROVIDER + `
      export class AfterBindPlugin implements Plugin {
        name = 'plugin.after-bind';
        async start(ctx: PluginContext) {
          ctx.hook('kernel:bootstrapped', async () => { await ctx.getService('settings').getNamespace('auth'); });
        }
      }
    `);
    assert(problems.length === 0 && findings.length === 0, 'a kernel:bootstrapped reader is outside the window');
  }

  // 18b. The structural repair the message prescribes: the app:seeded handler
  //      registered from the plugin's own start()-registered kernel:ready
  //      handler inherits THAT window — green with the declaration, the
  //      declarable verdict without it.
  {
    const shape = (decl) => PROVIDER + `
      export class ArmedPlugin implements Plugin {
        name = 'plugin.armed';
        ${decl}
        async start(ctx: PluginContext) {
          ctx.hook('kernel:ready', () => {
            ctx.hook('app:seeded', async () => { ctx.getService('settings'); });
          });
        }
      }
    `;
    const declared = auditSource(shape("optionalDependencies = ['com.objectstack.service.settings'];"));
    assert(declared.problems.length === 0, 'an app:seeded handler registered from a declared ready handler is green');
    assert(declared.findings.some((f) => f.verdict === 'declared'), 'and it is reported as declared, not dropped');
    const undeclared = auditSource(shape(''));
    assert(undeclared.problems.length === 1 && undeclared.problems[0].verdict === 'undeclared',
      'without the declaration it is the declarable verdict');
  }

  // 19. Every pinned hook name is live in the population — enumerated from the
  //     pin itself, so a row added there is exercised here with no edit — and
  //     the row this gate once missed cannot be deleted quietly.
  {
    const pinned = Object.keys(PRE_BIND_HOOKS);
    assert(pinned.includes('app:seeded'), "PRE_BIND_HOOKS still names 'app:seeded'");
    for (const hook of pinned) {
      for (const phase of ['init', 'start']) {
        const { problems, units } = auditSource(PROVIDER + `
          export class HookReaderPlugin implements Plugin {
            name = 'plugin.hook-reader';
            optionalDependencies = ['com.objectstack.service.settings'];
            async ${phase}(ctx: PluginContext) {
              ctx.hook('${hook}', async () => { ctx.getService('settings'); });
            }
          }
        `);
        assert(problems.length === 1 && problems[0].verdict === 'unfixable-by-declaration',
          `a '${hook}' handler registered from ${phase}() is in the population (got ${problems.length})`);
        assert(units.find((u) => u.anchor === 'HookReaderPlugin').reads[0].origin === `${hook}-hook-from-${phase}`,
          `its read is attributed to ${hook}-hook-from-${phase}`);
      }
    }
  }

  // 20. A hook outside the pin is outside the population: `metadata:reloaded`
  //     is fired by an artifact watcher after boot.
  {
    const { problems, findings } = auditSource(PROVIDER + `
      export class ReloadPlugin implements Plugin {
        name = 'plugin.reload';
        async start(ctx: PluginContext) {
          ctx.hook('metadata:reloaded', async () => { ctx.getService('settings'); });
        }
      }
    `);
    assert(problems.length === 0 && findings.length === 0, 'an unpinned, post-boot hook is not in the population');
  }

  // 21. The DERIVATION: every fire-site spelling that ships, and the two that
  //     must not count. `trigger.call(ctx, …)` through a local helper is
  //     AppPlugin's app:seeded; the parameter-bound name is its
  //     emitCatalogEvent; the continuation is the over-budget seed path.
  {
    const { units } = auditSource(PROVIDER + `
      function fireFrom(pluginCtx: PluginContext) { pluginCtx.trigger('x:renamed'); }
      export class EmitterPlugin implements Plugin {
        name = 'plugin.emitter';
        private emitCatalogEvent(ctx: PluginContext, event: string, sys: any): void {
          const trigger = (ctx as any).trigger;
          trigger.call(ctx, event, { sys });
        }
        private emitWhenSettled(ctx: PluginContext, event: string): void {
          settled.then(() => ctx.trigger(event));
        }
        async init(ctx: PluginContext) { this.ctx = ctx; await ctx.trigger('x:init', {}); }
        async start(ctx: PluginContext) {
          await ctx.trigger('x:direct', this.service);
          this.ctx.trigger('x:stored');
          fireFrom(ctx);
          jobs.trigger('nightly-cleanup');
          this.jobs.trigger(jobName);
          const emitSettled = (overBudget: boolean) => {
            const trigger = (ctx as any).trigger;
            trigger.call(ctx, 'x:call', { overBudget });
          };
          emitSettled(false);
          this.emitCatalogEvent(ctx, 'x:param', {});
          this.emitWhenSettled(ctx, 'x:then-param');
          seedPromise.then(() => ctx.trigger('x:then'));
          setTimeout(() => ctx.trigger('x:timer'), 10);
          ctx.hook('kernel:bootstrapped', async () => { await ctx.trigger('x:late'); });
          ctx.trigger(eventName);
        }
      }
    `);
    const derived = derivePreBindHooks(units);
    const names = [...derived.fired.keys()].sort();
    assert(JSON.stringify(names) === JSON.stringify(
      ['x:call', 'x:direct', 'x:init', 'x:param', 'x:renamed', 'x:stored', 'x:then', 'x:then-param']),
    `the derivation reads every shipped fire-site spelling on the context, and nothing deferred or ` +
      `off-context (got ${names.join(', ')})`);
    assert(derived.fired.get('x:init')[0].origin === 'init-body', 'an init() fire site is recorded as init-body');
    assert(derived.unresolved.length === 1 && derived.unresolved[0].text === 'eventName',
      'a hook name the walk cannot resolve is recorded, not dropped');
  }

  // 22. The RECONCILIATION, both directions, and its anti-vacuity limb: an
  //     empty derivation stales every pinned row.
  {
    const derived = { fired: new Map([['app:seeded', []], ['x:new', []]]), unresolved: [] };
    const pin = { 'app:seeded': 'site', 'x:gone': 'site' };
    const drift = reconcilePreBindHooks(derived, pin);
    assert(JSON.stringify(drift.missing) === '["x:new"]', 'a fired hook missing from the pin is reported');
    assert(JSON.stringify(drift.stalePins) === '["x:gone"]', 'a pinned hook no longer fired is reported');
    const empty = reconcilePreBindHooks({ fired: new Map(), unresolved: [] });
    assert(empty.stalePins.length === Object.keys(PRE_BIND_HOOKS).length && empty.stalePins.length > 0,
      'a derivation that finds nothing stales every pinned row');
    const exact = reconcilePreBindHooks({ fired: new Map(Object.keys(PRE_BIND_HOOKS).map((k) => [k, []])), unresolved: [] });
    assert(exact.missing.length === 0 && exact.stalePins.length === 0, 'a derivation equal to the pin reconciles clean');
  }

  console.log(`✓ settings bind-window guard self-test: all cases pass.`);
  selfTestReachedVerdict = true;
}

// ── Entry ────────────────────────────────────────────────────────────────────

const arg = process.argv[2];
if (arg === '--self-test') {
  selfTest();
  if (!selfTestReachedVerdict) {
    console.error(
      '\n✗ check-settings-bind-window self-test: selfTest() returned without reaching its verdict,\n'
      + 'so no success line was printed. Exiting 0 here would report a self-test\n'
      + 'that never finished as a self-test that passed.\n',
    );
    process.exit(1);
  }
} else if (arg === '--list') list();
else audit();
