// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #18432 — `os build`'s package-docs step line was printed BEFORE the call it
 * announces, so a build that collected nothing read identically to one that
 * collected four documents.
 *
 *     if (!flags.json) printStep('Collecting package docs (ADR-0046)...');
 *     const docsResult = collectAndLintDocs(...)
 *
 * The sentence was unconditional and carried no count, so the reassurance it
 * offers — "the docs step ran, and it found your docs" — was true of every run
 * including the ones that found nothing at all. That is the reassurance half of
 * #18170: an exit-0 build with the usual progress line is the shape every
 * reader trusts. #18428 landed the audible half (an uncollected docs directory
 * now speaks); this is the other half.
 *
 * ## WHAT THESE PINS ASSERT — the PAIR, not the sentence
 *
 * A test that only checked "the step line is printed" passes on the defective
 * tree and pins nothing: the defective tree printed it unconditionally. So the
 * behaviour is pinned from both ends over fixtures that differ in exactly one
 * respect — whether `src/docs/` holds anything:
 *
 *   - absent `src/docs/`   -> `0 collected`
 *   - empty  `src/docs/`   -> `0 collected`
 *   - two docs            -> `2 collected`
 *
 * Only the count tells the three runs apart, and only a line printed AFTER the
 * collection can carry one — which is why this is the assertion that would have
 * caught the original defect rather than a restatement of it.
 *
 * ## The count is the ARTIFACT's docs, not a decoration
 *
 * `compile.ts` writes `finalBundle.docs = docsResult.docs` from the same value
 * it now prints, so each run's printed count is compared against the emitted
 * artifact. A number that drifted away from the set it describes would be a
 * second silent-reassurance defect wearing the fix's clothes; asserting only
 * the text could not see it.
 *
 * ## `--json` carries no step line, and that is pinned too
 *
 * The printed line lives behind `if (!flags.json)`. The template literal is new
 * and the `--json` face must stay one JSON document, so the machine face is
 * asserted to parse and to carry no step text at all.
 *
 * ALTITUDE: this spawns the CLI (`bin/run-dev.js` through tsx) rather than
 * calling a helper, because the defect is in the ORDER of two statements inside
 * the command body — there is no seam below the process that can observe it.
 * Same spawn shape and the same `childEnv()` as
 * `build-json-advisory-parity.e2e.test.ts`, so nothing here is a new pattern.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { childEnv } from './helpers/serve-process.js';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const CLI = resolve(HERE, '../bin/run-dev.js');
const TSX = resolve(HERE, '../../../node_modules/.bin/tsx');

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

function runCli(args: string[], cwd: string): Promise<Run> {
  return new Promise((resolvePromise) => {
    execFile(
      TSX,
      [CLI, ...args],
      { cwd, maxBuffer: 16 * 1024 * 1024, env: childEnv({ NO_COLOR: '1' }) },
      (err, stdout, stderr) => {
        resolvePromise({
          code: err ? (typeof (err as { code?: unknown }).code === 'number' ? (err as unknown as { code: number }).code : 1) : 0,
          stdout: String(stdout),
          stderr: String(stderr),
        });
      },
    );
  });
}

/** The step line, matched so the COUNT is captured and nothing else is assumed. */
const STEP_LINE = /Collecting package docs \(ADR-0046\)\.\.\.\s*(\d+) collected/;

/** The sentence with NO count — the pre-fix spelling, asserted absent. */
const COUNTLESS_STEP_LINE = /Collecting package docs \(ADR-0046\)\.\.\.\s*$/m;

/** What the step line reported on this run, or `null` when it was not printed. */
function printedCount(run: Run): number | null {
  const m = STEP_LINE.exec(run.stdout);
  return m ? Number(m[1]) : null;
}

/** How many docs the emitted artifact actually carries. */
function artifactDocCount(dir: string): number {
  const raw = readFileSync(join(dir, 'dist', 'objectstack.json'), 'utf8');
  const parsed = JSON.parse(raw) as { docs?: unknown };
  return Array.isArray(parsed.docs) ? parsed.docs.length : 0;
}

/**
 * A stack that builds cleanly. The namespace is a parameter because ADR-0046
 * lints doc names for the package's namespace prefix — a fixture whose docs did
 * not carry it would fail the build and every count below would be reading an
 * aborted run.
 */
const config = (ns: string) => `
export default {
  manifest: { id: 'com.example.${ns}', name: '${ns}', version: '1.0.0', type: 'app', namespace: '${ns}' },
  requires: [],
  objects: [
    {
      name: '${ns}_thing',
      label: 'Thing',
      sharingModel: 'private',
      fields: { title: { type: 'text', label: 'Title' } },
    },
  ],
};
`;

const doc = (title: string) => `---
title: ${title}
---

# ${title}

Body text.
`;

/** `absent` has no `src/docs/` at all; `empty` has the directory and no files. */
const dirs: Record<'absent' | 'empty' | 'two', string> = { absent: '', empty: '', two: '' };
let root = '';

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'os-docs-step-'));

  dirs.absent = join(root, 'absent');
  mkdirSync(join(dirs.absent, 'src'), { recursive: true });
  writeFileSync(join(dirs.absent, 'objectstack.config.ts'), config('dsabsent'));

  dirs.empty = join(root, 'empty');
  mkdirSync(join(dirs.empty, 'src', 'docs'), { recursive: true });
  writeFileSync(join(dirs.empty, 'objectstack.config.ts'), config('dsempty'));

  dirs.two = join(root, 'two');
  mkdirSync(join(dirs.two, 'src', 'docs'), { recursive: true });
  writeFileSync(join(dirs.two, 'objectstack.config.ts'), config('dstwo'));
  writeFileSync(join(dirs.two, 'src', 'docs', 'dstwo_intro.md'), doc('Intro'));
  writeFileSync(join(dirs.two, 'src', 'docs', 'dstwo_guide.md'), doc('Guide'));
});

afterAll(() => {
  if (root) rmSync(root, { recursive: true, force: true });
});

describe('[#18432] the package-docs step line reports what it collected', () => {
  it('ABSENT `src/docs/`: the step line reads `0 collected`, and the artifact carries no docs', async () => {
    const run = await runCli(['build'], dirs.absent);
    // Asserted first: a non-zero exit would make every claim below vacuous.
    expect(run.code, `stdout:\n${run.stdout}\nstderr:\n${run.stderr}`).toBe(0);

    expect(printedCount(run)).toBe(0);
    expect(artifactDocCount(dirs.absent)).toBe(0);

    // The pre-fix spelling — the sentence with nothing after the ellipsis — is
    // the shape this card exists to remove. Pinned as absent so a revert of the
    // ordering shows up here rather than in a customer's build log.
    expect(COUNTLESS_STEP_LINE.test(run.stdout)).toBe(false);
  });

  it('EMPTY `src/docs/`: also `0 collected` — a present-but-empty directory is not a collection', async () => {
    const run = await runCli(['build'], dirs.empty);
    expect(run.code, `stdout:\n${run.stdout}\nstderr:\n${run.stderr}`).toBe(0);

    expect(printedCount(run)).toBe(0);
    expect(artifactDocCount(dirs.empty)).toBe(0);
  });

  it('TWO docs: the step line reads `2 collected` — the other end of the pair', async () => {
    const run = await runCli(['build'], dirs.two);
    expect(run.code, `stdout:\n${run.stdout}\nstderr:\n${run.stderr}`).toBe(0);

    expect(printedCount(run)).toBe(2);
    // The printed number IS the set the artifact receives, not a tally kept
    // beside it.
    expect(artifactDocCount(dirs.two)).toBe(2);
  });

  it('the three runs are DISTINGUISHABLE — the defect was that they were not', async () => {
    // The whole card in one assertion. On the defective tree all three runs
    // printed the identical sentence; the only thing that separates them is the
    // count, and the count is only available after the collection has happened.
    const [absent, empty, two] = await Promise.all([
      runCli(['build'], dirs.absent),
      runCli(['build'], dirs.empty),
      runCli(['build'], dirs.two),
    ]);
    expect([printedCount(absent), printedCount(empty), printedCount(two)]).toEqual([0, 0, 2]);
  });

  it('`--json` prints no step line at all and stays one JSON document', async () => {
    const run = await runCli(['build', '--json'], dirs.two);
    expect(run.code, `stdout:\n${run.stdout}\nstderr:\n${run.stderr}`).toBe(0);
    expect(() => JSON.parse(run.stdout)).not.toThrow();
    expect(run.stdout).not.toMatch(/Collecting package docs/);
  });
});
