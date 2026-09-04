// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * #14843 — what the driver behind `os secret orphans` ACTUALLY returns.
 *
 * The command used to wrap both of its reads in a local `rowsOf()` that
 * unwrapped `{ data: [...] }` and lifted a bare row into `[row]`. Removing it
 * rests on one fact, and the card that asked for the removal refused to let
 * that fact be inferred: `IDataDriver.find` is DECLARED to resolve to
 * `Record<string, unknown>[]`, but a declaration is not a reading, and the
 * counter-case is real — the console's `ObjectStackAdapter.find()` resolves to
 * a normalized `QueryResult` envelope and never to an array. Two methods
 * spelled `find`, opposite answers. So this file reads the CONCRETE driver,
 * through the boot this command performs, and asserts the shape.
 *
 * ## What is driven, and why it is the real thing
 *
 * `bootSchemaStack` with the command's own `extraPlugins` (platform objects +
 * the settings service), against a real sqlite file. That is the same call the
 * command makes, so `kernel.getService('objectql').getDriverForObject(…)`
 * resolves the same way it does at run time — `ObjectQL.getDriver()` hands back
 * a registered driver instance unwrapped, so whatever this test names is
 * exactly what the command holds.
 *
 * ⛔ `expect(Array.isArray(rows)).toBe(true)` on its own would be satisfied by a
 * driver that answers `[]` to everything, which is the reading that would make
 * the removal look safe while the command silently reported nothing. So every
 * shape assertion here is paired with a SEEDED row that has to come back
 * inside that array, and the two are asserted together.
 *
 * ## The second half: both call sites, end to end
 *
 * The shape is read at the seam; the command is then run for real against the
 * same database, and the `--json` report is checked for a value that could only
 * have travelled through EACH of the two former `rowsOf` call sites:
 *
 *  - `counts.total` counts the `sys_secret` rows from the first read;
 *  - `legacyInlineRows` can only be populated from `sys_setting` rows read by
 *    the second, since a legacy inline `value_enc` exists nowhere else.
 *
 * A run that reported `total: 0` with an empty `legacyInlineRows` would be
 * indistinguishable from a broken read, which is why both are asserted with
 * seeded values rather than merely for absence of an error.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PlatformObjectsPlugin } from '@objectstack/platform-objects/plugin';
import { SettingsServicePlugin } from '@objectstack/service-settings';
import { bootSchemaStack, type SchemaStack } from '../../utils/schema-migrate.js';
import type { SecretReferenceEngineLike } from '../../utils/secret-reference-union.js';
import SecretOrphans from './orphans.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = resolve(HERE, '..', '..', '..');

/**
 * The env vars that outrank an explicit `databaseUrl`, or move where the boot
 * keeps its state. Every one must be absent or this file measures some other
 * database and says nothing about anything (the `unmanaged-tables.integration`
 * discipline, same list and same reason).
 */
const OVERRIDING_ENV = [
  'OS_DATABASE_URL',
  'DATABASE_URL',
  'TURSO_DATABASE_URL',
  'OS_DATABASE_DRIVER',
  'OS_HOME',
] as const;

/** A `sys_secret` row seeded straight through the driver, before any read. */
const SEEDED_SECRET = {
  id: 'sec_14843_probe',
  namespace: 'smtp',
  key: 'probe_token',
  alg: 'aes-256-gcm',
  version: 1,
  kms_key_id: 'kms_local',
  ciphertext: 'ENC(v1:probe-cipher-material)',
};

/**
 * A `sys_setting` row on the LEGACY INLINE path: `value_enc` holds ciphertext,
 * not a `sec_…` handle. Chosen because it is the one input whose effect on the
 * report (`legacyInlineRows`) can have come from nowhere but the second read.
 */
const SEEDED_SETTING = {
  namespace: 'smtp',
  key: 'inline_password',
  value_enc: 'ENC(v1:inline-legacy-ciphertext)',
};

interface DriverProbe {
  find(object: string, query: Record<string, unknown>): Promise<unknown>;
  create(object: string, data: Record<string, unknown>): Promise<unknown>;
}

describe('os secret orphans — the concrete driver behind both reads (#14843)', () => {
  let dir: string;
  let dbFile: string;
  let stack: SchemaStack | null = null;
  let secretDriver: DriverProbe;
  let settingDriver: DriverProbe;
  const savedEnv: Record<string, string | undefined> = {};
  const savedCwd = process.cwd();

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'os-14843-'));
    dbFile = join(dir, 'orphans.db');

    for (const key of OVERRIDING_ENV) {
      savedEnv[key] = process.env[key];
      delete process.env[key];
    }
    savedEnv.OS_ARTIFACT_PATH = process.env.OS_ARTIFACT_PATH;
    savedEnv.NODE_ENV = process.env.NODE_ENV;
    // Deliberately absent: no compiled artifact, so the boot is the bare data
    // stack plus the two plugins the command passes.
    process.env.OS_ARTIFACT_PATH = join(dir, 'dist', 'objectstack.json');
    process.env.NODE_ENV = 'production';
    // The command does not pass `projectRoot`, so its boot takes `process.cwd()`
    // for its state directory. Stand in the tempdir so the run under test keeps
    // its state there instead of in whatever directory vitest started in.
    process.chdir(dir);

    stack = await bootSchemaStack({
      jsonOutput: false,
      databaseUrl: `file:${dbFile}`,
      // Byte-identical to `orphans.ts`'s own list — the boot has to be the
      // command's, or the driver this file names is not the one it holds.
      extraPlugins: [new PlatformObjectsPlugin(), new SettingsServicePlugin({ registerRoutes: false })],
    });

    const engine = stack.kernel.getService('objectql') as SecretReferenceEngineLike | undefined;
    if (!engine) throw new Error('no objectql engine on the booted stack — nothing to measure');
    secretDriver = engine.getDriverForObject('sys_secret') as unknown as DriverProbe;
    settingDriver = engine.getDriverForObject('sys_setting') as unknown as DriverProbe;
    if (!secretDriver || !settingDriver) {
      throw new Error('sys_secret / sys_setting resolved no driver — nothing to measure');
    }

    await secretDriver.create('sys_secret', { ...SEEDED_SECRET });
    await settingDriver.create('sys_setting', { ...SEEDED_SETTING });
  }, 180_000);

  afterAll(async () => {
    try { await stack?.shutdown(); } catch { /* torn down either way */ }
    stack = null;
    process.chdir(savedCwd);
    for (const key of OVERRIDING_ENV) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    for (const key of ['OS_ARTIFACT_PATH', 'NODE_ENV'] as const) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('names the concrete driver this command actually holds', () => {
    // Not a preference for a particular driver — it is the premise every
    // assertion below rests on, named so a failure says WHICH driver moved.
    //
    // `IDataDriver.name` is the identity to assert; the CLASS name is checked
    // with a suffix match because this package resolves the driver through
    // `@objectstack/driver-sql`'s BUILT entry, where the bundler renames the
    // class `_SqlDriver`. An `=== 'SqlDriver'` assertion here is a statement
    // about the bundler, not about the driver.
    expect((secretDriver as unknown as { name?: unknown }).name).toBe('com.objectstack.driver.sql');
    expect(secretDriver.constructor.name).toMatch(/SqlDriver$/);
    // The two reads must not silently resolve to different drivers: the command
    // treats both results the same way.
    expect((settingDriver as unknown as { name?: unknown }).name).toBe('com.objectstack.driver.sql');
    expect(settingDriver.constructor.name).toMatch(/SqlDriver$/);
  });

  it('`sys_secret` find() resolves to a bare ARRAY holding the row — no envelope', async () => {
    const rows = await secretDriver.find('sys_secret', {});

    expect(Array.isArray(rows)).toBe(true);
    // The envelope shapes the removed normalizer existed to unwrap. Asserted
    // as absent on the value itself, so this fails loudly if a driver ever
    // starts answering `{ data: [...] }` or `{ records: [...] }`.
    expect(Object.prototype.hasOwnProperty.call(rows, 'data')).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(rows, 'records')).toBe(false);

    // …and the array is the row list itself, not a one-element wrapper around
    // one: the seeded row is directly an element. This is what makes the
    // `Array.isArray` above mean something.
    const list = rows as Array<Record<string, unknown>>;
    const seeded = list.find((r) => r.id === SEEDED_SECRET.id);
    expect(seeded).toBeDefined();
    expect(seeded!.namespace).toBe(SEEDED_SECRET.namespace);
    expect(seeded!.key).toBe(SEEDED_SECRET.key);
  }, 60_000);

  it('`sys_setting` find() answers the same way — the second read is not a different contract', async () => {
    const rows = await settingDriver.find('sys_setting', {});

    expect(Array.isArray(rows)).toBe(true);
    const list = rows as Array<Record<string, unknown>>;
    const seeded = list.find((r) => r.key === SEEDED_SETTING.key);
    expect(seeded).toBeDefined();
    expect(seeded!.value_enc).toBe(SEEDED_SETTING.value_enc);
  }, 60_000);

  it('an EMPTY result is `[]`, never null/undefined — the `!result` limb was dead too', async () => {
    // `rowsOf` opened with `if (!result) return []`. Read an object that exists
    // and holds nothing rather than one that does not exist: a throwing read
    // would prove nothing about what a successful empty read returns.
    const rows = await secretDriver.find('sys_secret', { where: { id: 'sec_no_such_row_14843' } });
    expect(Array.isArray(rows)).toBe(true);
    expect(rows as unknown[]).toEqual([]);
    // Positive control with the same call and the same flags: the unfiltered
    // read is non-empty, so the `[]` above is the filter and not a read that
    // cannot see anything.
    expect((await secretDriver.find('sys_secret', {})) as unknown[]).not.toEqual([]);
  }, 60_000);

  it('the command runs against this database and BOTH former call sites carry their rows', async () => {
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
    try {
      await SecretOrphans.run(
        ['--json', '--no-declared-datasources', '--database-url', `file:${dbFile}`],
        { root: CLI_ROOT },
      );
    } finally {
      stdout.mockRestore();
      process.exitCode = savedExitCode;
    }

    const lines = chunks.join('').split('\n').filter((l) => l.trim() !== '');
    const payload = JSON.parse(lines[lines.length - 1]) as {
      mode?: string;
      error?: string;
      plan?: {
        counts: { total: number };
        rows: Array<{ id: string }>;
        legacyInlineRows: Array<{ namespace: string; key: string }>;
      };
    };

    // A boot or read failure lands as an `error` envelope; naming it here beats
    // a downstream `undefined` that reads like a shape change.
    expect(payload.error).toBeUndefined();
    expect(payload.mode).toBe('report');

    // First former call site (`sys_secret`): the seeded row reached the plan.
    expect(payload.plan!.counts.total).toBeGreaterThanOrEqual(1);
    expect(payload.plan!.rows.map((r) => r.id)).toContain(SEEDED_SECRET.id);

    // Second former call site (`sys_setting`): `legacyInlineRows` is derived
    // from `settingRows` and from nothing else, so this value can only have
    // travelled through the second read.
    expect(payload.plan!.legacyInlineRows).toContainEqual(
      expect.objectContaining({ namespace: SEEDED_SETTING.namespace, key: SEEDED_SETTING.key }),
    );
  }, 180_000);
});
