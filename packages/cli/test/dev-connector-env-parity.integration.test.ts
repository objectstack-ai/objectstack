// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
// test-budget: 30 — spawns the real producer once per single-cause fixture: four boots of the built CLI, one per dev-door compile decision (`os dev`, `os dev --no-compile`, `os serve --dev`, production `os serve`), each over a freshly written build-time artifact; 19.7 s locally on a shared container, x 1.25, no CI reading yet

/**
 * #26130, #26242 — on a development boot, a connector value the config reads
 * from the environment is the same in the served metadata and in what dispatch
 * calls, on both dev doors (`os dev` and a direct `os serve --dev`).
 *
 * ## The defect, measured at the public door before the fix
 *
 * A host config's dev boot holds two copies of one stack: the config MODULE
 * the serving process evaluates (the AppPlugin wrap; provider-bound connectors
 * are materialized from its registry copy, so it is what dispatch calls) and
 * the compiled artifact (the dev artifact door; its copy is what
 * `/api/v1/meta/connector/NAME` serves). `examples/app-showcase` builds its
 * connectors' `baseUrl` from `OS_PORT` at module evaluation, and both dev doors
 * booted whatever `dist/objectstack.json` already held. Measured on the
 * showcase with `OS_PORT=41302` over an artifact built without it:
 *
 *   | reader                                               | before          | after           |
 *   |------------------------------------------------------|-----------------|-----------------|
 *   | `GET /api/v1/meta/connector/showcase_status_api`     | `…:3000`        | `…:41302`       |
 *   | the materialized connector (`connector_action`)      | `…:41302`       | `…:41302`       |
 *
 * The fix is in the boot, not in the config: it compiles the config into the
 * artifact in its own environment before the door serves it
 * (`devCompilesAtBoot`, one decision both doors read), so both copies are one
 * evaluation's answer. `os dev` compiles before it spawns its `serve` child
 * (#26130); a direct `os serve --dev` compiles before it composes the door
 * (#26242).
 *
 * ## What this pins
 *
 * The same shape on a minimal host config: one provider-bound connector whose
 * `providerConfig.baseUrl` is built from `OS_PORT` the way the showcase's
 * `self-url.ts` builds it, a host plugin contributing that connector's
 * provider (its factory records the `providerConfig` it was handed, which is
 * what dispatch calls), and a `dist/objectstack.json` standing for a build
 * whose environment had no `OS_PORT`, written afresh before each boot. One
 * boot per leg with `OS_PORT` set:
 *
 * - `os dev` and `os serve --dev`: the served `baseUrl` and the materialized
 *   one both read that port.
 * - `os dev --no-compile`: the served one still reads the build-time port.
 *   The `serve` child reads its supervisor's decision and never compiles on
 *   its own, so the old shortcut stays the operator's to choose.
 * - `os serve` (production): it composes no artifact door and compiles
 *   nothing, so dispatch reads the module's copy as before and the artifact's
 *   bytes stay as built. (Its `/meta` answer, the module's copy, was measured
 *   on the showcase; this leg does not sign in, see `Leg.readsMeta`.)
 *
 * ## Spawn shape
 *
 * `bin/run.js` with `NODE_ENV` unset, the shipped entry resolving commands from
 * `dist/` (`requireBuiltCli`), in its own process group (`dev` supervises a
 * `serve` grandchild). The listen port is kernel-assigned (`-p 0`); `OS_PORT`
 * is only the value the config reads, exactly as an isolated-port boot hands it
 * to a config. The boots run in `beforeAll`, one after another, and every `it`
 * reads what its leg recorded.
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
 * the project directory, the `serve` child's cwd.
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
        return { def: { name: c.name, label: c.label, type: c.type, actions: [] }, handlers: {} };
      });
    },
  }],
});
`;

/** The production leg's auth secret: a production boot refuses to compose auth without one. */
const PRODUCTION_AUTH_SECRET = 'f'.repeat(64);

interface Leg {
  /** The command, as the `it` titles name it. */
  label: string;
  argv: string[];
  env?: Record<string, string>;
  /**
   * Whether the leg reads `/meta`. A production boot seeds no dev admin, and on
   * a kernel-assigned port its auth trusts no origin the harness can send
   * (the auth base URL names the requested port, `0`), so that leg reads only
   * what dispatch materialized and the artifact's bytes.
   */
  readsMeta: boolean;
}

const LEGS = {
  dev: {
    label: 'os dev',
    argv: ['dev', '--no-watch', '--no-restart', '-d', 'file:dev.db', '-p', KERNEL_ASSIGNED_PORT],
    readsMeta: true,
  },
  devNoCompile: {
    label: 'os dev --no-compile',
    argv: ['dev', '--no-compile', '--no-watch', '--no-restart', '-d', 'file:dev-no-compile.db', '-p', KERNEL_ASSIGNED_PORT],
    readsMeta: true,
  },
  serveDev: {
    label: 'os serve --dev',
    argv: ['serve', 'objectstack.config.ts', '--dev', '-p', KERNEL_ASSIGNED_PORT],
    env: { OS_DATABASE_URL: 'file:serve-dev.db' },
    readsMeta: true,
  },
  serve: {
    label: 'os serve',
    argv: ['serve', 'objectstack.config.ts', '-p', KERNEL_ASSIGNED_PORT],
    env: { OS_DATABASE_URL: 'file:serve.db', OS_AUTH_SECRET: PRODUCTION_AUTH_SECRET },
    readsMeta: false,
  },
} satisfies Record<string, Leg>;

interface Reading {
  served?: unknown;
  materialized?: unknown;
  /** The artifact's bytes after the boot, beside the bytes written before it. */
  artifactUntouched?: boolean;
  error?: Error;
}

const groups: ChildProcess[] = [];
let dir: string;
const readings: Partial<Record<keyof typeof LEGS, Reading>> = {};

interface Live {
  child: ChildProcess;
  base: string;
  output: () => string;
}

function boot(leg: Leg): Promise<Live> {
  return new Promise((resolveBoot, rejectBoot) => {
    const child = spawn(
      process.execPath,
      [CLI, ...leg.argv],
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
          OS_PORT: LIVE_PORT,
          ...leg.env,
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
      () => settle(new Error(`${leg.label} never printed ${READY}\n--- output ---\n${out.slice(-4000)}`)),
      BOOT_TIMEOUT_MS,
    );
    const onData = (d: unknown) => {
      out += String(d);
      // The child is the authority on the port it bound: a kernel-assigned one (#24342).
      if (READY.test(out)) settle(readKernelAssignedPort(out, leg.label));
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.on('exit', (code) =>
      settle(new Error(`${leg.label} exited ${String(code)} before ${READY}\n--- output ---\n${out.slice(-4000)}`)),
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

/** The artifact a build with no `OS_PORT` in its environment left behind. */
const BUILT_ARTIFACT = JSON.stringify(
  { manifest: MANIFEST, objects: OBJECTS, requires: ['automation'], connectors: [connector(BUILD_URL)] },
  null,
  2,
);

async function read(leg: Leg): Promise<Reading> {
  writeFileSync(join(dir, 'dist', 'objectstack.json'), BUILT_ARTIFACT, 'utf8');
  const materializedPath = join(dir, MATERIALIZED_FILE);
  rmSync(materializedPath, { force: true });
  let live: Live | undefined;
  try {
    live = await boot(leg);
    let served: unknown = '(this leg does not read /meta)';
    if (leg.readsMeta) {
      const signIn = await http(live, 'POST', '/api/v1/auth/sign-in/email', '', { email: EMAIL, password: PASSWORD });
      const token = signIn.body?.token;
      if (signIn.status !== 200 || typeof token !== 'string') {
        throw new Error(`${leg.label}: sign-in answered ${signIn.status}: ${JSON.stringify(signIn.body)}\n--- output ---\n${live.output().slice(-3000)}`);
      }
      const meta = await http(live, 'GET', `/api/v1/meta/connector/${CONNECTOR}`, token);
      if (meta.status !== 200) {
        throw new Error(`${leg.label}: GET /api/v1/meta/connector/${CONNECTOR} answered ${meta.status}: ${JSON.stringify(meta.body)}`);
      }
      served = servedBaseUrl(meta.body);
    }
    return {
      served,
      materialized: existsSync(materializedPath)
        ? (JSON.parse(readFileSync(materializedPath, 'utf8')) as { baseUrl?: unknown }).baseUrl
        : `(the fxp provider never materialized ${CONNECTOR})\n--- output ---\n${live.output().slice(-3000)}`,
      artifactUntouched: readFileSync(join(dir, 'dist', 'objectstack.json'), 'utf8') === BUILT_ARTIFACT,
    };
  } catch (error) {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  } finally {
    if (live) await stopGroup(live.child);
  }
}

beforeAll(async () => {
  requireBuiltCli(RUN_JS_RESOLVES_FROM_DIST);
  dir = mkdtempSync(join(tmpdir(), 'os-26130-dev-'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'fxp-host', private: true }), 'utf8');
  writeFileSync(join(dir, 'objectstack.config.ts'), CONFIG_SOURCE, 'utf8');
  linkSpec(dir);
  mkdirSync(join(dir, 'dist'), { recursive: true });
  for (const key of Object.keys(LEGS) as (keyof typeof LEGS)[]) readings[key] = await read(LEGS[key]);
}, 4 * (BOOT_TIMEOUT_MS + 30_000));

afterAll(async () => {
  for (const child of groups) await stopGroup(child);
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
}, 60_000);

function recorded(key: keyof typeof LEGS): Required<Omit<Reading, 'error'>> {
  const reading = readings[key];
  if (!reading) throw new Error(`${LEGS[key].label} never ran`);
  if (reading.error) throw reading.error;
  return reading as Required<Omit<Reading, 'error'>>;
}

describe('#26130 — `os dev` with OS_PORT serves the connector baseUrl dispatch uses', () => {
  it('dispatch materializes the connector on the boot environment\'s port (unchanged)', () => {
    expect(recorded('dev').materialized).toBe(LIVE_URL);
  });

  it('/api/v1/meta/connector/NAME serves that same baseUrl, not the build-time one', () => {
    expect(recorded('dev').served).toBe(LIVE_URL);
  });

  it('`--no-compile` keeps the old shortcut: the `serve` child does not compile on its own', () => {
    expect(recorded('devNoCompile').served).toBe(BUILD_URL);
    expect(recorded('devNoCompile').artifactUntouched).toBe(true);
    expect(recorded('devNoCompile').materialized).toBe(LIVE_URL);
  });
});

describe('#26242 — a direct `os serve --dev` with OS_PORT serves the connector baseUrl dispatch uses', () => {
  it('dispatch materializes the connector on the boot environment\'s port (unchanged)', () => {
    expect(recorded('serveDev').materialized).toBe(LIVE_URL);
  });

  it('/api/v1/meta/connector/NAME serves that same baseUrl, not the build-time one', () => {
    expect(recorded('serveDev').served).toBe(LIVE_URL);
  });

  it('production `os serve` is unchanged: dispatch on the module\'s baseUrl, and the artifact left as built', () => {
    expect(recorded('serve').materialized).toBe(LIVE_URL);
    expect(recorded('serve').artifactUntouched).toBe(true);
  });
});
