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
 * The out-of-tree census: the same scanner, a different verdict.
 *
 * Deliberately the SAME `scanFile` the governed half runs. A second scanner for
 * the reported half would drift from the governed one in the direction that
 * makes the census read lower than the truth, which is the exact failure this
 * file is about.
 *
 * @param {(abs: string) => string} read  Injected so the self-test can drive
 *   this over fixtures rather than over whatever today's tree happens to hold.
 */
export function censusOutside(files, read, rootFor = (abs) => relative(REPO_ROOT, abs)) {
  const rows = [];
  for (const abs of files) {
    const rel = rootFor(abs);
    for (const f of scanFile(rel, read(abs))) {
      rows.push({ ...f, isTest: /\.(?:test|spec|pin\.test)\.[cm]?[jt]sx?$/.test(rel) });
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
export function reportOutside(rows) {
  const prod = rows.filter((r) => !r.isTest);
  const tests = rows.filter((r) => r.isTest);
  const files = new Set(rows.map((r) => r.rel));
  console.log(
    `   … and ${rows.length} parse(s) OUTSIDE scripts/ in ${files.size} file(s) that this gate does`
      + ` NOT govern — ${prod.length} in shipped/gate code, ${tests.length} in tests:`,
  );
  for (const r of [...prod, ...tests]) {
    console.log(`     ${r.rel}:${r.line}  ${r.what}${r.isTest ? '  [test]' : ''}`);
  }
  console.log(
    `   They cannot import scripts/ts-parse.mjs — a published package answering`
      + `\n   "did this parse?" through repo tooling trades this bug for a worse one.`
      + `\n   Counted and named so the line above is read as what it is: a statement`
      + `\n   about scripts/, not about the repository. Shape decision: see the header.`,
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
  const census = censusOutside([...OUTSIDE.keys()], (k) => OUTSIDE.get(k), (k) => k);
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
      + `is exempt, and the out-of-tree census counts what this gate does not govern).`,
  );
  return 0;
}

if (isEntrypoint(import.meta.url)) {
  if (process.argv.includes('--self-test')) process.exit(selfTest());
  process.exit(main());
}
