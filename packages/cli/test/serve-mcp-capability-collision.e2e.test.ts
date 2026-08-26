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
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { E2E_SECRET_KEY, childEnv, randomPort } from './helpers/serve-process.js';

const HERE = resolve(fileURLToPath(import.meta.url), '..');
/**
 * `bin/run.js` through plain `node` — the SHIPPED entrypoint, and this file
 * genuinely reaches it (#11707).
 *
 * Both halves of that are load-bearing and neither works alone. @oclif/core
 * 4.13.3 skips its TypeScript path lookup only when `isProd()` —
 * `!['development', 'test'].includes(process.env.NODE_ENV ?? '')` — so under a
 * child `NODE_ENV` of `development` or `test` it rewrites the command target
 * from the declared `./dist/commands` to `./src/commands` and transpiles, and
 * `packages/cli/dist` goes unread whichever stub is named. This file used to
 * pin `NODE_ENV=development` on the child (#11317); the boot below leaves it
 * UNSET instead — the value that disables the reroute — and the `--dev` admin
 * seed survives that, for the reason spelled out at the `NODE_ENV` entry below.
 *
 * ⛔ Do not restore either half on its own. `bin/run-dev.js` assigns
 * `NODE_ENV = 'development'` before argv is parsed, so it reroutes
 * unconditionally; and re-pinning `NODE_ENV` on the child while naming
 * `bin/run.js` is the self-cancelling pair #11317 found here — it promises the
 * built artifact, delivers source, and says nothing.
 *
 * PRICE, stated because it is real. This file is now a verdict about BUILD
 * STATE as well as about the source in the checkout, which is the trade
 * `scripts/check-test-source-alias.mjs` argues against for in-process imports.
 * `turbo.json` declares `@objectstack/cli#test` `dependsOn: ["build"]` (#11268)
 * so CI always builds `dist/` first; `requireBuiltCli()` below is what a
 * developer running `vitest` directly gets instead of oclif's "command serve
 * not found". Neither catches a `dist/` that is merely BEHIND its source —
 * that residual is the honest cost of consuming the artifact, and
 * `serve-node-env-production-default.e2e.test.ts` (which has consumed `dist/`
 * since #11113) carries exactly the same one.
 */
const CLI = resolve(HERE, '../bin/run.js');

/**
 * Refuse to run against an unbuilt `packages/cli`, in a sentence rather than as
 * oclif's "command serve not found".
 *
 * The command target is read from the CLI's own `oclif.commands.target` rather
 * than restated here: that declaration is where `dist/commands` is decided, and
 * a copy keeps probing the old path after someone moves it — the argument
 * `scripts/cli-build-prerequisite.mjs` makes for the gates that shell out to
 * this CLI. Only that one declared shape is read; anything else (unreadable,
 * or `oclif.commands` written as a bare string) DEFERS rather than failing, so
 * a checkout this cannot understand never turns red here and the spawn's own
 * output stays the fallback — the same fail-open direction those gates take.
 */
function requireBuiltCli(): void {
  let target: unknown;
  try {
    target = JSON.parse(readFileSync(resolve(HERE, '../package.json'), 'utf8'))?.oclif?.commands?.target;
  } catch {
    return;
  }
  if (typeof target !== 'string' || !target) return;
  const commandFile = resolve(HERE, '..', target.replace(/^\.\//, ''), 'serve.js');
  if (existsSync(commandFile)) return;
  throw new Error(
    `packages/cli is not built: ${commandFile} does not exist.\n` +
      'This file spawns bin/run.js with NODE_ENV unset, which is what makes oclif resolve the ' +
      'command from dist/ instead of transpiling src/ — so on an unbuilt tree the child answers ' +
      '"command serve not found" and every boot below times out.\n' +
      'CI declares the build (turbo: @objectstack/cli#test dependsOn build); a direct vitest run does not.\n' +
      'Run: pnpm exec turbo run build --filter=@objectstack/cli',
  );
}

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
      // `childEnv`, not a bare `...process.env`: the vitest worker exports
      // `TEST=true`, which better-auth 1.7.1 reads directly and answers by
      // switching its own origin/CSRF validation OFF in the child — see
      // `helpers/serve-process.ts` for the measurement (#11267). This file
      // signs in for real, so it is a child that actually reaches that code.
      env: childEnv({
        NO_COLOR: '1',
        OS_LOG_LEVEL: 'info',
        OS_DISABLE_CONSOLE: '1',
        // Explicit, not minted — but NOT because of the `VITEST` strip above.
        // What follows is quoted in the PAST TENSE on purpose: the code it
        // quotes is GONE. `detectMode` used to read
        // `if (env.VITEST || env.NODE_ENV === 'test') return 'test'`, so an
        // inherited `VITEST=true` did put a spawned child's crypto layer in
        // `test` mode. #11448 (`a58eac3e2`, merged 2026-08-23) deleted that
        // arm; the live `detectMode` (`local-crypto-provider.ts:185`, read
        // off this tree) reads `NODE_ENV` and nothing else. So stripping
        // `VITEST` is not what selects the posture here, and the `test` →
        // `development` flip the old wording predicted is unreachable in
        // either direction.
        //
        // What DOES select `development` is the `NODE_ENV` entry below, and
        // it is measured on this tree, not inherited: this file spawns
        // `bin/run.js`, which pins no `NODE_ENV` of its own (only
        // `bin/run-dev.js` does), with the variable UNSET — so `serve.ts`
        // assigns `process.env.NODE_ENV = 'development'` in-process for
        // `--dev` before `runtime.start()`, and the crypto provider reads
        // `process.env` when it resolves its key, after that assignment.
        //
        // ⭐ The conclusion is unchanged and load-bearing: development mode
        // PERSISTS a minted key to `$HOME/.objectstack/dev-crypto-key`, so
        // supplying one keeps this boot from writing to the runner's home
        // directory and from coupling itself to whatever other test got
        // there first.
        OS_SECRET_KEY: E2E_SECRET_KEY,
        // UNSET, not `development` — and `undefined` rather than `''`, because
        // Node's `spawn()` omits an undefined-valued entry rather than
        // stringifying it. Unset is what keeps oclif's ts-path reroute OFF, so
        // `CLI` above resolves the command from `dist/`; the vitest worker
        // exports `NODE_ENV=test`, which would switch the reroute back on, so
        // the entry has to be here to remove it rather than merely omitted.
        //
        // The `--dev` admin seed this boot depends on still runs. `serve.ts`
        // assigns `process.env.NODE_ENV = 'development'` IN-PROCESS for `--dev`
        // when the variable is unset, before `runtime.start()`, and
        // plugin-auth's `isDevAdminSeedArmed()` reads it at CALL time inside
        // the `kernel:ready` hook — after that assignment. Both halves
        // re-measured on this tree, not inherited from the card.
        NODE_ENV: undefined,
        ...env,
      }),
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
    // Build prerequisite first: the spawns below resolve `serve` from `dist/`.
    requireBuiltCli();

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
