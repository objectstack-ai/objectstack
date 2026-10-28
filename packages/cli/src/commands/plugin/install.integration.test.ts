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
 * key, a signature over other bytes, a missing signature, an integrity
 * mismatch, an entry that would land outside the install directory. The one
 * override, `--trust-unsigned`, installs and says so on stderr; it never makes
 * a bad signature pass.
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
import { loadPluginInstallations, pluginInstallDir, readPublisherPublicKey } from '@objectstack/runtime';
import { isExitSignal } from '../../utils/format.js';
import { MANIFEST_FILENAME, computeIntegrity, createTarGz, type ArchiveFile } from '../../utils/osplugin.js';
import { INSTALLED_ARTIFACT_FILE, INSTALLED_SIGNATURE_FILE } from '../../utils/plugin-install.js';
import PluginInstall from './install.js';
import PluginTrustAdd from './trust/add.js';
import PluginTrustRevoke from './trust/revoke.js';

const CLI_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const CASE_TIMEOUT_MS = 120_000;
const ENV = ['OS_HOME', 'OS_DATABASE_URL', 'DATABASE_URL', 'TURSO_DATABASE_URL', 'OS_DATABASE_DRIVER', 'OS_ARTIFACT_PATH', 'OS_ENVIRONMENT_ID'] as const;

interface Run {
  payload: any;
  stdout: string;
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
  vi.spyOn(console, 'log').mockImplementation((...a: unknown[]) => void out.push(`${a.join(' ')}\n`));
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
const KEY_ID = 'acme-2026';

/** A `.osplugin` built as `os plugin build` builds one, its integrity map computed unless given. */
function artifact(name: string, opts: { id: string; version?: string; files?: ArchiveFile[]; integrity?: Record<string, string> }): string {
  const files: ArchiveFile[] = opts.files ?? [{ path: 'dist/index.mjs', data: new TextEncoder().encode(`export const id = ${JSON.stringify(opts.id)};\n`) }];
  const manifest = {
    id: opts.id,
    version: opts.version ?? '1.0.0',
    type: 'plugin',
    runtime: 'node',
    packaging: 'bundled',
    integrity: opts.integrity ?? computeIntegrity(files),
  };
  const path = join(project, `${name}.osplugin`);
  writeFileSync(path, createTarGz([...files, { path: MANIFEST_FILENAME, data: new TextEncoder().encode(JSON.stringify(manifest)) }]));
  return path;
}

function sign(path: string, privateKeyPem = publisher.privateKeyPem, keyId = KEY_ID): string {
  const signature = signPayload(new Uint8Array(readFileSync(path)), privateKeyPem, keyId);
  writeFileSync(`${path}.sig`, signature);
  return signature;
}

async function readTable(table: string): Promise<any[]> {
  const driver = new SqlDriver({ client: 'better-sqlite3', connection: { filename: dbFile }, useNullAsDefault: true });
  try {
    return await (driver as any).knex(table).select('*');
  } finally {
    await driver.disconnect();
  }
}

/** The refusal is the named one, exit 1, and the artifact's version was not installed. */
function expectRefused(result: Run, error: string, id: string, version = '1.0.0'): void {
  expect(result.payload, result.stdout.slice(-400)).toMatchObject({ error });
  expect(result.exitCode).toBe(1);
  expect(existsSync(pluginInstallDir('env_local', id, version))).toBe(false);
  expect(loadPluginInstallations('env_local').some((r) => r.id === id)).toBe(false);
}

beforeAll(() => {
  for (const key of ENV) savedEnv[key] = process.env[key];
  for (const key of ENV) delete process.env[key];
  root = mkdtempSync(join(tmpdir(), 'os-plugin-install-'));
  home = join(root, 'home');
  project = join(root, 'project');
  mkdirSync(home);
  mkdirSync(project);
  process.env.OS_HOME = home;
  dbFile = join(project, 'app.db');
  writeFileSync(join(project, 'acme.pub.pem'), publisher.publicKeyPem);
});

afterAll(() => {
  process.chdir(savedCwd);
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(root, { recursive: true, force: true });
});

beforeEach(() => { process.chdir(project); });
afterEach(() => { process.chdir(savedCwd); });

const db = () => ['--database-url', `file:${dbFile}`];

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
    const added = await run(PluginTrustAdd, [join(project, 'acme.pub.pem'), '--key-id', KEY_ID, ...db()]);
    expect(added.exitCode, added.stdout).toBe(0);
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
    const keyFile = join(project, 'acme.key.pem');
    writeFileSync(keyFile, publisher.privateKeyPem);
    const result = await run(PluginTrustAdd, [keyFile, '--key-id', 'acme-private', ...db()]);
    expect(result.exitCode).toBe(1);
    expect((await readTable('sys_trusted_key')).map((r) => r.key_id)).toEqual([KEY_ID]);
  }, CASE_TIMEOUT_MS);

  it('installs a signed artifact: the files, the original bytes and signature, and a record naming the key', async () => {
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
    const original = artifact('other-bytes', { id: 'com.acme.other' });
    const signature = sign(original);
    // Same id and version, different content; the first artifact's signature beside it.
    const path = artifact('other-bytes', { id: 'com.acme.other', files: [{ path: 'dist/index.mjs', data: new TextEncoder().encode('export const evil = 1;\n') }] });
    writeFileSync(`${path}.sig`, signature);
    expectRefused(await run(PluginInstall, [path, ...db(), '--json']), 'signature_invalid', 'com.acme.other');
  }, CASE_TIMEOUT_MS);

  it('refuses an artifact whose files are not the ones its manifest names, though the signature over it is good', async () => {
    const files: ArchiveFile[] = [{ path: 'dist/index.mjs', data: new TextEncoder().encode('export const shipped = 1;\n') }];
    const integrity = computeIntegrity([{ path: 'dist/index.mjs', data: new TextEncoder().encode('export const declared = 1;\n') }]);
    const path = artifact('mismatch', { id: 'com.acme.mismatch', files, integrity });
    sign(path);
    const result = await run(PluginInstall, [path, ...db(), '--json']);
    expectRefused(result, 'integrity_mismatch', 'com.acme.mismatch');
    expect(JSON.stringify(result.payload.details)).toContain('dist/index.mjs');
  }, CASE_TIMEOUT_MS);

  it('refuses an entry that would land outside the install directory', async () => {
    const files: ArchiveFile[] = [{ path: '../escape.txt', data: new TextEncoder().encode('x') }];
    const path = artifact('escape', { id: 'com.acme.escape', files });
    sign(path);
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

  it('--trust-unsigned never makes a bad signature pass', async () => {
    const original = artifact('override', { id: 'com.acme.override' });
    const signature = sign(original);
    const path = artifact('override', { id: 'com.acme.override', files: [{ path: 'dist/index.mjs', data: new TextEncoder().encode('export const changed = 1;\n') }] });
    writeFileSync(`${path}.sig`, signature);
    expectRefused(await run(PluginInstall, [path, '--trust-unsigned', ...db(), '--json']), 'signature_invalid', 'com.acme.override');
  }, CASE_TIMEOUT_MS);

  it('after trust revoke, an artifact signed under that key id is refused by name', async () => {
    const revoked = await run(PluginTrustRevoke, [KEY_ID, ...db()]);
    expect(revoked.exitCode, revoked.stdout).toBe(0);
    expect(await readTable('sys_trusted_key')).toEqual([expect.objectContaining({ key_id: KEY_ID, status: 'revoked' })]);

    const path = artifact('after-revoke', { id: 'com.acme.after-revoke' });
    sign(path);
    expectRefused(await run(PluginInstall, [path, ...db(), '--json']), 'signature_key_revoked', 'com.acme.after-revoke');
    // What was installed before the revoke stays as it was.
    expect(loadPluginInstallations('env_local').map((r) => r.id).sort()).toEqual(['com.acme.good', 'com.acme.unsigned']);
  }, CASE_TIMEOUT_MS);
});
