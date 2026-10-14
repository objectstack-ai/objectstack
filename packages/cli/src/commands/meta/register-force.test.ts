// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#23480] `os meta register` can send the acknowledgement the save door's
 * `409 DESTRUCTIVE_CHANGE` names as its remedy — `--force`, forwarded as
 * `SaveMetaItemOptions.force` (`?force=true`).
 *
 * ## The defect
 *
 * `saveMetaItem`'s Phase 3a gate refuses an `object` save that drops a field
 * or changes a field's type incompatibly, with `409 DESTRUCTIVE_CHANGE` and a
 * message ending "re-submit with ?force=true to proceed." The SDK has carried
 * `SaveMetaItemOptions.force` since #11391, but the command declared no flag
 * for it, so a CLI user was told to do something the command could not do.
 *
 * ## What is measured here, and on what
 *
 * The harness `register-package.test.ts` uses, copied rather than shared so
 * each file keeps its own wall time: the REAL oclif command, the REAL
 * `ObjectStackClient`, the REAL registered route handler (`RestServer`), the
 * REAL `ObjectStackProtocolImplementation` and REAL `sys_metadata*` tables on
 * SQLite, with the same two stubs at the credential boundary
 * (`createApiClient`, `resolveExecCtx`).
 *
 *  - Unflagged, a destructive re-register is refused 409 `DESTRUCTIVE_CHANGE`,
 *    the server's message is passed through verbatim, a CLI-side hint names
 *    `--force`, and nothing is written. This is the negative control for:
 *  - `--force` sends `?force=true`, and the same re-register lands.
 *  - A non-destructive re-register with `--force` lands exactly as the same
 *    re-register without it.
 *  - A failure that is not `DESTRUCTIVE_CHANGE` carries no hint.
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
// `register-package.test.ts` reaches them through.
import {
  SysMetadataObject,
  SysMetadataHistoryObject,
  SysMetadataAuditObject,
} from '@objectstack/platform-objects';
import { RestServer } from '@objectstack/runtime';
import { ObjectStackClient } from '@objectstack/client';
import MetaRegister, {
  metaRegisterOptions,
  metaRegisterRefusalHint,
  DESTRUCTIVE_CHANGE_FORCE_HINT,
  EMPTY_PACKAGE_SAVE_REFUSAL,
} from './register.js';

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

/** An environment-authored object with the two fields the card's probe used. */
const PROBE = (name: string, fields: Record<string, { type: string; label: string }>) => ({
  name,
  label: 'Probe',
  fields: Object.fromEntries(
    Object.entries(fields).map(([fname, f]) => [fname, { name: fname, ...f }]),
  ),
});
const TITLE = { type: 'text', label: 'Title' };
const NOTE = { type: 'text', label: 'Note' };
const EXTRA = { type: 'text', label: 'Extra' };

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
  engine.registry.registerObject(SysMetadataObject as any, TEST_PACKAGE_ID);
  engine.registry.registerObject(SysMetadataHistoryObject as any, TEST_PACKAGE_ID);
  engine.registry.registerObject(SysMetadataAuditObject as any, TEST_PACKAGE_ID);
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
    userId: 'usr_admin_23480',
    systemPermissions: ['manage_metadata'],
  });
  rest.registerRoutes();

  const wire: WireRecord[] = [];
  const client = new ObjectStackClient({ baseUrl: 'http://door.test', fetch: doorFetch(rest, wire) });
  stub.client = client;
  return { engine, client, saveRequests, wire };
}

/** The one stored body of `name`, straight out of `sys_metadata`. */
async function storedBody(engine: any, name: string): Promise<any> {
  const rows = await engine.find('sys_metadata', { where: { name }, context: { isSystem: true } });
  expect(rows).toHaveLength(1);
  const row = rows[0];
  return typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata;
}

/** The field names the stored body of `name` declares, sorted. */
async function storedFields(engine: any, name: string): Promise<string[]> {
  return Object.keys((await storedBody(engine, name))?.fields ?? {}).sort();
}

/** Write the `--data` file the command reads. */
function dataFile(body: unknown): string {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'os-meta-register-23480-'));
  tempDirs.push(dir);
  const file = path.join(dir, 'object.json');
  writeFileSync(file, JSON.stringify(body));
  return file;
}

/** The last `PUT` the client put on the wire. */
const lastPut = (wire: WireRecord[]) => wire.filter((w) => w.method === 'PUT').at(-1)!;

// ---------------------------------------------------------------------------
// The declared surface
// ---------------------------------------------------------------------------

describe('[#23480] the `--force` flag `os meta register` declares', () => {
  it('declares `--force` as a boolean, off by default, with no short alias, whose help names the refusal it answers', () => {
    const flags = MetaRegister.flags as Record<string, any>;
    expect(flags.force.type).toBe('boolean');
    expect(flags.force.default).toBe(false);
    expect(flags.force.char).toBeUndefined();
    expect(flags.force.allowNo).toBeFalsy();
    expect(flags.force.description).toMatch(/409/);
    expect(flags.force.description).toMatch(/DESTRUCTIVE_CHANGE/);
    expect((MetaRegister.examples as string[]).join('\n')).toContain('--force');
  });

  it('`metaRegisterOptions` maps `--force` to `force: true` only when given, and stays `undefined` unflagged', () => {
    expect(metaRegisterOptions({})).toBeUndefined();
    // oclif hands an absent boolean flag as `false`: no member, no options bag.
    expect(metaRegisterOptions({ force: false })).toBeUndefined();
    expect(metaRegisterOptions({ force: true })).toEqual({ force: true });
    expect(metaRegisterOptions({ force: true, package: PKG })).toEqual({ force: true, packageId: PKG });
    expect(metaRegisterOptions({ force: false, package: PKG })).toEqual({ packageId: PKG });
    // The empty-package refusal still comes first, with or without `--force`.
    expect(() => metaRegisterOptions({ force: true, package: '' })).toThrow(EMPTY_PACKAGE_SAVE_REFUSAL);
  });

  it('`metaRegisterRefusalHint` answers only a DESTRUCTIVE_CHANGE refusal on a run without `--force`', () => {
    const destructive = Object.assign(new Error('x'), { code: 'DESTRUCTIVE_CHANGE', httpStatus: 409 });
    const conflict = Object.assign(new Error('x'), { code: 'RESOURCE_CONFLICT', httpStatus: 409 });
    expect(metaRegisterRefusalHint(destructive, { force: false })).toBe(DESTRUCTIVE_CHANGE_FORCE_HINT);
    expect(metaRegisterRefusalHint(destructive, {})).toBe(DESTRUCTIVE_CHANGE_FORCE_HINT);
    // A run that sent `--force` has nothing left to re-run with.
    expect(metaRegisterRefusalHint(destructive, { force: true })).toBeUndefined();
    expect(metaRegisterRefusalHint(conflict, { force: false })).toBeUndefined();
    expect(metaRegisterRefusalHint(new Error('local'), { force: false })).toBeUndefined();
    expect(DESTRUCTIVE_CHANGE_FORCE_HINT).toContain('--force');
  });
});

// ---------------------------------------------------------------------------
// The real save door
// ---------------------------------------------------------------------------

describe('[#23480] `os meta register --force` against the real save door', () => {
  it('UNFLAGGED, a field removed: refused 409 DESTRUCTIVE_CHANGE, the server message verbatim plus a hint naming --force, and nothing is written', async () => {
    const { engine, client, saveRequests, wire } = await bootDoor();
    await client.meta.saveItem('object', 'probe_obj', PROBE('probe_obj', { title: TITLE, note: NOTE }));
    const before = await storedBody(engine, 'probe_obj');
    expect(Object.keys(before.fields).sort()).toEqual(['note', 'title']);

    const data = dataFile(PROBE('probe_obj', { title: TITLE }));
    const run = await runCli(['object', '--data', data, '--format', 'json']);

    expect(run.exitCode).toBe(1);
    const payload = JSON.parse(run.out);
    expect(payload.success).toBe(false);
    expect(payload.code).toBe('DESTRUCTIVE_CHANGE');
    expect(payload.httpStatus).toBe(409);
    // The server's own remedy survives: the command does not rewrite it.
    expect(String(payload.error)).toContain('?force=true');
    expect(String(payload.error)).toContain('note');
    // The CLI-side line names this command's spelling of that remedy.
    expect(payload.hint).toBe(DESTRUCTIVE_CHANGE_FORCE_HINT);
    // Nothing written: the stored body is the one saved before.
    expect(await storedBody(engine, 'probe_obj')).toEqual(before);
    // The probe: no `force` reached the protocol, and none was on the wire.
    expect(saveRequests.at(-1)).not.toHaveProperty('force');
    expect(lastPut(wire).search).toBe('');

    // The text face says the same two things.
    const text = await runCli(['object', '--data', data]);
    expect(text.exitCode).toBe(1);
    expect(text.out).toContain('?force=true');
    expect(text.out).toContain(DESTRUCTIVE_CHANGE_FORCE_HINT);
    expect(await storedFields(engine, 'probe_obj')).toEqual(['note', 'title']);
  }, 60_000);

  it('`--force`, the same re-register: `?force=true` on the wire, and the save lands without the field', async () => {
    const { engine, client, saveRequests, wire } = await bootDoor();
    await client.meta.saveItem('object', 'probe_obj', PROBE('probe_obj', { title: TITLE, note: NOTE }));

    const run = await runCli(['object', '--data', dataFile(PROBE('probe_obj', { title: TITLE })), '--force']);

    expect(run.exitCode).toBe(0);
    expect(run.out).toContain('Metadata registered: object/probe_obj');
    expect(await storedFields(engine, 'probe_obj')).toEqual(['title']);
    // POSITIVE CONTROL for the previous case's absence: the same probe sees
    // the acknowledgement arrive, read off `?force=true` by the door.
    expect(saveRequests.at(-1).force).toBe(true);
    expect(lastPut(wire).search).toBe('?force=true');
  }, 60_000);

  it('`--force` on a NON-destructive re-register lands exactly as the same re-register without it', async () => {
    const { engine, client, saveRequests } = await bootDoor();
    const seed = { title: TITLE, note: NOTE };
    await client.meta.saveItem('object', 'plain_obj', PROBE('plain_obj', seed));
    await client.meta.saveItem('object', 'forced_obj', PROBE('forced_obj', seed));
    const grown = { title: TITLE, note: NOTE, extra: EXTRA };

    const plainRun = await runCli(['object', '--data', dataFile(PROBE('plain_obj', grown))]);
    expect(saveRequests.at(-1)).not.toHaveProperty('force');
    const forcedRun = await runCli(['object', '--data', dataFile(PROBE('forced_obj', grown)), '--force']);
    expect(saveRequests.at(-1).force).toBe(true);

    expect(plainRun.exitCode).toBe(0);
    expect(forcedRun.exitCode).toBe(0);
    const plainBody = await storedBody(engine, 'plain_obj');
    const forcedBody = await storedBody(engine, 'forced_obj');
    expect(Object.keys(plainBody.fields).sort()).toEqual(['extra', 'note', 'title']);
    // Identical but for the name each was saved under.
    expect({ ...forcedBody, name: 'plain_obj' }).toEqual(plainBody);
  }, 60_000);

  it('a failure that is not DESTRUCTIVE_CHANGE carries no hint', async () => {
    const { saveRequests } = await bootDoor();

    // The CLI's own input refusal, before a client exists.
    const run = await runCli(['object', '--data', dataFile(PROBE('any_obj', { title: TITLE })), '--package', '', '--format', 'json']);

    expect(run.exitCode).toBe(1);
    const payload = JSON.parse(run.out);
    expect(payload.error).toBe(EMPTY_PACKAGE_SAVE_REFUSAL);
    expect(payload).not.toHaveProperty('hint');
    expect(saveRequests).toHaveLength(0);
  }, 60_000);
});
