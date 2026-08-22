#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Auth mount-vs-ledger gate (#10534 follow-up 4).
 *
 *   node scripts/check-auth-mount-ledger.mjs
 *   node scripts/check-auth-mount-ledger.mjs --self-test
 *   node scripts/check-auth-mount-ledger.mjs --report    # print the census
 *
 * ## What it guards
 *
 * `auth-plugin.ts` mounts routes DIRECTLY on the raw Hono app, ahead of the
 * better-auth catch-all. Those mounts are the ObjectStack-owned auth surface:
 * the catch-all never sees them, so the vendor's own route table cannot account
 * for them, and `auth.api`'s enumeration -- which is what
 * `auth-route-ledger.conformance.test.ts` drives -- cannot see them either.
 *
 * A mount under `basePath` with NO row in either half of the ledger is
 * therefore invisible to every check that exists. That state is not
 * hypothetical: it is what produced #9941 (`organization/add-member` mounted,
 * ledgered nowhere) and #10050 (the same route mounted and undocumented), and
 * the #10534 census found it was not a one-off -- NINE of the seventeen mounts
 * were in neither half.
 *
 * ## Why a gate and not another hand-written pin
 *
 * The pin `auth-route-ledger.conformance.test.ts` already carries -- "the
 * objectstack-mounted rows are the ones auth-plugin.ts serves itself" --
 * asserts the `source: 'objectstack'` set EXACTLY, so it fails when a row
 * DISAPPEARS. What it structurally cannot do is fail when a MOUNT APPEARS with
 * no row, because BOTH sides of it are hand-written: the mount list in that
 * assertion is a copy of the truth, not a reading of it. Nobody who adds route
 * 18 has to touch it.
 *
 * The missing half is the one this gate supplies: enumerate the mounts FROM
 * `auth-plugin.ts` SOURCE and diff them against the ledger. #10534 established
 * that this enumeration is mechanically reliable -- the same expression
 * reproduced 17 of 17 across two different commits, and again on `bbe643c08`
 * when this gate was written.
 *
 * ## The four constraints this gate is built to, all measured on #10660
 *
 * 1. THE MATCH NEEDS A RIGHT BOUNDARY. #10534's own leg 1 read "5 undocumented"
 *    when the truth was 6, because it matched by SUBSTRING and
 *    `/admin/sso/register` is a strict prefix of `/admin/sso/register-saml`:
 *    the shorter route was scored "documented" on the strength of its longer
 *    sibling's URL. Accounting here is EXACT STRING EQUALITY on
 *    `METHOD /full/wire/path`, so a prefix can never be credited to a sibling.
 *    When an unaccounted mount does stand in a prefix relation to a ledgered
 *    route, the finding SAYS SO -- the property is observable in the output,
 *    not merely implicit in the comparison operator. `--self-test` pins both
 *    directions of it.
 *
 * 2. `rawApp.all` AND `rawApp.use` ARE EXCLUDED. The better-auth catch-all is
 *    an `.all(`${basePath}/*`)` and the IP gate is a `.use(`${basePath}/*`)`;
 *    both would otherwise read as unledgered mounts. They are not routes, they
 *    are the lanes routes arrive through.
 *
 * 3. A DISPOSITION CANNOT BE INFERRED MECHANICALLY, so this gate does not try,
 *    and -- more importantly -- it refuses to be satisfied by a row that
 *    merely EXISTS. See "Why a row is not enough" below.
 *
 * 4. A PARTIAL READ MUST NOT REPORT AS A COMPLETE ONE. Every way of mounting on
 *    `rawApp` that this gate cannot read per-route is a FINDING, never a silent
 *    skip: an unrecognised verb (`rawApp.on(...)`, `rawApp.route(...)`), a
 *    first argument that is not a readable path, an unresolved interpolation.
 *    Refusals -- a missing file, a moved anchor, a `basePath` that cannot be
 *    derived, a parse that yields zero of anything -- exit 2 and print
 *    NOT MEASURED. Exit 2 is not a pass and must never be read as one.
 *
 * ## Why a row is not enough
 *
 * The judgement this gate forces onto whoever adds route 18 is exactly the one
 * #10660 refused to guess at and escalated: `POST /api/v1/auth/set-initial-password`
 * had two available words and both were false. `server-only` is a CLAIM ABOUT
 * INTENT, and its intent was contradicted by the route's own neighbourhood;
 * `gap` described the situation accurately but is ratcheted to <= 0, so filing
 * it would have reversed a ratchet rather than recorded a number. The
 * maintainer ruled option C (2026-08-22): bind it into the SDK first (#10974),
 * then ledger it (#10975).
 *
 * A gate that can be satisfied by pasting a row teaches the next author to
 * paste a row. So the accounting half is backed by a RATIONALE half: an
 * `source: 'objectstack'` row must carry the evidence its disposition claims --
 * `client:` for `sdk` (the method that builds the URL), a substantive `note:`
 * for `server-only`/`disabled`/`public` (who builds the URL instead, and why
 * the SDK deliberately does not). The note floor is a FLOOR, not a proof: it
 * exists so that pasting is not the cheapest path, and the real review is the
 * PR. What it does buy mechanically is that the cheapest path is no longer
 * "add three words and move on".
 *
 * ## PENDING_DISPOSITION, and why it can only shrink
 *
 * A mount whose disposition is genuinely undecided must not be silently
 * exempt, and must not force a false row either. It goes in
 * `PENDING_DISPOSITION` with the ISSUE NUMBER where it is being decided, and
 * the gate PRINTS it on every clean run -- an open question stays visible
 * instead of becoming a green tree. The list is reconciled in both directions:
 * an entry whose mount is gone fails, an entry whose route has since been
 * ledgered fails (that is how landing the decision ratchets the list down),
 * and an entry with no issue reference fails. Its length is a shrink-only
 * ratchet. The repair for a red ratchet is to land the disposition; raising
 * `PENDING_MAX` is a maintainer decision, never the co-equal option.
 *
 * ## Why textual, and why source rather than a built artifact
 *
 * The same reasoning `check-error-code-casing` and
 * `check-dispatcher-error-vocabulary` record: the subject is a string literal
 * in a small set of syntactic positions. Both inputs are read as SOURCE TEXT
 * from `packages/plugins/plugin-auth/src/` -- there is no import, no module
 * resolution, no `exports` field and therefore no `dist/` between the edit and
 * the reading. That is a property, not a convenience: it is why this gate runs
 * correctly on an unbuilt worktree, and why an ablation of either input needs
 * no rebuild to be measured.
 */

import { readFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { maskComments } from './js-comment-mask.mjs';
import { isEntrypoint } from './invoked-as.mjs';

const ROOT = resolve(new URL('..', import.meta.url).pathname);

/** The two inputs. Module-scope literals, so `dispatch-gates` derives this
 *  family for a diff touching either of them (#10309: a gate nothing can
 *  derive is a gate that runs only when someone remembers it). */
const MOUNT_SOURCE = 'packages/plugins/plugin-auth/src/auth-plugin.ts';
const LEDGER_SOURCE = 'packages/plugins/plugin-auth/src/auth-route-ledger.ts';

export const EXIT_CLEAN = 0;
export const EXIT_FINDINGS = 1;
export const EXIT_NOT_MEASURED = 2;

/**
 * Mounts whose disposition is open, each naming the issue deciding it.
 *
 * SHRINK-ONLY. `PENDING_MAX` is the ratchet; landing a disposition removes an
 * entry and the gate then fails if the entry is still here.
 */
export const PENDING_DISPOSITION = [
  {
    route: 'POST /api/v1/auth/set-initial-password',
    issue: '#10975',
    why:
      'Disposition escalated on #10534 rather than guessed: `server-only` would claim an intent ' +
      "the route's own peer group contradicts (its three sibling URLs in the same createAuthClient " +
      'are all ledgered `sdk`), and `gap` is ratcheted to <= 0. Maintainer ruling 2026-08-22: ' +
      'option C -- add `auth.setInitialPassword` to ObjectStackClient (#10974), THEN ledger the ' +
      'row as `sdk` (#10975, blocked-by #10974). This entry is deleted by #10975.',
  },
];

/** Shrink-only. Raising it is a maintainer decision, not a repair. */
export const PENDING_MAX = 1;

/** A `note:` shorter than this is not evidence. A floor, not a proof. */
export const MIN_NOTE_CHARS = 60;

/** Hono verbs that mount ONE route, which is the only thing a ledger row can describe. */
const PER_ROUTE_VERBS = new Set(['get', 'post', 'put', 'patch', 'delete', 'options', 'head']);

/** Deliberately excluded (#10534 constraint 3): lanes, not routes. */
const LANE_VERBS = new Set(['all', 'use']);

// ---------------------------------------------------------------------------
// Reading the mount source
// ---------------------------------------------------------------------------

/**
 * The auth base path, DERIVED from the plugin rather than re-typed here, so a
 * rename moves this gate with it instead of silently emptying its population.
 */
export function deriveBasePath(mountSource) {
  const masked = maskComments(mountSource);
  const m = /basePath\s*=\s*this\.options\.basePath\s*(?:\|\||\?\?)\s*'([^']+)'/.exec(masked);
  return m ? m[1] : null;
}

/**
 * Read the first argument of a call, starting at the text just after `(`.
 * Returns `{ kind, text }` where kind is 'template' | 'string', or null when
 * the argument is not a literal this gate can read -- which is a FINDING at the
 * call site, never a skip.
 */
export function readFirstArgLiteral(rest) {
  let i = 0;
  while (i < rest.length && /\s/.test(rest[i])) i += 1;
  const quote = rest[i];
  if (quote !== '`' && quote !== "'" && quote !== '"') return null;
  let out = '';
  for (let j = i + 1; j < rest.length; j += 1) {
    const ch = rest[j];
    if (ch === '\\') { out += ch + (rest[j + 1] ?? ''); j += 1; continue; }
    if (ch === quote) return { kind: quote === '`' ? 'template' : 'string', text: out };
    if (ch === '\n' && quote !== '`') return null;
    out += ch;
  }
  return null;
}

/**
 * Every `rawApp.<x>(...)` call, classified. Comments are masked first, so a
 * commented-out mount is not a mount (that direction is pinned in --self-test).
 */
export function deriveMounts({ source, basePath }) {
  const masked = maskComments(source);
  const mounts = [];
  const lanes = [];
  const wildcards = [];
  const unreadable = [];

  const lineOf = (index) => masked.slice(0, index).split('\n').length;

  for (const m of masked.matchAll(/\brawApp\s*\.\s*([A-Za-z_$][\w$]*)\s*\(/g)) {
    const verb = m[1];
    const line = lineOf(m.index);

    if (LANE_VERBS.has(verb)) { lanes.push({ verb, line }); continue; }
    if (!PER_ROUTE_VERBS.has(verb)) {
      unreadable.push({
        line,
        text:
          `rawApp.${verb}(...) at ${MOUNT_SOURCE}:${line} is not a per-route verb this gate can ` +
          `read. A mount reached this way is invisible to the census, so it is reported rather ` +
          `than skipped. Express it with a verb method, or teach this gate to read it.`,
      });
      continue;
    }

    const arg = readFirstArgLiteral(masked.slice(m.index + m[0].length));
    if (arg === null) {
      unreadable.push({
        line,
        text:
          `rawApp.${verb}(...) at ${MOUNT_SOURCE}:${line} has a first argument that is not a ` +
          `readable path literal, so the route it mounts cannot be enumerated.`,
      });
      continue;
    }

    let path;
    if (arg.kind === 'template') {
      if (!arg.text.startsWith('${basePath}')) continue; // not under basePath (e.g. /.well-known)
      const tail = arg.text.slice('${basePath}'.length);
      if (tail.includes('${')) {
        unreadable.push({
          line,
          text:
            `rawApp.${verb}(\`\${basePath}${tail}\`) at ${MOUNT_SOURCE}:${line} interpolates a ` +
            `value this gate cannot resolve, so its wire path is unknown.`,
        });
        continue;
      }
      path = basePath + tail;
    } else {
      if (!arg.text.startsWith(basePath + '/')) continue; // not under basePath
      path = arg.text;
    }

    if (!path.startsWith(basePath + '/')) continue;
    if (path.includes('*') || path.includes(':')) { wildcards.push({ verb, path, line }); continue; }

    mounts.push({ route: `${verb.toUpperCase()} ${path}`, line, verb, path });
  }

  mounts.sort((a, b) => a.route.localeCompare(b.route));
  return { mounts, lanes, wildcards, unreadable };
}

// ---------------------------------------------------------------------------
// Reading the ledger
// ---------------------------------------------------------------------------

/**
 * The text between `<name> ... = [` and its MATCHING `]`, by bracket depth with
 * string literals skipped.
 *
 * Not by searching for a `];` at column 0, which is the spelling this was first
 * written with and which REFUSED on the real file: both arrays in
 * `auth-route-ledger.ts` close as `,];` on the last row's own line, so there is
 * no newline before the bracket. That refusal is the design working -- a parse
 * that cannot find its anchor exits 2 rather than reporting an empty population
 * as a clean tree -- but the parse still has to be right.
 */
export function arrayBody(source, name) {
  const open = new RegExp(`\\b${name}\\b[^=\\n]*=\\s*\\[`).exec(source);
  if (!open) return null;
  const from = open.index + open[0].length;
  let depth = 1;
  for (let i = from; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === "'" || ch === '"' || ch === '`') {
      for (i += 1; i < source.length; i += 1) {
        if (source[i] === '\\') { i += 1; continue; }
        if (source[i] === ch) break;
      }
      continue;
    }
    if (ch === '[' || ch === '{' || ch === '(') depth += 1;
    else if (ch === ']' || ch === '}' || ch === ')') {
      depth -= 1;
      if (depth === 0) return source.slice(from, i);
    }
  }
  return null;
}

/** Read a single-quoted TS string that follows `<key>:`, honouring backslash escapes. */
export function readValue(line, key) {
  const at = line.indexOf(`${key}:`);
  if (at === -1) return null;
  const rest = line.slice(at + key.length + 1);
  return readFirstArgLiteral(rest)?.text ?? null;
}

/** Unescape just enough to measure a note honestly (`\'` is one character). */
export function unescape(text) {
  return text.replace(/\\(.)/g, '$1');
}

export function parseLedgerRows(ledgerSource) {
  const body = arrayBody(maskComments(ledgerSource), 'AUTH_ROUTE_LEDGER');
  if (body === null) return null;
  const rows = [];
  for (const line of body.split('\n')) {
    if (!/\{\s*route:\s*['"`]/.test(line)) continue;
    const route = readValue(line, 'route');
    if (!route) continue;
    rows.push({
      route,
      source: readValue(line, 'source'),
      disposition: readValue(line, 'disposition'),
      client: readValue(line, 'client'),
      note: readValue(line, 'note'),
    });
  }
  return rows;
}

export function parseVendorSurface(ledgerSource) {
  const body = arrayBody(maskComments(ledgerSource), 'BETTER_AUTH_MOUNTED_SURFACE');
  if (body === null) return null;
  return body.split('\n').map((l) => readFirstArgLiteral(l.trim())?.text).filter(Boolean);
}

// ---------------------------------------------------------------------------
// Reconciliation
// ---------------------------------------------------------------------------

/** The block every unaccounted mount carries. Constraint 3: a row is not enough. */
function dispositionDemand(route) {
  return [
    `  A ROW IS NOT ENOUGH. \`${route}\` needs a DISPOSITION and the evidence for it:`,
    '',
    "    sdk          `client:` naming the ObjectStackClient method that builds this URL.",
    '                 The method must exist -- a row naming one that does not is verbatim what',
    '                 packages/client/src/route-ledger-coverage.test.ts was written to catch.',
    "    server-only  A CLAIM ABOUT INTENT, so `note:` must carry the measurement behind it:",
    '                 who builds this URL instead, and why the SDK deliberately does not.',
    "    gap          Ratcheted to <= 0 by auth-route-ledger.conformance.test.ts's",
    "                 'gap and mismatch counts only shrink'. Filing a row here REVERSES a",
    '                 ratchet; it does not record a number.',
    '',
    '  The discriminator is the PEER GROUP, not convenience. Measure who else builds the',
    "  sibling URLs: `/admin/import-users` is honestly `server-only` because its peers",
    '  (`/admin/create-user`, `/admin/ban-user`, `/admin/set-user-password`) are uniformly',
    '  SDK-absent, while `/set-initial-password` is NOT, because its three siblings in the',
    '  same createAuthClient are uniformly `sdk` (#10534, maintainer ruling 2026-08-22).',
    '',
    '  IF YOU CANNOT DECIDE, DO NOT PICK THE NEAREST ALLOWED WORD. File the question, then',
    `  add \`${route}\` to PENDING_DISPOSITION in ${'scripts/check-auth-mount-ledger.mjs'} with`,
    '  that issue number. An open question stays printed on every run; a guessed row does not.',
  ].join('\n');
}

export function reconcile({ mounts, lanes, wildcards, unreadable, rows, vendorSurface, pending = PENDING_DISPOSITION }) {
  const findings = [];

  for (const u of unreadable) findings.push({ kind: 'unreadable-mount', text: u.text });

  const ledgered = new Map(rows.map((r) => [r.route, r]));
  const vendor = new Set(vendorSurface);
  const pendingByRoute = new Map(pending.map((p) => [p.route, p]));
  const mountedRoutes = new Set(mounts.map((m) => m.route));

  // ---- Accounting. EXACT equality: a prefix is never credited to a sibling.
  const shadowed = [];
  for (const mount of mounts) {
    if (ledgered.has(mount.route)) continue;
    if (vendor.has(mount.route)) { shadowed.push(mount.route); continue; }
    if (pendingByRoute.has(mount.route)) continue;

    // The right-boundary property, said out loud rather than left implicit.
    const prefixOf = [...ledgered.keys(), ...vendor]
      .filter((r) => r !== mount.route && r.startsWith(mount.route))
      .sort();
    const boundary = prefixOf.length
      ? '\n' + [
        `  NOT CREDITED, DELIBERATELY: \`${mount.route}\` is a strict PREFIX of ` +
          `${prefixOf.map((r) => `\`${r}\``).join(', ')}.`,
        '  Matching without a right boundary would score this route accounted-for on the',
        "  strength of its longer sibling's row. That is the exact artifact that made #10534's",
        '  own census read 5 when the truth was 6. A sibling is not a row.',
      ].join('\n')
      : '';

    findings.push({
      kind: 'unaccounted-mount',
      text:
        `${mount.route}\n` +
        `  Mounted at ${MOUNT_SOURCE}:${mount.line}, and in NEITHER half of ${LEDGER_SOURCE}.\n` +
        `  This is the state that produced #9941 and #10050: the catch-all never sees a raw\n` +
        `  mount, so nothing else in this tree can notice it.\n${boundary}\n` +
        dispositionDemand(mount.route),
    });
  }

  // ---- The rationale half: a row must carry the evidence its disposition claims.
  for (const row of rows) {
    if (row.source !== 'objectstack') continue;
    if (!mountedRoutes.has(row.route)) {
      findings.push({
        kind: 'orphan-objectstack-row',
        text:
          `${row.route} carries source: 'objectstack' but ${MOUNT_SOURCE} mounts no such route. ` +
          `Either the mount was removed (delete the row) or its path moved (update the row).`,
      });
    }
    if (!row.disposition) {
      findings.push({ kind: 'row-without-disposition', text: `${row.route} declares no disposition.` });
      continue;
    }
    if (row.disposition === 'sdk' && !row.client) {
      findings.push({
        kind: 'row-without-rationale',
        text: `${row.route} is disposition: 'sdk' with no \`client:\`. An 'sdk' row must name the method that builds the URL.`,
      });
    }
    if (row.disposition !== 'sdk') {
      const note = row.note ? unescape(row.note) : '';
      if (note.length < MIN_NOTE_CHARS) {
        findings.push({
          kind: 'row-without-rationale',
          text:
            `${row.route} is disposition: '${row.disposition}' with ${note ? `a ${note.length}-character` : 'no'} ` +
            `\`note:\`. A non-'sdk' disposition on an ObjectStack mount is a claim about INTENT, and the note is ` +
            `where its evidence lives: who builds this URL instead, and why the SDK deliberately does not. ` +
            `(The ${MIN_NOTE_CHARS}-character floor is a floor, not a proof -- it exists so that pasting a row ` +
            `is not the cheapest path.)`,
        });
      }
    }
  }

  // ---- PENDING_DISPOSITION, reconciled in both directions.
  if (pending.length > PENDING_MAX) {
    findings.push({
      kind: 'pending-ratchet',
      text:
        `PENDING_DISPOSITION holds ${pending.length} entries and PENDING_MAX is ${PENDING_MAX}. ` +
        `This ratchet only shrinks: the repair is to land a disposition and delete an entry. ` +
        `Raising PENDING_MAX is a maintainer decision, never the co-equal option.`,
    });
  }
  for (const p of pending) {
    if (!/#\d+/.test(p.issue ?? '')) {
      findings.push({
        kind: 'pending-without-issue',
        text: `PENDING_DISPOSITION entry ${p.route} names no issue. An undecided disposition must point at where it is being decided.`,
      });
    }
    if (!mountedRoutes.has(p.route)) {
      findings.push({
        kind: 'stale-pending',
        text: `PENDING_DISPOSITION entry ${p.route} is no longer mounted in ${MOUNT_SOURCE}. Delete it.`,
      });
    }
    if (ledgered.has(p.route) || vendor.has(p.route)) {
      findings.push({
        kind: 'resolved-pending',
        text:
          `PENDING_DISPOSITION entry ${p.route} now HAS a ledger row (${p.issue} landed). ` +
          `Delete the entry -- that is how the ratchet comes down.`,
      });
    }
  }

  findings.sort((a, b) => a.text.localeCompare(b.text));
  return { findings, shadowed: shadowed.sort(), lanes, wildcards };
}

// ---------------------------------------------------------------------------
// Self-test
// ---------------------------------------------------------------------------

const FIXTURE_BASE = '/api/v1/auth';
const FIXTURE_PREAMBLE = "    const basePath = this.options.basePath || '/api/v1/auth';\n";

/** A ledger fixture: rows in, source text out, in the real one-row-per-line shape. */
function ledgerFixture(rows, surface = []) {
  const body = rows
    .map((r) => '  { ' + Object.entries(r).map(([k, v]) => `${k}: '${v.replace(/'/g, "\\'")}'`).join(', ') + ' },')
    .join('\n');
  return (
    'export const AUTH_ROUTE_LEDGER: readonly AuthRouteLedgerEntry[] = [\n' + body + '\n];\n\n' +
    'export const BETTER_AUTH_MOUNTED_SURFACE: readonly string[] = [\n' +
    surface.map((s) => `  '${s}',`).join('\n') + '\n];\n'
  );
}

function runFixture(mountBody, rows, surface = [], pending = []) {
  const source = FIXTURE_PREAMBLE + mountBody;
  const ledger = ledgerFixture(rows, surface);
  const basePath = deriveBasePath(source);
  const census = deriveMounts({ source, basePath });
  return reconcile({
    ...census,
    rows: parseLedgerRows(ledger),
    vendorSurface: parseVendorSurface(ledger),
    pending,
  });
}

const REAL_NOTE =
  'no SDK method builds this URL -- the sys_user unlock_user action posts it directly; ' +
  'platform-admin gated (ADR-0068)';

function selfTest() {
  const fail = [];
  let cases = 0;
  const ok = (cond, what) => { cases += 1; if (!cond) fail.push(what); };
  const kinds = (r) => r.findings.map((f) => f.kind).sort();

  // -- The base path is DERIVED, and its absence is not an empty population.
  ok(deriveBasePath(FIXTURE_PREAMBLE) === FIXTURE_BASE, 'basePath was not derived from the plugin');
  ok(deriveBasePath('const basePath = 42;') === null, 'a plugin with no derivable basePath did not refuse');

  // -- LOAD-BEARING NEGATIVE: a mount with an exact row is clean.
  ok(
    runFixture(
      'rawApp.post(`${basePath}/admin/unlock-user`, h);',
      [{ route: 'POST /api/v1/auth/admin/unlock-user', source: 'objectstack', disposition: 'server-only', note: REAL_NOTE }],
    ).findings.length === 0,
    'a mount with an exact ledger row was not clean',
  );

  // -- LOAD-BEARING POSITIVE: a mount added with no row REDDENS, naming the route.
  {
    const r = runFixture('rawApp.post(`${basePath}/admin/zzz-new`, h);', []);
    ok(kinds(r).includes('unaccounted-mount'), 'an unledgered mount did not redden the gate');
    ok(
      r.findings.some((f) => f.text.includes('POST /api/v1/auth/admin/zzz-new')),
      'the finding did not name the unledgered route',
    );
  }

  // -- THE RIGHT BOUNDARY, both directions. This is the defect class #10534 fell into.
  {
    // The shorter route is mounted; only the LONGER sibling is ledgered.
    const r = runFixture(
      'rawApp.post(`${basePath}/admin/sso/register`, h);',
      [{ route: 'POST /api/v1/auth/admin/sso/register-saml', source: 'objectstack', disposition: 'server-only', note: REAL_NOTE }],
    );
    ok(
      r.findings.some((f) => f.kind === 'unaccounted-mount' && f.text.includes('POST /api/v1/auth/admin/sso/register\n')),
      'a strict-prefix mount was CREDITED to its longer sibling -- the #10534 defect, reintroduced',
    );
    ok(
      r.findings.some((f) => f.text.includes('NOT CREDITED, DELIBERATELY')),
      'the prefix relation was not reported, leaving the boundary property invisible in the output',
    );
    // And the mirror: the LONGER route mounted, only the shorter sibling ledgered.
    const back = runFixture(
      'rawApp.post(`${basePath}/admin/sso/register-saml`, h);',
      [{ route: 'POST /api/v1/auth/admin/sso/register', source: 'objectstack', disposition: 'server-only', note: REAL_NOTE }],
    );
    ok(
      back.findings.some((f) => f.kind === 'unaccounted-mount' && f.text.includes('register-saml')),
      'a longer mount was credited to its shorter sibling',
    );
    // The control that makes both of the above falsifiable: the EXACT row is clean.
    ok(
      runFixture(
        'rawApp.post(`${basePath}/admin/sso/register`, h);',
        [{ route: 'POST /api/v1/auth/admin/sso/register', source: 'objectstack', disposition: 'server-only', note: REAL_NOTE }],
      ).findings.length === 0,
      'the exact-row control did not pass, so the prefix cases prove nothing',
    );
  }

  // -- The method is part of the identity: same path, different verb, is a different route.
  ok(
    runFixture(
      'rawApp.get(`${basePath}/config`, h);',
      [{ route: 'POST /api/v1/auth/config', source: 'objectstack', disposition: 'server-only', note: REAL_NOTE }],
    ).findings.some((f) => f.kind === 'unaccounted-mount'),
    'a GET mount was credited to a POST row',
  );

  // -- CONSTRAINT 3: the lanes are excluded, and adding one does not redden.
  {
    const r = runFixture(
      'rawApp.all(`${basePath}/*`, h);\n' +
      'rawApp.use(`${basePath}/*`, h);\n' +
      'rawApp.post(`${basePath}/admin/unlock-user`, h);',
      [{ route: 'POST /api/v1/auth/admin/unlock-user', source: 'objectstack', disposition: 'server-only', note: REAL_NOTE }],
    );
    ok(r.findings.length === 0, 'rawApp.all / rawApp.use read as unledgered mounts');
    ok(r.lanes.length === 2, 'the excluded lanes were not counted, so the exclusion is invisible');
  }

  // -- Mounts that are not under basePath are not this ledger's business.
  ok(
    runFixture("rawApp.get('/.well-known/openid-configuration', h);", []).findings.length === 0,
    'a .well-known mount outside basePath was treated as an auth-ledger mount',
  );
  ok(
    runFixture('rawApp.get(`/.well-known/oauth-authorization-server${basePath}`, h);', []).findings.length === 0,
    'a discovery mount whose template does not START with basePath was misread as one under it',
  );

  // -- A commented-out mount is not a mount.
  ok(
    runFixture('// rawApp.post(`${basePath}/admin/ghost`, h);', []).findings.length === 0,
    'a commented-out mount was counted -- comment masking is not reaching the scan',
  );
  ok(
    runFixture('/* rawApp.post(`${basePath}/admin/ghost`, h); */', []).findings.length === 0,
    'a block-commented mount was counted',
  );

  // -- A string-literal mount under basePath is still a mount (no `${basePath}` required).
  ok(
    runFixture("rawApp.post('/api/v1/auth/admin/literal', h);", []).findings.some((f) => f.text.includes('/admin/literal')),
    'a mount written with a literal path instead of the template bypassed the census',
  );

  // -- CONSTRAINT 4: what cannot be read is reported, never skipped.
  ok(
    kinds(runFixture("rawApp.on('POST', `${basePath}/x`, h);", [])).includes('unreadable-mount'),
    'rawApp.on(...) was silently skipped instead of reported',
  );
  ok(
    kinds(runFixture('rawApp.post(ROUTE, h);', [])).includes('unreadable-mount'),
    'a non-literal first argument was silently skipped',
  );
  ok(
    kinds(runFixture('rawApp.post(`${basePath}/x${suffix}`, h);', [])).includes('unreadable-mount'),
    'an unresolved interpolation was silently skipped',
  );

  // -- The vendor inventory accounts for a shadowing mount, and says so.
  {
    const r = runFixture(
      'rawApp.post(`${basePath}/admin/ban-user`, h);',
      [],
      ['POST /api/v1/auth/admin/ban-user'],
    );
    ok(r.findings.length === 0, 'a mount shadowing a vendor-declared path read as unaccounted');
    ok(r.shadowed.length === 1, 'the shadow was not counted, so it is invisible in the report');
  }

  // -- The rationale half: a pasted row does not satisfy this gate.
  ok(
    kinds(runFixture(
      'rawApp.post(`${basePath}/admin/pasted`, h);',
      [{ route: 'POST /api/v1/auth/admin/pasted', source: 'objectstack', disposition: 'server-only' }],
    )).includes('row-without-rationale'),
    "a server-only row with NO note satisfied the gate -- pasting a row is the cheapest path again",
  );
  ok(
    kinds(runFixture(
      'rawApp.post(`${basePath}/admin/pasted`, h);',
      [{ route: 'POST /api/v1/auth/admin/pasted', source: 'objectstack', disposition: 'server-only', note: 'server-only' }],
    )).includes('row-without-rationale'),
    'a token note satisfied the gate',
  );
  ok(
    kinds(runFixture(
      'rawApp.post(`${basePath}/admin/pasted`, h);',
      [{ route: 'POST /api/v1/auth/admin/pasted', source: 'objectstack', disposition: 'sdk' }],
    )).includes('row-without-rationale'),
    "an 'sdk' row naming no client method satisfied the gate",
  );
  ok(
    runFixture(
      'rawApp.get(`${basePath}/config`, h);',
      [{ route: 'GET /api/v1/auth/config', source: 'objectstack', disposition: 'sdk', client: 'auth.getConfig' }],
    ).findings.length === 0,
    "an 'sdk' row naming a client method did not pass",
  );
  // A vendor-sourced row carries no rationale requirement -- it is not an intent claim.
  ok(
    runFixture(
      'rawApp.post(`${basePath}/send-verification-email`, h);',
      [{ route: 'POST /api/v1/auth/send-verification-email', source: 'better-auth', disposition: 'sdk', client: 'auth.sendVerificationEmail' }],
    ).findings.length === 0,
    'a better-auth-sourced row was held to the ObjectStack-intent rationale rule',
  );

  // -- A row whose mount is gone fails (the direction the hand-written pin already had).
  ok(
    kinds(runFixture(
      '',
      [{ route: 'POST /api/v1/auth/admin/vanished', source: 'objectstack', disposition: 'server-only', note: REAL_NOTE }],
    )).includes('orphan-objectstack-row'),
    'an objectstack row with no matching mount passed',
  );

  // -- PENDING_DISPOSITION, reconciled in BOTH directions.
  {
    const mount = 'rawApp.post(`${basePath}/set-initial-password`, h);';
    const p = [{ route: 'POST /api/v1/auth/set-initial-password', issue: '#10975', why: 'x' }];
    ok(runFixture(mount, [], [], p).findings.length === 0, 'a declared pending mount did not suppress the finding');
    ok(
      kinds(runFixture(mount, [], [], [{ route: p[0].route, issue: 'soon', why: 'x' }])).includes('pending-without-issue'),
      'a pending entry naming no issue passed',
    );
    ok(
      kinds(runFixture('', [], [], p)).includes('stale-pending'),
      'a pending entry whose mount is gone passed',
    );
    ok(
      kinds(runFixture(
        mount,
        [{ route: p[0].route, source: 'objectstack', disposition: 'sdk', client: 'auth.setInitialPassword' }],
        [],
        p,
      )).includes('resolved-pending'),
      'a pending entry whose route is now ledgered passed -- the ratchet cannot come down',
    );
    ok(
      kinds(runFixture(
        mount + '\nrawApp.post(`${basePath}/other`, h);',
        [],
        [],
        [p[0], { route: 'POST /api/v1/auth/other', issue: '#1', why: 'x' }],
      )).includes('pending-ratchet'),
      'PENDING_DISPOSITION grew past PENDING_MAX without failing',
    );
  }

  // -- Parse anchors: a moved anchor is a REFUSAL input, never an empty population.
  ok(parseLedgerRows('export const SOMETHING_ELSE = [];') === null, 'a missing AUTH_ROUTE_LEDGER anchor parsed as zero rows');
  ok(parseVendorSurface('export const SOMETHING_ELSE = [];') === null, 'a missing surface anchor parsed as zero rows');

  // -- The escaped-quote shape the real notes use is measured, not truncated.
  ok(
    unescape("objectui app-shell\\'s wizard").length === 'objectui app-shell\'s wizard'.length,
    'an escaped quote in a note was mis-measured',
  );

  // -- And the real inputs on disk are readable, so the anchors have not moved.
  for (const rel of [MOUNT_SOURCE, LEDGER_SOURCE]) {
    ok(existsSync(join(ROOT, rel)), `${rel} does not exist -- this gate's anchor moved`);
  }

  if (fail.length) {
    console.error('check-auth-mount-ledger --self-test FAILED:');
    for (const f of fail) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log(`check-auth-mount-ledger --self-test: ${cases} assertions OK (right boundary, lane exclusion, rationale, pending ratchet).`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function refuse(why) {
  console.error(`\ncheck-auth-mount-ledger: NOT MEASURED -- ${why}`);
  console.error('  Exit 2 is a refusal. It is not a pass, and a caller reading only the status must not treat it as one.');
  process.exit(EXIT_NOT_MEASURED);
}

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--self-test')) return selfTest();

  const mountAbs = join(ROOT, MOUNT_SOURCE);
  const ledgerAbs = join(ROOT, LEDGER_SOURCE);
  if (!existsSync(mountAbs)) refuse(`${MOUNT_SOURCE} does not exist`);
  if (!existsSync(ledgerAbs)) refuse(`${LEDGER_SOURCE} does not exist`);

  const mountText = readFileSync(mountAbs, 'utf8');
  const ledgerText = readFileSync(ledgerAbs, 'utf8');

  const basePath = deriveBasePath(mountText);
  if (!basePath) refuse(`no \`basePath\` default could be derived from ${MOUNT_SOURCE}`);

  const rows = parseLedgerRows(ledgerText);
  if (rows === null) refuse(`the AUTH_ROUTE_LEDGER anchor was not found in ${LEDGER_SOURCE}`);
  const vendorSurface = parseVendorSurface(ledgerText);
  if (vendorSurface === null) refuse(`the BETTER_AUTH_MOUNTED_SURFACE anchor was not found in ${LEDGER_SOURCE}`);
  if (rows.length === 0) refuse('AUTH_ROUTE_LEDGER parsed to zero rows');
  if (vendorSurface.length === 0) refuse('BETTER_AUTH_MOUNTED_SURFACE parsed to zero rows');

  const census = deriveMounts({ source: mountText, basePath });
  if (census.mounts.length === 0) refuse(`no rawApp mounts under ${basePath} were found in ${MOUNT_SOURCE}`);

  // The ledger's rows must live under the SAME base path the plugin mounts on.
  // Two independent derivations that agree is this gate's own positive control;
  // disagreement means one of them is reading a tree the other is not.
  const underBase = rows.filter((r) => r.route.includes(` ${basePath}/`)).length;
  if (underBase === 0) {
    refuse(`no AUTH_ROUTE_LEDGER row sits under the derived basePath ${basePath} -- the two inputs disagree`);
  }

  const { findings, shadowed, lanes, wildcards } = reconcile({
    ...census,
    rows,
    vendorSurface,
  });

  const bounds =
    `  scope: ${census.mounts.length} rawApp mount(s) under ${basePath} in ${MOUNT_SOURCE}; ` +
    `${rows.length} AUTH_ROUTE_LEDGER row(s) + ${vendorSurface.length} BETTER_AUTH_MOUNTED_SURFACE ` +
    `row(s) in ${LEDGER_SOURCE}.\n` +
    `  excluded by construction: ${lanes.length} lane(s) (rawApp.all / rawApp.use), ` +
    `${wildcards.length} pattern mount(s), and every mount outside ${basePath}.\n` +
    `  accounting is EXACT on \`METHOD path\` -- a prefix route is never credited to a longer sibling (#10534).`;

  if (argv.includes('--report')) {
    const ledgered = new Map(rows.map((r) => [r.route, r]));
    const vendor = new Set(vendorSurface);
    const pend = new Set(PENDING_DISPOSITION.map((p) => p.route));
    console.log('Mount census (route / accounted by / line):');
    for (const m of census.mounts) {
      const row = ledgered.get(m.route);
      const by = row
        ? `ledger row  source=${row.source} disposition=${row.disposition}`
        : vendor.has(m.route)
          ? 'vendor inventory (shadowed mount)'
          : pend.has(m.route)
            ? 'PENDING_DISPOSITION'
            : 'NOTHING';
      console.log(`  ${m.route.padEnd(56)} ${by.padEnd(52)} :${m.line}`);
    }
    console.log('');
  }

  if (findings.length) {
    console.error(`\ncheck-auth-mount-ledger: ${findings.length} finding(s)\n`);
    for (const f of findings) console.error(`  [${f.kind}] ${f.text}\n`);
    console.error(bounds);
    process.exit(EXIT_FINDINGS);
  }

  console.log(
    `check-auth-mount-ledger: OK -- ${census.mounts.length} ObjectStack auth mount(s), all accounted for ` +
    `(${census.mounts.length - shadowed.length - PENDING_DISPOSITION.length} by a reviewed ledger row, ` +
    `${shadowed.length} shadowing a vendor-declared path, ${PENDING_DISPOSITION.length} pending a disposition).`,
  );
  for (const p of PENDING_DISPOSITION) {
    console.log(`  PENDING ${p.route} -- disposition undecided, see ${p.issue}. Shrink-only; PENDING_MAX=${PENDING_MAX}.`);
  }
  console.log(bounds);
}

// Exports bindings, so an import for those exports alone must run nothing (#10667).
if (isEntrypoint(import.meta.url)) {
  main();
}
