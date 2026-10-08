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
 * Not named `.e2e`, so it runs on every PR and in the merge queue rather than
 * nightly; two spawns, one per fixture, keep that cost to the floor. The CLI
 * runs through `bin/run-dev.js` (source, via tsx), and `@objectstack/spec`
 * resolves through `exports` to `dist/`.
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

const DECLARED_POLICY: Retry = { maxRetries: 2, backoffMs: 5000, backoffMultiplier: 2, maxRetryDelayMs: 60000, jitter: true };

const FIXTURES = {
  /** The measured slip, `maxRetry` for `maxRetries`, under a `try_catch` node's `retry` AND on a job's `retryPolicy`. */
  slip: stackOf({ maxRetry: 2 }, { ...DECLARED_POLICY, maxRetry: 3 }),
  /**
   * Every declared key on the job, and on the flow the pre-17 `retryDelayMs`
   * alone, which the conversion renames before the judge sees it.
   */
  declared: stackOf({ maxRetries: 2, retryDelayMs: 500, backoffMultiplier: 2, maxRetryDelayMs: 10000, jitter: true }, DECLARED_POLICY),
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
  it('exit 1: the try_catch retry.maxRetry refused at the key by the flow node judge, the job\'s at its policy', async () => {
    const run = await runCli(['validate', '--json'], dirs.get('slip')!);
    expect(run.code, `expected exit 1:\n${run.stdout}\n${run.stderr}`).toBe(1);
    const errors = errorsOf(run.stdout);
    const located = errors.map((e) => ({ code: e.code, path: (e.path ?? []).join('.') }));
    expect(located).toContainEqual({ code: 'custom', path: 'flows.0.nodes.1.config.retry.maxRetry' });
    expect(located).toContainEqual({ code: 'unrecognized_keys', path: 'jobs.0.retryPolicy' });
    expect(located).toHaveLength(2);
    // The rename pair is the did-you-mean's subject, at both: the declared key the author meant.
    for (const error of errors) expect(error.message, (error.path ?? []).join('.')).toContain('`maxRetry` → `maxRetries`');
  }, 180_000);

  it('CONTROL: every declared key, and a pre-17 retryDelayMs the conversion renames, exit 0', async () => {
    const run = await runCli(['validate', '--json'], dirs.get('declared')!);
    expect(run.code, `expected exit 0:\n${run.stdout}\n${run.stderr}`).toBe(0);
    expect((JSON.parse(run.stdout) as { valid?: boolean }).valid).toBe(true);
  }, 180_000);
});
