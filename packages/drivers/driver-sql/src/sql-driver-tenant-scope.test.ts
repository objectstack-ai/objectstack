// Copyright (c) 2025 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ObjectSchema } from '@objectstack/spec/data';
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
      const rowsA = await driver.find('account', {}, { tenantId: 'org_a' });
      const rowsB = await driver.find('account', {}, { tenantId: 'org_b' });
      expect(rowsA.map(r => r.id).sort()).toEqual(['a1', 'a2']);
      expect(rowsB.map(r => r.id).sort()).toEqual(['b1', 'b2']);
    });

    it('is unscoped when no tenantId (admin path)', async () => {
      const all = await driver.find('account', {});
      expect(all).toHaveLength(4);
    });
  });

  describe('findOne by id', () => {
    it('cannot read across tenants', async () => {
      const own = await driver.findOne('account', { where: { id: 'a1' } }, { tenantId: 'org_a' });
      const cross = await driver.findOne('account', { where: { id: 'a1' } }, { tenantId: 'org_b' });
      expect(own?.id).toBe('a1');
      expect(cross).toBeNull();
    });
  });

  describe('update', () => {
    it('refuses to update a row owned by another tenant', async () => {
      // org_b tries to update org_a's a1 → no-op
      await driver.update('account', 'a1', { tier: 'compromised' }, { tenantId: 'org_b' });
      const a1 = await driver.findOne('account', { where: { id: 'a1' } });
      expect(a1.tier).toBe('gold');
    });

    it('updates own rows fine', async () => {
      await driver.update('account', 'a1', { tier: 'platinum' }, { tenantId: 'org_a' });
      const a1 = await driver.findOne('account', { where: { id: 'a1' } });
      expect(a1.tier).toBe('platinum');
    });
  });

  describe('delete', () => {
    it('refuses to delete a row owned by another tenant', async () => {
      await driver.delete('account', 'a1', { tenantId: 'org_b' });
      const a1 = await driver.findOne('account', { where: { id: 'a1' } });
      expect(a1).not.toBeNull();
    });
  });

  describe('count / aggregate', () => {
    it('count is scoped', async () => {
      const a = await driver.count!('account', {}, { tenantId: 'org_a' });
      const b = await driver.count!('account', {}, { tenantId: 'org_b' });
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
        { where: { id: 'a3' } },
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

  describe('NULL tenant column = GLOBAL/platform row (#2734)', () => {
    beforeEach(async () => {
      // A platform-seeded row with no organization (bootstrap positions,
      // permission sets, business units, pre-org first-boot seeds).
      await driver.create('account', { id: 'g1', name: 'Global', tier: 'global' });
    });

    it('a scoped read still sees the org-less row (any tenant)', async () => {
      const rowsA = await driver.find('account', {}, { tenantId: 'org_a' });
      const rowsB = await driver.find('account', {}, { tenantId: 'org_b' });
      expect(rowsA.map((r: any) => r.id)).toContain('g1');
      expect(rowsB.map((r: any) => r.id)).toContain('g1');
      // …while cross-tenant rows stay hidden exactly as before.
      expect(rowsA.map((r: any) => r.id).sort()).toEqual(['a1', 'a2', 'g1']);
    });

    it('a scoped by-id read resolves the global row', async () => {
      const row = await driver.findOne('account', { where: { id: 'g1' } }, { tenantId: 'org_a' });
      expect(row?.id).toBe('g1');
    });

    it('a scoped count includes the global row', async () => {
      const a = await driver.count!('account', {}, { tenantId: 'org_a' });
      expect(a).toBe(3); // a1, a2, g1 — never org_b's rows
    });
  });

  describe('updateMany / deleteMany', () => {
    it('updateMany only touches caller tenant rows', async () => {
      await driver.updateMany!(
        'account',
        { where: { tier: 'gold' } },
        { tier: 'gold-upgraded' },
        { tenantId: 'org_a' },
      );
      const all = await driver.find('account', {});
      const byId = Object.fromEntries(all.map(r => [r.id, r.tier]));
      expect(byId.a1).toBe('gold-upgraded');
      expect(byId.b1).toBe('gold'); // untouched
    });

    it('deleteMany only deletes caller tenant rows', async () => {
      await driver.deleteMany!(
        'account',
        { where: { tier: 'gold' } },
        { tenantId: 'org_a' },
      );
      const remaining = await driver.find('account', {});
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
      const rows = await driver.find('account', { where: { id: { $in: ['bc1', 'bc2'] } } });
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
      const rows = await driver.find('global_flag', {}, { tenantId: 'org_a' });
      expect(rows).toHaveLength(1);
    });
  });

  /**
   * #5315 — behavioural-equivalence pin for dropping `.default('tenant_id')`
   * from `TenancyConfigSchema.tenantField`.
   *
   * The contract this pins is deliberately end-to-end: metadata goes through
   * `ObjectSchema.parse` (the seam where the default used to materialise) and
   * *then* to the driver, because the default was only ever observable on a
   * PARSED object. An author who writes `tenancy: { enabled: true }` and no
   * `tenantField` must land on `organization_id` — the platform's real tenant
   * column — and must keep landing there across this change:
   *
   *   - before: parse filled `tenantField: 'tenant_id'`, `computeTenantField`
   *     looked for a `tenant_id` column, did not find one, and fell through to
   *     `organization_id`. The right answer by accident.
   *   - after: parse leaves `tenantField` undefined, the declared branch is
   *     skipped outright, and the same fallback yields `organization_id`.
   *     The right answer on purpose (ADR-0078: no declaration nobody reads).
   *
   * Same answer, one fewer fiction in between — so this test is GREEN on both
   * sides of the change by construction. That is the claim, not a weakness of
   * the pin: its job is to fail if anyone reintroduces a default that steers
   * the driver at a column the object does not have.
   */
  describe('#5315 undeclared tenantField resolves to organization_id (parse → driver)', () => {
    it('an object declaring only `tenancy: { enabled: true }` scopes by organization_id', async () => {
      await driver.disconnect();
      driver = new SqlDriver({
        client: 'better-sqlite3',
        connection: { filename: ':memory:' },
        useNullAsDefault: true,
      });

      // Parse through the real spec schema — this is the seam under test.
      const parsed = ObjectSchema.parse({
        name: 'ticket',
        label: 'Ticket',
        tenancy: { enabled: true },
        fields: {
          organization_id: { type: 'text' },
          subject: { type: 'text' },
        },
      });

      await driver.initObjects([parsed as any]);

      // The effective tenant column, whatever the parse did or did not fill in.
      expect((driver as any).tenantFieldByTable['ticket']).toBe('organization_id');

      // …and it actually isolates, rather than merely being recorded.
      await driver.create('ticket', { id: 't1', subject: 'A' }, { tenantId: 'org_a' });
      await driver.create('ticket', { id: 't2', subject: 'B' }, { tenantId: 'org_b' });
      const rowsA = await driver.find('ticket', {}, { tenantId: 'org_a' });
      expect(rowsA.map((r) => r.id)).toEqual(['t1']);
      expect(rowsA[0].organization_id).toBe('org_a');
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
          tenancy: { enabled: true, tenantField: 'workspace_id' },
          fields: {
            workspace_id: { type: 'string' },
            name: { type: 'string' },
          },
        },
      ]);
      await driver.create('workspace_item', { id: 'w1', name: 'W1' }, { tenantId: 'ws_a' });
      await driver.create('workspace_item', { id: 'w2', name: 'W2' }, { tenantId: 'ws_b' });
      const rowsA = await driver.find('workspace_item', {}, { tenantId: 'ws_a' });
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
        tenancy: { enabled: false },
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
      const adminRead = await driver.find('sys_license', {}, { tenantId: 'org_admin_active' });
      expect(adminRead.map(r => r.id).sort()).toEqual(['lic_global', 'lic_org_b']);
    });

    it('matches the unscoped (anonymous) read — no auth-dependent divergence', async () => {
      const scoped = await driver.find('sys_license', {}, { tenantId: 'org_admin_active' });
      const unscoped = await driver.find('sys_license', {});
      expect(scoped.map(r => r.id).sort()).toEqual(unscoped.map(r => r.id).sort());
    });

    it('does NOT auto-inject organization_id on insert when tenancy is disabled', async () => {
      const created = await driver.create('sys_license', { id: 'lic_new', customer: 'Gamma', status: 'active' }, { tenantId: 'org_admin_active' });
      expect(created.organization_id ?? null).toBeNull();
    });

    // #3249: the opt-out must be STICKY. Re-registration paths that pass a
    // partial schema without the `tenancy` block (lifecycle archive
    // `cold.syncSchema(object, obj)`, schema-drift re-sync) previously fell
    // through to the implicit organization_id heuristic and re-scoped the
    // platform-global table — the admin's org-context read then dropped to
    // 0 rows while the anonymous read still saw them.
    it('a later tenancy-less re-registration (syncSchema / drift re-sync) preserves the opt-out (#3249)', async () => {
      await driver.syncSchema('sys_license', {
        name: 'sys_license',
        fields: platformGlobal[0].fields,
      });
      expect((driver as any).tenantFieldByTable['sys_license']).toBeNull();
      const adminRead = await driver.find('sys_license', {}, { tenantId: 'org_admin_active' });
      expect(adminRead.map(r => r.id).sort()).toEqual(['lic_global', 'lic_org_b']);
    });

    it('a tenancy-less registerExternalObject after an explicit opt-out preserves it (#3249)', () => {
      driver.registerExternalObject({ name: 'sys_license', fields: platformGlobal[0].fields });
      expect((driver as any).tenantFieldByTable['sys_license']).toBeNull();
    });

    it('a re-registration WITH an explicit tenancy declaration is authoritative and re-enables scoping', async () => {
      await driver.initObjects([
        { ...platformGlobal[0], tenancy: { enabled: true, tenantField: 'organization_id' } },
      ]);
      expect((driver as any).tenantFieldByTable['sys_license']).toBe('organization_id');
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
      //
      // [#5262] Configured through the real knob rather than by poking the old
      // `_multiTenantMode` memo, which no longer exists: that field froze a
      // process-level fact into a per-instance verdict, and the gate now
      // resolves the tenancy posture live. Setting the env exercises the same
      // resolution a real deployment does; restored in the `finally` below.
      const priorPosture = process.env.OS_TENANCY_POSTURE;
      process.env.OS_TENANCY_POSTURE = 'isolated';
      try {
      await driver.initObjects(objects);

      await driver.create('account', { id: 'x1', organization_id: 'org_a', name: 'X1' });
      await driver.create('account', { id: 'x2', organization_id: 'org_a', name: 'X2' });
      // Second create on same object:op should NOT add another warn (throttle).
      expect(warnSpy.filter(w => w.meta?.op === 'create')).toHaveLength(1);
      } finally {
        if (priorPosture === undefined) delete process.env.OS_TENANCY_POSTURE;
        else process.env.OS_TENANCY_POSTURE = priorPosture;
      }
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
        { bypassTenantAudit: true },
      );
      expect(warnSpy).toHaveLength(0);
    });
  });

  // [ADR-0105 D2 / #3623] Group posture: the engine threads the caller's whole
  // membership set as `tenantIds`; the native scope widens to `IN (...)` so it
  // matches the Layer 0 union instead of collapsing it to active-org equality.
  describe('union tenant scope — tenantIds (group posture, #3623)', () => {
    it('find with tenantIds spans exactly the listed tenants', async () => {
      const rows = await driver.find(
        'account',
        {},
        { tenantId: 'org_a', tenantIds: ['org_a', 'org_b'] } as any,
      );
      expect(rows.map(r => r.id).sort()).toEqual(['a1', 'a2', 'b1', 'b2']);
    });

    it('tenants OUTSIDE the set stay invisible', async () => {
      await driver.create('account', { id: 'c1', organization_id: 'org_c', name: 'C1' });
      const rows = await driver.find(
        'account',
        {},
        { tenantId: 'org_a', tenantIds: ['org_a', 'org_b'] } as any,
      );
      expect(rows.map(r => r.id)).not.toContain('c1');
    });

    it('keeps the NULL-tenant global-row carve-out (#2734) on the union path', async () => {
      await driver.create('account', { id: 'g1', name: 'GLOBAL' });
      const rows = await driver.find(
        'account',
        {},
        { tenantId: 'org_a', tenantIds: ['org_a'] } as any,
      );
      expect(rows.map(r => r.id).sort()).toEqual(['a1', 'a2', 'g1']);
    });

    it('an empty or malformed tenantIds falls back to tenantId equality (fail toward isolation)', async () => {
      const empty = await driver.find(
        'account',
        {},
        { tenantId: 'org_a', tenantIds: [] } as any,
      );
      expect(empty.map(r => r.id).sort()).toEqual(['a1', 'a2']);
      const malformed = await driver.find(
        'account',
        {},
        { tenantId: 'org_a', tenantIds: [null, ''] } as any,
      );
      expect(malformed.map(r => r.id).sort()).toEqual(['a1', 'a2']);
    });

    it('update/delete reach widens with the set — but only within it', async () => {
      const unionOpts = { tenantId: 'org_a', tenantIds: ['org_a', 'org_b'] } as any;
      await driver.update('account', 'b1', { tier: 'platinum' }, unionOpts);
      const b1 = await driver.findOne('account', { where: { id: 'b1' } });
      expect(b1.tier).toBe('platinum');
      // A tenant OUTSIDE the set stays untouchable — the widened wall still walls.
      await driver.create('account', { id: 'c1', organization_id: 'org_c', name: 'C1', tier: 'gold' });
      await driver.update('account', 'c1', { tier: 'compromised' }, unionOpts);
      const c1 = await driver.findOne('account', { where: { id: 'c1' } });
      expect(c1.tier).toBe('gold');
    });

    it('insert injection STILL stamps from tenantId (active org = write target, D5)', async () => {
      await driver.create(
        'account',
        { id: 'n1', name: 'New' },
        { tenantId: 'org_a', tenantIds: ['org_a', 'org_b'] } as any,
      );
      const row = await driver.findOne('account', { where: { id: 'n1' } });
      expect(row?.organization_id).toBe('org_a');
    });
  });
});
