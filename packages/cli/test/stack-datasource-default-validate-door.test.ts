// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os validate` — the build door an author runs before shipping — refuses a
 * stack that declares a datasource named `default`, run for real (#23634).
 *
 * The measured starting point: a config declaring
 * `datasources: [{ name: 'default', driver: 'sqlite', … }]` validated clean and
 * exited 0, while every boot refused it as host-reserved (the app plugin's
 * "declares a datasource named 'default' — that name is reserved for the
 * host's primary datasource"), with `OS_DATABASE_URL`, with `--dev` and on the
 * standalone path. The exit status is what a CI pipeline reads, so this file
 * spawns the source CLI and asserts what the shell sees, with the refusal's
 * issue code and path from `--json`.
 *
 * Schema-layer pins (`defineStack`, the map form, the reserved set, and the
 * host's own `default` row through `DatasourceSchema`) live in
 * `packages/spec/src/stack-datasource-host-reserved-name.test.ts`.
 *
 * Integration tier: it spawns the source CLI (`packages/cli/vitest-tiers.ts`).
 * Not named `.e2e`, so it runs on every PR and in the merge queue; two spawns,
 * one per fixture. The CLI runs through `bin/run-dev.js` (source, via tsx), and
 * `@objectstack/spec` resolves through `exports` to `dist/`.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { childEnv } from './helpers/serve-process.js';
import { writeDefineStackConfig } from './helpers/define-stack-fixture.js';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
const CLI = resolve(HERE, '../bin/run-dev.js');
const TSX = resolve(HERE, '../../../node_modules/.bin/tsx');

/** One stack: one object, and one declared sqlite datasource under `name`. */
const stackOf = (name: string) => ({
  manifest: {
    id: 'com.example.fx',
    namespace: 'fx',
    name: 'Reserved datasource door probe',
    version: '1.0.0',
    type: 'app',
    engines: { protocol: '^18' },
  },
  objects: [
    {
      name: 'fx_task',
      label: 'Task',
      pluralLabel: 'Tasks',
      sharingModel: 'private',
      fields: { name: { type: 'text', label: 'Name', required: true } },
    },
  ],
  datasources: [{ name, driver: 'sqlite', config: { filename: `${name}.db` }, autoConnect: true }],
});

const FIXTURES = {
  /** The measured shape: the host-reserved name. */
  reserved: stackOf('default'),
  /** CONTROL: the same entry under a name of the stack's own. */
  own: stackOf('fx_primary'),
} as const;

interface Run {
  code: number;
  stdout: string;
  stderr: string;
}

function runCli(args: string[], cwd: string): Promise<Run> {
  return new Promise((resolvePromise) => {
    execFile(
      TSX,
      [CLI, ...args],
      { cwd, maxBuffer: 16 * 1024 * 1024, env: childEnv({ NO_COLOR: '1' }) },
      (err, stdout, stderr) => {
        resolvePromise({
          code: err ? (typeof (err as { code?: unknown }).code === 'number' ? (err as unknown as { code: number }).code : 1) : 0,
          stdout: String(stdout),
          stderr: String(stderr),
        });
      },
    );
  });
}

interface ValidateError {
  code?: string;
  path?: unknown[];
  message?: string;
}

/** `os validate --json` on failure: the parse's issues ride `errors`. */
const errorsOf = (stdout: string): ValidateError[] => (JSON.parse(stdout) as { errors?: ValidateError[] }).errors ?? [];

const dirs = new Map<keyof typeof FIXTURES, string>();

beforeAll(() => {
  for (const [kind, stack] of Object.entries(FIXTURES) as Array<[keyof typeof FIXTURES, unknown]>) {
    const dir = mkdtempSync(join(tmpdir(), `os-ds-default-door-${kind}-`));
    // `strict: false`: the door's own parse must judge the content, not `defineStack` at load.
    writeDefineStackConfig(dir, stack, { strict: false });
    dirs.set(kind, dir);
  }
});

afterAll(() => {
  for (const dir of dirs.values()) rmSync(dir, { recursive: true, force: true });
});

describe('os validate refuses a stack datasource named `default`', () => {
  it('exit 1: refused at datasources.0.name with the runtime\'s sentence and its remedy', async () => {
    const run = await runCli(['validate', '--json'], dirs.get('reserved')!);
    expect(run.code, `expected exit 1:\n${run.stdout}\n${run.stderr}`).toBe(1);
    const errors = errorsOf(run.stdout);
    const located = errors.map((e) => ({ code: e.code, path: (e.path ?? []).join('.') }));
    expect(located).toEqual([{ code: 'custom', path: 'datasources.0.name' }]);
    expect(errors[0]!.message).toContain(
      "declares a datasource named 'default' — that name is reserved for the host's primary datasource",
    );
    expect(errors[0]!.message).toContain('OS_DATABASE_URL');
  }, 180_000);

  it('CONTROL: the same datasource named `fx_primary`, exit 0', async () => {
    const run = await runCli(['validate', '--json'], dirs.get('own')!);
    expect(run.code, `expected exit 0:\n${run.stdout}\n${run.stderr}`).toBe(0);
    expect((JSON.parse(run.stdout) as { valid?: boolean }).valid).toBe(true);
  }, 180_000);
});
