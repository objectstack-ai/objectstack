// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * `os mcp connect` against a stubbed control plane (#30889).
 *
 * The command runs for real: its credential and environment resolution (the
 * one `os deploy` uses), the real `cloud.json` under a redirected `$HOME`.
 * Two seams are replaced: `fetch` is the control plane, and the client runner
 * stands in for Claude Code's `claude`.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { SpawnSyncReturns } from 'node:child_process';
import { OBJECTSTACK_MCP_SERVER_NAME } from '@objectstack/mcp';

const {
  default: McpConnect,
  mcpClientRunner,
  environmentServerName,
  mcpUrlFromBase,
  claudeMcpAddLine,
} = await import('../src/commands/mcp/connect.js');
const { printMcpConnectHint } = await import('../src/commands/dev.js');

const CLOUD_PLANE = 'http://cloud.test';
const CLOUD_TOKEN = 'cloud_tok_30889';
const { AUTH_BASE_URL_ENV_NAMES } = await import('../src/commands/serve.js');
// The base-URL chain is cleared too: `os dev`'s banner resolves its origin through it.
const MANAGED_ENV = ['OS_CLOUD_URL', 'OS_CLOUD_API_KEY', 'OS_TOKEN', 'OS_ENVIRONMENT_ID', ...AUTH_BASE_URL_ENV_NAMES];

type Call = { url: string; method: string; auth: string | undefined };

interface PlaneOptions {
  environments?: Array<Record<string, unknown>>;
  /** The detail read's row, by environment id (default: hostname `<id>.example.test`, no slug). */
  detail?: (id: string) => Record<string, unknown> | null;
}

/** The control plane: the environment list and one environment's detail read. */
function stubPlane(options: PlaneOptions = {}): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: string, init: any = {}) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    calls.push({ url, method, auth: init?.headers?.Authorization });
    const answer = (data: unknown) => ({ ok: true, status: 200, statusText: 'OK', json: async () => ({ success: true, data }) }) as any;
    if (method === 'GET' && url === `${CLOUD_PLANE}/api/v1/cloud/environments`) {
      const environments = options.environments ?? [{ id: 'env_acme', display_name: 'Acme', status: 'active' }];
      return answer({ environments, total: environments.length });
    }
    const detail = url.match(/\/api\/v1\/cloud\/environments\/([^/]+)$/);
    if (method === 'GET' && detail) {
      const id = decodeURIComponent(detail[1]);
      const row = options.detail ? options.detail(id) : { id, hostname: `${id.replace(/_/g, '-')}.example.test` };
      if (row === null) {
        return { ok: false, status: 404, statusText: 'Not Found', json: async () => ({ success: false, error: { message: 'Environment not found' } }) } as any;
      }
      return answer({ environment: row });
    }
    return { ok: false, status: 404, statusText: 'Not Found', json: async () => ({ success: false, error: { message: `unexpected ${method} ${url}` } }) } as any;
  }));
  return calls;
}

/** Every file under a directory, with its content. */
async function snapshot(dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const entry of await readdir(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name);
    out[path] = await readFile(path, 'utf8');
  }
  return out;
}

describe('os mcp connect', () => {
  let home = '';
  let work = '';
  const previous: Record<string, string | undefined> = {};
  const prevCwd = process.cwd();
  let output: string[] = [];
  let runner: ReturnType<typeof vi.fn<(command: string, args: string[]) => SpawnSyncReturns<Buffer>>>;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'os-30889-mcp-home-'));
    work = await mkdtemp(join(tmpdir(), 'os-30889-mcp-work-'));
    await mkdir(join(home, '.objectstack'), { recursive: true });
    for (const key of ['HOME', 'USERPROFILE', ...MANAGED_ENV]) previous[key] = process.env[key];
    process.env.HOME = home;
    process.env.USERPROFILE = home;
    for (const key of MANAGED_ENV) delete process.env[key];
    await writeFile(join(home, '.objectstack', 'cloud.json'), JSON.stringify({ url: CLOUD_PLANE, token: CLOUD_TOKEN, createdAt: 'now' }));
    process.chdir(work);

    runner = vi.fn(() => ({ status: 0, signal: null, pid: 1, output: [], stdout: Buffer.from(''), stderr: Buffer.from('') }));
    vi.spyOn(mcpClientRunner, 'run').mockImplementation(runner);

    output = [];
    const record = (...args: unknown[]) => { output.push(args.map(String).join(' ').replace(/\u001b\[[0-9;]*m/g, '')); };
    vi.spyOn(console, 'log').mockImplementation(record);
    vi.spyOn(console, 'error').mockImplementation(record);
  });

  afterEach(async () => {
    process.chdir(prevCwd);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(home, { recursive: true, force: true });
    await rm(work, { recursive: true, force: true });
  });

  async function connect(argv: string[] = []): Promise<number | undefined> {
    try {
      await McpConnect.run(argv);
      return undefined;
    } catch (err: any) {
      const exit = err?.oclif?.exit ?? err?.exitCode;
      if (exit === undefined) throw err;
      return exit;
    }
  }

  const text = () => output.join('\n');

  it('--print: prints the only environment\'s MCP URL and its `claude mcp add` line, named for the environment, and runs nothing', async () => {
    const calls = stubPlane({
      detail: (id) => ({ id, slug: 'acme-prod', display_name: 'Acme', hostname: 'acme.example.test' }),
    });

    const exit = await connect(['--print']);

    expect(exit, text()).toBeUndefined();
    expect(text()).toContain("Connecting to Acme (env_acme), your organization's only environment");
    expect(text()).toContain('Endpoint  https://acme.example.test/api/v1/mcp');
    expect(text()).toContain('Connect   claude mcp add --transport http acme-prod https://acme.example.test/api/v1/mcp');
    expect(runner).not.toHaveBeenCalled();
    // The environment was read from the control plane the CLI is logged in to, with that login.
    expect(calls.map((c) => c.url)).toEqual([
      `${CLOUD_PLANE}/api/v1/cloud/environments`,
      `${CLOUD_PLANE}/api/v1/cloud/environments/env_acme`,
    ]);
  });

  it('--url http://localhost:3000: prints the local server, named and spelled as `os dev`\'s banner prints it, with no control plane', async () => {
    const calls = stubPlane();

    const exit = await connect(['--url', 'http://localhost:3000', '--print']);

    expect(exit, text()).toBeUndefined();
    const line = `claude mcp add --transport http ${OBJECTSTACK_MCP_SERVER_NAME} http://localhost:3000/api/v1/mcp`;
    expect(text()).toContain(`Connect   ${line}`);
    expect(calls).toEqual([]);

    // One spelling: `os dev`'s Connect row for the same origin is this exact line.
    output = [];
    printMcpConnectHint({ boundPort: 3000 });
    expect(text()).toContain(`Connect   ${line}`);
  });

  it('several environments and no --env: refuses non-zero, as `os deploy` does, and registers nothing', async () => {
    const calls = stubPlane({
      environments: [
        { id: 'env_a', display_name: 'Alpha', status: 'active' },
        { id: 'env_b', display_name: 'Beta', status: 'active' },
      ],
    });

    const exit = await connect();

    expect(exit).toBe(1);
    expect(text()).toContain('`os mcp connect` needs an environment to connect to, and your account can reach 2');
    expect(text()).toContain('Alpha (env_a)');
    expect(text()).toContain('Pass `--env <id>`');
    expect(runner).not.toHaveBeenCalled();
    expect(calls.some((c) => /environments\/env_/.test(c.url))).toBe(false);
  });

  it('runs `claude mcp add` with the URL alone: no token reaches the client, and the command writes no file', async () => {
    stubPlane({ detail: (id) => ({ id, slug: 'acme', hostname: 'acme.example.test' }) });
    const homeBefore = await snapshot(home);
    const workBefore = await snapshot(work);

    const exit = await connect();

    expect(exit, text()).toBeUndefined();
    expect(runner).toHaveBeenCalledTimes(1);
    const [command, args] = runner.mock.calls[0];
    expect(command).toBe('claude');
    expect(args).toEqual(['mcp', 'add', '--transport', 'http', 'acme', 'https://acme.example.test/api/v1/mcp']);
    expect(args.join(' ')).not.toContain(CLOUD_TOKEN);
    expect(args.some((a) => /header|bearer|authorization|token/i.test(a))).toBe(false);
    expect(text()).not.toContain(CLOUD_TOKEN);
    expect(await snapshot(home)).toEqual(homeBefore);
    expect(await snapshot(work)).toEqual(workBefore);
    expect(text()).toContain('Registered acme with Claude Code.');
    expect(text()).toContain('Account → Connect an AI Assistant');
    expect(text()).toContain('not through MCP');
  });

  it('--env picks the environment, and the detail read names it', async () => {
    const calls = stubPlane({
      environments: [
        { id: 'env_a', display_name: 'Alpha', status: 'active' },
        { id: 'env_b', display_name: 'Beta', status: 'active' },
      ],
      detail: (id) => ({ id, display_name: 'Beta Staging', hostname: 'beta.example.test' }),
    });

    const exit = await connect(['--env', 'env_b', '--print']);

    expect(exit, text()).toBeUndefined();
    expect(text()).toContain('Connecting to Beta Staging (env_b)');
    expect(text()).toContain('claude mcp add --transport http beta-staging https://beta.example.test/api/v1/mcp');
    expect(calls.map((c) => c.url)).toEqual([`${CLOUD_PLANE}/api/v1/cloud/environments/env_b`]);
  });

  it('an environment with no hostname, or an unreadable one, is refused with nothing registered', async () => {
    stubPlane({ detail: (id) => ({ id, slug: 'acme' }) });
    expect(await connect()).toBe(1);
    expect(text()).toContain('reports no hostname for Acme (env_acme)');
    expect(runner).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
    output = [];
    stubPlane({ detail: () => null });
    expect(await connect()).toBe(1);
    expect(text()).toContain("Acme (env_acme)'s address could not be read from http://cloud.test (404): Environment not found");
    expect(runner).not.toHaveBeenCalled();
  });

  it('not logged in: refuses, naming `os cloud login` and `--url`', async () => {
    await rm(join(home, '.objectstack', 'cloud.json'));
    const calls = stubPlane();

    expect(await connect()).toBe(1);
    expect(text()).toContain('Run `os cloud login` first');
    expect(calls).toEqual([]);
  });

  it('Claude Code not installed: exits non-zero and leaves the line to paste', async () => {
    stubPlane({ detail: (id) => ({ id, slug: 'acme', hostname: 'acme.example.test' }) });
    runner.mockImplementation(() => ({ error: Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' }) }) as any);

    expect(await connect()).toBe(1);
    expect(text()).toContain('Connect   claude mcp add --transport http acme https://acme.example.test/api/v1/mcp');
    expect(text()).toContain('`claude` command was not found on your PATH');
  });

  it('`claude mcp add` failing passes its exit code through', async () => {
    stubPlane({ detail: (id) => ({ id, slug: 'acme', hostname: 'acme.example.test' }) });
    runner.mockImplementation(() => ({ status: 3, signal: null }) as any);

    expect(await connect()).toBe(3);
    expect(text()).toContain('claude mcp remove acme');
  });

  it('--name overrides the name, and a name a client would refuse is refused first', async () => {
    stubPlane();
    expect(await connect(['--url', 'https://os.example.test', '--name', 'crm_local', '--print'])).toBeUndefined();
    expect(text()).toContain('claude mcp add --transport http crm_local https://os.example.test/api/v1/mcp');

    output = [];
    expect(await connect(['--url', 'https://os.example.test', '--name', 'my server'])).toBe(1);
    expect(text()).toContain('is not a server name');
    expect(runner).not.toHaveBeenCalled();
  });
});

describe('environmentServerName', () => {
  it('takes the slug, then the display name, then the id, made safe for a server name', () => {
    expect(environmentServerName({ id: 'env_1', slug: 'acme-prod', displayName: 'Acme' })).toBe('acme-prod');
    expect(environmentServerName({ id: 'env_1', displayName: 'Acme Production (EU)' })).toBe('acme-production-eu');
    // A display name with no Latin letters leaves nothing, so the id names it.
    expect(environmentServerName({ id: 'env_1', displayName: '生产环境' })).toBe('env_1');
  });
});

describe('mcpUrlFromBase', () => {
  it('adds the MCP path to a base URL, keeping a path prefix', () => {
    expect(mcpUrlFromBase('http://localhost:3000/')).toEqual({ ok: true, mcpUrl: 'http://localhost:3000/api/v1/mcp' });
    expect(mcpUrlFromBase('https://example.test/os')).toEqual({ ok: true, mcpUrl: 'https://example.test/os/api/v1/mcp' });
  });

  it('refuses the MCP URL itself, a non-http URL, and a query, rather than guessing', () => {
    const doubled = mcpUrlFromBase('http://localhost:3000/api/v1/mcp');
    expect(doubled.ok).toBe(false);
    expect(!doubled.ok && doubled.reason).toContain('Pass http://localhost:3000.');
    expect(mcpUrlFromBase('ftp://example.test').ok).toBe(false);
    expect(mcpUrlFromBase('http://example.test/?a=1').ok).toBe(false);
    expect(mcpUrlFromBase('not a url').ok).toBe(false);
  });

  it('the line builder is the one `os dev` prints', () => {
    expect(claudeMcpAddLine('objectstack', 'http://localhost:3000/api/v1/mcp')).toBe(
      'claude mcp add --transport http objectstack http://localhost:3000/api/v1/mcp',
    );
  });
});
