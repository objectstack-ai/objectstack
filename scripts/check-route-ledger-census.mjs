#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * check-route-ledger-census -- holds the GENERATED census sentence above
 * `ROUTE_LEDGER` to the number of rows the array actually contains.
 *
 *   node scripts/check-route-ledger-census.mjs             # verify
 *   node scripts/check-route-ledger-census.mjs --fix       # regenerate the digits
 *   node scripts/check-route-ledger-census.mjs --self-test # verify the checker itself
 *
 * ## The defect (#16758)
 *
 * An index-slice edit to `packages/runtime/src/route-ledger.ts`, intended to
 * add two rows, removed 105 lines -- route rows plus the whole `/actions`
 * section -- and EXITED 0. It was caught only because an unrelated gate
 * reddened; had that gate been green, a mass deletion of the route ledger
 * would have proceeded inside a PR whose stated diff was "add two rows".
 *
 * `route-ledger.ts` is CENSUS-SHAPED: its value is the completeness of a list.
 * That is exactly the shape where deletion is invisible -- a WRONG row fails a
 * gate that reads rows, while a MISSING row fails only a gate that knows how
 * many rows there should be. This gate is the second kind, and it is the only
 * one in this tree that reads this file's row COUNT.
 *
 * ## Measured before it was written -- what was and was not already covered
 *
 * (a) THE FILE'S OWN PACKAGE GATE READS ROWS, NEVER THEIR NUMBER.
 * `packages/runtime/src/route-ledger.conformance.test.ts` asserts DOMAIN-level
 * facts ("every registered dispatcher domain has at least one ledger entry"),
 * membership facts, and a `gap`-disposition ratchet. Every one of those is
 * satisfied by a SHORTER list: for a multi-route domain, any non-last row can
 * be deleted with that suite fully green. That is not this gate's inference --
 * the suite's own header states it, out of the #17038 ablation, and #17075
 * landed the paragraph saying so.
 *
 * (b) THE CROSS-LEDGER GATES READ A UNION, WHICH ABSORBS DELETIONS.
 * `packages/qa/dogfood/test/route-ledger-live-mount-parity.dogfood.test.ts`
 * does check per-route completeness -- but its direction 2 ("every mounted
 * route is ledgered") compares the live mount table against the UNION of five
 * ledgers, and so does `packages/client/src/client-url-conformance.test.ts`.
 * A row whose wire pattern is still produced by some OTHER member of that
 * union is invisible when deleted. Measured on this tree at the commit that
 * added this gate: 26 of ROUTE_LEDGER's 82 rows are in that state -- 23
 * duplicated by `rest-route-ledger.ts` or `i18n-route-ledger.ts`, one absorbed
 * by the `* /mcp/**` wildcard row, and two `servedBy` specializations
 * (`POST /actions/global/:action`, `POST /actions/_activation/:object/:action`)
 * whose own pattern is registered nowhere, so they contribute no mount-table
 * key for direction 2 to miss. Both of those last two sit in the `/actions`
 * section the incident deleted. The reading is reproducible from source alone
 * and needs no boot: it is a set-difference against the union, and if the union
 * still holds the key, the mount is not reported unledgered.
 *
 * ## Why a census and NOT a comparison against registered routes (#17041)
 *
 * The stronger instrument for this file would be a per-route cross-check
 * against what the dispatcher registers -- and whether the route ledger should
 * be checked at ROUTE granularity, given `DomainHandlerRegistry.list()` exposes
 * domains and not routes, is an OPEN MAINTAINER DECISION tracked in #17041.
 * Building that here would answer it silently. So this gate deliberately takes
 * the census/deletion direction instead: it notices that the list got SHORTER,
 * independent of what the routes are, and stays correct whichever way #17041 is
 * ruled. ⛔ Do not grow this file into a router cross-check; that work belongs
 * to #17041 and to whoever the maintainer rules should do it.
 *
 * ## Why the number is GENERATED and never hand-typed
 *
 * A pinned literal a human must remember to bump is the defect one level up,
 * and this lane spent one day deleting three instances of it (#16919, #17039 ->
 * #17055, #17075 -- where re-typed counts went wrong within hours and the fix
 * was to remove the digits rather than correct them). So the digits in
 * `route-ledger.ts` are written by `--fix` and read by nobody's memory. The
 * shape is `check-lockstep-package-count.mjs`'s, including its ROTTED_ANCHOR
 * behaviour: the anchor must resolve to EXACTLY ONE match before the number it
 * captured is compared to the truth, because zero matches (the sentence was
 * reworded, or the slice took the comment with the rows) and more than one are
 * both failures to report rather than agreements to assume. Silence on a stale
 * number is the bug this exists to fix, and silence on a rotted anchor is the
 * same bug one level up.
 *
 * What that buys the reviewer is the property the incident lacked: the diff of
 * a PR that really adds two rows reads `82` -> `84`, and the diff of an
 * index-slice edit that claims to add two rows and removes twenty-six reads
 * either `82` -> `56` or an untouched `82` the gate reddens on. The count moves
 * with the rows, in the same hunk, or the build stops.
 *
 * ## The population: why ONE occurrence, measured rather than assumed
 *
 * This tree holds 11 `*-route-ledger.ts` files. TEN of them carry a per-route
 * completeness pair in their OWN package conformance test -- "every mounted
 * route has a ledger entry" AND "every ledger entry is really mounted" against
 * a live enumeration of that package's registrar -- so deleting a row from any
 * of those ten reddens that package's own suite. The eleventh,
 * `packages/runtime/src/route-ledger.ts`, is the one whose suite is domain-level
 * only; it is this card's file and it is the only member of the family that
 * shares the gap. So OCCURRENCES carries one row today, and that is a
 * measurement, not an omission.
 *
 * OCCURRENCES is this gate's only extension point: a second census-shaped list
 * that loses its completeness guard gets a row here, never a second script.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import * as os from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');

// Every generated census sentence, and the array whose length it restates. The
// `pattern` brackets a run of digits with enough literal context on both sides
// to be unambiguous; the digits are the ONLY thing --fix ever rewrites.
const OCCURRENCES = [
  {
    file: 'packages/runtime/src/route-ledger.ts',
    constant: 'ROUTE_LEDGER',
    label: 'the census sentence above ROUTE_LEDGER',
    pattern: /(CENSUS \(generated\): this list holds )(\d+)( rows\.)/,
  },
];

/**
 * The number of rows in `export const <name> ... = [ ... ]`, counted by walking
 * the array literal and admitting one row per `{` that opens at depth 1.
 *
 * Written as a walker rather than a regex on purpose: this file's rows carry
 * prose notes full of braces, apostrophes, slashes and `//`-shaped route
 * patterns inside string literals, and a line- or brace-counting reader would
 * be wrong about all of them. Comments and strings are skipped, so only real
 * syntax is counted. An absent constant or an unbalanced literal THROWS -- a
 * counter that cannot find its subject must not answer 0, which is the reading
 * that would let this gate certify an emptied file.
 */
function countRows(text, name) {
  const opener = new RegExp(`export const ${name}(?::[^=]*)?=\\s*\\[`).exec(text);
  if (!opener) {
    throw new Error(`countRows: no \`export const ${name} = [\` in this file — the constant was renamed or removed.`);
  }
  let i = opener.index + opener[0].length;
  let depth = 1;
  let rows = 0;
  let str = null;
  let lineComment = false;
  let blockComment = false;
  for (; i < text.length && depth > 0; i++) {
    const c = text[i];
    const n = text[i + 1];
    if (lineComment) {
      if (c === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (c === '*' && n === '/') {
        blockComment = false;
        i++;
      }
      continue;
    }
    if (str) {
      if (c === '\\') i++;
      else if (c === str) str = null;
      continue;
    }
    if (c === '/' && n === '/') {
      lineComment = true;
      i++;
    } else if (c === '/' && n === '*') {
      blockComment = true;
      i++;
    } else if (c === '"' || c === "'" || c === '`') {
      str = c;
    } else if (c === '[' || c === '(') {
      depth++;
    } else if (c === ']' || c === ')') {
      depth--;
    } else if (c === '{') {
      if (depth === 1) rows++;
      depth++;
    } else if (c === '}') {
      depth--;
    }
  }
  if (depth !== 0) {
    throw new Error(`countRows: the array literal of ${name} never closes — the file is truncated or malformed.`);
  }
  return rows;
}

function globalOf(pattern) {
  return new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
}

function readOccurrence(root, occurrence) {
  const path = resolve(root, occurrence.file);
  const text = readFileSync(path, 'utf8');
  const truth = countRows(text, occurrence.constant);
  const matches = [...text.matchAll(globalOf(occurrence.pattern))];
  if (matches.length !== 1) {
    return { path, text, truth, rotted: true, matchCount: matches.length };
  }
  return { path, text, truth, rotted: false, current: Number(matches[0][2]) };
}

/**
 * Checks (and optionally fixes) every occurrence against its array's real
 * length. Pure with respect to `fix`: false never touches disk; `fix: true`
 * rewrites only the occurrences it finds stale, byte-for-byte identical to the
 * original everywhere else in the file.
 */
function run(root, { fix = false } = {}) {
  const results = [];

  for (const occurrence of OCCURRENCES) {
    const read = readOccurrence(root, occurrence);
    if (read.rotted) {
      results.push({ ...occurrence, status: 'ROTTED_ANCHOR', truth: read.truth, matchCount: read.matchCount });
      continue;
    }
    if (read.current === read.truth) {
      results.push({ ...occurrence, status: 'OK', current: read.current, truth: read.truth });
      continue;
    }
    results.push({ ...occurrence, status: 'STALE', current: read.current, truth: read.truth });
    if (fix) {
      const next = read.text.replace(occurrence.pattern, `$1${read.truth}$3`);
      writeFileSync(read.path, next);
    }
  }

  const dirty = results.some((r) => r.status !== 'OK');
  return { results, dirty };
}

function formatReport({ results }) {
  const lines = ['route-ledger census (source: the array literal itself, counted at depth 1)'];
  for (const r of results) {
    if (r.status === 'OK') {
      lines.push(`  OK      ${r.file} :: ${r.constant} — ${r.label} (reads ${r.current}, array holds ${r.truth})`);
    } else if (r.status === 'STALE') {
      lines.push(
        `  STALE   ${r.file} :: ${r.constant} — ${r.label}: reads ${r.current}, `
        + `the array holds ${r.truth}`
        + (r.current > r.truth ? ` — ${r.current - r.truth} row(s) went missing.` : ` — ${r.truth - r.current} row(s) were added.`),
      );
    } else {
      lines.push(
        `  ROTTED  ${r.file} :: ${r.constant} — ${r.label}: anchor matched ${r.matchCount} time(s), `
        + `expected exactly 1 (the array holds ${r.truth})`,
      );
    }
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// --self-test: fixture-based, touches no real repo file. Builds a throwaway
// root with the same relative path OCCURRENCES names, so the real anchor and
// the real counter are exercised against synthetic content.
// ---------------------------------------------------------------------------

function selfTest() {
  const failures = [];
  const t = (name, ok) => {
    if (!ok) failures.push(name);
  };

  const tmp = mkdtempSync(join(os.tmpdir(), 'check-route-ledger-census-'));
  const target = join(tmp, 'packages/runtime/src/route-ledger.ts');
  try {
    mkdirSync(join(tmp, 'packages/runtime/src'), { recursive: true });

    // A miniature of the real file: prose braces and apostrophes in the header,
    // a nested object inside a row, a `//`-shaped path inside a string, and a
    // commented-out row — every reader-breaking shape the real file carries.
    const ledgerOf = (rows, census) =>
      [
        '/**',
        ' * Route ledger — a { brace } and an apostrophe\'s worth of prose.',
        ' *',
        ` * CENSUS (generated): this list holds ${census} rows.`,
        ' */',
        'export const ROUTE_LEDGER: readonly RouteLedgerEntry[] = [',
        ...Array.from({ length: rows }, (_, i) =>
          `  { route: 'GET /r${i}', domain: '/r${i}', disposition: 'server-only',`
          + ` note: 'see https://example.test/a//b — a { brace } in prose', extra: { nested: true } },`),
        "  // { route: 'GET /commented-out', domain: '/x' },",
        '];',
      ].join('\n');

    // Case 1: the incident, in miniature. The census says 8; the array holds 5.
    // Check must red, name BOTH numbers, and touch nothing.
    writeFileSync(target, ledgerOf(5, 8));
    const before = run(tmp, { fix: false });
    t('counter ignores comments, strings and nested objects', before.results[0].truth === 5);
    t('deletion fixture: reports dirty', before.dirty === true);
    t(
      'deletion fixture: STALE with both numbers named',
      before.results[0].status === 'STALE' && before.results[0].current === 8 && before.results[0].truth === 5,
    );
    t('deletion fixture: the report names the missing rows', formatReport(before).includes('3 row(s) went missing'));
    t('deletion fixture: check-only touched no file', readFileSync(target, 'utf8') === ledgerOf(5, 8));

    // Case 2: --fix converges, and a second pass is byte-identical.
    run(tmp, { fix: true });
    const afterFirstFix = readFileSync(target, 'utf8');
    t('fix: the census now reads the true count', afterFirstFix === ledgerOf(5, 5));
    t('fix: no longer dirty', run(tmp, { fix: false }).dirty === false);
    run(tmp, { fix: true });
    t('idempotence: byte-identical after a second --fix pass', readFileSync(target, 'utf8') === afterFirstFix);

    // Case 3: growth is reported too — a row added without regenerating.
    writeFileSync(target, ledgerOf(7, 5));
    const grown = run(tmp, { fix: false });
    t('growth: reported STALE, never silently accepted', grown.results[0].status === 'STALE' && grown.results[0].truth === 7);
    t('growth: the report says rows were added', formatReport(grown).includes('2 row(s) were added'));

    // Case 4: a reworded sentence rots the anchor — ROTTED, never OK.
    writeFileSync(target, ledgerOf(5, 5).replace(/ \* CENSUS \(generated\).*\n/, ''));
    const rotted = run(tmp, { fix: false });
    t('rotted anchor: reported as ROTTED_ANCHOR', rotted.results[0].status === 'ROTTED_ANCHOR');
    t('rotted anchor: matchCount 0', rotted.results[0].matchCount === 0);
    t('rotted anchor: reports dirty (never a silent pass)', rotted.dirty === true);
    t('rotted anchor: still counts the array, so the report can name the truth', rotted.results[0].truth === 5);

    // Case 5: a duplicated anchor is ALSO rotted, not "pick the first".
    writeFileSync(target, ledgerOf(5, 5).replace(
      ' * CENSUS (generated): this list holds 5 rows.',
      ' * CENSUS (generated): this list holds 5 rows.\n * CENSUS (generated): this list holds 5 rows.',
    ));
    const duped = run(tmp, { fix: false });
    t('duplicated anchor: ROTTED_ANCHOR with matchCount 2', duped.results[0].status === 'ROTTED_ANCHOR' && duped.results[0].matchCount === 2);

    // Case 6: ⭐ the counter REFUSES rather than answering 0. A renamed or
    // deleted constant is the shape that would otherwise let this gate certify
    // an emptied file as "0 rows, and the census agrees".
    writeFileSync(target, ledgerOf(5, 5).replace('export const ROUTE_LEDGER', 'export const RENAMED_LEDGER'));
    let refusedMissing = false;
    try {
      run(tmp, { fix: false });
    } catch (e) {
      refusedMissing = /no `export const ROUTE_LEDGER/.test(String(e.message));
    }
    t('a renamed constant is REFUSED loudly, never counted as 0', refusedMissing);

    writeFileSync(target, ledgerOf(5, 5).replace(/\n\];\n?$/, '\n'));
    let refusedTruncated = false;
    try {
      run(tmp, { fix: false });
    } catch (e) {
      refusedTruncated = /never closes/.test(String(e.message));
    }
    t('an unclosed array literal is REFUSED loudly, never counted', refusedTruncated);

    // Case 7: the real tree's occurrence resolves — a self-test that never
    // touches the repo would pass with OCCURRENCES pointing at nothing.
    let realResolves = false;
    try {
      const real = run(repoRoot, { fix: false });
      realResolves = real.results.length === OCCURRENCES.length
        && real.results.every((r) => r.status !== 'ROTTED_ANCHOR' && r.truth > 0);
    } catch {
      realResolves = false;
    }
    t('every OCCURRENCE resolves against the real tree (anti-vacuity)', realResolves);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }

  if (failures.length > 0) {
    console.error(`✗ check:route-ledger-census --self-test — ${failures.length} failure(s):`);
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log('✓ check:route-ledger-census --self-test — all cases passed.');
}

function main() {
  const args = process.argv.slice(2);

  if (args.includes('--self-test')) {
    selfTest();
    return;
  }

  const fix = args.includes('--fix');
  const outcome = run(repoRoot, { fix });
  console.log(formatReport(outcome));

  if (fix) {
    const after = run(repoRoot, { fix: false });
    if (after.dirty) {
      console.error('\n✗ check:route-ledger-census --fix did not converge — inspect ROTTED_ANCHOR rows by hand.');
      process.exit(1);
    }
    console.log('\n✓ check:route-ledger-census --fix — every census sentence now matches its array.');
    return;
  }

  if (outcome.dirty) {
    const bad = outcome.results.filter((r) => r.status !== 'OK').length;
    console.error(
      `\n✗ check:route-ledger-census — ${bad} census sentence(s) disagree with the array they describe. `
      + 'If rows were deliberately added or removed, run `node scripts/check-route-ledger-census.mjs --fix` '
      + 'and review the digits it rewrites; if they were NOT, rows went missing from an edit that meant '
      + 'to do something else — this gate exists for that (#16758).',
    );
    process.exit(1);
  }
  console.log(
    `\n✓ check:route-ledger-census — all ${OCCURRENCES.length} census sentence(s) match their arrays.`,
  );
}

main();
