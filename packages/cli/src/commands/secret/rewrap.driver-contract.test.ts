// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0128 §4.2 — `os secret rewrap` against the CONCRETE driver its own boot
 * resolves, end to end.
 *
 * The planner's pins (`utils/sys-secret-rewrap.test.ts`) run over a driver
 * double. Two facts are only true or false of the real store, so they are read
 * here, through `bootSchemaStack` with the command's own plugin list, against
 * a real SQLite file:
 *
 *  - **The conditional write really is conditional.** `updateMany` keyed on
 *    `id` AND the ciphertext the run read answers 0, and changes nothing,
 *    when the stored ciphertext is any other value. It answers 1 when it is
 *    the same. Live-safety rests on exactly this, and a driver that ignored
 *    one `where` key would overwrite a producer's concurrent value.
 *  - **The command end to end.** The dry run writes nothing (the whole table
 *    is read back unchanged). `--apply` re-wraps exactly the attributable
 *    version-1 rows, under their holders' scopes, and leaves the orphan
 *    byte-for-byte as it was. A second `--apply` is all `done` and writes
 *    nothing.
 *
 * The version-1 rows are sealed here as every release before ADR-0128 sealed
 * them, under the key this file hands the run in `OS_SECRET_KEY`.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createCipheriv, randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PlatformObjectsPlugin } from '@objectstack/platform-objects/plugin';
import { ciphertextDerivationStatus, LocalCryptoProvider } from '@objectstack/service-settings';
import type { CryptoContext } from '@objectstack/spec/contracts';
import { bootSchemaStack, type SchemaStack } from '../../utils/schema-migrate.js';
import type { SecretReferenceEngineLike } from '../../utils/secret-reference-union.js';
import { oneShotSettingsPlugin } from '../../utils/one-shot-settings.js';
import SecretRewrap from './rewrap.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = resolve(HERE, '..', '..', '..');

/** Env that would point the boot at another database or another state directory. */
const OVERRIDING_ENV = ['OS_DATABASE_URL', 'DATABASE_URL', 'TURSO_DATABASE_URL', 'OS_DATABASE_DRIVER', 'OS_HOME'] as const;

type Row = Record<string, unknown>;

interface DriverProbe {
  find(object: string, query: Row): Promise<Row[]>;
  create(object: string, data: Row): Promise<unknown>;
  updateMany(object: string, query: Row, data: Row): Promise<number>;
}

const KEY = randomBytes(32);

function sealVersion1(plain: string, namespace: string, key: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', KEY, iv);
  cipher.setAAD(Buffer.from([namespace, key].join('|'), 'utf8'));
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString('base64');
}

const v1Row = (id: string, namespace: string, key: string, plain: string): Row => ({
  id, namespace, key, alg: 'aes-256-gcm', version: 1, kms_key_id: 'local:v1',
  ciphertext: sealVersion1(plain, namespace, key),
});

/** Held by a setting. */
const SETTINGS_ROW = v1Row('sec_rewrap_dc_settings', 'smtp', 'password', 'dc-settings-plain');
/** Held by a datasource the host declares in code. */
const DATASOURCE_ROW = v1Row('sec_rewrap_dc_datasource', 'datasource', 'warehouse', 'dc-datasource-plain');
/** Held by nothing. */
const ORPHAN_ROW = v1Row('sec_rewrap_dc_orphan', 'smtp', 'retired_token', 'dc-orphan-plain');
/** A row only the conditional-write probe touches. */
const PROBE_ROW = v1Row('sec_rewrap_dc_probe', 'probe', 'probe', 'dc-probe-plain');

describe('os secret rewrap — the concrete driver and the command, end to end (ADR-0128 §4.2)', () => {
  let dir: string;
  let dbFile: string;
  let declaredFile: string;
  let stack: SchemaStack | null = null;
  let secretDriver: DriverProbe;
  const savedEnv: Record<string, string | undefined> = {};
  const savedCwd = process.cwd();

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'os-rewrap-dc-'));
    dbFile = join(dir, 'rewrap.db');
    declaredFile = join(dir, 'datasources.json');

    for (const key of OVERRIDING_ENV) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    for (const key of ['OS_ARTIFACT_PATH', 'NODE_ENV', 'OS_SECRET_KEY'] as const) savedEnv[key] = process.env[key];
    process.env.OS_ARTIFACT_PATH = join(dir, 'dist', 'objectstack.json');
    process.env.NODE_ENV = 'production';
    process.env.OS_SECRET_KEY = KEY.toString('hex');
    process.chdir(dir);

    stack = await bootSchemaStack({
      jsonOutput: false,
      databaseUrl: `file:${dbFile}`,
      // `rewrap.ts`'s own list: the one-shot settings composition, over the
      // key this file declares in `OS_SECRET_KEY` (the command resolves the
      // same key first and hands that instance in).
      extraPlugins: [new PlatformObjectsPlugin(), await oneShotSettingsPlugin()],
    });
    const engine = stack.kernel.getService('objectql') as SecretReferenceEngineLike | undefined;
    if (!engine) throw new Error('no objectql engine on the booted stack — nothing to measure');
    secretDriver = engine.getDriverForObject('sys_secret') as unknown as DriverProbe;
    const settingDriver = engine.getDriverForObject('sys_setting') as unknown as DriverProbe;
    if (!secretDriver || !settingDriver) throw new Error('sys_secret / sys_setting resolved no driver');

    for (const row of [SETTINGS_ROW, DATASOURCE_ROW, ORPHAN_ROW, PROBE_ROW]) {
      await secretDriver.create('sys_secret', { ...row });
    }
    await settingDriver.create('sys_setting', { namespace: 'smtp', key: 'password', value_enc: SETTINGS_ROW.id });
    writeFileSync(declaredFile, JSON.stringify([
      { name: 'warehouse', external: { credentialsRef: `sys_secret:${String(DATASOURCE_ROW.id)}` } },
    ]));
  }, 180_000);

  afterAll(async () => {
    try { await stack?.shutdown(); } catch { /* torn down either way */ }
    stack = null;
    process.chdir(savedCwd);
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  const rowOf = async (id: unknown): Promise<Row> => {
    const [row] = await secretDriver.find('sys_secret', { where: { id } });
    if (!row) throw new Error(`sys_secret row ${String(id)} is gone`);
    return row;
  };

  const runJson = async (argv: string[]): Promise<{ payload: Record<string, any>; exitCode: number }> => {
    const chunks: string[] = [];
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(
      ((chunk: unknown, ...rest: unknown[]) => {
        chunks.push(String(chunk));
        const done = rest.find((a) => typeof a === 'function') as ((e?: Error | null) => void) | undefined;
        done?.(null);
        return true;
      }) as never,
    );
    const savedExitCode = process.exitCode;
    let exitCode = 0;
    try {
      await SecretRewrap.run(['--json', '--database-url', `file:${dbFile}`, ...argv], { root: CLI_ROOT });
      exitCode = Number(process.exitCode ?? 0);
    } finally {
      stdout.mockRestore();
      process.exitCode = savedExitCode;
    }
    const lines = chunks.join('').split('\n').filter((l) => l.trim() !== '');
    return { payload: JSON.parse(lines[lines.length - 1]) as Record<string, any>, exitCode };
  };

  it('names the concrete driver behind the write', () => {
    expect((secretDriver as unknown as { name?: unknown }).name).toBe('com.objectstack.driver.sql');
    expect(typeof secretDriver.updateMany).toBe('function');
  });

  it('the conditional write is conditional: a stale ciphertext changes nothing, the read one changes the row', async () => {
    const before = await rowOf(PROBE_ROW.id);

    const stale = await secretDriver.updateMany(
      'sys_secret',
      { where: { id: PROBE_ROW.id, ciphertext: 'v2:a-value-this-run-never-read' } },
      { ciphertext: 'v2:must-not-land', version: 99 },
    );
    expect(stale).toBe(0);
    const unchanged = await rowOf(PROBE_ROW.id);
    expect(unchanged.ciphertext).toBe(before.ciphertext);
    expect(Number(unchanged.version)).toBe(Number(before.version));

    // POSITIVE CONTROL: the same statement keyed on the ciphertext actually stored.
    const matched = await secretDriver.updateMany(
      'sys_secret',
      { where: { id: PROBE_ROW.id, ciphertext: before.ciphertext } },
      { kms_key_id: 'local:v1' },
    );
    expect(matched).toBe(1);
  }, 60_000);

  it('the dry run writes nothing, and counts what --apply would do', async () => {
    const before = await secretDriver.find('sys_secret', {});
    const { payload, exitCode } = await runJson(['--declared-datasources', declaredFile]);

    expect(payload.error, JSON.stringify(payload).slice(0, 400)).toBeUndefined();
    expect(payload.mode).toBe('dry-run');
    expect(payload.report.families.settings.status).toBe('enumerated');
    expect(payload.report.families.datasource.status).toBe('enumerated');
    expect(payload.report.byClass).toMatchObject({ rewrap: 2, left_orphan: 2, done: 0 });
    expect(payload.report.rewrapByScope).toEqual({ settings: 1, object_secret_field: 0, datasource_credential: 1 });
    expect(exitCode).toBe(0);
    expect(await secretDriver.find('sys_secret', {})).toEqual(before);
  }, 180_000);

  it('with no data key, the run refuses before opening a row, and NO provider in its boot mints one', async () => {
    // A development posture with no key anywhere: the posture in which a
    // default provider mints a key file. The settings service the boot
    // composes is handed this run's provider, so nothing may mint here.
    const home = mkdtempSync(join(tmpdir(), 'os-rewrap-nokey-'));
    const saved = { NODE_ENV: process.env.NODE_ENV, OS_SECRET_KEY: process.env.OS_SECRET_KEY, OS_HOME: process.env.OS_HOME };
    process.env.NODE_ENV = 'development';
    delete process.env.OS_SECRET_KEY;
    process.env.OS_HOME = home;
    try {
      const before = await secretDriver.find('sys_secret', {});
      const { payload, exitCode } = await runJson(['--declared-datasources', declaredFile]);

      expect(payload.error, JSON.stringify(payload).slice(0, 400)).toBe('crypto_key_unavailable');
      expect(exitCode).toBe(1);
      expect(existsSync(join(home, 'dev-crypto-key'))).toBe(false);
      expect(await secretDriver.find('sys_secret', {})).toEqual(before);

      // POSITIVE CONTROL for the measurement: a default-posture provider in the
      // same kind of home does mint, so an absent file above means none did.
      const control = mkdtempSync(join(tmpdir(), 'os-rewrap-mint-'));
      try {
        new LocalCryptoProvider({ env: { OS_HOME: control }, mode: 'development' });
        expect(existsSync(join(control, 'dev-crypto-key'))).toBe(true);
      } finally {
        rmSync(control, { recursive: true, force: true });
      }
    } finally {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      rmSync(home, { recursive: true, force: true });
    }
  }, 180_000);

  it('--apply re-wraps each held row under its holder\'s scope, leaves the orphan as it was, and a re-run is all done', async () => {
    const orphanBefore = await rowOf(ORPHAN_ROW.id);
    const { payload, exitCode } = await runJson(['--apply', '--yes', '--declared-datasources', declaredFile]);

    expect(payload.error, JSON.stringify(payload).slice(0, 400)).toBeUndefined();
    expect(payload.report.byClass).toMatchObject({ rewrap: 2, left_orphan: 2, write_conflict: 0, write_failed: 0 });
    expect(exitCode).toBe(0);

    const provider = new LocalCryptoProvider({ key: KEY });
    const opens = async (row: Row, ctx: CryptoContext) => {
      const stored = await rowOf(row.id);
      expect(ciphertextDerivationStatus(stored.ciphertext)).toBe('current');
      return provider.decrypt({
        id: String(stored.id), kmsKeyId: String(stored.kms_key_id), alg: String(stored.alg),
        version: Number(stored.version), ciphertext: String(stored.ciphertext),
      }, ctx);
    };
    expect(await opens(SETTINGS_ROW, { scope: 'settings', namespace: 'smtp', key: 'password' }))
      .toBe('dc-settings-plain');
    expect(await opens(DATASOURCE_ROW, { scope: 'datasource_credential', namespace: 'datasource', key: 'warehouse' }))
      .toBe('dc-datasource-plain');
    // Bound to its holder's scope: another producer's context does not open it.
    await expect(opens(DATASOURCE_ROW, { scope: 'settings', namespace: 'datasource', key: 'warehouse' })).rejects.toThrow();

    // The orphan is exactly as it was.
    const orphanAfter = await rowOf(ORPHAN_ROW.id);
    expect(orphanAfter.ciphertext).toBe(orphanBefore.ciphertext);
    expect(Number(orphanAfter.version)).toBe(Number(orphanBefore.version));

    // Re-run: everything held is done, nothing is written.
    const tableBefore = await secretDriver.find('sys_secret', {});
    const again = await runJson(['--apply', '--yes', '--declared-datasources', declaredFile]);
    expect(again.payload.report.byClass).toMatchObject({ rewrap: 0, done: 2, left_orphan: 2 });
    expect(again.exitCode).toBe(0);
    expect(await secretDriver.find('sys_secret', {})).toEqual(tableBefore);
  }, 180_000);
});
