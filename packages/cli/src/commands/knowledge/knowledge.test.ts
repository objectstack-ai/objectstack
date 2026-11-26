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
 * Behind a load balancer a progress read can land on a node that holds no
 * record of the build (the record lives in memory on the node running it):
 * `nodeWithoutRecord` answers such a poll. The command then reads the
 * store's index state (the same on every node for a shared store; never
 * read as the build's end on the per-process `memory` adapter), and never
 * exits 1 for the poll alone.
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
const CURRENT = { state: 'current', due: false, detail: 'current.' };
const NEVER_BUILT = { state: 'nothing', due: true, detail: 'never built.' };
const UNREADABLE = { state: 'unreadable', due: false, detail: 'reading the adapter failed: connection reset.' };
const statusOf = (build: unknown, index: unknown = CURRENT, adapter = 'pgvector') => ok({
  ok: true,
  message: '1 source(s)',
  details: { sources: [{ id: 'kb', label: 'KB', adapter, kind: 'object', index, build }] },
});
/** A poll answered by a node that is not running this build: no record there. */
const nodeWithoutRecord = (index: unknown) => statusOf(null, index);
const done = {
  ...running(250),
  status: 'done',
  finishedAt: '2026-11-26T05:01:00.000Z',
  progress: { pages: 3, discovered: 250, indexed: 240, skipped: 10, failed: 0 },
  result: { ok: true, discovered: 250, indexed: 240, skipped: 10, purged: 2, failed: 0 },
};

const target = ['--url', SERVER, '--token', 'tok'];

describe('os knowledge rebuild', () => {
  it('starts the rebuild through the settings action door and follows it to its end', async () => {
    const run = await drive(KnowledgeRebuild, ['kb', ...target], [
      statusOf(null),
      ok({ ok: true, message: "Rebuild of source 'kb' started.", details: { source: 'kb', build: running(0) } }),
      statusOf(running(100)),
      statusOf(done),
    ]);

    expect(run.failure).toBeUndefined();
    // The index state is read once before the rebuild: the baseline a poll on another node is judged against.
    expect(run.requests[0]).toEqual({ url: `${SERVER}/api/settings/knowledge/index_status`, body: { source: 'kb' }, auth: 'Bearer tok' });
    expect(run.requests[1]).toEqual({ url: `${SERVER}/api/settings/knowledge/rebuild`, body: { source: 'kb' }, auth: 'Bearer tok' });
    expect(run.requests.slice(2).map((r) => [r.url, r.body])).toEqual([
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
      statusOf(null),
      ok({ ok: true, details: { source: 'kb', build: running(0) } }),
      statusOf({ ...running(10), status: 'failed', finishedAt: STARTED_AT, message: 'the adapter upsert failed: quota' }),
    ]);
    expect(run.failure).toMatchObject({ message: 'the adapter upsert failed: quota', exit: 1 });
  });

  it('exits 1 with the server refusal text, and asks nothing more', async () => {
    const run = await drive(KnowledgeRebuild, ['kb', ...target], [
      statusOf(null),
      refused('A build of source \'kb\' is already running on this node.'),
    ]);
    expect(run.failure).toMatchObject({ message: "A build of source 'kb' is already running on this node.", exit: 1 });
    expect(run.requests).toHaveLength(2);
  });

  describe('a poll that lands on a node without the build record (behind a load balancer)', () => {
    it('keeps following while the build is still running, and does not exit 1', async () => {
      const run = await drive(KnowledgeRebuild, ['kb', ...target], [
        nodeWithoutRecord(NEVER_BUILT),
        ok({ ok: true, details: { source: 'kb', build: running(0) } }),
        nodeWithoutRecord(NEVER_BUILT),
        statusOf(running(100), NEVER_BUILT),
        nodeWithoutRecord(NEVER_BUILT),
        statusOf(done),
      ]);
      expect(run.failure).toBeUndefined();
      expect(run.requests).toHaveLength(6);
      const text = run.logs.join('\n');
      expect(text).toContain("answered by a node that is not running this build; the store's index state: nothing");
      expect(text).toContain('done (operator, ended 2026-11-26T05:01:00.000Z)');
    });

    it('exits 0 once the store reports the index current after the build succeeded', async () => {
      const run = await drive(KnowledgeRebuild, ['kb', ...target], [
        nodeWithoutRecord(NEVER_BUILT),
        ok({ ok: true, details: { source: 'kb', build: running(0) } }),
        nodeWithoutRecord(NEVER_BUILT),
        nodeWithoutRecord(CURRENT),
      ]);
      expect(run.failure).toBeUndefined();
      expect(run.requests).toHaveLength(4);
      expect(run.logs.join('\n')).toContain('The index is current');
    });

    it('reads a record of an older build on the answering node as no record of this one', async () => {
      const older = { ...done, startedAt: '2026-11-25T00:00:00.000Z' };
      const run = await drive(KnowledgeRebuild, ['kb', ...target], [
        nodeWithoutRecord(NEVER_BUILT),
        ok({ ok: true, details: { source: 'kb', build: running(0) } }),
        statusOf(older, NEVER_BUILT),
        nodeWithoutRecord(CURRENT),
      ]);
      expect(run.failure).toBeUndefined();
      expect(run.logs.join('\n')).not.toContain('ended 2026-11-25');
    });

    it('does not read an index that was already current as done; waits for the building node', async () => {
      const run = await drive(KnowledgeRebuild, ['kb', ...target], [
        nodeWithoutRecord(CURRENT),
        ok({ ok: true, details: { source: 'kb', build: running(0) } }),
        nodeWithoutRecord(CURRENT),
        nodeWithoutRecord(CURRENT),
        statusOf({ ...done, status: 'failed', message: 'the adapter upsert failed: quota' }),
      ]);
      // Only the recorded failure, read on the node that ran the build, exits 1.
      expect(run.failure).toMatchObject({ message: 'the adapter upsert failed: quota', exit: 1 });
      expect(run.requests).toHaveLength(5);
      expect(run.logs.join('\n')).toContain('a build was not due before this rebuild');
    });

    it('does not read an unreadable baseline as a due build: a current index elsewhere is no exit 0', async () => {
      // A transient adapter error on the baseline read answers `unreadable`
      // (due: false). The index then reads `current` on another node because a
      // same-fingerprint rebuild never leaves it; that is not this build's end.
      const run = await drive(KnowledgeRebuild, ['kb', '--interval', '2', '--timeout', '4', ...target], [
        nodeWithoutRecord(UNREADABLE),
        ok({ ok: true, details: { source: 'kb', build: running(0) } }),
        nodeWithoutRecord(CURRENT),
        nodeWithoutRecord(CURRENT),
      ]);
      expect(run.failure?.exit).toBe(1);
      expect(run.failure?.message).toContain('Stopped following after 4s');
      expect(run.logs.join('\n')).not.toContain('The index is current');
    });

    it('never reads the per-process memory adapter\'s index as this build\'s end; waits for the building node', async () => {
      const run = await drive(KnowledgeRebuild, ['kb', ...target], [
        statusOf(null, NEVER_BUILT, 'memory'),
        ok({ ok: true, details: { source: 'kb', build: running(0) } }),
        statusOf(null, CURRENT, 'memory'),
        statusOf(done, CURRENT, 'memory'),
      ]);
      expect(run.failure).toBeUndefined();
      expect(run.requests).toHaveLength(4);
      const text = run.logs.join('\n');
      expect(text).not.toContain('The index is current');
      expect(text).toContain('the memory adapter keeps its index per process');
      expect(text).toContain('done (operator, ended 2026-11-26T05:01:00.000Z)');
    });

    it('exits 1 after --timeout seconds of polls that reach no record, and says the build may still run', async () => {
      const run = await drive(KnowledgeRebuild, ['kb', '--interval', '2', '--timeout', '4', ...target], [
        nodeWithoutRecord(NEVER_BUILT),
        ok({ ok: true, details: { source: 'kb', build: running(0) } }),
        nodeWithoutRecord(NEVER_BUILT),
        nodeWithoutRecord(NEVER_BUILT),
      ]);
      expect(run.failure?.exit).toBe(1);
      expect(run.failure?.message).toContain('Stopped following after 4s');
      expect(run.failure?.message).toContain('may still be running');
      expect(run.requests).toHaveLength(4);
    });

    it('starts the timeout again each time a read reaches the build record', async () => {
      const run = await drive(KnowledgeRebuild, ['kb', '--interval', '2', '--timeout', '4', ...target], [
        nodeWithoutRecord(NEVER_BUILT),
        ok({ ok: true, details: { source: 'kb', build: running(0) } }),
        nodeWithoutRecord(NEVER_BUILT),
        statusOf(running(50), NEVER_BUILT),
        nodeWithoutRecord(NEVER_BUILT),
        statusOf(done),
      ]);
      expect(run.failure).toBeUndefined();
    });
  });

  it('--no-wait returns once the build has started, and says its outcome is not reported', async () => {
    const run = await drive(KnowledgeRebuild, ['kb', '--no-wait', ...target], [
      ok({ ok: true, message: 'started', details: { source: 'kb', build: running(0) } }),
    ]);
    expect(run.failure).toBeUndefined();
    expect(run.requests).toHaveLength(1);
    // Exit 0 means "started", not "built": the line pointing at the outcome is
    // the only thing that tells a script so.
    expect(run.logs.some((line) => line.includes('os knowledge status'))).toBe(true);
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
    expect(text).toContain('last build on the node that answered: none recorded there');
    expect(text).toContain('a build run on another node');
    expect(text).toContain('not on the memory adapter');
  });

  it('exits 1 with the server refusal text', async () => {
    const run = await drive(KnowledgeStatus, ['nope', ...target], [refused("No knowledge source 'nope' is registered (kb).")], false);
    expect(run.failure).toMatchObject({ exit: 1 });
    expect(run.failure?.message).toContain("No knowledge source 'nope'");
  });
});
