import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  NOT_A_GATE,
  main,
  OPTIONAL_CONTEXTS,
  REQUIRED_CONTEXTS,
  evaluateGate,
  latestByName,
  renderVerdict,
  waitForGate,
} from '../dependabot-merge-gate.mjs';
import {
  type Workflow,
  producedCheckNames,
  pullRequestTrigger,
  readWorkflows,
} from './workflow-checks.js';

/**
 * objectui#4973 — `dependabot-auto-merge.yml` merged a pull request 8m20s before
 * its own test shard reported `failure`.
 *
 * `gh pr merge --auto --squash` was run unconditionally for every semver-patch
 * and semver-minor bump. `--auto` lands the merge the moment GitHub considers
 * the pull request mergeable — the moment the BRANCH-PROTECTION required set is
 * satisfied — which is a different set from "the checks this repository runs".
 * On 2026-08-17 #4959 (`lucide-react` 1.29.0 -> 1.31.0) was red on its own head
 * SHA `31745d8b` and merged anyway; `main` went red for every parallel agent and
 * #4968 had to repair it. It was the second time in seven days (#4098 was the
 * same test and the same dependency).
 *
 * ## Why the #4959 timeline is a FIXTURE here
 *
 * A workflow cannot be executed locally, so the usual way to argue about one is
 * a prose walkthrough in the pull-request body — which proves nothing later.
 * The decision therefore lives in `scripts/dependabot-merge-gate.mjs`, and the
 * measured check-run timeline of the incident lives below, so the central claim
 * of the fix is an assertion instead of a paragraph:
 *
 *   at 08:13:36Z, the second the old workflow merged #4959, this gate says
 *   `pending` -> nothing is merged;
 *   at 08:21:01Z, when shard 3/4 reports, it says `red` -> nothing is merged.
 *
 * Every field in `INCIDENT_4959` is copied from the check runs GitHub still has
 * for that SHA (19 runs; `started_at` / `completed_at` / `conclusion` verbatim).
 * `snapshotAt()` reconstructs what the API would have returned at any instant,
 * the same way the gate reads it.
 *
 * ## The other half: the buckets have to stay honest
 *
 * A declared required set is a second source of truth about which checks exist,
 * and the failure mode of a stale one is silence — a renamed job simply stops
 * being waited for, and the gate goes green a little earlier every time. So the
 * three buckets are asserted to PARTITION the set of check names that
 * `pull_request`-triggered workflows actually produce: nothing produced may be
 * unclassified, nothing classified may be unproduced. That is the assertion a
 * new `ci.yml` job or a renamed shard trips.
 *
 * The buckets' *reasons* are pinned too, not just their membership: every
 * required context must come from a workflow whose `pull_request` trigger has no
 * path filter (the #3523 rule — only an unfiltered gate reports on every pull
 * request and can therefore be waited for), and every optional context must come
 * from one that has such a filter (which is the entire reason it cannot be
 * required). Move a filter and the bucket, not just the comment, goes red.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const workflowDir = path.join(repoRoot, '.github', 'workflows');

// ── The incident, as GitHub recorded it ──────────────────────────────────────
// PR #4959, head SHA 31745d8b6805dc829c05660a9592e92ca537bc3b, merged by
// github-actions[bot] at 2026-08-17T08:13:36Z.
const MERGED_AT = '2026-08-17T08:13:36Z';

const INCIDENT_4959 = [
  { name: 'Test (coverage)', started: '08:13:05Z', completed: '08:13:05Z', conclusion: 'skipped' },
  { name: 'Skill Guide Path Check', started: '08:13:07Z', completed: '08:13:17Z', conclusion: 'success' },
  { name: 'Test (shard 2/4)', started: '08:13:07Z', completed: '08:22:08Z', conclusion: 'success' },
  { name: 'Test (shard 4/4)', started: '08:13:07Z', completed: '08:18:55Z', conclusion: 'success' },
  { name: 'Bundle Analysis', started: '08:13:07Z', completed: '08:17:12Z', conclusion: 'success' },
  { name: 'Test (shard 3/4)', started: '08:13:07Z', completed: '08:21:01Z', conclusion: 'failure' },
  { name: 'Build & E2E', started: '08:13:07Z', completed: '08:16:51Z', conclusion: 'success' },
  { name: 'Test (shard 1/4)', started: '08:13:07Z', completed: '08:21:56Z', conclusion: 'failure' },
  { name: 'Changeset Fixed Group Check', started: '08:13:08Z', completed: '08:13:16Z', conclusion: 'success' },
  { name: 'Type Check', started: '08:13:07Z', completed: '08:22:33Z', conclusion: 'success' },
  { name: 'Live E2E (informational)', started: '08:13:07Z', completed: '08:15:13Z', conclusion: 'success' },
  { name: 'Build Docs', started: '08:13:08Z', completed: '08:18:46Z', conclusion: 'success' },
  { name: 'Control Byte Scan', started: '08:13:07Z', completed: '08:13:17Z', conclusion: 'success' },
  { name: 'Internal Docs Link Check', started: '08:13:07Z', completed: '08:13:13Z', conclusion: 'success' },
  { name: 'Changeset Declaration', started: '08:13:07Z', completed: '08:13:18Z', conclusion: 'success' },
  { name: 'Lint', started: '08:13:07Z', completed: '08:17:13Z', conclusion: 'success' },
  { name: 'Doc Component Type Check', started: '08:13:07Z', completed: '08:13:15Z', conclusion: 'success' },
  { name: 'dependabot', started: '08:13:07Z', completed: '08:13:30Z', conclusion: 'success' },
  { name: 'label', started: '08:13:07Z', completed: '08:13:15Z', conclusion: 'success' },
] as const;

const at = (hms: string) => Date.parse(`2026-08-17T${hms}`);

/** What `GET /commits/{sha}/check-runs` would have returned at one instant. */
function snapshotAt(instant: string) {
  const t = Date.parse(instant);
  return INCIDENT_4959.map((run, index) => {
    const id = 95_325_240_000 + index;
    if (at(run.completed) <= t) return { id, name: run.name, status: 'completed', conclusion: run.conclusion };
    if (at(run.started) <= t) return { id, name: run.name, status: 'in_progress', conclusion: null };
    return { id, name: run.name, status: 'queued', conclusion: null };
  });
}

/**
 * The shape the gate is allowed to merge: the incident's 19 names, all green,
 * plus every required context added to the repository SINCE that SHA.
 *
 * The second half is not padding. `INCIDENT_4959` is a verbatim record of what
 * the API returned for one commit in August 2026 and must never grow — but a
 * required set that has grown since means "all green" is no longer that record.
 * Building the all-green shape from the record ALONE would make every gate added
 * after it look permanently `pending` here, and the natural repair — adding the
 * new name to the incident record — falsifies the history the counterfactual
 * rests on. So the record stays frozen and the additions are appended.
 */
function allGreenSnapshot() {
  const fromIncident = INCIDENT_4959.map((run, index) => ({
    id: 95_325_240_000 + index,
    name: run.name,
    status: 'completed',
    conclusion: run.name === 'Test (coverage)' ? 'skipped' : 'success',
  }));
  const addedSince = REQUIRED_CONTEXTS.filter(
    (name) => !INCIDENT_4959.some((run) => run.name === name),
  ).map((name, index) => ({
    id: 95_325_260_000 + index,
    name,
    status: 'completed',
    conclusion: 'success',
  }));
  return [...fromIncident, ...addedSince];
}

/**
 * Names `INCIDENT_4959` recorded that this repository no longer produces.
 *
 * objectui#9499 replaced the four `Test (shard N/4)` contexts with ONE
 * aggregator context, `Test`, and widened the matrix to eight legs whose names
 * nothing waits for individually. Two rules meet here and neither may bend: the
 * incident record is a verbatim August-2026 reading and must never be edited,
 * and the gate's buckets may not name a context no pull-request workflow
 * produces (the partition assertion below). So the reconciliation is this one
 * dated list, read by exactly one assertion.
 *
 * ⛔ It is not an escape hatch. The control beneath that assertion re-derives
 * the produced set and fails if any name here IS still produced, so a live
 * unclassified context cannot be parked in it.
 */
const RENAMED_SINCE_4959 = [
  'Test (shard 1/4)',
  'Test (shard 2/4)',
  'Test (shard 3/4)',
  'Test (shard 4/4)',
  // objectui#12214 folded the one-check gate workflows into `repo-gates.yml`:
  // these four are STEP names of the one `Repo Gates` context now, and no
  // workflow produces a check run by these names any more.
  'Skill Guide Path Check',
  'Control Byte Scan',
  'Internal Docs Link Check',
  'Doc Component Type Check',
];

/**
 * The incident's runs plus the ONE context that speaks for the shards today.
 *
 * The record stays frozen; the aggregator is appended, exactly as
 * `allGreenSnapshot` appends the contexts added since. Its position in time is
 * not free either: `ci.yml`'s `test-aggregate` job `needs` every shard, so the
 * earliest instant it can report is after the last shard completes — 08:22:33Z
 * on this run, ten minutes after the merge that #4959 is about.
 */
function withAggregator(
  runs: ReturnType<typeof snapshotAt>,
  conclusion: string,
): { id: number; name: string; status: string; conclusion: string | null }[] {
  return [...runs, { id: 95_325_280_000, name: 'Test', status: 'completed', conclusion }];
}

describe('the #4959 counterfactual: this gate stops the merge that happened', () => {
  it('is PENDING at 08:13:36Z — the instant the old workflow merged #4959', () => {
    const result = evaluateGate({ checkRuns: snapshotAt(MERGED_AT) });

    expect(result.verdict).toBe('pending');
    // Nothing is merged on `pending`; the workflow's merge step is behind
    // `gate == 'green'` and nothing else.
    expect(result.verdict).not.toBe('green');

    // Five contexts were still running when the merge landed and are still
    // required by name today: these four plus `Bundle Analysis`, which is
    // optional-if-present and was also in flight. The exact count is asserted so
    // a fixture edit cannot quietly weaken the case.
    //
    // ⚠️ It was NINE until objectui#9499. The four `Test (shard N/4)` contexts
    // that made up the difference were not dropped from the case — they moved
    // from `pending` to `missing`, under the one name that replaced them: the
    // aggregator `Test` had not reported at that instant either, because it
    // cannot report until every shard has. `missing` and `pending` are both
    // not-green and both hold the merge; the assertion below says so rather
    // than letting the count drop stand for a weakened case.
    expect(result.pending).toHaveLength(5);
    expect(result.pending).toContain('Bundle Analysis (in_progress)');
    expect(result.pending).toEqual(
      expect.arrayContaining([
        'Type Check (in_progress)',
        'Build & E2E (in_progress)',
        'Build Docs (in_progress)',
        'Lint (in_progress)',
      ]),
    );
    expect(
      result.missing,
      'the one required test context had not reported when #4959 merged either',
    ).toContain('Test');

    // And nothing had failed YET. This is why no configuration that only looks
    // at *reported* checks could have caught it, and why the fix has to be a
    // wait rather than a stricter reading of what had already reported.
    expect(result.failing).toEqual([]);
    for (const run of snapshotAt(MERGED_AT)) {
      if (run.status === 'completed') expect(['success', 'skipped']).toContain(run.conclusion);
    }
  });

  it('is still not green at 08:21:01Z — the aggregator cannot have reported yet', () => {
    // Shard 3 has just failed. Under the required set objectui#9499 installed
    // the gate is not reading shard names at all, and this is the instant that
    // shows why that is not a weakening: `Test` is MISSING, missing is not
    // green, and the merge is held exactly as it was when four shard names were
    // waited for.
    const result = evaluateGate({ checkRuns: snapshotAt('2026-08-17T08:21:01Z') });

    expect(result.verdict).not.toBe('green');
    expect(result.missing).toContain('Test');
  });

  it('turns RED when the aggregator reports the shards it waited for', () => {
    // 08:22:33Z is the last completion in the record, so it is the earliest
    // instant `test-aggregate` could run: it `needs` every shard. Two of them
    // failed, so the aggregator's own conclusion is `failure`.
    //
    // ⚠️ THE OLD WARNING HERE, and why it does not apply to this shape. This
    // case used to end "a gate that waited for `Test` as one name, or for
    // whichever shard reported first, would have merged this pull request".
    // That is true of a single check PRODUCED BY a shard — it reports while its
    // siblings are still running, and shards 2 and 4 passed. It is not true of
    // `ci.yml`'s `test-aggregate`, which has a `needs:` edge to every leg and
    // therefore cannot report before the last of them, and which is red unless
    // each leg's OWN conclusion is `success`. The two assertions below are that
    // difference, stated as behaviour rather than as an argument.
    const finished = snapshotAt('2026-08-17T08:22:33Z');
    const result = evaluateGate({ checkRuns: withAggregator(finished, 'failure') });

    expect(result.verdict).toBe('red');
    expect(result.failing).toContain('Test (failure)');

    // The control, in the same command: the SAME snapshot with the SAME two
    // failed shards is GREEN when the aggregator says `success` — so the red
    // above is the aggregator speaking, not a residual shard name still being
    // read somewhere.
    const lying = evaluateGate({ checkRuns: withAggregator(finished, 'success') });
    expect(lying.failing).toEqual([]);
    expect(lying.failing.join()).not.toContain('shard');
  });

  it('refuses an aggregator that reported `skipped` — the objectui#9499 acceptance', () => {
    // A required context that is `skipped` counts as SUCCESS in branch
    // protection, which is why the aggregator must never be able to skip; this
    // gate reads the conclusion itself and refuses it here too.
    const runs = allGreenSnapshot().map((run) =>
      run.name === 'Test' ? { ...run, conclusion: 'skipped' } : run,
    );
    const result = evaluateGate({ checkRuns: runs });

    expect(result.verdict).toBe('red');
    expect(result.failing).toEqual(['Test (skipped)']);
  });

  it('is green when the incident\'s contexts, and every one added since, all pass', () => {
    const result = evaluateGate({ checkRuns: allGreenSnapshot() });

    expect(result).toEqual({ verdict: 'green', failing: [], pending: [], missing: [] });
  });

  it('classifies every context the incident produced — no unknown name is ignored', () => {
    const classified = new Set([
      ...REQUIRED_CONTEXTS,
      ...Object.keys(OPTIONAL_CONTEXTS),
      ...Object.keys(NOT_A_GATE),
    ]);

    const produced = producedCheckNames();

    // The control for the exemption: a name may only sit in
    // `RENAMED_SINCE_4959` while the repository really has stopped producing
    // it. Without this, parking a live unclassified context in that list would
    // silently shrink the gate — the failure mode this whole file is about.
    for (const name of RENAMED_SINCE_4959) {
      expect(
        produced.has(name),
        `${name} is exempted as renamed-since-#4959, but a pull_request workflow still produces ` +
          `it — classify it in one of the three buckets instead of exempting it`,
      ).toBe(false);
    }

    for (const run of INCIDENT_4959) {
      if (RENAMED_SINCE_4959.includes(run.name)) continue;
      expect(classified).toContain(run.name);
    }
  });
});

describe('absence is never green (#3523 in mirror image)', () => {
  it('waits for a required context that has not reported at all', () => {
    const runs = allGreenSnapshot().filter((run) => run.name !== 'Test');
    const result = evaluateGate({ checkRuns: runs });

    expect(result.verdict).toBe('pending');
    expect(result.missing).toEqual(['Test']);
  });

  it('refuses a required context that reported `skipped`', () => {
    // `Repo Gates` since objectui#12214 folded `Control Byte Scan`, the context
    // this case used to skip, into it.
    const runs = allGreenSnapshot().map((run) =>
      run.name === 'Repo Gates' ? { ...run, conclusion: 'skipped' } : run,
    );
    const result = evaluateGate({ checkRuns: runs });

    expect(result.verdict).toBe('red');
    expect(result.failing).toEqual(['Repo Gates (skipped)']);
  });

  it('refuses `cancelled` and `timed_out` as well as `failure`', () => {
    for (const conclusion of ['cancelled', 'timed_out', 'action_required', 'neutral', 'stale']) {
      const runs = allGreenSnapshot().map((run) => (run.name === 'Lint' ? { ...run, conclusion } : run));
      expect(evaluateGate({ checkRuns: runs }).verdict).toBe('red');
    }
  });

  it('reads the newest run per name, so a re-run in flight is not green', () => {
    const runs = [
      ...allGreenSnapshot(),
      { id: 99_999_999_999, name: 'Type Check', status: 'queued', conclusion: null },
    ];

    expect(latestByName(runs).get('Type Check')?.status).toBe('queued');
    expect(evaluateGate({ checkRuns: runs }).verdict).toBe('pending');
  });

  it('holds an empty check-run list at pending, never at green', () => {
    const result = evaluateGate({ checkRuns: [] });

    expect(result.verdict).toBe('pending');
    expect(result.missing).toEqual([...REQUIRED_CONTEXTS]);
  });
});

describe('the path-filtered blocking checks (optional bucket)', () => {
  it('ignores one that did not report — its trigger filtered it out', () => {
    const runs = allGreenSnapshot().filter((run) => run.name !== 'Bundle Analysis');

    expect(evaluateGate({ checkRuns: runs }).verdict).toBe('green');
  });

  it('refuses one that reported `failure`', () => {
    const runs = allGreenSnapshot().map((run) =>
      run.name === 'Bundle Analysis' ? { ...run, conclusion: 'failure' } : run,
    );
    const result = evaluateGate({ checkRuns: runs });

    expect(result.verdict).toBe('red');
    expect(result.failing).toEqual(['Bundle Analysis (failure)']);
  });

  it('waits for one that is present but still running', () => {
    const runs = allGreenSnapshot().map((run) =>
      run.name === 'Bundle Analysis' ? { ...run, status: 'in_progress', conclusion: null } : run,
    );

    expect(evaluateGate({ checkRuns: runs }).verdict).toBe('pending');
  });
});

describe('waitForGate: the deadline fails closed', () => {
  const fakeClock = () => {
    let nowMs = 0;
    return {
      now: () => nowMs,
      sleep: async (ms: number) => {
        nowMs += ms;
      },
    };
  };

  it('polls until the verdict is decided, then returns it', async () => {
    const clock = fakeClock();
    const timeline = [snapshotAt(MERGED_AT), snapshotAt('2026-08-17T08:18:55Z'), allGreenSnapshot()];
    let call = 0;

    const result = await waitForGate({
      api: { listCheckRuns: async () => timeline[Math.min(call++, timeline.length - 1)] },
      sha: 'deadbeef',
      timeoutMs: 60_000,
      intervalMs: 1_000,
      now: clock.now,
      sleep: clock.sleep,
    });

    expect(result.verdict).toBe('green');
    expect(result.polls).toBe(3);
    expect(result.timedOut).toBe(false);
  });

  it('stops at the first red instead of polling out the deadline', async () => {
    // 08:22:33Z is the last completion in the record, i.e. the earliest instant
    // `test-aggregate` could report; two shards failed, so it reports `failure`.
    // The point of the case is unchanged by objectui#9499 — a decided red ends
    // the wait on the FIRST poll rather than costing the author the timeout.
    const clock = fakeClock();
    const result = await waitForGate({
      api: { listCheckRuns: async () => withAggregator(snapshotAt('2026-08-17T08:22:33Z'), 'failure') },
      sha: 'deadbeef',
      timeoutMs: 60_000,
      intervalMs: 1_000,
      now: clock.now,
      sleep: clock.sleep,
    });

    expect(result.verdict).toBe('red');
    expect(result.polls).toBe(1);
    expect(result.failing).toContain('Test (failure)');
  });

  it('turns an undecided gate RED at the deadline — a timeout is not a pass', async () => {
    const clock = fakeClock();
    const result = await waitForGate({
      // A context that never reports: the shape a renamed job produces.
      api: { listCheckRuns: async () => allGreenSnapshot().filter((r) => r.name !== 'Type Check') },
      sha: 'deadbeef',
      timeoutMs: 10_000,
      intervalMs: 1_000,
      now: clock.now,
      sleep: clock.sleep,
    });

    expect(result.verdict).toBe('red');
    expect(result.timedOut).toBe(true);
    expect(result.missing).toEqual(['Type Check']);
  });

  it('surfaces an API failure as a throw, so the job fails and nothing merges', async () => {
    await expect(
      waitForGate({
        api: {
          listCheckRuns: async () => {
            throw new Error('GET /repos/o/r/commits/sha/check-runs -> HTTP 403');
          },
        },
        sha: 'deadbeef',
      }),
    ).rejects.toThrow('HTTP 403');
  });
});

describe('main(): a misconfigured deadline fails loudly, not silently', () => {
  const greenApi = { listCheckRuns: async () => allGreenSnapshot() };
  const baseEnv = { HEAD_SHA: 'deadbeef', GATE_REPORT_FILE: '/dev/null' };

  it('rejects a non-numeric timeout instead of polling forever', async () => {
    await expect(
      main({ api: greenApi, env: { ...baseEnv, GATE_TIMEOUT_SECONDS: '40 minutes' } }),
    ).rejects.toThrow('GATE_TIMEOUT_SECONDS must be a positive number of seconds');
  });

  it('rejects a zero or negative interval', async () => {
    await expect(
      main({ api: greenApi, env: { ...baseEnv, GATE_INTERVAL_SECONDS: '0' } }),
    ).rejects.toThrow('GATE_INTERVAL_SECONDS must be a positive number of seconds');
  });

  it('refuses to run without being told which SHA it is judging', async () => {
    await expect(main({ api: greenApi, env: { GATE_REPORT_FILE: '/dev/null' } })).rejects.toThrow('HEAD_SHA');
  });
});

describe('the refusal is legible', () => {
  it('says nothing was merged, and names what refused', () => {
    const body = renderVerdict({
      ...evaluateGate({ checkRuns: withAggregator(snapshotAt('2026-08-17T08:22:33Z'), 'failure') }),
      sha: '31745d8b6805dc829c05660a9592e92ca537bc3b',
      elapsedMs: 540_000,
    });

    expect(body).toContain('NOT merged');
    expect(body).toContain('31745d8');
    expect(body).toContain('Test (failure)');
  });

  it('distinguishes a deadline from a failure', () => {
    const body = renderVerdict({
      verdict: 'red',
      failing: [],
      pending: ['Type Check (in_progress)'],
      missing: [],
      timedOut: true,
      sha: 'deadbeef',
    });

    expect(body).toContain('deadline');
    expect(body).toContain('Type Check (in_progress)');
  });
});

// ── The buckets versus the workflows that actually produce the checks ────────
//
// The parser these assertions run on now lives in `./workflow-checks.ts`, so
// that `merge-queue-reporting.test.ts` can derive its `merge_group` floor from
// the same answer instead of parsing the workflows a second time (objectui#6160).

describe('the declared buckets partition what a pull request actually produces', () => {
  const workflows = readWorkflows().filter((workflow) => pullRequestTrigger(workflow).subscribes);
  const produced = producedCheckNames();

  it('found the workflows and the shard matrix (the parser still parses)', () => {
    expect(workflows.map((w) => w.file)).toContain('ci.yml');
    expect([...produced.keys()]).toEqual(
      expect.arrayContaining(['Test (shard 1/16)', 'Test (shard 16/16)', 'Test', 'Lint', 'dependabot', 'label']),
    );
    // No unexpanded template survived the matrix expansion.
    for (const name of produced.keys()) expect(name).not.toContain('${{');
  });

  it('classifies every produced check exactly once', () => {
    const buckets = [
      ...REQUIRED_CONTEXTS.map((name) => [name, 'required'] as const),
      ...Object.keys(OPTIONAL_CONTEXTS).map((name) => [name, 'optional'] as const),
      ...Object.keys(NOT_A_GATE).map((name) => [name, 'not-a-gate'] as const),
    ];

    const seen = new Map<string, string>();
    const duplicated: string[] = [];
    for (const [name, bucket] of buckets) {
      if (seen.has(name)) duplicated.push(`${name} (${seen.get(name)} + ${bucket})`);
      seen.set(name, bucket);
    }
    expect(duplicated).toEqual([]);

    const unclassified = [...produced.keys()].filter((name) => !seen.has(name));
    expect(
      unclassified,
      `these checks run on every pull request but the gate does not classify them: ${unclassified.join(', ')}`,
    ).toEqual([]);

    const unproduced = [...seen.keys()].filter((name) => !produced.has(name));
    expect(
      unproduced,
      `the gate names checks that no pull-request workflow produces (renamed or deleted?): ${unproduced.join(', ')}`,
    ).toEqual([]);
  });

  it('requires only contexts whose workflow carries NO path filter', () => {
    const filtered = new Map(
      readWorkflows().map((workflow) => [workflow.file, pullRequestTrigger(workflow).filtered]),
    );

    for (const name of REQUIRED_CONTEXTS) {
      const file = produced.get(name);
      expect(file, `${name} is required but nothing produces it`).toBeTruthy();
      expect(
        filtered.get(file as string),
        `${name} is required, but ${file} filters its pull_request trigger by path — it cannot be waited for on every PR (#3523)`,
      ).toBe(false);
    }
  });

  it('marks optional exactly those blocking contexts whose workflow IS path-filtered', () => {
    for (const name of Object.keys(OPTIONAL_CONTEXTS)) {
      const file = produced.get(name);
      expect(pullRequestTrigger(readWorkflows().find((w) => w.file === file) as Workflow).filtered).toBe(true);
    }
  });

  it('writes down the check-runs-only boundary, so the scope is not inferred from the endpoint', () => {
    // A third-party commit STATUS (this repository has one: `Vercel`) is not a
    // check run and is not read by the gate. That boundary has to be stated
    // rather than left to whoever next wonders why a red status did not block.
    const script = fs.readFileSync(path.join(repoRoot, 'scripts', 'dependabot-merge-gate.mjs'), 'utf8');

    expect(script).toMatch(/commit STATUS/i);
    expect(script).toContain('Vercel');
  });

  it('states a reason for every context it declines to gate on', () => {
    for (const [name, reason] of Object.entries({ ...OPTIONAL_CONTEXTS, ...NOT_A_GATE })) {
      expect(reason.length, `${name} needs a reason, not just an entry`).toBeGreaterThan(40);
    }
  });
});

describe('the workflow cannot merge without consulting the gate', () => {
  const workflow = fs.readFileSync(path.join(workflowDir, 'dependabot-auto-merge.yml'), 'utf8');
  const steps = workflow.split(/^ {6}- name: /m).slice(1);

  it('has no `gh pr merge` that is not behind a green gate', () => {
    const merging = steps.filter((step) => /gh pr merge/.test(step));

    expect(merging.length).toBeGreaterThan(0);
    for (const step of merging) {
      expect(step, 'a `gh pr merge` step must be conditioned on the gate verdict').toMatch(
        /if:\s*steps\.gate\.outputs\.gate == 'green'/,
      );
    }
  });

  it('does not approve before the gate is green either', () => {
    for (const step of steps.filter((step) => /gh pr review --approve/.test(step))) {
      expect(step).toMatch(/if:\s*steps\.gate\.outputs\.gate == 'green'/);
    }
  });

  it('runs the gate script and tells it which SHA to judge', () => {
    expect(workflow).toContain('node scripts/dependabot-merge-gate.mjs');
    expect(workflow).toMatch(/HEAD_SHA: \$\{\{ github\.event\.pull_request\.head\.sha }}/);
    // Pins the merge to the judged SHA: a push that lands during the wait must
    // not be enqueued on the strength of the previous commit's checks.
    expect(workflow).toContain('--match-head-commit');
  });

  it('grants `checks: read`, without which the gate 403s', () => {
    expect(workflow).toMatch(/^\s*checks: read$/m);
  });

  it('fails the job when the gate refuses, so the PR carries a red check', () => {
    expect(workflow).toMatch(/steps\.gate\.outputs\.gate != 'green'/);
  });

  it('keeps the semver policy the issue did not ask to change', () => {
    expect(workflow).toContain('version-update:semver-patch');
    expect(workflow).toContain('version-update:semver-minor');
    expect(workflow).toMatch(/steps\.metadata\.outputs\.update-type == 'version-update:semver-major'/);
  });

  // No merge-driver assertion here any more (objectui#6369). It existed to hold
  // this workflow to the row `ci-cd-pipeline.md` pinned for it; that row is gone,
  // because the only merge this workflow performs is server-side `gh pr merge`
  // and a local driver cannot participate in one.
});
