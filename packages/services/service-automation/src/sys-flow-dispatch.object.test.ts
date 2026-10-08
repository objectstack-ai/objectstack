// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { resolveInjectedSystemColumns } from '@objectstack/spec/data';
import { SysFlowDispatch } from './sys-flow-dispatch.object.js';
import { SysAutomationRun } from './sys-automation-run.object.js';

/**
 * [ADR-0131 D7] `sys_flow_dispatch` is deployment-level: no tenant column, and
 * reads are platform-only.
 *
 * The column is asserted through `resolveInjectedSystemColumns` because it is
 * INJECTED at registration — a `fields` check alone would pass on an object
 * that merely omits it. The capability is pinned beside it because the two are
 * one decision: with no column there is no tenant wall, so without the gate a
 * walled deployment's `organization_admin` (a `'*'` grant with the superuser
 * bits) would read every organization's dispatch keys.
 *
 * Control: `sys_automation_run`, whose writer stamps the run's organization,
 * keeps the column — the predicate is shown able to answer `true`.
 */
describe('[ADR-0131 D7] sys_flow_dispatch — deployment-level', () => {
  it('carries no tenant column — neither injected nor declared', () => {
    const plan = resolveInjectedSystemColumns(SysFlowDispatch);
    expect(plan.tenant).toBe(false);
    expect([...plan.names]).not.toContain('organization_id');
    expect(Object.keys(SysFlowDispatch.fields ?? {})).not.toContain('organization_id');
    expect([...plan.names]).toEqual(expect.arrayContaining(['id', 'created_at']));
  });

  it('opts out through `systemFields.tenant`, not the platform-global posture', () => {
    expect((SysFlowDispatch as { systemFields?: unknown }).systemFields).toEqual({ tenant: false });
    expect((SysFlowDispatch as { tenancy?: unknown }).tenancy).toBeUndefined();
    // The same declaration WITHOUT the opt-out gets the column, so the
    // `false` above is the opt-out's doing.
    const { systemFields: _optOut, ...withoutOptOut } = SysFlowDispatch as Record<string, unknown>;
    expect(resolveInjectedSystemColumns(withoutOptOut).tenant).toBe(true);
  });

  it('gates every read on the platform-only capability', () => {
    expect((SysFlowDispatch as { requiredPermissions?: unknown }).requiredPermissions).toEqual([
      'manage_platform_settings',
    ]);
  });

  it('control: the tenant-attributed run ledger keeps the column', () => {
    const plan = resolveInjectedSystemColumns(SysAutomationRun);
    expect(plan.tenant).toBe(true);
    expect([...plan.names]).toContain('organization_id');
  });
});
