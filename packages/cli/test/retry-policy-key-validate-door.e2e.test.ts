// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os validate` — the build door an author runs before shipping — refuses a key
 * the shared retry policy does not declare, run for real.
 *
 * The measured starting point: a `try_catch` node carrying `retry.maxRetry` (a
 * slip for `maxRetries`) validated clean and exited 0, because the policy was a
 * plain `z.object` that stripped the key; only `registerFlow`'s descriptor walk
 * refused it, when the flow was first loaded. A job's `retryPolicy` with the
 * same slip was never refused anywhere, and the job silently never retried
 * (`maxRetries` defaults to 0). The exit status is what a CI pipeline reads, so
 * this file spawns the source CLI and asserts what the shell sees, with the
 * refusal's issue code and path from `--json`.
 *
 * Schema-layer pins (the key arm's code, params and message, every other
 * door) live in `packages/spec/src/automation/flow-builtin-node-config-keys.test.ts`
 * and `packages/spec/src/shared/retry-policy.test.ts`; the registration pins in
 * `service-automation`'s `builtin/config-unknown-keys.test.ts`.
 *
 * Integration tier: it spawns the source CLI (`packages/cli/vitest-tiers.ts`).
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

type Retry = Record<string, unknown>;

/** One stack: a flow guarding its work in a `try_catch` with `retry`, and a job with `retryPolicy`. */
const stackOf = (retry: Retry, retryPolicy: Retry) => ({
  manifest: {
    id: 'com.example.retrykeys',
    namespace: 'rtk',
    name: 'Retry key door probe',
    version: '1.0.0',
    type: 'app',
    engines: { protocol: '^17' },
  },
  objects: [
    {
      name: 'rtk_task',
      label: 'Task',
      pluralLabel: 'Tasks',
      sharingModel: 'private',
      fields: { name: { type: 'text', label: 'Name', required: true } },
    },
  ],
  flows: [
    {
      name: 'rtk_guarded',
      label: 'Guarded',
      type: 'autolaunched',
      nodes: [
        { id: 'start', type: 'start', label: 'Start' },
        {
          id: 'guard',
          type: 'try_catch',
          label: 'Guard',
          config: {
            try: { nodes: [{ id: 'inner', type: 'assignment', label: 'A', config: { assignments: { a: 1 } } }], edges: [] },
            retry,
          },
        },
        { id: 'end', type: 'end', label: 'End' },
      ],
      edges: [
        { id: 'e1', source: 'start', target: 'guard' },
        { id: 'e2', source: 'guard', target: 'end' },
      ],
    },
  ],
  jobs: [{ name: 'rtk_sweep', schedule: { type: 'interval', intervalMs: 60000 }, handler: 'jobs/sweep.ts', retryPolicy }],
});

const DECLARED_RETRY: Retry = { maxRetries: 2, backoffMs: 500, backoffMultiplier: 2, maxRetryDelayMs: 10000, jitter: true };
const DECLARED_POLICY: Retry = { maxRetries: 2, backoffMs: 5000, backoffMultiplier: 2 };

const FIXTURES = {
  /** The card's slip under a `try_catch` node's `retry`. */
  flowSlip: stackOf({ maxRetry: 2 }, DECLARED_POLICY),
  /** The same slip on a job's `retryPolicy`. */
  jobSlip: stackOf(DECLARED_RETRY, { ...DECLARED_POLICY, maxRetry: 3 }),
  /** Every declared key on both. */
  clean: stackOf(DECLARED_RETRY, DECLARED_POLICY),
  /** The pre-17 `retryDelayMs`, alone: the conversion renames it before the judge. */
  legacy: stackOf({ maxRetries: 2, retryDelayMs: 500 }, DECLARED_POLICY),
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
    const dir = mkdtempSync(join(tmpdir(), `os-retry-key-door-${kind}-`));
    // `strict: false`: the door's own parse must judge the content, not `defineStack` at load.
    writeDefineStackConfig(dir, stack, { strict: false });
    dirs.set(kind, dir);
  }
});

afterAll(() => {
  for (const dir of dirs.values()) rmSync(dir, { recursive: true, force: true });
});

describe('os validate refuses a key the retry policy does not declare', () => {
  it('a try_catch retry.maxRetry: exit 1, refused at the key by the flow node judge, with the declared key named', async () => {
    const run = await runCli(['validate', '--json'], dirs.get('flowSlip')!);
    expect(run.code, `expected exit 1:\n${run.stdout}\n${run.stderr}`).toBe(1);
    const errors = errorsOf(run.stdout);
    expect(errors.map((e) => ({ code: e.code, path: (e.path ?? []).join('.') }))).toEqual([
      { code: 'custom', path: 'flows.0.nodes.1.config.retry.maxRetry' },
    ]);
    // The rename pair is the did-you-mean's subject: the declared key the author meant.
    expect(errors[0]!.message).toContain('`maxRetry` → `maxRetries`');
  }, 180_000);

  it('a job retryPolicy.maxRetry: exit 1, refused at the policy as an unrecognized key', async () => {
    const run = await runCli(['validate', '--json'], dirs.get('jobSlip')!);
    expect(run.code, `expected exit 1:\n${run.stdout}\n${run.stderr}`).toBe(1);
    const errors = errorsOf(run.stdout);
    expect(errors.map((e) => ({ code: e.code, path: (e.path ?? []).join('.') }))).toEqual([
      { code: 'unrecognized_keys', path: 'jobs.0.retryPolicy' },
    ]);
    expect(errors[0]!.message).toContain('`maxRetry` → `maxRetries`');
  }, 180_000);

  it('CONTROL: every declared key on both, and a pre-17 retryDelayMs the conversion renames, exit 0', async () => {
    for (const kind of ['clean', 'legacy'] as const) {
      const run = await runCli(['validate', '--json'], dirs.get(kind)!);
      expect(run.code, `${kind}: expected exit 0:\n${run.stdout}\n${run.stderr}`).toBe(0);
      expect((JSON.parse(run.stdout) as { valid?: boolean }).valid, kind).toBe(true);
    }
  }, 240_000);
});
