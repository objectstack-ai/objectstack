#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ts-parse -- the ONE answer to "did this source actually parse?"
 *
 *   node scripts/ts-parse.mjs --self-test
 *
 * ## The defect this closes
 *
 * **`ts.createSourceFile` never throws.** Hand it merge-conflict markers, a
 * truncated body, or a source read under the wrong `ScriptKind` and it returns
 * a `SourceFile` that looks like any other: the errors are parked on
 * `parseDiagnostics`, a property NOTHING in `scripts/` read. A gate then walks
 * that wreckage, finds none of the shapes it is looking for, and scores the
 * file CLEAN -- **a file the gate could not read is reported as a file with
 * nothing to report.** The gate prints its green line, its count is lower than
 * it should be, and nothing anywhere says which file went unread.
 *
 * Measured here on 2026-08-21 against TypeScript 6.0.3 -- every one of these
 * returns a tree and exits normally:
 *
 *   source                              ScriptKind.TS    ScriptKind.TSX
 *   -------------------------------     --------------   --------------
 *   merge-conflict markers               3 diagnostics    3 diagnostics
 *   truncated function body              1 diagnostic     1 diagnostic
 *   a JSX element                        4 diagnostics    0
 *   `const id = <T>(x: T): T => x;`      0                3 diagnostics
 *
 * ## This is not hypothetical here -- it was LIVE on `main` when this landed
 *
 * The last two rows are the same defect wearing the `ScriptKind` hat, and one
 * gate in this tree was standing on them. `check-engine-double-contract.mjs`
 * walked 2504 `*.{test,spec}.{ts,tsx,mts}` files under `packages/` and
 * `examples/` while forcing `ts.ScriptKind.TSX` on every one of them. In TSX a
 * `<` opens a JSX element, so an ordinary `new Map<string, X>()` or a generic
 * arrow made the rest of the file wreckage. **32 of its 2504 files parsed with
 * parse errors** (up to 633 diagnostics in one file), and the gate reported:
 *
 *   check-engine-double-contract: OK -- 342 pinned, 133 in the DEBT ledger, 2 exempt.
 *
 * Reading the same 2504 files under the ScriptKind their own file names imply
 * turns that line into `6 problem(s)`: three test files were pinning six engine
 * doubles that the ledger had never recorded, because the scan had never been
 * able to see them. The census moved 236 -> 239 delete doubles and 272 -> 275
 * update doubles at the same time. Nothing about the tree changed; only whether
 * the gate could read it. That is the whole failure mode in one measurement,
 * and it is why the refusal below is not a defensive nicety.
 *
 * ## Why ONE module rather than 15 copies of a three-line check
 *
 * A shared helper is a second source of truth WHILE THE FIRST ONE IS STILL
 * REACHABLE. That is the real objection to a helper, and it is answered by
 * removing the first source rather than by arguing: `check-parse-guard.mjs`
 * next door fails on a raw `ts.createSourceFile` anywhere in `scripts/**`
 * outside this file, so there is no second spelling left to drift from.
 *
 * The tree has already run this experiment twice, and both results are in
 * `scripts/`:
 *
 *   • `invoked-as.mjs` -- "was I run, or imported?" -- replaced ELEVEN
 *     hand-typed spellings across 33 files, NINE of them wrong, and
 *     `check-entry-guard.mjs` is the half that stops a twelfth being typed.
 *   • `js-comment-mask.mjs` -- "is this span code, or prose?" -- replaced two
 *     families of private `stripComments`, each silently wrong in a different
 *     direction.
 *
 * A per-gate copy of "and check the diagnostics" would drift the same way: one
 * reads `.length` on a field it forgot can be undefined, one warns instead of
 * failing, one is simply never typed into the sixteenth gate -- and a missing
 * copy is invisible, because its symptom is a green line.
 *
 * ## Why it EXITS rather than throws
 *
 * A throw is swallowable, and the swallow is already written down in this repo:
 * `packages/lint/src/validate-react-page-props.ts` and
 * `lint-startup-registry-verdict.ts` both wrap `createSourceFile` in
 * `try { ... } catch { continue / return [] }` -- dead code today, guarding
 * against a throw that cannot happen, and a SILENT SKIP the moment a parse
 * started throwing. Exiting cannot be caught, so a refusal cannot be downgraded
 * into a quieter answer by a caller that meant well.
 *
 * Exit code 3, deliberately not 1: "this gate found violations" and "this gate
 * could not read the tree" are different verdicts and a reader should not have
 * to guess which one they got. Both are non-zero, so CI fails either way.
 *
 * ## The knobs that are NOT knobs
 *
 * `ScriptTarget.Latest` and `setParentNodes: true` are fixed here because all
 * 34 `createSourceFile` lines in `scripts/` passed exactly those -- measured,
 * not assumed -- and a call site that needs a different pair should say so once,
 * here, rather than re-open a five-argument call for everyone.
 *
 * `scriptKind` stays a parameter because it is genuinely per-call-site, and
 * **omitting it is the safe default**: TypeScript then infers it from the file
 * name's extension, which is what a scan over a real tree wants and is exactly
 * what the engine-double-contract measurement above is about. Pass it only for
 * a source that has no real file name -- a fixture string in a self-test.
 *
 * ## Counting, for a census that has a numerator
 *
 * With `OS_TOOLING_PARSE_CENSUS` set, this module prints how many parses ran,
 * over how many distinct file names, and how many refused, when the process
 * exits. It only ADDS observation. There is deliberately no env var that turns
 * the refusal off: a guard with a documented bypass is a guard that will be
 * bypassed.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import ts from 'typescript';

import { isEntrypoint } from './invoked-as.mjs';

/**
 * The exit status of a refusal. Distinct from 1 ("this gate found violations")
 * so a reader can tell "there is nothing to report" from "I could not read it".
 */
export const EXIT_UNPARSEABLE = 3;

/** Parses attempted, the distinct file names, and the refusals. */
const census = { parses: 0, files: new Set(), refusals: 0 };

/** A snapshot of what this module has been asked to parse in this process. */
export function parseCensus() {
  return { parses: census.parses, files: census.files.size, refusals: census.refusals };
}

/**
 * The parse errors TypeScript recorded for `sourceFile`, as plain rows.
 *
 * `parseDiagnostics` is not on the public `SourceFile` type -- it lives on the
 * internal shape -- which is most of why it goes unread. It has been populated
 * by the parser since the compiler had one, and reading it is the only way to
 * learn that a tree is wreckage. The cast is contained HERE, in one function,
 * rather than repeated at every call site: that containment is a second reason
 * this module exists.
 *
 * Answers `[]` for anything that is not a source file rather than throwing, so
 * a caller cannot turn a bad argument into a crash it then catches.
 *
 * @param {ts.SourceFile} sourceFile
 * @returns {{ line: number, column: number, message: string }[]}
 */
export function describeDiagnostics(sourceFile) {
  const raw = /** @type {any} */ (sourceFile)?.parseDiagnostics;
  if (!Array.isArray(raw)) return [];
  return raw.map((d) => {
    const at = typeof d.start === 'number'
      ? ts.getLineAndCharacterOfPosition(sourceFile, d.start)
      : { line: 0, character: 0 };
    return {
      line: at.line + 1,
      column: at.character + 1,
      message: ts.flattenDiagnosticMessageText(d.messageText, ' '),
    };
  });
}

/** `ScriptKind.TSX` -> `'TSX'`, and a phrase for the inferred case. */
function describeScriptKind(scriptKind) {
  if (scriptKind === undefined) return 'inferred from the file name';
  for (const [name, value] of Object.entries(ts.ScriptKind)) {
    if (value === scriptKind && Number.isNaN(Number(name))) return name;
  }
  return String(scriptKind);
}

/**
 * The refusal text. Separate from the exit so the self-test can read it, and so
 * the wording is pinned by a case rather than by whoever reads it next.
 */
export function refusalReport(fileName, scriptKind, diagnostics) {
  const shown = diagnostics.slice(0, 5);
  const rest = diagnostics.length - shown.length;
  return [
    `x  ts-parse — REFUSING to scan a source that does not parse.`,
    ``,
    `    file       ${fileName}`,
    `    parsed as  ${describeScriptKind(scriptKind)}`,
    `    errors     ${diagnostics.length} parse diagnostic(s) from TypeScript ${ts.version}`,
    ``,
    ...shown.map((d) => `      ${fileName}:${d.line}:${d.column}  ${d.message}`),
    ...(rest > 0 ? [`      … and ${rest} more`] : []),
    ``,
    `    ts.createSourceFile never throws: it returns a tree with the errors`,
    `    parked on parseDiagnostics. A scan of that tree finds none of what it`,
    `    is looking for and would score this file CLEAN — a file the gate could`,
    `    not read, reported as a file with nothing to report. The run is aborted`,
    `    instead: a number nobody measured is worse than no number.`,
    ``,
    `    If this file compiles for tsc, suspect the ScriptKind this call site`,
    `    passes. <T>(x) => x is a generic arrow in TS and an unterminated JSX`,
    `    tag in TSX; a JSX element is the reverse. Omitting scriptKind lets the`,
    `    file name decide, which is what a scan over a real tree wants.`,
    ``,
  ].join('\n');
}

/**
 * Parse `text` as TypeScript, or refuse.
 *
 * The ONLY sanctioned way to build a `ts.SourceFile` under `scripts/**` -- see
 * `check-parse-guard.mjs`, which fails on a raw `ts.createSourceFile` anywhere
 * else in that tree.
 *
 * @param {string} fileName  What the tree is called. Its extension picks the
 *   ScriptKind when `scriptKind` is omitted, so pass the real path when you
 *   have one.
 * @param {string} text  The source.
 * @param {ts.ScriptKind} [scriptKind]  Omit to let the file name decide.
 * @returns {ts.SourceFile} A tree with NO parse errors. There is no other
 *   return: an unparseable source ends the process with {@link EXIT_UNPARSEABLE}.
 */
export function parseSourceFile(fileName, text, scriptKind) {
  census.parses += 1;
  census.files.add(fileName);

  const sourceFile = ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    scriptKind,
  );

  const diagnostics = describeDiagnostics(sourceFile);
  if (diagnostics.length > 0) {
    census.refusals += 1;
    process.stderr.write(refusalReport(fileName, scriptKind, diagnostics));
    process.exit(EXIT_UNPARSEABLE);
  }
  return sourceFile;
}

if (process.env.OS_TOOLING_PARSE_CENSUS) {
  process.on('exit', () => {
    const c = parseCensus();
    process.stderr.write(
      `[ts-parse census] ${c.parses} parse(s) over ${c.files} distinct file name(s); ${c.refusals} refusal(s)\n`,
    );
  });
}

// ---------------------------------------------------------------------------
// Self-test -- real child processes, because the refusal IS a process exit
// ---------------------------------------------------------------------------

/**
 * The refusal cannot be observed in-process: it exits. So the cases that matter
 * spawn a real child and read what it printed and what status it left, exactly
 * as `invoked-as.mjs` drives a real symlink rather than a model of one.
 */
export function selfTest() {
  const cases = [];
  const t = (name, ok, detail) => cases.push({ name, ok: Boolean(ok), detail });

  const SELF = fileURLToPath(import.meta.url);
  // The conflict markers are BUILT rather than typed: a literal one in this
  // file would be a merge-conflict marker in this file.
  const MARKER = '<'.repeat(7);
  const MIDDLE = '='.repeat(7);
  const CLOSER = '>'.repeat(7);

  const CONFLICTED = `const a = 1;\n${MARKER} HEAD\nconst b = 2;\n${MIDDLE}\nconst b = 3;\n${CLOSER} other\n`;
  const TRUNCATED = 'export function f() {\n  const x = {\n';
  const JSX = 'const el = <div className="x">hi</div>;\n';
  const GENERIC_ARROW = 'const id = <T>(x: T): T => x;\n';
  const CLEAN = 'export const a: number = 1;\n';

  const dir = mkdtempSync(join(tmpdir(), 'ts-parse-'));
  try {
    // The probe lives in a temp dir, where a bare `typescript` specifier does
    // not resolve -- so the URL is resolved HERE, from this module, and pasted
    // in. `body` is spliced into a module that imports THIS one, so the child
    // exercises the real export through the real module graph rather than a
    // re-implementation of it.
    const TS_URL = import.meta.resolve('typescript');
    const run = (body) => {
      const probe = join(dir, `probe-${cases.length}-${Math.random().toString(36).slice(2)}.mjs`);
      writeFileSync(
        probe,
        `import ts from ${JSON.stringify(TS_URL)};\n`
          + `import { parseSourceFile, parseCensus } from ${JSON.stringify(pathToFileURL(SELF).href)};\n`
          + `void ts;\n${body}\n`,
      );
      const r = spawnSync(process.execPath, [probe], { encoding: 'utf8' });
      rmSync(probe, { force: true });
      return { status: r.status, out: (r.stdout || '').trim(), err: r.stderr || '' };
    };

    const parse = (text, fileName = 't.ts', kindExpr = 'undefined') =>
      run(
        `const sf = parseSourceFile(${JSON.stringify(fileName)}, ${JSON.stringify(text)}, ${kindExpr});\n`
          + `console.log('PARSED ' + sf.statements.length);\n`,
      );

    // -- a clean source still parses, and the tree is usable ------------------
    const clean = parse(CLEAN);
    t('a clean source parses and returns a usable tree',
      clean.status === 0 && clean.out === 'PARSED 1', JSON.stringify(clean));

    // -- THE case: each measured wreck refuses instead of scoring clean -------
    for (const [name, text] of [
      ['merge-conflict markers', CONFLICTED],
      ['a truncated body', TRUNCATED],
      ['JSX under the TS ScriptKind', JSX],
    ]) {
      const r = parse(text, 'packages/foo/src/bar.ts');
      t(`${name} REFUSES rather than returning a tree`,
        r.status === EXIT_UNPARSEABLE && r.out === '',
        JSON.stringify({ status: r.status, out: r.out }));
      t(`…and the refusal for ${name} NAMES THE FILE`,
        r.err.includes('packages/foo/src/bar.ts'), r.err.slice(0, 200));
    }

    // -- the refusal carries a location a reader can open --------------------
    const located = parse(CONFLICTED, 'packages/foo/src/bar.ts');
    t('the refusal reports line:column and TypeScript’s own message',
      /packages\/foo\/src\/bar\.ts:2:1\s+Merge conflict marker encountered\./.test(located.err),
      located.err.slice(0, 400));

    // -- ScriptKind, both directions. This is the shape that hides in a green
    //    gate rather than in a broken file, and it was LIVE on main. ----------
    t('JSX in a .tsx file parses when the extension decides',
      parse(JSX, 'page.tsx').status === 0);
    t('…and the SAME source refuses when the call site forces ScriptKind.TS',
      parse(JSX, 'page.tsx', 'ts.ScriptKind.TS').status === EXIT_UNPARSEABLE);
    t('a generic arrow parses in a .ts file',
      parse(GENERIC_ARROW, 'util.ts').status === 0);
    t('…and refuses when the call site forces ScriptKind.TSX (the shape a TSX-everything gate went blind on)',
      parse(GENERIC_ARROW, 'util.ts', 'ts.ScriptKind.TSX').status === EXIT_UNPARSEABLE);

    // -- the refusal is NOT swallowable, which is why it exits rather than
    //    throws: `try { parse } catch { continue }` is written in this repo
    //    today, against a throw that never comes ----------------------------
    const swallowed = run(
      `let caught = false;\n`
        + `try { parseSourceFile('t.ts', ${JSON.stringify(TRUNCATED)}); } catch { caught = true; }\n`
        + `console.log(caught ? 'SWALLOWED' : 'NOT REACHED');\n`,
    );
    t('a caller’s try/catch cannot downgrade the refusal into a skip',
      swallowed.status === EXIT_UNPARSEABLE && !swallowed.out.includes('SWALLOWED'),
      JSON.stringify(swallowed));

    // -- the census has a numerator ------------------------------------------
    const counted = run(
      `parseSourceFile('a.ts', 'const a = 1;');\n`
        + `parseSourceFile('a.ts', 'const b = 2;');\n`
        + `parseSourceFile('b.ts', 'const c = 3;');\n`
        + `console.log(JSON.stringify(parseCensus()));\n`,
    );
    t('the census counts parses and distinct file names',
      counted.status === 0 && counted.out === '{"parses":3,"files":2,"refusals":0}',
      JSON.stringify(counted));

    // -- the diagnostics reader itself, in-process ---------------------------
    t('describeDiagnostics answers [] for a tree that parsed',
      describeDiagnostics(parseSourceFile('ok.ts', CLEAN)).length === 0);
    t('describeDiagnostics answers [] for a non-SourceFile rather than throwing',
      describeDiagnostics(/** @type {any} */ ({})).length === 0);
    t('describeDiagnostics answers [] for undefined rather than throwing',
      describeDiagnostics(/** @type {any} */ (undefined)).length === 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  const failed = cases.filter((c) => !c.ok);
  for (const c of failed) console.error(`  x ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
  if (failed.length) {
    console.error(`x ts-parse self-test: ${failed.length} of ${cases.length} case(s) failed.`);
    return 1;
  }
  console.log(
    `✓ ts-parse self-test: ${cases.length} cases pass (every measured wreck refuses and names its file, `
      + `both ScriptKind directions, and a caller’s try/catch cannot swallow it).`,
  );
  return 0;
}

if (isEntrypoint(import.meta.url)) {
  if (process.argv.includes('--self-test')) process.exit(selfTest());
  console.log('usage: node scripts/ts-parse.mjs --self-test');
}
