// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * [#16729] The explicit `tenancy.enabled: false` opt-out is STICKY across a
 * partial `syncSchema` re-registration — the uniqueness partition a
 * platform-global object declares survives a later call that carries only
 * `{ name, fields }`.
 *
 * ## What was broken
 *
 * `InMemoryDriver.syncSchema` recomputed the uniqueness constraints from
 * whatever schema THAT call happened to carry. A second registration without a
 * `tenancy` block fell through to the implicit `organization_id` heuristic, so
 * `scopeField` moved from `null` (one row per install — what
 * `tenancy.enabled: false` declares) to `'organization_id'` (one row per
 * organization). A duplicate the declaration refuses then LANDED, silently:
 * nothing logs the flip, and the refusal message names the field, never the
 * partition. `SqlDriver` had held the same record since #3249; this package
 * mirrored the inner `computeTenantField` and not the wrapper around it.
 *
 * ## Why the negative controls carry as much weight as the positive ones
 *
 * "Preserve the opt-out" has a trivially green wrong implementation: answer
 * `null` always. That passes every assertion about the platform-global object
 * AND switches uniqueness scoping off for every genuinely tenant-scoped one, so
 * two organizations could no longer hold the same record number. Every
 * behavioural case below is therefore paired with the object that must NOT
 * move, and both directions of the record are driven: a carried `tenancy`
 * declaration is authoritative and CLEARS a recorded opt-out.
 *
 * Assertions read `uniqueConstraintsFromFields` and the driver's own refusal —
 * not `tenantFieldOf` alone. The harm surface is the uniqueness partition, and
 * there is a layer between the two.
 */

import { describe, it, expect } from 'vitest';
import { InMemoryDriver } from './memory-driver.js';
import {
  UNIQUE_VIOLATION_CODE,
  UNIQUE_VIOLATION_STATUS,
  computeAndRecordTenantField,
  tenantFieldOf,
  uniqueConstraintsFromDeclaredIndexes,
  uniqueConstraintsFromFields,
  type TenantOptOutRecord,
} from './memory-unique-constraint.js';

/** A platform-global object: declares the opt-out, still carries an org FK. */
const GLOBAL_FIELDS = {
  id: { type: 'string' },
  key: { type: 'string', unique: true },
  organization_id: { type: 'string' },
} as const;

const globalFull = { name: 'sys_license', fields: GLOBAL_FIELDS, tenancy: { enabled: false } };
/** The shape a partial re-registration carries — no `tenancy` block. */
const globalPartial = { name: 'sys_license', fields: GLOBAL_FIELDS };

/** The control: genuinely org-scoped — no `tenancy` block, an org column. */
const scopedPartial = { name: 'crm_account', fields: GLOBAL_FIELDS };

async function seedAndCollide(
  driver: InMemoryDriver,
  object: string,
): Promise<'refused' | 'landed'> {
  await driver.create(object, { id: '1', key: 'K', organization_id: 'org_a' });
  try {
    await driver.create(object, { id: '2', key: 'K', organization_id: 'org_b' });
    return 'landed';
  } catch {
    return 'refused';
  }
}

describe('[#16729] the explicit tenancy opt-out is sticky across a partial re-registration', () => {
  describe('the resolved partition', () => {
    it('keeps scopeField null when a later syncSchema carries no tenancy block', () => {
      const record: TenantOptOutRecord = new Set();
      expect(computeAndRecordTenantField(record, 'sys_license', globalFull)).toBeNull();
      expect(computeAndRecordTenantField(record, 'sys_license', globalPartial)).toBeNull();

      // ⚠️ The partition, not just the tenant column — the damage surface is a
      // layer past `tenantFieldOf`.
      const partition = uniqueConstraintsFromFields(
        globalPartial,
        computeAndRecordTenantField(record, 'sys_license', globalPartial),
      );
      expect(partition).toEqual([{ field: 'key', scopeField: null }]);
    });

    it('leaves a genuinely org-scoped object scoped after the same sequence', () => {
      const record: TenantOptOutRecord = new Set();
      expect(computeAndRecordTenantField(record, 'crm_account', scopedPartial)).toBe('organization_id');
      expect(computeAndRecordTenantField(record, 'crm_account', scopedPartial)).toBe('organization_id');
      expect(
        uniqueConstraintsFromFields(
          scopedPartial,
          computeAndRecordTenantField(record, 'crm_account', scopedPartial),
        ),
      ).toEqual([{ field: 'key', scopeField: 'organization_id' }]);
    });

    it('CLEARS the record when a later schema carries an authoritative tenancy declaration', () => {
      const record: TenantOptOutRecord = new Set();
      computeAndRecordTenantField(record, 'sys_license', globalFull);
      expect(record.has('sys_license')).toBe(true);

      // A carried block is authoritative in BOTH directions. `enabled: true`
      // and a block that declares no opt-out at all each clear the record.
      expect(
        computeAndRecordTenantField(record, 'sys_license', {
          ...globalPartial,
          tenancy: { enabled: true },
        }),
      ).toBe('organization_id');
      expect(record.has('sys_license')).toBe(false);
      // …and having been cleared, the object is scoped again from then on.
      expect(computeAndRecordTenantField(record, 'sys_license', globalPartial)).toBe('organization_id');

      computeAndRecordTenantField(record, 'sys_license', globalFull);
      expect(record.has('sys_license')).toBe(true);
      expect(computeAndRecordTenantField(record, 'sys_license', { ...globalPartial, tenancy: {} })).toBe(
        'organization_id',
      );
      expect(record.has('sys_license')).toBe(false);
    });

    it('hands both declaration surfaces the SAME resolved column', () => {
      const record: TenantOptOutRecord = new Set();
      const declared = {
        ...globalPartial,
        indexes: [{ fields: ['key'], unique: 'organization' }],
      };
      computeAndRecordTenantField(record, 'sys_license', globalFull);
      const tenantField = computeAndRecordTenantField(record, 'sys_license', declared);

      expect(uniqueConstraintsFromFields(declared, tenantField)).toEqual([
        { field: 'key', scopeField: null },
      ]);
      expect(uniqueConstraintsFromDeclaredIndexes(declared, tenantField)).toEqual([
        { columns: ['key'], nullSafeColumns: [] },
      ]);
    });

    it('leaves tenantFieldOf a pure function of its argument', () => {
      // The record is the WRAPPER's business. `tenantFieldOf` still answers
      // from the passed schema alone, which is what its own pins assert.
      const record: TenantOptOutRecord = new Set();
      computeAndRecordTenantField(record, 'sys_license', globalFull);
      expect(tenantFieldOf(globalPartial)).toBe('organization_id');
      expect(tenantFieldOf(globalFull)).toBeNull();
    });
  });

  describe('at the driver door', () => {
    it('refuses a cross-organization duplicate after a partial re-registration', async () => {
      const driver = new InMemoryDriver();
      await driver.syncSchema('sys_license', globalFull);
      await driver.syncSchema('sys_license', globalPartial);

      await driver.create('sys_license', { id: '1', key: 'K', organization_id: 'org_a' });
      await expect(
        driver.create('sys_license', { id: '2', key: 'K', organization_id: 'org_b' }),
      ).rejects.toMatchObject({
        // ⛔ Never merely "it threw" — a bare Error from an unrelated fault
        // passes that and says nothing about the contract (#6144).
        code: UNIQUE_VIOLATION_CODE,
        status: UNIQUE_VIOLATION_STATUS,
      });
    });

    it('still lets two organizations hold the same key on a genuinely scoped object', async () => {
      const driver = new InMemoryDriver();
      await driver.syncSchema('crm_account', scopedPartial);
      await driver.syncSchema('crm_account', scopedPartial);

      expect(await seedAndCollide(driver, 'crm_account')).toBe('landed');
      // …and the partition is still ENFORCED inside one organization.
      await expect(
        driver.create('crm_account', { id: '3', key: 'K', organization_id: 'org_a' }),
      ).rejects.toMatchObject({
        code: UNIQUE_VIOLATION_CODE,
        status: UNIQUE_VIOLATION_STATUS,
      });
    });

    it('re-scopes the object when a later registration declares tenancy authoritatively', async () => {
      const driver = new InMemoryDriver();
      await driver.syncSchema('sys_license', globalFull);
      // A block that declares no opt-out is authoritative and clears the
      // record; `enabled: true` cannot be driven through this door because the
      // #6915 guard refuses a tenant-scoped object outright.
      await driver.syncSchema('sys_license', { ...globalPartial, tenancy: {} });

      expect(await seedAndCollide(driver, 'sys_license')).toBe('landed');
    });

    it('keeps the record per driver instance', async () => {
      const declaring = new InMemoryDriver();
      await declaring.syncSchema('sys_license', globalFull);

      // A second store in the same process is a different store: one store's
      // declaration must not decide another's uniqueness partition.
      const other = new InMemoryDriver();
      await other.syncSchema('sys_license', globalPartial);
      expect(await seedAndCollide(other, 'sys_license')).toBe('landed');

      expect(await seedAndCollide(declaring, 'sys_license')).toBe('refused');
    });
  });
});
