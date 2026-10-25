import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

import {
  CONFIRMATION_DELAY_MS,
  DEFAULT_BASE_BRANCH,
  EXIT_CANNOT_RUN,
  EXIT_OK,
  EXIT_WEDGED,
  HEALTHY_FIXTURE,
  QUEUE_REF_NAMESPACE,
  VERDICTS,
  WEDGE_THRESHOLD_MS,
  assertGrounded,
  classifyQueue,
  exitCodeFor,
  fakeApi,
  inspectQueue,
  parseQueueRef,
  renderReading,
  selectHeadEntry,
  selfTest,
} from '../check-merge-queue-head.mjs';
import { producedCheckNames, readWorkflows, triggerBlock } from './workflow-checks';

/**
 * objectui#7010 — a merge-queue head entry for which GitHub never dispatches
 * `merge_group` blocks every lane in the repository, with nothing red anywhere.
 * Four occurrences; the longest ran four hours; nothing was watching.
 *
 * ## ⭐ Why this file is mostly ANTI-VACUITY rather than behaviour
 *
 * This gate landed against a CLEAN CORPUS. The queue was measured healthy while
 * it was written (`origin/main` advancing normally through 2026-09-05T23:46Z),
 * so there was no live wedge to point it at and there may not be another for
 * weeks. A detector in that position fails in one specific direction: it stops
 * being able to SEE a wedge — a narrowed ref parser, a head selector that
 * resolves nothing, a count read off a renamed field — and every run after that
 * reports a healthy queue, forever, with total confidence. "All clear because I
 * was looking at nothing" is the exact failure the card is about, one level up.
 *
 * So the load-bearing assertions here are the ones that would go red on a blind
 * detector: a wedged corpus the live queue does not supply, taken from the
 * healthy corpus by changing ONE field; the recorded #7283 instance in its own
 * shape; and the refusal (`assertGrounded`) that makes a healthy verdict
 * unreachable without a head entry and a positive run count.
 *
 * ## What is deliberately NOT asserted
 *
 * Whether GitHub dispatches `merge_group` for a given entry, and why it
 * sometimes does not. That is a repository/Actions-settings question no test
 * here can read and no agent seat can answer — the card's triage ruling of
 * 2026-09-04 split it off so this half could ship. This file pins the
 * DETECTION and its wiring.
 */
const ROOT = path.resolve(fileURLToPath(import.meta.url), '../../..');
const GATE = 'scripts/check-merge-queue-head.mjs';
const WORKFLOW_FILE = 'merge-queue-head-patrol.yml';
const WORKFLOW = `.github/workflows/${WORKFLOW_FILE}`;

const gateSource = fs.readFileSync(path.join(ROOT, GATE), 'utf8');
const NOW = Date.parse('2026-09-05T23:40:00Z');

/** One reading over a fixture, with no clock and no network. */
const read = (over: Record<string, unknown> = {}) =>
  inspectQueue({
    api: fakeApi({ ...HEALTHY_FIXTURE, nowMs: NOW, ...over }),
    now: () => NOW,
    sleep: async () => {},
  });

describe('the detector can still see a wedge (the anti-vacuous leg)', () => {
  it('reports WEDGED on the healthy corpus with exactly one field changed', async () => {
    // ⭐ THE assertion of this file. The healthy fixture is the live reading
    // taken from this repository on 2026-09-05; this is that reading with the
    // run count set to 0 and nothing else touched. If the detector ever stops
    // being able to reach a wedge verdict — for any reason, including one
    // nobody anticipated — this is what goes red.
    const clear = await read();
    const wedged = await read({ runs: 0 });

    expect(clear.verdict, 'the unmodified live corpus must still read as healthy').toBe('clear');
    expect(
      wedged.verdict,
      'the SAME corpus with zero merge_group runs on its head entry must read as WEDGED. If this is ' +
        "'undetermined' the head entry stopped resolving; if it is 'clear' the run count is being read " +
        'off the wrong field. Either way the patrol has gone blind and every scheduled run since is a ' +
        'meaningless all-clear.',
    ).toBe('wedged');
    expect(exitCodeFor(wedged.verdict)).toBe(EXIT_WEDGED);
  });

  it('names the pull request to dequeue, because that is the whole remedy', async () => {
    const body = renderReading(await read({ runs: 0 }));
    expect(body).toContain('#7815');
    expect(body).toMatch(/remove that entry from the merge queue/i);
    // The remedy that was MEASURED not to work must not be offered as one.
    expect(body).toMatch(/re-enqueueing the head was\s+measured INEFFECTIVE/i);
  });

  it('reports WEDGED on the recorded 2026-09-02 instance (#7283) in its own shape', async () => {
    const recorded = await read({
      tipSha: 'eb33a8d4c69f2a7b1d0e5c8a4f3b2e1d0c9a8b7f',
      refs: [`refs/heads/${QUEUE_REF_NAMESPACE}/main/pr-7283-eb33a8d4c69f2a7b1d0e5c8a4f3b2e1d0c9a8b7f`],
      runs: 0,
    });
    expect(recorded.verdict).toBe('wedged');
    expect(renderReading(recorded)).toContain('#7283');
  });

  it('requires TWO zero samples — one is the seconds after a head change', async () => {
    // If the entry in front is EJECTED rather than merged, the new head inherits
    // an old `main` clock and an old queue commit, so a single sample cannot
    // tell "wedged for an hour" from "head for four seconds".
    const recovered = await read({ runs: [0, 17] });
    expect(recovered.verdict, 'runs appearing during the confirmation wait is not a wedge').toBe('clear');
    expect(recovered.samples).toHaveLength(2);

    const wedged = await read({ runs: 0 });
    expect(wedged.samples).toHaveLength(2);
    expect(wedged.samples.every((s) => s.totalCount === 0)).toBe(true);
  });

  it('never sleeps on a healthy queue — the confirmation costs nothing until suspicion', async () => {
    const clear = await read();
    expect(clear.samples).toHaveLength(1);
  });
});

describe('a verdict cannot outrun its evidence', () => {
  const rejected = (reading: Record<string, unknown>) => () => assertGrounded(reading);

  it('refuses `clear` without a head entry', () => {
    expect(rejected({ verdict: 'clear', entries: [{}], head: null, samples: [{ totalCount: 9 }] })).toThrow(/ungrounded/);
  });

  it('refuses `clear` with a zero run count, and with no sample at all', () => {
    expect(rejected({ verdict: 'clear', entries: [{}], head: { ref: 'r' }, samples: [{ totalCount: 0 }] })).toThrow(/ungrounded/);
    expect(rejected({ verdict: 'clear', entries: [{}], head: { ref: 'r' }, samples: [] })).toThrow(/ungrounded/);
  });

  it('refuses `wedged` on one sample, or with a clock this run never read', () => {
    const base = { verdict: 'wedged', entries: [{}], head: { ref: 'r' }, thresholdMs: WEDGE_THRESHOLD_MS };
    expect(rejected({ ...base, samples: [{ totalCount: 0 }], baseStaticMs: 1e9, headAgeMs: 1e9 })).toThrow(/two samples/);
    expect(
      rejected({ ...base, samples: [{ totalCount: 0 }, { totalCount: 0 }], baseStaticMs: null, headAgeMs: 1e9 }),
    ).toThrow(/ungrounded/);
  });

  it('refuses `empty` while entries were listed', () => {
    expect(rejected({ verdict: 'empty', entries: [{}] })).toThrow(/queue entries were listed/);
  });

  it('is reached by every live reading, so the refusal is not decorative', async () => {
    // `inspectQueue` runs the refusal over the reading it is about to return, so
    // a reading that came back at all is a reading that passed it. Pinned by
    // source text because the call is one line, it is on the only path that
    // produces a reading, and deleting it would leave every test above green.
    expect(gateSource).toMatch(/^ {2}assertGrounded\(reading\);$/m);
    expect(gateSource).toMatch(/^ {2}return reading;$/m);
    for (const over of [{}, { runs: 0 }, { refs: [] }, { tipSha: 'f'.repeat(40) }]) {
      await expect(read(over)).resolves.toBeTruthy();
    }
  });
});

describe('could-not-read never renders as a healthy queue', () => {
  it('an unidentifiable head is its own verdict, with its own wording', async () => {
    const drifted = await read({ tipSha: 'f'.repeat(40) });
    expect(drifted.verdict).toBe('undetermined');
    const body = renderReading(drifted);
    expect(body).toMatch(/NO READING TAKEN/);
    expect(body).toMatch(/not a clean reading and it is not a dirty one/);
    expect(body, 'the healthy tick must not appear on a reading that was not taken').not.toContain('✅');
  });

  it('an empty queue and a settling head are also not healthy readings', async () => {
    const empty = await read({ refs: [] });
    expect(empty.verdict).toBe('empty');
    expect(renderReading(empty)).not.toContain('✅');

    const young = await read({ runs: 0, agedMs: WEDGE_THRESHOLD_MS - 1000 });
    expect(young.verdict).toBe('settling');
    expect(renderReading(young)).not.toContain('✅');
  });

  it('every non-wedge reading exits 0 — a finding is the only failure', () => {
    for (const verdict of VERDICTS) {
      expect(exitCodeFor(verdict)).toBe(verdict === 'wedged' ? EXIT_WEDGED : EXIT_OK);
    }
    expect(new Set([EXIT_OK, EXIT_CANNOT_RUN, EXIT_WEDGED]).size).toBe(3);
  });
});

describe('the head entry is identified, never constructed', () => {
  it('parses the byte-real ref measured from this repository', () => {
    const parsed = parseQueueRef(HEALTHY_FIXTURE.refs[0]);
    expect(parsed).toMatchObject({ pull: 7815, base: 'main', baseSha: HEALTHY_FIXTURE.tipSha });
  });

  it('refuses a plain branch that merely looks like an entry', () => {
    expect(parseQueueRef('pr-12-abcdef1')).toBeNull();
    expect(parseQueueRef('refs/heads/feature/pr-12-abcdef1')).toBeNull();
  });

  it('picks the entry stacked on the tip, not the first one listed', () => {
    // `git/matching-refs` sorts lexicographically, which orders by pull NUMBER.
    // A re-queued older pull request sits at the head with a larger-numbered
    // entry behind it, so "the first ref" is a different answer from "the head".
    const entries = [
      parseQueueRef(`${QUEUE_REF_NAMESPACE}/main/pr-9000-${'a'.repeat(40)}`)!,
      parseQueueRef(HEALTHY_FIXTURE.refs[0])!,
    ];
    const head = selectHeadEntry({ entries, baseBranch: 'main', tipSha: HEALTHY_FIXTURE.tipSha });
    expect(head).toBe(entries[1]);
  });

  it('returns an entry FROM the listing, so the ref provably exists', () => {
    // Measured: `GET /actions/runs?branch=` answers `total_count: 0` with HTTP
    // 200 for a branch that does not exist. A ref assembled from a pull number
    // and a sha would therefore report a wedge on a healthy queue whenever one
    // character was wrong, with a completely plausible message. Identity, not
    // equality, is the assertion: the head must be an object the listing
    // produced.
    const entries = [parseQueueRef(HEALTHY_FIXTURE.refs[0])!];
    expect(selectHeadEntry({ entries, baseBranch: 'main', tipSha: HEALTHY_FIXTURE.tipSha })).toBe(entries[0]);
    expect(gateSource, 'the gate must not build a queue ref out of a pull number').not.toMatch(
      /`\$\{QUEUE_REF_NAMESPACE\}\/\$\{[^}]+\}\/pr-\$\{/,
    );
  });

  it('ignores entries queued for another base branch', () => {
    const entries = [parseQueueRef(`${QUEUE_REF_NAMESPACE}/develop/pr-1-abcdef1`)!];
    expect(selectHeadEntry({ entries, baseBranch: 'main', tipSha: 'abcdef1' })).toBeNull();
  });

  it('judges the head only — zero runs is normal behind it', async () => {
    // Measured 2026-09-05: of the 18 most recent entries, one healthy entry
    // (`pr-7815`, sixth in a six-deep chain) waited 877s for its first run
    // because it sat outside the queue's speculative build window. A patrol
    // that judged every entry would call that a wedge.
    const twoDeep = await read({
      refs: [
        HEALTHY_FIXTURE.refs[0],
        `refs/heads/${QUEUE_REF_NAMESPACE}/main/pr-7900-${'b'.repeat(40)}`,
      ],
    });
    expect(twoDeep.verdict).toBe('clear');
    expect(twoDeep.head?.pull).toBe(7815);
    // Exactly one entry was sampled, and it was the head.
    expect(twoDeep.samples).toHaveLength(1);
    expect(gateSource).toMatch(/Do not widen this gate to the entries behind the head/);
  });
});

describe('the threshold is one constant, and it carries both boundary readings', () => {
  it('is the 5 minutes the lane ruled', () => {
    expect(WEDGE_THRESHOLD_MS).toBe(5 * 60 * 1000);
  });

  it('states the healthy dispatch measurement and the 60-minute self-heal beside itself', () => {
    // objectui#7010's ruling: "one named constant with a comment stating both of
    // those boundary readings, so the next person can retune it against evidence
    // rather than taste". Pinned rather than trusted — a constant whose
    // justification was deleted is a magic number again.
    const at = gateSource.indexOf('export const WEDGE_THRESHOLD_MS');
    expect(at).toBeGreaterThan(-1);
    const docblock = gateSource.slice(gateSource.lastIndexOf('/**', at), at);
    expect(docblock, 'the lower boundary — how fast a healthy head dispatches').toMatch(/HEALTHY[\s\S]*SECONDS/);
    expect(docblock, 'the upper boundary — the ruleset timeout that self-heals it').toMatch(/SELF-HEAL[\s\S]*60 MINUTES/);
    expect(docblock, 'both readings must name where they were measured').toMatch(/[Mm]easured/);
  });

  it('fires at exactly the threshold and not one millisecond earlier', async () => {
    expect((await read({ runs: 0, agedMs: WEDGE_THRESHOLD_MS - 1 })).verdict).toBe('settling');
    expect((await read({ runs: 0, agedMs: WEDGE_THRESHOLD_MS })).verdict).toBe('wedged');
  });

  it('waits longer than the slowest dispatch it measured before confirming', () => {
    // 24s was the slowest healthy dispatch in the measured population; the
    // confirmation gap has to clear it or the second sample proves nothing.
    expect(CONFIRMATION_DELAY_MS).toBeGreaterThan(24 * 1000);
    expect(CONFIRMATION_DELAY_MS).toBeLessThan(WEDGE_THRESHOLD_MS);
  });

  it('needs both clocks, and treats an unread clock as undetermined', () => {
    const args = { entries: [{}], head: { ref: 'r' }, samples: [{ totalCount: 0 }, { totalCount: 0 }] };
    expect(classifyQueue({ ...args, baseStaticMs: null, headAgeMs: 1e9 })).toBe('undetermined');
    expect(classifyQueue({ ...args, baseStaticMs: 1e9, headAgeMs: null })).toBe('undetermined');
    expect(classifyQueue({ ...args, baseStaticMs: 1e9, headAgeMs: 1e9 })).toBe('wedged');
  });
});

describe('the report describes calls that were actually made', () => {
  it('renders its "what this run checked" list out of the trace', async () => {
    const clear = await read();
    expect(clear.trace.length).toBeGreaterThanOrEqual(4);
    const body = renderReading(clear);
    for (const line of clear.trace) expect(body).toContain(line);
  });

  it('says a clock was NOT read rather than silently defaulting it', async () => {
    const api = fakeApi({ ...HEALTHY_FIXTURE, runs: 0, nowMs: NOW });
    api.lastAdvance = async () => null;
    const reading = await inspectQueue({ api, now: () => NOW, sleep: async () => {} });
    expect(reading.verdict).toBe('undetermined');
    expect(reading.trace.join('\n')).toMatch(/was NOT read/);
  });

  it('refuses a stale `main` clock instead of using it', async () => {
    // The newest push run is for a commit that is no longer the tip: the branch
    // moved without producing one, so "how long static" would be overstated —
    // and overstating it is the direction that manufactures a wedge.
    const api = fakeApi({ ...HEALTHY_FIXTURE, runs: 0, nowMs: NOW });
    api.lastAdvance = async () => ({ at: new Date(NOW - 3600_000).toISOString(), sha: 'd'.repeat(40) });
    const reading = await inspectQueue({ api, now: () => NOW, sleep: async () => {} });
    expect(reading.verdict).toBe('undetermined');
    expect(reading.trace.join('\n')).toMatch(/that clock is stale, so it was NOT used/);
  });
});

describe('the patrol is wired, not merely present', () => {
  const workflowText = fs.readFileSync(path.join(ROOT, WORKFLOW), 'utf8');
  const workflow = parseYaml(workflowText);
  const job = workflow.jobs.patrol;

  it('the script and its workflow both exist', () => {
    expect(fs.existsSync(path.join(ROOT, GATE))).toBe(true);
    expect(fs.existsSync(path.join(ROOT, WORKFLOW))).toBe(true);
  });

  it('package.json aliases the offline check and the live read', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    expect(pkg.scripts['check:merge-queue-head']).toBe(`node ${GATE} --self-test`);
    expect(pkg.scripts['merge-queue-head']).toBe(`node ${GATE}`);
  });

  it('the workflow actually runs the script', () => {
    const runs = job.steps.map((s: { run?: string }) => s.run ?? '').join('\n');
    expect(runs).toContain(`node ${GATE}`);
  });

  it('runs on a clock, because the failure is an absence nothing can trigger on', () => {
    // A wedged entry emits no `merge_group`; `main` never moves, so no `push`
    // fires; the pull-request events all happened before it was enqueued. There
    // is no event to hang this on — that is the whole reason for the cron.
    const crons = (workflow.on.schedule ?? []).map((s: { cron: string }) => s.cron);
    expect(crons).toHaveLength(1);
    expect(crons[0]).toMatch(/^[\d,]+ \* \* \* \*$/);
    const minutes = crons[0].split(' ')[0].split(',').map(Number);
    expect(minutes.length, 'four firings an hour — see the cadence arithmetic in the workflow header').toBe(4);
    expect(minutes, 'offset off :00, where every other repository schedules').not.toContain(0);
    expect(workflow.on).toHaveProperty('workflow_dispatch');
  });

  it('subscribes no pull_request leg, so it owes no entry in the merge gate', () => {
    // Every job of a `pull_request` workflow produces a check run, and
    // `dependabot-merge-gate.mjs` requires every produced name to be classified
    // in REQUIRED_CONTEXTS / OPTIONAL_CONTEXTS / NOT_A_GATE — a partition
    // `dependabot-merge-gate.test.ts` asserts exactly. This patrol has no leg,
    // so it produces nothing and owes nothing. If a leg is ever added, this goes
    // red and names the other half of the work.
    expect(workflow.on).not.toHaveProperty('pull_request');
    expect(workflow.on).not.toHaveProperty('merge_group');
    const self = readWorkflows().find((w) => w.file === WORKFLOW_FILE);
    expect(self, 'the patrol workflow must be readable by the shared parser').toBeTruthy();
    expect(triggerBlock(self!).some((line) => /^ {2}pull_request:/.test(line))).toBe(false);
    for (const [name, file] of producedCheckNames()) {
      expect(file, `${name} must not come from the patrol — it can never gate a pull request`).not.toBe(WORKFLOW_FILE);
    }
  });

  it('grants exactly the three scopes it uses, and no other write', () => {
    expect(workflow.permissions).toEqual({ contents: 'read', actions: 'read', issues: 'write' });
  });

  it('serialises itself and never cancels a run mid-reading', () => {
    expect(workflow.concurrency.group).toBe('merge-queue-head-patrol');
    expect(workflow.concurrency['cancel-in-progress']).toBe(false);
  });

  it('captures the exit code with no pipe in between', () => {
    // `node … | tail` reports the PIPE's status, and `tail` essentially never
    // fails — so a wedge (3), a clean reading (0) and an unreadable one (2)
    // would all read as 0. That silent collapse is the class this patrol exists
    // to catch, and it would be sitting inside the patrol.
    const step = job.steps.find((s: { id?: string }) => s.id === 'patrol');
    expect(step, 'the reading step must keep its `id: patrol`').toBeTruthy();
    expect(step.run).toMatch(/code=\$\?/);
    expect(step.run).not.toMatch(/node scripts\/check-merge-queue-head\.mjs[^\n]*\|/);
  });

  it('lands the reading BEFORE it raises the alarm', () => {
    const ids = job.steps.map((s: { name?: string }) => s.name ?? '');
    const summaryAt = ids.findIndex((n: string) => /run summary/i.test(n));
    const failAt = ids.findIndex((n: string) => /^Fail the run/i.test(n));
    expect(summaryAt).toBeGreaterThan(-1);
    expect(failAt).toBeGreaterThan(summaryAt);
    expect(job.steps[summaryAt].if).toBe('always()');
  });

  it('never opens an issue — one anchor, refreshed, or nothing at all', () => {
    // A patrol that filed a card per firing would file four an hour for an hour,
    // on one incident. objectui#7010's own history is the precedent: a live
    // recurrence was posted there as a comment "per the one-anchor rule rather
    // than as a new card".
    expect(workflowText).not.toMatch(/issues\.create/);
    expect(workflowText).not.toMatch(/issues\.createComment/);
    expect(workflowText).toMatch(/issues\.update/);
  });

  it('needs no install, so it stays inside the pre-install import population', () => {
    const runs = job.steps.map((s: { run?: string; uses?: string }) => `${s.uses ?? ''} ${s.run ?? ''}`).join('\n');
    expect(runs).not.toMatch(/pnpm install/);
    // The gate imports one repo-relative module and nothing else; anything from
    // `node_modules` would make the install-free step throw at import time.
    const imports = [...gateSource.matchAll(/^import .* from '([^']+)';$/gm)].map((m) => m[1]);
    expect(imports).toEqual(['./invoked-as.mjs']);
  });

  it('reads the branch it is installed to watch, with a default that is real', () => {
    const step = job.steps.find((s: { id?: string }) => s.id === 'patrol');
    expect(step.env.QUEUE_BASE_BRANCH).toContain('default_branch');
    expect(DEFAULT_BASE_BRANCH).toBe('main');
  });
});

describe('the offline self-test is the half that makes a green run mean something', () => {
  it('passes', async () => {
    // The script's own `--self-test` carries the case-level coverage; running it
    // here is what puts it on every pull request. A self-test nothing invokes is
    // indistinguishable from one that passes.
    const log: string[] = [];
    const out = console.log;
    const err = console.error;
    console.log = (...a: unknown[]) => log.push(a.join(' '));
    console.error = (...a: unknown[]) => log.push(a.join(' '));
    let code: number;
    try {
      code = await selfTest();
    } finally {
      console.log = out;
      console.error = err;
    }
    expect(code, log.join('\n')).toBe(0);
    // The summary names the case count, so a self-test that silently stopped
    // running cases cannot pass this by printing nothing.
    expect(log.join('\n')).toMatch(/\d+ cases pass/);
  });
});
