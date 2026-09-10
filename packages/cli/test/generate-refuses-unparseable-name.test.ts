// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * PIN (#16541) — `os generate` must not EXIT 0 on a name whose emission does
 * not parse, and must write nothing when it refuses.
 *
 * ## Why a child process, and why this file exists next to the unit pin
 *
 * `generate-emission-parses.test.ts` measures the check: given a name, do the
 * bytes parse. It cannot measure the half this card is actually about — that
 * the COMMAND consults it, before the writes, on every branch. The reported
 * defect is an exit code (`os generate object foo.bar` -> exit 0 with two
 * broken files on disk), and `process.exitCode` set inside a vitest worker is
 * not an exit status: a CI script judges this command by `$?`. So the
 * assertions here are on a real child process and on stdout, for the same two
 * reasons `invocation-loudness.e2e.test.ts` documents at length — these
 * commands print through `utils/format.ts`, whose `printError` writes to
 * stdout. Spawned through `bin/run-dev.js` + tsx so the suite does not depend
 * on `packages/cli/dist` having been built.
 *
 * ## ⛔ Why this file is NOT named `.e2e`
 *
 * The two cuts in `vitest-tiers.ts` are orthogonal and deliberately disagree:
 * the BEHAVIOUR predicate puts this file in the `integration` project (it
 * spawns), while the NAME decides which RUN collects it — `*.e2e.test.ts` is
 * nightly, everything else is the queue's. The defect pinned here is a
 * command that reports success while writing broken files, so it is pinned in
 * the run that gates the merge queue rather than in the one that reports the
 * next morning. The tiers module names this exact combination as sanctioned
 * ("a file that spawns the CLI without the name is queue (name) AND
 * `integration` (behaviour)"), and ⛔ nothing is renamed to make the two cuts
 * agree.
 *
 * ## The control is load-bearing
 *
 * A refusal that fires on everything would satisfy every assertion about
 * `foo.bar` and would be a worse command than the broken one. `order_line`
 * runs the whole path — writes the scaffold, writes the barrel — and both of
 * its files are re-read and re-parsed here, so "still works" is a reading
 * rather than an exit code.
 *
 * ⚠️ The control was spelled `order-line` until #16726 put a charset gate in
 * front of this check, and kebab-case is outside the charset spec declares for
 * an object `name` — so that spelling now stops one layer earlier and would
 * have made this control measure the OTHER refusal. The two spellings derive
 * the same everything (`order_line.object.ts`, `orderLine`), so every
 * assertion below is the one #16541 wrote, byte for byte; only the authored
 * input moved to a name this command still accepts.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { childEnv } from './helpers/serve-process.js';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const CLI = resolve(HERE, '../bin/run-dev.js');
const TSX = resolve(HERE, '../../../node_modules/.bin/tsx');

/** oclif + tsx cold start, with every command module loaded; ~2-10 s when healthy. */
const RUN_TIMEOUT_MS = 240_000;

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

function runTsx(args: string[], cwd: string): Promise<Run> {
  return new Promise((resolvePromise) => {
    execFile(
      TSX,
      args,
      { cwd, maxBuffer: 8 * 1024 * 1024, env: childEnv({ NO_COLOR: '1' }) },
      (err, stdout, stderr) => {
        resolvePromise({
          // `err.code` is the real exit status; null/undefined means the child
          // was signalled — a different failure, never reported as 0.
          code: err
            ? typeof (err as { code?: unknown }).code === 'number'
              ? (err as unknown as { code: number }).code
              : 1
            : 0,
          stdout: String(stdout),
          stderr: String(stderr),
        });
      },
    );
  });
}

/** Syntactic diagnostics only — the instrument #15892 introduced, unchanged. */
function parseErrors(source: string): string[] {
  const fileName = 'probe.ts';
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const host: ts.CompilerHost = {
    getSourceFile: (requested) => (requested === fileName ? sourceFile : undefined),
    getDefaultLibFileName: () => 'lib.d.ts',
    writeFile: () => {},
    getCurrentDirectory: () => '/',
    getCanonicalFileName: (f) => f,
    useCaseSensitiveFileNames: () => true,
    getNewLine: () => '\n',
    fileExists: (f) => f === fileName,
    readFile: (f) => (f === fileName ? source : undefined),
  };
  const program = ts.createProgram([fileName], { noLib: true, noResolve: true, target: ts.ScriptTarget.Latest }, host);
  return program.getSyntacticDiagnostics(sourceFile).map((d) => ts.flattenDiagnosticMessageText(d.messageText, ' '));
}

let refusedDir: string;
let controlDir: string;
let dryRunDir: string;

let refused: Run;
let refusedAgain: Run;
let control: Run;
let dryRun: Run;

beforeAll(async () => {
  refusedDir = mkdtempSync(join(tmpdir(), 'os-g-refuse-'));
  controlDir = mkdtempSync(join(tmpdir(), 'os-g-control-'));
  dryRunDir = mkdtempSync(join(tmpdir(), 'os-g-dryrun-'));

  // Sequential on purpose: cold tsx starts, each loading every command module,
  // in a container several agents share.
  refused = await runTsx([CLI, 'generate', 'object', 'foo.bar'], refusedDir);
  // A second generator, to show the refusal is not one patched call site.
  refusedAgain = await runTsx([CLI, 'generate', 'flow', 'foo.bar'], refusedDir);
  dryRun = await runTsx([CLI, 'generate', 'object', 'foo.bar', '--dry-run'], dryRunDir);
  control = await runTsx([CLI, 'generate', 'object', 'order_line'], controlDir);
}, RUN_TIMEOUT_MS);

afterAll(() => {
  for (const dir of [refusedDir, controlDir, dryRunDir]) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('[#16541] `os generate object foo.bar` refuses instead of exiting 0', () => {
  it('exits non-zero — the reported defect was exit 0', () => {
    expect(refused.code).not.toBe(0);
    expect(refused.code).toBe(1);
  });

  it('says it is refusing, and says the emission does not parse', () => {
    expect(refused.stdout).toContain('Refusing to generate');
    expect(refused.stdout).toContain('does not parse');
  });

  it('names BOTH files the name would have corrupted', () => {
    expect(refused.stdout).toContain('foo.bar.object.ts');
    expect(refused.stdout).toContain('index.ts');
  });

  it('quotes the compiler`s own diagnostic rather than a restatement of it', () => {
    // The message TypeScript emits for a property access in a binding
    // position. Asserted because a hand-written "invalid name" line would pass
    // every other assertion in this block.
    expect(refused.stdout).toContain("',' expected.");
  });

  it('⛔ does not rewrite the name into a legal-looking identifier', () => {
    // The silent-sanitiser outcome this card exists to refuse: `fooBar` must
    // not appear anywhere in the output, and nothing may be reported created.
    expect(refused.stdout).not.toContain('fooBar');
    expect(refused.stdout).not.toContain('Created');
  });

  it('writes nothing — no scaffold, no barrel, no directory', () => {
    expect(existsSync(join(refusedDir, 'src', 'objects', 'foo.bar.object.ts'))).toBe(false);
    expect(existsSync(join(refusedDir, 'src', 'objects', 'index.ts'))).toBe(false);
    expect(existsSync(join(refusedDir, 'src'))).toBe(false);
  });
});

describe('[#16541] the refusal is one chokepoint, not one patched generator', () => {
  it('`os generate flow foo.bar` is refused the same way', () => {
    expect(refusedAgain.code).toBe(1);
    expect(refusedAgain.stdout).toContain('Refusing to generate');
    expect(existsSync(join(refusedDir, 'src', 'flows'))).toBe(false);
  });
});

describe('[#16541] `--dry-run` refuses too', () => {
  it('does not print un-parseable TypeScript under exit 0', () => {
    // A preview that renders the broken file and exits 0 is the same defect in
    // preview form — the author copies it, or a script trusts the status.
    expect(dryRun.code).toBe(1);
    expect(dryRun.stdout).toContain('Refusing to generate');
    expect(dryRun.stdout).not.toContain('const foo.bar');
  });
});

describe('[#16541] CONTROL — an ordinary name is untouched by this change', () => {
  it('still exits 0 and reports both writes', () => {
    expect(control.code).toBe(0);
    expect(control.stdout).toContain('Created src/objects/order_line.object.ts');
    expect(control.stdout).toContain('Created src/objects/index.ts');
  });

  it('writes a scaffold that parses, still binding `orderLine`', () => {
    const scaffold = readFileSync(join(controlDir, 'src', 'objects', 'order_line.object.ts'), 'utf8');
    expect(parseErrors(scaffold)).toEqual([]);
    expect(scaffold).toContain('const orderLine: Data.ServiceObject = {');
  });

  it('writes a barrel that parses, still re-exporting `orderLine`', () => {
    const barrel = readFileSync(join(controlDir, 'src', 'objects', 'index.ts'), 'utf8');
    expect(parseErrors(barrel)).toEqual([]);
    expect(barrel).toBe("export { default as orderLine } from './order_line.object';\n");
  });
});
