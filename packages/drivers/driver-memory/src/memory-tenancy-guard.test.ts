// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Multi-tenancy boot guard (#6915, mirroring driver-mongodb's #3724 guard).
 *
 * The guard is pure (env posture + object metadata), and this driver holds its
 * store in a plain object, so nothing here needs a server. The driver-level
 * cases assert two things at once: that the refusal fires at construction and
 * at `connect()`, and — the risk this card carries — that the ordinary
 * single-tenant in-process path the dogfood suites, `@objectstack/verify` and
 * the example apps depend on still boots and serves clean.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  assertSingleTenantPosture,
  assertObjectsNotTenantScoped,
  declaresTenantScope,
  MemoryMultiTenantUnsupportedError,
  MULTI_TENANT_UNSUPPORTED_CODE,
} from './memory-tenancy-guard.js';
import { InMemoryDriver } from './memory-driver.js';

const ORIGINAL_MULTI_ORG = process.env.OS_MULTI_ORG_ENABLED;
const ORIGINAL_POSTURE = process.env.OS_TENANCY_POSTURE;

function makeDriver() {
  return new InMemoryDriver({ persistence: false });
}

describe('multi-tenancy boot guard (#6915)', () => {
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
        expect(err).toBeInstanceOf(MemoryMultiTenantUnsupportedError);
        expect((err as any).code).toBe(MULTI_TENANT_UNSUPPORTED_CODE);
        // The message must name the knobs and the escape route, not just fail.
        expect((err as Error).message).toContain('OS_MULTI_ORG_ENABLED');
        expect((err as Error).message).toContain('OS_TENANCY_POSTURE');
        expect((err as Error).message).toContain('@objectstack/driver-sql');
        expect((err as Error).message).toContain('6915');
      }
    });

    it('treats any non-`false` value as enabled (matches resolveMultiOrgEnabled)', () => {
      process.env.OS_MULTI_ORG_ENABLED = '1';
      expect(() => assertSingleTenantPosture()).toThrow(MemoryMultiTenantUnsupportedError);
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
        expect(err).toBeInstanceOf(MemoryMultiTenantUnsupportedError);
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
        // Plural remedy when there is more than one offender.
        expect(message).toContain('these objects');
      }
    });

    it('stays singular for a lone offender — the shape `syncSchema` actually calls', () => {
      try {
        assertObjectsNotTenantScoped([
          { object: 'account', schema: { name: 'account', tenancy: { enabled: true } } },
        ]);
        expect.unreachable('expected the guard to throw');
      } catch (err) {
        const message = (err as Error).message;
        expect(message).toContain('object declaring');
        expect(message).toContain('this object');
      }
    });
  });

  describe('InMemoryDriver wiring', () => {
    it('the constructor refuses in multi-tenant mode', () => {
      process.env.OS_MULTI_ORG_ENABLED = 'true';
      // Construction is the earliest seam, and the only one no escape hatch
      // reaches: `OS_ALLOW_DRIVER_CONNECT_FAILURE=1` downgrades a `connect()`
      // rejection to a warning, which would boot the deployment unisolated.
      expect(() => makeDriver()).toThrow(MemoryMultiTenantUnsupportedError);
    });

    it.each(['isolated', 'group'])('the constructor refuses the `%s` posture', (posture) => {
      process.env.OS_TENANCY_POSTURE = posture;
      expect(() => makeDriver()).toThrow(MemoryMultiTenantUnsupportedError);
    });

    it('connect() refuses when the posture flips after construction', async () => {
      const driver = makeDriver(); // built single-tenant
      process.env.OS_TENANCY_POSTURE = 'isolated';
      await expect(driver.connect()).rejects.toThrow(MemoryMultiTenantUnsupportedError);
    });

    it('syncSchema() refuses a tenant-scoped object, and allocates no table for it', async () => {
      const driver = makeDriver();
      await driver.connect();
      await expect(
        driver.syncSchema('account', { name: 'account', tenancy: { enabled: true } }),
      ).rejects.toThrow(MemoryMultiTenantUnsupportedError);
      // The refusal happens before the store is touched: reading the object back
      // finds nothing was created for it.
      const stats = driver.getSchemaSyncStats?.();
      expect(stats?.created ?? []).not.toContain('account');
    });
  });

  // The risk this card carries is a guard that is too EAGER: `driver-memory` is
  // the in-process store behind the dev stack, the example apps and every
  // single-tenant embedding. None of those set a posture, so none of them may
  // notice this guard exists.
  describe('the ordinary single-tenant path still boots clean', () => {
    it('constructs, connects, syncs and round-trips a record with no posture set', async () => {
      const driver = makeDriver();
      await driver.connect();
      await driver.syncSchema('task', {
        name: 'task',
        fields: { title: { type: 'text' } },
      });
      await driver.create('task', { title: 'hello' });
      const rows = await driver.find('task', {});
      expect(rows).toHaveLength(1);
      expect(rows[0].title).toBe('hello');
      await driver.disconnect?.();
    });

    it('is unaffected by an explicit `single` posture', async () => {
      process.env.OS_TENANCY_POSTURE = 'single';
      const driver = makeDriver();
      await expect(driver.connect()).resolves.not.toThrow();
      await expect(
        driver.syncSchema('task', { name: 'task', fields: {} }),
      ).resolves.not.toThrow();
    });

    it('syncs an object that omits the tenancy block, and one that disables it', async () => {
      const driver = makeDriver();
      await driver.connect();
      await expect(driver.syncSchema('task', { name: 'task' })).resolves.not.toThrow();
      await expect(
        driver.syncSchema('sys_license', { name: 'sys_license', tenancy: { enabled: false } }),
      ).resolves.not.toThrow();
    });
  });
});
