// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#8860] Does `@libsql/client` honour `?authToken=` supplied in an authored URL?
 *
 * # Why this file exists
 *
 * The driver hands the authored `url` / `syncUrl` to `@libsql/client` untouched
 * and passes the credential as its own `authToken` config key. Whether a token
 * *inside the URL's query string* is a second, equivalent credential channel was
 * never observed by anyone — it was asserted as "plausible" for two days while a
 * separate spec-lane card reasoned about the consequences. This file is the
 * measurement, pinned so the answer cannot rot silently under a caret range.
 *
 * # What was measured (all four answers are on the wire, not inferred)
 *
 * Measured against **`@libsql/client@0.17.4`** (`@libsql/core@0.17.4`, native
 * `libsql@0.5.29`) — the range in `package.json` is `^0.17.3`, so the resolved
 * version is part of the result and this file asserts it.
 *
 * 1. **`url` + `?authToken=` → HONOURED.** The token becomes a real
 *    `Authorization: Bearer <token>` on the wire and the request authenticates.
 * 2. **Precedence on `url` → THE QUERY STRING WINS.** With a token in both the
 *    URL and the explicit `authToken` option, the URL's value is what is sent —
 *    the authored string silently overrides the credential the caller passed in.
 * 3. **`syncUrl` + `?authToken=` in replica mode → NOT HONOURED, and actively
 *    harmful.** The replica path never parses the query string: the credential
 *    goes out empty (`Authorization: Bearer`), and because the native layer
 *    builds its endpoint by concatenation, the query string corrupts the request
 *    *path* (`/?authToken=…/info`). Precedence is inverted here — the explicit
 *    option is the only channel that works.
 * 4. The two paths therefore **disagree**, which is the answer the spec lane
 *    needed: a token in `url` is a live credential, a token in `syncUrl` is not.
 *
 * # Why each leg has a control
 *
 * A "the token was ignored" result from a probe that could not have detected the
 * token being honoured proves nothing. Every negative here is paired with a
 * positive control on the same harness: the endpoint rejects (401) unless it is
 * shown the exact expected bearer value, so a leg that authenticates proves the
 * probe reads the header's *value*, not merely its presence.
 *
 * # Harness note — the replica endpoint runs in its own process
 *
 * `@libsql/client`'s embedded-replica `createClient` opens **synchronously** in
 * native code (`databaseOpenWithSync`), which blocks the calling event loop for
 * the whole duration of the initial sync. An in-process HTTP endpoint can
 * therefore never answer it, and the run deadlocks — a harness artefact that
 * looks exactly like "the client made no request". The replica legs spawn the
 * endpoint as a child process for that reason; do not "simplify" them back.
 *
 * ⛔ Scope: this file only *records* behaviour. Refusing or redacting a
 * credential-bearing URL is a `packages/spec` concern and is not done here.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { createRequire } from 'node:module';
import { TursoDriver } from './turso-driver.js';

const URL_TOKEN = 'header.payload.URL-TOKEN';
const OPTION_TOKEN = 'header.payload.OPTION-TOKEN';

interface WireRecord {
  method: string;
  path: string;
  authorization: string | null;
}

/** In-process endpoint — fine for remote mode, which never blocks the loop. */
async function startInProcessEndpoint(expectedToken: string) {
  const seen: WireRecord[] = [];
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c as Buffer));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      const authorization = req.headers.authorization ?? null;
      seen.push({ method: req.method ?? '', path: req.url ?? '', authorization });

      if (authorization !== `Bearer ${expectedToken}`) {
        res.writeHead(401, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'probe-401: bearer token absent or wrong' }));
        return;
      }
      let parsed: { requests?: { type: string }[] } = {};
      try {
        parsed = JSON.parse(body || '{}');
      } catch {
        /* not a pipeline body */
      }
      const results = (parsed.requests ?? []).map((r) =>
        r.type === 'execute'
          ? {
              type: 'ok',
              response: {
                type: 'execute',
                result: {
                  cols: [{ name: 'probe', decltype: null }],
                  rows: [[{ type: 'integer', value: '1' }]],
                  affected_row_count: 0,
                  last_insert_rowid: null,
                  replication_index: null,
                  rows_read: 1,
                  rows_written: 0,
                  query_duration_ms: 0,
                },
              },
            }
          : { type: 'ok', response: { type: r.type } },
      );
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ baton: null, base_url: null, results }));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const port = (server.address() as { port: number }).port;
  return {
    origin: `http://127.0.0.1:${port}`,
    seen,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

interface RemoteProbe {
  ok: boolean;
  error?: string;
  seen: WireRecord[];
}

/** Drive remote mode through TursoDriver's own construction path. */
async function probeRemote(mkConfig: (origin: string) => Record<string, unknown>): Promise<RemoteProbe> {
  const endpoint = await startInProcessEndpoint(URL_TOKEN);
  try {
    const driver = new TursoDriver(mkConfig(endpoint.origin) as never);
    await driver.connect();
    // The client the driver itself constructed, used as the probe.
    const client = (driver as unknown as { libsqlClient: { execute(sql: string): Promise<unknown> } })
      .libsqlClient;
    await client.execute('SELECT 1 AS probe');
    await driver.disconnect();
    return { ok: true, seen: endpoint.seen };
  } catch (e) {
    return { ok: false, error: (e as Error)?.message ?? String(e), seen: endpoint.seen };
  } finally {
    await endpoint.close();
  }
}

// ---------------------------------------------------------------------------
// Replica harness: endpoint in a child process (see the header note).
// ---------------------------------------------------------------------------

const SERVER_SOURCE = `
import http from 'node:http';
import fs from 'node:fs';
const [, , expectedToken, wireLog, portFile] = process.argv;
const server = http.createServer((req, res) => {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    const auth = req.headers.authorization ?? null;
    fs.appendFileSync(wireLog, JSON.stringify({ method: req.method, path: req.url, authorization: auth }) + '\\n');
    if (auth !== 'Bearer ' + expectedToken) {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'probe-401' }));
      return;
    }
    // Token accepted. The replication protocol is deliberately NOT implemented:
    // a client that gets this far fails on decoding, never with Unauthorized —
    // and that difference is what separates "authenticated" from "rejected".
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
  });
});
server.listen(0, '127.0.0.1', () => fs.writeFileSync(portFile, String(server.address().port)));
process.on('SIGTERM', () => process.exit(0));
`;

let harnessDir: string;
let serverScript: string;

beforeAll(() => {
  harnessDir = fs.mkdtempSync(path.join(os.tmpdir(), 'os8860-pin-'));
  serverScript = path.join(harnessDir, 'endpoint.mjs');
  fs.writeFileSync(serverScript, SERVER_SOURCE);
});

afterAll(() => {
  fs.rmSync(harnessDir, { recursive: true, force: true });
});

interface ReplicaProbe {
  outcome: string;
  seen: WireRecord[];
}

async function probeReplica(mkConfig: (origin: string) => Record<string, unknown>): Promise<ReplicaProbe> {
  const id = Math.random().toString(36).slice(2);
  const wireLog = path.join(harnessDir, `wire-${id}.jsonl`);
  const portFile = path.join(harnessDir, `port-${id}.txt`);
  fs.writeFileSync(wireLog, '');

  let child: ChildProcess | undefined;
  try {
    child = spawn(process.execPath, [serverScript, URL_TOKEN, wireLog, portFile], {
      stdio: 'ignore',
    });
    // Wait for the child to publish its port.
    let port = '';
    for (let i = 0; i < 100 && !port; i++) {
      await new Promise((r) => setTimeout(r, 50));
      if (fs.existsSync(portFile)) port = fs.readFileSync(portFile, 'utf8').trim();
    }
    if (!port) throw new Error('probe endpoint did not start');

    const dbDir = fs.mkdtempSync(path.join(harnessDir, 'db-'));
    const config = {
      url: `file:${path.join(dbDir, 'replica.db')}`,
      sync: { onConnect: true },
      ...mkConfig(`http://127.0.0.1:${port}`),
    };

    let outcome: string;
    const driver = new TursoDriver(config as never);
    try {
      await driver.connect();
      outcome = 'connected';
    } catch (e) {
      outcome = (e as Error)?.message ?? String(e);
    }
    try {
      await driver.disconnect();
    } catch {
      /* the replica never came up; nothing to close */
    }

    const seen = fs
      .readFileSync(wireLog, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as WireRecord);
    return { outcome, seen };
  } finally {
    child?.kill('SIGTERM');
  }
}

// ---------------------------------------------------------------------------

describe('[#8860] `?authToken=` as a credential channel in an authored URL', () => {
  it('pins the resolved @libsql/client version the answers below were measured against', () => {
    // `@libsql/client` does not export `./package.json`, so resolve its entry
    // module and climb to the manifest that owns it — this reads the INSTALLED
    // tree, never the caret range in our own package.json.
    const require_ = createRequire(import.meta.url);
    let dir = path.dirname(require_.resolve('@libsql/client'));
    let version: string | undefined;
    for (let i = 0; i < 10; i++) {
      const candidate = path.join(dir, 'package.json');
      if (fs.existsSync(candidate)) {
        const manifest = JSON.parse(fs.readFileSync(candidate, 'utf8')) as {
          name?: string;
          version?: string;
        };
        if (manifest.name === '@libsql/client') {
          version = manifest.version;
          break;
        }
      }
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    // Answer 4. A caret range means this can move without anyone editing a file;
    // when it does, re-run the legs below rather than bumping this line blind.
    expect(version).toBe('0.17.4');
  });

  describe('remote mode — the `url` channel', () => {
    it('ANSWER 1: a token in the authored `url` query string IS honoured as the credential', async () => {
      const probe = await probeRemote((origin) => ({ url: `${origin}?authToken=${URL_TOKEN}` }));

      // The endpoint rejects anything but the exact bearer value, so success is
      // proof the query-string token authenticated.
      expect(probe.ok).toBe(true);
      expect(probe.seen).toHaveLength(1);
      expect(probe.seen[0]!.authorization).toBe(`Bearer ${URL_TOKEN}`);
    }, 30_000);

    it('control: the same probe FAILS when no token is supplied at all', async () => {
      const probe = await probeRemote((origin) => ({ url: origin }));

      // Without this leg the answer above would be an unvalidated positive.
      expect(probe.ok).toBe(false);
      expect(probe.error).toMatch(/401/);
      expect(probe.seen[0]!.authorization).toBeNull();
    }, 30_000);

    it('control: the explicit `authToken` option is a working channel on its own', async () => {
      const probe = await probeRemote((origin) => ({ url: origin, authToken: URL_TOKEN }));

      expect(probe.ok).toBe(true);
      expect(probe.seen[0]!.authorization).toBe(`Bearer ${URL_TOKEN}`);
    }, 30_000);

    it('ANSWER 2: when both are present the URL query string WINS over the explicit option', async () => {
      const probe = await probeRemote((origin) => ({
        url: `${origin}?authToken=${URL_TOKEN}`,
        authToken: OPTION_TOKEN,
      }));

      // The authored string silently displaces the credential the caller passed.
      expect(probe.seen[0]!.authorization).toBe(`Bearer ${URL_TOKEN}`);
      expect(probe.seen[0]!.authorization).not.toContain(OPTION_TOKEN);
      expect(probe.ok).toBe(true);
    }, 30_000);
  });

  describe('replica mode — the `syncUrl` channel behaves the OPPOSITE way', () => {
    it('control: an explicit `authToken` IS sent to the sync target', async () => {
      const probe = await probeReplica((origin) => ({ syncUrl: origin, authToken: URL_TOKEN }));

      expect(probe.seen.length).toBeGreaterThan(0);
      expect(probe.seen[0]!.authorization).toBe(`Bearer ${URL_TOKEN}`);
      // Authenticated: the failure is protocol decoding, never authorization.
      expect(probe.outcome).not.toMatch(/unauthorized/i);
    }, 60_000);

    it('ANSWER 3: a token in the `syncUrl` query string is NOT honoured, and corrupts the request path', async () => {
      const probe = await probeReplica((origin) => ({ syncUrl: `${origin}/?authToken=${URL_TOKEN}` }));

      expect(probe.seen.length).toBeGreaterThan(0);
      const wire = probe.seen[0]!;

      // The credential goes out EMPTY — the query string is never parsed.
      expect(wire.authorization).not.toContain(URL_TOKEN);
      expect(wire.authorization).toBe('Bearer');

      // Worse: the native layer concatenates the sync endpoint onto the authored
      // string, so the query string lands in the PATH of every sync request.
      expect(wire.path).toContain('authToken=');
      expect(wire.path).toContain('/info');

      expect(probe.outcome).toMatch(/unauthorized/i);
    }, 60_000);

    it('ANSWER 3 (precedence): on the replica path the explicit option wins — inverted from `url`', async () => {
      const probe = await probeReplica((origin) => ({
        syncUrl: `${origin}/?authToken=${URL_TOKEN}`,
        authToken: OPTION_TOKEN,
      }));

      expect(probe.seen.length).toBeGreaterThan(0);
      expect(probe.seen[0]!.authorization).toBe(`Bearer ${OPTION_TOKEN}`);
      expect(probe.seen[0]!.authorization).not.toContain(URL_TOKEN);
    }, 60_000);
  });
});
