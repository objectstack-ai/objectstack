#!/usr/bin/env node
// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.
//
// Guards the single source of truth for request authorization resolution
// (`resolveAuthzContext`, @objectstack/core). Prevents the two regressions that
// motivated the extraction:
//   1. A NEW request-context resolver copy. The original bug: the REST server
//      kept its own resolver that drifted from the dispatcher's and silently
//      dropped the position assignments table (`sys_user_role` at the time,
//      `sys_user_position` since ADR-0090 D3), so custom grants didn't apply
//      over REST.
//   2. An entry point that stops delegating to the shared resolver.
//
// Heuristic for (1): a non-test source file that QUERIES every table in
// `GRANT_TABLES` — reads rows from each, not merely names them — is doing
// request-context grant aggregation, the resolver's job, and must be the
// canonical module (or an explicitly allow-listed non-resolver, each carrying
// its reason in `ALLOW`).
//
//   node scripts/check-single-authz-resolver.mjs
//   node scripts/check-single-authz-resolver.mjs --self-test
//
// ## Dead scan roots are a hard error (#4930)
//
// Check (1) is a *scan*: it concludes "no duplicate resolver exists" from having
// read every TypeScript source under SCAN_ROOTS. `walk()` used to open with
// `try { entries = readdirSync(dir); } catch { return out; }`, so a root that was
// renamed, moved or made unreadable produced zero files — and zero files produce
// zero errors, which is character-for-character the same verdict as a clean
// workspace. The scan cannot tell you it never ran; only its (unprinted) file
// count could, and nobody reads a count that is not printed.
//
// A whole-`packages/` rename also happens to be caught downstream, because both
// DELEGATORS live under that same root and check (2) reports them missing. That
// is luck, not coverage, and it misdirects the diagnosis: the operator is told
// two files are missing when the actual event is that the duplicate-resolver
// scan read nothing at all. Move either delegator out of `packages/`, or add a
// second scan root, and that downstream crutch goes silent — the #4916 shape,
// one refactor away. So the roots are resolved up front and a dead one fails the
// gate BY NAME, before any conclusion is drawn from the scan.
//
// Deliberately no whitelist and no `optional: true` marker. `packages/` is a
// git-tracked directory with tracked files; no checkout that can run
// `pnpm check:authz-resolver` at the repo root is legitimately missing it. An
// optional marker "just in case" is a supported way to silence this failure
// instead of fixing the rename — the empty `catch {}` again, spelled politely.
// Should a root ever become legitimately absent, that is a decision to record
// with its condition and a test, not a check to relax.
//
// ## An empty scan is a hard error too (#5916)
//
// Resolving the roots is only half of it, and the half above cannot see the other:
// a root that resolves, is readable, and simply yields NO file leaves the check
// iterating an empty corpus and reporting zero errors — "no duplicate resolver
// exists", concluded from nothing. `assertRootsResolvable` is satisfied the whole
// time; the directory is right there. The corpus is what left: a subtree migrated
// out of `packages/`, sources renamed to an extension `walk` does not collect, or
// the walk filter narrowed. Nothing in the output distinguishes that from clean.
//
// So each declared root must also YIELD at least one file. The floor is computed
// by this very walk — "every root in SCAN_ROOTS > 0 files" — deliberately NOT a
// recorded high-water mark: a ratchet would need maintaining on every legitimate
// move, and the failure it buys (a corpus that shrank but is not empty) is not the
// one that turns this gate vacuous. Same shape as `check-doc-authoring.mjs`, which
// closed this exact gap for the docs corpus (#4932); #4690 is where "an extraction
// that finds nothing must be red" was first written down.
//
// The floor is per-root and never a total: with more than one root, a single
// populated one would otherwise cover for every evaporated sibling — which is the
// silent narrowing this assertion exists to stop.
//
// ## The extension filter is a family, not a suffix string (#6070)
//
// The failure above names its own successor — "sources renamed to an extension `walk`
// does not collect" — and that case was already live on the day #5916 landed. The
// collector tested `e.endsWith('.ts')`, and `'x.mts'.endsWith('.ts')` is **false** (the
// character before `ts` is `m`, not `.`), so every `.mts` / `.cts` source under
// `packages/` — twelve of them, all build/liveness scripts under `packages/spec/scripts/` —
// stayed out of the corpus, and check (1)'s "no duplicate resolver exists" was concluded
// from a set that structurally excluded them.
//
// Neither corpus assertion above can see this, by construction. `packages/` resolves,
// and it yields well over a thousand `.ts` files — far above a per-root floor of one —
// while every `.mts` under it is invisible. A floor answers "did this root produce
// anything"; it can never answer "did it produce everything the root declares".
//
// So the filter is an extension FAMILY (`SCANNED_EXT` / `EXCLUDED_EXT`), not a suffix
// string, and the exclusions move with it in the same step — widening only the collector
// would re-plant the same bug one level down, with `x.test.mts` scannable while
// `x.test.ts` is not. None of the twelve files trips check (1)'s heuristic, so the wider
// corpus changes no verdict today; what changes is that the verdict is now drawn from
// what the gate says it reads.
//
// ## The criterion is the other half, and it had already expired (#6286)
//
// Everything above hardens the CORPUS — that the gate reads what it claims to read.
// None of it can see a gate that reads everything and then judges it with a vocabulary
// that no longer denotes anything. Check (1) matched `sys_user_role` && `sys_user_permission_set`;
// ADR-0090 D3 renamed `sys_role` → `sys_position` and `sys_user_role` → `sys_user_position`,
// after which `sys_user_role` survived repo-wide in exactly ONE place: a "formerly
// sys_user_role" comment in `plugin-security/src/objects/sys-user-position.object.ts`.
// Files matching both terms: **0**. Check (1) was structurally incapable of failing, and
// both `ALLOW` entries exempted callers from a predicate that could never fire. The
// canonical resolver did not trip its own heuristic.
//
// So the vocabulary lives in ONE place (`GRANT_TABLES`) and the criterion is a SHAPE,
// not a pair of substrings. Two decisions, both measured on the real corpus rather than
// argued:
//
// * **"Queries the table", not "mentions it".** A plain rename of the word list matches 20
//   files, of which 18 are noise — four generated translation bundles, `object.zod.ts` /
//   `permission.zod.ts` / `component.zod.ts` / `explain.zod.ts` prose, the
//   `platform-object-names.ts` constant list, a lint `Set` literal, page metadata, a testkit
//   fixture. A duplicate resolver is not a file that says these names; it is a file that
//   READS ROWS from them. Requiring the table name as a quoted argument of a data-read call
//   (`find` / `query` / `select` / `count` / `aggregate`, including helper spellings like the
//   resolver's own `tryFind`) takes the same corpus from 20 hits to 2 — the canonical resolver
//   and one deliberate non-enforcement mirror — with no allow-list doing the narrowing.
//
// * **NOT a landing-path filter.** Restricting the scan to `security/` directories is the
//   other obvious narrowing and it is disqualifying: the ORIGINAL bug lived in
//   `packages/rest/src/rest-server.ts`, which is not under any `security/` path, so that
//   shape would not have caught the defect this gate exists for — and it would let the
//   self-test's own duplicate fixture (`packages/rest/src/my-own-resolver.ts`) through. A
//   guard narrowed to where the correct code lives cannot see code planted anywhere else.
//
// Deliberately NO comment-stripping pre-pass. It was measured and changes nothing (the same
// 2 hits either way), and a lexical stripper that mis-parses one regex literal would silently
// shrink what the guard judges — this file's entire failure family, re-planted in the
// judgment step.
//
// ## A guard whose criterion no longer matches the thing it guards is green forever
//
// The rename above was invisible for months because every assertion in the self-test ran
// against SYNTHETIC fixtures: the heuristic provably caught a planted duplicate and released
// a planted innocent, and it would have kept proving exactly that with a vocabulary denoting
// nothing in the real repo. Synthetic fixtures can only ever show the criterion is internally
// consistent; they cannot show it still points at reality.
//
// So `assertCanonicalStillMatches` is a POSITIVE CONTROL on the real checkout, evaluated on
// every run (not only under `--self-test`): the canonical resolver itself must be matched by
// check (1)'s heuristic. If it is not, the vocabulary has drifted off the tables the resolver
// actually reads, every "no duplicate resolver" verdict is vacuous, and the gate fails BY NAME
// pointing at the tables that stopped matching. The next rename lands red in CI on the commit
// that makes it, instead of surviving until someone happens to measure it.
//
// Note the layering, which is what makes the control assertable at all. Being MATCHED by the
// heuristic and being REPORTED as an error are two steps: the canonical resolver must pass the
// first (that is the control) and is exempted at the second (it is the legitimate copy). They
// are separate functions — `queriesAllGrantTables` decides matching, `ALLOW` decides reporting
// — so the control can assert the first without asserting the file is broken.
//
// The same gap is open across the `check:engine-double-contract` / `check:error-code-casing`
// family: corpus-side floors exist, criterion-side positive controls do not.

import {
  mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

const ROOT = process.cwd();
const CANONICAL = 'packages/core/src/security/resolve-authz-context.ts';

/**
 * The grant link tables a request-context resolver must read to do its job — the
 * criterion's whole vocabulary, in ONE place.
 *
 * Renamed by ADR-0090 D3 (`sys_user_role` → `sys_user_position`). The previous spelling
 * was inlined twice in an `if`, so the rename left the gate matching a word that denotes
 * nothing and check (1) could not fail (#6286). Keeping the names here means the next
 * rename has a single edit site — and `assertCanonicalStillMatches` fails loudly if that
 * edit is skipped, rather than printing green over a dead predicate.
 */
const GRANT_TABLES = ['sys_user_position', 'sys_user_permission_set'];

/**
 * Files that QUERY every grant table without being a request-context resolver, each with
 * the reason it is exempt. Re-curated for the query-shaped criterion (#6286): the previous
 * two entries were written against the dead `sys_user_role` predicate and neither survived
 * re-measurement unchanged.
 *
 * A reason is mandatory — an exemption nobody can justify in a sentence is an exemption
 * that outlived its cause, which is how the old list rotted unnoticed.
 *
 * REMOVED in the same pass: `plugin-security/src/objects/default-permission-sets.ts`, the
 * old list's second entry. It names both tables in prose and as UNQUOTED object keys
 * (`sys_user_permission_set: { allowRead: true, ... }`) and queries neither, so the
 * query-shaped criterion does not reach it — measured, 0 hits. An exemption that no longer
 * exempts anything is dead weight, and dead weight in an allow-list is indistinguishable
 * from a live suppression on the day someone reads it.
 */
const ALLOW = new Map([
  [
    CANONICAL,
    'The single legitimate resolver. Also the positive control: it MUST be matched by ' +
    'the heuristic (assertCanonicalStillMatches) and is exempted only from being reported.',
  ],
  [
    'packages/plugins/plugin-security/src/explain-engine.ts',
    'Explain/diagnostic surface, NOT a request-context resolver, and since #6352 no longer a ' +
    'second aggregation either: buildContextForUser() now CALLS resolveUserAuthzGrants (the ' +
    'canonical resolver\'s userId-driven core) for every position / permission-set / posture / ' +
    'platform_admin verdict. What still trips this heuristic is the explain-ONLY provenance ' +
    'pass (collectGrantProvenance), which re-reads the same two tables purely to ANNOTATE rows ' +
    'the resolver dropped — expired grants ("held until … — expired") and delegated_from ' +
    'origin — and feeds no verdict. The exemption is therefore narrower than it was, not ' +
    'wider: the parity invariant it used to defer is now pinned by the tests in ' +
    'explain-engine.test.ts ("buildContextForUser ↔ resolveUserAuthzGrants parity"), never by ' +
    'this gate. Do not fold that invariant in here by widening this gate\'s remit without ' +
    'saying so in the header.',
  ],
]);

// Entry points that MUST delegate to the shared resolver (never re-inline it).
const DELEGATORS = [
  'packages/rest/src/rest-server.ts',
  'packages/runtime/src/security/resolve-execution-context.ts',
];

// Every directory check (1) claims to have read. Relative to the repo root.
const SCAN_ROOTS = ['packages'];

const SKIP_DIRS = new Set(['node_modules', 'dist', '__tests__']);

/**
 * The extension family check (1) reads, and the two shapes excluded from it.
 *
 * Two regexes, deliberately paired and deliberately parallel. `SCANNED_EXT` replaces an
 * `e.endsWith('.ts')` that silently skipped `.mts` / `.cts` (see the header, #6070);
 * `EXCLUDED_EXT` carries the SAME family through the test/declaration exclusions, so the
 * widening cannot leave them one extension behind. The repo has no `.test.mts` or `.d.cts`
 * today — the shapes are excluded anyway, because the exclusion states what a test or
 * declaration file IS, not an inventory of the ones that happen to exist.
 */
const SCANNED_EXT = /\.[mc]?ts$/;
const EXCLUDED_EXT = /\.(?:test|d)\.[mc]?ts$/;

/**
 * Data-read call verbs. A duplicate resolver reads ROWS; it does not merely name tables.
 * Kept deliberately broad on the callee (any identifier CONTAINING one of these, so
 * `ql.find`, `dataEngine.findOne`, a bare `query(...)` and the canonical resolver's own
 * `tryFind` helper all count) and strict on the argument (the table as a quoted literal,
 * reached without crossing another quote or EITHER paren — i.e. an early argument of THAT
 * call, not of something nested inside it, so `find(wrap('sys_user_position'))` is not a
 * read of that table).
 */
const READ_VERBS = 'find|query|select|count|aggregate';

/** Matches a data-read call taking `table` as a quoted argument. */
function readCallPattern(table) {
  return new RegExp(
    '[\\w$.]*(?:' + READ_VERBS + ')[\\w$]*\\s*\\(\\s*' + // callee + open paren
    '[^()\'"`]{0,80}' +                                   // earlier plain arguments, if any
    '[\'"`]' + table + '[\'"`]',                          // the table, quoted
    'i',
  );
}

/** Does `src` read rows from `table` (as opposed to mentioning its name)? */
function queriesGrantTable(src, table) {
  return readCallPattern(table).test(src);
}

/**
 * Check (1)'s criterion: this source queries EVERY grant table, so it is aggregating a
 * principal's grants — the canonical resolver's job.
 *
 * Deliberately independent of `ALLOW`. Matching and being reported are two steps (see the
 * header): the positive control asserts the canonical resolver passes THIS function, while
 * `audit` separately decides not to report it.
 */
function queriesAllGrantTables(src) {
  return GRANT_TABLES.every((t) => queriesGrantTable(src, t));
}

/**
 * The criterion no longer matches the resolver it was written to describe: the tables were
 * renamed (or the resolver moved) and `GRANT_TABLES` was not updated with them. Carries the
 * table names that stopped matching.
 */
class ResolverSignatureLostError extends Error {
  constructor(missing, detail) {
    super(`check (1)'s criterion no longer matches the canonical resolver: ${detail}`);
    this.name = 'ResolverSignatureLostError';
    /** @type {string[]} the GRANT_TABLES entries the canonical resolver does not query. */
    this.missing = missing;
    this.detail = detail;
  }
}

/**
 * POSITIVE CONTROL, on the real checkout, every run.
 *
 * The canonical resolver must be MATCHED by check (1)'s heuristic. If it is not, the
 * vocabulary has drifted off the tables the resolver actually reads and every "no duplicate
 * resolver" verdict below is drawn from a predicate that matches nothing — the exact state
 * ADR-0090 D3's rename left this gate in for months (#6286).
 *
 * @throws {ResolverSignatureLostError}
 */
function assertCanonicalStillMatches(root = ROOT) {
  let src;
  try {
    src = readFileSync(join(root, CANONICAL), 'utf8');
  } catch (err) {
    throw new ResolverSignatureLostError(
      [...GRANT_TABLES],
      `${CANONICAL} could not be read (${err?.code ?? err}) — the resolver moved or was renamed`,
    );
  }
  const missing = GRANT_TABLES.filter((t) => !queriesGrantTable(src, t));
  if (missing.length) {
    throw new ResolverSignatureLostError(
      missing,
      `${CANONICAL} does not query ${missing.join(', ')}`,
    );
  }
}

/** A declared scan root that could not be resolved to a directory. Carries the names. */
class DeadRootError extends Error {
  constructor(dead) {
    super(`unresolvable scan root(s): ${dead.map((d) => `${d.root} — ${d.reason}`).join('; ')}`);
    this.name = 'DeadRootError';
    this.dead = dead;
    /** @type {string[]} just the root names, for callers that only need to point. */
    this.roots = dead.map((d) => d.root);
  }
}

/**
 * Resolve every declared scan root before reading anything; throw naming the ones
 * that are not directories. See the header for why there is no optional-root flag.
 *
 * @throws {DeadRootError}
 */
function assertRootsResolvable(root = ROOT, roots = SCAN_ROOTS) {
  const dead = [];
  for (const rel of roots) {
    let st = null;
    try {
      st = statSync(join(root, rel));
    } catch (err) {
      dead.push({
        root: rel,
        reason: err?.code === 'ENOENT' ? 'does not exist' : `cannot be read (${err?.code ?? err})`,
      });
      continue;
    }
    if (!st.isDirectory()) dead.push({ root: rel, reason: 'exists but is not a directory' });
  }
  if (dead.length) throw new DeadRootError(dead);
}

/**
 * Every non-test TypeScript source under `dir`, recursively — `.ts`, `.mts` and `.cts`
 * alike (`SCANNED_EXT`), minus the test and declaration shapes of each (`EXCLUDED_EXT`).
 *
 * Nothing here is wrapped in a catch: an unresolvable root fails loudly above, and
 * an error *inside* the walk (a vanished file, a permission fault) means the corpus
 * was only partly read — which must not be reported as "no duplicate resolver".
 */
function walk(dir, out = []) {
  for (const e of readdirSync(dir)) {
    if (SKIP_DIRS.has(e)) continue;
    const p = join(dir, e);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (SCANNED_EXT.test(e) && !EXCLUDED_EXT.test(e)) out.push(p);
  }
  return out;
}

/**
 * A declared scan root that resolved to a directory and yielded no file to scan.
 * Carries the names, and the total the run would otherwise have reasoned over.
 */
class EmptyRootError extends Error {
  constructor(empty, total) {
    super(`scan root(s) contributed no scannable TypeScript file: ${empty.join(', ')} (total scanned: ${total})`);
    this.name = 'EmptyRootError';
    /** @type {string[]} the roots that yielded nothing. */
    this.roots = empty;
    /** @type {number} files found across all roots — 0 when the whole scan evaporated. */
    this.total = total;
  }
}

/**
 * The corpus check (1) reasons over.
 *
 * Each declared root must resolve AND yield at least one file: a root that resolves
 * but holds nothing is the same evaporation as one that does not resolve, minus the
 * ENOENT that made the first kind detectable (#5916). See the header for why the
 * floor is computed here rather than recorded as a high-water mark.
 *
 * @throws {DeadRootError} a declared root is not a directory.
 * @throws {EmptyRootError} a declared root resolved but contributed no file.
 */
function collectScanFiles(root = ROOT, roots = SCAN_ROOTS) {
  assertRootsResolvable(root, roots);
  const out = [];
  const empty = [];
  for (const rel of roots) {
    const before = out.length;
    walk(join(root, rel), out);
    if (out.length === before) empty.push(rel);
  }
  if (empty.length) throw new EmptyRootError(empty, out.length);
  return out;
}

/**
 * Both invariants over `root`. Throws {@link DeadRootError} / {@link EmptyRootError}
 * rather than returning a verdict when the scan could not read what it claims to
 * have read.
 */
function audit(root = ROOT) {
  const errors = [];

  const files = collectScanFiles(root);

  // The criterion must still match the thing it describes, BEFORE any verdict is drawn
  // from it — a heuristic that matches nothing reports no duplicates for the same reason
  // an unread corpus does (#6286).
  assertCanonicalStillMatches(root);

  // (1) No duplicate request-context resolver.
  for (const abs of files) {
    const rel = abs.slice(root.length + 1);
    if (ALLOW.has(rel)) continue;
    const src = readFileSync(abs, 'utf8');
    if (queriesAllGrantTables(src)) {
      errors.push(
        `Possible duplicate authorization resolver: ${rel}\n` +
        `  QUERIES every grant table (${GRANT_TABLES.join(', ')}), which is request-context\n` +
        `  grant aggregation. That resolution must live ONLY in ${CANONICAL}\n` +
        `  (resolveAuthzContext), shared by every transport. If this file reads them for a\n` +
        `  non-resolution reason, add it to ALLOW in scripts/check-single-authz-resolver.mjs\n` +
        `  WITH the reason — a bare path is not an exemption.`,
      );
    }
  }

  // (2) Entry points still delegate to the shared resolver.
  for (const rel of DELEGATORS) {
    let src;
    try { src = readFileSync(join(root, rel), 'utf8'); } catch { errors.push(`Delegator missing: ${rel}`); continue; }
    if (!src.includes('resolveAuthzContext')) {
      errors.push(
        `${rel} no longer delegates to resolveAuthzContext.\n` +
        `  Every HTTP entry point must resolve authorization via the shared\n` +
        `  @objectstack/core resolver — do not re-inline session/role/permission reads.`,
      );
    }
  }

  return errors;
}

function reportDeadRoots(err) {
  console.error('\n✗ check:authz-resolver: declared scan root(s) do not resolve, so the duplicate-resolver\n' +
    '  scan would have concluded "none found" from zero files:\n');
  for (const d of err.dead) console.error(`  ${d.root} — ${d.reason}`);
  console.error(
    `\nEvery entry in SCAN_ROOTS (scripts/check-single-authz-resolver.mjs) must be a directory in` +
    `\nthe checkout, and this check runs from the repo root. If a directory was renamed or moved,` +
    `\nupdate SCAN_ROOTS to follow it; if it was deleted, remove the entry deliberately. Do NOT` +
    `\nrestore a tolerant skip: this used to be \`catch { return out; }\`, and a dead root simply` +
    `\nmade the scan read zero files while the gate kept printing green (#4930).\n`,
  );
}

function reportEmptyRoots(err) {
  console.error('\n✗ check:authz-resolver: declared scan root(s) resolved but contributed no file, so the\n' +
    '  duplicate-resolver scan would have concluded "none found" from a corpus it never read:\n');
  for (const r of err.roots) console.error(`  ${r} — 0 files`);
  console.error(
    `\n${err.total} file(s) were found in total across all of SCAN_ROOTS.` +
    `\n\nEvery entry in SCAN_ROOTS (scripts/check-single-authz-resolver.mjs) must yield at least one` +
    `\nscannable .ts/.mts/.cts file. The root still being a directory is not enough — that is all #4930's` +
    `\ncheck can see. If the sources moved to a new directory, point SCAN_ROOTS at it; if the walk` +
    `\nfilter no longer matches them (a new extension, a widened SKIP_DIRS), fix the filter. Do NOT` +
    `\nlower this to a total count: one populated root would then cover for every evaporated one,` +
    `\nwhich is the silent narrowing this assertion exists to stop (#5916).\n`,
  );
}

function reportSignatureLost(err) {
  console.error('\n✗ check:authz-resolver: check (1)\'s criterion no longer matches the canonical resolver,\n' +
    '  so "no duplicate resolver exists" would have been concluded from a predicate that\n' +
    '  matches nothing:\n');
  console.error(`  ${err.detail}`);
  for (const t of err.missing) console.error(`  ${t} — not queried by the canonical resolver`);
  console.error(
    `\nGRANT_TABLES (scripts/check-single-authz-resolver.mjs) must name the tables` +
    `\n${CANONICAL} actually reads. If they were renamed — ADR-0090 D3 renamed` +
    `\nsys_user_role → sys_user_position once already — update GRANT_TABLES in the same` +
    `\ncommit as the rename. If the resolver moved, update CANONICAL to follow it.` +
    `\n\nDo NOT silence this by deleting the assertion: it exists because the last rename` +
    `\nleft the heuristic matching a word that denoted nothing, and the gate printed green` +
    `\nover a check that was structurally incapable of failing for months (#6286).\n`,
  );
}

// ── Self-test ───────────────────────────────────────────────────────────────
//
// A guard that cannot fail is not a guard. Both invariants are driven over a real
// temporary tree with the real walker, and both corpus failures are proved in both
// directions — red when a root is renamed away, red when a root that still resolves
// yields nothing, green when each is restored.
//
// Every fixture body is GENERATED FROM `GRANT_TABLES` rather than spelling table names
// literally. That is not tidiness: hard-coded fixture bodies are how the criterion rotted
// undetected (#6286). Literal fixtures keep proving the heuristic works on the words THEY
// contain, which stay in sync with the predicate and drift away from the repo together —
// the self-test stays green precisely while the gate stops meaning anything. Generated
// bodies cannot disagree with the predicate, so the only thing left that CAN disagree is
// the real repo, and that is what the positive control below asserts.

/** A resolver-shaped body: reads rows from every grant table. Must be CAUGHT. */
function resolverFixtureBody(tables = GRANT_TABLES) {
  return tables
    .map((t) => `  const rows = await ql.find('${t}', { where: { user_id: userId }, limit: 200 });`)
    .join('\n') + '\n';
}

/**
 * A body that NAMES every grant table without reading rows from any — prose, unquoted
 * object keys, a constant list. The dominant shape in the real corpus (18 of the 20 files
 * a bare rename would have matched) and the reason the criterion is query-shaped.
 */
function mentionOnlyFixtureBody(tables = GRANT_TABLES) {
  return `// Seed/definition. Grants are stored in ${tables.join(' and ')}.\n` +
    'export const DEFAULTS = {\n' +
    tables.map((t) => `  ${t}: { allowRead: true, allowCreate: false },`).join('\n') +
    `\n};\nexport const NAMES = [${tables.map((t) => `'${t}'`).join(', ')}];\n`;
}

function selfTest() {
  const failures = [];
  const expect = (label, got, want) => {
    if (got !== want) failures.push(`  ✗ ${label}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
  };

  // --- Every exemption carries its reason. -----------------------------------
  // The old list rotted because nothing required an entry to justify itself; two paths
  // sat there exempting callers from a predicate that could not fire. A path with no
  // reason is indistinguishable from a path someone added to make a red go away.
  for (const [path, reason] of ALLOW) {
    expect(`ALLOW entry ${path} carries a reason`, typeof reason === 'string' && reason.length > 20, true);
  }
  expect('the canonical resolver is exempt from being REPORTED', ALLOW.has(CANONICAL), true);

  // --- POSITIVE CONTROL, on the REAL repo. -----------------------------------
  // The assertion this gate was missing (#6286), and the whole reason the rename was
  // silent: everything else in this self-test runs on fixtures the predicate cannot
  // disagree with. This one runs against the actual canonical resolver in the checkout.
  // Positive polarity — it goes RED when GRANT_TABLES drifts off the real tables.
  let realCanonicalSrc = null;
  try {
    realCanonicalSrc = readFileSync(join(ROOT, CANONICAL), 'utf8');
  } catch (err) {
    failures.push(`  ✗ the real canonical resolver is readable: ${CANONICAL} — ${err?.code ?? err}`);
  }
  if (realCanonicalSrc !== null) {
    for (const t of GRANT_TABLES) {
      expect(`the REAL ${CANONICAL} still queries ${t}`, queriesGrantTable(realCanonicalSrc, t), true);
    }
    expect('the REAL canonical resolver is matched by check (1)\'s heuristic',
      queriesAllGrantTables(realCanonicalSrc), true);
  }
  let realControlErr = null;
  try { assertCanonicalStillMatches(ROOT); } catch (err) { realControlErr = err; }
  expect('the positive control passes against the real checkout',
    realControlErr === null ? 'ok' : realControlErr.message, 'ok');

  const dir = mkdtempSync(join(tmpdir(), 'check-authz-resolver-selftest-'));
  const write = (rel, body) => {
    mkdirSync(join(dir, dirname(rel)), { recursive: true });
    writeFileSync(join(dir, rel), body);
  };
  try {
    // A tree that mirrors the real one: the canonical resolver, an allow-listed
    // explain mirror, a mention-only seed, two delegating entry points, and one
    // innocent file.
    write(CANONICAL, resolverFixtureBody());
    write('packages/plugins/plugin-security/src/explain-engine.ts', resolverFixtureBody());
    write('packages/plugins/plugin-security/src/objects/default-permission-sets.ts',
      mentionOnlyFixtureBody());
    for (const d of DELEGATORS) write(d, "import { resolveAuthzContext } from '@objectstack/core';\n");
    write('packages/core/src/unrelated.ts', 'export const x = 1;\n');

    expect('a compliant tree passes', audit(dir).length, 0);

    // --- The two ALLOW steps are separable, which is what makes them assertable. ---
    // The explain mirror MUST be matched by the heuristic (positive form — this goes red
    // if the criterion stops recognising resolver shape) and MUST NOT be reported
    // (ALLOW's job). Asserting only the second would pass just as well if the heuristic
    // matched nothing at all — exactly the failure being fixed.
    expect('the allow-listed explain mirror IS matched by the heuristic',
      queriesAllGrantTables(readFileSync(join(dir, 'packages/plugins/plugin-security/src/explain-engine.ts'), 'utf8')), true);

    // --- The criterion is query-shaped, not mention-shaped (#6286). ---
    // NEGATIVE polarity, declared as such: this cannot go red by deleting the predicate,
    // because a predicate that matches nothing also matches no mention-only file. It is
    // here to pin the 18-of-20 noise reduction, and it is load-bearing ONLY next to the
    // positive assertions above and below, which do go red.
    expect('a mention-only file is NOT a duplicate resolver (unquoted keys, prose, name lists)',
      queriesAllGrantTables(mentionOnlyFixtureBody()), false);
    expect('...and it is not reported even though it is NOT allow-listed',
      audit(dir).some((e) => e.includes('default-permission-sets.ts')), false);
    // Querying ONE grant table is ordinary domain code, not grant aggregation. Also
    // negative polarity.
    for (const t of GRANT_TABLES) {
      expect(`querying only ${t} is not a resolver`, queriesAllGrantTables(resolverFixtureBody([t])), false);
    }

    // --- The read-call spellings the criterion must recognise (POSITIVE polarity). ---
    // These go red if READ_VERBS is narrowed or the argument pattern regresses — the
    // recall side of the criterion, which no fixture above can reach because
    // `resolverFixtureBody` only ever emits `ql.find`. The canonical resolver uses the
    // `tryFind` HELPER spelling, so losing it would break the positive control itself.
    const t0 = GRANT_TABLES[0];
    for (const [label, src] of [
      ['member call', `ql.find('${t0}', { where: {} })`],
      ['helper call with a leading argument', `await tryFind(ql, '${t0}', { user_id }, 200)`],
      ['double quotes', `ql.find("${t0}")`],
      ['template literal', 'dataEngine.findOne(`' + t0 + '`)'],
      ['argument on the next line', `this.ql.find(\n      '${t0}',\n      { limit: 1 })`],
    ]) {
      expect(`a read call is recognised — ${label}`, queriesGrantTable(src, t0), true);
    }
    // ...and the shapes that merely CONTAIN the name are not read calls (negative
    // polarity, listed for the record). The nested-call case is the sharp one: the table
    // must be an argument of the READ call, not of something nested inside it.
    for (const [label, src] of [
      ['a comment', `// we read ${t0} here`],
      ['a constant list', `const NAMES = ['${t0}'];`],
      ['an unquoted object key', `${t0}: { allowRead: true },`],
      ['a Set literal', `new Set(['${t0}'])`],
      ['page metadata', `objectName: '${t0}',`],
      ['a nested call inside a read call', `find(wrap('${t0}'))`],
    ]) {
      expect(`not a read call — ${label}`, queriesGrantTable(src, t0), false);
    }

    // (1) — a second file reading rows from every grant table is a duplicate resolver.
    write('packages/rest/src/my-own-resolver.ts', resolverFixtureBody());
    const dupErrors = audit(dir);
    expect('a duplicate resolver is flagged', dupErrors.length, 1);
    expect('the duplicate is named',
      dupErrors[0]?.startsWith('Possible duplicate authorization resolver: packages/rest/src/my-own-resolver.ts'), true);
    rmSync(join(dir, 'packages/rest/src/my-own-resolver.ts'));

    // (1) — the walker must not report test/type files or skipped directories.
    write('packages/rest/src/__tests__/fake.ts', resolverFixtureBody());
    write('packages/rest/src/x.test.ts', resolverFixtureBody());
    // `.d.ts` was named in this assertion's label from the start but never written, so
    // the exclusion it claims to cover was never exercised. Added with the .mts/.cts
    // pass below, which extends that same exclusion to the rest of the family (#6070).
    write('packages/rest/src/x.d.ts', resolverFixtureBody());
    write('packages/rest/dist/x.ts', resolverFixtureBody());
    expect('tests, .d.ts and dist/ are out of scope', audit(dir).length, 0);

    // (1) — `.mts` / `.cts` are the same corpus (#6070). `'x.mts'.endsWith('.ts')` is
    // false, so the suffix-string collector walked past every module-extension source
    // under a root it claims to read in full. Pinned in BOTH directions, because either
    // one alone is satisfiable by a filter that collects nothing:
    //   * the corpus must GROW by exactly the collectable fixtures — a count a
    //     regressed filter cannot reach;
    //   * and the duplicates written in them must be CAUGHT AND NAMED — a verdict an
    //     empty corpus produces zero of, which is what made the original miss silent.
    const beforeExt = collectScanFiles(dir).length;
    write('packages/rest/src/esm-resolver.mts', resolverFixtureBody());
    write('packages/rest/src/cjs-resolver.cts', resolverFixtureBody());
    // The exclusions carry the same family: changing a test's or a declaration's
    // extension must not make it scannable. The repo has none of these four shapes
    // today — that is exactly why they are asserted here rather than trusted.
    for (const excluded of ['x.test.mts', 'x.test.cts', 'x.d.mts', 'x.d.cts']) {
      write(`packages/rest/src/${excluded}`, resolverFixtureBody());
    }
    expect('.mts/.cts join the corpus and their test/declaration shapes stay out',
      collectScanFiles(dir).length, beforeExt + 2);
    const extErrors = audit(dir);
    expect('a duplicate resolver in .mts and one in .cts are both flagged', extErrors.length, 2);
    expect('the .mts duplicate is named', extErrors.some((e) =>
      e.startsWith('Possible duplicate authorization resolver: packages/rest/src/esm-resolver.mts')), true);
    expect('the .cts duplicate is named', extErrors.some((e) =>
      e.startsWith('Possible duplicate authorization resolver: packages/rest/src/cjs-resolver.cts')), true);
    for (const f of ['esm-resolver.mts', 'cjs-resolver.cts', 'x.test.mts', 'x.test.cts', 'x.d.mts', 'x.d.cts']) {
      rmSync(join(dir, 'packages/rest/src', f));
    }
    expect('removing the module-extension fixtures restores the green', audit(dir).length, 0);
    expect('...and restores the corpus to its previous size', collectScanFiles(dir).length, beforeExt);

    // (2) — an entry point that stops delegating.
    write(DELEGATORS[0], '// re-inlined the session/role reads here\n');
    const delErrors = audit(dir);
    expect('a non-delegating entry point is flagged', delErrors.length, 1);
    expect('the entry point is named', delErrors[0]?.startsWith(`${DELEGATORS[0]} no longer delegates`), true);
    write(DELEGATORS[0], "import { resolveAuthzContext } from '@objectstack/core';\n");
    expect('restoring the delegation clears it', audit(dir).length, 0);

    // --- Reverse proof for the positive control (#6286), made permanent. ---
    // Direction declared before running: rewrite the canonical resolver so it reads
    // RENAMED tables — exactly what ADR-0090 D3 did — and the control must go RED and
    // NAME the tables that stopped matching, rather than letting the scan proceed to a
    // "no duplicate resolver" verdict nothing could have produced. Then restore and
    // require green, so the red is caused by the drift and nothing else.
    //
    // This is the assertion whose ABSENCE was the bug: without it the rename produced a
    // gate that could not fail, and every other assertion in this file stayed green.
    write(CANONICAL, resolverFixtureBody(GRANT_TABLES.map((t) => `${t}_v2`)));
    let lostErr = null;
    try { audit(dir); } catch (err) { lostErr = err; }
    expect('a renamed grant table makes the criterion stop matching the canonical resolver',
      lostErr instanceof ResolverSignatureLostError, true);
    expect('the failure names every table that stopped matching',
      lostErr?.missing?.join(',') ?? '<none>', GRANT_TABLES.join(','));
    expect('the failure names the resolver it could not match',
      (lostErr?.detail ?? '').includes(CANONICAL), true);

    // A PARTIAL rename is the likelier real accident (one table follows, one is missed),
    // and it must be just as red — naming only the table left behind.
    write(CANONICAL, resolverFixtureBody([GRANT_TABLES[0], `${GRANT_TABLES[1]}_v2`]));
    let partialRenameErr = null;
    try { audit(dir); } catch (err) { partialRenameErr = err; }
    expect('a partially renamed vocabulary is red too',
      partialRenameErr instanceof ResolverSignatureLostError, true);
    expect('...and names only the table that stopped matching',
      partialRenameErr?.missing?.join(',') ?? '<none>', GRANT_TABLES[1]);

    // The resolver moving away is the same loss by another route.
    rmSync(join(dir, CANONICAL));
    let movedErr = null;
    try { audit(dir); } catch (err) { movedErr = err; }
    expect('a canonical resolver that moved away is red, not a silently passing scan',
      movedErr instanceof ResolverSignatureLostError, true);

    write(CANONICAL, resolverFixtureBody());
    expect('restoring the canonical resolver restores the green', audit(dir).length, 0);

    // --- Reverse proof for the dead-root hard error (#4930), made permanent. ---
    // Everything above ran green over a tree whose scan root resolves. That
    // observation is worth nothing on its own: the defect being fixed here is a
    // scan that concludes "clean" *because* it could not open its root. So break
    // the root the way a rename breaks it in the real repo, require red, require
    // the red to name the root, then restore it and require green again.
    // Red-then-green, in the same run, every run.
    const renamed = join(dir, 'packages-renamed-by-self-test');
    renameSync(join(dir, 'packages'), renamed);
    let deadErr = null;
    try { audit(dir); } catch (err) { deadErr = err; }
    expect('a renamed scan root throws instead of quietly scanning nothing',
      deadErr instanceof DeadRootError, true);
    expect('the failure names the dead root', deadErr?.roots?.join(',') ?? '<none>', 'packages');
    expect('the failure says why', deadErr?.dead?.[0]?.reason ?? '<none>', 'does not exist');

    // A root that exists but is not a directory is dead in the same way: the old
    // `catch { return out; }` swallowed its ENOTDIR exactly as it swallowed ENOENT.
    writeFileSync(join(dir, 'packages'), 'not a directory');
    let notDirErr = null;
    try { audit(dir); } catch (err) { notDirErr = err; }
    expect('a scan root that is a file is dead too',
      notDirErr?.dead?.[0]?.reason ?? '<none>', 'exists but is not a directory');

    rmSync(join(dir, 'packages'));
    renameSync(renamed, join(dir, 'packages'));

    // An entry the walk cannot stat INSIDE the root is the same defect one level
    // in: `catch { continue; }` used to drop it and carry on, so the scan reached
    // a "no duplicate resolver" verdict over files it never opened. A dangling
    // symlink is that case, deterministically.
    symlinkSync(join(dir, 'no-such-target'), join(dir, 'packages', 'dangling'));
    let partialErr = null;
    try { audit(dir); } catch (err) { partialErr = err; }
    expect('an entry the walk cannot stat is an error, not a smaller corpus', partialErr?.code, 'ENOENT');
    rmSync(join(dir, 'packages', 'dangling'));

    // ...and restoring the tree restores the green, so the reds above were caused
    // by the broken root and nothing else.
    expect('restoring the root makes the audit green again', audit(dir).length, 0);

    // --- Reverse proof for the empty-scan hard error (#5916), same discipline. ---
    // The direction was decided before it was run: a root that resolves and yields
    // nothing must be RED, and the red must name that root only. This is the case
    // #4930's assertion cannot reach — nothing is renamed, nothing is unreadable,
    // the directory is right there; the corpus is simply not in it any more.
    const baseline = collectScanFiles(dir).length;
    expect('the compliant tree yields a corpus to reason over', baseline > 0, true);

    // SCAN_ROOTS holds a single entry today, so "only that root is named" has to be
    // driven over an injected two-root list — the parameter `collectScanFiles` already
    // takes. Adding a second REAL scan root to prove a self-test point would be a
    // change to what the gate scans, which is not this assertion's business.
    const twoRoots = ['packages', 'tools'];
    mkdirSync(join(dir, 'tools'), { recursive: true });
    writeFileSync(join(dir, 'tools', 'notes.md'), 'sources moved to tools/src-new/\n');
    let oneEmptyErr = null;
    try { collectScanFiles(dir, twoRoots); } catch (err) { oneEmptyErr = err; }
    expect('a root that resolves but yields nothing is red', oneEmptyErr instanceof EmptyRootError, true);
    expect('the failure names the empty root', oneEmptyErr?.roots?.join(',') ?? '<none>', 'tools');
    expect('the failure does not blame the populated root',
      /packages/.test(oneEmptyErr?.roots?.join(',') ?? ''), false);
    // The populated root was still walked, so the total proves the run was not simply
    // aborted — and that a per-root floor is not a total floor.
    expect('the failure reports what the run did find', oneEmptyErr?.total ?? -1, baseline);

    write('tools/helper.ts', 'export const noop = () => {};\n');
    expect('one file under the empty root restores the green',
      collectScanFiles(dir, twoRoots).length, baseline + 1);
    rmSync(join(dir, 'tools'), { recursive: true, force: true });

    // ...and the extreme the issue named: every declared root resolves, the whole
    // scan finds nothing, and check (1) drew "no duplicate resolver" from zero files.
    // `audit` must surface THAT, not the downstream "Delegator missing" pair it used
    // to report — the misdiagnosis the header calls luck rather than coverage.
    const bare = mkdtempSync(join(tmpdir(), 'check-authz-resolver-selftest-empty-'));
    let allEmptyErr = null;
    let bareErrors = null;
    try {
      for (const rel of SCAN_ROOTS) mkdirSync(join(bare, rel), { recursive: true });
      try { bareErrors = audit(bare); } catch (err) { allEmptyErr = err; }
    } finally {
      rmSync(bare, { recursive: true, force: true });
    }
    expect('a scan that finds nothing at all is red, not a vacuous "no duplicates"',
      allEmptyErr instanceof EmptyRootError, true);
    expect('every empty root is named', allEmptyErr?.roots?.join(',') ?? '<none>', SCAN_ROOTS.join(','));
    expect('the zero total is reported', allEmptyErr?.total ?? -1, 0);
    expect('the empty scan is reported instead of a misleading delegator verdict', bareErrors, null);

    // Restoring the tree restores the green one last time, so every red above was
    // caused by the missing corpus and nothing else.
    expect('the untouched tree is still green', audit(dir).length, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  if (failures.length) {
    console.error(`\n✗ check-single-authz-resolver self-test failed:\n${failures.join('\n')}\n`);
    process.exit(1);
  }
  console.log(
    '✓ check-single-authz-resolver self-test: the query-shaped criterion (resolver shapes are ' +
    'caught and named, mention-only files and single-table reads are not), the real-repo ' +
    'positive control (the canonical resolver is still matched by check (1)\'s heuristic) and ' +
    'its reverse proof (red and named when a grant table is renamed, fully or partially, or the ' +
    'resolver moves; green when restored), allow-list reasons, duplicate detection, delegation, ' +
    'the extension family (.mts/.cts enter the corpus and their duplicates are named; .test./.d. ' +
    'shapes of every extension stay out), the dead-root hard error (red when the scan root is ' +
    'renamed, green when restored) and the empty-scan hard error (red when one declared root ' +
    'yields nothing and when the whole scan does, green when restored) all hold.',
  );
}

function main() {
  if (process.argv.includes('--self-test')) return selfTest();

  let errors;
  try {
    errors = audit();
  } catch (err) {
    if (err instanceof DeadRootError) {
      reportDeadRoots(err);
      process.exit(1);
      return;
    }
    if (err instanceof EmptyRootError) {
      reportEmptyRoots(err);
      process.exit(1);
      return;
    }
    if (err instanceof ResolverSignatureLostError) {
      reportSignatureLost(err);
      process.exit(1);
      return;
    }
    throw err;
  }

  if (errors.length) {
    console.error('✗ check:authz-resolver failed:\n\n' + errors.join('\n\n') + '\n');
    process.exit(1);
  }
  console.log('✓ check:authz-resolver: single shared authorization resolver intact; both entry points delegate.');
}

main();
