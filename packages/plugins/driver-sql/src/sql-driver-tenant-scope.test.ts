// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqlDriver } from '../src/index.js';

/**
 * Tenant-scope (organization_id) isolation tests.
 *
 * The driver auto-injects `WHERE organization_id = :tenantId` on reads /
 * updates / deletes (and the column on inserts) when:
 *   - The object schema declares an `organization_id` field, AND
 *   - The caller passes `options.tenantId`.
 *
 * Callers that don't pass `tenantId` (system tasks, seed scripts, the
 * legacy admin path) keep getting unscoped behaviour — backward compat.
 */
describe('SqlDriver tenant scope (organization_id)', () => {
  let driver: SqlDriver;

  const objects = [
    {
      name: 'account',
      fields: {
        organization_id: { type: 'string' },
        name: { type: 'string' },
        tier: { type: 'string' },
      },
    },
  ];

  beforeEach(async () => {
    driver = new SqlDriver({
      client: 'better-sqlite3',
      connection: { filename: ':memory:' },
      useNullAsDefault: true,
    });
    await driver.initObjects(objects);

    // Seed: 2 rows in org_a, 2 rows in org_b
    await driver.create('account', { id: 'a1', organization_id: 'org_a', name: 'A1', tier: 'gold' });
    await driver.create('account', { id: 'a2', organization_id: 'org_a', name: 'A2', tier: 'silver' });
    await driver.create('account', { id: 'b1', organization_id: 'org_b', name: 'B1', tier: 'gold' });
    await driver.create('account', { id: 'b2', organization_id: 'org_b', name: 'B2', tier: 'silver' });
  });

  afterEach(async () => {
    await driver.disconnect();
  });

  describe('find', () => {
    it('returns only the caller tenant rows when tenantId is set', async () => {
      const rowsA = await driver.find('account', { object: 'account' }, { tenantId: 'org_a' });
      const rowsB = await driver.find('account', { object: 'account' }, { tenantId: 'org_b' });
      expect(rowsA.map(r => r.id).sort()).toEqual(['a1', 'a2']);
      expect(rowsB.map(r => r.id).sort()).toEqual(['b1', 'b2']);
    });

    it('is unscoped when no tenantId (admin path)', async () => {
      const all = await driver.find('account', { object: 'account' });
      expect(all).toHaveLength(4);
    });
  });

  describe('findOne by id', () => {
    it('cannot read across tenants', async () => {
      const own = await driver.findOne('account', { object: 'account', where: { id: 'a1' } }, { tenantId: 'org_a' });
      const cross = await driver.findOne('account', { object: 'account', where: { id: 'a1' } }, { tenantId: 'org_b' });
      expect(own?.id).toBe('a1');
      expect(cross).toBeNull();
    });
  });

  describe('update', () => {
    it('refuses to update a row owned by another tenant', async () => {
      // org_b tries to update org_a's a1 → no-op
      await driver.update('account', 'a1', { tier: 'compromised' }, { tenantId: 'org_b' });
      const a1 = await driver.findOne('account', { object: 'account', where: { id: 'a1' } });
      expect(a1.tier).toBe('gold');
    });

    it('updates own rows fine', async () => {
      await driver.update('account', 'a1', { tier: 'platinum' }, { tenantId: 'org_a' });
      const a1 = await driver.findOne('account', { object: 'account', where: { id: 'a1' } });
      expect(a1.tier).toBe('platinum');
    });
  });

  describe('delete', () => {
    it('refuses to delete a row owned by another tenant', async () => {
      await driver.delete('account', 'a1', { tenantId: 'org_b' });
      const a1 = await driver.findOne('account', { object: 'account', where: { id: 'a1' } });
      expect(a1).not.toBeNull();
    });
  });

  describe('count / aggregate', () => {
    it('count is scoped', async () => {
      const a = await driver.count!('account', { object: 'account' }, { tenantId: 'org_a' });
      const b = await driver.count!('account', { object: 'account' }, { tenantId: 'org_b' });
      expect(a).toBe(2);
      expect(b).toBe(2);
    });
  });

  describe('create (insert)', () => {
    it('auto-injects organization_id from tenantId when not on the row', async () => {
      const created = await driver.create(
        'account',
        { id: 'a3', name: 'A3' },
        { tenantId: 'org_a' },
      );
      expect(created.organization_id).toBe('org_a');

      const visibleToB = await driver.findOne(
        'account',
        { object: 'account', where: { id: 'a3' } },
        { tenantId: 'org_b' },
      );
      expect(visibleToB).toBeNull();
    });

    it('an explicit organization_id on the row wins over tenantId', async () => {
      // Admin tooling can still write into a specific tenant.
      const created = await driver.create(
        'account',
        { id: 'x1', organization_id: 'org_b', name: 'X1' },
        { tenantId: 'org_a' },
      );
      expect(created.organization_id).toBe('org_b');
    });
  });

  describe('updateMany / deleteMany', () => {
    it('updateMany only touches caller tenant rows', async () => {
      await driver.updateMany!(
        'account',
        { object: 'account', where: { tier: 'gold' } },
        { tier: 'gold-upgraded' },
        { tenantId: 'org_a' },
      );
      const all = await driver.find('account', { object: 'account' });
      const byId = Object.fromEntries(all.map(r => [r.id, r.tier]));
      expect(byId.a1).toBe('gold-upgraded');
      expect(byId.b1).toBe('gold'); // untouched
    });

    it('deleteMany only deletes caller tenant rows', async () => {
      await driver.deleteMany!(
        'account',
        { object: 'account', where: { tier: 'gold' } },
        { tenantId: 'org_a' },
      );
      const remaining = await driver.find('account', { object: 'account' });
      const ids = remaining.map(r => r.id).sort();
      expect(ids).toEqual(['a2', 'b1', 'b2']);
    });
  });

  describe('bulkCreate', () => {
    it('auto-injects organization_id on each row', async () => {
      await driver.bulkCreate!(
        'account',
        [
          { id: 'bc1', name: 'BC1' },
          { id: 'bc2', name: 'BC2' },
        ],
        { tenantId: 'org_a' },
      );
      const rows = await driver.find('account', { object: 'account', where: { id: { $in: ['bc1', 'bc2'] } } });
      expect(rows.every(r => r.organization_id === 'org_a')).toBe(true);
    });
  });

  describe('object without tenant field', () => {
    it('is unscoped even when tenantId is passed', async () => {
      // Re-init with a global object.
      await driver.disconnect();
      driver = new SqlDriver({
        client: 'better-sqlite3',
        connection: { filename: ':memory:' },
        useNullAsDefault: true,
      });
      await driver.initObjects([
        {
          name: 'global_flag',
          fields: { name: { type: 'string' } },
        },
      ]);
      await driver.create('global_flag', { id: 'g1', name: 'G1' });
      const rows = await driver.find('global_flag', { object: 'global_flag' }, { tenantId: 'org_a' });
      expect(rows).toHaveLength(1);
    });
  });

  describe('declared tenancy.tenantField (custom column)', () => {
    it('honors obj.tenancy.tenantField when set', async () => {
      await driver.disconnect();
      driver = new SqlDriver({
        client: 'better-sqlite3',
        connection: { filename: ':memory:' },
        useNullAsDefault: true,
      });
      await driver.initObjects([
        {
          name: 'workspace_item',
          // Custom tenant column name — not the conventional organization_id.
          tenancy: { enabled: true, strategy: 'shared', tenantField: 'workspace_id', crossTenantAccess: false },
          fields: {
            workspace_id: { type: 'string' },
            name: { type: 'string' },
          },
        },
      ]);
      await driver.create('workspace_item', { id: 'w1', name: 'W1' }, { tenantId: 'ws_a' });
      await driver.create('workspace_item', { id: 'w2', name: 'W2' }, { tenantId: 'ws_b' });
      const rowsA = await driver.find('workspace_item', { object: 'workspace_item' }, { tenantId: 'ws_a' });
      expect(rowsA.map(r => r.id)).toEqual(['w1']);
      expect(rowsA[0].workspace_id).toBe('ws_a');
    });
  });

  describe('tenancy.enabled:false opts out of driver org-scoping', () => {
    // Regression: a platform-global object (e.g. sys_license, ADR-0066) keeps an
    // optional, often-NULL `organization_id` FK but declares `tenancy.enabled:
    // false`. The driver previously detected the `organization_id` column via the
    // implicit fallback and org-scoped it anyway, so an authenticated caller's
    // active-org `tenantId` injected `WHERE organization_id = <org>` and the
    // NULL-org rows vanished — the platform admin read zero rows while an
    // unscoped read still saw them. tenancy.enabled:false must win.
    const platformGlobal = [
      {
        name: 'sys_license',
        tenancy: { enabled: false, strategy: 'shared' },
        fields: {
          customer: { type: 'string' },
          organization_id: { type: 'string' }, // optional owner FK, may be NULL
          status: { type: 'string' },
        },
      },
    ];

    beforeEach(async () => {
      await driver.disconnect();
      driver = new SqlDriver({
        client: 'better-sqlite3',
        connection: { filename: ':memory:' },
        useNullAsDefault: true,
      });
      await driver.initObjects(platformGlobal);
      // A NULL-org platform row + an org-mapped one.
      await driver.create('sys_license', { id: 'lic_global', customer: 'ACME', organization_id: null, status: 'active' });
      await driver.create('sys_license', { id: 'lic_org_b', customer: 'Beta', organization_id: 'org_b', status: 'active' });
    });

    it('does NOT register a tenant field for a tenancy-disabled object', () => {
      expect((driver as any).tenantFieldByTable['sys_license']).toBeNull();
    });

    it('read is unscoped even when the caller passes tenantId (admin with active org sees all)', async () => {
      const adminRead = await driver.find('sys_license', { object: 'sys_license' }, { tenantId: 'org_admin_active' });
      expect(adminRead.map(r => r.id).sort()).toEqual(['lic_global', 'lic_org_b']);
    });

    it('matches the unscoped (anonymous) read — no auth-dependent divergence', async () => {
      const scoped = await driver.find('sys_license', { object: 'sys_license' }, { tenantId: 'org_admin_active' });
      const unscoped = await driver.find('sys_license', { object: 'sys_license' });
      expect(scoped.map(r => r.id).sort()).toEqual(unscoped.map(r => r.id).sort());
    });

    it('does NOT auto-inject organization_id on insert when tenancy is disabled', async () => {
      const created = await driver.create('sys_license', { id: 'lic_new', customer: 'Gamma', status: 'active' }, { tenantId: 'org_admin_active' });
      expect(created.organization_id ?? null).toBeNull();
    });
  });

  describe('audit warn on missing tenantId', () => {
    it('logs once per object:op when writing without tenantId', async () => {
      await driver.disconnect();
      const warnSpy: any[] = [];
      driver = new SqlDriver({
        client: 'better-sqlite3',
        connection: { filename: ':memory:' },
        useNullAsDefault: true,
      });
      // Swap logger to capture warns.
      (driver as any).logger = { warn: (msg: string, meta: any) => warnSpy.push({ msg, meta }) };
      // The tenant-audit warning only fires in multi-tenant mode (single-tenant
      // stacks now always have an organization_id column but no isolation).
      (driver as any)._multiTenantMode = true;
      await driver.initObjects(objects);

      await driver.create('account', { id: 'x1', organization_id: 'org_a', name: 'X1' });
      await driver.create('account', { id: 'x2', organization_id: 'org_a', name: 'X2' });
      // Second create on same object:op should NOT add another warn (throttle).
      expect(warnSpy.filter(w => w.meta?.op === 'create')).toHaveLength(1);
    });

    it('does not warn when bypassTenantAudit is set', async () => {
      await driver.disconnect();
      const warnSpy: any[] = [];
      driver = new SqlDriver({
        client: 'better-sqlite3',
        connection: { filename: ':memory:' },
        useNullAsDefault: true,
      });
      (driver as any).logger = { warn: (msg: string, meta: any) => warnSpy.push({ msg, meta }) };
      await driver.initObjects(objects);
      await driver.create(
        'account',
        { id: 'x1', organization_id: 'org_a', name: 'X1' },
        { bypassTenantAudit: true } as any,
      );
      expect(warnSpy).toHaveLength(0);
    });
  });
});
