// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os start`'s v18 ownership refusal names commands that run for the
 * deployment that printed them — run against the BUILT CLI.
 *
 * ## The defect
 *
 * `os start` boots its `serve` child with an auth secret on every run: the
 * operator's, or — when they set none — the one it generated on the first run
 * and keeps in `<home>/auth-secret`. The second is never in the operator's
 * shell. On a database an earlier release created the guard refused the boot
 * and named the ownership ceremony bare (`os migrate organization-ownership
 * --out PLAN`, then `--apply …`); run exactly as printed, the ceremony booted
 * with no secret, composed no security plugin, wrote its plan and stopped
 * its apply at the authored-conversion step, and nothing said which secret
 * was missing or where it lived. The development spelling (`--dev`) already
 * composed the plugin; this one did not.
 *
 * ## What it pins
 *
 * - a refused `os start` boot whose secret came from its home names both
 *   commands with that secret exported from the file, by its real path;
 * - the same boot under an operator's own `OS_AUTH_SECRET` names them bare:
 *   that secret is already in the shell that runs them;
 * - the two commands, run through a shell exactly as printed (`os` is the
 *   built entry), write the plan, complete the apply, and the next `os start`
 *   serves the database.
 *
 * ## The fixture
 *
 * A database a fresh `os start` of this tree created, then put back in the
 * shape 17.x left it in: `sys_secret` (which declares no organization column)
 * given one, and the organization-ownership marker deleted. The guard refuses
 * for that column and the absent marker alone.
 *
 * ## Spawn shape
 *
 * `bin/run.js` with `NODE_ENV` unset — the shipped entry, resolving commands
 * from `dist/` (`requireBuiltCli`). One process group per boot, so a SIGTERM
 * reaches the `serve` child `os start` supervises. Every run happens in
 * `beforeAll`; every `it` reads what it recorded.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import {
  childEnv,
  E2E_SECRET_KEY,
  KERNEL_ASSIGNED_PORT,
  readKernelAssignedPort,
  requireBuiltCli,
  RUN_JS_RESOLVES_FROM_DIST,
} from './helpers/serve-process.js';
import { writeDefineStackConfig } from './helpers/define-stack-fixture.js';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
/** `bin/run.js` — the SHIPPED entrypoint. */
const CLI = resolve(HERE, '../bin/run.js');

/** The banner's tail — every row above it has printed. */
const READY = /Press Ctrl\+C to stop/;
const RUN_TIMEOUT_MS = 180_000;
const ALL_RUNS_TIMEOUT_MS = 6 * RUN_TIMEOUT_MS;
const MARKER = 'adr-0131-organization-ownership';
/** An operator's own secret, as they would export it. */
const OPERATOR_SECRET = 'operator-secret-'.repeat(3);

const SCAFFOLD = {
  manifest: { id: 'com.example.start-ownership', namespace: 'startown', version: '1.0.0', type: 'app', name: 'startown' },
  objects: [{
    name: 'startown_item',
    label: 'Item',
    sharingModel: 'private',
    fields: { title: { type: 'text', label: 'Title' } },
  }],
};

interface Run {
  output: string;
  code: number | null;
}

const groups: ChildProcess[] = [];
let dir: string;
let home: string;
let db: string;
let staged = false;
const runs: Record<string, Run | Error> = {};

/** The environment every run gets: a production boot, no operator secret, no console. */
function env(overrides: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return childEnv({
    NO_COLOR: '1',
    OS_CLOUD_URL: 'off',
    OS_DISABLE_CONSOLE: '1',
    OS_SECRET_KEY: E2E_SECRET_KEY,
    OS_TELEMETRY_DB: '0',
    OS_DATABASE_URL: undefined,
    OS_ARTIFACT_URL: undefined,
    OS_ARTIFACT_PATH: undefined,
    OS_AUTH_SECRET: undefined,
    AUTH_SECRET: undefined,
    BETTER_AUTH_SECRET: undefined,
    OS_INTERNAL_AUTH_SECRET_FILE: undefined,
    OS_MODE: undefined,
    NODE_ENV: undefined,
    ...overrides,
  });
}

/**
 * Spawn `argv` in the fixture directory. With `ready`, stop the group once the
 * output matches it (a server that started); without, wait for it to exit.
 */
function run(argv: string[], runEnv: Record<string, string | undefined>, ready?: RegExp): Promise<Run> {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(argv[0]!, argv.slice(1), {
      cwd: dir,
      env: runEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    });
    groups.push(child);
    let output = '';
    let settled = false;
    const finish = (result: Run | Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      stopGroup(child).then(
        () => (result instanceof Error ? rejectRun(result) : resolveRun(result)),
        rejectRun,
      );
    };
    const timer = setTimeout(
      () => finish(new Error(`${argv.slice(1).join(' ')} did not finish\n--- output ---\n${output.slice(-6000)}`)),
      RUN_TIMEOUT_MS,
    );
    const onData = (d: unknown) => {
      output += String(d);
      if (!ready || !ready.test(output)) return;
      const bound = readKernelAssignedPort(output, 'os start');
      finish(bound instanceof Error ? bound : { output, code: null });
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.on('exit', (code) =>
      finish(ready
        ? new Error(`${argv.slice(1).join(' ')} exited ${String(code)} before ${ready}\n--- output ---\n${output.slice(-6000)}`)
        : { output, code }),
    );
  });
}

async function stopGroup(child: ChildProcess): Promise<void> {
  if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((done) => {
    const give = setTimeout(() => {
      try { process.kill(-child.pid!, 'SIGKILL'); } catch { /* group already gone */ }
      done();
    }, 15_000);
    child.once('exit', () => { clearTimeout(give); done(); });
    try { process.kill(-child.pid!, 'SIGTERM'); } catch { clearTimeout(give); done(); }
  });
}

/** `os start` on the fixture database, with its home outside the app directory. */
const start = (): string[] => [process.execPath, CLI, 'start', '-d', 'file:A.db', '-p', KERNEL_ASSIGNED_PORT, '--home', home, '--no-ui'];

/**
 * A printed command, run through a shell exactly as printed: `os` is the built
 * entry, `PLAN` the plan file this run writes.
 */
const shell = (command: string): string[] => [
  'bash', '-c', `os() { "${process.execPath}" "${CLI}" "$@"; }; ${command.replaceAll('PLAN', 'plan.json')}`,
];

async function record(name: string, step: () => Promise<Run>): Promise<void> {
  try {
    runs[name] = await step();
  } catch (error) {
    runs[name] = error instanceof Error ? error : new Error(String(error));
  }
}

function recorded(name: string): Run {
  const result = runs[name];
  if (result === undefined) throw new Error(`${name} was never run`);
  if (result instanceof Error) throw result;
  return result;
}

/**
 * The two commands the refusal the boot PRINTED names: the plan, then the
 * apply. Read from its `✗` line, never from the kernel's structured log of the
 * same error, which carries the text JSON-escaped.
 */
function namedCommands(output: string): { plan: string; apply: string } {
  const printed = output.split('\n').find((line) => line.trimStart().startsWith('✗ ') && line.includes('organization-ownership')) ?? '';
  const m = /Run '(.+? --out PLAN)' to write and review its plan, take a backup, then run '(.+? --apply --plan-file PLAN --backup-taken)'/.exec(printed);
  if (!m) throw new Error(`the refusal names no ceremony commands\n--- output ---\n${output.slice(-6000)}`);
  return { plan: m[1]!, apply: m[2]! };
}

/** The 17.x shape: a retired organization column on an object that declares none, and no marker. */
function stageV17Shape(): void {
  const handle = new Database(db);
  try {
    handle.exec('ALTER TABLE "sys_secret" ADD COLUMN "organization_id" varchar(255)');
    handle.prepare('DELETE FROM sys_migration WHERE id = ?').run(MARKER);
  } finally {
    handle.close();
  }
}

beforeAll(async () => {
  requireBuiltCli(RUN_JS_RESOLVES_FROM_DIST);
  dir = mkdtempSync(join(tmpdir(), 'os-start-ownership-'));
  home = mkdtempSync(join(tmpdir(), 'os-start-ownership-home-'));
  writeDefineStackConfig(dir, SCAFFOLD);
  db = join(dir, 'A.db');

  // A fresh `os start` creates every table, and the secret in its home.
  await record('fresh', () => run(start(), env(), READY));
  if (!existsSync(db) || !existsSync(join(home, 'auth-secret'))) return;
  stageV17Shape();
  staged = true;

  await record('refused', () => run(start(), env()));
  await record('refusedWithOperatorSecret', () => run(start(), env({ OS_AUTH_SECRET: OPERATOR_SECRET })));

  // The operator's next two commands, in a shell with no secret, as the refusal printed them.
  const refused = runs.refused;
  if (refused instanceof Error || refused === undefined) return;
  let commands: { plan: string; apply: string };
  try {
    commands = namedCommands(refused.output);
  } catch {
    return;
  }
  await record('plan', () => run(shell(commands.plan), env({ OS_DATABASE_URL: 'file:A.db' })));
  await record('apply', () => run(shell(commands.apply), env({ OS_DATABASE_URL: 'file:A.db' })));
  await record('startedAfter', () => run(start(), env(), READY));
}, ALL_RUNS_TIMEOUT_MS);

afterAll(async () => {
  for (const child of groups) await stopGroup(child);
  for (const path of [dir, home]) {
    try { rmSync(path, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

describe('`os start` names an ownership ceremony that runs with the secret it serves with', () => {
  it('the fixture is the 17.x shape, on a database and a secret `os start` created', () => {
    recorded('fresh');
    expect(staged, 'the fresh boot created no A.db or no <home>/auth-secret').toBe(true);
  });

  it('⭐ the refusal names both commands with the secret exported from its home, by path', () => {
    const { output, code } = recorded('refused');
    expect(code, output.slice(-4000)).toBe(1);
    const secretFile = join(home, 'auth-secret');
    const exported = `OS_AUTH_SECRET="$(cat ${secretFile})" os migrate organization-ownership`;
    expect(namedCommands(output)).toEqual({
      plan: `${exported} --out PLAN`,
      apply: `${exported} --apply --plan-file PLAN --backup-taken`,
    });
    expect(output).toContain(`Both commands export the auth secret this server read from ${secretFile}`);
    // The secret itself is never printed.
    expect(output).not.toContain(readFileSync(secretFile, 'utf8').trim());
  });

  it('an operator who exported their own secret is told the bare commands: the secret is already in their shell', () => {
    const { output, code } = recorded('refusedWithOperatorSecret');
    expect(code, output.slice(-4000)).toBe(1);
    expect(namedCommands(output)).toEqual({
      plan: 'os migrate organization-ownership --out PLAN',
      apply: 'os migrate organization-ownership --apply --plan-file PLAN --backup-taken',
    });
    expect(output).not.toContain('OS_AUTH_SECRET="$(cat');
  });

  it('⭐ run exactly as printed, the plan is written and the apply completes', () => {
    const plan = recorded('plan');
    expect(plan.code, plan.output.slice(-4000)).toBe(0);
    expect(existsSync(join(dir, 'plan.json'))).toBe(true);
    const apply = recorded('apply');
    expect(apply.code, apply.output.slice(-6000)).toBe(0);
    expect(apply.output).toContain('The ceremony is complete');
    // The plugin's own init line: the ceremony composed it, with the secret the command exported.
    expect(apply.output).toContain('Security Plugin initialized');
    expect(apply.output).not.toMatch(/Did not compose the security plugin/);
  });

  it('…and the next `os start` serves the upgraded database', () => {
    expect(recorded('startedAfter').output).toMatch(READY);
  });
});
