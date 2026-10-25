#!/usr/bin/env node
// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * shard-headroom -- how close this run's longest test shard came to its job's
 * `timeout-minutes`, and the width the run's measured total implies at the
 * target per shard. REPORT-ONLY (objectui#12208, ruling 6121816480: "the
 * `Test` aggregator prints the longest shard's headroom against the cap as a
 * report-only reading (⛔ not a gate)"; objectstack#22998's timing rule).
 *
 *   node scripts/shard-headroom.mjs --job 'Test (shard {n}/16)' --shards 16 --cap-minutes 20 --target-minutes 10
 *   node scripts/shard-headroom.mjs ... --fixture <jobs.json>
 *
 * `ci.yml`'s two aggregators run it: `test-aggregate` (`Test`) for the `test`
 * matrix and `coverage-report` (`Test (coverage)`) for the coverage matrix.
 * `scripts/__tests__/shard-headroom.test.ts` pins each invocation's
 * `--shards` and `--cap-minutes` to the matrix and the `timeout-minutes` of
 * the job it reads, so the reading cannot quietly describe another cap.
 *
 * ## Why a reading at all
 *
 * Both matrices reached their caps the same way: a leg crept up on
 * `timeout-minutes` over weeks, nobody was looking at the margin, and the first
 * signal was a CANCELLED leg (objectui#9499, objectui#12208, objectui#12256).
 * The margin is in the jobs API on every run and costs one read to state. So
 * the aggregators state it, every run, where the next person to widen a matrix
 * will look: the step summary and one `::notice` line.
 *
 * ## What it prints
 *
 *   - every shard's wall, `completed_at - started_at` of its job, longest first;
 *   - the longest one against the cap: seconds of headroom and percent of cap;
 *   - the total over the shards, and `ceil(total / target)`: the width the
 *     measured work implies at the target per shard, beside the width the
 *     matrix has. That is the "width derived from the total measured duration
 *     at the target per shard" the ruling asks for, re-derived on every run
 *     instead of written down once (AGENTS.md #9).
 *
 * ## ⛔ Not a gate, by construction
 *
 * Exit 0 whenever the arguments parse, whatever the margin, and also when the
 * jobs API cannot be read or a shard has no wall yet: those print NOT
 * MEASURED with the reason, never a number. Exit 2 is a malformed invocation
 * only. The `ci.yml` steps also carry `continue-on-error: true`, so not even
 * that can turn an aggregator red.
 */

import fs from 'node:fs';

import { fetchRunJobs } from './check-test-shard-results.mjs';
import { isEntrypoint } from './invoked-as.mjs';

export const EXIT_OK = 0;
export const EXIT_USAGE = 2;

/**
 * @param {string} template  a job name with `{n}` where the shard index goes
 * @param {number} shards
 */
export function shardNames(template, shards) {
  if (!template.includes('{n}')) throw new Error(`--job must contain {n}, got ${JSON.stringify(template)}`);
  if (!Number.isInteger(shards) || shards < 1) throw new Error(`--shards must be a positive integer, got ${shards}`);
  return Array.from({ length: shards }, (_, i) => template.replace('{n}', String(i + 1)));
}

/** @param {unknown} iso */
const at = (iso) => (typeof iso === 'string' && iso ? Date.parse(iso) : Number.NaN);

/**
 * The reading. Pure: no clock, no network.
 *
 * @param {{ jobs: unknown, template: string, shards: number, capMinutes: number, targetMinutes: number }} input
 */
export function headroom({ jobs, template, shards, capMinutes, targetMinutes }) {
  const names = shardNames(template, shards);
  const list = Array.isArray(jobs) ? jobs : [];
  const walls = names.map((name) => {
    const job = /** @type {{ started_at?: unknown, completed_at?: unknown, conclusion?: unknown } | undefined} */ (
      list.find((j) => j && typeof j === 'object' && /** @type {{ name?: unknown }} */ (j).name === name)
    );
    const seconds = job ? (at(job.completed_at) - at(job.started_at)) / 1000 : Number.NaN;
    return {
      name,
      conclusion: job && typeof job.conclusion === 'string' ? job.conclusion : null,
      seconds: Number.isFinite(seconds) && seconds >= 0 && job?.conclusion !== 'skipped' ? Math.round(seconds) : null,
    };
  });
  const missing = walls.filter((w) => w.seconds === null).map((w) => w.name);
  const capSeconds = capMinutes * 60;
  const targetSeconds = targetMinutes * 60;
  if (missing.length > 0) {
    return { measured: /** @type {const} */ (false), why: `no wall for ${missing.join(', ')}`, walls, capSeconds, targetSeconds };
  }
  const sorted = [...walls].sort((a, b) => /** @type {number} */ (b.seconds) - /** @type {number} */ (a.seconds));
  const longest = sorted[0];
  const total = walls.reduce((s, w) => s + /** @type {number} */ (w.seconds), 0);
  return {
    measured: /** @type {const} */ (true),
    walls: sorted,
    longest,
    capSeconds,
    targetSeconds,
    headroomSeconds: capSeconds - /** @type {number} */ (longest.seconds),
    percentOfCap: Math.round((/** @type {number} */ (longest.seconds) / capSeconds) * 100),
    total,
    impliedWidth: Math.ceil(total / targetSeconds),
    width: shards,
  };
}

/**
 * The log lines, the one-line notice and the step-summary block.
 *
 * @param {ReturnType<typeof headroom>} r
 * @param {string} template
 */
export function render(r, template) {
  const title = `Shard headroom (report-only): ${template.replace('{n}', 'N')}`;
  if (!r.measured) {
    const line = `NOT MEASURED -- ${r.why}. This is a reading, not a gate; nothing failed because of it.`;
    return { log: `${title}\n${line}`, notice: `::notice title=Shard headroom::${template.replace('{n}', 'N')}: ${line}`, summary: `### ${title}\n\n${line}\n` };
  }
  const m = (/** @type {number} */ s) => `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`;
  const head =
    `longest ${r.longest.name}: ${m(/** @type {number} */ (r.longest.seconds))} = ${r.percentOfCap}% of the ` +
    `${r.capSeconds / 60}-minute cap, ${m(r.headroomSeconds)} of headroom`;
  const width =
    `total ${m(r.total)} over ${r.width} shard(s); at the ${r.targetSeconds / 60}-minute target per shard that is ` +
    `${r.impliedWidth} shard(s) (the matrix has ${r.width})`;
  const rows = r.walls.map((w) => `| ${w.name} | ${m(/** @type {number} */ (w.seconds))} | ${w.conclusion ?? '?'} |`);
  return {
    log: [title, head, width, ...r.walls.map((w) => `  ${m(/** @type {number} */ (w.seconds))}  ${w.name} (${w.conclusion ?? '?'})`)].join('\n'),
    notice: `::notice title=Shard headroom::${head}; ${width}`,
    summary: [`### ${title}`, '', `- ${head}`, `- ${width}`, '', '| shard | wall | conclusion |', '|:--|--:|:--|', ...rows, ''].join('\n'),
  };
}

/** @param {string[]} argv */
export function parseArgs(argv) {
  const value = (/** @type {string} */ flag) => {
    const i = argv.indexOf(flag);
    return i === -1 ? undefined : argv[i + 1];
  };
  return {
    template: value('--job') ?? '',
    shards: Number(value('--shards')),
    capMinutes: Number(value('--cap-minutes')),
    targetMinutes: Number(value('--target-minutes')),
    fixture: value('--fixture'),
  };
}

/** @param {string[]} argv */
export async function main(argv) {
  const args = parseArgs(argv);
  const positive = (/** @type {number} */ n) => Number.isFinite(n) && n > 0;
  if (!args.template.includes('{n}') || !Number.isInteger(args.shards) || args.shards < 1 || !positive(args.capMinutes) || !positive(args.targetMinutes)) {
    console.error("usage: node scripts/shard-headroom.mjs --job 'Name {n}/M' --shards M --cap-minutes C --target-minutes T [--fixture jobs.json]");
    return EXIT_USAGE;
  }
  /** @type {ReturnType<typeof headroom>} */
  let reading;
  try {
    const jobs = args.fixture ? JSON.parse(fs.readFileSync(args.fixture, 'utf8')).jobs : await fetchRunJobs();
    reading = headroom({ jobs, ...args });
  } catch (error) {
    reading = {
      measured: false,
      why: `the jobs API could not be read (${error instanceof Error ? error.message : String(error)})`,
      walls: [],
      capSeconds: args.capMinutes * 60,
      targetSeconds: args.targetMinutes * 60,
    };
  }
  const out = render(reading, args.template);
  console.log(out.log);
  console.log(out.notice);
  if (process.env.GITHUB_STEP_SUMMARY) {
    try {
      fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${out.summary}\n`);
    } catch {
      // The summary is a convenience; the log above already carries the reading.
    }
  }
  return EXIT_OK;
}

if (isEntrypoint(import.meta.url)) {
  process.exit(await main(process.argv.slice(2)));
}
