// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23350] `os meta register` can name the package its save writes into —
 * `--package <id>`, forwarded as `SaveMetaItemOptions.packageId` (`?package=`).
 *
 * ## The defect
 *
 * A `sys_metadata` row is keyed per package (ADR-0048), and the save door
 * `PUT /meta/:type/:name` reads `?package=` as the row it writes. Since #23165
 * a save that names no package of an item two or more packages hold is
 * refused `409 RESOURCE_CONFLICT`, naming the packages, with `?package=` as
 * the remedy. `os meta register` called `client.meta.saveItem(type, name,
 * metadata)` with no options bag, so it could neither follow that remedy nor
 * address a package's row at all — although the SDK option has existed since
 * 17.3.
 *
 * ## What is measured here, and on what
 *
 * The REAL oclif command, the REAL `ObjectStackClient`, the REAL registered
 * route handler (`RestServer`), the REAL `ObjectStackProtocolImplementation`
 * and REAL `sys_metadata*` tables on SQLite — the harness
 * `delete-reset-carriers.test.ts` uses for `os meta delete`, with the same two
 * stubs, both at the credential boundary: `createApiClient` (a real client
 * whose `fetch` is a bridge into the registered handlers) and
 * `resolveExecCtx` (the session holds `manage_metadata`).
 *
 *  - Unflagged, the command saves ACTIVE (no `?mode=`) and sends no query
 *    string — unchanged by this card, and the state the 409 below is
 *    measured at.
 *  - Unflagged, an item two packages hold is refused `409 RESOURCE_CONFLICT`
 *    at the active save, and nothing is written. This is the negative control
 *    for the pin below, and the measurement the card left open.
 *  - `--package P` writes P's row, and only P's.
 *  - An empty `--package` is refused before a client exists.
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
import MetaRegister, { metaRegisterOptions, EMPTY_PACKAGE_SAVE_REFUSAL } from './register.js';

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
    userId: 'usr_admin_23350',
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
  const dir = mkdtempSync(path.join(os.tmpdir(), 'os-meta-register-23350-'));
  tempDirs.push(dir);
  const file = path.join(dir, 'view.json');
  writeFileSync(file, JSON.stringify(body));
  return file;
}

/** One item saved into two packages THROUGH THE SDK: one row per package (ADR-0048). */
async function twoPackageItem(client: ObjectStackClient, name: string) {
  await client.meta.saveItem('view', name, VIEW(name, 'A'), { packageId: PKG });
  await client.meta.saveItem('view', name, VIEW(name, 'B'), { packageId: OTHER_PKG });
}

// ---------------------------------------------------------------------------
// The declared surface
// ---------------------------------------------------------------------------

describe('[#23350] the `--package` flag `os meta register` declares', () => {
  it('declares `--package` as a value flag whose help names the refusal it answers', () => {
    const flags = MetaRegister.flags as Record<string, any>;
    expect(flags.package.type).toBe('option');
    expect(flags.package.description).toMatch(/409/);
    expect(flags.package.description).toMatch(/RESOURCE_CONFLICT/);
    expect((MetaRegister.examples as string[]).join('\n')).toContain('--package');
  });

  it('`metaRegisterOptions` forwards the id VERBATIM as `packageId`, and is `undefined` unflagged', () => {
    expect(metaRegisterOptions({})).toBeUndefined();
    expect(metaRegisterOptions({ package: undefined })).toBeUndefined();
    expect(metaRegisterOptions({ package: PKG })).toEqual({ packageId: PKG });
    // No reshaping: the door, not this command, decides what an id names.
    expect(metaRegisterOptions({ package: ' com.qa.alpha ' })).toEqual({ packageId: ' com.qa.alpha ' });
  });

  it('an empty or blank `--package` is refused, never sent as a package-less save', () => {
    expect(() => metaRegisterOptions({ package: '' })).toThrow(EMPTY_PACKAGE_SAVE_REFUSAL);
    expect(() => metaRegisterOptions({ package: '  ' })).toThrow(EMPTY_PACKAGE_SAVE_REFUSAL);
  });
});

// ---------------------------------------------------------------------------
// The real save door
// ---------------------------------------------------------------------------

describe('[#23350] `os meta register --package` against the real save door', () => {
  it('UNFLAGGED, an item with no package: an ACTIVE save, with no query string — the request this command always sent', async () => {
    const { engine, saveRequests, wire } = await bootDoor();

    const run = await runCli(['view', '--data', dataFile(VIEW('plain_probe', 'A'))]);

    expect(run.exitCode).toBe(0);
    expect(run.out).toContain('Metadata registered: view/plain_probe');
    const sent = wire.filter((w) => w.method === 'PUT').at(-1)!;
    expect(sent.pathname).toBe('/api/v1/meta/view/plain_probe');
    // No `?mode=draft` and no `?package=`: the save is the active one.
    expect(sent.search).toBe('');
    expect(Object.keys(sent.headers).sort()).toEqual(['content-type']);
    expect(saveRequests.at(-1)).not.toHaveProperty('packageId');
    expect(await labelsByPackage(engine, 'plain_probe')).toEqual({ '': { label: 'A', state: 'active' } });
  }, 60_000);

  it('UNFLAGGED, an item TWO packages hold: the active save is refused 409 RESOURCE_CONFLICT, and nothing is written', async () => {
    const { engine, client, saveRequests, wire } = await bootDoor();
    await twoPackageItem(client, 'two_pkg_save');
    const before = await labelsByPackage(engine, 'two_pkg_save');
    expect(before).toEqual({
      [PKG]: { label: 'A', state: 'active' },
      [OTHER_PKG]: { label: 'B', state: 'active' },
    });

    const run = await runCli(['view', '--data', dataFile(VIEW('two_pkg_save', 'C')), '--format', 'json']);

    expect(run.exitCode).toBe(1);
    const payload = JSON.parse(run.out);
    expect(payload.success).toBe(false);
    expect(payload.code).toBe('RESOURCE_CONFLICT');
    expect(payload.httpStatus).toBe(409);
    // It names both packages, so the operator can pick one for `--package`.
    expect(String(payload.error)).toContain(PKG);
    expect(String(payload.error)).toContain(OTHER_PKG);
    // Nothing written: both rows keep their bodies.
    expect(await labelsByPackage(engine, 'two_pkg_save')).toEqual(before);
    // The probe: no package reached the protocol, and none was on the wire.
    expect(saveRequests.at(-1)).not.toHaveProperty('packageId');
    expect(wire.filter((w) => w.method === 'PUT').at(-1)!.search).toBe('');
  }, 60_000);

  it('`--package P` writes P\'s row, and the other package\'s row is untouched', async () => {
    const { engine, client, saveRequests, wire } = await bootDoor();
    await twoPackageItem(client, 'two_pkg_save');

    const run = await runCli(['view', '--data', dataFile(VIEW('two_pkg_save', 'C')), '--package', PKG]);

    expect(run.exitCode).toBe(0);
    expect(run.out).toContain('Metadata registered: view/two_pkg_save');
    expect(await labelsByPackage(engine, 'two_pkg_save')).toEqual({
      [PKG]: { label: 'C', state: 'active' },
      [OTHER_PKG]: { label: 'B', state: 'active' },
    });
    // POSITIVE CONTROL for the previous case's absence: the same probe sees
    // the package arrive, read off `?package=` by the door.
    expect(saveRequests.at(-1).packageId).toBe(PKG);
    expect(wire.filter((w) => w.method === 'PUT').at(-1)!.search).toBe(`?package=${PKG}`);
  }, 60_000);

  it('`--package` names a NEW package: the save writes that package\'s row beside the existing one', async () => {
    const { engine, client } = await bootDoor();
    await client.meta.saveItem('view', 'one_pkg_save', VIEW('one_pkg_save', 'A'), { packageId: PKG });

    const run = await runCli(['view', '--data', dataFile(VIEW('one_pkg_save', 'B')), '--package', OTHER_PKG]);

    expect(run.exitCode).toBe(0);
    expect(await labelsByPackage(engine, 'one_pkg_save')).toEqual({
      [PKG]: { label: 'A', state: 'active' },
      [OTHER_PKG]: { label: 'B', state: 'active' },
    });
  }, 60_000);

  it('an empty `--package` is refused BEFORE the client is built — nothing reaches the door', async () => {
    const { engine, client, saveRequests } = await bootDoor();
    await client.meta.saveItem('view', 'empty_pkg', VIEW('empty_pkg', 'A'), { packageId: PKG });
    const requestsBefore = saveRequests.length;
    stub.createCalls = 0;

    // `--package "$PKG"` with `PKG` unset. Sent as the package-less save, the
    // door would resolve the item's one package and write its row while the
    // operator's command line reads as naming a package.
    const run = await runCli(['view', '--data', dataFile(VIEW('empty_pkg', 'B')), '--package', '']);
    expect(run.exitCode).toBe(1);
    expect(run.out).toContain(EMPTY_PACKAGE_SAVE_REFUSAL);
    expect(stub.createCalls).toBe(0);
    expect(saveRequests).toHaveLength(requestsBefore);
    expect(await labelsByPackage(engine, 'empty_pkg')).toEqual({ [PKG]: { label: 'A', state: 'active' } });

    // POSITIVE CONTROL — the same instruments move on a run that is let through.
    const ok = await runCli(['view', '--data', dataFile(VIEW('empty_pkg', 'B')), '--package', PKG]);
    expect(ok.exitCode).toBe(0);
    expect(stub.createCalls).toBe(1);
    expect(saveRequests).toHaveLength(requestsBefore + 1);
    expect(await labelsByPackage(engine, 'empty_pkg')).toEqual({ [PKG]: { label: 'B', state: 'active' } });
  }, 60_000);
});
