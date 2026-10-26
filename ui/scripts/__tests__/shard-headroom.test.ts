import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Plain-JS CI helper; its types are INFERRED from the .mjs source by
// `tsconfig.scripts.json` (`allowJs`), so no `@ts-expect-error` here.
import { EXIT_OK, EXIT_USAGE, headroom, main, render, shardNames } from '../shard-headroom.mjs';

/**
 * The report-only headroom reading of the two test aggregators (objectui#12208,
 * ruling 6121816480: "prints the longest shard's headroom against the cap as a
 * report-only reading (⛔ not a gate)"). Two things are pinned:
 *
 *   - the reading itself, on a recorded job list whose walls are known;
 *   - that it is wired as a READING: each invocation names its matrix's width
 *     and its job's real `timeout-minutes`, and no outcome of it can turn an
 *     aggregator red.
 */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const recorded = JSON.parse(
  fs.readFileSync(path.join(repoRoot, 'scripts/__tests__/fixtures/test-shard-results/run-36042402511-attempt-1.json'), 'utf8'),
);

describe('the reading', () => {
  // The recorded run is an 8-wide `merge_group` run of 2026-09-24; its shard
  // walls are `completed_at - started_at` of each `Test (shard N/8)` job.
  const reading = headroom({ jobs: recorded.jobs, template: 'Test (shard {n}/8)', shards: 8, capMinutes: 20, targetMinutes: 10 });

  it("reads every shard's wall and names the longest against the cap", () => {
    expect(reading.measured).toBe(true);
    if (!reading.measured) return;
    expect(reading.longest).toMatchObject({ name: 'Test (shard 4/8)', seconds: 637 });
    expect(reading.headroomSeconds).toBe(1200 - 637);
    expect(reading.percentOfCap).toBe(53);
    expect(reading.walls.map((w) => w.seconds)).toEqual([637, 630, 618, 596, 582, 566, 459, 457]);
  });

  it('derives the width the measured total implies at the target per shard', () => {
    if (!reading.measured) throw new Error('unmeasured');
    expect(reading.total).toBe(4545);
    expect(reading.impliedWidth).toBe(Math.ceil(4545 / 600));
    expect(reading.width).toBe(8);
  });

  it('prints it in the log, one notice line and a step-summary table', () => {
    const out = render(reading, 'Test (shard {n}/8)');
    expect(out.log).toContain('longest Test (shard 4/8): 10m37s = 53% of the 20-minute cap, 9m23s of headroom');
    expect(out.notice).toMatch(/^::notice title=Shard headroom::longest Test \(shard 4\/8\)/);
    expect(out.summary).toContain('| Test (shard 4/8) | 10m37s | success |');
  });

  it('says NOT MEASURED, with no number, when a shard has no wall', () => {
    const skipped = headroom({ jobs: recorded.jobs, template: 'Test (coverage shard {n}/4)', shards: 4, capMinutes: 40, targetMinutes: 20 });
    expect(skipped.measured).toBe(false);
    const out = render(skipped, 'Test (coverage shard {n}/4)');
    expect(out.log).toContain('NOT MEASURED');
    expect(out.log).not.toMatch(/% of the/);
  });

  it('refuses a template without a shard slot', () => {
    expect(() => shardNames('Test (shard 1/8)', 8)).toThrow(/\{n\}/);
  });
});

describe('⛔ not a gate', () => {
  // On a runner these are set, and `main` would append its reading to the
  // step summary of the job running THIS test. Neither belongs there.
  const saved = { repo: process.env.GITHUB_REPOSITORY, summary: process.env.GITHUB_STEP_SUMMARY };
  beforeEach(() => {
    delete process.env.GITHUB_REPOSITORY;
    delete process.env.GITHUB_STEP_SUMMARY;
  });
  afterEach(() => {
    if (saved.repo !== undefined) process.env.GITHUB_REPOSITORY = saved.repo;
    if (saved.summary !== undefined) process.env.GITHUB_STEP_SUMMARY = saved.summary;
  });

  it('exits 0 when the jobs API cannot be read', async () => {
    const code = await main(['--job', 'Test (shard {n}/16)', '--shards', '16', '--cap-minutes', '20', '--target-minutes', '10']);
    expect(code).toBe(EXIT_OK);
  });

  it('exits 0 on a reading of a run where every shard is long', async () => {
    const fixture = path.join(repoRoot, 'scripts/__tests__/fixtures/test-shard-results/run-36042402511-attempt-1.json');
    // A 5-minute cap makes every shard of the recorded run "over" it.
    expect(await main(['--job', 'Test (shard {n}/8)', '--shards', '8', '--cap-minutes', '5', '--target-minutes', '2', '--fixture', fixture])).toBe(EXIT_OK);
  });

  it('exits 2 only for a malformed invocation', async () => {
    expect(await main(['--job', 'Test', '--shards', '16', '--cap-minutes', '20', '--target-minutes', '10'])).toBe(EXIT_USAGE);
  });
});

// `ci.yml wires it as a reading of the right matrix and the right cap` retired
// with objectstack#25712. It held the headroom step's `--job`, `--shards` and
// `--cap-minutes` to the two objectui ci.yml aggregators that ran it,
// `test-aggregate` (over `test`) and `coverage-report` (over `test-coverage`),
// and that file runs nowhere under the monorepo. Both are row 7 of the
// objectstack#25697 workflow roster: `Test (the shard aggregate)`, "dropped
// until cutover", and `Test (coverage shard n/8) · Test (coverage)`, "kept,
// follow-up port". No root job runs this reading until one of them is ported;
// the port brings the wiring pin back against its job (`helpers/root-ci.ts`).
