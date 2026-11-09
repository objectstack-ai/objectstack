import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { readShardMatrix } from '../../../scripts/ci-shard-matrix.mjs';
import { workspaceRoot } from '../workspace-root.mjs';
import { UI_JOBS } from './helpers/root-ci';

/**
 * objectui#13350 -- the steps of the `Test UI` job that make the affected
 * speed, held together by RUNNING them. Since objectstack#25868 the job is
 * `test-ui` in the objectstack monorepo's root `ci.yml`, the workflow that
 * runs this tree's suite; the objectui copy under `ui/.github/` runs nowhere.
 *
 * `Select the tests this change affects` (id `select`) appends the selector's
 * verdict line to `$GITHUB_OUTPUT`; a later step reads one output of that step
 * into an env var and branches on it. The runner splits each appended
 * line at its first `=`, so the line `mode=affected` is the output `mode` with
 * the value `affected`. From objectui#12214 until this card the run step
 * compared its env var with the whole line -- never true -- and every pull
 * request and merge-group build ran the full sixteen-shard suite. Each end was
 * pinned on its own (`select-affected-tests.test.ts` reads the selector's last
 * line, and both commands as text); nothing held the key the first step writes
 * to the key the second reads, or the value it writes to the literal the second
 * compares with.
 *
 * Since objectstack#31914 the matrix is PLANNED, and the chain is five steps in
 * two jobs, every one run here as `ci.yml` writes it:
 *
 *   test-ui-plan  `Select the tests this change affects, for the plan` (the
 *                 leg's select step, held byte-equal below), then `Plan this
 *                 run's Test UI shards` (id `plan`), whose outputs are the
 *                 matrix's `shards`, the `digest` and the `mode`;
 *   test-ui       the select step, `Find this slot's test files` (id `slot`:
 *                 the plan derived again, refused on a digest mismatch), and
 *                 `Run the ui tests (shard N/M)`, which reads the slot step's
 *                 `mode`.
 *
 * So this file restates no end. It extracts each step's `env:` and `run:` from
 * `ci.yml`, runs the select step with bash at the workflow's working directory
 * (the monorepo root) against this checkout -- the real selector, with the
 * merge base a `git` stand-in answers as HEAD -- parses what it appended the
 * way the runner does, and hands each later step whatever outputs its `env:`
 * names. The planner is the real one; `vitest list` is a `pnpm` stand-in that
 * serves one collection (this checkout's tracked test files, and the ones the
 * real selector's filters match), so every step that lists sees the same set,
 * as one commit's runners do. The run step's `pnpm` records its argv.
 * Textual rather than YAML-parsed, for the reason `markdown-test-inputs.test.ts`
 * gives: what is under test is the bytes CI runs. The matrix width M is not
 * spelled here either: the monorepo's `scripts/ci-shard-matrix.mjs` reads it
 * off the job's own `shard:` expression, so resizing the matrix moves every
 * `/M` below with it.
 *
 *   affected  a `pull_request` and a `merge_group` event plan the selected
 *             files into N slots, and the N legs run them, each file once.
 *   full      a `push` event, a pull request with no base ref and one whose
 *             merge base cannot be computed (the fail-open paths) plan all M
 *             slots, each leg running `--shard=k/M` of the whole suite.
 *   dead plan a plan job that published nothing: the matrix falls back to all
 *             M slots, and every leg runs its `--shard=k/M` of the whole suite.
 *   refusals  a leg whose derived plan is not the matrix's, or whose selector
 *             answers `full` under an affected plan, stops red.
 *   controls  the run step's comparison reverted to the whole line, and the
 *             slot step's output written under another key or value, each
 *             ALONE, put the leg on the full suite; the plan job's select step
 *             doing the same plans the full suite -- so this file cannot pass
 *             while two ends disagree.
 */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
/** Where the workflow runs: its steps' working directory, and the home of `.github/`. */
const workflowRoot = workspaceRoot(repoRoot);
const CI_YML = path.join(workflowRoot, '.github', 'workflows', 'ci.yml');
const YAML = fs.readFileSync(CI_YML, 'utf8');
/** The `test-ui` matrix: its slot roster, read from the workflow by the one reader of shard sizes. */
const MATRIX = readShardMatrix(YAML, UI_JOBS.test);
const SHARDS = MATRIX.total;
const PLAN_JOB = 'test-ui-plan';

const SELECT_HEADER = '      - name: Select the tests this change affects\n';
const PLAN_SELECT_HEADER = '      - name: Select the tests this change affects, for the plan\n';
const PLAN_HEADER = "      - name: Plan this run's Test UI shards\n";
const SLOT_HEADER = "      - name: Find this slot's test files\n";
const RUN_HEADER = `      - name: Run the ui tests (shard \${{ matrix.shard }}/${SHARDS})\n`;
/** An output reference a step's `env:` value is: `${{ steps.<id>.outputs.<key> }}`. */
const STEP_OUTPUT = /^\$\{\{ steps\.([A-Za-z0-9_-]+)\.outputs\.([A-Za-z0-9_-]+) \}\}$/;

type Step = { at: number; id: string | undefined; env: Array<[string, string]>; run: string };

/** One step of `ci.yml`, from its `- name:` line to the first line outside it. */
function readStep(yaml: string, header: string): Step {
  const at = yaml.indexOf(header);
  if (at === -1) throw new Error(`ci.yml has no step headed ${JSON.stringify(header.trim())}`);
  if (yaml.indexOf(header, at + header.length) !== -1) {
    throw new Error(`ci.yml has two steps headed ${JSON.stringify(header.trim())}`);
  }
  const lines: string[] = [];
  for (const line of yaml.slice(at + header.length).split('\n')) {
    if (line.trim() !== '' && !line.startsWith('        ')) break;
    lines.push(line);
  }
  const id = lines.map((line) => /^ {8}id: (\S+)$/.exec(line)?.[1]).find(Boolean);

  const env: Array<[string, string]> = [];
  const envAt = lines.findIndex((line) => /^ {8}env:$/.test(line));
  if (envAt !== -1) {
    for (const line of lines.slice(envAt + 1)) {
      const entry = /^ {10}([A-Za-z_][A-Za-z0-9_]*): (.+)$/.exec(line);
      if (!entry) break;
      env.push([entry[1], entry[2]]);
    }
  }

  const runAt = lines.findIndex((line) => /^ {8}run: \|$/.test(line));
  if (runAt === -1) throw new Error(`${header.trim()} has no \`run: |\` block`);
  const body: string[] = [];
  for (const line of lines.slice(runAt + 1)) {
    if (line.trim() !== '' && !line.startsWith('          ')) break;
    body.push(line.slice(10));
  }
  return { at, id, env, run: `${body.join('\n').trimEnd()}\n` };
}

/** The job a step sits in: the last `  <key>:` job line before it. */
function jobOf(at: number): string {
  const keys = [...YAML.slice(0, at).matchAll(/^ {2}([A-Za-z0-9_-]+):\s*$/gm)];
  return keys[keys.length - 1]?.[1] ?? '';
}

const SELECT = readStep(YAML, SELECT_HEADER);
const PLAN_SELECT = readStep(YAML, PLAN_SELECT_HEADER);
const PLAN = readStep(YAML, PLAN_HEADER);
const SLOT = readStep(YAML, SLOT_HEADER);
const RUN = readStep(YAML, RUN_HEADER);

/** The env var of `step` that carries an output of step `from`, and that output's key. */
function binding(step: Step, from: string): { variable: string; key: string } {
  const bound = step.env.flatMap(([variable, value]) => {
    const ref = STEP_OUTPUT.exec(value);
    return ref && ref[1] === from ? [{ variable, key: ref[2] }] : [];
  });
  if (bound.length !== 1) throw new Error(`a step binds ${bound.length} outputs of step \`${from}\`; this file reads exactly one`);
  return bound[0];
}

/* ── the runner, as far as these steps need it ──────────────────────────── */

/** `base` is the pull request's base REF, or the merge group's base sha. */
type Event = { name: 'pull_request' | 'merge_group' | 'push'; base: string };
type Outputs = Record<string, string>;
/** What one step's `${{ … }}` can read: earlier steps' outputs by id, the plan job's outputs, the leg's shard. */
type Context = { steps?: Record<string, Outputs>; plan?: Outputs; shard?: number };

/** `${{ … }}` resolved the way the runner would for this event. */
function expand(text: string, event: Event, temp: string, ctx: Context = {}): string {
  return text.replace(/\$\{\{ ([^}]+?) \}\}/g, (whole, expr: string) => {
    const ref = STEP_OUTPUT.exec(whole);
    if (ref) return ctx.steps?.[ref[1]]?.[ref[2]] ?? ''; // an output never written reads as ''
    const planned = new RegExp(`^needs\\.${PLAN_JOB}\\.outputs\\.([A-Za-z0-9_-]+)$`).exec(expr);
    if (planned) return ctx.plan?.[planned[1]] ?? '';
    switch (expr) {
      case 'github.event_name':
        return event.name;
      case 'github.event.pull_request.base.ref':
        return event.name === 'pull_request' ? event.base : '';
      case 'github.event.merge_group.base_sha':
        return event.name === 'merge_group' ? event.base : '';
      case 'matrix.shard':
        return String(ctx.shard ?? 1);
      case 'runner.temp':
        return temp;
      default:
        throw new Error(`no stand-in for \`\${{ ${expr} }}\`; add one here before reading this step`);
    }
  });
}

/** `$GITHUB_OUTPUT` read the way the runner reads it: each line split at its first `=`. */
function parseOutputs(text: string): Outputs {
  const outputs: Outputs = {};
  for (const line of text.split('\n')) {
    if (line === '') continue;
    const eq = line.indexOf('=');
    if (eq === -1) throw new Error(`\`${line}\` is not a key=value output line (a heredoc output needs a reader here)`);
    outputs[line.slice(0, eq)] = line.slice(eq + 1);
  }
  return outputs;
}

let scratch: string;
const nodeDir = path.dirname(process.execPath);

/** Write an executable stand-in for `name` into a fresh bin directory. */
function standIn(name: string, body: string): string {
  const bin = fs.mkdtempSync(path.join(scratch, `bin-${name}-`));
  fs.writeFileSync(path.join(bin, name), `#!/usr/bin/env bash\n${body}`, { mode: 0o755 });
  return bin;
}

type Ran = { outputs: Outputs; log: string; status: number | null; err: string };

/** Run one step with `bash -e` as the runner does, in `temp` as its `RUNNER_TEMP`. */
function runStep(step: Step, event: Event, temp: string, ctx: Context, bins: Array<string | undefined>, extraEnv: Outputs = {}, run = step.run): Ran {
  const env = Object.fromEntries(step.env.map(([name, value]) => [name, expand(value, event, temp, ctx)]));
  const script = path.join(temp, 'step.sh');
  fs.writeFileSync(script, expand(run, event, temp, ctx));
  const githubOutput = path.join(temp, 'github-output');
  fs.writeFileSync(githubOutput, '');
  const result = spawnSync('bash', ['-e', script], {
    cwd: workflowRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      ...env,
      ...extraEnv,
      RUNNER_TEMP: temp,
      GITHUB_OUTPUT: githubOutput,
      GITHUB_WORKSPACE: workflowRoot,
      PATH: [...bins, nodeDir, process.env.PATH].filter(Boolean).join(path.delimiter),
    },
  });
  return { outputs: parseOutputs(fs.readFileSync(githubOutput, 'utf8')), log: result.stdout, status: result.status, err: result.stderr };
}

/** A step that must succeed. */
function ok(ran: Ran, what: string): Ran {
  if (ran.status !== 0) throw new Error(`the ${what} step exited ${ran.status}:\n${ran.log}${ran.err}`);
  return ran;
}

/** Run the select step (`step`: the leg's or the plan job's), `node` optionally the replay stand-in. */
function runSelect(event: Event, temp: string, bin?: string, extraEnv: Outputs = {}, step = SELECT): Ran {
  return ok(runStep(step, event, temp, {}, [bin, gitBin], extraEnv), 'select');
}

/** The plan job's plan step, after its select step left `selected` in the same `temp`. */
function runPlan(event: Event, temp: string, selected: Outputs, run = PLAN.run): Ran {
  return ok(runStep(PLAN, event, temp, { steps: { [SELECT.id!]: selected } }, [lister], {}, run), 'plan');
}

/** One leg's slot step: its own select outputs, the plan job's outputs, its shard. */
function runSlot(event: Event, temp: string, selected: Outputs, plan: Outputs, shard: number): Ran {
  return runStep(SLOT, event, temp, { steps: { [SELECT.id!]: selected }, plan, shard }, [lister]);
}

type Shard = { argv: string[]; log: string };

/** How the run step's `pnpm` argv starts on each speed: the suite runs from ui/, the vitest root. */
const FULL_ARGV = ['--dir', 'ui', 'run', 'test'];
const AFFECTED_ARGV = ['--dir', 'ui', 'exec', 'vitest', 'run'];

/** Run the shard step with the outputs the slot step left, `pnpm` recording its argv. */
function runShard(event: Event, temp: string, slot: Outputs, shard = 1, run = RUN.run): Shard {
  const argvFile = path.join(temp, 'pnpm-argv');
  const bin = standIn('pnpm', `printf '%s\\n' "$@" > ${JSON.stringify(argvFile)}\n`);
  const ran = ok(runStep(RUN, event, temp, { steps: { [SLOT.id!]: slot }, shard }, [bin], {}, run), 'shard');
  return { argv: fs.readFileSync(argvFile, 'utf8').split('\n').slice(0, -1), log: ran.log };
}

/** The files a leg's run step handed vitest: its argv after the last flag. */
function filesOf(argv: string[]): string[] {
  let last = -1;
  argv.forEach((arg, i) => {
    if (arg.startsWith('-')) last = i;
  });
  return argv.slice(last + 1);
}

/* ── one real selector run, replayed where only the wiring is in question ── */

let head = '';
/** The base ref every pull_request leg names; the `git` stand-in answers its merge base as HEAD. */
const BASE_REF = 'main';
/** A `git` that answers `merge-base` with HEAD and records what it was asked; every other call is the real git. */
let gitBin = '';
let mergeBaseArgv = '';
/** The real selector's answer on this checkout, taken through the real select step. */
let real: Ran & { filters: string[]; temp: string } = { outputs: {}, log: '', status: 0, err: '', filters: [], temp: '' };
/** A `node` that replays `real` for the select step, so each leg does not re-walk the tree. */
let replay = '';
/** A `pnpm` whose `vitest list` serves one collection; any other call fails the step. */
let lister = '';
/** The ui-relative paths the stand-in collection holds: all of them, and the ones the real filters match. */
let collected: string[] = [];
let selectedPaths: string[] = [];

function freshTemp(leg: string): string {
  return fs.mkdtempSync(path.join(scratch, `${leg}-`));
}

beforeAll(() => {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'select-affected-wiring-13350-'));
  head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim();
  const realGit = execFileSync('bash', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
  mergeBaseArgv = path.join(scratch, 'merge-base-argv');
  gitBin = standIn(
    'git',
    [
      'if [ "$1" = merge-base ]; then',
      `  printf '%s\\n' "$@" > ${JSON.stringify(mergeBaseArgv)}`,
      '  if [ -n "$OS_TEST_MERGE_BASE_FAILS" ]; then exit 1; fi',
      `  exec ${JSON.stringify(realGit)} rev-parse HEAD`,
      'fi',
      `exec ${JSON.stringify(realGit)} "$@"`,
      '',
    ].join('\n'),
  );
  const temp = freshTemp('real');
  // The select step itself names these two files under `$RUNNER_TEMP`.
  const filters = path.join(temp, 'affected-tests.txt');
  const stdout = path.join(temp, 'select.out');
  real = { ...runSelect({ name: 'pull_request', base: BASE_REF }, temp), filters: [], temp };
  real.filters = fs.readFileSync(filters, 'utf8').split('\n').filter(Boolean);
  replay = standIn(
    'node',
    [
      'while [ "$#" -gt 0 ]; do',
      `  if [ "$1" = '--out' ]; then cp ${JSON.stringify(filters)} "$2"; fi`,
      '  shift',
      'done',
      `cat ${JSON.stringify(stdout)}`,
      '',
    ].join('\n'),
  );

  // One collection for every step that lists: this checkout's tracked test
  // files, and the subset the real filters reach (a vitest filter is a
  // substring of the path, relative to the ui root).
  collected = execFileSync('git', ['ls-files', '--', '.'], { cwd: repoRoot, encoding: 'utf8' })
    .split('\n')
    .filter((file) => /\.(test|spec)\.[cm]?[jt]sx?$/.test(file) && !file.startsWith('e2e/'));
  selectedPaths = collected.filter((file) => real.filters.some((filter) => file.includes(filter)));
  const asList = (files: string[]) => JSON.stringify(files.map((file) => ({ file: path.join(repoRoot, file), projectName: 'unit' })));
  const all = path.join(scratch, 'list-all.json');
  const selected = path.join(scratch, 'list-selected.json');
  fs.writeFileSync(all, asList(collected));
  fs.writeFileSync(selected, asList(selectedPaths));
  const wanted = path.join(scratch, 'filters');
  fs.writeFileSync(wanted, real.filters.map((f) => `${f}\n`).join(''));
  lister = standIn(
    'pnpm',
    [
      'if [ "$1 $2 $3 $4 $5 $6" != "--dir ui exec vitest list --filesOnly" ]; then echo "pnpm stand-in: not a vitest list: $*" >&2; exit 64; fi',
      'out="${7#--json=}"',
      'shift 7',
      `if [ "$#" -eq 0 ]; then cp ${JSON.stringify(all)} "$out"; exit 0; fi`,
      `if [ "$(printf '%s\\n' "$@")" != "$(cat ${JSON.stringify(wanted)})" ]; then echo "pnpm stand-in: listed filters other than the selector's" >&2; exit 65; fi`,
      `cp ${JSON.stringify(selected)} "$out"`,
      '',
    ].join('\n'),
  );
}, 60_000);

afterAll(() => {
  if (scratch) fs.rmSync(scratch, { recursive: true, force: true });
});

/** The whole chain for one event: the plan job, then every leg its matrix starts. */
function runRun(event: Event, legSelect: (temp: string) => Ran, planSelected: Outputs, planTemp: string) {
  const plan = runPlan(event, planTemp, planSelected).outputs;
  const legs = (JSON.parse(plan.shards) as number[]).map((shard) => {
    const temp = freshTemp(`leg-${shard}`);
    const selected = legSelect(temp);
    const slot = ok(runSlot(event, temp, selected.outputs, plan, shard), 'slot');
    return { shard, slot, run: runShard(event, temp, slot.outputs, shard) };
  });
  return { plan, legs };
}

/* ── the steps ───────────────────────────────────────────────────────────── */

describe('the steps, as ci.yml writes them (objectui#13350, objectstack#31914)', () => {
  it('declares select, slot and run in the leg job, in that order, each reading exactly one output of the step before', () => {
    expect(SELECT.id).toBe('select');
    expect(SLOT.id).toBe('slot');
    expect(SELECT.at).toBeLessThan(SLOT.at);
    expect(SLOT.at).toBeLessThan(RUN.at);
    for (const step of [SELECT, SLOT, RUN]) expect(jobOf(step.at)).toBe(UI_JOBS.test);
    expect(binding(SLOT, 'select').key).not.toBe('');
    expect(binding(RUN, 'slot').key).not.toBe('');
    expect(() => binding(RUN, 'select')).toThrow(/binds 0 outputs/);
  });

  it('plans in its own job, from a select step that is the leg’s byte for byte', () => {
    expect(jobOf(PLAN_SELECT.at)).toBe(PLAN_JOB);
    expect(jobOf(PLAN.at)).toBe(PLAN_JOB);
    expect(PLAN_SELECT.id).toBe(SELECT.id);
    expect(PLAN_SELECT.env).toEqual(SELECT.env);
    expect(PLAN_SELECT.run).toBe(SELECT.run);
    expect(PLAN.id).toBe('plan');
    expect(binding(PLAN, 'select').key).toBe(binding(SLOT, 'select').key);
    // The plan job publishes the step's three outputs, and the matrix reads `shards`.
    const job = YAML.slice(YAML.indexOf(`\n  ${PLAN_JOB}:\n`), PLAN_SELECT.at);
    for (const key of ['shards', 'digest', 'mode']) expect(job).toContain(`      ${key}: \${{ steps.plan.outputs.${key} }}\n`);
    expect(MATRIX.form).toBe('planned');
    expect(YAML).toContain(`        shard: \${{ fromJSON(needs.${PLAN_JOB}.outputs.shards || '${JSON.stringify(MATRIX.values).replaceAll(',', ', ')}') }}\n`);
  });

  it('a pull_request diffs from the merge base of origin/<base ref> and HEAD, never the frozen payload sha', () => {
    expect(fs.readFileSync(mergeBaseArgv, 'utf8').split('\n').filter(Boolean)).toEqual([
      'merge-base',
      `refs/remotes/origin/${BASE_REF}`,
      'HEAD',
    ]);
    expect(real.log).toContain(`Diff base: ${head}`);
    expect(SELECT.env.map(([name]) => name)).not.toContain('PR_BASE');
  });

  it('a pull_request plans the selected files into N slots, and the N legs run each of them exactly once', () => {
    expect(real.filters.length).toBeGreaterThan(0);
    expect(selectedPaths.length).toBeGreaterThan(0);
    const event: Event = { name: 'pull_request', base: BASE_REF };
    // The plan job's select ran on its own runner: the same `RUNNER_TEMP` its plan step reads.
    const { plan, legs } = runRun(event, (temp) => runSelect(event, temp, replay), real.outputs, real.temp);
    expect(plan.mode).toBe('affected');
    const shards = JSON.parse(plan.shards) as number[];
    expect(shards.length).toBeGreaterThan(0);
    expect(shards.length).toBeLessThanOrEqual(SHARDS);
    expect(shards).toEqual(shards.map((_, i) => i + 1));
    const ran: string[] = [];
    for (const { shard, slot, run } of legs) {
      expect(slot.outputs).toEqual({ mode: 'affected' });
      expect(run.argv.slice(0, AFFECTED_ARGV.length)).toEqual(AFFECTED_ARGV);
      expect(run.argv.some((arg) => arg.startsWith('--shard'))).toBe(false);
      expect(run.argv).toContain('--reporter=json');
      const files = filesOf(run.argv);
      expect(run.log).toContain(`Affected speed: ${files.length} test file(s) planned into slot ${shard} of ${SHARDS}.`);
      ran.push(...files);
    }
    expect([...ran].sort()).toEqual([...selectedPaths].sort());
  });

  it('a merge_group build plans the same slots from the same filters', () => {
    const event: Event = { name: 'merge_group', base: head };
    const temp = freshTemp('queue-plan');
    const selected = runSelect(event, temp, replay, {}, PLAN_SELECT);
    expect(selected.outputs).toEqual(real.outputs);
    const queued = runPlan(event, temp, selected.outputs).outputs;
    const pr = runPlan({ name: 'pull_request', base: BASE_REF }, real.temp, real.outputs).outputs;
    expect(queued).toEqual(pr);
  });

  it('a push plans the whole suite on every slot, each leg its --shard of it', () => {
    const event: Event = { name: 'push', base: '' };
    const temp = freshTemp('push-plan');
    const { plan, legs } = runRun(event, (t) => runSelect(event, t, replay), runSelect(event, temp, replay, {}, PLAN_SELECT).outputs, temp);
    expect(plan.mode).toBe('full');
    expect(JSON.parse(plan.shards)).toEqual(MATRIX.values);
    for (const { shard, run } of [legs[0], legs[legs.length - 1]]) {
      expect(run.argv.slice(0, FULL_ARGV.length)).toEqual(FULL_ARGV);
      expect(run.argv).toContain(`--shard=${shard}/${SHARDS}`);
      expect(run.argv).toContain('--reporter=json');
      expect(run.argv.filter((arg) => real.filters.includes(arg))).toEqual([]);
    }
  });

  it('a pull request with no base ref plans the whole suite (the step fails open)', () => {
    const event: Event = { name: 'pull_request', base: '' };
    const temp = freshTemp('no-base');
    const selected = runSelect(event, temp, replay, {}, PLAN_SELECT);
    expect(selected.log).toContain('running the full suite rather than guessing');
    const plan = runPlan(event, temp, selected.outputs).outputs;
    expect(plan.mode).toBe('full');
    expect(JSON.parse(plan.shards)).toEqual(MATRIX.values);
  });

  it('a pull request whose merge base cannot be computed plans the whole suite (the step fails open)', () => {
    const event: Event = { name: 'pull_request', base: BASE_REF };
    const temp = freshTemp('no-merge-base');
    const selected = runSelect(event, temp, replay, { OS_TEST_MERGE_BASE_FAILS: '1' }, PLAN_SELECT);
    expect(selected.log).toContain('running the full suite rather than guessing');
    expect(selected.outputs[binding(PLAN, 'select').key]).toBe('full');
    expect(runPlan(event, temp, selected.outputs).outputs.mode).toBe('full');
  });
});

describe('a dead plan falls back to every slot, each a full leg (objectstack#31914)', () => {
  it('the legs start when the plan job fails, on the matrix’s full roster', () => {
    // A failed or skipped plan job publishes no output, which reads as ''.
    const job = YAML.slice(YAML.indexOf(`\n  ${UI_JOBS.test}:\n`), SELECT.at);
    const ifLine = /^ {4}if: (.+)$/m.exec(job)?.[1] ?? '';
    expect(ifLine.startsWith('${{ !cancelled() && ')).toBe(true); // a failed `needs` does not skip the legs
    expect(ifLine).toContain(`needs.${PLAN_JOB}.outputs.shards != '[]'`); // '' is not '[]'
    expect(job).toMatch(new RegExp(`^ {4}needs: \\[[^\\]]*\\b${PLAN_JOB}\\b`, 'm'));
    expect(MATRIX.values).toEqual(Array.from({ length: SHARDS }, (_, i) => i + 1));
  });

  it('every leg of a dead plan runs its --shard of the whole suite, even when its own selector says affected', () => {
    const event: Event = { name: 'pull_request', base: BASE_REF };
    for (const shard of [1, SHARDS]) {
      const temp = freshTemp(`dead-${shard}`);
      const selected = runSelect(event, temp, replay);
      expect(selected.outputs[binding(SLOT, 'select').key]).toBe('affected');
      const slot = ok(runSlot(event, temp, selected.outputs, {}, shard), 'slot');
      expect(slot.outputs).toEqual({ mode: 'full' });
      expect(slot.log).toContain('published no plan');
      const plan = JSON.parse(fs.readFileSync(path.join(temp, 'test-ui-plan.json'), 'utf8'));
      expect(plan.mode).toBe('full');
      const run = runShard(event, temp, slot.outputs, shard);
      expect(run.argv.slice(0, FULL_ARGV.length)).toEqual(FULL_ARGV);
      expect(run.argv).toContain(`--shard=${shard}/${SHARDS}`);
    }
  });
});

describe('a leg refuses a plan it did not derive', () => {
  const event: Event = { name: 'pull_request', base: BASE_REF };

  it('a digest that is not this leg’s plan stops the leg before it runs a file', () => {
    const plan = runPlan(event, real.temp, real.outputs).outputs;
    const temp = freshTemp('wrong-digest');
    const slot = runSlot(event, temp, runSelect(event, temp, replay).outputs, { ...plan, digest: '0'.repeat(64) }, 1);
    expect(slot.status).not.toBe(0);
    expect(slot.err).toContain('is not the plan the matrix was built from');
    expect(fs.existsSync(path.join(temp, 'slot-tests.txt'))).toBe(false);
  });

  it('a leg whose selector answers full under an affected plan stops, never runs a full leg in a partial matrix', () => {
    const plan = runPlan(event, real.temp, real.outputs).outputs;
    const temp = freshTemp('disagree');
    const slot = runSlot(event, temp, { [binding(SLOT, 'select').key]: 'full' }, plan, 1);
    expect(slot.status).not.toBe(0);
    expect(slot.log).toContain("this leg's selector answered 'full'");
  });
});

describe('controls: either end edited alone is a full run, so the legs above cannot pass by accident', () => {
  const event: Event = { name: 'pull_request', base: BASE_REF };
  /** A leg of the real affected plan: its slot step's outputs, in its own temp. */
  function affectedLeg() {
    const plan = runPlan(event, real.temp, real.outputs).outputs;
    const temp = freshTemp('control');
    const slot = ok(runSlot(event, temp, runSelect(event, temp, replay).outputs, plan, 1), 'slot');
    expect(slot.outputs).toEqual({ mode: 'affected' });
    return { temp, slot: slot.outputs };
  }

  it('the run step comparing against the whole verdict line (the objectui#13350 defect) runs the whole suite', () => {
    const { variable, key } = binding(RUN, 'slot');
    const comparison = new RegExp(`\\[ "\\$${variable}" = '([^']*)' \\]`);
    const found = comparison.exec(RUN.run);
    expect(found, `the run step no longer compares $${variable} with a quoted literal; rewrite this control`).not.toBeNull();
    const reverted = RUN.run.replace(comparison, `[ "$${variable}" = '${key}=${found![1]}' ]`);
    expect(reverted).not.toBe(RUN.run);
    const { temp, slot } = affectedLeg();
    const shard = runShard(event, temp, slot, 1, reverted);
    expect(shard.argv.slice(0, FULL_ARGV.length)).toEqual(FULL_ARGV);
  });

  it('the slot step writing its verdict under another key runs the whole suite', () => {
    const { temp, slot } = affectedLeg();
    const renamed = Object.fromEntries(Object.entries(slot).map(([key, value]) => [`${key}_renamed`, value]));
    expect(runShard(event, temp, renamed).argv.slice(0, FULL_ARGV.length)).toEqual(FULL_ARGV);
  });

  it('the slot step writing another value under the same key runs the whole suite', () => {
    const { key } = binding(RUN, 'slot');
    const { temp, slot } = affectedLeg();
    expect(slot[key], `the slot step wrote no \`${key}\` output`).toBeDefined();
    expect(runShard(event, temp, { ...slot, [key]: `${slot[key]}-renamed` }).argv.slice(0, FULL_ARGV.length)).toEqual(FULL_ARGV);
  });

  it('the plan job’s select step writing its verdict under another key plans the whole suite', () => {
    const renamed = Object.fromEntries(Object.entries(real.outputs).map(([key, value]) => [`${key}_renamed`, value]));
    const plan = runPlan(event, real.temp, renamed).outputs;
    expect(plan.mode).toBe('full');
    expect(JSON.parse(plan.shards)).toEqual(MATRIX.values);
  });
});
