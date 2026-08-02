#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Init-service declaration guard (#4471, ADR-0116).
 *
 * ## What it guards
 *
 * ADR-0116 / `packages/core/src/plugin-order.ts` gives a plugin three ways to
 * declare "my init() consumes a service another plugin provides":
 *
 *   - `dependencies`         — hard: provider hoisted ahead, missing ⇒ boot error.
 *   - `optionalDependencies` — declared tolerance: hoisted ahead when composed,
 *                              plugin degrades explicitly when absent.
 *   - `requiresServices`     — the service itself, asserted registered
 *                              immediately before init() runs.
 *
 * The mechanism is complete — but every declaration was VOLUNTARY. A plugin
 * that calls `getService('X')` inside init() and declares nothing is invisible
 * to all of it: it merely fails to find the service under unlucky composition
 * orders, usually inside a best-effort try/catch that turns the miss into a
 * warn nobody reads. That silence shipped twice:
 *
 *   - #4085 — AppPlugin grabbed `manifest` in init before ObjectQLPlugin
 *     registered it; the fix "existed only as a convention".
 *   - #4420 — AutomationServicePlugin declared `dependencies = []`, nothing
 *     else, and resolved `manifest` in init via a private helper. Composed
 *     ahead of ObjectQL: object never registered → table never created → the
 *     durable suspended-run store still attached → every pause write failed
 *     into a warn → every restart lost all in-flight approvals. The symptom
 *     surfaced a release after the cause.
 *
 * This scan closes the loop: every init()-reachable `getService('X')` whose
 * service a workspace plugin declares in `providesServices` MUST be covered by
 * one of the three declarations above. Undeclared consumption is an ERROR at
 * CI time, deterministically — not a probabilistic boot failure in whichever
 * composition happens to order the plugins badly.
 *
 * ## What it deliberately does NOT flag
 *
 *   - `getService` in `start()` (or hooks registered during init). By start(),
 *     every init() has completed — that is the sanctioned pattern for
 *     best-effort consumption, and the one `apps/setup` / `studio` / `account`
 *     use on purpose (they register app/nav in start(); a miss is a missing
 *     screen, not silent data loss). Only SYNCHRONOUS init()-time resolution
 *     carries the ordering hazard ADR-0116 exists for.
 *   - Services no workspace plugin declares in `providesServices` (kernel
 *     built-ins, host-injected services): there is no provider to order
 *     against, so there is nothing to declare.
 *   - A plugin resolving a service it provides itself.
 *
 * Best-effort consumers get no checker-side exemption: a plugin that
 * legitimately tolerates a missing service says so IN ITS OWN CODE by
 * declaring the provider in `optionalDependencies` (order-if-present,
 * degrade-if-absent — the #4460 shape in service-automation is the reference).
 * Tolerance lives in the plugin's declaration, where the kernel enforces it,
 * never in this script's ledger.
 *
 * ## Why AST, not regex
 *
 * The #4420 call was not in init()'s body — it was in a private method init()
 * called (`this.registerRunObject(ctx)`), wrapped in try/catch. A textual
 * "getService inside init" match misses exactly the shape that shipped the
 * data-loss bug. The scan therefore walks the call graph: starting at init(),
 * it follows same-class method calls and same-file function calls
 * transitively, while NOT descending into nested function expressions (a
 * callback registered via `ctx.hook(...)` runs later, not during init).
 *
 * ## Usage
 *
 *     node scripts/check-init-service-contract.mjs             # audit the repo
 *     node scripts/check-init-service-contract.mjs --list      # print every edge
 *     node scripts/check-init-service-contract.mjs --self-test # verify the checker
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');

const DECLARATION_FIELDS = ['dependencies', 'optionalDependencies', 'requiresServices', 'providesServices'];

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

/** String elements of an array-literal initializer, or undefined when the
 *  initializer is absent / not statically readable. */
function stringArray(initializer) {
  if (!initializer || !ts.isArrayLiteralExpression(initializer)) return undefined;
  const out = [];
  for (const el of initializer.elements) {
    if (!ts.isStringLiteralLike(el)) return undefined;
    out.push(el.text);
  }
  return out;
}

/** Function-like node kinds whose bodies do NOT run synchronously during the
 *  enclosing call — walking must not descend into them. */
function isDeferredFunctionLike(node) {
  return ts.isArrowFunction(node) || ts.isFunctionExpression(node) ||
    ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node) ||
    ts.isClassDeclaration(node) || ts.isClassExpression(node);
}

/**
 * One plugin declaration site — a class with an `init` method, or an object
 * literal with `name` + `init` (the `createApiRegistryPlugin` shape). Both are
 * reduced to: identifying name, the four declaration arrays, the init body,
 * and the lookup tables the call-graph walk resolves through.
 */
function collectPluginUnits(file, src) {
  const units = [];
  /** Same-file free functions (declarations + const initializers), by name. */
  const fileFunctions = new Map();

  const indexFileFunction = (name, fnNode) => {
    if (name && fnNode && !fileFunctions.has(name)) fileFunctions.set(name, fnNode);
  };

  const topWalk = (node) => {
    if (ts.isFunctionDeclaration(node) && node.name) {
      indexFileFunction(node.name.text, node);
    } else if (ts.isVariableStatement(node)) {
      for (const d of node.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.initializer &&
          (ts.isArrowFunction(d.initializer) || ts.isFunctionExpression(d.initializer))) {
          indexFileFunction(d.name.text, d.initializer);
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
  return units;
}

function classUnit(file, src, cls, fileFunctions) {
  const methods = new Map();
  const decl = {};
  let nameLiteral;
  let hasNameProp = false;
  let initNode;

  for (const member of cls.members) {
    const memberName = member.name && (ts.isIdentifier(member.name) || ts.isStringLiteralLike(member.name))
      ? member.name.text : undefined;
    if (!memberName) continue;

    if (ts.isMethodDeclaration(member)) {
      methods.set(memberName, member);
      if (memberName === 'init') initNode = member;
      continue;
    }
    if (ts.isPropertyDeclaration(member)) {
      if (memberName === 'name') {
        hasNameProp = true;
        if (member.initializer && ts.isStringLiteralLike(member.initializer)) {
          nameLiteral = member.initializer.text;
        }
      }
      if (DECLARATION_FIELDS.includes(memberName)) {
        decl[memberName] = stringArray(member.initializer);
      }
      // A property initialized to a function is a callable too (`init = async … =>`).
      if (member.initializer &&
        (ts.isArrowFunction(member.initializer) || ts.isFunctionExpression(member.initializer))) {
        methods.set(memberName, member.initializer);
        if (memberName === 'init') initNode = member.initializer;
      }
    }
  }

  if (!initNode) return undefined;
  const implementsPlugin = (cls.heritageClauses ?? []).some((h) =>
    h.types.some((t) => /Plugin/.test(t.expression.getText(src))));
  if (!hasNameProp && !implementsPlugin) return undefined;

  return {
    file,
    anchor: cls.name ? cls.name.text : '(anonymous class)',
    pluginName: nameLiteral,
    decl,
    initNode,
    methods,
    fileFunctions,
    line: src.getLineAndCharacterOfPosition(cls.getStart(src)).line + 1,
  };
}

function objectUnit(file, src, obj, fileFunctions) {
  const methods = new Map();
  const decl = {};
  let nameLiteral;
  let initNode;

  for (const prop of obj.properties) {
    const propName = prop.name && (ts.isIdentifier(prop.name) || ts.isStringLiteralLike(prop.name))
      ? prop.name.text : undefined;
    if (!propName) continue;

    if (ts.isMethodDeclaration(prop)) {
      methods.set(propName, prop);
      if (propName === 'init') initNode = prop;
      continue;
    }
    if (ts.isPropertyAssignment(prop)) {
      if (propName === 'name' && ts.isStringLiteralLike(prop.initializer)) nameLiteral = prop.initializer.text;
      if (DECLARATION_FIELDS.includes(propName)) decl[propName] = stringArray(prop.initializer);
      if (ts.isArrowFunction(prop.initializer) || ts.isFunctionExpression(prop.initializer)) {
        methods.set(propName, prop.initializer);
        if (propName === 'init') initNode = prop.initializer;
      }
    }
  }

  if (!initNode || !nameLiteral) return undefined;
  return {
    file,
    anchor: nameLiteral,
    pluginName: nameLiteral,
    decl,
    initNode,
    methods,
    fileFunctions,
    line: src.getLineAndCharacterOfPosition(obj.getStart(src)).line + 1,
  };
}

// ── Init-reachable getService analysis ───────────────────────────────────────

/**
 * Every `<expr>.getService('X')` with a literal service name that runs
 * SYNCHRONOUSLY when `unit.init()` runs: the init body itself, plus — followed
 * transitively — same-class `this.m(...)` calls and same-file free-function
 * calls. Nested function expressions are NOT entered (a hook callback runs
 * later, outside the init ordering window).
 */
function initServiceCalls(unit, src) {
  const calls = [];
  const visitedFns = new Set();

  const walkBody = (fnNode) => {
    if (!fnNode || visitedFns.has(fnNode)) return;
    visitedFns.add(fnNode);
    const body = fnNode.body;
    if (!body) return;

    const visit = (node) => {
      // Deferred bodies never run during init — do not descend.
      if (isDeferredFunctionLike(node)) return;

      if (ts.isCallExpression(node)) {
        const callee = node.expression;
        // `<anything>.getService('X')`
        if (ts.isPropertyAccessExpression(callee) && callee.name.text === 'getService') {
          const arg = node.arguments[0];
          if (arg && ts.isStringLiteralLike(arg)) {
            calls.push({
              service: arg.text,
              line: src.getLineAndCharacterOfPosition(node.getStart(src)).line + 1,
            });
          }
          // A non-literal service name cannot be checked statically; the
          // runtime `describeInitOrderFault` diagnostics still cover it.
        }
        // `this.m(...)` → same-class method.
        if (ts.isPropertyAccessExpression(callee) &&
          callee.expression.kind === ts.SyntaxKind.ThisKeyword) {
          const target = unit.methods.get(callee.name.text);
          if (target) walkBody(target);
        }
        // `f(...)` → same-file free function.
        if (ts.isIdentifier(callee)) {
          const target = unit.fileFunctions.get(callee.text);
          if (target) walkBody(target);
        }
      }
      ts.forEachChild(node, visit);
    };
    ts.forEachChild(body, visit);
  };

  walkBody(unit.initNode);
  return calls;
}

// ── Scan + audit ─────────────────────────────────────────────────────────────

function scan(files = discoverFiles()) {
  const units = [];
  for (const file of files) {
    const text = readFileSync(join(ROOT, file), 'utf8');
    // Cheap pre-filter: a file with neither token can contribute neither a
    // provider declaration nor an init-time consumption edge.
    if (!text.includes('getService') && !text.includes('providesServices')) continue;
    const src = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    for (const unit of collectPluginUnits(file, src)) {
      units.push({ ...unit, initCalls: initServiceCalls(unit, src) });
    }
  }
  return units;
}

/** service name → [{ pluginName, file }] from every unit's `providesServices`. */
function providerMap(units) {
  const map = new Map();
  for (const unit of units) {
    for (const service of unit.decl.providesServices ?? []) {
      if (!unit.pluginName) continue; // a provider we cannot name cannot be depended on by name
      if (!map.has(service)) map.set(service, []);
      map.get(service).push({ pluginName: unit.pluginName, file: unit.file });
    }
  }
  return map;
}

/**
 * The verdict for one (consumer, service) edge:
 *   - 'no-provider' — no workspace plugin declares the service: nothing to order against.
 *   - 'self'        — the unit provides the service itself.
 *   - 'declared'    — covered by requiresServices, or a provider is named in
 *                     dependencies / optionalDependencies.
 *   - 'undeclared'  — the #4085 / #4420 class: consumed, provided, undeclared.
 */
function judgeEdge(unit, service, providers) {
  if ((unit.decl.providesServices ?? []).includes(service)) return { verdict: 'self' };
  const external = providers.filter((p) => p.pluginName !== unit.pluginName);
  if (external.length === 0) return { verdict: 'no-provider' };
  if ((unit.decl.requiresServices ?? []).includes(service)) return { verdict: 'declared', via: 'requiresServices' };
  const mentioned = new Set([...(unit.decl.dependencies ?? []), ...(unit.decl.optionalDependencies ?? [])]);
  const named = external.find((p) => mentioned.has(p.pluginName));
  if (named) return { verdict: 'declared', via: `dependencies/optionalDependencies → ${named.pluginName}` };
  return { verdict: 'undeclared', providers: external };
}

function auditUnits(units) {
  const providers = providerMap(units);
  const problems = [];
  const edges = [];

  for (const unit of units) {
    const seen = new Set();
    for (const call of unit.initCalls) {
      if (seen.has(call.service)) continue;
      seen.add(call.service);
      const judged = judgeEdge(unit, call.service, providers.get(call.service) ?? []);
      edges.push({ unit, call, ...judged });
      if (judged.verdict !== 'undeclared') continue;
      const providerNames = judged.providers.map((p) => `'${p.pluginName}'`).join(', ');
      problems.push(
        `${unit.file}:${call.line} — ${unit.anchor}\n` +
        `    init() resolves getService('${call.service}') (directly or via a helper init() calls),\n` +
        `    '${call.service}' is provided by ${providerNames}, and NOTHING declares that ordering.\n` +
        `    This is the #4085/#4420 failure class: it works only under lucky composition order,\n` +
        `    and the miss hides inside best-effort logging. Declare it (ADR-0116):\n` +
        `      - dependencies: [${providerNames}]           if this plugin cannot run without it;\n` +
        `      - optionalDependencies: [${providerNames}]   if it degrades on purpose when the\n` +
        `        provider is not composed (declared tolerance — the #4460 reference shape);\n` +
        `      - requiresServices: ['${call.service}']${' '.repeat(Math.max(0, providerNames.length - call.service.length - 2))}   if the service must exist at init regardless\n` +
        `        of which plugin provides it.\n` +
        `    If the consumption can wait until every init() has finished, move it to start().`,
      );
    }
  }
  return { problems, edges };
}

function audit() {
  const units = scan();
  const { problems, edges } = auditUnits(units);

  if (problems.length) {
    console.error('✗ init-service declaration guard (#4471, ADR-0116)\n');
    for (const p of problems) console.error('  ' + p + '\n');
    console.error(`${problems.length} undeclared init-time service consumption(s).`);
    process.exit(1);
  }

  const declared = edges.filter((e) => e.verdict === 'declared').length;
  const noProvider = edges.filter((e) => e.verdict === 'no-provider').length;
  const self = edges.filter((e) => e.verdict === 'self').length;
  console.log(
    `✓ init-service contract: ${declared} declared / ${self} self-provided / ${noProvider} without a ` +
    `workspace provider (${units.length} plugin unit(s) scanned).`,
  );
}

function list() {
  const units = scan();
  const { edges } = auditUnits(units);
  for (const e of edges) {
    const via = e.via ? `  [${e.via}]` : '';
    console.log(`${e.verdict.padEnd(11)}  ${e.unit.file}:${e.call.line}  ${e.unit.anchor} → getService('${e.call.service}')${via}`);
  }
  if (edges.length === 0) console.log('(no init-time getService edges found)');
}

// ── Self-test ────────────────────────────────────────────────────────────────

function selfTest() {
  const assert = (cond, msg) => { if (!cond) { console.error('✗ self-test: ' + msg); process.exit(1); } };

  const auditSource = (code) => {
    const src = ts.createSourceFile('fixture.ts', code, ts.ScriptTarget.Latest, true);
    const units = collectPluginUnits('fixture.ts', src).map((u) => ({ ...u, initCalls: initServiceCalls(u, src) }));
    return auditUnits(units);
  };

  const PROVIDER = `
    export class ObjectQLPlugin implements Plugin {
      name = 'com.objectstack.engine.objectql';
      providesServices = ['objectql', 'data', 'manifest'];
      async init(ctx: PluginContext) { ctx.registerService('manifest', {}); }
    }
  `;

  // 1. The #4420 pre-fix shape MUST be caught: dependencies = [], no
  //    optionalDependencies, no requiresServices — and the getService('manifest')
  //    is NOT in init()'s own body but in a private helper init() calls, wrapped
  //    in a best-effort try/catch. Exactly what shipped the data-loss bug.
  {
    const { problems } = auditSource(PROVIDER + `
      export class AutomationServicePlugin implements Plugin {
        name = 'com.objectstack.service-automation';
        providesServices = ['automation'];
        dependencies: string[] = [];
        private registerRunObject(ctx: PluginContext): boolean {
          try {
            ctx.getService('manifest').register({ objects: [SysAutomationRun] });
            return true;
          } catch (err) {
            ctx.logger.warn('manifest unavailable; sys_automation_run not registered yet');
            return false;
          }
        }
        async init(ctx: PluginContext) {
          ctx.registerService('automation', this.engine);
          if (this.options.suspendedRunStore !== 'memory') {
            this.runObjectRegistered = this.registerRunObject(ctx);
          }
        }
      }
    `);
    assert(problems.length === 1, `#4420 pre-fix shape is caught (got ${problems.length} problems)`);
    assert(problems[0].includes("getService('manifest')"), '#4420 problem names the service');
    assert(problems[0].includes('com.objectstack.engine.objectql'), '#4420 problem names the provider');
  }

  // 2. The post-#4460 shape (declared tolerance via optionalDependencies) passes.
  {
    const { problems } = auditSource(PROVIDER + `
      export class AutomationServicePlugin implements Plugin {
        name = 'com.objectstack.service-automation';
        optionalDependencies: string[] = ['com.objectstack.engine.objectql'];
        private registerRunObject(ctx: PluginContext) { return ctx.getService('manifest'); }
        async init(ctx: PluginContext) { this.registerRunObject(ctx); }
      }
    `);
    assert(problems.length === 0, 'optionalDependencies on the provider is declared tolerance');
  }

  // 3. A hard dependency on the provider passes.
  {
    const { problems } = auditSource(PROVIDER + `
      export class ApprovalsPlugin implements Plugin {
        name = 'com.objectstack.plugin-approvals';
        dependencies = ['com.objectstack.engine.objectql'];
        async init(ctx: PluginContext) { ctx.getService('manifest').register({}); }
      }
    `);
    assert(problems.length === 0, 'hard dependency on the provider passes');
  }

  // 4. requiresServices naming the service passes.
  {
    const { problems } = auditSource(PROVIDER + `
      export class AuthPlugin implements Plugin {
        name = 'com.objectstack.plugin-auth';
        requiresServices = ['manifest'];
        async init(ctx: PluginContext) { ctx.getService('manifest').register({}); }
      }
    `);
    assert(problems.length === 0, 'requiresServices naming the service passes');
  }

  // 5. getService inside a hook callback registered during init is DEFERRED —
  //    it runs after every init(), so it is not an init-ordering edge.
  {
    const { problems } = auditSource(PROVIDER + `
      export class LatePlugin implements Plugin {
        name = 'plugin.late';
        async init(ctx: PluginContext) {
          ctx.hook('kernel:ready', async () => { ctx.getService('manifest').register({}); });
        }
      }
    `);
    assert(problems.length === 0, 'a hook callback registered in init is not an init-time edge');
  }

  // 6. getService in start() is the sanctioned best-effort pattern — not flagged.
  {
    const { problems } = auditSource(PROVIDER + `
      export class StartConsumerPlugin implements Plugin {
        name = 'plugin.start-consumer';
        async init(ctx: PluginContext) { /* nothing */ }
        async start(ctx: PluginContext) { ctx.getService('manifest').register({}); }
      }
    `);
    assert(problems.length === 0, 'start()-time consumption is not flagged');
  }

  // 7. A service with no workspace provider has nothing to order against.
  {
    const { problems } = auditSource(`
      export class HostConsumerPlugin implements Plugin {
        name = 'plugin.host-consumer';
        async init(ctx: PluginContext) { ctx.getService('host-injected-thing'); }
      }
    `);
    assert(problems.length === 0, 'a service with no declared workspace provider is not flagged');
  }

  // 8. Object-literal plugins (the createApiRegistryPlugin shape) are scanned too.
  {
    const { problems } = auditSource(PROVIDER + `
      export function createBadPlugin(): Plugin {
        return {
          name: 'plugin.object-literal',
          init: async (ctx: PluginContext) => { ctx.getService('manifest').register({}); },
        };
      }
    `);
    assert(problems.length === 1, 'an object-literal plugin with undeclared consumption is caught');
  }

  // 9. Self-provided services are not edges.
  {
    const { problems } = auditSource(`
      export class SelfPlugin implements Plugin {
        name = 'plugin.self';
        providesServices = ['thing'];
        async init(ctx: PluginContext) {
          ctx.registerService('thing', {});
          ctx.getService('thing');
        }
      }
    `);
    assert(problems.length === 0, 'resolving a self-provided service is not flagged');
  }

  // 10. The walk is transitive: init → helperA → helperB → getService, plus a
  //     same-file free function.
  {
    const { problems } = auditSource(PROVIDER + `
      function seedThings(ctx: PluginContext) { ctx.getService('data').insert('t', {}); }
      export class DeepPlugin implements Plugin {
        name = 'plugin.deep';
        private helperA(ctx: PluginContext) { this.helperB(ctx); }
        private helperB(ctx: PluginContext) { ctx.getService('manifest').register({}); }
        async init(ctx: PluginContext) { this.helperA(ctx); seedThings(ctx); }
      }
    `);
    assert(problems.length === 2, `transitive helper + same-file function edges are caught (got ${problems.length})`);
  }

  // 11. A dynamic (non-literal) service name cannot be judged statically —
  //     ignored here; the runtime describeInitOrderFault diagnostics cover it.
  {
    const { problems } = auditSource(PROVIDER + `
      export class DynamicPlugin implements Plugin {
        name = 'plugin.dynamic';
        async init(ctx: PluginContext) { ctx.getService(this.options.serviceName); }
      }
    `);
    assert(problems.length === 0, 'a non-literal service name is not judged statically');
  }

  // 12. Recursion between helpers must terminate.
  {
    const { problems } = auditSource(PROVIDER + `
      export class LoopPlugin implements Plugin {
        name = 'plugin.loop';
        private a(ctx: PluginContext) { this.b(ctx); }
        private b(ctx: PluginContext) { this.a(ctx); ctx.getService('manifest'); }
        async init(ctx: PluginContext) { this.a(ctx); }
      }
    `);
    assert(problems.length === 1, 'mutually recursive helpers terminate and still report');
  }

  console.log('✓ self-test: 12 cases');
}

if (process.argv.includes('--self-test')) selfTest();
else if (process.argv.includes('--list')) list();
else audit();
