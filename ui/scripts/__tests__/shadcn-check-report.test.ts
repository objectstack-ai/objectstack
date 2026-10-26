import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Plain-JS CI helper. Its types are INFERRED from the .mjs source by
// `tsconfig.scripts.json` (`allowJs`), so no `@ts-expect-error` here — see
// objectui#3494.
import {
  ESCALATION_THRESHOLD,
  MARKER_STEPS,
  alarmTitle,
  classifyAnalyze,
  classifyCheck,
  consecutiveUnreachable,
  countRegistryErrors,
  decideAlarm,
  main,
  readRegistryStreak,
  registryStateFromJobs,
  renderAlarmIssue,
  stripAnsi,
} from '../shadcn-check-report.mjs';

/**
 * objectui#3586 — the three gaps PR #3497 declared and left open.
 *
 * #3497 built the alarm channel and tested it by hand: five fixtures, run once,
 * results written into the PR body. Nothing re-runs that between weekly cron
 * fires, and the logic it covered lived in YAML where nothing could. This file
 * is the standing version of that dry run, and it exists because this card adds
 * two more classified inputs to the same decision.
 *
 * What each block pins:
 *
 *  1. #3497's three check classes, UNCHANGED. This card must not move the
 *     tolerance ruling, so the ruling is asserted here as a regression fence
 *     rather than described in a comment.
 *  2. Gap ③ — an `analyze` crash reaches the SAME channel. The discriminating
 *     assertion is the reverse one: with the crash classified back to `ok`, the
 *     identical run produces NO alarm. That is the "silently red on an unwatched
 *     weekly job" state the card is closing, asserted from both sides.
 *  3. Gap ① — consecutive unreachability. Both directions again: runs 1..N-1
 *     stay tolerated exactly as #3497 ruled (no alarm, no issue), and run N
 *     escalates into the same channel.
 *  4. Gap ② and the cross-run contract, read out of the workflow YAML. The
 *     marker step names are the one part of the mechanism a rename can break
 *     SILENTLY — a renamed marker reads back as `unknown`, resets the streak,
 *     and the escalation simply never fires again — so they are pinned against
 *     the module's own constants rather than re-spelled.
 */

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const workflowPath = path.join(repoRoot, '.github/workflows/shadcn-check.yml');
const workflow = fs.readFileSync(workflowPath, 'utf8');

/**
 * The workflow YAML with whole-line comments removed — the same precaution
 * `docs-links-workflow.test.ts` documents. This file's header prose discusses
 * `continue-on-error` and `timeout-minutes` at length, and a scan that counted
 * those sentences would assert the opposite of the truth.
 */
const workflowCode = workflow
  .split('\n')
  .filter((line) => !/^\s*#/.test(line))
  .join('\n');

/** A realistic `shadcn:check` capture: 46 components, every fetch refused. */
const unreachableOutput = Array.from(
  { length: 46 },
  (_, i) => `✗ component-${i}            Registry returned no usable file content`,
).join('\n');

const cleanOutput = ['✓ button                    Identical to upstream', 'Registry: 0 cached, 46 fetched'].join('\n');

const patchOutput = [
  cleanOutput,
  'DECLARED LOCAL PATCHES — FAILED',
  '✗ 1 component(s) with declared local patch failures',
].join('\n');

describe('classifyCheck — #3497 three classes, unchanged', () => {
  it('classifies a clean run as ok with no alarm', () => {
    const verdict = classifyCheck({ output: cleanOutput, exitCode: 0 });
    expect(verdict).toEqual({ checkClass: 'ok', registryErrors: 0, registryState: 'reachable' });
    expect(decideAlarm({ checkClass: 'ok', analyzeClass: 'ok', registryStreak: 0 }).alarm).toBe(false);
  });

  it('tolerates an unreachable registry: still ok, still exit 0, still no issue', () => {
    const verdict = classifyCheck({ output: unreachableOutput, exitCode: 0 });
    expect(verdict.checkClass).toBe('ok');
    expect(verdict.registryErrors).toBe(46);
    expect(verdict.registryState).toBe('unreachable');
    // The single-run ruling this card leaves untouched.
    expect(decideAlarm({ checkClass: 'ok', analyzeClass: 'ok', registryStreak: 1 }).alarm).toBe(false);
  });

  it('classifies a declared-patch failure as patch', () => {
    expect(classifyCheck({ output: patchOutput, exitCode: 1 }).checkClass).toBe('patch');
  });

  it('reads the verdict LINE before the exit code — the evidence outranks the policy', () => {
    // #3497's ordering ruling: a script revision that stopped exiting non-zero
    // for a patch failure must not silently downgrade the verdict to `ok`.
    expect(classifyCheck({ output: patchOutput, exitCode: 0 }).checkClass).toBe('patch');
  });

  it('classifies any other non-zero exit as broken', () => {
    expect(classifyCheck({ output: 'Error loading manifest', exitCode: 1 }).checkClass).toBe('broken');
    expect(decideAlarm({ checkClass: 'broken', analyzeClass: 'ok', registryStreak: 0 }).alarm).toBe(true);
  });

  it('counts both registry-failure shapes the sync script produces', () => {
    expect(
      countRegistryErrors(
        ['Error fetching from registry: HTTP 403', 'Registry returned no usable file content', 'fine'].join('\n'),
      ),
    ).toBe(2);
  });

  it('strips the ANSI the shadcn scripts emit unconditionally', () => {
    const esc = String.fromCharCode(0x1b);
    expect(stripAnsi(`${esc}[32m✓ button${esc}[0m`)).toBe('✓ button');
  });
});

describe('gap ③ — an analyze crash lands in the same channel, not silently red', () => {
  it('classifies a non-zero analyze exit as broken and alarms on it', () => {
    expect(classifyAnalyze({ exitCode: 1 })).toBe('broken');
    const { alarm, reasons } = decideAlarm({ checkClass: 'ok', analyzeClass: 'broken', registryStreak: 0 });
    expect(alarm).toBe(true);
    expect(reasons).toContain('analyze-broken');
  });

  it('REVERSE: the identical run with the crash classified ok produces no alarm at all', () => {
    // This is the pre-#3586 behaviour, stated as an assertion: `analyze` exits
    // non-zero, the job goes red on a weekly schedule, and nothing reaches the
    // triage queue. If a later change reverts the classification, this pair —
    // not the positive test above — is what catches it.
    expect(classifyAnalyze({ exitCode: 0 })).toBe('ok');
    expect(decideAlarm({ checkClass: 'ok', analyzeClass: 'ok', registryStreak: 0 }).alarm).toBe(false);
  });

  it('reports the crash in the SAME issue body, with the labels-bearing title of the existing channel', () => {
    const { title, body } = renderAlarmIssue({
      reasons: ['analyze-broken'],
      analyzeClass: 'broken',
      analyzeExit: 1,
      analysisLog: 'Fatal error: Cannot read properties of undefined',
    });
    // #3497's own "could not run" title — deliberately not a new one, because a
    // new title on a de-duplicated channel is how a second channel starts.
    expect(title).toBe('Shadcn sync: the weekly component check could not run');
    expect(body).toContain('The offline analysis step **crashed**');
    expect(body).toContain('Cannot read properties of undefined');
  });

  it('still names the patch failure first when both fail — one issue, both facts', () => {
    const { title, body } = renderAlarmIssue({ reasons: ['patch', 'analyze-broken'], checkExit: 1, analyzeExit: 1 });
    expect(title).toBe('Shadcn sync: declared local patches are failing');
    expect(body).toContain('declared local patch failure');
    expect(body).toContain('The offline analysis step **crashed**');
  });
});

describe('gap ① — consecutive unreachability escalates, single runs still do not', () => {
  const jobsWith = (stepName: string) => ({ jobs: [{ steps: [{ name: stepName, conclusion: 'success' }] }] });
  const unreachableRun = jobsWith(MARKER_STEPS.unreachable);
  const reachableRun = jobsWith(MARKER_STEPS.reachable);
  /** A run that died before the markers — neither name present. */
  const diedEarlyRun = { jobs: [{ steps: [{ name: 'Install dependencies', conclusion: 'failure' }] }] };

  const stubApi = (previous: object[]) => {
    const calls: string[] = [];
    return {
      calls,
      listRuns: async (perPage: number) => {
        calls.push(`runs:${perPage}`);
        return { workflow_runs: previous.map((_, i) => ({ id: 100 + i })) };
      },
      listJobs: async (runId: number) => {
        calls.push(`jobs:${runId}`);
        return previous[runId - 100];
      },
    };
  };

  it('reads three states out of a jobs payload, and "unknown" is not "reachable"', () => {
    expect(registryStateFromJobs(unreachableRun.jobs)).toBe('unreachable');
    expect(registryStateFromJobs(reachableRun.jobs)).toBe('reachable');
    expect(registryStateFromJobs(diedEarlyRun.jobs)).toBe('unknown');
    expect(registryStateFromJobs([])).toBe('unknown');
  });

  it('does not touch the API at all when this run reached the registry', async () => {
    const api = stubApi([unreachableRun, unreachableRun]);
    const result = await readRegistryStreak({ currentState: 'reachable', api });
    expect(result).toEqual({ streak: 0, readable: true, error: '' });
    expect(api.calls).toEqual([]);
  });

  it('run 1 of a new outage: streak 1, tolerated', async () => {
    const api = stubApi([reachableRun, reachableRun]);
    const { streak } = await readRegistryStreak({ currentState: 'unreachable', api });
    expect(streak).toBe(1);
    expect(decideAlarm({ checkClass: 'ok', analyzeClass: 'ok', registryStreak: streak }).alarm).toBe(false);
  });

  it('run 2: streak 2, STILL tolerated — the ruling holds up to N-1', async () => {
    const api = stubApi([unreachableRun, reachableRun]);
    const { streak } = await readRegistryStreak({ currentState: 'unreachable', api });
    expect(streak).toBe(2);
    expect(streak).toBeLessThan(ESCALATION_THRESHOLD);
    expect(decideAlarm({ checkClass: 'ok', analyzeClass: 'ok', registryStreak: streak }).alarm).toBe(false);
  });

  it('run 3: streak reaches the threshold and escalates into the same channel', async () => {
    const api = stubApi([unreachableRun, unreachableRun, unreachableRun]);
    const { streak } = await readRegistryStreak({ currentState: 'unreachable', api });
    expect(streak).toBe(ESCALATION_THRESHOLD);

    const { alarm, reasons } = decideAlarm({ checkClass: 'ok', analyzeClass: 'ok', registryStreak: streak });
    expect(alarm).toBe(true);
    expect(reasons).toEqual(['registry-blind']);

    const { title, body } = renderAlarmIssue({ reasons, registryStreak: streak, registryErrors: 46 });
    expect(title).toBe('Shadcn sync: the registry has been unreachable for 3 consecutive runs');
    expect(body).toContain('unreachable for **3 consecutive runs**');
    expect(body).toContain('proved nothing about upstream');
  });

  it('stops walking at the threshold — never more than N-1 job reads', async () => {
    const api = stubApi(Array.from({ length: 8 }, () => unreachableRun));
    await readRegistryStreak({ currentState: 'unreachable', api });
    expect(api.calls.filter((c) => c.startsWith('jobs:'))).toHaveLength(ESCALATION_THRESHOLD - 1);
  });

  it('a reachable run breaks the streak; an unknown one breaks it too', () => {
    expect(consecutiveUnreachable(['unreachable', 'unreachable', 'reachable', 'unreachable'])).toBe(2);
    expect(consecutiveUnreachable(['unreachable', 'unknown', 'unreachable'])).toBe(1);
    expect(consecutiveUnreachable(['reachable'])).toBe(0);
  });

  it('a failed cross-run read alarms rather than silently disabling the escalation', async () => {
    const api = {
      listRuns: async () => {
        throw new Error('HTTP 500');
      },
      listJobs: async () => ({ jobs: [] }),
    };
    const { readable, error } = await readRegistryStreak({ currentState: 'unreachable', api });
    expect(readable).toBe(false);
    expect(error).toContain('HTTP 500');

    const { alarm, reasons } = decideAlarm({
      checkClass: 'ok',
      analyzeClass: 'ok',
      registryStreak: 1,
      streakReadable: false,
    });
    expect(alarm).toBe(true);
    expect(reasons).toContain('streak-unreadable');
    expect(alarmTitle(reasons)).toBe('Shadcn sync: the weekly component check could not run');
  });
});

describe('main() — the wiring the workflow actually depends on', () => {
  const made: string[] = [];

  afterEach(() => {
    for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  });

  async function run(env: Record<string, string>, files: Record<string, string>) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shadcn-check-report-'));
    made.push(dir);
    for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), content);

    const saved = { ...process.env };
    Object.assign(process.env, {
      GITHUB_OUTPUT: path.join(dir, 'outputs.txt'),
      GITHUB_STEP_SUMMARY: path.join(dir, 'summary.md'),
      CHECK_RAW_LOG: path.join(dir, 'check.ansi.txt'),
      ANALYZE_RAW_LOG: path.join(dir, 'analysis.ansi.txt'),
      CHECK_LOG: path.join(dir, 'check.txt'),
      ANALYZE_LOG: path.join(dir, 'analysis.txt'),
      ALARM_BODY_FILE: path.join(dir, 'alarm-issue.md'),
      ...env,
    });

    try {
      const result = await main({ api: { listRuns: async () => ({ workflow_runs: [] }), listJobs: async () => ({ jobs: [] }) } });
      const outputs = Object.fromEntries(
        fs
          .readFileSync(path.join(dir, 'outputs.txt'), 'utf8')
          .split('\n')
          .filter(Boolean)
          .map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]),
      );
      const alarmBody = fs.existsSync(path.join(dir, 'alarm-issue.md'))
        ? fs.readFileSync(path.join(dir, 'alarm-issue.md'), 'utf8')
        : null;
      return { result, outputs, alarmBody, dir };
    } finally {
      process.env = saved;
    }
  }

  it('a clean run: no alarm, no issue body, stripped logs written for the artifact', async () => {
    const esc = String.fromCharCode(0x1b);
    const { outputs, alarmBody, dir } = await run(
      { CHECK_EXIT_CODE: '0', ANALYZE_EXIT_CODE: '0' },
      { 'check.ansi.txt': `${esc}[32m${cleanOutput}${esc}[0m`, 'analysis.ansi.txt': 'Summary' },
    );
    expect(outputs.alarm).toBe('false');
    expect(outputs.check_class).toBe('ok');
    expect(outputs.analyze_class).toBe('ok');
    expect(outputs.registry_state).toBe('reachable');
    expect(alarmBody).toBeNull();
    // The artifact must carry the readable copy, not the escape-dense capture.
    expect(fs.readFileSync(path.join(dir, 'check.txt'), 'utf8')).not.toContain(esc);
  });

  it('an analyze crash alone drives the alarm outputs end to end', async () => {
    const { outputs, alarmBody } = await run(
      { CHECK_EXIT_CODE: '0', ANALYZE_EXIT_CODE: '1' },
      { 'check.ansi.txt': cleanOutput, 'analysis.ansi.txt': 'Fatal error: boom' },
    );
    expect(outputs.alarm).toBe('true');
    expect(outputs.alarm_reasons).toBe('analyze-broken');
    expect(outputs.issue_title).toBe('Shadcn sync: the weekly component check could not run');
    expect(alarmBody).toContain('boom');
  });

  it('an unreachable registry on run 1 stays tolerated but is recorded for the next run', async () => {
    const { outputs, alarmBody } = await run(
      { CHECK_EXIT_CODE: '0', ANALYZE_EXIT_CODE: '0' },
      { 'check.ansi.txt': unreachableOutput, 'analysis.ansi.txt': 'Summary' },
    );
    expect(outputs.alarm).toBe('false');
    expect(outputs.registry_state).toBe('unreachable');
    expect(outputs.registry_streak).toBe('1');
    expect(alarmBody).toBeNull();
  });
});

describe('shadcn-check.yml — the gaps, read off the workflow itself', () => {
  it('gap ②: the job declares a timeout instead of inheriting the 360-minute default', () => {
    const timeout = workflowCode.match(/^\s*timeout-minutes:\s*(\d+)\s*$/m);
    expect(timeout, 'a hung 46-request serial check must not be able to burn six hours').not.toBeNull();
    const minutes = Number(timeout?.[1]);
    // Generous over the measured worst case (49s observed, ~13min compound
    // degraded) and far under the default it replaces.
    expect(minutes).toBeGreaterThan(13);
    expect(minutes).toBeLessThan(60);
  });

  it('gap ③: the analyze step no longer hides its exit code behind continue-on-error', () => {
    expect(workflowCode).toContain('pnpm shadcn:analyze');
    // Read per STEP: the one cache save this job carries (the pinned @objectstack
    // build, objectui#12957) must be non-fatal by objectui#7048's rule, so the
    // key may exist in the file -- never on the analyze step, never on a command.
    const steps = workflowCode.split(/\n(?=\s+- (?:name|uses|run):)/);
    const analyze = steps.filter((s) => s.includes('pnpm shadcn:analyze'));
    expect(analyze).toHaveLength(1);
    expect(analyze[0]).not.toContain('continue-on-error');
    for (const s of steps.filter((x) => x.includes('continue-on-error'))) {
      expect(s, 'only a cache save may be non-fatal here').toMatch(/uses: actions\/cache\/save@/);
    }
    // Captured explicitly, the way #3497 captured the check step's.
    expect(workflowCode).toMatch(/pnpm shadcn:analyze 2>&1 \| tee/);
  });

  it('gap ①: the marker step names match the module constants exactly', () => {
    // Pinned against the constants, never re-spelled: a rename on one side only
    // makes every future run read `unknown`, which resets the streak, which
    // means the escalation never fires again — and nothing else would notice.
    expect(workflowCode).toContain(`- name: 'Cross-run marker: registry reachable'`);
    expect(workflowCode).toContain(`- name: 'Cross-run marker: registry unreachable'`);
    expect(MARKER_STEPS.reachable).toBe('Cross-run marker: registry reachable');
    expect(MARKER_STEPS.unreachable).toBe('Cross-run marker: registry unreachable');
    expect(workflowCode).toMatch(/if: steps\.verdict\.outputs\.registry_state == 'reachable'/);
    expect(workflowCode).toMatch(/if: steps\.verdict\.outputs\.registry_state == 'unreachable'/);
  });

  it('gap ①: the cross-run read has the permission it needs', () => {
    expect(workflowCode).toMatch(/^\s*actions:\s*read\s*$/m);
    expect(workflowCode).toMatch(/^\s*issues:\s*write\s*$/m);
  });

  it('the classification runs from the tested module, not from a shell block', () => {
    expect(workflowCode).toContain('node scripts/shadcn-check-report.mjs');
    expect(fs.existsSync(path.join(repoRoot, 'scripts/shadcn-check-report.mjs'))).toBe(true);
  });

  it('one channel: the alarm step is still the single issue writer, still not tolerated', () => {
    const labels = workflowCode.match(/labels: \['maintenance', 'shadcn-sync', 'dependencies'\]/g);
    expect(labels).toHaveLength(1);
    expect(workflowCode.match(/github\.rest\.issues\.create\(/g)).toHaveLength(1);
    expect(workflowCode).toContain(`if: steps.verdict.outputs.alarm == 'true'`);
  });
});
