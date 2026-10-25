import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ACTIONS_CHECK_RUN_APP,
  EXIT_BREACHED,
  EXIT_CANNOT_RUN,
  EXIT_OK,
  GATE_BUDGET_MS,
  REQUEST_TIMEOUT_MS,
  REREAD_LIMIT,
  REREAD_WAIT_MS,
  STALE_REREAD_LIMIT,
  STALE_REREAD_WAIT_MS,
  TRANSIENT_RETRY_LIMIT,
  TRANSIENT_RETRY_WAIT_MS,
  carryForward,
  concludeFromCheckRun,
  evaluate,
  exitCodeFor,
  fetchCheckRun,
  fetchJob,
  renderReading,
  run,
  settleReading,
  shardContexts,
  unconcludedShards,
} from '../check-test-shard-results.mjs';
import { checkNames, readWorkflows } from './workflow-checks.js';

/**
 * objectui#9499 — the aggregator that replaced four required shard contexts.
 *
 * `ci.yml`'s `test` job is a matrix bounded by `timeout-minutes: 20`, and at
 * four shards it had grown into that bound: the longest SUCCEEDING shard-1 job
 * measured 1199 s against the 1200 s ceiling, and two runs crossed it and were
 * CANCELLED — one of them dequeuing a pull request whose tests had passed,
 * because the merge queue cannot tell `cancelled` from `failure`. Widening the
 * matrix was blocked on the required-check set naming the legs one by one:
 * 4 → 8 renames four live required contexts, which no workflow edit can do.
 *
 * ## ⭐ What these cases are actually for
 *
 * The aggregator's whole risk is that it is EASIER to write wrong than right. A
 * matrix job's `needs.<job>.result` is one rollup over every leg, and it reads
 * `success` when some legs succeeded and the rest were SKIPPED. An aggregator
 * built on that expression is a check that reports success having run nothing —
 * objectui#8857 and objectui#3523 in one line of YAML.
 *
 * So the ruling's acceptance is the case below named for it: a shard forced to
 * `skipped` must turn the aggregator RED. It is asserted here against the pure
 * evaluator, and demonstrated end to end in the pull request against a real
 * Actions run.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const ciYaml = fs.readFileSync(path.join(repoRoot, '.github/workflows/ci.yml'), 'utf8');

/** A jobs-API answer: every shard green, plus the aggregator's own in-flight job. */
function greenRun(shards = 8) {
  return [
    { name: 'Type Check', conclusion: 'success' },
    ...shardContexts(shards).map((name) => ({ name, conclusion: 'success' })),
    { name: 'Test (dist pins)', conclusion: 'success' },
    { name: 'Test', conclusion: null },
  ];
}

const read = (jobs: unknown[], shards = 8) => evaluate({ jobs, shards, selfJobName: 'Test' });

describe('check-test-shard-results — the shard names it expects', () => {
  it('spells them the way ci.yml names the matrix job', () => {
    // Both sides derived, neither retyped: `checkNames` is the same parser
    // `dependabot-merge-gate.test.ts` partitions the produced check set with,
    // so this compares the gate's expectation against the workflow itself.
    const workflow = readWorkflows().find((w) => w.file === 'ci.yml');
    expect(workflow, 'ci.yml must still be a workflow').toBeTruthy();

    const produced = checkNames(workflow!);
    const shards = produced.filter((name) => /^Test \(shard \d+\/\d+\)$/.test(name));
    expect(shards.length, 'ci.yml no longer produces a `Test (shard N/M)` matrix').toBeGreaterThan(1);

    expect(
      shardContexts(shards.length),
      "the gate's shard-name spelling has drifted from ci.yml's `name:` template",
    ).toEqual(shards);
  });

  it('refuses a width that is not a positive integer', () => {
    for (const bad of [0, -1, 1.5, Number.NaN]) expect(() => shardContexts(bad)).toThrow(/positive integer/);
  });
});

describe('check-test-shard-results — the verdict', () => {
  it('is intact when every shard reported success', () => {
    const reading = read(greenRun());
    expect(reading.verdict).toBe('intact');
    expect(exitCodeFor(reading)).toBe(EXIT_OK);
    expect(renderReading(reading)).toContain('all 8 shards reported success');
  });

  it('⭐ is BREACHED when one shard was SKIPPED — the objectui#9499 acceptance', () => {
    // The rollup's blind spot, and the reason this gate reads conclusions one
    // at a time. `needs.test.result` over this same run answers `success`.
    const jobs = greenRun().map((job) => (job.name === 'Test (shard 3/8)' ? { ...job, conclusion: 'skipped' } : job));
    const reading = read(jobs);

    expect(reading.verdict).toBe('breached');
    expect(exitCodeFor(reading)).toBe(EXIT_BREACHED);
    expect(reading.notSuccess).toEqual(['Test (shard 3/8) (skipped)']);
    expect(renderReading(reading)).toContain("'skipped' is not a pass here");

    // The control, same evaluator, same run, one field changed back: the red
    // above is the `skipped` conclusion speaking and not some other difference.
    expect(read(greenRun()).verdict).toBe('intact');
  });

  it('is BREACHED when a shard produced no job at all', () => {
    const jobs = greenRun().filter((job) => job.name !== 'Test (shard 8/8)');
    const reading = read(jobs);

    expect(reading.verdict).toBe('breached');
    expect(reading.missing).toEqual(['Test (shard 8/8)']);
    expect(renderReading(reading)).toContain('produced no job at all');
  });

  it('is BREACHED when the matrix is narrower than the gate was told', () => {
    // The drift this gate is exposed to: ci.yml's matrix loses legs and the
    // `--shards` argument does not follow. Every name it looked for is absent,
    // which is loud rather than vacuous.
    const reading = read(greenRun(4).map((j) => j), 8);
    expect(reading.verdict).toBe('breached');
    expect(reading.missing).toHaveLength(8);
  });

  it('is BREACHED on a failed or cancelled shard — the timeout kill included', () => {
    for (const conclusion of ['failure', 'cancelled', 'timed_out', null]) {
      const jobs = greenRun().map((job) => (job.name === 'Test (shard 1/8)' ? { ...job, conclusion } : job));
      const reading = read(jobs);
      expect(reading.verdict, `a ${String(conclusion)} shard must not pass`).toBe('breached');
    }
  });
});

describe('check-test-shard-results — an unreadable answer is never a pass', () => {
  it('refuses a verdict over a job list this job is not in', () => {
    // `GET /actions/runs/{id}/attempts/{n}/jobs` answers 200 with an empty list
    // for a run id that does not exist, so without this control "no shards
    // found" and "every shard was removed" are the same reading — and the
    // second one is the breach.
    const reading = read(greenRun().filter((job) => job.name !== 'Test'));
    expect(reading.verdict).toBe('unreadable');
    expect(exitCodeFor(reading)).toBe(EXIT_CANNOT_RUN);
    expect(renderReading(reading)).toContain('not about this run');
  });

  it('refuses an empty answer', () => {
    const reading = read([]);
    expect(reading.verdict).toBe('unreadable');
    expect(exitCodeFor(reading)).toBe(EXIT_CANNOT_RUN);
  });

  it('never reports a clean exit code for anything but `intact`', () => {
    expect(exitCodeFor(read(greenRun()))).toBe(EXIT_OK);
    expect(exitCodeFor(read([]))).not.toBe(EXIT_OK);
    expect(exitCodeFor(read(greenRun().filter((j) => j.name !== 'Test (shard 2/8)')))).not.toBe(EXIT_OK);
  });

  it('ignores a job whose name it cannot read rather than counting it as seen', () => {
    const jobs = [...greenRun().filter((j) => j.name !== 'Test (shard 5/8)'), { conclusion: 'success' }];
    expect(read(jobs).missing).toEqual(['Test (shard 5/8)']);
  });

  it('throws rather than guessing when the answer is not a list', () => {
    expect(() => evaluate({ jobs: { jobs: [] }, shards: 8, selfJobName: 'Test' })).toThrow(/not an array/);
  });
});

/**
 * objectui#10931 — the recorded false red, as the fixture.
 *
 * `run-36042402511-attempt-1.json` is that merge-group run's job table as the
 * endpoint `fetchRunJobs()` calls answers it now: all eight shards `success`.
 * The aggregator read the same table at 2026-09-24T18:47:14Z and its log
 * printed `no conclusion  Test (shard 6/8)` with every other shard `success`,
 * so the as-read view below differs from the fixture in that one shard's
 * conclusion. The log did not print the shard's `status`, so that field is
 * dropped from the as-read record rather than guessed.
 */
type RecordedJob = { id: number; name: string; status: string; conclusion: string | null };
const recorded = JSON.parse(
  fs.readFileSync(path.join(repoRoot, 'scripts/__tests__/fixtures/test-shard-results/run-36042402511-attempt-1.json'), 'utf8'),
) as { jobs: RecordedJob[] };
const LATE = 'Test (shard 6/8)';
const lateJob = recorded.jobs.find((job) => job.name === LATE)!;

function asRead(jobs: RecordedJob[] = recorded.jobs): Record<string, unknown>[] {
  return jobs.map((job) => {
    if (job.name !== LATE) return job;
    const copy: Record<string, unknown> = { ...job, conclusion: null };
    delete copy.status;
    return copy;
  });
}

/** `settleReading` with a scripted re-read answer, no clock, and every call recorded. */
function settle(jobs: unknown[], answer: (jobId: number) => unknown) {
  const reread: number[] = [];
  const slept: number[] = [];
  const logged: string[] = [];
  const result = settleReading({
    jobs,
    shards: 8,
    selfJobName: 'Test',
    rereadJob: async (jobId: number) => {
      reread.push(jobId);
      return answer(jobId);
    },
    sleep: async (ms: number) => {
      slept.push(ms);
    },
    log: (line: string) => {
      logged.push(line);
    },
  });
  return { result, reread, slept, logged };
}

const settled = (jobId: number) => recorded.jobs.find((job) => job.id === jobId);
const withConclusion = (name: string, conclusion: string | null) =>
  recorded.jobs.map((job) => (job.name === name ? { ...job, conclusion } : job));

describe('check-test-shard-results — a present shard with no conclusion is re-read (objectui#10931)', () => {
  it('reproduces the recorded false red from the recorded job table', () => {
    // The control first: the fixture is the settled answer, and it is green.
    expect(recorded.jobs).toHaveLength(16);
    expect(read(recorded.jobs).verdict).toBe('intact');

    // One field changed, the one the log names: that is the ejection.
    const reading = read(asRead());
    expect(reading.verdict).toBe('breached');
    expect(exitCodeFor(reading)).toBe(EXIT_BREACHED);
    expect(reading.notSuccess).toEqual([`${LATE} (no conclusion)`]);
    expect(unconcludedShards(reading).map((s) => s.jobId)).toEqual([lateJob.id]);
  });

  it('⭐ re-reads only that shard, by its job id, and the settled answer is intact', async () => {
    const run = settle(asRead(), settled);
    const { reading, rereads } = await run.result;

    expect(reading.verdict).toBe('intact');
    expect(exitCodeFor(reading)).toBe(EXIT_OK);
    expect(rereads).toBe(1);
    expect(run.reread).toEqual([lateJob.id]);
    expect(run.slept).toEqual([REREAD_WAIT_MS]);
    expect(run.logged).toHaveLength(1);
    expect(run.logged[0]).toContain(String(lateJob.id));
  });

  it('⛔ never reads null as success: a shard that never answers stays red after the bound', async () => {
    const run = settle(asRead(), (jobId) => ({ ...settled(jobId), conclusion: null }));
    const { reading, rereads } = await run.result;

    expect(reading.verdict).toBe('breached');
    expect(exitCodeFor(reading)).toBe(EXIT_BREACHED);
    expect(reading.notSuccess).toEqual([`${LATE} (no conclusion)`]);
    expect(rereads).toBe(REREAD_LIMIT);
    expect(run.reread).toEqual(Array.from({ length: REREAD_LIMIT }, () => lateJob.id));
    expect(run.slept).toHaveLength(REREAD_LIMIT);
    expect(unconcludedShards(reading).map((s) => s.name)).toEqual([LATE]);
  });

  it('judges the re-read answer as it stands: a late `failure` is a failure', async () => {
    const run = settle(asRead(), (jobId) => ({ ...settled(jobId), conclusion: 'failure' }));
    const { reading, rereads } = await run.result;

    expect(reading.verdict).toBe('breached');
    expect(reading.notSuccess).toEqual([`${LATE} (failure)`]);
    expect(rereads).toBe(1);
  });

  it('⛔ never re-reads a shard that answered, `skipped` included — no blanket retry', async () => {
    for (const conclusion of ['failure', 'cancelled', 'timed_out', 'skipped']) {
      const run = settle(withConclusion('Test (shard 3/8)', conclusion), settled);
      const { reading, rereads } = await run.result;

      expect(reading.verdict, `a ${conclusion} shard must stay red`).toBe('breached');
      expect(reading.notSuccess).toEqual([`Test (shard 3/8) (${conclusion})`]);
      expect(rereads).toBe(0);
      expect(run.reread).toEqual([]);
      expect(run.slept).toEqual([]);
    }
  });

  it('re-reads the late shard only, while a real failure beside it keeps the run red', async () => {
    const jobs = asRead(withConclusion('Test (shard 3/8)', 'failure'));
    const run = settle(jobs, settled);
    const { reading } = await run.result;

    expect(run.reread).toEqual([lateJob.id]);
    expect(reading.verdict).toBe('breached');
    expect(reading.notSuccess).toEqual(['Test (shard 3/8) (failure)']);
  });

  it('does not re-read an absent shard: that is drift, not a late answer', async () => {
    const run = settle(recorded.jobs.filter((job) => job.name !== 'Test (shard 8/8)'), settled);
    const { reading, rereads } = await run.result;

    expect(reading.missing).toEqual(['Test (shard 8/8)']);
    expect(rereads).toBe(0);
    expect(run.reread).toEqual([]);
  });

  it('does not re-read a reading that is not about this run', async () => {
    const run = settle(asRead().filter((job) => job.name !== 'Test'), settled);
    const { reading, rereads } = await run.result;

    expect(reading.verdict).toBe('unreadable');
    expect(exitCodeFor(reading)).toBe(EXIT_CANNOT_RUN);
    expect(rereads).toBe(0);
    expect(run.reread).toEqual([]);
  });

  it('re-reads one job by id on the single-job endpoint, and an HTTP error is not an answer', async () => {
    const urls: string[] = [];
    const reply = (status: number, body: unknown) =>
      (async (url: string | URL | Request) => {
        urls.push(String(url));
        return new Response(JSON.stringify(body), { status });
      }) as typeof fetch;
    const input = { repository: 'objectstack-ai/objectui', apiUrl: 'https://api.test', token: 't' };

    expect(await fetchJob(lateJob.id, { ...input, fetchImpl: reply(200, lateJob) })).toEqual(lateJob);
    expect(urls).toEqual([`https://api.test/repos/objectstack-ai/objectui/actions/jobs/${lateJob.id}`]);
    await expect(fetchJob(lateJob.id, { ...input, fetchImpl: reply(404, {}) })).rejects.toThrow(/HTTP 404/);
  });

  it('refuses a re-read that answers about another job, and a shard with no id to re-read', async () => {
    const shardOne = recorded.jobs.find((job) => job.name === 'Test (shard 1/8)');
    await expect(settle(asRead(), () => shardOne).result).rejects.toThrow(/not that job/);

    const withoutId = asRead().map((job) => {
      if (job.name !== LATE) return job;
      const copy = { ...job };
      delete copy.id;
      return copy;
    });
    await expect(settle(withoutId, settled).result).rejects.toThrow(/no job id/);
  });
});

/**
 * objectui#13064 — the whole gate, driven through `run` over a scripted API.
 *
 * `run` is what `main` calls with the real environment, network and clock, so
 * these cases exercise the composition CI runs: argument parsing, the token
 * refusal, the attempt reads, the re-read and the exit code. The clock is
 * virtual and only `sleep` moves it, so a wait is observable and costs nothing.
 */
const API = 'https://api.test';
const REPO = 'objectstack-ai/objectui';

type Answer = Response | Error;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const jobsPage = (jobs: unknown[]) => json({ total_count: jobs.length, jobs });

/** A job's page, as both its job record (`html_url`) and its own check run (`html_url`) name it. */
const jobUrl = (id: number) => `https://github.com/${REPO}/actions/runs/42/job/${id}`;

/** One attempt's job list as the endpoint answers it: ids, statuses, `run_attempt`, and the aggregator's own job. */
function attemptJobs(attempt: number, conclusionOf: (name: string) => string | null | undefined = () => 'success', shards = 8) {
  const jobs: Record<string, unknown>[] = [];
  shardContexts(shards).forEach((name, i) => {
    const conclusion = conclusionOf(name);
    if (conclusion === undefined) return; // not in this attempt
    const id = attempt * 1000 + i;
    jobs.push({ id, name, status: conclusion === null ? 'in_progress' : 'completed', conclusion, run_attempt: attempt, html_url: jobUrl(id) });
  });
  const own = attempt * 1000 + 999;
  jobs.push({ id: own, name: 'Test', status: 'in_progress', conclusion: null, run_attempt: attempt, html_url: jobUrl(own) });
  return jobs;
}

/** The name `attemptJobs` gives the job with this id. */
const nameOf = (id: number, shards = 8) => (id % 1000 === 999 ? 'Test' : shardContexts(shards)[id % 1000]);

/** A job's own check run as the Checks API answers it: `completed` with the conclusion given, else still running. */
const checkRunOf = (id: number, conclusion: string | null = null, shards = 8) =>
  json({
    id,
    name: nameOf(id, shards),
    status: conclusion === null ? 'in_progress' : 'completed',
    conclusion,
    app: { slug: 'github-actions' },
    html_url: jobUrl(id),
  });

const checkRunId = (url: string) => Number(/\/check-runs\/(\d+)$/.exec(url)?.[1] ?? Number.NaN);

const attemptOf = (url: string) => Number(/\/attempts\/(\d+)\/jobs/.exec(url)?.[1] ?? Number.NaN);

/**
 * `run` over a scripted API. `answer` serves every route but the Checks API's;
 * `checkRun` serves that one, by default as a check run that has no conclusion
 * yet, so a case written before objectui#13327 reads exactly as it did.
 * `urls` records the former and `checkRunUrls` the latter.
 */
function gate(
  answer: (url: string, call: number) => Answer,
  env: Record<string, string | undefined> = {},
  shards = 8,
  checkRun: (id: number, call: number) => Answer = (id) => checkRunOf(id, null, shards),
) {
  let clock = 0;
  const urls: string[] = [];
  const checkRunUrls: string[] = [];
  const slept: number[] = [];
  const out: string[] = [];
  const err: string[] = [];
  const result = run(['--shards', String(shards), '--job-name', 'Test'], {
    env: {
      GITHUB_TOKEN: 't',
      GITHUB_API_URL: API,
      GITHUB_REPOSITORY: REPO,
      GITHUB_RUN_ID: '42',
      GITHUB_RUN_ATTEMPT: '1',
      ...env,
    },
    fetchImpl: (async (url: string | URL | Request) => {
      const at = String(url);
      let reply: Answer;
      if (at.includes('/check-runs/')) {
        checkRunUrls.push(at);
        reply = checkRun(checkRunId(at), checkRunUrls.length);
      } else {
        urls.push(at);
        reply = answer(at, urls.length);
      }
      if (reply instanceof Error) throw reply;
      return reply;
    }) as typeof fetch,
    sleep: async (ms: number) => {
      slept.push(ms);
      clock += ms;
    },
    now: () => clock,
    out: (line: string) => {
      out.push(line);
    },
    err: (line: string) => {
      err.push(line);
    },
  });
  return { result, urls, checkRunUrls, slept, out, err, elapsed: () => clock };
}

/** The connection-reset and timeout shapes the script's header records as measured on Node 22's `fetch`. */
const connectionReset = () => new TypeError('fetch failed', { cause: Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' }) });
const requestTimeout = () => new DOMException('The operation was aborted due to timeout', 'TimeoutError');

describe('check-test-shard-results — a transient read is asked again, bounded (objectui#13064)', () => {
  it('⭐ one 502 then 200 gives a verdict', async () => {
    // Runs 39276047959 and 39276560990: one HTTP 502 on the job list, exit 2.
    const g = gate((_url, call) => (call === 1 ? json({ message: 'Bad Gateway' }, 502) : jobsPage(attemptJobs(1))));

    expect(await g.result).toBe(EXIT_OK);
    expect(g.urls).toHaveLength(2);
    expect(new Set(g.urls).size, 'the retry asks the same route again').toBe(1);
    expect(g.slept).toEqual([TRANSIENT_RETRY_WAIT_MS]);
    expect(g.out.filter((line) => line.includes('HTTP 502'))).toHaveLength(1);
    expect(g.out.join('\n')).toContain('all 8 shards reported success');
  });

  it('⛔ a 5xx that persists past the bound stays exit 2', async () => {
    const g = gate(() => json({ message: 'Bad Gateway' }, 502));

    expect(await g.result).toBe(EXIT_CANNOT_RUN);
    expect(g.urls).toHaveLength(TRANSIENT_RETRY_LIMIT + 1);
    expect(g.slept).toEqual(Array.from({ length: TRANSIENT_RETRY_LIMIT }, () => TRANSIENT_RETRY_WAIT_MS));
    expect(g.err.join('\n')).toContain('HTTP 502');
    expect(g.out.join('\n')).not.toContain('reported success');
  });

  it('a connection reset and a request timeout are retried the same way', async () => {
    const g = gate((_url, call) => (call === 1 ? connectionReset() : call === 2 ? requestTimeout() : jobsPage(attemptJobs(1))));

    expect(await g.result).toBe(EXIT_OK);
    expect(g.urls).toHaveLength(3);
    expect(g.out.some((line) => line.includes('ECONNRESET'))).toBe(true);
    expect(g.out.some((line) => line.includes('request timeout'))).toBe(true);
  });

  it('a re-read that meets a 5xx is asked again too', async () => {
    const late = 'Test (shard 6/8)';
    let reread = 0;
    const g = gate((url) => {
      if (url.includes('/attempts/')) return jobsPage(attemptJobs(1, (name) => (name === late ? null : 'success')));
      reread += 1;
      return reread === 1 ? json({}, 503) : json({ id: 1005, name: late, status: 'completed', conclusion: 'success', run_attempt: 1 });
    });

    expect(await g.result).toBe(EXIT_OK);
    expect(g.slept).toEqual([REREAD_WAIT_MS, TRANSIENT_RETRY_WAIT_MS]);
  });

  it('⛔ 401, 403, 404 and 429 are answers: exit 2 at once, never asked again', async () => {
    for (const status of [401, 403, 404, 429]) {
      const g = gate(() => json({ message: 'no' }, status));
      expect(await g.result, `HTTP ${status}`).toBe(EXIT_CANNOT_RUN);
      expect(g.urls, `HTTP ${status} must not be retried`).toHaveLength(1);
      expect(g.slept).toEqual([]);
    }
  });

  it('⛔ a truncated page is exit 2 at once, never asked again', async () => {
    const g = gate(() => new Response('{"total_count": 9, "jobs": [{"name": "Test (shard 1/8)"', { status: 200 }));

    expect(await g.result).toBe(EXIT_CANNOT_RUN);
    expect(g.urls).toHaveLength(1);
    expect(g.slept).toEqual([]);
  });

  it('⛔ a missing token is exit 2 before any request', async () => {
    const g = gate(() => jobsPage(attemptJobs(1)), { GITHUB_TOKEN: undefined });

    expect(await g.result).toBe(EXIT_CANNOT_RUN);
    expect(g.urls).toEqual([]);
    expect(g.err.join('\n')).toContain('GITHUB_TOKEN');
  });

  it('⛔ no retry starts that the gate budget cannot finish', async () => {
    const urls: string[] = [];
    const slept: number[] = [];
    const fail = (async (url: string | URL | Request) => {
      urls.push(String(url));
      return json({}, 502);
    }) as typeof fetch;
    const input = {
      repository: REPO,
      apiUrl: API,
      token: 't',
      fetchImpl: fail,
      retries: TRANSIENT_RETRY_LIMIT,
      now: () => 0,
      sleep: async (ms: number) => {
        slept.push(ms);
      },
      // Room for one request, not for a wait plus another.
      deadline: TRANSIENT_RETRY_WAIT_MS + REQUEST_TIMEOUT_MS - 1,
    };

    await expect(fetchJob(7, input)).rejects.toThrow(/HTTP 502; no further retry fits/);
    expect(urls).toHaveLength(1);
    expect(slept).toEqual([]);
  });
});

describe('check-test-shard-results — a re-run attempt is judged with the attempts before it (objectui#13064)', () => {
  it('⭐ attempt 2 with every shard only in attempt 1, all success, passes', async () => {
    // Run 39276047959 attempt 2 as the gate read it: "re-run failed jobs"
    // re-ran only this job, so its attempt holds this job and nothing else yet.
    const g = gate(
      (url) => (attemptOf(url) === 2 ? jobsPage(attemptJobs(2, () => undefined)) : jobsPage(attemptJobs(1))),
      { GITHUB_RUN_ATTEMPT: '2' },
    );

    expect(await g.result).toBe(EXIT_OK);
    expect(g.urls.map(attemptOf)).toEqual([2, 1]);
    const printed = g.out.join('\n');
    expect(printed).toContain('all 8 shards reported success');
    expect(printed).toContain('(attempt 1; not re-run in attempt 2)');
  });

  it('⛔ attempt 2 with a shard `failure` in attempt 1 and not re-run stays red', async () => {
    const g = gate(
      (url) =>
        attemptOf(url) === 2
          ? jobsPage(attemptJobs(2, () => undefined))
          : jobsPage(attemptJobs(1, (name) => (name === 'Test (shard 3/8)' ? 'failure' : 'success'))),
      { GITHUB_RUN_ATTEMPT: '2' },
    );

    expect(await g.result).toBe(EXIT_BREACHED);
    expect(g.out.join('\n')).toContain('Test (shard 3/8) (failure)');
  });

  it('⛔ a carried `cancelled` or `skipped` stays red', async () => {
    for (const conclusion of ['cancelled', 'skipped']) {
      const g = gate(
        (url) =>
          attemptOf(url) === 2
            ? jobsPage(attemptJobs(2, () => undefined))
            : jobsPage(attemptJobs(1, (name) => (name === 'Test (shard 5/8)' ? conclusion : 'success'))),
        { GITHUB_RUN_ATTEMPT: '2' },
      );
      expect(await g.result, `a carried ${conclusion}`).toBe(EXIT_BREACHED);
    }
  });

  it('⛔ a shard present in no attempt stays ABSENT', async () => {
    const without = (name: string) => (name === 'Test (shard 8/8)' ? undefined : 'success');
    const g = gate(
      (url) => (attemptOf(url) === 2 ? jobsPage(attemptJobs(2, () => undefined)) : jobsPage(attemptJobs(1, without))),
      { GITHUB_RUN_ATTEMPT: '2' },
    );

    expect(await g.result).toBe(EXIT_BREACHED);
    const printed = g.out.join('\n');
    expect(printed).toContain('ABSENT  Test (shard 8/8)');
    expect(printed).toContain('produced no job at all in attempt 2 or any attempt before it');
  });

  it('a shard the re-run re-ran is judged by its re-run, both ways', async () => {
    const shard = 'Test (shard 3/8)';
    for (const [first, rerun, expected] of [
      ['failure', 'success', EXIT_OK],
      ['success', 'failure', EXIT_BREACHED],
    ] as const) {
      const g = gate(
        (url) =>
          attemptOf(url) === 2
            ? jobsPage(attemptJobs(2, (name) => (name === shard ? rerun : undefined)))
            : jobsPage(attemptJobs(1, (name) => (name === shard ? first : 'success'))),
        { GITHUB_RUN_ATTEMPT: '2' },
      );
      expect(await g.result, `attempt 1 ${first}, re-run ${rerun}`).toBe(expected);
    }
  });

  it('takes each absent shard from the LATEST earlier attempt that has it, and stops reading once none is absent', async () => {
    const shard = 'Test (shard 3/8)';
    const g = gate(
      (url) => {
        const k = attemptOf(url);
        if (k === 3) return jobsPage(attemptJobs(3, () => undefined));
        if (k === 2) return jobsPage(attemptJobs(2, (name) => (name === shard ? 'success' : undefined)));
        return jobsPage(attemptJobs(1, (name) => (name === shard ? 'failure' : 'success')));
      },
      { GITHUB_RUN_ATTEMPT: '3' },
    );

    expect(await g.result).toBe(EXIT_OK);
    expect(g.urls.map(attemptOf)).toEqual([3, 2, 1]);
    expect(g.out.join('\n')).toContain(`success  ${shard}  (attempt 2; not re-run in attempt 3)`);

    const full = gate((url) => jobsPage(attemptJobs(attemptOf(url))), { GITHUB_RUN_ATTEMPT: '2' });
    expect(await full.result).toBe(EXIT_OK);
    expect(full.urls.map(attemptOf), 'a full re-run needs no earlier attempt').toEqual([2]);
  });

  it('⛔ the own-job control is the current attempt’s, and nothing is carried into a reading that fails it', async () => {
    const g = gate(
      (url) => (attemptOf(url) === 2 ? jobsPage([]) : jobsPage(attemptJobs(1))),
      { GITHUB_RUN_ATTEMPT: '2' },
    );

    expect(await g.result).toBe(EXIT_CANNOT_RUN);
    expect(g.urls.map(attemptOf)).toEqual([2]);
  });

  it('refuses a carried record whose run_attempt is not the attempt it was read from', () => {
    const current = attemptJobs(2, () => undefined);
    const wrong = attemptJobs(1).map((job) => ({ ...job, run_attempt: 2 }));
    expect(() => carryForward({ jobs: current, from: { attempt: 1, jobs: wrong }, shards: 8 })).toThrow(/not that attempt/);
  });

  it('⛔ an earlier attempt that cannot be read is exit 2, never a pass', async () => {
    const g = gate(
      (url) => (attemptOf(url) === 2 ? jobsPage(attemptJobs(2, () => undefined)) : json({ message: 'Not Found' }, 404)),
      { GITHUB_RUN_ATTEMPT: '2' },
    );
    expect(await g.result).toBe(EXIT_CANNOT_RUN);
  });
});

/**
 * objectui#13064 — merge-group run 39286083342, the third measurement.
 *
 * Its job log printed nine shards with no conclusion at the first read, seven
 * settling during the eight re-reads, and `Test (shard 7/16)` and
 * `Test (shard 12/16)` still `in_progress` at the last, 6 min 22 s and
 * 4 min 35 s after their `completed_at`, beside a `needs.test.result` of
 * `success`. Those readings are the card's and the log's, taken by hand.
 * The cases below replay the worst position for that staleness: the 6 min 22 s
 * starting at the gate's own first read.
 */
const RECORDED_STALENESS_MS = 6 * 60_000 + 22_000;
const STALE = ['Test (shard 7/16)', 'Test (shard 12/16)'];

function staleRun() {
  return [
    ...shardContexts(16).map((name, i) =>
      STALE.includes(name)
        ? { id: 7000 + i, name, status: 'in_progress', conclusion: null, run_attempt: 1 }
        : { id: 7000 + i, name, status: 'completed', conclusion: 'success', run_attempt: 1 },
    ),
    { id: 7999, name: 'Test', status: 'in_progress', conclusion: null, run_attempt: 1 },
  ];
}

/** `settleReading` over a virtual clock: `answer` sees the time each re-read is taken at. */
function settleStale(rollup: string | null, answer: (job: Record<string, unknown>, at: number) => unknown, jobs: unknown[] = staleRun()) {
  let clock = 0;
  const slept: number[] = [];
  const logged: string[] = [];
  const byId = new Map((jobs as Record<string, unknown>[]).map((job) => [job.id as number, job]));
  const result = settleReading({
    jobs,
    shards: 16,
    selfJobName: 'Test',
    rollup,
    rereadJob: async (jobId: number) => answer(byId.get(jobId)!, clock),
    sleep: async (ms: number) => {
      slept.push(ms);
      clock += ms;
    },
    now: () => clock,
    deadline: GATE_BUDGET_MS,
    log: (line: string) => {
      logged.push(line);
    },
  });
  return { result, slept, logged, elapsed: () => clock };
}

const settlesAt = (ms: number) => (job: Record<string, unknown>, at: number) =>
  at >= ms ? { ...job, status: 'completed', conclusion: 'success' } : { ...job, completed_at: '2026-10-19T16:38:37Z' };

describe('check-test-shard-results — staleness past the first re-read bound (objectui#13064)', () => {
  it('⭐ shards still in_progress past the first bound settle inside the extension while the rollup reads success', async () => {
    const s = settleStale('success', settlesAt(RECORDED_STALENESS_MS));
    const { reading, rereads, stale } = await s.result;

    expect(reading.verdict).toBe('intact');
    expect(exitCodeFor(reading)).toBe(EXIT_OK);
    expect(rereads).toBeGreaterThan(REREAD_LIMIT);
    expect(stale).toBe(rereads - REREAD_LIMIT);
    expect(s.elapsed()).toBeGreaterThanOrEqual(RECORDED_STALENESS_MS);
  });

  it('⛔ without a success rollup the same answer stays red after the first bound', async () => {
    for (const rollup of [null, 'failure', 'cancelled', 'skipped']) {
      const s = settleStale(rollup, settlesAt(RECORDED_STALENESS_MS));
      const { reading, rereads, stale } = await s.result;
      expect(reading.verdict, `rollup ${String(rollup)}`).toBe('breached');
      expect(rereads).toBe(REREAD_LIMIT);
      expect(stale).toBe(0);
    }
  });

  it('⛔ the rollup never passes a shard: one that never answers stays red, `completed_at` and all', async () => {
    // Every re-read answers in_progress with a `completed_at`: that is not a conclusion.
    const s = settleStale('success', settlesAt(Number.POSITIVE_INFINITY));
    const { reading, rereads, stale } = await s.result;

    expect(reading.verdict).toBe('breached');
    expect(exitCodeFor(reading)).toBe(EXIT_BREACHED);
    expect(reading.notSuccess).toEqual(STALE.map((name) => `${name} (no conclusion)`));
    expect(rereads).toBe(REREAD_LIMIT + STALE_REREAD_LIMIT);
    expect(stale).toBe(STALE_REREAD_LIMIT);
    expect(s.elapsed()).toBeLessThanOrEqual(GATE_BUDGET_MS);
  });

  it('⛔ no extension once anything but a missing conclusion disagrees', async () => {
    const failing = staleRun().map((job) => (job.name === 'Test (shard 3/16)' ? { ...job, conclusion: 'failure' } : job));
    const s = settleStale('success', settlesAt(Number.POSITIVE_INFINITY), failing);
    const { reading, rereads, stale } = await s.result;
    expect(reading.verdict).toBe('breached');
    expect(rereads).toBe(REREAD_LIMIT);
    expect(stale).toBe(0);

    // A late shard that turns out to have FAILED ends the extension at once.
    const turns = settleStale('success', (job, at) =>
      at > REREAD_LIMIT * REREAD_WAIT_MS ? { ...job, status: 'completed', conclusion: 'failure' } : job,
    );
    const late = await turns.result;
    expect(late.reading.verdict).toBe('breached');
    expect(late.stale).toBe(1);
  });

  it('⛔ no re-read starts that the gate budget cannot finish', async () => {
    let clock = 0;
    const logged: string[] = [];
    const { reading, rereads, budgetSpent } = await settleReading({
      jobs: staleRun(),
      shards: 16,
      selfJobName: 'Test',
      rollup: 'success',
      rereadJob: async (jobId: number) => staleRun().find((job) => job.id === jobId),
      sleep: async (ms: number) => {
        clock += ms;
      },
      now: () => clock,
      // Room for two first-stretch re-reads and their requests, not a third.
      deadline: 3 * REREAD_WAIT_MS + REQUEST_TIMEOUT_MS - 1,
      log: (line: string) => {
        logged.push(line);
      },
    });

    expect(rereads).toBe(2);
    expect(budgetSpent).toBe(true);
    expect(reading.verdict).toBe('breached');
    expect(logged.at(-1)).toContain("gate's budget");
  });

  it('run reads the rollup from TEST_MATRIX_ROLLUP, the name ci.yml hands it in under', async () => {
    const stale = 'Test (shard 6/8)';
    const replay = (rollup: string | undefined) =>
      gate(
        (url, call) =>
          url.includes('/attempts/')
            ? jobsPage(attemptJobs(1, (name) => (name === stale ? null : 'success')))
            : call > REREAD_LIMIT + 2
              ? json({ id: 1005, name: stale, status: 'completed', conclusion: 'success', run_attempt: 1, html_url: jobUrl(1005) })
              : json({ id: 1005, name: stale, status: 'in_progress', conclusion: null, run_attempt: 1, html_url: jobUrl(1005) }),
        { TEST_MATRIX_ROLLUP: rollup },
      );

    expect(await replay('success').result).toBe(EXIT_OK);
    expect(await replay(undefined).result).toBe(EXIT_BREACHED);
  });
});

/**
 * objectui#13327 — merge-group run 39812942829, replayed through `run`.
 *
 * Its job log printed seven of sixteen shards with no conclusion, status
 * `in_progress`, at the first read and at every one of the seventeen re-reads,
 * until the budget ended them, beside a `needs.test.result` of `success`; the
 * same jobs read `success` afterwards. That reading is the card's and the
 * log's, taken by hand. The replay below is its worst form: the jobs API never
 * settles at all, so whatever turns the run green is the check run speaking.
 */
const LAGGED = ['Test (shard 4/16)', 'Test (shard 5/16)', 'Test (shard 6/16)', 'Test (shard 7/16)', 'Test (shard 12/16)', 'Test (shard 13/16)', 'Test (shard 16/16)'];
const OWN_JOB = 1999;
const idOf = (name: string) => 1000 + shardContexts(16).indexOf(name);
const singleJobId = (url: string) => Number(/\/actions\/jobs\/(\d+)$/.exec(url)?.[1] ?? Number.NaN);

/** The jobs API as that run's gate read it: the lagged shards `in_progress` on the list and on every re-read. */
function lagging(conclusionOf: (name: string) => string | null | undefined = (name) => (LAGGED.includes(name) ? null : 'success')) {
  return (url: string) => {
    if (url.includes('/attempts/')) return jobsPage(attemptJobs(1, conclusionOf, 16));
    const id = singleJobId(url);
    return json({ id, name: nameOf(id, 16), status: 'in_progress', conclusion: null, run_attempt: 1, html_url: jobUrl(id) });
  };
}

const replayLag = (checkRun: (id: number, call: number) => Answer, conclusionOf?: (name: string) => string | null | undefined) =>
  gate(lagging(conclusionOf), { TEST_MATRIX_ROLLUP: 'success' }, 16, checkRun);

describe('check-test-shard-results — a shard the jobs API serves without a conclusion is asked of its own check run (objectui#13327)', () => {
  it('⭐ the recorded false red passes when each lagged shard’s own check run reads success, before any wait', async () => {
    const g = replayLag((id) => checkRunOf(id, id === OWN_JOB ? null : 'success', 16));

    expect(await g.result).toBe(EXIT_OK);
    expect(g.slept, 'the check run answers at once; nothing waits').toEqual([]);
    expect(g.checkRunUrls.map(checkRunId)).toEqual([OWN_JOB, ...LAGGED.map(idOf)]);
    const printed = g.out.join('\n');
    expect(printed).toContain('all 16 shards reported success');
    for (const name of LAGGED) {
      expect(printed).toContain(`success  ${name}  (from its own check run; the jobs API served no conclusion)`);
    }
    // The shards the jobs API answered are not marked: their conclusion is its own.
    expect(printed).toContain('success  Test (shard 1/16)\n');
  });

  it('⛔ the control: the same replay, with check runs that have no conclusion either, stays red after the budget', async () => {
    const g = replayLag((id) => checkRunOf(id, null, 16));

    expect(await g.result).toBe(EXIT_BREACHED);
    expect(g.elapsed()).toBeLessThanOrEqual(GATE_BUDGET_MS);
    const printed = g.out.join('\n');
    for (const name of LAGGED) expect(printed).toContain(`no conclusion (status in_progress)  ${name}`);
    // Asked once before the first wait and again after every re-read, never past the budget.
    const asked = g.checkRunUrls.filter((url) => checkRunId(url) === idOf(LAGGED[0])).length;
    expect(asked).toBe(REREAD_LIMIT + STALE_REREAD_LIMIT + 1);
  });

  it('⛔ a check run that answers anything but success is that, and red at once', async () => {
    for (const conclusion of ['failure', 'cancelled', 'skipped', 'timed_out']) {
      const g = replayLag((id) => checkRunOf(id, id === idOf('Test (shard 5/16)') ? conclusion : id === OWN_JOB ? null : 'success', 16));

      expect(await g.result, `a ${conclusion} check run`).toBe(EXIT_BREACHED);
      expect(g.slept, 'an answer is never waited out').toEqual([]);
      expect(g.out.join('\n')).toContain(`did not report success: Test (shard 5/16) (${conclusion})`);
    }
  });

  it('⛔ an answer the jobs API gave is never replaced: a `failure` there stays red whatever its check run says', async () => {
    const g = replayLag(
      (id) => checkRunOf(id, id === OWN_JOB ? null : 'success', 16),
      (name) => (name === 'Test (shard 3/16)' ? 'failure' : LAGGED.includes(name) ? null : 'success'),
    );

    expect(await g.result).toBe(EXIT_BREACHED);
    expect(g.checkRunUrls.map(checkRunId), 'only shards with no conclusion are asked').not.toContain(idOf('Test (shard 3/16)'));
    expect(g.out.join('\n')).toContain('Test (shard 3/16) (failure)');
  });

  it('⛔ an absent shard is not asked, and stays ABSENT', async () => {
    const g = replayLag(
      (id) => checkRunOf(id, id === OWN_JOB ? null : 'success', 16),
      (name) => (name === 'Test (shard 9/16)' ? undefined : LAGGED.includes(name) ? null : 'success'),
    );

    expect(await g.result).toBe(EXIT_BREACHED);
    expect(g.checkRunUrls.map(checkRunId)).not.toContain(idOf('Test (shard 9/16)'));
    expect(g.out.join('\n')).toContain('ABSENT  Test (shard 9/16)');
  });

  it('⛔ a check run that is not the job’s own — another id, name, app or page — is refused: exit 2, never a pass', async () => {
    const lagged = idOf('Test (shard 4/16)');
    const own = (id: number) => ({
      id,
      name: nameOf(id, 16),
      status: 'completed',
      conclusion: 'success',
      app: { slug: ACTIONS_CHECK_RUN_APP },
      html_url: jobUrl(id),
    });
    for (const [what, change] of [
      ['id', { id: lagged + 1 }],
      ['name', { name: 'Test (shard 5/16)' }],
      ['app', { app: { slug: 'some-other-app' } }],
      ['page', { html_url: jobUrl(lagged + 1) }],
    ] as const) {
      const g = replayLag((id) => (id === OWN_JOB ? checkRunOf(id, null, 16) : json(id === lagged ? { ...own(id), ...change } : own(id))));

      expect(await g.result, `another ${what}`).toBe(EXIT_CANNOT_RUN);
      expect(g.err.join('\n')).toContain("which is not that job's own");
      expect(g.out.join('\n')).not.toContain('reported success');
    }
  });

  it('⛔ a re-run shard is asked by its own attempt’s job id, and the attempt before it cannot stand in', async () => {
    // Attempt 2 re-ran shard 3 and lists it without a conclusion yet.
    const shard = 'Test (shard 3/8)';
    const rerun = 2000 + shardContexts(8).indexOf(shard);
    const before = 1000 + shardContexts(8).indexOf(shard);
    const answer = (url: string) => {
      if (url.includes('/attempts/2/')) return jobsPage(attemptJobs(2, (name) => (name === shard ? null : undefined)));
      if (url.includes('/attempts/1/')) return jobsPage(attemptJobs(1));
      return json({ id: rerun, name: shard, status: 'in_progress', conclusion: null, run_attempt: 2, html_url: jobUrl(rerun) });
    };

    // Its own check run says success: green, asked by the attempt-2 id.
    const good = gate(answer, { GITHUB_RUN_ATTEMPT: '2' }, 8, (id) => checkRunOf(id, id === 2999 ? null : 'success'));
    expect(await good.result).toBe(EXIT_OK);
    expect(good.checkRunUrls.map(checkRunId)).toEqual([2999, rerun]);

    // The Checks API answering with attempt 1's check run of the same shard is refused.
    const stale = gate(answer, { GITHUB_RUN_ATTEMPT: '2' }, 8, (id) => (id === 2999 ? checkRunOf(id) : checkRunOf(before, 'success')));
    expect(await stale.result).toBe(EXIT_CANNOT_RUN);
    expect(stale.err.join('\n')).toContain("which is not that job's own");
  });

  it('⛔ a check run that cannot be read is a request like any other: 4xx exit 2 at once, 5xx retried, then exit 2', async () => {
    for (const status of [403, 404]) {
      const g = replayLag((id) => (id === OWN_JOB ? checkRunOf(id, null, 16) : json({ message: 'no' }, status)));
      expect(await g.result, `HTTP ${status}`).toBe(EXIT_CANNOT_RUN);
      expect(g.checkRunUrls, `HTTP ${status} must not be retried`).toHaveLength(2);
      expect(g.slept).toEqual([]);
    }

    const persistent = replayLag((id) => (id === OWN_JOB ? checkRunOf(id, null, 16) : json({ message: 'Bad Gateway' }, 502)));
    expect(await persistent.result).toBe(EXIT_CANNOT_RUN);
    expect(persistent.slept).toEqual(Array.from({ length: TRANSIENT_RETRY_LIMIT }, () => TRANSIENT_RETRY_WAIT_MS));
    expect(persistent.err.join('\n')).toContain('HTTP 502');

    const once = replayLag((id, call) =>
      id === OWN_JOB ? checkRunOf(id, null, 16) : call === 2 ? json({ message: 'Bad Gateway' }, 502) : checkRunOf(id, 'success', 16),
    );
    expect(await once.result).toBe(EXIT_OK);
    expect(once.slept).toEqual([TRANSIENT_RETRY_WAIT_MS]);
  });

  it('asks the Checks API for the job by its id', async () => {
    const urls: string[] = [];
    const fetchImpl = (async (url: string | URL | Request) => {
      urls.push(String(url));
      return checkRunOf(1003);
    }) as typeof fetch;

    await fetchCheckRun(1003, { repository: REPO, apiUrl: API, token: 't', fetchImpl });
    expect(urls).toEqual([`${API}/repos/${REPO}/check-runs/1003`]);
  });

  it('never replaces a conclusion, keeps a record its check run cannot conclude, and refuses a record with no page to compare', async () => {
    const id = 1003;
    const record = { id, name: nameOf(id), status: 'in_progress', conclusion: null, html_url: jobUrl(id) };
    const answered = { ...record, status: 'completed', conclusion: 'failure' };
    const said = async (conclusion: string | null) => (await checkRunOf(id, conclusion).json()) as unknown;

    expect(concludeFromCheckRun(answered, await said('success'))).toBe(answered);
    expect(concludeFromCheckRun(record, await said(null))).toBe(record);
    expect(concludeFromCheckRun(record, await said('success'))).toMatchObject({ conclusion: 'success', conclusion_from: 'check-run' });

    const withoutPage: Record<string, unknown> = { ...record };
    delete withoutPage.html_url;
    const pageless = { ...((await said('success')) as object), html_url: undefined };
    expect(() => concludeFromCheckRun(withoutPage, pageless)).toThrow(/not that job's own/);
  });

  it('starts no check-run read that the gate budget cannot finish', async () => {
    const asked: number[] = [];
    const logged: string[] = [];
    const jobs = attemptJobs(1, (name) => (name === 'Test (shard 6/8)' ? null : 'success'));
    const { reading, budgetSpent } = await settleReading({
      jobs,
      shards: 8,
      selfJobName: 'Test',
      rereadJob: async () => {
        throw new Error('no re-read fits either');
      },
      readCheckRun: async (jobId: number) => {
        asked.push(jobId);
        return checkRunOf(jobId, 'success').json();
      },
      sleep: async () => {},
      now: () => 0,
      deadline: REQUEST_TIMEOUT_MS - 1,
      log: (line: string) => {
        logged.push(line);
      },
    });

    expect(asked).toEqual([]);
    expect(budgetSpent).toBe(true);
    expect(reading.verdict).toBe('breached');
    expect(logged[0]).toContain("not asking the check runs");
  });
});

describe('check-test-shard-results — the check-run reader is walked on every run (objectui#13327)', () => {
  it('⭐ an all-green run reads this job’s own check run once, and nothing else', async () => {
    const g = gate(() => jobsPage(attemptJobs(1)));

    expect(await g.result).toBe(EXIT_OK);
    expect(g.checkRunUrls.map(checkRunId)).toEqual([999 + 1000]);
    expect(g.out.join('\n')).toContain('the check-run reader answers');
  });

  it('⛔ a check-run reader that cannot read is red on every run, not only in the next lag', async () => {
    for (const status of [403, 404]) {
      const g = gate(() => jobsPage(attemptJobs(1)), {}, 8, () => json({ message: 'Resource not accessible by integration' }, status));
      expect(await g.result, `HTTP ${status}`).toBe(EXIT_CANNOT_RUN);
      expect(g.err.join('\n')).toContain("could not read this job's own check run");
      expect(g.out.join('\n')).not.toContain('reported success');
    }
  });

  it('⛔ refuses an own check run that is not this job’s', async () => {
    const g = gate(() => jobsPage(attemptJobs(1)), {}, 8, () => checkRunOf(1003));
    expect(await g.result).toBe(EXIT_CANNOT_RUN);
    expect(g.err.join('\n')).toContain("which is not that job's own");
  });

  it('does not read it over a job list this job is not in: that reading is `unreadable` already', async () => {
    const g = gate(() => jobsPage(attemptJobs(1).filter((job) => job.name !== 'Test')));
    expect(await g.result).toBe(EXIT_CANNOT_RUN);
    expect(g.checkRunUrls).toEqual([]);
  });

  it('reads no check run at all over a recorded fixture', async () => {
    const asked: string[] = [];
    const out: string[] = [];
    const code = await run(
      ['--shards', '8', '--fixture', path.join(repoRoot, 'scripts/__tests__/fixtures/test-shard-results/run-36042402511-attempt-1.json')],
      {
        env: {},
        fetchImpl: (async (url: string | URL | Request) => {
          asked.push(String(url));
          throw new Error('a fixture run must not reach the network');
        }) as typeof fetch,
        out: (line: string) => {
          out.push(line);
        },
        err: () => {},
      },
    );

    expect(code).toBe(EXIT_OK);
    expect(asked).toEqual([]);
  });
});

describe('ci.yml wires the gate to its own matrix (#9499)', () => {
  /** The `test-aggregate` job block, comments stripped. */
  const aggregate = (() => {
    const body = ciYaml.slice(ciYaml.search(/^jobs:[ \t]*$/m));
    const at = body.search(/^ {2}test-aggregate:[ \t]*$/m);
    expect(at, 'ci.yml must still define a `test-aggregate:` job').toBeGreaterThan(-1);
    const rest = body.slice(at + 1);
    const next = rest.search(/^ {2}\S/m);
    return (next === -1 ? rest : rest.slice(0, next))
      .split('\n')
      .filter((line) => !/^\s*#/.test(line))
      .join('\n');
  })();

  it('passes the gate the width ci.yml actually runs', () => {
    // The one number this script does not derive. Pinning it here is what keeps
    // the matrix and the `--shards` argument from drifting apart silently —
    // locally and loudly, which is the difference from the repository-settings
    // surface the shard count used to be welded to.
    const declared = ciYaml.match(/^ {8}shard: \[([^\]]+)\]/m);
    expect(declared, 'ci.yml must still declare a `shard:` matrix').toBeTruthy();
    const width = declared![1].split(',').filter((s) => s.trim()).length;

    const passed = aggregate.match(/check-test-shard-results\.mjs --shards (\d+)/);
    expect(passed, '`test-aggregate` must still run the shard-results gate').toBeTruthy();
    expect(Number(passed![1]), 'the --shards argument and ci.yml\'s matrix have drifted apart').toBe(width);
  });

  it('tells the gate the name of the job it is running in', () => {
    // The gate refuses any verdict over a job list not containing this name, so
    // a wrong value here fails closed (exit 2, red) rather than vacuously green.
    const name = aggregate.match(/^ {4}name: (.+)$/m);
    expect(name, '`test-aggregate` must declare a `name:`').toBeTruthy();
    expect(aggregate).toContain(`--job-name '${name![1].trim()}'`);
  });

  it('needs every job whose result it speaks for, and reports whatever they did', () => {
    expect(aggregate).toMatch(/^ {4}needs: \[test, test-dist-pins\]$/m);
    // `always()` — without it a red or skipped shard SKIPS this job, and a
    // skipped required context counts as SUCCESS in branch protection. No
    // event guard since objectui#12214: on `push` and `schedule` this is the
    // full battery's test verdict, read the same way.
    expect(aggregate).toMatch(/^ {4}if: always\(\)$/m);
    // `actions: read` is what the API read needs; a `permissions:` block sets
    // every unlisted scope to `none`, so its absence is a 403 and exit 2.
    expect(aggregate).toMatch(/^ {6}actions: read$/m);
  });

  it('keeps the re-read bound inside the job\'s own budget (objectui#10931)', () => {
    // The worst case is every re-read spent on a shard that never answers. It
    // must leave at least half of `timeout-minutes` for the checkout, the
    // reads themselves and the dist-pin step: a job killed by its timeout
    // reports `cancelled`, which the merge queue reads as a failure.
    const timeout = aggregate.match(/^ {4}timeout-minutes: (\d+)$/m);
    expect(timeout, '`test-aggregate` must declare its own `timeout-minutes`').toBeTruthy();
    expect(REREAD_LIMIT).toBeGreaterThan(0);
    expect(REREAD_LIMIT * REREAD_WAIT_MS).toBeLessThanOrEqual((Number(timeout![1]) * 60_000) / 2);
  });

  it('keeps the whole gate inside the job, with room for the steps around it (objectui#13064)', () => {
    // `GATE_BUDGET_MS` bounds every retry and re-read, and each request is cut
    // to what is left of it, so it is the gate step's worst case. After it,
    // the report-only headroom step makes one `fetchRunJobs()` read with no
    // retry, bounded by `REQUEST_TIMEOUT_MS`. The two minutes are for set-up,
    // checkout and post steps (the three runs the card records spent about
    // ten seconds on them, read by hand once and not re-derived here). Past
    // `timeout-minutes` the job reports `cancelled`, which the merge queue
    // reads exactly as it reads a red.
    const timeout = aggregate.match(/^ {4}timeout-minutes: (\d+)$/m);
    expect(timeout, '`test-aggregate` must declare its own `timeout-minutes`').toBeTruthy();
    const job = Number(timeout![1]) * 60_000;
    expect(GATE_BUDGET_MS + REQUEST_TIMEOUT_MS + 2 * 60_000).toBeLessThanOrEqual(job);
  });

  it('sizes the two re-read stretches against the recorded staleness and the gate budget (objectui#13064)', () => {
    const sleeps = REREAD_LIMIT * REREAD_WAIT_MS + STALE_REREAD_LIMIT * STALE_REREAD_WAIT_MS;
    // Long enough for the 6 min 22 s run 39286083342 recorded, even starting
    // at the gate's own first read…
    expect(sleeps).toBeGreaterThanOrEqual(RECORDED_STALENESS_MS);
    // …and short enough that the last stretch's wait and request still fit.
    expect(sleeps + REQUEST_TIMEOUT_MS).toBeLessThanOrEqual(GATE_BUDGET_MS);
    expect(STALE_REREAD_WAIT_MS).toBeGreaterThanOrEqual(REREAD_WAIT_MS);
    // A transient retry's whole stretch fits too, with its requests.
    expect(TRANSIENT_RETRY_LIMIT * TRANSIENT_RETRY_WAIT_MS + (TRANSIENT_RETRY_LIMIT + 1) * REQUEST_TIMEOUT_MS).toBeLessThan(GATE_BUDGET_MS);
  });

  it('hands the gate the matrix rollup under the name it reads (objectui#13064)', () => {
    // The gate reads it only to decide whether to wait longer. Pinned so that
    // renaming it in ci.yml cannot silently switch the extension off.
    expect(aggregate).toMatch(/^ {10}TEST_MATRIX_ROLLUP: \$\{\{ needs\.test\.result \}\}$/m);
  });

  it('asserts the dist-pin job too, so nothing in the lane is left ungated', () => {
    expect(aggregate).toContain('needs.test-dist-pins.result');
    expect(aggregate).toMatch(/!= 'success'/);
  });
});
