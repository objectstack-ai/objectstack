#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * check-parse-guard -- every `scripts/**` TypeScript parse goes through ONE module,
 * and every parse this gate CANNOT reach is counted rather than left unsaid.
 *
 *   node scripts/check-parse-guard.mjs              # scan the tree
 *   node scripts/check-parse-guard.mjs --self-test  # verify the checker itself
 *
 * ## What this gate is for
 *
 * `ts.createSourceFile` never throws. Hand it a syntax error and it returns a
 * `SourceFile` built by error recovery, with the errors parked on
 * `parseDiagnostics` -- a property that NOTHING in `scripts/` read. Fifteen
 * gates walked TypeScript that way, so any one of them could report a confident
 * zero about a file it never managed to read: **a file the gate could not read,
 * scored as a file with nothing to report.**
 *
 * `scripts/ts-parse.mjs` is the fix -- it reads the diagnostics and REFUSES.
 * This gate is the half that makes the fix hold, and without it the helper
 * would be strictly worse than fifteen hand-written checks: a sixteenth gate
 * typing the raw call would inherit the whole defect, and its symptom is a
 * GREEN LINE, so nobody would notice. Converting the callers is a one-time
 * sweep; this file is what covers the caller that has not been written yet.
 *
 * That is not a theory about the tree, it is the tree's own measured result
 * twice over: `check-entry-guard.mjs` exists because a one-time sweep of 33
 * files did not stop a twelfth spelling of "was I run?", and `js-comment-mask.mjs`
 * exists because two private `stripComments` families drifted apart in two
 * different directions.
 *
 * ## Why a spelling gate rather than a behavioural sweep
 *
 * The same answer `check-entry-guard.mjs` gives, and for the same reason: many
 * `scripts/**` entry points have real side effects, so a gate that RUNS them
 * all is a gate nobody can run locally, and "did it refuse?" is not a decidable
 * property of an arbitrary tool. The behavioural evidence lives once, at the
 * module: `ts-parse.mjs --self-test` spawns real children and pins that every
 * measured wreck refuses, names its file, and cannot be swallowed by a caller's
 * `try/catch`. Pinning the refusal once and enforcing that everyone routes
 * through it covers the same ground for fifteen callers, and keeps covering it
 * for the sixteenth.
 *
 * ## What it reads
 *
 * Comments AND string/template/regex literals are masked before the scan
 * (`js-comment-mask.mjs`), for the same reason `check-entry-guard.mjs` masks
 * them: `ts-parse.mjs`'s own header discusses `ts.createSourceFile` at length,
 * gates quote it in their prose, and a spawned child's source can carry it in a
 * string payload. None of those is a call site, and an allowlist to excuse them
 * would be a hole the next such file falls through silently.
 *
 * ## All THREE parser entry points, not just the loudest one
 *
 * `createSourceFile` is one of three ways into the TypeScript parser, and the
 * other two are quieter. `ts.createProgram` parks syntax errors behind a second
 * call, `getSyntacticDiagnostics()`; `ts.transpileModule` reports nothing at
 * all unless `reportDiagnostics: true` is passed, and still hands back an
 * `outputText` that is not JavaScript. All three are banned here and all three
 * have a checked counterpart in `ts-parse.mjs`.
 *
 * They were covered separately at first, on the reasoning that folding them in
 * would make one helper carry two promises. What that actually bought was a
 * green line narrower than it read: this gate said "every TypeScript parse goes
 * through ts-parse.mjs" while two live gates in the same directory parsed
 * through neither, and its own header was the only place that said so. A scope
 * caveat that lives in a header is not enforced by anything, so the caveat is
 * now a bound this file computes.
 *
 * ## What it still does NOT cover -- and now COUNTS instead of leaving unsaid
 *
 * Parses outside `scripts/**` are not banned here, for the reason
 * `invoked-as.mjs` gives for its own `packages/cli` sibling: `scripts/` runs as
 * plain `.mjs` against a possibly unbuilt tree, and making a PUBLISHED package
 * depend on repo tooling to answer "did this parse?" trades this bug for a
 * worse one. Whether the package-side validators want the same REFUSAL at all
 * is a real question and not this gate's to answer: a `scripts/**` gate audits
 * a tree its author controls, while a publish-time lint validator is handed
 * metadata by someone else and may legitimately want to REPORT an unparseable
 * source rather than end the process.
 *
 * What is this gate's to answer is whether its own verdict tells the truth
 * about its reach. So the out-of-tree population is walked, counted and NAMED
 * on every run. "120 files covered" reads as a statement about the repository;
 * "120 files covered, N parses outside my scope, here they are" is the same
 * measurement without the borrowed authority -- and the number moves when
 * somebody adds one, which a sentence in a header never does.
 *
 * ## The census used to make ONE claim about THREE populations
 *
 * The paragraph above is right about a published package. It was printed over
 * every out-of-tree row, and for most of them it is not true: measured on this
 * tree, 9 of the 28 sites live in `<pkg>/scripts/**` -- package-local tooling
 * carried by no `files` entry in its own `package.json`, so it ships in no
 * tarball and is `scripts/**` in everything but its path. "They cannot import
 * scripts/ts-parse.mjs" is a statement about a constraint those 9 do not have:
 * `packages/spec/scripts/check-browser-reachable-entries.ts` already imports
 * `scanSource` from `../../../scripts/js-comment-mask.mjs`, and the hand-written
 * `.d.mts` mirrors that make such an import typecheck from a `.ts` tool are
 * already a governed corpus (`check-declaration-mirrors.mjs`).
 *
 * A census that reports a real measurement under a reason that does not apply
 * to most of what it counted is this file's own subject matter, one block down
 * from where it is argued -- so the rows are TIERED by a property read off the
 * owning `package.json` rather than assumed, and each tier is printed under the
 * sentence that is true of it. `shipped` keeps the paragraph above. `tooling`
 * gets the capability fact and nothing more: these CAN import the helper today.
 * Whether each SHOULD is still per-row and still not this gate's to answer --
 * three of those 9 parse an extracted prose snippet speculatively (a doc block
 * re-read as a parenthesized expression; a skill example whose syntax verdict
 * is owned by a real `tsc` that follows), and for those a refusal that exits
 * would end the process on ordinary input.
 *
 * The tier is DERIVED, never listed: a hand-kept list of tooling directories
 * fails by quietly leaving a new one in the wrong tier, which is the same
 * silence `walkOutside` refuses for the same reason.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isEntrypoint } from './invoked-as.mjs';
import { blank, scanSource } from './js-comment-mask.mjs';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const REPO_ROOT = resolve(HERE, '..');
const SCRIPTS = HERE;

/** The one module allowed to reach the TypeScript parser directly. */
const PARSER_HOME = join(SCRIPTS, 'ts-parse.mjs');

/**
 * The three parser entry points, each with the checked call that replaces it.
 *
 * The receiver is deliberately NOT part of any pattern: a gate that renamed its
 * `typescript` import, or destructured the function, would otherwise walk
 * straight through. Matching the bare name costs a masked mention in prose,
 * which is why prose is masked before the scan.
 */
export const ENTRY_POINTS = [
  {
    spelling: 'createSourceFile',
    what: 'ts.createSourceFile',
    why: 'a raw parse whose parseDiagnostics nobody reads',
    canonical: 'parseSourceFile(fileName, text /*, scriptKind */)',
  },
  {
    spelling: 'createProgram',
    what: 'ts.createProgram',
    why: 'a Program whose getSyntacticDiagnostics() nobody calls',
    canonical: 'createProgramChecked(rootNames, options /*, host */)',
  },
  {
    spelling: 'transpileModule',
    what: 'ts.transpileModule',
    why: 'a transpile that reports NOTHING without reportDiagnostics: true',
    canonical: 'transpileChecked(fileName, text /*, transpileOptions */)',
  },
];

/** The canonical `createSourceFile` replacement, kept as its own export. */
export const CANONICAL = ENTRY_POINTS[0].canonical;

/** One alternation over every banned spelling. Rebuilt from the table above. */
const SPELLINGS = new RegExp(`\\b(${ENTRY_POINTS.map((e) => e.spelling).join('|')})\\b`, 'g');

/** Build outputs and vendored trees are nobody's source. */
const SKIP_DIRS = new Set([
  'node_modules', 'dist', 'build', 'coverage', '.turbo', '.next', '.cache', '.git', 'out',
]);

/** Anything the repo authors and TypeScript can parse. `.d.ts` is generated. */
const OUTSIDE_EXT = /\.(?:[cm]?[jt]sx?)$/;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (name.endsWith('.mjs') || name.endsWith('.js') || name.endsWith('.cjs')) out.push(p);
  }
  return out;
}

/**
 * Everything the repo authors OUTSIDE `scripts/**` -- the population this gate
 * reports on but does not govern.
 *
 * Walked from the repository root rather than from a list of directories on
 * purpose: a list would have to be edited when a new top-level tree appears,
 * and the failure of an un-edited list is a census that quietly stops counting
 * a whole directory. That is the same shape of silence this file exists for.
 */
function walkOutside(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name) || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (p === SCRIPTS) continue; // governed above; not "outside"
    const st = statSync(p);
    if (st.isDirectory()) walkOutside(p, out);
    else if (OUTSIDE_EXT.test(name) && !name.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

/** Code only: comments, strings, templates and regex literals all blanked. */
export function codeOnly(source) {
  const { comment, literal } = scanSource(source);
  const both = new Uint8Array(comment.length);
  for (let i = 0; i < both.length; i++) both[i] = comment[i] || literal[i];
  return blank(source, both);
}

function lineOf(source, index) {
  return source.slice(0, index).split('\n').length;
}

/**
 * Findings for one file's source. Exported so the self-test drives the real
 * scanner over fixture sources rather than over this tree, which would only
 * prove what today's tree happens to contain.
 */
export function scanFile(rel, source, { isParserHome = false } = {}) {
  if (isParserHome) return [];
  // Cheap prefilter. Masking is not free and the out-of-tree census reads every
  // authored file in the repository; masking cannot INTRODUCE a spelling, so a
  // source with none is already answered.
  if (!SPELLINGS.test(source)) {
    SPELLINGS.lastIndex = 0;
    return [];
  }
  SPELLINGS.lastIndex = 0;

  const findings = [];
  const code = codeOnly(source);

  let m;
  while ((m = SPELLINGS.exec(code))) {
    const entry = ENTRY_POINTS.find((e) => e.spelling === m[1]);
    findings.push({
      rel,
      line: lineOf(source, m.index),
      what: entry.what,
      why: entry.why,
      canonical: entry.canonical,
    });
  }
  SPELLINGS.lastIndex = 0;
  return findings;
}

/**
 * Does `files` (a `package.json` `files` array) pack `scripts/`?
 *
 * Read rather than assumed: the whole point of the `tooling` tier is that those
 * files reach no tarball, and the only authority on that is the manifest. A
 * package that starts publishing its tooling flips to `shipped` on the next run
 * with nothing to edit here.
 */
function packsScripts(files) {
  return files.some((entry) => {
    const n = String(entry).replace(/^\.\//, '');
    // `*` / `**` pack the whole directory; anything rooted at scripts/ packs it.
    return n === '*' || n.startsWith('**') || n === 'scripts' || n.startsWith('scripts/');
  });
}

/**
 * Which of the three populations a row belongs to.
 *
 * `test` first, because a test under `<pkg>/scripts/**` is a test before it is
 * tooling and the existing tier is what its self-test pins.
 *
 * Then: walk UP to the nearest `package.json` -- the owning package -- and ask
 * whether the file sits in that package's `scripts/` while the manifest packs
 * no such path. Walking up rather than matching `packages/<name>/scripts/`
 * keeps the rule true for `apps/**`, `examples/**` and any tree added later,
 * which a depth-2 pattern silently would not.
 *
 * Every unresolved case answers `shipped`: no manifest found, no `files` field
 * (npm then packs the whole directory), or a `files` array that does pack
 * `scripts/`. `shipped` is the tier that keeps the strong "cannot import"
 * claim, so an unproven row keeps the cautious sentence rather than acquiring a
 * capability nobody demonstrated.
 *
 * @param {string} rel  Repo-relative path.
 * @param {boolean} isTest
 * @param {(dir: string) => { files?: unknown } | null} packageAt  The owning
 *   manifest, or null when there is none. Injected so the self-test drives real
 *   classification over fixtures instead of over today's tree.
 * @returns {'test' | 'tooling' | 'shipped'}
 */
export function tierOf(rel, isTest, packageAt) {
  if (isTest) return 'test';
  const parts = rel.split('/');
  for (let i = parts.length - 1; i > 0; i--) {
    const dir = parts.slice(0, i).join('/');
    const pkg = packageAt(dir);
    if (!pkg) continue;
    if (!`${rel.slice(dir.length + 1)}/`.startsWith('scripts/')) return 'shipped';
    return Array.isArray(pkg.files) && !packsScripts(pkg.files) ? 'tooling' : 'shipped';
  }
  return 'shipped';
}

/** The owning `package.json` at `dir`, or null. Parse failures answer null. */
function readPackageAt(dir) {
  try {
    return JSON.parse(readFileSync(join(REPO_ROOT, dir, 'package.json'), 'utf8'));
  } catch {
    return null;
  }
}

/**
 * The out-of-tree census: the same scanner, a different verdict.
 *
 * Deliberately the SAME `scanFile` the governed half runs. A second scanner for
 * the reported half would drift from the governed one in the direction that
 * makes the census read lower than the truth, which is the exact failure this
 * file is about.
 *
 * @param {(abs: string) => string} read  Injected so the self-test can drive
 *   this over fixtures rather than over whatever today's tree happens to hold.
 * @param {(dir: string) => { files?: unknown } | null} [packageAt]  Injected for
 *   the same reason, and memoized here: a census row's tier costs one manifest
 *   read per directory, not one per row.
 */
export function censusOutside(
  files,
  read,
  rootFor = (abs) => relative(REPO_ROOT, abs),
  packageAt = readPackageAt,
) {
  const manifests = new Map();
  const lookup = (dir) => {
    if (!manifests.has(dir)) manifests.set(dir, packageAt(dir));
    return manifests.get(dir);
  };
  const rows = [];
  for (const abs of files) {
    const rel = rootFor(abs);
    for (const f of scanFile(rel, read(abs))) {
      const isTest = /\.(?:test|spec|pin\.test)\.[cm]?[jt]sx?$/.test(rel);
      rows.push({ ...f, isTest, tier: tierOf(rel, isTest, lookup) });
    }
  }
  rows.sort((a, b) => a.rel.localeCompare(b.rel) || a.line - b.line);
  return rows;
}

function main() {
  const files = walk(SCRIPTS).sort();
  const findings = [];
  let scanned = 0;
  for (const abs of files) {
    if (abs === resolve(fileURLToPath(import.meta.url))) continue; // this file names the call it bans
    scanned += 1;
    const rel = relative(REPO_ROOT, abs);
    findings.push(...scanFile(rel, readFileSync(abs, 'utf8'), { isParserHome: abs === PARSER_HOME }));
  }

  if (findings.length) {
    console.error(`x  check:parse-guard — ${findings.length} raw TypeScript parse(s) in scripts/:\n`);
    for (const f of findings) console.error(`  ${f.rel}:${f.line}  ${f.what}  — ${f.why}`);
    const used = ENTRY_POINTS.filter((e) => findings.some((f) => f.what === e.what));
    console.error(
      `\n    NONE of the three TypeScript parser entry points THROWS on a source`
        + `\n    it cannot read. createSourceFile returns a recovered partial tree`
        + `\n    with the errors parked on parseDiagnostics; createProgram parks`
        + `\n    them behind a second call, getSyntacticDiagnostics(); transpileModule`
        + `\n    reports nothing at all without reportDiagnostics: true and still`
        + `\n    returns an outputText. In every case a scan of the result finds none`
        + `\n    of what it is looking for and scores the source CLEAN — the gate`
        + `\n    prints its green line over something it could not read.`
        + `\n`
        + `\n    Route it through the one module that reads them:`
        + `\n`
        + `\n      import { ${used.map((e) => e.canonical.replace(/\(.*$/, '')).join(', ')} } from './ts-parse.mjs';`
        + `\n      // '../ts-parse.mjs' from a subdirectory`
        + used.map((e) => `\n      ${e.canonical}`).join('')
        + `\n`
        + `\n    Omit scriptKind unless the source has no real file name: TypeScript`
        + `\n    infers it from the extension, and forcing one is its own blind spot`
        + `\n    (a gate here really was reading 32 of its 2504 files as wreckage).`
        + `\n`
        + `\n    scripts/ts-parse.mjs carries the rationale and the refusal fixtures.`,
    );
    return 1;
  }

  console.log(
    `✓ check:parse-guard: ${scanned} scripts/ file(s) — every TypeScript parse goes through ts-parse.mjs.`,
  );
  reportOutside(censusOutside(walkOutside(REPO_ROOT), (abs) => readFileSync(abs, 'utf8')));
  return 0;
}

/**
 * Print the population this gate reports on but does not govern.
 *
 * Not a failure, and deliberately not a ratchet: what the package side should
 * DO about these is an open shape question (see the header), and a ratchet
 * would force an answer by making the next unrelated PR red. What it must not
 * be is absent — the green line above is a claim about `scripts/**`, and
 * without this block it reads as a claim about the repository.
 */
export const TIERS = [
  {
    tier: 'shipped',
    label: 'shipped package source',
    why: [
      'A published package cannot answer "did this parse?" through repo tooling —',
      '`scripts/` runs as plain .mjs against a possibly unbuilt tree, so importing it',
      'from shipped source trades this bug for a worse one. These need their own',
      'shape, and it may not be a refusal at all: a validator handed metadata by',
      'someone else may owe its caller a FINDING rather than an exit.',
    ],
  },
  {
    tier: 'tooling',
    label: 'unpublished package tooling',
    why: [
      'These sit in `<pkg>/scripts/**` and their own package.json packs no such path,',
      'so they reach no tarball — `scripts/**` in everything but their path. The',
      'constraint above is not theirs: they CAN import scripts/ts-parse.mjs today, the',
      'way packages/spec/scripts/check-browser-reachable-entries.ts already imports',
      'scripts/js-comment-mask.mjs. Whether each SHOULD is still per-row — a parse that',
      'speculatively re-reads an extracted prose snippet is meant to fail sometimes,',
      'and an exiting refusal would end the process on ordinary input.',
    ],
  },
  {
    tier: 'test',
    label: 'tests',
    why: [
      'A test that parses TypeScript to assert something about a parse is doing its',
      'job. Listed for the count, not as work.',
    ],
  },
];

export function reportOutside(rows) {
  const files = new Set(rows.map((r) => r.rel));
  const byTier = TIERS.map((t) => ({ ...t, rows: rows.filter((r) => r.tier === t.tier) }));
  console.log(
    `   … and ${rows.length} parse(s) OUTSIDE scripts/ in ${files.size} file(s) that this gate does`
      + ` NOT govern — ${byTier.map((t) => `${t.rows.length} in ${t.label}`).join(', ')}:`,
  );
  for (const t of byTier) {
    if (t.rows.length === 0) continue;
    console.log(`\n   ${t.label} — ${t.rows.length} parse(s) in ${new Set(t.rows.map((r) => r.rel)).size} file(s):`);
    for (const r of t.rows) console.log(`     ${r.rel}:${r.line}  ${r.what}`);
    for (const line of t.why) console.log(`     ${line}`);
  }
  console.log(
    `\n   Counted, named and TIERED so each line is read as what it is: the green line`
      + `\n   above is a statement about scripts/, and the reason a published package`
      + `\n   cannot import the helper is a statement about ${byTier[0].rows.length} of these ${rows.length}, not all`
      + `\n   of them. Tier is read off the owning package.json, never listed here.`
      + `\n   Shape decision: see the header.`,
  );
}

// ---------------------------------------------------------------------------
// Self-test -- fixture sources, not this tree
// ---------------------------------------------------------------------------

export function selfTest() {
  const cases = [];
  const t = (name, ok, detail) => cases.push({ name, ok: Boolean(ok), detail });
  const hits = (src, opts) => scanFile('fixture.mjs', src, opts);

  // -- the call this gate exists to catch, in each spelling ------------------
  t('a plain ts.createSourceFile is a finding',
    hits('const sf = ts.createSourceFile(f, text, ts.ScriptTarget.Latest, true);').length === 1);
  t('an aliased receiver is a finding too — the receiver is not part of the pattern',
    hits('const sf = tsc.createSourceFile(f, text);').length === 1);
  t('a destructured createSourceFile is a finding',
    hits('import { createSourceFile } from "typescript";\nconst sf = createSourceFile(f, text);').length === 2);
  t('two call sites in one file are two findings',
    hits('ts.createSourceFile(a, b);\nts.createSourceFile(c, d);').length === 2);

  // -- the OTHER two parser entry points, same gate -------------------------
  t('a ts.createProgram is a finding',
    hits('const p = ts.createProgram([entry], OPTIONS);').length === 1);
  t('a ts.transpileModule is a finding',
    hits('const js = ts.transpileModule(code, opts).outputText;').length === 1);
  t('an aliased or destructured createProgram is a finding too',
    hits('import { createProgram } from "typescript";\nconst p = createProgram(files, o);').length === 2);
  const allThree = hits('ts.createSourceFile(a, b);\nts.createProgram(c, d);\nts.transpileModule(e, f);');
  t('one file reaching all three entry points is three findings, each naming its own API',
    allThree.length === 3
      && allThree.map((f) => f.what).join(',') === 'ts.createSourceFile,ts.createProgram,ts.transpileModule',
    JSON.stringify(allThree.map((f) => f.what)));
  t('each finding carries the checked call that replaces THAT api',
    allThree[1].canonical.startsWith('createProgramChecked')
      && allThree[2].canonical.startsWith('transpileChecked'),
    JSON.stringify(allThree.map((f) => f.canonical)));

  // -- the CHECKED calls must not match the banned ones. The names share a
  //    prefix, so this is one word boundary away from banning the fix itself
  //    and turning every converted call site red. ---------------------------
  t('createProgramChecked is not a createProgram finding',
    hits('import { createProgramChecked } from "./ts-parse.mjs";\n'
      + 'const p = createProgramChecked(files, OPTIONS);').length === 0);
  t('transpileChecked is not a transpileModule finding',
    hits('import { transpileChecked } from "./ts-parse.mjs";\n'
      + 'const js = transpileChecked(name, code, opts).outputText;').length === 0);

  // -- the shared /g regex is reused for a prefilter AND a scan; a stale
  //    lastIndex would make the SECOND file with a call site read clean ------
  const twice = 'const sf = ts.createSourceFile(f, t);';
  t('scanning the same source twice gives the same answer (no lastIndex carry-over)',
    hits(twice).length === 1 && hits(twice).length === 1);
  t('a file with no spelling at all does not disturb the next file that has one',
    hits('const a = 1;').length === 0 && hits(twice).length === 1);

  // -- the finding is openable ----------------------------------------------
  const located = hits('const x = 1;\nconst y = 2;\nconst sf = ts.createSourceFile(f, t);');
  t('the finding carries the line number of the call',
    located.length === 1 && located[0].line === 3, JSON.stringify(located));

  // -- prose and payloads are NOT call sites. Getting this wrong makes the
  //    gate fabricate findings out of its own documentation. ----------------
  t('a line comment naming the call is not a finding',
    hits('// ts.createSourceFile never throws\nconst a = 1;').length === 0);
  t('a block comment naming the call is not a finding',
    hits('/**\n * ts.createSourceFile never throws.\n */\nconst a = 1;').length === 0);
  t('a string payload naming the call is not a finding',
    hits('const probe = "ts.createSourceFile(f, t)";').length === 0);
  t('prose naming the other two entry points is not a finding either',
    hits('// ts.createProgram parks syntax behind getSyntacticDiagnostics()\n'
      + '/* ts.transpileModule reports nothing by default */\nconst a = 1;').length === 0);
  t('a template payload naming the call is not a finding',
    hits('const probe = `const sf = ts.createSourceFile(${f}, ${t});`;').length === 0);

  // -- the sanctioned call is silent ----------------------------------------
  t('the canonical parseSourceFile call is not a finding',
    hits('import { parseSourceFile } from "./ts-parse.mjs";\nconst sf = parseSourceFile(file, text);').length === 0);

  // -- the parser home is exempt, and ONLY the parser home ------------------
  t('the parser home may call it',
    hits('const sf = ts.createSourceFile(f, t);', { isParserHome: true }).length === 0);
  t('…and any other file may not',
    hits('const sf = ts.createSourceFile(f, t);', { isParserHome: false }).length === 1);
  t('the parser home is exempt for all three entry points, not just the first',
    hits('ts.createSourceFile(a, b);\nts.createProgram(c, d);\nts.transpileModule(e, f);',
      { isParserHome: true }).length === 0);

  // -- the out-of-tree census: the SAME scanner, a different verdict ---------
  const OUTSIDE = new Map([
    ['packages/lint/src/validate-react-page-props.ts', 'sf = tsc.createSourceFile("page.tsx", src);'],
    ['packages/spec/scripts/build-api-surface.ts', 'const program = ts.createProgram(entries, o);'],
    ['packages/spec/src/ui/app.test.ts', 'const program = ts.createProgram([entry], {});'],
    ['packages/lint/src/clean.ts', '// nothing to see here\nexport const a = 1;'],
  ]);
  // Manifests injected, so the tiering is driven over fixtures rather than over
  // whatever today's tree happens to publish — the same reason `read` is.
  const MANIFESTS = new Map([
    ['packages/lint', { files: ['dist', 'README.md'] }],
    ['packages/spec', { files: ['dist', 'src/**/*.zod.ts'] }],
  ]);
  const pkgAt = (dir) => MANIFESTS.get(dir) ?? null;
  const census = censusOutside([...OUTSIDE.keys()], (k) => OUTSIDE.get(k), (k) => k, pkgAt);
  t('the census counts every out-of-tree parse, whatever the api',
    census.length === 3, JSON.stringify(census.map((r) => `${r.rel}:${r.what}`)));
  t('the census marks a test-file site as a test and a shipped one as not',
    census.filter((r) => r.isTest).length === 1
      && census.find((r) => r.isTest).rel === 'packages/spec/src/ui/app.test.ts',
    JSON.stringify(census.map((r) => [r.rel, r.isTest])));
  t('a clean out-of-tree file contributes nothing to the census',
    !census.some((r) => r.rel.endsWith('clean.ts')));
  t('the census is sorted, so its printed block is diffable run to run',
    census.map((r) => r.rel).join('|')
      === [...census].sort((a, b) => a.rel.localeCompare(b.rel)).map((r) => r.rel).join('|'));

  // -- the TIER: which of the three sentences the row is printed under. The
  //    census reported a real number under a reason that was false for most of
  //    what it counted, so every branch is asserted, both ways. --------------
  const tierAt = (rel, isTest = false) => tierOf(rel, isTest, pkgAt);
  t('a row in a package\'s unpublished scripts/ is tooling',
    tierAt('packages/spec/scripts/build-api-surface.ts') === 'tooling',
    tierAt('packages/spec/scripts/build-api-surface.ts'));
  t('…and so is one nested deeper inside it',
    tierAt('packages/spec/scripts/lib/strictness-ledger.ts') === 'tooling');
  t('a row in the package\'s own src/ is shipped, NOT tooling',
    tierAt('packages/lint/src/validate-react-page-props.ts') === 'shipped',
    tierAt('packages/lint/src/validate-react-page-props.ts'));
  t('the census carries the tier it will be printed under',
    census.find((r) => r.rel.startsWith('packages/spec/scripts/')).tier === 'tooling'
      && census.find((r) => r.rel.startsWith('packages/lint/src/')).tier === 'shipped',
    JSON.stringify(census.map((r) => [r.rel, r.tier])));
  t('a test wins over its location — a test inside scripts/ is still a test',
    tierAt('packages/spec/scripts/dist-freshness.test.ts', true) === 'test');

  // The tier is a READ of the manifest, not a guess from the path. A package
  // that packs its scripts/ must lose the "you can import the helper" sentence,
  // or the census is back to printing one claim over two populations.
  const packing = (dir) => (dir === 'packages/spec' ? { files: ['dist', 'scripts'] } : null);
  t('a package that PACKS scripts/ makes its tooling row shipped again',
    tierOf('packages/spec/scripts/build-api-surface.ts', false, packing) === 'shipped',
    tierOf('packages/spec/scripts/build-api-surface.ts', false, packing));
  // The manifest is offered at the PACKAGE dir ONLY. A lambda that answers for
  // every directory makes `<pkg>/scripts` a package in its own right, so the row
  // never reaches the scripts/ test at all and the case goes green without
  // exercising it — which is exactly how the three below first passed while
  // `packsScripts` was ablated to a constant `false`.
  const at = (dir, manifest) => (d) => (d === dir ? manifest : null);
  const glob = at('packages/x', { files: ['**/*'] });
  t('a glob that packs everything counts as packing scripts/ too',
    tierOf('packages/x/scripts/t.mjs', false, glob) === 'shipped',
    tierOf('packages/x/scripts/t.mjs', false, glob));
  const noFiles = at('packages/x', { name: '@f/x' });
  t('no files field at all is shipped — npm packs the whole directory',
    tierOf('packages/x/scripts/t.mjs', false, noFiles) === 'shipped',
    tierOf('packages/x/scripts/t.mjs', false, noFiles));
  t('no owning package.json anywhere is shipped — the cautious tier',
    tierOf('some/loose/file.ts', false, () => null) === 'shipped');
  t('the NEAREST package.json owns the row, not an ancestor that packs differently',
    tierOf('packages/spec/inner/scripts/t.ts', false,
      (d) => (d === 'packages/spec/inner' ? { files: ['dist'] }
        : d === 'packages/spec' ? { files: ['scripts'] } : null)) === 'tooling');
  const segment = at('packages/x', { files: ['dist'] });
  t('a path merely CONTAINING scripts in a segment name is not tooling',
    tierOf('packages/x/scripts-util/t.ts', false, segment) === 'shipped',
    tierOf('packages/x/scripts-util/t.ts', false, segment));

  // -- the printed block must not put a row under a sentence that is false of
  //    it. Every tier the census can produce needs somewhere to be printed. --
  t('every tier a row can carry has a printing tier that claims it',
    ['test', 'tooling', 'shipped'].every((x) => TIERS.some((r) => r.tier === x)),
    JSON.stringify(TIERS.map((r) => r.tier)));
  t('only the shipped tier carries the "cannot import repo tooling" claim',
    TIERS.filter((r) => r.why.join(' ').includes('cannot answer')).map((r) => r.tier).join()
      === 'shipped',
    JSON.stringify(TIERS.filter((r) => r.why.join(' ').includes('cannot answer')).map((r) => r.tier)));

  // -- the masker is load-bearing: prove it, rather than trusting it --------
  t('codeOnly blanks a comment but keeps the line count',
    codeOnly('// gone\nconst a = 1;\n').split('\n').length === 3
      && !codeOnly('// gone\nconst a = 1;\n').includes('gone'));

  const failed = cases.filter((c) => !c.ok);
  for (const c of failed) console.error(`  x ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
  if (failed.length) {
    console.error(`x check:parse-guard self-test: ${failed.length} of ${cases.length} case(s) failed.`);
    return 1;
  }
  console.log(
    `✓ check:parse-guard self-test: ${cases.length} cases pass (every spelling of all three parser entry `
      + `points is caught, their checked replacements are not, prose and payloads are not, only ts-parse.mjs `
      + `is exempt, and the out-of-tree census counts what this gate does not govern — TIERED by a read of `
      + `the owning package.json, so no row is printed under a reason that is false of it).`,
  );
  return 0;
}

if (isEntrypoint(import.meta.url)) {
  if (process.argv.includes('--self-test')) process.exit(selfTest());
  process.exit(main());
}
