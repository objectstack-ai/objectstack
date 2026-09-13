// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * PIN (#17410) — `os generate` must not EXIT 0 on a name whose barrel alias no
 * consumer can import by name, and must write nothing when it refuses.
 *
 * ## Why a child process, and why this file exists next to the unit pin
 *
 * `importable-binding.test.ts` measures the check: given an alias, is it
 * importable. It cannot measure the half this card is actually about — that the
 * COMMAND consults it, before the writes, on every branch. The reported defect
 * is an exit code (`os generate view class` -> exit 0 with a barrel entry
 * nothing can name), and `process.exitCode` set inside a vitest worker is not
 * an exit status: a CI script judges this command by `$?`. So the assertions
 * here are on a real child process and on stdout, for the same two reasons
 * `invocation-loudness.e2e.test.ts` documents at length — these commands print
 * through `utils/format.ts`, whose `printError` writes to stdout. Spawned
 * through `bin/run-dev.js` + tsx so the suite does not depend on
 * `packages/cli/dist` having been built.
 *
 * ## ⛔ Why this file is NOT named `.e2e`
 *
 * Identical to its sibling `generate-refuses-unparseable-name.test.ts`: the
 * BEHAVIOUR predicate in `vitest-tiers.ts` puts a spawning file in the
 * `integration` project, while the NAME decides which RUN collects it —
 * `*.e2e.test.ts` is nightly, everything else is the queue's. The defect
 * pinned here is a command that reports success while writing an unusable
 * barrel, so it is pinned in the run that gates the merge queue rather than in
 * the one that reports the next morning.
 *
 * ## The three layers, and why this one had to be third
 *
 * `class` passes the #16726 charset gate (every character is a lowercase
 * letter) and passes the #16541 parse check for every generator but `object`
 * (`const classViews:` parses, and `export { default as class } from …` parses
 * — an export clause admits a reserved word as a `ModuleExportName`). Both
 * landed layers are therefore satisfied, correctly, by a name whose emitted
 * binding is unusable: `import { class } from './views'` is a syntax error.
 *
 * So the assertions below are written to hold each layer to its OWN verdict.
 * `os g object class` must still meet the parse check's wording, `order-line`
 * must still meet the charset gate's, and only a name all three would
 * otherwise have admitted may meet this one. ⛔ A future edit that lets this
 * layer answer first reddens here, and it would be a regression: it would take
 * the compiler's specific reason away from the author of `os g object class`.
 *
 * ## The controls are load-bearing
 *
 * A refusal that fired on everything would satisfy every refusal assertion in
 * this file and would be a worse command than the broken one. Two controls run
 * the whole path: `order_line` (an ordinary name) and `type` (⭐ contextual
 * only — keyword-shaped and a perfectly legal import binding, so refusing it
 * would break a name that works today). Both write their scaffold and their
 * barrel, and both files are re-read from disk here, so "still works" is a
 * reading rather than an exit code.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
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

let reservedDir: string;
let strictDir: string;
let dryRunDir: string;
let parseLayerDir: string;
let charsetLayerDir: string;
let controlDir: string;
let contextualDir: string;

let reserved: Run;
let strictReserved: Run;
let dryRun: Run;
let parseLayer: Run;
let charsetLayer: Run;
let control: Run;
let contextual: Run;

beforeAll(async () => {
  reservedDir = mkdtempSync(join(tmpdir(), 'os-g-reserved-'));
  strictDir = mkdtempSync(join(tmpdir(), 'os-g-strict-'));
  dryRunDir = mkdtempSync(join(tmpdir(), 'os-g-alias-dryrun-'));
  parseLayerDir = mkdtempSync(join(tmpdir(), 'os-g-parselayer-'));
  charsetLayerDir = mkdtempSync(join(tmpdir(), 'os-g-charsetlayer-'));
  controlDir = mkdtempSync(join(tmpdir(), 'os-g-alias-control-'));
  contextualDir = mkdtempSync(join(tmpdir(), 'os-g-contextual-'));

  // Sequential on purpose: cold tsx starts, each loading every command module,
  // in a container several agents share.
  //
  // The card's measured row. `view` because that generator suffixes its `const`
  // binding (`classViews`), so the scaffold parses and the barrel alias is the
  // only thing left that cannot be named.
  reserved = await runTsx([CLI, 'generate', 'view', 'class'], reservedDir);
  // A second generator, to show the refusal is not one patched call site —
  // and `let`, which is reserved only because a module is in strict mode.
  strictReserved = await runTsx([CLI, 'generate', 'flow', 'let'], strictDir);
  dryRun = await runTsx([CLI, 'generate', 'view', 'class', '--dry-run'], dryRunDir);
  // The layer in front, on the name it owns.
  parseLayer = await runTsx([CLI, 'generate', 'object', 'class'], parseLayerDir);
  charsetLayer = await runTsx([CLI, 'generate', 'object', 'order-line'], charsetLayerDir);
  control = await runTsx([CLI, 'generate', 'view', 'order_line'], controlDir);
  contextual = await runTsx([CLI, 'generate', 'view', 'type'], contextualDir);
}, RUN_TIMEOUT_MS);

afterAll(() => {
  for (const dir of [
    reservedDir, strictDir, dryRunDir, parseLayerDir, charsetLayerDir,
    controlDir, contextualDir,
  ]) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe('[#17410] `os generate view class` refuses instead of exiting 0', () => {
  it('exits non-zero — the reported defect was exit 0', () => {
    expect(reserved.code).not.toBe(0);
    expect(reserved.code).toBe(1);
  });

  it('says it is refusing, and names the value it refused', () => {
    expect(reserved.stdout).toContain('Refusing to generate');
    expect(reserved.stdout).toContain('class');
  });

  it('names the CONSTRAINT — that the barrel line could not be imported', () => {
    // Triage's ask: refuse "loudly, naming the constraint". A bare "invalid
    // name" would satisfy the two assertions above.
    expect(reserved.stdout).toContain('could not be imported');
    expect(reserved.stdout).toContain('reserved word in this position');
  });

  it('shows the author the exact barrel line that would have been written', () => {
    // The defect is invisible without it: the line parses, so the author has
    // no reason to suspect it. Printing it is what connects the refusal to the
    // thing they typed.
    expect(reserved.stdout).toContain("export { default as class } from './class.view';");
  });

  it('⛔ does not rewrite the name into an importable one', () => {
    // The sanitiser outcome the #16726 ruling refused, and this layer declines
    // to be. No repaired alias may appear, and nothing may be reported created.
    expect(reserved.stdout).not.toContain('Created');
    expect(reserved.stdout).not.toContain('classView ');
    expect(reserved.stdout).not.toContain('klass');
    expect(reserved.stdout).not.toContain('class_');
  });

  it('writes nothing — no scaffold, no barrel, no directory', () => {
    expect(existsSync(join(reservedDir, 'src', 'views', 'class.view.ts'))).toBe(false);
    expect(existsSync(join(reservedDir, 'src', 'views', 'index.ts'))).toBe(false);
    expect(existsSync(join(reservedDir, 'src'))).toBe(false);
  });

  it('is ONE chokepoint, not one patched generator', () => {
    // `flow` + `let`: a different generator and a word reserved for a
    // different reason (a module is automatically in strict mode).
    expect(strictReserved.code).toBe(1);
    expect(strictReserved.stdout).toContain('could not be imported');
    expect(strictReserved.stdout).toContain('strict mode');
    expect(existsSync(join(strictDir, 'src'))).toBe(false);
  });

  it('fires BEFORE the preview, not only before the write', () => {
    // A `--dry-run` that prints an unusable barrel and exits 0 is the same
    // defect in preview form.
    expect(dryRun.code).toBe(1);
    expect(dryRun.stdout).toContain('could not be imported');
    expect(dryRun.stdout).not.toContain('Dry run');
    expect(existsSync(join(dryRunDir, 'src'))).toBe(false);
  });
});

describe('[#17410] the three layers stay DISTINCT — each keeps its own verdict', () => {
  it('the parse check still answers for `os g object class`, in the compiler`s words', () => {
    // ⛔ This layer must NOT have shadowed #16541's. `object` binds the bare
    // identifier in a `const` position, so the compiler has a reason specific
    // to that — and taking it away would be a regression even though the exit
    // code is identical.
    expect(parseLayer.code).toBe(1);
    expect(parseLayer.stdout).toContain('does not parse');
    expect(parseLayer.stdout).toContain("'class' is not allowed as a variable declaration name.");
    expect(parseLayer.stdout).not.toContain('could not be imported');
  });

  it('the charset gate still answers for a name outside the charset', () => {
    // ⛔ And #16726's is untouched: `order-line` never reaches either check
    // behind it, so the author still gets the schema's own pattern.
    expect(charsetLayer.code).toBe(1);
    expect(charsetLayer.stdout).toContain('not a name this command accepts');
    expect(charsetLayer.stdout).not.toContain('could not be imported');
    expect(charsetLayer.stdout).not.toContain('does not parse');
  });

  it('⛔ no third charset — the refusal asserts no character rule', () => {
    // The #16726 ruling's other half, asserted on the output rather than
    // trusted. Spelled as "does not print the charset gate's own lines"
    // rather than "does not contain the word charset": this refusal SAYS it is
    // not a charset, in prose, so the bare word is present on purpose and
    // matching it would pin the disclaimer instead of the rule.
    expect(reserved.stdout).not.toContain('must match pattern');
    expect(reserved.stdout).not.toContain('not a name this command accepts');
    // And it does say so, which is the half worth pinning.
    expect(reserved.stdout).toContain('it is not a charset');
  });
});

describe('[#17410] ⭐ CONTROL — names that work today still generate', () => {
  it('an ordinary name still exits 0 and writes both files', () => {
    // A refusal that fired on everything would satisfy every assertion above.
    expect(control.code).toBe(0);
    expect(control.stdout).toContain('Created src/views/order_line.view.ts');
    expect(control.stdout).toContain('Created src/views/index.ts');
    const barrel = readFileSync(join(controlDir, 'src', 'views', 'index.ts'), 'utf8');
    expect(barrel).toContain("export { default as orderLine } from './order_line.view';");
  });

  it('⭐ a CONTEXTUAL reserved word still generates — the expensive direction', () => {
    // `type` is keyword-shaped and a perfectly legal import binding. Refusing
    // it would break a name that works today, which is the failure direction
    // that costs an author a working command — and the direction a hand-picked
    // keyword list gets wrong. Read from disk, not from the exit code.
    expect(contextual.code).toBe(0);
    const barrel = readFileSync(join(contextualDir, 'src', 'views', 'index.ts'), 'utf8');
    expect(barrel).toContain("export { default as type } from './type.view';");
    expect(existsSync(join(contextualDir, 'src', 'views', 'type.view.ts'))).toBe(true);
  });
});
