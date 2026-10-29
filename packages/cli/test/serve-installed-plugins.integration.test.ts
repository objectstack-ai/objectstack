// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#27123 slice 2] `os serve` loads what `os plugin install` installed
 * (ADR-0025 §3.5 M1), end to end: the commands run in process through oclif
 * against a real SQLite file and an OS_HOME of their own, and the boot is the
 * real command, spawned with `OS_MIGRATE_AND_EXIT=1 --no-server` (the
 * kernel-only boot that runs every plugin's `init` and exits).
 *
 * Five signed installs, each with one fate, in ONE boot:
 *   - `com.acme.loads`     `runtime: 'node'`, untouched   → its `init` runs
 *   - `com.acme.sandboxed` `runtime: 'sandbox'`           → refused, `runtime_not_dispatched`
 *   - `com.acme.tampered`  an unpacked file edited        → refused, `tree_changed`
 *   - `com.acme.disabled`  `os plugin disable`            → skipped, says so
 *   - `com.acme.removed`   `os plugin uninstall`          → directory removed, record dropped
 * then a second boot after `os plugin enable com.acme.disabled` and
 * `os plugin uninstall com.acme.loads`: the enabled one's `init` runs and the
 * uninstalled one's does not.
 *
 * Each plugin's `init` writes a marker file, so "it ran" and "nothing of it
 * ran" are read off the disk, not off the log. The controls: both boots exit 0
 * and print the migrate path's completion line, so a boot that never reached
 * the plugins cannot pass.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateEd25519KeyPair, signPayload } from '@objectstack/core';
import { loadPluginInstallations, pluginInstallDir } from '@objectstack/runtime';
import { isExitSignal } from '../src/utils/format.js';
import { MANIFEST_FILENAME, computeIntegrity, createTarGz, type ArchiveFile } from '../src/utils/osplugin.js';
import PluginInstall from '../src/commands/plugin/install.js';
import PluginDisable from '../src/commands/plugin/disable.js';
import PluginEnable from '../src/commands/plugin/enable.js';
import PluginUninstall from '../src/commands/plugin/uninstall.js';
import PluginTrustAdd from '../src/commands/plugin/trust/add.js';
import { CLI, E2E_SECRET_KEY, KERNEL_ASSIGNED_PORT, TSX, childEnv } from './helpers/serve-process.js';

const CLI_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ENV_KEYS = ['OS_HOME', 'OS_DATABASE_URL', 'DATABASE_URL', 'TURSO_DATABASE_URL', 'OS_DATABASE_DRIVER', 'OS_ARTIFACT_PATH', 'OS_ENVIRONMENT_ID'] as const;
const KEY_ID = 'acme-2026';
const publisher = generateEd25519KeyPair();
const text = (t: string) => new TextEncoder().encode(t);

const CONFIG = `
export default {
  manifest: {
    id: 'com.example.installed-plugins',
    namespace: 'installed_plugins',
    version: '1.0.0',
    type: 'app',
    name: 'Installed plugins boot probe',
  },
  objects: [{ name: 'ip_note', label: 'Note', sharingModel: 'private', fields: { body: { type: 'text', label: 'Body' } } }],
};
`;

interface Run {
  payload: any;
  stdout: string;
  stderr: string;
  exitCode: number;
}

/** One command through oclif, its `--json` document and exit status captured. */
async function run(command: { run: (argv: string[], opts: { root: string }) => Promise<unknown> }, argv: string[]): Promise<Run> {
  const savedExit = process.exitCode;
  const out: string[] = [];
  const err: string[] = [];
  const capture = (into: string[]) => ((chunk: unknown, ...rest: unknown[]) => {
    into.push(String(chunk));
    const cb = rest.find((a) => typeof a === 'function') as (() => void) | undefined;
    if (cb) cb();
    return true;
  }) as typeof process.stdout.write;
  vi.spyOn(process.stdout, 'write').mockImplementation(capture(out));
  vi.spyOn(process.stderr, 'write').mockImplementation(capture(err));
  for (const method of ['log', 'warn', 'error'] as const) {
    vi.spyOn(console, method).mockImplementation((...a: unknown[]) => void err.push(`${a.join(' ')}\n`));
  }
  let thrownExit: number | undefined;
  try {
    try {
      await command.run(argv, { root: CLI_ROOT });
    } catch (error) {
      if (!isExitSignal(error)) throw error;
      thrownExit = (error as { oclif?: { exit?: number } }).oclif?.exit;
    }
    const stdout = out.join('');
    let payload: any;
    try { payload = JSON.parse(stdout.trim()); } catch { payload = undefined; }
    return { payload, stdout, stderr: err.join(''), exitCode: thrownExit ?? (process.exitCode as number | undefined) ?? 0 };
  } finally {
    process.exitCode = savedExit;
    vi.restoreAllMocks();
  }
}

let root: string;
let home: string;
let app: string;
let dbFile: string;
const savedEnv: Record<string, string | undefined> = {};
const savedCwd = process.cwd();

/** The marker a plugin's `init` writes; its presence is "the plugin's code ran". */
const marker = (id: string) => join(home, `init-${id}`);

/** A signed `.osplugin` whose `init` writes {@link marker}. */
function signedArtifact(id: string, runtime = 'node'): string {
  const files: ArchiveFile[] = [{
    path: 'dist/index.mjs',
    data: text(
      "import { writeFileSync } from 'node:fs';\n"
      + `export default { name: ${JSON.stringify(id)}, version: '1.0.0', `
      + `init() { writeFileSync(${JSON.stringify(marker(id))}, 'ran'); } };\n`,
    ),
  }];
  const manifest = { id, version: '1.0.0', type: 'plugin', runtime, packaging: 'bundled', integrity: computeIntegrity(files) };
  const path = join(root, `${id}.osplugin`);
  writeFileSync(path, createTarGz([...files, { path: MANIFEST_FILENAME, data: text(JSON.stringify(manifest)) }]));
  writeFileSync(`${path}.sig`, signPayload(new Uint8Array(readFileSync(path)), publisher.privateKeyPem, KEY_ID));
  return path;
}

interface Boot {
  code: number | null;
  output: string;
}

/** `os serve --no-server` with `OS_MIGRATE_AND_EXIT=1` from the app directory; waits for its own exit. */
function boot(): Promise<Boot> {
  return new Promise((done, fail) => {
    const child = spawn(TSX, [CLI, 'serve', 'objectstack.config.ts', '--no-server', '--port', KERNEL_ASSIGNED_PORT], {
      cwd: app,
      env: childEnv({
        NO_COLOR: '1',
        OS_HOME: home,
        OS_DATABASE_URL: `file:${dbFile}`,
        OS_ENVIRONMENT_ID: undefined,
        OS_LOG_LEVEL: '',
        OS_DISABLE_CONSOLE: '1',
        OS_SECRET_KEY: E2E_SECRET_KEY,
        OS_MIGRATE_AND_EXIT: '1',
      }),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk) => { output += String(chunk); });
    child.stderr.on('data', (chunk) => { output += String(chunk); });
    child.on('error', fail);
    child.on('close', (code) => done({ code, output }));
  });
}

const IDS = ['com.acme.loads', 'com.acme.sandboxed', 'com.acme.tampered', 'com.acme.disabled', 'com.acme.removed'] as const;

let first: Boot;
let second: Boot;
/** Whose `init` had run, read off the markers right after each boot. */
let ranAfterFirst: string[];
let ranInSecond: string[];
const ran = () => IDS.filter((id) => existsSync(marker(id)));

beforeAll(async () => {
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  root = mkdtempSync(join(tmpdir(), 'os-27123-boot-'));
  home = join(root, 'home');
  app = join(root, 'app');
  mkdirSync(home);
  mkdirSync(app);
  dbFile = join(app, 'app.db');
  writeFileSync(join(app, 'objectstack.config.ts'), CONFIG, 'utf8');
  writeFileSync(join(app, 'package.json'), JSON.stringify({ name: 'os-27123-boot-fixture', private: true, type: 'module' }), 'utf8');
  writeFileSync(join(root, 'acme.pub.pem'), publisher.publicKeyPem);
  process.env.OS_HOME = home;
  process.chdir(app);
  const db = ['--database-url', `file:${dbFile}`];

  const trusted = await run(PluginTrustAdd, [join(root, 'acme.pub.pem'), '--key-id', KEY_ID, ...db]);
  expect(trusted.exitCode, trusted.stderr.slice(-600)).toBe(0);
  for (const [id, runtime] of [
    ['com.acme.loads', 'node'],
    ['com.acme.sandboxed', 'sandbox'],
    ['com.acme.tampered', 'node'],
    ['com.acme.disabled', 'node'],
    ['com.acme.removed', 'node'],
  ] as const) {
    const installed = await run(PluginInstall, [signedArtifact(id, runtime), ...db, '--json']);
    expect(installed.exitCode, `${id}: ${installed.stdout.slice(-400)}`).toBe(0);
  }
  writeFileSync(join(pluginInstallDir('env_local', 'com.acme.tampered', '1.0.0'), 'dist', 'index.mjs'), 'export default { name: "evil", init() {} };\n');
  expect((await run(PluginDisable, ['com.acme.disabled', '--json'])).exitCode).toBe(0);
  expect((await run(PluginUninstall, ['com.acme.removed', '--json'])).exitCode).toBe(0);

  first = await boot();
  ranAfterFirst = ran();

  expect((await run(PluginEnable, ['com.acme.disabled', '--json'])).exitCode).toBe(0);
  expect((await run(PluginUninstall, ['com.acme.loads', '--json'])).exitCode).toBe(0);
  for (const id of IDS) rmSync(marker(id), { force: true });

  second = await boot();
  ranInSecond = ran();
}, 600_000);

afterAll(() => {
  process.chdir(savedCwd);
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  if (root) rmSync(root, { recursive: true, force: true });
});

describe('[#27123] os serve loads installed plugins, verified, by tier', () => {
  it('both boots reached the plugins and exited cleanly (the controls)', () => {
    for (const b of [first, second]) {
      expect(b.code, b.output.slice(-2000)).toBe(0);
      expect(b.output).toMatch(/Migration complete/);
    }
  });

  it('runs the untouched node plugin\'s init, and only its', () => {
    expect(ranAfterFirst).toEqual(['com.acme.loads']);
    expect(first.output).not.toMatch(/Refused installed plugin com\.acme\.loads/);
  });

  it('refuses the sandbox tier and the tampered tree by name, and runs nothing of either', () => {
    expect(first.output).toMatch(/✗ Refused installed plugin com\.acme\.sandboxed@1\.0\.0 \(runtime_not_dispatched\)/);
    expect(first.output).toMatch(/✗ Refused installed plugin com\.acme\.tampered@1\.0\.0 \(tree_changed\)/);
    expect(ranAfterFirst).not.toContain('com.acme.sandboxed');
    expect(ranInSecond).not.toContain('com.acme.sandboxed');
    expect(ranAfterFirst).not.toContain('com.acme.tampered');
  });

  it('skips the disabled plugin, saying so, until it is enabled', () => {
    expect(first.output).toMatch(/Installed plugin com\.acme\.disabled@1\.0\.0 is disabled/);
    expect(ranAfterFirst).not.toContain('com.acme.disabled');
    expect(second.output).not.toMatch(/com\.acme\.disabled@1\.0\.0 is disabled/);
    expect(ranInSecond).toEqual(['com.acme.disabled']);
  });

  it('finishes an uninstall at the next boot: directory gone, record dropped, init never run', () => {
    expect(first.output).toMatch(/Uninstalled plugin com\.acme\.removed@1\.0\.0/);
    expect(existsSync(pluginInstallDir('env_local', 'com.acme.removed', '1.0.0'))).toBe(false);
    expect(ranAfterFirst).not.toContain('com.acme.removed');

    expect(second.output).toMatch(/Uninstalled plugin com\.acme\.loads@1\.0\.0/);
    expect(existsSync(pluginInstallDir('env_local', 'com.acme.loads', '1.0.0'))).toBe(false);
    expect(ranInSecond).not.toContain('com.acme.loads');
    expect(loadPluginInstallations('env_local').map((r) => r.id).sort()).toEqual([
      'com.acme.disabled',
      'com.acme.sandboxed',
      'com.acme.tampered',
    ]);
  });
});
