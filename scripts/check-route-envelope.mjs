#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Response-envelope guard for the REST route modules (#3843).
 *
 * ## What it guards
 *
 * `BaseResponseSchema` (`packages/spec/src/api/contract.zod.ts`) declares ONE
 * envelope for every REST body the platform emits:
 *
 *     { success: true,  data }
 *     { success: false, error: { code, message } }
 *
 * The route *ledgers* (#3563 → #3656) audit which routes exist and whether the
 * SDK can address them — never what comes back. That is how six route modules
 * carried green `sdk` rows while emitting something else, including an `error`
 * that was a bare string, so `body.error.message` read `undefined`
 * (#3636 → #3675 → #3689 → #3843).
 *
 * ## Why a whole-repo scan rather than a per-module test
 *
 * The load-bearing check is structural, not per-route: it COUNTS the response
 * write sites. When every body in a module goes through its `sendOk` /
 * `sendError` pair, that count is fixed at two and does not grow with the route
 * list — so a *new* route that hand-rolls a body moves the count and fails here,
 * which is the one thing a driven-body test can never cover (it can only drive
 * the routes that existed the day it was written).
 *
 * #3675 / #3689 shipped this as a regex block copied into each converted
 * package. Three copies was the signal it wanted lifting (#3843 option 3), and
 * lifting it to a repo-wide scan buys the thing per-package copies structurally
 * cannot: **a module nobody thought to convert still gets audited.** Two modules
 * in the table below were found exactly that way, neither of them in #3843's
 * hand-written survey — `share-link-routes.ts` (ratcheted on discovery, converted
 * by #3983) and `hmr-routes.ts` (exempt). The first turned out to be the one where
 * the drift had actually broken SDK methods, which is the case for scanning rather
 * than surveying.
 *
 * A module discovered by the scan but absent from the table is an ERROR, not a
 * default: silently applying `2 / 1 / 1` to an unknown module would let a new
 * one pass by coincidence.
 *
 * ## Why AST, not regex
 *
 * The three copied blocks stripped comments with two `String.replace` calls and
 * then counted `.json(` textually. That is wrong twice over:
 *
 *   1. the line-comment regex also ate `//` inside string literals, truncating
 *      the rest of that line — response writes included. A guard that
 *      under-counts passes while drift ships.
 *   2. `.json(` does not mean "write a response". `hmr-routes.ts` calls
 *      `c.req.json()` twice to READ a request body; a textual count reports it
 *      as two unenveloped responses.
 *
 * Parsing with the TypeScript AST makes both disappear: comments and literals
 * are not tokens, and the request/response distinction is a property of the
 * callee. No stripping pass is needed at all.
 *
 * ## Usage
 *
 *     node scripts/check-route-envelope.mjs              # audit (CI)
 *     node scripts/check-route-envelope.mjs --self-test  # verify the checker
 *
 * The nine sibling `check:*` scripts carry no self-test. This one does, because
 * the two bugs above were found by hand AFTER the regex version had shipped and
 * been reviewed — a guard nobody tests is a guard that silently stops guarding.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..');

/**
 * Every route module in the repo, with the envelope structure it is DECLARED to
 * have. A module the scan finds that is not listed here fails — see the header.
 *
 *   responses  — response write sites (`res.json(…)`); one per envelope builder
 *   ok / err   — literal `success: true` / `success: false` (one builder each)
 *   privateOk  — literal `ok: true|false` at the TOP of a response body, i.e. a
 *                sibling of where `success` belongs: a second word for it (#3689).
 *                Inside `data` the same literal is payload, not a flag (#3983).
 *   stringError— bodies whose `error` is a bare string (the pre-#3675 dialect)
 *   ratchet    — set ONLY for a module with outstanding drift. It pins the
 *                CURRENT numbers so nothing gets worse, and names the issue that
 *                will drive them to the conformant 2 / 1 / 1 / 0 / 0.
 *   exempt     — a REASON string for a module the envelope does not govern. The
 *                counts are then not asserted at all.
 *
 * Three states, deliberately — conformant / ratcheted / exempt — because that is
 * the honest classification ADR-0049 requires: a module is either held to the
 * contract, tracked as failing it, or declared outside it *with a reason*.
 * There is no fourth state where nobody looked.
 */
const MODULES = {
  // ── Conformant (#3675, #3689, #3843) ────────────────────────────────────
  'packages/services/service-storage/src/storage-routes.ts': { responses: 2, ok: 1, err: 1 },
  'packages/services/service-settings/src/settings-routes.ts': { responses: 2, ok: 1, err: 1 },
  'packages/services/service-datasource/src/admin-routes.ts': { responses: 2, ok: 1, err: 1 },
  'packages/rest/src/external-datasource-routes.ts': { responses: 2, ok: 1, err: 1 },
  'packages/rest/src/package-routes.ts': { responses: 2, ok: 1, err: 1 },
  // Consolidated by #3973: #3636 put the right envelope on its three read routes
  // but built it inline in four places, so this module carried a ratchet at 5 / 4 / 1
  // until those collapsed behind a `sendOk`.
  'packages/services/service-i18n/src/i18n-service-plugin.ts': { responses: 2, ok: 1, err: 1 },
  // Converted by #3983, the last ratchet. This module was never emitting a
  // `success` flag at all, which broke `client.shareLinks.create()`/`.list()`
  // through `unwrapResponse`; it converged onto the shapes its dispatcher twin
  // (`runtime/src/domains/share-links.ts`) had always returned.
  'packages/plugins/plugin-sharing/src/share-link-routes.ts': { responses: 2, ok: 1, err: 1 },

  // ── Exempt ──────────────────────────────────────────────────────────────

  // A dev-only SSE endpoint (`GET|POST /api/v1/dev/metadata-events`) that closes
  // the "agent edits a source file → Studio preview refreshes" loop. Not on the
  // SDK surface and not a CRUD/metadata API, so `BaseResponseSchema` — the
  // contract for what `ObjectStackClient` unwraps — does not govern it.
  //
  // Recorded here rather than skipped, because it does emit a third shape the
  // scan should not silently pass over: it bypasses `.json()` entirely, writing
  // `new Response(JSON.stringify({ ok: true, … }))` / `{ ok: false, error: '…' }`
  // directly. If this endpoint is ever promoted to a product API, that is the
  // conversion, and deleting this entry is what surfaces it.
  'packages/metadata/src/routes/hmr-routes.ts': {
    exempt: 'dev-only SSE endpoint (/api/v1/dev/*), not on the SDK surface',
  },

  // ── Ratchet: real, tracked, NOT blessed ─────────────────────────────────
  //
  // Empty as of #3983. The mechanism stays — it is how the next drifting module
  // gets recorded honestly instead of being either fixed on the spot or quietly
  // skipped. Declare current counts plus a `ratchet` naming the issue.
};

/** Identifiers whose `.json()` READS a request rather than writing a response. */
const REQUEST_RECEIVERS = new Set(['req', 'request']);

/**
 * Count the envelope-relevant facts in one module's source.
 *
 * @param {string} source TypeScript source text.
 * @returns {{responses: number, ok: number, err: number, privateOk: number, stringError: number, sites: string[]}}
 */
export function scanSource(source, fileName = 'module.ts') {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const found = { responses: 0, ok: 0, err: 0, privateOk: 0, stringError: 0, sites: [] };

  /** `req.json()` / `c.req.json()` read a request body — not a response write. */
  const isRequestRead = (expr) => {
    const recv = expr.expression;
    if (ts.isIdentifier(recv)) return REQUEST_RECEIVERS.has(recv.text);
    // `c.req.json()` — the receiver is itself a property access ending in `req`.
    if (ts.isPropertyAccessExpression(recv)) return REQUEST_RECEIVERS.has(recv.name.text);
    return false;
  };

  const line = (node) => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;

  const visit = (node) => {
    // Response write sites: `<something>.json(...)`, excluding request reads.
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === 'json' &&
      !isRequestRead(node.expression)
    ) {
      found.responses += 1;
      found.sites.push(`${fileName}:${line(node)}`);

      // Facts that only mean something at the ROOT of a response body, so they
      // are read off this call's own object literal rather than the whole module.
      const arg = node.arguments[0];
      if (arg && ts.isObjectLiteralExpression(arg)) {
        for (const prop of arg.properties) {
          if (!ts.isPropertyAssignment(prop) || !ts.isIdentifier(prop.name)) continue;
          const key = prop.name.text;
          const init = prop.initializer;
          // `error` as a bare string — the pre-#3675 dialect.
          if (
            key === 'error' &&
            (ts.isStringLiteral(init) || ts.isTemplateExpression(init) ||
              ts.isNoSubstitutionTemplateLiteral(init))
          ) {
            found.stringError += 1;
          }
          // A literal `ok` is a second word for `success` only where it could BE
          // the flag: a sibling of `success` at the top of the body. The same
          // literal inside `data` is payload — `data: { ok: true }` is what a
          // revoke endpoint legitimately returns, and the dispatcher twin
          // (`runtime/src/domains/share-links.ts`) has always returned it (#3983).
          if (key === 'ok' && (init.kind === ts.SyntaxKind.TrueKeyword || init.kind === ts.SyntaxKind.FalseKeyword)) {
            found.privateOk += 1;
          }
        }
      }
    }

    // The `success` flag counts ANYWHERE in the module, unlike `ok` above: it is
    // the envelope's own flag wherever the body gets built, including the
    // `const body = { success: true, data }; res.json(body)` form that a
    // call-local scan cannot see.
    if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) && node.name.text === 'success') {
      if (node.initializer.kind === ts.SyntaxKind.TrueKeyword) found.ok += 1;
      if (node.initializer.kind === ts.SyntaxKind.FalseKeyword) found.err += 1;
    }

    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

/** Recursively collect candidate route-module paths under `packages/`. */
function discover() {
  const out = [];
  const skip = new Set(['node_modules', 'dist', 'build', '.turbo', '.next', 'coverage']);
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      if (skip.has(entry)) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) { walk(full); continue; }
      if (!entry.endsWith('.ts') || entry.endsWith('.d.ts')) continue;
      if (entry.includes('.test.') || entry.includes('.conformance.')) continue;
      // The repo's naming convention for a route registrar, plus the one
      // module that registers routes from a plugin entry point instead.
      if (entry.endsWith('-routes.ts') || entry === 'i18n-service-plugin.ts') {
        out.push(relative(ROOT, full).split(sep).join('/'));
      }
    }
  };
  walk(join(ROOT, 'packages'));
  return out.sort();
}

function audit() {
  const problems = [];
  const discovered = discover();

  for (const file of discovered) {
    const declared = MODULES[file];
    if (!declared) {
      problems.push(
        `${file}\n    NOT DECLARED. Add it to MODULES in scripts/check-route-envelope.mjs.\n` +
        `    If it emits the envelope, declare { responses: 2, ok: 1, err: 1 }. If it still\n` +
        `    drifts, declare its CURRENT counts plus a \`ratchet\` naming the issue that\n` +
        `    will fix it — never leave a route module unaudited.`,
      );
      continue;
    }
    if (declared.exempt) continue;

    const want = { privateOk: 0, stringError: 0, ...declared };
    const got = scanSource(readFileSync(join(ROOT, file), 'utf8'), file);

    for (const key of ['responses', 'ok', 'err', 'privateOk', 'stringError']) {
      if (got[key] !== want[key]) {
        problems.push(
          `${file}\n    ${key}: found ${got[key]}, declared ${want[key]}` +
          (key === 'responses' && got[key] > want[key]
            ? `\n    A route is building its own body instead of calling the envelope helper.` +
              `\n    Write sites: ${got.sites.join(', ')}`
            : '') +
          (want.ratchet ? `\n    (ratchet for ${want.ratchet} — the declared numbers pin current drift)` : ''),
        );
      }
    }
  }

  for (const file of Object.keys(MODULES)) {
    if (!discovered.includes(file)) {
      problems.push(`${file}\n    declared in MODULES but not found — moved or deleted? Update the table.`);
    }
  }

  if (problems.length) {
    console.error('✗ Route-envelope conformance (#3843)\n');
    for (const p of problems) console.error('  ' + p + '\n');
    console.error(
      'Every REST body must be built by the module\'s sendOk / sendError pair, in the\n' +
      'envelope BaseResponseSchema declares. See scripts/check-route-envelope.mjs.',
    );
    process.exit(1);
  }

  const entries = Object.entries(MODULES);
  const exempt = entries.filter(([, m]) => m.exempt);
  const ratcheted = entries.filter(([, m]) => m.ratchet);
  const conformant = discovered.length - exempt.length - ratcheted.length;
  console.log(
    `✓ Route-envelope conformance — ${discovered.length} module(s) audited: ` +
    `${conformant} conformant, ${ratcheted.length} ratcheted, ${exempt.length} exempt`,
  );
  for (const [file, m] of ratcheted) {
    console.log(`  ⚠ ratchet ${m.ratchet}: ${file} (pinned at current drift, not conformant)`);
  }
  for (const [file, m] of exempt) {
    console.log(`  – exempt: ${file} — ${m.exempt}`);
  }
}

// ── Self-test ────────────────────────────────────────────────────────────────
// Both cases below are regressions the regex predecessor actually had.

function selfTest() {
  const assert = (cond, msg) => { if (!cond) { console.error('✗ self-test: ' + msg); process.exit(1); } };

  const sound = `
    function sendError(res, s, code, message) { res.status(s).json({ success: false, error: { code, message } }); }
    function sendOk(res, data) { res.json({ success: true, data }); }
    http.get('/a', (q, res) => sendOk(res, { a: 1 }));
    http.get('/b', (q, res) => sendError(res, 404, 'NOPE', 'gone'));
  `;
  let r = scanSource(sound);
  assert(r.responses === 2 && r.ok === 1 && r.err === 1, `sound module → ${JSON.stringify(r)}`);

  // (1) A `//` inside a string truncated the rest of the line for the regex
  // version, hiding the response write after it.
  r = scanSource(`const base = 'http://local'; res.json({ success: true, data });`);
  assert(r.responses === 1, `url-in-string must not hide the write site → ${JSON.stringify(r)}`);

  // (2) `c.req.json()` READS a request. The regex version counted it as two
  // unenveloped responses in hmr-routes.ts.
  r = scanSource(`const body = await c.req.json(); const b2 = await req.json();`);
  assert(r.responses === 0, `request reads must not count as responses → ${JSON.stringify(r)}`);

  // Comments quoting both dialects are not code paths.
  r = scanSource(`
    /* Was: res.status(404).json({ error: 'not_found' }); and { ok: true } */
    // res.json({ success: true, data });
    ${sound}
  `);
  assert(r.responses === 2 && r.privateOk === 0 && r.stringError === 0, `comments counted → ${JSON.stringify(r)}`);

  // The pre-#3675 bare-string error.
  r = scanSource(`res.status(503).json({ error: 'datasource_admin_unavailable' });`);
  assert(r.stringError === 1, `bare-string error not caught → ${JSON.stringify(r)}`);

  // A literal `ok` at the top of a body is a second success word.
  r = scanSource(`res.json({ ok: true, key });`);
  assert(r.privateOk === 1, `literal ok not caught → ${JSON.stringify(r)}`);
  // A COMPUTED one is a domain verdict that happens to share the name —
  // `POST /external/validate` reports `ok: results.every(r => r.ok)`.
  r = scanSource(`sendOk(res, { ok: results.every((x) => x.ok), results });`);
  assert(r.privateOk === 0, `computed ok must be left alone → ${JSON.stringify(r)}`);
  // …and a literal one INSIDE `data` is payload, not a competing flag. Both
  // forms below are what a conformant revoke endpoint returns (#3983); the
  // `responses`/`ok`/`err` counts stay the real guarantee that the two writers
  // are the enveloped ones.
  r = scanSource(`res.json({ success: true, data: { ok: true } });`);
  assert(r.privateOk === 0 && r.ok === 1, `nested ok is payload → ${JSON.stringify(r)}`);
  r = scanSource(`${sound}\nhttp.delete('/c', (q, res) => sendOk(res, { ok: true }));`);
  assert(
    r.privateOk === 0 && r.responses === 2 && r.ok === 1 && r.err === 1,
    `ok passed as a helper's data must not count → ${JSON.stringify(r)}`,
  );

  console.log('✓ check-route-envelope self-test passed');
}

if (process.argv.includes('--self-test')) selfTest();
else audit();
