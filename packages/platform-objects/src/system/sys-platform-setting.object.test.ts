// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { resolveInjectedSystemColumns } from '@objectstack/spec/data';
import { PLATFORM_CAPABILITIES } from '@objectstack/spec/security';
import { SysPlatformSetting } from './sys-platform-setting.object.js';
import { SysSetting } from './sys-setting.object.js';

/**
 * [ADR-0131 D7] `sys_platform_setting` — the settings cascade's global rung —
 * carries no organization column, and reads of it are platform-only.
 *
 * The column is asserted through the injection plan, not through `fields`: the
 * tenant column is INJECTED at registration, so an object that merely omits the
 * field would still get it. `resolveInjectedSystemColumns` is the derivation
 * `applySystemFields` consumes, so it is the authority. The per-object control
 * (the same declaration with the opt-out removed gets the column) shows the
 * predicate able to answer `true`.
 */
describe('[ADR-0131 D7] sys_platform_setting: no organization column, platform-only reads', () => {
  it('carries no tenant column — neither injected nor declared', () => {
    const plan = resolveInjectedSystemColumns(SysPlatformSetting);
    expect(plan.tenant).toBe(false);
    expect([...plan.names]).not.toContain('organization_id');
    expect(Object.keys(SysPlatformSetting.fields ?? {})).not.toContain('organization_id');
    // Anti-vacuity: the plan still injects the audit family, so an empty name
    // set cannot pass the assertions above by saying nothing.
    expect([...plan.names]).toEqual(expect.arrayContaining(['id', 'created_at']));
  });

  it('opts out through `systemFields.tenant`, and the opt-out is what removes the column', () => {
    expect((SysPlatformSetting as { systemFields?: unknown }).systemFields).toEqual({ tenant: false });
    expect((SysPlatformSetting as { tenancy?: unknown }).tenancy).toBeUndefined();
    const { systemFields: _optOut, ...withoutOptOut } = SysPlatformSetting as Record<string, unknown>;
    expect(resolveInjectedSystemColumns(withoutOptOut).tenant).toBe(true);
  });

  it('gates every read on the platform-only capability, which no tenant administrator holds by role', () => {
    expect((SysPlatformSetting as { requiredPermissions?: unknown }).requiredPermissions).toEqual([
      'manage_platform_settings',
    ]);
    const cap = PLATFORM_CAPABILITIES.find((c) => c.name === 'manage_platform_settings');
    expect(cap?.scope).toBe('platform');
  });

  it('is keyed (namespace, key) for the whole deployment, with no rung or user column', () => {
    const fields = SysPlatformSetting.fields ?? {};
    expect(fields).not.toHaveProperty('scope');
    expect(fields).not.toHaveProperty('user_id');
    expect(SysPlatformSetting.indexes).toEqual(
      expect.arrayContaining([expect.objectContaining({ fields: ['namespace', 'key'], unique: 'global' })]),
    );
  });

  it("holds the value and encryption columns of sys_setting's rows, with the same read-only posture", () => {
    const fields = SysPlatformSetting.fields as Record<string, { type?: string; readonly?: boolean }>;
    const legacy = SysSetting.fields as Record<string, { type?: string; readonly?: boolean }>;
    for (const name of ['namespace', 'key', 'value', 'encrypted', 'locked', 'locked_reason', 'value_enc', 'updated_by']) {
      expect(fields[name]?.type, name).toBe(legacy[name]?.type);
      expect(Boolean(fields[name]?.readonly), `${name}.readonly`).toBe(Boolean(legacy[name]?.readonly));
    }
    // The two columns only the settings service may write.
    expect(fields.value_enc?.readonly).toBe(true);
    expect(fields.updated_by?.readonly).toBe(true);
  });

  it('control: sys_setting, which keeps the tenant and user rungs, keeps the column', () => {
    const plan = resolveInjectedSystemColumns(SysSetting);
    expect(plan.tenant).toBe(true);
    expect([...plan.names]).toContain('organization_id');
  });

  it('is generic-API read-only: writes go through the settings door', () => {
    expect(SysPlatformSetting.managedBy).toBe('engine-owned');
    expect((SysPlatformSetting.enable as { apiMethods?: unknown })?.apiMethods).toEqual(['get', 'list']);
  });
});
