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
 * whose environment had no `OS_PORT`. One `os dev` boot with `OS_PORT` set;
 * the served `baseUrl` and the materialized one must both read that port.
 *
 * ## Spawn shape
 *
 * `bin/run.js` with `NODE_ENV` unset, the shipped entry resolving commands from
 * `dist/` (`requireBuiltCli`), in its own process group (`dev` supervises a
 * `serve` grandchild). The listen port is kernel-assigned (`-p 0`), which the
 * flag gives the child; `OS_PORT` is only the value the config reads, exactly
 * as an isolated-port boot hands it to a config. The boot runs in `beforeAll`
 * and every `it` reads what it recorded.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  childEnv,
  E2E_SECRET_KEY,
  KERNEL_ASSIGNED_PORT,
  probeThroughChild,
  readKernelAssignedPort,
  requireBuiltCli,
  RUN_JS_RESOLVES_FROM_DIST,
} from './helpers/serve-process.js';
import { linkSpec } from './helpers/define-stack-fixture.js';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
/** `bin/run.js` — the SHIPPED entrypoint. */
const CLI = resolve(HERE, '../bin/run.js');

/** The banner's tail — every row above it has printed. */
const READY = /Press Ctrl\+C to stop/;
const BOOT_TIMEOUT_MS = 180_000;

/** The port the boot's environment names, other than the 3000 default. */
const LIVE_PORT = '41302';
const LIVE_URL = `http://127.0.0.1:${LIVE_PORT}`;
const BUILD_URL = 'http://127.0.0.1:3000';
const CONNECTOR = 'fxp_self';
/** Where the fixture provider's factory records the `providerConfig` it was handed. */
const MATERIALIZED_FILE = 'materialized-provider-config.json';
/** The development dev-admin seed — the operator on this boot. */
const EMAIL = 'admin@objectos.ai';
const PASSWORD = 'admin123';

const MANIFEST = { id: 'com.example.fxp', namespace: 'fxp', version: '1.0.0', type: 'app', name: 'Fxp' };

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
 * the project directory, the `serve` child's cwd.
 */
const CONFIG_SOURCE = `import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineStack } from '@objectstack/spec';

const selfUrl = \`http://127.0.0.1:\${process.env.OS_PORT?.trim() || '3000'}\`;

export default defineStack({
  manifest: ${JSON.stringify(MANIFEST)},
  requires: ['automation'],
  connectors: [${JSON.stringify(connector('__SELF_URL__')).replace('"__SELF_URL__"', 'selfUrl')}],
  plugins: [{
    name: 'com.example.fxp.provider',
    version: '1.0.0',
    dependencies: ['com.objectstack.service-automation'],
    init: async (ctx: any) => {
      ctx.getService('automation').registerConnectorProvider('fxp', (c: any) => {
        writeFileSync(join(process.cwd(), '${MATERIALIZED_FILE}'), JSON.stringify(c.providerConfig));
        return { def: { name: c.name, label: c.label, type: c.type, actions: [] }, handlers: {} };
      });
    },
  }],
});
`;

interface Reading {
  served?: unknown;
  materialized?: unknown;
  error?: Error;
}

const groups: ChildProcess[] = [];
let dir: string;
let reading: Reading = {};

interface Live {
  child: ChildProcess;
  base: string;
  output: () => string;
}

function bootDev(env: Record<string, string | undefined>): Promise<Live> {
  return new Promise((resolveBoot, rejectBoot) => {
    const child = spawn(
      process.execPath,
      [CLI, 'dev', '--no-watch', '--no-restart', '-d', 'file:dev.db', '-p', KERNEL_ASSIGNED_PORT],
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
      () => settle(new Error(`os dev never printed ${READY}\n--- output ---\n${out.slice(-4000)}`)),
      BOOT_TIMEOUT_MS,
    );
    const onData = (d: unknown) => {
      out += String(d);
      // The child is the authority on the port it bound: a kernel-assigned one (#24342).
      if (READY.test(out)) settle(readKernelAssignedPort(out, 'os dev'));
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.on('exit', (code) =>
      settle(new Error(`os dev exited ${String(code)} before ${READY}\n--- output ---\n${out.slice(-4000)}`)),
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
    JSON.stringify({ manifest: MANIFEST, requires: ['automation'], connectors: [connector(BUILD_URL)] }, null, 2),
    'utf8',
  );

  let live: Live | undefined;
  try {
    live = await bootDev({ OS_PORT: LIVE_PORT });
    const signIn = await http(live, 'POST', '/api/v1/auth/sign-in/email', '', { email: EMAIL, password: PASSWORD });
    const token = signIn.body?.token;
    if (signIn.status !== 200 || typeof token !== 'string') {
      throw new Error(`sign-in answered ${signIn.status}: ${JSON.stringify(signIn.body)}\n--- output ---\n${live.output().slice(-3000)}`);
    }
    const meta = await http(live, 'GET', `/api/v1/meta/connector/${CONNECTOR}`, token);
    if (meta.status !== 200) {
      throw new Error(`GET /api/v1/meta/connector/${CONNECTOR} answered ${meta.status}: ${JSON.stringify(meta.body)}`);
    }
    const materializedPath = join(dir, MATERIALIZED_FILE);
    reading = {
      served: servedBaseUrl(meta.body),
      materialized: existsSync(materializedPath)
        ? (JSON.parse(readFileSync(materializedPath, 'utf8')) as { baseUrl?: unknown }).baseUrl
        : `(the fxp provider never materialized ${CONNECTOR})\n--- output ---\n${live.output().slice(-3000)}`,
    };
  } catch (error) {
    reading = { error: error instanceof Error ? error : new Error(String(error)) };
  } finally {
    if (live) await stopGroup(live.child);
  }
}, BOOT_TIMEOUT_MS + 60_000);

afterAll(async () => {
  for (const child of groups) await stopGroup(child);
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}, 60_000);

function recorded(): Required<Omit<Reading, 'error'>> {
  if (reading.error) throw reading.error;
  return reading as Required<Omit<Reading, 'error'>>;
}

describe('#26130 — `os dev` with OS_PORT serves the connector baseUrl dispatch uses', () => {
  it('dispatch materializes the connector on the boot environment\'s port (unchanged)', () => {
    expect(recorded().materialized).toBe(LIVE_URL);
  });

  it('/api/v1/meta/connector/NAME serves that same baseUrl, not the build-time one', () => {
    expect(recorded().served).toBe(LIVE_URL);
  });
});
