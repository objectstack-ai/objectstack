// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#34777] `os meta register --mode draft` stages the item as a pending draft
 * through the same save door, `PUT /meta/:type/:name?mode=draft`
 * (`SaveMetaItemOptions.mode`), instead of publishing it.
 *
 * ## What is measured here, and on what
 *
 * The harness `register-package.test.ts` uses, copied rather than shared so
 * each file keeps its own wall time: the REAL oclif command, the REAL
 * `ObjectStackClient`, the REAL registered route handlers (`RestServer`), the
 * REAL `ObjectStackProtocolImplementation` and REAL `sys_metadata*` tables on
 * SQLite, with the same stub at the credential boundary (`createApiClient`).
 *
 *  - `--mode draft --package P` puts `?mode=draft` on the wire, the door hands
 *    the protocol `mode: 'draft'`, the stored row is `state: 'draft'`, no
 *    active row is written, and the draft is listed by `GET /meta/_drafts?package=P`
 *    — the read Studio's Changes lists a package's drafts from.
 *  - Unflagged, and `--mode publish`, the request is the one this command
 *    always sent: no query string, an active row, no draft. The negative
 *    control for the case above.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
// The REAL stores the protocol writes to — the same specifier
// `delete-reset-carriers.test.ts` reaches them through, for the reason its
// import note gives.
import {
  SysMetadataObject,
  SysMetadataHistoryObject,
  SysMetadataAuditObject,
} from '@objectstack/platform-objects';
import { RestServer } from '@objectstack/runtime';
import { ObjectStackClient } from '@objectstack/client';
import MetaRegister, { draftSaveLines, metaRegisterOptions } from './register.js';

const stub = vi.hoisted(() => ({
  client: undefined as any,
  token: 'test-token' as string | undefined,
  createCalls: 0,
}));

vi.mock('../../utils/api-client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../utils/api-client.js')>();
  return {
    ...actual,
    createApiClient: async () => {
      stub.createCalls += 1;
      return { client: stub.client, token: stub.token };
    },
  };
});

/** `packages/cli` — the oclif root the command is loaded against below. */
const CLI_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** SGR codes, written as `\x1b` and never as the raw byte. */
const SGR = /\x1b\[[0-9;]*m/g;
const plain = (s: string) => s.replace(SGR, '');

interface CliRun { out: string; exitCode: number; thrown: unknown }

/** Drive the real oclif command with a real argv (see the delete suite's `runCli`). */
async function runCli(argv: string[]): Promise<CliRun> {
  const chunks: string[] = [];
  const logSpy = vi
    .spyOn(console, 'log')
    .mockImplementation((...args: unknown[]) => { chunks.push(args.map(String).join(' ')); });
  // `emitText` awaits `stdout.write`'s callback; a stub that swallows it hangs.
  const writeSpy = vi
    .spyOn(process.stdout, 'write')
    .mockImplementation(((chunk: unknown, encodingOrCb?: unknown, maybeCb?: unknown) => {
      chunks.push(String(chunk));
      const done = typeof encodingOrCb === 'function' ? encodingOrCb : maybeCb;
      if (typeof done === 'function') (done as (err?: Error | null) => void)(null);
      return true;
    }) as never);
  const savedExitCode = process.exitCode;
  let exitCode = 0;
  let thrown: unknown;
  try {
    await MetaRegister.run(argv, { root: CLI_ROOT });
  } catch (error: unknown) {
    thrown = error;
    const oclif = (error as { oclif?: { exit?: number } })?.oclif;
    exitCode = typeof oclif?.exit === 'number' ? oclif.exit : 1;
  } finally {
    logSpy.mockRestore();
    writeSpy.mockRestore();
    process.exitCode = savedExitCode;
  }
  return { out: plain(chunks.join('\n')), exitCode, thrown };
}

// ---------------------------------------------------------------------------
// The real stack the command talks to
// ---------------------------------------------------------------------------

const TEST_PACKAGE_ID = 'objectstack-test';
const PKG = 'com.qa.alpha';
const OTHER_PKG = 'com.qa.beta';

const TASK = {
  name: 'task',
  label: 'Task',
  fields: {
    id: { name: 'id', type: 'text' as const, primaryKey: true, label: 'ID' },
    name: { name: 'name', type: 'text' as const, label: 'Name' },
  },
};

const VIEW = (name: string, label: string) => ({
  name,
  label,
  object: 'task',
  viewKind: 'list',
  columns: [{ field: 'name', label: 'Name' }],
});

function createMockHttpServer() {
  const noop = () => {};
  return {
    get: noop, post: noop, put: noop, delete: noop, patch: noop, use: noop,
    listen: async () => {}, close: async () => {},
  };
}

function makeRes() {
  const res: any = {
    _status: 200,
    write: () => true,
    end: () => {},
    header: () => res,
    status: (code: number) => { res._status = code; return res; },
    json: (body: any) => { res._json = body; return res; },
  };
  return res;
}

function matchRoute(routes: any[], method: string, pathname: string) {
  for (const route of routes) {
    if (String(route.method).toUpperCase() !== method) continue;
    const pattern = String(route.path).split('/');
    const actual = pathname.split('/');
    if (pattern.length !== actual.length) continue;
    const params: Record<string, string> = {};
    let ok = true;
    for (let i = 0; i < pattern.length; i++) {
      if (pattern[i].startsWith(':')) params[pattern[i].slice(1)] = decodeURIComponent(actual[i]);
      else if (pattern[i] !== actual[i]) { ok = false; break; }
    }
    if (ok) return { route, params };
  }
  return undefined;
}

interface WireRecord { method: string; pathname: string; search: string; headers: Record<string, string> }

/** A `fetch` that hands the client's request to the REAL registered handler. */
function doorFetch(rest: RestServer, wire: WireRecord[]) {
  const routes = (rest as any).getRoutes();
  return async (input: any, init: any = {}) => {
    const url = new URL(String(input));
    const method = String(init.method ?? 'GET').toUpperCase();
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries((init.headers ?? {}) as Record<string, string>)) {
      headers[k.toLowerCase()] = String(v);
    }
    wire.push({ method, pathname: url.pathname, search: url.search, headers });
    const hit = matchRoute(routes, method, url.pathname);
    if (!hit) throw new Error(`no route registered for ${method} ${url.pathname}`);
    const query: Record<string, string | string[]> = {};
    for (const key of new Set(url.searchParams.keys())) {
      const all = url.searchParams.getAll(key);
      query[key] = all.length > 1 ? all : all[0];
    }
    const res = makeRes();
    await hit.route.handler(
      { params: hit.params, query, headers, body: init.body ? JSON.parse(String(init.body)) : undefined } as any,
      res,
    );
    const status = res._status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      statusText: status === 200 ? 'OK' : 'Error',
      json: async () => res._json,
      headers: new Headers(),
    } as any;
  };
}

const liveEngines: ObjectQL[] = [];
const tempDirs: string[] = [];
afterEach(async () => {
  while (liveEngines.length) {
    try { await liveEngines.pop()?.destroy(); } catch { /* noop */ }
  }
  while (tempDirs.length) rmSync(tempDirs.pop()!, { recursive: true, force: true });
  stub.client = undefined;
  stub.token = 'test-token';
  stub.createCalls = 0;
});

/** Boot the real stack and point the command's client at it. */
async function bootDoor() {
  const engine = new ObjectQL();
  liveEngines.push(engine);
  engine.registerDriver(
    new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    }) as never,
    true,
  );
  await engine.init();
  engine.registry.registerObject(TASK as any, TEST_PACKAGE_ID);
  engine.registry.registerObject(SysMetadataObject as any, TEST_PACKAGE_ID);
  engine.registry.registerObject(SysMetadataHistoryObject as any, TEST_PACKAGE_ID);
  engine.registry.registerObject(SysMetadataAuditObject as any, TEST_PACKAGE_ID);
  // [#26708] A save naming a package the registry does not hold is refused,
  // so the two packages the item is saved into are installed first, as a
  // boot or `POST /packages` does. Each depends on the package owning
  // `task`, so a view over `task` stays inside its closure.
  for (const id of [PKG, OTHER_PKG]) {
    engine.registry.installPackage(
      { id, name: id, version: '1.0.0', dependencies: { [TEST_PACKAGE_ID]: '*' } } as any,
      'authored',
    );
  }
  await engine.syncSchemas();

  const protocol: any = new ObjectStackProtocolImplementation(engine as any);

  /** The PROBE: every save request the door hands the protocol. */
  const saveRequests: any[] = [];
  const realSave = protocol.saveMetaItem.bind(protocol);
  protocol.saveMetaItem = async (request: any) => {
    saveRequests.push(request);
    return realSave(request);
  };

  const rest = new RestServer(
    createMockHttpServer() as any,
    protocol as any,
    { api: { requireAuth: false, enableProjectScoping: true, projectResolution: 'auto' } } as any,
  );
  (rest as any).resolveExecCtx = async () => ({
    userId: 'usr_admin_34777',
    systemPermissions: ['manage_metadata'],
  });
  rest.registerRoutes();

  const wire: WireRecord[] = [];
  const client = new ObjectStackClient({ baseUrl: 'http://door.test', fetch: doorFetch(rest, wire) });
  stub.client = client;
  return { engine, client, saveRequests, wire };
}

/** The stored rows of one item, straight out of `sys_metadata`. */
async function overlayRows(engine: any, name: string) {
  return engine.find('sys_metadata', { where: { name }, context: { isSystem: true } });
}

/** `package_id → label` of every stored row of `name`, with each row's state. */
async function labelsByPackage(engine: any, name: string): Promise<Record<string, { label: string; state: string }>> {
  const out: Record<string, { label: string; state: string }> = {};
  for (const row of await overlayRows(engine, name)) {
    const body = typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata;
    out[String(row.package_id ?? '')] = { label: body?.label, state: row.state };
  }
  return out;
}

/** Write the `--data` file the command reads. */
function dataFile(body: unknown): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'os-meta-register-34777-'));
  tempDirs.push(dir);
  const file = path.join(dir, 'view.json');
  writeFileSync(file, JSON.stringify(body));
  return file;
}

/** The last `PUT` the client put on the wire. */
const lastPut = (wire: WireRecord[]) => wire.filter((w) => w.method === 'PUT').at(-1)!;

// ---------------------------------------------------------------------------
// The declared surface
// ---------------------------------------------------------------------------

describe('[#34777] the `--mode` flag `os meta register` declares', () => {
  it('declares `--mode` as a value flag taking draft or publish, with no default', () => {
    const flags = MetaRegister.flags as Record<string, any>;
    expect(flags.mode.type).toBe('option');
    expect(flags.mode.options).toEqual(['draft', 'publish']);
    expect(flags.mode.default).toBeUndefined();
    expect(flags.mode.description).toMatch(/\?mode=draft/);
    expect((MetaRegister.examples as string[]).join('\n')).toContain('--mode draft');
  });

  it('`metaRegisterOptions` maps only `--mode draft`, and stays `undefined` unflagged or under `--mode publish`', () => {
    expect(metaRegisterOptions({})).toBeUndefined();
    expect(metaRegisterOptions({ mode: undefined })).toBeUndefined();
    expect(metaRegisterOptions({ mode: 'publish' })).toBeUndefined();
    expect(metaRegisterOptions({ mode: 'draft' })).toEqual({ mode: 'draft' });
    expect(metaRegisterOptions({ mode: 'draft', package: PKG, force: false })).toEqual({ mode: 'draft', packageId: PKG });
    expect(metaRegisterOptions({ mode: 'publish', package: PKG })).toEqual({ packageId: PKG });
  });

  it('`draftSaveLines` says the draft is not published and names where it is reviewed', () => {
    const [head, review] = draftSaveLines({ type: 'view', name: 'v', packageId: PKG, version: 'hmac-sha256:ab' });
    expect(head).toContain('view/v');
    expect(head).toContain('not published');
    expect(head).toContain('hmac-sha256:ab');
    expect(review).toContain(`/studio/${PKG}/interfaces?changes=review`);
    const [, unbound] = draftSaveLines({ type: 'view', name: 'v' });
    expect(unbound).toContain('--package');
  });
});

// ---------------------------------------------------------------------------
// The real save door
// ---------------------------------------------------------------------------

describe('[#34777] `os meta register --mode draft` against the real save door', () => {
  it('`--mode draft --package P`: `?mode=draft` on the wire, a draft row and no active row, listed in P\'s drafts', async () => {
    const { engine, client, saveRequests, wire } = await bootDoor();

    const run = await runCli(['view', '--data', dataFile(VIEW('draft_view', 'Draft')), '--package', PKG, '--mode', 'draft']);

    expect(run.exitCode).toBe(0);
    expect(run.out).toContain('Draft saved: view/draft_view');
    expect(run.out).toContain(`/studio/${PKG}/interfaces?changes=review`);
    expect(run.out).not.toContain('Metadata registered');
    // The probe: the door read `?mode=draft` and handed the protocol a draft save.
    expect(lastPut(wire).search).toBe(`?package=${PKG}&mode=draft`);
    expect(saveRequests.at(-1).mode).toBe('draft');
    expect(saveRequests.at(-1).packageId).toBe(PKG);
    // Stored as a draft of P, and nothing live.
    expect(await labelsByPackage(engine, 'draft_view')).toEqual({ [PKG]: { label: 'Draft', state: 'draft' } });
    // The read Studio's Changes lists a package's drafts from.
    const listed = await client.meta.listDrafts({ packageId: PKG });
    expect(listed.drafts.map((d: any) => [d.type, d.name, d.packageId])).toEqual([['view', 'draft_view', PKG]]);
  }, 60_000);

  it('`--mode draft --format json` prints the door\'s own answer, `state: draft`', async () => {
    await bootDoor();

    const run = await runCli(['view', '--data', dataFile(VIEW('json_draft', 'J')), '--package', PKG, '--mode', 'draft', '--format', 'json']);

    expect(run.exitCode).toBe(0);
    const payload = JSON.parse(run.out);
    expect(payload.state).toBe('draft');
    expect(typeof payload.version).toBe('string');
  }, 60_000);

  it('UNFLAGGED and `--mode publish`: no query string, an active row, and no draft — the request this command always sent', async () => {
    const { engine, client, saveRequests, wire } = await bootDoor();

    const plain = await runCli(['view', '--data', dataFile(VIEW('plain_view', 'P'))]);
    expect(plain.exitCode).toBe(0);
    expect(plain.out).toContain('Metadata registered: view/plain_view');
    expect(lastPut(wire).search).toBe('');
    expect(saveRequests.at(-1)).not.toHaveProperty('mode');

    const published = await runCli(['view', '--data', dataFile(VIEW('published_view', 'Q')), '--mode', 'publish']);
    expect(published.exitCode).toBe(0);
    expect(published.out).toContain('Metadata registered: view/published_view');
    expect(lastPut(wire).search).toBe('');
    expect(saveRequests.at(-1)).not.toHaveProperty('mode');

    expect(await labelsByPackage(engine, 'plain_view')).toEqual({ '': { label: 'P', state: 'active' } });
    expect(await labelsByPackage(engine, 'published_view')).toEqual({ '': { label: 'Q', state: 'active' } });
    expect((await client.meta.listDrafts()).drafts).toEqual([]);
  }, 60_000);
});
