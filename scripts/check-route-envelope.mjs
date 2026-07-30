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
 * ## Two surfaces
 *
 * The platform answers REST from two kinds of file, and this audits both:
 *
 *   1. **Route modules** (`*-routes.ts`) — call `res.json(...)`. Counted below
 *      in `MODULES`.
 *   2. **Dispatcher domains** (`runtime/src/domains/*.ts`) — RETURN
 *      `{ status, body }` for a central sender, so they never call `res.json`
 *      and the first scan cannot see them. Counted in `DISPATCHER_DOMAINS`.
 *
 * Surface 2 was added after that blind spot cost something real: `/share-links`
 * emitted its payload under both `data` and a legacy `link` / `links` for as
 * long as nothing looked, and it was found by hand while sweeping consumers for
 * #3983 rather than by any guard (#4038).
 *
 * ## Why a whole-repo scan rather than a per-module test
 *
 * The load-bearing check is structural, not per-route: it COUNTS the sites where
 * a response gets built. When every body in a module goes through its `sendOk` /
 * `sendError` pair, that count is fixed at two and does not grow with the route
 * list — so a *new* route that hand-rolls a body moves the count and fails here,
 * which is the one thing a driven-body test can never cover (it can only drive
 * the routes that existed the day it was written). The domain table applies the
 * same idea from the other end: a domain that answers only through the `deps.*`
 * helpers hand-builds zero responses, so any hand-built one has to be classified.
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

// ── The dispatcher's OTHER surface ───────────────────────────────────────────

/**
 * `packages/runtime/src/domains/*.ts` — the dispatcher domain handlers.
 *
 * These serve REST paths too, but they never call `res.json(...)`: they RETURN
 * `{ status, body }` for a central sender. So the scan above cannot see them, by
 * construction — which is not a theoretical gap. `/share-links` emitted the
 * payload under both `data` and a legacy `link` / `links` for as long as that
 * blind spot existed, and it was found by hand while sweeping consumers for
 * #3983, not by any guard (#4038).
 *
 * The structural fact here is the mirror of `responses` above. A domain that
 * routes every answer through the `deps.success` / `deps.error` /
 * `deps.routeNotFound` / `deps.errorFromThrown` helpers hand-builds **zero**
 * response literals, and cannot drift: the envelope lives in one place for all
 * of them. So this counts hand-built `response: { … }` object literals per file,
 * and a new one has to be classified rather than merged quietly.
 *
 *   handBuilt — `response:` assigned an object literal instead of a `deps.*` call
 *   note      — why those exist. REQUIRED whenever handBuilt > 0.
 *   ratchet   — set when one of them is real, tracked drift.
 *
 * Hand-building is not automatically wrong. Four kinds show up, and only the
 * last is drift:
 *
 *   1. Enveloped, but the helper cannot express the response. `deps.success`
 *      hardcodes status 200, so a 201 must be built by hand, and `deps.error`
 *      carries no headers, so a 405 with `Allow:` must be too. These emit the
 *      declared envelope — they just assemble it themselves.
 *   2. Passthrough of a body this dispatcher does not own (an upstream Web
 *      Response, another service's result). The envelope does not govern bytes
 *      we are only relaying.
 *   3. A foreign wire format a client library requires — `/auth` answers
 *      better-auth's shapes because better-auth's client parses them.
 *   4. Drift.
 */
const DISPATCHER_DOMAIN_DIR = 'packages/runtime/src/domains';

const DISPATCHER_DOMAINS = {
  'actions.ts': { handBuilt: 0 },
  'analytics.ts': { handBuilt: 0 },
  'automation.ts': { handBuilt: 0 },
  'data.ts': { handBuilt: 0 },
  'i18n.ts': { handBuilt: 0 },
  'meta.ts': { handBuilt: 0 },
  'notifications.ts': { handBuilt: 0 },
  'packages.ts': { handBuilt: 0 },
  'security.ts': { handBuilt: 0 },
  // No `storage.ts` — the `/storage` domain was retired in #4087 (it called
  // the storage contract with the wrong arity and read a Buffer as a
  // descriptor). `/api/v1/storage` is service-storage's surface; its envelope
  // is audited in that package's own routes, not here.
  'ui.ts': { handBuilt: 0 },

  // Kind 1 — enveloped, hand-built only because the helper cannot say it.
  'keys.ts': {
    handBuilt: 1,
    note: 'POST /keys is a 201 and `deps.success` hardcodes 200; the body is the declared envelope',
  },
  'share-links.ts': {
    handBuilt: 1,
    note: 'POST /share-links is a 201, same reason as /keys (#4038 removed the duplicate key it also carried)',
  },

  // Kinds 1 and 2 together.
  'mcp.ts': {
    handBuilt: 2,
    note: 'one 405 that must carry an `Allow:` header (`deps.error` takes none) and emits the declared envelope; one passthrough of the upstream MCP Web Response',
  },

  // Kind 3 — a foreign wire format, all four in the mock/fallback path.
  // [#4113] Was 4, for the mock fallback's better-auth-shaped bodies
  // (`{ user, session }`, `{ session: null, user: null }`, `{ success: true }`).
  // That mock is deleted — it fabricated a 200 + a 24h session for any
  // credentials — so the exemption it needed is gone with it. What remains is
  // the real service's own `Response`, returned as `result` rather than built
  // here, plus one `deps.error` 501.
  'auth.ts': { handBuilt: 0 },

  // Kind 2 — the `{ agents: [] }` fallback moved onto `deps.success` in #4053;
  // what remains is the passthrough of the AI service's own result.
  'ai.ts': {
    handBuilt: 1,
    note: "passthrough of the AI service result (status and body are the service's, streaming included)",
  },
};

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

/**
 * Count hand-built response literals in one dispatcher domain's source.
 *
 * `response: { … }` is hand-built; `response: deps.success(…)` is not. Comments
 * and strings are not tokens, so quoting either form in prose cannot move the
 * count.
 *
 * Only a `response` that is a sibling of `handled` counts — that pair IS the
 * `HttpDispatcherResult`. A payload field that happens to be named `response`
 * (`deps.success({ response: … })`) is data, not a response, and the self-test
 * pins the difference: matching the key alone counted it.
 *
 * @param {string} source TypeScript source text.
 * @returns {{handBuilt: number, sites: string[]}}
 */
export function scanDomainSource(source, fileName = 'domain.ts') {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const found = { handBuilt: 0, sites: [] };

  const isDispatcherResult = (obj) =>
    ts.isObjectLiteralExpression(obj) &&
    obj.properties.some(
      (p) => ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === 'handled',
    );

  const visit = (node) => {
    if (
      ts.isPropertyAssignment(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'response' &&
      ts.isObjectLiteralExpression(node.initializer) &&
      isDispatcherResult(node.parent)
    ) {
      found.handBuilt += 1;
      found.sites.push(`${fileName}:${sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

/** Domain handler files, by basename. */
function discoverDomains() {
  return readdirSync(join(ROOT, DISPATCHER_DOMAIN_DIR))
    .filter((n) => n.endsWith('.ts') && !n.endsWith('.d.ts') && !n.includes('.test.') && !n.includes('.conformance.'))
    .sort();
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

  // ── The dispatcher domains ────────────────────────────────────────────────
  const domains = discoverDomains();

  for (const name of domains) {
    const declared = DISPATCHER_DOMAINS[name];
    if (!declared) {
      problems.push(
        `${DISPATCHER_DOMAIN_DIR}/${name}\n    NOT DECLARED. Add it to DISPATCHER_DOMAINS in\n` +
        `    scripts/check-route-envelope.mjs. A domain that answers only through the\n` +
        `    \`deps.*\` helpers declares { handBuilt: 0 }; any hand-built response needs a\n` +
        `    \`note\` saying which of the four kinds it is.`,
      );
      continue;
    }
    const got = scanDomainSource(readFileSync(join(ROOT, DISPATCHER_DOMAIN_DIR, name), 'utf8'), name);
    if (got.handBuilt !== declared.handBuilt) {
      problems.push(
        `${DISPATCHER_DOMAIN_DIR}/${name}\n    handBuilt: found ${got.handBuilt}, declared ${declared.handBuilt}` +
        (got.handBuilt > declared.handBuilt
          ? `\n    A handler is assembling its own response instead of returning a \`deps.*\`\n` +
            `    envelope. If that is deliberate (a status or header the helper cannot\n` +
            `    express, or a body this dispatcher only relays), raise the count and say\n` +
            `    which in \`note\`. Sites: ${got.sites.join(', ')}`
          : `\n    Fewer than declared — if a hand-built response moved onto \`deps.*\`, lower\n` +
            `    the count (and drop the \`ratchet\` if that was the drift it named).`) +
        (declared.ratchet ? `\n    (ratchet for ${declared.ratchet} — the declared count pins current drift)` : ''),
      );
    }
    if (declared.handBuilt > 0 && !declared.note) {
      problems.push(
        `${DISPATCHER_DOMAIN_DIR}/${name}\n    declares handBuilt: ${declared.handBuilt} with no \`note\`.\n` +
        `    A hand-built response has to say why it is not a \`deps.*\` call.`,
      );
    }
  }

  for (const name of Object.keys(DISPATCHER_DOMAINS)) {
    if (!domains.includes(name)) {
      problems.push(
        `${DISPATCHER_DOMAIN_DIR}/${name}\n    declared in DISPATCHER_DOMAINS but not found — moved or deleted?`,
      );
    }
  }

  if (problems.length) {
    console.error('✗ Route-envelope conformance (#3843)\n');
    for (const p of problems) console.error('  ' + p + '\n');
    console.error(
      'Every REST body must be built in ONE place per surface, in the envelope\n' +
      'BaseResponseSchema declares — a route module\'s sendOk / sendError pair, or a\n' +
      'dispatcher domain\'s deps.* helpers. See scripts/check-route-envelope.mjs.',
    );
    process.exit(1);
  }

  const entries = Object.entries(MODULES);
  const exempt = entries.filter(([, m]) => m.exempt);
  const ratcheted = entries.filter(([, m]) => m.ratchet);
  const conformant = discovered.length - exempt.length - ratcheted.length;
  console.log(
    `✓ Route-envelope conformance — ${discovered.length} route module(s) audited: ` +
    `${conformant} conformant, ${ratcheted.length} ratcheted, ${exempt.length} exempt`,
  );
  for (const [file, m] of ratcheted) {
    console.log(`  ⚠ ratchet ${m.ratchet}: ${file} (pinned at current drift, not conformant)`);
  }
  for (const [file, m] of exempt) {
    console.log(`  – exempt: ${file} — ${m.exempt}`);
  }

  const dEntries = Object.entries(DISPATCHER_DOMAINS);
  const dRatcheted = dEntries.filter(([, m]) => m.ratchet);
  const helperOnly = dEntries.filter(([, m]) => m.handBuilt === 0);
  console.log(
    `✓ Dispatcher domains — ${domains.length} audited: ` +
    `${helperOnly.length} helper-only, ${dEntries.length - helperOnly.length} with declared hand-built responses ` +
    `(${dRatcheted.length} ratcheted)`,
  );
  for (const [name, m] of dRatcheted) {
    console.log(`  ⚠ ratchet ${m.ratchet}: ${DISPATCHER_DOMAIN_DIR}/${name} — ${m.note}`);
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

  // ── Dispatcher domains ────────────────────────────────────────────────────
  // A domain that answers only through the helpers hand-builds nothing.
  let d = scanDomainSource(`
    if (m === 'GET') return { handled: true, response: deps.success(rows) };
    if (m === 'DELETE') return { handled: true, response: deps.success({ ok: true }) };
    return { handled: true, response: deps.routeNotFound('/x') };
  `);
  assert(d.handBuilt === 0, `helper-only domain → ${JSON.stringify(d)}`);

  // An assembled literal is what the count is for — this is how /share-links
  // carried a duplicate `link` beside `data` unseen (#4038).
  d = scanDomainSource(`return { handled: true, response: { status: 201, body: { success: true, data: link, link } } };`);
  assert(d.handBuilt === 1, `hand-built response not caught → ${JSON.stringify(d)}`);

  // Both forms in one file, counted once each.
  d = scanDomainSource(`
    if (a) return { handled: true, response: deps.success(x) };
    if (b) return { handled: true, response: { status: 405, headers: { Allow: 'GET' }, body } };
    return { handled: true, response: { status: 200, body: { agents: [] } } };
  `);
  assert(d.handBuilt === 2, `mixed domain miscounted → ${JSON.stringify(d)}`);

  // Prose quoting either form is not code — the note fields in the table above
  // quote both, and must not move anyone's count.
  d = scanDomainSource(`
    /* was: response: { status: 200, body: { agents: [] } } — see #4053 */
    // return { handled: true, response: { status: 201, body } };
    return { handled: true, response: deps.success(x) };
  `);
  assert(d.handBuilt === 0, `commented-out responses counted → ${JSON.stringify(d)}`);

  // A nested `response` key inside a payload is not a response assignment.
  d = scanDomainSource(`return { handled: true, response: deps.success({ response: { status: 'queued' } }) };`);
  assert(d.handBuilt === 0, `a data field named response must not count → ${JSON.stringify(d)}`);

  console.log('✓ check-route-envelope self-test passed');
}

if (process.argv.includes('--self-test')) selfTest();
else audit();
