import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * objectui#13350 — the two steps of the `test` job that make the affected
 * speed, held together by RUNNING them.
 *
 * `Select the tests this change affects` (id `select`) appends the selector's
 * verdict line to `$GITHUB_OUTPUT`; `Run tests (shard N/16)` reads one output of
 * that step into an env var and branches on it. The runner splits each appended
 * line at its first `=`, so the line `mode=affected` is the output `mode` with
 * the value `affected`. From objectui#12214 until this card the run step
 * compared its env var with the whole line -- never true -- and every pull
 * request and merge-group build ran the full sixteen-shard suite. Each end was
 * pinned on its own (`select-affected-tests.test.ts` reads the selector's last
 * line, and both commands as text); nothing held the key the first step writes
 * to the key the second reads, or the value it writes to the literal the second
 * compares with.
 *
 * So this file restates neither end. It extracts both steps' `env:` and `run:`
 * from `ci.yml`, runs the select step with bash against this checkout -- the
 * real selector, based on HEAD -- parses what it appended the way the runner
 * does, hands the run step whatever output its `env:` names, and reads which
 * command the run step chose off a `pnpm` stand-in that records its argv.
 * Textual rather than YAML-parsed, for the reason `markdown-test-inputs.test.ts`
 * gives: what is under test is the bytes CI runs.
 *
 *   affected  a `pull_request` and a `merge_group` event hand vitest exactly the
 *             filters the selector wrote.
 *   full      a `push` event, and a pull request with no base sha (the
 *             fail-open path), run the whole suite.
 *   controls  the run step's comparison reverted to the whole line, and the
 *             select step's output written under another key or value, each
 *             ALONE, put a pull request on the full suite -- so this file
 *             cannot pass while the two ends disagree.
 */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const CI_YML = path.join(repoRoot, '.github', 'workflows', 'ci.yml');

const SELECT_HEADER = '      - name: Select the tests this change affects\n';
const RUN_HEADER = '      - name: Run tests (shard ${{ matrix.shard }}/16)\n';
/** The output reference a run step's `env:` value is, when it reads the select step. */
const SELECT_OUTPUT = /^\$\{\{ steps\.select\.outputs\.([A-Za-z0-9_-]+) \}\}$/;

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

const YAML = fs.readFileSync(CI_YML, 'utf8');
const SELECT = readStep(YAML, SELECT_HEADER);
const RUN = readStep(YAML, RUN_HEADER);

/** The run step's env var that carries a select-step output, and that output's key. */
function modeBinding(): { variable: string; key: string } {
  const bound = RUN.env.flatMap(([variable, value]) => {
    const key = SELECT_OUTPUT.exec(value)?.[1];
    return key ? [{ variable, key }] : [];
  });
  if (bound.length !== 1) throw new Error(`the run step binds ${bound.length} select-step outputs; this file reads exactly one`);
  return bound[0];
}

/* ── the runner, as far as these two steps need it ──────────────────────── */

type Event = { name: 'pull_request' | 'merge_group' | 'push'; base: string };

/** `${{ … }}` resolved the way the runner would for this event, shard 1. */
function expand(text: string, event: Event, temp: string, outputs: Record<string, string> = {}): string {
  return text.replace(/\$\{\{ ([^}]+?) \}\}/g, (whole, expr: string) => {
    const output = SELECT_OUTPUT.exec(whole)?.[1];
    if (output !== undefined) return outputs[output] ?? ''; // an output never written reads as ''
    switch (expr) {
      case 'github.event_name':
        return event.name;
      case 'github.event.pull_request.base.sha':
        return event.name === 'pull_request' ? event.base : '';
      case 'github.event.merge_group.base_sha':
        return event.name === 'merge_group' ? event.base : '';
      case 'matrix.shard':
        return '1';
      case 'runner.temp':
        return temp;
      default:
        throw new Error(`no stand-in for \`\${{ ${expr} }}\`; add one here before reading this step`);
    }
  });
}

/** `$GITHUB_OUTPUT` read the way the runner reads it: each line split at its first `=`. */
function parseOutputs(text: string): Record<string, string> {
  const outputs: Record<string, string> = {};
  for (const line of text.split('\n')) {
    if (line === '') continue;
    const eq = line.indexOf('=');
    if (eq === -1) throw new Error(`\`${line}\` is not a key=value output line (a heredoc output needs a reader here)`);
    outputs[line.slice(0, eq)] = line.slice(eq + 1);
  }
  return outputs;
}

let scratch = '';
const nodeDir = path.dirname(process.execPath);

/** Write an executable stand-in for `name` into a fresh bin directory. */
function standIn(name: string, body: string): string {
  const bin = fs.mkdtempSync(path.join(scratch, `bin-${name}-`));
  fs.writeFileSync(path.join(bin, name), `#!/usr/bin/env bash\n${body}`, { mode: 0o755 });
  return bin;
}

type Selected = { outputs: Record<string, string>; log: string };

/** Run the select step, with `bash -e` as the runner does, in a fresh `RUNNER_TEMP`. */
function runSelect(event: Event, temp: string, bin?: string): Selected {
  const env = Object.fromEntries(SELECT.env.map(([name, value]) => [name, expand(value, event, temp)]));
  const script = path.join(temp, 'select.sh');
  fs.writeFileSync(script, expand(SELECT.run, event, temp));
  const githubOutput = path.join(temp, 'github-output-select');
  fs.writeFileSync(githubOutput, '');
  const run = spawnSync('bash', ['-e', script], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      ...env,
      RUNNER_TEMP: temp,
      GITHUB_OUTPUT: githubOutput,
      PATH: [bin, nodeDir, process.env.PATH].filter(Boolean).join(path.delimiter),
    },
  });
  if (run.status !== 0) throw new Error(`the select step exited ${run.status}:\n${run.stdout}${run.stderr}`);
  return { outputs: parseOutputs(fs.readFileSync(githubOutput, 'utf8')), log: run.stdout };
}

type Shard = { argv: string[]; log: string };

/** Run the shard step with the outputs the select step left, `pnpm` recording its argv. */
function runShard(event: Event, temp: string, outputs: Record<string, string>, run = RUN.run): Shard {
  const env = Object.fromEntries(RUN.env.map(([name, value]) => [name, expand(value, event, temp, outputs)]));
  const script = path.join(temp, 'shard.sh');
  fs.writeFileSync(script, expand(run, event, temp, outputs));
  const argvFile = path.join(temp, 'pnpm-argv');
  const bin = standIn('pnpm', `printf '%s\\n' "$@" > ${JSON.stringify(argvFile)}\n`);
  const result = spawnSync('bash', ['-e', script], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, ...env, RUNNER_TEMP: temp, PATH: `${bin}${path.delimiter}${process.env.PATH}` },
  });
  if (result.status !== 0) throw new Error(`the shard step exited ${result.status}:\n${result.stdout}${result.stderr}`);
  return { argv: fs.readFileSync(argvFile, 'utf8').split('\n').slice(0, -1), log: result.stdout };
}

/* ── one real selector run, replayed where only the wiring is in question ── */

let head = '';
/** The real selector's answer on this checkout, taken through the real select step. */
let real: Selected & { filters: string[]; temp: string } = { outputs: {}, log: '', filters: [], temp: '' };
/** A `node` that replays `real` for the select step, so each leg does not re-walk the tree. */
let replay = '';

function freshTemp(leg: string): string {
  return fs.mkdtempSync(path.join(scratch, `${leg}-`));
}

beforeAll(() => {
  scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'select-affected-wiring-13350-'));
  head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoRoot, encoding: 'utf8' }).trim();
  const temp = freshTemp('real');
  // The select step itself names these two files under `$RUNNER_TEMP`.
  const filters = path.join(temp, 'affected-tests.txt');
  const stdout = path.join(temp, 'select.out');
  real = { ...runSelect({ name: 'pull_request', base: head }, temp), filters: [], temp };
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
}, 60_000);

afterAll(() => {
  if (scratch) fs.rmSync(scratch, { recursive: true, force: true });
});

/* ── the two steps ───────────────────────────────────────────────────────── */

describe('the affected speed, both steps run as ci.yml writes them (objectui#13350)', () => {
  it('declares both in one job, the select step first, the run step reading exactly one of its outputs', () => {
    expect(SELECT.id).toBe('select');
    expect(SELECT.at).toBeLessThan(RUN.at);
    // `steps.<id>` resolves only inside its own job: no job key between the two.
    const between = YAML.slice(SELECT.at, RUN.at)
      .split('\n')
      .filter((line) => !/^\s*#/.test(line));
    expect(between.filter((line) => /^ {2}[A-Za-z0-9_-]+:\s*$/.test(line))).toEqual([]);
    expect(modeBinding().key).not.toBe('');
  });

  it('a pull_request hands vitest exactly the filters the real selector wrote', () => {
    expect(real.filters.length).toBeGreaterThan(0);
    // The same `RUNNER_TEMP` the select step wrote its filters into, as one job's steps share it.
    const shard = runShard({ name: 'pull_request', base: head }, real.temp, real.outputs);
    expect(shard.argv.slice(-real.filters.length)).toEqual(real.filters);
    expect(shard.argv).toContain('--shard=1/16');
    expect(shard.log).toContain(`Affected speed: ${real.filters.length} vitest filter(s), shard 1 of 16.`);
  });

  it('a merge_group build hands vitest the same filters', () => {
    const temp = freshTemp('queue');
    const event: Event = { name: 'merge_group', base: head };
    const selected = runSelect(event, temp, replay);
    expect(selected.outputs).toEqual(real.outputs);
    const shard = runShard(event, temp, selected.outputs);
    expect(shard.argv.slice(-real.filters.length)).toEqual(real.filters);
  });

  it('a push runs the whole suite', () => {
    const temp = freshTemp('push');
    const event: Event = { name: 'push', base: '' };
    const shard = runShard(event, temp, runSelect(event, temp, replay).outputs);
    expect(shard.argv[0]).toBe('test');
    expect(shard.argv).toContain('--shard=1/16');
    expect(shard.argv.filter((arg) => real.filters.includes(arg))).toEqual([]);
  });

  it('a pull request with no base sha runs the whole suite (the step fails open)', () => {
    const temp = freshTemp('no-base');
    const event: Event = { name: 'pull_request', base: '' };
    const selected = runSelect(event, temp, replay);
    expect(selected.log).toContain('running the full suite rather than guessing');
    const shard = runShard(event, temp, selected.outputs);
    expect(shard.argv[0]).toBe('test');
  });
});

describe('controls: either end edited alone is a full run, so the legs above cannot pass by accident', () => {
  it('the run step comparing against the whole verdict line (the objectui#13350 defect) runs the whole suite', () => {
    const { variable, key } = modeBinding();
    const comparison = new RegExp(`\\[ "\\$${variable}" = '([^']*)' \\]`);
    const found = comparison.exec(RUN.run);
    expect(found, `the run step no longer compares $${variable} with a quoted literal; rewrite this control`).not.toBeNull();
    const reverted = RUN.run.replace(comparison, `[ "$${variable}" = '${key}=${found![1]}' ]`);
    expect(reverted).not.toBe(RUN.run);
    const shard = runShard({ name: 'pull_request', base: head }, freshTemp('reverted'), real.outputs, reverted);
    expect(shard.argv[0]).toBe('test');
  });

  it('the select step writing its verdict under another key runs the whole suite', () => {
    const renamed = Object.fromEntries(Object.entries(real.outputs).map(([key, value]) => [`${key}_renamed`, value]));
    const shard = runShard({ name: 'pull_request', base: head }, freshTemp('renamed-key'), renamed);
    expect(shard.argv[0]).toBe('test');
  });

  it('the select step writing another value under the same key runs the whole suite', () => {
    const { key } = modeBinding();
    expect(real.outputs[key], `the select step wrote no \`${key}\` output`).toBeDefined();
    const changed = { ...real.outputs, [key]: `${real.outputs[key]}-renamed` };
    const shard = runShard({ name: 'pull_request', base: head }, freshTemp('renamed-value'), changed);
    expect(shard.argv[0]).toBe('test');
  });
});
