import { describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';

import { UI_COVERAGE, rootWorkflow } from './helpers/root-ci';

/**
 * The coverage lane's width, held to ONE number (objectui#12256, folded into
 * objectui#12208).
 *
 * The lane runs in the root `.github/workflows/ui-coverage-nightly.yml`
 * (objectstack#25924), where objectui's `ci.yml` jobs `test-coverage` and
 * `coverage-report` became `ui-coverage` and `ui-coverage-report`.
 *
 * The lane spells its shard count in two jobs. `ui-coverage`
 * declares the matrix and repeats the count in its job name, its step name and
 * its `--shard=N/M` flag; `ui-coverage-report` counts the blob reports the shards
 * wrote and refuses to merge a partial set. The blob's FILE NAME carries the
 * count too (`blob-N-M.json`, written by vitest from the `--shard` flag), so a
 * width moved in the matrix alone leaves the merge looking for blobs that no
 * shard writes: the count step answers zero, the merge never runs, and the
 * coverage gate is unevaluated on every night -- the lane's own worst failure,
 * one edit away. Nothing about that is visible on a pull request, because the
 * lane runs on `schedule` and `workflow_dispatch` only.
 *
 * So every spelling is read here and held to the matrix:
 *
 *   - the matrix is the contiguous run 1..M;
 *   - the job name, the step name and `--shard=` all say M;
 *   - `ui-coverage-report` declares `COVERAGE_SHARDS: 'M'`, and its count step
 *     reads THAT variable for both the blob glob and the expected count, with
 *     no literal width left in the step;
 *   - the merge step is a `--merge-reports` that overrides no threshold, so
 *     the configured `coverage.thresholds` are what is enforced over the merge
 *     of all M blobs -- the one place the gate runs, since the shard legs
 *     zero the thresholds.
 */
const workflowSource = rootWorkflow(UI_COVERAGE.file);

interface Step {
  name?: string;
  run?: unknown;
  id?: string;
}
interface Job {
  name?: string;
  env?: Record<string, unknown>;
  strategy?: { matrix?: { shard?: unknown } };
  steps?: Step[];
}

const workflow = parseYaml(workflowSource) as { jobs?: Record<string, Job> };

function job(key: string): Job {
  const found = workflow.jobs?.[key];
  expect(found, `${UI_COVERAGE.file} no longer defines a \`${key}\` job; this pin needs a new referent, not deletion`).toBeDefined();
  return found as Job;
}

/** The matrix width, after checking the matrix is the contiguous run 1..M. */
function matrixWidth(): number {
  const shards = job(UI_COVERAGE.shards).strategy?.matrix?.shard;
  expect(Array.isArray(shards), `\`${UI_COVERAGE.shards}\` must declare a \`shard:\` matrix list`).toBe(true);
  const list = shards as unknown[];
  expect(list.length, 'a zero-wide matrix is a broken reader, not a lane').toBeGreaterThan(0);
  expect(list, 'the coverage matrix must be the contiguous run 1..M').toEqual(list.map((_, i) => i + 1));
  return list.length;
}

function runOf(step: Step | undefined): string {
  return typeof step?.run === 'string' ? step.run : '';
}

describe("the ui coverage lane says its width once (objectui#12256)", () => {
  const width = matrixWidth();

  it('names each shard job with the matrix width', () => {
    expect(job(UI_COVERAGE.shards).name).toBe(`Test UI (coverage shard \${{ matrix.shard }}/${width})`);
  });

  it('passes the matrix width to vitest, in the flag and in the step name', () => {
    const steps = (job(UI_COVERAGE.shards).steps ?? []).filter((s) => runOf(s).includes('test:coverage'));
    expect(steps.length, `no step in \`${UI_COVERAGE.shards}\` runs \`test:coverage\` any more`).toBeGreaterThan(0);
    for (const step of steps) {
      const flags = [...runOf(step).matchAll(/--shard=\$\{\{ matrix\.shard \}\}\/(\d+)/g)].map((m) => Number(m[1]));
      expect(flags, `${step.name}: one --shard flag, carrying the matrix width`).toEqual([width]);
      expect(step.name, `${step.name}: the step name states a different width`).toContain(`/${width})`);
    }
  });

  it('declares the same width as the count the merge refuses to go below', () => {
    expect(job(UI_COVERAGE.report).env?.COVERAGE_SHARDS, `\`${UI_COVERAGE.report}\` must declare \`COVERAGE_SHARDS\``).toBe(
      String(width),
    );
  });

  it('counts the blobs through that variable, with no literal width left in the step', () => {
    const count = runOf((job(UI_COVERAGE.report).steps ?? []).find((s) => s.id === 'blobs'));
    expect(count, `\`${UI_COVERAGE.report}\` must keep its \`blobs\` count step`).not.toBe('');
    expect(count).toContain('-name "blob-*-${COVERAGE_SHARDS}.json"');
    expect(count).toContain('-ne "$COVERAGE_SHARDS"');
    // A digit in the blob glob or the comparison is a second spelling of the
    // width, and the one that goes stale first.
    expect(count).not.toMatch(/blob-\*-\d/);
    expect(count).not.toMatch(/-ne\s+\d/);
  });

  it('enforces the configured thresholds over the merge of every blob, overriding none', () => {
    const merge = runOf((job(UI_COVERAGE.report).steps ?? []).find((s) => s.id === 'merge'));
    expect(merge, `\`${UI_COVERAGE.report}\` must keep its \`merge\` step`).toContain('--merge-reports');
    expect(merge, 'the merge is where the thresholds are enforced; it must not override them').not.toContain(
      'thresholds',
    );
    const legs = (job(UI_COVERAGE.shards).steps ?? []).filter((s) => runOf(s).includes('--shard='));
    expect(legs.length, `no \`${UI_COVERAGE.shards}\` step passes \`--shard=\``).toBeGreaterThan(0);
    for (const leg of legs) {
      // The other half of the same contract: the legs zero the thresholds, so
      // the merge above is the only evaluation, over all of them.
      expect(runOf(leg)).toContain('--coverage.thresholds.lines=0');
    }
  });
});
