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
 * cannot: **a module nobody thought to convert still gets audited.** Both
 * modules in the RATCHET table below were found that way — neither is in
 * #3843's hand-written survey.
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
 *   privateOk  — literal `ok: true|false`, a second word for `success` (#3689)
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

  // ── Ratchets: real, tracked, NOT blessed ────────────────────────────────

  // The error half IS consolidated behind `sendError` (#3675). The success half
  // is not: each of four read routes builds `{ success: true, data }` inline.
  // Those bodies are CORRECT — `packages/runtime/src/i18n-success-envelope
  // .conformance.test.ts` drives them — so this is not envelope drift. It is an
  // unconsolidated builder, i.e. a weaker guard: a fifth read route could get
  // the shape wrong and only a driven test would notice.
  'packages/services/service-i18n/src/i18n-service-plugin.ts': {
    responses: 5, ok: 4, err: 1, ratchet: '#3973',
  },

  // Found BY THIS SCAN, absent from #3843's survey — the fifth drifting module.
  // `sendError` already nests `{ code, message }` (that is why #3675's changeset
  // cited it as a good example), but NO body carries the `success` flag, and one
  // answers `{ ok: true }` — the private second word #3689 retired from storage.
  // Converting it is breaking for share-link consumers and needs its own
  // consumer sweep, exactly as #3687 did; it is not riding along with #3843.
  'packages/plugins/plugin-sharing/src/share-link-routes.ts': {
    responses: 6, ok: 0, err: 0, privateOk: 1, ratchet: '#3983',
  },
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

      // Is the first argument an object literal whose `error` is a bare string?
      const arg = node.arguments[0];
      if (arg && ts.isObjectLiteralExpression(arg)) {
        for (const prop of arg.properties) {
          if (
            ts.isPropertyAssignment(prop) &&
            ts.isIdentifier(prop.name) &&
            prop.name.text === 'error' &&
            (ts.isStringLiteral(prop.initializer) || ts.isTemplateExpression(prop.initializer) ||
              ts.isNoSubstitutionTemplateLiteral(prop.initializer))
          ) {
            found.stringError += 1;
          }
        }
      }
    }

    // Literal envelope flags, anywhere in the module.
    if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name)) {
      const key = node.name.text;
      const kind = node.initializer.kind;
      const isTrue = kind === ts.SyntaxKind.TrueKeyword;
      const isFalse = kind === ts.SyntaxKind.FalseKeyword;
      if (key === 'success' && isTrue) found.ok += 1;
      if (key === 'success' && isFalse) found.err += 1;
      // A COMPUTED `ok` is a domain verdict that happens to share the name —
      // `POST /external/validate` reports `ok: results.every(r => r.ok)`. Only a
      // literal is a second envelope flag.
      if (key === 'ok' && (isTrue || isFalse)) found.privateOk += 1;
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

  // A literal `ok` is a second success word; a COMPUTED one is a domain verdict.
  r = scanSource(`res.json({ ok: true, key });`);
  assert(r.privateOk === 1, `literal ok not caught → ${JSON.stringify(r)}`);
  r = scanSource(`sendOk(res, { ok: results.every((x) => x.ok), results });`);
  assert(r.privateOk === 0, `computed ok must be left alone → ${JSON.stringify(r)}`);

  console.log('✓ check-route-envelope self-test passed');
}

if (process.argv.includes('--self-test')) selfTest();
else audit();
