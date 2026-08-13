// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DatabaseLoader, type DatabaseLoaderOptions } from './database-loader';
import type { IDataDriver } from '@objectstack/spec/contracts';
import { MetadataManager } from '../metadata-manager';
import { MemoryLoader } from './memory-loader';

// Suppress logger output during tests. Stable object (not a fresh one per
// `createLogger()` call) so the #5108 block can assert on what `list()` says
// when a loader cannot be read — the whole point of that fix is the log line.
const logger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('@objectstack/core', async (orig) => ({
  // [#7378] Spread the REAL module: MetadataManager now also imports the
  // shared register-contract guard from @objectstack/core, and a mock that
  // names only createLogger breaks on every export the class gains.
  ...((await orig()) as object),
  createLogger: () => logger,
}));

/**
 * In-memory IDataDriver mock for testing DatabaseLoader.
 * Stores records in a Map keyed by table name → id.
 */
function createMockDriver(): IDataDriver {
  const tables = new Map<string, Map<string, Record<string, unknown>>>();

  function getTable(name: string): Map<string, Record<string, unknown>> {
    if (!tables.has(name)) {
      tables.set(name, new Map());
    }
    return tables.get(name)!;
  }

  return {
    name: 'mock',
    version: '1.0.0',
    // An empty advertisement is a legal advertisement: every bit in
    // `DriverCapabilities` is optional, and this mock needs none of the three
    // that survive (#4782). The block used to spell nine — four RETIRED by
    // #4634 (`transactions`/`joins`/`streaming`/`fullTextSearch`, now
    // tombstoned as `never`) and five that were never keys of
    // `DriverCapabilitiesSchema` at all (`aggregations`/`bulkOperations`/
    // `nestedObjects`/`geoQueries`/`changeStreams`). Nothing here read any of
    // them; their only effect was to be copied into the next mock. Capability
    // is METHOD presence, not a boolean — do not re-add bits here.
    supports: {},

    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    checkHealth: vi.fn().mockResolvedValue(true),

    execute: vi.fn().mockResolvedValue(undefined),

    find: vi.fn().mockImplementation((tableName: string, query: any) => {
      const table = getTable(tableName);
      const where = query?.where ?? {};
      const fields = query?.fields as string[] | undefined;

      const results: Record<string, unknown>[] = [];
      for (const row of table.values()) {
        let match = true;
        for (const [key, val] of Object.entries(where)) {
          if (row[key] !== val) {
            match = false;
            break;
          }
        }
        if (match) {
          if (fields && fields.length > 0) {
            const partial: Record<string, unknown> = {};
            for (const f of fields) {
              partial[f] = row[f];
            }
            results.push(partial);
          } else {
            results.push({ ...row });
          }
        }
      }
      return Promise.resolve(results);
    }),

    findOne: vi.fn().mockImplementation((tableName: string, query: any) => {
      const table = getTable(tableName);
      const where = query?.where ?? {};

      for (const row of table.values()) {
        let match = true;
        for (const [key, val] of Object.entries(where)) {
          if (row[key] !== val) {
            match = false;
            break;
          }
        }
        if (match) return Promise.resolve({ ...row });
      }
      return Promise.resolve(null);
    }),


    create: vi.fn().mockImplementation((tableName: string, data: Record<string, unknown>) => {
      const table = getTable(tableName);
      const id = data.id as string;
      table.set(id, { ...data });
      return Promise.resolve({ ...data });
    }),

    update: vi.fn().mockImplementation((tableName: string, id: string, data: Record<string, unknown>) => {
      const table = getTable(tableName);
      const existing = table.get(id);
      if (!existing) throw new Error('Not found');
      const updated = { ...existing, ...data };
      table.set(id, updated);
      return Promise.resolve(updated);
    }),

    upsert: vi.fn().mockResolvedValue({}),

    delete: vi.fn().mockImplementation((tableName: string, id: string) => {
      const table = getTable(tableName);
      const existed = table.has(id);
      table.delete(id);
      return Promise.resolve(existed);
    }),

    count: vi.fn().mockImplementation((tableName: string, query: any) => {
      const table = getTable(tableName);
      const where = query?.where ?? {};

      let count = 0;
      for (const row of table.values()) {
        let match = true;
        for (const [key, val] of Object.entries(where)) {
          if (row[key] !== val) {
            match = false;
            break;
          }
        }
        if (match) count++;
      }
      return Promise.resolve(count);
    }),

    bulkCreate: vi.fn().mockResolvedValue([]),
    bulkUpdate: vi.fn().mockResolvedValue([]),
    bulkDelete: vi.fn().mockResolvedValue(undefined),

    beginTransaction: vi.fn().mockResolvedValue({}),
    commit: vi.fn().mockResolvedValue(undefined),
    rollback: vi.fn().mockResolvedValue(undefined),

    syncSchema: vi.fn().mockResolvedValue(undefined),
    dropTable: vi.fn().mockResolvedValue(undefined),
  };
}

// ---------- DatabaseLoader ----------

describe('DatabaseLoader', () => {
  let loader: DatabaseLoader;
  let mockDriver: IDataDriver;

  beforeEach(() => {
    mockDriver = createMockDriver();
    loader = new DatabaseLoader({ driver: mockDriver });
  });

  describe('contract', () => {
    it('should have correct contract metadata', () => {
      expect(loader.contract.name).toBe('database');
      expect(loader.contract.protocol).toBe('datasource:');
      expect(loader.contract.capabilities.read).toBe(true);
      expect(loader.contract.capabilities.write).toBe(true);
      expect(loader.contract.capabilities.watch).toBe(false);
      expect(loader.contract.capabilities.list).toBe(true);
    });
  });

  // [#6231] The driver takes the object name as argument ONE, and `DriverQuery`
  // is `Omit<QueryAST, 'object'>` — so the AST must never restate it. These
  // three read helpers used to spell `{ object: table, ...query } as any`, and
  // that cast did more than tolerate the redundant key: it switched off
  // checking for `where` / `orderBy` / `fields` as well, which is the account
  // #5181's changeset opened (cloud#1030's `$like` reached runtime through
  // exactly this hole). The redundant key is inert — no driver reads it — so
  // the pin is on the SHAPE the driver is handed, which is what a future
  // re-add would change.
  describe('driver query shape (#6231)', () => {
    it('never restates the object name inside the query AST', async () => {
      const seen: Array<{ method: string; table: unknown; query: unknown }> = [];
      for (const method of ['find', 'findOne', 'count'] as const) {
        const real = (mockDriver[method] as (...a: unknown[]) => unknown).bind(mockDriver);
        (mockDriver as unknown as Record<string, unknown>)[method] = (
          table: unknown,
          query: unknown,
          ...rest: unknown[]
        ) => {
          seen.push({ method, table, query });
          return real(table, query, ...rest);
        };
      }

      // Every read path the loader owns: findOne (load/stat), find (loadMany/
      // list) and count (exists).
      await loader.save('object', 'account', { name: 'account' });
      await loader.load('object', 'account');
      await loader.loadMany('object');
      await loader.exists('object', 'account');
      await loader.list('object');
      await loader.stat('object', 'account');

      expect(seen.length).toBeGreaterThan(0);
      for (const call of seen) {
        // The object name travels as argument one…
        expect(typeof call.table).toBe('string');
        // …and only there.
        expect(call.query ?? {}).not.toHaveProperty('object');
      }
    });
  });

  describe('schema bootstrapping', () => {
    it('should call syncSchema with SysMetadataObject on first operation', async () => {
      await loader.list('object');
      expect(mockDriver.syncSchema).toHaveBeenCalledOnce();
      expect(mockDriver.syncSchema).toHaveBeenCalledWith(
        'sys_metadata',
        expect.objectContaining({
          name: 'sys_metadata',
          isSystem: true,
          fields: expect.objectContaining({
            id: expect.objectContaining({ type: 'text' }),
            name: expect.objectContaining({ type: 'text' }),
            type: expect.objectContaining({ type: 'text' }),
            scope: expect.objectContaining({ type: 'select' }),
            metadata: expect.objectContaining({ type: 'textarea' }),
          }),
        })
      );
    });

    it('should only call syncSchema once (idempotent)', async () => {
      await loader.list('object');
      await loader.list('view');
      await loader.exists('object', 'account');
      expect(mockDriver.syncSchema).toHaveBeenCalledOnce();
    });

    it('should use custom table name', async () => {
      const customLoader = new DatabaseLoader({
        driver: mockDriver,
        tableName: 'custom_metadata',
      });
      await customLoader.list('object');
      expect(mockDriver.syncSchema).toHaveBeenCalledWith(
        'custom_metadata',
        expect.objectContaining({ name: 'custom_metadata' })
      );
    });
  });

  describe('save and load', () => {
    it('should save and load a metadata item', async () => {
      const data = { name: 'account', label: 'Account', fields: {} };
      await loader.save('object', 'account', data);

      const result = await loader.load('object', 'account');
      expect(result.data).toEqual(data);
      expect(result.source).toBe('database');
      expect(result.format).toBe('json');
    });

    it('should return null for non-existent item', async () => {
      const result = await loader.load('object', 'missing');
      expect(result.data).toBeNull();
    });

    it('should update existing item on re-save', async () => {
      await loader.save('object', 'account', { name: 'account', label: 'V1' });
      await loader.save('object', 'account', { name: 'account', label: 'V2' });

      const result = await loader.load('object', 'account');
      expect(result.data).toEqual({ name: 'account', label: 'V2' });
    });

    it('should return save result with path', async () => {
      const result = await loader.save('object', 'account', { name: 'account' });
      expect(result.success).toBe(true);
      expect(result.path).toBe('datasource://sys_metadata/object/account');
      expect(result.size).toBeGreaterThan(0);
      expect(result.saveTime).toBeDefined();
    });

    it('should increment version on update', async () => {
      await loader.save('object', 'account', { name: 'account' });
      await loader.save('object', 'account', { name: 'account', label: 'Updated' });

      // The update call should have been made with incremented version
      expect(mockDriver.update).toHaveBeenCalledWith(
        'sys_metadata',
        expect.any(String),
        expect.objectContaining({ version: 2 })
      );
    });
  });

  describe('exists', () => {
    it('should return false for non-existent items', async () => {
      expect(await loader.exists('object', 'nope')).toBe(false);
    });

    it('should return true for existing items', async () => {
      await loader.save('object', 'account', { name: 'account' });
      expect(await loader.exists('object', 'account')).toBe(true);
    });

    it('should differentiate between types', async () => {
      await loader.save('object', 'account', { name: 'account' });
      expect(await loader.exists('object', 'account')).toBe(true);
      expect(await loader.exists('view', 'account')).toBe(false);
    });
  });

  describe('list', () => {
    it('should return empty array for empty type', async () => {
      const items = await loader.list('object');
      expect(items).toEqual([]);
    });

    it('should list all items of a type', async () => {
      await loader.save('object', 'account', { name: 'account' });
      await loader.save('object', 'contact', { name: 'contact' });
      await loader.save('view', 'account_list', { name: 'account_list' });

      const objects = await loader.list('object');
      expect(objects).toHaveLength(2);
      expect(objects).toContain('account');
      expect(objects).toContain('contact');

      const views = await loader.list('view');
      expect(views).toHaveLength(1);
      expect(views).toContain('account_list');
    });
  });

  describe('loadMany', () => {
    it('should return empty array for unknown type', async () => {
      const items = await loader.loadMany('object');
      expect(items).toEqual([]);
    });

    it('should return all items of a type', async () => {
      await loader.save('object', 'account', { name: 'account' });
      await loader.save('object', 'contact', { name: 'contact' });

      const items = await loader.loadMany<{ name: string }>('object');
      expect(items).toHaveLength(2);
      expect(items.map(i => i.name)).toContain('account');
      expect(items.map(i => i.name)).toContain('contact');
    });

    it('should not include items from other types', async () => {
      await loader.save('object', 'account', { name: 'account' });
      await loader.save('view', 'account_list', { name: 'account_list' });

      const objects = await loader.loadMany('object');
      expect(objects).toHaveLength(1);
    });
  });

  describe('stat', () => {
    it('should return null for missing items', async () => {
      const stats = await loader.stat('object', 'missing');
      expect(stats).toBeNull();
    });

    it('should return stats for existing items', async () => {
      await loader.save('object', 'account', { name: 'account' });
      const stats = await loader.stat('object', 'account');
      expect(stats).not.toBeNull();
      expect(stats!.format).toBe('json');
      expect(stats!.size).toBeGreaterThan(0);
    });
  });

  describe('multi-tenant isolation', () => {
    it('should filter by organizationId when configured (environmentId accepted but ignored — ADR-0008 §0)', async () => {
      const tenantLoader = new DatabaseLoader({
        driver: mockDriver,
        organizationId: 'org-1',
        environmentId: 'env-1',
      });

      await tenantLoader.save('object', 'account', { name: 'account' });

      // The create call should include organization_id but NOT environment_id
      // (environment_id was removed from the metadata layer in the ADR-0008 §0
      // branch/project-removal amendment).
      expect(mockDriver.create).toHaveBeenCalledWith(
        'sys_metadata',
        expect.objectContaining({ organization_id: 'org-1' })
      );
      expect(mockDriver.create).not.toHaveBeenCalledWith(
        'sys_metadata',
        expect.objectContaining({ environment_id: expect.anything() })
      );

      // The find calls should filter by organization_id (no environment_id).
      await tenantLoader.load('object', 'account');
      expect(mockDriver.findOne).toHaveBeenCalledWith(
        'sys_metadata',
        expect.objectContaining({
          where: expect.objectContaining({ organization_id: 'org-1' }),
        })
      );
      const findOneCalls = (mockDriver.findOne as any).mock.calls;
      for (const [, opts] of findOneCalls) {
        expect((opts?.where ?? {})).not.toHaveProperty('environment_id');
      }
    });
  });

  describe('error handling', () => {
    // [#5108] These five used to assert the opposite — that a read failure is
    // answered with the method's empty value. That behaviour WAS the defect:
    // it made an unreachable `sys_metadata` byte-identical to "nothing of this
    // type was ever declared". The read seam now discriminates by error type
    // (see the dedicated #5108 block below for the benign half).
    it('should rethrow a read failure from load — an outage is not a miss', async () => {
      const failingDriver = createMockDriver();
      failingDriver.findOne = vi.fn().mockRejectedValue(new Error('DB error'));
      const failLoader = new DatabaseLoader({ driver: failingDriver });

      await expect(failLoader.load('object', 'account')).rejects.toThrow('DB error');
    });

    it('should rethrow a read failure from loadMany', async () => {
      const failingDriver = createMockDriver();
      failingDriver.find = vi.fn().mockRejectedValue(new Error('DB error'));
      const failLoader = new DatabaseLoader({ driver: failingDriver });

      await expect(failLoader.loadMany('object')).rejects.toThrow('DB error');
    });

    it('should rethrow a read failure from exists', async () => {
      const failingDriver = createMockDriver();
      failingDriver.count = vi.fn().mockRejectedValue(new Error('DB error'));
      const failLoader = new DatabaseLoader({ driver: failingDriver });

      await expect(failLoader.exists('object', 'account')).rejects.toThrow('DB error');
    });

    it('should rethrow a read failure from stat', async () => {
      const failingDriver = createMockDriver();
      failingDriver.findOne = vi.fn().mockRejectedValue(new Error('DB error'));
      const failLoader = new DatabaseLoader({ driver: failingDriver });

      await expect(failLoader.stat('object', 'account')).rejects.toThrow('DB error');
    });

    it('should rethrow a read failure from list', async () => {
      const failingDriver = createMockDriver();
      failingDriver.find = vi.fn().mockRejectedValue(new Error('DB error'));
      const failLoader = new DatabaseLoader({ driver: failingDriver });

      await expect(failLoader.list('object')).rejects.toThrow('DB error');
    });

    it('should throw descriptive error on save failure', async () => {
      const failingDriver = createMockDriver();
      failingDriver.findOne = vi.fn().mockResolvedValue(null);
      failingDriver.create = vi.fn().mockRejectedValue(new Error('Insert failed'));
      const failLoader = new DatabaseLoader({ driver: failingDriver });

      await expect(
        failLoader.save('object', 'account', { name: 'account' })
      ).rejects.toThrow('DatabaseLoader save failed for object/account: Insert failed');
    });
  });
});

// ---------- DDL failure is loud, and only "already exists" is silent ----------

/**
 * #4728 (rule: #4632, accident: #4420).
 *
 * `ensureSchema()` used to `catch {}` every DDL failure and set
 * `schemaReady = true` regardless — a total durability failure was byte-for-byte
 * indistinguishable from success, with no log line at all. The comment excused
 * *all* failure reasons with the most benign one ("e.g. table already exists").
 *
 * Both directions are pinned here on purpose: proving the real failure is loud
 * is not enough, because "always log error" would pass that alone while making
 * the benign case unreadable noise. The point is that the two are DISTINGUISHED.
 */
describe('DatabaseLoader schema-sync failure reporting (#4728)', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let infoSpy: ReturnType<typeof vi.spyOn>;

  /** A real DDL failure: the table does NOT exist afterwards. */
  const permissionDenied = () =>
    Object.assign(new Error('permission denied for schema public'), { code: '42501' });

  /** The one benign reason: the table IS already provisioned. */
  const alreadyExists = () =>
    Object.assign(new Error('table sys_metadata already exists'), { code: 'SQLITE_ERROR' });

  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
    infoSpy.mockRestore();
  });

  describe('a REAL DDL failure', () => {
    it('reports at error, naming the consequence and the fix', async () => {
      const driver = createMockDriver();
      driver.syncSchema = vi.fn().mockRejectedValue(permissionDenied());
      const loader = new DatabaseLoader({ driver });

      await loader.list('object');

      expect(errorSpy).toHaveBeenCalledTimes(1);
      const [message, cause] = errorSpy.mock.calls[0] as [string, unknown];
      // consequence
      expect(message).toContain('sys_metadata');
      expect(message).toContain('FAILED');
      expect(message).toContain('NOT created');
      // the system keeps looking healthy — that is the whole point of the level
      expect(message).toMatch(/reporting healthy/i);
      // fix
      expect(message).toMatch(/fix it and restart/i);
      // and the underlying driver error is carried, not discarded
      expect((cause as Error).message).toBe('permission denied for schema public');
    });

    it('does NOT mark the schema ready — the next operation retries the DDL', async () => {
      const driver = createMockDriver();
      driver.syncSchema = vi.fn().mockRejectedValue(permissionDenied());
      const loader = new DatabaseLoader({ driver });

      await loader.list('object');
      await loader.list('view');
      await loader.exists('object', 'account');

      // Before #4728 this was 1: the failure set `schemaReady = true` and every
      // later write proceeded against a table that was never created.
      expect(driver.syncSchema).toHaveBeenCalledTimes(3);
    });

    it('says it once, not once per operation', async () => {
      const driver = createMockDriver();
      driver.syncSchema = vi.fn().mockRejectedValue(permissionDenied());
      const loader = new DatabaseLoader({ driver });

      await loader.list('object');
      await loader.list('view');
      await loader.list('flow');

      expect(errorSpy).toHaveBeenCalledTimes(1);
    });

    it('recovers silently-loudly: a transient failure that heals reports the recovery', async () => {
      const driver = createMockDriver();
      driver.syncSchema = vi
        .fn()
        .mockRejectedValueOnce(
          Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), {
            code: 'ECONNREFUSED',
          }),
        )
        .mockResolvedValue(undefined);
      const loader = new DatabaseLoader({ driver });

      await loader.list('object'); // datasource still connecting → loud
      await loader.list('view'); // retried → succeeds

      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(infoSpy).toHaveBeenCalledTimes(1);
      expect((infoSpy.mock.calls[0] as [string])[0]).toMatch(/succeeded on retry/i);

      // Ready now, so a third operation does not re-run the DDL.
      await loader.list('flow');
      expect(driver.syncSchema).toHaveBeenCalledTimes(2);
    });
  });

  describe('the benign "already exists" failure', () => {
    it('is silent — no error, no info', async () => {
      const driver = createMockDriver();
      driver.syncSchema = vi.fn().mockRejectedValue(alreadyExists());
      const loader = new DatabaseLoader({ driver });

      await loader.list('object');

      expect(errorSpy).not.toHaveBeenCalled();
      expect(infoSpy).not.toHaveBeenCalled();
    });

    it('marks the schema ready — the table is provisioned, so no retry', async () => {
      const driver = createMockDriver();
      driver.syncSchema = vi.fn().mockRejectedValue(alreadyExists());
      const loader = new DatabaseLoader({ driver });

      await loader.list('object');
      await loader.list('view');

      expect(driver.syncSchema).toHaveBeenCalledTimes(1);
    });

    it('still runs the post-sync migrations (the table exists, so they apply)', async () => {
      const driver = createMockDriver();
      driver.syncSchema = vi.fn().mockRejectedValue(alreadyExists());
      const raw = vi.fn().mockResolvedValue(undefined);
      (driver as unknown as { raw: unknown }).raw = raw;
      const loader = new DatabaseLoader({ driver });

      await loader.list('object');

      // The `project_id` → `environment_id` forward migration still runs; it
      // probes the column list before touching anything.
      expect(raw).toHaveBeenCalled();
      expect(raw.mock.calls.some(([sql]) => /table_info|information_schema/i.test(String(sql)))).toBe(
        true,
      );
    });

    /**
     * #6771 — this path is precisely where the removed producer was NOT a
     * no-op. `syncSchema` threw "already exists" BEFORE materializing the
     * declared indexes, so `idx_sys_metadata_overlay_active` was unclaimed and
     * the loader's own `CREATE UNIQUE INDEX IF NOT EXISTS` won it — with the
     * pre-ADR-0048 key `(type, name, organization_id, environment_id, scope)`.
     * `syncDeclaredIndexes` skips by name, so nothing ever repaired it.
     */
    it('issues NO overlay-index DDL — this package is not a producer of that name', async () => {
      const driver = createMockDriver();
      driver.syncSchema = vi.fn().mockRejectedValue(alreadyExists());
      const raw = vi.fn().mockResolvedValue(undefined);
      (driver as unknown as { raw: unknown }).raw = raw;
      const loader = new DatabaseLoader({ driver });

      await loader.list('object');

      const overlayDdl = raw.mock.calls
        .map(([sql]) => String(sql))
        .filter((sql) => /idx_sys_metadata_overlay_active/i.test(sql));
      expect(overlayDdl).toEqual([]);
    });
  });

  it('DISTINGUISHES the two: same call site, opposite verdicts', async () => {
    const benignDriver = createMockDriver();
    benignDriver.syncSchema = vi.fn().mockRejectedValue(alreadyExists());
    const realDriver = createMockDriver();
    realDriver.syncSchema = vi.fn().mockRejectedValue(permissionDenied());

    await new DatabaseLoader({ driver: benignDriver }).list('object');
    const afterBenign = errorSpy.mock.calls.length;

    await new DatabaseLoader({ driver: realDriver }).list('object');
    const afterReal = errorSpy.mock.calls.length;

    expect(afterBenign).toBe(0);
    expect(afterReal).toBe(1);
  });

  describe('the history table follows the same rule', () => {
    /** sys_metadata syncs fine; only the history table's DDL fails. */
    function driverWithFailingHistoryDdl(error: unknown): IDataDriver {
      const driver = createMockDriver();
      driver.syncSchema = vi.fn().mockImplementation((table: string) => {
        if (table === 'sys_metadata_history') return Promise.reject(error);
        return Promise.resolve(undefined);
      });
      return driver;
    }

    it('reports a real failure at error, naming the lost audit trail and the fix', async () => {
      const driver = driverWithFailingHistoryDdl(permissionDenied());
      const loader = new DatabaseLoader({ driver });

      await loader.save('object', 'account', { name: 'account' });

      expect(errorSpy).toHaveBeenCalledTimes(1);
      const message = (errorSpy.mock.calls[0] as [string])[0];
      expect(message).toContain('sys_metadata_history');
      expect(message).toMatch(/will NOT be persisted/);
      expect(message).toMatch(/restart/i);
    });

    it('is silent on "already exists" and stops retrying', async () => {
      const driver = driverWithFailingHistoryDdl(
        Object.assign(new Error("Table 'sys_metadata_history' already exists"), {
          code: 'ER_TABLE_EXISTS_ERROR',
        }),
      );
      const loader = new DatabaseLoader({ driver });

      await loader.save('object', 'account', { name: 'account' });
      await loader.save('object', 'contact', { name: 'contact' });

      expect(errorSpy).not.toHaveBeenCalled();
      const historySyncs = (driver.syncSchema as ReturnType<typeof vi.fn>).mock.calls.filter(
        ([table]) => table === 'sys_metadata_history',
      );
      expect(historySyncs).toHaveLength(1);
    });
  });
});

// ---------- event_seq is never invented from a read that failed ----------

/**
 * #4825 (same family as #4728, rule: #4632).
 *
 * `nextEventSeq()` used to `catch { return 1 }`, with a comment naming BOTH
 * "table not provisioned yet" (benign) and "driver error" (not benign). With N
 * rows already in `sys_metadata_history`, one flaky read therefore handed the
 * next row `event_seq = 1` — colliding with an existing row while the insert
 * SUCCEEDED and nothing was logged.
 *
 * That is why these tests assert on the VALUE that lands, not merely on whether
 * a write happened: the damage here is not a missing row, it is a written row
 * carrying a wrong number, which no retry and no restart repairs.
 *
 * Both directions are pinned, plus a same-call-site/opposite-verdict case — a
 * suite proving only the loud half would pass on a `() => true` classifier,
 * which is the bug, and one proving only the benign half would pass on the
 * `catch { return 1 }` being replaced.
 */
describe('DatabaseLoader event_seq on a failed history read (#4825)', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  let infoSpy: ReturnType<typeof vi.spyOn>;

  /** Benign: nothing has been provisioned, so there is no row to collide with. */
  const noSuchTable = () =>
    Object.assign(new Error('no such table: sys_metadata_history'), { code: 'SQLITE_ERROR' });

  /** NOT benign: the rows are still there, this read just did not see them. */
  const connectionReset = () =>
    Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' });

  /** Every `event_seq` this driver was asked to persist, in order. */
  function historySeqsWritten(driver: IDataDriver): unknown[] {
    const calls = (driver.create as ReturnType<typeof vi.fn>).mock.calls as unknown[][];
    return calls
      .filter((call: unknown[]) => call[0] === 'sys_metadata_history')
      .map((call: unknown[]) => (call[1] as Record<string, unknown>).event_seq);
  }

  /** The mock driver's own `find`, still callable after we wrap it. */
  type DriverFind = (table: string, query: unknown) => Promise<Record<string, unknown>[]>;

  /**
   * A driver whose reads of the HISTORY table fail while `broken` — writes and
   * the `sys_metadata` table keep working throughout, which is exactly what
   * makes the defect invisible in production.
   */
  function driverWithBreakableHistoryReads(makeError: () => unknown, startBroken = false) {
    const driver = createMockDriver();
    const realFind = driver.find as DriverFind;
    let broken = startBroken;
    driver.find = vi.fn().mockImplementation((table: string, query: unknown) => {
      if (broken && table === 'sys_metadata_history') return Promise.reject(makeError());
      return realFind(table, query);
    });
    return {
      driver,
      breakReads: () => {
        broken = true;
      },
      healReads: () => {
        broken = false;
      },
    };
  }

  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
    infoSpy.mockRestore();
  });

  describe('the benign case — the history table is not provisioned yet', () => {
    it('numbers from 1 and stays silent', async () => {
      const { driver } = driverWithBreakableHistoryReads(noSuchTable, true);
      const loader = new DatabaseLoader({ driver });

      await loader.save('object', 'account', { name: 'account' });

      expect(historySeqsWritten(driver)).toEqual([1]);
      expect(errorSpy).not.toHaveBeenCalled();
      expect(infoSpy).not.toHaveBeenCalled();
    });
  });

  describe('a REAL read failure against a table that already has rows', () => {
    it('does NOT restart at 1 — no colliding row is written at all', async () => {
      const { driver, breakReads } = driverWithBreakableHistoryReads(connectionReset);
      const loader = new DatabaseLoader({ driver });

      // Build real history first: two rows, event_seq 1 and 2.
      await loader.save('object', 'account', { name: 'account' });
      await loader.save('object', 'contact', { name: 'contact' });
      expect(historySeqsWritten(driver)).toEqual([1, 2]);

      breakReads();
      await loader.save('object', 'lead', { name: 'lead' });

      // Before #4825 this was [1, 2, 1] — a duplicate `event_seq` written
      // successfully, silently, over the top of an existing row's number.
      expect(historySeqsWritten(driver)).toEqual([1, 2]);
    });

    it('reports at error, naming the consequence, the deliberate skip, and the fix', async () => {
      const { driver, breakReads } = driverWithBreakableHistoryReads(connectionReset);
      const loader = new DatabaseLoader({ driver });

      await loader.save('object', 'account', { name: 'account' });
      breakReads();
      await loader.save('object', 'lead', { name: 'lead' });

      expect(errorSpy).toHaveBeenCalledTimes(1);
      const [message, cause] = errorSpy.mock.calls[0] as [string, unknown];
      expect(message).toContain('sys_metadata_history');
      expect(message).toContain('event_seq');
      // consequence: the row is gone AND the system keeps looking fine
      expect(message).toMatch(/NOT written/);
      expect(message).toMatch(/SUCCEEDED/);
      expect(message).toMatch(/looking healthy/i);
      // why a hole is preferable to a wrong number
      expect(message).toMatch(/collide/i);
      // fix
      expect(message).toMatch(/fix the datasource\/driver error/i);
      // and the driver error is carried, not discarded
      expect((cause as Error).message).toBe('read ECONNRESET');
    });

    it('does not fail the metadata write it accompanies', async () => {
      const { driver, breakReads } = driverWithBreakableHistoryReads(connectionReset);
      const loader = new DatabaseLoader({ driver });

      breakReads();
      const result = await loader.save('object', 'account', { name: 'account' });

      // The record write already happened; reporting it as failed would be a
      // worse lie than the one being fixed. The history hole is what is loud.
      expect(result.success).toBe(true);
      expect((await loader.load('object', 'account')).data).toEqual({ name: 'account' });
    });

    it('says it once, not once per skipped entry, and reports recovery', async () => {
      const { driver, breakReads, healReads } = driverWithBreakableHistoryReads(connectionReset);
      const loader = new DatabaseLoader({ driver });

      await loader.save('object', 'account', { name: 'account' });
      breakReads();
      await loader.save('object', 'contact', { name: 'contact' });
      await loader.save('object', 'lead', { name: 'lead' });
      expect(errorSpy).toHaveBeenCalledTimes(1);

      healReads();
      await loader.save('object', 'deal', { name: 'deal' });

      expect(errorSpy).toHaveBeenCalledTimes(1);
      expect(infoSpy).toHaveBeenCalledTimes(1);
      expect((infoSpy.mock.calls[0] as [string])[0]).toMatch(/readable again/i);
      // Numbering resumes after the surviving max (1), never from 1 again.
      expect(historySeqsWritten(driver)).toEqual([1, 2]);
    });
  });

  it('DISTINGUISHES the two: same call site, opposite verdicts', async () => {
    const { driver: benignDriver } = driverWithBreakableHistoryReads(noSuchTable, true);
    const { driver: realDriver } = driverWithBreakableHistoryReads(connectionReset, true);

    await new DatabaseLoader({ driver: benignDriver }).save('object', 'account', { name: 'a' });
    await new DatabaseLoader({ driver: realDriver }).save('object', 'account', { name: 'a' });

    // Benign: numbered, written, silent. Real: not numbered, not written, loud.
    expect(historySeqsWritten(benignDriver)).toEqual([1]);
    expect(historySeqsWritten(realDriver)).toEqual([]);
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });

  it('applies to the rollback history path too, not just save()', async () => {
    const { driver, breakReads } = driverWithBreakableHistoryReads(connectionReset);
    const loader = new DatabaseLoader({ driver });

    await loader.save('object', 'account', { name: 'account' });
    await loader.save('object', 'account', { name: 'account', label: 'Account' });
    expect(historySeqsWritten(driver)).toEqual([1, 2]);

    breakReads();
    await loader.registerRollback('object', 'account', { name: 'account' }, 1);

    expect(historySeqsWritten(driver)).toEqual([1, 2]);
    expect(errorSpy).toHaveBeenCalledTimes(1);
  });
});

// ---------- A storage read failure is never answered as "nothing declared" ----------

/**
 * #5108 (rule: #4632; same shape one layer up from #4825, ADR-0110 D3).
 *
 * Every read method used to `catch {}` into its own empty value, so a
 * `sys_metadata` the metadata plane could not reach returned EXACTLY what "this
 * environment declares nothing of that type" returns — `[]`, `false`, `null` —
 * with not one line logged anywhere on the chain. `MetadataManager`'s own
 * degradation branches could not fire either, because the loader handed them a
 * *successful* empty read rather than an exception.
 *
 * Both directions are pinned, deliberately, exactly as #4728/#4825 pin theirs:
 * proving the outage is loud is not enough, because "always throw" would pass
 * that alone while making a first boot against an unprovisioned table explode.
 * The point is that the two are DISTINGUISHED.
 */
describe('DatabaseLoader read failures are outages, not misses (#5108)', () => {
  /** Benign: nothing provisioned yet, so "nothing declared" really is true. */
  const noSuchTable = () =>
    Object.assign(new Error('no such table: sys_metadata'), { code: 'SQLITE_ERROR' });

  /** NOT benign: the rows are there, this read simply did not see them. */
  const connectionReset = () =>
    Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' });

  /**
   * A driver whose reads of `sys_metadata` fail the way a real outage does.
   * `syncSchema` still succeeds — the table was provisioned at boot and the
   * datasource fell over afterwards, which is what makes the defect invisible.
   */
  function driverWithFailingReads(makeError: () => unknown): IDataDriver {
    const driver = createMockDriver();
    driver.find = vi.fn().mockImplementation(() => Promise.reject(makeError()));
    driver.findOne = vi.fn().mockImplementation(() => Promise.reject(makeError()));
    driver.count = vi.fn().mockImplementation(() => Promise.reject(makeError()));
    return driver;
  }

  describe('a REAL outage — the driver is reachable but the read failed', () => {
    let loader: DatabaseLoader;

    beforeEach(() => {
      loader = new DatabaseLoader({ driver: driverWithFailingReads(connectionReset) });
    });

    it('loadMany rethrows instead of answering []', async () => {
      await expect(loader.loadMany('permission')).rejects.toThrow('read ECONNRESET');
    });

    it('exists rethrows instead of answering false', async () => {
      await expect(loader.exists('permission', 'admin_all')).rejects.toThrow('read ECONNRESET');
    });

    it('stat rethrows instead of answering null', async () => {
      await expect(loader.stat('permission', 'admin_all')).rejects.toThrow('read ECONNRESET');
    });

    it('list rethrows instead of answering []', async () => {
      await expect(loader.list('permission')).rejects.toThrow('read ECONNRESET');
    });

    it('load rethrows too — ADR-0110 D3 needs the singular read to fail loudly', async () => {
      await expect(loader.load('permission', 'admin_all')).rejects.toThrow('read ECONNRESET');
    });

    it('carries the driver error unchanged, so the cause is diagnosable', async () => {
      const thrown = await loader.loadMany('permission').catch((e: unknown) => e);
      expect((thrown as { code?: string }).code).toBe('ECONNRESET');
    });

    it('does not poison the cache with the failed read', async () => {
      await expect(loader.loadMany('permission')).rejects.toThrow();
      // A retry must hit the driver again rather than serve a memoized [].
      await expect(loader.loadMany('permission')).rejects.toThrow();
    });
  });

  describe('the benign case — `sys_metadata` has not been provisioned yet', () => {
    let loader: DatabaseLoader;

    beforeEach(() => {
      loader = new DatabaseLoader({ driver: driverWithFailingReads(noSuchTable) });
    });

    it('answers empty rather than exploding on a first boot', async () => {
      await expect(loader.loadMany('permission')).resolves.toEqual([]);
      await expect(loader.list('permission')).resolves.toEqual([]);
      await expect(loader.exists('permission', 'admin_all')).resolves.toBe(false);
      await expect(loader.stat('permission', 'admin_all')).resolves.toBeNull();
      await expect(loader.load('permission', 'admin_all')).resolves.toMatchObject({ data: null });
    });

    it('does not memoize the empty answer — the table may appear next call', async () => {
      const driver = createMockDriver();
      let provisioned = false;
      const realFind = driver.find as unknown as (t: string, q: unknown) => Promise<Record<string, unknown>[]>;
      driver.find = vi.fn().mockImplementation((table: string, query: unknown) => {
        if (!provisioned) return Promise.reject(noSuchTable());
        return realFind(table, query);
      });
      const healing = new DatabaseLoader({ driver });

      expect(await healing.list('permission')).toEqual([]);

      provisioned = true;
      await healing.save('permission', 'admin_all', { name: 'admin_all' });
      expect(await healing.list('permission')).toEqual(['admin_all']);
    });
  });

  it('DISTINGUISHES the two: same call site, opposite verdicts', async () => {
    const benign = new DatabaseLoader({ driver: driverWithFailingReads(noSuchTable) });
    const real = new DatabaseLoader({ driver: driverWithFailingReads(connectionReset) });

    expect(await benign.loadMany('permission')).toEqual([]);
    await expect(real.loadMany('permission')).rejects.toThrow('read ECONNRESET');
  });

  describe('what the manager on top of it can finally say', () => {
    beforeEach(() => {
      logger.error.mockClear();
      logger.info.mockClear();
      logger.warn.mockClear();
    });

    function managerOverBrokenDb(): MetadataManager {
      const manager = new MetadataManager({ formats: ['json'], loaders: [new MemoryLoader()] });
      manager.registerLoader(
        new DatabaseLoader({ driver: driverWithFailingReads(connectionReset) }),
      );
      return manager;
    }

    it('list() keeps serving what it can, and reports the outage at `error`', async () => {
      const manager = managerOverBrokenDb();
      manager.registerInMemory('permission', 'from_code', { name: 'from_code' });

      const items = await manager.list('permission');
      // Best-effort listing survives — that posture is deliberate.
      expect(items).toEqual([{ name: 'from_code' }]);

      // …but it is no longer silent. AGENTS.md → "Degradation log levels":
      // the system looks normal while the set it gates on is short → `error`.
      expect(logger.error).toHaveBeenCalledTimes(1);
      expect(logger.warn).not.toHaveBeenCalled();
      const [message] = logger.error.mock.calls[0] as [string];
      expect(message).toContain('database');
      expect(message).toContain('permission');
      expect(message).toMatch(/PARTIAL/);
      expect(message).toMatch(/never declared/i);
      expect(message).toMatch(/reporting healthy/i);
      expect(message).toMatch(/Fix:/);
    });

    it('says it once per outage, not once per read', async () => {
      const manager = managerOverBrokenDb();

      await manager.list('permission');
      await manager.list('view');
      await manager.list('flow');

      expect(logger.error).toHaveBeenCalledTimes(1);
    });

    it('the sibling plural read, loadMany(), reports at the same level', async () => {
      const manager = managerOverBrokenDb();

      await expect(manager.loadMany('permission')).resolves.toEqual([]);
      expect(logger.error).toHaveBeenCalledTimes(1);
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it('un-says it when the loader becomes readable again', async () => {
      const driver = createMockDriver();
      let broken = true;
      const realFind = driver.find as unknown as (t: string, q: unknown) => Promise<Record<string, unknown>[]>;
      driver.find = vi.fn().mockImplementation((table: string, query: unknown) => {
        if (broken) return Promise.reject(connectionReset());
        return realFind(table, query);
      });
      const manager = new MetadataManager({ formats: ['json'], loaders: [] });
      manager.registerLoader(new DatabaseLoader({ driver, cache: { enabled: false } }));

      await manager.loadMany('permission');
      expect(logger.error).toHaveBeenCalledTimes(1);

      broken = false;
      await manager.loadMany('permission');
      expect(logger.error).toHaveBeenCalledTimes(1);
      expect(logger.info.mock.calls.map(c => c[0]).join()).toMatch(/readable again/i);
    });

    it('loadDiagnosed reports `degraded` — ADR-0110 D3 now holds for the DB loader', async () => {
      const manager = managerOverBrokenDb();

      const diagnosed = await manager.loadDiagnosed('permission', 'admin_all');
      expect(diagnosed.data).toBeNull();
      expect(diagnosed.degraded).toBe(true);
      expect(diagnosed.errors.join()).toContain('read ECONNRESET');
    });

    it('a clean miss is still NOT degraded — the distinction is the point', async () => {
      const manager = new MetadataManager({ formats: ['json'], loaders: [new MemoryLoader()] });
      manager.registerLoader(new DatabaseLoader({ driver: createMockDriver() }));

      const diagnosed = await manager.loadDiagnosed('permission', 'never_declared');
      expect(diagnosed.data).toBeNull();
      expect(diagnosed.degraded).toBe(false);
      expect(logger.error).not.toHaveBeenCalled();
    });

    /**
     * The reason #5108 was split out of #5089. `listForIndex()` was written
     * without a `try/catch` precisely so an unreadable store could not be
     * served as "no endpoint declares this route" — but that only worked for
     * loaders that actually report their failures. Against a real
     * `DatabaseLoader` the seam was inert: the loader swallowed first, so
     * `matchEndpoint` answered `undefined`, which the REST layer turns into a
     * 404 — an availability failure rendered as a semantic "not declared".
     */
    it('matchEndpoint REJECTS on a broken DatabaseLoader instead of 404-shaped undefined', async () => {
      const manager = managerOverBrokenDb();

      await expect(
        manager.matchEndpoint({ method: 'GET', path: '/api/v1/apps/showcase/tasks' }),
      ).rejects.toThrow('read ECONNRESET');
    });

    it('…even when the endpoint IS declared in another, healthy loader', async () => {
      const manager = managerOverBrokenDb();
      manager.registerInMemory('api', 'list_tasks', {
        name: 'list_tasks',
        path: '/api/v1/apps/showcase/tasks',
        method: 'GET',
        type: 'object_operation',
        target: 'showcase_task',
      });

      // A partial read cannot prove the match it found is the right one.
      await expect(
        manager.matchEndpoint({ method: 'GET', path: '/api/v1/apps/showcase/tasks' }),
      ).rejects.toThrow('read ECONNRESET');
    });

    it('an unprovisioned table is NOT an outage — matchEndpoint still answers a clean miss', async () => {
      const manager = new MetadataManager({ formats: ['json'], loaders: [new MemoryLoader()] });
      manager.registerLoader(new DatabaseLoader({ driver: driverWithFailingReads(noSuchTable) }));

      await expect(
        manager.matchEndpoint({ method: 'GET', path: '/api/v1/apps/showcase/tasks' }),
      ).resolves.toBeUndefined();
      expect(logger.error).not.toHaveBeenCalled();
    });
  });
});

// ---------- DatabaseLoader read-through cache ----------

describe('DatabaseLoader read-through cache', () => {
  let mockDriver: IDataDriver;

  beforeEach(() => {
    mockDriver = createMockDriver();
  });

  it('serves a second load() from cache without re-querying the driver', async () => {
    const loader = new DatabaseLoader({ driver: mockDriver });
    await loader.save('object', 'account', { name: 'account', label: 'Account' });

    // findOne calls so far: save() did one lookup before insert.
    const baseline = (mockDriver.findOne as ReturnType<typeof vi.fn>).mock.calls.length;

    const first = await loader.load('object', 'account');
    expect(first.data).toEqual({ name: 'account', label: 'Account' });

    const callsAfterFirst = (mockDriver.findOne as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(callsAfterFirst).toBe(baseline + 1);

    const second = await loader.load('object', 'account');
    expect(second.data).toEqual({ name: 'account', label: 'Account' });

    // Second load should be a cache hit — no additional findOne.
    expect((mockDriver.findOne as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsAfterFirst);

    const stats = loader.getCacheStats();
    expect(stats.enabled).toBe(true);
    expect(stats.load!.hits).toBeGreaterThanOrEqual(1);
  });

  it('caches null (not-found) results to absorb miss storms', async () => {
    const loader = new DatabaseLoader({ driver: mockDriver });

    const first = await loader.load('object', 'ghost');
    expect(first.data).toBeNull();
    const callsAfterFirst = (mockDriver.findOne as ReturnType<typeof vi.fn>).mock.calls.length;

    const second = await loader.load('object', 'ghost');
    expect(second.data).toBeNull();

    // No additional findOne — the negative result is cached.
    expect((mockDriver.findOne as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsAfterFirst);
  });

  it('save() invalidates the (type, name) load cache', async () => {
    const loader = new DatabaseLoader({ driver: mockDriver });

    await loader.save('object', 'account', { name: 'account', label: 'V1' });
    const v1 = await loader.load('object', 'account');
    expect((v1.data as any).label).toBe('V1');

    await loader.save('object', 'account', { name: 'account', label: 'V2' });
    const v2 = await loader.load('object', 'account');
    expect((v2.data as any).label).toBe('V2');
  });

  it('save() invalidates a previously cached null entry (negative → positive)', async () => {
    const loader = new DatabaseLoader({ driver: mockDriver });

    expect((await loader.load('object', 'account')).data).toBeNull();

    await loader.save('object', 'account', { name: 'account', label: 'Created' });
    const after = await loader.load('object', 'account');
    expect(after.data).toEqual({ name: 'account', label: 'Created' });
  });

  it('caches loadMany() per type and invalidates on save', async () => {
    const loader = new DatabaseLoader({ driver: mockDriver });

    await loader.save('object', 'a', { name: 'a' });
    const findCallsBefore = (mockDriver.find as ReturnType<typeof vi.fn>).mock.calls.length;

    const first = await loader.loadMany('object');
    expect(first).toHaveLength(1);
    const findCallsAfterFirst = (mockDriver.find as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(findCallsAfterFirst).toBe(findCallsBefore + 1);

    // Second loadMany hits cache.
    const second = await loader.loadMany('object');
    expect(second).toHaveLength(1);
    expect((mockDriver.find as ReturnType<typeof vi.fn>).mock.calls.length).toBe(findCallsAfterFirst);

    // A save on the same type invalidates the loadMany cache.
    await loader.save('object', 'b', { name: 'b' });
    const third = await loader.loadMany('object');
    expect(third).toHaveLength(2);
  });

  it('caches list() per type independently of load()', async () => {
    const loader = new DatabaseLoader({ driver: mockDriver });

    await loader.save('object', 'a', { name: 'a' });
    await loader.save('object', 'b', { name: 'b' });

    const findCallsBefore = (mockDriver.find as ReturnType<typeof vi.fn>).mock.calls.length;
    const first = await loader.list('object');
    expect(first).toEqual(expect.arrayContaining(['a', 'b']));
    const findCallsAfterFirst = (mockDriver.find as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(findCallsAfterFirst).toBe(findCallsBefore + 1);

    // Second list() is a cache hit.
    await loader.list('object');
    expect((mockDriver.find as ReturnType<typeof vi.fn>).mock.calls.length).toBe(findCallsAfterFirst);

    // A save on the same type invalidates the list cache.
    await loader.save('object', 'c', { name: 'c' });
    const refreshed = await loader.list('object');
    expect(refreshed).toEqual(expect.arrayContaining(['a', 'b', 'c']));
  });

  it('caches stat() per (type, name)', async () => {
    const loader = new DatabaseLoader({ driver: mockDriver });
    await loader.save('object', 'account', { name: 'account' });

    const baseline = (mockDriver.findOne as ReturnType<typeof vi.fn>).mock.calls.length;
    const s1 = await loader.stat('object', 'account');
    expect(s1).not.toBeNull();
    const afterFirst = (mockDriver.findOne as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(afterFirst).toBe(baseline + 1);

    await loader.stat('object', 'account');
    expect((mockDriver.findOne as ReturnType<typeof vi.fn>).mock.calls.length).toBe(afterFirst);
  });

  it('delete() invalidates the load cache', async () => {
    const loader = new DatabaseLoader({ driver: mockDriver });
    await loader.save('object', 'account', { name: 'account' });
    expect((await loader.load('object', 'account')).data).not.toBeNull();

    await loader.delete('object', 'account');
    const after = await loader.load('object', 'account');
    expect(after.data).toBeNull();
  });

  it('disables caching when cache.enabled === false', async () => {
    const loader = new DatabaseLoader({ driver: mockDriver, cache: { enabled: false } });
    await loader.save('object', 'account', { name: 'account' });

    const before = (mockDriver.findOne as ReturnType<typeof vi.fn>).mock.calls.length;
    await loader.load('object', 'account');
    await loader.load('object', 'account');
    const after = (mockDriver.findOne as ReturnType<typeof vi.fn>).mock.calls.length;
    // Both load() calls reach the driver.
    expect(after - before).toBe(2);

    const stats = loader.getCacheStats();
    expect(stats.enabled).toBe(false);
    expect(stats.load).toBeNull();
  });

  it('honors custom maxSize/ttl via cache options', async () => {
    const loader = new DatabaseLoader({
      driver: mockDriver,
      cache: { enabled: true, maxSize: 1, ttl: 60_000 },
    });
    await loader.save('object', 'a', { name: 'a' });
    await loader.save('object', 'b', { name: 'b' });

    // Prime cache with 'a' then 'b' — capacity is 1, so 'a' is evicted.
    await loader.load('object', 'a');
    await loader.load('object', 'b');

    const before = (mockDriver.findOne as ReturnType<typeof vi.fn>).mock.calls.length;
    await loader.load('object', 'a'); // miss → driver hit
    expect((mockDriver.findOne as ReturnType<typeof vi.fn>).mock.calls.length).toBe(before + 1);
  });

  it('invalidateAll() clears every cache shard', async () => {
    const loader = new DatabaseLoader({ driver: mockDriver });
    await loader.save('object', 'a', { name: 'a' });
    await loader.load('object', 'a');
    await loader.list('object');
    await loader.loadMany('object');
    await loader.stat('object', 'a');

    loader.invalidateAll();

    const before = (mockDriver.findOne as ReturnType<typeof vi.fn>).mock.calls.length;
    await loader.load('object', 'a');
    expect((mockDriver.findOne as ReturnType<typeof vi.fn>).mock.calls.length).toBe(before + 1);
  });
});

// ---------- MetadataManager + DatabaseLoader Integration ----------

describe('MetadataManager with DatabaseLoader', () => {
  let manager: MetadataManager;
  let dbLoader: DatabaseLoader;
  let memoryLoader: MemoryLoader;
  let mockDriver: IDataDriver;

  beforeEach(() => {
    mockDriver = createMockDriver();
    dbLoader = new DatabaseLoader({ driver: mockDriver });
    memoryLoader = new MemoryLoader();
    manager = new MetadataManager({
      formats: ['json'],
      loaders: [memoryLoader, dbLoader],
    });
  });

  it('should save and load via DatabaseLoader', async () => {
    await manager.save('object', 'account', { name: 'account' }, { loader: 'database' } as any);
    const result = await manager.load('object', 'account');
    expect(result).toEqual({ name: 'account' });
  });

  it('should list items from both loaders', async () => {
    await memoryLoader.save('object', 'account', { name: 'account' });
    await dbLoader.save('object', 'contact', { name: 'contact' });

    const names = await manager.listNames('object');
    expect(names).toContain('account');
    expect(names).toContain('contact');
  });

  it('should deduplicate items across memory and database loaders', async () => {
    await memoryLoader.save('object', 'account', { name: 'account', label: 'Memory' });
    await dbLoader.save('object', 'account', { name: 'account', label: 'Database' });

    const items = await manager.loadMany<{ name: string; label: string }>('object');
    const accounts = items.filter(i => i.name === 'account');
    expect(accounts).toHaveLength(1);
    // First loader (memory) wins
    expect(accounts[0].label).toBe('Memory');
  });

  it('should check existence across both loaders', async () => {
    await dbLoader.save('object', 'contact', { name: 'contact' });
    expect(await manager.exists('object', 'contact')).toBe(true);
  });

  it('should use DatabaseLoader for overlay persistence', async () => {
    // Register base metadata
    await manager.register('object', 'account', { name: 'account', label: 'Account' });

    // Save an overlay to the database
    await dbLoader.save('overlay', 'account_platform', {
      name: 'account_platform',
      baseType: 'object',
      baseName: 'account',
      scope: 'platform',
      patch: { label: 'Custom Account' },
      active: true,
    });

    // Verify the overlay is persisted in database
    const overlayResult = await dbLoader.load('overlay', 'account_platform');
    expect(overlayResult.data).toBeDefined();
    expect((overlayResult.data as any).patch.label).toBe('Custom Account');
  });
});

// ---------- MetadataManager Auto-Configuration ----------

describe('MetadataManager auto-configuration', () => {
  it('should auto-register DatabaseLoader when datasource and driver are provided', async () => {
    const mockDriver = createMockDriver();
    const manager = new MetadataManager({
      formats: ['json'],
      datasource: 'default',
      driver: mockDriver,
    });

    // The database loader should have been registered automatically
    // Verify by saving and loading data through the manager
    await manager.save('object', 'account', { name: 'account', label: 'Account' });
    const result = await manager.load('object', 'account');
    expect(result).toEqual({ name: 'account', label: 'Account' });
  });

  it('should NOT auto-register DatabaseLoader when only datasource is set (no driver)', async () => {
    const manager = new MetadataManager({
      formats: ['json'],
      datasource: 'default',
      // No driver provided
    });

    // No loaders should be registered, so save should fail
    await expect(
      manager.save('object', 'account', { name: 'account' })
    ).rejects.toThrow('No loader available');
  });

  it('should use custom tableName from config', async () => {
    const mockDriver = createMockDriver();
    const manager = new MetadataManager({
      formats: ['json'],
      datasource: 'default',
      tableName: 'custom_metadata',
      driver: mockDriver,
    });

    await manager.save('object', 'account', { name: 'account' });
    // syncSchema should be called with custom table name
    expect(mockDriver.syncSchema).toHaveBeenCalledWith(
      'custom_metadata',
      expect.objectContaining({ name: 'custom_metadata' })
    );
  });

  it('should support deferred database setup via setDatabaseDriver', async () => {
    const mockDriver = createMockDriver();
    const manager = new MetadataManager({
      formats: ['json'],
      datasource: 'default',
    });

    // No database loader yet — use deferred setup
    manager.setDatabaseDriver(mockDriver);

    // Now save and load should work via the database loader
    await manager.save('object', 'account', { name: 'account', label: 'Account' });
    const result = await manager.load('object', 'account');
    expect(result).toEqual({ name: 'account', label: 'Account' });
  });
});
