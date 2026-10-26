import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

/**
 * The pin on the coverage shard leg's reporter set (objectui#9177).
 *
 * ## What this guards, and why nothing else could
 *
 * `ci.yml`'s `test-coverage` job runs vitest as a sharded matrix and merges
 * every shard's blob report in the job below it, which is where the configured
 * coverage thresholds are enforced. A CLI `--reporter` **replaces** the
 * reporter set rather than adding to it, and vitest's resolution is:
 *
 *     if (!resolved.reporters.length) {
 *       resolved.reporters.push([isAgent ? "agent" : "default", {}]);
 *       if (process.env.GITHUB_ACTIONS === "true")
 *         resolved.reporters.push(["github-actions", {}]);
 *     }
 *
 * so `--reporter=blob` on its own displaced BOTH halves of that pair. A red
 * shard's log then ended at `blob report written to …` — no failing test name,
 * no assertion text, no timeout message — and the shard job's only annotation
 * was the generic `Process completed with exit code 1.` The failures survived
 * only inside the `coverage-blob-N` artifact, which is download-only.
 *
 * objectui#8545 measured what that costs: two episodes in which one test file
 * held `main`'s coverage gate unevaluated for **84** and **87** consecutive
 * pushes, both found the same way — a person reading a job log by hand, days
 * later.
 *
 * Nothing else in this repository reads what that step runs.
 * `ci-cd-pipeline-doc.test.ts` pins the pairing between `ci.yml` and the
 * pipeline page, but it compares COMMANDS, not flags — its extractor is
 *
 *     for (const m of text.matchAll(/\bpnpm\s+([\w:.-]+)/g)) {
 *       if (rootScripts.has(m[1])) found.add(`pnpm ${m[1]}`);
 *     }
 *
 * whose capture stops at the first space, so `pnpm test:coverage` is all it
 * ever sees. Every flag on that line could be deleted and that file stays
 * green.
 *
 * ## Both directions, because the failure has two shapes
 *
 * Dropping `--reporter=default` / `--reporter=github-actions` restores
 * objectui#9177. Dropping `--reporter=blob` to "simplify" the line is the same
 * defect wearing the other hat: the merge job loses the only input it has, so
 * a readable failure is bought with an unevaluated coverage floor
 * (objectui#5403). Neither is caught by CI going green, because the shard leg
 * passing is exactly the state in which nobody looks at its log.
 *
 * ⛔ If you are deleting this file, you are deleting the only mechanical guard
 * on that reporter set. The measurement behind it is in the ⚠️ comment above
 * the step in `ci.yml`; re-run it before you change the line.
 */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const workflowPath = path.join(repoRoot, '.github/workflows/ci.yml');
const workflowSource = fs.readFileSync(workflowPath, 'utf8');

/** The reporter the merge job needs, and the two that keep the log readable. */
const BLOB_REPORTER = '--reporter=blob';
const READABLE_REPORTERS = ['--reporter=default', '--reporter=github-actions'];

interface Step {
  name?: string;
  run?: unknown;
}

/**
 * Every `run:` body in the `test-coverage` job that invokes the coverage suite.
 *
 * Read through the YAML parser rather than off the raw text: the step is a
 * folded block scalar (`run: >-`), so the flags are spread over four source
 * lines and a regex over the file would have to re-implement the folding to see
 * the command the runner actually executes. Matching on `test:coverage` rather
 * than on the full string is what makes a rewrite FAIL here instead of
 * vanishing — a pin that searched for today's exact line would simply stop
 * finding anything and report a healthy green over a step that no longer
 * contains it.
 */
function coverageRunSteps(source: string): Array<{ step: string; run: string }> {
  const workflow = parseYaml(source) as {
    jobs?: Record<string, { steps?: Step[] }>;
  };
  const job = workflow.jobs?.['test-coverage'];
  expect(
    job,
    'ci.yml no longer defines a `test-coverage` job. If the coverage lane was restructured, this pin ' +
      'needs a new referent — do not delete it without giving the reporter set one.',
  ).toBeDefined();
  const found: Array<{ step: string; run: string }> = [];
  for (const step of job?.steps ?? []) {
    if (typeof step.run !== 'string') continue;
    if (!step.run.includes('test:coverage')) continue;
    found.push({ step: step.name ?? '(unnamed)', run: step.run });
  }
  return found;
}

describe("ci.yml's coverage shards keep a red run readable", () => {
  it('still runs the coverage suite at all — the pin is not vacuous', () => {
    // Without this, every assertion below passes over a job that stopped running
    // vitest, which is the one way a `toContain` pin lies.
    const steps = coverageRunSteps(workflowSource);
    expect(
      steps.map((s) => s.step),
      'no step in ci.yml\'s `test-coverage` job runs `pnpm test:coverage` any more. If that is ' +
        'deliberate, this pin is obsolete and should be deleted WITH the reasoning that made it ' +
        'obsolete written down. If it is not, the push lane just lost its coverage measurement.',
    ).not.toEqual([]);
  });

  it('is reading the shard leg, not some other coverage invocation', () => {
    // Names the population the two assertions below judge: the sharded legs.
    // `--merge-reports` in the job below is a different step in a different job
    // and is deliberately out of reach here.
    const sharded = coverageRunSteps(workflowSource).filter((s) => s.run.includes('--shard='));
    expect(
      sharded.map((s) => s.step),
      'the `test-coverage` job no longer passes `--shard=` to the coverage suite. The reporter ' +
        'rule below is about the SHARDED legs specifically — an unsharded lane has no blob to ' +
        'keep and a different set of reporters is right for it.',
    ).not.toEqual([]);
  });

  it('passes a reporter that prints failing test names alongside the blob', () => {
    const offenders = coverageRunSteps(workflowSource)
      .filter((s) => s.run.includes(BLOB_REPORTER))
      .flatMap((s) =>
        READABLE_REPORTERS.filter((r) => !s.run.includes(r)).map((r) => `${s.step}: missing ${r}`),
      );

    expect(
      offenders,
      'a coverage shard passes `--reporter=blob` without the reporters that keep its log readable.\n' +
        offenders.map((o) => `  - ${o}`).join('\n') +
        '\n\nA CLI `--reporter` REPLACES the default set rather than adding to it, so blob alone ends a ' +
        'failing shard at `blob report written to …` with no test name and no assertion text, and leaves ' +
        'the download-only artifact as the only copy of the failure. `--reporter=default` restores the ' +
        'job log; `--reporter=github-actions` restores the per-test `::error` annotation, which is the ' +
        'only form an API reader can get without downloading anything. objectui#9177; the cost is ' +
        'objectui#8545, where one test file held the coverage gate unevaluated for 84 and 87 pushes.',
    ).toEqual([]);
  });

  it('keeps the blob reporter the merge job depends on', () => {
    const offenders = coverageRunSteps(workflowSource)
      .filter((s) => s.run.includes('--shard='))
      .filter((s) => !s.run.includes(BLOB_REPORTER))
      .map((s) => s.step);

    expect(
      offenders,
      'a sharded coverage leg no longer writes a blob report:\n' +
        offenders.map((o) => `  - ${o}`).join('\n') +
        '\n\nThe `coverage-report` job merges every shard\'s blob and enforces the configured thresholds over ' +
        'the merged report — that is the whole reason the lane is sharded (objectui#5403). Restoring log ' +
        'readability by dropping the blob would trade an unreadable failure for an unevaluated coverage ' +
        'floor, which is the same defect wearing the other hat (objectui#9177).',
    ).toEqual([]);
  });
});
