#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Namespace-wildcard fall-through guard (#4116).
 *
 * ## What it guards
 *
 * A handler mounted on a wildcard path — `app.all('/api/v1/auth/*', h)` — claims
 * an entire namespace. Hono runs every handler matching a path in REGISTRATION
 * order and the first one to produce a Response wins. So if that handler is
 * TERMINAL (it always answers, never `next()`s), every other route under the
 * same prefix is reachable only when it happens to register FIRST — and plugin
 * registration order is not a contract anyone declares or tests.
 *
 * That is not a hypothetical failure mode. It has now cost four separate fixes:
 *
 *   - #2567 — anonymous-deny on raw `/data` held only while REST registered
 *     first, so a load-order change silently reopened anonymous data access.
 *   - #4018 — the standalone `/discovery` was shadowed by the dispatcher's, so
 *     a third publisher drifted unnoticed behind whoever won.
 *   - #4088 / #4092 — `AuthPlugin`'s `/api/v1/auth/*` catch-all swallowed
 *     `plugin-hono-server`'s `/auth/me/permissions`, which is the console's
 *     entire permission layer, unless the server plugin registered first.
 *   - cloud#923 — the same shape in `AuthProxyPlugin`. Its sibling repo had
 *     already ALSO hit it in staging: `apps/{objectos,cloud}/server/index.ts`
 *     record the Console 404ing on `/api/v1/auth/me/permissions`.
 *
 * Every one of those was found by hand, after the fact, by someone reading the
 * code for an unrelated reason. Nothing in CI noticed any of them, and nothing
 * would notice the fifth.
 *
 * ## Why a whole-repo scan rather than per-plugin tests
 *
 * #4092 and cloud#923 each shipped a driven test that pins ONE catch-all's
 * fall-through. Those are worth having, but they are structurally incapable of
 * covering the next wildcard someone mounts: a test can only drive the routes
 * that existed the day it was written. What has never existed is the
 * ENUMERATION — the question "which handlers in this repo claim a namespace, and
 * is each one terminal?" has had no answer, so a new terminal catch-all lands
 * with nothing to fail.
 *
 * This scan answers it, and follows `check-route-envelope.mjs` (#3843) in making
 * a site discovered but NOT declared an ERROR rather than a default. Silently
 * passing an unknown wildcard is what let the four above accumulate.
 *
 * ## Three states, deliberately
 *
 *   yields   — the handler takes a `next` and calls it. The scan verifies this
 *              from the AST, so the entry cannot rot: delete the `next()` and
 *              this fails.
 *   exempt   — a REASON string for a wildcard that is SUPPOSED to own its whole
 *              namespace (a transport adapter's single entry point, a dev-only
 *              surface). Fall-through is then not asserted.
 *   ratchet  — currently terminal, tracked, NOT blessed: the CURRENT state plus
 *              the issue that will fix it.
 *
 * There is no fourth state where nobody looked.
 *
 * ## Why AST, not regex
 *
 * "Does this handler call `next()`?" is a question about the handler's parameter
 * binding, not about the text `next(` appearing nearby — a comment mentioning
 * `next()`, or a `next` belonging to an inner closure, both fool a textual
 * match, in the direction that PASSES while the defect ships. The parameter name
 * is also not always `next`. Resolving the handler (inline arrow, or a
 * `const handler = …` in the same file) and matching calls against its own
 * second parameter's symbol name makes both problems disappear.
 *
 * ## Usage
 *
 *     node scripts/check-wildcard-fallthrough.mjs             # audit the repo
 *     node scripts/check-wildcard-fallthrough.mjs --list      # print every site
 *     node scripts/check-wildcard-fallthrough.mjs --self-test # verify the checker
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { parseSourceFile } from './ts-parse.mjs';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');

/**
 * Every namespace-claiming wildcard mount in the repo. Keyed by
 * `<file>:<method> <pattern>` so two mounts in one file stay distinguishable.
 * A site the scan finds that is not listed here fails — see the header.
 */
const MOUNTS = {
  // ── Yields (verified from the AST) ───────────────────────────────────────

  // Fixed by #4092. Was the terminal catch-all that swallowed
  // `/auth/me/permissions`; now a 404 from better-auth means "not my path".
  "packages/plugins/plugin-auth/src/auth-plugin.ts:all `${basePath}/*`": { yields: true },

  // ADR-0069 D5 network gate — a real middleware: rejects out-of-range client
  // IPs and otherwise `next()`s. Included because a wildcard that forgot to
  // yield would be just as fatal here, and more silently: it fronts every auth
  // route in the plugin.
  "packages/plugins/plugin-auth/src/auth-plugin.ts:use `${basePath}/*`": { yields: true },

  // Proxies the marketplace prefix upstream and yields what it does not own —
  // already the shape #4092 had to retrofit onto AuthPlugin.
  "packages/cloud-connection/src/marketplace-proxy-plugin.ts:all `${MARKETPLACE_PREFIX}/*`": { yields: true },

  // Request-scoped middleware fronting every route (`serve`'s request log, the
  // adapter's and plugin's own `*` middlewares). Terminal here would take down
  // the entire surface, not one namespace.
  'packages/cli/src/commands/serve.ts:use *': { yields: true },
  // Fixed by #4117, found BY this scan (manual greps had missed it). A
  // pre-processing shim that hands off to the env's auth service, not an owner:
  // a path that service does not claim now continues to the `${prefix}/*`
  // dispatcher below. Narrower than #4092 — it does not make a later Hono route
  // reachable (the dispatcher catch-all is deliberately terminal and would
  // swallow it anyway); it means an unowned path gets a real gated `dispatch()`
  // attempt. Keyed on the dispatcher's own `handled` flag where one exists.
  //
  // Its `${prefix}/storage/*` twin was ratcheted here alongside it and is now
  // gone entirely: #4087/#4112 deleted that bridge, having reached the same
  // conclusion from the other direction — "the wildcard was wider than the two
  // routes it served". Two independent reads landing on the same defect is the
  // argument for enumerating the shape rather than finding it by eye each time.
  "packages/adapters/hono/src/index.ts:all `${prefix}/auth/*`": { yields: true },

  'packages/plugins/plugin-hono-server/src/adapter.ts:use *': { yields: true },
  'packages/plugins/plugin-hono-server/src/hono-plugin.ts:use *': { yields: true },

  // ── Exempt: SUPPOSED to own the namespace ───────────────────────────────

  // The dispatcher's single entry point. DELIBERATE — ADR-0076 OQ#9 verdict
  // (#3576 / #3608): `dispatch()` is a gates+registry pipeline (env → identity →
  // auth gate → membership → scope strip, then a first-match handler lookup),
  // and splitting it into per-prefix mounts bypasses those cross-cutting stages
  // (the #2852 RLS-leak class). Owning `${prefix}/*` is the design, not an
  // oversight, so fall-through is not asserted. Reopen conditions on #3608.
  'packages/adapters/hono/src/index.ts:all `${prefix}/*`': {
    exempt: 'dispatcher single entry point — per-prefix mounts would bypass the gate stages (ADR-0076 OQ#9, #3576/#3608)',
  },

  // Third-party middleware factories (`hono/cors`). The handler is the return
  // value of a call, so the scan cannot resolve it — and it does not need to:
  // cors() yields by construction. Recorded rather than skipped so that
  // swapping it for a hand-written middleware has to be reclassified.
  'packages/adapters/hono/src/index.ts:use * (cors)': {
    exempt: 'hono/cors middleware factory — yields internally, handler not resolvable at the call site',
  },
  'packages/plugins/plugin-hono-server/src/hono-plugin.ts:use * (cors)': {
    exempt: 'hono/cors middleware factory — yields internally, handler not resolvable at the call site',
  },

  // SPA subtrees. A single-page app owns every path under its own mount point —
  // that IS the SPA fallback contract (deep links must serve index.html rather
  // than 404). Neither claims a shared API namespace: one is scoped to
  // `${CONSOLE_PATH}`, the other is registered inside `listen()`, i.e. AFTER
  // every plugin's `kernel:ready` routes, so it cannot shadow any of them.
  'packages/cli/src/utils/console.ts:get `${CONSOLE_PATH}/*`': {
    exempt: 'console SPA subtree — owning its own mount point is the SPA fallback contract',
  },
  'packages/plugins/plugin-hono-server/src/adapter.ts:get /* (serveStatic)': {
    exempt: 'serveStatic SPA fallback, registered in listen() after every plugin route — cannot shadow',
  },

  // ── Ratchet: real, tracked, NOT blessed ─────────────────────────────────
  //
  // Empty as of #4117. The mechanism stays — it is how the next terminal wildcard
  // gets recorded honestly instead of being either fixed on the spot or quietly
  // skipped. Declare the current state plus a `ratchet` naming the issue.
};

/** HTTP-verb registrars plus `use`; anything that can claim a path pattern. */
const REGISTRARS = new Set(['all', 'use', 'get', 'post', 'put', 'delete', 'patch', 'options', 'head']);

/**
 * Receivers we treat as an app/router. Deliberately loose — the cost of a false
 * positive is one ledger line, the cost of a false negative is the whole point
 * of the guard. `notFound`/`onError` are not registrars and never appear here.
 */
const APP_RECEIVER = /^(raw)?[aA]pp$|^(rawApp|honoApp|router|server)$/;

// ── Scan ─────────────────────────────────────────────────────────────────────

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
      if (entry.includes('.test.') || entry.includes('.conformance.')) continue;
      out.push(relative(ROOT, full).split(sep).join('/'));
    }
  };
  walk(join(ROOT, 'packages'));
  return out.sort();
}

/** The source text of a path argument, normalised for use as a ledger key. */
function patternText(node, src) {
  if (ts.isStringLiteralLike(node)) return node.text;
  if (ts.isTemplateExpression(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.getText(src);
  }
  return undefined;
}

/** True when a mounted pattern claims a namespace rather than one path. */
function isWildcard(pattern) {
  if (!pattern) return false;
  const unquoted = pattern.replace(/^`|`$/g, '');
  return unquoted.endsWith('/*') || unquoted === '*' || unquoted === '/*';
}

/**
 * Does `fn` take a continuation and call it?
 *
 * Matched against the second parameter's own name — not the text `next(` — so an
 * inner closure's `next` or a comment cannot pass this.
 */
function callsContinuation(fn, src) {
  if (!fn || !(ts.isArrowFunction(fn) || ts.isFunctionExpression(fn))) return false;
  const param = fn.parameters?.[1];
  if (!param || !ts.isIdentifier(param.name)) return false;
  const name = param.name.text;

  const rebinds = (node) =>
    (ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isFunctionDeclaration(node)) &&
    node.parameters?.some((p) => ts.isIdentifier(p.name) && p.name.text === name);

  let found = false;
  const visit = (node) => {
    if (found) return;
    // An inner function taking its OWN parameter of the same name shadows ours;
    // a call inside it is not this handler yielding.
    if (rebinds(node)) return;
    // `next()` — or `return next()` / `await next()`, same shape.
    if (ts.isCallExpression(node)) {
      // `next()` — or `return next()` / `await next()`, same shape.
      if (ts.isIdentifier(node.expression) && node.expression.text === name) {
        found = true;
        return;
      }
      // …or HANDED to a helper that awaits it: `yieldUnowned(c, next, …)`.
      // Counting this is deliberate (#4117). `adapters/hono` factors the yield
      // into one helper precisely because the compose subtlety it encodes should
      // be written once, and a checker that only recognised a direct call would
      // push code toward duplicating it. The trade-off is a handler that passes
      // the continuation somewhere that never awaits it — narrower than the false
      // NEGATIVE it replaces, and the ledger still requires a human to classify.
      if (node.arguments.some((a) => ts.isIdentifier(a) && a.text === name)) {
        found = true;
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(fn, visit);
  return found;
}

/**
 * Resolve the handler argument to a function node. Handles the two shapes the
 * repo actually uses: an inline arrow, and a `const handler = async (c, next) …`
 * declared in the same file and passed by name (cloud's AuthProxyPlugin mounts
 * it that way, and a scan that only understood inline handlers would have
 * reported that one as terminal).
 */
function resolveHandler(arg, src) {
  if (!arg) return undefined;
  if (ts.isArrowFunction(arg) || ts.isFunctionExpression(arg)) return arg;
  if (!ts.isIdentifier(arg)) return undefined;

  const wanted = arg.text;
  let found;
  const visit = (node) => {
    if (found) return;
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === wanted &&
      node.initializer &&
      (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))
    ) {
      found = node.initializer;
      return;
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(src, visit);
  return found;
}

/** Every wildcard mount in one file. */
function scanFile(file) {
  const text = readFileSync(join(ROOT, file), 'utf8');
  const src = parseSourceFile(file, text);
  const sites = [];

  const visit = (node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      REGISTRARS.has(node.expression.name.text) &&
      node.arguments.length >= 2
    ) {
      const receiver = node.expression.expression;
      const receiverName = ts.isIdentifier(receiver)
        ? receiver.text
        : ts.isPropertyAccessExpression(receiver)
          ? receiver.name.text
          : undefined;

      if (receiverName && APP_RECEIVER.test(receiverName)) {
        const pattern = patternText(node.arguments[0], src);
        if (isWildcard(pattern)) {
          const last = node.arguments[node.arguments.length - 1];
          const handler = resolveHandler(last, src);
          sites.push({
            file,
            method: node.expression.name.text,
            pattern,
            // A middleware FACTORY (`cors(…)`, `serveStatic(…)`) names the site
            // apart from an inline handler in the same file with the same
            // pattern — `hono-plugin.ts` has exactly that pair, and without a
            // discriminator both collapse onto one ledger key. Chosen over the
            // line number on purpose: the ledger must not churn every time code
            // moves down a few lines.
            factory: ts.isCallExpression(last) && ts.isIdentifier(last.expression) ? last.expression.text : undefined,
            line: src.getLineAndCharacterOfPosition(node.getStart(src)).line + 1,
            yields: callsContinuation(handler, src),
            resolvedHandler: Boolean(handler),
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(src, visit);
  return sites;
}

function scan() {
  const sites = [];
  for (const file of discoverFiles()) {
    // Cheap pre-filter: parsing every .ts in the repo to find ~a dozen sites is
    // needless work, and the tokens below are present in any real mount.
    const text = readFileSync(join(ROOT, file), 'utf8');
    if (!text.includes('/*`') && !text.includes("/*'") && !text.includes('/*"')) continue;
    sites.push(...scanFile(file));
  }
  return sites;
}

/**
 * Ledger key. Two sites CAN still collide (two inline `use('*')` in one file),
 * and that is safe by construction: every site is checked against the shared
 * declaration independently, so a colliding pair where only one yields still
 * fails on the one that does not.
 */
const keyOf = (s) => `${s.file}:${s.method} ${s.pattern}${s.factory ? ` (${s.factory})` : ''}`;

// ── Audit ────────────────────────────────────────────────────────────────────

function audit() {
  const sites = scan();
  const problems = [];
  const seen = new Set();
  let yields = 0, exempt = 0, ratcheted = 0;

  for (const site of sites) {
    const key = keyOf(site);
    seen.add(key);
    const declared = MOUNTS[key];

    if (!declared) {
      problems.push(
        `${site.file}:${site.line}\n` +
        `    ${site.method}('${site.pattern}') is NOT DECLARED.\n` +
        `    This handler claims the whole '${site.pattern}' namespace. Add it to MOUNTS in\n` +
        `    scripts/check-wildcard-fallthrough.mjs. If it yields to other routes (takes a\n` +
        `    \`next\` and calls it), declare { yields: true }. If it is SUPPOSED to own the\n` +
        `    namespace, declare \`exempt\` with the reason. If it is terminal and should not\n` +
        `    be, declare \`ratchet\` naming the issue — never leave one unaudited (#4116).`,
      );
      continue;
    }

    if (declared.exempt) { exempt++; continue; }

    if (declared.ratchet) {
      ratcheted++;
      if (site.yields) {
        problems.push(
          `${site.file}:${site.line}\n` +
          `    ${site.method}('${site.pattern}') is declared as a ratchet (${declared.ratchet})\n` +
          `    but now YIELDS. Fixed? Replace the ratchet with { yields: true }.`,
        );
      }
      continue;
    }

    if (declared.yields) {
      yields++;
      if (!site.resolvedHandler) {
        problems.push(
          `${site.file}:${site.line}\n` +
          `    ${site.method}('${site.pattern}') is declared { yields: true } but its handler\n` +
          `    could not be resolved, so the claim is unverifiable. Inline the handler, or\n` +
          `    declare \`exempt\`/\`ratchet\` with a reason.`,
        );
      } else if (!site.yields) {
        problems.push(
          `${site.file}:${site.line}\n` +
          `    ${site.method}('${site.pattern}') is declared { yields: true } but the handler\n` +
          `    never calls its continuation — it is TERMINAL. Every other route under\n` +
          `    '${site.pattern}' is now reachable only if it registers first (#4088). Take a\n` +
          `    \`next\` and call it for paths this handler does not own.`,
        );
      }
    }
  }

  for (const key of Object.keys(MOUNTS)) {
    if (!seen.has(key)) {
      problems.push(
        `${key}\n` +
        `    DECLARED but not found by the scan. Moved, renamed or deleted? Update MOUNTS.`,
      );
    }
  }

  if (problems.length) {
    console.error('✗ wildcard fall-through guard (#4116)\n');
    for (const p of problems) console.error('  ' + p + '\n');
    console.error(`${problems.length} problem(s).`);
    process.exit(1);
  }

  console.log(
    `✓ wildcard fall-through: ${yields} yielding / ${ratcheted} ratcheted / ${exempt} exempt ` +
    `(${sites.length} namespace-claiming mount${sites.length === 1 ? '' : 's'})`,
  );
}

// ── Self-test ────────────────────────────────────────────────────────────────

function selfTest() {
  const assert = (cond, msg) => { if (!cond) { console.error('✗ self-test: ' + msg); process.exit(1); } };
  const parse = (code) => parseSourceFile('t.ts', code);

  // `isWildcard` — namespace claims vs single paths.
  assert(isWildcard('/api/v1/auth/*'), 'plain wildcard');
  assert(isWildcard('`${basePath}/*`'), 'template wildcard');
  assert(isWildcard('/*') && isWildcard('*'), 'bare wildcard');
  assert(!isWildcard('/api/v1/auth/me/permissions'), 'a concrete path is not a wildcard');
  assert(!isWildcard('/api/v1/data/:object'), 'a param path is not a wildcard');
  assert(!isWildcard(undefined), 'a non-literal pattern is not a wildcard');

  // `callsContinuation` — the whole point is that this is not a text match.
  const first = (code) => {
    const src = parse(code);
    let fn;
    const visit = (n) => { if (!fn && (ts.isArrowFunction(n) || ts.isFunctionExpression(n))) fn = n; else ts.forEachChild(n, visit); };
    ts.forEachChild(src, visit);
    return { fn, src };
  };
  const yieldsIn = (code) => { const { fn, src } = first(code); return callsContinuation(fn, src); };

  assert(yieldsIn('app.all("/a/*", async (c, next) => { await next(); });'), 'await next()');
  assert(yieldsIn('app.all("/a/*", (c, next) => next());'), 'return next()');
  assert(yieldsIn('app.all("/a/*", async (c, n) => { if (x) { await n(); } return r; });'), 'renamed continuation');
  assert(!yieldsIn('app.all("/a/*", async (c) => r);'), 'no continuation parameter at all');
  assert(
    !yieldsIn('app.all("/a/*", async (c, next) => { /* we could next() here */ return r; });'),
    'a comment mentioning next() must NOT count — this is the regex failure mode',
  );
  assert(
    !yieldsIn('app.all("/a/*", async (c, next) => { const s = "call next() later"; return r; });'),
    'a string mentioning next() must NOT count',
  );
  assert(
    !yieldsIn('app.all("/a/*", async (c, next) => { items.forEach((next) => next()); return r; });'),
    'an INNER binding shadowing the name must not count as yielding',
  );
  assert(
    yieldsIn('app.all("/a/*", async (c, next) => yieldUnowned(c, next, fb));'),
    'handing the continuation to a helper that awaits it DOES count (#4117)',
  );
  assert(
    !yieldsIn('app.all("/a/*", async (c, next) => { log("no next here"); return r; });'),
    'a call that neither invokes nor receives the continuation must not count',
  );

  // `resolveHandler` — a handler passed by name must still be analysed, or the
  // scan reports a yielding mount as terminal (cloud#923 mounts it that way).
  {
    const code = 'const handler = async (c, next) => { await next(); };\napp.all("/a/*", handler);';
    const src = parse(code);
    let call;
    const visit = (n) => {
      if (!call && ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === 'all') call = n;
      else ts.forEachChild(n, visit);
    };
    ts.forEachChild(src, visit);
    const fn = resolveHandler(call.arguments[1], src);
    assert(fn, 'a handler passed by identifier resolves to its declaration');
    assert(callsContinuation(fn, src), 'and its continuation call is seen');
  }

  // `keyOf` keeps two mounts in one file distinct.
  assert(
    keyOf({ file: 'a.ts', method: 'all', pattern: '/x/*' }) !== keyOf({ file: 'a.ts', method: 'use', pattern: '/x/*' }),
    'method is part of the key',
  );

  console.log('✓ self-test: 17 cases');
}

if (process.argv.includes('--self-test')) selfTest();
else if (process.argv.includes('--list')) {
  for (const s of scan()) {
    console.log(`${s.yields ? 'yields ' : 'TERMINAL'}  ${s.file}:${s.line}  ${s.method}('${s.pattern}')${s.resolvedHandler ? '' : '  [handler unresolved]'}`);
  }
} else audit();
