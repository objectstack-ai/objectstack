// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The local T0 install loop end to end (ADR-0025 §3.5 M1, #27123), in process
 * through oclif, against a real SQLite file and an OS_HOME of its own:
 * `os plugin trust add` writes the trusted-key row (and the audit mirror's row
 * for it), `os plugin install` verifies the artifact's detached signature
 * against that row, re-verifies its integrity at unpack, and materializes it
 * with an installation record naming the key.
 *
 * Every refusal is pinned by its NAME and exit status 1, and none of them
 * leaves an install directory or a record behind: an unknown key, a revoked
 * key, a key row that cannot verify, a signature over other bytes, a missing,
 * malformed or unreadable signature, an integrity mismatch, an entry that
 * would land outside the install directory, an installations file that cannot
 * be read, and a directory another project's install holds. The one override,
 * `--trust-unsigned`, installs an UNSIGNED artifact and says so on stderr; it
 * never makes a present signature pass, whatever is wrong with it.
 *
 * [Slice 2] The signature is verified over the raw bytes BEFORE anything is
 * inflated, so an artifact signed by an untrusted key is refused for its key
 * even when it is not an archive at all; a tier the boot does not dispatch
 * installs with a warning naming the boot's refusal; and `os plugin disable |
 * enable | uninstall` refuse an id this project has not installed by name.
 *
 * Each case builds its own home, project and database, so the cases hold in
 * any order and one at a time.
 *
 * The database is read back on a connection of our own (`SqlDriver`), which is
 * also what places this file in the integration tier (`vitest-tiers.ts`).
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SqlDriver } from '@objectstack/driver-sql';
import { generateEd25519KeyPair, signPayload } from '@objectstack/core';
import { loadPluginInstallations, pluginInstallDir, pluginInstallationsFile, readPublisherPublicKey } from '@objectstack/runtime';
import { isExitSignal } from '../../utils/format.js';
import { MANIFEST_FILENAME, computeIntegrity, createTarGz, type ArchiveFile } from '../../utils/osplugin.js';
import { INSTALLED_ARTIFACT_FILE, INSTALLED_SIGNATURE_FILE } from '../../utils/plugin-install.js';
import PluginInstall from './install.js';
import PluginDisable from './disable.js';
import PluginEnable from './enable.js';
import PluginUninstall from './uninstall.js';
import PluginTrustAdd from './trust/add.js';
import PluginTrustRevoke from './trust/revoke.js';

const CLI_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const CASE_TIMEOUT_MS = 120_000;
const ENV = ['OS_HOME', 'OS_DATABASE_URL', 'DATABASE_URL', 'TURSO_DATABASE_URL', 'OS_DATABASE_DRIVER', 'OS_ARTIFACT_PATH', 'OS_ENVIRONMENT_ID'] as const;

interface Run {
  payload: any;
  /** What reached `process.stdout.write`. */
  stdout: string;
  /** Everything else: `process.stderr.write` and the console. */
  stderr: string;
  exitCode: number;
}

/** One command through oclif, its stdout document and exit status captured. */
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
  // Boot chatter goes through console; the `--json` document is the one
  // thing written to stdout itself, as `emitJson` writes it.
  vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => void err.push(`${a.join(' ')}\n`));
  vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => void err.push(`${a.join(' ')}\n`));
  vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => void err.push(`${a.join(' ')}\n`));
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
let project: string;
let dbFile: string;
const savedEnv: Record<string, string | undefined> = {};
const savedCwd = process.cwd();
const publisher = generateEd25519KeyPair();
const stranger = generateEd25519KeyPair();
const KEY_ID = 'acme-2026';
const text = (t: string) => new TextEncoder().encode(t);

/** A `.osplugin` built as `os plugin build` builds one, its integrity map computed unless given. */
function artifact(name: string, opts: { id: string; version?: string; runtime?: string; files?: ArchiveFile[]; integrity?: Record<string, string>; dir?: string }): string {
  const files: ArchiveFile[] = opts.files ?? [{ path: 'dist/index.mjs', data: text(`export const id = ${JSON.stringify(opts.id)};\n`) }];
  const manifest = {
    id: opts.id,
    version: opts.version ?? '1.0.0',
    type: 'plugin',
    runtime: opts.runtime ?? 'node',
    packaging: 'bundled',
    integrity: opts.integrity ?? computeIntegrity(files),
  };
  const path = join(opts.dir ?? project, `${name}.osplugin`);
  writeFileSync(path, createTarGz([...files, { path: MANIFEST_FILENAME, data: text(JSON.stringify(manifest)) }]));
  return path;
}

function sign(path: string, privateKeyPem = publisher.privateKeyPem, keyId = KEY_ID): string {
  const signature = signPayload(new Uint8Array(readFileSync(path)), privateKeyPem, keyId);
  writeFileSync(`${path}.sig`, signature);
  return signature;
}

/** `path` with the signature `signature` made over OTHER bytes of the same id and version beside it. */
function signedOverOtherBytes(name: string, id: string): string {
  const original = artifact(`${name}-original`, { id });
  const signature = sign(original);
  const path = artifact(name, { id, files: [{ path: 'dist/index.mjs', data: text('export const changed = 1;\n') }] });
  writeFileSync(`${path}.sig`, signature);
  return path;
}

async function withDriver<T>(fn: (knex: any) => Promise<T>): Promise<T> {
  const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: dbFile }, useNullAsDefault: true });
  try {
    return await fn((driver as any).knex);
  } finally {
    await driver.disconnect();
  }
}

const readTable = (table: string): Promise<any[]> => withDriver((knex) => knex(table).select('*'));

/** The refusal is the named one, exit 1, and the artifact's version was not installed. */
function expectRefused(result: Run, error: string, id: string, version = '1.0.0'): void {
  expect(result.payload, result.stdout.slice(-400)).toMatchObject({ error });
  expect(result.exitCode).toBe(1);
  expect(existsSync(pluginInstallDir('env_local', id, version))).toBe(false);
  expect(loadPluginInstallations('env_local').some((r) => r.id === id)).toBe(false);
}

const db = () => ['--database-url', `file:${dbFile}`];

/** Trust the publisher's key under {@link KEY_ID} in this case's database. */
async function trustPublisher(): Promise<void> {
  const added = await run(PluginTrustAdd, [join(project, 'acme.pub.pem'), '--key-id', KEY_ID, ...db()]);
  expect(added.exitCode, added.stdout + added.stderr.slice(-400)).toBe(0);
}

beforeAll(() => {
  for (const key of ENV) savedEnv[key] = process.env[key];
});

afterAll(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

beforeEach(() => {
  for (const key of ENV) delete process.env[key];
  root = mkdtempSync(join(tmpdir(), 'os-plugin-install-'));
  home = join(root, 'home');
  project = join(root, 'project');
  mkdirSync(home);
  mkdirSync(project);
  process.env.OS_HOME = home;
  dbFile = join(project, 'app.db');
  writeFileSync(join(project, 'acme.pub.pem'), publisher.publicKeyPem);
  process.chdir(project);
});

afterEach(() => {
  process.chdir(savedCwd);
  rmSync(root, { recursive: true, force: true });
});

describe('os plugin install (ADR-0025 §3.5 M1)', () => {
  it('refuses a key the store does not hold, and its read-only read creates no database', async () => {
    const path = artifact('untrusted', { id: 'com.acme.untrusted' });
    sign(path);
    const result = await run(PluginInstall, [path, ...db(), '--json']);
    expectRefused(result, 'signature_key_untrusted', 'com.acme.untrusted');
    expect(result.payload.message).toContain(KEY_ID);
    expect(existsSync(dbFile)).toBe(false);
  }, CASE_TIMEOUT_MS);

  it('trust add writes the row and its audit row; a second add of the same key writes nothing', async () => {
    await trustPublisher();
    const read = readPublisherPublicKey(publisher.publicKeyPem);
    if (!read.ok) throw new Error(read.message);
    const rows = await readTable('sys_trusted_key');
    expect(rows).toEqual([expect.objectContaining({ key_id: KEY_ID, fingerprint: read.fingerprint, status: 'active', source: 'local' })]);
    // The audit mirror records the admin write, by the object it touched.
    const audit = (await readTable('sys_audit_log')).filter((r) => JSON.stringify(r).includes('sys_trusted_key'));
    expect(audit.length).toBeGreaterThan(0);

    const again = await run(PluginTrustAdd, [join(project, 'acme.pub.pem'), '--key-id', KEY_ID, ...db()]);
    expect(again.exitCode).toBe(0);
    expect(await readTable('sys_trusted_key')).toHaveLength(1);
  }, CASE_TIMEOUT_MS);

  it('refuses to trust a private key, writing no row', async () => {
    await trustPublisher();
    const keyFile = join(project, 'acme.key.pem');
    writeFileSync(keyFile, publisher.privateKeyPem);
    const result = await run(PluginTrustAdd, [keyFile, '--key-id', 'acme-private', ...db()]);
    expect(result.exitCode).toBe(1);
    expect((await readTable('sys_trusted_key')).map((r) => r.key_id)).toEqual([KEY_ID]);
  }, CASE_TIMEOUT_MS);

  it('installs a signed artifact: the files, the original bytes and signature, and a record naming the key', async () => {
    await trustPublisher();
    const path = artifact('good', { id: 'com.acme.good' });
    const signature = sign(path);
    const result = await run(PluginInstall, [path, ...db(), '--json']);
    expect(result.exitCode, result.stdout.slice(-400)).toBe(0);

    const read = readPublisherPublicKey(publisher.publicKeyPem);
    if (!read.ok) throw new Error(read.message);
    const dir = pluginInstallDir('env_local', 'com.acme.good', '1.0.0');
    expect(result.payload.installed).toMatchObject({
      id: 'com.acme.good',
      version: '1.0.0',
      dir,
      signature: { keyId: KEY_ID, fingerprint: read.fingerprint },
      trustUnsigned: false,
    });
    expect(dir.startsWith(join(home, 'plugins', 'env_local'))).toBe(true);
    expect(readFileSync(join(dir, 'dist', 'index.mjs'), 'utf8')).toContain('com.acme.good');
    expect(new Uint8Array(readFileSync(join(dir, INSTALLED_ARTIFACT_FILE)))).toEqual(new Uint8Array(readFileSync(path)));
    expect(readFileSync(join(dir, INSTALLED_SIGNATURE_FILE), 'utf8').trim()).toBe(signature);
    expect(loadPluginInstallations('env_local')).toEqual([result.payload.installed]);
  }, CASE_TIMEOUT_MS);

  it('refuses a signature made over other bytes', async () => {
    await trustPublisher();
    const path = signedOverOtherBytes('other-bytes', 'com.acme.other');
    expectRefused(await run(PluginInstall, [path, ...db(), '--json']), 'signature_invalid', 'com.acme.other');
  }, CASE_TIMEOUT_MS);

  it('refuses a trusted-key row that cannot verify: its fingerprint is not its public key\'s', async () => {
    await trustPublisher();
    // The row's PEM swapped for another key: the stored fingerprint no longer names it.
    const updated = await withDriver((knex) => knex('sys_trusted_key').where({ key_id: KEY_ID }).update({ public_key: stranger.publicKeyPem }));
    expect(updated).toBe(1);
    const path = artifact('invalid-row', { id: 'com.acme.invalid-row' });
    sign(path);
    const result = await run(PluginInstall, [path, ...db(), '--json']);
    expectRefused(result, 'trusted_key_invalid', 'com.acme.invalid-row');
    expect(result.payload.message).toContain('fingerprint');
  }, CASE_TIMEOUT_MS);

  it('refuses an artifact path that is not a readable file, by name', async () => {
    const path = join(project, 'a-directory.osplugin');
    mkdirSync(path);
    const result = await run(PluginInstall, [path, '--trust-unsigned', ...db(), '--json']);
    expect(result.payload, result.stdout.slice(-400)).toMatchObject({ error: 'artifact_unreadable' });
    expect(result.exitCode).toBe(1);
    expect(existsSync(join(home, 'plugins'))).toBe(false);
  }, CASE_TIMEOUT_MS);

  it('refuses a malformed signature by name', async () => {
    const path = artifact('malformed', { id: 'com.acme.malformed' });
    writeFileSync(`${path}.sig`, 'not-a-signature');
    expectRefused(await run(PluginInstall, [path, ...db(), '--json']), 'signature_malformed', 'com.acme.malformed');
  }, CASE_TIMEOUT_MS);

  it('refuses a signature path it cannot read, naming it, and never takes it for an absent one', async () => {
    const path = artifact('sig-dir', { id: 'com.acme.sig-dir' });
    mkdirSync(`${path}.sig`);
    for (const extra of [[], ['--trust-unsigned']]) {
      const result = await run(PluginInstall, [path, ...extra, ...db(), '--json']);
      expectRefused(result, 'signature_unreadable', 'com.acme.sig-dir');
      expect(result.payload.message).toContain(`${path}.sig`);
    }
  }, CASE_TIMEOUT_MS);

  it('refuses an artifact whose files are not the ones its manifest names, though the signature over it is good', async () => {
    const files: ArchiveFile[] = [{ path: 'dist/index.mjs', data: text('export const shipped = 1;\n') }];
    const integrity = computeIntegrity([{ path: 'dist/index.mjs', data: text('export const declared = 1;\n') }]);
    const path = artifact('mismatch', { id: 'com.acme.mismatch', files, integrity });
    sign(path);
    // The signature is verified first (before anything is inflated), so the
    // key is trusted for the integrity check to be what refuses.
    await trustPublisher();
    const result = await run(PluginInstall, [path, ...db(), '--json']);
    expectRefused(result, 'integrity_mismatch', 'com.acme.mismatch');
    expect(JSON.stringify(result.payload.details)).toContain('dist/index.mjs');
  }, CASE_TIMEOUT_MS);

  it('refuses an entry that would land outside the install directory', async () => {
    const files: ArchiveFile[] = [{ path: '../escape.txt', data: text('x') }];
    const path = artifact('escape', { id: 'com.acme.escape', files });
    sign(path);
    await trustPublisher();
    expectRefused(await run(PluginInstall, [path, ...db(), '--json']), 'artifact_entries_refused', 'com.acme.escape');
    expect(existsSync(join(home, 'plugins', 'env_local', 'com.acme.escape', 'escape.txt'))).toBe(false);
    expect(existsSync(join(home, 'plugins', 'env_local', 'escape.txt'))).toBe(false);
  }, CASE_TIMEOUT_MS);

  it('refuses an unsigned artifact, and installs it only under --trust-unsigned, saying so on stderr', async () => {
    const path = artifact('unsigned', { id: 'com.acme.unsigned' });
    expectRefused(await run(PluginInstall, [path, ...db(), '--json']), 'signature_missing', 'com.acme.unsigned');

    const result = await run(PluginInstall, [path, '--trust-unsigned', ...db(), '--json']);
    expect(result.exitCode, result.stdout.slice(-400)).toBe(0);
    expect(result.payload.installed).toMatchObject({ id: 'com.acme.unsigned', signature: null, signatureFile: null, trustUnsigned: true });
    expect(result.stderr).toMatch(/--trust-unsigned/);
    expect(existsSync(join(pluginInstallDir('env_local', 'com.acme.unsigned', '1.0.0'), INSTALLED_SIGNATURE_FILE))).toBe(false);
  }, CASE_TIMEOUT_MS);

  it('--trust-unsigned never makes a present signature pass: untrusted, malformed, over other bytes, or revoked', async () => {
    const untrusted = artifact('override-untrusted', { id: 'com.acme.override-untrusted' });
    sign(untrusted, stranger.privateKeyPem, 'stranger');
    expectRefused(await run(PluginInstall, [untrusted, '--trust-unsigned', ...db(), '--json']), 'signature_key_untrusted', 'com.acme.override-untrusted');

    const malformed = artifact('override-malformed', { id: 'com.acme.override-malformed' });
    writeFileSync(`${malformed}.sig`, 'ed25519:acme-2026');
    expectRefused(await run(PluginInstall, [malformed, '--trust-unsigned', ...db(), '--json']), 'signature_malformed', 'com.acme.override-malformed');

    await trustPublisher();
    const otherBytes = signedOverOtherBytes('override-other', 'com.acme.override-other');
    expectRefused(await run(PluginInstall, [otherBytes, '--trust-unsigned', ...db(), '--json']), 'signature_invalid', 'com.acme.override-other');

    expect((await run(PluginTrustRevoke, [KEY_ID, ...db()])).exitCode).toBe(0);
    const revoked = artifact('override-revoked', { id: 'com.acme.override-revoked' });
    sign(revoked);
    expectRefused(await run(PluginInstall, [revoked, '--trust-unsigned', ...db(), '--json']), 'signature_key_revoked', 'com.acme.override-revoked');
  }, CASE_TIMEOUT_MS);

  it('after trust revoke, an artifact signed under that key id is refused by name', async () => {
    await trustPublisher();
    const before = artifact('before-revoke', { id: 'com.acme.before-revoke' });
    sign(before);
    expect((await run(PluginInstall, [before, ...db(), '--json'])).exitCode).toBe(0);

    const revoked = await run(PluginTrustRevoke, [KEY_ID, ...db()]);
    expect(revoked.exitCode, revoked.stdout).toBe(0);
    expect(await readTable('sys_trusted_key')).toEqual([expect.objectContaining({ key_id: KEY_ID, status: 'revoked' })]);

    const path = artifact('after-revoke', { id: 'com.acme.after-revoke' });
    sign(path);
    expectRefused(await run(PluginInstall, [path, ...db(), '--json']), 'signature_key_revoked', 'com.acme.after-revoke');
    // What was installed before the revoke stays as it was.
    expect(loadPluginInstallations('env_local').map((r) => r.id)).toEqual(['com.acme.before-revoke']);
    expect(existsSync(join(pluginInstallDir('env_local', 'com.acme.before-revoke', '1.0.0'), INSTALLED_ARTIFACT_FILE))).toBe(true);
  }, CASE_TIMEOUT_MS);

  it('refuses before writing anything when the installations file cannot be read, and leaves it as it was', async () => {
    const file = pluginInstallationsFile('env_local');
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, '{ not json');
    const path = artifact('corrupt-record', { id: 'com.acme.corrupt-record' });
    const result = await run(PluginInstall, [path, '--trust-unsigned', ...db(), '--json']);
    expect(result.payload, result.stdout.slice(-400)).toMatchObject({ error: 'record_unreadable' });
    expect(result.payload.message).toContain(file);
    expect(result.exitCode).toBe(1);
    expect(existsSync(pluginInstallDir('env_local', 'com.acme.corrupt-record', '1.0.0'))).toBe(false);
    expect(readFileSync(file, 'utf8')).toBe('{ not json');
  }, CASE_TIMEOUT_MS);

  it('two projects sharing one home and environment: neither overwrites an install the other made from other bytes', async () => {
    const other = join(root, 'other-project');
    mkdirSync(other);
    const id = 'com.acme.shared';
    const dir = pluginInstallDir('env_local', id, '1.0.0');
    const first = artifact('shared-first', { id, files: [{ path: 'dist/index.mjs', data: text('export const build = 1;\n') }] });
    const second = artifact('shared-second', { id, files: [{ path: 'dist/index.mjs', data: text('export const build = 2;\n') }] });
    const installedBytes = () => new Uint8Array(readFileSync(join(dir, INSTALLED_ARTIFACT_FILE)));

    expect((await run(PluginInstall, [first, '--trust-unsigned', '--json'])).exitCode).toBe(0);

    process.chdir(other);
    const taken = await run(PluginInstall, [second, '--trust-unsigned', '--json']);
    expect(taken.payload, taken.stdout.slice(-400)).toMatchObject({ error: 'install_dir_taken' });
    expect(taken.exitCode).toBe(1);
    expect(taken.payload.message).toContain(dir);
    expect(installedBytes()).toEqual(new Uint8Array(readFileSync(first)));
    expect(readFileSync(join(dir, 'dist', 'index.mjs'), 'utf8')).toContain('build = 1');
    expect(loadPluginInstallations('env_local')).toEqual([]);

    // The project whose record owns the directory may replace it.
    process.chdir(project);
    const replaced = await run(PluginInstall, [second, '--trust-unsigned', '--json']);
    expect(replaced.exitCode, replaced.stdout.slice(-400)).toBe(0);
    expect(replaced.payload.replaced).toBe(true);
    expect(installedBytes()).toEqual(new Uint8Array(readFileSync(second)));

    // Control: the other project installing the very bytes the directory holds is no overwrite at all.
    process.chdir(other);
    const same = await run(PluginInstall, [second, '--trust-unsigned', '--json']);
    expect(same.exitCode, same.stdout.slice(-400)).toBe(0);
    expect(loadPluginInstallations('env_local').map((r) => r.id)).toEqual([id]);
  }, CASE_TIMEOUT_MS);

  it('[slice 2] verifies the signature over the raw bytes before inflating anything', async () => {
    // Not an archive at all: signed by a key nobody trusts, the refusal is the
    // key's, because nothing is inflated before the signature passes.
    const path = join(project, 'not-an-archive.osplugin');
    writeFileSync(path, 'these bytes are not gzip');
    sign(path, stranger.privateKeyPem, 'stranger');
    const untrusted = await run(PluginInstall, [path, ...db(), '--json']);
    expect(untrusted.payload, untrusted.stdout.slice(-400)).toMatchObject({ error: 'signature_key_untrusted' });
    // Signed by the trusted key, the same bytes reach the inflate, which refuses them.
    await trustPublisher();
    sign(path);
    const unreadable = await run(PluginInstall, [path, ...db(), '--json']);
    expect(unreadable.payload, unreadable.stdout.slice(-400)).toMatchObject({ error: 'artifact_unreadable' });
    expect(unreadable.exitCode).toBe(1);
    expect(existsSync(join(home, 'plugins'))).toBe(false);
  }, CASE_TIMEOUT_MS);

  it('[slice 2] installs a sandbox-tier artifact with a warning that the boot refuses it until M3', async () => {
    await trustPublisher();
    const path = artifact('sandboxed', { id: 'com.acme.sandboxed', runtime: 'sandbox' });
    sign(path);
    const result = await run(PluginInstall, [path, ...db(), '--json']);
    expect(result.exitCode, result.stdout.slice(-400)).toBe(0);
    expect(result.payload).toMatchObject({ installed: { runtime: 'sandbox' }, boot: { loads: false, error: 'runtime_not_dispatched' } });
    expect(result.stderr).toMatch(/the next boot will refuse to load it \(runtime_not_dispatched\)/);
    // Control: a node artifact loads at boot, and says so.
    const node = artifact('node-tier', { id: 'com.acme.node-tier' });
    sign(node);
    const ok = await run(PluginInstall, [node, ...db(), '--json']);
    expect(ok.payload).toMatchObject({ boot: { loads: true } });
    expect(ok.stderr).not.toMatch(/refuse to load/);
  }, CASE_TIMEOUT_MS);
});

describe('[#27123 slice 2] os plugin disable | enable | uninstall', () => {
  async function installUnsigned(id: string): Promise<void> {
    const result = await run(PluginInstall, [artifact(id, { id }), '--trust-unsigned', '--json']);
    expect(result.exitCode, result.stdout.slice(-400)).toBe(0);
  }

  it('refuses an id this project has not installed, by name, naming what is installed', async () => {
    for (const command of [PluginDisable, PluginEnable, PluginUninstall]) {
      const none = await run(command, ['com.acme.absent', '--json']);
      expect(none.payload).toMatchObject({ error: 'plugin_not_installed' });
      expect(none.payload.message).toMatch(/nothing is installed/);
      expect(none.exitCode).toBe(1);
    }
    await installUnsigned('com.acme.present');
    const named = await run(PluginDisable, ['com.acme.absent', '--json']);
    expect(named.payload.message).toContain('installed: com.acme.present');
  }, CASE_TIMEOUT_MS);

  it('disable and enable flip the state once, and a repeat writes nothing', async () => {
    await installUnsigned('com.acme.toggle');
    expect((await run(PluginDisable, ['com.acme.toggle', '--json'])).payload).toMatchObject({ disabled: true, changed: true });
    expect((await run(PluginDisable, ['com.acme.toggle', '--json'])).payload).toMatchObject({ disabled: true, changed: false });
    expect((await run(PluginEnable, ['com.acme.toggle', '--json'])).payload).toMatchObject({ disabled: false, changed: true });
    expect((await run(PluginEnable, ['com.acme.toggle', '--json'])).payload).toMatchObject({ disabled: false, changed: false });
  }, CASE_TIMEOUT_MS);

  it('uninstall marks the record and removes nothing yet; disable then refuses it as pending', async () => {
    await installUnsigned('com.acme.leaving');
    const dir = pluginInstallDir('env_local', 'com.acme.leaving', '1.0.0');
    const marked = await run(PluginUninstall, ['com.acme.leaving', '--json']);
    expect(marked.payload).toMatchObject({ status: 'uninstall-pending', dir, changed: true });
    expect(existsSync(dir)).toBe(true);
    expect((await run(PluginUninstall, ['com.acme.leaving', '--json'])).payload).toMatchObject({ changed: false });
    const pending = await run(PluginDisable, ['com.acme.leaving', '--json']);
    expect(pending.payload).toMatchObject({ error: 'plugin_uninstall_pending' });
    // Installing it again before the boot keeps it.
    await installUnsigned('com.acme.leaving');
    expect(loadPluginInstallations('env_local')).toEqual([expect.objectContaining({ id: 'com.acme.leaving', status: 'installed' })]);
  }, CASE_TIMEOUT_MS);
});
