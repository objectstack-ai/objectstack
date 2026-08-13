// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Multi-tenancy boot guard (#3724).
 *
 * These tests need no MongoDB binary: the guard is pure (env flag + object
 * metadata), and the driver-level assertions exercise `connect()` / schema sync
 * on an unreachable URL — the refusal must happen *before* any I/O.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  assertSingleTenantPosture,
  assertObjectsNotTenantScoped,
  declaresTenantScope,
  MongoDBMultiTenantUnsupportedError,
  MULTI_TENANT_UNSUPPORTED_CODE,
} from './mongodb-tenancy-guard.js';
import { MongoDBDriver } from './mongodb-driver.js';

const ORIGINAL_MULTI_ORG = process.env.OS_MULTI_ORG_ENABLED;
const ORIGINAL_POSTURE = process.env.OS_TENANCY_POSTURE;

/** A URL nothing listens on — reaching the network at all fails these tests. */
const UNREACHABLE_URL = 'mongodb://127.0.0.1:1/never_connected';

function makeDriver() {
  return new MongoDBDriver({
    url: UNREACHABLE_URL,
    database: 'guard_test',
    serverSelectionTimeoutMS: 50,
    connectTimeoutMS: 50,
  });
}

describe('multi-tenancy boot guard (#3724)', () => {
  it('pins the code literal — the CLI boot handler matches it duck-typed', () => {
    // `packages/cli/src/commands/serve.ts` rethrows a driver-construction
    // failure on `e?.code === 'MONGODB_MULTI_TENANT_UNSUPPORTED'` (matched by
    // LITERAL so the CLI keeps no dependency on this package). #8035 removed
    // the code from the spec error-code ledger — it is host boot vocabulary,
    // not wire vocabulary — so this pin is now the only cross-package guard
    // on the literal: silently changing the value would un-arm the CLI's
    // loud-fail path, and the boot would swallow the refusal and come up
    // with NO driver at all (the exact failure #3724 removed).
    expect(MULTI_TENANT_UNSUPPORTED_CODE).toBe('MONGODB_MULTI_TENANT_UNSUPPORTED');
  });

  beforeEach(() => {
    delete process.env.OS_MULTI_ORG_ENABLED;
    delete process.env.OS_TENANCY_POSTURE;
  });

  afterEach(() => {
    if (ORIGINAL_MULTI_ORG === undefined) delete process.env.OS_MULTI_ORG_ENABLED;
    else process.env.OS_MULTI_ORG_ENABLED = ORIGINAL_MULTI_ORG;
    if (ORIGINAL_POSTURE === undefined) delete process.env.OS_TENANCY_POSTURE;
    else process.env.OS_TENANCY_POSTURE = ORIGINAL_POSTURE;
  });

  describe('assertSingleTenantPosture', () => {
    it('passes when nothing is configured (posture derives to `single`)', () => {
      expect(() => assertSingleTenantPosture()).not.toThrow();
    });

    it('passes when OS_MULTI_ORG_ENABLED is explicitly false', () => {
      process.env.OS_MULTI_ORG_ENABLED = 'false';
      expect(() => assertSingleTenantPosture()).not.toThrow();
    });

    it('passes for an explicit single posture', () => {
      process.env.OS_TENANCY_POSTURE = 'single';
      expect(() => assertSingleTenantPosture()).not.toThrow();
    });

    it('throws a coded error when multi-org mode is on', () => {
      process.env.OS_MULTI_ORG_ENABLED = 'true';
      try {
        assertSingleTenantPosture();
        expect.unreachable('expected the guard to throw');
      } catch (err) {
        expect(err).toBeInstanceOf(MongoDBMultiTenantUnsupportedError);
        expect((err as any).code).toBe(MULTI_TENANT_UNSUPPORTED_CODE);
        // The message must name the knobs and the escape route, not just fail.
        expect((err as Error).message).toContain('OS_MULTI_ORG_ENABLED');
        expect((err as Error).message).toContain('OS_TENANCY_POSTURE');
        expect((err as Error).message).toContain('@objectstack/driver-sql');
        expect((err as Error).message).toContain('3724');
      }
    });

    it('treats any non-`false` value as enabled (matches resolveMultiOrgEnabled)', () => {
      process.env.OS_MULTI_ORG_ENABLED = '1';
      expect(() => assertSingleTenantPosture()).toThrow(MongoDBMultiTenantUnsupportedError);
    });

    // OS_TENANCY_POSTURE (ADR-0105 D1) supersedes the boolean — BOTH walled
    // postures need an organization wall this driver cannot draw.
    it.each(['isolated', 'group', 'multi'])(
      'throws for the `%s` posture even with OS_MULTI_ORG_ENABLED unset',
      (posture) => {
        process.env.OS_TENANCY_POSTURE = posture;
        const err = (() => {
          try {
            assertSingleTenantPosture();
            return null;
          } catch (e) {
            return e;
          }
        })();
        expect(err).toBeInstanceOf(MongoDBMultiTenantUnsupportedError);
        // `multi` is the legacy alias, normalized to `isolated` by the resolver.
        expect((err as Error).message).toContain(posture === 'multi' ? 'isolated' : posture);
      },
    );
  });

  describe('declaresTenantScope', () => {
    it('is true only for an explicit tenancy.enabled === true', () => {
      expect(declaresTenantScope({ name: 'task', tenancy: { enabled: true } })).toBe(true);
      expect(declaresTenantScope({ name: 'task', tenancy: { enabled: false } })).toBe(false);
      expect(declaresTenantScope({ name: 'task', tenancy: {} })).toBe(false);
      expect(declaresTenantScope({ name: 'task' })).toBe(false);
      expect(declaresTenantScope(null)).toBe(false);
      expect(declaresTenantScope(undefined)).toBe(false);
    });
  });

  describe('assertObjectsNotTenantScoped', () => {
    it('passes for objects that do not declare tenancy', () => {
      expect(() =>
        assertObjectsNotTenantScoped([
          { object: 'task', schema: { name: 'task' } },
          { object: 'sys_license', schema: { name: 'sys_license', tenancy: { enabled: false } } },
        ]),
      ).not.toThrow();
    });

    it('names every offending object in a single message', () => {
      try {
        assertObjectsNotTenantScoped([
          { object: 'task', schema: { name: 'task' } },
          { object: 'account', schema: { name: 'account', tenancy: { enabled: true } } },
          { object: 'contact', schema: { name: 'contact', tenancy: { enabled: true } } },
        ]);
        expect.unreachable('expected the guard to throw');
      } catch (err) {
        expect((err as any).code).toBe(MULTI_TENANT_UNSUPPORTED_CODE);
        const message = (err as Error).message;
        expect(message).toContain('`account`');
        expect(message).toContain('`contact`');
        expect(message).not.toContain('`task`');
      }
    });
  });

  describe('MongoDBDriver wiring', () => {
    it('the constructor refuses in multi-tenant mode', () => {
      process.env.OS_MULTI_ORG_ENABLED = 'true';
      // Construction is the earliest seam — it fails before a host can hand
      // the driver anywhere. (`connect()` also aborts boot since #3741.)
      expect(() => makeDriver()).toThrow(MongoDBMultiTenantUnsupportedError);
    });

    it('connect() refuses without opening a connection when the posture flips after construction', async () => {
      const driver = makeDriver(); // built single-tenant
      process.env.OS_TENANCY_POSTURE = 'isolated';
      // An unreachable URL would surface a MongoServerSelectionError if the
      // guard let the connection attempt through — the coded error proves the
      // refusal happens first.
      await expect(driver.connect()).rejects.toThrow(MongoDBMultiTenantUnsupportedError);
    });

    it('connect() is not gated when the deployment is single-tenant', async () => {
      const driver = makeDriver();
      // Still fails — the server is unreachable — but NOT with the tenancy guard.
      await expect(driver.connect()).rejects.not.toBeInstanceOf(
        MongoDBMultiTenantUnsupportedError,
      );
    });

    it('syncSchema() refuses a tenant-scoped object before touching the db', async () => {
      const driver = makeDriver();
      await expect(
        driver.syncSchema('account', { name: 'account', tenancy: { enabled: true } }),
      ).rejects.toThrow(MongoDBMultiTenantUnsupportedError);
    });

    it('syncSchemasBatch() refuses when any object is tenant-scoped', async () => {
      const driver = makeDriver();
      await expect(
        driver.syncSchemasBatch([
          { object: 'task', schema: { name: 'task' } },
          { object: 'account', schema: { name: 'account', tenancy: { enabled: true } } },
        ]),
      ).rejects.toThrow(MongoDBMultiTenantUnsupportedError);
    });
  });
});
