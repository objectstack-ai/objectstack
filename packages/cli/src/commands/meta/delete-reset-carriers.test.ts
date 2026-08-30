// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#13024] `os meta delete` can pin its reset and can discard only the pending
 * draft — the CLI reaches the carriers the SDK gained in #12181.
 *
 * ## The defect
 *
 * `packages/cli/src/commands/meta/delete.ts` is the only in-repo caller of the
 * SDK reset, and it called `client.meta.deleteItem(type, name)` — two
 * arguments. It declared no `--if-match` and no draft flag, so EVERY CLI reset
 * was the unpinned, full one:
 *
 *  - **unpinned** — a concurrent edit is silently destroyed instead of
 *    answering `409 metadata_conflict`, on the one verb whose whole job is
 *    destroying an overlay row (ADR-0008; the door reads `If-Match` and threads
 *    it as `parentVersion`);
 *  - **full** — it drops the published overlay as well as any pending draft, so
 *    an operator who wanted to throw away only an unpublished draft had to take
 *    the more destructive path.
 *
 * Until #12181 there was no argument to pass either through. With
 * `DeleteMetaItemOptions` on both `deleteItem` declarations, only the CLI
 * surface was missing.
 *
 * ## Why this file boots a real door instead of asserting an options object
 *
 * A pin that checks "the command constructed `{ ifMatch }`" has verified
 * nothing this card is about. The claim is what the DOOR does with it — that
 * the same stale reset is a silent 200 unpinned and a 409 pinned, and that
 * `--draft` leaves the published overlay serving where the full reset does not.
 * So the cases below drive the REAL registered route handler (`RestServer`),
 * the REAL `ObjectStackProtocolImplementation`, and REAL `sys_metadata*` tables
 * on a real SQLite database, through the REAL oclif command — argv in,
 * `printSuccess` / error envelope out.
 *
 * Two seams are stubbed, both of them the credential boundary rather than any
 * part of the mechanism:
 *
 *  - `createApiClient` — "the operator is logged in, and here is the server" —
 *    replaced with a real `ObjectStackClient` whose `fetch` is a bridge into the
 *    registered handlers rather than a socket. Everything downstream of it (the
 *    SDK's `metaDeleteQuery` / `metaDeleteHeaders` builders, the wire, the
 *    door's header read, `refuseRepeatedQueryParams`, the `?state` parse, the
 *    threading into `deleteMetaItem`, the repository's parent-version check) is
 *    real code running here.
 *  - `resolveExecCtx` — "better-auth says this bearer holds `manage_metadata`",
 *    the same seam every neighbouring `/meta` door test stubs.
 *
 * ## All three `sys_metadata*` tables are really created
 *
 * Including `sys_metadata_audit`. The protocol's audit write is best-effort and
 * degrades to a logged failure when its table is missing — harmless to every
 * assertion here (they read `sys_metadata` rows, the door's response envelope,
 * or the request the door handed the protocol), but it prints one stack trace
 * per write, and a suite that fills CI's log with a real, expected error trains
 * the next reader to skim exactly the stream this repo asks them not to skim.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ObjectQL } from '@objectstack/objectql';
import { SqlDriver } from '@objectstack/driver-sql';
import { ObjectStackProtocolImplementation } from '@objectstack/metadata-protocol';
// The REAL stores the protocol writes to — not a mirror. Reached through
// `@objectstack/platform-objects`, which re-exports all three from
// `@objectstack/metadata-core`: that is the ONE already-resolved specifier in
// this package carrying the audit object too. `@objectstack/metadata` re-exports
// only two of the three, and `@objectstack/metadata-core` itself is not among
// the specifiers this package's tests resolve — `KNOWN_UNALIASED_TEST_IMPORTS`
// in `scripts/check-test-source-alias.mjs` is SHRINK-ONLY and its own refusal
// text says aliasing, not widening, is the fix.
import {
  SysMetadataObject,
  SysMetadataHistoryObject,
  SysMetadataAuditObject,
} from '@objectstack/platform-objects';
import { RestServer } from '@objectstack/runtime';
import { ObjectStackClient } from '@objectstack/client';
import MetaDelete, { metaDeleteOptions, EMPTY_IF_MATCH_REFUSAL } from './delete.js';

/**
 * The state the `createApiClient` stub reads, and the call counter that makes
 * "the command refused before anything could reach the network" a MEASUREMENT
 * rather than a claim about reading order.
 *
 * `vi.hoisted` because `vi.mock`'s factory is hoisted above every `import` and
 * runs while `./delete.js` is being evaluated — a plain `const` would still be
 * in its temporal dead zone.
 */
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

/**
 * `chalk` may or may not emit SGR codes depending on TTY detection.
 *
 * The escape is written as `\x1b`, never as the byte itself: one raw control
 * character makes grep treat the whole file as binary, and a test file nobody's
 * `git grep` can find is a test file that stops being maintained.
 */
const SGR = /\x1b\[[0-9;]*m/g;
const plain = (s: string) => s.replace(SGR, '');

interface CliRun {
  /** Everything the command printed, SGR-stripped, `console.log` and stdout alike. */
  out: string;
  /** `0`, or the code the command asked oclif to exit with. */
  exitCode: number;
  /** Whatever escaped `run()` — an oclif `ExitError` on the refusal paths. */
  thrown: unknown;
}

/** Drive the real oclif command with a real argv. */
async function runCli(argv: string[]): Promise<CliRun> {
  const chunks: string[] = [];
  const logSpy = vi
    .spyOn(console, 'log')
    .mockImplementation((...args: unknown[]) => { chunks.push(args.map(String).join(' ')); });
  // `emitText` writes through `writeStdoutDirect`, which calls
  // `stdout.write(text, callback)` and awaits the callback. A stub that
  // swallows the callback does not fail — it HANGS, and the case dies at its
  // own timeout looking like a slow door. Invoke it.
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
    await MetaDelete.run(argv, { root: CLI_ROOT });
  } catch (error: unknown) {
    thrown = error;
    const oclif = (error as { oclif?: { exit?: number } })?.oclif;
    exitCode = typeof oclif?.exit === 'number' ? oclif.exit : 1;
  } finally {
    logSpy.mockRestore();
    writeSpy.mockRestore();
    // oclif's default `catch` sets `process.exitCode`. Leaving it set would
    // fail this whole vitest worker on a case that PASSED.
    process.exitCode = savedExitCode;
  }
  return { out: plain(chunks.join('\n')), exitCode, thrown };
}

// ---------------------------------------------------------------------------
// The real stack the command talks to
// ---------------------------------------------------------------------------

const ADMIN = 'usr_admin_13024';
/** `registry.registerObject` takes `(schema, packageId, …)` — required by the signature. */
const TEST_PACKAGE_ID = 'objectstack-test';

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

/** Match a request path against the registered `/:param` route patterns. */
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

/** Every request that actually reached the door, in order. */
interface WireRecord { method: string; pathname: string; search: string; headers: Record<string, string> }

/**
 * A `fetch` that hands the client's request to the REAL registered handler.
 *
 * Faithful where fidelity is load-bearing: header names are lowercased the way
 * an HTTP server delivers them (so the door's `req.headers['if-match']` read is
 * the one exercised, not its `If-Match` fallback), and a repeated query key
 * arrives as an ARRAY — the shape `refuseRepeatedQueryParams` exists to catch.
 */
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
      {
        params: hit.params,
        query,
        headers,
        body: init.body ? JSON.parse(String(init.body)) : undefined,
      } as any,
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
afterEach(async () => {
  while (liveEngines.length) {
    try { await liveEngines.pop()?.destroy(); } catch { /* noop */ }
  }
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
  // Real DDL — the overlay rows the assertions read are physically there.
  await engine.syncSchemas();

  const protocol: any = new ObjectStackProtocolImplementation(engine as any);

  /**
   * The PROBE. Records the request the door hands the protocol, so "no pin ever
   * reached the protocol" is measured on the same instrument that shows it
   * BEING sent two cases later — the positive control that keeps an absence
   * assertion honest.
   */
  const deleteRequests: any[] = [];
  const realDelete = protocol.deleteMetaItem.bind(protocol);
  protocol.deleteMetaItem = async (request: any) => {
    deleteRequests.push(request);
    return realDelete(request);
  };

  const rest = new RestServer(
    createMockHttpServer() as any,
    protocol as any,
    { api: { requireAuth: false, enableProjectScoping: true, projectResolution: 'auto' } } as any,
  );
  // The ONLY stub below the transport: the auth boundary.
  (rest as any).resolveExecCtx = async () => ({
    userId: ADMIN,
    systemPermissions: ['manage_metadata'],
  });
  rest.registerRoutes();

  const wire: WireRecord[] = [];
  const client = new ObjectStackClient({ baseUrl: 'http://door.test', fetch: doorFetch(rest, wire) });
  stub.client = client;
  return { engine, protocol, rest, client, deleteRequests, wire };
}

/** The overlay rows for one item, straight out of `sys_metadata`. */
async function overlayRows(engine: any, name: string) {
  return engine.find('sys_metadata', { where: { name }, context: { isSystem: true } });
}

// ---------------------------------------------------------------------------
// Part 1 — the declared surface: flag parsing and help text
// ---------------------------------------------------------------------------

describe('[#13024] the flags `os meta delete` declares', () => {
  it('declares `--if-match` as a value flag and `--draft` as a boolean', () => {
    const flags = MetaDelete.flags as Record<string, any>;
    expect(flags['if-match'].type).toBe('option');
    expect(flags.draft.type).toBe('boolean');
    // A boolean whose default is `false` is what makes "no flag" and
    // "--draft not given" the same run — the byte-identity case below.
    expect(flags.draft.default).toBe(false);
  });

  it('help text names the CONSEQUENCE, not just the carrier', () => {
    const flags = MetaDelete.flags as Record<string, any>;
    // `--if-match` exists to stop a silent destruction; an operator who does
    // not already know ADR-0008 has to be able to learn that from `--help`.
    expect(flags['if-match'].description).toMatch(/409/);
    expect(flags['if-match'].description).toMatch(/metadata_conflict/);
    expect(flags['if-match'].description).toMatch(/last-write-wins/);
    // `--draft` exists because the full reset takes the published overlay too.
    expect(flags.draft.description).toMatch(/pending draft/i);
    expect(flags.draft.description).toMatch(/published overlay/i);
    // And both are reachable from the examples block, which is what `--help`
    // shows an operator who is not reading flag descriptions.
    const examples = (MetaDelete.examples as string[]).join('\n');
    expect(examples).toContain('--if-match');
    expect(examples).toContain('--draft');
  });

  it('`--draft` parses and `--state` does NOT — one spelling, enforced', async () => {
    await bootDoor();
    // Positive control first: the chosen spelling really is accepted, so the
    // refusal below is about `--state` and not about a broken harness.
    const accepted = await runCli(['view', 'nothing_here', '--draft']);
    expect(accepted.exitCode).toBe(0);

    const refused = await runCli(['view', 'nothing_here', '--state', 'draft']);
    expect(refused.exitCode).not.toBe(0);
    expect(String((refused.thrown as Error)?.message)).toMatch(/state/i);
  }, 60_000);

  it('the withheld third carrier has no flag, under either spelling', () => {
    const names = Object.keys(MetaDelete.flags as Record<string, unknown>);
    // #12181 shipped two of the door's three carriers on purpose; `?dropStorage`
    // is the one that ADDS destructive reach. A CLI flag for it would reverse
    // that ruling from the layer above.
    expect(names).not.toContain('dropStorage');
    expect(names).not.toContain('drop-storage');
    // POSITIVE CONTROL for those two absences: the same lookup on the same
    // object sees the flags that ARE declared.
    expect(names).toContain('if-match');
    expect(names).toContain('draft');
  });

  it('`metaDeleteOptions` returns UNDEFINED when neither flag is given', () => {
    // Not `{}`: an ordinary `os meta delete <type> <name>` must hand the SDK
    // the same argument list it always did. The byte-level half of that claim
    // is measured against the real door below.
    expect(metaDeleteOptions({})).toBeUndefined();
    expect(metaDeleteOptions({ draft: false })).toBeUndefined();
    expect(metaDeleteOptions({ 'if-match': 'v1' })).toEqual({ ifMatch: 'v1' });
    expect(metaDeleteOptions({ draft: true })).toEqual({ state: 'draft' });
    expect(metaDeleteOptions({ 'if-match': 'v1', draft: true }))
      .toEqual({ ifMatch: 'v1', state: 'draft' });
  });
});

// ---------------------------------------------------------------------------
// Part 2 — the real door: what `--if-match` actually does to a concurrent edit
// ---------------------------------------------------------------------------

describe('[#13024] `os meta delete --if-match` against the real reset door', () => {
  it('UNPINNED (the only reset this command could express before): the stale reset SUCCEEDS and the row is gone', async () => {
    const { engine, client, deleteRequests, wire } = await bootDoor();

    // Author A writes, and reads back the OCC token the pin echoes.
    const first: any = await client.meta.saveItem('view', 'race_probe', VIEW('race_probe', 'A'));
    const staleToken = first.version;
    expect(typeof staleToken).toBe('string');

    // Author B edits the same item. A's token is now stale.
    const second: any = await client.meta.saveItem('view', 'race_probe', VIEW('race_probe', 'B'));
    expect(second.version).not.toBe(staleToken);
    expect(await overlayRows(engine, 'race_probe')).toHaveLength(1);

    // A resets with no flags — the BEFORE state of this card.
    const run = await runCli(['view', 'race_probe']);
    expect(run.exitCode).toBe(0);
    expect(run.out).toContain('Metadata deleted: view/race_probe');

    // Silently destroyed: the command reports success and B's edit is gone.
    expect(await overlayRows(engine, 'race_probe')).toHaveLength(0);

    // The probe: no pin ever reached the protocol…
    const resets = deleteRequests.filter((r) => r.name === 'race_probe');
    expect(resets).toHaveLength(1);
    expect(resets[0]).not.toHaveProperty('parentVersion');
    // …and BYTE-IDENTITY on the wire: an unflagged run adds neither a query
    // string nor an `If-Match` header, so it sends what it always sent.
    const reset = wire.filter((w) => w.method === 'DELETE').at(-1)!;
    expect(reset.search).toBe('');
    expect(Object.keys(reset.headers).sort()).toEqual(['content-type']);
    // It also lands on the UNSCOPED mount — the twin this command reaches.
    expect(reset.pathname).toBe('/api/v1/meta/view/race_probe');
  }, 60_000);

  it('PINNED with a STALE version: the command FAILS with the conflict, and the other author\'s row survives', async () => {
    const { engine, client, deleteRequests, wire } = await bootDoor();

    const first: any = await client.meta.saveItem('view', 'race_probe', VIEW('race_probe', 'A'));
    const staleToken = first.version;
    const second: any = await client.meta.saveItem('view', 'race_probe', VIEW('race_probe', 'B'));
    expect(second.version).not.toBe(staleToken);

    const run = await runCli(['view', 'race_probe', '--if-match', staleToken]);

    // The refusal reaches the OPERATOR, not just the SDK: non-zero exit, and a
    // message naming the conflict rather than a bare failure. Asserting the
    // envelope, never merely "something went wrong" — a bare failure assertion
    // stays green against a command that never sent the header at all.
    expect(run.exitCode).toBe(1);
    expect(run.out).toContain('metadata_conflict');
    expect(run.out).toContain('view/race_probe');

    // THE point of the pin: the other author's row is still there.
    expect(await overlayRows(engine, 'race_probe')).toHaveLength(1);

    // POSITIVE CONTROL for the previous case's absence assertion — the same
    // probe, on the same door, sees the token arrive.
    const resets = deleteRequests.filter((r) => r.name === 'race_probe');
    expect(resets).toHaveLength(1);
    expect(resets[0].parentVersion).toBe(staleToken);
    // …carried as a HEADER, verbatim and unquoted, with no `?ifMatch=` on the
    // URL (the door reads no such parameter — a query spelling would look set
    // at the call site and protect nothing).
    const sent = wire.filter((w) => w.method === 'DELETE').at(-1)!;
    expect(sent.headers['if-match']).toBe(staleToken);
    expect(sent.search).toBe('');
  }, 60_000);

  it('PINNED with the CURRENT version: the reset is allowed through', async () => {
    // The other half of the pin — it refuses a stale write, not every write.
    // Without this, "always 409" would pass the case above.
    const { engine, client } = await bootDoor();
    const saved: any = await client.meta.saveItem('view', 'fresh_probe', VIEW('fresh_probe', 'A'));

    const run = await runCli(['view', 'fresh_probe', '--if-match', saved.version]);
    expect(run.exitCode).toBe(0);
    expect(run.out).toContain('Metadata deleted: view/fresh_probe');
    expect(await overlayRows(engine, 'fresh_probe')).toHaveLength(0);
  }, 60_000);

  it('`--format json` reports the pinned refusal in the machine-readable envelope too', async () => {
    const { engine, client } = await bootDoor();
    const first: any = await client.meta.saveItem('view', 'json_probe', VIEW('json_probe', 'A'));
    await client.meta.saveItem('view', 'json_probe', VIEW('json_probe', 'B'));

    const run = await runCli(['view', 'json_probe', '--format', 'json', '--if-match', first.version]);
    expect(run.exitCode).toBe(1);
    const payload = JSON.parse(run.out);
    expect(payload.success).toBe(false);
    expect(String(payload.error)).toContain('metadata_conflict');
    expect(await overlayRows(engine, 'json_probe')).toHaveLength(1);
  }, 60_000);
});

// ---------------------------------------------------------------------------
// Part 3 — the real door: `--draft` discards ONLY the pending draft
// ---------------------------------------------------------------------------

describe('[#13024] `os meta delete --draft` against the real reset door', () => {
  it('the narrow reset leaves the published overlay serving; the full reset does not', async () => {
    const { engine, client, deleteRequests, wire } = await bootDoor();

    // A published overlay, then a pending draft on top of it.
    await client.meta.saveItem('view', 'draft_probe', VIEW('draft_probe', 'published'));
    await client.meta.saveItem('view', 'draft_probe', VIEW('draft_probe', 'pending'), { mode: 'draft' });
    const before = await overlayRows(engine, 'draft_probe');
    expect(before).toHaveLength(2);
    expect(before.map((r: any) => r.state).sort()).toEqual(['active', 'draft']);

    // The narrow reset — unreachable from this command before this card.
    const narrow = await runCli(['view', 'draft_probe', '--draft']);
    expect(narrow.exitCode).toBe(0);
    // The human-mode sentence reports what actually happened. The full-reset
    // wording here would be a false report on the run where the operator
    // deliberately chose the narrower verb.
    expect(narrow.out).toContain('Pending draft discarded: view/draft_probe');
    expect(narrow.out).not.toContain('Metadata deleted');

    // On the wire: `?state=draft`, and nothing else.
    const narrowWire = wire.filter((w) => w.method === 'DELETE').at(-1)!;
    expect(narrowWire.search).toBe('?state=draft');
    expect(narrowWire.headers['if-match']).toBeUndefined();
    // The door parsed it and threaded it into the protocol call — the positive
    // control for the ABSENCE asserted on the full reset below.
    expect(deleteRequests.at(-1).state).toBe('draft');

    // THE claim: the published overlay is untouched, and only the draft is gone.
    const after = await overlayRows(engine, 'draft_probe');
    expect(after).toHaveLength(1);
    expect(after[0].state).toBe('active');

    // …and the FULL reset — the only one this command could express before —
    // takes the published overlay with it. This is why withholding `--draft`
    // did not make the CLI safer.
    const full = await runCli(['view', 'draft_probe']);
    expect(full.exitCode).toBe(0);
    expect(full.out).toContain('Metadata deleted: view/draft_probe');
    expect(await overlayRows(engine, 'draft_probe')).toHaveLength(0);
    // The probe again: `state` is ABSENT on the full reset, measured on the
    // same instrument that showed it present above.
    expect(deleteRequests.at(-1)).not.toHaveProperty('state');
    expect(wire.filter((w) => w.method === 'DELETE').at(-1)!.search).toBe('');
  }, 60_000);

  it('both carriers at once: pinned AND narrow, without disturbing either', async () => {
    const { engine, client, deleteRequests, wire } = await bootDoor();
    await client.meta.saveItem('view', 'both_probe', VIEW('both_probe', 'published'));
    const draft: any = await client.meta.saveItem('view', 'both_probe', VIEW('both_probe', 'pending'), { mode: 'draft' });

    const run = await runCli(['view', 'both_probe', '--draft', '--if-match', draft.version]);
    expect(run.exitCode).toBe(0);

    const sent = wire.filter((w) => w.method === 'DELETE').at(-1)!;
    expect(sent.search).toBe('?state=draft');
    expect(sent.headers['if-match']).toBe(draft.version);
    expect(deleteRequests.at(-1).state).toBe('draft');
    expect(deleteRequests.at(-1).parentVersion).toBe(draft.version);

    const after = await overlayRows(engine, 'both_probe');
    expect(after).toHaveLength(1);
    expect(after[0].state).toBe('active');
  }, 60_000);
});

// ---------------------------------------------------------------------------
// Part 4 — the CLI's OWN refusal: a pin that is empty is not a pin
// ---------------------------------------------------------------------------

describe('[#13024] an empty `--if-match` is refused, never silently downgraded', () => {
  it('refuses BEFORE the client is built — nothing reaches the door', async () => {
    const { engine, client, deleteRequests } = await bootDoor();
    await client.meta.saveItem('view', 'empty_pin', VIEW('empty_pin', 'A'));
    const requestsBefore = deleteRequests.length;
    stub.createCalls = 0;

    // `os meta delete view empty_pin --if-match "$VERSION"` with `VERSION`
    // unset is exactly this argv. Inheriting the SDK's "empty omits the header"
    // rule here would run the UNPINNED reset while the operator's command line
    // reads as pinned — the silent destruction this card exists to prevent.
    const run = await runCli(['view', 'empty_pin', '--if-match', '']);
    expect(run.exitCode).toBe(1);
    expect(run.out).toContain(EMPTY_IF_MATCH_REFUSAL);

    // The refusal half of the pin, both limbs: no client was ever created, and
    // the protocol was never called…
    expect(stub.createCalls).toBe(0);
    expect(deleteRequests).toHaveLength(requestsBefore);
    // …and the row the unpinned reset would have destroyed is still there.
    expect(await overlayRows(engine, 'empty_pin')).toHaveLength(1);

    // POSITIVE CONTROL — the same two instruments, on a run that IS allowed
    // through, move. Without this, a harness that never ran the command at all
    // would read identically to a refusal.
    const ok = await runCli(['view', 'empty_pin']);
    expect(ok.exitCode).toBe(0);
    expect(stub.createCalls).toBe(1);
    expect(deleteRequests).toHaveLength(requestsBefore + 1);
    expect(await overlayRows(engine, 'empty_pin')).toHaveLength(0);
  }, 60_000);

  it('a whitespace-only pin is refused the same way', async () => {
    const { engine, client, deleteRequests } = await bootDoor();
    await client.meta.saveItem('view', 'blank_pin', VIEW('blank_pin', 'A'));
    const requestsBefore = deleteRequests.length;

    const run = await runCli(['view', 'blank_pin', '--if-match', '   ']);
    expect(run.exitCode).toBe(1);
    expect(run.out).toContain(EMPTY_IF_MATCH_REFUSAL);
    expect(deleteRequests).toHaveLength(requestsBefore);
    expect(await overlayRows(engine, 'blank_pin')).toHaveLength(1);
  }, 60_000);

  it('reports the refusal through `--format json` as well', async () => {
    await bootDoor();
    const run = await runCli(['view', 'empty_pin', '--format', 'json', '--if-match', '']);
    expect(run.exitCode).toBe(1);
    const payload = JSON.parse(run.out);
    expect(payload.success).toBe(false);
    expect(payload.error).toBe(EMPTY_IF_MATCH_REFUSAL);
  }, 60_000);

  it('a NON-empty pin is forwarded verbatim — the value is opaque, never parsed', async () => {
    const { client, wire } = await bootDoor();
    // Surrounding whitespace inside a real token is the door's business, not
    // this command's: `DeleteMetaItemOptions.ifMatch` says echo it verbatim.
    await client.meta.saveItem('view', 'verbatim_probe', VIEW('verbatim_probe', 'A'));
    const token = '  sha256:deadbeef  ';
    await runCli(['view', 'verbatim_probe', '--if-match', token]);
    const sent = wire.filter((w) => w.method === 'DELETE').at(-1)!;
    expect(sent.headers['if-match']).toBe(token);
  }, 60_000);
});

// ---------------------------------------------------------------------------
// Part 5 — both SDK twins, driven with the bag this command builds
// ---------------------------------------------------------------------------

/**
 * The SDK carries TWO textually identical `deleteItem` declarations — the
 * unscoped `ObjectStackClient.meta` and the environment-scoped
 * `ScopedEnvironmentClient.meta` — and #11713's trap is a fix landing on one of
 * a pair, where a global count cannot tell "both fixed" from "half fixed".
 *
 * Measured, this command reaches exactly ONE of them: `createApiClient` builds
 * a plain `ObjectStackClient` and passes any environment id as a CONFIG value
 * (the client sends it as the `X-Environment-Id` header), and `run()` holds
 * `client.meta` — the unscoped namespace. The unscoped mount is what the wire
 * assertions in Part 2 read back.
 *
 * So the both-twins obligation is discharged by driving the bag this command
 * BUILDS (`metaDeleteOptions`, the exported one `run()` calls) through the
 * scoped twin against the SAME door, and comparing verdicts — not by asserting
 * that a shared type exists.
 */
describe('[#13024] the CLI\'s option bag behaves identically through both SDK twins', () => {
  it('the command reaches the UNSCOPED twin — stated as a measurement, not an assumption', async () => {
    const { client, wire } = await bootDoor();
    await client.meta.saveItem('view', 'mount_probe', VIEW('mount_probe', 'A'));
    await runCli(['view', 'mount_probe', '--draft']);
    const sent = wire.filter((w) => w.method === 'DELETE').at(-1)!;
    expect(sent.pathname).toBe('/api/v1/meta/view/mount_probe');
    expect(sent.pathname).not.toContain('/environments/');
  }, 60_000);

  it('PINNED: the same stale token is refused 409 through the scoped twin too', async () => {
    const { engine, client, deleteRequests } = await bootDoor();
    const scoped = client.environment('env-13024').meta;

    const first: any = await scoped.saveItem('view', 'scoped_race', VIEW('scoped_race', 'A'));
    await scoped.saveItem('view', 'scoped_race', VIEW('scoped_race', 'B'));

    // The bag the CLI builds for `--if-match <stale>`, handed to declaration #2.
    const options = metaDeleteOptions({ 'if-match': first.version });
    const err: any = await scoped.deleteItem('view', 'scoped_race', options).then(
      () => { throw new Error('expected the stale scoped reset to be refused'); },
      (e: any) => e,
    );
    expect(err.code).toBe('METADATA_CONFLICT');
    expect(err.httpStatus).toBe(409);
    expect(await overlayRows(engine, 'scoped_race')).toHaveLength(1);
    expect(deleteRequests.at(-1).parentVersion).toBe(first.version);
  }, 60_000);

  it('NARROW: the same `--draft` bag discards only the draft through the scoped twin too', async () => {
    const { engine, client, deleteRequests } = await bootDoor();
    const scoped = client.environment('env-13024').meta;

    await scoped.saveItem('view', 'scoped_draft', VIEW('scoped_draft', 'published'));
    await scoped.saveItem('view', 'scoped_draft', VIEW('scoped_draft', 'pending'), { mode: 'draft' });

    const options = metaDeleteOptions({ draft: true });
    const discarded: any = await scoped.deleteItem('view', 'scoped_draft', options);
    expect(discarded.success).toBe(true);
    expect(deleteRequests.at(-1).state).toBe('draft');
    const after = await overlayRows(engine, 'scoped_draft');
    expect(after).toHaveLength(1);
    expect(after[0].state).toBe('active');
  }, 60_000);

  it('IN STEP: identical wire bytes out of both twins for the bag the CLI builds', async () => {
    // Compared against each other rather than against a restated literal, so
    // the pin keeps holding if either path changes.
    const { client, wire } = await bootDoor();
    const options = metaDeleteOptions({ 'if-match': 'sha256:probe', draft: true });
    await client.meta.deleteItem('view', 'in_step', options).catch(() => undefined);
    await client.environment('env-13024').meta.deleteItem('view', 'in_step', options).catch(() => undefined);

    const [unscoped, scoped] = wire.filter((w) => w.method === 'DELETE');
    expect(scoped.search).toBe(unscoped.search);
    expect(unscoped.search).toBe('?state=draft');
    expect(scoped.headers['if-match']).toBe(unscoped.headers['if-match']);
    expect(unscoped.headers['if-match']).toBe('sha256:probe');
    // The two mounts differ in exactly one way — the path prefix.
    expect(unscoped.pathname).toBe('/api/v1/meta/view/in_step');
    expect(scoped.pathname).toBe('/api/v1/environments/env-13024/meta/view/in_step');
  }, 60_000);

  it('IN STEP when unflagged: neither twin adds a query or a header', async () => {
    const { client, wire } = await bootDoor();
    const options = metaDeleteOptions({});
    await client.meta.deleteItem('view', 'in_step_bare', options).catch(() => undefined);
    await client.environment('env-13024').meta.deleteItem('view', 'in_step_bare', options).catch(() => undefined);

    const [unscoped, scoped] = wire.filter((w) => w.method === 'DELETE');
    expect(unscoped.search).toBe('');
    expect(scoped.search).toBe('');
    expect(Object.keys(unscoped.headers).sort()).toEqual(['content-type']);
    expect(Object.keys(scoped.headers).sort()).toEqual(['content-type']);
  }, 60_000);
});
