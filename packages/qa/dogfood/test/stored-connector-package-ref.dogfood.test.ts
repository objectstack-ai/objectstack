// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
//
// GOLDEN REGRESSION — a connector entry the host's own stack does not declare
// (a row stored through the metadata door, environment-wide or in an
// `authored` package) never reads, or launches a process in, the HOST's
// package root (#28594, the rest of the #28534 class).
//
// ## What was measured before the fix
//
// Saved through `PUT /api/v1/meta/connector/:name` on the showcase, a
// `provider: 'openapi'` entry naming `providerConfig.spec:
// './src/system/connectors/status-openapi.json'` (a file the showcase ships,
// and no stored row has a directory of its own) materialized `ready` on
// `GET /api/v1/automation/connectors` with the showcase's own document: its
// `getHealth` action. So did the same entry saved into an `authored` package
// (`POST /api/v1/packages`, then `?package=`), a stdio `mcp` entry naming
// `./scripts/mcp-fixture.mjs` (it spawned the showcase's own fixture in the
// showcase's directory), a stored row whose BODY carried the host package's
// `_packageId` while its column named none (it was also served with that
// stamp). PR #28587 refused an installed package's entries; every one of these
// reached the materializer as a host entry and was handed the host's root. (A
// save over the host's own connector name is refused by the save door,
// `NOT_OVERRIDABLE`, so that road is closed there.)
//
// ## What this file pins, on one boot
//
//   1. none of those entries materializes: each is absent from the listing,
//      and the reconcile's record names the entry, its ref and the remedy;
//   2. a stored row's `_packageId` in the metadata list (what the reconcile
//      reads) is its column's: a body stamp other than the column's is not
//      served;
//   3. controls: a stored entry carrying its document inline, and one naming
//      it by an http(s) URL, list `ready` with that document's operation; the
//      showcase's own file-ref and stdio entries keep listing `ready` with
//      their own actions.

import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { type VerifyStack } from '@objectstack/verify';
import { bootShowcase } from './showcase-boot.js';

const SYSTEM = { isSystem: true, positions: [], permissions: [] };

/** The showcase's own package id — a `code` row. */
const HOST_PACKAGE_ID = 'com.example.showcase';
/** An `authored` package created through the package door. */
const AUTHORED_PACKAGE_ID = 'com.dogfood.storedref';
/** A file the showcase ships, named the way its own entry names it. */
const FILE_REF = './src/system/connectors/status-openapi.json';

/** Environment-wide stored rows (no package). */
const ENV_FILE = 'sr_env_file';
const ENV_CWD = 'sr_env_cwd';
/** A row of the `authored` package. */
const AUTHORED_FILE = 'sr_authored_file';
/** A row whose BODY names the host's package while its column names none. */
const SELF_STAMPED = 'sr_self_stamped';
/** Controls: stored rows that never dereference a package ref. */
const INLINE = 'sr_inline';
const BY_URL = 'sr_by_url';
/** The showcase's own entries — the file-ref and stdio forms of the same two providers. */
const HOST_FILE_ENTRY = 'showcase_status_openapi';
const HOST_STDIO_ENTRY = 'showcase_mcp_tools';

/** A one-operation OpenAPI 3 document; nothing is dispatched, so its server answers nothing. */
const DOCUMENT = {
  openapi: '3.0.3',
  info: { title: 'Stored inline document', version: '1.0.0' },
  servers: [{ url: 'http://127.0.0.1:9/' }],
  paths: { '/v1/things': { get: { operationId: 'GetThings', responses: { '200': { description: 'ok' } } } } },
};

const openapi = (name: string, spec: unknown) => ({
  name,
  label: `Stored ${name}`,
  type: 'api',
  provider: 'openapi',
  providerConfig: { spec, baseUrl: 'http://127.0.0.1:9/' },
});

type Answer = { status: number; body: any };

async function json(res: Response): Promise<Answer> {
  return { status: res.status, body: await res.json().catch(() => null) };
}

/** Every line the process writes while `run` is in flight — the kernel logger writes to the streams. */
async function captureOutput<T>(run: () => Promise<T>): Promise<{ value: T; lines: string[] }> {
  const lines: string[] = [];
  const stdout = process.stdout.write.bind(process.stdout);
  const stderr = process.stderr.write.bind(process.stderr);
  const warn = console.warn;
  const error = console.error;
  (process.stdout as any).write = (chunk: unknown, ...rest: any[]) => { lines.push(String(chunk)); return stdout(chunk as any, ...rest); };
  (process.stderr as any).write = (chunk: unknown, ...rest: any[]) => { lines.push(String(chunk)); return stderr(chunk as any, ...rest); };
  console.warn = (...args: unknown[]) => { lines.push(args.map(String).join(' ')); warn(...args); };
  console.error = (...args: unknown[]) => { lines.push(args.map(String).join(' ')); error(...args); };
  try {
    return { value: await run(), lines };
  } finally {
    (process.stdout as any).write = stdout;
    (process.stderr as any).write = stderr;
    console.warn = warn;
    console.error = error;
  }
}

const listed = (answer: Answer): any[] => answer.body?.data?.connectors ?? [];
const entryOf = (answer: Answer, name: string): any => listed(answer).find((c: any) => c?.name === name);
/** What a listing says about one entry — enough for a failure to show whose document it carried. */
const shown = (answer: Answer, name: string): string => {
  const c = entryOf(answer, name);
  return c === undefined
    ? `'${name}' not listed`
    : JSON.stringify({ name: c.name, state: c.state, description: c.description, actions: c.actions?.map((a: any) => a.key) });
};
const rowsOf = (r: any): any[] => (Array.isArray(r) ? r : Array.isArray(r?.records) ? r.records : Array.isArray(r?.value) ? r.value : []);
const bodyOf = (row: any): Record<string, any> =>
  typeof row?.metadata === 'string' ? JSON.parse(row.metadata) : (row?.metadata ?? {});
const itemOf = (body: any): Record<string, any> => (body?.item ?? body?.data?.item ?? body?.data ?? body) as Record<string, any>;

describe('dogfood: a stored connector entry\'s package-relative ref is refused, never resolved against the host\'s root', () => {
  let stack: VerifyStack;
  let ql: any;
  let token: string;
  let upstream: Server;
  let documentUrl: string;
  const saves: Record<string, Answer> = {};
  let authoredPackage: Answer;
  let selfStampPut: Answer;
  let selfStampStored: Record<string, any> = {};
  let selfStampServed: Answer;
  let selfStampListed: Answer;
  let connectors: Answer;
  let lines: string[] = [];

  const list = async () => json(await stack.apiAs(token, 'GET', '/automation/connectors'));
  /** Read the listing until every `names` entry is in it, or the window closes. */
  const settle = async (names: readonly string[]): Promise<Answer> => {
    const deadline = Date.now() + 15_000;
    let answer: Answer;
    do {
      answer = await list();
      if (names.every((n) => entryOf(answer, n)?.state === 'ready')) break;
      await new Promise((r) => setTimeout(r, 100));
    } while (Date.now() < deadline);
    return answer;
  };

  beforeAll(async () => {
    upstream = createServer((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(DOCUMENT));
    });
    await new Promise<void>((r) => upstream.listen(0, '127.0.0.1', () => r()));
    documentUrl = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}/openapi.json`;

    stack = await bootShowcase({});
    ql = await stack.kernel.getServiceAsync<any>('objectql');
    token = await stack.signIn();

    const captured = await captureOutput(async () => {
      saves[ENV_FILE] = await json(await stack.apiAs(token, 'PUT', `/meta/connector/${ENV_FILE}`, openapi(ENV_FILE, FILE_REF)));
      saves[ENV_CWD] = await json(await stack.apiAs(token, 'PUT', `/meta/connector/${ENV_CWD}`, {
        name: ENV_CWD,
        label: 'Stored stdio',
        type: 'api',
        provider: 'mcp',
        providerConfig: { transport: { kind: 'stdio', command: 'node', args: ['./scripts/mcp-fixture.mjs'] } },
      }));
      authoredPackage = await json(await stack.apiAs(token, 'POST', '/packages', {
        id: AUTHORED_PACKAGE_ID, name: 'Stored connector refs', version: '1.0.0', type: 'app',
      }));
      saves[AUTHORED_FILE] = await json(await stack.apiAs(
        token, 'PUT', `/meta/connector/${AUTHORED_FILE}?package=${AUTHORED_PACKAGE_ID}`, openapi(AUTHORED_FILE, FILE_REF),
      ));
      // The body stamp through the save door, then a row AT REST carrying one
      // (the shape a row another writer stored can have), column naming none.
      selfStampPut = await json(await stack.apiAs(token, 'PUT', `/meta/connector/${SELF_STAMPED}`, {
        ...openapi(SELF_STAMPED, FILE_REF), _packageId: HOST_PACKAGE_ID,
      }));
      const [row] = rowsOf(await ql.find('sys_metadata', { where: { type: 'connector', name: SELF_STAMPED }, context: SYSTEM }));
      selfStampStored = bodyOf(row);
      await ql.update('sys_metadata', { id: row.id, metadata: JSON.stringify({ ...selfStampStored, _packageId: HOST_PACKAGE_ID }) }, {
        context: SYSTEM,
      });
      // The controls are saved last: once both list, every save above has been reconciled.
      saves[INLINE] = await json(await stack.apiAs(token, 'PUT', `/meta/connector/${INLINE}`, openapi(INLINE, DOCUMENT)));
      saves[BY_URL] = await json(await stack.apiAs(token, 'PUT', `/meta/connector/${BY_URL}`, openapi(BY_URL, documentUrl)));
      return settle([INLINE, BY_URL]);
    });
    connectors = captured.value;
    lines = captured.lines;
    selfStampServed = await json(await stack.apiAs(token, 'GET', `/meta/connector/${SELF_STAMPED}`));
    selfStampListed = await json(await stack.apiAs(token, 'GET', '/meta/connector'));
  }, 300_000);

  afterAll(async () => {
    await stack?.stop?.();
    await new Promise<void>((r) => (upstream ? upstream.close(() => r()) : r()));
  });

  it('every save is accepted by the metadata door, and the authored package exists', () => {
    expect(authoredPackage.status, JSON.stringify(authoredPackage.body)).toBeLessThan(300);
    for (const [name, answer] of Object.entries(saves)) {
      expect(answer.status, `${name}: ${JSON.stringify(answer.body).slice(0, 400)}`).toBe(200);
    }
    expect(selfStampPut.status, JSON.stringify(selfStampPut.body).slice(0, 400)).toBe(200);
    expect(connectors.status, JSON.stringify(connectors.body).slice(0, 400)).toBe(200);
  });

  it('controls: the stored inline and URL entries, and the showcase\'s own file-ref and stdio entries, list ready', () => {
    expect(entryOf(connectors, INLINE)?.state, shown(connectors, INLINE)).toBe('ready');
    expect(entryOf(connectors, INLINE).actions.map((a: any) => a.key)).toEqual(['GetThings']);
    expect(entryOf(connectors, BY_URL)?.state, shown(connectors, BY_URL)).toBe('ready');
    expect(entryOf(connectors, BY_URL).actions.map((a: any) => a.key)).toEqual(['GetThings']);
    expect(entryOf(connectors, HOST_FILE_ENTRY)?.state, shown(connectors, HOST_FILE_ENTRY)).toBe('ready');
    expect(entryOf(connectors, HOST_FILE_ENTRY).actions.map((a: any) => a.key)).toEqual(['getHealth']);
    expect(entryOf(connectors, HOST_STDIO_ENTRY)?.state, shown(connectors, HOST_STDIO_ENTRY)).toBe('ready');
  });

  it.each([
    [ENV_FILE, 'an environment-wide row naming a host FILE', `file ref '${FILE_REF}'`],
    [AUTHORED_FILE, 'an authored package\'s row naming a host FILE', `file ref '${FILE_REF}'`],
    [ENV_CWD, 'an environment-wide stdio row asking for a host LOCATION', 'path ref \'.\''],
    [SELF_STAMPED, 'a row whose body names the host\'s package', `file ref '${FILE_REF}'`],
  ])('%s — %s does not materialize, and the record names it and its ref', (name, _what, ref) => {
    expect(entryOf(connectors, name), shown(connectors, name)).toBeUndefined();
    const record = lines.find((l) => l.includes(`connector instance '${name}'`) && l.includes('is refused'));
    expect(record, `no reconcile record refuses '${name}'`).toBeDefined();
    expect(record).toContain(ref);
    expect(record).toContain('never against the host\'s');
  });

  it('a stored row\'s `_packageId` is its column\'s: the save door stores none, and the list does not serve a body stamp at rest', () => {
    expect(selfStampStored._packageId, 'the save door strips a body stamp').toBeUndefined();
    // The row exists and is served by name (the by-name read's own stamp is
    // not this list's; the materializer reads the list).
    expect(selfStampServed.status).toBe(200);
    expect(itemOf(selfStampServed.body).name).toBe(SELF_STAMPED);
    expect(selfStampListed.status).toBe(200);
    const items: any[] = selfStampListed.body?.data?.items ?? selfStampListed.body?.items ?? selfStampListed.body?.data ?? [];
    const listedRow = (Array.isArray(items) ? items : []).map((i: any) => i?.item ?? i).find((i: any) => i?.name === SELF_STAMPED);
    expect(listedRow, 'the list names the row').toBeDefined();
    expect(listedRow._packageId, 'in the list').not.toBe(HOST_PACKAGE_ID);
  });
});
