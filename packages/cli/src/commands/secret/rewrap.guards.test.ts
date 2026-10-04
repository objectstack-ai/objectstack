// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * ADR-0128 §4.2 — the command-level guards of `os secret rewrap`, tested away
 * from the boot they normally sit behind.
 *
 * Each guard stops the run BEFORE a row is opened or written, and each one
 * stands in front of a property the planner alone cannot hold:
 *
 *  - an incomplete union under `--apply` is refused, naming the family, rather
 *    than re-wrapping rows whose producer was attributed from half the
 *    holders;
 *  - a driver with no conditional write is refused rather than written
 *    unconditionally, which could overwrite a value a producer wrote during
 *    the run;
 *  - no existing data key is refused, and ⛔ no key is minted: a minted key can
 *    open nothing that is stored, and a key file left behind would be picked
 *    up by the next boot of this host;
 *  - `--json --apply` without `--yes` is refused.
 *
 * Only the seams that would boot a database are replaced. The reference union,
 * the planner, the executor, `ciphertextDerivationStatus` and
 * `LocalCryptoProvider` all run for real.
 */

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { createCipheriv, randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ciphertextDerivationStatus } from '@objectstack/service-settings';
import SecretRewrap from './rewrap.js';
import { bootSchemaStack } from '../../utils/schema-migrate.js';

vi.mock('../../utils/schema-migrate.js', () => ({ bootSchemaStack: vi.fn() }));
// Constructed and handed to the (mocked) boot, never used.
vi.mock('@objectstack/platform-objects/plugin', () => ({ PlatformObjectsPlugin: class {} }));

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI_ROOT = resolve(HERE, '..', '..', '..');

type Row = Record<string, unknown>;

const KEY_HEX = '404142434445464748494a4b4c4d4e4f505152535455565758595a5b5c5d5e5f';

function sealVersion1(plain: string, namespace: string, key: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(KEY_HEX, 'hex'), iv);
  cipher.setAAD(Buffer.from([namespace, key].join('|'), 'utf8'));
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), enc]).toString('base64');
}

const SECRET_ID = 'sec_guard_settings';
const PLAIN = 'guarded-plaintext-value';

/** One version-1 row its settings holder references. */
function freshRows(): { secrets: Row[]; settings: Row[] } {
  return {
    secrets: [{
      id: SECRET_ID, namespace: 'smtp', key: 'password', kms_key_id: 'local:v1', alg: 'aes-256-gcm',
      version: 1, ciphertext: sealVersion1(PLAIN, 'smtp', 'password'),
    }],
    settings: [{ id: 'set_1', namespace: 'smtp', key: 'password', scope: 'tenant', user_id: null, value_enc: SECRET_ID }],
  };
}

interface Harness {
  secrets: Row[];
  writes: Array<{ where: Row; data: Row }>;
  /** Every table a driver read was issued for, in order. */
  reads: string[];
}

/**
 * Wire the mocked boot to a fake engine over `rows`.
 *
 * `absent` names the tables the boot MEASURED absent, which is what the stack's
 * `tableAbsent` answers (`SchemaStack.tableAbsent`). The default is none: every
 * table exists, as on a plain `--apply` boot, where nothing is deferred.
 */
function wireBoot(
  rows: { secrets: Row[]; settings: Row[] },
  opts: { conditionalWrite?: boolean; absent?: readonly string[] } = {},
): Harness {
  const harness: Harness = { secrets: rows.secrets, writes: [], reads: [] };
  const secretDriver: Record<string, unknown> = {
    async find() { harness.reads.push('sys_secret'); return harness.secrets.map((r) => ({ ...r })); },
  };
  if (opts.conditionalWrite !== false) {
    secretDriver.updateMany = async (_object: string, query: { where: Row }, data: Row) => {
      harness.writes.push({ where: query.where, data });
      let changed = 0;
      harness.secrets = harness.secrets.map((r) => {
        if (r.id !== query.where.id || r.ciphertext !== query.where.ciphertext) return r;
        changed += 1;
        return { ...r, ...data };
      });
      return changed;
    };
  }
  const engine = {
    getConfigs: () => ({}),
    listDatasourceDefs: () => [],
    getDriverForObject: (object: string) => {
      if (object === 'sys_secret') return secretDriver;
      if (object === 'sys_setting') {
        return { async find() { harness.reads.push('sys_setting'); return rows.settings.map((r) => ({ ...r })); } };
      }
      if (object === 'sys_metadata') return { async find() { harness.reads.push('sys_metadata'); return []; } };
      return undefined;
    },
  };
  const absent = new Set(opts.absent ?? []);
  vi.mocked(bootSchemaStack).mockResolvedValue({
    kernel: { getService: (name: string) => (name === 'objectql' ? engine : undefined) },
    tableAbsent: (objectName: string) => absent.has(objectName),
    shutdown: async () => {},
  } as never);
  return harness;
}

async function run(argv: string[]): Promise<{ payload: Record<string, any>; exitCode: number }> {
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
    await SecretRewrap.run(['--json', ...argv], { root: CLI_ROOT });
    exitCode = Number(process.exitCode ?? 0);
  } finally {
    stdout.mockRestore();
    process.exitCode = savedExitCode;
  }
  const lines = chunks.join('').split('\n').filter((l) => l.trim() !== '');
  return { payload: JSON.parse(lines[lines.length - 1]) as Record<string, any>, exitCode };
}

const KEY_ENV = ['OS_SECRET_KEY', 'OS_DEV_CRYPTO_KEY', 'OBJECTSTACK_DEV_CRYPTO_KEY', 'OS_HOME', 'OBJECTSTACK_HOME', 'OS_CRYPTO_AUTOKEY'] as const;
const savedEnv: Record<string, string | undefined> = {};
let home: string;

beforeEach(() => {
  for (const k of KEY_ENV) savedEnv[k] = process.env[k];
  for (const k of KEY_ENV) delete process.env[k];
  home = mkdtempSync(join(tmpdir(), 'os-rewrap-guards-'));
  // An empty key home: no persisted key file exists unless something mints one.
  process.env.OS_HOME = home;
  process.env.OS_SECRET_KEY = KEY_HEX;
});

afterEach(() => {
  for (const k of KEY_ENV) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  rmSync(home, { recursive: true, force: true });
  vi.mocked(bootSchemaStack).mockReset();
});

describe('os secret rewrap — guards that stop a run before any row is opened or written', () => {
  it('--apply over an INCOMPLETE union is refused, naming the family, and nothing is written', async () => {
    const h = wireBoot(freshRows());
    // No --no-declared-datasources: the host has not answered for its datasources.
    const { payload, exitCode } = await run(['--apply', '--yes']);

    expect(payload.error).toBe('union_incomplete');
    expect(payload.refused.gaps.map((g: { family: string }) => g.family)).toEqual(['datasource']);
    expect(payload.report.byClass.left_union_incomplete).toBe(1);
    expect(exitCode).toBe(1);
    expect(h.writes).toEqual([]);

    // POSITIVE CONTROL: the host answers, and the same run writes the row.
    const answered = wireBoot(freshRows());
    const ok = await run(['--apply', '--yes', '--no-declared-datasources']);
    expect(ok.payload.error).toBeUndefined();
    expect(ok.payload.report.counts.rewrap).toBe(1);
    expect(ok.exitCode).toBe(0);
    expect(answered.writes).toHaveLength(1);
    expect(ciphertextDerivationStatus(answered.secrets[0].ciphertext)).toBe('current');
  }, 60_000);

  it('a driver with no conditional write is refused before anything is opened or written', async () => {
    const h = wireBoot(freshRows(), { conditionalWrite: false });
    const before = JSON.stringify(h.secrets);
    const { payload, exitCode } = await run(['--apply', '--yes', '--no-declared-datasources']);

    expect(payload.error).toBe('driver_cannot_compare_and_set');
    expect(exitCode).toBe(1);
    expect(JSON.stringify(h.secrets)).toBe(before);
  }, 60_000);

  it('no existing data key is refused, and no key is minted', async () => {
    delete process.env.OS_SECRET_KEY;
    const h = wireBoot(freshRows());
    const { payload, exitCode } = await run(['--apply', '--yes', '--no-declared-datasources']);

    expect(payload.error).toBe('crypto_key_unavailable');
    expect(exitCode).toBe(1);
    expect(h.writes).toEqual([]);
    // The strict posture never writes a key file, whatever NODE_ENV says.
    expect(readdirSync(home)).toEqual([]);
    expect(existsSync(join(home, 'dev-crypto-key'))).toBe(false);

    // Even with the auto-key opt-in present in the environment.
    process.env.OS_CRYPTO_AUTOKEY = '1';
    const again = await run(['--no-declared-datasources']);
    expect(again.payload.error).toBe('crypto_key_unavailable');
    expect(readdirSync(home)).toEqual([]);
  }, 60_000);

  it('--json --apply without --yes is refused, and nothing is written', async () => {
    const h = wireBoot(freshRows());
    const { payload, exitCode } = await run(['--apply', '--no-declared-datasources']);

    expect(payload.error).toBe('confirmation_required');
    expect(exitCode).toBe(1);
    expect(h.writes).toEqual([]);
  }, 60_000);

  it('the dry run is the default: it writes nothing and prints classes and counts only', async () => {
    const h = wireBoot(freshRows());
    const before = JSON.stringify(h.secrets);
    const { payload, exitCode } = await run(['--no-declared-datasources']);

    expect(payload.mode).toBe('dry-run');
    expect(payload.report.counts).toEqual({ total: 1, rewrap: 1, done: 0, left: 0, refused: 0, notWritten: 0 });
    expect(payload.report.rewrapByScope).toEqual({ settings: 1, object_secret_field: 0, datasource_credential: 0 });
    expect(payload.report.keySource).toBe('env:OS_SECRET_KEY');
    expect(exitCode).toBe(0);
    expect(h.writes).toEqual([]);
    expect(JSON.stringify(h.secrets)).toBe(before);

    const text = JSON.stringify(payload);
    expect(text).not.toContain(PLAIN);
    expect(text).not.toContain(SECRET_ID);
    expect(text).not.toContain(String(h.secrets[0].ciphertext));
    expect(text).not.toContain(KEY_HEX);
  }, 60_000);

  it('a dry run over tables the boot measured absent reads none of them, and reports empty work', async () => {
    const h = wireBoot(freshRows(), { absent: ['sys_secret', 'sys_setting', 'sys_metadata'] });
    const { payload, exitCode } = await run(['--no-declared-datasources']);

    // "Not asked": a table that does not exist holds nothing, so no read is issued.
    expect(h.reads).toEqual([]);
    expect(payload.mode).toBe('dry-run');
    expect(payload.report.counts).toEqual({ total: 0, rewrap: 0, done: 0, left: 0, refused: 0, notWritten: 0 });
    // The union is enumerated, not gapped: an absent table holds no reference.
    for (const family of Object.values(payload.report.families) as Array<{ status: string }>) {
      expect(family.status).toBe('enumerated');
    }
    expect(payload.report.refusal).toBeNull();
    expect(exitCode).toBe(0);
    expect(h.writes).toEqual([]);

    // POSITIVE CONTROL: the same rows, tables present — they are read, and the row is planned.
    const present = wireBoot(freshRows());
    const ok = await run(['--no-declared-datasources']);
    expect(present.reads).toContain('sys_secret');
    expect(ok.payload.report.counts.total).toBe(1);
  }, 60_000);

  it('an unreadable --declared-datasources file is refused before the boot, never read as []', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'os-rewrap-ds-'));
    try {
      const file = join(dir, 'ds.json');
      writeFileSync(file, '{ not json');
      const { payload, exitCode } = await run(['--declared-datasources', file]);
      expect(payload.error).toBe('declared_datasources_unreadable');
      expect(exitCode).toBe(1);
      expect(vi.mocked(bootSchemaStack)).not.toHaveBeenCalled();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 60_000);
});
