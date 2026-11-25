// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { celEngine } from '@objectstack/formula';
import {
  IndexSchema,
  ObjectSchema,
  STANDARD_UNITS,
  apiExposureDenialReason,
  resolveCrudAffordances,
  resolveInjectedSystemColumns,
} from '@objectstack/spec/data';
import { PLATFORM_OBJECTS_BY_PACKAGE } from '@objectstack/spec/system';
import { SysStandardUnitSetting, STANDARD_UNIT_SETTING_CODES } from './sys-standard-unit-setting.object.js';
import { SysUnit, UNIT_DECIMAL_PLACES_MAX } from './sys-unit.object.js';
import { SETUP_NAV_CONTRIBUTIONS } from '../apps/setup-nav.contributions.js';
import { PlatformObjectsPlugin } from '../plugin.js';

/**
 * ADR-0158 U6, its Open item 10 answered by option A 「组织可改,新开一处设置」:
 * the declaration of the organization's display decimal places for a
 * standard unit code. As in `sys-unit.object.test.ts`, the facts a mechanism
 * elsewhere decides (the organization-scoped unique key, the tenant wall, the
 * grants, the audit writer) are pinned here as the declaration that mechanism
 * reads; the real-stack suite
 * `default-permission-sets.standard-unit-setting.integration.test.ts`
 * (`@objectstack/plugin-security`) drives them. The rule is EVALUATED through
 * the canonical CEL engine in the scope the rule validator binds.
 */
describe('sys_standard_unit_setting — declaration (ADR-0158 U6, Open item 10)', () => {
  const fields = SysStandardUnitSetting.fields as Record<string, any>;
  const rules = (SysStandardUnitSetting.validations ?? []) as Array<Record<string, any>>;

  it('parses as an ObjectSchema and is a platform object of this package', () => {
    expect(() => ObjectSchema.parse(SysStandardUnitSetting)).not.toThrow();
    expect(PLATFORM_OBJECTS_BY_PACKAGE['platform-objects']).toContain('sys_standard_unit_setting');
  });

  it('carries exactly a code and its decimal places, both required', () => {
    expect(Object.keys(fields).sort()).toEqual(['code', 'decimal_places', 'id']);
    expect(fields.code.required).toBe(true);
    expect(fields.decimal_places.required).toBe(true);
  });

  describe('values', () => {
    it("code is a select over exactly the standard unit table's codes, in its order (U1)", () => {
      expect(fields.code.type).toBe('select');
      expect(fields.code.options.map((o: any) => o.value)).toEqual(Object.keys(STANDARD_UNITS));
      expect(STANDARD_UNIT_SETTING_CODES).toEqual(Object.keys(STANDARD_UNITS));
      // An organization's own unit carries its decimal places on its own row (U3, U6).
      expect(fields.code.options.map((o: any) => o.value)).not.toContain('BOX_12');
    });

    it("decimal_places is a whole number from 0 to 12, sys_unit's range, with no default (U6, L4)", () => {
      expect(fields.decimal_places.type).toBe('number');
      expect(fields.decimal_places.scale).toBe(0);
      expect(fields.decimal_places.min).toBe(0);
      expect(fields.decimal_places.max).toBe(UNIT_DECIMAL_PLACES_MAX);
      expect((SysUnit.fields as any).decimal_places).toMatchObject({ min: 0, max: UNIT_DECIMAL_PLACES_MAX, scale: 0 });
      expect(fields.decimal_places.defaultValue).toBeUndefined();
    });
  });

  it("declares exactly one unique key, on code, scoped 'organization'", () => {
    const unique = (SysStandardUnitSetting.indexes ?? []).filter((i: any) => i.unique);
    expect(unique).toHaveLength(1);
    expect((unique[0] as any).fields).toEqual(['code']);
    expect(IndexSchema.parse(unique[0])).toMatchObject({ unique: 'organization' });
  });

  it('takes no tenancy opt-out, so organization_id is injected and the tenant wall scopes it', () => {
    const plan = resolveInjectedSystemColumns(SysStandardUnitSetting);
    expect((SysStandardUnitSetting as any).tenancy).toBeUndefined();
    expect((SysStandardUnitSetting as any).systemFields?.tenant).not.toBe(false);
    expect(plan.tenant).toBe(true);
    expect(plan.names.has('organization_id')).toBe(true);
  });

  it('ships no record: no manifest this plugin registers seeds a row of it', async () => {
    const manifests: any[] = [];
    const services: Record<string, unknown> = { manifest: { register: (m: any) => manifests.push(m) } };
    const ctx = {
      getService: (n: string) => services[n],
      registerService: (n: string, s: unknown) => { services[n] = s; },
      hook: () => {},
      logger: { info() {}, warn() {}, error() {}, debug() {} },
    };
    await new PlatformObjectsPlugin().init(ctx as any);
    const owner = manifests.find((m) => (m.objects ?? []).some((o: any) => o.name === 'sys_standard_unit_setting'));
    expect(owner?.id).toBe('com.objectstack.platform-objects');
    for (const m of manifests) {
      for (const entry of (m.data ?? []) as Array<{ object?: string }>) expect(entry.object, m.id).not.toBe('sys_standard_unit_setting');
    }
  });

  describe('set, change and clear', () => {
    it('offers New, Edit and Delete: clearing a setting is deleting its row', () => {
      expect(SysStandardUnitSetting.managedBy).toBe('system-data');
      expect((SysStandardUnitSetting as any).requiredPermissions).toBeUndefined();
      expect(resolveCrudAffordances(SysStandardUnitSetting as any)).toMatchObject({ create: true, edit: true, delete: true });
    });

    it('serves read, create, update and delete on the data API', () => {
      expect(SysStandardUnitSetting.enable?.apiEnabled).toBe(true);
      for (const op of ['get', 'list', 'create', 'update', 'delete']) {
        expect(apiExposureDenialReason(SysStandardUnitSetting.enable, op), op).toBeNull();
      }
    });
  });

  it('surfaces the History tab, with both authored columns tracked (audited like the L1 ratio edit)', () => {
    expect(SysStandardUnitSetting.enable?.trackHistory).toBe(true);
    for (const name of ['code', 'decimal_places']) expect(fields[name].trackHistory, name).toBe(true);
  });

  describe('the code is immutable after create', () => {
    const rule = rules.find((r) => r.name === 'standard_unit_setting_code_immutable');
    const violates = (record: Record<string, unknown>, previous: Record<string, unknown>): boolean | string => {
      const source = typeof rule?.condition === 'string' ? rule.condition : rule?.condition?.source;
      if (typeof source !== 'string') throw new Error('the rule has no CEL source');
      const out = celEngine.evaluate({ dialect: 'cel', source }, { record, previous } as any);
      if (!out.ok) return `FAULT ${out.error.message.split('\n')[0].trim()}`;
      return out.value as boolean;
    };
    const ROW = { code: 'GRM', decimal_places: 3 };

    it('is the one rule, update-only, attached to code', () => {
      expect(rules.map((r) => r.name)).toEqual(['standard_unit_setting_code_immutable']);
      expect(rule).toMatchObject({ type: 'cross_field', events: ['update'], fields: ['code'], severity: 'error' });
    });

    it('refuses an update that changes the code, and admits one that changes the decimal places', () => {
      expect(violates({ ...ROW, code: 'KGM' }, ROW)).toBe(true);
      expect(violates({ ...ROW, decimal_places: 0 }, ROW)).toBe(false);
    });
  });

  describe('Setup', () => {
    const configuration = SETUP_NAV_CONTRIBUTIONS.find((c) => c.group === 'group_configuration');
    const items = (configuration?.items ?? []) as any[];

    it('lists the settings directly under the units of measure, opening the all-settings view', () => {
      const at = items.findIndex((i) => i.id === 'nav_standard_unit_settings');
      expect(at).toBeGreaterThan(0);
      expect(items[at - 1].id).toBe('nav_units_of_measure');
      expect(items[at]).toMatchObject({
        type: 'object',
        label: 'Standard Unit Settings',
        objectName: 'sys_standard_unit_setting',
        viewName: 'all_settings',
      });
      expect(items[at].requiredPermissions).toBeUndefined();
    });

    it('names a view the object declares', () => {
      const view = (SysStandardUnitSetting.listViews as any).all_settings;
      expect(view.data).toEqual({ provider: 'object', object: 'sys_standard_unit_setting' });
      expect(view.columns).toEqual(['code', 'decimal_places']);
      expect(view.emptyState?.title).toBeTruthy();
    });
  });
});
