// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DatabaseLoader } from './database-loader.js';
import type { MetadataLoader } from './loader-interface.js';
import type { IDataDriver } from '@objectstack/spec/contracts';
import { MetadataManager } from '../metadata-manager.js';
import { MemoryLoader } from './memory-loader.js';
import { MetadataPlugin } from '../plugin.js';
import { PACKAGE_SLOTTED_STORE_TYPES, isBundledStoreType } from '../package-slotted-store.js';
import { FilesystemLoader } from './filesystem-loader.js';
import { JSONSerializer } from '../serializers/json-serializer.js';
// Paid at collection, not inside a case's window: `plugin.ts` imports it lazily (check:test-source-alias).
import '@objectstack/metadata-fs';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

  describe('delete scoped to one package (ADR-0150 D4, #32198)', () => {
    it('keeps the row when it holds another package\'s item, and deletes it when it holds that package\'s', async () => {
      await loader.save('agent', 'helper', { name: 'helper', label: 'beta', _packageId: 'com.acme.beta' });
      await loader.delete('agent', 'helper', { packageId: 'com.acme.alpha' });
      expect((await loader.load('agent', 'helper')).data).toMatchObject({ label: 'beta' });

      await loader.delete('agent', 'helper', { packageId: 'com.acme.beta' });
      expect((await loader.load('agent', 'helper')).data).toBeNull();
    });

    it('reads the package off a stored envelope\'s `packageId` as well as the `_packageId` stamp', async () => {
      await loader.save('agent', 'helper', { packageId: 'com.acme.beta', metadata: { name: 'helper' } });
      await loader.delete('agent', 'helper', { packageId: 'com.acme.alpha' });
      expect(await loader.exists('agent', 'helper')).toBe(true);
      await loader.delete('agent', 'helper', { packageId: 'com.acme.beta' });
      expect(await loader.exists('agent', 'helper')).toBe(false);
    });

    it('keeps a row it cannot attribute to the package (a package-less row is a customization, D4)', async () => {
      await loader.save('agent', 'helper', { name: 'helper', label: 'env' });
      await loader.delete('agent', 'helper', { packageId: 'com.acme.alpha' });
      expect(await loader.exists('agent', 'helper')).toBe(true);
    });

    it('CONTROL: with no package it deletes by name, as before', async () => {
      await loader.save('agent', 'helper', { name: 'helper', _packageId: 'com.acme.beta' });
      await loader.delete('agent', 'helper');
      expect(await loader.exists('agent', 'helper')).toBe(false);
    });

    // [#32246 item 5] The loader now fills `package_id`, so the column branch
    // of the row's package is live: a customization's body names no package.
    it('reads the package off the `package_id` column — a package-less customization in a holder\'s row goes with that holder (#32246)', async () => {
      await loader.save('agent', 'helper', { name: 'helper', label: 'alpha', _packageId: 'com.acme.alpha' });
      await loader.save('agent', 'helper', { name: 'helper', label: 'customized' });
      await loader.delete('agent', 'helper', { packageId: 'com.acme.beta' });
      expect((await loader.load('agent', 'helper')).data).toMatchObject({ label: 'customized' });
      await loader.delete('agent', 'helper', { packageId: 'com.acme.alpha' });
      expect(await loader.exists('agent', 'helper')).toBe(false);
    });

    it('keeps a row per package, its plural unscoped reads answer one per package, and a delete naming no package of a name two packages hold is refused (#32246, #32521)', async () => {
      await loader.save('agent', 'helper', { name: 'helper', label: 'alpha', _packageId: 'com.acme.alpha' });
      await loader.save('agent', 'helper', { name: 'helper', label: 'beta', _packageId: 'com.acme.beta' });
      expect((await loader.loadSlots('agent', 'helper')).map((slot) => [slot.packageId, slot.data.label])).toEqual([
        ['com.acme.alpha', 'alpha'],
        ['com.acme.beta', 'beta'],
      ]);
      // `load` and `list` answer one per name, the one saved last, as when the
      // loader kept one row (`load` asks for the highest version; the endpoint
      // pins read it on a driver that orders). [#32521] `loadMany` and
      // `loadManyKeyed` answer one per `(package, name)`, each slot's row saved
      // last — BEFORE: one per name, `beta`, then `alpha again`.
      expect(await loader.list('agent')).toEqual(['helper']);
      expect((await loader.loadMany('agent')).map((item: any) => item.label)).toEqual(['alpha', 'beta']);
      expect((await loader.loadManyKeyed('agent')).map((entry) => [entry.name, entry.packageId, entry.data.label])).toEqual([
        ['helper', 'com.acme.alpha', 'alpha'],
        ['helper', 'com.acme.beta', 'beta'],
      ]);
      await loader.save('agent', 'helper', { name: 'helper', label: 'alpha again', _packageId: 'com.acme.alpha' });
      expect((await loader.loadManyKeyed('agent')).map((entry) => entry.data.label)).toEqual(['alpha again', 'beta']);

      await expect(loader.delete('agent', 'helper')).rejects.toMatchObject({ status: 409 });
      expect(await loader.loadSlots('agent', 'helper')).toHaveLength(2);
      await loader.delete('agent', 'helper', { packageId: 'com.acme.alpha' });
      expect((await loader.load('agent', 'helper')).data).toMatchObject({ label: 'beta' });
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

  // [#29596] The stored-row conversion notice names a row by its row name,
  // the identity every type is stored under. An `object_extension` body
  // carries `extend` and no `name`, and its row is stored under its target,
  // so this seam (unlike the protocol's, which reads the body) already names
  // each stale extension and keys the warn-once set by it. Measured on a real
  // store: the two rows read here as `crm_account` and `crm_contact`.
  describe('stored conversion notice names the row (#29596)', () => {
    const subjects = (warn: { mock: { calls: unknown[][] } }) => warn.mock.calls
      .map((c) => String(c[0]))
      .filter((line) => line.includes('carries a pre-protocol shape'))
      .map((line) => /stored (\S+) carries/.exec(line)?.[1]);
    const staleTime = { type: 'time', label: 'Opens', defaultValue: '12:00Z' };

    it('two stale extension rows give two notices, each naming its target', async () => {
      await loader.save('object_extension', 'crm_account', { extend: 'crm_account', fields: { opens_at__c: staleTime } });
      await loader.save('object_extension', 'crm_contact', { extend: 'crm_contact', fields: { opens_at__c: staleTime } });
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const items = await new DatabaseLoader({ driver: mockDriver }).loadMany<{ extend: string; fields: Record<string, { defaultValue: string }> }>('object_extension');
        expect(items.map((i) => i.fields.opens_at__c.defaultValue)).toEqual(['12:00', '12:00']);
        expect(subjects(warn)).toEqual(['object_extension/crm_account', 'object_extension/crm_contact']);
      } finally {
        warn.mockRestore();
      }
    });

    it('CONTROL — a non-extension row is named by its row name the same way', async () => {
      await loader.save('object', 'shift', { name: 'shift', fields: { opens_at: staleTime } });
      await loader.save('object', 'rota', { name: 'rota', fields: { opens_at: staleTime } });
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        await new DatabaseLoader({ driver: mockDriver }).loadMany('object');
        expect(subjects(warn)).toEqual(['object/shift', 'object/rota']);
      } finally {
        warn.mockRestore();
      }
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

  describe('organization scope (ADR-0131 D6/D7)', () => {
    it('accepts organizationId and environmentId for back-compat and scopes nothing by either', async () => {
      const tenantLoader = new DatabaseLoader({
        driver: mockDriver,
        organizationId: 'org-1',
        environmentId: 'env-1',
      });

      await tenantLoader.save('object', 'account', { name: 'account' });

      // The family declares no organization column (ADR-0131 D7) and the
      // metadata layer lost environment_id (ADR-0008 §0): the create names
      // neither.
      for (const [table, row] of (mockDriver.create as any).mock.calls) {
        expect(row, String(table)).not.toHaveProperty('organization_id');
        expect(row, String(table)).not.toHaveProperty('environment_id');
      }
      expect(mockDriver.create).toHaveBeenCalledWith('sys_metadata', expect.anything());

      await tenantLoader.load('object', 'account');
      const findOneCalls = (mockDriver.findOne as any).mock.calls;
      expect(findOneCalls.length).toBeGreaterThan(0);
      for (const [, opts] of findOneCalls) {
        expect((opts?.where ?? {})).not.toHaveProperty('organization_id');
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
      // #14023 — this used to bolt a `raw` method onto the mock through an
      // `as unknown as { raw: unknown }` cast, because that was the only
      // surface the migration accepted. The cast was the tell: it reached PAST
      // the declared contract. `IDataDriver` declares `execute` non-optionally
      // and has never declared `raw`, which is why `createMockDriver` already
      // carries `execute` and needed no cast to carry it. The migration now
      // drives the declared surface, so this case observes the mock's own
      // `execute` and the cast is gone.
      const driver = createMockDriver();
      driver.syncSchema = vi.fn().mockRejectedValue(alreadyExists());
      const execute = driver.execute as ReturnType<typeof vi.fn>;
      const loader = new DatabaseLoader({ driver });

      await loader.list('object');

      // The `project_id` → `environment_id` forward migration still runs; it
      // probes the column list before touching anything.
      expect(execute).toHaveBeenCalled();
      expect(
        execute.mock.calls.some(([sql]) => /table_info|information_schema/i.test(String(sql))),
      ).toBe(true);
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
      const execute = driver.execute as ReturnType<typeof vi.fn>;
      const loader = new DatabaseLoader({ driver });

      await loader.list('object');

      // Non-vacuity FIRST (#14023). This assertion is "no statement matched a
      // pattern", which a run that issued NO statements at all satisfies just
      // as well — and that is exactly the state this file was in while the
      // migration refused every driver. Observe that SQL really flowed before
      // reading anything into the absence of that one statement.
      expect(execute, 'nothing ran — the emptiness below would prove nothing').toHaveBeenCalled();
      const overlayDdl = execute.mock.calls
        .map(([sql]) => String(sql))
        .filter((sql: string) => /idx_sys_metadata_overlay_active/i.test(sql));
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

  it('honors custom maxSize/ttlMs via cache options', async () => {
    const loader = new DatabaseLoader({
      driver: mockDriver,
      cache: { enabled: true, maxSize: 1, ttlMs: 60_000 },
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

/**
 * [#13997] `MetadataStats.mtime` is declared `z.string().datetime()` — `stat()`
 * adapts a driver row into it and must canonicalise the timestamp.
 *
 * ## The defect
 *
 * `MetadataStatsSchema.mtime` is `z.string().datetime()`
 * (`packages/spec/src/system/metadata-persistence.zod.ts`) — stricter than the
 * sibling `MetadataItem.authoredAt`, which is a bare `z.string()`. `stat()`
 * built it from `record.updatedAt ?? record.createdAt`, and `created_at` /
 * `updated_at` are BUILTIN audit columns: not in `datetimeFields`, and when
 * this landed `SqlDriver#formatOutput` repaired them only inside its
 * `if (this.isSqlite)` arm, so on Postgres and MySQL they arrived as a JS
 * `Date`. #13973 ([ADR-0053 D-F1]) has since lifted both of `formatOutput`'s
 * timestamp passes out of that gate — they run on EVERY dialect — and the pin
 * that recorded the asymmetry records the canonical-text contract instead
 * (`packages/drivers/driver-sql/src/sql-driver-13567-audit-stamp-materialisation.test.ts`
 * §B1, inverted on purpose).
 *
 * ⚠️ The `Date` these cases drive is still a shape `stat()` receives, so they
 * pin a LIVE arm: `withPostgresCalendarDayAsText` is untouched by that ruling
 * ([ADR-0053 D-F2]) so the CLIENT still materialises the column as a `Date`,
 * `driver-sql` hands an INVALID `Date` through unchanged ([ADR-0053 D-F3]),
 * and non-SQL drivers materialise their own.
 *
 * ⚠️ `rowToRecord` USED to reach `createdAt` / `updatedAt` through an
 * unchecked `row.created_at as string | undefined` cast, so the `string` in
 * `MetadataRecord` was an assertion about a driver row and never a measurement
 * of one — which is why tsc reported nothing. #16422 replaced that cast with
 * `canonicalIsoInstant`, whose return type IS `string | undefined`, so the
 * shape reaching `stat()` from that adapter is measured now. The cases below
 * are unaffected: a valid `Date` and an already-canonical string were never
 * shapes the two spellings disagreed on.
 *
 * ## Why the double is overridden rather than replaced
 *
 * `createMockDriver` above stores and returns plain objects, so it cannot
 * produce the one shape that discriminates this defect. Overriding `findOne`
 * on the existing double keeps every other guarantee that double already
 * carries instead of introducing a second, looser one.
 */
describe('#13997 — stat() emits canonical ISO text whatever the dialect materialised', () => {
  /** The instant the live dialects hand out, with observable milliseconds. */
  const PG_INSTANT = new Date('2026-03-04T05:06:07.089Z');
  const ISO_Z = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

  /** A `sys_metadata` row as a live dialect returns it: `updated_at` is a Date. */
  function rowWithStamp(stamp: unknown): Record<string, unknown> {
    return {
      id: 'r_1',
      name: 'account',
      type: 'object',
      metadata: JSON.stringify({ name: 'account' }),
      checksum: 'sha256:abc',
      version: 1,
      created_at: stamp,
      updated_at: stamp,
    };
  }

  it('canonicalises a JS Date into the declared ISO string', async () => {
    const driver = createMockDriver();
    // Cache off: `stat()` memoises, and a cached hit would read back the value
    // this assertion is about without re-running the adapter under test.
    const loader = new DatabaseLoader({ driver, cache: { enabled: false } });

    const row = rowWithStamp(PG_INSTANT);
    // Non-vacuity guard — a fixture that degraded to a string would leave this
    // test green while measuring the shape that was never broken.
    expect(row.updated_at).toBeInstanceOf(Date);
    driver.findOne = vi.fn().mockResolvedValue(row);

    const stats = await loader.stat('object', 'account');

    expect(stats).not.toBeNull();
    expect(typeof stats!.mtime).toBe('string');
    expect(stats!.mtime).toMatch(ISO_Z);
    expect(stats!.mtime).toBe(PG_INSTANT.toISOString());
  });

  it('passes an already-canonical SQLite string through byte-identically', async () => {
    const driver = createMockDriver();
    const loader = new DatabaseLoader({ driver, cache: { enabled: false } });

    const canonical = '2026-03-04T05:06:07.089Z';
    const row = rowWithStamp(canonical);
    expect(typeof row.updated_at).toBe('string');
    driver.findOne = vi.fn().mockResolvedValue(row);

    const stats = await loader.stat('object', 'account');

    // Idempotent: the dialect that was already correct must not be reshaped.
    expect(stats!.mtime).toBe(canonical);
  });
});

/**
 * [#31699 R3-B, epic ruling 6796068023] `email_template` is stored per
 * `(package, name)` and is the one BUNDLED type: one `(package, name)` holds a
 * row per locale, the canonical member (`en-US`) stored as `bundle_member`
 * NULL (`overlayMemberValue`). The loaders' unscoped reads keep one row per
 * `(package, name, member)`, so no member of any slot is dropped.
 *
 * BASE (measured at 460df4af, `email_template` out of
 * `PACKAGE_SLOTTED_STORE_TYPES`): `loadMany` answered every row. At 460df4af
 * (in the set, collapsed one row per name): one alpha bundle answered only
 * `fr-FR`; two packages' bundles answered 1 row of 4.
 *
 * The bundles below are seeded as the store writes them; the save's own
 * member-awareness is pinned in the R4-A describe after this one.
 */
describe('[#31699 R3-B] a bundled type keeps every member of every slot', () => {
  const ALPHA = 'com.alpha.app';
  const BETA = 'com.beta.app';
  let driver: IDataDriver;
  let loader: DatabaseLoader;

  const body = (locale: string, packageId: string | null) =>
    ({ name: 'welcome', locale, subject: `${packageId ?? 'env'} ${locale}`, bodyHtml: '<p/>' });
  const seed = (id: string, packageId: string | null, locale: string, version: number) =>
    driver.create('sys_metadata', {
      id, type: 'email_template', name: 'welcome', state: 'active', version, checksum: id,
      package_id: packageId, bundle_member: locale === 'en-US' ? null : locale,
      metadata: JSON.stringify(body(locale, packageId)),
    });
  const bundle = async (packageId: string, from: number) => {
    await seed(`${packageId}_en`, packageId, 'en-US', from);
    await seed(`${packageId}_fr`, packageId, 'fr-FR', from + 1);
  };
  const subjects = (items: Array<{ subject?: unknown }>) => items.map((item) => item.subject).sort();

  beforeEach(() => {
    driver = createMockDriver();
    loader = new DatabaseLoader({ driver });
  });

  it('one two-locale bundle: loadMany and loadManyKeyed keep both locales (460df4af: only fr-FR)', async () => {
    await bundle(ALPHA, 1);
    expect(subjects(await loader.loadMany('email_template'))).toEqual([`${ALPHA} en-US`, `${ALPHA} fr-FR`]);
    const keyed = await loader.loadManyKeyed('email_template');
    expect(keyed.map((entry) => entry.name)).toEqual(['welcome', 'welcome']);
    expect(subjects(keyed.map((entry) => entry.data))).toEqual([`${ALPHA} en-US`, `${ALPHA} fr-FR`]);
  });

  it('two packages\' bundles: all four rows are kept (460df4af: 1 of 4)', async () => {
    await bundle(ALPHA, 1);
    await bundle(BETA, 3);
    const all = [`${ALPHA} en-US`, `${ALPHA} fr-FR`, `${BETA} en-US`, `${BETA} fr-FR`];
    expect(subjects(await loader.loadMany('email_template'))).toEqual(all);
    expect(subjects((await loader.loadManyKeyed('email_template')).map((entry) => entry.data))).toEqual(all);
  });

  it('CONTROL: one row per (package, name, member) — a member\'s older row is not a second member', async () => {
    await bundle(ALPHA, 1);
    await seed('alpha_fr_old', ALPHA, 'fr-FR', 0);
    expect(subjects(await loader.loadMany('email_template'))).toEqual([`${ALPHA} en-US`, `${ALPHA} fr-FR`]);
  });

  it('a rollback by name with two holders is refused 409 naming both, before any write', async () => {
    await bundle(ALPHA, 1);
    await bundle(BETA, 3);
    const err = await loader.registerRollback('email_template', 'welcome', body('en-US', ALPHA), 1)
      .then(() => undefined, (e: any) => e);
    expect([err?.code, err?.status, err?.refusal?.reason]).toEqual(['RESOURCE_CONFLICT', 409, 'ambiguous-in-environment']);
    expect(err.refusal.candidates).toEqual([
      { kind: 'package', packageId: ALPHA },
      { kind: 'package', packageId: BETA },
    ]);
    expect(driver.update).not.toHaveBeenCalled();
  });

  it('a rollback by name of one slot restores the row of the member its body declares, never another member\'s', async () => {
    await bundle(ALPHA, 1);
    await loader.registerRollback('email_template', 'welcome', { ...body('fr-FR', ALPHA), subject: 'restored fr' }, 1);
    expect(subjects(await loader.loadMany('email_template'))).toEqual([`${ALPHA} en-US`, 'restored fr']);
  });

  it('a delete by name with two holders is refused 409; a delete naming a package takes that package\'s rows only', async () => {
    await bundle(ALPHA, 1);
    await bundle(BETA, 3);
    await expect(loader.delete('email_template', 'welcome')).rejects.toMatchObject({ code: 'RESOURCE_CONFLICT', status: 409 });
    expect(await loader.loadManySlots('email_template')).toHaveLength(4);
    await loader.delete('email_template', 'welcome', { packageId: ALPHA });
    expect(subjects(await loader.loadMany('email_template'))).toEqual([`${BETA} en-US`, `${BETA} fr-FR`]);
  });

  it('a save fills package_id', async () => {
    await loader.save('email_template', 'welcome', { ...body('en-US', ALPHA), _packageId: ALPHA });
    const rows = await driver.find('sys_metadata', { where: { type: 'email_template' } } as never) as Array<Record<string, unknown>>;
    expect(rows.map((row) => row.package_id)).toEqual([ALPHA]);
  });

  it('MemoryLoader: two packages\' templates of one name are both answered by loadMany and loadManyKeyed', async () => {
    const memory = new MemoryLoader();
    await memory.save('email_template', 'welcome', { ...body('en-US', ALPHA), _packageId: ALPHA });
    await memory.save('email_template', 'welcome', { ...body('en-US', BETA), _packageId: BETA });
    expect(subjects(await memory.loadMany('email_template'))).toEqual([`${ALPHA} en-US`, `${BETA} en-US`]);
    expect((await memory.loadManyKeyed('email_template')).map((entry) => entry.name)).toEqual(['welcome', 'welcome']);
  });
});

/**
 * [#31699 R4-A / R4-B, #32422; epic ruling 6799056319] The save of a bundled
 * type stored per `(package, name)` writes the row of the member the body
 * declares, and inserts a member that has no row: never another member's row.
 *
 * BEFORE (measured at f9f589da, same fixtures): the boot priming pass
 * (`MetadataManager.loadMany` then `register` each, as
 * `MetadataPlugin._loadFromFileSystem` does) on a slot holding `en-US` and
 * `fr-FR` replaced the `en-US` row's body with `fr-FR`'s (version 3, a history
 * row); with two packages' rows bound by `package_id` alone, `loadMany`
 * answered alpha's two and the pass inserted a package-less row; a direct save
 * of `fr-FR` into a slot holding `en-US` overwrote the `en-US` row.
 */
describe('[#31699 R4-A] the save of a bundled type writes its own member\'s row', () => {
  const ALPHA = 'com.alpha.app';
  const BETA = 'com.beta.app';
  let driver: IDataDriver;

  const body = (locale: string, packageId: string, stamped: boolean) => ({
    name: 'welcome', locale, subject: `${packageId} ${locale}`, bodyHtml: '<p/>',
    ...(stamped ? { _packageId: packageId } : {}),
  });
  // Bound by the `package_id` column; the body stamped or not (the protocol writes none).
  const seed = (packageId: string, locale: string, version: number, stamped: boolean) =>
    driver.create('sys_metadata', {
      id: `${packageId}_${locale}`, type: 'email_template', name: 'welcome', state: 'active', version,
      checksum: `${packageId}_${locale}`, package_id: packageId, bundle_member: locale === 'en-US' ? null : locale,
      metadata: JSON.stringify(body(locale, packageId, stamped)),
    });
  const stored = async (type = 'email_template') =>
    ((await driver.find('sys_metadata', { where: { type } } as never)) as Array<Record<string, any>>)
      .map((row) => [row.package_id ?? null, row.bundle_member ?? null, JSON.parse(row.metadata).subject ?? JSON.parse(row.metadata).label])
      .sort((a, b) => String(a).localeCompare(String(b)));
  const manager = () => {
    const m = new MetadataManager({ formats: ['json'], loaders: [] });
    m.registerLoader(new DatabaseLoader({ driver }));
    return m;
  };
  /** Each `loadMany` item registered back WITHOUT the R5-A source skip: the pass as it ran before, or any other caller. */
  const prime = async (m: MetadataManager) => {
    for (const item of (await m.loadMany('email_template')) as Array<{ name?: string }>) {
      if (item?.name) await m.register('email_template', item.name, item, { notify: false });
    }
  };

  beforeEach(() => {
    driver = createMockDriver();
  });

  for (const stamped of [true, false]) {
    it(`the priming pass leaves a two-member slot's rows unchanged (bodies ${stamped ? 'stamped' : 'bound by the column only'}; BEFORE: en-US overwritten by fr-FR)`, async () => {
      await seed(ALPHA, 'en-US', 1, stamped);
      await seed(ALPHA, 'fr-FR', 2, stamped);
      const before = await stored();
      await prime(manager());
      expect(await stored()).toEqual(before);
      expect(driver.update).not.toHaveBeenCalled();
      expect(driver.create).toHaveBeenCalledTimes(2);
    });
  }

  it('R4-B: rows bound by the column only — `loadMany` keeps two packages\' same member apart, and the priming pass writes nothing (BEFORE: alpha\'s two only, and a package-less row inserted)', async () => {
    await seed(ALPHA, 'en-US', 1, false);
    await seed(ALPHA, 'fr-FR', 2, false);
    await seed(BETA, 'en-US', 3, false);
    await seed(BETA, 'fr-FR', 4, false);
    const m = manager();
    const items = (await m.loadMany('email_template')) as Array<{ subject: string; _packageId?: string }>;
    expect(items.map((item) => [item._packageId, item.subject]).sort()).toEqual([
      [ALPHA, `${ALPHA} en-US`], [ALPHA, `${ALPHA} fr-FR`], [BETA, `${BETA} en-US`], [BETA, `${BETA} fr-FR`],
    ]);
    const before = await stored();
    await prime(m);
    expect(await stored()).toEqual(before);
    expect(driver.update).not.toHaveBeenCalled();
    expect(driver.create).toHaveBeenCalledTimes(4);
  });

  it('a direct save of fr-FR into a slot holding en-US inserts the fr-FR row; the en-US row is untouched; a second fr-FR save updates its own row (BEFORE: the en-US row overwritten)', async () => {
    await seed(ALPHA, 'en-US', 1, true);
    const loader = new DatabaseLoader({ driver });
    await loader.save('email_template', 'welcome', body('fr-FR', ALPHA, true));
    expect(await stored()).toEqual([[ALPHA, null, `${ALPHA} en-US`], [ALPHA, 'fr-FR', `${ALPHA} fr-FR`]]);
    await loader.save('email_template', 'welcome', { ...body('fr-FR', ALPHA, true), subject: 'fr again' });
    expect(await stored()).toEqual([[ALPHA, null, `${ALPHA} en-US`], [ALPHA, 'fr-FR', 'fr again']]);
  });

  it('CONTROL: an unbundled slotted type (agent) still saves to its one row per slot', async () => {
    const loader = new DatabaseLoader({ driver });
    await loader.save('agent', 'helper', { name: 'helper', label: 'v1', _packageId: ALPHA });
    await loader.save('agent', 'helper', { name: 'helper', label: 'v2', _packageId: ALPHA });
    expect(await stored('agent')).toEqual([[ALPHA, null, 'v2']]);
  });
});

/**
 * [#31699 R5-A; epic ruling 6801410166] The boot priming pass
 * (`MetadataPlugin._loadFromFileSystem`, run for real here over a
 * `DatabaseLoader`) never writes an item back into the loader it read it from;
 * an item read from another loader still seeds the database loader.
 *
 * BEFORE (measured at cfb8f300, same fixtures): a package's `en-US` row beside
 * a package-less `en-US` row was overwritten with the package-less body
 * (version 3, one update); beside a package-less `fr-FR` row, a package-bound
 * copy of it was inserted; a file-system item seeded one row (the same with
 * the source skip ablated, and after it).
 */
describe('[#31699 R5-A] the priming pass never writes back a row it read from the same loader', () => {
  const ALPHA = 'com.alpha.app';
  let driver: IDataDriver;
  const seed = (id: string, packageId: string | null, locale: string, subject: string) =>
    driver.create('sys_metadata', {
      id, type: 'email_template', name: 'welcome', state: 'active', version: 1, checksum: id,
      package_id: packageId, bundle_member: locale === 'en-US' ? null : locale,
      metadata: JSON.stringify({ name: 'welcome', locale, subject, bodyHtml: '<p/>' }),
    });
  const stored = async () =>
    ((await driver.find('sys_metadata', { where: { type: 'email_template' } } as never)) as Array<Record<string, any>>)
      .map((row) => [row.package_id ?? null, row.bundle_member ?? null, JSON.parse(row.metadata).subject])
      .sort((a, b) => String(a).localeCompare(String(b)));
  /** The real pass over `loaders`; the plugin's own file-system loader is kept only with a `rootDir`. */
  const bootPass = async (loaders: DatabaseLoader[], options: { rootDir?: string; packageId?: string } = {}) => {
    const plugin = new MetadataPlugin({ ...options, watch: false, config: { bootstrap: 'eager' } });
    const manager = (plugin as any).manager as MetadataManager;
    const fileSystem = options.rootDir ? [...(manager as any).loaders.values()] : [];
    (manager as any).loaders.clear();
    for (const loader of [...fileSystem, ...loaders]) manager.registerLoader(loader);
    await (plugin as any)._loadFromFileSystem({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } });
    return manager;
  };
  /** What the manager's registry holds for `type`. */
  const registered = (manager: MetadataManager, type: string) => [...((manager as any).registry.get(type)?.values() ?? [])];

  beforeEach(() => {
    driver = createMockDriver();
  });

  it('a package\'s en-US row beside a package-less en-US row: both unchanged, no update, no insert (BEFORE: the package\'s row overwritten)', async () => {
    await seed('alpha_en', ALPHA, 'en-US', 'alpha own');
    await seed('env_en', null, 'en-US', 'env older');
    const before = await stored();
    await bootPass([new DatabaseLoader({ driver })]);
    expect(await stored()).toEqual(before);
    expect(driver.update).not.toHaveBeenCalled();
    expect(driver.create).toHaveBeenCalledTimes(2);
  });

  it('the member-absent neighbour: a package\'s en-US row beside a package-less fr-FR row inserts nothing (BEFORE: a package-bound fr-FR copy inserted)', async () => {
    await seed('alpha_en', ALPHA, 'en-US', 'alpha own');
    await seed('env_fr', null, 'fr-FR', 'env fr');
    const before = await stored();
    await bootPass([new DatabaseLoader({ driver })]);
    expect(await stored()).toEqual(before);
    expect(driver.update).not.toHaveBeenCalled();
    expect(driver.create).toHaveBeenCalledTimes(2);
  });

  it('CONTROL: a file-system item still seeds the database loader', async () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'r5a-'));
    try {
      mkdirSync(join(rootDir, 'email_template'));
      writeFileSync(join(rootDir, 'email_template', 'welcome.email-template.json'), JSON.stringify({ name: 'welcome', locale: 'en-US', subject: 'from file', bodyHtml: '<p/>' }));
      await bootPass([new DatabaseLoader({ driver })], { rootDir, packageId: ALPHA });
      expect(await stored()).toEqual([[ALPHA, null, 'from file']]);
      expect(vi.mocked(driver.create).mock.calls.map(([table]) => table)).toEqual(['sys_metadata', 'sys_metadata_history']);
      expect(driver.update).not.toHaveBeenCalled();
    } finally {
      rmSync(rootDir, { recursive: true, force: true });
    }
  });

  // [R7-A; epic ruling 6809488921] The one write the skip still lets reach the source loader.
  const seedAgent = (body: Record<string, unknown>) =>
    driver.create('sys_metadata', {
      id: 'legacy', type: 'agent', name: 'helper', state: 'active', version: 1, checksum: 'legacy', source: 'database',
      package_id: null, metadata: JSON.stringify({ name: 'helper', label: 'Helper', ...body }),
    });
  const agentRow = async () => (await driver.findOne('sys_metadata', { where: { type: 'agent' } } as never)) as Record<string, any>;

  it('[R7-A] an agent legacy row (empty column, stamped body): the column is bound, body, version and history unchanged', async () => {
    await seedAgent({ _packageId: ALPHA });
    const before = await agentRow();
    const manager = await bootPass([new DatabaseLoader({ driver })], { packageId: 'com.host.app' });
    expect(await agentRow()).toEqual({ ...before, package_id: ALPHA });
    expect(vi.mocked(driver.update).mock.calls).toEqual([['sys_metadata', 'legacy', { package_id: ALPHA }]]);
    expect(driver.create).toHaveBeenCalledTimes(1);
    expect(registered(manager, 'agent')).toEqual([{ name: 'helper', label: 'Helper', _packageId: ALPHA, _provenance: 'package' }]);
  });

  it('[R7-A, R7-B] a package-less row on a host with a packageId stays package-less, no update; the loader\'s cache keeps it unstamped', async () => {
    await seedAgent({});
    const before = await agentRow();
    const loader = new DatabaseLoader({ driver });
    await bootPass([loader], { packageId: ALPHA });
    expect(await agentRow()).toEqual(before);
    expect(driver.update).not.toHaveBeenCalled();
    expect(driver.create).toHaveBeenCalledTimes(1);
    expect(await loader.loadMany('agent')).toEqual([{ name: 'helper', label: 'Helper' }]);
  });

  // [#32488 item 3, R8-A; contract record 6811135944] The bind takes the loader's own rows only.
  it('[#32488 item 3] another writer\'s row (source other than database, empty column, copied stamp): never bound (BEFORE: bound to the copied package)', async () => {
    await driver.create('sys_metadata', {
      id: 'legacy', type: 'agent', name: 'helper', state: 'active', version: 1, checksum: 'legacy', source: 'api',
      package_id: null, metadata: JSON.stringify({ name: 'helper', label: 'Helper', _packageId: ALPHA }),
    });
    const before = await agentRow();
    await bootPass([new DatabaseLoader({ driver })], { packageId: 'com.host.app' });
    expect(await agentRow()).toEqual(before);
    expect(driver.update).not.toHaveBeenCalled();
  });

  /**
   * [#32488 R7-C; epic ruling 6809488921] A file item and the row it seeded
   * under the host's package: the boot after a file edit registers the file's
   * body. BEFORE (measured at 27abd458, same fixture): the second boot's
   * registry held `v1` while the row held `v2` (version 2); the third held `v2`.
   */
  it('[#32488 R7-C] a file edited from v1 to v2: the next boot registers v2, and the row it seeded holds v2 (BEFORE: v1 registered)', async () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'r7c-'));
    try {
      mkdirSync(join(rootDir, 'email_template'));
      const file = join(rootDir, 'email_template', 'welcome.email-template.json');
      const write = (subject: string) => writeFileSync(file, JSON.stringify({ name: 'welcome', locale: 'en-US', subject, bodyHtml: '<p/>' }));
      write('v1');
      await bootPass([new DatabaseLoader({ driver })], { rootDir, packageId: ALPHA });
      write('v2');
      const manager = await bootPass([new DatabaseLoader({ driver })], { rootDir, packageId: ALPHA });
      expect(registered(manager, 'email_template').map((item) => item.subject)).toEqual(['v2']);
      expect(((await manager.get('email_template', 'welcome')) as { subject?: string }).subject).toBe('v2');
      expect(await stored()).toEqual([[ALPHA, null, 'v2']]);
      const row = (await driver.findOne('sys_metadata', { where: { type: 'email_template' } } as never)) as Record<string, any>;
      expect(row.version).toBe(2);
    } finally {
      rmSync(rootDir, { recursive: true, force: true });
    }
  });
});

/**
 * [#32791, #32812; ADR-0150 D3/D4, regression of #32560] On a host that
 * declares its package, the boot priming pass stamped a package-less stored
 * row with the host's package before it registered it (`applyProtection`), so
 * the registry held that row in the host's slot. A read naming no package of
 * an action name is judged over the registry and the loaders (#32560's
 * `judgesLoaderSlots`), and the loaders still store the row package-less: one
 * row was counted twice, as the host's package and as the environment, and
 * the refusal named a holder that does not exist. #32791 corrected the count
 * right after the pass; after a write that carries no package the host was
 * named again (#32812). The pass now leaves a package-less stored row of a
 * type stored per `(package, name)` unstamped (`unstampedStoredRow` in
 * `plugin.ts`), so the registry files it where the store files any write
 * that carries no package (the name's one holder's customization, else the
 * environment's own item), whatever package the host declares.
 *
 * BEFORE (`main` before #32791, with #32676): each case below not marked
 * CONTROL was refused naming `com.host.app`. The CONTROLs answer on that
 * `main` as here. Where #32812 moved a #32791 pin, its comment names the
 * FROM (`main` `25ee5076`) and the TO, which is the cell's answer on a host
 * that declares no package. The comments and titles of the unmoved pins
 * (the "stamped row", its overwrite mark, the judged view's filing, the
 * earlier heads they cite) describe #32791's read-time mechanism, which
 * #32812 removed; their answers hold unchanged with the row unstamped.
 */
describe('[#32791] a stored package-less row the boot pass files under the host\'s package is one holder of an action name, not two', () => {
  const ALPHA = 'com.alpha.app';
  const BETA = 'com.beta.app';
  const HOST = 'com.host.app';
  const UNBUNDLED = [...PACKAGE_SLOTTED_STORE_TYPES].filter((type) => !isBundledStoreType(type));
  let driver: IDataDriver;

  /** A row of `helper` bound to `packageId` by the column, or package-less for `null`. */
  const seed = (type: string, packageId: string | null, version: number, body: Record<string, unknown> = {}) =>
    driver.create('sys_metadata', {
      id: `${type}_${packageId ?? 'env'}_${version}`, type, name: 'helper', state: 'active', version, checksum: `${type}_${packageId ?? 'env'}_${version}`,
      source: 'database', package_id: packageId, metadata: JSON.stringify({ name: 'helper', label: packageId ?? 'env', ...body }),
    });
  /**
   * The real pass (`MetadataPlugin._loadFromFileSystem`) over one database
   * loader, on a host that declares `hostPackage`; `inMemory` packages' items
   * of `helper` are registered in memory before it. `passes` runs it that
   * many times on the same manager, the loader's cache kept between runs or
   * dropped (`keepCache`).
   */
  const bootPass = async (hostPackage?: string, inMemory: InMemory[] = [], passes = 1, keepCache = false) => {
    const plugin = new MetadataPlugin({ ...(hostPackage ? { packageId: hostPackage } : {}), watch: false, config: { bootstrap: 'eager' } });
    const m = (plugin as any).manager as MetadataManager;
    (m as any).loaders.clear();
    const loader = new DatabaseLoader({ driver });
    m.registerLoader(loader);
    for (const item of inMemory) registerOwn(m, item);
    for (let pass = 0; pass < passes; pass++) {
      if (pass > 0 && !keepCache) loader.invalidateAll();
      await (plugin as any)._loadFromFileSystem({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } });
    }
    return m;
  };
  /** A package's own item of `helper` in memory: the package, or the package and the object it binds. */
  type InMemory = string | readonly [packageId: string, objectName: string];
  /** `item`'s package's own item of `helper`, registered in memory (code), bound to its object when it names one. */
  const registerOwn = (m: MetadataManager, item: InMemory) => {
    const [packageId, objectName] = typeof item === 'string' ? [item] : item;
    return m.registerInMemory('action', 'helper', { name: 'helper', label: `${packageId} code`, _packageId: packageId, ...(objectName ? { objectName } : {}) });
  };
  /** What a read answers: the item's label, or the refusal's code, status, reason and candidates, in the order the refusal names them. */
  const answerOf = async (read: () => Promise<unknown>) => {
    try {
      const data = await read();
      const item = data !== null && typeof data === 'object' && 'degraded' in data ? (data as { data?: unknown }).data : data;
      return (item as { label?: string } | undefined)?.label;
    } catch (e: any) {
      return [e?.code, e?.status, e?.refusal?.reason, ...(e?.refusal?.candidates ?? []).map((c: any) => c.packageId ?? c.kind)];
    }
  };
  const answer = (m: MetadataManager, type: string, packageId?: string) => answerOf(() => m.get(type, 'helper', packageId));
  /** The bare read, and `getDiagnosed`'s, which agree. */
  const bareAnswers = async (m: MetadataManager) => [await answer(m, 'action'), await answerOf(() => m.getDiagnosed('action', 'helper'))];
  type Row = readonly [packageId: string | null, objectName?: string];
  /** Seeds `rows` of `helper` in save order (the version), each bound to its object when it names one. */
  const seedRows = async (rows: readonly Row[]) => {
    for (const [i, [packageId, objectName]] of rows.entries()) await seed('action', packageId, i + 1, objectName ? { objectName } : {});
  };
  const REFUSED = (...candidates: string[]) => ['RESOURCE_CONFLICT', 409, 'ambiguous-in-environment', ...candidates];
  const registryKeys = (m: MetadataManager, type: string) => [...((m as any).registry.get(type)?.keys() ?? [])].sort();

  beforeEach(() => {
    driver = createMockDriver();
  });

  it('action, one package\'s row and a package-less row saved last (that holder\'s customization), on a host declaring another package: the bare read answers the package-less row, and getDiagnosed agrees (BEFORE: 409 naming the holder, the host and the environment)', async () => {
    await seed('action', ALPHA, 1);
    await seed('action', null, 2);
    const m = await bootPass(HOST);
    // [#32812] FROM `main` `25ee5076`: the host's key (`com.host.app` and
    // `helper` joined by a NUL), and the read naming the holder answering
    // ALPHA's own row. TO: the row unstamped, filed in the name's bare slot,
    // the holder's customization, as on a host that declares no package.
    expect(registryKeys(m, 'action'), 'the pass leaves the row package-less').toEqual(['helper']);
    expect(await answer(m, 'action')).toBe('env');
    const diagnosed = await m.getDiagnosed('action', 'helper');
    expect([(diagnosed.data as { label?: string } | undefined)?.label, diagnosed.degraded]).toEqual(['env', false]);
    expect(await answer(m, 'action', ALPHA), 'a read naming the holder answers its customization').toBe('env');
    expect(await answer(m, 'action', HOST), 'a read naming the host, as before').toBe('env');
  });

  /**
   * Which slots the pass fills for a name two packages hold is the pass's own
   * rule (#32676's pass primes every holder and leaves the package-less row
   * package-less); the read's holders are what this case pins.
   */
  it('CONTROL action, two packages\' rows (or a package\'s and the host\'s own) and a package-less row saved last: the bare read is refused naming both and the environment, never a host that holds nothing', async () => {
    const cells: Array<[string, readonly Row[], unknown]> = [
      [HOST, [[ALPHA], [BETA], [null]], REFUSED(ALPHA, BETA, 'environment')],
      [HOST, [[ALPHA, 'account'], [BETA, 'account'], [null, 'account']], REFUSED(ALPHA, BETA, 'environment')],
      [HOST, [[ALPHA, 'account'], [BETA, 'contact'], [null]], REFUSED(ALPHA, BETA, 'environment')],
      [ALPHA, [[ALPHA, 'account'], [BETA, 'contact'], [null]], REFUSED(ALPHA, BETA, 'environment')],
      [HOST, [[ALPHA], [HOST], [null]], REFUSED(ALPHA, HOST, 'environment')],
    ];
    const seen: unknown[] = [];
    for (const [hostPackage, rows] of cells) {
      driver = createMockDriver();
      await seedRows(rows);
      seen.push(await bareAnswers(await bootPass(hostPackage)));
    }
    expect(seen).toEqual(cells.map(([, , expected]) => [expected, expected]));
  });

  it('action, a package\'s row bound to an object and an object-less package-less row saved last, on a host declaring another package: the bare read answers the environment\'s own item (BEFORE: 409 naming the package and the host)', async () => {
    await seed('action', ALPHA, 1, { objectName: 'account' });
    await seed('action', null, 2);
    const m = await bootPass(HOST);
    // [#32812] FROM `main` `25ee5076`: the host's key. TO: the bare slot.
    expect(registryKeys(m, 'action')).toEqual(['helper']);
    expect(await bareAnswers(m)).toEqual(['env', 'env']);
  });

  /**
   * [#32791, review B1] One package binding the name to two objects is one
   * holder, and the read answers its item written last (#32244) — here the
   * package-less row, that holder's customization of the object it binds, so
   * the row filed in the judged view keeps the write order of the registry
   * slot the pass filled. BEFORE (this branch at `003d6480`, the row filed
   * with no order): the package's other row; on main: `409` naming the host.
   */
  it('action, one package binding the name to two objects and a package-less row saved last, on a host declaring another package: the bare read answers the package-less row, the row written last, in either order of the package\'s rows', async () => {
    const seen: unknown[] = [];
    for (const rows of [
      [[ALPHA, 'account'], [ALPHA, 'contact'], [null, 'account']],
      [[ALPHA, 'contact'], [ALPHA, 'account'], [null, 'account']],
      [[ALPHA], [ALPHA, 'account'], [null]],
      [[ALPHA, 'account'], [ALPHA], [null]],
    ] as const) {
      driver = createMockDriver();
      await seedRows(rows);
      seen.push(await bareAnswers(await bootPass(HOST)));
    }
    expect(seen).toEqual([['env', 'env'], ['env', 'env'], ['env', 'env'], ['env', 'env']]);
  });

  /**
   * [#32791] A package-less row bound to an object, beside one package's row
   * on a host declaring another package: counted once, as the store files it
   * — the holder's customization of the object it binds, or the
   * environment's own item where the package binds the name otherwise.
   */
  it('action, a package-less row bound to an object beside one package\'s row, on a host declaring another package: the bare read answers the package-less row, and getDiagnosed agrees', async () => {
    const seen: unknown[] = [];
    for (const rows of [[[ALPHA, 'account'], [null, 'account']], [[ALPHA], [null, 'account']]] as const) {
      driver = createMockDriver();
      await seedRows(rows);
      seen.push(await bareAnswers(await bootPass(HOST)));
    }
    expect(seen).toEqual([['env', 'env'], ['env', 'env']]);
  });

  /**
   * [#32791, review B2] On a host declaring no package the pass stamps
   * nothing, and the registry's own write rule files the package-less row in
   * the slot of the name's one holder then (D4: its customization). That slot
   * is a holder — only a slot whose package the row is stamped with is the
   * row. BEFORE (this branch at `003d6480`): the package-less row, a pick
   * between two packages; main answers as here.
   */
  it('CONTROL action, a package\'s item in memory before the pass, a package-less row and a second package\'s item, on a host declaring no package: the bare read is refused naming both packages and the environment', async () => {
    await seedRows([[BETA], [null]]);
    const stored = await bootPass(undefined, [ALPHA]);
    expect(await answer(stored, 'action', ALPHA), 'the row is ALPHA\'s customization').toBe('env');
    expect(await bareAnswers(stored)).toEqual([REFUSED(ALPHA, BETA, 'environment'), REFUSED(ALPHA, BETA, 'environment')]);

    driver = createMockDriver();
    await seedRows([[null]]);
    const inMemory = await bootPass(undefined, [ALPHA]);
    registerOwn(inMemory, BETA);
    expect(await bareAnswers(inMemory)).toEqual([REFUSED(ALPHA, BETA, 'environment'), REFUSED(ALPHA, BETA, 'environment')]);
  });

  /** One composition: the host's package, the stored rows, items in memory before the pass, and after it. */
  type InMemoryCell = [hostPackage: string | undefined, rows: Row[], before: InMemory[], after: InMemory[]];
  const bareAfterPass = async ([hostPackage, rows, before, after]: InMemoryCell, passes = 1, keepCache = false) => {
    driver = createMockDriver();
    await seedRows(rows);
    const m = await bootPass(hostPackage, before, passes, keepCache);
    for (const item of after) registerOwn(m, item);
    return bareAnswers(m);
  };
  /**
   * Each cell's bare reads after the pass ran twice on one manager, the
   * loader's cache dropped and then kept between the runs, beside the
   * refusal naming the cell's candidates, which each read should give.
   */
  const afterTwoPasses = async (cells: [InMemoryCell, string[]][]) => {
    const seen: unknown[] = [];
    const expected: unknown[] = [];
    for (const keepCache of [false, true]) {
      for (const [cell, candidates] of cells) {
        seen.push(await bareAfterPass(cell, 2, keepCache));
        expected.push([REFUSED(...candidates), REFUSED(...candidates)]);
      }
    }
    return { seen, expected };
  };

  /**
   * [#32791] A package's item registered in memory, and the package-less row
   * the pass registers: the row is counted once, never with the host's
   * package beside it. BEFORE (main before #32791): refused naming the
   * host's package too. [#32812] FROM `main` `25ee5076`, the first cell
   * (ALPHA's item registered after the pass) answered the package-less row;
   * TO: ALPHA's item, the answer on a host that declares no package or ALPHA
   * (the by-host difference #32752 tracked is gone).
   */
  it('action, one package\'s item in memory beside the package-less row the pass registers: the row is counted once, and a host that declares another package answers as one that declares none', async () => {
    const cells: InMemoryCell[] = [
      [HOST, [[null]], [], [ALPHA]],
      [HOST, [[null]], [ALPHA], []],
      [ALPHA, [[null]], [HOST], []],
    ];
    const seen: unknown[] = [];
    for (const cell of cells) seen.push(await bareAfterPass(cell));
    expect(seen).toEqual([[`${ALPHA} code`, `${ALPHA} code`], ['env', 'env'], ['env', 'env']]);
    expect(await bareAfterPass([undefined, [[null]], [], [ALPHA]]), 'the same cell on a host that declares no package').toEqual([`${ALPHA} code`, `${ALPHA} code`]);
  });

  it('action, two packages\' items in memory beside the package-less row the pass stamped, in either order: the bare read is refused naming both and the environment, never the host (BEFORE: the host named too)', async () => {
    const seen: unknown[] = [];
    for (const cell of [
      [HOST, [[BETA], [null]], [ALPHA], []],
      [HOST, [[null]], [ALPHA], [BETA]],
      [HOST, [[null]], [ALPHA, BETA], []],
    ] as InMemoryCell[]) seen.push(await bareAfterPass(cell));
    const refused = REFUSED(ALPHA, BETA, 'environment');
    expect(seen).toEqual([[refused, refused], [refused, refused], [refused, refused]]);
  });

  /**
   * [#32791, epic ruling B] The pass's own write of the stamped row can
   * replace an item the host's package held in memory before it. That item's
   * package held the name, so its slot is a holder, not only the row: beside
   * a second package's row or item the name has two holders and the bare
   * read is refused, as on main (D4 makes the row a customization only of a
   * name exactly one package holds). Beside no other package, the row is
   * the one holder's. BEFORE (this branch at `031037638d`, the slot set
   * aside): the package-less row, a pick between two packages.
   */
  it('CONTROL action, the stamped row replacing the host\'s package\'s item in memory, beside a second package\'s row or item in either order: the bare read is refused naming both packages and the environment', async () => {
    const seen: unknown[] = [];
    for (const cell of [
      [ALPHA, [[BETA], [null]], [ALPHA], []],
      [ALPHA, [[null], [BETA]], [ALPHA], []],
      [ALPHA, [[null]], [ALPHA], [BETA]],
      [ALPHA, [[null]], [ALPHA, BETA], []],
      [ALPHA, [[null]], [BETA, ALPHA], []],
      [HOST, [[ALPHA], [null]], [HOST], []],
    ] as InMemoryCell[]) seen.push(await bareAfterPass(cell));
    const refused = (...candidates: string[]) => [REFUSED(...candidates), REFUSED(...candidates)];
    expect(seen).toEqual([
      refused(ALPHA, BETA, 'environment'),
      refused(ALPHA, BETA, 'environment'),
      refused(ALPHA, BETA, 'environment'),
      refused(ALPHA, BETA, 'environment'),
      refused(BETA, ALPHA, 'environment'),
      refused(HOST, ALPHA, 'environment'),
    ]);
  });

  /**
   * [#32791, review S3] The pass run again on the same manager hands out a
   * new row object, which replaces the marked row in the host's slot. The
   * new row carries the mark, so ruling B's compositions (and r1's S1(c)
   * cell, in either save order) stay refused, with the loader's cache kept
   * or dropped between the runs, as on main. Without the carried mark the
   * slot was set aside and the read answered the package-less row.
   */
  it('CONTROL action, the pass run twice on the same manager after the stamped row replaced the host\'s package\'s item in memory, beside a second package\'s row or item: still refused naming both packages and the environment (review S3)', async () => {
    const cells: [InMemoryCell, string[]][] = [
      [[ALPHA, [[BETA], [null]], [ALPHA], []], [ALPHA, BETA, 'environment']],
      [[ALPHA, [[null], [BETA]], [ALPHA], []], [ALPHA, BETA, 'environment']],
      [[ALPHA, [[null]], [ALPHA], [BETA]], [ALPHA, BETA, 'environment']],
      [[ALPHA, [[null]], [ALPHA, BETA], []], [ALPHA, BETA, 'environment']],
      [[ALPHA, [[null]], [BETA, ALPHA], []], [BETA, ALPHA, 'environment']],
      [[HOST, [[ALPHA], [null]], [HOST], []], [HOST, ALPHA, 'environment']],
      [[HOST, [[null], [ALPHA]], [HOST], []], [HOST, ALPHA, 'environment']],
    ];
    const { seen, expected } = await afterTwoPasses(cells);
    expect(seen).toEqual(expected);
  });

  /**
   * [#32791, review S3, epic ruling of 22:50Z] The same two runs of the pass
   * on one manager, over the shapes the epic read measured beside ruling
   * B's: the packages swapped (a host declaring BETA), the rows and the
   * host's package's item bound to objects (ALPHA's item and the package-less
   * row on `account`, BETA's row on `contact`), and review B2's two cells on
   * a host declaring no package. Each is refused as after one pass, and as
   * on main. Without the carried mark the first two answered the package-less
   * row; B2's two are held by the carried mark and by the stamp condition
   * alike, so they answered the row only with both removed.
   */
  it('CONTROL action, the pass run twice on the same manager with the packages swapped, with the rows and the item in memory bound to objects, and in review B2\'s two cells on a host declaring no package: still refused (review S3)', async () => {
    const { seen, expected } = await afterTwoPasses([
      [[BETA, [[ALPHA], [null]], [BETA], []], [BETA, ALPHA, 'environment']],
      [[ALPHA, [[BETA, 'contact'], [null, 'account']], [[ALPHA, 'account']], []], [ALPHA, BETA]],
      [[undefined, [[BETA], [null]], [ALPHA], []], [ALPHA, BETA, 'environment']],
      [[undefined, [[null]], [ALPHA], [BETA]], [ALPHA, BETA, 'environment']],
    ]);
    expect(seen).toEqual(expected);
  });

  it('CONTROL action, the pass run twice on the same manager after the stamped row replaced the host\'s package\'s item in memory, beside no other package: the bare read still answers the package-less row (review S3)', async () => {
    const seen: unknown[] = [];
    for (const keepCache of [false, true]) seen.push(await bareAfterPass([ALPHA, [[null]], [ALPHA], []], 2, keepCache));
    expect(seen).toEqual([['env', 'env'], ['env', 'env']]);
  });

  it('CONTROL action, the stamped row replacing the host\'s package\'s item in memory, beside no other package: the bare read answers the package-less row', async () => {
    expect(await bareAfterPass([ALPHA, [[null]], [ALPHA], []])).toEqual(['env', 'env']);
  });

  /**
   * [#32791, review N1; #32812] The package-less row removed from the table
   * behind the manager: the registry's copy is counted as the one holder's
   * customization, as on a host that declares no package. FROM `main`
   * `25ee5076`: refused naming the host's package, which holds nothing, and
   * ALPHA. TO: the registry's copy.
   */
  it('action, the package-less row removed from the table behind the manager after the pass: the host\'s package is never a holder, as on a host that declares none', async () => {
    const seen: unknown[] = [];
    for (const hostPackage of [HOST, undefined]) {
      driver = createMockDriver();
      await seedRows([[ALPHA], [null]]);
      const m = await bootPass(hostPackage);
      seen.push(await bareAnswers(m));
      await driver.delete('sys_metadata', 'action_env_2');
      for (const loader of (m as any).loaders.values()) (loader as DatabaseLoader).invalidateAll();
      seen.push(await bareAnswers(m));
    }
    expect(seen).toEqual([['env', 'env'], ['env', 'env'], ['env', 'env'], ['env', 'env']]);
  });

  it('CONTROL every by-package type, one package\'s row and a package-less row: the bare read answers the row the pass registered — the package-less row saved last, the holder\'s row saved last — on a host declaring no package, the holder, or another (action\'s package-less row saved last on another host: the first case)', async () => {
    const seen: unknown[] = [];
    const cells = (type: string, order: string) =>
      [undefined, ALPHA, HOST].filter((hostPackage) => !(type === 'action' && order === 'package-less row saved last' && hostPackage === HOST));
    for (const type of UNBUNDLED) {
      for (const order of ['package-less row saved last', 'package-less row saved first'] as const) {
        for (const hostPackage of cells(type, order)) {
          driver = createMockDriver();
          if (order === 'package-less row saved last') {
            await seed(type, ALPHA, 1);
            await seed(type, null, 2);
          } else {
            await seed(type, null, 1);
            await seed(type, ALPHA, 2);
          }
          seen.push([type, order, hostPackage ?? 'no host package', await answer(await bootPass(hostPackage), type)]);
        }
      }
    }
    expect(seen).toEqual(UNBUNDLED.flatMap((type) => [
      ...cells(type, 'package-less row saved last').map((hostPackage) => [type, 'package-less row saved last', hostPackage ?? 'no host package', 'env']),
      ...cells(type, 'package-less row saved first').map((hostPackage) => [type, 'package-less row saved first', hostPackage ?? 'no host package', ALPHA]),
    ]));
    expect(seen).toHaveLength(UNBUNDLED.length * 6 - 1);
  });

  it('CONTROL action, the host\'s own item registered in memory beside one package\'s stored row: the host is a holder — the bare read is refused naming both', async () => {
    await seed('action', ALPHA, 1);
    const m = await bootPass(HOST);
    registerOwn(m, HOST);
    expect(registryKeys(m, 'action')).toEqual([`${ALPHA}\u0000helper`, `${HOST}\u0000helper`]);
    expect(await bareAnswers(m)).toEqual([REFUSED(ALPHA, HOST), REFUSED(ALPHA, HOST)]);
  });

  /**
   * [#32812] The state after the pass and a write that carries no package
   * (PR #32802's TO held for the boot state only, epic ruling C). One
   * package's row, a package-less row saved last, a host declaring another
   * package; then `register` with no package, or `registerInMemory` of a
   * package-less item, of the name. The written item is that one holder's
   * customization (D4), so the bare read answers it, as before #32560.
   * BEFORE (main `25ee5076`): `409` naming the host's package, which holds
   * nothing, beside the holder and the environment.
   */
  it('action, after the pass on a host declaring another package, a register with no package of a name one package holds: the bare read answers the written body, and getDiagnosed agrees (BEFORE: 409 naming the host, the holder and the environment)', async () => {
    await seedRows([[ALPHA], [null]]);
    const m = await bootPass(HOST);
    await m.register('action', 'helper', { name: 'helper', label: 'written' });
    expect(await bareAnswers(m)).toEqual(['written', 'written']);
  });

  it('action, after the pass on a host declaring another package, a registerInMemory of a package-less item of a name one package holds: the bare read answers the item, and getDiagnosed agrees (BEFORE: 409 naming the host, the holder and the environment)', async () => {
    await seedRows([[ALPHA], [null]]);
    const m = await bootPass(HOST);
    m.registerInMemory('action', 'helper', { name: 'helper', label: 'in memory' });
    expect(await bareAnswers(m)).toEqual(['in memory', 'in memory']);
  });

  /**
   * [#32812, #32813's subject in this composition] The removal naming no
   * package counts the holders the bare read counts: right after the pass
   * and after a register with no package, on a host declaring another
   * package exactly as on one declaring none. FROM `main` `25ee5076`: the
   * removal right after the pass was refused naming the host's package,
   * ALPHA and the environment while the bare read answered the package-less
   * row (PR #32802's acceptance note). TO: it removes the package-less row,
   * and the bare read then answers ALPHA's row; after the write, which the
   * table took into ALPHA's row (its customization, D4), ALPHA's row answers
   * the written body.
   */
  it('action, one package\'s row and a package-less row saved last: the removal naming no package agrees with the bare read, on a host declaring another package as on one declaring none', async () => {
    const removal = async (m: MetadataManager) => answerOf(async () => {
      await m.unregister('action', 'helper');
      return { label: 'removed' };
    });
    const seen: Record<string, unknown[]> = {};
    for (const hostPackage of [HOST, undefined]) {
      for (const write of [false, true]) {
        driver = createMockDriver();
        await seedRows([[ALPHA], [null]]);
        const m = await bootPass(hostPackage);
        if (write) await m.register('action', 'helper', { name: 'helper', label: 'written' });
        const before = await bareAnswers(m);
        const removed = await removal(m);
        seen[`${hostPackage ?? 'none'} ${write ? 'after a write' : 'after the pass'}`] = [...before, removed, ...(await bareAnswers(m))];
      }
    }
    expect(seen).toEqual({
      [`${HOST} after the pass`]: ['env', 'env', 'removed', ALPHA, ALPHA],
      [`${HOST} after a write`]: ['written', 'written', 'removed', 'written', 'written'],
      'none after the pass': ['env', 'env', 'removed', ALPHA, ALPHA],
      'none after a write': ['written', 'written', 'removed', 'written', 'written'],
    });
  });

  /**
   * [#32812] Every by-package type, the card's composition and a register
   * with no package after the pass: the bare read answers the written body
   * on a host declaring another package, as on one declaring none. CONTROL
   * for the eight types other than `action`, whose bare read does not judge
   * the loaders' slots (`judgesLoaderSlots`); `action` is the card's first
   * row.
   */
  it('every by-package type, one package\'s row and a package-less row saved last, then a register with no package: the bare read answers the written body on a host declaring another package or none', async () => {
    const seen: unknown[] = [];
    for (const type of UNBUNDLED) {
      for (const hostPackage of [HOST, undefined]) {
        driver = createMockDriver();
        await seed(type, ALPHA, 1);
        await seed(type, null, 2);
        const m = await bootPass(hostPackage);
        await m.register(type, 'helper', { name: 'helper', label: 'written' });
        seen.push([type, hostPackage ?? 'none', await answer(m, type)]);
      }
    }
    expect(seen).toEqual(UNBUNDLED.flatMap((type) => [[type, HOST, 'written'], [type, 'none', 'written']]));
  });

  /**
   * [#32812] `email_template` (bundled), one package's row and a package-less
   * row saved last: the pass files the package-less row in the holder's slot
   * (its customization), on a host declaring another package as on one
   * declaring none. FROM `main` `25ee5076`: the host's slot beside the
   * holder's, and the bare read refused naming the holder and the host.
   */
  it('email_template, one package\'s row and a package-less row saved last: the pass files the row in the holder\'s slot and the bare read answers it, on a host declaring another package as on one declaring none', async () => {
    const seen: unknown[] = [];
    for (const hostPackage of [HOST, undefined]) {
      driver = createMockDriver();
      await seed('email_template', ALPHA, 1);
      await seed('email_template', null, 2);
      const m = await bootPass(hostPackage);
      seen.push([hostPackage ?? 'none', registryKeys(m, 'email_template'), await answer(m, 'email_template')]);
    }
    expect(seen).toEqual([[HOST, [`${ALPHA}\u0000helper`], 'env'], ['none', [`${ALPHA}\u0000helper`], 'env']]);
  });
});

/**
 * [#32458; #31699 R4-B's shape, epic ruling 6799056319] Every unbundled type
 * stored per `(package, name)` (`PACKAGE_SLOTTED_STORE_TYPES` less the bundled
 * ones): `MetadataManager.loadMany` hands a row bound to its package by the
 * `package_id` column alone on stamped with that package, and a save of a body
 * that differs from its row only by that stamp writes nothing.
 *
 * BEFORE (measured at 27abd458, same fixtures, all five types alike): with two
 * packages' rows of one name, `loadMany` answered the row saved last unstamped;
 * registered back without the R5-A source skip, its save inserted a
 * package-less row (version 3). The real boot pass wrote nothing (R5-A) but
 * registered that body into the name's package-less slot, or on a host that
 * declares a `packageId` into the host's slot, so `get(type, name, ALPHA)`
 * served beta's body, and a read naming a package that holds nothing (the
 * host's, or any other) served it too.
 */
describe('[#32458] an unbundled slotted type\'s rows bound by the column only', () => {
  const ALPHA = 'com.alpha.app';
  const BETA = 'com.beta.app';
  const HOST = 'com.host.app';
  const UNBUNDLED = [...PACKAGE_SLOTTED_STORE_TYPES].filter((type) => !isBundledStoreType(type));
  let driver: IDataDriver;

  // Bound by the `package_id` column; the body names no package (the protocol writes none).
  const seed = (type: string, packageId: string, version: number) =>
    driver.create('sys_metadata', {
      id: `${type}_${packageId}`, type, name: 'helper', state: 'active', version, checksum: `${type}_${packageId}`,
      source: 'database', package_id: packageId, metadata: JSON.stringify({ name: 'helper', label: packageId }),
    });
  const stored = async (type: string) =>
    ((await driver.find('sys_metadata', { where: { type } } as never)) as Array<Record<string, any>>)
      .map((row) => [row.package_id ?? null, JSON.parse(row.metadata).label, row.version])
      .sort((a, b) => String(a).localeCompare(String(b)));
  const manager = () => {
    const m = new MetadataManager({ formats: ['json'], loaders: [] });
    m.registerLoader(new DatabaseLoader({ driver }));
    return m;
  };
  /** The real pass (`MetadataPlugin._loadFromFileSystem`) over one database loader. */
  const bootPass = async (packageId?: string) => {
    const plugin = new MetadataPlugin({ ...(packageId ? { packageId } : {}), watch: false, config: { bootstrap: 'eager' } });
    const m = (plugin as any).manager as MetadataManager;
    (m as any).loaders.clear();
    m.registerLoader(new DatabaseLoader({ driver }));
    await (plugin as any)._loadFromFileSystem({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } });
    return m;
  };
  /** The package stamp and label a read answers; `undefined` for none. */
  const read = async (m: MetadataManager, type: string, packageId?: string) => {
    const item = (await m.get(type, 'helper', packageId)) as { _packageId?: string; label?: string } | undefined;
    return item && [item._packageId ?? null, item.label];
  };

  beforeEach(() => {
    driver = createMockDriver();
  });

  it('every body loadMany answered is kept: a file-system body its keyed read cannot name, and a row whose name column is empty (BEFORE this PR\'s first head: both dropped)', async () => {
    const rootDir = mkdtempSync(join(tmpdir(), 'i32458-'));
    try {
      for (const type of UNBUNDLED) {
        mkdirSync(join(rootDir, type, 'crm'), { recursive: true });
        writeFileSync(join(rootDir, type, 'flat.json'), JSON.stringify({ name: 'flat', label: 'flat' }));
        writeFileSync(join(rootDir, type, 'crm', 'nested.json'), JSON.stringify({ label: 'nested nameless' }));
        writeFileSync(join(rootDir, type, 'extensionless'), JSON.stringify({ label: 'extension-less nameless' }));
        await driver.create('sys_metadata', {
          id: `${type}_unnamed`, type, name: null, state: 'active', version: 1, checksum: `${type}_unnamed`,
          source: 'database', package_id: ALPHA, metadata: JSON.stringify({ label: 'empty name column' }),
        });
        await seed(type, BETA, 2);
        const m = new MetadataManager({ formats: ['json'], loaders: [] });
        m.registerLoader(new FilesystemLoader(rootDir, new Map([['json', new JSONSerializer()]]) as never));
        m.registerLoader(new DatabaseLoader({ driver }));
        const labels = ((await m.loadMany(type)) as Array<{ label: string; _packageId?: string }>)
          .map((item) => [item._packageId ?? null, item.label]);
        expect(labels).toEqual(expect.arrayContaining([
          [null, 'flat'], [null, 'nested nameless'], [null, 'extension-less nameless'], [null, 'empty name column'], [BETA, BETA],
        ]));
        expect(labels).toHaveLength(5);
      }
    } finally {
      rmSync(rootDir, { recursive: true, force: true });
    }
  });

  it('the types are taken from the tree', () => {
    expect(UNBUNDLED).toEqual(expect.arrayContaining(['api', 'agent', 'skill', 'action', 'permission']));
    expect(UNBUNDLED).not.toContain('email_template');
  });

  it('a body whose name is another row\'s key is never stamped with that row\'s package (contract review F3)', async () => {
    for (const type of UNBUNDLED) {
      for (const strayPackage of [BETA, null]) {
        driver = createMockDriver();
        // Row keyed `b` whose body says `name: 'a'` — storable through `save`, which does not refuse a
        // name that disagrees with its key — beside row `a` bound to ALPHA by the column alone.
        await driver.create('sys_metadata', {
          id: `${type}_stray`, type, name: 'b', state: 'active', version: 1, checksum: `${type}_stray`,
          source: 'database', package_id: strayPackage, metadata: JSON.stringify({ name: 'a', label: 'stray' }),
        });
        await driver.create('sys_metadata', {
          id: `${type}_alpha`, type, name: 'a', state: 'active', version: 2, checksum: `${type}_alpha`,
          source: 'database', package_id: ALPHA, metadata: JSON.stringify({ name: 'a', label: ALPHA }),
        });
        // Main's answer for the name: the body `loadMany` keeps first, unstamped.
        expect(await manager().loadMany(type)).toEqual([{ name: 'a', label: 'stray' }]);
        const m = await bootPass();
        expect([...((m as any).registry.get(type)?.keys() ?? [])]).toEqual(['a']);
      }
      // Row `a` bound to ALPHA whose own body says `name: 'z'`, beside a row whose `name` column is
      // empty and whose body says `name: 'a'`: neither body is ALPHA's row's by its name.
      driver = createMockDriver();
      await driver.create('sys_metadata', {
        id: `${type}_alpha`, type, name: 'a', state: 'active', version: 1, checksum: `${type}_alpha`,
        source: 'database', package_id: ALPHA, metadata: JSON.stringify({ name: 'z', label: ALPHA }),
      });
      await driver.create('sys_metadata', {
        id: `${type}_unkeyed`, type, name: null, state: 'active', version: 2, checksum: `${type}_unkeyed`,
        source: 'database', package_id: null, metadata: JSON.stringify({ name: 'a', label: 'unkeyed' }),
      });
      const items = (await manager().loadMany(type)) as Array<{ label: string; _packageId?: string }>;
      expect(items.map((item) => [item._packageId ?? null, item.label]))
        .toEqual(expect.arrayContaining([[null, ALPHA], [null, 'unkeyed']]));
      expect(items).toHaveLength(2);
    }
  });

  for (const type of UNBUNDLED) {
    it(`${type}: two holders — loadMany stamps the row's package, and registering it back leaves every row unchanged (BEFORE: unstamped, a package-less row inserted)`, async () => {
      await seed(type, ALPHA, 1);
      await seed(type, BETA, 2);
      const before = await stored(type);
      const m = manager();
      const items = (await m.loadMany(type)) as Array<{ name: string; label: string; _packageId?: string }>;
      // [#32521] Both holders, each stamped with its own row's package (BEFORE #32521: BETA's alone).
      expect(items.map((item) => [item._packageId, item.label])).toEqual([[ALPHA, ALPHA], [BETA, BETA]]);
      for (const item of items) await m.register(type, item.name, item, { notify: false });
      expect(await stored(type)).toEqual(before);
      expect((await stored(type)).filter(([packageId]) => packageId === null)).toEqual([]);
      expect(driver.create).toHaveBeenCalledTimes(2);
      expect(driver.update).not.toHaveBeenCalled();
    });

    it(`${type}: the boot pass registers the row under its own package, never the host's or none (BEFORE: ALPHA's read served BETA's body)`, async () => {
      await seed(type, ALPHA, 1);
      await seed(type, BETA, 2);
      const before = await stored(type);
      for (const host of [undefined, HOST]) {
        const m = await bootPass(host);
        // [#32521] Every holder is primed (BEFORE #32521: BETA's slot alone, and ALPHA's read
        // answered its unstamped row through the loaders).
        expect([...((m as any).registry.get(type)?.keys() ?? [])]).toEqual([`${ALPHA}\u0000helper`, `${BETA}\u0000helper`]);
        expect(await read(m, type, ALPHA)).toEqual([ALPHA, ALPHA]);
        expect(await read(m, type, BETA)).toEqual([BETA, BETA]);
        expect(await read(m, type, HOST)).toBeUndefined();
      }
      expect(await stored(type)).toEqual(before);
      expect(driver.update).not.toHaveBeenCalled();
    });

    it(`${type}: a save whose body is its row's plus that row's own package stamp writes nothing`, async () => {
      await seed(type, ALPHA, 1);
      await seed(type, BETA, 2);
      const before = await stored(type);
      await new DatabaseLoader({ driver }).save(type, 'helper', { name: 'helper', label: ALPHA, _packageId: ALPHA });
      expect(await stored(type)).toEqual(before);
      expect(driver.update).not.toHaveBeenCalled();
      expect(driver.create).toHaveBeenCalledTimes(2);
    });

    it(`${type}: one holder — the boot pass writes nothing, and a bare read answers the unique holder, now stamped with its package (BEFORE: unstamped)`, async () => {
      await seed(type, ALPHA, 1);
      const before = await stored(type);
      const m = await bootPass();
      expect(await read(m, type)).toEqual([ALPHA, ALPHA]);
      expect(await read(m, type, ALPHA)).toEqual([ALPHA, ALPHA]);
      expect(await read(m, type, 'com.gamma.app')).toBeUndefined();
      expect(await stored(type)).toEqual(before);
      expect(driver.update).not.toHaveBeenCalled();
    });
  }
});

/**
 * [#32521; epic #31527 red lines 2 and 3, epic seat rulings 2026-11-12] The
 * boot priming pass primes every holder of a name two packages hold: the
 * plural reads hand on one item per `(package, name)` of such a name of every
 * type stored per `(package, name)`, so after the pass a bare read of
 * it is refused `409 ambiguous-in-environment` naming both, the same as without
 * the pass, and an unfiltered `list` keeps both. A name one package holds —
 * with or without a package-less row beside it, on any host — hands on one
 * item and answers what it answered (the CONTROL pins).
 *
 * BEFORE (measured at efd4ea3a, #32458's head, same fixtures, the five
 * unbundled types of that head alike; re-measured at main 34890e0e, after
 * #32517, for all nine — `flow`, `picklist`, `mapping` and `dataset` too):
 * `DatabaseLoader.loadMany` / `loadManyKeyed` kept one row per name (the
 * highest version), so the pass registered BETA's row alone and a bare read
 * answered BETA's body. `email_template` (bundled) already kept every row.
 */
describe('[#32521] the boot priming pass primes every holder of a name', () => {
  const ALPHA = 'com.alpha.app';
  const BETA = 'com.beta.app';
  const UNBUNDLED = [...PACKAGE_SLOTTED_STORE_TYPES].filter((type) => !isBundledStoreType(type));
  let driver: IDataDriver;

  /** A row of `helper` bound to `packageId` by the column; `stamped` also names it in the body. */
  const seed = (type: string, packageId: string, version: number, body: Record<string, unknown> = {}) =>
    driver.create('sys_metadata', {
      id: `${type}_${packageId}_${version}`, type, name: 'helper', state: 'active', version, checksum: `${type}_${packageId}_${version}`,
      source: 'database', package_id: packageId, metadata: JSON.stringify({ name: 'helper', label: packageId, ...body }),
    });
  const stored = async (type: string) =>
    ((await driver.find('sys_metadata', { where: { type } } as never)) as Array<Record<string, any>>)
      .map((row) => [row.package_id ?? null, JSON.parse(row.metadata).label, row.version])
      .sort((a, b) => String(a).localeCompare(String(b)));
  const cold = () => {
    const m = new MetadataManager({ formats: ['json'], loaders: [] });
    m.registerLoader(new DatabaseLoader({ driver }));
    return m;
  };
  /** The real pass (`MetadataPlugin._loadFromFileSystem`) over one database loader, on a host that declares `hostPackage`. */
  const bootPass = async (hostPackage?: string, loaders: MetadataLoader[] = [new DatabaseLoader({ driver })]) => {
    const plugin = new MetadataPlugin({ ...(hostPackage ? { packageId: hostPackage } : {}), watch: false, config: { bootstrap: 'eager' } });
    const m = (plugin as any).manager as MetadataManager;
    (m as any).loaders.clear();
    for (const loader of loaders) m.registerLoader(loader);
    await (plugin as any)._loadFromFileSystem({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } });
    return m;
  };
  /** What a read answers: the refusal's code, status, reason and holders, or the body's label. */
  const answer = async (m: MetadataManager, type: string, name: string, packageId?: string) => {
    try {
      const item = (await m.get(type, name, packageId)) as { label?: string } | undefined;
      return item?.label;
    } catch (e: any) {
      return [e?.code, e?.status, e?.refusal?.reason, ...(e?.refusal?.candidates ?? []).map((c: any) => c.packageId ?? c.kind).sort()];
    }
  };
  const REFUSED = ['RESOURCE_CONFLICT', 409, 'ambiguous-in-environment', ALPHA, BETA];
  const labels = (items: unknown[]) => (items as Array<{ label?: string }>).map((item) => item.label).sort();

  beforeEach(() => {
    driver = createMockDriver();
  });

  for (const type of UNBUNDLED) {
    for (const [shape, body] of [['bound by the column only', {}], ['stamped in the body too', { _packageId: true }]] as const) {
      it(`${type}, ${shape}: two holders — after the pass a bare read is refused 409 naming both, as without it, and list keeps both (BEFORE: BETA's body, list [BETA])`, async () => {
        await seed(type, ALPHA, 1, body._packageId ? { _packageId: ALPHA } : {});
        await seed(type, BETA, 2, body._packageId ? { _packageId: BETA } : {});
        const before = await stored(type);
        expect(await answer(cold(), type, 'helper')).toEqual(REFUSED);
        const m = await bootPass();
        expect([...((m as any).registry.get(type)?.keys() ?? [])].sort()).toEqual([`${ALPHA}\u0000helper`, `${BETA}\u0000helper`]);
        expect(await answer(m, type, 'helper')).toEqual(REFUSED);
        expect(await answer(m, type, 'helper', ALPHA)).toBe(ALPHA);
        expect(await answer(m, type, 'helper', BETA)).toBe(BETA);
        expect(labels(await m.list(type))).toEqual([ALPHA, BETA]);
        expect(await stored(type)).toEqual(before);
        expect(driver.update).not.toHaveBeenCalled();
      });
    }

    it(`${type}: one holder — after the pass a bare read answers it`, async () => {
      await seed(type, ALPHA, 1);
      const m = await bootPass();
      expect(await answer(m, type, 'helper')).toBe(ALPHA);
      expect(labels(await m.list(type))).toEqual([ALPHA]);
    });

    it(`${type}: the loaders-only plural reads keep one item per (package, name), the row saved last of each (BEFORE: one per name, BETA's)`, async () => {
      // A legacy row (empty column, body naming ALPHA) is an older row of ALPHA's slot, never a third holder.
      await driver.create('sys_metadata', {
        id: `${type}_legacy`, type, name: 'helper', state: 'active', version: 0, checksum: `${type}_legacy`,
        source: 'database', package_id: null, metadata: JSON.stringify({ name: 'helper', label: 'alpha older', _packageId: ALPHA }),
      });
      await seed(type, ALPHA, 1);
      await seed(type, BETA, 2);
      const loader = new DatabaseLoader({ driver });
      expect(labels(await loader.loadMany(type))).toEqual([ALPHA, BETA]);
      expect((await loader.loadManyKeyed(type)).map((entry) => [entry.name, entry.packageId, (entry.data as any).label]))
        .toEqual([['helper', ALPHA, ALPHA], ['helper', BETA, BETA]]);
      const m = cold();
      expect((await m.loadMany(type) as Array<Record<string, unknown>>).map((item) => [item._packageId, item.label]))
        .toEqual([[ALPHA, ALPHA], [BETA, BETA]]);
      expect((await m.loadManyKeyed(type)).map((entry) => [entry.name, (entry.data as any).label]))
        .toEqual([['helper', ALPHA], ['helper', BETA]]);
    });
  }

  it('action, each package binding the name to its own object: after the pass a bare read is refused 409 naming both, as without it (BEFORE: BETA\'s action)', async () => {
    await seed('action', ALPHA, 1, { objectName: 'account' });
    await seed('action', BETA, 2, { objectName: 'contact' });
    expect(await answer(cold(), 'action', 'helper')).toEqual(REFUSED);
    const m = await bootPass();
    expect(await answer(m, 'action', 'helper')).toEqual(REFUSED);
    expect(await answer(m, 'action', 'helper', ALPHA)).toBe(ALPHA);
    expect(labels(await m.list('action'))).toEqual([ALPHA, BETA]);
  });

  /** A package-less row of `helper` (no column, no stamp). */
  const seedPackageless = (type: string, version: number) =>
    driver.create('sys_metadata', {
      id: `${type}_env_${version}`, type, name: 'helper', state: 'active', version, checksum: `${type}_env_${version}`,
      source: 'database', package_id: null, metadata: JSON.stringify({ name: 'helper', label: 'env' }),
    });
  const registryKeys = (m: MetadataManager, type: string) => [...((m as any).registry.get(type)?.keys() ?? [])].sort();
  const HOST = 'com.host.app';
  /** The real pass on a host declaring `hostPackage`, over its own file-system loader under `rootDir` and then a database loader. */
  const bootOverFiles = async (rootDir: string, hostPackage: string) => {
    const plugin = new MetadataPlugin({ rootDir, packageId: hostPackage, watch: false, config: { bootstrap: 'eager' } });
    const m = (plugin as any).manager as MetadataManager;
    const fileSystem = [...(m as any).loaders.values()];
    (m as any).loaders.clear();
    for (const loader of [...fileSystem, new DatabaseLoader({ driver })]) m.registerLoader(loader);
    await (plugin as any)._loadFromFileSystem({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } });
    return m;
  };
  /**
   * What the reads answer after the pass for one package's row and a
   * package-less row of a name, measured at `efd4ea3a` (before this change)
   * and unchanged by it: `[order, host package, DatabaseLoader.loadMany,
   * registry keys, bare read, read naming ALPHA, read naming HOST]`.
   * [#32812] The package-less row saved last, on a host declaring ALPHA or
   * another package, now answers as on a host declaring none: the pass leaves
   * the row unstamped. FROM `main` `25ee5076`: host ALPHA, key ALPHA's, read
   * naming HOST nothing; host HOST, key the host's, read naming ALPHA ALPHA's
   * own row. TO: the bare key, every read the package-less row.
   */
  /**
   * The same across two loaders, one holding ALPHA's item and the other a
   * package-less item of the name, measured at `efd4ea3a` and unchanged:
   * `[which loader is earlier, MetadataManager.loadMany, loadManyKeyed,
   * registry keys after the pass, bare read, read naming ALPHA]`.
   */
  const ONE_HOLDER_ACROSS_LOADERS = [
    ['package-less item first', ['memory'], ['memory'], ['helper'], 'memory', 'memory'],
    ['package item first', [ALPHA], [ALPHA], [`${ALPHA}\u0000helper`], ALPHA, ALPHA],
  ];
  const ONE_HOLDER_AND_A_PACKAGELESS_ROW = [
    ['package-less row saved last', 'no host package', ['env'], ['helper'], 'env', 'env', 'env'],
    ['package-less row saved last', ALPHA, ['env'], ['helper'], 'env', 'env', 'env'],
    ['package-less row saved last', HOST, ['env'], ['helper'], 'env', 'env', 'env'],
    ['package-less row saved first', 'no host package', [ALPHA], [`${ALPHA}\u0000helper`], ALPHA, ALPHA, undefined],
    ['package-less row saved first', ALPHA, [ALPHA], [`${ALPHA}\u0000helper`], ALPHA, ALPHA, undefined],
    ['package-less row saved first', HOST, [ALPHA], [`${ALPHA}\u0000helper`], ALPHA, ALPHA, undefined],
  ];

  for (const type of UNBUNDLED) {
    it(`CONTROL ${type}, one package's row and a package-less row of the name (that holder's customization, D4): every read after the pass answers what it answered before — the row saved last — with no host package, a host package equal to the holder, or another`, async () => {
      const seen: unknown[] = [];
      for (const order of ['package-less row saved last', 'package-less row saved first'] as const) {
        for (const hostPackage of [undefined, ALPHA, HOST]) {
          driver = createMockDriver();
          if (order === 'package-less row saved last') {
            await seed(type, ALPHA, 1);
            await seedPackageless(type, 2);
          } else {
            await seedPackageless(type, 1);
            await seed(type, ALPHA, 2);
          }
          const m = await bootPass(hostPackage);
          // [#32791] Fixed: the action cell of the package-less row saved last
          // on a host declaring another package (a bare read judged over the
          // loaders counted the one stored row twice, as the host's package and
          // as the environment, between #32719 and #32791) answers its table
          // row again.
          const bare = await answer(m, type, 'helper');
          seen.push([
            order, hostPackage ?? 'no host package',
            labels(await new DatabaseLoader({ driver }).loadMany(type)),
            registryKeys(m, type),
            bare, await answer(m, type, 'helper', ALPHA), await answer(m, type, 'helper', HOST),
          ]);
          expect(driver.update).not.toHaveBeenCalled();
        }
      }
      expect(seen).toEqual(ONE_HOLDER_AND_A_PACKAGELESS_ROW);
    });

    it(`CONTROL ${type}, one package's item in one loader and a package-less item of the name in another: loadMany hands on the earlier loader's alone, and every read after the pass answers what it answered before`, async () => {
      const seen: unknown[] = [];
      for (const earlier of ['package-less item first', 'package item first'] as const) {
        driver = createMockDriver();
        await seed(type, ALPHA, 1);
        const memory = new MemoryLoader();
        await memory.save(type, 'helper', { name: 'helper', label: 'memory' });
        const loaders = () => {
          const database = new DatabaseLoader({ driver });
          return earlier === 'package-less item first' ? [memory, database] : [database, memory];
        };
        const plain = new MetadataManager({ formats: ['json'], loaders: [] });
        for (const loader of loaders()) plain.registerLoader(loader);
        const m = await bootPass(undefined, loaders());
        seen.push([
          earlier,
          labels(await plain.loadMany(type)), (await plain.loadManyKeyed(type)).map((entry) => (entry.data as any).label),
          registryKeys(m, type), await answer(m, type, 'helper'), await answer(m, type, 'helper', ALPHA),
        ]);
      }
      expect(seen).toEqual(ONE_HOLDER_ACROSS_LOADERS);
    });

    for (const order of ['first', 'between the two', 'last'] as const) {
      it(`${type}, two holders and a package-less row saved ${order}: after the pass a bare read is refused naming both, a read naming a package answers its own item (nothing for a package that holds none) and list keeps the package-less one, as without it, on a host declaring no package, one of the holders, or another (BEFORE: the row saved last)`, async () => {
        for (const hostPackage of [undefined, ALPHA, BETA, HOST]) {
          driver = createMockDriver();
          const writes = [(version: number) => seed(type, ALPHA, version), (version: number) => seed(type, BETA, version)];
          writes.splice(order === 'first' ? 0 : order === 'last' ? 2 : 1, 0, (version: number) => seedPackageless(type, version));
          for (const [at, write] of writes.entries()) await write(at + 1);
          const m = await bootPass(hostPackage);
          for (const packageId of [undefined, ALPHA, BETA, HOST]) {
            expect(await answer(m, type, 'helper', packageId)).toEqual(await answer(cold(), type, 'helper', packageId));
          }
          // [contract review F1] The host's package stamp is kept off the
          // package-less row: stamped, it took ALPHA's slot on a host
          // declaring ALPHA (a read naming ALPHA answered 'env' and list
          // dropped ALPHA's item), and HOST's slot on a host declaring HOST
          // (the bare refusal named three packages and a read naming HOST
          // answered 'env').
          // [#32551] An action's bare refusal also names its package-less holder.
          expect([hostPackage, await answer(m, type, 'helper')]).toEqual([hostPackage, type === 'action' ? [...REFUSED, 'environment'] : REFUSED]);
          expect([hostPackage, await answer(m, type, 'helper', ALPHA)]).toEqual([hostPackage, ALPHA]);
          expect([hostPackage, await answer(m, type, 'helper', BETA)]).toEqual([hostPackage, BETA]);
          expect([hostPackage, await answer(m, type, 'helper', HOST)]).toEqual([hostPackage, undefined]);
          expect([hostPackage, labels(await m.list(type))]).toEqual([hostPackage, labels(await cold().list(type))]);
          expect([hostPackage, labels(await m.list(type))]).toEqual([hostPackage, [ALPHA, BETA, 'env']]);
          expect([hostPackage, registryKeys(m, type)]).toEqual([hostPackage, [`${ALPHA}\u0000helper`, `${BETA}\u0000helper`, 'helper']]);
        }
      });
    }

    // [contract review D1] The host's own file item keeps the host's package
    // stamp under a name other packages hold: only a package-less STORED row
    // stays the environment's own item. Unstamped, the file item went to the
    // bare slot and was saved as a new package-less row, and the host's edit
    // stopped reaching its own slot.
    it(`${type}, the host's own file of a name another package holds, edited after a boot seeded the host's row: after the next pass a read naming the host answers the edited file, the host's row holds it and no package-less row is written, as on main`, async () => {
      const rootDir = mkdtempSync(join(tmpdir(), 'i32521-d1-'));
      try {
        mkdirSync(join(rootDir, type));
        const file = join(rootDir, type, `helper.${type}.yml`);
        writeFileSync(file, 'name: helper\nlabel: file v1\n');
        await bootOverFiles(rootDir, HOST);
        expect(await stored(type)).toEqual([[HOST, 'file v1', 1]]);
        await seed(type, BETA, 1);
        writeFileSync(file, 'name: helper\nlabel: file v2\n');
        const m = await bootOverFiles(rootDir, HOST);
        expect(await answer(m, type, 'helper', HOST)).toBe('file v2');
        expect(await answer(m, type, 'helper', BETA)).toBe(BETA);
        expect((await stored(type)).map(([packageId, label]) => [packageId, label])).toEqual([[BETA, BETA], [HOST, 'file v2']]);
        expect(registryKeys(m, type)).toEqual([`${BETA}\u0000helper`, `${HOST}\u0000helper`]);
      } finally {
        rmSync(rootDir, { recursive: true, force: true });
      }
    });

    it(`${type}, the host's own file of a name two other packages hold, no row of the host's: after the pass a read naming the host answers the file and the host's row is seeded from it, as on main`, async () => {
      const rootDir = mkdtempSync(join(tmpdir(), 'i32521-d1-'));
      try {
        mkdirSync(join(rootDir, type));
        writeFileSync(join(rootDir, type, `helper.${type}.yml`), 'name: helper\nlabel: file\n');
        await seed(type, ALPHA, 1);
        await seed(type, BETA, 2);
        const m = await bootOverFiles(rootDir, HOST);
        expect(await answer(m, type, 'helper', HOST)).toBe('file');
        expect(await answer(m, type, 'helper', ALPHA)).toBe(ALPHA);
        expect(await answer(m, type, 'helper', BETA)).toBe(BETA);
        expect((await stored(type)).map(([packageId, label]) => [packageId, label])).toEqual([[ALPHA, ALPHA], [BETA, BETA], [HOST, 'file']]);
        expect(registryKeys(m, type)).toEqual([`${ALPHA}\u0000helper`, `${BETA}\u0000helper`, `${HOST}\u0000helper`]);
      } finally {
        rmSync(rootDir, { recursive: true, force: true });
      }
    });
  }

  it('agent, two holders of a name and another row\'s body that says the same name: no body of the name is stamped, so none takes a package its row is not bound to (contract review F3 of #32458)', async () => {
    await seed('agent', ALPHA, 1);
    await seed('agent', BETA, 2);
    // Row keyed `stray` whose body says `name: 'helper'`, byte for byte ALPHA's row's body.
    await driver.create('sys_metadata', {
      id: 'agent_stray', type: 'agent', name: 'stray', state: 'active', version: 3, checksum: 'agent_stray',
      source: 'database', package_id: null, metadata: JSON.stringify({ name: 'helper', label: ALPHA }),
    });
    const m = cold();
    expect((await m.loadMany('agent') as Array<Record<string, unknown>>).map((item) => [item._packageId ?? null, item.label]))
      .toEqual([[null, ALPHA]]);
  });

  it('CONTROL email_template (bundled): every row was already primed — a bare read is refused naming both, list keeps both', async () => {
    for (const [packageId, version] of [[ALPHA, 1], [BETA, 2]] as const) {
      await driver.create('sys_metadata', {
        id: `et_${packageId}`, type: 'email_template', name: 'welcome', state: 'active', version, checksum: `et_${packageId}`,
        source: 'database', package_id: packageId, metadata: JSON.stringify({ name: 'welcome', locale: 'en-US', subject: packageId, bodyHtml: '<p/>', label: packageId }),
      });
    }
    expect(await answer(cold(), 'email_template', 'welcome')).toEqual(REFUSED);
    const m = await bootPass();
    expect(await answer(m, 'email_template', 'welcome')).toEqual(REFUSED);
    expect(labels(await m.list('email_template'))).toEqual([ALPHA, BETA]);
    expect((await new DatabaseLoader({ driver }).loadManyKeyed('email_template')).map((entry) => entry.packageId)).toEqual([ALPHA, BETA]);
  });
});
