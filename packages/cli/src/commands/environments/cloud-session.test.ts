// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Which stored session `os environments` authenticates with — the pins for
 * `createControlPlaneApiClient` (`utils/api-client.ts`).
 *
 * ## The defect these pins hold closed
 *
 * The documented hosted flow is `os cloud login`, then `os environments
 * create`. `os cloud login` stores its session in `~/.objectstack/cloud.json`;
 * the five `os environments` subcommands read only `credentials.json` (the
 * `os login` session), so with `cloud.json` alone every one of them exited 1
 * with "Authentication required" before sending a request — while
 * `os login --help` sends hosted users to `os cloud login`. The flow looped.
 *
 * ## The resolution, as ruled
 *
 * One resolver, shared by all five subcommands: `credentials.json`'s session
 * first where it targets the server this command talks to, then `cloud.json`'s.
 * So the pins come in three groups, and each one is measured over ALL FIVE
 * subcommands — a fix that reaches four of them reads like a fix:
 *
 *   1. only `cloud.json` — the cloud bearer goes to the cloud url;
 *   2. only `credentials.json` — the control: nothing about it moves;
 *   3. both — `credentials.json` wins where both name the same server, and
 *      `--url` naming `cloud.json`'s server selects the cloud session.
 *
 * Plus the guard on the other side of that ordering: a stored token never goes
 * to a server its file does not name, and the active environment `switch` /
 * `create` record lands only in the store whose server was talked to.
 *
 * ## Why a real local HTTP server, and `$HOME` redirected
 *
 * The commands run in-process through `Command.run`, against a `node:http`
 * echo control plane on 127.0.0.1 that records the method, path, bearer and
 * `X-Environment-Id` of every request. So the assertion is on what really
 * left the CLI — the `ObjectStackClient` on the real `fetch` — not on a stub
 * of it. Both credential stores build their paths from `os.homedir()`, which
 * reads `$HOME` (`%USERPROFILE%` on Windows), so redirecting both puts the
 * real readers and writers on a temp directory and never on the developer's
 * own `~/.objectstack`.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import EnvironmentsList from './list.js';
import EnvironmentsShow from './show.js';
import EnvironmentsCreate from './create.js';
import EnvironmentsBind from './bind.js';
import EnvironmentsSwitch from './switch.js';

/** One request as the echo control plane received it. */
interface Seen {
  method: string;
  path: string;
  authorization: string | null;
  environmentId: string | null;
}

interface Echo {
  url: string;
  seen: Seen[];
  close(): Promise<void>;
}

/** A minimal control plane answering the five subcommands' routes with success. */
async function startEcho(): Promise<Echo> {
  const seen: Seen[] = [];
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    req.resume();
    req.on('end', () => {
      const path = (req.url ?? '').split('?')[0];
      seen.push({
        method: req.method ?? '',
        path,
        authorization: req.headers.authorization ?? null,
        environmentId: (req.headers['x-environment-id'] as string | undefined) ?? null,
      });
      let data: unknown;
      if (req.method === 'GET' && path === '/api/v1/cloud/environments') {
        data = { environments: [{ id: 'env_1', display_name: 'Dev' }], total: 1 };
      } else if (req.method === 'POST' && path === '/api/v1/cloud/environments') {
        data = { environment: { id: 'env_new', display_name: 'Dev' } };
      } else {
        data = { environment: { id: 'env_1', display_name: 'Dev', metadata: {} } };
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ success: true, data }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    seen,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

/** Env vars that feed a flag or the resolver — cleared for every case. */
const MANAGED_ENV = ['OS_CLOUD_URL', 'OS_TOKEN', 'OS_ENVIRONMENT_ID'] as const;

let cloudPlane: Echo;
let runtimePlane: Echo;
let home = '';
let artifactPath = '';
const previous: Record<string, string | undefined> = {};

beforeAll(async () => {
  cloudPlane = await startEcho();
  runtimePlane = await startEcho();
});

afterAll(async () => {
  await cloudPlane.close();
  await runtimePlane.close();
});

beforeEach(async () => {
  cloudPlane.seen.length = 0;
  runtimePlane.seen.length = 0;
  home = await mkdtemp(join(tmpdir(), 'os-21360-home-'));
  await mkdir(join(home, '.objectstack'), { recursive: true });
  artifactPath = join(home, 'objectstack.json');
  await writeFile(artifactPath, JSON.stringify({ manifest: { id: 'com.acme.crm' }, objects: [] }));
  previous.HOME = process.env.HOME;
  previous.USERPROFILE = process.env.USERPROFILE;
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  for (const key of MANAGED_ENV) {
    previous[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(async () => {
  vi.restoreAllMocks();
  for (const key of ['HOME', 'USERPROFILE', ...MANAGED_ENV]) {
    if (previous[key] === undefined) delete process.env[key];
    else process.env[key] = previous[key];
  }
  if (home) await rm(home, { recursive: true, force: true });
});

const cloudJson = () => join(home, '.objectstack', 'cloud.json');
const credentialsJson = () => join(home, '.objectstack', 'credentials.json');

async function writeCloud(config: Record<string, unknown>): Promise<void> {
  await writeFile(cloudJson(), JSON.stringify({ createdAt: 'now', ...config }, null, 2));
}

async function writeCredentials(config: Record<string, unknown>): Promise<void> {
  await writeFile(credentialsJson(), JSON.stringify({ createdAt: 'now', ...config }, null, 2));
}

async function readStore(path: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path, 'utf8'));
}

/** The five subcommands, each with the arguments it needs to reach the server. */
const SUBCOMMANDS: ReadonlyArray<readonly [string, (extra: string[]) => Promise<unknown>]> = [
  ['list', (extra) => EnvironmentsList.run([...extra])],
  ['show', (extra) => EnvironmentsShow.run(['env_1', ...extra])],
  ['create', (extra) => EnvironmentsCreate.run(['--org', 'org_1', '--name', 'Dev', ...extra])],
  ['bind', (extra) => EnvironmentsBind.run(['env_1', '--artifact', artifactPath, ...extra])],
  ['switch', (extra) => EnvironmentsSwitch.run(['env_1', ...extra])],
];

interface Outcome {
  /** The oclif exit code a failing command threw, or `undefined` on success. */
  exit: number | undefined;
  /** Everything the command printed, both streams. */
  output: string;
}

/** Run one subcommand in-process, capturing its output and its exit. */
async function invoke(run: (extra: string[]) => Promise<unknown>, extra: string[] = []): Promise<Outcome> {
  const lines: string[] = [];
  const capture = (...args: unknown[]) => { lines.push(args.map(String).join(' ')); };
  vi.spyOn(console, 'log').mockImplementation(capture);
  vi.spyOn(console, 'error').mockImplementation(capture);
  let exit: number | undefined;
  try {
    await run(extra);
  } catch (error: any) {
    exit = typeof error?.oclif?.exit === 'number' ? error.oclif.exit : -1;
    lines.push(String(error?.message ?? error));
  } finally {
    vi.restoreAllMocks();
  }
  return { exit, output: lines.join('\n') };
}

/** Assert the command succeeded and every request it sent went to `plane` carrying `bearer`. */
function expectServedBy(name: string, outcome: Outcome, plane: Echo, other: Echo, bearer: string): void {
  expect(outcome.exit, `os environments ${name} failed:\n${outcome.output}`).toBeUndefined();
  expect(
    plane.seen.length,
    `os environments ${name} sent no request to the server it should have talked to -- a ` +
      'refusal before any request is exactly the defect, so every assertion below would be vacuous',
  ).toBeGreaterThan(0);
  expect(plane.seen.map((s) => s.authorization)).toEqual(plane.seen.map(() => `Bearer ${bearer}`));
  expect(other.seen, `os environments ${name} also talked to the other control plane`).toEqual([]);
}

describe('os environments: the stored session it authenticates with', () => {
  // ── 1. only cloud.json — the state right after `os cloud login` ──────────
  describe('with only cloud.json (the `os cloud login` session)', () => {
    it.each(SUBCOMMANDS)('%s sends the cloud bearer to the cloud url', async (name, run) => {
      await writeCloud({ url: cloudPlane.url, token: 'cloud_tok', activeEnvironmentId: 'env_cloud_active' });

      const outcome = await invoke(run);

      expectServedBy(name, outcome, cloudPlane, runtimePlane, 'cloud_tok');
      // The active environment travels with the session it was recorded on.
      expect(cloudPlane.seen[0].environmentId).toBe('env_cloud_active');
    });

    it.each(SUBCOMMANDS)(
      '%s never sends the cloud bearer to a --url cloud.json does not name',
      async (name, run) => {
        await writeCloud({ url: cloudPlane.url, token: 'cloud_tok' });

        const outcome = await invoke(run, ['--url', runtimePlane.url]);

        expect(outcome.exit, `os environments ${name} should have refused:\n${outcome.output}`).toBe(1);
        expect(runtimePlane.seen).toEqual([]);
        expect(cloudPlane.seen).toEqual([]);
      },
    );
  });

  // ── 2. only credentials.json — the control ───────────────────────────────
  describe('with only credentials.json (the `os login` session) — unchanged', () => {
    it.each(SUBCOMMANDS)('%s sends the runtime bearer to the runtime url', async (name, run) => {
      await writeCredentials({ url: runtimePlane.url, token: 'runtime_tok', activeEnvironmentId: 'env_runtime_active' });

      const outcome = await invoke(run);

      expectServedBy(name, outcome, runtimePlane, cloudPlane, 'runtime_tok');
      expect(runtimePlane.seen[0].environmentId).toBe('env_runtime_active');
    });

    it.each(SUBCOMMANDS)('%s sends the runtime bearer to an explicit --url, as before', async (name, run) => {
      await writeCredentials({ url: 'http://127.0.0.1:1', token: 'runtime_tok' });

      const outcome = await invoke(run, ['--url', runtimePlane.url]);

      expectServedBy(name, outcome, runtimePlane, cloudPlane, 'runtime_tok');
    });
  });

  // ── 3. both stores ───────────────────────────────────────────────────────
  describe('with both stores', () => {
    it.each(SUBCOMMANDS)('%s: credentials.json wins where both name the same server', async (name, run) => {
      await writeCloud({ url: cloudPlane.url, token: 'cloud_tok', activeEnvironmentId: 'env_from_cloud_json' });
      await writeCredentials({ url: cloudPlane.url, token: 'runtime_tok', activeEnvironmentId: 'env_from_credentials_json' });

      const outcome = await invoke(run);

      expectServedBy(name, outcome, cloudPlane, runtimePlane, 'runtime_tok');
      expect(cloudPlane.seen[0].environmentId).toBe('env_from_credentials_json');
    });

    it.each(SUBCOMMANDS)('%s: credentials.json wins where both name the --url server', async (name, run) => {
      await writeCloud({ url: cloudPlane.url, token: 'cloud_tok' });
      await writeCredentials({ url: cloudPlane.url, token: 'runtime_tok' });

      const outcome = await invoke(run, ['--url', cloudPlane.url]);

      expectServedBy(name, outcome, cloudPlane, runtimePlane, 'runtime_tok');
    });

    it.each(SUBCOMMANDS)('%s: with no --url, credentials.json still picks the server', async (name, run) => {
      await writeCloud({ url: cloudPlane.url, token: 'cloud_tok' });
      await writeCredentials({ url: runtimePlane.url, token: 'runtime_tok' });

      const outcome = await invoke(run);

      expectServedBy(name, outcome, runtimePlane, cloudPlane, 'runtime_tok');
    });

    it.each(SUBCOMMANDS)('%s: --url naming the server of cloud.json selects the cloud session', async (name, run) => {
      await writeCloud({ url: cloudPlane.url, token: 'cloud_tok', activeEnvironmentId: 'env_cloud_active' });
      await writeCredentials({ url: runtimePlane.url, token: 'runtime_tok', activeEnvironmentId: 'env_runtime_active' });

      const outcome = await invoke(run, ['--url', `${cloudPlane.url}/`]);

      expectServedBy(name, outcome, cloudPlane, runtimePlane, 'cloud_tok');
      expect(cloudPlane.seen[0].environmentId).toBe('env_cloud_active');
    });
  });

  // ── where the active environment is recorded ─────────────────────────────
  //
  // `switch` and `create --activate` record the id they activated. On the
  // cloud session the server talked to is cloud.json's, and credentials.json —
  // if it exists — names another server, where that id would not resolve.
  describe('the active environment lands only in the store whose server was talked to', () => {
    it.each([
      ['switch', (extra: string[]) => EnvironmentsSwitch.run(['env_1', ...extra]), 'env_1'],
      ['create', (extra: string[]) => EnvironmentsCreate.run(['--org', 'org_1', '--name', 'Dev', ...extra]), 'env_new'],
    ] as const)('%s on the cloud session leaves credentials.json alone', async (name, run, id) => {
      await writeCloud({ url: cloudPlane.url, token: 'cloud_tok' });
      await writeCredentials({ url: runtimePlane.url, token: 'runtime_tok', activeEnvironmentId: 'env_runtime_active' });

      const outcome = await invoke(run, ['--url', cloudPlane.url]);

      expectServedBy(name, outcome, cloudPlane, runtimePlane, 'cloud_tok');
      expect((await readStore(cloudJson())).activeEnvironmentId).toBe(id);
      expect(
        (await readStore(credentialsJson())).activeEnvironmentId,
        `os environments ${name} wrote an environment of cloud.json's server into credentials.json, ` +
          'whose server is a different one -- every `os data` / `os meta` call would then name it there',
      ).toBe('env_runtime_active');
    });

    it.each([
      ['switch', (extra: string[]) => EnvironmentsSwitch.run(['env_1', ...extra]), 'env_1'],
      ['create', (extra: string[]) => EnvironmentsCreate.run(['--org', 'org_1', '--name', 'Dev', ...extra]), 'env_new'],
    ] as const)('%s with only cloud.json records the id in cloud.json', async (name, run, id) => {
      await writeCloud({ url: cloudPlane.url, token: 'cloud_tok' });

      const outcome = await invoke(run);

      expectServedBy(name, outcome, cloudPlane, runtimePlane, 'cloud_tok');
      expect((await readStore(cloudJson())).activeEnvironmentId).toBe(id);
    });
  });

  // ── no session at all ────────────────────────────────────────────────────
  it.each(SUBCOMMANDS)('%s with no stored session names `os cloud login` in its refusal', async (name, run) => {
    const outcome = await invoke(run);

    expect(outcome.exit).toBe(1);
    expect(runtimePlane.seen).toEqual([]);
    expect(cloudPlane.seen).toEqual([]);
    expect(outcome.output, `os environments ${name}: the remedy must name the hosted login`).toContain('os cloud login');
  });
});
