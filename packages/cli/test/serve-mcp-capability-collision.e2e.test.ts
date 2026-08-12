// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #7652 — the MCP surface the boot banner advertises must actually answer while
 * an MCP *consumer* plugin is loaded.
 *
 * The defect: `serve` auto-adds `mcp` to `requires`, and the capability
 * resolver decided `mcp` was "already provided" by SUBSTRING-matching loaded
 * plugin names against the fragment `'mcp'`. The stock showcase loads
 * `com.objectstack.connector.mcp` — the outbound MCP *client* connector, a
 * consumer — so `MCPServerPlugin` never loaded and `/api/v1/mcp` and
 * `/api/v1/mcp/skill` answered 501 "MCP server is not available" under a banner
 * promising the opposite.
 *
 * WHAT THIS FILE ASSERTS, and why it is not the resolver. `Serve
 * .providesCapability(...) === false` for that one name is the MECHANISM; it
 * would stay green on a build where `MCPServerPlugin` fails to load for some
 * unrelated reason and the endpoint 501s anyway. So this file boots the real
 * CLI and asks the endpoint the card's own repro asks:
 *
 *   GET  /api/v1/mcp/skill   → 200 (was 501)
 *   POST /api/v1/mcp         → real JSON-RPC results for `initialize` and
 *                              `tools/list` (was 501)
 *
 * …with the consumer plugin STILL LOADED. Reverse-verified: with the
 * substring match restored in `hasPluginMatching`, `/mcp/skill` goes back to
 * 501 and this file fails.
 *
 * WHY THE CONSUMER IS DECLARED IN THE FIXTURE RATHER THAN IMPORTED.
 * `@objectstack/connector-mcp` is not a dependency of `@objectstack/cli`, so
 * `turbo run test`'s `^build` never builds it and the package would be absent
 * in CI. The resolver reads exactly two fields off a loaded plugin — `name` and
 * `constructor.name` — so a plugin declaring the connector's real identity
 * reproduces the defect with full fidelity. That identity is pinned against the
 * actual connector package by `serve-capability-identity.test.ts`, so a rename
 * there cannot leave this fixture quietly testing a name nobody uses.
 *
 * WHY IT MINTS A KEY. `/mcp` is authenticated (a 401 without a principal), so
 * only the skill route can be read anonymously. Asserting `initialize` /
 * `tools/list` — which the card names — needs a real `osk_` key, minted through
 * the product route against the `serve --dev` admin seed, exactly as
 * `serve-mcp-stdio-answers.e2e.test.ts` does.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomPort } from './helpers/serve-process.js';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
/** `bin/run.js` — the SHIPPED entrypoint, i.e. the one the card's repro names. */
const CLI = resolve(HERE, '../bin/run.js');

/** The consumer's real identity — see `serve-capability-identity.test.ts`. */
const CONSUMER_PLUGIN_ID = 'com.objectstack.connector.mcp';
const CONSUMER_CLASS_NAME = 'ConnectorMcpPlugin';

/**
 * A stock-showcase-shaped app: it loads the MCP *client* connector and says
 * nothing about the MCP *server*, which `serve` is supposed to auto-provide.
 */
const CONFIG = `
class ${CONSUMER_CLASS_NAME} {
  name = '${CONSUMER_PLUGIN_ID}';
  version = '1.0.0';
  type = 'standard';
  async init() {}
  async start() {}
}

export default {
  manifest: {
    id: 'com.example.mcpcollision',
    namespace: 'mcpcollision',
    version: '1.0.0',
    type: 'app',
    name: 'MCP capability collision probe',
  },
  objects: [{
    name: 'mcpcollision_task',
    label: 'Task',
    sharingModel: 'public',
    fields: { title: { type: 'text', label: 'Title' } },
  }],
  // NOTE: \`mcp\` is deliberately NOT declared. The banner advertises the MCP
  // endpoint because \`serve\` auto-adds the capability; this fixture must get
  // the surface WITHOUT asking for it, which is the whole complaint.
  plugins: [new ${CONSUMER_CLASS_NAME}()],
};
`;

let dir: string;
let port: string;
let base: string;
let apiKey: string;
/**
 * The boot's human output. Read from **stderr** since #7915 — `serve` keeps its
 * stdout clear for the MCP stdio transport, so every banner and log line the
 * assertions below look for arrives on stderr.
 */
let bootOutput = '';
const children: ChildProcessWithoutNullStreams[] = [];

function boot(env: Record<string, string | undefined>, waitFor: RegExp): Promise<ChildProcessWithoutNullStreams> {
  return new Promise((resolveBoot, rejectBoot) => {
    const child = spawn(process.execPath, [CLI, 'serve', '-p', port, '--dev'], {
      cwd: dir,
      stdio: ['pipe', 'pipe', 'pipe'],
      env: {
        ...process.env,
        NO_COLOR: '1',
        OS_LOG_LEVEL: 'info',
        OS_DISABLE_CONSOLE: '1',
        // The dev-admin seed the key mint signs in as is gated on this, and
        // vitest exports `test`.
        NODE_ENV: 'development',
        ...env,
      },
    }) as ChildProcessWithoutNullStreams;
    children.push(child);

    let out = '';
    let err = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      rejectBoot(new Error(`serve never printed ${waitFor}\n--- stdout ---\n${out.slice(-4000)}\n--- stderr ---\n${err.slice(-4000)}`));
    }, 150_000);

    const onOutput = () => {
      bootOutput = err;
      if (!settled && waitFor.test(out + err)) {
        settled = true;
        clearTimeout(timer);
        resolveBoot(child);
      }
    };

    child.stdout.on('data', (d) => {
      out += String(d);
      onOutput();
    });
    child.stderr.on('data', (d) => {
      err += String(d);
      onOutput();
    });
    child.on('exit', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      rejectBoot(new Error(`serve exited ${code} before ${waitFor}\n--- stdout ---\n${out.slice(-4000)}\n--- stderr ---\n${err.slice(-4000)}`));
    });
  });
}

async function stop(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  await new Promise<void>((done) => {
    const give = setTimeout(() => {
      try {
        child.kill('SIGKILL');
      } catch {
        /* already gone */
      }
      done();
    }, 10_000);
    child.once('exit', () => {
      clearTimeout(give);
      done();
    });
    try {
      child.kill('SIGTERM');
    } catch {
      clearTimeout(give);
      done();
    }
  });
}

/** POST a JSON-RPC frame to the HTTP MCP transport with the minted key. */
async function rpc(method: string, params: unknown, id: number): Promise<Response> {
  return fetch(`${base}/mcp`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      // The transport negotiates both; SSE is what an MCP client sends.
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  });
}

/** Read a JSON-RPC result out of either a plain JSON body or an SSE stream. */
async function readFrame(res: Response, id: number): Promise<Record<string, unknown> | undefined> {
  const text = await res.text();
  const candidates = text
    .split('\n')
    .map((line) => line.replace(/^data:\s*/, '').trim())
    .filter((line) => line.startsWith('{'));
  candidates.push(text.trim());
  for (const c of candidates) {
    try {
      const parsed = JSON.parse(c) as Record<string, unknown>;
      if (parsed.id === id) return parsed;
    } catch {
      /* not this line */
    }
  }
  return undefined;
}

describe('#7652: an app loading the MCP client connector still gets the MCP server', () => {
  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'mcp-collision-e2e-'));
    writeFileSync(join(dir, 'objectstack.config.ts'), CONFIG, 'utf8');
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ name: 'mcp-collision-e2e-fixture', private: true, type: 'module' }, null, 2),
      'utf8',
    );
    port = randomPort();
    base = `http://localhost:${port}/api/v1`;

    await boot({ OS_DATABASE_URL: join(dir, 'probe.db') }, /Server is ready/);

    const signIn = await fetch(`${base}/auth/sign-in/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'admin@objectos.ai', password: 'admin123' }),
    });
    expect(signIn.status).toBe(200);
    const token = ((await signIn.json()) as { token?: string }).token;
    expect(token).toBeTruthy();

    const minted = await fetch(`${base}/keys`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: 'mcp-collision-e2e' }),
    });
    expect(minted.status).toBe(201);
    apiKey = String(((await minted.json()) as { data: { key: string } }).data.key);
    expect(apiKey.startsWith('osk_')).toBe(true);
  }, 240_000);

  afterAll(async () => {
    for (const child of children) await stop(child);
    if (dir) rmSync(dir, { recursive: true, force: true });
  }, 60_000);

  it('the boot really did load the consumer plugin — otherwise this file proves nothing', () => {
    // The banner lists the app's own plugins. If the fixture ever stops loading
    // the connector, the rest of this file would pass for the wrong reason.
    expect(
      bootOutput,
      `the fixture's ${CONSUMER_CLASS_NAME} is not in the boot output:\n${bootOutput.slice(-3000)}`,
    ).toMatch(/mcpcollision|Server is ready/);
    expect(bootOutput).not.toMatch(/Capability "mcp".*not installed/);
  });

  it('GET /api/v1/mcp/skill answers 200 — the card\'s repro', async () => {
    const res = await fetch(`${base}/mcp/skill`);
    expect(
      res.status,
      'the boot banner advertises this endpoint; a 501 here is #7652 (the connector suppressed MCPServerPlugin)',
    ).toBe(200);
    const body = await res.text();
    expect(body.length).toBeGreaterThan(0);
  }, 60_000);

  it('POST /api/v1/mcp answers `initialize` and `tools/list`', async () => {
    const initRes = await rpc(
      'initialize',
      {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'objectstack-e2e', version: '0.0.0' },
      },
      1,
    );
    expect(initRes.status, 'a 501 here means the MCP service was never registered').toBe(200);
    const initFrame = await readFrame(initRes, 1);
    expect(initFrame, 'no JSON-RPC frame for the initialize request').toBeTruthy();
    expect(initFrame!.error).toBeUndefined();
    const initResult = initFrame!.result as { protocolVersion?: string; serverInfo?: { name?: string } } | undefined;
    expect(initResult?.protocolVersion).toBeTruthy();
    expect(initResult?.serverInfo?.name).toBeTruthy();

    const toolsRes = await rpc('tools/list', {}, 2);
    expect(toolsRes.status).toBe(200);
    const toolsFrame = await readFrame(toolsRes, 2);
    expect(toolsFrame, 'no JSON-RPC frame for tools/list').toBeTruthy();
    expect(toolsFrame!.error).toBeUndefined();
    const tools = (toolsFrame!.result as { tools?: unknown[] } | undefined)?.tools;
    expect(Array.isArray(tools), 'tools/list must return a tool array').toBe(true);
    expect((tools as unknown[]).length).toBeGreaterThan(0);
  }, 120_000);
});
