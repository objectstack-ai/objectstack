// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os environments create` does not take `--clone-from`, and sends no
 * `clone_from_environment_id`.
 *
 * ## The defect this file would have caught
 *
 * The command declared `--clone-from` ("Clone schema from an existing
 * environment id") and put its value on the create request as
 * `clone_from_environment_id`. The control plane never read that key: its
 * create schema does not declare it, and an undeclared key is stripped by the
 * schema's `z.object` gate, which is how the key was "accepted and ignored". So
 * `os environments create --clone-from X` answered success and created an
 * EMPTY environment, with nothing saying the clone had not happened. Cloning is
 * not implemented; a flag that advertises it is a capability the runtime does
 * not deliver.
 *
 * ## What is pinned, and why each half needs its own case
 *
 * - The flag is REFUSED, by oclif's own "Nonexistent flag" answer and with the
 *   control plane never called. The refusal is the parser's default on purpose:
 *   a bespoke message would be a sentence the CLI owns and has to keep true.
 * - A create WITHOUT the flag puts no `clone_from_environment_id` on the wire.
 *   `JSON.stringify` drops an `undefined` value, so this half goes green even
 *   while the request still names the key; it is the control that proves the
 *   interception below sees the real request, and the key-set equality is what
 *   fails if anything ever writes that key with a value again.
 * - No `examples` line spells a flag the command refuses. `examples` is printed
 *   verbatim by `--help`, so a stale line is a copy-paste that fails.
 *
 * ## Why every case carries an explicit 60s budget
 *
 * Each case drives a real `Command.run` against the real oclif root, which
 * resolves the plugin and manifest surface before the command body runs. The
 * budget is wall-clock only and no assertion moves with it; the sibling
 * `commands/data/delete-arms-agree.test.ts` states the same reason.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ObjectStackClient } from '@objectstack/client';
import EnvironmentsCreate from './create.js';

const stub = vi.hoisted(() => ({
  client: undefined as any,
  token: 'test-token' as string | undefined,
}));

vi.mock('../../utils/api-client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils/api-client.js')>();
  return {
    ...actual,
    createControlPlaneApiClient: async () => ({ client: stub.client, token: stub.token, baseUrl: 'https://door.test' }),
  };
});

/** `packages/cli` — the oclif root the command is loaded against. */
const CLI_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

interface Recorded {
  url: string;
  method: string | undefined;
  body: Record<string, unknown> | undefined;
}

/**
 * A client whose `fetch` records every request and answers the create route's
 * real envelope. Recording at the WIRE, not at `client.environments.create`,
 * so the assertion reads what the control plane would have received.
 */
function recordingClient(): { client: ObjectStackClient; requests: Recorded[] } {
  const requests: Recorded[] = [];
  const client = new ObjectStackClient({
    baseUrl: 'https://door.test',
    token: 'test-token',
    fetch: async (url: URL | RequestInfo, init?: RequestInit) => {
      requests.push({
        url: String(url),
        method: init?.method,
        body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
      });
      return {
        ok: true,
        status: 201,
        statusText: 'Created',
        json: async () => ({
          environment: { id: 'env_new', display_name: 'Dev' },
          warnings: [],
          durationMs: 1,
        }),
        headers: new Headers(),
      } as any;
    },
  });
  return { client, requests };
}

interface CliRun {
  /** What the command threw, or `undefined` when it returned normally. */
  error: (Error & { flags?: string[] }) | undefined;
  exitCode: number;
}

async function runCreate(argv: string[]): Promise<CliRun> {
  const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  const writeSpy = vi
    .spyOn(process.stdout, 'write')
    .mockImplementation(((_chunk: unknown, encodingOrCb?: unknown, maybeCb?: unknown) => {
      const done = typeof encodingOrCb === 'function' ? encodingOrCb : maybeCb;
      if (typeof done === 'function') (done as (err?: Error | null) => void)(null);
      return true;
    }) as never);
  const savedExitCode = process.exitCode;
  process.exitCode = undefined;
  let exitCode = 0;
  let error: CliRun['error'];
  try {
    await EnvironmentsCreate.run(argv, { root: CLI_ROOT });
  } catch (caught: unknown) {
    error = caught as CliRun['error'];
    const oclif = (caught as { oclif?: { exit?: number } })?.oclif;
    exitCode = typeof oclif?.exit === 'number' ? oclif.exit : 1;
  } finally {
    if (exitCode === 0 && typeof process.exitCode === 'number') exitCode = process.exitCode;
    logSpy.mockRestore();
    writeSpy.mockRestore();
    process.exitCode = savedExitCode;
  }
  return { error, exitCode };
}

/** Every flag a create needs and nothing else; `--no-activate` keeps it off `~/.objectstack`. */
const BASE_ARGV = ['--org', 'org_1', '--name', 'Dev', '--no-activate'];

afterEach(() => {
  stub.client = undefined;
  stub.token = 'test-token';
});

describe('`os environments create` — no `--clone-from`, no `clone_from_environment_id`', () => {
  it('CONTROL — a create without the flag POSTs once and its body names no clone key', async () => {
    const { client, requests } = recordingClient();
    stub.client = client;
    const run = await runCreate(BASE_ARGV);

    expect(run.error).toBeUndefined();
    expect(run.exitCode).toBe(0);
    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe('https://door.test/api/v1/cloud/environments');
    expect(requests[0].method).toBe('POST');
    // The key SET, not only the absence of one key: this is what reddens if a
    // value for it is ever written again.
    expect(Object.keys(requests[0].body ?? {}).sort()).toEqual(['display_name', 'organization_id', 'plan']);
    expect(requests[0].body).not.toHaveProperty('clone_from_environment_id');
  }, 60_000);

  it.each([
    ['separate value', ['--clone-from', 'env_source']],
    ['=value', ['--clone-from=env_source']],
  ])('`--clone-from` (%s) is refused by the parser, and the control plane is never called', async (_label, extra) => {
    const { client, requests } = recordingClient();
    stub.client = client;
    const run = await runCreate([...BASE_ARGV, ...extra]);

    // The parser's own answer: a non-zero exit and its `Nonexistent flag` text.
    expect(run.exitCode).not.toBe(0);
    expect(run.error?.message).toMatch(/^Nonexistent flag: --clone-from\b/);
    // Nothing reached the wire: the user is told, rather than handed an EMPTY
    // environment and a success line.
    expect(requests).toEqual([]);
  }, 60_000);

  it('the flag is not declared, and no example line spells a flag the command refuses', () => {
    const declared = new Set(
      Object.entries(EnvironmentsCreate.flags).flatMap(([name, flag]) => [
        `--${name}`,
        ...((flag as { allowNo?: boolean }).allowNo ? [`--no-${name}`] : []),
      ]),
    );

    expect(declared.has('--clone-from')).toBe(false);

    const spelled = EnvironmentsCreate.examples
      .flatMap((example) => String(example).match(/--[a-z][a-z0-9-]*/g) ?? []);
    // The control: the examples really do spell flags, so the loop below is not
    // vacuously true over an empty list.
    expect(spelled).toContain('--org');
    expect(spelled).toContain('--artifact');
    for (const flag of spelled) {
      expect(declared.has(flag), `example spells ${flag}, which the command does not declare`).toBe(true);
    }
  });
});
