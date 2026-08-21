#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * check-parse-guard -- every `scripts/**` TypeScript parse goes through ONE module.
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
 * ## What it deliberately does NOT cover, so the green line does not over-claim
 *
 * • **`ts.createProgram`** (`check-published-readme-exports.mjs`). A Program
 *   reports syntax through `getSyntacticDiagnostics()`, a different API with
 *   different failure modes; folding it in here would mean one helper making
 *   two promises. It has the same class of hole and is filed rather than
 *   silently swept in.
 * • **`ts.transpileModule`** (`check-where-matcher-conformance.mjs`). It
 *   reports nothing at all unless `reportDiagnostics: true` is passed -- same
 *   class, third API.
 * • **Outside `scripts/**`.** `packages/lint/src/*.ts`,
 *   `packages/cli/src/utils/detect-free-identifiers.ts`,
 *   `packages/spec/scripts/*.ts` and `packages/lint/scripts/*.mjs` parse too.
 *   They are not covered here for the reason `invoked-as.mjs` gives for its own
 *   `packages/cli` sibling: `scripts/` runs as plain `.mjs` against a possibly
 *   unbuilt tree, and making a published package depend on repo tooling to
 *   answer "did this parse?" trades this bug for a worse one.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isEntrypoint } from './invoked-as.mjs';
import { blank, scanSource } from './js-comment-mask.mjs';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const REPO_ROOT = resolve(HERE, '..');
const SCRIPTS = HERE;

/** The one module allowed to call `ts.createSourceFile`. */
const PARSER_HOME = join(SCRIPTS, 'ts-parse.mjs');

/** The canonical call, and the only accepted spelling. */
export const CANONICAL = 'parseSourceFile(fileName, text /*, scriptKind */)';

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
  const findings = [];
  const code = codeOnly(source);

  // Any `createSourceFile` -- `ts.createSourceFile(...)`, a destructured
  // `createSourceFile(...)`, or an aliased `tsc.createSourceFile(...)`. The
  // receiver is deliberately not part of the pattern: a gate that renamed its
  // typescript import would otherwise walk straight through.
  const re = /\bcreateSourceFile\b/g;
  let m;
  while ((m = re.exec(code))) {
    findings.push({
      rel,
      line: lineOf(source, m.index),
      what: 'ts.createSourceFile',
      why: 'a raw parse whose parseDiagnostics nobody reads',
    });
  }
  return findings;
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
    console.error(
      `\n    ts.createSourceFile NEVER THROWS. A syntax error, or the wrong`
        + `\n    ScriptKind, returns a recovered partial tree with the errors parked`
        + `\n    on parseDiagnostics — so a scan of that tree finds none of what it`
        + `\n    is looking for and scores the file CLEAN. The gate prints its green`
        + `\n    line over a file it could not read.`
        + `\n`
        + `\n    Route the parse through the one module that reads them:`
        + `\n`
        + `\n      import { parseSourceFile } from './ts-parse.mjs';   // '../ts-parse.mjs' from a subdir`
        + `\n      const sf = ${CANONICAL};`
        + `\n`
        + `\n    Omit scriptKind unless the source has no real file name: TypeScript`
        + `\n    infers it from the extension, and forcing one is its own blind spot`
        + `\n    (a gate here really was reading 32 of its 2504 files as wreckage).`
        + `\n`
        + `\n    scripts/ts-parse.mjs carries the rationale and the refusal fixture.`,
    );
    return 1;
  }
  console.log(
    `✓ check:parse-guard: ${scanned} scripts/ file(s) — every TypeScript parse goes through ts-parse.mjs.`,
  );
  return 0;
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
    `✓ check:parse-guard self-test: ${cases.length} cases pass (every spelling of the raw call is caught, `
      + `prose and payloads are not, and only ts-parse.mjs is exempt).`,
  );
  return 0;
}

if (isEntrypoint(import.meta.url)) {
  if (process.argv.includes('--self-test')) process.exit(selfTest());
  process.exit(main());
}
