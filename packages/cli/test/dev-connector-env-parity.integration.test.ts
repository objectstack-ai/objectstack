// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #26130 — on an `os dev` boot, a connector value the config reads from the
 * environment is the same in the served metadata and in what dispatch calls.
 *
 * ## The defect, measured at the public door before the fix
 *
 * A host config's `os dev` boot holds two copies of one stack: the config
 * MODULE the `serve` child evaluates (the AppPlugin wrap; provider-bound
 * connectors are materialized from its registry copy, so it is what dispatch
 * calls) and the compiled artifact (the dev artifact door; its copy is what
 * `/api/v1/meta/connector/NAME` serves). `examples/app-showcase` builds its
 * connectors' `baseUrl` from `OS_PORT` at module evaluation, and `os dev` booted
 * whatever `dist/objectstack.json` already held. Measured on the showcase,
 * `os dev` with `OS_PORT=41302` over an artifact built without it:
 *
 *   | reader                                               | before          | after           |
 *   |------------------------------------------------------|-----------------|-----------------|
 *   | `GET /api/v1/meta/connector/showcase_status_api`     | `…:3000`        | `…:41302`       |
 *   | the materialized connector (`connector_action`)      | `…:41302`       | `…:41302`       |
 *
 * The fix is in `os dev`, not in the config: it compiles the config into the
 * artifact in its own environment before the server starts
 * (`devCompilesAtBoot`), so both copies are one evaluation's answer.
 *
 * ## What this pins
 *
 * The same shape on a minimal host config: one provider-bound connector whose
 * `providerConfig.baseUrl` is built from `OS_PORT` the way the showcase's
 * `self-url.ts` builds it, a host plugin contributing that connector's
 * provider (its factory records the `providerConfig` it was handed, which is
 * what dispatch calls), and a `dist/objectstack.json` standing for a build
 * whose environment had no `OS_PORT`.
 *
 * ## #26243 — the port flag is the port the config reads
 *
 * `os dev -p N` and `os serve --port N` handed the flag to the listener alone,
 * so a config reading `OS_PORT` saw the inherited value or none. Measured on
 * the showcase with no `OS_PORT`/`PORT`: `os dev -p 41302` and `os serve
 * --port 41303` both served `/api/v1/meta/connector/showcase_status_api` with
 * `http://127.0.0.1:3000`, and the self-ping flow answered `400 FLOW_FAILED …
 * fetch failed`. Both doors now export the flag's port as `OS_PORT`/`PORT`
 * (`portFlagEnv`) before anything evaluates the config.
 *
 * So the `os dev` boot here passes `-p N` over an inherited, stale `OS_PORT`
 * and the build-time artifact: the served `baseUrl` and the materialized one
 * must both read N, the port the boot is listening on. That one boot holds
 * both cards: before #26130's fix the served copy read the artifact's `:3000`,
 * and before #26243's both copies read the stale `OS_PORT`. The `os serve
 * --port N` boot, in production posture (no artifact door, so the config
 * module is the only copy), has no `OS_PORT` at all, and the materialized
 * `baseUrl` must read N.
 *
 * ## #26270 — a busy port's shift is the port the config reads
 *
 * `os dev` shifts off a busy port, but the shift happened in the `serve`
 * child after the parent's compile and the child's config load had both read
 * the requested port. Measured on the showcase with 41310 held: `os dev -p
 * 41310` served on 41311, `/api/v1/meta/connector/showcase_status_api` named
 * 41310 and the self-ping flow answered `400 FLOW_FAILED`. The `os dev` parent
 * now runs the child's walk before it compiles and exports the port it lands
 * on (`portFlagEnv`).
 *
 * So the third boot here holds a port for its whole life (`holdPort`), asks
 * `os dev -p` for it, and reads the shifted port out of the child's own
 * banner. The served and the materialized `baseUrl` must both name that port,
 * and a flow pinging the app through the connector (`fxp_ping`, the fixture's
 * `showcase_declarative_connector_ping`) must succeed there.
 *
 * ## Spawn shape
 *
 * `bin/run.js` with `NODE_ENV` unset, the shipped entry resolving commands from
 * `dist/` (`requireBuiltCli`), in its own process group (`dev` supervises a
 * `serve` grandchild). Each boot asks for a NON-ZERO port drawn with
 * `reservePort()` (the busy-port boot holds its own with `holdPort()`), because that number is the subject: the config must read
 * the port the flag names, before the boot, and a kernel-assigned `-p 0` read
 * back afterwards cannot be known to the config (the draw is ledgered in
 * `released-port-production-spawn.pin.test.ts`). A lost race on that draw is
 * reported as one (`portContentionError` / `portDriftError`), not as a
 * verdict. The boots run in `beforeAll` and every `it` reads what they
 * recorded.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  boundPortFromBanner,
  childEnv,
  E2E_AUTH_SECRET,
  E2E_SECRET_KEY,
  holdPort,
  portContentionError,
  portDriftError,
  probeThroughChild,
  requireBuiltCli,
  reservePort,
  RUN_JS_RESOLVES_FROM_DIST,
} from './helpers/serve-process.js';
import { linkSpec } from './helpers/define-stack-fixture.js';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
/** `bin/run.js` — the SHIPPED entrypoint. */
const CLI = resolve(HERE, '../bin/run.js');

/** The banner's tail — every row above it has printed. */
const READY = /Press Ctrl\+C to stop/;
const BOOT_TIMEOUT_MS = 180_000;

/** An `OS_PORT` the `os dev` boot inherits and its `-p` must override. */
const STALE_PORT = '41302';
const BUILD_URL = 'http://127.0.0.1:3000';
/** The self URL a config builds for `port`, the way `CONFIG_SOURCE` builds it. */
const selfUrlFor = (port: number | string) => `http://127.0.0.1:${port}`;
const CONNECTOR = 'fxp_self';
/** Where the fixture provider's factory records the `providerConfig` it was handed. */
const MATERIALIZED_FILE = 'materialized-provider-config.json';
/** The flow that pings the app through the connector, as the showcase's self-ping does. */
const PING_FLOW = 'fxp_ping';
/** The development dev-admin seed — the operator on this boot. */
const EMAIL = 'admin@objectos.ai';
const PASSWORD = 'admin123';

const MANIFEST = { id: 'com.example.fxp', namespace: 'fxp', version: '1.0.0', type: 'app', name: 'Fxp' };
/** One object: a host config with none boots no query engine (`shouldAutoRegisterObjectQL`). */
const OBJECTS = [{
  name: 'fxp_note',
  label: 'Note',
  pluralLabel: 'Notes',
  sharingModel: 'public_read_write',
  fields: { title: { type: 'text', label: 'Title' } },
}];

/** The connector as the config declares it, given the base URL its environment yields. */
const connector = (baseUrl: string) => ({
  name: CONNECTOR,
  label: 'Self',
  type: 'api',
  provider: 'fxp',
  providerConfig: { baseUrl },
  auth: { type: 'none' },
});

/**
 * The host config. Its `baseUrl` is read at module evaluation, the way
 * `examples/app-showcase/src/system/self-url.ts` reads it; its one plugin
 * contributes the `fxp` provider in `init()` (before the automation service
 * materializes in `start()`), and the factory writes what it was handed to
 * the project directory, the `serve` child's cwd. Its one action, `ping`,
 * dials `/api/v1/health` at that `baseUrl` and fails on anything but a 2xx,
 * so `PING_FLOW` succeeds only when the `baseUrl` is the app's own address.
 */
const CONFIG_SOURCE = `import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineStack } from '@objectstack/spec';

const selfUrl = \`http://127.0.0.1:\${process.env.OS_PORT?.trim() || '3000'}\`;

export default defineStack({
  manifest: ${JSON.stringify(MANIFEST)},
  objects: ${JSON.stringify(OBJECTS)},
  requires: ['automation'],
  connectors: [${JSON.stringify(connector('__SELF_URL__')).replace('"__SELF_URL__"', 'selfUrl')}],
  plugins: [{
    name: 'com.example.fxp.provider',
    version: '1.0.0',
    dependencies: ['com.objectstack.service-automation'],
    init: async (ctx: any) => {
      ctx.getService('automation').registerConnectorProvider('fxp', (c: any) => {
        writeFileSync(join(process.cwd(), '${MATERIALIZED_FILE}'), JSON.stringify(c.providerConfig));
        return {
          def: { name: c.name, label: c.label, type: c.type, actions: [{ key: 'ping', label: 'Ping' }] },
          handlers: {
            ping: async () => {
              const r = await fetch(\`\${c.providerConfig.baseUrl}/api/v1/health\`, { signal: AbortSignal.timeout(5000) });
              if (!r.ok) throw new Error(\`health answered \${r.status}\`);
              return { status: r.status };
            },
          },
        };
      });
    },
  }],
  flows: [{
    name: '${PING_FLOW}',
    label: 'Ping',
    type: 'autolaunched',
    status: 'active',
    nodes: [
      { id: 'start', type: 'start', label: 'Start' },
      { id: 'ping', type: 'connector_action', label: 'Ping', connectorConfig: { connectorId: '${CONNECTOR}', actionId: 'ping', input: {} } },
      { id: 'end', type: 'end', label: 'End' },
    ],
    edges: [
      { id: 'e1', source: 'start', target: 'ping' },
      { id: 'e2', source: 'ping', target: 'end' },
    ],
  }],
});
`;

interface Reading {
  /** The non-zero port the boot asked for, and bound. */
  port?: number;
  served?: unknown;
  materialized?: unknown;
  /** The status and body `POST /api/v1/automation/PING_FLOW/trigger` answered. */
  ping?: { status: number; body: unknown };
  error?: Error;
}

const groups: ChildProcess[] = [];
let dir: string;
let devReading: Reading = {};
let serveReading: Reading = {};
let shiftReading: Reading = {};

interface Live {
  child: ChildProcess;
  base: string;
  output: () => string;
}

/**
 * Boot `bin/run.js ARGS` asking for `port`, resolved once the banner tail shows
 * the child listening on exactly that port; or, with `shiftsOff` (the port is
 * held), on the port its banner names, which must be another one.
 */
function boot(
  what: string,
  args: string[],
  port: number,
  env: Record<string, string | undefined>,
  shiftsOff = false,
): Promise<Live> {
  return new Promise((resolveBoot, rejectBoot) => {
    const child = spawn(
      process.execPath,
      [CLI, ...args],
      {
        cwd: dir,
        // `childEnv`, never a bare `...process.env` — see its header. `NODE_ENV`
        // unset, so the built entry resolves its commands from `dist/`.
        env: childEnv({
          NO_COLOR: '1',
          OS_CLOUD_URL: 'off',
          OS_DISABLE_CONSOLE: '1',
          OS_SECRET_KEY: E2E_SECRET_KEY,
          OS_LOG_LEVEL: 'warn',
          OS_DATABASE_URL: undefined,
          OS_ARTIFACT_URL: undefined,
          OS_ARTIFACT_PATH: undefined,
          OS_MODE: undefined,
          NODE_ENV: undefined,
          OS_PORT: undefined,
          PORT: undefined,
          ...env,
        }),
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true,
      },
    );
    groups.push(child);
    let out = '';
    let settled = false;
    const settle = (verdict: Error | number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (verdict instanceof Error) rejectBoot(verdict);
      else resolveBoot({ child, base: `http://localhost:${verdict}`, output: () => out });
    };
    const timer = setTimeout(
      () => settle(new Error(`${what} never printed ${READY}\n--- output ---\n${out.slice(-4000)}`)),
      BOOT_TIMEOUT_MS,
    );
    const onData = (d: unknown) => {
      out += String(d);
      if (!READY.test(out)) return;
      if (shiftsOff) {
        const readback = boundPortFromBanner(out);
        settle(readback.state === 'bound' && readback.port !== port
          ? readback.port
          : new Error(`${what} held ${port} yet its banner reads ${JSON.stringify(readback)}\n--- output ---\n${out.slice(-4000)}`));
        return;
      }
      // A boot on another port than the drawn one lost the draw's race; say so.
      settle(portDriftError(out, what, port) ?? port);
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.on('exit', (code) =>
      settle(
        portContentionError(out, what, port)
          ?? new Error(`${what} exited ${String(code)} before ${READY}\n--- output ---\n${out.slice(-4000)}`),
      ),
    );
  });
}

async function stopGroup(child: ChildProcess): Promise<void> {
  if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((done) => {
    const give = setTimeout(() => {
      try { process.kill(-child.pid!, 'SIGKILL'); } catch { /* group already gone */ }
      done();
    }, 15_000);
    child.once('exit', () => { clearTimeout(give); done(); });
    try { process.kill(-child.pid!, 'SIGTERM'); } catch { clearTimeout(give); done(); }
  });
}

/** One exchange, attributed to the child if the transport fails. ⛔ No assertion inside it. */
function http(live: Live, method: string, path: string, token = '', body?: unknown) {
  return probeThroughChild(
    {
      child: live.child,
      transcript: () => `\n--- child output ---\n${live.output().slice(-4000)}`,
      label: 'dev-connector-env-parity',
      what: `${method} ${path}`,
    },
    async () => {
      const r = await fetch(`${live.base}${path}`, {
        method,
        headers: {
          origin: live.base,
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      const text = await r.text();
      let parsed: any = text;
      try { parsed = JSON.parse(text); } catch { /* keep the text */ }
      return { status: r.status, body: parsed };
    },
  );
}

/** The `baseUrl` a `/meta/connector/NAME` answer carries, whichever envelope it comes in. */
function servedBaseUrl(body: any): unknown {
  const item = body?.data?.item ?? body?.item ?? body?.data ?? body;
  return item?.providerConfig?.baseUrl;
}

beforeAll(async () => {
  requireBuiltCli(RUN_JS_RESOLVES_FROM_DIST);
  dir = mkdtempSync(join(tmpdir(), 'os-26130-dev-'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'fxp-host', private: true }), 'utf8');
  writeFileSync(join(dir, 'objectstack.config.ts'), CONFIG_SOURCE, 'utf8');
  linkSpec(dir);
  // The artifact a build with no `OS_PORT` in its environment left behind.
  mkdirSync(join(dir, 'dist'), { recursive: true });
  writeFileSync(
    join(dir, 'dist', 'objectstack.json'),
    JSON.stringify({ manifest: MANIFEST, objects: OBJECTS, requires: ['automation'], connectors: [connector(BUILD_URL)] }, null, 2),
    'utf8',
  );

  const materializedPath = join(dir, MATERIALIZED_FILE);
  /** What the fxp provider's factory was handed on this boot, or why there is nothing. */
  const materialized = (live: Live): unknown => existsSync(materializedPath)
    ? (JSON.parse(readFileSync(materializedPath, 'utf8')) as { baseUrl?: unknown }).baseUrl
    : `(the fxp provider never materialized ${CONNECTOR})\n--- output ---\n${live.output().slice(-3000)}`;

  // `os serve --port N`, production posture, no `OS_PORT`: the config module is
  // the only copy, and materialization reads it at boot.
  let live: Live | undefined;
  try {
    const port = reservePort();
    live = await boot(
      'os serve --port',
      ['serve', 'objectstack.config.ts', '--port', String(port)],
      port,
      { OS_AUTH_SECRET: E2E_AUTH_SECRET, OS_DATABASE_URL: 'file:serve.db' },
    );
    serveReading = { port, materialized: materialized(live) };
  } catch (error) {
    serveReading = { error: error instanceof Error ? error : new Error(String(error)) };
  } finally {
    if (live) await stopGroup(live.child);
    live = undefined;
    rmSync(materializedPath, { force: true });
  }

  // `os dev -p N` over a stale inherited `OS_PORT` and the build-time artifact.
  try {
    const port = reservePort();
    live = await boot(
      'os dev -p',
      ['dev', '--no-watch', '--no-restart', '-d', 'file:dev.db', '-p', String(port)],
      port,
      { OS_PORT: STALE_PORT },
    );
    const signIn = await http(live, 'POST', '/api/v1/auth/sign-in/email', '', { email: EMAIL, password: PASSWORD });
    const token = signIn.body?.token;
    if (signIn.status !== 200 || typeof token !== 'string') {
      throw new Error(`sign-in answered ${signIn.status}: ${JSON.stringify(signIn.body)}\n--- output ---\n${live.output().slice(-3000)}`);
    }
    const meta = await http(live, 'GET', `/api/v1/meta/connector/${CONNECTOR}`, token);
    if (meta.status !== 200) {
      throw new Error(`GET /api/v1/meta/connector/${CONNECTOR} answered ${meta.status}: ${JSON.stringify(meta.body)}`);
    }
    devReading = { port, served: servedBaseUrl(meta.body), materialized: materialized(live) };
  } catch (error) {
    devReading = { error: error instanceof Error ? error : new Error(String(error)) };
  } finally {
    if (live) await stopGroup(live.child);
    live = undefined;
    rmSync(materializedPath, { force: true });
  }

  // `os dev -p N` with N held for the whole boot: the server shifts off it.
  const held = await holdPort();
  try {
    live = await boot(
      'os dev -p (held)',
      ['dev', '--no-watch', '--no-restart', '-d', 'file:shift.db', '-p', String(held.port)],
      held.port,
      {},
      true,
    );
    const port = Number(new URL(live.base).port);
    const signIn = await http(live, 'POST', '/api/v1/auth/sign-in/email', '', { email: EMAIL, password: PASSWORD });
    const token = signIn.body?.token;
    if (signIn.status !== 200 || typeof token !== 'string') {
      throw new Error(`sign-in answered ${signIn.status}: ${JSON.stringify(signIn.body)}\n--- output ---\n${live.output().slice(-3000)}`);
    }
    const meta = await http(live, 'GET', `/api/v1/meta/connector/${CONNECTOR}`, token);
    if (meta.status !== 200) {
      throw new Error(`GET /api/v1/meta/connector/${CONNECTOR} answered ${meta.status}: ${JSON.stringify(meta.body)}`);
    }
    const ping = await http(live, 'POST', `/api/v1/automation/${PING_FLOW}/trigger`, token, {});
    shiftReading = { port, served: servedBaseUrl(meta.body), materialized: materialized(live), ping };
  } catch (error) {
    shiftReading = { error: error instanceof Error ? error : new Error(String(error)) };
  } finally {
    if (live) await stopGroup(live.child);
    await held.release();
  }
}, 3 * BOOT_TIMEOUT_MS + 60_000);

afterAll(async () => {
  for (const child of groups) await stopGroup(child);
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}, 60_000);

function recorded(reading: Reading): Required<Omit<Reading, 'error'>> {
  if (reading.error) throw reading.error;
  return reading as Required<Omit<Reading, 'error'>>;
}

describe('#26130 + #26243 — `os dev -p N` serves and dispatches the connector baseUrl on N', () => {
  it('dispatch materializes the connector on the flag\'s port, not the inherited OS_PORT', () => {
    const { port, materialized } = recorded(devReading);
    expect(materialized).toBe(selfUrlFor(port));
  });

  it('/api/v1/meta/connector/NAME serves that same baseUrl, not the build-time one', () => {
    const { port, served } = recorded(devReading);
    expect(served).toBe(selfUrlFor(port));
  });
});

describe('#26243 — `os serve --port N` with no OS_PORT', () => {
  it('dispatch materializes the connector on the flag\'s port, not the 3000 default', () => {
    const { port, materialized } = recorded(serveReading);
    expect(materialized).toBe(selfUrlFor(port));
  });
});

describe('#26270 — `os dev -p N` with N held serves, dispatches and pings on the port it shifted to', () => {
  it('dispatch materializes the connector on the bound port, not the held one', () => {
    const { port, materialized } = recorded(shiftReading);
    expect(materialized).toBe(selfUrlFor(port));
  });

  it('/api/v1/meta/connector/NAME serves that same baseUrl', () => {
    const { port, served } = recorded(shiftReading);
    expect(served).toBe(selfUrlFor(port));
  });

  it('a flow pinging the app through the connector succeeds', () => {
    const { ping } = recorded(shiftReading);
    expect(ping.status, JSON.stringify(ping.body)).toBe(200);
  });
});
