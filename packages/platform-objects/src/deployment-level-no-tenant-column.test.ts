// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, it, expect } from 'vitest';
import { resolveInjectedSystemColumns } from '@objectstack/spec/data';
import { PLATFORM_CAPABILITIES } from '@objectstack/spec/security';
import { SysJob, SysJobRun, SysJobQueue } from './audit/index.js';
import { SysMigration, SysMigrationJournal, SysSecret } from './system/index.js';

/**
 * [ADR-0131 D7] The deployment-level plumbing this package declares carries no
 * tenant column, and reads of it are platform-only.
 *
 * ## Why the column is asserted through the injection plan
 *
 * The tenant column is INJECTED at registration, never authored, so asserting
 * on `fields` alone is a phantom check: an object that merely omits the field
 * still gets the column. `resolveInjectedSystemColumns` is the derivation
 * `applySystemFields` consumes to do the injecting, so it is the authority on
 * whether the column exists. The `sys_secret` control below is the same
 * question asked of an object that DOES keep the column (its writer stamps the
 * caller's organization), so the predicate is shown able to answer `true`.
 *
 * ## Why the capability is pinned beside the column
 *
 * The two are one decision. With no column there is no tenant wall, and a
 * walled deployment's `organization_admin` holds a `'*'` grant carrying the
 * superuser bits — so without an object-level capability gate, removing the
 * column would hand every organization's admin every other organization's
 * job errors, queued payloads and migration traces. D7 governs these objects
 * by object permission; this is that permission, and losing it is a security
 * regression, not a tidy-up.
 */
const DEPLOYMENT_LEVEL = [
  ['sys_job', SysJob],
  ['sys_job_run', SysJobRun],
  ['sys_job_queue', SysJobQueue],
  ['sys_migration', SysMigration],
  ['sys_migration_journal', SysMigrationJournal],
] as const;

describe('[ADR-0131 D7] deployment-level plumbing: no tenant column, platform-only reads', () => {
  for (const [name, object] of DEPLOYMENT_LEVEL) {
    describe(name, () => {
      it('is the object this row names', () => {
        expect(object.name).toBe(name);
      });

      it('carries no tenant column — neither injected nor declared', () => {
        const plan = resolveInjectedSystemColumns(object);
        expect(plan.tenant).toBe(false);
        expect([...plan.names]).not.toContain('organization_id');
        expect(Object.keys(object.fields ?? {})).not.toContain('organization_id');
        // Anti-vacuity: the plan still injects the audit family here, so an
        // empty name set cannot pass the assertions above by saying nothing.
        expect([...plan.names]).toEqual(expect.arrayContaining(['id', 'created_at']));
      });

      it('opts out through `systemFields.tenant`, not the platform-global posture', () => {
        expect((object as { systemFields?: unknown }).systemFields).toEqual({ tenant: false });
        expect((object as { tenancy?: unknown }).tenancy).toBeUndefined();
        // Per-object control: the same declaration WITHOUT the opt-out gets the
        // column, so the `false` above is the opt-out's doing.
        const { systemFields: _optOut, ...withoutOptOut } = object as Record<string, unknown>;
        expect(resolveInjectedSystemColumns(withoutOptOut).tenant).toBe(true);
      });

      it('gates every read on the platform-only capability', () => {
        expect((object as { requiredPermissions?: unknown }).requiredPermissions).toEqual([
          'manage_platform_settings',
        ]);
      });
    });
  }

  it('the gating capability is platform-scoped, so no tenant administrator holds it by role', () => {
    const cap = PLATFORM_CAPABILITIES.find((c) => c.name === 'manage_platform_settings');
    expect(cap?.scope).toBe('platform');
  });

  it('control: a tenant-attributed object keeps the column, so the predicate can answer true', () => {
    // `sys_secret` is written with the business write's driver options, so the
    // SQL driver stamps the caller's organization on it. It is NOT
    // deployment-level today; its fate is decided by the C7 inventory.
    const plan = resolveInjectedSystemColumns(SysSecret);
    expect(plan.tenant).toBe(true);
    expect([...plan.names]).toContain('organization_id');
  });
});
