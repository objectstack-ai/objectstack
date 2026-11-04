// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.
// test-budget: 120 — spawns the real producer twice in one beforeAll (`os dev`, then `os start` over the same project); measured locally before the first CI reading, to be re-measured from CI

/**
 * #29934 — a secret saved under `os dev` reads back under `os start` over the
 * same project database.
 *
 * ## The defect, measured on the published 18.3.0 CLI
 *
 * Both commands open the same SQLite file (`<project>/.objectstack/data/
 * objectstack.db`), but `os dev` kept its data key at
 * `$HOME/.objectstack/dev-crypto-key` while `os start` minted a second one at
 * `<project>/.objectstack/dev-crypto-key` (its own `OS_HOME`). So a settings
 * secret written under `os dev` read back under `os start` as
 * `{ value: null, source: 'default' }`, with only a "failed to decrypt" line in
 * the server log.
 *
 * ## What this pins
 *
 * The card's reproduction at the public door, with no env key anywhere and an
 * empty `HOME`: `os dev` → sign in → `PUT /api/settings/ai` with an
 * `openai_api_key` → stop; `os start --artifact ./dist/objectstack.json` in the
 * same project → sign in → `GET /api/settings/ai` must carry the stored value
 * (masked, from `global`), and the project directory must hold no second key.
 *
 * The legacy-file and two-files-differ rules are pinned beside the shared
 * resolution, in `src/utils/internal-crypto-key-file-channel.test.ts`.
 *
 * ## Spawn shape
 *
 * `bin/run.js` with `NODE_ENV` unset, the shipped entry resolving commands from
 * `dist/` (`requireBuiltCli`), each boot in its own process group (`dev` and
 * `start` both supervise a `serve` grandchild), on a port drawn with
 * `reservePort()`.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  childEnv,
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

/** The development dev-admin seed — the operator on both boots (one database). */
const EMAIL = 'admin@objectos.ai';
const PASSWORD = 'admin123';
const SECRET = 'sk-29934-shared-key';

const MANIFEST = { id: 'com.example.dsk', namespace: 'dsk', version: '1.0.0', type: 'app', name: 'Dsk' };
const OBJECTS = [{
  name: 'dsk_note',
  label: 'Note',
  pluralLabel: 'Notes',
  sharingModel: 'public_read_write',
  fields: { title: { type: 'text', label: 'Title' } },
}];

const CONFIG_SOURCE = `import { defineStack } from '@objectstack/spec';

export default defineStack({
  manifest: ${JSON.stringify(MANIFEST)},
  objects: ${JSON.stringify(OBJECTS)},
});
`;

interface Live {
  child: ChildProcess;
  base: string;
  output: () => string;
}

interface Reading {
  /** `PUT /api/settings/ai` under `os dev`. */
  put?: { status: number; body: any };
  /** `GET /api/settings/ai` under `os start`. */
  get?: { status: number; body: any };
  /** Both boots' output, for the failure message. */
  transcript?: string;
  error?: Error;
}

const groups: ChildProcess[] = [];
let dir: string;
let home: string;
let reading: Reading = {};

function boot(what: string, args: string[], port: number): Promise<Live> {
  return new Promise((resolveBoot, rejectBoot) => {
    const child = spawn(process.execPath, [CLI, ...args], {
      cwd: dir,
      // `childEnv`, never a bare `...process.env` — see its header. No env key
      // of any spelling and no home override: the key FILE is the subject, and
      // `HOME` is this test's own empty directory.
      env: childEnv({
        NO_COLOR: '1',
        HOME: home,
        OS_CLOUD_URL: 'off',
        OS_DISABLE_CONSOLE: '1',
        OS_LOG_LEVEL: 'warn',
        OS_SECRET_KEY: undefined,
        OS_DEV_CRYPTO_KEY: undefined,
        OBJECTSTACK_DEV_CRYPTO_KEY: undefined,
        OS_INTERNAL_CRYPTO_KEY_FILE: undefined,
        OS_HOME: undefined,
        OBJECTSTACK_HOME: undefined,
        OS_DATABASE_URL: undefined,
        OS_ARTIFACT_URL: undefined,
        OS_ARTIFACT_PATH: undefined,
        OS_AUTH_SECRET: undefined,
        OS_CLUSTER_DRIVER: undefined,
        OS_MODE: undefined,
        NODE_ENV: undefined,
        OS_PORT: undefined,
        PORT: undefined,
      }),
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    });
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
      if (READY.test(out)) settle(portDriftError(out, what, port) ?? port);
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
      label: 'dev-start-shared-data-key',
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

async function signIn(live: Live): Promise<string> {
  const r = await http(live, 'POST', '/api/v1/auth/sign-in/email', '', { email: EMAIL, password: PASSWORD });
  const token = r.body?.token;
  if (r.status !== 200 || typeof token !== 'string') {
    throw new Error(`sign-in answered ${r.status}: ${JSON.stringify(r.body)}\n--- output ---\n${live.output().slice(-3000)}`);
  }
  return token;
}

beforeAll(async () => {
  requireBuiltCli(RUN_JS_RESOLVES_FROM_DIST);
  dir = mkdtempSync(join(tmpdir(), 'os-29934-project-'));
  home = mkdtempSync(join(tmpdir(), 'os-29934-home-'));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'dsk-host', private: true }), 'utf8');
  writeFileSync(join(dir, 'objectstack.config.ts'), CONFIG_SOURCE, 'utf8');
  linkSpec(dir);
  mkdirSync(join(dir, 'dist'), { recursive: true });

  let live: Live | undefined;
  let transcript = '';
  try {
    // `npm run dev`: the dev admin is seeded, the secret is sealed.
    const devPort = reservePort();
    live = await boot('os dev', ['dev', '--no-watch', '--no-restart', '-p', String(devPort)], devPort);
    const devToken = await signIn(live);
    const put = await http(live, 'PUT', '/api/settings/ai', devToken, { openai_api_key: SECRET });
    transcript += `--- os dev ---\n${live.output().slice(-3000)}\n`;
    await stopGroup(live.child);
    live = undefined;

    // `npx os start --artifact ./dist/objectstack.json` in the same project.
    const startPort = reservePort();
    live = await boot(
      'os start',
      ['start', '--artifact', './dist/objectstack.json', '--port', String(startPort)],
      startPort,
    );
    const startToken = await signIn(live);
    const get = await http(live, 'GET', '/api/settings/ai', startToken);
    transcript += `--- os start ---\n${live.output().slice(-3000)}\n`;
    reading = { put, get, transcript };
  } catch (error) {
    reading = { error: error instanceof Error ? error : new Error(String(error)) };
  } finally {
    if (live) await stopGroup(live.child);
  }
}, 2 * BOOT_TIMEOUT_MS + 60_000);

afterAll(async () => {
  for (const child of groups) await stopGroup(child);
  for (const d of [dir, home]) {
    try { rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}, 60_000);

function recorded(): Required<Omit<Reading, 'error'>> {
  if (reading.error) throw reading.error;
  return reading as Required<Omit<Reading, 'error'>>;
}

/** The `openai_api_key` entry, whichever envelope the settings door answers in. */
function aiKey(body: any): { value?: unknown; source?: unknown } | undefined {
  const values = body?.data?.values ?? body?.values;
  return values?.openai_api_key;
}

describe('#29934 — `os dev` and `os start` share one data key for one project', () => {
  it('the secret is stored under `os dev`', () => {
    const { put, transcript } = recorded();
    expect(put.status, `${JSON.stringify(put.body)}\n${transcript}`).toBe(200);
  });

  it('`os start` reads the secret back over the same project database', () => {
    const { get, transcript } = recorded();
    expect(get.status, `${JSON.stringify(get.body)}\n${transcript}`).toBe(200);
    const entry = aiKey(get.body);
    expect(entry?.source, `${JSON.stringify(get.body)}\n${transcript}`).toBe('global');
    expect(entry?.value, `${JSON.stringify(get.body)}\n${transcript}`).not.toBeNull();
  });

  it('the key lives in the one file `os dev` uses, and the project holds no second one', () => {
    recorded();
    expect(existsSync(join(home, '.objectstack', 'dev-crypto-key'))).toBe(true);
    expect(existsSync(join(dir, '.objectstack', 'dev-crypto-key'))).toBe(false);
  });
});
