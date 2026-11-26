// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os knowledge rebuild` and `os knowledge status`, driven against response
 * bodies built by `sendOk` / `sendError` — the server's one writer of the
 * declared envelope (see `utils/__tests__/server-body.ts`).
 *
 * The settings action door answers an action that reported `ok: false` with
 * a 400 carrying the action's message, and one that succeeded with a 200
 * carrying the action's result (`@objectstack/service-settings`,
 * `settings-routes.ts`). These tests pin what each command makes of both:
 * the route it calls, the payload it sends, that it follows a started build
 * to its end, and that a build which did not finish exits 1.
 *
 * The oclif `Config` is loaded at module scope, as in
 * `commands/datasource/envelope-unwrap.test.ts` (whose header says why).
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { Config } from '@oclif/core';
import type { Command } from '@oclif/core';
import { sendError, sendOk } from '@objectstack/types';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serverBody } from '../../utils/__tests__/server-body.js';
import KnowledgeRebuild from './rebuild.js';
import KnowledgeStatus from './status.js';

const HERE = dirname(fileURLToPath(import.meta.url));
/** This package's own root — `packages/cli`, never outside it. */
const CLI_ROOT = resolve(HERE, '../../..');
const SERVER = 'http://127.0.0.1:39999';

const config = await Config.load({ root: CLI_ROOT });

afterEach(() => {
  vi.unstubAllGlobals();
});

interface Request { url: string; body: unknown; auth?: string }
interface Driven {
  logs: string[];
  requests: Request[];
  failure?: { message: string; exit?: number };
}

type CommandCtor = new (argv: string[], config: Config) => Command;

/**
 * Run a command in-process against a queue of responses. `instantTimers`
 * makes `os knowledge rebuild`'s wait between two progress reads fire at
 * once; it is off for a command with an optional argument, whose parse reads
 * piped standard input under a timer of oclif's own.
 */
async function drive(
  Cmd: CommandCtor,
  argv: string[],
  responses: Array<{ status: number; body: unknown }>,
  instantTimers = true,
): Promise<Driven> {
  const logs: string[] = [];
  const requests: Request[] = [];
  const queue = [...responses];
  vi.stubGlobal('fetch', async (input: unknown, init?: { body?: string; headers?: Record<string, string> }) => {
    requests.push({
      url: String(input),
      body: init?.body ? JSON.parse(init.body) : undefined,
      ...(init?.headers?.authorization ? { auth: init.headers.authorization } : {}),
    });
    const next = queue.shift();
    if (!next) throw new Error('test: no response left for this request');
    return { status: next.status, ok: next.status < 400, json: async () => next.body };
  });
  if (instantTimers) vi.stubGlobal('setTimeout', (fn: () => void) => { fn(); return 0; });
  const cmd = new Cmd(argv, config);
  Object.assign(cmd, { log: (message?: string) => { logs.push(String(message ?? '')); } });
  try {
    await cmd.run();
    return { logs, requests };
  } catch (err) {
    const exit = (err as { oclif?: { exit?: number } }).oclif?.exit;
    return { logs, requests, failure: { message: (err as Error).message, exit } };
  }
}

const ok = (result: unknown) => ({ status: 200, body: serverBody((res) => sendOk(res, result)) });
const refused = (message: string) => ({
  status: 400,
  body: serverBody((res) => sendError(res, 400, 'SETTINGS_ACTION_FAILED', message, { details: { ok: false, message } })),
});

const STARTED_AT = '2026-11-26T05:00:00.000Z';
const running = (discovered: number) => ({
  trigger: 'operator', status: 'running', startedAt: STARTED_AT,
  progress: { pages: 1, discovered, indexed: discovered, skipped: 0, failed: 0 },
});
const statusOf = (build: unknown) => ok({
  ok: true,
  message: '1 source(s)',
  details: { sources: [{ id: 'kb', label: 'KB', adapter: 'pgvector', kind: 'object', index: { state: 'current', due: false, detail: 'current.' }, build }] },
});

const target = ['--url', SERVER, '--token', 'tok'];

describe('os knowledge rebuild', () => {
  it('starts the rebuild through the settings action door and follows it to its end', async () => {
    const run = await drive(KnowledgeRebuild, ['kb', ...target], [
      ok({ ok: true, message: "Rebuild of source 'kb' started.", details: { source: 'kb', build: running(0) } }),
      statusOf(running(100)),
      statusOf({
        ...running(250),
        status: 'done',
        finishedAt: '2026-11-26T05:01:00.000Z',
        progress: { pages: 3, discovered: 250, indexed: 240, skipped: 10, failed: 0 },
        result: { ok: true, discovered: 250, indexed: 240, skipped: 10, purged: 2, failed: 0 },
      }),
    ]);

    expect(run.failure).toBeUndefined();
    expect(run.requests[0]).toEqual({ url: `${SERVER}/api/settings/knowledge/rebuild`, body: { source: 'kb' }, auth: 'Bearer tok' });
    expect(run.requests.slice(1).map((r) => [r.url, r.body])).toEqual([
      [`${SERVER}/api/settings/knowledge/index_status`, { source: 'kb' }],
      [`${SERVER}/api/settings/knowledge/index_status`, { source: 'kb' }],
    ]);
    const text = run.logs.join('\n');
    expect(text).toContain("Rebuild of source 'kb' started.");
    expect(text).toContain('running (operator, started 2026-11-26T05:00:00.000Z): 100 row(s) read');
    expect(text).toContain('done (operator, ended 2026-11-26T05:01:00.000Z): 250 row(s) read, 240 written, 10 unchanged, 2 purged');
  });

  it('exits 1 when the build did not finish', async () => {
    const run = await drive(KnowledgeRebuild, ['kb', ...target], [
      ok({ ok: true, details: { source: 'kb', build: running(0) } }),
      statusOf({ ...running(10), status: 'failed', finishedAt: STARTED_AT, message: 'the adapter upsert failed: quota' }),
    ]);
    expect(run.failure).toMatchObject({ message: 'the adapter upsert failed: quota', exit: 1 });
  });

  it('exits 1 with the server refusal text, and asks nothing more', async () => {
    const run = await drive(KnowledgeRebuild, ['kb', ...target], [refused('A build of source \'kb\' is already running on this node.')]);
    expect(run.failure).toMatchObject({ message: "A build of source 'kb' is already running on this node.", exit: 1 });
    expect(run.requests).toHaveLength(1);
  });

  it('says so when the progress is answered by a node that is not running this build', async () => {
    const run = await drive(KnowledgeRebuild, ['kb', ...target], [
      ok({ ok: true, details: { source: 'kb', build: running(0) } }),
      statusOf(null),
    ]);
    expect(run.failure?.exit).toBe(1);
    expect(run.failure?.message).toContain('not running this build');
  });

  it('--no-wait returns once the build has started', async () => {
    const run = await drive(KnowledgeRebuild, ['kb', '--no-wait', ...target], [
      ok({ ok: true, message: 'started', details: { source: 'kb', build: running(0) } }),
    ]);
    expect(run.failure).toBeUndefined();
    expect(run.requests).toHaveLength(1);
  });
});

describe('os knowledge status', () => {
  it('prints each source with its index state and the last build', async () => {
    const run = await drive(KnowledgeStatus, target, [
      ok({
        ok: true,
        details: {
          sources: [
            { id: 'kb', label: 'KB', adapter: 'pgvector', kind: 'object', index: { state: 'nothing', due: true, detail: 'never built.' }, build: null },
          ],
        },
      }),
    ], false);
    expect(run.failure).toBeUndefined();
    expect(run.requests[0]).toMatchObject({ url: `${SERVER}/api/settings/knowledge/index_status`, body: {} });
    const text = run.logs.join('\n');
    expect(text).toContain('kb  (KB; adapter pgvector, object source)');
    expect(text).toContain('index: nothing — a build is due — never built.');
    expect(text).toContain('last build on this node: none');
  });

  it('exits 1 with the server refusal text', async () => {
    const run = await drive(KnowledgeStatus, ['nope', ...target], [refused("No knowledge source 'nope' is registered (kb).")], false);
    expect(run.failure).toMatchObject({ exit: 1 });
    expect(run.failure?.message).toContain("No knowledge source 'nope'");
  });
});
