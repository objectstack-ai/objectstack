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
 * The build a poll reads is the source's sync state, one durable record per
 * source that every node answers from: the rebuild's poll matches it to the
 * build it started by start time. A read that does not name this build (its
 * start not written, the record unreadable) is never a failure on its own;
 * a record naming a later build is (this build's outcome is not kept).
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
/** What the rebuild action answers: this node's in-memory record of the build it started. */
const startedRecord = {
  trigger: 'operator', status: 'running', startedAt: STARTED_AT,
  progress: { pages: 0, discovered: 0, indexed: 0, skipped: 0, failed: 0 },
};
const startedAnswer = (message?: string) =>
  ok({ ok: true, ...(message ? { message } : {}), details: { source: 'kb', build: startedRecord } });
/** The source's last build, as its sync state records it. */
const running = (discovered: number) => ({
  trigger: 'operator', status: 'running', startedAt: STARTED_AT,
  counts: { discovered, indexed: discovered, skipped: 0, purged: null, failed: 0 },
});
const CURRENT = { state: 'current', due: false, detail: 'current.' };
const statusOf = (build: unknown, adapter = 'pgvector', extra: Record<string, unknown> = {}) => ok({
  ok: true,
  message: '1 source(s)',
  details: { sources: [{ id: 'kb', label: 'KB', adapter, index: CURRENT, build, failures: { count: 0 }, ...extra }] },
});
const done = {
  ...running(250),
  status: 'done',
  finishedAt: '2026-11-26T05:01:00.000Z',
  counts: { discovered: 250, indexed: 240, skipped: 10, purged: 2, failed: 0 },
  message: 'Every row was read and the index recorded the build.',
};

const target = ['--url', SERVER, '--token', 'tok'];

describe('os knowledge rebuild', () => {
  it('starts the rebuild through the settings action door and follows it to its end', async () => {
    const run = await drive(KnowledgeRebuild, ['kb', ...target], [
      startedAnswer("Rebuild of source 'kb' started."),
      statusOf(running(100)),
      statusOf(done),
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
    expect(text).not.toContain('memory adapter');
  });

  it('exits 1 when the build did not finish, with the record\'s sentence', async () => {
    const run = await drive(KnowledgeRebuild, ['kb', ...target], [
      startedAnswer(),
      statusOf({ ...running(10), status: 'interrupted', finishedAt: STARTED_AT, message: 'The node running the build stopped before it ended.' }),
    ]);
    expect(run.failure).toMatchObject({ message: 'The node running the build stopped before it ended.', exit: 1 });
  });

  it('exits 1 with the server refusal text, and asks nothing more', async () => {
    const run = await drive(KnowledgeRebuild, ['kb', ...target], [
      refused("Rebuild of source 'kb' was not started: another node holds the build of this source; this node built nothing."),
    ]);
    expect(run.failure).toMatchObject({ exit: 1 });
    expect(run.failure?.message).toContain('another node holds the build');
    expect(run.requests).toHaveLength(1);
  });

  it('keeps following a poll whose record does not name this build yet, and does not exit 1 for it', async () => {
    const older = { ...done, startedAt: '2026-11-25T00:00:00.000Z' };
    const run = await drive(KnowledgeRebuild, ['kb', ...target], [
      startedAnswer(),
      statusOf(older),
      statusOf(null, 'pgvector', { failures: null, syncStateError: 'the sync state could not be read: connection reset' }),
      statusOf(done),
    ]);
    expect(run.failure).toBeUndefined();
    const text = run.logs.join('\n');
    // An older build is never read as this one's end.
    expect(text).not.toContain('ended 2026-11-25');
    expect(text).toContain("the source's sync state does not name this build (it names one started 2026-11-25T00:00:00.000Z)");
    expect(text).toContain('connection reset');
    expect(text).toContain('done (operator, ended 2026-11-26T05:01:00.000Z)');
  });

  it('exits 1 when the record names a later build: this build\'s outcome is not kept', async () => {
    const later = { ...running(5), trigger: 'reconcile', startedAt: '2026-11-26T06:00:00.000Z' };
    const run = await drive(KnowledgeRebuild, ['kb', ...target], [startedAnswer(), statusOf(later)]);
    expect(run.failure?.exit).toBe(1);
    expect(run.failure?.message).toContain('names a later build (reconcile, started 2026-11-26T06:00:00.000Z)');
  });

  it('on the memory adapter, says the build filled the index of the node that ran it only', async () => {
    const run = await drive(KnowledgeRebuild, ['kb', ...target], [startedAnswer(), statusOf(done, 'memory')]);
    expect(run.failure).toBeUndefined();
    expect(run.logs.join('\n')).toContain('this build filled the index of the node that ran it only');
  });

  it('exits 1 after --timeout seconds of polls that do not find this build, and says the build may still run', async () => {
    const run = await drive(KnowledgeRebuild, ['kb', '--interval', '2', '--timeout', '4', ...target], [
      startedAnswer(),
      statusOf(null),
      statusOf(null),
    ]);
    expect(run.failure?.exit).toBe(1);
    expect(run.failure?.message).toContain('Stopped following after 4s');
    expect(run.failure?.message).toContain('may still be running');
    expect(run.requests).toHaveLength(3);
  });

  it('starts the timeout again each time a read finds this build', async () => {
    const run = await drive(KnowledgeRebuild, ['kb', '--interval', '2', '--timeout', '4', ...target], [
      startedAnswer(),
      statusOf(null),
      statusOf(running(50)),
      statusOf(null),
      statusOf(done),
    ]);
    expect(run.failure).toBeUndefined();
  });

  it('--no-wait returns once the build has started, and says its outcome is not reported', async () => {
    const run = await drive(KnowledgeRebuild, ['kb', '--no-wait', ...target], [startedAnswer('started')]);
    expect(run.failure).toBeUndefined();
    expect(run.requests).toHaveLength(1);
    // Exit 0 means "started", not "built": the line pointing at the outcome is
    // the only thing that tells a script so.
    expect(run.logs.some((line) => line.includes('os knowledge status'))).toBe(true);
  });
});

describe('os knowledge status', () => {
  it('prints each source with its index state, its last build, its failed syncs and the queue', async () => {
    const run = await drive(KnowledgeStatus, target, [
      ok({
        ok: true,
        details: {
          sources: [
            { id: 'kb', label: 'KB', adapter: 'pgvector', index: { state: 'nothing', due: true, detail: 'never built.' }, build: null, failures: { count: 0 } },
            // A package's source is listed under its NAMESPACE-NAME, with the package that holds it.
            {
              id: 'crm-faq', label: 'FAQ', adapter: 'turso', packageId: 'com.acme.crm', index: { state: 'current', due: false },
              build: done,
              failures: {
                count: 2, firstFailedAt: '2026-11-26T04:00:00.000Z', lastFailedAt: '2026-11-26T04:30:00.000Z',
                lastError: "The sync of record 'r9' failed its last attempt (5 of 5): Error, status 503.",
              },
            },
            { id: 'notes', label: 'Notes', adapter: 'memory', index: { state: 'current', due: false }, build: null, failures: null, syncStateError: 'connection reset' },
          ],
          queue: { queue: 'knowledge-record-sync', pending: 7 },
        },
      }),
    ], false);
    expect(run.failure).toBeUndefined();
    expect(run.requests[0]).toMatchObject({ url: `${SERVER}/api/settings/knowledge/index_status`, body: {} });
    const text = run.logs.join('\n');
    expect(text).toContain('kb  (KB; adapter pgvector)');
    expect(text).toContain('crm-faq  (FAQ; adapter turso, package com.acme.crm)');
    expect(text).toContain('index: nothing — a build is due — never built.');
    expect(text).toContain('last build: none recorded');
    expect(text).toContain('last build: done (operator, ended 2026-11-26T05:01:00.000Z)');
    expect(text).toContain('failed syncs: none');
    expect(text).toContain('failed syncs: 2 not yet repaired (first 2026-11-26T04:00:00.000Z, last 2026-11-26T04:30:00.000Z)');
    expect(text).toContain("The sync of record 'r9' failed its last attempt");
    expect(text).toContain('sync state: not read — connection reset');
    expect(text).toContain("the index state above is the answering node's own");
    expect(text).toContain('record syncs waiting on queue knowledge-record-sync: 7');
    // No per-node caveat on the build: the record is the same on every node.
    expect(text).not.toContain('node that answered');
  });

  it('exits 1 with the server refusal text', async () => {
    const run = await drive(KnowledgeStatus, ['nope', ...target], [refused("No knowledge source 'nope' is registered (kb).")], false);
    expect(run.failure).toMatchObject({ exit: 1 });
    expect(run.failure?.message).toContain("No knowledge source 'nope'");
  });
});
